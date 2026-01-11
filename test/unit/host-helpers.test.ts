// @ts-expect-error - CommonJS module without type definitions
import * as helpers from "../../native/host-helpers.cjs";

describe("mapToolToMessage", () => {
  describe("window commands", () => {
    it("maps window.new to WINDOW_NEW with url", () => {
      const msg = helpers.mapToolToMessage("window.new", { url: "https://example.com" });
      expect(msg.type).toBe("WINDOW_NEW");
      expect(msg.url).toBe("https://example.com");
    });

    it("parses window dimensions as integers", () => {
      const msg = helpers.mapToolToMessage("window.new", { width: "1280", height: "720" });
      expect(msg.width).toBe(1280);
      expect(msg.height).toBe(720);
    });

    it("maps window.new --incognito", () => {
      const msg = helpers.mapToolToMessage("window.new", { incognito: true });
      expect(msg.incognito).toBe(true);
    });

    it("maps window.new --unfocused to focused: false", () => {
      const msg = helpers.mapToolToMessage("window.new", { unfocused: true });
      expect(msg.focused).toBe(false);
    });

    it("maps window.list with --tabs", () => {
      const msg = helpers.mapToolToMessage("window.list", { tabs: true });
      expect(msg.type).toBe("WINDOW_LIST");
      expect(msg.includeTabs).toBe(true);
    });

    it("throws on window.focus without id", () => {
      expect(() => helpers.mapToolToMessage("window.focus", {})).toThrow("window id required");
    });

    it("throws on window.close without id", () => {
      expect(() => helpers.mapToolToMessage("window.close", {})).toThrow("window id required");
    });

    it("throws on window.resize without --id", () => {
      expect(() => helpers.mapToolToMessage("window.resize", { width: 800 })).toThrow(
        "--id required",
      );
    });

    it("parses window.focus id as integer", () => {
      const msg = helpers.mapToolToMessage("window.focus", { id: "123456" });
      expect(msg.windowId).toBe(123456);
    });
  });

  describe("tab commands with windowId", () => {
    it("maps tab.list to LIST_TABS", () => {
      const msg = helpers.mapToolToMessage("tab.list", {});
      expect(msg.type).toBe("LIST_TABS");
    });

    it("maps tab.new with url", () => {
      const msg = helpers.mapToolToMessage("tab.new", { url: "https://example.com" });
      expect(msg.type).toBe("NEW_TAB");
      expect(msg.url).toBe("https://example.com");
    });
  });

  describe("error cases", () => {
    it("returns null for unknown tool", () => {
      expect(helpers.mapToolToMessage("unknown.command", {})).toBeNull();
    });
  });
});

describe("formatToolContent", () => {
  describe("window responses", () => {
    it("formats window.new success", () => {
      const result = helpers.formatToolContent({
        success: true,
        windowId: 123,
        tabId: 456,
        hint: "Use --window-id 123",
      });
      expect(result[0].text).toContain("Window 123");
      expect(result[0].text).toContain("tab 456");
      expect(result[0].text).toContain("--window-id 123");
    });

    it("formats window.list as JSON", () => {
      const result = helpers.formatToolContent({
        windows: [{ id: 1, tabCount: 2 }],
      });
      const parsed = JSON.parse(result[0].text);
      expect(parsed.windows).toHaveLength(1);
      expect(parsed.windows[0].id).toBe(1);
    });
  });

  describe("hint handling", () => {
    it("appends _hint to output", () => {
      const result = helpers.formatToolContent({
        success: true,
        _hint: "Try this next",
      });
      expect(result[0].text).toContain("[hint] Try this next");
    });

    it("strips _resolvedTabId from JSON output", () => {
      const result = helpers.formatToolContent({
        someData: "value",
        _resolvedTabId: 123,
        _hint: "hint",
      });
      expect(result[0].text).not.toContain("_resolvedTabId");
    });
  });

  describe("basic responses", () => {
    it("returns OK for simple success", () => {
      const result = helpers.formatToolContent({ success: true });
      expect(result[0].text).toBe("OK");
    });

    it("returns OK for null/undefined", () => {
      expect(helpers.formatToolContent(null)[0].text).toBe("OK");
      expect(helpers.formatToolContent(undefined)[0].text).toBe("OK");
    });
  });
});
