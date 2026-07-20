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

function reserveReceipt({ playbookId, op, args, repeat = false, retryAttempt, overrideInDoubt = false, attemptId = crypto.randomUUID(), now = Date.now(), root = getPrivateStateRoot() }) {
  if (op.effect !== "write") return null;
  const base = receiptRoot(root);
  ensurePrivateDir(base, root);
  const claimKey = semanticClaimKey({ playbookId, op, args, root });
  const claimDir = path.join(base, claimKey);
  let created = false;
  try {
    fs.mkdirSync(claimDir, { mode: 0o700 });
    created = true;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  if (!created) {
    const existing = attemptFiles(claimDir);
    const latest = existing.at(-1);
    if (!latest) {
      throw new Error("write blocked by an unresolved semantic claim created before an attempt receipt was durable");
    }
    if (retryAttempt) {
      const retry = existing.find((attempt) => attempt.attemptId === retryAttempt);
      if (!retry) throw new Error(`receipt attempt not found: ${retryAttempt}`);
      if (retry.status === "verified") throw new Error(`receipt attempt is already verified: ${retryAttempt}`);
      if (retry.status !== "reserved" && retry.status !== "not_dispatched" && !op.safety.serverIdempotency) {
        throw new Error("--retry-attempt after dispatch requires declared server idempotency");
      }
      return { claimKey, claimDir, attemptId: retryAttempt, path: path.join(claimDir, `${retryAttempt}.json`), receipt: retry };
    }
    if (latest) {
      const ageMs = Math.max(0, now - Date.parse(latest.updatedAt || latest.createdAt));
      const windowMs = op.safety.windowMs ?? 30000;
      const windowElapsed = op.safety.duplicate === "repeatable-window" && latest.status === "verified" && ageMs >= windowMs;
      const deliberateOverride = overrideInDoubt && latest.status === "indeterminate";
      const deliberateRepeat = repeat && latest.status === "verified";
      if (!windowElapsed && !deliberateOverride && !deliberateRepeat) {
        throw new Error(`write blocked by ${latest.status} receipt ${latest.attemptId}; use the policy-specific retry or override flag`);
      }
    }
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

module.exports = { receiptRoot, reserveReceipt, semanticClaimKey, updateReceipt };
