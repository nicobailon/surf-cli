// Names an op's inputs in the request it is made from. Each `--<name> <sample>` value and each
// typed value becomes `{{name}}` where it sits; then three rules name what is left: a search key,
// a paging key or page-N segment, and an id-like path segment. Simplified from the feat branch's
// parse-inputs.cjs, without its goal-word tables.

const { fields, restring, scrub, sniff, templateSecrets } = require("./op-body.cjs");
const { isSecret, spaced } = require("./redaction.cjs");

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
  // A repeated form key keeps every value, as a list.
  if (/x-www-form-urlencoded/i.test(type)) return [...new URLSearchParams(text)].reduce((out, [key, value]) => ({ ...out, [key]: Object.hasOwn(out, key) ? [out[key], value].flat() : value }), {});
  if (/json/i.test(type)) {
    try { return JSON.parse(text); } catch {}
  }
  return text;
}

/** The op request for a captured request: its query apart, a JSON or form body as an object. */
function requestOf(entry) {
  const url = new URL(entry.url);
  // A repeated key keeps every value, as a list.
  const query = {};
  for (const [key, value] of url.searchParams) query[key] = Object.hasOwn(query, key) ? [query[key], value].flat() : value;
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
 * warnings, values }. `samples` maps an input to this run's value; `typed` lists values typed into the
 * page, each named after the key it lands in. `template` is the URL as surf hook was given it:
 * when the pick is that URL, a sample goes only where it wrote `{{name}}`. `paging` is the input
 * the op's page rule adds to. `secrets` lists values surf knows are secret ({ value, name }: a
 * password field's value, a cookie or auth header's), which, like a secret-named sample's, become a
 * required input with no stored value wherever they sit; `values` holds them by input, in memory
 * only, for the test run.
 */
function nameInputs({ request, samples = {}, typed = [], template, secrets = [] }) {
  const url = new URL(request.url);
  let segments = url.pathname.split("/");
  // The query as [key, value] pairs, a repeated key once per value.
  let pairs = Object.entries(request.query || {}).flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map((item) => [key, item]));
  // Form or JSON text sent as text/plain or with no type is named as an object, then written back
  // as the text it was.
  const type = request.headers?.["content-type"] || "";
  const format = sniff(request.body, type);
  let body = format ? fields(request.body, format).body : request.body;
  const args = {};
  const warnings = [];
  let detail = false;
  // Each value an input was made from, by value.
  const owners = new Map();
  const add = (wanted, value, { unique = true } = {}) => {
    let name = wanted;
    for (let n = 2; unique && args[name]; n++) name = `${wanted}_${n}`;
    const number = /^\d+$/.test(String(value)) ? Number(value) : value;
    args[name] = isPaging(name) ? { default: number, example: number } : { required: true, example: value };
    if (value !== "" && !owners.has(String(value))) owners.set(String(value), name);
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
    for (const pair of pairs) {
      if (free(pair[1]) && pair[1] === value) [pair[1], found] = [nameOf(pair[0]), true];
    }
    let inside;
    [body, inside] = inBody(body, value, nameOf);
    return found || inside;
  };
  const written = new Set();
  if (template) {
    const filled = new URL(template.replace(/\{\{([a-zA-Z0-9._-]+)\}\}/g, (whole, name) => (samples[name] === undefined ? whole : encodeURIComponent(samples[name]))));
    const raw = new URL(template);
    if (filled.origin + filled.pathname === url.origin + url.pathname && JSON.stringify([...filled.searchParams]) === JSON.stringify(pairs)) {
      segments = raw.pathname.replace(/%7B%7B([a-zA-Z0-9._-]+)%7D%7D/gi, "{{$1}}").split("/");
      pairs = [...raw.searchParams];
      for (const name of Object.keys(samples)) {
        if (!template.includes(`{{${name}}}`)) continue;
        written.add(name);
        add(name, String(samples[name]), { unique: false });
      }
    }
  }
  const unplaced = [];
  for (const [name, sample] of Object.entries(samples)) {
    let made;
    if (written.has(name)) continue;
    if (!place(String(sample), () => (made ??= add(name, String(sample), { unique: false })))) unplaced.push(name);
  }
  for (const value of typed) {
    if (value) place(String(value), (key, before) => add(key === undefined ? snake(singular(before)) || "value" : SEARCH_KEYS.test(key) ? "query" : snake(key) || "value", String(value)));
  }
  for (const pair of pairs) {
    const [key, value] = pair;
    if (!free(value)) continue;
    if (SEARCH_KEYS.test(key) && value) pair[1] = add("query", value);
    else if (/^\d+$/.test(value) && PAGE_KEYS.test(key)) pair[1] = add("page", value);
    else if (/^\d+$/.test(value) && OFFSET_KEYS.test(key)) pair[1] = add(key.toLowerCase(), value);
  }
  // A write's secret-named field (password, token, secret, csrf...) is a required input with no
  // stored value.
  const secretInput = (key) => {
    const template = add(snake(spaced(key)) || "secret", "");
    args[template.slice(2, -2)] = { required: true };
    return template;
  };
  const hide = (key, value) => {
    if (!isSecret(key) || value === "" || !["string", "number"].includes(typeof value)) return value;
    if (!free(String(value))) {
      const name = String(value).match(/^\{\{([a-zA-Z0-9._-]+)\}\}$/)?.[1];
      if (name) args[name] = { required: true };
      return String(value);
    }
    const template = secretInput(key);
    if (!owners.has(String(value))) owners.set(String(value), template.slice(2, -2));
    return template;
  };
  // A list's values are each hidden by the key that holds the list.
  const hideAll = (node, key) => (Array.isArray(node) ? node.map((item) => hideAll(item, key)) : isObject(node) ? Object.fromEntries(Object.entries(node).map(([name, item]) => [name, hideAll(item, name)])) : key === undefined ? node : hide(key, node));
  const write = !["GET", "HEAD"].includes(String(request.method || "GET").toUpperCase());
  if (write) {
    for (const pair of pairs) pair[1] = hide(pair[0], pair[1]);
    body = hideAll(body);
    for (const name of Object.keys(args)) if (isSecret(name)) args[name] = { required: true };
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
  // Each value surf knows is secret, of 6 characters or more (a shorter one could match other text),
  // becomes {{name}} wherever it sits: the input it was made into, else the secret-named sample's
  // input, else a new one named after where surf saw it.
  const known = [...Object.entries(samples).filter(([name]) => isSecret(name)).map(([name, value]) => ({ value: String(value), name, sample: true })), ...secrets.map((secret) => ({ ...secret, value: String(secret.value) }))].filter(({ value }) => value.length >= 6);
  const values = {};
  const secretOf = (secret) => {
    secret.input ??= owners.get(secret.value) ?? (secret.sample && args[secret.name] ? secret.name : add(snake(secret.name) || "secret", secret.value, { unique: !secret.sample }).slice(2, -2));
    args[secret.input] = { required: true };
    values[secret.input] = secret.value;
    return `{{${secret.input}}}`;
  };
  const scrubAll = (node) => (typeof node === "string" ? scrub(node, known, secretOf) : Array.isArray(node) ? node.map(scrubAll) : isObject(node) ? Object.fromEntries(Object.entries(node).map(([key, item]) => [key, scrubAll(item)])) : node);
  for (const secret of known) {
    const name = Object.keys(args).find((key) => String(args[key].example) === secret.value);
    if (name) secretOf(Object.assign(secret, { input: name }));
  }
  segments = segments.map(scrubAll);
  for (const pair of pairs) pair[1] = scrubAll(pair[1]);
  body = scrubAll(body);
  const headers = request.headers && scrubAll(request.headers);
  for (const name of unplaced) if (!args[name]) warnings.push(`--${name}'s value ${isSecret(name) ? "" : `${samples[name]} `}isn't in the picked request, so it is no input`);
  if (format) body = restring(request.body, format, body);
  else if (typeof body === "string" && body !== "") {
    // A body surf doesn't parse: a secret-named field's value in it becomes {{name}}.
    if (write) body = templateSecrets(body, secretInput);
    warnings.push(`the request body (${type || "no content type"}) is in a format surf doesn't parse, so it is saved as sent apart from secret-named fields and secret values surf saw; check it before you share the op`);
  }
  const query = {};
  for (const [key, value] of pairs) query[key] = Object.hasOwn(query, key) ? [query[key], value].flat() : value;
  const pagingName = Object.keys(args).find(isPaging);
  const templated = {
    ...request,
    url: `${url.origin}${segments.join("/")}`,
    ...(request.query ? { query } : {}),
    ...(headers ? { headers } : {}),
    ...(request.body === undefined ? {} : { body }),
  };
  return {
    request: templated,
    args,
    ...(pagingName ? { paging: { name: pagingName, next: PAGE_KEYS.test(pagingName) ? "+1" : "+count" } } : {}),
    detail,
    warnings,
    values,
  };
}

module.exports = { isSecret, nameInputs, requestOf };
