const crypto = require("node:crypto");
const { SEMANTIC_POLICY, extract, fieldsJsonField, find, localReferenceDate, semanticModel, verify } = require("./semantic-core.cjs");
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

const VALUE_KINDS = Object.freeze({
  text: "a string",
  number: "a finite number",
  integer: "an integer",
  date: "a date as YYYY-MM-DD",
  time: "a time as HH:MM or HH:MM:SS",
  datetime: "a datetime as YYYY-MM-DDTHH:MM or YYYY-MM-DDTHH:MM:SS",
});

// The literal kind a value assert compares an extracted field as; null for list fields, which it can't check.
function valueKind(spec) {
  if (spec.type === "number" || spec.type === "duration") return spec.integer ? "integer" : "number";
  return Object.hasOwn(VALUE_KINDS, spec.type) ? spec.type : null;
}

function normalTime(value) {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match || match[1] > "23" || match[2] > "59" || (match[3] ?? "00") > "59") return undefined;
  return `${match[1]}:${match[2]}:${match[3] ?? "00"}`;
}

function normalDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : undefined;
}

// Returns a value in the comparable form of its kind (times gain :SS), or undefined when it doesn't fit the kind.
function valueLiteral(kind, value) {
  if (kind === "text") return typeof value === "string" ? value : undefined;
  if (kind === "number") return Number.isFinite(value) ? value : undefined;
  if (kind === "integer") return Number.isInteger(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  if (kind === "date") return normalDate(value);
  if (kind === "time") return normalTime(value);
  if (kind === "datetime") {
    const [date, time, extra] = value.split("T");
    const normal = extra === undefined && time !== undefined && normalDate(date) && normalTime(time);
    return normal ? `${date}T${normal}` : undefined;
  }
  return undefined;
}

// Input slots hold strings, numbers or booleans; number-like strings count as numbers.
function inputLiteral(kind, value) {
  if (kind === "text") return value === undefined ? undefined : String(value);
  if ((kind === "number" || kind === "integer") && typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) value = Number(value);
  return valueLiteral(kind, value);
}

// Checks one extracted field against a value assert. Never reads guess, and never returns a value.
function compareValue(field, spec, kind, { equals, min, max }) {
  if (field.status === "null") return "value_null";
  if (field.status !== "extracted") return "value_uncertain";
  const scale = (kind === "number" || kind === "integer") && Number.isInteger(spec.decimals) ? 10 ** spec.decimals : null;
  const comparable = (value) => scale ? Math.round(value * scale) : value;
  const actual = valueLiteral(kind, field.value);
  if (actual === undefined) return "assertion_mismatch";
  const value = comparable(actual);
  const matches = (equals === undefined || value === comparable(equals)) &&
    (min === undefined || value >= comparable(min)) &&
    (max === undefined || value <= comparable(max));
  return matches ? null : "assertion_mismatch";
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
  const { request, evaluate, evaluateExtraction, extractionModelId = SEMANTIC_POLICY.defaultExtractionModel, attemptStore = null, createAttemptStore, model = SEMANTIC_POLICY.model, now = () => Date.now(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = dependencies;
  if (typeof request !== "function" || (!evaluate && !evaluateExtraction)) throw new TypeError("semantic workflow requires request and evaluate or extraction boundaries");
  const writeThreshold = semanticModel(model).thresholds.write;

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
      usage: { providerCalls: 0, inputTokens: 0, outputTokens: 0, partial: false, browserCommands: 0, semanticDecisions: 0, extractions: 0, observations: 0 },
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
  // Every provider call, decision or extraction, draws on the run's one call budget and deadline.
  async function evaluator(context, state, questions, options = {}, extracting = false) {
    const call = extracting ? evaluateExtraction : evaluate;
    if (++context.usage.providerCalls > context.maxProviderCalls) throw Object.assign(new Error("semantic provider-call budget exhausted"), { code: "budget_exhausted" });
    if (remaining(context) < 1) throw Object.assign(new Error("semantic workflow deadline exhausted"), { code: "budget_exhausted" });
    context.usage[extracting ? "extractions" : "semanticDecisions"]++;
    const timeoutMs = Math.min(SEMANTIC_POLICY.timeoutMs, remaining(context));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await call(state, questions, { ...options, signal: controller.signal, timeoutMs });
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
      model,
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
    if (target?.binding && binding?.kind !== "target") return { error: failure("invalid_binding") };
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
        if (!write || decision.decision.probability >= writeThreshold) {
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
        return { error: failure("low_confidence", { probability: decision.decision.probability, appliedThreshold: writeThreshold }) };
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
        model,
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
    if (!context.acquired && context.attemptStore) {
      try { await context.attemptStore.acquire(); } catch (error) { return failure("checkpoint_failure", { error: error.message }); }
      context.acquired = true;
    }
    try {
      if (step.op === "find") {
        const resolved = await resolve(context, step.target, false, step.search);
        if (resolved.error) return resolved.error;
        const handle = step.as || step.id;
        const binding = { kind: "target", handle, query: resolved.query, candidate: resolved.candidate, fullUrl: resolved.observation.identity.fullUrl };
        context.bindings.set(handle, binding);
        return success("completed", { binding: publicBinding(binding), coverage: resolved.coverage, probability: resolved.decision.decision.probability });
      }
      if (step.op === "extract") {
        const fields = Object.entries(step.fields).map(([name, spec]) => fieldsJsonField(name, spec, name));
        const observation = await observe(context);
        const state = providerState(observation);
        // Extraction is read-only: it never reserves an attempt, and its values stay in memory.
        const { usage: _usage, ...result } = await extract({
          state,
          fields,
          referenceDate: localReferenceDate(new Date(now())),
          model: extractionModelId,
          evaluate: (text, requested, options) => evaluator(context, text, requested, options, true),
        });
        const extraction = { ...result, page: { origin: state.origin, title: state.title }, omitted: observation.omitted };
        context.bindings.set(step.as, { kind: "extraction", handle: step.as, specs: fields, result: extraction });
        return success("completed", { extraction });
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
      if (step.op === "assert" && step.mode === "value") {
        // A value assert only reads the in-memory extract result: no browser request and no provider call.
        const binding = context.bindings.get(step.binding);
        const spec = binding?.kind === "extraction" ? binding.specs.find((item) => item.name === step.field)?.spec : undefined;
        if (!spec) return failure("invalid_binding");
        const kind = valueKind(spec);
        const expected = {};
        for (const key of ["equals", "min", "max"]) {
          if (step[key] !== undefined) expected[key] = valueLiteral(kind, step[key]);
        }
        if (step.input !== undefined) {
          if (!Object.hasOwn(context.inputs, step.input)) return failure("validation_failure");
          expected.equals = inputLiteral(kind, context.inputs[step.input]);
          if (expected.equals === undefined) return failure("validation_failure");
        }
        const reason = compareValue(binding.result.fields[step.field], spec, kind, expected);
        return reason ? failure(reason) : success("verified");
      }
      if (step.op === "assert" && step.mode === "semantic") {
        const observation = await observe(context);
        const state = providerState(observation);
        const result = await verify({ state, outcome: step.claim, evidence: state.chunks, model, evaluate: (s, q, o) => evaluator(context, s, q, o) });
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

module.exports = { VALUE_KINDS, WORKFLOW_POLICY, createSemanticWorkflowRuntime, valueKind, valueLiteral };
