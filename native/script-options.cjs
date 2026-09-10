function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

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

function applyOptionsPrelude(code, options) {
  const normalized = parseScriptOptions(options);
  const prelude = `const SURF_OPTIONS = Object.freeze(JSON.parse(${JSON.stringify(JSON.stringify(normalized))}));\n`;
  const strict = code.match(/^\s*(["'])use strict\1\s*;/);
  if (!strict) return `${prelude}${code}`;
  return `${strict[0]}\n${prelude}${code.slice(strict[0].length)}`;
}

module.exports = { applyOptionsPrelude, parseScriptOptions };
