const { redactCommandArgs } = require("./workflow-definition.cjs");

const MAX_LOOP_ITERATIONS = 100;
const AUTO_WAIT_COMMANDS = ["go", "navigate", "click", "key", "form.fill", "submit", "tab.switch", "tab.new", "back", "forward"];
const AUTO_WAIT_MAP = {
  navigate: "wait.load",
  go: "wait.load",
  click: "wait.dom",
  key: "wait.dom",
  "form.fill": "wait.dom",
  submit: "wait.load",
  "tab.switch": "wait.load",
  "tab.new": "wait.load",
  back: "wait.load",
  forward: "wait.load",
};

function shouldAutoWait(cmd) {
  return AUTO_WAIT_COMMANDS.some((candidate) => cmd === candidate || cmd.startsWith(`${candidate}.`));
}

function getAutoWaitCommand(cmd) {
  if (AUTO_WAIT_MAP[cmd] !== undefined) return AUTO_WAIT_MAP[cmd];
  for (const [prefix, waitCmd] of Object.entries(AUTO_WAIT_MAP)) {
    if (cmd.startsWith(`${prefix}.`)) return waitCmd;
  }
  return null;
}

function varText(vars, name) {
  const value = vars[name];
  if (value === undefined) return `%{${name}}`;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

// The steps of an op pb save escaped (`escapes`) are read in one pass: `{{name}}` takes the op's
// input (`inputs`), `%{name}` a var, and `{{!}}` and `%{!}` stand for `{{` and `%{` (see
// escapeStepArgs in playbook-template.cjs). One pass, so a value it puts in is never read again:
// an input or var holding `%{!}` or `%{name}` is sent as given. `!` is in no name, so every name
// is filled. surf do and other ops fill only `%{name}` here and send `%{!}` as written.
const ESCAPED_TEXT = /\{\{([a-zA-Z0-9._-]+|!)\}\}|%\{(\w+|!)\}/g;

function resolveVar(template, vars, { escapes = false, inputs = {} } = {}) {
  if (typeof template !== "string") return template;
  const input = escapes && template.match(/^\{\{([a-zA-Z0-9._-]+)\}\}$/);
  if (input) return inputs[input[1]];
  const match = template.match(/^%\{(\w+)\}$/);
  if (match) return vars[match[1]] !== undefined ? vars[match[1]] : template;
  if (!escapes) return template.replace(/%\{(\w+)\}/g, (_, name) => varText(vars, name));
  return template.replace(ESCAPED_TEXT, (_, inputName, varName) => {
    if (inputName === "!") return "{{";
    if (varName === "!") return "%{";
    if (varName !== undefined) return varText(vars, varName);
    if (inputs[inputName] === undefined) throw new Error(`missing template argument: ${inputName}`);
    return String(inputs[inputName]);
  });
}

function substituteVars(value, vars, options) {
  if (!value || typeof value !== "object") return typeof value === "string" ? resolveVar(value, vars, options) : value;
  if (Array.isArray(value)) return value.map((item) => substituteVars(item, vars, options));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substituteVars(item, vars, options)]));
}

function extractStepOutput(response) {
  if (response?.result?.content?.[0]?.text) {
    const text = response.result.content[0].text;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  if (response?.value !== undefined) return response.value;
  if (response?.output !== undefined) {
    try {
      return JSON.parse(response.output);
    } catch {
      return response.output;
    }
  }
  if (response?.result !== undefined) return response.result;
  return response;
}

function abortMessage(signal) {
  if (!signal?.aborted) return null;
  return signal.reason instanceof Error ? signal.reason.message : String(signal.reason || "Workflow aborted");
}

function assertNotAborted(signal) {
  const message = abortMessage(signal);
  if (message) throw new Error(message);
}

const SEMANTIC_SUCCESS_STATUSES = new Set(["completed", "verified", "skipped_already_satisfied"]);

function semanticFailure(result) {
  if (!result || typeof result !== "object") return "semantic executor returned an invalid result";
  if (typeof result.error === "string" && result.error) return result.error;
  if (typeof result.reason === "string" && result.reason) return result.reason;
  return `semantic step did not succeed (status: ${String(result.status || "missing")})`;
}

function semanticDetail(result, step) {
  if (result?.semantic) return result.semantic;
  if (!result || typeof result !== "object") return undefined;
  const detail = {
    ...(result.runId ? { runId: result.runId } : {}),
    ...(step.id ? { stepId: step.id } : {}),
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.write ? { write: result.write } : {}),
    ...(result.coverage ? { coverage: result.coverage } : {}),
    ...(result.checkpoint ? { checkpoint: result.checkpoint } : {}),
    ...(result.usage ? { usage: result.usage } : {}),
    ...(result.limits ? { limits: result.limits } : {}),
  };
  return Object.keys(detail).length ? detail : undefined;
}

async function executeSemanticStep(step, semanticContext, options) {
  const { executeSemanticStep: executor, onEvent = () => {}, signal } = options;
  if (typeof executor !== "function") throw new Error("semantic.step requires an injected semantic executor");
  const startedAt = new Date().toISOString();
  const baseEvent = { command: step.cmd, argsRedacted: redactCommandArgs(step.cmd, step.args || {}, false), startedAt };
  onEvent({ type: "tool.started", ...baseEvent });
  try {
    assertNotAborted(signal);
    const result = await executor(step, semanticContext, { signal });
    assertNotAborted(signal);
    if (!SEMANTIC_SUCCESS_STATUSES.has(result?.status)) {
      const error = semanticFailure(result);
      onEvent({ type: "tool.failed", ...baseEvent, endedAt: new Date().toISOString(), resultSummary: error });
      const semantic = semanticDetail(result, step);
      return { success: false, error, ...(semantic ? { semantic } : {}) };
    }
    const output = result.publicResult;
    const semantic = semanticDetail(result, step);
    onEvent({ type: "tool.completed", ...baseEvent, endedAt: new Date().toISOString(), resultSummary: result.status });
    return { success: true, ...(output !== undefined ? { output } : {}), ...(semantic ? { semantic } : {}) };
  } catch (error) {
    const message = error?.message || String(error);
    onEvent({ type: "tool.failed", ...baseEvent, endedAt: new Date().toISOString(), resultSummary: message });
    return { success: false, error: message };
  }
}

async function executeSingleStep(step, vars, options) {
  const {
    autoWait = true,
    escapes = false,
    executeTool,
    includeInputValues = false,
    inputs,
    onEvent = () => {},
    signal,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    stepDelay = 100,
  } = options;
  if (typeof executeTool !== "function") throw new Error("workflow runtime requires executeTool");
  const args = substituteVars(step.args || {}, vars, { escapes, inputs });
  const startedAt = new Date().toISOString();
  const baseEvent = { command: step.cmd, argsRedacted: redactCommandArgs(step.cmd, args, includeInputValues), startedAt };
  onEvent({ type: "tool.started", ...baseEvent });
  try {
    assertNotAborted(signal);
    const response = await executeTool(step.cmd, args, { signal });
    assertNotAborted(signal);
    if (response?.error) {
      const error = response.error.content?.[0]?.text || (typeof response.error === "string" ? response.error : JSON.stringify(response.error));
      onEvent({ type: "tool.failed", ...baseEvent, endedAt: new Date().toISOString(), resultSummary: error });
      return { success: false, error };
    }
    if (step.as) vars[step.as] = extractStepOutput(response);
    if (autoWait) {
      const waitCmd = getAutoWaitCommand(step.cmd);
      if (waitCmd) {
        const waitArgs = waitCmd === "wait.load" ? { timeout: 10000 } : { stable: 100, timeout: 5000 };
        try {
          await executeTool(waitCmd, waitArgs, { signal });
        } catch {}
      }
    }
    if (stepDelay > 0) {
      assertNotAborted(signal);
      await sleep(stepDelay, signal);
      assertNotAborted(signal);
    }
    onEvent({ type: "tool.completed", ...baseEvent, endedAt: new Date().toISOString(), resultSummary: "success" });
    return { success: true, ...(step.as ? { output: vars[step.as] } : {}) };
  } catch (error) {
    const message = error?.message || String(error);
    onEvent({ type: "tool.failed", ...baseEvent, endedAt: new Date().toISOString(), resultSummary: message });
    return { success: false, error: message };
  }
}

async function executeStep(step, vars, options) {
  const { onError = "stop" } = options;
  assertNotAborted(options.signal);
  if (step.cmd === "semantic.step") {
    const result = await executeSemanticStep(step, options.semanticContext, options);
    if (result.success && step.as && result.output !== undefined) vars[step.as] = result.output;
    return { ...result, stepsExecuted: 1 };
  }
  if (step.repeat !== undefined) {
    let max = resolveVar(step.repeat, vars, { escapes: options.escapes, inputs: options.inputs });
    if (typeof max === "string") max = Number.parseInt(max, 10);
    if (typeof max !== "number" || Number.isNaN(max)) max = 1;
    max = Math.min(max, MAX_LOOP_ITERATIONS);
    if (!Array.isArray(step.steps) || step.steps.length === 0) return { success: false, error: "repeat: steps array required", stepsExecuted: 0 };
    let stepsExecuted = 0;
    for (let index = 0; index < max; index++) {
      const { vars: loopVars, captured } = trackedVars({ ...vars, _index: index, _iteration: index + 1 });
      for (const nestedStep of step.steps) {
        const result = await executeStep(nestedStep, loopVars, options);
        stepsExecuted += result.stepsExecuted || 1;
        if (!result.success && onError === "stop") return { success: false, error: result.error, stepsExecuted };
      }
      copyCapturedVars(step.steps, loopVars, vars, captured);
      if (step.until) {
        const untilResult = await executeSingleStep(step.until, loopVars, options);
        stepsExecuted++;
        if (untilResult.output) break;
      }
    }
    return { success: true, stepsExecuted };
  }
  if (step.each !== undefined) {
    // An escaped op's inline list is read like its args, every string at any depth once; an input
    // or var that is the whole value comes in as is. Any other op's list was filled before the run.
    const fill = options.escapes ? substituteVars : resolveVar;
    const items = fill(step.each, vars, { escapes: options.escapes, inputs: options.inputs });
    if (!Array.isArray(items)) return { success: false, error: `each: expected array, got ${typeof items}${items === undefined ? " (undefined)" : ""}`, stepsExecuted: 0 };
    if (!Array.isArray(step.steps) || step.steps.length === 0) return { success: false, error: "each: steps array required", stepsExecuted: 0 };
    const itemVar = step.as || "item";
    let stepsExecuted = 0;
    for (let index = 0; index < Math.min(items.length, MAX_LOOP_ITERATIONS); index++) {
      const { vars: loopVars, captured } = trackedVars({ ...vars, [itemVar]: items[index], _index: index, _iteration: index + 1 });
      for (const nestedStep of step.steps) {
        const result = await executeStep(nestedStep, loopVars, options);
        stepsExecuted += result.stepsExecuted || 1;
        if (!result.success && onError === "stop") return { success: false, error: result.error, stepsExecuted };
      }
      copyCapturedVars(step.steps, loopVars, vars, captured);
    }
    return { success: true, stepsExecuted };
  }
  return { ...(await executeSingleStep(step, vars, options)), stepsExecuted: 1 };
}

// Variables that record the names a step sets, so an input never passes for a capture.
function trackedVars(initial) {
  const captured = new Set();
  const vars = new Proxy(initial, {
    set(target, name, value) {
      captured.add(name);
      target[name] = value;
      return true;
    },
  });
  return { vars, captured };
}

// Copies out of a loop's variables only what its steps captured this iteration, never an input
// a failed step left under its capture name.
function copyCapturedVars(steps, source, target, captured) {
  for (const step of steps) {
    const isLoop = step.repeat !== undefined || step.each !== undefined;
    if (!isLoop && step.as && captured.has(step.as) && source[step.as] !== undefined) target[step.as] = source[step.as];
  }
}

// A workflow returns what its steps captured with `as` (a loop's direct steps included, as
// copyCapturedVars copies them out), never the inputs it ran with: those stay private to the run.
// `captured` names the variables a step set, so a capture equal to a same-named input still counts.
function capturedOutputs(steps, vars, captured) {
  const names = steps.flatMap((step) => {
    if (step.repeat === undefined && step.each === undefined) return step.as ? [step.as] : [];
    return (step.steps || []).filter((child) => child.repeat === undefined && child.each === undefined && child.as).map((child) => child.as);
  });
  const outputs = {};
  for (const name of names) {
    if (captured.has(name) && vars[name] !== undefined) outputs[name] = vars[name];
  }
  return Object.keys(outputs).length > 0 ? { vars: outputs } : {};
}

async function executeWorkflow(steps, options = {}) {
  const semanticEnabled = steps.some((step) => step.cmd === "semantic.step");
  if (semanticEnabled && (options.onError || "stop") !== "stop") {
    return { status: "failed", completedSteps: 0, totalSteps: steps.length, results: [], error: "semantic workflows require onError='stop'", totalMs: 0 };
  }
  const { vars, captured } = trackedVars({ ...(options.vars || {}), ...(options.context?.vars || {}) });
  const semanticContext = semanticEnabled ? (options.createSemanticContext?.() || Object.create(null)) : undefined;
  const executionOptions = semanticEnabled ? { ...options, semanticContext } : options;
  const results = [];
  let failed = 0;
  let semantic;
  let stepsExecuted = 0;
  const startTotal = Date.now();
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const startTime = Date.now();
    const type = step.repeat !== undefined || step.each !== undefined ? "loop" : "tool";
    options.onProgress?.({ phase: "start", index, total: steps.length, step, type });
    let result;
    try {
      result = await executeStep(step, vars, executionOptions);
    } catch (error) {
      result = { success: false, error: error?.message || String(error), stepsExecuted: 0 };
    }
    const ms = Date.now() - startTime;
    if (result.semantic) semantic = result.semantic;
    stepsExecuted += type === "loop" ? result.stepsExecuted || 0 : 1;
    if (!result.success) {
      failed++;
      results.push({ step: index + 1, ...(type === "loop" ? { type: "loop" } : { cmd: step.cmd }), status: "error", error: result.error, ...(result.semantic ? { semantic: result.semantic } : {}), ms });
      options.onProgress?.({ phase: "fail", index, total: steps.length, step, type, ms, error: result.error });
      if ((options.onError || "stop") === "stop") {
        return { status: "failed", completedSteps: type === "loop" ? stepsExecuted : stepsExecuted - 1, totalSteps: steps.length, results, error: result.error, ...(semantic ? { semantic } : {}), totalMs: Date.now() - startTotal, ...capturedOutputs(steps, vars, captured) };
      }
    } else {
      results.push({ step: index + 1, ...(type === "loop" ? { type: "loop", stepsExecuted: result.stepsExecuted } : { cmd: step.cmd }), status: "ok", ...(result.semantic ? { semantic: result.semantic } : {}), ms });
      options.onProgress?.({ phase: "ok", index, total: steps.length, step, type, ms, stepsExecuted: result.stepsExecuted });
    }
  }
  return { status: failed > 0 ? "partial" : "completed", completedSteps: stepsExecuted, totalSteps: steps.length, results, failed, ...(semantic ? { semantic } : {}), totalMs: Date.now() - startTotal, ...capturedOutputs(steps, vars, captured) };
}

module.exports = {
  AUTO_WAIT_COMMANDS,
  AUTO_WAIT_MAP,
  MAX_LOOP_ITERATIONS,
  executeSingleStep,
  executeSemanticStep,
  executeStep,
  executeWorkflow,
  extractStepOutput,
  getAutoWaitCommand,
  resolveVar,
  shouldAutoWait,
  substituteVars,
};
