// Fills an op's inputs into its network request. Generated clients (pb client export) embed these
// two functions' source, so they must stay self-contained: no imports, no outside names.

// Applies defaults, enforces `required`, and converts each input to its declared `type`.
function resolveArgValues(specs, provided) {
  const args = { ...provided };
  for (const [name, spec] of Object.entries(specs || {})) {
    if (args[name] === undefined && spec.default !== undefined) args[name] = spec.default;
    if (spec.required && args[name] === undefined) throw new Error(`Missing required argument: --${name}`);
    const value = args[name];
    if (value === undefined || spec.type === undefined) continue;
    if (spec.type === "string") args[name] = String(value);
    else if (spec.type === "number") {
      const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
      if (typeof number !== "number" || !Number.isFinite(number)) throw new Error(`--${name} must be a number`);
      args[name] = number;
    } else if (spec.type === "boolean") {
      if (value !== true && value !== false && value !== "true" && value !== "false") throw new Error(`--${name} must be true or false`);
      args[name] = value === true || value === "true";
    }
  }
  return args;
}

// A string that is only `{{name}}` takes the input's own value (left out when it is unset). Inside
// a longer string the value is encoded for where it lands: the URL and urlencoded bodies get
// percent-encoding; query params, headers and other bodies get the text as is. Object and array
// query params are sent as JSON.
function renderRequest(request, args) {
  const EXACT = /^\{\{([a-zA-Z0-9._-]+)\}\}$/;
  const ANY = /\{\{([a-zA-Z0-9._-]+)\}\}/g;
  const keep = (text) => text;
  const embed = (text, encode) => text.replace(ANY, (_, name) => {
    if (args[name] === undefined) throw new Error(`missing template argument: ${name}`);
    return encode(String(args[name]));
  });
  const fill = (value, encode = keep) => {
    if (typeof value === "string") {
      const exact = value.match(EXACT);
      return exact ? args[exact[1]] : embed(value, encode);
    }
    if (Array.isArray(value)) return value.map((item) => fill(item));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fill(item)]));
    return value;
  };
  const headers = {};
  for (const [name, value] of Object.entries(request.headers || {})) {
    const filled = fill(value);
    if (filled !== undefined && filled !== null) headers[name] = String(filled);
  }
  const query = {};
  for (const [name, value] of Object.entries(request.query || {})) {
    const filled = fill(value);
    if (filled !== undefined && filled !== null) query[name] = typeof filled === "object" ? JSON.stringify(filled) : String(filled);
  }
  const contentType = Object.entries(request.headers || {}).find(([name]) => name.toLowerCase() === "content-type")?.[1] || "";
  const form = /application\/x-www-form-urlencoded/i.test(String(contentType));
  const rendered = { ...request, url: fill(request.url, encodeURIComponent), query, headers };
  if (request.body !== undefined) rendered.body = fill(request.body, form ? encodeURIComponent : keep);
  return rendered;
}

module.exports = { renderRequest, resolveArgValues };
