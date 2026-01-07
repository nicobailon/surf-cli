#!/usr/bin/env node
const net = require("net");
const fs = require("fs");
const { loadConfig, getConfigPath, createStarterConfig } = require("./config.cjs");
const networkFormatters = require("./formatters/network.cjs");
const networkStore = require("./network-store.cjs");

const SOCKET_PATH = "/tmp/surf.sock";
const args = process.argv.slice(2);
const VERSION = "2.0.0";

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
        desc: "Send prompt to Gemini (uses browser cookies) [coming soon]", 
        args: ["query"], 
        opts: { 
          "with-page": "Include current page context",
          model: "Model: gemini-3-pro, gemini-2.5-pro, gemini-2.5-flash",
          file: "Attach file",
          "generate-image": "Generate image from prompt",
          "edit-image": "Edit existing image",
          output: "Output file path for generated images",
          timeout: "Timeout in seconds (default: 300 = 5min)"
        },
        examples: [
          { cmd: 'gemini "explain this"', desc: "Basic query" },
          { cmd: 'gemini "summarize" --with-page', desc: "With page context" },
          { cmd: 'gemini --generate-image "a robot surfing"', desc: "Generate image" },
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
        desc: "Capture screenshot (auto-resized for LLM by default)", 
        args: [], 
        opts: { 
          output: "Save to file", 
          selector: "Capture specific element", 
          annotate: "Draw element labels", 
          fullpage: "Capture full page", 
          "max-height": "Max height for fullpage (default: 4000)",
          full: "Skip resize, save at full resolution",
          "max-size": "Max dimension in px (default: 1200)" 
        },
        examples: [
          { cmd: "screenshot --output /tmp/shot.png", desc: "Save to file (auto-resized)" },
          { cmd: "screenshot --full --output /tmp/shot.png", desc: "Full resolution" },
          { cmd: "screenshot --max-size 800 --output /tmp/small.png", desc: "Custom max size" },
          { cmd: "screenshot --annotate --output /tmp/annotated.png", desc: "With element labels" },
          { cmd: "snap", desc: "Auto-save to /tmp (resized)" },
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
        args: [], 
        opts: { direction: "up|down|left|right", amount: "Scroll amount (1-10)" },
        examples: [{ cmd: "scroll --direction down --amount 3", desc: "Scroll down" }]
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
        desc: "Get accessibility tree", 
        args: [], 
        opts: { all: "Include all elements", ref: "Get specific element" },
        examples: [
          { cmd: "page.read", desc: "Interactive elements only" },
          { cmd: "page.read --all", desc: "All elements" },
          { cmd: "read", desc: "Alias" },
        ]
      },
      "read": { desc: "Alias for page.read", args: [], alias: "page.read" },
      "page.text": { desc: "Extract all text from page", args: [] },
      "page.state": { desc: "Get page state (modals, loading, etc.)", args: [] },
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
        opts: { har: "Export as HAR", jsonl: "Export as JSONL", output: "Output file path" },
        examples: [
          { cmd: "network.export --har", desc: "Export as HAR" }
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
      "frame.list": { desc: "List all frames in page", args: [] },
      "frame.js": { desc: "Execute JS in specific frame", args: [], opts: { id: "Frame ID from frame.list", code: "JavaScript code" } },
    }
  },
  cookie: {
    desc: "Cookie management",
    commands: {
      "cookie.list": { 
        desc: "List all cookies for current tab's domain", 
        args: [],
        examples: [{ cmd: "cookie.list", desc: "Show all cookies" }]
      },
      "cookie.get": { desc: "Get specific cookie", args: [], opts: { name: "Cookie name" } },
      "cookie.set": { 
        desc: "Set a cookie", 
        args: [], 
        opts: { name: "Cookie name", value: "Cookie value", expires: "Expiry date (optional)" },
        examples: [{ cmd: 'cookie.set --name "session" --value "abc123"', desc: "Set cookie" }]
      },
      "cookie.clear": { 
        desc: "Clear cookies", 
        args: [], 
        opts: { name: "Specific cookie (optional)", all: "Clear all for domain" },
        examples: [
          { cmd: 'cookie.clear --name "session"', desc: "Clear one" },
          { cmd: "cookie.clear --all", desc: "Clear all" },
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
        args: [], 
        opts: { width: "Window width", height: "Window height" },
        examples: [{ cmd: "resize --width 1280 --height 720", desc: "Set size" }]
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
  cookie.list           List all cookies
  cookie.get --name X   Get specific cookie
  cookie.set            Set a cookie
  cookie.clear          Clear cookies

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
  screenshot --annotate --fullpage --output file.png    Full page with labels
  snap                                                  Auto-save to /tmp

Options:
  --output      Save path
  --annotate    Draw element refs
  --fullpage    Capture entire page
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
  screenshot --fullpage --output full.png`
  },
};

const ALL_SOCKET_TOOLS = [
  "ai", "screenshot", "navigate",
  "form_input", "find_and_type", "autocomplete", "set_value", "smart_type",
  "scroll_to_position", "get_scroll_info", "close_dialogs", "page_state",
  "javascript_tool", "health", "smoke",
  "click_type", "click_type_submit", "type", "key", "type_submit",
  "scroll", "scroll_to", "hover", "left_click_drag", "drag", "wait",
  "computer",
  "page.read", "page.text", "page.state",
  "tab.list", "tab.new", "tab.switch", "tab.close", "tab.name", "tab.unname", "tab.named",
  "tab.group", "tab.ungroup", "tab.groups", "tab.reload",
  "scroll.top", "scroll.bottom", "scroll.to", "scroll.info",
  "wait.element", "wait.network", "wait.url", "wait.dom", "wait.load",
  "click", "hover", "drag",
  "js", "console", "network", 
  "network.get", "network.body", "network.curl", "network.origins", 
  "network.clear", "network.stats", "network.export", "network.path",
  "dialog.accept", "dialog.dismiss", "dialog.info",
  "emulate.network", "emulate.cpu", "emulate.geo",
  "form.fill",
  "perf.start", "perf.stop", "perf.metrics",
  "upload",
  "frame.list", "frame.js",
  "cookie.list", "cookie.get", "cookie.set", "cookie.clear",
  "search", "batch",
  "zoom", "resize",
  "back", "forward",
  "bookmark.add", "bookmark.remove", "bookmark.list",
  "history.list", "history.search",
];

const showBasicHelp = () => {
  console.log(`surf v${VERSION} - Browser automation CLI

Usage: surf <command> [args] [options]

Common Commands:
  navigate <url>     Go to URL (alias: go)
  click <ref>        Click element by ref or selector
  type <text>        Type text at cursor or into element
  screenshot         Capture screenshot (alias: snap)
  page.read          Get page accessibility tree (alias: read)
  search <term>      Search for text in page (alias: find)
  wait <seconds>     Wait N seconds

Quick Examples:
  surf go "https://example.com"
  surf read
  surf click e5
  surf type "hello" --submit
  surf snap

More Help:
  surf --help-full           All commands
  surf --help-topic <topic>  Topic guide (refs, selectors, cookies, batch, screenshots, automation)
  surf <command> --help      Command details
  surf --find <query>        Search for commands
  surf --about <topic>       Learn about a topic
`);
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
  --json            Output raw JSON
  --auto-capture    On error: capture screenshot + console to /tmp
  --soft-fail       On error: warn and exit 0 (for non-critical commands)

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
      return;
    }
  }
  if (ALL_SOCKET_TOOLS.includes(toolName)) {
    console.log(`\n  ${toolName}\n`);
    console.log("  Socket API tool. Use --json to see response format.\n");
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
  const path = require("path");
  const distPath = path.resolve(__dirname, "../dist");
  console.log(distPath);
  process.exit(0);
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
                  Values: chrome, chromium, brave, edge, arc, all
                  Multiple: --browser chrome,brave

Examples:
  surf install hnfbepgmaoklhekckbpjnleifhahkcpl
  surf install hnfbepgmaoklhekckbpjnleifhahkcpl --browser brave
  surf install hnfbepgmaoklhekckbpjnleifhahkcpl --browser all
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
                  Values: chrome, chromium, brave, edge, arc, all
  -a, --all       Uninstall from all browsers and remove wrapper

Examples:
  surf uninstall
  surf uninstall --browser brave
  surf uninstall --all
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

const BOOLEAN_FLAGS = ["auto-capture", "json", "stream", "dry-run", "stop-on-error", "fail-fast", "clear", "submit", "all", "case-sensitive", "hard", "annotate", "fullpage", "reset", "no-screenshot", "full", "soft-fail", "has-body", "exclude-static", "v", "vv", "request", "by-tab", "har", "jsonl"];

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
  console.error("Error: No command specified");
  process.exit(1);
}

if (REMOVED_COMMANDS[tool]) {
  console.error(`Error: Unknown command: ${tool}`);
  console.error(`This command was renamed. Use: ${REMOVED_COMMANDS[tool]}`);
  process.exit(1);
}

const wasSnap = tool === "snap";
tool = ALIASES[tool] || tool;

if (wasSnap && !options.output && !options.savePath) {
  options.savePath = `/tmp/surf-snap-${Date.now()}.png`;
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
  "wait.element": "selector",
  "wait.url": "pattern",
  zoom: "level",
  "history.search": "query",
  "network.get": "id",
  "network.body": "id",
  "network.curl": "id",
  "network.path": "id",
};

const toolArgs = { ...options };

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

if (toolArgs.into && !toolArgs.selector) {
  toolArgs.selector = toolArgs.into;
  delete toolArgs.into;
}

const globalOpts = {};
if (toolArgs["tab-id"] !== undefined) {
  globalOpts.tabId = toolArgs["tab-id"];
  delete toolArgs["tab-id"];
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

if (!noScreenshot && AUTO_SCREENSHOT_TOOLS.includes(tool)) {
  toolArgs.autoScreenshot = true;
}

const outputPath = toolArgs.output;
delete toolArgs.output;

if ((tool === "screenshot" || tool === "snap") && outputPath) {
  if (typeof outputPath !== "string") {
    console.error("Error: --output requires a file path");
    process.exit(1);
  }
  toolArgs.savePath = outputPath;
  if (options.full) toolArgs.full = true;
  if (options["max-size"]) toolArgs["max-size"] = options["max-size"];
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
  const screenshotPath = `/tmp/surf-error-${timestamp}.png`;

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

  if (wantJson) {
    console.log(JSON.stringify(data, null, 2));
    socket.end();
    process.exit(0);
  }

  if ((tool === "screenshot" || tool === "snap") && data?.base64 && (outputPath || toolArgs.savePath)) {
    const saveTo = outputPath || toolArgs.savePath;
    fs.writeFileSync(saveTo, Buffer.from(data.base64, "base64"));
    
    const skipResize = options.full || toolArgs.full;
    const maxSize = parseInt(options["max-size"] || toolArgs["max-size"] || "1200", 10);
    const origWidth = data.width || 0;
    const origHeight = data.height || 0;
    
    if (!skipResize && (origWidth > maxSize || origHeight > maxSize)) {
      try {
        const { execSync } = require("child_process");
        execSync(`sips --resampleHeightWidthMax ${maxSize} "${saveTo}" --out "${saveTo}" 2>/dev/null`, { stdio: "pipe" });
        const sizeInfo = execSync(`sips -g pixelWidth -g pixelHeight "${saveTo}" 2>/dev/null`, { encoding: "utf8" });
        const newWidth = sizeInfo.match(/pixelWidth:\s*(\d+)/)?.[1] || "?";
        const newHeight = sizeInfo.match(/pixelHeight:\s*(\d+)/)?.[1] || "?";
        console.log(`Saved to ${saveTo} (${newWidth}x${newHeight}, resized from ${origWidth}x${origHeight})`);
      } catch (e) {
        console.log(`Saved to ${saveTo} (${origWidth}x${origHeight}, resize failed: ${e.message})`);
      }
    } else {
      console.log(`Saved to ${saveTo} (${origWidth}x${origHeight})`);
    }
  } else if ((tool === "screenshot" || tool === "snap") && data?.message) {
    console.log(data.message);
  } else if (tool === "tab.list") {
    const tabs = data?.tabs || data || [];
    if (Array.isArray(tabs)) {
      for (const t of tabs) {
        console.log(`${t.id}\t${t.title}\t${t.url}`);
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
