#!/usr/bin/env node
const net = require("net");
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const chatgptClient = require("./chatgpt-client.cjs");

const SOCKET_PATH = "/tmp/surf.sock";

const aiRequestQueue = [];
let aiRequestInProgress = false;

function queueAiRequest(handler) {
  return new Promise((resolve, reject) => {
    aiRequestQueue.push({ handler, resolve, reject });
    processAiQueue();
  });
}

async function processAiQueue() {
  if (aiRequestInProgress || aiRequestQueue.length === 0) return;
  aiRequestInProgress = true;
  const { handler, resolve, reject } = aiRequestQueue.shift();
  try {
    const result = await handler();
    resolve(result);
  } catch (err) {
    reject(err);
  } finally {
    aiRequestInProgress = false;
    setTimeout(processAiQueue, 2000);
  }
}
const LOG_FILE = "/tmp/surf-host.log";
const AUTH_FILE = path.join(os.homedir(), ".pi", "agent", "auth.json");

const DEFAULT_RETRY_OPTIONS = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffFactor: 2,
  retryableStatusCodes: [429, 500, 502, 503, 504]
};

async function withRetry(fn, retryOptions = DEFAULT_RETRY_OPTIONS, retryCount = 0) {
  try {
    return await fn();
  } catch (error) {
    if (retryCount >= retryOptions.maxRetries) {
      throw error;
    }
    
    let isRetryable = false;
    if (error instanceof Error) {
      const statusCodeMatch = error.message.match(/status code (\d+)/i);
      if (statusCodeMatch) {
        const statusCode = parseInt(statusCodeMatch[1], 10);
        isRetryable = retryOptions.retryableStatusCodes.includes(statusCode);
      } else {
        const isNetworkError = error.message.includes('network') || 
                          error.message.includes('timeout') ||
                          error.message.includes('connection');
        const isContentError = error.message.includes('exceeds maximum') ||
                          error.message.includes('too large') ||
                          error.message.includes('token limit');
        isRetryable = isNetworkError && !isContentError;
      }
    }
    
    if (!isRetryable) {
      throw error;
    }
    
    const delay = Math.min(
      retryOptions.initialDelayMs * Math.pow(retryOptions.backoffFactor, retryCount),
      retryOptions.maxDelayMs
    );
    const jitter = 0.8 + Math.random() * 0.4;
    const delayWithJitter = Math.floor(delay * jitter);
    
    await new Promise(resolve => setTimeout(resolve, delayWithJitter));
    return withRetry(fn, retryOptions, retryCount + 1);
  }
}

const AI_PROMPTS = {
  find: (query, pageContext) => `You are analyzing a web page's accessibility tree. Find the element matching the user's description.

Page Context:
${pageContext}

User Query: "${query}"

Respond with ONLY the element ref (e.g., "e5") or "NOT_FOUND" if no match.`,

  summary: (query, pageContext) => `Summarize this web page based on its accessibility tree.

Page Context:
${pageContext}

${query ? `Focus on: ${query}` : ""}

Keep the summary under 300 characters. Focus on the page's purpose and main content.`,

  extract: (query, pageContext) => `Extract structured data from this web page based on the user's request.

Page Context:
${pageContext}

User Request: "${query}"

Respond with valid JSON only.`
};

function detectQueryMode(query) {
  const q = query.toLowerCase();
  if (q.includes("find") || q.includes("where is") || q.includes("locate") || 
      q.includes("click") || q.includes("button") || q.includes("link") ||
      q.includes("input") || q.includes("field")) {
    return "find";
  }
  if (q.includes("summarize") || q.includes("summary") || q.includes("what is this") ||
      q.includes("about") || q.includes("describe") || q.includes("overview")) {
    return "summary";
  }
  if (q.includes("list") || q.includes("extract") || q.includes("all the") ||
      q.includes("get all") || q.includes("show all") || q.includes("json")) {
    return "extract";
  }
  return "summary";
}

let geminiClientCache = null;

function getGeminiClient(apiKey) {
  if (!geminiClientCache || geminiClientCache.apiKey !== apiKey) {
    geminiClientCache = { client: new GeminiClient(apiKey), apiKey };
  }
  return geminiClientCache.client;
}

class GeminiClient {
  constructor(apiKey) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  }

  async analyze(query, pageContext, options = {}) {
    const mode = options.mode || detectQueryMode(query);
    const promptFn = AI_PROMPTS[mode];
    const prompt = promptFn(query, pageContext);
    
    const result = await withRetry(async () => {
      const response = await this.model.generateContent(prompt);
      return response.response.text();
    });
    
    let content = result.trim();
    
    if (mode === "extract") {
      content = content.replace(/^```(?:json)?\n?|\n?```$/g, '').trim();
    }
    
    return { mode, content };
  }
}



async function handleApiRequest(msg, sendResponse) {
  const { url, method, headers, body, streamId } = msg;
  
  log(`API_REQUEST: ${method} ${url} streamId=${streamId}`);
  
  try {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: method || "POST",
      headers: headers || {},
    };

    const req = https.request(options, (res) => {
      log(`API response status: ${res.statusCode}`);
      
      sendResponse({ 
        type: "API_RESPONSE_START", 
        streamId,
        status: res.statusCode,
        headers: res.headers,
      });

      res.on("data", (chunk) => {
        sendResponse({
          type: "API_RESPONSE_CHUNK",
          streamId,
          chunk: chunk.toString("utf8"),
        });
      });

      res.on("end", () => {
        sendResponse({
          type: "API_RESPONSE_END",
          streamId,
        });
      });

      res.on("error", (err) => {
        log(`API response error: ${err.message}`);
        sendResponse({
          type: "API_RESPONSE_ERROR",
          streamId,
          error: err.message,
        });
      });
    });

    req.on("error", (err) => {
      log(`API request error: ${err.message}`);
      sendResponse({
        type: "API_RESPONSE_ERROR",
        streamId,
        error: err.message,
      });
    });

    if (body) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  } catch (err) {
    log(`API_REQUEST error: ${err.message}`);
    sendResponse({
      type: "API_RESPONSE_ERROR",
      streamId,
      error: err.message,
    });
  }
}

const log = (msg) => {
  fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`);
};

log("Host starting...");

try {
  fs.unlinkSync(SOCKET_PATH);
} catch {}

const pendingRequests = new Map();
const pendingToolRequests = new Map();
const activeStreams = new Map();
let requestCounter = 0;

function sendToolResponse(socket, id, result, error) {
  const response = { type: "tool_response", id };
  
  if (error) {
    response.error = { content: [{ type: "text", text: error }] };
  } else {
    response.result = { content: formatToolContent(result) };
  }
  
  try {
    socket.write(JSON.stringify(response) + "\n");
  } catch (e) {
    log(`Error sending tool_response: ${e.message}`);
  }
}

function formatToolContent(result) {
  const text = (s) => [{ type: "text", text: s }];
  
  if (!result) return text("OK");
  
  if (result.aiResult) {
    if (result.mode === "find") {
      return text(result.ref || "NOT_FOUND");
    }
    return text(result.content);
  }
  
  if (result.messages && Array.isArray(result.messages)) {
    const formatted = result.messages.map(m => {
      let loc = "";
      if (m.url) loc = m.line !== undefined ? ` (${m.url}:${m.line})` : ` (${m.url})`;
      return `[${m.type}] ${m.text}${loc}`;
    }).join("\n");
    return text(formatted || "No console messages");
  }

  if (result.requests && Array.isArray(result.requests)) {
    if (result.requests.length === 0) {
      return text("No network requests captured");
    }
    const formatted = result.requests.map(r => {
      const status = String(r.status || '-').padStart(3);
      const method = (r.method || 'GET').padEnd(7);
      const type = (r.type || '').padEnd(10);
      return `${status} ${method} ${type} ${r.url}`;
    }).join("\n");
    return text(formatted);
  }

  if (result.output !== undefined) {
    return text(result.output);
  }

  if (result.screenshotId) {
    const dims = result.width && result.height 
      ? `${result.width}x${result.height}` 
      : "unknown dimensions";
    return [
      { type: "text", text: `Screenshot captured (${dims}) - ID: ${result.screenshotId}` },
      { type: "image", data: result.base64, mimeType: "image/png" }
    ];
  }

  if (result.base64) {
    const dims = result.width && result.height 
      ? `${result.width}x${result.height}` 
      : "unknown dimensions";
    return [
      { type: "text", text: `Screenshot (${dims})` },
      { type: "image", data: result.base64, mimeType: "image/png" }
    ];
  }
  
  if (result.pageContent !== undefined) {
    const content = result.pageContent || "No content";
    let output = '';
    
    if (result.waited !== undefined) {
      output += `[Waited ${result.waited}ms]\n\n`;
    }
    
    output += content;
    
    if (result.isIncremental && result.diff) {
      output += `\n--- Diff from previous snapshot ---\n${result.diff}`;
    }
    
    if (result.modalStates && result.modalStates.length > 0) {
      output += `\n\n[ACTION REQUIRED] Modal blocking page - dismiss before proceeding:`;
      output += `\n  -> Press Escape key: computer(action="key", text="Escape")`;
      for (const modal of result.modalStates) {
        output += `\n  - ${modal.description}`;
      }
    }
    
    if (result.error) {
      return text(`Error: ${result.error}\n\n${output}`);
    }
    
    if (result.screenshot && result.screenshot.base64) {
      const dims = result.screenshot.width && result.screenshot.height 
        ? `${result.screenshot.width}x${result.screenshot.height}` 
        : "unknown";
      return [
        { type: "text", text: output },
        { type: "text", text: `\n[Screenshot included (${dims})]` },
        { type: "image", data: result.screenshot.base64, mimeType: "image/png" }
      ];
    }
    return text(output);
  }
  
  if (result.tabs) {
    return text(JSON.stringify(result.tabs, null, 2));
  }

  if (result.cookies && Array.isArray(result.cookies)) {
    return text(JSON.stringify(result.cookies, null, 2));
  }

  if (result.cookie) {
    return text(JSON.stringify(result.cookie, null, 2));
  }

  if (result.cleared !== undefined) {
    if (typeof result.cleared === "number") {
      return text(`Cleared ${result.cleared} cookies`);
    }
    return text(`Cleared cookie: ${result.cleared}`);
  }

  if (result.query !== undefined && result.matches) {
    const header = `Found ${result.count} matches for "${result.query}":`;
    if (result.matches.length === 0) return text(header);
    const matchList = result.matches.map(m => 
      `  ${m.ref}: "${m.text}" in "...${m.context}..."${m.elementRef ? ` [${m.elementRef}]` : ""}`
    ).join("\n");
    return text(`${header}\n${matchList}`);
  }

  if (result.groupId !== undefined && result.name !== undefined) {
    return text(`Tab group "${result.name}" (id: ${result.groupId}) with tabs: ${(result.tabIds || []).join(", ")}`);
  }

  if (result.ungrouped) {
    return text(`Ungrouped tabs: ${result.ungrouped.join(", ")}`);
  }

  if (result.groups && Array.isArray(result.groups)) {
    if (result.groups.length === 0) return text("No tab groups");
    const formatted = result.groups.map(g => {
      const tabList = g.tabs.map(t => `    ${t.id}: ${t.title}`).join("\n");
      return `${g.name} (${g.color}, ${g.tabs.length} tabs):\n${tabList}`;
    }).join("\n\n");
    return text(formatted);
  }

  if (result.completedActions !== undefined && result.totalActions !== undefined) {
    const status = result.success ? "SUCCESS" : "FAILED";
    const header = `Batch ${status}: ${result.completedActions}/${result.totalActions} actions completed`;
    if (result.results && result.results.length > 0) {
      const details = result.results.map(r => 
        `  [${r.index}] ${r.type}: ${r.success ? "OK" : "FAILED"}${r.error ? ` - ${r.error}` : ""}`
      ).join("\n");
      return text(`${header}\n${details}${result.error ? `\n\nError: ${result.error}` : ""}`);
    }
    return text(header);
  }

  if (result.zoom !== undefined) {
    return text(`Zoom: ${Math.round(result.zoom * 100)}%`);
  }

  if (result.bookmarks && Array.isArray(result.bookmarks)) {
    if (result.bookmarks.length === 0) return text("No bookmarks");
    const formatted = result.bookmarks.map(b => 
      `${b.title}\n  ${b.url}`
    ).join("\n\n");
    return text(formatted);
  }

  if (result.bookmark && result.bookmark.id) {
    return text(`Bookmarked: ${result.bookmark.title}\n  ${result.bookmark.url}`);
  }

  if (result.history && Array.isArray(result.history)) {
    if (result.history.length === 0) return text("No history");
    const formatted = result.history.map(h => {
      const date = h.lastVisitTime ? new Date(h.lastVisitTime).toLocaleString() : "unknown";
      return `${h.title || "(no title)"}\n  ${h.url}\n  Last visited: ${date}`;
    }).join("\n\n");
    return text(formatted);
  }
  
  if (result.text !== undefined) {
    const textContent = result.text || "No text content";
    let output = "";
    if (result.title) output += `Title: ${result.title}\n`;
    if (result.url) output += `URL: ${result.url}\n`;
    if (output) output += "\n";
    output += textContent;
    if (result.error) {
      return text(`Error: ${result.error}\n\n${output}`);
    }
    return text(output);
  }
  
  if (result.success && result.name && result.tabId !== undefined) {
    return text(`Registered tab ${result.tabId} as "${result.name}"`);
  }

  if (result.success && result.tabId && result.title !== undefined) {
    return text(`Switched to tab ${result.tabId}: ${result.title}`);
  }

  if (result.success && result.tabId && result.url) {
    return text(`Created tab ${result.tabId}: ${result.url}`);
  }

  if (result.success && result.closed) {
    return text(`Closed ${result.closed.length} tabs: ${result.closed.join(", ")}`);
  }

  if (result.success && result.tabId && !result.url) {
    return text(`Closed tab ${result.tabId}`);
  }

  if (result.success && result.width && result.height) {
    return text(`Resized window to ${result.width}x${result.height}`);
  }

  if (result.autoScreenshot) {
    const { path: ssPath, width, height } = result.autoScreenshot;
    try {
      const imgData = fs.readFileSync(ssPath);
      const base64 = imgData.toString("base64");
      const dims = width && height ? `${width}x${height}` : "unknown";
      return [
        { type: "text", text: `OK\nScreenshot (${dims}): ${ssPath}` },
        { type: "image", data: base64, mimeType: "image/png" }
      ];
    } catch {
      return text(`OK\nScreenshot saved: ${ssPath}`);
    }
  }

  if (result.autoScreenshotError) {
    return text(`OK\n[Screenshot failed: ${result.autoScreenshotError}]`);
  }

  if (result.success) {
    if (result.metrics) {
      return text(JSON.stringify(result.metrics, null, 2));
    }
    if (result.frames) {
      return text(JSON.stringify(result.frames, null, 2));
    }
    if (result.readyState) {
      return text(`Page loaded (readyState: ${result.readyState})`);
    }
    return text("OK");
  }

  if (result.value !== undefined) {
    return text(typeof result.value === "string" ? result.value : JSON.stringify(result.value, null, 2));
  }
  
  return text(JSON.stringify(result));
}

function mapToolToMessage(tool, args, tabId) {
  const baseMsg = { tabId };
  const a = args || {};
  
  switch (tool) {
    case "computer":
      return mapComputerAction(args, tabId);
    case "navigate":
      return { type: "EXECUTE_NAVIGATE", url: a.url, ...baseMsg };
    case "read_page":
      return { 
        type: "READ_PAGE", 
        options: { 
          filter: a.filter || "interactive",
          depth: a.depth,
          refId: a.ref_id,
          format: a.format,
          forceFullSnapshot: a.forceFullSnapshot ?? false,
          includeScreenshot: a.includeScreenshot ?? false
        },
        ...baseMsg 
      };
    case "get_page_text":
      return { type: "GET_PAGE_TEXT", ...baseMsg };
    case "form_input":
      return { type: "FORM_INPUT", ref: a.ref, value: a.value, ...baseMsg };
    case "eval":
      return { type: "EVAL_IN_PAGE", code: a.code, ...baseMsg };
    case "find_and_type":
      return { type: "FIND_AND_TYPE", text: a.text, submit: a.submit ?? false, submitKey: a.submitKey || "Enter", ...baseMsg };
    case "autocomplete":
      return { type: "AUTOCOMPLETE_SELECT", text: a.text, ref: a.ref, coordinate: a.coordinate, index: a.index ?? 0, waitMs: a.waitMs ?? 500, ...baseMsg };
    case "set_value":
      return { type: "SET_INPUT_VALUE", selector: a.selector, ref: a.ref, value: a.value, ...baseMsg };
    case "smart_type":
      return { type: "SMART_TYPE", selector: a.selector, text: a.text, clear: a.clear ?? true, submit: a.submit ?? false, ...baseMsg };
    case "scroll_to_position":
      return { type: "SCROLL_TO_POSITION", position: a.position, selector: a.selector, ...baseMsg };
    case "get_scroll_info":
      return { type: "GET_SCROLL_INFO", selector: a.selector, ...baseMsg };
    case "close_dialogs":
      return { type: "CLOSE_DIALOGS", maxAttempts: a.maxAttempts ?? 3, ...baseMsg };
    case "page_state":
      return { type: "PAGE_STATE", ...baseMsg };
    case "tabs_context":
      return { type: "GET_TABS" };
    case "screenshot":
      return { 
        type: "EXECUTE_SCREENSHOT", 
        savePath: a.savePath,
        annotate: a.annotate || false,
        fullpage: a.fullpage || false,
        maxHeight: a["max-height"] || 4000,
        fullRes: a.full || false,
        maxSize: a["max-size"] || 1200,
        ...baseMsg 
      };
    case "javascript_tool":
      return { type: "EXECUTE_JAVASCRIPT", code: a.code, ...baseMsg };
    case "wait_for_element":
      return { 
        type: "WAIT_FOR_ELEMENT", 
        selector: a.selector,
        state: a.state || "visible",
        timeout: a.timeout || 20000,
        ...baseMsg 
      };
    case "wait_for_url":
      return { 
        type: "WAIT_FOR_URL", 
        pattern: a.pattern || a.url || a.urlContains,
        timeout: a.timeout || 20000,
        ...baseMsg 
      };
    case "wait_for_network_idle":
      return { 
        type: "WAIT_FOR_NETWORK_IDLE", 
        timeout: a.timeout || 10000,
        ...baseMsg 
      };
    case "console":
    case "read_console_messages":
      return { 
        type: "READ_CONSOLE_MESSAGES", 
        onlyErrors: a.only_errors,
        pattern: a.pattern,
        limit: a.limit,
        clear: a.clear,
        ...baseMsg 
      };
    case "network":
    case "get_network_entries":
      // Use READ_NETWORK_REQUESTS which is proven to work
      return { 
        type: "READ_NETWORK_REQUESTS", 
        urlPattern: a.filter || a.url_pattern || a.origin,
        limit: a.limit || a.last,
        ...baseMsg 
      };

    case "network.get":
    case "get_network_entry":
      return { 
        type: "GET_NETWORK_ENTRY", 
        requestId: a.id || args[0],
        ...baseMsg 
      };

    case "network.body":
      return { 
        type: "GET_RESPONSE_BODY", 
        requestId: a.id || args[0],
        isRequest: a.request,
        ...baseMsg 
      };

    case "network.curl":
      return { 
        type: "GET_NETWORK_ENTRY", 
        requestId: a.id || args[0],
        formatAsCurl: true,
        ...baseMsg 
      };

    case "network.origins":
      return { 
        type: "GET_NETWORK_ORIGINS",
        byTab: a["by-tab"] || a.byTab,
        ...baseMsg 
      };

    case "network.clear":
      return { 
        type: "CLEAR_NETWORK_REQUESTS",
        before: a.before,
        origin: a.origin,
        ...baseMsg 
      };

    case "network.stats":
      return { 
        type: "GET_NETWORK_STATS",
        ...baseMsg 
      };

    case "network.export":
      return { 
        type: "EXPORT_NETWORK_REQUESTS",
        har: a.har,
        jsonl: a.jsonl,
        output: a.output,
        ...baseMsg 
      };

    case "network.path":
      return { 
        type: "GET_NETWORK_PATHS",
        requestId: a.id || args[0],
        ...baseMsg 
      };

    case "read_network_requests":
      return { 
        type: "READ_NETWORK_REQUESTS", 
        urlPattern: a.url_pattern,
        limit: a.limit,
        clear: a.clear,
        ...baseMsg 
      };
    case "upload_image":
      return { 
        type: "UPLOAD_IMAGE", 
        screenshotId: a.screenshot_id,
        ref: a.ref,
        coordinate: a.coordinate,
        filename: a.filename,
        ...baseMsg 
      };
    case "resize_window":
      return { 
        type: "RESIZE_WINDOW", 
        width: a.width, 
        height: a.height, 
        ...baseMsg 
      };
    case "tabs_create":
      return { type: "TABS_CREATE", url: a.url, ...baseMsg };
    case "tabs_register":
      return { type: "TABS_REGISTER", name: a.name, ...baseMsg };
    case "tabs_get_by_name":
      return { type: "TABS_GET_BY_NAME", name: a.name };
    case "tabs_list_named":
      return { type: "TABS_LIST_NAMED" };
    case "tabs_unregister":
      return { type: "TABS_UNREGISTER", name: a.name };
    case "list_tabs":
      return { type: "LIST_TABS" };
    case "new_tab":
      return { type: "NEW_TAB", url: a.url, urls: a.urls };
    case "switch_tab":
      return { type: "SWITCH_TAB", tabId: a.tab_id || a.tabId };
    case "close_tab":
      return { type: "CLOSE_TAB", tabId: a.tab_id || a.tabId, tabIds: a.tab_ids || a.tabIds };
    case "tab.list":
      return { type: "LIST_TABS" };
    case "tab.new":
      return { type: "NEW_TAB", url: a.url, urls: a.urls };
    case "tab.switch": {
      const id = a.id || a.tab_id || a.tabId;
      if (typeof id === "string" && !/^\d+$/.test(id)) {
        return { type: "NAMED_TAB_SWITCH", name: id };
      }
      return { type: "SWITCH_TAB", tabId: id };
    }
    case "tab.close": {
      const id = a.id || a.tab_id || a.tabId;
      const ids = a.ids || a.tab_ids || a.tabIds;
      if (typeof id === "string" && !/^\d+$/.test(id)) {
        return { type: "NAMED_TAB_CLOSE", name: id };
      }
      return { type: "CLOSE_TAB", tabId: id, tabIds: ids };
    }
    case "tab.name":
      return { type: "TABS_REGISTER", name: a.name, ...baseMsg };
    case "tab.unname":
      return { type: "TABS_UNREGISTER", name: a.name };
    case "tab.named":
      return { type: "TABS_LIST_NAMED" };
    case "js":
      return { type: "EXECUTE_JAVASCRIPT", code: a.code, ...baseMsg };
    case "scroll.top":
      return { type: "SCROLL_TO_POSITION", position: "top", selector: a.selector, ...baseMsg };
    case "scroll.bottom":
      return { type: "SCROLL_TO_POSITION", position: "bottom", selector: a.selector, ...baseMsg };
    case "scroll.info":
      return { type: "GET_SCROLL_INFO", selector: a.selector, ...baseMsg };
    case "scroll.to":
      return { type: "SCROLL_TO_ELEMENT", ref: a.ref, ...baseMsg };
    case "wait.element":
      return { type: "WAIT_FOR_ELEMENT", selector: a.selector, timeout: a.timeout, ...baseMsg };
    case "wait.network":
      return { type: "WAIT_FOR_NETWORK_IDLE", timeout: a.timeout, ...baseMsg };
    case "wait.url":
      return { type: "WAIT_FOR_URL", pattern: a.pattern || a.url, timeout: a.timeout, ...baseMsg };
    case "wait.dom":
      return { type: "WAIT_FOR_DOM_STABLE", stable: a.stable || 100, timeout: a.timeout || 5000, ...baseMsg };
    case "wait.load":
      return { type: "WAIT_FOR_LOAD", timeout: a.timeout || 30000, ...baseMsg };
    case "frame.list":
      return { type: "GET_FRAMES", ...baseMsg };
    case "frame.js":
      return { type: "EVALUATE_IN_FRAME", frameId: a.id, code: a.code, ...baseMsg };
    case "dialog.accept":
      return { type: "DIALOG_ACCEPT", text: a.text, ...baseMsg };
    case "dialog.dismiss":
      if (a.all) return { type: "CLOSE_DIALOGS", maxAttempts: a.maxAttempts || 3, ...baseMsg };
      return { type: "DIALOG_DISMISS", ...baseMsg };
    case "dialog.info":
      return { type: "DIALOG_INFO", ...baseMsg };
    case "emulate.network":
      return { type: "EMULATE_NETWORK", preset: a.preset, ...baseMsg };
    case "emulate.cpu":
      const cpuRate = parseFloat(a.rate);
      return { type: "EMULATE_CPU", rate: isNaN(cpuRate) ? 1 : cpuRate, ...baseMsg };
    case "emulate.geo":
      if (a.clear) {
        return { type: "EMULATE_GEO", clear: true, ...baseMsg };
      }
      if (a.lat === undefined || a.lon === undefined) {
        throw new Error("--lat and --lon required");
      }
      return { type: "EMULATE_GEO", latitude: parseFloat(a.lat), longitude: parseFloat(a.lon), accuracy: parseFloat(a.accuracy) || 100, ...baseMsg };
    case "form.fill":
      let fillData = a.data;
      if (typeof fillData === "string") {
        try { fillData = JSON.parse(fillData); } catch (e) { throw new Error("invalid --data JSON"); }
      }
      return { type: "FORM_FILL", data: fillData, ...baseMsg };
    case "perf.start":
      return { type: "PERF_START", categories: a.categories ? a.categories.split(",") : undefined, ...baseMsg };
    case "perf.stop":
      return { type: "PERF_STOP", ...baseMsg };
    case "perf.metrics":
      return { type: "PERF_METRICS", ...baseMsg };
    case "upload":
      const files = a.files ? (typeof a.files === "string" ? a.files.split(",").map(f => f.trim()) : a.files) : [];
      return { type: "UPLOAD_FILE", ref: a.ref, files, ...baseMsg };
    case "page.read":
      return { type: "READ_PAGE", options: { filter: a.filter || "interactive", refId: a.ref }, ...baseMsg };
    case "page.text":
      return { type: "GET_PAGE_TEXT", ...baseMsg };
    case "page.state":
      return { type: "PAGE_STATE", ...baseMsg };
    case "ai":
      return { type: "AI_ANALYZE", query: a.query, act: a.act, mode: a.mode, ...baseMsg };
    case "wait":
      return { type: "LOCAL_WAIT", seconds: Math.min(30, a.duration || a.seconds || 1) };
    case "health":
      if (a.url) {
        return { type: "HEALTH_CHECK_URL", url: a.url, expect: a.expect || 200, timeout: a.timeout || 30000 };
      } else if (a.selector) {
        return { type: "WAIT_FOR_ELEMENT", selector: a.selector, timeout: a.timeout || 30000, ...baseMsg };
      }
      return { type: "ERROR", error: "--url or --selector required" };
    case "smoke":
      return { 
        type: "SMOKE_TEST", 
        urls: a.urls || [],
        routes: a.routes,
        savePath: a.screenshot,
        failFast: a["fail-fast"] || false,
        ...baseMsg 
      };
    case "type":
    case "left_click":
    case "right_click":
    case "double_click":
    case "triple_click":
    case "key":
    case "hover":
    case "drag":
    case "scroll":
      return mapComputerAction({ ...a, action: tool }, tabId);
    case "click":
      return mapComputerAction({ ...a, action: "left_click" }, tabId);
    case "cookie.list":
      return { type: "COOKIE_LIST", ...baseMsg };
    case "cookie.get":
      if (!a.name) throw new Error("--name required");
      return { type: "COOKIE_GET", name: a.name, ...baseMsg };
    case "cookie.set":
      if (!a.name) throw new Error("--name required");
      if (a.value === undefined) throw new Error("--value required");
      return { type: "COOKIE_SET", name: a.name, value: a.value, expires: a.expires, ...baseMsg };
    case "cookie.clear":
      if (a.all) return { type: "COOKIE_CLEAR_ALL", ...baseMsg };
      if (!a.name) throw new Error("--name or --all required");
      return { type: "COOKIE_CLEAR", name: a.name, ...baseMsg };
    case "search":
      if (!a.term) throw new Error("search term required");
      return { type: "SEARCH_PAGE", term: a.term, caseSensitive: a["case-sensitive"] || false, limit: a.limit || 10, ...baseMsg };
    case "tab.group": {
      const tabIds = a.tabs ? String(a.tabs).split(",").map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id)) : [];
      return { type: "TAB_GROUP_CREATE", name: a.name, tabIds, color: a.color || "blue", ...baseMsg };
    }
    case "tab.ungroup": {
      const tabIds = a.tabs ? String(a.tabs).split(",").map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id)) : [];
      return { type: "TAB_GROUP_REMOVE", tabIds, ...baseMsg };
    }
    case "tab.groups":
      return { type: "TAB_GROUPS_LIST" };
    case "batch": {
      let actions = a.actions;
      
      if (a.file) {
        if (!fs.existsSync(a.file)) {
          throw new Error(`file not found: ${a.file}`);
        }
        const content = fs.readFileSync(a.file, "utf8");
        try {
          actions = JSON.parse(content);
        } catch (e) {
          throw new Error(`invalid JSON in ${a.file}`);
        }
      }
      
      if (typeof actions === "string") {
        try {
          actions = JSON.parse(actions);
        } catch (e) {
          throw new Error("invalid --actions JSON");
        }
      }
      
      if (!Array.isArray(actions)) {
        throw new Error("actions must be array");
      }
      
      return { type: "BATCH_EXECUTE", actions, ...baseMsg };
    }
    case "back":
      return { type: "EXECUTE_JAVASCRIPT", code: "history.back()", ...baseMsg };
    case "forward":
      return { type: "EXECUTE_JAVASCRIPT", code: "history.forward()", ...baseMsg };
    case "tab.reload":
      return { type: "TAB_RELOAD", hard: a.hard || false, ...baseMsg };
    case "zoom":
      if (a.reset) return { type: "ZOOM_RESET", ...baseMsg };
      if (a.level !== undefined) return { type: "ZOOM_SET", level: parseFloat(a.level), ...baseMsg };
      return { type: "ZOOM_GET", ...baseMsg };
    case "resize":
      return { type: "RESIZE_WINDOW", width: a.width, height: a.height, ...baseMsg };
    case "bookmark.add":
      return { type: "BOOKMARK_ADD", folder: a.folder, ...baseMsg };
    case "bookmark.remove":
      return { type: "BOOKMARK_REMOVE", ...baseMsg };
    case "bookmark.list":
      return { type: "BOOKMARK_LIST", folder: a.folder, limit: a.limit !== undefined ? parseInt(a.limit, 10) : 50 };
    case "history.list":
      return { type: "HISTORY_LIST", limit: a.limit !== undefined ? parseInt(a.limit, 10) : 20 };
    case "history.search":
      if (!a.query) throw new Error("query required");
      return { type: "HISTORY_SEARCH", query: a.query, limit: a.limit !== undefined ? parseInt(a.limit, 10) : 20 };
    case "chatgpt":
      if (!a.query) throw new Error("query required");
      return { 
        type: "CHATGPT_QUERY", 
        query: a.query, 
        model: a.model,
        withPage: a["with-page"],
        file: a.file,
        timeout: a.timeout ? parseInt(a.timeout, 10) * 1000 : 2700000,
        ...baseMsg 
      };
    case "gemini":
      if (!a.query && !a["generate-image"]) throw new Error("query required");
      return {
        type: "GEMINI_QUERY",
        query: a.query,
        model: a.model || "gemini-3-pro",
        withPage: a["with-page"],
        file: a.file,
        generateImage: a["generate-image"],
        editImage: a["edit-image"],
        output: a.output,
        timeout: a.timeout ? parseInt(a.timeout, 10) * 1000 : 300000,
        ...baseMsg
      };
    default:
      return null;
  }
}

function mapComputerAction(args, tabId) {
  const a = args || {};
  const { action, text, scroll_direction, scroll_amount, 
          start_coordinate, ref, duration, modifiers } = a;
  const coordinate = a.coordinate || (a.x !== undefined && a.y !== undefined ? [a.x, a.y] : undefined);
  const baseMsg = { tabId };
  
  if (!action) {
    return { type: "UNSUPPORTED_ACTION", action: null, message: "No action specified for computer tool" };
  }
  
  switch (action) {
    case "screenshot":
      return { type: "EXECUTE_SCREENSHOT", ...baseMsg };
    
    case "left_click":
      if (ref) return { type: "CLICK_REF", ref, button: "left", ...baseMsg };
      if (a.selector) return { type: "CLICK_SELECTOR", selector: a.selector, index: a.index || 0, button: "left", ...baseMsg };
      return { type: "EXECUTE_CLICK", x: coordinate?.[0], y: coordinate?.[1], modifiers, ...baseMsg };
    
    case "right_click":
      if (ref) return { type: "CLICK_REF", ref, button: "right", ...baseMsg };
      return { type: "EXECUTE_RIGHT_CLICK", x: coordinate?.[0], y: coordinate?.[1], modifiers, ...baseMsg };
    
    case "double_click":
      if (ref) return { type: "CLICK_REF", ref, button: "double", ...baseMsg };
      return { type: "EXECUTE_DOUBLE_CLICK", x: coordinate?.[0], y: coordinate?.[1], modifiers, ...baseMsg };
    
    case "triple_click":
      if (ref) return { type: "CLICK_REF", ref, button: "triple", ...baseMsg };
      return { type: "EXECUTE_TRIPLE_CLICK", x: coordinate?.[0], y: coordinate?.[1], modifiers, ...baseMsg };
    
    case "type":
      if (ref) {
        return { type: "FORM_FILL", data: [{ ref, value: text }], ...baseMsg };
      }
      return { type: "EXECUTE_TYPE", text, ...baseMsg };
    
    case "key": {
      const keyValue = a.key || text;
      const repeatCount = Math.min(100, Math.max(1, a.repeat || 1));
      if (repeatCount > 1) {
        return { type: "EXECUTE_KEY_REPEAT", key: keyValue, repeat: repeatCount, tabId };
      }
      return { type: "EXECUTE_KEY", key: keyValue, ...baseMsg };
    }
    
    case "type_submit":
      return { type: "TYPE_SUBMIT", text, submitKey: a.submitKey || "Enter", ...baseMsg };
    
    case "click_type":
      return { type: "CLICK_TYPE", text, ref, coordinate, ...baseMsg };
    
    case "click_type_submit":
      return { type: "CLICK_TYPE_SUBMIT", text, ref, coordinate, submitKey: a.submitKey || "Enter", ...baseMsg };
    
    case "find_and_type":
      return { type: "FIND_AND_TYPE", text, submit: a.submit ?? false, submitKey: a.submitKey || "Enter", ...baseMsg };
    
    case "scroll": {
      const amount = (scroll_amount || 3) * 100;
      const deltas = {
        up: { deltaX: 0, deltaY: -amount },
        down: { deltaX: 0, deltaY: amount },
        left: { deltaX: -amount, deltaY: 0 },
        right: { deltaX: amount, deltaY: 0 },
      };
      const { deltaX, deltaY } = deltas[scroll_direction] || { deltaX: 0, deltaY: 0 };
      return { type: "EXECUTE_SCROLL", deltaX, deltaY, x: coordinate?.[0], y: coordinate?.[1], ...baseMsg };
    }
    
    case "scroll_to":
      return { type: "SCROLL_TO_ELEMENT", ref, ...baseMsg };
    
    case "hover":
      if (ref) return { type: "HOVER_REF", ref, ...baseMsg };
      return { type: "EXECUTE_HOVER", x: coordinate?.[0], y: coordinate?.[1], ...baseMsg };
    
    case "left_click_drag":
    case "drag":
      return { 
        type: "EXECUTE_DRAG", 
        startX: start_coordinate?.[0], 
        startY: start_coordinate?.[1],
        endX: coordinate?.[0],
        endY: coordinate?.[1],
        modifiers,
        ...baseMsg 
      };
    
    case "wait":
      return { type: "LOCAL_WAIT", seconds: Math.min(30, duration || 1) };
    
    case "zoom":
      if (a.reset) return { type: "ZOOM_RESET", tabId };
      if (a.level !== undefined) return { type: "ZOOM_SET", level: parseFloat(a.level), tabId };
      return { type: "ZOOM_GET", tabId };
    
    default:
      return { type: "UNSUPPORTED_ACTION", action, message: `Unknown computer action: ${action}` };
  }
}

function handleStreamRequest(msg, socket) {
  const { streamType, options, id: originalId } = msg;
  const tabId = msg.tabId;
  const streamId = ++requestCounter;
  
  activeStreams.set(streamId, {
    socket,
    originalId,
    streamType,
  });
  
  writeMessage({
    type: streamType,
    streamId,
    options: options || {},
    tabId,
  });
  
  try {
    socket.write(JSON.stringify({ type: "stream_started", streamId }) + "\n");
  } catch (e) {
    log(`Error sending stream_started: ${e.message}`);
  }
}

function handleToolRequest(msg, socket) {
  const { method, params } = msg;
  const originalId = msg.id || null;
  
  if (method !== "execute_tool") {
    sendToolResponse(socket, originalId, null, `Unknown method: ${method}`);
    return;
  }
  
  const { tool, args } = params || {};
  const tabId = msg.tabId || params?.tabId || args?.tabId;
  if (!tool) {
    sendToolResponse(socket, originalId, null, "No tool specified");
    return;
  }
  
  const extensionMsg = mapToolToMessage(tool, args, tabId);
  if (!extensionMsg) {
    sendToolResponse(socket, originalId, null, `Unknown tool: ${tool}`);
    return;
  }
  
  if (extensionMsg.type === "UNSUPPORTED_ACTION") {
    sendToolResponse(socket, originalId, null, extensionMsg.message);
    return;
  }
  
  if (extensionMsg.type === "LOCAL_WAIT") {
    setTimeout(() => {
      sendToolResponse(socket, originalId, { success: true }, null);
    }, extensionMsg.seconds * 1000);
    return;
  }
  
  if (extensionMsg.type === "BATCH_EXECUTE") {
    executeBatch(extensionMsg.actions, extensionMsg.tabId, socket, originalId);
    return;
  }
  
  if (extensionMsg.type === "AI_ANALYZE") {
    if (!extensionMsg.query || !extensionMsg.query.trim()) {
      sendToolResponse(socket, originalId, null, "Query is required for AI analysis");
      return;
    }
    
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      sendToolResponse(socket, originalId, null, "GOOGLE_API_KEY environment variable not set. Export it with: export GOOGLE_API_KEY='your-key'");
      return;
    }
    
    const pageRequestId = ++requestCounter;
    pendingToolRequests.set(pageRequestId, {
      socket: null,
      originalId: null,
      tool: "read_page",
      onComplete: async (pageResult) => {
        if (pageResult.error) {
          sendToolResponse(socket, originalId, null, `Failed to read page: ${pageResult.error}`);
          return;
        }
        
        const pageContent = pageResult.pageContent || "";
        if (!pageContent) {
          sendToolResponse(socket, originalId, null, "No page content available");
          return;
        }
        
        try {
          const gemini = getGeminiClient(apiKey);
          const result = await gemini.analyze(extensionMsg.query, pageContent, { mode: extensionMsg.mode });
          
          if (result.mode === "find") {
            sendToolResponse(socket, originalId, { 
              ref: result.content === "NOT_FOUND" ? null : result.content,
              mode: result.mode,
              aiResult: true
            }, null);
          } else {
            sendToolResponse(socket, originalId, { 
              content: result.content,
              mode: result.mode,
              aiResult: true
            }, null);
          }
        } catch (err) {
          sendToolResponse(socket, originalId, null, `AI analysis failed: ${err.message}`);
        }
      }
    });
    writeMessage({ type: "READ_PAGE", options: { filter: "interactive" }, tabId: extensionMsg.tabId, id: pageRequestId });
    return;
  }
  
  if (extensionMsg.type === "CHATGPT_QUERY") {
    const { query, model, withPage, file, timeout } = extensionMsg;
    
    queueAiRequest(async () => {
      let pageContext = null;
      if (withPage) {
        const pageResult = await new Promise((resolve) => {
          const pageId = ++requestCounter;
          pendingToolRequests.set(pageId, {
            socket: null,
            originalId: null,
            tool: "read_page",
            onComplete: resolve
          });
          writeMessage({ type: "GET_PAGE_TEXT", tabId: extensionMsg.tabId, id: pageId });
        });
        if (pageResult && !pageResult.error) {
          pageContext = {
            url: pageResult.url,
            text: pageResult.text || pageResult.pageContent || ""
          };
        }
      }
      
      let fullPrompt = query;
      if (pageContext) {
        fullPrompt = `Page: ${pageContext.url}\n\n${pageContext.text}\n\n---\n\n${query}`;
      }
      
      const result = await chatgptClient.query({
        prompt: fullPrompt,
        model,
        file,
        timeout,
        getCookies: () => new Promise((resolve) => {
          const cookieId = ++requestCounter;
          pendingToolRequests.set(cookieId, {
            socket: null,
            originalId: null,
            tool: "get_cookies",
            onComplete: (r) => resolve(r)
          });
          writeMessage({ type: "GET_CHATGPT_COOKIES", id: cookieId });
        }),
        createTab: () => new Promise((resolve) => {
          const tabCreateId = ++requestCounter;
          pendingToolRequests.set(tabCreateId, {
            socket: null,
            originalId: null,
            tool: "create_tab",
            onComplete: (r) => resolve(r)
          });
          writeMessage({ type: "CHATGPT_NEW_TAB", id: tabCreateId });
        }),
        closeTab: (tabIdToClose) => new Promise((resolve) => {
          const tabCloseId = ++requestCounter;
          pendingToolRequests.set(tabCloseId, {
            socket: null,
            originalId: null,
            tool: "close_tab",
            onComplete: (r) => resolve(r)
          });
          writeMessage({ type: "CHATGPT_CLOSE_TAB", tabId: tabIdToClose, id: tabCloseId });
        }),
        cdpEvaluate: (tabId, expression) => new Promise((resolve) => {
          const evalId = ++requestCounter;
          pendingToolRequests.set(evalId, {
            socket: null,
            originalId: null,
            tool: "cdp_evaluate",
            onComplete: (r) => resolve(r)
          });
          writeMessage({ type: "CHATGPT_EVALUATE", tabId, expression, id: evalId });
        }),
        cdpCommand: (tabId, method, params) => new Promise((resolve) => {
          const cmdId = ++requestCounter;
          pendingToolRequests.set(cmdId, {
            socket: null,
            originalId: null,
            tool: "cdp_command",
            onComplete: (r) => resolve(r)
          });
          writeMessage({ type: "CHATGPT_CDP_COMMAND", tabId, method, params, id: cmdId });
        }),
        log: (msg) => log(`[chatgpt] ${msg}`)
      });
      
      return result;
    }).then((result) => {
      sendToolResponse(socket, originalId, {
        response: result.response,
        model: result.model,
        tookMs: result.tookMs
      }, null);
    }).catch((err) => {
      sendToolResponse(socket, originalId, null, err.message);
    });
    
    return;
  }
  
  if (extensionMsg.type === "GEMINI_QUERY") {
    sendToolResponse(socket, originalId, null, "Gemini integration not yet implemented");
    return;
  }
  
  if (extensionMsg.type === "EXECUTE_KEY_REPEAT") {
    const { key, repeat, tabId: tid } = extensionMsg;
    let completed = 0;
    let lastError = null;
    
    const sendNextKey = () => {
      if (completed >= repeat) {
        if (lastError) {
          sendToolResponse(socket, originalId, null, `Key repeat failed: ${lastError}`);
        } else {
          sendToolResponse(socket, originalId, { success: true }, null);
        }
        return;
      }
      const id = ++requestCounter;
      pendingToolRequests.set(id, { 
        socket: null,
        originalId: null,
        tool,
        onComplete: (result) => {
          if (result.error) lastError = result.error;
          completed++;
          setTimeout(sendNextKey, 50);
        }
      });
      writeMessage({ type: "EXECUTE_KEY", key, tabId: tid, id });
    };
    sendNextKey();
    return;
  }
  
  if (extensionMsg.type === "NAMED_TAB_SWITCH" || extensionMsg.type === "NAMED_TAB_CLOSE") {
    const { name, type: opType } = extensionMsg;
    const lookupId = ++requestCounter;
    pendingToolRequests.set(lookupId, {
      socket: null,
      originalId: null,
      tool: "tabs_get_by_name",
      onComplete: (result) => {
        if (result.error || !result.tabId) {
          sendToolResponse(socket, originalId, null, result.error || `No tab found with name "${name}"`);
          return;
        }
        const actionId = ++requestCounter;
        const actionType = opType === "NAMED_TAB_SWITCH" ? "SWITCH_TAB" : "CLOSE_TAB";
        pendingToolRequests.set(actionId, { socket, originalId, tool, tabId: result.tabId });
        writeMessage({ type: actionType, tabId: result.tabId, id: actionId });
      }
    });
    writeMessage({ type: "TABS_GET_BY_NAME", name, id: lookupId });
    return;
  }
  
  const id = ++requestCounter;
  const pendingData = { 
    socket, 
    originalId, 
    tool, 
    savePath: extensionMsg.savePath || args?.savePath,
    autoScreenshot: args?.autoScreenshot,
    fullRes: extensionMsg.fullRes || args?.fullRes,
    maxSize: extensionMsg.maxSize || args?.maxSize,
    tabId: extensionMsg.tabId || tabId
  };
  pendingToolRequests.set(id, pendingData);
  
  writeMessage({ ...extensionMsg, id });
}

function executeBatch(actions, tabId, socket, originalId) {
  const results = [];
  const DELAY_MS = 100;
  let currentIndex = 0;
  
  function executeNextAction() {
    if (currentIndex >= actions.length) {
      sendToolResponse(socket, originalId, {
        success: true,
        completedActions: actions.length,
        totalActions: actions.length,
        results,
      }, null);
      return;
    }
    
    const action = actions[currentIndex];
    const toolName = mapBatchActionToTool(action);
    const toolArgs = mapBatchActionToArgs(action);
    
    const extensionMsg = mapToolToMessage(toolName, toolArgs, tabId);
    if (!extensionMsg || extensionMsg.type === "UNSUPPORTED_ACTION") {
      results.push({ index: currentIndex, type: action.type, success: false, error: "Unsupported action" });
      sendToolResponse(socket, originalId, {
        success: false,
        completedActions: currentIndex,
        totalActions: actions.length,
        results,
        error: `Action ${currentIndex} failed: Unsupported action type "${action.type}"`,
      }, null);
      return;
    }
    
    if (extensionMsg.type === "LOCAL_WAIT") {
      results.push({ index: currentIndex, type: action.type, success: true });
      currentIndex++;
      setTimeout(executeNextAction, extensionMsg.seconds * 1000);
      return;
    }
    
    const id = ++requestCounter;
    pendingToolRequests.set(id, {
      socket: null,
      originalId: null,
      tool: toolName,
      onComplete: (result) => {
        if (result.error) {
          results.push({ index: currentIndex, type: action.type, success: false, error: result.error });
          sendToolResponse(socket, originalId, {
            success: false,
            completedActions: currentIndex,
            totalActions: actions.length,
            results,
            error: `Action ${currentIndex} failed: ${result.error}`,
          }, null);
          return;
        }
        
        results.push({ index: currentIndex, type: action.type, success: true });
        currentIndex++;
        
        setTimeout(executeNextAction, DELAY_MS);
      }
    });
    
    writeMessage({ ...extensionMsg, id });
  }
  
  executeNextAction();
}

function mapBatchActionToTool(action) {
  const map = {
    click: "left_click",
    type: "type",
    key: "key",
    wait: "wait",
    scroll: "scroll",
    screenshot: "screenshot",
    navigate: "navigate",
  };
  return map[action.type] || action.type;
}

function mapBatchActionToArgs(action) {
  switch (action.type) {
    case "click":
      return { ref: action.ref, selector: action.selector, x: action.x, y: action.y };
    case "type":
      return { text: action.text };
    case "key":
      return { key: action.key };
    case "wait":
      return { duration: (action.ms || 1000) / 1000 };
    case "scroll":
      return { scroll_direction: action.direction };
    case "screenshot":
      return { savePath: action.output };
    case "navigate":
      return { url: action.url };
    default:
      return action;
  }
}

function writeMessage(msg) {
  const json = JSON.stringify(msg);
  const len = Buffer.byteLength(json);
  const buf = Buffer.alloc(4 + len);
  buf.writeUInt32LE(len, 0);
  buf.write(json, 4);
  process.stdout.write(buf);
}

let inputBuffer = Buffer.alloc(0);

function processInput() {
  while (inputBuffer.length >= 4) {
    const msgLen = inputBuffer.readUInt32LE(0);
    if (inputBuffer.length < 4 + msgLen) break;
    
    const jsonStr = inputBuffer.slice(4, 4 + msgLen).toString("utf8");
    inputBuffer = inputBuffer.slice(4 + msgLen);
    
    try {
      const msg = JSON.parse(jsonStr);
      log(`Received from extension: ${JSON.stringify(msg)}`);
      
      if (msg.type === "GET_AUTH") {
        log("Handling GET_AUTH from extension");
        try {
          if (fs.existsSync(AUTH_FILE)) {
            const authData = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
            writeMessage({ id: msg.id, auth: authData, hint: null });
          } else {
            writeMessage({ 
              id: msg.id, 
              auth: null, 
              hint: "No OAuth credentials found. Run 'pi --login anthropic' in terminal to authenticate with Claude Max."
            });
          }
        } catch (e) {
          log(`Error reading auth file: ${e.message}`);
          writeMessage({ 
            id: msg.id, 
            auth: null, 
            hint: "Failed to read auth credentials. Run 'pi --login anthropic' in terminal to authenticate."
          });
        }
        return;
      }
      
      if (msg.type === "API_REQUEST") {
        handleApiRequest(msg, writeMessage);
        return;
      }
      
      if (msg.type === "STREAM_EVENT") {
        const stream = activeStreams.get(msg.streamId);
        if (stream) {
          try {
            stream.socket.write(JSON.stringify(msg.event) + "\n");
          } catch (e) {
            log(`Error forwarding stream event: ${e.message}`);
            activeStreams.delete(msg.streamId);
            writeMessage({ type: "STREAM_STOP", streamId: msg.streamId });
          }
        }
        return;
      }
      
      if (msg.type === "STREAM_ERROR") {
        const stream = activeStreams.get(msg.streamId);
        if (stream) {
          try {
            stream.socket.write(JSON.stringify({ error: msg.error }) + "\n");
          } catch (e) {}
          activeStreams.delete(msg.streamId);
        }
        return;
      }
      
      
      if (msg.id && pendingToolRequests.has(msg.id)) {
        const pending = pendingToolRequests.get(msg.id);
        pendingToolRequests.delete(msg.id);
        
        if (pending.onComplete) {
          pending.onComplete(msg);
        } else {
          const { socket, originalId, savePath, autoScreenshot, tabId: storedTabId } = pending;
          const tabId = storedTabId || msg._resolvedTabId;
          
          if (savePath && msg.base64) {
            try {
              const dir = path.dirname(savePath);
              if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(savePath, Buffer.from(msg.base64, "base64"));
              const origWidth = msg.width || 0;
              const origHeight = msg.height || 0;
              const maxSize = pending.maxSize || 1200;
              const skipResize = pending.fullRes;
              
              let finalDims = origWidth && origHeight ? `${origWidth}x${origHeight}` : "";
              if (!skipResize && (origWidth > maxSize || origHeight > maxSize)) {
                try {
                  const { execSync } = require("child_process");
                  execSync(`sips --resampleHeightWidthMax ${maxSize} "${savePath}" --out "${savePath}" 2>/dev/null`, { stdio: "pipe" });
                  const sizeInfo = execSync(`sips -g pixelWidth -g pixelHeight "${savePath}" 2>/dev/null`, { encoding: "utf8" });
                  const newWidth = sizeInfo.match(/pixelWidth:\s*(\d+)/)?.[1] || "?";
                  const newHeight = sizeInfo.match(/pixelHeight:\s*(\d+)/)?.[1] || "?";
                  finalDims = `${newWidth}x${newHeight}, from ${origWidth}x${origHeight}`;
                } catch (resizeErr) {
                  finalDims = `${origWidth}x${origHeight}`;
                }
              }
              sendToolResponse(socket, originalId, { 
                message: `Saved to ${savePath} (${finalDims})`
              }, null);
            } catch (e) {
              sendToolResponse(socket, originalId, null, `Failed to save: ${e.message}`);
            }
          } else if (autoScreenshot && tabId && !msg.error && !msg.base64) {
            
            const screenshotId = ++requestCounter;
            const screenshotPath = `/tmp/pi-auto-${Date.now()}.png`;
            
            const autoFiles = fs.readdirSync("/tmp")
              .filter(f => f.startsWith("pi-auto-") && f.endsWith(".png"))
              .map(f => ({ name: f, time: parseInt(f.match(/pi-auto-(\d+)\.png/)?.[1] || "0", 10) }))
              .sort((a, b) => b.time - a.time);
            if (autoFiles.length >= 10) {
              autoFiles.slice(9).forEach(f => {
                try { fs.unlinkSync(path.join("/tmp", f.name)); } catch (e) {}
              });
            }
            pendingToolRequests.set(screenshotId, {
              socket: null,
              originalId: null,
              tool: "screenshot",
              onComplete: (screenshotMsg) => {
                if (screenshotMsg.base64) {
                  try {
                    fs.writeFileSync(screenshotPath, Buffer.from(screenshotMsg.base64, "base64"));
                    const origW = screenshotMsg.width || 0;
                    const origH = screenshotMsg.height || 0;
                    let finalW = origW, finalH = origH;
                    const maxSize = 1200;
                    if (origW > maxSize || origH > maxSize) {
                      try {
                        const { execSync } = require("child_process");
                        execSync(`sips --resampleHeightWidthMax ${maxSize} "${screenshotPath}" --out "${screenshotPath}" 2>/dev/null`, { stdio: "pipe" });
                        const sizeInfo = execSync(`sips -g pixelWidth -g pixelHeight "${screenshotPath}" 2>/dev/null`, { encoding: "utf8" });
                        finalW = parseInt(sizeInfo.match(/pixelWidth:\s*(\d+)/)?.[1] || origW, 10);
                        finalH = parseInt(sizeInfo.match(/pixelHeight:\s*(\d+)/)?.[1] || origH, 10);
                      } catch (e) {}
                    }
                    sendToolResponse(socket, originalId, {
                      ...msg,
                      autoScreenshot: { path: screenshotPath, width: finalW, height: finalH, originalWidth: origW, originalHeight: origH }
                    }, null);
                  } catch (e) {
                    sendToolResponse(socket, originalId, { ...msg, autoScreenshotError: e.message }, null);
                  }
                } else {
                  const errMsg = screenshotMsg.error || "Failed to capture";
                  sendToolResponse(socket, originalId, { ...msg, autoScreenshotError: errMsg }, null);
                }
              }
            });
            setTimeout(() => writeMessage({ type: "EXECUTE_SCREENSHOT", tabId, id: screenshotId }), 500);
            return;
          } else if (msg.results && msg.savePath) {
            try {
              const dir = msg.savePath;
              if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
              
              for (const result of msg.results) {
                if (result.screenshotBase64 && result.hostname) {
                  const ssPath = path.join(dir, `${result.hostname}.png`);
                  fs.writeFileSync(ssPath, Buffer.from(result.screenshotBase64, "base64"));
                  result.screenshot = ssPath;
                  delete result.screenshotBase64;
                  delete result.hostname;
                }
              }
              delete msg.savePath;
              sendToolResponse(socket, originalId, msg, null);
            } catch (e) {
              sendToolResponse(socket, originalId, null, `Failed to save screenshots: ${e.message}`);
            }
          } else {
            const isPureError = msg.error && !msg.success && !msg.base64 && 
                                !msg.pageContent && !msg.tabs && !msg.text &&
                                !msg.output && !msg.messages && !msg.requests;
            
            if (isPureError) {
              sendToolResponse(socket, originalId, null, msg.error);
            } else {
              sendToolResponse(socket, originalId, msg, null);
            }
          }
        }
      } else if (msg.id && pendingRequests.has(msg.id)) {
        const { socket } = pendingRequests.get(msg.id);
        try {
          socket.write(JSON.stringify(msg) + "\n");
        } catch (e) {
          log(`Error writing to CLI socket: ${e.message}`);
        }
        pendingRequests.delete(msg.id);
      }
    } catch (e) {
      log(`Error parsing message: ${e.message}`);
    }
  }
}

process.stdin.on("readable", () => {
  let chunk;
  while ((chunk = process.stdin.read()) !== null) {
    inputBuffer = Buffer.concat([inputBuffer, chunk]);
    processInput();
  }
});

process.stdin.on("end", () => {
  log("stdin ended, exiting");
  process.exit(0);
});

process.stdin.on("error", (err) => {
  log(`stdin error: ${err.message}`);
});

process.stdout.on("error", (err) => {
  log(`stdout error: ${err.message}`);
});

const server = net.createServer((socket) => {
  log("CLI client connected");
  let dataBuffer = "";

  socket.on("data", (data) => {
    dataBuffer += data.toString();
    const lines = dataBuffer.split("\n");
    dataBuffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        
        if (msg.type === "GET_AUTH") {
          log("Handling GET_AUTH locally");
          try {
            if (fs.existsSync(AUTH_FILE)) {
              const authData = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
              socket.write(JSON.stringify({ 
                id: msg.id || 0,
                auth: authData,
                hint: null
              }) + "\n");
            } else {
              socket.write(JSON.stringify({ 
                id: msg.id || 0,
                auth: null,
                hint: "No OAuth credentials found. Run 'pi --login anthropic' in terminal to authenticate with Claude Max."
              }) + "\n");
            }
          } catch (e) {
            log(`Error reading auth file: ${e.message}`);
            socket.write(JSON.stringify({ 
              id: msg.id || 0,
              auth: null,
              hint: "Failed to read auth credentials. Run 'pi --login anthropic' in terminal to authenticate."
            }) + "\n");
          }
          continue;
        }
        
        if (msg.type === "tool_request") {
          log("Handling tool_request: " + msg.method + " " + (msg.params?.tool || ""));
          try {
            handleToolRequest(msg, socket);
          } catch (e) {
            socket.write(JSON.stringify({ error: e.message || "Request failed" }) + "\n");
          }
          continue;
        }
        
        if (msg.type === "stream_request") {
          log("Handling stream_request: " + msg.streamType);
          handleStreamRequest(msg, socket);
          continue;
        }
        
        if (msg.type === "stream_stop") {
          log("Handling stream_stop");
          for (const [streamId, stream] of activeStreams.entries()) {
            if (stream.socket === socket) {
              writeMessage({ type: "STREAM_STOP", streamId });
              activeStreams.delete(streamId);
            }
          }
          continue;
        }
        
        const id = ++requestCounter;
        log(`Forwarding to extension: id=${id} type=${msg.type}`);
        pendingRequests.set(id, { socket });
        writeMessage({ ...msg, id });
      } catch (e) {
        log(`Error parsing CLI request: ${e.message}`);
        socket.write(JSON.stringify({ error: "Invalid request" }) + "\n");
      }
    }
  });

  socket.on("error", (err) => {
    log(`CLI socket error: ${err.message}`);
  });
  
  socket.on("close", () => {
    log("CLI client disconnected");
    for (const [id, pending] of pendingRequests.entries()) {
      if (pending.socket === socket) {
        pendingRequests.delete(id);
      }
    }
    for (const [id, pending] of pendingToolRequests.entries()) {
      if (pending.socket === socket && !pending.autoScreenshot) {
        pendingToolRequests.delete(id);
      }
    }
    for (const [streamId, stream] of activeStreams.entries()) {
      if (stream.socket === socket) {
        writeMessage({ type: "STREAM_STOP", streamId });
        activeStreams.delete(streamId);
      }
    }
  });
});

server.listen(SOCKET_PATH, () => {
  log("Socket server listening on " + SOCKET_PATH);
  fs.chmodSync(SOCKET_PATH, 0o600);
  writeMessage({ type: "HOST_READY" });
  log("Sent HOST_READY to extension");
});

server.on("error", (err) => {
  log(`Server error: ${err.message}`);
});

process.on("SIGTERM", () => {
  log("SIGTERM received");
  server.close();
  try { fs.unlinkSync(SOCKET_PATH); } catch {}
  process.exit(0);
});

process.on("SIGINT", () => {
  log("SIGINT received");
  server.close();
  try { fs.unlinkSync(SOCKET_PATH); } catch {}
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  log(`Uncaught exception: ${err.message}\n${err.stack}`);
  process.exit(1);
});

log("Host initialization complete, waiting for connections...");
