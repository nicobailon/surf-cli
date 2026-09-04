import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeMock, resetChromeMock } from "../../mocks/chrome";

describe("native port manager", () => {
  beforeEach(() => {
    vi.resetModules();
    const chrome = createChromeMock();
    (globalThis as any).chrome = chrome;
  });

  afterEach(() => {
    resetChromeMock();
  });

  it("runs disconnect cleanup for the current native host port", async () => {
    const chrome = (globalThis as any).chrome;
    const port = {
      postMessage: vi.fn(),
      onMessage: { addListener: vi.fn() },
      onDisconnect: { addListener: vi.fn() },
    };
    chrome.runtime.connectNative.mockReturnValue(port);
    chrome.runtime.lastError = { message: "Native host not found" };

    const { initNativeMessaging } = await import("../../../src/native/port-manager");
    const onDisconnect = vi.fn();
    initNativeMessaging(vi.fn().mockResolvedValue({}), onDisconnect);

    const disconnect = port.onDisconnect.addListener.mock.calls[0][0] as () => void;
    disconnect();
    await Promise.resolve();

    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });
});
