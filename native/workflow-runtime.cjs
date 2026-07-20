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

function resolveVar(template, vars) {
  if (typeof template !== "string") return template;
  const match = template.match(/^%\{(\w+)\}$/);
  if (match) return vars[match[1]] !== undefined ? vars[match[1]] : template;
  return template.replace(/%\{(\w+)\}/g, (_, name) => {
    const value = vars[name];
    if (value === undefined) return `%{${name}}`;
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  });
}

function substituteVars(value, vars) {
  if (!value || typeof value !== "object") return typeof value === "string" ? resolveVar(value, vars) : value;
  if (Array.isArray(value)) return value.map((item) => substituteVars(item, vars));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substituteVars(item, vars)]));
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

async function executeSingleStep(step, vars, options) {
  const {
    autoWait = true,
    executeTool,
    includeInputValues = false,
    onEvent = () => {},
    signal,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    stepDelay = 100,
  } = options;
  if (typeof executeTool !== "function") throw new Error("workflow runtime requires executeTool");
  const args = substituteVars(step.args || {}, vars);
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
  if (step.repeat !== undefined) {
    let max = resolveVar(step.repeat, vars);
    if (typeof max === "string") max = Number.parseInt(max, 10);
    if (typeof max !== "number" || Number.isNaN(max)) max = 1;
    max = Math.min(max, MAX_LOOP_ITERATIONS);
    if (!Array.isArray(step.steps) || step.steps.length === 0) return { success: false, error: "repeat: steps array required", stepsExecuted: 0 };
    let stepsExecuted = 0;
    for (let index = 0; index < max; index++) {
      const loopVars = { ...vars, _index: index, _iteration: index + 1 };
      for (const nestedStep of step.steps) {
        const result = await executeStep(nestedStep, loopVars, options);
        stepsExecuted += result.stepsExecuted || 1;
        if (!result.success && onError === "stop") return { success: false, error: result.error, stepsExecuted };
      }
      copyCapturedVars(step.steps, loopVars, vars);
      if (step.until) {
        const untilResult = await executeSingleStep(step.until, loopVars, options);
        stepsExecuted++;
        if (untilResult.output) break;
      }
    }
    return { success: true, stepsExecuted };
  }
  if (step.each !== undefined) {
    const items = resolveVar(step.each, vars);
    if (!Array.isArray(items)) return { success: false, error: `each: expected array, got ${typeof items}${items === undefined ? " (undefined)" : ""}`, stepsExecuted: 0 };
    if (!Array.isArray(step.steps) || step.steps.length === 0) return { success: false, error: "each: steps array required", stepsExecuted: 0 };
    const itemVar = step.as || "item";
    let stepsExecuted = 0;
    for (let index = 0; index < Math.min(items.length, MAX_LOOP_ITERATIONS); index++) {
      const loopVars = { ...vars, [itemVar]: items[index], _index: index, _iteration: index + 1 };
      for (const nestedStep of step.steps) {
        const result = await executeStep(nestedStep, loopVars, options);
        stepsExecuted += result.stepsExecuted || 1;
        if (!result.success && onError === "stop") return { success: false, error: result.error, stepsExecuted };
      }
      copyCapturedVars(step.steps, loopVars, vars);
    }
    return { success: true, stepsExecuted };
  }
  return { ...(await executeSingleStep(step, vars, options)), stepsExecuted: 1 };
}

function copyCapturedVars(steps, source, target) {
  for (const step of steps) {
    const isLoop = step.repeat !== undefined || step.each !== undefined;
    if (!isLoop && step.as && source[step.as] !== undefined) target[step.as] = source[step.as];
  }
}

async function executeWorkflow(steps, options = {}) {
  const vars = { ...(options.vars || {}), ...(options.context?.vars || {}) };
  const results = [];
  let failed = 0;
  let stepsExecuted = 0;
  const startTotal = Date.now();
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const startTime = Date.now();
    const type = step.repeat !== undefined || step.each !== undefined ? "loop" : "tool";
    options.onProgress?.({ phase: "start", index, total: steps.length, step, type });
    let result;
    try {
      result = await executeStep(step, vars, options);
    } catch (error) {
      result = { success: false, error: error?.message || String(error), stepsExecuted: 0 };
    }
    const ms = Date.now() - startTime;
    stepsExecuted += type === "loop" ? result.stepsExecuted || 0 : 1;
    if (!result.success) {
      failed++;
      results.push({ step: index + 1, ...(type === "loop" ? { type: "loop" } : { cmd: step.cmd }), status: "error", error: result.error, ms });
      options.onProgress?.({ phase: "fail", index, total: steps.length, step, type, ms, error: result.error });
      if ((options.onError || "stop") === "stop") {
        return { status: "failed", completedSteps: type === "loop" ? stepsExecuted : stepsExecuted - 1, totalSteps: steps.length, results, error: result.error, totalMs: Date.now() - startTotal, vars };
      }
    } else {
      results.push({ step: index + 1, ...(type === "loop" ? { type: "loop", stepsExecuted: result.stepsExecuted } : { cmd: step.cmd }), status: "ok", ms });
      options.onProgress?.({ phase: "ok", index, total: steps.length, step, type, ms, stepsExecuted: result.stepsExecuted });
    }
  }
  return { status: failed > 0 ? "partial" : "completed", completedSteps: stepsExecuted, totalSteps: steps.length, results, failed, totalMs: Date.now() - startTotal, vars };
}

module.exports = {
  AUTO_WAIT_COMMANDS,
  AUTO_WAIT_MAP,
  MAX_LOOP_ITERATIONS,
  executeSingleStep,
  executeStep,
  executeWorkflow,
  extractStepOutput,
  getAutoWaitCommand,
  resolveVar,
  shouldAutoWait,
  substituteVars,
};
