import { describe, expect, it, vi } from "vitest";

const { createSemanticWorkflowRuntime, WORKFLOW_POLICY } =
  require("../../native/semantic-workflow.cjs") as {
    createSemanticWorkflowRuntime(dependencies: Record<string, unknown>): {
      createContext(options?: Record<string, unknown>): Record<string, any>;
      executeStep(
        step: Record<string, any>,
        context: Record<string, any>,
      ): Promise<Record<string, any>>;
      closeContext(context: Record<string, any>, terminal?: Record<string, any>): Promise<void>;
    };
    WORKFLOW_POLICY: Record<string, number>;
  };

function envelope(value: unknown) {
  return { result: { content: [{ type: "text", text: JSON.stringify(value) }] } };
}
function observation(ref = "e1", top = 0) {
  return {
    semanticObservation: {
      identity: {
        browserEpoch: "epoch",
        tabId: 1,
        frameId: 0,
        fullUrl: "https://example.test/shop",
        documentToken: "doc",
      },
      page: { title: "Shop", readyState: "complete", modals: [] },
      candidates: [
        {
          ref,
          role: ref === "e1" ? "button" : "link",
          name: ref === "e1" ? "Add" : "Bottle",
          type: ref === "e1" ? "button" : "a",
          nearbyText: "Blue bottle",
          ...(ref !== "e1" ? { href: "/bottle" } : {}),
        },
      ],
      chunks: [{ id: `c${top}`, text: "Public product text", refs: [ref] }],
      omitted: { candidates: 0, chunks: 0 },
    },
  };
}
function provider(selected = "e1", probability = 0.99) {
  return vi.fn(async (_state: unknown, questions: Record<string, any>) => {
    const answers = Object.fromEntries(
      Object.entries(questions).map(([name, question]) => {
        const labels = Object.keys(question.criteria);
        const choice = labels.includes(selected) ? selected : labels[0];
        const probabilities = Object.fromEntries(
          labels.map((label) => [
            label,
            label === choice ? probability : (1 - probability) / (labels.length - 1),
          ]),
        );
        return [name, { type: "choice", choice, confidence: 0.01, probabilities }];
      }),
    );
    return { model: "jev-test", usage: { input_tokens: 3, output_tokens: 2 }, answers };
  });
}
function store() {
  return {
    acquire: vi.fn(),
    reserve: vi.fn(async () => ({ attemptId: "attempt" })),
    dispatchIntent: vi.fn(),
    terminal: vi.fn(),
    checkpoint: vi.fn(),
    release: vi.fn(),
  };
}

type Geometry = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  intervalStart: number;
  intervalEnd: number;
  atTop: boolean;
  atBottom: boolean;
};

function geometry(
  intervalStart: number,
  intervalEnd: number,
  overrides: Partial<Geometry> = {},
): Geometry {
  return {
    scrollTop: intervalStart,
    scrollHeight: 1_000,
    clientHeight: intervalEnd - intervalStart,
    intervalStart,
    intervalEnd,
    atTop: intervalStart === 0,
    atBottom: intervalEnd === 1_000,
    ...overrides,
  };
}

function boundary(
  options: {
    positions?: number[];
    geometries?: Geometry[];
    candidate?: (top: number) => string;
    compare?: boolean | (() => unknown);
    action?: () => unknown;
  } = {},
) {
  const positions = options.positions || [0];
  let index = 0;
  let currentUrl = "https://example.test/shop";
  const read = () => {
    const value = observation(options.candidate?.(positions[index]) || "e1", positions[index]);
    value.semanticObservation.identity.fullUrl = currentUrl;
    return envelope(value);
  };
  const compare = () =>
    typeof options.compare === "function"
      ? options.compare()
      : envelope({
          success: true,
          matches: options.compare ?? true,
          reason: "compared",
          identity: {},
        });
  const action = () => (options.action ? options.action() : envelope({ success: true }));
  return vi.fn(async (tool: string, args: Record<string, any>) => {
    if (tool === "semantic.scrollScope") {
      if (args.action === "top") {
        index = 0;
      } else if (args.action === "advance") {
        index = Math.min(index + 1, positions.length - 1);
      }
      const top = positions[index];
      return envelope({
        success: true,
        scopeToken: "scope",
        geometry: options.geometries?.[index] || {
          scrollTop: top,
          scrollHeight: 1900,
          clientHeight: 1000,
          intervalStart: top,
          intervalEnd: top + 1000,
          atTop: top === 0,
          atBottom: top >= 900,
        },
      });
    }
    if (tool === "navigate") {
      currentUrl = args.url;
      return action();
    }
    const handlers: Record<string, () => unknown> = {
      "page.read": read,
      "semantic.localCompare": compare,
      click: action,
      "form.fill": action,
    };
    if (handlers[tool]) {
      return handlers[tool]();
    }
    throw new Error(`unexpected ${tool}`);
  });
}

describe("bounded semantic workflow runtime", () => {
  it("freezes workflow ceilings", () => {
    expect(WORKFLOW_POLICY).toMatchObject({
      defaultDeadlineMs: 60_000,
      maxDeadlineMs: 120_000,
      defaultProviderCalls: 32,
      maxProviderCalls: 64,
      defaultSearchObservations: 12,
      maxSearchObservations: 32,
      maxSteps: 32,
    });
  });

  it("uses actual overlapping intervals and reports honest early-match coverage", async () => {
    const request = boundary({
      positions: [0, 750, 900],
      candidate: (top) => (top === 750 ? "e2" : "e1"),
    });
    const evaluate = provider("e2");
    const runtime = createSemanticWorkflowRuntime({ request, evaluate });
    const result = await runtime.executeStep(
      {
        id: "find",
        op: "find",
        as: "product",
        target: { query: "Bottle", role: "link" },
        search: { maxObservations: 3 },
      },
      runtime.createContext(),
    );
    expect(result).toMatchObject({
      kind: "success",
      status: "completed",
      coverage: {
        complete: false,
        intervals: [
          { start: 0, end: 1000 },
          { start: 750, end: 1750 },
        ],
      },
    });
    expect(
      request.mock.calls.filter(([tool]) => tool === "semantic.scrollScope")[2][1],
    ).toMatchObject({ action: "advance", maxFraction: 0.75 });
  });

  it("stops incomplete scans at the observation budget", async () => {
    const runtime = createSemanticWorkflowRuntime({
      request: boundary({ positions: [0, 750, 900] }),
      evaluate: provider("none"),
    });
    const result = await runtime.executeStep(
      { id: "find", op: "find", target: { query: "Missing" }, search: { maxObservations: 2 } },
      runtime.createContext(),
    );
    expect(result).toMatchObject({
      kind: "failure",
      reason: "incomplete_search",
      coverage: { complete: false, atBottom: false },
    });
  });

  it.each([
    {
      case: "top-clipped scope",
      geometries: [geometry(500, 1_000, { scrollTop: 0, atTop: true })],
      complete: false,
    },
    {
      case: "bottom-clipped scope",
      geometries: [geometry(0, 500, { atBottom: true })],
      complete: false,
    },
    {
      case: "contiguous full scope",
      geometries: [geometry(0, 600), geometry(400, 1_000)],
      complete: true,
    },
    {
      case: "gapped full-height scope",
      geometries: [geometry(0, 400), geometry(600, 1_000)],
      complete: false,
    },
  ])(
    "derives $case completeness from the observed interval union",
    async ({ geometries, complete }) => {
      const runtime = createSemanticWorkflowRuntime({
        request: boundary({
          positions: geometries.map((item) => item.scrollTop),
          geometries,
        }),
        evaluate: provider("none"),
      });
      const result = await runtime.executeStep(
        {
          id: "find",
          op: "find",
          target: { query: "Missing" },
          search: { maxObservations: geometries.length },
        },
        runtime.createContext(),
      );
      expect(result).toMatchObject({
        kind: "failure",
        reason: complete ? "target_not_found" : "incomplete_search",
        coverage: { complete },
      });
    },
  );

  it("gates model-derived writes on chosen probability rather than confidence", async () => {
    const request = boundary();
    const runtime = createSemanticWorkflowRuntime({
      request,
      evaluate: provider("e1", 0.94),
      attemptStore: store(),
    });
    const result = await runtime.executeStep(
      {
        id: "add",
        op: "click",
        target: { query: "Add", type: "button" },
        expect: { kind: "visible" },
      },
      runtime.createContext(),
    );
    expect(result).toMatchObject({
      kind: "failure",
      reason: "low_confidence",
      probability: 0.94,
      appliedThreshold: 0.95,
    });
    expect(request.mock.calls.some(([tool]) => tool === "click")).toBe(false);
  });

  it("does not dispatch a model-derived write outside the declared target type", async () => {
    const request = boundary();
    const runtime = createSemanticWorkflowRuntime({
      request,
      evaluate: provider(),
      attemptStore: store(),
    });
    const result = await runtime.executeStep(
      { id: "add", op: "click", target: { query: "Add", type: "a" }, expect: { kind: "visible" } },
      runtime.createContext(),
    );
    expect(result.kind).toBe("failure");
    expect(request.mock.calls.some(([tool]) => tool === "click")).toBe(false);
  });

  it("re-resolves a below-fold binding before opening its same-origin destination", async () => {
    const request = boundary({
      positions: [0, 750],
      candidate: (top) => (top === 750 ? "e2" : "e1"),
    });
    const runtime = createSemanticWorkflowRuntime({ request, evaluate: provider("e2") });
    const context = runtime.createContext();
    expect(
      await runtime.executeStep(
        { id: "find", as: "product", op: "find", target: { query: "Bottle", role: "link" } },
        context,
      ),
    ).toMatchObject({ kind: "success" });
    const openResult = await runtime.executeStep(
      { id: "open", op: "open", target: { binding: "product" } },
      context,
    );
    expect(openResult).toMatchObject({ kind: "success", status: "verified" });
    expect(request.mock.calls.filter(([tool]) => tool === "navigate")).toHaveLength(1);
  });

  it("skips a satisfied fill without reserving or dispatching and keeps values out of provider payloads", async () => {
    const attemptStore = store();
    const request = boundary({ compare: true });
    const evaluate = provider();
    const runtime = createSemanticWorkflowRuntime({ request, evaluate, attemptStore });
    const context = runtime.createContext({ inputs: { quantity: "distinct-secret-value" } });
    const result = await runtime.executeStep(
      { id: "fill", op: "fill", target: { query: "Add" }, input: "quantity" },
      context,
    );
    expect(result).toEqual({ kind: "success", status: "skipped_already_satisfied" });
    expect(attemptStore.reserve).not.toHaveBeenCalled();
    expect(JSON.stringify(evaluate.mock.calls)).not.toContain("distinct-secret-value");
    expect(context.usage).toMatchObject({
      providerCalls: 1,
      semanticDecisions: 1,
      inputTokens: 3,
      outputTokens: 2,
    });
  });

  it("persists intent and dispatches only once when the reply is lost", async () => {
    const attemptStore = store();
    const request = boundary({
      compare: false,
      action: () => {
        throw Object.assign(new Error("lost"), { code: "timeout" });
      },
    });
    const runtime = createSemanticWorkflowRuntime({ request, evaluate: provider(), attemptStore });
    const result = await runtime.executeStep(
      {
        id: "add",
        op: "click",
        target: { query: "Add", type: "button" },
        expect: { kind: "visible" },
      },
      runtime.createContext(),
    );
    expect(result).toMatchObject({
      kind: "failure",
      reason: "outcome_unknown",
      write: { state: "dispatch_unknown", replayAllowed: false },
    });
    expect(attemptStore.dispatchIntent).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.filter(([tool]) => tool === "click")).toHaveLength(1);
    expect(attemptStore.terminal).toHaveBeenCalledWith("attempt", "outcome_unknown");
  });

  it("fails closed when an unknown write outcome cannot be persisted", async () => {
    const attemptStore = store();
    attemptStore.terminal.mockRejectedValue(new Error("state unavailable"));
    const runtime = createSemanticWorkflowRuntime({
      request: boundary({
        action: () => {
          throw new Error("lost reply");
        },
      }),
      evaluate: provider(),
      attemptStore,
    });
    const result = await runtime.executeStep(
      { id: "add", op: "click", target: { query: "Add" }, expect: { kind: "visible" } },
      runtime.createContext(),
    );
    expect(result).toMatchObject({ kind: "failure", reason: "checkpoint_failure" });
  });

  it.each(["local", "semantic"])(
    "persists acknowledged-unverified when %s verification throws",
    async (mode) => {
      const attemptStore = store();
      let providerCalls = 0;
      const baseProvider = provider();
      const evaluate = vi.fn(async (state: unknown, questions: Record<string, any>) => {
        providerCalls++;
        if (mode === "semantic" && providerCalls > 1) {
          throw new Error("verification unavailable");
        }
        return baseProvider(state, questions);
      });
      const request = boundary({
        compare:
          mode === "local"
            ? () => {
                throw new Error("comparison unavailable");
              }
            : false,
      });
      const runtime = createSemanticWorkflowRuntime({ request, evaluate, attemptStore });
      const context = runtime.createContext();
      const expectValue =
        mode === "semantic" ? { mode: "semantic", claim: "Cart is open" } : { kind: "visible" };
      const result = await runtime.executeStep(
        { id: "add", op: "click", target: { query: "Add" }, expect: expectValue },
        context,
      );
      expect(result).toMatchObject({
        kind: "failure",
        write: { state: "acknowledged_unverified", replayAllowed: false },
      });
      expect(attemptStore.terminal).toHaveBeenCalledWith("attempt", "acknowledged_unverified");
      await runtime.closeContext(context, { state: "failed" });
      expect(attemptStore.release).toHaveBeenCalledWith(
        expect.objectContaining({ state: "failed" }),
      );
      expect(request.mock.calls.filter(([tool]) => tool === "click")).toHaveLength(1);
    },
  );

  it("requires click expectations and returns only discriminated outcomes", async () => {
    const runtime = createSemanticWorkflowRuntime({
      request: boundary(),
      evaluate: provider(),
      attemptStore: store(),
    });
    const result = await runtime.executeStep(
      { id: "add", op: "click", target: { query: "Add" } },
      runtime.createContext(),
    );
    expect(result).toEqual({ kind: "failure", status: "blocked", reason: "validation_failure" });
    expect(["success", "failure"]).toContain(result.kind);
  });
});
