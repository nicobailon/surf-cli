#!/usr/bin/env node
const net = require("net");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync, execSync } = require("child_process");
const { loadConfig, getConfigPath, createStarterConfig } = require("./config.cjs");
const networkFormatters = require("./formatters/network.cjs");
const networkStore = require("./network-store.cjs");
const { parseDoCommands } = require("./do-parser.cjs");
const { executeDoSteps } = require("./do-executor.cjs");
const { version: VERSION } = require("../package.json");

const IS_WIN = process.platform === "win32";
const { SOCKET_PATH, SURF_TMP, formatSocketError } = require("./socket-path.cjs");
const { acquireBrowserLock } = require("./browser-lock.cjs");
if (IS_WIN) { try { fs.mkdirSync(SURF_TMP, { recursive: true }); } catch {} }

function parseBrowserLockOptions(noLockFlag) {
  const noLock = noLockFlag || process.env.SURF_NO_LOCK === "1" || process.env.SURF_NO_LOCK === "true";
  let timeoutMs;
  if (process.env.SURF_LOCK_TIMEOUT_MS !== undefined) {
    timeoutMs = Number(process.env.SURF_LOCK_TIMEOUT_MS);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      console.error("Error: SURF_LOCK_TIMEOUT_MS must be a non-negative number");
      process.exit(1);
    }
  }
  return { noLock, timeoutMs };
}

function installBrowserLock({ noLock, timeoutMs }) {
  let releaseBrowserLock = () => {};
  if (!noLock) {
    try {
      const lock = acquireBrowserLock(SOCKET_PATH, SURF_TMP, { timeoutMs });
      releaseBrowserLock = lock.release;
    } catch (error) {
      console.error("Error:", error && error.message ? error.message : String(error));
      process.exit(1);
    }
  }

  const release = () => {
    const releaseCurrent = releaseBrowserLock;
    releaseBrowserLock = () => {};
    releaseCurrent();
  };

  process.once("exit", release);
  process.once("SIGINT", () => {
    release();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    release();
    process.exit(143);
  });
}

// ============================================================================
// Workflow Resolution and Management
// ============================================================================

/**
 * Get workflow search directories
 * @returns {Array<{path: string, scope: string}>}
 */
function getWorkflowDirs() {
  return [
    { path: path.join(process.cwd(), '.surf', 'workflows'), scope: 'project' },
    { path: path.join(os.homedir(), '.surf', 'workflows'), scope: 'user' },
  ];
}

/**
 * Resolve a workflow by name or path
 * @param {string} nameOrPath - Workflow name or file path
 * @returns {{ type: 'inline'|'file'|'not_found', content?: string, path?: string, name?: string }}
 */
function resolveWorkflow(nameOrPath) {
  // Check if it's an inline workflow (contains pipe)
  if (nameOrPath.includes('|')) {
    return { type: 'inline', content: nameOrPath };
  }

  // Check if it's a direct file path (with extension or path separator)
  if (nameOrPath.includes('/') || nameOrPath.includes('\\') || nameOrPath.endsWith('.json')) {
    if (fs.existsSync(nameOrPath)) {
      return { type: 'file', path: nameOrPath };
    }
    return { type: 'not_found', name: nameOrPath };
  }

  // Look up by name in workflow directories
  const searchDirs = getWorkflowDirs();

  for (const { path: dir } of searchDirs) {
    const filePath = path.join(dir, `${nameOrPath}.json`);
    if (fs.existsSync(filePath)) {
      return { type: 'file', path: filePath };
    }
  }

  return { type: 'not_found', name: nameOrPath };
}

/**
 * List all available workflows
 * @returns {Array<{name: string, description: string, scope: string, path: string, args?: object}>}
 */
function listWorkflows() {
  const workflows = [];
  const searchDirs = getWorkflowDirs();

  for (const { path: dir, scope } of searchDirs) {
    if (fs.existsSync(dir)) {
      try {
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
        for (const file of files) {
          const filePath = path.join(dir, file);
          try {
            const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            workflows.push({
              name: content.name || file.replace('.json', ''),
              description: content.description || '',
              scope,
              path: filePath,
              args: content.args,
              stepCount: content.steps?.length || 0,
            });
          } catch {
            // Skip invalid JSON files
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    }
  }

  return workflows;
}

/**
 * Get detailed info about a workflow
 * @param {string} name - Workflow name
 * @returns {{ error?: string, name?: string, description?: string, args?: object, steps?: Array, path?: string }}
 */
function getWorkflowInfo(name) {
  const resolved = resolveWorkflow(name);

  if (resolved.type === 'not_found') {
    return { error: `Workflow not found: ${name}` };
  }

  if (resolved.type === 'inline') {
    return { error: 'Cannot get info for inline workflows' };
  }

  try {
    const content = JSON.parse(fs.readFileSync(resolved.path, 'utf8'));
    return {
      name: content.name || name,
      description: content.description || '',
      args: content.args || {},
      steps: content.steps || [],
      path: resolved.path,
    };
  } catch (e) {
    return { error: `Failed to parse workflow: ${e.message}` };
  }
}

/**
 * Validate workflow args against schema
 * @param {object} workflow - Workflow with args schema
 * @param {object} providedArgs - User-provided args
 * @returns {string[]} - Array of error messages
 */
function validateWorkflowArgs(workflow, providedArgs) {
  const errors = [];
  if (workflow.args) {
    for (const [name, spec] of Object.entries(workflow.args)) {
      if (spec.required && providedArgs[name] === undefined) {
        errors.push(`Missing required argument: --${name}`);
      }
    }
  }
  return errors;
}

/**
 * Apply default values to workflow args
 * @param {object} workflow - Workflow with args schema
 * @param {object} providedArgs - User-provided args
 * @returns {object} - Args with defaults applied
 */
function applyArgDefaults(workflow, providedArgs) {
  const vars = { ...providedArgs };
  if (workflow.args) {
    for (const [name, spec] of Object.entries(workflow.args)) {
      if (vars[name] === undefined && spec.default !== undefined) {
        vars[name] = spec.default;
      }
    }
  }
  return vars;
}

/**
 * Validate a workflow JSON file
 * @param {string} filePath - Path to workflow file
 * @returns {{ valid: boolean, error?: string, workflow?: object }}
 */
function validateWorkflowFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { valid: false, error: `File not found: ${filePath}` };
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const workflow = JSON.parse(content);

    // Basic structure validation
    if (!workflow.steps || !Array.isArray(workflow.steps)) {
      return { valid: false, error: "Workflow must have a 'steps' array" };
    }

    if (workflow.steps.length === 0) {
      return { valid: false, error: "Workflow has no steps" };
    }

    // Validate each step
    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];

      // Check for loops
      if (step.repeat !== undefined || step.each !== undefined) {
        if (!step.steps || !Array.isArray(step.steps)) {
          return { valid: false, error: `Step ${i + 1}: loop must have a 'steps' array` };
        }
        continue;
      }

      // Regular step must have tool/cmd
      if (!step.tool && !step.cmd) {
        return { valid: false, error: `Step ${i + 1}: must have 'tool' field` };
      }
    }

    // Validate args schema if present
    if (workflow.args && typeof workflow.args !== 'object') {
      return { valid: false, error: "'args' must be an object" };
    }

    return { valid: true, workflow };
  } catch (e) {
    return { valid: false, error: `Invalid JSON: ${e.message}` };
  }
}

/**
 * Format a step for display
 * @param {object} step - Workflow step
 * @param {number} indent - Indentation level
 * @returns {string}
 */
function formatStep(step, indent = 0) {
  const pad = '  '.repeat(indent);

  if (step.repeat !== undefined) {
    const lines = [`${pad}repeat ${step.repeat} times:`];
    for (const s of step.steps || []) {
      lines.push(formatStep(s, indent + 1));
    }
    if (step.until) {
      lines.push(`${pad}  until: ${step.until.tool || step.until.cmd}`);
    }
    return lines.join('\n');
  }

  if (step.each !== undefined) {
    const lines = [`${pad}each ${step.each} as ${step.as || 'item'}:`];
    for (const s of step.steps || []) {
      lines.push(formatStep(s, indent + 1));
    }
    return lines.join('\n');
  }

  const tool = step.tool || step.cmd;
  const args = step.args || {};
  const argStr = Object.entries(args)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' ');

  let line = `${pad}${tool}`;
  if (argStr) line += ` ${argStr}`;
  if (step.as) line += ` → ${step.as}`;

  return line;
}

// Cross-platform image resize (macOS: sips, Linux: ImageMagick)
function resizeImage(filePath, maxSize) {
  const platform = process.platform;

  try {
    if (platform === "darwin") {
      // macOS: use sips
      execSync(`sips --resampleHeightWidthMax ${maxSize} "${filePath}" --out "${filePath}" 2>/dev/null`, { stdio: "pipe" });
      const sizeInfo = execSync(`sips -g pixelWidth -g pixelHeight "${filePath}" 2>/dev/null`, { encoding: "utf8" });
      const width = parseInt(sizeInfo.match(/pixelWidth:\s*(\d+)/)?.[1] || "0", 10);
      const height = parseInt(sizeInfo.match(/pixelHeight:\s*(\d+)/)?.[1] || "0", 10);
      return { success: true, width, height };
    } else {
      // Linux/Windows: use ImageMagick (try IM6 first, then IM7)
      const resizeArg = IS_WIN ? `"${maxSize}x${maxSize}>"` : `${maxSize}x${maxSize}\\>`;
      try {
        execSync(`convert "${filePath}" -resize ${resizeArg} "${filePath}"`, { stdio: "pipe" });
      } catch {
        // IM7 uses 'magick' as main command
        execSync(`magick "${filePath}" -resize ${resizeArg} "${filePath}"`, { stdio: "pipe" });
      }
      // Get dimensions (IM7 may need 'magick identify' instead of just 'identify')
      let sizeInfo;
      try {
        sizeInfo = execSync(`identify -format "%w %h" "${filePath}"`, { encoding: "utf8" });
      } catch {
        sizeInfo = execSync(`magick identify -format "%w %h" "${filePath}"`, { encoding: "utf8" });
      }
      const [width, height] = sizeInfo.trim().split(" ").map(Number);
      return { success: true, width, height };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}
const args = process.argv.slice(2);

const ALIASES = {
  snap: "screenshot",
  read: "page.read",
  find: "search",
  go: "navigate",
  net: "network",
  "network.dump": "network.get",
};

const REMOVED_COMMANDS = {
  read_page: "page.read",
  get_page_text: "page.text",
  page_state: "page.state",
  list_tabs: "tab.list",
  new_tab: "tab.new",
  switch_tab: "tab.switch",
  close_tab: "tab.close",
  scroll_to: "scroll.to",
  scroll_to_position: "scroll.to",
  get_scroll_info: "scroll.info",
  wait_for_element: "wait.element",
  wait_for_url: "wait.url",
  wait_for_network_idle: "wait.network",
  javascript_tool: "js",
  read_console_messages: "console",
  read_network_requests: "network",
  tabs_context: "tab.list",
  tabs_create: "tab.new",
  tabs_register: "tab.name",
  tabs_unregister: "tab.unname",
  tabs_get_by_name: "tab.switch",
  tabs_list_named: "tab.named",
  upload_image: "upload",
  resize_window: "resize",
  type_submit: "type --submit",
  left_click: "click",
  right_click: "click --button right",
  double_click: "click --button double",
  triple_click: "click --button triple",
  left_click_drag: "drag",
};

const TOOLS = {
  ai: {
    desc: "AI assistants (ChatGPT, Gemini)",
    commands: {
      "chatgpt": {
        desc: "Send prompt to ChatGPT (uses browser cookies)",
        args: ["query"],
        opts: {
          "with-page": "Include current page context",
          model: "Model: gpt-4o, o1, etc.",
          file: "Attach file",
          timeout: "Timeout in seconds (default: 2700 = 45min)"
        },
        examples: [
          { cmd: 'chatgpt "explain this code"', desc: "Basic query" },
          { cmd: 'chatgpt "summarize" --with-page', desc: "With page context" },
          { cmd: 'chatgpt "review" --file code.ts', desc: "With file" },
          { cmd: 'chatgpt "analyze" --model gpt-4o', desc: "Specify model" },
        ]
      },
      "gemini": {
        desc: "Send prompt to Gemini (uses browser cookies)",
        args: ["query"],
        opts: {
          "with-page": "Include current page context",
          model: "Model: gemini-3-pro (default), gemini-2.5-pro, gemini-2.5-flash",
          file: "Attach file to analyze",
          "generate-image": "Generate image and save to path",
          "edit-image": "Edit existing image (use with --output)",
          output: "Output file path for image operations",
          youtube: "YouTube video URL to analyze",
          "aspect-ratio": "Aspect ratio for image generation (e.g., 1:1, 16:9)",
          timeout: "Timeout in seconds (default: 300)"
        },
        examples: [
          { cmd: 'gemini "explain quantum computing"', desc: "Basic query" },
          { cmd: 'gemini "summarize" --with-page', desc: "With page context" },
          { cmd: 'gemini "analyze" --file data.csv', desc: "With file attachment" },
          { cmd: 'gemini "a robot surfing" --generate-image /tmp/robot.png', desc: "Generate image" },
          { cmd: 'gemini "add sunglasses" --edit-image photo.jpg --output out.jpg', desc: "Edit image" },
          { cmd: 'gemini "summarize this video" --youtube "https://youtube.com/..."', desc: "YouTube analysis" },
        ]
      },
      "perplexity": {
        desc: "Search with Perplexity AI (uses browser session)",
        args: ["query"],
        opts: {
          "with-page": "Include current page context",
          mode: "Mode: search (default), research",
          model: "Model (Pro users): sonar, gpt-4o, claude, etc.",
          timeout: "Timeout in seconds (default: 120)"
        },
        examples: [
          { cmd: 'perplexity "what is quantum computing"', desc: "Basic search" },
          { cmd: 'perplexity "explain this page" --with-page', desc: "With page context" },
          { cmd: 'perplexity "deep dive into transformers" --mode research', desc: "Research mode" },
          { cmd: 'perplexity "latest AI news" --model sonar', desc: "Specify model (Pro)" },
        ]
      },
      "grok": {
        desc: "Query Grok AI with real-time X/Twitter data access (uses browser session)",
        args: ["query"],
        opts: {
          "with-page": "Include current page context",
          model: "Model: auto, fast (default), expert, grok-4.20-beta",
          "deep-search": "Enable DeepSearch for X post searching",
          timeout: "Timeout in seconds (default: 300)",
          validate: "Check Grok UI and scrape available models (no query sent)",
          "save-models": "Save discovered models to surf.json config"
        },
        examples: [
          { cmd: 'grok "what are the latest AI agent trends on X"', desc: "Search X posts" },
          { cmd: 'grok "analyze @username recent activity"', desc: "Profile analysis" },
          { cmd: 'grok "summarize this page" --with-page', desc: "With page context" },
          { cmd: 'grok "find viral AI posts" --deep-search', desc: "DeepSearch mode" },
          { cmd: 'grok "quick question" --model fast', desc: "Faster model" },
          { cmd: 'grok --validate', desc: "Check UI and list available models" },
          { cmd: 'grok --validate --save-models', desc: "Save discovered models to settings" },
        ]
      },
      "aistudio": {
        desc: "Query via Google AI Studio (uses browser session)",
        args: ["query"],
        opts: {
          "with-page": "Include current page context",
          model: "Model (best-effort): pass an AI Studio model id like gemini-3.1-pro-preview, gemini-3-flash-preview, gemini-flash-lite-latest. If invalid, AI Studio uses the last-selected UI model",
          timeout: "Timeout in seconds (default: 300)"
        },
        examples: [
          { cmd: 'aistudio "explain quantum computing"', desc: "Basic query" },
          { cmd: 'aistudio "redteam this" --with-page', desc: "With page context" },
          { cmd: 'aistudio "quick answer" --model gemini-3-flash-preview', desc: "Model selection" },
        ]
      },
      "aistudio.build": {
        desc: "Build an app via Google AI Studio App Builder (uses browser session)",
        args: ["query"],
        opts: {
          model: "Model override for Advanced Settings (e.g. gemini-3.1-pro-preview)",
          output: "Directory to extract the downloaded zip",
          timeout: "Build timeout in seconds (default: 600)",
          "keep-open": "Keep the AI Studio tab open after completion",
        },
        examples: [
          { cmd: 'aistudio.build "build a portfolio site"', desc: "Build with defaults" },
          { cmd: 'aistudio.build "todo app with auth" --model gemini-3.1-pro-preview', desc: "Build with model override" },
          { cmd: 'aistudio.build "crm dashboard" --output ./out', desc: "Build and extract to directory" },
        ]
      },
      "ai": {
        desc: "Analyze page with AI (requires GOOGLE_API_KEY)",
        args: ["query"],
        opts: { mode: "Query mode: find|summary|extract (auto-detected)" },
        examples: [
          { cmd: 'ai "find the login button"', desc: "Find element" },
          { cmd: 'ai "summarize this page"', desc: "Get summary" },
          { cmd: 'ai "extract all links as json"', desc: "Extract data" },
        ]
      },
    }
  },
  tab: {
    desc: "Tab management",
    commands: {
      "tab.list": { desc: "List all open tabs", args: [], examples: [{ cmd: "tab.list", desc: "Show all tabs" }] },
      "tab.new": {
        desc: "Open new tab",
        args: ["url"],
        opts: { urls: "Open multiple URLs" },
        examples: [
          { cmd: 'tab.new "https://google.com"', desc: "Open single tab" },
          { cmd: 'tab.new --urls "https://a.com" "https://b.com"', desc: "Open multiple" },
        ]
      },
      "tab.switch": {
        desc: "Switch to tab by ID or name",
        args: ["id"],
        examples: [
          { cmd: "tab.switch 123", desc: "Switch by ID" },
          { cmd: 'tab.switch "myTab"', desc: "Switch by name" },
        ]
      },
      "tab.close": {
        desc: "Close tab by ID or name",
        args: ["id"],
        opts: { ids: "Close multiple tabs" },
        examples: [{ cmd: "tab.close 123", desc: "Close tab" }]
      },
      "tab.name": {
        desc: "Register current tab with a name",
        args: ["name"],
        examples: [{ cmd: 'tab.name "dashboard"', desc: "Name current tab" }]
      },
      "tab.unname": { desc: "Unregister a named tab", args: ["name"] },
      "tab.named": { desc: "List all named tabs", args: [] },
      "tab.group": {
        desc: "Create/add to tab group",
        args: [],
        opts: { name: "Group name", tabs: "Tab IDs (comma-separated)", color: "Group color" },
        examples: [
          { cmd: 'tab.group --name "Work" --color blue', desc: "Group current tab" },
          { cmd: 'tab.group --name "Research" --tabs 1,2,3', desc: "Group multiple" },
        ]
      },
      "tab.ungroup": { desc: "Remove tabs from group", args: [], opts: { tabs: "Tab IDs (comma-separated)" } },
      "tab.groups": { desc: "List all tab groups", args: [] },
      "tab.reload": {
        desc: "Reload current tab",
        args: [],
        opts: { hard: "Bypass cache" },
        examples: [
          { cmd: "tab.reload", desc: "Soft reload" },
          { cmd: "tab.reload --hard", desc: "Hard reload (bypass cache)" },
        ]
      },
    }
  },
  nav: {
    desc: "Navigation",
    commands: {
      "navigate": {
        desc: "Go to URL",
        args: ["url"],
        examples: [{ cmd: 'navigate "https://example.com"', desc: "Go to URL" }]
      },
      "go": { desc: "Alias for navigate", args: ["url"], alias: "navigate" },
      "back": {
        desc: "Go back in history",
        args: [],
        examples: [{ cmd: "back", desc: "Browser back" }]
      },
      "forward": {
        desc: "Go forward in history",
        args: [],
        examples: [{ cmd: "forward", desc: "Browser forward" }]
      },
      "screenshot": {
        desc: "Capture screenshot (auto-saves to /tmp by default)",
        args: [],
        opts: {
          output: "Save to file",
          selector: "Capture specific element",
          annotate: "Draw element labels",
          fullpage: "Capture full page",
          "full-page": "Capture full page (alias for --fullpage)",
          "max-height": "Max height for fullpage (default: 4000)",
          full: "Skip resize, save at full resolution",
          "max-size": "Max dimension in px (default: 1200)",
          "no-save": "Don't auto-save, return base64 + ID (saves context)"
        },
        examples: [
          { cmd: "screenshot", desc: "Auto-save to /tmp (default)" },
          { cmd: "screenshot --output /tmp/shot.png", desc: "Save to specific file" },
          { cmd: "screenshot --no-save", desc: "Return base64 without saving" },
          { cmd: "screenshot --annotate", desc: "With element labels" },
          { cmd: "snap", desc: "Alias for screenshot" },
        ]
      },
      "record": {
        desc: "Capture screenshot frames over time and assemble an animated GIF",
        args: [],
        opts: {
          output: "GIF output path (default: /tmp/surf-record-*.gif)",
          duration: "Capture duration in ms (default: 2000, max: 10000)",
          fps: "Frames per second (default: 10, max: 30)",
          trigger: "Optional action before capture: click:<selector> or scroll:<target>",
          rect: "Crop rectangle x,y,width,height"
        },
        examples: [
          { cmd: "record --duration 2000 --fps 10 --output /tmp/anim.gif", desc: "Record a 2s GIF" },
          { cmd: 'record --trigger "click:#btn" --output /tmp/click.gif', desc: "Click, then record" },
        ]
      },
      "animate-audit": {
        desc: "Sample matching elements over time and return a JSON animation timeline",
        args: [],
        opts: {
          selector: "CSS selector to sample (required)",
          duration: "Capture duration in ms (default: 2000, max: 10000)",
          fps: "Samples per second (default: 10, max: 30)"
        },
        examples: [
          { cmd: 'animate-audit --selector ".thing" --duration 2000 --fps 10', desc: "Capture a bounded JSON timeline" },
        ]
      },
      "perf-audit": {
        desc: "Capture layout shift, event, long task, and animation-frame performance entries",
        args: [],
        opts: {
          duration: "Capture duration in ms (default: 3000, max: 10000)",
          trigger: "Optional action before capture: click:<selector> or scroll:<target>",
          output: "Save JSON to file"
        },
        examples: [
          { cmd: 'perf-audit --duration 3000 --trigger "click:.cta" --output /tmp/perf.json', desc: "Capture a performance snapshot" },
        ]
      },
      "snap": { desc: "Alias for screenshot (auto-saves to /tmp)", args: [], alias: "screenshot" },
    }
  },
  scroll: {
    desc: "Scrolling",
    commands: {
      "scroll": {
        desc: "Scroll in direction",
        args: ["direction", "pixels"],
        opts: { direction: "up|down|left|right", amount: "Scroll amount (1-10)" },
        examples: [
          { cmd: "scroll down 800", desc: "Scroll down 800px" },
          { cmd: "scroll --direction down --amount 3", desc: "Scroll down" },
        ]
      },
      "scroll.top": { desc: "Scroll to top of page", args: [], opts: { selector: "Target specific container" } },
      "scroll.bottom": { desc: "Scroll to bottom of page", args: [], opts: { selector: "Target specific container" } },
      "scroll.to": {
        desc: "Scroll element into view",
        args: [],
        opts: { ref: "Element ref" },
        examples: [{ cmd: "scroll.to --ref e5", desc: "Scroll to element" }]
      },
      "scroll.info": { desc: "Get scroll position info", args: [], opts: { selector: "Target specific container" } },
    }
  },
  page: {
    desc: "Page inspection",
    commands: {
      "page.read": {
        desc: "Get accessibility tree + visible text",
        args: [],
        opts: {
          all: "Include all elements",
          ref: "Get specific element",
          "no-text": "Exclude visible text content",
          depth: "Maximum tree depth (default: unlimited)",
          compact: "Remove empty structural elements",
        },
        examples: [
          { cmd: "page.read", desc: "Interactive elements + text content" },
          { cmd: "page.read --all", desc: "All elements + text" },
          { cmd: "page.read --no-text", desc: "Interactive elements only (no text)" },
          { cmd: "page.read --depth 3", desc: "Limit to 3 levels deep" },
          { cmd: "page.read --compact", desc: "Skip empty containers" },
          { cmd: "page.read --depth 3 --compact", desc: "Shallow + compact (60% smaller)" },
          { cmd: "read", desc: "Alias" },
        ]
      },
      "read": { desc: "Alias for page.read", args: [], alias: "page.read" },
      "page.text": { desc: "Extract all text from page", args: [] },
      "page.state": { desc: "Get page state (modals, loading, etc.)", args: [] },
    }
  },
  locate: {
    desc: "Semantic element location",
    commands: {
      "locate.role": {
        desc: "Find element by ARIA role",
        args: ["role"],
        opts: {
          name: "Element name/text",
          action: "Action to perform (click|fill|hover|text)",
          value: "Value for fill action",
          all: "Return all matches"
        },
        examples: [
          { cmd: 'locate.role button --name "Submit" --action click', desc: "Click button by name" },
          { cmd: 'locate.role textbox --name "Email" --action fill --value "test@test.com"', desc: "Fill input" },
          { cmd: 'locate.role link --all', desc: "List all links with refs" },
        ]
      },
      "locate.text": {
        desc: "Find element by text content",
        args: ["text"],
        opts: {
          exact: "Exact match",
          action: "Action to perform",
          value: "Value for fill action"
        },
        examples: [
          { cmd: 'locate.text "Sign In" --action click', desc: "Click by text" },
          { cmd: 'locate.text "Accept" --exact --action click', desc: "Exact text match" },
        ]
      },
      "locate.label": {
        desc: "Find form field by label",
        args: ["label"],
        opts: {
          action: "Action to perform",
          value: "Value for fill action"
        },
        examples: [
          { cmd: 'locate.label "Username" --action fill --value "john"', desc: "Fill by label" },
        ]
      },
    }
  },
  element: {
    desc: "Element inspection",
    commands: {
      "element.styles": {
        desc: "Get computed styles from element(s)",
        args: ["ref_or_selector"],
        examples: [
          { cmd: "element.styles e5", desc: "Get styles by ref" },
          { cmd: 'element.styles ".header"', desc: "Get styles by selector (can return multiple)" },
        ]
      },
    }
  },
  forms: {
    desc: "Form interactions",
    commands: {
      "select": {
        desc: "Select option(s) in dropdown",
        args: ["ref_or_selector", "values..."],
        opts: {
          by: "Match by: value (default), label, index"
        },
        examples: [
          { cmd: 'select e5 "US"', desc: "Select by value" },
          { cmd: 'select e5 "opt1" "opt2"', desc: "Multi-select" },
          { cmd: 'select e5 --by label "United States"', desc: "Select by visible text" },
          { cmd: 'select e5 --by index 0', desc: "Select first option" },
        ]
      },
    }
  },
  wait: {
    desc: "Waiting",
    commands: {
      "wait": {
        desc: "Wait N seconds",
        args: ["duration"],
        examples: [{ cmd: "wait 2", desc: "Wait 2 seconds" }]
      },
      "wait.element": {
        desc: "Wait for element to appear",
        args: ["selector"],
        opts: { timeout: "Timeout in ms" },
        examples: [
          { cmd: 'wait.element ".loading"', desc: "Wait for element" },
          { cmd: 'wait.element "#result" --timeout 10000', desc: "With timeout" },
        ]
      },
      "wait.network": { desc: "Wait for network idle", args: [], opts: { timeout: "Timeout in ms" } },
      "wait.url": {
        desc: "Wait for URL to match",
        args: ["pattern"],
        opts: { timeout: "Timeout in ms" },
        examples: [{ cmd: 'wait.url "/dashboard"', desc: "Wait for URL pattern" }]
      },
      "wait.dom": { desc: "Wait for DOM to stabilize", args: [], opts: { stable: "Stability window in ms (default: 100)", timeout: "Max wait time in ms" } },
      "wait.load": { desc: "Wait for page to fully load", args: [], opts: { timeout: "Max wait time in ms (default: 30000)" } },
    }
  },
  input: {
    desc: "Input actions",
    commands: {
      "click": {
        desc: "Click element or coordinates",
        args: ["ref"],
        opts: {
          ref: "Element ref",
          x: "X coordinate",
          y: "Y coordinate",
          button: "left|right|double|triple",
          selector: "CSS selector",
          index: "Which match (0-indexed) for selector",
        },
        examples: [
          { cmd: "click e5", desc: "Click by ref" },
          { cmd: 'click --selector ".btn"', desc: "Click by selector" },
          { cmd: 'click --selector ".item" --index 2', desc: "Click 3rd match" },
          { cmd: "click --x 100 --y 200", desc: "Click coordinates" },
        ]
      },
      "type": {
        desc: "Type text (uses form.fill when --ref provided for better modal/form support)",
        args: ["text"],
        opts: {
          into: "Target selector",
          ref: "Element ref (uses JS DOM method, more reliable for modals)",
          submit: "Press enter after",
          clear: "Clear first",
          method: "cdp|js (default: cdp, but ref uses JS automatically)"
        },
        examples: [
          { cmd: 'type "hello world"', desc: "Type at cursor (CDP events)" },
          { cmd: 'type "user@example.com" --ref e5', desc: "Type into element by ref (JS DOM)" },
          { cmd: 'type "search query" --submit', desc: "Type and press Enter" },
        ]
      },
      "smart_type": { desc: "Type into specific element (js method)", args: [], opts: { selector: "CSS selector", text: "Text to type", clear: "Clear first (default: true)", submit: "Submit after" } },
      "key": {
        desc: "Press key",
        args: ["key"],
        examples: [
          { cmd: "key Enter", desc: "Press Enter" },
          { cmd: "key Escape", desc: "Press Escape" },
          { cmd: "key cmd+a", desc: "Select all (Mac)" },
          { cmd: "key ctrl+shift+p", desc: "Key combo" },
        ]
      },
      "hover": { desc: "Hover over element", args: [], opts: { ref: "Element ref", x: "X coordinate", y: "Y coordinate" } },
      "drag": { desc: "Drag between points", args: [], opts: { from: "Start x,y", to: "End x,y" } },
    }
  },
  js: {
    desc: "JavaScript execution",
    commands: {
      "js": {
        desc: "Execute JavaScript (use 'return' for values)",
        args: ["code"],
        opts: { file: "Run JS from file" },
        examples: [
          { cmd: 'js "return document.title"', desc: "Get title" },
          { cmd: 'js "document.body.style.background = \'red\'"', desc: "Run code" },
          { cmd: "js --file script.js", desc: "Run file" },
        ]
      },
    }
  },
  dev: {
    desc: "Dev tools",
    commands: {
      "console": {
        desc: "Read console messages",
        args: [],
        opts: { clear: "Clear after reading", stream: "Continuous output", level: "Filter by level (log,warn,error)", limit: "Max messages" },
        examples: [
          { cmd: "console", desc: "Get recent messages" },
          { cmd: "console --level error", desc: "Only errors" },
          { cmd: "console --stream", desc: "Stream live" },
        ]
      },
    }
  },
  network: {
    desc: "Network capture",
    commands: {
      "network": {
        desc: "List captured network requests",
        args: [],
        opts: {
          origin: "Filter by origin (domain)",
          method: "Filter by method (GET,POST,...)",
          status: "Filter by status (200, 4xx, 5xx)",
          type: "Filter by content type (json, html, proto)",
          since: "Show requests since (5m, 1h, timestamp)",
          last: "Show last N requests",
          "has-body": "Only requests with body",
          "exclude-static": "Exclude images/fonts/css/js",
          filter: "URL pattern filter",
          format: "Output format: compact, urls, curl, raw",
          all: "Show all (no limit)",
          v: "Verbose output",
          vv: "Very verbose output",
          clear: "Clear after reading",
          stream: "Continuous output"
        },
        examples: [
          { cmd: "network", desc: "Show recent requests" },
          { cmd: "network --origin api.github.com", desc: "Filter by origin" },
          { cmd: "network --method POST --type json", desc: "POST JSON requests" },
          { cmd: "network --format curl", desc: "Output as curl commands" },
          { cmd: "network -v", desc: "Verbose with headers" },
        ]
      },
      "network.get": {
        desc: "Get full details for a request",
        args: ["id"],
        opts: {},
        examples: [
          { cmd: "network.get r_001", desc: "Get request details" }
        ]
      },
      "network.body": {
        desc: "Get response body (for piping)",
        args: ["id"],
        opts: { request: "Get request body instead" },
        examples: [
          { cmd: "network.body r_001", desc: "Get response body" },
          { cmd: "network.body r_001 | jq .", desc: "Pipe JSON to jq" }
        ]
      },
      "network.curl": {
        desc: "Generate curl command for request",
        args: ["id"],
        opts: {},
        examples: [
          { cmd: "network.curl r_001", desc: "Generate curl" }
        ]
      },
      "network.origins": {
        desc: "List captured origins with stats",
        args: [],
        opts: { "by-tab": "Group by tab" },
        examples: [
          { cmd: "network.origins", desc: "List origins" }
        ]
      },
      "network.clear": {
        desc: "Clear captured requests",
        args: [],
        opts: { before: "Clear before timestamp/duration", origin: "Clear specific origin" },
        examples: [
          { cmd: "network.clear", desc: "Clear all" },
          { cmd: "network.clear --before 1h", desc: "Clear older than 1 hour" }
        ]
      },
      "network.stats": {
        desc: "Show capture statistics",
        args: [],
        opts: {},
        examples: [
          { cmd: "network.stats", desc: "Show stats" }
        ]
      },
      "network.export": {
        desc: "Export captured requests",
        args: [],
        opts: { jsonl: "Export as JSONL", output: "Output file path" },
        examples: [
          { cmd: "network.export --jsonl --output /tmp/requests.jsonl", desc: "Export as JSONL" }
        ]
      },
      "network.path": {
        desc: "Get file paths for request data",
        args: ["id"],
        opts: {},
        examples: [
          { cmd: "network.path r_001", desc: "Get file paths" }
        ]
      },
    }
  },
  health: {
    desc: "Health checks",
    commands: {
      "doctor": {
        desc: "Diagnose native host manifests and socket connectivity",
        args: [],
        opts: { browser: "Browser to inspect (default: chrome)", target: "auto|linux|windows", socket: "Socket path to check", json: "Raw diagnostic JSON" },
        examples: [
          { cmd: "doctor", desc: "Check default Chrome setup" },
          { cmd: "doctor --browser all", desc: "Check all supported browsers" },
          { cmd: "doctor --json", desc: "Machine-readable diagnostics" },
        ]
      },
      "health": {
        desc: "Wait for URL or element",
        args: [],
        opts: { url: "URL to check (expects 200)", selector: "CSS selector to wait for", expect: "Expected status code (default: 200)", timeout: "Timeout in ms" },
        examples: [
          { cmd: 'health --url "https://api.example.com"', desc: "Check URL" },
          { cmd: 'health --selector ".loaded"', desc: "Wait for element" },
        ]
      },
    }
  },
  smoke: {
    desc: "Smoke testing",
    commands: {
      "smoke": { desc: "Run smoke tests on URLs", args: [], opts: { urls: "URLs to test (space-separated)", routes: "Route group from config", screenshot: "Directory to save screenshots", "fail-fast": "Stop on first error" } },
    }
  },
  dialog: {
    desc: "Browser dialog handling",
    commands: {
      "dialog.accept": { desc: "Accept current dialog", args: [], opts: { text: "Text for prompt input" } },
      "dialog.dismiss": {
        desc: "Dismiss current dialog",
        args: [],
        opts: { all: "Dismiss all dialogs repeatedly" },
        examples: [
          { cmd: "dialog.dismiss", desc: "Dismiss once" },
          { cmd: "dialog.dismiss --all", desc: "Dismiss all" },
        ]
      },
      "dialog.info": { desc: "Get current dialog info", args: [] },
    }
  },
  emulate: {
    desc: "Device/network emulation",
    commands: {
      "emulate.network": { desc: "Emulate network conditions", args: ["preset"], opts: {} },
      "emulate.cpu": { desc: "CPU throttling (rate >= 1)", args: ["rate"], opts: {} },
      "emulate.geo": { desc: "Override geolocation", args: [], opts: { lat: "Latitude", lon: "Longitude", accuracy: "Accuracy in meters (default: 100)", clear: "Clear override" } },
      "emulate.device": {
        desc: "Emulate mobile device",
        args: ["device"],
        opts: { list: "List available devices" },
        examples: [
          { cmd: 'emulate.device "iPhone 14"', desc: "Emulate iPhone" },
          { cmd: 'emulate.device "Pixel 7"', desc: "Emulate Pixel" },
          { cmd: "emulate.device --list", desc: "Show all devices" },
          { cmd: 'emulate.device "reset"', desc: "Return to desktop" },
        ]
      },
      "emulate.viewport": {
        desc: "Set custom viewport",
        args: [],
        opts: { width: "Viewport width", height: "Viewport height", scale: "Device scale factor", mobile: "Enable mobile mode" },
        examples: [
          { cmd: "emulate.viewport --width 375 --height 812", desc: "iPhone size" },
          { cmd: "emulate.viewport --width 1920 --height 1080 --scale 2", desc: "Retina display" },
        ]
      },
      "emulate.touch": {
        desc: "Enable/disable touch emulation",
        args: [],
        opts: { enabled: "Enable touch (default: true)" },
        examples: [
          { cmd: "emulate.touch", desc: "Enable touch" },
          { cmd: "emulate.touch --enabled false", desc: "Disable touch" },
        ]
      },
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
      "upload": {
        desc: "Upload file(s) to input",
        args: [],
        opts: { ref: "Element ref", files: "File path(s) comma-separated" },
        examples: [{ cmd: 'upload --ref e5 --files "/path/to/file.pdf"', desc: "Upload file" }]
      },
    }
  },
  frame: {
    desc: "Iframe handling",
    commands: {
      "frame.list": {
        desc: "List all frames in page",
        args: [],
        examples: [{ cmd: "frame.list", desc: "Show frame tree" }]
      },
      "frame.switch": {
        desc: "Switch to iframe context",
        args: [],
        opts: {
          selector: "Frame CSS selector",
          name: "Frame name attribute",
          index: "Frame index (0-based)"
        },
        examples: [
          { cmd: 'frame.switch --selector "#payment-iframe"', desc: "Switch by selector" },
          { cmd: 'frame.switch --name "payment"', desc: "Switch by name" },
          { cmd: "frame.switch --index 0", desc: "Switch to first frame" },
        ]
      },
      "frame.main": {
        desc: "Return to main frame",
        args: [],
        examples: [{ cmd: "frame.main", desc: "Exit iframe context" }]
      },
      "frame.js": {
        desc: "Execute JS in specific frame",
        args: ["code"],
        opts: { id: "Frame ID from frame.list", file: "Run JS from file" },
        examples: [
          { cmd: 'frame.js "return document.title" --id frame1', desc: "JS in specific frame" },
        ]
      },
    }
  },
  cookie: {
    desc: "Cookie management",
    commands: {
      "cookie.list": {
        desc: "List all cookies for current tab's domain",
        args: [],
        examples: [
          { cmd: "cookie list", desc: "Show all cookies" },
          { cmd: "cookie.list", desc: "Dot command form" },
        ]
      },
      "cookie.get": {
        desc: "Get specific cookie",
        args: [],
        opts: { name: "Cookie name" },
        examples: [{ cmd: "cookie get session", desc: "Get cookie" }]
      },
      "cookie.set": {
        desc: "Set a cookie",
        args: [],
        opts: { name: "Cookie name", value: "Cookie value", expires: "Expiry date (optional)" },
        examples: [
          { cmd: 'cookie set --name "session" --value "abc123"', desc: "Set cookie" },
          { cmd: 'cookie.set --name "session" --value "abc123"', desc: "Dot command form" },
        ]
      },
      "cookie.clear": {
        desc: "Clear cookies",
        args: [],
        opts: { name: "Specific cookie (optional)", all: "Clear all for domain" },
        examples: [
          { cmd: 'cookie delete "session"', desc: "Clear one" },
          { cmd: "cookie clear --all", desc: "Clear all" },
          { cmd: 'cookie.clear --name "session"', desc: "Dot command form" },
        ]
      },
    }
  },
  search: {
    desc: "Text search",
    commands: {
      "search": {
        desc: "Search for text in page",
        args: ["term"],
        opts: { "case-sensitive": "Case-sensitive match", limit: "Max results" },
        examples: [
          { cmd: 'search "login"', desc: "Find text" },
          { cmd: 'search "Error" --case-sensitive', desc: "Case sensitive" },
          { cmd: 'find "button"', desc: "Using alias" },
        ]
      },
      "find": { desc: "Alias for search", args: ["term"], alias: "search" },
    }
  },
  batch: {
    desc: "Batch execution",
    commands: {
      "batch": {
        desc: "Execute multiple actions",
        args: [],
        opts: { actions: "JSON array of actions", file: "Path to actions JSON file" },
        examples: [
          { cmd: 'batch --actions \'[{"type":"click","ref":"e1"},{"type":"wait","ms":500}]\'', desc: "Inline actions" },
          { cmd: "batch --file workflow.json", desc: "From file" },
        ]
      },
    }
  },
  workflow: {
    desc: "Workflow execution and management",
    commands: {
      "do": {
        desc: "Execute multiple commands as a single workflow",
        args: ["commands"],
        opts: {
          file: "Load workflow from JSON file",
          "on-error": "stop (default) | continue",
          "no-auto-wait": "Disable automatic waits between steps",
          "step-delay": "Delay between steps in ms (default: 100)",
          "dry-run": "Parse and validate without executing"
        },
        examples: [
          { cmd: 'do \'go "https://example.com" | click e5 | screenshot\'', desc: "Inline workflow" },
          { cmd: 'do -f login.json', desc: "From JSON file" },
          { cmd: 'do github-login --email "x" --password "y"', desc: "Named workflow with args" },
          { cmd: 'do \'go "url" | click e5\' --dry-run', desc: "Validate without running" },
        ]
      },
      "workflow.list": {
        desc: "List available workflows",
        args: [],
        opts: {},
        examples: [
          { cmd: 'workflow.list', desc: "Show all workflows" },
        ]
      },
      "workflow.info": {
        desc: "Show workflow details and arguments",
        args: ["name"],
        opts: {},
        examples: [
          { cmd: 'workflow.info github-login', desc: "Show workflow details" },
        ]
      },
      "workflow.validate": {
        desc: "Validate workflow JSON file",
        args: ["file"],
        opts: {},
        examples: [
          { cmd: 'workflow.validate ./my-flow.json', desc: "Check JSON validity" },
        ]
      },
    }
  },
  zoom: {
    desc: "Zoom control",
    commands: {
      "zoom": {
        desc: "Get or set zoom level",
        args: [],
        opts: { level: "Zoom level (e.g., 1.5 for 150%)", reset: "Reset to default zoom" },
        examples: [
          { cmd: "zoom", desc: "Get current zoom" },
          { cmd: "zoom 1.5", desc: "Set to 150%" },
          { cmd: "zoom --reset", desc: "Reset to 100%" },
        ]
      },
    }
  },
  resize: {
    desc: "Window management",
    commands: {
      "resize": {
        desc: "Resize browser window",
        args: ["width", "height"],
        opts: { width: "Window width", height: "Window height" },
        examples: [
          { cmd: "resize 1280 720", desc: "Set size" },
          { cmd: "resize --width 1280 --height 720", desc: "Set size with flags" },
        ]
      },
    }
  },
  bookmark: {
    desc: "Bookmark management",
    commands: {
      "bookmark.add": { desc: "Bookmark current page", args: [], opts: { folder: "Folder name" } },
      "bookmark.remove": { desc: "Remove bookmark for current page", args: [] },
      "bookmark.list": { desc: "List bookmarks", args: [], opts: { folder: "Folder name", limit: "Max results" } },
    }
  },
  history: {
    desc: "Browser history",
    commands: {
      "history.list": {
        desc: "Recent history",
        args: [],
        opts: { limit: "Max results" },
        examples: [{ cmd: "history.list --limit 20", desc: "Last 20 items" }]
      },
      "history.search": {
        desc: "Search history",
        args: ["query"],
        examples: [{ cmd: 'history.search "github"', desc: "Search history" }]
      },
    }
  },
  window: {
    desc: "Window management (isolate agent from your browsing)",
    commands: {
      "window.new": {
        desc: "Create new browser window",
        args: ["url"],
        opts: {
          width: "Window width",
          height: "Window height",
          incognito: "Open incognito window",
          unfocused: "Don't focus the new window"
        },
        examples: [
          { cmd: 'window.new "https://example.com"', desc: "New window with URL" },
          { cmd: 'window.new --width 1280 --height 720', desc: "Sized window" },
          { cmd: 'window.new --incognito', desc: "Incognito window" },
        ]
      },
      "window.list": {
        desc: "List all browser windows",
        args: [],
        opts: { tabs: "Include tab details" },
        examples: [{ cmd: "window.list", desc: "Show all windows" }]
      },
      "window.focus": {
        desc: "Focus a window by ID",
        args: ["id"],
        examples: [{ cmd: "window.focus 123", desc: "Focus window" }]
      },
      "window.close": {
        desc: "Close a window by ID",
        args: ["id"],
        examples: [{ cmd: "window.close 123", desc: "Close window" }]
      },
      "window.resize": {
        desc: "Resize or reposition a window",
        args: [],
        opts: {
          id: "Window ID (required)",
          width: "Window width",
          height: "Window height",
          left: "Window X position",
          top: "Window Y position",
          state: "Window state: normal, minimized, maximized, fullscreen"
        },
        examples: [
          { cmd: "window.resize --id 123 --width 1920 --height 1080", desc: "Resize" },
          { cmd: "window.resize --id 123 --left 0 --top 0", desc: "Move to corner" },
          { cmd: "window.resize --id 123 --state maximized", desc: "Maximize" },
        ]
      },
    }
  },
};

const HELP_TOPICS = {
  refs: {
    title: "Element References",
    content: `Element refs (e1, e2, e3...) are stable identifiers from page.read.

Usage:
  1. Run page.read to get the accessibility tree
  2. Find elements with refs like [e5] button "Submit"
  3. Use the ref: click e5, scroll.to --ref e5, type "text" --ref e5

Refs are more reliable than selectors for dynamic pages.`
  },
  selectors: {
    title: "CSS Selectors",
    content: `Use CSS selectors when you know the element's structure.

Examples:
  click --selector "#submit-btn"
  click --selector ".btn-primary"
  click --selector "[data-testid='login']"
  click --selector "button:contains('Submit')"
  wait.element ".loading-spinner"

Use --index to select from multiple matches:
  click --selector ".item" --index 2   # 3rd match (0-indexed)`
  },
  cookies: {
    title: "Cookie Management",
    content: `Cookies are scoped to the current tab's domain.

Commands:
  cookie list           List all cookies
  cookie get X          Get specific cookie
  cookie set            Set a cookie
  cookie clear --all    Clear all cookies
  cookie delete X       Clear one cookie

Dot commands remain supported:
  cookie.list
  cookie.get --name X
  cookie.set
  cookie.clear

Notes:
  - HttpOnly cookies are accessible
  - Use --expires with ISO date: "2025-12-31T00:00:00Z"`
  },
  batch: {
    title: "Batch Execution",
    content: `Run multiple actions in sequence.

JSON format:
  [
    {"type": "click", "ref": "e1"},
    {"type": "wait", "ms": 500},
    {"type": "type", "text": "hello"},
    {"type": "key", "key": "Enter"}
  ]

Supported types: click, type, key, wait, scroll, screenshot, navigate

Options:
  --actions '[...]'    Inline JSON
  --file workflow.json Load from file`
  },
  screenshots: {
    title: "Screenshots",
    content: `Capture screenshots with various options.

Commands:
  screenshot --output file.png                          Basic screenshot
  screenshot --annotate --output file.png               With element labels
  screenshot --fullpage --output file.png               Full page capture
  screenshot --full-page --output file.png              Full page capture (alias)
  screenshot --annotate --fullpage --output file.png    Full page with labels
  snap                                                  Auto-save to /tmp

Options:
  --output      Save path
  --annotate    Draw element refs
  --fullpage    Capture entire page
  --full-page   Capture entire page (alias)
  --max-height  Max height for fullpage (default: 4000)`
  },
  automation: {
    title: "Automation Patterns",
    content: `Common automation patterns:

Wait for page load:
  navigate "https://example.com"
  wait.load

Fill a form:
  type "user@email.com" --into "#email"
  type "password123" --into "#password"
  click --selector "button[type=submit]"

Wait for dynamic content:
  click e5
  wait.element ".results"
  page.read

Scroll and capture:
  scroll.bottom
  screenshot --full-page --output full.png`
  },
  windows: {
    title: "Window Isolation",
    content: `Keep agent work separate from your browsing.

Create a dedicated window:
  surf window.new "https://example.com"
  # Returns: Window 123 (tab 456)
  # Use --window-id 123 to target this window

All commands in that window:
  surf navigate "https://other.com" --window-id 123
  surf read --window-id 123
  surf click e5 --window-id 123
  surf screenshot --output /tmp/shot.png --window-id 123

Manage windows:
  surf window.list              # List all windows
  surf window.list --tabs       # Include tab details
  surf window.focus 123         # Bring window to front
  surf window.close 123         # Close when done

Tips:
  - Agent commands won't affect your active browser window
  - If window has no usable tabs, one is auto-created
  - Use window.new --incognito for isolated cookies`
  },
  semantic: {
    title: "Semantic Locators",
    content: `Find elements by role, text, or label instead of refs or selectors.

By ARIA role:
  locate.role button --name "Submit" --action click
  locate.role textbox --name "Email" --action fill --value "test@test.com"
  locate.role link --all                              # List all links

By text content:
  locate.text "Sign In" --action click
  locate.text "Accept" --exact --action click         # Exact match

By form label:
  locate.label "Username" --action fill --value "john"
  locate.label "Password" --action fill --value "secret"

Available actions: click, fill, hover, text
Without --action, returns the ref for later use.`
  },
  frames: {
    title: "Iframe Navigation",
    content: `Work with embedded iframes.

List frames:
  frame.list                    # Show frame tree with IDs

Switch context:
  frame.switch --selector "#payment-iframe"
  frame.switch --name "checkout"
  frame.switch --index 0        # First iframe

Return to main:
  frame.main

Execute JS in frame:
  frame.js "return document.title" --id frame1

After frame.switch, subsequent commands target that frame context.`
  },
  devices: {
    title: "Device Emulation",
    content: `Test responsive designs and mobile views.

Emulate a device:
  emulate.device "iPhone 14"
  emulate.device "Pixel 7"
  emulate.device --list         # Show all devices
  emulate.device "reset"        # Return to desktop

Custom viewport:
  emulate.viewport --width 375 --height 812
  emulate.viewport --width 1920 --height 1080 --scale 2

Touch events:
  emulate.touch                 # Enable touch
  emulate.touch --enabled false # Disable

Popular devices: iPhone 14, iPhone SE, iPad, iPad Pro,
Pixel 7, Galaxy S23, Nest Hub`
  },
  optimization: {
    title: "Token Optimization",
    content: `Reduce output size for LLM efficiency.

Limit tree depth:
  page.read --depth 3           # Max 3 levels deep

Skip empty containers:
  page.read --compact           # Remove empty structural elements

Combine for best results:
  page.read --depth 3 --compact # ~60% smaller output

Filter to interactive only:
  page.read                     # Default: interactive elements only
  page.read --all               # Include all elements

Exclude text content:
  page.read --no-text           # Skip visible text section`
  },
};

const ALL_SOCKET_TOOLS = [
  "ai", "screenshot", "record", "animate-audit", "perf-audit", "navigate",
  "form_input", "find_and_type", "autocomplete", "set_value", "smart_type",
  "scroll_to_position", "get_scroll_info", "close_dialogs", "page_state",
  "javascript_tool", "health", "smoke",
  "click_type", "click_type_submit", "type", "key", "type_submit",
  "scroll", "scroll_to", "hover", "left_click_drag", "drag", "wait",
  "computer",
  "page.read", "page.text", "page.state",
  "locate.role", "locate.text", "locate.label",
  "tab.list", "tab.new", "tab.switch", "tab.close", "tab.name", "tab.unname", "tab.named",
  "tab.group", "tab.ungroup", "tab.groups", "tab.reload",
  "scroll.top", "scroll.bottom", "scroll.to", "scroll.info",
  "wait.element", "wait.network", "wait.url", "wait.dom", "wait.load",
  "click", "hover", "drag",
  "js", "console", "network",
  "network.get", "network.body", "network.curl", "network.origins",
  "network.clear", "network.stats", "network.export", "network.path",
  "dialog.accept", "dialog.dismiss", "dialog.info",
  "emulate.network", "emulate.cpu", "emulate.geo", "emulate.device", "emulate.viewport", "emulate.touch",
  "form.fill",
  "perf.start", "perf.stop", "perf.metrics",
  "upload",
  "frame.list", "frame.switch", "frame.main", "frame.js",
  "cookie.list", "cookie.get", "cookie.set", "cookie.clear",
  "search", "batch",
  "zoom", "resize",
  "back", "forward",
  "bookmark.add", "bookmark.remove", "bookmark.list",
  "history.list", "history.search",
  "window.new", "window.list", "window.focus", "window.close", "window.resize",
];

// See also suggestions for related commands
const SEE_ALSO = {
  "click": ["locate.role", "locate.text", "page.read"],
  "type": ["locate.label", "form.fill", "smart_type"],
  "page.read": ["--depth for smaller output", "--compact to skip empty containers", "page.text"],
  "locate.role": ["locate.text", "locate.label", "click --selector"],
  "locate.text": ["locate.role", "locate.label", "search"],
  "locate.label": ["locate.role", "form.fill"],
  "tab.list": ["window.list"],
  "tab.new": ["window.new for isolation"],
  "window.new": ["window.list"],
  "window.list": ["tab.list"],
  "frame.list": ["frame.switch", "frame.main"],
  "frame.switch": ["frame.list", "frame.main", "frame.js"],
  "frame.main": ["frame.list", "frame.switch"],
  "frame.js": ["frame.switch", "js"],
  "emulate.network": ["emulate.device", "emulate.cpu"],
  "emulate.device": ["emulate.viewport", "emulate.touch"],
  "emulate.viewport": ["emulate.device", "emulate.touch"],
  "emulate.touch": ["emulate.device", "emulate.viewport"],
  "emulate.cpu": ["emulate.network", "perf.metrics"],
  "perf.start": ["perf.stop", "perf.metrics"],
  "perf.stop": ["perf.start", "perf.metrics"],
  "perf.metrics": ["perf.start", "console", "network"],
  "navigate": ["wait.load", "page.read"],
  "screenshot": ["page.read", "scroll.bottom for fullpage"],
  "record": ["screenshot", "animate-audit", "perf-audit"],
  "animate-audit": ["screenshot", "record", "perf-audit", "js"],
  "perf-audit": ["record", "animate-audit", "perf.metrics", "console"],
  "search": ["locate.text", "page.read"],
  "wait.element": ["wait.load", "wait.network"],
  "wait.load": ["wait.element", "wait.network"],
  "wait.network": ["wait.load", "wait.element"],
  "scroll.to": ["click", "page.read"],
  "console": ["network", "perf.metrics"],
  "network": ["console", "network.get"],
};

const showBasicHelp = () => {
  console.log(`surf v${VERSION} - Browser automation CLI

Usage: surf <command> [args] [options]

Common Commands:
  navigate <url>     Go to URL (alias: go)
  click <ref>        Click element by ref or selector
  type <text>        Type text at cursor or into element
  screenshot         Capture screenshot (alias: snap)
  record             Capture screenshot frames into an animated GIF
  animate-audit      JSON timeline of element animation/style samples
  perf-audit         PerformanceObserver snapshot for motion/jank debugging
  page.read          Get page accessibility tree (alias: read)
  locate.role <role> Find element by ARIA role
  search <term>      Search for text in page (alias: find)
  window.new <url>   Create isolated browser window
  doctor             Diagnose native host/socket setup
  wait <seconds>     Wait N seconds

Quick Examples:
  surf go "https://example.com"
  surf read
  surf click e5
  surf type "hello" --submit
  surf locate.role button --name "Submit" --action click
  surf read --depth 3 --compact
  surf emulate.device "iPhone 14"
  surf window.new "https://example.com" && surf --window-id 123 go "https://other.com"

More Help:
  surf --help-full           All commands
  surf --llm-context         Compact reference for AI agents
  surf --help-topic <topic>  Topic guide (refs, semantic, frames, devices...)
  surf <command> --help      Command details
  surf --find <query>        Search for commands
  surf --about <topic>       Learn about a topic
`);
};

const showLlmContext = () => {
  console.log(`SURF CLI LLM CONTEXT
Purpose: control Chrome from shell. Commands are \`surf <command> [args] [options]\`.
Core loop: navigate -> wait/read -> act -> screenshot/read.
Navigate: surf navigate "https://example.com"    # alias: surf go "..."
Wait after navigation: surf wait 2                # or wait.load for load complete
Read DOM/refs: surf page.read --depth 3 --compact # alias: surf read
Refs: use e1/e2 refs from page.read; prefer refs over CSS when available.
Click ref: surf click e5
Click selector/coords: surf click --selector ".btn" | surf click 100 200
Type: surf type "text" --submit                  # use --ref e5 to target a field
Screenshot: surf screenshot /tmp/shot.png         # auto-saves to /tmp if no path
Full page screenshot: surf screenshot --full-page /tmp/full.png
Record animation: surf record --duration 2000 --fps 10 --output /tmp/anim.gif
Animation audit: surf animate-audit --selector ".thing" --duration 2000 --fps 10
Performance audit: surf perf-audit --duration 3000 --trigger "click:.cta" --output /tmp/perf.json
JavaScript: surf js "return document.title"
Scroll: surf scroll down 800 | surf scroll up 400 | surf scroll bottom | surf scroll top
Find by semantics: surf locate.role button --name "Submit" --action click
Device/viewport: surf emulate.device "iPhone 14" | surf resize 375 812
Cookies: surf cookie list | surf cookie get "name" | surf cookie delete "name"
Window isolation: surf window.new "https://example.com" then pass --window-id <id>
Concurrency: surf serializes commands per socket; use --no-lock only for intentional bypass
Doctor: surf doctor --browser all              # native host/socket diagnostics
Workflow: surf do 'go "https://example.com" | wait 2 | read | click e5 | screenshot'
More help: surf --help-full | surf <command> --help | surf --help-topic refs | surf --find <query>`);
};

const showFullHelp = () => {
  console.log(`surf v${VERSION} - Browser automation CLI

Usage: surf <command> [args] [options]

`);
  for (const [groupName, group] of Object.entries(TOOLS)) {
    console.log(`${groupName.toUpperCase()} - ${group.desc}`);
    for (const [cmd, info] of Object.entries(group.commands)) {
      if (info.alias) continue;
      const argStr = info.args?.length ? `<${info.args.join("> <")}>` : "";
      const line = `  ${cmd} ${argStr}`.padEnd(32);
      console.log(`${line}${info.desc}`);
    }
    console.log();
  }
  console.log(`Aliases: snap -> screenshot, read -> page.read, find -> search, go -> navigate

Options:
  --tab-id <id>     Target specific tab
  --window-id <id>  Target specific window (isolate from your browsing)
  --json            Output raw JSON
  --auto-capture    On error: capture screenshot + console to /tmp
  --soft-fail       On error: warn and exit 0 (for non-critical commands)
  --no-lock         Bypass the per-socket browser request lock

Script Mode:
  surf --script <file>     Run workflow from JSON
  surf --script <file> --dry-run
`);
};

const showHelpTopic = (topic) => {
  const t = HELP_TOPICS[topic];
  if (!t) {
    console.error(`Unknown topic: ${topic}`);
    console.error(`Available topics: ${Object.keys(HELP_TOPICS).join(", ")}`);
    process.exit(1);
  }
  console.log(`\n${t.title}\n${"=".repeat(t.title.length)}\n\n${t.content}\n`);
};

const showGroupHelp = (groupName) => {
  const group = TOOLS[groupName];
  if (!group) {
    console.error(`Unknown group: ${groupName}`);
    console.error(`Available groups: ${Object.keys(TOOLS).join(", ")}`);
    process.exit(1);
  }
  console.log(`\n${groupName} - ${group.desc}\n`);
  for (const [cmd, info] of Object.entries(group.commands)) {
    if (info.alias) {
      console.log(`  ${cmd} -> ${info.alias}\n`);
      continue;
    }
    const argStr = info.args?.length ? `<${info.args.join("> <")}>` : "";
    console.log(`  ${cmd} ${argStr}`);
    console.log(`      ${info.desc}`);
    if (info.opts) {
      for (const [opt, desc] of Object.entries(info.opts)) {
        console.log(`      --${opt.padEnd(14)} ${desc}`);
      }
    }
    if (info.examples?.length) {
      console.log("      Examples:");
      for (const ex of info.examples) {
        console.log(`        surf ${ex.cmd}`);
      }
    }
    console.log();
  }
};

const showToolHelp = (toolName) => {
  for (const [groupName, group] of Object.entries(TOOLS)) {
    const info = group.commands[toolName];
    if (info) {
      if (info.alias) {
        console.log(`\n  ${toolName} -> ${info.alias}\n`);
        showToolHelp(info.alias);
        return;
      }
      const argStr = info.args?.length ? `<${info.args.join("> <")}>` : "";
      console.log(`\n${toolName} - ${info.desc}\n`);
      console.log(`Usage: surf ${toolName} ${argStr}\n`);
      if (info.args?.length) {
        console.log("Arguments:");
        for (const arg of info.args) {
          console.log(`  <${arg}>`);
        }
        console.log();
      }
      if (info.opts) {
        console.log("Options:");
        for (const [opt, desc] of Object.entries(info.opts)) {
          console.log(`  --${opt.padEnd(18)} ${desc}`);
        }
        console.log();
      }
      if (info.examples?.length) {
        console.log("Examples:");
        for (const ex of info.examples) {
          console.log(`  surf ${ex.cmd.padEnd(40)} ${ex.desc}`);
        }
        console.log();
      }
      // Show related commands
      const related = SEE_ALSO[toolName];
      if (related && related.length > 0) {
        console.log(`See also: ${related.join(", ")}`);
        console.log();
      }
      return;
    }
  }
  if (ALL_SOCKET_TOOLS.includes(toolName)) {
    console.log(`\n  ${toolName}\n`);
    console.log("  Socket API tool. Use --json to see response format.\n");
    // Show related commands for socket tools too
    const related = SEE_ALSO[toolName];
    if (related && related.length > 0) {
      console.log(`See also: ${related.join(", ")}`);
      console.log();
    }
    return;
  }
  console.error(`Unknown command: ${toolName}`);
  process.exit(1);
};

const fuzzyFind = (query) => {
  const terms = query.toLowerCase().split(/\s+/);
  const results = [];

  for (const [groupName, group] of Object.entries(TOOLS)) {
    for (const [cmd, info] of Object.entries(group.commands)) {
      if (info.alias) continue;
      const searchText = `${cmd} ${info.desc} ${groupName}`.toLowerCase();
      const score = terms.filter(t => searchText.includes(t)).length;
      if (score > 0) {
        results.push({ cmd, desc: info.desc, group: groupName, score });
      }
    }
  }

  return results.sort((a, b) => b.score - a.score);
};

const showFindResults = (query) => {
  const results = fuzzyFind(query);
  if (results.length === 0) {
    console.log(`No commands found for: "${query}"`);
    return;
  }
  console.log(`\nSearch results for "${query}":\n`);
  for (const r of results.slice(0, 10)) {
    console.log(`  ${r.cmd.padEnd(24)} ${r.desc}`);
  }
  console.log();
};

const showAbout = (topic) => {
  const t = HELP_TOPICS[topic];
  if (t) {
    showHelpTopic(topic);
    return;
  }
  const topicLower = topic.toLowerCase();
  for (const [groupName, group] of Object.entries(TOOLS)) {
    if (groupName === topicLower || group.desc.toLowerCase().includes(topicLower)) {
      showGroupHelp(groupName);
      return;
    }
  }
  console.error(`Unknown topic: ${topic}`);
  console.error(`Available topics: ${Object.keys(HELP_TOPICS).join(", ")}`);
  console.error(`Or use a group name: ${Object.keys(TOOLS).join(", ")}`);
  process.exit(1);
};

const showAllTools = () => {
  console.log("\n  All available commands:\n");
  const sorted = [...ALL_SOCKET_TOOLS].sort();
  const cols = 4;
  const width = 22;
  for (let i = 0; i < sorted.length; i += cols) {
    const row = sorted.slice(i, i + cols).map(t => t.padEnd(width)).join("");
    console.log("  " + row);
  }
  console.log(`\n  Total: ${ALL_SOCKET_TOOLS.length} commands\n`);
};

if (args[0] === "--llm-context") {
  showLlmContext();
  process.exit(0);
}

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  showBasicHelp();
  process.exit(0);
}

if (args[0] === "--help-full") {
  showFullHelp();
  process.exit(0);
}

if (args[0] === "--help-topic" && args[1]) {
  showHelpTopic(args[1]);
  process.exit(0);
}

if (args[0] === "--version" || args[0] === "-v") {
  console.log(`surf version ${VERSION}`);
  process.exit(0);
}

if (args[0] === "--list") {
  showAllTools();
  process.exit(0);
}

if (args[0] === "--find" && args[1]) {
  showFindResults(args.slice(1).join(" "));
  process.exit(0);
}

if (args[0] === "--about" && args[1]) {
  showAbout(args[1]);
  process.exit(0);
}

if (args[0] === "server") {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: surf server");
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

if (args[0] === "extension-path" || args[0] === "path") {
  const distPath = process.env.SURF_EXTENSION_PATH || path.resolve(__dirname, "../dist");
  console.log(distPath);
  process.exit(0);
}

if (args[0] === "doctor") {
  const { runDoctorCli } = require("./doctor.cjs");
  runDoctorCli(args.slice(1)).then((code) => process.exit(code));
  return;
}

if (args[0] === "install") {
  const { spawnSync } = require("child_process");
  const scriptPath = require("path").resolve(__dirname, "../scripts/install-native-host.cjs");
  const installArgs = args.slice(1);

  if (installArgs.length === 0 || installArgs[0] === "--help" || installArgs[0] === "-h") {
    console.log(`
Usage: surf install <extension-id> [options]

Install native messaging host for browser communication.

Arguments:
  extension-id    Chrome extension ID (32 lowercase letters a-p)
                  Find at chrome://extensions with Developer Mode enabled

Options:
  -b, --browser   Browser(s) to install for (default: chrome)
                  Values: chrome, chromium, brave, edge, arc, helium, all
                  Multiple: --browser chrome,brave
  --target        Install target: auto, linux, windows
                  On WSL2, auto installs for Windows Chrome. Use linux for WSLg/Linux browsers.

Examples:
  surf install hnfbepgmaoklhekckbpjnleifhahkcpl
  surf install hnfbepgmaoklhekckbpjnleifhahkcpl --browser brave
  surf install hnfbepgmaoklhekckbpjnleifhahkcpl --browser all
  surf install hnfbepgmaoklhekckbpjnleifhahkcpl --target linux
`);
    process.exit(0);
  }

  const result = spawnSync(process.execPath, [scriptPath, ...installArgs], {
    stdio: "inherit",
  });
  process.exit(result.status || 0);
}

if (args[0] === "uninstall") {
  const { spawnSync } = require("child_process");
  const scriptPath = require("path").resolve(__dirname, "../scripts/uninstall-native-host.cjs");
  const uninstallArgs = args.slice(1);

  if (uninstallArgs.includes("--help") || uninstallArgs.includes("-h")) {
    console.log(`
Usage: surf uninstall [options]

Remove native messaging host configuration.

Options:
  -b, --browser   Browser(s) to uninstall from (default: chrome)
                  Values: chrome, chromium, brave, edge, arc, helium, all
  -a, --all       Uninstall from all browsers and remove wrapper
  --target        Install target to remove: auto, linux, windows
                  On WSL2, auto removes Windows-browser manifests. Use linux for WSLg/Linux browsers.

Examples:
  surf uninstall
  surf uninstall --browser brave
  surf uninstall --all
  surf uninstall --target linux
`);
    process.exit(0);
  }

  const result = spawnSync(process.execPath, [scriptPath, ...uninstallArgs], {
    stdio: "inherit",
  });
  process.exit(result.status || 0);
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
  const group = TOOLS[args[0]];
  const sameNameCmd = group.commands[args[0]];
  const executableAlone = ["zoom"];
  if (sameNameCmd && executableAlone.includes(args[0])) {
    // Command that works without args - execute it
  } else {
    showGroupHelp(args[0]);
    process.exit(0);
  }
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
    console.log("Create one with: surf config --init");
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
      sock.on("error", (e) => reject(new Error(formatSocketError(e))));
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

  if (!dryRun) {
    installBrowserLock(parseBrowserLockOptions(args.includes("--no-lock")));
  }

  runScript();
  return;
}

// Handle `surf do` workflow command
// Must be parsed before general parseArgs since it uses its own arg handling
if (args[0] === "do") {
  const doArgs = args.slice(1);
  let commandsInput = null;
  let fileInput = null;
  let dryRun = false;
  let onError = "stop";
  let noAutoWait = false;
  let stepDelay = 100;
  let wantJson = false;
  let tabId = undefined;
  let windowId = undefined;

  // Reserved flags that aren't workflow args
  const reservedFlags = ['file', 'f', 'dry-run', 'on-error', 'no-auto-wait', 'step-delay', 'json', 'tab-id', 'window-id', 'no-lock'];

  // Workflow-specific args (collected for variable substitution)
  const workflowArgs = {};

  // Parse do-specific arguments
  for (let i = 0; i < doArgs.length; i++) {
    const arg = doArgs[i];
    if (arg === "--file" || arg === "-f") {
      fileInput = doArgs[i + 1];
      i++;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--on-error") {
      onError = doArgs[i + 1] || "stop";
      i++;
    } else if (arg === "--no-auto-wait") {
      noAutoWait = true;
    } else if (arg === "--step-delay") {
      const parsed = parseInt(doArgs[i + 1], 10);
      stepDelay = isNaN(parsed) ? 100 : parsed;
      i++;
    } else if (arg === "--json") {
      wantJson = true;
    } else if (arg === "--tab-id") {
      tabId = parseInt(doArgs[i + 1], 10);
      i++;
    } else if (arg === "--window-id") {
      windowId = parseInt(doArgs[i + 1], 10);
      i++;
    } else if (arg.startsWith("--")) {
      // Workflow-specific arg (e.g., --email, --password)
      const key = arg.slice(2);
      if (!reservedFlags.includes(key)) {
        const next = doArgs[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          // Type coercion
          let val = next;
          if (val === "true") val = true;
          else if (val === "false") val = false;
          else if (/^-?\d+$/.test(val)) val = parseInt(val, 10);
          else if (/^-?\d+\.\d+$/.test(val)) val = parseFloat(val);
          workflowArgs[key] = val;
          i++;
        } else {
          workflowArgs[key] = true;
        }
      }
    } else if (!arg.startsWith("-")) {
      commandsInput = arg;
    }
  }

  if (!commandsInput && !fileInput) {
    console.error("Error: commands string, workflow name, or --file required");
    console.error('Usage: surf do \'go "url" | click e5\'');
    console.error("       surf do --file workflow.json");
    console.error("       surf do my-workflow --arg1 value1 --arg2 value2");
    process.exit(1);
  }

  let steps;
  let workflow = null; // Full workflow object (for arg validation)
  let workflowName = null;

  try {
    if (fileInput) {
      // Explicit file path via --file
      if (!fs.existsSync(fileInput)) {
        console.error(`Error: File not found: ${fileInput}`);
        process.exit(1);
      }
      const content = fs.readFileSync(fileInput, "utf8");
      workflow = JSON.parse(content);
      workflowName = workflow.name || fileInput;
    } else {
      // Resolve: inline | file path | named workflow
      const resolved = resolveWorkflow(commandsInput);

      if (resolved.type === 'inline') {
        // Inline pipe syntax
        steps = parseDoCommands(resolved.content);
      } else if (resolved.type === 'file') {
        // Found workflow file
        const content = fs.readFileSync(resolved.path, "utf8");
        workflow = JSON.parse(content);
        workflowName = workflow.name || commandsInput;
      } else {
        // Not found - try parsing as inline (might be a single command)
        steps = parseDoCommands(commandsInput);
        if (steps.length === 0) {
          console.error(`Error: Workflow not found: ${commandsInput}`);
          console.error(`Searched in:`);
          for (const { path: dir } of getWorkflowDirs()) {
            console.error(`  ${dir}`);
          }
          console.error(`\nRun 'surf workflow.list' to see available workflows.`);
          process.exit(1);
        }
      }
    }

    // Process workflow file if loaded
    if (workflow) {
      if (!workflow.steps || !Array.isArray(workflow.steps)) {
        throw new Error("Workflow must have a 'steps' array");
      }

      // Validate required args
      const argErrors = validateWorkflowArgs(workflow, workflowArgs);
      if (argErrors.length > 0) {
        console.error("Error: Missing required arguments:");
        argErrors.forEach(e => console.error(`  ${e}`));
        if (workflow.args) {
          console.error(`\nWorkflow arguments:`);
          for (const [name, spec] of Object.entries(workflow.args)) {
            const req = spec.required ? ' (required)' : '';
            const def = spec.default !== undefined ? ` [default: ${spec.default}]` : '';
            const desc = spec.desc || spec.description || '';
            console.error(`  --${name}${req}${def}${desc ? ` - ${desc}` : ''}`);
          }
        }
        console.error(`\nRun 'surf workflow.info ${workflowName}' for details.`);
        process.exit(1);
      }

      // Convert steps: support both { tool, args } and { cmd, args } formats
      // Also preserve loop steps as-is
      steps = workflow.steps.map(s => {
        if (s.repeat !== undefined || s.each !== undefined) {
          // Loop step - convert nested steps recursively
          const convertSteps = (stepsArr) => stepsArr.map(ns => {
            if (ns.repeat !== undefined || ns.each !== undefined) {
              // Recursively convert nested loop steps and until condition
              return {
                ...ns,
                steps: convertSteps(ns.steps || []),
                until: ns.until ? { cmd: ns.until.tool || ns.until.cmd, args: ns.until.args || {} } : undefined
              };
            }
            return { cmd: ns.tool || ns.cmd, args: ns.args || {}, as: ns.as };
          });
          return {
            ...s,
            steps: convertSteps(s.steps || []),
            until: s.until ? { cmd: s.until.tool || s.until.cmd, args: s.until.args || {} } : undefined
          };
        }
        return { cmd: s.tool || s.cmd, args: s.args || {}, as: s.as };
      });
    }
  } catch (e) {
    console.error(`Error: Failed to parse workflow: ${e.message}`);
    process.exit(1);
  }

  if (!steps || steps.length === 0) {
    console.error("Error: No commands found in workflow");
    process.exit(1);
  }

  // Apply arg defaults
  const vars = workflow ? applyArgDefaults(workflow, workflowArgs) : workflowArgs;

  // Validate with --dry-run
  if (dryRun) {
    if (workflowName) {
      console.log(`Workflow: ${workflowName}`);
      if (workflow?.description) console.log(`Description: ${workflow.description}`);
    }
    console.log(`\nWould execute ${steps.length} steps:`);
    steps.forEach((s, i) => {
      console.log(`  ${i + 1}. ${formatStep(s)}`);
    });
    if (Object.keys(vars).length > 0) {
      console.log(`\nVariables:`);
      for (const [k, v] of Object.entries(vars)) {
        console.log(`  ${k} = ${JSON.stringify(v)}`);
      }
    }
    process.exit(0);
  }

  installBrowserLock(parseBrowserLockOptions(doArgs.includes("--no-lock")));

  if (!wantJson) {
    if (workflowName) {
      console.log(`Running workflow: ${workflowName} (${steps.length} steps)...\n`);
    } else {
      console.log(`Running workflow (${steps.length} steps)...\n`);
    }
  }

  const runWorkflow = async () => {
    const result = await executeDoSteps(steps, {
      onError,
      autoWait: !noAutoWait,
      stepDelay,
      quiet: wantJson,
      vars,
      context: {
        tabId,
        windowId,
      },
    });

    // Print summary
    if (wantJson) {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.status === "completed" ? 0 : 1);
    }

    console.log("");
    if (result.status === "completed") {
      console.log(`Completed: ${result.completedSteps}/${result.totalSteps} steps (${result.totalMs}ms)`);
      process.exit(0);
    } else if (result.status === "partial") {
      console.log(`Partial: ${result.completedSteps}/${result.totalSteps} steps completed, ${result.failed} failed`);
      process.exit(1);
    } else {
      console.error(`Failed: ${result.completedSteps}/${result.totalSteps} steps completed`);
      if (result.error) console.error(`Error: ${result.error}`);
      process.exit(1);
    }
  };

  runWorkflow();
  return;
}

// Handle workflow management commands
if (args[0] === "workflow.list") {
  const workflows = listWorkflows();

  if (workflows.length === 0) {
    console.log("No workflows found.");
    console.log(`\nWorkflow directories:`);
    for (const { path: dir, scope } of getWorkflowDirs()) {
      console.log(`  ${scope}: ${dir}`);
    }
    console.log(`\nCreate a workflow JSON file in one of these directories.`);
    process.exit(0);
  }

  // Group by scope
  const byScope = { project: [], user: [] };
  for (const w of workflows) {
    byScope[w.scope].push(w);
  }

  if (byScope.user.length > 0) {
    console.log(`User Workflows (~/.surf/workflows/):`);
    for (const w of byScope.user) {
      const desc = w.description ? ` - ${w.description}` : '';
      console.log(`  ${w.name.padEnd(20)} ${desc}`);
    }
    console.log("");
  }

  if (byScope.project.length > 0) {
    console.log(`Project Workflows (./.surf/workflows/):`);
    for (const w of byScope.project) {
      const desc = w.description ? ` - ${w.description}` : '';
      console.log(`  ${w.name.padEnd(20)} ${desc}`);
    }
    console.log("");
  }

  console.log(`Run 'surf workflow.info <name>' for details.`);
  process.exit(0);
}

if (args[0] === "workflow.info") {
  const name = args[1];
  if (!name) {
    console.error("Error: workflow name required");
    console.error("Usage: surf workflow.info <name>");
    process.exit(1);
  }

  const info = getWorkflowInfo(name);
  if (info.error) {
    console.error(`Error: ${info.error}`);
    process.exit(1);
  }

  console.log(`${info.name}${info.description ? ` - ${info.description}` : ''}`);
  console.log("");

  // Arguments
  if (info.args && Object.keys(info.args).length > 0) {
    console.log("Arguments:");
    for (const [argName, spec] of Object.entries(info.args)) {
      const req = spec.required ? ' (required)' : '';
      const def = spec.default !== undefined ? ` [default: ${spec.default}]` : '';
      const desc = spec.desc || spec.description || '';
      console.log(`  --${argName}${req}${def}`);
      if (desc) console.log(`      ${desc}`);
    }
    console.log("");
  }

  // Steps
  console.log(`Steps (${info.steps.length}):`);
  info.steps.forEach((step, i) => {
    console.log(`  ${i + 1}. ${formatStep(step)}`);
  });
  console.log("");

  // Location
  console.log(`Location: ${info.path}`);
  console.log("");

  // Example run command
  const argExample = Object.entries(info.args || {})
    .filter(([_, spec]) => spec.required)
    .map(([name, _]) => `--${name} "..."`)
    .join(' ');
  console.log(`Run:`);
  console.log(`  surf do ${name}${argExample ? ' ' + argExample : ''}`);

  process.exit(0);
}

if (args[0] === "workflow.validate") {
  const filePath = args[1];
  if (!filePath) {
    console.error("Error: file path required");
    console.error("Usage: surf workflow.validate <file>");
    process.exit(1);
  }

  const result = validateWorkflowFile(filePath);

  if (result.valid) {
    console.log(`✓ Valid workflow: ${filePath}`);
    console.log(`  Name: ${result.workflow.name || '(unnamed)'}`);
    console.log(`  Steps: ${result.workflow.steps.length}`);
    if (result.workflow.args) {
      const argCount = Object.keys(result.workflow.args).length;
      const reqCount = Object.values(result.workflow.args).filter(a => a.required).length;
      console.log(`  Args: ${argCount} (${reqCount} required)`);
    }
    process.exit(0);
  } else {
    console.error(`✗ Invalid workflow: ${filePath}`);
    console.error(`  Error: ${result.error}`);
    process.exit(1);
  }
}

const BOOLEAN_FLAGS = ["auto-capture", "json", "stream", "dry-run", "stop-on-error", "fail-fast", "clear", "submit", "all", "case-sensitive", "hard", "annotate", "fullpage", "full-page", "reset", "no-screenshot", "full", "soft-fail", "has-body", "exclude-static", "v", "vv", "request", "by-tab", "har", "jsonl", "no-save", "no-auto-wait", "no-lock"];

const AUTO_SCREENSHOT_TOOLS = ["click", "type", "key", "smart_type", "form.fill", "form_input", "drag", "hover", "scroll", "scroll.top", "scroll.bottom", "scroll.to", "dialog.accept", "dialog.dismiss", "js", "eval"];

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
        if (next !== undefined && !next.startsWith("--") && !next.startsWith("-")) {
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
    } else if (arg === "-v") {
      result.options.v = true;
    } else if (arg === "-vv") {
      result.options.vv = true;
    } else if (arg === "-f" && rawArgs[i + 1] && !rawArgs[i + 1].startsWith("-")) {
      // -f takes a file path argument (for surf do -f <file>)
      result.options.file = rawArgs[i + 1];
      i++;
    } else if (arg.startsWith("-") && arg.length === 2) {
      // Short flag like -n
      result.options[arg.slice(1)] = true;
    } else {
      result.positional.push(arg);
    }
  }
  return result;
};

let { positional, options } = parseArgs(args);
let tool = positional[0];
let firstArg = positional[1];

if (tool === "cookie" && firstArg) {
  const cookieSubcommands = {
    list: "cookie.list",
    get: "cookie.get",
    set: "cookie.set",
    clear: "cookie.clear",
    delete: "cookie.clear",
  };
  const cookieTool = cookieSubcommands[firstArg];
  if (cookieTool) {
    tool = cookieTool;
    positional = [tool, ...positional.slice(2)];
    firstArg = positional[1];
  }
}

if (!tool) {
  console.error("Error: No command specified");
  process.exit(1);
}

if (REMOVED_COMMANDS[tool]) {
  console.error(`Error: Unknown command: ${tool}`);
  console.error(`This command was renamed. Use: ${REMOVED_COMMANDS[tool]}`);
  process.exit(1);
}

tool = ALIASES[tool] || tool;

// Auto-save screenshots to temp file when no --output specified
// This ensures agents always get a usable file path, not just an in-memory ID
// Can be disabled with --no-save flag or autoSaveScreenshots: false in surf.json
if (options["full-page"] === true) {
  options.fullpage = true;
  delete options["full-page"];
}

const config = loadConfig();
const autoSaveEnabled = config.autoSaveScreenshots !== false && !options["no-save"];
if (tool === "screenshot" && !options.output && !options.savePath && firstArg === undefined && autoSaveEnabled) {
  options.savePath = path.join(SURF_TMP, `surf-snap-${Date.now()}.png`);
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
  gemini: "query",
  chatgpt: "query",
  perplexity: "query",
  grok: "query",
  aistudio: "query",
  "aistudio.build": "query",
  navigate: "url",
  go: "url",
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
  search: "term",
  find: "term",
  "cookie.get": "name",
  "cookie.clear": "name",
  "wait.element": "selector",
  "wait.url": "pattern",
  zoom: "level",
  "history.search": "query",
  "network.get": "id",
  "network.body": "id",
  "network.curl": "id",
  "network.path": "id",
  "window.new": "url",
  "window.focus": "id",
  "window.close": "id",
  "locate.role": "role",
  "locate.text": "text",
  "locate.label": "label",
  "emulate.device": "device",
  "frame.js": "code",
  "element.styles": "selector",
  "select": "selector",
};

const toolArgs = { ...options };

if (tool === "scroll" && firstArg) {
  if (firstArg === "top" || firstArg === "bottom") {
    tool = `scroll.${firstArg}`;
    firstArg = undefined;
  } else if (["up", "down", "left", "right"].includes(firstArg)) {
    if (toolArgs.direction === undefined) toolArgs.direction = firstArg;
    if (positional[2] !== undefined && /^-?\d+$/.test(positional[2]) && toolArgs.amount === undefined && toolArgs.scroll_amount === undefined) {
      toolArgs.scroll_pixels = parseInt(positional[2], 10);
    }
    firstArg = undefined;
  }
}

if (tool === "click" && firstArg) {
  if (/^e\d+$/.test(firstArg)) {
    toolArgs.ref = firstArg;
    firstArg = undefined;
  } else if (/^\d+$/.test(firstArg) && positional[2] && /^\d+$/.test(positional[2])) {
    toolArgs.x = parseInt(firstArg, 10);
    toolArgs.y = parseInt(positional[2], 10);
    firstArg = undefined;
  }
}

if (tool === "resize") {
  if (firstArg !== undefined && toolArgs.width === undefined) {
    let val = firstArg;
    if (/^-?\d+$/.test(val)) val = parseInt(val, 10);
    toolArgs.width = val;
  }
  if (positional[2] !== undefined && toolArgs.height === undefined) {
    let val = positional[2];
    if (/^-?\d+$/.test(val)) val = parseInt(val, 10);
    toolArgs.height = val;
  }
  firstArg = undefined;
}

if (tool === "screenshot" && firstArg !== undefined && toolArgs.output === undefined && toolArgs.savePath === undefined) {
  toolArgs.savePath = firstArg;
  firstArg = undefined;
}

if (tool === "record" && firstArg !== undefined && toolArgs.output === undefined) {
  toolArgs.output = firstArg;
  firstArg = undefined;
}

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

if (tool === "js" && toolArgs.file) {
  try {
    toolArgs.code = fs.readFileSync(toolArgs.file, "utf8");
    delete toolArgs.file;
  } catch (e) {
    console.error(`Error: Failed to read file: ${e.message}`);
    process.exit(1);
  }
}

// Handle select command: capture multiple values after selector
if (tool === "select" && positional.length > 2) {
  const values = positional.slice(2);  // All args after "select <selector>"
  toolArgs.values = values.length === 1 ? values[0] : values;
} else if (tool === "select" && positional.length === 2) {
  // Only selector provided, no values
  console.error("Error: select requires at least one value");
  console.error("Usage: surf select <selector> <value...>");
  process.exit(1);
}

if (toolArgs.into && !toolArgs.selector) {
  toolArgs.selector = toolArgs.into;
  delete toolArgs.into;
}

const globalOpts = {};
if (toolArgs["tab-id"] !== undefined) {
  const tid = parseInt(toolArgs["tab-id"], 10);
  if (isNaN(tid)) {
    console.error("Error: --tab-id must be a number");
    process.exit(1);
  }
  globalOpts.tabId = tid;
  delete toolArgs["tab-id"];
}
if (toolArgs["window-id"] !== undefined) {
  const wid = parseInt(toolArgs["window-id"], 10);
  if (isNaN(wid)) {
    console.error("Error: --window-id must be a number");
    process.exit(1);
  }
  globalOpts.windowId = wid;
  delete toolArgs["window-id"];
}
if (toolArgs["network-path"] !== undefined) {
  networkStore.setBasePath(toolArgs["network-path"]);
  delete toolArgs["network-path"];
}
const wantJson = toolArgs.json === true;
delete toolArgs.json;

const autoCapture = toolArgs["auto-capture"] === true;
delete toolArgs["auto-capture"];

const noScreenshot = toolArgs["no-screenshot"] === true;
delete toolArgs["no-screenshot"];

const softFail = toolArgs["soft-fail"] === true;
delete toolArgs["soft-fail"];

const lockOptions = parseBrowserLockOptions(toolArgs["no-lock"] === true);
delete toolArgs["no-lock"];

if (!noScreenshot && AUTO_SCREENSHOT_TOOLS.includes(tool)) {
  toolArgs.autoScreenshot = true;
}

const outputPath = toolArgs.output;
delete toolArgs.output;
if (tool === "aistudio.build" && outputPath) {
  toolArgs.output = path.resolve(outputPath);
}
if (tool === "gemini") {
  if (outputPath) toolArgs.output = path.resolve(outputPath);
  if (toolArgs["generate-image"] && typeof toolArgs["generate-image"] === "string") {
    toolArgs["generate-image"] = path.resolve(toolArgs["generate-image"]);
  }
  if (toolArgs["edit-image"] && typeof toolArgs["edit-image"] === "string") {
    toolArgs["edit-image"] = path.resolve(toolArgs["edit-image"]);
  }
  if (toolArgs.file && typeof toolArgs.file === "string") {
    toolArgs.file = path.resolve(toolArgs.file);
  }
}
if (tool === "chatgpt" && toolArgs.file) {
  if (Array.isArray(toolArgs.file)) {
    toolArgs.file = toolArgs.file.map((filePath) => path.resolve(filePath));
  } else if (typeof toolArgs.file === "string") {
    toolArgs.file = path.resolve(toolArgs.file);
  }
}

if ((tool === "screenshot" || tool === "record" || tool === "perf-audit") && outputPath && typeof outputPath !== "string") {
  console.error("Error: --output requires a file path");
  process.exit(1);
}

if (tool === "screenshot" && outputPath) {
  toolArgs.savePath = outputPath;
  if (options.full) toolArgs.full = true;
  if (options["max-size"]) toolArgs["max-size"] = options["max-size"];
}

const methodFlag = toolArgs.method;
// Keep method for network filtering, only delete for other tools
if (tool !== 'network' && tool !== 'get_network_entries') {
  delete toolArgs.method;
}

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
      console.error("Error: --selector or --into required for type with --method js");
      process.exit(1);
    }
    finalTool = "smart_type";
  } else if (tool === "click") {
    if (!toolArgs.selector) {
      console.error("Error: --selector required for click with --method js");
      process.exit(1);
    }
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
        if (msg.type === "extension_disconnected") {
          console.error(msg.message);
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
    console.error("Error:", formatSocketError(e));
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

const sendRequest = (toolName, toolArgs = {}, timeoutMs = 5000) => {
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
          if (resp.type === "extension_disconnected") {
            sock.end();
            reject(new Error(resp.message));
            return;
          }
          sock.end();
          resolve(resp);
        } catch {
          sock.end();
          reject(new Error("Invalid JSON"));
        }
      }
    });
    sock.on("error", (e) => reject(new Error(formatSocketError(e))));
    let timeoutId;
    timeoutId = setTimeout(() => { sock.destroy(); reject(new Error("Timeout")); }, timeoutMs);
    sock.on("close", () => clearTimeout(timeoutId));
  });
};

function parseRecordNumber(value, fallback, name, min, max) {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") throw new Error(`${name} must be a number`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return parsed;
}

function parseRecordRect(value) {
  if (value === undefined) return null;
  if (typeof value !== "string") throw new Error("rect must be x,y,width,height");
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error("rect must be x,y,width,height");
  }
  const [x, y, width, height] = parts;
  if (x < 0 || y < 0 || width <= 0 || height <= 0) {
    throw new Error("rect must use non-negative x/y and positive width/height");
  }
  return { x, y, width, height, crop: `${width}x${height}+${x}+${y}` };
}

function assertToolOk(response, context) {
  if (!response?.error) return;
  const message = response.error.content?.[0]?.text || response.error.message || JSON.stringify(response.error);
  throw new Error(`${context}: ${message}`);
}

function assembleRecordGif(framePaths, output, fps, rect) {
  const delay = Math.max(1, Math.round(100 / fps));
  const args = ["-delay", String(delay), "-loop", "0", ...framePaths];
  if (rect) args.push("-crop", rect.crop, "+repage");
  args.push(output);

  try {
    execFileSync("magick", args, { stdio: "pipe" });
    return "magick";
  } catch (magickError) {
    try {
      execFileSync("convert", args, { stdio: "pipe" });
      return "convert";
    } catch (convertError) {
      const detail = convertError && convertError.message ? convertError.message : String(convertError);
      throw new Error(`Failed to assemble GIF with ImageMagick. Install ImageMagick (magick or convert). Last error: ${detail}`);
    }
  }
}

async function runRecord() {
  const durationMs = parseRecordNumber(toolArgs.duration, 2000, "duration", 100, 10000);
  const fps = parseRecordNumber(toolArgs.fps, 10, "fps", 1, 30);
  const rect = parseRecordRect(toolArgs.rect);
  const output = path.resolve(outputPath || path.join(SURF_TMP, `surf-record-${Date.now()}.gif`));
  const frameCount = Math.max(1, Math.ceil((durationMs / 1000) * fps));
  const frameDir = fs.mkdtempSync(path.join(SURF_TMP, "surf-record-"));
  const framePaths = [];
  let trigger = null;

  try {
    if (toolArgs.trigger !== undefined) {
      trigger = await runRecordTrigger(toolArgs.trigger);
    }

    const startedAt = Date.now();
    for (let i = 0; i < frameCount; i++) {
      const framePath = path.join(frameDir, `frame-${String(i).padStart(4, "0")}.png`);
      const response = await sendRequest("screenshot", {
        savePath: framePath,
        full: toolArgs.full,
        "max-size": toolArgs["max-size"],
      }, 30000);
      assertToolOk(response, `record frame ${i + 1}`);
      framePaths.push(framePath);

      if (i < frameCount - 1) {
        const nextFrameAt = startedAt + Math.round(((i + 1) * durationMs) / frameCount);
        const waitMs = nextFrameAt - Date.now();
        if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    fs.mkdirSync(path.dirname(output), { recursive: true });
    const imageMagick = assembleRecordGif(framePaths, output, fps, rect);
    const result = { output, frames: framePaths.length, durationMs, fps, imageMagick, ...(trigger && { trigger }), ...(rect && { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }) };

    if (wantJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Saved recording to ${output} (${result.frames} frames, ${durationMs}ms @ ${fps}fps)`);
    }
  } finally {
    fs.rmSync(frameDir, { recursive: true, force: true });
  }
}

async function runRecordTrigger(trigger) {
  if (typeof trigger !== "string") throw new Error("trigger must be action:target");
  const separator = trigger.indexOf(":");
  if (separator === -1) throw new Error("trigger must be action:target");
  const action = trigger.slice(0, separator).trim();
  const target = trigger.slice(separator + 1).trim();
  if (!action || !target) throw new Error("trigger must be action:target");

  if (action === "click") {
    const response = await sendRequest("click", { selector: target }, 30000);
    assertToolOk(response, "record trigger");
    return { action, selector: target };
  }

  if (action === "scroll") {
    let response;
    if (["up", "down", "left", "right"].includes(target)) {
      response = await sendRequest("scroll", { direction: target }, 30000);
    } else if (target === "top" || target === "bottom") {
      response = await sendRequest(`scroll.${target}`, {}, 30000);
    } else {
      response = await sendRequest("scroll.bottom", { selector: target }, 30000);
    }
    assertToolOk(response, "record trigger");
    return { action, target };
  }

  throw new Error("trigger action must be click or scroll");
}

const performAutoCapture = async () => {
  const timestamp = Date.now();
  const screenshotPath = path.join(SURF_TMP, `surf-error-${timestamp}.png`);

  try {
    const [screenshotResp, consoleResp] = await Promise.all([
      sendRequest("screenshot", { savePath: screenshotPath }),
      sendRequest("console", {}),
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

if (finalTool === "record") {
  installBrowserLock(lockOptions);
  runRecord()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Error:", error && error.message ? error.message : String(error));
      process.exit(1);
    });
  return;
}

installBrowserLock(lockOptions);

const socket = net.createConnection(SOCKET_PATH, () => {
  socket.write(JSON.stringify(request) + "\n");
});

const AI_TOOLS = ["smoke", "chatgpt", "gemini", "perplexity", "grok", "aistudio", "aistudio.build", "ai"];
let requestTimeout = AI_TOOLS.includes(tool) ? 300000 : 30000;
if (tool === "aistudio.build") {
  const userTimeoutSec = parseInt(options.timeout || "600", 10);
  requestTimeout = (userTimeoutSec * 1000) + 60000;
}
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
      const msg = JSON.parse(line);

      if (msg.type === "extension_disconnected") {
        clearTimeout(timeout);
        console.error(msg.message);
        socket.end();
        process.exit(1);
      }

      handleResponse(msg).catch((err) => {
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
  console.error("Error:", formatSocketError(err));
  process.exit(1);
});

socket.on("close", () => {
  clearTimeout(timeout);
});

async function handleResponse(response) {
  clearTimeout(timeout);

  if (response.error) {
    const errContent = response.error.content?.[0]?.text || JSON.stringify(response.error);
    if (softFail) {
      console.warn("Warning:", errContent);
      socket.end();
      process.exit(0);
    }
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

  if (tool === 'aistudio' && typeof data === 'string') {
    data = { response: data };
  }

  if (tool === "perf-audit" && outputPath) {
    const saveTo = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(saveTo), { recursive: true });
    fs.writeFileSync(saveTo, JSON.stringify(data ?? null, null, 2));
    if (!wantJson) {
      console.log(`Saved perf audit to ${saveTo}`);
      socket.end();
      process.exit(0);
    }
  }

  if (wantJson) {
    console.log(JSON.stringify(data ?? null, null, 2));
    socket.end();
    process.exit(0);
  }

  if (tool === "screenshot" && data?.base64 && (outputPath || toolArgs.savePath)) {
    const saveTo = outputPath || toolArgs.savePath;
    fs.writeFileSync(saveTo, Buffer.from(data.base64, "base64"));

    const skipResize = options.full || toolArgs.full;
    const maxSize = parseInt(options["max-size"] || toolArgs["max-size"] || "1200", 10);
    const origWidth = data.width || 0;
    const origHeight = data.height || 0;

    if (!skipResize && (origWidth > maxSize || origHeight > maxSize)) {
      const result = resizeImage(saveTo, maxSize);
      if (result.success) {
        console.log(`Saved to ${saveTo} (${result.width}x${result.height}, resized from ${origWidth}x${origHeight})`);
      } else {
        console.log(`Saved to ${saveTo} (${origWidth}x${origHeight}, resize failed: ${result.error})`);
      }
    } else {
      console.log(`Saved to ${saveTo} (${origWidth}x${origHeight})`);
    }
  } else if (tool === "screenshot" && data?.message) {
    console.log(data.message);
    if (data.screenshotId) {
      console.log(`[Screenshot ID: ${data.screenshotId}]`);
    }
  } else if (tool === "tab.list") {
    const tabs = data?.tabs || data || [];
    if (Array.isArray(tabs)) {
      if (tabs.length === 0) {
        if (globalOpts.windowId) {
          console.log(`No tabs in window ${globalOpts.windowId}. Window may not exist - use 'surf window.list' to verify.`);
        } else {
          console.log("No tabs found.");
        }
      } else {
        for (const t of tabs) {
          console.log(`${t.id}\t${t.title}\t${t.url}`);
        }
      }
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  } else if (tool === "tab.named") {
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
  } else if (tool === "page.read" && data?.pageContent) {
    console.log(data.pageContent);
  } else if (tool === "page.text" && data?.text) {
    console.log(data.text);
  } else if (tool === "emulate.device" && data?.devices) {
    console.log("Available devices:\n");
    const devices = data.devices;
    for (const d of devices) {
      console.log(`  ${d}`);
    }
    console.log("\nUsage: surf emulate.device \"<device name>\"");
    console.log('Reset:  surf emulate.device "reset"');
  } else if (tool === "js") {
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
  } else if (tool === "zoom" && data?.zoom !== undefined) {
    console.log(`Zoom: ${Math.round(data.zoom * 100)}%`);
  } else if (tool === "back" || tool === "forward") {
    console.log("OK");
  } else if (tool === "network" && (data?.entries || data?.requests)) {
    // Network list - handle both new (entries) and old (requests) formats
    const items = data.entries || data.requests || [];

    if (items.length === 0) {
      console.log("No network requests captured");
    } else if (data._format === 'raw') {
      // Raw JSON output - print entries array directly
      console.log(JSON.stringify(items, null, 2));
    } else {
      // Simple compact format for now
      for (const req of items) {
        const status = req.status || '-';
        const method = (req.method || 'GET').padEnd(6);
        const type = (req.type || '').padEnd(10);
        const url = req.url || '';
        console.log(`${status} ${method} ${type} ${url}`);
      }
    }
  } else if (tool === "network.get" && data?.entry) {
    console.log(networkFormatters.formatEntry(data.entry));
  } else if (tool === "network.body" && data?.body !== undefined) {
    // Raw body for piping
    process.stdout.write(data.body);
  } else if (tool === "network.curl" && data?.curl) {
    console.log(data.curl);
  } else if (tool === "network.curl" && data?.entry) {
    console.log(networkFormatters.formatCurl(data.entry));
  } else if (tool === "network.origins" && data?.origins) {
    console.log(networkFormatters.formatOrigins(data.origins));
  } else if (tool === "network.stats" && data?.stats) {
    console.log(networkFormatters.formatStats(data.stats));
  } else if (tool === "network.clear" && data?.cleared !== undefined) {
    console.log(`Cleared ${data.cleared} requests`);
  } else if (tool === "network.export" && data?.path) {
    console.log(`Exported to: ${data.path}`);
  } else if (tool === "network.path" && data?.paths) {
    for (const [key, val] of Object.entries(data.paths)) {
      console.log(`${key}: ${val}`);
    }
  } else if ((tool === "chatgpt" || tool === "gemini") && data?.response) {
    console.log(data.response);
    if (data.imagePath) {
      console.log(`\nImage saved: ${data.imagePath}`);
    }
    console.error(`\n[${data.model || 'unknown'} | ${((data.tookMs || 0) / 1000).toFixed(1)}s]`);
  } else if (tool === "aistudio" && data?.response) {
    console.log(data.response);

    const meta = [];
    if (data.model) meta.push(data.model);
    if (data.thinkingTime) meta.push(`thought ${data.thinkingTime}s`);
    if (Number.isFinite(data.tookMs)) meta.push(`${(data.tookMs / 1000).toFixed(1)}s`);
    if (meta.length > 0) {
      console.error(`\n[${meta.join(' | ')}]`);
    }
  } else if (tool === "aistudio.build" && data?.zipPath) {
    console.error(`Downloaded: ${data.zipPath}`);
    if (data.extractedPath) {
      console.error(`Extracted: ${data.extractedPath}`);
      console.error("");
    }

    const meta = [];
    if (data.model) meta.push(data.model);
    if (Number.isFinite(data.buildDuration)) meta.push(`built ${data.buildDuration}s`);
    if (Number.isFinite(data.tookMs)) meta.push(`${(data.tookMs / 1000).toFixed(1)}s total`);
    if (meta.length > 0) {
      console.error(`[${meta.join(" | ")}]`);
    }
  } else if (tool === "perplexity" && data?.response) {
    console.log(data.response);
    const meta = [];
    if (data.sources) meta.push(`${data.sources} sources`);
    if (data.mode) meta.push(data.mode);
    if (data.model && data.model !== 'default') meta.push(data.model);
    meta.push(`${((data.tookMs || 0) / 1000).toFixed(1)}s`);
    console.error(`\n[${meta.join(' | ')}]`);
    if (data.url) console.error(`URL: ${data.url}`);
  } else if (tool === "window.list" && data?.windows) {
    if (data.windows.length === 0) {
      console.log("No windows. Use 'surf window.new' to create one.");
    } else {
      for (const w of data.windows) {
        const focused = w.focused ? " [focused]" : "";
        const state = w.state !== "normal" ? ` (${w.state})` : "";
        console.log(`${w.id}\t${w.tabCount} tabs\t${w.width}x${w.height}${focused}${state}`);
        if (w.tabs) {
          for (const t of w.tabs) {
            const active = t.active ? "*" : " ";
            console.log(`  ${active} ${t.id}\t${t.title || "(no title)"}\t${t.url || ""}`);
          }
        }
      }
      // Hint for agents
      if (data.windows.length > 0 && !globalOpts.windowId) {
        console.log("\n[hint] Use --window-id <id> to isolate commands to a specific window");
      }
    }
  } else if (typeof data === "string") {
    console.log(data);
  } else if (data?.success === true) {
    console.log("OK");
  } else if (data?.error) {
    if (softFail) {
      console.warn("Warning:", data.error);
      socket.end();
      process.exit(0);
    }
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
