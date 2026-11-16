// Assertions on an op's result: { path, op, value? } with
// a $-path into the result. Saved in an op's on.success.expect.assert, they run on every strategy's
// result, like the rest of verifyResult.

const { isDeepStrictEqual } = require("node:util");
const bounded = require("./bounded-regex.cjs");
const { compileJsonPath } = require("./records.cjs");

// matches patterns come from the CLI and from op files, so every run of one is bounded as
// bounded-regex.cjs describes: a 100 ms timeout on at most the first 64 KB of the text. A pattern is
// refused only when it is over PATTERN_LIMIT characters or isn't a valid regex.
const { MATCH_INPUT_LIMIT, MATCH_SKIPPED, MATCH_TIMED_OUT, PATTERN_LIMIT, isBoundedOut } = bounded;
// Each run is bounded, and so is a run's total: one budget is shared by an op run's matches checks
// and its secret checks. Once it is spent, the rest don't run. Ops hold at most ASSERTION_LIMIT.
const REGEX_BUDGET_MS = 1000;
const ASSERTION_LIMIT = 50;

/** A regex time budget for one op run: pass it to every boundedMatch of the run. */
function createRegexBudget(ms = REGEX_BUDGET_MS) {
  return bounded.createRegexBudget({ ms, scope: "run" });
}

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
 * Whether `pattern` matches the first 64 KB of `text`, spending from `budget`. A run past 100 ms is
 * stopped and throws code "pattern_timeout"; a run the budget can't cover throws code
 * "pattern_skipped" (at once when nothing is left, or when it is stopped at the budget's end).
 */
function boundedMatch(pattern, text, budget = createRegexBudget()) {
  checkPattern(pattern);
  return bounded.boundedTest({ pattern, text, budget, label: "matches" });
}

const OPS = {
  equals: { value: true, test: (found, value) => isDeepStrictEqual(found, value) },
  array_min_len: { value: true, test: (found, value) => Array.isArray(found) && found.length >= value },
  not_null: { value: false, test: (found) => found !== undefined && found !== null },
  exists: { value: false, test: (found) => found !== undefined },
  // The pattern is checked first, whatever the value, so a run refuses an invalid one too.
  matches: {
    value: true,
    test: (found, value, budget) => {
      checkPattern(value);
      return typeof found === "string" && boundedMatch(value, found, budget);
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
  if (list.length > ASSERTION_LIMIT) throw new Error(`at most ${ASSERTION_LIMIT} assertions per op (got ${list.length})`);
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

/** Every key and leaf of a value, numbers, booleans and null as their text (an env value can read "true"). */
function valueTexts(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (typeof value === "number" || typeof value === "boolean" || value === null) out.push(String(value));
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
function touchesSecret(assertion, found, secrets, budget) {
  const texts = [assertion.path, ...valueTexts(assertion.value)];
  if (assertion.op === "equals" || assertion.op === "matches") texts.push(...valueTexts(found));
  const patternMatches = (secret) => {
    try {
      return boundedMatch(assertion.value, secret, budget);
    } catch (error) {
      if (isBoundedOut(error)) return true;
      throw error;
    }
  };
  return secrets.some((secret) => texts.some((text) => text.includes(secret)) || (assertion.op === "matches" && patternMatches(secret)));
}

/**
 * `secrets`: the run's env values; an assertion that touches one gets `secretSensitive: true`.
 * `budget`: the op run's regex budget (a fresh one when not given).
 */
function checkAssertions(value, list, secrets = [], budget = createRegexBudget()) {
  return list.map((assertion) => {
    const found = compileJsonPath(assertion.path, "path")(value);
    let pass;
    let error;
    try {
      pass = OPS[assertion.op].test(found, assertion.value, budget);
    } catch (caught) {
      if (!isBoundedOut(caught)) throw caught;
      pass = false;
      error = caught.message;
    }
    const result = { ...assertion, pass, actual: describeActual(found), ...(error ? { error } : {}) };
    return touchesSecret(assertion, found, secrets, budget) ? { ...result, secretSensitive: true } : result;
  });
}

function describeAssertion({ path, op, value }) {
  return [path, op, ...(value === undefined ? [] : [JSON.stringify(value)])].join(" ");
}

// MATCH_INPUT_LIMIT is bounded-regex.cjs's, exported here too for callers of boundedMatch.
module.exports = { MATCH_INPUT_LIMIT, MATCH_SKIPPED, MATCH_TIMED_OUT, boundedMatch, checkAssertions, createRegexBudget, describeAssertion, validateAssertions, valueTexts };
