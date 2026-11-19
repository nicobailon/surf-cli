import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeMock } from "../../mocks/chrome";

const nativeState = vi.hoisted(() => ({ initNativeMessaging: vi.fn(), postToNativeHost: vi.fn() }));

vi.mock("../../../src/native/port-manager", () => nativeState);

type Dispatch = (message: Record<string, unknown>) => Promise<any>;

async function loadDispatcher() {
  vi.resetModules();
  nativeState.initNativeMessaging.mockReset();
  const chrome = createChromeMock();
  (globalThis as any).chrome = chrome;
  chrome.tabs.get.mockImplementation(async (tabId: number) => ({ id: tabId, windowId: 1 }));
  chrome.debugger.attach.mockResolvedValue(undefined);
  chrome.debugger.sendCommand.mockResolvedValue({});
  await import("../../../src/service-worker/index");
  const dispatch = nativeState.initNativeMessaging.mock.calls[0][0] as Dispatch;
  const detach = (tabId: number, reason: string) =>
    chrome.debugger.onDetach.addListener.mock.calls[0][0]({ tabId }, reason);
  return { chrome, dispatch, detach };
}

describe("network capture after a debugger detach", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-attaches and turns capture back on before a navigation, without a failing command first", async () => {
    const { chrome, dispatch, detach } = await loadDispatcher();
    await dispatch({ type: "START_NETWORK_CAPTURE", tabId: 7 });
    detach(7, "target_closed");
    chrome.debugger.attach.mockClear();
    chrome.debugger.sendCommand.mockClear();

    // The navigation waits for a load event the mock never sends; only its start matters here.
    dispatch({ type: "EXECUTE_NAVIGATE", tabId: 7, url: "https://example.test/page-4" }).catch(
      () => undefined,
    );
    await vi.waitFor(() => expect(chrome.tabs.update).toHaveBeenCalled());

    expect(chrome.debugger.attach).toHaveBeenCalledWith({ tabId: 7 }, "1.3");
    const enable = chrome.debugger.sendCommand.mock.calls.findIndex(
      (call: unknown[]) => call[1] === "Network.enable",
    );
    expect(enable).toBeGreaterThanOrEqual(0);
    expect(chrome.debugger.sendCommand.mock.invocationCallOrder[enable]).toBeLessThan(
      chrome.tabs.update.mock.invocationCallOrder[0],
    );
    const read = await dispatch({ type: "READ_NETWORK_REQUESTS", tabId: 7 });
    expect(read.capture).toMatchObject({
      active: true,
      interruptions: [{ reason: "target_closed", resumedAt: expect.any(Number) }],
    });
  });

  it("re-attaches once a navigation off a page it can't debug commits, so that page's requests are captured", async () => {
    const { chrome, dispatch, detach } = await loadDispatcher();
    await dispatch({ type: "START_NETWORK_CAPTURE", tabId: 7 });
    detach(7, "target_closed");
    // The tab is on chrome://version, where Chrome refuses the debugger.
    chrome.debugger.attach.mockRejectedValue(new Error("Cannot access a chrome:// URL"));
    await dispatch({ type: "GET_PLAYBOOK_RECORD_CONTEXT", tabId: 7 });
    chrome.debugger.attach.mockReset();
    chrome.debugger.attach.mockResolvedValue(undefined);
    chrome.debugger.sendCommand.mockClear();

    const committed = chrome.webNavigation.onCommitted.addListener.mock.calls[0][0];
    committed({ tabId: 7, frameId: 1, url: "https://example.test/frame" });
    committed({ tabId: 7, frameId: 0, url: "chrome://settings/" });
    expect(chrome.debugger.attach).not.toHaveBeenCalled();
    committed({ tabId: 7, frameId: 0, url: "https://example.test/page-4" });
    await vi.waitFor(() =>
      expect(chrome.debugger.sendCommand).toHaveBeenCalledWith({ tabId: 7 }, "Network.enable", {
        maxPostDataSize: 65536,
      }),
    );
    expect(chrome.debugger.attach).toHaveBeenCalledWith({ tabId: 7 }, "1.3");
  });

  it("leaves a tab alone when capture was off or the user cancelled debugging", async () => {
    const { chrome, dispatch, detach } = await loadDispatcher();
    await dispatch({ type: "GET_PLAYBOOK_RECORD_CONTEXT", tabId: 8 });
    await dispatch({ type: "START_NETWORK_CAPTURE", tabId: 9 });
    detach(9, "canceled_by_user");
    chrome.debugger.attach.mockClear();

    await dispatch({ type: "GET_PLAYBOOK_RECORD_CONTEXT", tabId: 8 });
    await dispatch({ type: "GET_PLAYBOOK_RECORD_CONTEXT", tabId: 9 });
    expect(chrome.debugger.attach).not.toHaveBeenCalled();
  });
});
