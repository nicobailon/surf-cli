const fs = require("fs");
const os = require("os");
const path = require("path");
const { isSensitiveName, redactSensitiveFields, redactUrlSecrets } = require("./redaction.cjs");

const COMMANDS = {
  ai: { primaryArg: "query", effect: "read", argKinds: { query: "user-input" }, sensitiveArgs: ["query"] },
  gemini: { primaryArg: "query", effect: "page-write", argKinds: { query: "user-input" }, sensitiveArgs: ["query"] },
  chatgpt: { primaryArg: "query", effect: "page-write", argKinds: { query: "user-input" }, sensitiveArgs: ["query"] },
  kimi: { primaryArg: "query", effect: "page-write", argKinds: { query: "user-input" }, sensitiveArgs: ["query"] },
  "oracle.ask": { primaryArg: "prompt", effect: "page-write", argKinds: { prompt: "user-input" }, sensitiveArgs: ["prompt"] },
  perplexity: { primaryArg: "query", effect: "page-write", argKinds: { query: "user-input" }, sensitiveArgs: ["query"] },
  grok: { primaryArg: "query", effect: "page-write", argKinds: { query: "user-input" }, sensitiveArgs: ["query"] },
  navigate: { primaryArg: "url", effect: "navigation", argKinds: { url: "url" } },
  go: { primaryArg: "url", effect: "navigation", argKinds: { url: "url" } },
  back: { effect: "navigation" },
  forward: { effect: "navigation" },
  reload: { effect: "navigation" },
  js: { primaryArg: "code", effect: "unknown", recordable: false, argKinds: { code: "code" }, sensitiveArgs: ["code"] },
  javascript_tool: { primaryArg: "code", effect: "unknown", recordable: false, argKinds: { code: "code" }, sensitiveArgs: ["code"] },
  click: { effect: "page-write", argKinds: { ref: "element-ref", selector: "selector", x: "number", y: "number" } },
  key: { primaryArg: "key", effect: "page-write", argKinds: { key: "key" } },
  submit: { effect: "page-write" },
  hover: { effect: "read", argKinds: { ref: "element-ref", selector: "selector" } },
  scroll: { effect: "page-write", argKinds: { direction: "name", scroll_pixels: "number" } },
  "scroll.top": { effect: "page-write", argKinds: { selector: "selector" } },
  "scroll.bottom": { effect: "page-write", argKinds: { selector: "selector" } },
  "scroll.info": { effect: "read", argKinds: { selector: "selector" } },
  wait: { primaryArg: "duration", effect: "read", recordable: false, argKinds: { duration: "duration" } },
  health: { primaryArg: "url", effect: "read", argKinds: { url: "url" } },
  new_tab: { primaryArg: "url", effect: "navigation", argKinds: { url: "url" } },
  "tab.new": { primaryArg: "url", effect: "navigation", argKinds: { url: "url" } },
  switch_tab: { primaryArg: "tab_id", effect: "navigation", argKinds: { tab_id: "tab-id" } },
  "tab.switch": { primaryArg: "id", effect: "navigation", argKinds: { id: "tab-id" } },
  close_tab: { primaryArg: "tab_id", effect: "page-write", argKinds: { tab_id: "tab-id" } },
  "tab.close": { primaryArg: "id", effect: "page-write", argKinds: { id: "tab-id" } },
  "tab.name": { primaryArg: "name", effect: "page-write", argKinds: { name: "name" } },
  "tab.unname": { primaryArg: "name", effect: "page-write", argKinds: { name: "name" } },
  "session.new": { primaryArg: "name", effect: "navigation", recordable: false, argKinds: { name: "name", url: "url" } },
  "session.ensure": { primaryArg: "name", effect: "navigation", recordable: false, argKinds: { name: "name", url: "url" } },
  "session.list": { effect: "read", recordable: false },
  "session.info": { primaryArg: "name", effect: "read", recordable: false, argKinds: { name: "name" } },
  "session.cleanup": { effect: "page-write", recordable: false, argKinds: { "idle-after": "duration" } },
  "session.close": { primaryArg: "name", effect: "page-write", recordable: false, argKinds: { name: "name" } },
  "session.rebind": { primaryArg: "name", effect: "page-write", recordable: false, argKinds: { name: "name", tabId: "tab-id" } },
  "session.reopen": { primaryArg: "name", effect: "navigation", recordable: false, argKinds: { name: "name", url: "url" } },
  scroll_to_position: { primaryArg: "position", effect: "page-write", argKinds: { position: "position" } },
  type: { primaryArg: "text", effect: "page-write", argKinds: { selector: "selector", text: "user-input" }, sensitiveArgs: ["text"] },
  smart_type: { primaryArg: "text", effect: "page-write", argKinds: { selector: "selector", text: "user-input" }, sensitiveArgs: ["text"] },
  find_and_type: { effect: "page-write", argKinds: { text: "user-input" }, sensitiveArgs: ["text"] },
  form_input: { effect: "page-write", argKinds: { value: "user-input" }, sensitiveArgs: ["value"] },
  "cookie.set": { effect: "page-write", argKinds: { value: "secret" }, sensitiveArgs: ["value"] },
  "emulate.network": { primaryArg: "preset", effect: "page-write", argKinds: { preset: "name" } },
  "emulate.cpu": { primaryArg: "rate", effect: "page-write", argKinds: { rate: "number" } },
  search: { primaryArg: "term", effect: "read", argKinds: { term: "user-input" }, sensitiveArgs: ["term"] },
  "wait.element": { primaryArg: "selector", effect: "read", recordable: false, argKinds: { selector: "selector" } },
  "wait.url": { primaryArg: "pattern", effect: "read", recordable: false, argKinds: { pattern: "url-pattern" } },
  zoom: { primaryArg: "level", effect: "page-write", argKinds: { level: "number" } },
  "history.search": { primaryArg: "query", effect: "read", argKinds: { query: "user-input" }, sensitiveArgs: ["query"] },
  "network.get": { primaryArg: "id", effect: "read", argKinds: { id: "request-id" } },
  "network.body": { primaryArg: "id", effect: "read", argKinds: { id: "request-id" } },
  "network.curl": { primaryArg: "id", effect: "read", argKinds: { id: "request-id" } },
  "network.path": { primaryArg: "id", effect: "read", argKinds: { id: "request-id" } },
  "page.read": { effect: "read" },
  "page.text": { effect: "read" },
  "page.state": { effect: "read" },
  screenshot: { effect: "read" },
  "video.start": { primaryArg: "output", effect: "read", recordable: false },
  "video.stop": { effect: "read", recordable: false },
  "video.status": { effect: "read", recordable: false },
  "video.restart": { primaryArg: "output", effect: "read", recordable: false },
  "window.new": { primaryArg: "url", effect: "navigation", argKinds: { url: "url" } },
  "window.focus": { primaryArg: "id", effect: "navigation", argKinds: { id: "window-id" } },
  "window.close": { primaryArg: "id", effect: "page-write", argKinds: { id: "window-id" } },
  "locate.role": { primaryArg: "role", effect: "read", argKinds: { role: "role" } },
  "locate.text": { primaryArg: "text", effect: "read", argKinds: { text: "user-input" }, sensitiveArgs: ["text"] },
  "locate.label": { primaryArg: "label", effect: "read", argKinds: { label: "user-input" }, sensitiveArgs: ["label"] },
  "emulate.device": { primaryArg: "device", effect: "page-write", argKinds: { device: "name" } },
  "frame.js": { primaryArg: "code", effect: "unknown", recordable: false, argKinds: { code: "code" }, sensitiveArgs: ["code"] },
  "element.styles": { primaryArg: "selector", effect: "read", argKinds: { selector: "selector" } },
  select: { primaryArg: "selector", effect: "page-write", argKinds: { selector: "selector", values: "user-input" }, sensitiveArgs: ["values"] },
  "form.fill": { effect: "page-write", argKinds: { data: "user-input" }, sensitiveArgs: ["data"] },
  "dialog.accept": { effect: "page-write", argKinds: { text: "user-input" }, sensitiveArgs: ["text"] },
  "dialog.dismiss": { effect: "page-write" },
  "dialog.info": { effect: "read" },
};

const ALIASES = {
  snap: "screenshot",
  read: "page.read",
  find: "search",
  go: "navigate",
  net: "network",
  "network.dump": "network.get",
};

const PRIMARY_ARG_MAP = Object.fromEntries(
  Object.entries(COMMANDS).filter(([, value]) => value.primaryArg).map(([name, value]) => [name, value.primaryArg]),
);
PRIMARY_ARG_MAP.go = "url";
PRIMARY_ARG_MAP.find = "term";

function commandMetadata(command) {
  const name = ALIASES[command] || command;
  const metadata = COMMANDS[name];
  return {
    name,
    primaryArg: metadata?.primaryArg,
    effect: metadata?.effect || "unknown",
    recordable: Boolean(metadata) && metadata.recordable !== false,
    argKinds: metadata?.argKinds || {},
    sensitiveArgs: metadata?.sensitiveArgs || [],
  };
}

function redactCommandArgs(command, args, includeInputValues = false) {
  const metadata = commandMetadata(command);
  const redacted = redactSensitiveFields({ ...(args || {}) });
  for (const name of metadata.sensitiveArgs) {
    if (!includeInputValues && Object.hasOwn(redacted, name)) redacted[name] = `<${name}>`;
  }
  for (const [name, kind] of Object.entries(metadata.argKinds)) {
    if (kind === "url" && Object.hasOwn(redacted, name)) redacted[name] = redactUrlSecrets(redacted[name]);
  }
  for (const name of Object.keys(redacted)) {
    if (isSensitiveName(name)) redacted[name] = "<redacted>";
  }
  return redacted;
}

function templateRedactedArgs(value, args = {}) {
  if (typeof value === "string") {
    const match = value.match(/^<([a-z0-9._-]+)>$/);
    if (!match) return value;
    args[match[1]] = { required: true, desc: `Recorded ${match[1]}` };
    return `{{${match[1]}}}`;
  }
  if (Array.isArray(value)) return value.map((item) => templateRedactedArgs(item, args));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, templateRedactedArgs(item, args)]));
  }
  return value;
}

function promoteRedactedStepArgs(steps) {
  const args = {};
  return {
    args,
    steps: steps.map((step) => ({ ...step, args: templateRedactedArgs(step.args || {}, args) })),
  };
}

function tokenize(line) {
  const tokens = [];
  let current = "";
  let inQuote = null;
  for (const ch of line) {
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") inQuote = ch;
    else if (ch === " " || ch === "\t") {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

function coerceValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return Number.parseFloat(value);
  return value;
}

function parseCommandLine(line) {
  const tokens = tokenize(line);
  if (tokens.length === 0) return null;
  let cmd = ALIASES[tokens[0]] || tokens[0];
  const args = {};
  let i = 1;
  if (i < tokens.length && !tokens[i].startsWith("--")) {
    const firstArg = tokens[i];
    if (cmd === "click") {
      if (/^e\d+$/.test(firstArg)) {
        args.ref = firstArg;
        i++;
      } else if (/^\d+$/.test(firstArg) && /^\d+$/.test(tokens[i + 1] || "")) {
        args.x = Number.parseInt(firstArg, 10);
        args.y = Number.parseInt(tokens[i + 1], 10);
        i += 2;
      }
    } else if (cmd === "select") {
      args.selector = firstArg;
      i++;
      const values = [];
      while (i < tokens.length && !tokens[i].startsWith("--")) values.push(tokens[i++]);
      if (values.length === 1) args.values = values[0];
      else if (values.length > 1) args.values = values;
    } else if (cmd === "scroll") {
      if (firstArg === "top" || firstArg === "bottom") {
        cmd = `scroll.${firstArg}`;
        i++;
      } else if (["up", "down", "left", "right"].includes(firstArg)) {
        args.direction = firstArg;
        i++;
        if (/^-?\d+$/.test(tokens[i] || "")) args.scroll_pixels = Number.parseInt(tokens[i++], 10);
      }
    } else {
      const primaryKey = PRIMARY_ARG_MAP[cmd];
      if (primaryKey) {
        args[primaryKey] = firstArg;
        i++;
      }
    }
  }
  while (i < tokens.length) {
    const token = tokens[i];
    if (!token.startsWith("--")) {
      i++;
      continue;
    }
    const key = token.slice(2);
    const next = tokens[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = coerceValue(next);
      i += 2;
    } else {
      args[key] = true;
      i++;
    }
  }
  return { cmd, args };
}

function parseDoCommands(input) {
  const hasPipe = input.includes("|");
  const normalized = hasPipe ? input : input.replace(/\\n/g, "\n");
  return normalized
    .split(hasPipe ? "|" : "\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map(parseCommandLine)
    .filter(Boolean);
}

function getWorkflowDirs({ cwd = process.cwd(), home = os.homedir() } = {}) {
  return [
    { path: path.join(cwd, ".surf", "workflows"), scope: "project" },
    { path: path.join(home, ".surf", "workflows"), scope: "user" },
  ];
}

function resolveWorkflow(nameOrPath, options = {}) {
  if (nameOrPath.includes("|")) return { type: "inline", content: nameOrPath };
  if (nameOrPath.includes("/") || nameOrPath.includes("\\") || nameOrPath.endsWith(".json")) {
    return fs.existsSync(nameOrPath) ? { type: "file", path: nameOrPath } : { type: "not_found", name: nameOrPath };
  }
  for (const { path: dir } of getWorkflowDirs(options)) {
    const filePath = path.join(dir, `${nameOrPath}.json`);
    if (fs.existsSync(filePath)) return { type: "file", path: filePath };
  }
  return { type: "not_found", name: nameOrPath };
}

function normalizeStep(step) {
  if (!step || typeof step !== "object" || Array.isArray(step)) throw new Error("workflow step must be an object");
  if (step.repeat !== undefined || step.each !== undefined) {
    if (!Array.isArray(step.steps) || step.steps.length === 0) throw new Error("loop must have a non-empty 'steps' array");
    return {
      ...step,
      steps: step.steps.map(normalizeStep),
      ...(step.until ? { until: normalizeStep(step.until) } : {}),
    };
  }
  const cmd = step.tool || step.cmd;
  if (typeof cmd !== "string" || !cmd) throw new Error("workflow step must have a 'tool' field");
  return { cmd: ALIASES[cmd] || cmd, args: step.args || {}, ...(step.id ? { id: step.id } : {}), ...(step.as ? { as: step.as } : {}) };
}

const SEMANTIC_OPS = new Set(["find", "open", "ensureChecked", "fill", "click", "assert"]);
const SEMANTIC_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const SEMANTIC_STEP_FIELDS = new Set(["id", "tool", "args", "as"]);
const SEMANTIC_ARG_FIELDS = {
  find: new Set(["op", "target", "search"]),
  open: new Set(["op", "target", "expect"]),
  ensureChecked: new Set(["op", "target", "checked", "expect"]),
  fill: new Set(["op", "target", "input", "expect"]),
  click: new Set(["op", "target", "expect"]),
  assert: new Set(["op", "mode", "claim", "bindings", "target", "predicate"]),
};

function assertClosedObject(value, allowed, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${path}.${key} is not allowed`);
  }
}

function assertSemanticName(value, path) {
  if (typeof value !== "string" || !SEMANTIC_ID.test(value)) {
    throw new Error(`${path} must be a 1-64 character identifier`);
  }
}

function validateTarget(target, path, { queryOnly = false } = {}) {
  assertClosedObject(target, new Set(["query", "role", "type", "binding"]), path);
  const hasQuery = typeof target.query === "string" && target.query.length > 0;
  const hasBinding = typeof target.binding === "string" && target.binding.length > 0;
  if (hasQuery === hasBinding || (queryOnly && !hasQuery)) {
    throw new Error(`${path} must contain exactly one of 'query' or 'binding'${queryOnly ? " (query required)" : ""}`);
  }
  if (hasBinding && (target.role !== undefined || target.type !== undefined)) {
    throw new Error(`${path} binding cannot include role or type`);
  }
  if (target.role !== undefined && (typeof target.role !== "string" || !target.role)) throw new Error(`${path}.role must be a non-empty string`);
  if (target.type !== undefined && (typeof target.type !== "string" || !target.type)) throw new Error(`${path}.type must be a non-empty string`);
}

function validateExpectation(value, path) {
  assertClosedObject(value, new Set(["kind", "mode", "target", "equals", "contains", "input", "binding", "claim"]), path);
  const kinds = new Set(["urlPath", "visible", "checkedEquals", "valueEquals", "textExact", "textContains"]);
  if (value.mode === "semantic") {
    if (typeof value.claim !== "string" || !value.claim) throw new Error(`${path}.claim must be a non-empty string`);
  } else if (!kinds.has(value.kind)) throw new Error(`${path}.kind is invalid`);
  if (value.target !== undefined) validateTarget(value.target, `${path}.target`);
}

function validateSemanticStep(step, index, priorBindings, ids, policy) {
  const path = `steps[${index}]`;
  assertClosedObject(step, SEMANTIC_STEP_FIELDS, path);
  if (step.tool !== "semantic.step") throw new Error(`${path}.tool must be 'semantic.step'`);
  assertSemanticName(step.id, `${path}.id`);
  if (ids.has(step.id)) throw new Error(`${path}.id must be unique`);
  ids.add(step.id);
  if (step.as !== undefined) {
    assertSemanticName(step.as, `${path}.as`);
    if (priorBindings.has(step.as)) throw new Error(`${path}.as must be unique`);
  }
  if (!step.args || typeof step.args !== "object" || Array.isArray(step.args)) throw new Error(`${path}.args must be an object`);
  const op = step.args.op;
  if (!SEMANTIC_OPS.has(op)) throw new Error(`${path}.args.op is invalid`);
  assertClosedObject(step.args, SEMANTIC_ARG_FIELDS[op], `${path}.args`);

  if (op === "find") {
    validateTarget(step.args.target, `${path}.args.target`, { queryOnly: true });
    if (step.args.search !== undefined) {
      assertClosedObject(step.args.search, new Set(["mode", "maxObservations"]), `${path}.args.search`);
      if (step.args.search.mode !== "scroll") throw new Error(`${path}.args.search.mode must be 'scroll'`);
      if (step.args.search.maxObservations !== undefined && (!Number.isInteger(step.args.search.maxObservations) || step.args.search.maxObservations < 1 || step.args.search.maxObservations > policy.maxSearchObservations)) {
        throw new Error(`${path}.args.search.maxObservations must be an integer from 1 to ${policy.maxSearchObservations}`);
      }
    }
  } else if (op !== "assert") validateTarget(step.args.target, `${path}.args.target`);

  if (op === "ensureChecked" && typeof step.args.checked !== "boolean") throw new Error(`${path}.args.checked must be a boolean`);
  if (op === "fill") assertSemanticName(step.args.input, `${path}.args.input`);
  if (op === "click" && step.args.expect === undefined) throw new Error(`${path}.args.expect is required`);
  if (step.args.expect !== undefined) validateExpectation(step.args.expect, `${path}.args.expect`);
  if (op === "assert") {
    if (step.args.mode !== "local" && step.args.mode !== "semantic") throw new Error(`${path}.args.mode must be 'local' or 'semantic'`);
    if (step.args.mode === "semantic" && (typeof step.args.claim !== "string" || !step.args.claim)) throw new Error(`${path}.args.claim must be a non-empty string`);
    if (step.args.mode === "local") validateExpectation(step.args.predicate, `${path}.args.predicate`);
    if (step.args.target !== undefined) validateTarget(step.args.target, `${path}.args.target`);
  }

  const references = [];
  if (step.args.target?.binding) references.push(step.args.target.binding);
  if (step.args.expect?.target?.binding) references.push(step.args.expect.target.binding);
  if (step.args.expect?.binding) references.push(step.args.expect.binding);
  if (step.args.predicate?.target?.binding) references.push(step.args.predicate.target.binding);
  if (step.args.predicate?.binding) references.push(step.args.predicate.binding);
  if (Array.isArray(step.args.bindings)) references.push(...step.args.bindings);
  else if (step.args.bindings !== undefined) throw new Error(`${path}.args.bindings must be an array`);
  for (const binding of references) {
    assertSemanticName(binding, `${path} binding`);
    if (!priorBindings.has(binding)) throw new Error(`${path} binding '${binding}' must refer to a prior step output`);
  }
  if (step.as !== undefined) {
    priorBindings.add(step.as);
  }
}

function validateSemanticWorkflow(workflow) {
  const { WORKFLOW_POLICY } = require("./semantic-workflow.cjs");
  assertClosedObject(workflow.semantic, new Set(["version", "deadlineMs", "maxProviderCalls"]), "semantic");
  if (workflow.semantic.version !== 1) throw new Error("semantic.version must equal 1");
  if (workflow.steps.length > WORKFLOW_POLICY.maxSteps) throw new Error(`semantic workflows support at most ${WORKFLOW_POLICY.maxSteps} steps`);
  if (workflow.semantic.deadlineMs !== undefined && (!Number.isInteger(workflow.semantic.deadlineMs) || workflow.semantic.deadlineMs < 1 || workflow.semantic.deadlineMs > WORKFLOW_POLICY.maxDeadlineMs)) {
    throw new Error(`semantic.deadlineMs must be an integer from 1 to ${WORKFLOW_POLICY.maxDeadlineMs}`);
  }
  if (workflow.semantic.maxProviderCalls !== undefined && (!Number.isInteger(workflow.semantic.maxProviderCalls) || workflow.semantic.maxProviderCalls < 1 || workflow.semantic.maxProviderCalls > WORKFLOW_POLICY.maxProviderCalls)) {
    throw new Error(`semantic.maxProviderCalls must be an integer from 1 to ${WORKFLOW_POLICY.maxProviderCalls}`);
  }
  const priorBindings = new Set();
  const ids = new Set();
  workflow.steps.forEach((step, index) => validateSemanticStep(step, index, priorBindings, ids, WORKFLOW_POLICY));
}

function normalizeWorkflow(workflow) {
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) throw new Error("workflow must be an object");
  if (!Array.isArray(workflow.steps)) throw new Error("Workflow must have a 'steps' array");
  if (workflow.steps.length === 0) throw new Error("Workflow has no steps");
  if (workflow.args !== undefined && (!workflow.args || typeof workflow.args !== "object" || Array.isArray(workflow.args))) {
    throw new Error("'args' must be an object");
  }
  const hasSemanticSteps = workflow.steps.some((step) => step?.tool === "semantic.step" || step?.cmd === "semantic.step");
  if (workflow.semantic !== undefined || hasSemanticSteps) {
    if (workflow.semantic === undefined) throw new Error("semantic workflows require semantic.version=1");
    validateSemanticWorkflow(workflow);
  }
  return { ...workflow, args: workflow.args || {}, steps: workflow.steps.map(normalizeStep) };
}

function validateWorkflowArgs(workflow, providedArgs) {
  const errors = [];
  for (const [name, spec] of Object.entries(workflow.args || {})) {
    if (spec.required && providedArgs[name] === undefined) errors.push(`Missing required argument: --${name}`);
  }
  return errors;
}

function applyArgDefaults(workflow, providedArgs) {
  const vars = { ...providedArgs };
  for (const [name, spec] of Object.entries(workflow.args || {})) {
    if (vars[name] === undefined && spec.default !== undefined) vars[name] = spec.default;
  }
  return vars;
}

function validateWorkflowFile(filePath) {
  if (!fs.existsSync(filePath)) return { valid: false, error: `File not found: ${filePath}` };
  try {
    const workflow = JSON.parse(fs.readFileSync(filePath, "utf8"));
    normalizeWorkflow(workflow);
    return { valid: true, workflow };
  } catch (error) {
    return { valid: false, error: error instanceof SyntaxError ? `Invalid JSON: ${error.message}` : error.message };
  }
}

function listWorkflows(options = {}) {
  const workflows = [];
  for (const { path: dir, scope } of getWorkflowDirs(options)) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".json"))) {
      const filePath = path.join(dir, file);
      try {
        const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
        workflows.push({ name: content.name || file.slice(0, -5), description: content.description || "", scope, path: filePath, args: content.args, stepCount: content.steps?.length || 0 });
      } catch {}
    }
  }
  return workflows;
}

function getWorkflowInfo(name, options = {}) {
  const resolved = resolveWorkflow(name, options);
  if (resolved.type === "not_found") return { error: `Workflow not found: ${name}` };
  if (resolved.type === "inline") return { error: "Cannot get info for inline workflows" };
  try {
    const content = JSON.parse(fs.readFileSync(resolved.path, "utf8"));
    return { name: content.name || name, description: content.description || "", args: content.args || {}, steps: content.steps || [], path: resolved.path };
  } catch (error) {
    return { error: `Failed to parse workflow: ${error.message}` };
  }
}

function formatStep(step, indent = 0) {
  const pad = "  ".repeat(indent);
  if (step.repeat !== undefined || step.each !== undefined) {
    const label = step.repeat !== undefined ? `repeat ${step.repeat} times:` : `each ${step.each} as ${step.as || "item"}:`;
    const lines = [`${pad}${label}`, ...(step.steps || []).map((nested) => formatStep(nested, indent + 1))];
    if (step.until) lines.push(`${pad}  until: ${step.until.tool || step.until.cmd}`);
    return lines.join("\n");
  }
  const tool = step.tool || step.cmd;
  const argStr = Object.entries(step.args || {}).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(" ");
  return `${pad}${tool}${argStr ? ` ${argStr}` : ""}${step.as ? ` → ${step.as}` : ""}`;
}

module.exports = {
  ALIASES,
  PRIMARY_ARG_MAP,
  applyArgDefaults,
  commandMetadata,
  formatStep,
  getWorkflowDirs,
  getWorkflowInfo,
  listWorkflows,
  normalizeStep,
  normalizeWorkflow,
  parseCommandLine,
  parseDoCommands,
  promoteRedactedStepArgs,
  redactCommandArgs,
  resolveWorkflow,
  tokenize,
  validateWorkflowArgs,
  validateWorkflowFile,
};
