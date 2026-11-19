// An op's one extract shape, { in?, records?, fields? }, read in Node from a response's text: JSON by
// path, HTML by selector, and JSON a page embeds (`in`) by path. Embedded sources come from the
// parked embedded-page-data branch: a script selector, `ld+json:<Type>`, or `js:<name>`.

const { parseDocument, parseField, parseSelector, rawText, readField, readHtml, selectAll } = require("./html-read.cjs");
const { getPath, readJson } = require("./records.cjs");

const IN_LD = /^ld\+json:[A-Za-z][\w-]*$/;
const IN_JS = /^js:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function validateExtract(extract, where = "extract") {
  if (extract === undefined) return;
  if (!isObject(extract)) throw new Error(`${where} must be an object`);
  for (const key of Object.keys(extract)) {
    if (!["in", "records", "fields"].includes(key)) throw new Error(`${where} has unknown key "${key}" (allowed: in, records, fields)`);
  }
  const source = extract.in;
  if (source !== undefined) {
    const named = typeof source === "string" && /^(ld\+json|js):/.test(source);
    if (typeof source !== "string" || (named && !IN_LD.test(source) && !IN_JS.test(source))) {
      throw new Error(`${where}.in must be a script selector, ld+json:<Type> or js:<name> (got ${JSON.stringify(source)})`);
    }
    if (!named) parseSelector(source);
  }
  if (extract.records !== undefined && (typeof extract.records !== "string" || !extract.records)) throw new Error(`${where}.records must be a path or a selector`);
  if (extract.fields === undefined) return;
  if (!isObject(extract.fields) || Object.keys(extract.fields).length === 0) throw new Error(`${where}.fields must map at least one field`);
  for (const [name, spec] of Object.entries(extract.fields)) {
    if (typeof spec === "string") continue;
    if (!isObject(spec)) throw new Error(`${where}.fields.${name} must be a string or an object`);
    try {
      if (spec.match !== undefined) new RegExp(spec.match);
    } catch (error) {
      throw new Error(`${where}.fields.${name}.match is not a valid regex: ${error.message}`);
    }
    if (typeof spec.selector === "string") parseField(spec);
  }
}

/** JSON or HTML: the content type says, else the body's first character. */
function kindOf({ body, contentType = "" }) {
  if (/json/i.test(contentType)) return "json";
  if (/html|xml/i.test(contentType)) return "html";
  return /^\s*[[{]/.test(body) ? "json" : "html";
}

const parseJson = (text) => {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return undefined;
  }
};

// Each literal after `name =` (or `window.name =`): from its { or [ to the bracket that closes it,
// skipping brackets in double-quoted strings.
function* literals(text, name) {
  const bare = name.replace(/^window\./, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const match of text.matchAll(new RegExp(`(?:^|[^\\w$.])(?:window\\.)?${bare}\\s*=(?!=)\\s*(?=[[{])`, "g"))) {
    const start = match.index + match[0].length;
    let depth = 0;
    let quoted = false;
    for (let at = start; at < text.length; at++) {
      const char = text[at];
      if (quoted) {
        if (char === "\\") at++;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === "{" || char === "[") depth++;
      else if ((char === "}" || char === "]") && --depth === 0) {
        yield text.slice(start, at + 1);
        break;
      }
    }
  }
}

// A JSON-LD document's nodes: itself, each item of a list and each node of an @graph.
function ldNodes(value, found = []) {
  if (Array.isArray(value)) for (const item of value) ldNodes(item, found);
  else if (isObject(value)) {
    found.push(value);
    if (Array.isArray(value["@graph"])) ldNodes(value["@graph"], found);
  }
  return found;
}

/** The JSON a page embeds where `source` says. The JSON is parsed, never run. */
function embedded(doc, source) {
  const scripts = (selector) => selectAll(doc, selector).map((el) => ({ el, text: rawText(el) }));
  if (source.startsWith("js:")) {
    const name = source.slice(3);
    for (const { el, text } of scripts("script")) {
      if (el.attribs.src !== undefined) continue;
      for (const literal of literals(text, name)) {
        const parsed = parseJson(literal);
        if (parsed) return parsed.value;
      }
    }
    throw new Error(`no inline script assigns ${name} a JSON object or array`);
  }
  if (source.startsWith("ld+json:")) {
    const type = source.slice("ld+json:".length);
    for (const { text } of scripts('script[type="application/ld+json"]')) {
      const node = ldNodes(parseJson(text)?.value).find((item) => item["@type"] === type || (Array.isArray(item["@type"]) && item["@type"].includes(type)));
      if (node) return node;
    }
    throw new Error(`no JSON-LD ${type} in the page`);
  }
  const [first] = scripts(source);
  if (!first) throw new Error(`no script matches ${source}`);
  const parsed = parseJson(first.text);
  if (!parsed) throw new Error(`the script ${source} doesn't hold valid JSON`);
  return parsed.value;
}

/** What `extract` reads from a response ({ body, contentType, url }): records, one record, or the value. */
function readResponse(response, extract = {}) {
  if (extract.in !== undefined) return readJson(embedded(parseDocument(response.body), extract.in), extract);
  if (kindOf(response) === "json") return readJson(JSON.parse(response.body), extract);
  return readHtml(parseDocument(response.body), extract, response.url);
}

/** The value `next` (a JSON path or a field selector) names in a response, as text; undefined if none. */
function readNext(response, next) {
  const value = kindOf(response) === "json"
    ? getPath(JSON.parse(response.body), next.replace(/^\$\./, ""))
    : readField(parseDocument(response.body), next, response.url);
  return value === undefined || value === null || value === "" ? undefined : String(value);
}

module.exports = { readNext, readResponse, validateExtract };
