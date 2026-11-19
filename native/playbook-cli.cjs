const path = require("path");
const { openClientTransport } = require("./client-transport.cjs");
const { resolveRequestDeadlineMs } = require("./host-sessions.cjs");
const { exportRecordHar, saveFromRecent, saveFromRecord, suggestions } = require("./playbook-authoring.cjs");
const { deriveClient, exportClient, verifyClient } = require("./playbook-client.cjs");
const { exportPlaybookDirectory, importPlaybookDirectory, listPlaybooks, resolvePlaybook } = require("./playbooks.cjs");

function parseCommandArgs(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const name = value.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      // A number only when it reads back the same: ids such as 2101.10010 or 0704.0001 stay text.
      options[name] = /^-?\d+(?:\.\d+)?$/.test(next) && String(Number(next)) === next ? Number(next) : next;
      index++;
    } else options[name] = true;
  }
  return { positional, options };
}

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
  const reserved = new Set(["json", "no-lock", "no-wait", "session", "tab-id", "write", "repeat", "retry-attempt", "override-in-doubt", "pin-built-in", "allow-script", "format", "dry-run"]);
  const args = Object.fromEntries(Object.entries(parsed.options).filter(([name]) => !reserved.has(name)));
  return { playbook, op, args, options: parsed.options };
}

// The op as this machine sees it, for its timeout and env names; the host resolves it again.
function localOp(spec, cwd) {
  try {
    return resolvePlaybook(spec.playbook, { cwd, pinBuiltIn: spec.options["pin-built-in"] === true }).ops.get(spec.op);
  } catch {
    return undefined;
  }
}

function resolveRunTimeout(spec, op) {
  const explicit = Number(spec.args.timeout);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const value = Number(op?.args?.timeout?.default);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

// `{{env.NAME}}` reads the caller's environment, so the CLI sends the values the op names.
function opEnv(op) {
  const names = [...JSON.stringify(op || {}).matchAll(/\{\{env\.([a-zA-Z0-9._-]+)\}\}/g)].map((match) => match[1]);
  return Object.fromEntries(names.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]));
}

function runRequest(spec, endpoint, { cwd, session, sessionSource, admission }) {
  const op = localOp(spec, cwd);
  const timeout = resolveRunTimeout(spec, op);
  const format = spec.options.format;
  const args = {
    playbook: spec.playbook,
    op: spec.op,
    args: spec.args,
    projectDir: cwd,
    ...(timeout ? { timeout } : {}),
    write: spec.options.write === true,
    repeat: spec.options.repeat === true,
    retryAttempt: spec.options["retry-attempt"],
    overrideInDoubt: spec.options["override-in-doubt"] === true,
    pinBuiltIn: spec.options["pin-built-in"] === true,
    allowScript: spec.options["allow-script"] === true,
    dryRun: spec.options["dry-run"] === true,
    env: opEnv(op),
    ...(format ? { format } : {}),
  };
  return requestHost(endpoint, "playbook.run", args, {
    tabId: spec.options["tab-id"],
    session: spec.options.session || session,
    sessionSource: spec.options.session ? "explicit" : sessionSource,
    admission: spec.options["no-wait"] === true ? { wait: false } : admission,
    timeoutMs: resolveRequestDeadlineMs("playbook.run", args),
  });
}

// pb test: each read op with its example inputs; the run checks the op's expect. Writes are skipped.
async function testPlaybook(siteId, opId, context) {
  const playbook = resolvePlaybook(siteId, { cwd: context.cwd });
  if (opId && !playbook.ops.has(opId)) throw new Error(`Op not found: ${siteId} ${opId}`);
  const results = [];
  for (const op of opId ? [playbook.ops.get(opId)] : playbook.ops.values()) {
    if (op.effect === "write") {
      results.push({ op: op.id, status: "skip", detail: "a write; pb test sends no writes" });
      continue;
    }
    const args = Object.fromEntries(Object.entries(op.args || {}).filter(([, spec]) => spec.example !== undefined).map(([name, spec]) => [name, spec.example]));
    try {
      const run = await runRequest({ playbook: siteId, op: op.id, args, options: {} }, context.endpoint, context);
      const count = Array.isArray(run.value) ? `${run.value.length} records` : "1 value";
      results.push({ op: op.id, status: "pass", detail: `${count} via ${run.via || run.strategy}` });
    } catch (error) {
      results.push({ op: op.id, status: "fail", detail: error.message });
    }
  }
  return results;
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
    const format = spec.options.format;
    if (format !== undefined && format !== "md" && format !== "jsonl") throw new Error("--format must be md or jsonl");
    const value = await runRequest(spec, endpoint, { cwd, session, sessionSource, admission });
    // With --format the host returns the rendered records as the value.
    if (format && !value.dryRun) return { handled: true, value: value.value, json: false };
    return { handled: true, value, json: spec.options.json === true || value.dryRun === true };
  }
  const command = argv[1];
  const parsed = parseCommandArgs(argv.slice(2));
  if (!command || command === "help") return { handled: true, value: "Usage: surf playbook|pb <list|show|ops|run|test|record|suggest|save|client|trace|export|import>\nRun trusted script strategies with: surf use <playbook> <op> --allow-script" };
  if (endpoint?.kind === "remote" && ["list", "show", "ops", "test"].includes(command)) throw new Error(`playbook ${command} is local-only with --remote because runs resolve on the browser host`);
  if (command === "list") return { handled: true, value: listPlaybooks({ cwd }), json: parsed.options.json === true };
  if (command === "show") {
    const playbook = resolvePlaybook(parsed.positional[0], { cwd });
    return { handled: true, value: { id: playbook.id, name: playbook.name, version: playbook.version, description: playbook.description, origins: playbook.origins, provenance: playbook.provenance, ops: [...playbook.ops.keys()] }, json: parsed.options.json === true };
  }
  if (command === "ops") {
    const playbook = resolvePlaybook(parsed.positional[0], { cwd });
    return { handled: true, value: [...playbook.ops.values()].map((op) => ({ id: op.id, description: op.description || "", effect: op.effect, strategies: op.run ? op.run.map((strategy) => strategy.using) : ["request", "open", "chain"].filter((key) => op[key]) })), json: parsed.options.json === true };
  }
  if (command === "test") {
    if (!parsed.positional[0]) throw new Error("Usage: surf pb test <playbook> [<op>]");
    const results = await testPlaybook(parsed.positional[0], parsed.positional[1], { endpoint, cwd, session, sessionSource, admission });
    const exitCode = results.some((result) => result.status === "fail") ? 1 : 0;
    const width = Math.max(...results.map((result) => result.op.length));
    const text = results.map((result) => `${result.status.padEnd(4)}  ${result.op.padEnd(width)}  ${result.detail}`).join("\n");
    return { handled: true, value: parsed.options.json === true ? results : text, json: parsed.options.json === true, exitCode };
  }
  if (command === "record") {
    const action = parsed.positional[0];
    const tool = `playbook.record.${action}`;
    let args = {};
    if (action === "start") args = { site: parsed.positional[1], op: parsed.options.op, watch: parsed.options.watch === true, network: parsed.options["no-network"] !== true, includeInputValues: parsed.options["include-input-values"] === true };
    else if (action === "mark") args = { label: parsed.positional.slice(1).join(" ") };
    else if (action === "stop") args = { draft: parsed.options.draft === true, ...(parsed.options.match === undefined ? {} : { match: String(parsed.options.match) }) };
    else if (!["status", "pause", "resume", "discard"].includes(action)) throw new Error("Unknown record command");
    const value = await requestHost(endpoint, tool, args, {
      tabId: parsed.options["tab-id"],
      session: parsed.options.session || session,
      sessionSource: parsed.options.session ? "explicit" : sessionSource,
      admission: parsed.options["no-wait"] === true ? { wait: false } : admission,
    });
    // Without --draft, a stop with network capture ran the op pipeline (surf hook's output).
    if (value?.hook && parsed.options.json !== true) {
      const { stdout, stderr, exitCode } = require("./hook-cli.cjs").formatHook(value.hook, ["surf", "pb", "record", "stop"]);
      const warnings = (value.warnings || []).map((warning) => `Warning: ${warning}`);
      return { handled: true, value: [stdout, ...warnings].filter(Boolean).join("\n"), stderr, exitCode };
    }
    return { handled: true, value, json: parsed.options.json === true, ...(value?.hook ? { exitCode: value.hook.exitCode } : {}) };
  }
  if (command === "suggest") return { handled: true, value: suggestions({ since: parsed.options.since || "1h" }), json: parsed.options.json === true };
  if (command === "save") {
    let value;
    if (parsed.options["from-record"]) value = saveFromRecord({ recordId: parsed.options["from-record"], scope: parsed.options.project ? "project" : "user", cwd });
    else if (parsed.options["from-recent"] || parsed.positional[0]) value = saveFromRecent({ site: parsed.positional[0], op: parsed.options.op, since: parsed.options["from-recent"] === true ? "1h" : parsed.options["from-recent"] || "1h", scope: parsed.options.project ? "project" : "user", cwd });
    else throw new Error("save requires --from-record <id> or <site> --op <name> --from-recent");
    return { handled: true, value, json: parsed.options.json === true };
  }
  if (command === "client") {
    const action = parsed.positional[0];
    if (action === "derive") return { handled: true, value: deriveClient(parsed.positional[1], parsed.options.op, parsed.options.out, { recordId: parsed.options["from-record"], requestId: parsed.options["request-id"] }), json: parsed.options.json === true };
    if (action === "export") {
      const playbook = parsed.positional[1];
      const resolved = resolvePlaybook(playbook, { cwd });
      const op = parsed.options.op || [...resolved.ops.keys()][0];
      return { handled: true, value: exportClient(playbook, op, parsed.options.out, { cwd }), json: parsed.options.json === true };
    }
    if (action === "verify") return { handled: true, value: await verifyClient(parsed.positional[1], { live: parsed.options.live === true ? true : undefined }), json: parsed.options.json === true };
    throw new Error("Unknown client command");
  }
  if (command === "trace" && parsed.positional[0] === "export") {
    if (!parsed.options["from-record"] || !parsed.options.har) throw new Error("trace export requires --from-record <id> --har <path>");
    return { handled: true, value: exportRecordHar(parsed.options["from-record"], path.resolve(parsed.options.har)), json: parsed.options.json === true };
  }
  if (command === "export") return { handled: true, value: exportPlaybookDirectory(parsed.positional[0], { out: parsed.options.out, cwd }), json: parsed.options.json === true };
  if (command === "import") return { handled: true, value: importPlaybookDirectory(parsed.positional[0], { scope: parsed.options.project ? "project" : "user", cwd }), json: parsed.options.json === true };
  throw new Error(`Unknown playbook command: ${command}`);
}

function formatPlaybookOutput(value, json = false) {
  if (json || typeof value !== "string") return JSON.stringify(value, null, 2);
  return value;
}

module.exports = { formatPlaybookOutput, handlePlaybookCli, playbookCommandNeedsBrowser, requestHost };
