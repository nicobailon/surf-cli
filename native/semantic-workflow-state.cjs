const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  atomicWriteJson,
  ensurePrivateDir,
  readPrivateJson,
  removePrivateFile,
  writePrivateFileExclusive,
} = require("./private-state.cjs");

const VERSION = 1;
const TERMINAL_ATTEMPT_STATES = new Set([
  "not_dispatched",
  "outcome_unknown",
  "acknowledged_unverified",
  "verified",
]);
const TERMINAL_RUN_STATES = new Set(["completed", "failed", "cancelled", "outcome_unknown"]);
const TRANSITIONS = Object.freeze({
  reserved: new Set(["not_dispatched", "dispatch_intent"]),
  dispatch_intent: new Set(["outcome_unknown", "acknowledged_unverified", "verified"]),
});

function boundedString(value, name, max = 256) {
  if (typeof value !== "string" || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${name} must be a bounded non-control string`);
  }
  return value;
}

function safeId(value, name) {
  const result = boundedString(value, name, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) throw new Error(`${name} contains unsupported characters`);
  return result;
}

function timestamp(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("clock returned an invalid time");
  return date.toISOString();
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function fingerprintOptional(value) {
  return value === undefined || value === null || value === "" ? undefined : fingerprint(value);
}

function sanitizeBudgets(budgets = {}) {
  if (budgets === null || typeof budgets !== "object" || Array.isArray(budgets)) {
    throw new Error("budgets must be an object");
  }
  const entries = Object.entries(budgets);
  if (entries.length > 16) throw new Error("too many budget counters");
  return Object.fromEntries(entries.map(([name, value]) => {
    if (!/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(name)) throw new Error(`invalid budget name: ${name}`);
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`budget ${name} must be a non-negative finite number`);
    }
    return [name, value];
  }));
}

function sanitizeTarget(target = {}) {
  if (target === null || typeof target !== "object" || Array.isArray(target)) {
    throw new Error("target provenance must be an object");
  }
  const entries = Object.entries(target);
  if (entries.length > 12) throw new Error("target provenance has too many fields");
  return Object.fromEntries(entries.map(([name, value]) => {
    if (!/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(name)) throw new Error(`invalid target provenance field: ${name}`);
    if (!["string", "number", "boolean"].includes(typeof value)) {
      throw new Error(`target provenance ${name} must be scalar`);
    }
    return [name, fingerprint(boundedString(String(value), `target provenance ${name}`, 1024))];
  }));
}

function createSemanticWorkflowStateStore(options = {}) {
  const root = path.resolve(boundedString(options.root, "root", 4096));
  const clock = options.clock || Date.now;
  if (typeof clock !== "function") throw new Error("clock must be a function");
  const runId = safeId(options.runId, "runId");
  const workflowDigest = boundedString(options.workflowDigest, "workflowDigest", 256);
  const runKey = fingerprint(`${runId}\0${workflowDigest}`);
  const directory = path.join(root, "semantic-workflows", runKey);
  const ownerPath = path.join(directory, "owner.json");
  const runPath = path.join(directory, "run.json");
  const checkpointPath = path.join(directory, "checkpoint.json");
  const attemptsDirectory = path.join(directory, "attempts");
  const ownerId = crypto.randomUUID();
  let owned = false;
  let released = false;

  function requireOwner() {
    if (!owned || released) throw new Error("semantic workflow run is not owned by this store");
    const owner = readPrivateJson(ownerPath, null, { root });
    if (!owner || owner.ownerId !== ownerId) throw new Error("semantic workflow run ownership was lost");
  }

  function attemptPath(attemptId) {
    return path.join(attemptsDirectory, `${safeId(attemptId, "attemptId")}.json`);
  }

  function loadAttempt(attemptId) {
    const attempt = readPrivateJson(attemptPath(attemptId), null, { root });
    if (!attempt) throw new Error(`write attempt is missing: ${attemptId}`);
    return attempt;
  }

  function persistAttempt(attempt) {
    atomicWriteJson(attemptPath(attempt.attemptId), attempt, { root });
    return attempt;
  }

  function acquire() {
    if (owned && !released) throw new Error("semantic workflow run is already owned by this store");
    if (released) throw new Error("released semantic workflow store cannot be reacquired");
    ensurePrivateDir(attemptsDirectory, root);
    const createdAt = timestamp(clock);
    const owner = { version: VERSION, ownerId, runId, workflowDigest, createdAt };
    try {
      writePrivateFileExclusive(ownerPath, `${JSON.stringify(owner, null, 2)}\n`, { root, encoding: "utf8" });
    } catch (error) {
      if (error?.code === "EEXIST") throw new Error(`semantic workflow run is already owned: ${runId}`);
      throw error;
    }
    try {
      const existingRun = readPrivateJson(runPath, null, { root });
      if (existingRun) throw new Error(`semantic workflow run already exists in state ${existingRun.state}`);
      atomicWriteJson(runPath, { version: VERSION, runId, workflowDigest, state: "running", createdAt, updatedAt: createdAt }, { root });
    } catch (error) {
      try { removePrivateFile(ownerPath, { root }); } catch {}
      throw error;
    }
    owned = true;
    return { runId, workflowDigest, ownerId };
  }

  function reserve({ attemptId = crypto.randomUUID(), stepId, operation, target = {}, budgets = {} } = {}) {
    requireOwner();
    const id = safeId(attemptId, "attemptId");
    const now = timestamp(clock);
    const attempt = {
      version: VERSION,
      runId,
      workflowDigest,
      attemptId: id,
      stepId: safeId(stepId, "stepId"),
      operation: safeId(operation, "operation"),
      target: sanitizeTarget(target),
      budgets: sanitizeBudgets(budgets),
      state: "reserved",
      createdAt: now,
      updatedAt: now,
    };
    writePrivateFileExclusive(attemptPath(id), `${JSON.stringify(attempt, null, 2)}\n`, { root, encoding: "utf8" });
    return attempt;
  }

  function transition(attemptId, nextState, details = {}) {
    requireOwner();
    const current = loadAttempt(attemptId);
    if (!TRANSITIONS[current.state]?.has(nextState)) {
      throw new Error(`invalid write attempt transition: ${current.state} -> ${nextState}`);
    }
    const updated = {
      ...current,
      state: nextState,
      updatedAt: timestamp(clock),
      budgets: sanitizeBudgets(details.budgets ?? current.budgets),
    };
    const reasonFingerprint = fingerprintOptional(details.reason);
    const errorFingerprint = fingerprintOptional(details.error);
    if (reasonFingerprint) updated.reasonFingerprint = reasonFingerprint;
    if (errorFingerprint) updated.errorFingerprint = errorFingerprint;
    return persistAttempt(updated);
  }

  function dispatchIntent(attemptId, details = {}) {
    return transition(attemptId, "dispatch_intent", details);
  }

  function terminal(attemptId, state, details = {}) {
    if (!TERMINAL_ATTEMPT_STATES.has(state)) throw new Error(`invalid terminal write attempt state: ${state}`);
    return transition(attemptId, state, details);
  }

  function checkpoint({ completedSteps = [], reason, error, budgets = {} } = {}) {
    requireOwner();
    if (!Array.isArray(completedSteps) || completedSteps.length > 32) {
      throw new Error("completedSteps must be an array of at most 32 step IDs");
    }
    const value = {
      version: VERSION,
      runId,
      workflowDigest,
      completedSteps: completedSteps.map((stepId) => safeId(stepId, "completed step ID")),
      budgets: sanitizeBudgets(budgets),
      updatedAt: timestamp(clock),
    };
    const reasonFingerprint = fingerprintOptional(reason);
    const errorFingerprint = fingerprintOptional(error);
    if (reasonFingerprint) value.reasonFingerprint = reasonFingerprint;
    if (errorFingerprint) value.errorFingerprint = errorFingerprint;
    atomicWriteJson(checkpointPath, value, { root });
    return value;
  }

  function read() {
    const run = readPrivateJson(runPath, null, { root });
    const savedCheckpoint = readPrivateJson(checkpointPath, null, { root });
    let attempts = [];
    try {
      attempts = fs.readdirSync(attemptsDirectory)
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map((name) => readPrivateJson(path.join(attemptsDirectory, name), null, { root }))
        .filter(Boolean)
        .map((attempt) => attempt.state === "dispatch_intent"
          ? { ...attempt, effectiveState: "outcome_unknown" }
          : { ...attempt, effectiveState: attempt.state });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    return { run, checkpoint: savedCheckpoint, attempts };
  }

  function release({ state, reason, error, budgets = {} } = {}) {
    requireOwner();
    if (!TERMINAL_RUN_STATES.has(state)) throw new Error(`invalid terminal run state: ${state}`);
    const snapshot = read();
    const nonterminal = snapshot.attempts.find((attempt) => !TERMINAL_ATTEMPT_STATES.has(attempt.state));
    if (nonterminal) throw new Error(`cannot release run with nonterminal attempt: ${nonterminal.attemptId}`);
    const current = snapshot.run;
    if (!current || current.state !== "running") throw new Error("semantic workflow run record is not running");
    const updated = {
      ...current,
      state,
      budgets: sanitizeBudgets(budgets),
      updatedAt: timestamp(clock),
    };
    const reasonFingerprint = fingerprintOptional(reason);
    const errorFingerprint = fingerprintOptional(error);
    if (reasonFingerprint) updated.reasonFingerprint = reasonFingerprint;
    if (errorFingerprint) updated.errorFingerprint = errorFingerprint;
    atomicWriteJson(runPath, updated, { root });
    removePrivateFile(ownerPath, { root });
    released = true;
    return updated;
  }

  return {
    acquire,
    reserve,
    dispatchIntent,
    terminal,
    checkpoint,
    read,
    inspect: read,
    release,
  };
}

module.exports = {
  createSemanticWorkflowStateStore,
};
