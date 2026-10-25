const { performance } = require("node:perf_hooks");
const { SemanticError, extractionModel, semanticModel } = require("./semantic-core.cjs");
const { resolveCloudflareCredential, resolveTypeSafeCredential } = require("./semantic-credentials.cjs");
const { createCloudflareEvaluator, createCloudflareExtractor, createJevEvaluator } = require("./semantic-provider.cjs");

// Gateway ids are account-scoped names; the pattern also keeps the env value header-safe.
const CLOUDFLARE_GATEWAY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function cloudflareRoute(env, name) {
  const credential = resolveCloudflareCredential(env);
  if (!credential) {
    throw new SemanticError(
      "provider_not_configured",
      `${name} needs Cloudflare credentials: set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, or run: surf semantic auth set --provider cloudflare`,
    );
  }
  const gatewayId = typeof env.CLOUDFLARE_GATEWAY_ID === "string" ? env.CLOUDFLARE_GATEWAY_ID.trim() : "";
  if (gatewayId && !CLOUDFLARE_GATEWAY_ID_PATTERN.test(gatewayId)) {
    throw new SemanticError("provider_not_configured", "CLOUDFLARE_GATEWAY_ID must be 1-64 letters, digits, hyphens or underscores");
  }
  return { accountId: credential.accountId, apiToken: credential.apiToken, gatewayId: gatewayId || undefined };
}

function providerEvaluator(provider, model, env, { fetch, loadSdk }) {
  if (provider === "cloudflare") {
    return createCloudflareEvaluator({ ...cloudflareRoute(env, "Clef"), model, fetch });
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

function countedEvaluator(provider, model, evaluateProvider, now) {
  let providerCalls = 0;
  let providerLatencyMs = 0;
  async function evaluate(state, request, options) {
    providerCalls++;
    const started = now();
    try {
      return await evaluateProvider(state, request, options);
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

function createSemanticEvaluator({ model, env = process.env, fetch, loadSdk, now = () => performance.now() }) {
  const { provider } = semanticModel(model);
  return countedEvaluator(provider, model, providerEvaluator(provider, model, env, { fetch, loadSdk }), now);
}

function createExtractionEvaluator({ model, env = process.env, fetch, now = () => performance.now() }) {
  const { provider } = extractionModel(model);
  const extract = createCloudflareExtractor({ ...cloudflareRoute(env, "Clairic"), model, fetch });
  return countedEvaluator(provider, model, extract, now);
}

module.exports = { createExtractionEvaluator, createSemanticEvaluator };
