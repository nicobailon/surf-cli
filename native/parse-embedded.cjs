// surf parse: data a page embeds in its own HTML (__NEXT_DATA__, application/json scripts such as
// Shopify's product JSON, JSON-LD, `window.X = {...}` state), as candidates like a JSON response:
// an array of records or a detail object, scored against the goal. The extract they make is
// `extract.embedded` (embedded-json.cjs) with the JSON extract's records and fields.

const { DomUtils, parseDocument } = require("htmlparser2");
const { readEmbedded } = require("./embedded-json.cjs");
const { KEY, MIN_ITEMS, RECORDS_LIMIT, inferHtml, inferJson, selectAll } = require("./parse-infer.cjs");
const { goalTerms } = require("./parse-inputs.cjs");

// JSON-LD a site puts on every page: never the page's own data.
const SITE_TYPES = new Set(["BreadcrumbList", "WebSite", "WebPage", "Organization", "SearchAction", "SiteNavigationElement", "WPHeader", "WPFooter", "ImageObject"]);
const LD_SELECTOR = 'script[type="application/ld+json"]';
const JSON_TYPE = /^application\/(?:[\w.-]+\+)?json$/;
const ASSIGNMENT = /(?:^|[^\w$.])((?:window\.)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*=(?!=)\s*[[{]/g;
// A goal's word also finds these keys (availability → inventory_quantity).
const SYNONYMS = { available: ["stock", "quantity"], stock: ["available", "quantity"] };

const stem = (word) => {
  const lower = word.toLowerCase().replace(/\d+$/, "").replace(/our$/, "or").replace(/ability$/, "able");
  if (lower.length > 4 && lower.endsWith("ies")) return `${lower.slice(0, -3)}y`;
  return lower.length > 3 && lower.endsWith("s") && !lower.endsWith("ss") ? lower.slice(0, -1) : lower;
};
const tokens = (text) => String(text).replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).map(stem).filter((word) => word.length >= 3);
const alike = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));
const snake = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const isRecord = (item) => item && typeof item === "object" && !Array.isArray(item);

// Each JSON the page embeds that a replay finds again: { embedded, value, label }.
function embeddedSources(doc) {
  const scripts = selectAll(doc, "script");
  const textOf = (script) => DomUtils.textContent(script);
  const inline = scripts.filter((script) => script.attribs.src === undefined).map(textOf);
  const ldTexts = selectAll(doc, LD_SELECTOR).map(textOf);
  const sources = [];
  const types = new Set();
  for (const script of scripts) {
    const type = (script.attribs.type || "").trim().toLowerCase();
    if (!JSON_TYPE.test(type)) {
      if (script.attribs.src !== undefined) continue;
      for (const match of textOf(script).matchAll(ASSIGNMENT)) {
        const assign = match[1];
        if (sources.some((source) => source.embedded.assign?.replace(/^window\./, "") === assign.replace(/^window\./, ""))) continue;
        try { sources.push({ embedded: { assign }, value: readEmbedded(inline, { assign }), label: assign }); } catch {}
      }
    } else if (type === "application/ld+json") {
      let value;
      try { value = JSON.parse(textOf(script)); } catch { continue; }
      for (const node of [value, ...(Array.isArray(value) ? value : []), ...(Array.isArray(value?.["@graph"]) ? value["@graph"] : [])]) {
        const ldType = Array.isArray(node?.["@type"]) ? node["@type"][0] : node?.["@type"];
        if (typeof ldType !== "string" || SITE_TYPES.has(ldType) || types.has(ldType) || !/^[A-Za-z][\w-]*$/.test(ldType)) continue;
        types.add(ldType);
        const embedded = { selector: LD_SELECTOR, type: ldType };
        sources.push({ embedded, value: readEmbedded(ldTexts, embedded), label: ldType });
      }
    } else {
      // A selector whose first match is this script, so a replay reads the same one.
      const id = script.attribs.id;
      const options = [...(id && /^[A-Za-z_][\w-]*$/.test(id) ? [`script#${id}`] : []), ...Object.keys(script.attribs).filter((name) => /^data-[\w-]+$/.test(name)).map((name) => `script[${name}]`), `script[type="${type}"]`];
      const selector = options.find((option) => selectAll(doc, option)[0] === script);
      if (!selector) continue;
      try { sources.push({ embedded: { selector }, value: readEmbedded([textOf(script)], { selector }), label: selector }); } catch {}
    }
  }
  return sources;
}

// Every array of records in a JSON value: { path, items, parent }.
function recordArrays(value, path = "$", depth = 0, parent = undefined, found = []) {
  if (!value || typeof value !== "object" || depth > 6) return found;
  if (Array.isArray(value)) {
    const items = value.filter(isRecord);
    if (items.length > 0 && items.length * 2 >= value.length) found.push({ path, items, parent });
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    if (KEY.test(key)) recordArrays(child, path === "$" ? `$.${key}` : `${path}.${key}`, depth + 1, value, found);
  }
  return found;
}

// Shopify's variants name their options option1..3 after the product's `options`.
function optionNames(at) {
  if (!at || !/(?:^\$|\.)variants$/.test(at.path) || !Array.isArray(at.parent?.options)) return {};
  return Object.fromEntries(at.parent.options.slice(0, 3).map((option, index) => [`option${index + 1}`, snake(typeof option === "string" ? option : option?.name || "")]).filter(([, name]) => name));
}

// What a candidate says, for matching the goal: where it is, its keys and its short text.
function wordsOf(source, at, names) {
  const words = [...tokens(source.label), ...(at ? tokens(at.path) : [])];
  for (const item of at ? at.items.slice(0, 3) : [source.value]) {
    for (const [key, field] of Object.entries(item || {})) {
      words.push(...tokens(names[key] || key));
      if (typeof field === "string" && field.length <= 60) words.push(...tokens(field));
    }
  }
  return words;
}

/** The best embedded candidate for the goal, as parse's other extracts, with its `hits`; or nothing. */
function inferEmbedded(html, { goal = "", limit = RECORDS_LIMIT } = {}) {
  const terms = goalTerms(goal).map(stem).map((term) => [term, ...(SYNONYMS[term] || [])]);
  const hitsIn = (words) => terms.filter((spellings) => spellings.some((term) => words.some((word) => alike(word, term)))).length;
  let best;
  for (const source of embeddedSources(parseDocument(html))) {
    let choices;
    if (source.embedded.type) {
      // A JSON-LD node is one record (a Product with its offers) unless it lists them (ItemList).
      const list = Array.isArray(source.value.itemListElement) && source.value.itemListElement.filter(isRecord).length >= 2;
      choices = [list ? { path: "$.itemListElement", items: source.value.itemListElement.filter(isRecord), parent: source.value } : null];
    } else {
      choices = recordArrays(source.value);
      if (choices.length === 0) choices = [null];
    }
    for (const at of choices) {
      const names = optionNames(at);
      const hits = hitsIn(wordsOf(source, at, names));
      const count = at ? at.items.length : null;
      if (hits === 0 && (count ?? 0) < MIN_ITEMS) continue;
      if (best && (hits < best.hits || (hits === best.hits && (count ?? 1) <= (best.count ?? 1)))) continue;
      best = { source, at, names, hits, count };
    }
  }
  if (!best) return undefined;
  const prefer = (name) => terms.length > 0 && hitsIn(tokens(name)) > 0;
  const found = inferJson(best.source.value, { limit, at: best.at, prefer, names: best.names });
  if (!found) return undefined;
  return { ...found, mode: "embedded", extract: { embedded: best.source.embedded, ...found.extract }, hits: best.hits };
}

/**
 * An extract for an HTML page: its embedded data when the goal names it, or when it holds at least
 * as many records as the page's HTML shows; else what inferHtml finds.
 */
function inferPage(html, { baseUrl, detail = false, goal = "", limit = RECORDS_LIMIT } = {}) {
  const embedded = inferEmbedded(html, { goal, limit });
  if (embedded?.hits > 0) return embedded;
  const fromHtml = inferHtml(html, { baseUrl, detail, limit });
  if (!embedded) return fromHtml;
  return !fromHtml || (embedded.records ?? 1) >= (fromHtml.records ?? 1) ? embedded : fromHtml;
}

/** The most records any of the page's embedded JSON holds (site JSON-LD aside), for ranking it. */
function embeddedRecordCount(html) {
  let most = 0;
  for (const source of embeddedSources(parseDocument(html))) {
    for (const at of recordArrays(source.value)) most = Math.max(most, at.items.length);
  }
  return most;
}

module.exports = { embeddedRecordCount, inferEmbedded, inferPage };
