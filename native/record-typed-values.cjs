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

const parseJsonDocument = (text) => {
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
 * The values of a JSON document as written, never its keys: `[{ kind, start, end, path, repeated? }]`,
 * `kind` string, number or literal (true, false, null), `start`/`end` the value's source span in
 * `text`, `path` its keys and indexes. `repeated`: the value sits under a key its object holds more
 * than once, so a path to it names more than one value. Null when `text` isn't a JSON object or array.
 */
function jsonLeaves(text) {
  if (!parseJsonDocument(text)) return null;
  const leaves = [];
  let index = 0;
  const space = () => {
    while (/\s/.test(text[index] || "")) index++;
  };
  const string = () => {
    const start = index;
    for (index++; text[index] !== '"'; index++) if (text[index] === "\\") index++;
    index++;
    return { start, end: index };
  };
  const value = (path) => {
    space();
    const char = text[index];
    if (char === "{" || char === "[") {
      const object = char === "{";
      const members = [];
      index++;
      space();
      if (text[index] === (object ? "}" : "]")) {
        index++;
        return;
      }
      for (let item = 0; ; item++) {
        space();
        let key = item;
        if (object) {
          const span = string();
          key = JSON.parse(text.slice(span.start, span.end));
          space();
          index++;
        }
        const first = leaves.length;
        value([...path, key]);
        members.push({ key, first, last: leaves.length });
        space();
        if (text[index++] !== ",") break;
      }
      for (const { key, first, last } of members) {
        if (members.filter((member) => member.key === key).length < 2) continue;
        for (let leaf = first; leaf < last; leaf++) leaves[leaf].repeated = true;
      }
      return;
    }
    if (char === '"') {
      leaves.push({ kind: "string", ...string(), path });
      return;
    }
    const start = index;
    while (index < text.length && !/[\s,\]}]/.test(text[index])) index++;
    leaves.push({ kind: char === "t" || char === "f" || char === "n" ? "literal" : "number", start, end: index, path });
  };
  try {
    value([]);
  } catch {
    // Nested deeper than the stack allows: not read as JSON.
    return null;
  }
  return leaves;
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
// `url.slice(start, end)` with `pieces`, each text written as is or a marker (`{ marker, type?,
// field? }`). Edits never overlap each other or a marker an earlier pass listed, so no match can
// reach into a marker; everything outside an edit stays byte for byte as captured.

const MAX_JSON_NESTING = 4;

/**
 * The edits that mask `typed` in a JSON document's values, never its keys: a string that is the
 * value or holds it (see matchesIn), a string that does once decoded again (the whole string), a
 * JSON document held in a string (walked the same way), and a number or literal that is the value
 * as written or as read (`2024.0`, `1e3`, `null`), which becomes a marker string recording its JSON
 * type and `field` path. `at(i)` is where index i of `text` sits in the URL; `encode` writes text
 * of `text`'s level as the URL holds it. `plusIsSpace`: a string decoded again reads + as a space.
 */
function maskJson(text, typed, { at, encode, free, field, repeatedKey, plusIsSpace, nesting = 0 }) {
  const leaves = jsonLeaves(text);
  if (!leaves) return [];
  const marker = { marker: typed.marker };
  const edits = [];
  const accept = (edit) => {
    if (!free(edit) || edits.some((other) => edit.start < other.end && edit.end > other.start)) return false;
    edits.push(edit);
    return true;
  };
  for (const leaf of leaves) {
    const source = text.slice(leaf.start, leaf.end);
    if (leaf.kind !== "string") {
      const read = JSON.parse(source);
      if (typed.value.length < MIN_LENGTH || (source !== typed.value && String(read) !== typed.value)) continue;
      const type = read === null ? null : typeof read;
      const where = repeatedKey ? { repeatedKey } : field && !leaf.repeated ? { field: [field, ...leaf.path].join(".") } : {};
      accept({ start: at(leaf.start), end: at(leaf.end), pieces: [encode('"'), { ...marker, ...(type ? { type, ...where } : {}) }, encode('"')] });
      continue;
    }
    const { value, starts } = decodeJsonString(source);
    const inLeaf = (index) => at(leaf.start + starts[index]);
    if (nesting < MAX_JSON_NESTING && parseJsonDocument(value)) {
      const escape = (piece) => encode(JSON.stringify(piece).slice(1, -1));
      for (const edit of maskJson(value, typed, { at: inLeaf, encode: escape, free, plusIsSpace: false, nesting: nesting + 1 })) accept(edit);
      continue;
    }
    const ranges = matchesIn(value, typed.value);
    if (ranges.length > 0) {
      for (const { start, end } of ranges) accept({ start: inLeaf(start), end: inLeaf(end), pieces: [marker] });
      continue;
    }
    const again = levelsOf(value, plusIsSpace).slice(1).some(({ text: decoded }) => (typed.value.length >= MIN_LENGTH && decoded === typed.value) || matchesIn(decoded, typed.value).length > 0);
    if (again) accept({ start: inLeaf(0), end: inLeaf(value.length), pieces: [marker] });
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
  const marker = { marker: typed.marker };
  const whole = { start: offset, end: offset + raw.length, pieces: [marker] };
  if (typed.value.length >= MIN_LENGTH && levels.slice(1).some(({ text }) => text === typed.value) && free(whole)) return [whole];
  if (!inside) return [];
  const depth = levels.findIndex(({ text }, index) => index > 0 && parseJsonDocument(text));
  if (depth > 0) {
    const encode = (text) => {
      for (let level = depth; level > 0; level--) text = encodeLike(text, levels[level - 1].text, plusIsSpace && level === 1);
      return text;
    };
    const at = (index) => offset + toRaw(levels, depth, index);
    return maskJson(levels[depth].text, typed, { at, encode, free, field, repeatedKey, plusIsSpace: plusIsSpace && raw.includes("+") });
  }
  for (let level = levels.length - 1; level > 0; level--) {
    const edits = matchesIn(levels[level].text, typed.value, { escapes: level < levels.length - 1 })
      .map(({ start, end }) => ({ start: offset + toRaw(levels, level, start), end: offset + toRaw(levels, level, end), pieces: [marker] }))
      .filter(free);
    if (edits.length > 0) return edits;
  }
  return [];
}

// The edits made so far and the spans they and the listed markers take.
function editList(taken = []) {
  const spans = [...taken];
  const edits = [];
  return {
    edits,
    free: ({ start, end }) => spans.every((span) => end <= span.start || start >= span.end),
    add(list) {
      spans.push(...list);
      edits.push(...list);
    },
  };
}

// Each typed value in turn, the longest first, so `dummy romeo` is found before `romeo`; `found`
// collects the values it masked.
function maskEach(raw, offset, typed, options, list, found) {
  for (const item of typed) {
    const edits = maskValue(raw, offset, item, { ...options, free: list.free });
    if (edits.length === 0) continue;
    list.add(edits);
    found?.add(item.value);
  }
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
function maskPairs(text, offset, typed, list, found, { query = false } = {}) {
  const pairs = pieces(text, offset, "&").map(({ piece, at }) => {
    const split = piece.indexOf("=");
    return { piece, at, split, key: split < 0 ? null : levelsOf(piece.slice(0, split), true)[1].text };
  });
  for (const { piece, at, split, key } of pairs) {
    if (split < 0) {
      maskEach(piece, at, typed, { plusIsSpace: true }, list, found);
      continue;
    }
    const repeated = pairs.filter((pair) => pair.key === key).length > 1;
    const where = query ? (repeated ? { repeatedKey: key } : { field: `query.${key}` }) : {};
    maskEach(piece.slice(split + 1), at + split + 1, typed, { plusIsSpace: true, ...where }, list, found);
  }
}

// Path segments are route pieces as well as values: a segment is masked only when it is a typed value.
const maskSegments = (text, offset, typed, list) => {
  for (const { piece, at } of pieces(text, offset, "/")) maskEach(piece, at, typed, { plusIsSpace: false, inside: false }, list);
};

// Which typed values a request body sends, read as JSON, a form or text, the way a URL value is.
// The body isn't rewritten, so its edits are dropped.
function bodyHolds(body, typed, found) {
  if (typeof body !== "string" || !body) return;
  const list = editList();
  if (!parseJsonDocument(body) && /^[^=&]+=/.test(body)) maskPairs(body, 0, typed, list, found);
  else maskEach(body, 0, typed, { plusIsSpace: false }, list, found);
}

const URL_PARTS = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*)?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/s;

/**
 * `url` with each typed value ({ value, marker }) replaced by its marker, as `{ url, markers }`.
 * `markers` lists every marker in the result, as `{ start, end }` in it, with `type` (number or
 * boolean) and `field` (`query.variables.year`) for a JSON scalar it replaced, or `repeatedKey`
 * instead of `field` when the scalar's query key appears more than once. Pass the list a previous
 * pass returned as `markers`, and those spans stay as they are: no match reaches into them, and a
 * typed value whose marker one of them is counts as held by the query. Any other text that looks
 * like a marker is text a page or the user wrote, matched as any other.
 *
 * Query values (and a fragment's `?k=v` or `k=v` pairs) are form-decoded and matched whole or
 * inside, a JSON value only in its values. A path segment, or a `#/route`'s, is masked only when it
 * is a typed value no query, fragment or `body` value holds: there it is a fixed route piece
 * (/api/users?q=users). A plain fragment is masked only whole. Keys and the origin never change.
 */
function maskTypedValuesInUrl(url, typed, { body, markers = [] } = {}) {
  if (typeof url !== "string") return { url, markers };
  const match = url.match(URL_PARTS);
  if (!match || typed.length === 0) return { url, markers };
  const [, origin = "", pathname, query, fragment] = match;
  // The markers an earlier pass inserted, each kept as it is.
  const listed = [];
  for (const { start, end, ...info } of [...markers].sort((a, b) => a.start - b.start)) {
    if (start < (listed.at(-1)?.end ?? 0) || !REDACTED_MARKER.test(url.slice(start, end))) continue;
    listed.push({ start, end, pieces: [{ marker: url.slice(start, end), ...info }] });
  }
  const list = editList(listed);
  const values = typed.filter(({ value }) => value).sort((a, b) => b.value.length - a.value.length);
  const found = new Set();
  bodyHolds(body, values, found);
  const queryStart = origin.length + pathname.length + 1;
  if (query !== undefined) maskPairs(query, queryStart, values, list, found, { query: true });
  // Where the query and fragment hold values (not a #/route), for the markers listed there.
  const held = query === undefined ? [] : [{ start: queryStart, end: queryStart + query.length }];
  let route = null;
  if (fragment !== undefined) {
    const fragmentStart = url.length - fragment.length;
    const before = list.edits.length;
    maskEach(fragment, fragmentStart, values, { plusIsSpace: false, inside: false }, list, found);
    const split = fragment.indexOf("?");
    if (list.edits.length > before) held.push({ start: fragmentStart, end: url.length });
    else if (split >= 0) {
      route = { text: fragment.slice(0, split), at: fragmentStart };
      maskPairs(fragment.slice(split + 1), fragmentStart + split + 1, values, list, found);
      held.push({ start: fragmentStart + split + 1, end: url.length });
    } else if (fragment.startsWith("/")) route = { text: fragment, at: fragmentStart };
    else {
      if (fragment.includes("=")) maskPairs(fragment, fragmentStart, values, list, found);
      held.push({ start: fragmentStart, end: url.length });
    }
  }
  for (const { start, end, pieces: [{ marker }] } of listed) {
    if (!held.some((part) => start >= part.start && end <= part.end)) continue;
    for (const item of values) if (item.marker === marker) found.add(item.value);
  }
  const pathTyped = values.filter(({ value }) => !found.has(value));
  if (route !== null) maskSegments(route.text, route.at, pathTyped, list);
  maskSegments(pathname, origin.length, pathTyped, list);
  let result = "";
  let index = 0;
  const inserted = [];
  for (const edit of [...listed, ...list.edits].sort((a, b) => a.start - b.start)) {
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
