// Harvests a page's own JSON API responses: URL matching and request editing for replay.

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * `match` glob: tested against the URL without query string; the whole URL when the
 * pattern has `://`, else the whole pathname. `*` = any run except `/`, `**` = anything.
 */
function urlMatcher(pattern) {
  if (typeof pattern !== "string" || !pattern) throw new Error("match must be a non-empty URL glob");
  if (/[?#]/.test(pattern)) {
    throw new Error(`match "${pattern}" must not contain ? or #: it is tested against the URL without its query string`);
  }
  const whole = pattern.includes("://");
  if (!whole && !pattern.startsWith("/")) {
    throw new Error(`match "${pattern}" must start with / (a path) or contain :// (a full URL)`);
  }
  const source = pattern
    .split(/(\*\*|\*)/)
    .map((part) => {
      if (part === "**") return ".*";
      if (part === "*") return "[^/]*";
      return part.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  const regex = new RegExp(`^${source}$`);
  return (url) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    return regex.test(whole ? `${parsed.origin}${parsed.pathname}` : parsed.pathname);
  };
}

function setJson(text, path, value, label) {
  const name = path.join(".");
  let doc;
  try {
    doc = typeof text === "string" ? JSON.parse(text) : undefined;
  } catch {
    doc = undefined;
  }
  if (!isPlainObject(doc)) throw new Error(`cannot set ${name}: ${label} is not a JSON object`);
  let node = doc;
  for (const segment of path.slice(0, -1)) {
    if (node[segment] === undefined) node[segment] = {};
    node = node[segment];
    if (!isPlainObject(node)) throw new Error(`cannot set ${name}: ${segment} in ${label} is not an object`);
  }
  node[path[path.length - 1]] = value;
  return JSON.stringify(doc);
}

/**
 * Applies replay `set` edits to `{ url, body }`: `query.<param>`, `query.<param>.<json.path>`,
 * `body`, `body.<json.path>`. Returns a new request; other request fields are kept.
 */
function applySet(request, set) {
  if (!isPlainObject(set)) throw new Error("set must be an object");
  const url = new URL(request.url);
  let body = request.body;
  for (const [key, value] of Object.entries(set)) {
    const [target, ...path] = key.split(".");
    if (path.some((segment) => !segment) || (target !== "query" && target !== "body") || (target === "query" && !path.length)) {
      throw new Error(`set key "${key}" must be query.<param>, query.<param>.<json.path>, body, or body.<json.path>`);
    }
    if (target === "body") {
      if (!path.length) body = typeof value === "string" ? value : JSON.stringify(value);
      else body = setJson(body, path, value, "the request body");
    } else if (path.length === 1) {
      url.searchParams.set(path[0], typeof value === "string" ? value : JSON.stringify(value));
    } else {
      const [param, ...jsonPath] = path;
      url.searchParams.set(param, setJson(url.searchParams.get(param), jsonPath, value, `query param "${param}"`));
    }
  }
  return { ...request, url: url.toString(), body };
}

module.exports = { applySet, urlMatcher };
