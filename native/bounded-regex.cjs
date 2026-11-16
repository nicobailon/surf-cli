// Bounded runs of regex patterns that come from op files, which pb export and pb import share, so a
// hostile pattern must not hang the host or the tab. Patterns are not analysed: one is refused only
// when it is over PATTERN_LIMIT characters or isn't a valid regex, and every run of one is bounded.
//
// In Node (the host, and a client pb client export writes) a run happens in a vm context with a
// timeout of MATCH_TIMEOUT_MS, which V8 interrupts even inside a backtracking regex, on at most the
// first MATCH_INPUT_LIMIT characters of the text. Runs spend from a budget; once it is spent, the
// rest don't run.
//
// In a tab (tabSource() injects this file) there is no vm, and nothing can interrupt a running
// regex. Runs get the same input limit and budget, checked between runs: a run is refused once the
// budget is spent, and a run that took over MATCH_TIMEOUT_MS or past the budget fails once it
// returns. So the regex time of one extract is at most its budget plus one run, and a single run
// that backtracks for good (such as (a+)+b on a long run of a's) still stalls the tab.

const PATTERN_LIMIT = 500;
const MATCH_TIMEOUT_MS = 100;
const MATCH_INPUT_LIMIT = 64 * 1024;
const MATCH_TIMED_OUT = "pattern_timeout";
const MATCH_SKIPPED = "pattern_skipped";
const CACHE_LIMIT = 1000;
// Field regexes in an extract need more runs than an op run's assertions (one per record), and a
// run in a vm costs about 0.25 ms, so an extract's budget is larger than an op run's 1 s.
const EXTRACT_REGEX_BUDGET_MS = 2000;

// tabSource() passes process as undefined, so a page's own process global can't select the vm path.
const vm = typeof process === "object" && process?.versions?.node ? require("node:vm") : null;

/** A regex time budget for one run of patterns (an op run's assertions, or one extract): pass it to every bounded run. */
function createRegexBudget({ ms, scope }) {
  return { remainingMs: ms, limitMs: ms, scope };
}

/** Refuses a pattern over PATTERN_LIMIT characters or that isn't a valid regex; `label` names it in the error. */
function checkPattern(pattern, label) {
  if (typeof pattern !== "string") throw new Error(`${label} must be a regex string`);
  if (pattern.length > PATTERN_LIMIT) throw new Error(`${label} is ${pattern.length} characters; the limit is ${PATTERN_LIMIT}`);
  try {
    new RegExp(pattern);
  } catch (error) {
    throw new Error(`${label} is not a valid regex: ${error.message}`);
  }
}

function skippedError(budget) {
  const error = new Error(`skipped: the ${budget.scope}'s ${budget.limitMs / 1000} s regex budget is spent`);
  error.code = MATCH_SKIPPED;
  return error;
}

function timedOutError(label) {
  const error = new Error(`${label} pattern took too long (over ${MATCH_TIMEOUT_MS} ms); simplify it`);
  error.code = MATCH_TIMED_OUT;
  return error;
}

function isBoundedOut(error) {
  return error?.code === MATCH_TIMED_OUT || error?.code === MATCH_SKIPPED;
}

let runInVm;
if (vm) {
  const context = vm.createContext({ cache: undefined, p: undefined, t: undefined, exec: undefined });
  vm.runInContext("cache = new Map();", context);
  // The result is a string or an array of strings and undefined, copied out of the context below.
  const script = new vm.Script(`(() => {
  let regex = cache.get(p);
  if (!regex) {
    if (cache.size >= ${CACHE_LIMIT}) cache.clear();
    regex = new RegExp(p);
    cache.set(p, regex);
  }
  return exec ? regex.exec(t) : regex.test(t) === true;
})()`);
  runInVm = ({ pattern, text, exec, timeoutMs }) => {
    context.p = pattern;
    context.t = text;
    context.exec = exec;
    try {
      return script.runInContext(context, { timeout: timeoutMs });
    } finally {
      context.p = undefined;
      context.t = undefined;
    }
  };
}

const tabCache = new Map();
function runInTab({ pattern, text, exec }) {
  let regex = tabCache.get(pattern);
  if (!regex) {
    if (tabCache.size >= CACHE_LIMIT) tabCache.clear();
    regex = new RegExp(pattern);
    tabCache.set(pattern, regex);
  }
  return exec ? regex.exec(text) : regex.test(text);
}

function boundedRun({ pattern, text, budget, label, exec }) {
  checkPattern(pattern, label);
  if (budget.remainingMs <= 0) throw skippedError(budget);
  const limit = Math.max(1, Math.min(MATCH_TIMEOUT_MS, Math.floor(budget.remainingMs)));
  const input = String(text).slice(0, MATCH_INPUT_LIMIT);
  const started = performance.now();
  let elapsed;
  let result;
  try {
    result = runInVm ? runInVm({ pattern, text: input, exec, timeoutMs: limit }) : runInTab({ pattern, text: input, exec });
  } catch (error) {
    if (error?.code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") throw error;
    throw limit < MATCH_TIMEOUT_MS ? skippedError(budget) : timedOutError(label);
  } finally {
    elapsed = performance.now() - started;
    budget.remainingMs -= elapsed;
  }
  // In a tab nothing could stop the run, so a run past what the vm allows fails once it returns.
  if (!runInVm && elapsed > limit) throw limit < MATCH_TIMEOUT_MS ? skippedError(budget) : timedOutError(label);
  return exec && result !== null ? Array.from(result) : result;
}

/**
 * The match of `pattern` (no flags) in the first MATCH_INPUT_LIMIT characters of `text`, as an
 * array of the match and its groups, or null; spends from `budget`. A run past MATCH_TIMEOUT_MS
 * throws code "pattern_timeout"; a run the budget can't cover throws code "pattern_skipped".
 */
function boundedExec({ pattern, text, budget, label }) {
  return boundedRun({ pattern, text, budget, label, exec: true });
}

/** Whether `pattern` matches, bounded as boundedExec is. */
function boundedTest({ pattern, text, budget, label }) {
  return boundedRun({ pattern, text, budget, label, exec: false });
}

/** Page source that defines `boundedRegex`, this module as it runs in a tab. Call it on the host. */
function tabSource() {
  const source = require("node:fs").readFileSync(__filename, "utf8");
  return `const boundedRegex = (() => {
const module = { exports: {} };
(function (module, exports, require, process) {
${source}
})(module, module.exports, () => ({}), undefined);
return module.exports;
})();`;
}

module.exports = {
  EXTRACT_REGEX_BUDGET_MS,
  MATCH_SKIPPED,
  MATCH_TIMED_OUT,
  PATTERN_LIMIT,
  boundedExec,
  boundedTest,
  checkPattern,
  createRegexBudget,
  isBoundedOut,
  tabSource,
};
