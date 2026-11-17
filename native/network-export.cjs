const fs = require("fs");
const path = require("path");
const { version: PACKAGE_VERSION } = require("../package.json");
const { redactSecretBodyFields } = require("./body-redaction.cjs");
const { atomicWriteFile } = require("./private-state.cjs");
const { isSecretHeader, redactEchoText, redactEchoUrl, redactUrlIfSecret, secretHeaderEchoes } = require("./redaction.cjs");

const MAX_NETWORK_EXPORT_FILE_BYTES = 256 * 1024 * 1024;
const INTERNAL_FIELDS = new Set(["_requestId", "_responseReceived", "_loadingFinished"]);

const HEADER_FIELDS = new Set(["requestHeaders", "responseHeaders"]);
const URL_FIELDS = new Set(["url", "tabUrl"]);

// Secret headers (auth, cookies, API keys, and the `secretHeaders` ops read from the environment)
// keep their name with a <redacted> value; any other header that echoes a secret's value loses it.
function redactHeaders(headers, secretHeaders, secrets) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return headers;
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => {
    if (isSecretHeader(name) || secretHeaders.has(name.toLowerCase())) return [name, "<redacted>"];
    return [name, typeof value === "string" ? redactEchoText(value, secrets) : value];
  }));
}

const BODY_FIELDS = new Set(["requestBody", "responseBody"]);
const TEXT_BODY_TYPE = /json|x-www-form-urlencoded|multipart\/form-data|^text\/|xml|javascript/i;

// What an export may contain: no internal fields, secret headers or URL credentials, and no echo
// of a secret header's value in a text body, the URL or another header (a page that reflects its
// Authorization header), in any spelling (see secretHeaderEchoes). `secretHeaders` names, in lower case, the headers
// saved ops read from the environment (see envBackedHeaders). Secret-named body fields (password=,
// "token":) read <redacted> unless `rawBodies` (--raw-bodies).
function publicEntry(entry, { secretHeaders = [], rawBodies = false } = {}) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error("network export entries must be objects");
  }
  const named = new Set(secretHeaders.map((name) => String(name).toLowerCase()));
  const secrets = secretHeaderEchoes([entry.requestHeaders, entry.responseHeaders], secretHeaders);
  const result = Object.create(null);
  for (const [key, value] of Object.entries(entry)) {
    if (INTERNAL_FIELDS.has(key)) continue;
    if (HEADER_FIELDS.has(key)) result[key] = redactHeaders(value, named, secrets);
    else if (URL_FIELDS.has(key)) result[key] = redactEchoUrl(redactUrlIfSecret(value), secrets);
    else if (BODY_FIELDS.has(key) && typeof value === "string" && !(key === "responseBody" && entry.responseBodyEncoding === "base64")) {
      result[key] = redactEchoText(value, secrets);
    } else result[key] = value;
  }
  if (!rawBodies) {
    for (const key of BODY_FIELDS) {
      const type = key === "requestBody" ? headerValue(entry.requestHeaders, "content-type") : headerValue(entry.responseHeaders, "content-type") || entry.mimeType;
      if (typeof result[key] !== "string") continue;
      if (key === "responseBody" && entry.responseBodyEncoding === "base64") {
        // A text body Chrome sent as base64 is decoded, redacted and encoded again; binary stays as is.
        if (!TEXT_BODY_TYPE.test(String(type))) continue;
        const text = Buffer.from(result[key], "base64").toString("utf8");
        const redacted = redactSecretBodyFields(text, type);
        if (redacted !== text) result[key] = Buffer.from(redacted, "utf8").toString("base64");
      } else result[key] = redactSecretBodyFields(result[key], type);
    }
  }
  return result;
}

function headerList(headers) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return [];
  return Object.entries(headers).map(([name, value]) => ({ name, value: String(value) }));
}

function headerValue(headers, name) {
  if (!headers || typeof headers !== "object") return "";
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return match ? String(match[1]) : "";
}

function queryList(url) {
  try {
    return [...new URL(url).searchParams.entries()].map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

function harEntry(entry) {
  const requestBody = entry.requestBody;
  const responseBody = entry.responseBody;
  const requestHeaders = entry.requestHeaders;
  const responseHeaders = entry.responseHeaders;
  const duration = Number.isFinite(entry.duration) ? Math.max(0, entry.duration) : 0;
  const ttfb = Number.isFinite(entry.ttfb) ? Math.max(0, entry.ttfb) : duration;
  return {
    startedDateTime: new Date(Number(entry.ts) || Date.now()).toISOString(),
    time: duration,
    request: {
      method: entry.method || "GET",
      url: entry.url || "",
      httpVersion: "HTTP/1.1",
      headers: headerList(requestHeaders),
      queryString: queryList(entry.url || ""),
      cookies: [],
      headersSize: -1,
      bodySize: Number.isFinite(entry.requestBodySize) ? entry.requestBodySize : requestBody ? Buffer.byteLength(String(requestBody)) : -1,
      ...(requestBody !== undefined ? { postData: { mimeType: headerValue(requestHeaders, "content-type") || "application/octet-stream", text: String(requestBody) } } : {}),
    },
    response: {
      status: Number.isFinite(entry.status) ? entry.status : 0,
      statusText: entry.statusText || "",
      httpVersion: "HTTP/1.1",
      headers: headerList(responseHeaders),
      cookies: [],
      content: {
        size: Number.isFinite(entry.responseBodySize) ? entry.responseBodySize : responseBody ? Buffer.byteLength(String(responseBody)) : 0,
        mimeType: entry.mimeType || "",
        ...(responseBody !== undefined ? { text: String(responseBody) } : {}),
        ...(entry.responseBodyEncoding === "base64" ? { encoding: "base64" } : {}),
        _surfBodyCapture: entry.bodyCapture || { mode: "none", complete: responseBody === undefined ? false : true },
      },
      redirectURL: "",
      headersSize: -1,
      bodySize: Number.isFinite(entry.responseBodySize) ? entry.responseBodySize : responseBody ? Buffer.byteLength(String(responseBody)) : -1,
    },
    cache: {},
    timings: { send: 0, wait: ttfb, receive: Math.max(0, duration - ttfb) },
    ...(entry.comment ? { comment: String(entry.comment) } : {}),
  };
}

function serializeNetworkExport(entries, format = "json", options = {}) {
  if (!Array.isArray(entries)) throw new Error("network export entries must be an array");
  if (format !== "json" && format !== "jsonl" && format !== "har") throw new Error(`unsupported network export format: ${format}`);
  const publicEntries = entries.map((entry) => publicEntry(entry, options));
  if (format === "jsonl") return `${publicEntries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  if (format === "har") {
    return JSON.stringify({
      log: {
        version: "1.2",
        creator: { name: "surf-cli", version: PACKAGE_VERSION },
        entries: publicEntries.map(harEntry),
      },
    });
  }
  return JSON.stringify(publicEntries, null, 2);
}

function writeNetworkExport(outputPath, entries, format = "json", options = {}) {
  if (typeof outputPath !== "string" || !path.isAbsolute(outputPath)) throw new Error("network export output must be an absolute path");
  const content = serializeNetworkExport(entries, format, options);
  const bytes = Buffer.byteLength(content);
  if (bytes > MAX_NETWORK_EXPORT_FILE_BYTES) throw new Error("network export exceeds the 256 MiB file limit");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  atomicWriteFile(outputPath, content, { encoding: "utf8" });
  return { path: outputPath, format, count: entries.length, bytes };
}

module.exports = {
  INTERNAL_FIELDS,
  MAX_NETWORK_EXPORT_FILE_BYTES,
  publicEntry,
  serializeNetworkExport,
  writeNetworkExport,
};
