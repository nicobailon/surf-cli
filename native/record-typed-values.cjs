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
// Enough for a value encoded twice over and its form-encoded spaces.
const MAX_DECODES = 4;
// The placeholders a draft or trace can hold where a value was redacted.
const PLACEHOLDER = /<(?:text|value|values|data|redacted|request-body)(?:-\d+)?>/;
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

const decode = (text) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

// Every reading of a URL part: as is, percent-decoded and form-decoded (+ for space), repeatedly.
function decodings(raw) {
  const seen = new Set([raw]);
  let current = [raw];
  for (let round = 0; round < MAX_DECODES && current.length > 0; round++) {
    current = current.flatMap((text) => [decode(text), decode(text.replace(/\+/g, " "))]).filter((text) => !seen.has(text));
    for (const text of current) seen.add(text);
  }
  return seen;
}

// The forms a typed value takes in a URL: as typed, percent-encoded, and form-encoded (+ for space).
function encodedForms(value) {
  const encoded = encodeURIComponent(value);
  return [...new Set([value, encoded, encoded.replace(/%20/g, "+"), value.replace(/ /g, "+")])];
}

function markerFor(raw, typed) {
  if (!raw) return undefined;
  const readings = decodings(raw);
  return typed.find(({ value }) => value.length >= MIN_LENGTH && readings.has(value))?.marker;
}

// Pairs (key=value) keep their keys; a part without `=` is a value.
function redactPairs(text, typed) {
  return text.split("&").map((pair) => {
    const split = pair.indexOf("=");
    if (split < 0) return markerFor(pair, typed) || pair;
    const value = pair.slice(split + 1);
    return `${pair.slice(0, split + 1)}${markerFor(value, typed) || value}`;
  }).join("&");
}

/**
 * Replaces each typed value in `url` with its marker where a whole query value, path segment,
 * fragment or fragment value is that value, however many times it was encoded. Keys, the origin
 * and parts of longer values are never changed.
 */
function redactTypedValuesInUrl(url, typed) {
  if (typeof url !== "string" || typed.length === 0) return url;
  const match = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*)?([^?#]*)(\?[^#]*)?(#.*)?$/s);
  if (!match) return url;
  const [, origin = "", pathname, query, fragment] = match;
  const path = pathname.split("/").map((segment) => markerFor(segment, typed) || segment).join("/");
  const search = query === undefined ? "" : `?${redactPairs(query.slice(1), typed)}`;
  let hash = "";
  if (fragment !== undefined) {
    const body = fragment.slice(1);
    hash = `#${body.includes("=") ? redactPairs(body, typed) : markerFor(body, typed) || body}`;
  }
  return `${origin}${path}${search}${hash}`;
}

/**
 * The first place a network request (url, query, headers, body) still holds a redacted
 * placeholder, as `{ field, placeholder }`, or null. Sending one would send `<text>` to the site.
 */
function findRedactedPlaceholder(request) {
  const found = (field, value) => {
    const text = typeof value === "string" ? value : value && typeof value === "object" ? JSON.stringify(value) : "";
    const placeholder = (text.match(PLACEHOLDER) || decode(text).match(PLACEHOLDER))?.[0];
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
  return request?.body === undefined ? null : found("body", request.body);
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
