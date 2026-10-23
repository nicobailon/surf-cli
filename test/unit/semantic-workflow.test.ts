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
function observation(ref = "e1", top = 0, candidateIdentity: Record<string, string> = {}) {
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
          ...candidateIdentity,
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
    candidateIdentity?: Record<string, string> | (() => Record<string, string>);
    additionalCandidates?: () => Array<{
      ref: string;
      role: string;
      name: string;
      type: string;
      nearbyText: string;
      href?: string;
      representation?: string;
    }>;
    compare?: boolean | ((args: Record<string, any>) => unknown);
    action?: () => unknown;
  } = {},
) {
  const positions = options.positions || [0];
  let index = 0;
  let currentUrl = "https://example.test/shop";
  const read = () => {
    const value = observation(
      options.candidate?.(positions[index]) || "e1",
      positions[index],
      typeof options.candidateIdentity === "function"
        ? options.candidateIdentity()
        : options.candidateIdentity,
    );
    value.semanticObservation.candidates.push(...(options.additionalCandidates?.() || []));
    value.semanticObservation.identity.fullUrl = currentUrl;
    return envelope(value);
  };
  const compare = (args: Record<string, any>) =>
    typeof options.compare === "function"
      ? options.compare(args)
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
      "semantic.localCompare": () => compare(args),
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

  it("groups image and title links to one destination before confidence gating", async () => {
    const baseProvider = provider();
    const evaluate = vi.fn(async (state: Record<string, any>, questions: Record<string, any>) => {
      expect(state.candidates).toHaveLength(1);
      expect(Object.keys(questions.target.criteria)).toHaveLength(2);
      return baseProvider(state, questions);
    });
    const request = boundary({
      candidateIdentity: {
        role: "link",
        name: "View Bottle",
        type: "a",
        href: "/bottle",
        nearbyText: "Bottle product card",
        representation: "image",
      },
      additionalCandidates: () => [
        {
          ref: "e2",
          role: "link",
          name: "Bottle",
          type: "a",
          href: "/bottle",
          nearbyText: "Bottle product card",
          representation: "text",
        },
      ],
    });
    const runtime = createSemanticWorkflowRuntime({ request, evaluate });
    const result = await runtime.executeStep(
      { id: "find", op: "find", target: { query: "Bottle", role: "link" } },
      runtime.createContext(),
    );
    expect(result).toMatchObject({
      kind: "success",
      binding: { role: "link", name: "Bottle", type: "a" },
    });
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

  it("rejects an unknown runtime model at construction", () => {
    expect(() =>
      createSemanticWorkflowRuntime({ request: boundary(), evaluate: provider(), model: "jev-9" }),
    ).toThrow(expect.objectContaining({ code: "semantic_invalid_request" }));
  });

  it("applies the runtime model's verification threshold to semantic assertions", async () => {
    const assertWith = async (model: string) => {
      const runtime = createSemanticWorkflowRuntime({
        request: boundary(),
        evaluate: provider("not_satisfied", 0.93),
        model,
      });
      return runtime.executeStep(
        { id: "check", op: "assert", mode: "semantic", claim: "Added" },
        runtime.createContext(),
      );
    };
    expect(await assertWith("jev-1.13.0")).toMatchObject({ semanticStatus: "not_satisfied" });
    expect(await assertWith("clef-flash")).toMatchObject({ semanticStatus: "uncertain" });
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

  it("persists a write attempt when the matched control has no accessible name", async () => {
    const attemptStore = store();
    let comparisons = 0;
    const request = boundary({
      candidateIdentity: { role: "spinbutton", name: "", type: "number" },
      compare: () =>
        envelope({ success: true, matches: comparisons++ > 0, reason: "compared", identity: {} }),
    });
    const runtime = createSemanticWorkflowRuntime({ request, evaluate: provider(), attemptStore });
    const result = await runtime.executeStep(
      { id: "fill", op: "fill", target: { query: "Quantity" }, input: "quantity" },
      runtime.createContext({ inputs: { quantity: "2" } }),
    );
    expect(result).toMatchObject({ kind: "success", status: "verified" });
    expect(attemptStore.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ target: { role: "spinbutton" } }),
    );
  });

  it("re-resolves a locally verified control after a write replaces its DOM node", async () => {
    const attemptStore = store();
    const evaluate = provider();
    let ref = "e1";
    const request = boundary({
      candidate: () => ref,
      candidateIdentity: { role: "spinbutton", name: "", type: "number" },
      compare: (args) =>
        envelope({
          success: true,
          matches: args.ref === "e9" && args.predicate.expected === "replacement-secret-value",
          reason: "compared",
          identity: {},
        }),
      action: () => {
        ref = "e9";
        return envelope({ success: true });
      },
    });
    const runtime = createSemanticWorkflowRuntime({ request, evaluate, attemptStore });
    const result = await runtime.executeStep(
      { id: "fill", op: "fill", target: { query: "Quantity" }, input: "quantity" },
      runtime.createContext({ inputs: { quantity: "replacement-secret-value" } }),
    );
    expect(result).toMatchObject({ kind: "success", status: "verified" });
    expect(request.mock.calls.filter(([tool]) => tool === "form.fill")).toHaveLength(1);
    expect(request.mock.calls.filter(([tool]) => tool === "page.read")).toHaveLength(2);
    expect(JSON.stringify(evaluate.mock.calls)).not.toContain("replacement-secret-value");
  });

  it("rejects a replacement control with a different value-free identity", async () => {
    let replaced = false;
    const request = boundary({
      candidate: () => (replaced ? "e9" : "e1"),
      candidateIdentity: () => ({
        role: "spinbutton",
        name: replaced ? "Other quantity" : "Quantity",
        type: "number",
      }),
      compare: () => envelope({ success: true, matches: false, reason: "compared", identity: {} }),
      action: () => {
        replaced = true;
        return envelope({ success: true });
      },
    });
    const runtime = createSemanticWorkflowRuntime({
      request,
      evaluate: provider(),
      attemptStore: store(),
    });
    const result = await runtime.executeStep(
      { id: "fill", op: "fill", target: { query: "Quantity" }, input: "quantity" },
      runtime.createContext({ inputs: { quantity: "2" } }),
    );
    expect(result).toMatchObject({ kind: "failure", reason: "assertion_mismatch" });
    expect(request.mock.calls.filter(([tool]) => tool === "form.fill")).toHaveLength(1);
  });

  it("rejects an ambiguous replacement without replaying the write", async () => {
    let replaced = false;
    const identity = { role: "spinbutton", name: "Quantity", type: "number" };
    const request = boundary({
      candidate: () => (replaced ? "e9" : "e1"),
      candidateIdentity: identity,
      additionalCandidates: () =>
        replaced ? [{ ref: "e10", ...identity, nearbyText: "Second quantity" }] : [],
      compare: () => envelope({ success: true, matches: false, reason: "compared", identity: {} }),
      action: () => {
        replaced = true;
        return envelope({ success: true });
      },
    });
    const runtime = createSemanticWorkflowRuntime({
      request,
      evaluate: provider(),
      attemptStore: store(),
    });
    const result = await runtime.executeStep(
      { id: "fill", op: "fill", target: { query: "Quantity" }, input: "quantity" },
      runtime.createContext({ inputs: { quantity: "2" } }),
    );
    expect(result).toMatchObject({ kind: "failure", reason: "assertion_mismatch" });
    expect(request.mock.calls.filter(([tool]) => tool === "form.fill")).toHaveLength(1);
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

describe("semantic workflow extract step", () => {
  const fields = { total: { type: "number", decimals: 2 }, note: { type: "text" } };
  function extractor() {
    return vi.fn(async (_text: string, _requested: Record<string, unknown>, _options: unknown) => ({
      answers: {
        total: { type: "number", value: 42.1, confidence: 0.99, p_null: 0.01 },
        note: { type: "text", value: null, confidence: 0.2, p_null: 0.9 },
      },
      truncated: false,
      usage: { input_tokens: 5, output_tokens: 4 },
    }));
  }

  it("reads one observation, makes one extraction call, and keeps the values in memory", async () => {
    const request = boundary();
    const evaluate = provider();
    const evaluateExtraction = extractor();
    const attemptStore = store();
    const local = new Date(2026, 9, 23, 23, 30).getTime();
    const runtime = createSemanticWorkflowRuntime({
      request,
      evaluate,
      evaluateExtraction,
      attemptStore,
      now: () => local,
    });
    const context = runtime.createContext({ maxProviderCalls: 2 });
    const result = await runtime.executeStep(
      { id: "read", as: "order", op: "extract", fields },
      context,
    );
    const extraction = {
      status: "partial",
      fields: {
        total: {
          type: "number",
          status: "extracted",
          value: 42.1,
          confidence: 0.99,
          pNull: 0.01,
          source: null,
        },
        note: {
          type: "text",
          status: "null",
          value: null,
          confidence: 0.2,
          pNull: 0.9,
          source: null,
        },
      },
      appliedThresholds: { extract: 0.8, null: 0.5 },
      referenceDate: "2026-10-23",
      truncated: false,
      page: { origin: "https://example.test", title: "Shop" },
      omitted: { candidates: 0, chunks: 0 },
    };
    expect(result).toEqual({ kind: "success", status: "completed", extraction });
    expect(context.bindings.get("order")).toEqual({
      kind: "extraction",
      handle: "order",
      specs: [
        { name: "total", type: "number", spec: fields.total },
        { name: "note", type: "text", spec: fields.note },
      ],
      result: extraction,
    });
    expect(request.mock.calls.map(([tool, args]) => [tool, args])).toEqual([
      ["page.read", { semanticObservation: true }],
    ]);
    expect(evaluate).not.toHaveBeenCalled();
    expect(evaluateExtraction).toHaveBeenCalledOnce();
    expect(evaluateExtraction.mock.calls[0][2]).toMatchObject({
      referenceDate: "2026-10-23",
      timeoutMs: 5_000,
    });
    expect(context.usage).toEqual({
      providerCalls: 1,
      inputTokens: 5,
      outputTokens: 4,
      partial: false,
      browserCommands: 1,
      semanticDecisions: 0,
      extractions: 1,
      observations: 1,
    });
    expect(attemptStore.reserve).not.toHaveBeenCalled();
    expect(attemptStore.dispatchIntent).not.toHaveBeenCalled();
    expect(context.completedSteps).toEqual(["read"]);
  });

  it("charges the extraction call to the shared provider-call budget", async () => {
    const evaluateExtraction = extractor();
    const runtime = createSemanticWorkflowRuntime({
      request: boundary(),
      evaluate: provider("e1"),
      evaluateExtraction,
    });
    const context = runtime.createContext({ maxProviderCalls: 1 });
    expect(
      await runtime.executeStep(
        { id: "find", as: "button", op: "find", target: { query: "Add" } },
        context,
      ),
    ).toMatchObject({ kind: "success" });
    expect(
      await runtime.executeStep({ id: "read", as: "order", op: "extract", fields }, context),
    ).toMatchObject({ kind: "failure", reason: "budget_exhaustion" });
    expect(evaluateExtraction).not.toHaveBeenCalled();
    expect(context.usage).toMatchObject({ providerCalls: 2, semanticDecisions: 1, extractions: 0 });
    expect(context.bindings.has("order")).toBe(false);
  });

  it("stops with budget_exhaustion when the deadline runs out before the extraction call", async () => {
    let clock = 1_000;
    const read = boundary();
    const request = vi.fn(async (tool: string, args: Record<string, any>) => {
      clock += 2_000;
      return read(tool, args);
    });
    const evaluateExtraction = extractor();
    const runtime = createSemanticWorkflowRuntime({
      request,
      evaluateExtraction,
      now: () => clock,
    });
    const context = runtime.createContext({ deadlineMs: 1_000 });
    expect(
      await runtime.executeStep({ id: "read", as: "order", op: "extract", fields }, context),
    ).toMatchObject({ kind: "failure", reason: "budget_exhaustion" });
    expect(evaluateExtraction).not.toHaveBeenCalled();
  });

  it("fails closed with invalid_binding when an extract result is used as a target", async () => {
    const request = boundary();
    const runtime = createSemanticWorkflowRuntime({
      request,
      evaluate: provider(),
      evaluateExtraction: extractor(),
    });
    const context = runtime.createContext();
    await runtime.executeStep({ id: "read", as: "order", op: "extract", fields }, context);
    expect(
      await runtime.executeStep({ id: "open", op: "open", target: { binding: "order" } }, context),
    ).toEqual({ kind: "failure", status: "blocked", reason: "invalid_binding" });
    expect(request).toHaveBeenCalledOnce();
  });

  it("passes provider failures through as the step reason", async () => {
    const runtime = createSemanticWorkflowRuntime({
      request: boundary(),
      evaluateExtraction: vi.fn(async () => {
        throw Object.assign(new Error("slow"), { code: "provider_timeout" });
      }),
    });
    const context = runtime.createContext();
    expect(
      await runtime.executeStep({ id: "read", as: "order", op: "extract", fields }, context),
    ).toEqual({ kind: "failure", status: "blocked", reason: "provider_timeout" });
    expect(context.usage).toMatchObject({ providerCalls: 1, extractions: 1, partial: true });
  });
});

describe("semantic workflow value assert", () => {
  const money = { type: "number", decimals: 2 };
  const count = { type: "number", integer: true };
  const days = { type: "duration", unit: "days" };
  const text = { type: "text" };
  const date = { type: "date" };
  const time = { type: "time" };
  const datetime = { type: "datetime" };
  const got = (value: unknown) => ({ status: "extracted", value });
  async function check(
    spec: Record<string, unknown>,
    field: Record<string, unknown>,
    args: Record<string, unknown>,
    inputs: Record<string, unknown> = {},
  ) {
    const request = boundary();
    const evaluate = provider();
    const evaluateExtraction = vi.fn();
    const runtime = createSemanticWorkflowRuntime({ request, evaluate, evaluateExtraction });
    const context = runtime.createContext({ inputs });
    const result = { fields: { f: field } };
    context.bindings.set("order", {
      kind: "extraction",
      handle: "order",
      specs: [{ name: "f", spec }],
      result,
    });
    const step = {
      id: "check",
      op: "assert",
      mode: "value",
      binding: "order",
      field: "f",
      ...args,
    };
    const outcome = await runtime.executeStep(step, context);
    const calls = [request, evaluate, evaluateExtraction].map((fn) => fn.mock.calls.length);
    const { providerCalls, browserCommands, observations } = context.usage;
    return { outcome, io: [...calls, providerCalls, browserCommands, observations] };
  }

  it.each([
    [money, got(42.1), { equals: 42.104 }, "verified"],
    // Both sides round half up to the field's 2 decimals: Math.round(4210.5) is 4211.
    [money, got(42.105), { equals: 42.11 }, "verified"],
    [money, got(42.105), { equals: 42.1 }, "assertion_mismatch"],
    [money, got(42.1), { min: 42.1, max: 42.1 }, "verified"],
    [{ type: "number" }, got(42.1), { equals: 42.104 }, "assertion_mismatch"],
    [count, got(3), { equals: 3 }, "verified"],
    [count, got(3), { min: 4 }, "assertion_mismatch"],
    [days, got(2.5), { min: 2, max: 3 }, "verified"],
    [days, got(2.5), { max: 2 }, "assertion_mismatch"],
    [date, got("2026-10-27"), { min: "2026-10-27", max: "2026-10-31" }, "verified"],
    [date, got("2026-10-27"), { max: "2026-10-26" }, "assertion_mismatch"],
    [time, got("09:30"), { equals: "09:30:00" }, "verified"],
    [time, got("09:30:05"), { max: "09:30" }, "assertion_mismatch"],
    [datetime, got("2026-10-27T09:30"), { max: "2026-10-27T09:30:00" }, "verified"],
    [datetime, got("2026-10-27T09:30"), { min: "2026-10-27T09:30:01" }, "assertion_mismatch"],
    [text, got("Paid"), { equals: "Paid" }, "verified"],
    [text, got("Paid"), { equals: "paid" }, "assertion_mismatch"],
    [money, { status: "null", value: null, guess: 42.1 }, { equals: 42.1 }, "value_null"],
    [money, { status: "uncertain", value: null, guess: 42.1 }, { equals: 42.1 }, "value_uncertain"],
    [money, got(42.1), { input: "expected" }, "verified", { expected: "42.10" }],
    [money, got(42.1), { input: "expected" }, "verified", { expected: 42.1 }],
    [money, got(42.1), { input: "expected" }, "assertion_mismatch", { expected: "42.2" }],
    [money, got(42.1), { input: "expected" }, "validation_failure", { expected: "42.1 USD" }],
    [money, got(42.1), { input: "expected" }, "validation_failure", { expected: true }],
    [money, got(42.1), { input: "expected" }, "validation_failure", {}],
    [count, got(3), { input: "expected" }, "validation_failure", { expected: "3.5" }],
    [date, got("2026-10-27"), { input: "expected" }, "verified", { expected: "2026-10-27" }],
    [
      date,
      got("2026-10-27"),
      { input: "expected" },
      "validation_failure",
      { expected: "27/10/2026" },
    ],
    [text, got("42"), { input: "expected" }, "verified", { expected: 42 }],
    // A bad input wins over a null value, as the failure order requires.
    [money, { status: "null", value: null }, { input: "expected" }, "validation_failure", {}],
  ] as Array<
    [
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
      string,
      Record<string, unknown>?,
    ]
  >)("%j value %j with %j gives %s", async (spec, field, args, expected, inputs) => {
    const { outcome, io } = await check(spec, field, args, inputs);
    // No browser request, decision call or extraction call, and nothing charged to the budgets.
    expect(io).toEqual([0, 0, 0, 0, 0, 0]);
    // Outcomes carry only the reason code: never the page value, guess, literal or input.
    expect(outcome).toEqual(
      expected === "verified"
        ? { kind: "success", status: "verified" }
        : { kind: "failure", status: "blocked", reason: expected },
    );
  });

  it("fails with invalid_binding for a missing binding, a target binding or an unknown field", async () => {
    const runtime = createSemanticWorkflowRuntime({ request: boundary(), evaluate: provider() });
    const context = runtime.createContext();
    context.bindings.set("product", { kind: "target", handle: "product" });
    context.bindings.set("order", {
      kind: "extraction",
      specs: [{ name: "f", spec: money }],
      result: { fields: { f: got(1) } },
    });
    for (const [binding, field] of [
      ["missing", "f"],
      ["product", "f"],
      ["order", "g"],
      ["order", "constructor"],
    ]) {
      expect(
        await runtime.executeStep(
          { id: "check", op: "assert", mode: "value", binding, field, equals: 1 },
          context,
        ),
      ).toEqual({ kind: "failure", status: "blocked", reason: "invalid_binding" });
    }
  });
});
