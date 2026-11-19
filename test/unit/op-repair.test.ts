import { describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { runWithRepair } = require("../../native/op-pipeline.cjs");
const { runOp } = require("../../native/op-run.cjs");
const { resolveOp } = require("../../native/playbooks.cjs");

const oldPage = fs.readFileSync(
  path.join("test", "fixtures", "sites", "books-page-1.html"),
  "utf8",
);
// The same page after a redesign: new class names for the item and its price.
const newPage = oldPage
  .replaceAll("product_pod", "product_card")
  .replaceAll("price_color", "price_now");
const site = `books-${process.pid}`;
const url = "https://books.toscrape.com/catalogue/page-{{page}}.html";
const page = "https://books.toscrape.com/catalogue/page-2.html";
const listBooks = {
  id: "list_books",
  description: "books with prices",
  args: { page: { default: 1 } },
  request: { url },
  extract: {
    records: "article.product_pod",
    fields: { name: "h3 a@title", link: "h3 a@href", price: ".price_color" },
  },
  expect: { minItems: 1, fields: ["name", "link"] },
  source: { url, goal: "books with prices" },
};

// A project playbook holding `op`, and a fake tab on a site that now answers `reply`.
function setup(op: Record<string, unknown>, reply: { status: number; body: string }) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "surf-repair-"));
  const dir = path.join(cwd, ".surf", "playbooks", site);
  fs.mkdirSync(path.join(dir, "ops"), { recursive: true });
  fs.writeFileSync(path.join(dir, "playbook.json"), JSON.stringify({ id: site, version: "1.0.0" }));
  const file = path.join(dir, "ops", "list_books.json");
  fs.writeFileSync(file, JSON.stringify(op));
  const { playbook, op: loaded } = resolveOp(site, "list_books", { cwd });
  const captures: string[] = [];
  const executeTool = async (tool: string, args: { code?: string }) => {
    if (tool !== "javascript_tool") {
      return { success: true };
    }
    if (String(args.code).includes("innerText")) {
      return { output: JSON.stringify({ url: page, text: "A Light in the Attic" }) };
    }
    const sent = JSON.parse(String(args.code).match(/new URL\(("[^"]*")\)/)?.[1] ?? '""');
    return { output: JSON.stringify({ url: sent, contentType: "text/html", ...reply }) };
  };
  const callExtension = async (message: { type: string }) => {
    captures.push(message.type);
    const entry = {
      id: "r1",
      method: "GET",
      status: 200,
      type: "Document",
      mimeType: "text/html",
      url: page,
      ts: Date.now(),
      requestHeaders: {},
      responseBody: reply.body,
    };
    return message.type === "READ_NETWORK_REQUESTS" ? { entries: [entry] } : {};
  };
  const context = { executeTool, callExtension, sleep: () => Promise.resolve(), tabId: 1 };
  const run = (target: unknown) => runOp({ playbook, op: target, args: { page: 2 }, ...context });
  const repair = (extra: Record<string, unknown> = {}) =>
    runWithRepair({ run, playbook, op: loaded, args: { page: 2 }, ...context, ...extra });
  const saved = () => JSON.parse(fs.readFileSync(file, "utf8"));
  return { file, captures, repair, saved };
}

describe("self-repair", () => {
  it("rebuilds an op the site changed under, keeps its field names where it can and a .bak", async () => {
    const { file, repair, saved } = setup(listBooks, { status: 200, body: newPage });
    const result = await repair();
    expect(result.via).toBe("tab");
    expect(result.value).toHaveLength(3);
    expect(result.value[0]).toMatchObject({
      name: "A Light in the Attic",
      link: expect.stringContaining("a-light-in-the-attic"),
    });
    expect(result.repaired).toBe(
      `repaired ${site} list_books: records article.product_pod → article.product_card; fields -price, +star_rating, +price_now (the old op is list_books.json.bak)`,
    );
    expect(saved()).toMatchObject({
      args: { page: { default: 1 } },
      extract: {
        records: "article.product_card",
        fields: { name: "h3 a@title", link: "h3 a@href", price_now: ".price_now" },
      },
      expect: listBooks.expect,
      source: listBooks.source,
    });
    expect(JSON.parse(fs.readFileSync(`${file}.bak`, "utf8"))).toEqual(listBooks);
  });

  it("changes nothing on a 503, and names the rerun command when it can't rebuild", async () => {
    const down = setup(listBooks, { status: 503, body: "" });
    await expect(down.repair()).rejects.toThrow(/tab: status 503/);
    expect(down.captures).toEqual([]);
    expect(down.saved()).toEqual(listBooks);

    // The item's heading moved, so no new field reads the name the op's expect needs.
    const moved = setup(listBooks, { status: 200, body: newPage.replaceAll("h3>", "h2>") });
    await expect(moved.repair()).rejects.toThrow(
      `; repair failed: All steps failed (tab: expected field name in the first record). Rebuild it: surf hook https://books.toscrape.com/catalogue/page-{{page}}.html --goal 'books with prices' --page 2 --as ${site}/list_books`,
    );
    expect(moved.saved()).toEqual(listBooks);
    expect(fs.existsSync(`${moved.file}.bak`)).toBe(false);
  });

  it("never repairs a write or a run with --no-repair", async () => {
    const write = setup({ ...listBooks, effect: "write" }, { status: 200, body: newPage });
    await expect(write.repair()).rejects.toThrow(/^expected at least 1 records, got 0$/);
    expect(write.captures).toEqual([]);

    const off = setup(listBooks, { status: 200, body: newPage });
    await expect(off.repair({ noRepair: "--no-repair" })).rejects.toThrow(
      `expected at least 1 records, got 0); ${site} list_books no longer matches the site, not repaired (--no-repair). Rebuild it: surf hook`,
    );
    expect(off.captures).toEqual([]);
    expect(off.saved()).toEqual(listBooks);
  });
});

describe("saved-ops hint", () => {
  it("groups ops by playbook and caps the line at five", () => {
    const { formatSavedOps } = require("../../native/saved-ops-notice.cjs");
    const op = (playbook: string, name: string, inputs: string[] = []) => ({
      playbook,
      op: name,
      inputs,
    });
    expect(
      formatSavedOps({
        ops: [op("books", "list_books", ["page"]), op("books", "get_book", ["catalogue_id"])],
      }),
    ).toBe("saved: books list_books --page, get_book --catalogue_id");
    const many = ["a", "b", "c", "d", "e", "f", "g"].map((name) => op("shelf", name));
    expect(formatSavedOps({ ops: many })).toBe(
      "saved: shelf a, b, c, d, e +2 more: surf pb ops shelf",
    );
  });
});
