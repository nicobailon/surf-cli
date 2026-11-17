// Harvests a page's own JSON API responses: wait for one, replay it with a new cursor, or
// drive the page to load the next one. Runners take an injected `executeTool` (host tools).

const { createRecordSet, readCursor } = require("./records.cjs");
const { hiddenTabError } = require("./dom-collect.cjs");

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

/**
 * `match` glob: tested against the URL without query string; the whole URL when the
 * pattern has `://`, else the whole pathname. `*` = any run except `/`, `**` = anything.
 */
function urlMatcher(pattern) {
  if (typeof pattern !== "string" || !pattern) throw new Error("match must be a non-empty URL glob");
  if (/[?#]/.test(pattern)) {
    throw new Error(`match "${pattern}" must not contain ? or #: it is tested against the URL without its query string`);
  }
  const whole = pattern.includes("://");
  if (!whole && !pattern.startsWith("/")) {
    throw new Error(`match "${pattern}" must start with / (a path) or contain :// (a full URL)`);
  }
  const source = pattern
    .split(/(\*\*|\*)/)
    .map((part) => {
      if (part === "**") return ".*";
      if (part === "*") return "[^/]*";
      return part.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  const regex = new RegExp(`^${source}$`);
  return (url) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    return regex.test(whole ? `${parsed.origin}${parsed.pathname}` : parsed.pathname);
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
  const secrets = Object.values(headers).filter((value) => String(value).length >= 8);
  try {
    await markSeen(ctx, url.pathname);
    const init = { method, headers, ...(request.body !== undefined && !["GET", "HEAD"].includes(method) ? { body: request.body } : {}) };
    // Send what the page must have sent: cookies same-origin, and cross-origin only when the captured
    // response allowed credentials (a credentialed request fails against `Access-Control-Allow-Origin: *`).
    const allowCredentials = Object.entries(entry.responseHeaders || {}).some(
      ([name, value]) => name.toLowerCase() === "access-control-allow-credentials" && String(value).trim().toLowerCase() === "true",
    );
    // The script only reports status: its output is capped, so the body is read from network capture.
    const sent = await ctx.executeTool("javascript_tool", {
      code: `(async () => {
const url = new URL(${JSON.stringify(request.url)});
const credentials = url.origin === location.origin || ${allowCredentials} ? "include" : "omit";
const response = await fetch(url.href, { ...${JSON.stringify(init)}, credentials });
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
    if (!Number.isInteger(result?.status)) throw new Error("replay script returned no status");
    const finalUrl = result.url || request.url;
    const captured = await findEntry(ctx, url.pathname, (candidate) => candidate.url === finalUrl, REPLAY_CAPTURE_TIMEOUT_MS);
    if (!captured) throw new Error(`the replayed response for ${url.pathname} was not captured`);
    return { status: result.status, url: finalUrl, ...(await readBody(ctx, captured)) };
  } catch (error) {
    let message = error?.message || String(error);
    for (const secret of secrets) message = message.split(secret).join("<redacted>");
    throw new Error(message);
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
async function runApiHarvest({ spec, origins = [], onEvent = () => {}, ...options }) {
  validateApiSpec(spec);
  const ctx = context(options);
  const records = createRecordSet(spec.records);
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

module.exports = { applySet, parseSetArgument, replay, runApiHarvest, urlMatcher, validateApiSpec, waitForResponse };
