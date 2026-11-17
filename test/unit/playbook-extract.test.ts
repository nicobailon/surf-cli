import { afterEach, describe, expect, it, vi } from "vitest";
import { PageWorker } from "../fixtures/page-worker";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const playbooks = require("../../native/playbooks.cjs");
const runtime = require("../../native/playbook-runtime.cjs");
const records = require("../../native/records.cjs");
const extract = require("../../native/playbook-extract.cjs");
const clients = require("../../native/playbook-client.cjs");
const assertions = require("../../native/playbook-assertions.cjs");
const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function tempDir(prefix: string) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

type FakeNode = {
  text?: string;
  attrs?: Record<string, string>;
  children?: Record<string, FakeNode[]>;
};

/** A parsed document: elements answer the selectors listed in `children`, and `href` resolves against its <base>. */
function fakeDocument(root: FakeNode) {
  const doc: Record<string, any> = { baseURI: "https://tab.test/current" };
  const element = (node: FakeNode): Record<string, unknown> => {
    const attrs = { ...(node.attrs || {}) };
    const self: Record<string, unknown> = {
      textContent: node.text ?? "",
      getAttribute: (name: string) => attrs[name] ?? null,
      setAttribute: (name: string, value: string) => {
        attrs[name] = value;
      },
      querySelector: (selector: string) => select(node, selector)[0] ?? null,
      querySelectorAll: (selector: string) => select(node, selector),
    };
    if (attrs.href !== undefined) {
      Object.defineProperty(self, "href", { get: () => new URL(attrs.href, doc.baseURI).href });
    }
    if (attrs.value !== undefined) {
      self.value = attrs.value;
    }
    return self;
  };
  const select = (node: FakeNode, selector: string) => {
    if (selector.includes("!!")) {
      throw new SyntaxError(`'${selector}' is not a valid selector`);
    }
    return (node.children?.[selector] || []).map(element);
  };
  doc.querySelector = (selector: string) => select(root, selector)[0] ?? null;
  doc.querySelectorAll = (selector: string) => select(root, selector);
  doc.createElement = () => {
    const base: Record<string, unknown> = {};
    base.setAttribute = (_name: string, value: string) => {
      base.href = value;
    };
    return base;
  };
  doc.head = {
    prepend: (base: { href: string }) => {
      doc.baseURI = base.href;
    },
  };
  return doc;
}

const books: FakeNode = {
  children: {
    "article.product_pod": [
      {
        children: {
          "h3 a": [
            {
              text: "A Light in the ...",
              attrs: { title: "A Light in the Attic", href: "a-light_1000/index.html" },
            },
          ],
          ".price_color": [{ text: "\n    £51.77\n  " }],
        },
      },
      {
        children: {
          "h3 a": [
            {
              text: "Tipping",
              attrs: { title: "Tipping the Velvet", href: "tipping_999/index.html" },
            },
          ],
          ".price_color": [{ text: "£53.74" }],
        },
      },
    ],
    "input[name=RID]": [{ attrs: { value: "RID-123" } }],
  },
};

/** Runs the page script of a network strategy against a fake fetch and DOMParser. */
function fakeTab(html: string, doc: Record<string, unknown>) {
  const fetchImpl = vi.fn(async (url: string) => ({
    status: 200,
    ok: true,
    url,
    headers: new Headers({ "content-type": "text/html" }),
    text: async () => html,
  }));
  class DOMParser {
    parseFromString(text: string, type: string) {
      if (text !== html || type !== "text/html") {
        throw new Error(`parsed ${type}: ${text}`);
      }
      return doc;
    }
  }
  const executeTool = vi.fn(async (tool: string, args: { code: string }) => {
    if (tool !== "javascript_tool") {
      return { success: true };
    }
    const value = await new Function(
      "fetch",
      "DOMParser",
      "location",
      "document",
      `return ${args.code}`,
    )(fetchImpl, DOMParser, { href: "https://books.test/" }, doc);
    return { output: JSON.stringify(value) };
  });
  return { executeTool, fetchImpl };
}

const htmlExtract = {
  html: {
    item: "article.product_pod",
    fields: { title: "h3 a@title", price: ".price_color", url: "h3 a@href" },
  },
};

function op(run: unknown[], extra: Record<string, unknown> = {}) {
  return { id: "get_books", effect: "read", args: {}, run, ...extra };
}

describe("extracting records from JSON", () => {
  it("picks the records array, renames nested fields and keeps only matching records", () => {
    const body = {
      data: {
        items: [
          { __typename: "Product", name: "Lamp", price: { current: 10 }, id: { walmart: "w1" } },
          { __typename: "Ad", name: "Sponsored" },
          { __typename: "Product", name: "Desk", price: { current: 99 }, id: { walmart: "w2" } },
        ],
      },
    };
    expect(
      records.extractRecords(body, {
        records: "$.data.items",
        fields: { title: "name", price: "price.current", id: "id.walmart" },
        filter: { __typename: "Product" },
      }),
    ).toEqual([
      { title: "Lamp", price: 10, id: "w1" },
      { title: "Desk", price: 99, id: "w2" },
    ]);
  });

  it("renames fields of the whole body when no records path is given", () => {
    const body = { search: { hits: [{ name: "Carbone" }] }, meta: { total: 7 } };
    expect(
      records.extractRecords(body, { fields: { restaurants: "search.hits", total: "meta.total" } }),
    ).toEqual({ restaurants: [{ name: "Carbone" }], total: 7 });
    expect(
      records.extractRecords([{ id: 1, x: 2 }], { records: "$", fields: { key: "id" } }),
    ).toEqual([{ key: 1 }]);
  });

  it("fails clearly when the records path is missing or not an array", () => {
    expect(() => records.extractRecords({ data: {} }, { records: "$.data.items" })).toThrow(
      /extract records \$\.data\.items is not an array \(found undefined\)/,
    );
    expect(() =>
      records.extractRecords({ data: { items: 3 } }, { records: "$.data.items" }),
    ).toThrow(/not an array \(found number\)/);
  });

  it("applies the extract in a network strategy run", async () => {
    const result = await runtime.runPlaybookOp({
      playbook: { id: "fixture", provenance: { scope: "test" } },
      op: op([
        {
          using: "network",
          request: { method: "GET", url: "/api" },
          extract: { records: "$.hits", fields: { name: "venue.name" } },
        },
      ]),
      executeTool: async () => ({
        output: JSON.stringify({
          ok: true,
          status: 200,
          bodyJson: { hits: [{ venue: { name: "A" } }, { venue: { name: "B" } }] },
        }),
      }),
    });
    expect(result.value).toEqual([{ name: "A" }, { name: "B" }]);
  });
});

/**
 * A tab whose network strategy answers `body`, with the service worker's output handling: the
 * script's value pretty-printed and cut at 50,000 characters, or { error } when it throws.
 */
type TabOptions = {
  clock?: { now: () => number };
  worker?: unknown;
  // What the tab's output goes through on its way out, as a page's own JSON.stringify could.
  serialize?: (value: Record<string, unknown>) => Record<string, unknown>;
  // The page's JSON, which the tab's scripts use.
  json?: Pick<typeof JSON, "parse" | "stringify">;
};

function jsonTab(
  body: string,
  contentType = "application/json",
  {
    clock = performance,
    worker = PageWorker,
    serialize = (value) => value,
    json = JSON,
  }: TabOptions = {},
) {
  const outputs: Record<string, unknown>[] = [];
  const executeTool = async (_tool: string, args: { code: string }) => {
    const fetchImpl = async (url: string) => ({
      status: 200,
      ok: true,
      url,
      headers: new Headers({ "content-type": contentType }),
      text: async () => body,
    });
    let value: Record<string, unknown>;
    try {
      value = await new Function(
        "fetch",
        "location",
        "performance",
        "Worker",
        "JSON",
        `return ${args.code}`,
      )(fetchImpl, { href: "https://api.test/" }, clock, worker, json);
    } catch (error) {
      return { error: (error as Error).message };
    }
    outputs.push(value);
    return { output: JSON.stringify(serialize(value), null, 2).substring(0, 50000) };
  };
  return { executeTool, outputs };
}

const hits = Array.from({ length: 400 }, (_, index) => ({
  name: `n${index}`,
  description: "x".repeat(200),
}));
const largeBody = JSON.stringify({ hits, meta: { total: 400 } });

function runJson(
  body: string,
  spec: Record<string, unknown>,
  contentType?: string,
  tabOptions?: TabOptions,
) {
  const tab = jsonTab(body, contentType, tabOptions);
  const run = runtime.runPlaybookOp({
    playbook: { id: "fixture", provenance: { scope: "test" } },
    op: op([
      {
        using: "network",
        request: { method: "GET", url: "https://api.test/search" },
        extract: spec,
      },
    ]),
    executeTool: tab.executeTool,
  });
  return { run, outputs: tab.outputs };
}

describe("a JSON extract runs in the tab", () => {
  it("returns a small result from a response over 60,000 characters", async () => {
    expect(largeBody.length).toBeGreaterThan(60000);
    const { run, outputs } = runJson(largeBody, { records: "$.hits", fields: { title: "name" } });
    const result = await run;
    expect(result.value).toHaveLength(400);
    expect(result.value[399]).toEqual({ title: "n399" });
    expect(outputs[0]).not.toHaveProperty("body");
    expect(outputs[0]).not.toHaveProperty("bodyJson");
  });

  it("reads a jsonPath in the tab too", async () => {
    const { run } = runJson(largeBody, { jsonPath: "$.meta.total" });
    expect((await run).value).toBe(400);
  });

  it("fails clearly when the extracted result is over the tab's output limit", async () => {
    const { run } = runJson(largeBody, { records: "$.hits", fields: { text: "description" } });
    await expect(run).rejects.toThrow(
      /extracted result is \d+ characters; narrow --records\/--field/,
    );
  });

  it("bounds field match patterns in the tab: 64 KB of text, a 2 s budget, 100 ms a run", async () => {
    const items = Array.from({ length: 50 }, (_, index) => ({
      id: `id-${index}`,
      t: `${"a".repeat(70000)}x`,
    }));
    const body = JSON.stringify(items);
    const id = { path: "id", match: "id-(\\d+)" };
    const end = { path: "t", match: "x$" };
    const small = await runJson(JSON.stringify(items.slice(0, 2)), {
      records: "$",
      fields: { id, end },
    }).run;
    expect(small.value).toEqual([{ id: "0" }, { id: "1" }]);
    // On a clock where each run takes 60 ms, the 34th run spends the budget.
    const step = (ms: number) => {
      let now = 0;
      return { now: () => (now += ms) };
    };
    await expect(
      runJson(body, { records: "$", fields: { id } }, undefined, { clock: step(60) }).run,
    ).rejects.toThrow("skipped: the run's 2 s regex budget is spent");
    // A run that never ends is stopped after 100 ms, in the tab's worker or, when the page blocks
    // workers, on the host.
    const never = { fields: { t: { path: "t", match: "(a?){500}b" } } };
    for (const tabWorker of [PageWorker, null]) {
      const started = Date.now();
      await expect(
        runJson('{"t":"aaaa"}', never, undefined, { worker: tabWorker }).run,
      ).rejects.toThrow("fields.t.match pattern took too long (over 100 ms); simplify it");
      expect(Date.now() - started).toBeLessThan(600);
    }
    const handed = await runJson(
      JSON.stringify(items.slice(0, 2).map((item) => ({ id: item.id }))),
      { records: "$", fields: { id } },
      undefined,
      { worker: null },
    ).run;
    expect(handed.value).toEqual([{ id: "0" }, { id: "1" }]);
  });

  it("shares one 2 s field-regex budget across an op run's strategies", async () => {
    // 20 records whose match takes 60 ms each on this clock: 1.2 s a strategy. The first fails its
    // status check, so the second runs on what is left and spends it.
    const body = JSON.stringify(Array.from({ length: 20 }, (_, index) => ({ id: `id-${index}` })));
    const ids = { records: "$", fields: { id: { path: "id", match: "id-(\\d+)" } } };
    let now = 0;
    const tab = jsonTab(body, undefined, { clock: { now: () => (now += 60) } });
    const strategy = {
      using: "network",
      request: { method: "GET", url: "https://api.test/search" },
      extract: ids,
    };
    const run = runtime.runPlaybookOp({
      playbook: { id: "fixture", provenance: { scope: "test" } },
      op: op([{ ...strategy, verify: { status: 201 } }, strategy]),
      executeTool: tab.executeTool,
    });
    await expect(run).rejects.toThrow(
      "All strategies failed (network: expected status 201; network: skipped: the run's 2 s regex budget is spent)",
    );
  });

  it("gives the same records with or without the tab's worker when a group doesn't match", async () => {
    const optional = {
      fields: { optional: { path: "t", match: "(x)?a" }, whole: { path: "t", match: "a" } },
    };
    for (const worker of [PageWorker, null]) {
      const result = await runJson('{"t":"a"}', optional, undefined, { worker }).run;
      expect(result.value).toStrictEqual({ whole: "a" });
    }
  });

  it("charges a near-limit tab result's regex time to the run", async () => {
    // 30 records whose match takes 60 ms each on this clock: 1.8 s a strategy, with a result just
    // under the tab's 50,000 characters until regexSpentMs is added.
    const head = {
      status: 200,
      ok: true,
      url: "https://api.test/search",
      headers: { "content-type": "application/json" },
    };
    const rows = (length: number) =>
      Array.from({ length: 30 }, (_, index) => ({
        id: `id-${index}`,
        pad: index ? "" : "p".repeat(length),
      }));
    const size = (length: number) =>
      JSON.stringify(
        {
          ...head,
          extracted: rows(length).map(({ id, pad: text }) => ({ id: id.slice(3), pad: text })),
        },
        null,
        2,
      ).length;
    const padding = 49_990 - size(0);
    expect(size(padding)).toBe(49_990);
    const near = { records: "$", fields: { id: { path: "id", match: "id-(\\d+)" }, pad: "pad" } };
    let now = 0;
    const tab = jsonTab(JSON.stringify(rows(padding)), undefined, {
      clock: { now: () => (now += 60) },
    });
    const strategy = {
      using: "network",
      request: { method: "GET", url: "https://api.test/search" },
      extract: near,
    };
    const run = runtime.runPlaybookOp({
      playbook: { id: "fixture", provenance: { scope: "test" } },
      op: op([strategy, strategy]),
      executeTool: tab.executeTool,
    });
    await expect(run).rejects.toThrow(
      /^All strategies failed \(network: extracted result is \d+ characters; narrow --records\/--field; network: skipped: the run's 2 s regex budget is spent\)$/,
    );
  });

  it("charges what the host saw when a page rewrites regexSpentMs to 0", async () => {
    // Each strategy's 30 matches take 60 ms on the page's clock (two reads, 30 ms a read), 1.8 s;
    // the page reports 0. The host reads the same clock without moving it, so it sees the time the
    // regex call took and stops the run at 2 s.
    const body = JSON.stringify(Array.from({ length: 30 }, (_, index) => ({ id: `id-${index}` })));
    const ids = { records: "$", fields: { id: { path: "id", match: "id-(\\d+)" } } };
    let now = 0;
    const clock = { now: () => (now += 30) };
    const tab = jsonTab(body, undefined, {
      clock,
      serialize: (value) => ("regexSpentMs" in value ? { ...value, regexSpentMs: 0 } : value),
    });
    const strategy = {
      using: "network",
      request: { method: "GET", url: "https://api.test/search" },
      extract: ids,
    };
    const run = runtime.runPlaybookOp({
      playbook: { id: "fixture", provenance: { scope: "test" } },
      op: op([{ ...strategy, verify: { status: 201 } }, strategy]),
      executeTool: tab.executeTool,
      now: () => now,
    });
    await expect(run).rejects.toThrow(
      "All strategies failed (network: expected status 201; network: skipped: the run's 2 s regex budget is spent)",
    );
  });

  it("charges a pattern call that fails after its patterns ran", async () => {
    // The page's JSON.stringify throws on the tab's output, so the pattern call rejects after each
    // strategy's 30 matches have taken 1.8 s. The first is charged its whole 2 s allowance, and the
    // second runs no pattern.
    const body = JSON.stringify(Array.from({ length: 30 }, (_, index) => ({ id: `id-${index}` })));
    const ids = { records: "$", fields: { id: { path: "id", match: "id-(\\d+)" } } };
    let now = 0;
    const clock = { now: () => (now += 60) };
    let matches = 0;
    class CountingWorker extends PageWorker {
      postMessage(data: unknown) {
        if (data !== "ping") {
          matches++;
        }
        super.postMessage(data);
      }
    }
    const json = {
      parse: JSON.parse,
      stringify: (value: unknown, ...rest: [never, number]) => {
        if (value && typeof value === "object" && "regexSpentMs" in value) {
          throw new Error("page says no");
        }
        return JSON.stringify(value, ...rest);
      },
    };
    const tab = jsonTab(body, undefined, { clock, worker: CountingWorker, json });
    const strategy = {
      using: "network",
      request: { method: "GET", url: "https://api.test/search" },
      extract: ids,
    };
    const run = runtime.runPlaybookOp({
      playbook: { id: "fixture", provenance: { scope: "test" } },
      op: op([strategy, strategy]),
      executeTool: tab.executeTool,
      now: () => clock.now(),
    });
    await expect(run).rejects.toThrow(
      "All strategies failed (network: page says no; network: skipped: the run's 2 s regex budget is spent)",
    );
    expect(matches).toBe(30);
  });

  it("refuses a pattern call that took longer than its allowance, when the page's clock stands still", async () => {
    // The page's clock never moves, so its worker runs every match; each takes 60 ms on the host's
    // clock. The first strategy spends 1.8 s and fails its status check; the second, with 200 ms
    // left, also takes 1.8 s, and its result is refused.
    const body = JSON.stringify(Array.from({ length: 30 }, (_, index) => ({ id: `id-${index}` })));
    const ids = { records: "$", fields: { id: { path: "id", match: "id-(\\d+)" } } };
    let hostNow = 0;
    class SlowWorker extends PageWorker {
      postMessage(data: unknown) {
        if (data !== "ping") {
          hostNow += 60;
        }
        super.postMessage(data);
      }
    }
    const tab = jsonTab(body, undefined, { clock: { now: () => 0 }, worker: SlowWorker });
    const strategy = {
      using: "network",
      request: { method: "GET", url: "https://api.test/search" },
      extract: ids,
    };
    const run = runtime.runPlaybookOp({
      playbook: { id: "fixture", provenance: { scope: "test" } },
      op: op([{ ...strategy, verify: { status: 201 } }, strategy]),
      executeTool: tab.executeTool,
      now: () => hostNow,
    });
    await expect(run).rejects.toThrow(
      "All strategies failed (network: expected status 201; network: skipped: the run's 2 s regex budget is spent)",
    );
  });

  it("says when the response is not JSON", async () => {
    const { run } = runJson("<html></html>", { records: "$.hits" }, "text/html");
    await expect(run).rejects.toThrow(/the response is not JSON \(text\/html\)/);
  });

  it("reports a path error from the tab without a stack trace", async () => {
    const { run } = runJson(JSON.stringify({ hits: 3 }), { records: "$.hits" });
    await expect(run).rejects.toThrow(
      /^All strategies failed \(network: extract records \$\.hits is not an array \(found number\)\)$/,
    );
  });
});

describe("extracting records from HTML", () => {
  it("parses a network strategy's HTML body in the tab and returns records, not the body", async () => {
    const html = "<html><body>books</body></html>";
    const tab = fakeTab(html, fakeDocument(books));
    const result = await runtime.runPlaybookOp({
      playbook: { id: "books", provenance: { scope: "test" } },
      op: op([
        {
          using: "network",
          request: { method: "GET", url: "https://books.test/catalogue/page-1.html" },
          extract: htmlExtract,
        },
      ]),
      executeTool: tab.executeTool,
    });
    expect(result.strategy).toBe("network");
    expect(result.value).toEqual([
      {
        title: "A Light in the Attic",
        price: "£51.77",
        url: "https://books.test/catalogue/a-light_1000/index.html",
      },
      {
        title: "Tipping the Velvet",
        price: "£53.74",
        url: "https://books.test/catalogue/tipping_999/index.html",
      },
    ]);
    const output = await tab.executeTool.mock.results[0].value;
    expect(JSON.parse(output.output)).not.toHaveProperty("body");
  });

  it("pulls a single value out of HTML", async () => {
    const tab = fakeTab("<form></form>", fakeDocument(books));
    const result = await runtime.runPlaybookOp({
      playbook: { id: "blast", provenance: { scope: "test" } },
      op: op([
        {
          using: "network",
          request: { method: "GET", url: "https://blast.test/Blast.cgi" },
          extract: { html: { value: "input[name=RID]@value" } },
        },
      ]),
      executeTool: tab.executeTool,
    });
    expect(result.value).toBe("RID-123");
  });

  it("fails clearly when the extracted HTML records are over the tab's output limit", async () => {
    const many: FakeNode = {
      children: {
        article: Array.from({ length: 600 }, (_, index) => ({
          children: { h3: [{ text: `${index} ${"y".repeat(100)}` }] },
        })),
      },
    };
    const doc = fakeDocument(many);
    const tab = fakeTab("<p></p>", doc);
    const truncating = async (tool: string, args: { code: string }) => {
      const result = await tab.executeTool(tool, args);
      return {
        output: JSON.stringify(JSON.parse(result.output ?? "null"), null, 2).substring(0, 50000),
      };
    };
    await expect(
      runtime.runPlaybookOp({
        playbook: { id: "books", provenance: { scope: "test" } },
        op: op([
          {
            using: "network",
            request: { method: "GET", url: "https://books.test/" },
            extract: { html: { item: "article", fields: { title: "h3" } } },
          },
        ]),
        executeTool: truncating,
      }),
    ).rejects.toThrow(/extracted result is \d+ characters; narrow --item\/--field/);
  });

  it("names the field whose selector the page rejects", async () => {
    const tab = fakeTab("<p></p>", fakeDocument(books));
    await expect(
      runtime.runPlaybookOp({
        playbook: { id: "books", provenance: { scope: "test" } },
        op: op([
          {
            using: "network",
            request: { method: "GET", url: "https://books.test/" },
            extract: { html: { item: "article", fields: { title: "h3 !! a" } } },
          },
        ]),
        executeTool: tab.executeTool,
      }),
    ).rejects.toThrow(/extract field title has an invalid selector: h3 !! a/);
  });

  it("runs the same extraction on the page a workflow strategy ends on", async () => {
    const doc = fakeDocument(books);
    doc.baseURI = "https://books.test/catalogue/page-1.html";
    const tab = fakeTab("", doc);
    const result = await runtime.runPlaybookOp({
      playbook: { id: "books", provenance: { scope: "test" } },
      op: op([
        {
          using: "workflow",
          steps: [{ cmd: "navigate", args: { url: "https://books.test/catalogue/page-1.html" } }],
          stepDelay: 0,
          autoWait: false,
          extract: htmlExtract,
        },
      ]),
      executeTool: tab.executeTool,
      sleep: vi.fn(),
    });
    expect(result.strategy).toBe("workflow");
    expect(result.value).toHaveLength(2);
    expect(result.value[0]).toEqual({
      title: "A Light in the Attic",
      price: "£51.77",
      url: "https://books.test/catalogue/a-light_1000/index.html",
    });
    expect(tab.fetchImpl).not.toHaveBeenCalled();
  });
});

describe("validating an op's extract", () => {
  const validate = (strategy: Record<string, unknown>) =>
    playbooks.validateOp(
      op([{ using: "network", request: { url: "https://x.test/" }, ...strategy }]),
      {
        origins: [],
      },
    );

  it("accepts HTML records, a single HTML value and JSON records", () => {
    expect(() => validate({ extract: htmlExtract })).not.toThrow();
    expect(() => validate({ extract: { html: { value: "input[name=RID]@value" } } })).not.toThrow();
    expect(() =>
      validate({
        extract: {
          records: "$.data.items",
          fields: { id: "id.walmart" },
          filter: { __typename: "Product" },
        },
      }),
    ).not.toThrow();
  });

  it("refuses a field match over 500 characters on every kind of op extract", () => {
    const long = "a".repeat(501);
    expect(() => validate({ extract: { fields: { id: { path: "id", match: long } } } })).toThrow(
      "op get_books extract: fields.id.match is 501 characters; the limit is 500",
    );
    expect(() =>
      validate({
        extract: { html: { item: "li", fields: { id: { selector: "a", match: long } } } },
      }),
    ).toThrow("op get_books extract: html field id.match is 501 characters; the limit is 500");
    expect(() => validate({ extract: { fields: { id: { path: "id", match: "(" } } } })).toThrow(
      /fields\.id\.match is not a valid regex/,
    );
    const strategy = (using: string, fields: Record<string, unknown>) =>
      playbooks.validateOp(
        op([
          using === "api"
            ? { using, match: "/api/*", records: { find: { exists: ["id"] }, key: "id", fields } }
            : { using, item: "li", key: ":scope@data-id", fields },
        ]),
        { origins: [] },
      );
    expect(() => strategy("api", { id: { path: "id", match: long } })).toThrow(
      "op get_books api strategy: records.fields.id.match is 501 characters; the limit is 500",
    );
    expect(() => strategy("collect", { id: { selector: "a", match: long } })).toThrow(
      "op get_books collect strategy: collect field id.match is 501 characters; the limit is 500",
    );
  });

  it("rejects malformed selectors, paths and mixes", () => {
    expect(() =>
      validate({ extract: { html: { item: "article[", fields: { t: "h3" } } } }),
    ).toThrow(/op get_books extract: html item has an unbalanced selector: article\[/);
    expect(() =>
      validate({ extract: { html: { item: "article", fields: { t: "h3 a@" } } } }),
    ).toThrow(/extract: html field t/);
    expect(() => validate({ extract: { html: { item: "article" } } })).toThrow(
      /html fields must map at least one field/,
    );
    expect(() =>
      validate({ extract: { html: { item: "article", value: "h1", fields: { t: "h1" } } } }),
    ).toThrow(/html takes item and fields, or value/);
    expect(() => validate({ extract: { records: "data.items" } })).toThrow(
      /records must be \$, \$\.path or \$\[n\]/,
    );
    expect(() => validate({ extract: { records: "$.data..items" } })).toThrow(
      /records must be \$, \$\.path/,
    );
    expect(() => validate({ extract: { fields: { id: "a..b" } } })).toThrow(/bad segment/);
    expect(() => validate({ extract: { html: htmlExtract.html, records: "$" } })).toThrow(
      /extract cannot combine html with records, fields or filter/,
    );
    expect(() => validate({ extract: { rename: {} } })).toThrow(/unknown key "rename"/);
    expect(() =>
      playbooks.validateOp(
        op([
          {
            using: "api",
            match: "/api/*",
            records: { find: { exists: ["id"] }, key: "id", fields: { id: "id" } },
            extract: htmlExtract,
          },
        ]),
        { origins: [] },
      ),
    ).toThrow(/extract.html works only on network and workflow strategies/);
  });
});

function writeOp(base: string, run: unknown[]) {
  const directory = path.join(base, ".surf", "playbooks", "books");
  fs.mkdirSync(path.join(directory, "ops"), { recursive: true });
  fs.writeFileSync(
    path.join(directory, "playbook.json"),
    JSON.stringify({ id: "books", version: "1.0.0", origins: ["https://books.test"] }),
  );
  const file = path.join(directory, "ops", "get_books.json");
  fs.writeFileSync(file, `${JSON.stringify({ id: "get_books", effect: "read", run }, null, 2)}\n`);
  return file;
}

describe("JSON path syntax", () => {
  const validate = (spec: Record<string, unknown>) =>
    playbooks.validateOp(
      op([{ using: "network", request: { url: "https://x.test/" }, extract: spec }]),
      {
        origins: [],
      },
    );

  it("is checked before an op is saved", () => {
    for (const bad of ["$foo", "$.", "$..a", "$.a."]) {
      expect(() => validate({ records: bad }), bad).toThrow(
        /records must be \$, \$\.path or \$\[n\]/,
      );
      expect(() => validate({ jsonPath: bad }), bad).toThrow(/jsonPath must be \$ or \$\.key\.key/);
    }
    for (const good of ["$", "$.data.items", "$[0].hits", "$.a[2]"]) {
      expect(() => validate({ records: good }), good).not.toThrow();
    }
    expect(() => validate({ jsonPath: "$.meta.total" })).not.toThrow();
  });

  it("is checked in assertions", () => {
    expect(() => assertions.validateAssertions([{ path: "$foo", op: "not_null" }])).toThrow(
      /assertion 1: path must be \$, \$\.path or \$\[n\]/,
    );
  });
});

describe("surf pb extract", () => {
  const network = {
    using: "network",
    request: { method: "GET", url: "https://books.test/catalogue/page-1.html" },
  };
  const workflow = {
    using: "workflow",
    steps: [{ tool: "navigate", args: { url: "https://books.test/" } }],
  };

  it("parses HTML, single-value and JSON flags", () => {
    expect(
      extract.parseExtractArgs([
        "books",
        "get_books",
        "--item",
        "article.product_pod",
        "--field",
        "title=h3 a@title",
        "--field",
        "price=.price_color",
      ]),
    ).toEqual({
      playbook: "books",
      op: "get_books",
      extract: {
        html: {
          item: "article.product_pod",
          fields: { title: "h3 a@title", price: ".price_color" },
        },
      },
      options: {},
    });
    expect(
      extract.parseExtractArgs(["blast", "submit", "--value", "input[name=RID]@value"]).extract,
    ).toEqual({
      html: { value: "input[name=RID]@value" },
    });
    expect(
      extract.parseExtractArgs([
        "walmart",
        "search",
        "--records",
        "$.data.items",
        "--field",
        "id=id.walmart",
        "--filter",
        "__typename=Product",
        "--strategy",
        "network",
        "--json",
      ]),
    ).toEqual({
      playbook: "walmart",
      op: "search",
      extract: {
        records: "$.data.items",
        fields: { id: "id.walmart" },
        filter: { __typename: "Product" },
      },
      options: { strategy: "network", json: true },
    });
    expect(() => extract.parseExtractArgs(["books", "get_books", "--field", "title"])).toThrow(
      /--field needs name=source/,
    );
    expect(() => extract.parseExtractArgs(["books", "get_books"])).toThrow(
      /Usage: surf pb extract/,
    );
    expect(() =>
      extract.parseExtractArgs([
        "books",
        "get_books",
        "--item",
        "a",
        "--field",
        "t=h3",
        "--filter",
        "x=y",
      ]),
    ).toThrow(/--filter works on JSON records only/);
  });

  it("sets the extract on the network and workflow strategies, saves it and prints a diff", () => {
    const cwd = tempDir("surf-extract-cwd-");
    const home = tempDir("surf-extract-home-");
    const file = writeOp(cwd, [network, workflow]);
    const result = extract.saveExtract({
      playbook: "books",
      op: "get_books",
      extract: htmlExtract,
      cwd,
      home,
    });
    expect(result.strategies).toEqual(["network", "workflow"]);
    expect(result.path).toBe(file);
    expect(result.diff).toContain('+      "extract": {');
    expect(result.diff).toContain('+            "title": "h3 a@title",');
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(saved.run.map((strategy: { extract?: unknown }) => strategy.extract)).toEqual([
      htmlExtract,
      htmlExtract,
    ]);
    expect(playbooks.resolveOp("books", "get_books", { cwd, home }).op.run[0].extract).toEqual(
      htmlExtract,
    );
  });

  it("puts JSON extracts on network strategies only, or the one --strategy names", () => {
    const cwd = tempDir("surf-extract-cwd-");
    const home = tempDir("surf-extract-home-");
    const file = writeOp(cwd, [network, workflow]);
    const json = { records: "$.items", fields: { id: "id" } };
    expect(
      extract.saveExtract({ playbook: "books", op: "get_books", extract: json, cwd, home })
        .strategies,
    ).toEqual(["network"]);
    expect(() =>
      extract.saveExtract({
        playbook: "books",
        op: "get_books",
        extract: json,
        strategy: "api",
        cwd,
        home,
      }),
    ).toThrow(/op get_books has no api strategy \(it has network, workflow\)/);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).run[1].extract).toBeUndefined();
  });

  it("leaves the op untouched when the extract is malformed or the playbook is built in", () => {
    const cwd = tempDir("surf-extract-cwd-");
    const home = tempDir("surf-extract-home-");
    const file = writeOp(cwd, [network]);
    const before = fs.readFileSync(file, "utf8");
    expect(() =>
      extract.saveExtract({
        playbook: "books",
        op: "get_books",
        extract: { html: { item: "article(", fields: { t: "h3" } } },
        cwd,
        home,
      }),
    ).toThrow(/unbalanced selector/);
    expect(() =>
      extract.saveExtract({
        playbook: "books",
        op: "get_books",
        extract: { records: "$.items", fields: { id: { path: "id", match: "a".repeat(501) } } },
        cwd,
        home,
      }),
    ).toThrow(/fields\.id\.match is 501 characters; the limit is 500/);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(() =>
      extract.saveExtract({ playbook: "x", op: "thread", extract: htmlExtract, cwd, home }),
    ).toThrow(/built-in playbook x can't be edited/);
  });
});

describe("generated clients and extract", () => {
  it("applies JSON records and renames without the browser", async () => {
    const parent = tempDir("surf-client-");
    const out = path.join(parent, "client");
    const result = clients.generateClient({
      playbookId: "lever",
      op: { id: "postings", effect: "read" },
      strategy: {
        using: "network",
        request: { method: "GET", url: "https://api.lever.test/v0/postings/acme" },
        extract: {
          records: "$",
          fields: {
            title: "text",
            team: "categories.team",
            code: { path: "id", match: "^lv-(\\d+)$" },
          },
          filter: { workplaceType: "remote" },
        },
      },
      provenance: { type: "playbook", id: "lever" },
      out,
    });
    expect(result.warnings).toEqual([]);
    expect(fs.existsSync(path.join(out, "records.cjs"))).toBe(true);
    const http = require("node:http");
    const server = http.createServer((_request: unknown, response: any) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify([
          { text: "Engineer", categories: { team: "Dev" }, workplaceType: "remote", id: "lv-7" },
          { text: "Designer", categories: { team: "Design" }, workplaceType: "onsite" },
        ]),
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { execFile } = require("node:child_process");
      const stdout = await new Promise<string>((resolve, reject) =>
        execFile(
          process.execPath,
          [path.join(out, "client.mjs")],
          {
            env: {
              ...process.env,
              SURF_CLIENT_ENDPOINT_URL: `http://127.0.0.1:${server.address().port}/`,
            },
          },
          (error: Error | null, output: string) => (error ? reject(error) : resolve(output)),
        ),
      );
      // The match runs through bounded-regex.cjs, copied next to records.cjs.
      expect(JSON.parse(stdout)).toEqual([{ title: "Engineer", team: "Dev", code: "7" }]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    await expect(clients.verifyClient(out, { live: false })).resolves.toMatchObject({
      valid: true,
    });
  });

  it("derives a client that keeps the saved op's JSON extract", () => {
    const parent = tempDir("surf-client-");
    const playbookRecords = require("../../native/playbook-records.cjs");
    const root = path.join(parent, "state");
    const record = playbookRecords.startRecord({ site: "books", op: "get_books", tabId: 1, root });
    playbookRecords.attachNetworkTrace(
      record.id,
      [
        {
          id: "r-1",
          method: "GET",
          status: 200,
          type: "XHR",
          url: "https://books.test/api/items?page=1",
        },
      ],
      root,
    );
    writeOp(parent, [
      {
        using: "network",
        request: { method: "GET", url: "https://books.test/api/items" },
        extract: { records: "$.items", fields: { id: "sku" } },
      },
    ]);
    const result = clients.deriveClient("books", "get_books", path.join(parent, "client"), {
      root,
      recordId: record.id,
      cwd: parent,
      home: parent,
    });
    expect(result.manifest.extract).toEqual({ records: "$.items", fields: { id: "sku" } });
  });

  it("warns that HTML extraction runs only through surf use and prints the raw body", () => {
    const parent = tempDir("surf-client-");
    const result = clients.generateClient({
      playbookId: "books",
      op: { id: "get_books", effect: "read" },
      strategy: {
        using: "network",
        request: { method: "GET", url: "https://books.test/" },
        extract: htmlExtract,
      },
      provenance: { type: "playbook", id: "books" },
      out: path.join(parent, "client"),
    });
    expect(result.manifest.extract).toBeNull();
    expect(result.warnings).toEqual([
      "extract.html runs only through surf use (Node has no DOM); this client prints the raw HTML body",
    ]);
  });

  it("verifies that an HTML client prints the raw body", async () => {
    const parent = tempDir("surf-client-");
    const out = path.join(parent, "client");
    clients.generateClient({
      playbookId: "books",
      op: { id: "get_books", effect: "read" },
      strategy: {
        using: "network",
        request: { method: "GET", url: "https://books.test/" },
        extract: htmlExtract,
      },
      provenance: { type: "playbook", id: "books" },
      out,
    });
    const verified = await clients.verifyClient(out, { live: false });
    expect(verified.execution.stdout).toBe("<html><body><p>verified</p></body></html>");
    fs.writeFileSync(
      path.join(out, "client.mjs"),
      'await fetch(process.env.SURF_CLIENT_ENDPOINT_URL);\nconsole.log("[]");\n',
    );
    await expect(clients.verifyClient(out, { live: false })).rejects.toThrow(
      /generated client did not print the raw HTML body/,
    );
  });
});

describe("reserved field names", () => {
  afterEach(() => {
    Reflect.deleteProperty(Object.prototype, "polluted");
  });

  it("are refused when an op is saved, for HTML, JSON and collect fields", () => {
    const validate = (strategy: Record<string, unknown>) =>
      playbooks.validateOp(op([strategy]), { origins: [] });
    const network = { using: "network", request: { url: "https://x.test/" } };
    expect(() =>
      validate({
        ...network,
        extract: { html: { item: "article", fields: { "__proto__.polluted": "h3" } } },
      }),
    ).toThrow(
      /html field name "__proto__.polluted" uses a reserved segment \(__proto__, constructor, prototype\)/,
    );
    expect(() =>
      validate({ ...network, extract: { records: "$", fields: { constructor: "name" } } }),
    ).toThrow(/field name "constructor" uses a reserved segment/);
    expect(() =>
      validate({
        using: "collect",
        item: "li",
        key: ":scope",
        fields: { "a.prototype.b": "span" },
      }),
    ).toThrow(/collect field name "a.prototype.b" uses a reserved segment/);
  });

  it("are refused when a run builds its extract, and Object.prototype stays unchanged", async () => {
    const tab = fakeTab("<p></p>", fakeDocument(books));
    await expect(
      runtime.runPlaybookOp({
        playbook: { id: "books", provenance: { scope: "test" } },
        op: op([
          {
            using: "network",
            request: { method: "GET", url: "https://books.test/" },
            extract: {
              html: { item: "article.product_pod", fields: { "__proto__.polluted": "h3 a@title" } },
            },
          },
        ]),
        executeTool: tab.executeTool,
      }),
    ).rejects.toThrow(/reserved segment/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(() =>
      records.extractRecords([{ a: 1 }], {
        records: "$",
        fields: JSON.parse('{"__proto__": "a"}'),
      }),
    ).toThrow(/field name "__proto__" uses a reserved segment/);
    expect(Object.getOwnPropertyNames(Object.prototype)).not.toContain("polluted");
  });
});
