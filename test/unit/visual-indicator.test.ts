import { vi } from "vitest";

describe("visual indicator content script", () => {
  let runtimeMessageListener: ReturnType<typeof vi.fn>;
  let windowListeners: Map<string, () => void>;

  beforeEach(async () => {
    vi.resetModules();
    runtimeMessageListener = vi.fn();
    windowListeners = new Map();

    const windowMock: Record<string, unknown> = {
      addEventListener: vi.fn((type: string, listener: () => void) => {
        windowListeners.set(type, listener);
      }),
      setInterval: vi.fn(() => 1),
    };
    windowMock.top = windowMock;
    (globalThis as any).window = windowMock;
    (globalThis as any).document = { body: null };
    (globalThis as any).chrome = {
      runtime: {
        onMessage: { addListener: runtimeMessageListener },
        sendMessage: vi.fn().mockResolvedValue({ success: true }),
      },
      storage: {
        local: { get: vi.fn().mockResolvedValue({}) },
        onChanged: { addListener: vi.fn() },
      },
    };

    await import("../../src/content/visual-indicator");
  });

  it("exposes visual commands without registering a competing runtime listener", () => {
    expect(runtimeMessageListener).not.toHaveBeenCalled();
    expect(window.__piVisualIndicatorMessageHandler).toBeTypeOf("function");

    window.__piVisualIndicatorMessageHandler?.("HIDE_AGENT_INDICATORS");
    window.__piVisualIndicatorMessageHandler?.("HIDE_FOR_TOOL_USE");
    window.__piVisualIndicatorMessageHandler?.("SHOW_AFTER_TOOL_USE");
    window.__piVisualIndicatorMessageHandler?.("HIDE_STATIC_INDICATOR");
  });

  it("does not resurrect an indicator hidden before the document body is ready", () => {
    window.__piVisualIndicatorMessageHandler?.("SHOW_AGENT_INDICATORS");
    const onDocumentReady = windowListeners.get("DOMContentLoaded");
    expect(onDocumentReady).toBeTypeOf("function");

    window.__piVisualIndicatorMessageHandler?.("HIDE_AGENT_INDICATORS");
    (document as any).body = {};
    expect(() => onDocumentReady?.()).not.toThrow();
  });

  it("restores a pending indicator after tool use finishes", () => {
    const addEventListener = window.addEventListener as ReturnType<typeof vi.fn>;
    window.__piVisualIndicatorMessageHandler?.("SHOW_AGENT_INDICATORS");
    window.__piVisualIndicatorMessageHandler?.("HIDE_FOR_TOOL_USE");
    window.__piVisualIndicatorMessageHandler?.("SHOW_AFTER_TOOL_USE");

    expect(
      addEventListener.mock.calls.filter(([type]) => type === "DOMContentLoaded"),
    ).toHaveLength(2);
  });
});
