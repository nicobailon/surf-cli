// surf parse: an extract for a response body. JSON: the largest array of records and its scalar
// fields. HTML: the repeated item that holds a link or id (a list), records split across dt/dd
// siblings, or a detail page's meta tags, heading, labelled cells and the text beside the heading.
// The body is the one the op's network strategy parses, read here with htmlparser2 and a small
// selector matcher for the selectors this file writes: tag, #id, .class, [attr], [attr="v"],
// :nth-child(n), and the descendant and > combinators.

const { DomUtils, parseDocument } = require("htmlparser2");

// What the tab sends back stops at 50,000 characters, measured as { ...head, extracted } pretty-printed;
// the records, measured inside { extracted }, stay under this, leaving the rest for the head.
const RECORDS_LIMIT = 45000;
const MIN_ITEMS = 3;
const MAX_CLASS_FIELDS = 6;
const SKIP_TAGS = new Set(["html", "head", "body", "script", "style", "meta", "link", "br", "img", "svg", "path", "noscript", "template"]);
// A JSON key a path and a field name can both take.
const KEY = /^(?!(?:__proto__|constructor|prototype)$)[A-Za-z_$][A-Za-z0-9_$]*$/;

// A class, id or attribute name a selector can take as written (not `hover:shadow` or `post:0`).
const NAME = /^[A-Za-z_][\w-]*$/;
const classesOf = (el) => (el.attribs?.class || "").split(/\s+/).filter((name) => NAME.test(name));
const idOf = (el) => (NAME.test(el.attribs?.id || "") ? el.attribs.id : undefined);
const textOf = (el) => DomUtils.textContent(el).replace(/\s+/g, " ").trim();
const ownText = (el) => (el.children || []).filter((child) => child.type === "text").map((child) => child.data).join("").trim();
const elementChildren = (el) => (el.children || []).filter((child) => child.type === "tag");
const isHeading = (el) => /^h[1-6]$/.test(el.name);
const depthOf = (el) => { let depth = 0; for (let node = el.parent; node; node = node.parent) depth++; return depth; };
const ancestors = function* (el, stop) { for (let node = el.parent; node && node !== stop && node.type === "tag"; node = node.parent) yield node; };
const snake = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

function parseSelector(text) {
  const parts = [];
  let combinator = null;
  let rest = text.trim();
  while (rest) {
    const gap = rest.match(/^\s*(>)?\s*/);
    if (parts.length > 0 && gap[0]) {
      combinator = gap[1] ? ">" : " ";
      rest = rest.slice(gap[0].length);
    }
    const match = rest.match(/^([a-z][a-z0-9-]*)?((?:#[\w-]+|\.[\w-]+|\[[\w-]+(?:="[^"]*")?\]|:nth-child\(\d+\))*)/i);
    if (!match[0]) throw new Error(`unsupported selector: ${text}`);
    const compound = { tag: match[1]?.toLowerCase(), classes: [], attrs: [] };
    for (const [token] of match[2].matchAll(/#[\w-]+|\.[\w-]+|\[[\w-]+(?:="[^"]*")?\]|:nth-child\(\d+\)/g)) {
      if (token[0] === "#") compound.attrs.push(["id", token.slice(1)]);
      else if (token[0] === ".") compound.classes.push(token.slice(1));
      else if (token[0] === "[") compound.attrs.push(token.slice(1, -1).split("=").map((part, index) => (index ? JSON.parse(part) : part)));
      else compound.nth = Number(token.match(/\d+/)[0]);
    }
    parts.push({ combinator, compound });
    rest = rest.slice(match[0].length);
  }
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
  for (const above of ancestors(el)) if (matchesAt(above, parts, index - 1)) return true;
  return false;
}

/** The elements under `root` (a document or an element) that `selector` matches, in order. */
function selectAll(root, selector) {
  const parts = parseSelector(selector);
  return DomUtils.findAll((el) => matchesAt(el, parts, parts.length - 1), root.children || []);
}

// A field's raw values in one item, as the tab's extract reads them (href resolved).
function readField(item, spec, baseUrl) {
  const all = spec.endsWith("[]");
  const text = all ? spec.slice(0, -2) : spec;
  const [, selector, attr] = text.match(/^(.*?)(?:@([a-zA-Z_:][-a-zA-Z0-9_:.]*))?$/);
  const elements = selector === ":scope" ? [item] : selectAll(item, selector);
  const read = (el) => {
    if (!attr) return textOf(el);
    const value = el.attribs[attr];
    if (value === undefined || !["href", "src"].includes(attr)) return value;
    try { return new URL(value, baseUrl).href; } catch { return value; }
  };
  const values = (all ? elements : elements.slice(0, 1)).map(read).filter((value) => value !== undefined);
  return all ? (values.length ? values : undefined) : values[0];
}

const measure = (records) => JSON.stringify({ extracted: records }, null, 2).length;
const recordOf = (item, fields, baseUrl) => Object.fromEntries(Object.entries(fields).map(([name, spec]) => [name, readField(item, spec, baseUrl)]).filter(([, value]) => value !== undefined && value !== ""));

// Drops the longest field, then the next, until the records fit; title and id go last.
function fitRecords(fields, recordsFor, limit) {
  const dropped = [];
  let records = recordsFor(fields);
  let chars = measure(records);
  while (chars > limit && Object.keys(fields).length > 1) {
    const names = Object.keys(fields);
    const droppable = names.filter((name) => !["title", "id"].includes(name));
    const size = (name) => records.reduce((sum, record) => sum + JSON.stringify(record[name] ?? "").length, 0);
    const longest = (droppable.length ? droppable : names).reduce((best, name) => (size(name) > size(best) ? name : best));
    const { [longest]: _gone, ...kept } = fields;
    fields = kept;
    dropped.push(longest);
    records = recordsFor(fields);
    chars = measure(records);
  }
  return { fields, records, chars, dropped };
}

// --- JSON

function largestRecords(value, path = "$", depth = 0) {
  if (!value || typeof value !== "object" || depth > 6) return undefined;
  let best;
  if (Array.isArray(value)) {
    const objects = value.filter((item) => item && typeof item === "object" && !Array.isArray(item));
    if (objects.length > 0 && objects.length * 2 >= value.length) best = { path, items: objects };
    return best;
  }
  for (const [key, child] of Object.entries(value)) {
    if (!KEY.test(key)) continue;
    const found = largestRecords(child, path === "$" ? `$.${key}` : `${path}.${key}`, depth + 1);
    if (found && (!best || found.items.length > best.items.length)) best = found;
  }
  return best;
}

const FIELD_ORDER = [/^(id|uuid|slug|key)$/i, /^(title|name|headline)$/i, /^(url|link|href|permalink)$/i];
const rank = (key) => { const at = FIELD_ORDER.findIndex((pattern) => pattern.test(key)); return at < 0 ? FIELD_ORDER.length : at; };

function inferJson(value, { limit = RECORDS_LIMIT } = {}) {
  const found = largestRecords(value);
  if (!found) {
    const chars = measure(value);
    return chars <= limit ? { mode: "value", extract: { jsonPath: "$" }, records: null, chars, dropped: [] } : undefined;
  }
  const keys = [];
  for (const item of found.items.slice(0, 5)) {
    for (const [key, field] of Object.entries(item)) {
      if (KEY.test(key) && !keys.includes(key) && field !== null && typeof field !== "object") keys.push(key);
    }
  }
  const ordered = keys.map((key, index) => [key, index]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([key]) => key).slice(0, 8);
  const project = (fields) => found.items.map((item) => Object.fromEntries(Object.entries(fields).map(([name, key]) => [name, item[key]])));
  const fit = ordered.length ? fitRecords(Object.fromEntries(ordered.map((key) => [key, key])), project, limit) : { fields: {}, records: found.items, chars: measure(found.items), dropped: [] };
  const extract = { records: found.path, ...(Object.keys(fit.fields).length ? { fields: fit.fields } : {}) };
  return { mode: "records", extract, records: found.items.length, chars: fit.chars, dropped: fit.dropped, sample: fit.records[0] };
}

// --- HTML lists

const holdsKey = (el) => (el.name === "a" && el.attribs.href) || idOf(el) || Object.keys(el.attribs).some((name) => /^data-.*id$/.test(name)) || selectAll(el, "a[href]").length > 0;
const richness = (el) => Math.min(12, DomUtils.findAll((node) => ownText(node) !== "", [el]).length);

function keyOf(el) {
  const classes = classesOf(el).sort();
  if (classes.length) return `${el.name}.${classes.join(".")}`;
  const parent = el.parent?.type === "tag" ? el.parent : undefined;
  const above = !parent ? "" : idOf(parent) ? `${parent.name}#${idOf(parent)}` : classesOf(parent).length ? `${parent.name}.${classesOf(parent)[0]}` : parent.name;
  return `${above} > ${el.name}`;
}

// The selector that matches exactly these elements in the document.
function groupSelector(doc, els, key) {
  const [first] = els;
  const options = [...(idOf(first) ? [`${first.name}#${idOf(first)}`] : []), ...classesOf(first).map((name) => `${first.name}.${name}`), ...(classesOf(first).length ? [`${first.name}.${classesOf(first).join(".")}`] : [key])];
  return options.find((selector) => { const found = selectAll(doc, selector); return found.length === els.length && els.every((el) => found.includes(el)); });
}

function bestGroup(doc) {
  const groups = new Map();
  for (const el of DomUtils.findAll((node) => !SKIP_TAGS.has(node.name), doc.children)) {
    if ([...ancestors(el)].some((above) => above.name === "head")) continue;
    const key = keyOf(el);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(el);
  }
  let best;
  for (const [key, els] of groups) {
    if (els.length < MIN_ITEMS || !els.every(holdsKey)) continue;
    const sampled = els.slice(0, 20);
    const score = (els.length * sampled.reduce((sum, el) => sum + richness(el), 0)) / sampled.length;
    if (!best || score > best.score || (score === best.score && depthOf(els[0]) > depthOf(best.els[0]))) best = { key, els, score };
  }
  return best;
}

// The wrapper an item sits in when it adds no text (dd around div.meta).
function outermost(el) {
  let node = el;
  while (node.parent?.type === "tag" && textOf(node.parent) === textOf(el) && elementChildren(node.parent).length === 1) node = node.parent;
  return node;
}

const previousElement = (el) => { const siblings = elementChildren(el.parent); return siblings[siblings.indexOf(el) - 1]; };

// Records split across siblings (dt then dd): { container, head, body } tags, or nothing.
function siblingPairs(els) {
  const bodies = els.map(outermost);
  const heads = bodies.map(previousElement);
  if (heads.some((head, index) => !head || head.name === bodies[index].name || head.name !== heads[0].name)) return undefined;
  if (bodies.some((body) => body.name !== bodies[0].name)) return undefined;
  return { containers: [...new Set(bodies.map((body) => body.parent))], head: heads[0].name, body: bodies[0].name };
}

// A selector under `root` whose first match is `el`, tried in every item (`check`). A class field's
// selector holds a class (`classed`), so its name comes from it.
function relativeSelector(el, root, check, classed = false) {
  const options = classed ? [] : [el.name];
  for (const name of classesOf(el)) options.push(el.name === "a" || isHeading(el) ? `${el.name}.${name}` : `.${name}`);
  const heading = [...ancestors(el, root)].find(isHeading);
  if (heading && !classed) options.push(`${heading.name} ${el.name}`);
  for (const [name, value] of classed ? [] : Object.entries(el.attribs)) {
    if (NAME.test(name) && !["href", "src", "id", "class", "style"].includes(name) && value && value.length < 40 && !/["\\]/.test(value)) options.push(`${el.name}[${name}="${value}"]`);
  }
  return options.find((selector) => selectAll(root, selector)[0] === el && check(selector));
}

// Whether the link's title attribute holds the link's text, cut or whole, in most items: then it
// is the title the page shortens (books.toscrape.com's "A Light in the ...").
function titled(items, inner, selector) {
  if (!selector) return false;
  const holds = items.filter((item) => {
    const link = selectAll(item, selector)[0];
    const title = (link?.attribs.title || "").replace(/\s+/g, " ").trim().toLowerCase();
    const text = link ? textOf(link).replace(/(\.\.\.|…)$/, "").trim().toLowerCase() : "";
    return title !== "" && text !== "" && title.startsWith(text);
  });
  return Boolean(inner.attribs.title) && holds.length * 5 >= items.length * 4;
}

function fieldName(className, itemClasses) {
  let name = className;
  for (const prefix of [...itemClasses, "list", "item"]) if (name.startsWith(`${prefix}-`) || name.startsWith(`${prefix}_`)) name = name.slice(prefix.length + 1);
  return snake(name);
}

/**
 * Fields of the records in `items` (elements of one kind), read from the first: title, url, id,
 * then up to 6 classed descendants with short text that varies. `check(spec)` says whether a
 * field reads in every record; `prefix` goes before each selector (siblings: "dt ").
 */
function itemFields(items, { check, prefix = "", all = "" }) {
  const [first] = items;
  const fields = {};
  const used = [];
  const add = (name, el, selector, attr) => {
    const spec = `${prefix}${selector}${attr ? `@${attr}` : ""}${all}`;
    if (fields[name] || !check(spec)) return false;
    fields[name] = spec;
    if (el) used.push(el);
    return true;
  };
  const relative = (el, classed) => relativeSelector(el, first, (selector) => items.every((item) => selectAll(item, selector).length > 0), classed);
  const heading = DomUtils.findOne(isHeading, first.children);
  const links = [...(first.name === "a" && first.attribs.href ? [first] : []), ...selectAll(first, "a[href]")];
  const link = links.find((a) => (heading && (a === heading.parent || [...ancestors(a, first)].includes(heading) || selectAll(a, heading.name).includes(heading)))) || links.reduce((best, a) => (!best || textOf(a).length > textOf(best).length ? a : best), undefined);
  if (heading) {
    const inner = selectAll(heading, "a[title]")[0];
    const innerSelector = inner && relative(inner);
    const useTitle = Boolean(inner) && titled(items, inner, innerSelector);
    const selector = useTitle ? innerSelector : relative(heading);
    if (selector) add("title", heading, selector, useTitle ? "title" : "");
  }
  if (link) {
    const selector = link === first ? ":scope" : relative(link);
    if (selector) {
      add("url", link, selector, "href");
      if (link.attribs.id) add("id", null, selector, "id");
    }
  }
  const idAttr = Object.keys(first.attribs).find((name) => name === "id" || /^data-.*id$/.test(name));
  if (idAttr && !prefix) add("id", null, ":scope", idAttr);
  // The title and url elements are skipped; a class field's descendants too.
  const taken = [];
  const covered = (el) => used.includes(el) || [...ancestors(el, first)].some((above) => taken.includes(above));
  let added = 0;
  for (const el of DomUtils.findAll((node) => classesOf(node).length > 0, first.children)) {
    if (added >= MAX_CLASS_FIELDS) break;
    if (covered(el) || SKIP_TAGS.has(el.name)) continue;
    const text = textOf(el);
    if (text.length > 120 || DomUtils.findAll((node) => classesOf(node).length > 0 && textOf(node) !== "", el.children).length >= 3) continue;
    const attr = text ? "" : "class";
    if (!text && classesOf(el).length < 2) continue;
    const selector = relative(el, true);
    if (!selector) continue;
    const values = items.map((item) => readField(item, `${selector}${attr ? `@${attr}` : ""}`, ""));
    if (items.length >= MIN_ITEMS && new Set(values.map(String)).size === 1) continue;
    const name = fieldName(selector.split(".").pop(), classesOf(items[0]));
    if (name && add(name, el, selector, attr)) {
      taken.push(el);
      added++;
    }
  }
  // A link's text is the title only when nothing better names it.
  if (!fields.title && link && textOf(link)) {
    const selector = link === first ? ":scope" : relative(link);
    if (selector) add("title", null, selector, "");
  }
  return fields;
}

function listExtract(doc, group, baseUrl, limit) {
  const pairs = siblingPairs(group.els);
  if (pairs) {
    const containerSelector = groupSelector(doc, pairs.containers, keyOf(pairs.containers[0]));
    if (!containerSelector) return undefined;
    const count = (container, tag) => elementChildren(container).filter((el) => el.name === pairs[tag]).length;
    const parallel = (tag) => (spec) => pairs.containers.every((container) => (readField(container, spec, baseUrl) || []).length === count(container, tag));
    const membersOf = (tag) => pairs.containers.flatMap((container) => elementChildren(container).filter((el) => el.name === pairs[tag]));
    const fields = {
      ...itemFields(membersOf("head"), { check: parallel("head"), prefix: `${pairs.head} `, all: "[]" }),
      ...itemFields(membersOf("body"), { check: parallel("body"), prefix: `${pairs.body} `, all: "[]" }),
    };
    if (Object.keys(fields).length === 0) return undefined;
    const fit = fitRecords(fields, (kept) => pairs.containers.map((container) => recordOf(container, kept, baseUrl)), limit);
    return { mode: "siblings", extract: { html: { item: containerSelector, fields: fit.fields } }, records: membersOf("body").length, chars: fit.chars, dropped: fit.dropped, sample: fit.records[0] };
  }
  const item = groupSelector(doc, group.els, group.key);
  if (!item) return undefined;
  const fields = itemFields(group.els, { check: (spec) => group.els.filter((el) => readField(el, spec, baseUrl) !== undefined).length * 5 >= group.els.length * 4 });
  if (Object.keys(fields).length === 0) return undefined;
  const fit = fitRecords(fields, (kept) => group.els.map((el) => recordOf(el, kept, baseUrl)), limit);
  return { mode: "list", extract: { html: { item, fields: fit.fields } }, records: group.els.length, chars: fit.chars, dropped: fit.dropped, sample: fit.records[0] };
}

// --- HTML detail

function detailFields(doc) {
  const fields = {};
  const first = (selector) => selectAll(doc, selector)[0];
  const metas = selectAll(doc, "meta[content]");
  for (const meta of metas) {
    const name = meta.attribs.name || "";
    if (!name.startsWith("citation_") || Object.keys(fields).length >= 8) continue;
    const field = snake(name.slice("citation_".length));
    const many = metas.filter((other) => other.attribs.name === name).length > 1;
    if (field && !fields[field]) fields[field] = `meta[name="${name}"]@content${many ? "[]" : ""}`;
  }
  for (const [field, attr, value] of [["title", "property", "og:title"], ["description", "property", "og:description"], ["description", "name", "description"]]) {
    if (!fields[field] && first(`meta[${attr}="${value}"]`)) fields[field] = `meta[${attr}="${value}"]@content`;
  }
  const main = mainHeading(doc);
  if (main) {
    fields[fields.title ? "heading" : "title"] = main.selector;
    // Short classed text beside the heading (a price, a location), each under the parent's rarest
    // class and its own class that finds it first.
    const { el: heading } = main;
    const rarest = (el) => classesOf(el).sort((a, b) => selectAll(doc, `.${a}`).length - selectAll(doc, `.${b}`).length || b.length - a.length);
    const [parentClass] = rarest(heading.parent);
    if (parentClass) {
      let added = 0;
      for (const el of DomUtils.findAll((node) => classesOf(node).length > 0 && node !== heading, heading.parent.children)) {
        const text = textOf(el);
        if (added >= 4 || !text || text.length > 120) continue;
        if (DomUtils.findAll((node) => classesOf(node).length > 0 && textOf(node) !== "", el.children).length >= 3) continue;
        const own = rarest(el).find((name) => first(`.${parentClass} .${name}`) === el);
        const name = own && snake(own);
        if (name && !fields[name]) {
          fields[name] = `.${parentClass} .${own}`;
          added++;
        }
      }
    }
  }
  // Labelled cells: th then td in one row.
  const table = selectAll(doc, "table").find((candidate) => selectAll(candidate, "tr").some((row) => elementChildren(row)[0]?.name === "th" && elementChildren(row)[1]?.name === "td"));
  if (table) {
    const tableClass = classesOf(table).sort((a, b) => b.length - a.length)[0];
    const tableSelector = idOf(table) ? `table#${idOf(table)}` : tableClass ? `table.${tableClass}` : "table";
    for (const row of selectAll(table, "tr").slice(0, 8)) {
      const [label, cell] = elementChildren(row);
      const name = label?.name === "th" && cell?.name === "td" ? snake(textOf(label)) : "";
      const selector = `${tableSelector} tr:nth-child(${elementChildren(row.parent).indexOf(row) + 1}) td`;
      if (name && !fields[name] && first(selector) === cell) fields[name] = selector;
    }
  }
  return fields;
}

// Breadcrumbs, site headers and navigation: never the page's own heading.
const CHROME = /(^|[-_\s])(header|breadcrumbs?|nav|navbar|masthead|banner)([-_\s]|$)/i;
const inChrome = (el) => [el, ...ancestors(el)].some((node) => ["header", "nav"].includes(node.name) || CHROME.test(node.attribs.id || "") || CHROME.test(node.attribs.class || ""));

// The page's own heading: an h1 (one whose class says title first), else an h2, outside the site's
// header, breadcrumbs and navigation and not a run of links; with a selector whose first match it is.
function mainHeading(doc) {
  for (const tag of ["h1", "h2"]) {
    const headings = selectAll(doc, tag).filter((el) => textOf(el) && !inChrome(el) && selectAll(el, "a[href]").length < 2);
    const titled = headings.find((el) => classesOf(el).some((name) => /title/i.test(name)));
    for (const el of titled ? [titled, ...headings] : headings) {
      const ancestorId = [...ancestors(el)].map(idOf).find(Boolean);
      const options = [tag, ...classesOf(el).map((name) => `${tag}.${name}`), ...(ancestorId ? [`#${ancestorId} ${tag}`] : [])];
      const selector = options.find((option) => selectAll(doc, option)[0] === el);
      if (selector) return { el, selector };
    }
  }
  return undefined;
}

/** An extract for an HTML body; `detail` when the URL names one item. Undefined when none fits. */
function inferHtml(html, { baseUrl, detail = false, limit = RECORDS_LIMIT } = {}) {
  const doc = parseDocument(html);
  if (!detail) {
    const group = bestGroup(doc);
    const found = group && listExtract(doc, group, baseUrl, limit);
    if (found) return found;
  }
  const fields = detailFields(doc);
  if (Object.keys(fields).length === 0) return undefined;
  const root = selectAll(doc, "html")[0] || doc;
  const fit = fitRecords(fields, (kept) => [recordOf(root, kept, baseUrl)], limit);
  return { mode: "detail", extract: { html: { item: "html", fields: fit.fields } }, records: 1, chars: fit.chars, dropped: fit.dropped, sample: fit.records[0] };
}

/** The 1–2 fields a saved test checks are not null: a title or name, then an id or url. */
function keyFields(found) {
  const fields = Object.keys(found.extract.fields || found.extract.html?.fields || {});
  const keys = [["title", "name", "headline", "heading"], ["id", "url", "link"]].map((names) => names.find((name) => fields.includes(name))).filter(Boolean);
  return keys.length ? keys : fields.slice(0, 1);
}

module.exports = { RECORDS_LIMIT, inferHtml, inferJson, keyFields, selectAll };
