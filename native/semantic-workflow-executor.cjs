const crypto = require("node:crypto");
const { getPrivateStateRoot } = require("./private-state.cjs");
const { resolveTypeSafeCredential } = require("./semantic-credentials.cjs");
const { createJevEvaluator } = require("./semantic-provider.cjs");
const { createSemanticWorkflowRuntime } = require("./semantic-workflow.cjs");
const { createSemanticWorkflowStateStore } = require("./semantic-workflow-state.cjs");

function createConcreteSemanticExecutor({ request, workflow, inputs = {}, env = process.env, clock = () => Date.now(), evaluate, attemptStore }) {
  if (typeof request !== "function") throw new TypeError("semantic workflow browser request is required");
  if (!evaluate) {
    const credential = resolveTypeSafeCredential(env);
    if (!credential) {
      const error = new Error("TypeSafe API key is not configured; run `surf semantic auth set` or set TYPESAFE_API_KEY");
      error.code = "provider_not_configured";
      throw error;
    }
    evaluate = createJevEvaluator({ apiKey: credential.apiKey, env });
  }
  const digest = crypto.createHash("sha256").update(JSON.stringify(workflow)).digest("hex");
  const runtime = createSemanticWorkflowRuntime({
    request,
    evaluate,
    attemptStore,
    ...(!attemptStore ? {
      createAttemptStore: ({ runId, workflowDigest }) => createSemanticWorkflowStateStore({
        root: getPrivateStateRoot(env), clock, runId, workflowDigest,
      }),
    } : {}),
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
      ...(result.binding || result.coverage || result.probability !== undefined
        ? { publicResult: { binding: result.binding, coverage: result.coverage, probability: result.probability } }
        : {}),
    };
  };
  execute.close = async () => runtime.closeContext(context, failed ? { reason: "workflow_failed", state: "failed" } : { state: "completed" });
  return execute;
}

module.exports = { createConcreteSemanticExecutor };
