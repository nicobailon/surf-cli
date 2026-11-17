const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  appendPrivateJsonLine,
  assertWithin,
  atomicWriteFile,
  atomicWriteJson,
  ensurePrivateDir,
  getPrivateStateRoot,
  readPrivateFile,
  readPrivateJson,
} = require("./private-state.cjs");
const { bodyContentType, redactEchoBody, redactEchoText, redactEchoUrl, redactSensitiveFields, redactUrlSecrets, safeHeaders, secretHeaderEchoes } = require("./redaction.cjs");
const { draftedEvents, forgetTypedValues, heldTypingCalls, maskTypedValuesInUrl, numberRedactedMarkers, redactTypedValuesInUrl, rememberTypedValues, typedValuesForTrace } = require("./record-typed-values.cjs");
const { commandMetadata, promoteRedactedStepArgs } = require("./workflow-definition.cjs");
const { escapeStepArgs, escapeTemplates } = require("./playbook-template.cjs");
const { describeCaptureGaps } = require("./formatters/network.cjs");
const { ASSET_TYPES, REPLAYED_METHODS, isReplayCandidate, isTelemetryRequest, requestEffect, shownUrl } = require("./request-kinds.cjs");
const { WINNER_MARGIN, isWeak, pageWords, rankCandidates, scoreEntries, summarizeResponse } = require("./record-candidates.cjs");
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

// Holds the values a command types for the caller's record, in memory (see
// record-typed-values.cjs), even while paused, so the trace's URLs can be redacted at stop.
// `evented: false`: no typing event of its own follows (a batch's actions).
function rememberRecordInput(command, args, { target, evented = true, root = getPrivateStateRoot() } = {}) {
  const record = recordFor(target, root);
  if (record) rememberTypedValues(record.id, command, args, { evented: evented && record.status === "recording" });
}

// The values the record's steps typed so far, each with its marker; none with --include-input-values.
function typedSoFar(record, root) {
  const calls = heldTypingCalls(record.id);
  if (record.redaction?.includeInputValues === true || calls.length === 0) return [];
  return typedValuesForTrace(readEvents(record.id, root), calls).typed;
}

// A watch event carries the page's URL, which can hold a value a step typed (a results page's ?q=).
// `urlMarkers` lists the markers surf put in it, so a later pass leaves them as they are.
function redactWatchEvent(event, typed) {
  if (event.type !== "browser.event" || typeof event.url !== "string" || typed.length === 0) return event;
  const { urlMarkers: _markers, ...rest } = event;
  const { url, markers } = maskTypedValuesInUrl(event.url, typed, { markers: event.urlMarkers });
  return { ...rest, url, ...(markers.length ? { urlMarkers: markers } : {}) };
}

// `args` are the command's arguments as given, for rememberRecordInput. A host-owned workflow
// passes them to rememberRecordInput itself, before its event comes without them.
function appendRecordEvent(event, { target, args, root = getPrivateStateRoot() } = {}) {
  if (args) rememberRecordInput(event.command, args, { target, root });
  const record = recordFor(target, root);
  if (!record || record.status !== "recording") return false;
  appendToRecord(record, redactWatchEvent(event, typedSoFar(record, root)), root);
  return true;
}

// At stop, redacts the watch events again with every value typed: a navigation the typing itself
// caused (type --submit) can be written before the typing step ends.
function redactWatchEvents(record, root) {
  const typed = typedSoFar(record, root);
  if (typed.length === 0) return;
  const events = readEvents(record.id, root);
  const redacted = events.map((event) => redactWatchEvent(event, typed));
  if (redacted.every((event, index) => JSON.stringify(event) === JSON.stringify(events[index]))) return;
  atomicWriteFile(path.join(recordDirectory(record.id, root), "events.jsonl"), redacted.map((event) => `${JSON.stringify(event)}\n`).join(""), { root, encoding: "utf8" });
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

// A URL header (referer, location) can hold a typed value as the request URL can.
function redactTypedHeaders(headers, typed) {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, /^(referer|location)$/i.test(name) ? redactTypedValuesInUrl(String(value), typed) : value]));
}

// The trace drops secret headers, so the values they held are known only here: the URL, a header or
// a request body kept in the trace that echoes one has it replaced with <redacted> before it is saved.
// A short value goes only where it is a whole value, so a draft keeps its query names and a valid
// JSON body (see redactEchoText and redactEchoBody). `typed` lists the values the record's steps
// typed; each becomes its marker in the entry's URLs, after the echoes go, so the markers' offsets
// hold. `urlMarkers` lists the markers in the entry's URL, with the JSON type of a number or boolean one.
function sanitizeTraceEntry(entry, includeInputValues = false, typed = []) {
  const secrets = secretHeaderEchoes([entry.requestHeaders, entry.responseHeaders]);
  const scrub = (value) => (typeof value === "string" ? redactEchoText(value, secrets) : value);
  const keptHeaders = (headers) => redactTypedHeaders(Object.fromEntries(Object.entries(safeHeaders(headers)).map(([name, value]) => [name, scrub(value)])), typed);
  const { url, markers } = maskTypedValuesInUrl(redactEchoUrl(redactUrlSecrets(entry.url), secrets), typed, { body: entry.requestBody });
  return {
    ...redactSensitiveFields(entry),
    url,
    ...(markers.length ? { urlMarkers: markers } : {}),
    ...(entry.tabUrl !== undefined ? { tabUrl: redactTypedValuesInUrl(redactEchoUrl(redactUrlSecrets(entry.tabUrl), secrets), typed) } : {}),
    requestHeaders: keptHeaders(entry.requestHeaders),
    responseHeaders: keptHeaders(entry.responseHeaders),
    responseBody: entry.responseBody === undefined ? undefined : "<response-body>",
    requestBody: entry.requestBody === undefined ? undefined : includeInputValues ? (typeof entry.requestBody === "string" ? redactEchoBody(entry.requestBody, secrets, { contentType: bodyContentType(entry.requestHeaders) }) : entry.requestBody) : "<request-body>",
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
// live ranking only: entries with samples are never written. `includeInputValues` keeps the values
// for a record started without it (pb record stop --include-input-values).
function sanitizeTraceEntries(record, entries, pageText, { sample = false, redact = [], includeInputValues = false, root = getPrivateStateRoot() } = {}) {
  const page = pageWords(pageText);
  const keepValues = includeInputValues || record.redaction?.includeInputValues === true;
  const typed = keepValues ? [] : typedValuesForTrace(readEvents(record.id, root), heldTypingCalls(record.id)).typed;
  return entries.map((entry) => {
    const responseSummary = summarizeResponse(entry, page, { sample, redact });
    return sanitizeTraceEntry(responseSummary ? { ...entry, responseSummary } : entry, keepValues, typed);
  });
}

// `capture` is the extension's capture status when the trace was read, and `truncatedAt` the read
// limit when the read returned that many entries. Without a status, or with a gap, dropped entries
// or a truncated read, the trace is incomplete and can't show that a flow sent no writes.
function attachNetworkTrace(recordId, entries, root = getPrivateStateRoot(), { capture, truncatedAt, pageText, includeInputValues = false } = {}) {
  const record = readRecord(recordId, root);
  if (!record) throw new Error(`record not found: ${recordId}`);
  const keepValues = includeInputValues || record.redaction?.includeInputValues === true;
  const sanitized = sanitizeTraceEntries(record, entries, pageText, { includeInputValues: keepValues, root });
  const warnings = capture
    ? describeCaptureGaps(capture, { atStop: true })
    : ["the extension did not report whether network capture ran (it may be older than this Surf); requests may be missing"];
  if (truncatedAt) warnings.push(`the trace holds only the first ${truncatedAt} requests read from the tab; later ones are missing`);
  if (!keepValues) {
    const { unheld } = typedValuesForTrace(readEvents(recordId, root), heldTypingCalls(recordId));
    if (unheld > 0) warnings.push(unheld === 1
      ? "1 typing step entered a value this Surf host no longer holds (it restarted during the record), so it may remain in the trace's URLs"
      : `${unheld} typing steps entered values this Surf host no longer holds (it restarted during the record), so they may remain in the trace's URLs`);
  }
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
  if (write) return { effect: "write", because: `it captured ${shownUrl(write)}` };
  const acted = steps.find(pageWrite);
  if (acted) return { effect: "write", because: `it ran ${acted.tool}, a page write` };
  return { effect: "read" };
}

const NO_REPLAY = "the draft has no network strategy: the trace holds no request it can replay (telemetry, page assets and preflights are never replayed)";

// Why a draft never replays this request, or nothing when it may.
function neverReplayed(entry, origin) {
  if (isTelemetryRequest(entry, origin)) return "telemetry";
  if (ASSET_TYPES.has(entry.type)) return `a page asset (${entry.type})`;
  if (entry.method === "OPTIONS" || entry.type === "Preflight") return "a CORS preflight";
  if (!REPLAYED_METHODS.has(entry.method)) return `a ${entry.method} (a draft replays only GET, HEAD, POST, PUT, PATCH and DELETE)`;
  if (!isReplayCandidate(entry)) return `a ${entry.method} answered with status ${entry.status ?? "none"}`;
  return "";
}

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
  const sameEffect = eligible.filter((candidate) => candidate.effect === (capturedWrite ? "write" : "read"));
  const [top, next] = sameEffect;
  if (!top) {
    warnings.push(capturedWrite
      ? `the draft has no network strategy: it is a write because of ${shownUrl(capturedWrite)}, which is ${neverReplayed(capturedWrite, record.origin)}, and a write draft never replays a read in its place`
      : NO_REPLAY);
    return undefined;
  }
  const choose = `run surf pb record candidates ${record.id} and choose with --request-id`;
  // A document over the capture cap can't be compared with the page, so a JSON with records may hold
  // the page's data instead.
  const unmeasured = top.entry.type === "Document" && top.entry.responseSummary?.unsampled;
  const records = unmeasured && sameEffect.find((candidate) => candidate.listsRecords);
  // Records left out only because of a banner-like path, which might be the page's data after all.
  const guessed = sameEffect.find((candidate) => candidate !== top && candidate.unguessedScore >= top.score);
  if (isWeak(top)) warnings.push(`the draft's network strategy, ${shownUrl(top.entry)}, is a weak match (score ${top.score}); ${choose}`);
  else if (guessed) {
    warnings.push(`the draft's network strategy, ${shownUrl(top.entry)} (score ${top.score}), was picked over ${shownUrl(guessed.entry)} (score ${guessed.score}), whose ${guessed.entry.responseSummary.records} records weren't counted because its path reads like a banner or announcements feed; counted, it would score ${guessed.unguessedScore}; ${choose}`);
  } else if (records) {
    warnings.push(`the draft's network strategy, ${shownUrl(top.entry)} (score ${top.score}), is a document too large to compare with the page (${unmeasured}), and ${shownUrl(records.entry)} (score ${records.score}) holds ${records.entry.responseSummary.records} records; ${choose}`);
  } else if (next && top.score - next.score < WINNER_MARGIN) {
    warnings.push(`the draft's network strategy, ${shownUrl(top.entry)} (score ${top.score}), ${top.score === next.score ? "ties with" : "is close to"} ${shownUrl(next.entry)} (score ${next.score}); ${choose}`);
  }
  return top.entry;
}

// The request's URL and its query as inputs. The query format holds one value a name, so a name
// that repeats (`?tag=1&tag=2`) stays in the URL as captured, with a warning, and goes out with
// every value.
function draftQuery(captured, warnings) {
  const url = new URL(captured);
  const counts = new Map();
  for (const name of url.searchParams.keys()) counts.set(name, (counts.get(name) || 0) + 1);
  const repeated = new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
  const query = Object.fromEntries([...url.searchParams].filter(([name]) => !repeated.has(name)));
  const nameOf = (part) => new URLSearchParams(part).keys().next().value ?? "";
  url.search = url.search.slice(1).split("&").filter((part) => part && repeated.has(nameOf(part))).join("&");
  for (const name of repeated) {
    warnings.push(`query param "${name}" repeats (${counts.get(name)} values), so the draft keeps it in the request URL, where pb param can't make it an input`);
  }
  return { url, query };
}

// The request a network strategy sends to replay a captured trace entry: its query apart (see
// draftQuery), its headers without secrets, and its body as captured (`<request-body>` without
// input values). Text that reads like an input (`{{action}}`) is escaped, so it is sent as
// captured. A typed number or boolean the record masked in a JSON query value is kept as
// redactedTypes: pb param gives its input that type. One masked under a query key sent more than
// once has no type, and its key is kept in repeatedQuery, a note that is never sent: the key stays
// in the URL with every value. `warnings` collects why the request keeps a query name in its URL.
function requestFromEntry(entry, warnings = []) {
  const { url, query } = draftQuery(entry.url, warnings);
  const typedMarkers = (entry.urlMarkers || []).filter((marker) => marker.type);
  const redactedTypes = Object.fromEntries(typedMarkers.filter((marker) => marker.field).map((marker) => [marker.field, marker.type]));
  const repeatedQuery = [...new Set(typedMarkers.filter((marker) => marker.repeatedKey).map((marker) => marker.repeatedKey))];
  return {
    ...escapeTemplates({ method: entry.method, url: url.toString(), query, headers: safeHeaders(entry.requestHeaders), ...(entry.requestBody !== undefined ? { body: entry.requestBody } : {}) }),
    ...(Object.keys(redactedTypes).length ? { redactedTypes } : {}),
    ...(repeatedQuery.length ? { repeatedQuery } : {}),
  };
}

// The input a write op without other inputs takes as its semantic safety key.
const REVIEW_KEY_ARG = { required: true, desc: "Semantic key for reviewed write replay" };

// The steps a record ran that a draft replays: its completed recordable commands, in order. Their
// arguments are escaped, so text like `{{review_key}}` in a recorded selector or URL is sent as
// recorded; a redacted value (`<text>`) still becomes an input, each typing step's its own
// (<text>, <text-2>), as the trace's URLs name them.
function recordedSteps(recordId, root = getPrivateStateRoot()) {
  return numberRedactedMarkers(draftedEvents(readEvents(recordId, root)).map((event) => ({ tool: event.command, args: escapeStepArgs(event.argsRedacted || {}) })));
}

// The op the draft builder makes from a record, and `because`, why it is a write. It writes
// nothing: pb save --from-record holds a draft file to it. `warnings` collects why the draft left
// something out. `requestId` picks the request to replay.
function buildDraft(record, { read = false, requestId, warnings = [], root = getPrivateStateRoot() } = {}) {
  const steps = recordedSteps(record.id, root);
  const tracePath = path.join(recordDirectory(record.id, root), "network", "trace.json");
  const trace = readPrivateJson(tracePath, null, { root });
  const { effect, warning, because } = draftEffect({ record, steps, trace, read });
  if (warning) warnings.push(warning);
  const strategies = [];
  const observed = pickRequest({ record, trace, effect, requestId, warnings });
  if (observed) strategies.push({ using: "network", request: requestFromEntry(observed, warnings) });
  let args = {};
  if (steps.length > 0) {
    const promoted = promoteRedactedStepArgs(steps);
    args = promoted.args;
    strategies.push({ using: "workflow", steps: promoted.steps });
  }
  if (strategies.length === 0) throw new Error("record has no executable evidence");
  const safety = effect === "write" ? { authorization: "explicit", duplicate: "transactional", key: Object.keys(args).length ? Object.keys(args) : ["review_key"] } : undefined;
  if (effect === "write" && !args.review_key && safety.key.includes("review_key")) args.review_key = REVIEW_KEY_ARG;
  const provenance = { recordId: record.id, ...(requestId ? { requestId } : {}) };
  const op = { id: record.op, description: `Drafted from ${record.id}`, effect, args, ...(safety ? { safety } : {}), run: strategies, provenance };
  return { op, because };
}

function draftFromRecord(recordId, root = getPrivateStateRoot(), options = {}) {
  const record = readRecord(recordId, root);
  if (!record) throw new Error(`record not found: ${recordId}`);
  const { op } = buildDraft(record, { ...options, root });
  const draftDir = path.join(recordDirectory(recordId, root), "draft");
  ensurePrivateDir(draftDir, root);
  atomicWriteJson(path.join(draftDir, "op.json"), op, { root });
  return op;
}

// The draft is made before the record stops, so a refused draft (--read) leaves it recording. The
// request --request-id names, and --read, are kept in the record, which pb save reads them from:
// the draft file is only a suggestion.
// `includeInputValues` (pb record stop --include-input-values) marks the record as kept, as if
// started with it; the host passes it to attachNetworkTrace first.
function stopRecord({ target, draft = false, read = false, requestId, includeInputValues = false, root = getPrivateStateRoot() } = {}) {
  if (read && !draft) throw new Error("--read applies only with --draft");
  if (requestId && !draft) throw new Error("--request-id applies only with --draft");
  let record = requireRecordFor(target, root);
  const draftWarnings = [];
  const op = draft ? draftFromRecord(record.id, root, { read, requestId, warnings: draftWarnings }) : undefined;
  record = updateStatus("stopping", { target, root });
  record = readRecord(record.id, root);
  redactWatchEvents(record, root);
  forgetTypedValues(record.id);
  record.status = draft ? "draft_created" : "stopped";
  record.stoppedAt = new Date().toISOString();
  if (requestId) record.requestId = requestId;
  if (read) record.read = true;
  if (includeInputValues) record.redaction = { ...record.redaction, includeInputValues: true };
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

// The text a record's steps and page inputs typed, so a live sample can leave it out. `known` is
// false when the record typed something it didn't keep (a record without --include-input-values,
// or a password field), so the text can't be found to redact.
function typedInputs(record, root) {
  const values = [];
  const collect = (value) => {
    if (typeof value === "string" || typeof value === "number") values.push(String(value));
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  let known = true;
  for (const event of readEvents(record.id, root)) {
    if (event.type === "browser.event" && event.event === "input") {
      if (typeof event.value !== "string" || event.value === "<input>") known = false;
      else values.push(event.value);
      continue;
    }
    if (typeof event.command !== "string" || !event.argsRedacted) continue;
    // A key step's named key (Enter) was kept as no one's data; `<key>` was a typed character.
    const typing = commandMetadata(event.command, event.argsRedacted).sensitiveArgs;
    for (const name of commandMetadata(event.command).sensitiveArgs) {
      const value = event.argsRedacted[name];
      if (value === undefined) continue;
      if (value === `<${name}>`) known = false;
      else if (typing.includes(name)) collect(value);
    }
  }
  return { known, values: values.filter(Boolean) };
}

// Ranks a record's requests, best first. An active record has no trace yet, so the host reads its
// requests from the tab and passes them as `live` ({ entries, pageText }); only then does the
// result carry response samples, held in memory and printed, never saved.
function recordCandidates(record, { root = getPrivateStateRoot(), limit = 10, live } = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer");
  let entries;
  let warnings = [];
  if (live) {
    const typed = typedInputs(record, root);
    entries = sanitizeTraceEntries(record, live.entries, live.pageText, { sample: typed.known, redact: typed.values, root });
    if (!typed.known) warnings = ["no response samples: the record typed text it didn't keep, which a response could show"];
  } else {
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
  forgetTypedValues(record.id);
  writeActiveIds(activeIds(root).filter((id) => id !== record.id), root);
  return { discarded: record.id };
}

module.exports = {
  REVIEW_KEY_ARG,
  activeRecords,
  appendRecordEvent,
  attachNetworkTrace,
  buildDraft,
  discardRecord,
  draftFromRecord,
  findCandidatesRecord,
  isActive,
  markRecord,
  neverReplayed,
  pauseRecord: (options) => updateStatus("paused", options),
  readEvents,
  rememberRecordInput,
  isReplayCandidate,
  readRecord,
  recordCandidates,
  recordStatus,
  recordedSteps,
  requestEffect,
  recordsRoot,
  requestFromEntry,
  requireRecordFor,
  resumeRecord: (options) => updateStatus("recording", options),
  startRecord,
  stopRecord,
  traceEntriesForRecord,
  updateRecordContext,
};
