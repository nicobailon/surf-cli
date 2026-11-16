// Values a record's own typing steps entered (type, locate.* --action fill, form.fill, select...),
// so the URLs its trace captured can hold `<text>` or `<value>` where they appear, the way the
// drafted step holds `{{text}}` or `{{value}}`. The values live in the host's memory only, for as
// long as the record is open, and are never written anywhere.

// The argument each command types, named as its redacted step names it.
const TYPED_ARGS = {
  type: "text",
  smart_type: "text",
  find_and_type: "text",
  form_input: "value",
  "locate.role": "value",
  "locate.text": "value",
  "locate.label": "value",
  select: "values",
  "form.fill": "data",
  "dialog.accept": "text",
};

// Shorter values replace only a whole query value or path segment, so a short value can't break up
// the text around it.
const MIN_SUBSTRING_LENGTH = 4;

const held = new Map();

function typedArg(command, args) {
  const name = TYPED_ARGS[command];
  if (!name || args?.[name] === undefined) return null;
  if (command.startsWith("locate.") && args.action !== "fill") return null;
  return name;
}

// [{ value, marker }] for the values one command typed.
function typedValues(command, args) {
  const name = typedArg(command, args);
  if (!name) return [];
  let raw = args[name];
  if (name === "data") {
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch {
        return [];
      }
    }
    const items = Array.isArray(raw) ? raw : [];
    return items.map((item) => item?.value).filter((value) => typeof value === "string" && value).map((value) => ({ value, marker: "<value>" }));
  }
  return (Array.isArray(raw) ? raw : [raw])
    .filter((value) => (typeof value === "string" && value) || typeof value === "number")
    .map((value) => ({ value: String(value), marker: `<${name}>` }));
}

function rememberTypedValues(recordId, command, args) {
  if (!typedArg(command, args)) return;
  const entry = held.get(recordId) || { values: new Map(), steps: 0 };
  entry.steps++;
  for (const { value, marker } of typedValues(command, args)) {
    if (!entry.values.has(value)) entry.values.set(value, marker);
  }
  held.set(recordId, entry);
}

function heldTypedValues(recordId) {
  const entry = held.get(recordId);
  const values = entry ? [...entry.values].map(([value, marker]) => ({ value, marker })) : [];
  return { values: values.sort((a, b) => b.value.length - a.value.length), steps: entry?.steps || 0 };
}

function forgetTypedValues(recordId) {
  held.delete(recordId);
}

const decode = (text) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};
const decodeForm = (text) => decode(text.replace(/\+/g, " "));

// The forms a typed value takes in a URL: as typed, percent-encoded, and form-encoded (+ for space).
function encodedForms(value) {
  const encoded = encodeURIComponent(value);
  return [...new Set([value, encoded, encoded.replace(/%20/g, "+"), value.replace(/ /g, "+")])];
}

/**
 * Replaces each typed value in `url` with its marker: a path segment or query value that is the
 * value, and any other place in the query or fragment that holds it. The origin is never changed.
 */
function redactTypedValuesInUrl(url, typed) {
  if (typeof url !== "string" || typed.length === 0) return url;
  const match = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*)?([^?#]*)(.*)$/s);
  if (!match) return url;
  const origin = match[1] || "";
  let pathname = match[2];
  let tail = match[3];
  for (const { value, marker } of typed) {
    pathname = pathname.split("/").map((segment) => (segment && (decode(segment) === value || decodeForm(segment) === value) ? marker : segment)).join("/");
    tail = tail.replace(/([?&#;][^=&#;]*=)([^&#;]*)/g, (pair, key, raw) => (raw && decodeForm(raw) === value ? `${key}${marker}` : pair));
    if (value.length >= MIN_SUBSTRING_LENGTH) {
      for (const form of encodedForms(value)) tail = tail.split(form).join(marker);
    }
  }
  return `${origin}${pathname}${tail}`;
}

module.exports = { forgetTypedValues, heldTypedValues, redactTypedValuesInUrl, rememberTypedValues, typedArg };
