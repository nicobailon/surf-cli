import { describe, expect, it, vi } from "vitest";

const {
  BASE_URL,
  createJevEvaluator,
  mapProviderError,
  resolveModel,
} = require("../../native/semantic-provider.cjs");

describe("Jev provider boundary", () => {
  it("loads the SDK lazily and fixes credentials, endpoint, model, logging, timeout, and retries", async () => {
    const systemOne = vi.fn(async () => ({
      model: "jev-1.13.0",
      answers: {},
      usage: { input_tokens: 0, output_tokens: 0 },
    }));
    const clientConstructor = vi.fn(function FakeClient(this: { systemOne: typeof systemOne }) {
      this.systemOne = systemOne;
    });
    const loadSdk = vi.fn(() => ({ TypeSafeClient: clientConstructor }));
    const evaluate = createJevEvaluator({ apiKey: "  secret  ", env: {}, loadSdk });

    expect(loadSdk).not.toHaveBeenCalled();
    await evaluate(
      { title: "Page" },
      { target: { type: "choice", criteria: { one: null, none: null } } },
    );

    expect(loadSdk).toHaveBeenCalledOnce();
    expect(clientConstructor).toHaveBeenCalledWith({
      apiKey: "secret",
      baseURL: "https://api.typesafe.ai",
      defaultModel: "jev-1.13.0",
      logLevel: "off",
      retry: { maxRetries: 0 },
      timeout: 5000,
    });
    expect(systemOne).toHaveBeenCalledWith(expect.objectContaining({ model: "jev-1.13.0" }), {
      signal: undefined,
      timeout: 5000,
      retry: { maxRetries: 0 },
    });
    expect(BASE_URL).toBe("https://api.typesafe.ai");
  });

  it("honors only a nonblank explicit SURF_JEV_MODEL override", () => {
    expect(resolveModel({ SURF_JEV_MODEL: " jev-custom " })).toBe("jev-custom");
    expect(resolveModel({ SURF_JEV_MODEL: "  " })).toBe("jev-1.13.0");
  });

  it("does not load the SDK when the key is missing", () => {
    const loadSdk = vi.fn();
    expect(() => createJevEvaluator({ apiKey: " ", loadSdk })).toThrow(
      expect.objectContaining({ code: "provider_not_configured" }),
    );
    expect(loadSdk).not.toHaveBeenCalled();
  });

  it.each([
    [401, "provider_authentication"],
    [422, "provider_invalid_request"],
    [429, "provider_rate_limited"],
    [529, "provider_unavailable"],
  ])("maps HTTP %i without exposing response bodies", (status, code) => {
    const mapped = mapProviderError({
      status,
      body: { apiKey: "secret", input: "sentinel" },
      message: "secret sentinel",
    });
    expect(mapped).toMatchObject({ code, status });
    expect(JSON.stringify(mapped)).not.toContain("secret");
    expect(mapped.message).not.toContain("sentinel");
  });

  it.each([
    ["APITimeoutError", "provider_timeout"],
    ["APIConnectionError", "provider_unavailable"],
    ["APIUserAbortError", "provider_cancelled"],
  ])("maps %s to a typed redacted error", (name, code) => {
    const mapped = mapProviderError({ name, message: "secret input value" });
    expect(mapped.code).toBe(code);
    expect(mapped.message).not.toContain("secret");
  });

  it("maps SDK construction and request failures without retaining their cause", async () => {
    const evaluate = createJevEvaluator({
      apiKey: "secret",
      loadSdk: () => ({
        TypeSafeClient: class {
          constructor() {
            throw Object.assign(new Error("secret"), { status: 429, body: "input" });
          }
        },
      }),
    });
    await expect(evaluate({}, {})).rejects.toMatchObject({
      code: "provider_rate_limited",
      status: 429,
    });
  });
});
