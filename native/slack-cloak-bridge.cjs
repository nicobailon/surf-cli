/**
 * Slack CloakBrowser Bridge
 *
 * Node.js module that spawns the Slack CloakBrowser worker (.mjs) and
 * communicates via stdin/stdout JSON-lines protocol.
 */

const { spawn } = require("child_process");
const { existsSync } = require("fs");
const { join, dirname } = require("path");

const DEFAULT_SLACK_TIMEOUT_SEC = 120;
const SLACK_WORKER_PATH = join(__dirname, "slack-cloak-worker.mjs");

const DEFAULT_RUNTIME = { spawn, existsSync };
let runtime = { ...DEFAULT_RUNTIME };

// ---------------------------------------------------------------------------
// Availability check
// ---------------------------------------------------------------------------

function isSlackCloakAvailable() {
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

function ensureAvailability() {
  if (!isSlackCloakAvailable()) {
    throw Object.assign(
      new Error("CloakBrowser not installed. Run: npm install cloakbrowser playwright-core"),
      { code: "cloakbrowser_not_installed" }
    );
  }
  if (!runtime.existsSync(SLACK_WORKER_PATH)) {
    throw Object.assign(
      new Error("Slack worker not found: " + SLACK_WORKER_PATH),
      { code: "worker_not_found" }
    );
  }
}

// ---------------------------------------------------------------------------
// Worker runner — same protocol as chatgpt-cloak-bridge.cjs
// ---------------------------------------------------------------------------

function runSlackWorker({ request, timeout = DEFAULT_SLACK_TIMEOUT_SEC, onProgress = () => {} }) {
  ensureAvailability();

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const settle = (fn, value) => {
      if (!settled) { settled = true; clearTimer(); fn(value); }
    };

    const worker = runtime.spawn(process.execPath, [SLACK_WORKER_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    const timeoutMs = timeout * 1000;
    const armTimer = () => {
      clearTimer();
      timer = setTimeout(() => {
        worker.kill("SIGTERM");
        settle(reject, Object.assign(new Error(`Slack worker killed after ${timeoutMs}ms`), { code: "timeout" }));
      }, timeoutMs);
    };
    armTimer();

    const handleMessage = (msg) => {
      if (["progress", "success", "error", "keepalive"].includes(msg.type)) armTimer();

      switch (msg.type) {
        case "progress":
          onProgress(msg);
          return false;
        case "success": {
          const out = { ...msg };
          delete out.type;
          delete out.t;
          settle(resolve, out);
          return true;
        }
        case "error":
          settle(reject, Object.assign(new Error(msg.message), { code: msg.code, details: msg.details }));
          return true;
        case "keepalive":
          return false;
        case "log":
          if (process.env.SURF_DEBUG) {
            process.stderr.write(`[slack:${msg.level}] ${msg.message}\n`);
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
          handleMessage(JSON.parse(line));
        } catch {}
      }
    });

    worker.stderr.setEncoding("utf8");
    worker.stderr.on("data", (chunk) => {
      if (process.env.SURF_DEBUG) {
        process.stderr.write(chunk);
      } else if (chunk.includes("[cloakbrowser]")) {
        process.stderr.write(chunk);
      }
    });

    worker.on("close", (code, signal) => {
      clearTimer();
      if (settled) return;
      if (stdoutBuf.trim()) {
        try {
          const handled = handleMessage(JSON.parse(stdoutBuf));
          stdoutBuf = "";
          if (handled || settled) return;
        } catch {}
      }
      if (signal) {
        settle(reject, Object.assign(new Error(`Slack worker killed by ${signal}`), { code: "worker_killed", signal }));
      } else {
        settle(reject, Object.assign(new Error(`Slack worker exited ${code} without result`), { code: "worker_exit", exitCode: code }));
      }
    });

    worker.stdin.write(JSON.stringify(request) + "\n");
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function querySlackMessages(opts, onProgress = () => {}) {
  const timeout = opts.timeout || DEFAULT_SLACK_TIMEOUT_SEC;
  return runSlackWorker({
    request: {
      type: "slack",
      action: opts.action,
      channel: opts.channel,
      threadTs: opts.threadTs,
      limit: opts.limit,
      days: opts.days,
      profile: opts.profile,
      workspace: opts.workspace,
      includeDms: opts.includeDms,
      timeout,
    },
    timeout,
    onProgress,
  });
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function __setSlackRuntimeForTests(overrides = {}) {
  runtime = { ...runtime, ...overrides };
}

function __resetSlackRuntimeForTests() {
  runtime = { ...DEFAULT_RUNTIME };
}

module.exports = {
  isSlackCloakAvailable,
  querySlackMessages,
  __setSlackRuntimeForTests,
  __resetSlackRuntimeForTests,
};
