// surf hook <url> --goal "<text>" [--do '<steps>'] [--<input> <sample>]... [--match <url-part>]
// [--as <site>/<op>] [--dry-run] [--keep-body]: the browser host opens the URL, runs the steps, and makes, tests and saves
// the op (op-pipeline.cjs). Exit 0: a saved, tested op; 2: a weak pick, with the top requests and
// a rerun line; 1: an error, with the draft. A write is saved untested. --dry-run does it all but
// write the op file, and prints the op instead. --keep-body saves a body that still holds a
// secret-looking key with a literal value, which is refused without it.

const os = require("os");
const path = require("path");
const { GLOBAL_OPTIONS } = require("./global-options.cjs");
const { resolveRequestDeadlineMs } = require("./host-sessions.cjs");
const { isSecret } = require("./op-inputs.cjs");
const { renderTemplate } = require("./op-run.cjs");
const { requestHost } = require("./playbook-cli.cjs");
const { resolveOp } = require("./playbooks.cjs");
const { parseDoCommands } = require("./workflow-definition.cjs");

const USAGE = "Usage: surf hook <url> --goal \"<text>\" [--do '<steps>'] [--<input> <sample>]... [--match <url-part>] [--as <site>/<op>] [--dry-run] [--keep-body]";
const OPTIONS = new Set(["goal", "do", "match", "as"]);
// surf hook's flags with no value, and the global options (`--session`, `--json`…), which are no inputs.
const FLAGS = new Set(["dry-run", "keep-body", ...GLOBAL_OPTIONS.filter((option) => !option.value).map((option) => option.name)]);
const GLOBAL_VALUES = new Set(GLOBAL_OPTIONS.filter((option) => option.value).map((option) => option.name));
// surf use's own options: a mistake here, refused before any request, unless the URL or a --do step
// writes {{name}}, or the op --as names declares the input (surf's own `Rebuild it:` line).
const USE_OPTIONS = new Set(["format", "fields", "where", "limit", "pages", "each", "delay-ms", "url", "timeout", "write", "repeat", "retry-attempt", "override-in-doubt", "pin-built-in", "allow-script", "no-repair"]);
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const quote = (text) => (/^[\w@%+=:,./{}-]+$/.test(text) ? text : `'${String(text).replace(/'/g, "'\\''")}'`);
const shell = (words) => words.map(quote).join(" ");

// The inputs of the op `--as` names, read without changing it; none when it doesn't load.
function declaredInputs(argv, cwd) {
  const at = argv.indexOf("--as");
  if (at < 0) return [];
  try {
    const [site, op] = String(argv[at + 1]).split("/");
    return Object.keys(resolveOp(site, op, { cwd }).op.args || {});
  } catch {
    return [];
  }
}

function parseHookArgs(argv, { cwd = process.cwd() } = {}) {
  const spec = { samples: {} };
  let declared;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      if (spec.url) throw new Error(USAGE);
      spec.url = arg;
      continue;
    }
    const name = arg.slice(2);
    if (USE_OPTIONS.has(name) && !argv.some((word) => word.includes(`{{${name}}}`)) && !(declared ??= declaredInputs(argv, cwd)).includes(name)) {
      throw new Error(`${arg} is a surf use option, not a surf hook one: give it to surf use when you run the saved op. surf hook takes --goal, --do, --match, --as, --dry-run, --keep-body, --json and --<input> <sample>. An input named ${name} needs {{${name}}} in the URL or a --do step; a sample under another name works too (--per_page 20).`);
    }
    if (FLAGS.has(name)) {
      spec[name] = true;
      continue;
    }
    const value = argv[++index];
    if (value === undefined) throw new Error(`${arg} needs a value. ${USAGE}`);
    if (OPTIONS.has(name) || GLOBAL_VALUES.has(name)) spec[name] = value;
    else if (ID.test(name)) spec.samples[name] = value;
    else throw new Error(`--${name}: an input name uses lowercase letters, numbers, dot, underscore or hyphen. ${USAGE}`);
  }
  if (!spec.url || !spec.goal) throw new Error(USAGE);
  for (const [, name] of `${spec.url} ${spec.do || ""}`.matchAll(/\{\{([a-zA-Z0-9._-]+)\}\}/g)) {
    if (spec.samples[name] === undefined) throw new Error(`{{${name}}} needs this run's value: add --${name} <sample>`);
  }
  const url = renderTemplate(spec.url, { args: spec.samples, env: null, encode: encodeURIComponent });
  if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) throw new Error(`surf hook takes an http or https URL, not ${spec.url}`);
  const [site, op] = spec.as ? spec.as.split("/") : [new URL(url).hostname.replace(/^www\./, ""), `get_${spec.goal.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(0, 3).join("_") || "data"}`];
  if (!ID.test(site || "") || !ID.test(op || "")) throw new Error(`--as needs <site>/<op> in lowercase letters, numbers, dot, underscore or hyphen (got ${spec.as})`);
  const steps = spec.do ? parseDoCommands(spec.do, { step: "--do step" }) : [];
  // A value typed or picked as written (not an {{input}}) becomes an input named after where it lands.
  const typed = steps.flatMap((step) => [step.args?.text, step.args?.value, step.args?.values].flat()).filter((value) => typeof value === "string" && value && !value.includes("{{"));
  return { spec, url, site, op, steps: renderTemplate(steps, { args: spec.samples, env: null }), typed };
}

const plural = (count) => (count === null ? "1 record" : `${count} record${count === 1 ? "" : "s"}`);

/** A pipeline result as text: { stdout, stderr, exitCode }. `rerun` is the command to pick again, without --match. */
function formatHook(result, rerun) {
  if (result.status === "error") return { stdout: result.draft ? JSON.stringify(result.draft, null, 2) : "", stderr: `Error: ${result.error}`, exitCode: 1 };
  if (result.status === "weak") {
    const lines = [`weak pick: ${result.reason}`];
    result.candidates.forEach((candidate, index) => lines.push(`${index + 1}. ${candidate.method} ${candidate.url}   score ${candidate.score}   ${candidate.reasons.join(", ")}`));
    lines.push(`rerun    ${shell([...rerun, "--match", result.match])}`, "         (or --match a part of the URL of the request that holds the data)");
    return { stdout: lines.join("\n"), stderr: "", exitCode: 2 };
  }
  const sample = (spec) => (spec.example === undefined ? "required" : `required, sample ${spec.example}`);
  const inputs = Object.entries(result.args).map(([name, spec]) => `--${name} (${spec.required ? sample(spec) : `default ${spec.default}`})`);
  const { extract, test } = result;
  const lines = [
    `picked   ${result.picked.method} ${result.picked.url}   ${result.picked.reasons.filter((reason) => /^(JSON|HTML|\d+ records)/.test(reason)).join(", ")}`,
    `inputs   ${inputs.join(" · ") || "none"}`,
    `extract  ${extract ? `${extract.in ? `${extract.in} ` : ""}${extract.records ?? "one record"} → ${Object.keys(extract.fields || {}).join(", ") || "the whole value"}` : "none: the response as it comes"}`,
    ...(result.page ? [`paging   --pages: ${result.page.into} ${result.page.next}`] : []),
    `test     ${test ? `${test.via} ✓ ${plural(test.count)}; ${test.fields.join(", ")} present` : `not run: ${result.sentBy === "do" ? "the --do steps" : "the page"} sent it once; surf hook sends nothing more (surf use … --write sends it again; within 5 min, add --repeat)`}`,
  ];
  const file = result.file.replace(os.homedir(), "~");
  const bak = `${path.basename(file)}.bak`;
  if (result.status === "dry-run") lines.push(`saved    nothing (--dry-run); the op would ${result.replaced ? "replace" : "go to"} ${file}${result.overwritesBak ? ` (the older ${bak} would be overwritten)` : ""}`);
  else lines.push(`saved    ${file}`, ...(result.replaced ? [`replaced ${result.playbook} ${path.basename(file, ".json")} (the old op is ${bak}${result.overwritesBak ? "; the older .bak is overwritten" : ""})`] : []), `run      ${shell(result.run)}`);
  lines.push(...result.warnings.map((warning) => `Warning: ${warning}`));
  if (result.status === "dry-run") lines.push("op       as surf hook would save it:", JSON.stringify(result.draft, null, 2));
  return { stdout: lines.join("\n"), stderr: "", exitCode: 0 };
}

async function handleHookCli(argv, { endpoint, session, sessionSource, admission } = {}) {
  const { spec, url, site, op, steps, typed } = parseHookArgs(argv.slice(1));
  const args = { url, template: spec.url, goal: spec.goal, steps, samples: spec.samples, typed, site, op, dryRun: spec["dry-run"] === true, keepBody: spec["keep-body"] === true, ...(spec.do ? { do: spec.do } : {}), ...(spec.match === undefined ? {} : { match: spec.match }) };
  const result = await requestHost(endpoint, "playbook.hook", args, {
    tabId: spec["tab-id"],
    session: spec.session || session,
    sessionSource: spec.session ? "explicit" : sessionSource,
    admission: spec["no-wait"] ? { wait: false } : admission,
    timeoutMs: resolveRequestDeadlineMs("playbook.hook"),
  });
  if (spec.json) return { stdout: JSON.stringify(result, null, 2), stderr: "", exitCode: result.exitCode };
  const rerun = ["surf", "hook", spec.url, "--goal", spec.goal, ...(spec.do ? ["--do", spec.do] : []), ...Object.entries(spec.samples).flatMap(([name, value]) => [`--${name}`, isSecret(name) ? `<${name}>` : value]), ...(spec.as ? ["--as", spec.as] : []), ...(spec["dry-run"] ? ["--dry-run"] : []), ...(spec["keep-body"] ? ["--keep-body"] : [])];
  return formatHook(result, rerun);
}

module.exports = { formatHook, handleHookCli, parseHookArgs, shell };
