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

describe("tab handlers", () => {
  beforeEach(() => {
    resetChromeMock();
  });

  it("registers the active tab when tabId is omitted", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    chrome.tabs.query.mockResolvedValue([
      { id: 123, url: "https://example.com/", active: true, windowId: 1 },
    ]);

    const result = await handleMessage({ type: "TABS_REGISTER", name: "work" }, {});

    expect(chrome.tabs.query).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true });
    expect(result).toEqual({ success: true, name: "work", tabId: 123 });
  });

  it.each([
    "chrome://settings/",
    "edge://settings/",
    "brave://settings/",
    "arc://settings/",
    "helium://settings/",
    "chrome-extension://abc/page.html",
    "about:blank",
  ])("rejects registration for restricted URL %s", async (url) => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    chrome.tabs.query.mockResolvedValue([{ id: 999, url, active: true, windowId: 1 }]);

    await expect(handleMessage({ type: "TABS_REGISTER", name: "settings" }, {})).rejects.toThrow(
      /restricted browser or extension page/,
    );
  });

  it("routes selector typing to the explicit host-provided iframe", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    chrome.webNavigation.getAllFrames.mockResolvedValue([
      { frameId: 0, parentFrameId: -1, url: "https://example.com/" },
      { frameId: 7, parentFrameId: 0, url: "https://example.com/frame" },
    ]);

    const switched = await handleMessage({ type: "FRAME_SWITCH", tabId: 123, index: 0 }, {});
    chrome.tabs.sendMessage.mockResolvedValue({ success: true, contentEditable: false });

    const result = await handleMessage(
      {
        type: "SMART_TYPE",
        tabId: 123,
        frameId: switched.frameId,
        selector: "#card-number",
        text: "4242",
        clear: true,
        submit: false,
      },
      {},
    );

    expect(chrome.tabs.sendMessage).toHaveBeenLastCalledWith(
      123,
      {
        type: "SMART_TYPE",
        selector: "#card-number",
        text: "4242",
        clear: true,
        submit: false,
      },
      { frameId: 7 },
    );
    expect(result).toEqual({ success: true, contentEditable: false });
  });

  it("routes selector clicks to the explicit host-provided iframe", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    chrome.webNavigation.getAllFrames.mockResolvedValue([
      { frameId: 0, parentFrameId: -1, url: "https://example.com/" },
      { frameId: 7, parentFrameId: 0, url: "https://example.com/frame" },
    ]);
    chrome.scripting.executeScript.mockResolvedValue([
      { result: { success: true, selector: "#pay", index: 0, matchCount: 1 } },
    ]);

    const result = await handleMessage(
      { type: "CLICK_SELECTOR", tabId: 123, frameId: 7, selector: "#pay", index: 0 },
      {},
    );

    expect(chrome.scripting.executeScript).toHaveBeenLastCalledWith({
      target: { tabId: 123, frameIds: [7] },
      func: expect.any(Function),
      args: ["#pay", 0],
    });
    expect(chrome.debugger.sendCommand).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, selector: "#pay", index: 0, matchCount: 1 });
  });

  it("moves tabs to the destination window", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    chrome.tabs.move.mockResolvedValue([{ id: 123, windowId: 456, index: 0 }]);

    const result = await handleMessage(
      { type: "TAB_MOVE", tabIds: "123,124", windowId: "456", index: "0" },
      {},
    );

    expect(chrome.tabs.move).toHaveBeenCalledWith([123, 124], { windowId: 456, index: 0 });
    expect(result).toMatchObject({
      success: true,
      moved: [123, 124],
      destinationWindowId: 456,
      index: 0,
    });
  });
});
