import { afterEach, describe, expect, it, vi } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSemanticWorkflowStateStore } = require("../../native/semantic-workflow-state.cjs");

const parents: string[] = [];

function fixture(clock = () => Date.parse("2026-01-02T03:04:05.000Z")) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "surf-semantic-state-"));
  parents.push(parent);
  const root = path.join(parent, "state");
  const options = { root, clock, runId: "run-1", workflowDigest: "a".repeat(64) };
  return { root, options, store: createSemanticWorkflowStateStore(options) };
}

afterEach(() => {
  for (const parent of parents.splice(0)) {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

describe("semantic workflow private state", () => {
  it("persists a bounded redacted attempt through the valid transition paths with private modes", () => {
    const { root, store } = fixture();
    store.acquire();
    const reserved = store.reserve({
      attemptId: "attempt-1",
      stepId: "add-once",
      operation: "click",
      target: { bindingId: "private-product-value", origin: "https://shop.test/private" },
      budgets: { providerCallsRemaining: 7, remainingMs: 9000 },
    });
    expect(reserved.state).toBe("reserved");
    store.dispatchIntent("attempt-1", { budgets: { providerCallsRemaining: 6 } });
    store.terminal("attempt-1", "verified", { reason: "private success detail" });
    store.checkpoint({
      completedSteps: ["add-once"],
      reason: "finished",
      budgets: { remainingMs: 8000 },
    });
    store.release({ state: "completed", reason: "done" });

    const snapshot = store.inspect();
    expect(snapshot.attempts[0]).toMatchObject({ state: "verified", effectiveState: "verified" });
    expect(snapshot.run.state).toBe("completed");
    const persisted = JSON.stringify(snapshot);
    expect(persisted).not.toContain("private-product-value");
    expect(persisted).not.toContain("https://shop.test/private");
    expect(persisted).not.toContain("private success detail");
    expect(persisted).not.toContain('"replay"');

    if (process.platform !== "win32") {
      expect(fs.statSync(root).mode & 0o777).toBe(0o700);
      const files: string[] = [];
      for (const entry of fs.readdirSync(path.join(root, "semantic-workflows"), {
        recursive: true,
        withFileTypes: true,
      })) {
        if (entry.isFile()) {
          files.push(path.join(entry.parentPath, entry.name));
        }
      }
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      }
    }
  });

  it("fails hard for every invalid attempt transition", () => {
    const terminalStates = [
      "not_dispatched",
      "outcome_unknown",
      "acknowledged_unverified",
      "verified",
    ];
    for (const [index, terminalState] of terminalStates.entries()) {
      const { store } = fixture();
      store.acquire();
      const attemptId = `attempt-${index}`;
      store.reserve({ attemptId, stepId: "write", operation: "click" });
      if (terminalState === "not_dispatched") {
        store.terminal(attemptId, terminalState);
      } else {
        store.dispatchIntent(attemptId);
        store.terminal(attemptId, terminalState);
      }
      expect(() => store.dispatchIntent(attemptId)).toThrow(/invalid write attempt transition/);
      expect(() => store.terminal(attemptId, "verified")).toThrow(
        /invalid write attempt transition/,
      );
    }

    const { store } = fixture();
    store.acquire();
    store.reserve({ attemptId: "reserved", stepId: "write", operation: "fill" });
    expect(() => store.terminal("reserved", "verified")).toThrow(/reserved -> verified/);
    expect(() => store.terminal("reserved", "made_up")).toThrow(/invalid terminal/);
    expect(() => store.release({ state: "completed" })).toThrow(/nonterminal attempt/);
  });

  it("inspects a durable dispatch intent without terminal evidence as outcome unknown", () => {
    const { options, store } = fixture();
    store.acquire();
    store.reserve({ attemptId: "lost-reply", stepId: "submit", operation: "click" });
    store.dispatchIntent("lost-reply");

    const observer = createSemanticWorkflowStateStore(options);
    expect(observer.read().attempts).toEqual([
      expect.objectContaining({ state: "dispatch_intent", effectiveState: "outcome_unknown" }),
    ]);
    expect(() => store.release({ state: "outcome_unknown" })).toThrow(/nonterminal attempt/);
    store.terminal("lost-reply", "outcome_unknown", { error: "socket closed after send" });
    expect(store.release({ state: "outcome_unknown" }).state).toBe("outcome_unknown");
  });

  it("blocks concurrent owners and does not allow a released run identity to be replayed", () => {
    const { options, store } = fixture();
    store.acquire();
    const contender = createSemanticWorkflowStateStore(options);
    expect(() => contender.acquire()).toThrow(/already owned/);
    store.release({ state: "completed" });
    expect(() => createSemanticWorkflowStateStore(options).acquire()).toThrow(
      /already completed|already exists/,
    );
  });

  it("surfaces reservation and checkpoint persistence failures before callers can dispatch", () => {
    const reservationFixture = fixture();
    reservationFixture.store.acquire();
    const runDirectory = path.dirname(
      reservationFixture.store.inspect().run ? findFile(reservationFixture.root, "run.json") : "",
    );
    const attemptsDirectory = path.join(runDirectory, "attempts");
    fs.symlinkSync(
      path.join(reservationFixture.root, "missing-target"),
      path.join(attemptsDirectory, "blocked.json"),
    );
    let dispatched = false;
    expect(() => {
      reservationFixture.store.reserve({
        attemptId: "blocked",
        stepId: "write",
        operation: "click",
      });
      dispatched = true;
    }).toThrow(/symbolic link/);
    expect(dispatched).toBe(false);

    const checkpointFixture = fixture();
    checkpointFixture.store.acquire();
    const checkpointRunDirectory = path.dirname(findFile(checkpointFixture.root, "run.json"));
    fs.symlinkSync(
      path.join(checkpointFixture.root, "missing-checkpoint"),
      path.join(checkpointRunDirectory, "checkpoint.json"),
    );
    expect(() => checkpointFixture.store.checkpoint({ completedSteps: [] })).toThrow(
      /symbolic link/,
    );

    const dispatchFixture = fixture();
    dispatchFixture.store.acquire();
    dispatchFixture.store.reserve({
      attemptId: "dispatch-blocked",
      stepId: "write",
      operation: "click",
    });
    const rename = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("injected disk failure"), { code: "EIO" });
    });
    expect(() => dispatchFixture.store.dispatchIntent("dispatch-blocked")).toThrow(
      /injected disk failure/,
    );
    rename.mockRestore();
    expect(dispatchFixture.store.inspect().attempts[0].state).toBe("reserved");
  });

  it("rejects path-shaped identifiers and symlinked private roots", () => {
    const { store } = fixture();
    store.acquire();
    expect(() =>
      store.reserve({ attemptId: "../escape", stepId: "write", operation: "click" }),
    ).toThrow(/unsupported characters/);

    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "surf-semantic-state-link-"));
    parents.push(parent);
    const actual = path.join(parent, "actual");
    fs.mkdirSync(actual);
    const linked = path.join(parent, "linked");
    fs.symlinkSync(actual, linked);
    const linkedStore = createSemanticWorkflowStateStore({
      root: linked,
      runId: "run-link",
      workflowDigest: "b".repeat(64),
    });
    expect(() => linkedStore.acquire()).toThrow(/symbolic link/);
  });
});

function findFile(root: string, name: string): string {
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop() as string;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(candidate);
      }
      if (entry.isFile() && entry.name === name) {
        return candidate;
      }
    }
  }
  throw new Error(`${name} not found`);
}
