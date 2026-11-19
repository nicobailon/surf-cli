// One pipeline makes an op: capture → pick → inputs → extract → test → save. `surf hook` captures
// the URL it opens (captureHook); `pb record stop` hands over its record's capture. makeOp does the
// rest, and saves only an op whose test passed; a write (a POST etc.) is saved untested. Self-repair
// (runWithRepair) runs it again on an op's `source` when the site has changed under the op.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { shell } = require("./hook-cli.cjs");
const { inferResponse, keyFields } = require("./op-infer.cjs");
const { isSecret, nameInputs, requestOf } = require("./op-inputs.cjs");
const { matchHint, pickRequest, rankRequests } = require("./op-rank.cjs");
const { evaluate, renderTemplate, runOp, sendRequest } = require("./op-run.cjs");
const { savePlaybook, validateOp } = require("./playbooks.cjs");
const { atomicWriteJson } = require("./private-state.cjs");
const { redactUrlSecrets } = require("./redaction.cjs");
const { parseDoCommands } = require("./workflow-definition.cjs");
const { executeWorkflow } = require("./workflow-runtime.cjs");

const PAGE_TEXT = "({ url: location.href, text: document.body ? document.body.innerText : '' })";
const TRACE_LIMIT = 500;
// Between the requests the pipeline sends a site (the page, the replay, the test), as paging does.
const GAP_MS = 1000;
// A goal that starts with a write verb: "submit the order", "order a book", not "order history".
// Words that are nouns too (order, book, post, comment) count as verbs only before an object.
const WRITE_VERB = /^\s*(?:(?:send|submit|create|add|reply|update|delete|remove|save|register|subscribe|buy|pay|upload|edit|vote)\b|(?:order|book|post|comment)\s+(?:a|an|the|my|our|this|that|it|one|some|on)\b)/i;
// A URL as Chrome writes it (https://a.test → https://a.test/), without its fragment.
const withoutHash = (url) => (URL.canParse(url) ? new URL(url).href : String(url || "")).replace(/#.*$/, "");
// Bodies the capture keeps for ranking: a whole large page, not the 64 KB a record keeps.
const BODY_BYTES = 2 * 1024 * 1024;

/** What the tab shows now: { url, text }. */
const readPage = (context) => evaluate(context, PAGE_TEXT);

async function runSteps(steps, context) {
  const result = await executeWorkflow(steps, { autoWait: true, stepDelay: 100, executeTool: context.executeTool, signal: context.signal, sleep: context.sleep, onEvent: context.onEvent });
  if (result.status !== "completed") throw new Error(result.error || "a step failed");
}

/** Opens `url` with network capture on and runs `steps`: { entries, opened, pageUrl, pageText, after? }. */
async function captureHook({ url, steps = [], tabId, ...context }) {
  await context.callExtension({ type: "START_NETWORK_CAPTURE", tabId, bodyMode: "text", perBodyBytes: BODY_BYTES, totalBodyBytes: 8 * BODY_BYTES });
  try {
    await runSteps([{ cmd: "navigate", args: { url } }], context);
    const after = steps.length > 0 ? Date.now() : undefined;
    if (after) await runSteps(steps, context);
    await context.executeTool("wait.network", { timeout: 5000 }).catch(() => {});
    const page = await readPage(context);
    const read = await context.callExtension({ type: "READ_NETWORK_REQUESTS", tabId, full: true, limit: TRACE_LIMIT });
    return { entries: read.entries || [], opened: url, pageUrl: page.url, pageText: page.text, ...(after ? { after } : {}) };
  } finally {
    await context.callExtension({ type: "STOP_NETWORK_CAPTURE", tabId }).catch(() => {});
  }
}

// Saves into ~/.surf/playbooks/<site>, adding the op's origin to the site's playbook.json, and
// keeps an op it replaces as <op>.json.bak (one slot: an older .bak is overwritten). It checks the op
// first, so a failed save touches nothing; with dryRun it only checks.
function save(site, op, dryRun) {
  const directory = path.join(os.homedir(), ".surf", "playbooks", site);
  const file = path.join(directory, "ops", `${op.id}.json`);
  let manifest = { id: site, version: "1.0.0", origins: [] };
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(directory, "playbook.json"), "utf8"));
  } catch {}
  manifest.origins = [...new Set([...(manifest.origins || []), new URL(op.request.url).origin])];
  validateOp(op, manifest);
  const replaced = fs.existsSync(file);
  const overwritesBak = replaced && fs.existsSync(`${file}.bak`);
  if (!dryRun) {
    if (replaced) fs.copyFileSync(file, `${file}.bak`);
    savePlaybook({ manifest, op });
  }
  return { file, replaced, overwritesBak };
}

/**
 * Picks the capture's data request, names its inputs, infers its extract from a replay, tests the
 * op through the runner and saves it. Returns { status, exitCode }: saved 0, weak 2 (with the top
 * candidates and a `match` that picks the first), or error 1 (with the draft once there is one). With dryRun it
 * saves nothing and returns status "dry-run", exit 0, with the draft it would save.
 */
async function makeOp({ capture, goal = "", samples = {}, typed = [], template, match, site, op: id, source, previous, dryRun = false, ...context }) {
  const ranked = rankRequests(capture.entries, { pageUrl: capture.pageUrl, pageText: capture.pageText, goal, after: capture.after });
  const chosen = pickRequest(ranked, { match });
  if (chosen.error) {
    // Nothing to pick, and the page itself answered an error (a 404 or 500) or failed to load: say so.
    // The page is the URL the hook opened, or the tab's, unless that is Chrome's error page.
    const pages = [capture.opened, /^chrome-error:/.test(capture.pageUrl) ? undefined : capture.pageUrl].filter(Boolean).map(withoutHash);
    const page = ranked.length === 0 && capture.entries.find((entry) => (entry.status >= 400 || entry.flags?.includes("failed")) && pages.includes(withoutHash(entry.url)));
    const why = page && (page.status >= 400 ? `answered ${page.status}` : `failed to load${page.errorText ? ` (${page.errorText})` : ""}`);
    const error = why ? `${redactUrlSecrets(page.url)} ${why}, so the capture holds no request to pick; check the URL, or add --do steps that load the data` : chosen.error;
    return { status: "error", exitCode: 1, error };
  }
  if (chosen.weak) {
    const candidates = ranked.slice(0, 3).map(({ entry, score, reasons }) => ({ method: entry.method, url: entry.url, score, reasons }));
    return { status: "weak", exitCode: 2, reason: chosen.weak, candidates, match: matchHint(ranked) };
  }
  const { entry, reasons, effect } = chosen.pick;
  const sent = requestOf(entry);
  const named = nameInputs({ request: sent, samples, typed, template });
  // A read keeps its source, each typed value in `do` as its {{input}}. A write never repairs; a typed
  // value that is no input (a password the request doesn't carry) or a secret keeps the source out.
  let kept = effect === "write" ? undefined : source;
  for (const value of source?.do ? typed : []) {
    const name = Object.keys(named.args).find((key) => String(named.args[key].example) === value);
    kept = kept && name && !isSecret(name) ? { ...kept, do: kept.do.replaceAll(value, `{{${name}}}`) } : undefined;
  }
  if (source && !kept && effect !== "write") named.warnings.push("a --do step types a value that is no input, so the op keeps no source and can't repair itself");
  const draft = { id, description: goal || `${id} on ${new URL(sent.url).host}`, ...(effect === "write" ? { effect } : {}), args: named.args, request: named.request, ...(kept ? { source: kept } : {}) };
  const base = { playbook: site, op: id, picked: { method: entry.method, url: redactUrlSecrets(entry.url), reasons }, warnings: named.warnings };
  // The run line: each input's sample, or <name> for one with none (a secret).
  const runLine = (examples) => ["surf", "use", site, id, ...Object.entries(examples).flatMap(([name, value]) => [`--${name}`, value === undefined ? `<${name}>` : String(value)])];
  const examples = Object.fromEntries(Object.entries(draft.args).map(([name, spec]) => [name, spec.example]));
  const saved = (fields) => {
    return { ...base, status: dryRun ? "dry-run" : "saved", exitCode: 0, ...save(site, draft, dryRun), ...fields, ...(dryRun ? { draft } : {}) };
  };
  if (effect === "write") {
    if (previous) return { ...base, status: "error", exitCode: 1, error: `the new pick is a write (${entry.method} ${base.picked.url})` };
    // Saved untested, as a write is never sent again here: the extract comes from the captured response.
    try {
      const found = entry.responseBody && inferResponse({ body: entry.responseBody, contentType: entry.mimeType, url: entry.url });
      if (found) draft.extract = found.extract;
    } catch {}
    try {
      // The capture holds the write because the page, or the --do steps (when it came after them), sent it once.
      const sentBy = capture.after !== undefined && entry.ts >= capture.after ? "do" : "page";
      return saved({ args: draft.args, extract: draft.extract, test: null, sentBy, run: [...runLine(examples), "--write"] });
    } catch (error) {
      return { ...base, status: "error", exitCode: 1, error: error.message, draft };
    }
  }
  try {
    await context.sleep(GAP_MS);
    const response = await sendRequest({ request: sent, ...context });
    if (response.status >= 400) throw new Error(`replaying ${sent.url} answered ${response.status}`);
    const found = inferResponse(response, { detail: named.detail });
    // A write goal with no --do and no write captured: the form was never submitted.
    const submit = WRITE_VERB.test(goal) && !capture.after && !previous ? `; a form's POST is captured only when --do submits the form: --do 'type "…" --into "<css>" | click --selector "<css>"'` : "";
    if (!found) throw new Error(`found no records or fields in the response of ${sent.url}${submit}`);
    draft.extract = found.extract;
    if (named.paging) draft.page = { into: named.paging.name, next: named.paging.next === "+count" ? `+${found.count ?? 1}` : named.paging.next };
    if (previous) keepNames(draft, previous);
    await context.sleep(GAP_MS);
    const run = await runOp({ playbook: { id: site }, op: validateOp(draft, { origins: [] }), args: examples, ...context });
    const list = Array.isArray(run.value);
    const first = list ? run.value[0] : run.value;
    if (!previous) {
      const fields = keyFields(found).filter((name) => ![undefined, null, ""].includes(first?.[name]));
      if (fields.length === 0) throw new Error(`the test run read no record with ${keyFields(found).join(" or ")}`);
      draft.expect = { ...(list ? { minItems: 1 } : {}), fields };
    }
    const test = { via: run.via, count: list ? run.value.length : null, fields: draft.expect.fields || [] };
    const fields = { op: draft, args: draft.args, extract: draft.extract, page: draft.page, test, run: runLine(examples) };
    return previous ? { ...base, status: "saved", exitCode: 0, file: replaceOp(previous.file, draft), ...fields } : saved(fields);
  } catch (error) {
    return { ...base, status: "error", exitCode: 1, error: error.message, draft };
  }
}

// A rebuilt op keeps the old one's description, inputs (by name, with their specs) and expect, so
// its test run checks the old expect; a new field read by an old field's selector takes its name.
function keepNames(draft, previous) {
  const lost = Object.keys(previous.args || {}).find((name) => !draft.args[name]);
  if (lost) throw new Error(`the new request has no place for the input ${lost}`);
  const old = Object.entries(previous.extract?.fields || {});
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (draft.extract.fields) draft.extract.fields = Object.fromEntries(Object.entries(draft.extract.fields).map(([name, spec]) => [old.find(([was, before]) => same(before, spec) && !Object.hasOwn(draft.extract.fields, was))?.[0] ?? name, spec]));
  Object.assign(draft, { description: previous.description ?? draft.description, args: { ...draft.args, ...previous.args }, ...(previous.expect ? { expect: previous.expect } : {}) });
}

// Saves a rebuilt op over its file, the old one kept beside it as <op>.json.bak; a failed check
// touches neither.
function replaceOp(file, op) {
  validateOp(op, { origins: [] });
  fs.copyFileSync(file, `${file}.bak`);
  atomicWriteJson(file, op);
  return file;
}

// What a repair changed, in one line: the request, new inputs, the records selector and each field.
function changes(before, after) {
  const parts = [];
  if (JSON.stringify(before.request) !== JSON.stringify(after.request)) parts.push(`request ${after.request.url}`);
  const added = Object.keys(after.args).filter((name) => !before.args?.[name]);
  if (added.length) parts.push(`inputs ${added.map((name) => `+${name}`).join(", ")}`);
  if (before.extract?.records !== after.extract?.records) parts.push(`records ${before.extract?.records ?? "none"} → ${after.extract?.records ?? "none"}`);
  const [was, now] = [before.extract?.fields || {}, after.extract?.fields || {}];
  const fields = [...new Set([...Object.keys(was), ...Object.keys(now)])].filter((name) => JSON.stringify(was[name]) !== JSON.stringify(now[name]));
  if (fields.length) parts.push(`fields ${fields.map((name) => (!(name in now) ? `-${name}` : !(name in was) ? `+${name}` : name)).join(", ")}`);
  return parts.join("; ") || "nothing";
}

/**
 * Runs `run(op)`. When a read op made by surf hook or pb record stop fails on shape (its last step
 * got an answer without the records, or a 404 or 410), and fails so with its saved sample inputs
 * too, runs the pipeline again on its `source` with those samples, saves the rebuilt op if it passes
 * the old expect, and runs that with this call's inputs. `noRepair` names why not to. A write, a
 * call with --url, a 401, 403, 429, 5xx or network error never repairs.
 */
async function runWithRepair({ run, playbook, op, args, url: elsewhere, noRepair, tabId, ...context }) {
  try {
    return await run(op);
  } catch (error) {
    if (!error.shape || !op.source || op.effect === "write" || op.chain || op.run || elsewhere !== undefined) throw error;
    const { url, goal = op.description || op.id, do: steps, match } = op.source;
    // The inputs the op was made and tested with; this call's value for one it saved none of.
    const samples = Object.fromEntries(Object.entries(op.args || {}).map(([name, spec]) => [name, spec.example ?? spec.default ?? args[name]]).filter(([, value]) => value !== undefined));
    const flags = Object.entries(samples).flatMap(([name, value]) => [`--${name}`, String(value)]);
    const hook = `surf hook '${url.replace(/'/g, "'\\''")}' ${shell(["--goal", goal, ...(steps ? ["--do", steps] : []), ...(match ? ["--match", match] : []), ...flags, "--as", `${playbook.id}/${op.id}`])}`;
    if (noRepair) throw new Error(`${error.message}; ${playbook.id} ${op.id} no longer matches the site, not repaired (${noRepair}). Rebuild it: ${hook}`);
    // This call may just have no records (an empty search, a page past the end): the op is broken
    // only if its saved samples fail on shape too.
    const same = Object.entries(samples).every(([name, value]) => String(args[name]) === String(value));
    const check = same ? error : await run(op, samples).then(() => null, (failure) => failure);
    if (!check) throw new Error(`${error.message}; with its saved inputs (${flags.join(" ")}) it still reads records, so it was not repaired`);
    if (!check.shape) throw error;
    const file = path.join(playbook.directory, "ops", `${op.id}.json`);
    const before = JSON.parse(fs.readFileSync(file, "utf8"));
    const made = await captureHook({ url: renderTemplate(url, { args: samples, env: null, encode: encodeURIComponent }), steps: steps ? renderTemplate(parseDoCommands(steps), { args: samples, env: null }) : [], tabId, ...context })
      .then((capture) => makeOp({ capture, goal, samples, template: url, match, site: playbook.id, op: op.id, source: op.source, previous: { ...before, file }, ...context }))
      .catch((failure) => ({ error: failure.message }));
    if (made.status !== "saved") throw new Error(`${error.message}; repair failed: ${made.error || made.reason}. Rebuild it: ${hook}`);
    const result = await run(validateOp(made.op, playbook));
    return { ...result, repaired: `repaired ${playbook.id} ${op.id}: ${changes(before, made.op)} (the old op is ${op.id}.json.bak)` };
  }
}

module.exports = { captureHook, makeOp, readPage, runWithRepair, save };
