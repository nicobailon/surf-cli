import { describe, expect, it } from "vitest";

// @ts-expect-error - CommonJS module without type definitions
import * as collect from "../../native/dom-collect.cjs";

/** A fake tab with a virtualized list: rows 1..total, three rendered at a time from `top`. */
function virtualList(total: number, visibilityState = "visible") {
  let top = 0;
  const calls: string[] = [];
  const row = (n: number) => ({
    tagName: "ARTICLE",
    getAttribute: (name: string) => (name === "data-id" ? `row-${n}` : null),
    querySelector: (selector: string) => (selector === "h2" ? { innerText: ` Item ${n} ` } : null),
    querySelectorAll: () => [],
    scrollIntoView: () => {
      top = n - 1;
    },
  });
  const document = {
    visibilityState,
    querySelectorAll: (selector: string) =>
      selector === "article"
        ? Array.from({ length: Math.min(3, total - top) }, (_, index) => row(top + index + 1))
        : [],
  };
  const window = { innerHeight: 800, scrollBy: () => undefined };
  async function executeTool(tool: string, args: Record<string, unknown>) {
    calls.push(tool);
    if (tool === "wait.element" && document.querySelectorAll(String(args.selector)).length === 0) {
      throw new Error(`Timeout waiting for ${args.selector}`);
    }
    if (tool === "javascript_tool") {
      const value = await new Function("document", "window", `return ${args.code}`)(
        document,
        window,
      );
      return { output: JSON.stringify(value, null, 2) };
    }
    return { success: true };
  }
  return { calls, executeTool, sleep: async () => undefined };
}

const spec = {
  item: "article",
  key: ":scope@data-id",
  fields: { title: "h2", id: ":scope@data-id", "meta.id": ":scope@data-id", tags: "span[]" },
};

describe("dom collect", () => {
  it("merges scroll rounds by key in first-seen order and stops after idle rounds", async () => {
    const page = virtualList(7);
    const records = await collect.runCollect({ ...page, spec: { ...spec, idleRounds: 2 } });
    expect(records.map((record: { title: string }) => record.title)).toEqual([
      "Item 1",
      "Item 2",
      "Item 3",
      "Item 4",
      "Item 5",
      "Item 6",
      "Item 7",
    ]);
    // Dotted names nest; an `[]` spec with no matches is left out, like any missing field.
    expect(records[0]).toEqual({ title: "Item 1", id: "row-1", meta: { id: "row-1" } });
    // A visibility check, three rounds that find rows, then two rounds that find nothing new.
    expect(page.calls.filter((tool) => tool === "javascript_tool")).toHaveLength(6);
  });

  it("stops at maxItems", async () => {
    const page = virtualList(50);
    const records = await collect.runCollect({ ...page, spec: { ...spec, maxItems: 4 } });
    expect(records.map((record: { id: string }) => record.id)).toEqual([
      "row-1",
      "row-2",
      "row-3",
      "row-4",
    ]);
    expect(page.calls.filter((tool) => tool === "javascript_tool")).toHaveLength(3);
  });

  it("fails instead of returning partial records when the tab is hidden", async () => {
    // A hidden tab usually renders no list items at all.
    const page = virtualList(0, "hidden");
    await expect(collect.runCollect({ ...page, spec })).rejects.toThrow(
      /collect needs a visible tab.*--window --focused.*bring the tab to the front/,
    );
  });

  it("rejects unknown options and empty fields", () => {
    expect(() => collect.validateCollectSpec({ ...spec, limit: 3 })).toThrow(/unknown key "limit"/);
    expect(() => collect.validateCollectSpec({ ...spec, fields: {} })).toThrow(
      /at least one field/,
    );
  });

  it("refuses a field match over 500 characters or that is not a regex", () => {
    const withMatch = (match: string) => ({
      ...spec,
      fields: { title: { selector: "h2", match } },
    });
    expect(() => collect.validateCollectSpec(withMatch("a".repeat(501)))).toThrow(
      "collect field title.match is 501 characters; the limit is 500",
    );
    expect(() => collect.validateCollectSpec(withMatch("a".repeat(500)))).not.toThrow();
    expect(() => collect.validateCollectSpec(withMatch("("))).toThrow(
      /collect field title\.match is not a valid regex/,
    );
    expect(() =>
      collect.parseHtmlExtract({
        item: "li",
        fields: { x: { selector: "a", match: "b".repeat(501) } },
      }),
    ).toThrow("html field x.match is 501 characters; the limit is 500");
  });
});

/** A clock for the tab's performance.now() that moves `stepMs` on every read, so each regex run takes stepMs. */
function steppingClock(stepMs: number) {
  let now = 0;
  return { now: () => (now += stepMs) };
}

/** Items whose `h2` text is `texts[i]`, for an extract.html function. */
function listDocument(texts: string[]) {
  const items = texts.map((text) => ({
    querySelector: (selector: string) => (selector === "h2" ? { textContent: text } : null),
    querySelectorAll: () => [],
  }));
  return {
    querySelector: () => null,
    querySelectorAll: (selector: string) => (selector === "li" ? items : []),
  };
}

function runHtmlExtract(html: unknown, texts: string[], clock = steppingClock(0)) {
  const extract = new Function("performance", `return ${collect.htmlExtractFunction(html)}`)(clock);
  return extract(listDocument(texts));
}

describe("field match patterns in the tab", () => {
  const html = { item: "li", fields: { id: { selector: "h2", match: "#(\\d+)" } } };

  it("keep their capture group", () => {
    expect(runHtmlExtract(html, ["post #12", "post #7", "none"])).toEqual([
      { id: "12" },
      { id: "7" },
      {},
    ]);
  });

  it("test only the first 64 KB of an element's text", () => {
    const tail = { item: "li", fields: { end: { selector: "h2", match: "x$" } } };
    expect(runHtmlExtract(tail, [`${"a".repeat(70000)}x`, "ax"])).toEqual([{}, { end: "x" }]);
  });

  it("stop an extract once its regex runs have spent the 2 s budget", () => {
    // Each run takes 60 ms on this clock: under the 100 ms limit, but 34 of them spend the budget.
    const texts = Array.from({ length: 50 }, (_, index) => `post #${index}`);
    expect(runHtmlExtract(html, texts.slice(0, 30), steppingClock(60))).toHaveLength(30);
    expect(() => runHtmlExtract(html, texts, steppingClock(60))).toThrow(
      "skipped: the extract's 2 s regex budget is spent",
    );
  });

  it("stop an extract at the first run over 100 ms", () => {
    // A run in the tab can't be interrupted, so it is stopped once it returns.
    expect(() => runHtmlExtract(html, ["post #1", "post #2"], steppingClock(150))).toThrow(
      "field id match pattern took too long (over 100 ms); simplify it",
    );
  });

  it("fail a collect round with the pattern's error", async () => {
    const rows = Array.from({ length: 50 }, (_, n) => ({
      tagName: "ARTICLE",
      getAttribute: (name: string) => (name === "data-id" ? `row-${n}` : null),
      querySelector: (selector: string) => (selector === "h2" ? { innerText: `Item #${n}` } : null),
      querySelectorAll: () => [],
      scrollIntoView: () => undefined,
    }));
    const document = {
      visibilityState: "visible",
      querySelectorAll: (selector: string) => (selector === "article" ? rows : []),
    };
    const executeTool = async (tool: string, args: Record<string, unknown>) => {
      if (tool !== "javascript_tool") {
        return { success: true };
      }
      const value = await new Function("document", "window", "performance", `return ${args.code}`)(
        document,
        {},
        steppingClock(60),
      );
      return { output: JSON.stringify(value, null, 2) };
    };
    await expect(
      collect.runCollect({
        executeTool,
        sleep: async () => undefined,
        spec: {
          item: "article",
          key: ":scope@data-id",
          fields: { n: { selector: "h2", match: "#(\\d+)" } },
        },
      }),
    ).rejects.toThrow("collect round failed: skipped: the extract's 2 s regex budget is spent");
  });
});
