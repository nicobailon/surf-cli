import { describe, expect, it, vi } from "vitest";

const fs = require("node:fs");
const path = require("node:path");

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
  it("exposes the optional GPT Pro package agent", () => {
    const root = process.cwd();
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const agent = fs.readFileSync(path.join(root, "agents", "gpt-pro.md"), "utf8");

    expect(packageJson.files).toContain("agents/");
    expect(packageJson.pi.subagents.agents).toEqual(["./agents"]);
    expect(agent).toContain("name: gpt-pro");
    expect(agent).toContain("type: external-job");
    expect(agent).toContain("provider: surf-oracle");
    expect(agent).toContain("model: gpt-5.6-sol");
    expect(agent).toContain("effort: pro");
  });

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
    const provider = createOracleExternalJobProvider(new Set(), vi.fn());

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
          start(input: Record<string, unknown>): Promise<unknown>;
        }
      | undefined;
    const dispose = registerOptionalExternalJobProvider(
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
    expect(Object.keys(provider ?? {}).sort()).toEqual([
      "followUp",
      "name",
      "reattach",
      "result",
      "start",
      "status",
    ]);
    dispose();
    expect(provider).toBeUndefined();
  });

  it("maps Surf Oracle external-job operations to pi's external-job contract", async () => {
    const jobIds = new Set<string>();
    const requests: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const request = vi.fn(async (tool: string, args: Record<string, unknown>) => {
      requests.push({ tool, args });
      const details: Record<string, unknown> = {
        id: tool === "oracle.ask" ? "job-started" : String(args.id),
        state: "awaiting",
        conversationUrl: "https://chatgpt.com/c/conversation-id",
      };
      if (tool === "oracle.result") {
        details.state = "captured";
        details.response = "answer\n";
      }
      return { content: [{ type: "text", text: "{}" }], details };
    });
    const provider = createOracleExternalJobProvider(jobIds, request, undefined, undefined, {
      followUp: true,
    });

    await expect(
      provider.start({
        prompt: "review",
        model: "gpt-5.5",
        effort: "thinking",
        options: { model: "pro", effort: "pro" },
      }),
    ).resolves.toEqual({
      providerJobId: "job-started",
      state: "running",
      conversationUrl: "https://chatgpt.com/c/conversation-id",
    });
    await expect(provider.status("job-started")).resolves.toMatchObject({
      providerJobId: "job-started",
      state: "completed",
    });
    await expect(provider.result("job-started")).resolves.toEqual({
      providerJobId: "job-started",
      state: "completed",
      conversationUrl: "https://chatgpt.com/c/conversation-id",
      output: "answer",
    });
    await provider.reattach("job-started");

    expect(jobIds.has("job-started")).toBe(true);
    expect(requests).toEqual([
      { tool: "oracle.ask", args: { prompt: "review", model: "pro", effort: "pro" } },
      { tool: "oracle.result", args: { id: "job-started", timeout: 5 } },
      { tool: "oracle.result", args: { id: "job-started" } },
      { tool: "oracle.result", args: { id: "job-started", timeout: 5 } },
    ]);
  });

  it("falls back to oracle.status when bounded status harvest reports a failed job", async () => {
    const requests: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const provider = createOracleExternalJobProvider(
      new Set(),
      async (tool: string, args: Record<string, unknown>) => {
        requests.push({ tool, args });
        if (tool === "oracle.result") {
          return {
            content: [{ type: "text", text: "harvest failed" }],
            details: { code: "harvest_failed", jobId: "failed-job", message: "harvest failed" },
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: "{}" }],
          details: {
            id: "failed-job",
            state: "failed",
            error: { code: "harvest_failed", message: "harvest failed" },
          },
        };
      },
    );

    await expect(provider.status("failed-job")).resolves.toEqual({
      providerJobId: "failed-job",
      state: "failed",
      failureCode: "harvest_failed",
      failureMessage: "harvest failed",
    });
    expect(requests).toEqual([
      { tool: "oracle.result", args: { id: "failed-job", timeout: 5 } },
      { tool: "oracle.status", args: { id: "failed-job" } },
    ]);
  });

  it("preserves aborted oracle requests without fallback or terminal wake events", async () => {
    const emitted: Array<{ id: string; state: string }> = [];
    const request = vi.fn(async () => ({
      content: [{ type: "text", text: "request aborted" }],
      details: { code: "SURF_REQUEST_ABORTED", jobId: "running-job", message: "request aborted" },
      isError: true,
    }));
    const provider = createOracleExternalJobProvider(
      new Set(),
      request,
      undefined,
      (job: { id: string; state: string }) => {
        emitted.push(job);
        return true;
      },
    );

    await expect(provider.status("running-job")).rejects.toMatchObject({
      code: "SURF_REQUEST_ABORTED",
      jobId: "running-job",
    });
    await expect(provider.result("running-job")).rejects.toMatchObject({
      code: "SURF_REQUEST_ABORTED",
      jobId: "running-job",
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(emitted).toEqual([]);
  });

  it("maps external-job follow-ups to Surf Oracle follow requests", async () => {
    const jobIds = new Set<string>();
    const requests: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const provider = createOracleExternalJobProvider(
      jobIds,
      async (tool: string, args: Record<string, unknown>) => {
        requests.push({ tool, args });
        return {
          content: [{ type: "text", text: "{}" }],
          details: {
            id: "follow-job",
            state: "awaiting",
            follow: args.follow,
            requestId: args.requestId,
          },
        };
      },
      undefined,
      undefined,
      { followUp: true },
    );

    await expect(
      provider.followUp?.({
        parentProviderJobId: "parent-job",
        prompt: "continue",
        requestId: "follow-request",
        options: { model: "pro", effort: "pro" },
      }),
    ).resolves.toMatchObject({ providerJobId: "follow-job", state: "running" });

    expect(jobIds.has("follow-job")).toBe(true);
    expect(requests).toEqual([
      {
        tool: "oracle.ask",
        args: {
          prompt: "continue",
          follow: "parent-job",
          model: "pro",
          effort: "pro",
          requestId: "follow-request",
        },
      },
    ]);
  });

  it("maps failed oracle jobs to pi failure fields and rejects unknown states", async () => {
    const provider = createOracleExternalJobProvider(
      new Set(),
      async (_tool: string, args: Record<string, unknown>) => {
        let details: Record<string, unknown>;
        if (args.id === "weird-job") {
          details = { id: "weird-job", state: "harvesting" };
        } else if (args.id === "malformed-job") {
          details = { id: "malformed-job", state: "failed", error: { code: 500 } };
        } else {
          details = {
            id: "failed-job",
            state: "failed",
            conversationUrl: null,
            error: { code: "harvest_failed", message: " harvest failed " },
          };
        }
        return { content: [{ type: "text", text: "{}" }], details };
      },
    );

    await expect(provider.status("failed-job")).resolves.toEqual({
      providerJobId: "failed-job",
      state: "failed",
      failureCode: "harvest_failed",
      failureMessage: "harvest failed",
    });
    await expect(provider.status("weird-job")).rejects.toThrow(/unknown state 'harvesting'/);
    await expect(provider.status("malformed-job")).rejects.toThrow(/invalid failure code/);
  });

  it("registers reattached active jobs as background work", async () => {
    const jobIds = new Set<string>();
    const provider = createOracleExternalJobProvider(jobIds, async () => ({
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

    await provider.status("done");
    await provider.result("done");
    await provider.reattach("done");

    expect(emitted).toEqual([
      { id: "done", state: "captured" },
      { id: "done", state: "captured" },
      { id: "done", state: "captured" },
    ]);
  });

  it("emits the oracle finished wake channel for provider result failures", async () => {
    const emitted: Array<{ id: string; state: string }> = [];
    const provider = createOracleExternalJobProvider(
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
    const provider = createOracleExternalJobProvider(jobIds, request, (jobId: string) =>
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

    await expect(started).resolves.toMatchObject({ providerJobId: "late-job", state: "running" });
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
    const provider = createOracleExternalJobProvider(new Set(), request);

    await expect(provider.start({ prompt: "review" })).rejects.toMatchObject({
      code: "capacity",
      jobId: "blocking-job",
      blockingJobId: "blocking-job",
      message: "oracle job capacity reached; in-flight job: blocking-job",
    });
  });
});
