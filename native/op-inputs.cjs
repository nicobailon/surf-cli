// Names an op's inputs in the request it is made from. Each `--<name> <sample>` value and each
// typed value becomes `{{name}}` where it sits; then three rules name what is left: a search key,
// a paging key or page-N segment, and an id-like path segment. Simplified from the feat branch's
// parse-inputs.cjs, without its goal-word tables.

const SEARCH_KEYS = /^(?:q|s|k|query|search|search_?query|keywords?|term)$/i;
const PAGE_KEYS = /^(?:page|p|pg|page_?num(?:ber)?)$/i;
const OFFSET_KEYS = /^(?:start|skip|offset|from)$/i;
const ID_LIKE = [/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, /^\d{4}\.\d{4,5}(?:v\d+)?$/, /^[0-9a-f]{16,}$/i, /^\d{4,}$/, /^[a-z0-9-]+_\d+$/i, /^[a-z0-9-]+-\d{3,}$/i];
// The request headers an op keeps; the browser supplies the rest.
const KEPT_HEADERS = new Set(["content-type", "accept", "x-requested-with"]);

const snake = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const singular = (word) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word);
const decode = (text) => { try { return decodeURIComponent(text); } catch { return text; } };
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isPaging = (name) => PAGE_KEYS.test(name) || OFFSET_KEYS.test(name);

function parseBody(text, type) {
  if (/x-www-form-urlencoded/i.test(type)) return Object.fromEntries(new URLSearchParams(text));
  if (/json/i.test(type)) {
    try { return JSON.parse(text); } catch {}
  }
  return text;
}

/** The op request for a captured request: its query apart, a JSON or form body as an object. */
function requestOf(entry) {
  const url = new URL(entry.url);
  const query = Object.fromEntries(url.searchParams);
  url.search = "";
  url.hash = "";
  const headers = {};
  for (const [name, value] of Object.entries(entry.requestHeaders || {})) {
    const lower = name.toLowerCase();
    if (KEPT_HEADERS.has(lower) && (lower !== "accept" || /json/i.test(value))) headers[lower] = value;
  }
  const method = String(entry.method || "GET").toUpperCase();
  return {
    ...(method === "GET" ? {} : { method }),
    url: url.href,
    ...(Object.keys(query).length ? { query } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(entry.requestBody ? { body: parseBody(entry.requestBody, headers["content-type"] || "") } : {}),
  };
}

/**
 * `request` with its inputs as `{{name}}`, and the inputs: { request, args, paging?, detail,
 * warnings }. `samples` maps an input to this run's value; `typed` lists values typed into the
 * page, each named after the key it lands in. `paging` is the input the op's page rule adds to.
 */
function nameInputs({ request, samples = {}, typed = [] }) {
  const url = new URL(request.url);
  const segments = url.pathname.split("/");
  const query = { ...request.query };
  let body = request.body;
  const args = {};
  const warnings = [];
  let detail = false;
  const add = (wanted, value, { unique = true } = {}) => {
    let name = wanted;
    for (let n = 2; unique && args[name]; n++) name = `${wanted}_${n}`;
    const number = /^\d+$/.test(String(value)) ? Number(value) : value;
    args[name] = isPaging(name) ? { default: number, example: number } : { required: true, example: value };
    return `{{${name}}}`;
  };
  const free = (value) => typeof value === "string" && !value.includes("{{");
  // A body value equal to `value`, replaced by what `name(key)` makes; nested objects too.
  const inBody = (node, value, name) => {
    if (!isObject(node)) return [node, false];
    let found = false;
    const out = {};
    for (const [key, item] of Object.entries(node)) {
      if ((typeof item === "string" || typeof item === "number") && String(item) === value) {
        out[key] = name(key);
        found = true;
      } else if (isObject(item)) {
        const [inner, hit] = inBody(item, value, name);
        out[key] = inner;
        found ||= hit;
      } else out[key] = item;
    }
    return [out, found];
  };
  // Puts `{{name}}` wherever `value` sits; `nameOf(key, before)` names it by its place.
  const place = (value, nameOf) => {
    let found = false;
    segments.forEach((segment, index) => {
      if (!segment || !free(segment)) return;
      const bounded = new RegExp(`(^|[^\\p{L}\\p{N}])${escape(encodeURIComponent(value))}(?=$|[^\\p{L}\\p{N}])`, "u");
      if (decode(segment) === value || bounded.test(segment)) {
        const template = nameOf(undefined, decode(segments[index - 1] || ""));
        segments[index] = decode(segment) === value ? template : segment.replace(bounded, (_, lead) => `${lead}${template}`);
        found = true;
      }
    });
    for (const [key, item] of Object.entries(query)) {
      if (free(item) && item === value) [query[key], found] = [nameOf(key), true];
    }
    let inside;
    [body, inside] = inBody(body, value, nameOf);
    return found || inside;
  };
  for (const [name, sample] of Object.entries(samples)) {
    let template;
    if (!place(String(sample), () => (template ??= add(name, String(sample), { unique: false })))) warnings.push(`--${name}'s value ${sample} isn't in the picked request, so it is no input`);
  }
  for (const value of typed) {
    if (value) place(String(value), (key, before) => add(key === undefined ? snake(singular(before)) || "value" : SEARCH_KEYS.test(key) ? "query" : snake(key) || "value", String(value)));
  }
  for (const [key, value] of Object.entries(query)) {
    if (!free(value)) continue;
    if (SEARCH_KEYS.test(key) && value) query[key] = add("query", value);
    else if (/^\d+$/.test(value) && PAGE_KEYS.test(key)) query[key] = add("page", value);
    else if (/^\d+$/.test(value) && OFFSET_KEYS.test(key)) query[key] = add(key.toLowerCase(), value);
  }
  segments.forEach((segment, index) => {
    if (!segment || !free(segment)) return;
    const page = segment.match(/^page-(\d+)((?:\.\w+)?)$/i);
    const before = decode(segments[index - 1] || "").toLowerCase();
    if (page) segments[index] = `page-${add("page", page[1])}${page[2]}`;
    else if (/^\d+$/.test(segment) && ["page", "p"].includes(before)) segments[index] = add("page", segment);
    else if (ID_LIKE.some((pattern) => pattern.test(decode(segment)))) {
      segments[index] = add(`${snake(singular(before)) || "item"}_id`, decode(segment));
      detail = true;
    }
  });
  const pagingName = Object.keys(args).find(isPaging);
  const templated = {
    ...request,
    url: `${url.origin}${segments.join("/")}`,
    ...(request.query ? { query } : {}),
    ...(request.body === undefined ? {} : { body }),
  };
  return {
    request: templated,
    args,
    ...(pagingName ? { paging: { name: pagingName, next: PAGE_KEYS.test(pagingName) ? "+1" : "+count" } } : {}),
    detail,
    warnings,
  };
}

module.exports = { nameInputs, requestOf };
