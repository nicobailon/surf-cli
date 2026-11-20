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

function isTemplate(value) {
  return typeof value === "string" && TEMPLATE_PATTERN.test(value);
}

function isSensitiveName(name) {
  return SECRET_NAME_PATTERN.test(String(name || "")) && !aboutSecret(name);
}

// A field is secret when its name, split into words, names one: `newPassword`, `user[password]`,
// `csrfToken` and `password1` read as `new_password` etc.; `custname` and `keyword` don't.
const spaced = (name) => String(name).replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_");
// A name that ends in a word about the secret names a fact about it, not the secret: its count,
// type, expiry or length (`token_count`, `token_type`, `password_length`, `token_expires_at`), or
// a key's id (`api_key_id`). Any other id or number of a secret is a credential: `secret_id`
// (Vault AppRole), `tokenId` (ForgeRock), `session_id`, `csrf_id`, `otp_number`.
const ABOUT_SECRET = /(?:_(?:count|total|type|kind|expiry|exp|expires(?:_(?:at|in|on))?|expiration(?:_(?:date|time))?|ttl|length|len|size|min|max)|key_ids?)$/;
const aboutSecret = (name) => ABOUT_SECRET.test(spaced(name).replace(/\d+(?=_|$)/g, "").replace(/^_+|_+$/g, "").toLowerCase());
const isSecret = (name) => {
  const words = spaced(name).replace(/\d+(?=_|$)/g, "");
  return !aboutSecret(name) && (isSensitiveName(words) || /(?:^|_)(?:pass|pwd|otp)(?:$|_)/i.test(words));
};

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

function assertNoEmbeddedSecrets(value, key = "value") {
  if (Array.isArray(value)) {
    for (const item of value) assertNoEmbeddedSecrets(item, key);
    return;
  }
  if (value && typeof value === "object") {
    for (const [name, item] of Object.entries(value)) {
      // A secret-named wrapper ({ "session": { ... } }) is checked field by field.
      if (isSensitiveName(name) && (item === null || typeof item !== "object")) {
        if (isTemplate(item) || item === undefined || item === null || item === "") continue;
        throw new Error(`playbook requires an auth input instead of a literal ${name}`);
      }
      assertNoEmbeddedSecrets(item, name);
    }
    return;
  }
  if (typeof value === "string" && !isTemplate(value) && CREDENTIAL_LITERAL_PATTERN.test(value)) {
    throw new Error(`playbook contains a credential-like literal in ${key}`);
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
  isSecret,
  isSecretHeader,
  isSensitiveName,
  isTemplate,
  redactSensitiveFields,
  redactUrlSecrets,
  safeHeaders,
  spaced,
};
