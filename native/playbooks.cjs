const fs = require("fs");
const os = require("os");
const path = require("path");
const { atomicWriteJson } = require("./private-state.cjs");
const { validateApiSpec } = require("./api-harvest.cjs");
const { validateCollectSpec } = require("./dom-collect.cjs");
const { validateExtract } = require("./op-extract.cjs");
const { validateMarkdownSpec } = require("./record-format.cjs");
const { assertNoEmbeddedSecrets, assertUrlHasNoEmbeddedSecrets } = require("./redaction.cjs");
const { commandMetadata, normalizeStep, parseDoCommands } = require("./workflow-definition.cjs");

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

function validateServerIdempotency(value, opId) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`write op ${opId} serverIdempotency must declare a header, query, or body field`);
  }
  const result = {};
  for (const key of ["header", "query", "body"]) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "string" || !value[key] || /[\r\n]/.test(value[key])) {
      throw new Error(`write op ${opId} serverIdempotency.${key} must be a string`);
    }
    result[key] = value[key];
  }
  if (Object.keys(result).length === 0) {
    throw new Error(`write op ${opId} serverIdempotency must declare a header, query, or body field`);
  }
  return result;
}

function validateWriteWorkflowSteps(steps, opId) {
  if (steps.length !== 1 || steps[0].repeat !== undefined || steps[0].each !== undefined) {
    throw new Error(`write op ${opId} workflow strategy must contain exactly one commit step`);
  }
  const metadata = commandMetadata(steps[0].cmd);
  if (metadata.effect !== "page-write") {
    throw new Error(`write op ${opId} workflow commit step must be page-write`);
  }
}

function normalizeScript(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((line) => typeof line === "string")) return value.join("\n");
  return null;
}

function validateStrategy(strategy, effect, opId) {
  if (!strategy || typeof strategy !== "object" || Array.isArray(strategy)) throw new Error("playbook strategy must be an object");
  if (strategy.using === "script") {
    if (effect === "write") throw new Error(`write op ${opId} script strategy is not supported`);
    const script = normalizeScript(strategy.script);
    if (!script?.trim()) throw new Error("script strategy requires script");
    if (strategy.timeoutMs !== undefined && (!Number.isInteger(strategy.timeoutMs) || strategy.timeoutMs < 1)) throw new Error("script strategy timeoutMs must be a positive integer");
    return { ...strategy, script };
  }
  if (strategy.using === "workflow") {
    if (!Array.isArray(strategy.steps) || strategy.steps.length === 0) throw new Error("workflow strategy requires steps");
    const steps = strategy.steps.map(normalizeStep);
    if (effect === "write") validateWriteWorkflowSteps(steps, opId);
    return { ...strategy, steps };
  }
  if (strategy.using === "network") {
    const request = strategy.request;
    if (!request || typeof request !== "object" || typeof request.url !== "string") throw new Error("network strategy requires request.url");
    const method = String(request.method || "GET").toUpperCase();
    if (effect === "read" && !["GET", "HEAD", "OPTIONS", "POST"].includes(method)) throw new Error("read ops cannot use a mutating network method");
    assertUrlHasNoEmbeddedSecrets(request.url);
    assertNoEmbeddedSecrets(request.headers || {});
    assertNoEmbeddedSecrets(request.query || {});
    assertNoEmbeddedSecrets(request.body);
    return { ...strategy, request: { ...request, method } };
  }
  if (strategy.using === "native") {
    if (typeof strategy.handler !== "string" || !strategy.handler) throw new Error("native strategy requires handler");
    return strategy;
  }
  if (strategy.using === "api" || strategy.using === "collect") {
    if (effect === "write") throw new Error(`write op ${opId} ${strategy.using} strategy is not supported`);
    const { using, extract: _extract, expect: _expect, verify: _verify, ...spec } = strategy;
    try {
      if (using === "api") validateApiSpec(spec);
      else validateCollectSpec(spec);
    } catch (error) {
      throw new Error(`op ${opId} ${using} strategy: ${error.message}`);
    }
    return strategy;
  }
  throw new Error(`unsupported playbook strategy: ${strategy.using}`);
}

// The op file's flat keys (README "Ops"); safety, auth, origins, markdown and provenance as for run ops.
const FLAT_KEYS = new Set(["id", "description", "effect", "args", "request", "open", "steps", "extract", "page", "expect", "chain", "safety", "auth", "origins", "markdown", "provenance"]);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function validateRequest(request, id, effect) {
  if (!isObject(request) || typeof request.url !== "string") throw new Error(`op ${id} request needs a url`);
  for (const key of ["query", "headers"]) {
    if (request[key] !== undefined && !isObject(request[key])) throw new Error(`op ${id} request.${key} must be an object`);
  }
  const method = String(request.method || "GET").toUpperCase();
  if (effect === "read" && !["GET", "HEAD", "OPTIONS", "POST"].includes(method)) throw new Error("read ops cannot use a mutating network method");
  assertUrlHasNoEmbeddedSecrets(request.url);
  assertNoEmbeddedSecrets(request.headers || {});
  assertNoEmbeddedSecrets(request.query || {});
  assertNoEmbeddedSecrets(request.body);
  return { ...request, method };
}

function validateFlatOp(value, id, effect) {
  for (const key of Object.keys(value)) if (!FLAT_KEYS.has(key)) throw new Error(`op ${id} has unknown key "${key}"`);
  const op = { ...value };
  if (value.request !== undefined) op.request = validateRequest(value.request, id, effect);
  if (value.open !== undefined && (typeof value.open !== "string" || !value.open)) throw new Error(`op ${id} open must be a URL`);
  if (value.steps !== undefined) {
    if (value.open === undefined) throw new Error(`op ${id} steps run on the page it opens, so they need open`);
    const steps = typeof value.steps === "string" ? parseDoCommands(value.steps) : value.steps;
    if (!Array.isArray(steps)) throw new Error(`op ${id} steps must be surf do steps`);
    op.steps = steps.map(normalizeStep);
  }
  validateExtract(value.extract, `op ${id} extract`);
  if (value.page !== undefined) {
    const { into, next, ...rest } = isObject(value.page) ? value.page : { next: null };
    if (typeof next !== "string" || !next || Object.keys(rest).length) throw new Error(`op ${id} page must be { into?, next }`);
    if (/^\+\d+$/.test(next) && into === undefined) throw new Error(`op ${id} page.next "${next}" adds to an input, so it needs page.into`);
    if (into !== undefined && !Object.hasOwn(value.args || {}, into)) throw new Error(`op ${id} page.into names no input: ${into}`);
  }
  if (value.expect !== undefined) {
    const { status, minItems, fields, ...rest } = isObject(value.expect) ? value.expect : { status: null };
    if (Object.keys(rest).length) throw new Error(`op ${id} expect takes status, minItems and fields`);
    for (const [name, number] of [["status", status], ["minItems", minItems]]) {
      if (number !== undefined && !Number.isInteger(number)) throw new Error(`op ${id} expect.${name} must be an integer`);
    }
    if (fields !== undefined && (!Array.isArray(fields) || !fields.every((name) => typeof name === "string"))) throw new Error(`op ${id} expect.fields must be a list of field names`);
  }
  if (value.chain !== undefined && (!Array.isArray(value.chain) || !value.chain.every((step) => isObject(step) && typeof step.id === "string" && typeof step.op === "string"))) {
    throw new Error(`op ${id} chain must be a list of { id, op } steps`);
  }
  return op;
}

function validateOp(value, manifest) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("playbook op must be an object");
  const id = assertId(value.id, "op id");
  const effect = value.effect || "read";
  if (effect !== "read" && effect !== "write") throw new Error(`op ${id} effect must be read or write`);
  const kinds = ["request", "open", "chain", "run"].filter((key) => value[key] !== undefined);
  const flat = kinds.length > 0 && !kinds.includes("run");
  if (kinds.length === 0 || (kinds.includes("run") && kinds.length > 1) || (kinds.includes("chain") && kinds.length > 1)) {
    throw new Error(`op ${id} needs one of request, open, chain or run (request and open may go together)`);
  }
  if (!flat && (!Array.isArray(value.run) || value.run.length === 0)) throw new Error(`op ${id} requires at least one strategy`);
  let safety = value.safety;
  if (effect === "write") {
    if (!value.safety || !["transactional", "repeatable-window"].includes(value.safety.duplicate)) throw new Error(`write op ${id} requires duplicate safety`);
    if (!Array.isArray(value.safety.key) || value.safety.key.length === 0) throw new Error(`write op ${id} requires a semantic safety key`);
    safety = { ...value.safety, authorization: value.safety.authorization || "explicit" };
    if (value.safety.serverIdempotency !== undefined) {
      safety.serverIdempotency = validateServerIdempotency(value.safety.serverIdempotency, id);
    }
    if (!new Set(["explicit", "implicit"]).has(safety.authorization)) throw new Error(`write op ${id} has invalid authorization`);
    if (safety.authorization === "implicit" && safety.duplicate !== "repeatable-window") {
      throw new Error(`implicit write op ${id} must use repeatable-window duplicate safety`);
    }
  }
  const auth = value.auth === undefined ? {} : value.auth;
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) throw new Error(`op ${id} auth must be an object`);
  if (value.markdown !== undefined) {
    try {
      validateMarkdownSpec(value.markdown);
    } catch (error) {
      throw new Error(`op ${id} ${error.message}`);
    }
  }
  const origins = validateOrigins(auth.origins || value.origins || manifest.origins);
  return {
    ...(flat ? validateFlatOp(value, id, effect) : value),
    id,
    args: validateArgSpecs(value.args),
    effect,
    ...(safety ? { safety } : {}),
    auth: { ...auth, origins },
    ...(flat ? {} : { run: value.run.map((strategy) => validateStrategy(strategy, effect, id)) }),
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
  // The op as written, so a saved file stays the short file a person edits; loading checks it again.
  atomicWriteJson(path.join(directory, "ops", `${validatedOp.id}.json`), op);
  return { directory, playbook: validatedManifest.id, op: validatedOp.id, scope };
}

function writePlaybookDirectory(directory, playbook) {
  if (fs.existsSync(directory)) throw new Error(`playbook output already exists: ${directory}`);
  fs.mkdirSync(path.join(directory, "ops"), { recursive: true });
  const { directory: _directory, provenance: _provenance, ops, ...manifest } = playbook;
  atomicWriteJson(path.join(directory, "playbook.json"), manifest);
  for (const op of ops.values()) atomicWriteJson(path.join(directory, "ops", `${op.id}.json`), op);
}

function exportPlaybookDirectory(playbookId, { out, cwd = process.cwd(), home = os.homedir() } = {}) {
  if (typeof out !== "string" || !out) throw new Error("playbook export requires --out <directory>");
  const playbook = resolvePlaybook(playbookId, { cwd, home });
  const directory = path.resolve(out);
  writePlaybookDirectory(directory, playbook);
  return { playbook: playbook.id, directory };
}

function importPlaybookDirectory(source, { scope = "user", cwd = process.cwd(), home = os.homedir() } = {}) {
  if (scope !== "user" && scope !== "project") throw new Error("playbook import scope must be user or project");
  if (typeof source !== "string" || !source) throw new Error("playbook import requires a directory");
  const playbook = loadPlaybookDirectory(path.resolve(source), "import");
  const base = playbookDirs({ cwd, home }).find((entry) => entry.scope === scope).path;
  const directory = path.join(base, playbook.id);
  writePlaybookDirectory(directory, playbook);
  return { playbook: playbook.id, directory, scope };
}

module.exports = {
  exportPlaybookDirectory,
  importPlaybookDirectory,
  listPlaybooks,
  resolveOp,
  resolvePlaybook,
  savePlaybook,
  validateOp,
};
