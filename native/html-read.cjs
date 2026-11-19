// Reads HTML in Node: htmlparser2's document, a matcher for the selectors ops use, and the field
// reader. Lifted from the feat branch's parse-infer.cjs, where `surf hook`'s inference uses them too.

// htmlparser2 is an ES module, which require() loads from Node 20.19 and 22.12; loaded on first use,
// so every other command still runs on an older Node.
let parser;
function htmlparser2() {
  if (parser) return parser;
  try {
    parser = require("htmlparser2");
  } catch (error) {
    throw new Error(`reading HTML needs Node 20.19 or 22.12 or later (this is Node ${process.version}): ${error.message}`);
  }
  return parser;
}
const parseDocument = (html) => htmlparser2().parseDocument(html);
// A script's text as written (textOf folds whitespace).
const rawText = (el) => htmlparser2().DomUtils.textContent(el);

const SUPPORTED = 'tag, #id, .class, [attr], [attr="v"], :nth-child(n), descendant and >';
const COMPOUND = /^([a-z][a-z0-9-]*)?((?:#[\w-]+|\.[\w-]+|\[[\w-]+(?:="[^"]*")?\]|:nth-child\(\d+\))*)/i;
const TOKEN = /#[\w-]+|\.[\w-]+|\[[\w-]+(?:="[^"]*")?\]|:nth-child\(\d+\)/g;
// A field: `selector`, `selector@attr`, either with `[]` for every match; `:scope` is the record.
const FIELD = /^(.*?)(?:@([a-zA-Z_:][-a-zA-Z0-9_:.]*))?$/;

const textOf = (el) => rawText(el).replace(/\s+/g, " ").trim();
const elementChildren = (el) => (el?.children || []).filter((child) => child.type === "tag");
const classesOf = (el) => (el.attribs?.class || "").split(/\s+/).filter(Boolean);

function parseSelector(text) {
  const parts = [];
  let rest = text.trim();
  while (rest) {
    let combinator = null;
    const gap = rest.match(/^\s*(>)?\s*/);
    if (parts.length > 0) {
      if (!gap[0]) throw new Error(`unsupported selector: ${text} (supported: ${SUPPORTED})`);
      combinator = gap[1] ? ">" : " ";
      rest = rest.slice(gap[0].length);
    }
    const match = rest.match(COMPOUND);
    if (!match[0]) throw new Error(`unsupported selector: ${text} (supported: ${SUPPORTED})`);
    const compound = { tag: match[1]?.toLowerCase(), classes: [], attrs: [] };
    for (const [token] of match[2].matchAll(TOKEN)) {
      if (token[0] === "#") compound.attrs.push(["id", token.slice(1)]);
      else if (token[0] === ".") compound.classes.push(token.slice(1));
      else if (token[0] === "[") {
        const [, name, value] = token.match(/^\[([\w-]+)(?:=(.*))?\]$/);
        compound.attrs.push(value === undefined ? [name] : [name, JSON.parse(value)]);
      }
      else compound.nth = Number(token.match(/\d+/)[0]);
    }
    parts.push({ combinator, compound });
    rest = rest.slice(match[0].length);
  }
  if (parts.length === 0) throw new Error(`unsupported selector: ${text} (supported: ${SUPPORTED})`);
  return parts;
}

function matchesCompound(el, { tag, classes, attrs, nth }) {
  if (tag && el.name !== tag) return false;
  const own = classesOf(el);
  if (!classes.every((name) => own.includes(name))) return false;
  if (!attrs.every(([name, value]) => (value === undefined ? el.attribs[name] !== undefined : el.attribs[name] === value))) return false;
  return nth === undefined || elementChildren(el.parent).indexOf(el) + 1 === nth;
}

function matchesAt(el, parts, index) {
  if (!matchesCompound(el, parts[index].compound)) return false;
  if (index === 0) return true;
  if (parts[index].combinator === ">") return el.parent?.type === "tag" && matchesAt(el.parent, parts, index - 1);
  for (let above = el.parent; above?.type === "tag"; above = above.parent) if (matchesAt(above, parts, index - 1)) return true;
  return false;
}

/** The elements under `root` (a document or an element) that `selector` matches, in order. */
function selectAll(root, selector) {
  const parts = parseSelector(selector);
  return htmlparser2().DomUtils.findAll((el) => matchesAt(el, parts, parts.length - 1), root.children || []);
}

/** A field spec, checked: { selector, attr?, all, match? }. */
function parseField(spec) {
  const { selector: raw, match } = typeof spec === "string" ? { selector: spec } : spec;
  const all = raw.endsWith("[]");
  const [, selector, attr] = (all ? raw.slice(0, -2) : raw).match(FIELD);
  if (selector !== ":scope") parseSelector(selector);
  return { selector, attr, all, ...(match === undefined ? {} : { match: new RegExp(match) }) };
}

/** A field's value in `item`: text, or an attribute (`href` and `src` absolute against `baseUrl`). */
function readField(item, spec, baseUrl) {
  const { selector, attr, all, match } = parseField(spec);
  const elements = selector === ":scope" ? [item] : selectAll(item, selector);
  const read = (el) => {
    let value = attr ? el.attribs[attr] : textOf(el);
    if (value !== undefined && (attr === "href" || attr === "src")) {
      try { value = new URL(value, baseUrl).href; } catch {}
    }
    if (value === undefined || !match) return value;
    const found = value.match(match);
    return found ? (found[1] ?? found[0]) : undefined;
  };
  const values = (all ? elements : elements.slice(0, 1)).map(read).filter((value) => value !== undefined);
  return all ? (values.length ? values : undefined) : values[0];
}

function recordOf(item, fields, baseUrl) {
  const record = {};
  for (const [name, spec] of Object.entries(fields)) {
    const value = readField(item, spec, baseUrl);
    if (value !== undefined) record[name] = value;
  }
  return record;
}

/** Records from HTML: each `records` match (or the whole document as one), read by `fields`. */
function readHtml(doc, { records, fields } = {}, baseUrl) {
  if (records === undefined) return fields ? recordOf(doc, fields, baseUrl) : textOf(doc);
  const items = selectAll(doc, records);
  return items.map((item) => (fields ? recordOf(item, fields, baseUrl) : textOf(item)));
}

module.exports = { domUtils: () => htmlparser2().DomUtils, parseDocument, parseField, parseSelector, rawText, readField, readHtml, selectAll };
