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
});
