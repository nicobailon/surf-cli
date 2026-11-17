// surf pb test: run an op the way `surf use` does and check assertions on its result.

const { MATCH_INPUT_LIMIT, MATCH_SKIPPED, MATCH_TIMED_OUT, createRegexBudget, jsonSecretIn, patternSecretIn, validateAssertions } = require("./playbook-assertions.cjs");
const { assertionLine, decodeBudget, maskResult, redactResult, secretIn, spanningValues } = require("./redaction.cjs");
const { authInputs, resolveArgs } = require("./playbook-runtime.cjs");
const { editSavedOp, resolveEditablePlaybook, resolveOp } = require("./playbooks.cjs");

const USAGE =
  "Usage: surf pb test <playbook> <op> [--args <json> | --<input> <value>...] [--assert <path> <op> [value]]... [--strategy <using>] [--save] [--write] [--json]";
const VALUE_OPS = new Set(["equals", "array_min_len", "matches"]);
// Options of pb test itself; any other --name is an op input, as with surf use.
const FLAGS = new Set(["json", "save", "write", "allow-script", "no-wait", "pin-built-in"]);
const OPTIONS = new Set(["strategy", "args", "session", "tab-id"]);

function assertValue(op, text) {
  if (op === "array_min_len") return /^\d+$/.test(text) ? Number(text) : text;
  if (op !== "equals") return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** `pb test` arguments (after `test`). `assertions` is undefined when none were given. */
function parseTestArgs(argv) {
  const positional = [];
  const inputs = {};
  const options = {};
  let assertions;
  let json;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (name === "assert") {
      const [path, op] = [argv[index + 1], argv[index + 2]];
      if (path === undefined || op === undefined) throw new Error(`--assert needs <path> <op> [value]. ${USAGE}`);
      const assertion = { path, op };
      index += 2;
      if (VALUE_OPS.has(op)) {
        if (argv[index + 1] === undefined) throw new Error(`--assert ${path} ${op} needs a value`);
        assertion.value = assertValue(op, argv[++index]);
      }
      assertions = [...(assertions || []), assertion];
    } else if (FLAGS.has(name)) options[name === "allow-script" ? "allowScript" : name] = true;
    else {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      index++;
      if (name === "args") json = value;
      else if (OPTIONS.has(name)) options[name] = value;
      else inputs[name] = value;
    }
  }
  const [playbook, op] = positional;
  if (!playbook || !op || positional.length > 2) throw new Error(USAGE);
  let args = {};
  if (json !== undefined) {
    try {
      args = JSON.parse(json);
    } catch (error) {
      throw new Error(`--args must be a JSON object: ${error.message}`);
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("--args must be a JSON object");
  }
  if (assertions) {
    try {
      validateAssertions(assertions);
    } catch (error) {
      throw new Error(`--assert: ${error.message}`);
    }
  }
  return { playbook, op, args: { ...args, ...inputs }, ...(assertions ? { assertions } : {}), options };
}

/** The op as this machine sees it; undefined when it lives only on a remote browser host. */
function localOp(playbook, op, { cwd, home }) {
  try {
    return resolveOp(playbook, op, { cwd, home }).op;
  } catch (error) {
    if (/^(Playbook|Op) not found/.test(error.message)) return undefined;
    throw error;
  }
}

// pb test --save writes assertions to the op file, which must never hold an env header's value.
// Before the run: refuse when secretIn finds one in the assertion (its path, any key or leaf of
// its value, or the assertion as JSON, compact or indented as the op file stores it), or when a
// matches pattern could store or match one (patternSecretIn: a text the pattern can match holds
// one, the pattern matches one, which also refuses broad patterns such as .*, it has a
// backreference, it has more readings than the check lists, or it spells most of one around a
// class or ., its lookarounds read in place), or when that check runs out of work. secretIn decodes JSON escapes, so a value escaped any number of times, or written with \/
// or \uXXXX, is found; text escaped past its 8 levels is refused as too deep to check, and text
// too costly to decode as too large. A value over MATCH_INPUT_LIMIT is refused for any pattern: a
// run tests only its start. Errors name the assertion's position and the variable, never the
// value.
function refuseSecretAssertions(assertions, secret) {
  const budget = createRegexBudget();
  assertions.forEach((assertion, index) => {
    const position = `assertion ${index + 1}`;
    const refusals = {
      found: (name) => `${position} contains the value of ${name}, which is never stored; assert on something else`,
      "too deep": (name) => `${position} holds JSON escaped more than 8 times, too deep to check for ${name}; assert on something else`,
      "too costly": (name) => `${position} is too large to check for ${name}; assert on something else`,
    };
    for (const [name, raw] of Object.entries(secret)) {
      const found = jsonSecretIn(assertion, [raw]);
      if (found) throw new Error(`--save refused: ${refusals[found](name)}`);
    }
    if (assertion.op !== "matches") return;
    for (const [name, raw] of Object.entries(secret)) {
      if (raw.length > MATCH_INPUT_LIMIT) {
        throw new Error(`--save refused: the value of ${name} is over ${MATCH_INPUT_LIMIT / 1024} KB, too long to check ${position}'s pattern against; assert on something else`);
      }
      const found = patternSecretIn(assertion.value, [raw], { budget });
      if (found === null) continue;
      // Unchecked, the pattern could spell the value.
      if (found === "too costly") throw new Error(`--save refused: checking ${position}'s pattern against the value of ${name} takes more work than the check allows (the pattern can match too many or too long texts); simplify it`);
      if (Object.hasOwn(refusals, found)) throw new Error(`--save refused: ${refusals[found](name).replace(position, `${position}'s pattern`)}`);
      if (found === MATCH_SKIPPED) throw new Error(`--save refused: the 1 s regex budget was spent before ${position}'s pattern was checked against ${name}; use fewer or simpler patterns`);
      if (found === MATCH_TIMED_OUT) throw new Error(`--save refused: ${position}'s pattern took too long (over 100 ms) on the value of ${name}; simplify it`);
      if (found === "matches") throw new Error(`--save refused: ${position}'s pattern matches the value of ${name}, which is never stored; use a narrower pattern`);
      if (found === "too many readings") throw new Error(`--save refused: ${position}'s pattern has too many readings to check against ${name}; simplify it`);
      if (found === "backreference") throw new Error(`--save refused: ${position}'s pattern uses a backreference, which could repeat part of the value of ${name}; while env values are set, save a pattern without one`);
      throw new Error(`--save refused: ${position}'s pattern spells most of the value of ${name} around ${found.around}; assert on something else`);
    }
  });
}

// After the run: the host marks an assertion secretSensitive when it touched one of the run's env
// values (its own environment's included), judged on the full value before the preview is cut.
function refuseSecretSensitive(checked) {
  checked.forEach((assertion, index) => {
    if (assertion.secretSensitive === true) {
      throw new Error(`--save refused: assertion ${index + 1}'s value passed through env-header redaction, so it can't be saved`);
    }
  });
}

/**
 * Runs the test. `runOp(params)` runs the op on the browser host (playbook.run with test: true)
 * and resolves to its result, a failed run included.
 */
async function runPlaybookTest({ argv, cwd = process.cwd(), home, env = process.env, runOp, now = Date.now }) {
  const spec = parseTestArgs(argv);
  const { options } = spec;
  const op = localOp(spec.playbook, spec.op, { cwd, home });
  if (op?.effect === "write" && options.write !== true) throw new Error(`${spec.playbook} ${spec.op} is a write op; pb test runs it only with --write`);
  // The same input check as surf use, here so a typo is a usage error rather than a failed test.
  // The host checks again (and alone, when the op lives only on a remote browser host).
  if (op) resolveArgs(op, spec.args, { playbookId: spec.playbook });
  // As with surf use, --timeout (seconds) is the run's deadline, else the op's timeout default.
  const timeout = [Number(spec.args.timeout), Number(op?.args?.timeout?.default)].find((value) => Number.isFinite(value) && value > 0);
  if (options.save) {
    if (!spec.assertions) throw new Error("--save needs at least one --assert");
    // Fail before running: a built-in op can't take saved assertions.
    if (op) resolveEditablePlaybook(spec.playbook, { cwd, home });
  }
  // As with surf use, env-supplied headers are read from this shell and go with this one request; a
  // variable it doesn't set is left to the browser host's environment.
  const secret = {};
  for (const input of op ? authInputs(op) : []) if (env[input.env]) secret[input.env] = env[input.env];
  if (options.save) refuseSecretAssertions(spec.assertions, secret);
  const saved = op?.on?.success?.expect?.assert;
  const started = now();
  let result;
  try {
    result = await runOp({
      playbook: spec.playbook,
      op: spec.op,
      args: spec.args,
      ...(Object.keys(secret).length > 0 ? { secret } : {}),
      ...(timeout ? { timeout } : {}),
      ...(spec.assertions ? { assert: spec.assertions } : {}),
      ...(options.strategy ? { strategy: options.strategy } : {}),
      write: options.write === true,
      allowScript: options.allowScript === true,
    });
  } catch (error) {
    result = { status: "failed", error: error.message, attempts: [] };
  }
  // The host masked what its values touch; this masks what this shell's values touch.
  result = redactResult(result, Object.values(secret));
  const durationMs = now() - started;
  const ok = result.status === "completed";
  const attempts = result.attempts || [];
  const lastChecked = [...attempts].reverse().find((attempt) => attempt.assertions);
  let report = {
    ok,
    playbook: spec.playbook,
    op: spec.op,
    strategy: ok ? result.strategy : null,
    forced: options.strategy ?? null,
    records: ok && Array.isArray(result.value) ? result.value.length : null,
    durationMs,
    assertionSource: spec.assertions ? "cli" : saved ? "saved" : "none",
    assertions: (ok ? result.assertions : lastChecked?.assertions) || [],
    attempts,
    ...(ok ? {} : { error: result.error }),
    saved: null,
  };
  report = redactReport(report, Object.values(secret));
  if (options.save && ok) {
    refuseSecretSensitive(report.assertions);
    const edited = editSavedOp({
      playbook: spec.playbook,
      op: spec.op,
      cwd,
      home,
      edit: (raw) => ({
        ...raw,
        on: { ...raw.on, success: { ...raw.on?.success, expect: { ...raw.on?.success?.expect, assert: spec.assertions } } },
      }),
    });
    report.saved = edited.path;
  } else if (options.save) report.notSaved = "the test failed, so the assertions were not saved";
  return report;
}

// What pb test prints and --json sends, checked whole against this shell's values that can span
// two of its parts (spanningValues, as redactResult reads them): its header names the playbook, op
// and strategy next to the run's lines. On a hit the run's parts are masked (maskResult), so
// --save refuses them.
function redactReport(report, values) {
  const spanning = spanningValues(values);
  if (spanning.length === 0) return report;
  const forms = [formatTestReport(report), JSON.stringify(report), JSON.stringify(report, null, 2)];
  const budget = decodeBudget(forms.reduce((sum, form) => sum + form.length, 0));
  return forms.some((form) => secretIn(form, spanning, { levels: 9, budget, anyLength: true })) ? maskResult(report) : report;
}

function formatTestReport(report) {
  const answered = report.strategy ? `${report.strategy} answered` : "no strategy answered";
  const records = report.records === null ? "" : `, ${report.records} record${report.records === 1 ? "" : "s"}`;
  const lines = [`${report.ok ? "PASS" : "FAIL"} ${report.playbook} ${report.op}: ${answered}${records}, ${report.durationMs} ms`];
  for (const assertion of report.assertions) lines.push(`  ${assertionLine(assertion)}`);
  if (!report.ok) {
    for (const attempt of report.attempts) lines.push(`  ${attempt.using}: ${attempt.error}`);
    if (report.attempts.length === 0 && report.error) lines.push(`  ${report.error}`);
  }
  if (report.saved) lines.push(`Saved ${report.assertions.length} assertions in ${report.saved}`);
  if (report.notSaved) lines.push(`Not saved: ${report.notSaved}`);
  return lines.join("\n");
}

module.exports = { formatTestReport, parseTestArgs, runPlaybookTest };
