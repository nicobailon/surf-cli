import { afterEach, describe, expect, it, vi } from "vitest";
import { captureTab } from "../fixtures/capture-tab";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const playbooks = require("../../native/playbooks.cjs");
const runtime = require("../../native/playbook-runtime.cjs");
const assertions = require("../../native/playbook-assertions.cjs");
const pbTest = require("../../native/playbook-test.cjs");
const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const books = [
  { title: "A Light in the Attic", price: "£51.77" },
  { title: "Tipping the Velvet", price: "£53.74" },
];

describe("assertions", () => {
  it("checks equals, array_min_len, not_null, exists and matches on paths", () => {
    const value = { status: "success", data: { items: books, total: null } };
    expect(
      assertions.checkAssertions(value, [
        { path: "$.status", op: "equals", value: "success" },
        { path: "$.data.items", op: "array_min_len", value: 2 },
        { path: "$.data.items[0].title", op: "not_null" },
        { path: "$.data.total", op: "exists" },
        { path: "$.data.items[1].price", op: "matches", value: "^£\\d+\\.\\d{2}$" },
        { path: "$.data.total", op: "not_null" },
        { path: "$.data.items", op: "array_min_len", value: 3 },
        { path: "$.missing", op: "exists" },
        { path: "$", op: "equals", value: 1 },
      ]),
    ).toEqual([
      { path: "$.status", op: "equals", value: "success", pass: true, actual: "success" },
      { path: "$.data.items", op: "array_min_len", value: 2, pass: true, actual: "array(2)" },
      { path: "$.data.items[0].title", op: "not_null", pass: true, actual: "A Light in the Attic" },
      { path: "$.data.total", op: "exists", pass: true, actual: null },
      {
        path: "$.data.items[1].price",
        op: "matches",
        value: "^£\\d+\\.\\d{2}$",
        pass: true,
        actual: "£53.74",
      },
      { path: "$.data.total", op: "not_null", pass: false, actual: null },
      { path: "$.data.items", op: "array_min_len", value: 3, pass: false, actual: "array(2)" },
      { path: "$.missing", op: "exists", pass: false, actual: "missing" },
      { path: "$", op: "equals", value: 1, pass: false, actual: "object" },
    ]);
  });

  it("stops a matches pattern that backtracks too long and fails it with a clear error", () => {
    const timedOut = "matches pattern took too long (over 100 ms); simplify it";
    // ^((a|aa))+$ first: the old structural check refused it, so without bounded runs this fails
    // at once instead of hanging on the patterns that check let through.
    const slow: Array<[string, string]> = [
      ["^((a|aa))+$", `${"a".repeat(60)}!`],
      ["(a+)+b", "a".repeat(60)],
      ["^(a)+(a)+(a)+(a)+(a)+b$", "a".repeat(200)],
      ["^.*.*.*.*b$", "a".repeat(5000)],
    ];
    for (const [pattern, text] of slow) {
      const assertion = { path: "$", op: "matches", value: pattern };
      expect(() => assertions.validateAssertions([assertion]), pattern).not.toThrow();
      const started = Date.now();
      const [result] = assertions.checkAssertions(text, [assertion]);
      expect(Date.now() - started, pattern).toBeLessThan(500);
      expect(result, pattern).toMatchObject({ pass: false, error: timedOut });
    }
    // Patterns the old check refused, and ordinary ones, run and pass.
    for (const [pattern, text] of [
      ["(a|b)+", "abba"],
      ["^https://x\\.com/\\d+$", "https://x.com/42"],
      ["^(ab)?c$", "abc"],
    ]) {
      const assertion = { path: "$", op: "matches", value: pattern };
      expect(() => assertions.validateAssertions([assertion]), pattern).not.toThrow();
      expect(assertions.checkAssertions(text, [assertion])[0], pattern).toMatchObject({
        pass: true,
      });
      expect(assertions.checkAssertions(text, [assertion])[0], pattern).not.toHaveProperty("error");
    }
    // Only the first 64 KB of the text is tested.
    expect(
      assertions.checkAssertions(`${"a".repeat(70000)}x`, [
        { path: "$", op: "matches", value: "x$" },
      ])[0].pass,
    ).toBe(false);
  });

  it("shares a 1 s regex budget across a run's assertions and skips the rest once it is spent", () => {
    const slow = Array.from({ length: 20 }, () => ({ path: "$", op: "matches", value: "(a+)+b" }));
    let started = Date.now();
    const results = assertions.checkAssertions("a".repeat(60), slow);
    expect(Date.now() - started).toBeLessThan(1200);
    expect(results[0]).toMatchObject({
      pass: false,
      error: "matches pattern took too long (over 100 ms); simplify it",
    });
    expect(results.at(-1)).toMatchObject({
      pass: false,
      error: "skipped: the run's 1 s regex budget is spent",
    });
    expect(
      results.filter((result: { error?: string }) => result.error?.startsWith("skipped")).length,
    ).toBeGreaterThan(5);
    // The host's secret checks spend the same budget; a skipped one counts as touching the secret.
    started = Date.now();
    const checked = assertions.checkAssertions("x", slow, ["a".repeat(60)]);
    expect(Date.now() - started).toBeLessThan(1200);
    expect(
      checked.every((result: { secretSensitive?: boolean }) => result.secretSensitive === true),
    ).toBe(true);
  });

  it("refuses more than 50 assertions on the CLI, on save and when an op loads", () => {
    const many = Array.from({ length: 51 }, () => ({ path: "$", op: "not_null" }));
    expect(() => assertions.validateAssertions(many.slice(0, 50))).not.toThrow();
    expect(() => assertions.validateAssertions(many)).toThrow(
      /at most 50 assertions per op \(got 51\)/,
    );
    expect(() =>
      pbTest.parseTestArgs(["a", "b", ...many.flatMap(() => ["--assert", "$", "not_null"])]),
    ).toThrow(/--assert: at most 50 assertions per op \(got 51\)/);
    expect(() =>
      playbooks.validateOp(op([network], { on: { success: { expect: { assert: many } } } }), {
        origins: [],
      }),
    ).toThrow(/op get_books on\.success\.expect\.assert: at most 50 assertions per op \(got 51\)/);
  });

  it("still refuses invalid and overlong patterns, and counts a slow one as secret-sensitive", () => {
    const check = (pattern: string) => () =>
      assertions.validateAssertions([{ path: "$", op: "matches", value: pattern }]);
    expect(check("a".repeat(501))).toThrow(
      /assertion 1: matches pattern is 501 characters; the limit is 500/,
    );
    expect(check("(")).toThrow(/assertion 1: matches needs a valid regex/);
    expect(check("a".repeat(500))).not.toThrow();
    // A pattern that runs too long against an env value counts as touching it.
    const started = Date.now();
    const [result] = assertions.checkAssertions(
      "x",
      [{ path: "$", op: "matches", value: "(a+)+b" }],
      ["a".repeat(60)],
    );
    expect(Date.now() - started).toBeLessThan(500);
    expect(result).toMatchObject({ pass: false, secretSensitive: true });
  });

  it("checks patterns from the CLI, on save and when an op loads, and bounds them in a run", () => {
    expect(() => pbTest.parseTestArgs(["a", "b", "--assert", "$", "matches", "("])).toThrow(
      /--assert: assertion 1: matches needs a valid regex/,
    );
    expect(() =>
      playbooks.validateOp(
        op([network], {
          on: {
            success: { expect: { assert: [{ path: "$", op: "matches", value: "a".repeat(501) }] } },
          },
        }),
        { origins: [] },
      ),
    ).toThrow(
      /op get_books on\.success\.expect\.assert: assertion 1: matches pattern is 501 characters/,
    );
    return expect(
      runtime.runPlaybookOp({
        playbook: { id: "books", provenance: { scope: "test" } },
        op: op([network]),
        assertions: [{ path: "$.bodyJson.text", op: "matches", value: "(a+)+b" }],
        executeTool: captureTab({
          reply: () => ({ body: JSON.stringify({ text: "a".repeat(60) }) }),
        }).executeTool,
      }),
    ).rejects.toThrow(/matches pattern took too long \(over 100 ms\); simplify it/);
  });

  it("rejects malformed assertions", () => {
    expect(() =>
      assertions.validateAssertions([{ path: "$", op: "longer_than", value: 1 }]),
    ).toThrow(/assertion 1: op must be one of equals, array_min_len, not_null, exists, matches/);
    expect(() => assertions.validateAssertions([{ path: "records", op: "not_null" }])).toThrow(
      /assertion 1: path must be \$, \$\.path or \$\[n\]/,
    );
    expect(() => assertions.validateAssertions([{ path: "$", op: "array_min_len" }])).toThrow(
      /assertion 1: array_min_len needs a value/,
    );
    expect(() =>
      assertions.validateAssertions([{ path: "$", op: "array_min_len", value: -1 }]),
    ).toThrow(/array_min_len needs an integer >= 0/);
    expect(() => assertions.validateAssertions([{ path: "$", op: "matches", value: "(" }])).toThrow(
      /matches needs a valid regex/,
    );
    expect(() => assertions.validateAssertions([{ path: "$", op: "not_null", value: 1 }])).toThrow(
      /not_null takes no value/,
    );
  });
});

function op(run: unknown[], extra: Record<string, unknown> = {}) {
  return { id: "get_books", effect: "read", args: {}, run, ...extra };
}

const network = { using: "network", request: { method: "GET", url: "https://books.test/" } };
const workflow = {
  using: "workflow",
  steps: [{ cmd: "page.text", args: {}, as: "text" }],
  extract: { jsonPath: "$.vars.text" },
  stepDelay: 0,
  autoWait: false,
};

/** network answers `networkBody` as JSON; the workflow's page.text answers `pageText`. */
function tab(networkBody: unknown, pageText: unknown = "page") {
  return vi.fn(async (tool: string) =>
    tool === "javascript_tool"
      ? { output: JSON.stringify({ ok: true, status: 200, bodyJson: networkBody }) }
      : { value: pageText },
  );
}

describe("running an op with assertions", () => {
  it("falls back to the next strategy when a read's saved assertions fail, keeping the results", async () => {
    const executeTool = tab({ items: [] }, ["from page"]);
    const result = await runtime.runPlaybookOp({
      playbook: { id: "books", provenance: { scope: "test" } },
      op: op([{ ...network, extract: { jsonPath: "$.items" } }, workflow], {
        on: { success: { expect: { assert: [{ path: "$", op: "array_min_len", value: 1 }] } } },
      }),
      executeTool,
      sleep: vi.fn(),
    });
    expect(result.strategy).toBe("workflow");
    expect(result.assertions).toEqual([
      { path: "$", op: "array_min_len", value: 1, pass: true, actual: "array(1)" },
    ]);
    expect(result.attempts[0]).toMatchObject({
      using: "network",
      error: "assertion failed: $ array_min_len",
      assertions: [{ path: "$", op: "array_min_len", value: 1, pass: false, actual: "array(0)" }],
    });
  });

  it("runs only the forced strategy, with assertions given for this run", async () => {
    const executeTool = tab({ items: [] });
    await expect(
      runtime.runPlaybookOp({
        playbook: { id: "books", provenance: { scope: "test" } },
        op: op([{ ...network, extract: { jsonPath: "$.items" } }, workflow]),
        strategy: "network",
        assertions: [{ path: "$", op: "array_min_len", value: 1 }],
        executeTool,
        sleep: vi.fn(),
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/All strategies failed \(network: assertion failed/),
      attempts: [expect.objectContaining({ using: "network" })],
    });
    expect(executeTool).toHaveBeenCalledOnce();
    await expect(
      runtime.runPlaybookOp({
        playbook: { id: "books", provenance: { scope: "test" } },
        op: op([network]),
        strategy: "workflow",
        executeTool,
      }),
    ).rejects.toThrow(/op get_books has no workflow strategy \(it has network\)/);
  });

  it("never retries a write on the next strategy after a failed assertion, and leaves it in doubt", async () => {
    const statuses: string[] = [];
    const errors: string[] = [];
    // A raw-body op: the body is read from network capture.
    const { executeTool } = captureTab({
      reply: () => ({ body: JSON.stringify({ created: false }) }),
    });
    await expect(
      runtime.runPlaybookOp({
        playbook: { id: "hr", provenance: { scope: "test" } },
        op: {
          id: "create",
          effect: "write",
          args: {},
          safety: { duplicate: "transactional", key: ["name"] },
          run: [
            { using: "network", request: { method: "POST", url: "https://hr.test/a" } },
            { using: "network", request: { method: "POST", url: "https://hr.test/b" } },
          ],
          on: {
            success: {
              expect: { assert: [{ path: "$.bodyJson.created", op: "equals", value: true }] },
            },
          },
        },
        executeTool,
        beforeDispatch: async () => statuses.push("dispatched"),
        afterDispatch: async ({ status, error }: { status: string; error?: string }) => {
          statuses.push(status);
          if (error) {
            errors.push(error);
          }
        },
      }),
    ).rejects.toThrow(/^assertion failed: \$\.bodyJson\.created equals$/);
    // The receipt records the failure without the value the response held.
    expect(errors).toEqual(["assertion failed: $.bodyJson.created equals"]);
    expect(executeTool.mock.calls.filter(([tool]) => tool === "javascript_tool")).toHaveLength(1);
    expect(statuses).toEqual(["dispatched", "indeterminate"]);
  });

  it("keeps a failed write's attempts and assertions for pb test, and its errors short", async () => {
    const errors: string[] = [];
    const writeOp = {
      id: "create",
      effect: "write",
      args: {},
      safety: { duplicate: "transactional", key: ["name"] },
      run: [{ using: "network", request: { method: "POST", url: "https://hr.test/a" } }],
    };
    const hostRun = (params: Record<string, any>) =>
      runtime.testPlaybookOp({
        playbook: { id: "hr", provenance: { scope: "test" } },
        op: writeOp,
        assertions: params.assert,
        executeTool: captureTab({ reply: () => ({ body: JSON.stringify({ n: 2 }) }) }).executeTool,
        afterDispatch: async ({ error }: { error?: string }) => {
          if (error) {
            errors.push(error);
          }
        },
      });
    const failing = { path: "$.bodyJson.n", op: "equals", value: 1, pass: false, actual: 2 };
    const failed = await hostRun({ assert: [{ path: "$.bodyJson.n", op: "equals", value: 1 }] });
    expect(failed).toMatchObject({
      status: "failed",
      error: "assertion failed: $.bodyJson.n equals",
      attempts: [
        { using: "network", error: "assertion failed: $.bodyJson.n equals", assertions: [failing] },
      ],
    });
    expect(errors).toEqual(["assertion failed: $.bodyJson.n equals"]);
    // pb test reports it, as it does for a read.
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "surf-pbtest-"));
    tempDirs.push(cwd);
    const directory = path.join(cwd, ".surf", "playbooks", "hr");
    fs.mkdirSync(path.join(directory, "ops"), { recursive: true });
    fs.writeFileSync(
      path.join(directory, "playbook.json"),
      JSON.stringify({ id: "hr", version: "1.0.0", origins: ["https://hr.test"] }),
    );
    fs.writeFileSync(path.join(directory, "ops", "create.json"), JSON.stringify(writeOp));
    const report = await pbTest.runPlaybookTest({
      argv: ["hr", "create", "--assert", "$.bodyJson.n", "equals", "1", "--write"],
      cwd,
      home: cwd,
      env: {},
      runOp: hostRun,
    });
    expect(report).toMatchObject({ ok: false, assertions: [failing] });
    expect(report.attempts).toHaveLength(1);
  });

  it("validates saved assertions when it loads an op", () => {
    const validate = (assert: unknown) =>
      playbooks.validateOp(op([network], { on: { success: { expect: { assert } } } }), {
        origins: [],
      });
    expect(() => validate([{ path: "$", op: "array_min_len", value: 1 }])).not.toThrow();
    expect(() => validate([{ path: "$", op: "nope" }])).toThrow(
      /op get_books on.success.expect.assert: assertion 1: op must be one of/,
    );
    expect(() => validate({})).toThrow(/must be an array/);
  });

  it("validates a strategy's own verify.assert and expect.assert, and caps all of an op's at 50", () => {
    const many = (count: number) =>
      Array.from({ length: count }, () => ({ path: "$", op: "exists" }));
    const validate = (strategy: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      playbooks.validateOp(op([{ ...network, ...strategy }], extra), { origins: [] });
    for (const key of ["verify", "expect"]) {
      const where = `op get_books network strategy ${key}\\.assert`;
      const check = (assert: unknown) => () => validate({ [key]: { assert } });
      expect(check(many(50))).not.toThrow();
      expect(check(many(51))).toThrow(
        new RegExp(`${where}: at most 50 assertions per op \\(got 51\\)`),
      );
      expect(check([{ path: "records", op: "exists" }])).toThrow(
        new RegExp(`${where}: assertion 1: path must be`),
      );
      expect(check([{ path: "$", op: "matches", value: "(" }])).toThrow(
        new RegExp(`${where}: assertion 1: matches needs a valid regex`),
      );
      expect(check([{ path: "$", op: "matches", value: "a".repeat(501) }])).toThrow(
        new RegExp(`${where}: assertion 1: matches pattern is 501 characters`),
      );
    }
    // Every location counts toward the op's 50.
    expect(() =>
      validate(
        { verify: { assert: many(20) }, expect: { assert: many(20) } },
        { on: { success: { expect: { assert: many(11) } } } },
      ),
    ).toThrow(
      /op get_books: at most 50 assertions per op across all its strategies and on\.success \(got 51\)/,
    );
    expect(() =>
      validate(
        { verify: { assert: many(20) }, expect: { assert: many(20) } },
        { on: { success: { expect: { assert: many(10) } } } },
      ),
    ).not.toThrow();
  });

  it("keeps the actual value out of a failed assertion's error, which is journaled", async () => {
    const echoed = "dummy-echoed-input";
    const events: Array<Record<string, unknown>> = [];
    const failed = await runtime.testPlaybookOp({
      playbook: { id: "books", provenance: { scope: "test" } },
      op: op([{ ...network, extract: { jsonPath: "$" } }]),
      assertions: [{ path: "$.note", op: "equals", value: "expected" }],
      executeTool: tab({ note: echoed }),
      onEvent: (event: Record<string, unknown>) => events.push(event),
    });
    expect(failed.attempts[0]).toEqual({
      using: "network",
      error: "assertion failed: $.note equals",
      // pb test's own report still shows it.
      assertions: [
        { path: "$.note", op: "equals", value: "expected", pass: false, actual: echoed },
      ],
    });
    expect(failed.error).not.toContain(echoed);
    expect(events.find((event) => event.type === "strategy.failed")).toMatchObject({
      error: "assertion failed: $.note equals",
    });
    expect(JSON.stringify(events)).not.toContain(echoed);
  });
});

describe("surf pb test arguments", () => {
  it("reads assertions, inputs and options", () => {
    expect(
      pbTest.parseTestArgs([
        "books",
        "get_books",
        "--page",
        "2",
        "--assert",
        "$",
        "array_min_len",
        "1",
        "--assert",
        "$[0].title",
        "not_null",
        "--assert",
        "$.status",
        "equals",
        "success",
        "--assert",
        "$.count",
        "equals",
        "20",
        "--strategy",
        "network",
        "--save",
        "--json",
      ]),
    ).toEqual({
      playbook: "books",
      op: "get_books",
      args: { page: "2" },
      assertions: [
        { path: "$", op: "array_min_len", value: 1 },
        { path: "$[0].title", op: "not_null" },
        { path: "$.status", op: "equals", value: "success" },
        { path: "$.count", op: "equals", value: 20 },
      ],
      options: { strategy: "network", save: true, json: true },
    });
    expect(pbTest.parseTestArgs(["a", "b", "--args", '{"q":"x","n":2}', "--n", "3"]).args).toEqual({
      q: "x",
      n: "3",
    });
    expect(pbTest.parseTestArgs(["a", "b"]).assertions).toBeUndefined();
    expect(() => pbTest.parseTestArgs(["a", "b", "--assert", "$", "array_min_len"])).toThrow(
      /--assert \$ array_min_len needs a value/,
    );
    expect(() => pbTest.parseTestArgs(["a", "b", "--args", "[1]"])).toThrow(
      /--args must be a JSON object/,
    );
    expect(() => pbTest.parseTestArgs(["a"])).toThrow(/Usage: surf pb test/);
  });
});

function writeOp(base: string, extra: Record<string, unknown> = {}) {
  const directory = path.join(base, ".surf", "playbooks", "books");
  fs.mkdirSync(path.join(directory, "ops"), { recursive: true });
  fs.writeFileSync(
    path.join(directory, "playbook.json"),
    JSON.stringify({ id: "books", version: "1.0.0" }),
  );
  const file = path.join(directory, "ops", "get_books.json");
  fs.writeFileSync(
    file,
    JSON.stringify({ id: "get_books", effect: "read", run: [network, workflow], ...extra }),
  );
  return file;
}

describe("surf pb test", () => {
  const passed = {
    status: "completed",
    playbook: "books",
    op: "get_books",
    strategy: "network",
    value: books,
    attempts: [],
  };

  function setup(extra: Record<string, unknown> = {}) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "surf-pbtest-"));
    tempDirs.push(cwd);
    return { cwd, home: cwd, file: writeOp(cwd, extra) };
  }

  it("reports each assertion, the strategy that answered, the record count and the time", async () => {
    const { cwd, home } = setup();
    const runOp = vi.fn(async () => ({
      ...passed,
      assertions: [{ path: "$", op: "array_min_len", value: 1, pass: true, actual: "array(2)" }],
    }));
    let clock = 1000;
    const report = await pbTest.runPlaybookTest({
      argv: ["books", "get_books", "--assert", "$", "array_min_len", "1", "--strategy", "network"],
      cwd,
      home,
      runOp,
      now: () => (clock += 250),
    });
    expect(runOp).toHaveBeenCalledWith({
      playbook: "books",
      op: "get_books",
      args: {},
      assert: [{ path: "$", op: "array_min_len", value: 1 }],
      strategy: "network",
      write: false,
      allowScript: false,
    });
    expect(report).toEqual({
      ok: true,
      playbook: "books",
      op: "get_books",
      strategy: "network",
      forced: "network",
      records: 2,
      durationMs: 250,
      assertionSource: "cli",
      assertions: [{ path: "$", op: "array_min_len", value: 1, pass: true, actual: "array(2)" }],
      attempts: [],
      saved: null,
    });
    expect(pbTest.formatTestReport(report)).toBe(
      "PASS books get_books: network answered, 2 records, 250 ms\n  pass  $ array_min_len 1 (array(2))",
    );
  });

  it("fails with the failing assertion when no strategy answers", async () => {
    const { cwd, home } = setup();
    const failing = {
      path: "$[0].title",
      op: "equals",
      value: "x",
      pass: false,
      actual: "A Light in the Attic",
    };
    const report = await pbTest.runPlaybookTest({
      argv: ["books", "get_books", "--assert", "$[0].title", "equals", "x", "--save"],
      cwd,
      home,
      runOp: async () => ({
        status: "failed",
        playbook: "books",
        op: "get_books",
        error: "All strategies failed",
        attempts: [
          {
            using: "network",
            error: "assertion failed: $[0].title equals",
            assertions: [failing],
          },
          { using: "workflow", error: "navigate failed" },
        ],
      }),
      now: () => 0,
    });
    expect(report).toMatchObject({
      ok: false,
      strategy: null,
      records: null,
      assertions: [failing],
      error: "All strategies failed",
      saved: null,
      notSaved: "the test failed, so the assertions were not saved",
    });
    expect(pbTest.formatTestReport(report)).toContain(
      '  FAIL  $[0].title equals "x" (A Light in the Attic)',
    );
    expect(pbTest.formatTestReport(report)).toContain("  workflow: navigate failed");
  });

  it("saves passing assertions in the op, and later runs use them", async () => {
    const { cwd, home, file } = setup();
    const assert = [{ path: "$", op: "array_min_len", value: 1 }];
    const report = await pbTest.runPlaybookTest({
      argv: ["books", "get_books", "--assert", "$", "array_min_len", "1", "--save"],
      cwd,
      home,
      runOp: async () => ({
        ...passed,
        assertions: [{ ...assert[0], pass: true, actual: "array(2)" }],
      }),
    });
    expect(report.saved).toBe(file);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).on).toEqual({
      success: { expect: { assert } },
    });
    expect(
      playbooks.resolveOp("books", "get_books", { cwd, home }).op.on.success.expect.assert,
    ).toEqual(assert);

    const runOp = vi.fn(async (_params: Record<string, unknown>) => ({
      ...passed,
      assertions: [{ ...assert[0], pass: true, actual: "array(2)" }],
    }));
    const later = await pbTest.runPlaybookTest({ argv: ["books", "get_books"], cwd, home, runOp });
    expect(runOp.mock.calls[0][0]).not.toHaveProperty("assert");
    expect(later.assertionSource).toBe("saved");
  });

  it("rejects an input the op doesn't define, as surf use does, before running anything", async () => {
    const { cwd, home } = setup({ args: { page: { default: "1" } } });
    const runOp = vi.fn();
    await expect(
      pbTest.runPlaybookTest({ argv: ["books", "get_books", "--pag", "2"], cwd, home, runOp }),
    ).rejects.toThrow(
      /Unknown input --pag for books get_books\. Did you mean --page\? Its inputs: --page/,
    );
    await expect(
      pbTest.runPlaybookTest({
        argv: ["books", "get_books", "--args", '{"sort":"asc"}'],
        cwd,
        home,
        runOp,
      }),
    ).rejects.toThrow(/Unknown input --sort for books get_books/);
    expect(runOp).not.toHaveBeenCalled();
  });

  it("takes --timeout as the run's deadline, as surf use does", async () => {
    const { cwd, home } = setup({ args: { page: { default: "1" } } });
    const runOp = vi.fn(async (_params: Record<string, unknown>) => ({
      ...passed,
      assertions: [],
    }));
    await pbTest.runPlaybookTest({
      argv: ["books", "get_books", "--page", "2", "--timeout", "30"],
      cwd,
      home,
      runOp,
    });
    expect(runOp.mock.calls[0][0]).toMatchObject({
      args: { page: "2", timeout: "30" },
      timeout: 30,
    });
  });

  it("refuses a write op without --write, before running anything", async () => {
    const { cwd, home } = setup({
      effect: "write",
      safety: { duplicate: "transactional", key: ["id"] },
      run: [{ using: "network", request: { method: "POST", url: "https://books.test/order" } }],
    });
    const runOp = vi.fn();
    await expect(
      pbTest.runPlaybookTest({ argv: ["books", "get_books"], cwd, home, runOp }),
    ).rejects.toThrow(/books get_books is a write op; pb test runs it only with --write/);
    expect(runOp).not.toHaveBeenCalled();
  });

  it("refuses --save on a built-in playbook", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "surf-pbtest-"));
    tempDirs.push(cwd);
    await expect(
      pbTest.runPlaybookTest({
        argv: ["page", "read", "--assert", "$", "not_null", "--save"],
        cwd,
        home: cwd,
        runOp: async () => ({
          status: "completed",
          strategy: "workflow",
          value: "text",
          attempts: [],
          assertions: [],
        }),
      }),
    ).rejects.toThrow(/built-in playbook page can't be edited/);
  });
});
