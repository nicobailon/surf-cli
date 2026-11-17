// Assertions on an op's result: { path, op, value? } with
// a $-path into the result. Saved in an op's on.success.expect.assert, they run on every strategy's
// result, like the rest of verifyResult.

const { isDeepStrictEqual } = require("node:util");
const bounded = require("./bounded-regex.cjs");
const { compileJsonPath } = require("./records.cjs");
const { decodeBudget, redactJson, redactText, secretIn } = require("./redaction.cjs");

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

/**
 * What the value was, short enough to print: text, numbers and null as is; arrays and objects by
 * shape. Redacted in full before it is cut, so the preview can't keep the start of an env value.
 */
function describeActual(found, secrets) {
  if (found === undefined) return "missing";
  if (Array.isArray(found)) return `array(${found.length})`;
  if (found !== null && typeof found === "object") return "object";
  const shown = redactJson(found, secrets);
  if (typeof shown === "string" && shown.length > ACTUAL_TEXT_LIMIT) return `${shown.slice(0, ACTUAL_TEXT_LIMIT)}…`;
  return shown;
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

// How many texts patternTexts lists for one part of a pattern, and how many characters of a part
// it writes as a gap it keeps to check on their own.
const PATTERN_TEXT_LIMIT = 256;
const SET_ASIDE_LIMIT = 4 * MATCH_INPUT_LIMIT;
// What patternTexts writes for a part that matches one of several characters, each kind its own
// private-use character, which no header value holds.
const GAPS = ["a character class", "the wildcard .", "a class escape", "a part with more alternatives or repeats than can be listed"];
const gapOf = (kind) => String.fromCharCode(0xe000 + GAPS.indexOf(kind));
const gapKind = (char) => GAPS[char.charCodeAt(0) - 0xe000];

// What a matches pattern can match, normalized to texts: { texts, setAside, backreference }. Regex
// escapes (\xNN, \uNNNN, \cX, \0, \t, \/, \. ...) become the characters they stand for, a class of
// one character ([d], [\x64]) becomes that character, groups and | are expanded, ^, $, \b, \B and
// lookarounds match no characters, and a repeat is written out its fewest times, with ? and *
// also as none and {n,m} at each count. A part that matches one of several characters (a class,
// ., \d) becomes a gap character (GAPS). A part with too many texts becomes a gap too, its texts
// kept in setAside, as are each lookaround's. Patterns run without flags, so this follows that
// grammar (\u{...} is a repeated u). A backreference repeats text the pattern can't list, so it is
// reported instead.
function patternTexts(pattern) {
  let at = 0;
  let backreference = false;
  const setAside = [];
  let setAsideSize = 0;
  const keep = (texts) => {
    for (const text of texts) {
      if (setAsideSize + text.length > SET_ASIDE_LIMIT) return;
      setAside.push(text);
      setAsideSize += text.length;
    }
  };
  const listed = (texts) => {
    if (texts.length <= PATTERN_TEXT_LIMIT && texts.every((text) => text.length <= MATCH_INPUT_LIMIT)) return texts;
    keep(texts.slice(0, PATTERN_TEXT_LIMIT));
    return [gapOf(GAPS[3])];
  };
  const product = (left, right) => {
    if (left.length * right.length > PATTERN_TEXT_LIMIT) {
      keep([...left, ...right]);
      return [gapOf(GAPS[3])];
    }
    return listed(left.flatMap((first) => right.map((second) => first + second)));
  };
  const hex = (count) => {
    const digits = pattern.slice(at, at + count);
    if (!new RegExp(`^[0-9a-fA-F]{${count}}$`).test(digits)) return null;
    at += count;
    return String.fromCharCode(parseInt(digits, 16));
  };
  const controls = { t: "\t", n: "\n", v: "\v", f: "\f", r: "\r" };
  // One escape after its backslash: { char } for a character, { gap } for a class escape, {} for
  // one that matches no characters.
  const escape = (inClass) => {
    const char = pattern[at++];
    if (/[dDwWsS]/.test(char)) return { gap: GAPS[2] };
    if (char === "b") return inClass ? { char: "\b" } : {};
    if (char === "B" && !inClass) return {};
    // \0 and, in a class, \1 to \7 start an octal escape; elsewhere \1 to \9 and \k<name> refer back.
    if (/[0-7]/.test(char) && (char === "0" || inClass)) {
      const octal = /^[0-7]{0,2}/.exec(pattern.slice(at))[0].slice(0, char <= "3" ? 2 : 1);
      at += octal.length;
      return { char: String.fromCharCode(parseInt(char + octal, 8)) };
    }
    if (!inClass && (/[1-9]/.test(char) || (char === "k" && pattern[at] === "<"))) {
      if (char === "k") at = pattern.indexOf(">", at) + 1;
      backreference = true;
      return {};
    }
    if (char === "c") {
      if (/[A-Za-z]/.test(pattern[at] ?? "")) return { char: String.fromCharCode(pattern.charCodeAt(at++) % 32) };
      // Without a letter, \c matches a backslash and the c is read on its own.
      at--;
      return { char: "\\" };
    }
    if (Object.hasOwn(controls, char)) return { char: controls[char] };
    if (char === "x" || char === "u") return { char: hex(char === "x" ? 2 : 4) ?? char };
    return { char };
  };
  // [ ... ]: its one character, or a gap; at is past the [.
  const charClass = () => {
    const negated = pattern[at] === "^";
    if (negated) at++;
    const members = new Set();
    let several = negated;
    const member = () => {
      const char = pattern[at++];
      return char === "\\" ? escape(true) : { char };
    };
    while (at < pattern.length && pattern[at] !== "]") {
      const first = member();
      if (pattern[at] === "-" && pattern[at + 1] !== "]" && at + 1 < pattern.length) {
        at++;
        const last = member();
        if (first.char !== undefined && first.char === last.char) members.add(first.char);
        else several = true;
      } else if (first.char !== undefined) members.add(first.char);
      else several = true;
    }
    at++;
    if (several || members.size > 1) return [gapOf(GAPS[0])];
    // [] matches nothing.
    return [...members];
  };
  // The texts one atom matches, or null for one that matches no characters.
  const atom = () => {
    const char = pattern[at++];
    if (char === "^" || char === "$") return null;
    if (char === ".") return [gapOf(GAPS[1])];
    if (char === "[") return charClass();
    if (char === "\\") {
      const read = escape(false);
      return read.char !== undefined ? [read.char] : read.gap ? [gapOf(read.gap)] : null;
    }
    if (char === "(") {
      let lookaround = false;
      if (pattern[at] === "?") {
        const head = /^\?(?:<(?![=!])[^>]*>|[a-z]*(?:-[a-z]*)?:|(<?[=!]))/.exec(pattern.slice(at));
        at += head[0].length;
        lookaround = head[1] !== undefined;
      }
      const texts = alternatives();
      at++;
      if (!lookaround) return texts;
      keep(texts);
      return null;
    }
    return [char];
  };
  const repeat = (texts) => {
    const quantifier = /^(?:([*+?])|\{(\d+)(?:(,)(\d*))?\})\??/.exec(pattern.slice(at));
    if (!quantifier) return texts;
    at += quantifier[0].length;
    if (quantifier[1] === "+") return texts;
    if (quantifier[1]) return listed(["", ...texts]);
    const min = Number(quantifier[2]);
    const max = quantifier[3] && quantifier[4] !== "" ? Number(quantifier[4]) : min;
    if (min * Math.max(1, ...texts.map((text) => text.length)) > MATCH_INPUT_LIMIT || max - min > PATTERN_TEXT_LIMIT) {
      keep(texts);
      return [gapOf(GAPS[3])];
    }
    let times = [""];
    for (let count = 0; count < min; count++) times = product(times, texts);
    const all = [...times];
    for (let count = min; count < max && all.length <= PATTERN_TEXT_LIMIT; count++) {
      times = product(times, texts);
      all.push(...times);
    }
    return listed(all);
  };
  const sequence = () => {
    let texts = [""];
    while (at < pattern.length && pattern[at] !== "|" && pattern[at] !== ")") {
      const matched = atom();
      // A quantifier after a part that matches no characters repeats nothing.
      if (matched === null) repeat([""]);
      else texts = product(texts, repeat(matched));
    }
    return texts;
  };
  const alternatives = () => {
    let texts = sequence();
    while (pattern[at] === "|") {
      at++;
      texts = listed([...texts, ...sequence()]);
    }
    return texts;
  };
  const texts = alternatives();
  return { texts: [...new Set(texts)], setAside, backreference };
}

// Whether `text`, a patternTexts text, spells most of `spelling` around its gaps: its characters,
// in order and each run of them unbroken, give at least 3/4 of the spelling's characters (and 4
// or more), a gap standing for any number of characters between runs, and the spelling's start
// and end free to fall outside the text. One pass over the spelling per character of the text.
function spellsMost(text, spelling) {
  const need = Math.max(4, Math.ceil(0.75 * spelling.length));
  let best = new Array(spelling.length + 1).fill(0);
  for (const char of text) {
    const next = new Array(spelling.length + 1).fill(0);
    if (gapKind(char)) {
      for (let index = 0, most = 0; index <= spelling.length; index++) {
        most = Math.max(most, best[index]);
        next[index] = most;
      }
    } else {
      for (let index = 0; index < spelling.length; index++) {
        if (spelling[index] === char) next[index + 1] = best[index] + 1;
      }
    }
    if (next.some((covered) => covered >= need)) return true;
    best = next;
  }
  return false;
}

// How much of an escaped spelling a pattern is tested against: a broad pattern such as .*ok.*
// takes time in the square of the text (a few ms on 2 KB), and a long value escaped 8 times runs
// to 64 KB.
const ESCAPED_SPELLING_LIMIT = 2048;

// Each value as it is (its first MATCH_INPUT_LIMIT characters, all a run tests), and JSON-escaped
// up to 8 times, the levels secretIn reads: plain, with \/ for each slash, and with every
// character as \uXXXX (those two forms count as the first level). Each escaped spelling is cut to
// its first ESCAPED_SPELLING_LIMIT characters; escaping is character by character, so the cut
// changes none of them. A pattern that spells a value past the cut is found by patternTexts.
function patternSpellings(values) {
  const spellings = new Set();
  const cut = (text) => text.slice(0, ESCAPED_SPELLING_LIMIT);
  for (const value of values) {
    const text = String(value).slice(0, MATCH_INPUT_LIMIT);
    spellings.add(text);
    const short = cut(text);
    const firstLevel = [JSON.stringify(short).slice(1, -1), short.replaceAll("/", "\\/"), [...short].map((char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).join("")];
    for (let form of firstLevel.map(cut)) {
      for (let level = 1; level <= 8 && !spellings.has(form); level++) {
        spellings.add(form);
        form = cut(JSON.stringify(form).slice(1, -1));
      }
    }
  }
  return [...spellings];
}

// Whether a matches pattern could store or match one of `values`, for both --save checks:
// "found", "too deep" or "too costly" when secretIn finds one in a text the pattern can match or
// set aside (patternTexts); "matches" when it matches a spelling of one (patternSpellings), which
// also catches broad patterns such as .*; MATCH_TIMED_OUT or MATCH_SKIPPED when that test is cut
// short (from bounded-regex.cjs); "backreference" for a pattern with one; { around } when a text
// spells most of a spelling around a gap (spellsMost), `around` naming the gap's kind; else null.
// Ordinary patterns (^\d+$, .*ok.*, ^[A-Z]{3}$, (?:ok|done)) spell no value, and pass.
function patternSecretIn(pattern, values, budget) {
  if (values.length === 0) return null;
  const read = patternTexts(pattern);
  const texts = [...read.texts, ...read.setAside];
  const decoded = decodeBudget(texts.reduce((sum, text) => sum + text.length, 0));
  const found = texts.map((text) => secretIn(text, values, { budget: decoded }));
  const status = ["found", "too deep", "too costly"].find((candidate) => found.includes(candidate));
  if (status) return status;
  const spellings = patternSpellings(values);
  for (const spelling of spellings) {
    try {
      if (boundedMatch(pattern, spelling, budget)) return "matches";
    } catch (error) {
      if (isBoundedOut(error)) return error.code;
      throw error;
    }
  }
  if (read.backreference) return "backreference";
  // Only short texts and spellings: a text can spell at most its own length's worth.
  for (const text of read.texts.filter((candidate) => candidate.length <= 4096 && [...candidate].some(gapKind))) {
    const characters = [...text].filter((char) => !gapKind(char)).length;
    const gap = [...text].find(gapKind);
    if (spellings.some((spelling) => spelling.length <= Math.min(4096, (4 / 3) * characters) && spellsMost(text, spelling))) return { around: gapKind(gap) };
  }
  return null;
}

// Where secretIn finds one of `values` in a JSON value: in a key or leaf, or in the value as JSON,
// compact or indented (as the op file stores it), where a value spanning keys and values shows.
// That form escapes each string once more, so it is read to 9 levels. The calls share one budget,
// sized by the value as JSON. "found" wins over "too deep", and that over "too costly".
function jsonSecretIn(value, values, budget = decodeBudget(JSON.stringify(value)?.length ?? 0)) {
  if (value === undefined) return null;
  const forms = [JSON.stringify(value), JSON.stringify(value, null, 2)];
  const found = [...valueTexts(value).map((text) => secretIn(text, values, { budget })), ...forms.map((form) => secretIn(form, values, { levels: 9, budget }))];
  return ["found", "too deep", "too costly"].find((status) => found.includes(status)) ?? null;
}

// Whether saving an assertion could store one of the run's env values: secretIn finds one in the
// assertion as a whole (see jsonSecretIn), so in its path, its expected value or across them;
// its matches pattern could store or match one (patternSecretIn); or, for equals and matches (whose stored value is compared with the content), secretIn
// finds one in the full, untruncated actual value. Only the run knows every value, the browser
// host's own included; callers get the boolean alone. A pattern that runs too long against a
// value counts as matching it, and so does any pattern against a value over MATCH_INPUT_LIMIT,
// which a run would test only the start of.
function touchesSecret(assertion, found, secrets, budget) {
  if (secrets.length === 0) return false;
  if (jsonSecretIn({ path: assertion.path, op: assertion.op, ...(Object.hasOwn(assertion, "value") ? { value: assertion.value } : {}) }, secrets)) return true;
  if ((assertion.op === "equals" || assertion.op === "matches") && jsonSecretIn(found, secrets)) return true;
  if (assertion.op !== "matches") return false;
  if (secrets.some((secret) => String(secret).length > MATCH_INPUT_LIMIT)) return true;
  return patternSecretIn(assertion.value, secrets, budget) !== null;
}

/**
 * `secrets`: the run's env values; an assertion that touches one gets `secretSensitive: true`, and
 * each result's path, value and actual come back redacted (redactText and redactJson), so anything
 * built from a result (a failure message included) is redacted too. `budget`: the op run's regex budget
 * (a fresh one when not given).
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
    const result = {
      path: redactText(assertion.path, secrets),
      op: assertion.op,
      ...(Object.hasOwn(assertion, "value") ? { value: redactJson(assertion.value, secrets) } : {}),
      pass,
      actual: describeActual(found, secrets),
      ...(error ? { error } : {}),
    };
    return touchesSecret(assertion, found, secrets, budget) ? { ...result, secretSensitive: true } : result;
  });
}

function describeAssertion({ path, op, value }) {
  return [path, op, ...(value === undefined ? [] : [JSON.stringify(value)])].join(" ");
}

// MATCH_INPUT_LIMIT is bounded-regex.cjs's, exported here too for callers of boundedMatch.
module.exports = { ASSERTION_LIMIT, MATCH_INPUT_LIMIT, MATCH_SKIPPED, MATCH_TIMED_OUT, boundedMatch, checkAssertions, createRegexBudget, describeAssertion, jsonSecretIn, patternSecretIn, patternTexts, spellsMost, validateAssertions, valueTexts };
