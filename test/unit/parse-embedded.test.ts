import { describe, expect, it, vi } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const { DomUtils, parseDocument } = require("htmlparser2");

const embedded = require("../../native/parse-embedded.cjs");
const { selectAll } = require("../../native/parse-infer.cjs");
const runtime = require("../../native/playbook-runtime.cjs");
const playbooks = require("../../native/playbooks.cjs");
const extract = require("../../native/playbook-extract.cjs");
const candidates = require("../../native/record-candidates.cjs");

// The fixtures are whole pages, served as they are for the live proof.
const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, "..", "fixtures", "embedded", name), "utf8");

type DomNode = { attribs?: Record<string, string> };

// A tab whose fetch answers with `html` and whose DOMParser reads it with htmlparser2 and
// parse-infer's selector matcher, as the e2e harness does.
function htmlTab(html: string) {
  const element = (node: DomNode | undefined): Record<string, unknown> | null =>
    node
      ? {
          textContent: DomUtils.textContent(node),
          getAttribute: (name: string) => node.attribs?.[name] ?? null,
          querySelector: (selector: string) => element(selectAll(node, selector)[0]),
          querySelectorAll: (selector: string) => selectAll(node, selector).map(element),
        }
      : null;
  class DOMParser {
    parseFromString(text: string) {
      return element(parseDocument(text));
    }
  }
  const fetchImpl = vi.fn(async (url: string) => ({
    status: 200,
    ok: true,
    url,
    headers: new Headers({ "content-type": "text/html" }),
    text: async () => html,
  }));
  const executeTool = vi.fn(async (tool: string, args: { code: string }) => {
    if (tool !== "javascript_tool") {
      return { success: true };
    }
    try {
      const value = await new Function("fetch", "DOMParser", "location", `return ${args.code}`)(
        fetchImpl,
        DOMParser,
        { href: "https://shop.test/" },
      );
      return { output: JSON.stringify(value) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });
  return { executeTool };
}

// What `surf use` returns for a page and an extract: the op's network strategy run in the tab.
async function replay(html: string, opExtract: unknown) {
  const tab = htmlTab(html);
  const result = await runtime.runPlaybookOp({
    playbook: { id: "shop", provenance: { scope: "test" } },
    op: {
      id: "get_data",
      effect: "read",
      args: {},
      run: [
        {
          using: "network",
          request: { method: "GET", url: "https://shop.test/page" },
          extract: opExtract,
        },
      ],
    },
    executeTool: tab.executeTool,
  });
  return result.value;
}

const infer = (html: string, goal: string, options: Record<string, unknown> = {}) =>
  embedded.inferPage(html, { baseUrl: "https://shop.test/page", goal, ...options });

describe("parse reads data embedded in the page", () => {
  it("takes a __NEXT_DATA__ list as records", async () => {
    const html = fixture("next-data-list.html");
    const found = infer(html, "lamps with price and stock");
    expect(found).toMatchObject({
      mode: "embedded",
      records: 5,
      extract: {
        embedded: { selector: "script#__NEXT_DATA__" },
        records: "$.props.pageProps.items",
      },
    });
    expect(Object.keys(found.extract.fields)).toEqual(
      expect.arrayContaining(["id", "name", "url", "priceText", "inStock"]),
    );
    const value = await replay(html, found.extract);
    expect(value).toHaveLength(5);
    expect(value[1]).toMatchObject({ id: "p-1", name: "Dummy Lamp 1", priceText: "$31.00" });
  });

  it("takes a JSON-LD Product with its offers as one detail record", async () => {
    const html = fixture("jsonld-product.html");
    const found = infer(html, "kettle details with price");
    expect(found).toMatchObject({
      mode: "embedded",
      records: null,
      extract: {
        embedded: { selector: 'script[type="application/ld+json"]', type: "Product" },
        jsonPath: "$",
      },
    });
    const value = await replay(html, found.extract);
    expect(value).toMatchObject({
      "@type": "Product",
      name: "Dummy Kettle",
      offers: { price: "49.00", availability: "https://schema.org/InStock" },
    });
  });

  it("takes a JSON-LD ItemList inside @graph as records", async () => {
    const html = fixture("jsonld-itemlist.html");
    const found = infer(html, "best kettles");
    expect(found).toMatchObject({
      mode: "embedded",
      records: 4,
      extract: {
        embedded: { selector: 'script[type="application/ld+json"]', type: "ItemList" },
        records: "$.itemListElement",
      },
    });
    const value = await replay(html, found.extract);
    expect(value[3]).toMatchObject({ name: "Dummy Kettle 4", url: "/products/dummy-kettle-4" });
  });

  it("gives one record per Shopify variant, its options named after the product's", async () => {
    const html = fixture("shopify-product.html");
    const found = infer(html, "tee variants with colour, size and availability");
    expect(found).toMatchObject({
      mode: "embedded",
      records: 6,
      extract: { embedded: { selector: "script[data-product-json]" }, records: "$.variants" },
    });
    expect(found.extract.fields).toMatchObject({
      color: "option1",
      size: "option2",
      available: "available",
      inventory_quantity: "inventory_quantity",
    });
    const value = await replay(html, found.extract);
    expect(value).toHaveLength(6);
    expect(value.map((v: Record<string, unknown>) => [v.color, v.size, v.available])).toEqual([
      ["Black", "S", true],
      ["Black", "M", true],
      ["Black", "L", true],
      ["Sand", "S", true],
      ["Sand", "M", true],
      ["Sand", "L", false],
    ]);
    expect(value[5].inventory_quantity).toBe(0);
  });

  it("reads Shopify's `var meta = {...}` when it is the only copy of the variants", async () => {
    const html = fixture("shopify-product.html").replace(
      /<script type="application\/json" data-product-json>[\s\S]*?<\/script>/,
      "",
    );
    const found = infer(html, "tee variants with sku");
    expect(found).toMatchObject({
      extract: { embedded: { assign: "meta" }, records: "$.product.variants" },
      records: 6,
    });
    const value = await replay(html, found.extract);
    expect(value[0]).toMatchObject({ sku: "TEE-BL-S", public_title: "Black / S" });
  });

  it("reads a window.__STATE__ assignment, skipping ones that aren't JSON", async () => {
    const html = fixture("window-state.html");
    const found = infer(html, "cabins with city and rating");
    expect(found).toMatchObject({
      extract: { embedded: { assign: "window.__STATE__" }, records: "$.search.results" },
      records: 4,
    });
    expect(Object.keys(found.extract.fields)).toEqual(
      expect.arrayContaining(["id", "title", "city", "rating"]),
    );
    const value = await replay(html, found.extract);
    expect(value[2]).toMatchObject({ title: "Dummy Cabin 2", city: "Tromso", rating: 4.3 });
  });

  it("falls back to the HTML when the embedded JSON isn't valid", () => {
    const found = infer(fixture("invalid-embedded.html"), "books with price");
    expect(found).toMatchObject({
      mode: "list",
      records: 4,
      extract: { html: { item: "article.product_pod" } },
    });
  });

  it("keeps the HTML list over a page's breadcrumbs and site JSON-LD", () => {
    const books = Array.from(
      { length: 4 },
      (_, i) =>
        `<article class="product_pod"><h3><a href="b${i}.html">Book ${i}</a></h3><p class="price_color">£${i}</p></article>`,
    ).join("");
    const crumbs = JSON.stringify({
      "@type": "BreadcrumbList",
      itemListElement: ["Home", "Books", "Fiction"].map((name, i) => ({ position: i + 1, name })),
    });
    const html = `<html><head><script type="application/ld+json">${crumbs}</script></head><body>${books}</body></html>`;
    expect(infer(html, "books with price")).toMatchObject({ mode: "list", records: 4 });
  });

  it("drops the longest field until the embedded records fit under the cap", async () => {
    const items = Array.from({ length: 200 }, (_, i) => ({
      id: i,
      name: `Dummy Lamp ${i}`,
      description: `A dummy lamp, number ${i}. `.repeat(16),
    }));
    const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { items } } })}</script></body></html>`;
    const found = infer(html, "lamps", { limit: 45000 });
    expect(found).toMatchObject({ mode: "embedded", records: 200, dropped: ["description"] });
    expect(found.chars).toBeLessThanOrEqual(45000);
    const value = await replay(html, found.extract);
    expect(value).toHaveLength(200);
    expect(value[0]).toEqual({ id: 0, name: "Dummy Lamp 0" });
  });

  it("fails a replay clearly when the page no longer embeds the data", async () => {
    await expect(
      replay("<html><body></body></html>", {
        embedded: { selector: "script#__NEXT_DATA__" },
        records: "$.props.pageProps.items",
      }),
    ).rejects.toThrow(/no script matches script#__NEXT_DATA__/);
    await expect(
      replay('<html><body><script id="__NEXT_DATA__">{props:1}</script></body></html>', {
        embedded: { selector: "script#__NEXT_DATA__" },
      }),
    ).rejects.toThrow(/script#__NEXT_DATA__ doesn't hold valid JSON/);
  });

  it("counts a page's embedded records in its candidate score", () => {
    const html = fixture("shopify-product.html");
    const entry = {
      id: "r_doc",
      method: "GET",
      status: 200,
      type: "Document",
      url: "https://shop.test/products/dummy-tee",
      mimeType: "text/html",
      responseBody: html,
    };
    const summary = candidates.summarizeResponse(entry, candidates.pageWords(""));
    expect(summary).toMatchObject({ kind: "html", records: 8 });
    const [scored] = candidates.scoreEntries([{ ...entry, responseSummary: summary }], {
      origin: "https://shop.test",
    });
    expect(scored.reasons).toContain("8 embedded records");
  });
});

describe("extract.embedded in an op", () => {
  const validate = (strategy: Record<string, unknown>) =>
    playbooks.validateOp(
      {
        id: "get_data",
        effect: "read",
        args: {},
        run: [{ using: "network", request: { url: "https://x.test/" }, ...strategy }],
      },
      { origins: [] },
    );

  it("accepts a selector, an assign and a JSON-LD type, with JSON records or a value", () => {
    expect(() =>
      validate({
        extract: { embedded: { selector: "script#__NEXT_DATA__" }, records: "$.props.items" },
      }),
    ).not.toThrow();
    expect(() => validate({ extract: { embedded: { assign: "window.__STATE__" } } })).not.toThrow();
    expect(() =>
      validate({
        extract: {
          embedded: { selector: 'script[type="application/ld+json"]', type: "Product" },
          jsonPath: "$.offers",
        },
      }),
    ).not.toThrow();
  });

  it("refuses a malformed one, or one on a strategy other than network", () => {
    expect(() =>
      validate({ extract: { embedded: { selector: "script", assign: "meta" } } }),
    ).toThrow(/takes a selector or an assign, not both/);
    expect(() => validate({ extract: { embedded: { assign: "window['x']" } } })).toThrow(
      /assign must be a name such as window.__STATE__/,
    );
    expect(() => validate({ extract: { embedded: { assign: "meta", type: "Product" } } })).toThrow(
      /type picks a JSON-LD node, so it needs a selector/,
    );
    expect(() => validate({ extract: { embedded: { selector: "script", other: 1 } } })).toThrow(
      /embedded has unknown key "other"/,
    );
    expect(() =>
      validate({ extract: { embedded: { selector: "script" }, html: { value: "h1" } } }),
    ).toThrow(/cannot combine html/);
    expect(() =>
      playbooks.validateOp(
        {
          id: "get_data",
          effect: "read",
          args: {},
          run: [
            {
              using: "workflow",
              steps: [{ tool: "navigate", args: { url: "https://x.test/" } }],
              extract: { embedded: { selector: "script" } },
            },
          ],
        },
        { origins: [] },
      ),
    ).toThrow(/extract.embedded works only on network strategies/);
  });

  it("is set by pb extract --embedded, --assign and --ld-type", () => {
    expect(
      extract.parseExtractArgs([
        "shop",
        "get_variants",
        "--embedded",
        "script[data-product-json]",
        "--records",
        "$.variants",
        "--field",
        "color=option1",
      ]).extract,
    ).toEqual({
      embedded: { selector: "script[data-product-json]" },
      records: "$.variants",
      fields: { color: "option1" },
    });
    expect(
      extract.parseExtractArgs([
        "shop",
        "get_state",
        "--assign",
        "window.__STATE__",
        "--value",
        "$.search",
      ]).extract,
    ).toEqual({ embedded: { assign: "window.__STATE__" }, jsonPath: "$.search" });
    expect(
      extract.parseExtractArgs([
        "shop",
        "get_product",
        "--embedded",
        'script[type="application/ld+json"]',
        "--ld-type",
        "Product",
      ]).extract,
    ).toEqual({ embedded: { selector: 'script[type="application/ld+json"]', type: "Product" } });
    expect(() =>
      extract.parseExtractArgs([
        "shop",
        "x",
        "--embedded",
        "script",
        "--item",
        "li",
        "--field",
        "a=b",
      ]),
    ).toThrow(/--embedded and --assign read JSON/);
  });
});
