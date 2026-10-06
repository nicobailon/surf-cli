import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { planContactSheet } from "../../../src/service-worker/semantic-vision";
import { createChromeMock } from "../../mocks/chrome";

vi.mock("../../../src/native/port-manager", () => ({
  initNativeMessaging: vi.fn(),
  postToNativeHost: vi.fn(),
}));

const SHEET = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const TILE_PNG = base64(SHEET);

const refs = Array.from({ length: 18 }, (_, index) => `e${index + 1}`);
const observation = {
  version: 1,
  identity: { fullUrl: "https://example.test/", documentToken: "doc" },
  page: { title: "Toolbar", readyState: "complete", modals: [] },
  candidates: refs.map((ref) => ({ ref, role: "button", name: "", type: "button" })),
  chunks: [],
  omitted: { candidates: 0, chunks: 0 },
};

let handleMessage: (message: any, sender: any) => Promise<any>;
let messages: Array<{ message: any; frameId?: number }>;

beforeAll(async () => {
  (globalThis as any).chrome = createChromeMock();
  handleMessage = (await import("../../../src/service-worker/index")).handleMessage;
});

function routeContent(tree: Record<string, unknown>, tiles: unknown) {
  (globalThis as any).chrome.tabs.sendMessage.mockImplementation(
    async (_tabId: number, message: any, options: any) => {
      messages.push({ message, frameId: options?.frameId });
      if (message.type === "GENERATE_ACCESSIBILITY_TREE") {
        return structuredClone(tree);
      }
      return message.type === "SEMANTIC_VISION_TILES" ? { tiles } : undefined;
    },
  );
}

const read = (options: Record<string, unknown>, frameId?: number) =>
  handleMessage(
    { type: "READ_PAGE", tabId: 9, frameId, options: { semanticObservation: true, ...options } },
    {},
  );
const tile = (ref: string, size = 48) => ({ ref, data: TILE_PNG, width: size, height: size });
const tileRequests = () =>
  messages.filter(({ message }) => message.type === "SEMANTIC_VISION_TILES");

describe("READ_PAGE semantic vision", () => {
  beforeEach(() => {
    (globalThis as any).chrome = createChromeMock();
    messages = [];
    vi.stubGlobal("createImageBitmap", async () => ({ width: 48, height: 48, close: vi.fn() }));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          public width: number,
          public height: number,
        ) {}
        getContext() {
          return { drawImage: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn() };
        }
        async convertToBlob() {
          return new Blob([SHEET], { type: "image/png" });
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks the main frame for at most 16 tiles and counts every control without one as skipped", async () => {
    routeContent(
      { pageContent: "", semanticObservation: observation, semanticVisionTargets: refs },
      [tile("e2"), tile("e5")],
    );

    const result = await read({ semanticVision: true });

    expect(tileRequests()).toEqual([
      { message: { type: "SEMANTIC_VISION_TILES", refs: refs.slice(0, 16) }, frameId: 0 },
    ]);
    expect(result).not.toHaveProperty("semanticVisionTargets");
    expect(result.semanticObservation.vision).toEqual({
      image: { mimeType: "image/png", data: base64(SHEET) },
      tiles: [
        { ref: "e2", x: 8, y: 24, width: 48, height: 48 },
        { ref: "e5", x: 64, y: 24, width: 48, height: 48 },
      ],
      skipped: 16,
    });
  });

  it("draws nothing for a child frame or when no control has a tile", async () => {
    routeContent(
      { pageContent: "", semanticObservation: observation, semanticVisionTargets: ["e1", "e2"] },
      [],
    );

    expect((await read({ semanticVision: true }, 3)).semanticObservation.vision).toEqual({
      image: null,
      tiles: [],
      skipped: 2,
    });
    expect(tileRequests()).toEqual([]);
    expect((await read({ semanticVision: true })).semanticObservation.vision).toEqual({
      image: null,
      tiles: [],
      skipped: 2,
    });
  });

  it("leaves the observation untouched without semanticVision", async () => {
    routeContent({ pageContent: "", semanticObservation: observation }, [tile("e1")]);

    const result = await read({});

    expect(result.semanticObservation).toEqual({
      ...observation,
      identity: { ...observation.identity, tabId: 9, frameId: 0 },
    });
    expect(tileRequests()).toEqual([]);
  });

  it("fails the read when the page returns a tile it wasn't asked for", async () => {
    routeContent(
      { pageContent: "", semanticObservation: observation, semanticVisionTargets: ["e1"] },
      [tile("e9")],
    );

    await expect(read({ semanticVision: true })).rejects.toThrow(
      "semantic vision failed: the page returned invalid icon tiles",
    );
  });
});

describe("contact sheet layout", () => {
  const overlaps = (a: any, b: any) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  it("keeps the long side within 1024 pixels, shrinking only tiles that don't fit, with a label band above each", () => {
    const big = planContactSheet(
      Array.from({ length: 16 }, (_, index) => ({ ref: `e${index + 1}`, width: 900, height: 300 })),
    );
    expect(Math.max(big.width, big.height)).toBeLessThanOrEqual(1024);
    const rects = big.tiles.flatMap(({ sheet, label }) => [sheet, label]);
    for (const [index, rect] of rects.entries()) {
      for (const other of rects.slice(index + 1)) {
        expect(overlaps(rect, other)).toBe(false);
      }
    }
    expect(
      big.tiles.every(
        ({ sheet }) => sheet.width < 900 && Math.abs(sheet.width / sheet.height - 3) < 0.1,
      ),
    ).toBe(true);
    expect(big.tiles.every(({ sheet, label }) => label.y + label.height === sheet.y)).toBe(true);

    const small = planContactSheet([{ ref: "e1", width: 40, height: 24 }]);
    expect(small).toEqual({
      width: 56,
      height: 56,
      tiles: [
        {
          ref: "e1",
          sheet: { x: 8, y: 24, width: 40, height: 24 },
          label: { x: 8, y: 8, width: 40, height: 16 },
        },
      ],
    });
  });
});

describe("SEMANTIC_VISION_ICON_FETCH", () => {
  const contentScript = { id: "surf", tab: { id: 9 } };

  beforeEach(() => {
    (globalThis as any).chrome = createChromeMock();
    (globalThis as any).chrome.runtime.id = "surf";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches an image for a content script without cookies, and refuses other senders and oversized images", async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init).toMatchObject({ credentials: "omit", cache: "force-cache" });
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png; x=y" },
      });
    });
    vi.stubGlobal("fetch", fetch);

    await expect(
      handleMessage(
        { type: "SEMANTIC_VISION_ICON_FETCH", url: "https://cdn.test/a.png" },
        contentScript,
      ),
    ).resolves.toEqual({ mimeType: "image/png", data: base64(new Uint8Array([1, 2, 3])) });
    await expect(
      handleMessage({ type: "SEMANTIC_VISION_ICON_FETCH", url: "https://cdn.test/a.png" }, {}),
    ).rejects.toThrow("only for content scripts");

    fetch.mockResolvedValueOnce(
      new Response(new Uint8Array(512 * 1024 + 1), { headers: { "content-type": "image/png" } }),
    );
    await expect(
      handleMessage(
        { type: "SEMANTIC_VISION_ICON_FETCH", url: "https://cdn.test/big.png" },
        contentScript,
      ),
    ).rejects.toThrow("icon image is too large");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
