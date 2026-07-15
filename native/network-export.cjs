const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { version: PACKAGE_VERSION } = require("../package.json");

const MAX_NETWORK_EXPORT_FILE_BYTES = 256 * 1024 * 1024;
const INTERNAL_FIELDS = new Set(["_requestId", "_responseReceived", "_loadingFinished"]);

function publicEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error("network export entries must be objects");
  }
  const result = Object.create(null);
  for (const [key, value] of Object.entries(entry)) {
    if (!INTERNAL_FIELDS.has(key)) result[key] = value;
  }
  return result;
}

function headerList(headers) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return [];
  return Object.entries(headers).map(([name, value]) => ({ name, value: String(value) }));
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
      queryString: [],
      cookies: [],
      headersSize: -1,
      bodySize: Number.isFinite(entry.requestBodySize) ? entry.requestBodySize : requestBody ? Buffer.byteLength(String(requestBody)) : -1,
      ...(requestBody !== undefined ? { postData: { mimeType: "application/octet-stream", text: String(requestBody) } } : {}),
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

function serializeNetworkExport(entries, format = "json") {
  if (!Array.isArray(entries)) throw new Error("network export entries must be an array");
  if (format !== "json" && format !== "jsonl" && format !== "har") throw new Error(`unsupported network export format: ${format}`);
  const publicEntries = entries.map(publicEntry);
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

function writeNetworkExport(outputPath, entries, format = "json") {
  if (typeof outputPath !== "string" || !path.isAbsolute(outputPath)) throw new Error("network export output must be an absolute path");
  const content = serializeNetworkExport(entries, format);
  const bytes = Buffer.byteLength(content);
  if (bytes > MAX_NETWORK_EXPORT_FILE_BYTES) throw new Error("network export exceeds the 256 MiB file limit");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryPath = path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.surf-${crypto.randomBytes(12).toString("hex")}.tmp`);
  try {
    const fd = fs.openSync(temporaryPath, "wx", 0o600);
    try {
      fs.writeFileSync(fd, content, "utf8");
      fs.fchmodSync(fd, 0o600);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporaryPath, outputPath);
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch {}
    throw error;
  }
  return { path: outputPath, format, count: entries.length, bytes };
}

module.exports = {
  INTERNAL_FIELDS,
  MAX_NETWORK_EXPORT_FILE_BYTES,
  publicEntry,
  serializeNetworkExport,
  writeNetworkExport,
};
