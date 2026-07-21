const fs = require("fs");
const http = require("http");
const path = require("path");
const { execFile } = require("child_process");
const { atomicWriteFile, atomicWriteJson, ensurePrivateDir, getPrivateStateRoot, readPrivateJson } = require("./private-state.cjs");
const { resolveOp } = require("./playbooks.cjs");
const { readRecord, recordsRoot } = require("./playbook-records.cjs");
const { assertNoEmbeddedSecrets, assertUrlHasNoEmbeddedSecrets, safeHeaders } = require("./redaction.cjs");
const { version: PACKAGE_VERSION } = require("../package.json");

function absoluteEndpointUrl(url, origins = []) {
  if (typeof url !== "string" || !url) throw new Error("client projection requires an endpoint URL");
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("client projection endpoint must use HTTP(S)");
    return parsed.toString();
  } catch (error) {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) throw error;
  }
  if (!Array.isArray(origins) || origins.length !== 1) {
    throw new Error("client projection requires an absolute endpoint URL or exactly one declared origin");
  }
  const resolved = new URL(url, origins[0]);
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") throw new Error("client projection endpoint must use HTTP(S)");
  return resolved.toString();
}

function networkStrategy(op) {
  const strategy = op.run.find((candidate) => candidate.using === "network");
  if (!strategy) throw new Error(`op ${op.id} has no validated network strategy`);
  return strategy;
}

function clientSource() {
  return `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const directory = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(directory, "surf-client.json"), "utf8"));
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  if (!process.argv[i].startsWith("--")) continue;
  const name = process.argv[i].slice(2);
  const next = process.argv[i + 1];
  args[name] = next && !next.startsWith("--") ? (i++, next) : true;
}
const template = (value) => typeof value === "string"
  ? value.replace(/\\{\\{([a-zA-Z0-9._-]+)\\}\\}/g, (_, name) => {
      if (args[name] === undefined) throw new Error(\`missing argument --\${name}\`);
      return String(args[name]);
    })
  : Array.isArray(value) ? value.map(template)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, template(item)]))
  : value;
const endpoint = template(manifest.endpoint);
const url = new URL(process.env.SURF_CLIENT_ENDPOINT_URL || endpoint.url);
for (const [name, value] of Object.entries(endpoint.query || {})) url.searchParams.set(name, String(value));
const headers = { ...(endpoint.headers || {}) };
for (const input of manifest.authInputs || []) {
  const value = process.env[input.env];
  if (input.required && !value) throw new Error(\`missing auth environment variable \${input.env}\`);
  if (value && input.header) headers[input.header] = value;
}
const response = await fetch(url, {
  method: endpoint.method,
  headers,
  ...(endpoint.body === undefined ? {} : { body: typeof endpoint.body === "string" ? endpoint.body : JSON.stringify(endpoint.body) }),
});
const text = await response.text();
if (!response.ok) throw new Error(\`HTTP \${response.status}: \${text.slice(0, 500)}\`);
let bodyJson;
try { bodyJson = JSON.parse(text); } catch {}
let output = manifest.extract ? {
  status: response.status,
  ok: response.ok,
  url: response.url,
  headers: Object.fromEntries(response.headers.entries()),
  body: text,
  bodyJson,
} : bodyJson ?? text;
if (manifest.extract?.jsonPath) {
  output = bodyJson ?? output;
  for (const part of manifest.extract.jsonPath.replace(/^\\$\\.?/, "").split(".").filter(Boolean)) output = output?.[part];
}
if (manifest.extract?.field) output = output?.[manifest.extract.field];
process.stdout.write(output === undefined ? "" : typeof output === "string" ? output : JSON.stringify(output, null, 2));
process.stdout.write("\\n");
`;
}

function generateClient({ playbookId, op, strategy, provenance, out, allowWrite = false, origins = [] }) {
  if (op.effect === "write" && !allowWrite) throw new Error("write-capable client projection requires explicit review");
  if (typeof out !== "string" || !out) throw new Error("client projection requires --out <directory>");
  const directory = path.resolve(out);
  const request = strategy.request;
  const endpoint = {
    method: request.method || "GET",
    url: absoluteEndpointUrl(request.url, origins),
    query: request.query || {},
    headers: safeHeaders(request.headers),
    ...(request.body !== undefined ? { body: request.body } : {}),
  };
  assertNoEmbeddedSecrets(endpoint);
  assertUrlHasNoEmbeddedSecrets(endpoint.url);
  if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) throw new Error(`refusing symbolic link: ${directory}`);
  ensurePrivateDir(directory, directory);
  const manifest = {
    version: 1,
    generator: { name: "surf-cli", version: PACKAGE_VERSION },
    source: provenance,
    playbook: playbookId,
    op: op.id,
    effect: op.effect,
    endpoint,
    extract: strategy.extract || null,
    authInputs: Array.isArray(request.authInputs) ? request.authInputs.map((input) => ({ env: input.env, header: input.header, required: input.required !== false })) : [],
    verification: strategy.verify || null,
    verificationCommand: "surf pb client verify .",
    noEmbeddedSecrets: true,
  };
  atomicWriteJson(path.join(directory, "surf-client.json"), manifest, { root: directory });
  atomicWriteFile(path.join(directory, "client.mjs"), clientSource(), { root: directory, encoding: "utf8" });
  atomicWriteJson(path.join(directory, "package.json"), { private: true, type: "module", scripts: { start: "node client.mjs" } }, { root: directory });
  return { directory, manifest };
}

function exportClient(playbookId, opId, out, options = {}) {
  const { playbook, op } = resolveOp(playbookId, opId, options);
  return generateClient({ playbookId, op, strategy: networkStrategy(op), provenance: { type: "playbook", id: playbook.id, op: op.id, ...playbook.provenance }, out, allowWrite: options.allowWrite, origins: op.origins || playbook.origins });
}

function findRecord(site, op, root = getPrivateStateRoot()) {
  const base = recordsRoot(root);
  if (!fs.existsSync(base)) return null;
  return fs.readdirSync(base).filter((name) => name.startsWith("rec-")).map((name) => readRecord(name, root)).filter((record) => record?.site === site && record?.op === op).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0] || null;
}

function deriveClient(site, opId, out, options = {}) {
  const root = options.root || getPrivateStateRoot();
  const record = options.recordId ? readRecord(options.recordId, root) : findRecord(site, opId, root);
  if (!record) throw new Error(`no record found for ${site} ${opId}`);
  const trace = readPrivateJson(path.join(recordsRoot(root), record.id, "network", "trace.json"), null, { root });
  const candidates = (trace?.entries || []).filter((candidate) => ["GET", "HEAD", "OPTIONS", "POST"].includes(candidate.method) && candidate.status >= 200 && candidate.status < 400);
  const entry = options.requestId
    ? candidates.find((candidate) => candidate.id === options.requestId || candidate._requestId === options.requestId)
    : candidates.length === 1 ? candidates[0] : null;
  if (!options.requestId && candidates.length > 1) throw new Error(`record ${record.id} has multiple read endpoints; pass --request-id`);
  if (!entry) throw new Error(`record ${record.id} has no validated read endpoint`);
  const op = { id: opId, effect: "read", run: [] };
  const url = new URL(entry.url);
  const query = Object.fromEntries(url.searchParams.entries());
  url.search = "";
  const strategy = { using: "network", request: { method: entry.method, url: url.toString(), query, headers: safeHeaders(entry.requestHeaders), ...(entry.requestBody !== undefined ? { body: entry.requestBody } : {}) } };
  return generateClient({ playbookId: site, op, strategy, provenance: { type: "record", recordId: record.id }, out });
}

function collectTemplateArgs(value, names = new Set()) {
  if (typeof value === "string") {
    for (const match of value.matchAll(/\{\{([a-zA-Z0-9._-]+)\}\}/g)) names.add(match[1]);
  } else if (Array.isArray(value)) {
    for (const item of value) collectTemplateArgs(item, names);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectTemplateArgs(item, names);
  }
  return names;
}

function clientArgs(manifest) {
  return [...collectTemplateArgs(manifest.endpoint)].flatMap((name) => [`--${name}`, "verify"]);
}

function authEnv(manifest, live) {
  const env = {};
  for (const input of manifest.authInputs || []) {
    if (!input.env) continue;
    if (live) {
      if (process.env[input.env] !== undefined) env[input.env] = process.env[input.env];
    } else env[input.env] = "verify-token";
  }
  return env;
}

function verificationBody(manifest) {
  if (manifest.extract?.field === "body") return "verified";
  return JSON.stringify({ ok: true, body: "verified", data: "verified", items: ["verified"] });
}

function templateForVerify(value) {
  if (typeof value === "string") return value.replace(/\{\{[a-zA-Z0-9._-]+\}\}/g, "verify");
  if (Array.isArray(value)) return value.map(templateForVerify);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, templateForVerify(item)]));
  return value;
}

function runClient(resolved, manifest, { env = {}, live = false } = {}) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [path.join(resolved, "client.mjs"), ...clientArgs(manifest)], {
      cwd: resolved,
      env: { ...process.env, ...authEnv(manifest, live), ...env },
      encoding: "utf8",
      timeout: 30000,
    }, (error, stdout, stderr) => {
      if (error) {
        error.message = stderr || error.message;
        reject(error);
      } else resolve(stdout);
    });
  });
}

async function verifyWithLocalServer(resolved, manifest) {
  const requests = [];
  const endpoint = templateForVerify(manifest.endpoint);
  const expectedUrl = new URL(endpoint.url);
  for (const [name, value] of Object.entries(endpoint.query || {})) expectedUrl.searchParams.set(name, String(value));
  const expectedPath = `${expectedUrl.pathname}${expectedUrl.search}`;
  const expectedBody = endpoint.body === undefined ? undefined : typeof endpoint.body === "string" ? endpoint.body : JSON.stringify(endpoint.body);
  const server = http.createServer((request, response) => {
    let requestBody = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { requestBody += chunk; });
    request.on("end", () => {
      requests.push({ method: request.method, url: request.url, body: requestBody });
      const body = verificationBody(manifest);
      response.writeHead(manifest.verification?.status || 200, { "content-type": body.startsWith("{") ? "application/json" : "text/plain" });
      response.end(body);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const stdout = await runClient(resolved, manifest, {
      env: { SURF_CLIENT_ENDPOINT_URL: `http://127.0.0.1:${address.port}${expectedPath}` },
    });
    if (requests.length === 0) throw new Error("generated client did not call its verification endpoint");
    const request = requests[0];
    if (request.method !== endpoint.method) throw new Error(`generated client used ${request.method} instead of ${endpoint.method}`);
    if (request.url !== expectedPath) throw new Error(`generated client requested ${request.url} instead of ${expectedPath}`);
    if (expectedBody !== undefined && request.body !== expectedBody) throw new Error("generated client request body did not match the projected endpoint");
    return { requests: requests.length, stdout: stdout.trim() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function verifyClient(directory, { live } = {}) {
  const resolved = path.resolve(directory);
  const manifest = JSON.parse(fs.readFileSync(path.join(resolved, "surf-client.json"), "utf8"));
  const source = fs.readFileSync(path.join(resolved, "client.mjs"), "utf8");
  const serialized = `${JSON.stringify(manifest)}\n${source}`.toLowerCase();
  if (!manifest.noEmbeddedSecrets || /bearer [a-z0-9._-]+|cookie:\s*[^<]|authorization\s*[:=]\s*["'][^<]/i.test(serialized)) throw new Error("generated client contains embedded credentials");
  if (!manifest.endpoint?.method || !manifest.endpoint?.url) throw new Error("generated client endpoint is incomplete");
  absoluteEndpointUrl(manifest.endpoint.url);
  const execution = live ? { stdout: (await runClient(resolved, manifest, { live: true })).trim() } : await verifyWithLocalServer(resolved, manifest);
  return { valid: true, playbook: manifest.playbook, op: manifest.op, endpoint: manifest.endpoint, execution };
}

module.exports = { absoluteEndpointUrl, deriveClient, exportClient, generateClient, verifyClient };
