/** Options prelude for page-side scripts run through js or frame.js. */
const PRELUDE_NAME = "SURF_OPTIONS";

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Accept an object or JSON string; missing input defaults to an empty object. */
function parseScriptOptions(input) {
  if (input === undefined || input === null || input === "") return {};
  if (input === true) throw new Error("--options needs a JSON object value");
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch (error) {
      throw new Error(`--options is not valid JSON: ${error.message}`);
    }
  }
  if (!isPlainObject(value)) {
    throw new Error("--options must be a JSON object, e.g. '{\"limit\": 20}'");
  }
  // Round-trip so functions, undefined and prototypes cannot leak into the page.
  return JSON.parse(JSON.stringify(value));
}

/** `const SURF_OPTIONS = Object.freeze({...});` followed by a newline. */
function buildOptionsPrelude(options) {
  const normalized = parseScriptOptions(options);
  return `const ${PRELUDE_NAME} = Object.freeze(${JSON.stringify(normalized)});\n`;
}

/** Prefix code with the prelude; empty options still defines the constant. */
function applyOptionsPrelude(code, options) {
  return `${buildOptionsPrelude(options)}${code}`;
}

module.exports = { PRELUDE_NAME, applyOptionsPrelude, buildOptionsPrelude, parseScriptOptions };
