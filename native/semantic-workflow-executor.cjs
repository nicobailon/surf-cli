const crypto = require("node:crypto");
const { getPrivateStateRoot } = require("./private-state.cjs");
const { createSemanticEvaluator } = require("./semantic-evaluator.cjs");
const { resolveModel } = require("./semantic-provider.cjs");
const { createSemanticWorkflowRuntime, WORKFLOW_POLICY } = require("./semantic-workflow.cjs");
const { createSemanticWorkflowStateStore } = require("./semantic-workflow-state.cjs");

function createConcreteSemanticExecutor({ request, workflow, inputs = {}, env = process.env, clock = () => Date.now(), evaluator, attemptStore }) {
  if (typeof request !== "function") throw new TypeError("semantic workflow browser request is required");
  evaluator ??= createSemanticEvaluator({ model: resolveModel(env), env });
  const digest = crypto.createHash("sha256").update(JSON.stringify(workflow)).digest("hex");
  const createAttemptStore = attemptStore ? undefined : ({ runId, workflowDigest }) =>
    createSemanticWorkflowStateStore({ root: getPrivateStateRoot(env), clock, runId, workflowDigest });
  const runtime = createSemanticWorkflowRuntime({
    request,
    evaluate: evaluator.evaluate,
    model: evaluator.model,
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
    return {
      ...result,
      semantic: {
        runId: context.runId,
        stepId: step.id,
        checkpoint: context.runId,
        ...evaluator.summary(),
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
      ...(result.binding || result.coverage || result.probability !== undefined
        ? { publicResult: { binding: result.binding, coverage: result.coverage, probability: result.probability } }
        : {}),
    };
  };
  execute.close = async () => runtime.closeContext(context, failed ? { reason: "workflow_failed", state: "failed" } : { state: "completed" });
  return execute;
}

module.exports = { createConcreteSemanticExecutor };
