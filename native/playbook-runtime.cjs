const fs = require("fs");
const path = require("path");
const { executeSingleStep, executeWorkflow, substituteVars } = require("./workflow-runtime.cjs");
const { runWorkflowScript } = require("./workflow-script-runtime.cjs");
const { runApiHarvest, watchCapture } = require("./api-harvest.cjs");
const { htmlExtractFunction, runCollect } = require("./dom-collect.cjs");
const { editDistance } = require("./edit-distance.cjs");
const { GLOBAL_OPTIONS } = require("./global-options.cjs");
const { LITERAL_OPEN, escapedOp, renderRequest, resolveArgValues, sentRequest } = require("./playbook-template.cjs");
const { findRedactedPlaceholder, placeholderError } = require("./record-typed-values.cjs");
const { checkAssertions, createRegexBudget } = require("./playbook-assertions.cjs");
const { redactJson, redactResult, redactSecretValues, spanningValues } = require("./redaction.cjs");
const boundedRegex = require("./bounded-regex.cjs");
const { extractRecords } = require("./records.cjs");

// Fills an op's inputs into a hand-written op's workflow steps, and into an api or collect
// strategy's spec. With `escapes` (an op pb save escaped, see escapedOp), `{{!}}` is sent as `{{`;
// any other op sends it as written. An escaped op's steps are filled by fillEscapedSteps and the
// workflow runtime.
function applyTemplate(value, args, { escapes = false } = {}) {
  if (typeof value === "string") {
    const exact = value.match(/^\{\{([a-zA-Z0-9._-]+)\}\}$/);
    if (exact) return args[exact[1]];
    return value.replace(escapes ? /\{\{([a-zA-Z0-9._-]+|!)\}\}/g : /\{\{([a-zA-Z0-9._-]+)\}\}/g, (match, name) => {
      if (match === LITERAL_OPEN) return "{{";
      if (args[name] === undefined) throw new Error(`missing template argument: ${name}`);
      return String(args[name]);
    });
  }
  if (Array.isArray(value)) return value.map((item) => applyTemplate(item, args, { escapes }));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, applyTemplate(item, args, { escapes })]));
  return value;
}

// An escaped op's step fields the workflow runtime doesn't read, such as cmd, as and id (and a
// semantic step's args), take their inputs here, as applyTemplate gives any other op's. Its args,
// each and repeat, and until's args, are left as stored: the runtime fills their inputs and vars
// in the pass that decodes them (resolveVar). So each stored string is read once.
const RUNTIME_FILLED = new Set(["args", "each", "repeat"]);

function fillEscapedSteps(steps, args) {
  if (!Array.isArray(steps)) return steps;
  return steps.map((step) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) return step;
    const filled = {};
    for (const [key, value] of Object.entries(step)) {
      if (key === "steps") filled.steps = fillEscapedSteps(value, args);
      else if (key === "until") filled.until = fillEscapedSteps([value], args)[0];
      else if (!RUNTIME_FILLED.has(key)) filled[key] = applyTemplate(value, args, { escapes: true });
    }
    for (const key of RUNTIME_FILLED) {
      if (!Object.hasOwn(step, key)) continue;
      const semanticArgs = key === "args" && filled.cmd === "semantic.step";
      filled[key] = semanticArgs ? applyTemplate(step.args, args, { escapes: true }) : step[key];
    }
    return filled;
  });
}

// A failure of a check the op's file wrote (its extract, verify, expect or on.success.expect),
// which ends an op saved from a record: a draft can't use one to reach its next strategy.
const CHECK_FAILED = Symbol("check failed");

function checkFailure(cause) {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  error[CHECK_FAILED] = true;
  return error;
}

function unknownInputError(op, name, playbookId) {
  const specs = Object.entries(op.args || {});
  const label = playbookId ? `${playbookId} ${op.id}` : op.id;
  if (specs.length === 0) return new Error(`Unknown input --${name} for ${label}. It takes no inputs`);
  const closest = specs
    .map(([input]) => ({ input, distance: editDistance(name, input) }))
    .filter(({ input, distance }) => distance <= Math.max(1, Math.floor(Math.max(name.length, input.length) / 3)))
    .sort((a, b) => a.distance - b.distance)[0];
  const hint = closest ? ` Did you mean --${closest.input}?` : "";
  const inputs = specs.map(([input, spec]) => `--${input}${spec.required ? " (required)" : ""}`).join(", ");
  return new Error(`Unknown input --${name} for ${label}.${hint} Its inputs: ${inputs}`);
}

// Surf's global flags, and `surf use --timeout` (the run's deadline), aren't op inputs: an op gets
// one only when it declares that name.
const SURF_FLAGS = new Set([...GLOBAL_OPTIONS.map((option) => option.name), "timeout"]);

function resolveArgs(op, provided, { playbookId } = {}) {
  const args = { ...provided };
  for (const name of Object.keys(args)) {
    if (Object.hasOwn(op.args || {}, name)) continue;
    if (!SURF_FLAGS.has(name)) throw unknownInputError(op, name, playbookId);
    delete args[name];
  }
  return resolveArgValues(op.args, args);
}

// Env-supplied headers (`request.authInputs`) of an op's network strategies.
function authInputs(op) {
  return op.run.filter((strategy) => strategy.using === "network").flatMap((strategy) => strategy.request?.authInputs || []);
}

// Values for env-supplied headers: the caller's (`surf use` reads its own shell), else the host's
// environment. A missing required one stops the run before any strategy starts.
function resolveAuthValues(op, secrets = {}, env = process.env) {
  const values = {};
  for (const input of authInputs(op)) {
    const value = secrets[input.env] ?? env[input.env];
    if (value) values[input.env] = String(value);
    else if (input.required !== false) {
      throw new Error(`environment variable ${input.env} is not set; the ${input.header} header of ${op.id} reads it`);
    }
  }
  return values;
}

// Env-supplied values never leave a run: a response that echoes one in a value (or an error that
// quotes it) comes back with <redacted> in its place, however short the value and however JSON
// escapes it. A key is a field's name and changes only when it holds a value of 4 characters or
// more (redaction.cjs's redactJson and redactObject).
function redactSecrets(value, secrets) {
  const values = Object.values(secrets);
  return values.length === 0 ? value : redactJson(value, values);
}

// The free text of a strategy's event (an error, a step's result) without the run's env values.
// Its other fields and the step's arguments are surf's own data, which no env value reaches, and
// stay as written, so a short value such as `a` can't rewrite them.
const EVENT_TEXT_FIELDS = ["resultSummary", "error", "reason"];
function redactEventText(event, secrets) {
  const values = Object.values(secrets);
  if (values.length === 0) return event;
  const redacted = { ...event };
  for (const field of EVENT_TEXT_FIELDS) {
    if (typeof redacted[field] === "string") redacted[field] = redactSecretValues(redacted[field], values, { anyLength: true });
  }
  return redacted;
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

function extractResult(result, extract, regexBudget) {
  if (!extract) return result;
  // The tab ran the extract and sent back only what it found.
  if (result && typeof result === "object" && Object.hasOwn(result, "extracted")) return result.extracted;
  if (extract.records !== undefined || extract.fields || extract.filter) {
    return extractRecords(result.bodyJson !== undefined ? result.bodyJson : result, extract, { regexBudget });
  }
  if (extract.jsonPath) {
    const source = result.bodyJson !== undefined ? result.bodyJson : result;
    return getJsonPath(source, extract.jsonPath);
  }
  if (extract.field) return result[extract.field];
  return result;
}

/**
 * Throws on the first failed check; returns the assertion results (expect.assert), if any. The
 * results are redacted against `secrets`. A failure's message goes to the journal and receipts, so
 * it names the assertion's path and op only, never a value: the error's `assertions` hold the rest,
 * which `surf pb test <label>` (the playbook and op) shows.
 */
function verifyResult(value, expect = {}, raw = value, secrets = [], budget = undefined, label) {
  if (expect.status !== undefined && raw?.status !== expect.status) throw new Error(`expected status ${expect.status}`);
  if (expect.minItems !== undefined && (!Array.isArray(value) || value.length < expect.minItems)) throw new Error(`expected at least ${expect.minItems} items`);
  if (expect.truthy && !value) throw new Error("expected a truthy result");
  if (!expect.assert) return undefined;
  const results = checkAssertions(value, expect.assert, secrets, budget);
  const failed = results.find((result) => !result.pass);
  if (failed) {
    const error = new Error(`assertion failed: ${failed.path} ${failed.op}${failed.error ? ` (${failed.error})` : ""}; run surf pb test ${label} to see the value`);
    error.assertions = results;
    throw error;
  }
  return results;
}

/** The op's strategies, or only those using `forced` (pb test --strategy). */
function strategiesToRun(op, forced) {
  if (forced === undefined) return op.run;
  const run = op.run.filter((strategy) => strategy.using === forced);
  if (run.length === 0) throw new Error(`op ${op.id} has no ${forced} strategy (it has ${op.run.map((strategy) => strategy.using).join(", ")})`);
  return run;
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

// What a network strategy sends: its inputs filled, its env headers set and a write's server
// idempotency key added.
function renderNetworkRequest(strategy, { args, authValues, escapes, serverIdempotency, attemptId }) {
  const inputs = strategy.request.authInputs || [];
  const rendered = renderRequest(sentRequest(strategy.request), args, { escapes });
  for (const input of inputs) {
    const value = authValues?.[input.env];
    if (value) rendered.headers = { ...rendered.headers, [input.header]: value };
  }
  // Keep a response to a request carrying an env value out of the browser's disk cache.
  if (inputs.length > 0) rendered.cache = "no-store";
  return withServerIdempotency(rendered, serverIdempotency, attemptId);
}

// surf use --dry-run: what the op's first strategy would do, with nothing sent. Env header values
// are <redacted> before rendering, and only header names are listed. A placeholder the record left
// prints as stored, with the refusal the run would give.
function previewPlaybookOp({ playbook, op, args: providedArgs = {}, secrets = {}, env = process.env, strategy: forced }) {
  const args = resolveArgs(op, providedArgs, { playbookId: playbook.id });
  const authValues = Object.fromEntries(Object.keys(resolveAuthValues(op, secrets, env)).map((name) => [name, "<redacted>"]));
  const strategy = strategiesToRun(op, forced)[0];
  const escapes = escapedOp(op);
  const preview = { playbook: playbook.id, op: op.id, effect: op.effect, strategy: strategy.using };
  const allowedOrigins = op.origins || playbook.origins || [];
  if (strategy.using === "workflow") {
    const steps = escapes ? fillEscapedSteps(strategy.steps, args) : applyTemplate(strategy.steps, args);
    return { ...preview, step: steps[0], allowedOrigins };
  }
  if (strategy.using !== "network") return { ...preview, allowedOrigins };
  const placeholder = findRedactedPlaceholder(sentRequest(strategy.request));
  const serverIdempotency = op.effect === "write" ? op.safety?.serverIdempotency : undefined;
  const request = renderNetworkRequest(strategy, { args, authValues, escapes, serverIdempotency, attemptId: "<attempt-id>" });
  return {
    ...preview,
    method: String(request.method || "GET").toUpperCase(),
    url: request.url,
    ...(request.query && Object.keys(request.query).length > 0 ? { query: request.query } : {}),
    headers: Object.keys(request.headers || {}),
    ...(request.body !== undefined ? { body: request.body } : {}),
    allowedOrigins,
    ...(placeholder ? { refused: placeholderError(placeholder, `${playbook.id} ${op.id}`).message } : {}),
  };
}

// The tab's script output is pretty-printed JSON cut at 50,000 characters
// (src/service-worker/index.ts), so an extract runs in the tab and only its result comes back.
const TAB_OUTPUT_LIMIT = 50000;
// records.cjs runs in the tab as a module; its node:util import serves only api record sets, and
// bounded-regex.cjs runs its field match patterns.
const RECORDS_SOURCE = fs.readFileSync(path.join(__dirname, "records.cjs"), "utf8");

function isJsonExtract(extract) {
  return Boolean(extract && (extract.jsonPath || extract.records !== undefined || extract.fields || extract.filter));
}

// An HTML or JSON extract runs in the tab and returns only its result; any other op takes the
// whole body, which comes from network capture.
function extractsInTab(extract) {
  return Boolean(extract?.html) || isJsonExtract(extract);
}

// Page-side finish(head, { read, extract }, narrow): runs an extract through boundedRegex.tabExtract and
// resolves to its result, or an extractError when it fails or would not fit in the tab's output.
// It can also resolve to regexNeeded (see bounded-regex.cjs), which runTabExtract completes.
// `regexBudget` is what is left of the op run's field-regex budget.
const finishSource = (budget) => `${boundedRegex.tabSource()}
${boundedRegex.tabBudgetSource(budget)}
const finish = (head, { read, extract }, narrow) => boundedRegex.tabExtract({
  budget: regexBudget,
  read,
  extract,
  onValue: (extracted) => {
    const out = { ...head, extracted: extracted === undefined ? null : extracted };
    if (JSON.stringify(out, null, 2).length <= boundedRegex.RESULT_LIMIT) return out;
    return { ...head, extractError: \`extracted result is \${JSON.stringify(extracted, null, 2).length} characters; narrow \${narrow}\` };
  },
  onError: (error) => ({ ...head, extractError: error.message }),
});`;

/**
 * Runs the tab script `script(budget)` makes, which may end in finish(), charging the op run's
 * field-regex budget and completing an extract the tab handed over.
 */
async function runTabExtract(context, script, { onAnswered = () => {} } = {}) {
  const { regexSpentMs: _spent, ...result } = await boundedRegex.runTabScript({
    budget: context.fieldRegexBudget,
    script,
    now: context.now,
    // An error object is redacted before it becomes text: as JSON, a value inside it is escaped.
    execute: async (code) => {
      const response = await context.executeTool("javascript_tool", { code }, { signal: context.signal });
      if (response?.error && typeof response.error === "object") return { ...response, error: redactSecrets(response.error, context.authValues || {}) };
      if (!response?.error) onAnswered();
      return response;
    },
    unreadable: (size) => new Error(`the tab's output could not be read (${size} characters; the tab cuts it at ${TAB_OUTPUT_LIMIT})`),
  });
  return result;
}

function jsonExtractSource(extract) {
  if (extract.jsonPath) return `${getJsonPath.toString()}\nreturn getJsonPath(json, ${JSON.stringify(extract.jsonPath)});`;
  const { records, fields, filter } = extract;
  return `const module = { exports: {} };
const require = (name) => name === "./bounded-regex.cjs" ? boundedRegex : { isDeepStrictEqual: () => { throw new Error("isDeepStrictEqual is not available in the tab"); } };
(function (module, exports, require) {
${RECORDS_SOURCE}
})(module, module.exports, require);
return module.exports.extractRecords(json, ${JSON.stringify({ records, fields, filter })});`;
}

function networkScript(request, allowedOrigins = [], extract, regexBudget = boundedRegex.createFieldRegexBudget()) {
  const html = extract?.html;
  const headers = request.headers || {};
  const query = request.query || {};
  const body = request.body;
  let tail;
  if (html) {
    // Preparing the page is part of the extract: its failure (a <base href> no URL can be made of)
    // comes back as the extract's, like one finish() catches.
    tail = `${finishSource(regexBudget)}
let prepared;
try {
  const doc = new DOMParser().parseFromString(text, "text/html");
  // Relative links resolve against the response URL, not the tab's page.
  const responseUrl = response.url || url.toString();
  const base = doc.querySelector("base[href]");
  if (base) base.setAttribute("href", new URL(base.getAttribute("href"), responseUrl).href);
  else {
    const element = doc.createElement("base");
    element.setAttribute("href", responseUrl);
    doc.head.prepend(element);
  }
  prepared = ${htmlExtractFunction(html)}(doc);
} catch (error) {
  return { ...head, extractError: \`the response couldn't be prepared for its extract: \${error.message}\` };
}
return finish(head, prepared, "--item/--field");`;
  } else if (isJsonExtract(extract)) {
    tail = `${finishSource(regexBudget)}
return finish(head, {
  read: () => {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(\`the response is not JSON (\${response.headers.get("content-type") || "no content type"})\`);
    }
  },
  extract: (json) => {
    ${jsonExtractSource(extract)}
  },
}, "--records/--field");`;
  }
  // The script's output is capped, so without an in-tab extract it reports the response and when it
  // was sent, and the body is read from network capture.
  const read = tail === undefined
    ? `await response.arrayBuffer();
return { status: response.status, ok: response.ok, requestUrl: url.toString(), url: response.url, redirected: response.redirected, headers: Object.fromEntries(response.headers.entries()), sentAt, doneAt: Date.now() };`
    : `const text = await response.text();
const head = { status: response.status, ok: response.ok, url: response.url, headers: Object.fromEntries(response.headers.entries()) };
${tail}`;
  return `(async () => {
const url = new URL(${JSON.stringify(request.url)}, location.href);
const allowedOrigins = ${JSON.stringify(allowedOrigins)};
if (allowedOrigins.length > 0 && !allowedOrigins.includes(url.origin)) {
  throw new Error(\`playbook network origin is not allowed: \${url.origin}\`);
}
for (const [key, value] of Object.entries(${JSON.stringify(query)})) {
  if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
}
const sentAt = Date.now();
const response = await fetch(url.toString(), {
  method: ${JSON.stringify(request.method || "GET")},
  credentials: "include",
  ${request.cache ? `cache: ${JSON.stringify(request.cache)},` : ""}
  headers: ${JSON.stringify(headers)},
  ${body === undefined ? "" : `body: ${JSON.stringify(typeof body === "string" ? body : JSON.stringify(body))},`}
});
${read}
})()`;
}

// Refuses a request to an origin the op doesn't allow before anything is sent. A relative URL is
// resolved against the tab's page, read first; the tab checks again when it sends.
async function assertAllowedOrigin(url, { allowedOrigins = [], executeTool, signal }) {
  if (allowedOrigins.length === 0) return;
  let resolved;
  try {
    resolved = new URL(url);
  } catch {
    const page = await executeTool("javascript_tool", { code: "location.href" }, { signal });
    if (page?.error) throw new Error(typeof page.error === "string" ? page.error : JSON.stringify(page.error));
    resolved = new URL(url, page?.output !== undefined ? JSON.parse(page.output) : page?.value);
  }
  if (!allowedOrigins.includes(resolved.origin)) throw new Error(`playbook network origin is not allowed: ${resolved.origin}`);
}

async function runStrategy(strategy, context) {
  if (strategy.using === "script") {
    if (context.allowScript !== true) throw new Error("script strategy requires --allow-script");
    const vars = { ...context.args };
    const result = await runWorkflowScript({
      script: strategy.script,
      input: context.args,
      timeoutMs: strategy.timeoutMs ?? 10 * 60 * 1000,
      signal: context.signal,
      onEvent: context.onEvent,
      executeTool: async (tool, args, options = {}) => {
        await context.markDispatched?.();
        const step = await executeSingleStep({ cmd: tool, args, as: "value" }, vars, {
          autoWait: strategy.autoWait !== false,
          executeTool: context.executeTool,
          onEvent: context.onEvent,
          signal: options.signal || context.signal,
          sleep: context.sleep,
          stepDelay: strategy.stepDelay ?? 100,
        });
        if (!step.success) throw new Error(step.error || `tool ${tool} failed`);
        return step.output;
      },
    });
    return result.value;
  }
  if (strategy.using === "workflow") {
    // An escaped op's steps go to the workflow runtime as stored: it decodes their text and fills
    // inputs in the same pass (resolveVar), as renderRequest does a request, so it never reads an
    // input's value. This first pass only checks that every input they embed is set, before any
    // step runs; fillEscapedSteps fills the fields the runtime doesn't. Any other op gets its
    // inputs first, then its workflow vars, as on main.
    if (context.escapes) substituteVars(strategy.steps, {}, { escapes: true, inputs: context.args });
    const steps = context.escapes ? fillEscapedSteps(strategy.steps, context.args) : applyTemplate(strategy.steps, context.args);
    const result = await executeWorkflow(steps, {
      autoWait: strategy.autoWait !== false,
      escapes: context.escapes,
      inputs: context.args,
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
    if (!strategy.extract?.html) return result;
    // The same extraction as the network strategy, on the page the workflow ended on.
    let found;
    try {
      found = await runTabExtract(context, (budget) => `(async () => {\n${finishSource(budget)}\nreturn finish({}, ${htmlExtractFunction(strategy.extract.html)}(document), "--item/--field");\n})()`);
    } catch (error) {
      throw checkFailure(error);
    }
    if (found?.extractError) throw checkFailure(found.extractError);
    return { ...result, extracted: found?.extracted };
  }
  if (strategy.using === "network") {
    // A draft's request can hold <text> where the record redacted a typed value: never send it.
    const placeholder = findRedactedPlaceholder(sentRequest(strategy.request));
    if (placeholder) throw placeholderError(placeholder, context.label);
    const request = renderNetworkRequest(strategy, context);
    await assertAllowedOrigin(request.url, context);
    // Without an in-tab extract the body comes from network capture: turn it on before sending.
    const inTab = extractsInTab(strategy.extract);
    const capture = inTab ? undefined : await watchCapture({ executeTool: context.executeTool, sleep: context.sleep });
    await context.markDispatched?.();
    // An in-tab extract may need a second script (its patterns) once the request is answered; what
    // fails then is the extract.
    let answered = false;
    let tab;
    try {
      tab = await runTabExtract(context, (budget) => networkScript(request, context.allowedOrigins, strategy.extract, budget), { onAnswered: () => { answered = true; } });
    } catch (error) {
      throw inTab && answered ? checkFailure(error) : error;
    }
    const { requestUrl, sentAt, doneAt, redirected, ...result } = tab;
    if (!result?.ok && (strategy.acceptStatus || []).includes(result?.status) === false) throw new Error(`network strategy returned ${result?.status || "an unknown status"}`);
    if (result.extractError) throw checkFailure(result.extractError);
    if (inTab) return result;
    const body = await capture.read({ ...result, method: String(request.method || "GET").toUpperCase(), requestUrl, redirected, sentAt, doneAt });
    let bodyJson;
    try {
      bodyJson = JSON.parse(body);
    } catch {}
    return { ...result, body, bodyJson };
  }
  if (strategy.using === "native") {
    if (typeof context.executeNative !== "function") throw new Error("native strategy is not available");
    return context.executeNative(strategy.handler, context.args, { signal: context.signal, markDispatched: context.markDispatched });
  }
  if (strategy.using === "api" || strategy.using === "collect") {
    const { using, extract: _extract, expect: _expect, verify: _verify, ...spec } = strategy;
    // Field templates ({{author}}) name record fields, not op args, so they stay as written.
    if (using === "api") {
      const { fields, ...records } = spec.records;
      const templated = applyTemplate({ ...spec, records }, context.args, { escapes: context.escapes });
      return runApiHarvest({
        spec: { ...templated, records: { ...templated.records, fields } },
        executeTool: context.executeTool,
        sleep: context.sleep,
        onEvent: context.onEvent,
        origins: context.allowedOrigins,
        regexBudget: context.fieldRegexBudget,
      });
    }
    const { fields, key, ...rest } = spec;
    return runCollect({ spec: { ...applyTemplate(rest, context.args, { escapes: context.escapes }), fields, key }, executeTool: context.executeTool, sleep: context.sleep, regexBudget: context.fieldRegexBudget, now: context.now });
  }
  throw new Error(`unsupported strategy: ${strategy.using}`);
}

// `assertions` replaces the op's saved on.success.expect.assert for this run (pb test --assert).
// `strategy` runs only the strategies of that kind (pb test --strategy). `now` is the host's clock
// for timing the tab's pattern calls.
async function runPlaybookOp({ playbook, op, args: providedArgs = {}, secrets = {}, env = process.env, attemptId, executeTool, executeNative, signal, sleep, now = () => performance.now(), onEvent = () => {}, beforeDispatch = async () => {}, afterDispatch = async () => {}, allowScript = false, assertions, strategy: forced }) {
  const args = resolveArgs(op, providedArgs, { playbookId: playbook.id });
  const authValues = resolveAuthValues(op, secrets, env);
  const run = strategiesToRun(op, forced);
  const assert = assertions ?? op.on?.success?.expect?.assert;
  // One regex budget for the whole run, shared by every strategy's assertion checks, and one for
  // field match patterns, shared by every strategy, collect round and API page.
  const regexBudget = createRegexBudget();
  const fieldRegexBudget = boundedRegex.createFieldRegexBudget();
  // A strategy's own events (a workflow step's tool.failed) are journaled: no env value goes with them.
  const reportStep = (event) => onEvent(redactEventText(event, authValues));
  const attempts = [];
  // In an op saved from a record, a failed check its file wrote is the op's, so a draft's check
  // never sends more. A read still tries its next strategy (the recorded steps) when its request
  // fails as the runtime sees it: never answered, or answered with a status that isn't ok. A write
  // stops at any failure.
  const fromRecord = op.provenance?.recordId !== undefined;
  const escapes = escapedOp(op);
  for (let index = 0; index < run.length; index++) {
    const strategy = run[index];
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
        onEvent: reportStep,
        label: `${playbook.id} ${op.id}`,
        allowedOrigins: op.origins || playbook.origins || [],
        authValues,
        fieldRegexBudget,
        now,
        markDispatched: op.effect === "write" ? markDispatched : undefined,
        escapes,
        serverIdempotency: op.effect === "write" ? op.safety?.serverIdempotency : undefined,
        allowScript,
      });
      let value;
      let checked;
      try {
        value = extractResult(raw, strategy.extract, fieldRegexBudget);
        const expect = strategy.verify || strategy.expect || op.on?.success?.expect;
        // Saved assertions hold for every strategy, even one with its own verify.
        checked = verifyResult(value, assert ? { ...expect, assert } : expect, raw, Object.values(authValues), regexBudget, `${playbook.id} ${op.id}`);
      } catch (error) {
        throw checkFailure(error);
      }
      if (op.effect === "write") await afterDispatch({ status: "verified", strategy, index });
      onEvent({ type: "strategy.completed", playbook: playbook.id, op: op.id, using: strategy.using, index, endedAt: new Date().toISOString() });
      // Its parts are redacted one by one; redactResult reads them next to surf's own fields.
      return redactResult({ status: "completed", playbook: playbook.id, op: op.id, strategy: strategy.using, value: redactSecrets(value, authValues), provenance: playbook.provenance, attempts, ...(checked ? { assertions: checked } : {}) }, Object.values(authValues));
    } catch (caught) {
      const message = redactSecrets(caught?.message || String(caught), authValues);
      const error = message === caught?.message ? caught : new Error(message);
      // checkAssertions redacted the assertions (an `actual` is a value from the response).
      const checks = caught?.assertions;
      attempts.push({ using: strategy.using, error: message, ...(checks ? { assertions: checks } : {}) });
      onEvent({ type: "strategy.failed", playbook: playbook.id, op: op.id, using: strategy.using, index, error: message, endedAt: new Date().toISOString() });
      if (op.effect === "write") {
        await afterDispatch({ status: dispatched ? "indeterminate" : "not_dispatched", strategy, index, error: message });
        // pb test reports the attempt (its assertions already redacted); the message stays short.
        error.attempts = attempts;
        throw error;
      }
      if (fromRecord && caught?.[CHECK_FAILED]) {
        const answered = strategy.using === "network" ? "its request was answered" : "it ran";
        const final = new Error(`${strategy.using} strategy failed after ${answered}: ${message}; an op saved from a record doesn't try its next strategy when a check fails`);
        final.attempts = attempts;
        throw final;
      }
    }
  }
  const detail = attempts.map((attempt) => `${attempt.using}: ${attempt.error}`).join("; ");
  // Each attempt's error is redacted; a value that can span them and surf's words is looked for in
  // the whole line, and surf's words stay as written for any other.
  const summary = `All strategies failed${detail ? ` (${detail})` : ""}`;
  const spanning = spanningValues(Object.values(authValues));
  const error = new Error(spanning.length === 0 ? summary : redactJson(summary, spanning));
  error.attempts = attempts;
  throw error;
}

/** pb test: a failed run comes back as a result, with each attempt's error and assertions. */
async function testPlaybookOp(options) {
  const { playbook, op } = options;
  try {
    return await runPlaybookOp(options);
  } catch (error) {
    const values = authInputs(op).map((input) => options.secrets?.[input.env] ?? (options.env ?? process.env)[input.env]).filter(Boolean);
    return redactResult({ status: "failed", playbook: playbook.id, op: op.id, error: error.message, attempts: error.attempts || [] }, values);
  }
}

module.exports = { authInputs, previewPlaybookOp, resolveArgs, runPlaybookOp, testPlaybookOp };
