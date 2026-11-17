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

/**
 * Holds what one typing call entered. `evented: false`: the call gets no typing event of its own
 * (the record was paused, or a batch ran it), so no drafted step names its values.
 */
function rememberTypedValues(recordId, command, args, { evented = true } = {}) {
  if (!typedArg(command, args)) return;
  const calls = held.get(recordId) || [];
  calls.push({ command, values: typedValues(command, args).map(({ value }) => value), evented });
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
  const evented = calls.filter((call) => call.evented);
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

// The character a well-formed run of 1 to 4 %XX escapes at `index` encodes (UTF-8), or null.
function escapedChar(text, index) {
  for (let count = 1; count <= 4; count++) {
    const run = text.slice(index, index + 3 * count);
    if (!/^(?:%[0-9a-fA-F]{2})+$/.test(run) || run.length !== 3 * count) return null;
    try {
      return { char: decodeURIComponent(run), size: run.length };
    } catch {}
  }
  return null;
}

// One decode of `text`, with where each decoded character came from: `starts[i]` is the index in
// `text` where character i begins, `starts[length]` the end. An escape decodes whole or not at all.
function decodeOnce(text, plusIsSpace) {
  let decoded = "";
  const starts = [];
  for (let index = 0; index < text.length;) {
    const escaped = text[index] === "%" ? escapedChar(text, index) : null;
    const char = escaped ? escaped.char : plusIsSpace && text[index] === "+" ? " " : text[index];
    for (let offset = 0; offset < char.length; offset++) starts.push(index);
    decoded += char;
    index += escaped ? escaped.size : 1;
  }
  starts.push(text.length);
  return { decoded, starts };
}

// Every reading of a value: as captured, then decoded once more at each depth, `+` a space only
// in the outermost encoding or in every one. `toRaw` maps each position back to `raw`; `depth`
// counts the decodes that gave it.
function readingsOf(raw) {
  const readings = [{ text: raw, toRaw: (index) => index, depth: 0 }];
  for (const plusEveryLevel of [false, true]) {
    let text = raw;
    let toRaw = readings[0].toRaw;
    for (let depth = 1; depth <= MAX_DECODES; depth++) {
      const { decoded, starts } = decodeOnce(text, depth === 1 || plusEveryLevel);
      if (decoded === text) break;
      const outer = toRaw;
      toRaw = (index) => outer(starts[index]);
      text = decoded;
      if (!readings.some((reading) => reading.text === text)) readings.push({ text, toRaw, depth });
    }
  }
  return readings;
}

// Whether `index` falls inside a %XX escape of `text` (`20abc` in `hello%20abc`).
const HEX = /[0-9a-fA-F]/;
const insideEscape = (text, index) =>
  (text[index - 1] === "%" && HEX.test(text[index] || "") && HEX.test(text[index + 1] || "")) ||
  (text[index - 2] === "%" && HEX.test(text[index - 1]) && HEX.test(text[index] || ""));

// Where a JSON object or array's values sit in `text`: the inside of each string value (never a
// key) and each number, true, false or null, which only a whole match may replace. Null if
// `text` isn't one.
function jsonValueSpans(text) {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return null;
  } catch {
    return null;
  }
  const spans = [];
  const token = /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}[\]:,]|\s+/y;
  const colon = /\s*:/y;
  for (let match = token.exec(text); match; match = token.exec(text)) {
    const [found] = match;
    if (/^[\s{}[\]:,]/.test(found)) continue;
    if (!found.startsWith('"')) {
      spans.push({ start: match.index, end: token.lastIndex, scalar: true });
      continue;
    }
    colon.lastIndex = token.lastIndex;
    if (!colon.test(text)) spans.push({ start: match.index + 1, end: token.lastIndex - 1, scalar: false });
  }
  return spans;
}

// The ranges of `raw` where a typed value of 4 or more characters sits inside a reading of the
// value, as typed, between non-alphanumeric characters (`"rawQuery":"…"`, `pizza near me`, but
// not `name` in `username`), never splitting an escape or touching a placeholder already there,
// and in JSON only in values. Each range spans whole escapes of `raw`. A JSON number or boolean
// is replaced with a JSON string, its quotes encoded as the reading's depth encodes the rest.
function insideRanges(raw, typed) {
  const values = typed.filter(({ value }) => value.length >= MIN_INSIDE_LENGTH).sort((a, b) => b.value.length - a.value.length);
  const ranges = [];
  for (const { text, toRaw, depth } of readingsOf(raw)) {
    const spans = jsonValueSpans(text);
    const placeholders = [...text.matchAll(new RegExp(PLACEHOLDER.source, "g"))].map((match) => ({ start: match.index, end: match.index + match[0].length }));
    const span = (start, end) => (spans ? spans.find((item) => (item.scalar ? start === item.start && end === item.end : start >= item.start && end <= item.end)) : {});
    const clear = (start, end) => !insideEscape(text, start) && !insideEscape(text, end) && !placeholders.some((item) => start < item.end && item.start < end);
    for (const { value, marker } of values) {
      const forms = spans ? [...new Set([value, JSON.stringify(value).slice(1, -1)])] : [value];
      for (const form of forms) {
        for (const match of text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(form)}(?![\\p{L}\\p{N}])`, "gu"))) {
          const start = match.index;
          const end = start + form.length;
          const where = span(start, end);
          if (!where || !clear(start, end)) continue;
          let quote = '"';
          for (let level = 0; level < depth; level++) quote = encodeURIComponent(quote);
          ranges.push({ start: toRaw(start), end: toRaw(end), value, marker: where.scalar ? `${quote}${marker}${quote}` : marker });
        }
      }
    }
  }
  return ranges;
}

/**
 * One URL part with the typed values in it replaced. The whole part becomes the marker when it
 * decodes to a typed value. Otherwise, with `inside` (a query or fragment value, not a path
 * segment), every typed value found inside a decoding of the value becomes its marker, and the
 * rest of the part is kept exactly as it was encoded. Each value replaced is added to `found`.
 */
function redactPart(raw, typed, { inside = true, found = new Set() } = {}) {
  if (!raw) return raw;
  const readings = decodings(raw);
  const whole = typed.find(({ value }) => value.length >= MIN_LENGTH && readings.some(({ text }) => text === value));
  if (whole) {
    found.add(whole.value);
    return whole.marker;
  }
  if (!inside) return raw;
  const kept = [];
  for (const range of insideRanges(raw, typed)) {
    if (!kept.some((other) => range.start < other.end && other.start < range.end)) kept.push(range);
  }
  kept.sort((a, b) => a.start - b.start);
  let result = "";
  let index = 0;
  for (const { start, end, value, marker } of kept) {
    found.add(value);
    result += raw.slice(index, start) + marker;
    index = end;
  }
  return result + raw.slice(index);
}

// Pairs (key=value) keep their keys; a part without `=` is a value.
function redactPairs(text, typed, found) {
  return text.split("&").map((pair) => {
    const split = pair.indexOf("=");
    if (split < 0) return redactPart(pair, typed, { found });
    return `${pair.slice(0, split + 1)}${redactPart(pair.slice(split + 1), typed, { found })}`;
  }).join("&");
}

// Path segments are route pieces as well as values, so only a whole segment is replaced.
const redactPath = (text, typed) => text.split("/").map((segment) => redactPart(segment, typed, { inside: false })).join("/");

/**
 * Replaces each typed value in `url` with its marker in query values, path segments, the
 * fragment and fragment values, however many times it was encoded: a whole value or path
 * segment, or one of 4 or more characters inside a longer query or fragment value. Keys, JSON
 * keys, escapes, placeholders and the origin are never changed. A value that is also a query,
 * fragment or `body` value leaves the path as captured: there it is a fixed route piece
 * (/api/users?q=users), and naming the value with pb param leaves a request that replays.
 */
function redactTypedValuesInUrl(url, typed, { body } = {}) {
  if (typeof url !== "string" || typed.length === 0) return url;
  const match = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*)?([^?#]*)(\?[^#]*)?(#.*)?$/s);
  if (!match) return url;
  const [, origin = "", pathname, query, fragment] = match;
  const found = new Set();
  if (typeof body === "string" && body) {
    if (body.includes("=") && !jsonValueSpans(body)) redactPairs(body, typed, found);
    else redactPart(body, typed, { found });
  }
  const search = query === undefined ? "" : `?${redactPairs(query.slice(1), typed, found)}`;
  let hash = "";
  let route = null;
  if (fragment !== undefined) {
    const value = fragment.slice(1);
    // #tab=a&q=b holds values; #a/b is one value or else a hash route (#/users/list), a path.
    if (value.includes("=")) hash = `#${redactPairs(value, typed, found)}`;
    else {
      const whole = redactPart(value, typed, { inside: !value.includes("/"), found });
      if (whole === value && value.includes("/")) route = value;
      else hash = `#${whole}`;
    }
  }
  const pathTyped = typed.filter(({ value }) => !found.has(value));
  if (route !== null) hash = `#${redactPath(route, pathTyped)}`;
  return `${origin}${redactPath(pathname, pathTyped)}${search}${hash}`;
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
