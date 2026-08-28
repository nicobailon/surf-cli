const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  assertNotSymlink,
  atomicWriteFile,
  atomicWriteJson,
  ensurePrivateDir,
  getPrivateStateRoot,
  readPrivateFile,
  readPrivateJson,
} = require("./private-state.cjs");

const JOB_ID_PATTERN = /^\d{8}-\d{6}-[0-9a-f]{4}$/;
const TERMINAL_STATES = new Set(["captured", "failed"]);
const TRANSITIONS = {
  created: new Set(["dispatched", "failed"]),
  dispatched: new Set(["awaiting", "failed"]),
  awaiting: new Set(["captured", "failed"]),
};

function oracleRoot(root = getPrivateStateRoot()) {
  return path.join(root, "oracle");
}

function jobDirectory(id, root = getPrivateStateRoot()) {
  if (!JOB_ID_PATTERN.test(id)) throw codedError("not_found", `oracle job not found: ${id}`);
  return path.join(oracleRoot(root), id);
}

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function promptDigest(prompt) {
  return `sha256:${crypto.createHash("sha256").update(prompt).digest("hex")}`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function requestFingerprint({ prompt, contextManifest, model, effortRequested, follow, attachmentPaths, github }) {
  return promptDigest(stableJson({
    promptDigest: promptDigest(prompt),
    contextManifest: contextManifest ?? {},
    model: model ?? null,
    effortRequested: effortRequested ?? null,
    follow: follow ?? null,
    attachmentPaths: attachmentPaths ?? [],
    github: github === true,
  }));
}

function normalizedRequestId(requestId) {
  if (requestId === null || requestId === undefined) return null;
  if (typeof requestId !== "string" || !requestId.trim() || requestId.trim() !== requestId || requestId.length > 256 || requestId.includes("\0")) {
    throw codedError("invalid_request", "oracle requestId must be a non-empty trimmed string");
  }
  return requestId;
}

function hydrateJobMetadata(job, root = getPrivateStateRoot()) {
  const prompt = job.promptDigest ? null : readPrivateFile(path.join(jobDirectory(job.id, root), "request.md"), {
    root,
    encoding: "utf8",
  });
  const legacyModel = job.modelRequested === undefined && job.modelVerified === undefined;
  return {
    ...job,
    modelRequested: job.modelRequested ?? (legacyModel && job.state === "created" ? job.model ?? null : null),
    modelVerified: job.modelVerified ?? (legacyModel && job.state !== "created" ? job.model ?? null : null),
    promptDigest: job.promptDigest ?? promptDigest(prompt),
  };
}

function readJobs(root = getPrivateStateRoot()) {
  const base = oracleRoot(root);
  if (!fs.existsSync(base)) return [];
  const stat = assertNotSymlink(base, false);
  if (!stat.isDirectory()) throw new Error(`oracle state path is not a directory: ${base}`);
  return fs.readdirSync(base)
    .filter((id) => JOB_ID_PATTERN.test(id))
    .sort((a, b) => b.localeCompare(a))
    .map((id) => readPrivateJson(path.join(base, id, "job.json"), null, { root }))
    .filter(Boolean)
    .map((job) => hydrateJobMetadata(job, root));
}

function createJob({ prompt, contextManifest = {}, model = null, effortRequested = null, follow = null, requestId = null, attachmentPaths = [], github = false }) {
  const root = getPrivateStateRoot();
  const base = oracleRoot(root);
  ensurePrivateDir(base, root);
  const safeRequestId = normalizedRequestId(requestId);
  const fingerprint = safeRequestId
    ? requestFingerprint({ prompt, contextManifest, model, effortRequested, follow, attachmentPaths, github })
    : null;
  if (safeRequestId) {
    const existing = readJobs(root).find((job) => job.requestId === safeRequestId);
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        throw codedError(
          "idempotency_conflict",
          `oracle requestId ${safeRequestId} was already used for a different request`,
          { jobId: existing.id },
        );
      }
      return { ...existing, requestDeduped: true };
    }
  }
  const inFlight = readJobs(root).find((job) => !TERMINAL_STATES.has(job.state));
  if (inFlight) {
    throw codedError(
      "capacity",
      `oracle job capacity reached; in-flight job: ${inFlight.id}`,
      { jobId: inFlight.id },
    );
  }

  const now = new Date();
  const compactTimestamp = now.toISOString().replace(/\D/g, "").slice(0, 14);
  const timestamp = `${compactTimestamp.slice(0, 8)}-${compactTimestamp.slice(8)}`;
  let id;
  let directory;
  for (;;) {
    id = `${timestamp}-${crypto.randomBytes(2).toString("hex")}`;
    directory = path.join(base, id);
    try {
      fs.mkdirSync(directory, { mode: 0o700 });
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }

  try {
    ensurePrivateDir(path.join(directory, "turns"), root);
    atomicWriteFile(path.join(directory, "request.md"), prompt, { root, encoding: "utf8" });
    atomicWriteJson(path.join(directory, "context-manifest.json"), contextManifest, { root });
    const job = {
      id,
      state: "created",
      model,
      modelRequested: model,
      modelVerified: null,
      effortRequested,
      effortVerified: null,
      promptDigest: promptDigest(prompt),
      ...(safeRequestId ? { requestId: safeRequestId, requestFingerprint: fingerprint } : {}),
      createdAt: now.toISOString(),
      dispatchedAt: null,
      awaitingAt: null,
      capturedAt: null,
      failedAt: null,
      tabId: null,
      conversationUrl: null,
      promptEcho: null,
      error: null,
      turns: [],
      ...(follow ? { follow } : {}),
    };
    atomicWriteJson(path.join(directory, "job.json"), job, { root });
    return job;
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function getJob(id) {
  const root = getPrivateStateRoot();
  const job = readPrivateJson(path.join(jobDirectory(id, root), "job.json"), null, { root });
  if (!job) throw codedError("not_found", `oracle job not found: ${id}`);
  return hydrateJobMetadata(job, root);
}

function getResponse(id) {
  const root = getPrivateStateRoot();
  getJob(id);
  return readPrivateFile(path.join(jobDirectory(id, root), "response.md"), {
    root,
    encoding: "utf8",
  });
}

function transition(id, state, updates) {
  const job = getJob(id);
  if (!TRANSITIONS[job.state]?.has(state)) {
    throw codedError(
      "invalid_transition",
      `oracle job ${id} cannot transition from ${job.state} to ${state}`,
    );
  }
  const updated = { ...job, state, ...updates };
  const root = getPrivateStateRoot();
  atomicWriteJson(path.join(jobDirectory(id, root), "job.json"), updated, { root });
  return updated;
}

function markDispatched(id, { tabId, promptEcho, modelVerified, effortVerified }) {
  return transition(id, "dispatched", {
    dispatchedAt: new Date().toISOString(),
    tabId,
    ...(promptEcho ? { promptEcho } : {}),
    ...(modelVerified ? { model: modelVerified, modelVerified } : {}),
    ...(effortVerified ? { effortVerified } : {}),
  });
}

function markAwaiting(id, { conversationUrl, promptEcho }) {
  return transition(id, "awaiting", {
    awaitingAt: new Date().toISOString(),
    conversationUrl,
    promptEcho,
  });
}

function markCaptured(id, { response }) {
  const job = getJob(id);
  if (!TRANSITIONS[job.state]?.has("captured")) {
    throw codedError(
      "invalid_transition",
      `oracle job ${id} cannot transition from ${job.state} to captured`,
    );
  }
  const root = getPrivateStateRoot();
  atomicWriteFile(path.join(jobDirectory(id, root), "response.md"), response, {
    root,
    encoding: "utf8",
  });
  return transition(id, "captured", { capturedAt: new Date().toISOString() });
}

function markFailed(id, { code, message }) {
  return transition(id, "failed", {
    failedAt: new Date().toISOString(),
    error: { code, message },
  });
}

function updateTabId(id, tabId) {
  const job = getJob(id);
  if (TERMINAL_STATES.has(job.state)) {
    throw codedError(
      "invalid_transition",
      `oracle job ${id} cannot transition from ${job.state} to update tab`,
    );
  }
  const updated = { ...job, tabId };
  const root = getPrivateStateRoot();
  atomicWriteJson(path.join(jobDirectory(id, root), "job.json"), updated, { root });
  return updated;
}

function appendTurn(id, turn) {
  const job = getJob(id);
  const duplicate = job.turns.find((existing) => (turn.childJobId && existing.childJobId === turn.childJobId) || (turn.requestId && existing.requestId === turn.requestId));
  if (duplicate) return job;
  const storedTurn = {
    prompt: turn.prompt,
    dispatchedAt: turn.dispatchedAt ?? null,
    capturedAt: turn.capturedAt ?? null,
    ...(turn.childJobId ? { childJobId: turn.childJobId } : {}),
    ...(turn.requestId ? { requestId: turn.requestId } : {}),
  };
  const root = getPrivateStateRoot();
  const directory = jobDirectory(id, root);
  const turnName = `${String(job.turns.length + 1).padStart(4, "0")}.json`;
  atomicWriteJson(path.join(directory, "turns", turnName), storedTurn, { root });
  const updated = { ...job, turns: [...job.turns, storedTurn] };
  atomicWriteJson(path.join(directory, "job.json"), updated, { root });
  return updated;
}

function markTurnCaptured(id, { dispatchedAt, capturedAt, childJobId, requestId }) {
  const job = getJob(id);
  const turnIndex = job.turns.findIndex((turn) => (childJobId && turn.childJobId === childJobId) || (requestId && turn.requestId === requestId) || turn.dispatchedAt === dispatchedAt);
  if (turnIndex === -1) {
    throw codedError(
      "invalid_transition",
      `oracle job ${id} has no follow turn dispatched at ${dispatchedAt}`,
    );
  }
  const turns = [...job.turns];
  turns[turnIndex] = { ...turns[turnIndex], capturedAt };
  const root = getPrivateStateRoot();
  const directory = jobDirectory(id, root);
  const turnName = `${String(turnIndex + 1).padStart(4, "0")}.json`;
  atomicWriteJson(path.join(directory, "turns", turnName), turns[turnIndex], { root });
  const updated = { ...job, turns };
  atomicWriteJson(path.join(directory, "job.json"), updated, { root });
  return updated;
}

function listJobs({ limit } = {}) {
  const jobs = readJobs();
  return limit === undefined ? jobs : jobs.slice(0, Math.max(0, limit));
}

function adoptOrphans() {
  return listJobs({}).filter((job) => !TERMINAL_STATES.has(job.state));
}

module.exports = {
  adoptOrphans,
  appendTurn,
  createJob,
  getJob,
  getResponse,
  listJobs,
  markAwaiting,
  markCaptured,
  markDispatched,
  markFailed,
  markTurnCaptured,
  oracleRoot,
  updateTabId,
};
