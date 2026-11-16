// Bounded runs of regex patterns that come from op files, which pb export and pb import share, so a
// hostile pattern must not hang the host or the tab. Patterns are not analysed: one is refused only
// when it is over PATTERN_LIMIT characters or isn't a valid regex, and every run of one is bounded.
//
// In Node (the host, and a client pb client export writes) a run happens in a vm context with a
// timeout of MATCH_TIMEOUT_MS, which V8 interrupts even inside a backtracking regex, on at most the
// first MATCH_INPUT_LIMIT characters of the text. Runs spend from a budget; once it is spent, the
// rest don't run.
//
// In a tab (tabSource() injects this file) a regex can't run on the page's own thread, where
// nothing could stop it. An extract runs through tabExtract: it reads the page once into a
// snapshot, then builds the result from that snapshot in two passes. The first collects every
// pattern and text the extract needs without running any, then each runs in a Web Worker (one per
// extract, reused) that is terminated after MATCH_TIMEOUT_MS, and the second pass builds the result
// from the answers. When the page won't start a worker (a Content-Security-Policy without blob:
// workers, or Trusted Types), the tab hands the patterns and texts to the host, which runs them in
// its vm and calls finishTabExtract's script to complete the extract.

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

/** A budget for one op run's field match patterns, shared by its strategies, rounds and pages. */
function createFieldRegexBudget() {
  return createRegexBudget({ ms: EXTRACT_REGEX_BUDGET_MS, scope: "run" });
}

/** Page source for `regexBudget`, what is left of `budget`; finishTabExtract charges what the tab spends. */
function tabBudgetSource(budget) {
  return `const regexBudget = ${JSON.stringify({ remainingMs: budget.remainingMs, limitMs: budget.limitMs, scope: budget.scope })};`;
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

function boundedRun({ pattern, text, budget, label, exec }) {
  checkPattern(pattern, label);
  if (budget.remainingMs <= 0) throw skippedError(budget);
  const limit = Math.max(1, Math.min(MATCH_TIMEOUT_MS, Math.floor(budget.remainingMs)));
  const input = String(text).slice(0, MATCH_INPUT_LIMIT);
  const started = performance.now();
  let result;
  try {
    result = runInVm({ pattern, text: input, exec, timeoutMs: limit });
  } catch (error) {
    if (error?.code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") throw error;
    throw limit < MATCH_TIMEOUT_MS ? skippedError(budget) : timedOutError(label);
  } finally {
    budget.remainingMs -= performance.now() - started;
  }
  return exec && result !== null ? Array.from(result) : result;
}

// In a tab, the pass of tabExtract that is running: it answers boundedExec.
let tabRunner;

function withTabRunner(runner, extract) {
  tabRunner = runner;
  try {
    return extract();
  } finally {
    tabRunner = undefined;
  }
}

/**
 * The match of `pattern` (no flags) in the first MATCH_INPUT_LIMIT characters of `text`, as an
 * array of the match and its groups, or null; spends from `budget`. A run past MATCH_TIMEOUT_MS
 * throws code "pattern_timeout"; a run the budget can't cover throws code "pattern_skipped".
 */
function boundedExec({ pattern, text, budget, label }) {
  if (runInVm) return boundedRun({ pattern, text, budget, label, exec: true });
  if (!tabRunner) throw new Error("in a tab, a pattern runs only inside tabExtract");
  checkPattern(pattern, label);
  return tabRunner({ pattern, text: String(text).slice(0, MATCH_INPUT_LIMIT), label });
}

/** Whether `pattern` matches, bounded as boundedExec is (on the host only). */
function boundedTest({ pattern, text, budget, label }) {
  return boundedRun({ pattern, text, budget, label, exec: false });
}

// --- In a tab -------------------------------------------------------------------------------------

const WORKER_SOURCE = `const cache = new Map();
onmessage = ({ data }) => {
  if (data === "ping") return postMessage("pong");
  let regex = cache.get(data.pattern);
  if (!regex) {
    regex = new RegExp(data.pattern);
    cache.set(data.pattern, regex);
  }
  const match = regex.exec(data.text);
  postMessage({ match: match === null ? null : Array.from(match) });
};`;
// Starting a worker takes a few milliseconds; one that hasn't answered by then counts as blocked.
const WORKER_START_MS = 2000;
const TIMED_OUT = Symbol("timed out");
// What a tab script returns is pretty-printed JSON, cut at TAB_OUTPUT_LIMIT characters by the
// extension; OUTPUT_ROOM of it is kept for regexSpentMs.
const TAB_OUTPUT_LIMIT = 50000;
const OUTPUT_ROOM = 64;
/** What a tab script's own result may take, leaving room for regexSpentMs. */
const RESULT_LIMIT = TAB_OUTPUT_LIMIT - OUTPUT_ROOM;
const STASH = Symbol.for("surf.boundedRegex.extracts");
const STASH_MS = 60000;

// JSON keeps the two strings apart: no pattern and text pair can join into another's key.
function pairKey(pattern, text) {
  return JSON.stringify([pattern, text]);
}

/** A worker that answered a ping, or null when the page won't start one. */
function startWorker() {
  return new Promise((resolve) => {
    let worker;
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (value === null) worker?.terminate();
      resolve(value);
    };
    const timer = setTimeout(() => settle(null), WORKER_START_MS);
    try {
      const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
      try {
        worker = new Worker(url);
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), WORKER_START_MS);
      }
    } catch {
      settle(null);
      return;
    }
    worker.onmessage = () => settle(worker);
    worker.onerror = () => settle(null);
    worker.postMessage("ping");
  });
}

function askWorker(worker, job, limitMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), limitMs);
    worker.onmessage = ({ data }) => {
      clearTimeout(timer);
      resolve(data);
    };
    worker.onerror = (event) => {
      clearTimeout(timer);
      resolve({ error: event.message || "the pattern failed" });
    };
    worker.postMessage(job);
  });
}

/** Each pair's match, run in `worker` with MATCH_TIMEOUT_MS a run, spending from `budget`. */
async function matchInWorker(worker, pairs, budget) {
  const matches = [];
  try {
    for (const { pattern, text, label } of pairs) {
      if (budget.remainingMs <= 0) throw skippedError(budget);
      const limit = Math.max(1, Math.min(MATCH_TIMEOUT_MS, Math.floor(budget.remainingMs)));
      const started = performance.now();
      const reply = await askWorker(worker, { pattern, text }, limit);
      const elapsed = performance.now() - started;
      budget.remainingMs -= elapsed;
      if (reply === TIMED_OUT || elapsed > limit) throw limit < MATCH_TIMEOUT_MS ? skippedError(budget) : timedOutError(label);
      if (reply.error) throw new Error(`${label}: ${reply.error}`);
      matches.push(reply.match);
    }
  } finally {
    worker.terminate();
  }
  return matches;
}

function extractWith(extract, snapshot, pairs, matches) {
  const found = new Map(pairs.map((pair, index) => [pairKey(pair.pattern, pair.text), matches[index]]));
  return withTabRunner(({ pattern, text }) => {
    const key = pairKey(pattern, text);
    if (!found.has(key)) throw new Error("the extract asked for a pattern its first pass didn't");
    return found.get(key);
  }, () => extract(snapshot));
}

function stashCall(key, run) {
  if (!globalThis[STASH]) Object.defineProperty(globalThis, STASH, { value: new Map() });
  globalThis[STASH].set(key, run);
  setTimeout(() => globalThis[STASH].delete(key), STASH_MS);
}

// A match crosses from the host as JSON, which has no undefined: its strings and the indexes of
// its unmatched groups.
function encodeMatches(matches) {
  return matches.map((match) =>
    match === null ? null : { values: match.map((value) => value ?? ""), unmatched: match.flatMap((value, index) => (value === undefined ? [index] : [])) },
  );
}

function decodeMatches(sent) {
  return sent.map((match) => (match === null ? null : match.values.map((value, index) => (match.unmatched.includes(index) ? undefined : value))));
}

/**
 * Reads the page once with `read()` and builds the result with `extract(snapshot)` (synchronous,
 * without reading the page; its patterns go through boundedExec), giving `onValue(result)`, or
 * `onError(error)` when it throws or a pattern fails.
 *
 * When the extract needs patterns, the tab script returns { regexPending: { key } } after the first
 * pass, and the host runs them with a second script of their own (runTabScript), which it times:
 * a page can rewrite what the tab reports, but not make that call look shorter. That second script
 * resolves to the result with `regexSpentMs`, or, when the page won't start a worker, to
 * { regexNeeded: { key, pairs } }: the host runs the pairs and completes it with finishTabExtract.
 */
async function tabExtract({ read = () => undefined, extract, budget, onValue, onError }) {
  // The whole output must fit what the tab can send; one that doesn't could not be read.
  const fit = (value) => {
    const size = JSON.stringify(value, null, 2).length;
    if (size <= TAB_OUTPUT_LIMIT) return value;
    return onError(new Error(`the tab's result is ${size} characters, more than the ${TAB_OUTPUT_LIMIT} it can send to Surf; narrow the fields`));
  };
  const finish = (run) => {
    try {
      return onValue(run());
    } catch (error) {
      return onError(error);
    }
  };
  let snapshot;
  let pairs;
  try {
    // Both passes build from this snapshot, so a page that changes meanwhile can't split them.
    snapshot = read();
    const wanted = new Map();
    const first = withTabRunner(({ pattern, text, label }) => {
      const key = pairKey(pattern, text);
      if (!wanted.has(key)) wanted.set(key, { pattern, text, label });
      return null;
    }, () => extract(snapshot));
    // Without patterns, the first pass is the result.
    if (wanted.size === 0) return fit(finish(() => first));
    pairs = [...wanted.values()];
  } catch (error) {
    return fit(onError(error));
  }
  const pending = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  stashCall(pending, async () => {
    const startMs = budget.remainingMs;
    const spent = (value) => {
      const out = { ...value, regexSpentMs: Math.ceil(Math.max(0, startMs - budget.remainingMs)) };
      const sent = fit(out);
      return sent === out ? out : { ...sent, regexSpentMs: out.regexSpentMs };
    };
    try {
      const worker = await startWorker();
      if (worker) {
        const matches = await matchInWorker(worker, pairs, budget);
        return spent(finish(() => extractWith(extract, snapshot, pairs, matches)));
      }
      const key = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
      // Measured as sent: escaping can double a text's length.
      const size = JSON.stringify({ regexNeeded: { key, pairs } }, null, 2).length;
      if (size > TAB_OUTPUT_LIMIT - OUTPUT_ROOM) {
        throw new Error(
          `this page blocks the Web Worker that match patterns run in (its Content-Security-Policy or Trusted Types), and the texts to match come to ${size} characters as JSON, more than the ${TAB_OUTPUT_LIMIT} the tab can send to Surf; narrow the fields that use match`,
        );
      }
      stashCall(key, (sent) => fit(finish(() => extractWith(extract, snapshot, pairs, decodeMatches(sent)))));
      return spent({ regexNeeded: { key, pairs } });
    } catch (error) {
      return spent(onError(error));
    }
  });
  return { regexPending: { key: pending } };
}

// --- On the host ----------------------------------------------------------------------------------

/** The script that calls what the tab stashed under `key`, with `argument` (JSON) if given. */
function stashCallScript(key, argument) {
  return `(async () => {
const run = globalThis[Symbol.for("surf.boundedRegex.extracts")]?.get(${JSON.stringify(key)});
if (!run) throw new Error("the tab no longer holds this extract (it navigated or took over a minute); run it again");
globalThis[Symbol.for("surf.boundedRegex.extracts")].delete(${JSON.stringify(key)});
return run(${argument === undefined ? "" : JSON.stringify(argument)});
})()`;
}

/**
 * Charges `budget` for a tab call that ran patterns: what the tab reported, when it is a number from
 * 0 to the allowance the call had, else the whole allowance; and never less than the `observedMs`
 * the host timed the call at. The budget never grows.
 */
function chargeTab({ budget, allowanceMs, reported, observedMs }) {
  const valid = typeof reported === "number" && Number.isFinite(reported) && reported >= 0 && reported <= allowanceMs;
  budget.remainingMs -= Math.max(valid ? reported : allowanceMs, Number.isFinite(observedMs) ? Math.max(0, observedMs) : allowanceMs);
}

/**
 * Runs a tab script made by `script(budget)`, which gives the tab what is left of `budget`, with
 * `execute(code)` (javascript_tool). When the tab has patterns to run, a second call runs them,
 * timed with `now()` and charged by chargeTab; the first call (reading the page, fetching) runs
 * none and is charged nothing, so a script without patterns, such as a plain network request,
 * leaves the budget as it was. Then finishTabExtract completes it. An output that isn't JSON (cut
 * at the tab's limit, say) throws `unreadable(size)`; from the pattern call it is first charged the
 * whole allowance.
 */
async function runTabScript({ budget, script, execute, unreadable, now = () => performance.now() }) {
  // `onUnreadable` runs before an output that isn't JSON throws.
  const read = async (code, onUnreadable = () => {}) => {
    const response = await execute(code);
    if (response?.error) throw new Error(typeof response.error === "string" ? response.error : JSON.stringify(response.error));
    if (typeof response?.output !== "string") return response?.value ?? response;
    try {
      return JSON.parse(response.output);
    } catch {
      onUnreadable();
      throw unreadable(response.output.length);
    }
  };
  let result = await read(script(budget));
  if (result?.regexPending) {
    const allowanceMs = Math.max(0, budget.remainingMs);
    const started = now();
    const charge = (reported) => chargeTab({ budget, allowanceMs, reported, observedMs: now() - started });
    result = await read(stashCallScript(result.regexPending.key), () => charge(undefined));
    charge(result?.regexSpentMs);
  }
  return finishTabExtract({ result, budget, runScript: read });
}

/**
 * Completes a tab script's result: when the tab handed its patterns over (regexNeeded), runs them
 * here, spending from `budget`, and returns what `runScript(code)` gives for the script that
 * finishes the extract in the tab. A pattern that fails here throws.
 */
async function finishTabExtract({ result, budget, runScript }) {
  if (!result?.regexNeeded) return result;
  const { key, pairs } = result.regexNeeded;
  const matches = pairs.map(({ pattern, text, label }) => boundedExec({ pattern, text, budget, label }));
  return runScript(stashCallScript(key, encodeMatches(matches)));
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
  MATCH_INPUT_LIMIT,
  MATCH_SKIPPED,
  MATCH_TIMED_OUT,
  PATTERN_LIMIT,
  RESULT_LIMIT,
  TAB_OUTPUT_LIMIT,
  boundedExec,
  boundedTest,
  checkPattern,
  createFieldRegexBudget,
  createRegexBudget,
  finishTabExtract,
  isBoundedOut,
  runTabScript,
  stashCallScript,
  tabBudgetSource,
  tabExtract,
  tabSource,
};
