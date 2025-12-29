#!/usr/bin/env node
const net = require("net");
const fs = require("fs");
const { loadConfig, getConfigPath, createStarterConfig } = require("./config.cjs");

const SOCKET_PATH = "/tmp/pi-chrome.sock";
const args = process.argv.slice(2);

const TOOLS = {
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
      "console": { desc: "Read console messages", args: [], opts: { clear: "Clear after reading" } },
      "network": { desc: "Read network requests", args: [], opts: { clear: "Clear after reading" } },
    }
  },
  health: {
    desc: "Health checks",
    commands: {
      "health": { desc: "Wait for URL or element", args: [], opts: { url: "URL to check (expects 200)", selector: "CSS selector to wait for", expect: "Expected status code (default: 200)", timeout: "Timeout in ms (default: 30000)" } },
    }
  },
};

const ALL_SOCKET_TOOLS = [
  "screenshot", "navigate", "read_page", "get_page_text", "form_input", "find_and_type",
  "autocomplete", "set_value", "smart_type", "scroll_to_position", "get_scroll_info",
  "close_dialogs", "page_state", "tabs_context", "javascript_tool", "wait_for_element",
  "wait_for_url", "wait_for_network_idle", "read_console_messages", "read_network_requests",
  "upload_image", "resize_window", "tabs_create", "tabs_register", "tabs_get_by_name", "health",
  "tabs_list_named", "tabs_unregister", "list_tabs", "new_tab", "switch_tab", "close_tab",
  "left_click", "right_click", "double_click", "triple_click", "type", "key", "type_submit",
  "click_type", "click_type_submit", "scroll", "scroll_to", "hover", "left_click_drag",
  "drag", "wait", "zoom", "computer",
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

const parseArgs = (rawArgs) => {
  const result = { positional: [], options: {} };
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
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
    } else {
      result.positional.push(arg);
    }
  }
  return result;
};

const { positional, options } = parseArgs(args);
const tool = positional[0];
const firstArg = positional[1];

if (!tool) {
  console.error("Error: No tool specified");
  process.exit(1);
}

const PRIMARY_ARG_MAP = {
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
  toolArgs.savePath = outputPath;
}

const methodFlag = toolArgs.method;
delete toolArgs.method;

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

const timeout = setTimeout(() => {
  console.error("Error: Request timed out (30s)");
  socket.destroy();
  process.exit(1);
}, 30000);

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
