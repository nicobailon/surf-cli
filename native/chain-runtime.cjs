// Runs a chain op: each step runs another op of the same playbook through runPlaybookOp, with
// inputs bound from the chain's own inputs, an earlier step's result or, in an `each` step, the
// record it runs for. The README's "Chain ops" section is the format's spec.
const crypto = require("crypto");
const { checkReceipt, reserveReceipt, updateReceipt } = require("./playbook-receipts.cjs");
const { applyTemplate, resolveArgs, runPlaybookOp } = require("./playbook-runtime.cjs");
const { CHAIN_LIMITS, checkChainOps, compileBindingPath, validateOp } = require("./playbooks.cjs");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The `n`th (from 1) path segment of a URL, decoded; a relative URL counts from its first segment. */
function urlSegment(value, n) {
  if (typeof value !== "string") throw new Error(`is ${describe(value)}, not a URL, so it has no path segment ${n}`);
  const segments = new URL(value, "https://chain.invalid/").pathname.split("/").filter(Boolean);
  if (segments.length < n) throw new Error(`is ${value}, which has no path segment ${n}`);
  return decodeURIComponent(segments[n - 1]);
}

const describe = (value) => (value === null ? "null" : Array.isArray(value) ? "a list" : value === undefined ? "missing" : typeof value === "object" ? "an object" : typeof value);

// One input's value: a template filled from the chain's inputs (unset when it names an unset
// input), a literal, or a binding read from the record or an earlier step's result. A binding must
// find a string, number or boolean: anything else stops the chain, naming the step, input and path.
function bindValue(step, input, binding, { args, values, item }) {
  if (typeof binding === "string") return applyTemplate(binding, args);
  if (!binding || typeof binding !== "object") return binding;
  const label = `binding ${step.id}.${input} → ${binding.from}${binding.path === undefined ? "" : `.${binding.path}`}`;
  let value = binding.from === "item" ? item : values.get(binding.from);
  if (binding.path !== undefined) value = compileBindingPath(binding.path)(value);
  if (binding.segment !== undefined) {
    try {
      value = urlSegment(value, binding.segment);
    } catch (error) {
      throw new Error(`${label} ${error.message}`);
    }
  }
  if (value === undefined || value === null) throw new Error(`${label} is ${describe(value)}; bind a path that holds a value`);
  if (typeof value === "object") throw new Error(`${label} is ${describe(value)}; bind a field inside it`);
  return value;
}

function bindArgs(step, context) {
  const args = {};
  for (const [input, binding] of Object.entries(step.with || {})) {
    const value = bindValue(step, input, binding, context);
    if (value !== undefined) args[input] = value;
  }
  return args;
}

// An each or page bound (`name`, such as each.limit): the saved number, the input it names, or
// the default (also when that input is unset).
function stepBound(value, { args, fallback, min, max, name }) {
  const filled = typeof value === "string" ? applyTemplate(value, args) : value;
  if (filled === undefined) return fallback;
  const number = typeof filled === "string" && filled.trim() !== "" ? Number(filled) : filled;
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max} (got ${JSON.stringify(filled)})`);
  }
  return number;
}

function eachBounds(step, args) {
  return {
    limit: stepBound(step.each.limit, { args, fallback: CHAIN_LIMITS.eachLimit, min: 1, max: CHAIN_LIMITS.eachMax, name: "each.limit" }),
    delayMs: stepBound(step.each.delayMs, { args, fallback: CHAIN_LIMITS.delayMs, min: 0, max: CHAIN_LIMITS.delayMax, name: "each.delayMs" }),
  };
}

function pageBounds(step, args) {
  return {
    max: stepBound(step.page.max, { args, fallback: CHAIN_LIMITS.pageLimit, min: 1, max: CHAIN_LIMITS.pageMax, name: "page.max" }),
    delayMs: stepBound(step.page.delayMs, { args, fallback: CHAIN_LIMITS.delayMs, min: 0, max: CHAIN_LIMITS.delayMax, name: "page.delayMs" }),
  };
}

// The value page.into takes on the page after one that ran with `current` and whose response gave
// `next` ({ value, from }: page.next's path or html, read by runPlaybookOp, and the page's URL).
// Undefined: there is no next page (no value, false, or only whitespace).
function followingPage(step, current, next) {
  if (step.page.next === "increment") return current + 1;
  const label = `page.next of step ${step.id}`;
  let value = typeof next?.value === "string" ? next.value.trim() : next?.value;
  if (value === undefined || value === null || value === "" || value === false) return undefined;
  if (typeof value === "object") throw new Error(`${label} is ${describe(value)}; read a field inside it`);
  // A page chooses its next URL: one on another origin would take the chain off the site.
  if (typeof value === "string" && /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(value) && typeof next.from === "string") {
    const to = new URL(value, next.from).origin;
    const at = new URL(next.from).origin;
    if (to !== at) throw new Error(`${label} is a URL on ${to}, not on ${at}, the page it came from`);
  }
  if (step.page.next.segment !== undefined) {
    try {
      value = urlSegment(value, step.page.next.segment);
    } catch (error) {
      throw new Error(`${label} ${error.message}`);
    }
  }
  if (value === "." || value === "..") throw new Error(`${label} is ${value}, which would move the request up a path level`);
  return value;
}

// An increment's first page: the step's own value for page.into, else that input's default, else 1.
function firstPage(step, target, stepArgs) {
  const start = stepArgs[step.page.into] ?? target.args?.[step.page.into]?.default ?? 1;
  const number = typeof start === "string" && start.trim() !== "" ? Number(start) : start;
  if (!Number.isInteger(number)) throw new Error(`page.next increment needs --${step.page.into} to be a whole page number (got ${JSON.stringify(start)})`);
  return number;
}

function stepError(op, step, label, caught) {
  const error = new Error(`chain ${op.id} step ${step.id} (${step.op}${label}) failed: ${caught?.message || String(caught)}`);
  if (caught?.attempts) error.attempts = caught.attempts;
  return error;
}

/**
 * A `page` step: runs its op, then again with page.into set from page.next, `delayMs` apart, until
 * there is no next value, a page has no records, a next value repeats, or `max` pages ran. Returns
 * the pages' records, concatenated, and how many pages ran.
 */
async function runPages({ op, step, target, args, values, runOnce, pause }) {
  const { into, next } = step.page;
  const reads = next === "increment" ? undefined : next.path !== undefined ? { path: next.path } : { html: next.html };
  let stepArgs;
  let bounds;
  let current;
  try {
    stepArgs = bindArgs(step, { args, values });
    bounds = pageBounds(step, args);
    current = next === "increment" ? firstPage(step, target, stepArgs) : stepArgs[into];
  } catch (caught) {
    throw stepError(op, step, "", caught);
  }
  // The loop guard: a value page.into already had (the first page's included, the op's default when
  // the step sets none) means the pages go round. Values compare as text: a cursor 2 is "2".
  const first = current ?? target.args?.[into]?.default;
  const seen = new Set(first === undefined ? [] : [String(first)]);
  const records = [];
  for (let pages = 1; ; pages++) {
    const label = `, page ${pages}`;
    let following;
    try {
      const result = await runOnce(current === undefined ? stepArgs : { ...stepArgs, [into]: current }, reads);
      if (!Array.isArray(result.value)) throw new Error(`page needs ${step.op} to return a list of records; it returned ${describe(result.value)}`);
      records.push(...result.value);
      if (result.value.length === 0 || pages >= bounds.max) return { value: records, pages };
      following = followingPage(step, current, result.next);
    } catch (caught) {
      throw stepError(op, step, label, caught);
    }
    if (following === undefined || seen.has(String(following))) return { value: records, pages };
    seen.add(String(following));
    current = following;
    await pause(bounds.delayMs);
  }
}

// What a write op sends, as saved ({{inputs}} unfilled: a chain binds them as it runs): its first
// strategy's method and URL, or the commands its workflow runs.
function writeSends(op) {
  const [strategy] = op.run;
  if (strategy.using === "network") return `${String(strategy.request.method || "GET").toUpperCase()} ${strategy.request.url}`;
  if (strategy.using === "workflow") return `runs ${strategy.steps.map((step) => step.cmd).join(", ")}`;
  return `runs its ${strategy.using} strategy`;
}

/** A chain's write steps, a nested chain's included (as `outer → inner`), each with its op and what it sends. */
function chainWrites({ playbook, op }) {
  return op.chain.flatMap((step) => {
    const target = playbook.ops.get(step.op);
    if (target.effect !== "write") return [];
    if (target.chain) return chainWrites({ playbook, op: target }).map((write) => ({ ...write, step: `${step.id} → ${write.step}` }));
    return [{ step: step.id, op: target.id, sends: writeSends(target) }];
  });
}

const SENT_STATE = {
  verified: "which succeeded",
  indeterminate: "whose result is unknown (in doubt)",
  dispatched: "which surf stopped before its answer came (in doubt)",
};

// A chain that fails after a write step was sent stops there and sends nothing again: the error
// names each sent write and its receipt's state.
function afterSentWrites(caught, sent) {
  if (sent.length === 0) return caught;
  const writes = sent.map(({ step, op, handle }) => {
    const status = handle.receipt.status;
    return `write step ${step} (${op}), attempt ${handle.attemptId}, ${SENT_STATE[status] ?? `whose receipt is ${status}`}`;
  });
  const message = caught?.message || String(caught);
  const error = new Error(`${message}${message.endsWith(".") ? "" : "."} The chain stopped after it sent ${writes.join("; ")}. Check the site before you run it again; its sent writes need --repeat to send again.`);
  if (caught?.attempts) error.attempts = caught.attempts;
  return error;
}

/**
 * Runs `op.chain` step by step and returns the `output` step's value (an each step's results,
 * concatenated) as runPlaybookOp returns an op's. The first failing step stops the chain with an
 * error naming it, and naming each write step it sent before. `options` are runPlaybookOp's: the
 * tab, signal, sleep, events and secrets; `repeat` (--repeat) lets a write step send inputs its
 * receipt already holds.
 */
async function runChainOp(options) {
  const sent = [];
  try {
    return await runSteps({ ...options, sent });
  } catch (caught) {
    throw afterSentWrites(caught, sent);
  }
}

// `budget` counts op runs across nested chains; `sent` collects the write steps they send, as
// `at → step` inside a nested chain run by step `at`.
async function runSteps(options) {
  const { playbook, op, args: provided = {}, budget = { runs: 0 }, sent, at, repeat = false } = options;
  const { executeTool, executeStep, executeNative, signal, sleep, now, onEvent, secrets, env, allowScript } = options;
  const pause = sleep ?? wait;
  const args = resolveArgs(op, provided, { playbookId: playbook.id });
  const values = new Map();
  const steps = [];
  for (const step of op.chain) {
    const target = playbook.ops.get(step.op);
    const runOp = (stepArgs, more) => runPlaybookOp({ playbook, op: target, args: stepArgs, secrets, env, executeTool, executeStep, executeNative, signal, sleep, now, onEvent, allowScript, ...more });
    // A write step gets its own receipt, keyed by its inputs after binding as a run of its op
    // alone would be: checked first, reserved once its request is dispatched.
    const runWrite = async (stepArgs) => {
      const claim = { playbookId: playbook.id, op: target, args: resolveArgs(target, stepArgs, { playbookId: playbook.id }), repeat, attemptId: crypto.randomUUID() };
      checkReceipt(claim);
      const write = { step: at ? `${at} → ${step.id}` : step.id, op: target.id, handle: null };
      return runOp(stepArgs, {
        attemptId: claim.attemptId,
        beforeDispatch: async () => {
          write.handle = reserveReceipt(claim);
          sent.push(write);
          updateReceipt(write.handle, "dispatched");
        },
        afterDispatch: async ({ status, error }) => updateReceipt(write.handle, status, { error }),
      });
    };
    // One run of the step's op: `page` sets page.into and reads page.next from the response.
    const runOnce = async (stepArgs, pageNext) => {
      if (signal?.aborted) throw new Error("the run was cancelled");
      if (++budget.runs > CHAIN_LIMITS.runs) throw new Error(`a chain run calls at most ${CHAIN_LIMITS.runs} ops`);
      if (target.chain) return runSteps({ ...options, op: target, args: stepArgs, budget, at: at ? `${at} → ${step.id}` : step.id });
      if (target.effect === "write") return runWrite(stepArgs);
      return runOp(stepArgs, pageNext ? { pageNext } : {});
    };
    const runStep = async (item, label) => {
      try {
        return (await runOnce(bindArgs(step, { args, values, item }))).value;
      } catch (caught) {
        throw stepError(op, step, label, caught);
      }
    };
    if (step.page !== undefined) {
      const { value, pages } = await runPages({ op, step, target, args, values, runOnce, pause });
      values.set(step.id, value);
      steps.push({ id: step.id, op: step.op, runs: pages });
      continue;
    }
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

// A write step in a dry run: what it sends and its receipt check, which needs its inputs: known
// now only when none is bound from an earlier step.
function previewWrite({ playbook, step, target, args, repeat }) {
  if (target.chain) {
    const sends = chainWrites({ playbook, op: target }).map((write) => `${write.step} (${write.op}) sends ${write.sends}`);
    return { sends: `chain ${target.id}: ${sends.join("; ")}`, receipt: "checked as each of its write steps runs" };
  }
  const write = { sends: writeSends(target) };
  if (Object.values(step.with || {}).some((binding) => binding && typeof binding === "object")) {
    return { ...write, receipt: "checked when the step runs: its inputs come from earlier steps" };
  }
  try {
    checkReceipt({ playbookId: playbook.id, op: target, args: resolveArgs(target, bindArgs(step, { args }), { playbookId: playbook.id }), repeat });
    return { ...write, receipt: "clear: --write reserves one when the step is sent" };
  } catch (error) {
    return { ...write, receipt: `blocked: ${error.message}` };
  }
}

/** surf use --dry-run of a chain: its steps, each with what it runs over and what a write step sends; nothing is sent. */
function previewChainOp({ playbook, op, args: provided = {}, repeat = false }) {
  const args = resolveArgs(op, provided, { playbookId: playbook.id });
  return {
    playbook: playbook.id,
    op: op.id,
    effect: op.effect,
    strategy: "chain",
    steps: op.chain.map((step) => {
      const target = playbook.ops.get(step.op);
      return {
        id: step.id,
        op: step.op,
        ...(step.each ? { each: { from: step.each.from, ...eachBounds(step, args) } } : {}),
        ...(step.page ? { page: { into: step.page.into, next: step.page.next, ...pageBounds(step, args) } } : {}),
        ...(target.effect === "write" ? { write: previewWrite({ playbook, step, target, args, repeat }) } : {}),
      };
    }),
    output: op.output,
    receipt: op.effect === "write" ? "one per write step, reserved when the step is sent" : "none: a read op keeps no receipt",
  };
}

/** `--each-from <op>[:<path>][@path.<n>]`: the list op, the path into each of its records and the URL path segment to take. */
function parseEachFrom(text) {
  const match = typeof text === "string" ? /^([^:@]+)(?::([^@]+))?(?:@path\.([1-9]\d*))?$/.exec(text) : null;
  if (!match) throw new Error(`--each-from must be <op>, <op>:<path> or <op>:<path>@path.<n>, such as list_books:url or list_quotes:author_url@path.2 (got ${text})`);
  return { op: match[1], ...(match[2] ? { path: match[2] } : {}), ...(match[3] ? { segment: Number(match[3]) } : {}) };
}

// Without --each-into, each record fills op's one required input the caller didn't pass.
function eachTarget(op, given) {
  const open = Object.entries(op.args || {}).filter(([name, spec]) => spec.required && !given.includes(name)).map(([name]) => name);
  if (open.length === 1) return open[0];
  if (open.length === 0) throw new Error(`--each-from: ${op.id} has no required input left for each record to fill; name it with --each-into`);
  throw new Error(`--each-from: ${op.id} has several required inputs you didn't pass (${open.join(", ")}); name the one each record fills with --each-into, and pass the others`);
}

/**
 * `surf use <pb> <op> --each-from <list-op>:<path>`: a two-step chain, made in memory, that runs
 * `op` once per record of the list op, filling `into` (default: op's one required input not in
 * `given`, the inputs the caller passed) from each record. The chain takes both ops' other inputs and passes each on by name.
 */
function eachFromChain({ playbook, op, eachFrom, given = [] }) {
  const { op: listId, path, segment, into, limit, delayMs } = eachFrom || {};
  const list = playbook.ops.get(listId);
  if (!list) throw new Error(`--each-from: playbook ${playbook.id} has no op ${listId}`);
  if (list.id === op.id) throw new Error(`--each-from names ${op.id} itself`);
  // A write once per record is a bulk write.
  for (const each of [list, op]) if (each.effect === "write") throw new Error(`--each-from runs read ops only; ${each.id} is a write`);
  const specs = op.args || {};
  const target = into ?? eachTarget(op, given);
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

module.exports = { chainWrites, eachFromChain, parseEachFrom, previewChainOp, runChainOp };
