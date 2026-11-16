// Redacts the values of secret-named fields (password, token, api_key... as redaction.cjs names
// them) in a request or response body: JSON, form-urlencoded and multipart. Everything else in the
// body is kept as captured; a body in any other format is returned unchanged.
const { isSensitiveName, redactSensitiveFields } = require("./redaction.cjs");

const REDACTED = "<redacted>";

const decodeForm = (text) => {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text;
  }
};

function redactJson(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const redacted = redactSensitiveFields(parsed);
  return JSON.stringify(redacted) === JSON.stringify(parsed) ? body : JSON.stringify(redacted);
}

function redactForm(body) {
  return body.split("&").map((pair) => {
    const [key, ...value] = pair.split("=");
    return value.length > 0 && isSensitiveName(decodeForm(key)) ? `${key}=${REDACTED}` : pair;
  }).join("&");
}

function redactMultipart(body, boundary) {
  return body.split(`--${boundary}`).map((part) => {
    const split = part.match(/\r?\n\r?\n/);
    if (!split) return part;
    const head = part.slice(0, split.index);
    const name = head.match(/name="([^"]*)"/i)?.[1];
    if (name === undefined || /filename=/i.test(head) || !isSensitiveName(name)) return part;
    const start = split.index + split[0].length;
    const ending = part.match(/\r?\n$/)?.[0] || "";
    return `${part.slice(0, start)}${REDACTED}${ending}`;
  }).join(`--${boundary}`);
}

/** `contentType` is the body's Content-Type header, or the response's MIME type. */
function redactSecretBodyFields(body, contentType = "") {
  if (typeof body !== "string" || body === "") return body;
  const type = String(contentType).toLowerCase();
  const json = redactJson(body);
  if (json !== null) return json;
  if (type.includes("multipart/form-data") || body.startsWith("--")) {
    const boundary = String(contentType).match(/boundary="?([^";]+)"?/i)?.[1] || body.match(/^--([^\r\n]+)\r?\n/)?.[1];
    if (boundary) return redactMultipart(body, boundary);
  }
  if (type.includes("application/x-www-form-urlencoded") || /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(body)) return redactForm(body);
  return body;
}

module.exports = { redactSecretBodyFields };
