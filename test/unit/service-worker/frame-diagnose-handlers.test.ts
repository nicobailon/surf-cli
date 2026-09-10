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

const inventory = {
  href: "https://app.example.com/page",
  title: "Page",
  iframes: [
    {
      domIndex: 0,
      src: "https://widgets.example.net/embed",
      srcdoc: false,
      title: "",
      name: "widget",
      id: "",
      sandbox: null,
      allow: "",
      rect: { x: 0, y: 0, width: 300, height: 200 },
    },
  ],
};

function mockCdp(
  chrome: ReturnType<typeof createChromeMock>,
  options: { domInventoryError?: string; frameTreeError?: string } = {},
) {
  chrome.debugger.sendCommand.mockImplementation(async (_target: any, method: string) => {
    if (method === "Runtime.evaluate") {
      if (options.domInventoryError) {
        throw new Error(options.domInventoryError);
      }
      return { result: { value: inventory, type: "object" } };
    }
    if (method === "Page.getFrameTree") {
      if (options.frameTreeError) {
        throw new Error(options.frameTreeError);
      }
      return {
        frameTree: {
          frame: { id: "F1", url: "https://app.example.com/page", name: "" },
          childFrames: [
            { frame: { id: "F2", url: "https://widgets.example.net/embed", name: "widget" } },
          ],
        },
      };
    }
    return {};
  });
}

describe("FRAME_DIAGNOSE", () => {
  beforeEach(() => {
    resetChromeMock();
  });

  it("combines the DOM inventory, webNavigation frames with PING results and the CDP tree", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    mockCdp(chrome);
    chrome.webNavigation.getAllFrames.mockResolvedValue([
      { frameId: 0, parentFrameId: -1, url: "https://app.example.com/page", errorOccurred: false },
      {
        frameId: 7,
        parentFrameId: 0,
        url: "https://widgets.example.net/embed",
        errorOccurred: false,
      },
    ]);
    chrome.tabs.sendMessage.mockImplementation(async (_tabId: number, _msg: any, opts: any) => {
      if (opts.frameId === 0) {
        return { success: true, href: "https://app.example.com/page", readyState: "complete" };
      }
      throw new Error("Could not establish connection");
    });

    const result = await handleMessage({ type: "FRAME_DIAGNOSE", tabId: 5 }, {});

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(5, { type: "PING" }, { frameId: 0 });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(5, { type: "PING" }, { frameId: 7 });
    expect(result.success).toBeUndefined();
    expect(result.mainPage).toEqual({
      href: "https://app.example.com/page",
      title: "Page",
      origin: "https://app.example.com",
    });
    expect(result.counts).toEqual({ domIframes: 1, extensionFrames: 2, cdpFrames: 2 });
    expect(result.domIframes[0]).toMatchObject({
      extensionFrameIds: [7],
      cdpFrameIds: ["F2"],
      crossOrigin: true,
    });
    expect(result.extensionFrames[1]).toMatchObject({
      frameId: 7,
      contentScriptReachable: false,
      contentScriptError: "Could not establish connection",
    });
    expect(result.extensionFrames[0].contentScript).toEqual({
      href: "https://app.example.com/page",
      readyState: "complete",
    });
    expect(
      result.warnings.some(
        (line: string) =>
          line.includes("extension frame 7") && line.includes("no reachable content script"),
      ),
    ).toBe(true);
    expect(chrome.debugger.attach).toHaveBeenCalledTimes(1);
    expect(chrome.debugger.detach).toHaveBeenCalledTimes(1);
  });

  it("keeps going when the CDP frame tree is unavailable", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    mockCdp(chrome, { frameTreeError: "Target closed" });
    chrome.webNavigation.getAllFrames.mockResolvedValue([
      { frameId: 0, parentFrameId: -1, url: "https://app.example.com/page", errorOccurred: false },
      {
        frameId: 7,
        parentFrameId: 0,
        url: "https://widgets.example.net/embed",
        errorOccurred: false,
      },
    ]);
    chrome.tabs.sendMessage.mockImplementation(async (_tabId: number, _msg: any, opts: any) => {
      if (opts.frameId === 0) {
        return {
          success: true,
          href: "https://app.example.com/page",
          readyState: "complete",
        };
      }
      throw new Error("Could not establish connection");
    });

    const result = await handleMessage({ type: "FRAME_DIAGNOSE", tabId: 5 }, {});
    expect(result.counts.cdpFrames).toBe(0);
    expect(result.warnings[0]).toBe("CDP frame tree unavailable: Target closed");
    expect(result.domIframes[0]).toMatchObject({
      crossOrigin: true,
      extensionFrameIds: [7],
      cdpFrameIds: [],
    });
    expect(result.warnings.some((line: string) => line.includes("is out-of-process"))).toBe(false);
    expect(
      result.warnings.some((line: string) => line.includes("nothing in this tab can drive it")),
    ).toBe(false);
    expect(chrome.debugger.detach).toHaveBeenCalledTimes(1);
  });

  it("keeps extension and CDP inventories when DOM evaluation fails", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    mockCdp(chrome, { domInventoryError: "Execution context destroyed" });
    chrome.webNavigation.getAllFrames.mockResolvedValue([
      { frameId: 0, parentFrameId: -1, url: "https://app.example.com/page", errorOccurred: false },
    ]);
    chrome.tabs.sendMessage.mockResolvedValue({ success: true });

    const result = await handleMessage({ type: "FRAME_DIAGNOSE", tabId: 5 }, {});

    expect(result.counts).toEqual({ domIframes: 0, extensionFrames: 1, cdpFrames: 2 });
    expect(result.mainPage.href).toBe("https://app.example.com/page");
    expect(result.warnings[0]).toBe(
      "DOM iframe inventory unavailable: Execution context destroyed",
    );
    expect(chrome.debugger.detach).toHaveBeenCalledTimes(1);
  });

  it("returns the extension inventory when debugger attachment fails", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    chrome.debugger.attach.mockRejectedValue(new Error("Attach denied"));
    chrome.webNavigation.getAllFrames.mockResolvedValue([
      { frameId: 0, parentFrameId: -1, url: "https://app.example.com/page", errorOccurred: false },
    ]);
    chrome.tabs.sendMessage.mockResolvedValue({ success: true });

    const result = await handleMessage({ type: "FRAME_DIAGNOSE", tabId: 5 }, {});

    expect(result.counts).toEqual({ domIframes: 0, extensionFrames: 1, cdpFrames: 0 });
    expect(result.warnings[0]).toContain("CDP inventories unavailable: Failed to attach debugger");
    expect(chrome.debugger.attach).toHaveBeenCalledTimes(1);
    expect(chrome.debugger.detach).not.toHaveBeenCalled();
  });

  it("reports detach failures after returning all inventories", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {
      // Expected for this failure-path assertion.
    });
    mockCdp(chrome);
    chrome.debugger.detach.mockRejectedValue(new Error("Detach denied"));
    chrome.webNavigation.getAllFrames.mockResolvedValue([
      { frameId: 0, parentFrameId: -1, url: "https://app.example.com/page", errorOccurred: false },
    ]);
    chrome.tabs.sendMessage.mockResolvedValue({ success: true });

    const result = await handleMessage({ type: "FRAME_DIAGNOSE", tabId: 5 }, {});

    expect(result.counts).toEqual({ domIframes: 1, extensionFrames: 1, cdpFrames: 2 });
    expect(result.warnings[0]).toBe("CDP detach failed: Detach denied");
    expect(warn).toHaveBeenCalledWith("[CDPController] Error detaching:", expect.any(Error));
    warn.mockRestore();
  });

  it("does not detach a pre-existing Surf debugger attachment", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    mockCdp(chrome);
    chrome.webNavigation.getAllFrames.mockResolvedValue([
      { frameId: 0, parentFrameId: -1, url: "https://app.example.com/page", errorOccurred: false },
    ]);
    chrome.tabs.sendMessage.mockResolvedValue({ success: true });
    await handleMessage({ type: "GET_FRAMES", tabId: 5 }, {});

    await handleMessage({ type: "FRAME_DIAGNOSE", tabId: 5 }, {});

    expect(chrome.debugger.attach).toHaveBeenCalledTimes(1);
    expect(chrome.debugger.detach).not.toHaveBeenCalled();
  });

  it("requires a tab id", async () => {
    const handleMessage = await loadHandleMessage();
    await expect(handleMessage({ type: "FRAME_DIAGNOSE" }, {})).rejects.toThrow(
      "No tabId provided",
    );
  });
});
