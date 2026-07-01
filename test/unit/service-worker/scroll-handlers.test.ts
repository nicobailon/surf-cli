import { vi } from "vitest";
import { createChromeMock, resetChromeMock } from "../../mocks/chrome";

// Mock the native port-manager to prevent initNativeMessaging side effects
vi.mock("../../../src/native/port-manager", () => ({
  initNativeMessaging: vi.fn(),
  postToNativeHost: vi.fn(),
}));

let handleMessage: (message: any, sender: any) => Promise<any>;

beforeAll(async () => {
  (globalThis as any).chrome = createChromeMock();
  const mod = await import("../../../src/service-worker/index");
  handleMessage = mod.handleMessage;
});

describe("EXECUTE_SCROLL handler", () => {
  beforeEach(() => {
    (globalThis as any).chrome = createChromeMock();
  });

  afterEach(() => {
    resetChromeMock();
  });

  it("uses Runtime.evaluate with scrollBy, not CDP mouseWheel", async () => {
    const chrome = (globalThis as any).chrome;
    const sendCommandCalls: { method: string; params: any }[] = [];
    chrome.debugger.sendCommand.mockImplementation((_target: any, method: string, params: any) => {
      sendCommandCalls.push({ method, params });
      if (method === "Runtime.evaluate") {
        return Promise.resolve({
          result: { value: { scrollX: 0, scrollY: 300, scrolled: true } },
        });
      }
      return Promise.resolve({});
    });

    await handleMessage({ type: "EXECUTE_SCROLL", deltaX: 0, deltaY: 300, tabId: 123 }, {});

    const runtimeEvalCalls = sendCommandCalls.filter((c) => c.method === "Runtime.evaluate");
    expect(runtimeEvalCalls.length).toBeGreaterThan(0);
    expect(runtimeEvalCalls[0].params.expression).toContain("scrollBy");

    const mouseWheelCalls = sendCommandCalls.filter(
      (c) => c.method === "Input.dispatchMouseEvent" && c.params?.type === "mouseWheel",
    );
    expect(mouseWheelCalls).toHaveLength(0);
  });

  it("passes correct delta values to the scrollBy script", async () => {
    const chrome = (globalThis as any).chrome;
    let capturedExpression = "";
    chrome.debugger.sendCommand.mockImplementation((_target: any, method: string, params: any) => {
      if (method === "Runtime.evaluate") {
        capturedExpression = params.expression;
        return Promise.resolve({
          result: { value: { scrollX: 100, scrollY: 500, scrolled: true } },
        });
      }
      return Promise.resolve({});
    });

    await handleMessage({ type: "EXECUTE_SCROLL", deltaX: 100, deltaY: 500, tabId: 123 }, {});

    expect(capturedExpression).toContain("100");
    expect(capturedExpression).toContain("500");
  });

  it("falls back to chrome.scripting.executeScript when CDP fails", async () => {
    const chrome = (globalThis as any).chrome;
    chrome.debugger.sendCommand.mockRejectedValue(new Error("CDP not available"));
    chrome.scripting.executeScript.mockResolvedValue([
      { result: { scrollX: 0, scrollY: 300, scrolled: true } },
    ]);

    await handleMessage({ type: "EXECUTE_SCROLL", deltaX: 0, deltaY: 300, tabId: 123 }, {});

    expect(chrome.scripting.executeScript).toHaveBeenCalled();
    const scriptCall = chrome.scripting.executeScript.mock.calls[0][0];
    expect(scriptCall.func.toString()).toContain("scrollBy");
  });

  it("returns scroll result from the script", async () => {
    const chrome = (globalThis as any).chrome;
    chrome.debugger.sendCommand.mockImplementation((_target: any, method: string) => {
      if (method === "Runtime.evaluate") {
        return Promise.resolve({
          result: { value: { scrollX: 0, scrollY: 500, scrolled: true } },
        });
      }
      return Promise.resolve({});
    });

    const result = await handleMessage(
      { type: "EXECUTE_SCROLL", deltaX: 0, deltaY: 300, tabId: 123 },
      {},
    );

    expect(result.scrollY).toBe(500);
    expect(result.scrolled).toBe(true);
  });

  it("requires tabId", async () => {
    await expect(handleMessage({ type: "EXECUTE_SCROLL", deltaY: 300 }, {})).rejects.toThrow(
      "No tabId provided",
    );
  });

  it("handles missing deltas by defaulting to 0", async () => {
    const chrome = (globalThis as any).chrome;
    let capturedExpression = "";
    chrome.debugger.sendCommand.mockImplementation((_target: any, method: string, params: any) => {
      if (method === "Runtime.evaluate") {
        capturedExpression = params.expression;
        return Promise.resolve({
          result: { value: { scrolled: false } },
        });
      }
      return Promise.resolve({});
    });

    await handleMessage({ type: "EXECUTE_SCROLL", tabId: 123 }, {});

    expect(capturedExpression).toContain("scrollBy");
    expect(capturedExpression).toContain("0");
  });
});
