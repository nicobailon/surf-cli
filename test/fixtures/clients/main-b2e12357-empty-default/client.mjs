#!/usr/bin/env node
import fs from "node:fs";
import { createRequire } from "node:module";
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
function resolveArgValues(specs, provided) {
  const args = { ...provided };
  for (const [name, spec] of Object.entries(specs || {})) {
    if (args[name] === undefined && spec.default !== undefined) args[name] = spec.default;
    if (spec.required && args[name] === undefined) throw new Error(`Missing required argument: --${name}`);
    const value = args[name];
    if (value === undefined || spec.type === undefined) continue;
    if (spec.type === "string") args[name] = String(value);
    else if (spec.type === "number") {
      const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
      if (typeof number !== "number" || !Number.isFinite(number)) throw new Error(`--${name} must be a number`);
      args[name] = number;
    } else if (spec.type === "boolean") {
      if (value !== true && value !== false && value !== "true" && value !== "false") throw new Error(`--${name} must be true or false`);
      args[name] = value === true || value === "true";
    }
  }
  return args;
}
function renderRequest(request, args) {
  const EXACT = /^\{\{([a-zA-Z0-9._-]+)\}\}$/;
  const ANY = /\{\{([a-zA-Z0-9._-]+)\}\}/g;
  const keep = (text) => text;
  const embed = (text, encode) => text.replace(ANY, (_, name) => {
    if (args[name] === undefined) throw new Error(`missing template argument: ${name}`);
    return encode(String(args[name]));
  });
  const fill = (value, encode = keep) => {
    if (typeof value === "string") {
      const exact = value.match(EXACT);
      return exact ? args[exact[1]] : embed(value, encode);
    }
    if (Array.isArray(value)) return value.map((item) => fill(item));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fill(item)]));
    return value;
  };
  const headers = {};
  for (const [name, value] of Object.entries(request.headers || {})) {
    const filled = fill(value);
    if (filled !== undefined && filled !== null) headers[name] = String(filled);
  }
  const query = {};
  for (const [name, value] of Object.entries(request.query || {})) {
    const filled = fill(value);
    if (filled !== undefined && filled !== null) query[name] = typeof filled === "object" ? JSON.stringify(filled) : String(filled);
  }
  const contentType = Object.entries(request.headers || {}).find(([name]) => name.toLowerCase() === "content-type")?.[1] || "";
  const form = /application\/x-www-form-urlencoded/i.test(String(contentType));
  const rendered = { ...request, url: fill(request.url, encodeURIComponent), query, headers };
  if (request.body !== undefined) rendered.body = fill(request.body, form ? encodeURIComponent : keep);
  return rendered;
}
const endpoint = renderRequest(manifest.endpoint, resolveArgValues(manifest.args || {}, args));
// SURF_CLIENT_ORIGIN sends the request to another origin (pb client verify's local server).
let url = new URL(endpoint.url);
if (process.env.SURF_CLIENT_ORIGIN) url = new URL(`${url.pathname}${url.search}`, process.env.SURF_CLIENT_ORIGIN);
else if (process.env.SURF_CLIENT_ENDPOINT_URL) url = new URL(process.env.SURF_CLIENT_ENDPOINT_URL);
for (const [name, value] of Object.entries(endpoint.query)) url.searchParams.set(name, value);
const headers = { ...endpoint.headers };
// Env-supplied values are redacted from what the client prints, output and errors alike.
const secretValues = [];
function redactValues(text, values) {
  let result = String(text);
  const sorted = [...values].map(String).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const value of sorted) {
    if (value.length >= 8) result = result.split(value).join("<redacted>");
    else result = result.replace(new RegExp(`(?<![A-Za-z0-9])${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "g"), "<redacted>");
  }
  return result;
}
function redactObject(value, values) {
  if (typeof value === "string") return redactValues(value, values);
  if (Array.isArray(value)) return value.map((item) => redactObject(item, values));
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value).map(([key, item]) => [key, redactValues(key, values), redactObject(item, values)]);
  const taken = new Set(entries.filter(([key, redacted]) => key === redacted).map(([key]) => key));
  return Object.fromEntries(entries.map(([key, redacted, item]) => {
    if (key === redacted) return [key, item];
    let name = redacted;
    for (let index = 2; taken.has(name); index++) name = redacted.replace(/<redacted>/, `<redacted-${index}>`);
    taken.add(name);
    return [name, item];
  }));
}
const redact = (text) => redactValues(text, secretValues);
process.on("uncaughtException", (error) => {
  process.stderr.write(`${redact(error?.stack || error)}\n`);
  process.exit(1);
});
for (const input of manifest.authInputs || []) {
  const value = process.env[input.env];
  if (input.required && !value) throw new Error(`missing auth environment variable ${input.env}`);
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
if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
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
  for (const part of manifest.extract.jsonPath.replace(/^\$\.?/, "").split(".").filter(Boolean)) output = output?.[part];
}
if (manifest.extract?.field) output = output?.[manifest.extract.field];
if (manifest.extract && (manifest.extract.records !== undefined || manifest.extract.fields || manifest.extract.filter)) {
  // records.cjs is Surf's own JSON extraction, copied next to this client.
  const { extractRecords } = createRequire(import.meta.url)("./records.cjs");
  output = extractRecords(bodyJson ?? output, manifest.extract);
}
// Objects are redacted before they become text, so a secret used as a key can't merge two keys.
process.stdout.write(output === undefined ? "" : typeof output === "string" ? redact(output) : JSON.stringify(redactObject(output, secretValues), null, 2));
process.stdout.write("\n");
