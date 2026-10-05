const { performance } = require("node:perf_hooks");
const { SemanticError, semanticModel } = require("./semantic-core.cjs");
const { resolveCloudflareCredential, resolveTypeSafeCredential } = require("./semantic-credentials.cjs");
const { createCloudflareEvaluator, createJevEvaluator } = require("./semantic-provider.cjs");

function providerEvaluator(provider, model, env, { fetch, loadSdk }) {
  if (provider === "cloudflare") {
    const credential = resolveCloudflareCredential(env);
    if (!credential) {
      throw new SemanticError(
        "provider_not_configured",
        "Clef needs Cloudflare credentials: set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, or run: surf semantic auth set --provider cloudflare",
      );
    }
    return createCloudflareEvaluator({ accountId: credential.accountId, apiToken: credential.apiToken, model, fetch });
  }
  const credential = resolveTypeSafeCredential(env);
  if (!credential) {
    throw new SemanticError(
      "provider_not_configured",
      "Jev needs a TypeSafe API key: set TYPESAFE_API_KEY, or run: surf semantic auth set --provider typesafe",
    );
  }
  return createJevEvaluator({ apiKey: credential.apiKey, model, loadSdk, fetch });
}

function createSemanticEvaluator({ model, env = process.env, fetch, loadSdk, now = () => performance.now() }) {
  const { provider } = semanticModel(model);
  const evaluateProvider = providerEvaluator(provider, model, env, { fetch, loadSdk });
  let providerCalls = 0;
  let providerLatencyMs = 0;
  async function evaluate(state, questions, options) {
    providerCalls++;
    const started = now();
    try {
      return await evaluateProvider(state, questions, options);
    } finally {
      providerLatencyMs += now() - started;
    }
  }
  return {
    model,
    evaluate,
    summary: () => ({ provider, model, providerCalls, providerLatencyMs: Math.round(providerLatencyMs) }),
  };
}

module.exports = { createSemanticEvaluator };
