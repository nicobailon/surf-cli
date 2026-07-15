import { describe, expect, it, vi } from "vitest";

const { RequestPendingMap } = require("../../native/request-pending.cjs") as {
  RequestPendingMap: new () => {
    set(id: number, data: Record<string, unknown>): unknown;
    get(id: number): Record<string, unknown> | undefined;
    resolve(id: number, value: unknown): boolean;
    hardDeadline(request: Record<string, unknown>): void;
    expire(id: number, error: Error): boolean;
    onDrain(request: Record<string, unknown>, callback: () => void): void;
    clear(): void;
  };
};

function request() {
  const controller = new AbortController();
  return {
    controller,
    signal: controller.signal,
    startedAt: Date.now(),
    deadlineMs: 1000,
    pendingEntries: new Set(),
  };
}

describe("request-owned pending operations", () => {
  it("rejects once on abort, retains the tombstone, and drains on late response", async () => {
    const pending = new RequestPendingMap();
    const owner = request();
    const reject = vi.fn();
    const resolveDrain = vi.fn();
    pending.set(1, { request: owner, reject });
    pending.onDrain(owner, resolveDrain);
    owner.controller.abort();
    expect(reject).toHaveBeenCalledOnce();
    expect(pending.get(1)).toBeDefined();
    expect(resolveDrain).not.toHaveBeenCalled();
    pending.resolve(1, { late: true });
    expect(resolveDrain).toHaveBeenCalledOnce();
    owner.controller.abort();
    expect(reject).toHaveBeenCalledOnce();
  });

  it("rejects nested timeouts while retaining their tombstone", () => {
    const pending = new RequestPendingMap();
    const owner = request();
    const reject = vi.fn();
    pending.set(1, { request: owner, reject });
    pending.expire(1, new Error("nested timeout"));
    expect(reject).toHaveBeenCalledOnce();
    expect(pending.get(1)).toBeDefined();
  });

  it("keeps cleanup entries owned after abort and settles them normally", () => {
    const pending = new RequestPendingMap();
    const owner = request();
    const resolve = vi.fn();
    pending.set(1, { request: owner, cleanup: true, resolve });
    owner.controller.abort();
    expect(pending.get(1)).toBeDefined();
    pending.resolve(1, { closed: true });
    expect(resolve).toHaveBeenCalledWith({ closed: true });
    expect(owner.pendingEntries.size).toBe(0);
  });

  it("drains only after every tombstone and cleanup entry settles", () => {
    const pending = new RequestPendingMap();
    const owner = request();
    const reject = vi.fn();
    const resolveCleanup = vi.fn();
    const resolveDrain = vi.fn();
    pending.set(1, { request: owner, reject });
    pending.set(2, { request: owner, cleanup: true, resolve: resolveCleanup });
    pending.onDrain(owner, resolveDrain);
    owner.controller.abort();
    pending.resolve(1, { late: true });
    expect(resolveDrain).not.toHaveBeenCalled();
    pending.resolve(2, { closed: true });
    expect(resolveCleanup).toHaveBeenCalledWith({ closed: true });
    expect(resolveDrain).toHaveBeenCalledOnce();
  });

  it("rejects and removes all owned entries at the hard boundary", () => {
    const pending = new RequestPendingMap();
    const owner = request();
    const reject = vi.fn();
    pending.set(1, { request: owner, reject });
    pending.set(2, { request: owner, cleanup: true, reject });
    pending.hardDeadline(owner);
    expect(owner.pendingEntries.size).toBe(0);
    expect(pending.get(1)).toBeUndefined();
    expect(pending.get(2)).toBeUndefined();
    expect(reject).toHaveBeenCalledTimes(2);
  });

  it("clears listeners and tombstone timers", () => {
    vi.useFakeTimers();
    const pending = new RequestPendingMap();
    const owner = request();
    const reject = vi.fn();
    pending.set(1, { request: owner, reject });
    owner.controller.abort();
    pending.clear();
    vi.advanceTimersByTime(2000);
    expect(reject).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
