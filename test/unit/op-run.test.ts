import { describe, expect, it } from "vitest";

const fs = require("node:fs");
const path = require("node:path");

const { dryRunOp, renderRequest, runOp } = require("../../native/op-run.cjs");
const { validateOp } = require("../../native/playbooks.cjs");
const { resolveArgs } = require("../../native/playbook-runtime.cjs");

const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, "..", "fixtures", "sites", name), "utf8");
const playbook = { id: "site", provenance: { scope: "test" } };

type Call = { tool: string; args: Record<string, unknown> };
type Reply = { status?: number; body?: string; contentType?: string; elsewhere?: string };

// A fake tab: the request script's URL decides the reply; `page` is the rendered page's HTML.
function fakeTab(reply: (url: string) => Reply, page?: { url: string; html: string }) {
  const calls: Call[] = [];
  const executeTool = async (tool: string, args: Record<string, unknown>) => {
    calls.push({ tool, args });
    if (tool !== "javascript_tool") {
      return { success: true };
    }
    const code = String(args.code);
    if (code.includes("outerHTML")) {
      return { output: JSON.stringify(page) };
    }
    const url = JSON.parse(code.match(/new URL\(("[^"]*")\)/)?.[1] ?? '""');
    const out = reply(url);
    if (out.elsewhere) {
      return { output: JSON.stringify({ elsewhere: out.elsewhere }) };
    }
    return {
      output: JSON.stringify({
        status: out.status ?? 200,
        url,
        contentType: out.contentType ?? "text/html",
        body: out.body ?? "",
      }),
    };
  };
  const requested = () =>
    calls
      .filter(
        (call) => call.tool === "javascript_tool" && !String(call.args.code).includes("outerHTML"),
      )
      .map((call) => JSON.parse(String(call.args.code).match(/new URL\(("[^"]*")\)/)?.[1] ?? '""'));
  return { calls, executeTool, requested };
}

const run = (
  op: Record<string, unknown>,
  tab: ReturnType<typeof fakeTab>,
  { args = {}, ...extra }: Record<string, unknown> = {},
) => {
  const valid = validateOp(op, {});
  return runOp({
    playbook,
    op: valid,
    args: resolveArgs(valid, args),
    executeTool: tab.executeTool,
    sleep: () => Promise.resolve(),
    ...extra,
  });
};

const listBooks = {
  id: "list_books",
  args: { page: { default: 1 } },
  request: { url: "https://books.toscrape.com/catalogue/page-{{page}}.html" },
  extract: { records: "article.product_pod", fields: { title: "h3 a@title", url: "h3 a@href" } },
  page: { into: "page", next: "+1" },
  expect: { minItems: 1, fields: ["title", "url"] },
};

describe("templates", () => {
  it("fills inputs and env by place and encodes the body", () => {
    const rendered = renderRequest(
      {
        method: "post",
        url: "https://api.test/search/{{q}}",
        query: { page: "{{page}}", empty: "{{unset}}" },
        headers: { authorization: "Bearer {{env.API_TOKEN}}" },
        body: { q: "{{q}}", n: "{{page}}", note: "p{{page}}", gone: "{{unset}}" },
      },
      { args: { q: "a b/c", page: 2 }, env: { API_TOKEN: "t0k" } },
    );
    expect(rendered).toEqual({
      method: "POST",
      url: "https://api.test/search/a%20b%2Fc?page=2",
      headers: { authorization: "Bearer t0k", "content-type": "application/json" },
      body: '{"q":"a b/c","n":2,"note":"p2"}',
    });
    const form = renderRequest(
      {
        method: "POST",
        url: "https://api.test/form",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: { name: "{{name}}", size: "large" },
      },
      { args: { name: "Ada L" }, env: {} },
    );
    expect(form.body).toBe("name=Ada+L&size=large");
    expect(() => renderRequest({ url: "https://a.test/{{id}}" }, { args: {}, env: {} })).toThrow(
      /missing input: id/,
    );
    expect(() =>
      renderRequest(
        { url: "https://a.test/", headers: { x: "{{env.NOPE}}" } },
        { args: {}, env: {} },
      ),
    ).toThrow(/environment variable NOPE is not set/);
  });
});

describe("runOp", () => {
  it("reads a tab request and follows +1 paging for --pages", async () => {
    const tab = fakeTab(() => ({ body: fixture("books-page-1.html") }));
    const result = await run(listBooks, tab, { pages: 3, args: { page: 2 } });
    expect(result).toMatchObject({ status: "completed", via: "tab", op: "list_books" });
    expect(result.value).toHaveLength(9);
    expect(result.value[0]).toEqual({
      title: "A Light in the Attic",
      url: "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
    });
    expect(tab.requested()).toEqual([
      "https://books.toscrape.com/catalogue/page-2.html",
      "https://books.toscrape.com/catalogue/page-3.html",
      "https://books.toscrape.com/catalogue/page-4.html",
    ]);
  });

  it("follows a next link until there is none", async () => {
    const last = fixture("quotes-page-1.html").replace(/<li class="next">[\s\S]*?<\/li>/, "");
    const tab = fakeTab((url) => ({
      body: url.endsWith("/page/2/") ? last : fixture("quotes-page-1.html"),
    }));
    const op = {
      id: "quotes",
      request: { url: "https://quotes.toscrape.com/" },
      extract: { records: "div.quote", fields: { text: "span.text", author: "small.author" } },
      page: { next: "li.next a@href" },
    };
    const result = await run(op, tab, { pages: 5 });
    expect(result.value).toHaveLength(20);
    expect(tab.requested()).toEqual([
      "https://quotes.toscrape.com/",
      "https://quotes.toscrape.com/page/2/",
    ]);
  });

  it("refuses a next link or --url on another site", async () => {
    const elsewhere = fixture("quotes-page-1.html").replace(
      "/page/2/",
      "https://other.test/page/2/",
    );
    const op = {
      id: "quotes",
      request: { url: "https://quotes.toscrape.com/" },
      extract: { records: "div.quote", fields: { text: "span.text" } },
      page: { next: "li.next a@href" },
    };
    await expect(
      run(
        op,
        fakeTab(() => ({ body: elsewhere })),
        { pages: 2 },
      ),
    ).rejects.toThrow(/https:\/\/other\.test is not this op's site/);
    await expect(
      run(
        op,
        fakeTab(() => ({ body: elsewhere })),
        { url: "https://other.test/" },
      ),
    ).rejects.toThrow(/not this op's site/);
  });

  it("applies the op to --url and reads a JSON cursor into an input", async () => {
    const tab = fakeTab((url) => ({
      contentType: "application/json",
      body: JSON.stringify(
        url.includes("after=c2")
          ? { items: [{ id: 3 }] }
          : { items: [{ id: 1 }, { id: 2 }], next: "c2" },
      ),
    }));
    const op = {
      id: "feed",
      args: { after: {} },
      request: { url: "https://api.test/feed", query: { after: "{{after}}" } },
      extract: { records: "$.items", fields: { id: "id" } },
      page: { into: "after", next: "$.next" },
    };
    const result = await run(op, tab, { pages: 3, url: "https://api.test/feed?tag=x" });
    expect(result.value).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(tab.requested()).toEqual([
      "https://api.test/feed?tag=x",
      "https://api.test/feed?tag=x&after=c2",
    ]);
  });

  it("opens the op's site when the tab is elsewhere, then sends the request", async () => {
    let first = true;
    const tab = fakeTab(() => {
      if (first) {
        first = false;
        return { elsewhere: "https://example.test" };
      }
      return { body: fixture("books-page-1.html") };
    });
    const result = await run(listBooks, tab);
    expect(result.value).toHaveLength(3);
    expect(tab.calls.find((call) => call.tool === "navigate")?.args).toEqual({
      url: "https://books.toscrape.com/",
    });
  });

  it("falls to the page when the request fails expect, and runs the steps", async () => {
    const tab = fakeTab(() => ({ body: "<html><body>blocked</body></html>" }), {
      url: "https://quotes.toscrape.com/js/",
      html: fixture("quotes-js.html"),
    });
    const op = {
      id: "js_quotes",
      args: { who: { default: "x" } },
      request: { url: "https://quotes.toscrape.com/js/" },
      open: "https://quotes.toscrape.com/js/",
      steps: "wait.element .quote | type {{who}}",
      extract: { in: "js:data", records: "$", fields: { author: "author.name" } },
      expect: { minItems: 5, fields: ["author"] },
    };
    const result = await run(op, tab);
    expect(result).toMatchObject({ via: "page", attempts: [{ via: "tab" }] });
    expect(result.attempts[0].error).toMatch(/no inline script assigns data/);
    expect(result.value).toHaveLength(10);
    expect(tab.calls.map((call) => call.tool)).toEqual(
      expect.arrayContaining(["navigate", "wait.element", "type"]),
    );
    expect(tab.calls.find((call) => call.tool === "type")?.args).toMatchObject({ text: "x" });
  });

  it("names the missing field when expect.fields fails, and moves on at a 4xx", async () => {
    const tab = fakeTab((url) =>
      url.includes("page-1") ? { body: fixture("books-page-1.html") } : { status: 404 },
    );
    const missing = { ...listBooks, expect: { fields: ["title", "isbn"] } };
    await expect(run(missing, tab)).rejects.toThrow(
      /All steps failed \(tab: expected field isbn in the first record\)/,
    );
    await expect(run(listBooks, tab, { args: { page: 9 } })).rejects.toThrow(/tab: status 404/);
  });

  it("checks expect.status against the response", async () => {
    const tab = fakeTab(() => ({ status: 202, body: fixture("books-page-1.html") }));
    await expect(run({ ...listBooks, expect: { status: 200 } }, tab)).rejects.toThrow(
      /expected status 200, got 202/,
    );
  });
});

describe("paging ends", () => {
  it("keeps the pages read when a later page answers 404", async () => {
    const tab = fakeTab((url) =>
      url.endsWith("page-4.html") ? { status: 404 } : { body: fixture("books-page-1.html") },
    );
    const result = await run(listBooks, tab, { pages: 6 });
    expect(result).toMatchObject({ status: "completed", via: "tab" });
    expect(result.value).toHaveLength(9);
    expect(tab.requested()).toHaveLength(4);
  });

  it("stops with a note when the next page is the same request", async () => {
    const tab = fakeTab(() => ({ body: fixture("books-page-1.html") }));
    const pinned = await run(listBooks, tab, {
      pages: 3,
      url: "https://books.toscrape.com/catalogue/page-1.html",
    });
    expect(pinned.value).toHaveLength(3);
    expect(tab.requested()).toHaveLength(1);
    expect(pinned.note).toBe("stopped after page 1: page 2 would send the same request");
    const self = fixture("quotes-page-1.html").replace('href="/page/2/"', 'href="/"');
    const quotes = fakeTab(() => ({ body: self }));
    const result = await run(
      {
        id: "quotes",
        request: { url: "https://quotes.toscrape.com/" },
        extract: { records: "div.quote", fields: { text: "span.text" } },
        page: { next: "li.next a@href" },
      },
      quotes,
      { pages: 4 },
    );
    expect(result.value).toHaveLength(10);
    expect(quotes.requested()).toEqual(["https://quotes.toscrape.com/"]);
    expect(result.note).toMatch(/same request/);
  });
});

describe("tab results", () => {
  it("says to reload the extension when a result stops at 50,000 characters", async () => {
    const executeTool = async (tool: string) =>
      tool === "javascript_tool" ? { output: `"${"x".repeat(49_999)}` } : { success: true };
    await expect(
      runOp({ playbook, op: validateOp(listBooks, {}), args: { page: 1 }, executeTool }),
    ).rejects.toThrow(/stopped at 50,000 characters.*reload the Surf extension/);
  });

  it("keeps env values out of the events of the page it opens", async () => {
    const events: unknown[] = [];
    const tab = fakeTab(() => ({}), {
      url: "https://books.toscrape.com/",
      html: fixture("books-page-1.html"),
    });
    await run(
      {
        id: "keyed",
        open: "https://books.toscrape.com/?key={{env.SHOP_KEY}}",
        extract: { records: "article.product_pod", fields: { title: "h3 a@title" } },
      },
      tab,
      { env: { SHOP_KEY: "s3cr3t-value" }, onEvent: (event: unknown) => events.push(event) },
    );
    expect(tab.calls[0]?.args).toEqual({ url: "https://books.toscrape.com/?key=s3cr3t-value" });
    const journaled = JSON.stringify(events);
    expect(journaled).toContain("tool.started");
    expect(journaled).not.toContain("s3cr3t-value");
    expect(journaled).toContain("{{env.SHOP_KEY}}");
  });
});

describe("dry run", () => {
  it("renders the request with env names kept, and sends nothing", () => {
    const op = validateOp(
      {
        id: "search",
        args: { q: { required: true } },
        request: {
          url: "https://api.test/search",
          query: { q: "{{q}}" },
          headers: { authorization: "Bearer {{env.API_TOKEN}}" },
        },
      },
      {},
    );
    expect(dryRunOp({ playbook, op, args: { q: "lamps" } })).toEqual({
      dryRun: true,
      playbook: "site",
      op: "search",
      via: "direct",
      fallback: ["tab"],
      request: {
        method: "GET",
        url: "https://api.test/search?q=lamps",
        headers: { authorization: "Bearer {{env.API_TOKEN}}" },
      },
    });
    const page = validateOp(
      { id: "p", open: "https://a.test/{{q}}", steps: "click e1", args: { q: {} } },
      {},
    );
    expect(dryRunOp({ playbook, op: page, args: { q: "x" } })).toMatchObject({
      via: "page",
      open: "https://a.test/x",
      steps: [{ cmd: "click" }],
    });
  });
});

describe("the op file", () => {
  it("loads flat keys, keeps run lists as they were, and rejects a mix", () => {
    const op = validateOp(listBooks, { origins: [] });
    expect(op).toMatchObject({ id: "list_books", effect: "read", request: { method: "GET" } });
    expect(op.run).toBeUndefined();
    const old = validateOp(
      { id: "old", run: [{ using: "workflow", steps: [{ tool: "page.text" }] }] },
      {},
    );
    expect(old.run).toHaveLength(1);
    expect(() => validateOp({ ...listBooks, run: old.run }, {})).toThrow(
      /op list_books needs one of request, open, chain or run/,
    );
    expect(() => validateOp({ id: "none" }, {})).toThrow(
      /needs one of request, open, chain or run/,
    );
    expect(() => validateOp({ ...listBooks, pager: {} }, {})).toThrow(/unknown key "pager"/);
    expect(() => validateOp({ ...listBooks, page: { next: "+1" } }, {})).toThrow(
      /page.next "\+1" adds to an input, so it needs page.into/,
    );
    expect(() => validateOp({ ...listBooks, expect: { fields: "title" } }, {})).toThrow(
      /expect.fields must be a list/,
    );
    expect(() =>
      validateOp(
        { ...listBooks, request: { url: "https://a.test", headers: { cookie: "s=1" } } },
        {},
      ),
    ).toThrow(/literal cookie/);
    expect(
      validateOp({ id: "chained", chain: [{ id: "list", op: "list_books" }] }, {}).chain,
    ).toHaveLength(1);
  });
});
