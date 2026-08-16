import { describe, expect, it, vi } from "vitest";

const {
  createOracleExternalJobProvider,
  createToolRequest,
  emitOracleFinished,
  registerGlobalBackgroundProvider,
  registerGlobalExternalJobProvider,
  registerOptionalBackgroundProvider,
  registerOptionalExternalJobProvider,
  rememberOracleJobForSession,
  resolveBackgroundWorkRegister,
  resolveExternalJobProviderRegister,
  resultFromHost,
} = require("../../pi-extension/surf.ts");

const backgroundWorkKey = Symbol.for("pi-subagents.background-work.v1");
const externalJobProviderKey = Symbol.for("pi-subagents.external-job-providers.v1");

describe("Pi extension", () => {
  it("maps browser tools to the native host request frame", () => {
    const request = createToolRequest("page.read", { filter: "interactive" }, 42);

    expect(request).toMatchObject({
      type: "tool_request",
      method: "execute_tool",
      params: { tool: "page.read", args: { filter: "interactive" }, tabId: 42 },
    });
    expect(request.id).toMatch(/^pi-surf-/);
  });

  it("reports only active oracle jobs started by its Pi session", () => {
    let provider:
      | { wakeChannels: string[]; listActiveWork(): Array<{ id: string; sessionId: string }> }
      | undefined;
    const jobIds = new Set(["mine"]);
    const dispose = registerOptionalBackgroundProvider(
      "pi-session",
      jobIds,
      () => [
        { id: "mine", state: "awaiting" },
        { id: "done", state: "captured" },
        { id: "other", state: "dispatched" },
      ],
      (registered: {
        wakeChannels: string[];
        listActiveWork(): Array<{ id: string; sessionId: string }>;
      }) => {
        provider = registered;
        return () => {
          provider = undefined;
        };
      },
    );

    expect(provider?.wakeChannels).toEqual(["surf-oracle:finished"]);
    expect(provider?.listActiveWork()).toEqual([{ id: "mine", sessionId: "pi-session" }]);
    jobIds.clear();
    expect(provider?.listActiveWork()).toEqual([]);
    dispose();
    expect(provider).toBeUndefined();
  });

  it("does not remember oracle jobs that resolve after a session reset", () => {
    const jobIds = new Set<string>();

    expect(rememberOracleJobForSession(jobIds, "old-job", 1, 2, true)).toBe(false);
    expect([...jobIds]).toEqual([]);
    expect(rememberOracleJobForSession(jobIds, "current-job", 2, 2, true)).toBe(true);
    expect([...jobIds]).toEqual(["current-job"]);
    expect(rememberOracleJobForSession(jobIds, "inactive-job", 2, 2, false)).toBe(false);
    expect([...jobIds]).toEqual(["current-job"]);
  });

  it("keeps details parseable when display text is truncated", () => {
    const job = { id: "long-job", state: "captured", response: "x".repeat(21_000) };

    const result = resultFromHost({
      result: { content: [{ type: "text", text: JSON.stringify(job) }] },
    });

    expect(result.details).toEqual(job);
    expect(result.content[0]?.text).toContain("Surf output truncated");
  });

  it("keeps structured host error details available", () => {
    const result = resultFromHost({
      error: {
        content: [{ type: "text", text: "oracle job capacity reached; in-flight job: job-1" }],
        code: "capacity",
        jobId: "job-1",
        message: "oracle job capacity reached; in-flight job: job-1",
      },
    });

    expect(result).toMatchObject({
      isError: true,
      details: {
        code: "capacity",
        jobId: "job-1",
      },
    });
  });

  it("emits the oracle finished wake channel only for terminal jobs", () => {
    const emitted: Array<{ event: string; data: unknown }> = [];
    const pi = {
      events: {
        emit: (event: string, data: unknown) => emitted.push({ event, data }),
      },
    };

    expect(emitOracleFinished(pi, { id: "running", state: "awaiting" })).toBe(false);
    expect(emitOracleFinished({}, { id: "done", state: "captured" })).toBe(false);
    expect(emitOracleFinished(pi, { id: "done", state: "captured" })).toBe(true);
    expect(emitOracleFinished(pi, { id: "failed", state: "failed" })).toBe(true);

    expect(emitted).toEqual([
      { event: "surf-oracle:finished", data: { id: "done", state: "captured" } },
      { event: "surf-oracle:finished", data: { id: "failed", state: "failed" } },
    ]);
  });

  it("creates the optional pi-subagents background registry lazily", () => {
    delete (globalThis as Record<PropertyKey, unknown>)[backgroundWorkKey];
    const provider = { name: "surf-oracle", wakeChannels: [], listActiveWork: () => [] };

    const dispose = registerGlobalBackgroundProvider(provider);
    const registry = (
      globalThis as unknown as Record<PropertyKey, { providers: Map<string, unknown> }>
    )[backgroundWorkKey];

    expect(registry.providers.get("surf-oracle")).toBe(provider);
    dispose();
    expect(registry.providers.has("surf-oracle")).toBe(false);
    delete (globalThis as Record<PropertyKey, unknown>)[backgroundWorkKey];
  });

  it("creates the optional pi-subagents external-job provider registry lazily", () => {
    delete (globalThis as Record<PropertyKey, unknown>)[externalJobProviderKey];
    const provider = createOracleExternalJobProvider("pi-session", new Set(), vi.fn());

    const dispose = registerGlobalExternalJobProvider(provider);
    const registry = (
      globalThis as unknown as Record<PropertyKey, { providers: Map<string, unknown> }>
    )[externalJobProviderKey];

    expect(registry.providers.get("surf-oracle")).toBe(provider);
    dispose();
    expect(registry.providers.has("surf-oracle")).toBe(false);
    delete (globalThis as Record<PropertyKey, unknown>)[externalJobProviderKey];
  });

  it("prefers the pi-subagents background-work helper when it is available", async () => {
    const register = vi.fn(() => vi.fn());

    await expect(
      resolveBackgroundWorkRegister(async () => ({
        registerBackgroundWorkProvider: register,
      })),
    ).resolves.toBe(register);
  });

  it("keeps the global fallback when pi-subagents is not available", async () => {
    await expect(
      resolveBackgroundWorkRegister(async () => {
        throw new Error("not installed");
      }),
    ).resolves.toBe(registerGlobalBackgroundProvider);
  });

  it("prefers the pi-subagents external-job helper when it is available", async () => {
    const register = vi.fn(() => vi.fn());

    await expect(
      resolveExternalJobProviderRegister(async () => ({
        registerExternalJobProvider: register,
      })),
    ).resolves.toBe(register);
  });

  it("keeps the external-job global fallback when pi-subagents is not available", async () => {
    await expect(
      resolveExternalJobProviderRegister(async () => {
        throw new Error("not installed");
      }),
    ).resolves.toBe(registerGlobalExternalJobProvider);
  });

  it("registers a Surf Oracle external-job provider", () => {
    let provider:
      | {
          name: string;
          kind: string;
          wakeChannels: string[];
          start(input: Record<string, unknown>): Promise<unknown>;
        }
      | undefined;
    const dispose = registerOptionalExternalJobProvider(
      "pi-session",
      new Set(),
      (registered: typeof provider) => {
        provider = registered;
        return () => {
          provider = undefined;
        };
      },
      vi.fn(),
    );

    expect(provider?.name).toBe("surf-oracle");
    expect(provider?.kind).toBe("external-job");
    expect(provider?.wakeChannels).toEqual(["surf-oracle:finished"]);
    dispose();
    expect(provider).toBeUndefined();
  });

  it("maps Surf Oracle external-job operations to durable oracle tools", async () => {
    const jobIds = new Set<string>();
    const requests: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const request = vi.fn(async (tool: string, args: Record<string, unknown>) => {
      requests.push({ tool, args });
      const id = tool === "oracle.ask" ? "job-started" : String(args.id);
      return {
        content: [{ type: "text", text: "{}" }],
        details: {
          id,
          state: tool === "oracle.result" ? "captured" : "awaiting",
          conversationUrl: "https://chatgpt.com/c/conversation-id",
          modelRequested: "gpt-5.6-sol",
          modelVerified: "ChatGPT 5.6 Sol",
          effortRequested: "pro",
          effortVerified: "Pro",
          promptDigest: `sha256:${"a".repeat(64)}`,
          ...(tool === "oracle.result" ? { response: "answer" } : {}),
        },
      };
    });
    const provider = createOracleExternalJobProvider("pi-session", jobIds, request);

    await expect(
      provider.start({ prompt: "review", model: "gpt-5.6-sol", effort: "pro" }),
    ).resolves.toMatchObject({
      provider: "surf-oracle",
      id: "job-started",
      state: "awaiting",
      requestedModel: "gpt-5.6-sol",
      verifiedModel: "ChatGPT 5.6 Sol",
      requestedEffort: "pro",
      verifiedEffort: "Pro",
      promptDigest: `sha256:${"a".repeat(64)}`,
    });
    await expect(provider.status("job-started")).resolves.toMatchObject({ id: "job-started" });
    await expect(provider.result("job-started", { timeout: 1 })).resolves.toMatchObject({
      id: "job-started",
      state: "captured",
      resultText: "answer",
      resultArtifact: { kind: "inline-text", bytes: 6 },
    });
    await provider.reattach("job-started", { timeout: 2 });
    await provider.follow("job-started", "continue", { model: "gpt-5.5" });

    expect(jobIds.has("job-started")).toBe(true);
    expect(requests).toEqual([
      { tool: "oracle.ask", args: { prompt: "review", model: "gpt-5.6-sol", effort: "pro" } },
      { tool: "oracle.status", args: { id: "job-started" } },
      { tool: "oracle.result", args: { id: "job-started", timeout: 1 } },
      { tool: "oracle.result", args: { id: "job-started", timeout: 2 } },
      { tool: "oracle.ask", args: { follow: "job-started", prompt: "continue", model: "gpt-5.5" } },
    ]);
  });

  it("preserves explicit null requested model metadata", async () => {
    const provider = createOracleExternalJobProvider("pi-session", new Set(), async () => ({
      content: [{ type: "text", text: "{}" }],
      details: {
        id: "legacy-job",
        state: "awaiting",
        model: "ChatGPT 5.6 Sol",
        modelRequested: null,
        modelVerified: "ChatGPT 5.6 Sol",
      },
    }));

    await expect(provider.status("legacy-job")).resolves.toMatchObject({
      requestedModel: null,
      verifiedModel: "ChatGPT 5.6 Sol",
    });
  });

  it("registers reattached active jobs as background work", async () => {
    const jobIds = new Set<string>();
    const provider = createOracleExternalJobProvider("pi-session", jobIds, async () => ({
      content: [{ type: "text", text: "{}" }],
      details: {
        id: "existing-job",
        state: "awaiting",
        conversationUrl: "https://chatgpt.com/c/conversation-id",
      },
    }));
    let backgroundProvider:
      | { listActiveWork(): Array<{ id: string; sessionId: string }> }
      | undefined;
    registerOptionalBackgroundProvider(
      "pi-session",
      jobIds,
      () => [{ id: "existing-job", state: "awaiting" }],
      (registered: typeof backgroundProvider) => {
        backgroundProvider = registered;
        return () => undefined;
      },
    );

    await provider.reattach("existing-job");

    expect(backgroundProvider?.listActiveWork()).toEqual([
      { id: "existing-job", sessionId: "pi-session" },
    ]);
  });

  it("emits the oracle finished wake channel for provider result capture", async () => {
    const emitted: Array<{ id: string; state: string }> = [];
    const provider = createOracleExternalJobProvider(
      "pi-session",
      new Set(),
      async () => ({
        content: [{ type: "text", text: "{}" }],
        details: { id: "done", state: "captured", response: "answer" },
      }),
      undefined,
      (job: { id: string; state: string }) => {
        emitted.push(job);
        return true;
      },
    );

    await provider.result("done");
    await provider.reattach("done");

    expect(emitted).toEqual([
      { id: "done", state: "captured" },
      { id: "done", state: "captured" },
    ]);
  });

  it("emits the oracle finished wake channel for provider result failures", async () => {
    const emitted: Array<{ id: string; state: string }> = [];
    const provider = createOracleExternalJobProvider(
      "pi-session",
      new Set(),
      async () => ({
        content: [{ type: "text", text: "harvest failed" }],
        details: { code: "harvest_failed", jobId: "failed-job", message: "harvest failed" },
        isError: true,
      }),
      undefined,
      (job: { id: string; state: string }) => {
        emitted.push(job);
        return true;
      },
    );

    await expect(provider.result("failed-job")).rejects.toMatchObject({
      code: "harvest_failed",
      jobId: "failed-job",
    });
    await expect(provider.reattach("fallback-id")).rejects.toMatchObject({
      jobId: "failed-job",
    });

    expect(emitted).toEqual([
      { id: "failed-job", state: "failed" },
      { id: "failed-job", state: "failed" },
    ]);
  });

  it("does not emit terminal wake events for request errors without job ids", async () => {
    const emitted: Array<{ id: string; state: string }> = [];
    const provider = createOracleExternalJobProvider(
      "pi-session",
      new Set(),
      async () => ({
        content: [{ type: "text", text: "oracle job not found" }],
        details: { code: "not_found", message: "oracle job not found" },
        isError: true,
      }),
      undefined,
      (job: { id: string; state: string }) => {
        emitted.push(job);
        return true;
      },
    );

    await expect(provider.result("missing-job")).rejects.toMatchObject({ code: "not_found" });
    await expect(provider.reattach("missing-job")).rejects.toMatchObject({ code: "not_found" });

    expect(emitted).toEqual([]);
  });

  it("does not attribute late external-job starts to a reset session", async () => {
    const jobIds = new Set<string>();
    let currentGeneration = 1;
    let sessionActive = true;
    let resolveRequest: (value: unknown) => void = () => undefined;
    const request = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const provider = createOracleExternalJobProvider(
      "old-session",
      jobIds,
      request,
      (jobId: string) =>
        rememberOracleJobForSession(jobIds, jobId, 1, currentGeneration, sessionActive),
    );

    const started = provider.start({ prompt: "review" });
    currentGeneration = 2;
    sessionActive = false;
    jobIds.clear();
    resolveRequest({
      content: [{ type: "text", text: "{}" }],
      details: { id: "late-job", state: "awaiting" },
    });

    await expect(started).resolves.toMatchObject({ id: "late-job" });
    expect([...jobIds]).toEqual([]);
  });

  it("preserves fail-closed capacity errors for external-job starts", async () => {
    const request = vi.fn(async () => ({
      content: [{ type: "text", text: "oracle job capacity reached; in-flight job: blocking-job" }],
      details: {
        code: "capacity",
        jobId: "blocking-job",
        message: "oracle job capacity reached; in-flight job: blocking-job",
      },
      isError: true,
    }));
    const provider = createOracleExternalJobProvider("pi-session", new Set(), request);

    await expect(provider.start({ prompt: "review" })).rejects.toMatchObject({
      code: "capacity",
      jobId: "blocking-job",
      message: "oracle job capacity reached; in-flight job: blocking-job",
    });
  });
});
