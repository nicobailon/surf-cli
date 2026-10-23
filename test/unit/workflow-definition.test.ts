import { describe, expect, it } from "vitest";

const definition = require("../../native/workflow-definition.cjs");
const { parseSemanticArgs } = require("../../native/semantic-cli.cjs");

function semanticWorkflow(steps: Array<Record<string, unknown>>) {
  return { semantic: { version: 1 }, steps };
}

function extractStep(fields: unknown, as: string | undefined = "order") {
  return {
    id: "read",
    tool: "semantic.step",
    ...(as ? { as } : {}),
    args: { op: "extract", fields },
  };
}

function errorMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected an error");
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

  it("accepts an extract step and prints it for a dry run", () => {
    const workflow = definition.normalizeWorkflow(
      semanticWorkflow([extractStep({ total: { type: "number", decimals: 2 } })]),
    );
    expect(
      workflow.steps.map((step: Record<string, unknown>) => definition.formatStep(step)),
    ).toEqual([
      'semantic.step op="extract" fields={"total":{"type":"number","decimals":2}} → order',
    ]);
  });

  const seventeen = Object.fromEntries(
    Array.from({ length: 17 }, (_, index) => [`f${index}`, { type: "text" }]),
  );
  it.each([
    [
      "as missing",
      [extractStep({ total: { type: "number" } }, "")],
      "steps[0].as is required for extract",
    ],
    [
      "unknown argument",
      [
        {
          ...extractStep({ total: { type: "number" } }),
          args: { op: "extract", fields: { total: { type: "number" } }, target: { query: "x" } },
        },
      ],
      "steps[0].args.target is not allowed",
    ],
    ["no fields", [extractStep({})], "steps[0].args.fields must be an object with 1 to 16 fields"],
    [
      "too many fields",
      [extractStep(seventeen)],
      "steps[0].args.fields must be an object with 1 to 16 fields",
    ],
    [
      "extract binding as target",
      [
        extractStep({ total: { type: "number" } }),
        { id: "open", tool: "semantic.step", args: { op: "open", target: { binding: "order" } } },
      ],
      "steps[1] binding 'order' is an extract result; only a value assert can use it",
    ],
    [
      "extract binding in bindings",
      [
        extractStep({ total: { type: "number" } }),
        {
          id: "check",
          tool: "semantic.step",
          args: { op: "assert", mode: "semantic", claim: "Paid", bindings: ["order"] },
        },
      ],
      "steps[1] binding 'order' is an extract result; only a value assert can use it",
    ],
  ] as Array<[string, Array<Record<string, unknown>>, string]>)(
    "rejects an invalid extract step: %s",
    (_label, steps, message) => {
      expect(errorMessage(() => definition.normalizeWorkflow(semanticWorkflow(steps)))).toBe(
        message,
      );
    },
  );

  it.each([
    { n: "not an object" },
    { n: { type: "estimate" } },
    { n: { type: "text", unit: "USD" } },
    { n: { type: "text", instructions: 3 } },
    { n: { type: "duration", unit: "fortnights" } },
    { n: { type: "number", integer: "yes" } },
    { n: { type: "number", decimals: 1.5 } },
    { n: { type: "date", null_threshold: 2 } },
    { n: { type: "list" } },
    { n: { type: "list", items: "date", decimals: 2 } },
    { "bad name": { type: "text" } },
    JSON.parse('{"__proto__":{"type":"text"}}'),
  ])("words each field error as --fields-json does: %j", (fields) => {
    const cli = errorMessage(() =>
      parseSemanticArgs(["semantic.extract", "--fields-json", JSON.stringify(fields)]),
    );
    const workflow = errorMessage(() =>
      definition.normalizeWorkflow(semanticWorkflow([extractStep(fields)])),
    );
    const name = Object.keys(fields)[0];
    expect(workflow).toBe(
      cli.startsWith(`--fields-json ${name}`)
        ? cli.replace(`--fields-json ${name}`, `steps[0].args.fields.${name}`)
        : `steps[0].args.fields: ${cli}`,
    );
  });
});

describe("semantic workflow value assert definition", () => {
  const fields = {
    total: { type: "number", decimals: 2 },
    count: { type: "number", integer: true },
    wait: { type: "duration", unit: "days", integer: true },
    note: { type: "text" },
    day: { type: "date" },
    at: { type: "time" },
    when: { type: "datetime" },
    items: { type: "list", items: "text" },
  };
  const find = {
    id: "find",
    tool: "semantic.step",
    as: "product",
    args: { op: "find", target: { query: "x" } },
  };
  const check = (args: Record<string, unknown>) =>
    semanticWorkflow([
      extractStep(fields),
      find,
      {
        id: "check",
        tool: "semantic.step",
        args: { op: "assert", mode: "value", ...(args.mode ? {} : { binding: "order" }), ...args },
      },
    ]);

  it("accepts typed literals, inclusive ranges and input slots", () => {
    for (const args of [
      { field: "total", equals: 42.1 },
      { field: "total", input: "expectedTotal" },
      { field: "count", min: 1, max: 1 },
      { field: "wait", max: 3 },
      { field: "note", equals: "Paid" },
      { field: "day", min: "2026-10-01", max: "2026-10-31" },
      { field: "at", equals: "09:30" },
      { field: "when", min: "2026-10-01T09:30:00" },
    ]) {
      expect(() => definition.normalizeWorkflow(check(args))).not.toThrow();
    }
  });

  const step = "steps[2]";
  it.each([
    [{ mode: "exact", claim: "x" }, `${step}.args.mode must be 'local', 'semantic' or 'value'`],
    [{ field: "total", equals: 1, claim: "x" }, `${step}.args.claim is not allowed`],
    [
      { mode: "local", field: "total", predicate: { kind: "visible" } },
      `${step}.args.field is not allowed`,
    ],
    [
      { binding: "", field: "total", equals: 1 },
      `${step}.args.binding must be a 1-64 character identifier`,
    ],
    [
      { binding: "product", field: "total", equals: 1 },
      `${step}.args.binding 'product' must refer to a prior extract step`,
    ],
    [
      { binding: "later", field: "total", equals: 1 },
      `${step}.args.binding 'later' must refer to a prior extract step`,
    ],
    [{ field: "missing", equals: 1 }, `${step}.args.field must name a field of binding 'order'`],
    [
      { field: "items", equals: "a" },
      `${step}.args.field 'items' is a list field; value asserts support text, number, integer, duration, date, time and datetime fields`,
    ],
    [{ field: "total" }, `${step}.args needs equals, input, min or max`],
    [{ field: "total", equals: 1, input: "x" }, `${step}.args can't combine equals with input`],
    [
      { field: "total", input: "x", min: 1 },
      `${step}.args can't combine equals or input with min or max`,
    ],
    [{ field: "total", input: "" }, `${step}.args.input must be a 1-64 character identifier`],
    [{ field: "total", equals: "42.1" }, `${step}.args.equals must be a finite number`],
    [{ field: "count", min: 1.5 }, `${step}.args.min must be an integer`],
    [{ field: "wait", max: 2.5 }, `${step}.args.max must be an integer`],
    [{ field: "note", equals: 3 }, `${step}.args.equals must be a string`],
    [{ field: "day", equals: "2026-02-30" }, `${step}.args.equals must be a date as YYYY-MM-DD`],
    [{ field: "at", equals: "24:00" }, `${step}.args.equals must be a time as HH:MM or HH:MM:SS`],
    [
      { field: "when", max: "2026-10-01" },
      `${step}.args.max must be a datetime as YYYY-MM-DDTHH:MM or YYYY-MM-DDTHH:MM:SS`,
    ],
    [{ field: "note", min: "a" }, `${step}.args.min does not apply to text fields`],
    [
      { field: "day", min: "2026-10-31", max: "2026-10-01" },
      `${step}.args.min must not be greater than ${step}.args.max`,
    ],
  ] as Array<[Record<string, unknown>, string]>)("rejects %j", (args, message) => {
    expect(errorMessage(() => definition.normalizeWorkflow(check(args)))).toBe(message);
  });
});
