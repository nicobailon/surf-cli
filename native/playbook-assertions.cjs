// Assertions on an op's result, modelled on parse.bot's endpoint checks: { path, op, value? } with
// a $-path into the result. Saved in an op's on.success.expect.assert, they run on every strategy's
// result, like the rest of verifyResult.

const { isDeepStrictEqual } = require("node:util");
const vm = require("node:vm");
const { compileJsonPath } = require("./records.cjs");

// matches patterns come from the CLI and from op files, which pb export and pb import share, so a
// hostile one must not hang the host. Patterns are not analysed: a pattern is refused only when it
// is over PATTERN_LIMIT characters or isn't a valid regex, and every run of one is bounded. It runs
// in a vm context with a MATCH_TIMEOUT_MS timeout, which V8 interrupts even inside a backtracking
// regex, on at most the first MATCH_INPUT_LIMIT characters of the text.
const PATTERN_LIMIT = 500;
const MATCH_TIMEOUT_MS = 100;
const MATCH_INPUT_LIMIT = 64 * 1024;
const MATCH_TIMED_OUT = "pattern_timeout";
const matchContext = vm.createContext({ cache: undefined, p: undefined, t: undefined });
vm.runInContext("cache = new Map();", matchContext);
const matchScript = new vm.Script(`(() => {
  let regex = cache.get(p);
  if (!regex) {
    if (cache.size >= 1000) cache.clear();
    regex = new RegExp(p);
    cache.set(p, regex);
  }
  return regex.test(t) === true;
})()`);

/** Refuses a matches pattern over the length limit or that isn't a valid regex. */
function checkPattern(pattern) {
  if (typeof pattern !== "string") throw new Error("matches needs a regex string");
  if (pattern.length > PATTERN_LIMIT) throw new Error(`matches pattern is ${pattern.length} characters; the limit is ${PATTERN_LIMIT}`);
  try {
    new RegExp(pattern);
  } catch (error) {
    throw new Error(`matches needs a valid regex (${error.message})`);
  }
}

/**
 * Whether `pattern` matches the first MATCH_INPUT_LIMIT characters of `text`. A run past
 * MATCH_TIMEOUT_MS is stopped and throws an error whose code is "pattern_timeout".
 */
function boundedMatch(pattern, text) {
  checkPattern(pattern);
  matchContext.p = pattern;
  matchContext.t = String(text).slice(0, MATCH_INPUT_LIMIT);
  try {
    return matchScript.runInContext(matchContext, { timeout: MATCH_TIMEOUT_MS });
  } catch (error) {
    if (error?.code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") throw error;
    const timeout = new Error(`matches pattern took too long (over ${MATCH_TIMEOUT_MS} ms); simplify it`);
    timeout.code = MATCH_TIMED_OUT;
    throw timeout;
  } finally {
    matchContext.p = undefined;
    matchContext.t = undefined;
  }
}

const OPS = {
  equals: { value: true, test: (found, value) => isDeepStrictEqual(found, value) },
  array_min_len: { value: true, test: (found, value) => Array.isArray(found) && found.length >= value },
  not_null: { value: false, test: (found) => found !== undefined && found !== null },
  exists: { value: false, test: (found) => found !== undefined },
  // The pattern is checked first, whatever the value, so a run refuses an invalid one too.
  matches: {
    value: true,
    test: (found, value) => {
      checkPattern(value);
      return typeof found === "string" && boundedMatch(value, found);
    },
  },
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
      checkPattern(assertion.value);
    } catch (error) {
      throw new Error(`${where}: ${error.message}`);
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
// A pattern that runs too long against a value counts as matching it.
function touchesSecret(assertion, found, secrets) {
  const texts = [assertion.path, ...valueTexts(assertion.value)];
  if (assertion.op === "equals" || assertion.op === "matches") texts.push(...valueTexts(found));
  const patternMatches = (secret) => {
    try {
      return boundedMatch(assertion.value, secret);
    } catch (error) {
      if (error.code === MATCH_TIMED_OUT) return true;
      throw error;
    }
  };
  return secrets.some((secret) => texts.some((text) => text.includes(secret)) || (assertion.op === "matches" && patternMatches(secret)));
}

/** `secrets`: the run's env values; an assertion that touches one gets `secretSensitive: true`. */
function checkAssertions(value, list, secrets = []) {
  return list.map((assertion) => {
    const found = compileJsonPath(assertion.path, "path")(value);
    let pass;
    let error;
    try {
      pass = OPS[assertion.op].test(found, assertion.value);
    } catch (caught) {
      if (caught.code !== MATCH_TIMED_OUT) throw caught;
      pass = false;
      error = caught.message;
    }
    const result = { ...assertion, pass, actual: describeActual(found), ...(error ? { error } : {}) };
    return touchesSecret(assertion, found, secrets) ? { ...result, secretSensitive: true } : result;
  });
}

function describeAssertion({ path, op, value }) {
  return [path, op, ...(value === undefined ? [] : [JSON.stringify(value)])].join(" ");
}

module.exports = { MATCH_TIMED_OUT, boundedMatch, checkAssertions, describeAssertion, validateAssertions, valueTexts };
