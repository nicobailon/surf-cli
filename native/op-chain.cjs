// Chain ops and --each. A chain step runs another op of the playbook; each `with` value is a
// template: {{input}} (the chain's input), {{item.path}} (the record an `each` step runs for) or
// {{step.path}} (an earlier step's result). `each` runs the step once per record of an earlier
// step, `limit` (default 10) of them, each run `delayMs` (default 1000) after the request before
// it. The chain returns the last step's result. One run makes at most 100 op runs. A write step
// sends once per run, each send passing runOp's guard (--write, the duplicate window).

const { runOp } = require("./op-run.cjs");
const { resolveArgs } = require("./playbook-runtime.cjs");

const MAX_RUNS = 100;

// With --url, an input that only fills the op's URL (a hook-made detail op's id) isn't needed.
function urlInputsOptional(op) {
  const inUrl = `${op.request?.url || ""} ${op.open || ""}`;
  const elsewhere = JSON.stringify([op.request && { ...op.request, url: "" }, op.steps]);
  const optional = (name) => inUrl.includes(`{{${name}}}`) && !elsewhere.includes(`{{${name}}}`);
  return Object.fromEntries(Object.entries(op.args || {}).map(([name, spec]) => [name, optional(name) ? { ...spec, required: false } : spec]));
}

/** An op's run inputs from what it was given: --url and --pages are surf's unless the op names an input so. */
function stepInputs(playbook, op, given = {}) {
  const flag = (name) => (Object.hasOwn(op.args || {}, name) ? undefined : given[name]);
  const url = flag("url");
  const pages = flag("pages") ?? 1;
  if (!op.request && !op.open && (url !== undefined || pages !== 1)) throw new Error(`--url and --pages need an op with request or open; ${playbook.id} ${op.id} has ${op.chain ? "a chain" : "a run list"}`);
  if (url !== undefined && typeof url !== "string") throw new Error("--url needs a URL");
  if (!Number.isInteger(Number(pages)) || pages < 1 || pages > 100) throw new Error("--pages must be a whole number from 1 to 100");
  const args = resolveArgs(url === undefined ? op : { ...op, args: urlInputsOptional(op) }, given, { playbookId: playbook.id });
  return { args, url, pages: Number(pages) };
}

/** --each <list-op>:<field>[=<input>]: `op` once per record of the list op, as a two-step chain, `delayMs` apart. */
function eachChain(playbook, op, each, { delayMs } = {}) {
  if (delayMs !== undefined && !(Number.isInteger(delayMs) && delayMs >= 0 && delayMs <= 600000)) throw new Error("--delay-ms must be a whole number of milliseconds from 0 to 600000");
  const [, listId, field, input = field] = String(each).match(/^([\w-]+):([\w.[\]-]+?)(?:=([\w-]+))?$/) || [];
  if (!listId) throw new Error("--each needs <list-op>:<field>[=<input>], such as list_books:url");
  const list = playbook.ops.get(listId);
  if (!list) throw new Error(`--each: ${playbook.id} has no op ${listId}`);
  for (const target of [list, op]) if (!target.request && !target.open) throw new Error(`--each runs ${target.id}, ${kind(target)}; it needs an op with request or open`);
  const { [input]: _filled, ...rest } = op.args || {};
  // Each input goes to the op that names it, but --limit only caps the loop (10 unless given);
  // each step's run checks its own required inputs.
  const loose = (args) => Object.fromEntries(Object.entries(args).map(([name, { required: _, ...spec }]) => [name, spec]));
  const pass = ({ limit: _, ...args }) => Object.fromEntries(Object.keys(args).map((name) => [name, `{{${name}}}`]));
  return {
    id: op.id,
    args: { pages: { default: 1 }, ...loose(list.args || {}), ...loose(rest), limit: {} },
    chain: [
      { id: "list", op: listId, with: { ...pass(list.args || {}), pages: "{{pages}}" } },
      { id: "each", op: op.id, each: "list", limit: "{{limit}}", ...(delayMs === undefined ? {} : { delayMs }), with: { ...pass(rest), [input]: `{{item.${field}}}` } },
    ],
  };
}

function resolveOn(url, op) {
  try {
    return new URL(url, op.request?.url || op.open).href;
  } catch {
    return url;
  }
}

const kind = (op) => (op.chain ? "a chain op" : "a run-list op");

const readPath = (value, path) => path.replace(/\[(\d+)\]/g, ".$1").split(".").reduce((at, key) => at?.[key], value);

// A chain input left unset leaves the value out; an item or step path must find a value.
function fill(value, scope, inputs) {
  if (typeof value !== "string") return value;
  const read = (path) => {
    const found = readPath(scope, path);
    if (found === undefined && !Object.hasOwn(inputs, path)) throw new Error(`{{${path}}} has no value`);
    return found;
  };
  const exact = value.match(/^\{\{([^{}]+)\}\}$/);
  return exact ? read(exact[1]) : value.replace(/\{\{([^{}]+)\}\}/g, (_, path) => String(read(path) ?? ""));
}

/** Runs `op.chain`; `options` are runOp's (the tab, the cookie reader, sleep, events). */
async function runChain({ playbook, op, args, sleep = async () => {}, ...options }) {
  op.chain.forEach((step, index) => {
    const target = playbook.ops.get(step.op);
    if (!target) throw new Error(`chain ${op.id} step ${step.id} names op ${step.op}, which ${playbook.id} doesn't have`);
    if (!target.request && !target.open) throw new Error(`chain ${op.id} step ${step.id} runs ${step.op}, ${kind(target)}; a step runs an op with request or open`);
    if (step.each !== undefined && !op.chain.slice(0, index).some((earlier) => earlier.id === step.each)) throw new Error(`chain ${op.id} step ${step.id}: each names no earlier step: ${step.each}`);
  });
  const results = {};
  const steps = [];
  let runs = 0;
  for (const step of op.chain) {
    const target = playbook.ops.get(step.op);
    const sourceOp = step.each === undefined ? step.op : op.chain.find((earlier) => earlier.id === step.each).op;
    let via;
    const once = async (item, label) => {
      try {
        if (++runs > MAX_RUNS) throw new Error(`a chain run makes at most ${MAX_RUNS} op runs`);
        const scope = { ...args, ...results, ...(item === undefined ? {} : { item }) };
        const given = Object.fromEntries(Object.entries(step.with || {}).map(([name, value]) => [name, fill(value, scope, op.args || {})]).filter(([, value]) => value !== undefined));
        // A relative url (a JSON path such as /item/3) is on the site of the op that returned it.
        if (typeof given.url === "string" && !URL.canParse(given.url)) given.url = resolveOn(given.url, playbook.ops.get(sourceOp));
        const result = await runOp({ ...options, sleep, playbook, op: target, ...stepInputs(playbook, target, given) });
        via = result.via;
        return result.value;
      } catch (error) {
        throw new Error(`chain ${op.id} step ${step.id} (${step.op})${label}: ${error.message}`);
      }
    };
    if (step.each === undefined) {
      results[step.id] = await once(undefined, "");
      steps.push({ id: step.id, op: step.op, runs: 1, via });
      continue;
    }
    const records = results[step.each];
    if (!Array.isArray(records)) throw new Error(`chain ${op.id} step ${step.id}: step ${step.each} returned no list to loop over`);
    const limit = Number(fill(step.limit ?? 10, args, op.args || {}) ?? 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RUNS) throw new Error(`chain ${op.id} step ${step.id}: limit must be a whole number from 1 to ${MAX_RUNS}`);
    const value = [];
    for (const [index, item] of records.slice(0, limit).entries()) {
      await sleep(step.delayMs ?? 1000);
      value.push(await once(item, `, record ${index + 1}`));
    }
    results[step.id] = value.flat();
    steps.push({ id: step.id, op: step.op, runs: value.length, via });
  }
  return { status: "completed", playbook: playbook.id, op: op.id, via: "chain", value: results[op.chain.at(-1).id], steps, provenance: playbook.provenance };
}

module.exports = { eachChain, runChain, stepInputs };
