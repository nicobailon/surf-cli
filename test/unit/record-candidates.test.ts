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

  it("keeps only structure by default: kind, size, records, field names and types, overlap", () => {
    const body = JSON.stringify({
      results: [
        { name: "Jane Placeholder", email: "jane.placeholder@example.test", active: true },
        { name: "Sharp Objects", email: null, active: false },
      ],
      total: 2,
      "jane.placeholder@example.test": "a key that is data",
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
      fields: { results: "array", total: "number", next: "null" },
      overlap: expect.any(Number),
    });
    const page = candidates.summarizeResponse(
      get("r_2", "Document", `${ORIGIN}/`, { mimeType: "text/html", responseBody: html }),
      candidates.pageWords(PAGE_TEXT),
    );
    expect(page).toEqual({ kind: "html", bytes: html.length, overlap: expect.any(Number) });
    // A list at the top level gives its records' field names.
    const list = candidates.summarizeResponse(
      get("r_3", "XHR", `${ORIGIN}/api`, {
        mimeType: "application/json",
        responseBody: JSON.stringify([
          { id: 1, name: "Jane Placeholder" },
          { id: 2, name: "x" },
        ]),
      }),
      candidates.pageWords(""),
    );
    expect(list.fields).toEqual({ id: "number", name: "string" });
    expect(JSON.stringify([json, page, list])).not.toMatch(/Jane|jane|GB29NWBK/);
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
  it("shows a saved response's field names and types, since the trace keeps no sample", () => {
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
          fields: { results: "array", total: "number" },
        },
      ],
    });
    expect(text.split("\n")[3]).toBe("   fields: results (array), total (number)");
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
