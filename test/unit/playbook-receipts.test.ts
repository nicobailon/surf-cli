import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const receipts = require("../../native/playbook-receipts.cjs");
const { handlePlaybookCli } = require("../../native/playbook-cli.cjs");
const roots: string[] = [];
// Attempt ids are the UUIDs surf generates.
const ATTEMPT_ONE = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const ATTEMPT_TWO = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";

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
      attemptId: ATTEMPT_ONE,
      root,
    });
    receipts.updateReceipt(first, "indeterminate", { error: "timeout with secret" }, root);
    expect(() =>
      receipts.reserveReceipt({
        playbookId: "fixture",
        op,
        args: { resourceId: "r1", secret: "different" },
        attemptId: ATTEMPT_TWO,
        root,
      }),
    ).toThrow(/its result is unknown/);
    const stored = fs.readFileSync(first.path, "utf8");
    expect(stored).not.toContain("r1");
    expect(stored).not.toContain("secret");
    expect(fs.readdirSync(first.claimDir).filter((name: string) => name.endsWith(".json"))).toEqual(
      [`${ATTEMPT_ONE}.json`],
    );
  });

  it("checks a write without writing a receipt, refusing what reserveReceipt would", () => {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surf-receipts-")), "state");
    roots.push(path.dirname(root));
    const op = {
      id: "mutate",
      effect: "write",
      safety: { duplicate: "transactional", key: ["resourceId"] },
    };
    const claim = { playbookId: "fixture", op, args: { resourceId: "r1" }, root };
    receipts.checkReceipt(claim);
    const claims = () =>
      fs
        .readdirSync(receipts.receiptRoot(root), { withFileTypes: true })
        .filter((entry: { isDirectory(): boolean }) => entry.isDirectory());
    expect(claims()).toEqual([]);
    const first = receipts.reserveReceipt({ ...claim, attemptId: ATTEMPT_ONE });
    receipts.updateReceipt(first, "indeterminate", { error: "timeout" }, root);
    expect(() => receipts.checkReceipt(claim)).toThrow(/its result is unknown/);
    expect(() => receipts.checkReceipt({ ...claim, repeat: true })).not.toThrow();
    expect(claims()).toHaveLength(1);
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
    ).toThrow(/stopped before it saved an attempt/);
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
      attemptId: ATTEMPT_ONE,
      root,
    });
    receipts.updateReceipt(first, "not_dispatched", {}, root);
    expect(
      receipts.reserveReceipt({
        playbookId: "fixture",
        op,
        args: { resourceId: "r1" },
        retryAttempt: ATTEMPT_ONE,
        root,
      }).attemptId,
    ).toBe(ATTEMPT_ONE);

    receipts.updateReceipt(first, "indeterminate", { error: "timeout" }, root);
    expect(() =>
      receipts.reserveReceipt({
        playbookId: "fixture",
        op,
        args: { resourceId: "r1" },
        retryAttempt: ATTEMPT_ONE,
        root,
      }),
    ).toThrow(/server idempotency/);
    expect(
      receipts.reserveReceipt({
        playbookId: "fixture",
        op: { ...op, safety: { ...op.safety, serverIdempotency: { header: "Idempotency-Key" } } },
        args: { resourceId: "r1" },
        retryAttempt: ATTEMPT_ONE,
        root,
      }).attemptId,
    ).toBe(ATTEMPT_ONE);
  });

  describe("--repeat", () => {
    const op = {
      id: "mutate",
      effect: "write",
      safety: { duplicate: "transactional", key: ["resourceId"] },
    };
    const setup = (status: string | null) => {
      const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surf-receipts-")), "state");
      roots.push(path.dirname(root));
      const claim = { playbookId: "fixture", op, args: { resourceId: "r1" }, root };
      // 14:02 local time on the day of `now`.
      const now = new Date(2026, 10, 17, 14, 2, 30).getTime();
      const claimDir = path.join(receipts.receiptRoot(root), receipts.semanticClaimKey(claim));
      if (status === null) {
        // A run that made its claim and stopped before it wrote an attempt.
        fs.mkdirSync(claimDir, { mode: 0o700 });
        fs.utimesSync(claimDir, now / 1000, now / 1000);
      } else {
        const first = receipts.reserveReceipt({ ...claim, attemptId: ATTEMPT_ONE, now });
        if (status !== "reserved") {
          receipts.updateReceipt(first, status, {}, root);
        }
      }
      const attempts = () =>
        fs
          .readdirSync(claimDir)
          .filter((name: string) => name.endsWith(".json"))
          .sort();
      return { claim: { ...claim, now: now + 60_000 }, attempts };
    };

    it.each([
      [
        "verified",
        `write blocked: attempt ${ATTEMPT_ONE} was sent at 14:02 and succeeded. Add --repeat to send it again.`,
      ],
      [
        "indeterminate",
        `write blocked: attempt ${ATTEMPT_ONE} was sent at 14:02 and its result is unknown. Check the site, then add --repeat to send again.`,
      ],
      [
        "dispatched",
        `write blocked: attempt ${ATTEMPT_ONE} was sent at 14:02 and surf stopped before its answer came. Check the site, then add --repeat to send again.`,
      ],
      [
        "reserved",
        `write blocked: attempt ${ATTEMPT_ONE} began at 14:02 and surf stopped before it knew whether it was sent. Check the site, then add --repeat to send again.`,
      ],
      [
        "not_dispatched",
        `write blocked: attempt ${ATTEMPT_ONE} failed at 14:02 before it was sent. Add --repeat to send again, or --retry-attempt ${ATTEMPT_ONE} to reuse the attempt.`,
      ],
      [
        null,
        "write blocked: a run at 14:02 claimed these inputs and stopped before it saved an attempt, so it may have been sent. Check the site, then add --repeat to send again.",
      ],
    ])("blocks after %s with its own wording, and --repeat adds one attempt", (status, message) => {
      const { claim, attempts } = setup(status);
      const before = attempts();
      expect(() => receipts.checkReceipt(claim)).toThrow(message);
      expect(() => receipts.reserveReceipt({ ...claim, attemptId: ATTEMPT_TWO })).toThrow(message);
      expect(attempts()).toEqual(before);
      expect(() => receipts.checkReceipt({ ...claim, repeat: true })).not.toThrow();
      const again = receipts.reserveReceipt({ ...claim, repeat: true, attemptId: ATTEMPT_TWO });
      expect(again.receipt).toMatchObject({ attemptId: ATTEMPT_TWO, status: "reserved" });
      expect(attempts()).toEqual([...before, `${ATTEMPT_TWO}.json`].sort());
    });

    it("gives the date of an attempt from another day", () => {
      const { claim } = setup("indeterminate");
      expect(() => receipts.checkReceipt({ ...claim, now: claim.now + 2 * 86_400_000 })).toThrow(
        `attempt ${ATTEMPT_ONE} was sent at 2026-11-17 14:02 and its result is unknown`,
      );
    });
  });

  describe("attempt ids", () => {
    const op = {
      id: "mutate",
      effect: "write",
      safety: { duplicate: "transactional", key: ["resourceId"] },
    };
    const setup = () => {
      const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surf-receipts-")), "state");
      roots.push(path.dirname(root));
      return { root, claim: { playbookId: "fixture", op, args: { resourceId: "r1" }, root } };
    };
    const files = (directory: string): string[] =>
      fs
        .readdirSync(directory, { withFileTypes: true })
        .flatMap((entry: { name: string; isDirectory(): boolean }) =>
          entry.isDirectory()
            ? files(path.join(directory, entry.name))
            : [path.join(directory, entry.name)],
        );

    it.each([
      ["a path", "../../victim"],
      ["a backslash path", "..\\..\\victim"],
      ["a dot-dot", ".."],
      ["a made-up name", "attempt-one"],
    ])("refuses %s before building a path", (_case, id) => {
      const { root, claim } = setup();
      const first = receipts.reserveReceipt({ ...claim, attemptId: ATTEMPT_ONE });
      receipts.updateReceipt(first, "not_dispatched", {}, root);
      const before = files(path.dirname(root)).sort();
      for (const call of [
        () => receipts.checkReceipt({ ...claim, retryAttempt: id }),
        () => receipts.reserveReceipt({ ...claim, retryAttempt: id }),
        () => receipts.reserveReceipt({ ...claim, attemptId: id }),
      ]) {
        expect(call).toThrow(/must be a write attempt id/);
      }
      expect(files(path.dirname(root)).sort()).toEqual(before);
    });

    it("honours --retry-attempt only for an attempt the claim holds", () => {
      const { root, claim } = setup();
      // A fresh claim: nothing to retry, and nothing is written.
      expect(() => receipts.checkReceipt({ ...claim, retryAttempt: ATTEMPT_TWO })).toThrow(
        `receipt attempt not found: ${ATTEMPT_TWO}`,
      );
      expect(() => receipts.reserveReceipt({ ...claim, retryAttempt: ATTEMPT_TWO })).toThrow(
        `receipt attempt not found: ${ATTEMPT_TWO}`,
      );
      const base = receipts.receiptRoot(root);
      const claims = fs.existsSync(base)
        ? fs
            .readdirSync(base, { withFileTypes: true })
            .filter((entry: { isDirectory(): boolean }) => entry.isDirectory())
        : [];
      expect(claims).toEqual([]);
    });

    it("refuses a bad --retry-attempt in surf use before reaching the host", async () => {
      await expect(
        handlePlaybookCli([
          "use",
          "fixture",
          "mutate",
          "--write",
          "--retry-attempt",
          "../../victim",
        ]),
      ).rejects.toThrow(/--retry-attempt must be a write attempt id/);
    });
  });
});
