#!/usr/bin/env node
const net = require("net");
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");

const SOCKET_PATH = "/tmp/pi-chrome.sock";
const LOG_FILE = "/tmp/pi-chrome-host.log";
const AUTH_FILE = path.join(os.homedir(), ".pi", "agent", "auth.json");



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
  
  if (result.messages && Array.isArray(result.messages)) {
    const formatted = result.messages.map(m => {
      let loc = "";
      if (m.url) loc = m.line !== undefined ? ` (${m.url}:${m.line})` : ` (${m.url})`;
      return `[${m.type}] ${m.text}${loc}`;
    }).join("\n");
    return text(formatted || "No console messages");
  }

  if (result.requests && Array.isArray(result.requests)) {
    const formatted = result.requests.map(r => 
      `${r.method} ${r.url} ${r.status || "pending"}`
    ).join("\n");
    return text(formatted || "No network requests");
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
    const { path: ssPath } = result.autoScreenshot;
    return text(`Screenshot saved. Read: ${ssPath}`);
  }

  if (result.success) {
    return text("OK");
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
      return { type: "EXECUTE_SCREENSHOT", savePath: a.savePath, ...baseMsg };
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
    case "page.read":
      return { type: "READ_PAGE", options: { filter: a.filter || "interactive", refId: a.ref }, ...baseMsg };
    case "page.text":
      return { type: "GET_PAGE_TEXT", ...baseMsg };
    case "page.state":
      return { type: "PAGE_STATE", ...baseMsg };
    case "wait":
      return { type: "LOCAL_WAIT", seconds: Math.min(30, a.duration || a.seconds || 1) };
    case "health":
      if (a.url) {
        return { type: "HEALTH_CHECK_URL", url: a.url, expect: a.expect || 200, timeout: a.timeout || 30000 };
      } else if (a.selector) {
        return { type: "WAIT_FOR_ELEMENT", selector: a.selector, timeout: a.timeout || 30000, ...baseMsg };
      }
      return { type: "ERROR", error: "health requires --url or --selector" };
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
      return { type: "EXECUTE_CLICK", x: coordinate?.[0], y: coordinate?.[1], modifiers, ...baseMsg };
    
    case "right_click":
      if (ref) return { type: "CLICK_REF", ref, button: "right", ...baseMsg };
      return { type: "EXECUTE_RIGHT_CLICK", x: coordinate?.[0], y: coordinate?.[1], modifiers, ...baseMsg };
    
    case "double_click":
      if (ref) return { type: "CLICK_REF", ref, button: "double", ...baseMsg };
      return { type: "EXECUTE_DOUBLE_CLICK", x: coordinate?.[0], y: coordinate?.[1], modifiers, ...baseMsg };
    
    case "triple_click":
      return { type: "EXECUTE_TRIPLE_CLICK", x: coordinate?.[0], y: coordinate?.[1], modifiers, ...baseMsg };
    
    case "type":
      return { type: "EXECUTE_TYPE", text, ...baseMsg };
    
    case "key": {
      const repeatCount = Math.min(100, Math.max(1, a.repeat || 1));
      if (repeatCount > 1) {
        return { type: "EXECUTE_KEY_REPEAT", key: text, repeat: repeatCount, tabId };
      }
      return { type: "EXECUTE_KEY", key: text, ...baseMsg };
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
      return { type: "UNSUPPORTED_ACTION", action: "zoom", message: "zoom action not yet implemented" };
    
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
    savePath: args?.savePath,
    autoScreenshot: args?.autoScreenshot,
    tabId: extensionMsg.tabId || tabId
  };
  pendingToolRequests.set(id, pendingData);
  
  writeMessage({ ...extensionMsg, id });
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
              const dims = msg.width && msg.height ? `${msg.width}x${msg.height}` : "";
              sendToolResponse(socket, originalId, { 
                message: `Saved to ${savePath} (${dims})`
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
                    
                    sendToolResponse(socket, originalId, {
                      ...msg,
                      autoScreenshot: { path: screenshotPath, width: screenshotMsg.width, height: screenshotMsg.height }
                    }, null);
                  } catch (e) {
                    
                    sendToolResponse(socket, originalId, { ...msg, autoScreenshotError: e.message }, null);
                  }
                } else {
                  
                  sendToolResponse(socket, originalId, { ...msg, autoScreenshotError: "Failed to capture" }, null);
                }
              }
            });
            setTimeout(() => writeMessage({ type: "EXECUTE_SCREENSHOT", tabId, id: screenshotId }), 200);
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
          handleToolRequest(msg, socket);
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
