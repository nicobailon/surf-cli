const fs = require("fs");
const { execFileSync } = require("child_process");

const DEFAULT_SOCKET_MODE = 0o600;
const ALLOWED_SOCKET_MODES = new Set([0o600, 0o660]);
const MAX_GID = 0xfffffffe;
const SOCKET_GROUP_PATTERN = /^(?:\d+|[A-Za-z_][A-Za-z0-9_.-]*)$/;

function parseSocketMode(value) {
  if (value === undefined) return DEFAULT_SOCKET_MODE;
  if (typeof value === "number" && ALLOWED_SOCKET_MODES.has(value)) return value;
  if (value === 600) return DEFAULT_SOCKET_MODE;
  if (value === 660) return 0o660;
  const text = String(value).trim();
  if (!/^0?(?:600|660)$/.test(text)) {
    throw new Error("SURF_SOCKET_MODE must be 600 or 660");
  }
  return Number.parseInt(text, 8);
}

function validateSocketGroup(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "boolean") {
    throw new Error("SURF_SOCKET_GROUP must be a numeric gid or a simple group name");
  }
  const group = String(value).trim();
  if (!SOCKET_GROUP_PATTERN.test(group)) {
    throw new Error("SURF_SOCKET_GROUP must be a numeric gid or a simple group name");
  }
  if (/^\d+$/.test(group)) {
    const gid = Number(group);
    if (!Number.isSafeInteger(gid) || gid < 0 || gid > MAX_GID) {
      throw new Error("SURF_SOCKET_GROUP gid is out of range");
    }
  }
  return group;
}

function normalizeSocketConfig(socketMode, socketGroup) {
  const mode = socketMode === undefined ? undefined : parseSocketMode(socketMode);
  const group = socketGroup === undefined ? undefined : validateSocketGroup(socketGroup);
  if (mode === 0o660 && !group) {
    throw new Error("SURF_SOCKET_MODE=660 requires SURF_SOCKET_GROUP");
  }
  return { mode, group };
}

function resolveSocketGroup(value) {
  const group = validateSocketGroup(value);
  if (group === undefined) return undefined;
  if (/^\d+$/.test(group)) return Number(group);

  const command = process.platform === "darwin" ? "dscl" : "getent";
  const args = process.platform === "darwin"
    ? [".", "-read", `/Groups/${group}`, "PrimaryGroupID"]
    : ["group", group];
  let output;
  try {
    output = execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    throw new Error(`could not resolve socket group ${group}: ${error.message}`);
  }
  const match = process.platform === "darwin"
    ? output.match(/\bPrimaryGroupID:\s*(\d+)\b/)
    : output.trim().split(/\r?\n/, 1)[0]?.split(":")[2]?.match(/^\d+$/);
  const gid = Number(match?.[1] || match?.[0]);
  if (!Number.isSafeInteger(gid) || gid < 0 || gid > MAX_GID) {
    throw new Error(`could not resolve socket group ${group}`);
  }
  return gid;
}

function resolveSocketPermissions(socketMode, socketGroup) {
  const config = normalizeSocketConfig(socketMode, socketGroup);
  const mode = config.mode ?? DEFAULT_SOCKET_MODE;
  const gid = resolveSocketGroup(config.group);
  return { mode, group: config.group, gid };
}

function assertSocketPath(socketPath) {
  let stat;
  try {
    stat = fs.lstatSync(socketPath);
  } catch (error) {
    throw new Error(`could not inspect local socket: ${error.message}`);
  }
  if (stat.isSymbolicLink()) throw new Error("refusing symbolic-link local socket");
  if (!stat.isSocket()) throw new Error("local socket path is not a Unix socket");
  return stat;
}

function applySocketPermissions(socketPath, permissions) {
  const before = assertSocketPath(socketPath);
  if (permissions.gid !== undefined) {
    fs.chownSync(socketPath, before.uid, permissions.gid);
  }
  fs.chmodSync(socketPath, permissions.mode);
  const after = assertSocketPath(socketPath);
  if ((after.mode & 0o7777) !== permissions.mode) {
    throw new Error(`local socket mode is not ${permissions.mode.toString(8)}`);
  }
  if (permissions.gid !== undefined && after.gid !== permissions.gid) {
    throw new Error(`local socket group is not ${permissions.group}`);
  }
  return after;
}

module.exports = {
  applySocketPermissions,
  normalizeSocketConfig,
  parseSocketMode,
  resolveSocketPermissions,
  validateSocketGroup,
};
