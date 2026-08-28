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

    it("uses the resolved target for a no-ID tab.close", () => {
      expect(helpers.mapToolToMessage("tab.close", {}, 42)).toEqual({
        type: "CLOSE_TAB",
        tabId: 42,
        tabIds: undefined,
      });
    });

    it("maps tab.move to TAB_MOVE", () => {
      const msg = helpers.mapToolToMessage("tab.move", {
        id: "123",
        "to-window": "456",
        index: "0",
      });
      expect(msg).toMatchObject({
        type: "TAB_MOVE",
        tabId: "123",
        windowId: "456",
        index: "0",
      });
    });
  });

  describe("oracle commands", () => {
    it("maps oracle socket tools to host-owned messages", () => {
      expect(
        helpers.mapToolToMessage("oracle.ask", {
          prompt: "review",
          model: "pro",
          file: "/tmp/report.md",
          github: true,
        }),
      ).toEqual({
        type: "ORACLE_ASK",
        prompt: "review",
        model: "pro",
        file: "/tmp/report.md",
        github: true,
      });
      expect(helpers.mapToolToMessage("oracle.status", { id: "job" })).toEqual({
        type: "ORACLE_STATUS",
        id: "job",
      });
      expect(helpers.mapToolToMessage("oracle.result", { id: "job", timeout: 5 })).toEqual({
        type: "ORACLE_RESULT",
        id: "job",
        timeout: 5,
      });
      expect(helpers.mapToolToMessage("oracle.list", {})).toEqual({ type: "ORACLE_LIST" });
    });

    it("requires ask prompts and result ids", () => {
      expect(() => helpers.mapToolToMessage("oracle.ask", {})).toThrow("prompt required");
      expect(() => helpers.mapToolToMessage("oracle.result", {})).toThrow("id required");
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

  describe("page.read command", () => {
    it("maps compact max-bytes to READ_PAGE options", () => {
      const msg = helpers.mapToolToMessage("page.read", {
        compact: true,
        "max-bytes": "1200",
        depth: "2",
      });
      expect(msg).toMatchObject({
        type: "READ_PAGE",
        options: {
          compact: true,
          maxBytes: 1200,
          depth: 2,
          forceFullSnapshot: true,
        },
      });
    });

    it("throws when max-bytes is not a positive integer", () => {
      for (const bad of ["abc", "0", "-5", "12abc", "1.5", " ", ""]) {
        expect(() => helpers.mapToolToMessage("page.read", { "max-bytes": bad })).toThrow(
          /max-bytes must be a positive integer/,
        );
      }
    });

    it("accepts a valid positive integer max-bytes", () => {
      const msg = helpers.mapToolToMessage("page.read", { "max-bytes": "1200" });
      expect(msg.options.maxBytes).toBe(1200);
      expect(msg.options.forceFullSnapshot).toBe(true);
    });
  });

  describe("page.html command", () => {
    it("maps page HTML commands and export options to the dedicated message", () => {
      for (const tool of ["page.html", "page.save"]) {
        expect(
          helpers.mapToolToMessage(tool, { selector: "#artifact", "strip-scripts": true }, 123),
        ).toEqual({
          type: "GET_PAGE_HTML",
          selector: "#artifact",
          stripScripts: true,
          tabId: 123,
        });
      }
    });

    it("rejects invalid export selectors", () => {
      for (const selector of ["", false]) {
        expect(() => helpers.mapToolToMessage("page.html", { selector })).toThrow(
          "selector must be a non-empty string",
        );
      }
    });
  });

  describe("type command", () => {
    it("routes a selector target to SMART_TYPE", () => {
      const msg = helpers.mapToolToMessage("type", { text: "hello", selector: "#i" });
      expect(msg.type).toBe("SMART_TYPE");
      expect(msg.selector).toBe("#i");
      expect(msg.text).toBe("hello");
      expect(msg.clear).toBe(true);
      expect(msg.submit).toBe(false);
    });

    it("routes an --into target to SMART_TYPE without CLI normalization", () => {
      const msg = helpers.mapToolToMessage("type", { text: "hello", into: "#target" });
      expect(msg.type).toBe("SMART_TYPE");
      expect(msg.selector).toBe("#target");
    });

    it("honors submit and clear flags on a selector target", () => {
      const msg = helpers.mapToolToMessage("type", {
        text: "hello",
        selector: "#i",
        clear: false,
        submit: true,
      });
      expect(msg.type).toBe("SMART_TYPE");
      expect(msg.clear).toBe(false);
      expect(msg.submit).toBe(true);
    });

    it("uses FORM_FILL for a ref target", () => {
      const msg = helpers.mapToolToMessage("type", { text: "hello", ref: "e1" });
      expect(msg.type).toBe("FORM_FILL");
      expect(msg.data).toEqual([{ ref: "e1", value: "hello" }]);
    });

    it("falls back to cursor typing with no target", () => {
      const msg = helpers.mapToolToMessage("type", { text: "hello" });
      expect(msg.type).toBe("EXECUTE_TYPE");
      expect(msg.text).toBe("hello");
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

  describe("zoom command", () => {
    it("maps zoom level to ZOOM_SET", () => {
      const msg = helpers.mapToolToMessage("zoom", { level: "1.5" }, 123);
      expect(msg).toMatchObject({ type: "ZOOM_SET", level: 1.5, tabId: 123 });
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

describe("formatToolError", () => {
  it("preserves structured codes and job ids", () => {
    const error = Object.assign(new Error("capacity reached"), {
      code: "capacity",
      jobId: "job-id",
    });

    expect(helpers.formatToolError(error)).toEqual({
      code: "capacity",
      jobId: "job-id",
      message: "capacity reached",
      content: [{ type: "text", text: "capacity reached" }],
    });
  });

  it("adds a copy-paste recovery command for stale session targets", () => {
    const error = Object.assign(new Error("tab is gone"), {
      code: "tab_gone",
      session: "research",
      lastUrl: "https://example.com/",
    });

    const formatted = helpers.formatToolError(error);
    expect(formatted.content[0].text).toContain("Recovery: surf session.reopen research");
    expect(formatted.details).toMatchObject({
      session: "research",
      lastUrl: "https://example.com/",
      recoveryCommand: "surf session.reopen research",
    });
  });
});

describe("formatToolContent", () => {
  it("preserves browser session results as reviewable JSON", () => {
    const result = helpers.formatToolContent({
      session: { name: "research", tabId: 10, queue: { active: false } },
      created: true,
    });
    expect(JSON.parse(result[0].text)).toMatchObject({
      session: { name: "research", tabId: 10 },
      created: true,
    });
  });

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
