/**
 * Executor for surf `do` workflow commands
 * 
 * Executes steps sequentially with auto-waits and streaming progress output.
 * Supports:
 *   - Step outputs: capture results with `as` field
 *   - Loops: `repeat` for fixed iterations, `each` for array iteration
 *   - Variable substitution: %{varname} syntax
 * 
 * Follows the same socket communication pattern as --script mode in cli.cjs.
 */

const net = require("net");

const SOCKET_PATH = process.platform === "win32" ? "//./pipe/surf" : "/tmp/surf.sock";

// Maximum iterations for loops (safety cap)
const MAX_LOOP_ITERATIONS = 100;

// Commands that trigger auto-wait after execution
// Note: 'type' is intentionally excluded - typing doesn't trigger navigation or DOM changes
const AUTO_WAIT_COMMANDS = [
  'go', 'navigate', 'click', 'key', 'form.fill', 'submit',
  'tab.switch', 'tab.new', 'back', 'forward'
];

// Auto-wait strategies per command type
const AUTO_WAIT_MAP = {
  'navigate': 'wait.load',
  'go': 'wait.load',
  'click': 'wait.dom',
  'key': 'wait.dom',
  'form.fill': 'wait.dom',
  'submit': 'wait.load',  // Form submission typically triggers navigation
  'tab.switch': 'wait.load',
  'tab.new': 'wait.load',
  'back': 'wait.load',
  'forward': 'wait.load',
};

/**
 * Check if a command should trigger an auto-wait
 * @param {string} cmd - Command name
 * @returns {boolean}
 */
function shouldAutoWait(cmd) {
  return AUTO_WAIT_COMMANDS.some(c => cmd === c || cmd.startsWith(c + '.'));
}

/**
 * Get the appropriate auto-wait command for a given command
 * @param {string} cmd - Command name
 * @returns {string|null} - Wait command to execute, or null
 */
function getAutoWaitCommand(cmd) {
  // Check exact match first
  if (AUTO_WAIT_MAP[cmd] !== undefined) return AUTO_WAIT_MAP[cmd];
  
  // Check prefix match
  for (const [prefix, waitCmd] of Object.entries(AUTO_WAIT_MAP)) {
    if (cmd.startsWith(prefix + '.')) return waitCmd;
  }
  
  return null;
}

/**
 * Send a single tool request over socket
 * @param {string} toolName - Tool/command name
 * @param {object} toolArgs - Tool arguments
 * @param {object} context - Execution context (tabId, windowId)
 * @returns {Promise<object>} - Response from host
 */
function sendDoRequest(toolName, toolArgs, context = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(SOCKET_PATH, () => {
      const req = {
        type: "tool_request",
        method: "execute_tool",
        params: { tool: toolName, args: toolArgs },
        id: "do-" + Date.now() + "-" + Math.random(),
      };
      if (context.tabId) req.tabId = context.tabId;
      if (context.windowId) req.windowId = context.windowId;
      sock.write(JSON.stringify(req) + "\n");
    });
    
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const resp = JSON.parse(line);
          sock.end();
          resolve(resp);
        } catch {
          sock.end();
          reject(new Error("Invalid JSON response"));
        }
      }
    });
    
    sock.on("error", (e) => {
      if (e.code === "ENOENT") {
        reject(new Error("Socket not found. Is Chrome running with the extension?"));
      } else if (e.code === "ECONNREFUSED") {
        reject(new Error("Connection refused. Native host not running."));
      } else {
        reject(e);
      }
    });
    
    const timeoutId = setTimeout(() => { 
      sock.destroy(); 
      reject(new Error("Request timeout")); 
    }, 30000);
    
    sock.on("close", () => clearTimeout(timeoutId));
  });
}

/**
 * Resolve a variable reference or perform string substitution
 * @param {*} template - Value to resolve (may contain %{var} references)
 * @param {object} vars - Variables map
 * @returns {*} - Resolved value
 */
function resolveVar(template, vars) {
  if (typeof template !== 'string') return template;
  
  // Check if it's a simple variable reference like %{urls}
  const match = template.match(/^%\{(\w+)\}$/);
  if (match) {
    const value = vars[match[1]];
    return value !== undefined ? value : template;
  }
  
  // Otherwise do string substitution
  return template.replace(/%\{(\w+)\}/g, (_, name) => {
    const val = vars[name];
    if (val === undefined) return `%{${name}}`;
    // Convert objects/arrays to string for interpolation
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  });
}

/**
 * Substitute variables in arguments using %{varname} syntax
 * @param {object} args - Arguments object
 * @param {object} vars - Variables map
 * @returns {object} - Arguments with variables substituted
 */
function substituteVars(args, vars) {
  if (!args || typeof args !== 'object') return args;
  
  // Handle arrays specially to preserve array type
  if (Array.isArray(args)) {
    return args.map(item => {
      if (typeof item === 'string') {
        return resolveVar(item, vars);
      } else if (typeof item === 'object' && item !== null) {
        return substituteVars(item, vars);
      } else {
        return item;
      }
    });
  }
  
  // Handle plain objects
  const result = {};
  for (const [key, val] of Object.entries(args)) {
    if (typeof val === 'string') {
      result[key] = resolveVar(val, vars);
    } else if (Array.isArray(val)) {
      result[key] = substituteVars(val, vars);
    } else if (typeof val === 'object' && val !== null) {
      result[key] = substituteVars(val, vars);
    } else {
      result[key] = val;
    }
  }
  return result;
}

/**
 * Extract usable output from a step response for the `as` capture
 * @param {object} resp - Response from sendDoRequest
 * @returns {*} - Extracted value
 */
function extractStepOutput(resp) {
  // MCP format: resp.result.content[0].text
  if (resp.result?.content?.[0]?.text) {
    const text = resp.result.content[0].text;
    // Try to parse as JSON, otherwise return raw text
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  
  // Direct value (some tools return this)
  if (resp.value !== undefined) return resp.value;
  
  // Direct result object
  if (resp.result !== undefined) return resp.result;
  
  // Fallback to the whole response
  return resp;
}

/**
 * Execute a single tool step (non-loop)
 * @param {object} step - Step to execute { cmd, args, as? }
 * @param {object} vars - Variables map (mutated if step has `as`)
 * @param {object} context - Execution context
 * @param {object} options - Execution options
 * @returns {Promise<object>} - Result { success, error?, output? }
 */
async function executeSingleStep(step, vars, context, options) {
  const { autoWait = true, stepDelay = 100 } = options;
  
  // Substitute variables in args
  const resolvedArgs = substituteVars(step.args || {}, vars);
  
  try {
    const resp = await sendDoRequest(step.cmd, resolvedArgs, context);
    
    if (resp.error) {
      const errText = resp.error.content?.[0]?.text || JSON.stringify(resp.error);
      return { success: false, error: errText };
    }
    
    // Capture output if step has `as` field
    if (step.as) {
      const output = extractStepOutput(resp);
      vars[step.as] = output;
    }
    
    // Command-specific auto-wait
    if (autoWait) {
      const waitCmd = getAutoWaitCommand(step.cmd);
      if (waitCmd) {
        const waitArgs = waitCmd === 'wait.load' 
          ? { timeout: 10000 } 
          : { stable: 100, timeout: 5000 };
        try {
          await sendDoRequest(waitCmd, waitArgs, context);
        } catch {
          // Ignore auto-wait failures silently
        }
      }
    }
    
    // Delay between steps
    if (stepDelay > 0) {
      await new Promise(r => setTimeout(r, stepDelay));
    }
    
    return { success: true, output: step.as ? vars[step.as] : undefined };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Execute a single step, handling loops recursively
 * @param {object} step - Step to execute (may be a loop or regular step)
 * @param {object} vars - Variables map
 * @param {object} context - Execution context
 * @param {object} options - Execution options
 * @param {function} onProgress - Progress callback for streaming output
 * @returns {Promise<object>} - Result { success, error?, stepsExecuted }
 */
async function executeStep(step, vars, context, options, onProgress) {
  const { onError = 'stop' } = options;
  
  // Handle `repeat` loop
  if (step.repeat !== undefined) {
    // Resolve repeat count (may be a variable)
    let max = resolveVar(step.repeat, vars);
    if (typeof max === 'string') max = parseInt(max, 10);
    if (typeof max !== 'number' || isNaN(max)) max = 1;
    
    // Safety cap
    max = Math.min(max, MAX_LOOP_ITERATIONS);
    
    if (!Array.isArray(step.steps) || step.steps.length === 0) {
      return { success: false, error: 'repeat: steps array required', stepsExecuted: 0 };
    }
    
    let totalExecuted = 0;
    
    for (let i = 0; i < max; i++) {
      // Create loop-scoped variables
      const loopVars = { ...vars, _index: i, _iteration: i + 1 };
      
      // Execute nested steps
      for (const nestedStep of step.steps) {
        const result = await executeStep(nestedStep, loopVars, context, options, onProgress);
        totalExecuted += result.stepsExecuted || 1;
        
        if (!result.success && onError === 'stop') {
          return { success: false, error: result.error, stepsExecuted: totalExecuted };
        }
      }
      
      // Copy captured variables back to parent scope (only from regular steps, not loops)
      for (const nestedStep of step.steps) {
        // Skip loop steps - their 'as' is the loop variable, not an output capture
        const isNestedLoop = nestedStep.repeat !== undefined || nestedStep.each !== undefined;
        if (!isNestedLoop && nestedStep.as && loopVars[nestedStep.as] !== undefined) {
          vars[nestedStep.as] = loopVars[nestedStep.as];
        }
      }
      
      // Check `until` condition
      if (step.until) {
        const untilResult = await executeSingleStep(step.until, loopVars, context, options);
        totalExecuted++;
        
        // Exit loop if until condition is truthy
        const exitValue = untilResult.output;
        if (exitValue === true || exitValue === 'true' || exitValue) {
          break;
        }
      }
    }
    
    return { success: true, stepsExecuted: totalExecuted };
  }
  
  // Handle `each` loop
  if (step.each !== undefined) {
    const items = resolveVar(step.each, vars);
    
    if (!Array.isArray(items)) {
      return { 
        success: false, 
        error: `each: expected array, got ${typeof items}${items === undefined ? ' (undefined)' : ''}`, 
        stepsExecuted: 0 
      };
    }
    
    if (!Array.isArray(step.steps) || step.steps.length === 0) {
      return { success: false, error: 'each: steps array required', stepsExecuted: 0 };
    }
    
    // Safety cap
    const maxItems = Math.min(items.length, MAX_LOOP_ITERATIONS);
    const itemVar = step.as || 'item';
    let totalExecuted = 0;
    
    for (let i = 0; i < maxItems; i++) {
      // Create loop-scoped variables
      const loopVars = { ...vars, [itemVar]: items[i], _index: i, _iteration: i + 1 };
      
      // Execute nested steps
      for (const nestedStep of step.steps) {
        const result = await executeStep(nestedStep, loopVars, context, options, onProgress);
        totalExecuted += result.stepsExecuted || 1;
        
        if (!result.success && onError === 'stop') {
          return { success: false, error: result.error, stepsExecuted: totalExecuted };
        }
      }
      
      // Copy captured variables back to parent scope (only from regular steps, not loops)
      for (const nestedStep of step.steps) {
        // Skip loop steps - their 'as' is the loop variable, not an output capture
        const isNestedLoop = nestedStep.repeat !== undefined || nestedStep.each !== undefined;
        if (!isNestedLoop && nestedStep.as && loopVars[nestedStep.as] !== undefined) {
          vars[nestedStep.as] = loopVars[nestedStep.as];
        }
      }
    }
    
    return { success: true, stepsExecuted: totalExecuted };
  }
  
  // Regular step (non-loop)
  if (onProgress) {
    onProgress(step, 'start');
  }
  
  const result = await executeSingleStep(step, vars, context, options);
  
  if (onProgress) {
    onProgress(step, result.success ? 'ok' : 'fail', result.error);
  }
  
  return { ...result, stepsExecuted: 1 };
}

/**
 * Execute all workflow steps sequentially
 * @param {Array<object>} steps - Steps to execute
 * @param {object} options - Execution options
 * @returns {Promise<object>} - Execution result
 */
async function executeDoSteps(steps, options = {}) {
  const {
    onError = 'stop',
    autoWait = true,
    stepDelay = 100,
    context = {},
    quiet = false,  // For --json mode, suppress streaming output
    vars: initialVars = {},
  } = options;
  
  const results = [];
  const vars = { ...initialVars, ...(context.vars || {}) };
  const total = steps.length;
  let failed = 0;
  let stepsExecuted = 0;
  const startTotal = Date.now();
  
  for (let i = 0; i < total; i++) {
    const step = steps[i];
    const startTime = Date.now();
    
    // Check if this is a loop step
    const isLoop = step.repeat !== undefined || step.each !== undefined;
    
    if (isLoop) {
      // Loops handle their own progress output
      if (!quiet) {
        const loopType = step.repeat !== undefined ? `repeat ${step.repeat}` : `each ${step.each}`;
        console.log(`[${i + 1}/${total}] Loop: ${loopType} (${step.steps?.length || 0} nested steps)`);
      }
      
      const result = await executeStep(step, vars, context, { onError, autoWait, stepDelay }, null);
      const ms = Date.now() - startTime;
      
      stepsExecuted += result.stepsExecuted || 0;
      
      if (!result.success) {
        results.push({ step: i + 1, type: 'loop', status: 'error', error: result.error, ms });
        failed++;
        
        if (onError === 'stop') {
          return { 
            status: 'failed', 
            completedSteps: stepsExecuted, 
            totalSteps: total, 
            results, 
            error: result.error,
            totalMs: Date.now() - startTotal,
            vars
          };
        }
      } else {
        results.push({ step: i + 1, type: 'loop', status: 'ok', stepsExecuted: result.stepsExecuted, ms });
        if (!quiet) {
          console.log(`     Loop completed: ${result.stepsExecuted} steps (${ms}ms)`);
        }
      }
    } else {
      // Regular step
      const stepNum = `[${i + 1}/${total}]`;
      const argSummary = Object.entries(step.args || {})
        .map(([k, v]) => typeof v === "string" && v.length > 40 
          ? `${k}="${v.slice(0, 37)}..."` 
          : `${k}=${JSON.stringify(v)}`)
        .join(" ");
      const desc = argSummary ? `${step.cmd} ${argSummary}` : step.cmd;
      
      if (!quiet) {
        process.stdout.write(`${stepNum} ${desc} ... `);
      }
      
      const result = await executeSingleStep(step, vars, context, { onError, autoWait, stepDelay });
      const ms = Date.now() - startTime;
      stepsExecuted++;
      
      if (!result.success) {
        if (!quiet) {
          console.log('FAIL');
          console.log(`     Error: ${result.error}`);
        }
        
        results.push({ step: i + 1, cmd: step.cmd, status: 'error', error: result.error, ms });
        failed++;
        
        if (onError === 'stop') {
          return { 
            status: 'failed', 
            completedSteps: stepsExecuted - 1, 
            totalSteps: total, 
            results, 
            error: result.error,
            totalMs: Date.now() - startTotal,
            vars
          };
        }
      } else {
        if (!quiet) {
          console.log(`OK (${ms}ms)`);
        }
        results.push({ step: i + 1, cmd: step.cmd, status: 'ok', ms });
      }
    }
  }
  
  return { 
    status: failed > 0 ? 'partial' : 'completed', 
    completedSteps: stepsExecuted, 
    totalSteps: total, 
    results,
    failed,
    totalMs: Date.now() - startTotal,
    vars
  };
}

module.exports = { 
  executeDoSteps, 
  sendDoRequest, 
  shouldAutoWait,
  getAutoWaitCommand,
  substituteVars,
  resolveVar,
  extractStepOutput,
  executeStep,
  executeSingleStep,
  AUTO_WAIT_COMMANDS,
  AUTO_WAIT_MAP,
  MAX_LOOP_ITERATIONS
};
