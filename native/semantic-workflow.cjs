const crypto = require("node:crypto");
const { SEMANTIC_POLICY, find, verify } = require("./semantic-core.cjs");
const {
  buildLogicalCandidates,
  canonicalSameOriginDestination,
  confirmedActionResponse,
  expectedIdentity,
  providerState,
  semanticObservationFrom,
} = require("./semantic-cli.cjs");

const WORKFLOW_POLICY = Object.freeze({
  defaultDeadlineMs: 60_000,
  maxDeadlineMs: 120_000,
  defaultProviderCalls: 32,
  maxProviderCalls: 64,
  defaultSearchObservations: 12,
  maxSearchObservations: 32,
  maxSteps: 32,
  verificationMs: 5_000,
  noProgressObservations: 2,
});

function failure(reason, detail = {}) {
  return { kind: "failure", status: "blocked", reason, ...detail };
}

function success(status, detail = {}) {
  return { kind: "success", status, ...detail };
}

function parseBoundary(response, label) {
  if (response?.error) throw Object.assign(new Error(response.error.message || `${label} failed`), { code: response.error.code });
  if (response?.result?.content) {
    const text = response.result.content.find((item) => item.type === "text")?.text;
    try { return JSON.parse(text); } catch { throw new Error(`browser returned an invalid ${label} response`); }
  }
  return response;
}

function samePinnedScope(left, right) {
  return left.browserEpoch === right.browserEpoch && left.tabId === right.tabId && left.frameId === right.frameId;
}

function publicBinding(binding) {
  return { handle: binding.handle, role: binding.candidate.role || null, name: binding.candidate.name || null, type: binding.candidate.type || null };
}

function scanCoverage(intervals, scrollHeight, truncated, invalidated = false) {
  const validHeight = Number.isFinite(scrollHeight) && scrollHeight >= 0;
  const validIntervals = validHeight && intervals.every(({ start, end }) =>
    Number.isFinite(start) && Number.isFinite(end) && start >= 0 && start <= end && end <= scrollHeight);
  const merged = [];
  if (validIntervals) {
    for (const interval of [...intervals].sort((left, right) => left.start - right.start || left.end - right.end)) {
      const previous = merged.at(-1);
      if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
      else merged.push({ ...interval });
    }
  }
  const atBottom = validIntervals && intervals.some(({ end }) => end >= scrollHeight);
  const spansScope = merged.length === 1 && merged[0].start === 0 && merged[0].end >= scrollHeight;
  return { intervals, atBottom, complete: atBottom && spansScope && !truncated && !invalidated, truncated };
}

function createSemanticWorkflowRuntime(dependencies) {
  const { request, evaluate, attemptStore = null, createAttemptStore, now = () => Date.now(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = dependencies;
  if (typeof request !== "function" || typeof evaluate !== "function") throw new TypeError("semantic workflow requires request and evaluate boundaries");

  function createContext(options = {}) {
    const deadlineMs = options.deadlineMs ?? WORKFLOW_POLICY.defaultDeadlineMs;
    const maxProviderCalls = options.maxProviderCalls ?? WORKFLOW_POLICY.defaultProviderCalls;
    if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > WORKFLOW_POLICY.maxDeadlineMs) throw new Error("invalid semantic workflow deadline");
    if (!Number.isInteger(maxProviderCalls) || maxProviderCalls < 1 || maxProviderCalls > WORKFLOW_POLICY.maxProviderCalls) throw new Error("invalid semantic provider-call limit");
    const inputs = { ...(options.inputs || {}) };
    if (Object.keys(inputs).length > SEMANTIC_POLICY.limits.inputSlots) throw new Error("semantic input-slot limit exceeded");
    for (const value of Object.values(inputs)) {
      if (Buffer.byteLength(String(value), "utf8") > SEMANTIC_POLICY.limits.inputValueBytes) throw new Error("semantic input value exceeds its byte limit");
    }
    const runId = options.runId || crypto.randomUUID();
    const workflowDigest = options.workflowDigest || "unknown";
    return {
      runId, workflowDigest,
      deadline: now() + deadlineMs, maxProviderCalls, bindings: new Map(), inputs,
      limits: { deadlineMs, maxProviderCalls },
      pinned: null, acquired: false, steps: 0, completedSteps: [],
      attemptStore: attemptStore || createAttemptStore?.({ runId, workflowDigest }),
      usage: { providerCalls: 0, inputTokens: 0, outputTokens: 0, partial: false, browserCommands: 0, semanticDecisions: 0, observations: 0 },
    };
  }

  const remaining = (context) => Math.max(0, context.deadline - now());
  async function browser(context, tool, args) {
    if (remaining(context) < 1) throw Object.assign(new Error("semantic workflow deadline exhausted"), { code: "budget_exhausted" });
    context.usage.browserCommands++;
    return request(tool, args, remaining(context), context.pinned);
  }
  async function observe(context) {
    const observation = semanticObservationFrom(await browser(context, "page.read", { semanticObservation: true }));
    context.usage.observations++;
    if (!context.pinned) context.pinned = { ...observation.identity };
    else if (!samePinnedScope(context.pinned, observation.identity)) throw Object.assign(new Error("pinned browser scope changed"), { code: "stale_identity" });
    return observation;
  }
  async function evaluator(context, state, questions, options = {}) {
    if (++context.usage.providerCalls > context.maxProviderCalls) throw Object.assign(new Error("semantic provider-call budget exhausted"), { code: "budget_exhausted" });
    if (remaining(context) < 1) throw Object.assign(new Error("semantic workflow deadline exhausted"), { code: "budget_exhausted" });
    context.usage.semanticDecisions++;
    const timeoutMs = Math.min(SEMANTIC_POLICY.timeoutMs, remaining(context));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await evaluate(state, questions, { ...options, signal: controller.signal, timeoutMs });
      context.model = response.model;
      context.usage.inputTokens += response.usage?.input_tokens || 0;
      context.usage.outputTokens += response.usage?.output_tokens || 0;
      return response;
    } catch (error) {
      context.usage.partial = true;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  async function decide(context, observation, query, target, binding) {
    const state = providerState(observation);
    const eligibleRefs = new Set(observation.candidates.filter((candidate) => {
      if ((target.role && candidate.role !== target.role) || (target.type && candidate.type !== target.type)) return false;
      if (!binding) return true;
      return candidate.role === binding.candidate.role &&
        candidate.type === binding.candidate.type &&
        candidate.name === binding.candidate.name &&
        canonicalSameOriginDestination(candidate, observation.identity.fullUrl) ===
          canonicalSameOriginDestination(binding.candidate, binding.fullUrl);
    }).map((candidate) => candidate.ref));
    const candidates = buildLogicalCandidates(observation, state.candidates).flatMap((candidate) => {
      const concreteCandidates = candidate.concreteCandidates.filter((item) => eligibleRefs.has(item.id));
      return concreteCandidates.length ? [{ ...candidate, concreteCandidates }] : [];
    });
    if (!candidates.length) return null;
    const result = await find({
      state: {
        ...state,
        candidates: candidates.map(({ id, role, name, type, text }) => ({ id, role, name, type, text })),
      },
      goal: query,
      candidates,
      evaluate: (s, q, o) => evaluator(context, s, q, o),
    });
    return {
      ...result,
      candidate: result.candidate?.concreteCandidates[0] || null,
    };
  }
  async function scrollGeometry(context, action, scopeToken, identity) {
    const value = parseBoundary(await browser(context, "semantic.scrollScope", {
      action, scopeToken, semanticExpectedIdentity: identity,
      ...(action === "advance" ? { maxFraction: 0.75 } : {}),
    }), "scroll scope");
    if (value?.success !== true || !value.geometry || typeof value.scopeToken !== "string") throw Object.assign(new Error(value?.reason || "scroll scope unavailable"), { code: value?.reason || "unsupported_control" });
    if (scopeToken && value.scopeToken !== scopeToken) throw Object.assign(new Error("scroll scope changed"), { code: "stale_scroll_scope" });
    return value;
  }
  async function resolve(context, target, write, search = {}) {
    const binding = target?.binding ? context.bindings.get(target.binding) : null;
    if (target?.binding && !binding) return { error: failure("invalid_binding") };
    const query = binding?.query || target?.query;
    if (typeof query !== "string" || !query.trim()) return { error: failure("validation_failure") };
    const maximum = search.maxObservations ?? WORKFLOW_POLICY.defaultSearchObservations;
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > WORKFLOW_POLICY.maxSearchObservations) return { error: failure("validation_failure") };
    let observation = await observe(context);
    let scope = await scrollGeometry(context, "inspect", undefined, observation.identity);
    const inspectedGeometry = scope.geometry;
    scope = await scrollGeometry(context, "top", scope.scopeToken, observation.identity);
    const initialObservationStillVisible = inspectedGeometry.intervalStart === scope.geometry.intervalStart &&
      inspectedGeometry.intervalEnd === scope.geometry.intervalEnd &&
      inspectedGeometry.scrollHeight === scope.geometry.scrollHeight;
    const intervals = [];
    const scopedScrollHeight = scope.geometry.scrollHeight;
    let noProgress = 0;
    let truncated = false;
    let invalidated = false;
    for (let index = 0; index < maximum; index++) {
      if (index || !initialObservationStillVisible) observation = await observe(context);
      truncated ||= Number(observation.omitted?.candidates || 0) + Number(observation.omitted?.chunks || 0) > 0;
      const geometry = scope.geometry;
      intervals.push({ start: geometry.intervalStart, end: geometry.intervalEnd });
      invalidated ||= geometry.scrollHeight !== scopedScrollHeight;
      const coverage = scanCoverage(intervals, geometry.scrollHeight, truncated, invalidated);
      const decision = await decide(context, observation, query, target, binding);
      if (decision?.candidate &&
          (!target.role || decision.candidate.role === target.role) &&
          (!target.type || decision.candidate.type === target.type)) {
        if (!write || decision.decision.probability >= SEMANTIC_POLICY.thresholds.write) {
          const concrete = observation.candidates.find((item) => item.ref === decision.candidate.id);
          if (binding) {
            const priorDestination = canonicalSameOriginDestination(binding.candidate, binding.fullUrl);
            const nextDestination = canonicalSameOriginDestination(concrete, observation.identity.fullUrl);
            if (concrete.role !== binding.candidate.role || concrete.type !== binding.candidate.type || concrete.name !== binding.candidate.name || priorDestination !== nextDestination) {
              return { error: failure("ambiguous_target") };
            }
          }
          return { observation, candidate: concrete, query, decision, coverage };
        }
        return { error: failure("low_confidence", { probability: decision.decision.probability, appliedThreshold: SEMANTIC_POLICY.thresholds.write }) };
      }
      if (coverage.atBottom) return { error: failure(coverage.complete ? "target_not_found" : "incomplete_search", { coverage }) };
      if (index + 1 === maximum) return { error: failure("incomplete_search", { coverage }) };
      const next = await scrollGeometry(context, "advance", scope.scopeToken, observation.identity);
      const progressed = next.geometry.intervalStart > geometry.intervalStart && next.geometry.intervalStart <= geometry.intervalEnd;
      noProgress = progressed ? 0 : noProgress + 1;
      if (noProgress >= WORKFLOW_POLICY.noProgressObservations) return { error: failure("no_progress", { coverage }) };
      scope = next;
    }
    return { error: failure("incomplete_search") };
  }
  async function compare(context, observation, candidate, predicate) {
    return parseBoundary(await browser(context, "semantic.localCompare", {
      ref: candidate.ref, predicate, semanticExpectedIdentity: expectedIdentity(observation, candidate),
    }), "local comparison");
  }
  function localPredicate(context, predicate) {
    if (!predicate || typeof predicate !== "object") return predicate;
    let expected = predicate.expected ?? predicate.equals ?? predicate.contains;
    if (predicate.input !== undefined) expected = context.inputs[predicate.input];
    return {
      kind: predicate.kind === "textExact" ? "textEquals" : predicate.kind,
      ...(expected !== undefined ? { expected: predicate.kind === "checkedEquals" ? Boolean(expected) : String(expected) } : {}),
    };
  }
  async function verifyPredicate(context, observation, candidate, predicate) {
    predicate = localPredicate(context, predicate);
    const until = Math.min(context.deadline, now() + WORKFLOW_POLICY.verificationMs);
    const fullUrl = observation.identity.fullUrl;
    do {
      const result = await compare(context, observation, candidate, predicate);
      if (result?.success === true && result.matches === true) return true;
      if (now() >= until) return false;
      await sleep(Math.min(100, until - now()));
      const refreshed = await observe(context);
      if (refreshed.identity.fullUrl !== fullUrl) return false;
      const matching = refreshed.candidates.filter((item) =>
        item.role === candidate.role && item.type === candidate.type && item.name === candidate.name);
      if (matching.length !== 1) return false;
      observation = refreshed;
      candidate = matching[0];
    } while (remaining(context) > 0);
    return false;
  }
  async function verifyExpectation(context, resolved, expectation) {
    if (expectation?.mode === "semantic") {
      const observation = await observe(context);
      const state = providerState(observation);
      const result = await verify({
        state,
        outcome: expectation.claim,
        evidence: state.chunks,
        evaluate: (s, q, o) => evaluator(context, s, q, o),
      });
      return result.status === "satisfied";
    }
    if (expectation?.kind === "urlPath") {
      const observation = await observe(context);
      return new URL(observation.identity.fullUrl).pathname === expectation.equals;
    }
    if (expectation?.target) {
      const expectedTarget = await resolve(context, expectation.target, false, { maxObservations: 1 });
      if (expectedTarget.error) return false;
      return verifyPredicate(context, expectedTarget.observation, expectedTarget.candidate, expectation);
    }
    return verifyPredicate(context, resolved.observation, resolved.candidate, expectation);
  }
  async function storeCall(context, name, ...args) {
    if (!context.attemptStore?.[name]) throw new Error(`attempt store does not implement ${name}`);
    return context.attemptStore[name](...args);
  }
  async function mutate(context, step, resolved, action, predicate, value) {
    const record = {
      stepId: step.id,
      operation: step.op,
      target: {
        role: resolved.candidate.role,
        ...(resolved.candidate.name ? { name: resolved.candidate.name } : {}),
      },
      budgets: { remainingMs: remaining(context) },
    };
    let attempt;
    try { attempt = await storeCall(context, "reserve", record); await storeCall(context, "dispatchIntent", attempt.attemptId); }
    catch { return failure("checkpoint_failure", { write: { state: "not_dispatched", replayAllowed: false } }); }
    try {
      const args = action === "fill"
        ? { data: [{ ref: resolved.candidate.ref, value }], semanticExpectedIdentity: expectedIdentity(resolved.observation, resolved.candidate) }
        : { ref: resolved.candidate.ref, semanticExpectedIdentity: expectedIdentity(resolved.observation, resolved.candidate) };
      const response = await browser(context, action === "fill" ? "form.fill" : "click", args);
      confirmedActionResponse(response);
    } catch {
      try { await storeCall(context, "terminal", attempt.attemptId, "outcome_unknown"); }
      catch { return failure("checkpoint_failure", { write: { state: "dispatch_unknown", replayAllowed: false } }); }
      return failure("outcome_unknown", { write: { state: "dispatch_unknown", replayAllowed: false } });
    }
    let verified;
    try { verified = predicate ? await verifyExpectation(context, resolved, predicate) : false; }
    catch (error) {
      try { await storeCall(context, "terminal", attempt.attemptId, "acknowledged_unverified"); }
      catch { return failure("checkpoint_failure", { write: { state: "acknowledged_unverified", replayAllowed: false } }); }
      return failure(error.code || "verification_failed", { write: { state: "acknowledged_unverified", replayAllowed: false } });
    }
    try { await storeCall(context, "terminal", attempt.attemptId, verified ? "verified" : "acknowledged_unverified"); }
    catch { return failure("checkpoint_failure", { write: { state: verified ? "acknowledged_verified" : "acknowledged_unverified", replayAllowed: false } }); }
    return verified ? success("verified", { write: { state: "acknowledged_verified", replayAllowed: false } }) : failure("assertion_mismatch", { write: { state: "acknowledged_unverified", replayAllowed: false } });
  }

  async function executeStepInner(step, context) {
    if (!context || !(context.bindings instanceof Map)) throw new TypeError("invalid semantic workflow context");
    if (++context.steps > WORKFLOW_POLICY.maxSteps) return failure("budget_exhaustion");
    if (remaining(context) < 1) return failure("budget_exhaustion");
    if (!context.acquired && context.attemptStore) { await context.attemptStore.acquire(); context.acquired = true; }
    try {
      if (step.op === "find") {
        const resolved = await resolve(context, step.target, false, step.search);
        if (resolved.error) return resolved.error;
        const handle = step.as || step.id;
        const binding = { handle, query: resolved.query, candidate: resolved.candidate, fullUrl: resolved.observation.identity.fullUrl };
        context.bindings.set(handle, binding);
        return success("completed", { binding: publicBinding(binding), coverage: resolved.coverage, probability: resolved.decision.decision.probability });
      }
      if (step.op === "open") {
        const resolved = await resolve(context, step.target, false);
        if (resolved.error) return resolved.error;
        const url = canonicalSameOriginDestination(resolved.candidate, resolved.observation.identity.fullUrl);
        if (!url) return failure("unsupported_control");
        confirmedActionResponse(await browser(context, "navigate", { url, semanticExpectedIdentity: resolved.observation.identity }));
        const arrived = await observe(context);
        return new URL(arrived.identity.fullUrl).href === url ? success("verified") : failure("assertion_mismatch");
      }
      if (step.op === "assert" && step.mode === "semantic") {
        const observation = await observe(context);
        const state = providerState(observation);
        const result = await verify({ state, outcome: step.claim, evidence: state.chunks, evaluate: (s, q, o) => evaluator(context, s, q, o) });
        return result.status === "satisfied" ? success("verified", { probability: result.decision.probability }) : failure("assertion_mismatch", { semanticStatus: result.status });
      }
      if (step.op === "assert") {
        const resolved = await resolve(context, step.target || step.predicate?.target, false, { maxObservations: 1 });
        if (resolved.error) return resolved.error;
        return await verifyPredicate(context, resolved.observation, resolved.candidate, step.predicate) ? success("verified") : failure("assertion_mismatch");
      }
      const resolved = await resolve(context, step.target, true, step.search);
      if (resolved.error) return resolved.error;
      if (step.op === "ensureChecked") {
        const predicate = { kind: "checkedEquals", expected: step.checked };
        const comparison = await compare(context, resolved.observation, resolved.candidate, predicate);
        if (comparison?.success !== true) return failure(comparison?.reason || "unsupported_control");
        if (comparison.matches === true) return success("skipped_already_satisfied");
        return await mutate(context, step, resolved, "click", predicate);
      }
      if (step.op === "fill") {
        if (!Object.hasOwn(context.inputs, step.input)) return failure("validation_failure");
        const value = String(context.inputs[step.input]);
        const predicate = { kind: "valueEquals", expected: value };
        const comparison = await compare(context, resolved.observation, resolved.candidate, predicate);
        if (comparison?.success !== true) return failure(comparison?.reason || "unsupported_control");
        if (comparison.matches === true) return success("skipped_already_satisfied");
        return await mutate(context, step, resolved, "fill", predicate, value);
      }
      if (step.op === "click") {
        if (!step.expect) return failure("validation_failure");
        return await mutate(context, step, resolved, "click", step.expect);
      }
      return failure("validation_failure");
    } catch (error) {
      return failure(error.code === "budget_exhausted" ? "budget_exhaustion" : (error.code || "provider_error"));
    }
  }
  async function executeStep(step, context) {
    const result = await executeStepInner(step, context);
    if (result.kind === "success") context.completedSteps.push(step.id);
    return result;
  }
  async function closeContext(context, terminal = {}) {
    if (!context?.acquired || !context.attemptStore) return;
    try {
      await context.attemptStore.checkpoint({
        completedSteps: context.completedSteps,
        reason: terminal.reason || null,
        budgets: { remainingMs: remaining(context) },
      });
    } finally {
      await context.attemptStore.release({
        state: terminal.state || (terminal.reason ? "failed" : "completed"),
        reason: terminal.reason,
      });
      context.acquired = false;
    }
  }
  return { closeContext, createContext, executeStep };
}

module.exports = { WORKFLOW_POLICY, createSemanticWorkflowRuntime };
