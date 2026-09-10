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

/** Parse serialized JSON before freezing to preserve own __proto__ keys. */
function buildOptionsPrelude(options) {
  const normalized = parseScriptOptions(options);
  return `const ${PRELUDE_NAME} = Object.freeze(JSON.parse(${JSON.stringify(JSON.stringify(normalized))}));\n`;
}

/** Add the prelude while preserving a leading strict-mode directive. */
function applyOptionsPrelude(code, options) {
  const strict = code.match(/^\s*(["'])use strict\1\s*;/);
  if (!strict) return `${buildOptionsPrelude(options)}${code}`;
  return `${strict[0]}\n${buildOptionsPrelude(options)}${code.slice(strict[0].length)}`;
}

module.exports = { PRELUDE_NAME, applyOptionsPrelude, buildOptionsPrelude, parseScriptOptions };
