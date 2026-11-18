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

function activeRecord(root = getPrivateStateRoot()) {
  const active = readPrivateJson(activePath(root), null, { root });
  return active ? readRecord(active.recordId, root) : null;
}

function writeRecord(record, root) {
  atomicWriteJson(path.join(recordDirectory(record.id, root), "record.json"), record, { root });
}

function startRecord({ site, op, watch = false, network = false, includeInputValues = false, tabId, origin, root = getPrivateStateRoot() }) {
  if (!site || !op) throw new Error("record start requires site and op");
  if (activeRecord(root)) throw new Error("a playbook record is already active");
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
    ...(tabId ? { tabId } : {}),
    ...(origin ? { origin } : {}),
    startedAt: new Date().toISOString(),
    eventCount: 0,
  };
  writeRecord(record, root);
  atomicWriteJson(activePath(root), { recordId: id }, { root });
  return record;
}

function appendRecordEvent(event, { root = getPrivateStateRoot(), allowPaused = false } = {}) {
  const record = activeRecord(root);
  if (!record || (record.status !== "recording" && !allowPaused)) return false;
  appendPrivateJsonLine(path.join(recordDirectory(record.id, root), "events.jsonl"), { version: 1, recordId: record.id, ...event }, { root });
  record.eventCount++;
  writeRecord(record, root);
  return true;
}

function updateActiveStatus(status, root = getPrivateStateRoot()) {
  const record = activeRecord(root);
  if (!record) throw new Error("no active playbook record");
  const allowed = { recording: ["paused", "stopping"], paused: ["recording", "stopping"] };
  if (!allowed[record.status]?.includes(status)) throw new Error(`cannot change record from ${record.status} to ${status}`);
  record.status = status;
  writeRecord(record, root);
  return record;
}

function updateRecordContext({ tabId, origin }, root = getPrivateStateRoot()) {
  const record = activeRecord(root);
  if (!record) throw new Error("no active playbook record");
  if (tabId) record.tabId = tabId;
  if (origin) record.origin = origin;
  writeRecord(record, root);
  return record;
}

function markRecord(label, root = getPrivateStateRoot()) {
  if (typeof label !== "string" || !label.trim()) throw new Error("record mark requires text");
  const record = activeRecord(root);
  if (!record) throw new Error("no active playbook record");
  appendRecordEvent({ type: "mark", label: label.trim(), timestamp: new Date().toISOString() }, { root, allowPaused: true });
  return activeRecord(root);
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

function attachNetworkTrace(recordId, entries, root = getPrivateStateRoot()) {
  const record = readRecord(recordId, root);
  if (!record) throw new Error(`record not found: ${recordId}`);
  const sanitized = entries.map((entry) => sanitizeTraceEntry(entry, record.redaction.includeInputValues));
  const directory = path.join(recordDirectory(recordId, root), "network");
  ensurePrivateDir(directory, root);
  const tracePath = path.join(directory, "trace.json");
  atomicWriteJson(tracePath, { version: 1, recordId, capturedAt: new Date().toISOString(), entries: sanitized }, { root });
  record.trace = { path: "network/trace.json", count: sanitized.length };
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
  const observed = trace?.entries?.findLast((entry) => ["GET", "HEAD", "OPTIONS", "POST"].includes(entry.method) && entry.status >= 200 && entry.status < 400);
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

function stopRecord({ draft = false, root = getPrivateStateRoot() } = {}) {
  let record = updateActiveStatus("stopping", root);
  let op;
  if (draft) op = draftFromRecord(record.id, root);
  record = readRecord(record.id, root);
  record.status = draft ? "draft_created" : "stopped";
  record.stoppedAt = new Date().toISOString();
  writeRecord(record, root);
  fs.unlinkSync(activePath(root));
  return { record, ...(op ? { draft: op } : {}) };
}

function discardRecord(root = getPrivateStateRoot()) {
  const record = activeRecord(root);
  if (!record) throw new Error("no active playbook record");
  const directory = assertWithin(recordsRoot(root), recordDirectory(record.id, root));
  fs.rmSync(directory, { recursive: true, force: true });
  try { fs.unlinkSync(activePath(root)); } catch {}
  return { discarded: record.id };
}

module.exports = {
  activeRecord,
  appendRecordEvent,
  attachNetworkTrace,
  discardRecord,
  draftFromRecord,
  markRecord,
  pauseRecord: (root) => updateActiveStatus("paused", root),
  readEvents,
  readRecord,
  recordsRoot,
  resumeRecord: (root) => updateActiveStatus("recording", root),
  startRecord,
  stopRecord,
  updateRecordContext,
};
