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

/** Every key and string or number leaf of a value, numbers as text. */
function valueTexts(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (typeof value === "number") out.push(String(value));
  else if (Array.isArray(value)) for (const item of value) valueTexts(item, out);
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      out.push(key);
      valueTexts(item, out);
    }
  }
  return out;
}

// Whether saving an assertion could store one of the run's env values: its path or expected value
// (keys and leaves) contains one, its matches pattern matches one, or, for equals and matches (whose
// stored value is compared with the content), the full, untruncated actual value contains one.
// Only the run knows every value, the browser host's own included; callers get the boolean alone.
function touchesSecret(assertion, found, secrets) {
  const texts = [assertion.path, ...valueTexts(assertion.value)];
  if (assertion.op === "equals" || assertion.op === "matches") texts.push(...valueTexts(found));
  return secrets.some((secret) =>
    texts.some((text) => text.includes(secret)) || (assertion.op === "matches" && new RegExp(assertion.value).test(secret)));
}

/** `secrets`: the run's env values; an assertion that touches one gets `secretSensitive: true`. */
function checkAssertions(value, list, secrets = []) {
  return list.map((assertion) => {
    const found = compileJsonPath(assertion.path, "path")(value);
    const result = { ...assertion, pass: OPS[assertion.op].test(found, assertion.value), actual: describeActual(found) };
    return touchesSecret(assertion, found, secrets) ? { ...result, secretSensitive: true } : result;
  });
}

function describeAssertion({ path, op, value }) {
  return [path, op, ...(value === undefined ? [] : [JSON.stringify(value)])].join(" ");
}

module.exports = { checkAssertions, describeAssertion, validateAssertions, valueTexts };
