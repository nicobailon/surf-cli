#!/usr/bin/env node
const net = require("net");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const SOCKET_PATH = process.platform === "win32" ? "//./pipe/surf" : "/tmp/surf.sock";
const REQUEST_TIMEOUT = 30000;

const TOOL_SCHEMAS = {
  navigate: {
    desc: "Navigate browser to URL",
    schema: { url: z.string().describe("URL to navigate to") }
  },
  screenshot: {
    desc: "Capture screenshot of current page",
    schema: {
      output: z.string().optional().describe("Save to file path"),
      selector: z.string().optional().describe("Capture specific element")
    }
  },
  "page.read": {
    desc: "Get page accessibility tree for element refs",
    schema: {
      ref: z.string().optional().describe("Get specific element by ref")
    }
  },
  "page.text": {
    desc: "Extract all text content from page",
    schema: {}
  },
  "page.state": {
    desc: "Get page state (modals, loading indicators, etc.)",
    schema: {}
  },
  click: {
    desc: "Click element by ref or coordinates",
    schema: {
      ref: z.string().optional().describe("Element ref from page.read"),
      x: z.number().optional().describe("X coordinate"),
      y: z.number().optional().describe("Y coordinate"),
      button: z.enum(["left", "right", "double", "triple"]).optional().describe("Click type"),
      selector: z.string().optional().describe("CSS selector (js method)")
    }
  },
  type: {
    desc: "Type text into focused element",
    schema: {
      text: z.string().describe("Text to type"),
      selector: z.string().optional().describe("CSS selector"),
      submit: z.boolean().optional().describe("Press enter after"),
      clear: z.boolean().optional().describe("Clear field first")
    }
  },
  key: {
    desc: "Press keyboard key",
    schema: {
      key: z.string().describe("Key to press (Enter, Escape, cmd+a, ctrl+shift+p, etc.)")
    }
  },
  hover: {
    desc: "Hover over element",
    schema: {
      ref: z.string().optional().describe("Element ref"),
      x: z.number().optional().describe("X coordinate"),
      y: z.number().optional().describe("Y coordinate")
    }
  },
  drag: {
    desc: "Drag between two points",
    schema: {
      from: z.string().optional().describe("Start x,y coordinates"),
      to: z.string().optional().describe("End x,y coordinates")
    }
  },
  "scroll.top": {
    desc: "Scroll to top of page",
    schema: { selector: z.string().optional().describe("Target specific container") }
  },
  "scroll.bottom": {
    desc: "Scroll to bottom of page",
    schema: { selector: z.string().optional().describe("Target specific container") }
  },
  "scroll.to": {
    desc: "Scroll element into view",
    schema: { ref: z.string().describe("Element ref from page.read") }
  },
  "scroll.info": {
    desc: "Get scroll position info",
    schema: { selector: z.string().optional().describe("Target specific container") }
  },
  "tab.list": {
    desc: "List all open browser tabs",
    schema: {}
  },
  "tab.new": {
    desc: "Open new tab",
    schema: {
      url: z.string().describe("URL to open"),
      urls: z.string().optional().describe("Multiple URLs (space-separated)")
    }
  },
  "tab.switch": {
    desc: "Switch to tab by ID or name",
    schema: { id: z.string().describe("Tab ID or registered name") }
  },
  "tab.close": {
    desc: "Close tab by ID or name",
    schema: {
      id: z.string().optional().describe("Tab ID or name"),
      ids: z.string().optional().describe("Multiple tab IDs")
    }
  },
  "tab.name": {
    desc: "Register current tab with a name",
    schema: { name: z.string().describe("Name for the tab") }
  },
  "tab.unname": {
    desc: "Unregister a named tab",
    schema: { name: z.string().describe("Tab name to unregister") }
  },
  "tab.named": {
    desc: "List all named tabs",
    schema: {}
  },
  js: {
    desc: "Execute JavaScript in page context",
    schema: {
      code: z.string().describe("JavaScript code to execute (use 'return' for values)")
    }
  },
  wait: {
    desc: "Wait for specified duration",
    schema: { duration: z.number().describe("Seconds to wait (max 30)") }
  },
  "wait.element": {
    desc: "Wait for element to appear",
    schema: {
      selector: z.string().describe("CSS selector"),
      timeout: z.number().optional().describe("Timeout in ms")
    }
  },
  "wait.network": {
    desc: "Wait for network to be idle",
    schema: { timeout: z.number().optional().describe("Timeout in ms") }
  },
  "wait.url": {
    desc: "Wait for URL to match pattern",
    schema: {
      pattern: z.string().describe("URL pattern to match"),
      timeout: z.number().optional().describe("Timeout in ms")
    }
  },
  "wait.dom": {
    desc: "Wait for DOM to stabilize",
    schema: {
      stable: z.number().optional().describe("Stability window in ms"),
      timeout: z.number().optional().describe("Max wait time in ms")
    }
  },
  "wait.load": {
    desc: "Wait for page to fully load",
    schema: { timeout: z.number().optional().describe("Max wait time in ms") }
  },
  console: {
    desc: "Read browser console messages",
    schema: {
      clear: z.boolean().optional().describe("Clear after reading"),
      level: z.string().optional().describe("Filter by level (log,warn,error)")
    }
  },
  network: {
    desc: "Read network requests",
    schema: {
      clear: z.boolean().optional().describe("Clear after reading"),
      filter: z.string().optional().describe("Filter by URL pattern")
    }
  },
  health: {
    desc: "Health check - wait for URL response or element",
    schema: {
      url: z.string().optional().describe("URL to check (expects 200)"),
      selector: z.string().optional().describe("CSS selector to wait for"),
      expect: z.number().optional().describe("Expected status code"),
      timeout: z.number().optional().describe("Timeout in ms")
    }
  },
  "dialog.accept": {
    desc: "Accept current browser dialog",
    schema: { text: z.string().optional().describe("Text for prompt input") }
  },
  "dialog.dismiss": {
    desc: "Dismiss current browser dialog",
    schema: {}
  },
  "dialog.info": {
    desc: "Get current dialog info",
    schema: {}
  },
  "emulate.network": {
    desc: "Emulate network conditions",
    schema: { preset: z.string().describe("Network preset (slow-3g, fast-3g, offline)") }
  },
  "emulate.cpu": {
    desc: "Throttle CPU",
    schema: { rate: z.number().describe("Throttle rate (>= 1)") }
  },
  "emulate.geo": {
    desc: "Override geolocation",
    schema: {
      lat: z.number().optional().describe("Latitude"),
      lon: z.number().optional().describe("Longitude"),
      accuracy: z.number().optional().describe("Accuracy in meters"),
      clear: z.boolean().optional().describe("Clear override")
    }
  },
  "form.fill": {
    desc: "Batch fill form fields",
    schema: { data: z.string().describe("JSON array of {ref, value}") }
  },
  "perf.start": {
    desc: "Start performance trace",
    schema: { categories: z.string().optional().describe("Trace categories (comma-separated)") }
  },
  "perf.stop": {
    desc: "Stop trace and get metrics",
    schema: {}
  },
  "perf.metrics": {
    desc: "Get current performance metrics",
    schema: {}
  },
  upload: {
    desc: "Upload file(s) to input",
    schema: {
      ref: z.string().describe("Element ref (e.g., e5)"),
      files: z.string().describe("File path(s) comma-separated")
    }
  },
  "frame.list": {
    desc: "List all frames in page",
    schema: {}
  },
  "frame.js": {
    desc: "Execute JS in specific frame",
    schema: {
      id: z.string().describe("Frame ID from frame.list"),
      code: z.string().describe("JavaScript code")
    }
  },
  smart_type: {
    desc: "Type into specific element with options",
    schema: {
      selector: z.string().describe("CSS selector"),
      text: z.string().describe("Text to type"),
      clear: z.boolean().optional().describe("Clear first"),
      submit: z.boolean().optional().describe("Submit after")
    }
  },
  ai: {
    desc: "AI-powered page analysis (requires GOOGLE_API_KEY)",
    schema: {
      query: z.string().describe("Question about the page"),
      mode: z.enum(["find", "summary", "extract"]).optional().describe("Query mode")
    }
  }
};

function sendSocketRequest(tool, args = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(SOCKET_PATH, () => {
      const req = {
        type: "tool_request",
        method: "execute_tool",
        params: { tool, args },
        id: "mcp-" + Date.now() + "-" + Math.random()
      };
      sock.write(JSON.stringify(req) + "\n");
    });

    let buf = "";
    const timeout = setTimeout(() => {
      sock.destroy();
      reject(new Error("Request timeout"));
    }, REQUEST_TIMEOUT);

    sock.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          clearTimeout(timeout);
          const resp = JSON.parse(line);
          sock.end();
          resolve(resp);
        } catch {
          clearTimeout(timeout);
          sock.end();
          reject(new Error("Invalid JSON response"));
        }
      }
    });

    sock.on("error", (e) => {
      clearTimeout(timeout);
      if (e.code === "ENOENT") {
        reject(new Error("Socket not found. Is Chrome running with the surf extension?"));
      } else {
        reject(e);
      }
    });

    sock.on("close", () => {
      clearTimeout(timeout);
      reject(new Error("Socket closed unexpectedly"));
    });
  });
}

function formatResult(resp) {
  if (resp.error) {
    const errText = resp.error.content?.[0]?.text || JSON.stringify(resp.error);
    return { content: [{ type: "text", text: errText }], isError: true };
  }

  const content = resp.result?.content || [];
  const formatted = [];

  for (const item of content) {
    if (item.type === "text") {
      formatted.push({ type: "text", text: item.text });
    } else if (item.type === "image") {
      formatted.push({
        type: "image",
        data: item.data,
        mimeType: item.mimeType || "image/png"
      });
    }
  }

  if (formatted.length === 0) {
    formatted.push({ type: "text", text: "OK" });
  }

  return { content: formatted };
}

class PiChromeMcpServer {
  constructor() {
    this.server = new McpServer({
      name: "surf",
      version: "1.0.0"
    });
    this.registerTools();
    this.registerResources();
  }

  registerTools() {
    for (const [name, def] of Object.entries(TOOL_SCHEMAS)) {
      const schemaObj = {};
      for (const [key, val] of Object.entries(def.schema)) {
        schemaObj[key] = val;
      }

      this.server.tool(
        name,
        def.desc,
        schemaObj,
        async (args) => {
          try {
            const resp = await sendSocketRequest(name, args);
            return formatResult(resp);
          } catch (err) {
            return {
              content: [{ type: "text", text: `Error: ${err.message}` }],
              isError: true
            };
          }
        }
      );
    }
  }

  registerResources() {
    this.server.resource(
      "page",
      "page://current",
      async (uri) => {
        try {
          const resp = await sendSocketRequest("page.read", {});
          const text = resp.result?.content?.[0]?.text || "No content";
          return {
            contents: [{
              uri: uri.href,
              text,
              mimeType: "text/plain"
            }]
          };
        } catch (err) {
          return {
            contents: [{
              uri: uri.href,
              text: `Error: ${err.message}`,
              mimeType: "text/plain"
            }]
          };
        }
      }
    );

    this.server.resource(
      "tabs",
      "tabs://list",
      async (uri) => {
        try {
          const resp = await sendSocketRequest("tab.list", {});
          const text = resp.result?.content?.[0]?.text || "[]";
          return {
            contents: [{
              uri: uri.href,
              text,
              mimeType: "application/json"
            }]
          };
        } catch (err) {
          return {
            contents: [{
              uri: uri.href,
              text: `Error: ${err.message}`,
              mimeType: "text/plain"
            }]
          };
        }
      }
    );

    this.server.resource(
      "console",
      "console://messages",
      async (uri) => {
        try {
          const resp = await sendSocketRequest("console", {});
          const text = resp.result?.content?.[0]?.text || "No messages";
          return {
            contents: [{
              uri: uri.href,
              text,
              mimeType: "text/plain"
            }]
          };
        } catch (err) {
          return {
            contents: [{
              uri: uri.href,
              text: `Error: ${err.message}`,
              mimeType: "text/plain"
            }]
          };
        }
      }
    );

    this.server.resource(
      "network",
      "network://requests",
      async (uri) => {
        try {
          const resp = await sendSocketRequest("network", {});
          const text = resp.result?.content?.[0]?.text || "No requests";
          return {
            contents: [{
              uri: uri.href,
              text,
              mimeType: "text/plain"
            }]
          };
        } catch (err) {
          return {
            contents: [{
              uri: uri.href,
              text: `Error: ${err.message}`,
              mimeType: "text/plain"
            }]
          };
        }
      }
    );
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Pi Chrome MCP Server started");
  }
}

async function main() {
  const server = new PiChromeMcpServer();
  await server.start();
}

if (require.main === module) {
  main().catch((err) => {
    console.error("MCP Server error:", err.message);
    process.exit(1);
  });
}

module.exports = { PiChromeMcpServer };
