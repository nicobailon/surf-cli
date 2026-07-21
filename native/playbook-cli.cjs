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
      options[name] = /^-?\d+(?:\.\d+)?$/.test(next) ? Number(next) : next;
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
  const reserved = new Set(["json", "no-lock", "tab-id", "write", "repeat", "retry-attempt", "override-in-doubt", "pin-built-in"]);
  const args = Object.fromEntries(Object.entries(parsed.options).filter(([name]) => !reserved.has(name)));
  return { playbook, op, args, options: parsed.options };
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
  if (subcommand === "run") return true;
  return subcommand === "record" && ["start", "stop", "discard"].includes(argv[2]);
}

async function handlePlaybookCli(argv, { endpoint, cwd = process.cwd() }) {
  if (!["playbook", "pb", "use"].includes(argv[0])) return { handled: false };
  if (argv[0] === "use" || argv[1] === "run") {
    const spec = runSpec(argv);
    const timeout = resolveRunTimeout(spec, cwd);
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
    };
    const value = await requestHost(endpoint, "playbook.run", args, {
      tabId: spec.options["tab-id"],
      timeoutMs: resolveRequestDeadlineMs("playbook.run", args),
    });
    return { handled: true, value, json: spec.options.json === true };
  }
  const command = argv[1];
  const parsed = parseCommandArgs(argv.slice(2));
  if (!command || command === "help") return { handled: true, value: "Usage: surf playbook|pb <list|show|ops|run|record|suggest|save|client|trace|export|import>" };
  if (endpoint?.kind === "remote" && ["list", "show", "ops"].includes(command)) throw new Error(`playbook ${command} is local-only with --remote because runs resolve on the browser host`);
  if (command === "list") return { handled: true, value: listPlaybooks({ cwd }), json: parsed.options.json === true };
  if (command === "show") {
    const playbook = resolvePlaybook(parsed.positional[0], { cwd });
    return { handled: true, value: { id: playbook.id, name: playbook.name, version: playbook.version, description: playbook.description, origins: playbook.origins, provenance: playbook.provenance, ops: [...playbook.ops.keys()] }, json: parsed.options.json === true };
  }
  if (command === "ops") {
    const playbook = resolvePlaybook(parsed.positional[0], { cwd });
    return { handled: true, value: [...playbook.ops.values()].map((op) => ({ id: op.id, description: op.description || "", effect: op.effect, strategies: op.run.map((strategy) => strategy.using) })), json: parsed.options.json === true };
  }
  if (command === "record") {
    const action = parsed.positional[0];
    const tool = `playbook.record.${action}`;
    let args = {};
    if (action === "start") args = { site: parsed.positional[1], op: parsed.options.op, watch: parsed.options.watch === true, network: parsed.options.network === true, includeInputValues: parsed.options["include-input-values"] === true };
    else if (action === "mark") args = { label: parsed.positional.slice(1).join(" ") };
    else if (action === "stop") args = { draft: parsed.options.draft === true };
    else if (!["status", "pause", "resume", "discard"].includes(action)) throw new Error("Unknown record command");
    const value = await requestHost(endpoint, tool, args, { tabId: parsed.options["tab-id"] });
    return { handled: true, value, json: parsed.options.json === true };
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

module.exports = { formatPlaybookOutput, handlePlaybookCli, playbookCommandNeedsBrowser };
