import { afterEach, describe, expect, it } from "vitest";

const http = require("node:http");

const { dryRunOp, runOp } = require("../../native/op-run.cjs");
const { validateOp } = require("../../native/playbooks.cjs");
const { resolveArgs } = require("../../native/playbook-runtime.cjs");

const playbook = { id: "site", provenance: { scope: "test" } };
type Seen = { url: string; cookie?: string; agent?: string };
type Handler = (url: string, res: Res) => void;
type Res = {
  writeHead(status: number, headers?: Record<string, string>): void;
  end(body?: string): void;
};
const servers: { close: () => void }[] = [];

// A local site: each request is noted, and `handler` answers it.
async function serve(handler: Handler) {
  const seen: Seen[] = [];
  const server = http.createServer(
    (req: { url: string; headers: Record<string, string> }, res: Res) => {
      seen.push({ url: req.url, cookie: req.headers.cookie, agent: req.headers["user-agent"] });
      handler(req.url, res);
    },
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return { origin: `http://127.0.0.1:${server.address().port}`, seen };
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
});

const json =
  (status: number, body: unknown): Handler =>
  (_url, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

// The browser's cookies as the extension reads them; `asked` holds each URL they were read for.
function browser(fail = false) {
  const asked: string[] = [];
  const readCookies = async (url: string) => {
    asked.push(url);
    if (fail) {
      throw new Error("Unhandled message: GET_DIRECT_REQUEST_CONTEXT");
    }
    return {
      cookies: [
        { name: "sid", value: "abc" },
        { name: "k", value: "v" },
      ],
      userAgent: "Chrome/Test",
    };
  };
  return { asked, readCookies };
}

// A tab that answers every request script with one record.
function tab() {
  const codes: string[] = [];
  const executeTool = async (_tool: string, args: { code: string }) => {
    codes.push(args.code);
    const body = JSON.stringify({ items: [{ title: "from the tab" }] });
    return {
      output: JSON.stringify({ status: 200, url: "", contentType: "application/json", body }),
    };
  };
  return { codes, executeTool };
}

const listOp = (origin: string, extra: Record<string, unknown> = {}) => ({
  id: "list",
  args: { page: { default: 1 } },
  request: { url: `${origin}/items?page={{page}}` },
  extract: { records: "$.items", fields: { title: "title" } },
  expect: { minItems: 1, fields: ["title"] },
  ...extra,
});

function run(
  op: Record<string, unknown>,
  cookies: ReturnType<typeof browser>,
  page: ReturnType<typeof tab>,
  extra = {},
) {
  const valid = validateOp(op, {});
  return runOp({
    playbook,
    op: valid,
    args: resolveArgs(valid, {}),
    readCookies: cookies.readCookies,
    executeTool: page.executeTool,
    sleep: () => Promise.resolve(),
    ...extra,
  });
}

describe("the direct step", () => {
  it("sends a read from the host with the browser's cookies for its URL", async () => {
    const site = await serve(json(200, { items: [{ title: "Direct" }] }));
    const cookies = browser();
    const page = tab();
    const result = await run(listOp(site.origin), cookies, page);
    expect(result).toMatchObject({ via: "direct", value: [{ title: "Direct" }], attempts: [] });
    expect(site.seen).toEqual([
      { url: "/items?page=1", cookie: "sid=abc; k=v", agent: "Chrome/Test" },
    ]);
    expect(cookies.asked).toEqual([`${site.origin}/items?page=1`]);
    expect(page.codes).toEqual([]);
  });

  it("falls to the tab when a 200 page reads no records, even with no expect", async () => {
    for (const body of [{ items: [] }, { items: [{ title: "" }, { title: "x" }] }]) {
      const site = await serve(json(200, body));
      const result = await run(listOp(site.origin, { expect: undefined }), browser(), tab());
      expect(result).toMatchObject({ via: "tab", value: [{ title: "from the tab" }] });
      expect(result.attempts).toEqual([{ via: "direct", error: "read no records" }]);
    }
  });

  it("falls to the tab when the site doesn't answer in time", async () => {
    const site = await serve(() => {
      // Never answers.
    });
    const result = await run(listOp(site.origin), browser(), tab(), { directTimeoutMs: 50 });
    expect(result.via).toBe("tab");
    expect(result.attempts[0].error).toBe("no answer within 0.05 s");
  });

  it("falls to the tab on a 403", async () => {
    const site = await serve(json(403, { error: "blocked" }));
    const page = tab();
    const result = await run(listOp(site.origin), browser(), page);
    expect(result).toMatchObject({ via: "tab", value: [{ title: "from the tab" }] });
    expect(result.attempts).toEqual([{ via: "direct", error: "status 403" }]);
    expect(page.codes).toHaveLength(1);
  });

  it("falls to the tab when the response fails expect", async () => {
    const site = await serve(json(200, { items: [] }));
    const result = await run(listOp(site.origin), browser(), tab());
    expect(result.via).toBe("tab");
    expect(result.attempts[0]).toMatchObject({
      via: "direct",
      error: "expected at least 1 records, got 0",
    });
  });

  it("never sends to another origin: a redirect goes to the tab, --url elsewhere is refused", async () => {
    const other = await serve(json(200, { items: [{ title: "elsewhere" }] }));
    const site = await serve((_url, res) => {
      res.writeHead(302, { location: `${other.origin}/items` });
      res.end();
    });
    const result = await run(listOp(site.origin), browser(), tab());
    expect(result.via).toBe("tab");
    expect(result.attempts[0].error).toMatch(/redirected \(302\)/);
    expect(other.seen).toEqual([]);

    const cookies = browser();
    await expect(
      run(listOp(site.origin), cookies, tab(), { url: `${other.origin}/items` }),
    ).rejects.toThrow(/is not this op's site/);
    expect(cookies.asked).toEqual([]);
    expect(other.seen).toEqual([]);
  });

  it("sends nothing from the host when the cookies can't be read", async () => {
    const site = await serve(json(200, { items: [{ title: "Direct" }] }));
    const result = await run(listOp(site.origin), browser(true), tab());
    expect(result.via).toBe("tab");
    expect(site.seen).toEqual([]);
  });

  it("leaves a write to the tab, and dry-runs show the direct step first", async () => {
    const site = await serve(json(200, { items: [{ title: "Direct" }] }));
    const write = listOp(site.origin, {
      effect: "write",
      request: { method: "POST", url: `${site.origin}/items` },
      safety: { duplicate: "transactional", key: ["page"] },
    });
    const cookies = browser();
    const result = await run(write, cookies, tab());
    expect(result.via).toBe("tab");
    expect(cookies.asked).toEqual([]);
    expect(site.seen).toEqual([]);

    const read = validateOp(listOp(site.origin), {});
    expect(dryRunOp({ playbook, op: read, args: { page: 2 } })).toMatchObject({
      via: "direct",
      fallback: ["tab"],
      request: { url: `${site.origin}/items?page=2` },
    });
    expect(dryRunOp({ playbook, op: validateOp(write, {}), args: { page: 2 } })).toMatchObject({
      via: "tab",
    });
  });
});
