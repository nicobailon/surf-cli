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

  it("the default guard: same op and inputs blocked 5 minutes after a send, an unknown outcome until --repeat", () => {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surf-receipts-")), "state");
    roots.push(path.dirname(root));
    const { validateOp } = require("../../native/playbooks.cjs");
    const op = validateOp(
      { id: "order", args: { name: {} }, request: { method: "POST", url: "https://a.test/post" } },
      {},
    );
    const send = (args: Record<string, unknown>, now: number, extra = {}) =>
      receipts.reserveReceipt({ playbookId: "shop", op, args, now, root, ...extra });
    const t0 = Date.parse("2026-11-18T10:00:00Z");
    receipts.updateReceipt(send({ name: "Ada" }, t0), "verified", {}, root);
    expect(() => send({ name: "Ada" }, t0 + 60_000)).toThrow(
      /write blocked by verified receipt .*sent 1 min ago.*--repeat sends it again/,
    );
    // Other inputs are another write.
    expect(send({ name: "Bob" }, t0 + 60_000)).toBeTruthy();
    const repeated = send({ name: "Ada" }, t0 + 60_000, { repeat: true });
    receipts.updateReceipt(repeated, "verified", {}, root);
    const later = t0 + 60_000 + 5 * 60_000;
    const after = send({ name: "Ada" }, later);
    // A send whose outcome is unknown blocks past the window, until --repeat.
    receipts.updateReceipt(after, "indeterminate", { error: "tab closed" }, root);
    expect(() => send({ name: "Ada" }, later + 60 * 60_000)).toThrow(
      /indeterminate receipt .*outcome is unknown.*--repeat/,
    );
    expect(send({ name: "Ada" }, later + 60 * 60_000, { repeat: true })).toBeTruthy();
    // Nothing went out: the next run may send.
    const unsent = send({ name: "Cy" }, later);
    receipts.updateReceipt(unsent, "not_dispatched", {}, root);
    expect(send({ name: "Cy" }, later)).toBeTruthy();
    // A send the site answered with an error is blocked for the window too, then may go again.
    const denied = send({ name: "Dee" }, later);
    receipts.updateReceipt(denied, "indeterminate", { error: "status 403", answered: true }, root);
    expect(() => send({ name: "Dee" }, later + 60_000)).toThrow(/answered 1 min ago/);
    expect(send({ name: "Dee" }, later + 5 * 60_000)).toBeTruthy();
    expect(fs.readFileSync(after.path, "utf8")).not.toContain("Ada");
  });
});
