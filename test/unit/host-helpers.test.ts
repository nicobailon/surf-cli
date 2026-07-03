// @ts-expect-error - CommonJS module without type definitions
import * as helpers from "../../native/host-helpers.cjs";

describe("buildProviderUploadMessage", () => {
  it("builds provider-aware ChatGPT upload messages", () => {
    expect(helpers.buildProviderUploadMessage("chatgpt", 123, ["/tmp/file.txt"], 7)).toEqual({
      type: "AI_UPLOAD_FILE_TO_TAB",
      provider: "chatgpt",
      tabId: 123,
      filePaths: ["/tmp/file.txt"],
      id: 7,
    });
  });

  it("builds provider-aware Gemini upload messages", () => {
    expect(helpers.buildProviderUploadMessage("gemini", 456, ["/tmp/image.png"], 8)).toEqual({
      type: "AI_UPLOAD_FILE_TO_TAB",
      provider: "gemini",
      tabId: 456,
      filePaths: ["/tmp/image.png"],
      id: 8,
    });
  });

  it("rejects unsupported upload providers", () => {
    expect(() => helpers.buildProviderUploadMessage("perplexity", 1, ["/tmp/file.txt"], 2)).toThrow(
      "Unsupported upload provider: perplexity",
    );
  });
});

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

  describe("aistudio commands", () => {
    it("maps aistudio to AISTUDIO_QUERY with default model", () => {
      const msg = helpers.mapToolToMessage("aistudio", { query: "hi" });
      expect(msg.type).toBe("AISTUDIO_QUERY");
      expect(msg.model).toBeUndefined();
    });

    it("normalizes aistudio model to lowercase", () => {
      const msg = helpers.mapToolToMessage("aistudio", {
        query: "hi",
        model: "GEMINI-3-FLASH-PREVIEW",
      });
      expect(msg.model).toBe("gemini-3-flash-preview");
    });

    it("does not validate aistudio model ids (passes through)", () => {
      const msg = helpers.mapToolToMessage("aistudio", {
        query: "hi",
        model: "gemini-flash-lite-latest",
      });
      expect(msg.model).toBe("gemini-flash-lite-latest");
    });
  });

  describe("screenshot commands", () => {
    it("maps full-page to fullpage", () => {
      const msg = helpers.mapToolToMessage("screenshot", { "full-page": true });
      expect(msg.type).toBe("EXECUTE_SCREENSHOT");
      expect(msg.fullpage).toBe(true);
    });

    it("preserves fullpage mapping", () => {
      const msg = helpers.mapToolToMessage("screenshot", { fullpage: true });
      expect(msg.fullpage).toBe(true);
    });
  });

  describe("animate-audit command", () => {
    it("maps animate-audit with bounded defaults", () => {
      const msg = helpers.mapToolToMessage("animate-audit", { selector: ".thing" }, 123);
      expect(msg).toMatchObject({
        type: "ANIMATE_AUDIT",
        selector: ".thing",
        durationMs: 2000,
        fps: 10,
        tabId: 123,
      });
    });

    it("parses animate-audit duration and fps", () => {
      const msg = helpers.mapToolToMessage(
        "animate-audit",
        { selector: ".thing", duration: "1500", fps: "12" },
        123,
      );
      expect(msg.durationMs).toBe(1500);
      expect(msg.fps).toBe(12);
    });

    it("requires animate-audit selector", () => {
      expect(() => helpers.mapToolToMessage("animate-audit", {})).toThrow("selector required");
    });

    it("rejects malformed animate-audit duration and fps", () => {
      expect(() =>
        helpers.mapToolToMessage("animate-audit", { selector: ".thing", duration: true }),
      ).toThrow("duration must be a number");
      expect(() =>
        helpers.mapToolToMessage("animate-audit", { selector: ".thing", fps: true }),
      ).toThrow("fps must be a number");
      expect(() =>
        helpers.mapToolToMessage("animate-audit", { selector: ".thing", duration: "10001" }),
      ).toThrow("duration must be between 100 and 10000 ms");
      expect(() =>
        helpers.mapToolToMessage("animate-audit", { selector: ".thing", fps: "31" }),
      ).toThrow("fps must be between 1 and 30");
    });
  });

  describe("perf-audit command", () => {
    it("maps perf-audit with bounded defaults", () => {
      const msg = helpers.mapToolToMessage("perf-audit", {}, 123);
      expect(msg).toMatchObject({
        type: "PERF_AUDIT",
        durationMs: 3000,
        tabId: 123,
      });
    });

    it("parses perf-audit duration and trigger", () => {
      const msg = helpers.mapToolToMessage(
        "perf-audit",
        { duration: "1500", trigger: "click:.cta" },
        123,
      );
      expect(msg).toMatchObject({
        type: "PERF_AUDIT",
        durationMs: 1500,
        trigger: "click:.cta",
        tabId: 123,
      });
    });

    it("rejects malformed perf-audit options", () => {
      expect(() => helpers.mapToolToMessage("perf-audit", { duration: true })).toThrow(
        "duration must be a number",
      );
      expect(() => helpers.mapToolToMessage("perf-audit", { duration: "10001" })).toThrow(
        "duration must be between 100 and 10000 ms",
      );
      expect(() => helpers.mapToolToMessage("perf-audit", { trigger: true })).toThrow(
        "trigger must be action:target",
      );
    });
  });

  describe("scroll commands", () => {
    it("maps direction and amount flags to scroll deltas", () => {
      const msg = helpers.mapToolToMessage("scroll", { direction: "down", amount: 4 }, 123);
      expect(msg).toMatchObject({ type: "EXECUTE_SCROLL", deltaX: 0, deltaY: 400, tabId: 123 });
    });

    it("preserves legacy scroll_direction and scroll_amount mapping", () => {
      const msg = helpers.mapToolToMessage(
        "scroll",
        { scroll_direction: "up", scroll_amount: 2 },
        123,
      );
      expect(msg).toMatchObject({ type: "EXECUTE_SCROLL", deltaX: 0, deltaY: -200, tabId: 123 });
    });

    it("uses shorthand pixel amounts without multiplying by 100", () => {
      const msg = helpers.mapToolToMessage(
        "scroll",
        { direction: "down", scroll_pixels: 800 },
        123,
      );
      expect(msg).toMatchObject({ type: "EXECUTE_SCROLL", deltaX: 0, deltaY: 800, tabId: 123 });
    });

    it("maps scroll.top and scroll.bottom dot commands", () => {
      expect(helpers.mapToolToMessage("scroll.top", {}, 123)).toMatchObject({
        type: "SCROLL_TO_POSITION",
        position: "top",
        tabId: 123,
      });
      expect(helpers.mapToolToMessage("scroll.bottom", {}, 123)).toMatchObject({
        type: "SCROLL_TO_POSITION",
        position: "bottom",
        tabId: 123,
      });
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

  describe("scroll responses", () => {
    it("formats scrollBy position output", () => {
      const result = helpers.formatToolContent({ scrollY: 800, pageHeight: 3200, scrolled: true });
      expect(result[0].text).toBe("Scrolled to Y:800 (page height: 3200)");
    });

    it("formats scroll position output", () => {
      const result = helpers.formatToolContent({ scrollTop: 0, scrollHeight: 3200, atTop: true });
      expect(result[0].text).toBe("Scrolled to Y:0 (page height: 3200)");
    });

    it("preserves detailed scroll info output", () => {
      const result = helpers.formatToolContent({
        scrollTop: 800,
        scrollHeight: 3200,
        clientHeight: 900,
        atTop: false,
        atBottom: false,
        scrollPercentage: 35,
      });

      expect(JSON.parse(result[0].text)).toEqual({
        scrollTop: 800,
        scrollHeight: 3200,
        clientHeight: 900,
        atTop: false,
        atBottom: false,
        scrollPercentage: 35,
      });
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
