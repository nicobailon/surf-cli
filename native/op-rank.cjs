// Ranks the requests a capture holds by how likely each carries the page's data. Scores come from
// fixed integer rules, so the same capture always ranks the same way. The rules are the feat
// branch's record-candidates.cjs, read from the bodies in memory instead of stored summaries.

// Never the data: page assets, beacons, preflights and sockets.
const SKIPPED_TYPES = new Set(["Image", "Stylesheet", "Script", "Font", "Media", "Manifest", "Ping", "CSPViolationReport", "Preflight", "WebSocket", "EventSource", "TextTrack"]);
// A pick that leads the next request by less than this is weak.
const WEAK_LEAD = 3;
const TINY_BYTES = 64;
const MIN_PAGE_WORDS = 10;
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

const words = (text) => new Set(String(text).toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []);
const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ""; } };
const withoutHash = (url) => String(url || "").replace(/#.*$/, "");

/** A page's text without its tags, scripts and styles. */
function visibleText(html) {
  return html
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, name) => ENTITIES[name])
    .replace(/\s+/g, " ")
    .trim();
}

// The share (0 to 1) of the page's words that `found` holds.
function shareOf(pageWords, found) {
  let shared = 0;
  for (const word of pageWords) if (found.has(word)) shared++;
  return shared / pageWords.size;
}

/**
 * The share (0 to 1) of the words the tab shows that an HTML body holds, its script text counted
 * (a page that builds its list from an inline `var data`); undefined when the page shows too few.
 */
function pageShare(html, pageText) {
  const pageWords = words(pageText);
  if (pageWords.size < MIN_PAGE_WORDS) return undefined;
  const text = html.replace(/<(style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\\u[0-9a-f]{4}|\\[nrt]/gi, " ");
  return shareOf(pageWords, words(visibleText(text)));
}

// Same site: the hosts share their last two labels, or three under a two-letter country code with
// a short second level (example.co.uk).
function siteOf(host) {
  const labels = host.split(".");
  const take = labels.length > 2 && labels.at(-1).length === 2 && labels.at(-2).length <= 3 ? 3 : 2;
  return labels.slice(-take).join(".");
}

// The longest list of objects anywhere in a JSON value.
function recordCount(value, depth = 0) {
  if (depth > 6 || !value || typeof value !== "object") return 0;
  let best = 0;
  if (Array.isArray(value)) {
    const objects = value.filter((item) => item && typeof item === "object" && !Array.isArray(item)).length;
    if (objects > 0 && objects * 2 >= value.length) best = value.length;
  }
  for (const item of (Array.isArray(value) ? value : Object.values(value)).slice(0, 50)) best = Math.max(best, recordCount(item, depth + 1));
  return best;
}

function parsed(body) {
  try { return JSON.parse(body); } catch { return undefined; }
}

function kindOf(entry, body) {
  const mime = String(entry.mimeType || "").toLowerCase();
  if (mime.includes("json") || (!mime.includes("html") && /^\s*[[{]/.test(body) && parsed(body) !== undefined)) return "json";
  if (mime.includes("html") || (!mime && entry.type === "Document")) return "html";
  return "other";
}

function scoreEntry(entry, { pageUrl, pageWords, goalWords, after }) {
  const reasons = [];
  let score = 0;
  const add = (points, reason) => {
    score += points;
    reasons.push(reason);
  };
  const body = typeof entry.responseBody === "string" && entry.responseBodyEncoding !== "base64" ? entry.responseBody : "";
  const kind = kindOf(entry, body);
  const document = entry.type === "Document";
  if (kind === "json") add(4, "JSON");
  else if (kind === "html") add(document ? 4 : 2, document ? "HTML document" : "HTML");
  const records = kind === "json" ? recordCount(parsed(body)) : 0;
  if (records >= 2) add(3, `${records} records`);
  const page = hostOf(pageUrl);
  if (page && hostOf(entry.url)) {
    if (siteOf(hostOf(entry.url)) === siteOf(page)) add(2, "same site");
    else add(-2, `another site (${hostOf(entry.url)})`);
  }
  if (document && withoutHash(entry.url) === withoutHash(pageUrl)) add(2, "the page itself");
  if (pageWords.size >= MIN_PAGE_WORDS && body) {
    const share = shareOf(pageWords, words(kind === "html" ? visibleText(body) : body));
    if (share >= 0.1) add(share >= 0.8 ? 5 : share >= 0.3 ? 3 : 1, `${Math.round(share * 100)}% of the page's words`);
  }
  if (after !== undefined && entry.ts >= after) add(5, "sent after the --do steps");
  const where = (() => { try { const url = new URL(entry.url); return `${url.pathname}${url.search}`.toLowerCase(); } catch { return ""; } })();
  if ([...goalWords].some((word) => where.includes(word.replace(/s$/, "")))) add(2, "names the goal");
  // A body the capture skipped (too large, binary) is no tiny one.
  if (typeof entry.responseBody === "string" && Buffer.byteLength(body) < TINY_BYTES) add(-3, "tiny body");
  return { entry, score, reasons, effect: ["GET", "HEAD"].includes(String(entry.method).toUpperCase()) ? "read" : "write" };
}

const WRITE_GOAL = /\b(?:send|submit|post|create|add|order|book|reply|comment|update|delete|remove|save|register|subscribe|buy|pay|upload|edit|vote)\b/i;

/**
 * The captured requests that can carry data, scored, best first; a tie goes to the later request.
 * `after` (epoch ms) marks when the --do steps started. A write may have been answered with a
 * redirect (a form POST). When the goal asks for a write (send, post, order...), writes rank first.
 */
function rankRequests(entries, { pageUrl, pageText = "", goal = "", after } = {}) {
  const context = { pageUrl, pageWords: words(pageText), goalWords: words(goal), after };
  const write = (entry) => !["GET", "HEAD"].includes(String(entry.method).toUpperCase());
  const first = (candidate) => (WRITE_GOAL.test(goal) && candidate.effect === "write" ? 1 : 0);
  return entries
    .map((entry, index) => ({ entry, index }))
    // A load that failed after its answer keeps its status (an aborted 200) but holds no data.
    .filter(({ entry }) => entry.status >= 200 && entry.status < (write(entry) ? 400 : 300) && !entry.flags?.includes("failed") && entry.method !== "OPTIONS" && !SKIPPED_TYPES.has(entry.type) && /^https?:/.test(entry.url))
    .map(({ entry, index }) => ({ ...scoreEntry(entry, context), index }))
    .sort((a, b) => first(b) - first(a) || b.score - a.score || b.index - a.index)
    .map(({ index: _index, ...candidate }) => candidate);
}

/**
 * --match's best request (`POST`, `POST /comments` or a URL part); else the top one, unless it
 * leads the next by under WEAK_LEAD points.
 */
function pickRequest(ranked, { match } = {}) {
  if (match !== undefined) {
    const [, method, part = ""] = String(match).match(/^(GET|HEAD|POST|PUT|PATCH|DELETE)(?:\s+(.+))?$/) || [null, null, match];
    const found = ranked.find((candidate) => (!method || String(candidate.entry.method).toUpperCase() === method) && candidate.entry.url.includes(part));
    return found ? { pick: found } : { error: `no captured request's URL holds "${match}"` };
  }
  const [top] = ranked;
  if (!top) return { error: "the capture holds no request to pick" };
  // A read leads the reads, a write the writes.
  const next = ranked.slice(1).find((candidate) => candidate.effect === top.effect);
  const lead = top.score - (next?.score ?? 0);
  if (lead >= WEAK_LEAD) return { pick: top };
  return { weak: `${top.entry.method} ${top.entry.url} leads ${next ? next.entry.url : "nothing"} by ${lead} points (it needs ${WEAK_LEAD})` };
}

/** The shortest part of the top request's URL that no other candidate's holds: its path, or path and query. */
function matchHint(ranked) {
  const url = new URL(ranked[0].entry.url);
  const parts = [url.pathname, `${url.pathname}${url.search}`, url.href];
  return parts.find((part) => ranked.slice(1).every((candidate) => !candidate.entry.url.includes(part))) || url.href;
}

module.exports = { matchHint, pageShare, pickRequest, rankRequests, siteOf, visibleText };
