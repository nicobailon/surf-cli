import { afterEach, describe, expect, it, vi } from "vitest";
import { captureTab } from "../fixtures/capture-tab";

const runtime = require("../../native/playbook-runtime.cjs");

const playbook = { id: "books", provenance: { scope: "test" } };

afterEach(() => {
  vi.useRealTimers();
});

// Polling sleeps move a fake clock, so waiting out the capture deadline takes no real time.
function fakeClock() {
  vi.useFakeTimers({ toFake: ["Date"] });
  return async (ms: number) => {
    vi.setSystemTime(Date.now() + ms);
  };
}
const html = (bytes: number) => `<html>${"<li>a book</li>".repeat(Math.ceil(bytes / 15))}</html>`;

function readOp(request: Record<string, unknown> = {}, strategy: Record<string, unknown> = {}) {
  return {
    id: "page",
    effect: "read",
    args: {},
    run: [
      {
        using: "network",
        request: { method: "GET", url: "https://api.test/catalogue/page-3.html", ...request },
        ...strategy,
      },
    ],
  };
}

describe("network strategy response bodies", () => {
  it("charges a plain network request nothing from the field-regex budget, however long it takes", async () => {
    // The plain request takes 10 s on the host's clock and fails its check; the next strategy's
    // match patterns still have the whole budget.
    const body = JSON.stringify([{ id: "id-1" }, { id: "id-2" }]);
    const tab = captureTab({ reply: () => ({ body }) });
    let now = 0;
    const executeTool = async (tool: string, args: Record<string, unknown>) => {
      if (tool === "javascript_tool" && !String(args.code).includes("boundedRegex")) {
        now += 10_000;
      }
      return tab.executeTool(tool, args);
    };
    const plain = { using: "network", request: { method: "GET", url: "https://api.test/items" } };
    const result = await runtime.runPlaybookOp({
      playbook,
      op: {
        id: "items",
        effect: "read",
        args: {},
        run: [
          { ...plain, verify: { status: 201 } },
          {
            ...plain,
            extract: { records: "$", fields: { id: { path: "id", match: "id-(\\d+)" } } },
          },
        ],
      },
      executeTool,
      now: () => now,
    });
    expect(now).toBe(10_000);
    expect(result).toMatchObject({ status: "completed", value: [{ id: "1" }, { id: "2" }] });
    expect(result.attempts).toEqual([{ using: "network", error: "expected status 201" }]);
  });

  it("returns a body over the script output cap whole, read from network capture", async () => {
    const body = html(62 * 1024);
    const tab = captureTab({ reply: () => ({ body, headers: { "content-type": "text/html" } }) });
    const result = await runtime.runPlaybookOp({
      playbook,
      op: readOp(),
      executeTool: tab.executeTool,
    });
    expect(result).toMatchObject({ status: "completed", strategy: "network" });
    expect(result.value).toMatchObject({
      status: 200,
      ok: true,
      url: "https://api.test/catalogue/page-3.html",
    });
    expect(result.value.body).toBe(body);
    expect(result.value.headers).toEqual({ "content-type": "text/html" });
    expect(tab.fetchImpl).toHaveBeenCalledOnce();
  });

  it("runs a JSON extract in the tab, without capture, and reads a field extract's body from capture", async () => {
    const items = Array.from({ length: 3000 }, (_, index) => ({
      id: index,
      title: `book ${index}`,
    }));
    const tab = captureTab({ reply: () => ({ body: JSON.stringify({ total: 3000, items }) }) });
    const json = await runtime.runPlaybookOp({
      playbook,
      op: readOp({}, { extract: { jsonPath: "$.total" } }),
      executeTool: tab.executeTool,
    });
    expect(json.value).toBe(3000);
    // The tab sent back only the extracted value, so capture was never read.
    expect(tab.executeTool.mock.calls.map(([tool]) => tool)).toEqual(["javascript_tool"]);
    const field = await runtime.runPlaybookOp({
      playbook,
      op: readOp({}, { extract: { field: "body" } }),
      executeTool: captureTab({ reply: () => ({ body: html(70 * 1024) }) }).executeTool,
    });
    expect(field.value).toBe(html(70 * 1024));
  });

  it("redacts an env value that a captured body echoes", async () => {
    const secret = "dummy-env-value-for-tests";
    const tab = captureTab({ reply: () => ({ body: `${html(60 * 1024)}<p>key ${secret}</p>` }) });
    const result = await runtime.runPlaybookOp({
      playbook,
      op: readOp({
        authInputs: [{ env: "SURF_TEST_BODY_KEY", header: "Authorization", required: true }],
      }),
      secrets: { SURF_TEST_BODY_KEY: secret },
      env: {},
      executeTool: tab.executeTool,
    });
    expect(result.value.body).not.toContain(secret);
    expect(result.value.body).toContain("<p>key <redacted></p>");
  });

  it("names the size and the cap when neither capture nor Chrome has the body", async () => {
    const tab = captureTab({
      reply: () => ({
        body: html(300 * 1024),
        bodyGone: true,
        bodyCapture: {
          mode: "text",
          complete: false,
          reason: "per-body-cap",
          sizeBytes: 307215,
          limitBytes: 65536,
        },
      }),
    });
    const error = await runtime
      .runPlaybookOp({ playbook, op: readOp(), executeTool: tab.executeTool })
      .catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain(
      "got HTTP 200 from /catalogue/page-3.html but can't read its body: it is 307215 bytes, over the 65536-byte per-body capture cap, and Chrome no longer has it",
    );
    expect(error.message).not.toMatch(/JSON/);
  });

  it("fails instead of guessing when the page sent the same request meanwhile", async () => {
    const tab = captureTab({
      reply: () => ({ body: html(60 * 1024) }),
      pageSends: () => [{ status: 200, body: "the page's own copy" }],
    });
    const error = await runtime
      .runPlaybookOp({ playbook, op: readOp(), executeTool: tab.executeTool })
      .catch((caught: Error) => caught);
    expect(error.message).toMatch(
      /2 captured requests match GET \/catalogue\/page-3\.html while the op ran, and nothing tells which one it sent/,
    );
  });

  it("picks the captured response whose status and headers agree with what the script saw", async () => {
    const body = html(60 * 1024);
    const tab = captureTab({
      reply: () => ({ body, headers: { etag: '"v2"' } }),
      pageSends: () => [
        { status: 503, body: "" },
        { status: 200, responseHeaders: { ETag: '"v1"' }, body: "stale" },
      ],
    });
    const result = await runtime.runPlaybookOp({
      playbook,
      op: readOp(),
      executeTool: tab.executeTool,
    });
    expect(result.value.body).toBe(body);
  });

  // A response the browser revalidated is a 304 in capture and a 200 to fetch.
  const revalidated = (fields: Record<string, unknown>) =>
    captureTab({ reply: () => ({ body: html(60 * 1024), capturedStatus: 304, ...fields }) });

  it("reads a revalidated response when its ETag or Last-Modified matches what the script saw", async () => {
    const byEtag = revalidated({
      headers: { etag: '"v7"' },
      capturedResponseHeaders: {},
      capturedRequestHeaders: { "If-None-Match": '"v7"' },
    });
    const etag = await runtime.runPlaybookOp({
      playbook,
      op: readOp(),
      executeTool: byEtag.executeTool,
    });
    expect(etag.value).toMatchObject({ status: 200, body: html(60 * 1024) });

    const date = "Wed, 11 Nov 2026 10:00:00 GMT";
    const byDate = revalidated({
      headers: { "last-modified": date },
      capturedResponseHeaders: { "Last-Modified": date },
    });
    const modified = await runtime.runPlaybookOp({
      playbook,
      op: readOp(),
      executeTool: byDate.executeTool,
    });
    expect(modified.value.body).toBe(html(60 * 1024));
  });

  it("doesn't take a 304 whose validators don't match, or that has none, for the script's 200", async () => {
    const cases = [
      {
        headers: { etag: '"v2"' },
        capturedResponseHeaders: {},
        capturedRequestHeaders: { "If-None-Match": '"v1"' },
      },
      { headers: {}, capturedResponseHeaders: {} },
    ];
    for (const fields of cases) {
      const error = await runtime
        .runPlaybookOp({
          playbook,
          op: readOp(),
          executeTool: revalidated(fields).executeTool,
          sleep: fakeClock(),
        })
        .catch((caught: Error) => caught);
      expect(error.message).toMatch(
        /disagrees with what the tab saw \(HTTP 200\): capture has HTTP 304/,
      );
    }
  });

  const postOp = readOp({ method: "POST", url: "https://api.test/start", body: { q: 1 } });

  it("follows a POST answered with 303 to the GET it became, not the page's DELETE of the same URL", async () => {
    const tab = captureTab({
      reply: () => ({
        body: "the search results",
        redirect: { status: 303, to: "https://api.test/final" },
      }),
      pageSends: () => [{ url: "https://api.test/final", method: "DELETE", body: "deleted" }],
    });
    const result = await runtime.runPlaybookOp({
      playbook,
      op: postOp,
      executeTool: tab.executeTool,
    });
    expect(result.value).toMatchObject({
      url: "https://api.test/final",
      body: "the search results",
    });
  });

  it("keeps the method through a 307, so the page's GET of the same URL doesn't match", async () => {
    const tab = captureTab({
      reply: () => ({
        body: "posted again",
        redirect: { status: 307, to: "https://api.test/final" },
      }),
      pageSends: () => [{ url: "https://api.test/final", method: "GET", body: "the page's copy" }],
    });
    const result = await runtime.runPlaybookOp({
      playbook,
      op: postOp,
      executeTool: tab.executeTool,
    });
    expect(result.value.body).toBe("posted again");
  });

  it("fails closed when capture can't tie a redirected response to the request it sent", async () => {
    const tab = captureTab({
      reply: () => ({
        body: "ours",
        redirect: { status: 303, to: "https://api.test/final", chain: "missing" },
      }),
      pageSends: () => [{ url: "https://api.test/final", method: "DELETE", body: "deleted" }],
    });
    const error = await runtime
      .runPlaybookOp({
        playbook,
        op: postOp,
        executeTool: tab.executeTool,
        sleep: fakeClock(),
      })
      .catch((caught: Error) => caught);
    expect(error.message).toMatch(
      /POST \/start was redirected to \/final, and capture can't show which captured request it ended in/,
    );
    expect(error.message).not.toContain("deleted");
  });

  const writeOp = (strategies: Array<Record<string, unknown>> = []) => ({
    id: "save",
    effect: "write",
    args: {},
    safety: { duplicate: "transactional", key: [] },
    run: [
      {
        using: "network",
        request: { method: "POST", url: "https://api.test/save", body: { id: 1 } },
      },
      ...strategies,
    ],
  });

  it("refuses a relative URL on a tab whose origin isn't allowed before the write is sent", async () => {
    const relative = {
      ...writeOp(),
      origins: ["https://site.test"],
      run: [{ using: "network", request: { method: "POST", url: "/api/save", body: { id: 1 } } }],
    };
    const run = (href: string) => {
      const statuses: string[] = [];
      const tab = captureTab({ href, reply: () => ({ body: "{}" }) });
      const done = runtime.runPlaybookOp({
        playbook,
        op: relative,
        executeTool: tab.executeTool,
        beforeDispatch: async () => statuses.push("dispatched"),
        afterDispatch: async ({ status }: { status: string }) => statuses.push(status),
      });
      return { statuses, tab, done };
    };
    const refused = run("https://elsewhere.test/page");
    await expect(refused.done).rejects.toThrow(
      "playbook network origin is not allowed: https://elsewhere.test",
    );
    expect(refused.statuses).toEqual(["not_dispatched"]);
    expect(refused.tab.fetchImpl).not.toHaveBeenCalled();
    // On an allowed page the relative URL resolves there and is sent.
    const allowed = run("https://site.test/page");
    await expect(allowed.done).resolves.toMatchObject({ status: "completed" });
    expect(allowed.statuses).toEqual(["dispatched", "verified"]);
    expect(allowed.tab.fetchImpl).toHaveBeenCalledOnce();
  });

  it("turns capture on before a write is sent, so a capture failure leaves it unsent", async () => {
    const statuses: string[] = [];
    const tab = captureTab();
    const executeTool = async (tool: string, args: Record<string, unknown>) => {
      if (tool === "network") {
        throw new Error("debugger detached");
      }
      return tab.executeTool(tool, args);
    };
    await expect(
      runtime.runPlaybookOp({
        playbook,
        op: writeOp(),
        executeTool,
        beforeDispatch: async () => statuses.push("dispatched"),
        afterDispatch: async ({ status }: { status: string }) => statuses.push(status),
      }),
    ).rejects.toThrow(/debugger detached/);
    expect(statuses).toEqual(["not_dispatched"]);
    expect(tab.fetchImpl).not.toHaveBeenCalled();
  });

  it("marks a sent write whose body can't be read indeterminate, and sends it once", async () => {
    const statuses: string[] = [];
    const tab = captureTab({ reply: () => ({ body: "{}", bodyGone: true }) });
    await expect(
      runtime.runPlaybookOp({
        playbook,
        op: writeOp([
          { using: "workflow", steps: [{ cmd: "click", args: { selector: "#save" } }] },
        ]),
        executeTool: tab.executeTool,
        beforeDispatch: async () => statuses.push("dispatched"),
        afterDispatch: async ({ status }: { status: string }) => statuses.push(status),
      }),
    ).rejects.toThrow(/got HTTP 200 from \/save but can't read its body/);
    expect(statuses).toEqual(["dispatched", "indeterminate"]);
    expect(tab.fetchImpl).toHaveBeenCalledOnce();
    expect(tab.executeTool.mock.calls.map(([tool]) => tool)).not.toContain("click");
  });

  it("sends a write once, reads its large body, and records a verified receipt", async () => {
    const statuses: string[] = [];
    const tab = captureTab({
      reply: () => ({ body: JSON.stringify({ ok: true, pad: "x".repeat(60 * 1024) }) }),
    });
    const result = await runtime.runPlaybookOp({
      playbook,
      op: {
        id: "save",
        effect: "write",
        args: {},
        safety: { duplicate: "transactional", key: [] },
        run: [
          {
            using: "network",
            request: { method: "POST", url: "https://api.test/save", body: { id: 1 } },
            extract: { jsonPath: "$.ok" },
            expect: { truthy: true },
          },
        ],
      },
      executeTool: tab.executeTool,
      beforeDispatch: async () => statuses.push("dispatched"),
      afterDispatch: async ({ status }: { status: string }) => statuses.push(status),
    });
    expect(result.value).toBe(true);
    expect(statuses).toEqual(["dispatched", "verified"]);
    expect(tab.fetchImpl).toHaveBeenCalledOnce();
  });
});
