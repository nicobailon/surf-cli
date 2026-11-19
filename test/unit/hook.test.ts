import { describe, expect, it } from "vitest";

declare const require: (moduleName: string) => any;

const fs = require("node:fs");
const path = require("node:path");
const { readResponse } = require("../../native/op-extract.cjs");
const { renderRequest } = require("../../native/op-run.cjs");
const { inferResponse, keyFields } = require("../../native/op-infer.cjs");
const { nameInputs, requestOf } = require("../../native/op-inputs.cjs");
const { matchHint, pickRequest, rankRequests, visibleText } = require("../../native/op-rank.cjs");

const fixture = (name: string) =>
  fs.readFileSync(path.join("test", "fixtures", "sites", name), "utf8") as string;
const booksList = fixture("books-page-1.html");
const booksDetail = fixture("books-detail.html");
const quotesPage = fixture("quotes-page-1.html");
const quotesJs = fixture("quotes-js.html");
const quotesScroll = fixture("quotes-scroll.html");
const quotesApi = fixture("quotes-api-page-1.json");
const arxivList = fixture("arxiv-list.html");
const arxivAbs = fixture("arxiv-abs.html");

let seq = 0;
type Captured = Record<string, unknown> & { url: string };
const entry = (fields: Captured): Captured => ({
  id: `r_${++seq}`,
  method: "GET",
  status: 200,
  type: "Document",
  mimeType: "text/html",
  ts: 1_800_000_000_000 + seq,
  requestHeaders: {},
  ...fields,
});
const json = (url: string, body: string, fields: Record<string, unknown> = {}) =>
  entry({ url, type: "XHR", mimeType: "application/json", responseBody: body, ...fields });
const assets = [
  entry({
    url: "https://books.toscrape.com/static/main.css",
    type: "Stylesheet",
    mimeType: "text/css",
    responseBody: "body{}",
  }),
  entry({ url: "https://books.toscrape.com/media/a.jpg", type: "Image", mimeType: "image/jpeg" }),
  entry({
    url: "https://books.toscrape.com/static/x.js",
    type: "Script",
    mimeType: "text/javascript",
    responseBody: "var x = 1;",
  }),
];

// The page's words after its script ran: the quotes the API returned.
const quotesText = JSON.parse(quotesApi)
  .quotes.map(
    (quote: { text: string; author: { name: string } }) => `${quote.text} by ${quote.author.name}`,
  )
  .join(" ");

describe("op-rank", () => {
  it("picks a listing's own document over its assets and a third-party call", () => {
    const page = entry({
      url: "https://books.toscrape.com/catalogue/page-2.html",
      responseBody: booksList,
    });
    const ranked = rankRequests(
      [
        ...assets,
        page,
        json("https://stats.example.net/collect", '{"ok":true}', { method: "POST" }),
      ],
      { pageUrl: page.url, pageText: visibleText(booksList), goal: "books with prices" },
    );
    expect(ranked[0].entry).toBe(page);
    expect(ranked[0].reasons).toEqual(
      expect.arrayContaining(["HTML document", "same site", "the page itself"]),
    );
    expect(
      ranked.map((candidate: { entry: { type: string } }) => candidate.entry.type),
    ).not.toContain("Image");
    expect(pickRequest(ranked, {})).toEqual({ pick: ranked[0] });
  });

  it("picks the JSON the page loaded over its near-empty document", () => {
    const page = entry({ url: "https://quotes.toscrape.com/scroll", responseBody: quotesScroll });
    const api = json("https://quotes.toscrape.com/api/quotes?page=1", quotesApi);
    const ranked = rankRequests([page, api], {
      pageUrl: page.url,
      pageText: quotesText,
      goal: "quotes",
    });
    expect(ranked[0].entry).toBe(api);
    expect(ranked[0].reasons).toEqual(
      expect.arrayContaining(["JSON", "10 records", "names the goal"]),
    );
    expect(pickRequest(ranked, {}).pick.entry).toBe(api);
  });

  it("prefers what the --do steps loaded, and --match picks by URL", () => {
    const first = json("https://quotes.toscrape.com/api/quotes?page=1", quotesApi, { ts: 1000 });
    const second = json("https://quotes.toscrape.com/api/quotes?page=2", quotesApi, { ts: 3000 });
    const ranked = rankRequests([first, second], {
      pageUrl: "https://quotes.toscrape.com/scroll",
      pageText: quotesText,
      after: 2000,
    });
    expect(ranked[0].entry).toBe(second);
    expect(ranked[0].reasons).toContain("sent after the --do steps");
    expect(pickRequest(ranked, {}).pick.entry).toBe(second);
    expect(pickRequest(ranked, { match: "page=1" }).pick.entry).toBe(first);
    expect(pickRequest(ranked, { match: "/nothing" })).toEqual({
      error: 'no captured request\'s URL holds "/nothing"',
    });
  });

  it("calls a pick weak when the lead is under 3 points, with a --match that tells them apart", () => {
    const a = json("https://shop.example/api/a?x=1", '[{"name":"a"},{"name":"b"}]');
    const b = json("https://shop.example/api/b?x=1", '[{"name":"c"},{"name":"d"}]');
    const ranked = rankRequests([a, b], { pageUrl: "https://shop.example/", pageText: "" });
    expect(ranked[0].score - ranked[1].score).toBeLessThan(3);
    expect(pickRequest(ranked, {}).weak).toMatch(/leads .* by 0 points/);
    expect(matchHint(ranked)).toBe(new URL(ranked[0].entry.url).pathname);
    expect(pickRequest([], {})).toEqual({ error: "the capture holds no request to pick" });
  });

  it("ranks a POST as a write", () => {
    const post = entry({
      url: "https://quotes.toscrape.com/filter.aspx",
      method: "POST",
      responseBody: quotesPage,
    });
    const [top] = rankRequests([post], { pageUrl: post.url, pageText: visibleText(quotesPage) });
    expect(top.effect).toBe("write");
  });
});

describe("op-inputs", () => {
  it("keeps the request's query, a JSON or form body and its safe headers", () => {
    expect(
      requestOf(
        entry({
          url: "https://a.example/api/search?q=graphs&page=2#top",
          method: "POST",
          requestHeaders: {
            "Content-Type": "application/json",
            Cookie: "sid=1",
            Accept: "application/json",
            "User-Agent": "x",
          },
          requestBody: '{"filters":{"tag":"ml"}}',
        }),
      ),
    ).toEqual({
      method: "POST",
      url: "https://a.example/api/search",
      query: { q: "graphs", page: "2" },
      headers: { "content-type": "application/json", accept: "application/json" },
      body: { filters: { tag: "ml" } },
    });
    const form = requestOf(
      entry({
        url: "https://a.example/f",
        method: "POST",
        requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
        requestBody: "author=Albert+Einstein&tag=x",
      }),
    );
    expect(form.body).toEqual({ author: "Albert Einstein", tag: "x" });
  });

  it("makes each --<name> sample an input where it sits, a page with a default", () => {
    const named = nameInputs({
      request: { url: "https://books.toscrape.com/catalogue/page-2.html" },
      samples: { page: "2" },
    });
    expect(named.request).toEqual({
      url: "https://books.toscrape.com/catalogue/page-{{page}}.html",
    });
    expect(named.args).toEqual({ page: { default: 2, example: 2 } });
    expect(named.paging).toEqual({ name: "page", next: "+1" });
    const missing = nameInputs({ request: { url: "https://a.example/x" }, samples: { tag: "ml" } });
    expect(missing.args).toEqual({});
    expect(missing.warnings).toEqual([
      "--tag's value ml isn't in the picked request, so it is no input",
    ]);
  });

  it("puts a sample only where the hook URL wrote {{name}} when the pick is that URL", () => {
    const named = nameInputs({
      request: { url: "https://a.example/list", query: { page: "2", size: "2" } },
      samples: { page: "2" },
      template: "https://a.example/list?page={{page}}&size=2",
    });
    expect(named.request.query).toEqual({ page: "{{page}}", size: "2" });
    const elsewhere = nameInputs({
      request: { url: "https://a.example/api", query: { p: "2", size: "2" } },
      samples: { page: "2" },
      template: "https://a.example/list?page={{page}}",
    });
    expect(elsewhere.request.query).toEqual({ p: "{{page}}", size: "{{page}}" });
  });

  it("keeps every value of a repeated query key, and sends them all", () => {
    const request = requestOf(entry({ url: "https://a.example/s?tag=a&tag=b&q=x" }));
    expect(request.query).toEqual({ tag: ["a", "b"], q: "x" });
    const named = nameInputs({ request, samples: { tag: "b" } });
    expect(named.request.query).toEqual({ tag: ["a", "{{tag}}"], q: "{{query}}" });
    expect(renderRequest(named.request, { args: { tag: "c", query: "y" }, env: {} }).url).toBe(
      "https://a.example/s?tag=a&tag=c&q=y",
    );
  });

  it("names a search key query, a paging key page and a page-N segment page", () => {
    const named = nameInputs({
      request: { url: "https://a.example/search", query: { q: "python", page: "3", lang: "en" } },
    });
    expect(named.request.query).toEqual({ q: "{{query}}", page: "{{page}}", lang: "en" });
    expect(named.args).toEqual({
      query: { required: true, example: "python" },
      page: { default: 3, example: 3 },
    });
    expect(
      nameInputs({ request: { url: "https://books.toscrape.com/catalogue/page-7.html" } }).request
        .url,
    ).toBe("https://books.toscrape.com/catalogue/page-{{page}}.html");
    expect(
      nameInputs({ request: { url: "https://a.example/s", query: { start: "40" } } }).paging,
    ).toEqual({ name: "start", next: "+count" });
  });

  it("names an id-like path segment after the word before it, and calls the page a detail", () => {
    const abs = nameInputs({ request: { url: "https://arxiv.org/abs/2101.10010" } });
    expect(abs.request.url).toBe("https://arxiv.org/abs/{{abs_id}}");
    expect(abs.args).toEqual({ abs_id: { required: true, example: "2101.10010" } });
    expect(abs.detail).toBe(true);
    const book = nameInputs({
      request: { url: "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html" },
    });
    expect(book.request.url).toBe(
      "https://books.toscrape.com/catalogue/{{catalogue_id}}/index.html",
    );
    const list = nameInputs({ request: { url: "https://arxiv.org/list/cs.CL/recent" } });
    expect(list).toMatchObject({ args: {}, detail: false });
  });

  it("makes a typed value an input named after its key", () => {
    const named = nameInputs({
      request: {
        method: "POST",
        url: "https://quotes.toscrape.com/filter.aspx",
        body: { author: "Albert Einstein", tag: "----------" },
      },
      typed: ["Albert Einstein"],
    });
    expect(named.request.body).toEqual({ author: "{{author}}", tag: "----------" });
    expect(named.args).toEqual({ author: { required: true, example: "Albert Einstein" } });
    const searched = nameInputs({
      request: { url: "https://a.example/find", query: { kw: "rust lang" } },
      typed: ["rust lang"],
    });
    expect(searched.request.query).toEqual({ kw: "{{kw}}" });
  });
});

describe("op-infer", () => {
  // The extract an inference writes reads its own response back through the runner's reader.
  const infer = (body: string, url: string, options: Record<string, unknown> = {}) => {
    const response = {
      body,
      url,
      contentType: body.trim().startsWith("{") ? "application/json" : "text/html",
    };
    const found = inferResponse(response, options);
    return { ...found, read: readResponse(response, found.extract) };
  };

  it("reads a book listing: the repeated item with a link, its title attribute and classed fields", () => {
    const found = infer(booksList, "https://books.toscrape.com/catalogue/page-1.html");
    expect(found.extract).toEqual({
      records: "article.product_pod",
      fields: {
        title: "h3 a@title",
        url: "h3 a@href",
        star_rating: {
          selector: ".star-rating@class",
          match: "(?:^|\\s)(?!star-rating(?:\\s|$))(\\S+)",
        },
        price_color: ".price_color",
      },
    });
    expect(found.count).toBe(3);
    expect(found.read[0]).toEqual({
      title: "A Light in the Attic",
      url: "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
      star_rating: "Three",
      price_color: "£51.77",
    });
    expect(keyFields(found)).toEqual(["title", "url"]);
  });

  it("reads a book's detail page: meta, heading, the price beside it and labelled cells", () => {
    const found = infer(
      booksDetail,
      "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
      { detail: true },
    );
    expect(found.count).toBeNull();
    expect(found.extract.records).toBeUndefined();
    expect(found.extract.fields).toMatchObject({
      title: "h1",
      price_color: ".product_main .price_color",
      upc: "table.table-striped tr:nth-child(1) td",
    });
    expect(found.read).toMatchObject({
      title: "A Light in the Attic",
      price_color: "£51.77",
      upc: "a897fe39b1053632",
    });
  });

  it("reads a quotes page's HTML, the quotes API's JSON and the data its /js/ page embeds", () => {
    const html = infer(quotesPage, "https://quotes.toscrape.com/");
    expect(html.extract.records).toBe("div.quote");
    expect(html.extract.fields).toMatchObject({ text: ".text", author: ".author" });
    expect(html.read[0]).toMatchObject({ author: "Albert Einstein" });

    const api = infer(quotesApi, "https://quotes.toscrape.com/api/quotes?page=1");
    expect(api.extract).toEqual({
      records: "$.quotes",
      fields: {
        author_name: "author.name",
        author_goodreads_link: "author.goodreads_link",
        author_slug: "author.slug",
        tags: "tags",
        text: "text",
      },
    });
    expect(api.count).toBe(10);
    expect(api.read[0]).toMatchObject({
      author_name: "Albert Einstein",
      tags: ["change", "deep-thoughts", "thinking", "world"],
    });
    expect(keyFields(api)).toEqual(["text", "author_name"]);

    const embedded = infer(quotesJs, "https://quotes.toscrape.com/js/");
    expect(embedded.extract).toMatchObject({ in: "js:data", records: "$" });
    expect(embedded.count).toBe(10);
    expect(embedded.read[0]).toMatchObject({ author_name: "Albert Einstein" });
  });

  it("reads arXiv's dt/dd listing as parallel [] fields of the list", () => {
    const found = infer(arxivList, "https://arxiv.org/list/cs.CL/recent");
    expect(found.extract.records).toBe("dl#articles");
    expect(found.extract.fields).toMatchObject({
      url: 'dt a[title="Abstract"]@href[]',
      id: 'dt a[title="Abstract"]@id[]',
      title: "dd .list-title[]",
      authors: "dd .list-authors[]",
    });
    expect(found.read[0].url).toHaveLength(4);
    expect(found.read[0].url[0]).toBe("https://arxiv.org/abs/2611.23218");
  });

  it("reads an arXiv abstract page from its citation meta tags and own heading", () => {
    const found = infer(arxivAbs, "https://arxiv.org/abs/2101.10010", { detail: true });
    expect(found.extract.fields).toMatchObject({
      title: 'meta[name="citation_title"]@content',
      author: 'meta[name="citation_author"]@content[]',
      heading: "h1.title",
    });
    expect(found.read.title).toBe("The First Fermi-LAT Solar Flare Catalog");
    expect(found.read.author[0]).toBe("Ajello, M.");
  });

  it("returns nothing when a response holds no records or fields", () => {
    expect(
      inferResponse({ body: "<html><body></body></html>", url: "https://a.example/" }, {}),
    ).toBeUndefined();
    expect(
      inferResponse(
        {
          body: '{"origin":"1.2.3.4"}',
          url: "https://a.example/ip",
          contentType: "application/json",
        },
        {},
      ),
    ).toEqual({
      extract: { fields: { origin: "origin" } },
      count: null,
    });
  });
});
