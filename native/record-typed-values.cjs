// Values a record's own typing steps entered (type, locate.* --action fill, form.fill, select...),
// so the URLs its trace captured can hold a placeholder where one appears: `<text>`, `<text-2>`,
// `<value>`..., the name of the input the draft gives that step (`{{text}}`, `{{text-2}}`). The
// values live in the host's memory only, for as long as the record is open, and are never written.
const { randomUUID } = require("node:crypto");
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

// A typed value as the text it entered: the CLI passes `type true` and `type 2024` as a boolean and
// a number, which are typed as `true` and `2024`. Anything else, or empty text, types nothing.
function typedText(value) {
  if (typeof value === "string") return value || null;
  return typeof value === "number" || typeof value === "boolean" ? String(value) : null;
}

/** [{ value, marker }] for the values one command typed, each marked with its argument's name, as text. */
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
    return items.map((item) => typedText(item?.value)).filter((value) => value !== null).map((value) => ({ value, marker: "<data>" }));
  }
  return (Array.isArray(raw) ? raw : [raw])
    .map(typedText)
    .filter((value) => value !== null)
    .map((value) => ({ value, marker: `<${name}>` }));
}

/**
 * Holds what one typing call entered. `evented: false`: the call gets no typing event of its own
 * (the record was paused, or a batch ran it), so no drafted step names its values.
 */
function rememberTypedValues(recordId, command, args, { evented = true } = {}) {
  if (!typedArg(command, args)) return;
  const calls = held.get(recordId) || [];
  calls.push({ id: randomUUID(), command, values: typedValues(command, args).map(({ value }) => value), evented });
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
  const typed = calls.flatMap((call) => call.values.map((value, index) => ({ value, marker: markerOf.get(call) || "<redacted>", id: `${call.id}.${index}` })));
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

const hexDigit = (code) => (code >= 48 && code <= 57 ? code - 48 : (code | 32) >= 97 && (code | 32) <= 102 ? (code | 32) - 87 : -1);

// The byte a %XX at `index` encodes, or -1.
function escapedByte(text, index) {
  if (text.charCodeAt(index) !== 37) return -1;
  const high = hexDigit(text.charCodeAt(index + 1));
  const low = hexDigit(text.charCodeAt(index + 2));
  return high < 0 || low < 0 ? -1 : high * 16 + low;
}

// The character a well-formed run of 1 to 4 %XX escapes at `index` encodes (UTF-8), or null.
function escapedChar(text, index) {
  const lead = escapedByte(text, index);
  if (lead < 0) return null;
  if (lead < 0x80) return { char: String.fromCharCode(lead), size: 3 };
  const count = lead >= 0xc2 && lead <= 0xdf ? 2 : lead >= 0xe0 && lead <= 0xef ? 3 : lead >= 0xf0 && lead <= 0xf4 ? 4 : 0;
  if (count === 0) return null;
  for (let byte = 1; byte < count; byte++) {
    const next = escapedByte(text, index + 3 * byte);
    if (next < 0x80 || next > 0xbf) return null;
  }
  try {
    return { char: decodeURIComponent(text.slice(index, index + 3 * count)), size: 3 * count };
  } catch {
    return null;
  }
}

// `text` percent-decoded as URLSearchParams reads it: each %XX is a byte, the bytes are read as
// UTF-8, and each byte that isn't valid UTF-8 becomes U+FFFD, beside the valid bytes around it.
const utf8 = new TextDecoder("utf-8", { ignoreBOM: true });
function decodeLeniently(text) {
  if (!text.includes("%")) return text;
  // Every escape well-formed and valid UTF-8: the standard decoding reads the same.
  try {
    return decodeURIComponent(text);
  } catch {}
  const chunks = [];
  let copied = 0;
  for (let index = text.indexOf("%"); index >= 0 && index < text.length; index = text.indexOf("%", index)) {
    if (escapedByte(text, index) < 0) {
      index++;
      continue;
    }
    chunks.push(Buffer.from(text.slice(copied, index), "utf8"));
    const bytes = [];
    for (let byte = escapedByte(text, index); byte >= 0; byte = escapedByte(text, index)) {
      bytes.push(byte);
      index += 3;
    }
    chunks.push(Buffer.from(bytes));
    copied = index;
  }
  chunks.push(Buffer.from(text.slice(copied), "utf8"));
  return utf8.decode(Buffer.concat(chunks));
}

// One decode of `text`, with where each decoded character came from: `starts[i]` is the index in
// `text` where character i begins, `starts[length]` the end (none with `track: false`). An escape
// decodes whole or not at all.
function decodeOnce(text, plusIsSpace, { track = true } = {}) {
  let decoded = "";
  const starts = track ? [] : null;
  // Where the characters copied as they are begin.
  let copied = 0;
  for (let index = 0; index < text.length;) {
    const code = text.charCodeAt(index);
    const escaped = code === 37 ? escapedChar(text, index) : null;
    if (!escaped && !(plusIsSpace && code === 43)) {
      starts?.push(index);
      index++;
      continue;
    }
    const char = escaped ? escaped.char : " ";
    decoded += text.slice(copied, index) + char;
    if (starts) for (let offset = 0; offset < char.length; offset++) starts.push(index);
    index += escaped ? escaped.size : 1;
    copied = index;
  }
  decoded += text.slice(copied);
  starts?.push(text.length);
  return { decoded, starts };
}

// Whether `index` falls inside a %XX escape of `text` (`20abc` in `hello%20abc`).
const HEX = /[0-9a-fA-F]/;
const insideEscape = (text, index) =>
  (text[index - 1] === "%" && HEX.test(text[index] || "") && HEX.test(text[index + 1] || "")) ||
  (text[index - 2] === "%" && HEX.test(text[index - 1]) && HEX.test(text[index] || ""));

// The decodings of one encoded value: level 0 as captured, level 1 decoded once (`+` a space in a
// query or form value), each deeper level decoded once more while that changes it. `starts[i]` is
// where character i of a level begins in the level above it.
function levelsOf(raw, plusIsSpace) {
  const levels = [{ text: raw }];
  for (let depth = 1; depth <= MAX_DECODES; depth++) {
    const above = levels[depth - 1].text;
    if (depth > 1 && !above.includes("%")) break;
    const { decoded, starts } = decodeOnce(above, plusIsSpace && depth === 1);
    if (depth > 1 && decoded === above) break;
    levels.push({ text: decoded, starts });
  }
  return levels;
}

// The texts of levelsOf(raw, plusIsSpace), without where their characters came from.
function decodedTexts(raw, plusIsSpace) {
  const texts = [raw];
  for (let depth = 1; depth <= MAX_DECODES; depth++) {
    const above = texts[depth - 1];
    const plus = plusIsSpace && depth === 1 && above.includes("+");
    if (!above.includes("%") && !plus) {
      if (depth === 1) texts.push(above);
      break;
    }
    const { decoded } = decodeOnce(above, plus, { track: false });
    if (depth > 1 && decoded === above) break;
    texts.push(decoded);
  }
  return texts;
}

// Where position `index` of level `depth` begins in level 0.
function toRaw(levels, depth, index) {
  for (let level = depth; level > 0; level--) index = levels[level].starts[index];
  return index;
}

// The pattern that finds `value` between characters that are not letters or digits, made once per
// value in one masking call (see maskTypedValuesInUrl) and dropped when it returns, so no typed
// value outlives the call.
let insidePatterns = null;
function insidePattern(value) {
  let pattern = insidePatterns?.get(value);
  if (!pattern) {
    pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(value)}(?![\\p{L}\\p{N}])`, "gu");
    insidePatterns?.set(value, pattern);
  }
  return pattern;
}

// Where `value` sits in `text`: the whole text, or, for a value of 4 or more characters, each
// occurrence between characters that are not letters or digits (`pizza near me`, not `name` in
// `username`). With `escapes`, the text will be decoded again, so a match can't split a %XX; with
// `whole: false`, only occurrences inside it count.
function matchesIn(text, value, { escapes = false, whole = true } = {}) {
  if (whole && value.length >= MIN_LENGTH && text === value) return [{ start: 0, end: text.length }];
  if (value.length < MIN_INSIDE_LENGTH || !text.includes(value)) return [];
  const found = [];
  for (const match of text.matchAll(insidePattern(value))) {
    const start = match.index;
    const end = start + value.length;
    if (escapes && (insideEscape(text, start) || insideEscape(text, end))) continue;
    found.push({ start, end });
  }
  return found;
}

const parseJsonDocument = (text) => {
  if (!/^\s*[[{]/.test(text)) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? { parsed } : null;
  } catch {
    return null;
  }
};

// A JSON string literal's value, with where each character came from: `starts[i]` is the index in
// `source` (quotes included) where character i's escape or character begins, `starts[length]` the
// closing quote.
function decodeJsonString(source) {
  let value = "";
  const starts = [];
  for (let index = 1; index < source.length - 1;) {
    let char = source[index];
    let size = 1;
    if (char === "\\") {
      const escape = source[index + 1];
      size = escape === "u" ? 6 : 2;
      char = escape === "u" ? String.fromCharCode(Number.parseInt(source.slice(index + 2, index + 6), 16)) : JSON.parse(`"\\${escape}"`);
    }
    starts.push(index);
    value += char;
    index += size;
  }
  starts.push(source.length - 1);
  return { value, starts };
}

/**
 * A JSON document's tokens as written, read with an explicit stack so any depth reads: `leaves`,
 * its values in order, `[{ kind, start, end, frame, key, repeated? }]`, `kind` string, number or
 * literal (true, false, null), `start`/`end` the value's source span in `text`; and `keys`, the
 * spans of its object keys. pathOf(leaf) gives a leaf's keys and indexes. `repeated`: the value
 * sits under a key its object holds more than once, so a path to it names more than one value.
 * Null when `text` isn't a JSON object or array.
 */
function jsonTokens(text) {
  if (!parseJsonDocument(text)) return null;
  const leaves = [];
  const keys = [];
  // The [from, to) ranges of leaves under a key their object holds more than once, marked once
  // the document is read, so leaves nested under many such keys are marked once each.
  const repeats = [];
  const markRepeated = () => {
    const depth = new Int32Array(leaves.length + 1);
    for (const [from, to] of repeats) {
      depth[from]++;
      depth[to]--;
    }
    for (let leaf = 0, open = 0; leaf < leaves.length; leaf++) {
      open += depth[leaf];
      if (open > 0) leaves[leaf].repeated = true;
    }
  };
  let index = 0;
  const space = () => {
    for (let code = text.charCodeAt(index); code === 32 || code === 9 || code === 10 || code === 13; code = text.charCodeAt(index)) index++;
  };
  // Moves past a string; returns where it began.
  const string = () => {
    const start = index;
    for (index++; text[index] !== '"'; index++) if (text[index] === "\\") index++;
    index++;
    return start;
  };
  // The open object or array: its key in its parent, and for an object, the leaves under each key.
  let frame = null;
  let key = null;
  const member = () => {
    space();
    frame.from = leaves.length;
    if (!frame.object) return frame.item++;
    const start = string();
    keys.push({ start, end: index });
    frame.name = JSON.parse(text.slice(start, index));
    space();
    index++;
    return frame.name;
  };
  for (;;) {
    space();
    const char = text[index];
    if (char === "{" || char === "[") {
      frame = { parent: frame, key, object: char === "{", item: 0, members: new Map(), depth: (frame?.depth ?? 0) + 1 };
      index++;
      space();
      if (text[index] !== (frame.object ? "}" : "]")) {
        key = member();
        continue;
      }
      index++;
      frame = frame.parent;
    } else if (char === '"') {
      const start = string();
      leaves.push({ kind: "string", start, end: index, frame, key });
    } else {
      const start = index;
      while (index < text.length && !/[\s,\]}]/.test(text[index])) index++;
      leaves.push({ kind: char === "t" || char === "f" || char === "n" ? "literal" : "number", start, end: index, frame, key });
    }
    // A value ended: so did its member, and each object or array it closes.
    for (;;) {
      if (!frame) {
        markRepeated();
        return { leaves, keys };
      }
      if (frame.object) {
        const ranges = frame.members.get(frame.name) || [];
        ranges.push([frame.from, leaves.length]);
        frame.members.set(frame.name, ranges);
      }
      space();
      if (text[index++] === ",") {
        key = member();
        break;
      }
      for (const ranges of frame.members.values()) if (ranges.length > 1) for (const range of ranges) repeats.push(range);
      key = frame.key;
      frame = frame.parent;
    }
  }
}

// The deepest a masked JSON scalar's `field` path goes: one nested deeper gets no field or type,
// so naming each scalar takes work bounded by this, not by its depth.
const MAX_FIELD_DEPTH = 32;

// A leaf's keys and indexes, from the document's root.
function pathOf(leaf) {
  const path = [];
  for (let frame = leaf.frame, key = leaf.key; frame; key = frame.key, frame = frame.parent) path.push(key);
  return path.reverse();
}

// Encodes `text` back to the level above it, as `original` (that level as captured) encoded the
// same characters: what it wrote as is stays as is, what it escaped is escaped (in its hex case),
// and a space is `+` where it wrote one.
function encodeLike(text, original, plusIsSpace) {
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
    if (/[A-Za-z0-9\-_.~]/.test(char) || literal.has(char)) result += char;
    else if (char === " ") result += space;
    else {
      const escaped = encodeURIComponent(char).replace(/[!'()*]/g, (mark) => `%${mark.charCodeAt(0).toString(16).toUpperCase()}`);
      result += lowerHex ? escaped.toLowerCase() : escaped;
    }
  }
  return result;
}

// How a URL is masked: it is split into its parts (path segments, query pairs, fragment), each
// value is decoded with its part's own rules, typed values are matched in the decoded value only,
// and each match becomes an edit of the URL as captured: `{ start, end, pieces }` replaces
// `url.slice(start, end)` with `pieces`, each text written as is or a marker (`{ marker, typedValue?,
// type?, field? }`, `typedValue` the id of the typed value it stands for). Edits never overlap each
// other or a marker an earlier pass listed, so no match can reach into a marker; everything outside
// an edit stays byte for byte as captured. Each value masked is then checked (see leakIn).

// The marker a typed value becomes, naming the value it stands for.
const markerFor = (typed) => ({ marker: typed.marker, ...(typed.id ? { typedValue: typed.id } : {}) });

// Whether any decoding of `text` (see levelsOf) is the typed value or holds it (see matchesIn).
// A JSON string's text: + is never a space in it.
const spelledIn = (text, value) =>
  decodedTexts(text, false).some((decoded) => (value.length >= MIN_LENGTH && decoded === value) || matchesIn(decoded, value).length > 0);

/**
 * The edits that mask `typed` in a JSON document's values, never its keys, in source order: a
 * string that is the value in some decoding (the whole string), a JSON document held in a string
 * (walked the same way, at any depth), a string that holds the value (each match, or the whole
 * string when a decoding of what's left still holds it), and a number or literal that is the value
 * as written or as read (`2024.0`, `1e3`, `null`), which becomes a marker string recording its JSON
 * type and `field` path (neither deeper than MAX_FIELD_DEPTH). `at(i)` is where index i of `text`
 * sits in the URL; `encode` writes text of `text`'s level as the URL holds it. A string is decoded
 * again as percent-encoded, never with + as a space: the JSON holds it as written.
 */
function maskJson(text, typed, { at, encode, free, field, repeatedKey }) {
  const tokens = jsonTokens(text);
  if (!tokens) return [];
  const marker = markerFor(typed);
  const edits = [];
  const accept = (edit) => {
    if (free(edit) && !(edits.length > 0 && edit.start < edits.at(-1).end)) edits.push(edit);
  };
  for (const leaf of tokens.leaves) {
    const source = text.slice(leaf.start, leaf.end);
    if (leaf.kind !== "string") {
      if (typed.value.length < MIN_LENGTH) continue;
      const read = JSON.parse(source);
      if (source !== typed.value && String(read) !== typed.value) continue;
      const named = !repeatedKey && field && !leaf.repeated;
      const deep = named && leaf.frame.depth > MAX_FIELD_DEPTH;
      const type = read === null || deep ? null : typeof read;
      const where = repeatedKey ? { repeatedKey } : named && !deep ? { field: [field, ...pathOf(leaf)].join(".") } : {};
      accept({ start: at(leaf.start), end: at(leaf.end), pieces: [encode('"'), { ...marker, ...(type ? { type, ...where } : {}) }, encode('"')] });
      continue;
    }
    const { value, starts } = decodeJsonString(source);
    const inLeaf = (index) => at(leaf.start + starts[index]);
    const whole = { start: inLeaf(0), end: inLeaf(value.length), pieces: [marker] };
    if (typed.value.length >= MIN_LENGTH && decodedTexts(value, false).includes(typed.value)) {
      accept(whole);
      continue;
    }
    if (parseJsonDocument(value)) {
      const escape = (piece) => encode(JSON.stringify(piece).slice(1, -1));
      for (const edit of maskJson(value, typed, { at: inLeaf, encode: escape, free })) accept(edit);
      continue;
    }
    const ranges = matchesIn(value, typed.value);
    let rest = "";
    let index = 0;
    for (const { start, end } of ranges) {
      rest += `${value.slice(index, start)}\u0000`;
      index = end;
    }
    rest += value.slice(index);
    if (spelledIn(rest, typed.value)) accept(whole);
    else for (const { start, end } of ranges) accept({ start: inLeaf(start), end: inLeaf(end), pieces: [marker] });
  }
  return edits;
}

/**
 * The edits that mask one typed value in one encoded value (a query or form value, a path segment,
 * a fragment or a body) that starts at `offset` in the URL: the whole value when a decoding of it
 * is the typed value, a JSON document's values when a decoding of it is JSON, else each occurrence
 * inside the deepest decoding that holds one. `field` names the value for pb param
 * (`query.variables`); `repeatedKey`, a query key the URL sends more than once, so no field.
 */
function maskValue(raw, offset, typed, { plusIsSpace, field, repeatedKey, inside = true, free }) {
  const levels = levelsOf(raw, plusIsSpace);
  const marker = markerFor(typed);
  const whole = { start: offset, end: offset + raw.length, pieces: [marker] };
  if (typed.value.length >= MIN_LENGTH && levels.slice(1).some(({ text }) => text === typed.value) && free(whole)) return [whole];
  if (!inside) return [];
  const depth = levels.findIndex(({ text }, index) => index > 0 && parseJsonDocument(text));
  if (depth > 0) {
    // The few pieces it writes (a quote, its escape) are each encoded once.
    const encoded = new Map();
    const encode = (piece) => {
      if (encoded.has(piece)) return encoded.get(piece);
      let text = piece;
      for (let level = depth; level > 0; level--) text = encodeLike(text, levels[level - 1].text, plusIsSpace && level === 1);
      encoded.set(piece, text);
      return text;
    };
    const at = (index) => offset + toRaw(levels, depth, index);
    return maskJson(levels[depth].text, typed, { at, encode, free, field, repeatedKey });
  }
  for (let level = levels.length - 1; level > 0; level--) {
    const edits = matchesIn(levels[level].text, typed.value, { escapes: level < levels.length - 1 })
      .map(({ start, end }) => ({ start: offset + toRaw(levels, level, start), end: offset + toRaw(levels, level, end), pieces: [marker] }))
      .filter(free);
    if (edits.length > 0) return edits;
  }
  return [];
}

// The first of the sorted, non-overlapping `spans` that ends after `start`.
function firstAfter(spans, start) {
  let low = 0;
  let high = spans.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (spans[middle].end <= start) low = middle + 1;
    else high = middle;
  }
  return low;
}

// The check reads a value as masked with `marks`, the sorted `{ start, end }` spans of the markers
// surf wrote in it (those this pass inserted and those an earlier pass listed), found by position,
// never by their text: page text that looks like a marker is read as any other. A marker holds no
// %, + or \ and starts with <, so no escape reaches into one and every decoding below keeps it as
// written: each reading is decoded between its marks, and a match counts only between them.

// Whether one of `marks` spans exactly `start`..`end`.
function isMark(marks, start, end) {
  const index = firstAfter(marks, start);
  return index < marks.length && marks[index].start === start && marks[index].end === end;
}

// `reading` from `start` to `end`, with the marks in it.
function sliced({ text, marks }, start, end) {
  const inside = [];
  for (let index = firstAfter(marks, start); index < marks.length && marks[index].start < end; index++) {
    inside.push({ start: marks[index].start - start, end: marks[index].end - start });
  }
  return { text: text.slice(start, end), marks: inside };
}

// `reading` with `transform` applied to each run of text between its marks.
function between({ text, marks }, transform) {
  if (marks.length === 0) return { text: transform(text), marks };
  let result = "";
  const moved = [];
  let index = 0;
  for (const { start, end } of marks) {
    result += transform(text.slice(index, start));
    moved.push({ start: result.length, end: result.length + end - start });
    result += text.slice(start, end);
    index = end;
  }
  return { text: result + transform(text.slice(index)), marks: moved };
}

// A JSON string literal at `start`..`end` of `reading` as a reading of its value. A marker in it
// sits between whole characters and escapes (none starts with <), so each run between marks reads
// as a string of its own.
const jsonString = (reading, start, end) => between(sliced(reading, start + 1, end - 1), (run) => JSON.parse(`"${run}"`));

// The parts `k=v&…` at `start`..`end` of `reading` sends: each key as written, each value (or
// pair with no =) form-encoded.
function pairsIn(reading, start, end) {
  const parts = [];
  for (let at = start; at <= end;) {
    const stop = reading.text.indexOf("&", at);
    const close = stop < 0 || stop > end ? end : stop;
    const split = at + reading.text.slice(at, close).indexOf("=");
    if (split >= at) parts.push({ ...sliced(reading, at, split), form: false }, { ...sliced(reading, split + 1, close), form: true });
    else parts.push({ ...sliced(reading, at, close), form: true });
    at = close + 1;
  }
  return parts;
}

// How a fragment reads, in the top-level URL and in a URL a value holds alike: `#route?k=v` a
// route and form pairs, `#/route` a route (an `=` in it is a route character), `#k=v&…` form
// pairs, anything else one value. `split` is where the pairs of a `route+pairs` one begin, less 1.
function fragmentShape(fragment) {
  const split = fragment.indexOf("?");
  if (split >= 0) return { kind: "route+pairs", split };
  if (fragment.startsWith("/")) return { kind: "route" };
  return { kind: fragment.includes("=") ? "pairs" : "whole" };
}

// Masking may guess; held may not. A typed value is masked wherever any reading of a value spells
// it, guesses included: a text read as a URL whenever it has a `?` or `#` (`s?q=…` too, see
// urlParts), a value decoded again and read as a URL, a `k=v` text read as a form (readingsOf).
// Over-masking a value costs little; leaving a spelling visible leaks it. A value counts as held,
// which keeps a path segment holding it unmasked as a route piece, only on a certain reading (see
// heldIn): each part decoded once by its own rules, as a site's parser reads it, and split only on
// separators written at its own level, never on ones a percent-decode of the same text produced.

// A URL a value certainly holds, absolute or relative: an origin, or a query or fragment after an
// empty path (`?q`, `#f`), an absolute one (`/s?q`, `/s#f`, `//host/s?q`) or a `./` or `../` one.
const RELATIVE_PATH = /^(?:$|\/|\.\.?(?:\/|$))/;

// The parts a reading sends read as a URL, split on its own `?`, `#`, `&` and `=` as written and
// each read by its own rules as the top-level URL's are: its path, query keys and fragment route as
// written, its query values (and a fragment's `k=v` pairs, see fragmentShape) form-encoded. Only
// those values can be read as a URL or pairs again (`split`). Any text with a `?`, `#` or `://` is
// read so, a bare relative one (`s?q=…`) included; none other is.
function urlParts(reading) {
  const { text } = reading;
  if (!text.includes("?") && !text.includes("#") && !text.includes("://")) return null;
  const [, origin = "", pathname, query, fragment] = text.match(URL_PARTS) || [];
  if (pathname === undefined || (!origin && query === undefined && fragment === undefined)) return null;
  const named = (start, end) => ({ ...sliced(reading, start, end), form: false, split: false });
  const pairs = (start, end) => pairsIn(reading, start, end).map((part) => ({ ...part, split: part.form }));
  const parts = [named(origin.length, origin.length + pathname.length)];
  const queryStart = origin.length + pathname.length + 1;
  if (query !== undefined) parts.push(...pairs(queryStart, queryStart + query.length));
  if (fragment !== undefined) {
    const start = text.length - fragment.length;
    const shape = fragmentShape(fragment);
    if (shape.kind === "route+pairs") parts.push(named(start, start + shape.split), ...pairs(start + shape.split + 1, text.length));
    else if (shape.kind === "pairs") parts.push(...pairs(start, text.length));
    else parts.push(named(start, text.length));
  }
  return parts;
}

// Readings of one value longer in all than this many times its length (plus a margin) aren't
// checked one by one: the value is masked whole.
const MAX_READ_FACTOR = 64;
const READ_MARGIN = 65536;

/**
 * Every reading of `masked` (`{ text, marks }`) a site could decode, as `{ text, marks, raw, final,
 * tokens }`: percent-decoded (each well-formed run, and as URLSearchParams does, an invalid byte
 * read as U+FFFD), repeatedly; a JSON string literal's value; the string values of a JSON document
 * (its keys are names, never typed values); and the parts of a URL-shaped text (see urlParts), each
 * read the same way at any depth; only a value is read as a URL or pairs (`split`), and a decoding of
 * a text already split is never split again. + is a space only in a query or form value: the value itself
 * where `plusIsSpace`, a URL-shaped text's query values, and the values of a `k=v&…` text decoded
 * from a form value; never a path, a key, a JSON string or a decoded value as a whole. `raw`: text
 * as captured or a part cut from a reading, not itself a decoding; `final`: decoding doesn't change
 * it; `tokens`: it is a JSON document. Null when the readings are too long in all to check (see
 * MAX_READ_FACTOR).
 */
function readingsOf(masked, { inside, plusIsSpace }) {
  const seen = new Set();
  const queue = [];
  const add = (reading) => {
    // A reading that is one marker and nothing else holds nothing to check.
    if (isMark(reading.marks, 0, reading.text.length)) return;
    const flags = `${Number(reading.raw)}${Number(reading.form)}${Number(reading.nested)}${Number(reading.split)}`;
    const key = reading.marks.length === 0 ? `${flags}|${reading.text}` : `${flags}${reading.marks.map(({ start, end }) => `${start},${end}`).join(";")}|${reading.text}`;
    if (seen.has(key)) return;
    seen.add(key);
    queue.push(reading);
  };
  add({ ...masked, raw: true, form: plusIsSpace, nested: false, split: true });
  const readings = [];
  let budget = MAX_READ_FACTOR * masked.text.length + READ_MARGIN;
  for (let index = 0; index < queue.length; index++) {
    const reading = queue[index];
    const { text, form, nested, split } = reading;
    budget -= text.length;
    if (budget < 0) return null;
    const tokens = jsonTokens(text);
    let final = true;
    try {
      if (tokens) {
        if (inside) for (const leaf of tokens.leaves) if (leaf.kind === "string" && !isMark(reading.marks, leaf.start + 1, leaf.end - 1)) add({ ...jsonString(reading, leaf.start, leaf.end), raw: false, form: false, nested: false, split });
      } else {
        let decodings = [];
        if (text.includes("%") || (form && text.includes("+"))) {
          const source = form ? between(reading, (run) => run.replace(/\+/g, " ")) : reading;
          const strict = between(source, decode);
          const lenient = between(source, decodeLeniently);
          final = lenient.text === text;
          // A strict decoding that reads it as it is still counts as one: a site reads that text.
          if (!final) decodings = lenient.text === strict.text ? [strict] : [strict, lenient];
        }
        // A value read as a URL or pairs is split on its own separators, as written once it is
        // decoded by its own rules (raw text a site decodes further isn't yet): a decoding of the
        // whole is never split again, so a %3D or %3F in a key or path never becomes one.
        // A form value that decoding doesn't change is its own decoding.
        const pairs = (nested || (form && final)) && text.includes("=");
        const parts = inside && split && (final || !reading.raw) ? urlParts(reading) || (pairs ? pairsIn(reading, 0, text.length).map((part) => ({ ...part, split: part.form })) : []) : [];
        const splitAgain = split && parts.length === 0;
        for (const decoded of decodings) add({ ...decoded, raw: false, form: false, nested: form || nested, split: splitAgain });
        if (inside && /^\s*"/.test(text)) {
          let quoted = null;
          try {
            quoted = JSON.parse(text);
          } catch {}
          // The text read as JSON, not a decoding of it: it reads as the text itself would.
          if (typeof quoted === "string") add({ ...jsonString(reading, text.indexOf('"'), text.trimEnd().length), raw: false, form: false, nested: false, split });
        }
        for (const part of parts) add({ ...part, raw: true, nested: false });
      }
    } catch {
      // A run between marks that doesn't read as JSON alone: the value can't be checked.
      return null;
    }
    reading.final = final;
    reading.tokens = tokens;
    readings.push(reading);
  }
  return readings;
}

/**
 * Whether some reading of `masked` (see readingsOf) still spells one of `typed`, between surf's
 * markers: as a whole reading (one with no marker, and not raw text a site decodes further), inside
 * any reading but raw text a site decodes further (see matchesIn; in a reading decoded again, a
 * match can't split a %XX), as a JSON number or literal, or across a JSON document's tokens. With
 * `inside: false` (a path segment, a plain fragment), only as a whole reading. `{ status: "clean" }`,
 * `{ status: "leak", item }` naming the first value it spells, or `{ status: "unread" }` when the
 * readings are too many to check, which proves no value is there.
 */
function leakIn(masked, typed, { inside, plusIsSpace }) {
  const values = typed.filter(({ value }) => value.length >= MIN_LENGTH);
  if (values.length === 0) return { status: "clean" };
  const readings = readingsOf(masked, { inside, plusIsSpace });
  if (!readings) return { status: "unread" };
  for (const { text: reading, marks, raw, final, tokens } of readings) {
    if (raw && !final && !tokens) continue;
    let scalars = null;
    let spans = null;
    if (inside && tokens) {
      scalars = new Set();
      for (const leaf of tokens.leaves) {
        if (leaf.kind === "string") continue;
        const source = reading.slice(leaf.start, leaf.end);
        scalars.add(source).add(String(JSON.parse(source)));
      }
      spans = [...tokens.leaves, ...tokens.keys].sort((a, b) => a.start - b.start);
    }
    // The runs of text between the marks, each with where it starts.
    const runs = [];
    let from = 0;
    for (const { start, end } of marks) {
      runs.push({ run: reading.slice(from, start), at: from });
      from = end;
    }
    runs.push({ run: reading.slice(from), at: from });
    for (const item of values) {
      if (marks.length === 0 && reading === item.value) return { status: "leak", item };
      if (!inside) continue;
      if (scalars?.has(item.value)) return { status: "leak", item };
      for (const { run, at } of runs) {
        for (const match of matchesIn(run, item.value, { escapes: !final, whole: false })) {
          // In JSON, a match inside one token is the token's to answer for; one across tokens leaks.
          const start = at + match.start;
          const token = spans?.[firstAfter(spans, start)];
          if (spans && token && token.start <= start && token.end >= at + match.end) continue;
          return { status: "leak", item };
        }
      }
    }
  }
  return { status: "clean" };
}

// Whether `masked` (`raw` with its edits) is still JSON wherever `raw` was: the same decoding of it
// parses, and each JSON document a string of it held still parses or became a whole marker.
function jsonKept(raw, masked, plusIsSpace) {
  if (raw === masked || WHOLE_PLACEHOLDER.test(masked)) return true;
  let before = null;
  const depth = decodedTexts(raw, plusIsSpace).findIndex((text, index) => index > 0 && (before = parseJsonDocument(text)));
  if (depth < 0) return true;
  const after = parseJsonDocument(decodedTexts(masked, plusIsSpace)[depth] ?? "");
  if (!after) return false;
  const pairs = [[before.parsed, after.parsed]];
  while (pairs.length > 0) {
    const [before, now] = pairs.pop();
    if (!now || typeof now !== "object" || Array.isArray(before) !== Array.isArray(now)) return false;
    for (const key of Object.keys(before)) {
      if (!Object.hasOwn(now, key)) return false;
      const item = before[key];
      const other = now[key];
      if (item && typeof item === "object") pairs.push([item, other]);
      else if (typeof item === "string" && parseJsonDocument(item)) {
        if (typeof other === "string" && WHOLE_PLACEHOLDER.test(other)) continue;
        const nested = typeof other === "string" ? parseJsonDocument(other) : null;
        if (!nested) return false;
        pairs.push([parseJsonDocument(item).parsed, nested.parsed]);
      }
    }
  }
  return true;
}

// The edits of one masking call: the markers an earlier pass listed (`listed`, sorted, each kept
// as it is unless a value it sits in is masked whole) and the edits each value's maskEach keeps.
// Each value's edits are its own, merged in one pass (see merged) and sorted into place once, at
// the end.
function editList(listed = []) {
  const added = [];
  const dropped = new Set();
  return {
    // The listed markers inside `start`..`end`, in order.
    listedIn(start, end) {
      const from = firstAfter(listed, start);
      let to = from;
      while (to < listed.length && listed[to].start < end) to++;
      return listed.slice(from, to);
    },
    // Keeps a value's final `edits`; `replaced`, the listed markers a whole-value marker covers.
    keep(edits, replaced = []) {
      for (const edit of replaced) dropped.add(edit);
      for (const edit of edits) if (!edit.listed) added.push(edit);
      return edits;
    },
    // Every edit kept, in order.
    all: () => [...listed.filter((edit) => !dropped.has(edit)), ...added].sort((a, b) => a.start - b.start),
  };
}

// Whether `span` overlaps none of the sorted `edits` but those it holds whole (a leaf masked whole
// for a later value, over an earlier value's match in it), which it then replaces, and no listed
// marker.
function isFree(edits, { start, end }) {
  for (let index = firstAfter(edits, start); index < edits.length && edits[index].start < end; index++) {
    const edit = edits[index];
    if (edit.listed || edit.start < start || edit.end > end) return false;
  }
  return true;
}

// The sorted `edits` with the sorted `batch` merged in, each of its edits in place of those it
// holds (see isFree), in one pass over both.
function merged(edits, batch) {
  const result = [];
  let index = 0;
  for (const edit of batch) {
    while (index < edits.length && edits[index].end <= edit.start) result.push(edits[index++]);
    while (index < edits.length && edits[index].start < edit.end) index++;
    result.push(edit);
  }
  while (index < edits.length) result.push(edits[index++]);
  return result;
}

// `raw` (at `offset` in the URL) with the edits in it applied, as `{ text, marks }`: `marks` the
// spans of the markers in it (see readingsOf).
function applied(raw, offset, edits) {
  let text = "";
  const marks = [];
  let index = 0;
  for (const edit of edits) {
    text += raw.slice(index, edit.start - offset);
    for (const piece of edit.pieces) {
      if (typeof piece === "string") text += piece;
      else {
        marks.push({ start: text.length, end: text.length + piece.marker.length });
        text += piece.marker;
      }
    }
    index = edit.end - offset;
  }
  return { text: text + raw.slice(index), marks };
}

/**
 * Masks each typed value in turn in one value, the longest first, so `dummy romeo` is found before
 * `romeo`. Then checks the value as masked: when a reading of it still spells a typed value
 * (leakIn), or JSON it held no longer parses (jsonKept), the walk missed a case, and the whole
 * value becomes one marker with no type: the leaked value's, or the walk's first. When the
 * readings are too many to check, the whole value becomes the walk's first marker, or
 * `<redacted>`, naming no typed value. What it masks never counts a value as held (see heldIn).
 * `walk` is maskValue; a test passes a faulty one to check the check. Returns the value's edits.
 */
function maskEach(raw, offset, typed, options, context) {
  const { list, walk = maskValue } = context;
  const inside = options.inside !== false;
  const listed = list.listedIn(offset, offset + raw.length);
  let edits = listed;
  const free = (span) => isFree(edits, span);
  for (const item of typed) {
    const batch = walk(raw, offset, item, { ...options, free });
    if (batch.length === 0) continue;
    edits = merged(edits, batch);
  }
  const masked = applied(raw, offset, edits);
  const check = leakIn(masked, typed, { inside, plusIsSpace: options.plusIsSpace });
  if (check.status === "clean" && (!inside || jsonKept(raw, masked.text, options.plusIsSpace))) return list.keep(edits);
  let marker = { marker: "<redacted>" };
  if (check.status === "leak") marker = markerFor(check.item);
  else {
    const first = edits.flatMap(({ pieces }) => pieces).find((piece) => typeof piece !== "string");
    if (first) marker = { marker: first.marker, ...(first.typedValue ? { typedValue: first.typedValue } : {}) };
  }
  return list.keep([{ start: offset, end: offset + raw.length, pieces: [marker] }], listed);
}

// `text` split at `separator`, each piece with where it starts in the URL.
const pieces = (text, offset, separator) => {
  let at = offset;
  return text.split(separator).map((piece) => {
    const item = { piece, at };
    at += piece.length + separator.length;
    return item;
  });
};

// Query pairs (`k=v&…`) starting at `offset`: keys are never touched. A query key sent more than
// once gives its values no field: the draft keeps only the last, which another pair can't describe.
function maskPairs(text, offset, typed, context, { query = false } = {}) {
  const pairs = pieces(text, offset, "&").map(({ piece, at }) => {
    const split = piece.indexOf("=");
    return { piece, at, split, key: split < 0 ? null : decodedTexts(piece.slice(0, split), true)[1] };
  });
  const counts = new Map();
  for (const { key } of pairs) counts.set(key, (counts.get(key) || 0) + 1);
  for (const { piece, at, split, key } of pairs) {
    if (split < 0) {
      maskEach(piece, at, typed, { plusIsSpace: true }, context);
      continue;
    }
    const where = query ? (counts.get(key) > 1 ? { repeatedKey: key } : { field: `query.${key}` }) : {};
    maskEach(piece.slice(split + 1), at + split + 1, typed, { plusIsSpace: true, ...where }, context);
  }
}

// Path segments are route pieces as well as values: a segment is masked only when it is a typed value.
const maskSegments = (text, offset, typed, context) => {
  for (const { piece, at } of pieces(text, offset, "/")) maskEach(piece, at, typed, { plusIsSpace: false, inside: false }, context);
};

// The values of `k=v&…` text (or a pair with no =), as heldIn reads them.
const pairValues = (text) => text.split("&").map((pair) => ({ text: pair.slice(pair.indexOf("=") + 1), decode: "form", split: true }));

// A fragment's parts as heldIn reads them (see fragmentShape): its pair values; in a URL a value
// holds, its route as well, and a plain fragment as any text, where the top-level URL's route is a
// route piece and its plain fragment counts only whole.
function fragmentParts(fragment, { top }) {
  const shape = fragmentShape(fragment);
  const route = (text) => (top ? [] : [{ text, decode: "percent", split: false }]);
  if (shape.kind === "route+pairs") return [...route(fragment.slice(0, shape.split)), ...pairValues(fragment.slice(shape.split + 1))];
  if (shape.kind === "pairs") return pairValues(fragment);
  if (shape.kind === "route") return route(fragment);
  return [{ text: fragment, decode: "percent", split: false, whole: top }];
}

// The parts of `text` a site's URL parser reads, when it is a URL as written (see RELATIVE_PATH):
// its path, its query values and its fragment's parts. None when it isn't one.
function certainUrlParts(text) {
  const [, origin = "", pathname, query, fragment] = text.match(URL_PARTS) || [];
  if (pathname === undefined || !(origin || ((query !== undefined || fragment !== undefined) && RELATIVE_PATH.test(pathname)))) return [];
  return [
    { text: pathname, decode: "percent", split: false },
    ...(query === undefined ? [] : pairValues(query)),
    ...(fragment === undefined ? [] : fragmentParts(fragment, { top: false })),
  ];
}

// A request body's parts as heldIn reads them: a JSON document, a form's values, or text as sent.
function bodyParts(body) {
  if (typeof body !== "string" || !body) return [];
  if (parseJsonDocument(body)) return [{ text: body, decode: "none", split: true }];
  if (/^[^=&]+=/.test(body)) return pairValues(body);
  return [{ text: body, decode: "none", split: false }];
}

/**
 * Adds to `held` the typed values a certain reading of `parts` sends (see "Masking may guess"
 * above). Each part is `{ text, decode, split, whole? }`: its text as captured; the one decoding
 * its own syntax applies (`form`, + a space and then percent, as URLSearchParams reads a value;
 * `percent`, a path's; `none`, a JSON string's value or a body as sent), never more; whether the
 * decoded text may be read again (`split`: a value may, a path, route or text may not); and
 * `whole` when only the whole text counts. A decoded text holds a value it is, or holds between
 * characters that are not letters or digits (matchesIn); read again, a JSON document holds one only
 * in its scalars (as written or as read) and its string values, each a part of its own, and a URL
 * as written (certainUrlParts) in its parts; a `k=v` text is never read as a form. Too much text
 * to read (see MAX_READ_FACTOR) holds nothing proven.
 */
function heldIn(parts, values, held) {
  const wanted = values.filter(({ value }) => value.length >= MIN_LENGTH && !held.has(value));
  if (wanted.length === 0 || parts.length === 0) return;
  const found = new Set();
  const queue = [...parts];
  let budget = MAX_READ_FACTOR * parts.reduce((sum, { text }) => sum + text.length, 0) + READ_MARGIN;
  for (let index = 0; index < queue.length && found.size < wanted.length; index++) {
    const { text: raw, decode, split, whole } = queue[index];
    budget -= raw.length;
    if (budget < 0) return;
    const text = decode === "form" ? decodeLeniently(raw.replace(/\+/g, " ")) : decode === "percent" ? decodeLeniently(raw) : raw;
    const tokens = split ? jsonTokens(text) : null;
    for (const { value } of wanted) if (whole || tokens ? text === value : matchesIn(text, value).length > 0) found.add(value);
    if (!split) continue;
    if (!tokens) {
      queue.push(...certainUrlParts(text));
      continue;
    }
    for (const leaf of tokens.leaves) {
      const source = text.slice(leaf.start, leaf.end);
      if (leaf.kind === "string") queue.push({ text: JSON.parse(source), decode: "none", split: true });
      else for (const { value } of wanted) if (source === value || String(JSON.parse(source)) === value) found.add(value);
    }
  }
  for (const value of found) held.add(value);
}

const URL_PARTS = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*)?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/s;

/**
 * `url` with each typed value ({ value, marker, id? }) replaced by its marker, as `{ url, markers }`.
 * `markers` lists every marker in the result, as `{ start, end }` in it, with `typedValue` (the id
 * of the typed value it stands for), `type` (number or boolean) and `field` (`query.variables.year`)
 * for a JSON scalar it replaced (neither past MAX_FIELD_DEPTH), or `repeatedKey` instead of `field`
 * when the scalar's query key appears more than once. Pass the list a previous pass returned as
 * `markers`, and those spans stay as they are: no match reaches into them, and the typed value a
 * query or fragment one names by `typedValue` counts as held there. Any other text that looks like a marker is text a page or the
 * user wrote, matched as any other.
 *
 * Query values (and a fragment's `?k=v` or `k=v` pairs) are form-decoded and matched whole or
 * inside, a JSON value only in its values. A path segment, or a `#/route`'s, is masked only when it
 * is a typed value no query, fragment or `body` value certainly holds (see heldIn): there it is a
 * fixed route piece (/api/users?q=users). A plain fragment is masked only whole. Keys and the origin never change.
 * `walk` replaces maskValue, for tests of the check that follows it.
 */
function maskTypedValuesInUrl(url, typed, options = {}) {
  const outer = insidePatterns;
  insidePatterns = new Map();
  try {
    return maskUrl(url, typed, options);
  } finally {
    insidePatterns = outer;
  }
}

function maskUrl(url, typed, { body, markers = [], walk }) {
  if (typeof url !== "string") return { url, markers };
  const match = url.match(URL_PARTS);
  if (!match || typed.length === 0) return { url, markers };
  const [, origin = "", pathname, query, fragment] = match;
  // The markers an earlier pass inserted, each kept as it is.
  const listed = [];
  for (const { start, end, ...info } of [...markers].sort((a, b) => a.start - b.start)) {
    if (start < (listed.at(-1)?.end ?? 0) || !REDACTED_MARKER.test(url.slice(start, end))) continue;
    listed.push({ start, end, listed: true, pieces: [{ marker: url.slice(start, end), ...info }] });
  }
  const list = editList(listed);
  const values = typed.filter(({ value }) => value).sort((a, b) => b.value.length - a.value.length);
  const context = { list, walk };
  const queryStart = origin.length + pathname.length + 1;
  if (query !== undefined) maskPairs(query, queryStart, values, context, { query: true });
  // Where the query and fragment hold values (not a #/route), for the markers listed there.
  const held = query === undefined ? [] : [{ start: queryStart, end: queryStart + query.length }];
  let route = null;
  if (fragment !== undefined) {
    const fragmentStart = url.length - fragment.length;
    const edits = maskEach(fragment, fragmentStart, values, { plusIsSpace: false, inside: false }, context);
    const shape = fragmentShape(fragment);
    if (edits.length === 1 && edits[0].start === fragmentStart && edits[0].end === url.length) held.push({ start: fragmentStart, end: url.length });
    else if (shape.kind === "route+pairs") {
      route = { text: fragment.slice(0, shape.split), at: fragmentStart };
      maskPairs(fragment.slice(shape.split + 1), fragmentStart + shape.split + 1, values, context);
      held.push({ start: fragmentStart + shape.split + 1, end: url.length });
    } else if (shape.kind === "route") route = { text: fragment, at: fragmentStart };
    else {
      if (shape.kind === "pairs") maskPairs(fragment, fragmentStart, values, context);
      held.push({ start: fragmentStart, end: url.length });
    }
  }
  // The values the query, fragment or body certainly sends (see heldIn): a path segment holding one
  // is a route piece. Each marker listed in the URL reads as one U+FFFF, beside which a letter or
  // digit still ends a match, and which no typed value holding one is ever counted past; a listed
  // marker counts by the id it names, below.
  const found = new Set();
  let sent = "";
  let copied = 0;
  for (const { start, end } of listed) {
    sent += `${url.slice(copied, start)}\uffff`;
    copied = end;
  }
  const [, , , sentQuery, sentFragment] = (sent + url.slice(copied)).match(URL_PARTS);
  const parts = [...(sentQuery === undefined ? [] : pairValues(sentQuery)), ...(sentFragment === undefined ? [] : fragmentParts(sentFragment, { top: true })), ...bodyParts(body)];
  // Only a value a path or route segment spells needs reading for (one no segment spells is
  // masked nowhere in the path, held or not).
  const spelled = new Set();
  for (const text of [pathname, route?.text ?? ""]) {
    for (const segment of text.split("/")) for (const reading of [...decodedTexts(segment, false), decodeLeniently(segment)]) spelled.add(reading);
  }
  heldIn(parts, values.filter(({ value }) => spelled.has(value) && !value.includes("\uffff")), found);
  const byId = new Map(values.filter(({ id }) => id).map((item) => [item.id, item]));
  for (const { start, end, pieces: [{ typedValue }] } of listed) {
    if (!held.some((part) => start >= part.start && end <= part.end)) continue;
    const item = byId.get(typedValue);
    if (item) found.add(item.value);
  }
  const pathContext = { list, walk };
  const pathTyped = values.filter(({ value }) => !found.has(value));
  if (route !== null) maskSegments(route.text, route.at, pathTyped, pathContext);
  maskSegments(pathname, origin.length, pathTyped, pathContext);
  let result = "";
  let index = 0;
  const inserted = [];
  for (const edit of list.all()) {
    result += url.slice(index, edit.start);
    for (const piece of edit.pieces) {
      if (typeof piece === "string") {
        result += piece;
        continue;
      }
      const { marker, ...info } = piece;
      inserted.push({ start: result.length, end: result.length + marker.length, ...info });
      result += marker;
    }
    index = edit.end;
  }
  return { url: result + url.slice(index), markers: inserted };
}

/** `url` with the typed values in it replaced by their markers (see maskTypedValuesInUrl). */
const redactTypedValuesInUrl = (url, typed, options) => maskTypedValuesInUrl(url, typed, options).url;

// A placeholder a body holds as the whole body or a whole field value: a JSON string or a
// urlencoded value. Markup such as XML-RPC's <value> is part of a longer value, so isn't one.
function bodyPlaceholder(body) {
  // Read in order with its own stack, so a body nested any depth is read.
  const stack = [body];
  const pushAll = (items) => {
    for (let index = items.length - 1; index >= 0; index--) stack.push(items[index]);
  };
  while (stack.length) {
    const item = stack.pop();
    if (item && typeof item === "object") {
      pushAll(Object.values(item));
      continue;
    }
    if (typeof item !== "string") continue;
    const whole = decodings(item).find(({ text }) => WHOLE_PLACEHOLDER.test(text));
    if (whole) return whole.text;
    let parsed = null;
    try {
      parsed = JSON.parse(item);
    } catch {}
    if (parsed && typeof parsed === "object") stack.push(parsed);
    else if (item.includes("=")) pushAll(item.split("&").filter((pair) => pair.includes("=")).map((pair) => pair.slice(pair.indexOf("=") + 1)));
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
  // A query name that repeats stays in the URL with every value, as the record masked them.
  const search = String(request?.url || "").split("#")[0].split("?").slice(1).join("?");
  for (const pair of search ? search.split("&") : []) {
    const [name, ...value] = pair.split("=");
    const hit = found(`query.${decodeLeniently(name.replace(/\+/g, " "))}`, value.join("="));
    if (hit) return { ...hit, inUrl: true };
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
function placeholderError({ field, placeholder, inUrl = false }, label = "<playbook> <op>") {
  if (inUrl) return new Error(`${field} holds ${placeholder} in the request URL, a value the record redacted under a query name sent more than once, which pb param can't make an input; record again with pb record start --include-input-values to keep it`);
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
