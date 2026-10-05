import { describe, expect, it, vi } from "vitest";

const {
  BASE_URL,
  createCloudflareEvaluator,
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
    const evaluate = createJevEvaluator({ apiKey: "  secret  ", loadSdk });

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

  it("uses the explicit model for the client default and every request", async () => {
    const systemOne = vi.fn(async () => ({}));
    const clientConstructor = vi.fn(function FakeClient(this: { systemOne: typeof systemOne }) {
      this.systemOne = systemOne;
    });
    const evaluate = createJevEvaluator({
      apiKey: "secret",
      model: "jev-custom",
      loadSdk: () => ({ TypeSafeClient: clientConstructor }),
    });
    await evaluate({}, {});
    expect(clientConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ defaultModel: "jev-custom" }),
    );
    expect(systemOne).toHaveBeenCalledWith(
      expect.objectContaining({ model: "jev-custom" }),
      expect.anything(),
    );
  });

  it("resolves the model from a nonblank SURF_SEMANTIC_MODEL only", () => {
    expect(resolveModel({ SURF_SEMANTIC_MODEL: " clef-flash " })).toBe("clef-flash");
    expect(resolveModel({ SURF_SEMANTIC_MODEL: "  " })).toBe("jev-1.13.0");
    expect(resolveModel({})).toBe("jev-1.13.0");
    expect(resolveModel({ SURF_JEV_MODEL: "jev-custom" })).toBe("jev-1.13.0");
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

describe("Cloudflare Workers AI provider boundary", () => {
  const TOKEN = "cf-secret-token";
  const result = {
    model: "clef",
    answers: {
      q1: {
        type: "choice",
        choice: "e1",
        probabilities: { e1: 0.9957, e2: 0.0043 },
        confidence: 0.9828,
      },
    },
    usage: { input_tokens: 142, output_tokens: 0 },
  };
  const questions = {
    q1: { type: "choice", instructions: "Pick", criteria: { e1: "first", e2: "second" } },
  };

  function respond(status: number, body: unknown) {
    return vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
    );
  }

  function evaluator(
    fetch: unknown,
    model = "clef",
  ): (state: unknown, questions: unknown, options?: { signal?: AbortSignal }) => Promise<any> {
    return createCloudflareEvaluator({
      accountId: "acct123",
      apiToken: ` ${TOKEN} `,
      model,
      fetch,
    });
  }

  function hangingFetch() {
    return vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const abort = () =>
            reject(Object.assign(new Error(`aborted ${TOKEN}`), { name: "AbortError" }));
          if (init.signal?.aborted) {
            abort();
          }
          init.signal?.addEventListener("abort", abort);
        }),
    );
  }

  it("posts model, state, and questions to the model endpoint and returns the unwrapped result", async () => {
    const fetch = respond(200, { result, success: true, errors: [], messages: [] });
    const response = await evaluator(fetch, "clef-flash")({ title: "Page" }, questions);

    expect(response).toEqual(result);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct123/ai/run/@cf/cloudflare/clef-flash",
    );
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: "clef-flash",
      state: { title: "Page" },
      questions,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    [401, "provider_authentication"],
    [403, "provider_authentication"],
    [400, "provider_invalid_request"],
    [404, "provider_invalid_request"],
    [422, "provider_invalid_request"],
    [429, "provider_rate_limited"],
    [500, "provider_unavailable"],
    [503, "provider_unavailable"],
  ])("maps HTTP %i to %s without exposing the token or body", async (status, code) => {
    const fetch = respond(status, {
      errors: [{ message: `AiError: Bad input: sentinel ${TOKEN}`, code: 5006 }],
      success: false,
      result: {},
      messages: [],
    });
    const error = await evaluator(fetch)({}, questions).catch((caught) => caught);
    expect(error).toMatchObject({ name: "SemanticError", code, status });
    expect(error.message).toContain("Cloudflare Workers AI");
    expect(JSON.stringify({ ...error, message: error.message })).not.toMatch(
      /sentinel|cf-secret-token/,
    );
  });

  it.each([
    ["success:false", { result, success: false, errors: [], messages: [] }],
    ["missing result", { success: true, errors: [], messages: [] }],
    ["null result", { result: null, success: true }],
    ["non-object result", { result: "sentinel", success: true }],
    ["array result", { result: [result], success: true }],
    ["non-object envelope", ["sentinel"]],
    ["non-JSON body", `<html>sentinel ${TOKEN}</html>`],
  ])("maps a 200 response with %s to provider_invalid_response", async (_label, body) => {
    const error = await evaluator(respond(200, body))({}, questions).catch((caught) => caught);
    expect(error).toMatchObject({ code: "provider_invalid_response", status: 200 });
    expect(error.message).not.toMatch(/sentinel|cf-secret-token/);
  });

  it("maps network failure to provider_unavailable without retrying", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError(`fetch failed ${TOKEN}`);
    });
    const error = await evaluator(fetch)({}, questions).catch((caught) => caught);
    expect(error).toMatchObject({ code: "provider_unavailable" });
    expect(error.message).not.toContain(TOKEN);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("maps a caller abort to provider_cancelled", async () => {
    const controller = new AbortController();
    const fetch = hangingFetch();
    const pending = evaluator(fetch)({}, questions, { signal: controller.signal }).catch(
      (caught) => caught,
    );
    controller.abort();
    const error = await pending;
    expect(error).toMatchObject({ code: "provider_cancelled" });
    expect(error.message).not.toContain(TOKEN);
  });

  it("maps an already-aborted caller signal to provider_cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await evaluator(hangingFetch())({}, questions, {
      signal: controller.signal,
    }).catch((caught) => caught);
    expect(error).toMatchObject({ code: "provider_cancelled" });
  });

  it("times out after the semantic policy timeout with provider_timeout", async () => {
    vi.useFakeTimers();
    try {
      let settled = false;
      const pending = evaluator(hangingFetch())({}, questions)
        .catch((caught) => caught)
        .finally(() => {
          settled = true;
        });
      await vi.advanceTimersByTimeAsync(4_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const error = await pending;
      expect(error).toMatchObject({ code: "provider_timeout" });
      expect(error.message).not.toContain(TOKEN);
    } finally {
      vi.useRealTimers();
    }
  });
});
