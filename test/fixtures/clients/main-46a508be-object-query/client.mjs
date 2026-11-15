#!/usr/bin/env node
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
  ? value.replace(/\{\{([a-zA-Z0-9._-]+)\}\}/g, (_, name) => {
      if (args[name] === undefined) throw new Error(`missing argument --${name}`);
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
  if (input.required && !value) throw new Error(`missing auth environment variable ${input.env}`);
  if (value && input.header) headers[input.header] = value;
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
process.stdout.write(output === undefined ? "" : typeof output === "string" ? output : JSON.stringify(output, null, 2));
process.stdout.write("\n");
