// Values a record's own typing steps entered (type, locate.* --action fill, form.fill, select...),
// so the URLs its trace captured can hold a placeholder where one appears: `<text>`, `<text-2>`,
// `<value>`..., the name of the input the draft gives that step (`{{text}}`, `{{text-2}}`). The
// values live in the host's memory only, for as long as the record is open, and are never written.
const { commandMetadata } = require("./workflow-definition.cjs");

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

// A shorter value (a page number, a one-letter filter) matches too much to be redacted.
const MIN_LENGTH = 3;
// Inside a longer value (`{"rawQuery":"…"}`, `pizza near me`), a value must be longer still.
const MIN_INSIDE_LENGTH = 4;
// Enough for a value encoded twice over and its form-encoded spaces.
const MAX_DECODES = 4;
// The placeholders a draft or trace can hold where a value was redacted.
const PLACEHOLDER = /<(?:text|value|values|data|redacted|request-body)(?:-\d+)?>/;
const WHOLE_PLACEHOLDER = new RegExp(`^${PLACEHOLDER.source}$`);
const REDACTED_MARKER = /^<([a-z0-9._-]+)>$/;

const held = new Map();

function typedArg(command, args) {
  const name = TYPED_ARGS[command];
  if (!name || args?.[name] === undefined) return null;
  if (command.startsWith("locate.") && args.action !== "fill") return null;
  return name;
}

/** [{ value, marker }] for the values one command typed, each marked with its argument's name. */
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
    return items.map((item) => item?.value).filter((value) => typeof value === "string" && value).map((value) => ({ value, marker: "<data>" }));
  }
  return (Array.isArray(raw) ? raw : [raw])
    .filter((value) => (typeof value === "string" && value) || typeof value === "number")
    .map((value) => ({ value: String(value), marker: `<${name}>` }));
}

/** Holds what one typing call entered. `paused`: the record was paused, so the call gets no event. */
function rememberTypedValues(recordId, command, args, { paused = false } = {}) {
  if (!typedArg(command, args)) return;
  const calls = held.get(recordId) || [];
  calls.push({ command, values: typedValues(command, args).map(({ value }) => value), paused });
  held.set(recordId, calls);
}

function heldTypingCalls(recordId) {
  return held.get(recordId) || [];
}

function forgetTypedValues(recordId) {
  held.delete(recordId);
}

/**
 * Numbers the redacted markers in drafted steps the way the draft names its inputs: the first
 * `<text>` stays `<text>`, the next becomes `<text-2>`, so each typing step gets its own input.
 * `<redacted>` (a secret-named field) is left as is.
 */
function numberRedactedMarkers(steps) {
  const counts = new Map();
  const visit = (value) => {
    if (typeof value === "string") {
      const name = value.match(REDACTED_MARKER)?.[1];
      if (!name || name === "redacted") return value;
      const count = (counts.get(name) || 0) + 1;
      counts.set(name, count);
      return count === 1 ? value : `<${name}-${count}>`;
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
    return value;
  };
  return steps.map((step) => ({ ...step, args: visit(step.args || {}) }));
}

/** The steps a draft is made of: the record's completed, recordable commands, in order. */
function draftedEvents(events) {
  return events.filter((event) => event.type === "tool.completed" && commandMetadata(event.command).recordable);
}

/**
 * Pairs the held typing calls with the record's typing events and gives each value the
 * placeholder of its drafted step. Calls and events come in the same order; after a host restart
 * the first calls are gone, so they are paired from the end. `unheld` counts typing events with
 * no call. A failed step isn't drafted, so its values become `<redacted>`.
 */
function typedValuesForTrace(events, calls) {
  const drafted = draftedEvents(events);
  const numbered = numberRedactedMarkers(drafted.map((event) => ({ args: event.argsRedacted || {} })));
  const markers = new Map(drafted.map((event, index) => {
    const name = typedArg(event.command, event.argsRedacted);
    const marker = name ? numbered[index].args[name] : undefined;
    return [event, typeof marker === "string" && REDACTED_MARKER.test(marker) ? marker : "<redacted>"];
  }));
  const typing = events.filter((event) => ["tool.completed", "tool.failed"].includes(event.type) && typedArg(event.command, event.argsRedacted));
  const evented = calls.filter((call) => !call.paused);
  const paired = Math.min(typing.length, evented.length);
  const markerOf = new Map();
  for (let offset = 1; offset <= paired; offset++) {
    markerOf.set(evented[evented.length - offset], markers.get(typing[typing.length - offset]) || "<redacted>");
  }
  const typed = calls.flatMap((call) => call.values.map((value) => ({ value, marker: markerOf.get(call) || "<redacted>" })));
  return { typed, unheld: typing.length - paired };
}

// Decodes each well-formed run of %XX, so a stray `%` (`romeo%`) doesn't stop the rest decoding.
const decode = (text) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        return run;
      }
    });
  }
};

// Every reading of a URL part, shallowest first: as is, percent-decoded and form-decoded (+ for
// space), repeatedly. `depth` counts the decodes that gave it.
function decodings(raw) {
  const seen = new Set([raw]);
  const readings = [{ text: raw, depth: 0 }];
  let current = [raw];
  for (let depth = 1; depth <= MAX_DECODES && current.length > 0; depth++) {
    current = current.flatMap((text) => [decode(text), decode(text.replace(/\+/g, " "))]).filter((text) => !seen.has(text) && seen.add(text));
    readings.push(...current.map((text) => ({ text, depth })));
  }
  return readings;
}

// The forms a typed value takes in a URL: as typed, percent-encoded, and form-encoded (+ for space).
function encodedForms(value) {
  const encoded = encodeURIComponent(value);
  return [...new Set([value, encoded, encoded.replace(/%20/g, "+"), value.replace(/ /g, "+")])];
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One URL part with the typed values in it replaced: the whole part becomes the marker when it
 * is a value; otherwise a value of 4 or more characters inside it, between non-alphanumeric
 * characters (`"rawQuery":"…"`, but not `name` in `username`), becomes the marker, in the
 * shallowest reading that holds one, encoded again as many times as it was decoded.
 */
function redactPart(raw, typed) {
  if (!raw) return raw;
  const readings = decodings(raw);
  const whole = typed.find(({ value }) => value.length >= MIN_LENGTH && readings.some(({ text }) => text === value));
  if (whole) return whole.marker;
  const inside = typed.filter(({ value }) => value.length >= MIN_INSIDE_LENGTH).sort((a, b) => b.value.length - a.value.length);
  for (const { text, depth } of readings) {
    const replaced = inside.reduce((current, { value, marker }) => current.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(value)}(?![\\p{L}\\p{N}])`, "gu"), marker), text);
    if (replaced === text) continue;
    let encoded = replaced;
    for (let round = 0; round < depth; round++) encoded = encodeURIComponent(encoded);
    return encoded;
  }
  return raw;
}

// Pairs (key=value) keep their keys; a part without `=` is a value.
function redactPairs(text, typed) {
  return text.split("&").map((pair) => {
    const split = pair.indexOf("=");
    if (split < 0) return redactPart(pair, typed);
    return `${pair.slice(0, split + 1)}${redactPart(pair.slice(split + 1), typed)}`;
  }).join("&");
}

/**
 * Replaces each typed value in `url` with its marker in query values, path segments, the
 * fragment and fragment values, however many times it was encoded: a whole value, or one of 4 or
 * more characters inside a longer value at word boundaries. Keys and the origin are never changed.
 */
function redactTypedValuesInUrl(url, typed) {
  if (typeof url !== "string" || typed.length === 0) return url;
  const match = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*)?([^?#]*)(\?[^#]*)?(#.*)?$/s);
  if (!match) return url;
  const [, origin = "", pathname, query, fragment] = match;
  const path = pathname.split("/").map((segment) => redactPart(segment, typed)).join("/");
  const search = query === undefined ? "" : `?${redactPairs(query.slice(1), typed)}`;
  let hash = "";
  if (fragment !== undefined) {
    const body = fragment.slice(1);
    hash = `#${body.includes("=") ? redactPairs(body, typed) : redactPart(body, typed)}`;
  }
  return `${origin}${path}${search}${hash}`;
}

// A placeholder a body holds as the whole body or a whole field value: a JSON string or a
// urlencoded value. Markup such as XML-RPC's <value> is part of a longer value, so isn't one.
function bodyPlaceholder(body) {
  if (body && typeof body === "object") {
    for (const item of Object.values(body)) {
      const placeholder = bodyPlaceholder(item);
      if (placeholder) return placeholder;
    }
    return null;
  }
  if (typeof body !== "string") return null;
  const whole = decodings(body).find(({ text }) => WHOLE_PLACEHOLDER.test(text));
  if (whole) return whole.text;
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === "object") return bodyPlaceholder(parsed);
  } catch {}
  if (!body.includes("=")) return null;
  for (const pair of body.split("&")) {
    const placeholder = pair.includes("=") && bodyPlaceholder(pair.slice(pair.indexOf("=") + 1));
    if (placeholder) return placeholder;
  }
  return null;
}

/**
 * The first place a network request (url, query, headers, body) still holds a redacted
 * placeholder, as `{ field, placeholder }`, or null. Sending one would send `<text>` to the site.
 * In the URL and headers a placeholder can sit inside a longer value (`{"rawQuery":"<text>"}`).
 */
function findRedactedPlaceholder(request) {
  const found = (field, value) => {
    const text = typeof value === "string" ? value : value && typeof value === "object" ? JSON.stringify(value) : "";
    const placeholder = decodings(text).map(({ text: reading }) => reading.match(PLACEHOLDER)?.[0]).find(Boolean);
    return placeholder ? { field, placeholder } : null;
  };
  const segments = String(request?.url || "").replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*/, "").split(/[?#]/)[0].split("/").slice(1);
  for (const [index, segment] of segments.entries()) {
    const hit = found(`path.${index + 1}`, segment);
    if (hit) return hit;
  }
  for (const [name, value] of Object.entries(request?.query || {})) {
    const hit = found(`query.${name}`, value);
    if (hit) return hit;
  }
  for (const [name, value] of Object.entries(request?.headers || {})) {
    const hit = found(`headers.${name}`, value);
    if (hit) return hit;
  }
  const placeholder = request?.body === undefined ? null : bodyPlaceholder(request.body);
  return placeholder ? { field: "body", placeholder } : null;
}

/** The error for a request that holds a placeholder, naming the pb param command that fixes it. */
function placeholderError({ field, placeholder }, label = "<playbook> <op>") {
  if (placeholder === "<request-body>") return new Error(`${field} holds ${placeholder}: the record redacted the request body; record again with pb record start --include-input-values to keep it`);
  return new Error(`${field} holds ${placeholder}, a value the record redacted; run surf pb param ${label} ${field} --as <name> to make it an input (or record again with pb record start --include-input-values)`);
}

module.exports = {
  draftedEvents,
  encodedForms,
  findRedactedPlaceholder,
  forgetTypedValues,
  heldTypingCalls,
  numberRedactedMarkers,
  placeholderError,
  redactTypedValuesInUrl,
  rememberTypedValues,
  typedArg,
  typedValues,
  typedValuesForTrace,
};
