const { Worker } = require("node:worker_threads");

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const WORKER_SOURCE = String.raw`
const { parentPort } = require("node:worker_threads");
const vm = require("node:vm");
const { inspect } = require("node:util");

let nextCallId = 0;
const pending = new Map();
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const fingerprints = new Map();
let contextObjectPrototype;

function stableJson(value) {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableJson(value[key])).join(",") + "}";
  return JSON.stringify(value) ?? "undefined";
}

function assertJsonValue(value, path = "value", seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(path + " must contain only finite JSON numbers.");
    return;
  }
  if (typeof value !== "object") throw new Error(path + " must be a JSON value; received " + typeof value + ".");
  if (seen.has(value)) throw new Error(path + " must not contain cycles.");
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) throw new Error(path + " must not contain sparse array entries.");
      assertJsonValue(value[index], path + "[" + index + "]", seen);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype && prototype !== contextObjectPrototype) throw new Error(path + " must contain only plain JSON objects.");
    if (Object.getOwnPropertySymbols(value).length > 0) throw new Error(path + " must not contain symbol keys.");
    for (const [key, entry] of Object.entries(value)) assertJsonValue(entry, path + "." + key, seen);
  }
  seen.delete(value);
}

function hostCall(method, args) {
  return new Promise((resolve, reject) => {
    const callId = ++nextCallId;
    pending.set(callId, { resolve, reject });
    parentPort.postMessage({ type: "call", callId, method, args });
  });
}

function validateRunCall(key, params, label, nextFingerprints = fingerprints) {
  if (typeof key !== "string" || !keyPattern.test(key)) throw new Error(label + " has an invalid key.");
  if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error(label + " requires a params object.");
  const tool = params.tool ?? params.cmd;
  if (typeof tool !== "string" || !tool) throw new Error(label + " requires a tool string.");
  if (params.args !== undefined && (!params.args || typeof params.args !== "object" || Array.isArray(params.args))) throw new Error(label + " args must be an object.");
  assertJsonValue(params, label + " params");
  const fingerprint = stableJson(params);
  const existing = nextFingerprints.get(key);
  if (existing !== undefined && existing !== fingerprint) throw new Error("Duplicate script key '" + key + "' used with incompatible tool params.");
  nextFingerprints.set(key, fingerprint);
}

const tools = Object.freeze({
  run(key, params) {
    validateRunCall(key, params, "tools.run");
    return hostCall("run", { key, params });
  },
  all(items) {
    if (!Array.isArray(items)) throw new Error("tools.all(items) requires an array.");
    const nextFingerprints = new Map(fingerprints);
    const calls = [];
    for (let index = 0; index < items.length; index++) {
      if (!Object.prototype.hasOwnProperty.call(items, index)) throw new Error("tools.all items must not contain sparse entries.");
      const item = items[index];
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("tools.all item " + index + " must be an object.");
      const { key, ...params } = item;
      validateRunCall(key, params, "tools.all item " + index, nextFingerprints);
      calls.push({ key, params });
    }
    for (const { key, params } of calls) fingerprints.set(key, stableJson(params));
    return Promise.all(calls.map(({ key, params }) => hostCall("run", { key, params, collectFailure: true })));
  },
  ref(result) {
    if (!result || typeof result !== "object") throw new Error("tools.ref(result) requires a tool result object.");
    return "[tool " + (result.key || "unknown") + "]";
  },
  refs(results) {
    if (!Array.isArray(results)) throw new Error("tools.refs(results) requires an array.");
    return results.map(tools.ref).join("\n");
  },
});

const capturedConsole = Object.freeze(Object.fromEntries(
  ["log", "info", "warn", "error"].map((level) => [level, (...args) => {
    parentPort.postMessage({ type: "console", level, text: args.map((value) => typeof value === "string" ? value : inspect(value, { depth: 4, breakLength: 120 })).join(" ") });
  }]),
));

parentPort.on("message", async (message) => {
  if (message.type === "response") {
    const entry = pending.get(message.callId);
    if (!entry) return;
    pending.delete(message.callId);
    if (message.ok) entry.resolve(message.value);
    else entry.reject(new Error(message.error));
    return;
  }
  if (message.type !== "start") return;
  try {
    const sandbox = {
      input: Object.freeze(message.input ?? {}),
      tools,
      surf: tools,
      emit(value) { assertJsonValue(value, "emit"); parentPort.postMessage({ type: "emit", value }); },
      console: capturedConsole,
    };
    const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
    contextObjectPrototype = vm.runInContext("Object.prototype", context);
    const compiled = new vm.Script("(async () => {\n" + message.script + "\n})()", { filename: "surf-workflow-script.js" });
    const value = await compiled.runInContext(context);
    const persistedValue = value === undefined ? null : value;
    assertJsonValue(persistedValue, "return");
    parentPort.postMessage({ type: "complete", value: persistedValue });
  } catch (error) {
    parentPort.postMessage({ type: "error", error: error && error.stack ? error.stack : String(error) });
  }
});
`;

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertJsonValue(value, path = "value", seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} must contain only finite JSON numbers.`);
    return;
  }
  if (typeof value !== "object") throw new Error(`${path} must be a JSON value; received ${typeof value}.`);
  if (seen.has(value)) throw new Error(`${path} must not contain cycles.`);
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) throw new Error(`${path} must not contain sparse array entries.`);
      assertJsonValue(value[index], `${path}[${index}]`, seen);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) throw new Error(`${path} must contain only plain JSON objects.`);
    if (Object.getOwnPropertySymbols(value).length > 0) throw new Error(`${path} must not contain symbol keys.`);
    for (const [key, entry] of Object.entries(value)) assertJsonValue(entry, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function omitUndefined(value, seen = new Set()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  const next = Array.isArray(value)
    ? value.map((entry) => entry === undefined ? null : omitUndefined(entry, seen))
    : Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => entry === undefined ? [] : [[key, omitUndefined(entry, seen)]]));
  seen.delete(value);
  return next;
}

function validateKey(value) {
  if (typeof value !== "string" || !KEY_PATTERN.test(value)) {
    throw new Error("tool key must be 1-128 characters using letters, numbers, '.', '_' or '-', and start with a letter or number.");
  }
  return value;
}

async function runWorkflowScript({ script, input = {}, timeoutMs = 10 * 60 * 1000, signal, executeTool, onEvent = () => {}, onEmit = () => {}, onConsole = () => {} }) {
  if (typeof script !== "string" || !script.trim()) throw new Error("script strategy requires a non-empty script string");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error("script timeoutMs must be a positive integer");
  if (typeof executeTool !== "function") throw new Error("script strategy requires executeTool");
  assertJsonValue(input, "input");

  const worker = new Worker(WORKER_SOURCE, { eval: true });
  const emits = [];
  const consoleEntries = [];
  const trace = [];
  const childController = new AbortController();
  let settled = false;

  return await new Promise((resolve, reject) => {
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      void worker.terminate();
      childController.abort(outcome.error || new Error("Script strategy completed."));
      if (outcome.error) reject(outcome.error);
      else resolve({ value: outcome.value, emits, console: consoleEntries, trace });
    };
    const onAbort = () => finish({ error: new Error(signal.reason instanceof Error ? signal.reason.message : String(signal.reason || "Script strategy aborted")) });
    const timer = setTimeout(() => finish({ error: new Error(`Script strategy timed out after ${timeoutMs}ms.`) }), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) return onAbort();

    const respond = (callId, promise) => {
      void promise.then(
        (value) => {
          try {
            const clean = omitUndefined(value);
            assertJsonValue(clean, "tool result");
            worker.postMessage({ type: "response", callId, ok: true, value: clean });
          } catch (error) {
            worker.postMessage({ type: "response", callId, ok: false, error: error instanceof Error ? error.message : String(error) });
          }
        },
        (error) => worker.postMessage({ type: "response", callId, ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    };

    worker.on("error", (error) => finish({ error: new Error(`Script worker failed: ${error.message}`) }));
    worker.on("exit", (code) => {
      if (!settled && code !== 0) finish({ error: new Error(`Script worker exited with code ${code}.`) });
    });
    worker.on("message", (message) => {
      if (message.type === "emit") {
        try {
          assertJsonValue(message.value, "emit");
          emits.push(message.value);
          onEmit([...emits]);
        } catch (error) {
          finish({ error: new Error(`Script emit could not be persisted: ${error.message}`) });
        }
        return;
      }
      if (message.type === "console") {
        if (["log", "info", "warn", "error"].includes(message.level) && typeof message.text === "string") {
          const entry = { level: message.level, text: message.text };
          consoleEntries.push(entry);
          onConsole(entry);
        }
        return;
      }
      if (message.type === "complete") {
        try {
          assertJsonValue(message.value, "return");
          finish({ value: message.value });
        } catch (error) {
          finish({ error: new Error(`Script return could not be persisted: ${error.message}`) });
        }
        return;
      }
      if (message.type === "error") return finish({ error: new Error(typeof message.error === "string" ? message.error : "Script strategy failed.") });
      if (message.type !== "call" || typeof message.callId !== "number" || message.method !== "run" || !isRecord(message.args)) return;
      let key;
      try {
        key = validateKey(message.args.key);
      } catch (error) {
        return respond(message.callId, Promise.reject(error));
      }
      const params = message.args.params;
      if (!isRecord(params)) return respond(message.callId, Promise.reject(new Error(`tools.run('${key}', params) requires a params object.`)));
      const tool = params.tool ?? params.cmd;
      if (typeof tool !== "string" || !tool) return respond(message.callId, Promise.reject(new Error(`tools.run('${key}') requires a tool string.`)));
      const args = params.args === undefined ? {} : params.args;
      if (!isRecord(args)) return respond(message.callId, Promise.reject(new Error(`tools.run('${key}') args must be an object.`)));
      const collectFailure = message.args.collectFailure === true;
      const startedAt = Date.now();
      trace.push({ key, tool, state: "started" });
      onEvent({ type: "script.tool.started", key, tool, startedAt: new Date().toISOString() });
      respond(message.callId, Promise.resolve().then(async () => {
        try {
          const output = await executeTool(tool, args, { signal: childController.signal });
          const result = { key, tool, ok: true, output };
          trace.push({ key, tool, state: "completed", durationMs: Date.now() - startedAt });
          onEvent({ type: "script.tool.completed", key, tool, endedAt: new Date().toISOString() });
          return result;
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          const result = { key, tool, ok: false, error: text };
          trace.push({ key, tool, state: "failed", durationMs: Date.now() - startedAt, error: text });
          onEvent({ type: "script.tool.failed", key, tool, error: text, endedAt: new Date().toISOString() });
          if (!collectFailure) throw new Error(`Tool '${key}' failed: ${text}`);
          return result;
        }
      }));
    });

    worker.postMessage({ type: "start", script, input });
  });
}

module.exports = { runWorkflowScript };
