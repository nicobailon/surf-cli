const { openClientTransport } = require("./client-transport.cjs");
const { resolveRequestDeadlineMs } = require("./host-sessions.cjs");
const { assembleContext } = require("./oracle-context.cjs");
const fs = require("fs");
const path = require("path");

const RESULT_TIMEOUT_SECONDS = 20;
const POLL_DELAYS_MS = [5000, 10000, 20000, 40000, 60000];
const ORACLE_ERROR_CODES = new Set([
  "auth",
  "attachment_chooser_interception",
  "attachment_file_access",
  "attachment_processing",
  "attachment_selector_drift",
  "capacity",
  "chat_mode_selection_failed",
  "chat_mode_selector_drift",
  "chat_mode_unavailable",
  "cloudflare",
  "context_incomplete",
  "dispatch_failed",
  "github_tool_disconnected",
  "github_tool_missing",
  "github_tool_selection_failed",
  "github_tool_selector_drift",
  "harvest_failed",
  "invalid_request",
  "invalid_transition",
  "model_verification_failed",
  "not_found",
  "rate_limit",
  "remote_unsupported",
  "sensitive_blocked",
  "timeout",
]);
const HELP = `Usage: surf oracle <ask|status|result|follow|list>

Commands:
  ask <prompt>            Start a consult and wait for its response
  follow <id> <prompt>    Continue a captured consult
  status [id]             Show a job (newest when id is omitted)
  result <id> [--wait]    Try to capture a result, optionally keep waiting
  list                    List jobs newest-first

Ask/follow options:
  --files <glob>          Add context files (repeatable)
  --file <path>           Attach one local file
  --model <model>         Select model: instant, thinking, pro, gpt-5.5, gpt-5.6-sol
  --effort <effort>       Select effort: light, standard, extended, heavy, pro
  --github                Require the ChatGPT Chat tab and GitHub tool
  --detach                Return after dispatch
  --allow-sensitive       Allow deny-listed context files

Options:
  --json                  Output machine-readable JSON
  --no-lock               Bypass the browser request lock`;

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function requireOptionValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw codedError("invalid_transition", `--${name} requires a value`);
  }
  return value;
}

function parseOptions(argv) {
  const positional = [];
  const options = { files: [], file: [] };
  const valueOptions = new Set(["files", "file", "model", "effort"]);
  const booleanOptions = new Set([
    "allow-sensitive",
    "detach",
    "github",
    "json",
    "no-lock",
    "wait",
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const name = value.slice(2);
    if (valueOptions.has(name)) {
      const optionValue = requireOptionValue(argv, index, name);
      if (name === "files" || name === "file") options[name].push(optionValue);
      else options[name] = optionValue;
      index += 1;
    } else if (booleanOptions.has(name)) {
      options[name] = true;
    } else {
      throw codedError("invalid_transition", `Unknown oracle option: --${name}`);
    }
  }
  return { positional, options };
}

function assertAllowedOptions(command, options) {
  const common = new Set(["json", "no-lock"]);
  const ask = new Set([
    ...common,
    "allow-sensitive",
    "detach",
    "effort",
    "file",
    "files",
    "github",
    "model",
  ]);
  const allowed = command === "ask" || command === "follow"
    ? ask
    : command === "result" ? new Set([...common, "wait"]) : common;
  for (const [name, value] of Object.entries(options)) {
    if ((name === "files" || name === "file") && value.length === 0) continue;
    if (value !== undefined && !allowed.has(name)) {
      throw codedError("invalid_transition", `--${name} is not supported by oracle ${command}`);
    }
  }
}

function parseOracleCommand(argv) {
  if (argv[0] !== "oracle") return { handled: false };
  const command = argv[1];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    return { handled: true, command: "help", json: false };
  }
  if (!["ask", "follow", "status", "result", "list"].includes(command)) {
    throw codedError("invalid_transition", `Unknown oracle command: ${command}`);
  }
  const parsed = parseOptions(argv.slice(2));
  assertAllowedOptions(command, parsed.options);
  const json = parsed.options.json === true;

  if (command === "ask") {
    const prompt = parsed.positional.join(" ");
    if (!prompt.trim()) {
      throw codedError("dispatch_failed", "Usage: surf oracle ask <prompt> [options]");
    }
    return {
      handled: true,
      command,
      prompt,
      files: parsed.options.files,
      ...(parsed.options.file.length > 0
        ? { file: parsed.options.file.length === 1 ? parsed.options.file[0] : parsed.options.file }
        : {}),
      model: parsed.options.model,
      effort: parsed.options.effort,
      github: parsed.options.github === true,
      detach: parsed.options.detach === true,
      allowSensitive: parsed.options["allow-sensitive"] === true,
      json,
    };
  }

  if (command === "follow") {
    const id = parsed.positional[0];
    const prompt = parsed.positional.slice(1).join(" ");
    if (!id?.trim() || !prompt.trim()) {
      throw codedError("dispatch_failed", "Usage: surf oracle follow <id> <prompt> [options]");
    }
    return {
      handled: true,
      command,
      id,
      prompt,
      files: parsed.options.files,
      ...(parsed.options.file.length > 0
        ? { file: parsed.options.file.length === 1 ? parsed.options.file[0] : parsed.options.file }
        : {}),
      model: parsed.options.model,
      effort: parsed.options.effort,
      github: parsed.options.github === true,
      detach: parsed.options.detach === true,
      allowSensitive: parsed.options["allow-sensitive"] === true,
      json,
    };
  }

  if (command === "status") {
    if (parsed.positional.length > 1 || parsed.positional[0] === "") {
      throw codedError("not_found", "Usage: surf oracle status [id]");
    }
    return { handled: true, command, id: parsed.positional[0], json };
  }

  if (command === "result") {
    if (parsed.positional.length !== 1 || !parsed.positional[0].trim()) {
      throw codedError("not_found", "Usage: surf oracle result <id> [--wait]");
    }
    return {
      handled: true,
      command,
      id: parsed.positional[0],
      wait: parsed.options.wait === true,
      json,
    };
  }

  if (parsed.positional.length > 0) {
    throw codedError("invalid_transition", "Usage: surf oracle list");
  }
  return { handled: true, command, json };
}

function composeAskRequest(spec, context) {
  const prompt = context ? `${spec.prompt}\n\n${context.envelope}` : spec.prompt;
  return {
    prompt,
    ...(spec.model ? { model: spec.model } : {}),
    ...(spec.effort ? { effort: spec.effort } : {}),
    ...(spec.file ? { file: spec.file } : {}),
    ...(spec.github ? { github: true } : {}),
    ...(context ? { contextManifest: context.manifest } : {}),
    ...(context?.bundlePath ? { bundlePath: context.bundlePath } : {}),
    ...(spec.id ? { follow: spec.id } : {}),
  };
}

async function resolveOracleAttachment(value, cwd = process.cwd()) {
  const values = value === undefined || value === null
    ? []
    : Array.isArray(value) ? value : [value];
  if (values.length > 1) {
    throw codedError(
      "attachment_file_access",
      "Oracle supports one explicit local attachment; provide a single --file path",
    );
  }
  if (values.length === 0) return undefined;
  const requested = values[0];
  if (typeof requested !== "string" || !requested.trim()) {
    throw codedError("attachment_file_access", "Oracle attachment file access failed: --file must be a path");
  }
  const resolved = path.resolve(cwd, requested);
  try {
    const stats = await fs.promises.stat(resolved);
    if (!stats.isFile()) throw new Error("not a regular file");
    await fs.promises.access(resolved, fs.constants.R_OK);
  } catch (error) {
    throw codedError(
      "attachment_file_access",
      `Oracle attachment file access failed for ${resolved}: ${error?.message || error}`,
      { path: resolved },
    );
  }
  return resolved;
}

function unwrapResponse(response) {
  if (response?.error) {
    const message = response.error.message
      || response.error.content?.[0]?.text
      || JSON.stringify(response.error);
    throw codedError(response.error.code || "timeout", message, {
      ...(response.error.jobId ? { jobId: response.error.jobId } : {}),
    });
  }
  const text = response?.result?.content?.[0]?.text;
  if (text === undefined) return response?.result;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function requestHost(endpoint, tool, args, withBrowserLock) {
  const execute = async () => {
    const timeoutMs = resolveRequestDeadlineMs(tool, args);
    const transport = await openClientTransport(endpoint, { requestTimeoutMs: timeoutMs });
    try {
      const request = {
        type: "tool_request",
        method: "execute_tool",
        params: { tool, args },
        id: `oracle-${Date.now()}-${Math.random()}`,
      };
      return unwrapResponse(await transport.request(request, timeoutMs));
    } finally {
      await transport.close();
    }
  };
  return withBrowserLock ? withBrowserLock(execute) : execute();
}

function recoveryHint(id) {
  return `Recover with: surf oracle result ${id}`;
}

function classifyError(error, fallbackCode) {
  if (!ORACLE_ERROR_CODES.has(error?.code)) error.code = fallbackCode;
  return error;
}

function shapeOracleError(error, fallbackCode = "timeout") {
  const jobId = typeof error?.jobId === "string" ? error.jobId : undefined;
  let message = error?.message || String(error);
  if (error?.recoverable && jobId && !message.includes("Recover with:")) {
    message = `${message}\n${recoveryHint(jobId)}`;
  }
  return {
    error: {
      code: ORACLE_ERROR_CODES.has(error?.code) ? error.code : fallbackCode,
      message,
    },
    ...(jobId ? { jobId } : {}),
  };
}

function formatOracleError(error, json = false) {
  const shaped = shapeOracleError(error);
  if (json) return JSON.stringify(shaped, null, 2);
  return `Error: ${shaped.error.message}`;
}

function formatOracleOutput(value, json = false) {
  if (json) return JSON.stringify(value, null, 2);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return "No oracle jobs.";
    return value.map((job) => `${job.id}\t${job.state}`).join("\n");
  }
  const lines = [value.id, value.state];
  if (value.response !== undefined) lines.push(value.response);
  return lines.filter((line) => line !== undefined).join("\n");
}

async function waitForResult(job, spec, io) {
  const startedAt = Date.now();
  const interrupt = () => {
    const message = `Interrupted. ${recoveryHint(job.id)}`;
    if (spec.json) {
      io.stderr.write(`${JSON.stringify({
        error: { code: "timeout", message },
        jobId: job.id,
      }, null, 2)}\n`);
    } else {
      io.stderr.write(`${recoveryHint(job.id)}\n`);
    }
    process.exit(130);
  };
  process.once("SIGINT", interrupt);

  try {
    let current = job;
    let pollIndex = 0;
    while (current.state !== "captured") {
      try {
        current = await requestHost(
          io.endpoint,
          "oracle.result",
          {
            id: current.id,
            timeout: RESULT_TIMEOUT_SECONDS,
          },
          io.withBrowserLock,
        );
      } catch (error) {
        error.jobId ||= current.id;
        error.recoverable = true;
        throw classifyError(error, "timeout");
      }
      if (!spec.json && io.stderr.isTTY) {
        const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
        io.stderr.write(`[${elapsedSeconds}s] ${current.state}\n`);
      }
      if (current.state === "failed") {
        throw codedError(
          current.error?.code || "harvest_failed",
          current.error?.message || `oracle job ${current.id} failed`,
          { jobId: current.id },
        );
      }
      if (current.state !== "captured") {
        const delayMs = POLL_DELAYS_MS[Math.min(pollIndex, POLL_DELAYS_MS.length - 1)];
        pollIndex += 1;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return current;
  } finally {
    process.removeListener("SIGINT", interrupt);
  }
}

async function handleOracleCli(argv, {
  endpoint,
  cwd = process.cwd(),
  stderr = process.stderr,
  withBrowserLock,
} = {}) {
  const spec = parseOracleCommand(argv);
  if (!spec.handled) return spec;
  if (spec.command === "help") return { handled: true, value: HELP, json: false };
  if (endpoint?.kind === "remote") {
    throw codedError(
      "remote_unsupported",
      "oracle commands are not supported with remote endpoints",
    );
  }

  const io = { endpoint, stderr, withBrowserLock };
  if (spec.command === "status") {
    try {
      const value = await requestHost(endpoint, "oracle.status", spec.id ? { id: spec.id } : {});
      return { handled: true, value, json: spec.json };
    } catch (error) {
      throw classifyError(error, "timeout");
    }
  }
  if (spec.command === "list") {
    try {
      const value = await requestHost(endpoint, "oracle.list", {});
      return { handled: true, value, json: spec.json };
    } catch (error) {
      throw classifyError(error, "timeout");
    }
  }
  if (spec.command === "result") {
    if (spec.wait) {
      const value = await waitForResult({ id: spec.id, state: "created" }, spec, io);
      return { handled: true, value, json: spec.json };
    }
    try {
      const value = await requestHost(
        endpoint,
        "oracle.result",
        {
          id: spec.id,
          timeout: RESULT_TIMEOUT_SECONDS,
        },
        withBrowserLock,
      );
      return { handled: true, value, json: spec.json };
    } catch (error) {
      error.jobId ||= spec.id;
      throw classifyError(error, "timeout");
    }
  }

  const attachment = await resolveOracleAttachment(spec.file, cwd);
  const context = spec.files.length > 0
    ? await assembleContext({
      files: spec.files,
      cwd,
      allowSensitive: spec.allowSensitive,
    })
    : null;
  const request = composeAskRequest({ ...spec, ...(attachment ? { file: attachment } : {}) }, context);
  const dispatchInterrupt = () => {
    stderr.write(
      "Interrupted during dispatch. A job may already have been created. Run surf oracle status or surf oracle list to find it.\n",
    );
    process.exit(130);
  };
  process.once("SIGINT", dispatchInterrupt);
  let value;
  try {
    value = await requestHost(endpoint, "oracle.ask", request, withBrowserLock);
  } catch (error) {
    throw classifyError(error, "dispatch_failed");
  } finally {
    process.removeListener("SIGINT", dispatchInterrupt);
  }
  if (spec.detach || value.state === "captured") {
    if (spec.detach && value.state === "dispatched") {
      stderr.write(
        `Warning: the durable conversation URL is not yet captured. Run surf oracle result ${value.id} promptly.\n`,
      );
    }
    return { handled: true, value, json: spec.json };
  }
  value = await waitForResult(value, spec, io);
  return { handled: true, value, json: spec.json };
}

module.exports = {
  composeAskRequest,
  formatOracleError,
  formatOracleOutput,
  handleOracleCli,
  parseOracleCommand,
  resolveOracleAttachment,
  shapeOracleError,
};
