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

// Echoes of secret header values (see secretHeaderEchoes) are redacted without changing what holds
// them. `secrets` is { values, wholeOnly }: each spelling of a whole header value or a long
// parameter, and of a short auth parameter. A value of 8 characters or more goes wherever it
// appears; a shorter one only as a whole value (a whole JSON string, or a whole query or form
// value), never inside a number or the structure around it; in other text a short whole header
// value only where it stands alone, and a short parameter never. A key goes only when it is a
// whole secret of 4 characters or more. So a JSON text stays valid JSON, and a URL keeps its form.
function echoRules({ values = [], wholeOnly = [] } = {}) {
  const texts = values.map(String).filter(Boolean);
  const params = wholeOnly.map(String).filter(Boolean);
  const all = [...texts, ...params];
  return {
    empty: all.length === 0,
    long: texts.filter((value) => value.length >= 8),
    whole: new Set(all),
    keys: new Set(all.filter((value) => value.length >= 4)),
    text: texts,
  };
}

// The names `keys` take: a secret one <redacted>, or <redacted-2>, <redacted-3>... when the name is
// taken, so no entry is lost; the others as they are.
function renamedKeys(keys, secretKeys) {
  const taken = new Set(keys.filter((key) => !secretKeys.has(key)));
  return keys.map((key) => {
    if (!secretKeys.has(key)) return key;
    let name = "<redacted>";
    for (let index = 2; taken.has(name); index++) name = `<redacted-${index}>`;
    taken.add(name);
    return name;
  });
}

// A string value: <redacted> when it is a secret whole, else with each long value replaced.
function redactEchoString(text, rules) {
  return rules.whole.has(text) ? "<redacted>" : redactValues(text, rules.long);
}

// A parsed JSON value: its strings by redactEchoString and its secret keys renamed, at any depth;
// numbers and other keys as they are.
function redactEchoJson(value, secrets) {
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
// decoded spelling, whatever its length; each long value within any other; a name only when it is a
// key-length secret whole. `&` and `=` stay as they are.
function redactEchoQuery(query, rules) {
  const decode = (text) => {
    try {
      return decodeURIComponent(text.replace(/\+/g, " "));
    } catch {
      return text;
    }
  };
  const value = (raw) => (rules.whole.has(raw) || rules.whole.has(decode(raw)) ? "<redacted>" : redactValues(raw, rules.long));
  return query.split("&").map((pair) => {
    const equals = pair.indexOf("=");
    if (equals < 0) return value(pair);
    const name = pair.slice(0, equals);
    const kept = rules.keys.has(name) || rules.keys.has(decode(name)) ? "<redacted>" : name;
    return `${kept}=${value(pair.slice(equals + 1))}`;
  }).join("&");
}

// A URL: its query by redactEchoQuery, and long values anywhere else in it.
function redactEchoUrl(url, secrets) {
  if (typeof url !== "string") return url;
  const rules = echoRules(secrets);
  if (rules.empty) return url;
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
// and any other text with long values anywhere and a short whole header value where it stands alone.
function redactEchoText(text, secrets) {
  const rules = echoRules(secrets);
  const source = String(text);
  if (rules.empty) return source;
  let json = false;
  try {
    JSON.parse(source);
    json = true;
  } catch {}
  if (json) return redactEchoJsonText(source, rules);
  if (FORM_PATTERN.test(source)) return redactEchoQuery(source, rules);
  return redactValues(source, rules.text);
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
// forms a body or another header can echo, each in every spelling (see valueSpellings): `values`
// holds each whole value and each piece of 8 characters or more, `wholeOnly` each shorter auth
// parameter. A piece is the credential after an auth scheme, or a cookie's or parameter's value, a
// quoted one inside its quotes, as written and unescaped (so redacting an echo leaves a JSON
// string's quotes alone). A short cookie value (`lang=en`) is no secret by itself and isn't kept.
// Redact echoes with redactEchoText, redactEchoJson or redactEchoUrl, which keep a short value
// from rewriting keys, numbers or structure.
function secretHeaderEchoes(headerSets, names = []) {
  const named = new Set(names.map((name) => String(name).toLowerCase()));
  const values = [];
  const wholeOnly = [];
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
        pieces.push(...(quoted ? [quoted[1], quoted[1].replace(/\\(.)/gs, "$1")] : [assigned]));
      }
      const cookie = lower === "cookie" || lower === "set-cookie";
      values.push(text, ...pieces.filter((piece) => piece.length >= 8));
      if (!cookie) wholeOnly.push(...pieces.filter((piece) => piece && piece.length < 8));
    }
  }
  const spell = (list) => [...new Set(list.flatMap(valueSpellings))];
  return { values: spell(values), wholeOnly: spell(wholeOnly) };
}

// secretHeaderEchoes(...).values of one header set: what free text, such as a response sample,
// can't hold.
function secretHeaderValues(headers, names = []) {
  return secretHeaderEchoes([headers], names).values;
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
  isSecretHeader,
  isSensitiveName,
  isTemplate,
  redactCredentialLiterals,
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
  secretHeaderValues,
  valueSpellings,
};
