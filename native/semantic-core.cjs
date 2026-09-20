const { Buffer } = require("node:buffer");

const SEMANTIC_POLICY = Object.freeze({
  model: "jev-1.13.0",
  timeoutMs: 5_000,
  probabilitySumTolerance: 0.01,
  thresholds: Object.freeze({ find: 0.7, filter: 0.65, verifyPositive: 0.85, verifyNegative: 0.85, write: 0.95 }),
  limits: Object.freeze({
    stateBytes: 24 * 1024,
    candidates: 64,
    chunks: 48,
    questions: 50,
    filterTop: 12,
    inputSlots: 16,
    inputValueBytes: 16 * 1024,
    defaultSteps: 5,
    maxSteps: 8,
    defaultWallMs: 30_000,
    maxWallMs: 60_000,
    providerCalls: 17,
    staleRefreshes: 2,
    identicalObservationHashes: 2,
  }),
  waitsMs: Object.freeze([500, 1_500]),
  scrolls: Object.freeze(["down_600", "up_600", "top", "bottom"]),
});

class SemanticError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SemanticError";
    this.code = code;
  }
}

function fail(message) {
  throw new SemanticError("semantic_invalid_request", message);
}

function providerInvalid(message) {
  throw new SemanticError("provider_invalid_response", message);
}

function assertOpaqueId(value, field) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(value)) {
    fail(`${field} must be a bounded opaque identifier`);
  }
}

function assertUniqueItems(items, maximum, label) {
  if (!Array.isArray(items) || items.length > maximum) fail(`${label} exceeds its limit of ${maximum}`);
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) fail(`${label} entries must be objects`);
    assertOpaqueId(item.id, `${label} id`);
    if (ids.has(item.id)) fail(`${label} ids must be unique`);
    ids.add(item.id);
  }
}

function validateState(state) {
  let encoded;
  try {
    encoded = JSON.stringify(state);
  } catch {
    fail("semantic state must be JSON serializable");
  }
  if (encoded === undefined) fail("semantic state must be JSON serializable");
  if (Buffer.byteLength(encoded, "utf8") > SEMANTIC_POLICY.limits.stateBytes) {
    fail(`semantic state exceeds ${SEMANTIC_POLICY.limits.stateBytes} UTF-8 bytes`);
  }
}

function validateGoal(goal) {
  if (typeof goal !== "string" || !goal.trim()) fail("goal must be a nonblank string");
  if (Buffer.byteLength(goal, "utf8") > 4_096) fail("goal exceeds 4096 UTF-8 bytes");
  return goal.trim();
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    providerInvalid(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    providerInvalid(`${label} keys do not match the request`);
  }
}

function validateMetadata(response) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    providerInvalid("provider response must be an object");
  }
  exactKeys(response, ["answers", "model", "usage"], "provider response");
  if (typeof response.model !== "string" || !response.model.trim()) providerInvalid("provider model is missing");
  exactKeys(response.usage, ["input_tokens", "output_tokens"], "provider usage");
  for (const key of ["input_tokens", "output_tokens"]) {
    if (!Number.isSafeInteger(response.usage[key]) || response.usage[key] < 0) {
      providerInvalid("provider usage must contain nonnegative integer token counts");
    }
  }
  return { model: response.model, usage: { ...response.usage } };
}

function validateChoice(answer, labels) {
  exactKeys(answer, ["choice", "confidence", "probabilities", "type"], "choice answer");
  if (answer.type !== "choice") providerInvalid("provider answer must be a choice");
  if (!labels.includes(answer.choice)) providerInvalid("provider selected an unknown label");
  if (!Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) {
    providerInvalid("provider confidence must be between zero and one");
  }
  exactKeys(answer.probabilities, labels, "choice probabilities");
  let sum = 0;
  let maximum = -1;
  for (const label of labels) {
    const probability = answer.probabilities[label];
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      providerInvalid("provider probabilities must be finite values between zero and one");
    }
    sum += probability;
    maximum = Math.max(maximum, probability);
  }
  if (Math.abs(sum - 1) > SEMANTIC_POLICY.probabilitySumTolerance) {
    providerInvalid("provider probabilities do not sum to one");
  }
  if (answer.probabilities[answer.choice] + Number.EPSILON < maximum) {
    providerInvalid("provider selected label is inconsistent with its probabilities");
  }
  return {
    label: answer.choice,
    probability: answer.probabilities[answer.choice],
    probabilities: { ...answer.probabilities },
    confidence: answer.confidence,
  };
}

function choiceQuestion(instructions, labels) {
  return { type: "choice", instructions, criteria: Object.fromEntries(labels.map((label) => [label, null])) };
}

async function evaluatedChoices({ state, questions, evaluate }) {
  validateState(state);
  if (typeof evaluate !== "function") fail("evaluate must be a function");
  const names = Object.keys(questions);
  if (!names.length || names.length > SEMANTIC_POLICY.limits.questions) fail("question count is outside policy limits");
  const response = await evaluate(state, questions, {});
  const metadata = validateMetadata(response);
  exactKeys(response.answers, names, "provider answers");
  const decisions = {};
  for (const name of names) decisions[name] = validateChoice(response.answers[name], Object.keys(questions[name].criteria));
  return { decisions, ...metadata };
}

function candidateDescription(candidate) {
  const parts = [candidate.role, candidate.name, candidate.text].filter((value) => typeof value === "string" && value);
  return parts.join(" | ").slice(0, 1_024) || null;
}

async function find({ state, goal, candidates, evaluate }) {
  goal = validateGoal(goal);
  assertUniqueItems(candidates, SEMANTIC_POLICY.limits.candidates, "candidates");
  const labels = [...candidates.map((candidate) => candidate.id), "none"];
  const criteria = Object.fromEntries(candidates.map((candidate) => [candidate.id, candidateDescription(candidate)]));
  criteria.none = "No supplied candidate matches the goal";
  const response = await evaluatedChoices({
    state,
    questions: { target: { type: "choice", instructions: `Select the supplied candidate that matches this goal: ${goal}`, criteria } },
    evaluate,
  });
  const decision = response.decisions.target;
  const found = decision.label !== "none" && decision.probability >= SEMANTIC_POLICY.thresholds.find;
  return {
    status: found ? "found" : "uncertain",
    candidate: found ? candidates.find((item) => item.id === decision.label) : null,
    decision,
    model: response.model,
    usage: response.usage,
  };
}

async function verify({ state, outcome, evidence = [], evaluate }) {
  outcome = validateGoal(outcome);
  assertUniqueItems(evidence, SEMANTIC_POLICY.limits.chunks, "evidence");
  const questions = {
    verdict: choiceQuestion(`Does the supplied page state show this outcome: ${outcome}`, ["satisfied", "not_satisfied"]),
  };
  if (evidence.length) {
    questions.evidence = choiceQuestion("Select the supplied evidence ID most relevant to the verdict", [
      ...evidence.map((item) => item.id),
      "none",
    ]);
  }
  const response = await evaluatedChoices({ state, questions, evaluate });
  const verdict = response.decisions.verdict;
  let status = "uncertain";
  if (verdict.label === "satisfied" && verdict.probability >= SEMANTIC_POLICY.thresholds.verifyPositive) status = "satisfied";
  if (verdict.label === "not_satisfied" && verdict.probability >= SEMANTIC_POLICY.thresholds.verifyNegative) status = "not_satisfied";
  const evidenceDecision = response.decisions.evidence;
  const evidenceItem = evidenceDecision && evidenceDecision.label !== "none"
    ? evidence.find((item) => item.id === evidenceDecision.label)
    : null;
  return { status, decision: verdict, evidence: evidenceItem || null, evidenceDecision: evidenceDecision || null, model: response.model, usage: response.usage };
}

async function filter({ state, goal, chunks, top = SEMANTIC_POLICY.limits.filterTop, evaluate }) {
  goal = validateGoal(goal);
  assertUniqueItems(chunks, SEMANTIC_POLICY.limits.chunks, "chunks");
  if (!Number.isInteger(top) || top < 1 || top > SEMANTIC_POLICY.limits.filterTop) fail(`top must be between 1 and ${SEMANTIC_POLICY.limits.filterTop}`);
  if (!chunks.length) return { status: "uncertain", chunks: [], omittedCount: 0, decisions: {}, model: null, usage: null };
  const questions = Object.fromEntries(chunks.map((chunk, index) => [
    `chunk_${index}`,
    choiceQuestion(`Is chunk ${chunk.id} relevant to this goal: ${goal}`, ["relevant", "not_relevant"]),
  ]));
  const response = await evaluatedChoices({ state, questions, evaluate });
  const ranked = chunks
    .map((chunk, index) => ({ chunk, decision: response.decisions[`chunk_${index}`], index }))
    .filter((entry) => entry.decision.label === "relevant" && entry.decision.probability >= SEMANTIC_POLICY.thresholds.filter)
    .sort((left, right) => right.decision.probability - left.decision.probability || left.index - right.index)
    .slice(0, top);
  return {
    status: ranked.length ? "filtered" : "uncertain",
    chunks: ranked.map(({ chunk, decision }) => ({ ...chunk, relevance: decision })),
    omittedCount: chunks.length - ranked.length,
    decisions: response.decisions,
    model: response.model,
    usage: response.usage,
  };
}

function validateAction(action, options) {
  const allowedKinds = ["navigate", "click", "scroll", "wait", "fill"];
  if (!allowedKinds.includes(action.kind)) fail(`unsupported action kind for ${action.id}`);
  if (action.kind === "wait" && !SEMANTIC_POLICY.waitsMs.includes(action.durationMs)) fail(`invalid wait action ${action.id}`);
  if (action.kind === "scroll" && !SEMANTIC_POLICY.scrolls.includes(action.direction)) fail(`invalid scroll action ${action.id}`);
  if (action.kind === "navigate") {
    let url;
    try { url = new URL(action.url); } catch { fail(`invalid navigation URL for ${action.id}`); }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.origin !== options.origin) fail(`navigation ${action.id} is not a safe same-origin HTTP(S) URL`);
  }
  if (action.kind === "click" || action.kind === "fill") {
    assertOpaqueId(action.ref, `action ${action.id} ref`);
    if (!options.allowWrite) return false;
    if (options.allowRefs?.length && !options.allowRefs.includes(action.ref)) return false;
  }
  if (action.kind === "fill") {
    assertOpaqueId(action.slot, `action ${action.id} slot`);
    if (!options.inputSlots.includes(action.slot)) fail(`fill action ${action.id} references an unknown input slot`);
  }
  return true;
}

async function chooseAction({ state, goal, actions, origin, allowWrite = false, allowRefs = [], inputSlots = [], evaluate }) {
  goal = validateGoal(goal);
  assertUniqueItems(actions, SEMANTIC_POLICY.limits.candidates, "actions");
  if (!Array.isArray(allowRefs)) fail("allowRefs must be an array");
  if (!Array.isArray(inputSlots) || inputSlots.length > SEMANTIC_POLICY.limits.inputSlots) fail("inputSlots exceeds policy limits");
  for (const value of [...allowRefs, ...inputSlots]) assertOpaqueId(value, "authorization identifier");
  const eligible = actions.filter((action) => validateAction(action, { origin, allowWrite, allowRefs, inputSlots }));
  const labels = [...eligible.map((action) => action.id), "stop"];
  const response = await evaluatedChoices({
    state,
    questions: { action: choiceQuestion(`Select one supplied action for this goal, or stop: ${goal}`, labels) },
    evaluate,
  });
  const decision = response.decisions.action;
  const action = eligible.find((item) => item.id === decision.label) || null;
  const threshold = action && (action.kind === "click" || action.kind === "fill")
    ? SEMANTIC_POLICY.thresholds.write
    : SEMANTIC_POLICY.thresholds.find;
  const selected = action && decision.probability >= threshold ? action : null;
  return { status: selected ? "selected" : "uncertain", action: selected, decision, model: response.model, usage: response.usage };
}

module.exports = { SEMANTIC_POLICY, SemanticError, chooseAction, filter, find, verify };
