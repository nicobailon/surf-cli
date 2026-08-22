import { afterEach, describe, expect, it, vi } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const jobs = require("../../native/oracle-jobs.cjs");
const roots: string[] = [];
const originalStateDir = process.env.SURF_STATE_DIR;

function useTempState() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "surf-oracle-jobs-"));
  roots.push(parent);
  process.env.SURF_STATE_DIR = path.join(parent, "state");
  return process.env.SURF_STATE_DIR;
}

afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  if (originalStateDir === undefined) {
    delete process.env.SURF_STATE_DIR;
  } else {
    process.env.SURF_STATE_DIR = originalStateDir;
  }
});

describe("oracle job registry", () => {
  it("persists the complete created-to-captured round trip", () => {
    const root = useTempState();
    const created = jobs.createJob({
      prompt: "Review this verbatim.\n",
      contextManifest: { files: [{ path: "src/a.ts", bytes: 12 }] },
      model: "pro",
      effortRequested: "extended",
    });
    expect(created.id).toMatch(/^\d{8}-\d{6}-[0-9a-f]{4}$/);
    expect(Object.keys(created)).toEqual([
      "id",
      "state",
      "model",
      "modelRequested",
      "modelVerified",
      "effortRequested",
      "effortVerified",
      "promptDigest",
      "createdAt",
      "dispatchedAt",
      "awaitingAt",
      "capturedAt",
      "failedAt",
      "tabId",
      "conversationUrl",
      "promptEcho",
      "error",
      "turns",
    ]);

    jobs.markDispatched(created.id, {
      tabId: 42,
      modelVerified: "ChatGPT 5.4 Pro",
      effortVerified: "Extended",
    });
    jobs.markAwaiting(created.id, {
      conversationUrl: "https://chatgpt.com/c/conversation-id",
      promptEcho: "Review this verbatim.",
    });
    const captured = jobs.markCaptured(created.id, {
      response: "The answer.\n",
      messageId: "message-id",
      tookMs: 250,
    });
    const turn = {
      prompt: "Challenge the conclusion.",
      dispatchedAt: "2026-07-29T12:00:00.000Z",
      capturedAt: null,
    };
    const withTurn = jobs.appendTurn(created.id, turn);

    expect(jobs.getJob(created.id)).toEqual(withTurn);
    expect(withTurn.turns).toEqual([turn]);
    expect(captured).toMatchObject({
      state: "captured",
      model: "ChatGPT 5.4 Pro",
      modelRequested: "pro",
      modelVerified: "ChatGPT 5.4 Pro",
      effortVerified: "Extended",
      promptDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      tabId: 42,
      conversationUrl: "https://chatgpt.com/c/conversation-id",
      promptEcho: "Review this verbatim.",
      error: null,
    });
    expect(captured.dispatchedAt).toEqual(expect.any(String));
    expect(captured.awaitingAt).toEqual(expect.any(String));
    expect(captured.capturedAt).toEqual(expect.any(String));

    const directory = path.join(root, "oracle", created.id);
    expect(fs.readFileSync(path.join(directory, "request.md"), "utf8")).toBe(
      "Review this verbatim.\n",
    );
    expect(
      JSON.parse(fs.readFileSync(path.join(directory, "context-manifest.json"), "utf8")),
    ).toEqual({ files: [{ path: "src/a.ts", bytes: 12 }] });
    expect(fs.readFileSync(path.join(directory, "response.md"), "utf8")).toBe("The answer.\n");
    expect(jobs.getResponse(created.id)).toBe("The answer.\n");
    expect(JSON.parse(fs.readFileSync(path.join(directory, "turns", "0001.json"), "utf8"))).toEqual(
      turn,
    );
    expect(fs.statSync(path.join(directory, "job.json")).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.join(directory, "turns")).mode & 0o777).toBe(0o700);
  });

  it("deduplicates exact request ids and rejects conflicting reuse", () => {
    useTempState();
    const first = jobs.createJob({
      prompt: "first",
      contextManifest: { files: [{ path: "src/a.ts", bytes: 1 }] },
      model: "gpt-5.6-sol",
      effortRequested: "pro",
      requestId: "request-1",
    });

    const duplicate = jobs.createJob({
      prompt: "first",
      contextManifest: { files: [{ bytes: 1, path: "src/a.ts" }] },
      model: "gpt-5.6-sol",
      effortRequested: "pro",
      requestId: "request-1",
    });

    expect(duplicate).toMatchObject({ id: first.id, requestDeduped: true });
    expect(jobs.listJobs({})).toHaveLength(1);
    expect(() => jobs.createJob({ prompt: "different", requestId: "request-1" })).toThrow(
      expect.objectContaining({ code: "idempotency_conflict", jobId: first.id }),
    );
  });

  it("rejects capacity while naming the in-flight job", () => {
    useTempState();
    const first = jobs.createJob({ prompt: "first" });

    try {
      jobs.createJob({ prompt: "second" });
      throw new Error("expected createJob to reject capacity");
    } catch (error: any) {
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe("capacity");
      expect(error.jobId).toBe(first.id);
      expect(error.message).toContain(first.id);
    }
  });

  it("records follow lineage, capture time, and replacement tabs", () => {
    const root = useTempState();
    const parent = jobs.createJob({ prompt: "first" });
    jobs.markDispatched(parent.id, { tabId: 6, promptEcho: "first" });
    jobs.markAwaiting(parent.id, {
      conversationUrl: "https://chatgpt.com/c/conversation-id",
      promptEcho: "first",
    });
    jobs.markCaptured(parent.id, { response: "first answer" });
    const child = jobs.createJob({ prompt: "follow", follow: parent.id });
    const dispatched = jobs.markDispatched(child.id, { tabId: 7, promptEcho: "follow" });
    jobs.appendTurn(parent.id, {
      prompt: "follow",
      dispatchedAt: dispatched.dispatchedAt,
      childJobId: child.id,
      requestId: "follow-request",
    });
    jobs.appendTurn(parent.id, {
      prompt: "follow",
      dispatchedAt: dispatched.dispatchedAt,
      childJobId: child.id,
      requestId: "follow-request",
    });
    const updated = jobs.updateTabId(child.id, 8);
    jobs.markAwaiting(child.id, {
      conversationUrl: "https://chatgpt.com/c/conversation-id",
      promptEcho: "follow",
    });
    const captured = jobs.markCaptured(child.id, { response: "follow answer" });

    const lineage = jobs.markTurnCaptured(parent.id, {
      dispatchedAt: "wrong-dispatch-time",
      capturedAt: captured.capturedAt,
      childJobId: child.id,
      requestId: "follow-request",
    });

    expect(updated).toMatchObject({ follow: parent.id, tabId: 8, promptEcho: "follow" });
    expect(lineage.turns[0]).toMatchObject({
      prompt: "follow",
      dispatchedAt: captured.dispatchedAt,
      capturedAt: captured.capturedAt,
      childJobId: child.id,
      requestId: "follow-request",
    });
    expect(
      JSON.parse(
        fs.readFileSync(path.join(root, "oracle", parent.id, "turns", "0001.json"), "utf8"),
      ),
    ).toEqual(lineage.turns[0]);
  });

  it("hydrates metadata for jobs persisted by the released schema", () => {
    const root = useTempState();
    const job = jobs.createJob({ prompt: "legacy prompt", model: "pro", effortRequested: "pro" });
    jobs.markDispatched(job.id, {
      tabId: 7,
      promptEcho: "legacy prompt",
      modelVerified: "ChatGPT 5.6 Sol",
      effortVerified: "Pro",
    });
    jobs.markAwaiting(job.id, {
      conversationUrl: "https://chatgpt.com/c/conversation-id",
      promptEcho: "legacy prompt",
    });
    const jobPath = path.join(root, "oracle", job.id, "job.json");
    const legacy = JSON.parse(fs.readFileSync(jobPath, "utf8"));
    legacy.modelRequested = undefined;
    legacy.modelVerified = undefined;
    legacy.promptDigest = undefined;
    fs.writeFileSync(jobPath, `${JSON.stringify(legacy, null, 2)}\n`);

    expect(jobs.getJob(job.id)).toMatchObject({
      model: "ChatGPT 5.6 Sol",
      modelRequested: null,
      modelVerified: "ChatGPT 5.6 Sol",
      promptDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    expect(jobs.listJobs({ limit: 1 })[0]).toMatchObject({
      modelVerified: "ChatGPT 5.6 Sol",
      promptDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
  });

  it("rejects illegal state transitions with the amended taxonomy code", () => {
    useTempState();
    const job = jobs.createJob({ prompt: "prompt" });

    try {
      jobs.markAwaiting(job.id, {
        conversationUrl: "https://chatgpt.com/c/conversation-id",
        promptEcho: "prompt",
      });
      throw new Error("expected markAwaiting to reject the transition");
    } catch (error: any) {
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe("invalid_transition");
      expect(error.message).toContain(`${job.id} cannot transition from created to awaiting`);
    }
  });

  it("discovers only non-terminal orphan jobs without changing them", () => {
    useTempState();
    const terminal = jobs.createJob({ prompt: "finished" });
    jobs.markFailed(terminal.id, { code: "timeout", message: "timed out" });
    const orphan = jobs.createJob({ prompt: "orphan" });
    jobs.markDispatched(orphan.id, { tabId: 7 });
    const before = jobs.getJob(orphan.id);

    expect(jobs.adoptOrphans()).toEqual([before]);
    expect(jobs.getJob(orphan.id)).toEqual(before);
  });

  it("lists jobs newest-first and honors the limit", () => {
    useTempState();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));
    const older = jobs.createJob({ prompt: "older" });
    jobs.markFailed(older.id, { code: "timeout", message: "timed out" });
    vi.setSystemTime(new Date("2026-07-29T12:00:01.000Z"));
    const newer = jobs.createJob({ prompt: "newer" });

    expect(jobs.listJobs({}).map((job: { id: string }) => job.id)).toEqual([newer.id, older.id]);
    expect(jobs.listJobs({ limit: 1 })).toEqual([jobs.getJob(newer.id)]);
  });
});
