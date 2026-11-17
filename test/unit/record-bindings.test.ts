import { describe, expect, it } from "vitest";

const { proposeChain } = require("../../native/record-bindings.cjs");
const { validateOp } = require("../../native/playbooks.cjs");

type Entry = Record<string, unknown>;
const record = { id: "rec-1", site: "jobs", op: "postings", origin: "https://jobs.test" };

const get = (id: string, url: string, body: string, extra: Entry = {}): Entry => ({
  id,
  method: "GET",
  status: 200,
  type: "XHR",
  url,
  mimeType: "application/json",
  requestHeaders: {},
  responseHeaders: { "content-type": "application/json" },
  responseBody: body,
  ...extra,
});
const page = (id: string, url: string, html: string): Entry =>
  get(id, url, html, {
    type: "Document",
    mimeType: "text/html",
    responseHeaders: { "content-type": "text/html" },
  });
const json = (value: unknown) => JSON.stringify(value);
// An each step runs over the list, as many records and as far apart as the chain's inputs say.
const EACH = { from: "list", limit: "{{limit}}", delayMs: "{{delay-ms}}" };

const postings = json({
  total: 3,
  items: [
    { id: "posting-1001", title: "Engineer" },
    { id: "posting-1002", title: "Designer" },
    { id: "posting-1003", title: "Writer" },
  ],
});

const QUOTES_HTML = `<!doctype html><html><body>
<div class="col-md-8">
  ${["Albert-Einstein", "J-K-Rowling", "Jane-Austen"]
    .map(
      (author) => `<div class="quote">
    <span class="text">A quote</span>
    <span>by <small class="author">${author}</small> <a href="/author/${author}">(about)</a></span>
    <div class="tags"><a class="tag" href="/tag/change/page/1/">change</a></div>
  </div>`,
    )
    .join("\n")}
</div>
<nav><a href="/login">Login</a></nav>
</body></html>`;

describe("proposeChain", () => {
  it("binds a JSON list item's id into the next request's path, as each over the list", () => {
    const proposal = proposeChain({
      record,
      entries: [
        get("r_1", "https://jobs.test/api/list?company=acme", postings),
        get("r_2", "https://jobs.test/api/postings/posting-1002", json({ id: "posting-1002" })),
      ],
    });
    expect(proposal).toMatchObject({
      version: 1,
      recordId: "rec-1",
      steps: [
        {
          id: "list",
          op: "postings_list",
          request: "r_1",
          extract: { records: "$.items", fields: { id: "id" } },
        },
        { id: "posting", op: "postings_posting", request: "r_2", inputs: { posting: "path.3" } },
      ],
      op: {
        id: "postings",
        effect: "read",
        args: {
          limit: { type: "number", default: 5 },
          "delay-ms": { type: "number", default: 2000 },
        },
        chain: [
          { id: "list", op: "postings_list" },
          {
            id: "posting",
            op: "postings_posting",
            each: EACH,
            with: { posting: { from: "item", path: "$.id" } },
          },
        ],
        output: "posting",
      },
    });
    expect(proposal.bindings).toEqual([
      "postings_posting --posting ← $.id of each record of postings_list ($.items) (into path.3)",
    ]);
  });

  it("binds a value outside any list straight from the step that returned it", () => {
    const proposal = proposeChain({
      record,
      entries: [
        get("r_1", "https://jobs.test/api/me", json({ account: { handle: "acme-corp-77" } })),
        get("r_2", "https://jobs.test/api/orgs?handle=acme-corp-77", json({ ok: true })),
      ],
    });
    expect(proposal.steps).toEqual([
      {
        id: "me",
        op: "postings_me",
        request: "r_1",
        extract: { fields: { handle: "account.handle" } },
      },
      { id: "org", op: "postings_org", request: "r_2", inputs: { handle: "query.handle" } },
    ]);
    // Without an each step the chain takes no inputs.
    expect(proposal.op.args).toEqual({});
    expect(proposal.op.chain[1]).toEqual({
      id: "org",
      op: "postings_org",
      with: { handle: { from: "me", path: "$.handle" } },
    });
  });

  it("binds an HTML list's link path segment into the next page's path", () => {
    const proposal = proposeChain({
      record: { ...record, site: "quotes", op: "authors", origin: "https://quotes.test" },
      entries: [
        page("r_1", "https://quotes.test/", QUOTES_HTML),
        page("r_2", "https://quotes.test/author/J-K-Rowling/", "<html><h1>J-K-Rowling</h1></html>"),
      ],
    });
    expect(proposal.steps).toEqual([
      {
        id: "list",
        op: "authors_list",
        request: "r_1",
        extract: { html: { item: "div.quote > span > a[href]", fields: { url: ":scope@href" } } },
      },
      { id: "author", op: "authors_author", request: "r_2", inputs: { author: "path.2" } },
    ]);
    expect(proposal.op.chain[1]).toEqual({
      id: "author",
      op: "authors_author",
      each: EACH,
      with: { author: { from: "item", path: "$.url", segment: 2 } },
    });
    expect(proposal.bindings).toEqual([
      "authors_author --author ← $.url path segment 2 of each record of authors_list (div.quote > span > a[href]) (into path.2)",
    ]);
  });

  // books.toscrape.com: a lone menu link's route word (catalogue) loses to the product links' slugs.
  it("binds a list's varying link segment, never a lone link's route word", () => {
    const books = ["a-light-in-the-attic_1000", "tipping-the-velvet_999", "soumission_998"];
    const html = `<html><body>
<ul class="nav nav-list"><li><a href="catalogue/category/books_1/index.html">Books</a></li></ul>
<ol class="row">${books
      .map(
        (slug) => `<li><article class="product_pod">
  <div class="image_container"><a href="catalogue/${slug}/index.html"><img src="x.jpg"></a></div>
  <h3><a href="catalogue/${slug}/index.html" title="t">t</a></h3></article></li>`,
      )
      .join("")}</ol></body></html>`;
    const proposal = proposeChain({
      record: { ...record, site: "books", op: "books", origin: "https://books.test" },
      entries: [
        page("r_1", "https://books.test/index.html", html),
        page(
          "r_2",
          "https://books.test/catalogue/tipping-the-velvet_999/index.html",
          "<html></html>",
        ),
      ],
    });
    expect(proposal.steps).toEqual([
      {
        id: "list",
        op: "books_list",
        request: "r_1",
        extract: {
          html: { item: "div.image_container > a[href]", fields: { url: ":scope@href" } },
        },
      },
      { id: "catalogue", op: "books_catalogue", request: "r_2", inputs: { catalogue: "path.2" } },
    ]);
    expect(JSON.stringify(proposal)).not.toMatch(/velvet|attic|soumission/);
  });

  it("stores paths and field names, never the values it matched", () => {
    const proposals = [
      proposeChain({
        record,
        entries: [
          get("r_1", "https://jobs.test/api/list", postings),
          get("r_2", "https://jobs.test/api/postings/posting-1002", "{}"),
        ],
      }),
      proposeChain({
        record,
        entries: [
          page("r_1", "https://quotes.test/", QUOTES_HTML),
          page("r_2", "https://quotes.test/author/Jane-Austen/", "<html></html>"),
        ],
      }),
    ];
    const text = JSON.stringify(proposals);
    for (const value of ["posting-1002", "posting-1001", "Jane-Austen", "Albert-Einstein"]) {
      expect(text).not.toContain(value);
    }
  });

  // A key can be data (a post's id, a session's): no path or field name goes through one.
  it("never reads through a key that is data", () => {
    const postId = ["abc", "12345"].join("");
    const session = ["sess", "kqzx", "wvut"].join("-");
    const user = ["romeo", "quill"].join("-");
    const ref = ["ref", "alpha", "beta"].join("-");
    const proposals = [
      // A key with a digit.
      proposeChain({
        record,
        entries: [
          get("r_1", "https://jobs.test/api/feed", json({ posts: { [postId]: { id: postId } } })),
          get("r_2", `https://jobs.test/api/posts/${postId}`, "{}"),
        ],
      }),
      // A session-like key another request sent in its URL.
      proposeChain({
        record,
        entries: [
          get("r_0", `https://jobs.test/api/whoami?sid=${session}`, "{}"),
          get("r_1", "https://jobs.test/api/state", json({ sessions: { [session]: { ref } } })),
          get("r_2", `https://jobs.test/api/refs/${ref}`, "{}"),
        ],
      }),
      // A key that is also a value in the same body.
      proposeChain({
        record,
        entries: [
          get(
            "r_1",
            "https://jobs.test/api/team",
            json({ users: { [user]: { login: user, ref } } }),
          ),
          get("r_2", `https://jobs.test/api/refs/${ref}`, "{}"),
        ],
      }),
    ];
    const text = JSON.stringify(proposals);
    for (const value of [postId, session, user]) {
      expect(text).not.toContain(value);
    }
  });

  // A URL segment the record typed, or a cookie's value, names no input, step or op.
  it("names nothing after a typed or cookie value in the URL", () => {
    const typed = ["romeo", "search"].join("-");
    const crumb = ["velvet", "mode"].join("-");
    const typedRun = proposeChain({
      record,
      typed: [typed],
      entries: [
        get("r_1", "https://jobs.test/api/list", postings),
        get("r_2", `https://jobs.test/api/${typed}/posting-1002`, "{}"),
      ],
    });
    const cookieRun = proposeChain({
      record,
      entries: [
        get("r_1", "https://jobs.test/api/list", postings),
        get("r_2", `https://jobs.test/api/${crumb}/posting-1002`, "{}", {
          requestHeaders: { cookie: `pref=${crumb}` },
        }),
      ],
    });
    for (const [proposal, value] of [
      [typedRun, typed],
      [cookieRun, crumb],
    ]) {
      expect(proposal.steps[1]).toMatchObject({ id: "page", inputs: { id: "path.3" } });
      expect(JSON.stringify(proposal)).not.toContain(value.split("-")[0]);
    }
  });

  // item is the binding source of an each step, so no step can take it as its id.
  it("names a step of /items/<id> item_2, as item is no step id", () => {
    const proposal = proposeChain({
      record,
      entries: [
        get("r_1", "https://jobs.test/api/list", postings),
        get("r_2", "https://jobs.test/api/items/posting-1002", "{}"),
      ],
    });
    expect(proposal.steps[1]).toMatchObject({ id: "item_2", op: "postings_item_2" });
    expect(() => validateOp(proposal.op, { origins: [] })).not.toThrow();
  });

  it("proposes nothing from a secret-named field, a credential-like value, a header or a cookie", () => {
    // Built from parts, so no fixture reads as a key: each only has to be 6 characters or more.
    const value = (...parts: string[]) => ["dummy", ...parts].join("-");
    const session = value("sess", "4417");
    const jwt = [`${"ey"}J${"hbGci"}`, `${"ey"}J${"zdWIi"}`, "c2lnbmF0dXJl"].join(".");
    const ref = value("ref", "5521");
    const cookie = value("crumb", "6630");
    const keyed = value("plain", "7742");
    const cases: Entry[][] = [
      [
        get(
          "r_1",
          "https://jobs.test/api/session",
          json({ [["session", "token"].join("_")]: session }),
        ),
        get("r_2", `https://jobs.test/api/me/${session}`, "{}"),
      ],
      [
        get("r_1", "https://jobs.test/api/next", json({ cursor: jwt })),
        get("r_2", `https://jobs.test/api/page?cursor=${jwt}`, "{}"),
      ],
      [
        get("r_1", "https://jobs.test/api/start", "{}", {
          responseHeaders: { "content-type": "application/json", "x-request-ref": ref },
        }),
        get("r_2", `https://jobs.test/api/refs/${ref}`, "{}"),
      ],
      [
        get("r_1", "https://jobs.test/api/start", json({ ref: cookie }), {
          responseHeaders: {
            "content-type": "application/json",
            "set-cookie": `sid=${cookie}; Path=/`,
          },
        }),
        get("r_2", `https://jobs.test/api/refs/${cookie}`, "{}"),
      ],
      [
        get("r_1", "https://jobs.test/api/start", json({ ref: keyed })),
        get("r_2", `https://jobs.test/api/refs?${["api", "key"].join("_")}=${keyed}`, "{}"),
      ],
    ];
    for (const entries of cases) {
      expect(proposeChain({ record, entries })).toBeNull();
    }
  });

  it("proposes nothing for one request, a route word every record shares, or a write", () => {
    expect(
      proposeChain({ record, entries: [get("r_1", "https://jobs.test/api/list", postings)] }),
    ).toBeNull();
    const shared = json({ items: [{ kind: "postings" }, { kind: "postings" }] });
    expect(
      proposeChain({
        record,
        entries: [
          get("r_1", "https://jobs.test/api/list", shared),
          get("r_2", "https://jobs.test/api/postings/1", "{}"),
        ],
      }),
    ).toBeNull();
    expect(
      proposeChain({
        record,
        entries: [
          get("r_1", "https://jobs.test/api/list", postings),
          get("r_2", "https://jobs.test/api/postings/posting-1002", "{}", { method: "POST" }),
        ],
      }),
    ).toBeNull();
  });
});
