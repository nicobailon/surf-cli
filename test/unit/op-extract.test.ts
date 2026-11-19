import { describe, expect, it } from "vitest";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { readNext, readResponse, validateExtract } = require("../../native/op-extract.cjs");

const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, "..", "fixtures", "sites", name), "utf8");
const html = (name: string, url: string) => ({
  body: fixture(name),
  contentType: "text/html; charset=utf-8",
  url,
});
const books = html("books-page-1.html", "https://books.toscrape.com/catalogue/page-1.html");
const quotes = html("quotes-page-1.html", "https://quotes.toscrape.com/");
const quotesJs = html("quotes-js.html", "https://quotes.toscrape.com/js/");
const httpbin = {
  body: fixture("httpbin-json.json"),
  contentType: "application/json",
  url: "https://httpbin.org/json",
};

describe("HTML extract", () => {
  it("reads the books listing: text, attributes, absolute links", () => {
    const records = readResponse(books, {
      records: "article.product_pod",
      fields: {
        title: "h3 a@title",
        price: ".price_color",
        rating: "p.star-rating@class",
        url: "h3 a@href",
        cover: ".image_container img@src",
      },
    });
    expect(records).toHaveLength(3);
    expect(records[0]).toEqual({
      title: "A Light in the Attic",
      price: "£51.77",
      rating: "star-rating Three",
      url: "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
      cover: "https://books.toscrape.com/media/cache/2c/da/2cdad67c44b002e7ead0cc35693c0e8b.jpg",
    });
  });

  it("keeps one regex group, reads lists with [] and :scope, and > and :nth-child", () => {
    const [first] = readResponse(books, {
      records: "ol.row > li",
      fields: {
        price: { selector: "p.price_color", match: "([\\d.]+)" },
        stars: "p.star-rating > i[]",
        second: "li:nth-child(2) h3 a@title",
        tag: ":scope@class",
      },
    });
    expect(first.price).toBe("51.77");
    expect(first.stars).toHaveLength(5);
    expect(first.second).toBeUndefined();
    expect(first.tag).toBe("col-xs-6 col-sm-4 col-md-3 col-lg-3");
    const quoteRecords = readResponse(quotes, {
      records: "div.quote",
      fields: { text: "span.text", author: "small.author", tags: "a.tag[]" },
    });
    expect(quoteRecords).toHaveLength(10);
    expect(quoteRecords[0].author).toBe("Albert Einstein");
    expect(quoteRecords[0].tags).toEqual(["change", "deep-thoughts", "thinking", "world"]);
  });

  it("reads one record from the whole document when there is no records key", () => {
    expect(readResponse(books, { fields: { heading: "title", pager: "li.current" } })).toEqual({
      heading: "All products | Books to Scrape - Sandbox",
      pager: "Page 1 of 50",
    });
  });

  it("reads an attribute value that holds =", () => {
    const page = {
      body: '<a href="/x?a=b">one</a><a href="/y">two</a>',
      contentType: "text/html",
      url: "https://a.test/",
    };
    expect(readResponse(page, { records: 'a[href="/x?a=b"]' })).toEqual(["one"]);
  });

  it("reads a record's next sibling with + (a dt and its dd), and nothing when the next one isn't it", () => {
    const page = {
      body: '<dl><dt><a href="/a">A</a></dt><dd><b class="t">Alpha</b><i>1</i><i>2</i></dd><dt><a href="/b">B</a></dt><dt><a href="/c">C</a></dt><dd>Gamma</dd></dl>',
      contentType: "text/html",
      url: "https://a.test/list",
    };
    expect(
      readResponse(page, {
        records: "dl > dt",
        fields: { url: "a@href", title: "+ dd .t", dd: "+ dd", tags: "+ dd i[]", none: "+ dt .t" },
      }),
    ).toEqual([
      { url: "https://a.test/a", title: "Alpha", dd: "Alpha12", tags: ["1", "2"] },
      { url: "https://a.test/b" },
      { url: "https://a.test/c", dd: "Gamma" },
    ]);
    expect(() => readResponse(page, { records: "dt", fields: { x: "+ dd:has(a)" } })).toThrow(
      /unsupported selector/,
    );
  });

  it("refuses a selector outside the subset and names the subset", () => {
    expect(() => readResponse(books, { records: "article:has(a)" })).toThrow(
      /unsupported selector: article:has\(a\).*:nth-child/,
    );
  });

  it("gives the next URL from a selector, absolute", () => {
    expect(readNext(quotes, "li.next a@href")).toBe("https://quotes.toscrape.com/page/2/");
    expect(readNext(books, "li.next a@href")).toBe(
      "https://books.toscrape.com/catalogue/page-2.html",
    );
    expect(readNext(quotesJs, "li.missing a@href")).toBeUndefined();
  });
});

describe("JSON extract", () => {
  it("reads records and record paths, a single record, or the value", () => {
    expect(
      readResponse(httpbin, {
        records: "$.slideshow.slides",
        fields: { title: "title", first: "items[0] ?? type" },
      }),
    ).toEqual([
      { title: "Wake up to WonderWidgets!", first: "all" },
      { title: "Overview", first: "Why <em>WonderWidgets</em> are great" },
    ]);
    expect(
      readResponse(httpbin, { fields: { title: "slideshow.title", by: "slideshow.author" } }),
    ).toEqual({ title: "Sample Slide Show", by: "Yours Truly" });
    expect(readResponse(httpbin, { records: "$.slideshow.slides" })).toHaveLength(2);
    expect(readResponse(httpbin, undefined).slideshow.title).toBe("Sample Slide Show");
    expect(() => readResponse(httpbin, { records: "$.slideshow.nope" })).toThrow(
      /records \$\.slideshow\.nope/,
    );
    expect(readNext(httpbin, "$.slideshow.title")).toBe("Sample Slide Show");
  });

  it("reads JSON by its body when the content type says text", () => {
    expect(
      readResponse({ ...httpbin, contentType: "text/plain" }, { fields: { t: "slideshow.title" } }),
    ).toEqual({
      t: "Sample Slide Show",
    });
  });
});

describe("embedded page data", () => {
  it("reads the object an inline script assigns (quotes /js/ var data)", () => {
    const records = readResponse(quotesJs, {
      in: "js:data",
      records: "$",
      fields: { text: "text", author: "author.name", tags: "tags" },
    });
    expect(records).toHaveLength(10);
    expect(records[0].author).toBe("Albert Einstein");
    expect(records[0].text).toMatch(/^“The world as we have created it/);
    expect(records[1].tags).toEqual(["abilities", "choices"]);
  });

  it("reads a JSON script by selector and a JSON-LD node by type", () => {
    const page = {
      body: `<html><head>
        <script id="__NEXT_DATA__" type="application/json">{"props":{"items":[{"id":1},{"id":2}]}}</script>
        <script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":["Product"],"name":"Lamp","offers":{"price":"12"}}]}</script>
      </head></html>`,
      contentType: "text/html",
      url: "https://shop.test/p/1",
    };
    expect(
      readResponse(page, {
        in: "script#__NEXT_DATA__",
        records: "$.props.items",
        fields: { id: "id" },
      }),
    ).toEqual([{ id: 1 }, { id: 2 }]);
    expect(
      readResponse(page, {
        in: "ld+json:Product",
        fields: { name: "name", price: "offers.price" },
      }),
    ).toEqual({ name: "Lamp", price: "12" });
    expect(() => readResponse(page, { in: "ld+json:Recipe" })).toThrow(/no JSON-LD Recipe/);
    expect(() => readResponse(page, { in: "js:state" })).toThrow(/no inline script assigns state/);
  });
});

describe("without htmlparser2 (Node before 20.19 / 22.12)", () => {
  // Fails loading htmlparser2 the way an older Node's require() of an ES module does.
  const hook = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surf-no-esm-")), "hook.cjs");
  fs.writeFileSync(
    hook,
    `const Module = require("node:module");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "htmlparser2") {
    const error = new Error("require() of ES Module htmlparser2 not supported");
    error.code = "ERR_REQUIRE_ESM";
    throw error;
  }
  return resolve.call(this, request, ...rest);
};`,
  );
  const node = (...args: string[]) =>
    spawnSync(process.execPath, ["-r", hook, ...args], { encoding: "utf8" });

  it("loads the CLI, and fails only an HTML read, naming the Node it needs", () => {
    const help = node("native/cli.cjs", "use", "--help");
    expect(help.stderr).toBe("");
    expect(help.status).toBe(0);
    const read = node(
      "-e",
      `const x = require("./native/op-extract.cjs");
console.log(JSON.stringify(x.readResponse({ body: '{"a":1}', contentType: "application/json" }, { fields: { a: "a" } })));
try { x.readResponse({ body: "<p>hi</p>", contentType: "text/html" }); } catch (error) { console.log(error.message); }`,
    );
    expect(read.stdout).toContain('{"a":1}');
    expect(read.stdout).toMatch(
      /reading HTML needs Node 20\.19 or 22\.12 or later \(this is Node v/,
    );
  });
});

describe("extract validation", () => {
  it("accepts the one shape and rejects anything else", () => {
    expect(() =>
      validateExtract({ in: "js:data", records: "$", fields: { a: "a" } }),
    ).not.toThrow();
    expect(() => validateExtract({ html: { item: "li" } })).toThrow(/unknown key "html"/);
    expect(() => validateExtract({ in: "js:1bad" })).toThrow(/extract.in/);
    expect(() => validateExtract({ fields: { a: { selector: "a", match: "(" } } })).toThrow(
      /not a valid regex/,
    );
  });
});
