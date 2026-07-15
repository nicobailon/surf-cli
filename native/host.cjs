#!/usr/bin/env node
const net = require("net");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { AsyncLocalStorage } = require("async_hooks");
const requestStorage = new AsyncLocalStorage();
const https = require("https");
const { execSync } = require("child_process");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const chatgptClient = require("./chatgpt-client.cjs");
const geminiClient = require("./gemini-client.cjs");
const perplexityClient = require("./perplexity-client.cjs");
const grokClient = require("./grok-client.cjs");
const aistudioClient = require("./aistudio-client.cjs");
const aistudioBuild = require("./aistudio-build.cjs");
const { mapToolToMessage, mapComputerAction, formatToolContent, buildProviderUploadMessage } = require("./host-helpers.cjs");

const IS_WIN = process.platform === "win32";
const { SOCKET_PATH, SURF_TMP } = require("./socket-path.cjs");
const { parseListenEndpoint } = require("./listener.cjs");
const { getStateDir } = require("./remote-auth.cjs");
const { createFrameParser, createServerAuthSession, createSocketWriter, isClientAuthorized, writeFrame, MAX_FRAME_BYTES } = require("./remote-transport.cjs");
const { HostSessionManager, resolveRequestDeadlineMs } = require("./host-sessions.cjs");
const { abortError, throwIfAborted } = require("./abort.cjs");
const { BoundedAiQueue } = require("./ai-queue.cjs");
const { RequestPendingMap } = require("./request-pending.cjs");
const { cleanupFilePaths, createStagingDirectory, createTransferState, materializeRemoteTool, rewriteTransferPaths, streamFileDownload, transferError } = require("./file-transfer.cjs");
const { writeNetworkExport } = require("./network-export.cjs");
const MAX_CLIENT_FRAME_BYTES = MAX_FRAME_BYTES;
const TEST_REQUEST_DEADLINE_MS = process.env.SURF_TEST_MODE === "1" && Number.isFinite(Number(process.env.SURF_TEST_REQUEST_DEADLINE_MS))
  ? Number(process.env.SURF_TEST_REQUEST_DEADLINE_MS)
  : null;
if (IS_WIN) { try { fs.mkdirSync(SURF_TMP, { recursive: true }); } catch {} }

// The endpoint passed here is already validated by the caller. Keeping this
// lifecycle separate lets tests use an ephemeral loopback port without adding
// a localhost escape hatch to SURF_LISTEN parsing.
function createListenerLifecycle({ localPath, tcpEndpoint, handler, onReady, onFatal }) {
  const localServer = net.createServer(handler);
  const tcpServer = tcpEndpoint ? net.createServer(handler) : null;
  let shuttingDown = false;
  let startPromise = null;
  const close = (server) => {
    if (!server) return;
    try { server.close(); } catch (error) {
      if (error.code !== "ERR_SERVER_NOT_RUNNING") throw error;
    }
  };
  const unlink = () => { if (!IS_WIN) { try { fs.unlinkSync(localPath); } catch {} } };
  const listen = (server, options) => new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options, () => {
      server.removeListener("error", reject);
      if (shuttingDown) { close(server); unlink(); }
      resolve();
    });
  });
  const start = () => {
    if (startPromise) return startPromise;
    startPromise = (async () => {
      try {
        await listen(localServer, localPath);
        if (shuttingDown) return false;
        if (!IS_WIN) { try { fs.chmodSync(localPath, 0o600); } catch {} }
        if (tcpServer) {
          await listen(tcpServer, tcpEndpoint);
          if (shuttingDown) return false;
        }
        onReady();
        return true;
      } catch (error) {
        if (!shuttingDown) onFatal(error);
        close(localServer); close(tcpServer); unlink();
        return false;
      } finally {
        if (shuttingDown) { close(localServer); close(tcpServer); unlink(); }
      }
    })();
    return startPromise;
  };
  return {
    localServer,
    tcpServer,
    start,
    async shutdown() {
      shuttingDown = true;
      close(localServer); close(tcpServer); unlink();
      if (startPromise) await startPromise;
      unlink();
    },
  };
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

let aiQueue;
function queueAiRequest(handler, request = requestStorage.getStore()) {
  return aiQueue.enqueue(handler, request);
}
const LOG_FILE = path.join(SURF_TMP, "surf-host.log");
const AUTH_FILE = path.join(os.homedir(), ".pi", "agent", "auth.json");

const DEFAULT_RETRY_OPTIONS = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffFactor: 2,
  retryableStatusCodes: [429, 500, 502, 503, 504]
};

async function withRetry(fn, retryOptions = DEFAULT_RETRY_OPTIONS, retryCount = 0, signal) {
  throwIfAborted(signal);
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
    
    await require("./abort.cjs").abortableDelay(delayWithJitter, signal);
    return withRetry(fn, retryOptions, retryCount + 1, signal);
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
    throwIfAborted(options.signal);
    const promptFn = AI_PROMPTS[mode];
    const prompt = promptFn(query, pageContext);
    
    const result = await withRetry(async () => {
      const response = await this.model.generateContent(prompt);
      return response.response.text();
    }, DEFAULT_RETRY_OPTIONS, 0, options.signal);
    
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

if (require.main === module) {
log("Host starting...");

if (!IS_WIN) { try { fs.unlinkSync(SOCKET_PATH); } catch {} }

const pendingRequests = new Map();
const pendingToolRequests = new RequestPendingMap({ getRequest: () => requestStorage.getStore() });
const activeStreams = new Map();
const socketContexts = new WeakMap();
const socketWriters = new WeakMap();
let requestCounter = 0;

function auditSession(event) {
  const context = event.context;
  const principal = context?.principal;
  const request = event.request;
  log(`SESSION ${JSON.stringify({
    event: event.event,
    outcome: event.outcome,
    principalId: principal?.clientId || "local",
    principalLabel: principal?.label || "local",
    peer: context?.socket?.remoteAddress || "local",
    requestId: request?.id,
    tool: request?.tool,
    elapsedMs: event.elapsedMs,
  })}`);
}

aiQueue = new BoundedAiQueue({
  maxQueued: 8,
  audit: (event) => auditSession(event),
  run: (handler, request) => request
    ? requestStorage.run(request, () => handler())
    : handler(),
});

function sendSocket(socket, value, options = {}) {
  const writer = socketWriters.get(socket);
  return writer ? writer.send(value, options) : writeFrame(socket, value);
}

function sendOwnedExtensionMessage(request, message) {
  const cleanupMessage = typeof message?.type === "string" && /(?:CLOSE_TAB|TAB_CLOSE)$/.test(message.type);
  if (request?.hardBoundary) throwIfAborted(request.signal, "Request timed out");
  if (!cleanupMessage) throwIfAborted(request?.signal, "Request cancelled");
  writeMessage(message);
}

function requestCallExtension(request, tool, message, timeoutMs = 30000, cleanup = false) {
  cleanup = cleanup || tool === "close_tab";
  if (request?.hardBoundary) throwIfAborted(request.signal, "Request timed out");
  if (!cleanup) throwIfAborted(request?.signal, "Request cancelled");
  return new Promise((resolve, reject) => {
    const id = ++requestCounter;
    const timer = setTimeout(() => {
      pendingToolRequests.expire(id, new Error(`Timeout waiting for extension: ${tool}`));
    }, timeoutMs);
    const pending = {
      request,
      cleanup,
      tool,
      resolve: (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    };
    pendingToolRequests.set(id, pending);
    try {
      if (cleanup) writeMessage({ ...message, id });
      else sendOwnedExtensionMessage(request, { ...message, id });
    } catch (error) {
      pendingToolRequests.delete(id);
      reject(error);
    }
  });
}

const sessionManager = new HostSessionManager({
  audit: auditSession,
  onTimeout(context, request) {
    pendingToolRequests.hardDeadline(request);
    const response = {
      type: "tool_response",
      id: request.id,
      error: { content: [{ type: "text", text: "Request timed out" }] },
    };
    cleanupRequestTransfers(request)
      .then(() => {
        sessionManager.complete(context, request.id, "hard-timeout");
        if (!context.closed) return sendSocket(context.socket, response);
      })
      .catch((error) => log(`Error settling timed-out request: ${error.message}`));
  },
});

async function discardRequestTransfers(message, state) {
  if (!state) return;
  const ids = [];
  for (const entry of message?._surfTransfers?.uploads || []) if (typeof entry?.transferId === "string") ids.push(entry.transferId);
  for (const entry of message?._surfTransfers?.downloads || []) if (typeof entry?.transferId === "string") ids.push(entry.transferId);
  await Promise.all([...new Set(ids)].map((id) => state.discardCompleted(id)));
}

async function applyRequestTransfers(msg, request, transferState, getTransferState) {
  if (!request.context?.isRemote) return;
  const materialized = await materializeRemoteTool({
    tool: request.tool,
    args: msg.params?.args || {},
    metadata: msg._surfTransfers,
    pathRefs: msg._surfPaths || [],
    transferState,
    getTransferState,
  });
  request.transferState = materialized.transferState;
  request.outputTransfers = materialized.outputTransfers;
  request.pathRewrites = materialized.pathRewrites;
  request.transferCleanup = materialized.transferCleanup;
  msg.params = { ...msg.params, args: materialized.args };
}

async function cleanupRequestTransfers(request) {
  if (!request || request.transferCleanupStarted) return request?.transferCleanupPromise;
  request.transferCleanupStarted = true;
  const paths = request.transferCleanup || [];
  request.transferCleanup = [];
  request.transferCleanupPromise = cleanupFilePaths(paths);
  await request.transferCleanupPromise;
  return request.transferCleanupPromise;
}

function completeOwnedRequest(context, id, outcome) {
  const request = context?.activeRequest;
  if (!request || request.id !== id) return Promise.resolve();
  if (request.pendingEntries?.size && !request.hardBoundary) {
    if (request.completionRequested) return request.completionPromise;
    request.completionRequested = true;
    request.completionOutcome = outcome;
    request.completionPromise = new Promise((resolve) => {
      pendingToolRequests.onDrain(request, () => {
        sessionManager.complete(context, id, request.completionOutcome);
        resolve();
      });
    });
    return request.completionPromise;
  }
  sessionManager.complete(context, id, outcome);
  return Promise.resolve();
}

async function sendRequestDownloads(context, request, result) {
  if (!request) return result;
  let rewritten = result;
  for (const output of request.outputTransfers || []) {
    await streamFileDownload({
      writer: { send: (frame) => sendSocket(context.socket, frame) },
      state: request.transferState,
      filePath: output.path,
      transferId: output.transferId,
      original: output.original,
    });
  }
  rewritten = rewriteTransferPaths(rewritten, request.pathRewrites || []);
  return rewritten;
}

function sendToolResponse(socket, id, result, error) {
  const context = socketContexts.get(socket);
  if (context && !sessionManager.canRespond(context, id)) return;
  const request = context?.activeRequest;
  let finalError = error;
  (async () => {
    let output = result;
    try {
      if (!error) output = await sendRequestDownloads(context, request, result);
    } catch (transferFailure) {
      finalError = transferFailure.message;
    }
    if (finalError && request) {
      finalError = rewriteTransferPaths(finalError, request.pathRewrites || []);
    }
    await cleanupRequestTransfers(request);
    if (request?.settled) return;
    const outcome = request?.signal.aborted
      ? (request.tombstoned ? "cleanup-settled" : "cancelled")
      : finalError ? "error" : "completed";
    await completeOwnedRequest(context, id, outcome);
    const response = { type: "tool_response", id };
    if (finalError) response.error = { content: [{ type: "text", text: finalError }] };
    else response.result = { content: formatToolContent(output, log, { suppressImages: Boolean(context?.isRemote) }) };
    if (!context?.closed) await sendSocket(socket, response);
  })().catch((sendError) => log(`Error sending tool_response: ${sendError.message}`));
}

function stopActiveStream(streamId, { notifyExtension = true } = {}) {
  const stream = activeStreams.get(streamId);
  if (!stream) return;
  activeStreams.delete(streamId);
  sessionManager.stopStream(socketContexts.get(stream.socket));
  if (notifyExtension) writeMessage({ type: "STREAM_STOP", streamId });
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

  sendSocket(socket, { type: "stream_started", streamId }, { stream: true }).catch((error) => {
    log(`Error sending stream_started: ${error.message}`);
    stopActiveStream(streamId);
    socket.destroy(error);
  });
}

function handleToolRequest(msg, socket, requestContext = requestStorage.getStore()) {
  const writeMessage = (message) => sendOwnedExtensionMessage(requestContext, message);
  const { method, params } = msg;
  const originalId = msg.id || null;
  
  if (method !== "execute_tool") {
    sendToolResponse(socket, originalId, null, `Unknown method: ${method}`);
    return;
  }
  
  const { tool, args } = params || {};
  const rawTabId = msg.tabId || params?.tabId || args?.tabId;
  const tabId = rawTabId !== undefined ? parseInt(rawTabId, 10) : undefined;
  const rawWindowId = msg.windowId || params?.windowId || args?.windowId;
  const windowId = rawWindowId !== undefined ? parseInt(rawWindowId, 10) : undefined;
  
  // Validate parsed IDs
  if (tabId !== undefined && isNaN(tabId)) {
    sendToolResponse(socket, originalId, null, "tabId must be a number");
    return;
  }
  if (windowId !== undefined && isNaN(windowId)) {
    sendToolResponse(socket, originalId, null, "windowId must be a number");
    return;
  }
  
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
    require("./abort.cjs").abortableDelay(extensionMsg.seconds * 1000, requestContext.signal)
      .then(() => sendToolResponse(socket, originalId, { success: true }, null))
      .catch((error) => sendToolResponse(socket, originalId, null, error.message));
    return;
  }
  
  if (extensionMsg.type === "BATCH_EXECUTE") {
    executeBatch(extensionMsg.actions, extensionMsg.tabId, socket, originalId, requestContext);
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
    
    requestCallExtension(
      requestContext,
      "read_page",
      { type: "READ_PAGE", options: { filter: "interactive" }, tabId: extensionMsg.tabId },
      45000,
    ).then(async (pageResult) => {
      if (pageResult.error) throw new Error(`Failed to read page: ${pageResult.error}`);
      const pageContent = pageResult.pageContent || "";
      if (!pageContent) throw new Error("No page content available");
      const gemini = getGeminiClient(apiKey);
      const result = await gemini.analyze(extensionMsg.query, pageContent, { mode: extensionMsg.mode, signal: requestContext.signal });
      return result.mode === "find"
        ? { ref: result.content === "NOT_FOUND" ? null : result.content, mode: result.mode, aiResult: true }
        : { content: result.content, mode: result.mode, aiResult: true };
    }).then((result) => sendToolResponse(socket, originalId, result, null)).catch((err) => {
      sendToolResponse(socket, originalId, null, err.message);
    });
    return;
  }
  
  if (extensionMsg.type === "CHATGPT_QUERY") {
    const { query, model, withPage, file, timeout } = extensionMsg;
    
    queueAiRequest(async () => {
      let pageContext = null;
      if (withPage) {
        const pageResult = await requestCallExtension(
          requestContext,
          "read_page",
          { type: "GET_PAGE_TEXT", tabId: extensionMsg.tabId },
          45000,
        );
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
        signal: requestContext.signal,
        model,
        file,
        timeout,
        getCookies: () => requestCallExtension(
          requestContext,
          "get_cookies",
          { type: "GET_CHATGPT_COOKIES" },
        ),
        createTab: () => requestCallExtension(
          requestContext,
          "create_tab",
          { type: "CHATGPT_NEW_TAB" },
        ),
        closeTab: (tabIdToClose) => requestCallExtension(requestContext, "close_tab", { type: "CHATGPT_CLOSE_TAB", tabId: tabIdToClose }, 45000, true),
        cdpEvaluate: (tabId, expression) => requestCallExtension(
          requestContext,
          "cdp_evaluate",
          { type: "CHATGPT_EVALUATE", tabId, expression },
        ),
        cdpCommand: (tabId, method, params) => requestCallExtension(
          requestContext,
          "cdp_command",
          { type: "CHATGPT_CDP_COMMAND", tabId, method, params },
        ),
        uploadFile: (tabId, filePaths) => requestCallExtension(
          requestContext,
          "upload_file",
          buildProviderUploadMessage("chatgpt", tabId, filePaths),
        ),
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
  
  if (extensionMsg.type === "PERPLEXITY_QUERY") {
    const { query, mode, model, withPage, timeout } = extensionMsg;
    
    queueAiRequest(async () => {
      let pageContext = null;
      if (withPage) {
        const pageResult = await requestCallExtension(
          requestContext,
          "read_page",
          { type: "GET_PAGE_TEXT", tabId: extensionMsg.tabId },
          45000,
        );
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
      
      const result = await perplexityClient.query({
        prompt: fullPrompt,
        signal: requestContext.signal,
        mode: mode || 'search',
        model,
        timeout: timeout || 120000,
        createTab: () => requestCallExtension(
          requestContext,
          "create_tab",
          { type: "PERPLEXITY_NEW_TAB" },
        ),
        closeTab: (tabIdToClose) => requestCallExtension(requestContext, "close_tab", { type: "PERPLEXITY_CLOSE_TAB", tabId: tabIdToClose }, 45000, true),
        cdpEvaluate: (tabId, expression) => requestCallExtension(
          requestContext,
          "cdp_evaluate",
          { type: "PERPLEXITY_EVALUATE", tabId, expression },
        ),
        cdpCommand: (tabId, method, params) => requestCallExtension(
          requestContext,
          "cdp_command",
          { type: "PERPLEXITY_CDP_COMMAND", tabId, method, params },
        ),
        log: (msg) => log(`[perplexity] ${msg}`)
      });
      
      return result;
    }).then((result) => {
      sendToolResponse(socket, originalId, {
        response: result.response,
        sources: result.sources,
        url: result.url,
        mode: result.mode,
        model: result.model,
        tookMs: result.tookMs
      }, null);
    }).catch((err) => {
      sendToolResponse(socket, originalId, null, err.message);
    });
    
    return;
  }
  
  if (extensionMsg.type === "GEMINI_QUERY") {
    const { query, model, withPage, file, generateImage, editImage, output, youtube, aspectRatio, timeout } = extensionMsg;
    
    queueAiRequest(async () => {
      // 1. Get page context if requested
      let pageContext = null;
      if (withPage) {
        const pageResult = await requestCallExtension(
          requestContext,
          "get_page_text",
          { type: "GET_PAGE_TEXT", tabId: extensionMsg.tabId },
          45000,
        );
        if (pageResult && !pageResult.error) {
          pageContext = {
            url: pageResult.url,
            text: pageResult.text || pageResult.pageContent || ""
          };
        }
      }
      
      // 2. Build full prompt
      let fullPrompt = query || "";
      if (pageContext) {
        fullPrompt = `Page: ${pageContext.url}\n\n${pageContext.text}\n\n---\n\n${fullPrompt}`;
      }
      
      // 3. Call Gemini client
      const result = await geminiClient.query({
        prompt: fullPrompt,
        signal: requestContext.signal,
        model: model || "gemini-3.1-pro",
        file,
        generateImage,
        editImage,
        output,
        youtube,
        aspectRatio,
        timeout: timeout || 300000,
        getCookies: () => requestCallExtension(
          requestContext,
          "get_cookies",
          { type: "GET_GOOGLE_COOKIES" },
        ),
        createTab: () => requestCallExtension(
          requestContext,
          "create_tab",
          { type: "GEMINI_NEW_TAB" },
        ),
        closeTab: (tabIdToClose) => requestCallExtension(requestContext, "close_tab", { type: "GEMINI_CLOSE_TAB", tabId: tabIdToClose }, 45000, true),
        jsEval: (tabId, code) => requestCallExtension(
          requestContext,
          "js_eval",
          { type: "EXECUTE_JAVASCRIPT", tabId, code },
        ),
        uploadFile: (tabId, filePaths) => requestCallExtension(
          requestContext,
          "upload_file",
          buildProviderUploadMessage("gemini", tabId, filePaths),
        ),
        fetchUrl: (url) => requestCallExtension(
          requestContext,
          "fetch_url",
          { type: "GEMINI_FETCH_URL", url },
        ),
        log: (msg) => log(`[gemini] ${msg}`)
      });
      
      return result;
    }).then((result) => {
      const response = { 
        response: result.response, 
        model: result.model, 
        tookMs: result.tookMs 
      };
      if (result.imagePath) {
        response.imagePath = result.imagePath;
      }
      sendToolResponse(socket, originalId, response, null);
    }).catch((err) => {
      sendToolResponse(socket, originalId, null, err.message);
    });
    
    return;
  }
  
  if (extensionMsg.type === "GROK_QUERY") {
    const { query, model, deepSearch, withPage, timeout } = extensionMsg;
    
    queueAiRequest(async () => {
      // 1. Get page context if requested
      let pageContext = null;
      if (withPage) {
        const pageResult = await requestCallExtension(
          requestContext,
          "get_page_text",
          { type: "GET_PAGE_TEXT", tabId: extensionMsg.tabId },
          45000,
        );
        if (pageResult && !pageResult.error) {
          pageContext = {
            url: pageResult.url,
            text: pageResult.text || pageResult.pageContent || ""
          };
        }
      }
      
      // 2. Build full prompt
      let fullPrompt = query || "";
      if (pageContext) {
        fullPrompt = `Page: ${pageContext.url}\n\n${pageContext.text}\n\n---\n\n${fullPrompt}`;
      }
      
      // 3. Call Grok client
      const result = await grokClient.query({
        prompt: fullPrompt,
        signal: requestContext.signal,
        model: model,
        deepSearch: deepSearch || false,
        timeout: timeout || 300000,
        getCookies: () => requestCallExtension(
          requestContext,
          "get_cookies",
          { type: "GET_TWITTER_COOKIES" },
        ),
        createTab: () => requestCallExtension(
          requestContext,
          "create_tab",
          { type: "GROK_NEW_TAB" },
        ),
        closeTab: (tabIdToClose) => requestCallExtension(requestContext, "close_tab", { type: "GROK_CLOSE_TAB", tabId: tabIdToClose }, 45000, true),
        cdpEvaluate: (tabId, expression) => requestCallExtension(
          requestContext,
          "cdp_evaluate",
          { type: "GROK_EVALUATE", tabId, expression },
        ),
        cdpCommand: (tabId, method, params) => requestCallExtension(
          requestContext,
          "cdp_command",
          { type: "GROK_CDP_COMMAND", tabId, method, params },
        ),
        log: (msg) => log(`[grok] ${msg}`)
      });
      
      return result;
    }).then((result) => {
      const response = { 
        response: result.response, 
        model: result.model, 
        tookMs: result.tookMs 
      };
      if (result.thinkingTime) {
        response.thinkingTime = result.thinkingTime;
      }
      if (result.deepSearch) {
        response.deepSearch = result.deepSearch;
      }
      if (result.partial) {
        response.partial = true;
      }
      if (result.warnings && result.warnings.length > 0) {
        response.warnings = result.warnings;
      }
      if (result.modelSelectionFailed) {
        response.modelSelectionFailed = true;
      }
      sendToolResponse(socket, originalId, response, null);
    }).catch((err) => {
      sendToolResponse(socket, originalId, null, err.message);
    });
    
    return;
  }
  
  if (extensionMsg.type === "GROK_VALIDATE") {
    const { saveModels } = extensionMsg;
    
    queueAiRequest(async () => {
      const result = await grokClient.validate({
        signal: requestContext.signal,
        getCookies: () => requestCallExtension(
          requestContext,
          "get_cookies",
          { type: "GET_TWITTER_COOKIES" },
        ),
        createTab: () => requestCallExtension(
          requestContext,
          "create_tab",
          { type: "GROK_NEW_TAB" },
        ),
        closeTab: (tabIdToClose) => requestCallExtension(
          requestContext,
          "close_tab",
          { type: "GROK_CLOSE_TAB", tabId: tabIdToClose },
          45000,
          true,
        ),
        cdpEvaluate: (tabId, expression) => requestCallExtension(
          requestContext,
          "cdp_evaluate",
          { type: "GROK_EVALUATE", tabId, expression },
        ),
        log: (msg) => log(`[grok:validate] ${msg}`)
      });
      
      return result;
    }).then((result) => {
      // If --save-models flag was passed and we found models, save them
      if (saveModels && result.models && result.models.length > 0) {
        // Convert scraped model names to selectable IDs.
        const modelMap = {};
        const defaultModels = Object.values(grokClient.DEFAULT_GROK_MODELS || {});
        result.models.forEach(name => {
          const nameLower = name.toLowerCase();
          const normalizedName = grokClient.normalizeGrokModelLabel(name);
          const knownModel = defaultModels.find(model => {
            const normalizedDefaultName = grokClient.normalizeGrokModelLabel(model.name);
            return normalizedName.includes(normalizedDefaultName) || normalizedDefaultName.includes(normalizedName);
          });
          // Match known model keywords to generate consistent short IDs
          let shortId;
          if (knownModel) shortId = knownModel.id;
          else if (nameLower.includes('expert')) shortId = 'expert';
          else if (nameLower.includes('fast')) shortId = 'fast';
          else if (nameLower.includes('auto')) shortId = 'auto';
          else shortId = nameLower.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          
          modelMap[shortId] = { id: shortId, name: name, desc: knownModel?.desc || "" };
        });
        const saveResult = grokClient.saveModels(modelMap);
        result.savedModels = saveResult;
      }
      sendToolResponse(socket, originalId, result, null);
    }).catch((err) => {
      sendToolResponse(socket, originalId, null, err.message);
    });
    
    return;
  }

  if (extensionMsg.type === "AISTUDIO_QUERY") {
    const { query, model, withPage, timeout } = extensionMsg;
    
    queueAiRequest(async () => {
      const EXT_CALL_TIMEOUT_MS = 30000;

      const callExtension = (toolName, msg, timeoutMs = EXT_CALL_TIMEOUT_MS) => {
        if (msg?.type === "AISTUDIO_NEW_TAB") {
          log(`[aistudio] Opening tab: ${(msg.url || "https://aistudio.google.com/prompts/new_chat")}`);
        }
        return requestCallExtension(requestContext, toolName, msg, timeoutMs);
      };

      // 1. Get page context if requested
      let pageContext = null;
      if (withPage) {
        const pageResult = await callExtension(
          "get_page_text",
          { type: "GET_PAGE_TEXT", tabId: extensionMsg.tabId },
          45000
        );

        if (pageResult && !pageResult.error) {
          pageContext = {
            url: pageResult.url,
            text: pageResult.text || pageResult.pageContent || ""
          };
        }
      }

      // 2. Build full prompt
      let fullPrompt = query || "";
      if (pageContext) {
        const MAX_PAGE_CONTEXT_CHARS = 20000;
        const pageText = String(pageContext.text || "");
        const truncated = pageText.length > MAX_PAGE_CONTEXT_CHARS
          ? pageText.slice(0, MAX_PAGE_CONTEXT_CHARS) + "\n\n[...truncated...]"
          : pageText;

        fullPrompt = `Page: ${pageContext.url}\n\n${truncated}\n\n---\n\n${fullPrompt}`;
      }

      // 3. Call AI Studio client
      const result = await aistudioClient.query({
        prompt: fullPrompt,
        signal: requestContext.signal,
        model: model || undefined,
        timeout: timeout || 300000,
        getCookies: () => callExtension("get_cookies", { type: "GET_GOOGLE_COOKIES" }, 45000),
        createTab: (url) => callExtension(
          "create_tab",
          { type: "AISTUDIO_NEW_TAB", url },
          45000
        ),
        closeTab: (tabIdToClose) => callExtension(
          "close_tab",
          { type: "AISTUDIO_CLOSE_TAB", tabId: tabIdToClose },
          45000
        ),
        cdpEvaluate: (tabId, expression) => callExtension(
          "cdp_evaluate",
          { type: "AISTUDIO_EVALUATE", tabId, expression }
        ),
        cdpCommand: (tabId, method, params) => callExtension(
          "cdp_command",
          { type: "AISTUDIO_CDP_COMMAND", tabId, method, params }
        ),
        readNetworkEntries: (tabIdToRead) => callExtension(
          "read_network_entries",
          {
            type: "READ_NETWORK_REQUESTS",
            tabId: tabIdToRead,
            full: true,
            limit: 100,
            urlPattern: "MakerSuiteService/GenerateContent"
          },
          45000
        ),
        log: (msg) => log(`[aistudio] ${msg}`)
      });

      return result;
    }).then((result) => {
      const payload = {
        response: result.response,
        model: result.model,
        thinkingTime: result.thinkingTime,
        tookMs: result.tookMs
      };

      sendToolResponse(socket, originalId, { output: JSON.stringify(payload) }, null);
    }).catch((err) => {
      sendToolResponse(socket, originalId, null, err.message);
    });
    
    return;
  }

  if (extensionMsg.type === "AISTUDIO_BUILD") {
    const { query, model, output, keepOpen, timeout } = extensionMsg;

    queueAiRequest(async () => {
      const EXT_CALL_TIMEOUT_MS = 30000;

      const callExtension = (toolName, msg, timeoutMs = EXT_CALL_TIMEOUT_MS) => {
        if (msg?.type === "AISTUDIO_NEW_TAB") {
          log(`[aistudio] Opening tab: ${(msg.url || "https://aistudio.google.com/apps")}`);
        }
        return requestCallExtension(requestContext, toolName, msg, timeoutMs);
      };

      const result = await aistudioBuild.build({
        prompt: query,
        signal: requestContext.signal,
        model: model || undefined,
        output,
        keepOpen,
        timeout: timeout || 600000,
        getCookies: () => callExtension("get_cookies", { type: "GET_GOOGLE_COOKIES" }, 45000),
        createTab: (url) => callExtension(
          "create_tab",
          { type: "AISTUDIO_NEW_TAB", url },
          45000
        ),
        closeTab: (tabIdToClose) => callExtension(
          "close_tab",
          { type: "AISTUDIO_CLOSE_TAB", tabId: tabIdToClose },
          45000
        ),
        cdpEvaluate: (tabId, expression) => callExtension(
          "cdp_evaluate",
          { type: "AISTUDIO_EVALUATE", tabId, expression }
        ),
        cdpCommand: (tabId, method, params) => callExtension(
          "cdp_command",
          { type: "AISTUDIO_CDP_COMMAND", tabId, method, params }
        ),
        searchDownloads: async (params) => {
          const result = await callExtension(
            "downloads_search",
            { type: "DOWNLOADS_SEARCH", searchParams: params },
            10000
          );
          return result?.downloads || [];
        },
        log: (msg) => log(`[aistudio:build] ${msg}`)
      });

      return result;
    }).then((result) => {
      sendToolResponse(socket, originalId, { output: JSON.stringify(result) }, null);
    }).catch((err) => {
      sendToolResponse(socket, originalId, null, err.message);
    });

    return;
  }
  
  if (extensionMsg.type === "EXECUTE_KEY_REPEAT") {
    const { key, repeat, tabId: tid } = extensionMsg;
    let completed = 0;
    let lastError = null;
    
    const sendNextKey = () => {
      if (requestContext.signal.aborted) return;
      if (completed >= repeat) {
        if (lastError) {
          sendToolResponse(socket, originalId, null, `Key repeat failed: ${lastError}`);
        } else {
          sendToolResponse(socket, originalId, { success: true }, null);
        }
        return;
      }
      requestCallExtension(
        requestContext,
        tool,
        { type: "EXECUTE_KEY", key, tabId: tid },
      ).then((result) => {
        if (result.error) lastError = result.error;
        completed++;
        return require("./abort.cjs").abortableDelay(50, requestContext.signal);
      }).then(sendNextKey).catch((error) => sendToolResponse(socket, originalId, null, error.message));
    };
    sendNextKey();
    return;
  }
  
  if (extensionMsg.type === "NAMED_TAB_SWITCH" || extensionMsg.type === "NAMED_TAB_CLOSE") {
    const { name, type: opType } = extensionMsg;
    requestCallExtension(
      requestContext,
      "tabs_get_by_name",
      { type: "TABS_GET_BY_NAME", name },
    ).then((result) => {
      if (result.error || !result.tabId) {
        throw new Error(result.error || `No tab found with name "${name}"`);
      }
      const actionType = opType === "NAMED_TAB_SWITCH" ? "SWITCH_TAB" : "CLOSE_TAB";
      const actionTool = opType === "NAMED_TAB_SWITCH" ? "switch_tab" : "close_tab";
      return requestCallExtension(
        requestContext,
        actionTool,
        { type: actionType, tabId: result.tabId },
        30000,
        actionTool === "close_tab",
      );
    }).then((result) => sendToolResponse(socket, originalId, result, result?.error || null))
      .catch((error) => sendToolResponse(socket, originalId, null, error.message));
    return;
  }
  
  const id = ++requestCounter;
  const pendingData = { 
    socket, 
    originalId, 
    tool, 
    savePath: extensionMsg.savePath || args?.savePath,
    autoScreenshot: args?.autoScreenshot === true,
    autoScreenshotOutput: args?.autoScreenshotOutput,
    networkExport: extensionMsg.type === "EXPORT_NETWORK_REQUESTS",
    networkExportPath: args?.output,
    networkExportFormat: extensionMsg.har ? "har" : extensionMsg.jsonl ? "jsonl" : "json",
    fullRes: extensionMsg.fullRes || args?.fullRes,
    maxSize: extensionMsg.maxSize || args?.maxSize,
    tabId: extensionMsg.tabId || tabId
  };
  pendingToolRequests.set(id, pendingData);
  
  // Include windowId for tab resolution scoping
  const finalMsg = { ...extensionMsg, id };
  if (windowId) finalMsg.windowId = windowId;
  writeMessage(finalMsg);
}

function executeBatch(actions, tabId, socket, originalId, requestContext = requestStorage.getStore()) {
  const writeMessage = (message) => sendOwnedExtensionMessage(requestContext, message);
  const results = [];
  const DELAY_MS = 100;
  let currentIndex = 0;
  
  function executeNextAction() {
    if (requestContext.signal.aborted) return;
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
      require("./abort.cjs").abortableDelay(extensionMsg.seconds * 1000, requestContext.signal)
        .then(executeNextAction)
        .catch((error) => sendToolResponse(socket, originalId, null, error.message));
      return;
    }
    
    requestCallExtension(requestContext, toolName, extensionMsg, 30000)
      .then((result) => {
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
        return require("./abort.cjs").abortableDelay(DELAY_MS, requestContext.signal)
          .then(executeNextAction);
      })
      .catch((error) => sendToolResponse(socket, originalId, null, error.message));
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
      log(`Received from extension: ${msg.type || "unknown"}${msg.id !== undefined ? ` id=${msg.id}` : ""}`);
      
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
          sendSocket(stream.socket, msg.event, { stream: true }).catch((error) => {
            log(`Error forwarding stream event: ${error.message}`);
            stopActiveStream(msg.streamId);
            stream.socket.destroy(error);
          });
        }
        return;
      }

      if (msg.type === "STREAM_ERROR") {
        const stream = activeStreams.get(msg.streamId);
        if (stream) {
          sendSocket(stream.socket, { error: msg.error }, { stream: true })
            .catch((error) => {
              log(`Error forwarding stream error: ${error.message}`);
              stream.socket.destroy(error);
            })
            .finally(() => stopActiveStream(msg.streamId));
        }
        return;
      }
      
      
      if (msg.id && pendingToolRequests.has(msg.id)) {
        const pending = pendingToolRequests.get(msg.id);
        if (pending.request?.signal.aborted || pending.request?.tombstoned) {
          const request = pending.request;
          const topLevelResponse = !pending.resolve && !pending.onComplete;
          pendingToolRequests.resolve(msg.id, msg);
          if (topLevelResponse && request?.context) {
            completeOwnedRequest(request.context, request.id, "cleanup-settled");
          }
          return;
        }
        if (pending.resolve || pending.onComplete) {
          pendingToolRequests.resolve(msg.id, msg);
          return;
        }
        pendingToolRequests.delete(msg.id);
        {

          const { socket, originalId, savePath, autoScreenshot, tabId: storedTabId } = pending;
          const tabId = storedTabId || msg._resolvedTabId;
          const failAutoScreenshot = (message) => pending.autoScreenshotOutput
            ? sendToolResponse(socket, originalId, null, `Auto-screenshot failed: ${message}`)
            : sendToolResponse(socket, originalId, { ...msg, autoScreenshotError: message }, null);
          
          if (pending.networkExport && Array.isArray(msg.entries)) {
            try {
              const exportResult = writeNetworkExport(pending.networkExportPath, msg.entries, pending.networkExportFormat);
              sendToolResponse(socket, originalId, exportResult, null);
            } catch (error) {
              sendToolResponse(socket, originalId, null, `Failed to export network requests: ${error.message}`);
            }
          } else if (savePath && msg.base64) {
            try {
              const dir = path.dirname(savePath);
              if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(savePath, Buffer.from(msg.base64, "base64"), { mode: 0o600 });
              try { fs.chmodSync(savePath, 0o600); } catch {}
              const origWidth = msg.width || 0;
              const origHeight = msg.height || 0;
              const maxSize = pending.maxSize || 1200;
              const skipResize = pending.fullRes;
              
              let finalDims = origWidth && origHeight ? `${origWidth}x${origHeight}` : "";
              if (!skipResize && (origWidth > maxSize || origHeight > maxSize)) {
                const result = resizeImage(savePath, maxSize);
                if (result.success) {
                  finalDims = `${result.width}x${result.height}, from ${origWidth}x${origHeight}`;
                }
              }
              sendToolResponse(socket, originalId, { 
                message: `Saved to ${savePath} (${finalDims})`,
                path: savePath,
                screenshotId: msg.screenshotId,  // Preserve for upload_image workflow
              }, null);
            } catch (e) {
              sendToolResponse(socket, originalId, null, `Failed to save: ${e.message}`);
            }
          } else if (autoScreenshot && tabId && !msg.error && !msg.base64) {
            
            const screenshotPath = pending.autoScreenshotOutput || path.join(SURF_TMP, `pi-auto-${Date.now()}.png`);
            
            const autoFiles = fs.readdirSync(SURF_TMP)
              .filter(f => f.startsWith("pi-auto-") && f.endsWith(".png"))
              .map(f => ({ name: f, time: parseInt(f.match(/pi-auto-(\d+)\.png/)?.[1] || "0", 10) }))
              .sort((a, b) => b.time - a.time);
            if (autoFiles.length >= 10) {
              autoFiles.slice(9).forEach(f => {
                try { fs.unlinkSync(path.join(SURF_TMP, f.name)); } catch (e) {}
              });
            }
            require("./abort.cjs").abortableDelay(500, pending.request?.signal)
              .then(() => requestCallExtension(
                pending.request,
                "screenshot",
                { type: "EXECUTE_SCREENSHOT", tabId },
              ))
              .then((screenshotMsg) => {
                if (screenshotMsg.base64) {
                  try {
                    fs.writeFileSync(screenshotPath, Buffer.from(screenshotMsg.base64, "base64"), { mode: 0o600 });
                    try { fs.chmodSync(screenshotPath, 0o600); } catch {}
                    const origW = screenshotMsg.width || 0;
                    const origH = screenshotMsg.height || 0;
                    let finalW = origW, finalH = origH;
                    const maxSize = 1200;
                    if (origW > maxSize || origH > maxSize) {
                      const result = resizeImage(screenshotPath, maxSize);
                      if (result.success) {
                        finalW = result.width;
                        finalH = result.height;
                      }
                    }
                    sendToolResponse(socket, originalId, {
                      ...msg,
                      autoScreenshot: { path: screenshotPath, width: finalW, height: finalH, originalWidth: origW, originalHeight: origH }
                    }, null);
                  } catch (e) {
                    failAutoScreenshot(e.message);
                  }
                } else {
                  const errMsg = screenshotMsg.error || "Failed to capture";
                  failAutoScreenshot(errMsg);
                }
              })
              .catch((error) => failAutoScreenshot(error.message));
            return;
          } else if (autoScreenshot && pending.autoScreenshotOutput && !msg.error) {
            failAutoScreenshot(tabId ? "screenshot response was invalid" : "no tab available");
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
        sendSocket(socket, msg).catch((error) => log(`Error writing to CLI socket: ${error.message}`));
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

// Track connected CLI sockets for disconnect notification
const connectedSockets = new Set();

process.stdin.on("end", () => {
  log("stdin ended (extension disconnected), notifying clients");
  for (const socket of Array.from(connectedSockets)) {
    sendSocket(socket, {
      type: "extension_disconnected",
      message: "Surf extension was reloaded. Restart your command."
    }).finally(() => socket.end()).catch(() => socket.end());
  }
  shutdown(0);
});

process.stdin.on("error", (err) => {
  log(`stdin error: ${err.message}`);
});

process.stdout.on("error", (err) => {
  log(`stdout error: ${err.message}`);
});

const handleClient = (socket) => {
  const isRemote = Boolean(socket.remoteAddress && socket.remotePort);
  let transferState;
  let transferReady;
  let transferCleanupPromise;
  const cleanupTransfers = () => {
    if (!transferCleanupPromise) {
      transferCleanupPromise = transferReady
        ? transferReady.then((state) => state?.cleanup())
        : Promise.resolve();
    }
    return transferCleanupPromise;
  };
  socket.transferCleanup = cleanupTransfers;
  const ensureTransferState = () => {
    if (context?.closed || socket.destroyed) throw transferError("transfer connection is closed", "SURF_TRANSFER_CLOSED");
    if (!transferReady) {
      transferCleanupPromise = undefined;
      transferReady = createStagingDirectory(SURF_TMP)
        .then(async (directory) => {
          if (context?.closed || socket.destroyed) {
            await fs.promises.rm(directory, { recursive: true, force: true }).catch(() => {});
            throw transferError("transfer connection is closed", "SURF_TRANSFER_CLOSED");
          }
          try {
            return createTransferState({ directory, writer: { send: (frame) => sendSocket(socket, frame) }, onActivity: () => sessionManager.touch(socketContexts.get(socket)) });
          } catch (error) {
            return fs.promises.rm(directory, { recursive: true, force: true }).catch(() => {}).then(() => { throw error; });
          }
        })
        .catch((error) => { transferReady = undefined; throw error; });
    }
    return transferReady;
  };
  let context;
  try {
    context = sessionManager.admit(socket, isRemote);
  } catch (error) {
    sendSocket(socket, { error: error.message }).finally(() => socket.destroy()).catch(() => socket.destroy());
    return;
  }
  const writer = createSocketWriter(socket, {
    maxPendingBytes: 4 * 1024 * 1024,
    onOverflow: ({ stream, error }) => {
      auditSession({ event: stream ? "stream" : "writer", context, outcome: "overflow", request: context.activeRequest });
      sessionManager.stopStream(context);
      socket.destroy(error);
    },
  });
  socketContexts.set(socket, context);
  socketWriters.set(socket, writer);
  log("CLI client connected");
  connectedSockets.add(socket);
  socket.on("close", () => connectedSockets.delete(socket));
  
  const stateDir = getStateDir();
  let principal = null;
  const authSession = isRemote ? createServerAuthSession({
    socket,
    stateDir,
    send: (value) => sendSocket(socket, value),
    async onAuthenticated(authenticatedPrincipal) {
      sessionManager.authenticate(context, authenticatedPrincipal);
      principal = authenticatedPrincipal;
      log(`Remote client authenticated: ${authenticatedPrincipal.label} (${authenticatedPrincipal.clientId})`);
    },
    onError(error) {
      log(`Remote authentication rejected: ${error.message}`);
      sendSocket(socket, { type: "auth_error", message: error.message }).finally(() => socket.destroy()).catch(() => socket.destroy());
    },
  }) : null;
  let messageChain = Promise.resolve();
  const processMessage = async (msg) => {
    if (context.closed) return;
    if (isRemote && !authSession.authenticated) {
      await authSession.handle(msg);
      return;
    }
    if (isRemote) {
      let authorized = false;
      try {
        authorized = Boolean(principal && isClientAuthorized(stateDir, principal.clientId));
      } catch (error) {
        log(`Remote authorization registry check failed: ${error.message}`);
      }
      if (!authorized) {
        await sendSocket(socket, { error: "remote client authorization is unavailable or revoked" }).catch(() => {});
        socket.destroy();
        return;
      }
    }

    if (isRemote && msg.type && msg.type.startsWith("transfer_")) {
      transferState ||= await ensureTransferState();
      await transferState.handle(msg);
      return;
    }

    if (msg.type === "tool_request") {
      const tool = msg.params?.tool || "unknown";
      let request;
      try {
        const deadlineMs = TEST_REQUEST_DEADLINE_MS || resolveRequestDeadlineMs(tool, msg.params?.args);
        request = await sessionManager.beginRequest(context, { id: msg.id, tool, deadlineMs });
        request.context = context;
      } catch (error) {
        if (transferState) await discardRequestTransfers(msg, transferState);
        await sendSocket(socket, { type: "tool_response", id: msg.id || null, error: { content: [{ type: "text", text: error.message }] } }).catch(() => {});
        return;
      }
      log(`Handling tool_request: ${msg.method} ${tool}${principal ? ` for ${principal.label}` : ""}`);
      try {
        if (isRemote) {
          await applyRequestTransfers(msg, request, transferState, ensureTransferState);
        }
        throwIfAborted(request.signal, "Request cancelled");
        requestStorage.run(request, () => handleToolRequest(msg, socket, request));
      } catch (e) {
        await discardRequestTransfers(msg, transferState);
        sendToolResponse(socket, msg.id || null, null, e.message || "Request failed");
      }
      return;
    }

    if (msg.type === "stream_request") {
      if (msg.streamType !== "STREAM_CONSOLE" && msg.streamType !== "STREAM_NETWORK") {
        log(`Rejecting unsupported stream type: ${msg.streamType}`);
        await sendSocket(socket, { error: `Unsupported stream type: ${msg.streamType}` }).catch(() => {});
        return;
      }
      if (!sessionManager.canStartStream(context)) {
        await sendSocket(socket, { error: "stream limit reached or connection is not stream-only" }).catch(() => {});
        socket.destroy();
        return;
      }
      log(`Handling stream_request: ${msg.streamType}`);
      handleStreamRequest(msg, socket);
      return;
    }

    if (msg.type === "stream_stop") {
      log("Handling stream_stop");
      for (const [streamId, stream] of activeStreams.entries()) {
        if (stream.socket === socket) stopActiveStream(streamId);
      }
      return;
    }

    log(`Rejecting unsupported socket request type: ${msg.type}`);
    await sendSocket(socket, { error: `Unsupported request type: ${msg.type}` }).catch(() => {});
  };

  const parser = createFrameParser({
    onFrame(msg) {
      messageChain = messageChain.then(() => processMessage(msg)).catch((error) => {
        log(`Error handling CLI request: ${error.message}`);
        if (isRemote && msg.type && msg.type.startsWith("transfer_")) {
          sendSocket(socket, { type: "transfer_error", version: 1, transferId: msg.transferId, error: error.message || "Transfer failed" })
            .finally(() => socket.destroy()).catch(() => socket.destroy());
        } else {
          sendSocket(socket, { error: error.message || "Request failed" }).catch(() => {});
        }
      });
    },
    onError(error) {
      log(`CLI frame rejected: ${error.message}`);
      if (isRemote && !authSession.authenticated) {
        sendSocket(socket, { type: "auth_error", message: error.message }).finally(() => socket.destroy()).catch(() => socket.destroy());
      } else {
        socket.destroy();
      }
    },
    maxFrameBytes: MAX_CLIENT_FRAME_BYTES,
  });

  socket.on("data", (data) => parser.push(data));

  socket.on("error", (err) => {
    log(`CLI socket error: ${err.message}`);
  });
  
  socket.on("close", () => {
    parser.close();
    authSession?.close();
    const activeRequest = context.activeRequest;
    let cleanupPendingId;
    if (activeRequest && !activeRequest.queued) {
      cleanupPendingId = `transfer-cleanup-${++requestCounter}`;
      pendingToolRequests.set(cleanupPendingId, {
        request: activeRequest,
        cleanup: true,
        tool: "transfer_cleanup",
        resolve: () => {},
        reject: () => {},
      });
      completeOwnedRequest(context, activeRequest.id, "cleanup-settled");
    }
    const cleanupPromise = cleanupTransfers();
    cleanupPromise.finally(() => {
      if (cleanupPendingId) pendingToolRequests.delete(cleanupPendingId);
    }).catch(() => {});
    writer.close();
    sessionManager.close(context);
    if (activeRequest) pendingToolRequests.tombstoneAfterAbort(activeRequest);
    log("CLI client disconnected");
    for (const [streamId, stream] of activeStreams.entries()) {
      if (stream.socket === socket) stopActiveStream(streamId);
    }
  });
};

let listenerLifecycle = null;
let shuttingDown = false;
let exitCode = 0;
let exitScheduled = false;
function scheduleExit() {
  if (exitScheduled) return;
  exitScheduled = true;
  setTimeout(() => process.exit(exitCode), 50);
}
function shutdown(code = 0) {
  exitCode = Math.max(exitCode, code);
  if (shuttingDown) return;
  shuttingDown = true;
  const cleanupPromises = [...connectedSockets].map((socket) => socket.transferCleanup?.() || Promise.resolve());
  for (const socket of connectedSockets) socket.destroy();
  pendingRequests.clear(); pendingToolRequests.clear(); activeStreams.clear();
  Promise.allSettled([...cleanupPromises, Promise.resolve(listenerLifecycle?.shutdown())]).finally(scheduleExit);
}
function failStartup(error, endpoint) {
  log(`Listener startup failed (${endpoint}): ${error.message}`);
  shutdown(1);
}
async function startListeners() {
  let endpoint;
  try {
    endpoint = process.env.SURF_LISTEN ? parseListenEndpoint(process.env.SURF_LISTEN) : null;
    listenerLifecycle = createListenerLifecycle({
      localPath: SOCKET_PATH,
      tcpEndpoint: endpoint && { host: endpoint.host, port: endpoint.port },
      handler: handleClient,
      onReady: () => {
        if (endpoint) log(`TCP listener listening on ${endpoint.display}`);
        writeMessage({ type: "HOST_READY" });
        log("Sent HOST_READY to extension");
      },
      onFatal: (error) => failStartup(error, endpoint?.display || process.env.SURF_LISTEN || SOCKET_PATH),
    });
    if (shuttingDown) await listenerLifecycle.shutdown();
    await listenerLifecycle.start();
  } catch (error) { failStartup(error, endpoint?.display || process.env.SURF_LISTEN || SOCKET_PATH); }
}
startListeners();

process.on("SIGTERM", () => {
  log("SIGTERM received");
  shutdown();
});

process.on("SIGINT", () => {
  log("SIGINT received");
  shutdown();
});

process.on("uncaughtException", (err) => {
  log(`Uncaught exception: ${err.message}\n${err.stack}`);
  shutdown(1);
});

log("Host initialization complete, waiting for connections...");
} else {
  module.exports = { createListenerLifecycle, MAX_CLIENT_FRAME_BYTES };
}
