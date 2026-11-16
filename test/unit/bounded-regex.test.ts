import { describe, expect, it } from "vitest";

// @ts-expect-error - CommonJS module without type definitions
import * as bounded from "../../native/bounded-regex.cjs";
// @ts-expect-error - CommonJS module without type definitions
import * as assertions from "../../native/playbook-assertions.cjs";

const timedOut = "x pattern took too long (over 100 ms); simplify it";

/** The module as it runs in a tab: from its injected source, on a clock where each run takes stepMs. */
function inTab(stepMs: number) {
  let now = 0;
  const clock = { now: () => (now += stepMs) };
  return new Function("performance", `${bounded.tabSource()}\nreturn boundedRegex;`)(clock);
}

describe("bounded regex", () => {
  it("returns the match with its groups, or null", () => {
    for (const regex of [bounded, inTab(0)]) {
      const budget = regex.createRegexBudget({ ms: 1000, scope: "extract" });
      const found = regex.boundedExec({
        pattern: "(\\d+)-(\\w+)?",
        text: "id 42-",
        budget,
        label: "x",
      });
      expect(found).toEqual(["42-", "42", undefined]);
      expect(Array.isArray(found)).toBe(true);
      expect(regex.boundedExec({ pattern: "z", text: "abc", budget, label: "x" })).toBeNull();
      // Only the first 64 KB of the text is tested.
      expect(
        regex.boundedExec({ pattern: "x$", text: `${"a".repeat(70000)}x`, budget, label: "x" }),
      ).toBeNull();
    }
  });

  it("stops a run past 100 ms on the host", () => {
    const budget = bounded.createRegexBudget({ ms: 1000, scope: "extract" });
    const started = Date.now();
    expect(() =>
      bounded.boundedExec({ pattern: "(a+)+b", text: "a".repeat(60), budget, label: "x" }),
    ).toThrow(timedOut);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("in a tab, fails a run that took over 100 ms and stops once the budget is spent", () => {
    const slow = inTab(150);
    const budget = slow.createRegexBudget({ ms: 1000, scope: "extract" });
    expect(() => slow.boundedExec({ pattern: "a", text: "a", budget, label: "x" })).toThrow(
      timedOut,
    );

    const tab = inTab(60);
    const spent = tab.createRegexBudget({ ms: 1000, scope: "extract" });
    let runs = 0;
    expect(() => {
      for (;;) {
        tab.boundedExec({ pattern: "a", text: "a", budget: spent, label: "x" });
        runs++;
      }
    }).toThrow("skipped: the extract's 1 s regex budget is spent");
    expect(runs).toBe(16);
  });

  it("refuses a pattern over 500 characters or that is not a regex, in a tab too", () => {
    for (const regex of [bounded, inTab(0)]) {
      const budget = regex.createRegexBudget({ ms: 1000, scope: "extract" });
      expect(() =>
        regex.boundedExec({ pattern: "a".repeat(501), text: "a", budget, label: "x" }),
      ).toThrow("x is 501 characters; the limit is 500");
      expect(() => regex.boundedExec({ pattern: "(", text: "a", budget, label: "x" })).toThrow(
        /x is not a valid regex/,
      );
    }
  });

  it("is where playbook-assertions.cjs takes its limits from, MATCH_INPUT_LIMIT included", () => {
    // Callers of boundedMatch read the input limit from playbook-assertions.cjs.
    expect(assertions.MATCH_INPUT_LIMIT).toBe(64 * 1024);
    expect(assertions.MATCH_INPUT_LIMIT).toBe(bounded.MATCH_INPUT_LIMIT);
  });
});
