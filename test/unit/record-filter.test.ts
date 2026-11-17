import { afterEach, describe, expect, it, vi } from "vitest";

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const { applyFilter, collectFilterFlags, parseFilter } = require("../../native/record-filter.cjs");
const { handlePlaybookCli } = require("../../native/playbook-cli.cjs");
const { createFrameParser } = require("../../native/remote-transport.cjs");
const assertions = require("../../native/playbook-assertions.cjs");
const pbTest = require("../../native/playbook-test.cjs");

const books = [
  {
    title: "A Light in the Attic",
    price: "£51.77",
    star_rating: "Three",
    stock: { count: 22, shelf: "A" },
  },
  {
    title: "Tipping the Velvet",
    price: "£53.74",
    star_rating: "One",
    stock: { count: 20, shelf: "B" },
  },
  { title: "Soumission", price: "£50.10", star_rating: "One", stock: { count: 20, shelf: "A" } },
  {
    title: "Sharp Objects",
    price: "£47.82",
    star_rating: "Four",
    stock: { count: 20, shelf: "C" },
  },
  { title: "Sapiens", price: "£54.23", star_rating: " three ", stock: { count: 20, shelf: "A" } },
];

const filter = (flags: { where?: string[]; fields?: string; limit?: string | number }) =>
  parseFilter({ where: [], ...flags });

const tempDirs: string[] = [];
const servers: { close(callback: () => void): void }[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("record filters", () => {
  it("keeps records where a field equals, differs from or contains a value, trimmed", () => {
    expect(
      applyFilter(books, filter({ where: ["star_rating=One"] })).value.map((b: any) => b.title),
    ).toEqual(["Tipping the Velvet", "Soumission"]);
    expect(applyFilter(books, filter({ where: ["star_rating != One"] })).value).toHaveLength(3);
    // ~= is a case-insensitive contains; both sides are trimmed first.
    expect(
      applyFilter(books, filter({ where: ["star_rating~=three"] })).value.map((b: any) => b.title),
    ).toEqual(["A Light in the Attic", "Sapiens"]);
    expect(
      applyFilter(books, filter({ where: ["star_rating=three"] })).value.map((b: any) => b.title),
    ).toEqual(["Sapiens"]);
  });

  it("reads dotted paths, compares numbers as text, and needs every --where to match", () => {
    expect(applyFilter(books, filter({ where: ["stock.count=20"] })).value).toHaveLength(4);
    const both = applyFilter(books, filter({ where: ["stock.count=20", "stock.shelf=A"] }));
    expect(both.value.map((b: any) => b.title)).toEqual(["Soumission", "Sapiens"]);
    expect(both.filter).toEqual({
      where: ["stock.count=20", "stock.shelf=A"],
      fields: null,
      limit: null,
      before: 5,
      after: 2,
    });
  });

  it("keeps only --fields, dotted ones as nested objects", () => {
    expect(applyFilter(books.slice(0, 2), filter({ fields: "title,stock.shelf" })).value).toEqual([
      { title: "A Light in the Attic", stock: { shelf: "A" } },
      { title: "Tipping the Velvet", stock: { shelf: "B" } },
    ]);
    // A whole object and one of its fields: the whole object wins.
    expect(applyFilter(books.slice(0, 1), filter({ fields: "stock.count, stock" })).value).toEqual([
      { stock: { count: 22, shelf: "A" } },
    ]);
  });

  it("keeps the first --limit records after --where", () => {
    const result = applyFilter(
      books,
      filter({ where: ["stock.shelf=A"], fields: "title", limit: 2 }),
    );
    expect(result.value).toEqual([{ title: "A Light in the Attic" }, { title: "Soumission" }]);
    expect(result.filter).toEqual({
      where: ["stock.shelf=A"],
      fields: ["title"],
      limit: 2,
      before: 5,
      after: 2,
    });
  });

  it("fails on an unknown field, listing the first record's fields with nested ones dotted", () => {
    const valid = "title, price, star_rating, stock, stock.count, stock.shelf";
    expect(() => applyFilter(books, filter({ where: ["rating=Three"] }))).toThrow(
      `--where: unknown field "rating". Fields: ${valid}`,
    );
    expect(() => applyFilter(books, filter({ fields: "title,stock.aisle" }))).toThrow(
      `--fields: unknown field "stock.aisle". Fields: ${valid}`,
    );
  });

  it("filters a single object to itself or null", () => {
    const one = books[0];
    expect(applyFilter(one, filter({ where: ["star_rating=Three"], fields: "title" }))).toEqual({
      value: { title: "A Light in the Attic" },
      filter: { where: ["star_rating=Three"], fields: ["title"], limit: null, before: 1, after: 1 },
    });
    expect(applyFilter(one, filter({ where: ["star_rating=One"] }))).toMatchObject({
      value: null,
      filter: { before: 1, after: 0 },
    });
  });

  it("refuses malformed flags and values that hold no records", () => {
    expect(() => filter({ where: ["title"] })).toThrow(
      /--where needs field=value, field!=value or field~=text/,
    );
    expect(() => filter({ where: ["=x"] })).toThrow(/--where needs a field/);
    expect(() => filter({ fields: " , " })).toThrow(/--fields needs/);
    expect(() => filter({ limit: "0" })).toThrow(/--limit must be a whole number of 1 or more/);
    expect(() => filter({ limit: "2.5" })).toThrow(/--limit must be a whole number/);
    expect(() => applyFilter("text", filter({ limit: 1 }))).toThrow(/work on records/);
    expect(() => applyFilter(["a", "b"], filter({ fields: "title" }))).toThrow(
      /records that are objects/,
    );
  });

  it("collects every --where, the last --fields and --limit, and refuses a missing value", () => {
    expect(
      collectFilterFlags([
        "books",
        "list",
        "--where",
        "a=1",
        "--page",
        "2",
        "--where",
        "b!=2",
        "--fields",
        "a",
        "--limit",
        "3",
      ]),
    ).toEqual({ where: ["a=1", "b!=2"], fields: "a", limit: "3" });
    expect(collectFilterFlags(["books", "list"])).toEqual({ where: [] });
    expect(() => collectFilterFlags(["books", "list", "--where"])).toThrow(/--where needs a value/);
  });
});

function project(ops: Record<string, unknown>[]) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "surf-filter-"));
  tempDirs.push(cwd);
  const directory = path.join(cwd, ".surf", "playbooks", "books");
  fs.mkdirSync(path.join(directory, "ops"), { recursive: true });
  fs.writeFileSync(
    path.join(directory, "playbook.json"),
    JSON.stringify({ id: "books", version: "1.0.0" }),
  );
  for (const op of ops) {
    fs.writeFileSync(path.join(directory, "ops", `${op.id}.json`), JSON.stringify(op));
  }
  return cwd;
}

const network = { using: "network", request: { method: "GET", url: "https://books.test/" } };
const listOp = {
  id: "list_books",
  effect: "read",
  args: { page: { type: "number", default: 1 } },
  run: [network],
};
const limitedOp = {
  id: "top_books",
  effect: "read",
  args: { limit: { type: "number", default: 10 } },
  run: [network],
};
const detailOp = {
  id: "get_book",
  effect: "read",
  args: { book: { type: "string", required: true } },
  run: [network],
};

/** A host that answers every playbook.run with `value` and keeps the args it was sent. */
async function fakeHost(value: unknown) {
  const sent: Record<string, any>[] = [];
  const server = net.createServer((socket: any) => {
    const parser = createFrameParser({
      onFrame: (message: Record<string, any>) => {
        sent.push(message.params.args);
        const result = {
          status: "completed",
          playbook: "books",
          op: message.params.args.op,
          strategy: "network",
          value,
          attempts: [],
        };
        socket.write(
          `${JSON.stringify({ type: "tool_response", id: message.id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } })}\n`,
        );
      },
      onError: () => socket.destroy(),
    });
    socket.on("data", (chunk: unknown) => parser.push(chunk));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = {
    kind: "local",
    connectionOptions: { host: "127.0.0.1", port: server.address().port },
  };
  return { endpoint, sent };
}

describe("surf use filters", () => {
  it("filters the records it prints and adds a filter summary, sending no filter to the op", async () => {
    const cwd = project([listOp]);
    const { endpoint, sent } = await fakeHost(books);
    const result = await handlePlaybookCli(
      [
        "use",
        "books",
        "list_books",
        "--page",
        "2",
        "--where",
        "star_rating~=three",
        "--where",
        "stock.shelf=A",
        "--fields",
        "title,stock.count",
        "--limit",
        "1",
        "--json",
      ],
      { endpoint, cwd },
    );
    expect(sent[0].args).toEqual({ page: 2 });
    expect(result.json).toBe(true);
    expect(result.value).toMatchObject({
      status: "completed",
      value: [{ title: "A Light in the Attic", stock: { count: 22 } }],
      filter: {
        where: ["star_rating~=three", "stock.shelf=A"],
        fields: ["title", "stock.count"],
        limit: 1,
        before: 5,
        after: 1,
      },
    });
  });

  it("fails listing the valid fields when a --where field is unknown", async () => {
    const cwd = project([listOp]);
    const { endpoint } = await fakeHost(books);
    await expect(
      handlePlaybookCli(["use", "books", "list_books", "--where", "rating=Three"], {
        endpoint,
        cwd,
      }),
    ).rejects.toThrow(
      /--where: unknown field "rating"\. Fields: title, price, star_rating, stock, stock\.count, stock\.shelf/,
    );
  });

  it("gives --limit to an op that has a limit input and applies no record limit", async () => {
    const cwd = project([limitedOp]);
    const { endpoint, sent } = await fakeHost(books);
    const result = await handlePlaybookCli(
      ["use", "books", "top_books", "--limit", "2", "--where", "stock.shelf=A", "--json"],
      { endpoint, cwd },
    );
    expect(sent[0].args).toEqual({ limit: 2 });
    expect(result.value.value).toHaveLength(3);
    expect(result.value.filter).toMatchObject({ limit: null, before: 5, after: 3 });
  });

  it("keeps --limit as the --each-from bound and applies no record limit", async () => {
    const cwd = project([listOp, detailOp]);
    const { endpoint, sent } = await fakeHost(books);
    const result = await handlePlaybookCli(
      [
        "use",
        "books",
        "get_book",
        "--each-from",
        "list_books:url@path.2",
        "--limit",
        "2",
        "--fields",
        "title",
        "--json",
      ],
      { endpoint, cwd },
    );
    expect(sent[0].eachFrom).toMatchObject({ op: "list_books", limit: 2 });
    expect(sent[0].args).toEqual({});
    expect(result.value.value).toHaveLength(5);
    expect(result.value.filter).toMatchObject({ fields: ["title"], limit: null, after: 5 });
  });

  it("leaves output alone without filters and refuses them with --format or --dry-run", async () => {
    const cwd = project([listOp]);
    const { endpoint, sent } = await fakeHost(books);
    const plain = await handlePlaybookCli(["use", "books", "list_books", "--json"], {
      endpoint,
      cwd,
    });
    expect(plain.value.value).toEqual(books);
    expect(plain.value).not.toHaveProperty("filter");
    await expect(
      handlePlaybookCli(["use", "books", "list_books", "--limit", "1", "--format", "md"], {
        endpoint,
        cwd,
      }),
    ).rejects.toThrow(/--where, --fields and --limit don't combine with --format/);
    await expect(
      handlePlaybookCli(["use", "books", "list_books", "--fields", "title", "--dry-run"], {
        endpoint,
        cwd,
      }),
    ).rejects.toThrow(/--dry-run/);
    expect(sent).toHaveLength(1);
  });
});

describe("pb test filters", () => {
  /** Answers like the host: checks the assertions it was sent on the whole value. */
  const runOp = vi.fn(async (params: Record<string, any>) => {
    const checked = assertions.checkAssertions(books, params.assert || []);
    const ok = checked.every((assertion: any) => assertion.pass);
    return ok
      ? {
          status: "completed",
          playbook: "books",
          op: params.op,
          strategy: "network",
          value: books,
          assertions: checked,
          attempts: [],
        }
      : {
          status: "failed",
          playbook: "books",
          op: params.op,
          error: "All strategies failed",
          attempts: [{ using: "network", error: "assertion failed", assertions: checked }],
        };
  });

  it("prints filtered records while assertions check the unfiltered result", async () => {
    const cwd = project([listOp]);
    const report = await pbTest.runPlaybookTest({
      argv: [
        "books",
        "list_books",
        "--assert",
        "$",
        "array_min_len",
        "5",
        "--where",
        "star_rating=One",
        "--fields",
        "title",
        "--limit",
        "1",
      ],
      cwd,
      home: cwd,
      runOp,
      now: () => 0,
    });
    expect(runOp.mock.calls.at(-1)?.[0].args).toEqual({});
    expect(report).toMatchObject({
      ok: true,
      records: 5,
      value: [{ title: "Tipping the Velvet" }],
      filter: { where: ["star_rating=One"], fields: ["title"], limit: 1, before: 5, after: 1 },
    });
    expect(pbTest.formatTestReport(report)).toBe(
      [
        "PASS books list_books: network answered, 5 records, 0 ms",
        "  pass  $ array_min_len 5 (array(5))",
        "Filtered: 1 of 5 records (--where star_rating=One --fields title --limit 1)",
        JSON.stringify([{ title: "Tipping the Velvet" }], null, 2),
      ].join("\n"),
    );
  });

  it("can't make a failing assertion pass by filtering the records it would check", async () => {
    const cwd = project([listOp]);
    // Filtered, $[0] would be Tipping the Velvet; the assertion still sees the whole list.
    const report = await pbTest.runPlaybookTest({
      argv: [
        "books",
        "list_books",
        "--assert",
        "$[0].title",
        "equals",
        "Tipping the Velvet",
        "--where",
        "star_rating=One",
      ],
      cwd,
      home: cwd,
      runOp,
      now: () => 0,
    });
    expect(report.ok).toBe(false);
    expect(report.assertions[0]).toMatchObject({ pass: false, actual: "A Light in the Attic" });
    expect(report).not.toHaveProperty("value");
  });

  it("gives --limit to an op that has a limit input", async () => {
    const cwd = project([limitedOp]);
    const report = await pbTest.runPlaybookTest({
      argv: ["books", "top_books", "--limit", "2", "--fields", "title"],
      cwd,
      home: cwd,
      runOp,
      now: () => 0,
    });
    expect(runOp.mock.calls.at(-1)?.[0].args).toEqual({ limit: "2" });
    expect(report.filter).toMatchObject({ limit: null, after: 5 });
  });
});
