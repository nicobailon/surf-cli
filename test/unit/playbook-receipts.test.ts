import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const receipts = require("../../native/playbook-receipts.cjs");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("playbook write receipts", () => {
  it("claims semantic intent before dispatch and does not let a new attempt ID bypass ambiguity", () => {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surf-receipts-")), "state");
    roots.push(path.dirname(root));
    const op = {
      id: "mutate",
      effect: "write",
      safety: { duplicate: "transactional", key: ["resourceId"] },
    };
    const first = receipts.reserveReceipt({
      playbookId: "fixture",
      op,
      args: { resourceId: "r1", secret: "do-not-store" },
      attemptId: "attempt-one",
      root,
    });
    receipts.updateReceipt(first, "indeterminate", { error: "timeout with secret" }, root);
    expect(() =>
      receipts.reserveReceipt({
        playbookId: "fixture",
        op,
        args: { resourceId: "r1", secret: "different" },
        attemptId: "attempt-two",
        root,
      }),
    ).toThrow(/indeterminate/);
    const stored = fs.readFileSync(first.path, "utf8");
    expect(stored).not.toContain("r1");
    expect(stored).not.toContain("secret");
    expect(fs.readdirSync(first.claimDir).filter((name: string) => name.endsWith(".json"))).toEqual(
      ["attempt-one.json"],
    );
  });

  it("fails closed when a process created the semantic claim but crashed before its attempt receipt", () => {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surf-receipts-")), "state");
    roots.push(path.dirname(root));
    const op = {
      id: "mutate",
      effect: "write",
      safety: { duplicate: "transactional", key: ["resourceId"] },
    };
    const claimKey = receipts.semanticClaimKey({
      playbookId: "fixture",
      op,
      args: { resourceId: "r1" },
      root,
    });
    fs.mkdirSync(path.join(receipts.receiptRoot(root), claimKey), { mode: 0o700 });
    expect(() =>
      receipts.reserveReceipt({
        playbookId: "fixture",
        op,
        args: { resourceId: "r1" },
        root,
      }),
    ).toThrow(/unresolved semantic claim/);
  });

  it("allows same-attempt retry before dispatch and requires idempotency after dispatch", () => {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surf-receipts-")), "state");
    roots.push(path.dirname(root));
    const op = {
      id: "mutate",
      effect: "write",
      safety: { duplicate: "transactional", key: ["resourceId"] },
    };
    const first = receipts.reserveReceipt({
      playbookId: "fixture",
      op,
      args: { resourceId: "r1" },
      attemptId: "attempt-one",
      root,
    });
    receipts.updateReceipt(first, "not_dispatched", {}, root);
    expect(
      receipts.reserveReceipt({
        playbookId: "fixture",
        op,
        args: { resourceId: "r1" },
        retryAttempt: "attempt-one",
        root,
      }).attemptId,
    ).toBe("attempt-one");

    receipts.updateReceipt(first, "indeterminate", { error: "timeout" }, root);
    expect(() =>
      receipts.reserveReceipt({
        playbookId: "fixture",
        op,
        args: { resourceId: "r1" },
        retryAttempt: "attempt-one",
        root,
      }),
    ).toThrow(/server idempotency/);
    expect(
      receipts.reserveReceipt({
        playbookId: "fixture",
        op: { ...op, safety: { ...op.safety, serverIdempotency: { header: "Idempotency-Key" } } },
        args: { resourceId: "r1" },
        retryAttempt: "attempt-one",
        root,
      }).attemptId,
    ).toBe("attempt-one");
  });
});
