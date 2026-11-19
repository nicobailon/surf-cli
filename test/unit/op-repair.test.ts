import { describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { parseHookArgs, formatHook } = require("../../native/hook-cli.cjs");
const { makeOp, runWithRepair, save } = require("../../native/op-pipeline.cjs");
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
  args: { page: { default: 1, example: 2 } },
  request: { url },
  extract: {
    records: "article.product_pod",
    fields: { name: "h3 a@title", link: "h3 a@href", price: ".price_color" },
  },
  expect: { minItems: 1, fields: ["name", "link"] },
  source: { url, goal: "books with prices" },
};

// A project playbook holding `op`, and a fake tab on a site that now answers `reply`.
type Reply = { status: number; body: string };
function setup(
  op: Record<string, unknown>,
  answer: Reply | ((url: string) => Reply),
  today: Record<string, unknown> = { page: 2 },
) {
  const reply = (sent: string) => (typeof answer === "function" ? answer(sent) : answer);
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
    return { output: JSON.stringify({ url: sent, contentType: "text/html", ...reply(sent) }) };
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
      responseBody: reply(page).body,
    };
    return message.type === "READ_NETWORK_REQUESTS" ? { entries: [entry] } : {};
  };
  const context = { executeTool, callExtension, sleep: () => Promise.resolve(), tabId: 1 };
  const run = (target: unknown, args = today) => runOp({ playbook, op: target, args, ...context });
  const repair = (extra: Record<string, unknown> = {}) =>
    runWithRepair({ run, playbook, op: loaded, args: today, ...context, ...extra });
  const saved = () => JSON.parse(fs.readFileSync(file, "utf8"));
  return { cwd, file, captures, repair, saved };
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
      args: { page: { default: 1, example: 2 } },
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
      `; repair failed: All steps failed (tab: expected field name in the first record). Rebuild it: surf hook 'https://books.toscrape.com/catalogue/page-{{page}}.html' --goal 'books with prices' --page 2 --as ${site}/list_books`,
    );
    expect(moved.saved()).toEqual(listBooks);
    expect(fs.existsSync(`${moved.file}.bak`)).toBe(false);
  });

  it("leaves a working op alone when today's call has no records, or used --url", async () => {
    // Page 99 is past the end: a 200 page with only nav links. The saved sample, page 2, has books.
    const nav =
      "<html><body><nav><a href='/'>Home</a> <a href='/about'>About</a></nav></body></html>";
    const answer = (sent: string) => ({
      status: 200,
      body: sent.includes("page-99") ? nav : oldPage,
    });
    const empty = setup(listBooks, answer, { page: 99 });
    await expect(empty.repair()).rejects.toThrow(
      "got 0); with its saved inputs (--page 2) it still reads records, so it was not repaired",
    );
    expect(empty.captures).toEqual([]);
    expect(empty.saved()).toEqual(listBooks);

    const elsewhere = setup(listBooks, { status: 200, body: newPage });
    const other = "https://books.toscrape.com/catalogue/page-5.html";
    await expect(elsewhere.repair({ url: other })).rejects.toThrow(
      /^All steps failed \(tab: expected/,
    );
    expect(elsewhere.captures).toEqual([]);
    expect(elsewhere.saved()).toEqual(listBooks);
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

describe("surf hook's rebuild line and saves", () => {
  // The words of a shell line as shell() quotes them.
  const words = (line: string) =>
    [...line.matchAll(/'((?:[^']|'\\'')*)'|(\S+)/g)].map(
      (match) => match[2] ?? match[1].replaceAll("'\\''", "'"),
    );

  it("parses the rebuild line of an op with an input named like a surf use option", async () => {
    const op = { ...listBooks, args: { ...listBooks.args, limit: { default: 20, example: 20 } } };
    const off = setup(op, { status: 200, body: newPage });
    const error = await off.repair({ noRepair: "--no-repair" }).catch((failure: Error) => failure);
    const line = String(error.message).split("Rebuild it: ")[1];
    expect(line).toContain("--limit 20");
    const parsed = parseHookArgs(words(line).slice(2), { cwd: off.cwd });
    expect(parsed.spec.samples).toEqual({ page: "2", limit: "20" });
    // Without the op, --limit is still refused.
    expect(() => parseHookArgs(words(line).slice(2), { cwd: os.tmpdir() })).toThrow(
      /^--limit is a surf use option/,
    );
  });

  const home = () => String(process.env.HOME);
  const opPath = (where: string, id: string) =>
    path.join(home(), ".surf", "playbooks", where, "ops", `${id}.json`);
  const plant = (where: string, id: string, op: unknown, bak: unknown) => {
    fs.mkdirSync(path.dirname(opPath(where, id)), { recursive: true });
    fs.writeFileSync(opPath(where, id), JSON.stringify(op));
    fs.writeFileSync(`${opPath(where, id)}.bak`, JSON.stringify(bak));
  };

  it("touches neither the op nor its .bak when the new op fails validation", () => {
    const where = `bad-${process.pid}`;
    plant(where, "list_books", listBooks, { old: true });
    expect(() =>
      save(where, { id: "list_books", effect: "bogus", request: { url: page } }, false),
    ).toThrow(/effect must be read or write/);
    expect(JSON.parse(fs.readFileSync(opPath(where, "list_books"), "utf8"))).toEqual(listBooks);
    expect(JSON.parse(fs.readFileSync(`${opPath(where, "list_books")}.bak`, "utf8"))).toEqual({
      old: true,
    });
  });

  // A write's capture: the form page and its POST, sent at `postTs`; the --do steps started at 2000.
  const post = "https://httpbin.org/post";
  const writeCapture = (postTs: number) => ({
    pageUrl: "https://httpbin.org/forms/post",
    pageText: "custname Ada",
    after: 2000,
    entries: [
      {
        id: "r1",
        method: "GET",
        status: 200,
        type: "Document",
        mimeType: "text/html",
        url: "https://httpbin.org/forms/post",
        ts: 1000,
        requestHeaders: {},
        responseBody: "<html><body><form></form></body></html>",
      },
      {
        id: "r2",
        method: "POST",
        status: 200,
        type: "XHR",
        mimeType: "application/json",
        url: post,
        ts: postTs,
        requestHeaders: { "Content-Type": "application/x-www-form-urlencoded" },
        requestBody: "custname=Ada",
        responseBody: '{"form":{"custname":"Ada"}}',
      },
    ],
  });
  const hookWrite = (where: string, postTs: number, dryRun = false) =>
    makeOp({
      capture: writeCapture(postTs),
      goal: "send the order",
      typed: ["Ada"],
      match: "/post",
      site: where,
      op: "order",
      dryRun,
    }).then((result: unknown) => formatHook(result, []).stdout as string);

  it("says who sent a write: the --do steps only when it came after them", async () => {
    const where = `sent-${process.pid}`;
    expect(await hookWrite(where, 3000, true)).toMatch(
      /^test +not run: the --do steps sent it once;/m,
    );
    expect(await hookWrite(where, 1500, true)).toMatch(/^test +not run: the page sent it once;/m);
  });

  it("says when a replace overwrites an older .bak, in --dry-run too", async () => {
    const where = `slot-${process.pid}`;
    const ops = `~/.surf/playbooks/${where}/ops`;
    expect(await hookWrite(where, 3000, true)).toMatch(
      new RegExp(`^saved +nothing \\(--dry-run\\); the op would go to ${ops}/order\\.json$`, "m"),
    );
    const first = await hookWrite(where, 3000);
    expect(first).not.toMatch(/^replaced/m);
    const firstOp = JSON.parse(fs.readFileSync(opPath(where, "order"), "utf8"));
    expect(await hookWrite(where, 3000, true)).toMatch(
      new RegExp(`^saved +nothing \\(--dry-run\\); the op would replace ${ops}/order\\.json$`, "m"),
    );
    expect(await hookWrite(where, 3000)).toMatch(
      new RegExp(`^replaced ${where} order \\(the old op is order\\.json\\.bak\\)$`, "m"),
    );
    expect(await hookWrite(where, 3000, true)).toMatch(
      new RegExp(
        `^saved +nothing \\(--dry-run\\); the op would replace ${ops}/order\\.json \\(the older order\\.json\\.bak would be overwritten\\)$`,
        "m",
      ),
    );
    expect(await hookWrite(where, 3000)).toMatch(
      new RegExp(
        `^replaced ${where} order \\(the old op is order\\.json\\.bak; the older \\.bak is overwritten\\)$`,
        "m",
      ),
    );
    expect(JSON.parse(fs.readFileSync(`${opPath(where, "order")}.bak`, "utf8"))).toEqual(firstOp);
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
