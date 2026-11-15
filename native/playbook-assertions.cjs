// Assertions on an op's result, modelled on parse.bot's endpoint checks: { path, op, value? } with
// a $-path into the result. Saved in an op's on.success.expect.assert, they run on every strategy's
// result, like the rest of verifyResult.

const { isDeepStrictEqual } = require("node:util");
const { compileJsonPath } = require("./records.cjs");

const OPS = {
  equals: { value: true, test: (found, value) => isDeepStrictEqual(found, value) },
  array_min_len: { value: true, test: (found, value) => Array.isArray(found) && found.length >= value },
  not_null: { value: false, test: (found) => found !== undefined && found !== null },
  exists: { value: false, test: (found) => found !== undefined },
  matches: { value: true, test: (found, value) => typeof found === "string" && new RegExp(value).test(found) },
};
const ACTUAL_TEXT_LIMIT = 200;

function validateAssertion(assertion, where) {
  if (!assertion || typeof assertion !== "object" || Array.isArray(assertion)) throw new Error(`${where} must be an object`);
  for (const key of Object.keys(assertion)) {
    if (!["path", "op", "value"].includes(key)) throw new Error(`${where} has unknown key "${key}" (allowed: path, op, value)`);
  }
  if (!Object.hasOwn(OPS, assertion.op)) throw new Error(`${where}: op must be one of ${Object.keys(OPS).join(", ")}`);
  try {
    compileJsonPath(assertion.path, "path");
  } catch (error) {
    throw new Error(`${where}: ${error.message}`);
  }
  const spec = OPS[assertion.op];
  const hasValue = Object.hasOwn(assertion, "value");
  if (spec.value && !hasValue) throw new Error(`${where}: ${assertion.op} needs a value`);
  if (!spec.value && hasValue) throw new Error(`${where}: ${assertion.op} takes no value`);
  if (assertion.op === "array_min_len" && (!Number.isInteger(assertion.value) || assertion.value < 0)) {
    throw new Error(`${where}: array_min_len needs an integer >= 0`);
  }
  if (assertion.op === "matches") {
    try {
      if (typeof assertion.value !== "string") throw new Error("not a string");
      new RegExp(assertion.value);
    } catch (error) {
      throw new Error(`${where}: matches needs a valid regex (${error.message})`);
    }
  }
  return assertion;
}

function validateAssertions(list) {
  if (!Array.isArray(list)) throw new Error("must be an array of assertions");
  return list.map((assertion, index) => validateAssertion(assertion, `assertion ${index + 1}`));
}

/** What the value was, short enough to print: text, numbers and null as is; arrays and objects by shape. */
function describeActual(found) {
  if (found === undefined) return "missing";
  if (Array.isArray(found)) return `array(${found.length})`;
  if (found !== null && typeof found === "object") return "object";
  if (typeof found === "string" && found.length > ACTUAL_TEXT_LIMIT) return `${found.slice(0, ACTUAL_TEXT_LIMIT)}…`;
  return found;
}

function checkAssertions(value, list) {
  return list.map((assertion) => {
    const found = compileJsonPath(assertion.path, "path")(value);
    return { ...assertion, pass: OPS[assertion.op].test(found, assertion.value), actual: describeActual(found) };
  });
}

function describeAssertion({ path, op, value }) {
  return [path, op, ...(value === undefined ? [] : [JSON.stringify(value)])].join(" ");
}

module.exports = { checkAssertions, describeAssertion, validateAssertions };
