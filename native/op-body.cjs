// A request body an op keeps as a string: text sent as text/plain or with no type, multipart, XML
// and the like. The op file holds it as sent, with {{name}} where a value goes, and op-run fills each
// value in. Form or JSON text sent as text/plain or with no type is read as that format to name its
// inputs (sniff, fields, restring); a value filled into it is encoded as that format writes it
// (encoder). In any other string body, a secret-named field's value becomes {{name}}
// (templateSecrets); secretLeft finds a secret-looking key that still holds a literal value; scrub
// replaces each value surf knows is secret wherever it sits.

const { isSecret } = require("./redaction.cjs");

const TEMPLATE = /\{\{(?:env\.)?[a-zA-Z0-9._-]+\}\}/g;
const FORM = /^[^=&\s]+=[^&\s]*(?:&[^=&\s]+=[^&\s]*)*$/;
const ENCODE = {
  form: (value) => new URLSearchParams([["", value]]).toString().slice(1),
  json: (value) => JSON.stringify(value).slice(1, -1),
};
const decodeForm = (raw) => {
  try {
    return decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    return raw;
  }
};

/** "form" or "json" for form or JSON text sent as text/plain or with no type, else undefined. */
function sniff(text, type = "") {
  if (typeof text !== "string" || (type && !/^\s*text\/plain\s*(?:;|$)/i.test(type))) return undefined;
  const plain = text.replace(TEMPLATE, "0");
  if (/^\s*[[{]/.test(plain)) {
    try {
      JSON.parse(plain);
      return "json";
    } catch {
      return undefined;
    }
  }
  return FORM.test(plain) ? "form" : undefined;
}

/** How a value goes into a string body: form- or JSON-escaped in sniffed text, else as it is. */
const encoder = (text, type) => ENCODE[sniff(text, type)] || String;

// Each value of JSON text: { path, start, end }, its raw text being text.slice(start, end) (a
// string's without its quotes).
function jsonLeaves(text) {
  const leaves = [];
  let at = 0;
  const space = () => {
    while (/\s/.test(text[at] || "")) at++;
  };
  const string = () => {
    const start = at++;
    while (text[at] !== '"') at += text[at] === "\\" ? 2 : 1;
    at++;
    return text.slice(start, at);
  };
  const value = (path) => {
    space();
    const open = text[at];
    if (open === "{" || open === "[") {
      at++;
      space();
      for (let index = 0; text[at] !== (open === "{" ? "}" : "]"); index++) {
        let key = index;
        if (open === "{") {
          key = JSON.parse(string());
          space();
          at++;
        }
        value([...path, key]);
        space();
        if (text[at] === ",") at++;
        space();
      }
      at++;
      return;
    }
    const start = at;
    if (open === '"') {
      string();
      leaves.push({ path, start: start + 1, end: at - 1 });
      return;
    }
    while (at < text.length && !/[\s,\]}]/.test(text[at])) at++;
    leaves.push({ path, start, end: at });
  };
  value([]);
  return leaves;
}

/** Sniffed text read as an object (a repeated form key as a list), and each value's place in it. */
function fields(text, format) {
  if (format === "json") return { body: JSON.parse(text), leaves: jsonLeaves(text) };
  const pairs = [];
  let at = 0;
  for (const pair of text.split("&")) {
    const equals = pair.indexOf("=");
    pairs.push({ key: decodeForm(pair.slice(0, equals)), value: decodeForm(pair.slice(equals + 1)), start: at + equals + 1, end: at + pair.length });
    at += pair.length + 1;
  }
  const body = {};
  const seen = {};
  const leaves = pairs.map(({ key, value, start, end }) => {
    const count = pairs.filter((pair) => pair.key === key).length;
    body[key] = count > 1 ? [...(body[key] || []), value] : value;
    seen[key] = (seen[key] ?? -1) + 1;
    return { path: count > 1 ? [key, seen[key]] : [key], start, end };
  });
  return { body, leaves };
}

const valueAt = (node, path) => path.reduce((item, key) => (item === null || typeof item !== "object" ? undefined : item[key]), node);

// A value as raw text of `format`: its {{name}}s as written, the rest encoded.
const raw = (value, format) => value.split(/(\{\{(?:env\.)?[a-zA-Z0-9._-]+\}\})/).map((piece, index) => (index % 2 ? piece : ENCODE[format](piece))).join("");

/** `text` with each value that `after` changed (to {{name}}) written in its place, the rest as sent. */
function restring(text, format, after) {
  const { body: before, leaves } = fields(text, format);
  let out = text;
  for (const { path, start, end } of [...leaves].reverse()) {
    const now = valueAt(after, path);
    if (!["string", "number"].includes(typeof now) || String(now) === String(valueAt(before, path))) continue;
    out = `${out.slice(0, start)}${raw(String(now), format)}${out.slice(end)}`;
  }
  return out;
}

const KEY = String.raw`[\p{L}\p{N}_.\-\[\]%]+`;
const QUOTED = String.raw`"(?:[^"\\\r\n]|\\.)*"|'(?:[^'\\\r\n]|\\.)*'`;
// The four shapes a secret field takes in text: a multipart part named for it; key=value, to an &,
// a line end or a space before the next key=; and "key": "value", key: value or 'key': 'value', an
// unquoted value running to the line end or , ; ) } ]. The value of the last three ends where
// valueSpan says.
const PART = /(\bname="([^"]*)"[^\r\n]*\r?\n(?:[^\r\n]+\r?\n)*\r?\n)([\s\S]*?)(?=\r?\n--)/dg;
const PAIR = new RegExp(String.raw`(^|[&?;\s])(${KEY})=((?:(?![&\r\n]|\s+${KEY}=).)*)`, "dgu");
const COLON = new RegExp(String.raw`(^|[^\p{L}\p{N}_.\-\[\]%"'])(["']?)(${KEY})\2([ \t]*:[ \t]*)(${QUOTED}|[^\s"'{[,;)}\]][^\r\n,;)}\]]*)`, "dgu");
const SHAPES = [
  [PART, 2, 3],
  [PAIR, 2, 3, true],
  [COLON, 3, 5, true],
];
// What the save-time check also reads as a secret field: <key>value</key> (with a namespace
// prefix, <wsse:Password>, or a CDATA value), key => value and key = value.
const GUARD = [
  ...SHAPES,
  [new RegExp(String.raw`<((?:[\p{L}\p{N}_.\-]+:)?(${KEY}))(?:\s[^>]*)?>(<!\[CDATA\[[\s\S]*?\]\]>|[^<]*)</\1\s*>`, "dgu"), 2, 3],
  [new RegExp(String.raw`(["']?)(${KEY})\1\s*=>\s*(${QUOTED}|[^\s,;)}\]]+)`, "dgu"), 2, 3],
  [new RegExp(String.raw`(^|[^\p{L}\p{N}_.\-\[\]%])(${KEY})[ \t]*=[ \t]*(${QUOTED}|[^\s&,;<>]+)`, "dgu"), 2, 3],
];

// Where a key=value or key: value field's value sits in what its pattern took: [offset, length].
// A quoted value ends at its closing quote; another at the first < > " ' or , that is the text's
// own (a closing tag, a quote before , ; } ] ) > or the end, a comma before a space). Undefined
// when such a character sits inside the value any other way: then it can't be told from the text.
function valueSpan(value) {
  const quoted = value.match(/^(["'])((?:(?!\1)[^\\\r\n]|\\.)*)\1/);
  if (quoted) return [1, quoted[2].length];
  if (/^["']/.test(value)) return undefined;
  const special = value.search(/[<>"']/);
  const cut = value.search(/<\/|["'](?=[ \t]*(?:[,;}\])>]|$))|,(?=\s|$)/);
  if (special === -1) return [0, cut === -1 ? value.length : cut];
  return cut !== -1 && cut <= special ? [0, cut] : undefined;
}

// Each secret-named field of `text` with a literal value: { key, start, end }, the value's place.
// With `guard`, a field inside another's value counts too (GraphQL's `login(password: \"…\")` in
// a JSON string), and so does a value valueSpan can't place.
function secretValues(text, shapes, { guard = false, offset = 0 } = {}) {
  const found = [];
  for (const [pattern, keyAt, valueAt, spans] of shapes) {
    for (const match of text.matchAll(pattern)) {
      if (pattern === PART && /\bfilename=/i.test(match[1])) continue;
      let [start, end] = match.indices[valueAt];
      let value = match[valueAt];
      const span = spans ? valueSpan(value) : /^(["'])[\s\S]*\1$/.test(value) && value.length > 1 ? [1, value.length - 2] : [0, value.length];
      if (span) [start, value] = [start + span[0], value.slice(span[0], span[0] + span[1])];
      else if (!guard) continue;
      const trimmed = value.replace(/\s+$/, "");
      end = start + trimmed.length;
      const key = decodeForm(match[keyAt]);
      if (!trimmed || trimmed.includes("{{") || /^(?:null|true|false)$/.test(trimmed) || !isSecret(key)) {
        if (guard && trimmed) found.push(...secretValues(trimmed, shapes, { guard, offset: offset + start }));
        continue;
      }
      if (found.some((field) => offset + start < field.end && field.start < offset + end)) continue;
      found.push({ key, start: offset + start, end: offset + end });
    }
  }
  return found;
}

/** `text` with each secret-named field's value as `name(key)`: its {{name}}. */
function templateSecrets(text, name) {
  let out = text;
  for (const { key, start, end } of secretValues(text, SHAPES).sort((a, b) => b.start - a.start)) out = `${out.slice(0, start)}${name(key)}${out.slice(end)}`;
  return out;
}

/** The first secret-looking key in `text` that still holds a literal value. */
const secretLeft = (text) => secretValues(text, GUARD, { guard: true })[0]?.key;

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * `text` with each secret's value, as written or form-, URL- or JSON-encoded, as `template(secret)`
 * (its {{name}}); {{name}}s already there stay as they are. `secrets` are { value } of 6 characters
 * or more.
 */
function scrub(text, secrets, template) {
  if (typeof text !== "string" || secrets.length === 0) return text;
  const owner = new Map();
  for (const secret of secrets) {
    for (const spelled of [secret.value, ENCODE.form(secret.value), encodeURIComponent(secret.value), ENCODE.json(secret.value)]) if (!owner.has(spelled)) owner.set(spelled, secret);
  }
  const pattern = new RegExp([...owner.keys()].sort((a, b) => b.length - a.length).map(escape).join("|"), "g");
  return text.split(/(\{\{(?:env\.)?[a-zA-Z0-9._-]+\}\})/).map((piece, index) => (index % 2 ? piece : piece.replace(pattern, (spelled) => template(owner.get(spelled))))).join("");
}

/** The value `text` carries where the string body `template` has `{{name}}`, decoded; else undefined. */
function valueIn(template, text, name, type) {
  if (typeof template !== "string" || typeof text !== "string") return undefined;
  const names = [];
  const pattern = template.split(/(\{\{(?:env\.)?[a-zA-Z0-9._-]+\}\})/).map((piece, index) => {
    if (index % 2 === 0) return escape(piece);
    names.push(piece);
    return "([\\s\\S]*?)";
  }).join("");
  const match = text.match(new RegExp(`^${pattern}$`));
  const at = names.indexOf(`{{${name}}}`);
  if (!match || at < 0) return undefined;
  const value = match[at + 1];
  const format = sniff(template, type);
  if (format === "form") return decodeForm(value);
  if (format === "json") {
    try {
      return JSON.parse(`"${value}"`);
    } catch {}
  }
  return value;
}

module.exports = { encoder, fields, restring, scrub, secretLeft, sniff, templateSecrets, valueIn };
