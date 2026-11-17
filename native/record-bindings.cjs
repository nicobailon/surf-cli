// Chain bindings a record shows: at pb record stop --draft, a value one captured response returned
// (a JSON value, or an HTML link's path segment or id-like attribute) that a later request sent as
// a whole URL path segment or query value. Each becomes a proposed binding of a chain over the two
// requests, saved by pb save --from-record --chain. Detection reads the live entries, the only
// place the response bodies are (the saved trace drops them), and the proposal holds request ids,
// paths, selectors and field names, never a value. Values from headers, cookies, secret-named
// fields and credential-like text are never bound.

const { DomUtils, parseDocument } = require("htmlparser2");
const { nameAfter } = require("./parse-inputs.cjs");
const { RESERVED_RUN_OPTIONS } = require("./playbook-param.cjs");
const { neverReplayed } = require("./playbook-records.cjs");
const { CHAIN_LIMITS } = require("./playbooks.cjs");
const { isSensitiveName, redactCredentialLiterals, secretHeaderEchoes } = require("./redaction.cjs");
const { requestEffect } = require("./request-kinds.cjs");

const MIN_LENGTH = 6;
// Bodies past this many characters aren't read for values.
const MAX_BODY = 5_000_000;
// Leaves read from one JSON body, and places kept for one value.
const MAX_LEAVES = 50_000;
const MAX_PLACES = 20;
// A JSON key a path can hold (records.cjs paths split on `.` and stop at brackets, `?`, `*` and space).
const KEY = /^(?!(?:__proto__|constructor|prototype)$)[\w$-]+$/;
// A class or id a selector can take as written.
const NAME = /^[A-Za-z_][\w-]*$/;
// Path segments that never name a step: they say nothing about what the request reads.
const PLAIN_SEGMENT = /^(?:index|default|api|v\d+)$/i;
// The chain's own inputs when a step runs over a list.
const EACH_ARGS = { limit: { type: "number", default: CHAIN_LIMITS.eachLimit }, "delay-ms": { type: "number", default: CHAIN_LIMITS.delayMs } };

const snake = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const singular = (word) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word);
const decode = (segment) => { try { return decodeURIComponent(segment); } catch { return segment; } };
const segmentsOf = (url) => url.pathname.split("/").filter(Boolean).map(decode);

function parseUrl(text, base) {
  try {
    const url = new URL(text, base);
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

// A JSON path ($.items[0].id) and a record path (items[0].id) of a list of keys and indexes.
const jsonPath = (steps) => `$${steps.map((step) => (typeof step === "number" ? `[${step}]` : `.${step}`)).join("")}`;
const recordPath = (steps) => jsonPath(steps).slice(2).replace(/^\./, "");
const walk = (value, steps) => steps.reduce((node, step) => (node === null || node === undefined ? undefined : node[step]), value);

// The text a value has at a place: itself, or its nth URL path segment. A relative URL counts from
// the site's root, as the chain runner reads it.
function textAt(value, segment, base) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value);
  if (segment === undefined) return text;
  const url = parseUrl(text, base);
  return url ? segmentsOf(url)[segment - 1] : undefined;
}

function sameValues(values) {
  return new Set(values.filter((value) => value !== undefined)).size;
}

/**
 * Where each value of 6 characters or more sits in a response: JSON leaves (and the path segments
 * of a leaf that is a URL), or an HTML element's href path segments and id-like attributes. Each
 * place is { kind: "json", steps, segment? } or { kind: "html", selector, attr, segment? }, with
 * `varies`: whether the list the place is in holds other values there too.
 */
function placesIn(entry, urlData) {
  const body = entry.responseBody;
  if (typeof body !== "string" || body.length > MAX_BODY) return new Map();
  const mime = String(entry.mimeType || entry.responseHeaders?.["content-type"] || "").toLowerCase();
  if (/^\s*[[{]/.test(body)) {
    try {
      return jsonPlaces(JSON.parse(body), entry.url, urlData);
    } catch {}
  }
  if (mime.includes("html") || entry.type === "Document") return htmlPlaces(body, entry.url);
  return new Map();
}

function addPlace(places, value, place) {
  if (value === undefined || value.length < MIN_LENGTH) return;
  const list = places.get(value) ?? [];
  if (list.length < MAX_PLACES) list.push(place);
  places.set(value, list);
}

// The text of each string or number leaf in a JSON value.
function leafValues(root) {
  const values = new Set();
  const stack = [root];
  while (stack.length > 0 && values.size <= MAX_LEAVES) {
    const value = stack.pop();
    if (typeof value === "string" || typeof value === "number") values.add(String(value));
    else if (value && typeof value === "object") stack.push(...Object.values(value));
  }
  return values;
}

// `urlData` holds the query values the record's requests sent. A key that holds a digit
// (as stableId reads ids) or is a value of the body or of `urlData` is data, such as a post's or a
// session's id: no path goes through it, so no path or field name holds it.
function jsonPlaces(root, base, urlData = new Set()) {
  const places = new Map();
  const values = leafValues(root);
  const isDataKey = (key) => /\d/.test(key) || values.has(key) || urlData.has(key);
  let leaves = 0;
  const visit = (value, steps) => {
    if (leaves > MAX_LEAVES) return;
    if (Array.isArray(value)) return value.forEach((item, index) => visit(item, [...steps, index]));
    if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) if (KEY.test(key) && !isSensitiveName(key) && !isDataKey(key)) visit(item, [...steps, key]);
      return;
    }
    if (typeof value !== "string" && typeof value !== "number") return;
    leaves++;
    addPlace(places, String(value), { kind: "json", steps });
    // A URL's segments: only an absolute or root-relative one reads the same from any page.
    if (typeof value === "string" && /^(?:https?:\/\/|\/(?!\/))/i.test(value)) {
      const url = parseUrl(value, base);
      url && segmentsOf(url).forEach((segment, index) => addPlace(places, segment, { kind: "json", steps, segment: index + 1 }));
    }
  };
  visit(root, []);
  // Whether the place is in a list whose other records hold other values there.
  const varies = new Map();
  for (const list of places.values()) {
    for (const place of list) {
      const at = place.steps.findIndex((step) => typeof step === "number");
      if (at < 0) continue;
      const steps = place.steps.slice(0, at);
      const rest = place.steps.slice(at + 1);
      const key = `${jsonPath(steps)} ${recordPath(rest)} ${place.segment ?? ""}`;
      if (!varies.has(key)) {
        const records = walk(root, steps);
        varies.set(key, records.length === 1 || sameValues(records.map((record) => textAt(walk(record, rest), place.segment, base))) > 1);
      }
      place.list = { steps, rest, varies: varies.get(key) };
    }
  }
  return places;
}

const classesOf = (el) => (el.attribs?.class || "").split(/\s+/).filter((name) => NAME.test(name));
const compound = (el) => `${el.name}${classesOf(el).map((name) => `.${name}`).join("")}`;
// An id with a digit is likely one element's own (quote-12), so it can't name a list.
const stableId = (el) => (NAME.test(el.attribs?.id || "") && !/\d/.test(el.attribs.id) ? el.attribs.id : "");

// The selector of an element's kind: its tag and classes under each parent up to the nearest one
// with a class or a stable id, as `div.quote > span > a`. Elements with the same selector are a list.
function selectorOf(el) {
  const parts = [compound(el)];
  for (let node = el.parent, depth = 0; node && node.type === "tag" && !["html", "body"].includes(node.name) && depth < 8; node = node.parent, depth++) {
    const id = stableId(node);
    if (id) {
      parts.unshift(`#${id}`);
      break;
    }
    parts.unshift(compound(node));
    if (classesOf(node).length > 0) break;
  }
  return parts.join(" > ");
}

// An attribute that names a record: id, data-id, data-…-id.
const isIdAttribute = (name) => name === "id" || /^data-(?:[\w-]+-)?id$/i.test(name);

function htmlPlaces(html, base) {
  // A link or id names a record only in a list of them, each its own: a page's lone links (a
  // category menu, a logo) hold its route words.
  const places = new Map();
  const groups = new Map();
  const found = [];
  for (const el of DomUtils.findAll((node) => Boolean(node.attribs), parseDocument(html).children)) {
    const attrs = Object.keys(el.attribs).filter((name) => (name === "href" && el.name === "a") || (isIdAttribute(name) && !isSensitiveName(name)));
    if (attrs.length === 0) continue;
    const selector = selectorOf(el);
    for (const attr of attrs) {
      const key = `${selector}[${attr}]`;
      groups.set(key, [...(groups.get(key) ?? []), el]);
      found.push({ el, attr, key });
    }
  }
  const varies = new Map();
  const variesAt = (key, segment, read) => {
    const memo = `${key} ${segment ?? ""}`;
    if (!varies.has(memo)) varies.set(memo, sameValues(groups.get(key).map(read)) > 1);
    return varies.get(memo);
  };
  for (const { el, attr, key } of found) {
    const group = groups.get(key);
    const value = el.attribs[attr];
    if (attr === "href") {
      const url = parseUrl(value, base);
      if (!url) continue;
      segmentsOf(url).forEach((segment, index) => {
        if (segment.length < MIN_LENGTH) return;
        const read = (other) => textAt(parseUrl(other.attribs.href, base)?.href, index + 1, base);
        addPlace(places, segment, { kind: "html", selector: key, attr, segment: index + 1, varies: variesAt(key, index + 1, read) });
      });
    } else if (value.length >= MIN_LENGTH) {
      addPlace(places, value, { kind: "html", selector: key, attr, varies: variesAt(key, undefined, (other) => other.attribs[attr]) });
    }
  }
  return places;
}

// The URL path segments and query values a request sends, each a place a binding can fill.
// `nameable` says whether a segment can name an input: not a typed, cookie or secret-looking value.
function slotsOf(entry, nameable) {
  const url = parseUrl(entry.url);
  if (!url) return [];
  const segments = segmentsOf(url);
  const nameFrom = (before) => (before !== undefined && nameable(before) ? nameAfter(before) : undefined);
  const slots = segments.map((value, index) => ({ field: `path.${index + 1}`, value, name: nameFrom(segments[index - 1]) || "id", secret: isSensitiveName(segments[index - 1]) }));
  const keys = [...url.searchParams.keys()];
  for (const [key, value] of url.searchParams) {
    // A repeated key stays in the drafted URL (draftQuery), where no input can take it.
    if (keys.filter((other) => other === key).length > 1) continue;
    slots.push({ field: `query.${key}`, value, name: snake(key) || "value", secret: isSensitiveName(key) });
  }
  return slots.filter((slot) => slot.value.length >= MIN_LENGTH && !slot.secret);
}

// What a request's own URL says: its path segments and query values, which a later request can
// share as route, not as a value it returned.
function urlValues(entry) {
  const url = parseUrl(entry.url);
  return new Set(url ? [...segmentsOf(url), ...url.searchParams.values()] : []);
}

// How a step's response is read for the steps after it: a list (each over it) or single values.
// A step is read one way: a binding that needs another is dropped.
function shapeOf(place) {
  if (place.kind === "html") return { kind: "list", key: `html:${place.selector}`, extract: { html: { item: place.selector, fields: {} } }, shown: place.selector };
  if (place.list) return { kind: "list", key: `json:${jsonPath(place.list.steps)}`, extract: { records: jsonPath(place.list.steps) }, shown: jsonPath(place.list.steps) };
  return { kind: "single", key: "single", extract: {} };
}

// The field a place adds to its step's extract: its name and how the extract reads it.
function fieldOf(place) {
  if (place.kind === "html") return { name: place.attr === "href" ? "url" : snake(place.attr.replace(/^data-/, "")) || "id", spec: `:scope@${place.attr}` };
  const steps = place.list ? place.list.rest : place.steps;
  const last = [...steps].reverse().find((step) => typeof step === "string");
  return steps.length === 0 ? null : { name: snake(last ?? "value") || "value", spec: recordPath(steps) };
}

// Names a field in a step's extract: the same spec keeps its name; a taken name gets _2, _3...
function claimField(step, field) {
  const fields = step.fields;
  const same = Object.entries(fields).find(([, spec]) => spec === field.spec);
  if (same) return same[0];
  let name = field.name;
  for (let n = 2; Object.hasOwn(fields, name); n++) name = `${field.name}_${n}`;
  fields[name] = field.spec;
  return name;
}

function uniqueName(base, taken) {
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
  taken.add(name);
  return name;
}

// A step's id: "list" for one that each runs over, else a route word of its path, singular
// (postings → posting): the one before its first bound segment, or its last. A segment that could
// be a value (digits, underscores, a slug's case; one `nameable` refuses) names no step.
function stepId(step, nameable) {
  if (step.shape?.kind === "list") return "list";
  const url = parseUrl(step.entry.url);
  const segments = url ? segmentsOf(url) : [];
  const bare = (segment) => segment.replace(/\.html?$/i, "");
  const isWord = (segment) => typeof segment === "string" && nameable(segment) && /^[a-z][a-z-]{0,29}$/.test(bare(segment)) && !PLAIN_SEGMENT.test(bare(segment));
  const bound = step.bindings.map((binding) => /^path\.(\d+)$/.exec(binding.slot.field)?.[1]).filter(Boolean).map(Number);
  const before = bound.length > 0 ? segments[Math.min(...bound) - 2] : undefined;
  const word = isWord(before) ? before : segments.filter((segment, index) => isWord(segment) && !bound.includes(index + 1)).at(-1);
  return snake(singular(bare(word ?? ""))) || "page";
}

// Whether `target` was already bound in this chain: the same method, origin, path and query keys
// with the bound values left out (a list page loaded again, the redirect to a detail page).
function templateOf(entry, fields) {
  const url = parseUrl(entry.url);
  const path = segmentsOf(url).map((segment, index) => (fields.includes(`path.${index + 1}`) ? "*" : segment)).join("/");
  return `${entry.method} ${url.origin}/${path}?${[...url.searchParams.keys()].sort().join("&")}`;
}

function describeBinding(binding) {
  const { source, path, segment } = binding;
  const at = `${path}${segment ? ` path segment ${segment}` : ""}`;
  return source.shape.kind === "list" ? `${at} of each record of ${source.op} (${source.shape.shown})` : `${at} of ${source.op}`;
}

/**
 * The chain a record's requests show, or null: for each later read request that sends a value an
 * earlier one returned, a step that binds it. `entries` are the live captured requests, with
 * their response bodies. Returns { version, recordId, op, steps, bindings }: `op` is the chain op
 * pb save --from-record --chain saves, `steps` the op each step runs (its request, the inputs its
 * URL takes, the extract the steps after it read) and `bindings` one line per binding.
 */
function proposeChain({ record, entries, typed = [] }) {
  const reads = entries.filter((entry) => !neverReplayed(entry, record.origin) && requestEffect(entry) === "read" && entry.status >= 200 && entry.status < 300);
  if (reads.length < 2) return null;
  const echoes = secretHeaderEchoes(entries.flatMap((entry) => [entry.requestHeaders, entry.responseHeaders]));
  const secrets = [...echoes.long, ...echoes.short];
  const looksSecret = (value) => redactCredentialLiterals(value) !== value || secrets.some((secret) => secret === value || (secret.length >= 8 && (secret.includes(value) || value.includes(secret))));
  const typedValues = new Set(typed.map(String));
  const nameable = (segment) => !typedValues.has(segment) && !looksSecret(segment);
  const urlCache = new Map();
  const urlValuesOf = (entry) => {
    if (!urlCache.has(entry)) urlCache.set(entry, urlValues(entry));
    return urlCache.get(entry);
  };
  // The query values the record sent. Path segments stay out: a route word (items, postings) is
  // a JSON key too, and an id in a path holds a digit or is a value of the body.
  const urlData = new Set(entries.flatMap((entry) => [...(parseUrl(entry.url)?.searchParams.values() ?? [])]));
  const placeCache = new Map();
  const places = (entry) => {
    if (!placeCache.has(entry)) placeCache.set(entry, placesIn(entry, urlData));
    return placeCache.get(entry);
  };

  const steps = new Map();
  const templates = new Set();
  for (const [index, entry] of reads.entries()) {
    const earlier = reads.slice(0, index).reverse();
    // Steps already in the chain first, then the nearest request before.
    const sources = [...earlier.filter((other) => steps.has(other)), ...earlier.filter((other) => !steps.has(other))];
    const pending = { each: null, shapes: new Map() };
    const bindings = [];
    for (const slot of slotsOf(entry, nameable)) {
      if (looksSecret(slot.value)) continue;
      for (const source of sources) {
        const step = steps.get(source);
        // An each step's result is a list of its runs, not the response it recorded.
        if (step?.each) continue;
        if (urlValuesOf(source).has(slot.value)) continue;
        const place = (places(source).get(slot.value) ?? []).find((candidate) => (candidate.kind === "html" ? candidate.varies : !candidate.list || candidate.list.varies));
        if (!place) continue;
        const shape = shapeOf(place);
        const current = step?.shape ?? pending.shapes.get(source);
        if (current && current.key !== shape.key) continue;
        if (shape.kind === "list" && pending.each && pending.each !== source) continue;
        const field = fieldOf(place);
        if (shape.kind === "single" && !field) continue;
        pending.shapes.set(source, current ?? shape);
        if (shape.kind === "list") pending.each = source;
        bindings.push({ slot, source, place, field });
        break;
      }
    }
    if (bindings.length === 0) continue;
    const template = templateOf(entry, bindings.map((binding) => binding.slot.field));
    if (templates.has(template)) continue;
    const added = new Set([...bindings.map((binding) => binding.source), entry].filter((other) => !steps.has(other)));
    if (steps.size + added.size > CHAIN_LIMITS.steps) break;
    templates.add(template);
    for (const other of added) steps.set(other, { entry: other, shape: null, fields: {}, bindings: [], each: null });
    const step = steps.get(entry);
    step.each = pending.each && steps.get(pending.each);
    const names = new Set();
    for (const binding of bindings) {
      const source = steps.get(binding.source);
      source.shape ??= pending.shapes.get(binding.source);
      const fieldName = binding.field ? claimField(source, binding.field) : null;
      const input = uniqueName(RESERVED_RUN_OPTIONS.has(binding.slot.name) ? `${binding.slot.name}_value` : binding.slot.name, names);
      step.bindings.push({ slot: binding.slot, input, source, path: fieldName ? `$.${fieldName}` : "$", ...(binding.place.segment ? { segment: binding.place.segment } : {}) });
    }
  }
  if (steps.size === 0) return null;

  const ordered = reads.filter((entry) => steps.has(entry)).map((entry) => steps.get(entry));
  // item is the record an each step runs for (playbooks.cjs), never a step id.
  const ids = new Set(["item"]);
  for (const step of ordered) {
    step.id = uniqueName(stepId(step, nameable), ids);
    step.op = `${record.op}_${step.id}`.slice(0, 64);
  }
  const extractOf = (step) => {
    if (!step.shape) return undefined;
    const fields = Object.keys(step.fields).length > 0 ? { fields: step.fields } : {};
    return step.shape.extract.html ? { html: { ...step.shape.extract.html, ...fields } } : { ...step.shape.extract, ...fields };
  };
  const hasEach = ordered.some((step) => step.each);
  const chain = ordered.map((step) => {
    const bound = Object.fromEntries(step.bindings.map((binding) => [binding.input, { from: binding.source === step.each ? "item" : binding.source.id, path: binding.path, ...(binding.segment ? { segment: binding.segment } : {}) }]));
    return { id: step.id, op: step.op, ...(step.each ? { each: { from: step.each.id, limit: "{{limit}}", delayMs: "{{delay-ms}}" } } : {}), ...(step.bindings.length ? { with: bound } : {}) };
  });
  return {
    version: 1,
    recordId: record.id,
    op: { id: record.op, description: `Drafted from ${record.id}`, effect: "read", args: hasEach ? EACH_ARGS : {}, chain, output: ordered.at(-1).id },
    steps: ordered.map((step) => {
      const extract = extractOf(step);
      const inputs = Object.fromEntries(step.bindings.map((binding) => [binding.input, binding.slot.field]));
      return { id: step.id, op: step.op, request: step.entry.id, ...(extract ? { extract } : {}), ...(step.bindings.length ? { inputs } : {}) };
    }),
    bindings: ordered.flatMap((step) => step.bindings.map((binding) => `${step.op} --${binding.input} ← ${describeBinding(binding)} (into ${binding.slot.field})`)),
  };
}

module.exports = { proposeChain };
