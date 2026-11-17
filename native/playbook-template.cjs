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
  const fillText = (value, encode = keep) => {
    if (typeof value !== "string") return value;
    const exact = value.match(EXACT);
    return exact ? args[exact[1]] : embed(value, encode);
  };
  // Without recursion, so JSON nested any depth renders.
  const fill = (value, encode = keep) => {
    if (!value || typeof value !== "object") return fillText(value, encode);
    const open = (node) => ({ node, keys: Object.keys(node), at: 0, entries: [] });
    const close = ({ node, entries }) => {
      if (Array.isArray(node)) return entries.map(([, item]) => item);
      const keys = new Set();
      for (const [key] of entries) {
        if (keys.has(key)) throw new Error(`an input fills a JSON key that is already there: ${JSON.stringify(key)}`);
        keys.add(key);
      }
      return Object.fromEntries(entries);
    };
    const stack = [open(value)];
    for (;;) {
      const top = stack[stack.length - 1];
      if (top.at === top.keys.length) {
        const done = close(stack.pop());
        if (stack.length === 0) return done;
        const parent = stack[stack.length - 1];
        parent.entries[parent.entries.length - 1][1] = done;
        continue;
      }
      const key = top.keys[top.at++];
      const item = top.node[key];
      const name = escapes && !Array.isArray(top.node) ? embed(key, keep) : key;
      if (item && typeof item === "object") {
        top.entries.push([name, null]);
        stack.push(open(item));
      } else top.entries.push([name, fillText(item)]);
    }
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
  // In order, with its own stack, so a value nested any depth is read.
  const stack = [{ value }];
  while (stack.length) {
    const { value: item, key } = stack.pop();
    if (key !== undefined) add(key);
    else if (typeof item === "string") add(item);
    else if (Array.isArray(item)) {
      for (let index = item.length - 1; index >= 0; index--) stack.push({ value: item[index] });
    } else if (item && typeof item === "object") {
      const entries = Object.entries(item);
      for (let index = entries.length - 1; index >= 0; index--) {
        stack.push({ value: entries[index][1] });
        if (keys) stack.push({ key: entries[index][0] });
      }
    }
  }
  return names;
}

// The inputs a request (sentRequest's) takes: the ones renderRequest reads as it fills it, so the
// two never disagree. That is the URL, header and query values and the body, with `escapes` the
// keys inside them too; never a header's or query param's name, nor a field renderRequest passes on
// as written (method, cache, note). Each read gets text of its own, so no two keys come out the same.
function requestInputs(request, { escapes = false } = {}) {
  const names = new Set();
  let reads = 0;
  const args = new Proxy({}, {
    get(_, name) {
      if (typeof name === "string") names.add(name);
      return `\u{10FFFF}${reads++}\u{10FFFF}`;
    },
  });
  renderRequest(request, args, { escapes });
  return names;
}

// Whether an op holds escaped text: pb save --from-record and --from-recent set provenance.escaped
// on the op they save, whatever its draft said, and only there do `{{!}}` and `%{!}` stand for `{{`
// and `%{`. A hand-written op, and surf do, send them as written.
function escapedOp(op) {
  return op?.provenance?.escaped === true;
}

module.exports = { LITERAL_OPEN, escapeStepArgs, escapeTemplates, escapedOp, renderRequest, requestInputs, resolveArgValues, sentRequest, templateInputs, unescapeTemplates };
