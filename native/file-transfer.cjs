const crypto = require("crypto");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");

const TRANSFER_VERSION = 1;
const DEFAULT_LIMITS = Object.freeze({
  maxChunkBytes: 256 * 1024,
  maxFileBytes: 256 * 1024 * 1024,
  maxSessionBytes: 512 * 1024 * 1024,
  maxFiles: 32,
});
const TRANSFER_TYPES = new Set([
  "transfer_begin", "transfer_ready", "transfer_chunk", "transfer_end",
  "transfer_complete", "transfer_error",
]);

function transferError(message, code = "SURF_TRANSFER_ERROR") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function decodeBase64(value, maxBytes) {
  if (typeof value !== "string" || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw transferError("transfer chunk is not strict base64", "SURF_TRANSFER_BASE64");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw transferError("transfer chunk is not canonical base64", "SURF_TRANSFER_BASE64");
  if (decoded.length === 0) throw transferError("transfer chunk must not be empty", "SURF_TRANSFER_CHUNK");
  if (decoded.length > maxBytes) throw transferError("transfer chunk exceeds limit", "SURF_TRANSFER_CHUNK_LIMIT");
  return decoded;
}

function parsePathDescriptor(value, { mode = "remote", field = "path" } = {}) {
  if (typeof value !== "string" || value.length === 0) throw transferError(`${field} must be a path string`, "SURF_PATH_INVALID");
  const original = value;
  if (value.startsWith("remote:")) {
    if (mode === "local") throw transferError(`${field} remote: paths are not allowed in local mode`, "SURF_PATH_REMOTE_LOCAL");
    const resolved = value.slice("remote:".length);
    if (!path.isAbsolute(resolved)) throw transferError(`${field} remote: path must be absolute`, "SURF_PATH_REMOTE_RELATIVE");
    return { kind: "remote", path: resolved, original };
  }
  if (value.startsWith("local:")) {
    const resolved = value.slice("local:".length);
    if (!resolved) throw transferError(`${field} local: path is empty`, "SURF_PATH_INVALID");
    return { kind: "local", path: path.resolve(resolved), original };
  }
  return { kind: mode === "local" ? "local" : "local", path: path.resolve(value), original };
}

function rewritePath(value, descriptor) {
  if (!descriptor) return value;
  return descriptor.original;
}

function randomId(prefix = "transfer") {
  return `${prefix}-${crypto.randomBytes(16).toString("hex")}`;
}

async function createStagingDirectory(root, connectionId = randomId("connection")) {
  const dir = await fsp.mkdtemp(path.join(root || os.tmpdir(), `surf-transfer-${connectionId}-`));
  try {
    await fsp.chmod(dir, 0o700);
    return dir;
  } catch (error) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function randomStagingPath(directory, extension = "") {
  const suffix = extension && /^\.[A-Za-z0-9]{1,16}$/.test(extension) ? extension : "";
  return path.join(directory, `${crypto.randomBytes(20).toString("hex")}${suffix}`);
}

async function assertRegularFile(filePath, field = "file") {
  const stats = await fsp.stat(filePath);
  if (!stats.isFile()) throw transferError(`${field} must be a regular file`, "SURF_PATH_NOT_REGULAR");
  return stats;
}

function createTransferState({ directory, writer, limits = {}, completedTtlMs = 60000, onActivity = () => {}, onCleanup = () => {} } = {}) {
  const caps = { ...DEFAULT_LIMITS, ...limits };
  const transfers = new Map();
  const completed = new Map();
  const outboundWaiters = new Map();
  const seenIds = new Set();
  let usedBytes = 0;
  let fileCount = 0;
  let closed = false;

  const remove = async (state) => {
    if (!state || state.removed) return;
    state.removed = true;
    transfers.delete(state.id);
    completed.delete(state.id);
    if (state.completedTimer) clearTimeout(state.completedTimer);
    try { await state.file?.close(); } catch {}
    try { await fsp.rm(state.filePath, { force: true }); } catch {}
    try { await onCleanup(state); } catch {}
  };

  const fail = async (state, error) => {
    await remove(state);
    throw error;
  };

  const begin = async (frame) => {
    if (closed) throw transferError("transfer connection is closed", "SURF_TRANSFER_CLOSED");
    if (frame.version !== TRANSFER_VERSION || !TRANSFER_TYPES.has(frame.type) || frame.type !== "transfer_begin") throw transferError("invalid transfer begin frame", "SURF_TRANSFER_PROTOCOL");
    if (typeof frame.transferId !== "string" || seenIds.has(frame.transferId) || transfers.has(frame.transferId) || completed.has(frame.transferId)) throw transferError("duplicate or invalid transfer ID", "SURF_TRANSFER_DUPLICATE");
    if (frame.direction !== "upload" && frame.direction !== "download") throw transferError("invalid transfer direction", "SURF_TRANSFER_PROTOCOL");
    if (!Number.isSafeInteger(frame.size) || frame.size < 0 || frame.size > caps.maxFileBytes) throw transferError("declared transfer size exceeds limit", "SURF_TRANSFER_FILE_LIMIT");
    if (!isSha256(frame.sha256)) throw transferError("declared transfer hash is invalid", "SURF_TRANSFER_HASH");
    if (fileCount >= caps.maxFiles) throw transferError("transfer file count limit exceeded", "SURF_TRANSFER_COUNT_LIMIT");
    if (usedBytes + frame.size > caps.maxSessionBytes) throw transferError("transfer session byte limit exceeded", "SURF_TRANSFER_SESSION_LIMIT");
    if (frame.direction === "download") throw transferError("host transfer state accepts uploads only", "SURF_TRANSFER_DIRECTION");
    seenIds.add(frame.transferId);
    const state = {
      id: frame.transferId,
      direction: frame.direction,
      size: frame.size,
      sha256: frame.sha256.toLowerCase(),
      sequence: 0,
      received: 0,
      hash: crypto.createHash("sha256"),
      filePath: randomStagingPath(directory),
      file: null,
      removed: false,
    };
    state.file = await fsp.open(state.filePath, "wx", 0o600);
    await fsp.chmod(state.filePath, 0o600);
    transfers.set(state.id, state);
    usedBytes += state.size;
    fileCount += 1;
    onActivity();
    await writer.send({ type: "transfer_ready", version: TRANSFER_VERSION, transferId: state.id });
    return state;
  };

  const chunk = async (frame) => {
    const state = transfers.get(frame.transferId);
    if (!state || state.direction !== "upload") throw transferError("unknown transfer ID or direction", "SURF_TRANSFER_UNKNOWN");
    if (!Number.isSafeInteger(frame.sequence) || frame.sequence !== state.sequence) return fail(state, transferError("transfer chunks are out of order", "SURF_TRANSFER_SEQUENCE"));
    let data;
    try { data = decodeBase64(frame.data, caps.maxChunkBytes); } catch (error) { return fail(state, error); }
    if (state.received + data.length > state.size) return fail(state, transferError("transfer exceeds declared size", "SURF_TRANSFER_SIZE"));
    await state.file.write(data);
    state.hash.update(data);
    state.received += data.length;
    state.sequence += 1;
    onActivity();
  };

  const end = async (frame) => {
    const state = transfers.get(frame.transferId);
    if (!state || state.direction !== "upload") throw transferError("unknown transfer ID or direction", "SURF_TRANSFER_UNKNOWN");
    if (state.received !== state.size || state.hash.digest("hex") !== state.sha256) return fail(state, transferError("transfer size or SHA-256 mismatch", "SURF_TRANSFER_INTEGRITY"));
    await state.file.close();
    transfers.delete(state.id);
    completed.set(state.id, state);
    state.completedTimer = setTimeout(() => { discardCompleted(state.id).catch(() => {}); }, completedTtlMs);
    state.complete = true;
    await writer.send({ type: "transfer_complete", version: TRANSFER_VERSION, transferId: state.id, size: state.size, sha256: state.sha256 });
    onActivity();
    return state;
  };

  const handle = async (frame) => {
    if (!frame || !TRANSFER_TYPES.has(frame.type)) return false;
    if (frame.version !== TRANSFER_VERSION) throw transferError("unsupported transfer protocol version", "SURF_TRANSFER_PROTOCOL");
    if (frame.type === "transfer_complete" && outboundWaiters.has(frame.transferId)) {
      outboundWaiters.get(frame.transferId).resolve(frame);
      outboundWaiters.delete(frame.transferId);
      return true;
    }
    if (frame.type === "transfer_begin") await begin(frame);
    else if (frame.type === "transfer_chunk") await chunk(frame);
    else if (frame.type === "transfer_end") await end(frame);
    else throw transferError("unexpected transfer control frame", "SURF_TRANSFER_PROTOCOL");
    return true;
  };

  const reserveOutbound = (size, id) => {
    if (id && seenIds.has(id)) throw transferError("duplicate transfer ID", "SURF_TRANSFER_DUPLICATE");
    if (id) seenIds.add(id);
    if (size > caps.maxFileBytes) throw transferError("transfer file size limit exceeded", "SURF_TRANSFER_FILE_LIMIT");
    if (fileCount >= caps.maxFiles) throw transferError("transfer file count limit exceeded", "SURF_TRANSFER_COUNT_LIMIT");
    if (usedBytes + size > caps.maxSessionBytes) throw transferError("transfer session byte limit exceeded", "SURF_TRANSFER_SESSION_LIMIT");
    usedBytes += size; fileCount += 1;
  };
  const releaseOutbound = (size) => {
    usedBytes = Math.max(0, usedBytes - size);
    fileCount = Math.max(0, fileCount - 1);
  };
  const waitOutbound = (id) => new Promise((resolve, reject) => outboundWaiters.set(id, { resolve, reject }));
  const discardCompleted = async (id) => {
    const state = completed.get(id);
    if (!state) return false;
    completed.delete(id);
    if (state.completedTimer) clearTimeout(state.completedTimer);
    try { await fsp.rm(state.filePath, { force: true }); } catch {}
    try { await onCleanup(state); } catch {}
    return true;
  };
  const takeCompleted = (id) => {
    const state = completed.get(id);
    if (state) {
      completed.delete(id);
      if (state.completedTimer) clearTimeout(state.completedTimer);
    }
    return state;
  };
  const cleanup = async () => {
    closed = true;
    await Promise.all([...transfers.values()].map(remove));
    await Promise.all([...completed.keys()].map(discardCompleted));
    transfers.clear();
    for (const waiter of outboundWaiters.values()) waiter.reject(transferError("transfer connection closed", "SURF_TRANSFER_CLOSED"));
    outboundWaiters.clear();
    try { await fsp.rm(directory, { recursive: true, force: true }); } catch {}
  };
  return { handle, cleanup, reserveOutbound, releaseOutbound, waitOutbound, takeCompleted, discardCompleted, get directory() { return directory; }, get transfers() { return transfers; }, get completed() { return completed; }, get usedBytes() { return usedBytes; }, get fileCount() { return fileCount; } };
}

async function cleanupFilePaths(paths = []) {
  const owned = paths.splice(0, paths.length);
  await Promise.all(owned.map((filePath) => fsp.rm(filePath, { force: true }).catch(() => {})));
}

async function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  let size = 0;
  for await (const chunk of fs.createReadStream(filePath)) { hash.update(chunk); size += chunk.length; }
  return { size, sha256: hash.digest("hex") };
}

async function writeAtomicDownload(destination, chunks, expected) {
  const directory = path.dirname(destination);
  await fsp.mkdir(directory, { recursive: true });
  const temp = path.join(directory, `.${path.basename(destination)}.surf-${crypto.randomBytes(12).toString("hex")}.tmp`);
  const handle = await fsp.open(temp, "wx", 0o600);
  const hash = crypto.createHash("sha256");
  let size = 0;
  try {
    for await (const chunk of chunks) { size += chunk.length; if (size > expected.size) throw transferError("download exceeds declared size", "SURF_TRANSFER_SIZE"); hash.update(chunk); await handle.write(chunk); }
    await handle.close();
    if (size !== expected.size || hash.digest("hex") !== expected.sha256.toLowerCase()) throw transferError("download size or SHA-256 mismatch", "SURF_TRANSFER_INTEGRITY");
    await fsp.chmod(temp, 0o600);
    await fsp.rename(temp, destination);
  } catch (error) {
    await handle.close().catch(() => {});
    await fsp.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
  return destination;
}

function validateLocalToolPaths(tool, args = {}) {
  const normalized = { ...args };
  const normalize = (field, value) => parsePathDescriptor(value, { mode: "local", field }).path;
  if (tool === "upload" && args.files !== undefined) {
    normalized.files = Array.isArray(args.files)
      ? args.files.map((value) => normalize("files", value))
      : String(args.files).split(",").map((value) => normalize("files", value.trim())).join(",");
  }
  if (tool === "screenshot") {
    if (args.savePath !== undefined && args.output !== undefined) throw transferError("screenshot accepts only one output path", "SURF_PATH_FIELD");
    for (const field of ["savePath", "output"]) if (args[field] !== undefined) normalized[field] = normalize(field, args[field]);
  }
  if (tool === "network.export") {
    if (args.har !== undefined && typeof args.har !== "boolean") throw transferError("network.export har must be boolean", "SURF_PATH_FIELD");
    if (args.jsonl !== undefined && typeof args.jsonl !== "boolean") throw transferError("network.export jsonl must be boolean", "SURF_PATH_FIELD");
    if (args.har === true && args.jsonl === true) throw transferError("network.export cannot combine HAR and JSONL", "SURF_PATH_FIELD");
    normalized.output = args.output === undefined
      ? generatedClientPath("network-export", args.har === true ? ".har" : args.jsonl === true ? ".jsonl" : ".json")
      : normalize("output", args.output);
  }
  if (tool === "gemini") for (const field of ["file", "edit-image", "generate-image", "output"]) if (args[field] !== undefined) normalized[field] = normalize(field, args[field]);
  if (tool === "chatgpt" && args.file !== undefined) normalized.file = Array.isArray(args.file) ? args.file.map((value) => normalize("file", value)) : normalize("file", args.file);
  return normalized;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function rewriteTransferPaths(value, rewrites, depth = 0, seen = new Set(), budget = { remaining: 1000 }) {
  if (budget.remaining-- <= 0 || depth > 8) throw transferError("response exceeds path rewrite limits", "SURF_TRANSFER_RESPONSE_LIMIT");
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return rewrites.reduce((result, rewrite) => result.replaceAll(rewrite.path, rewrite.original), value);
  }
  if (Array.isArray(value)) return value.map((entry) => rewriteTransferPaths(entry, rewrites, depth + 1, seen, budget));
  if (!isPlainObject(value)) return value;
  if (seen.has(value)) throw transferError("response contains a cyclic value", "SURF_TRANSFER_RESPONSE_LIMIT");
  seen.add(value);
  const result = Object.create(Object.getPrototypeOf(value));
  for (const [key, entry] of Object.entries(value)) {
    Object.defineProperty(result, key, {
      value: rewriteTransferPaths(entry, rewrites, depth + 1, seen, budget),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

const AUTO_SCREENSHOT_TOOLS = Object.freeze(["click", "type", "key", "smart_type", "form.fill", "form_input", "drag", "hover", "scroll", "scroll.top", "scroll.bottom", "scroll.to", "dialog.accept", "dialog.dismiss", "js", "eval"]);
function generatedClientPath(prefix, extension) {
  return path.join(os.tmpdir(), `surf-${prefix}-${crypto.randomBytes(12).toString("hex")}${extension}`);
}

function scalarPath(value, field) {
  if (typeof value !== "string" || !value) throw transferError(`${field} must be one path string`, "SURF_PATH_DESCRIPTOR");
  return value;
}

function prepareRemoteTool(tool, args = {}) {
  const prepared = { ...args };
  const uploads = [];
  const downloads = [];
  const pathRefs = [];
  const addPath = (field, value, kind) => {
    const descriptor = parsePathDescriptor(scalarPath(value, field), { mode: "remote", field });
    pathRefs.push({ field, kind, original: descriptor.original, path: descriptor.kind === "remote" ? descriptor.path : descriptor.original, pathKind: descriptor.kind });
    if (descriptor.kind === "remote") prepared[field] = `remote:${descriptor.path}`;
    return descriptor;
  };
  const addInput = (field, value) => {
    const descriptor = addPath(field, value, "input");
    if (descriptor.kind === "local") uploads.push({ path: descriptor.path, field, original: descriptor.original, transferId: randomId("upload") });
    return descriptor;
  };
  const addOutput = (field, value) => {
    const descriptor = addPath(field, value, "output");
    if (descriptor.kind === "local") downloads.push({ transferId: randomId("download"), field, original: descriptor.original, destination: descriptor.path });
    return descriptor;
  };

  if (args.autoScreenshot !== undefined && typeof args.autoScreenshot !== "boolean") throw transferError("autoScreenshot must be boolean", "SURF_PATH_DESCRIPTOR");
  if (args.autoScreenshot === true && !AUTO_SCREENSHOT_TOOLS.includes(tool)) throw transferError(`autoScreenshot is not supported for ${tool}`, "SURF_PATH_DESCRIPTOR");
  if (args.autoScreenshotOutput !== undefined) throw transferError("autoScreenshotOutput is internal", "SURF_PATH_DESCRIPTOR");
  if (tool === "record") throw transferError("record is not supported with remote endpoint", "SURF_REMOTE_UNSUPPORTED");
  if (tool === "aistudio.build") throw transferError("aistudio.build is not supported for remote connections", "SURF_REMOTE_UNSUPPORTED");
  if (tool === "smoke" && args.screenshot !== undefined) throw transferError("smoke screenshots are not supported for remote connections", "SURF_REMOTE_UNSUPPORTED");
  if (tool === "network.export") {
    if (args.har !== undefined && typeof args.har !== "boolean") throw transferError("network.export har must be boolean", "SURF_PATH_FIELD");
    if (args.jsonl !== undefined && typeof args.jsonl !== "boolean") throw transferError("network.export jsonl must be boolean", "SURF_PATH_FIELD");
    if (args.har === true && args.jsonl === true) throw transferError("network.export cannot combine --har and --jsonl", "SURF_PATH_FIELD");
    const output = args.output === undefined
      ? generatedClientPath("network-export", args.har === true ? ".har" : args.jsonl === true ? ".jsonl" : ".json")
      : scalarPath(args.output, "output");
    prepared.output = output;
    addOutput("output", output);
  }

  if (tool === "chatgpt" && args.file !== undefined) {
    addInput("file", scalarPath(args.file, "file"));
  }

  if (tool === "gemini") {
    const hasFile = args.file !== undefined;
    const hasEdit = args["edit-image"] !== undefined;
    const hasGenerate = args["generate-image"] !== undefined;
    const hasOutput = args.output !== undefined;
    if (hasFile && (hasEdit || hasGenerate || hasOutput)) throw transferError("gemini attachment cannot combine with image mode or output", "SURF_REMOTE_UNSUPPORTED");
    if (hasEdit && hasGenerate) throw transferError("gemini edit-image cannot combine with generate-image", "SURF_REMOTE_UNSUPPORTED");
    if (hasGenerate && hasOutput) throw transferError("gemini generate-image uses its own output path", "SURF_REMOTE_UNSUPPORTED");
    if (hasOutput && !hasEdit) throw transferError("gemini output requires edit-image", "SURF_REMOTE_UNSUPPORTED");
    if (hasFile) addInput("file", scalarPath(args.file, "file"));
    if (hasEdit) {
      addInput("edit-image", scalarPath(args["edit-image"], "edit-image"));
      const output = hasOutput ? scalarPath(args.output, "output") : "edited.png";
      prepared.output = output;
      addOutput("output", output);
    } else if (hasGenerate) {
      if (hasOutput) throw transferError("gemini generate-image uses its own output path", "SURF_REMOTE_UNSUPPORTED");
      addOutput("generate-image", scalarPath(args["generate-image"], "generate-image"));
    }
  }

  if (tool === "upload") {
    const files = Array.isArray(args.files)
      ? args.files
      : typeof args.files === "string" ? args.files.split(",").map((value) => value.trim()).filter(Boolean) : [];
    if (files.length !== 1) throw transferError("remote upload supports exactly one file", "SURF_REMOTE_UNSUPPORTED");
    const descriptor = addInput("files", files[0]);
    prepared.files = [descriptor.kind === "remote" ? `remote:${descriptor.path}` : files[0]];
  }

  if (tool === "screenshot") {
    if (args.savePath !== undefined && args.output !== undefined) throw transferError("screenshot accepts only one output path", "SURF_PATH_FIELD");
    if (args.savePath !== undefined || args.output !== undefined) {
      const field = args.savePath !== undefined ? "savePath" : "output";
      addOutput(field, args[field]);
    }
  }

  if (args.autoScreenshot === true) {
    const output = generatedClientPath("auto-screenshot", ".png");
    prepared.autoScreenshotOutput = output;
    addOutput("autoScreenshotOutput", output);
  }

  return { args: prepared, uploads, downloads, pathRefs };
}

function exactTransferObject(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw transferError(`${label} must be an object`, "SURF_PATH_DESCRIPTOR");
  const allowed = new Set(fields);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw transferError(`${label} contains unsupported field ${key}`, "SURF_PATH_DESCRIPTOR");
  for (const key of fields) if (!(key in value)) throw transferError(`${label} is missing ${key}`, "SURF_PATH_DESCRIPTOR");
  return value;
}

async function materializeRemoteTool({ tool, args: rawArgs = {}, metadata = null, pathRefs = [], transferState, getTransferState } = {}) {
  const args = { ...rawArgs };
  if (args.autoScreenshot !== undefined && typeof args.autoScreenshot !== "boolean") throw transferError("autoScreenshot must be boolean", "SURF_PATH_DESCRIPTOR");
  if (args.autoScreenshot === true && !AUTO_SCREENSHOT_TOOLS.includes(tool)) throw transferError(`autoScreenshot is not supported for ${tool}`, "SURF_PATH_DESCRIPTOR");
  if (args.autoScreenshotOutput !== undefined && !(args.autoScreenshot === true && AUTO_SCREENSHOT_TOOLS.includes(tool))) throw transferError("autoScreenshotOutput is internal", "SURF_PATH_DESCRIPTOR");
  const meta = metadata === undefined || metadata === null ? {} : exactTransferObject(metadata, ["uploads", "downloads"], "transfer metadata");
  const uploads = meta.uploads === undefined ? [] : meta.uploads;
  const downloads = meta.downloads === undefined ? [] : meta.downloads;
  if (!Array.isArray(pathRefs) || !Array.isArray(uploads) || !Array.isArray(downloads) || uploads.length > 1 || downloads.length > 1) throw transferError("invalid transfer metadata", "SURF_PATH_DESCRIPTOR");
  if (tool === "record" || tool === "aistudio.build") throw transferError(`${tool} is not supported for remote connections`, "SURF_REMOTE_UNSUPPORTED");
  if (tool === "smoke" && args.screenshot !== undefined) throw transferError("smoke screenshots are not supported for remote connections", "SURF_REMOTE_UNSUPPORTED");
  if (tool === "network.export") {
    if (args.har !== undefined && typeof args.har !== "boolean") throw transferError("network.export har must be boolean", "SURF_PATH_FIELD");
    if (args.jsonl !== undefined && typeof args.jsonl !== "boolean") throw transferError("network.export jsonl must be boolean", "SURF_PATH_FIELD");
    if (args.har === true && args.jsonl === true) throw transferError("network.export cannot combine --har and --jsonl", "SURF_PATH_FIELD");
  }

  const descriptors = pathRefs.map((entry) => exactTransferObject(entry, ["field", "kind", "original", "path", "pathKind"], "path descriptor"));
  const seenFields = new Set();
  for (const descriptor of descriptors) {
    if (typeof descriptor.field !== "string" || typeof descriptor.original !== "string" || !descriptor.original || typeof descriptor.path !== "string" || !descriptor.path) throw transferError("invalid path descriptor values", "SURF_PATH_DESCRIPTOR");
    const parsed = parsePathDescriptor(descriptor.original, { mode: "remote", field: descriptor.field });
    const expected = parsed.kind === "remote" ? parsed.path : descriptor.original;
    if (seenFields.has(descriptor.field) || !["files", "file", "edit-image", "generate-image", "savePath", "output", "autoScreenshotOutput"].includes(descriptor.field) || !["input", "output"].includes(descriptor.kind) || descriptor.pathKind !== parsed.kind || descriptor.path !== expected) throw transferError("invalid or duplicate path descriptor", "SURF_PATH_DESCRIPTOR");
    seenFields.add(descriptor.field);
  }
  const validateTransfer = (entry, fields, label) => {
    exactTransferObject(entry, fields, label);
    if (typeof entry.transferId !== "string" || !entry.transferId || entry.transferId.length > 128 || typeof entry.field !== "string" || typeof entry.original !== "string" || !entry.original || typeof entry.kind !== "string") throw transferError(`${label} contains invalid values`, "SURF_PATH_DESCRIPTOR");
  };
  uploads.forEach((entry) => validateTransfer(entry, ["transferId", "field", "original", "kind"], "upload descriptor"));
  downloads.forEach((entry) => validateTransfer(entry, ["transferId", "field", "original", "kind"], "download descriptor"));

  const pathFor = (field, kind) => descriptors.filter((entry) => entry.field === field && entry.kind === kind);
  const rawMatches = (field, original) => field === "files"
    ? Array.isArray(args[field]) && args[field].length === 1 && args[field][0] === original
    : typeof args[field] === "string" && args[field] === original;
  const outputTransfers = [];
  const pathRewrites = [];
  const transferCleanup = [];
  let state = transferState;

  const materializeInput = async (field) => {
    const descriptor = descriptors.find((entry) => entry.field === field && entry.kind === "input");
    if (!descriptor || !rawMatches(field, descriptor.original)) throw transferError(`${field} input descriptor mismatch`, "SURF_PATH_DESCRIPTOR");
    if (descriptor.pathKind === "remote") {
      if (uploads.length || descriptor.path !== parsePathDescriptor(descriptor.original, { mode: "remote", field }).path) throw transferError(`${field} remote descriptor mismatch`, "SURF_PATH_DESCRIPTOR");
      await assertRegularFile(descriptor.path, field);
      args[field] = descriptor.path;
      pathRewrites.push({ path: descriptor.path, original: descriptor.original });
      return descriptor;
    }
    const upload = uploads.find((entry) => entry.field === field && entry.kind === "upload" && entry.original === descriptor.original);
    if (!upload || !state) throw transferError(`${field} upload is not complete`, "SURF_TRANSFER_UNKNOWN");
    const completed = state.takeCompleted(upload.transferId);
    if (!completed) throw transferError(`${field} upload is not complete`, "SURF_TRANSFER_UNKNOWN");
    args[field] = completed.filePath;
    pathRewrites.push({ path: completed.filePath, original: descriptor.original });
    transferCleanup.push(completed.filePath);
    return descriptor;
  };
  const materializeOutput = async (field) => {
    const descriptor = descriptors.find((entry) => entry.field === field && entry.kind === "output");
    if (!descriptor || !rawMatches(field, descriptor.original)) throw transferError(`${field} output descriptor mismatch`, "SURF_PATH_DESCRIPTOR");
    if (descriptor.pathKind === "remote") {
      const allowsGeminiInputOutput = tool === "gemini" && args["edit-image"] !== undefined;
      if ((!allowsGeminiInputOutput && uploads.length) || downloads.length || descriptor.path !== parsePathDescriptor(descriptor.original, { mode: "remote", field }).path) throw transferError(`${field} remote descriptor mismatch`, "SURF_PATH_DESCRIPTOR");
      args[field] = descriptor.path;
      pathRewrites.push({ path: descriptor.path, original: descriptor.original });
      return descriptor;
    }
    const download = downloads.find((entry) => entry.field === field && entry.kind === "download" && entry.original === descriptor.original);
    const allowsGeminiInputOutput = tool === "gemini" && args["edit-image"] !== undefined;
    if (!download || (!allowsGeminiInputOutput && uploads.length) || downloads.length !== 1) throw transferError(`${field} download descriptor mismatch`, "SURF_PATH_DESCRIPTOR");
    state ||= await getTransferState();
    const stagingPath = randomStagingPath(state.directory);
    args[field] = stagingPath;
    outputTransfers.push({ ...download, path: stagingPath });
    pathRewrites.push({ path: stagingPath, original: descriptor.original });
    transferCleanup.push(stagingPath);
    return descriptor;
  };

  try {
  if (tool === "upload") {
    const files = args.files;
    if (!Array.isArray(files) || files.length !== 1 || descriptors.length !== 1 || pathFor("files", "input").length !== 1 || downloads.length || !rawMatches("files", descriptors[0].original)) throw transferError("upload requires exactly one matching files input descriptor", "SURF_PATH_DESCRIPTOR");
    await materializeInput("files");
  } else if (tool === "chatgpt") {
    if (args.file !== undefined) {
      if (typeof args.file !== "string" || descriptors.length !== 1 || downloads.length) throw transferError("chatgpt attachment metadata mismatch", "SURF_PATH_DESCRIPTOR");
      await materializeInput("file");
    } else if (descriptors.length || uploads.length || downloads.length) throw transferError("chatgpt transfer metadata has no attachment", "SURF_PATH_DESCRIPTOR");
  } else if (tool === "gemini") {
    const hasFile = args.file !== undefined;
    const hasEdit = args["edit-image"] !== undefined;
    const hasGenerate = args["generate-image"] !== undefined;
    const hasOutput = args.output !== undefined;
    if (hasFile && (hasEdit || hasGenerate || hasOutput)) throw transferError("gemini attachment cannot combine with image mode or output", "SURF_REMOTE_UNSUPPORTED");
    if (hasEdit && hasGenerate) throw transferError("gemini edit-image cannot combine with generate-image", "SURF_REMOTE_UNSUPPORTED");
    if (hasGenerate && hasOutput) throw transferError("gemini generate-image uses its own output path", "SURF_REMOTE_UNSUPPORTED");
    if (hasOutput && !hasEdit) throw transferError("gemini output requires edit-image", "SURF_REMOTE_UNSUPPORTED");
    if (hasFile) {
      if (descriptors.length !== 1 || downloads.length || pathFor("file", "input").length !== 1) throw transferError("gemini attachment metadata mismatch", "SURF_PATH_DESCRIPTOR");
      await materializeInput("file");
    } else if (hasEdit) {
      if (descriptors.length !== 2 || pathFor("edit-image", "input").length !== 1 || pathFor("output", "output").length !== 1) throw transferError("gemini edit metadata mismatch", "SURF_PATH_DESCRIPTOR");
      await materializeInput("edit-image");
      await materializeOutput("output");
    } else if (hasGenerate) {
      if (descriptors.length !== 1 || pathFor("generate-image", "output").length !== 1) throw transferError("gemini generate metadata mismatch", "SURF_PATH_DESCRIPTOR");
      await materializeOutput("generate-image");
    }
    else if (descriptors.length || uploads.length || downloads.length) throw transferError("gemini transfer metadata has no image path", "SURF_PATH_DESCRIPTOR");
  } else if (tool === "screenshot") {
    if (args.savePath !== undefined && args.output !== undefined) throw transferError("screenshot accepts only one output path", "SURF_PATH_FIELD");
    const field = args.savePath !== undefined ? "savePath" : args.output !== undefined ? "output" : null;
    if (field) {
      if (descriptors.length !== 1) throw transferError("screenshot output metadata mismatch", "SURF_PATH_DESCRIPTOR");
      await materializeOutput(field);
    }
    else if (descriptors.length || uploads.length || downloads.length) throw transferError("screenshot transfer metadata has no output path", "SURF_PATH_DESCRIPTOR");
  } else if (tool === "network.export") {
    if (typeof args.output !== "string" || descriptors.length !== 1 || pathFor("output", "output").length !== 1) throw transferError("network export output metadata mismatch", "SURF_PATH_DESCRIPTOR");
    await materializeOutput("output");
  } else if (AUTO_SCREENSHOT_TOOLS.includes(tool) && args.autoScreenshot === true) {
    if (descriptors.length !== 1 || descriptors[0].field !== "autoScreenshotOutput" || descriptors[0].pathKind !== "local" || uploads.length) throw transferError("auto screenshot metadata mismatch", "SURF_PATH_DESCRIPTOR");
    await materializeOutput("autoScreenshotOutput");
  } else if (descriptors.length || uploads.length || downloads.length) {
    throw transferError("file transfer metadata is not supported for this tool", "SURF_PATH_DESCRIPTOR");
  }

  if (uploads.length && !["upload", "chatgpt", "gemini"].includes(tool)) throw transferError("upload metadata is not supported for this tool", "SURF_PATH_DESCRIPTOR");
  if (downloads.length && !["screenshot", "gemini", "network.export", ...AUTO_SCREENSHOT_TOOLS].includes(tool)) throw transferError("download metadata is not supported for this tool", "SURF_PATH_DESCRIPTOR");
    return { args, transferState: state, outputTransfers, pathRewrites, transferCleanup };
  } catch (error) {
    await cleanupFilePaths([...new Set(transferCleanup)]);
    throw error;
  }
}

async function streamFileDownload({ writer, state, filePath, transferId = randomId("download"), original } = {}) {
  const stats = await assertRegularFile(filePath, "download");
  if (stats.size > DEFAULT_LIMITS.maxFileBytes) throw transferError("download exceeds file size limit", "SURF_TRANSFER_FILE_LIMIT");
  state.reserveOutbound(stats.size, transferId);
  let digest;
  try {
    digest = await hashFile(filePath);
    if (digest.size !== stats.size || digest.size > DEFAULT_LIMITS.maxFileBytes) throw transferError("download changed during hashing", "SURF_TRANSFER_INTEGRITY");
  } catch (error) {
    state.releaseOutbound?.(stats.size);
    throw error;
  }
  await writer.send({ type: "transfer_begin", version: TRANSFER_VERSION, direction: "download", transferId, size: digest.size, sha256: digest.sha256 });
  let sequence = 0;
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: DEFAULT_LIMITS.maxChunkBytes })) {
    await writer.send({ type: "transfer_chunk", version: TRANSFER_VERSION, transferId, sequence, data: chunk.toString("base64") });
    sequence += 1;
  }
  const completion = state.waitOutbound(transferId);
  await writer.send({ type: "transfer_end", version: TRANSFER_VERSION, transferId });
  await completion;
  return { transferId, size: digest.size, sha256: digest.sha256 };
}

function createClientTransferController({ writer, limits = {}, onActivity = () => {} } = {}) {
  const caps = { ...DEFAULT_LIMITS, ...limits };
  const incoming = new Map();
  const waiters = new Map();
  let usedBytes = 0;
  let fileCount = 0;
  const seenIds = new Set();
  let closed = false;
  const waitFor = (id, type) => new Promise((resolve, reject) => {
    const key = `${id}:${type}`;
    waiters.set(key, { resolve, reject });
  });
  const settle = (frame) => {
    const entry = waiters.get(`${frame.transferId}:${frame.type}`);
    if (!entry) return false;
    waiters.delete(`${frame.transferId}:${frame.type}`);
    entry.resolve(frame);
    return true;
  };
  const cancelDownload = async (transferId) => {
    const state = incoming.get(transferId);
    if (!state) return false;
    incoming.delete(transferId);
    await state.file?.close().catch(() => {});
    await fsp.rm(state.temp, { force: true }).catch(() => {});
    return true;
  };
  const cancelDownloads = async (ids) => {
    for (const id of ids || [...incoming.keys()]) await cancelDownload(id);
  };
  const hasDownload = (id) => incoming.has(id);
  const failDownload = async (id, error) => { await cancelDownload(id); throw error; };
  const upload = async (filePath, { transferId = randomId("upload"), original, field } = {}) => {
    if (closed) throw transferError("transfer connection is closed", "SURF_TRANSFER_CLOSED");
    if (seenIds.has(transferId)) throw transferError("duplicate transfer ID", "SURF_TRANSFER_DUPLICATE");
    seenIds.add(transferId);
    const stats = await assertRegularFile(filePath, field || "upload");
    if (stats.size > caps.maxFileBytes) throw transferError("upload exceeds file size limit", "SURF_TRANSFER_FILE_LIMIT");
    if (fileCount >= caps.maxFiles || usedBytes + stats.size > caps.maxSessionBytes) throw transferError("transfer session limit exceeded", "SURF_TRANSFER_SESSION_LIMIT");
    const digest = await hashFile(filePath);
    usedBytes += digest.size; fileCount += 1;
    const ready = waitFor(transferId, "transfer_ready");
    await writer.send({ type: "transfer_begin", version: TRANSFER_VERSION, direction: "upload", transferId, size: digest.size, sha256: digest.sha256 });
    await ready;
    let sequence = 0;
    for await (const chunk of fs.createReadStream(filePath, { highWaterMark: caps.maxChunkBytes })) {
      await writer.send({ type: "transfer_chunk", version: TRANSFER_VERSION, transferId, sequence, data: chunk.toString("base64") });
      sequence += 1;
      onActivity();
    }
    const completeWait = waitFor(transferId, "transfer_complete");
    await writer.send({ type: "transfer_end", version: TRANSFER_VERSION, transferId });
    const complete = await completeWait;
    return { transferId, size: digest.size, sha256: digest.sha256 };
  };
  const expectDownload = async ({ transferId, destination, size, sha256 }) => {
    if (incoming.has(transferId) || seenIds.has(transferId)) throw transferError("duplicate transfer ID", "SURF_TRANSFER_DUPLICATE");
    seenIds.add(transferId);
    if (fileCount >= caps.maxFiles || (size !== undefined && (size > caps.maxFileBytes || usedBytes + size > caps.maxSessionBytes))) throw transferError("transfer session limit exceeded", "SURF_TRANSFER_SESSION_LIMIT");
    const directory = path.dirname(destination);
    await fsp.mkdir(directory, { recursive: true });
    const temp = path.join(directory, `.${path.basename(destination)}.surf-${crypto.randomBytes(12).toString("hex")}.tmp`);
    const file = await fsp.open(temp, "wx", 0o600);
    incoming.set(transferId, { transferId, destination, size, sha256: sha256?.toLowerCase(), temp, file, hash: crypto.createHash("sha256"), sequence: 0, received: 0 });
    fileCount += 1;
  };
  const handle = async (frame) => {
    if (!frame || !TRANSFER_TYPES.has(frame.type)) return false;
    if (frame.version !== TRANSFER_VERSION) throw transferError("unsupported transfer protocol version", "SURF_TRANSFER_PROTOCOL");
    if (frame.type === "transfer_error") {
      let found = false;
      for (const [key, waiter] of waiters) {
        if (key.startsWith(`${frame.transferId}:`)) { waiters.delete(key); waiter.reject(transferError(frame.error || "transfer failed")); found = true; }
      }
      if (!found) throw transferError("unknown transfer ID", "SURF_TRANSFER_UNKNOWN");
      return true;
    }
    if (frame.type === "transfer_ready" || frame.type === "transfer_complete") {
      if (!settle(frame)) throw transferError("unknown transfer ID", "SURF_TRANSFER_UNKNOWN");
      return true;
    }
    if (frame.type === "transfer_begin") {
      const state = incoming.get(frame.transferId);
      if (!state || frame.direction !== "download" || (state.size !== undefined && frame.size !== state.size) || (state.sha256 && frame.sha256.toLowerCase() !== state.sha256)) return failDownload(frame.transferId, transferError("unknown or mismatched download", "SURF_TRANSFER_UNKNOWN"));
      state.size = frame.size; state.sha256 = frame.sha256.toLowerCase();
      if (usedBytes + state.size > caps.maxSessionBytes || state.size > caps.maxFileBytes) {
        return failDownload(state.transferId, transferError("transfer session limit exceeded", "SURF_TRANSFER_SESSION_LIMIT"));
      }
      usedBytes += state.size;
      state.started = true; onActivity(); return true;
    }
    const state = incoming.get(frame.transferId);
    if (!state || !state.started) throw transferError("unknown transfer ID or state", "SURF_TRANSFER_UNKNOWN");
    if (frame.type === "transfer_chunk") {
      if (frame.sequence !== state.sequence) return failDownload(state.transferId, transferError("download chunks are out of order", "SURF_TRANSFER_SEQUENCE"));
      let data;
      try { data = decodeBase64(frame.data, caps.maxChunkBytes); } catch (error) { return failDownload(state.transferId, error); }
      if (state.received + data.length > state.size) return failDownload(state.transferId, transferError("download exceeds declared size", "SURF_TRANSFER_SIZE"));
      await state.file.write(data); state.hash.update(data); state.sequence += 1; state.received += data.length; onActivity(); return true;
    }
    if (frame.type === "transfer_end") {
      const actualHash = state.hash.digest("hex");
      if (state.received !== state.size || actualHash !== state.sha256) {
        return failDownload(state.transferId, transferError(`download size or SHA-256 mismatch (received ${state.received}/${state.size})`, "SURF_TRANSFER_INTEGRITY"));
      }
      await state.file.close(); await fsp.chmod(state.temp, 0o600); await fsp.rename(state.temp, state.destination);
      incoming.delete(state.transferId);
      await writer.send({ type: "transfer_complete", version: TRANSFER_VERSION, transferId: state.transferId, size: state.size, sha256: state.sha256 });
      onActivity(); return true;
    }
    throw transferError("unexpected transfer frame", "SURF_TRANSFER_PROTOCOL");
  };
  const cleanup = async (error = transferError("transfer connection closed", "SURF_TRANSFER_CLOSED")) => {
    closed = true;
    for (const entry of waiters.values()) entry.reject(error);
    waiters.clear();
    await cancelDownloads();
  };
  return { upload, expectDownload, cancelDownload, cancelDownloads, hasDownload, handle, cleanup };
}

module.exports = {
  AUTO_SCREENSHOT_TOOLS,
  DEFAULT_LIMITS,
  TRANSFER_VERSION,
  TRANSFER_TYPES,
  assertRegularFile,
  createStagingDirectory,
  createTransferState,
  createClientTransferController,
  cleanupFilePaths,
  decodeBase64,
  streamFileDownload,
  hashFile,
  materializeRemoteTool,
  parsePathDescriptor,
  prepareRemoteTool,
  randomStagingPath,
  validateLocalToolPaths,
  rewritePath,
  rewriteTransferPaths,
  transferError,
  writeAtomicDownload,
};
