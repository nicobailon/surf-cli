import { describe, expect, it } from "vitest";

const definition = require("../../native/workflow-definition.cjs");

function semanticWorkflow(steps: Array<Record<string, unknown>>) {
  return { semantic: { version: 1 }, steps };
}

describe("semantic workflow definition", () => {
  it("keeps ordinary workflows and their loop shapes compatible", () => {
    expect(
      definition.normalizeWorkflow({
        args: { count: { default: 2 } },
        steps: [{ repeat: 2, steps: [{ tool: "click", args: { ref: "e1" }, as: "clicked" }] }],
      }),
    ).toMatchObject({
      args: { count: { default: 2 } },
      steps: [{ repeat: 2, steps: [{ cmd: "click", args: { ref: "e1" }, as: "clicked" }] }],
    });
  });

  it("normalizes semantic steps while preserving ids and output names", () => {
    const workflow = definition.normalizeWorkflow(
      semanticWorkflow([
        {
          id: "find-product",
          tool: "semantic.step",
          as: "product",
          args: { op: "find", target: { query: "Product link", role: "link" } },
        },
        {
          id: "open-product",
          tool: "semantic.step",
          args: { op: "open", target: { binding: "product" } },
        },
      ]),
    );
    expect(workflow.steps).toEqual([
      {
        id: "find-product",
        cmd: "semantic.step",
        as: "product",
        args: { op: "find", target: { query: "Product link", role: "link" } },
      },
      {
        id: "open-product",
        cmd: "semantic.step",
        args: { op: "open", target: { binding: "product" } },
      },
    ]);
  });

  it.each([
    ["version", { semantic: { version: 2 }, steps: [] }],
    [
      "unknown semantic field",
      {
        semantic: { version: 1, surprise: true },
        steps: [{ id: "x", tool: "semantic.step", args: { op: "find", target: { query: "x" } } }],
      },
    ],
    [
      "unknown operation",
      semanticWorkflow([
        { id: "x", tool: "semantic.step", args: { op: "plan", target: { query: "x" } } },
      ]),
    ],
    [
      "unknown step argument",
      semanticWorkflow([
        {
          id: "x",
          tool: "semantic.step",
          args: { op: "find", target: { query: "x" }, fallback: true },
        },
      ]),
    ],
    [
      "loop",
      semanticWorkflow([
        {
          repeat: 2,
          steps: [{ id: "x", tool: "semantic.step", args: { op: "find", target: { query: "x" } } }],
        },
      ]),
    ],
    [
      "future binding",
      semanticWorkflow([
        { id: "open", tool: "semantic.step", args: { op: "open", target: { binding: "product" } } },
        {
          id: "find",
          tool: "semantic.step",
          as: "product",
          args: { op: "find", target: { query: "x" } },
        },
      ]),
    ],
  ])("rejects invalid semantic structure before execution: %s", (_label, workflow) => {
    expect(() => definition.normalizeWorkflow(workflow)).toThrow();
  });
});
