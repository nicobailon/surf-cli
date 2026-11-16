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

// Random requests for requestInputs: text from these pieces at every place renderRequest may fill.
let seed = 7;
const pick = <T>(items: T[]): T => {
  seed = (seed * 48271) % 2147483647;
  return items[seed % items.length];
};
const requestPieces = ["{{a}}", "{{b}}", "x", "{{!}}", "{{!}}a}}", "%{a}"];
const randomText = () => Array.from({ length: pick([1, 2]) }, () => pick(requestPieces)).join("");
const randomValue = (depth: number): unknown => {
  const kind = depth > 2 ? 0 : pick([0, 0, 1, 2]);
  if (kind === 0) {
    return randomText();
  }
  if (kind === 1) {
    return [randomValue(depth + 1)];
  }
  return Object.fromEntries(
    Array.from({ length: pick([1, 2]) }, () => [randomText(), randomValue(depth + 1)]),
  );
};
const randomRequest = () => {
  const shape: Record<string, unknown> = { url: `https://api.test/${randomText()}` };
  for (const field of ["method", "cache", "note"]) {
    if (pick([0, 1])) {
      shape[field] = randomText();
    }
  }
  // A header's value is sent as text, so an object there is sent as [object Object] whatever it holds.
  const fields: Array<[string, () => unknown]> = [
    ["headers", () => ({ [randomText()]: randomText() })],
    ["query", () => ({ [randomText()]: randomValue(1) })],
    ["body", () => randomValue(0)],
  ];
  for (const [field, make] of fields) {
    if (pick([0, 1])) {
      shape[field] = make();
    }
  }
  return shape;
};
const sendOf = (shape: Record<string, unknown>, args: Record<string, string>, options: object) => {
  try {
    return JSON.stringify(renderRequest(shape, args, options));
  } catch (error) {
    return `throws: ${(error as Error).message}`;
  }
};

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

  // pb param stores a JSON param's keys escaped, as its values, so an escaped op's key can take an
  // input; any other op sends its keys as written, as it always has.
  it("fills an escaped op's JSON keys as its values, and leaves any other op's keys as written", () => {
    const { requestInputs } = require("../../native/playbook-template.cjs");
    const request = {
      url: "https://api.test/",
      query: { v: { "{{k}}": "{{n}}", "{{!}}k}}": [{ "a{{k}}": 1 }] } },
      body: { "{{k}}": { "{{!}}!}}": "x" } },
    };
    const args = { k: "K{{!}}%{!}", n: 5 };
    const sent = renderRequest(request, args, saved);
    expect(JSON.parse(sent.query.v)).toEqual({
      "K{{!}}%{!}": 5,
      "{{k}}": [{ "aK{{!}}%{!}": 1 }],
    });
    expect(sent.body).toEqual({ "K{{!}}%{!}": { "{{!}}": "x" } });
    expect(requestInputs(request, { escapes: true })).toEqual(new Set(["k", "n"]));

    const plain = renderRequest(request, args);
    expect(JSON.parse(plain.query.v)).toEqual({
      "{{k}}": 5,
      "{{!}}k}}": [{ "a{{k}}": 1 }],
    });
    expect(requestInputs(request)).toEqual(new Set(["n"]));
    // A key filled to one already there would drop a field: refused.
    expect(() => renderRequest(request, { ...args, k: "{{k}}" }, saved)).toThrow(
      'an input fills a JSON key that is already there: "{{k}}"',
    );
  });

  // requestInputs reads a request as renderRequest fills it: never its method, cache or note (or
  // any field renderRequest passes on as written), nor a header's or query param's name.
  it("counts an input only where renderRequest fills it", () => {
    const { requestInputs } = require("../../native/playbook-template.cjs");
    const request = {
      method: "{{m}}",
      url: "https://api.test/{{u}}",
      cache: "{{c}}",
      note: "{{n}}",
      headers: { "{{hk}}": "{{hv}}", "X-O": { "{{ok}}": "{{ov}}" } },
      query: { "{{qk}}": "{{qv}}", v: { "{{vk}}": 1 } },
      body: { "{{bk}}": ["{{bv}}"] },
    };
    const filled = new Set(["u", "hv", "ov", "qv", "bv"]);
    expect(requestInputs(request)).toEqual(filled);
    expect(requestInputs(request, saved)).toEqual(new Set([...filled, "ok", "vk", "bk"]));
    const values = (names: Set<string>) =>
      Object.fromEntries([...names].map((name, index) => [name, `v${index}`]));
    expect(() =>
      renderRequest(request, values(requestInputs(request, saved)), saved),
    ).not.toThrow();

    // An input counts when its value changes what is sent, or its absence stops the send.
    let compared = 0;
    for (let index = 0; index < 3000; index++) {
      const shape = randomRequest();
      for (const options of [{}, saved]) {
        const base = sendOf(shape, { a: "1", b: "2" }, options);
        if (base.startsWith("throws: an input fills a JSON key")) {
          continue;
        }
        compared++;
        const used = ["a", "b"].filter((name) => {
          const rest: Record<string, string> = { a: "1", b: "2" };
          delete rest[name];
          const changed = sendOf(shape, { a: "1", b: "2", [name]: "9" }, options);
          return changed !== base || sendOf(shape, rest, options) !== base;
        });
        expect([...requestInputs(shape, options)].sort()).toEqual(used);
      }
    }
    expect(compared).toBeGreaterThan(5000);
  });

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

// pb save decodes only the text it stored, once: an input's value is sent as given, wherever the
// op puts it.
describe("an escaped op's input values", () => {
  const values = ["%{!}", "{{!}}", "%{x}", "{{x}}", "%{!}_open}", "a%{q}b", "x{{q}}y"];
  const escapedOp = (run: unknown[]) => ({
    id: "save",
    effect: "read",
    args: { q: {}, items: {}, count: {} },
    provenance: { recordId: "rec-1", escaped: true },
    run,
  });
  const runSteps = async (steps: unknown[], args: Record<string, unknown>) => {
    const typed: unknown[] = [];
    await runtime.runPlaybookOp({
      playbook: { id: "steps", provenance: {} },
      op: escapedOp([{ using: "workflow", steps }]),
      args,
      executeTool: async (tool: string, toolArgs: Record<string, unknown>) => {
        if (tool === "type") {
          typed.push(toolArgs.text);
        }
        return { output: "{}" };
      },
      sleep: async () => undefined,
    });
    return typed;
  };

  it("types each value as given, beside stored text, as a workflow var and in loops", async () => {
    for (const q of values) {
      const typed = await runSteps(
        [
          { cmd: "type", args: { text: "{{q}}" } },
          { cmd: "type", args: { text: escapeStepArgs("<%{q}>").replace("<", "<{{q}}") } },
          { cmd: "type", args: { text: "%{q}|%{q}" } },
          { repeat: "{{count}}", steps: [{ cmd: "type", args: { text: "%{_index}{{q}}" } }] },
          { each: "{{items}}", steps: [{ cmd: "type", args: { text: "[%{item}]" } }] },
        ],
        { q, items: [q, `${q}!`], count: 2 },
      );
      expect(typed).toEqual([q, `<${q}%{q}>`, `${q}|${q}`, `0${q}`, `1${q}`, `[${q}]`, `[${q}!]`]);
    }
  });

  it("iterates a list a step captured as given, never reading its entries", async () => {
    const list = [...values, { q: "{{q}}", r: ["%{!}"] }];
    const typed: unknown[] = [];
    await runtime.runPlaybookOp({
      playbook: { id: "steps", provenance: {} },
      op: escapedOp([
        {
          using: "workflow",
          steps: [
            { cmd: "list", as: "found" },
            { each: "%{found}", steps: [{ cmd: "type", args: { text: "%{item}" } }] },
            { each: ["%{found}"], steps: [{ cmd: "type", args: { text: "%{item}" } }] },
          ],
        },
      ]),
      args: { q: "Q" },
      executeTool: async (tool: string, toolArgs: Record<string, unknown>) => {
        if (tool === "list") {
          return { output: JSON.stringify(list) };
        }
        typed.push(toolArgs.text);
        return { output: "{}" };
      },
      sleep: async () => undefined,
    });
    expect(typed).toEqual([...list, list]);
  });

  it("stops before any step runs when a step embeds an input that isn't set", async () => {
    await expect(
      runSteps(
        [
          { cmd: "type", args: { text: "sent" } },
          { each: "{{items}}", steps: [{ cmd: "type", args: { text: "a {{missing}} b" } }] },
        ],
        { items: ["x"] },
      ),
    ).rejects.toThrow(/missing template argument: missing/);
    const typed: unknown[] = [];
    await expect(
      runtime.runPlaybookOp({
        playbook: { id: "steps", provenance: {} },
        op: escapedOp([
          {
            using: "workflow",
            steps: [
              { cmd: "type", args: { text: "sent" } },
              { cmd: "type", args: { text: "a {{missing}} b" } },
            ],
          },
        ]),
        executeTool: async (_tool: string, toolArgs: Record<string, unknown>) => {
          typed.push(toolArgs.text);
          return { output: "{}" };
        },
        sleep: async () => undefined,
      }),
    ).rejects.toThrow(/missing template argument: missing/);
    expect(typed).toEqual([]);
  });

  it("sends each value as given in a request's URL, query, header and body", () => {
    const request = {
      method: "POST",
      url: "https://api.test/{{!}}x}}/{{q}}",
      query: { q: "{{q}}", note: "{{!}}q}} {{q}}" },
      headers: { "x-q": "pre {{q}}", "content-type": "application/json" },
      body: `${escapeTemplates('{"keep":"{{q}}","v":"')}{{q}}"}`,
    };
    for (const q of values) {
      const sent = renderRequest(request, { q }, saved);
      expect(sent.url).toBe(`https://api.test/{{x}}/${encodeURIComponent(q)}`);
      expect(sent.query).toEqual({ q, note: `{{q}} ${q}` });
      expect(sent.headers["x-q"]).toBe(`pre ${q}`);
      expect(JSON.parse(sent.body)).toEqual({ keep: "{{q}}", v: q });
    }
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

  it("redacts the value from results and errors, one under 4 characters where it stands alone", async () => {
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
