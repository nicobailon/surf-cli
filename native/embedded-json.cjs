// Data a page embeds in its own HTML, for an op's `extract.embedded`:
//   { selector }          the JSON in the first script the selector matches (script#__NEXT_DATA__,
//                         script[data-product-json], script[type="application/json"])
//   { selector, type }    the first JSON-LD node of that @type in the matching scripts, top-level,
//                         in a list or in @graph (script[type="application/ld+json"], Product)
//   { assign }            the object or array an inline script assigns to the name
//                         (window.__STATE__ = {...}; var meta = {...};), when it is valid JSON
// The JSON is never run: it is JSON.parse'd. readEmbedded runs in Node (surf parse) and, as
// source, in the tab (surf use), so it uses nothing from outside itself.

const { assertSelector } = require("./dom-collect.cjs");

const ASSIGN_NAME = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
const LD_TYPE = /^[A-Za-z][\w-]*$/;

/** The spec as saved, or a plain error naming what is wrong. */
function parseEmbeddedSpec(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error("embedded must be an object");
  for (const key of Object.keys(spec)) {
    if (!["selector", "assign", "type"].includes(key)) throw new Error(`embedded has unknown key "${key}" (allowed: selector, assign, type)`);
  }
  if ((spec.selector === undefined) === (spec.assign === undefined)) throw new Error("embedded takes a selector or an assign, not both");
  if (spec.selector !== undefined) {
    if (typeof spec.selector !== "string" || !spec.selector.trim()) throw new Error("embedded selector must be a CSS selector for a script");
    assertSelector(spec.selector, "embedded selector");
  }
  if (spec.assign !== undefined && (typeof spec.assign !== "string" || !ASSIGN_NAME.test(spec.assign))) {
    throw new Error(`embedded assign must be a name such as window.__STATE__ or meta (got ${JSON.stringify(spec.assign)})`);
  }
  if (spec.type !== undefined) {
    if (spec.selector === undefined) throw new Error("embedded type picks a JSON-LD node, so it needs a selector");
    if (typeof spec.type !== "string" || !LD_TYPE.test(spec.type)) throw new Error(`embedded type must be a JSON-LD @type such as Product (got ${JSON.stringify(spec.type)})`);
  }
  return spec;
}

/**
 * The JSON `spec` names, read from `texts`: the text of each script the selector matches, or for an
 * assign, of each inline script. Throws when no text holds it.
 */
function readEmbedded(texts, spec) {
  const parse = (text) => {
    try {
      return { value: JSON.parse(text) };
    } catch {
      return undefined;
    }
  };
  // The literal after `name =` (or `window.name =`): from its { or [ to the bracket that closes
  // it, skipping brackets in double-quoted strings. JSON has no other strings.
  const literals = function* (text, name) {
    const bare = name.replace(/^window\./, "").replace(/[.$]/g, "\\$&");
    const pattern = new RegExp(`(?:^|[^\\w$.])(?:window\\.)?${bare}\\s*=(?!=)\\s*(?=[[{])`, "g");
    for (const match of text.matchAll(pattern)) {
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
  };
  // A JSON-LD document's nodes: itself, each item of a list and each node of an @graph.
  const nodes = (value) => {
    const found = [];
    const visit = (node) => {
      if (Array.isArray(node)) node.forEach(visit);
      else if (node && typeof node === "object") {
        found.push(node);
        if (Array.isArray(node["@graph"])) node["@graph"].forEach(visit);
      }
    };
    visit(value);
    return found;
  };
  if (spec.assign) {
    for (const text of texts) {
      for (const literal of literals(text, spec.assign)) {
        const parsed = parse(literal);
        if (parsed) return parsed.value;
      }
    }
    throw new Error(`no inline script assigns ${spec.assign} a JSON object or array`);
  }
  if (texts.length === 0) throw new Error(`no script matches ${spec.selector}`);
  if (!spec.type) {
    const parsed = parse(texts[0]);
    if (!parsed) throw new Error(`the script ${spec.selector} doesn't hold valid JSON`);
    return parsed.value;
  }
  for (const text of texts) {
    for (const node of nodes(parse(text)?.value)) {
      const type = node["@type"];
      if (type === spec.type || (Array.isArray(type) && type.includes(spec.type))) return node;
    }
  }
  throw new Error(`no ${spec.selector} holds a JSON-LD ${spec.type}`);
}

/** Page source of `(doc) => json`: the JSON `spec` names in a parsed document or the live page. */
function embeddedReadSource(spec) {
  const checked = parseEmbeddedSpec(spec);
  return `((doc) => {
const spec = ${JSON.stringify(checked)};
${readEmbedded.toString()}
const scripts = spec.assign
  ? [...doc.querySelectorAll("script")].filter((script) => script.getAttribute("src") === null)
  : [...doc.querySelectorAll(spec.selector)];
return readEmbedded(scripts.map((script) => script.textContent || ""), spec);
})`;
}

module.exports = { embeddedReadSource, parseEmbeddedSpec, readEmbedded };
