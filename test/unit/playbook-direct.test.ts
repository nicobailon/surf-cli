import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureTab } from "../fixtures/capture-tab";

const runtime = require("../../native/playbook-runtime.cjs");
const direct = require("../../native/playbook-direct.cjs");
const { formatDryRun } = require("../../native/playbook-cli.cjs");

const COOKIE = "sess-0f9c2a7b-live-cookie";
const playbook = { id: "shop", provenance: { scope: "test" } };

type Seen = { method: string; url: string; headers: http.IncomingHttpHeaders; body: string };
type Route = (request: Seen, response: http.ServerResponse) => void;

const servers: http.Server[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve(undefined));
        }),
    ),
  );
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A real HTTP server on 127.0.0.1; `seen` holds every request it got.
async function serve(route: Route) {
  const seen: Seen[] = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += String(chunk);
    });
    request.on("end", () => {
      const entry = {
        method: String(request.method),
        url: String(request.url),
        headers: request.headers,
        body,
      };
      seen.push(entry);
      route(entry, response);
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, port, seen };
}

function json(
  response: http.ServerResponse,
  status: number,
  value: unknown,
  headers: Record<string, string> = {},
) {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(value));
}

function stateDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "surf-direct-state-"));
  tempDirs.push(dir);
  return dir;
}

const browserContext = () =>
  vi.fn(async (_url: string) => ({
    cookies: [{ name: "session", value: COOKIE }],
    userAgent: "Mozilla/5.0 (DirectTest)",
  }));

function readOp(url: string, strategy: Record<string, unknown> = {}, more: Record<string, unknown> = {}) {
  return {
    id: "items",
    effect: "read",
    args: {},
    run: [{ using: "network", request: { method: "GET", url }, ...strategy }],
    ...more,
  };
}

// The tab answers with its own records, so a result says which tier gave it.
const tabAnswering = () =>
  captureTab({ reply: () => ({ body: JSON.stringify({ items: [{ id: "tab" }] }) }) });

function readTiers(root: string) {
  return JSON.parse(fs.readFileSync(path.join(root, direct.TIERS_FILE), "utf8"));
}

function filesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

describe("surf use direct tier", () => {
  it("answers a read from the host with the browser's live cookies, and reports tier direct", async () => {
    const server = await serve((_request, response) =>
      json(response, 200, { items: [{ id: 1 }, { id: 2 }] }),
    );
    const getContext = browserContext();
    const root = stateDir();
    const op = readOp(`${server.origin}/items`, { extract: { jsonPath: "$.items" } });
    const tab = tabAnswering();
    const result = await runtime.runPlaybookOp({
      playbook,
      op,
      executeTool: tab.executeTool,
      direct: direct.directTier({ playbook, op, getContext, root }),
    });

    expect(result).toMatchObject({ status: "completed", strategy: "network", tier: "direct" });
    expect(result.value).toEqual([{ id: 1 }, { id: 2 }]);
    expect(tab.executeTool).not.toHaveBeenCalled();
    expect(getContext).toHaveBeenCalledWith(`${server.origin}/items`);
    expect(server.seen).toHaveLength(1);
    expect(server.seen[0]?.headers.cookie).toBe(`session=${COOKIE}`);
    expect(server.seen[0]?.headers["user-agent"]).toBe("Mozilla/5.0 (DirectTest)");
    expect(readTiers(root)).toEqual({ "shop items": { tier: "direct", at: expect.any(String) } });
  });

  it("sends the op's recorded user agent and headers, never a recorded cookie, and hides set-cookie", async () => {
    const server = await serve((_request, response) =>
      json(response, 200, { ok: true }, { "set-cookie": "fresh=new-value; Path=/" }),
    );
    const op = readOp(`${server.origin}/items`, {
      request: {
        method: "GET",
        url: `${server.origin}/items`,
        headers: { "User-Agent": "Recorded/1.0", "X-Requested-With": "fetch", Cookie: "stale=1" },
      },
    });
    const result = await runtime.runPlaybookOp({
      playbook,
      op,
      executeTool: tabAnswering().executeTool,
      direct: direct.directTier({ playbook, op, getContext: browserContext(), root: stateDir() }),
    });

    expect(result.tier).toBe("direct");
    expect(server.seen[0]?.headers).toMatchObject({
      "user-agent": "Recorded/1.0",
      "x-requested-with": "fetch",
      cookie: `session=${COOKIE}`,
    });
    expect(result.value).toMatchObject({ status: 200, ok: true, bodyJson: { ok: true } });
    expect(result.value.headers["set-cookie"]).toBeUndefined();
  });

  it("keeps the cookies in memory: no file it writes, nor the journal, holds them", async () => {
    const server = await serve((_request, response) => json(response, 200, { items: [{ id: 1 }] }));
    const root = stateDir();
    const journal = path.join(root, "journal.jsonl");
    const op = readOp(`${server.origin}/items`, { extract: { jsonPath: "$.items" } });
    const result = await runtime.runPlaybookOp({
      playbook,
      op,
      executeTool: tabAnswering().executeTool,
      onEvent: (event: unknown) => fs.appendFileSync(journal, `${JSON.stringify(event)}\n`),
      direct: direct.directTier({ playbook, op, getContext: browserContext(), root }),
    });

    expect(result.tier).toBe("direct");
    expect(server.seen[0]?.headers.cookie).toContain(COOKIE);
    const files = filesUnder(root);
    expect(files.map((file) => path.basename(file)).sort()).toEqual(["journal.jsonl", direct.TIERS_FILE]);
    for (const file of files) {
      expect(fs.readFileSync(file, "utf8")).not.toContain(COOKIE);
    }
    expect(JSON.stringify(result)).not.toContain(COOKIE);
  });

  it("sends only to the op's allowed origins, refusing before it reads cookies or connects", async () => {
    const server = await serve((_request, response) => json(response, 200, { ok: true }));
    const getContext = browserContext();
    const scoped = { ...playbook, origins: ["https://shop.test"] };
    const op = readOp(`${server.origin}/items`);
    await expect(
      runtime.runPlaybookOp({
        playbook: scoped,
        op,
        executeTool: tabAnswering().executeTool,
        direct: direct.directTier({ playbook: scoped, op, getContext, root: stateDir() }),
      }),
    ).rejects.toThrow(
      `All strategies failed (network (direct): playbook network origin is not allowed: ${server.origin}; network (tab): playbook network origin is not allowed: ${server.origin})`,
    );
    expect(getContext).not.toHaveBeenCalled();
    expect(server.seen).toHaveLength(0);
  });

  it("refuses a host that resolves to a private or loopback address, and the tab answers", async () => {
    const lookup = async (hostname: string) =>
      hostname === "intranet.test"
        ? [{ address: "10.0.0.5", family: 4 }]
        : [{ address: "127.0.0.1", family: 4 }];
    for (const host of ["intranet.test", "rebind.test"]) {
      const getContext = browserContext();
      const op = readOp(`http://${host}/items`, { extract: { jsonPath: "$.items" } });
      const result = await runtime.runPlaybookOp({
        playbook,
        op,
        executeTool: tabAnswering().executeTool,
        direct: direct.directTier({ playbook, op, getContext, root: stateDir(), lookup }),
      });
      expect(result).toMatchObject({ tier: "tab", value: [{ id: "tab" }] });
      expect(result.attempts).toEqual([
        {
          using: "network",
          tier: "direct",
          error: expect.stringMatching(
            new RegExp(`^${host.replace(".", "\\.")} resolves to (10\\.0\\.0\\.5|127\\.0\\.0\\.1), a loopback, private`),
          ),
        },
      ]);
      expect(getContext).not.toHaveBeenCalled();
    }
  });

  it("knows loopback, private, link-local and unspecified addresses", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "[::1]"]) {
      expect(direct.isBlockedAddress(address), address).toBe(true);
    }
    for (const address of ["8.8.8.8", "172.32.0.1", "93.184.216.34", "2606:4700::1111", "::ffff:808:808"]) {
      expect(direct.isBlockedAddress(address), address).toBe(false);
    }
    expect(direct.recordedAgainstPrivate("http://127.0.0.1:8080/api")).toBe(true);
    expect(direct.recordedAgainstPrivate("http://localhost:3000/api")).toBe(true);
    expect(direct.recordedAgainstPrivate("https://shop.test/{{path}}")).toBe(false);
  });

  it("follows a redirect within the op's origins, re-reading cookies for each hop", async () => {
    const server = await serve((request, response) => {
      if (request.url === "/old") {
        response.writeHead(302, { location: "/items" });
        response.end();
      } else {
        json(response, 200, { items: [{ id: 1 }] });
      }
    });
    const getContext = browserContext();
    const op = readOp(`${server.origin}/old`);
    const result = await runtime.runPlaybookOp({
      playbook,
      op,
      executeTool: tabAnswering().executeTool,
      direct: direct.directTier({ playbook, op, getContext, root: stateDir() }),
    });
    expect(result).toMatchObject({ tier: "direct", value: { url: `${server.origin}/items` } });
    expect(getContext.mock.calls.map(([url]) => url)).toEqual([`${server.origin}/old`, `${server.origin}/items`]);
    expect(server.seen.map((request) => request.url)).toEqual(["/old", "/items"]);
  });

  it("stops at a redirect to another origin, and the tab answers", async () => {
    let port = 0;
    const server = await serve((_request, response) => {
      response.writeHead(302, { location: `http://localhost:${port}/elsewhere` });
      response.end();
    });
    port = server.port;
    const op = readOp(`${server.origin}/items`, { extract: { jsonPath: "$.items" } });
    const result = await runtime.runPlaybookOp({
      playbook,
      op,
      executeTool: tabAnswering().executeTool,
      direct: direct.directTier({ playbook, op, getContext: browserContext(), root: stateDir() }),
    });
    expect(result.tier).toBe("tab");
    expect(result.attempts[0]?.error).toBe(
      `the response redirected to http://localhost:${port}, which is not one of the op's origins, so the direct request stopped`,
    );
    expect(server.seen.map((request) => request.url)).toEqual(["/items"]);
  });

  it("checks each redirect hop's address again", async () => {
    const server = await serve((_request, response) => {
      response.writeHead(302, { location: `http://rebind.test:${server.port}/items` });
      response.end();
    });
    // public.test stands for a public host (this server); rebind.test resolves to a private address.
    const lookup = async (hostname: string) =>
      hostname === "public.test" ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "10.0.0.7", family: 4 }];
    const isBlocked = (address: string) => address !== "127.0.0.1" && direct.isBlockedAddress(address);
    const scoped = { ...playbook, origins: [`http://public.test:${server.port}`, `http://rebind.test:${server.port}`] };
    const op = readOp(`http://public.test:${server.port}/items`, { extract: { jsonPath: "$.items" } });
    const tab = captureTab({
      href: `http://public.test:${server.port}/`,
      reply: () => ({ body: JSON.stringify({ items: [{ id: "tab" }] }) }),
    });
    const result = await runtime.runPlaybookOp({
      playbook: scoped,
      op,
      executeTool: tab.executeTool,
      direct: direct.directTier({ playbook: scoped, op, getContext: browserContext(), root: stateDir(), lookup, isBlocked }),
    });
    expect(result.tier).toBe("tab");
    expect(result.attempts[0]?.error).toMatch(/^rebind\.test resolves to 10\.0\.0\.7/);
    expect(server.seen).toHaveLength(1);
  });

  it.each([
    ["a 401", 401, {}, "{}", "network strategy returned 401"],
    ["a 403", 403, {}, "{}", "network strategy returned 403"],
    ["a cf-mitigated 503", 503, { "cf-mitigated": "challenge" }, "<html></html>", "the site answered with a bot challenge (HTTP 503)"],
    ["a challenge-platform 403", 403, {}, '<script src="/cdn-cgi/challenge-platform/h/b"></script>', "the site answered with a bot challenge (HTTP 403)"],
    ["a captcha 429", 429, {}, '<div class="g-recaptcha"></div>', "the site answered with a bot challenge (HTTP 429)"],
  ])("falls back to the tab on %s", async (_name, status, headers, body, error) => {
    const server = await serve((_request, response) => {
      response.writeHead(status, { "content-type": "text/html", ...headers });
      response.end(body);
    });
    const op = readOp(`${server.origin}/items`, { extract: { jsonPath: "$.items" } });
    const tab = tabAnswering();
    const result = await runtime.runPlaybookOp({
      playbook,
      op,
      executeTool: tab.executeTool,
      direct: direct.directTier({ playbook, op, getContext: browserContext(), root: stateDir() }),
    });
    expect(result).toMatchObject({ status: "completed", tier: "tab", value: [{ id: "tab" }] });
    expect(result.attempts).toEqual([{ using: "network", tier: "direct", error }]);
    expect(tab.fetchImpl).toHaveBeenCalledOnce();
  });

  it("falls back to the tab when a direct answer fails the op's saved test", async () => {
    const server = await serve((_request, response) => json(response, 200, { items: [] }));
    const op = readOp(
      `${server.origin}/items`,
      { extract: { jsonPath: "$.items" } },
      { on: { success: { expect: { assert: [{ path: "$", op: "array_min_len", value: 1 }] } } } },
    );
    const result = await runtime.runPlaybookOp({
      playbook,
      op,
      executeTool: tabAnswering().executeTool,
      direct: direct.directTier({ playbook, op, getContext: browserContext(), root: stateDir() }),
    });
    expect(result).toMatchObject({ tier: "tab", value: [{ id: "tab" }] });
    expect(result.attempts[0]).toMatchObject({ using: "network", tier: "direct", error: expect.stringMatching(/^assertion failed: \$ array_min_len/) });
  });

  it("remembers per op which tier answered, starts in the tab after a direct failure, and tries direct again a day later", async () => {
    let status = 403;
    const server = await serve((_request, response) => json(response, status, { items: [{ id: "direct" }] }));
    const root = stateDir();
    let clock = Date.parse("2026-11-17T10:00:00Z");
    const op = readOp(`${server.origin}/items`, { extract: { jsonPath: "$.items" } });
    const run = async () => {
      const tab = tabAnswering();
      const result = await runtime.runPlaybookOp({
        playbook,
        op,
        executeTool: tab.executeTool,
        direct: direct.directTier({ playbook, op, getContext: browserContext(), root, now: () => clock }),
      });
      return { result, tabSent: tab.fetchImpl.mock.calls.length };
    };

    expect(await run()).toMatchObject({ result: { tier: "tab" }, tabSent: 1 });
    expect(readTiers(root)["shop items"]).toEqual({ tier: "tab", at: "2026-11-17T10:00:00.000Z" });
    status = 200;
    // The direct tier failed last time: the tab goes first, and the host sends nothing.
    expect(await run()).toMatchObject({ result: { tier: "tab" }, tabSent: 1 });
    expect(server.seen).toHaveLength(1);
    clock += 25 * 60 * 60 * 1000;
    expect(await run()).toMatchObject({ result: { tier: "direct", value: [{ id: "direct" }] }, tabSent: 0 });
    expect(readTiers(root)["shop items"].tier).toBe("direct");
    // Another op of the same playbook keeps its own entry.
    expect(Object.keys(readTiers(root))).toEqual(["shop items"]);
  });

  it("never sends a write on to the tab once it may have been sent, and marks it in doubt", async () => {
    const server = await serve((_request, response) => json(response, 500, { error: "boom" }));
    const tab = tabAnswering();
    const beforeDispatch = vi.fn(async () => {});
    const afterDispatch = vi.fn(async (_outcome: Record<string, unknown>) => {});
    const op = {
      id: "submit",
      effect: "write",
      args: {},
      safety: { authorization: "explicit", duplicate: "transactional", key: [] },
      run: [{ using: "network", request: { method: "POST", url: `${server.origin}/submit`, body: { a: 1 } } }],
    };
    await expect(
      runtime.runPlaybookOp({
        playbook,
        op,
        executeTool: tab.executeTool,
        beforeDispatch,
        afterDispatch,
        direct: direct.directTier({ playbook, op, getContext: browserContext(), root: stateDir() }),
      }),
    ).rejects.toThrow("network strategy returned 500");
    expect(server.seen).toEqual([expect.objectContaining({ method: "POST", body: '{"a":1}' })]);
    expect(server.seen[0]?.headers["content-type"]).toBe("text/plain;charset=UTF-8");
    expect(tab.executeTool).not.toHaveBeenCalled();
    expect(beforeDispatch).toHaveBeenCalledOnce();
    expect(afterDispatch.mock.calls.map(([outcome]) => outcome.status)).toEqual(["indeterminate"]);
  });

  it("sends a write from the tab when the direct tier sent nothing of it, under one receipt", async () => {
    // Nothing listens on this port, so the connection is refused before any request bytes go.
    const closed = await serve(() => {});
    const port = closed.port;
    await new Promise((resolve) => {
      servers.splice(0).forEach((server) => {
        server.close(() => resolve(undefined));
      });
    });
    const tab = captureTab({ href: `http://127.0.0.1:${port}/`, reply: () => ({ body: '{"ok":true}' }) });
    const beforeDispatch = vi.fn(async () => {});
    const afterDispatch = vi.fn(async (_outcome: Record<string, unknown>) => {});
    const op = {
      id: "submit",
      effect: "write",
      args: {},
      safety: { authorization: "explicit", duplicate: "transactional", key: [] },
      run: [
        {
          using: "network",
          request: { method: "POST", url: `http://127.0.0.1:${port}/submit`, body: { a: 1 } },
          extract: { jsonPath: "$.ok" },
          expect: { truthy: true },
        },
      ],
    };
    const result = await runtime.runPlaybookOp({
      playbook,
      op,
      executeTool: tab.executeTool,
      beforeDispatch,
      afterDispatch,
      direct: direct.directTier({ playbook, op, getContext: browserContext(), root: stateDir() }),
    });
    expect(result).toMatchObject({ tier: "tab", value: true });
    expect(result.attempts).toEqual([{ using: "network", tier: "direct", error: "the direct request failed: ECONNREFUSED" }]);
    expect(beforeDispatch).toHaveBeenCalledOnce();
    expect(afterDispatch.mock.calls.map(([outcome]) => outcome.status)).toEqual(["verified"]);
  });

  it("runs in the tab alone without a direct tier (--no-direct), and for an HTML extract", async () => {
    const server = await serve((_request, response) => json(response, 200, { items: [{ id: 1 }] }));
    const plain = readOp(`${server.origin}/items`, { extract: { jsonPath: "$.items" } });
    const off = await runtime.runPlaybookOp({ playbook, op: plain, executeTool: tabAnswering().executeTool });
    expect(off).toMatchObject({ tier: "tab", value: [{ id: "tab" }], attempts: [] });
    const html = readOp(`${server.origin}/items`, { extract: { html: { item: "li", fields: { name: "a" } } } });
    // The HTML extract goes to the tab alone (whose test fetch has no DOM to parse with).
    const getContext = browserContext();
    await expect(
      runtime.runPlaybookOp({
        playbook,
        op: html,
        executeTool: tabAnswering().executeTool,
        direct: direct.directTier({ playbook, op: html, getContext, root: stateDir() }),
      }),
    ).rejects.toThrow(/^All strategies failed \(network: the response couldn't be prepared/);
    expect(getContext).not.toHaveBeenCalled();
    expect(server.seen).toHaveLength(0);
  });

  it("--dry-run names the tiers and the origins whose cookies it would read, reading none", () => {
    const getContext = browserContext();
    const op = readOp("https://shop.test/items?page=2");
    const scoped = { ...playbook, origins: ["https://shop.test", "https://api.shop.test"] };
    const preview = runtime.previewPlaybookOp({
      playbook: scoped,
      op,
      env: {},
      direct: direct.directTier({ playbook: scoped, op, getContext, root: stateDir() }),
    });
    expect(preview).toMatchObject({
      tier: "direct",
      tiers: ["direct", "tab"],
      cookieOrigins: ["https://shop.test", "https://api.shop.test"],
    });
    expect(getContext).not.toHaveBeenCalled();
    const text = formatDryRun({ ...preview, receipt: "none: a read op keeps no receipt" });
    expect(text).toContain("tier: direct, then tab");
    expect(text).toContain(
      "direct reads the browser's cookies for: https://shop.test, https://api.shop.test (never shown or stored)",
    );

    const off = runtime.previewPlaybookOp({ playbook, op, env: {}, direct: { off: "--no-direct" } });
    expect(off).toMatchObject({ tier: "tab", tiers: ["tab"], directSkipped: "--no-direct" });
    expect(off.cookieOrigins).toBeUndefined();
    expect(formatDryRun({ ...off, receipt: "none" })).toContain("tier: tab (direct skipped: --no-direct)");

    const html = readOp("https://shop.test/items", { extract: { html: { item: "li", fields: { name: "a" } } } });
    expect(
      runtime.previewPlaybookOp({ playbook, op: html, env: {}, direct: direct.directTier({ playbook, op: html, getContext, root: stateDir() }) }),
    ).toMatchObject({ tier: "tab", directSkipped: "its HTML extract needs the tab's DOM" });
  });
});
