import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("a ref click on a page with another extension's frame", () => {
  it("clicks in the page and names the frame in a short reason", async () => {
    vi.resetModules();
    const chrome = createChromeMock();
    (globalThis as any).chrome = chrome;
    chrome.tabs.sendMessage.mockImplementation(async (_tabId: number, message: { type: string }) =>
      message.type === "CLICK_POINT" ? { x: 10, y: 20, inPage: false } : { success: true },
    );
    chrome.debugger.attach.mockRejectedValue(
      new Error("Cannot access a chrome-extension:// URL of different extension"),
    );
    chrome.tabs.get.mockResolvedValue({ id: 5, url: "https://books.toscrape.com/" });
    const { handleMessage } = await import("../../../src/service-worker/index");

    const result = await handleMessage({ type: "CLICK_REF", tabId: 5, ref: "e1" }, {});

    expect(result._hint).toBe(
      "Clicked e1 inside the page, not with the mouse, because Surf could not attach its debugger " +
        "(another extension's frame blocks it here).",
    );
  });
});

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

// `click --selector` finds its match in the page, then clicks it the way a ref click does.
async function clickSelector(
  clickPoint: Record<string, unknown>,
  page: (message: { type: string }) => Promise<unknown> = async (message) =>
    message.type === "LOCATE_SELECTOR" ? { ref: "e7", count: 2 } : { success: true },
) {
  vi.resetModules();
  const chrome = createChromeMock();
  (globalThis as any).chrome = chrome;
  chrome.tabs.sendMessage.mockImplementation((_tabId: number, message: { type: string }) =>
    message.type === "CLICK_POINT" ? Promise.resolve(clickPoint) : page(message),
  );
  chrome.debugger.sendCommand.mockImplementation(async (_target: unknown, method: string) =>
    method === "Runtime.evaluate" ? { result: { value: { x: 30, y: 40, count: 3 } } } : {},
  );
  const { handleMessage } = await import("../../../src/service-worker/index");
  const pending = handleMessage(
    { type: "CLICK_SELECTOR", tabId: 5, selector: "form button", index: 1, button: "left" },
    {},
  );
  await vi.advanceTimersByTimeAsync(6000);
  const result = await pending;
  const sent = chrome.tabs.sendMessage.mock.calls.map((call: any[]) => call[1]);
  const commands = chrome.debugger.sendCommand.mock.calls;
  const mouse = commands
    .filter((call: any[]) => call[1] === "Input.dispatchMouseEvent")
    .map((call: any[]) => call[2]);
  const evaluated = commands
    .filter((call: any[]) => call[1] === "Runtime.evaluate")
    .map((call: any[]) => call[2].expression as string);
  return { result, sent, mouse, evaluated };
}

describe("selector clicks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("click where the ref click would, after the page scrolled the match into view", async () => {
    const { result, sent, mouse } = await clickSelector({ x: 50, y: 190, inPage: false });
    expect(sent[0]).toMatchObject({ type: "LOCATE_SELECTOR", selector: "form button", index: 1 });
    expect(sent[1]).toMatchObject({ type: "CLICK_POINT", ref: "e7" });
    expect(mouse.length).toBeGreaterThan(0);
    expect(
      mouse.every((event: { x: number; y: number }) => event.x === 50 && event.y === 190),
    ).toBe(true);
    expect(result).toEqual({ success: true, selector: "form button", index: 1, matchCount: 2 });
  });

  it("refuse a match a user could not click instead of reporting success", async () => {
    const { result, mouse } = await clickSelector({ reason: "is outside the visible page" });
    expect(mouse).toEqual([]);
    expect(result).toEqual({
      error:
        'selector "form button" (index 1) is outside the visible page, so it was not clicked (waited 5s).',
    });
  });

  it("name the selector when its match is gone before the click", async () => {
    const { result } = await clickSelector({
      error: "Element e7 no longer exists. Run surf read to get current refs.",
    });
    expect(result.error).toBe(
      'Element selector "form button" (index 1) no longer exists. Run surf read to get current refs.',
    );
  });

  it("click through the debugger when no content script answers", async () => {
    const { result, mouse, evaluated } = await clickSelector({}, async () => {
      throw new Error("Could not establish connection. Receiving end does not exist.");
    });
    expect(evaluated).toHaveLength(1);
    expect(evaluated[0]).toContain('scrollIntoView({ block: "center", behavior: "instant" })');
    expect(mouse.length).toBeGreaterThan(0);
    expect(mouse.every((event: { x: number; y: number }) => event.x === 30 && event.y === 40)).toBe(
      true,
    );
    expect(result).toEqual({ success: true, selector: "form button", index: 1, matchCount: 3 });
  });
});
