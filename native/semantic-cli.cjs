const crypto = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { openClientTransport } = require("./client-transport.cjs");
const { SEMANTIC_POLICY, chooseAction, filter, find, verify } = require("./semantic-core.cjs");
const { createJevEvaluator } = require("./semantic-provider.cjs");
const {
  clearStoredTypeSafeCredential,
  credentialStatus,
  resolveTypeSafeCredential,
  setTypeSafeCredentialFromInput,
} = require("./semantic-credentials.cjs");

const FIELD_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);

function semanticHelp() {
  return `Usage:
  surf semantic.find <goal> [--session <name> | --tab-id <id>] [--json]
  surf semantic.verify <outcome> [--session <name> | --tab-id <id>] [--json]
  surf semantic.filter <goal> [--top <1-12>] [--session <name> | --tab-id <id>] [--json]
  surf semantic.act <goal> [--max-steps <1-8>] [--allow-write] [--allow-ref <ref>...] [--input <name=value>...] [--session <name> | --tab-id <id>] [--json]
  surf semantic auth set|status|clear

Semantic commands send a bounded, value-free page observation to TypeSafe. semantic.act allows only same-origin navigation, fixed scroll/wait actions, and (with --allow-write) clicks/fills. --allow-write authorizes mutation-capable clicks, including submit/purchase/delete/send/publish; repeatable --allow-ref narrows this authority.`;
}

function normalizeSemanticArgs(argv) {
  if (argv[0] !== "semantic") return argv;
  if (!argv[1] || argv[1].startsWith("-")) return argv;
  if (argv[1] === "auth" && argv[2]) return [`semantic.auth.${argv[2]}`, ...argv.slice(3)];
  if (argv[1]) return [`semantic.${argv[1]}`, ...argv.slice(2)];
  return argv;
}

function parseSemanticArgs(argv) {
  const args = normalizeSemanticArgs(argv);
  const command = args[0];
  if (!command?.startsWith("semantic")) return null;
  if (command === "semantic" || args.includes("--help") || args.includes("-h")) return { command: "help", json: args.includes("--json") };
  if (["semantic.auth.set", "semantic.auth.status", "semantic.auth.clear"].includes(command)) {
    if (args.slice(1).some((arg) => arg !== "--json")) throw new Error("semantic auth commands accept only --json, not secrets or browser targeting flags");
    return { command, json: args.includes("--json") };
  }
  if (!["semantic.find", "semantic.verify", "semantic.filter", "semantic.act"].includes(command)) throw new Error(`unknown semantic command: ${command}`);
  const result = { command, json: false, allowWrite: false, allowRefs: [], inputs: {}, maxSteps: SEMANTIC_POLICY.limits.defaultSteps };
  const positionals = [];
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") result.json = true;
    else if (arg === "--no-wait") result.noWait = true;
    else if (arg === "--allow-write") result.allowWrite = true;
    else if (["--session", "--tab-id", "--top", "--max-steps", "--allow-ref", "--input"].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--session") result.session = value;
      if (arg === "--tab-id") result.tabId = positiveInteger(value, arg);
      if (arg === "--top") result.top = positiveInteger(value, arg);
      if (arg === "--max-steps") result.maxSteps = positiveInteger(value, arg);
      if (arg === "--allow-ref") result.allowRefs.push(value);
      if (arg === "--input") {
        const separator = value.indexOf("=");
        const name = separator > 0 ? value.slice(0, separator) : "";
        const inputValue = separator > 0 ? value.slice(separator + 1) : "";
        if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(name)) throw new Error("--input must use a bounded name=value slot");
        if (Object.hasOwn(result.inputs, name)) throw new Error(`duplicate --input slot: ${name}`);
        if (Buffer.byteLength(inputValue, "utf8") > SEMANTIC_POLICY.limits.inputValueBytes) throw new Error(`--input ${name} exceeds ${SEMANTIC_POLICY.limits.inputValueBytes} bytes`);
        result.inputs[name] = inputValue;
      }
    } else if (arg.startsWith("--")) throw new Error(`unknown semantic option: ${arg}`);
    else positionals.push(arg);
  }
  if (positionals.length !== 1 || !positionals[0].trim()) throw new Error(`${command} requires exactly one goal or outcome`);
  if (result.session && result.tabId) throw new Error("use either --session or --tab-id, not both");
  if (result.maxSteps > SEMANTIC_POLICY.limits.maxSteps) throw new Error(`--max-steps must not exceed ${SEMANTIC_POLICY.limits.maxSteps}`);
  if (Object.keys(result.inputs).length > SEMANTIC_POLICY.limits.inputSlots) throw new Error(`--input supports at most ${SEMANTIC_POLICY.limits.inputSlots} slots`);
  if (result.allowRefs.length && !result.allowWrite) throw new Error("--allow-ref requires --allow-write");
  result.goal = positionals[0].trim();
  return result;
}

function positiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function providerState(observation) {
  let origin;
  try { origin = new URL(observation.identity.fullUrl).origin; } catch { throw new Error("semantic observation has an invalid page URL"); }
  return {
    origin,
    title: observation.page.title,
    readyState: observation.page.readyState,
    modals: observation.page.modals,
    candidates: observation.candidates.map(({ ref, role, name, type, nearbyText }) => ({ id: ref, role, name, type, text: nearbyText })),
    chunks: observation.chunks.map(({ id, text }) => ({ id, text })),
  };
}

function unwrapResponse(response) {
  if (response?.error) {
    const error = new Error(response.error.message || response.error.content?.[0]?.text || "browser request failed");
    error.code = response.error.code || response.error.details?.code;
    throw error;
  }
  const text = response?.result?.content?.find((item) => item.type === "text")?.text;
  return text;
}

function semanticObservationFrom(response) {
  const text = unwrapResponse(response);
  let envelope;
  try { envelope = JSON.parse(text); } catch { throw new Error("browser returned an invalid semantic observation"); }
  if (!envelope?.semanticObservation?.identity || !Array.isArray(envelope.semanticObservation.candidates) || !Array.isArray(envelope.semanticObservation.chunks)) {
    throw new Error("browser returned an invalid semantic observation");
  }
  return envelope.semanticObservation;
}

function buildActions(observation, inputs, allowWrite) {
  const actions = [];
  const origin = new URL(observation.identity.fullUrl).origin;
  for (const candidate of observation.candidates) {
    if (candidate.href && candidate.download !== true) {
      try {
        const url = new URL(candidate.href, observation.identity.fullUrl);
        if (/^https?:$/.test(url.protocol) && !url.username && !url.password && url.origin === origin) {
          actions.push({ id: `nav:${candidate.ref}`, kind: "navigate", url: url.href, ref: candidate.ref, description: `${candidate.role} | ${candidate.name}` });
        }
      } catch {}
    }
    if (allowWrite) actions.push({ id: `click:${candidate.ref}`, kind: "click", ref: candidate.ref, description: `${candidate.role} | ${candidate.name}` });
    if (allowWrite && (FIELD_ROLES.has(candidate.role) || ["input", "textarea", "select"].includes(candidate.type))) {
      for (const slot of Object.keys(inputs)) actions.push({ id: `fill:${candidate.ref}:${slot}`, kind: "fill", ref: candidate.ref, slot, description: `${candidate.role} | ${candidate.name} | slot ${slot}` });
    }
  }
  actions.push(
    ...SEMANTIC_POLICY.scrolls.map((direction) => ({ id: `scroll:${direction}`, kind: "scroll", direction })),
    ...SEMANTIC_POLICY.waitsMs.map((durationMs) => ({ id: `wait:${durationMs}`, kind: "wait", durationMs })),
  );
  return actions.slice(0, SEMANTIC_POLICY.limits.candidates);
}

function expectedIdentity(observation, candidate) {
  return { ...observation.identity, ref: candidate.ref, role: candidate.role, name: candidate.name, type: candidate.type };
}

async function executeAction(request, observation, action, inputs, timeoutMs) {
  const candidate = observation.candidates.find((item) => item.ref === action.ref);
  if (action.kind === "navigate") return request("navigate", { url: action.url }, timeoutMs);
  if (action.kind === "click") return request("click", { ref: action.ref, semanticExpectedIdentity: expectedIdentity(observation, candidate) }, timeoutMs);
  if (action.kind === "fill") return request("form.fill", { data: [{ ref: action.ref, value: inputs[action.slot] }], semanticExpectedIdentity: expectedIdentity(observation, candidate) }, timeoutMs);
  if (action.kind === "scroll") {
    if (action.direction === "top" || action.direction === "bottom") return request(`scroll.${action.direction}`, {}, timeoutMs);
    return request("scroll", { direction: action.direction.startsWith("up") ? "up" : "down", scroll_pixels: 600 }, timeoutMs);
  }
  return request("wait", { duration: action.durationMs / 1000 }, timeoutMs);
}

async function runBrowserSemantic(options, { request, evaluate, now = () => performance.now() }) {
  const started = now();
  const deadline = started + SEMANTIC_POLICY.limits.defaultWallMs;
  const remaining = () => Math.max(0, Math.floor(deadline - now()));
  let providerCalls = 0;
  const evaluator = async (state, questions, providerOptions = {}) => {
    if (++providerCalls > SEMANTIC_POLICY.limits.providerCalls) throw new Error("semantic provider-call budget exhausted");
    if (remaining() < 1) throw new Error("semantic wall-clock budget exhausted");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(SEMANTIC_POLICY.timeoutMs, remaining()));
    try { return await evaluate(state, questions, { ...providerOptions, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  };
  const observe = async () => semanticObservationFrom(await request("page.read", { semanticObservation: true }, remaining()));
  let observation = await observe();
  let state = providerState(observation);
  const candidates = state.candidates;
  if (options.command === "semantic.find") return find({ state, goal: options.goal, candidates, evaluate: evaluator });
  if (options.command === "semantic.verify") return verify({ state, outcome: options.goal, evidence: state.chunks, evaluate: evaluator });
  if (options.command === "semantic.filter") {
    const result = await filter({ state, goal: options.goal, chunks: state.chunks, top: options.top, evaluate: evaluator });
    return { ...result, page: { origin: state.origin, title: state.title, readyState: state.readyState, modals: state.modals }, candidates, omitted: observation.omitted };
  }

  const trace = [];
  let staleRefreshes = 0;
  let identical = 0;
  let previousHash = crypto.createHash("sha256").update(JSON.stringify(state)).digest("hex");
  for (let step = 1; step <= options.maxSteps; step++) {
    if (remaining() < 1) return { status: "stopped", stopReason: "time_budget", trace, providerCalls };
    const actions = buildActions(observation, options.inputs, options.allowWrite);
    const choice = await chooseAction({ state, goal: options.goal, actions, origin: state.origin, allowWrite: options.allowWrite, allowRefs: options.allowRefs, inputSlots: Object.keys(options.inputs), evaluate: evaluator });
    if (choice.status !== "selected") return { status: "stopped", stopReason: "uncertain", trace, providerCalls, decision: choice.decision, model: choice.model, usage: choice.usage };
    const action = choice.action;
    const traceAction = { step, kind: action.kind, ...(action.ref ? { ref: action.ref } : {}), ...(action.slot ? { slot: action.slot } : {}), ...(action.direction ? { direction: action.direction } : {}), ...(action.durationMs ? { durationMs: action.durationMs } : {}) };
    try { unwrapResponse(await executeAction(request, observation, action, options.inputs, remaining())); }
    catch (error) {
      trace.push({ ...traceAction, result: error.code === "stale_observation" ? "stale" : "failed" });
      if (error.code === "stale_observation" && staleRefreshes++ < SEMANTIC_POLICY.limits.staleRefreshes) {
        observation = await observe(); state = providerState(observation); continue;
      }
      return { status: "stopped", stopReason: error.code === "stale_observation" ? "stale_observation" : "action_failed", trace, providerCalls };
    }
    trace.push({ ...traceAction, result: "executed" });
    observation = await observe();
    state = providerState(observation);
    const outcome = await verify({ state, outcome: options.goal, evidence: state.chunks, evaluate: evaluator });
    if (outcome.status === "satisfied") return { status: "complete", stopReason: "complete", trace, verification: outcome, providerCalls };
    if ((action.kind === "click" || action.kind === "fill") && outcome.status === "uncertain") return { status: "stopped", stopReason: "uncertain", trace, verification: outcome, providerCalls };
    const hash = crypto.createHash("sha256").update(JSON.stringify(state)).digest("hex");
    identical = hash === previousHash ? identical + 1 : 0;
    previousHash = hash;
    if (identical >= SEMANTIC_POLICY.limits.identicalObservationHashes) return { status: "stopped", stopReason: "no_progress", trace, providerCalls };
  }
  return { status: "stopped", stopReason: "step_budget", trace, providerCalls };
}

async function handleSemanticCli(argv, { endpoint, env = process.env, input = process.stdin, output = process.stderr, openTransport = openClientTransport } = {}) {
  const options = parseSemanticArgs(argv);
  if (!options) return { handled: false };
  if (options.command === "help") return { handled: true, value: semanticHelp(), raw: true };
  if (options.command === "semantic.auth.set") return { handled: true, value: await setTypeSafeCredentialFromInput({ input, output, env }), json: options.json };
  if (options.command === "semantic.auth.status") return { handled: true, value: credentialStatus(env), json: options.json };
  if (options.command === "semantic.auth.clear") return { handled: true, value: { cleared: clearStoredTypeSafeCredential(env), status: credentialStatus(env) }, json: options.json };
  const credential = resolveTypeSafeCredential(env);
  if (!credential) { const error = new Error("TypeSafe API key is not configured; run `surf semantic auth set` or set TYPESAFE_API_KEY"); error.code = "provider_not_configured"; throw error; }
  const transport = await openTransport(endpoint, { requestTimeoutMs: SEMANTIC_POLICY.limits.maxWallMs });
  let id = 0;
  const environmentSession = !options.session && !options.tabId && typeof env.SURF_SESSION === "string" && env.SURF_SESSION.trim() ? env.SURF_SESSION.trim() : undefined;
  const target = {
    ...(options.session ? { session: options.session, sessionSource: "explicit" } : {}),
    ...(environmentSession ? { session: environmentSession, sessionSource: "environment" } : {}),
    ...(options.tabId ? { tabId: options.tabId } : {}),
    ...(options.noWait ? { admission: { wait: false } } : {}),
  };
  try {
    const request = (tool, args, timeoutMs = SEMANTIC_POLICY.limits.maxWallMs) => transport.request({ type: "tool_request", method: "execute_tool", params: { tool, args }, id: `semantic-${++id}`, ...target }, Math.max(1, timeoutMs));
    const value = await runBrowserSemantic(options, { request, evaluate: createJevEvaluator({ apiKey: credential.apiKey, env }) });
    return { handled: true, value, json: options.json };
  } finally { await transport.close(); }
}

function formatSemanticOutput(result) {
  if (result.raw) return result.value;
  if (result.json) return JSON.stringify(result.value, null, 2);
  if (result.value?.source) return result.value.fingerprint ? `${result.value.source} (${result.value.fingerprint})` : result.value.source;
  if (result.value?.cleared !== undefined) return result.value.cleared ? "Shared TypeSafe credential cleared for all clients." : "No shared TypeSafe credential found.";
  return JSON.stringify(result.value, null, 2);
}

module.exports = { buildActions, formatSemanticOutput, handleSemanticCli, normalizeSemanticArgs, parseSemanticArgs, providerState, runBrowserSemantic, semanticHelp };
