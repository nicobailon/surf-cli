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

  it("preserves redacted semantic failure detail in workflow JSON", async () => {
    const result = await runtime.executeWorkflow(
      [{ id: "add", cmd: "semantic.step", args: { op: "click" } }],
      {
        executeTool: vi.fn(),
        executeSemanticStep: vi.fn(async () => ({
          status: "blocked",
          reason: "outcome_unknown",
          runId: "run-1",
          write: { state: "dispatch_unknown", replayAllowed: false },
          usage: { providerCalls: 3, partial: true },
        })),
      },
    );
    expect(result).toMatchObject({
      status: "failed",
      error: "outcome_unknown",
      semantic: {
        runId: "run-1",
        stepId: "add",
        reason: "outcome_unknown",
        write: { state: "dispatch_unknown", replayAllowed: false },
        usage: { providerCalls: 3, partial: true },
      },
    });
  });

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

describe("workflow result variables", () => {
  const executeTool = vi.fn(async (tool: string) => {
    if (tool === "page.text") {
      return { value: "page words" };
    }
    return tool === "fail" ? { error: "expected failure" } : { success: true };
  });
  const run = (steps: Array<Record<string, unknown>>, onError = "stop") =>
    runtime.executeWorkflow(steps, {
      executeTool,
      onError,
      sleep: vi.fn(),
      stepDelay: 0,
      vars: { query: "dummy-input-bravo" },
      context: { vars: { other: "dummy-input-charlie" } },
    });

  it("returns the values steps capture with as, never the inputs", async () => {
    const result = await run([
      { cmd: "type", args: { text: "%{query}" } },
      { cmd: "page.text", args: {}, as: "content" },
    ]);
    expect(result.status).toBe("completed");
    expect(result.vars).toEqual({ content: "page words" });
    expect(JSON.stringify(result)).not.toMatch(/dummy-input/);
  });

  it("returns no vars when no step captures one, completed or failed", async () => {
    const completed = await run([{ cmd: "type", args: { text: "%{query}" } }]);
    expect(completed.status).toBe("completed");
    expect(completed).not.toHaveProperty("vars");
    const failed = await run([{ cmd: "fail", args: {} }]);
    expect(failed.status).toBe("failed");
    expect(failed).not.toHaveProperty("vars");
  });
});

describe("a capture named like an input", () => {
  it("is returned even when it equals the input, and an uncaptured input never is", async () => {
    const result = await runtime.executeWorkflow(
      [
        { cmd: "page.text", args: {}, as: "content" },
        { cmd: "fail", args: {}, as: "missing" },
      ],
      {
        executeTool: vi.fn(async (tool: string) =>
          tool === "page.text" ? { value: "same words" } : { error: "expected failure" },
        ),
        onError: "continue",
        sleep: vi.fn(),
        stepDelay: 0,
        vars: { content: "same words", missing: "dummy-input-foxtrot" },
      },
    );
    expect(result.vars).toEqual({ content: "same words" });
    expect(JSON.stringify(result)).not.toContain("dummy-input-foxtrot");
  });
});

describe("a loop step's capture", () => {
  it("never returns an input under a capture name the failed step didn't fill", async () => {
    const tool = vi.fn(async (name: string) =>
      name === "page.text" ? { value: "loop words" } : { error: "expected failure" },
    );
    const options = {
      executeTool: tool,
      onError: "continue",
      sleep: vi.fn(),
      stepDelay: 0,
      vars: { missing: "dummy-input-hotel", content: "dummy-input-india" },
    };
    const repeat = await runtime.executeWorkflow(
      [
        {
          repeat: 2,
          steps: [
            { cmd: "fail", args: {}, as: "missing" },
            { cmd: "page.text", args: {}, as: "content" },
          ],
        },
      ],
      options,
    );
    expect(repeat.vars).toEqual({ content: "loop words" });
    const each = await runtime.executeWorkflow(
      [{ each: ["a"], as: "item", steps: [{ cmd: "fail", args: {}, as: "missing" }] }],
      options,
    );
    expect(each).not.toHaveProperty("vars");
    expect(JSON.stringify([repeat, each])).not.toContain("dummy-input");
  });
});

// startingVars must name exactly the vars the runtime reads from the ones a workflow starts with
// (pb param keeps an op's input by it): one counts when, for some outcome of the steps, its value
// changes what the steps send.
describe("startingVars", () => {
  let seed = 11;
  const pick = <T>(items: T[]): T => {
    seed = (seed * 48271) % 2147483647;
    return items[seed % items.length];
  };
  const randomText = () =>
    Array.from({ length: pick([1, 2]) }, () =>
      pick(["%{text}", "%{x}", "%{item}", "%{_index}", "%{!}", "z"]),
    ).join("");
  const randomStep = (depth: number): unknown => {
    const kind = depth > 1 ? 0 : pick([0, 0, 0, 1, 2]);
    const as = pick([undefined, undefined, "text", "x", "item"]);
    const captures = as ? { as } : {};
    if (kind === 0) {
      return { cmd: "hover", args: { selector: randomText() }, ...captures };
    }
    if (kind === 1) {
      const until = pick([undefined, { cmd: "js", args: { code: randomText() } }]);
      const repeat = pick([1, 2, "%{text}", "%{x}"]);
      return { repeat, steps: randomSteps(depth + 1), ...(until ? { until } : {}) };
    }
    // A text each is a list only when a capture holds one: steps after one that isn't never run.
    const each = pick([[1], ["%{text}", "z"], [{ deep: "%{text}" }]]);
    // Its first step sends the item, so a list's value is sent wherever it is read.
    const item = { cmd: "hover", args: { selector: `%{${as || "item"}}` } };
    return { each, steps: [item, ...randomSteps(depth + 1)], ...captures };
  };
  const randomSteps = (depth: number): unknown[] =>
    Array.from({ length: pick([1, 2, 3]) }, () => randomStep(depth));
  // Each tool call k fails or answers by its bit in the outcome masks.
  const sent = async (
    steps: unknown[],
    text: string,
    options: object,
    fails: number,
    answers: number,
  ) => {
    const calls: string[] = [];
    const result = await runtime.executeWorkflow(steps, {
      ...options,
      autoWait: false,
      stepDelay: 0,
      vars: { text },
      inputs: { text },
      executeTool: async (tool: string, args: unknown) => {
        const call = calls.push(JSON.stringify([tool, args])) - 1;
        if ((fails >> call) & 1) {
          return { error: "dummy failure" };
        }
        return { output: (answers >> call) & 1 ? "y" : "" };
      },
    });
    return JSON.stringify([calls, result.status, result.error]);
  };

  // A loop's capture reaches the steps after it only when the loop ran and the capture is set,
  // which the steps can't tell, so a var read after one counts: exact only without such a capture.
  const loopCaptures = (steps: unknown[], inLoop = false): boolean =>
    steps.some((step) => {
      const { as, steps: body, each } = step as { as?: string; steps?: unknown[]; each?: unknown };
      if (body) {
        return loopCaptures(body, true);
      }
      return inLoop && as === "text" && each === undefined;
    });

  // Whether some outcome of the steps sends a different call for --text 1 than for 2.
  const sendsText = async (steps: unknown[], options: object) => {
    for (let outcome = 0; outcome < 48; outcome++) {
      const fails = outcome === 0 ? 0 : pick([0, 1, 2, 4, 8, 16, 5, 10, 255]);
      const answers = pick([0, 0, 1, 2, 3, 255]);
      const one = await sent(steps, "1", options, fails, answers);
      if (one !== (await sent(steps, "2", options, fails, answers))) {
        return true;
      }
    }
    return false;
  };

  it("names a var exactly when some outcome of the steps sends it", async () => {
    const counts = { read: 0, unread: 0, kept: 0 };
    for (let index = 0; index < 400; index++) {
      const steps = randomSteps(0);
      for (const options of [
        { escapes: false, onError: "stop" },
        { escapes: true, onError: "stop" },
        { escapes: true, onError: "continue" },
      ]) {
        const read = await sendsText(steps, options);
        const named = runtime.startingVars(steps, options).has("text");
        if (loopCaptures(steps)) {
          // Never fewer than the runtime reads.
          expect({ steps, options, named: named || !read }).toEqual({
            steps,
            options,
            named: true,
          });
          counts.kept += Number(named && !read);
          continue;
        }
        counts[read ? "read" : "unread"]++;
        expect({ steps, options, named }).toEqual({ steps, options, named: read });
      }
    }
    expect(Math.min(counts.read, counts.unread)).toBeGreaterThan(100);
  });
});
