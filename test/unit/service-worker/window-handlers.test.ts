import { vi } from "vitest";
import { createChromeMock, resetChromeMock } from "../../mocks/chrome";

// Mock the native port-manager to prevent initNativeMessaging side effects
vi.mock("../../../src/native/port-manager", () => ({
  initNativeMessaging: vi.fn(),
  postToNativeHost: vi.fn(),
}));

// Use dynamic import to ensure chrome mock is set up BEFORE module loads
let handleMessage: (message: any, sender: any) => Promise<any>;

beforeAll(async () => {
  // Set up chrome mock BEFORE importing the module
  (globalThis as any).chrome = createChromeMock();

  // Dynamic import after mock is ready
  const mod = await import("../../../src/service-worker/index");
  handleMessage = mod.handleMessage;
});

describe("window command handlers", () => {
  beforeEach(() => {
    // Fresh mock for each test
    (globalThis as any).chrome = createChromeMock();
  });

  afterEach(() => {
    resetChromeMock();
  });

  describe("WINDOW_NEW", () => {
    it("creates window with URL", async () => {
      const chrome = (globalThis as any).chrome;
      chrome.windows.create.mockResolvedValue({ id: 123 });
      chrome.tabs.query.mockResolvedValue([{ id: 456 }]);

      const result = await handleMessage({ type: "WINDOW_NEW", url: "https://example.com" }, {});

      expect(chrome.windows.create).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://example.com",
          focused: true,
          type: "normal",
        }),
      );
      expect(result.windowId).toBe(123);
      expect(result.tabId).toBe(456);
    });

    it("creates window with dimensions", async () => {
      const chrome = (globalThis as any).chrome;
      chrome.windows.create.mockResolvedValue({ id: 1 });
      chrome.tabs.query.mockResolvedValue([{ id: 1 }]);

      await handleMessage({ type: "WINDOW_NEW", width: 1280, height: 720 }, {});

      expect(chrome.windows.create).toHaveBeenCalledWith(
        expect.objectContaining({
          width: 1280,
          height: 720,
        }),
      );
    });

    it("creates incognito window", async () => {
      const chrome = (globalThis as any).chrome;
      chrome.windows.create.mockResolvedValue({ id: 1 });
      chrome.tabs.query.mockResolvedValue([{ id: 1 }]);

      await handleMessage({ type: "WINDOW_NEW", incognito: true }, {});

      expect(chrome.windows.create).toHaveBeenCalledWith(
        expect.objectContaining({
          incognito: true,
        }),
      );
    });

    it("includes hint in response", async () => {
      const chrome = (globalThis as any).chrome;
      chrome.windows.create.mockResolvedValue({ id: 999 });
      chrome.tabs.query.mockResolvedValue([{ id: 1 }]);

      const result = await handleMessage({ type: "WINDOW_NEW" }, {});

      expect(result.hint).toContain("--window-id 999");
    });
  });

  describe("WINDOW_LIST", () => {
    it("returns all windows", async () => {
      const chrome = (globalThis as any).chrome;
      chrome.windows.getAll.mockResolvedValue([
        { id: 1, focused: true, width: 800, height: 600, tabs: [] },
        { id: 2, focused: false, width: 1024, height: 768, tabs: [] },
      ]);

      const result = await handleMessage({ type: "WINDOW_LIST" }, {});

      expect(result.windows).toHaveLength(2);
      expect(result.windows[0].id).toBe(1);
      expect(result.windows[0].focused).toBe(true);
    });

    it("includes tabs when requested", async () => {
      const chrome = (globalThis as any).chrome;
      chrome.windows.getAll.mockResolvedValue([
        { id: 1, tabs: [{ id: 10, title: "Tab 1", url: "https://a.com" }] },
      ]);

      const result = await handleMessage({ type: "WINDOW_LIST", includeTabs: true }, {});

      expect(result.windows[0].tabs).toHaveLength(1);
      expect(result.windows[0].tabs[0].title).toBe("Tab 1");
    });
  });

  describe("WINDOW_FOCUS", () => {
    it("focuses window by ID", async () => {
      const chrome = (globalThis as any).chrome;
      chrome.windows.update.mockResolvedValue({});

      const result = await handleMessage({ type: "WINDOW_FOCUS", windowId: 123 }, {});

      expect(chrome.windows.update).toHaveBeenCalledWith(123, { focused: true });
      expect(result.success).toBe(true);
    });

    it("throws without windowId", async () => {
      await expect(handleMessage({ type: "WINDOW_FOCUS" }, {})).rejects.toThrow(
        "No windowId provided",
      );
    });
  });

  describe("WINDOW_CLOSE", () => {
    it("closes window by ID", async () => {
      const chrome = (globalThis as any).chrome;
      chrome.windows.remove.mockResolvedValue(undefined);

      const result = await handleMessage({ type: "WINDOW_CLOSE", windowId: 123 }, {});

      expect(chrome.windows.remove).toHaveBeenCalledWith(123);
      expect(result.success).toBe(true);
    });
  });

  describe("WINDOW_RESIZE", () => {
    it("resizes window", async () => {
      const chrome = (globalThis as any).chrome;
      chrome.windows.update.mockResolvedValue({ width: 1920, height: 1080 });

      const result = await handleMessage(
        {
          type: "WINDOW_RESIZE",
          windowId: 123,
          width: 1920,
          height: 1080,
        },
        {},
      );

      expect(chrome.windows.update).toHaveBeenCalledWith(
        123,
        expect.objectContaining({
          width: 1920,
          height: 1080,
        }),
      );
      expect(result.width).toBe(1920);
    });
  });

  describe("tab commands with windowId", () => {
    describe("LIST_TABS", () => {
      it("filters by windowId when provided", async () => {
        const chrome = (globalThis as any).chrome;
        chrome.tabs.query.mockResolvedValue([{ id: 1, title: "Tab 1" }]);

        await handleMessage({ type: "LIST_TABS", windowId: 123 }, {});

        expect(chrome.tabs.query).toHaveBeenCalledWith({ windowId: 123 });
      });

      it("queries all windows when no windowId", async () => {
        const chrome = (globalThis as any).chrome;
        chrome.tabs.query.mockResolvedValue([]);

        await handleMessage({ type: "LIST_TABS" }, {});

        expect(chrome.tabs.query).toHaveBeenCalledWith({});
      });
    });

    describe("NEW_TAB", () => {
      it("creates tab in specified window", async () => {
        const chrome = (globalThis as any).chrome;
        chrome.tabs.create.mockResolvedValue({ id: 1 });

        await handleMessage({ type: "NEW_TAB", url: "https://example.com", windowId: 123 }, {});

        expect(chrome.tabs.create).toHaveBeenCalledWith(
          expect.objectContaining({
            url: "https://example.com",
            windowId: 123,
          }),
        );
      });
    });
  });
});
