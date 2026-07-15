import { describe, expect, it, vi } from "vitest";

const { BoundedAiQueue } = require("../../native/ai-queue.cjs") as {
  BoundedAiQueue: new (
    options?: Record<string, unknown>,
  ) => {
    enqueue(handler: () => Promise<unknown>, request?: { signal: AbortSignal }): Promise<unknown>;
    get queued(): number;
  };
};

describe("bounded AI queue", () => {
  it("caps queued work and removes aborted items before start", async () => {
    const queue = new BoundedAiQueue({ maxQueued: 2, spacingMs: 0 });
    let release!: () => void;
    const active = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = queue.enqueue(() => active);
    const secondController = new AbortController();
    const second = queue.enqueue(() => Promise.resolve("second"), {
      signal: secondController.signal,
    });
    const third = queue.enqueue(() => Promise.resolve("third"));
    secondController.abort();
    await expect(second).rejects.toMatchObject({ code: "SURF_REQUEST_ABORTED" });
    release();
    await first;
    await expect(third).resolves.toBe("third");
  });

  it("rejects beyond the queue cap", async () => {
    const queue = new BoundedAiQueue({ maxQueued: 1, spacingMs: 0 });
    const release = vi.fn();
    const active = queue.enqueue(
      () => new Promise((resolve) => release.mockImplementation(resolve)),
    );
    const queued = queue.enqueue(() => Promise.resolve("queued"));
    await expect(queue.enqueue(() => Promise.resolve("overflow"))).rejects.toThrow("queue is full");
    release();
    await active;
    await expect(queued).resolves.toBe("queued");
  });
});
