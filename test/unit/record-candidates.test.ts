import { describe, expect, it } from "vitest";

const candidates = require("../../native/record-candidates.cjs");

type Entry = Record<string, unknown>;
const ORIGIN = "https://books.example";
const PAGE_TEXT =
  "All products Showing books twenty results Sharp Objects Soumission Tipping Velvet Olio Mesaerion Libertarianism Beginners Starving Hearts Shakespeare Sonnets";

const get = (id: string, type: string, url: string, extra: Entry = {}): Entry => ({
  id,
  method: "GET",
  status: 200,
  type,
  url,
  ...extra,
});

describe("summarizeResponse", () => {
  it("keeps a short redacted sample in memory when asked (live ranking), never the body", () => {
    const body = JSON.stringify({
      token: "abc.def.ghi",
      results: [
        { title: "Sharp Objects", price: 47.82, password: "hunter2" },
        { title: "Tipping Velvet", price: 53.74 },
        { title: "Soumission", price: 50.1 },
      ],
      filler: "x".repeat(5000),
    });
    const summary = candidates.summarizeResponse(
      get("r_1", "XHR", `${ORIGIN}/api/books`, {
        mimeType: "application/json",
        responseBody: body,
        bodyCapture: { mode: "text", complete: true, capturedBytes: body.length },
      }),
      candidates.pageWords(PAGE_TEXT),
      { sample: true },
    );
    expect(summary).toMatchObject({ kind: "json", bytes: body.length, records: 3 });
    expect(summary.sample.length).toBeLessThanOrEqual(candidates.SAMPLE_CHARS);
    expect(summary.sample).toContain('"token":"<redacted>"');
    expect(summary.sample).toContain("Sharp Objects");
    expect(JSON.stringify(summary)).not.toContain("hunter2");
    expect(summary.overlap).toBeGreaterThan(0);
    expect(summary).not.toHaveProperty("responseBody");
  });

  it("samples a JSON body that is a secret header's value whole as <redacted>, with no field names", () => {
    const secret = JSON.stringify({ [["k", "ey"].join("")]: 1 });
    const summary = candidates.summarizeResponse(
      get("r_1", "XHR", `${ORIGIN}/api/books`, {
        mimeType: "application/json",
        requestHeaders: { "x-csrf-token": secret },
        responseBody: secret,
      }),
      candidates.pageWords(PAGE_TEXT),
      { sample: true },
    );
    expect(summary.sample).toBe(JSON.stringify("<redacted>"));
    expect(summary).not.toHaveProperty("fieldNames");
  });

  it("samples a whole-secret JSON body as <redacted> though it holds a secret-named field", () => {
    const secret = JSON.stringify({ [["to", "ken"].join("")]: ["sh", "op"].join("") });
    const summary = candidates.summarizeResponse(
      get("r_1", "XHR", `${ORIGIN}/api/books`, {
        mimeType: "application/json",
        requestHeaders: { "x-csrf-token": secret },
        responseBody: secret,
      }),
      candidates.pageWords(PAGE_TEXT),
      { sample: true },
    );
    expect(summary.sample).toBe(JSON.stringify("<redacted>"));
  });

  it("samples a JSON body that is a typed redact value whole as <redacted>, with no field names", () => {
    const key = ["k", "ey"].join("");
    for (const secret of [`{ "${key}": 1 }`, `{"${key}":1}`]) {
      const summary = candidates.summarizeResponse(
        get("r_1", "XHR", `${ORIGIN}/api/books`, {
          mimeType: "application/json",
          responseBody: secret,
        }),
        candidates.pageWords(PAGE_TEXT),
        { sample: true, redact: [secret] },
      );
      expect(summary.sample).toBe(JSON.stringify("<redacted>"));
      expect(summary).not.toHaveProperty("fieldNames");
    }
  });

  it("samples an HTML page's visible text, not its scripts or tags", () => {
    const body =
      "<html><head><title>All products | Books</title><script>var secret = 1;</script><style>p{}</style></head><body><h1>All products</h1><p>Sharp &amp; Objects</p></body></html>";
    const summary = candidates.summarizeResponse(
      get("r_1", "Document", `${ORIGIN}/page-2.html`, {
        mimeType: "text/html",
        responseBody: body,
      }),
      candidates.pageWords(""),
      { sample: true },
    );
    expect(summary.kind).toBe("html");
    expect(summary.sample).toBe("All products | Books All products Sharp & Objects");
    expect(summary).not.toHaveProperty("overlap");
  });

  it("samples only JSON and HTML, masking credential-like text", () => {
    const summary = (mimeType: string, responseBody: string) =>
      candidates.summarizeResponse(
        get("r_1", "XHR", `${ORIGIN}/t`, { mimeType, responseBody }),
        candidates.pageWords(""),
        { sample: true },
      );
    expect(summary("text/plain", "captured-secret")).toEqual({ kind: "text", bytes: 15 });
    expect(summary("application/json", '{"note":"Bearer abcdef123456"}').sample).toBe(
      '{"note":"<redacted>"}',
    );
  });

  it("keeps only structure by default: kind, size, records, field and type counts, overlap", () => {
    const body = JSON.stringify({
      results: [
        { name: "Jane Placeholder", email: "jane.placeholder@example.test", active: true },
        { name: "Sharp Objects", email: null, active: false },
      ],
      total: 2,
      "jane.placeholder@example.test": "a key that is data",
      // Keys can be data too: a map keyed by account number or username.
      GB29NWBK60161331926819: { balance: 1 },
      jane_placeholder: { active: true },
      next: null,
    });
    const html =
      "<html><body><h1>All products</h1><p>Jane Placeholder GB29NWBK60161331926819</p></body></html>";
    const json = candidates.summarizeResponse(
      get("r_1", "XHR", `${ORIGIN}/api`, { mimeType: "application/json", responseBody: body }),
      candidates.pageWords(PAGE_TEXT),
    );
    expect(json).toEqual({
      kind: "json",
      bytes: body.length,
      records: 2,
      fields: 6,
      types: { array: 1, null: 1, number: 1, object: 2, string: 1 },
      overlap: expect.any(Number),
    });
    const page = candidates.summarizeResponse(
      get("r_2", "Document", `${ORIGIN}/`, { mimeType: "text/html", responseBody: html }),
      candidates.pageWords(PAGE_TEXT),
    );
    expect(page).toEqual({ kind: "html", bytes: html.length, overlap: expect.any(Number) });
    // A list at the top level counts its first record's fields.
    const listEntry = get("r_3", "XHR", `${ORIGIN}/api`, {
      mimeType: "application/json",
      responseBody: JSON.stringify([
        { id: 1, name: "Jane Placeholder" },
        { id: 2, name: "x" },
      ]),
    });
    const list = candidates.summarizeResponse(listEntry, candidates.pageWords(""));
    expect(list).toMatchObject({ fields: 2, types: { number: 1, string: 1 } });
    expect(JSON.stringify([json, page, list])).not.toMatch(/Jane|jane|GB29NWBK|results|total/);
    // Names appear only in the live, in-memory summary.
    const live = candidates.summarizeResponse(listEntry, candidates.pageWords(""), {
      sample: true,
    });
    expect(live.fieldNames).toEqual({ id: "number", name: "string" });
  });

  it("says why there is no sample when the body was over the capture cap", () => {
    const summary = candidates.summarizeResponse(
      get("r_1", "XHR", `${ORIGIN}/api/big`, {
        mimeType: "application/json",
        bodyCapture: {
          mode: "text",
          complete: false,
          reason: "per-body-cap",
          sizeBytes: 90_000,
          limitBytes: 65_536,
        },
      }),
      candidates.pageWords(""),
    );
    expect(summary).toEqual({ kind: "json", bytes: 90_000, unsampled: "per-body-cap" });
  });
});

describe("rankCandidates", () => {
  const pageWords = candidates.pageWords(PAGE_TEXT);
  const summarized = (entry: Entry) => ({
    ...entry,
    responseSummary: candidates.summarizeResponse(entry, pageWords, { sample: true }),
  });
  const listing = `<html><body><h1>All products</h1>${PAGE_TEXT}</body></html>`;

  it("ranks the page document first and assets, telemetry, preflights and redirects low", () => {
    const entries = [
      get("r_redirect", "Document", `${ORIGIN}/catalogue/`, { status: 301 }),
      summarized(
        get("r_page", "Document", `${ORIGIN}/catalogue/page-2.html?x=1`, {
          mimeType: "text/html",
          responseBody: listing,
        }),
      ),
      get("r_css", "Stylesheet", `${ORIGIN}/static/site.css`, { mimeType: "text/css" }),
      get("r_img", "Image", `${ORIGIN}/media/cover.jpg`, { mimeType: "image/jpeg" }),
      { ...get("r_preflight", "Preflight", `${ORIGIN}/api/x`), method: "OPTIONS", status: 204 },
      {
        ...get("r_ga", "XHR", "https://www.google-analytics.com/g/collect?v=2"),
        method: "POST",
        status: 204,
      },
      get("r_font", "Font", `${ORIGIN}/static/fonts/glyphicons.woff2`, { mimeType: "font/woff2" }),
    ];
    const ranked = candidates.rankCandidates(entries, { origin: ORIGIN });
    expect(ranked.map((item: { id: string }) => item.id)).toEqual([
      "r_page",
      "r_redirect",
      "r_font",
      "r_preflight",
      "r_img",
      "r_css",
      "r_ga",
    ]);
    expect(ranked[0]).toMatchObject({
      rank: 1,
      method: "GET",
      status: 200,
      type: "Document",
      mimeType: "text/html",
      url: `${ORIGIN}/catalogue/page-2.html?x=1`,
      reasons: [
        "HTML document",
        "first-party",
        expect.stringMatching(/^overlaps \d+% of the page text$/),
      ],
      effect: "read",
      eligible: true,
    });
    expect(ranked.find((item: { id: string }) => item.id === "r_font").reasons).toContain(
      "page asset (Font)",
    );
    expect(ranked.find((item: { id: string }) => item.id === "r_redirect").reasons).toContain(
      "redirect without a body",
    );
    expect(ranked.find((item: { id: string }) => item.id === "r_preflight").reasons).toContain(
      "CORS preflight",
    );
    expect(ranked.find((item: { id: string }) => item.id === "r_ga").reasons).toContain(
      "telemetry",
    );
    // A redirect is replayable (fetch follows it), so it stays eligible, ranked low.
    expect(ranked.find((item: { id: string }) => item.id === "r_redirect").eligible).toBe(true);
    for (const id of ["r_css", "r_img", "r_font", "r_preflight", "r_ga"]) {
      expect(ranked.find((item: { id: string }) => item.id === id).eligible).toBe(false);
    }
  });

  it("puts a first-party JSON list of records above a site banner config and a third-party feed", () => {
    const json = (id: string, url: string, value: unknown) => {
      const body = JSON.stringify(value);
      return summarized(
        get(id, "XHR", url, {
          mimeType: "application/json",
          responseBody: body,
          bodyCapture: { complete: true, capturedBytes: body.length },
        }),
      );
    };
    const books = [
      { title: "Sharp Objects", price: 1 },
      { title: "Tipping Velvet", price: 2 },
      { title: "Soumission", price: 3 },
    ];
    const ranked = candidates.rankCandidates(
      [
        json("r_books", `${ORIGIN}/api/books?page=2`, { results: books }),
        json("r_banner", `${ORIGIN}/static/announcements.json`, {
          banner: { show: false, text: "Welcome to the new site. ".repeat(6) },
        }),
        json("r_feed", "https://cdn.other.example/feed.json", { results: books }),
        json("r_tiny", `${ORIGIN}/api/ok`, { ok: true }),
      ],
      { origin: ORIGIN },
    );
    expect(ranked.map((item: { id: string }) => item.id)).toEqual([
      "r_books",
      "r_feed",
      "r_banner",
      "r_tiny",
    ]);
    expect(ranked[0].reasons).toEqual([
      "JSON",
      "3 records",
      "first-party",
      expect.stringMatching(/^overlaps/),
    ]);
    expect(ranked[1].reasons).toContain("third-party (cdn.other.example)");
    expect(ranked[3].reasons).toContain("tiny body (11 B)");
    expect(ranked[0].sample).toContain("Sharp Objects");
  });

  it("puts a document holding the whole page above a small banner JSON and the web manifest", () => {
    // arXiv: the search page's own HTML, then static.arxiv.org's announcements banner (a list of
    // records the page doesn't show) and the web manifest's icons, both first-party JSON.
    const page = "https://papers.example";
    const json = (id: string, url: string, type: string, mimeType: string, value: unknown) => {
      const body = JSON.stringify(value);
      return summarized(
        get(id, type, url, {
          mimeType,
          responseBody: body,
          bodyCapture: { complete: true, capturedBytes: body.length },
        }),
      );
    };
    const notices = Array.from({ length: 5 }, (_, index) => ({
      id: index,
      message: `Scheduled maintenance window number ${index}`,
    }));
    const icons = [192, 512].map((size) => ({
      src: `/icon-${size}.png`,
      sizes: `${size}x${size}`,
    }));
    const ranked = candidates.rankCandidates(
      [
        summarized(
          get("r_doc", "Document", `${page}/search/advanced?terms-0-term=diffusion`, {
            mimeType: "text/html",
            responseBody: listing,
          }),
        ),
        json(
          "r_banner",
          "https://static.papers.example/announcements.json",
          "Fetch",
          "application/json",
          notices,
        ),
        json("r_manifest", `${page}/site.webmanifest`, "Manifest", "application/manifest+json", {
          name: "Papers",
          icons,
        }),
      ],
      { origin: page },
    );
    expect(ranked.map((item: { id: string }) => item.id)).toEqual([
      "r_doc",
      "r_manifest",
      "r_banner",
    ]);
    expect(ranked[0].reasons).toEqual([
      "HTML document",
      "first-party",
      "overlaps 100% of the page text",
    ]);
    expect(ranked[0].score - ranked[1].score).toBeGreaterThanOrEqual(candidates.WINNER_MARGIN);
    expect(ranked[2].reasons).toEqual([
      "JSON",
      "5 records not counted (the path reads like a banner or announcements feed)",
      "first-party",
      "small JSON that overlaps 0% of the page text",
    ]);

    // A 50-result search page is over capture's per-body cap, so its overlap is unknown; the
    // banner's records still don't lift it over the document.
    const unsampled = get("r_doc", "Document", `${page}/search/?query=diffusion`, {
      mimeType: "text/html",
      bodyCapture: { complete: false, reason: "per-body-cap", sizeBytes: 248_000 },
    });
    const overCap = candidates.rankCandidates(
      [
        summarized(unsampled),
        json(
          "r_banner",
          "https://static.papers.example/announcements.json",
          "Fetch",
          "application/json",
          notices,
        ),
      ],
      { origin: page },
    );
    expect(overCap.map((item: { id: string }) => item.id)).toEqual(["r_doc", "r_banner"]);
    expect(overCap[0].score - overCap[1].score).toBeGreaterThanOrEqual(candidates.WINNER_MARGIN);
  });

  it("still puts a JSON API that fills the page above the page's empty app shell", () => {
    // crates.io: the document is a script shell; /api/v1/crates holds every crate the page lists.
    const crates = ["Sharp Objects", "Tipping Velvet", "Soumission", "Starving Hearts"].map(
      (name) => ({
        name,
        description: `${name} Shakespeare Sonnets Libertarianism Beginners Mesaerion Olio`,
      }),
    );
    const body = JSON.stringify({ crates, meta: { total: 4 } });
    const ranked = candidates.rankCandidates(
      [
        summarized(
          get("r_shell", "Document", `${ORIGIN}/search?q=books`, {
            mimeType: "text/html",
            responseBody: '<html><body><div id="app">Loading products</div></body></html>',
          }),
        ),
        summarized(
          get("r_api", "Fetch", `${ORIGIN}/api/v1/crates?q=books`, {
            mimeType: "application/json",
            responseBody: body,
            bodyCapture: { complete: true, capturedBytes: body.length },
          }),
        ),
      ],
      { origin: ORIGIN },
    );
    expect(ranked.map((item: { id: string }) => item.id)).toEqual(["r_api", "r_shell"]);
    expect(ranked[0].reasons).toContain("4 records");
  });

  // A chart or numbers API: 90 bytes of real records, none of whose text is on the page.
  const series = (id: string) => {
    const body = JSON.stringify({
      series: [
        { t: 1001, v: 3.25, n: 1 },
        { t: 1002, v: 5.5, n: 2 },
        { t: 1003, v: 8.75, n: 30 },
      ],
    });
    return summarized(
      get(id, "Fetch", `${ORIGIN}/api/chart/series?range=7d`, {
        mimeType: "application/json",
        responseBody: body,
        bodyCapture: { complete: true, capturedBytes: body.length },
      }),
    );
  };

  it("keeps a small chart API with records above an empty shell or a document too large to sample", () => {
    const shell = summarized(
      get("r_shell", "Document", `${ORIGIN}/dashboard`, {
        mimeType: "text/html",
        responseBody: '<html><body><div id="app">Loading products</div></body></html>',
      }),
    );
    const overCap = summarized(
      get("r_big", "Document", `${ORIGIN}/dashboard`, {
        mimeType: "text/html",
        bodyCapture: { complete: false, reason: "per-body-cap", sizeBytes: 248_000 },
      }),
    );
    for (const [id, page] of [
      ["r_shell", shell],
      ["r_big", overCap],
    ] as const) {
      const ranked = candidates.rankCandidates([page, series("r_series")], { origin: ORIGIN });
      expect(ranked.map((item: { id: string }) => item.id)).toEqual(["r_series", id]);
      expect(ranked[0].reasons).toEqual(["JSON", "3 records", "first-party"]);
    }
  });

  it("puts a document holding the whole page above a data JSON whose records aren't on it", () => {
    const ranked = candidates.rankCandidates(
      [
        summarized(
          get("r_doc", "Document", `${ORIGIN}/catalogue/`, {
            mimeType: "text/html",
            responseBody: listing,
          }),
        ),
        series("r_series"),
      ],
      { origin: ORIGIN },
    );
    expect(ranked.map((item: { id: string; score: number }) => [item.id, item.score])).toEqual([
      ["r_doc", 11],
      ["r_series", 9],
    ]);
  });

  it("lists and flags a write without hiding it", () => {
    const ranked = candidates.rankCandidates(
      [{ ...get("r_create", "XHR", `${ORIGIN}/api/books`), method: "POST", status: 201 }],
      { origin: ORIGIN },
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({ id: "r_create", effect: "write", eligible: true });
    expect(ranked[0].reasons[0]).toBe("write (POST)");
  });

  it("breaks ties toward the later request, the old default", () => {
    const ranked = candidates.rankCandidates(
      [get("r_a", "XHR", `${ORIGIN}/a`), get("r_b", "XHR", `${ORIGIN}/b`)],
      { origin: ORIGIN },
    );
    expect(ranked.map((item: { id: string }) => item.id)).toEqual(["r_b", "r_a"]);
  });

  it("calls a top score under the threshold weak", () => {
    expect(candidates.isWeak({ score: candidates.WEAK_SCORE - 1 })).toBe(true);
    expect(candidates.isWeak({ score: candidates.WEAK_SCORE })).toBe(false);
  });
});

describe("formatCandidates", () => {
  it("prints one line per request with the query trimmed, then the reasons and sample", () => {
    const text = candidates.formatCandidates({
      recordId: "rec-1",
      site: "books",
      op: "list",
      live: false,
      total: 2,
      candidates: [
        {
          rank: 1,
          id: "r_1",
          method: "GET",
          status: 200,
          type: "Document",
          mimeType: "text/html",
          url: "https://books.example/page-2.html?utm=1",
          bytes: 6200,
          score: 9,
          reasons: ["HTML document", "first-party"],
          effect: "read",
          eligible: true,
          sample: "All products",
        },
        {
          rank: 2,
          id: "r_2",
          method: "GET",
          status: 200,
          type: "Font",
          mimeType: "font/woff2",
          url: "https://books.example/f.woff2",
          score: -6,
          reasons: ["page asset (Font)", "first-party"],
          effect: "read",
          eligible: false,
        },
      ],
    });
    expect(text).toBe(
      [
        "rec-1 (books list): 2 requests, best first",
        "1. r_1  GET 200 Document text/html  https://books.example/page-2.html  6.1 KB  score 9",
        "   HTML document, first-party",
        '   "All products"',
        "2. r_2  GET 200 Font font/woff2  https://books.example/f.woff2  score -6  (never picked)",
        "   page asset (Font), first-party",
        "Choose one: surf pb save --from-record rec-1 --request-id <id>",
      ].join("\n"),
    );
  });
});

describe("formatCandidates for a stopped record", () => {
  it("shows a saved response's field and type counts, since the trace keeps no names or sample", () => {
    const text = candidates.formatCandidates({
      recordId: "rec-3",
      site: "s",
      op: "o",
      live: false,
      total: 1,
      candidates: [
        {
          rank: 1,
          id: "r_1",
          method: "GET",
          status: 200,
          type: "XHR",
          mimeType: "application/json",
          url: "https://books.example/api",
          bytes: 900,
          score: 9,
          reasons: ["JSON", "2 records"],
          effect: "read",
          eligible: true,
          fields: 3,
          types: { number: 1, array: 2 },
        },
      ],
    });
    expect(text.split("\n")[3]).toBe("   fields: 3 (array 2, number 1)");
  });
});

describe("formatCandidates for an active record", () => {
  it("says the record is still recording and points at stop --draft", () => {
    const text = candidates.formatCandidates({
      recordId: "rec-2",
      site: "s",
      op: "o",
      live: true,
      total: 0,
      candidates: [],
    });
    expect(text).toBe(
      [
        "rec-2 (s o): 0 requests, best first, read live (still recording)",
        "Choose one: surf pb record stop --draft --request-id <id>",
      ].join("\n"),
    );
  });
});

describe("a live sample's field names", () => {
  // Dummy values, built from parts so no literal here reads as a credential.
  const TYPED = ["dummy", "typed", "15"].join("-");
  const AUTH = ["dummy", "auth", "15"].join("-");

  it("leave out a name that is text the record typed or a secret header's value", () => {
    const body = JSON.stringify({ [TYPED]: { hits: 2 }, [AUTH]: true, title: "Sharp Objects" });
    const summary = candidates.summarizeResponse(
      get("r_1", "XHR", "https://books.example/api", {
        mimeType: "application/json",
        requestHeaders: { Authorization: `Bearer ${AUTH}` },
        responseBody: body,
      }),
      candidates.pageWords(""),
      { sample: true, redact: [TYPED] },
    );
    expect(summary.fieldNames).toEqual({ title: "string" });
    expect(JSON.stringify(summary)).not.toContain("dummy");
  });
});

describe("a live sample, when the request carries a short auth parameter or cookie value", () => {
  // Short dummy values, built from parts so no literal here reads as a credential.
  const SHOP = ["sh", "op"].join("");
  const SID = ["ab", "c"].join("");
  const headers = { Authorization: `ResyAPI api_key="${SHOP}"`, Cookie: `sid=${SID}` };

  it("redacts them as whole JSON strings and hides a field named by one", () => {
    const summary = candidates.summarizeResponse(
      get("r_1", "XHR", "https://books.example/api", {
        mimeType: "application/json",
        requestHeaders: headers,
        responseBody: JSON.stringify({ echo: SHOP, sid: SID, [SHOP]: 1, title: "Sharp Objects" }),
      }),
      candidates.pageWords(""),
      { sample: true },
    );
    expect(JSON.parse(summary.sample)).toEqual({
      echo: "<redacted>",
      sid: "<redacted>",
      "<redacted>": 1,
      title: "Sharp Objects",
    });
    expect(summary.fieldNames).toEqual({ echo: "string", sid: "string", title: "string" });
  });

  it("redacts them as whole words of an HTML page's text", () => {
    const summary = candidates.summarizeResponse(
      get("r_2", "Document", "https://books.example/", {
        mimeType: "text/html",
        requestHeaders: headers,
        responseBody: `<html><body><p>${SHOP} and ${SID}</p></body></html>`,
      }),
      candidates.pageWords(""),
      { sample: true },
    );
    expect(summary.sample).toBe("<redacted> and <redacted>");
  });
});
