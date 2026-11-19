// surf hook <url> --goal "<text>" [--do '<steps>'] [--<input> <sample>]... [--match <url-part>]
// [--as <site>/<op>]: the browser host opens the URL, runs the steps, and makes, tests and saves
// the op (op-pipeline.cjs). Exit 0: a saved, tested op; 2: a weak pick, with the top requests and
// a rerun line; 1: an error or a write, with the draft.

const os = require("os");
const { resolveRequestDeadlineMs } = require("./host-sessions.cjs");
const { renderTemplate } = require("./op-run.cjs");
const { requestHost } = require("./playbook-cli.cjs");
const { parseDoCommands } = require("./workflow-definition.cjs");

const USAGE = "Usage: surf hook <url> --goal \"<text>\" [--do '<steps>'] [--<input> <sample>]... [--match <url-part>] [--as <site>/<op>]";
const OPTIONS = new Set(["goal", "do", "match", "as", "session", "tab-id"]);
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const quote = (text) => (/^[\w@%+=:,./{}-]+$/.test(text) ? text : `'${String(text).replace(/'/g, "'\\''")}'`);
const shell = (words) => words.map(quote).join(" ");

function parseHookArgs(argv) {
  const spec = { samples: {} };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      if (spec.url) throw new Error(USAGE);
      spec.url = arg;
      continue;
    }
    const name = arg.slice(2);
    if (name === "json" || name === "no-wait") {
      spec[name] = true;
      continue;
    }
    const value = argv[++index];
    if (value === undefined) throw new Error(`${arg} needs a value. ${USAGE}`);
    if (OPTIONS.has(name)) spec[name] = value;
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
  const steps = spec.do ? parseDoCommands(spec.do) : [];
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
  const inputs = Object.entries(result.args).map(([name, spec]) => `--${name} (${spec.required ? `required, sample ${spec.example}` : `default ${spec.default}`})`);
  const { extract, test } = result;
  const lines = [
    `picked   ${result.picked.method} ${result.picked.url}   ${result.picked.reasons.filter((reason) => /^(JSON|HTML|\d+ records)/.test(reason)).join(", ")}`,
    `inputs   ${inputs.join(" · ") || "none"}`,
    `extract  ${extract.in ? `${extract.in} ` : ""}${extract.records ?? "one record"} → ${Object.keys(extract.fields || {}).join(", ") || "the whole value"}`,
    ...(result.page ? [`paging   --pages: ${result.page.into} ${result.page.next}`] : []),
    `test     ${test.via} ✓ ${plural(test.count)}; ${test.fields.join(", ")} present`,
    `saved    ${result.file.replace(os.homedir(), "~")}`,
    `run      ${shell(result.run)}`,
    ...result.warnings.map((warning) => `Warning: ${warning}`),
  ];
  return { stdout: lines.join("\n"), stderr: "", exitCode: 0 };
}

async function handleHookCli(argv, { endpoint, session, sessionSource, admission } = {}) {
  const { spec, url, site, op, steps, typed } = parseHookArgs(argv.slice(1));
  const args = { url, template: spec.url, goal: spec.goal, steps, samples: spec.samples, typed, site, op, ...(spec.match === undefined ? {} : { match: spec.match }) };
  const result = await requestHost(endpoint, "playbook.hook", args, {
    tabId: spec["tab-id"],
    session: spec.session || session,
    sessionSource: spec.session ? "explicit" : sessionSource,
    admission: spec["no-wait"] ? { wait: false } : admission,
    timeoutMs: resolveRequestDeadlineMs("playbook.hook"),
  });
  if (spec.json) return { stdout: JSON.stringify(result, null, 2), stderr: "", exitCode: result.exitCode };
  const rerun = ["surf", "hook", spec.url, "--goal", spec.goal, ...(spec.do ? ["--do", spec.do] : []), ...Object.entries(spec.samples).flatMap(([name, value]) => [`--${name}`, value]), ...(spec.as ? ["--as", spec.as] : [])];
  return formatHook(result, rerun);
}

module.exports = { formatHook, handleHookCli };
