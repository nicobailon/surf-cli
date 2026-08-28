import { afterEach, vi } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
type ChatGptDispatchOptions = {
  startUrl?: string | null;
  file?: string | string[];
  github?: boolean;
  createTab(): Promise<{ tabId?: number }>;
  afterSubmit(result: {
    tabId: number;
    promptEcho: string;
    modelVerified?: string;
    effortVerified?: string;
  }): unknown;
};
const chatgptClient = require("../../native/chatgpt-client.cjs") as {
  dispatch(options: ChatGptDispatchOptions): Promise<{
    tabId: number;
    conversationUrl: string;
    promptEcho: string;
  }>;
  harvest(options: Record<string, unknown>): Promise<{ response: string }>;
};
const oracleJobs = require("../../native/oracle-jobs.cjs");
const { assertLocalOracleRequest, createOracleHost } = require("../../native/oracle-host.cjs");

const roots: string[] = [];
const originalStateDir = process.env.SURF_STATE_DIR;

function useTempState() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "surf-oracle-host-"));
  roots.push(parent);
  process.env.SURF_STATE_DIR = path.join(parent, "state");
  return process.env.SURF_STATE_DIR;
}

function createHost(requestCallExtension: ReturnType<typeof vi.fn>) {
  return createOracleHost({
    queueAiRequest: (operation: () => unknown) => operation(),
    requestCallExtension,
    buildProviderUploadMessage: vi.fn(),
    log: vi.fn(),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  if (originalStateDir === undefined) {
    delete process.env.SURF_STATE_DIR;
  } else {
    process.env.SURF_STATE_DIR = originalStateDir;
  }
});

describe("oracle host request guard", () => {
  it("rejects the existing remote request context with a structured code", () => {
    expect(() => assertLocalOracleRequest({ context: { isRemote: true } })).toThrow(
      expect.objectContaining({
        code: "remote_unsupported",
        message: "oracle tools are not supported for remote clients",
      }),
    );
  });

  it("allows local request contexts", () => {
    expect(() => assertLocalOracleRequest({ context: { isRemote: false } })).not.toThrow();
  });
});

describe("oracle host recovery", () => {
  it("persists the context manifest received by oracle.ask", async () => {
    const root = useTempState();
    vi.spyOn(chatgptClient, "dispatch").mockImplementation(async (options) => {
      await options.afterSubmit({ tabId: 7, promptEcho: "review" });
      return {
        tabId: 7,
        conversationUrl: "https://chatgpt.com/c/conversation-id",
        promptEcho: "review",
      };
    });
    const host = createHost(vi.fn());
    const contextManifest = { files: [{ path: "src/a.ts", bytes: 12 }] };

    const result = await host.handle(
      { context: { isRemote: false } },
      { type: "ORACLE_ASK", prompt: "review", contextManifest },
    );

    expect(result.state).toBe("awaiting");
    expect(
      JSON.parse(
        fs.readFileSync(path.join(root, "oracle", result.id, "context-manifest.json"), "utf8"),
      ),
    ).toEqual(contextManifest);
  });

  it("passes a validated attachment and GitHub context through Oracle dispatch", async () => {
    const root = useTempState();
    const attachment = path.join(root, "report.md");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(attachment, "report");
    vi.spyOn(chatgptClient, "dispatch").mockImplementation(async (options) => {
      expect(options.file).toBe(attachment);
      expect(options.github).toBe(true);
      await options.afterSubmit({ tabId: 7, promptEcho: "review" });
      return {
        tabId: 7,
        conversationUrl: "https://chatgpt.com/c/conversation-id",
        promptEcho: "review",
      };
    });
    const host = createHost(vi.fn());

    const result = await host.handle(
      { context: { isRemote: false } },
      { type: "ORACLE_ASK", prompt: "review", file: attachment, github: true },
    );

    expect(result.state).toBe("awaiting");
  });

  it("rejects an inaccessible Oracle attachment before creating a job", async () => {
    useTempState();
    const dispatch = vi.spyOn(chatgptClient, "dispatch");
    const host = createHost(vi.fn());

    await expect(
      host.handle(
        { context: { isRemote: false } },
        { type: "ORACLE_ASK", prompt: "review", file: "/tmp/surf-oracle-missing-attachment" },
      ),
    ).rejects.toMatchObject({
      code: "attachment_file_access",
      message: expect.stringContaining("Oracle attachment file access failed"),
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("deduplicates repeated oracle.ask requests by requestId", async () => {
    useTempState();
    const dispatch = vi.spyOn(chatgptClient, "dispatch").mockImplementation(async (options) => {
      await options.afterSubmit({ tabId: 7, promptEcho: "review" });
      return {
        tabId: 7,
        conversationUrl: "https://chatgpt.com/c/conversation-id",
        promptEcho: "review",
      };
    });
    const host = createHost(vi.fn());

    const first = await host.handle(
      { context: { isRemote: false } },
      { type: "ORACLE_ASK", prompt: "review", requestId: "request-1" },
    );
    const duplicate = await host.handle(
      { context: { isRemote: false } },
      { type: "ORACLE_ASK", prompt: "review", requestId: "request-1" },
    );

    expect(duplicate.id).toBe(first.id);
    expect(dispatch).toHaveBeenCalledTimes(1);
    await expect(
      host.handle(
        { context: { isRemote: false } },
        { type: "ORACLE_ASK", prompt: "different", requestId: "request-1" },
      ),
    ).rejects.toMatchObject({ code: "idempotency_conflict", jobId: first.id });
  });

  it("deduplicates before validating a generated context bundle", async () => {
    const root = useTempState();
    const bundlePath = path.join(root, "bundle.txt");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(bundlePath, "bundle");
    const dispatch = vi.spyOn(chatgptClient, "dispatch").mockImplementation(async (options) => {
      await options.afterSubmit({ tabId: 7, promptEcho: "review" });
      return {
        tabId: 7,
        conversationUrl: "https://chatgpt.com/c/conversation-id",
        promptEcho: "review",
      };
    });
    const host = createHost(vi.fn());
    const contextManifest = {
      mode: "bundle",
      files: [{ path: "src/a.ts", bytes: 1, sha256: "sha" }],
    };

    const first = await host.handle(
      { context: { isRemote: false } },
      {
        type: "ORACLE_ASK",
        prompt: "review",
        contextManifest,
        bundlePath,
        requestId: "bundle-request",
      },
    );
    fs.rmSync(bundlePath);
    const duplicate = await host.handle(
      { context: { isRemote: false } },
      {
        type: "ORACLE_ASK",
        prompt: "review",
        contextManifest,
        bundlePath,
        requestId: "bundle-request",
      },
    );

    expect(duplicate.id).toBe(first.id);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("records follow turns with child and request identity", async () => {
    const root = useTempState();
    const followAttachment = path.join(root, "follow.md");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(followAttachment, "follow");
    const parent = oracleJobs.createJob({ prompt: "first" });
    oracleJobs.markDispatched(parent.id, { tabId: 6, promptEcho: "first" });
    oracleJobs.markAwaiting(parent.id, {
      conversationUrl: "https://chatgpt.com/c/conversation-id",
      promptEcho: "first",
    });
    oracleJobs.markCaptured(parent.id, { response: "first answer" });
    vi.spyOn(chatgptClient, "dispatch").mockImplementation(async (options) => {
      expect(options.startUrl).toBe("https://chatgpt.com/c/conversation-id");
      expect(options.file).toBe(followAttachment);
      expect(options.github).toBe(true);
      await options.afterSubmit({ tabId: 8, promptEcho: "follow" });
      return {
        tabId: 8,
        conversationUrl: "https://chatgpt.com/c/conversation-id",
        promptEcho: "follow",
      };
    });
    const host = createHost(vi.fn());

    const child = await host.handle(
      { context: { isRemote: false } },
      {
        type: "ORACLE_ASK",
        prompt: "follow",
        follow: parent.id,
        file: followAttachment,
        github: true,
        requestId: "follow-request",
      },
    );

    expect(child).toMatchObject({ follow: parent.id, requestId: "follow-request" });
    expect(oracleJobs.getJob(parent.id).turns).toEqual([
      expect.objectContaining({
        prompt: "follow",
        childJobId: child.id,
        requestId: "follow-request",
      }),
    ]);
  });

  it("fails closed when a follow parent is missing", async () => {
    useTempState();
    const dispatch = vi.spyOn(chatgptClient, "dispatch").mockResolvedValue({
      tabId: 7,
      conversationUrl: "https://chatgpt.com/c/conversation-id",
      promptEcho: "follow",
    });
    const host = createHost(vi.fn());

    await expect(
      host.handle(
        { context: { isRemote: false } },
        {
          type: "ORACLE_ASK",
          prompt: "follow",
          follow: "20260729-120000-dead",
          requestId: "missing-parent",
        },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("leaves Cloudflare challenge tabs open for manual clearance", async () => {
    useTempState();
    vi.spyOn(chatgptClient, "dispatch").mockImplementation(async (options) => {
      await options.createTab();
      throw Object.assign(new Error("Cloudflare challenge detected - complete in browser"), {
        code: "cloudflare",
      });
    });
    const requestCallExtension = vi.fn(async (_request, tool) => {
      if (tool === "create_tab") {
        return { tabId: 7 };
      }
      if (tool === "close_tab") {
        return {};
      }
      throw new Error(`Unexpected extension call: ${tool}`);
    });
    const host = createHost(requestCallExtension);

    await expect(
      host.handle({ context: { isRemote: false } }, { type: "ORACLE_ASK", prompt: "review" }),
    ).rejects.toMatchObject({ code: "cloudflare" });

    expect(requestCallExtension).not.toHaveBeenCalledWith(
      expect.anything(),
      "close_tab",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("recaptures a live dispatched job URL before harvesting", async () => {
    useTempState();
    const job = oracleJobs.createJob({ prompt: "review" });
    oracleJobs.markDispatched(job.id, { tabId: 7, promptEcho: "review" });
    vi.spyOn(chatgptClient, "harvest").mockResolvedValue({ response: "answer" });
    const requestCallExtension = vi.fn(async (_request, tool) => {
      if (tool === "list_tabs") {
        return { tabs: [{ id: 7 }] };
      }
      if (tool === "cdp_evaluate") {
        return { result: { value: "https://chatgpt.com/c/conversation-id" } };
      }
      if (tool === "close_tab") {
        return {};
      }
      throw new Error(`Unexpected extension call: ${tool}`);
    });
    const host = createHost(requestCallExtension);

    const result = await host.handle(
      { context: { isRemote: false } },
      { type: "ORACLE_RESULT", id: job.id, timeout: 1 },
    );

    expect(result).toMatchObject({
      state: "captured",
      conversationUrl: "https://chatgpt.com/c/conversation-id",
      response: "answer",
    });
    expect(chatgptClient.harvest).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: 7,
        conversationUrl: "https://chatgpt.com/c/conversation-id",
      }),
    );
  });

  it("retries one fresh-tab harvest after a live-tab hard error", async () => {
    useTempState();
    const job = oracleJobs.createJob({ prompt: "review" });
    oracleJobs.markDispatched(job.id, { tabId: 7, promptEcho: "review" });
    oracleJobs.markAwaiting(job.id, {
      conversationUrl: "https://chatgpt.com/c/conversation-id",
      promptEcho: "review",
    });
    vi.spyOn(chatgptClient, "harvest")
      .mockRejectedValueOnce(Object.assign(new Error("tab closed"), { code: "harvest_failed" }))
      .mockResolvedValueOnce({ response: "recovered answer" });
    const requestCallExtension = vi.fn(async (_request, tool) => {
      if (tool === "list_tabs") {
        return { tabs: [{ id: 7 }] };
      }
      if (tool === "close_tab") {
        return {};
      }
      throw new Error(`Unexpected extension call: ${tool}`);
    });
    const host = createHost(requestCallExtension);

    const result = await host.handle(
      { context: { isRemote: false } },
      { type: "ORACLE_RESULT", id: job.id, timeout: 1 },
    );

    expect(result).toMatchObject({ state: "captured", response: "recovered answer" });
    expect(chatgptClient.harvest).toHaveBeenCalledTimes(2);
    expect(chatgptClient.harvest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        tabId: null,
        conversationUrl: "https://chatgpt.com/c/conversation-id",
      }),
    );
  });

  it("fails a dead URL-less job with the web-history recovery limitation", async () => {
    useTempState();
    const job = oracleJobs.createJob({ prompt: "review" });
    oracleJobs.markDispatched(job.id, { tabId: 7, promptEcho: "review" });
    const requestCallExtension = vi.fn(async (_request, tool) => {
      if (tool === "list_tabs") {
        return { tabs: [] };
      }
      if (tool === "close_tab") {
        return {};
      }
      throw new Error(`Unexpected extension call: ${tool}`);
    });
    const host = createHost(requestCallExtension);

    await expect(
      host.handle(
        { context: { isRemote: false } },
        { type: "ORACLE_RESULT", id: job.id, timeout: 1 },
      ),
    ).rejects.toMatchObject({
      code: "harvest_failed",
      message: expect.stringContaining(
        "response may still exist in ChatGPT web history but cannot be recovered without a conversation URL",
      ),
    });
    expect(oracleJobs.getJob(job.id)).toMatchObject({
      state: "failed",
      error: {
        code: "harvest_failed",
        message: expect.stringContaining("cannot be recovered without a conversation URL"),
      },
    });
  });
});
