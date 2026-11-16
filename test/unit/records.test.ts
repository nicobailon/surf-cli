import { describe, expect, it } from "vitest";

// @ts-expect-error - CommonJS module without type definitions
import * as records from "../../native/records.cjs";

const post = (id: string, author: string, text: string, extra: Record<string, unknown> = {}) => ({
  rest_id: id,
  core: { screen_name: author },
  legacy: { full_text: text },
  ...extra,
});

const page1 = {
  user: { rest_id: "u1", legacy: { name: "not a post" } },
  entries: [
    {
      content: {
        tweet: post("1", "a", "short", {
          note: { text: "the long version" },
          media: [{ url: "m1" }, { url: "m2" }],
          source: '<a href="https://example.test">Web App</a>',
          quoted: post("9", "b", "quoted text"),
        }),
      },
    },
    { content: { wrapper: { tweet: post("2", "b", "a reply") } } },
    { content: { cursorType: "Top", value: "c-top" } },
    { content: { cursorType: "Bottom", value: "c-1" } },
  ],
};
const page2 = {
  entries: [{ tweet: post("1", "a", "changed") }, { tweet: post("3", "a", "third") }],
};

const spec = {
  find: { exists: ["rest_id", "legacy.full_text"] },
  key: "rest_id",
  fields: {
    id: "rest_id",
    author: "core.screen_name",
    text: "note.text ?? legacy.full_text",
    media: "media[*].url",
    source: { path: "source", match: ">([^<]+)<" },
    quoted: { path: "quoted", fields: { id: "rest_id", author: "core.screen_name" } },
    url: { template: "https://x.test/{{author}}/status/{{id}}" },
    quotedBy: { template: "@{{quoted.author}}" },
  },
  keep: { author: "@first" },
};

describe("records", () => {
  it("reads paths with indexes, projections, and alternatives", () => {
    const doc = { a: [{ b: [1, 2] }, { c: 0 }, { b: [3] }], x: null, y: "y" };
    expect(records.getPath(doc, "a[*].b")).toEqual([1, 2, 3]);
    expect(records.getPath(doc, "a[2].b[0]")).toBe(3);
    expect(records.getPath(doc, "x ?? y")).toBe("y");
    expect(records.getPath(doc, "a[5].b")).toBeUndefined();
    expect(records.getPath(doc, "a.length")).toBeUndefined();
    for (const bad of ["a..b", "a[x]", "a ?? ", "a[1"]) {
      expect(() => records.getPath(doc, bad)).toThrow(/invalid path/);
    }
  });

  it("maps matched objects into deduped records across pages and keeps the first author", () => {
    const set = records.createRecordSet(spec);
    expect(set.add(page1)).toBe(2);
    expect(set.add(page2)).toBe(1);
    expect(set.records()).toEqual([
      {
        id: "1",
        author: "a",
        text: "the long version",
        media: ["m1", "m2"],
        source: "Web App",
        quoted: { id: "9", author: "b" },
        url: "https://x.test/a/status/1",
        quotedBy: "@b",
      },
      { id: "3", author: "a", text: "third", url: "https://x.test/a/status/3" },
    ]);
  });

  it("rejects malformed record specs", () => {
    expect(() => records.createRecordSet({ ...spec, extra: 1 })).toThrow(/unknown key "extra"/);
    expect(() => records.createRecordSet({ ...spec, fields: {} })).toThrow(/at least one field/);
  });

  it("converts as: datetime fields to ISO 8601 UTC and leaves out anything else", () => {
    const read = (value: unknown) => {
      const set = records.createRecordSet({
        find: { exists: ["id"] },
        key: "id",
        fields: { time: { path: "value", as: "datetime" } },
      });
      set.add({ id: 1, value });
      return set.records()[0];
    };
    expect(read("2024-01-01T10:00:00Z")).toEqual({ time: "2024-01-01T10:00:00.000Z" });
    expect(read("2024-01-01T12:30+02:00")).toEqual({ time: "2024-01-01T10:30:00.000Z" });
    expect(read("2024-02-29T23:59:59.123456-05:00")).toEqual({ time: "2024-03-01T04:59:59.123Z" });
    expect(read("Mon Jan 01 10:00:00 +0000 2024")).toEqual({ time: "2024-01-01T10:00:00.000Z" });
    expect(read("Sun Dec 31 23:30:00 -0130 2023")).toEqual({ time: "2024-01-01T01:00:00.000Z" });
    for (const value of [
      "Oct 3",
      "3h",
      "2024-01-01",
      "2024-01-01T10:00:00",
      "2024-02-30T00:00:00Z",
      "2023-02-29T00:00:00Z",
      "2024-01-01T24:00:00Z",
      "2024-01-01T10:60:00Z",
      "2024-01-01T10:00:60Z",
      "2024-01-01T10:00:00+24:00",
      "2024-01-01T10:00:00+05:60",
      "Fri Feb 30 10:00:00 +0000 2024",
      1704103200000,
      null,
    ]) {
      expect(read(value)).toStrictEqual({});
    }
  });

  it("runs match before as: datetime, and converts inside nested fields", () => {
    const set = records.createRecordSet({
      find: { exists: ["id"] },
      key: "id",
      fields: {
        posted: { path: "label", match: "^posted (.+)$", as: "datetime" },
        quoted: { path: "quoted", fields: { time: { path: "created_at", as: "datetime" } } },
      },
    });
    set.add({
      id: 1,
      label: "posted 2024-01-01T10:00:00Z",
      quoted: { created_at: "Mon Jan 01 09:00:00 +0000 2024" },
    });
    set.add({ id: 2, label: "posted yesterday", quoted: { created_at: "3h" } });
    expect(set.records()).toStrictEqual([
      { posted: "2024-01-01T10:00:00.000Z", quoted: { time: "2024-01-01T09:00:00.000Z" } },
      { quoted: {} },
    ]);
  });

  it("rejects malformed as: datetime fields", () => {
    const withField = (field: unknown) => ({ ...spec, fields: { time: field } });
    expect(() => records.createRecordSet(withField({ path: "t", as: "date" }))).toThrow(
      'records.fields.time.as must be "datetime"',
    );
    expect(() =>
      records.createRecordSet(withField({ path: "q", as: "datetime", fields: { id: "rest_id" } })),
    ).toThrow("records.fields.time cannot combine as and fields");
    expect(() => records.createRecordSet(withField({ path: "t[*].at", as: "datetime" }))).toThrow(
      "records.fields.time.as needs a single value, not a [*] path",
    );
    expect(() =>
      records.createRecordSet(withField({ path: "q", fields: { t: { path: "t", as: 1 } } })),
    ).toThrow('records.fields.time.fields.t.as must be "datetime"');
  });

  it("reads the cursor from the first matching object", () => {
    const cursor = {
      find: { equals: { cursorType: "Bottom" } },
      path: "value",
      into: "query.cursor",
    };
    expect(records.readCursor(page1, cursor)).toBe("c-1");
    expect(records.readCursor(page2, cursor)).toBeUndefined();
  });

  it("stops a field match that backtracks too long instead of hanging the host", () => {
    // (a+)+b on 24 a's backtracks for over a second without a bound.
    const slow = { path: "t", match: "(a+)+b" };
    let started = Date.now();
    expect(() => records.extractRecords({ t: "a".repeat(24) }, { fields: { t: slow } })).toThrow(
      "fields.t.match pattern took too long (over 100 ms); simplify it",
    );
    expect(Date.now() - started).toBeLessThan(500);
    const set = records.createRecordSet({ find: { exists: ["t"] }, key: "t", fields: { t: slow } });
    started = Date.now();
    expect(() => set.add({ t: "a".repeat(24) })).toThrow(
      "records.fields.t.match pattern took too long (over 100 ms); simplify it",
    );
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("keeps a field match's capture group and tests only the first 64 KB", () => {
    const fields = {
      id: { path: "url", match: "/status/(\\d+)" },
      end: { path: "t", match: "x$" },
    };
    expect(
      records.extractRecords(
        { url: "https://x.test/a/status/42", t: `${"a".repeat(70000)}x` },
        { fields },
      ),
    ).toEqual({ id: "42" });
  });

  it("shares one regex budget across an extract's records and fails once it is spent", () => {
    const doc = Array.from({ length: 5 }, (_, index) => ({ id: `id-${index}` }));
    const extract = { records: "$", fields: { id: { path: "id", match: "id-(\\d)" } } };
    expect(records.extractRecords(doc, extract)).toHaveLength(5);
    const spent = { remainingMs: 0, limitMs: 2000, scope: "extract" };
    expect(() => records.extractRecords(doc, extract, { regexBudget: spent })).toThrow(
      "skipped: the extract's 2 s regex budget is spent",
    );
  });

  it("refuses a field match over 500 characters or that is not a regex", () => {
    const withMatch = (match: unknown) => ({ ...spec, fields: { x: { path: "t", match } } });
    expect(() => records.createRecordSet(withMatch("a".repeat(501)))).toThrow(
      "records.fields.x.match is 501 characters; the limit is 500",
    );
    expect(() => records.createRecordSet(withMatch("a".repeat(500)))).not.toThrow();
    expect(() => records.createRecordSet(withMatch("("))).toThrow(
      /records\.fields\.x\.match is not a valid regex/,
    );
    expect(() => records.extractRecords({}, { fields: { x: { path: "t", match: 1 } } })).toThrow(
      "fields.x.match must be a regex string",
    );
  });
});
