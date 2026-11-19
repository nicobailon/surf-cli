// Infers an op's extract from a response body. JSON: the largest list of objects and its fields.
// HTML: the repeated item that holds a link (a list), records split across dt/dd siblings, or a
// detail page's meta tags, heading, labelled cells and the text beside the heading. JSON the page
// embeds (`__NEXT_DATA__`, JSON scripts, JSON-LD, `window.X = {…}`) competes as a JSON candidate.
// The list and detail rules are the feat branch's parse-infer.cjs; the embedded candidates come
// from the parked embedded-page-data branch. Every selector written is one html-read.cjs reads.

const { domUtils, parseDocument, rawText, readField, selectAll } = require("./html-read.cjs");
const { readResponse } = require("./op-extract.cjs");

const MIN_ITEMS = 3;
const MAX_CLASS_FIELDS = 6;
const MAX_JSON_FIELDS = 8;
const SKIP_TAGS = new Set(["html", "head", "body", "script", "style", "meta", "link", "br", "img", "svg", "path", "noscript", "template"]);
// A JSON key a path and a field name can both take.
const KEY = /^(?!(?:__proto__|constructor|prototype)$)[A-Za-z_$][A-Za-z0-9_$]*$/;
// A class, id or attribute name a selector can take as written (not `hover:shadow` or `post:0`).
const NAME = /^[A-Za-z_][\w-]*$/;
// JSON-LD a site puts on every page: never the page's own data.
const SITE_TYPES = new Set(["BreadcrumbList", "WebSite", "WebPage", "Organization", "SearchAction", "SiteNavigationElement", "ImageObject"]);
const ASSIGNMENT = /(?:^|[^\w$.])((?:window\.)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*=(?!=)\s*[[{]/g;

const classesOf = (el) => (el.attribs?.class || "").split(/\s+/).filter((name) => NAME.test(name));
const idOf = (el) => (NAME.test(el.attribs?.id || "") ? el.attribs.id : undefined);
const textOf = (el) => rawText(el).replace(/\s+/g, " ").trim();
const ownText = (el) => (el.children || []).filter((child) => child.type === "text").map((child) => child.data).join("").trim();
const elementChildren = (el) => (el.children || []).filter((child) => child.type === "tag");
const isHeading = (el) => /^h[1-6]$/.test(el.name);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const depthOf = (el) => { let depth = 0; for (let node = el.parent; node; node = node.parent) depth++; return depth; };
const ancestors = function* (el, stop) { for (let node = el.parent; node && node !== stop && node.type === "tag"; node = node.parent) yield node; };
const snake = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const findAll = (test, nodes) => domUtils().findAll(test, nodes);

// --- JSON

function largestRecords(value, path = "$", depth = 0) {
  if (!value || typeof value !== "object" || depth > 6) return undefined;
  if (Array.isArray(value)) {
    const objects = value.filter(isObject);
    return objects.length > 0 && objects.length * 2 >= value.length ? { path, items: objects } : undefined;
  }
  let best;
  for (const [key, child] of Object.entries(value)) {
    if (!KEY.test(key)) continue;
    const found = largestRecords(child, path === "$" ? `$.${key}` : `${path}.${key}`, depth + 1);
    if (found && (!best || found.items.length > best.items.length)) best = found;
  }
  return best;
}

const FIELD_ORDER = [/(^|_)(title|name|headline)$/i, /(^|_)(url|link|href|permalink)$/i, /(^|_)(id|uuid|slug|key)$/i];
const rank = (name) => { const at = FIELD_ORDER.findIndex((pattern) => pattern.test(name)); return at < 0 ? FIELD_ORDER.length : at; };
const scalar = (value) => value !== null && typeof value !== "object";

// The records' scalar fields, lists of scalars, and the scalars of an object one level down
// (`author.name` as author_name); names first, then links, then ids.
function jsonFields(items) {
  const found = [];
  const add = (name, path) => { if (!found.some(([taken]) => taken === name)) found.push([name, path]); };
  for (const item of items.slice(0, 5)) {
    for (const [key, value] of Object.entries(item)) {
      if (!KEY.test(key)) continue;
      if (scalar(value) || (Array.isArray(value) && value.length > 0 && value.every(scalar))) add(key, key);
      else if (isObject(value)) for (const [sub, inner] of Object.entries(value)) if (KEY.test(sub) && scalar(inner)) add(`${key}_${sub}`, `${key}.${sub}`);
    }
  }
  const ordered = found.map((field, index) => [field, index]).sort((a, b) => rank(a[0][0]) - rank(b[0][0]) || a[1] - b[1]).map(([field]) => field);
  return Object.fromEntries(ordered.slice(0, MAX_JSON_FIELDS));
}

/** { extract, count }: the largest list's records (count) or one object's fields (count null). */
function inferJson(value) {
  const found = largestRecords(value);
  if (found) {
    const fields = jsonFields(found.items);
    return { extract: { records: found.path, ...(Object.keys(fields).length ? { fields } : {}) }, count: found.items.length };
  }
  const fields = isObject(value) ? jsonFields([value]) : {};
  return Object.keys(fields).length ? { extract: { fields }, count: null } : undefined;
}

// --- HTML lists

const holdsKey = (el) => (el.name === "a" && el.attribs.href) || idOf(el) || Object.keys(el.attribs).some((name) => /^data-.*id$/.test(name)) || selectAll(el, "a[href]").length > 0;
const richness = (el) => Math.min(12, findAll((node) => ownText(node) !== "", [el]).length);

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
  for (const el of findAll((node) => !SKIP_TAGS.has(node.name), doc.children)) {
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

// Records split across siblings (dt then dd): { heads, bodies, body } (the body's tag), or nothing.
function siblingPairs(els) {
  const bodies = els.map(outermost);
  const heads = bodies.map(previousElement);
  if (heads.some((head, index) => !head || head.name === bodies[index].name || head.name !== heads[0].name)) return undefined;
  if (bodies.some((body) => body.name !== bodies[0].name)) return undefined;
  return { heads, bodies, body: bodies[0].name };
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
 * field reads in most records; `prefix` goes before each selector (siblings: "+ dd ").
 */
function itemFields(items, { check, prefix = "" }) {
  const [first] = items;
  const fields = {};
  const used = [];
  const add = (name, el, selector, attr) => {
    const written = `${prefix}${selector}${attr ? `@${attr}` : ""}`;
    // A class list keeps its other class, the one that varies (star-rating Three → Three).
    const kept = attr === "class" && selector.split(".").pop();
    const spec = kept ? { selector: written, match: `(?:^|\\s)(?!${kept}(?:\\s|$))(\\S+)` } : written;
    if (fields[name] || !check(spec)) return false;
    fields[name] = spec;
    if (el) used.push(el);
    return true;
  };
  const relative = (el, classed) => relativeSelector(el, first, (selector) => items.every((item) => selectAll(item, selector).length > 0), classed);
  const heading = domUtils().findOne(isHeading, first.children);
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
  for (const el of findAll((node) => classesOf(node).length > 0, first.children)) {
    if (added >= MAX_CLASS_FIELDS) break;
    if (covered(el) || SKIP_TAGS.has(el.name)) continue;
    const text = textOf(el);
    if (text.length > 120 || findAll((node) => classesOf(node).length > 0 && textOf(node) !== "", el.children).length >= 3) continue;
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

function listExtract(doc, group, baseUrl) {
  const mostRead = (els) => (spec) => els.filter((el) => readField(el, spec, baseUrl) !== undefined).length * 5 >= els.length * 4;
  const pairs = siblingPairs(group.els);
  if (pairs) {
    // One record per head (dt); the body's (dd) fields read through `+ dd`.
    const records = groupSelector(doc, pairs.heads, keyOf(pairs.heads[0]));
    if (!records) return undefined;
    const head = itemFields(pairs.heads, { check: mostRead(pairs.heads) });
    const body = itemFields(pairs.bodies, { check: mostRead(pairs.heads), prefix: `+ ${pairs.body} ` });
    // The body's text names the record (its title over the head's link text); the head's link is its url and id.
    const fields = { ...head, ...body, ...Object.fromEntries(Object.entries(head).filter(([name]) => name === "url" || name === "id")) };
    return Object.keys(fields).length ? { extract: { records, fields }, count: pairs.heads.length } : undefined;
  }
  const records = groupSelector(doc, group.els, group.key);
  if (!records) return undefined;
  const fields = itemFields(group.els, { check: mostRead(group.els) });
  return Object.keys(fields).length ? { extract: { records, fields }, count: group.els.length } : undefined;
}

// --- HTML detail

// Breadcrumbs, site headers and navigation: never the page's own heading.
const CHROME = /(^|[-_\s])(header|breadcrumbs?|nav|navbar|masthead|banner)([-_\s]|$)/i;
const inChrome = (el) => [el, ...ancestors(el)].some((node) => ["header", "nav"].includes(node.name) || CHROME.test(node.attribs.id || "") || CHROME.test(node.attribs.class || ""));

// The page's own heading: an h1 (one whose class says title first), else an h2, outside the site's
// header, breadcrumbs and navigation and not a run of links; with no h1 outside a header, an
// unlinked h1 inside one. With a selector whose first match it is.
function mainHeading(doc) {
  for (const tag of ["h1", "h2"]) {
    const outside = selectAll(doc, tag).filter((el) => textOf(el) && !inChrome(el) && selectAll(el, "a[href]").length < 2);
    const headings = outside.length || tag !== "h1" ? outside : selectAll(doc, tag).filter((el) => textOf(el) && selectAll(el, "a[href]").length === 0);
    const named = headings.find((el) => classesOf(el).some((name) => /title/i.test(name)));
    for (const el of named ? [named, ...headings] : headings) {
      const ancestorId = [...ancestors(el)].map(idOf).find(Boolean);
      const options = [tag, ...classesOf(el).map((name) => `${tag}.${name}`), ...(ancestorId ? [`#${ancestorId} ${tag}`] : [])];
      const selector = options.find((option) => selectAll(doc, option)[0] === el);
      if (selector) return { el, selector };
    }
  }
  return undefined;
}

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
    let added = 0;
    for (const el of parentClass ? findAll((node) => classesOf(node).length > 0 && node !== heading, heading.parent.children) : []) {
      const text = textOf(el);
      if (added >= 4 || !text || text.length > 120) continue;
      if (findAll((node) => classesOf(node).length > 0 && textOf(node) !== "", el.children).length >= 3) continue;
      const own = rarest(el).find((name) => first(`.${parentClass} .${name}`) === el);
      const name = own && snake(own);
      if (name && !fields[name]) {
        fields[name] = `.${parentClass} .${own}`;
        added++;
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

// --- Embedded JSON

// Each `in` a page's embedded JSON can be read from.
function embeddedSources(doc) {
  const sources = new Set();
  for (const script of selectAll(doc, "script")) {
    const type = (script.attribs.type || "").trim().toLowerCase();
    if (type === "application/ld+json") {
      let value;
      try { value = JSON.parse(rawText(script)); } catch { continue; }
      for (const node of [value, ...(Array.isArray(value) ? value : []), ...(Array.isArray(value?.["@graph"]) ? value["@graph"] : [])]) {
        const ldType = Array.isArray(node?.["@type"]) ? node["@type"][0] : node?.["@type"];
        if (typeof ldType === "string" && /^[A-Za-z][\w-]*$/.test(ldType) && !SITE_TYPES.has(ldType)) sources.add(`ld+json:${ldType}`);
      }
    } else if (/json/.test(type)) {
      if (idOf(script)) sources.add(`script#${idOf(script)}`);
    } else if (script.attribs.src === undefined) {
      for (const match of rawText(script).matchAll(ASSIGNMENT)) sources.add(`js:${match[1].replace(/^window\./, "")}`);
    }
  }
  return [...sources];
}

// The embedded candidate with the most records (one object counts as one).
function inferEmbedded(doc, body) {
  let best;
  for (const source of embeddedSources(doc)) {
    let found;
    try { found = inferJson(readResponse({ body }, { in: source })); } catch { continue; }
    if (found && (!best || (found.count ?? 1) > (best.count ?? 1))) best = { extract: { in: source, ...found.extract }, count: found.count };
  }
  return best;
}

/**
 * The extract for a response ({ body, contentType, url }): { extract, count }, count null for one
 * record; undefined when it holds none. `detail` when the URL names one item.
 */
function inferResponse(response, { detail = false } = {}) {
  const body = response.body;
  if (/json/i.test(response.contentType || "") || /^\s*[[{]/.test(body)) {
    try { return inferJson(JSON.parse(body)); } catch {}
  }
  const doc = parseDocument(body);
  const group = detail ? undefined : bestGroup(doc);
  let html = group && listExtract(doc, group, response.url);
  if (!html) {
    const fields = detailFields(doc);
    if (Object.keys(fields).length) html = { extract: { fields }, count: null };
  }
  const embedded = inferEmbedded(doc, body);
  if (!embedded || (html && (detail || (embedded.count ?? 1) < Math.max(MIN_ITEMS, html.count ?? 1)))) return html;
  return embedded;
}

/**
 * The two fields an op's `expect` checks: a title or text, then an id or url, by their own name
 * first (`text` before `author_name`), never a nested object's; else the first fields.
 */
function keyFields({ extract }) {
  const fields = Object.keys(extract.fields || {});
  // `author_name` read from `author.name` names the author, not the record.
  const nested = (name) => typeof extract.fields[name] === "string" && extract.fields[name].replace(/\./g, "_") === name && name.includes("_");
  const find = (words) => fields.find((name) => new RegExp(`^(${words})$`).test(name)) || fields.find((name) => new RegExp(`_(${words})$`).test(name) && !nested(name));
  const keys = [find("title|name|headline|heading|text"), find("id|url|link|href")].filter(Boolean);
  for (const name of fields) if (keys.length < 2 && !keys.includes(name)) keys.push(name);
  return [...new Set(keys)];
}

module.exports = { inferResponse, keyFields };
