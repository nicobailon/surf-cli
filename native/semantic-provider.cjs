const { SEMANTIC_POLICY, SemanticError } = require("./semantic-core.cjs");

const BASE_URL = "https://api.typesafe.ai";
const CLOUDFLARE_API_URL = "https://api.cloudflare.com/client/v4";
const CLOUDFLARE = "Cloudflare Workers AI";

function providerError(code, message, status) {
  const error = new SemanticError(code, message);
  if (status !== undefined) error.status = status;
  return error;
}

function statusError(provider, status) {
  if (status === 401 || status === 403) return providerError("provider_authentication", `${provider} authentication failed`, status);
  if (status === 400 || status === 404 || status === 422) return providerError("provider_invalid_request", `${provider} rejected the semantic request`, status);
  if (status === 429) return providerError("provider_rate_limited", `${provider} rate limit exceeded`, status);
  if (status >= 500) return providerError("provider_unavailable", `${provider} is unavailable`, status);
  return undefined;
}

function mapProviderError(error) {
  const status = Number.isInteger(error?.status) ? error.status : undefined;
  const mapped = status === undefined ? undefined : statusError("TypeSafe", status);
  if (mapped) return mapped;
  if (error?.name === "APITimeoutError") return providerError("provider_timeout", "TypeSafe request timed out");
  if (error?.name === "APIUserAbortError" || error?.name === "AbortError") return providerError("provider_cancelled", "TypeSafe request was cancelled");
  if (error?.name === "APIConnectionError") return providerError("provider_unavailable", "TypeSafe connection failed");
  return providerError("provider_error", "TypeSafe request failed");
}

function resolveModel(env) {
  const override = env.SURF_SEMANTIC_MODEL;
  return typeof override === "string" && override.trim() ? override.trim() : SEMANTIC_POLICY.model;
}

function createJevEvaluator({ apiKey, model = SEMANTIC_POLICY.model, loadSdk = () => require("@typesafe-ai/sdk"), fetch } = {}) {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw providerError("provider_not_configured", "TypeSafe API key is not configured");
  }
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

function createCloudflareEvaluator({ accountId, apiToken, model, fetch = globalThis.fetch } = {}) {
  const url = `${CLOUDFLARE_API_URL}/accounts/${accountId}/ai/run/@cf/cloudflare/${model}`;
  const authorization = `Bearer ${apiToken.trim()}`;

  return async function evaluate(state, questions, options = {}) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, SEMANTIC_POLICY.timeoutMs);
    const cancel = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener("abort", cancel, { once: true });
    try {
      let response;
      let text;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { Authorization: authorization, "Content-Type": "application/json" },
          body: JSON.stringify({ model, state, questions }),
          signal: controller.signal,
        });
        text = await response.text();
      } catch {
        if (timedOut) throw providerError("provider_timeout", `${CLOUDFLARE} request timed out`);
        if (controller.signal.aborted) throw providerError("provider_cancelled", `${CLOUDFLARE} request was cancelled`);
        throw providerError("provider_unavailable", `${CLOUDFLARE} connection failed`);
      }
      if (!response.ok) throw statusError(CLOUDFLARE, response.status) ?? providerError("provider_error", `${CLOUDFLARE} request failed`, response.status);
      let envelope;
      try {
        envelope = JSON.parse(text);
      } catch {
        throw providerError("provider_invalid_response", `${CLOUDFLARE} returned a non-JSON response`, response.status);
      }
      if (envelope?.success !== true) throw providerError("provider_invalid_response", `${CLOUDFLARE} reported an unsuccessful response`, response.status);
      const { result } = envelope;
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw providerError("provider_invalid_response", `${CLOUDFLARE} response is missing its result`, response.status);
      }
      return result;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
    }
  };
}

module.exports = { BASE_URL, createCloudflareEvaluator, createJevEvaluator, mapProviderError, resolveModel };
