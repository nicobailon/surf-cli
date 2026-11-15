import { describe, expect, it, vi } from "vitest";

import { checkStateChanges } from "../setup/state-guard";

const stateDir = "/home/user/.surf/state";
const journal = `${stateDir}/activity-journal/events.jsonl`;
const before = new Map([[journal, "100:1"]]);
const after = new Map([[journal, "180:2"]]);

describe("real state dir guard", () => {
  it("fails in CI or when strict, and warns locally", () => {
    for (const env of [{ CI: "true" }, { SURF_TEST_STATE_GUARD: "strict" }]) {
      expect(() => checkStateChanges({ stateDir, before, after, env, warn: vi.fn() })).toThrow(
        `Tests wrote to the real Surf state dir ${stateDir}: ${journal}`,
      );
    }

    const warn = vi.fn();
    expect(() => checkStateChanges({ stateDir, before, after, env: {}, warn })).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(journal));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("the live surf wrote while tests ran"),
    );
  });

  it("stays quiet when nothing changed", () => {
    const warn = vi.fn();
    checkStateChanges({ stateDir, before, after: new Map(before), env: { CI: "true" }, warn });
    expect(warn).not.toHaveBeenCalled();
  });
});
