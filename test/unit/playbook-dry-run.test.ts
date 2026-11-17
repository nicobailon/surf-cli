import { describe, expect, it } from "vitest";

const runtime = require("../../native/playbook-runtime.cjs");

const playbook = { id: "fixture", origins: ["https://example.test"] };

describe("surf use --dry-run preview", () => {
  it("lists an env header by name and never prints its value", () => {
    const preview = runtime.previewPlaybookOp({
      playbook,
      op: {
        id: "post",
        effect: "write",
        args: { action: { type: "string", required: true } },
        safety: { authorization: "explicit", duplicate: "transactional", key: ["action"] },
        run: [
          {
            using: "network",
            request: {
              method: "post",
              url: "https://example.test/api",
              query: { mode: "{{action}}" },
              headers: { "content-type": "application/json" },
              body: { action: "{{action}}" },
              authInputs: [{ env: "SURF_DRY_RUN_KEY", header: "X-Site-Key", required: true }],
            },
          },
        ],
      },
      args: { action: "same" },
      secrets: { SURF_DRY_RUN_KEY: "dummy-env-value" },
      env: {},
    });

    expect(preview).toEqual({
      playbook: "fixture",
      op: "post",
      effect: "write",
      strategy: "network",
      method: "POST",
      url: "https://example.test/api",
      query: { mode: "same" },
      headers: ["content-type", "X-Site-Key"],
      body: { action: "same" },
      allowedOrigins: ["https://example.test"],
    });
    expect(JSON.stringify(preview)).not.toContain("dummy-env-value");
  });

  it("prints a placeholder the record left as stored, with the refusal the run would give", () => {
    const preview = runtime.previewPlaybookOp({
      playbook,
      op: {
        id: "post",
        effect: "write",
        run: [
          {
            using: "network",
            request: { method: "POST", url: "https://example.test/api", body: "<request-body>" },
          },
        ],
      },
    });

    expect(preview).toMatchObject({ method: "POST", body: "<request-body>" });
    expect(preview.refused).toMatch(/body holds <request-body>/);
  });

  it("gives an absolute URL off the op's origins the refusal the run would give", async () => {
    const op = {
      id: "post",
      effect: "read",
      args: { host: { type: "string", required: true } },
      run: [{ using: "network", request: { method: "POST", url: "https://{{host}}/api" } }],
    };
    const preview = runtime.previewPlaybookOp({
      playbook,
      op,
      args: { host: "evil.test" },
      env: {},
    });
    expect(preview).toMatchObject({
      url: "https://evil.test/api",
      refused: "playbook network origin is not allowed: https://evil.test",
    });
    const sent: string[] = [];
    const run = runtime.runPlaybookOp({
      playbook,
      op,
      args: { host: "evil.test" },
      env: {},
      executeTool: async (cmd: string) => {
        sent.push(cmd);
        return {};
      },
    });
    await expect(run).rejects.toThrow(preview.refused);
    expect(sent).toEqual([]);
    expect(
      runtime.previewPlaybookOp({ playbook, op, args: { host: "example.test" }, env: {} }),
    ).not.toHaveProperty("refused");
  });

  it("prints a workflow op's first step instead of a request", () => {
    const preview = runtime.previewPlaybookOp({
      playbook,
      op: {
        id: "search",
        effect: "read",
        args: { query: { type: "string", required: true } },
        run: [
          {
            using: "workflow",
            steps: [
              { cmd: "type", args: { selector: "#q", text: "{{query}}" } },
              { cmd: "key", args: { key: "Enter" } },
            ],
          },
        ],
      },
      args: { query: "surf" },
    });

    expect(preview).toEqual({
      playbook: "fixture",
      op: "search",
      effect: "read",
      strategy: "workflow",
      step: { cmd: "type", args: { selector: "#q", text: "surf" } },
      allowedOrigins: ["https://example.test"],
    });
  });

  // The step the real run sends first, by its tool and args.
  async function firstDispatch(op: unknown, args: Record<string, string | undefined>) {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    await runtime.runPlaybookOp({
      playbook,
      op,
      args,
      env: {},
      sleep: () => Promise.resolve(),
      executeTool: async (cmd: string, toolArgs: unknown) => {
        calls.push({ cmd, args: toolArgs });
        return { result: { content: [{ type: "text", text: "ok" }] } };
      },
    });
    return calls[0];
  }

  it.each([
    {
      name: "an op pb save escaped",
      op: {
        id: "search",
        effect: "read",
        provenance: { escaped: true },
        args: { text: { type: "string", required: true } },
        run: [
          {
            using: "workflow",
            autoWait: false,
            steps: [
              { cmd: "type", args: { selector: "#q", text: "{{text}} costs {{!}}price}} %{!}y}" } },
            ],
          },
        ],
      },
      args: { text: "hello" },
      text: "hello costs {{price}} %{y}",
    },
    {
      name: "a hand-written op reading its input as a var",
      op: {
        id: "search",
        effect: "read",
        args: { query: { type: "string", required: true } },
        run: [
          {
            using: "workflow",
            autoWait: false,
            steps: [{ cmd: "type", args: { selector: "#q", text: "{{query}} %{query}" } }],
          },
        ],
      },
      args: { query: "surf" },
      text: "surf surf",
    },
  ])("prints the first step of $name as the run sends it", async ({ op, args, text }) => {
    const preview = runtime.previewPlaybookOp({ playbook, op, args, env: {} });
    expect(preview.step).toEqual({ cmd: "type", args: { selector: "#q", text } });
    expect(await firstDispatch(op, args)).toEqual(preview.step);
  });
});
