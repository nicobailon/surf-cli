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

describe("browser session handlers", () => {
  beforeEach(() => resetChromeMock());

  it("creates session windows unfocused and labels the bound tab", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    const tab = {
      id: 41,
      windowId: 9,
      active: true,
      groupId: -1,
      url: "https://example.com/",
      title: "Example",
      status: "complete",
    };
    chrome.windows.create.mockResolvedValue({ id: 9, tabs: [tab] });
    chrome.tabs.get.mockResolvedValue(tab);
    chrome.tabs.group.mockResolvedValue(7);

    const result = await handleMessage(
      {
        type: "SESSION_CREATE_TARGET",
        name: "research",
        url: "https://example.com/",
        mode: "window",
      },
      {},
    );

    expect(chrome.windows.create).toHaveBeenCalledWith({
      url: "https://example.com/",
      focused: false,
      type: "normal",
    });
    expect(chrome.tabGroups.update).toHaveBeenCalledWith(7, {
      title: "Surf: research",
      color: "blue",
      collapsed: false,
    });
    expect(result).toMatchObject({ tabId: 41, windowId: 9, mode: "window", groupId: 7 });
  });

  it("creates --tab sessions inactive by default", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    const tab = {
      id: 51,
      windowId: 12,
      active: false,
      groupId: -1,
      url: "about:blank",
      title: "",
      status: "complete",
    };
    chrome.tabs.create.mockResolvedValue(tab);
    chrome.tabs.get.mockResolvedValue(tab);

    await handleMessage(
      {
        type: "SESSION_CREATE_TARGET",
        name: "scout",
        url: "about:blank",
        mode: "tab",
        windowId: 12,
      },
      {},
    );

    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: "about:blank",
      active: false,
      windowId: 12,
    });
  });

  it("fails screenshot fallback closed when a strict tab is not visible", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    chrome.tabs.get.mockResolvedValue({
      id: 61,
      windowId: 14,
      active: false,
      groupId: -1,
      url: "https://example.com/",
    });
    chrome.tabs.query.mockResolvedValue([{ id: 62, windowId: 14, active: true }]);
    chrome.debugger.sendCommand.mockRejectedValue(new Error("capture unavailable"));

    await expect(
      handleMessage(
        {
          type: "EXECUTE_SCREENSHOT",
          tabId: 61,
          strictTarget: true,
        },
        {},
      ),
    ).rejects.toMatchObject({ code: "screenshot_target_not_visible" });
    expect(chrome.tabs.update).not.toHaveBeenCalled();
    expect(chrome.windows.update).not.toHaveBeenCalled();
  });

  it("uses only an explicit host-provided frame context", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    chrome.webNavigation.getAllFrames.mockResolvedValue([
      { frameId: 0, parentFrameId: -1, url: "https://example.com/" },
      { frameId: 9, parentFrameId: 0, url: "https://example.com/frame" },
    ]);
    chrome.tabs.sendMessage.mockResolvedValue({ success: true });

    await handleMessage({ type: "FRAME_SWITCH", tabId: 70, index: 0 }, {});
    chrome.tabs.sendMessage.mockClear();

    await handleMessage({ type: "FORM_INPUT", tabId: 70, ref: "e1", value: "main" }, {});
    expect(chrome.tabs.sendMessage).toHaveBeenLastCalledWith(
      70,
      { type: "FORM_INPUT", ref: "e1", value: "main" },
      { frameId: 0 },
    );

    await handleMessage(
      {
        type: "FORM_INPUT",
        tabId: 70,
        frameId: 9,
        ref: "e1",
        value: "frame",
      },
      {},
    );
    expect(chrome.tabs.sendMessage).toHaveBeenLastCalledWith(
      70,
      { type: "FORM_INPUT", ref: "e1", value: "frame" },
      { frameId: 9 },
    );
  });

  it("treats closing an already-gone target as successful cleanup", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    chrome.tabs.remove.mockRejectedValue(new Error("No tab"));

    await expect(handleMessage({ type: "SESSION_CLOSE_TARGET", tabId: 404 }, {})).resolves.toEqual({
      success: true,
      tabId: 404,
      alreadyGone: true,
    });
  });
});
