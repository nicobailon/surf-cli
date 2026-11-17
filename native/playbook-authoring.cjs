const fs = require("fs");
const path = require("path");
const { isDeepStrictEqual } = require("util");
const { readRecent } = require("./activity-journal.cjs");
const { writeNetworkExport } = require("./network-export.cjs");
const { getPrivateStateRoot, readPrivateJson } = require("./private-state.cjs");
const { buildDraft, DRAFT_SAFETY, draftFromRecord, readRecord, recordsRoot } = require("./playbook-records.cjs");
const { escapeStepArgs, requestInputs, sentRequest } = require("./playbook-template.cjs");
const { envBackedHeaders, savePlaybook, validateOp } = require("./playbooks.cjs");
const { requestEffect } = require("./request-kinds.cjs");
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
  // Escaped as a record's steps are, so a literal like `%{term}` in a selector isn't filled from an
  // input; provenance.escaped tells the runtime so (escapedOp).
  const promoted = promoteRedactedStepArgs(events.map((event) => ({ tool: event.command, args: escapeStepArgs(event.argsRedacted || {}) })));
  // A page write saves as a write that needs --write, with a drafted write's safety (DRAFT_SAFETY).
  const writes = events.some((event) => ["page-write", "unknown"].includes(commandMetadata(event.command, event.argsRedacted).effect));
  const effect = writes ? { effect: "write", safety: { ...DRAFT_SAFETY } } : { effect: "read" };
  const op = { id: opId, description: "Drafted from recent Surf activity", ...effect, args: promoted.args, run: [{ using: "workflow", steps: promoted.steps }], provenance: { recentSince: since, escaped: true } };
  validateOp(op, { origins: [] });
  return savePlaybook({ manifest: { id: site, name: site, version: "1.0.0", origins: [] }, op, scope, cwd, home });
}

// A relative network URL is sent from the page, so it is read against the record's origin.
function absoluteUrl(url, origin) {
  try { return new URL(url, origin || undefined).href; } catch { return ""; }
}

function originOf(url) {
  try { return new URL(url).origin; } catch { return ""; }
}

// The request an op's network strategy sends.
function replayedRequest(op) {
  return op.run.find((strategy) => strategy?.using === "network")?.request;
}

const shownRequest = (request) => (request ? `${String(request.method ?? "GET").toUpperCase()} ${request.url}` : "none");

// A write runs only its first strategy: after any failure it stops, as its next strategy could send
// it again. So a workflow after a network strategy never runs. When that request replays a write,
// the op is saved with its network strategy alone, and with only the inputs the request sends: a
// typing step's input would make each new value a new claim that sends the recorded body again.
// Which inputs are left is read from what the request sends, never from a draft's checks (extract,
// verify, expect) or the record's notes for pb param (redactedTypes). A declared safety key keeps
// the inputs left, and covers every input once none is. A workflow of one page-write step (a click,
// a type) keeps its steps and inputs. When the request is a read, the op is saved as drafted, with a
// warning.
function fitWriteWorkflow(op, warnings) {
  const [first] = op.run;
  const workflow = op.effect === "write" && first?.using === "network" && op.run.find((strategy) => strategy?.using === "workflow");
  if (!workflow || !Array.isArray(workflow.steps)) return op;
  const shown = shownRequest(first.request);
  const saved = workflow.steps.map(savedStep);
  const steps = shownSteps(saved);
  if (requestEffect({ method: first.request?.method ?? "GET" }) !== "write") {
    warnings.push(`the op's workflow (${steps}) never runs: a write runs only its first strategy, here its network strategy, ${shown}, a read; record with --network around the real submit, or name the write with --request-id <r_…>`);
    return op;
  }
  const [only] = saved;
  if (saved.length === 1 && only?.repeat === undefined && only?.each === undefined && commandMetadata(only?.cmd, only?.args).effect === "page-write") return op;
  warnings.push(`saved network-only: a write runs only its first strategy, and this draft's replays ${shown}, so its workflow (${steps}) would never run; the op replays ${shown} alone`);
  const run = op.run.filter((strategy) => strategy !== workflow);
  // The op's provenance says its requests hold escaped text.
  const used = new Set(run.flatMap((strategy) => (strategy?.using === "network" ? [...requestInputs(sentRequest(strategy.request), { escapes: true })] : [])));
  const args = Object.fromEntries(Object.entries(op.args || {}).filter(([name]) => used.has(name)));
  if (!Array.isArray(op.safety?.key)) return { ...op, args, run };
  const { key: declared, ...safety } = op.safety;
  const key = declared.filter((name) => Object.hasOwn(args, name));
  return { ...op, args, safety: key.length > 0 ? { ...safety, key } : safety, run };
}

// The origins an op saved from a record may send to: the page the record ran on, and the request
// its network strategy replays (an API on another host, as api.resy.com for resy.com). Other
// captured origins stay out.
// A replayed request on another origin than the page (an api. host, a CDN's JSON) is allowed with a
// warning, so a wrong pick shows. A write from a record with no page origin (started on
// about:blank, as surf parse does) warns too; a read from one doesn't.
function allowedOrigins(record, op, warnings) {
  const request = replayedRequest(op);
  const replayed = typeof request?.url === "string" ? originOf(absoluteUrl(request.url, record.origin)) : "";
  const wrongPick = "if that is the wrong request, save again with --request-id <r_…> from pb record candidates";
  if (replayed && !record.origin) {
    if (op.effect === "write") warnings.push(`the op sends to ${replayed}, the origin of the request it replays (${shownRequest(request)}), and the record had no page origin to compare it with; ${wrongPick}`);
  } else if (replayed && replayed !== originOf(record.origin)) {
    warnings.push(`the op may also send to ${replayed}, the origin of the request it replays (${shownRequest(request)}), which isn't the origin of the record's page (${record.origin}); ${wrongPick}`);
  }
  return [...new Set([record.origin, replayed].filter(Boolean))];
}

const shownJson = (value) => (value === undefined ? "none" : JSON.stringify(value));
const shownSteps = (steps) => (Array.isArray(steps) && steps.length > 0 ? steps.map((step) => step?.cmd ?? (step?.steps ? "loop" : "?")).join(" + ") : "none");
// A step as validateOp saves it, so `cmd` and `tool` compare alike; validateOp names a bad one.
const savedStep = (step) => { try { return normalizeStep(step); } catch { return step; } };
const workflowSteps = (op) => op.run.find((strategy) => strategy?.using === "workflow")?.steps?.map?.(savedStep);

// A strategy's checks: what it reads from the answer and when the answer counts as failed.
const CHECK_FIELDS = ["extract", "verify", "expect", "acceptStatus"];

// One line for each way the draft differs from what the record drafts: effect, safety, strategies,
// request, checks, steps, origins and inputs. `because` says why the record drafts a write.
function draftDifferences({ draft, reference, because, origins, recordOrigins }) {
  const lines = [];
  const effect = draft.effect ?? "read";
  if (effect !== reference.effect) lines.push(`effect: ${effect} (the record drafts ${reference.effect}${because ? `: ${because}` : ""})`);
  if (!isDeepStrictEqual(draft.safety, reference.safety)) lines.push(`safety: ${shownJson(draft.safety)} (the record drafts ${shownJson(reference.safety)})`);
  const kinds = (op) => op.run.map((strategy) => strategy?.using).join(", ");
  if (kinds(draft) !== kinds(reference)) lines.push(`strategies: ${kinds(draft)} (the record drafts ${kinds(reference)})`);
  const [request, recorded] = [replayedRequest(draft), replayedRequest(reference)];
  if (!isDeepStrictEqual(request, recorded)) {
    const edited = request && recorded ? Object.keys({ ...request, ...recorded }).filter((part) => !isDeepStrictEqual(request[part], recorded[part])) : [];
    lines.push(`request: ${shownRequest(request)}${edited.length > 0 ? `, its ${edited.join(", ")} edited` : ""} (the record drafts ${shownRequest(recorded)})`);
  }
  for (const recordedStrategy of reference.run) {
    const strategy = draft.run.find((candidate) => candidate?.using === recordedStrategy.using);
    for (const field of strategy ? CHECK_FIELDS : []) {
      if (!isDeepStrictEqual(strategy[field], recordedStrategy[field])) lines.push(`${strategy.using} ${field}: ${shownJson(strategy[field])} (the record drafts ${shownJson(recordedStrategy[field])})`);
    }
  }
  if (!isDeepStrictEqual(draft.on, reference.on)) lines.push(`on: ${shownJson(draft.on)} (the record drafts ${shownJson(reference.on)})`);
  const [steps, recordedSteps] = [workflowSteps(draft), workflowSteps(reference)];
  if (!isDeepStrictEqual(steps, recordedSteps)) {
    const sameNames = shownSteps(steps) === shownSteps(recordedSteps);
    lines.push(`steps: ${shownSteps(steps)}${sameNames ? ", arguments edited" : ""} (the record drafts ${shownSteps(recordedSteps)})`);
  }
  if (!isDeepStrictEqual(origins, recordOrigins)) lines.push(`origins: ${origins.join(", ")} (the record drafts ${recordOrigins.join(", ")})`);
  const [args, recordedArgs] = [draft.args ?? {}, reference.args ?? {}];
  const inputs = [
    ...Object.keys(args).filter((name) => !Object.hasOwn(recordedArgs, name)).map((name) => `${name} added`),
    ...Object.keys(recordedArgs).filter((name) => !Object.hasOwn(args, name)).map((name) => `${name} removed`),
    ...Object.keys(args).filter((name) => Object.hasOwn(recordedArgs, name) && !isDeepStrictEqual(args[name], recordedArgs[name])).map((name) => `${name} changed`),
  ];
  if (inputs.length > 0) lines.push(`inputs: ${inputs.join(", ")}`);
  return lines;
}

// The draft file is the op, checked by validateOp like any op file, and the save lists each way it
// differs from what the record drafts. `requestId` redrafts the op to replay that request, a read
// when pb record stop had --read. The draft builder refuses a record that captured several writes
// unless a request id (pb save's, else pb record stop's) names one.
function saveFromRecord({ recordId, requestId, scope = "user", cwd, home, root = getPrivateStateRoot() }) {
  const record = readRecord(recordId, root);
  if (!record) throw new Error(`record not found: ${recordId}`);
  const draftPath = path.join(recordsRoot(root), recordId, "draft", "op.json");
  const draft = fs.existsSync(draftPath) ? readPrivateJson(draftPath, null, { root }) : null;
  const warnings = [];
  const chosen = requestId ?? record.requestId;
  const read = record.read === true;
  const drafted = draft && !requestId ? draft : draftFromRecord(recordId, root, { read, requestId: chosen, warnings });
  const built = buildDraft(record, { read, requestId: chosen, root });
  // As the draft file holds it, so a field the builder leaves undefined isn't a difference.
  const reference = JSON.parse(JSON.stringify(built.op));
  // validateOp names what is wrong with a draft that isn't an op with strategies.
  if (!drafted || typeof drafted !== "object" || !Array.isArray(drafted.run)) validateOp(drafted, { origins: [] });
  // The saver's, never the draft's: escaped says the op's captured text is escaped (escapedOp), as
  // the record's requests and steps are.
  const provenance = { recordId: record.id, ...(chosen ? { requestId: chosen } : {}), escaped: true };
  const op = fitWriteWorkflow({ ...drafted, provenance }, warnings);
  const origins = allowedOrigins(record, op, warnings);
  const differs = draftDifferences({ draft: drafted, reference, because: built.because, origins: validateOp(op, { origins }).origins, recordOrigins: allowedOrigins(record, reference, []) });
  const saved = savePlaybook({ manifest: { id: record.site, name: record.site, version: "1.0.0", origins }, op, scope, cwd, home });
  return { ...saved, origins, ...(warnings.length > 0 ? { warnings } : {}), ...(differs.length > 0 ? { differs } : {}) };
}

// `cwd` and `home` find the saved ops whose env-backed headers the HAR redacts.
function exportRecordHar(recordId, output, root = getPrivateStateRoot(), { cwd, home } = {}) {
  const trace = readPrivateJson(path.join(recordsRoot(root), recordId, "network", "trace.json"), null, { root });
  if (!trace) throw new Error(`record ${recordId} has no network trace`);
  return writeNetworkExport(path.resolve(output), trace.entries, "har", { secretHeaders: envBackedHeaders({ cwd, home }) });
}

module.exports = { exportRecordHar, saveFromRecent, saveFromRecord, suggestions };
