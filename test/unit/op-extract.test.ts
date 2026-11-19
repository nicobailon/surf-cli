import { describe, expect, it } from "vitest";

const fs = require("node:fs");
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
