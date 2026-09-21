import { describe, expect, it, vi } from "vitest";

const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const {
  createAttemptStoreAdapter,
  createConcreteSemanticExecutor,
} = require("../../native/semantic-workflow-executor.cjs");
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

describe("semantic workflow integration seam", () => {
  it("adapts runtime write transitions to the private attempt store", async () => {
    const root = mkdtempSync(join(tmpdir(), "surf-semantic-integration-"));
    try {
      const store = createAttemptStoreAdapter({
        root,
        clock: () => new Date("2026-01-01T00:00:00Z"),
      });
      await store.acquire({ runId: "run-1", workflowDigest: "digest" });
      const attempt = await store.reserve({
        stepId: "fill-quantity",
        operation: "fill",
        target: { role: "spinbutton", name: "Quantity" },
        remainingMs: 1000,
      });
      await store.markDispatchIntent(attempt);
      await store.markTerminal(attempt, { state: "acknowledged_verified" });
      await store.release({ state: "completed" });
      expect(attempt.state).toBe("reserved");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs one semantic find through the workflow adapter and injected browser/provider boundaries", async () => {
    const request = vi.fn(async (tool: string, _args: Record<string, unknown>) => {
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
      expect(tool).toBe("semantic.scrollScope");
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
          args: { op: "find", target: { query: "Blue bottle", role: "link" } },
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
          createConcreteSemanticExecutor({ request, evaluate, attemptStore, workflow }),
      },
    );

    expect(result.status).toBe("completed");
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
});
