const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  atomicWriteJson,
  ensurePrivateDir,
  getPrivateStateRoot,
  readPrivateFile,
  readPrivateJson,
  writePrivateFileExclusive,
} = require("./private-state.cjs");

// Attempt ids are the UUIDs surf generates. Any other value (a path, `..`) is refused before a file
// name is built from it.
const ATTEMPT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function assertAttemptId(value, label = "attempt id") {
  if (typeof value !== "string" || !ATTEMPT_ID.test(value)) {
    throw new Error(`${label} must be a write attempt id, a UUID such as 6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b`);
  }
  return value;
}

function receiptRoot(root = getPrivateStateRoot()) {
  return path.join(root, "playbook-receipts");
}

function loadSalt(root) {
  const directory = receiptRoot(root);
  ensurePrivateDir(directory, root);
  const saltPath = path.join(directory, ".salt");
  const existing = readPrivateFile(saltPath, { root, allowMissing: true, fallback: null, encoding: "utf8" });
  if (existing) return Buffer.from(existing.trim(), "hex");
  const salt = crypto.randomBytes(32);
  try {
    writePrivateFileExclusive(saltPath, `${salt.toString("hex")}\n`, { root, encoding: "utf8" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  return Buffer.from(readPrivateFile(saltPath, { root, encoding: "utf8" }).trim(), "hex");
}

function semanticClaimKey({ playbookId, op, args, root = getPrivateStateRoot() }) {
  const semantic = {};
  for (const name of op.safety.key) {
    if (args[name] === undefined) throw new Error(`semantic safety argument is missing: ${name}`);
    semantic[name] = args[name];
  }
  const message = JSON.stringify({ playbook: playbookId, op: op.id, semantic });
  return crypto.createHmac("sha256", loadSalt(root)).update(message).digest("hex");
}

function attemptFiles(claimDir) {
  if (!fs.existsSync(claimDir)) return [];
  return fs.readdirSync(claimDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readPrivateJson(path.join(claimDir, name), null, { root: path.dirname(claimDir) }))
    .filter(Boolean)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

// 14:02 today, else 2026-11-16 14:02, in local time.
function clock(time, now) {
  const at = new Date(time);
  if (Number.isNaN(at.getTime())) return "an unknown time";
  const pad = (n) => String(n).padStart(2, "0");
  const day = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const hour = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  return day(at) === day(new Date(now)) ? hour : `${day(at)} ${hour}`;
}

const CHECK_SITE = "Check the site, then add --repeat to send again.";

function blockedBy(attempt, now) {
  const at = clock(attempt.createdAt, now);
  const said = {
    verified: `was sent at ${at} and succeeded. Add --repeat to send it again.`,
    indeterminate: `was sent at ${at} and its result is unknown. ${CHECK_SITE}`,
    dispatched: `was sent at ${at} and surf stopped before its answer came. ${CHECK_SITE}`,
    reserved: `began at ${at} and surf stopped before it knew whether it was sent. ${CHECK_SITE}`,
    not_dispatched: `failed at ${at} before it was sent. Add --repeat to send again, or --retry-attempt ${attempt.attemptId} to reuse the attempt.`,
  }[attempt.status] ?? `is ${attempt.status}, from ${at}. ${CHECK_SITE}`;
  return new Error(`write blocked: attempt ${attempt.attemptId} ${said}`);
}

// Throws when an earlier attempt on the claim blocks this one; returns the attempt retried with
// --retry-attempt, if any. --repeat gets past any attempt, or a claim a stopped run left without one.
function checkAttempts({ claimDir, op, repeat, retryAttempt, now }) {
  const existing = attemptFiles(claimDir);
  const latest = existing.at(-1);
  if (!latest) {
    if (repeat && retryAttempt === undefined) return null;
    const at = clock(fs.statSync(claimDir).mtimeMs, now);
    throw new Error(`write blocked: a run at ${at} claimed these inputs and stopped before it saved an attempt, so it may have been sent. ${CHECK_SITE}`);
  }
  if (retryAttempt) {
    const retry = existing.find((attempt) => attempt.attemptId === retryAttempt);
    if (!retry) throw new Error(`receipt attempt not found: ${retryAttempt}`);
    if (retry.status === "verified") throw new Error(`receipt attempt is already verified: ${retryAttempt}`);
    if (retry.status !== "reserved" && retry.status !== "not_dispatched" && !op.safety.serverIdempotency) {
      throw new Error("--retry-attempt after dispatch requires declared server idempotency");
    }
    return retry;
  }
  const ageMs = Math.max(0, now - Date.parse(latest.updatedAt || latest.createdAt));
  const windowMs = op.safety.windowMs ?? 30000;
  const windowElapsed = op.safety.duplicate === "repeatable-window" && latest.status === "verified" && ageMs >= windowMs;
  if (!windowElapsed && !repeat) throw blockedBy(latest, now);
  return null;
}

// Refuses a write that reserveReceipt would refuse, and writes no receipt. surf use checks before a
// run and reserves only once the request is dispatched, so a run refused before sending leaves none.
function checkReceipt({ playbookId, op, args, repeat = false, retryAttempt, now = Date.now(), root = getPrivateStateRoot() }) {
  if (op.effect !== "write") return;
  if (retryAttempt !== undefined) assertAttemptId(retryAttempt, "--retry-attempt");
  const claimDir = path.join(receiptRoot(root), semanticClaimKey({ playbookId, op, args, root }));
  if (fs.existsSync(claimDir)) checkAttempts({ claimDir, op, repeat, retryAttempt, now });
  else if (retryAttempt !== undefined) throw new Error(`receipt attempt not found: ${retryAttempt}`);
}

function reserveReceipt({ playbookId, op, args, repeat = false, retryAttempt, attemptId = crypto.randomUUID(), now = Date.now(), root = getPrivateStateRoot() }) {
  if (op.effect !== "write") return null;
  assertAttemptId(attemptId);
  if (retryAttempt !== undefined) assertAttemptId(retryAttempt, "--retry-attempt");
  const base = receiptRoot(root);
  ensurePrivateDir(base, root);
  const claimKey = semanticClaimKey({ playbookId, op, args, root });
  const claimDir = path.join(base, claimKey);
  // --retry-attempt names an attempt the claim already holds; a fresh claim has none.
  if (retryAttempt !== undefined && !fs.existsSync(claimDir)) throw new Error(`receipt attempt not found: ${retryAttempt}`);
  let created = false;
  try {
    fs.mkdirSync(claimDir, { mode: 0o700 });
    created = true;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  if (!created) {
    const retry = checkAttempts({ claimDir, op, repeat, retryAttempt, now });
    if (retry) return { claimKey, claimDir, attemptId: retryAttempt, path: path.join(claimDir, `${retryAttempt}.json`), receipt: retry };
  }
  const createdAt = new Date(now).toISOString();
  const receipt = { version: 1, playbook: playbookId, op: op.id, claimKey, attemptId, status: "reserved", duplicate: op.safety.duplicate, createdAt, updatedAt: createdAt };
  const receiptPath = path.join(claimDir, `${attemptId}.json`);
  atomicWriteJson(path.join(claimDir, "claim"), { version: 1, playbook: playbookId, op: op.id, claimKey }, { root });
  atomicWriteJson(receiptPath, receipt, { root });
  return { claimKey, claimDir, attemptId, path: receiptPath, receipt };
}

function updateReceipt(handle, status, details = {}, root = getPrivateStateRoot()) {
  if (!handle) return null;
  if (!["reserved", "not_dispatched", "dispatched", "indeterminate", "verified"].includes(status)) throw new Error(`invalid receipt status: ${status}`);
  const current = readPrivateJson(handle.path, null, { root });
  if (!current) throw new Error(`receipt is missing: ${handle.attemptId}`);
  const receipt = { ...current, status, updatedAt: new Date().toISOString(), ...(details.error ? { errorCode: crypto.createHash("sha256").update(String(details.error)).digest("hex").slice(0, 16) } : {}) };
  atomicWriteJson(handle.path, receipt, { root });
  handle.receipt = receipt;
  return receipt;
}

module.exports = { assertAttemptId, checkReceipt, receiptRoot, reserveReceipt, semanticClaimKey, updateReceipt };
