import { describe, expect, it, vi } from "vitest";

const { createConcreteSemanticExecutor } = require("../../native/semantic-workflow-executor.cjs");
const { createSemanticEvaluator } = require("../../native/semantic-evaluator.cjs");
const { executeDoSteps } = require("../../native/do-executor.cjs");

const identity = {
  browserEpoch: "epoch",
  tabId: 1,
  frameId: 0,
  fullUrl: "https://example.test/shop",
  documentToken: "doc",
};
const envelope = (value: unknown) => ({
  result: { content: [{ type: "text", text: JSON.stringify(value) }] },
});

function browser() {
  return vi.fn(async (tool: string, _args: Record<string, unknown>) => {
    if (tool === "page.read") {
      return envelope({
        semanticObservation: {
          identity,
          page: { title: "Shop", readyState: "complete", modals: [] },
          candidates: [
            { ref: "e2", role: "link", name: "Blue bottle", type: "a", href: "/bottle" },
          ],
          chunks: [{ id: "c1", text: "Blue bottle", refs: ["e2"] }],
          omitted: { candidates: 0, chunks: 0 },
        },
      });
    }
    if (tool !== "semantic.scrollScope") {
      throw new Error(`unexpected browser tool ${tool}`);
    }
    return envelope({
      success: true,
      scopeToken: "scope",
      geometry: {
        scrollTop: 0,
        scrollHeight: 800,
        clientHeight: 800,
        intervalStart: 0,
        intervalEnd: 800,
        atTop: true,
        atBottom: true,
      },
    });
  });
}

describe("semantic workflow integration seam", () => {
  it.each([
    { label: "default", search: undefined, observationLimit: 12 },
    { label: "declared override", search: { maxObservations: 2 }, observationLimit: 2 },
  ])("reports the $label per-step observation limit", async ({ search, observationLimit }) => {
    const request = browser();
    const evaluate = vi.fn(async () => ({
      model: "jev-test",
      usage: { input_tokens: 2, output_tokens: 1 },
      answers: {
        target: {
          type: "choice",
          choice: "e2",
          confidence: 0.2,
          probabilities: { e2: 0.99, none: 0.01 },
        },
      },
    }));
    const evaluator = createSemanticEvaluator({
      model: "jev-1.13.0",
      env: { TYPESAFE_API_KEY: "test-key" },
      loadSdk: () => ({
        TypeSafeClient: class {
          systemOne = evaluate;
        },
      }),
    });
    const attemptStore = {
      acquire: vi.fn(),
      checkpoint: vi.fn(),
      release: vi.fn(),
    };
    const workflow = {
      semantic: { version: 1 },
      steps: [
        {
          id: "find",
          tool: "semantic.step",
          as: "product",
          args: {
            op: "find",
            target: { query: "Blue bottle", role: "link" },
            ...(search ? { search } : {}),
          },
        },
      ],
    };

    const result = await executeDoSteps(
      [{ id: "find", cmd: "semantic.step", as: "product", args: workflow.steps[0].args }],
      {
        quiet: true,
        stepDelay: 0,
        executeTool: vi.fn(() => {
          throw new Error("semantic step reached generic transport");
        }),
        createSemanticExecutor: () =>
          createConcreteSemanticExecutor({ request, evaluator, attemptStore, workflow }),
      },
    );

    expect(result.status).toBe("completed");
    expect(result.semantic).toMatchObject({
      stepId: "find",
      usage: { providerCalls: 1, inputTokens: 2, outputTokens: 1 },
      limits: {
        maxProviderCalls: 32,
        maxSearchObservations: observationLimit,
        maxSearchObservationsCeiling: 32,
      },
    });
    expect(result.vars.product.binding).toMatchObject({
      handle: "product",
      role: "link",
      name: "Blue bottle",
    });
    expect(evaluate).toHaveBeenCalledOnce();
    expect(attemptStore.release).toHaveBeenCalledWith(
      expect.objectContaining({ state: "completed" }),
    );
  });
  it("selects the model for semantic steps from SURF_SEMANTIC_MODEL through the shared factory", async () => {
    const fetch = vi.fn(
      async (_url: string, _init: unknown) =>
        new Response(
          JSON.stringify({
            success: true,
            result: {
              model: "clef-flash",
              usage: { input_tokens: 2, output_tokens: 1 },
              answers: {
                target: {
                  type: "choice",
                  choice: "e2",
                  confidence: 0.9,
                  probabilities: { e2: 0.99, none: 0.01 },
                },
              },
            },
          }),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    try {
      const args = { op: "find", target: { query: "Blue bottle", role: "link" } };
      const execute = createConcreteSemanticExecutor({
        request: browser(),
        attemptStore: { acquire: vi.fn(), checkpoint: vi.fn(), release: vi.fn() },
        workflow: {
          semantic: { version: 1 },
          steps: [{ id: "find", tool: "semantic.step", args }],
        },
        env: {
          SURF_SEMANTIC_MODEL: "clef-flash",
          CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
          CLOUDFLARE_API_TOKEN: "fake-token",
        },
      });
      const result = await execute({ id: "find", as: "product", args });
      expect(result.kind).toBe("success");
      expect(result.semantic).toMatchObject({
        provider: "cloudflare",
        model: "clef-flash",
        providerCalls: 1,
        providerLatencyMs: expect.any(Number),
      });
      expect(fetch.mock.calls[0][0]).toMatch(/\/ai\/run\/@cf\/cloudflare\/clef-flash$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
