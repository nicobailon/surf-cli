import { afterEach, describe, expect, it, vi } from "vitest";
import { captureTab } from "../fixtures/capture-tab";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const playbooks = require("../../native/playbooks.cjs");
const runtime = require("../../native/playbook-runtime.cjs");
const receipts = require("../../native/playbook-receipts.cjs");
const tempDirs: string[] = [];

function writePlaybook(base: string, id: string, marker: string) {
  const directory = path.join(base, ".surf", "playbooks", id);
  fs.mkdirSync(path.join(directory, "ops"), { recursive: true });
  fs.writeFileSync(
    path.join(directory, "playbook.json"),
    JSON.stringify({ id, version: "1.0.0", description: marker }),
  );
  fs.writeFileSync(
    path.join(directory, "ops", "read.json"),
    JSON.stringify({
      id: "read",
      effect: "read",
      run: [{ using: "workflow", steps: [{ tool: "page.text", args: {}, as: "text" }] }],
    }),
  );
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("playbook resolution and strategies", () => {
  it("resolves project over user and falls back from a drifting network strategy to workflow", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "surf-playbook-project-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "surf-playbook-home-"));
    tempDirs.push(cwd, home);
    writePlaybook(home, "fixture", "user");
    writePlaybook(cwd, "fixture", "project");
    const resolved = playbooks.resolvePlaybook("fixture", { cwd, home });
    expect(resolved.provenance.scope).toBe("project");
    expect(resolved.description).toBe("project");

    const executeTool = vi.fn(async (tool: string) => {
      if (tool === "network") {
        return { entries: [] };
      }
      return tool === "javascript_tool" ? { error: "CORS drift" } : { value: "fallback content" };
    });
    const result = await runtime.runPlaybookOp({
      playbook: { id: "fixture", provenance: { scope: "test" } },
      op: {
        id: "read",
        effect: "read",
        args: { label: {} },
        run: [
          { using: "network", request: { method: "GET", url: "/api" } },
          {
            using: "workflow",
            steps: [{ cmd: "page.text", args: { label: "{{label}}" }, as: "text" }],
            extract: { jsonPath: "$.vars.text" },
            expect: { truthy: true },
            stepDelay: 0,
          },
        ],
      },
      args: { label: "fallback" },
      executeTool,
      sleep: vi.fn(),
    });
    expect(result).toMatchObject({
      status: "completed",
      strategy: "workflow",
      value: "fallback content",
    });
    expect(result.attempts[0]).toMatchObject({ using: "network", error: "CORS drift" });
    expect(executeTool).toHaveBeenCalledWith("page.text", { label: "fallback" }, expect.anything());
  });

  it("returns a workflow op's captured outputs, never its inputs", async () => {
    const executeTool = vi.fn(async (tool: string) =>
      tool === "page.text" ? { value: "page words" } : { success: true },
    );
    const op = (steps: Array<Record<string, unknown>>) => ({
      id: "search",
      effect: "read",
      args: { query: {} },
      run: [{ using: "workflow", steps, stepDelay: 0 }],
    });
    const use = (steps: Array<Record<string, unknown>>) =>
      runtime.runPlaybookOp({
        playbook: { id: "fixture", provenance: { scope: "test" } },
        op: op(steps),
        args: { query: "dummy-input-delta" },
        executeTool,
        sleep: vi.fn(),
      });
    const typed = { cmd: "type", args: { selector: "#q", text: "{{query}}" } };
    const captured = await use([typed, { cmd: "page.text", args: {}, as: "content" }]);
    expect(captured.status).toBe("completed");
    expect(captured.value.vars).toEqual({ content: "page words" });
    expect(JSON.stringify(captured)).not.toContain("dummy-input-delta");
    const bare = await use([typed]);
    expect(bare.value).not.toHaveProperty("vars");
    expect(JSON.stringify(bare)).not.toContain("dummy-input-delta");
    expect(executeTool).toHaveBeenCalledWith(
      "type",
      { selector: "#q", text: "dummy-input-delta" },
      expect.anything(),
    );
  });

  it("never sends a redacted placeholder: the network strategy refuses and the workflow runs", async () => {
    const executeTool = vi.fn(async (tool: string) =>
      tool === "page.text" ? { value: "page words" } : { success: true },
    );
    const result = await runtime.runPlaybookOp({
      playbook: { id: "fixture", provenance: { scope: "test" } },
      op: {
        id: "search",
        effect: "read",
        args: { text: { required: true } },
        run: [
          {
            using: "network",
            request: { method: "GET", url: "https://example.test/get", query: { q: "<text>" } },
          },
          {
            using: "workflow",
            stepDelay: 0,
            steps: [
              { cmd: "type", args: { selector: "#q", text: "{{text}}" } },
              { cmd: "page.text", args: {}, as: "content" },
            ],
          },
        ],
      },
      args: { text: "dummy-input-echo" },
      executeTool,
      sleep: vi.fn(),
    });
    expect(result.strategy).toBe("workflow");
    expect(result.attempts[0].error).toMatch(
      /query\.q holds <text>, a value the record redacted; run surf pb param fixture search query\.q --as <name>/,
    );
    expect(executeTool).not.toHaveBeenCalledWith(
      "javascript_tool",
      expect.anything(),
      expect.anything(),
    );
  });

  it("defaults protected writes to explicit authorization and uses op auth origins", () => {
    const op = playbooks.validateOp(
      {
        id: "mutate",
        effect: "write",
        auth: { requiresSession: true, origins: ["https://example.test"] },
        safety: { duplicate: "transactional", key: ["resourceId"] },
        run: [
          {
            using: "network",
            request: { method: "POST", url: "https://example.test/api" },
          },
        ],
      },
      { origins: [] },
    );
    expect(op.safety.authorization).toBe("explicit");
    expect(op.origins).toEqual(["https://example.test"]);
  });

  // A write op may replay PUT, PATCH and DELETE; a read op can't.
  it.each([["PUT"], ["patch"], ["DELETE"]])("refuses a read op that sends %s", (method) => {
    const op = (effect: string) => ({
      id: "update",
      effect,
      ...(effect === "write" ? { safety: { duplicate: "transactional", key: ["id"] } } : {}),
      run: [{ using: "network", request: { method, url: "https://example.test/items/7" } }],
    });
    expect(() => playbooks.validateOp(op("read"), { origins: [] })).toThrow(
      "read ops cannot use a mutating network method",
    );
    expect(playbooks.validateOp(op("write"), { origins: [] }).run[0].request.method).toBe(
      method.toUpperCase(),
    );
  });

  it("takes a write without a safety key, whose claim covers every input, and refuses an empty one", () => {
    const write = (safety: Record<string, unknown>) =>
      playbooks.validateOp(
        {
          id: "mutate",
          effect: "write",
          safety,
          run: [{ using: "network", request: { method: "POST", url: "https://example.test/api" } }],
        },
        { origins: ["https://example.test"] },
      );
    expect(write({ duplicate: "repeatable-window", windowMs: 300_000 }).safety).toEqual({
      authorization: "explicit",
      duplicate: "repeatable-window",
      windowMs: 300_000,
    });
    expect(() => write({ duplicate: "transactional", key: [] })).toThrow(
      "write op mutate safety key must list inputs; leave it out to cover every input",
    );
  });

  it("rejects literal credentials and unsafe write workflows", () => {
    const validate = (op: unknown) => playbooks.validateOp(op, { origins: [] });
    expect(
      validate({
        id: "search",
        effect: "read",
        run: [
          { using: "network", request: { method: "POST", url: "https://example.test/search" } },
        ],
      }).run[0].request.method,
    ).toBe("POST");
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      expect(() =>
        validate({
          id: "search",
          effect: "read",
          run: [{ using: "network", request: { method, url: "https://example.test/search" } }],
        }),
      ).toThrow(/read ops cannot use a mutating network method/);
    }
    expect(() =>
      validate({
        id: "read",
        run: [
          {
            using: "network",
            request: { method: "GET", url: "https://example.test/api?access_token=captured" },
          },
        ],
      }),
    ).toThrow(/auth input/);
    expect(() =>
      validate({
        id: "mutate",
        effect: "write",
        safety: { duplicate: "transactional", key: ["id"] },
        run: [
          {
            using: "script",
            script:
              "return await tools.run('commit', { tool: 'click', args: { selector: '#submit' } })",
          },
        ],
      }),
    ).toThrow(/script strategy is not supported/);
    expect(
      validate({
        id: "mutate",
        effect: "write",
        safety: {
          duplicate: "transactional",
          key: ["id"],
          serverIdempotency: { header: "Idempotency-Key" },
        },
        run: [{ using: "workflow", steps: [{ tool: "click", args: { selector: "#submit" } }] }],
      }).safety.serverIdempotency,
    ).toEqual({ header: "Idempotency-Key" });
  });

  it("requires opt-in before running trusted script strategies", async () => {
    await expect(
      runtime.runPlaybookOp({
        playbook: { id: "fixture", provenance: { scope: "test" } },
        op: {
          id: "read",
          effect: "read",
          args: {},
          run: [
            {
              using: "script",
              script: "return input.constructor.constructor('return process')()",
            },
          ],
        },
        executeTool: vi.fn(),
      }),
    ).rejects.toThrow(/--allow-script/);
  });

  it("aborts in-flight script tool calls when the script times out", async () => {
    let toolSignal: AbortSignal | undefined;
    let markDispatched: () => void = () => undefined;
    const toolDispatched = new Promise<void>((resolve) => {
      markDispatched = resolve;
    });
    const run = runtime.runPlaybookOp({
      playbook: { id: "fixture", provenance: { scope: "test" } },
      op: {
        id: "read",
        effect: "read",
        args: {},
        run: [
          {
            using: "script",
            timeoutMs: 1000,
            script: `return await tools.run("hang", { tool: "page.text", args: {} });`,
          },
        ],
      },
      executeTool: vi.fn(
        async (
          _tool: string,
          _args: Record<string, unknown>,
          options?: { signal?: AbortSignal },
        ) => {
          toolSignal = options?.signal;
          markDispatched();
          return await new Promise(() => undefined);
        },
      ),
      sleep: vi.fn(),
      allowScript: true,
    });

    await toolDispatched;
    await expect(run).rejects.toThrow(/timed out/);
    expect(toolSignal).toBeDefined();
    expect(toolSignal?.aborted).toBe(true);
  });

  it("runs a trusted script strategy with dynamic Surf tool calls", async () => {
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const executeTool = vi.fn(async (tool: string, args: Record<string, unknown>) => {
      calls.push({ tool, args });
      if (tool === "page.text") {
        return { value: "page content" };
      }
      if (tool === "click") {
        return { value: args.selector };
      }
      return { value: true };
    });

    const op = playbooks.validateOp(
      {
        id: "read",
        effect: "read",
        args: { selectors: { required: true } },
        run: [
          {
            using: "script",
            stepDelay: 0,
            script: [
              `const page = await tools.run("page", { tool: "page.text", args: {} });`,
              `const clicked = await tools.all(input.selectors.map((selector) => ({ key: "click-" + selector.slice(1), tool: "click", args: { selector } })));`,
              `emit({ clicked: clicked.length });`,
              `return { page: page.output, selectors: clicked.map((entry) => entry.output) };`,
            ],
          },
        ],
        expect: { truthy: true },
      },
      { origins: [] },
    );

    const result = await runtime.runPlaybookOp({
      playbook: { id: "fixture", provenance: { scope: "test" } },
      op,
      args: { selectors: ["#a", "#b"] },
      executeTool,
      sleep: vi.fn(),
      allowScript: true,
    });

    expect(result).toMatchObject({
      status: "completed",
      strategy: "script",
      value: { page: "page content", selectors: ["#a", "#b"] },
    });
    expect(calls.filter((call) => call.tool === "click").map((call) => call.args.selector)).toEqual(
      ["#a", "#b"],
    );
    expect(calls.some((call) => call.tool === "wait.dom")).toBe(true);
  });

  it("rejects inputs the op does not define before any strategy runs", async () => {
    const op = {
      id: "thread",
      effect: "read",
      args: { url: { required: true }, limit: { default: 10 } },
      run: [{ using: "workflow", steps: [{ cmd: "page.text", args: {}, as: "text" }] }],
    };
    expect(runtime.resolveArgs(op, { url: "https://x.test" })).toEqual({
      url: "https://x.test",
      limit: 10,
    });
    expect(() =>
      runtime.resolveArgs(op, { url: "https://x.test", lmit: 5 }, { playbookId: "x" }),
    ).toThrow(
      "Unknown input --lmit for x thread. Did you mean --limit? Its inputs: --url (required), --limit",
    );
    expect(() =>
      runtime.resolveArgs(
        { id: "read", effect: "read", run: [] },
        { bogus: 1 },
        { playbookId: "page" },
      ),
    ).toThrow("Unknown input --bogus for page read. It takes no inputs");
    const executeTool = vi.fn();
    await expect(
      runtime.runPlaybookOp({
        playbook: { id: "x", provenance: { scope: "test" } },
        op,
        args: { url: "https://x.test", zzz: true },
        executeTool,
      }),
    ).rejects.toThrow("Unknown input --zzz for x thread. Its inputs: --url (required), --limit");
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("leaves surf's global flags out of the input check, and gives them to ops that declare them", () => {
    const read = { id: "read", effect: "read", run: [] };
    expect(
      runtime.resolveArgs(
        read,
        { timeout: 30, "no-diff": true, "window-id": 5, settle: 500 },
        { playbookId: "page" },
      ),
    ).toEqual({});
    const ask = { id: "ask", effect: "read", args: { timeout: { default: 60 } }, run: [] };
    expect(runtime.resolveArgs(ask, { timeout: 30, "no-diff": true })).toEqual({ timeout: 30 });
    expect(runtime.resolveArgs(ask, {})).toEqual({ timeout: 60 });
    expect(() =>
      runtime.resolveArgs(read, { "no-diff": true, bogus: 1 }, { playbookId: "page" }),
    ).toThrow("Unknown input --bogus for page read. It takes no inputs");
  });

  it("rejects a page-context network request outside the declared origins", async () => {
    const { fetchImpl, executeTool } = captureTab({ href: "https://current.test/page" });
    await expect(
      runtime.runPlaybookOp({
        playbook: { id: "fixture", provenance: { scope: "test" } },
        op: {
          id: "read",
          effect: "read",
          args: {},
          origins: ["https://allowed.test"],
          run: [
            {
              using: "network",
              request: { method: "GET", url: "https://other.test/api" },
            },
          ],
        },
        executeTool,
      }),
    ).rejects.toThrow(/origin is not allowed/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("verifies the HTTP response while returning an extracted value", async () => {
    const result = await runtime.runPlaybookOp({
      playbook: { id: "fixture", provenance: { scope: "test" } },
      op: {
        id: "read",
        effect: "read",
        args: {},
        run: [
          {
            using: "network",
            request: { method: "GET", url: "/api" },
            extract: { jsonPath: "$.data" },
            verify: { status: 200, truthy: true },
          },
        ],
      },
      executeTool: captureTab({ reply: () => ({ body: JSON.stringify({ data: "value" }) }) })
        .executeTool,
    });
    expect(result.value).toBe("value");
  });

  it("injects server idempotency into write network requests", async () => {
    const tab = captureTab({ reply: () => ({ body: JSON.stringify({ ok: true }) }) });
    const executeTool = vi.fn(async (tool: string, args: { code: string }) => {
      if (tool === "javascript_tool") {
        expect(args.code).toContain('"Idempotency-Key":"attempt-one"');
      }
      return tab.executeTool(tool, args);
    });
    await runtime.runPlaybookOp({
      playbook: { id: "fixture", provenance: { scope: "test" } },
      op: {
        id: "mutate",
        effect: "write",
        args: {},
        safety: {
          duplicate: "transactional",
          key: ["id"],
          serverIdempotency: { header: "Idempotency-Key" },
        },
        run: [
          {
            using: "network",
            request: { method: "POST", url: "https://example.test/api" },
            expect: { truthy: true },
          },
        ],
      },
      args: {},
      attemptId: "attempt-one",
      executeTool,
    });
    expect(executeTool.mock.calls.filter(([tool]) => tool === "javascript_tool")).toHaveLength(1);
  });

  it("distinguishes pre-dispatch write failures from ambiguous dispatched failures", async () => {
    const statuses: string[] = [];
    await expect(
      runtime.runPlaybookOp({
        playbook: { id: "fixture", provenance: { scope: "test" } },
        op: {
          id: "mutate",
          effect: "write",
          args: {},
          run: [{ using: "network", request: { method: "POST", url: "/{{missing}}" } }],
        },
        executeTool: vi.fn(),
        beforeDispatch: async () => statuses.push("dispatched"),
        afterDispatch: async ({ status }: { status: string }) => statuses.push(status),
      }),
    ).rejects.toThrow(/missing template argument/);
    expect(statuses).toEqual(["not_dispatched"]);

    statuses.length = 0;
    await expect(
      runtime.runPlaybookOp({
        playbook: { id: "fixture", provenance: { scope: "test" } },
        op: {
          id: "mutate",
          effect: "write",
          args: {},
          run: [{ using: "network", request: { method: "POST", url: "https://example.test/api" } }],
        },
        executeTool: async (tool: string) => {
          if (tool === "network") {
            return { entries: [] };
          }
          throw new Error("timeout");
        },
        beforeDispatch: async () => statuses.push("dispatched"),
        afterDispatch: async ({ status }: { status: string }) => statuses.push(status),
      }),
    ).rejects.toThrow(/timeout/);
    expect(statuses).toEqual(["dispatched", "indeterminate"]);
  });

  // A write op's workflow may type and then click. Its receipt starts at the first step that can
  // commit (click, submit, key, type --submit…), so a failed fill leaves none and a failure at or
  // after that step is in doubt.
  describe("a write op whose workflow has several steps", () => {
    const writeOp = (steps: Array<Record<string, unknown>>) =>
      playbooks.validateOp(
        {
          id: "comment",
          effect: "write",
          args: { text: { required: true } },
          safety: { duplicate: "repeatable-window", windowMs: 300_000 },
          run: [{ using: "workflow", steps }],
        },
        { origins: ["https://example.test"] },
      );
    const typed = { tool: "type", args: { selector: "#comment", text: "{{text}}" } };
    const send = { tool: "click", args: { selector: "#send" } };
    const read = { tool: "page.text", args: {} };
    // As host.cjs runs a write: checked first, a receipt reserved when a step can commit.
    const run = async (steps: Array<Record<string, unknown>>, failing?: string) => {
      const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surf-multi-step-")), "state");
      tempDirs.push(path.dirname(root));
      const op = writeOp(steps);
      const claim = {
        playbookId: "fixture",
        op,
        args: { text: ["dummy", "note"].join("-") },
        root,
      };
      receipts.checkReceipt(claim);
      let receipt: unknown = null;
      const tools: string[] = [];
      const outcome = await runtime
        .runPlaybookOp({
          playbook: { id: "fixture", provenance: { scope: "test" } },
          op,
          args: claim.args,
          executeTool: async (tool: string) => {
            tools.push(tool);
            return tool === failing ? { error: `${tool} failed` } : { success: true };
          },
          sleep: async () => undefined,
          beforeDispatch: async () => {
            receipt = receipts.reserveReceipt(claim);
            receipts.updateReceipt(receipt, "dispatched", {}, root);
          },
          afterDispatch: async ({ status, error }: { status: string; error?: string }) =>
            receipts.updateReceipt(receipt, status, { error }, root),
        })
        .then(
          () => "completed",
          (error: Error) => error.message,
        );
      const saved = (receipt as { receipt?: { status: string } } | null)?.receipt?.status ?? "none";
      const again = (() => {
        try {
          receipts.checkReceipt(claim);
          return "clear";
        } catch (error) {
          return (error as Error).message;
        }
      })();
      return {
        outcome,
        tools: tools.filter((tool) => !tool.startsWith("wait.")),
        receipt: saved,
        again,
      };
    };

    it("loads with a type and a click, and runs both", async () => {
      expect(writeOp([typed, send]).run[0].steps.map((step: { cmd: string }) => step.cmd)).toEqual([
        "type",
        "click",
      ]);
      const result = await run([typed, send]);
      expect(result).toMatchObject({
        outcome: "completed",
        tools: ["type", "click"],
        receipt: "verified",
      });
      expect(result.again).toMatch(/succeeded\. Add --repeat/);
    });

    it("leaves no receipt when its type step fails", async () => {
      expect(await run([typed, send], "type")).toEqual({
        outcome: expect.stringContaining("type failed"),
        tools: ["type"],
        receipt: "none",
        again: "clear",
      });
    });

    it.each(["click", "page.text"])(
      "leaves an in-doubt receipt when its %s step fails",
      async (failing) => {
        const result = await run([typed, send, read], failing);
        expect(result.outcome).toContain(`${failing} failed`);
        expect(result.receipt).toBe("indeterminate");
        expect(result.again).toMatch(/its result is unknown\. .*--repeat/);
      },
    );

    // Fills, reads and navigation come before the commit; any other page write or unknown step is it.
    it.each([
      ["smart_type", { selector: "#q", text: "{{text}}" }, "none"],
      ["form_input", { ref: "e1", value: "{{text}}" }, "none"],
      ["form.fill", { data: "{}" }, "none"],
      ["select", { selector: "#size", values: "m" }, "none"],
      ["navigate", { url: "https://example.test/" }, "none"],
      ["scroll.bottom", {}, "none"],
      ["type", { selector: "#q", text: "{{text}}", submit: true }, "indeterminate"],
      ["key", { key: "Enter" }, "indeterminate"],
      ["submit", {}, "indeterminate"],
      ["check", { ref: "e1" }, "indeterminate"],
      ["dialog.accept", {}, "indeterminate"],
      ["js", { code: "1" }, "indeterminate"],
    ])("a failed %s step %o leaves receipt %s", async (tool, args, receipt) => {
      expect((await run([{ tool, args }, send], tool)).receipt).toBe(receipt);
    });

    it("loads when its only step is scroll.bottom", () => {
      expect(writeOp([{ tool: "scroll.bottom", args: {} }]).run[0].steps).toEqual([
        { cmd: "scroll.bottom", args: {} },
      ]);
    });
  });

  it("runs an api strategy with op args in its options and record fields in its templates", async () => {
    const entries: Array<Record<string, unknown>> = [];
    const executeTool = vi.fn(async (tool: string, args: Record<string, unknown>) => {
      if (tool === "navigate") {
        entries.push({
          id: "r_1",
          url: "https://site.test/api/item?id=7",
          status: 200,
          _loadingFinished: true,
        });
        return { success: true };
      }
      if (tool === "network") {
        return { entries };
      }
      if (tool === "network.body") {
        return { body: JSON.stringify({ item: { id: "7", owner: "ann" } }) };
      }
      throw new Error(`unexpected ${tool} ${JSON.stringify(args)}`);
    });
    const op = playbooks.validateOp(
      {
        id: "item",
        args: { url: { required: true }, owner: { required: true } },
        run: [
          {
            using: "api",
            open: "{{url}}",
            match: "/api/item",
            records: {
              find: { exists: ["id"] },
              key: "id",
              fields: {
                id: "id",
                owner: "owner",
                link: { template: "https://site.test/{{owner}}/{{id}}" },
              },
              keep: { owner: "{{owner}}" },
            },
          },
        ],
      },
      { origins: [] },
    );
    const result = await runtime.runPlaybookOp({
      playbook: { id: "site", provenance: { scope: "test" } },
      op,
      args: { url: "https://site.test/item/7", owner: "ann" },
      executeTool,
      sleep: async () => undefined,
    });
    expect(result.value).toEqual([{ id: "7", owner: "ann", link: "https://site.test/ann/7" }]);
    expect(executeTool).toHaveBeenCalledWith("navigate", { url: "https://site.test/item/7" });
  });

  it("rejects malformed api and collect strategies and markdown specs", () => {
    const validate = (fields: Record<string, unknown>) =>
      playbooks.validateOp(
        {
          id: "read",
          run: [
            {
              using: "api",
              match: "/api/*",
              records: { find: { exists: ["id"] }, key: "id", fields: { id: "id" } },
            },
          ],
          ...fields,
        },
        { origins: [] },
      );
    expect(() => validate({})).not.toThrow();
    const api = (strategy: Record<string, unknown>) =>
      validate({ run: [{ using: "api", ...strategy }] });
    expect(() =>
      api({
        match: "api/*",
        records: { find: { exists: ["id"] }, key: "id", fields: { id: "id" } },
      }),
    ).toThrow(/op read api strategy: match "api\/\*" must start with \//);
    expect(() => api({ match: "/api/*" })).toThrow(/api strategy needs records/);
    expect(() => api({ match: "/api/*", pages: 3, records: {} })).toThrow(/unknown key "pages"/);
    expect(() => validate({ run: [{ using: "collect", item: "li", key: ":scope" }] })).toThrow(
      /op read collect strategy: collect fields must map at least one field/,
    );
    expect(() => validate({ markdown: { body: "text", color: "red" } })).toThrow(
      /op read markdown has unknown key "color"/,
    );
  });

  it("exports and imports validated playbook directories", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "surf-playbook-project-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "surf-playbook-home-"));
    const otherHome = fs.mkdtempSync(path.join(os.tmpdir(), "surf-playbook-home-"));
    tempDirs.push(cwd, home, otherHome);
    writePlaybook(cwd, "fixture", "project");
    const exported = playbooks.exportPlaybookDirectory("fixture", {
      cwd,
      home,
      out: path.join(cwd, "exported-fixture"),
    });
    const imported = playbooks.importPlaybookDirectory(exported.directory, { home: otherHome });
    expect(playbooks.resolvePlaybook("fixture", { home: otherHome }).description).toBe("project");
    expect(imported.scope).toBe("user");
  });
});
