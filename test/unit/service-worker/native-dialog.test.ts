import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeMock } from "../../mocks/chrome";

const nativeState = vi.hoisted(() => ({ initNativeMessaging: vi.fn(), postToNativeHost: vi.fn() }));

vi.mock("../../../src/native/port-manager", () => nativeState);

type Dispatch = (message: Record<string, unknown>) => Promise<any>;

// Chrome does not answer an action while a native dialog blocks the page.
const never = () => new Promise(() => undefined);

async function loadDispatcher() {
  vi.resetModules();
  nativeState.initNativeMessaging.mockReset();
  const chrome = createChromeMock();
  (globalThis as any).chrome = chrome;
  chrome.tabs.get.mockImplementation(async (tabId: number) => ({ id: tabId, windowId: 1 }));
  await import("../../../src/service-worker/index");
  const dispatch = nativeState.initNativeMessaging.mock.calls[0][0] as Dispatch;
  const openDialog = (tabId: number, params: Record<string, unknown>) => {
    const onEvent = chrome.debugger.onEvent.addListener.mock.calls[0][0];
    onEvent({ tabId }, "Page.javascriptDialogOpening", params);
  };
  return { chrome, dispatch, openDialog };
}

describe("actions that open a native JS dialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns from a CDP click once the dialog it opened blocks the page", async () => {
    const { chrome, dispatch, openDialog } = await loadDispatcher();
    chrome.debugger.sendCommand.mockImplementation(
      async (_target: unknown, method: string, params: any) =>
        method === "Input.dispatchMouseEvent" && params.type === "mouseReleased" ? never() : {},
    );

    const result = dispatch({ type: "EXECUTE_CLICK", tabId: 5, x: 10, y: 20 });
    await vi.waitFor(() =>
      expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId: 5 },
        "Input.dispatchMouseEvent",
        expect.objectContaining({ type: "mouseReleased" }),
      ),
    );
    openDialog(5, { type: "alert", message: "hi", defaultPrompt: "" });

    await expect(result).resolves.toMatchObject({
      success: true,
      nativeDialog: { type: "alert", message: "hi" },
    });
  });

  it("attaches before a content-script action so a dialog on a fresh tab is reported", async () => {
    const { chrome, dispatch, openDialog } = await loadDispatcher();
    chrome.tabs.sendMessage.mockImplementation(never);

    const result = dispatch({ type: "CLICK_REF", tabId: 6, ref: "e2", watchDialogs: true });
    await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalled());
    expect(chrome.debugger.attach).toHaveBeenCalledWith({ tabId: 6 }, "1.3");
    expect(chrome.debugger.attach.mock.invocationCallOrder[0]).toBeLessThan(
      chrome.tabs.sendMessage.mock.invocationCallOrder[0],
    );
    openDialog(6, { type: "prompt", message: "Name?", defaultPrompt: "Ada" });

    await expect(result).resolves.toMatchObject({
      success: true,
      nativeDialog: { type: "prompt", message: "Name?", defaultPrompt: "Ada" },
    });
  });
});
