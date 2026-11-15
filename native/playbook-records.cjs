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

// `capture` is the extension's capture status when the trace was read, and `truncatedAt` the read
// limit when the read returned that many entries. Without a status, or with a gap, dropped entries
// or a truncated read, the trace is incomplete and can't show that a flow sent no writes.
function attachNetworkTrace(recordId, entries, root = getPrivateStateRoot(), { capture, truncatedAt } = {}) {
  const record = readRecord(recordId, root);
  if (!record) throw new Error(`record not found: ${recordId}`);
  const sanitized = entries.map((entry) => sanitizeTraceEntry(entry, record.redaction.includeInputValues));
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

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
// Beacons, CSP reports and requests to analytics and error-reporting services don't change the
// site's data, so they don't make a recorded flow a write, unless they are made on that service's
// own site (posthog.com's dashboards, say).
const TELEMETRY_TYPES = new Set(["Ping", "CSPViolationReport"]);
const TELEMETRY_HOSTS = [
  "google-analytics.com", "analytics.google.com", "googletagmanager.com", "doubleclick.net",
  "segment.io", "mixpanel.com", "amplitude.com", "heapanalytics.com", "posthog.com",
  "sentry.io", "bugsnag.com", "browser-intake-datadoghq.com", "browser-intake-datadoghq.eu", "nr-data.net",
  "hotjar.com", "clarity.ms", "fullstory.com", "cloudflareinsights.com", "plausible.io",
];
// Page-write steps that only act on the page. Any other page-write step (cookies, closing or naming
// tabs and windows, emulation, AI providers) acts beyond it, so a read op must not replay it.
const PAGE_STEPS = new Set([
  "click", "check", "uncheck", "key", "submit", "type", "smart_type", "find_and_type", "form_input", "form.fill", "select",
  "scroll", "scroll.top", "scroll.bottom", "scroll_to_position", "dialog.accept", "dialog.dismiss",
  "locate.role", "locate.text", "locate.label",
]);

function hostname(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

// A request to a telemetry host is first-party, not telemetry, when the record started on that
// service's site or the page that sent it (`tabUrl`) is on it. With neither known, it isn't
// treated as telemetry.
function isTelemetryRequest(entry, recordOrigin) {
  if (TELEMETRY_TYPES.has(entry.type)) return true;
  const sites = [hostname(recordOrigin), hostname(entry.tabUrl)].filter(Boolean);
  if (sites.length === 0) return false;
  const within = (host, suffix) => host === suffix || host.endsWith(`.${suffix}`);
  const host = hostname(entry.url);
  return TELEMETRY_HOSTS.some((suffix) => within(host, suffix) && !sites.some((site) => within(site, suffix)));
}

// Page assets are captured so the write check sees every request (a POST answered with JavaScript
// is an XHR, not a Script), but a draft or client never replays one.
const ASSET_TYPES = new Set(["Image", "Stylesheet", "Script", "Font", "Media"]);

// A captured request a draft or derived client may replay.
function isReplayCandidate(entry) {
  return ["GET", "HEAD", "OPTIONS", "POST"].includes(entry.method) && entry.status >= 200 && entry.status < 400 && !ASSET_TYPES.has(entry.type);
}

function requestEffect(entry) {
  return READ_METHODS.has(String(entry.method).toUpperCase()) ? "read" : "write";
}

function shownUrl(entry) {
  const url = new URL(entry.url);
  url.search = "";
  return `${entry.method} ${url}`;
}

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

// `warnings` collects why the draft left something out.
function draftFromRecord(recordId, root = getPrivateStateRoot(), { read = false, warnings = [] } = {}) {
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
  const observed = trace?.entries?.findLast(isReplayCandidate);
  // Replaying telemetry would send it again, so such a request gives the draft no network strategy
  // (a different request isn't picked instead). A read draft can't pick any other write: --read is
  // refused when the trace holds one.
  if (observed && isTelemetryRequest(observed, record.origin)) {
    warnings.push(`the draft has no network strategy: the request it would replay, ${shownUrl(observed)}, is telemetry`);
  } else if (observed) {
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
function stopRecord({ target, draft = false, read = false, root = getPrivateStateRoot() } = {}) {
  if (read && !draft) throw new Error("--read applies only with --draft");
  let record = requireRecordFor(target, root);
  const draftWarnings = [];
  const op = draft ? draftFromRecord(record.id, root, { read, warnings: draftWarnings }) : undefined;
  record = updateStatus("stopping", { target, root });
  record = readRecord(record.id, root);
  record.status = draft ? "draft_created" : "stopped";
  record.stoppedAt = new Date().toISOString();
  writeRecord(record, root);
  writeActiveIds(activeIds(root).filter((id) => id !== record.id), root);
  const warnings = [...(record.trace?.warnings || []), ...draftWarnings];
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
  isReplayCandidate,
  readRecord,
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
