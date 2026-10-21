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

  it("reads the cursor from the first matching object", () => {
    const cursor = {
      find: { equals: { cursorType: "Bottom" } },
      path: "value",
      into: "query.cursor",
    };
    expect(records.readCursor(page1, cursor)).toBe("c-1");
    expect(records.readCursor(page2, cursor)).toBeUndefined();
  });
});
