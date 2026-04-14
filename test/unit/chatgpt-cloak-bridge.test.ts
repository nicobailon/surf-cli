import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

function createWorker() {
  const worker = new EventEmitter() as any;
  worker.stdout = new EventEmitter();
  worker.stderr = new EventEmitter();
  worker.stdout.setEncoding = vi.fn();
  worker.stderr.setEncoding = vi.fn();
  worker.stdin = { write: vi.fn() };
  worker.kill = vi.fn();
  return worker;
}

describe("chatgpt-cloak-bridge", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
  });

  it("maps query worker success payload", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.queryWithCloakBrowser({ query: "hello", timeout: 5 });

    expect(worker.stdin.write).toHaveBeenCalledWith(expect.stringContaining('"type":"query"'));

    worker.stdout.emit(
      "data",
      `${JSON.stringify({
        type: "success",
        response: "hi",
        model: "gpt-5.3",
        tookMs: 1234,
        backend: "cloak",
      })}\n`,
    );

    await expect(promise).resolves.toEqual({
      response: "hi",
      model: "gpt-5.3",
      tookMs: 1234,
      imagePath: null,
      partial: false,
      backend: "cloak",
      conversationId: null,
    });
    bridge.__resetBridgeRuntimeForTests();
  });

  it("uses 2700s default timeout for query workers", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.queryWithCloakBrowser({ query: "hello" });

    expect(worker.stdin.write).toHaveBeenCalledWith(expect.stringContaining('"timeout":2700'));

    worker.stdout.emit(
      "data",
      `${JSON.stringify({ type: "success", response: "hi", model: "gpt-5.4-pro", tookMs: 10, backend: "cloak" })}\n`,
    );

    await expect(promise).resolves.toMatchObject({ response: "hi", model: "gpt-5.4-pro" });
    bridge.__resetBridgeRuntimeForTests();
  });

  it("uses 120s default timeout for chats workers", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.manageChatsWithCloakBrowser({ action: "list" });

    expect(worker.stdin.write).toHaveBeenCalledWith(expect.stringContaining('"timeout":120'));

    worker.stdout.emit(
      "data",
      `${JSON.stringify({ type: "success", action: "list", items: [], total: 0, backend: "cloak" })}\n`,
    );

    await expect(promise).resolves.toMatchObject({ action: "list", total: 0 });
    bridge.__resetBridgeRuntimeForTests();
  });

  it("forwards progress and maps chats success payload", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });
    const progress = vi.fn();

    const promise = bridge.manageChatsWithCloakBrowser(
      { action: "list", limit: 2, timeout: 5 },
      progress,
    );

    worker.stdout.emit(
      "data",
      `${JSON.stringify({ type: "progress", step: 1, total: 4, message: "Loading" })}\n`,
    );
    worker.stdout.emit(
      "data",
      `${JSON.stringify({
        type: "success",
        action: "list",
        items: [{ id: "c1" }],
        total: 1,
        backend: "cloak",
      })}\n`,
    );

    await expect(promise).resolves.toEqual({
      action: "list",
      items: [{ id: "c1" }],
      total: 1,
      backend: "cloak",
    });
    expect(progress).toHaveBeenCalledWith({
      type: "progress",
      step: 1,
      total: 4,
      message: "Loading",
    });
    bridge.__resetBridgeRuntimeForTests();
  });

  it("forwards assistant-wait fields to chats workers", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.manageChatsWithCloakBrowser({
      action: "get",
      conversationId: "conv-123",
      waitForAssistant: true,
      waitForAssistantTimeoutSec: 45,
      baselineAssistantMessageId: "msg-456",
    });

    expect(worker.stdin.write).toHaveBeenCalledWith(
      expect.stringContaining('"waitForAssistant":true'),
    );
    expect(worker.stdin.write).toHaveBeenCalledWith(
      expect.stringContaining('"waitForAssistantTimeoutSec":45'),
    );
    expect(worker.stdin.write).toHaveBeenCalledWith(
      expect.stringContaining('"baselineAssistantMessageId":"msg-456"'),
    );

    worker.stdout.emit(
      "data",
      `${JSON.stringify({
        type: "success",
        action: "get",
        conversationId: "conv-123",
        conversation: { id: "conv-123" },
        stabilized: true,
        conversationState: "assistant_complete",
        waitedMs: 900,
        backend: "cloak",
      })}\n`,
    );

    await expect(promise).resolves.toMatchObject({
      action: "get",
      stabilized: true,
      conversationState: "assistant_complete",
      waitedMs: 900,
    });
    bridge.__resetBridgeRuntimeForTests();
  });

  it("propagates worker errors", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.manageChatsWithCloakBrowser({
      action: "get",
      conversationId: "bad",
      timeout: 5,
    });
    worker.stdout.emit(
      "data",
      `${JSON.stringify({
        type: "error",
        code: "conversation_not_found",
        message: "Missing",
        details: { status: 404 },
      })}\n`,
    );

    await expect(promise).rejects.toMatchObject({
      message: "Missing",
      code: "conversation_not_found",
      details: { status: 404 },
    });
    bridge.__resetBridgeRuntimeForTests();
  });

  it("does not retry chat get after clean worker_exit in headless-only mode", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.manageChatsWithCloakBrowser({
      action: "get",
      conversationId: "conv-err",
      timeout: 5,
    });

    worker.emit("close", 0, null);

    await expect(promise).rejects.toMatchObject({
      code: "worker_exit",
      exitCode: 0,
    });
    expect(spawn).toHaveBeenCalledTimes(1);

    bridge.__resetBridgeRuntimeForTests();
  });

  it("passes thinkingTrace through mapSuccess", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.queryWithCloakBrowser({ query: "think hard", timeout: 5 });

    const trace = {
      thoughts: [{ summary: "Analyzing", content: "Let me think..." }],
      durationSec: 12,
      recapText: "Thought for 12s",
      truncated: false,
    };
    worker.stdout.emit(
      "data",
      `${JSON.stringify({
        type: "success",
        response: "answer",
        model: "gpt-5-4-thinking",
        tookMs: 15000,
        backend: "cloak",
        thinkingTrace: trace,
      })}\n`,
    );

    await expect(promise).resolves.toEqual({
      response: "answer",
      model: "gpt-5-4-thinking",
      tookMs: 15000,
      imagePath: null,
      partial: false,
      backend: "cloak",
      conversationId: null,
      thinkingTrace: trace,
    });
    bridge.__resetBridgeRuntimeForTests();
  });

  it("omits thinkingTrace when not present", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.queryWithCloakBrowser({ query: "hello", timeout: 5 });

    worker.stdout.emit(
      "data",
      `${JSON.stringify({
        type: "success",
        response: "hi",
        model: "gpt-5.3",
        tookMs: 500,
        backend: "cloak",
      })}\n`,
    );

    const result = await promise;
    expect(result.thinkingTrace).toBeUndefined();
    expect("thinkingTrace" in result).toBe(false);
    bridge.__resetBridgeRuntimeForTests();
  });

  it("forwards rich thinking trace progress payload", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });
    const progress = vi.fn();

    const promise = bridge.queryWithCloakBrowser({ query: "think", timeout: 5 }, progress);

    worker.stdout.emit(
      "data",
      `${JSON.stringify({
        type: "trace",
        traceType: "thinking_text",
        phase: "Thinking",
        isThinking: true,
        thoughtText: "Plan\nFirst, inspect the inputs.",
        thoughtDelta: "Plan\nFirst, inspect the inputs.",
        thoughtCount: 1,
        durationSec: 4,
      })}\n`,
    );

    worker.stdout.emit(
      "data",
      JSON.stringify({ type: "success", response: "done", model: "gpt-5-4-pro", tookMs: 1000 }) +
        "\n",
    );

    await promise;

    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "trace",
        traceType: "thinking_text",
        phase: "Thinking",
        isThinking: true,
        thoughtText: "Plan\nFirst, inspect the inputs.",
        thoughtDelta: "Plan\nFirst, inspect the inputs.",
        thoughtCount: 1,
        durationSec: 4,
      }),
    );

    bridge.__resetBridgeRuntimeForTests();
  });

  it("forwards sent checkpoint metadata", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });
    const progressSpy = vi.fn();

    const promise = bridge.queryWithCloakBrowser({ query: "hello", timeout: 5 }, progressSpy);
    const sentAt = "2026-04-05T12:34:56.000Z";

    worker.stdout.emit(
      "data",
      `${JSON.stringify({
        type: "meta_update",
        lastCheckpoint: "sent",
        sentAt,
        conversationId: "conv-123",
        baselineAssistantMessageId: "msg-456",
        source: "pre_phase_6",
      })}\n`,
    );
    worker.stdout.emit(
      "data",
      `${JSON.stringify({ type: "success", response: "done", model: "gpt-5.3", tookMs: 100 })}\n`,
    );

    await promise;

    expect(progressSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "meta_update",
        lastCheckpoint: "sent",
        sentAt,
        conversationId: "conv-123",
        baselineAssistantMessageId: "msg-456",
        source: "pre_phase_6",
      }),
    );

    bridge.__resetBridgeRuntimeForTests();
  });

  it("times out workers", async () => {
    vi.useFakeTimers();
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.manageChatsWithCloakBrowser({ action: "list", timeout: 1 });
    const rejection = expect(promise).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(1000);

    await rejection;
    expect(worker.kill).toHaveBeenCalledWith("SIGTERM");
    bridge.__resetBridgeRuntimeForTests();
  });

  it("resets the worker timer on keepalive activity", async () => {
    vi.useFakeTimers();
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.queryWithCloakBrowser({ query: "hello", timeout: 1 });

    await vi.advanceTimersByTimeAsync(900);
    worker.stdout.emit("data", `${JSON.stringify({ type: "keepalive", reason: "text" })}\n`);
    await vi.advanceTimersByTimeAsync(900);

    expect(worker.kill).not.toHaveBeenCalled();

    worker.stdout.emit(
      "data",
      `${JSON.stringify({ type: "success", response: "done", model: "gpt-5.4-pro", tookMs: 1500, backend: "cloak" })}\n`,
    );

    await expect(promise).resolves.toMatchObject({ response: "done", model: "gpt-5.4-pro" });
    bridge.__resetBridgeRuntimeForTests();
  });

  it("resets the chats worker timer on keepalive activity", async () => {
    vi.useFakeTimers();
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.manageChatsWithCloakBrowser({
      action: "get",
      conversationId: "conv-123",
      timeout: 1,
    });

    await vi.advanceTimersByTimeAsync(900);
    worker.stdout.emit(
      "data",
      `${JSON.stringify({ type: "keepalive", reason: "wait_for_assistant" })}\n`,
    );
    await vi.advanceTimersByTimeAsync(900);

    expect(worker.kill).not.toHaveBeenCalled();

    worker.stdout.emit(
      "data",
      `${JSON.stringify({ type: "success", action: "get", conversationId: "conv-123", conversation: {}, backend: "cloak" })}\n`,
    );

    await expect(promise).resolves.toMatchObject({ action: "get", conversationId: "conv-123" });
    bridge.__resetBridgeRuntimeForTests();
  });

  it("forwards keepalive messages to progress callbacks", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });
    const progressSpy = vi.fn();

    const promise = bridge.queryWithCloakBrowser({ query: "hello", timeout: 5 }, progressSpy);
    worker.stdout.emit(
      "data",
      `${JSON.stringify({ type: "keepalive", reason: "response_wait", phase: "Reasoning", elapsedMs: 12000, conversationId: "conv-1", conversationState: "assistant_in_progress" })}\n`,
    );
    worker.stdout.emit(
      "data",
      `${JSON.stringify({ type: "success", response: "done", model: "gpt-5.4-pro", tookMs: 100 })}\n`,
    );

    await promise;

    expect(progressSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "keepalive",
        reason: "response_wait",
        phase: "Reasoning",
        elapsedMs: 12000,
        conversationId: "conv-1",
        conversationState: "assistant_in_progress",
      }),
    );

    bridge.__resetBridgeRuntimeForTests();
  });

  it("does not let log chatter extend the worker timer", async () => {
    vi.useFakeTimers();
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.queryWithCloakBrowser({ query: "hello", timeout: 1 });
    const rejection = expect(promise).rejects.toMatchObject({ code: "timeout" });

    await vi.advanceTimersByTimeAsync(900);
    worker.stdout.emit(
      "data",
      `${JSON.stringify({ type: "log", level: "warn", message: "Cloudflare challenge detected, waiting..." })}\n`,
    );
    await vi.advanceTimersByTimeAsync(100);

    await rejection;
    expect(worker.kill).toHaveBeenCalledWith("SIGTERM");
    bridge.__resetBridgeRuntimeForTests();
  });
});
