const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

function getPrivateStateRoot(env = process.env) {
  return path.resolve(env.SURF_STATE_DIR || path.join(os.homedir(), ".surf", "state"));
}

function assertNotSymlink(targetPath, allowMissing = true) {
  try {
    const stat = fs.lstatSync(targetPath);
    if (stat.isSymbolicLink()) throw new Error(`refusing symbolic link: ${targetPath}`);
    return stat;
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return null;
    throw error;
  }
}

function assertWithin(root, targetPath) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`private state path escapes root: ${targetPath}`);
  }
  return resolvedTarget;
}

function ensurePrivateDir(dirPath, root = getPrivateStateRoot()) {
  const resolvedRoot = path.resolve(root);
  const resolvedDir = assertWithin(resolvedRoot, dirPath);
  const rootStat = assertNotSymlink(resolvedRoot, true);
  if (!rootStat) fs.mkdirSync(resolvedRoot, { recursive: true, mode: PRIVATE_DIR_MODE });
  const checkedRoot = assertNotSymlink(resolvedRoot, false);
  if (!checkedRoot.isDirectory()) throw new Error(`private state path is not a directory: ${resolvedRoot}`);
  fs.chmodSync(resolvedRoot, PRIVATE_DIR_MODE);
  const relative = path.relative(resolvedRoot, resolvedDir);
  let current = resolvedRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = assertNotSymlink(current, true);
    if (!stat) fs.mkdirSync(current, { mode: PRIVATE_DIR_MODE });
    const checked = assertNotSymlink(current, false);
    if (!checked.isDirectory()) throw new Error(`private state path is not a directory: ${current}`);
    fs.chmodSync(current, PRIVATE_DIR_MODE);
  }
  return resolvedDir;
}

function privateStatePath(...segments) {
  const root = getPrivateStateRoot();
  return assertWithin(root, path.join(root, ...segments));
}

function prepareOutputDirectory(filePath, options) {
  const dir = path.dirname(filePath);
  if (options.root) return ensurePrivateDir(dir, options.root);
  const stat = assertNotSymlink(dir, false);
  if (!stat.isDirectory()) throw new Error(`output parent is not a directory: ${dir}`);
  return dir;
}

function atomicWriteFile(filePath, content, options = {}) {
  const resolved = path.resolve(filePath);
  if (options.root) assertWithin(options.root, resolved);
  const dir = prepareOutputDirectory(resolved, options);
  assertNotSymlink(resolved, true);
  const temporaryPath = path.join(dir, `.${path.basename(resolved)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temporaryPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, PRIVATE_FILE_MODE);
    fs.writeFileSync(fd, content, options.encoding || undefined);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    assertNotSymlink(resolved, true);
    fs.renameSync(temporaryPath, resolved);
    fs.chmodSync(resolved, PRIVATE_FILE_MODE);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temporaryPath); } catch {}
  }
  return resolved;
}

function atomicWriteJson(filePath, value, options = {}) {
  return atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { ...options, encoding: "utf8" });
}

function appendPrivateJsonLine(filePath, value, options = {}) {
  const resolved = path.resolve(filePath);
  const root = options.root || getPrivateStateRoot();
  assertWithin(root, resolved);
  ensurePrivateDir(path.dirname(resolved), root);
  assertNotSymlink(resolved, true);
  const fd = fs.openSync(resolved, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND, PRIVATE_FILE_MODE);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value)}\n`, "utf8");
    fs.fsyncSync(fd);
    fs.fchmodSync(fd, PRIVATE_FILE_MODE);
  } finally {
    fs.closeSync(fd);
  }
  return resolved;
}

function writePrivateFileExclusive(filePath, content, options = {}) {
  const resolved = path.resolve(filePath);
  const root = options.root || getPrivateStateRoot();
  assertWithin(root, resolved);
  ensurePrivateDir(path.dirname(resolved), root);
  assertNotSymlink(resolved, true);
  const fd = fs.openSync(resolved, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, PRIVATE_FILE_MODE);
  try {
    fs.writeFileSync(fd, content, options.encoding || undefined);
    fs.fsyncSync(fd);
    fs.fchmodSync(fd, PRIVATE_FILE_MODE);
  } finally {
    fs.closeSync(fd);
  }
  return resolved;
}

function readPrivateFile(filePath, options = {}) {
  const resolved = path.resolve(filePath);
  const root = options.root || getPrivateStateRoot();
  assertWithin(root, resolved);
  const stat = assertNotSymlink(resolved, options.allowMissing === true);
  if (!stat) return options.fallback;
  if (!stat.isFile()) throw new Error(`private state path is not a file: ${resolved}`);
  if ((stat.mode & 0o077) !== 0) throw new Error(`private state file permissions are too broad: ${resolved}`);
  return fs.readFileSync(resolved, options.encoding || null);
}

function readPrivateJson(filePath, fallback = null, options = {}) {
  const content = readPrivateFile(filePath, { ...options, allowMissing: true, fallback: null, encoding: "utf8" });
  return content === null ? fallback : JSON.parse(content);
}

module.exports = {
  appendPrivateJsonLine,
  assertNotSymlink,
  assertWithin,
  atomicWriteFile,
  atomicWriteJson,
  ensurePrivateDir,
  getPrivateStateRoot,
  privateStatePath,
  readPrivateFile,
  readPrivateJson,
  writePrivateFileExclusive,
};
