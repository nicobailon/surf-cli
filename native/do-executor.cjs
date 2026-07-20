const { openClientTransport } = require("./client-transport.cjs");
const { selectEndpoint } = require("./endpoint.cjs");
const { prepareRemoteTool, validateLocalToolPaths } = require("./file-transfer.cjs");
const { resolveRequestDeadlineMs } = require("./host-sessions.cjs");
const runtime = require("./workflow-runtime.cjs");

function sendDoRequest(toolName, toolArgs, context = {}) {
  const request = {
    type: "tool_request",
    method: "execute_tool",
    params: { tool: toolName, args: toolArgs },
    id: `do-${Date.now()}-${Math.random()}`,
  };
  if (context.tabId) request.tabId = context.tabId;
  if (context.windowId) request.windowId = context.windowId;
  const timeoutMs = context.timeoutMs || resolveRequestDeadlineMs(toolName, toolArgs);
  const endpoint = context.endpoint || selectEndpoint([]).endpoint;
  const prepared = endpoint.kind === "remote"
    ? prepareRemoteTool(toolName, toolArgs)
    : { args: validateLocalToolPaths(toolName, toolArgs), uploads: [], downloads: [] };
  request.params.args = prepared.args;
  if (context.transport) return context.transport.request(request, timeoutMs, prepared);
  return (async () => {
    const transport = await openClientTransport(endpoint);
    try {
      return await transport.request(request, timeoutMs, prepared);
    } finally {
      await transport.close();
    }
  })();
}

function summarizeArgs(step) {
  return Object.entries(step.args || {})
    .map(([key, value]) => typeof value === "string" && value.length > 40 ? `${key}="${value.slice(0, 37)}..."` : `${key}=${JSON.stringify(value)}`)
    .join(" ");
}

function printProgress(event) {
  const stepNum = `[${event.index + 1}/${event.total}]`;
  if (event.type === "loop") {
    if (event.phase === "start") {
      const step = event.step;
      const loopType = step.repeat !== undefined ? `repeat ${step.repeat}` : `each ${step.each}`;
      console.log(`${stepNum} Loop: ${loopType} (${step.steps?.length || 0} nested steps)`);
    } else if (event.phase === "ok") console.log(`     Loop completed: ${event.stepsExecuted} steps (${event.ms}ms)`);
    return;
  }
  if (event.phase === "start") {
    const args = summarizeArgs(event.step);
    process.stdout.write(`${stepNum} ${event.step.cmd}${args ? ` ${args}` : ""} ... `);
  } else if (event.phase === "ok") console.log(`OK (${event.ms}ms)`);
  else {
    console.log("FAIL");
    console.log(`     Error: ${event.error}`);
  }
}

async function executeDoSteps(steps, options = {}) {
  const context = options.context || {};
  return runtime.executeWorkflow(steps, {
    ...options,
    executeTool: options.executeTool || ((tool, args) => sendDoRequest(tool, args, context)),
    onProgress: options.quiet ? options.onProgress : (event) => {
      printProgress(event);
      options.onProgress?.(event);
    },
  });
}

module.exports = {
  AUTO_WAIT_COMMANDS: runtime.AUTO_WAIT_COMMANDS,
  AUTO_WAIT_MAP: runtime.AUTO_WAIT_MAP,
  MAX_LOOP_ITERATIONS: runtime.MAX_LOOP_ITERATIONS,
  executeSingleStep: runtime.executeSingleStep,
  executeStep: runtime.executeStep,
  executeDoSteps,
  extractStepOutput: runtime.extractStepOutput,
  getAutoWaitCommand: runtime.getAutoWaitCommand,
  resolveVar: runtime.resolveVar,
  sendDoRequest,
  shouldAutoWait: runtime.shouldAutoWait,
  substituteVars: runtime.substituteVars,
};
