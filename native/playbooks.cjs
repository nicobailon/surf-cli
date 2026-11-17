const fs = require("fs");
const os = require("os");
const path = require("path");
const { atomicWriteJson } = require("./private-state.cjs");
const { validateApiSpec } = require("./api-harvest.cjs");
const { parseHtmlExtract, validateCollectSpec } = require("./dom-collect.cjs");
const { ASSERTION_LIMIT, validateAssertions } = require("./playbook-assertions.cjs");
const { validateExtract } = require("./playbook-extract.cjs");
const { validateMarkdownSpec } = require("./record-format.cjs");
const { assertNoEmbeddedSecrets, assertUrlHasNoEmbeddedSecrets } = require("./redaction.cjs");
const { READ_OP_METHODS } = require("./request-kinds.cjs");
const { normalizeStep } = require("./workflow-definition.cjs");
const { compileJsonPath, getPath } = require("./records.cjs");

const BUILTIN_DIR = path.join(__dirname, "..", "playbooks");
const PINNED_BUILTINS = new Set(["chatgpt", "aistudio", "x"]);
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ARG_TYPES = new Set(["string", "number", "boolean"]);
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

// `request.authInputs`: headers whose value comes from an environment variable at run time.
function validateAuthInputs(inputs, headers = {}) {
  if (inputs === undefined) return;
  if (!Array.isArray(inputs)) throw new Error("network request authInputs must be an array");
  const seen = new Set();
  for (const input of inputs) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("network request authInputs entries must be objects");
    if (typeof input.env !== "string" || !ENV_NAME_PATTERN.test(input.env)) throw new Error(`auth input env must be an environment variable name: ${input.env}`);
    if (typeof input.header !== "string" || !HEADER_NAME_PATTERN.test(input.header)) throw new Error(`auth input header must be a header name: ${input.header}`);
    if (input.required !== undefined && typeof input.required !== "boolean") throw new Error("auth input required must be true or false");
    const lower = input.header.toLowerCase();
    if (seen.has(lower)) throw new Error(`network request has two auth inputs for the ${input.header} header`);
    seen.add(lower);
    if (Object.keys(headers || {}).some((name) => name.toLowerCase() === lower)) throw new Error(`auth input ${input.env} also has a literal ${input.header} header`);
  }
}

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
    if (spec.type !== undefined && !ARG_TYPES.has(spec.type)) throw new Error(`argument ${name} type must be string, number or boolean`);
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

function normalizeScript(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((line) => typeof line === "string")) return value.join("\n");
  return null;
}

function validateStrategy(strategy, effect, opId) {
  if (!strategy || typeof strategy !== "object" || Array.isArray(strategy)) throw new Error("playbook strategy must be an object");
  if (strategy.extract !== undefined) {
    try {
      validateExtract(strategy.extract, strategy.using);
    } catch (error) {
      throw new Error(`op ${opId} extract: ${error.message}`);
    }
  }
  if (strategy.using === "script") {
    if (effect === "write") throw new Error(`write op ${opId} script strategy is not supported`);
    const script = normalizeScript(strategy.script);
    if (!script?.trim()) throw new Error("script strategy requires script");
    if (strategy.timeoutMs !== undefined && (!Number.isInteger(strategy.timeoutMs) || strategy.timeoutMs < 1)) throw new Error("script strategy timeoutMs must be a positive integer");
    return { ...strategy, script };
  }
  if (strategy.using === "workflow") {
    if (!Array.isArray(strategy.steps) || strategy.steps.length === 0) throw new Error("workflow strategy requires steps");
    return { ...strategy, steps: strategy.steps.map(normalizeStep) };
  }
  if (strategy.using === "network") {
    const request = strategy.request;
    if (!request || typeof request !== "object" || typeof request.url !== "string") throw new Error("network strategy requires request.url");
    const method = String(request.method || "GET").toUpperCase();
    if (effect === "read" && !READ_OP_METHODS.has(method)) throw new Error("read ops cannot use a mutating network method");
    assertUrlHasNoEmbeddedSecrets(request.url);
    assertNoEmbeddedSecrets(request.headers || {});
    assertNoEmbeddedSecrets(request.query || {});
    assertNoEmbeddedSecrets(request.body);
    validateAuthInputs(request.authInputs, request.headers);
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

// A chain op's bounds. `each` runs a step once per record of an earlier step: at most `eachMax`
// records (`eachLimit` when unset), `delayMs` apart. `page` runs a step again for its next page: at
// most `pageMax` pages (`pageLimit` when unset), `delayMs` apart. One chain run calls at most `runs` ops.
const CHAIN_LIMITS = Object.freeze({ steps: 10, eachLimit: 5, eachMax: 50, pageLimit: 3, pageMax: 20, delayMs: 2000, delayMax: 60000, runs: 100 });
const CHAIN_STEP_KEYS = ["id", "op", "with", "each", "page"];
const BINDING_KEYS = ["from", "path", "segment"];
const EACH_KEYS = ["from", "limit", "delayMs"];
const PAGE_KEYS = ["into", "next", "max", "delayMs"];
const NEXT_KEYS = ["path", "html", "segment"];
const TEMPLATE = /\{\{([a-zA-Z0-9._-]+)\}\}/g;
const WRITES_LATER = "chains with write steps come later";

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function checkKeys(value, allowed, where) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${where} has unknown key ${key} (allowed: ${allowed.join(", ")})`);
  }
}

/** A binding's path into a record or a step's value: `$`-JSON path (`$.data.id`) or a record path (`url`, `links[0].href`). */
function compileBindingPath(path) {
  return path.startsWith("$") ? compileJsonPath(path, "binding path") : (value) => getPath(value, path);
}

// An each or page bound (`name`, such as each.limit): an integer in [min, max], or a `{{input}}` the run fills.
function checkBound(value, { min, max, name, where }) {
  if (typeof value === "string" && /^\{\{[a-zA-Z0-9._-]+\}\}$/.test(value)) return;
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${where} ${name} must be an integer from ${min} to ${max}, or {{input}}`);
}

// A step's page.next: "increment", or where in each page's response the next value is.
function checkPageNext(next, where) {
  const usage = `${where} page.next must be "increment", { path } or { html }`;
  if (next === "increment") return;
  if (!isObject(next)) throw new Error(usage);
  checkKeys(next, NEXT_KEYS, `${where} page.next`);
  if (next.path !== undefined && next.html !== undefined) throw new Error(`${where} page.next takes path or html, not both`);
  if (next.path !== undefined) {
    if (typeof next.path !== "string" || !next.path) throw new Error(`${where} page.next path must be a string`);
    try {
      compileBindingPath(next.path);
    } catch (error) {
      throw new Error(`${where} page.next: ${error.message}`);
    }
  } else if (next.html !== undefined) {
    const html = `${where} page.next html must be one selector[@attribute], such as li.next a@href`;
    if (typeof next.html !== "string" || next.html.endsWith("[]")) throw new Error(html);
    try {
      parseHtmlExtract({ value: next.html });
    } catch (error) {
      throw new Error(`${html}: ${error.message}`);
    }
  } else throw new Error(usage);
  if (next.segment !== undefined && (!Number.isInteger(next.segment) || next.segment < 1)) {
    throw new Error(`${where} page.next segment must be a URL path segment number from 1`);
  }
}

/**
 * A chain op's own shape: its steps, bindings and output. Which ops its steps name, what they take
 * and whether they write needs the whole playbook: checkChainOps.
 */
function validateChainOp(value, id, effect) {
  const where = `chain ${id}`;
  if (value.run !== undefined) throw new Error(`op ${id} has both run and chain`);
  if (effect !== "read") throw new Error(`${where}: ${WRITES_LATER}`);
  if (!Array.isArray(value.chain) || value.chain.length === 0) throw new Error(`${where} needs at least one step`);
  if (value.chain.length > CHAIN_LIMITS.steps) throw new Error(`${where} has ${value.chain.length} steps; a chain takes at most ${CHAIN_LIMITS.steps}`);
  const args = validateArgSpecs(value.args);
  const all = new Set(value.chain.map((step) => step?.id));
  const earlier = new Set();
  const source = (from, stepId, what) => {
    if (typeof from !== "string") throw new Error(`${where} step ${stepId} ${what} needs from: a step id or item`);
    if (from === stepId) throw new Error(`${where} step ${stepId} ${what} itself`);
    if (earlier.has(from)) return;
    if (all.has(from)) throw new Error(`${where} step ${stepId} ${what} step ${from}, which comes later`);
    throw new Error(`${where} step ${stepId} ${what} ${from}, which is no step`);
  };
  const templates = (text, stepId) => {
    for (const [, name] of text.matchAll(TEMPLATE)) {
      if (!Object.hasOwn(args, name)) throw new Error(`${where} step ${stepId} uses {{${name}}}, which is no input of the chain`);
    }
  };
  for (const step of value.chain) {
    if (!isObject(step)) throw new Error(`${where} steps must be objects`);
    const stepId = assertId(step.id, `${where} step id`);
    if (stepId === "item") throw new Error(`${where}: item is a binding source, not a step id`);
    if (earlier.has(stepId)) throw new Error(`${where} has two steps named ${stepId}`);
    checkKeys(step, CHAIN_STEP_KEYS, `${where} step ${stepId}`);
    assertId(step.op, `${where} step ${stepId} op`);
    if (step.each !== undefined) {
      if (!isObject(step.each)) throw new Error(`${where} step ${stepId} each must be an object`);
      checkKeys(step.each, EACH_KEYS, `${where} step ${stepId} each`);
      if (step.each.from === "item") throw new Error(`${where} step ${stepId} each.from must be an earlier step`);
      source(step.each.from, stepId, "runs each over");
      if (step.each.limit !== undefined) checkBound(step.each.limit, { min: 1, max: CHAIN_LIMITS.eachMax, name: "each.limit", where: `${where} step ${stepId}` });
      if (step.each.delayMs !== undefined) checkBound(step.each.delayMs, { min: 0, max: CHAIN_LIMITS.delayMax, name: "each.delayMs", where: `${where} step ${stepId}` });
      for (const bound of [step.each.limit, step.each.delayMs]) if (typeof bound === "string") templates(bound, stepId);
    }
    if (step.page !== undefined) {
      const at = `${where} step ${stepId}`;
      if (step.each !== undefined) throw new Error(`${at} takes each or page, not both`);
      if (!isObject(step.page)) throw new Error(`${at} page must be an object`);
      checkKeys(step.page, PAGE_KEYS, `${at} page`);
      if (typeof step.page.into !== "string" || !step.page.into) throw new Error(`${at} page.into must be an input name of ${step.op}`);
      checkPageNext(step.page.next, at);
      if (step.page.max !== undefined) checkBound(step.page.max, { min: 1, max: CHAIN_LIMITS.pageMax, name: "page.max", where: at });
      if (step.page.delayMs !== undefined) checkBound(step.page.delayMs, { min: 0, max: CHAIN_LIMITS.delayMax, name: "page.delayMs", where: at });
      for (const bound of [step.page.max, step.page.delayMs]) if (typeof bound === "string") templates(bound, stepId);
    }
    if (step.with !== undefined && !isObject(step.with)) throw new Error(`${where} step ${stepId} with must be an object`);
    for (const [input, binding] of Object.entries(step.with || {})) {
      assertId(input, `${where} step ${stepId} input name`);
      if (typeof binding === "string") templates(binding, stepId);
      else if (isObject(binding)) {
        checkKeys(binding, BINDING_KEYS, `${where} step ${stepId} binding ${input}`);
        if (binding.from === "item") {
          if (step.each === undefined) throw new Error(`${where} step ${stepId} binds ${input} from item, which only a step with each has`);
        } else source(binding.from, stepId, `binds ${input} from`);
        if (binding.path !== undefined) {
          if (typeof binding.path !== "string" || !binding.path) throw new Error(`${where} step ${stepId} binding ${input} path must be a string`);
          try {
            compileBindingPath(binding.path);
          } catch (error) {
            throw new Error(`${where} step ${stepId} binding ${input}: ${error.message}`);
          }
        }
        if (binding.segment !== undefined && (!Number.isInteger(binding.segment) || binding.segment < 1)) {
          throw new Error(`${where} step ${stepId} binding ${input} segment must be a URL path segment number from 1`);
        }
      } else if (typeof binding !== "number" && typeof binding !== "boolean") {
        throw new Error(`${where} step ${stepId} input ${input} must be text, a number, true or false, or a binding { from, path?, segment? }`);
      }
    }
    earlier.add(stepId);
  }
  if (typeof value.output !== "string" || !all.has(value.output)) throw new Error(`${where} output ${value.output} is no step`);
  if (value.markdown !== undefined) {
    try {
      validateMarkdownSpec(value.markdown);
    } catch (error) {
      throw new Error(`op ${id} ${error.message}`);
    }
  }
  return { ...value, id, effect, args };
}

/**
 * Checks each chain op against the playbook's ops: every step names one of them, passes only
 * inputs it takes and reads (chains with write steps come later), and no chain runs itself.
 */
function checkChainOps(ops, playbookId) {
  for (const op of ops.values()) {
    if (!op.chain) continue;
    for (const step of op.chain) {
      const target = ops.get(step.op);
      if (!target) throw new Error(`chain ${op.id} step ${step.id} names op ${step.op}, which playbook ${playbookId} doesn't have`);
      if (target.effect === "write") throw new Error(`chain ${op.id} step ${step.id} runs write op ${step.op}; ${WRITES_LATER}`);
      for (const input of Object.keys(step.with || {})) {
        if (!Object.hasOwn(target.args || {}, input)) throw new Error(`chain ${op.id} step ${step.id} passes --${input}, which ${step.op} doesn't take`);
      }
      if (step.page === undefined) continue;
      if (!Object.hasOwn(target.args || {}, step.page.into)) throw new Error(`chain ${op.id} step ${step.id} pages into --${step.page.into}, which ${step.op} doesn't take`);
      if (target.chain && step.page.next !== "increment") {
        throw new Error(`chain ${op.id} step ${step.id} reads page.next from ${step.op}'s response, but ${step.op} is a chain; use "increment"`);
      }
    }
  }
  const done = new Set();
  const visiting = [];
  const visit = (op) => {
    if (done.has(op.id) || !op.chain) return;
    const at = visiting.indexOf(op.id);
    if (at !== -1) throw new Error(`chain ${op.id} runs itself: ${[...visiting.slice(at), op.id].join(" → ")}`);
    visiting.push(op.id);
    for (const step of op.chain) visit(ops.get(step.op));
    visiting.pop();
    done.add(op.id);
  };
  for (const op of ops.values()) visit(op);
}

function validateOp(value, manifest) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("playbook op must be an object");
  const id = assertId(value.id, "op id");
  const effect = value.effect || "read";
  if (effect !== "read" && effect !== "write") throw new Error(`op ${id} effect must be read or write`);
  if (value.chain !== undefined) return validateChainOp(value, id, effect);
  if (!Array.isArray(value.run) || value.run.length === 0) throw new Error(`op ${id} requires at least one strategy`);
  let safety = value.safety;
  if (effect === "write") {
    if (!value.safety || !["transactional", "repeatable-window"].includes(value.safety.duplicate)) throw new Error(`write op ${id} requires duplicate safety`);
    // Without a key, the duplicate claim covers every input.
    if (value.safety.key !== undefined && (!Array.isArray(value.safety.key) || value.safety.key.length === 0)) {
      throw new Error(`write op ${id} safety key must list inputs; leave it out to cover every input`);
    }
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
  // Assertions run from on.success.expect.assert and from a strategy's own verify.assert or
  // expect.assert. Each list is checked, and an op holds at most ASSERTION_LIMIT across them all.
  const assertionLists = [
    [`op ${id} on.success.expect.assert`, value.on?.success?.expect?.assert],
    ...value.run.flatMap((strategy) => ["verify", "expect"].map((key) => [`op ${id} ${strategy?.using} strategy ${key}.assert`, strategy?.[key]?.assert])),
  ].filter(([, list]) => list !== undefined);
  for (const [where, list] of assertionLists) {
    try {
      validateAssertions(list);
    } catch (error) {
      throw new Error(`${where}: ${error.message}`);
    }
  }
  const assertionCount = assertionLists.reduce((sum, [, list]) => sum + list.length, 0);
  if (assertionCount > ASSERTION_LIMIT) {
    throw new Error(`op ${id}: at most ${ASSERTION_LIMIT} assertions per op across all its strategies and on.success (got ${assertionCount})`);
  }
  const origins = validateOrigins(auth.origins || value.origins || manifest.origins);
  return {
    ...value,
    id,
    args: validateArgSpecs(value.args),
    effect,
    ...(safety ? { safety } : {}),
    auth: { ...auth, origins },
    run: value.run.map((strategy) => validateStrategy(strategy, effect, id)),
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
  checkChainOps(ops, id);
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

// The headers, in lower case, that any saved op reads from the environment (request.authInputs),
// so an export can redact them. Reads op files as they are: an op that wouldn't load still counts.
function envBackedHeaders(options = {}) {
  const headers = new Set();
  for (const entry of playbookDirs(options)) {
    if (!fs.existsSync(entry.path)) continue;
    for (const name of fs.readdirSync(entry.path)) {
      const opsDir = path.join(entry.path, name, "ops");
      if (!fs.existsSync(opsDir)) continue;
      for (const file of fs.readdirSync(opsDir).filter((file) => file.endsWith(".json"))) {
        let op;
        try {
          op = JSON.parse(fs.readFileSync(path.join(opsDir, file), "utf8"));
        } catch {
          continue;
        }
        for (const strategy of Array.isArray(op?.run) ? op.run : []) {
          for (const input of Array.isArray(strategy?.request?.authInputs) ? strategy.request.authInputs : []) {
            if (typeof input?.header === "string") headers.add(input.header.toLowerCase());
          }
        }
      }
    }
  }
  return [...headers];
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
  atomicWriteJson(path.join(directory, "ops", `${validatedOp.id}.json`), validatedOp);
  return { directory, playbook: validatedManifest.id, op: validatedOp.id, scope };
}

/** The playbook, if it is a user or project one that edits can be saved to. */
function resolveEditablePlaybook(playbookId, options) {
  const playbook = resolvePlaybook(playbookId, options);
  const { scope } = playbook.provenance;
  if (scope !== "user" && scope !== "project") {
    throw new Error(`${scope} playbook ${playbook.id} can't be edited; copy it first: surf pb export ${playbook.id} --out <dir>, then surf pb import <dir>`);
  }
  return playbook;
}

/**
 * The one way an op file is edited (pb param, pb extract, pb test --save): `edit(raw, playbook)` gets
 * the op as written on disk (not normalized) and returns the new op, which is saved through
 * savePlaybook, or null to leave the file alone. Returns the file and its text before and after.
 */
function editSavedOp({ playbook: playbookId, op: opId, edit, cwd = process.cwd(), home = os.homedir() }) {
  const playbook = resolveEditablePlaybook(playbookId, { cwd, home });
  const { scope } = playbook.provenance;
  const opsDir = path.join(playbook.directory, "ops");
  const name = fs.readdirSync(opsDir).find((file) => file.endsWith(".json") && JSON.parse(fs.readFileSync(path.join(opsDir, file), "utf8"))?.id === opId);
  if (!name) throw new Error(`Op not found: ${playbook.id} ${opId}`);
  if (name !== `${opId}.json`) throw new Error(`op ${opId} is saved as ${name}; rename it to ${opId}.json before editing it`);
  const file = path.join(opsDir, name);
  const before = fs.readFileSync(file, "utf8");
  const { directory: _directory, provenance: _provenance, ops: _ops, ...manifest } = playbook;
  const next = edit(JSON.parse(before), playbook);
  if (next === null) return { playbook: playbook.id, op: opId, scope, path: file, changed: false, before, after: before };
  savePlaybook({ manifest, op: next, scope, cwd, home });
  return { playbook: playbook.id, op: opId, scope, path: file, changed: true, before, after: fs.readFileSync(file, "utf8") };
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
  CHAIN_LIMITS,
  checkChainOps,
  compileBindingPath,
  editSavedOp,
  envBackedHeaders,
  exportPlaybookDirectory,
  importPlaybookDirectory,
  listPlaybooks,
  resolveEditablePlaybook,
  resolveOp,
  resolvePlaybook,
  savePlaybook,
  validateOp,
};
