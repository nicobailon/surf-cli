// `surf pb param`: turns a recorded literal in an op's network request into a named input
// (`{{name}}` plus an `args` entry), or makes a header come from an environment variable.

const os = require("os");
const { editSavedOp, validateOp } = require("./playbooks.cjs");
const { isSecretHeader, isSensitiveName } = require("./redaction.cjs");
const { LITERAL_OPEN, escapeTemplates, escapedOp, requestInputs, sentRequest, templateInputs, unescapeTemplates } = require("./playbook-template.cjs");
const { lineDiff } = require("./text-diff.cjs");
const { commandMetadata } = require("./workflow-definition.cjs");

// `surf use` options that never reach an op, so no input can take these names.
const RESERVED_RUN_OPTIONS = new Set(["json", "no-lock", "no-wait", "session", "tab-id", "write", "repeat", "retry-attempt", "override-in-doubt", "pin-built-in", "allow-script", "format"]);
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ENV_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TEMPLATE_ONLY = /^\{\{[a-zA-Z0-9._-]+\}\}$/;
const REDACTED_BODY = "<request-body>";
// Where a record redacted a value its steps typed (record-typed-values.cjs): <text>, <value>...
const REDACTED_VALUE = /^<([a-z0-9._-]+)>$/;

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
// `keyText` reads a stored key as captured, the text a field names it by (see keyReader).
function jsonSlot(field, root, parts, { onStore, keyText }) {
  let node = root;
  for (const [index, part] of parts.entries()) {
    const where = parts.slice(0, index).join(".") || "the top level";
    const keys = node && typeof node === "object" ? Object.keys(node) : [];
    const found = keys.filter((key) => keyText(key) === part);
    if (found.length === 0) throw new Error(`${field}: no "${part}" at ${where} (has: ${listOf(keys.map(keyText))})`);
    if (found.length > 1) throw new Error(`${field}: more than one key at ${where} reads "${part}", a captured key and one that takes an input; edit the op by hand to tell them apart`);
    const [key] = found;
    if (index === parts.length - 1) {
      const value = node[key];
      if (value && typeof value === "object") throw new Error(`${field}: holds an object or array; name a field inside it`);
      const parent = node;
      return { field, value, json: true, sensitive: isSensitiveName(part), encode: keep, store: (text) => { parent[key] = text; onStore(root); } };
    }
    node = node[key];
  }
  throw new Error(`${field}: name a field inside it`);
}

// An escaped op stores a JSON param's keys as it stores values (storedJsonText), and a field names
// a key by its captured text, its inputs as written: a `{{!}}` reads `{{`. Any other op's keys are
// the text.
const keyReader = (escapes) => (escapes ? unescapeTemplates : keep);

// A JSON param or body stored as text. In an escaped op that text was escaped whole, as text, so
// only a `{{!}}` or `{{name}}` written as is in it is an escape or an input: a `{{` written
// \u007b\u007b was never escaped, and pb param's partial templating writes inputs as is, in a key
// or a value. Parsed, the document is stored as an object, whose keys renderRequest fills as it
// does values in an escaped op, so each string is read where it is written (storedJsonText) and
// the text parsed once.
function parseJson(text, escapes) {
  let value;
  try {
    value = JSON.parse(escapes ? storedJsonText(text) : text);
  } catch {
    return null;
  }
  return value && typeof value === "object" ? value : null;
}

const STORED_MARK = /\{\{(?:[a-zA-Z0-9._-]+|!)\}\}/g;
const INPUT_MARK = /\{\{[a-zA-Z0-9._-]+\}\}/;

// The stored JSON text with each string token, key or value, written again as the one form pb
// param keeps: escaped (escapeTemplates), its inputs as they were. A match of STORED_MARK in a
// token's source holds no `\`, so it is written as is; the text between matches, JSON escapes and
// all, is captured text. Throws on text that isn't JSON.
function storedJsonText(text) {
  let out = "";
  let at = 0;
  while (at < text.length) {
    const open = text.indexOf('"', at);
    if (open < 0) break;
    let close = open + 1;
    while (close < text.length && text[close] !== '"') close += text[close] === "\\" ? 2 : 1;
    if (close >= text.length) throw new Error("unterminated JSON string");
    out += text.slice(at, open) + JSON.stringify(storedString(text.slice(open + 1, close)));
    at = close + 1;
  }
  return out + text.slice(at);
}

function storedString(source) {
  const decode = (piece) => JSON.parse(`"${piece}"`);
  let stored = "";
  let captured = "";
  let last = 0;
  for (const match of source.matchAll(STORED_MARK)) {
    captured += decode(source.slice(last, match.index));
    last = match.index + match[0].length;
    if (match[0] === LITERAL_OPEN) captured += "{{";
    else {
      stored += escapeTemplates(captured) + match[0];
      captured = "";
    }
  }
  return stored + escapeTemplates(captured + decode(source.slice(last)));
}

// The JSON a query param or body holds as text, as pb param stores it. A hand-written op fills a
// {{name}} in that text's keys, but sends an object's keys as written, so one whose keys take an
// input stays text.
function storedJson({ text, escapes, field, where }) {
  const doc = parseJson(text, escapes);
  const key = doc && !escapes ? inputKey(doc) : null;
  if (key !== null) throw new Error(`${field}: the key ${JSON.stringify(key)} in ${where} takes an input, and this op sends an object's keys as written, so pb param won't store it as one; edit the op by hand`);
  return doc;
}

function inputKey(doc) {
  const stack = [doc];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    for (const [key, value] of Object.entries(node)) {
      if (!Array.isArray(node) && INPUT_MARK.test(key)) return key;
      stack.push(value);
    }
  }
  return null;
}

// Templating part of a JSON param's text can put an input in a key. The record names a masked
// value by its path (redactedTypes), so a path through that key moves with it.
function moveRedactedTypes(request, { prefix, before, after, escapes }) {
  const types = request.redactedTypes;
  const from = types && parseJson(before, escapes);
  const to = from && parseJson(after, escapes);
  if (!to) return;
  const keyText = keyReader(escapes);
  request.redactedTypes = Object.fromEntries(
    Object.entries(types).map(([field, type]) => {
      const moved = field.startsWith(prefix) ? movedPath(from, to, field.slice(prefix.length).split("."), keyText) : null;
      return [moved === null ? field : prefix + moved, type];
    }),
  );
}

// The path in `to` of the value at `parts` in `from`, where at most one key at each level was
// renamed; null when it can't tell.
function movedPath(from, to, parts, keyText) {
  const moved = [];
  for (const part of parts) {
    if (!from || typeof from !== "object" || !to || typeof to !== "object") return null;
    const fromKeys = Object.keys(from);
    const toKeys = Object.keys(to);
    const before = fromKeys.map(keyText);
    const after = toKeys.map(keyText);
    const gone = before.filter((key) => !after.includes(key));
    const added = after.filter((key) => !before.includes(key));
    const next = gone.length === 1 && added.length === 1 && gone[0] === part ? added[0] : part;
    if (before.filter((key) => key === part).length !== 1 || after.filter((key) => key === next).length !== 1) return null;
    moved.push(next);
    from = from[fromKeys[before.indexOf(part)]];
    to = to[toKeys[after.indexOf(next)]];
  }
  return moved.join(".");
}

function querySlot(request, field, [param, ...jsonPath], escapes) {
  if (!param) throw new Error(`${field}: name the query param, as in query.q`);
  const query = request.query || {};
  if (!Object.hasOwn(query, param)) throw new Error(`${field}: no query param "${param}" (has: ${listOf(Object.keys(query))})`);
  const current = query[param];
  const setParam = (value) => { request.query = { ...query, [param]: value }; };
  if (jsonPath.length === 0) {
    if (current && typeof current === "object") throw new Error(`${field}: holds JSON; name a field inside it, as in ${field}.<path>`);
    const store = (text) => {
      setParam(text);
      moveRedactedTypes(request, { prefix: `${field}.`, before: String(current), after: text, escapes });
    };
    return { field, value: String(current), json: false, sensitive: isSensitiveName(param), encode: keep, store };
  }
  const doc = current && typeof current === "object" ? current : storedJson({ text: String(current), escapes, field, where: `query.${param}` });
  if (!doc) throw new Error(`${field}: query param "${param}" is not JSON`);
  return jsonSlot(field, doc, jsonPath, { onStore: setParam, keyText: keyReader(escapes) });
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

function bodySlot(request, field, parts, escapes) {
  const body = request.body;
  if (body === undefined || body === null || body === "") throw new Error(`${field}: the request has no body`);
  if (body === REDACTED_BODY) throw new Error(`${field}: the recorded body was redacted; record again with pb record start --include-input-values to keep it`);
  if (parts.length === 0) throw new Error(`${field}: name a field inside the body, as in body.<name>`);
  const slot = { onStore: (root) => { request.body = root; }, keyText: keyReader(escapes) };
  if (typeof body === "object") return jsonSlot(field, body, parts, slot);
  const doc = storedJson({ text: body, escapes, field, where: "the body" });
  if (doc) return jsonSlot(field, doc, parts, slot);
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

// `escapes`: the op holds escaped text (escapedOp).
function resolveSlot(request, field, escapes) {
  const [target, ...parts] = field.split(".");
  if (target === "query") return querySlot(request, field, parts, escapes);
  if (target === "path") return pathSlot(request, field, parts);
  if (target === "body") return bodySlot(request, field, parts, escapes);
  if (target === "headers") return headerSlot(request, field, parts.join("."));
  throw new Error(`${field}: a field starts with query., path., body. or headers.`);
}

// Puts `{{name}}` in the slot: over its whole value, or over the one place `literal` appears in it.
// `escapes`: the op holds escaped text (escapedOp), so its `{{!}}` stands for `{{`.
function templateSlot(slot, { name, literal, escapes }) {
  const placeholder = `{{${name}}}`;
  const current = slot.value;
  if (typeof current === "string" && current.includes(placeholder)) return { status: "already" };
  if (typeof current === "string" && TEMPLATE_ONLY.test(current)) throw new Error(`${slot.field}: already the input ${current}`);
  if (!escapes) return templatePlainSlot(slot, { placeholder, literal });
  // A recorded `{{…}}` is stored escaped; --value and the input's default are the text it stands
  // for, and the text around a templated part stays escaped.
  const text = typeof current === "string" ? unescapeTemplates(current) : current;
  if (literal === undefined || String(text) === literal) {
    slot.store(placeholder);
    return { status: "templated", literal: text, whole: true, stored: placeholder };
  }
  if (typeof text !== "string") throw new Error(`${slot.field}: "${literal}" not found in ${JSON.stringify(text)}`);
  const first = text.indexOf(literal);
  if (first < 0) throw new Error(`${slot.field}: "${literal}" not found in "${text}"`);
  if (text.indexOf(literal, first + literal.length) >= 0) throw new Error(`${slot.field}: "${literal}" appears more than once in "${text}"; template the whole value instead`);
  const pieces = templatePieces(current);
  const last = first + literal.length;
  if (pieces.some((piece) => piece.input && piece.start < last && piece.end > first)) throw new Error(`${slot.field}: "${literal}" overlaps an input in "${current}"`);
  const stored = `${restorePieces(pieces, 0, first, slot.encode)}${placeholder}${restorePieces(pieces, last, text.length, slot.encode)}`;
  slot.store(stored);
  return { status: "templated", literal, whole: false, stored };
}

// templateSlot for an op whose text isn't escaped (a hand-written one): what it holds is the text.
function templatePlainSlot(slot, { placeholder, literal }) {
  const current = slot.value;
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

// A stored string as pieces of its text (unescapeTemplates'): recorded text, and the inputs in it,
// each with where it sits in that text.
function templatePieces(stored) {
  const pieces = [];
  let at = 0;
  let last = 0;
  const add = (piece, length) => {
    pieces.push({ ...piece, start: at, end: at + length });
    at += length;
  };
  for (const match of stored.matchAll(/\{\{(?:[a-zA-Z0-9._-]+|!)\}\}/g)) {
    const before = stored.slice(last, match.index);
    add({ text: before }, before.length);
    if (match[0] === LITERAL_OPEN) add({ text: "{{" }, 2);
    else add({ input: match[0] }, match[0].length);
    last = match.index + match[0].length;
  }
  add({ text: stored.slice(last) }, stored.length - last);
  return pieces;
}

// The stored form of the text from `start` to `end`: its recorded text encoded and escaped again,
// its inputs as they were.
function restorePieces(pieces, start, end, encode) {
  let stored = "";
  let text = "";
  for (const piece of pieces) {
    if (piece.end <= start || piece.start >= end) continue;
    if (piece.input) {
      stored += escapeTemplates(encode(text)) + piece.input;
      text = "";
    } else text += piece.text.slice(Math.max(start - piece.start, 0), Math.min(end, piece.end) - piece.start);
  }
  return stored + escapeTemplates(encode(text));
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

// `redactedTypes` maps a field whose number or boolean the record masked (as <text>) to that type.
function inputType(results, redactedTypes = {}) {
  const typeOf = (result) => (REDACTED_VALUE.test(String(result.literal)) && redactedTypes[result.field]) || typeof result.literal;
  const types = new Set(results.filter((result) => result.json && result.whole).map(typeOf));
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
      if (kinds[arg] === "user-input" && (value === context.literal || value === context.typedStep)) next = context.placeholder;
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

// Whether a strategy, or any of a list, takes `input`: of a network strategy's request, only where
// renderRequest fills it (never the record's notes, and a JSON key only in an escaped op).
function usesInput(strategies, input, { escapes }) {
  return [strategies].flat().some(({ request, ...strategy }) => templateInputs(strategy).has(input) || (request !== undefined && requestInputs(sentRequest(request), { escapes }).has(input)));
}

// Inputs only workflow steps take, such as the {{text}} a draft makes of a typed value (it never
// stores the value, so pb param can't match it to a request field).
function workflowOnlyInputs(op) {
  const workflows = op.run.filter((strategy) => strategy.using === "workflow");
  const others = op.run.filter((strategy) => strategy.using !== "workflow");
  const render = { escapes: escapedOp(op) };
  return Object.keys(op.args || {}).filter((input) => usesInput(workflows, input, render) && !usesInput(others, input, render));
}

// Renames {{from}} to {{to}} at every depth: step args, loop bodies, a loop's `until` step and its
// own fields (`each`). `touched` collects the step arguments it changed.
function renameInSteps(steps, from, to, touched) {
  const swap = (value) => JSON.parse(JSON.stringify(value).split(from).join(to));
  return steps.map((step) => {
    if (Array.isArray(step.steps)) {
      const { steps: body, until, ...loop } = step;
      for (const [field, value] of Object.entries(loop)) if (JSON.stringify(value)?.includes(from)) touched.push(`loop ${field}`);
      return {
        ...swap(loop),
        steps: renameInSteps(body, from, to, touched),
        ...(until ? { until: renameInSteps([until], from, to, touched)[0] } : {}),
      };
    }
    const args = { ...(step.args || {}) };
    for (const [arg, value] of Object.entries(args)) {
      if (!JSON.stringify(value)?.includes(from)) continue;
      args[arg] = swap(value);
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
  const render = { escapes: escapedOp(op) };
  if (!Object.hasOwn(op.args || {}, link)) {
    if (!usesInput(op.run, link, render) && usesInput(op.run.filter((strategy) => strategy.using === "workflow"), name, render)) return [];
    throw new Error(`--link ${link}: the op has no input ${link} (inputs: ${listOf(Object.keys(op.args || {}))})`);
  }
  const other = op.run.find((strategy) => strategy.using !== "workflow" && usesInput(strategy, link, render));
  if (other) throw new Error(`--link ${link}: the ${other.using} strategy uses ${from} too, so it is an input of its own; pick another --as`);
  const touched = [];
  for (const workflow of op.run.filter((strategy) => strategy.using === "workflow")) workflow.steps = renameInSteps(workflow.steps, from, `{{${name}}}`, touched);
  if (touched.length === 0) throw new Error(`--link ${link}: no workflow step takes ${from}`);
  if (usesInput(op.run, link, render)) throw new Error(`--link ${link}: ${from} is still in the op after renaming; edit it by hand`);
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
  const escapes = escapedOp(op);
  const results = fields.map((field) => {
    const slot = resolveSlot(request, field, escapes);
    // A secret-looking field, or one inside a secret-looking param or key, is templated whole:
    // a partial template would leave the rest of the credential in the op.
    const sensitive = slot.sensitive || field.split(".").slice(1).some(isSensitiveName);
    const partial = literal !== undefined && String(slot.value) !== literal && !String(slot.value).includes(`{{${name}}}`);
    if (sensitive && partial) throw new Error(`${field} looks secret: template it whole (leave out --value), so no part of it is stored`);
    return { ...slot, sensitive, ...templateSlot(slot, { name, literal, escapes }) };
  });
  const templated = results.filter((result) => result.status === "templated");
  const literals = [...new Set(templated.map((result) => String(result.literal)))];
  if (literals.length > 1) {
    const shown = templated.map((result) => `${result.field}=${JSON.stringify(result.literal)}`).join(", ");
    throw new Error(`the fields hold different values (${shown}); pass --value <text> to template the same text in each`);
  }
  // A value the record redacted has no recorded value to default to: the input is required.
  const redacted = literals.length === 1 ? literals[0].match(REDACTED_VALUE) : null;
  const sensitive = results.find((result) => result.sensitive);
  if (sensitive && !required) throw new Error(`${sensitive.field} looks secret: pass --required so its value isn't stored as a default`);

  const existing = next.args?.[name];
  const type = templated.length ? inputType(templated, request.redactedTypes) : existing?.type || "string";
  if (request.redactedTypes) {
    const left = Object.fromEntries(Object.entries(request.redactedTypes).filter(([field]) => !templated.some((result) => result.field === field)));
    if (Object.keys(left).length) request.redactedTypes = left;
    else delete request.redactedTypes;
  }
  let fallback;
  if (defaultValue !== undefined) fallback = coerce(defaultValue, type, "--default");
  else if (!required && !redacted) fallback = templated.length ? coerce(templated[0].literal, type, `the value of ${templated[0].field}`) : existing?.default;
  const description = desc ?? existing?.desc;
  const spec = { type, ...(required || (redacted && fallback === undefined) ? { required: true } : {}), ...(fallback !== undefined ? { default: fallback } : {}), ...(description !== undefined ? { desc: description } : {}) };
  if (existing && !sameSpec(existing, spec)) {
    throw new Error(`input ${name} already exists with a different definition (${JSON.stringify(existing)}); pick another --as or repeat its definition`);
  }
  next.args = { ...(next.args || {}), [name]: { ...(existing || {}), ...spec } };

  const notes = redacted && fallback === undefined ? [`the record redacted the value it typed here (${redacted[0]}), so --${name} is required`] : [];
  // A query key the recorded URL sent more than once: the record kept no type for what it masked there.
  for (const key of request.repeatedQuery || []) {
    if (!fields.some((field) => field === `query.${key}` || field.startsWith(`query.${key}.`))) continue;
    notes.push(`query.${key} was sent more than once in the recorded URL; the draft keeps the last, and the record keeps no type for a number or boolean it masked under a repeated key, so --${name} is a ${type}`);
  }
  // The record masks every path segment that is the typed value; one of them may be a fixed route piece.
  if (redacted) {
    const named = templated.filter((result) => result.segment).map((result) => result.field);
    const others = named.length ? splitUrl(request.url).segments.map((segment, index) => [`path.${index + 1}`, decodePath(segment)]).filter(([field, value]) => value === redacted[0] && !named.includes(field)).map(([field]) => field) : [];
    if (others.length) notes.push(`${others.join(", ")} holds ${redacted[0]} too, the same typed value: name every segment to template them with one input (surf pb param <playbook> <op> ${[...others, ...named].sort((a, b) => Number(a.slice(5)) - Number(b.slice(5))).join(" ")} --as ${name}), or put back the route text it held there`);
  }
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
      // The drafted step that typed a redacted value holds {{text}} or {{value}}; it takes the input too.
      // Only a typed text or value is one input; form.fill's data and select's values are whole lists.
      ...(redacted && /^(text|value)(-\d+)?$/.test(redacted[1]) ? { typedStep: `{{${redacted[1]}}}` } : {}),
    };
    for (const workflow of workflows) workflow.steps = templateSteps(workflow.steps, context, touched);
    if (touched.length) notes.push(`workflow fallback takes the input too: ${touched.join(", ")}`);
    else if (!linked.length) {
      const hints = workflowOnlyInputs(next).filter((input) => input !== name).map((input) => `; if --${input} holds the same value, add --link ${input}`);
      notes.push(`workflow strategy unchanged: no step argument holds ${JSON.stringify(literals[0])}, so the browser fallback still runs as recorded${hints.join("")}`);
    }
  }
  // The draft's input for that step (--text, --value) goes once nothing uses it, so it isn't still required.
  const replaced = redacted?.[1];
  if (replaced && replaced !== name && next.args?.[replaced] && !usesInput(next.run, replaced, { escapes })) {
    const { [replaced]: _replaced, ...rest } = next.args;
    next.args = rest;
    if (next.safety?.key?.includes(replaced)) next.safety = { ...next.safety, key: [...new Set(next.safety.key.map((key) => (key === replaced ? name : key)))] };
    notes.push(`input ${replaced} is now ${name}`);
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
