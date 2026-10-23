const crypto = require("node:crypto");
const { getPrivateStateRoot } = require("./private-state.cjs");
const { SEMANTIC_POLICY } = require("./semantic-core.cjs");
const { createExtractionEvaluator, createSemanticEvaluator } = require("./semantic-evaluator.cjs");
const { resolveModel } = require("./semantic-provider.cjs");
const { createSemanticWorkflowRuntime, WORKFLOW_POLICY } = require("./semantic-workflow.cjs");
const { createSemanticWorkflowStateStore } = require("./semantic-workflow-state.cjs");

const DECISION_OPS = new Set(["find", "open", "ensureChecked", "fill", "click"]);

// Decides from the declared steps which evaluators a run needs, so a workflow never asks for a provider it doesn't call.
function needsDecisions(args) {
  return DECISION_OPS.has(args.op) || (args.op === "assert" && (args.mode === "local" || args.mode === "semantic"));
}

function createConcreteSemanticExecutor({ request, workflow, inputs = {}, env = process.env, clock = () => Date.now(), evaluator, extractionEvaluator, attemptStore }) {
  if (typeof request !== "function") throw new TypeError("semantic workflow browser request is required");
  const model = resolveModel(env);
  const decisions = workflow.steps.some((step) => needsDecisions(step.args));
  const extracts = workflow.steps.some((step) => step.args.op === "extract");
  evaluator = decisions ? evaluator ?? createSemanticEvaluator({ model, env }) : null;
  extractionEvaluator = extracts ? extractionEvaluator ?? createExtractionEvaluator({ model: SEMANTIC_POLICY.defaultExtractionModel, env }) : null;
  // With no decision step, SURF_SEMANTIC_MODEL is only reported: an unknown name must not block the run.
  const decisionSummary = () => evaluator?.summary() ?? {
    provider: Object.hasOwn(SEMANTIC_POLICY.models, model) ? SEMANTIC_POLICY.models[model].provider : null,
    model,
    providerCalls: 0,
    providerLatencyMs: 0,
  };
  const digest = crypto.createHash("sha256").update(JSON.stringify(workflow)).digest("hex");
  const createAttemptStore = attemptStore ? undefined : ({ runId, workflowDigest }) =>
    createSemanticWorkflowStateStore({ root: getPrivateStateRoot(env), clock, runId, workflowDigest });
  const runtime = createSemanticWorkflowRuntime({
    request,
    evaluate: evaluator?.evaluate,
    model: evaluator?.model ?? SEMANTIC_POLICY.model,
    evaluateExtraction: extractionEvaluator?.evaluate,
    extractionModelId: extractionEvaluator?.model,
    attemptStore,
    createAttemptStore,
    now: clock,
  });
  const context = runtime.createContext({
    workflowDigest: digest,
    deadlineMs: workflow.semantic?.deadlineMs,
    maxProviderCalls: workflow.semantic?.maxProviderCalls,
    inputs,
  });
  let failed = false;
  const execute = async (step) => {
    const result = await runtime.executeStep({ id: step.id, as: step.as, ...step.args }, context);
    if (result.kind !== "success") failed = true;
    let publicResult;
    if (result.extraction) publicResult = result.extraction;
    else if (result.binding || result.coverage || result.probability !== undefined) {
      publicResult = { binding: result.binding, coverage: result.coverage, probability: result.probability };
    }
    return {
      ...result,
      semantic: {
        runId: context.runId,
        stepId: step.id,
        checkpoint: context.runId,
        ...decisionSummary(),
        ...(extractionEvaluator ? { extraction: extractionEvaluator.summary() } : {}),
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.write ? { write: result.write } : {}),
        ...(result.coverage ? { coverage: result.coverage } : {}),
        usage: { ...context.usage },
        limits: {
          ...context.limits,
          maxSearchObservations: step.args.search?.maxObservations ?? WORKFLOW_POLICY.defaultSearchObservations,
          maxSearchObservationsCeiling: WORKFLOW_POLICY.maxSearchObservations,
        },
      },
      ...(publicResult ? { publicResult } : {}),
    };
  };
  execute.close = async () => runtime.closeContext(context, failed ? { reason: "workflow_failed", state: "failed" } : { state: "completed" });
  return execute;
}

module.exports = { createConcreteSemanticExecutor };
