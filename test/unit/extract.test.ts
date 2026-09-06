import { describe, expect, it, vi } from "vitest";

// @ts-expect-error - CommonJS module without type definitions
import * as extract from "../../native/extract.cjs";

type Call = { tool: string; args: Record<string, unknown>; tabId?: number };

function ok(payload: unknown) {
  return {
    result: {
      content: [
        { type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload) },
      ],
    },
  };
}

function toolError(text: string, code?: string) {
  return { error: { content: [{ type: "text", text }], ...(code ? { code } : {}) } };
}

/**
 * Scripted fake host: each entry answers the next call to `tool`. The
 * recorded call list doubles as the protocol assertion, the same way the
 * Go fork's socket-level retry test worked.
 */
function scriptedHost(script: Array<{ tool: string; reply: unknown | (() => unknown) }>) {
  const calls: Call[] = [];
  let index = 0;
  const executeTool = vi.fn(async (tool: string, args: Record<string, unknown>, tabId?: number) => {
    calls.push({ tool, args, tabId });
    const entry = script[index++];
    if (!entry) {
      throw new Error(`unexpected call ${tool} (#${calls.length})`);
    }
    if (entry.tool !== tool) {
      throw new Error(`expected ${entry.tool} but got ${tool} at call #${calls.length}`);
    }
    return typeof entry.reply === "function" ? (entry.reply as () => unknown)() : entry.reply;
  });
  return { calls, executeTool, remaining: () => script.length - index };
}

const ready = ok({
  state: "ready",
  evidence: ["document.readyState is complete"],
  polls: 1,
  waited: 12,
});
const rowsResult = ok({
  rows: [
    { title: "A", href: "/a" },
    { title: "B", href: "/b" },
  ],
  total: 2,
});

describe("runExtraction (owned tab)", () => {
  it("opens, waits, extracts and closes a fresh tab", async () => {
    const host = scriptedHost([
      { tool: "tab.new", reply: ok({ success: true, tabId: 41, url: "https://x/" }) },
      { tool: "wait.ready", reply: ready },
      { tool: "js", reply: rowsResult },
      { tool: "tab.close", reply: ok({ success: true }) },
    ]);

    const result = await extract.runExtraction({
      executeTool: host.executeTool,
      url: "https://x/",
      code: "return SURF_OPTIONS.limit;",
      options: { limit: 5 },
      ready: { selector: ".row", timeout: 3000 },
    });

    expect(result).toMatchObject({
      rowCount: 2,
      attempts: 1,
      mode: "owned-tab",
      tabId: null,
      url: "https://x/",
    });
    expect(result.rows).toHaveLength(2);
    expect(result.readiness.state).toBe("ready");
    expect(host.calls.map((call) => [call.tool, call.tabId])).toEqual([
      ["tab.new", undefined],
      ["wait.ready", 41],
      ["js", 41],
      ["tab.close", 41],
    ]);
    expect(host.calls[0].args).toEqual({ url: "https://x/" });
    expect(host.calls[1].args).toEqual({ selector: ".row", timeout: 3000 });
    expect(host.calls[2].args.code).toBe(
      'const SURF_OPTIONS = Object.freeze({"limit":5});\nreturn SURF_OPTIONS.limit;',
    );
    expect(host.calls[3].args).toEqual({ id: 41 });
    expect(host.remaining()).toBe(0);
  });

  it("retries with a fresh tab after a transient execution-context failure", async () => {
    const host = scriptedHost([
      { tool: "tab.new", reply: ok({ tabId: 1 }) },
      { tool: "wait.ready", reply: ready },
      { tool: "js", reply: toolError("Inspected target navigated or closed") },
      { tool: "tab.close", reply: ok({ success: true }) },
      { tool: "tab.new", reply: ok({ tabId: 2 }) },
      { tool: "wait.ready", reply: ready },
      { tool: "js", reply: rowsResult },
      { tool: "tab.close", reply: ok({ success: true }) },
    ]);
    const sleep = vi.fn(async () => undefined);
    const events: Array<Record<string, unknown>> = [];

    const result = await extract.runExtraction({
      executeTool: host.executeTool,
      url: "https://x/",
      code: "return 1",
      retry: { count: 1, delayMs: 250 },
      sleep,
      onEvent: (event: Record<string, unknown>) => events.push(event),
    });

    expect(result.attempts).toBe(2);
    expect(result.rowCount).toBe(2);
    expect(sleep).toHaveBeenCalledWith(250);
    expect(host.calls.map((call) => call.tool)).toEqual([
      "tab.new",
      "wait.ready",
      "js",
      "tab.close",
      "tab.new",
      "wait.ready",
      "js",
      "tab.close",
    ]);
    expect(host.calls[3].args).toEqual({ id: 1 });
    expect(events.find((event) => event.type === "attempt-failed")).toMatchObject({
      attempt: 1,
      retryable: true,
    });
  });

  it("treats zero rows as a failure, retries once, then reports empty_result", async () => {
    const empty = ok({ rows: [] });
    const host = scriptedHost([
      { tool: "tab.new", reply: ok({ tabId: 1 }) },
      { tool: "wait.ready", reply: ready },
      { tool: "js", reply: empty },
      { tool: "tab.close", reply: ok({}) },
      { tool: "tab.new", reply: ok({ tabId: 2 }) },
      { tool: "wait.ready", reply: ready },
      { tool: "js", reply: empty },
      { tool: "tab.close", reply: ok({}) },
    ]);

    await expect(
      extract.runExtraction({
        executeTool: host.executeTool,
        url: "https://x/",
        code: "return []",
        sleep: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: "empty_result", details: { attempts: 2 } });
    expect(host.remaining()).toBe(0);
  });

  it("accepts zero rows with allowEmpty and when the page reports its own empty state", async () => {
    const allow = scriptedHost([
      { tool: "tab.new", reply: ok({ tabId: 1 }) },
      { tool: "wait.ready", reply: ready },
      { tool: "js", reply: ok([]) },
      { tool: "tab.close", reply: ok({}) },
    ]);
    const allowed = await extract.runExtraction({
      executeTool: allow.executeTool,
      url: "https://x/",
      code: "return []",
      allowEmpty: true,
    });
    expect(allowed.rowCount).toBe(0);

    const emptyState = scriptedHost([
      { tool: "tab.new", reply: ok({ tabId: 1 }) },
      {
        tool: "wait.ready",
        reply: ok({ state: "empty", evidence: ['empty-state text "No results" found'] }),
      },
      { tool: "js", reply: ok({ rows: [] }) },
      { tool: "tab.close", reply: ok({}) },
    ]);
    const explicit = await extract.runExtraction({
      executeTool: emptyState.executeTool,
      url: "https://x/",
      code: "return {rows: []}",
      ready: { emptyText: "No results" },
    });
    expect(explicit.rowCount).toBe(0);
    expect(explicit.readiness.state).toBe("empty");
  });

  it("does not retry a login bounce and still closes the tab", async () => {
    const host = scriptedHost([
      { tool: "tab.new", reply: ok({ tabId: 1 }) },
      {
        tool: "wait.ready",
        reply: toolError("Page is not ready: login at https://x/login", "page_login"),
      },
      { tool: "tab.close", reply: ok({}) },
    ]);

    await expect(
      extract.runExtraction({
        executeTool: host.executeTool,
        url: "https://x/",
        code: "return 1",
        retry: { count: 3 },
      }),
    ).rejects.toMatchObject({
      code: "page_login",
      message: expect.stringContaining("login at https://x/login"),
    });
    expect(host.calls.map((call) => call.tool)).toEqual(["tab.new", "wait.ready", "tab.close"]);
  });

  it("does not retry a script error and reports a single attempt", async () => {
    const host = scriptedHost([
      { tool: "tab.new", reply: ok({ tabId: 1 }) },
      { tool: "wait.ready", reply: ready },
      { tool: "js", reply: toolError("SyntaxError: Unexpected token ')'") },
      { tool: "tab.close", reply: ok({}) },
    ]);
    await expect(
      extract.runExtraction({
        executeTool: host.executeTool,
        url: "https://x/",
        code: "return )",
        retry: { count: 2 },
      }),
    ).rejects.toMatchObject({ code: "tool_error", details: { stage: "js", attempts: 1 } });
    expect(host.remaining()).toBe(0);
  });

  it("retries a readiness timeout but gives up after the retry budget", async () => {
    const host = scriptedHost([
      { tool: "tab.new", reply: ok({ tabId: 1 }) },
      {
        tool: "wait.ready",
        reply: toolError("Page did not become ready within 20000ms", "page_timeout"),
      },
      { tool: "tab.close", reply: ok({}) },
      { tool: "tab.new", reply: ok({ tabId: 2 }) },
      {
        tool: "wait.ready",
        reply: toolError("Page did not become ready within 20000ms", "page_timeout"),
      },
      { tool: "tab.close", reply: ok({}) },
    ]);
    await expect(
      extract.runExtraction({
        executeTool: host.executeTool,
        url: "https://x/",
        code: "return 1",
        sleep: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: "page_timeout" });
    expect(host.remaining()).toBe(0);
  });

  it("keeps the tab open on success when asked and reports its id", async () => {
    const host = scriptedHost([
      { tool: "tab.new", reply: ok({ tabId: 9 }) },
      { tool: "wait.ready", reply: ready },
      { tool: "js", reply: rowsResult },
    ]);
    const result = await extract.runExtraction({
      executeTool: host.executeTool,
      url: "https://x/",
      code: "return 1",
      keepTab: true,
    });
    expect(result.tabId).toBe(9);
    expect(host.calls.map((call) => call.tool)).toEqual(["tab.new", "wait.ready", "js"]);
  });

  it("surfaces a script that returns nothing or non-JSON", async () => {
    const host = scriptedHost([
      { tool: "tab.new", reply: ok({ tabId: 1 }) },
      { tool: "wait.ready", reply: ready },
      { tool: "js", reply: ok("undefined") },
      { tool: "tab.close", reply: ok({}) },
    ]);
    await expect(
      extract.runExtraction({
        executeTool: host.executeTool,
        url: "https://x/",
        code: "document.title",
      }),
    ).rejects.toMatchObject({ code: "no_output" });
    expect(host.remaining()).toBe(0);
  });

  it("rejects missing script or URL before touching the browser", async () => {
    const executeTool = vi.fn();
    await expect(
      extract.runExtraction({ executeTool, url: "https://x/", code: "" }),
    ).rejects.toMatchObject({ code: "no_script" });
    await expect(extract.runExtraction({ executeTool, code: "return 1" })).rejects.toMatchObject({
      code: "no_url",
    });
    expect(executeTool).not.toHaveBeenCalled();
  });
});

describe("runExtraction (caller-supplied target)", () => {
  it("navigates once, never opens or closes tabs, never retries", async () => {
    const host = scriptedHost([
      { tool: "navigate", reply: ok({ success: true }) },
      { tool: "wait.ready", reply: ready },
      { tool: "js", reply: toolError("Inspected target navigated or closed") },
    ]);
    await expect(
      extract.runExtraction({
        executeTool: host.executeTool,
        target: true,
        url: "https://x/",
        code: "return 1",
        retry: { count: 3 },
      }),
    ).rejects.toMatchObject({ code: "tool_error" });
    expect(host.calls.map((call) => [call.tool, call.tabId])).toEqual([
      ["navigate", undefined],
      ["wait.ready", undefined],
      ["js", undefined],
    ]);
  });

  it("reads the current page in place when no URL is given", async () => {
    const host = scriptedHost([
      { tool: "wait.ready", reply: ready },
      { tool: "js", reply: ok([{ a: 1 }]) },
    ]);
    const result = await extract.runExtraction({
      executeTool: host.executeTool,
      target: true,
      code: "return [{a: 1}]",
    });
    expect(result).toMatchObject({ mode: "target", attempts: 1, rowCount: 1, url: null });
  });
});

describe("tabIdFromResponse", () => {
  it("reads JSON and the host's text form", () => {
    expect(extract.tabIdFromResponse(ok({ success: true, tabId: 12 }))).toBe(12);
    expect(extract.tabIdFromResponse(ok({ id: 13 }))).toBe(13);
    expect(extract.tabIdFromResponse(ok("Created tab 1076931763: http://127.0.0.1/list"))).toBe(
      1076931763,
    );
    expect(() => extract.tabIdFromResponse(ok("OK"))).toThrow(/did not return a tab id/);
    expect(() => extract.tabIdFromResponse(toolError("tab_busy", "tab_busy"))).toThrow(/tab_busy/);
  });
});

describe("helpers", () => {
  it("classifies transient tab errors and retryable codes", () => {
    expect(extract.isTransientTabError(new Error("Inspected target navigated or closed"))).toBe(
      true,
    );
    expect(extract.isTransientTabError("Cannot find default execution context")).toBe(true);
    expect(
      extract.isTransientTabError({ content: [{ text: "Receiving end does not exist" }] }),
    ).toBe(true);
    expect(extract.isTransientTabError(new Error("selector not found"))).toBe(false);

    expect(extract.isRetryableExtractionError(new extract.ExtractError("empty_result", "x"))).toBe(
      true,
    );
    expect(extract.isRetryableExtractionError({ code: "page_timeout", message: "slow" })).toBe(
      true,
    );
    expect(
      extract.isRetryableExtractionError({
        code: "page_login",
        message: "Detached while handling command",
      }),
    ).toBe(false);
    expect(extract.isRetryableExtractionError(new Error("syntax error"))).toBe(false);
  });

  it("selects rows from arrays, conventional keys or an explicit key", () => {
    expect(extract.selectRows([1, 2])).toEqual([1, 2]);
    expect(extract.selectRows({ total: 2, items: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(extract.selectRows({ jobs: [{ a: 1 }] }, "jobs")).toEqual([{ a: 1 }]);
    expect(extract.selectRows({ title: "x" })).toBeNull();
    expect(() => extract.selectRows({ title: "x" }, "jobs")).toThrow(/no array at "jobs"/);
  });

  it("enforces the zero-rows invariant only for row arrays", () => {
    expect(() => extract.enforceRowsInvariant([])).toThrow(/zero rows/);
    expect(() => extract.enforceRowsInvariant([], { allowEmpty: true })).not.toThrow();
    expect(() => extract.enforceRowsInvariant([], { readiness: { state: "empty" } })).not.toThrow();
    expect(() => extract.enforceRowsInvariant(null)).not.toThrow();
    expect(() => extract.enforceRowsInvariant([{ a: 1 }])).not.toThrow();
  });

  it("parses script output and rejects undefined or non-JSON", () => {
    expect(extract.parseExtractionOutput('{"a":1}')).toEqual({ a: 1 });
    expect(() => extract.parseExtractionOutput("undefined")).toThrow(/returned nothing/);
    expect(() => extract.parseExtractionOutput("hello")).toThrow(/did not return JSON/);
  });

  it("renders metadata bullets and a table with escaped cells", () => {
    const markdown = extract.renderExtractionMarkdown(
      {
        query: "a|b",
        total: 2,
        rows: [
          { title: "First", href: "/1" },
          { title: "Second\nline", extra: true },
        ],
      },
      [
        { title: "First", href: "/1" },
        { title: "Second\nline", extra: true },
      ],
      { title: "Search" },
    );
    expect(markdown).toBe(
      [
        "# Search",
        "",
        "- query: a\\|b",
        "- total: 2",
        "",
        "2 rows",
        "",
        "| title | href | extra |",
        "| --- | --- | --- |",
        "| First | /1 |  |",
        "| Second line |  | true |",
      ].join("\n"),
    );
  });

  it("renders scalar rows as bullets and row-less results as JSON", () => {
    expect(extract.renderExtractionMarkdown(["x", "y"], ["x", "y"])).toContain("- x\n- y");
    expect(extract.renderExtractionMarkdown({ title: "T" }, null)).toContain('"title": "T"');
    expect(extract.renderExtractionMarkdown([], [])).toBe("# Extraction\n\n0 rows");
  });
});
