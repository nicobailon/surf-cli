// `surf pb param`: turns a recorded literal in an op's network request into a named input
// (`{{name}}` plus an `args` entry), or makes a header come from an environment variable.

const os = require("os");
const { editSavedOp, validateOp } = require("./playbooks.cjs");
const { isSecretHeader, isSensitiveName } = require("./redaction.cjs");
const { lineDiff } = require("./text-diff.cjs");
const { commandMetadata } = require("./workflow-definition.cjs");

// `surf use` options that never reach an op, so no input can take these names.
const RESERVED_RUN_OPTIONS = new Set(["json", "no-lock", "no-wait", "session", "tab-id", "write", "repeat", "retry-attempt", "override-in-doubt", "pin-built-in", "allow-script", "format"]);
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ENV_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TEMPLATE_ONLY = /^\{\{[a-zA-Z0-9._-]+\}\}$/;
const REDACTED_BODY = "<request-body>";

const keep = (text) => text;
const decodePath = (text) => { try { return decodeURIComponent(text); } catch { return text; } };
const decodeForm = (text) => decodePath(text.replace(/\+/g, " "));

function headerValue(headers, name) {
  return Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
}

function listOf(keys) {
  return keys.length ? keys.join(", ") : "none";
}

// A slot is one place in the request: its current (decoded) value, how text around a placeholder
// is encoded there, and how to store the new text.
function jsonSlot(field, root, parts, onStore) {
  let node = root;
  for (const [index, part] of parts.entries()) {
    const where = parts.slice(0, index).join(".") || "the top level";
    if (!node || typeof node !== "object" || !Object.hasOwn(node, part)) {
      const keys = node && typeof node === "object" ? Object.keys(node) : [];
      throw new Error(`${field}: no "${part}" at ${where} (has: ${listOf(keys)})`);
    }
    if (index === parts.length - 1) {
      const value = node[part];
      if (value && typeof value === "object") throw new Error(`${field}: holds an object or array; name a field inside it`);
      const parent = node;
      return { field, value, json: true, sensitive: isSensitiveName(part), encode: keep, store: (text) => { parent[part] = text; onStore(root); } };
    }
    node = node[part];
  }
  throw new Error(`${field}: name a field inside it`);
}

function parseJson(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function querySlot(request, field, [param, ...jsonPath]) {
  if (!param) throw new Error(`${field}: name the query param, as in query.q`);
  const query = request.query || {};
  if (!Object.hasOwn(query, param)) throw new Error(`${field}: no query param "${param}" (has: ${listOf(Object.keys(query))})`);
  const current = query[param];
  const setParam = (value) => { request.query = { ...query, [param]: value }; };
  if (jsonPath.length === 0) {
    if (current && typeof current === "object") throw new Error(`${field}: holds JSON; name a field inside it, as in ${field}.<path>`);
    return { field, value: String(current), json: false, sensitive: isSensitiveName(param), encode: keep, store: setParam };
  }
  const doc = current && typeof current === "object" ? current : parseJson(String(current));
  if (!doc) throw new Error(`${field}: query param "${param}" is not JSON`);
  return jsonSlot(field, doc, jsonPath, setParam);
}

// Splits a URL without parsing it, since parsing would percent-encode `{{name}}`.
function splitUrl(url) {
  const match = String(url).match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*)?([^?#]*)(.*)$/);
  return { origin: match[1] || "", segments: match[2].split("/").slice(1), rest: match[3] };
}

function joinUrl({ origin, segments, rest }) {
  return `${origin}/${segments.join("/")}${rest}`;
}

function pathSlot(request, field, parts) {
  const index = Number(parts[0]);
  if (parts.length !== 1 || !Number.isInteger(index) || index < 1) throw new Error(`${field}: use path.<n>, where path.1 is the URL path's first segment`);
  const url = splitUrl(request.url);
  const count = url.segments.length;
  if (index > count) throw new Error(`${field}: the URL path has ${count} segment${count === 1 ? "" : "s"} (/${url.segments.join("/")})`);
  return {
    field,
    value: decodePath(url.segments[index - 1]),
    json: false,
    sensitive: false,
    encode: encodeURIComponent,
    segment: { index, before: url.segments[index - 1] },
    store: (text) => {
      url.segments[index - 1] = text;
      request.url = joinUrl(url);
    },
  };
}

function boundaryOf(request, body) {
  const type = String(headerValue(request.headers, "content-type")?.[1] || "");
  const match = type.match(/boundary="?([^";]+)"?/i);
  if (match) return match[1];
  const first = body.match(/^--([^\r\n]+)\r?\n/);
  return first ? first[1] : null;
}

function multipartSlot(request, field, name, body, boundary) {
  const parts = body.split(`--${boundary}`);
  const matches = [];
  for (const [index, part] of parts.entries()) {
    const split = part.match(/\r?\n\r?\n/);
    if (!split) continue;
    const head = part.slice(0, split.index);
    const fieldName = head.match(/name="([^"]*)"/i)?.[1];
    if (fieldName === undefined || /filename=/i.test(head)) continue;
    const start = split.index + split[0].length;
    const end = part.endsWith("\r\n") ? part.length - 2 : part.endsWith("\n") ? part.length - 1 : part.length;
    matches.push({ index, fieldName, start, end });
  }
  const found = matches.filter((match) => match.fieldName === name);
  if (found.length === 0) throw new Error(`${field}: no form field "${name}" (has: ${listOf(matches.map((match) => match.fieldName))})`);
  if (found.length > 1) throw new Error(`${field}: the form has "${name}" more than once`);
  const { index, start, end } = found[0];
  return {
    field,
    value: parts[index].slice(start, end),
    json: false,
    sensitive: isSensitiveName(name),
    encode: keep,
    store: (text) => {
      parts[index] = `${parts[index].slice(0, start)}${text}${parts[index].slice(end)}`;
      request.body = parts.join(`--${boundary}`);
    },
  };
}

function formSlot(request, field, name, body) {
  const pairs = body.split("&");
  const keys = pairs.map((pair) => decodeForm(pair.split("=")[0]));
  const found = keys.flatMap((key, index) => (key === name ? [index] : []));
  if (found.length === 0) throw new Error(`${field}: no form field "${name}" (has: ${listOf(keys)})`);
  if (found.length > 1) throw new Error(`${field}: the form has "${name}" more than once`);
  const [rawKey, ...rawValue] = pairs[found[0]].split("=");
  return {
    field,
    value: decodeForm(rawValue.join("=")),
    json: false,
    sensitive: isSensitiveName(name),
    encode: encodeURIComponent,
    store: (text) => {
      pairs[found[0]] = `${rawKey}=${text}`;
      request.body = pairs.join("&");
    },
  };
}

function bodySlot(request, field, parts) {
  const body = request.body;
  if (body === undefined || body === null || body === "") throw new Error(`${field}: the request has no body`);
  if (body === REDACTED_BODY) throw new Error(`${field}: the recorded body was redacted; record again with pb record start --include-input-values to keep it`);
  if (parts.length === 0) throw new Error(`${field}: name a field inside the body, as in body.<name>`);
  if (typeof body === "object") return jsonSlot(field, body, parts, (root) => { request.body = root; });
  const doc = parseJson(body);
  if (doc) return jsonSlot(field, doc, parts, (root) => { request.body = root; });
  const type = String(headerValue(request.headers, "content-type")?.[1] || "");
  const name = parts.join(".");
  if (/multipart\/form-data/i.test(type) || body.startsWith("--")) {
    const boundary = boundaryOf(request, body);
    if (boundary) return multipartSlot(request, field, name, body, boundary);
  }
  if (/application\/x-www-form-urlencoded/i.test(type) || /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(body)) return formSlot(request, field, name, body);
  throw new Error(`${field}: the body is neither JSON nor a form`);
}

function headerSlot(request, field, name) {
  if (!name) throw new Error(`${field}: name the header, as in headers.x-api-version`);
  if (isSecretHeader(name)) throw new Error(`${field}: ${name} is a secret header; use --env <VAR> so its value is read at run time and never stored`);
  const found = headerValue(request.headers, name);
  if (!found) throw new Error(`${field}: no ${name} header (has: ${listOf(Object.keys(request.headers || {}))})`);
  return {
    field,
    value: String(found[1]),
    json: false,
    sensitive: false,
    encode: keep,
    store: (text) => { request.headers = { ...request.headers, [found[0]]: text }; },
  };
}

function resolveSlot(request, field) {
  const [target, ...parts] = field.split(".");
  if (target === "query") return querySlot(request, field, parts);
  if (target === "path") return pathSlot(request, field, parts);
  if (target === "body") return bodySlot(request, field, parts);
  if (target === "headers") return headerSlot(request, field, parts.join("."));
  throw new Error(`${field}: a field starts with query., path., body. or headers.`);
}

// Puts `{{name}}` in the slot: over its whole value, or over the one place `literal` appears in it.
function templateSlot(slot, name, literal) {
  const placeholder = `{{${name}}}`;
  const current = slot.value;
  if (typeof current === "string" && current.includes(placeholder)) return { status: "already" };
  if (typeof current === "string" && TEMPLATE_ONLY.test(current)) throw new Error(`${slot.field}: already the input ${current}`);
  if (literal === undefined || String(current) === literal) {
    slot.store(placeholder);
    return { status: "templated", literal: current, whole: true, stored: placeholder };
  }
  if (typeof current !== "string") throw new Error(`${slot.field}: "${literal}" not found in ${JSON.stringify(current)}`);
  const first = current.indexOf(literal);
  if (first < 0) throw new Error(`${slot.field}: "${literal}" not found in "${current}"`);
  if (current.indexOf(literal, first + literal.length) >= 0) throw new Error(`${slot.field}: "${literal}" appears more than once in "${current}"; template the whole value instead`);
  const stored = `${slot.encode(current.slice(0, first))}${placeholder}${slot.encode(current.slice(first + literal.length))}`;
  slot.store(stored);
  return { status: "templated", literal, whole: false, stored };
}

function coerce(value, type, label) {
  if (type === "number") {
    const number = typeof value === "number" ? value : Number(value);
    if (String(value).trim() === "" || !Number.isFinite(number)) throw new Error(`${label} must be a number`);
    return number;
  }
  if (type === "boolean") {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    throw new Error(`${label} must be true or false`);
  }
  return String(value);
}

function inputType(results) {
  const types = new Set(results.filter((result) => result.json && result.whole).map((result) => typeof result.literal));
  if (types.size > 1) throw new Error(`the fields hold values of different types (${[...types].join(", ")}); give each its own input`);
  const [type] = types;
  return type === "number" || type === "boolean" ? type : "string";
}

function sameSpec(a, b) {
  return (a.type === undefined || a.type === b.type) && Boolean(a.required) === Boolean(b.required) && a.default === b.default;
}

// Templates the obvious places a workflow step carries the same value: a typed value equal to the
// literal, and a URL on the request's origin with the same path segment or query param.
function templateSteps(steps, context, touched) {
  return steps.map((step) => {
    if (Array.isArray(step.steps)) return { ...step, steps: templateSteps(step.steps, context, touched) };
    const command = step.cmd || step.tool;
    const kinds = commandMetadata(command).argKinds;
    const args = { ...(step.args || {}) };
    for (const [arg, value] of Object.entries(args)) {
      if (typeof value !== "string") continue;
      let next = value;
      if (kinds[arg] === "user-input" && value === context.literal) next = context.placeholder;
      else if (kinds[arg] === "url") next = templateStepUrl(value, context);
      if (next !== value) {
        args[arg] = next;
        touched.push(`${command} ${arg}`);
      }
    }
    return { ...step, args };
  });
}

function templateStepUrl(value, { origin, segments, queries, placeholder, literal }) {
  const url = splitUrl(value);
  if (!url.origin || url.origin !== origin) return value;
  for (const { index, before, stored } of segments) {
    if (url.segments[index - 1] === before) url.segments[index - 1] = stored;
  }
  let rest = url.rest;
  if (queries.length && rest.startsWith("?")) {
    const [search, ...hash] = rest.slice(1).split("#");
    const pairs = search.split("&").map((pair) => {
      const [key, ...raw] = pair.split("=");
      return queries.includes(decodeForm(key)) && decodeForm(raw.join("=")) === literal ? `${key}=${placeholder}` : pair;
    });
    rest = `?${pairs.join("&")}${hash.length ? `#${hash.join("#")}` : ""}`;
  }
  return joinUrl({ ...url, rest });
}

const usesInput = (value, input) => JSON.stringify(value).includes(`{{${input}}}`);

// Inputs only workflow steps take, such as the {{text}} a draft makes of a typed value (it never
// stores the value, so pb param can't match it to a request field).
function workflowOnlyInputs(op) {
  const workflows = op.run.filter((strategy) => strategy.using === "workflow");
  const others = op.run.filter((strategy) => strategy.using !== "workflow");
  return Object.keys(op.args || {}).filter((input) => usesInput(workflows, input) && !usesInput(others, input));
}

function renameInSteps(steps, from, to, touched) {
  return steps.map((step) => {
    if (Array.isArray(step.steps)) return { ...step, steps: renameInSteps(step.steps, from, to, touched) };
    const args = { ...(step.args || {}) };
    for (const [arg, value] of Object.entries(args)) {
      const json = JSON.stringify(value);
      if (!json?.includes(from)) continue;
      args[arg] = JSON.parse(json.split(from).join(to));
      touched.push(`${step.cmd || step.tool} ${arg}`);
    }
    return { ...step, args };
  });
}

// --link: the workflow-only input `link` becomes `name`. Its steps take {{name}}, the input goes,
// and a write's safety key follows. Returns the step arguments it changed; none when it is
// already linked.
function linkInput(op, link, name) {
  const from = `{{${link}}}`;
  if (!Object.hasOwn(op.args || {}, link)) {
    if (!usesInput(op.run, link) && usesInput(op.run.filter((strategy) => strategy.using === "workflow"), name)) return [];
    throw new Error(`--link ${link}: the op has no input ${link} (inputs: ${listOf(Object.keys(op.args || {}))})`);
  }
  const other = op.run.find((strategy) => strategy.using !== "workflow" && usesInput(strategy, link));
  if (other) throw new Error(`--link ${link}: the ${other.using} strategy uses ${from} too, so it is an input of its own; pick another --as`);
  const touched = [];
  for (const workflow of op.run.filter((strategy) => strategy.using === "workflow")) workflow.steps = renameInSteps(workflow.steps, from, `{{${name}}}`, touched);
  if (touched.length === 0) throw new Error(`--link ${link}: no workflow step takes ${from}`);
  delete op.args[link];
  if (op.safety?.key?.includes(link)) op.safety.key = [...new Set(op.safety.key.map((key) => (key === link ? name : key)))];
  return touched;
}

// Adds a header read from an environment variable at run time; nothing about its value is stored.
function envHeader(op, request, fields, env) {
  if (fields.length !== 1 || !fields[0].startsWith("headers.") || fields[0].length === "headers.".length) throw new Error("--env takes one field, headers.<name>");
  if (!ENV_PATTERN.test(env)) throw new Error(`--env must be an environment variable name, got ${JSON.stringify(env)}`);
  const header = fields[0].slice("headers.".length);
  const inputs = request.authInputs || [];
  const existing = inputs.find((input) => input.header.toLowerCase() === header.toLowerCase());
  if (existing) {
    if (existing.env !== env) throw new Error(`${fields[0]} already reads ${existing.env}`);
    return { notes: [] };
  }
  const literal = headerValue(request.headers, header);
  if (literal) {
    const { [literal[0]]: _removed, ...headers } = request.headers;
    request.headers = headers;
  }
  request.authInputs = [...inputs, { env, header: literal?.[0] || header, required: true }];
  return { notes: literal ? [`removed the recorded ${literal[0]} header value`] : [] };
}

/**
 * Returns `{ op, changed, notes }` without touching `op`. With `as`, each field gets `{{as}}` and the
 * op an `args.<as>` entry (typed from the value; defaulting to the recorded value unless `required`
 * or `default`). With `env`, the one `headers.<name>` field comes from that environment variable.
 */
function paramOp(op, { fields, as: name, env, required = false, default: defaultValue, desc, value: literal, link } = {}) {
  if (!Array.isArray(fields) || fields.length === 0) throw new Error("pb param needs at least one field, such as query.q, path.2, body.page or headers.x-version");
  if ((name === undefined) === (env === undefined)) throw new Error("pb param needs --as <name> or --env <VAR>, not both");
  if (link !== undefined && name === undefined) throw new Error("--link goes with --as");
  const next = structuredClone(op);
  const strategy = next.run.find((candidate) => candidate.using === "network");
  if (!strategy?.request) throw new Error(`op ${op.id} has no network strategy to take inputs`);
  if (env !== undefined) {
    if (required || defaultValue !== undefined || desc !== undefined || literal !== undefined) {
      throw new Error("--env takes no --required, --default, --desc or --value: the header's whole value comes from the variable");
    }
    const { notes } = envHeader(next, strategy.request, fields, env);
    return { op: next, changed: JSON.stringify(next) !== JSON.stringify(op), notes };
  }
  if (typeof name !== "string" || !NAME_PATTERN.test(name)) throw new Error("--as must use lowercase letters, numbers, dot, underscore, or hyphen");
  if (RESERVED_RUN_OPTIONS.has(name)) throw new Error(`--as ${name} is reserved: surf use takes --${name} as its own option`);
  if (required && defaultValue !== undefined) throw new Error("--required and --default can't be combined");
  if (link !== undefined && link === name) throw new Error(`--link ${link} names the same input as --as`);

  const request = strategy.request;
  const originalUrl = splitUrl(request.url);
  const results = fields.map((field) => {
    const slot = resolveSlot(request, field);
    // A secret-looking field, or one inside a secret-looking param or key, is templated whole:
    // a partial template would leave the rest of the credential in the op.
    const sensitive = slot.sensitive || field.split(".").slice(1).some(isSensitiveName);
    const partial = literal !== undefined && String(slot.value) !== literal && !String(slot.value).includes(`{{${name}}}`);
    if (sensitive && partial) throw new Error(`${field} looks secret: template it whole (leave out --value), so no part of it is stored`);
    return { ...slot, sensitive, ...templateSlot(slot, name, literal) };
  });
  const templated = results.filter((result) => result.status === "templated");
  const literals = [...new Set(templated.map((result) => String(result.literal)))];
  if (literals.length > 1) {
    const shown = templated.map((result) => `${result.field}=${JSON.stringify(result.literal)}`).join(", ");
    throw new Error(`the fields hold different values (${shown}); pass --value <text> to template the same text in each`);
  }
  const sensitive = results.find((result) => result.sensitive);
  if (sensitive && !required) throw new Error(`${sensitive.field} looks secret: pass --required so its value isn't stored as a default`);

  const existing = next.args?.[name];
  const type = templated.length ? inputType(templated) : existing?.type || "string";
  let fallback;
  if (defaultValue !== undefined) fallback = coerce(defaultValue, type, "--default");
  else if (!required) fallback = templated.length ? coerce(templated[0].literal, type, `the value of ${templated[0].field}`) : existing?.default;
  const description = desc ?? existing?.desc;
  const spec = { type, ...(required ? { required: true } : {}), ...(fallback !== undefined ? { default: fallback } : {}), ...(description !== undefined ? { desc: description } : {}) };
  if (existing && !sameSpec(existing, spec)) {
    throw new Error(`input ${name} already exists with a different definition (${JSON.stringify(existing)}); pick another --as or repeat its definition`);
  }
  next.args = { ...(next.args || {}), [name]: { ...(existing || {}), ...spec } };

  const notes = [];
  const workflows = next.run.filter((candidate) => candidate.using === "workflow");
  const linked = link === undefined ? [] : linkInput(next, link, name);
  if (linked.length) notes.push(`workflow fallback takes --${name} in place of --${link}: ${linked.join(", ")}`);
  if (templated.length && workflows.length) {
    const touched = [];
    const context = {
      origin: originalUrl.origin,
      placeholder: `{{${name}}}`,
      literal: literals[0],
      segments: templated.filter((result) => result.segment).map((result) => ({ ...result.segment, stored: result.stored })),
      queries: templated.filter((result) => result.whole && !result.json && /^query\.[^.]+$/.test(result.field)).map((result) => result.field.slice("query.".length)),
    };
    for (const workflow of workflows) workflow.steps = templateSteps(workflow.steps, context, touched);
    if (touched.length) notes.push(`workflow fallback takes the input too: ${touched.join(", ")}`);
    else if (!linked.length) {
      const hints = workflowOnlyInputs(next).filter((input) => input !== name).map((input) => `; if --${input} holds the same value, add --link ${input}`);
      notes.push(`workflow strategy unchanged: no step argument holds ${JSON.stringify(literals[0])}, so the browser fallback still runs as recorded${hints.join("")}`);
    }
  }
  return { op: next, changed: JSON.stringify(next) !== JSON.stringify(op), notes };
}

/** Applies `paramOp` to a saved op and saves it in the scope it came from. */
function applyParam({ playbook: playbookId, op: opId, cwd = process.cwd(), home = os.homedir(), ...spec }) {
  let result;
  const edited = editSavedOp({
    playbook: playbookId,
    op: opId,
    cwd,
    home,
    edit: (raw, playbook) => {
      result = paramOp(validateOp(raw, playbook), spec);
      return result.changed ? result.op : null;
    },
  });
  const summary = { playbook: edited.playbook, op: opId, scope: edited.scope, file: edited.path, changed: result.changed, notes: result.notes };
  if (!result.changed) return { ...summary, diff: "" };
  const after = JSON.parse(edited.after);
  return { ...summary, ...(spec.as ? { input: { [spec.as]: after.args[spec.as] } } : {}), diff: lineDiff(edited.before, edited.after) };
}

function formatParamResult(result) {
  const lines = [];
  if (result.changed) {
    lines.push(result.diff, "", `Saved ${result.playbook} ${result.op} (${result.scope}): ${result.file}`);
    if (result.input) lines.push(`Input: ${Object.entries(result.input).map(([name, spec]) => `--${name} ${JSON.stringify(spec)}`).join("")}`);
  } else lines.push(`No change: ${result.playbook} ${result.op} already has this input.`);
  for (const note of result.notes) lines.push(`Note: ${note}`);
  return lines.join("\n");
}

module.exports = { RESERVED_RUN_OPTIONS, applyParam, formatParamResult, paramOp };
