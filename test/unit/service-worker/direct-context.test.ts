import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeMock, resetChromeMock } from "../../mocks/chrome";

vi.mock("../../../src/native/port-manager", () => ({
  initNativeMessaging: vi.fn(),
  postToNativeHost: vi.fn(),
}));

async function load() {
  vi.resetModules();
  const chrome = createChromeMock() as any;
  chrome.cookies = {
    getAll: vi.fn().mockResolvedValue([{ name: "sid", value: "abc", domain: "a.test" }]),
  };
  (globalThis as any).chrome = chrome;
  const mod = await import("../../../src/service-worker/index");
  return { handleMessage: mod.handleMessage, chrome };
}

describe("the direct step's cookie read", () => {
  beforeEach(() => {
    resetChromeMock();
  });

  it("gives the cookies for the URL, and refuses for an incognito tab", async () => {
    const { handleMessage, chrome } = await load();
    const message = { type: "GET_DIRECT_REQUEST_CONTEXT", url: "https://a.test/x", sourceTabId: 5 };
    chrome.tabs.get.mockResolvedValue({ id: 5, incognito: false });
    const reply = await handleMessage(message, {});
    expect(reply.cookies).toEqual([{ name: "sid", value: "abc" }]);
    expect(chrome.cookies.getAll).toHaveBeenCalledWith({ url: "https://a.test/x" });

    chrome.tabs.get.mockResolvedValue({ id: 5, incognito: true });
    await expect(handleMessage(message, {})).rejects.toThrow(/incognito/);
    await expect(
      handleMessage(message, { tab: { id: 1 } } as chrome.runtime.MessageSender),
    ).rejects.toThrow(/only for the native host/);
  });
});
