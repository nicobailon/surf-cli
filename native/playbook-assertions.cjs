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

// How many texts patternTexts lists for one part of a pattern; past it, texts go to setAside.
const PATTERN_TEXT_LIMIT = 256;
// What patternTexts writes for a part that matches one of several characters, each kind its own
// private-use character, which no header value holds.
const GAPS = ["a character class", "the wildcard .", "a class escape", "a part with more alternatives or repeats than can be listed"];
const gapOf = (kind) => String.fromCharCode(0xe000 + GAPS.indexOf(kind));
const gapKind = (char) => GAPS[char.charCodeAt(0) - 0xe000];
// In `breaks` texts, what an unbounded repeat leaves after its text: any further copies.
const BREAK = String.fromCharCode(0xe00f);
// Gaps and BREAK: what splits a text into the runs of characters the filter looks for.
const MARKS = /[\ue000-\ue00f]/;
// Whether a text holds a character, not only gaps and breaks.
const hasLiteral = (text) => /[^\ue000-\ue00f]/.test(text);
// Thrown when the pattern check's work budget runs out.
const TOO_COSTLY = Symbol("too costly");
// Spends `steps` from a pattern check's work budget, or throws TOO_COSTLY when they don't fit,
// before the work is done.
function spendWork(work, steps) {
  if (work.steps + steps > work.limit) throw TOO_COSTLY;
  work.steps += steps;
}

// What a matches pattern can match, normalized to texts: { texts, setAside, backreference,
// lookaround, exact }.
// Regex escapes (\xNN, \uNNNN, \cX, \0, \t, \/, \. ...) become the characters they stand for, a
// class of one character ([d], [\x64]) becomes that character, groups and | are expanded, ^, $,
// \b, \B and lookarounds match no characters, and a repeat is written out its fewest times, with
// ?, * and {0,n} also as none and {n,m} at each count. A part that matches one of several
// characters (a class, ., \d) becomes a gap character (GAPS). In each list "" comes last, so a
// list's first text is its fullest reading: a character under ?, * or {0,n} still spells it. A
// part with too many texts to list keeps every text of each side next to the other side's first
// (so the pattern's fullest reading stays listed), the rest going to setAside, as
// do each lookaround's texts (`lookaround` says there is one); with `inline`, a lookaround's texts
// stand in its place instead, as the pattern's text spells them. Every text written is charged to
// `work` (a decodeBudget, by default one sized by the pattern); past its limit this throws
// TOO_COSTLY. With `breaks`, an unbounded repeat (+, *, {n,}) is followed by BREAK, for the
// spelling test's filter. `exact` is false when the texts don't list every reading: a part too
// large to list (a repeat too wide to write out counts only when it repeats characters, not gaps
// alone), a backreference, a case-insensitive group. Patterns run without flags, so this follows
// that grammar (\u{...} is a repeated u). A backreference repeats text the pattern can't list, so
// it is reported instead.
function patternTexts(pattern, { work = decodeBudget(pattern.length), breaks = false, inline = false } = {}) {
  let at = 0;
  let backreference = false;
  let lookaround = false;
  let exact = true;
  const setAside = [];
  const spend = (texts) => spendWork(work, texts.reduce((sum, text) => sum + text.length + 1, 0));
  const keep = (texts) => {
    spend(texts);
    setAside.push(...texts);
  };
  const emptyLast = (texts) => (texts.includes("") ? [...texts.filter((text) => text !== ""), ""] : texts);
  const listed = (written) => {
    spend(written);
    let texts = [...new Set(written)];
    if (texts.some((text) => text.length > MATCH_INPUT_LIMIT)) {
      exact = false;
      keep(texts.filter((text) => text.length > MATCH_INPUT_LIMIT));
      texts = texts.map((text) => (text.length > MATCH_INPUT_LIMIT ? gapOf(GAPS[3]) : text));
    }
    if (texts.length <= PATTERN_TEXT_LIMIT) return texts;
    exact = false;
    keep(texts.slice(PATTERN_TEXT_LIMIT));
    return texts.slice(0, PATTERN_TEXT_LIMIT);
  };
  const product = (left, right) => {
    if (left.length * right.length <= PATTERN_TEXT_LIMIT) return listed(left.flatMap((first) => right.map((second) => first + second)));
    exact = false;
    return listed([...left.map((first) => first + right[0]), ...right.slice(1).map((second) => left[0] + second)]);
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
      exact = false;
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
      let around = false;
      if (pattern[at] === "?") {
        const head = /^\?(?:<(?![=!])[^>]*>|([a-z]*)(?:-[a-z]*)?:|(<?[=!]))/.exec(pattern.slice(at));
        at += head[0].length;
        // (?i:...) matches either case of the letters it lists.
        if (head[1]?.includes("i")) exact = false;
        around = head[2] !== undefined;
      }
      const texts = alternatives();
      at++;
      if (!around) return texts;
      lookaround = true;
      if (inline) return texts;
      keep(texts);
      return null;
    }
    return [char];
  };
  const repeat = (texts) => {
    const quantifier = /^(?:([*+?])|\{(\d+)(?:(,)(\d*))?\})\??/.exec(pattern.slice(at));
    if (!quantifier) return texts;
    at += quantifier[0].length;
    const unbounded = quantifier[1] === "+" || quantifier[1] === "*" || quantifier[4] === "";
    const more = (list) => (breaks && unbounded ? listed(list.map((text) => text + BREAK)) : list);
    if (quantifier[1] === "+") return more(texts);
    if (quantifier[1]) return listed([...more(texts), ""]);
    const min = Number(quantifier[2]);
    // {n,} is written out n times, and once more when n is 0.
    const max = unbounded ? Math.max(min, 1) : quantifier[3] ? Number(quantifier[4]) : min;
    if (min * Math.max(1, ...texts.map((text) => text.length)) > MATCH_INPUT_LIMIT || max - min > PATTERN_TEXT_LIMIT) {
      // Copies of gaps alone are what a text and a gap after it read as.
      if (texts.some(hasLiteral)) exact = false;
      keep(texts);
      return listed([...texts.map((text) => text + gapOf(GAPS[3])), ...(min === 0 ? [""] : [])]);
    }
    // min copies, by doubling: a long run costs its length, not its square.
    let times = [""];
    for (let count = min, copies = texts; count > 0; count = Math.floor(count / 2)) {
      if (count % 2 === 1) times = product(times, copies);
      if (count > 1) copies = product(copies, copies);
    }
    const all = [...times];
    for (let count = min; count < max && all.length <= PATTERN_TEXT_LIMIT; count++) {
      times = product(times, texts);
      all.push(...times);
    }
    if (all.length > PATTERN_TEXT_LIMIT) exact = false;
    // The most copies first, so the fullest reading leads.
    return listed(emptyLast(unbounded ? more(all.reverse()) : all.reverse()));
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
    const each = [sequence()];
    while (pattern[at] === "|") {
      at++;
      each.push(sequence());
    }
    if (each.length === 1) return each[0];
    // Each alternative's first text first, so a cut keeps every alternative's fullest reading.
    return listed(emptyLast([...each.map((texts) => texts[0]).filter((text) => text !== undefined), ...each.flatMap((texts) => texts.slice(1))]));
  };
  const texts = alternatives();
  return { texts: [...new Set(texts)], setAside, backreference, lookaround, exact };
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

// Each value as it is, and JSON-escaped up to 8 times, the levels secretIn reads: plain, with \/
// for each slash, and with every character as \uXXXX (those two forms count as the first level).
// A run tests at most MATCH_INPUT_LIMIT characters of a text, so a form stops at the first level
// longer than that (each level is at least as long as the one before); no spelling is cut short.
function patternSpellings(values) {
  const spellings = new Set();
  for (const value of values) {
    const text = String(value);
    spellings.add(text);
    const firstLevel = [JSON.stringify(text).slice(1, -1), text.replaceAll("/", "\\/"), [...text].map((char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).join("")];
    for (let form of firstLevel) {
      for (let level = 1; level <= 8 && form.length <= MATCH_INPUT_LIMIT && !spellings.has(form); level++) {
        spellings.add(form);
        form = JSON.stringify(form).slice(1, -1);
      }
    }
  }
  return [...spellings];
}

/**
 * The work budget of one pattern check (patternSecretIn): a decodeBudget sized by the pattern
 * and the spellings it is tested against, so it grows with them and not with what the pattern
 * expands to.
 */
function patternWork(pattern, values) {
  return decodeBudget(String(pattern).length + patternSpellings(values).reduce((sum, spelling) => sum + spelling.length, 0));
}

// Whether `pattern` could match `spelling`, by the texts every match holds: some `breaks` text
// all of whose runs (between gaps and breaks) the spelling holds. Only for `exact` texts, which
// list every reading; each run's search is charged to `spend`.
function couldMatch(read, spelling, spend) {
  const holds = new Map();
  const has = (run) => {
    if (!holds.has(run)) {
      spend(spelling.length);
      holds.set(run, spelling.includes(run));
    }
    return holds.get(run);
  };
  return read.texts.some((text) => text.split(MARKS).every((run) => run === "" || has(run)));
}

// Whether one of `texts` (patternTexts texts) holds the whole of one of `spellings`, wherever it
// stands: secretIn finds a value under 8 characters only where it stands alone, so this finds a
// short value written next to other characters. The texts are searched as one, BREAK between
// them (a spelling holds no mark), so each spelling is one pass, charged to `spend`.
function holdsWhole(texts, spellings, spend) {
  const all = texts.join(BREAK);
  return spellings.some((spelling) => {
    spend(all.length + spelling.length);
    return spelling !== "" && all.includes(spelling);
  });
}

// Each value with its regex syntax escaped, as a pattern's author writes it to match it as it is.
const regexEscaped = (values) => values.map((value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

// Where `texts` hold a whole value once their JSON escapes are decoded, any hex case and depth
// (secretIn with `anywhere`, spending `work`): the spellings holdsWhole reads are only some of the
// ways JSON writes a value. Searched as one, BREAK between them.
const decodedHoldsWhole = (texts, values, work) => secretIn(texts.join(BREAK), values, { budget: work, anywhere: true });

// How many characters in a row a pattern's text may share with a spelling of a value.
const SHARED_RUN = 6;

// Whether one of `texts` (patternTexts texts) holds SHARED_RUN characters in a row, between its
// gaps and breaks, that one of `spellings` also holds. The texts' runs are collected first, so each
// spelling is one pass; both are charged to `spend`.
function sharesRun(texts, spellings, spend) {
  const runs = new Set();
  for (const text of texts) {
    spend(text.length);
    for (const part of text.split(MARKS)) {
      for (let at = 0; at + SHARED_RUN <= part.length; at++) runs.add(part.slice(at, at + SHARED_RUN));
    }
  }
  if (runs.size === 0) return false;
  return spellings.some((spelling) => {
    spend(spelling.length);
    for (let at = 0; at + SHARED_RUN <= spelling.length; at++) if (runs.has(spelling.slice(at, at + SHARED_RUN))) return true;
    return false;
  });
}

// Whether a matches pattern could store or match one of `values`, for both --save checks:
// "found" or "too deep" when secretIn finds one in a text the pattern can match or set aside
// (patternTexts), and "found" when such a text holds a whole spelling of one, at any length and
// next to any character (holdsWhole); "matches" when it matches a spelling of one
// (patternSpellings), which also catches broad patterns such as .*; MATCH_TIMED_OUT or MATCH_SKIPPED when that test is cut short
// (from bounded-regex.cjs, spending `budget`); "backreference" for a pattern with one; { around }
// when a text spells most of a spelling around a gap (spellsMost), `around` naming the gap's kind;
// "shares" when a text, listed or set aside, holds SHARED_RUN characters in a row of a spelling
// (sharesRun); else null. This finds an accidental copy of a value, not one a pattern's author
// encodes on purpose: a pattern with more readings than patternTexts lists is checked on the
// texts it lists. A lookaround matches no characters, but the pattern's text spells it next to
// what is around it, so the texts are also read with each lookaround's texts in place (`inline`),
// for the "found", 3/4 and shared-run tests. Ordinary patterns (^\d+$, .*ok.*, ^[A-Z]{3}$,
// (?:ok|done)) spell no value, and pass. Writing the texts, decoding them, the spelling tests
// (each a pass over its spelling), spellsMost and sharesRun all spend from `work` (patternWork):
// "too costly" when it runs out, or when a value
// is over MATCH_INPUT_LIMIT, longer than a run tests. A spelling test is skipped when the
// spelling lacks a text every match of the pattern holds (couldMatch), so a broad pattern such as
// .*ok.* never runs on a long spelling it can't match.
function patternSecretIn(pattern, values, { budget = createRegexBudget(), work = patternWork(pattern, values) } = {}) {
  if (values.length === 0) return null;
  if (values.some((value) => String(value).length > MATCH_INPUT_LIMIT)) return "too costly";
  const spend = (steps) => spendWork(work, steps);
  try {
    const read = patternTexts(pattern, { work });
    const inPlace = read.lookaround ? patternTexts(pattern, { work, inline: true }) : read;
    const texts = [...new Set([...read.texts, ...inPlace.texts])];
    const found = [...texts, ...read.setAside].map((text) => secretIn(text, values, { budget: work }));
    const status = ["found", "too deep", "too costly"].find((candidate) => found.includes(candidate));
    if (status) return status;
    const spellings = patternSpellings(values);
    const every = [...new Set([...texts, ...read.setAside, ...inPlace.setAside])];
    if (holdsWhole(every, spellings, spend)) return "found";
    // The pattern as written: a value with regex syntax pasted as it is reads as other characters
    // once parsed.
    if (holdsWhole([pattern], [...spellings, ...regexEscaped(values)], spend)) return "found";
    const decoded = decodedHoldsWhole([...every, pattern], values, work);
    if (decoded) return decoded;
    const filter = patternTexts(pattern, { work, breaks: true });
    for (const spelling of spellings) {
      if (filter.exact && !couldMatch(filter, spelling, spend)) continue;
      spend(spelling.length);
      try {
        if (boundedMatch(pattern, spelling, budget)) return "matches";
      } catch (error) {
        if (isBoundedOut(error)) return error.code;
        throw error;
      }
    }
    if (read.backreference) return "backreference";
    for (const text of texts) {
      const gap = [...text].find(gapKind);
      if (gap === undefined) continue;
      // A text can spell at most its own characters' worth.
      const characters = [...text].filter((char) => !gapKind(char)).length;
      for (const spelling of spellings.filter((candidate) => candidate.length <= (4 / 3) * characters)) {
        spend(text.length * (spelling.length + 1));
        if (spellsMost(text, spelling)) return { around: gapKind(gap) };
      }
    }
    return sharesRun(every, spellings, spend) ? "shares" : null;
  } catch (error) {
    if (error === TOO_COSTLY) return "too costly";
    throw error;
  }
}

// The status that wins among secretIn results: "found", then "too deep", then "too costly".
const firstStatus = (found) => ["found", "too deep", "too costly"].find((status) => found.includes(status)) ?? null;

// Where secretIn finds one of `values` in a JSON value: in a key or leaf, or in the value as JSON,
// compact or indented (as the op file stores it), where a value spanning keys and values shows.
// That form escapes each string once more, so it is read to 9 levels. The calls share one budget,
// sized by the value as JSON. "found" wins over "too deep", and that over "too costly". With
// `anywhere`, a value under 8 characters is found wherever it stands too (see secretIn).
function jsonSecretIn(value, values, { budget = decodeBudget(JSON.stringify(value)?.length ?? 0), anywhere = false } = {}) {
  if (value === undefined) return null;
  const forms = [JSON.stringify(value), JSON.stringify(value, null, 2)];
  const found = [...valueTexts(value).map((text) => secretIn(text, values, { budget, anywhere })), ...forms.map((form) => secretIn(form, values, { levels: 9, budget, anywhere }))];
  return firstStatus(found);
}

// Where both --save checks find one of `values` in an assertion: jsonSecretIn on the assertion as
// the op file stores it, and in its path, its op and its value (each key and leaf, and the value
// as JSON), a value under 8 characters also next to other characters: output redaction masks a
// short value only where it stands alone, so as not to break up the words around it, but a saved
// assertion must hold no copy at all. surf's own keys (path, op, value) are not searched that way.
// The calls share one budget, sized by the assertion as JSON.
function assertionSecretIn(assertion, values) {
  const hasValue = Object.hasOwn(assertion, "value");
  const stored = { path: assertion.path, op: assertion.op, ...(hasValue ? { value: assertion.value } : {}) };
  const budget = decodeBudget(JSON.stringify(stored).length);
  return firstStatus([
    jsonSecretIn(stored, values, { budget }),
    ...[assertion.path, assertion.op].map((text) => secretIn(String(text), values, { budget, anywhere: true })),
    ...(hasValue ? [jsonSecretIn(assertion.value, values, { budget, anywhere: true })] : []),
  ]);
}

// Whether saving an assertion could store one of the run's env values: assertionSecretIn finds one
// in the assertion, so in its path, its op, its expected value or across them;
// its matches pattern could store or match one (patternSecretIn); or, for equals and matches (whose stored value is compared with the content), secretIn
// finds one in the full, untruncated actual value. Only the run knows every value, the browser
// host's own included; callers get the boolean alone. A pattern that runs too long against a
// value counts as matching it, and so does any pattern against a value over MATCH_INPUT_LIMIT,
// which a run would test only the start of.
function touchesSecret(assertion, found, secrets, budget) {
  if (secrets.length === 0) return false;
  if (assertionSecretIn(assertion, secrets)) return true;
  if ((assertion.op === "equals" || assertion.op === "matches") && jsonSecretIn(found, secrets)) return true;
  if (assertion.op !== "matches") return false;
  if (secrets.some((secret) => String(secret).length > MATCH_INPUT_LIMIT)) return true;
  return patternSecretIn(assertion.value, secrets, { budget }) !== null;
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

// MATCH_INPUT_LIMIT is bounded-regex.cjs's, exported here too for callers of boundedMatch.
module.exports = { ASSERTION_LIMIT, MATCH_INPUT_LIMIT, MATCH_SKIPPED, MATCH_TIMED_OUT, assertionSecretIn, boundedMatch, checkAssertions, createRegexBudget, jsonSecretIn, patternSecretIn, patternTexts, patternWork, spellsMost, validateAssertions, valueTexts };
