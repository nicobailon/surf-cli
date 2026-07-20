const { executeWorkflow } = require("./workflow-runtime.cjs");

function applyTemplate(value, args) {
  if (typeof value === "string") {
    const exact = value.match(/^\{\{([a-zA-Z0-9._-]+)\}\}$/);
    if (exact) return args[exact[1]];
    return value.replace(/\{\{([a-zA-Z0-9._-]+)\}\}/g, (_, name) => {
      if (args[name] === undefined) throw new Error(`missing template argument: ${name}`);
      return String(args[name]);
    });
  }
  if (Array.isArray(value)) return value.map((item) => applyTemplate(item, args));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, applyTemplate(item, args)]));
  return value;
}

function resolveArgs(op, provided) {
  const args = { ...provided };
  for (const [name, spec] of Object.entries(op.args || {})) {
    if (args[name] === undefined && spec.default !== undefined) args[name] = spec.default;
    if (spec.required && args[name] === undefined) throw new Error(`Missing required argument: --${name}`);
  }
  return args;
}

function getJsonPath(value, jsonPath) {
  if (!jsonPath || jsonPath === "$") return value;
  if (typeof jsonPath !== "string" || !jsonPath.startsWith("$.")) throw new Error(`unsupported jsonPath: ${jsonPath}`);
  let current = value;
  for (const part of jsonPath.slice(2).split(".")) {
    if (current === null || current === undefined || !Object.hasOwn(Object(current), part)) throw new Error(`extract path not found: ${jsonPath}`);
    current = current[part];
  }
  return current;
}

function extractResult(result, extract) {
  if (!extract) return result;
  if (extract.jsonPath) {
    const source = result.bodyJson !== undefined ? result.bodyJson : result;
    return getJsonPath(source, extract.jsonPath);
  }
  if (extract.field) return result[extract.field];
  return result;
}

function verifyResult(value, expect = {}, raw = value) {
  if (expect.status !== undefined && raw?.status !== expect.status) throw new Error(`expected status ${expect.status}`);
  if (expect.minItems !== undefined && (!Array.isArray(value) || value.length < expect.minItems)) throw new Error(`expected at least ${expect.minItems} items`);
  if (expect.truthy && !value) throw new Error("expected a truthy result");
  return true;
}

function withServerIdempotency(request, idempotency, attemptId) {
  if (!idempotency || !attemptId) return request;
  const next = { ...request };
  if (idempotency.header) next.headers = { ...(request.headers || {}), [idempotency.header]: attemptId };
  if (idempotency.query) next.query = { ...(request.query || {}), [idempotency.query]: attemptId };
  if (idempotency.body) {
    if (next.body === undefined) next.body = {};
    if (!next.body || typeof next.body !== "object" || Array.isArray(next.body)) {
      throw new Error("server idempotency body field requires an object request body");
    }
    next.body = { ...next.body, [idempotency.body]: attemptId };
  }
  return next;
}

function networkScript(request, allowedOrigins = []) {
  const headers = request.headers || {};
  const query = request.query || {};
  const body = request.body;
  return `(async () => {
const url = new URL(${JSON.stringify(request.url)}, location.href);
const allowedOrigins = ${JSON.stringify(allowedOrigins)};
if (allowedOrigins.length > 0 && !allowedOrigins.includes(url.origin)) {
  throw new Error(\`playbook network origin is not allowed: \${url.origin}\`);
}
for (const [key, value] of Object.entries(${JSON.stringify(query)})) {
  if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
}
const response = await fetch(url.toString(), {
  method: ${JSON.stringify(request.method || "GET")},
  credentials: "include",
  headers: ${JSON.stringify(headers)},
  ${body === undefined ? "" : `body: ${JSON.stringify(typeof body === "string" ? body : JSON.stringify(body))},`}
});
const text = await response.text();
let json;
try { json = JSON.parse(text); } catch {}
return { status: response.status, ok: response.ok, url: response.url, headers: Object.fromEntries(response.headers.entries()), body: text, bodyJson: json };
})()`;
}

async function runStrategy(strategy, context) {
  if (strategy.using === "workflow") {
    const result = await executeWorkflow(applyTemplate(strategy.steps, context.args), {
      autoWait: strategy.autoWait !== false,
      executeTool: async (tool, args, options) => {
        await context.markDispatched?.();
        return context.executeTool(tool, args, options);
      },
      onError: strategy.onError || "stop",
      onEvent: context.onEvent,
      signal: context.signal,
      sleep: context.sleep,
      stepDelay: strategy.stepDelay ?? 100,
      vars: context.args,
    });
    if (result.status !== "completed") throw new Error(result.error || "workflow strategy failed");
    return result;
  }
  if (strategy.using === "network") {
    const request = withServerIdempotency(
      applyTemplate(strategy.request, context.args),
      context.serverIdempotency,
      context.attemptId,
    );
    await context.markDispatched?.();
    const response = await context.executeTool("javascript_tool", { code: networkScript(request, context.allowedOrigins) }, { signal: context.signal });
    if (response?.error) throw new Error(typeof response.error === "string" ? response.error : JSON.stringify(response.error));
    const result = response?.output !== undefined ? JSON.parse(response.output) : response?.value ?? response;
    if (!result?.ok && (strategy.acceptStatus || []).includes(result?.status) === false) throw new Error(`network strategy returned ${result?.status || "an unknown status"}`);
    return result;
  }
  if (strategy.using === "native") {
    if (typeof context.executeNative !== "function") throw new Error("native strategy is not available");
    return context.executeNative(strategy.handler, context.args, { signal: context.signal, markDispatched: context.markDispatched });
  }
  throw new Error(`unsupported strategy: ${strategy.using}`);
}

async function runPlaybookOp({ playbook, op, args: providedArgs = {}, attemptId, executeTool, executeNative, signal, sleep, onEvent = () => {}, beforeDispatch = async () => {}, afterDispatch = async () => {} }) {
  const args = resolveArgs(op, providedArgs);
  const attempts = [];
  for (let index = 0; index < op.run.length; index++) {
    const strategy = op.run[index];
    let dispatched = false;
    const markDispatched = async () => {
      if (dispatched) return;
      dispatched = true;
      await beforeDispatch({ strategy, index, args });
    };
    onEvent({ type: "strategy.started", playbook: playbook.id, op: op.id, using: strategy.using, index, startedAt: new Date().toISOString() });
    try {
      const raw = await runStrategy(strategy, {
        args,
        attemptId,
        executeTool,
        executeNative,
        signal,
        sleep,
        onEvent,
        allowedOrigins: op.origins || playbook.origins || [],
        markDispatched: op.effect === "write" ? markDispatched : undefined,
        serverIdempotency: op.effect === "write" ? op.safety?.serverIdempotency : undefined,
      });
      const value = extractResult(raw, strategy.extract);
      verifyResult(value, strategy.verify || strategy.expect || op.on?.success?.expect, raw);
      if (op.effect === "write") await afterDispatch({ status: "verified", strategy, index });
      onEvent({ type: "strategy.completed", playbook: playbook.id, op: op.id, using: strategy.using, index, endedAt: new Date().toISOString() });
      return { status: "completed", playbook: playbook.id, op: op.id, strategy: strategy.using, value, provenance: playbook.provenance, attempts };
    } catch (error) {
      const message = error?.message || String(error);
      attempts.push({ using: strategy.using, error: message });
      onEvent({ type: "strategy.failed", playbook: playbook.id, op: op.id, using: strategy.using, index, error: message, endedAt: new Date().toISOString() });
      if (op.effect === "write") {
        await afterDispatch({ status: dispatched ? "indeterminate" : "not_dispatched", strategy, index, error: message });
        throw error;
      }
    }
  }
  const detail = attempts.map((attempt) => `${attempt.using}: ${attempt.error}`).join("; ");
  throw new Error(`All strategies failed${detail ? ` (${detail})` : ""}`);
}

module.exports = { resolveArgs, runPlaybookOp };
