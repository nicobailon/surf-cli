const { SEMANTIC_POLICY, SemanticError } = require("./semantic-core.cjs");

const BASE_URL = "https://api.typesafe.ai";

function providerError(code, message, status) {
  const error = new SemanticError(code, message);
  if (status !== undefined) error.status = status;
  return error;
}

function mapProviderError(error) {
  const status = Number.isInteger(error?.status) ? error.status : undefined;
  if (status === 401 || status === 403) return providerError("provider_authentication", "TypeSafe authentication failed", status);
  if (status === 400 || status === 404 || status === 422) return providerError("provider_invalid_request", "TypeSafe rejected the semantic request", status);
  if (status === 429) return providerError("provider_rate_limited", "TypeSafe rate limit exceeded", status);
  if (status === 529 || (status !== undefined && status >= 500)) return providerError("provider_unavailable", "TypeSafe is unavailable", status);
  if (error?.name === "APITimeoutError") return providerError("provider_timeout", "TypeSafe request timed out");
  if (error?.name === "APIUserAbortError" || error?.name === "AbortError") return providerError("provider_cancelled", "TypeSafe request was cancelled");
  if (error?.name === "APIConnectionError") return providerError("provider_unavailable", "TypeSafe connection failed");
  return providerError("provider_error", "TypeSafe request failed");
}

function resolveModel(env) {
  const override = env.SURF_JEV_MODEL;
  return typeof override === "string" && override.trim() ? override.trim() : SEMANTIC_POLICY.model;
}

function createJevEvaluator({ apiKey, env = process.env, loadSdk = () => require("@typesafe-ai/sdk"), fetch } = {}) {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw providerError("provider_not_configured", "TypeSafe API key is not configured");
  }
  const model = resolveModel(env);
  let client;

  return async function evaluate(state, questions, options = {}) {
    try {
      if (!client) {
        const sdk = loadSdk();
        if (!sdk || typeof sdk.TypeSafeClient !== "function") throw new Error("invalid SDK module");
        client = new sdk.TypeSafeClient({
          apiKey: apiKey.trim(),
          baseURL: BASE_URL,
          defaultModel: model,
          logLevel: "off",
          retry: { maxRetries: 0 },
          timeout: SEMANTIC_POLICY.timeoutMs,
          ...(fetch ? { fetch } : {}),
        });
      }
      return await client.systemOne(
        { state, questions, model },
        { signal: options.signal, timeout: SEMANTIC_POLICY.timeoutMs, retry: { maxRetries: 0 } },
      );
    } catch (error) {
      if (error instanceof SemanticError) throw error;
      throw mapProviderError(error);
    }
  };
}

module.exports = { BASE_URL, createJevEvaluator, mapProviderError, resolveModel };
