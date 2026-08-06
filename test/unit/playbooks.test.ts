import { afterEach, describe, expect, it, vi } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const playbooks = require("../../native/playbooks.cjs");
const runtime = require("../../native/playbook-runtime.cjs");
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

    const executeTool = vi.fn(async (tool: string) =>
      tool === "javascript_tool" ? { error: "CORS drift" } : { value: "fallback content" },
    );
    const result = await runtime.runPlaybookOp({
      playbook: { id: "fixture", provenance: { scope: "test" } },
      op: {
        id: "read",
        effect: "read",
        args: {},
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
            using: "workflow",
            steps: [
              { tool: "click", args: { selector: "#a" } },
              { tool: "click", args: { selector: "#b" } },
            ],
          },
        ],
      }),
    ).toThrow(/exactly one commit step/);
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

  it("rejects a page-context network request outside the declared origins", async () => {
    const fetchImpl = vi.fn();
    const executeTool = vi.fn(async (_tool: string, args: { code: string }) => {
      const execute = new Function("location", "fetch", `return ${args.code}`);
      return { value: await execute({ href: "https://current.test/page" }, fetchImpl) };
    });
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
      executeTool: async () => ({
        output: JSON.stringify({ ok: true, status: 200, bodyJson: { data: "value" } }),
      }),
    });
    expect(result.value).toBe("value");
  });

  it("injects server idempotency into write network requests", async () => {
    const executeTool = vi.fn(async (_tool: string, args: { code: string }) => {
      expect(args.code).toContain('"Idempotency-Key":"attempt-one"');
      return { output: JSON.stringify({ ok: true, status: 200, bodyJson: { ok: true } }) };
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
    expect(executeTool).toHaveBeenCalledOnce();
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
        executeTool: async () => {
          throw new Error("timeout");
        },
        beforeDispatch: async () => statuses.push("dispatched"),
        afterDispatch: async ({ status }: { status: string }) => statuses.push(status),
      }),
    ).rejects.toThrow(/timeout/);
    expect(statuses).toEqual(["dispatched", "indeterminate"]);
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
