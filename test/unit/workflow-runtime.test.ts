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
});
