import { describe, expect, it, vi } from "vitest";

const runtime = require("../../native/workflow-runtime.cjs");

describe("workflow runtime characterization", () => {
  it("preserves variables, loops, until, auto-waits, failures, and redacted events with an injected executor", async () => {
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const events: Array<Record<string, unknown>> = [];
    let checks = 0;
    const result = await runtime.executeWorkflow(
      [
        { cmd: "seed", args: {}, as: "items" },
        { each: "%{items}", as: "item", steps: [{ cmd: "type", args: { text: "%{item}" } }] },
        {
          repeat: 5,
          steps: [{ cmd: "click", args: { ref: "e1" } }],
          until: { cmd: "check", args: {}, as: "done" },
        },
        { cmd: "failing", args: {} },
        { cmd: "last", args: {} },
      ],
      {
        autoWait: true,
        executeTool: vi.fn(async (tool: string, args: Record<string, unknown>) => {
          calls.push({ tool, args });
          if (tool === "seed") {
            return { value: ["one", "two"] };
          }
          if (tool === "check") {
            return { value: ++checks === 2 };
          }
          if (tool === "failing") {
            return { error: "expected failure" };
          }
          return { success: true };
        }),
        onError: "continue",
        onEvent: (event: Record<string, unknown>) => events.push(event),
        sleep: vi.fn(),
        stepDelay: 0,
      },
    );

    expect(result.status).toBe("partial");
    expect(result.vars.items).toEqual(["one", "two"]);
    expect(calls.filter((call) => call.tool === "type").map((call) => call.args.text)).toEqual([
      "one",
      "two",
    ]);
    expect(calls.filter((call) => call.tool === "click")).toHaveLength(2);
    expect(calls.some((call) => call.tool === "wait.dom")).toBe(true);
    expect(calls.at(-1)?.tool).toBe("last");
    expect(events.find((event) => event.command === "type")?.argsRedacted).toEqual({
      text: "<text>",
    });
  });

  it("stops before dispatch when the injected signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const executeTool = vi.fn();
    const result = await runtime.executeWorkflow([{ cmd: "click", args: {} }], {
      executeTool,
      signal: controller.signal,
    });
    expect(result).toMatchObject({ status: "failed", error: "cancelled" });
    expect(executeTool).not.toHaveBeenCalled();
  });

  it.each(["blocked", "uncertain", "failed", "stopped"])(
    "treats semantic status %s as failure and does not execute later steps",
    async (status) => {
      const executeTool = vi.fn();
      const executeSemanticStep = vi.fn(async () => ({ status, reason: "not complete" }));
      const result = await runtime.executeWorkflow(
        [
          { id: "semantic", cmd: "semantic.step", args: { op: "find", target: { query: "x" } } },
          { cmd: "later", args: {} },
        ],
        { executeTool, executeSemanticStep, stepDelay: 0 },
      );

      expect(result).toMatchObject({ status: "failed", completedSteps: 0, error: "not complete" });
      expect(executeSemanticStep).toHaveBeenCalledOnce();
      expect(executeTool).not.toHaveBeenCalled();
    },
  );

  it("keeps one semantic context private and exposes only an explicit public result", async () => {
    const contexts: object[] = [];
    const events: Array<Record<string, unknown>> = [];
    const result = await runtime.executeWorkflow(
      [
        {
          id: "one",
          cmd: "semantic.step",
          as: "first",
          args: { op: "find", target: { query: "x" } },
        },
        { id: "two", cmd: "semantic.step", args: { op: "open", target: { binding: "first" } } },
      ],
      {
        executeTool: vi.fn(),
        executeSemanticStep: vi.fn(async (_step: unknown, context: Record<string, unknown>) => {
          contexts.push(context);
          context.privateBinding = "private-handle-sentinel";
          return {
            status: "completed",
            publicResult: { label: "public metadata" },
            privateBinding: "private-handle-sentinel",
          };
        }),
        onEvent: (event: Record<string, unknown>) => events.push(event),
      },
    );

    expect(result.status).toBe("completed");
    expect(contexts[0]).toBe(contexts[1]);
    expect(result.vars).toEqual({ first: { label: "public metadata" } });
    expect(JSON.stringify({ result, events })).not.toContain("private-handle-sentinel");
  });

  it("does not substitute public variables into semantic arguments", async () => {
    const executeSemanticStep = vi.fn(async (step) => {
      expect(step.args.target.query).toBe("%{privateSlot}");
      return { status: "verified" };
    });
    await runtime.executeWorkflow(
      [
        {
          id: "one",
          cmd: "semantic.step",
          args: { op: "find", target: { query: "%{privateSlot}" } },
        },
      ],
      {
        vars: { privateSlot: "private-value-sentinel" },
        executeTool: vi.fn(),
        executeSemanticStep,
      },
    );
    expect(executeSemanticStep).toHaveBeenCalledOnce();
  });

  it("rejects continue-on-error semantic execution before either executor runs", async () => {
    const executeTool = vi.fn();
    const executeSemanticStep = vi.fn();
    const result = await runtime.executeWorkflow(
      [{ id: "one", cmd: "semantic.step", args: { op: "find", target: { query: "x" } } }],
      { onError: "continue", executeTool, executeSemanticStep },
    );
    expect(result).toMatchObject({
      status: "failed",
      completedSteps: 0,
      error: "semantic workflows require onError='stop'",
    });
    expect(executeTool).not.toHaveBeenCalled();
    expect(executeSemanticStep).not.toHaveBeenCalled();
  });
});
