const SECRET_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
  "x-api-key",
  "x-csrf-token",
  "x-xsrf-token",
]);

const SECRET_NAME_PATTERN = /(?:^|[-_.])(authorization|cookie|password|passwd|secret|session|token|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|csrf|xsrf)(?:$|[-_.])/i;
const TEMPLATE_PATTERN = /\{\{[a-zA-Z0-9._-]+\}\}/;
const { MARKUP_WHOLE_MARKER, isXmlBody, redactMarkup } = require("./markup-redaction.cjs");

const CREDENTIAL_LITERAL_PATTERN = /\bbearer\s+[a-z0-9._~-]+|\bsk-[a-z0-9_-]{12,}|\bgh[pousr]_[a-z0-9_]{12,}|\beyj[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+/i;

// Replaces each of `values` in `text` with <redacted>, longest first. A value under 8 characters is
// replaced only where it stands alone, so a short value can't break up the words around it. With
// `anyLength`, for values known to be secrets (env values), every occurrence of one of 4 characters
// or more goes; a shorter one (`a`, `1`) still only where it stands alone, so it can't rewrite the
// text around it. Self-contained: generated clients embed its source.
function redactValues(text, values, { anyLength = false } = {}) {
  let result = String(text);
  const sorted = [...values].map(String).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const value of sorted) {
    if (value.length >= 8 || (anyLength && value.length >= 4)) result = result.split(value).join("<redacted>");
    else result = result.replace(new RegExp(`(?<![A-Za-z0-9])${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "g"), "<redacted>");
  }
  return result;
}

// redactValues over a JSON value's strings, at any depth. A key is a field's name, so a value
// rewrites one only when it is a secret by any measure: a value of 8 characters or more wherever it
// appears in the key, one of 4 to 7 only as the whole key, a shorter one never. A key that redacts
// to one already present takes <redacted-2>, <redacted-3>... so no entry is lost. Self-contained but
// for redactValues: generated clients embed both.
function redactObject(value, values, options = {}) {
  if (typeof value === "string") return redactValues(value, values, options);
  if (Array.isArray(value)) return value.map((item) => redactObject(item, values, options));
  if (!value || typeof value !== "object") return value;
  const texts = values.map(String);
  const long = texts.filter((text) => text.length >= 8);
  const redactKey = (key) => (texts.some((text) => text.length >= 4 && text === key) ? "<redacted>" : redactValues(key, long));
  const entries = Object.entries(value).map(([key, item]) => [key, redactKey(key), redactObject(item, values, options)]);
  const taken = new Set(entries.filter(([key, redacted]) => key === redacted).map(([key]) => key));
  return Object.fromEntries(entries.map(([key, redacted, item]) => {
    if (key === redacted) return [key, item];
    let name = redacted;
    for (let index = 2; taken.has(name); index++) name = redacted.replace(/<redacted>/, `<redacted-${index}>`);
    taken.add(name);
    return [name, item];
  }));
}

// The spellings a value takes in text that holds it encoded: as is, JSON-escaped once and twice (a
// JSON string inside a JSON string), and URL- and form-encoded.
function valueSpellings(value) {
  const text = String(value);
  const once = JSON.stringify(text).slice(1, -1);
  const twice = JSON.stringify(once).slice(1, -1);
  const encoded = encodeURIComponent(text);
  return [...new Set([text, once, twice, encoded, encoded.replace(/%20/g, "+")])].filter(Boolean);
}

// redactValues over every spelling of each of `values` (see valueSpellings).
function redactSecretValues(text, values, options = {}) {
  return redactValues(text, values.flatMap(valueSpellings), options);
}

// The secrets an echo can't hold, from `values`: each a secret value, or [value, ...other spellings]
// for one also written another way (a quoted parameter's escaped form). Each goes in every spelling
// (see valueSpellings), judged by the value's own length, whatever a spelling's: `long` holds those
// of 8 characters or more, `short` the shorter ones, `keys` those of 4 or more.
function echoSecrets(values) {
  const groups = values.map((value) => (Array.isArray(value) ? value : [value]).map(String)).filter(([text]) => text);
  const spell = (fits) => [...new Set(groups.filter(([text]) => fits(text.length)).flat().filter(Boolean).flatMap(valueSpellings))];
  return {
    long: spell((length) => length >= 8),
    short: spell((length) => length < 8),
    keys: spell((length) => length >= 4),
  };
}

// Echoes of secret values (see echoSecrets) are redacted without changing what holds them. A long
// secret goes wherever it appears; a short one only as a whole value (a whole JSON string, or a whole
// query or form value), never inside a number or the structure around it, and in other text only as
// a whole word. A key goes only when it is a whole key-length secret. So a JSON text stays valid
// JSON, a URL keeps its form and markup its tags. `parsed` holds the JSON text, as JSON.stringify
// writes it, of each spelling that parses as JSON, so a parsed body can be matched against them.
function echoRules({ long = [], short = [], keys = [] } = {}) {
  const whole = new Set([...long, ...short]);
  const parsed = new Set();
  for (const text of whole) {
    try {
      parsed.add(JSON.stringify(JSON.parse(text)));
    } catch {}
  }
  return { empty: whole.size === 0, long, short, whole, keys: new Set(keys), parsed };
}

// Whether a parsed JSON value is a secret whole: its JSON text is the one a secret parses to, so
// `[1]` read from the body `[ 1 ]` counts for the secret `[1]`. A parsed view shows it as "<redacted>",
// as the body it came from is shown.
function isEchoedJson(value, secrets) {
  const { parsed } = echoRules(secrets);
  return parsed.size > 0 && value !== undefined && parsed.has(JSON.stringify(value));
}

// The names `keys` take: a secret one (in `secretKeys`) <redacted>, or <redacted-2>, <redacted-3>...
// when that name is taken by another key, so no entry is lost; the others as they are. A secret key
// that repeats (a query's `a=1&a=2`) keeps one name.
function renamedKeys(keys, secretKeys) {
  const taken = new Set(keys.filter((key) => !secretKeys.has(key)));
  const names = new Map();
  return keys.map((key) => {
    if (!secretKeys.has(key)) return key;
    if (!names.has(key)) {
      let name = "<redacted>";
      for (let index = 2; taken.has(name); index++) name = `<redacted-${index}>`;
      taken.add(name);
      names.set(key, name);
    }
    return names.get(key);
  });
}

// Whether `text` is an absolute URL with a host, as `new URL()` reads it; `https://?q=x` is not.
function isUrlWithHost(text) {
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+$/.test(text)) return false;
  try {
    return new URL(text).host !== "";
  } catch {
    return false;
  }
}

// A string value: <redacted> when it is a secret whole; a JSON object or array held as text (httpbin's
// `data`) by redactEchoJsonText, so its own strings and keys follow the same rules; an absolute URL
// with a host (httpbin's `url`) by redactUrlBy; else with each long value replaced.
function redactEchoString(text, rules) {
  if (rules.whole.has(text)) return "<redacted>";
  if (isUrlWithHost(text)) return redactUrlBy(text, rules);
  if (/^\s*[{[]/.test(text)) {
    try {
      JSON.parse(text);
      return redactEchoJsonText(text, rules);
    } catch {}
  }
  return redactValues(text, rules.long);
}

// A parsed JSON value: "<redacted>" when it is a secret whole (see isEchoedJson); else its strings by
// redactEchoString and its secret keys renamed, at any depth; numbers and other keys as they are. A
// bare number, boolean or null is "<redacted>" when its text holds a secret, as redactEchoBody has it.
function redactEchoJson(value, secrets) {
  if (isEchoedJson(value, secrets)) return "<redacted>";
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    const text = JSON.stringify(value);
    return redactEchoBody(text, secrets) === text ? value : "<redacted>";
  }
  const rules = echoRules(secrets);
  const walk = (item) => {
    if (typeof item === "string") return redactEchoString(item, rules);
    if (Array.isArray(item)) return item.map(walk);
    if (!item || typeof item !== "object") return item;
    const entries = Object.entries(item);
    const names = renamedKeys(entries.map(([key]) => key), rules.keys);
    return Object.fromEntries(entries.map(([, child], index) => [names[index], walk(child)]));
  };
  return walk(value);
}

// A query or form-encoded text (`a=1&b=2`): a value that is a secret whole, by its encoded or
// decoded spelling, whatever its length; each long value within any other; a name, one without a
// value (`?flag`) included, only when it is a key-length secret whole, renamed as JSON keys are (see
// renamedKeys) by the names as decoded. `&` and `=` stay as they are.
function redactEchoQuery(query, rules) {
  const decode = (text) => {
    try {
      return decodeURIComponent(text.replace(/\+/g, " "));
    } catch {
      return text;
    }
  };
  const value = (raw) => (rules.whole.has(raw) || rules.whole.has(decode(raw)) ? "<redacted>" : redactValues(raw, rules.long));
  const pairs = query.split("&").map((pair) => {
    const equals = pair.indexOf("=");
    return equals < 0 ? { name: pair } : { name: pair.slice(0, equals), value: pair.slice(equals + 1) };
  });
  const decoded = pairs.map((pair) => decode(pair.name));
  const secret = new Set(decoded.filter((name, index) => rules.keys.has(pairs[index].name) || rules.keys.has(name)));
  const names = renamedKeys(decoded, secret);
  return pairs.map((pair, index) => {
    const name = secret.has(decoded[index]) ? names[index] : pair.name;
    return pair.value === undefined ? name : `${name}=${value(pair.value)}`;
  }).join("&");
}

// Text that holds markup: a `<` followed by a letter, `/`, `!` or `?`.
const MARKUP_PATTERN = /<[A-Za-z/!?]/;
// Whether a character code is whitespace, as `\s` reads it.
const isSpaceCode = (code) => code === 32 || (code >= 9 && code <= 13) || (code > 127 && /\s/.test(String.fromCharCode(code)));
const [LT, GT, DOUBLE_QUOTE, SINGLE_QUOTE] = ["<", ">", '"', "'"].map((char) => char.charCodeAt(0));

// Free text: each long value replaced wherever it appears, each short one only as a whole word, so
// it can't rewrite a word around it. A word has on each side whitespace or an end of the text, `>`
// before it or `<` after it, or a matching quote on both sides (a whole quoted value); it is never
// part of a longer run. Words are found in one pass over the text. Text that holds markup goes by
// its tokens instead (see markup-redaction.cjs), in XML mode when `xml`.
function redactEchoWords(text, rules, { xml = false } = {}) {
  if (MARKUP_PATTERN.test(text)) return redactMarkup(text, rules, { xml });
  const marker = "<redacted>";
  const byLength = (list) => [...list].filter(Boolean).sort((a, b) => b.length - a.length);
  const source = byLength(rules.long).reduce((result, value) => (result.includes(value) ? result.split(value).join(marker) : result), text);
  // NaN past either end of the text.
  const isWord = (start, end) => {
    const before = source.charCodeAt(start - 1);
    const after = source.charCodeAt(end);
    if ((before === DOUBLE_QUOTE || before === SINGLE_QUOTE) && before === after) return true;
    const opens = Number.isNaN(before) || before === GT || isSpaceCode(before);
    const closes = Number.isNaN(after) || after === LT || isSpaceCode(after);
    return opens && closes;
  };
  // Where each short value stands as a word, in order, longest value first.
  const found = byLength(rules.short).map((value) => {
    const starts = [];
    for (let at = source.indexOf(value); at >= 0; at = source.indexOf(value, at + 1)) {
      if (isWord(at, at + value.length)) starts.push(at);
    }
    return { length: value.length, starts, next: 0 };
  }).filter(({ starts }) => starts.length > 0);
  if (found.length === 0) return source;
  // Merged by start, the longest word at a start winning, so no two replacements overlap.
  const parts = [];
  let last = 0;
  for (;;) {
    let first = null;
    for (const words of found) {
      while (words.next < words.starts.length && words.starts[words.next] < last) words.next++;
      if (words.next < words.starts.length && (!first || words.starts[words.next] < first.starts[first.next])) first = words;
    }
    if (!first) break;
    const start = first.starts[first.next];
    parts.push(source.slice(last, start), marker);
    last = start + first.length;
  }
  parts.push(source.slice(last));
  return parts.join("");
}

// A URL: its query by redactEchoQuery, and long values anywhere else in it.
function redactEchoUrl(url, secrets) {
  if (typeof url !== "string") return url;
  const rules = echoRules(secrets);
  return rules.empty ? url : redactUrlBy(url, rules);
}

function redactUrlBy(url, rules) {
  const hash = url.indexOf("#") < 0 ? url.length : url.indexOf("#");
  const question = url.indexOf("?");
  if (question < 0 || question > hash) return redactValues(url, rules.long);
  return `${redactValues(url.slice(0, question + 1), rules.long)}${redactEchoQuery(url.slice(question + 1, hash), rules)}${redactValues(url.slice(hash), rules.long)}`;
}

// A JSON text, rewritten in place so its spacing and numbers stay as written: each string value by
// redactEchoString, each secret key renamed as redactEchoJson does. A first pass reads each
// object's keys, so a renamed key can't take a name the object already has.
function redactEchoJsonText(source, rules) {
  const tokens = /"(?:[^"\\]|\\.)*"(\s*:)?|[{}[\]]/g;
  const walk = (visit) => {
    const stack = [];
    let objects = 0;
    return source.replace(tokens, (token, colon) => {
      if (token === "{") stack.push({ id: objects++, key: 0 });
      else if (token === "[") stack.push(null);
      else if (token === "}" || token === "]") stack.pop();
      else return visit(token, colon, stack.at(-1));
      return token;
    });
  };
  const keys = [];
  walk((literal, colon, object) => {
    if (colon && object) (keys[object.id] ||= []).push(JSON.parse(literal.slice(0, -colon.length)));
    return literal;
  });
  const names = keys.map((list) => renamedKeys(list || [], rules.keys));
  return walk((literal, colon, object) => {
    if (colon && object) {
      const key = keys[object.id][object.key];
      const name = names[object.id][object.key++];
      return name === key ? literal : `${JSON.stringify(name)}${colon}`;
    }
    const decoded = JSON.parse(literal);
    const redacted = redactEchoString(decoded, rules);
    return redacted === decoded ? literal : JSON.stringify(redacted);
  });
}

// A strict form-encoded text: `name=value` pairs joined by `&`, with no markup, spaces or newlines.
const FORM_PATTERN = /^[^=&\s<>]+=[^&\s<>]*(?:&[^=&\s<>]+=[^&\s<>]*)*$/;

// A body or header text: JSON by redactEchoJsonText, a strict form-encoded text by redactEchoQuery,
// and any other text by redactEchoWords. A bare number, boolean or null (a header's `true`) has no
// structure to keep, so it counts as text and goes when it is a secret whole; a body that must stay
// JSON goes through redactEchoBody. A text that is a secret whole, as written, goes whole, though
// it parses as JSON that holds something else (`"a"` for the secret `"a"`), as `<redacted/>` when
// it holds markup. `contentType` (the body's) tells XML from HTML; so does an XML declaration.
function redactEchoText(text, secrets, { contentType = "" } = {}) {
  const rules = echoRules(secrets);
  const source = String(text);
  if (rules.empty) return source;
  if (rules.whole.has(source.trim())) return MARKUP_PATTERN.test(source) ? MARKUP_WHOLE_MARKER : "<redacted>";
  let json = false;
  try {
    const parsed = JSON.parse(source);
    json = typeof parsed === "string" || (parsed !== null && typeof parsed === "object");
  } catch {}
  if (json) return redactEchoJsonText(source, rules);
  if (FORM_PATTERN.test(source)) return redactEchoQuery(source, rules);
  return redactEchoWords(source, rules, { xml: isXmlBody(source, contentType) });
}

// A body's content type: its `content-type` header, else the `mimeType` capture gave it.
function bodyContentType(headers, mimeType = "") {
  const found = headers && typeof headers === "object" ? Object.entries(headers).find(([name]) => name.toLowerCase() === "content-type") : undefined;
  return String(found ? found[1] : mimeType || "");
}

// A request or response body by redactEchoText, except that one that parses as JSON still does: a
// bare number, boolean or null that holds a secret becomes the JSON string "<redacted>".
function redactEchoBody(text, secrets, options = {}) {
  const source = String(text);
  const redacted = redactEchoText(source, secrets, options);
  if (redacted === source) return source;
  try {
    JSON.parse(source);
  } catch {
    return redacted;
  }
  try {
    JSON.parse(redacted);
    return redacted;
  } catch {
    return JSON.stringify("<redacted>");
  }
}

function isTemplate(value) {
  return typeof value === "string" && TEMPLATE_PATTERN.test(value);
}

function isSensitiveName(name) {
  return SECRET_NAME_PATTERN.test(String(name || ""));
}

function isSecretHeader(name) {
  const lower = String(name || "").toLowerCase();
  return SECRET_HEADERS.has(lower) || isSensitiveName(lower);
}

// A header value's parameters, split on `,` and `;` outside double quotes; inside them a backslash
// escapes the next character, so a quoted value keeps its commas, semicolons and quotes.
function headerParams(text) {
  const params = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted && char === "\\" && index + 1 < text.length) {
      current += char + text[++index];
      continue;
    }
    if (char === '"') quoted = !quoted;
    if (!quoted && (char === "," || char === ";")) {
      params.push(current.trim());
      current = "";
    } else current += char;
  }
  return [...params, current.trim()].filter(Boolean);
}

// The values of the secret headers in `headerSets` (and of the headers named in `names`), in the
// forms a body or another header can echo, as echoSecrets: each whole value and each piece of one.
// A piece is the credential after an auth scheme, or a cookie's or parameter's value, a quoted one
// inside its quotes, unescaped, and judged by that value's length with its escaped spelling (so
// redacting an echo leaves a JSON string's quotes alone). Redact echoes with redactEchoText,
// redactEchoBody, redactEchoJson or redactEchoUrl, which keep a short value from rewriting keys,
// numbers or structure.
function secretHeaderEchoes(headerSets, names = []) {
  const named = new Set(names.map((name) => String(name).toLowerCase()));
  const values = [];
  for (const headers of headerSets) {
    if (!headers || typeof headers !== "object" || Array.isArray(headers)) continue;
    for (const [name, value] of Object.entries(headers)) {
      const lower = name.toLowerCase();
      if (!isSecretHeader(lower) && !named.has(lower)) continue;
      const text = String(value);
      const credential = text.replace(/^[A-Za-z]+\s+/, "");
      const pieces = [credential];
      for (const param of headerParams(credential)) {
        const quote = param.indexOf('"');
        const equals = param.indexOf("=");
        const assigned = (equals >= 0 && (quote < 0 || equals < quote) ? param.slice(equals + 1) : param).trim();
        const quoted = assigned.match(/^"((?:[^"\\]|\\.)*)"$/s);
        pieces.push(quoted ? [quoted[1].replace(/\\(.)/gs, "$1"), quoted[1]] : assigned);
      }
      values.push(text, ...pieces);
    }
  }
  return echoSecrets(values);
}

function redactSensitiveFields(value) {
  if (Array.isArray(value)) return value.map(redactSensitiveFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveName(key) ? "<redacted>" : redactSensitiveFields(item),
    ]),
  );
}

// Masks bearer tokens, API keys and JWTs in free text, such as a response sample.
function redactCredentialLiterals(text) {
  return String(text).replace(new RegExp(CREDENTIAL_LITERAL_PATTERN.source, "gi"), "<redacted>");
}

function safeHeaders(headers = {}) {
  if (!headers || typeof headers !== "object") return {};
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !isSecretHeader(name)));
}

// Drops a URL's user and password and redacts its secret-named query params.
function redactUrlSecrets(url) {
  if (typeof url !== "string") return url;
  const absolute = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);
  let parsed;
  try {
    parsed = new URL(url, "https://surf.invalid");
  } catch {
    return url;
  }
  parsed.username = "";
  parsed.password = "";
  for (const [name] of parsed.searchParams) {
    if (isSensitiveName(name)) parsed.searchParams.set(name, "<redacted>");
  }
  return absolute ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

// An absolute URL as written, unless it holds a user, a password or a secret-named query param:
// then redactUrlSecrets of it.
function redactUrlIfSecret(url) {
  if (typeof url !== "string") return url;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const secretParam = [...parsed.searchParams.keys()].some(isSensitiveName);
  return parsed.username || parsed.password || secretParam ? redactUrlSecrets(url) : url;
}

// redactUrlIfSecret over every absolute URL in free text, such as a log line. A URL runs to the next
// space, so a quote inside a token can't leave the token's tail behind.
function redactUrlsInText(text) {
  return String(text).replace(/\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s<>`]+/g, (url) => redactUrlIfSecret(url));
}

// Walks `value` in order with its own stack, so JSON nested any depth is checked.
function assertNoEmbeddedSecrets(value, key = "value") {
  const stack = [{ value, key }];
  while (stack.length) {
    const { value: item, key: name, field } = stack.pop();
    if (field && isSensitiveName(name)) {
      if (isTemplate(item) || item === undefined || item === null || item === "") continue;
      throw new Error(`playbook requires an auth input instead of a literal ${name}`);
    }
    if (Array.isArray(item)) {
      for (let index = item.length - 1; index >= 0; index--) stack.push({ value: item[index], key: name });
    } else if (item && typeof item === "object") {
      const entries = Object.entries(item);
      for (let index = entries.length - 1; index >= 0; index--) stack.push({ value: entries[index][1], key: entries[index][0], field: true });
    } else if (typeof item === "string" && !isTemplate(item) && CREDENTIAL_LITERAL_PATTERN.test(item)) {
      throw new Error(`playbook contains a credential-like literal in ${name}`);
    }
  }
}

function assertUrlHasNoEmbeddedSecrets(url) {
  if (typeof url !== "string") return;
  let parsed;
  try {
    parsed = new URL(url, "https://surf.invalid");
  } catch {
    return;
  }
  for (const [name, value] of parsed.searchParams) {
    if (isSensitiveName(name) && !isTemplate(value)) {
      throw new Error(`playbook requires an auth input instead of a literal ${name}`);
    }
    assertNoEmbeddedSecrets(value, name);
  }
}

module.exports = {
  assertNoEmbeddedSecrets,
  assertUrlHasNoEmbeddedSecrets,
  bodyContentType,
  echoSecrets,
  isSecretHeader,
  isSensitiveName,
  isEchoedJson,
  isTemplate,
  redactCredentialLiterals,
  redactEchoBody,
  redactEchoJson,
  redactEchoText,
  redactEchoUrl,
  redactObject,
  redactSecretValues,
  redactSensitiveFields,
  redactUrlIfSecret,
  redactUrlSecrets,
  redactUrlsInText,
  redactValues,
  safeHeaders,
  secretHeaderEchoes,
  valueSpellings,
};
