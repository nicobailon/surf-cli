import { afterEach, describe, expect, it } from "vitest";

const http = require("node:http");

const { eachChain, runChain } = require("../../native/op-chain.cjs");
const { validateOp } = require("../../native/playbooks.cjs");
const { resolveArgs } = require("../../native/playbook-runtime.cjs");

type Res = {
  writeHead(status: number, headers?: Record<string, string>): void;
  end(body?: string): void;
};
const servers: { close: () => void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
});

// A shop of 3 list pages, 2 items each, and a detail page per item. `seen` lists each path asked for.
async function shop() {
  const seen: string[] = [];
  let origin = "";
  const server = http.createServer((req: { url: string }, res: Res) => {
    seen.push(req.url);
    const page = Number(req.url.match(/page=(\d+)/)?.[1] ?? 0);
    const item = req.url.match(/^\/item\/(\d+)$/)?.[1];
    const body = item
      ? { name: `Item ${item}` }
      : {
          items:
            page > 3
              ? []
              : [1, 2].map((n) => ({
                  url: `${origin}/item/${(page - 1) * 2 + n}`,
                  path: `/item/${(page - 1) * 2 + n}`,
                  slug: `s${n}`,
                })),
        };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  origin = `http://127.0.0.1:${server.address().port}`;
  const ops = [
    {
      id: "list_items",
      args: { page: { default: 1 } },
      request: { url: `${origin}/list?page={{page}}` },
      extract: { records: "$.items", fields: { url: "url", slug: "slug" } },
      page: { into: "page", next: "+1" },
      expect: { minItems: 1 },
    },
    {
      id: "list_limited",
      args: { page: { default: 1 }, limit: { default: 30 } },
      request: { url: `${origin}/list?page={{page}}&limit={{limit}}` },
      extract: { records: "$.items", fields: { path: "path" } },
    },
    {
      id: "get_item",
      args: { item_id: { required: true } },
      request: { url: `${origin}/item/{{item_id}}` },
      extract: { fields: { name: "name" } },
      expect: { fields: ["name"] },
    },
    {
      id: "items_with_details",
      args: { pages: { default: 2 }, limit: { default: 3 } },
      chain: [
        { id: "list", op: "list_items", with: { pages: "{{pages}}" } },
        {
          id: "item",
          op: "get_item",
          each: "list",
          limit: "{{limit}}",
          with: { url: "{{item.url}}" },
        },
      ],
    },
    {
      id: "first_item",
      chain: [
        { id: "list", op: "list_items" },
        { id: "first", op: "get_item", with: { url: "{{list[0].url}}" } },
      ],
    },
    {
      id: "by_slug",
      chain: [
        { id: "list", op: "list_items" },
        { id: "item", op: "get_item", each: "list", with: { url: "{{item.missing}}" } },
      ],
    },
    {
      id: "send",
      effect: "write",
      safety: { duplicate: "transactional", key: ["x"] },
      args: { x: {} },
      request: { method: "POST", url: `${origin}/send` },
    },
    { id: "nested", chain: [{ id: "inner", op: "first_item" }] },
    {
      id: "send_all",
      chain: [
        { id: "list", op: "list_items" },
        { id: "send", op: "send", each: "list" },
      ],
    },
  ].map((op) => validateOp(op, {}));
  const playbook = { id: "shop", ops: new Map(ops.map((op) => [op.id, op])) };
  return { origin, seen, playbook };
}

async function run(site: Awaited<ReturnType<typeof shop>>, op: Record<string, unknown>, args = {}) {
  const sleeps: number[] = [];
  const result = await runChain({
    playbook: site.playbook,
    op,
    args: resolveArgs(op, args),
    readCookies: async () => ({ cookies: [] }),
    executeTool: async () => {
      throw new Error("no tab in this test");
    },
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
  });
  return { result, sleeps };
}

describe("chains", () => {
  it("--each: --limit caps the loop only (10 by default), and a relative url resolves on the site", async () => {
    const site = await shop();
    const get = site.playbook.ops.get("get_item");
    const capped = await run(site, eachChain(site.playbook, get, "list_limited:path=url"), {
      limit: 1,
    });
    expect(site.seen).toEqual(["/list?page=1&limit=30", "/item/1"]);
    expect(capped.result.value).toEqual([{ name: "Item 1" }]);
    const op = eachChain(site.playbook, get, "list_limited:path=url");
    expect(op.chain[0].with).not.toHaveProperty("limit");
    expect(resolveArgs(op, {}).limit).toBeUndefined();
  });

  it("names a step or --each op that has no request or open", async () => {
    const site = await shop();
    await expect(run(site, site.playbook.ops.get("nested"))).rejects.toThrow(
      "chain nested step inner runs first_item, a chain op; a step runs an op with request or open",
    );
    expect(() =>
      eachChain(site.playbook, site.playbook.ops.get("get_item"), "first_item:url"),
    ).toThrow("--each runs first_item, a chain op; it needs an op with request or open");
  });

  it("pages the list op, then runs the detail op once per record up to limit", async () => {
    const site = await shop();
    const { result, sleeps } = await run(site, site.playbook.ops.get("items_with_details"));
    expect(site.seen).toEqual(["/list?page=1", "/list?page=2", "/item/1", "/item/2", "/item/3"]);
    expect(result).toMatchObject({ status: "completed", op: "items_with_details", via: "chain" });
    expect(result.value).toEqual([{ name: "Item 1" }, { name: "Item 2" }, { name: "Item 3" }]);
    expect(result.steps).toEqual([
      { id: "list", op: "list_items", runs: 1, via: "direct" },
      { id: "item", op: "get_item", runs: 3, via: "direct" },
    ]);
    // 1 s between pages and between each record's run.
    expect(sleeps).toEqual([1000, 1000, 1000]);
  });

  it("reads an earlier step's result with {{step.path}}", async () => {
    const site = await shop();
    const { result } = await run(site, site.playbook.ops.get("first_item"));
    expect(result.value).toEqual({ name: "Item 1" });
    expect(site.seen).toEqual(["/list?page=1", "/item/1"]);
  });

  it("--each runs an op per record of a list op, --pages going to the list", async () => {
    const site = await shop();
    const op = eachChain(site.playbook, site.playbook.ops.get("get_item"), "list_items:url");
    const { result } = await run(site, op, { page: 3, pages: 2, limit: 3 });
    expect(site.seen).toEqual(["/list?page=3", "/list?page=4", "/item/5", "/item/6"]);
    expect(result.value).toEqual([{ name: "Item 5" }, { name: "Item 6" }]);

    const named = eachChain(
      site.playbook,
      site.playbook.ops.get("get_item"),
      "list_items:slug=item_id",
    );
    expect(named.chain[1].with).toEqual({ item_id: "{{item.slug}}" });
    expect(() => eachChain(site.playbook, site.playbook.ops.get("get_item"), "nope:url")).toThrow(
      /has no op nope/,
    );
  });

  it("names the step and record that failed, and refuses a write step before sending", async () => {
    const site = await shop();
    await expect(run(site, site.playbook.ops.get("by_slug"))).rejects.toThrow(
      /chain by_slug step item \(get_item\), record 1: \{\{item\.missing\}\} has no value/,
    );
    const sent = site.seen.length;
    await expect(run(site, site.playbook.ops.get("send_all"))).rejects.toThrow(
      /step send runs a write op/,
    );
    expect(site.seen).toHaveLength(sent);
    expect(() => validateOp({ id: "c", chain: [{ id: "a", op: "b", from: "x" }] }, {})).toThrow(
      'op c chain step a has unknown key "from"',
    );
  });
});
