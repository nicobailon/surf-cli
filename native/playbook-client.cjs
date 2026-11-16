const fs = require("fs");
const http = require("http");
const path = require("path");
const { execFile } = require("child_process");
const { atomicWriteFile, atomicWriteJson, ensurePrivateDir, getPrivateStateRoot, readPrivateJson } = require("./private-state.cjs");
const { renderRequest, resolveArgValues } = require("./playbook-template.cjs");
const { resolveOp } = require("./playbooks.cjs");
const { isReplayCandidate, readRecord, recordsRoot, requestEffect } = require("./playbook-records.cjs");
const { WINNER_MARGIN, isWeak, scoreEntries } = require("./record-candidates.cjs");
const { assertNoEmbeddedSecrets, assertUrlHasNoEmbeddedSecrets, redactObject, redactValues, safeHeaders } = require("./redaction.cjs");
const { version: PACKAGE_VERSION } = require("../package.json");

// URL parsing would percent-encode `{{name}}` in a path, so placeholders sit out the parse.
function absoluteEndpointUrl(url, origins = []) {
  if (typeof url !== "string" || !url) throw new Error("client projection requires an endpoint URL");
  const placeholders = [];
  const masked = url.replace(/\{\{[a-zA-Z0-9._-]+\}\}/g, (match) => `__surf_template_${placeholders.push(match) - 1}__`);
  const unmask = (text) => text.replace(/__surf_template_(\d+)__/g, (_, index) => placeholders[Number(index)]);
  try {
    const parsed = new URL(masked);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("client projection endpoint must use HTTP(S)");
    return unmask(parsed.toString());
  } catch (error) {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) throw error;
  }
  if (!Array.isArray(origins) || origins.length !== 1) {
    throw new Error("client projection requires an absolute endpoint URL or exactly one declared origin");
  }
  const resolved = new URL(masked, origins[0]);
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") throw new Error("client projection endpoint must use HTTP(S)");
  return unmask(resolved.toString());
}

function usesJsonExtract(extract) {
  return Boolean(extract && (extract.records !== undefined || extract.fields || extract.filter));
}

function networkStrategy(op) {
  const strategy = op.run.find((candidate) => candidate.using === "network");
  if (!strategy) throw new Error(`op ${op.id} has no validated network strategy`);
  return strategy;
}

// The generated client's options: `--name value` and `--name=value`, either of which can be the
// empty string. A bare `--name` is true only for an input the op declares a boolean.
function parseClientArgs(argv, specs) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const equals = argv[i].indexOf("=");
    if (equals > 2) {
      args[argv[i].slice(2, equals)] = argv[i].slice(equals + 1);
      continue;
    }
    const name = argv[i].slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) args[name] = argv[++i];
    else if (specs[name]?.type === "boolean") args[name] = true;
    else throw new Error(`--${name} needs a value (--${name} "" for an empty one)`);
  }
  return args;
}

function clientSource() {
  return `#!/usr/bin/env node
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const directory = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(directory, "surf-client.json"), "utf8"));
${parseClientArgs.toString()}
const args = parseClientArgs(process.argv.slice(2), manifest.args || {});
${resolveArgValues.toString()}
${renderRequest.toString()}
const endpoint = renderRequest(manifest.endpoint, resolveArgValues(manifest.args || {}, args));
// SURF_CLIENT_ORIGIN sends the request to another origin (pb client verify's local server).
let url = new URL(endpoint.url);
if (process.env.SURF_CLIENT_ORIGIN) url = new URL(\`\${url.pathname}\${url.search}\`, process.env.SURF_CLIENT_ORIGIN);
else if (process.env.SURF_CLIENT_ENDPOINT_URL) url = new URL(process.env.SURF_CLIENT_ENDPOINT_URL);
for (const [name, value] of Object.entries(endpoint.query)) url.searchParams.set(name, value);
const headers = { ...endpoint.headers };
// Env-supplied values are redacted from what the client prints, output and errors alike.
const secretValues = [];
${redactValues.toString()}
${redactObject.toString()}
const redact = (text) => redactValues(text, secretValues);
process.on("uncaughtException", (error) => {
  process.stderr.write(\`\${redact(error?.stack || error)}\\n\`);
  process.exit(1);
});
for (const input of manifest.authInputs || []) {
  const value = process.env[input.env];
  if (input.required && !value) throw new Error(\`missing auth environment variable \${input.env}\`);
  if (value && input.header) {
    headers[input.header] = value;
    secretValues.push(value);
  }
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
if (manifest.extract && (manifest.extract.records !== undefined || manifest.extract.fields || manifest.extract.filter)) {
  // records.cjs is Surf's own JSON extraction, copied next to this client.
  const { extractRecords } = createRequire(import.meta.url)("./records.cjs");
  output = extractRecords(bodyJson ?? output, manifest.extract);
}
// Objects are redacted before they become text, so a secret used as a key can't merge two keys.
process.stdout.write(output === undefined ? "" : typeof output === "string" ? redact(output) : JSON.stringify(redactObject(output, secretValues), null, 2));
process.stdout.write("\\n");
`;
}

// The op's inputs the request uses; inputs only its browser steps take aren't asked for.
function endpointArgs(op, endpoint) {
  const used = collectTemplateArgs(endpoint);
  return Object.fromEntries(Object.entries(op.args || {}).filter(([name]) => used.has(name)));
}

function generateClient({ playbookId, op, strategy, provenance, out, allowWrite = false, origins = [] }) {
  if (op.effect === "write" && !allowWrite) throw new Error(`op ${op.id} can write, and pb client derive and export refuse write requests for now (only GET, HEAD or OPTIONS)`);
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
  const warnings = [];
  let extract = strategy.extract || null;
  const extractHtml = extract?.html;
  if (extractHtml) {
    warnings.push("extract.html runs only through surf use (Node has no DOM); this client prints the raw HTML body");
    extract = null;
  }
  ensurePrivateDir(directory, directory);
  const manifest = {
    version: 1,
    generator: { name: "surf-cli", version: PACKAGE_VERSION },
    source: provenance,
    playbook: playbookId,
    op: op.id,
    effect: op.effect,
    endpoint,
    args: endpointArgs(op, endpoint),
    extract,
    // surf use returns these records; this client prints the raw HTML body instead.
    ...(extractHtml ? { extractHtml } : {}),
    authInputs: Array.isArray(request.authInputs) ? request.authInputs.map((input) => ({ env: input.env, header: input.header, required: input.required !== false })) : [],
    verification: strategy.verify || null,
    verificationCommand: "surf pb client verify .",
    noEmbeddedSecrets: true,
  };
  atomicWriteJson(path.join(directory, "surf-client.json"), manifest, { root: directory });
  atomicWriteFile(path.join(directory, "client.mjs"), clientSource(), { root: directory, encoding: "utf8" });
  atomicWriteJson(path.join(directory, "package.json"), { private: true, type: "module", scripts: { start: "node client.mjs" } }, { root: directory });
  if (usesJsonExtract(extract)) {
    atomicWriteFile(path.join(directory, "records.cjs"), fs.readFileSync(path.join(__dirname, "records.cjs"), "utf8"), { root: directory, encoding: "utf8" });
  }
  return { directory, manifest, warnings };
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

// Without --request-id, derive takes the top-ranked request when it is a strong match and leads the
// next by WINNER_MARGIN points.
function clearWinner(candidates, record) {
  const [top, next] = scoreEntries(candidates, { origin: record.origin }).filter((candidate) => candidate.eligible);
  if (!top || isWeak(top) || (next && top.score - next.score < WINNER_MARGIN)) return null;
  return top.entry;
}

/** The extract of a saved op's network strategy, so a derived client returns the same records. */
function savedExtract(site, opId, { cwd, home } = {}) {
  try {
    return resolveOp(site, opId, { cwd, home }).op.run.find((strategy) => strategy.using === "network")?.extract;
  } catch (error) {
    if (/^(Playbook|Op) not found/.test(error.message)) return undefined;
    throw error;
  }
}

function deriveClient(site, opId, out, options = {}) {
  const root = options.root || getPrivateStateRoot();
  const record = options.recordId ? readRecord(options.recordId, root) : findRecord(site, opId, root);
  if (!record) throw new Error(`no record found for ${site} ${opId}`);
  const trace = readPrivateJson(path.join(recordsRoot(root), record.id, "network", "trace.json"), null, { root });
  const candidates = (trace?.entries || []).filter(isReplayCandidate);
  const entry = options.requestId
    ? candidates.find((candidate) => candidate.id === options.requestId || candidate._requestId === options.requestId)
    : candidates.length === 1 ? candidates[0] : clearWinner(candidates, record);
  if (!options.requestId && candidates.length > 1 && !entry) throw new Error(`record ${record.id} has several read endpoints and no clear winner; run surf pb record candidates ${record.id} and pass --request-id`);
  if (!entry) throw new Error(`record ${record.id} has no validated read endpoint`);
  const op = { id: opId, effect: requestEffect(entry), run: [] };
  const url = new URL(entry.url);
  const query = Object.fromEntries(url.searchParams.entries());
  url.search = "";
  const extract = savedExtract(site, opId, options);
  const strategy = { using: "network", request: { method: entry.method, url: url.toString(), query, headers: safeHeaders(entry.requestHeaders), ...(entry.requestBody !== undefined ? { body: entry.requestBody } : {}) }, ...(extract ? { extract } : {}) };
  return generateClient({ playbookId: site, op, strategy, provenance: { type: "record", recordId: record.id }, out, allowWrite: options.allowWrite });
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

// Sample inputs for verification: each input's default, else a value of its type.
function sampleArgs(manifest) {
  const specs = manifest.args || {};
  const samples = { string: "verify", number: 1, boolean: true };
  return Object.fromEntries([...collectTemplateArgs(manifest.endpoint)].map((name) => [name, specs[name]?.default ?? samples[specs[name]?.type] ?? "verify"]));
}

// Clients made before parseClientArgs read `--name ""` as true, so an empty value is left out for
// them and the client takes it from its default.
function clientArgs(manifest, source) {
  const takesEmpty = source.includes("function parseClientArgs(");
  return Object.entries(sampleArgs(manifest))
    .filter(([, value]) => takesEmpty || String(value) !== "")
    .flatMap(([name, value]) => [`--${name}`, String(value)]);
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

// Nests `leaf` at a $.a.b[0] path, so a records extract finds its array.
function bodyAt(jsonPath, leaf) {
  const parts = jsonPath.slice(1).match(/\[(?:\d+|\*)\]|[^.[\]]+/g) || [];
  return parts.reduceRight((value, part) => {
    if (!part.startsWith("[")) return { [part]: value };
    return new Array(part === "[*]" ? 1 : Number(part.slice(1, -1)) + 1).fill(value);
  }, leaf);
}

const VERIFY_HTML = "<html><body><p>verified</p></body></html>";

function verificationBody(manifest) {
  if (manifest.extract?.field === "body") return "verified";
  if (manifest.extractHtml) return VERIFY_HTML;
  if (manifest.extract?.records !== undefined) return JSON.stringify(bodyAt(manifest.extract.records, [{}]));
  return JSON.stringify({ ok: true, body: "verified", data: "verified", items: ["verified"] });
}

function runClient(resolved, manifest, source, { env = {}, live = false } = {}) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [path.join(resolved, "client.mjs"), ...clientArgs(manifest, source)], {
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

// Clients made before the shared renderer (they don't embed renderRequest) put "verify" for every
// placeholder and send each query value with String(), objects as "[object Object]".
function legacyEndpoint(value) {
  if (typeof value === "string") return value.replace(/\{\{[a-zA-Z0-9._-]+\}\}/g, "verify");
  if (Array.isArray(value)) return value.map(legacyEndpoint);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, legacyEndpoint(item)]));
  return value;
}

function expectedEndpoint(manifest, source) {
  if (!source.includes("function renderRequest(")) {
    const endpoint = legacyEndpoint(manifest.endpoint);
    return { ...endpoint, query: Object.fromEntries(Object.entries(endpoint.query || {}).map(([name, value]) => [name, String(value)])) };
  }
  return renderRequest(manifest.endpoint, resolveArgValues(manifest.args || {}, sampleArgs(manifest)));
}

async function verifyWithLocalServer(resolved, manifest, source) {
  const requests = [];
  const endpoint = expectedEndpoint(manifest, source);
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
      const type = manifest.extractHtml ? "text/html" : body.startsWith("{") ? "application/json" : "text/plain";
      response.writeHead(manifest.verification?.status || 200, { "content-type": type });
      response.end(body);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const stdout = await runClient(resolved, manifest, source, {
      // Clients made before SURF_CLIENT_ORIGIN read the whole URL.
      env: { SURF_CLIENT_ORIGIN: `http://127.0.0.1:${address.port}`, SURF_CLIENT_ENDPOINT_URL: `http://127.0.0.1:${address.port}${expectedPath}` },
    });
    if (requests.length === 0) throw new Error("generated client did not call its verification endpoint");
    const request = requests[0];
    if (request.method !== endpoint.method) throw new Error(`generated client used ${request.method} instead of ${endpoint.method}`);
    if (request.url !== expectedPath) throw new Error(`generated client requested ${request.url} instead of ${expectedPath}`);
    if (expectedBody !== undefined && request.body !== expectedBody) throw new Error("generated client request body did not match the projected endpoint");
    if (manifest.extractHtml && stdout.trim() !== VERIFY_HTML) throw new Error("generated client did not print the raw HTML body (extract.html runs only through surf use)");
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
  const execution = live ? { stdout: (await runClient(resolved, manifest, source, { live: true })).trim() } : await verifyWithLocalServer(resolved, manifest, source);
  return { valid: true, playbook: manifest.playbook, op: manifest.op, endpoint: manifest.endpoint, execution };
}

module.exports = { absoluteEndpointUrl, deriveClient, exportClient, generateClient, verifyClient };
