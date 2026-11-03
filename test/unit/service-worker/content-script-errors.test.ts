import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeMock } from "../../mocks/chrome";

vi.mock("../../../src/native/port-manager", () => ({
  initNativeMessaging: vi.fn(),
  postToNativeHost: vi.fn(),
}));

async function clickWithFailure(failure: Error, pingAnswers: boolean) {
  vi.resetModules();
  const chrome = createChromeMock();
  (globalThis as any).chrome = chrome;
  chrome.tabs.sendMessage.mockImplementation(async (_tabId: number, message: { type: string }) => {
    if (message.type !== "PING" || !pingAnswers) {
      throw failure;
    }
    return { success: true };
  });
  const { handleMessage } = await import("../../../src/service-worker/index");
  return handleMessage({ type: "CLICK_REF", tabId: 5, ref: "e1" }, {});
}

describe("failed content-script commands", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says the content script is not loaded only when the frame ignores a PING", async () => {
    const result = await clickWithFailure(
      new Error("Could not establish connection. Receiving end does not exist."),
      false,
    );
    expect(result).toEqual({ error: "Content script not loaded. Try refreshing the page." });
  });

  it("reports the real error when the content script answers", async () => {
    const result = await clickWithFailure(new Error("Frame with ID 0 is showing error page"), true);
    expect(result).toEqual({ error: "Frame with ID 0 is showing error page" });
  });
});
