import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeMock, resetChromeMock } from "../../mocks/chrome";

vi.mock("../../../src/native/port-manager", () => ({
  initNativeMessaging: vi.fn(),
  postToNativeHost: vi.fn(),
}));

async function loadHandleMessage() {
  vi.resetModules();
  (globalThis as any).chrome = createChromeMock();
  const mod = await import("../../../src/service-worker/index");
  return mod.handleMessage;
}

function mockRuntimeEvaluate(chrome: ReturnType<typeof createChromeMock>) {
  chrome.debugger.sendCommand.mockImplementation(
    async (_target: any, method: string, params?: any) => {
      if (method !== "Runtime.evaluate") {
        return {};
      }
      if (params.expression.includes("if(!window.piHelpers)")) {
        return { result: { value: undefined, type: "undefined" } };
      }

      try {
        const evaluateExpression = new Function(`return (${params.expression});`);
        const value = await evaluateExpression();
        return { result: { value, type: typeof value } };
      } catch (error) {
        return {
          exceptionDetails: {
            text: error instanceof Error ? error.message : String(error),
            exception: { description: error instanceof Error ? error.toString() : String(error) },
          },
        };
      }
    },
  );
}

describe("JavaScript command handlers", () => {
  beforeEach(() => {
    resetChromeMock();
  });

  it("returns final expression values", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    mockRuntimeEvaluate(chrome);

    const result = await handleMessage({ type: "EXECUTE_JAVASCRIPT", tabId: 1, code: "1 + 2" }, {});

    expect(result).toEqual({ output: "3" });
  });

  it("returns multiline member chain expressions", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    mockRuntimeEvaluate(chrome);

    const result = await handleMessage(
      {
        type: "EXECUTE_JAVASCRIPT",
        tabId: 1,
        code: "({ nested: { value: 42 } })\n  .nested\n  .value",
      },
      {},
    );

    expect(result).toEqual({ output: "42" });
  });

  it("returns expressions with trailing line comments", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    mockRuntimeEvaluate(chrome);

    const result = await handleMessage(
      { type: "EXECUTE_JAVASCRIPT", tabId: 1, code: "1 + 2 // trailing comment" },
      {},
    );

    expect(result).toEqual({ output: "3" });
  });

  it("returns regex literal expressions", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    mockRuntimeEvaluate(chrome);

    const result = await handleMessage(
      { type: "EXECUTE_JAVASCRIPT", tabId: 1, code: "/;/.test(';')" },
      {},
    );

    expect(result).toEqual({ output: "true" });
  });

  it("preserves explicit returns through SyntaxError fallback", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    mockRuntimeEvaluate(chrome);

    const result = await handleMessage(
      { type: "EXECUTE_JAVASCRIPT", tabId: 1, code: "return Promise.resolve('done')" },
      {},
    );

    expect(result).toEqual({ output: '"done"' });
  });

  it("awaits final expression promises", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    mockRuntimeEvaluate(chrome);

    const result = await handleMessage(
      { type: "EXECUTE_JAVASCRIPT", tabId: 1, code: "await Promise.resolve({ ok: true })" },
      {},
    );

    expect(result).toEqual({ output: '{\n  "ok": true\n}' });
  });

  it("preserves runtime errors without falling back", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    mockRuntimeEvaluate(chrome);

    const result = await handleMessage(
      { type: "EXECUTE_JAVASCRIPT", tabId: 1, code: "missingValue.property" },
      {},
    );

    const evaluations = chrome.debugger.sendCommand.mock.calls.filter(
      ([, method]: [unknown, string]) => method === "Runtime.evaluate",
    );

    expect(result.error).toContain("ReferenceError: missingValue is not defined");
    expect(evaluations).toHaveLength(2);
  });

  it("does not fall back for runtime errors whose message mentions SyntaxError", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    mockRuntimeEvaluate(chrome);

    const result = await handleMessage(
      {
        type: "EXECUTE_JAVASCRIPT",
        tabId: 1,
        code: "(() => { throw new Error('SyntaxError') })()",
      },
      {},
    );

    const evaluations = chrome.debugger.sendCommand.mock.calls.filter(
      ([, method]: [unknown, string]) => method === "Runtime.evaluate",
    );

    expect(result.error).toContain("Error: SyntaxError");
    expect(evaluations).toHaveLength(2);
  });

  it("does not fall back for runtime SyntaxError objects", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    mockRuntimeEvaluate(chrome);

    const result = await handleMessage(
      { type: "EXECUTE_JAVASCRIPT", tabId: 1, code: "(() => { throw new SyntaxError('boom') })()" },
      {},
    );

    const evaluations = chrome.debugger.sendCommand.mock.calls.filter(
      ([, method]: [unknown, string]) => method === "Runtime.evaluate",
    );

    expect(result.error).toContain("SyntaxError: boom");
    expect(evaluations).toHaveLength(2);
  });

  it("falls back to original script on expression SyntaxError", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    mockRuntimeEvaluate(chrome);

    const result = await handleMessage(
      { type: "EXECUTE_JAVASCRIPT", tabId: 1, code: "const value = 42;" },
      {},
    );

    const evaluations = chrome.debugger.sendCommand.mock.calls.filter(
      ([, method]: [unknown, string]) => method === "Runtime.evaluate",
    );

    expect(result).toEqual({ output: "undefined" });
    expect(evaluations).toHaveLength(3);
  });

  it("preserves multi-statement scripts as-is through SyntaxError fallback", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    mockRuntimeEvaluate(chrome);

    const result = await handleMessage(
      { type: "EXECUTE_JAVASCRIPT", tabId: 1, code: "const value = 40;\nvalue + 2" },
      {},
    );

    expect(result).toEqual({ output: "undefined" });
  });

  it("preserves thrown errors", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    mockRuntimeEvaluate(chrome);

    const result = await handleMessage(
      { type: "EXECUTE_JAVASCRIPT", tabId: 1, code: "throw new Error('boom')" },
      {},
    );

    expect(result.error).toContain("Error: boom");
  });

  it("preserves restricted-page errors", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    chrome.debugger.attach.mockRejectedValue(new Error("Cannot access a chrome:// URL"));

    const result = await handleMessage({ type: "EXECUTE_JAVASCRIPT", tabId: 1, code: "1 + 2" }, {});

    expect(result).toEqual({
      error:
        "Cannot control this page. Chrome restricts automation on chrome://, extensions, and web store pages.",
    });
  });
});
