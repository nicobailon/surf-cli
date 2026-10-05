import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeMock, resetChromeMock } from "../../mocks/chrome";

const cdpState = vi.hoisted(() => ({ captureScreenshot: vi.fn() }));

vi.mock("../../../src/cdp/controller", () => ({
  CDPController: class {
    captureScreenshot = cdpState.captureScreenshot;
  },
}));

vi.mock("../../../src/native/port-manager", () => ({
  initNativeMessaging: vi.fn(),
  postToNativeHost: vi.fn(),
}));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

const observation = {
  version: 1,
  identity: { fullUrl: "https://example.test/", documentToken: "doc" },
  page: { title: "Toolbar", readyState: "complete", modals: [] },
  candidates: [
    { ref: "e1", role: "button", name: "", type: "button", nearbyText: "Toolbar" },
    { ref: "e2", role: "button", name: "", type: "button", nearbyText: "Toolbar" },
    { ref: "e3", role: "button", name: "Save", type: "button", nearbyText: "Toolbar" },
  ],
  chunks: [{ id: "c1", text: "Toolbar", refs: ["e1", "e2", "e3"] }],
  omitted: { candidates: 0, chunks: 0 },
};

const targets = [
  { ref: "e1", rect: { x: 100, y: 50, width: 24, height: 24 } },
  { ref: "e2", rect: { x: 140, y: 50, width: 24, height: 24 } },
];

let bitmapClose: ReturnType<typeof vi.fn>;
let order: string[];

function routeContentMessages(tree: Record<string, unknown>, recheck: Record<string, unknown>) {
  const chrome = (globalThis as any).chrome;
  chrome.tabs.sendMessage.mockImplementation(async (_tabId: number, message: any) => {
    order.push(message.type);
    if (message.type === "GENERATE_ACCESSIBILITY_TREE") {
      return structuredClone(tree);
    }
    if (message.type === "SEMANTIC_VISION_RECHECK") {
      return recheck;
    }
    return undefined;
  });
}

async function loadHandleMessage() {
  vi.resetModules();
  (globalThis as any).chrome = createChromeMock();
  const mod = await import("../../../src/service-worker/index");
  return mod.handleMessage;
}

describe("READ_PAGE semantic vision", () => {
  beforeEach(() => {
    resetChromeMock();
    order = [];
    bitmapClose = vi.fn();
    cdpState.captureScreenshot.mockReset();
    cdpState.captureScreenshot.mockImplementation(async () => {
      order.push("capture");
      return { base64: "AAAA", width: 1265, height: 800 };
    });
    vi.stubGlobal("createImageBitmap", async () => ({
      width: 2560,
      height: 1600,
      close: bitmapClose,
    }));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          public width: number,
          public height: number,
        ) {}
        getContext() {
          return {
            drawImage: vi.fn(),
            fillRect: vi.fn(),
            strokeRect: vi.fn(),
            fillText: vi.fn(),
          };
        }
        async convertToBlob() {
          return new Blob([PNG], { type: "image/png" });
        }
      },
    );
    vi.stubGlobal(
      "FileReader",
      class {
        result = "";
        onload: (() => void) | null = null;
        async readAsDataURL(blob: Blob) {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          this.result = `data:image/png;base64,${base64(bytes)}`;
          this.onload?.();
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches one contact sheet of rechecked controls and drops covered ones", async () => {
    const handleMessage = await loadHandleMessage();
    routeContentMessages(
      {
        pageContent: "",
        viewport: {},
        semanticObservation: observation,
        semanticVisionTargets: targets,
        semanticVisionMasks: [],
      },
      {
        viewport: { width: 1280, height: 800 },
        current: { e1: targets[0].rect, e2: null },
        masks: [],
        fieldsChanged: false,
      },
    );

    const result = await handleMessage(
      { type: "READ_PAGE", tabId: 9, options: { semanticObservation: true, semanticVision: true } },
      {} as chrome.runtime.MessageSender,
    );

    expect(result).not.toHaveProperty("semanticVisionMasks");
    expect(result).not.toHaveProperty("semanticVisionTargets");
    expect(result.semanticObservation.candidates).toEqual(observation.candidates);
    expect(result.semanticObservation.vision).toEqual({
      image: { mimeType: "image/png", data: base64(PNG) },
      tiles: [{ ref: "e1", x: 8, y: 24, width: 64, height: 64 }],
      skipped: 1,
    });
    expect(cdpState.captureScreenshot).toHaveBeenCalledTimes(1);
    expect(order).toEqual([
      "HIDE_FOR_TOOL_USE",
      "GENERATE_ACCESSIBILITY_TREE",
      "capture",
      "SEMANTIC_VISION_RECHECK",
      "SHOW_AFTER_TOOL_USE",
    ]);
    expect(bitmapClose).toHaveBeenCalledTimes(1);
  });

  it("sends no image when a field changed between the pre-capture measurement and the recheck", async () => {
    const handleMessage = await loadHandleMessage();
    const field = { x: 90, y: 40, width: 20, height: 20 };
    for (const [before, after, fieldsChanged] of [
      [[field], [field], true],
      [[field], [], false],
    ] as const) {
      routeContentMessages(
        {
          pageContent: "",
          viewport: {},
          semanticObservation: observation,
          semanticVisionTargets: targets,
          semanticVisionMasks: before,
        },
        {
          viewport: { width: 1280, height: 800 },
          current: { e1: targets[0].rect, e2: targets[1].rect },
          masks: after,
          fieldsChanged,
        },
      );

      const result = await handleMessage(
        {
          type: "READ_PAGE",
          tabId: 9,
          options: { semanticObservation: true, semanticVision: true },
        },
        {} as chrome.runtime.MessageSender,
      );

      expect(result.semanticObservation.vision).toEqual({ image: null, tiles: [], skipped: 2 });
    }
  });

  it("fails the read with a vision-specific error when the capture fails", async () => {
    const handleMessage = await loadHandleMessage();
    routeContentMessages(
      {
        pageContent: "",
        viewport: {},
        semanticObservation: observation,
        semanticVisionTargets: targets,
        semanticVisionMasks: [],
      },
      {},
    );
    cdpState.captureScreenshot.mockRejectedValue(new Error("Debugger is not attached"));

    await expect(
      handleMessage(
        {
          type: "READ_PAGE",
          tabId: 9,
          options: { semanticObservation: true, semanticVision: true },
        },
        {} as chrome.runtime.MessageSender,
      ),
    ).rejects.toThrow("semantic vision capture failed: Debugger is not attached");
    expect(order.at(-1)).toBe("SHOW_AFTER_TOOL_USE");
  });

  it("fails the read when the capture does not match the page viewport", async () => {
    const handleMessage = await loadHandleMessage();
    routeContentMessages(
      {
        pageContent: "",
        viewport: {},
        semanticObservation: observation,
        semanticVisionTargets: targets,
        semanticVisionMasks: [],
      },
      {
        viewport: { width: 1280, height: 900 },
        current: { e1: targets[0].rect, e2: targets[1].rect },
        masks: [],
        fieldsChanged: false,
      },
    );

    await expect(
      handleMessage(
        {
          type: "READ_PAGE",
          tabId: 9,
          options: { semanticObservation: true, semanticVision: true },
        },
        {} as chrome.runtime.MessageSender,
      ),
    ).rejects.toThrow(
      "semantic vision capture failed: the screenshot does not match the page viewport",
    );
    expect(bitmapClose).toHaveBeenCalledTimes(1);
  });

  it("captures nothing and adds no vision field without semanticVision", async () => {
    const handleMessage = await loadHandleMessage();
    routeContentMessages({ pageContent: "", viewport: {}, semanticObservation: observation }, {});

    const result = await handleMessage(
      { type: "READ_PAGE", tabId: 9, options: { semanticObservation: true } },
      {} as chrome.runtime.MessageSender,
    );

    expect(result.semanticObservation).toEqual({
      ...observation,
      identity: { ...observation.identity, tabId: 9, frameId: 0 },
    });
    expect(cdpState.captureScreenshot).not.toHaveBeenCalled();
  });

  it("takes no screenshot when every candidate is named or the read targets a child frame", async () => {
    const handleMessage = await loadHandleMessage();
    routeContentMessages(
      {
        pageContent: "",
        viewport: {},
        semanticObservation: observation,
        semanticVisionTargets: [],
      },
      {},
    );
    const labeled = await handleMessage(
      { type: "READ_PAGE", tabId: 9, options: { semanticObservation: true, semanticVision: true } },
      {} as chrome.runtime.MessageSender,
    );
    expect(labeled.semanticObservation.vision).toEqual({ image: null, tiles: [], skipped: 0 });

    routeContentMessages(
      {
        pageContent: "",
        viewport: {},
        semanticObservation: observation,
        semanticVisionTargets: targets,
        semanticVisionMasks: [],
      },
      {},
    );
    const framed = await handleMessage(
      {
        type: "READ_PAGE",
        tabId: 9,
        frameId: 4,
        options: { semanticObservation: true, semanticVision: true },
      },
      {} as chrome.runtime.MessageSender,
    );
    expect(framed.semanticObservation.vision).toEqual({ image: null, tiles: [], skipped: 2 });
    expect(cdpState.captureScreenshot).not.toHaveBeenCalled();
    expect(order).not.toContain("SEMANTIC_VISION_RECHECK");
  });
});
