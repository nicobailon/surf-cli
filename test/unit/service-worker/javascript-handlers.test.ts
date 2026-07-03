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

describe("Animation audit handler", () => {
  beforeEach(() => {
    resetChromeMock();
  });

  it("runs a bounded in-page sampler and returns the timeline", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    chrome.debugger.sendCommand.mockImplementation(
      async (_target: any, method: string, params?: any) => {
        if (method !== "Runtime.evaluate") {
          return {};
        }
        expect(params.returnByValue).toBe(true);
        expect(params.awaitPromise).toBe(true);
        expect(params.expression).toContain('const selector = ".thing"');
        expect(params.expression).toContain("const durationMs = 500");
        expect(params.expression).toContain("const fps = 5");
        expect(params.expression).toContain("const maxElements = 25");
        return {
          result: {
            value: {
              selector: ".thing",
              durationMs: 500,
              fps: 5,
              sampleCount: 1,
              samples: [
                {
                  t: 0,
                  timestamp: 123,
                  elements: [
                    {
                      selector: ".thing",
                      index: 0,
                      rect: { x: 1, y: 2, width: 3, height: 4 },
                      opacity: "1",
                      transform: "none",
                      visibility: "visible",
                      display: "block",
                      text: "Hello",
                    },
                  ],
                },
              ],
            },
            type: "object",
          },
        };
      },
    );

    const result = await handleMessage(
      { type: "ANIMATE_AUDIT", tabId: 1, selector: ".thing", durationMs: 500, fps: 5 },
      {},
    );

    expect(result).toMatchObject({
      selector: ".thing",
      durationMs: 500,
      fps: 5,
      sampleCount: 1,
    });
    expect(result.samples[0].elements[0]).toMatchObject({
      rect: { x: 1, y: 2, width: 3, height: 4 },
      opacity: "1",
      transform: "none",
      visibility: "visible",
      display: "block",
      text: "Hello",
    });
  });

  it("validates animate-audit numeric inputs in the service worker", async () => {
    const handleMessage = await loadHandleMessage();

    await expect(
      handleMessage({ type: "ANIMATE_AUDIT", tabId: 1, selector: ".thing", durationMs: true }, {}),
    ).rejects.toThrow("duration must be a number");
    await expect(
      handleMessage({ type: "ANIMATE_AUDIT", tabId: 1, selector: ".thing", fps: true }, {}),
    ).rejects.toThrow("fps must be a number");
    await expect(
      handleMessage({ type: "ANIMATE_AUDIT", tabId: 1, selector: ".thing", durationMs: 10001 }, {}),
    ).rejects.toThrow("duration must be between 100 and 10000 ms");
    await expect(
      handleMessage({ type: "ANIMATE_AUDIT", tabId: 1, selector: ".thing", fps: 31 }, {}),
    ).rejects.toThrow("fps must be between 1 and 30");
  });

  it("captures perf-audit snapshots", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    chrome.debugger.sendCommand.mockResolvedValue({
      result: {
        value: {
          durationMs: 500,
          observedEntryTypes: ["layout-shift", "event"],
          trigger: { action: "click", selector: ".cta", fired: true },
          summary: {
            cumulativeLayoutShift: 0.12,
            maxEventDuration: 40,
            counts: { layoutShifts: 1, events: 1 },
          },
          entries: {
            layoutShifts: [{ value: 0.12, hadRecentInput: false }],
            events: [{ name: "click", duration: 40 }],
          },
        },
        type: "object",
      },
    });

    const result = await handleMessage(
      { type: "PERF_AUDIT", tabId: 1, durationMs: 500, trigger: "click:.cta" },
      {},
    );

    expect(result).toMatchObject({
      durationMs: 500,
      observedEntryTypes: ["layout-shift", "event"],
      trigger: { action: "click", selector: ".cta", fired: true },
      summary: { cumulativeLayoutShift: 0.12, maxEventDuration: 40 },
    });
  });

  it("filters buffered perf-audit entries outside the audit window", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    const originalPerformanceObserver = (globalThis as any).PerformanceObserver;

    class FakePerformanceObserver {
      static supportedEntryTypes = ["layout-shift"];
      callback: (list: { getEntries(): any[] }) => void;

      constructor(callback: (list: { getEntries(): any[] }) => void) {
        this.callback = callback;
      }

      observe() {
        const now = performance.now();
        this.callback({
          getEntries: () => [
            {
              entryType: "layout-shift",
              name: "",
              startTime: now - 1000,
              duration: 0,
              value: 1,
              hadRecentInput: false,
              sources: [],
            },
            {
              entryType: "layout-shift",
              name: "",
              startTime: now + 1,
              duration: 0,
              value: 0.2,
              hadRecentInput: false,
              sources: [],
            },
          ],
        });
      }

      disconnect() {
        return undefined;
      }
    }

    (globalThis as any).PerformanceObserver = FakePerformanceObserver;
    mockRuntimeEvaluate(chrome);

    try {
      const result = await handleMessage({ type: "PERF_AUDIT", tabId: 1, durationMs: 100 }, {});

      expect(result.summary.cumulativeLayoutShift).toBe(0.2);
      expect(result.summary.counts.layoutShifts).toBe(1);
      expect(result.entries.layoutShifts).toHaveLength(1);
    } finally {
      (globalThis as any).PerformanceObserver = originalPerformanceObserver;
    }
  });

  it("validates perf-audit numeric and trigger inputs in the service worker", async () => {
    const handleMessage = await loadHandleMessage();

    await expect(
      handleMessage({ type: "PERF_AUDIT", tabId: 1, durationMs: true }, {}),
    ).rejects.toThrow("duration must be a number");
    await expect(
      handleMessage({ type: "PERF_AUDIT", tabId: 1, durationMs: 10001 }, {}),
    ).rejects.toThrow("duration must be between 100 and 10000 ms");
    await expect(
      handleMessage({ type: "PERF_AUDIT", tabId: 1, trigger: true }, {}),
    ).rejects.toThrow("trigger must be action:target");
  });

  it("returns perf-audit runtime evaluation errors", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    chrome.debugger.sendCommand.mockResolvedValue({
      exceptionDetails: {
        text: "PerformanceObserver failed",
        exception: { description: "Error: PerformanceObserver failed" },
      },
    });

    const result = await handleMessage({ type: "PERF_AUDIT", tabId: 1, durationMs: 500 }, {});

    expect(result).toEqual({ error: "Error: PerformanceObserver failed" });
  });

  it("returns runtime evaluation errors", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    chrome.debugger.sendCommand.mockResolvedValue({
      exceptionDetails: {
        text: "SyntaxError",
        exception: { description: "DOMException: invalid selector" },
      },
    });

    const result = await handleMessage(
      { type: "ANIMATE_AUDIT", tabId: 1, selector: "[", durationMs: 500, fps: 5 },
      {},
    );

    expect(result).toEqual({ error: "DOMException: invalid selector" });
  });
});
