const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_STALE_MS = 30000;
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MIN_WAIT_MS = 50;
const DEFAULT_MAX_WAIT_MS = 1000;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function getBrowserLockDir(socketPath, tempDir) {
  const hash = crypto.createHash("sha256").update(socketPath).digest("hex").slice(0, 16);
  return path.join(tempDir, `surf-lock-${hash}`);
}

function createToken() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

function readLockOwner(lockDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(lockDir, "owner.json"), "utf8"));
  } catch (error) {
    if (error && (error.code === "ENOENT" || error instanceof SyntaxError)) return null;
    throw error;
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && error.code === "EPERM");
  }
}

function writeLockOwner(lockDir, socketPath, token) {
  fs.writeFileSync(
    path.join(lockDir, "owner.json"),
    JSON.stringify({ pid: process.pid, token, socketPath, createdAt: new Date().toISOString() }),
  );
}

function removeLockDir(lockDir) {
  fs.rmSync(lockDir, { recursive: true, force: true });
}

function getLockTimestamp(lockDir, owner) {
  const target = owner ? path.join(lockDir, "owner.json") : lockDir;
  try {
    return fs.statSync(target).mtimeMs;
  } catch (error) {
    if (error && error.code === "ENOENT") return 0;
    throw error;
  }
}

function ownerMatches(left, right) {
  if (!left && !right) return true;
  return Boolean(left && right && left.token && left.token === right.token);
}

function tryCreateStaleClaim(lockDir, staleMs, now = Date.now()) {
  const claimDir = path.join(lockDir, "stale-claim");
  try {
    fs.mkdirSync(claimDir);
    return claimDir;
  } catch (error) {
    if (!error || error.code !== "EEXIST") throw error;
    try {
      if (now - fs.statSync(claimDir).mtimeMs > staleMs) {
        fs.rmSync(claimDir, { recursive: true, force: true });
      }
    } catch (claimError) {
      if (!claimError || claimError.code !== "ENOENT") throw claimError;
    }
    return null;
  }
}

function claimAndRemoveStaleLock(lockDir, staleMs, now = Date.now()) {
  let lockStats;
  try {
    lockStats = fs.statSync(lockDir);
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }

  const inspectedOwner = readLockOwner(lockDir);
  if (inspectedOwner && isProcessAlive(inspectedOwner.pid)) return false;
  if (now - getLockTimestamp(lockDir, inspectedOwner) <= staleMs) return false;

  const claimDir = tryCreateStaleClaim(lockDir, staleMs, now);
  if (!claimDir) return false;

  try {
    const currentOwner = readLockOwner(lockDir);
    if (!ownerMatches(inspectedOwner, currentOwner)) return false;
    if (currentOwner && isProcessAlive(currentOwner.pid)) return false;
    if (!currentOwner && Date.now() - lockStats.mtimeMs <= staleMs) return false;

    removeLockDir(lockDir);
    return true;
  } finally {
    try {
      fs.rmSync(claimDir, { recursive: true, force: true });
    } catch {}
  }
}

function acquireBrowserLock(socketPath, tempDir, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const sleep = options.sleep ?? sleepSync;
  const lockDir = getBrowserLockDir(socketPath, tempDir);
  const startedAt = Date.now();
  let waitMs = options.minWaitMs ?? DEFAULT_MIN_WAIT_MS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;

  while (true) {
    const token = createToken();
    try {
      fs.mkdirSync(lockDir, { recursive: false, mode: 0o700 });
      try {
        writeLockOwner(lockDir, socketPath, token);
      } catch (error) {
        removeLockDir(lockDir);
        throw error;
      }
      let released = false;
      return {
        lockDir,
        release() {
          if (released) return;
          released = true;
          const owner = readLockOwner(lockDir);
          if (owner && owner.token === token) removeLockDir(lockDir);
        },
      };
    } catch (error) {
      if (!error || error.code !== "EEXIST") throw error;
    }

    if (claimAndRemoveStaleLock(lockDir, staleMs)) continue;

    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(
        `Timed out waiting for browser lock after ${Math.round(timeoutMs / 1000)}s. Use --no-lock to bypass.`,
      );
    }

    sleep(waitMs);
    waitMs = Math.min(Math.round(waitMs * 1.5), maxWaitMs);
  }
}

module.exports = {
  DEFAULT_STALE_MS,
  DEFAULT_TIMEOUT_MS,
  acquireBrowserLock,
  getBrowserLockDir,
};
