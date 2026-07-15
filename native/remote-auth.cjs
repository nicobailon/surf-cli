const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PROTOCOL_VERSION = 1;
const NONCE_BYTES = 32;
const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CLIENT_ID_PATTERN = /^[a-f0-9]{32}$/;
const STATE_DIR_MODE = 0o700;
const STATE_FILE_MODE = 0o600;
const DEFAULT_STATE_DIR = path.join(os.homedir(), ".surf", "remote");
const HOST_IDENTITY_FILE = "host-identity.json";
const CLIENT_REGISTRY_FILE = "remote-clients.json";
const AUTH_DOMAIN = "surf-cli-remote-auth-v1";

function getStateDir(env = process.env) {
  return env.SURF_REMOTE_STATE_DIR || DEFAULT_STATE_DIR;
}

function assertSafeLabel(label) {
  if (typeof label !== "string" || !LABEL_PATTERN.test(label)) {
    throw new Error("remote client label must be 1-64 characters using letters, numbers, dot, underscore, or hyphen");
  }
  return label;
}

function assertClientId(clientId) {
  if (typeof clientId !== "string" || !CLIENT_ID_PATTERN.test(clientId)) throw new Error("remote client ID is invalid");
}

function statePaths(stateDir = getStateDir()) {
  return {
    stateDir,
    hostIdentity: path.join(stateDir, HOST_IDENTITY_FILE),
    registry: path.join(stateDir, CLIENT_REGISTRY_FILE),
  };
}

function assertNotSymlink(filePath, allowMissing = true) {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) throw new Error(`refusing symbolic link: ${filePath}`);
    return stat;
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return null;
    throw error;
  }
}

function ensureStateDir(stateDir) {
  assertNotSymlink(stateDir, true);
  fs.mkdirSync(stateDir, { recursive: true, mode: STATE_DIR_MODE });
  const stat = assertNotSymlink(stateDir, false);
  if (!stat.isDirectory()) throw new Error(`remote state path is not a directory: ${stateDir}`);
  fs.chmodSync(stateDir, STATE_DIR_MODE);
}

function assertPrivateFile(filePath) {
  const stat = assertNotSymlink(filePath, false);
  if (!stat.isFile()) throw new Error(`remote state path is not a file: ${filePath}`);
  if ((stat.mode & 0o077) !== 0) throw new Error(`remote state file permissions are too broad: ${filePath}`);
  return stat;
}

function atomicWriteJson(filePath, value) {
  const dir = path.dirname(filePath);
  assertNotSymlink(dir, true);
  fs.mkdirSync(dir, { recursive: true, mode: STATE_DIR_MODE });
  assertNotSymlink(dir, false);
  assertNotSymlink(filePath, true);
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`);
  let created = false;
  try {
    const fd = fs.openSync(tempPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, STATE_FILE_MODE);
    created = true;
    try {
      fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tempPath, filePath);
    fs.chmodSync(filePath, STATE_FILE_MODE);
  } finally {
    if (created) {
      try { fs.unlinkSync(tempPath); } catch {}
    }
  }
}

function readJson(filePath, fallback) {
  const stat = assertNotSymlink(filePath, true);
  if (!stat) return fallback;
  assertPrivateFile(filePath);
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return value;
}

function exportKey(keyObject, type) {
  return keyObject.export({ type, format: "der" }).toString("base64");
}

function importPublicKey(value) {
  if (typeof value !== "string" || !value) throw new Error("remote public key is missing");
  return crypto.createPublicKey({ key: Buffer.from(value, "base64"), type: "spki", format: "der" });
}

function importPrivateKey(value) {
  if (typeof value !== "string" || !value) throw new Error("remote private key is missing");
  return crypto.createPrivateKey({ key: Buffer.from(value, "base64"), type: "pkcs8", format: "der" });
}

function loadHostIdentity(stateDir = getStateDir()) {
  const { hostIdentity } = statePaths(stateDir);
  const value = readJson(hostIdentity, null);
  if (!value || value.version !== 1 || typeof value.publicKey !== "string" || typeof value.privateKey !== "string") {
    throw new Error("remote host identity is invalid");
  }
  const privateKey = importPrivateKey(value.privateKey);
  const publicKey = importPublicKey(value.publicKey);
  return { stateDir, path: hostIdentity, publicKey: value.publicKey, privateKey, publicKeyObject: publicKey };
}

function ensureHostIdentity(stateDir = getStateDir()) {
  ensureStateDir(stateDir);
  const { hostIdentity } = statePaths(stateDir);
  const existing = readJson(hostIdentity, null);
  if (existing) return loadHostIdentity(stateDir);
  const pair = crypto.generateKeyPairSync("ed25519");
  const value = { version: 1, publicKey: exportKey(pair.publicKey, "spki"), privateKey: exportKey(pair.privateKey, "pkcs8"), createdAt: new Date().toISOString() };
  atomicWriteJson(hostIdentity, value);
  return loadHostIdentity(stateDir);
}

function loadRegistry(stateDir = getStateDir()) {
  ensureStateDir(stateDir);
  const { registry } = statePaths(stateDir);
  const value = readJson(registry, null);
  if (!value) return { version: 1, clients: [] };
  if (value.version !== 1 || !Array.isArray(value.clients)) throw new Error("remote client registry is invalid");
  for (const client of value.clients) {
    assertClientId(client.id);
    assertSafeLabel(client.label);
    importPublicKey(client.publicKey);
  }
  return value;
}

function saveRegistry(stateDir, registry) {
  const { registry: registryPath } = statePaths(stateDir);
  atomicWriteJson(registryPath, registry);
}

function authorizeClient(label, outputPath, stateDir = getStateDir()) {
  assertSafeLabel(label);
  if (typeof outputPath !== "string" || !outputPath) throw new Error("--output is required for remote authorize");
  ensureStateDir(stateDir);
  const host = ensureHostIdentity(stateDir);
  const registry = loadRegistry(stateDir);
  if (registry.clients.some((client) => client.label === label)) throw new Error(`remote client label already exists: ${label}`);
  const output = path.resolve(outputPath);
  assertNotSymlink(output, true);
  if (fs.existsSync(output)) throw new Error(`credential output already exists: ${output}`);
  const pair = crypto.generateKeyPairSync("ed25519");
  const client = {
    id: crypto.randomBytes(16).toString("hex"),
    label,
    publicKey: exportKey(pair.publicKey, "spki"),
    createdAt: new Date().toISOString(),
  };
  const credential = {
    version: 1,
    clientId: client.id,
    label,
    privateKey: exportKey(pair.privateKey, "pkcs8"),
    publicKey: client.publicKey,
    hostPublicKey: host.publicKey,
  };
  registry.clients.push(client);
  saveRegistry(stateDir, registry);
  try {
    atomicWriteJson(output, credential);
  } catch (error) {
    registry.clients = registry.clients.filter((entry) => entry.id !== client.id);
    saveRegistry(stateDir, registry);
    throw error;
  }
  return { ...client, output, hostPublicKey: host.publicKey };
}

function listClients(stateDir = getStateDir()) {
  return loadRegistry(stateDir).clients.map(({ id, label, createdAt }) => ({ id, label, createdAt }));
}

function revokeClient(label, stateDir = getStateDir()) {
  assertSafeLabel(label);
  const registry = loadRegistry(stateDir);
  const before = registry.clients.length;
  registry.clients = registry.clients.filter((client) => client.label !== label);
  if (registry.clients.length === before) throw new Error(`remote client not found: ${label}`);
  saveRegistry(stateDir, registry);
  return { label };
}

function loadCredential(credentialPath) {
  if (typeof credentialPath !== "string" || !credentialPath) throw new Error("remote credential path is required");
  const resolved = path.resolve(credentialPath);
  assertPrivateFile(resolved);
  const value = JSON.parse(fs.readFileSync(resolved, "utf8"));
  if (value.version !== 1 || typeof value.clientId !== "string" || typeof value.label !== "string" || typeof value.publicKey !== "string" || typeof value.hostPublicKey !== "string") {
    throw new Error("remote credential is invalid");
  }
  assertClientId(value.clientId);
  assertSafeLabel(value.label);
  const privateKey = importPrivateKey(value.privateKey);
  const publicKey = importPublicKey(value.publicKey);
  importPublicKey(value.hostPublicKey);
  return { ...value, path: resolved, privateKey, publicKeyObject: publicKey };
}

function canonicalTranscript(role, clientId, clientNonce, serverNonce, clientPublicKey, hostPublicKey) {
  assertClientId(clientId);
  for (const [name, value] of [["clientNonce", clientNonce], ["serverNonce", serverNonce], ["clientPublicKey", clientPublicKey], ["hostPublicKey", hostPublicKey]]) {
    if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error(`${name} is invalid`);
  }
  if (role !== "server" && role !== "client") throw new Error("authentication role is invalid");
  return Buffer.from([AUTH_DOMAIN, String(PROTOCOL_VERSION), role, clientId, clientNonce, serverNonce, clientPublicKey, hostPublicKey].join("\0"), "utf8");
}

function verifySignature(publicKey, data, signature) {
  return crypto.verify(null, data, publicKey, Buffer.from(signature, "base64"));
}

function signChallenge(host, clientId, clientNonce, serverNonce, clientPublicKey) {
  const data = canonicalTranscript("server", clientId, clientNonce, serverNonce, clientPublicKey, host.publicKey);
  return crypto.sign(null, data, host.privateKey).toString("base64");
}

function signProof(credential, clientNonce, serverNonce) {
  const data = canonicalTranscript("client", credential.clientId, clientNonce, serverNonce, credential.publicKey, credential.hostPublicKey);
  return crypto.sign(null, data, credential.privateKey).toString("base64");
}

function verifyChallenge(credential, challenge) {
  if (challenge.version !== PROTOCOL_VERSION || challenge.clientId !== credential.clientId || challenge.hostPublicKey !== credential.hostPublicKey) return false;
  const data = canonicalTranscript("server", credential.clientId, challenge.clientNonce, challenge.serverNonce, credential.publicKey, credential.hostPublicKey);
  return verifySignature(importPublicKey(credential.hostPublicKey), data, challenge.signature);
}

function verifyProof(client, hostPublicKey, clientNonce, serverNonce, proof) {
  const data = canonicalTranscript("client", client.id, clientNonce, serverNonce, client.publicKey, hostPublicKey);
  return verifySignature(importPublicKey(client.publicKey), data, proof);
}

module.exports = {
  AUTH_DOMAIN,
  CLIENT_ID_PATTERN,
  LABEL_PATTERN,
  NONCE_BYTES,
  PROTOCOL_VERSION,
  STATE_DIR_MODE,
  STATE_FILE_MODE,
  authorizeClient,
  canonicalTranscript,
  ensureHostIdentity,
  getStateDir,
  listClients,
  loadCredential,
  loadHostIdentity,
  loadRegistry,
  revokeClient,
  signChallenge,
  signProof,
  statePaths,
  verifyChallenge,
  verifyProof,
  importPublicKey,
};
