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

  it("reports ChatGPT chooser interception failures distinctly", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    chrome.debugger.sendCommand.mockImplementation(async (_target: any, method: string) => {
      if (method === "Runtime.evaluate") {
        return { result: {} };
      }
      if (method === "Page.setInterceptFileChooserDialog") {
        throw new Error("Page domain unavailable");
      }
      return {};
    });

    await expect(
      handleMessage(
        {
          type: "AI_UPLOAD_FILE_TO_TAB",
          provider: "chatgpt",
          tabId: 42,
          filePaths: ["/tmp/report.txt"],
        },
        {},
      ),
    ).rejects.toMatchObject({
      code: "attachment_chooser_interception",
      message: expect.stringContaining("chooser interception"),
    });
  });

  it("reports ChatGPT processing failures distinctly", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    chrome.debugger.sendCommand.mockImplementation(async (_target: any, method: string) => {
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "chatgpt-file-input" } };
      }
      if (method === "DOM.setFileInputFiles") {
        throw new Error("file rejected");
      }
      return {};
    });

    await expect(
      handleMessage(
        {
          type: "AI_UPLOAD_FILE_TO_TAB",
          provider: "chatgpt",
          tabId: 42,
          filePaths: ["/tmp/report.txt"],
        },
        {},
      ),
    ).rejects.toMatchObject({
      code: "attachment_processing",
      message: expect.stringContaining("processing"),
    });
  });

  it("reports ChatGPT upload selector drift distinctly", async () => {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    let runtimeEvaluations = 0;
    chrome.debugger.sendCommand.mockImplementation(async (_target: any, method: string) => {
      if (method === "Runtime.evaluate") {
        runtimeEvaluations += 1;
        return runtimeEvaluations === 1 ? { result: {} } : { result: { value: false } };
      }
      return {};
    });

    await expect(
      handleMessage(
        {
          type: "AI_UPLOAD_FILE_TO_TAB",
          provider: "chatgpt",
          tabId: 42,
          filePaths: ["/tmp/report.txt"],
        },
        {},
      ),
    ).rejects.toMatchObject({
      code: "attachment_selector_drift",
      message: expect.stringContaining("UI selector drift"),
    });
  });
});

describe("UPLOAD_FILE through an upload control", () => {
  beforeEach(() => {
    resetChromeMock();
  });

  async function uploadThroughButton(opensChooser: boolean) {
    const handleMessage = await loadHandleMessage();
    const chrome = (globalThis as any).chrome;
    const handlers: Array<(source: { tabId: number }, method: string, params: any) => void> = [];
    chrome.debugger.onEvent.addListener.mockImplementation((handler: (typeof handlers)[number]) => {
      handlers.push(handler);
    });
    chrome.tabs.sendMessage.mockResolvedValue({
      selector: '[data-pi-file-id="x"]',
      isFileInput: false,
    });
    chrome.debugger.sendCommand.mockImplementation(async (_target: any, method: string) => {
      if (method === "Runtime.evaluate") {
        return { result: { objectId: "document" } };
      }
      if (method !== "Runtime.callFunctionOn") {
        return {};
      }
      if (opensChooser) {
        setTimeout(() => {
          for (const handler of handlers) {
            handler({ tabId: 42 }, "Page.fileChooserOpened", { backendNodeId: 7 });
          }
        }, 0);
      }
      return { result: { value: true } };
    });
    const result = handleMessage(
      { type: "UPLOAD_FILE", tabId: 42, ref: "e640", files: ["/tmp/resume.pdf"] },
      {},
    );
    const interceptCalls = () =>
      chrome.debugger.sendCommand.mock.calls
        .filter(([, method]: [unknown, string]) => method === "Page.setInterceptFileChooserDialog")
        .map(([, , params]: [unknown, string, { enabled: boolean }]) => params.enabled);
    return { chrome, result, interceptCalls };
  }

  it("sets the files on the input the opened chooser names, then stops intercepting", async () => {
    const { chrome, result, interceptCalls } = await uploadThroughButton(true);

    await expect(result).resolves.toEqual({ success: true, filesSet: 1 });
    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 42 },
      "DOM.setFileInputFiles",
      {
        files: ["/tmp/resume.pdf"],
        backendNodeId: 7,
      },
    );
    expect(interceptCalls()).toEqual([true, false]);
  });

  it("fails after 10s when no chooser opens and still stops intercepting", async () => {
    vi.useFakeTimers();
    try {
      const { result, interceptCalls } = await uploadThroughButton(false);
      const failed = expect(result).rejects.toThrow(
        "No file chooser opened within 10s after clicking e640",
      );
      await vi.advanceTimersByTimeAsync(10_000);
      await failed;
      expect(interceptCalls()).toEqual([true, false]);
    } finally {
      vi.useRealTimers();
    }
  });
});
