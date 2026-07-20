const fs = require("fs");
const os = require("os");
const path = require("path");
const { atomicWriteJson } = require("./private-state.cjs");
const { normalizeStep } = require("./workflow-definition.cjs");

const BUILTIN_DIR = path.join(__dirname, "..", "playbooks");
const PINNED_BUILTINS = new Set(["chatgpt", "aistudio", "x"]);
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function playbookDirs({ cwd = process.cwd(), home = os.homedir() } = {}) {
  return [
    { scope: "project", path: path.join(cwd, ".surf", "playbooks") },
    { scope: "user", path: path.join(home, ".surf", "playbooks") },
    { scope: "built-in", path: BUILTIN_DIR },
  ];
}

function assertId(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new Error(`${label} must use lowercase letters, numbers, dot, underscore, or hyphen`);
  return value;
}

function validateArgSpecs(args) {
  if (args === undefined) return {};
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("playbook op args must be an object");
  for (const [name, spec] of Object.entries(args)) {
    assertId(name, "argument name");
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error(`argument ${name} must be an object`);
  }
  return args;
}

function validateOrigins(origins) {
  if (origins === undefined) return [];
  if (!Array.isArray(origins)) throw new Error("playbook origins must be an array");
  return origins.map((origin) => {
    if (typeof origin !== "string") throw new Error("playbook origins must be strings");
    let parsed;
    try { parsed = new URL(origin); } catch { throw new Error(`invalid playbook origin: ${origin}`); }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new Error(`playbook origin must be an exact HTTP(S) origin: ${origin}`);
    }
    return origin;
  });
}

function validateStrategy(strategy, effect) {
  if (!strategy || typeof strategy !== "object" || Array.isArray(strategy)) throw new Error("playbook strategy must be an object");
  if (strategy.using === "workflow") {
    if (!Array.isArray(strategy.steps) || strategy.steps.length === 0) throw new Error("workflow strategy requires steps");
    return { ...strategy, steps: strategy.steps.map(normalizeStep) };
  }
  if (strategy.using === "network") {
    const request = strategy.request;
    if (!request || typeof request !== "object" || typeof request.url !== "string") throw new Error("network strategy requires request.url");
    const method = String(request.method || "GET").toUpperCase();
    if (effect === "read" && !["GET", "HEAD", "OPTIONS"].includes(method)) throw new Error("read ops cannot use a mutating network method");
    return { ...strategy, request: { ...request, method } };
  }
  if (strategy.using === "native") {
    if (typeof strategy.handler !== "string" || !strategy.handler) throw new Error("native strategy requires handler");
    return strategy;
  }
  throw new Error(`unsupported playbook strategy: ${strategy.using}`);
}

function validateOp(value, manifest) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("playbook op must be an object");
  const id = assertId(value.id, "op id");
  const effect = value.effect || "read";
  if (effect !== "read" && effect !== "write") throw new Error(`op ${id} effect must be read or write`);
  if (!Array.isArray(value.run) || value.run.length === 0) throw new Error(`op ${id} requires at least one strategy`);
  let safety = value.safety;
  if (effect === "write") {
    if (!value.safety || !["transactional", "repeatable-window"].includes(value.safety.duplicate)) throw new Error(`write op ${id} requires duplicate safety`);
    if (!Array.isArray(value.safety.key) || value.safety.key.length === 0) throw new Error(`write op ${id} requires a semantic safety key`);
    safety = { ...value.safety, authorization: value.safety.authorization || "explicit" };
    if (!new Set(["explicit", "implicit"]).has(safety.authorization)) throw new Error(`write op ${id} has invalid authorization`);
    if (safety.authorization === "implicit" && safety.duplicate !== "repeatable-window") {
      throw new Error(`implicit write op ${id} must use repeatable-window duplicate safety`);
    }
  }
  const auth = value.auth === undefined ? {} : value.auth;
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) throw new Error(`op ${id} auth must be an object`);
  const origins = validateOrigins(auth.origins || value.origins || manifest.origins);
  return {
    ...value,
    id,
    args: validateArgSpecs(value.args),
    effect,
    ...(safety ? { safety } : {}),
    auth: { ...auth, origins },
    run: value.run.map((strategy) => validateStrategy(strategy, effect)),
    origins,
  };
}

function loadPlaybookDirectory(directory, scope) {
  const manifestPath = path.join(directory, "playbook.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const id = assertId(manifest.id, "playbook id");
  if (typeof manifest.version !== "string" || !manifest.version) throw new Error(`playbook ${id} requires version`);
  const origins = validateOrigins(manifest.origins);
  const opsDir = path.join(directory, "ops");
  const ops = new Map();
  if (!fs.existsSync(opsDir)) throw new Error(`playbook ${id} has no ops directory`);
  for (const file of fs.readdirSync(opsDir).filter((name) => name.endsWith(".json")).sort()) {
    const op = validateOp(JSON.parse(fs.readFileSync(path.join(opsDir, file), "utf8")), { ...manifest, origins });
    if (ops.has(op.id)) throw new Error(`duplicate op ${op.id} in playbook ${id}`);
    ops.set(op.id, op);
  }
  if (ops.size === 0) throw new Error(`playbook ${id} has no ops`);
  return { ...manifest, id, origins, directory, ops, provenance: { scope, path: directory, version: manifest.version } };
}

function resolvePlaybook(id, options = {}) {
  assertId(id, "playbook id");
  let dirs = playbookDirs(options);
  if (options.pinBuiltIn && PINNED_BUILTINS.has(id)) dirs = [...dirs.filter((entry) => entry.scope === "built-in"), ...dirs.filter((entry) => entry.scope !== "built-in")];
  for (const entry of dirs) {
    const directory = path.join(entry.path, id);
    if (fs.existsSync(path.join(directory, "playbook.json"))) return loadPlaybookDirectory(directory, entry.scope);
  }
  throw new Error(`Playbook not found: ${id}`);
}

function listPlaybooks(options = {}) {
  const found = new Map();
  for (const entry of playbookDirs(options)) {
    if (!fs.existsSync(entry.path)) continue;
    for (const name of fs.readdirSync(entry.path).sort()) {
      if (found.has(name) || !fs.existsSync(path.join(entry.path, name, "playbook.json"))) continue;
      try {
        const playbook = loadPlaybookDirectory(path.join(entry.path, name), entry.scope);
        found.set(name, { id: playbook.id, name: playbook.name || playbook.id, description: playbook.description || "", version: playbook.version, scope: entry.scope, ops: playbook.ops.size });
      } catch {}
    }
  }
  return [...found.values()];
}

function resolveOp(playbookId, opId, options = {}) {
  const playbook = resolvePlaybook(playbookId, options);
  const op = playbook.ops.get(opId);
  if (!op) throw new Error(`Op not found: ${playbookId} ${opId}`);
  return { playbook, op };
}

function savePlaybook({ manifest, op, scope = "user", cwd = process.cwd(), home = os.homedir() }) {
  if (scope !== "user" && scope !== "project") throw new Error("playbook save scope must be user or project");
  const validatedManifest = { ...manifest, id: assertId(manifest.id, "playbook id"), version: manifest.version || "1.0.0" };
  const validatedOp = validateOp(op, validatedManifest);
  const base = playbookDirs({ cwd, home }).find((entry) => entry.scope === scope).path;
  const directory = path.join(base, validatedManifest.id);
  fs.mkdirSync(path.join(directory, "ops"), { recursive: true });
  atomicWriteJson(path.join(directory, "playbook.json"), validatedManifest);
  atomicWriteJson(path.join(directory, "ops", `${validatedOp.id}.json`), op);
  return { directory, playbook: validatedManifest.id, op: validatedOp.id, scope };
}

module.exports = {
  listPlaybooks,
  resolveOp,
  resolvePlaybook,
  savePlaybook,
  validateOp,
};
