import { afterEach, describe, expect, it, vi } from "vitest";

const {
  AUTHENTICATED_IDLE_MS,
  HostSessionManager,
  LEASE_IDLE_MS,
  MAX_CONNECTIONS,
  MAX_PRINCIPAL_CONNECTIONS,
  MAX_REMOTE_CONNECTIONS,
  MAX_WAITERS,
  QUEUE_TIMEOUT_MS,
  resolveRequestDeadlineMs,
} = require("../../native/host-sessions.cjs") as {
  HostSessionManager: new (
    options?: Record<string, unknown>,
  ) => {
    admit(socket: object, isRemote: boolean): Record<string, unknown>;
    authenticate(
      context: Record<string, unknown>,
      principal: { clientId: string; label: string },
    ): void;
    beginRequest(
      context: Record<string, unknown>,
      options: { id: string; tool: string; deadlineMs?: number },
    ): Promise<Record<string, unknown>>;
    canRespond(context: Record<string, unknown>, id: string): boolean;
    complete(context: Record<string, unknown>, id: string, outcome?: string): void;
    close(context: Record<string, unknown>): void;
    canStartStream(context: Record<string, unknown>): boolean;
    stopStream(context: Record<string, unknown>): void;
  };
  AUTHENTICATED_IDLE_MS: number;
  LEASE_IDLE_MS: number;
  MAX_CONNECTIONS: number;
  MAX_PRINCIPAL_CONNECTIONS: number;
  MAX_REMOTE_CONNECTIONS: number;
  MAX_WAITERS: number;
  QUEUE_TIMEOUT_MS: number;
  resolveRequestDeadlineMs(tool: string, args?: Record<string, unknown>): number;
};

const contexts: Array<Record<string, unknown>> = [];
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

function manager() {
  return new HostSessionManager();
}

function connection(sessions: ReturnType<typeof manager>, remote = false) {
  const context = sessions.admit({}, remote);
  contexts.push(context);
  if (remote) {
    sessions.authenticate(context, { clientId: `client-${contexts.length}`, label: "client" });
  }
  return context;
}

describe("host session manager", () => {
  it("serializes FIFO leases and rejects duplicate/in-flight IDs", async () => {
    const sessions = manager();
    const first = connection(sessions);
    const second = connection(sessions);
    const firstRequest = await sessions.beginRequest(first, { id: "one", tool: "one" });
    await expect(sessions.beginRequest(first, { id: "two", tool: "two" })).rejects.toThrow(
      "in-flight",
    );
    sessions.complete(first, "one");
    const secondRequest = await sessions.beginRequest(second, { id: "two", tool: "two" });
    expect(firstRequest.id).toBe("one");
    expect(secondRequest.id).toBe("two");
    sessions.complete(second, "two");
    await expect(sessions.beginRequest(second, { id: "two", tool: "two" })).rejects.toThrow(
      "duplicate",
    );
    sessions.close(first);
    sessions.close(second);
  });

  it("retains an abandoned lease until the active request settles", async () => {
    const sessions = manager();
    const first = connection(sessions);
    const second = connection(sessions);
    await sessions.beginRequest(first, { id: "active", tool: "navigate" });
    sessions.close(first);
    let granted = false;
    const waiting = sessions.beginRequest(second, { id: "queued", tool: "click" }).then(() => {
      granted = true;
    });
    await Promise.resolve();
    expect(granted).toBe(false);
    sessions.complete(first, "active", "abandoned-completed");
    await waiting;
    expect(granted).toBe(true);
    sessions.complete(second, "queued");
    sessions.close(second);
  });

  it("closes authenticated idle connections after fifteen seconds", () => {
    vi.useFakeTimers();
    const sessions = manager();
    const socket = { destroy: vi.fn() };
    const context = sessions.admit(socket, true);
    sessions.authenticate(context, { clientId: "idle", label: "idle" });
    vi.advanceTimersByTime(AUTHENTICATED_IDLE_MS);
    expect(socket.destroy).toHaveBeenCalledOnce();
    sessions.close(context);
  });

  it("keeps an authenticated stream alive past the no-work deadline", () => {
    vi.useFakeTimers();
    const sessions = manager();
    const socket = { destroy: vi.fn() };
    const context = sessions.admit(socket, true);
    sessions.authenticate(context, { clientId: "stream-client", label: "stream-client" });
    expect(sessions.canStartStream(context)).toBe(true);
    vi.advanceTimersByTime(AUTHENTICATED_IDLE_MS);
    expect(socket.destroy).not.toHaveBeenCalled();
    sessions.close(context);
  });

  it("releases an idle lease after five seconds", async () => {
    vi.useFakeTimers();
    const sessions = manager();
    const first = connection(sessions);
    const second = connection(sessions);
    await sessions.beginRequest(first, { id: "one", tool: "one" });
    sessions.complete(first, "one");
    const waiting = sessions.beginRequest(second, { id: "two", tool: "two" });
    await vi.advanceTimersByTimeAsync(LEASE_IDLE_MS);
    await waiting;
    sessions.complete(second, "two");
    sessions.close(first);
    sessions.close(second);
  });

  it("rejects oversized audit-controlled request fields before queueing", async () => {
    const sessions = manager();
    const context = connection(sessions);
    await expect(
      sessions.beginRequest(context, { id: "x".repeat(129), tool: "click" }),
    ).rejects.toThrow("too long");
    await expect(
      sessions.beginRequest(context, { id: "ok", tool: "x".repeat(129) }),
    ).rejects.toThrow("too long");
    sessions.close(context);
  });

  it("enforces total and remote connection caps", () => {
    const sessions = manager();
    const localContexts = Array.from({ length: MAX_CONNECTIONS }, () => sessions.admit({}, false));
    expect(() => sessions.admit({}, false)).toThrow("maximum client connections");
    for (const context of localContexts) {
      sessions.close(context);
    }

    const remoteSessions = manager();
    const remoteContexts = Array.from({ length: MAX_REMOTE_CONNECTIONS }, () =>
      remoteSessions.admit({}, true),
    );
    expect(() => remoteSessions.admit({}, true)).toThrow("maximum remote connections");
    for (const context of remoteContexts) {
      remoteSessions.close(context);
    }
  });

  it("aborts and tombstones at the hard deadline until cleanup settles", async () => {
    vi.useFakeTimers();
    let timedOut: Record<string, unknown> | undefined;
    const sessions = new HostSessionManager({
      onTimeout: (_context: Record<string, unknown>, request: Record<string, unknown>) => {
        timedOut = request;
      },
    });
    const context = connection(sessions);
    await sessions.beginRequest(context, { id: "deadline", tool: "click", deadlineMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    expect(timedOut?.signal).toMatchObject({ aborted: true });
    expect(timedOut?.tombstoned).toBe(true);
    expect(sessions.canRespond(context, "deadline")).toBe(true);
    sessions.complete(context, "deadline", "cleanup-settled");
    sessions.close(context);
  });

  it("times out queued lease requests", async () => {
    vi.useFakeTimers();
    const sessions = manager();
    const first = connection(sessions);
    const second = connection(sessions);
    await sessions.beginRequest(first, { id: "held", tool: "click" });
    const waiting = sessions.beginRequest(second, { id: "queued", tool: "click" });
    const assertion = expect(waiting).rejects.toThrow("timed out waiting");
    await vi.advanceTimersByTimeAsync(QUEUE_TIMEOUT_MS);
    await assertion;
    sessions.complete(first, "held");
    sessions.close(first);
    sessions.close(second);
  });

  it("does not audit queued disconnects as abandoned active work", async () => {
    const events: Array<Record<string, unknown>> = [];
    const sessions = new HostSessionManager({
      audit: (event: Record<string, unknown>) => events.push(event),
    });
    const first = connection(sessions);
    const second = connection(sessions);
    await sessions.beginRequest(first, { id: "held", tool: "click" });
    const queued = sessions
      .beginRequest(second, { id: "queued", tool: "click" })
      .catch(() => undefined);
    await Promise.resolve();
    sessions.close(second);
    await queued;
    expect(
      events.some(
        (event) =>
          event.outcome === "abandoned" &&
          (event.request as Record<string, unknown>).id === "queued",
      ),
    ).toBe(false);
    sessions.complete(first, "held");
    sessions.close(first);
  });

  it("resolves browser and provider deadlines in milliseconds with grace and a cap", () => {
    expect(resolveRequestDeadlineMs("click")).toBe(60000);
    expect(resolveRequestDeadlineMs("chatgpt")).toBe(2700000 + 60000);
    expect(resolveRequestDeadlineMs("gemini", { timeout: 10 })).toBe(10000 + 60000);
    expect(resolveRequestDeadlineMs("aistudio.build")).toBe(600000 + 60000);
    expect(resolveRequestDeadlineMs("chatgpt", { timeout: 999999 })).toBe(50 * 60 * 1000);
  });

  it("enforces stream-only and per-principal stream caps", async () => {
    const sessions = manager();
    const local = sessions.admit({}, false);
    expect(sessions.canStartStream(local)).toBe(true);
    expect(sessions.canStartStream(local)).toBe(false);
    sessions.stopStream(local);
    expect(sessions.canStartStream(local)).toBe(true);
    sessions.close(local);
    const first = sessions.admit({}, true);
    const second = sessions.admit({}, true);
    const third = sessions.admit({}, true);
    sessions.authenticate(first, { clientId: "stream-principal", label: "stream" });
    sessions.authenticate(second, { clientId: "stream-principal", label: "stream" });
    sessions.authenticate(third, { clientId: "stream-principal", label: "stream" });
    expect(sessions.canStartStream(first)).toBe(true);
    expect(sessions.canStartStream(second)).toBe(true);
    expect(sessions.canStartStream(third)).toBe(false);
    await expect(sessions.beginRequest(first, { id: "blocked", tool: "click" })).rejects.toThrow(
      "stream connection",
    );
    sessions.close(first);
    sessions.close(second);
    sessions.close(third);
  });

  it("enforces principal and waiter caps", async () => {
    const sessions = manager();
    const principal = connection(sessions, true);
    sessions.close(principal);
    const principals = Array.from({ length: MAX_PRINCIPAL_CONNECTIONS }, (_, index) => {
      const ctx = sessions.admit({}, true);
      sessions.authenticate(ctx, { clientId: "same", label: `same-${index}` });
      return ctx;
    });
    expect(() =>
      sessions.authenticate(sessions.admit({}, true), { clientId: "same", label: "overflow" }),
    ).toThrow("maximum connections");
    for (const ctx of principals) {
      sessions.close(ctx);
    }

    const first = connection(sessions);
    await sessions.beginRequest(first, { id: "held", tool: "held" });
    const waiters = [];
    const waiterContexts = [];
    for (let index = 0; index < MAX_WAITERS; index += 1) {
      const ctx = connection(sessions);
      waiterContexts.push(ctx);
      waiters.push(sessions.beginRequest(ctx, { id: `queued-${index}`, tool: "queued" }));
    }
    await expect(
      sessions.beginRequest(connection(sessions), { id: "overflow", tool: "queued" }),
    ).rejects.toThrow("queue is full");
    sessions.complete(first, "held", "test-release");
    sessions.close(first);
    for (const ctx of waiterContexts) {
      sessions.close(ctx);
    }
    for (const promise of waiters) {
      promise.catch(() => undefined);
    }
  });
});
