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

// Whether `index` falls inside a %XX escape of `text` (`20abc` in `hello%20abc`).
const HEX = /[0-9a-fA-F]/;
const insideEscape = (text, index) =>
  (text[index - 1] === "%" && HEX.test(text[index] || "") && HEX.test(text[index + 1] || "")) ||
  (text[index - 2] === "%" && HEX.test(text[index - 1]) && HEX.test(text[index] || ""));

// How a URL is masked: it is split into its parts (path segments, query pairs, fragment), each
// value is decoded with its part's own rules, typed values are matched in the decoded value only,
// and the part is rebuilt. While a URL is being masked, each marker (surf's own, or one an earlier
// pass inserted and listed) stands in as one private-use character, a "token": no match can reach
// into it, the encoders pass it through, and it becomes the marker's text at the end.
const TOKEN_BLOCKS = [0xe000, 0xf000];
const TOKEN_BLOCK_SIZE = 0x800;

function createTokens(url) {
  const readings = decodings(url).map(({ text }) => text).join("");
  const base = TOKEN_BLOCKS.find((start) => ![...readings].some((char) => char.charCodeAt(0) >= start && char.charCodeAt(0) < start + TOKEN_BLOCK_SIZE)) ?? TOKEN_BLOCKS[0];
  const list = [];
  return {
    /** A new token for `info` ({ marker, type?, field? }). */
    add(info) {
      if (list.length >= TOKEN_BLOCK_SIZE) throw new Error("too many typed values in one URL to redact");
      list.push(info);
      return String.fromCharCode(base + list.length - 1);
    },
    /** The token's info, or null for any other character. */
    of(char) {
      const index = char.charCodeAt(0) - base;
      return index >= 0 && index < list.length ? list[index] : null;
    },
  };
}

// The decodings of one encoded value: level 0 as captured, level 1 decoded once (`+` a space in a
// query or form value), each deeper level decoded once more while that changes it. `starts[i]` is
// where character i of a level begins in the level above it.
function levelsOf(raw, plusIsSpace) {
  const levels = [{ text: raw }];
  for (let depth = 1; depth <= MAX_DECODES; depth++) {
    const above = levels[depth - 1].text;
    const { decoded, starts } = decodeOnce(above, plusIsSpace && depth === 1);
    if (depth > 1 && decoded === above) break;
    levels.push({ text: decoded, starts });
  }
  return levels;
}

// Where position `index` of level `depth` begins in level 0.
function toRaw(levels, depth, index) {
  for (let level = depth; level > 0; level--) index = levels[level].starts[index];
  return index;
}

// Where `value` sits in `text`: the whole text, or, for a value of 4 or more characters, each
// occurrence between characters that are not letters or digits (`pizza near me`, not `name` in
// `username`). With `escapes`, the text will be decoded again, so a match can't split a %XX.
function matchesIn(text, value, { escapes = false } = {}) {
  if (value.length >= MIN_LENGTH && text === value) return [{ start: 0, end: text.length }];
  if (value.length < MIN_INSIDE_LENGTH) return [];
  const found = [];
  for (const match of text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(value)}(?![\\p{L}\\p{N}])`, "gu"))) {
    const start = match.index;
    const end = start + value.length;
    if (escapes && (insideEscape(text, start) || insideEscape(text, end))) continue;
    found.push({ start, end });
  }
  return found;
}

const replaceRanges = (text, ranges, token) => {
  let result = "";
  let index = 0;
  for (const { start, end } of ranges) {
    result += text.slice(index, start) + token;
    index = end;
  }
  return result + text.slice(index);
};

const parseJsonDocument = (text) => {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? { parsed } : null;
  } catch {
    return null;
  }
};

// JSON written with the given separators between items and after keys.
function serializeJson(value, item, key) {
  if (Array.isArray(value)) return `[${value.map((entry) => serializeJson(entry, item, key)).join(item)}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).map(([name, entry]) => `${JSON.stringify(name)}${key}${serializeJson(entry, item, key)}`).join(item)}}`;
  return JSON.stringify(value);
}

// The layout the page wrote its JSON in, when it is compact or Python's default; else compact.
const JSON_LAYOUTS = [[",", ":"], [", ", ": "]];
const jsonLayout = (parsed, text) => JSON_LAYOUTS.find(([item, key]) => serializeJson(parsed, item, key) === text) || JSON_LAYOUTS[0];

/**
 * Replaces `value` in a parsed JSON document's values, never its keys: a string that is the value
 * or holds it (see matchesIn), and a number or boolean that is the value, which becomes a marker
 * string whose token records its JSON type and `field` path. Returns the new document, or null.
 */
function maskJsonValues(node, { value, marker }, tokens, field) {
  let changed = false;
  const visit = (item, path) => {
    if (typeof item === "string") {
      const ranges = matchesIn(item, value);
      if (ranges.length === 0) return item;
      changed = true;
      return replaceRanges(item, ranges, tokens.add({ marker }));
    }
    if ((typeof item === "number" || typeof item === "boolean") && value.length >= MIN_LENGTH && String(item) === value) {
      changed = true;
      return tokens.add({ marker, type: typeof item, ...(field ? { field: [field, ...path].join(".") } : {}) });
    }
    if (Array.isArray(item)) return item.map((entry, index) => visit(entry, [...path, index]));
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, visit(entry, [...path, key])]));
    return item;
  };
  const result = visit(node, []);
  return changed ? result : null;
}

// Encodes `text` back to the level above it, as `original` (that level as captured) encoded the
// same characters: what it wrote as is stays as is, what it escaped is escaped (in its hex case),
// and a space is `+` where it wrote one. Tokens pass through.
function encodeLike(text, original, plusIsSpace, tokens) {
  const literal = new Set();
  let lowerHex = false;
  for (let index = 0; index < original.length;) {
    const escape = original[index] === "%" && /^%[0-9a-fA-F]{2}$/.test(original.slice(index, index + 3));
    if (escape) {
      if (/[a-f]/.test(original.slice(index + 1, index + 3))) lowerHex = true;
      index += 3;
      continue;
    }
    literal.add(original[index]);
    index += 1;
  }
  literal.delete("%");
  const space = plusIsSpace && literal.has("+") ? "+" : literal.has(" ") ? " " : "%20";
  if (plusIsSpace) literal.delete("+");
  let result = "";
  for (const char of text) {
    if (tokens.of(char) || /[A-Za-z0-9\-_.~]/.test(char) || literal.has(char)) result += char;
    else if (char === " ") result += space;
    else {
      const escaped = encodeURIComponent(char).replace(/[!'()*]/g, (mark) => `%${mark.charCodeAt(0).toString(16).toUpperCase()}`);
      result += lowerHex ? escaped.toLowerCase() : escaped;
    }
  }
  return result;
}

/**
 * One encoded value (a query or form value, a plain fragment or a body) with one typed value
 * replaced by its marker's token: the whole value when a decoding of it is the typed value, a
 * JSON document's values when a decoding of it is JSON, else each occurrence inside the deepest
 * decoding that holds one. The rest of the value is kept as captured; a JSON document is written
 * again in the page's layout and encoded as the value was. `field` names the value for pb param
 * (`query.variables`). Returns `{ raw, matched }`.
 */
function maskValue(raw, typed, tokens, { plusIsSpace, field, inside = true }) {
  const levels = levelsOf(raw, plusIsSpace);
  const decoded = levels.slice(1);
  if (typed.value.length >= MIN_LENGTH && decoded.some(({ text }) => text === typed.value)) return { raw: tokens.add({ marker: typed.marker }), matched: true };
  if (!inside) return { raw, matched: false };
  const json = decoded.findIndex(({ text }) => parseJsonDocument(text));
  if (json >= 0) {
    const depth = json + 1;
    const original = levels[depth].text;
    const { parsed } = parseJsonDocument(original);
    const masked = maskJsonValues(parsed, typed, tokens, field);
    if (!masked) return { raw, matched: false };
    let text = serializeJson(masked, ...jsonLayout(parsed, original));
    for (let level = depth; level > 0; level--) text = encodeLike(text, levels[level - 1].text, plusIsSpace && level === 1, tokens);
    return { raw: text, matched: true };
  }
  for (let depth = levels.length - 1; depth > 0; depth--) {
    const ranges = matchesIn(levels[depth].text, typed.value, { escapes: depth < levels.length - 1 });
    if (ranges.length === 0) continue;
    const token = tokens.add({ marker: typed.marker });
    return { raw: replaceRanges(raw, ranges.map(({ start, end }) => ({ start: toRaw(levels, depth, start), end: toRaw(levels, depth, end) })), token), matched: true };
  }
  return { raw, matched: false };
}

// Each typed value in turn, the longest first, so `dummy romeo` is found before `romeo`.
function maskEach(raw, typed, tokens, options, found) {
  let result = raw;
  for (const item of typed) {
    const masked = maskValue(result, item, tokens, options);
    if (masked.matched) found?.add(item.value);
    result = masked.raw;
  }
  return result;
}

// Query pairs (`k=v&…`): keys are never touched, and a pair it doesn't change stays as captured.
function maskPairs(text, typed, tokens, found, { query = false } = {}) {
  return text.split("&").map((pair) => {
    const split = pair.indexOf("=");
    if (split < 0) return maskEach(pair, typed, tokens, { plusIsSpace: true }, found);
    const key = pair.slice(0, split);
    const field = query ? `query.${levelsOf(key, true)[1].text}` : undefined;
    return `${key}=${maskEach(pair.slice(split + 1), typed, tokens, { plusIsSpace: true, field }, found)}`;
  }).join("&");
}

// Path segments are route pieces as well as values: a segment is masked only when it is a typed value.
const maskSegments = (text, typed, tokens) =>
  text.split("/").map((segment) => maskEach(segment, typed, tokens, { plusIsSpace: false, inside: false })).join("/");

// Which typed values a request body sends, read as JSON, a form or text, the way a URL value is.
// The body isn't rewritten, so its matches need no tokens of their own.
const SCAN_TOKENS = { add: () => "\uFFFF", of: () => null };
function bodyHolds(body, typed, found) {
  const tokens = SCAN_TOKENS;
  if (typeof body !== "string" || !body) return;
  if (!parseJsonDocument(body) && /^[^=&]+=/.test(body)) maskPairs(body, typed, tokens, found);
  else maskEach(body, typed, tokens, { plusIsSpace: false }, found);
}

/**
 * `url` with each typed value ({ value, marker }) replaced by its marker, as `{ url, markers }`.
 * `markers` lists every marker in the result, as `{ start, end }` in it, with `type` (number or
 * boolean) and `field` (`query.variables.year`) for a JSON scalar it replaced. Pass the list a
 * previous pass returned as `markers`, and those stay as they are; any other text that looks like
 * a marker is text a page or the user wrote, matched as any other.
 *
 * Query values (and a fragment's `?k=v` or `k=v` pairs) are form-decoded and matched whole or
 * inside, a JSON value only in its values. A path segment, or a `#/route`'s, is masked only when it
 * is a typed value no query, fragment or `body` value holds: there it is a fixed route piece
 * (/api/users?q=users). A plain fragment is masked only whole. Keys and the origin never change.
 */
function maskTypedValuesInUrl(url, typed, { body, markers = [] } = {}) {
  if (typeof url !== "string") return { url, markers };
  const match = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*)?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/s);
  if (!match || typed.length === 0) return { url, markers };
  const tokens = createTokens(url);
  // The markers an earlier pass inserted become tokens first, so nothing matches inside them.
  let source = "";
  let index = 0;
  for (const { start, end, ...info } of [...markers].sort((a, b) => a.start - b.start)) {
    if (start < index || !REDACTED_MARKER.test(url.slice(start, end))) continue;
    source += url.slice(index, start) + tokens.add({ marker: url.slice(start, end), ...info });
    index = end;
  }
  source += url.slice(index);
  const [, origin = "", pathname, query, fragment] = source.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*)?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/s);
  const values = typed.filter(({ value }) => value).sort((a, b) => b.value.length - a.value.length);
  const found = new Set();
  bodyHolds(body, values, found);
  const search = query === undefined ? "" : `?${maskPairs(query, values, tokens, found, { query: true })}`;
  let hash = "";
  let route = null;
  if (fragment !== undefined) {
    const whole = maskEach(fragment, values, tokens, { plusIsSpace: false, inside: false }, found);
    const split = fragment.indexOf("?");
    if (whole !== fragment) hash = `#${whole}`;
    else if (split >= 0) {
      route = fragment.slice(0, split);
      hash = `?${maskPairs(fragment.slice(split + 1), values, tokens, found)}`;
    } else if (fragment.startsWith("/")) route = fragment;
    else if (fragment.includes("=")) hash = `#${maskPairs(fragment, values, tokens, found)}`;
    else hash = `#${fragment}`;
  }
  const pathTyped = values.filter(({ value }) => !found.has(value));
  if (route !== null) hash = `#${maskSegments(route, pathTyped, tokens)}${hash}`;
  const masked = `${origin}${maskSegments(pathname, pathTyped, tokens)}${search}${hash}`;
  let result = "";
  const listed = [];
  for (const char of masked) {
    const info = tokens.of(char);
    if (!info) {
      result += char;
      continue;
    }
    const { marker, ...rest } = info;
    listed.push({ start: result.length, end: result.length + marker.length, ...rest });
    result += marker;
  }
  return { url: result, markers: listed };
}

/** `url` with the typed values in it replaced by their markers (see maskTypedValuesInUrl). */
const redactTypedValuesInUrl = (url, typed, options) => maskTypedValuesInUrl(url, typed, options).url;

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
  maskTypedValuesInUrl,
  numberRedactedMarkers,
  placeholderError,
  redactTypedValuesInUrl,
  rememberTypedValues,
  typedArg,
  typedValues,
  typedValuesForTrace,
};
