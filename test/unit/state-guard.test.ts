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

  it("says a running host most likely wrote the files when its socket exists", () => {
    const warn = vi.fn();
    checkStateChanges({ stateDir, before, after, env: {}, hostSocket: "/tmp/surf.sock", warn });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "A Surf host is running (/tmp/surf.sock exists) and writes these files as it works, so it most likely wrote them; otherwise a test escaped its temp HOME.",
      ),
    );
    expect(() =>
      checkStateChanges({
        stateDir,
        before,
        after,
        env: { CI: "true" },
        hostSocket: "/tmp/surf.sock",
        warn,
      }),
    ).toThrow(`Tests wrote to the real Surf state dir ${stateDir}`);
  });

  it("stays quiet when nothing changed", () => {
    const warn = vi.fn();
    checkStateChanges({ stateDir, before, after: new Map(before), env: { CI: "true" }, warn });
    expect(warn).not.toHaveBeenCalled();
  });
});
