import { describe, expect, it, vi } from "vitest";
import { captureTab } from "../fixtures/capture-tab";

const runtime = require("../../native/playbook-runtime.cjs");
const { renderRequest, resolveArgValues } = require("../../native/playbook-template.cjs");
const playbooks = require("../../native/playbooks.cjs");

type FetchCall = [
  string,
  { method: string; headers: Record<string, string>; body?: string; cache?: string },
];

// Runs the page-context network script with a fake fetch, as the tab would.
const fakeTab = () => captureTab();

function op(request: Record<string, unknown>, args: Record<string, unknown> = {}) {
  return {
    id: "search",
    effect: "read",
    args,
    run: [{ using: "network", request: { method: "GET", ...request } }],
  };
}

describe("request templates", () => {
  it("coerces inputs to their declared type and keeps untyped inputs as given", () => {
    expect(
      resolveArgValues(
        { id: { type: "string" }, page: { type: "number", default: 1 }, on: { type: "boolean" } },
        { id: 2101.1, on: "false" },
      ),
    ).toEqual({ id: "2101.1", page: 1, on: false });
    expect(() => resolveArgValues({ page: { type: "number" } }, { page: "two" })).toThrow(
      /--page must be a number/,
    );
    expect(resolveArgValues({ q: {} }, { q: 5 })).toEqual({ q: 5 });
    expect(() =>
      playbooks.validateOp(op({ url: "https://api.test/" }, { q: { type: "date" } }), {
        origins: [],
      }),
    ).toThrow(/type must be string, number or boolean/);
  });

  it("encodes values by where they go, and leaves an unset exact input out", () => {
    const rendered = renderRequest(
      {
        method: "POST",
        url: "https://api.test/abs/{{id}}",
        query: { q: "{{q}}", vars: { page: "{{page}}", text: "{{q}}" }, opt: "{{missing}}" },
        headers: { "x-q": "{{q}}", "x-opt": "{{missing}}" },
        body: "q={{q}}&n=1",
      },
      { id: "a b?c", q: "x&y", page: 2 },
    );
    expect(rendered.url).toBe("https://api.test/abs/a%20b%3Fc");
    expect(rendered.query).toEqual({ q: "x&y", vars: '{"page":2,"text":"x&y"}' });
    expect(rendered.headers).toEqual({ "x-q": "x&y" });
    expect(rendered.body).toBe("q=x&y&n=1");
    const form = renderRequest(
      {
        url: "https://api.test/",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "q={{q}}",
      },
      { q: "x&y" },
    );
    expect(form.body).toBe("q=x%26y");
    expect(() => renderRequest({ url: "https://api.test/{{id}}" }, {})).toThrow(
      /missing template argument: id/,
    );
  });

  it("sends a templated path and query from the tab", async () => {
    const { fetchImpl, executeTool } = fakeTab();
    await runtime.runPlaybookOp({
      playbook: { id: "books", provenance: {} },
      op: op(
        {
          url: "https://api.test/catalogue/page-{{page}}.html",
          query: { v: { page: "{{page}}" } },
        },
        { page: { type: "number", default: 2 } },
      ),
      args: { page: "3" },
      executeTool,
    });
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://api.test/catalogue/page-3.html?v=%7B%22page%22%3A3%7D",
    );
  });
});

describe("env-supplied headers", () => {
  const authOp = op({
    url: "https://api.test/search",
    authInputs: [{ env: "SURF_TEST_KEY", header: "Authorization", required: true }],
  });

  it("adds the header from the caller's value, which wins over the host's environment", async () => {
    const { fetchImpl, executeTool } = fakeTab();
    await runtime.runPlaybookOp({
      playbook: { id: "api", provenance: {} },
      op: authOp,
      secrets: { SURF_TEST_KEY: "shell-value" },
      env: { SURF_TEST_KEY: "host-value" },
      executeTool,
    });
    expect((fetchImpl.mock.calls[0] as unknown as FetchCall)[1].headers).toEqual({
      Authorization: "shell-value",
    });
    // The browser must not write a response to a request carrying the value to its disk cache.
    expect((fetchImpl.mock.calls[0] as unknown as FetchCall)[1].cache).toBe("no-store");

    const host = fakeTab();
    await runtime.runPlaybookOp({
      playbook: { id: "api", provenance: {} },
      op: authOp,
      env: { SURF_TEST_KEY: "host-value" },
      executeTool: host.executeTool,
    });
    expect((host.fetchImpl.mock.calls[0] as unknown as FetchCall)[1].headers).toEqual({
      Authorization: "host-value",
    });
  });

  it("fails before any strategy runs when the variable is missing, naming only the variable", async () => {
    const executeTool = vi.fn();
    const withFallback = {
      ...authOp,
      run: [...authOp.run, { using: "workflow", steps: [{ cmd: "page.text", args: {} }] }],
    };
    await expect(
      runtime.runPlaybookOp({
        playbook: { id: "api", provenance: {} },
        op: withFallback,
        env: {},
        executeTool,
      }),
    ).rejects.toThrow(/environment variable SURF_TEST_KEY .*Authorization/);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("keeps the value out of errors and events", async () => {
    const events: unknown[] = [];
    const executeTool = vi.fn(async (tool: string) =>
      tool === "network"
        ? { entries: [] }
        : { error: "fetch failed for header shell-secret-value" },
    );
    const error = await runtime
      .runPlaybookOp({
        playbook: { id: "api", provenance: {} },
        op: authOp,
        secrets: { SURF_TEST_KEY: "shell-secret-value" },
        env: {},
        executeTool,
        onEvent: (event: unknown) => events.push(event),
      })
      .catch((caught: Error) => caught);
    expect(String(error.message)).not.toContain("shell-secret-value");
    expect(JSON.stringify(events)).not.toContain("shell-secret-value");
  });

  it("redacts the value from results and errors, short values where they stand alone", async () => {
    const echo = captureTab({
      reply: () => ({
        body: JSON.stringify({
          headers: { Authorization: "k9" },
          note: "k9x stays",
          list: ["Bearer k9"],
        }),
      }),
    }).executeTool;
    const result = await runtime.runPlaybookOp({
      playbook: { id: "api", provenance: {} },
      op: authOp,
      secrets: { SURF_TEST_KEY: "k9" },
      env: {},
      executeTool: echo,
    });
    expect(result.value.bodyJson).toEqual({
      headers: { Authorization: "<redacted>" },
      note: "k9x stays",
      list: ["Bearer <redacted>"],
    });

    const fail = vi.fn(async (tool: string) =>
      tool === "network" ? { entries: [] } : { error: "rejected k9 (k9x)" },
    );
    const error = await runtime
      .runPlaybookOp({
        playbook: { id: "api", provenance: {} },
        op: authOp,
        secrets: { SURF_TEST_KEY: "k9" },
        env: {},
        executeTool: fail,
      })
      .catch((caught: Error) => caught);
    expect(error.message).toContain("rejected <redacted> (k9x)");
  });

  it("validates auth inputs and refuses one that duplicates a literal header", () => {
    expect(() =>
      playbooks.validateOp(
        op({
          url: "https://api.test/",
          authInputs: [{ env: "bad name", header: "Authorization" }],
        }),
        { origins: [] },
      ),
    ).toThrow(/env must be an environment variable name/);
    expect(() =>
      playbooks.validateOp(
        op({
          url: "https://api.test/",
          headers: { "X-Key": "v" },
          authInputs: [{ env: "KEY", header: "x-key" }],
        }),
        { origins: [] },
      ),
    ).toThrow(/also has a literal x-key header/);
  });
});
