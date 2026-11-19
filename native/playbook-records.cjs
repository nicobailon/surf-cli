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

// A record belongs to the session that started it, or to its tab when started without a session
// (v2.26.0 wrote no session even under SURF_SESSION). `target` is the caller's resolved
// { session, tabId }; page events from the record's watcher carry only the tab and set `page`, and
// tab and window commands have no tab.
function ownsTarget(record, target) {
  if (record.session && !target.page) return target.session === record.session;
  return target.tabId === record.tabId;
}

// A caller without a session whose tab holds no record (a tab and window command, a command after
// tab.new or a tab switch, or one after the record's tab closed) gets the only record started
// without a session.
function recordFor(target, root = getPrivateStateRoot()) {
  if (!target) return null;
  const active = activeRecords(root);
  const owner = active.find((record) => ownsTarget(record, target));
  if (owner || target.page || target.session || active.some((record) => record.tabId === target.tabId)) return owner || null;
  const loose = active.filter((record) => !record.session);
  return loose.length === 1 ? loose[0] : null;
}

function requireRecordFor(target, root = getPrivateStateRoot()) {
  const record = recordFor(target, root);
  if (record) return record;
  const others = activeRecords(root);
  // Only a session's record can be on the caller's tab without belonging to it.
  const onTab = others.find((other) => other.tabId === target?.tabId);
  if (onTab) {
    throw new Error(`the playbook record on tab ${onTab.tabId} belongs to session ${onTab.session}; run it with SURF_SESSION=${onTab.session} or --session ${onTab.session}, without --tab-id`);
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
  writeActiveIds([...activeIds(root), id], root);
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
// epoch ms are also checked against the start. Extensions up to v2.26.0 stamped `ts` with Chrome's
// monotonic clock (ms since boot), which can't be compared with wall-clock time, so those are kept.
const EPOCH_MS_FLOOR = 1e12;
function traceEntriesForRecord(record, entries) {
  const cutoff = Date.parse(record.startedAt);
  return entries.filter((entry) => !(entry.ts >= EPOCH_MS_FLOOR) || entry.ts >= cutoff);
}

// What the extension's capture status says the trace is missing.
function describeCaptureGaps(capture) {
  const lines = (capture?.interruptions || []).map(({ reason, at, resumedAt }) => {
    const from = `network capture was interrupted at ${new Date(at).toISOString()} (debugger detached: ${reason})`;
    return resumedAt
      ? `${from} until ${new Date(resumedAt).toISOString()}; requests in between were not captured`
      : `${from} and had not resumed when read; later requests were not captured`;
  });
  if (capture && !capture.active && lines.length === 0) {
    lines.push("network capture was not running when the record stopped (the extension may have restarted); requests may be missing");
  }
  if (capture?.clearedAt) {
    lines.push(`the captured requests were cleared at ${new Date(capture.clearedAt).toISOString()} (network.clear or --clear), so the trace is missing the ones before`);
  }
  if (capture?.dropped > 0) {
    lines.push(`network capture dropped the ${capture.dropped} oldest requests (it keeps about 500 per tab), so the trace is missing them`);
  }
  return lines;
}

// `capture` is the extension's capture status when the trace was read, and `truncatedAt` the read
// limit when the read returned that many entries. `pb record stop` prints what they say is missing.
function attachNetworkTrace(recordId, entries, root = getPrivateStateRoot(), { capture, truncatedAt } = {}) {
  const record = readRecord(recordId, root);
  if (!record) throw new Error(`record not found: ${recordId}`);
  const sanitized = entries.map((entry) => sanitizeTraceEntry(entry, record.redaction.includeInputValues));
  const warnings = describeCaptureGaps(capture);
  if (truncatedAt) warnings.push(`the trace holds only the first ${truncatedAt} requests read from the tab; later ones are missing`);
  const directory = path.join(recordDirectory(recordId, root), "network");
  ensurePrivateDir(directory, root);
  const tracePath = path.join(directory, "trace.json");
  atomicWriteJson(tracePath, { version: 1, recordId, capturedAt: new Date().toISOString(), entries: sanitized }, { root });
  record.trace = { path: "network/trace.json", count: sanitized.length, ...(warnings.length > 0 ? { warnings } : {}) };
  writeRecord(record, root);
  return { path: tracePath, count: sanitized.length };
}

function draftFromRecord(recordId, root = getPrivateStateRoot()) {
  const record = readRecord(recordId, root);
  if (!record) throw new Error(`record not found: ${recordId}`);
  const events = readEvents(recordId, root).filter((event) => event.type === "tool.completed");
  let effect = "read";
  const steps = [];
  for (const event of events) {
    const metadata = commandMetadata(event.command);
    if (!metadata.recordable) continue;
    if (["page-write", "unknown"].includes(metadata.effect)) effect = "write";
    steps.push({ tool: event.command, args: event.argsRedacted || {} });
  }
  const tracePath = path.join(recordDirectory(recordId, root), "network", "trace.json");
  const trace = readPrivateJson(tracePath, null, { root });
  const strategies = [];
  // A recorded flow replays its steps; the last request it captured is often a beacon.
  const observed = steps.length > 0 ? undefined : trace?.entries?.findLast((entry) => ["GET", "HEAD", "OPTIONS", "POST"].includes(entry.method) && entry.status >= 200 && entry.status < 400);
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

function stopRecord({ target, draft = false, root = getPrivateStateRoot() } = {}) {
  let record = updateStatus("stopping", { target, root });
  let op;
  if (draft) op = draftFromRecord(record.id, root);
  record = readRecord(record.id, root);
  record.status = draft ? "draft_created" : "stopped";
  record.stoppedAt = new Date().toISOString();
  writeRecord(record, root);
  writeActiveIds(activeIds(root).filter((id) => id !== record.id), root);
  const warnings = record.trace?.warnings || [];
  return { record, ...(op ? { draft: op } : {}), ...(warnings.length > 0 ? { warnings } : {}) };
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
  markRecord,
  pauseRecord: (options) => updateStatus("paused", options),
  readEvents,
  readRecord,
  recordStatus,
  recordsRoot,
  requireRecordFor,
  resumeRecord: (options) => updateStatus("recording", options),
  startRecord,
  stopRecord,
  traceEntriesForRecord,
  updateRecordContext,
};
