import { describe, expect, it, vi } from "vitest";
import { createChromeMock } from "../../mocks/chrome";

vi.mock("../../../src/native/port-manager", () => ({
  initNativeMessaging: vi.fn(),
  postToNativeHost: vi.fn(),
}));

// A first ref click attaches the debugger, then the user clicks Cancel on Chrome's debugging bar.
async function clickAfterCancelledBar(reattach: () => Promise<void>) {
  vi.resetModules();
  const chrome = createChromeMock();
  (globalThis as any).chrome = chrome;
  chrome.tabs.sendMessage.mockImplementation(async (_tabId: number, message: { type: string }) =>
    message.type === "CLICK_POINT" ? { x: 10, y: 20, inPage: false } : { success: true },
  );
  const { handleMessage } = await import("../../../src/service-worker/index");
  await handleMessage({ type: "CLICK_REF", tabId: 5, ref: "e1" }, {});
  chrome.debugger.onDetach.addListener.mock.calls[0][0]({ tabId: 5 }, "canceled_by_user");
  chrome.debugger.attach.mockImplementation(reattach);
  chrome.tabs.sendMessage.mockClear();
  chrome.debugger.sendCommand.mockClear();
  const result = await handleMessage({ type: "CLICK_REF", tabId: 5, ref: "e1" }, {});
  const sent = chrome.tabs.sendMessage.mock.calls.map((call: any[]) => call[1].type);
  const mouse = chrome.debugger.sendCommand.mock.calls.filter(
    (call: any[]) => call[1] === "Input.dispatchMouseEvent",
  );
  return { result, sent, mouse };
}

describe("ref clicks after the debugging bar was cancelled", () => {
  it("attach again and click with the mouse", async () => {
    const { result, sent, mouse } = await clickAfterCancelledBar(() => Promise.resolve());
    expect(result).toEqual({ success: true });
    expect(sent).toEqual(["CLICK_POINT"]);
    expect(mouse.length).toBeGreaterThan(0);
  });

  it("click in the page and say why when the debugger can't attach", async () => {
    const { result, sent, mouse } = await clickAfterCancelledBar(async () => {
      throw new Error("Another debugger is already attached to the tab with id: 5.");
    });
    expect(sent).toEqual(["CLICK_POINT", "CLICK_ELEMENT"]);
    expect(mouse).toEqual([]);
    expect(result._hint).toBe(
      "Clicked e1 inside the page, not with the mouse, because Surf could not attach its debugger " +
        "(Another debugger already controls tab 5. Close DevTools or the competing debugger and retry).",
    );
  });
});
