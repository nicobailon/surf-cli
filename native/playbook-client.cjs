const fs = require("fs");
const path = require("path");
const { atomicWriteFile, atomicWriteJson, ensurePrivateDir } = require("./private-state.cjs");
const { resolveOp } = require("./playbooks.cjs");
const { readRecord, recordsRoot } = require("./playbook-records.cjs");
const { getPrivateStateRoot, readPrivateJson } = require("./private-state.cjs");
const { version: PACKAGE_VERSION } = require("../package.json");

const SECRET_HEADERS = new Set(["authorization", "cookie", "proxy-authorization", "set-cookie", "x-api-key"]);

function safeHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !SECRET_HEADERS.has(name.toLowerCase())));
}

function isTemplate(value) {
  return typeof value === "string" && /\{\{[a-zA-Z0-9._-]+\}\}/.test(value);
}

function assertNoEmbeddedSecrets(value, key = "") {
  if (Array.isArray(value)) {
    for (const item of value) assertNoEmbeddedSecrets(item, key);
    return;
  }
  if (value && typeof value === "object") {
    for (const [name, item] of Object.entries(value)) assertNoEmbeddedSecrets(item, name);
    return;
  }
  if (typeof value !== "string" || isTemplate(value)) return;
  if (/(?:^|[-_])(authorization|cookie|password|secret|token|api[-_]?key)(?:$|[-_])/i.test(key) && value) {
    throw new Error(`client projection requires an auth input instead of a literal ${key}`);
  }
  if (/\bbearer\s+[a-z0-9._~-]+|\bsk-[a-z0-9_-]{12,}|\bgh[pousr]_[a-z0-9_]{12,}|\beyj[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+/i.test(value)) {
    throw new Error("client projection contains a credential-like literal");
  }
}

function assertUrlHasNoEmbeddedSecrets(url) {
  if (typeof url !== "string") return;
  let parsed;
  try { parsed = new URL(url, "https://surf.invalid"); } catch { return; }
  for (const [name, value] of parsed.searchParams) assertNoEmbeddedSecrets(value, name);
}

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
const url = new URL(endpoint.url);
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
let output = text;
try { output = JSON.parse(text); } catch {}
if (manifest.extract?.jsonPath) {
  for (const part of manifest.extract.jsonPath.replace(/^\\$\\.?/, "").split(".").filter(Boolean)) output = output[part];
}
process.stdout.write(typeof output === "string" ? output : JSON.stringify(output, null, 2));
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
  const entry = trace?.entries?.findLast((candidate) => ["GET", "HEAD"].includes(candidate.method) && candidate.status >= 200 && candidate.status < 400);
  if (!entry) throw new Error(`record ${record.id} has no validated read endpoint`);
  const op = { id: opId, effect: "read", run: [] };
  const strategy = { using: "network", request: { method: entry.method, url: entry.url, headers: safeHeaders(entry.requestHeaders) } };
  return generateClient({ playbookId: site, op, strategy, provenance: { type: "record", recordId: record.id }, out });
}

async function verifyClient(directory, { fetchImpl = globalThis.fetch, live } = {}) {
  const resolved = path.resolve(directory);
  const manifest = JSON.parse(fs.readFileSync(path.join(resolved, "surf-client.json"), "utf8"));
  const source = fs.readFileSync(path.join(resolved, "client.mjs"), "utf8");
  const serialized = `${JSON.stringify(manifest)}\n${source}`.toLowerCase();
  if (!manifest.noEmbeddedSecrets || /bearer [a-z0-9._-]+|cookie:\s*[^<]|authorization\s*[:=]\s*["'][^<]/i.test(serialized)) throw new Error("generated client contains embedded credentials");
  if (!manifest.endpoint?.method || !manifest.endpoint?.url) throw new Error("generated client endpoint is incomplete");
  absoluteEndpointUrl(manifest.endpoint.url);
  let liveResult = null;
  if (live === true || (live !== false && manifest.verification?.url)) {
    const response = await fetchImpl(manifest.verification?.url || manifest.endpoint.url, { method: manifest.endpoint.method, headers: manifest.endpoint.headers });
    const expected = manifest.verification?.status || 200;
    if (response.status !== expected) throw new Error(`client verification expected HTTP ${expected}, got ${response.status}`);
    liveResult = { status: response.status };
  }
  return { valid: true, playbook: manifest.playbook, op: manifest.op, endpoint: manifest.endpoint, live: liveResult };
}

module.exports = { absoluteEndpointUrl, deriveClient, exportClient, generateClient, safeHeaders, verifyClient };
