// Assertions on an op's result, modelled on parse.bot's endpoint checks: { path, op, value? } with
// a $-path into the result. Saved in an op's on.success.expect.assert, they run on every strategy's
// result, like the rest of verifyResult.

const { isDeepStrictEqual } = require("node:util");
const { compileJsonPath } = require("./records.cjs");

// matches patterns come from the CLI and from op files, which pb export and pb import share, so a
// hostile one must not hang the host. The rule is blunt so nesting can't hide anything: a pattern
// is refused when it is over PATTERN_LIMIT characters, or when a group followed by a repeat (*, +,
// {n,}, or {n,m} with m > 1) has a quantifier (any, ? included) or a | anywhere inside it, at any
// depth. Escapes and character classes are single atoms. Safe patterns such as (a|b)+ are refused
// too; a character class ([ab]+) says the same thing.
const PATTERN_LIMIT = 500;
const UNSAFE_PATTERN =
  "repeats a group that contains a repeat or | (at any depth), which can backtrack without end. This also refuses safe patterns such as (a|b)+; use a character class such as [ab]+, or drop the group's repeat";

// The quantifier at `index`: its length, and whether it allows more than one repetition.
function quantifierAt(pattern, index) {
  const char = pattern[index];
  const lazy = (length) => (pattern[index + length] === "?" ? length + 1 : length);
  if (char === "*" || char === "+") return { many: true, length: lazy(1) };
  if (char === "?") return { many: false, length: lazy(1) };
  const braces = pattern.slice(index).match(/^\{(\d+)(,(\d*))?\}/);
  if (!braces) return { many: false, length: 0 };
  const max = braces[2] === undefined ? Number(braces[1]) : braces[3] === "" ? Infinity : Number(braces[3]);
  return { many: max > 1, length: lazy(braces[0].length) };
}

// Where an atom that starts at `index` ends: an escape, a character class or one character.
function atomEnd(pattern, index) {
  if (pattern[index] === "\\") return index + 2;
  if (pattern[index] !== "[") return index + 1;
  let end = index + 1;
  if (pattern[end] === "^") end++;
  if (pattern[end] === "]") end++;
  while (end < pattern.length && pattern[end] !== "]") end += pattern[end] === "\\" ? 2 : 1;
  return end + 1;
}

// Where a group's body starts, past (?: (?= (?! (?<= (?<! or (?<name>.
function groupBodyStart(pattern, index) {
  if (pattern[index] !== "?") return index;
  if (pattern[index + 1] === "<" && pattern[index + 2] !== "=" && pattern[index + 2] !== "!") {
    const close = pattern.indexOf(">", index);
    return close < 0 ? pattern.length : close + 1;
  }
  return index + (pattern[index + 1] === "<" ? 3 : 2);
}

function unsafePatternReason(pattern) {
  if (pattern.length > PATTERN_LIMIT) return `is ${pattern.length} characters; the limit is ${PATTERN_LIMIT}`;
  // One entry per open group: whether its text so far holds a quantifier or a |.
  const open = [];
  const markOpen = () => {
    for (const group of open) group.risky = true;
  };
  let index = 0;
  while (index < pattern.length) {
    const char = pattern[index];
    if (char === "(") {
      open.push({ risky: false });
      index = groupBodyStart(pattern, index + 1);
      continue;
    }
    if (char === "|") {
      markOpen();
      index++;
      continue;
    }
    let risky = false;
    if (char === ")" && open.length > 0) {
      risky = open.pop().risky;
      index++;
    } else index = atomEnd(pattern, index);
    const quantifier = quantifierAt(pattern, index);
    if (quantifier.many && risky) return UNSAFE_PATTERN;
    if (quantifier.length > 0) markOpen();
    index += quantifier.length;
  }
  return null;
}

const compiledPatterns = new Map();

/** The RegExp for a matches pattern, refused (with the reason) when it is unsafe or invalid. */
function safeRegExp(pattern) {
  if (typeof pattern !== "string") throw new Error("matches needs a regex string");
  const reason = unsafePatternReason(pattern);
  if (reason) throw new Error(`matches pattern ${reason}`);
  let regex = compiledPatterns.get(pattern);
  if (!regex) {
    try {
      regex = new RegExp(pattern);
    } catch (error) {
      throw new Error(`matches needs a valid regex (${error.message})`);
    }
    compiledPatterns.set(pattern, regex);
  }
  return regex;
}

const OPS = {
  equals: { value: true, test: (found, value) => isDeepStrictEqual(found, value) },
  array_min_len: { value: true, test: (found, value) => Array.isArray(found) && found.length >= value },
  not_null: { value: false, test: (found) => found !== undefined && found !== null },
  exists: { value: false, test: (found) => found !== undefined },
  // The pattern is checked first, whatever the value, so a run refuses an unsafe one too.
  matches: {
    value: true,
    test: (found, value) => {
      const regex = safeRegExp(value);
      return typeof found === "string" && regex.test(found);
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
      safeRegExp(assertion.value);
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
function touchesSecret(assertion, found, secrets) {
  const texts = [assertion.path, ...valueTexts(assertion.value)];
  if (assertion.op === "equals" || assertion.op === "matches") texts.push(...valueTexts(found));
  return secrets.some((secret) =>
    texts.some((text) => text.includes(secret)) || (assertion.op === "matches" && safeRegExp(assertion.value).test(secret)));
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

module.exports = { checkAssertions, describeAssertion, safeRegExp, validateAssertions, valueTexts };
