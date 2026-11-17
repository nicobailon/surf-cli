// Fills an op's inputs into its network request. Generated clients (pb client export) embed these
// two functions' source, so they must stay self-contained: no imports, no outside names.

// Applies defaults, enforces `required`, and converts each input to its declared `type`.
function resolveArgValues(specs, provided) {
  const args = { ...provided };
  for (const [name, spec] of Object.entries(specs || {})) {
    if (args[name] === undefined && spec.default !== undefined) args[name] = spec.default;
    if (spec.required && args[name] === undefined) throw new Error(`Missing required argument: --${name}`);
    const value = args[name];
    if (value === undefined || spec.type === undefined) continue;
    if (spec.type === "string") args[name] = String(value);
    else if (spec.type === "number") {
      const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
      if (typeof number !== "number" || !Number.isFinite(number)) throw new Error(`--${name} must be a number`);
      args[name] = number;
    } else if (spec.type === "boolean") {
      if (value !== true && value !== false && value !== "true" && value !== "false") throw new Error(`--${name} must be true or false`);
      args[name] = value === true || value === "true";
    }
  }
  return args;
}

// A string that is only `{{name}}` takes the input's own value (left out when it is unset). Inside
// a longer string the value is encoded for where it lands: the URL and urlencoded bodies get
// percent-encoding; query params, headers and other bodies get the text as is. Object and array
// query params are sent as JSON. With `escapes` (an op pb save escaped, see escapedOp), `{{!}}` is
// sent as `{{` (see escapeTemplates), and an object's keys are filled as text too: pb param stores
// them escaped, as it does values. A key an input fills that another key already reads is refused,
// so no field is dropped. Any other request sends `{{!}}` and its keys as written.
function renderRequest(request, args, { escapes = false } = {}) {
  const EXACT = /^\{\{([a-zA-Z0-9._-]+)\}\}$/;
  const ANY = escapes ? /\{\{([a-zA-Z0-9._-]+|!)\}\}/g : /\{\{([a-zA-Z0-9._-]+)\}\}/g;
  const keep = (text) => text;
  const embed = (text, encode) => text.replace(ANY, (_, name) => {
    if (name === "!") return "{{";
    if (args[name] === undefined) throw new Error(`missing template argument: ${name}`);
    return encode(String(args[name]));
  });
  const fill = (value, encode = keep) => {
    if (typeof value === "string") {
      const exact = value.match(EXACT);
      return exact ? args[exact[1]] : embed(value, encode);
    }
    if (Array.isArray(value)) return value.map((item) => fill(item));
    if (value && typeof value === "object") {
      const entries = Object.entries(value).map(([key, item]) => [escapes ? embed(key, keep) : key, fill(item)]);
      const keys = new Set();
      for (const [key] of entries) {
        if (keys.has(key)) throw new Error(`an input fills a JSON key that is already there: ${JSON.stringify(key)}`);
        keys.add(key);
      }
      return Object.fromEntries(entries);
    }
    return value;
  };
  const headers = {};
  for (const [name, value] of Object.entries(request.headers || {})) {
    const filled = fill(value);
    if (filled !== undefined && filled !== null) headers[name] = String(filled);
  }
  const query = {};
  for (const [name, value] of Object.entries(request.query || {})) {
    const filled = fill(value);
    if (filled !== undefined && filled !== null) query[name] = typeof filled === "object" ? JSON.stringify(filled) : String(filled);
  }
  const contentType = Object.entries(request.headers || {}).find(([name]) => name.toLowerCase() === "content-type")?.[1] || "";
  const form = /application\/x-www-form-urlencoded/i.test(String(contentType));
  const rendered = { ...request, url: fill(request.url, encodeURIComponent), query, headers };
  if (request.body !== undefined) rendered.body = fill(request.body, form ? encodeURIComponent : keep);
  return rendered;
}

// Captured text that reads like an input (`{{action}}` in a recorded body) is kept as text: each
// `{{` that opens one becomes `{{!}}`, which renderRequest sends as `{{` in an op marked escaped. `!` is in no name either
// template takes: a `{{name}}` is [a-zA-Z0-9._-]+ (renderRequest, applyTemplate in
// playbook-runtime.cjs) and a `%{name}` is \w+ (resolveVar in workflow-runtime.cjs), so every name
// is filled as before. The escape is reversible: a captured `{{!}}` opens one too, so it is stored as
// `{{!}}!}}`, and every `{{!}}` an escaped text holds stands for `{{`.
const LITERAL_OPEN = "{{!}}";
const OPENS_PLACEHOLDER = /\{\{(?=(?:[a-zA-Z0-9._-]+|!)\}\})/g;
// A workflow also fills `%{name}` from its vars (an op's inputs), so a recorded step argument
// keeps `%{` as `%{!}`, which the workflow runtime sends as `%{`.
const LITERAL_PERCENT_OPEN = "%{!}";
const OPENS_VAR = /%\{(?=(?:\w+|!)\})/g;

function escapeText(value, escape) {
  if (typeof value === "string") return escape(value);
  if (Array.isArray(value)) return value.map((item) => escapeText(item, escape));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, escapeText(item, escape)]));
  return value;
}

function escapeTemplates(value) {
  return escapeText(value, (text) => text.replace(OPENS_PLACEHOLDER, LITERAL_OPEN));
}

// A recorded step's arguments, every string at any depth kept as recorded when the op runs.
function escapeStepArgs(value) {
  return escapeText(value, (text) => text.replace(OPENS_VAR, LITERAL_PERCENT_OPEN).replace(OPENS_PLACEHOLDER, LITERAL_OPEN));
}

// The text an escaped string stands for, its inputs left in place.
function unescapeTemplates(text) {
  return text.replaceAll(LITERAL_OPEN, "{{");
}

// What a network strategy's request sends as written: authInputs name headers read from the
// environment at run time, and redactedTypes and repeatedQuery are the record's notes for pb param.
function sentRequest({ authInputs: _auth, redactedTypes: _types, repeatedQuery: _repeated, ...sent }) {
  return sent;
}

// The inputs a value takes: each {{name}} in its strings at any depth, and with `keys` in its keys
// too.
function templateInputs(value, { keys = false } = {}) {
  const names = new Set();
  const add = (text) => {
    for (const match of text.matchAll(/\{\{([a-zA-Z0-9._-]+)\}\}/g)) names.add(match[1]);
  };
  const visit = (item) => {
    if (typeof item === "string") add(item);
    else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === "object") {
      for (const [key, inner] of Object.entries(item)) {
        if (keys) add(key);
        visit(inner);
      }
    }
  };
  visit(value);
  return names;
}

// The inputs a request (sentRequest's) takes where renderRequest fills them: with `escapes`, the
// keys inside a query value or the body too, never a query param's or header's name.
function requestInputs({ query, headers, body, ...rest }, { escapes = false } = {}) {
  return new Set([
    ...templateInputs([rest, Object.values(headers || {})]),
    ...templateInputs([Object.values(query || {}), body], { keys: escapes }),
  ]);
}

// Whether an op holds escaped text: pb save --from-record and --from-recent set provenance.escaped
// on the op they save, whatever its draft said, and only there do `{{!}}` and `%{!}` stand for `{{`
// and `%{`. A hand-written op, and surf do, send them as written.
function escapedOp(op) {
  return op?.provenance?.escaped === true;
}

module.exports = { LITERAL_OPEN, escapeStepArgs, escapeTemplates, escapedOp, renderRequest, requestInputs, resolveArgValues, sentRequest, templateInputs, unescapeTemplates };
