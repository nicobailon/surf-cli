import { afterEach, describe, expect, it, vi } from "vitest";
import { captureTab } from "../fixtures/capture-tab";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const playbooks = require("../../native/playbooks.cjs");
const chain = require("../../native/chain-runtime.cjs");

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

type Op = Record<string, unknown> & { id: string };

// A feed read a page at a time: by page number, or after a cursor.
const byPage: Op = {
  id: "list_page",
  args: { page: { type: "number", default: 1 } },
  run: [
    {
      using: "network",
      request: { url: "https://feed.test/api/feed", query: { page: "{{page}}" } },
      extract: { jsonPath: "$.items" },
    },
  ],
};

const byCursor: Op = {
  id: "list_after",
  args: { cursor: { type: "string", default: "" } },
  run: [
    {
      using: "network",
      request: { url: "https://feed.test/api/feed", query: { cursor: "{{cursor}}" } },
      extract: { jsonPath: "$.items" },
    },
  ],
};

function load(ops: Op[]) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "surf-chain-page-"));
  tempDirs.push(cwd);
  const directory = path.join(cwd, ".surf", "playbooks", "feed");
  fs.mkdirSync(path.join(directory, "ops"), { recursive: true });
  fs.writeFileSync(
    path.join(directory, "playbook.json"),
    JSON.stringify({ id: "feed", version: "1.0.0", origins: ["https://feed.test"] }),
  );
  for (const op of ops) {
    fs.writeFileSync(path.join(directory, "ops", `${op.id}.json`), JSON.stringify(op));
  }
  return playbooks.resolvePlaybook("feed", { cwd, home: os.tmpdir() });
}

function paged(id: string, step: Record<string, unknown>, args: Record<string, unknown> = {}): Op {
  return { id, args, chain: [{ id: "feed", ...step }], output: "feed" };
}

const items = (name: string) => [{ id: `${name}a` }, { id: `${name}b` }];

// `pages` numbered pages by ?page=N (an empty list past the last); by ?cursor=, `cursors` maps a
// cursor ("" for the first page) to the next one, or to null on the last page.
function feedTab({
  pages = 5,
  cursors = {},
}: {
  pages?: number;
  cursors?: Record<string, string | null>;
} = {}) {
  return captureTab({
    href: "https://feed.test/",
    reply: (url) => {
      const query = new URL(url).searchParams;
      if (query.has("page")) {
        const page = Number(query.get("page"));
        return { body: JSON.stringify({ items: page <= pages ? items(`p${page}`) : [] }) };
      }
      const cursor = query.get("cursor") ?? "";
      const next = cursors[cursor];
      return {
        body: JSON.stringify({
          items: items(cursor || "first"),
          ...(next === null || next === undefined ? {} : { next }),
        }),
      };
    },
  });
}

function sentQueries(fetchImpl: { mock: { calls: unknown[][] } }) {
  return fetchImpl.mock.calls.map(([url]) => new URL(String(url)).search);
}

async function run(
  playbook: any,
  id: string,
  tab: { executeTool: unknown },
  sleep = vi.fn(async () => undefined),
  args = {},
) {
  return chain.runChainOp({
    playbook,
    op: playbook.ops.get(id),
    args,
    executeTool: tab.executeTool,
    sleep,
  });
}

describe("chain step paging", () => {
  it("increments a page input, concatenating each page's records, and stops at max", async () => {
    const op = paged(
      "feed_pages",
      {
        op: "list_page",
        with: { page: "{{start}}" },
        page: { into: "page", next: "increment", max: 3, delayMs: 0 },
      },
      { start: { type: "number", default: 2 } },
    );
    const playbook = load([byPage, op]);
    const tab = feedTab({ pages: 9 });
    const result = await run(playbook, "feed_pages", tab);
    expect(sentQueries(tab.fetchImpl)).toEqual(["?page=2", "?page=3", "?page=4"]);
    expect(result.value).toEqual([...items("p2"), ...items("p3"), ...items("p4")]);
    expect(result.steps).toEqual([{ id: "feed", op: "list_page", runs: 3 }]);
  });

  it("starts an increment at the op's default and reads 3 pages when max is unset", async () => {
    const op = paged("feed_default", {
      op: "list_page",
      page: { into: "page", next: "increment" },
    });
    const playbook = load([byPage, op]);
    const tab = feedTab({ pages: 9 });
    const result = await run(playbook, "feed_default", tab);
    expect(sentQueries(tab.fetchImpl)).toEqual(["?page=1", "?page=2", "?page=3"]);
    expect(result.value).toHaveLength(6);
  });

  it("follows a cursor from each page's response until the response has none", async () => {
    const op = paged("feed_cursor", {
      op: "list_after",
      page: { into: "cursor", next: { path: "$.next" }, max: 10, delayMs: 0 },
    });
    const playbook = load([byCursor, op]);
    const tab = feedTab({ cursors: { "": "c2", c2: "c3", c3: null } });
    const result = await run(playbook, "feed_cursor", tab);
    expect(sentQueries(tab.fetchImpl)).toEqual(["?cursor=", "?cursor=c2", "?cursor=c3"]);
    expect(result.value).toEqual([...items("first"), ...items("c2"), ...items("c3")]);
    expect(result.steps).toEqual([{ id: "feed", op: "list_after", runs: 3 }]);
  });

  it("stops when a cursor repeats", async () => {
    const op = paged("feed_loop", {
      op: "list_after",
      page: { into: "cursor", next: { path: "$.next" }, max: 10, delayMs: 0 },
    });
    const playbook = load([byCursor, op]);
    const tab = feedTab({ cursors: { "": "c2", c2: "c3", c3: "c2" } });
    const result = await run(playbook, "feed_loop", tab);
    expect(sentQueries(tab.fetchImpl)).toEqual(["?cursor=", "?cursor=c2", "?cursor=c3"]);
    expect(result.value).toHaveLength(6);
  });

  it("stops when a next value points back at the first page, the op's default", async () => {
    const op = paged("feed_back", {
      op: "list_page",
      page: { into: "page", next: { path: "$.next" }, max: 10, delayMs: 0 },
    });
    const playbook = load([byPage, op]);
    const tab = captureTab({
      href: "https://feed.test/",
      reply: (url) => {
        const page = Number(new URL(url).searchParams.get("page"));
        return {
          body: JSON.stringify({ items: items(`p${page}`), next: page === 2 ? "1" : page + 1 }),
        };
      },
    });
    const result = await run(playbook, "feed_back", tab);
    expect(sentQueries(tab.fetchImpl)).toEqual(["?page=1", "?page=2"]);
    expect(result.value).toHaveLength(4);
  });

  it("stops at a page with no records", async () => {
    const op = paged("feed_short", {
      op: "list_page",
      page: { into: "page", next: "increment", max: 10, delayMs: 0 },
    });
    const playbook = load([byPage, op]);
    const tab = feedTab({ pages: 2 });
    const result = await run(playbook, "feed_short", tab);
    expect(sentQueries(tab.fetchImpl)).toEqual(["?page=1", "?page=2", "?page=3"]);
    expect(result.value).toEqual([...items("p1"), ...items("p2")]);
  });

  it("waits delayMs between pages, 2 s when unset, and not before the first", async () => {
    const playbook = load([
      byPage,
      paged("feed_slow", {
        op: "list_page",
        page: { into: "page", next: "increment", delayMs: 1500 },
      }),
      paged("feed_polite", { op: "list_page", page: { into: "page", next: "increment", max: 2 } }),
    ]);
    const sleep = vi.fn(async () => undefined);
    await run(playbook, "feed_slow", feedTab(), sleep);
    expect(sleep.mock.calls).toEqual([[1500], [1500]]);
    const unset = vi.fn(async () => undefined);
    await run(playbook, "feed_polite", feedTab(), unset);
    expect(unset.mock.calls).toEqual([[2000]]);
  });

  it("takes max and delayMs from the chain's inputs", async () => {
    const op = paged(
      "feed_inputs",
      {
        op: "list_page",
        page: { into: "page", next: "increment", max: "{{pages}}", delayMs: "{{wait}}" },
      },
      { pages: { type: "number", default: 2 }, wait: { type: "number" } },
    );
    const playbook = load([byPage, op]);
    const tab = feedTab();
    const sleep = vi.fn(async () => undefined);
    await run(playbook, "feed_inputs", tab, sleep, { pages: 4, wait: 3000 });
    expect(sentQueries(tab.fetchImpl)).toHaveLength(4);
    expect(sleep.mock.calls).toEqual(Array(3).fill([3000]));
  });

  it("takes one URL path segment of the next value", async () => {
    const op = paged("feed_segment", {
      op: "list_page",
      page: { into: "page", next: { path: "$.next", segment: 2 }, delayMs: 0 },
    });
    const playbook = load([byPage, op]);
    const tab = captureTab({
      href: "https://feed.test/",
      reply: (url) => {
        const page = Number(new URL(url).searchParams.get("page"));
        return { body: JSON.stringify({ items: items(`p${page}`), next: `/page/${page + 1}/` }) };
      },
    });
    const result = await run(playbook, "feed_segment", tab);
    expect(sentQueries(tab.fetchImpl)).toEqual(["?page=1", "?page=2", "?page=3"]);
    expect(result.value).toHaveLength(6);
  });

  it("stops the chain when a page's result is not a list, naming the step and page", async () => {
    const whole = {
      ...byPage,
      id: "list_whole",
      run: [{ ...(byPage.run as any[])[0], extract: { jsonPath: "$" } }],
    };
    const op = paged("feed_whole", {
      op: "list_whole",
      page: { into: "page", next: "increment", delayMs: 0 },
    });
    const playbook = load([whole, op]);
    await expect(run(playbook, "feed_whole", feedTab())).rejects.toThrow(
      /chain feed_whole step feed \(list_whole, page 1\) failed: page needs list_whole to return a list of records; it returned an object/,
    );
  });

  it("lists a step's page bounds in a dry run", () => {
    const op = paged("feed_preview", {
      op: "list_page",
      page: { into: "page", next: "increment", max: 4 },
    });
    const playbook = load([byPage, op]);
    expect(chain.previewChainOp({ playbook, op: playbook.ops.get("feed_preview") }).steps).toEqual([
      {
        id: "feed",
        op: "list_page",
        page: { into: "page", next: "increment", max: 4, delayMs: 2000 },
      },
    ]);
  });
});

type FakeNode = {
  text?: string;
  attrs?: Record<string, string>;
  children?: Record<string, FakeNode[]>;
};

/** A parsed page: elements answer the selectors listed in `children`. */
function fakeDocument(root: FakeNode) {
  const element = (node: FakeNode): Record<string, unknown> => ({
    textContent: node.text ?? "",
    getAttribute: (name: string) => node.attrs?.[name] ?? null,
    querySelector: (selector: string) => select(node, selector)[0] ?? null,
    querySelectorAll: (selector: string) => select(node, selector),
  });
  const select = (node: FakeNode, selector: string) =>
    (node.children?.[selector] || []).map(element);
  return {
    querySelector: (selector: string) => select(root, selector)[0] ?? null,
    querySelectorAll: (selector: string) => select(root, selector),
    createElement: () => ({ setAttribute: () => undefined }),
    head: { prepend: () => undefined },
  };
}

// quotes pages at /page/N/: two quotes each and, before the last page, a "Next" link. The tab
// fetches them (network) or navigates to them (workflow), and reads the page it fetched or is on.
function quotesTab(last: number) {
  const pageOf = (url: string) => Number(new URL(url).pathname.split("/")[2]);
  const pageDocument = (url: string) => {
    const page = pageOf(url);
    const quote = (text: string) => ({ children: { "span.text": [{ text }] } });
    return fakeDocument({
      children: {
        "div.quote": [quote(`q${page}a`), quote(`q${page}b`)],
        ...(page < last ? { "li.next a": [{ attrs: { href: `/page/${page + 1}/` } }] } : {}),
      },
    });
  };
  const fetchImpl = vi.fn(async (url: string) => ({
    status: 200,
    ok: true,
    url,
    headers: new Headers({ "content-type": "text/html" }),
    text: async () => url,
  }));
  class DOMParser {
    parseFromString(text: string) {
      return pageDocument(text);
    }
  }
  const visited: string[] = [];
  const executeTool = vi.fn(async (tool: string, args: { code?: string; url?: string }) => {
    if (tool === "navigate") {
      visited.push(new URL(String(args.url)).pathname);
      return { success: true };
    }
    if (tool !== "javascript_tool") {
      throw new Error(`unexpected tool ${tool}`);
    }
    const current = visited.length
      ? pageDocument(`https://quotes.test${visited[visited.length - 1]}`)
      : undefined;
    const value = await new Function(
      "fetch",
      "DOMParser",
      "location",
      "document",
      `return ${args.code}`,
    )(fetchImpl, DOMParser, { href: "https://quotes.test/" }, current);
    return { output: JSON.stringify(value) };
  });
  return { executeTool, fetchImpl, visited };
}

describe("chain step paging over HTML", () => {
  const quotes: Op = {
    id: "list_quotes",
    origins: ["https://quotes.test"],
    args: { page: { type: "string", default: "1" } },
    run: [
      {
        using: "network",
        request: { url: "https://quotes.test/page/{{page}}/" },
        extract: { html: { item: "div.quote", fields: { text: "span.text" } } },
      },
    ],
  };

  it("follows the page's Next link until a page has none", async () => {
    const op = paged("all_quotes", {
      op: "list_quotes",
      page: { into: "page", next: { html: "li.next a@href", segment: 2 }, max: 5, delayMs: 0 },
    });
    const playbook = load([quotes, op]);
    const tab = quotesTab(3);
    const result = await run(playbook, "all_quotes", tab);
    expect(tab.fetchImpl.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      "/page/1/",
      "/page/2/",
      "/page/3/",
    ]);
    expect(result.value.map((quote: { text: string }) => quote.text)).toEqual([
      "q1a",
      "q1b",
      "q2a",
      "q2b",
      "q3a",
      "q3b",
    ]);
  });

  it("follows the Next link of the page a workflow strategy ends on", async () => {
    const browsed = {
      ...quotes,
      id: "browse_quotes",
      run: [
        {
          using: "workflow",
          steps: [{ cmd: "navigate", args: { url: "https://quotes.test/page/{{page}}/" } }],
          stepDelay: 0,
          autoWait: false,
          extract: (quotes.run as any[])[0].extract,
        },
      ],
    };
    const op = paged("browse_all", {
      op: "browse_quotes",
      page: { into: "page", next: { html: "li.next a@href", segment: 2 }, max: 5, delayMs: 0 },
    });
    const playbook = load([browsed, op]);
    const tab = quotesTab(2);
    const result = await run(playbook, "browse_all", tab);
    expect(tab.visited).toEqual(["/page/1/", "/page/2/"]);
    expect(result.value).toHaveLength(4);
  });

  it("refuses an html next on an op that doesn't extract HTML in the tab", async () => {
    const op = paged("json_html", {
      op: "list_page",
      page: { into: "page", next: { html: "li.next a@href" }, delayMs: 0 },
    });
    const playbook = load([byPage, op]);
    const tab = feedTab();
    await expect(run(playbook, "json_html", tab)).rejects.toThrow(
      /page\.next html needs an op that extracts HTML \(extract\.html\)/,
    );
    expect(tab.fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a path next on an op that extracts HTML", async () => {
    const op = paged("html_path", {
      op: "list_quotes",
      page: { into: "page", next: { path: "$.next" }, delayMs: 0 },
    });
    const playbook = load([quotes, op]);
    await expect(run(playbook, "html_path", quotesTab(3))).rejects.toThrow(
      /page\.next path needs an op whose network strategy extracts JSON/,
    );
  });
});

describe("chain step paging validation", () => {
  const step = (page: unknown, extra: Record<string, unknown> = {}) => ({
    op: "list_page",
    page,
    ...extra,
  });
  it.each([
    ["a page that is no object", step("increment"), /step feed page must be an object/],
    [
      "an unknown page key",
      step({ into: "page", next: "increment", every: 2 }),
      /step feed page has unknown key every/,
    ],
    [
      "a page without into",
      step({ next: "increment" }),
      /step feed page.into must be an input name/,
    ],
    [
      "a page without next",
      step({ into: "page" }),
      /step feed page.next must be "increment", \{ path \} or \{ html \}/,
    ],
    [
      "a next that is other text",
      step({ into: "page", next: "$.next" }),
      /step feed page.next must be "increment", \{ path \} or \{ html \}/,
    ],
    [
      "a next with both path and html",
      step({ into: "page", next: { path: "$.next", html: "a@href" } }),
      /step feed page.next takes path or html, not both/,
    ],
    [
      "a next with an unknown key",
      step({ into: "page", next: { path: "$.next", from: "feed" } }),
      /step feed page.next has unknown key from/,
    ],
    [
      "a next path that won't compile",
      step({ into: "page", next: { path: "$..x" } }),
      /step feed page.next: /,
    ],
    [
      "a next html list",
      step({ into: "page", next: { html: "li.next a@href[]" } }),
      /step feed page.next html must be one selector\[@attribute\]/,
    ],
    [
      "a next segment of 0",
      step({ into: "page", next: { path: "$.next", segment: 0 } }),
      /step feed page.next segment must be a URL path segment number from 1/,
    ],
    [
      "a max over 20",
      step({ into: "page", next: "increment", max: 21 }),
      /page.max must be an integer from 1 to 20/,
    ],
    [
      "a max of 0",
      step({ into: "page", next: "increment", max: 0 }),
      /page.max must be an integer from 1 to 20/,
    ],
    [
      "a delayMs over a minute",
      step({ into: "page", next: "increment", delayMs: 60001 }),
      /page.delayMs must be an integer from 0 to 60000/,
    ],
    [
      "page together with each",
      { op: "list_page", each: { from: "list" }, page: { into: "page", next: "increment" } },
      /step feed takes each or page, not both/,
    ],
    [
      "an into the op doesn't take",
      step({ into: "offset", next: "increment" }),
      /step feed pages into --offset, which list_page doesn't take/,
    ],
  ])("refuses %s", (_name, body, message) => {
    const op = {
      id: "bad",
      args: {},
      chain: [
        { id: "list", op: "list_page" },
        { id: "feed", ...body },
      ],
      output: "feed",
    };
    expect(() => load([byPage, op])).toThrow(message);
  });

  it("refuses a path or html next on a step that runs a chain", () => {
    const inner = paged("inner", { op: "list_page" });
    const outer = paged("outer", { op: "inner", page: { into: "page", next: { path: "$.next" } } });
    expect(() =>
      load([
        byPage,
        {
          ...inner,
          args: { page: { type: "number" } },
          chain: [{ id: "feed", op: "list_page", with: { page: "{{page}}" } }],
        },
        outer,
      ]),
    ).toThrow(
      /chain outer step feed reads page.next from inner's response, but inner is a chain; use "increment"/,
    );
  });
});
