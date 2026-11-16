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
// replaced only where it stands alone, so a short value can't break up the words around it, unless
// `anyLength` is set: for values known to be secrets (env values), every occurrence goes.
// Self-contained: generated clients embed its source.
function redactValues(text, values, { anyLength = false } = {}) {
  let result = String(text);
  const sorted = [...values].map(String).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const value of sorted) {
    if (anyLength || value.length >= 8) result = result.split(value).join("<redacted>");
    else result = result.replace(new RegExp(`(?<![A-Za-z0-9])${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "g"), "<redacted>");
  }
  return result;
}

// redactValues over a JSON value: strings, and object keys too, at any depth. A key that redacts to
// one already present (another redacted key, or a key that reads <redacted>) takes <redacted-2>,
// <redacted-3>... so no entry is lost. Keys left unchanged keep their names. Self-contained but for
// redactValues: generated clients embed both.
function redactObject(value, values, options = {}) {
  if (typeof value === "string") return redactValues(value, values, options);
  if (Array.isArray(value)) return value.map((item) => redactObject(item, values, options));
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value).map(([key, item]) => [key, redactValues(key, values, options), redactObject(item, values, options)]);
  const taken = new Set(entries.filter(([key, redacted]) => key === redacted).map(([key]) => key));
  return Object.fromEntries(entries.map(([key, redacted, item]) => {
    if (key === redacted) return [key, item];
    let name = redacted;
    for (let index = 2; taken.has(name); index++) name = redacted.replace(/<redacted>/, `<redacted-${index}>`);
    taken.add(name);
    return [name, item];
  }));
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

function redactUrlSecrets(url) {
  if (typeof url !== "string") return url;
  const absolute = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);
  let parsed;
  try {
    parsed = new URL(url, "https://surf.invalid");
  } catch {
    return url;
  }
  for (const [name] of parsed.searchParams) {
    if (isSensitiveName(name)) parsed.searchParams.set(name, "<redacted>");
  }
  return absolute ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`;
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
  redactObject,
  redactSensitiveFields,
  redactUrlSecrets,
  redactValues,
  safeHeaders,
};
