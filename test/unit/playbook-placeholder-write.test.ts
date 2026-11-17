import { describe, expect, it, vi } from "vitest";

const runtime = require("../../native/playbook-runtime.cjs");

describe("a write op whose request holds <request-body>", () => {
  it("refuses before dispatch and never runs its workflow fallback", async () => {
    const executeTool = vi.fn(async () => ({ success: true }));
    const beforeDispatch = vi.fn();
    const afterDispatch = vi.fn();

    const run = runtime.runPlaybookOp({
      playbook: { id: "fixture", origins: ["https://example.test"], provenance: { scope: "test" } },
      op: {
        id: "submit",
        effect: "write",
        run: [
          {
            using: "network",
            request: {
              method: "POST",
              url: "https://example.test/api/submit",
              headers: { "content-type": "application/json" },
              body: "<request-body>",
            },
          },
          {
            using: "workflow",
            stepDelay: 0,
            steps: [{ cmd: "click", args: { selector: "#dummy-submit" } }],
          },
        ],
      },
      executeTool,
      sleep: vi.fn(),
      beforeDispatch,
      afterDispatch,
    });

    await expect(run).rejects.toThrow(
      "body holds <request-body>: the record redacted the request body; to keep it, record again and stop with pb record stop --draft --include-input-values (or start with --include-input-values)",
    );
    expect(executeTool).not.toHaveBeenCalled();
    expect(beforeDispatch).not.toHaveBeenCalled();
    expect(afterDispatch).toHaveBeenCalledTimes(1);
    expect(afterDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ status: "not_dispatched", index: 0 }),
    );
  });
});
