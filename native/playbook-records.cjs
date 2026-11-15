const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  appendPrivateJsonLine,
  assertWithin,
  atomicWriteJson,
  ensurePrivateDir,
  getPrivateStateRoot,
  readPrivateFile,
  readPrivateJson,
} = require("./private-state.cjs");
const { redactSensitiveFields, redactUrlSecrets, safeHeaders } = require("./redaction.cjs");
const { commandMetadata, promoteRedactedStepArgs } = require("./workflow-definition.cjs");
const { describeCaptureGaps } = require("./formatters/network.cjs");
const { ASSET_TYPES, isReplayCandidate, isTelemetryRequest, requestEffect, shownUrl } = require("./request-kinds.cjs");
const { isWeak, pageWords, rankCandidates, scoreEntries, summarizeResponse } = require("./record-candidates.cjs");
const { version: PACKAGE_VERSION } = require("../package.json");

function recordsRoot(root = getPrivateStateRoot()) {
  return path.join(root, "records");
}

function activePath(root = getPrivateStateRoot()) {
  return path.join(recordsRoot(root), "active.json");
}

function recordDirectory(recordId, root = getPrivateStateRoot()) {
  if (typeof recordId !== "string" || !/^rec-[a-zA-Z0-9-]+$/.test(recordId)) throw new Error("record ID is invalid");
  return path.join(recordsRoot(root), recordId);
}

function readRecord(recordId, root = getPrivateStateRoot()) {
  return readPrivateJson(path.join(recordDirectory(recordId, root), "record.json"), null, { root });
}

// active.json lists every active record; v2.26 and earlier wrote a single { recordId }.
function activeIds(root) {
  const active = readPrivateJson(activePath(root), null, { root });
  if (!active) return [];
  return Array.isArray(active.records) ? active.records : [active.recordId].filter(Boolean);
}

function writeActiveIds(ids, root) {
  if (ids.length > 0) atomicWriteJson(activePath(root), { version: 2, records: ids }, { root });
  else fs.rmSync(activePath(root), { force: true });
}

function activeRecords(root = getPrivateStateRoot()) {
  return activeIds(root).map((id) => readRecord(id, root)).filter(Boolean);
}

function writeRecord(record, root) {
  atomicWriteJson(path.join(recordDirectory(record.id, root), "record.json"), record, { root });
}

function ownerLabel(record) {
  return record.session ? `session ${record.session}` : `tab ${record.tabId}`;
}

// A record belongs to the session that started it, or to its tab when started without a session.
// `target` is the caller's resolved { session, tabId }; page events from the record's watcher
// carry only the tab and set `page`. Tab and window commands have no tab target and set `browser`:
// they match by the caller's session, or without one the only record started without a session.
function ownsTarget(record, target) {
  if (!target) return false;
  if (target.page) return target.tabId === record.tabId;
  if (record.session) return target.session === record.session;
  if (target.browser) return !target.session;
  return !target.session && target.tabId === record.tabId;
}

function recordFor(target, root = getPrivateStateRoot()) {
  const owners = activeRecords(root).filter((record) => ownsTarget(record, target));
  if (target?.browser && !target.session && owners.length > 1) return null;
  return owners[0] || null;
}

function requireRecordFor(target, root = getPrivateStateRoot()) {
  const record = recordFor(target, root);
  if (record) return record;
  const others = activeRecords(root);
  const onTab = others.find((other) => other.tabId === target?.tabId);
  if (onTab) {
    const hint = onTab.session ? `run it with --session ${onTab.session}` : "it was started without a session, so stop it without --session or SURF_SESSION";
    throw new Error(`the playbook record on tab ${onTab.tabId} belongs to ${ownerLabel(onTab)}; ${hint}`);
  }
  const caller = target?.session ? `session ${target.session}` : `tab ${target?.tabId}`;
  if (others.length > 0) throw new Error(`no active playbook record for ${caller}; active: ${others.map((other) => `${other.id} (${ownerLabel(other)})`).join(", ")}`);
  throw new Error("no active playbook record");
}

function recordStatus({ target, root = getPrivateStateRoot() } = {}) {
  const record = recordFor(target, root);
  if (record) return record;
  const others = activeRecords(root).map(({ id, site, op, session, tabId }) => ({ id, site, op, ...(session ? { session } : {}), tabId }));
  return { status: "idle", ...(others.length > 0 ? { otherRecords: others } : {}) };
}

function startRecord({ site, op, watch = false, network = false, includeInputValues = false, tabId, session, origin, root = getPrivateStateRoot() }) {
  if (!site || !op) throw new Error("record start requires site and op");
  if (!tabId) throw new Error("record start requires a target tab");
  const clash = activeRecords(root).find((other) => (session && other.session === session) || other.tabId === tabId);
  if (clash) throw new Error(`a playbook record is already active for ${ownerLabel(clash)}: ${clash.id}`);
  const id = `rec-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const directory = recordDirectory(id, root);
  ensurePrivateDir(directory, root);
  const record = {
    version: 1,
    id,
    site,
    op,
    status: "recording",
    capture: { watch, network },
    redaction: { includeInputValues },
    provenance: { generator: "surf-cli", version: PACKAGE_VERSION },
    tabId,
    ...(session ? { session } : {}),
    ...(origin ? { origin } : {}),
    startedAt: new Date().toISOString(),
    eventCount: 0,
  };
  writeRecord(record, root);
  writeActiveIds([...activeRecords(root).map((other) => other.id), id], root);
  return record;
}

function appendToRecord(record, event, root) {
  appendPrivateJsonLine(path.join(recordDirectory(record.id, root), "events.jsonl"), { version: 1, recordId: record.id, ...event }, { root });
  record.eventCount++;
  writeRecord(record, root);
}

function appendRecordEvent(event, { target, root = getPrivateStateRoot() } = {}) {
  const record = recordFor(target, root);
  if (!record || record.status !== "recording") return false;
  appendToRecord(record, event, root);
  return true;
}

function updateStatus(status, { target, root = getPrivateStateRoot() } = {}) {
  const record = requireRecordFor(target, root);
  const allowed = { recording: ["paused", "stopping"], paused: ["recording", "stopping"] };
  if (!allowed[record.status]?.includes(status)) throw new Error(`cannot change record from ${record.status} to ${status}`);
  record.status = status;
  writeRecord(record, root);
  return record;
}

function updateRecordContext(recordId, { tabId, origin }, root = getPrivateStateRoot()) {
  const record = readRecord(recordId, root);
  if (!record) throw new Error(`record not found: ${recordId}`);
  if (tabId) record.tabId = tabId;
  if (origin) record.origin = origin;
  writeRecord(record, root);
  return record;
}

function markRecord(label, { target, root = getPrivateStateRoot() } = {}) {
  if (typeof label !== "string" || !label.trim()) throw new Error("record mark requires text");
  const record = requireRecordFor(target, root);
  appendToRecord(record, { type: "mark", label: label.trim(), timestamp: new Date().toISOString() }, root);
  return record;
}

function readEvents(recordId, root = getPrivateStateRoot()) {
  const filePath = path.join(recordDirectory(recordId, root), "events.jsonl");
  const content = readPrivateFile(filePath, { root, allowMissing: true, fallback: "", encoding: "utf8" });
  return content.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function sanitizeTraceEntry(entry, includeInputValues = false) {
  return {
    ...redactSensitiveFields(entry),
    url: redactUrlSecrets(entry.url),
    requestHeaders: safeHeaders(entry.requestHeaders),
    responseHeaders: safeHeaders(entry.responseHeaders),
    responseBody: entry.responseBody === undefined ? undefined : "<response-body>",
    ...(includeInputValues ? {} : { requestBody: entry.requestBody === undefined ? undefined : "<request-body>" }),
  };
}

// Capture starts with an empty buffer, so every entry belongs to the record; entries stamped in
// epoch ms are also checked against the start. Older extensions stamped `ts` with Chrome's monotonic
// clock (ms since boot), which can't be compared with wall-clock time, so those are kept as-is.
const EPOCH_MS_FLOOR = 1e12;
function traceEntriesForRecord(record, entries) {
  const cutoff = Date.parse(record.startedAt);
  return entries.filter((entry) => !(entry.ts >= EPOCH_MS_FLOOR) || entry.ts >= cutoff);
}

// The trace keeps no response bodies; each entry keeps a summary of the response's structure
// instead (see summarizeResponse), so pb record candidates can rank it. `pageText` is the page's
// visible text, used for the overlap score and never stored. `sample` adds a short sample, for
// live ranking only: entries with samples are never written.
function sanitizeTraceEntries(record, entries, pageText, { sample = false } = {}) {
  const page = pageWords(pageText);
  return entries.map((entry) => {
    const responseSummary = summarizeResponse(entry, page, { sample });
    return sanitizeTraceEntry(responseSummary ? { ...entry, responseSummary } : entry, record.redaction?.includeInputValues);
  });
}

// `capture` is the extension's capture status when the trace was read, and `truncatedAt` the read
// limit when the read returned that many entries. Without a status, or with a gap, dropped entries
// or a truncated read, the trace is incomplete and can't show that a flow sent no writes.
function attachNetworkTrace(recordId, entries, root = getPrivateStateRoot(), { capture, truncatedAt, pageText } = {}) {
  const record = readRecord(recordId, root);
  if (!record) throw new Error(`record not found: ${recordId}`);
  const sanitized = sanitizeTraceEntries(record, entries, pageText);
  const warnings = capture
    ? describeCaptureGaps(capture, { atStop: true })
    : ["the extension did not report whether network capture ran (it may be older than this Surf); requests may be missing"];
  if (truncatedAt) warnings.push(`the trace holds only the first ${truncatedAt} requests read from the tab; later ones are missing`);
  const complete = Boolean(capture) && warnings.length === 0;
  const directory = path.join(recordDirectory(recordId, root), "network");
  ensurePrivateDir(directory, root);
  const tracePath = path.join(directory, "trace.json");
  atomicWriteJson(tracePath, { version: 1, recordId, capturedAt: new Date().toISOString(), complete, ...(capture ? { capture } : {}), entries: sanitized }, { root });
  record.trace = { path: "network/trace.json", count: sanitized.length, complete, ...(warnings.length > 0 ? { warnings } : {}) };
  writeRecord(record, root);
  return { path: tracePath, count: sanitized.length };
}

// Page-write steps that only act on the page. Any other page-write step (cookies, closing or naming
// tabs and windows, emulation, AI providers) acts beyond it, so a read op must not replay it.
const PAGE_STEPS = new Set([
  "click", "check", "uncheck", "key", "submit", "type", "smart_type", "find_and_type", "form_input", "form.fill", "select",
  "scroll", "scroll.top", "scroll.bottom", "scroll_to_position", "dialog.accept", "dialog.dismiss",
  "locate.role", "locate.text", "locate.label",
]);

// A draft with page-write steps is a write, as is one whose trace holds a request that can write
// (a method other than GET/HEAD/OPTIONS that isn't telemetry). `read` (pb record stop --read) makes
// it a read, refused when a captured request can write, a step acts beyond the page, or the record
// didn't capture the network.
function draftEffect({ record, steps, trace, read }) {
  const pageWrite = (step) => ["page-write", "unknown"].includes(commandMetadata(step.tool, step.args).effect);
  const write = trace?.entries?.find((entry) => requestEffect(entry) === "write" && !isTelemetryRequest(entry, record.origin));
  if (read) {
    if (record.capture?.network !== true) throw new Error("--read needs a record started with --network, so its requests can be checked for writes");
    const beyond = steps.find((step) => pageWrite(step) && !PAGE_STEPS.has(step.tool));
    if (beyond) throw new Error(`--read refused: the record ran ${beyond.tool}, which acts beyond the page; stop with --draft alone to draft a write`);
    if (write) throw new Error(`--read refused: the record captured ${shownUrl(write)}, which can change data; stop with --draft alone to draft a write`);
    return trace?.complete === true ? { effect: "read" } : { effect: "read", warning: "--read could not check every request: the trace is incomplete (see the warnings above)" };
  }
  if (write || steps.some(pageWrite)) return { effect: "write" };
  return { effect: "read" };
}

const NO_REPLAY = "the draft has no network strategy: the trace holds no request it can replay (telemetry, page assets and preflights are never replayed)";

// Why a draft never replays this request, or nothing when it may.
function neverReplayed(entry, origin) {
  if (isTelemetryRequest(entry, origin)) return "telemetry";
  if (ASSET_TYPES.has(entry.type)) return `a page asset (${entry.type})`;
  if (entry.method === "OPTIONS" || entry.type === "Preflight") return "a CORS preflight";
  if (!REPLAYED_METHODS.has(entry.method)) return `a ${entry.method} (a draft replays only GET, HEAD and POST)`;
  if (!isReplayCandidate(entry)) return `a ${entry.method} answered with status ${entry.status ?? "none"}`;
  return "";
}
const REPLAYED_METHODS = new Set(["GET", "HEAD", "POST"]);

// The request a draft replays: the one chosen with --request-id, else the top-ranked read. A write
// draft whose trace holds a write replays its top-ranked write, the request its effect comes from,
// and never a read: when it can't replay that write it gets no network strategy. A read draft never
// replays a write. Telemetry, page assets and preflights are never replayed.
function pickRequest({ record, trace, effect, requestId, warnings }) {
  const entries = trace?.entries || [];
  const capturedWrite = effect === "write" && entries.find((entry) => requestEffect(entry) === "write" && !isTelemetryRequest(entry, record.origin));
  if (requestId) {
    const entry = entries.find((candidate) => candidate.id === requestId);
    if (!entry) throw new Error(`request ${requestId} is not in the trace of ${record.id}; run surf pb record candidates ${record.id} to list its requests`);
    const why = neverReplayed(entry, record.origin);
    if (why) throw new Error(`request ${requestId} (${shownUrl(entry)}) is ${why}; a draft never replays it`);
    if (capturedWrite && requestEffect(entry) === "read") {
      throw new Error(`request ${requestId} (${shownUrl(entry)}) is a read, but the record captured ${shownUrl(capturedWrite)}, which makes the draft a write; a write draft replays its write, never a read`);
    }
    return entry;
  }
  if (!trace) return undefined;
  const eligible = scoreEntries(entries, { origin: record.origin }).filter((candidate) => candidate.eligible);
  const top = eligible.filter((candidate) => candidate.effect === (capturedWrite ? "write" : "read"))[0];
  if (!top) {
    warnings.push(capturedWrite
      ? `the draft has no network strategy: it is a write because of ${shownUrl(capturedWrite)}, which is ${neverReplayed(capturedWrite, record.origin)}, and a write draft never replays a read in its place`
      : NO_REPLAY);
    return undefined;
  }
  if (isWeak(top)) warnings.push(`the draft's network strategy, ${shownUrl(top.entry)}, is a weak match (score ${top.score}); run surf pb record candidates ${record.id} and choose with --request-id`);
  return top.entry;
}

// `warnings` collects why the draft left something out. `requestId` picks the request to replay.
function draftFromRecord(recordId, root = getPrivateStateRoot(), { read = false, requestId, warnings = [] } = {}) {
  const record = readRecord(recordId, root);
  if (!record) throw new Error(`record not found: ${recordId}`);
  const events = readEvents(recordId, root).filter((event) => event.type === "tool.completed");
  const steps = [];
  for (const event of events) {
    if (!commandMetadata(event.command).recordable) continue;
    steps.push({ tool: event.command, args: event.argsRedacted || {} });
  }
  const tracePath = path.join(recordDirectory(recordId, root), "network", "trace.json");
  const trace = readPrivateJson(tracePath, null, { root });
  const { effect, warning } = draftEffect({ record, steps, trace, read });
  if (warning) warnings.push(warning);
  const strategies = [];
  const observed = pickRequest({ record, trace, effect, requestId, warnings });
  if (observed) {
    const url = new URL(observed.url);
    const query = Object.fromEntries(url.searchParams.entries());
    url.search = "";
    strategies.push({ using: "network", request: { method: observed.method, url: url.toString(), query, headers: safeHeaders(observed.requestHeaders), ...(observed.requestBody !== undefined ? { body: observed.requestBody } : {}) } });
  }
  let args = {};
  if (steps.length > 0) {
    const promoted = promoteRedactedStepArgs(steps);
    args = promoted.args;
    strategies.push({ using: "workflow", steps: promoted.steps });
  }
  if (strategies.length === 0) throw new Error("record has no executable evidence");
  const safety = effect === "write" ? { authorization: "explicit", duplicate: "transactional", key: Object.keys(args).length ? Object.keys(args) : ["review_key"] } : undefined;
  if (effect === "write" && !args.review_key && safety.key.includes("review_key")) args.review_key = { required: true, desc: "Semantic key for reviewed write replay" };
  const op = { id: record.op, description: `Drafted from ${record.id}`, effect, args, ...(safety ? { safety } : {}), run: strategies, provenance: { recordId: record.id } };
  const draftDir = path.join(recordDirectory(recordId, root), "draft");
  ensurePrivateDir(draftDir, root);
  atomicWriteJson(path.join(draftDir, "op.json"), op, { root });
  return op;
}

// The draft is made before the record stops, so a refused draft (--read) leaves it recording.
function stopRecord({ target, draft = false, read = false, requestId, root = getPrivateStateRoot() } = {}) {
  if (read && !draft) throw new Error("--read applies only with --draft");
  if (requestId && !draft) throw new Error("--request-id applies only with --draft");
  let record = requireRecordFor(target, root);
  const draftWarnings = [];
  const op = draft ? draftFromRecord(record.id, root, { read, requestId, warnings: draftWarnings }) : undefined;
  record = updateStatus("stopping", { target, root });
  record = readRecord(record.id, root);
  record.status = draft ? "draft_created" : "stopped";
  record.stoppedAt = new Date().toISOString();
  writeRecord(record, root);
  writeActiveIds(activeIds(root).filter((id) => id !== record.id), root);
  const warnings = [...(record.trace?.warnings || []), ...draftWarnings];
  return { record, ...(op ? { draft: op } : {}), ...(warnings.length > 0 ? { warnings } : {}) };
}

function listRecords(root) {
  const base = recordsRoot(root);
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base).filter((name) => name.startsWith("rec-")).map((name) => readRecord(name, root)).filter(Boolean);
}

// Whether the caller started this record: its session, or without one, its tab.
function startedBy(record, target) {
  return record.session ? target?.session === record.session : !target?.session && target?.tabId === record.tabId;
}

// The record pb record candidates ranks: the one named, else the caller's active record, else the
// latest record the caller started. A named record must be the caller's too.
function findCandidatesRecord({ recordId, target, root = getPrivateStateRoot() } = {}) {
  if (recordId) {
    const record = readRecord(recordId, root);
    if (!record) throw new Error(`record not found: ${recordId}`);
    if (startedBy(record, target)) return record;
    const hint = record.session
      ? `run it with --session ${record.session}`
      : `it was started without a session, so run it without --session or SURF_SESSION, with --tab-id ${record.tabId}`;
    throw new Error(`record ${record.id} belongs to ${ownerLabel(record)}; ${hint}`);
  }
  const active = recordFor(target, root);
  if (active) return active;
  const latest = listRecords(root).filter((record) => startedBy(record, target)).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0];
  if (latest) return latest;
  throw new Error(`no playbook record for ${target?.session ? `session ${target.session}` : `tab ${target?.tabId}`}; pass a record id`);
}

const isActive = (record) => ["recording", "paused"].includes(record.status);

// Ranks a record's requests, best first. An active record has no trace yet, so the host reads its
// requests from the tab and passes them as `live` ({ entries, pageText }); only then does the
// result carry response samples, held in memory and printed, never saved.
function recordCandidates(record, { root = getPrivateStateRoot(), limit = 10, live } = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer");
  let entries;
  let warnings = [];
  if (live) entries = sanitizeTraceEntries(record, live.entries, live.pageText, { sample: true });
  else {
    const trace = readPrivateJson(path.join(recordDirectory(record.id, root), "network", "trace.json"), null, { root });
    if (!trace) throw new Error(`record ${record.id} has no network trace; start a record with --network to rank its requests`);
    entries = trace.entries;
    warnings = record.trace?.warnings || [];
  }
  const ranked = rankCandidates(entries, { origin: record.origin });
  return {
    recordId: record.id,
    site: record.site,
    op: record.op,
    live: Boolean(live),
    total: ranked.length,
    ...(warnings.length > 0 ? { warnings } : {}),
    candidates: ranked.slice(0, limit),
  };
}

function discardRecord({ target, root = getPrivateStateRoot() } = {}) {
  const record = requireRecordFor(target, root);
  const directory = assertWithin(recordsRoot(root), recordDirectory(record.id, root));
  fs.rmSync(directory, { recursive: true, force: true });
  writeActiveIds(activeIds(root).filter((id) => id !== record.id), root);
  return { discarded: record.id };
}

module.exports = {
  activeRecords,
  appendRecordEvent,
  attachNetworkTrace,
  discardRecord,
  draftFromRecord,
  findCandidatesRecord,
  isActive,
  markRecord,
  pauseRecord: (options) => updateStatus("paused", options),
  readEvents,
  isReplayCandidate,
  readRecord,
  recordCandidates,
  recordStatus,
  requestEffect,
  recordsRoot,
  requireRecordFor,
  resumeRecord: (options) => updateStatus("recording", options),
  startRecord,
  stopRecord,
  traceEntriesForRecord,
  updateRecordContext,
};
