// Runs a chain op: each step runs another op of the same playbook through runPlaybookOp, with
// inputs bound from the chain's own inputs, an earlier step's result or, in an `each` step, the
// record it runs for. The README's "Chain ops" section is the format's spec.
const { applyTemplate, resolveArgs, runPlaybookOp } = require("./playbook-runtime.cjs");
const { CHAIN_LIMITS, checkChainOps, compileBindingPath, validateOp } = require("./playbooks.cjs");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The `n`th (from 1) path segment of a URL, decoded; a relative URL counts from its first segment. */
function urlSegment(value, n) {
  if (typeof value !== "string") throw new Error(`segment ${n} needs a URL, got ${value === null ? "null" : typeof value}`);
  const segments = new URL(value, "https://chain.invalid/").pathname.split("/").filter(Boolean);
  if (segments.length < n) throw new Error(`${value} has no path segment ${n}`);
  return decodeURIComponent(segments[n - 1]);
}

// One input's value: a template filled from the chain's inputs (unset when it names an unset
// input), a literal, or a binding read from the record or an earlier step's result.
function bindValue(input, binding, { args, values, item }) {
  if (typeof binding === "string") return applyTemplate(binding, args);
  if (!binding || typeof binding !== "object") return binding;
  const fromItem = binding.from === "item";
  let value = fromItem ? item : values.get(binding.from);
  if (binding.path !== undefined) {
    value = compileBindingPath(binding.path)(value);
    if (value === undefined || value === null) {
      throw new Error(`binding ${input}: ${binding.path} is not in ${fromItem ? "the record" : `step ${binding.from}'s result`}`);
    }
  }
  return binding.segment === undefined ? value : urlSegment(value, binding.segment);
}

function bindArgs(step, context) {
  const args = {};
  for (const [input, binding] of Object.entries(step.with || {})) {
    const value = bindValue(input, binding, context);
    if (value !== undefined) args[input] = value;
  }
  return args;
}

// each.limit or each.delayMs: the saved number, the input it names, or the default (also when
// that input is unset).
function eachBound(value, { args, fallback, min, max, name }) {
  const filled = typeof value === "string" ? applyTemplate(value, args) : value;
  if (filled === undefined) return fallback;
  const number = typeof filled === "string" && filled.trim() !== "" ? Number(filled) : filled;
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`each.${name} must be an integer from ${min} to ${max} (got ${JSON.stringify(filled)})`);
  }
  return number;
}

function eachBounds(step, args) {
  return {
    limit: eachBound(step.each.limit, { args, fallback: CHAIN_LIMITS.eachLimit, min: 1, max: CHAIN_LIMITS.eachMax, name: "limit" }),
    delayMs: eachBound(step.each.delayMs, { args, fallback: CHAIN_LIMITS.delayMs, min: 0, max: CHAIN_LIMITS.delayMax, name: "delayMs" }),
  };
}

function stepError(op, step, label, caught) {
  const error = new Error(`chain ${op.id} step ${step.id} (${step.op}${label}) failed: ${caught?.message || String(caught)}`);
  if (caught?.attempts) error.attempts = caught.attempts;
  return error;
}

/**
 * Runs `op.chain` step by step and returns the `output` step's value (an each step's results,
 * concatenated) as runPlaybookOp returns an op's. The first failing step stops the chain with an
 * error naming it. `options` are runPlaybookOp's: the tab, signal, sleep, events and secrets.
 * `budget` counts op runs across nested chains.
 */
async function runChainOp(options) {
  const { playbook, op, args: provided = {}, budget = { runs: 0 } } = options;
  const { executeTool, executeStep, executeNative, signal, sleep, now, onEvent, secrets, env, allowScript } = options;
  const pause = sleep ?? wait;
  const args = resolveArgs(op, provided, { playbookId: playbook.id });
  const values = new Map();
  const steps = [];
  for (const step of op.chain) {
    const target = playbook.ops.get(step.op);
    const runStep = async (item, label) => {
      try {
        if (signal?.aborted) throw new Error("the run was cancelled");
        if (++budget.runs > CHAIN_LIMITS.runs) throw new Error(`a chain run calls at most ${CHAIN_LIMITS.runs} ops`);
        const stepArgs = bindArgs(step, { args, values, item });
        const result = target.chain
          ? await runChainOp({ ...options, op: target, args: stepArgs, budget })
          : await runPlaybookOp({ playbook, op: target, args: stepArgs, secrets, env, executeTool, executeStep, executeNative, signal, sleep, now, onEvent, allowScript });
        return result.value;
      } catch (caught) {
        throw stepError(op, step, label, caught);
      }
    };
    if (step.each === undefined) {
      values.set(step.id, await runStep(undefined, ""));
      steps.push({ id: step.id, op: step.op, runs: 1 });
      continue;
    }
    const records = values.get(step.each.from);
    let bounds;
    try {
      if (!Array.isArray(records)) throw new Error(`each needs step ${step.each.from} to return a list of records; it returned ${records === null ? "null" : typeof records}`);
      bounds = eachBounds(step, args);
    } catch (caught) {
      throw stepError(op, step, "", caught);
    }
    const picked = records.slice(0, bounds.limit);
    const results = [];
    for (const [index, record] of picked.entries()) {
      // Every request of the step waits, the first too: it follows the step it reads from.
      await pause(bounds.delayMs);
      const value = await runStep(record, `, record ${index + 1} of ${picked.length}`);
      if (Array.isArray(value)) results.push(...value);
      else results.push(value);
    }
    values.set(step.id, results);
    steps.push({ id: step.id, op: step.op, runs: picked.length });
  }
  return { status: "completed", playbook: playbook.id, op: op.id, strategy: "chain", value: values.get(op.output), provenance: playbook.provenance, steps };
}

/** surf use --dry-run of a chain: its steps, each with what it runs over; nothing is sent. */
function previewChainOp({ playbook, op, args: provided = {} }) {
  const args = resolveArgs(op, provided, { playbookId: playbook.id });
  return {
    playbook: playbook.id,
    op: op.id,
    effect: op.effect,
    strategy: "chain",
    steps: op.chain.map((step) => ({ id: step.id, op: step.op, ...(step.each ? { each: { from: step.each.from, ...eachBounds(step, args) } } : {}) })),
    output: op.output,
  };
}

/** `--each-from <op>[:<path>][@path.<n>]`: the list op, the path into each of its records and the URL path segment to take. */
function parseEachFrom(text) {
  const match = typeof text === "string" ? /^([^:@]+)(?::([^@]+))?(?:@path\.([1-9]\d*))?$/.exec(text) : null;
  if (!match) throw new Error(`--each-from must be <op>, <op>:<path> or <op>:<path>@path.<n>, such as list_postings:id or list_postings:url@path.2 (got ${text})`);
  return { op: match[1], ...(match[2] ? { path: match[2] } : {}), ...(match[3] ? { segment: Number(match[3]) } : {}) };
}

/**
 * `surf use <pb> <op> --each-from <list-op>:<path>`: a two-step chain, made in memory, that runs
 * `op` once per record of the list op, filling `into` (default: op's first required input) from
 * each record. The chain takes both ops' other inputs and passes each on by name.
 */
function eachFromChain({ playbook, op, eachFrom }) {
  const { op: listId, path, segment, into, limit, delayMs } = eachFrom || {};
  const list = playbook.ops.get(listId);
  if (!list) throw new Error(`--each-from: playbook ${playbook.id} has no op ${listId}`);
  if (list.id === op.id) throw new Error(`--each-from names ${op.id} itself`);
  const specs = op.args || {};
  const target = into ?? Object.keys(specs).find((name) => specs[name].required);
  if (target === undefined) throw new Error(`${op.id} has no required input; name the one to fill with --each-into`);
  if (!Object.hasOwn(specs, target)) throw new Error(`--each-into ${target} is no input of ${op.id}`);
  const { [target]: _bound, ...rest } = specs;
  const passOn = (names) => Object.fromEntries(names.map((name) => [name, `{{${name}}}`]));
  const chained = validateOp(
    {
      id: `${op.id}.each`,
      effect: "read",
      args: { ...(list.args || {}), ...rest },
      chain: [
        { id: "list", op: list.id, with: passOn(Object.keys(list.args || {})) },
        {
          id: "detail",
          op: op.id,
          each: { from: "list", ...(limit !== undefined ? { limit } : {}), ...(delayMs !== undefined ? { delayMs } : {}) },
          with: { ...passOn(Object.keys(rest)), [target]: { from: "item", ...(path !== undefined ? { path } : {}), ...(segment !== undefined ? { segment } : {}) } },
        },
      ],
      output: "detail",
      ...(op.markdown !== undefined ? { markdown: op.markdown } : {}),
    },
    playbook,
  );
  checkChainOps(new Map([...playbook.ops, [chained.id, chained]]), playbook.id);
  return chained;
}

module.exports = { eachFromChain, parseEachFrom, previewChainOp, runChainOp };
