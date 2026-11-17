// The direct tier of a network strategy: `surf use` sends the op's request from the native host,
// with no tab, carrying the browser's live cookies for its URL. The extension reads them
// (chrome.cookies) for that one request; they stay in this process's memory and are never written
// to the op, a record, a receipt, the journal or the log. Only the op's allowed origins are sent
// to, each hop's address is checked before connecting, and redirects are followed by hand within
// those origins. playbook-runtime.cjs falls back to the in-tab request when this tier fails.

const dns = require("dns");
const http = require("http");
const https = require("https");
const net = require("net");
const path = require("path");
const { promisify } = require("util");
const zlib = require("zlib");
const { atomicWriteJson, getPrivateStateRoot, readPrivateJson } = require("./private-state.cjs");

const MAX_REDIRECTS = 10;
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
// The host sets these itself, or a browser never lets a page set them; a recorded `cookie` is
// replaced by the browser's live cookies.
const HOST_HEADERS = new Set(["accept-encoding", "connection", "content-length", "cookie", "host", "keep-alive", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"]);
// A page never sees these response headers, so neither does an op's result.
const HIDDEN_RESPONSE_HEADERS = new Set(["set-cookie", "set-cookie2"]);

// Loopback, private (RFC 1918, ULA), link-local and unspecified addresses.
const BLOCKED = new net.BlockList();
BLOCKED.addSubnet("0.0.0.0", 8, "ipv4");
BLOCKED.addSubnet("127.0.0.0", 8, "ipv4");
BLOCKED.addSubnet("10.0.0.0", 8, "ipv4");
BLOCKED.addSubnet("172.16.0.0", 12, "ipv4");
BLOCKED.addSubnet("192.168.0.0", 16, "ipv4");
BLOCKED.addSubnet("169.254.0.0", 16, "ipv4");
BLOCKED.addAddress("::", "ipv6");
BLOCKED.addAddress("::1", "ipv6");
BLOCKED.addSubnet("fc00::", 7, "ipv6");
BLOCKED.addSubnet("fe80::", 10, "ipv6");

// `[::1]` → `::1`, a zone id dropped, and an IPv4-mapped IPv6 address (`::ffff:7f00:1`) as IPv4.
function plainAddress(address) {
  const ip = String(address).replace(/^\[(.*)\]$/, "$1").replace(/%.*$/, "");
  const mapped = ip.match(/^::ffff:(.+)$/i)?.[1];
  if (!mapped) return ip;
  if (net.isIPv4(mapped)) return mapped;
  const hex = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hex) return ip;
  const [high, low] = [Number.parseInt(hex[1], 16), Number.parseInt(hex[2], 16)];
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

/** Whether the direct tier refuses to connect to `address` (an op recorded against one aside). */
function isBlockedAddress(address) {
  const ip = plainAddress(address);
  const family = net.isIP(ip);
  if (family === 0) return false;
  return BLOCKED.check(ip, family === 4 ? "ipv4" : "ipv6");
}

/** Whether the op's stored request URL names a loopback or private host itself (`http://127.0.0.1:8080/…`, `localhost`). */
function recordedAgainstPrivate(recordedUrl) {
  let hostname;
  try {
    hostname = new URL(recordedUrl).hostname;
  } catch {
    return false;
  }
  return hostname === "localhost" || hostname.endsWith(".localhost") || isBlockedAddress(hostname);
}

/** The origins the direct tier sends to: the playbook's, else the request's own. */
function directOrigins(url, allowedOrigins = []) {
  if (allowedOrigins.length > 0) return allowedOrigins;
  try {
    return [new URL(url).origin];
  } catch {
    return [];
  }
}

/** Why an op's network strategy can't take the direct tier, or undefined when it can. */
function directSkipReason(strategy, { pageNext } = {}) {
  if (strategy.using !== "network") return `a ${strategy.using} strategy runs in the tab`;
  if (strategy.extract?.html) return "its HTML extract needs the tab's DOM";
  if (pageNext) return "a chain step's page.next is read in the tab";
  return undefined;
}

// The request URL with its query set, as the tab's script builds it; a relative URL needs the
// tab's page, so it is refused here and the tab sends it.
function requestUrl(request) {
  let url;
  try {
    url = new URL(request.url);
  } catch {
    throw Object.assign(new Error(`a relative URL (${request.url}) resolves against the tab's page`), { notSent: true });
  }
  for (const [key, value] of Object.entries(request.query || {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url;
}

function bodyText(body) {
  if (body === undefined) return undefined;
  return typeof body === "string" ? body : JSON.stringify(body);
}

// The op's headers, the browser's user agent when the op recorded none, and the live cookies.
function requestHeaders(opHeaders, { cookies, userAgent }, hasBody) {
  const headers = {};
  for (const [name, value] of Object.entries(opHeaders || {})) {
    const lower = name.toLowerCase();
    if (!HOST_HEADERS.has(lower) && value !== undefined && value !== null) headers[lower] = String(value);
  }
  if (headers["user-agent"] === undefined && typeof userAgent === "string" && userAgent) headers["user-agent"] = userAgent;
  if (headers.accept === undefined) headers.accept = "*/*";
  headers["accept-encoding"] = "gzip, deflate, br";
  // As fetch sends a string body.
  if (hasBody && headers["content-type"] === undefined) headers["content-type"] = "text/plain;charset=UTF-8";
  const cookie = (Array.isArray(cookies) ? cookies : [])
    .filter((item) => typeof item?.name === "string" && typeof item?.value === "string")
    .map((item) => `${item.name}=${item.value}`)
    .join("; ");
  if (cookie) headers.cookie = cookie;
  return headers;
}

const DECODERS = { gzip: promisify(zlib.gunzip), "x-gzip": promisify(zlib.gunzip), br: promisify(zlib.brotliDecompress) };
const inflate = promisify(zlib.inflate);
const inflateRaw = promisify(zlib.inflateRaw);

async function decodeBody(buffer, encoding) {
  const name = String(encoding || "").trim().toLowerCase();
  if (!name || name === "identity") return buffer;
  if (name === "deflate") return inflate(buffer).catch(() => inflateRaw(buffer));
  if (DECODERS[name]) return DECODERS[name](buffer);
  throw new Error(`unsupported content-encoding: ${name}`);
}

// One request to the checked `addresses`, so the connection goes where the check looked.
// `onConnect` fires once the socket is up: from then on request bytes may have left the host.
function sendOnce({ url, method, headers, body, addresses, signal, onConnect }) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const lookup = (_hostname, options, callback) => {
      if (options?.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    };
    const request = client.request(url, { method, headers, signal, agent: false, lookup }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) response.destroy(new Error(`the response is over ${MAX_BODY_BYTES / 1024 / 1024} MB`));
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => {
        decodeBody(Buffer.concat(chunks), response.headers["content-encoding"])
          .then((decoded) => resolve({ status: response.statusCode, headers: response.headers, body: decoded.toString("utf8") }))
          .catch(reject);
      });
    });
    request.on("socket", (socket) => {
      if (socket.connecting) socket.once("connect", onConnect);
      else onConnect();
    });
    request.on("error", reject);
    request.end(body);
  });
}

async function defaultLookup(hostname) {
  return dns.promises.lookup(hostname, { all: true, verbatim: true });
}

async function resolveAddresses(hostname, lookup) {
  const host = hostname.replace(/^\[(.*)\]$/, "$1");
  const family = net.isIP(host);
  if (family) return [{ address: host, family }];
  const addresses = await lookup(host);
  if (!Array.isArray(addresses) || addresses.length === 0) throw new Error(`${host} has no address`);
  return addresses;
}

function publicHeaders(headers) {
  const shown = {};
  for (const [name, value] of Object.entries(headers || {})) {
    if (!HIDDEN_RESPONSE_HEADERS.has(name)) shown[name] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return shown;
}

/**
 * Sends `request` (an op's rendered network request) from the host. `getContext(url)` reads the
 * browser's cookies and user agent for each hop's URL. `markDispatched` runs before the first
 * connection (a write's receipt). Resolves to `{ status, ok, url, redirected, headers, body }`.
 * An error carries `notSent: true` when no request bytes can have left the host.
 */
async function sendDirect({ request, allowedOrigins, allowPrivate = false, getContext, markDispatched, signal, lookup = defaultLookup, isBlocked = isBlockedAddress }) {
  let url = requestUrl(request);
  let method = String(request.method || "GET").toUpperCase();
  let body = bodyText(request.body);
  let sent = false;
  let dispatched = false;
  const fail = (message) => Object.assign(new Error(message), { notSent: !sent });
  for (let hop = 0; ; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw fail(`the direct tier sends only http and https requests, not ${url.protocol}`);
    if (!allowedOrigins.includes(url.origin)) {
      throw fail(hop === 0 ? `playbook network origin is not allowed: ${url.origin}` : `the response redirected to ${url.origin}, which is not one of the op's origins, so the direct request stopped`);
    }
    let addresses;
    try {
      addresses = await resolveAddresses(url.hostname, lookup);
    } catch (error) {
      throw fail(`could not resolve ${url.hostname}: ${error.code || error.message}`);
    }
    const blocked = allowPrivate ? undefined : addresses.find((entry) => isBlocked(entry.address));
    if (blocked) {
      throw fail(`${url.hostname} resolves to ${blocked.address}, a loopback, private, link-local or unspecified address; the direct tier sends there only for an op recorded against such a host`);
    }
    let context;
    try {
      context = await getContext(url.toString());
    } catch (error) {
      throw fail(`the browser's cookies could not be read: ${error.message}`);
    }
    const headers = requestHeaders(request.headers, context || {}, body !== undefined);
    if (!dispatched) {
      dispatched = true;
      await markDispatched?.();
    }
    let response;
    try {
      response = await sendOnce({ url, method, headers, body, addresses, signal, onConnect: () => { sent = true; } });
    } catch (error) {
      throw fail(`the direct request failed: ${error.code || error.message}`);
    }
    sent = true;
    const location = response.headers.location;
    if (REDIRECT_STATUSES.has(response.status) && location) {
      if (hop >= MAX_REDIRECTS) throw fail(`the direct request was redirected more than ${MAX_REDIRECTS} times`);
      // As fetch follows it: a 303, or a POST answered with a 301 or 302, goes on as a GET without its body.
      if ((response.status === 303 && method !== "HEAD") || ((response.status === 301 || response.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
      }
      url = new URL(location, url);
      continue;
    }
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      url: url.toString(),
      redirected: hop > 0,
      headers: publicHeaders(response.headers),
      body: response.body,
    };
  }
}

const CHALLENGE_STATUSES = new Set([403, 429, 503]);
const CHALLENGE_MARKERS = /cf-chl|challenge-platform|g-recaptcha|h-captcha|hcaptcha|captcha-delivery|\bcaptcha\b/i;

/** Whether a response is a bot-challenge page: a 403, 429 or 503 with a challenge marker. */
function isChallenge({ status, headers = {}, body = "" }) {
  if (!CHALLENGE_STATUSES.has(status)) return false;
  return headers["cf-mitigated"] !== undefined || CHALLENGE_MARKERS.test(body.slice(0, 64 * 1024));
}

// Per op, the tier that answered its last run, so the next starts there: `playbook-tiers.json`
// under SURF_STATE_DIR, keyed `<playbook> <op>`, with the tier and when. No request data.
const TIERS_FILE = "playbook-tiers.json";
// A direct tier that failed is tried first again a day later.
const TAB_MEMORY_MS = 24 * 60 * 60 * 1000;

function readTiers(root) {
  try {
    const tiers = readPrivateJson(path.join(root, TIERS_FILE), {}, { root });
    return tiers && typeof tiers === "object" && !Array.isArray(tiers) ? tiers : {};
  } catch {
    return {};
  }
}

/** The tier a run starts with: direct, unless the last run's direct tier failed within a day. */
function startTier(entry, now) {
  if (!entry || entry.tier === "direct") return "direct";
  const at = Date.parse(entry.at);
  return Number.isFinite(at) && now - at < TAB_MEMORY_MS ? "tab" : "direct";
}

/**
 * The direct tier of one op's run: where it starts (`start`), how it reads cookies (`getContext`)
 * and how it remembers the tier that answered (`remember`).
 */
function directTier({ playbook, op, getContext, root = getPrivateStateRoot(), now = Date.now, ...hooks }) {
  const key = `${playbook.id} ${op.id}`;
  return {
    start: startTier(readTiers(root)[key], now()),
    getContext,
    remember: (tier) => {
      const tiers = readTiers(root);
      tiers[key] = { tier, at: new Date(now()).toISOString() };
      atomicWriteJson(path.join(root, TIERS_FILE), tiers, { root });
    },
    ...hooks,
  };
}

module.exports = { directOrigins, directSkipReason, directTier, isBlockedAddress, isChallenge, recordedAgainstPrivate, sendDirect, TIERS_FILE };
