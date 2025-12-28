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
      { type: "text", text: `Screenshot captured (${dims})` },
      { type: "image", data: result.base64, mimeType: "image/png" }
    ];
  }
  
  if (result.pageContent !== undefined) {
    const content = result.pageContent || "No content";
    let output = content;
    
    if (result.isIncremental && result.diff) {
      output += `\n--- Diff from previous snapshot ---\n${result.diff}`;
    }
    
    if (result.modalStates && result.modalStates.length > 0) {
      output += `\n--- Active Modals ---`;
      for (const modal of result.modalStates) {
        output += `\n${modal.description} (dismiss: ${modal.clearedBy})`;
      }
    }
    
    if (result.error) {
      return text(`Error: ${result.error}\n\n${output}`);
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
  
  if (result.success && result.tabId) {
    return text(`Created tab ${result.tabId}${result.url ? `: ${result.url}` : ""}`);
  }

  if (result.success && result.width && result.height) {
    return text(`Resized window to ${result.width}x${result.height}`);
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
          filter: a.filter || "all",
          depth: a.depth,
          refId: a.ref_id,
          forceFullSnapshot: a.forceFullSnapshot ?? false
        },
        ...baseMsg 
      };
    case "get_page_text":
      return { type: "GET_PAGE_TEXT", ...baseMsg };
    case "form_input":
      return { type: "FORM_INPUT", ref: a.ref, value: a.value, ...baseMsg };
    case "tabs_context":
      return { type: "GET_TABS" };
    case "screenshot":
      return { type: "EXECUTE_SCREENSHOT", ...baseMsg };
    case "javascript_tool":
      return { type: "EXECUTE_JAVASCRIPT", code: a.code, ...baseMsg };
    case "read_console_messages":
      return { 
        type: "READ_CONSOLE_MESSAGES", 
        onlyErrors: a.only_errors,
        pattern: a.pattern,
        limit: a.limit,
        clear: a.clear,
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
    default:
      return null;
  }
}

function mapComputerAction(args, tabId) {
  const a = args || {};
  const { action, coordinate, text, scroll_direction, scroll_amount, 
          start_coordinate, ref, duration, modifiers } = a;
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

function handleToolRequest(msg, socket) {
  const { method, params } = msg;
  const originalId = msg.id || null;
  
  if (method !== "execute_tool") {
    sendToolResponse(socket, originalId, null, `Unknown method: ${method}`);
    return;
  }
  
  const { tool, args, tabId } = params || {};
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
  
  const id = ++requestCounter;
  pendingToolRequests.set(id, { socket, originalId, tool });
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
      
      if (msg.id && pendingToolRequests.has(msg.id)) {
        const pending = pendingToolRequests.get(msg.id);
        pendingToolRequests.delete(msg.id);
        
        if (pending.onComplete) {
          pending.onComplete(msg);
        } else {
          const { socket, originalId } = pending;
          const isPureError = msg.error && !msg.success && !msg.base64 && 
                              !msg.pageContent && !msg.tabs && !msg.text &&
                              !msg.output && !msg.messages && !msg.requests;
          
          if (isPureError) {
            sendToolResponse(socket, originalId, null, msg.error);
          } else {
            sendToolResponse(socket, originalId, msg, null);
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
      if (pending.socket === socket) {
        pendingToolRequests.delete(id);
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
