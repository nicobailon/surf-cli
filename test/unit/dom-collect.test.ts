import { describe, expect, it } from "vitest";
// @ts-expect-error - CommonJS module without type definitions
import * as bounded from "../../native/bounded-regex.cjs";
// @ts-expect-error - CommonJS module without type definitions
import * as collect from "../../native/dom-collect.cjs";
import { PageWorker } from "../fixtures/page-worker";

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

/** Runs an extract.html spec as the tab does, through tabExtract; rejects with its error. */
async function runHtmlExtract(
  html: unknown,
  texts: string[],
  { clock = performance as { now: () => number }, worker = PageWorker as unknown } = {},
) {
  const run = new Function(
    "performance",
    "Worker",
    `${bounded.tabSource()}
const regexBudget = boundedRegex.createRegexBudget({ ms: 2000, scope: "extract" });
return (doc) => boundedRegex.tabExtract({
  budget: regexBudget,
  ...(${collect.htmlExtractFunction(html)})(doc),
  onValue: (records) => ({ records }),
  onError: (error) => { throw error; },
});`,
  )(clock, worker);
  return (await settle(await run(listDocument(texts)))).records;
}

/** A tab extract's result once the host has made the call that runs its patterns, if it has any. */
async function settle(result: { regexPending?: { key: string } }) {
  return result.regexPending
    ? new Function(`return ${bounded.stashCallScript(result.regexPending.key)}`)()
    : result;
}

/** A tab with `count` rows whose h2 reads `text(n)`, running collect's scripts with `worker`. */
function rowsTab(
  count: number,
  {
    clock = performance as { now: () => number },
    worker = PageWorker as unknown,
    text = (n: number) => `Item #${n}`,
  } = {},
) {
  const rows = Array.from({ length: count }, (_, n) => ({
    tagName: "ARTICLE",
    getAttribute: (name: string) => (name === "data-id" ? `row-${n}` : null),
    querySelector: (selector: string) => (selector === "h2" ? { innerText: text(n) } : null),
    querySelectorAll: () => [],
    scrollIntoView: () => undefined,
  }));
  const document = {
    visibilityState: "visible",
    querySelectorAll: (selector: string) => (selector === "article" ? rows : []),
  };
  return async (tool: string, args: Record<string, unknown>) => {
    if (tool !== "javascript_tool") {
      return { success: true };
    }
    const value = await new Function(
      "document",
      "window",
      "performance",
      "Worker",
      `return ${args.code}`,
    )(document, {}, clock, worker);
    return { output: JSON.stringify(value, null, 2) };
  };
}

const rowSpec = (match: string) => ({
  item: "article",
  key: ":scope@data-id",
  fields: { n: { selector: "h2", match } },
  idleRounds: 1,
});

describe("field match patterns in the tab", () => {
  const html = { item: "li", fields: { id: { selector: "h2", match: "#(\\d+)" } } };

  it("keep their capture group", async () => {
    expect(await runHtmlExtract(html, ["post #12", "post #7", "none"])).toEqual([
      { id: "12" },
      { id: "7" },
      {},
    ]);
  });

  it("test only the first 64 KB of an element's text", async () => {
    const tail = { item: "li", fields: { end: { selector: "h2", match: "x$" } } };
    expect(await runHtmlExtract(tail, [`${"a".repeat(70000)}x`, "ax"])).toEqual([{}, { end: "x" }]);
  });

  it("stop an extract once its regex runs have spent the 2 s budget", async () => {
    // Each run takes 60 ms on this clock: under the 100 ms limit, but 34 of them spend the budget.
    const texts = Array.from({ length: 50 }, (_, index) => `post #${index}`);
    const clock = () => steppingClock(60);
    expect(await runHtmlExtract(html, texts.slice(0, 30), { clock: clock() })).toHaveLength(30);
    await expect(runHtmlExtract(html, texts, { clock: clock() })).rejects.toThrow(
      "skipped: the extract's 2 s regex budget is spent",
    );
  });

  it("stop a run that never ends after 100 ms", async () => {
    // (a?){500}b on 4 a's outlived a 1 s kill on the page's own thread; the worker is terminated.
    const slow = { item: "li", fields: { id: { selector: "h2", match: "(a?){500}b" } } };
    const started = Date.now();
    await expect(runHtmlExtract(slow, ["aaaa"])).rejects.toThrow(
      "field id match pattern took too long (over 100 ms); simplify it",
    );
    expect(Date.now() - started).toBeLessThan(600);
  });

  it("fail a collect round with the pattern's error", async () => {
    const started = Date.now();
    await expect(
      collect.runCollect({
        executeTool: rowsTab(3, { text: () => "aaaa" }),
        sleep: async () => undefined,
        spec: rowSpec("(a?){500}b"),
      }),
    ).rejects.toThrow(
      "collect round failed: field n match pattern took too long (over 100 ms); simplify it",
    );
    expect(Date.now() - started).toBeLessThan(600);
    await expect(
      collect.runCollect({
        executeTool: rowsTab(50, { clock: steppingClock(60) }),
        sleep: async () => undefined,
        spec: rowSpec("#(\\d+)"),
      }),
    ).rejects.toThrow("collect round failed: skipped: the run's 2 s regex budget is spent");
  });

  it("share one 2 s budget across a collect's rounds", async () => {
    // 20 new rows a round, each run 60 ms on this clock: 1.2 s a round, so the second round spends it.
    const clock = steppingClock(60);
    let round = 0;
    const executeTool = async (tool: string, args: Record<string, unknown>) => {
      if (tool !== "javascript_tool") {
        return { success: true };
      }
      const code = String(args.code);
      const first = code.includes("tabExtract") ? 20 * round++ : 0;
      const rows = Array.from({ length: 20 }, (_, index) => ({
        tagName: "ARTICLE",
        getAttribute: (name: string) => (name === "data-id" ? `row-${first + index}` : null),
        querySelector: (selector: string) =>
          selector === "h2" ? { innerText: `Item #${first + index}` } : null,
        querySelectorAll: () => [],
        scrollIntoView: () => undefined,
      }));
      const document = {
        visibilityState: "visible",
        querySelectorAll: (selector: string) => (selector === "article" ? rows : []),
      };
      const value = await new Function(
        "document",
        "window",
        "performance",
        "Worker",
        `return ${code}`,
      )(document, {}, clock, PageWorker);
      return { output: JSON.stringify(value, null, 2) };
    };
    await expect(
      collect.runCollect({
        executeTool,
        sleep: async () => undefined,
        spec: { ...rowSpec("#(\\d+)"), maxItems: 60 },
      }),
    ).rejects.toThrow("collect round failed: skipped: the run's 2 s regex budget is spent");
    expect(round).toBe(2);
  });

  it("build records from what they read once, even when the page changes meanwhile", async () => {
    // Each read of a row's text gives the next number, as a live page might while the worker runs.
    let reads = 0;
    const text = () => `Item #${reads++}`;
    const twoFields = {
      item: "li",
      fields: { id: { selector: "h2", match: "#(\\d+)" }, raw: "h2" },
    };
    const changing = {
      querySelector: () => null,
      querySelectorAll: () => [
        {
          querySelector: (selector: string) =>
            selector === "h2"
              ? {
                  get textContent() {
                    return text();
                  },
                }
              : null,
          querySelectorAll: () => [],
        },
      ],
    };
    for (const worker of [PageWorker, null]) {
      reads = 0;
      const run = new Function(
        "performance",
        "Worker",
        `${bounded.tabSource()}
const regexBudget = boundedRegex.createRegexBudget({ ms: 2000, scope: "extract" });
return (doc) => boundedRegex.tabExtract({
  budget: regexBudget,
  ...(${collect.htmlExtractFunction(twoFields)})(doc),
  onValue: (records) => ({ records }),
  onError: (error) => ({ error: error.message }),
});`,
      )(performance, worker);
      const result = await settle(await run(changing));
      const finished = await bounded.finishTabExtract({
        result,
        budget: bounded.createRegexBudget({ ms: 1000, scope: "extract" }),
        runScript: async (code: string) => new Function(`return ${code}`)(),
      });
      expect(finished.records).toEqual([{ id: "0", raw: "Item #1" }]);
    }
    reads = 0;
    const records = await collect.runCollect({
      executeTool: rowsTab(1, { text }),
      sleep: async () => undefined,
      spec: rowSpec("#(\\d+)"),
    });
    expect(records).toEqual([{ n: "0" }]);
  });

  it("run on the host when the page blocks workers", async () => {
    const records = await collect.runCollect({
      executeTool: rowsTab(3, { worker: null }),
      sleep: async () => undefined,
      spec: rowSpec("#(\\d+)"),
    });
    expect(records).toEqual([{ n: "0" }, { n: "1" }, { n: "2" }]);
    const started = Date.now();
    await expect(
      collect.runCollect({
        executeTool: rowsTab(3, { worker: null, text: () => "aaaa" }),
        sleep: async () => undefined,
        spec: rowSpec("(a?){500}b"),
      }),
    ).rejects.toThrow("field n match pattern took too long (over 100 ms); simplify it");
    expect(Date.now() - started).toBeLessThan(600);
  });
});
