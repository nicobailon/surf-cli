#!/usr/bin/env node
const net = require("net");
const fs = require("fs");
const { loadConfig, getConfigPath, createStarterConfig } = require("./config.cjs");

const SOCKET_PATH = "/tmp/pi-chrome.sock";
const args = process.argv.slice(2);

const TOOLS = {
  ai: {
    desc: "AI-powered page analysis",
    commands: {
      "ai": { desc: "Analyze page with AI", args: ["query"], opts: { mode: "Query mode: find|summary|extract (auto-detected)" } },
    }
  },
  tab: {
    desc: "Tab management",
    commands: {
      "tab.list": { desc: "List all open tabs", args: [] },
      "tab.new": { desc: "Open new tab", args: ["url"], opts: { urls: "Open multiple URLs" } },
      "tab.switch": { desc: "Switch to tab by ID or name", args: ["id"] },
      "tab.close": { desc: "Close tab by ID or name", args: ["id"], opts: { ids: "Close multiple tabs" } },
      "tab.name": { desc: "Register current tab with a name", args: ["name"] },
      "tab.unname": { desc: "Unregister a named tab", args: ["name"] },
      "tab.named": { desc: "List all named tabs", args: [] },
    }
  },
  scroll: {
    desc: "Scrolling",
    commands: {
      "scroll.top": { desc: "Scroll to top of page", args: [], opts: { selector: "Target specific container" } },
      "scroll.bottom": { desc: "Scroll to bottom of page", args: [], opts: { selector: "Target specific container" } },
      "scroll.to": { desc: "Scroll element into view", args: [], opts: { ref: "Element ref from page.read" } },
      "scroll.info": { desc: "Get scroll position info", args: [], opts: { selector: "Target specific container" } },
    }
  },
  page: {
    desc: "Page inspection",
    commands: {
      "page.read": { desc: "Get accessibility tree", args: [], opts: { all: "Include all elements", ref: "Get specific element" } },
      "page.text": { desc: "Extract all text from page", args: [] },
      "page.state": { desc: "Get page state (modals, loading, etc.)", args: [] },
    }
  },
  wait: {
    desc: "Waiting",
    commands: {
      "wait": { desc: "Wait N seconds", args: ["duration"] },
      "wait.element": { desc: "Wait for element to appear", args: [], opts: { selector: "CSS selector", timeout: "Timeout in ms" } },
      "wait.network": { desc: "Wait for network idle", args: [], opts: { timeout: "Timeout in ms" } },
      "wait.url": { desc: "Wait for URL to match", args: [], opts: { pattern: "URL pattern to match", timeout: "Timeout in ms" } },
      "wait.dom": { desc: "Wait for DOM to stabilize", args: [], opts: { stable: "Stability window in ms (default: 100)", timeout: "Max wait time in ms" } },
      "wait.load": { desc: "Wait for page to fully load", args: [], opts: { timeout: "Max wait time in ms (default: 30000)" } },
    }
  },
  input: {
    desc: "Input actions",
    commands: {
      "click": { desc: "Click element or coordinates", args: [], opts: { ref: "Element ref", x: "X coordinate", y: "Y coordinate", button: "left|right|double|triple", selector: "CSS selector (js method)", method: "cdp|js (default: cdp)" } },
      "type": { desc: "Type text", args: ["text"], opts: { selector: "CSS selector (required for js)", submit: "Press enter after", clear: "Clear first (js only)", method: "cdp|js (default: cdp)" } },
      "smart_type": { desc: "Type into specific element (js method)", args: [], opts: { selector: "CSS selector", text: "Text to type", clear: "Clear first (default: true)", submit: "Submit after" } },
      "key": { desc: "Press key", args: ["key"], example: "Enter, Escape, cmd+a, ctrl+shift+p" },
      "hover": { desc: "Hover over element", args: [], opts: { ref: "Element ref", x: "X coordinate", y: "Y coordinate" } },
      "drag": { desc: "Drag between points", args: [], opts: { from: "Start x,y", to: "End x,y" } },
    }
  },
  nav: {
    desc: "Navigation",
    commands: {
      "navigate": { desc: "Go to URL", args: ["url"] },
      "screenshot": { desc: "Capture screenshot", args: [], opts: { output: "Save to file", selector: "Capture specific element" } },
    }
  },
  js: {
    desc: "JavaScript execution",
    commands: {
      "js": { desc: "Execute JavaScript (use 'return' for values)", args: ["code"], opts: { file: "Run JS from file" } },
    }
  },
  dev: {
    desc: "Dev tools",
    commands: {
      "console": { desc: "Read console messages", args: [], opts: { clear: "Clear after reading", stream: "Continuous output", level: "Filter by level (log,warn,error)" } },
      "network": { desc: "Read network requests", args: [], opts: { clear: "Clear after reading", stream: "Continuous output", filter: "Filter by URL pattern" } },
    }
  },
  health: {
    desc: "Health checks",
    commands: {
      "health": { desc: "Wait for URL or element", args: [], opts: { url: "URL to check (expects 200)", selector: "CSS selector to wait for", expect: "Expected status code (default: 200)", timeout: "Timeout in ms (default: 30000)" } },
    }
  },
  smoke: {
    desc: "Smoke testing",
    commands: {
      "smoke": { desc: "Run smoke tests on URLs", args: [], opts: { urls: "URLs to test (space-separated)", routes: "Route group from config (future)", screenshot: "Directory to save screenshots", "fail-fast": "Stop on first error" } },
    }
  },
  dialog: {
    desc: "Browser dialog handling",
    commands: {
      "dialog.accept": { desc: "Accept current dialog", args: [], opts: { text: "Text for prompt input" } },
      "dialog.dismiss": { desc: "Dismiss current dialog", args: [] },
      "dialog.info": { desc: "Get current dialog info", args: [] },
    }
  },
  emulate: {
    desc: "Device/network emulation",
    commands: {
      "emulate.network": { desc: "Emulate network conditions", args: ["preset"], opts: {} },
      "emulate.cpu": { desc: "CPU throttling (rate >= 1)", args: ["rate"], opts: {} },
      "emulate.geo": { desc: "Override geolocation", args: [], opts: { lat: "Latitude", lon: "Longitude", accuracy: "Accuracy in meters (default: 100)", clear: "Clear override" } },
    }
  },
  form: {
    desc: "Form automation",
    commands: {
      "form.fill": { desc: "Batch fill form fields", args: [], opts: { data: "JSON array of {ref, value}" } },
    }
  },
  perf: {
    desc: "Performance tracing",
    commands: {
      "perf.start": { desc: "Start performance trace", args: [], opts: { categories: "Trace categories (comma-separated)" } },
      "perf.stop": { desc: "Stop trace and get metrics", args: [] },
      "perf.metrics": { desc: "Get current performance metrics", args: [] },
    }
  },
  upload: {
    desc: "File upload",
    commands: {
      "upload": { desc: "Upload file(s) to input", args: [], opts: { ref: "Element ref (e.g., e5)", files: "File path(s) comma-separated" } },
    }
  },
  frame: {
    desc: "Iframe handling",
    commands: {
      "frame.list": { desc: "List all frames in page", args: [] },
      "frame.js": { desc: "Execute JS in specific frame", args: [], opts: { id: "Frame ID from frame.list", code: "JavaScript code" } },
    }
  },
};

const ALL_SOCKET_TOOLS = [
  "ai", "screenshot", "navigate", "read_page", "get_page_text", "form_input", "find_and_type",
  "autocomplete", "set_value", "smart_type", "scroll_to_position", "get_scroll_info",
  "close_dialogs", "page_state", "tabs_context", "javascript_tool", "wait_for_element",
  "wait_for_url", "wait_for_network_idle", "read_console_messages", "read_network_requests",
  "upload_image", "resize_window", "tabs_create", "tabs_register", "tabs_get_by_name", "health",
  "tabs_list_named", "tabs_unregister", "list_tabs", "new_tab", "switch_tab", "close_tab",
  "left_click", "right_click", "double_click", "triple_click", "type", "key", "type_submit",
  "click_type", "click_type_submit", "scroll", "scroll_to", "hover", "left_click_drag",
  "drag", "wait", "zoom", "computer", "smoke",
];

const showMainHelp = () => {
  console.log(`
  pi-chrome - Browser automation via Chrome extension

Usage
  pi-chrome <tool> [args] [options]
  pi-chrome <group> --help            Show group commands
  pi-chrome <tool> --help             Show tool options
  pi-chrome --list                    List all socket tools

Groups`);
  for (const [name, group] of Object.entries(TOOLS)) {
    const cmds = Object.keys(group.commands).join(", ");
    console.log(`  ${name.padEnd(10)} ${group.desc.padEnd(25)} ${cmds}`);
  }
  console.log(`
Config
  pi-chrome config              Show current config
  pi-chrome config --init       Create starter pi-chrome.json in cwd
  pi-chrome config --path       Show config file path

Script Mode
  pi-chrome --script <file>                Run workflow from JSON file
  pi-chrome --script <file> --dry-run      Show steps without executing
  pi-chrome --script <file> --stop-on-error  Stop on first error (default: continue)

Options
  --tab-id <id>     Target specific tab
  --json            Output raw JSON response
  --auto-capture    On error: capture screenshot + console to /tmp
  --list            List all 50+ socket tools
  --help, -h        Show this help

Examples
  pi-chrome tab.list
  pi-chrome tab.new "https://google.com"
  pi-chrome screenshot --output /tmp/shot.png
  pi-chrome smart_type --selector "#input" --text "hello" --submit
  pi-chrome scroll.bottom
  pi-chrome js "return document.title"
  pi-chrome wait 2
`);
};

const showGroupHelp = (groupName) => {
  const group = TOOLS[groupName];
  if (!group) {
    console.error(`Unknown group: ${groupName}`);
    console.error(`Available groups: ${Object.keys(TOOLS).join(", ")}`);
    process.exit(1);
  }
  console.log(`\n  ${groupName} - ${group.desc}\n`);
  for (const [cmd, info] of Object.entries(group.commands)) {
    const argStr = info.args?.length ? `<${info.args.join("> <")}>` : "";
    console.log(`  ${cmd} ${argStr}`);
    console.log(`      ${info.desc}`);
    if (info.opts) {
      for (const [opt, desc] of Object.entries(info.opts)) {
        console.log(`      --${opt.padEnd(12)} ${desc}`);
      }
    }
    if (info.example) {
      console.log(`      Example: ${info.example}`);
    }
    console.log();
  }
};

const showToolHelp = (toolName) => {
  for (const group of Object.values(TOOLS)) {
    const info = group.commands[toolName];
    if (info) {
      const argStr = info.args?.length ? `<${info.args.join("> <")}>` : "";
      console.log(`\n  ${toolName} ${argStr}\n`);
      console.log(`  ${info.desc}\n`);
      if (info.args?.length) {
        console.log("  Arguments:");
        for (const arg of info.args) {
          console.log(`    <${arg}>`);
        }
        console.log();
      }
      if (info.opts) {
        console.log("  Options:");
        for (const [opt, desc] of Object.entries(info.opts)) {
          console.log(`    --${opt.padEnd(14)} ${desc}`);
        }
        console.log();
      }
      if (info.example) {
        console.log(`  Example values: ${info.example}\n`);
      }
      return;
    }
  }
  if (ALL_SOCKET_TOOLS.includes(toolName)) {
    console.log(`\n  ${toolName}\n`);
    console.log("  Socket API tool. Use --json to see response format.\n");
    console.log(`  Example: pi-chrome ${toolName} --json\n`);
    return;
  }
  console.error(`Unknown tool: ${toolName}`);
  process.exit(1);
};

const showAllTools = () => {
  console.log("\n  All available socket tools:\n");
  const sorted = [...ALL_SOCKET_TOOLS].sort();
  const cols = 4;
  const width = 22;
  for (let i = 0; i < sorted.length; i += cols) {
    const row = sorted.slice(i, i + cols).map(t => t.padEnd(width)).join("");
    console.log("  " + row);
  }
  console.log(`\n  Total: ${ALL_SOCKET_TOOLS.length} tools\n`);
  console.log("  Plus dot-notation aliases: tab.*, scroll.*, page.*, wait.*\n");
};

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  showMainHelp();
  process.exit(0);
}

if (args[0] === "--list") {
  showAllTools();
  process.exit(0);
}

if (args[0] === "server") {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: pi-chrome server");
    console.log("");
    console.log("Start MCP server for Claude Desktop/Cursor integration.");
    console.log("Communicates via stdio using the Model Context Protocol.");
    process.exit(0);
  }
  const { PiChromeMcpServer } = require("./mcp-server.cjs");
  const server = new PiChromeMcpServer();
  server.start().catch((err) => {
    console.error("MCP Server error:", err.message);
    process.exit(1);
  });
  return;
}

if (args.includes("--help") || args.includes("-h")) {
  const tool = args[0];
  if (TOOLS[tool]) {
    showGroupHelp(tool);
  } else {
    showToolHelp(tool);
  }
  process.exit(0);
}

if (TOOLS[args[0]] && args.length === 1) {
  showGroupHelp(args[0]);
  process.exit(0);
}

if (args[0] === "config") {
  const configArgs = args.slice(1);
  const hasInit = configArgs.includes("--init");
  const hasPath = configArgs.includes("--path");

  if (hasInit) {
    const result = createStarterConfig();
    if (result.success) {
      console.log(`Created: ${result.path}`);
    } else {
      console.error(`Error: ${result.error}`);
      console.error(`Path: ${result.path}`);
      process.exit(1);
    }
    process.exit(0);
  }

  if (hasPath) {
    loadConfig();
    const configPath = getConfigPath();
    if (configPath) {
      console.log(configPath);
    } else {
      console.log("No config found");
    }
    process.exit(0);
  }

  const config = loadConfig();
  const configPath = getConfigPath();
  if (configPath) {
    console.log(JSON.stringify(config, null, 2));
  } else {
    console.log("No config found");
    console.log("Create one with: pi-chrome config --init");
  }
  process.exit(0);
}

if (args.includes("--script")) {
  const scriptIdx = args.indexOf("--script");
  const scriptPath = args[scriptIdx + 1];
  const dryRun = args.includes("--dry-run");
  const stopOnError = args.includes("--stop-on-error");

  const tabIdIdx = args.indexOf("--tab-id");
  const scriptTabId = tabIdIdx !== -1 ? args[tabIdIdx + 1] : undefined;

  if (!scriptPath || scriptPath.startsWith("--")) {
    console.error("Error: --script requires a file path");
    process.exit(1);
  }

  if (!fs.existsSync(scriptPath)) {
    console.error(`Error: Script file not found: ${scriptPath}`);
    process.exit(1);
  }

  let script;
  try {
    const content = fs.readFileSync(scriptPath, "utf8");
    script = JSON.parse(content);
  } catch (e) {
    console.error(`Error: Failed to parse script: ${e.message}`);
    process.exit(1);
  }

  if (!script.steps || !Array.isArray(script.steps)) {
    console.error("Error: Script must have a 'steps' array");
    process.exit(1);
  }

  const sendScriptRequest = (toolName, toolArgs = {}) => {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(SOCKET_PATH, () => {
        const req = {
          type: "tool_request",
          method: "execute_tool",
          params: { tool: toolName, args: toolArgs },
          id: "cli-" + Date.now() + "-" + Math.random(),
        };
        if (scriptTabId) req.tabId = parseInt(scriptTabId, 10);
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
            reject(new Error("Invalid JSON"));
          }
        }
      });
      sock.on("error", (e) => reject(e));
      let timeoutId;
      timeoutId = setTimeout(() => { sock.destroy(); reject(new Error("Timeout")); }, 30000);
      sock.on("close", () => clearTimeout(timeoutId));
    });
  };

  const runScript = async () => {
    const total = script.steps.length;
    const results = [];
    let failed = 0;

    console.log(`Running: ${script.name || scriptPath} (${total} steps)`);
    if (dryRun) console.log("(dry-run mode)\n");
    else console.log("");

    for (let i = 0; i < total; i++) {
      const step = script.steps[i];
      const stepNum = `[${i + 1}/${total}]`;
      const toolName = step.tool;
      const toolArgs = step.args || {};

      const argSummary = Object.entries(toolArgs)
        .map(([k, v]) => typeof v === "string" && v.length > 40 ? `${k}="${v.slice(0, 37)}..."` : `${k}=${JSON.stringify(v)}`)
        .join(" ");
      const desc = argSummary ? `${toolName} ${argSummary}` : toolName;

      if (dryRun) {
        console.log(`${stepNum} ${desc}`);
        results.push({ step: i + 1, tool: toolName, status: "skipped" });
        continue;
      }

      process.stdout.write(`${stepNum} ${desc} ... `);

      try {
        const resp = await sendScriptRequest(toolName, toolArgs);
        if (resp.error) {
          const errText = resp.error.content?.[0]?.text || JSON.stringify(resp.error);
          console.log(`FAIL`);
          console.log(`     Error: ${errText}`);
          results.push({ step: i + 1, tool: toolName, status: "fail", error: errText });
          failed++;
          if (stopOnError) break;
        } else {
          console.log("OK");
          results.push({ step: i + 1, tool: toolName, status: "ok" });
        }
      } catch (e) {
        console.log(`FAIL`);
        console.log(`     Error: ${e.message}`);
        results.push({ step: i + 1, tool: toolName, status: "fail", error: e.message });
        failed++;
        if (stopOnError) break;
      }
    }

    console.log("");
    const passed = results.filter(r => r.status === "ok").length;
    const skipped = results.filter(r => r.status === "skipped").length;
    if (dryRun) {
      console.log(`Summary: ${skipped} steps would run`);
    } else {
      console.log(`Summary: ${passed} passed, ${failed} failed, ${total} total`);
    }

    process.exit(failed > 0 ? 1 : 0);
  };

  runScript();
  return;
}

const BOOLEAN_FLAGS = ["auto-capture", "json", "stream", "dry-run", "stop-on-error", "fail-fast", "clear", "submit", "all"];

const parseArgs = (rawArgs) => {
  const result = { positional: [], options: {} };
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (BOOLEAN_FLAGS.includes(key)) {
        result.options[key] = true;
      } else {
        const next = rawArgs[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          let val = next;
          if (val === "true") val = true;
          else if (val === "false") val = false;
          else if (/^-?\d+$/.test(val)) val = parseInt(val, 10);
          else if (/^-?\d+\.\d+$/.test(val)) val = parseFloat(val);
          result.options[key] = val;
          i++;
        } else {
          result.options[key] = true;
        }
      }
    } else {
      result.positional.push(arg);
    }
  }
  return result;
};

let { positional, options } = parseArgs(args);
let tool = positional[0];
let firstArg = positional[1];

if (!tool) {
  console.error("Error: No tool specified");
  process.exit(1);
}

if (tool === "smoke") {
  const smokeUrls = [];
  const smokeArgs = args.slice(1);
  for (let i = 0; i < smokeArgs.length; i++) {
    const arg = smokeArgs[i];
    if (arg === "--urls") {
      i++;
      while (i < smokeArgs.length && !smokeArgs[i].startsWith("--")) {
        smokeUrls.push(smokeArgs[i]);
        i++;
      }
      i--;
    } else if (arg === "--routes") {
      options.routes = smokeArgs[i + 1];
      i++;
    } else if (arg === "--screenshot") {
      options.screenshot = smokeArgs[i + 1];
      i++;
    } else if (arg === "--fail-fast") {
      options["fail-fast"] = true;
    }
  }
  if (smokeUrls.length > 0) {
    options.urls = smokeUrls;
  }
}

const PRIMARY_ARG_MAP = {
  ai: "query",
  navigate: "url",
  js: "code",
  javascript_tool: "code",
  key: "key",
  wait: "duration",
  health: "url",
  new_tab: "url",
  "tab.new": "url",
  switch_tab: "tab_id",
  "tab.switch": "id",
  close_tab: "tab_id",
  "tab.close": "id",
  "tab.name": "name",
  "tab.unname": "name",
  scroll_to_position: "position",
  type: "text",
  smart_type: "text",
  "emulate.network": "preset",
  "emulate.cpu": "rate",
};

const toolArgs = { ...options };

if (firstArg !== undefined) {
  const primaryKey = PRIMARY_ARG_MAP[tool];
  if (primaryKey && toolArgs[primaryKey] === undefined) {
    let val = firstArg;
    if (val === "true") val = true;
    else if (val === "false") val = false;
    else if (/^-?\d+$/.test(val)) val = parseInt(val, 10);
    toolArgs[primaryKey] = val;
  }
}

const globalOpts = {};
if (toolArgs["tab-id"] !== undefined) {
  globalOpts.tabId = toolArgs["tab-id"];
  delete toolArgs["tab-id"];
}
const wantJson = toolArgs.json === true;
delete toolArgs.json;

const autoCapture = toolArgs["auto-capture"] === true;
delete toolArgs["auto-capture"];

const outputPath = toolArgs.output;
delete toolArgs.output;

if (tool === "screenshot" && outputPath) {
  if (typeof outputPath !== "string") {
    console.error("Error: --output requires a file path");
    process.exit(1);
  }
  toolArgs.savePath = outputPath;
}

const methodFlag = toolArgs.method;
delete toolArgs.method;

const streamMode = toolArgs.stream === true;
delete toolArgs.stream;

const streamLevel = toolArgs.level;
delete toolArgs.level;

const streamFilter = toolArgs.filter;
delete toolArgs.filter;

let finalTool = tool;
if (methodFlag === "js") {
  if (tool === "type") {
    if (!toolArgs.selector) {
      console.error("Error: --selector required for type with --method js");
      process.exit(1);
    }
    finalTool = "smart_type";
  } else if (tool === "click") {
    if (!toolArgs.selector) {
      console.error("Error: --selector required for click with --method js");
      process.exit(1);
    }
    finalTool = "js_click";
    toolArgs.code = `document.querySelector(${JSON.stringify(toolArgs.selector)})?.click()`;
    delete toolArgs.selector;
    finalTool = "js";
  }
} else if (methodFlag === "cdp") {
  if (tool === "smart_type") {
    finalTool = "type";
  }
}

if (streamMode && (tool === "console" || tool === "network")) {
  const streamType = tool === "console" ? "STREAM_CONSOLE" : "STREAM_NETWORK";
  const streamOpts = {
    level: streamLevel,
    filter: streamFilter,
  };

  const formatTime = (ts) => {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 });
  };

  let connectionTimeout = null;
  let receivedData = false;

  const sock = net.createConnection(SOCKET_PATH, () => {
    const req = {
      type: "stream_request",
      streamType,
      options: streamOpts,
      id: "cli-stream-" + Date.now(),
      ...globalOpts,
    };
    sock.write(JSON.stringify(req) + "\n");
    connectionTimeout = setTimeout(() => {
      if (!receivedData) {
        console.error("Error: Stream connection timeout (10s) - no data received");
        sock.destroy();
        process.exit(1);
      }
    }, 10000);
  });

  let buf = "";
  sock.on("data", (d) => {
    if (!receivedData) {
      receivedData = true;
      if (connectionTimeout) {
        clearTimeout(connectionTimeout);
        connectionTimeout = null;
      }
    }
    buf += d.toString();
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.error) {
          console.error("Error:", msg.error);
          sock.end();
          process.exit(1);
        }
        if (msg.type === "stream_started") {
          continue;
        }
        if (msg.type === "console_event") {
          const { level, text, timestamp } = msg;
          if (streamLevel && level !== streamLevel) continue;
          console.log(`[console] [${level}] ${formatTime(timestamp)} ${text}`);
        } else if (msg.type === "network_event") {
          const { method, url, status, duration } = msg;
          if (streamFilter && !url.includes(streamFilter)) continue;
          const statusStr = status !== undefined ? status : "...";
          const durationStr = duration !== undefined ? ` (${duration}ms)` : "";
          console.log(`[network] ${method} ${url} ${statusStr}${durationStr}`);
        }
      } catch {}
    }
  });

  sock.on("error", (e) => {
    if (e.code === "ENOENT") {
      console.error("Error: Socket not found. Is Chrome running with the extension?");
    } else {
      console.error("Error:", e.message);
    }
    process.exit(1);
  });

  process.on("SIGINT", () => {
    sock.write(JSON.stringify({ type: "stream_stop" }) + "\n");
    sock.end();
    process.exit(0);
  });

  return;
}

const request = {
  type: "tool_request",
  method: "execute_tool",
  params: { tool: finalTool, args: toolArgs },
  id: "cli-" + Date.now(),
  ...globalOpts,
};

const sendRequest = (toolName, toolArgs = {}) => {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(SOCKET_PATH, () => {
      const req = {
        type: "tool_request",
        method: "execute_tool",
        params: { tool: toolName, args: toolArgs },
        id: "cli-" + Date.now() + "-" + Math.random(),
        ...globalOpts,
      };
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
          reject(new Error("Invalid JSON"));
        }
      }
    });
    sock.on("error", (e) => reject(e));
    let timeoutId;
    timeoutId = setTimeout(() => { sock.destroy(); reject(new Error("Timeout")); }, 5000);
    sock.on("close", () => clearTimeout(timeoutId));
  });
};

const performAutoCapture = async () => {
  const timestamp = Date.now();
  const screenshotPath = `/tmp/pi-chrome-error-${timestamp}.png`;

  try {
    const [screenshotResp, consoleResp] = await Promise.all([
      sendRequest("screenshot", { savePath: screenshotPath }),
      sendRequest("read_console_messages", {}),
    ]);

    if (screenshotResp.result) {
      console.error(`Auto-captured: ${screenshotPath}`);
    } else {
      console.error("Auto-captured: (screenshot failed)");
    }

    let consoleErrors = "(none)";
    const consoleText = consoleResp.result?.content?.[0]?.text;
    if (consoleText) {
      try {
        const parsed = JSON.parse(consoleText);
        const msgs = parsed.messages || parsed || [];
        const errors = msgs.filter(m => m.level === "error" || m.type === "error");
        if (errors.length > 0) {
          consoleErrors = errors.map(e => e.text || e.message || JSON.stringify(e)).join("\n  ");
        }
      } catch {
        consoleErrors = consoleText;
      }
    }
    console.error(`Console errors: ${consoleErrors}`);
  } catch (captureErr) {
    console.error(`Auto-capture failed: ${captureErr.message}`);
  }
};

const socket = net.createConnection(SOCKET_PATH, () => {
  socket.write(JSON.stringify(request) + "\n");
});

const requestTimeout = tool === "smoke" ? 300000 : 30000;
const timeout = setTimeout(() => {
  console.error(`Error: Request timed out (${requestTimeout / 1000}s)`);
  socket.destroy();
  process.exit(1);
}, requestTimeout);

let buffer = "";

socket.on("data", (data) => {
  buffer += data.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop();

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      handleResponse(JSON.parse(line)).catch((err) => {
        console.error("Handler error:", err.message);
        process.exit(1);
      });
    } catch (e) {
      console.error("Invalid JSON response:", line);
      process.exit(1);
    }
  }
});

socket.on("error", (err) => {
  clearTimeout(timeout);
  if (err.code === "ENOENT") {
    console.error("Error: Socket not found. Is Chrome running with the extension?");
  } else if (err.code === "ECONNREFUSED") {
    console.error("Error: Connection refused. Native host not running.");
  } else {
    console.error("Error:", err.message);
  }
  process.exit(1);
});

socket.on("close", () => {
  clearTimeout(timeout);
});

async function handleResponse(response) {
  clearTimeout(timeout);

  if (response.error) {
    const errContent = response.error.content?.[0]?.text || JSON.stringify(response.error);
    console.error("Error:", errContent);

    if (autoCapture) {
      await performAutoCapture();
    }

    socket.end();
    process.exit(1);
  }

  const result = response.result?.content?.[0]?.text;
  let data;
  try {
    data = result ? JSON.parse(result) : response.result;
  } catch {
    data = result || response.result;
  }

  if (wantJson) {
    console.log(JSON.stringify(data, null, 2));
    socket.end();
    process.exit(0);
  }

  if (tool === "screenshot" && data?.base64 && outputPath) {
    fs.writeFileSync(outputPath, Buffer.from(data.base64, "base64"));
    console.log(`Saved: ${outputPath}`);
  } else if (tool === "screenshot" && data?.message) {
    console.log(data.message);
  } else if (tool === "list_tabs" || tool === "tab.list") {
    const tabs = data?.tabs || data || [];
    if (Array.isArray(tabs)) {
      for (const t of tabs) {
        console.log(`${t.id}\t${t.title}\t${t.url}`);
      }
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  } else if (tool === "tab.named" || tool === "tabs_list_named") {
    const named = data?.tabs || data?.namedTabs || data || [];
    if (Array.isArray(named)) {
      if (named.length === 0) {
        console.log("No named tabs");
      } else {
        for (const t of named) {
          console.log(`${t.name}\t${t.tabId}\t${t.title || ""}\t${t.url || ""}`);
        }
      }
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  } else if (tool === "ai" && data?.aiResult) {
    if (data.mode === "find") {
      console.log(data.ref || "NOT_FOUND");
    } else {
      console.log(data.content);
    }
  } else if (tool === "read_page" && data?.pageContent) {
    console.log(data.pageContent);
  } else if (tool === "get_page_text" && data?.text) {
    console.log(data.text);
  } else if (tool === "js" || tool === "javascript_tool") {
    if (data?.result !== undefined) {
      const val = data.result.value ?? data.result;
      console.log(typeof val === "string" ? val : JSON.stringify(val, null, 2));
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  } else if (tool === "health") {
    if (data?.success) {
      const timeStr = data.time ? ` (${data.time}ms)` : "";
      if (data.status) {
        console.log(`OK: ${data.status}${timeStr}`);
      } else if (data.found) {
        console.log(`OK: element found${timeStr}`);
      } else {
        console.log(`OK${timeStr}`);
      }
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  } else if (tool === "smoke" && data?.results) {
    const results = data.results;
    const summary = data.summary || { pass: 0, fail: 0, total: results.length };
    
    for (const r of results) {
      const status = r.status === "pass" ? "PASS" : "FAIL";
      const timeStr = r.time ? ` (${r.time}ms)` : "";
      const ssStr = r.screenshot ? ` [${r.screenshot}]` : "";
      console.log(`[${status}] ${r.url}${timeStr}${ssStr}`);
      if (r.errors && r.errors.length > 0) {
        for (const err of r.errors) {
          console.log(`  - ${err}`);
        }
      }
    }
    
    console.log("");
    console.log(`Summary: ${summary.pass} passed, ${summary.fail} failed, ${summary.total} total`);
    
    if (summary.fail > 0) {
      socket.end();
      process.exit(1);
    }
  } else if (typeof data === "string") {
    console.log(data);
  } else if (data?.success === true) {
    console.log("OK");
  } else if (data?.error) {
    console.error("Error:", data.error);
    if (autoCapture) {
      await performAutoCapture();
    }
    socket.end();
    process.exit(1);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }

  socket.end();
  process.exit(0);
}
