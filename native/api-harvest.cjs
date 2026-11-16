// Harvests a page's own JSON API responses: wait for one, replay it with a new cursor, or
// drive the page to load the next one. Runners take an injected `executeTool` (host tools).

const { createRecordSet, readCursor } = require("./records.cjs");
const { hiddenTabError } = require("./dom-collect.cjs");
const { PATTERN_LIMIT } = require("./bounded-regex.cjs");
const { redactValues } = require("./redaction.cjs");

const POLL_MS = 500;
const DEFAULT_TIMEOUT_MS = 30000;
const REPLAY_CAPTURE_TIMEOUT_MS = 10000;
const DRIVE_WAIT_MS = 4000;
const DRIVE_IDLE_SCROLLS = 3;
const DEFAULT_MAX_PAGES = 20;
const API_KEYS = ["open", "match", "records", "cursor", "mode", "maxPages", "timeoutMs", "allowPost"];
// Headers fetch rejects or the browser owns.
const DROPPED_HEADERS = new Set([
  "accept-charset", "accept-encoding", "access-control-request-headers", "access-control-request-method",
  "connection", "content-length", "cookie", "cookie2", "date", "dnt", "expect", "host", "keep-alive",
  "origin", "priority", "referer", "te", "trailer", "transfer-encoding", "upgrade", "user-agent", "via",
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// A glob is checked when an op is saved and loaded, and over PATTERN_LIMIT characters it is
// refused; a URL whose tested part is over URL_TEST_LIMIT characters never matches. A match then
// takes at most PATTERN_LIMIT x URL_TEST_LIMIT steps (about 4 million, a few milliseconds).
const URL_TEST_LIMIT = 8 * 1024;

// A glob as tokens: a literal character, "*" (any run except /) or "**" (any run); "***" is "**" then "*".
function globTokens(pattern) {
  const tokens = [];
  for (let index = 0; index < pattern.length; index++) {
    if (pattern[index] !== "*") tokens.push(pattern[index]);
    else if (pattern[index + 1] === "*") {
      tokens.push("**");
      index++;
    } else tokens.push("*");
  }
  return tokens;
}

// Marks the states a star can skip: a star matches the empty run too.
function skipStars(tokens, states) {
  for (let index = 0; index < tokens.length; index++) {
    if (states[index] && (tokens[index] === "*" || tokens[index] === "**")) states[index + 1] = 1;
  }
}

// Steps every token position at once, one character at a time, so a match takes at most
// text length x pattern length steps, whatever the pattern: a backtracking regex of many ** can
// take exponential time.
function globMatches(tokens, text) {
  let states = new Uint8Array(tokens.length + 1);
  let next = new Uint8Array(tokens.length + 1);
  states[0] = 1;
  skipStars(tokens, states);
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    next.fill(0);
    let alive = false;
    for (let index = 0; index < tokens.length; index++) {
      if (!states[index]) continue;
      const token = tokens[index];
      if (token === "**" || (token === "*" && char !== "/")) next[index] = 1;
      else if (token === char) next[index + 1] = 1;
      else continue;
      alive = true;
    }
    if (!alive) return false;
    skipStars(tokens, next);
    [states, next] = [next, states];
  }
  return states[tokens.length] === 1;
}

/**
 * `match` glob: tested against the URL without query string; the whole URL when the
 * pattern has `://`, else the whole pathname. `*` = any run except `/`, `**` = anything.
 */
function urlMatcher(pattern) {
  if (typeof pattern !== "string" || !pattern) throw new Error("match must be a non-empty URL glob");
  if (pattern.length > PATTERN_LIMIT) throw new Error(`match is ${pattern.length} characters; the limit is ${PATTERN_LIMIT}`);
  if (/[?#]/.test(pattern)) {
    throw new Error(`match "${pattern}" must not contain ? or #: it is tested against the URL without its query string`);
  }
  const whole = pattern.includes("://");
  if (!whole && !pattern.startsWith("/")) {
    throw new Error(`match "${pattern}" must start with / (a path) or contain :// (a full URL)`);
  }
  const tokens = globTokens(pattern);
  return (url) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    const tested = whole ? `${parsed.origin}${parsed.pathname}` : parsed.pathname;
    return tested.length <= URL_TEST_LIMIT && globMatches(tokens, tested);
  };
}

function setJson(text, path, value, label) {
  const name = path.join(".");
  let doc;
  try {
    doc = typeof text === "string" ? JSON.parse(text) : undefined;
  } catch {
    doc = undefined;
  }
  if (!isPlainObject(doc)) throw new Error(`cannot set ${name}: ${label} is not a JSON object`);
  let node = doc;
  for (const segment of path.slice(0, -1)) {
    if (node[segment] === undefined) node[segment] = {};
    node = node[segment];
    if (!isPlainObject(node)) throw new Error(`cannot set ${name}: ${segment} in ${label} is not an object`);
  }
  node[path[path.length - 1]] = value;
  return JSON.stringify(doc);
}

/**
 * Applies replay `set` edits to `{ url, body }`: `query.<param>`, `query.<param>.<json.path>`,
 * `body`, `body.<json.path>`. Returns a new request; other request fields are kept.
 */
function applySet(request, set) {
  if (!isPlainObject(set)) throw new Error("set must be an object");
  const url = new URL(request.url);
  let body = request.body;
  for (const [key, value] of Object.entries(set)) {
    const [target, ...path] = key.split(".");
    if (path.some((segment) => !segment) || (target !== "query" && target !== "body") || (target === "query" && !path.length)) {
      throw new Error(`set key "${key}" must be query.<param>, query.<param>.<json.path>, body, or body.<json.path>`);
    }
    if (target === "body") {
      if (!path.length) body = typeof value === "string" ? value : JSON.stringify(value);
      else body = setJson(body, path, value, "the request body");
    } else if (path.length === 1) {
      url.searchParams.set(path[0], typeof value === "string" ? value : JSON.stringify(value));
    } else {
      const [param, ...jsonPath] = path;
      url.searchParams.set(param, setJson(url.searchParams.get(param), jsonPath, value, `query param "${param}"`));
    }
  }
  return { ...request, url: url.toString(), body };
}

/** `path=value` from the CLI; the value is parsed as JSON when it is valid JSON. */
function parseSetArgument(text) {
  const index = typeof text === "string" ? text.indexOf("=") : -1;
  if (index < 1) throw new Error(`--set needs path=value, got ${JSON.stringify(text)}`);
  const raw = text.slice(index + 1);
  try {
    return [text.slice(0, index), JSON.parse(raw)];
  } catch {
    return [text.slice(0, index), raw];
  }
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function validateApiSpec(spec) {
  if (!isPlainObject(spec)) throw new Error("api strategy must be an object");
  for (const key of Object.keys(spec)) {
    if (!API_KEYS.includes(key)) throw new Error(`api strategy has unknown key "${key}" (allowed: ${API_KEYS.join(", ")})`);
  }
  urlMatcher(spec.match);
  if (spec.records === undefined) throw new Error("api strategy needs records");
  createRecordSet(spec.records);
  if (spec.cursor !== undefined) {
    if (typeof spec.cursor?.into !== "string" || !/^(query\.[^.]+|body)(\.[^.]+)*$/.test(spec.cursor.into)) {
      throw new Error("api strategy cursor.into must be query.<param>[.<json.path>] or body[.<json.path>]");
    }
    readCursor({}, spec.cursor);
  }
  if (spec.mode !== undefined && !["auto", "replay", "drive"].includes(spec.mode)) throw new Error("api strategy mode must be auto, replay, or drive");
  if (spec.maxPages !== undefined) positiveInteger(spec.maxPages, "api strategy maxPages");
  if (spec.timeoutMs !== undefined) positiveInteger(spec.timeoutMs, "api strategy timeoutMs");
  if (spec.allowPost !== undefined && typeof spec.allowPost !== "boolean") throw new Error("api strategy allowPost must be a boolean");
  if (spec.open !== undefined && (typeof spec.open !== "string" || !spec.open)) throw new Error("api strategy open must be a URL");
  return spec;
}

function context({ executeTool, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now }) {
  if (typeof executeTool !== "function") throw new Error("executeTool is required");
  return { executeTool, sleep, now, seen: new Set() };
}

/** The longest literal run of a glob: a cheap substring filter for the network listing. */
function globLiteral(pattern) {
  return pattern.split(/\*+/).reduce((longest, part) => (part.length > longest.length ? part : longest), "");
}

async function listEntries(ctx, filter) {
  const result = await ctx.executeTool("network", { v: true, limit: 500, ...(filter ? { filter } : {}) });
  if (!Array.isArray(result?.entries)) throw new Error("network listing returned no entries");
  return result.entries;
}

async function markSeen(ctx, filter) {
  for (const entry of await listEntries(ctx, filter)) ctx.seen.add(entry.id);
}

/** Polls for the first finished, unseen entry passing `test`; null on timeout. CORS preflights (OPTIONS) never count. */
async function findEntry(ctx, filter, test, timeoutMs) {
  const deadline = ctx.now() + timeoutMs;
  for (;;) {
    for (const entry of await listEntries(ctx, filter)) {
      if (ctx.seen.has(entry.id) || entry.method === "OPTIONS" || entry._loadingFinished !== true || entry.flags?.includes("failed") || !test(entry)) continue;
      ctx.seen.add(entry.id);
      return entry;
    }
    if (ctx.now() >= deadline) return null;
    await ctx.sleep(POLL_MS);
  }
}

async function readBody(ctx, entry) {
  const result = await ctx.executeTool("network.body", { id: entry.id });
  if (typeof result?.body !== "string") throw new Error(`network.body returned no body for ${entry.id}`);
  const text = result.base64Encoded ? Buffer.from(result.body, "base64").toString("utf8") : result.body;
  try {
    return { json: JSON.parse(text) };
  } catch {
    return { body: text };
  }
}

// Header values as fetch shows them: lowercase names, repeated values joined by ", " (capture
// joins them with newlines).
function normalHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value).split("\n").join(", ")]));
}

// A cached response the browser revalidated is a 304 in capture and a 200 to fetch. It is the
// script's only when the validator fetch saw, the ETag (else Last-Modified), is the one the 304
// confirmed: in its response, or in the browser's If-None-Match (If-Modified-Since).
function revalidatedFor(entry, seen) {
  const script = normalHeaders(seen.headers);
  const response = normalHeaders(entry.responseHeaders);
  const request = normalHeaders(entry.requestHeaders);
  if (script.etag !== undefined) return response.etag === script.etag || (request["if-none-match"] ?? "").split(/,\s*/).includes(script.etag);
  if (script["last-modified"] !== undefined) return [response["last-modified"], request["if-modified-since"]].includes(script["last-modified"]);
  return false;
}

// A captured response agrees with what the tab's script saw: the same status (or a 304 that
// revalidated it), and the same value for each header both have (fetch hides some, such as
// set-cookie).
function agreesWith(entry, seen) {
  if (entry.status !== seen.status && !(entry.status === 304 && seen.status === 200 && revalidatedFor(entry, seen))) return false;
  const captured = normalHeaders(entry.responseHeaders);
  return Object.entries(normalHeaders(seen.headers)).every(([name, value]) => captured[name] === undefined || captured[name] === value);
}

// Slack between the tab's clock, which times the script's request, and capture's request start.
const SEND_WINDOW_SLACK_MS = 1000;

async function capturedText(ctx, entry) {
  let result;
  let failure;
  try {
    result = await ctx.executeTool("network.body", { id: entry.id });
  } catch (error) {
    failure = error;
  }
  // network.body falls back to Chrome's own copy when capture skipped the body.
  if (typeof result?.body === "string") return result.base64Encoded ? Buffer.from(result.body, "base64").toString("utf8") : result.body;
  const { reason, sizeBytes, limitBytes } = entry.bodyCapture || {};
  if (reason === "per-body-cap") throw new Error(`it is ${sizeBytes} bytes, over the ${limitBytes}-byte per-body capture cap, and Chrome no longer has it`);
  if (reason === "session-cap") throw new Error(`it is ${sizeBytes} bytes, more than is left of the tab's ${limitBytes}-byte capture budget, and Chrome no longer has it`);
  throw new Error(failure?.message || `network.body returned no body for ${entry.id}`);
}

// The method a redirect gives the next request: 303 turns anything but HEAD into GET, 301 and 302
// turn POST into GET, 307 and 308 keep it.
function redirectedMethod(method, status) {
  if (status === 303 && method !== "HEAD") return "GET";
  return (status === 301 || status === 302) && method === "POST" ? "GET" : method;
}

// Whether capture shows `entry` as the end of the script's redirected request: Chrome sends every
// hop under one request id, and capture keeps each redirect under its own id with its status, so
// the hops must start at the script's URL and method and carry the method each redirect gives.
function endsRedirectFrom(entry, fresh, sent) {
  if (entry._requestId === undefined) return false;
  const chain = fresh.filter((hop) => hop._requestId === entry._requestId);
  if (chain.length < 2 || chain.at(-1) !== entry || chain[0].url !== sent.requestUrl) return false;
  let method = sent.method;
  for (const hop of chain) {
    if (String(hop.method).toUpperCase() !== method) return false;
    if (hop === entry) return true;
    if (!hop.flags?.includes("redirect")) return false;
    method = redirectedMethod(method, hop.status);
  }
  return false;
}

/**
 * Reads the body of a request a tab script is about to send from network capture, since the
 * script's output is capped. Call it before sending: it turns capture on and notes what is there.
 * `read(sent)` takes what the script saw ({ method, requestUrl, url, redirected, status, headers,
 * sentAt, doneAt }) and returns the body text. The captured request must be the only new one with
 * that URL and method, started while the script ran, that agrees on status and headers; when the
 * page sent a twin meanwhile, it fails rather than guess. A redirected response must end the
 * redirect chain capture recorded for the script's request, or it fails.
 */
async function watchCapture(options) {
  const ctx = context(options);
  await markSeen(ctx);
  return {
    async read(sent) {
      const { pathname } = new URL(sent.url);
      const label = sent.redirected ? `${sent.method} ${new URL(sent.requestUrl).pathname}` : `${sent.method} ${pathname}`;
      const deadline = ctx.now() + (options.timeoutMs ?? REPLAY_CAPTURE_TIMEOUT_MS);
      let candidates = [];
      let confirmed = [];
      for (;;) {
        // A redirect's earlier hops are under the request's own URL, so list them all.
        const fresh = (await listEntries(ctx, sent.redirected ? undefined : pathname)).filter((entry) => !ctx.seen.has(entry.id) && entry.method !== "OPTIONS");
        candidates = fresh.filter(
          (entry) =>
            entry.url === sent.url &&
            !entry.flags?.includes("redirect") &&
            (sent.redirected || String(entry.method).toUpperCase() === sent.method) &&
            entry.ts >= sent.sentAt - SEND_WINDOW_SLACK_MS &&
            entry.ts <= sent.doneAt + SEND_WINDOW_SLACK_MS,
        );
        confirmed = sent.redirected ? candidates.filter((entry) => endsRedirectFrom(entry, fresh, sent)) : candidates;
        if (candidates.every((entry) => entry._loadingFinished === true)) {
          const matches = confirmed.filter((entry) => !entry.flags?.includes("failed") && agreesWith(entry, sent));
          if (matches.length === 1) {
            try {
              return await capturedText(ctx, matches[0]);
            } catch (error) {
              throw new Error(`got HTTP ${sent.status} from ${pathname} but can't read its body: ${error.message}`);
            }
          }
          if (matches.length > 1) {
            throw new Error(`${matches.length} captured requests match ${label} while the op ran, and nothing tells which one it sent: the page sent the same request itself`);
          }
        }
        if (ctx.now() >= deadline) break;
        await ctx.sleep(POLL_MS);
      }
      if (candidates.some((entry) => entry._loadingFinished !== true)) {
        throw new Error(`${candidates.length} captured requests match ${label} while the op ran, and not all of them finished, so nothing tells which one it sent`);
      }
      if (sent.redirected && candidates.length > 0 && confirmed.length === 0) {
        throw new Error(`${label} was redirected to ${pathname}, and capture can't show which captured request it ended in, so surf won't guess`);
      }
      if (confirmed.length > 0) {
        throw new Error(`the captured response for ${label} disagrees with what the tab saw (HTTP ${sent.status}): capture has ${confirmed.map((entry) => `HTTP ${entry.status}`).join(", ")}`);
      }
      throw new Error(`the response for ${label} was not captured`);
    },
  };
}

async function recentApiPaths(ctx) {
  const paths = [];
  for (const entry of (await listEntries(ctx)).reverse()) {
    if (!["XHR", "Fetch"].includes(entry.type)) continue;
    let pathname;
    try {
      pathname = new URL(entry.url).pathname;
    } catch {
      continue;
    }
    if (!paths.includes(pathname)) paths.push(pathname);
    if (paths.length === 5) break;
  }
  return paths;
}

async function waitWith(ctx, { match, open, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const matches = urlMatcher(match);
  const filter = globLiteral(match);
  // Listing first turns capture on before any navigation and skips responses from before the start.
  await markSeen(ctx, filter);
  if (open) await ctx.executeTool("navigate", { url: open });
  const entry = await findEntry(ctx, filter, (candidate) => matches(candidate.url), timeoutMs);
  if (!entry) {
    const seen = await recentApiPaths(ctx);
    throw new Error(
      `No response matched "${match}" within ${Math.round(timeoutMs / 1000)}s. ` +
        (seen.length ? `Recent API requests: ${seen.join(", ")}` : "No fetch/XHR requests were seen."),
    );
  }
  return { entry, response: { id: entry.id, url: entry.url, status: entry.status, ...(await readBody(ctx, entry)) } };
}

/** Waits for the next finished response whose URL matches `match`; returns { id, url, status, json | body }. */
async function waitForResponse(options) {
  return (await waitWith(context(options), options)).response;
}

// The origin of the page that sent a request: undefined when the capture has no tabUrl (older
// Surf), "null" when that page had an opaque origin (about:blank, data:) or an unreadable URL.
function senderOrigin(tabUrl) {
  if (tabUrl === undefined || tabUrl === null || tabUrl === "") return undefined;
  try {
    return new URL(tabUrl).origin;
  } catch {
    return "null";
  }
}

const OPAQUE_ORIGIN = "a page with an opaque origin (such as about:blank)";

function replayRefusal(entry, url, sentFrom, tabOrigin) {
  const place = (origin) => (origin === "null" ? OPAQUE_ORIGIN : origin);
  let sent = `sent to ${url.origin}`;
  if (sentFrom === url.origin) sent = `sent from ${sentFrom}`;
  else if (sentFrom === "null") sent = `sent from ${OPAQUE_ORIGIN} to ${url.origin}`;
  else if (sentFrom) sent = `sent from a page on ${sentFrom} to ${url.origin}`;
  const goTo = sentFrom && sentFrom !== "null" ? sentFrom : url.origin;
  return new Error(
    `${entry.id} was ${sent}, but the tab is now on ${place(tabOrigin)}, so the browser would block it (CORS) or send it without its cookies. ` +
      `Run \`surf go ${goTo}\` first, then replay it.`,
  );
}

// Replaces every header value in a message with <redacted> (see redactValues).
function headerRedactor(headers) {
  const values = Object.values(headers).map(String);
  return (message) => redactValues(message, values);
}

function replayHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => {
      const lower = name.toLowerCase();
      return !lower.startsWith(":") && !lower.startsWith("sec-") && !lower.startsWith("proxy-") && !DROPPED_HEADERS.has(lower);
    }),
  );
}

async function replayEntry(ctx, entry, { set, allowPost = false, origins = [] } = {}) {
  const method = String(entry.method || "GET").toUpperCase();
  const request = set ? applySet({ url: entry.url, body: entry.requestBody }, set) : { url: entry.url, body: entry.requestBody };
  const url = new URL(request.url);
  if (!["GET", "HEAD"].includes(method) && allowPost !== true) {
    throw new Error(`refusing to replay ${method} ${url.pathname}: re-sending it can repeat a write (allow with --allow-post)`);
  }
  if (origins.length > 0 && !origins.includes(url.origin)) throw new Error(`replay origin is not allowed: ${url.origin}`);
  const headers = replayHeaders(entry.requestHeaders);
  // Header values (auth, CSRF) must never reach errors, events, or logs.
  const redact = headerRedactor(headers);
  try {
    await markSeen(ctx, url.pathname);
    const init = { method, headers, ...(request.body !== undefined && !["GET", "HEAD"].includes(method) ? { body: request.body } : {}) };
    // Send what the page must have sent: cookies same-origin, and cross-origin only when the captured
    // response allowed credentials (a credentialed request fails against `Access-Control-Allow-Origin: *`).
    const allowCredentials = Object.entries(entry.responseHeaders || {}).some(
      ([name, value]) => name.toLowerCase() === "access-control-allow-credentials" && String(value).trim().toLowerCase() === "true",
    );
    // Only the request's own origin or the page that sent it can repeat it with the same cookies and
    // CORS outcome. From any other page, or any opaque one, the script refuses before sending. A
    // capture without tabUrl can't say which page sent it, so only an opaque tab is refused.
    const sentFrom = senderOrigin(entry.tabUrl);
    // The script only reports status: its output is capped, so the body is read from network capture.
    const sent = await ctx.executeTool("javascript_tool", {
      code: `(async () => {
const url = new URL(${JSON.stringify(request.url)});
const sentFrom = ${JSON.stringify(sentFrom ?? null)};
if (location.origin !== url.origin && (location.origin === "null" || (sentFrom && (sentFrom === "null" || location.origin !== sentFrom)))) {
  return { tabOrigin: location.origin };
}
const credentials = url.origin === location.origin || ${allowCredentials} ? "include" : "omit";
let response;
try {
  response = await fetch(url.href, { ...${JSON.stringify(init)}, credentials });
} catch (error) {
  if (url.origin === location.origin) throw error;
  return { tabOrigin: location.origin, fetchError: String(error?.message || error) };
}
await response.arrayBuffer();
return { status: response.status, url: response.url };
})()`,
    });
    let result;
    try {
      result = JSON.parse(sent?.output);
    } catch {
      result = undefined;
    }
    if (result?.fetchError !== undefined) {
      throw new Error(`the browser refused the replay from ${result.tabOrigin} to ${url.origin} (CORS or network): ${result.fetchError}`);
    }
    if (typeof result?.tabOrigin === "string") throw replayRefusal(entry, url, sentFrom, result.tabOrigin);
    if (!Number.isInteger(result?.status)) throw new Error("replay script returned no status");
    const finalUrl = result.url || request.url;
    const captured = await findEntry(ctx, url.pathname, (candidate) => candidate.url === finalUrl, REPLAY_CAPTURE_TIMEOUT_MS);
    if (!captured) throw new Error(`the replayed response for ${url.pathname} was not captured`);
    return { status: result.status, url: finalUrl, ...(await readBody(ctx, captured)) };
  } catch (error) {
    throw new Error(redact(error?.message || String(error)));
  }
}

/** Re-sends a captured request from inside its tab with `set` edits; returns { status, url, json | body }. */
async function replay(options) {
  const ctx = context(options);
  const loaded = await ctx.executeTool("network.get", { id: options.id });
  if (!isPlainObject(loaded?.entry)) throw new Error(`network entry not found: ${options.id}`);
  return replayEntry(ctx, loaded.entry, options);
}

async function driveNext(ctx, matches, filter) {
  if (!ctx.visibleChecked) {
    // A hidden tab ignores scrolling, so driving it would end early with partial pages.
    const visibility = await ctx.executeTool("javascript_tool", { code: "document.visibilityState" });
    if (visibility?.output === '"hidden"') throw hiddenTabError("api drive mode");
    ctx.visibleChecked = true;
  }
  for (let scroll = 0; scroll < DRIVE_IDLE_SCROLLS; scroll++) {
    await ctx.executeTool("scroll.bottom", {});
    const entry = await findEntry(ctx, filter, (candidate) => matches(candidate.url), DRIVE_WAIT_MS);
    if (!entry) continue;
    const page = await readBody(ctx, entry);
    if (page.json !== undefined) return page.json;
  }
  return undefined;
}

/**
 * The `api` strategy: first matching response, then next pages by `mode` (auto: replay, then
 * drive after the first replay failure). Returns the merged records.
 */
async function runApiHarvest({ spec, origins = [], onEvent = () => {}, regexBudget, ...options }) {
  validateApiSpec(spec);
  const ctx = context(options);
  const records = createRecordSet(spec.records, regexBudget ? { regexBudget } : {});
  const { entry, response } = await waitWith(ctx, spec);
  if (response.json === undefined) throw new Error(`the response matching "${spec.match}" is not JSON`);
  records.add(response.json);
  if (!spec.cursor) return records.records();
  const mode = spec.mode || "auto";
  const matches = urlMatcher(spec.match);
  const filter = globLiteral(spec.match);
  const maxPages = spec.maxPages ?? DEFAULT_MAX_PAGES;
  const cursors = new Set();
  let using = mode === "drive" ? "drive" : "replay";
  let cursor = readCursor(response.json, spec.cursor);
  let pages = 1;
  let idle = 0;
  while (cursor !== undefined && cursor !== null && !cursors.has(JSON.stringify(cursor)) && pages < maxPages) {
    cursors.add(JSON.stringify(cursor));
    let doc;
    if (using === "replay") {
      try {
        const page = await replayEntry(ctx, entry, { set: { [spec.cursor.into]: cursor }, allowPost: spec.allowPost, origins });
        if (page.status < 200 || page.status > 299) throw new Error(`replay returned HTTP ${page.status}`);
        if (page.json === undefined) throw new Error("replay response is not JSON");
        doc = page.json;
      } catch (error) {
        if (mode === "replay") throw error;
        using = "drive";
        onEvent({ type: "api.fallback", from: "replay", to: "drive", reason: error.message, at: new Date().toISOString() });
      }
    }
    if (using === "drive") {
      doc = await driveNext(ctx, matches, filter);
      if (doc === undefined) break;
    }
    pages++;
    idle = records.add(doc) === 0 ? idle + 1 : 0;
    if (idle >= 2) break;
    cursor = readCursor(doc, spec.cursor);
  }
  return records.records();
}

module.exports = { applySet, parseSetArgument, replay, runApiHarvest, urlMatcher, validateApiSpec, waitForResponse, watchCapture };
