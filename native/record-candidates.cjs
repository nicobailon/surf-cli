// Ranks a record's captured requests by how likely each is the one that carries the page's data.
// Scores are integers from fixed rules, so the same trace always ranks the same way.

const { echoSecrets, isEchoedJson, redactCredentialLiterals, redactEchoJson, redactEchoText, redactSensitiveFields, redactValues, secretHeaderEchoes, valueSpellings } = require("./redaction.cjs");
const { ASSET_TYPES, hostname, isReplayCandidate, isTelemetryRequest, requestEffect } = require("./request-kinds.cjs");

const SAMPLE_CHARS = 200;
const TEXT_SAMPLE_CHARS = 120;
// Below this the best request is a weak match: no JSON or HTML document on the record's own site.
const WEAK_SCORE = 5;
// How far the best read must lead the next for pb client derive to take it without --request-id.
const WINNER_MARGIN = 3;
const TINY_BYTES = 64;
// Overlap is the share of the page's words found in a response. A response holding nearly all of
// them is the page's own data (+5, above any JSON's records bonus). A small JSON holding under
// LOW_OVERLAP of them is a side request (-3) when it lists no records, or when it is the web
// manifest or its path reads like a banner or announcements feed, whose records don't count
// either. The path is only a guess, so such a JSON keeps `unguessedScore`, what it would score
// with its records counted, and pb record stop warns when that would have beaten the pick. A JSON
// with records whose text isn't on the page (a chart's numbers) keeps its records bonus.
const HEAVY_OVERLAP = 0.8;
const LOW_OVERLAP = 0.1;
const SMALL_JSON_BYTES = 16 * 1024;
const SIDE_PATH = /(?:^|[^a-z])(?:announcements?|banners?)(?:[^a-z]|$)/i;
// The page's words, capped so a huge page stays cheap; fewer than MIN_PAGE_WORDS gives no overlap.
const PAGE_WORD_LIMIT = 2000;
const MIN_PAGE_WORDS = 10;

function words(text, limit = Infinity) {
  const found = new Set();
  for (const match of String(text).toLowerCase().matchAll(/[\p{L}\p{N}]{4,}/gu)) {
    found.add(match[0]);
    if (found.size >= limit) break;
  }
  return found;
}

const pageWords = (text) => words(text || "", PAGE_WORD_LIMIT);

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

function visibleText(html) {
  return html
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, name) => ENTITIES[name])
    .replace(/\s+/g, " ")
    .trim();
}

function mimeOf(entry) {
  const header = Object.entries(entry.responseHeaders || {}).find(([name]) => name.toLowerCase() === "content-type");
  return String(entry.mimeType || header?.[1] || "").toLowerCase();
}

function kindOf(entry, body) {
  const mime = mimeOf(entry);
  if (mime.includes("json")) return "json";
  if (mime.includes("html")) return "html";
  if (body !== undefined && /^\s*[[{]/.test(body)) {
    try { JSON.parse(body); return "json"; } catch {}
  }
  if (!mime && entry.type === "Document") return "html";
  if (mime.startsWith("text/") || /xml|javascript/.test(mime)) return "text";
  return "other";
}

// The longest array of objects anywhere in a JSON value: how many records it holds.
function recordCount(value, depth = 0) {
  if (depth > 6 || !value || typeof value !== "object") return 0;
  const items = Array.isArray(value) ? value : Object.values(value);
  let best = 0;
  if (Array.isArray(value)) {
    const objects = value.filter((item) => item && typeof item === "object" && !Array.isArray(item)).length;
    if (objects > 0 && objects * 2 >= value.length) best = value.length;
  }
  for (const item of items.slice(0, 50)) best = Math.max(best, recordCount(item, depth + 1));
  return best;
}

function parseJson(body) {
  try { return { value: JSON.parse(body) }; } catch { return null; }
}

const typeOf = (value) => (value === null ? "null" : Array.isArray(value) ? "array" : typeof value);
// Keys that read as field names, for the live listing; a key such as an email is left out there.
const FIELD_NAME = /^[A-Za-z_$][A-Za-z0-9_$-]{0,63}$/;
const MAX_FIELDS = 20;

// The fields of a JSON body's top level, or for a top-level list, of its first record. Keys can be
// data (a map keyed by username or account), so what is saved is only how many fields there are
// and how many of each type; `names` adds the names with their types, for live ranking only.
function fieldsOf(value, { names = false, hide = () => false } = {}) {
  const shape = Array.isArray(value) ? value.find((item) => item && typeof item === "object" && !Array.isArray(item)) : value;
  if (!shape || typeof shape !== "object" || Array.isArray(shape)) return {};
  const entries = Object.entries(shape);
  if (entries.length === 0) return {};
  const types = {};
  for (const type of entries.map(([, item]) => typeOf(item)).sort()) types[type] = (types[type] || 0) + 1;
  const named = entries.filter(([name]) => FIELD_NAME.test(name) && !hide(name)).slice(0, MAX_FIELDS);
  return {
    fields: entries.length,
    types,
    ...(names && named.length > 0 ? { fieldNames: Object.fromEntries(named.map(([name, item]) => [name, typeOf(item)])) } : {}),
  };
}

// A view of a response kept in place of its body: its kind, size, how many records a JSON body
// holds, how many fields it has of each type, and what share of the page's words it contains. No
// values, text or field names, so a trace on disk holds nothing the response said. `sample` (live
// ranking only, never saved) adds the field names and a short redacted sample of JSON or of an
// HTML page's visible text. The sample never holds a value in `redact` (what the record typed), and
// holds a secret header value of the exchange only as network.get would show it (see
// secretHeaderEchoes), as a response can reflect either; the field names leave out a name that holds
// one.
// `page` is pageWords() of the page's visible text. Page assets get none.
function summarizeResponse(entry, page, { sample: withSample = false, redact = [] } = {}) {
  if (ASSET_TYPES.has(entry.type)) return undefined;
  const body = typeof entry.responseBody === "string" && entry.responseBodyEncoding !== "base64" ? entry.responseBody : undefined;
  const capture = entry.bodyCapture || {};
  const bytes = capture.capturedBytes ?? capture.sizeBytes ?? entry.responseBodySize ?? (body === undefined ? undefined : Buffer.byteLength(body));
  const kind = kindOf(entry, body);
  const summary = { kind, ...(bytes !== undefined ? { bytes } : {}) };
  if (body === undefined) return capture.reason ? { ...summary, unsampled: capture.reason } : summary;
  let text = body;
  let sample = "";
  // What a response can reflect: the record's typed text and the exchange's secret header values.
  const typed = withSample ? redact.flatMap(valueSpellings) : [];
  const headers = secretHeaderEchoes(withSample ? [entry.requestHeaders, entry.responseHeaders] : []);
  const hide = (name) => headers.keys.includes(name) || redactValues(name, [...typed, ...headers.long]) !== name;
  // A JSON body is judged against both, so one that is a typed value whole goes whole too.
  const echoed = echoSecrets(withSample ? redact : []);
  const secrets = Object.fromEntries(["long", "short", "keys"].map((key) => [key, [...headers[key], ...echoed[key]]]));
  const parsed = kind === "json" ? parseJson(body) : null;
  if (parsed) {
    const records = recordCount(parsed.value);
    if (records > 0) summary.records = records;
    // A body that is a secret or typed value whole lists no field names, as its sample shows none. It
    // is judged as sent, before its secret-named fields are redacted, so `{"token":"shop"}` still counts.
    const whole = withSample && isEchoedJson(parsed.value, secrets);
    Object.assign(summary, fieldsOf(parsed.value, { names: withSample && !whole, hide }));
    if (whole) sample = JSON.stringify("<redacted>");
    else if (withSample) sample = JSON.stringify(redactEchoJson(redactSensitiveFields(parsed.value), secrets));
  } else if (kind === "html") {
    text = visibleText(body);
    if (withSample) sample = redactEchoText(text, secrets);
  }
  if (page.size >= MIN_PAGE_WORDS) {
    const found = words(text);
    let shared = 0;
    for (const word of page) if (found.has(word)) shared++;
    summary.overlap = Math.round((shared / page.size) * 100) / 100;
  }
  if (withSample && sample) {
    sample = redactCredentialLiterals(redactValues(sample, typed)).slice(0, SAMPLE_CHARS);
    if (sample) summary.sample = sample;
  }
  return summary;
}

const RECORDS_POINTS = 3;
const SIDE_POINTS = -3;

const isManifest = (entry) => entry.type === "Manifest" || mimeOf(entry).includes("manifest+json");

// A path that reads like a site banner or announcements feed: a guess, unlike the manifest's type.
function hasSidePath(entry) {
  try {
    return SIDE_PATH.test(new URL(entry.url).pathname);
  } catch {
    return false;
  }
}

// Same site: the hosts share their last two labels, or three under a two-letter country code
// with a short second level (example.co.uk).
function siteOf(host) {
  const labels = host.split(".");
  const take = labels.length > 2 && labels.at(-1).length === 2 && labels.at(-2).length <= 3 ? 3 : 2;
  return labels.slice(-take).join(".");
}

function scoreEntry(entry, origin) {
  const reasons = [];
  let score = 0;
  const add = (points, reason) => {
    score += points;
    reasons.push(reason);
  };
  const effect = requestEffect(entry);
  if (effect === "write") reasons.push(`write (${entry.method})`);
  const telemetry = isTelemetryRequest(entry, origin);
  const asset = ASSET_TYPES.has(entry.type);
  const preflight = entry.method === "OPTIONS" || entry.type === "Preflight";
  const summary = entry.responseSummary || {};
  const kind = summary.kind || kindOf(entry);
  if (telemetry) add(-10, "telemetry");
  if (asset) add(-8, `page asset (${entry.type})`);
  if (preflight) add(-8, "CORS preflight");
  const ok = entry.status >= 200 && entry.status < 400;
  const emptyRedirect = ok && entry.status >= 300 && !summary.bytes;
  if (!ok) add(-6, entry.status ? `status ${entry.status}` : "no response");
  else if (emptyRedirect) add(-6, "redirect without a body");
  if (!telemetry && !asset && !preflight && !emptyRedirect) {
    if (kind === "json") add(4, "JSON");
    else if (kind === "html") add(entry.type === "Document" ? 4 : 2, entry.type === "Document" ? "HTML document" : "HTML");
  }
  const hasRecords = summary.records >= 2;
  const smallLowJson = kind === "json" && summary.overlap < LOW_OVERLAP && summary.bytes < SMALL_JSON_BYTES;
  const manifest = smallLowJson && isManifest(entry);
  const guessedSide = smallLowJson && hasRecords && !manifest && hasSidePath(entry);
  const sideJson = smallLowJson && (!hasRecords || manifest || guessedSide);
  if (hasRecords && !sideJson) add(RECORDS_POINTS, `${summary.records} records`);
  else if (guessedSide) reasons.push(`${summary.records} records not counted (the path reads like a banner or announcements feed)`);
  const site = hostname(origin);
  const host = hostname(entry.url);
  if (site && host) {
    if (siteOf(host) === siteOf(site)) add(2, "first-party");
    else add(-2, `third-party (${host})`);
  }
  const overlap = `overlaps ${Math.round(summary.overlap * 100)}% of the page text`;
  if (summary.overlap >= LOW_OVERLAP) add(summary.overlap >= HEAVY_OVERLAP ? 5 : summary.overlap >= 0.3 ? 3 : 1, overlap);
  else if (sideJson) add(SIDE_POINTS, `small JSON that ${overlap}`);
  if (summary.bytes !== undefined && summary.bytes < TINY_BYTES && ok && !emptyRedirect) add(-3, `tiny body (${summary.bytes} B)`);
  return {
    score,
    reasons,
    effect,
    eligible: isReplayCandidate(entry) && !telemetry && !preflight,
    listsRecords: kind === "json" && hasRecords && !manifest,
    ...(guessedSide ? { unguessedScore: score + RECORDS_POINTS - SIDE_POINTS } : {}),
  };
}

// Every entry scored, best first; ties go to the later request (the pick before ranking).
function scoreEntries(entries, { origin } = {}) {
  return entries
    .map((entry, index) => ({ entry, index, ...scoreEntry(entry, origin) }))
    .sort((a, b) => b.score - a.score || b.index - a.index);
}

function rankCandidates(entries, options) {
  return scoreEntries(entries, options).map(({ entry, score, reasons, effect, eligible }, index) => {
    const summary = entry.responseSummary || {};
    return {
      rank: index + 1,
      id: entry.id,
      method: entry.method,
      status: entry.status,
      type: entry.type,
      mimeType: entry.mimeType,
      url: entry.url,
      ...(summary.bytes !== undefined ? { bytes: summary.bytes } : {}),
      score,
      reasons,
      effect,
      eligible,
      ...(summary.fields ? { fields: summary.fields, types: summary.types } : {}),
      ...(summary.fieldNames ? { fieldNames: summary.fieldNames } : {}),
      ...(summary.sample ? { sample: summary.sample } : {}),
      ...(summary.unsampled ? { unsampled: summary.unsampled } : {}),
    };
  });
}

const isWeak = (candidate) => candidate.score < WEAK_SCORE;

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function trimQuery(url) {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function formatCandidates({ recordId, site, op, live, total, candidates, warnings = [] }) {
  const shown = candidates.length < total ? `; top ${candidates.length} shown` : "";
  const lines = [`${recordId} (${site} ${op}): ${total} requests, best first${live ? ", read live (still recording)" : ""}${shown}`];
  for (const item of candidates) {
    const size = item.bytes !== undefined ? `  ${formatSize(item.bytes)}` : "";
    lines.push(`${item.rank}. ${item.id}  ${item.method} ${item.status ?? "-"} ${item.type ?? "-"} ${item.mimeType || "-"}  ${trimQuery(item.url)}${size}  score ${item.score}${item.eligible ? "" : "  (never picked)"}`);
    if (item.reasons.length > 0) lines.push(`   ${item.reasons.join(", ")}`);
    if (item.sample) lines.push(`   ${JSON.stringify(item.sample.length > TEXT_SAMPLE_CHARS ? `${item.sample.slice(0, TEXT_SAMPLE_CHARS)}…` : item.sample)}`);
    else if (item.fieldNames) lines.push(`   fields: ${Object.entries(item.fieldNames).map(([name, type]) => `${name} (${type})`).join(", ")}`);
    else if (item.fields) lines.push(`   fields: ${item.fields} (${Object.entries(item.types).sort(([a], [b]) => a.localeCompare(b)).map(([type, count]) => `${type} ${count}`).join(", ")})`);
    else if (item.unsampled) lines.push(`   (no sample: ${item.unsampled})`);
  }
  for (const warning of warnings) lines.push(`Warning: ${warning}`);
  lines.push(live ? "Choose one: surf pb record stop --draft --request-id <id>" : `Choose one: surf pb save --from-record ${recordId} --request-id <id>`);
  return lines.join("\n");
}

module.exports = {
  SAMPLE_CHARS,
  WEAK_SCORE,
  WINNER_MARGIN,
  formatCandidates,
  isWeak,
  pageWords,
  rankCandidates,
  scoreEntries,
  summarizeResponse,
  visibleText,
};
