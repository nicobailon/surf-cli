const fs = require("fs");
const path = require("path");
const { isDeepStrictEqual } = require("util");
const { readRecent } = require("./activity-journal.cjs");
const { writeNetworkExport } = require("./network-export.cjs");
const { getPrivateStateRoot, readPrivateJson } = require("./private-state.cjs");
const { REVIEW_KEY_ARG, buildDraft, draftFromRecord, neverReplayed, readRecord, recordedSteps, recordsRoot, requestFromEntry } = require("./playbook-records.cjs");
const { escapeStepArgs } = require("./playbook-template.cjs");
const { isCommitWorkflow, savePlaybook, validateOp } = require("./playbooks.cjs");
const { isTelemetryRequest, requestEffect, shownUrl } = require("./request-kinds.cjs");
const { commandMetadata, normalizeStep, promoteRedactedStepArgs } = require("./workflow-definition.cjs");

function suggestions({ since = "1h", root } = {}) {
  const events = readRecent({ since, root });
  const counts = new Map();
  for (const event of events.filter((entry) => entry.type === "tool.issued")) counts.set(event.command, (counts.get(event.command) || 0) + 1);
  return [...counts.entries()].map(([command, count]) => ({ command, count })).sort((a, b) => b.count - a.count || a.command.localeCompare(b.command));
}

function saveFromRecent({ site, op: opId, since = "1h", scope = "user", cwd, home, root }) {
  const events = readRecent({ since, root }).filter((event) => event.type === "tool.issued");
  if (events.length === 0) throw new Error("no recent Surf activity to save");
  if (events.some((event) => ["page-write", "unknown"].includes(commandMetadata(event.command, event.argsRedacted).effect))) {
    throw new Error("recent activity includes write-capable commands; use an explicit record (with --network, so its requests show whether the flow writes) and review its draft before saving");
  }
  // Escaped as a record's steps are, so a literal like `%{term}` in a selector isn't filled from an input.
  const promoted = promoteRedactedStepArgs(events.map((event) => ({ tool: event.command, args: escapeStepArgs(event.argsRedacted || {}) })));
  const op = { id: opId, description: "Drafted from recent Surf activity", effect: "read", args: promoted.args, run: [{ using: "workflow", steps: promoted.steps }], provenance: { recentSince: since } };
  validateOp(op, { origins: [] });
  return savePlaybook({ manifest: { id: site, name: site, version: "1.0.0", origins: [] }, op, scope, cwd, home });
}

function capturedWrites(record, trace) {
  return (trace?.entries || []).filter((entry) => requestEffect(entry) === "write" && !isTelemetryRequest(entry, record.origin));
}

// A write op's network strategy replays a write on the record's page origin, unless --request-id
// (at stop or at save, `chosen`) names it. Origins are compared exactly: a host's last labels
// don't make a site (alice.github.io and bob.github.io are different sites).
function firstPartyWrite({ record, entry, chosen, request, fail }) {
  const sent = `${request.method} ${request.url}`;
  const page = originOf(record.origin || entry?.tabUrl);
  const origin = originOf(request.url);
  if (origin !== page && !(chosen && entry?.id === chosen)) {
    throw fail(`it would replay ${sent}, whose origin (${origin}) isn't the record's page origin (${page || "unknown"}); name it with --request-id ${entry?.id ?? "<r_…>"} to replay it anyway`);
  }
}

// The request an op's network strategy sends.
function replayedRequest(op) {
  return op.run.find((strategy) => strategy.using === "network")?.request;
}

// The strategies a draft is made of: an op saved from a record holds no other kind.
const DRAFTED_KINDS = new Set(["network", "workflow"]);
// A network strategy's fields that don't change what it sends.
const KEPT_FIELDS = ["extract", "verify", "expect", "acceptStatus"];
const PLACEHOLDER = /\{\{[a-zA-Z0-9._-]+\}\}/g;

// An op saved from a record replays a write only as the record captured it: every network write
// is rebuilt from the trace entry it stands for (the one --request-id names, else the only one
// captured), so what the draft file says about its method, URL, query, headers or body is never
// sent. The write must be one the draft builder replays, in a write op, on the record page's
// origin unless --request-id names it (`chosen`: pb save's, else the one pb record stop kept in the
// record, never the draft's provenance). The strategies decide, not the op's workflow: none (a
// record with no steps), a one-click fallback (its network strategy runs before the click), or one
// fitWriteWorkflow drops. A read op never replays a write: the record of a read captured none.
// holdEffect has rebuilt the reads. pb param makes inputs after save, on the saved op.
function rebuildWrites(op, { record, trace, chosen }) {
  const write = op.effect === "write";
  const workflow = op.run.find((strategy) => strategy.using === "workflow");
  const networkOnly = write && !(workflow && isCommitWorkflow(workflow.steps.map(normalizeStep)));
  const fail = (why) => new Error(`${write ? "write op" : "op"} ${op.id} can't be saved${networkOnly ? " network-only" : ""}: ${why}`);
  // validateOp refuses a strategy that isn't an object, or a network one without request.url.
  const other = op.run.find((strategy) => strategy && typeof strategy === "object" && !DRAFTED_KINDS.has(strategy.using));
  if (other) throw fail(`an op saved from a record runs only network and workflow strategies, and this draft has a ${other.using} strategy`);
  const writes = capturedWrites(record, trace);
  const run = op.run.map((strategy) => {
    if (strategy?.using !== "network" || typeof strategy.request?.url !== "string") return strategy;
    const method = strategy.request.method.toUpperCase();
    if (requestEffect({ method }) !== "write") return strategy;
    const url = absoluteUrl(strategy.request.url, record.origin);
    if (!url) throw fail(`its network write's URL (${strategy.request.url}) isn't a URL`);
    const sent = shownUrl({ method, url });
    const uncaptured = () => fail(`it would replay ${sent}, which isn't a write the record captured`);
    // holdEffect has made a read op's effect the record's, so its record captured no write.
    if (!write) throw uncaptured();
    if (!chosen && writes.length > 1) {
      const listed = writes.map((entry) => `${entry.id} ${shownUrl(entry)}`).join(", ");
      throw fail(`the record captured ${writes.length} writes (${listed}); name the one the op replays with pb save --from-record <id> --request-id <r_…>`);
    }
    const entry = chosen ? writes.find((candidate) => candidate.id === chosen) : writes[0];
    if (!entry || shownUrl(entry) !== sent) throw uncaptured();
    const never = neverReplayed(entry, record.origin);
    if (never) throw fail(`it would replay ${sent}, ${never}`);
    const request = requestFromEntry(entry);
    const captured = JSON.stringify(request);
    const placeholder = JSON.stringify(strategy.request).match(PLACEHOLDER)?.find((found) => !captured.includes(found));
    if (placeholder) throw fail(`its network write ${sent} holds ${placeholder}, and a write is saved as the record captured it; save it as drafted, then make the input with surf pb param`);
    firstPartyWrite({ record, entry, chosen, request, fail });
    return { using: "network", request, ...keptFields(strategy) };
  });
  return { ...op, run };
}

const keptFields = (strategy) => Object.fromEntries(KEPT_FIELDS.filter((field) => strategy[field] !== undefined).map((field) => [field, strategy[field]]));

// What the record decides about an op, which a draft can't change: its effect (the draft
// builder's, with --read when pb record stop had it), its safety, that it replays the request the
// record drafts, and that request itself when it is a read. Every network strategy that sends a
// read (or no method) is rebuilt from the request the builder drafts (the one --request-id names,
// else its pick), so the draft's method, URL, query, headers or body are never sent; rebuildWrites
// does the same for writes. `because` says why the record drafts a write.
function holdEffect(op, { reference, because, record }) {
  const fail = (why) => new Error(`${op.effect === "write" ? "write op" : "op"} ${op.id} can't be saved: ${why}`);
  if ((op.effect ?? "read") !== reference.effect) {
    const given = op.effect === undefined ? "missing" : JSON.stringify(op.effect);
    throw fail(`the record drafts a ${reference.effect} op${because && reference.effect === "write" ? ` (${because})` : ""}, and the draft's effect is ${given}; a draft can't change an op's effect`);
  }
  if (!isDeepStrictEqual(op.safety, reference.safety)) {
    const drafted = reference.safety ? `its safety is drafted as ${JSON.stringify(reference.safety)}` : "the record drafts no safety";
    throw fail(`${drafted}, and a draft can't change it; change it on the saved op`);
  }
  const replayed = reference.run.find((strategy) => strategy.using === "network")?.request;
  const drafts = replayed ? `the record drafts ${shownUrl(replayed)}` : "the record drafts no network strategy";
  const networks = op.run.filter((strategy) => strategy?.using === "network");
  if (replayed && networks.length === 0) {
    throw fail(`it drops the network strategy the record drafts (${shownUrl(replayed)}); a draft holds the record's strategies`);
  }
  const run = op.run.map((strategy) => {
    if (strategy?.using !== "network" || typeof strategy.request?.url !== "string") return strategy;
    const { method } = strategy.request;
    if (typeof method !== "string" || !method) {
      throw fail(`its network strategy has no method, and ${replayed ? `a draft keeps the method the record captured (${shownUrl(replayed)})` : "the record drafts no network strategy"}`);
    }
    if (requestEffect({ method: method.toUpperCase() }) === "write") return strategy;
    const url = absoluteUrl(strategy.request.url, record.origin);
    const sent = url ? shownUrl({ method: method.toUpperCase(), url }) : `${method} ${strategy.request.url}`;
    if (!replayed) throw fail(`its network strategy sends ${sent}, and ${drafts}`);
    if (sent !== shownUrl(replayed)) {
      throw fail(`its network strategy sends ${sent}, and ${drafts}; save again with --request-id <r_…> to replay another captured request`);
    }
    return { using: "network", request: replayed, ...keptFields(strategy) };
  });
  return { ...op, run };
}

// The record decides which strategies run, in what order and how many: a draft that put the click
// first would send it instead of the captured request, and one that ran the request twice would
// send it again when a check failed. Held after the other checks, so a strategy they refuse is
// named first; fitWriteWorkflow may drop the workflow afterwards, as it would the record's own.
function holdStrategies(op, reference) {
  const kinds = (strategies) => strategies.map((strategy) => strategy?.using).join(", then ");
  if (kinds(op.run) !== kinds(reference.run)) {
    throw new Error(`${op.effect === "write" ? "write op" : "op"} ${op.id} can't be saved: its strategies are ${kinds(op.run)}, and the record drafts ${kinds(reference.run)}; a draft can't change which strategies run, their order or how many there are`);
  }
  return op;
}

// The origins an op saved from a record sends to are the record's (allowedOrigins); a draft may
// write them out, not change them.
function holdOrigins(op, origins) {
  const same = (op.origins === undefined || isDeepStrictEqual(op.origins, origins)) && (op.auth === undefined || isDeepStrictEqual(op.auth, { origins }));
  if (!same) throw new Error(`${op.effect === "write" ? "write op" : "op"} ${op.id} can't be saved: its origins come from the record (${origins.join(", ")}), and a draft can't change them`);
}

// An op saved from a record runs the steps the record ran, rebuilt from the record as
// draftFromRecord makes them, so what the draft file says about a step or its arguments is never
// run: a step no record holds (js, javascript_tool, frame.js or any other unrecordable tool, at any
// depth), a loop, or steps other than the record's are refused. The workflow keeps only
// KEPT_FIELDS. `rebuild` then holds the op's inputs, once rebuildWrites has refused a write the
// effect doesn't allow: they are the ones the record drafts, and review_key for a write. A draft
// may describe an input (desc), not add one or change what it takes. pb param and --link make
// inputs after save, on the saved op.
function holdToRecord(op, { steps }) {
  const fail = (why) => new Error(`${op.effect === "write" ? "write op" : "op"} ${op.id} can't be saved: ${why}`);
  const recorded = promoteRedactedStepArgs(steps);
  const rebuild = (rebuilt) => ({ ...rebuilt, args: draftedArgs(rebuilt, recorded.args, fail) });
  const workflows = op.run.filter((strategy) => strategy?.using === "workflow");
  if (workflows.length > 1) throw fail(`it has ${workflows.length} workflow strategies, and a record drafts one`);
  if (workflows.length === 1) checkWorkflow(workflows[0], steps, fail);
  const run = op.run.map((strategy) => {
    if (strategy?.using !== "workflow") return strategy;
    return { using: "workflow", steps: recorded.steps, ...keptFields(strategy) };
  });
  return { op: { ...op, run }, rebuild };
}

const UNRECORDED = "an op saved from a record runs only the steps the record ran";

function checkWorkflow(workflow, steps, fail) {
  const ran = [];
  let loop = false;
  const visit = (step) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) throw fail(`its workflow holds ${JSON.stringify(step)}, which isn't a step`);
    if (step.steps !== undefined || step.repeat !== undefined || step.each !== undefined) {
      loop = true;
      for (const inner of Array.isArray(step.steps) ? step.steps : []) visit(inner);
      if (step.until) visit(step.until);
      return;
    }
    const tool = step.tool ?? step.cmd;
    const metadata = commandMetadata(String(tool));
    if (!metadata.recordable) throw fail(`its workflow runs ${tool}, a step no record holds; ${UNRECORDED}`);
    ran.push(metadata.name);
  };
  for (const step of Array.isArray(workflow.steps) ? workflow.steps : []) visit(step);
  if (loop) throw fail(`its workflow repeats steps in a loop, and a record holds no loop; ${UNRECORDED}`);
  const expected = steps.map((step) => commandMetadata(step.tool).name);
  if (expected.length === 0 || !isDeepStrictEqual(ran, expected)) {
    throw fail(`its workflow runs ${ran.join(" + ") || "no steps"}, and the record ran ${expected.join(" + ") || "no steps"}; ${UNRECORDED}`);
  }
}

// The inputs the draft builder makes (the review key when the steps make none), with the draft's
// descriptions. A write may also take review_key.
function draftedArgs(op, recorded, fail) {
  const write = op.effect === "write";
  const drafted = write && Object.keys(recorded).length === 0 ? { ...recorded, review_key: REVIEW_KEY_ARG } : recorded;
  const allowed = write ? { ...drafted, review_key: REVIEW_KEY_ARG } : drafted;
  const args = { ...drafted };
  for (const [name, spec] of Object.entries(op.args ?? {})) {
    if (!Object.hasOwn(allowed, name)) {
      throw fail(`its input ${name} isn't one the record drafts (${Object.keys(allowed).join(", ") || "none"}); make inputs after save with surf pb param`);
    }
    const { desc, ...given } = spec && typeof spec === "object" ? spec : { invalid: spec };
    const { desc: _desc, ...expected } = allowed[name];
    if (!isDeepStrictEqual(given, expected)) throw fail(`its input ${name} is drafted as ${JSON.stringify(expected)}, and a draft may change only an input's desc`);
    args[name] = { ...allowed[name], ...(desc !== undefined ? { desc } : {}) };
  }
  return args;
}

// A relative network URL is sent from the page, so it is read against the record's origin.
function absoluteUrl(url, origin) {
  try { return new URL(url, origin || undefined).href; } catch { return ""; }
}

function originOf(url) {
  try { return new URL(url).origin; } catch { return ""; }
}

// A write draft whose workflow can't be its fallback (a navigate first, or a type and a click)
// saves with its network strategy alone when that replays the site's own captured write. The
// workflow's inputs go with it, and the review key takes their place as the safety key when none
// is left. A one-click draft keeps its workflow. rebuildWrites has already rebuilt the write.
function fitWriteWorkflow(op, warnings) {
  const workflow = op.effect === "write" && op.run.find((strategy) => strategy.using === "workflow");
  if (!workflow) return op;
  const steps = workflow.steps.map(normalizeStep);
  if (isCommitWorkflow(steps)) return op;
  const request = replayedRequest(op);
  const why = `a write op's workflow fallback must be one page-write step, and this draft's is ${steps.map((step) => step.cmd).join(" + ")}`;
  if (!request) {
    throw new Error(`write op ${op.id} can't be saved: ${why}, and the draft has no network strategy to replay the write instead. Record the write as a single click, or start the record with --network so the draft can replay its request`);
  }
  const shown = shownUrl(request);
  if (requestEffect(request) !== "write") throw new Error(`write op ${op.id} can't be saved: ${why}, and its network strategy replays ${shown}, a read, not the write`);
  warnings.push(`saved network-only: ${why}, so the op replays ${shown} alone`);
  const run = op.run.filter((strategy) => strategy !== workflow);
  const used = JSON.stringify(run);
  const args = Object.fromEntries(Object.entries(op.args || {}).filter(([name]) => used.includes(`{{${name}}}`)));
  let key = op.safety.key.filter((name) => Object.hasOwn(args, name));
  if (key.length === 0) {
    key = ["review_key"];
    args.review_key = op.args?.review_key ?? REVIEW_KEY_ARG;
  }
  return { ...op, args, safety: { ...op.safety, key }, run };
}

// The origins an op saved from a record may send to: the page the record ran on, and the request
// its network strategy replays (an API on another host, as api.resy.com for resy.com). Other
// captured origins stay out.
// A replayed request on another origin than the page (an api. host, a CDN's JSON) is allowed with a
// warning, so a wrong pick shows.
function allowedOrigins(record, op, warnings) {
  const request = op.run.find((strategy) => strategy.using === "network")?.request;
  const replayed = request && new URL(request.url).origin;
  if (replayed && record.origin && replayed !== originOf(record.origin)) {
    warnings.push(`the op may also send to ${replayed}, the origin of the request it replays (${shownUrl(request)}), which isn't the origin of the record's page (${record.origin}); if that is the wrong request, save again with --request-id <r_…> from pb record candidates`);
  }
  return [...new Set([record.origin, replayed].filter(Boolean))];
}

// The record decides what the saved op sends and whether it needs --write; the draft file names
// and describes it. `requestId` redrafts the op to replay that request, a read when pb record stop
// had --read (its checks rerun).
function saveFromRecord({ recordId, requestId, scope = "user", cwd, home, root = getPrivateStateRoot() }) {
  const record = readRecord(recordId, root);
  if (!record) throw new Error(`record not found: ${recordId}`);
  const draftPath = path.join(recordsRoot(root), recordId, "draft", "op.json");
  const draft = fs.existsSync(draftPath) ? readPrivateJson(draftPath, null, { root }) : null;
  const warnings = [];
  const chosen = requestId ?? record.requestId;
  const read = record.read === true;
  const drafted = draft && !requestId ? draft : draftFromRecord(recordId, root, { read, requestId: chosen, warnings });
  const { op: reference, because } = buildDraft(record, { read, requestId: chosen, root });
  const trace = readPrivateJson(path.join(recordsRoot(root), recordId, "network", "trace.json"), null, { root });
  const held = holdToRecord(holdEffect(drafted, { reference, because, record }), { steps: recordedSteps(recordId, root) });
  const provenance = { recordId: record.id, ...(chosen ? { requestId: chosen } : {}) };
  const rebuilt = held.rebuild(rebuildWrites({ ...held.op, provenance }, { record, trace, chosen }));
  const op = fitWriteWorkflow(holdStrategies(rebuilt, reference), warnings);
  const origins = allowedOrigins(record, op, warnings);
  holdOrigins(op, origins);
  validateOp(op, { origins });
  const saved = savePlaybook({ manifest: { id: record.site, name: record.site, version: "1.0.0", origins }, op, scope, cwd, home });
  return { ...saved, origins, ...(warnings.length > 0 ? { warnings } : {}) };
}

function exportRecordHar(recordId, output, root = getPrivateStateRoot()) {
  const trace = readPrivateJson(path.join(recordsRoot(root), recordId, "network", "trace.json"), null, { root });
  if (!trace) throw new Error(`record ${recordId} has no network trace`);
  return writeNetworkExport(path.resolve(output), trace.entries, "har");
}

module.exports = { exportRecordHar, saveFromRecent, saveFromRecord, suggestions };
