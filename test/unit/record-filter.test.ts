import { describe, expect, it } from "vitest";

const {
  applyFilter,
  collectFilterFlags,
  parseFilter,
  takeRunFilter,
} = require("../../native/record-filter.cjs");

const books = [
  {
    title: "A Light in the Attic",
    price: "£51.77",
    rating: "star-rating Three",
    stock: { count: 22 },
  },
  { title: "Tipping the Velvet", price: "£53.74", rating: "star-rating One", stock: { count: 20 } },
  { title: "Soumission", price: "£50.10", rating: "star-rating One", stock: { count: 20 } },
];
const filter = (argv: string[]) => parseFilter(collectFilterFlags(argv));

describe("--where, --fields, --limit", () => {
  it("keeps the records that match every --where, then the first n, then the fields", () => {
    const { value, filter: summary } = applyFilter(
      books,
      filter([
        "--where",
        "rating~=one",
        "--where",
        "stock.count=20",
        "--fields",
        "title,stock.count",
        "--limit",
        "1",
      ]),
    );
    expect(value).toEqual([{ title: "Tipping the Velvet", stock: { count: 20 } }]);
    expect(summary).toEqual({
      where: ["rating~=one", "stock.count=20"],
      fields: ["title", "stock.count"],
      limit: 1,
      before: 3,
      after: 1,
    });
    expect(applyFilter(books, filter(["--where", "rating!=star-rating One"])).value).toHaveLength(
      1,
    );
  });

  it("keeps or drops a single record, and names the fields on a typo", () => {
    expect(applyFilter(books[0], filter(["--where", "price=£51.77"])).value).toEqual(books[0]);
    expect(applyFilter(books[0], filter(["--where", "price=£1"])).value).toBeNull();
    expect(() => applyFilter(books, filter(["--fields", "titel"]))).toThrow(
      '--fields: unknown field "titel". Fields: title, price, rating, stock, stock.count',
    );
    expect(() => filter(["--limit", "0"])).toThrow(/--limit must be a whole number/);
    expect(() => filter(["--where", "title"])).toThrow(/--where needs field=value/);
  });

  it("leaves a flag the op takes as an input to the op, and --limit to --each", () => {
    const args = { where: "x", limit: 2, page: 1 };
    const flags = collectFilterFlags(["--where", "title~=a", "--limit", "2"]);
    const taken = takeRunFilter({ flags, args, ops: [{ args: { where: {} } }] });
    expect(taken).toMatchObject({ where: [], limit: 2 });
    expect(args).toEqual({ where: "x", page: 1 });

    const each = { limit: 3 };
    expect(
      takeRunFilter({
        flags: collectFilterFlags(["--limit", "3"]),
        args: each,
        ops: [{}],
        each: "list:url",
      }),
    ).toBeUndefined();
    expect(each).toEqual({ limit: 3 });
  });
});
