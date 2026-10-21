import { describe, expect, it } from "vitest";

// @ts-expect-error - CommonJS module without type definitions
import * as format from "../../native/record-format.cjs";

const thread = [
  {
    author: "a",
    time: "t1",
    text: "hello\nworld",
    url: "https://x.test/1",
    media: ["https://img.test/1.jpg"],
    quoted: { author: "b", text: "quoted" },
  },
  { author: "a", time: "t2", text: "two", url: "https://x.test/2" },
];

describe("record format", () => {
  it("renders jsonl as one record per line", () => {
    const lines = format.formatRecords(thread, "jsonl").split("\n");
    expect(lines.map((line: string) => JSON.parse(line))).toEqual(thread);
  });

  it("renders markdown from the op's markdown spec", () => {
    const markdown = {
      title: "{{kind}} by @{{author}}",
      heading: "@{{author}} · {{time}}",
      link: "{{url}}",
      body: "text",
      quote: "quoted",
      images: "media",
    };
    expect(format.formatRecords(thread, "md", { markdown, args: { kind: "Thread" } })).toBe(
      [
        "# Thread by @a",
        "",
        "## 1/2 · @a · t1",
        "",
        "https://x.test/1",
        "",
        "hello",
        "world",
        "",
        "> **@b ·**",
        ">",
        "> quoted",
        "",
        "![image](https://img.test/1.jpg)",
        "",
        "## 2/2 · @a · t2",
        "",
        "https://x.test/2",
        "",
        "two",
      ].join("\n"),
    );
  });

  it("renders generic markdown without a spec and rejects non-list values", () => {
    expect(format.formatRecords([{ id: "1", tags: ["x"] }], "md")).toBe(
      '## 1/1\n\n- **id:** 1\n- **tags:** ["x"]',
    );
    expect(() => format.formatRecords({ id: "1" }, "md")).toThrow(/needs a list of records/);
    expect(() => format.formatRecords(thread, "md", { markdown: { color: "red" } })).toThrow(
      /unknown key "color"/,
    );
  });
});
