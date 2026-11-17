const path = require("path");
const { loadUserConfig } = require("./config.cjs");
const { openClientTransport } = require("./client-transport.cjs");
const { resolveRequestDeadlineMs } = require("./host-sessions.cjs");
const { exportRecordHar, saveFromRecent, saveFromRecord, suggestions } = require("./playbook-authoring.cjs");
const { deriveClient, exportClient, verifyClient } = require("./playbook-client.cjs");
const { formatCandidates } = require("./record-candidates.cjs");
const { RESERVED_RUN_OPTIONS, applyParam, formatParamResult } = require("./playbook-param.cjs");
const { assertAttemptId } = require("./playbook-receipts.cjs");
const { authInputs } = require("./playbook-runtime.cjs");
const { parseEachFrom } = require("./chain-runtime.cjs");
const { formatExtractResult, parseExtractArgs, saveExtract } = require("./playbook-extract.cjs");
const { formatTestReport, runPlaybookTest } = require("./playbook-test.cjs");
const { redactResult } = require("./redaction.cjs");
const { exportPlaybookDirectory, importPlaybookDirectory, listPlaybooks, resolvePlaybook } = require("./playbooks.cjs");

// `raw` keeps each option's text: `--id 2101.10010` is a number in `options`, a string in `raw`.
function parseCommandArgs(argv) {
  const positional = [];
  const options = {};
  const raw = {};
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const name = value.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      options[name] = /^-?\d+(?:\.\d+)?$/.test(next) ? Number(next) : next;
      raw[name] = next;
      index++;
    } else options[name] = true;
  }
  return { positional, options, raw };
}

const PARAM_FLAGS = new Set(["required", "json"]);
const PARAM_VALUES = new Set(["as", "env", "default", "desc", "value", "link"]);

// pb param's options are known, so a field may follow a flag (`--required query.q`).
function parseParamArgs(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const name = token.slice(2);
    if (PARAM_FLAGS.has(name)) options[name] = true;
    else if (PARAM_VALUES.has(name)) {
      if (argv[index + 1] === undefined) throw new Error(`--${name} needs a value`);
      options[name] = argv[++index];
    } else throw new Error(`pb param has no --${name} option`);
  }
  const [playbook, op, ...fields] = positional;
  if (!playbook || !op) throw new Error("Usage: surf pb param <playbook> <op> <field>... --as <name> [--required | --default <v>] [--desc <text>] [--value <text>] [--link <input>], or <field> --env <VAR>");
  return { playbook, op, fields, options };
}

// --include-input-values (or --raw), on the command line only. pb record start also reads
// includeInputValues from the user's own ~/surf.json, never a project's.
const keepsInputValues = (options) => options["include-input-values"] === true || options.raw === true;

function unwrapResponse(response) {
  if (response.error) throw new Error(response.error.content?.[0]?.text || JSON.stringify(response.error));
  const text = response.result?.content?.[0]?.text;
  if (text === undefined) return response.result;
  try { return JSON.parse(text); } catch { return text; }
}

async function requestHost(endpoint, tool, args, options = {}) {
  const transport = await openClientTransport(endpoint, { requestTimeoutMs: options.timeoutMs || 11 * 60 * 1000 });
  try {
    const request = { type: "tool_request", method: "execute_tool", params: { tool, args }, id: `playbook-${Date.now()}-${Math.random()}` };
    if (options.tabId) request.tabId = options.tabId;
    if (options.session) {
      request.session = options.session;
      request.sessionSource = options.sessionSource || "environment";
    }
    if (options.admission) request.admission = options.admission;
    return unwrapResponse(await transport.request(request, options.timeoutMs || 11 * 60 * 1000));
  } finally {
    await transport.close();
  }
}

function runSpec(argv) {
  const direct = argv[0] === "use";
  const offset = direct ? 1 : 2;
  const parsed = parseCommandArgs(argv.slice(offset));
  const [playbook, op] = parsed.positional;
  if (!playbook || !op) throw new Error(direct ? "Usage: surf use <playbook> <op> [--arg value]" : "Usage: surf pb run <playbook> <op> [--arg value]");
  const args = Object.fromEntries(Object.entries(parsed.options).filter(([name]) => !RESERVED_RUN_OPTIONS.has(name)));
  const eachFrom = eachFromSpec(parsed.options);
  // With --each-from, --limit and --delay-ms bound its each, so they are no op inputs.
  if (eachFrom) for (const name of ["limit", "delay-ms"]) delete args[name];
  return { playbook, op, args, raw: parsed.raw, options: parsed.options, ...(eachFrom ? { eachFrom } : {}) };
}

// --each-from <list-op>[:<path>][@path.<n>], with --each-into, --limit and --delay-ms.
function eachFromSpec(options) {
  if (options["each-from"] === undefined) {
    if (options["each-into"] !== undefined) throw new Error("--each-into goes with --each-from");
    return undefined;
  }
  if (typeof options["each-from"] !== "string") throw new Error("--each-from needs <list-op>:<path>, such as list_postings:id");
  if (options["each-into"] !== undefined && typeof options["each-into"] !== "string") throw new Error("--each-into needs an input name");
  return {
    ...parseEachFrom(options["each-from"]),
    ...(options["each-into"] !== undefined ? { into: options["each-into"] } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    ...(options["delay-ms"] !== undefined ? { delayMs: options["delay-ms"] } : {}),
  };
}

function resolveLocalOp(spec, cwd) {
  try {
    const playbook = resolvePlaybook(spec.playbook, { cwd, pinBuiltIn: spec.options["pin-built-in"] === true });
    const op = playbook.ops.get(spec.op);
    return op ? { playbook, op } : undefined;
  } catch {
    return undefined;
  }
}

// String inputs keep the text as typed. Env-supplied headers are read here, from the caller's
// shell, and go to the host with this one request (in `secret`, a name redaction hides). With
// --each-from the list op's inputs count too.
function prepareRun(spec, cwd) {
  const local = resolveLocalOp(spec, cwd);
  if (!local) return { args: spec.args, secret: {} };
  const { playbook } = local;
  const ops = [local.op, spec.eachFrom && playbook.ops.get(spec.eachFrom.op)].filter(Boolean);
  const args = { ...spec.args };
  for (const op of ops) {
    for (const [name, input] of Object.entries(op.args || {})) {
      if (input.type === "string" && typeof spec.raw[name] === "string") args[name] = spec.raw[name];
    }
  }
  // A variable the shell doesn't set is left to the host's environment; the host fails, naming it,
  // when neither has it.
  const secret = {};
  for (const op of ops) for (const { env } of authInputs(op, playbook)) if (process.env[env]) secret[env] = process.env[env];
  return { args, secret };
}

function resolveRunTimeout(spec, cwd) {
  const explicit = Number(spec.args.timeout);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  try {
    const playbook = resolvePlaybook(spec.playbook, { cwd, pinBuiltIn: spec.options["pin-built-in"] === true });
    const op = playbook.ops.get(spec.op);
    const value = Number(op?.args?.timeout?.default);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function playbookCommandNeedsBrowser(argv) {
  if (argv[0] === "use") return true;
  const subcommand = argv[1];
  if (subcommand === "run" || subcommand === "test") return true;
  return subcommand === "record" && ["start", "stop", "discard"].includes(argv[2]);
}

async function handlePlaybookCli(argv, { endpoint, cwd = process.cwd(), session, sessionSource, admission } = {}) {
  if (!["playbook", "pb", "use"].includes(argv[0])) return { handled: false };
  if (argv[0] === "use" || argv[1] === "run") {
    const spec = runSpec(argv);
    if (spec.options["retry-attempt"] !== undefined) assertAttemptId(spec.options["retry-attempt"], "--retry-attempt");
    // `--dry-run true` would read as "no dry run" and send the op: a flag with a value is refused.
    if (spec.options["dry-run"] !== undefined && spec.options["dry-run"] !== true) throw new Error("--dry-run takes no value");
    const format = spec.options.format;
    if (format !== undefined && format !== "md" && format !== "jsonl") throw new Error("--format must be md or jsonl");
    const timeout = resolveRunTimeout(spec, cwd);
    const prepared = prepareRun(spec, cwd);
    const args = {
      playbook: spec.playbook,
      op: spec.op,
      args: prepared.args,
      ...(Object.keys(prepared.secret).length > 0 ? { secret: prepared.secret } : {}),
      projectDir: cwd,
      ...(timeout ? { timeout } : {}),
      write: spec.options.write === true,
      // --override-in-doubt is the old name of --repeat.
      repeat: spec.options.repeat === true || spec.options["override-in-doubt"] === true,
      retryAttempt: spec.options["retry-attempt"],
      pinBuiltIn: spec.options["pin-built-in"] === true,
      allowScript: spec.options["allow-script"] === true,
      ...(spec.eachFrom ? { eachFrom: spec.eachFrom } : {}),
      ...(spec.options["dry-run"] === true ? { dryRun: true } : {}),
      ...(format ? { format } : {}),
    };
    const sent = await requestHost(endpoint, "playbook.run", args, {
      tabId: spec.options["tab-id"],
      session: spec.options.session || session,
      sessionSource: spec.options.session ? "explicit" : sessionSource,
      admission: spec.options["no-wait"] === true ? { wait: false } : admission,
      timeoutMs: resolveRequestDeadlineMs("playbook.run", args),
    });
    // The host masked what its values touch in the result; this masks what this shell's touch.
    const value = redactResult(sent, Object.values(prepared.secret));
    if (args.dryRun) return { handled: true, value: spec.options.json === true ? value : formatDryRun(value), json: spec.options.json === true };
    // With --format the host returns the rendered records as the value.
    if (format) return { handled: true, value: value.value, json: false };
    return { handled: true, value, json: spec.options.json === true };
  }
  const command = argv[1];
  if (command === "param") {
    const { playbook, op, fields, options } = parseParamArgs(argv.slice(2));
    const result = applyParam({ playbook, op, fields, cwd, as: options.as, env: options.env, required: options.required === true, default: options.default, desc: options.desc, value: options.value, link: options.link });
    return { handled: true, value: options.json ? result : formatParamResult(result), json: options.json === true };
  }
  const parsed = parseCommandArgs(argv.slice(2));
  if (!command || command === "help") return { handled: true, value: "Usage: surf playbook|pb <list|show|ops|run|test|extract|record|suggest|save|param|client|trace|export|import>\nRun trusted script strategies with: surf use <playbook> <op> --allow-script" };
  if (endpoint?.kind === "remote" && ["list", "show", "ops", "extract"].includes(command)) throw new Error(`playbook ${command} is local-only with --remote because runs resolve on the browser host`);
  if (command === "test") {
    if (endpoint?.kind === "remote" && argv.includes("--save")) throw new Error("pb test --save is local-only with --remote because it edits the op file on this machine");
    const flags = parseCommandArgs(argv.slice(2)).options;
    const report = await runPlaybookTest({
      argv: argv.slice(2),
      cwd,
      runOp: (params) => {
        const args = { ...params, projectDir: cwd, test: true, pinBuiltIn: flags["pin-built-in"] === true };
        return requestHost(endpoint, "playbook.run", args, {
          tabId: flags["tab-id"],
          session: flags.session || session,
          sessionSource: flags.session ? "explicit" : sessionSource,
          admission: flags["no-wait"] === true ? { wait: false } : admission,
          timeoutMs: resolveRequestDeadlineMs("playbook.run", args),
        });
      },
    });
    const json = argv.includes("--json");
    return { handled: true, value: json ? report : formatTestReport(report), json, exitCode: report.ok ? 0 : 1 };
  }
  if (command === "extract") {
    const spec = parseExtractArgs(argv.slice(2));
    const result = saveExtract({ playbook: spec.playbook, op: spec.op, extract: spec.extract, strategy: spec.options.strategy, cwd });
    return { handled: true, value: spec.options.json ? result : formatExtractResult(result), json: spec.options.json === true };
  }
  if (command === "list") return { handled: true, value: listPlaybooks({ cwd }), json: parsed.options.json === true };
  if (command === "show") {
    const playbook = resolvePlaybook(parsed.positional[0], { cwd });
    return { handled: true, value: { id: playbook.id, name: playbook.name, version: playbook.version, description: playbook.description, origins: playbook.origins, provenance: playbook.provenance, ops: [...playbook.ops.keys()] }, json: parsed.options.json === true };
  }
  if (command === "ops") {
    const playbook = resolvePlaybook(parsed.positional[0], { cwd });
    return { handled: true, value: [...playbook.ops.values()].map((op) => ({ id: op.id, description: op.description || "", effect: op.effect, strategies: op.chain ? ["chain"] : op.run.map((strategy) => strategy.using) })), json: parsed.options.json === true };
  }
  if (command === "record") {
    const action = parsed.positional[0];
    const tool = `playbook.record.${action}`;
    let args = {};
    if (action === "start") args = { site: parsed.positional[1], op: parsed.options.op, watch: parsed.options.watch === true, network: parsed.options.network === true, includeInputValues: keepsInputValues(parsed.options) || loadUserConfig().includeInputValues === true };
    else if (action === "mark") args = { label: parsed.positional.slice(1).join(" ") };
    else if (action === "stop") args = { draft: parsed.options.draft === true, read: parsed.options.read === true, includeInputValues: keepsInputValues(parsed.options), ...(parsed.options["request-id"] ? { requestId: String(parsed.options["request-id"]) } : {}) };
    else if (action === "candidates") args = { ...(parsed.positional[1] ? { recordId: parsed.positional[1] } : {}), ...(parsed.options.limit !== undefined ? { limit: parsed.options.limit } : {}) };
    else if (!["status", "pause", "resume", "discard"].includes(action)) throw new Error("Unknown record command");
    const value = await requestHost(endpoint, tool, args, {
      tabId: parsed.options["tab-id"],
      session: parsed.options.session || session,
      sessionSource: parsed.options.session ? "explicit" : sessionSource,
      admission: parsed.options["no-wait"] === true ? { wait: false } : admission,
    });
    if (action === "candidates" && parsed.options.json !== true) return { handled: true, value: formatCandidates(value), json: false };
    return { handled: true, value, json: parsed.options.json === true };
  }
  if (command === "suggest") return { handled: true, value: suggestions({ since: parsed.options.since || "1h" }), json: parsed.options.json === true };
  if (command === "save") {
    let value;
    if (parsed.options["from-record"]) value = saveFromRecord({ recordId: parsed.options["from-record"], ...(parsed.options["request-id"] ? { requestId: String(parsed.options["request-id"]) } : {}), scope: parsed.options.project ? "project" : "user", cwd });
    else if (parsed.options["from-recent"] || parsed.positional[0]) value = saveFromRecent({ site: parsed.positional[0], op: parsed.options.op, since: parsed.options["from-recent"] === true ? "1h" : parsed.options["from-recent"] || "1h", scope: parsed.options.project ? "project" : "user", cwd });
    else throw new Error("save requires --from-record <id> or <site> --op <name> --from-recent");
    return { handled: true, value, json: parsed.options.json === true };
  }
  if (command === "client") {
    const action = parsed.positional[0];
    let value;
    // `--write true` would read as "no write": a flag with a value is refused, as --dry-run's is.
    if ((parsed.options.write !== undefined && parsed.options.write !== true) || Object.keys(parsed.options).some((name) => name.startsWith("write="))) throw new Error("--write takes no value");
    const allowWrite = parsed.options.write === true;
    if (action === "derive") value = deriveClient(parsed.positional[1], parsed.options.op, parsed.options.out, { recordId: parsed.options["from-record"], requestId: parsed.options["request-id"], allowWrite, cwd });
    else if (action === "export") {
      const playbook = parsed.positional[1];
      const resolved = resolvePlaybook(playbook, { cwd });
      value = exportClient(playbook, parsed.options.op || [...resolved.ops.keys()][0], parsed.options.out, { allowWrite, cwd });
    }
    if (value) {
      for (const warning of value.warnings) console.error(`Warning: ${warning}`);
      return { handled: true, value, json: parsed.options.json === true };
    }
    if (action === "verify") return { handled: true, value: await verifyClient(parsed.positional[1], { live: parsed.options.live === true ? true : undefined, allowWrite }), json: parsed.options.json === true };
    throw new Error("Unknown client command");
  }
  if (command === "trace" && parsed.positional[0] === "export") {
    if (!parsed.options["from-record"] || !parsed.options.har) throw new Error("trace export requires --from-record <id> --har <path>");
    return { handled: true, value: exportRecordHar(parsed.options["from-record"], path.resolve(parsed.options.har), undefined, { cwd }), json: parsed.options.json === true };
  }
  if (command === "export") return { handled: true, value: exportPlaybookDirectory(parsed.positional[0], { out: parsed.options.out, cwd }), json: parsed.options.json === true };
  if (command === "import") return { handled: true, value: importPlaybookDirectory(parsed.positional[0], { scope: parsed.options.project ? "project" : "user", cwd }), json: parsed.options.json === true };
  throw new Error(`Unknown playbook command: ${command}`);
}

function formatDryRun(preview) {
  const show = (value) => (typeof value === "string" ? value : JSON.stringify(value));
  const lines = [`Dry run of ${preview.playbook} ${preview.op} (${preview.effect}): nothing sent`, `strategy: ${preview.strategy}`];
  if (preview.url !== undefined) lines.push(`${preview.method} ${preview.url}`);
  if (preview.query) lines.push(`query: ${show(preview.query)}`);
  if (preview.headers) lines.push(`headers: ${preview.headers.join(", ") || "none"}`);
  if (preview.body !== undefined) lines.push(`body: ${show(preview.body)}`);
  if (preview.step) lines.push(`first step: ${show(preview.step)}`);
  for (const step of preview.steps || []) {
    const each = step.each ? `, each record of ${step.each.from} (at most ${step.each.limit}, ${step.each.delayMs} ms apart)` : "";
    lines.push(`step ${step.id}: ${step.op}${each}`);
  }
  if (preview.output) lines.push(`output: ${preview.output}`);
  if (preview.allowedOrigins) lines.push(`allowed origins: ${preview.allowedOrigins.join(", ") || "any"}`);
  lines.push(`receipt: ${preview.receipt}`);
  if (preview.refused) lines.push(`refused: ${preview.refused}`);
  return lines.join("\n");
}

function formatPlaybookOutput(value, json = false) {
  if (json || typeof value !== "string") return JSON.stringify(value, null, 2);
  return value;
}

module.exports = { formatPlaybookOutput, handlePlaybookCli, playbookCommandNeedsBrowser };
