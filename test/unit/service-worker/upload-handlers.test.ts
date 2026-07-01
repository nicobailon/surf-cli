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

describe("provider upload handlers", () => {
  beforeEach(() => {
    resetChromeMock();
  });

  it("sets ChatGPT files on the composer file input when available", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;

    chrome.debugger.sendCommand.mockImplementation(async (_target: any, method: string) => {
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "chatgpt-file-input" } };
      }
      return {};
    });

    const result = await handleMessage(
      {
        type: "AI_UPLOAD_FILE_TO_TAB",
        provider: "chatgpt",
        tabId: 42,
        filePaths: ["/tmp/report.txt"],
      },
      {},
    );

    expect(result).toEqual({ success: true });
    expect(chrome.debugger.attach).toHaveBeenCalledWith({ tabId: 42 }, "1.3");
    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 42 },
      "DOM.setFileInputFiles",
      { files: ["/tmp/report.txt"], objectId: "chatgpt-file-input" },
    );

    const evaluateCall = chrome.debugger.sendCommand.mock.calls.find(
      ([, method]: [unknown, string]) => method === "Runtime.evaluate",
    );
    expect(evaluateCall?.[2].expression).toContain("input[type=");
    expect(evaluateCall?.[2].expression).toContain("not([accept*=");
  });

  it("keeps legacy UPLOAD_FILE_TO_TAB as Gemini and accepts current Upload & tools opener", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    let chooserHandler: ((source: { tabId: number }, method: string, params: any) => void) | null =
      null;

    chrome.debugger.onEvent.addListener.mockImplementation((handler: typeof chooserHandler) => {
      chooserHandler = handler;
    });
    chrome.debugger.sendCommand.mockImplementation(async (_target: any, method: string) => {
      if (method === "Runtime.evaluate" && chooserHandler) {
        setTimeout(
          () => chooserHandler?.({ tabId: 42 }, "Page.fileChooserOpened", { backendNodeId: 99 }),
          0,
        );
      }
      return {};
    });

    const result = await handleMessage(
      {
        type: "UPLOAD_FILE_TO_TAB",
        tabId: 42,
        filePaths: ["/tmp/image.png"],
      },
      {},
    );

    expect(result).toEqual({ success: true });
    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 42 },
      "DOM.setFileInputFiles",
      { files: ["/tmp/image.png"], backendNodeId: 99 },
    );

    const expressions = chrome.debugger.sendCommand.mock.calls
      .filter(([, method]: [unknown, string]) => method === "Runtime.evaluate")
      .map(([, , params]: [unknown, string, { expression: string }]) => params.expression)
      .join("\n");
    expect(expressions).toContain("Upload & tools");
    expect(expressions).toContain("Open upload file menu");
    expect(expressions).toContain("local-images-files-uploader-button");
  });

  it("rejects unsupported provider-aware upload providers", async () => {
    const handleMessage = await loadHandleMessage();

    await expect(
      handleMessage(
        {
          type: "AI_UPLOAD_FILE_TO_TAB",
          provider: "perplexity",
          tabId: 42,
          filePaths: ["/tmp/file.txt"],
        },
        {},
      ),
    ).rejects.toThrow("Unsupported upload provider: perplexity");
  });
});
