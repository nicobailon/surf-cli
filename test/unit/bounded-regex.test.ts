import { describe, expect, it } from "vitest";

// @ts-expect-error - CommonJS module without type definitions
import * as bounded from "../../native/bounded-regex.cjs";
// @ts-expect-error - CommonJS module without type definitions
import * as assertions from "../../native/playbook-assertions.cjs";
import { PageWorker } from "../fixtures/page-worker";

const timedOut = "x pattern took too long (over 100 ms); simplify it";

type TabRegex = {
  boundedExec: (run: { pattern: string; text: string; label: string }) => unknown;
  createRegexBudget: (budget: { ms: number; scope: string }) => { remainingMs: number };
  tabExtract: (run: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

/** The module as it runs in a tab, from its injected source, with the tab's Worker (null: none). */
function inTab({
  stepMs,
  worker = PageWorker,
}: {
  stepMs?: number;
  worker?: unknown;
} = {}): TabRegex {
  let now = 0;
  const clock = stepMs === undefined ? performance : { now: () => (now += stepMs) };
  return new Function("performance", "Worker", `${bounded.tabSource()}\nreturn boundedRegex;`)(
    clock,
    worker,
  );
}

/** Runs a script the host sends to the tab, here in Node's global scope. */
const runScript = async (code: string) => new Function(`return ${code}`)();

/** A tab extract's result once the host has made the call that runs its patterns, if it has any. */
async function settle(result: Record<string, unknown>) {
  const pending = result.regexPending as { key: string } | undefined;
  return pending ? runScript(bounded.stashCallScript(pending.key)) : result;
}

/** Runs [pattern, text] pairs as one tab extract: resolves to { value: matches } or rejects. */
async function tabMatches(regex: TabRegex, pairs: Array<[string, string]>, budgetMs = 1000) {
  return settle(
    await regex.tabExtract({
      budget: regex.createRegexBudget({ ms: budgetMs, scope: "extract" }),
      extract: () =>
        pairs.map(([pattern, text]) => regex.boundedExec({ pattern, text, label: "x" })),
      onValue: (value: unknown) => ({ value }),
      onError: (error: Error) => {
        throw error;
      },
    }),
  );
}

class BlockedWorker {
  constructor() {
    throw new Error("Refused to create a worker: Content Security Policy");
  }
}

describe("bounded regex on the host", () => {
  it("returns the match with its groups, or null", () => {
    const budget = bounded.createRegexBudget({ ms: 1000, scope: "extract" });
    const found = bounded.boundedExec({
      pattern: "(\\d+)-(\\w+)?",
      text: "id 42-",
      budget,
      label: "x",
    });
    expect(found).toEqual(["42-", "42", undefined]);
    expect(Array.isArray(found)).toBe(true);
    expect(bounded.boundedExec({ pattern: "z", text: "abc", budget, label: "x" })).toBeNull();
    // Only the first 64 KB of the text is tested.
    expect(
      bounded.boundedExec({ pattern: "x$", text: `${"a".repeat(70000)}x`, budget, label: "x" }),
    ).toBeNull();
  });

  it("stops a run past 100 ms", () => {
    const budget = bounded.createRegexBudget({ ms: 1000, scope: "extract" });
    const started = Date.now();
    expect(() =>
      bounded.boundedExec({ pattern: "(a+)+b", text: "a".repeat(60), budget, label: "x" }),
    ).toThrow(timedOut);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("refuses a pattern over 500 characters or that is not a regex", () => {
    const budget = bounded.createRegexBudget({ ms: 1000, scope: "extract" });
    expect(() =>
      bounded.boundedExec({ pattern: "a".repeat(501), text: "a", budget, label: "x" }),
    ).toThrow("x is 501 characters; the limit is 500");
    expect(() => bounded.boundedExec({ pattern: "(", text: "a", budget, label: "x" })).toThrow(
      /x is not a valid regex/,
    );
  });

  it("is where playbook-assertions.cjs takes its limits from, MATCH_INPUT_LIMIT included", () => {
    // Callers of boundedMatch read the input limit from playbook-assertions.cjs.
    expect(assertions.MATCH_INPUT_LIMIT).toBe(64 * 1024);
    expect(assertions.MATCH_INPUT_LIMIT).toBe(bounded.MATCH_INPUT_LIMIT);
  });
});

describe("bounded regex in a tab", () => {
  it("runs patterns in a worker and returns their groups", async () => {
    const result = await tabMatches(inTab(), [
      ["(\\d+)-(\\w+)?", "id 42-"],
      ["z", "abc"],
      ["x$", `${"a".repeat(70000)}x`],
      ["(\\d+)-(\\w+)?", "id 42-"],
    ]);
    expect(result.value).toEqual([["42-", "42", undefined], null, null, ["42-", "42", undefined]]);
    expect(result.regexSpentMs).toBeGreaterThanOrEqual(0);
  });

  it("terminates a run that never ends after 100 ms", async () => {
    // On the page's own thread this outlived an external 1 s kill; a worker can be stopped.
    const started = Date.now();
    await expect(
      tabMatches(inTab(), [
        ["(\\d)", "1"],
        ["(a?){500}b", "aaaa"],
      ]),
    ).rejects.toThrow(timedOut);
    expect(Date.now() - started).toBeLessThan(600);
  });

  it("stops once the budget is spent", async () => {
    // Each run takes 60 ms on this clock: a 1 s budget covers 16 of them.
    const pairs = Array.from({ length: 30 }, (_, index): [string, string] => ["\\d", `n${index}`]);
    await expect(tabMatches(inTab({ stepMs: 60 }), pairs.slice(0, 16))).resolves.toHaveProperty(
      "value",
    );
    await expect(tabMatches(inTab({ stepMs: 60 }), pairs)).rejects.toThrow(
      "skipped: the extract's 1 s regex budget is spent",
    );
  });

  it("hands the patterns to the host's vm when the page blocks workers", async () => {
    for (const blocked of [null, BlockedWorker]) {
      const handed = await tabMatches(inTab({ worker: blocked }), [
        ["(\\d+)", "id 42"],
        ["z", "abc"],
      ]);
      expect(handed.regexNeeded).toMatchObject({
        pairs: [
          { pattern: "(\\d+)", text: "id 42" },
          { pattern: "z", text: "abc" },
        ],
      });
      const budget = bounded.createRegexBudget({ ms: 1000, scope: "extract" });
      await expect(
        bounded.finishTabExtract({ result: handed, budget, runScript }),
      ).resolves.toEqual({
        value: [["42", "42"], null],
      });
    }
    const slow = await tabMatches(inTab({ worker: null }), [["(a?){500}b", "aaaa"]]);
    const budget = bounded.createRegexBudget({ ms: 1000, scope: "extract" });
    const started = Date.now();
    await expect(bounded.finishTabExtract({ result: slow, budget, runScript })).rejects.toThrow(
      timedOut,
    );
    expect(Date.now() - started).toBeLessThan(500);
    // Texts too large to send back are refused, not run on the page. The tab's 50,000-character
    // limit counts the JSON it sends, where a newline takes two characters.
    for (const text of ["a".repeat(50000), "\n".repeat(30000)]) {
      await expect(tabMatches(inTab({ worker: null }), [["x", text]])).rejects.toThrow(
        /this page blocks the Web Worker that match patterns run in .*, and the texts to match come to \d+ characters as JSON, more than the 50000 the tab can send to Surf; narrow the fields that use match/,
      );
    }
  });

  it("returns the same matches from the worker and the host, unmatched groups included", async () => {
    const pairs: Array<[string, string]> = [["(x)?a", "a"]];
    expect((await tabMatches(inTab(), pairs)).value).toStrictEqual([["a", undefined]]);
    const handed = await tabMatches(inTab({ worker: null }), pairs);
    const budget = bounded.createRegexBudget({ ms: 1000, scope: "extract" });
    const finished = await bounded.finishTabExtract({ result: handed, budget, runScript });
    expect(finished.value).toStrictEqual([["a", undefined]]);
  });

  it("keeps its whole output, regexSpentMs included, within what the tab can send", async () => {
    // Under the limit alone, over it once regexSpentMs is added.
    const tab = inTab();
    const result = await settle(
      await tab.tabExtract({
        budget: bounded.createRegexBudget({ ms: 1000, scope: "extract" }),
        extract: () => {
          tab.boundedExec({ pattern: "a", text: "a", label: "x" });
          return "a".repeat(49_975);
        },
        onValue: (text: string) => ({ text }),
        onError: (error: Error) => ({ error: error.message }),
      }),
    );
    expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(50_000);
    expect(result).toMatchObject({
      error: expect.stringMatching(
        /^the tab's result is \d+ characters, more than the 50000 it can send to Surf; narrow the fields$/,
      ),
      regexSpentMs: expect.any(Number),
    });
  });

  it("keeps pairs apart whose pattern and text join the same way", async () => {
    const pairs: Array<[string, string]> = [
      ["a", "\u0000a"],
      ["a\u0000", "a"],
    ];
    expect((await tabMatches(inTab(), pairs)).value).toEqual([["a"], null]);
    const handed = await tabMatches(inTab({ worker: null }), pairs);
    const budget = bounded.createRegexBudget({ ms: 1000, scope: "extract" });
    await expect(bounded.finishTabExtract({ result: handed, budget, runScript })).resolves.toEqual({
      value: [["a"], null],
    });
  });

  it("refuses a long or invalid pattern and runs none outside tabExtract", async () => {
    await expect(tabMatches(inTab(), [["a".repeat(501), "a"]])).rejects.toThrow(
      "x is 501 characters; the limit is 500",
    );
    await expect(tabMatches(inTab(), [["(", "a"]])).rejects.toThrow(/x is not a valid regex/);
    expect(() => inTab().boundedExec({ pattern: "a", text: "a", label: "x" })).toThrow(
      "in a tab, a pattern runs only inside tabExtract",
    );
  });

  it("charges the pattern call's whole allowance when its output can't be read", async () => {
    const budget = bounded.createRegexBudget({ ms: 2000, scope: "run" });
    budget.remainingMs = 1500;
    let given = "";
    let calls = 0;
    await expect(
      bounded.runTabScript({
        budget,
        script: (left: { remainingMs: number }) => {
          given = String(left.remainingMs);
          return "code";
        },
        execute: async () =>
          ++calls === 1
            ? { output: JSON.stringify({ regexPending: { key: "k" } }) }
            : // The tab's output, cut at 50,000 characters.
              { output: `{"records": [${'"x",'.repeat(20_000)}`.slice(0, 50_000) },
        unreadable: (size: number) => new Error(`unreadable (${size} characters)`),
      }),
    ).rejects.toThrow("unreadable (50000 characters)");
    expect(given).toBe("1500");
    expect(budget.remainingMs).toBe(0);
  });

  it("leaves the budget alone for a script that runs no patterns, however long it takes", async () => {
    // A plain network request: no extract, so no regexSpentMs and no pattern call.
    const budget = bounded.createRegexBudget({ ms: 2000, scope: "run" });
    let now = 0;
    const plain = { status: 200, ok: true, url: "https://x.test/", headers: {} };
    const result = await bounded.runTabScript({
      budget,
      now: () => now,
      script: () => "code",
      execute: async () => {
        now += 5000;
        return { output: JSON.stringify(plain) };
      },
      unreadable: () => new Error("unreadable"),
    });
    expect(result).toEqual(plain);
    expect(budget.remainingMs).toBe(2000);
    await expect(
      bounded.runTabScript({
        budget,
        now: () => now,
        script: () => "code",
        execute: async () => ({ output: '{"status": 2' }),
        unreadable: () => new Error("unreadable"),
      }),
    ).rejects.toThrow("unreadable");
    expect(budget.remainingMs).toBe(2000);
  });

  it("charges what the host saw the regex call take, and the whole allowance for a report it can't use", async () => {
    // [what the tab reports, ms the host sees the regex call take, ms charged]; 1,500 ms allowed.
    const cases: Array<[unknown, number, number]> = [
      [undefined, 5, 1500],
      ["12", 5, 1500],
      [Number.NaN, 5, 1500],
      [-3000, 5, 1500],
      [99_999, 5, 1500],
      // A report of 0 while the call took 150 ms (a pattern over 100 ms) is charged the 150.
      [0, 150, 150],
      [40, 150, 150],
      [400, 150, 400],
    ];
    for (const [reported, observedMs, chargedMs] of cases) {
      const budget = bounded.createRegexBudget({ ms: 2000, scope: "run" });
      budget.remainingMs = 1500;
      let now = 0;
      let calls = 0;
      await bounded.runTabScript({
        budget,
        now: () => now,
        script: () => "code",
        execute: async () => {
          calls++;
          if (calls === 1) {
            // Reading the page and fetching cost the regex budget nothing.
            now += 900;
            return { output: JSON.stringify({ regexPending: { key: "k" }, regexSpentMs: 0 }) };
          }
          now += observedMs;
          return {
            output: JSON.stringify(
              reported === undefined ? { value: 1 } : { value: 1, regexSpentMs: reported },
            ),
          };
        },
        unreadable: () => new Error("unreadable"),
      });
      expect(calls, String(reported)).toBe(2);
      expect(budget.remainingMs, String(reported)).toBe(1500 - chargedMs);
    }
  });
});
