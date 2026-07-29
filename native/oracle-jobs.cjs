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

function readJobs(root = getPrivateStateRoot()) {
  const base = oracleRoot(root);
  if (!fs.existsSync(base)) return [];
  const stat = assertNotSymlink(base, false);
  if (!stat.isDirectory()) throw new Error(`oracle state path is not a directory: ${base}`);
  return fs.readdirSync(base)
    .filter((id) => JOB_ID_PATTERN.test(id))
    .sort((a, b) => b.localeCompare(a))
    .map((id) => readPrivateJson(path.join(base, id, "job.json"), null, { root }))
    .filter(Boolean);
}

function createJob({ prompt, contextManifest = {}, model = null, effortRequested = null, follow = null }) {
  const root = getPrivateStateRoot();
  const base = oracleRoot(root);
  ensurePrivateDir(base, root);
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
      effortRequested,
      effortVerified: null,
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
  return job;
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
    ...(modelVerified ? { model: modelVerified } : {}),
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
  const storedTurn = {
    prompt: turn.prompt,
    dispatchedAt: turn.dispatchedAt ?? null,
    capturedAt: turn.capturedAt ?? null,
  };
  const root = getPrivateStateRoot();
  const directory = jobDirectory(id, root);
  const turnName = `${String(job.turns.length + 1).padStart(4, "0")}.json`;
  atomicWriteJson(path.join(directory, "turns", turnName), storedTurn, { root });
  const updated = { ...job, turns: [...job.turns, storedTurn] };
  atomicWriteJson(path.join(directory, "job.json"), updated, { root });
  return updated;
}

function markTurnCaptured(id, { dispatchedAt, capturedAt }) {
  const job = getJob(id);
  const turnIndex = job.turns.findIndex((turn) => turn.dispatchedAt === dispatchedAt);
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
