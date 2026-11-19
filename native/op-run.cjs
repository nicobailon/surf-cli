// Runs an op with the flat keys. The tab sends `request` and returns the body; else the tab opens
// `open`, runs `steps` and returns the rendered HTML. Node reads either with the op's extract. A read
// tries each step it has, in that order, and keeps the first that passes `expect`; a write runs its
// first step once. `page` and --pages read more pages; --url points the op at another URL of its site.

const { readNext, readResponse } = require("./op-extract.cjs");
const { executeWorkflow } = require("./workflow-runtime.cjs");

const PAGE_DELAY_MS = 1000;
// The tab hands whole bodies to the host; `surf js` keeps its own 50,000-character cap.
const BODY_LIMIT = 64 * 1024 * 1024;
const ANY = /\{\{(env\.)?([a-zA-Z0-9._-]+)\}\}/g;
const EXACT = /^\{\{(env\.)?([a-zA-Z0-9._-]+)\}\}$/;
const PAGE_SCRIPT = "({ url: location.href, html: document.documentElement.outerHTML })";
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Fills `{{input}}` and `{{env.NAME}}`. A string that is only `{{input}}` takes the input's own value
 * (left out of an object when unset); inside a longer string a value goes in as text through
 * `encode`. With `env: null` (a dry run) `{{env.NAME}}` stays as written.
 */
function renderTemplate(value, { args, env, encode = String }) {
  const lookup = (isEnv, name) => {
    if (!isEnv) return args[name];
    if (env === null) return `{{env.${name}}}`;
    if (env[name] === undefined) throw new Error(`environment variable ${name} is not set`);
    return env[name];
  };
  if (typeof value === "string") {
    const exact = value.match(EXACT);
    if (exact) return lookup(exact[1], exact[2]);
    return value.replace(ANY, (_, isEnv, name) => {
      const filled = lookup(isEnv, name);
      if (filled === undefined) throw new Error(`missing input: ${name}`);
      return isEnv && env === null ? filled : encode(String(filled));
    });
  }
  if (Array.isArray(value)) return value.map((item) => renderTemplate(item, { args, env, encode }));
  if (!isObject(value)) return value;
  const entries = Object.entries(value).map(([key, item]) => [key, renderTemplate(item, { args, env, encode })]);
  return Object.fromEntries(entries.filter(([, item]) => item !== undefined));
}

function renderUrl(template, context) {
  const url = renderTemplate(template, { ...context, encode: encodeURIComponent });
  if (url === undefined) throw new Error(`missing input: ${template.slice(2, -2)}`);
  if (!URL.canParse(String(url))) throw new Error(`an op's URL must be absolute: ${url}`);
  return new URL(String(url)).href;
}

/** The request as sent: query in the URL, a JSON or form body encoded by its content type. */
function renderRequest(request, context) {
  const url = new URL(renderUrl(request.url, context));
  for (const [key, value] of Object.entries(renderTemplate(request.query || {}, context))) {
    url.searchParams.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  const headers = renderTemplate(request.headers || {}, context);
  const sent = { method: String(request.method || "GET").toUpperCase(), url: url.href, headers };
  if (request.body === undefined) return sent;
  const body = renderTemplate(request.body, context);
  const type = Object.entries(headers).find(([name]) => name.toLowerCase() === "content-type")?.[1] || "";
  if (typeof body === "string") sent.body = body;
  else if (/x-www-form-urlencoded/i.test(type)) sent.body = new URLSearchParams(Object.entries(body).map(([key, item]) => [key, String(item)])).toString();
  else {
    sent.body = JSON.stringify(body);
    if (!type) headers["content-type"] = "application/json";
  }
  return sent;
}

function requestScript({ method, url, headers, body }) {
  return `(async () => {
const url = new URL(${JSON.stringify(url)});
if (location.origin !== url.origin) return { elsewhere: location.origin };
const response = await fetch(url, { method: ${JSON.stringify(method)}, credentials: "include", headers: ${JSON.stringify(headers)}${body === undefined ? "" : `, body: ${JSON.stringify(body)}`} });
return { status: response.status, url: response.url, contentType: response.headers.get("content-type") || "", body: await response.text() };
})()`;
}

// The origins an op may reach: its playbook's, and its own request and open URLs'.
function siteOrigins(op) {
  const origins = new Set(op.origins || []);
  for (const url of [op.request?.url, op.open]) {
    try { origins.add(new URL(url).origin); } catch {}
  }
  return origins;
}

function assertSite(url, origins) {
  const { origin } = new URL(url);
  if (origins.size > 0 && !origins.has(origin)) throw new Error(`refused: ${origin} is not this op's site (${[...origins].join(", ")})`);
}

async function evaluate(context, code) {
  const response = await context.executeTool("javascript_tool", { code, maxOutput: BODY_LIMIT }, { signal: context.signal });
  if (response?.error) throw new Error(typeof response.error === "string" ? response.error : JSON.stringify(response.error));
  return response?.output !== undefined ? JSON.parse(response.output) : (response?.value ?? response);
}

async function openPage(context, url, steps) {
  const result = await executeWorkflow([{ cmd: "navigate", args: { url } }, ...steps], {
    autoWait: true,
    executeTool: context.executeTool,
    onEvent: context.onEvent,
    signal: context.signal,
    sleep: context.sleep,
    stepDelay: 100,
    vars: context.args,
  });
  if (result.status !== "completed") throw new Error(result.error || "page steps failed");
}

// One page's response: { status?, body, contentType, url }.
async function readStep(via, context, { args, url, steps }) {
  const { op, env, origins } = context;
  if (via === "tab") {
    const request = renderRequest(url === undefined ? op.request : { ...op.request, url }, { args, env });
    assertSite(request.url, origins);
    await context.markDispatched();
    let response = await evaluate(context, requestScript(request));
    if (response?.elsewhere) {
      await openPage(context, `${new URL(request.url).origin}/`, []);
      response = await evaluate(context, requestScript(request));
    }
    if (response?.elsewhere) throw new Error(`the tab stayed on ${response.elsewhere}`);
    return response;
  }
  const target = url ?? renderUrl(op.open, { args, env });
  assertSite(target, origins);
  await context.markDispatched();
  await openPage(context, target, renderTemplate(steps, { args, env }));
  const page = await evaluate(context, PAGE_SCRIPT);
  return { body: page.html, contentType: "text/html", url: page.url };
}

function checkExpect(value, expect = {}, status) {
  if (expect.status !== undefined && status !== undefined && status !== expect.status) throw new Error(`expected status ${expect.status}, got ${status}`);
  const count = Array.isArray(value) ? value.length : value === undefined ? 0 : 1;
  if (expect.minItems !== undefined && count < expect.minItems) throw new Error(`expected at least ${expect.minItems} records, got ${count}`);
  const first = Array.isArray(value) ? value[0] : value;
  for (const field of expect.fields || []) {
    if (!isObject(first) || first[field] === undefined || first[field] === null || first[field] === "") throw new Error(`expected field ${field} in the first record`);
  }
}

// The next page's inputs ({ args }) or URL ({ url }) by the op's `page` rule; undefined at the end.
function nextPage({ into, next }, response, args) {
  const step = next.match(/^\+(\d+)$/);
  if (step) return { args: { ...args, [into]: Number(args[into] ?? 0) + Number(step[1]) } };
  const value = readNext(response, next);
  if (value === undefined) return undefined;
  return into ? { args: { ...args, [into]: value } } : { url: new URL(value, response.url).href };
}

async function readPages(via, context) {
  const { op } = context;
  let cursor = { args: context.args, url: context.url, steps: op.steps || [] };
  const records = [];
  for (let page = 1; ; page++) {
    const response = await readStep(via, context, cursor);
    if (response.status >= 400) throw new Error(`status ${response.status}`);
    const value = readResponse(response, op.extract);
    if (page === 1) checkExpect(value, op.expect, response.status);
    if (!Array.isArray(value)) return value;
    records.push(...value);
    if (page >= context.pages || !op.page || value.length === 0) return records;
    const next = nextPage(op.page, response, cursor.args);
    if (!next) return records;
    if (next.url) assertSite(next.url, context.origins);
    cursor = next.url ? { ...cursor, url: next.url, steps: [] } : { ...cursor, args: next.args };
    await context.sleep(PAGE_DELAY_MS);
  }
}

async function runOp({ playbook, op, args, url, pages = 1, env = {}, executeTool, signal, sleep = async () => {}, onEvent = () => {}, beforeDispatch = async () => {}, afterDispatch = async () => {} }) {
  if (op.chain) throw new Error(`op ${op.id} is a chain, and chains don't run yet`);
  const origins = siteOrigins(op);
  if (url !== undefined) assertSite(url, origins);
  const write = op.effect === "write";
  const vias = [...(op.request ? ["tab"] : []), ...(op.open ? ["page"] : [])].slice(0, write ? 1 : 2);
  const attempts = [];
  for (const via of vias) {
    let dispatched = false;
    const markDispatched = async () => {
      if (!write || dispatched) return;
      dispatched = true;
      await beforeDispatch({ via, args });
    };
    const event = { playbook: playbook.id, op: op.id, using: via };
    onEvent({ type: "strategy.started", ...event, startedAt: new Date().toISOString() });
    try {
      const value = await readPages(via, { op, args, url, pages: write ? 1 : pages, env, executeTool, signal, sleep, onEvent, origins, markDispatched });
      if (write) await afterDispatch({ status: "verified", via });
      onEvent({ type: "strategy.completed", ...event, endedAt: new Date().toISOString() });
      return { status: "completed", playbook: playbook.id, op: op.id, via, value, provenance: playbook.provenance, attempts };
    } catch (error) {
      const message = error?.message || String(error);
      attempts.push({ via, error: message });
      onEvent({ type: "strategy.failed", ...event, error: message, endedAt: new Date().toISOString() });
      if (write) {
        await afterDispatch({ status: dispatched ? "indeterminate" : "not_dispatched", via, error: message });
        throw error;
      }
    }
  }
  throw new Error(`All steps failed (${attempts.map((attempt) => `${attempt.via}: ${attempt.error}`).join("; ")})`);
}

/** What the op would send, with `{{env.NAME}}` left as written. Sends nothing. */
function dryRunOp({ playbook, op, args, url }) {
  if (url !== undefined) assertSite(url, siteOrigins(op));
  const base = { dryRun: true, playbook: playbook.id, op: op.id };
  const context = { args, env: null };
  if (op.request) return { ...base, via: "tab", request: renderRequest(url === undefined ? op.request : { ...op.request, url }, context) };
  if (op.open) return { ...base, via: "page", open: url ?? renderUrl(op.open, context), steps: renderTemplate(op.steps || [], context) };
  throw new Error(`--dry-run shows ops with request or open; ${op.id} has ${op.chain ? "a chain" : "a run list"}`);
}

module.exports = { dryRunOp, renderRequest, renderTemplate, runOp };
