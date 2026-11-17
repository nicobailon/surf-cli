import { describe, expect, it, vi } from "vitest";
import { captureTab } from "../fixtures/capture-tab";

const runtime = require("../../native/playbook-runtime.cjs");
const {
  escapeStepArgs,
  escapeTemplates,
  renderRequest,
  resolveArgValues,
  unescapeTemplates,
} = require("../../native/playbook-template.cjs");
const playbooks = require("../../native/playbooks.cjs");

type FetchCall = [
  string,
  { method: string; headers: Record<string, string>; body?: string; cache?: string },
];

// Runs the page-context network script with a fake fetch, as the tab would.
const fakeTab = () => captureTab();
// How an op pb save made from a record or recent activity renders: its `{{!}}` stands for `{{`.
const saved = { escapes: true };

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

  it("sends escaped captured text as captured, inputs beside it filled", async () => {
    const captured = {
      method: "POST",
      url: "https://api.test/save#{{q}}",
      query: { note: "{{q}}", whole: "{{!}}", nested: "{{{{q}}}}", open: "{{", named: "{{_open}}" },
      headers: { "x-note": "{{q}} and {{q" },
      body: '{"q":"{{q}}","n":"{{n}}"}',
    };
    const escaped = escapeTemplates(captured);
    expect(escaped.query).toEqual({
      note: "{{!}}q}}",
      whole: "{{!}}!}}",
      nested: "{{{{!}}q}}}}",
      open: "{{",
      named: "{{!}}_open}}",
    });
    expect(unescapeTemplates(escaped.body)).toBe(captured.body);
    expect(renderRequest(escaped, { q: "filled" }, saved)).toMatchObject(captured);
    // A field pb param made an input is filled; the captured text beside it is not.
    const form = renderRequest(
      {
        url: "https://api.test/",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `${escapeTemplates("a={{q}}")}&b={{q}}`,
      },
      { q: "x&y" },
      saved,
    );
    expect(form.body).toBe("a={{q}}&b=x%26y");
    const { fetchImpl, executeTool } = fakeTab();
    await runtime.runPlaybookOp({
      playbook: { id: "books", provenance: {} },
      op: {
        ...op(escapeTemplates({ url: "https://api.test/save", query: { note: "{{q}}" } }), {
          q: { default: "filled" },
        }),
        provenance: { recordId: "rec-1", escaped: true },
      },
      executeTool,
    });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.test/save?note=%7B%7Bq%7D%7D");
  });

  // Every string over these pieces, up to four of them: the escapes must undo to the same text.
  const pieces = [
    "{{",
    "}}",
    "{",
    "}",
    "%{",
    "%",
    "_open",
    "!",
    "q",
    "{{_open}}",
    "%{_open}",
    "{{!}}",
    "%{!}",
    "{{q}}",
    "%{q}",
  ];
  const texts = (depth: number): string[] =>
    depth === 0
      ? [""]
      : texts(depth - 1).flatMap((text) => ["", ...pieces].map((piece) => text + piece));
  const literals = [...new Set([...texts(3), "{{{", "{{{{q}}}}", "%{{q}}", "{%{q}}", "%{%{q}}"])];

  it("sends every escaped captured request text as captured", () => {
    for (const text of literals) {
      const escaped = escapeTemplates(text);
      const body = renderRequest(
        { url: "https://api.test/", body: escaped },
        { q: "filled" },
        saved,
      );
      expect(body.body).toBe(text);
      expect(unescapeTemplates(escaped)).toBe(text);
    }
  });

  it("runs every escaped recorded step argument as recorded, inputs and workflow vars set", async () => {
    const calls: Record<string, unknown>[] = [];
    await runtime.runPlaybookOp({
      playbook: { id: "steps", provenance: {} },
      op: {
        id: "type",
        effect: "read",
        args: { q: { default: "filled" } },
        provenance: { recentSince: "1h", escaped: true },
        run: [
          {
            using: "workflow",
            steps: literals.map((text) => ({ cmd: "type", args: { text: escapeStepArgs(text) } })),
          },
        ],
      },
      executeTool: async (tool: string, args: Record<string, unknown>) => {
        if (tool === "type") {
          calls.push(args);
        }
        return { output: "{}" };
      },
      sleep: async () => undefined,
    });
    expect(calls.map((args) => args.text)).toEqual(literals);
  });
});

// `{{!}}` and `%{!}` are the escapes: `!` is outside both name grammars, so every name either
// template takes, `_open` included, is filled as before.
describe("the escape token and template names", () => {
  const workflowRuntime = require("../../native/workflow-runtime.cjs");

  it("fills {{_open}} and %{_open} from an input or var of that name", () => {
    expect(
      renderRequest({ url: "https://api.test/{{_open}}", body: "a {{_open}} b" }, { _open: "V" }),
    ).toMatchObject({
      url: "https://api.test/V",
      body: "a V b",
    });
    expect(workflowRuntime.resolveVar("%{_open}", { _open: "INTENDED" })).toBe("INTENDED");
    expect(workflowRuntime.resolveVar("pre%{_open}post", { _open: "INTENDED" })).toBe(
      "preINTENDEDpost",
    );
  });

  it("sends {{!}} as {{ and %{!} as %{ in an op pb save made, which no name can be", () => {
    const body = "{{!}}q}} {{!}}";
    expect(renderRequest({ url: "https://api.test/", body }, {}, saved).body).toBe("{{q}} {{");
    expect(workflowRuntime.resolveVar("%{!}q} %{!}", { q: "filled" }, saved)).toBe("%{q} %{");
    expect(workflowRuntime.resolveVar("%{!}", { "!": "filled" }, saved)).toBe("%{");
    expect(escapeStepArgs("%{_open} {{_open}} %{!} {{!}}")).toBe(
      "%{!}_open} {{!}}_open}} %{!}!} {{!}}!}}",
    );
  });

  // A hand-written op and surf do never held the escape, so they send it as written.
  it("sends {{!}} and %{!} as written anywhere else", async () => {
    const body = "{{!}}q}} {{!}}";
    expect(renderRequest({ url: "https://api.test/", body }, { q: "filled" }).body).toBe(body);
    expect(workflowRuntime.resolveVar("%{!}q} %{!}", { q: "filled" })).toBe("%{!}q} %{!}");
    const typed: unknown[] = [];
    const { fetchImpl, executeTool } = fakeTab();
    await runtime.runPlaybookOp({
      playbook: { id: "manual", provenance: {} },
      op: {
        id: "find",
        effect: "read",
        run: [
          {
            using: "network",
            request: { url: "https://api.test/x{{!}}", query: { q: "{{!}}" } },
            // Fails, so the op goes on to its steps.
            verify: { status: 201 },
          },
          { using: "workflow", steps: [{ cmd: "type", args: { text: "a{{!}}b%{!}c" } }] },
        ],
      },
      executeTool: async (tool: string, args: Record<string, unknown>) => {
        if (tool === "type") {
          typed.push(args.text);
          return { output: "{}" };
        }
        return executeTool(tool, args);
      },
      sleep: async () => undefined,
    });
    const sent = new URL(fetchImpl.mock.calls[0][0]);
    expect(decodeURIComponent(sent.pathname)).toBe("/x{{!}}");
    expect(sent.searchParams.get("q")).toBe("{{!}}");
    expect(typed).toEqual(["a{{!}}b%{!}c"]);
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
