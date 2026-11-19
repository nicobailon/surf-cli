// One pipeline makes an op: capture → pick → inputs → extract → test → save. `surf hook` captures
// the URL it opens (captureHook); `pb record stop` hands over its record's capture. makeOp does the
// rest, and saves only an op whose test passed.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { inferResponse, keyFields } = require("./op-infer.cjs");
const { nameInputs, requestOf } = require("./op-inputs.cjs");
const { matchHint, pickRequest, rankRequests } = require("./op-rank.cjs");
const { evaluate, runOp, sendRequest } = require("./op-run.cjs");
const { savePlaybook, validateOp } = require("./playbooks.cjs");
const { executeWorkflow } = require("./workflow-runtime.cjs");

const PAGE_TEXT = "({ url: location.href, text: document.body ? document.body.innerText : '' })";
const TRACE_LIMIT = 500;
// Between the requests the pipeline sends a site (the page, the replay, the test), as paging does.
const GAP_MS = 1000;
// Bodies the capture keeps for ranking: a whole large page, not the 64 KB a record keeps.
const BODY_BYTES = 2 * 1024 * 1024;

/** What the tab shows now: { url, text }. */
const readPage = (context) => evaluate(context, PAGE_TEXT);

async function runSteps(steps, context) {
  const result = await executeWorkflow(steps, { autoWait: true, stepDelay: 100, executeTool: context.executeTool, signal: context.signal, sleep: context.sleep, onEvent: context.onEvent });
  if (result.status !== "completed") throw new Error(result.error || "a step failed");
}

/** Opens `url` with network capture on and runs `steps`: { entries, pageUrl, pageText, after? }. */
async function captureHook({ url, steps = [], tabId, ...context }) {
  await context.callExtension({ type: "START_NETWORK_CAPTURE", tabId, bodyMode: "text", perBodyBytes: BODY_BYTES, totalBodyBytes: 8 * BODY_BYTES });
  try {
    await runSteps([{ cmd: "navigate", args: { url } }], context);
    const after = steps.length > 0 ? Date.now() : undefined;
    if (after) await runSteps(steps, context);
    await context.executeTool("wait.network", { timeout: 5000 }).catch(() => {});
    const page = await readPage(context);
    const read = await context.callExtension({ type: "READ_NETWORK_REQUESTS", tabId, full: true, limit: TRACE_LIMIT });
    return { entries: read.entries || [], pageUrl: page.url, pageText: page.text, ...(after ? { after } : {}) };
  } finally {
    await context.callExtension({ type: "STOP_NETWORK_CAPTURE", tabId }).catch(() => {});
  }
}

// Saves into ~/.surf/playbooks/<site>, adding the op's origin to the site's playbook.json.
function save(site, op) {
  let manifest = { id: site, version: "1.0.0", origins: [] };
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".surf", "playbooks", site, "playbook.json"), "utf8"));
  } catch {}
  manifest.origins = [...new Set([...(manifest.origins || []), new URL(op.request.url).origin])];
  const saved = savePlaybook({ manifest, op });
  return path.join(saved.directory, "ops", `${op.id}.json`);
}

/**
 * Picks the capture's data request, names its inputs, infers its extract from a replay, tests the
 * op through the runner and saves it. Returns { status, exitCode }: saved 0, weak 2 (with the top
 * candidates and a `match` that picks the first), or error 1 (with the draft once there is one).
 */
async function makeOp({ capture, goal = "", samples = {}, typed = [], template, match, site, op: id, ...context }) {
  const ranked = rankRequests(capture.entries, { pageUrl: capture.pageUrl, pageText: capture.pageText, goal, after: capture.after });
  const chosen = pickRequest(ranked, { match });
  if (chosen.error) return { status: "error", exitCode: 1, error: chosen.error };
  if (chosen.weak) {
    const candidates = ranked.slice(0, 3).map(({ entry, score, reasons }) => ({ method: entry.method, url: entry.url, score, reasons }));
    return { status: "weak", exitCode: 2, reason: chosen.weak, candidates, match: matchHint(ranked) };
  }
  const { entry, reasons, effect } = chosen.pick;
  const sent = requestOf(entry);
  const named = nameInputs({ request: sent, samples, typed, template });
  const draft = { id, description: goal || `${id} on ${new URL(sent.url).host}`, args: named.args, request: named.request };
  const base = { playbook: site, op: id, picked: { method: entry.method, url: entry.url, reasons }, warnings: named.warnings };
  if (effect === "write") {
    // Never sent again: the draft's extract comes from the captured response.
    let found;
    try { found = entry.responseBody && inferResponse({ body: entry.responseBody, contentType: entry.mimeType, url: entry.url }); } catch {}
    const error = `refused: ${entry.method} ${sent.url} can change data; surf hook saves reads only. If it only searches, save the draft below with "effect": "read" and run surf pb test`;
    return { ...base, status: "error", exitCode: 1, error, draft: { ...draft, effect: "write", ...(found ? { extract: found.extract } : {}) } };
  }
  try {
    await context.sleep(GAP_MS);
    const response = await sendRequest({ request: sent, ...context });
    if (response.status >= 400) throw new Error(`replaying ${sent.url} answered ${response.status}`);
    const found = inferResponse(response, { detail: named.detail });
    if (!found) throw new Error(`found no records or fields in the response of ${sent.url}`);
    draft.extract = found.extract;
    if (named.paging) draft.page = { into: named.paging.name, next: named.paging.next === "+count" ? `+${found.count ?? 1}` : named.paging.next };
    const examples = Object.fromEntries(Object.entries(draft.args).map(([name, spec]) => [name, spec.example]));
    await context.sleep(GAP_MS);
    const run = await runOp({ playbook: { id: site }, op: validateOp(draft, { origins: [] }), args: examples, ...context });
    const list = Array.isArray(run.value);
    const first = list ? run.value[0] : run.value;
    const fields = keyFields(found).filter((name) => ![undefined, null, ""].includes(first?.[name]));
    if (fields.length === 0) throw new Error(`the test run read no record with ${keyFields(found).join(" or ")}`);
    draft.expect = { ...(list ? { minItems: 1 } : {}), fields };
    const file = save(site, draft);
    const test = { via: run.via, count: list ? run.value.length : null, fields };
    return { ...base, status: "saved", exitCode: 0, file, args: draft.args, extract: draft.extract, page: draft.page, test, run: ["surf", "use", site, id, ...Object.entries(examples).flatMap(([name, value]) => [`--${name}`, String(value)])] };
  } catch (error) {
    return { ...base, status: "error", exitCode: 1, error: error.message, draft };
  }
}

module.exports = { captureHook, makeOp, readPage };
