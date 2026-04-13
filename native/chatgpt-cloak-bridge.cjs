/**
 * ChatGPT CloakBrowser Bridge
 *
 * Node.js module that spawns CloakBrowser workers (.mjs) and
 * communicates via stdin/stdout JSON-lines protocol.
 */

const { spawn } = require("child_process");
const { existsSync } = require("fs");
const { join, dirname } = require("path");
const {
  resolveChatsTimeoutSeconds,
  resolveQueryTimeoutSeconds,
} = require("./chatgpt-cloak-timeout.cjs");

const DEFAULT_RUNTIME = { spawn, existsSync };
let runtime = { ...DEFAULT_RUNTIME };

const QUERY_WORKER_PATH = join(__dirname, "chatgpt-cloak-worker.mjs");
const CHATS_WORKER_PATH = join(__dirname, "chatgpt-cloak-chats-worker.mjs");

// ---------------------------------------------------------------------------
// Availability check
// ---------------------------------------------------------------------------

function isCloakBrowserAvailable() {
  try {
    let dir = __dirname;
    for (let i = 0; i < 6; i++) {
      if (runtime.existsSync(join(dir, "node_modules", "cloakbrowser", "package.json"))) return true;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return false;
  } catch {
    return false;
  }
}

function ensureAvailability(workerPath) {
  if (!isCloakBrowserAvailable()) {
    throw Object.assign(
      new Error("CloakBrowser not installed. Run: npm install cloakbrowser playwright-core"),
      { code: "cloakbrowser_not_installed" }
    );
  }

  if (!runtime.existsSync(workerPath)) {
    throw Object.assign(
      new Error("CloakBrowser worker not found: " + workerPath),
      { code: "worker_not_found" }
    );
  }
}

function resolveWorkerTimeoutSeconds(timeout, request) {
  const numeric = Number(timeout);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  return request?.type === "query"
    ? resolveQueryTimeoutSeconds(undefined)
    : resolveChatsTimeoutSeconds(undefined);
}

function runCloakWorker({ workerPath, request, timeout, onProgress = () => {}, mapSuccess = (msg) => msg }) {
  ensureAvailability(workerPath);

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const clearWorkerTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        clearWorkerTimer();
        fn(value);
      }
    };

    const worker = runtime.spawn(process.execPath, [workerPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    const timeoutSec = resolveWorkerTimeoutSeconds(timeout, request);
    const timeoutMs = timeoutSec * 1000;
    const armWorkerTimer = () => {
      clearWorkerTimer();
      timer = setTimeout(() => {
        worker.kill("SIGTERM");
        settle(reject, Object.assign(new Error(`CloakBrowser worker killed after ${timeoutMs}ms`), { code: "timeout" }));
      }, timeoutMs);
    };
    armWorkerTimer();

    const handleWorkerMessage = (msg) => {
      if (msg.type === "progress" || msg.type === "trace" || msg.type === "meta_update" || msg.type === "keepalive" || msg.type === "success" || msg.type === "error") {
        armWorkerTimer();
      }
      switch (msg.type) {
        case "progress":
          onProgress(msg);
          return false;
        case "success":
          settle(resolve, mapSuccess(msg));
          return true;
        case "error":
          settle(reject, Object.assign(new Error(msg.message), { code: msg.code, details: msg.details }));
          return true;
        case "trace":
          onProgress({
            type: "trace",
            phase: msg.phase,
            isThinking: msg.isThinking,
            traceType: msg.traceType,
            thoughtText: msg.thoughtText,
            thoughtDelta: msg.thoughtDelta,
            thoughtCount: msg.thoughtCount,
            durationSec: msg.durationSec,
            recapText: msg.recapText,
          });
          return false;
        case "meta_update":
          onProgress({
            type:                       "meta_update",
            conversationId:             msg.conversationId || null,
            baselineAssistantMessageId: msg.baselineAssistantMessageId || null,
            lastCheckpoint:             msg.lastCheckpoint || null,
            sentAt:                     msg.sentAt || null,
            source:                     msg.source || null,
            t:                          msg.t || Date.now(),
          });
          return false;
        case "keepalive":
          return false;
        case "log":
          if (process.env.SURF_DEBUG) {
            process.stderr.write(`[cloak:${msg.level}] ${msg.message}\n`);
          }
          return false;
        default:
          return false;
      }
    };

    let stdoutBuf = "";
    worker.stdout.setEncoding("utf8");
    worker.stdout.on("data", (chunk) => {
      stdoutBuf += chunk;
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          handleWorkerMessage(msg);
        } catch {
          // Ignore non-JSON lines.
        }
      }
    });

    worker.stderr.setEncoding("utf8");
    worker.stderr.on("data", (chunk) => {
      if (chunk.includes("[cloakbrowser]")) {
        process.stderr.write(chunk);
      }
    });

    const tryHandleLine = (line) => {
      if (!line || !line.trim()) return false;
      try {
        const msg = JSON.parse(line);
        return handleWorkerMessage(msg);
      } catch {
        return false;
      }
    };

    worker.on("close", (code, signal) => {
      clearWorkerTimer();
      if (settled) return;
      if (stdoutBuf.trim()) {
        const handled = tryHandleLine(stdoutBuf);
        stdoutBuf = "";
        if (handled || settled) return;
      }
      if (signal) {
        settle(reject, Object.assign(new Error(`CloakBrowser worker killed by ${signal}`), { code: "worker_killed", signal }));
      } else {
        settle(reject, Object.assign(new Error(`CloakBrowser worker exited ${code} without result`), { code: "worker_exit", exitCode: code }));
      }
    });

    worker.stdin.write(JSON.stringify(request) + "\n");
  });
}

async function queryWithCloakBrowser(opts, onProgress = () => {}) {
  const timeout = resolveQueryTimeoutSeconds(opts.timeout);
  const { model, file, profile, conversationId } = opts;
  const prompt = opts.prompt || opts.query || "";
  const promptKB = (Buffer.byteLength(prompt, "utf-8") / 1024).toFixed(1);
  const estimatedTokens = Math.ceil(prompt.length / 4);
  const tokenKStr = (estimatedTokens / 1000).toFixed(1) + "K";
  if (Number(promptKB) > 10) {
    console.error(`[cloak-bridge] Prompt: ${promptKB}KB (${prompt.split("\n").length} lines, ~${tokenKStr} tokens)`);
  }
  if (estimatedTokens > 120_000) {
    console.error(`[cloak-bridge] ⚠ Prompt ~${tokenKStr} tokens — approaching GPT Pro 150K limit`);
  }
  const generateImage = opts["generate-image"] || opts.generateImage || null;

  return runCloakWorker({
    workerPath: QUERY_WORKER_PATH,
    request: {
      type: "query",
      prompt,
      model,
      file,
      profile,
      timeout,
      generateImage,
      conversationId,
    },
    timeout,
    onProgress,
    mapSuccess: (msg) => ({
      response: msg.response || msg.text || "",
      model: msg.model,
      tookMs: msg.tookMs || msg.durationMs || 0,
      imagePath: msg.imagePath || null,
      partial: !!msg.partial,
      backend: msg.backend || "cloak",
      conversationId: msg.conversationId || conversationId || null,
      ...(msg.thinkingTrace ? { thinkingTrace: msg.thinkingTrace } : {}),
    }),
  });
}

async function manageChatsWithCloakBrowser(opts, onProgress = () => {}) {
  const timeout = resolveChatsTimeoutSeconds(opts.timeout);
  const runChatsRequest = () => runCloakWorker({
    workerPath: CHATS_WORKER_PATH,
    request: {
      type: "chats",
      action: opts.action,
      conversationId: opts.conversationId,
      conversationIds: opts.conversationIds,
      query: opts.query,
      limit: opts.limit,
      all: opts.all,
      profile: opts.profile,
      timeout,
      title: opts.title,
      fileId: opts.fileId,
      includeBytes: opts.includeBytes,
      outputPath: opts.outputPath,
      waitForAssistant: opts.waitForAssistant,
      waitForAssistantTimeoutSec: opts.waitForAssistantTimeoutSec,
      baselineAssistantMessageId: opts.baselineAssistantMessageId,
    },
    timeout,
    onProgress,
    mapSuccess: (msg) => {
      const out = { ...msg };
      delete out.type;
      return out;
    },
  });

  return await runChatsRequest();
}

function __setBridgeRuntimeForTests(overrides = {}) {
  runtime = { ...runtime, ...overrides };
}

function __resetBridgeRuntimeForTests() {
  runtime = { ...DEFAULT_RUNTIME };
}

module.exports = {
  isCloakBrowserAvailable,
  queryWithCloakBrowser,
  manageChatsWithCloakBrowser,
  __setBridgeRuntimeForTests,
  __resetBridgeRuntimeForTests,
};
