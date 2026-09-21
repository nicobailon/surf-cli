const crypto = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { openClientTransport } = require("./client-transport.cjs");
const { SEMANTIC_POLICY, SemanticError, chooseAction, filter, find, verify } = require("./semantic-core.cjs");
const { createJevEvaluator } = require("./semantic-provider.cjs");
const {
  clearStoredTypeSafeCredential,
  credentialStatus,
  resolveTypeSafeCredential,
  setTypeSafeCredentialFromInput,
} = require("./semantic-credentials.cjs");

const FIELD_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);
const CLICK_ROLES = new Set(["button", "link", "checkbox", "radio"]);
const POST_WRITE_SETTLE_WAITS_MS = Object.freeze([500, 1_000, 2_000, 4_000, 2_000]);
const THRESHOLD_KEYS = Object.freeze({
  find: "find",
  filter: "filter",
  "verify-positive": "verifyPositive",
  "verify-negative": "verifyNegative",
  write: "write",
  "exact-ref-write": "exactRefWrite",
});
const COMMAND_THRESHOLD_KEYS = Object.freeze({
  "semantic.find": new Set(["find"]),
  "semantic.filter": new Set(["filter"]),
  "semantic.verify": new Set(["verify-positive", "verify-negative"]),
  "semantic.act": new Set(["find", "write", "exact-ref-write", "verify-positive", "verify-negative"]),
});

const SEMANTIC_HELP = `Usage:
  surf semantic.find <goal> [--threshold find=<0-1>] [--session <name> | --tab-id <id>] [--json]
  surf semantic.verify <outcome> [--threshold verify-positive=<0-1>] [--threshold verify-negative=<0-1>] [--session <name> | --tab-id <id>] [--json]
  surf semantic.filter <goal> [--top <1-12>] [--threshold filter=<0-1>] [--session <name> | --tab-id <id>] [--json]
  surf semantic.act <goal> [--max-steps <1-8>] [--allow-write] [--allow-ref <ref>...] [--input <name=value>...] [--threshold <name=value>...] [--session <name> | --tab-id <id>] [--json]
  surf semantic auth set|status|clear

Semantic commands send a bounded, value-free page observation to TypeSafe. semantic.act allows only same-origin navigation, fixed scroll/wait actions, and (with --allow-write) clicks/fills. --allow-write authorizes mutation-capable clicks, including submit/purchase/delete/send/publish; repeatable --allow-ref narrows this authority. Repeatable --threshold overrides applicable confidence thresholds for this run only; defaults remain safer and write authority is unchanged. Names: find, filter, verify-positive, verify-negative, write, exact-ref-write.`;

function normalizeSemanticArgs(argv) {
  if (argv[0] !== "semantic") return argv;
  if (!argv[1] || argv[1].startsWith("-")) return argv;
  if (argv[1] === "auth" && argv[2]) return [`semantic.auth.${argv[2]}`, ...argv.slice(3)];
  return [`semantic.${argv[1]}`, ...argv.slice(2)];
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
  const result = { command, json: false, allowWrite: false, allowRefs: [], inputs: {}, thresholds: {}, maxSteps: SEMANTIC_POLICY.limits.defaultSteps };
  const positionals = [];
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") result.json = true;
    else if (arg === "--no-wait") result.noWait = true;
    else if (arg === "--allow-write") result.allowWrite = true;
    else if (["--session", "--tab-id", "--top", "--max-steps", "--allow-ref", "--input", "--threshold"].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--session") result.session = value;
      if (arg === "--tab-id") result.tabId = positiveInteger(value, arg);
      if (arg === "--top") result.top = positiveInteger(value, arg);
      if (arg === "--max-steps") result.maxSteps = positiveInteger(value, arg);
      if (arg === "--allow-ref") result.allowRefs.push(value);
      if (arg === "--threshold") {
        const separator = value.indexOf("=");
        const name = separator > 0 ? value.slice(0, separator) : "";
        const thresholdValue = separator > 0 ? value.slice(separator + 1) : "";
        const key = THRESHOLD_KEYS[name];
        if (!key) throw new Error(`unknown semantic threshold: ${name || value}`);
        if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(thresholdValue)) throw new Error(`--threshold ${name} must be a decimal between 0 and 1`);
        if (Object.hasOwn(result.thresholds, key)) throw new Error(`duplicate --threshold: ${name}`);
        result.thresholds[key] = Number(thresholdValue);
      }
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
  for (const name of Object.keys(THRESHOLD_KEYS)) {
    if (Object.hasOwn(result.thresholds, THRESHOLD_KEYS[name]) && !COMMAND_THRESHOLD_KEYS[command].has(name)) {
      throw new Error(`--threshold ${name} does not apply to ${command}`);
    }
  }
  result.goal = positionals[0].trim();
  return result;
}

function positiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function interactiveCandidateState(state) {
  const projected = {};
  if (state?.checked === true || state?.checked === false || state?.checked === "mixed") projected.checked = state.checked;
  if (state?.selected === true || state?.selected === false) projected.selected = state.selected;
  return Object.keys(projected).length ? projected : undefined;
}

function providerState(observation) {
  let origin;
  try { origin = new URL(observation.identity.fullUrl).origin; } catch { throw new Error("semantic observation has an invalid page URL"); }
  return {
    origin,
    title: observation.page.title,
    readyState: observation.page.readyState,
    modals: observation.page.modals,
    candidates: observation.candidates.map(({ ref, role, name, type, nearbyText, state }) => {
      const interactiveState = interactiveCandidateState(state);
      return { id: ref, role, name, type, text: nearbyText, ...(interactiveState ? { state: interactiveState } : {}) };
    }),
    chunks: observation.chunks.map(({ id, text, refs = [] }) => ({ id, text, refs })),
  };
}

function semanticProjectionHash(state) {
  return crypto.createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

function observedCandidateStateTransition(observation, before) {
  if (!before) return false;
  if (observation.identity.fullUrl !== before.fullUrl || observation.identity.documentToken !== before.documentToken) return false;
  const candidate = observation.candidates.find((item) =>
    item.ref === before.ref && item.role === before.role && item.name === before.name && item.type === before.type);
  const after = interactiveCandidateState(candidate?.state);
  if (!after) return false;
  return (before.state.checked !== undefined && after.checked !== undefined && before.state.checked !== after.checked) ||
    (before.state.selected !== undefined && after.selected !== undefined && before.state.selected !== after.selected);
}

function canonicalSameOriginDestination(candidate, fullUrl) {
  if (!candidate.href || candidate.download === true || candidate.role !== "link" || candidate.type !== "a") return null;
  try {
    const url = new URL(candidate.href, fullUrl);
    const page = new URL(fullUrl);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.origin !== page.origin) return null;
    return url.href;
  } catch { return null; }
}

function stableLogicalId(identity, prefix = "target") {
  return `${prefix}:${crypto.createHash("sha256").update(identity).digest("hex").slice(0, 56)}`;
}

function concreteCandidateOrder(left, right) {
  const leftText = left.representation === "text" ? 1 : 0;
  const rightText = right.representation === "text" ? 1 : 0;
  const leftNamed = typeof left.name === "string" && left.name.trim() ? 1 : 0;
  const rightNamed = typeof right.name === "string" && right.name.trim() ? 1 : 0;
  return rightText - leftText || rightNamed - leftNamed || left.index - right.index;
}

function normalizedSemanticPart(value) {
  return typeof value === "string" ? value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase() : "";
}

function buildLogicalCandidates(observation, candidates = providerState(observation).candidates) {
  const groups = [];
  const navigationGroups = new Map();
  for (const [index, observed] of observation.candidates.entries()) {
    const candidate = candidates[index];
    const destination = canonicalSameOriginDestination(observed, observation.identity.fullUrl);
    const normalizedName = normalizedSemanticPart(candidate.name);
    const normalizedContext = normalizedSemanticPart(candidate.text);
    const hasDistinctContext = normalizedContext && normalizedContext !== normalizedName;
    if (!destination || !normalizedName || !hasDistinctContext) {
      const logicalIdentity = stableLogicalId(`control:${candidate.id}:${candidate.role || ""}:${candidate.type || ""}:${candidate.name || ""}:${candidate.text || ""}`);
      groups.push({
        ...candidate,
        logicalIdentity,
        concreteCandidates: [{ ...candidate, representation: observed.representation, index }],
      });
      continue;
    }
    const semanticIdentity = [
      normalizedSemanticPart(candidate.role),
      normalizedSemanticPart(candidate.type),
      normalizedContext,
    ].join("\u001f");
    const groupingIdentity = `${destination}\u001e${semanticIdentity}`;
    let group = navigationGroups.get(groupingIdentity);
    if (!group) {
      group = {
        id: stableLogicalId(`navigation:${groupingIdentity}`),
        logicalIdentity: stableLogicalId(`navigation:${groupingIdentity}`),
        role: "link",
        name: "",
        text: "",
        concreteCandidates: [],
      };
      navigationGroups.set(groupingIdentity, group);
      groups.push(group);
    }
    group.concreteCandidates.push({ ...candidate, representation: observed.representation, index });
  }
  for (const group of groups) {
    group.concreteCandidates.sort(concreteCandidateOrder);
    const representative = group.concreteCandidates[0];
    if (!group.name) group.name = representative.name;
    if (!group.text) group.text = representative.text;
  }
  return groups;
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

function confirmedActionResponse(response) {
  const text = unwrapResponse(response);
  if (typeof text !== "string") {
    const error = new Error("browser returned an unknown action outcome");
    error.code = "action_outcome_unknown";
    throw error;
  }
  if (
    text === "OK" ||
    /^OK\n(?:\[hint\] |Screenshot (?:\(|saved:)|\[Screenshot failed:)/.test(text) ||
    /^Scrolled to Y:-?\d+(?:\.\d+)?(?: \(page height: \d+(?:\.\d+)?\))?$/.test(text)
  ) return;
  let outcome;
  try { outcome = JSON.parse(text); } catch {}
  if (outcome?.success === false || typeof outcome?.error === "string") {
    const error = new Error(outcome.error || "browser action failed");
    error.code = outcome.code || "action_failed";
    throw error;
  }
  if (outcome?.success === true) return;
  const error = new Error("browser returned an unknown action outcome");
  error.code = "action_outcome_unknown";
  throw error;
}

function semanticObservationFrom(response) {
  const text = unwrapResponse(response);
  let envelope;
  try { envelope = JSON.parse(text); } catch { throw new Error("browser returned an invalid semantic observation"); }
  const observation = envelope?.semanticObservation;
  const identity = observation?.identity;
  if (
    typeof identity?.browserEpoch !== "string" ||
    !Number.isInteger(identity.tabId) ||
    !Number.isInteger(identity.frameId) ||
    typeof identity.fullUrl !== "string" ||
    typeof identity.documentToken !== "string" ||
    !Array.isArray(observation.candidates) ||
    !Array.isArray(observation.chunks)
  ) {
    throw new Error("browser returned an invalid semantic observation");
  }
  return observation;
}

function logicalWriteIdentity(observation, action, candidate) {
  return {
    base: JSON.stringify([
      action.kind,
      observation.identity.fullUrl,
      candidate.role,
      candidate.type,
      candidate.name,
      action.url || canonicalSameOriginDestination(candidate, observation.identity.fullUrl),
      action.kind === "fill" ? action.slot : null,
    ]),
    context: normalizedSemanticPart(candidate.nearbyText).slice(0, 240),
  };
}

function writeWasSpent(observation, action, candidate, spentWrites) {
  const identity = logicalWriteIdentity(observation, action, candidate);
  const spent = spentWrites.filter((item) => item.base === identity.base);
  if (!spent.length) return false;
  if (spent.some((item) => item.context === identity.context)) return true;
  const currentContexts = observation.candidates
    .filter((item) => {
      if (action.kind === "click" && !CLICK_ROLES.has(item.role)) return false;
      if (action.kind === "fill" && !isEditable(item)) return false;
      return logicalWriteIdentity(observation, { ...action, ref: item.ref }, item).base === identity.base;
    })
    .map((item) => normalizedSemanticPart(item.nearbyText).slice(0, 240));
  return spent.some((item) => currentContexts.filter((context) => context === item.context).length !== 1);
}

function spendWrite(spentWrites, identity) {
  if (!spentWrites.some((item) => item.base === identity.base && item.context === identity.context)) {
    spentWrites.push(identity);
  }
}

function semanticErrorCode(error, fallback) {
  return typeof error?.code === "string" && /^[A-Za-z0-9_]{1,64}$/.test(error.code)
    ? error.code
    : fallback;
}

function isEditable(candidate) {
  return FIELD_ROLES.has(candidate.role) || ["textarea", "select"].includes(candidate.type);
}

function takeActionVariants(groups, capacity) {
  const variants = groups.filter((group) => group.length);
  const selected = [];
  for (let index = 0; selected.length < capacity && variants.length; index = (index + 1) % variants.length) {
    const action = variants[index].shift();
    if (action) selected.push(action);
    if (!variants[index].length) {
      variants.splice(index, 1);
      if (!variants.length) break;
      index = (index - 1 + variants.length) % variants.length;
    }
  }
  return selected;
}

function buildActions(observation, inputs, allowWrite, allowRefs = [], spentWrites = []) {
  const fixedActions = [
    ...SEMANTIC_POLICY.scrolls.map((direction) => ({ id: `scroll:${direction}`, kind: "scroll", direction })),
    ...SEMANTIC_POLICY.waitsMs.map((durationMs) => ({ id: `wait:${durationMs}`, kind: "wait", durationMs })),
  ];
  const narrowed = allowRefs.length ? new Set(allowRefs) : null;
  const writeCandidates = allowWrite
    ? observation.candidates.filter((candidate) => !narrowed || narrowed.has(candidate.ref))
    : [];
  const navigationGroups = new Map();
  for (const [index, candidate] of observation.candidates.entries()) {
    const url = canonicalSameOriginDestination(candidate, observation.identity.fullUrl);
    if (!url || url === observation.identity.fullUrl) continue;
    const current = navigationGroups.get(url);
    const ranked = { ...candidate, index };
    if (!current || concreteCandidateOrder(ranked, current) < 0) navigationGroups.set(url, ranked);
  }
  const navigationActions = Array.from(navigationGroups, ([url, candidate]) => ({
      id: `nav:${candidate.ref}`,
      kind: "navigate",
      url,
      concreteRef: candidate.ref,
      logicalIdentity: stableLogicalId(`navigation:${url}`, "action"),
    }));
  if (narrowed) {
    const mandatoryWrites = [];
    const additionalFills = [];
    for (const candidate of writeCandidates) {
      if (CLICK_ROLES.has(candidate.role)) {
        const action = { id: `click:${candidate.ref}`, kind: "click", ref: candidate.ref };
        if (!writeWasSpent(observation, action, candidate, spentWrites)) mandatoryWrites.push(action);
      } else if (isEditable(candidate)) {
        const slot = Object.keys(inputs)[0];
        if (slot) {
          const action = { id: `fill:${candidate.ref}:${slot}`, kind: "fill", ref: candidate.ref, slot };
          if (!writeWasSpent(observation, action, candidate, spentWrites)) mandatoryWrites.push(action);
        }
      }
    }
    if (fixedActions.length + mandatoryWrites.length > SEMANTIC_POLICY.limits.actionChoices) {
      throw new SemanticError(
        "semantic_invalid_request",
        `explicitly authorized actions exceed the limit of ${SEMANTIC_POLICY.limits.actionChoices}`,
      );
    }
    const fillCandidates = writeCandidates.filter(isEditable);
    for (const slot of Object.keys(inputs)) {
      for (const candidate of fillCandidates) {
        if (mandatoryWrites.some((action) => action.kind === "fill" && action.ref === candidate.ref && action.slot === slot)) continue;
        const action = { id: `fill:${candidate.ref}:${slot}`, kind: "fill", ref: candidate.ref, slot };
        if (!writeWasSpent(observation, action, candidate, spentWrites)) additionalFills.push(action);
      }
    }
    const required = [...fixedActions, ...mandatoryWrites];
    return [
      ...required,
      ...takeActionVariants(
        [navigationActions, additionalFills],
        SEMANTIC_POLICY.limits.actionChoices - required.length,
      ),
    ];
  }
  const navigationClickActions = [];
  const controlClickActions = [];
  const fillActions = [];
  for (const candidate of observation.candidates) {
    if (allowWrite) {
      if (CLICK_ROLES.has(candidate.role)) {
        const action = { id: `click:${candidate.ref}`, kind: "click", ref: candidate.ref };
        if (!writeWasSpent(observation, action, candidate, spentWrites)) {
          const group = canonicalSameOriginDestination(candidate, observation.identity.fullUrl)
            ? navigationClickActions
            : controlClickActions;
          group.push(action);
        }
      }
      if (isEditable(candidate)) {
        for (const slot of Object.keys(inputs)) {
          const action = { id: `fill:${candidate.ref}:${slot}`, kind: "fill", ref: candidate.ref, slot };
          if (!writeWasSpent(observation, action, candidate, spentWrites)) fillActions.push(action);
        }
      }
    }
  }
  return [
    ...fixedActions,
    ...takeActionVariants(
      [navigationActions, navigationClickActions, controlClickActions, fillActions],
      SEMANTIC_POLICY.limits.actionChoices - fixedActions.length,
    ),
  ];
}

function expectedIdentity(observation, candidate) {
  return { ...observation.identity, ref: candidate.ref, role: candidate.role, name: candidate.name, type: candidate.type };
}

async function executeAction(request, observation, action, inputs, timeoutMs, designatedIdentity) {
  const candidate = observation.candidates.find((item) => item.ref === action.ref);
  const guardedRequest = (tool, args) => request(tool, { ...args, semanticExpectedIdentity: observation.identity }, timeoutMs, designatedIdentity);
  if (action.kind === "navigate") return guardedRequest("navigate", { url: action.url });
  if (action.kind === "click") return request("click", { ref: action.ref, semanticExpectedIdentity: expectedIdentity(observation, candidate) }, timeoutMs, designatedIdentity);
  if (action.kind === "fill") return request("form.fill", { data: [{ ref: action.ref, value: inputs[action.slot] }], semanticExpectedIdentity: expectedIdentity(observation, candidate) }, timeoutMs, designatedIdentity);
  if (action.kind === "scroll") {
    if (action.direction === "top" || action.direction === "bottom") return guardedRequest(`scroll.${action.direction}`, {});
    return guardedRequest("scroll", { direction: action.direction.startsWith("up") ? "up" : "down", scroll_pixels: 600 });
  }
  return request("wait", { duration: action.durationMs / 1000 }, timeoutMs, designatedIdentity);
}

async function runBrowserSemantic(options, { request, evaluate, now = () => performance.now() }) {
  const deadline = now() + SEMANTIC_POLICY.limits.defaultWallMs;
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
  let designatedIdentity;
  const observe = async () => {
    const observation = semanticObservationFrom(await request("page.read", { semanticObservation: true }, remaining(), designatedIdentity));
    if (!designatedIdentity) {
      designatedIdentity = observation.identity;
    } else if (
      observation.identity.browserEpoch !== designatedIdentity.browserEpoch ||
      observation.identity.tabId !== designatedIdentity.tabId ||
      observation.identity.frameId !== designatedIdentity.frameId
    ) {
      const error = new Error("stale_observation");
      error.code = "stale_observation";
      throw error;
    }
    return observation;
  };
  const settleAfterWrite = async (stateTransition) => {
    let settledObservation = await observe();
    let settledState = providerState(settledObservation);
    if (observedCandidateStateTransition(settledObservation, stateTransition)) return { observation: settledObservation, state: settledState };
    for (const waitMs of POST_WRITE_SETTLE_WAITS_MS) {
      const timeoutMs = remaining();
      if (timeoutMs < 1) break;
      await request("wait", { duration: Math.min(waitMs, timeoutMs) / 1_000 }, timeoutMs, designatedIdentity);
      if (remaining() < 1) break;
      settledObservation = await observe();
      settledState = providerState(settledObservation);
      if (observedCandidateStateTransition(settledObservation, stateTransition)) break;
    }
    return { observation: settledObservation, state: settledState };
  };
  let observation = await observe();
  let state = providerState(observation);
  if (options.command === "semantic.find") {
    const logicalCandidates = buildLogicalCandidates(observation, state.candidates);
    const logicalState = {
      ...state,
      candidates: logicalCandidates.map(({ id, role, name, type, text }) => ({ id, role, name, type, text })),
    };
    const result = await find({ state: logicalState, goal: options.goal, candidates: logicalCandidates, thresholds: options.thresholds, evaluate: evaluator });
    const logicalCandidate = result.candidate;
    const concrete = logicalCandidate?.concreteCandidates?.[0] || null;
    return {
      ...result,
      candidate: concrete ? Object.fromEntries(Object.entries(concrete).filter(([key]) => key !== "index")) : null,
      logicalCandidate: logicalCandidate ? {
        id: logicalCandidate.id,
        identity: logicalCandidate.logicalIdentity,
        refs: logicalCandidate.concreteCandidates.map((candidate) => candidate.id),
        probability: result.decision.probability,
      } : null,
      concreteDecision: concrete ? {
        ref: concrete.id,
        identity: `${concrete.role || ""}:${concrete.type || ""}:${concrete.name || ""}`.slice(0, 1_024),
        probability: result.decision.probability,
      } : null,
    };
  }
  if (options.command === "semantic.verify") return verify({ state, outcome: options.goal, evidence: state.chunks, thresholds: options.thresholds, evaluate: evaluator });
  if (options.command === "semantic.filter") {
    const result = await filter({ state, goal: options.goal, chunks: state.chunks, top: options.top, thresholds: options.thresholds, evaluate: evaluator });
    const relevantRefs = new Set(result.chunks.flatMap((chunk) => chunk.refs || []));
    return { ...result, page: { origin: state.origin, title: state.title, readyState: state.readyState, modals: state.modals }, candidates: state.candidates.filter((candidate) => relevantRefs.has(candidate.id)), omitted: observation.omitted };
  }

  const trace = [];
  let staleRefreshes = 0;
  const spentWrites = [];
  let identical = 0;
  let previousHash = semanticProjectionHash(state);
  for (let step = 1; step <= options.maxSteps; step++) {
    if (remaining() < 1) return { status: "stopped", stopReason: "time_budget", trace, providerCalls };
    let choice;
    try {
      const actions = buildActions(observation, options.inputs, options.allowWrite, options.allowRefs, spentWrites);
      for (let retries = 0; ; retries++) {
        try {
          choice = await chooseAction({ state, goal: options.goal, actions, origin: state.origin, allowWrite: options.allowWrite, allowRefs: options.allowRefs, inputSlots: Object.keys(options.inputs), thresholds: options.thresholds, evaluate: evaluator });
          break;
        } catch (error) {
          if (error?.code !== "provider_invalid_response" || retries >= SEMANTIC_POLICY.limits.invalidActionDecisionRetries) throw error;
        }
      }
    } catch (error) {
      return { status: "stopped", stopReason: "decision_failed", errorCode: semanticErrorCode(error, "decision_failed"), trace, providerCalls };
    }
    if (choice.status !== "selected") return { status: "stopped", stopReason: "uncertain", trace, providerCalls, appliedThreshold: choice.appliedThreshold, decision: choice.decision, logicalDecision: choice.logicalDecision, concreteDecision: choice.concreteDecision, model: choice.model, usage: choice.usage };
    const action = choice.action;
    const actionCandidate = observation.candidates.find((item) => item.ref === action.ref);
    const writeIdentity = action.kind === "click" || action.kind === "fill"
      ? logicalWriteIdentity(observation, action, actionCandidate)
      : null;
    const preWriteState = action.kind === "click" ? interactiveCandidateState(actionCandidate?.state) : undefined;
    const stateTransition = preWriteState
      ? {
          fullUrl: observation.identity.fullUrl,
          documentToken: observation.identity.documentToken,
          ref: actionCandidate.ref,
          role: actionCandidate.role,
          name: actionCandidate.name,
          type: actionCandidate.type,
          state: preWriteState,
        }
      : null;
    const traceAction = { step, kind: action.kind, appliedThreshold: choice.appliedThreshold, logicalProbability: choice.decision.probability, ...(action.logicalIdentity ? { logicalIdentity: action.logicalIdentity } : {}), ...(action.ref ? { ref: action.ref } : {}), ...(action.concreteRef ? { concreteRef: action.concreteRef, concreteProbability: choice.decision.probability } : {}), ...(action.slot ? { slot: action.slot } : {}), ...(action.direction ? { direction: action.direction } : {}), ...(action.durationMs ? { durationMs: action.durationMs } : {}) };
    try { confirmedActionResponse(await executeAction(request, observation, action, options.inputs, remaining(), designatedIdentity)); }
    catch (error) {
      trace.push({ ...traceAction, result: error.code === "stale_observation" ? "stale" : "failed" });
      if (error.code === "stale_observation" && staleRefreshes++ < SEMANTIC_POLICY.limits.staleRefreshes) {
        observation = await observe(); state = providerState(observation); continue;
      }
      const stopReason = error.code === "stale_observation"
        ? "stale_observation"
        : error.code === "action_outcome_unknown" ? "outcome_unknown" : "action_failed";
      return { status: "stopped", stopReason, trace, providerCalls };
    }
    trace.push({ ...traceAction, result: "executed" });
    try {
      if (writeIdentity) {
        ({ observation, state } = await settleAfterWrite(stateTransition));
      } else {
        observation = await observe();
        state = providerState(observation);
      }
    } catch {
      return { status: "stopped", stopReason: "outcome_unknown", trace, providerCalls };
    }
    let outcome;
    try {
      outcome = await verify({ state, outcome: options.goal, evidence: state.chunks, thresholds: options.thresholds, evaluate: evaluator });
    } catch (error) {
      return { status: "stopped", stopReason: "verification_failed", errorCode: semanticErrorCode(error, "verification_failed"), trace, providerCalls };
    }
    if (outcome.status === "satisfied") return { status: "complete", stopReason: "complete", trace, verification: outcome, providerCalls };
    if (action.kind === "click" || action.kind === "fill") {
      if (outcome.status !== "not_satisfied") {
        return { status: "stopped", stopReason: "uncertain", trace, verification: outcome, providerCalls };
      }
      spendWrite(spentWrites, writeIdentity);
      continue;
    }
    const hash = semanticProjectionHash(state);
    identical = hash === previousHash ? identical + 1 : 0;
    previousHash = hash;
    if (identical >= SEMANTIC_POLICY.limits.identicalObservationHashes) return { status: "stopped", stopReason: "no_progress", trace, providerCalls };
  }
  return { status: "stopped", stopReason: "step_budget", trace, providerCalls };
}

async function handleSemanticCli(argv, { endpoint, env = process.env, input = process.stdin, output = process.stderr, openTransport = openClientTransport } = {}) {
  const options = parseSemanticArgs(argv);
  if (!options) return { handled: false };
  if (options.command === "help") return { handled: true, value: SEMANTIC_HELP, raw: true };
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
    const request = (tool, args, timeoutMs = SEMANTIC_POLICY.limits.maxWallMs, designatedIdentity) => transport.request({
      type: "tool_request",
      method: "execute_tool",
      params: { tool, args: designatedIdentity ? { ...args, semanticFrameId: designatedIdentity.frameId } : args },
      id: `semantic-${++id}`,
      ...(designatedIdentity
        ? { tabId: designatedIdentity.tabId, ...(target.admission ? { admission: target.admission } : {}) }
        : target),
    }, Math.max(1, timeoutMs));
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

module.exports = {
  buildActions,
  buildLogicalCandidates,
  canonicalSameOriginDestination,
  confirmedActionResponse,
  expectedIdentity,
  formatSemanticOutput,
  handleSemanticCli,
  normalizeSemanticArgs,
  parseSemanticArgs,
  providerState,
  runBrowserSemantic,
  semanticObservationFrom,
};
