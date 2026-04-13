import { EventEmitter } from "node:events";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
const {
  isSlackCloakAvailable,
  querySlackMessages,
  __setSlackRuntimeForTests,
  __resetSlackRuntimeForTests,
} = require("../../native/slack-cloak-bridge.cjs") as {
  isSlackCloakAvailable: () => boolean;
  querySlackMessages: (opts: any, onProgress?: (progress: any) => void) => Promise<any>;
  __setSlackRuntimeForTests: (overrides: Record<string, unknown>) => void;
  __resetSlackRuntimeForTests: () => void;
};

function createWorker() {
  const worker = new EventEmitter() as any;
  worker.stdout = new EventEmitter();
  worker.stderr = new EventEmitter();
  worker.stdout.setEncoding = vi.fn();
  worker.stderr.setEncoding = vi.fn();
  worker.stdin = { write: vi.fn() };
  worker.kill = vi.fn();
  return worker;
}

describe("slack-cloak-bridge", () => {
  const originalSurfDebug = process.env.SURF_DEBUG;

  beforeEach(() => {
    delete process.env.SURF_DEBUG;
  });

  afterEach(() => {
    __resetSlackRuntimeForTests();
    if (originalSurfDebug === undefined) delete process.env.SURF_DEBUG;
    else process.env.SURF_DEBUG = originalSurfDebug;
    vi.restoreAllMocks();
  });

  describe("isSlackCloakAvailable", () => {
    it("returns false when cloakbrowser is not installed", () => {
      __setSlackRuntimeForTests({ existsSync: () => false });
      expect(isSlackCloakAvailable()).toBe(false);
    });

    it("returns true when cloakbrowser is installed", () => {
      __setSlackRuntimeForTests({
        existsSync: (p: string) => p.includes("cloakbrowser/package.json"),
      });
      expect(isSlackCloakAvailable()).toBe(true);
    });
  });

  it("passes includeDms to worker request", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    __setSlackRuntimeForTests({ spawn, existsSync: () => true });

    const promise = querySlackMessages({ action: "channels", includeDms: true, timeout: 5 });

    expect(worker.stdin.write).toHaveBeenCalledWith(expect.stringContaining('"includeDms":true'));

    worker.stdout.emit("data", `${JSON.stringify({ type: "success", channels: [], channelCount: 0 })}\n`);
    await expect(promise).resolves.toEqual({ channels: [], channelCount: 0 });
  });

  it("forwards all stderr when SURF_DEBUG is set", async () => {
    process.env.SURF_DEBUG = "1";

    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    __setSlackRuntimeForTests({ spawn, existsSync: () => true });

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true as any);

    const promise = querySlackMessages({ action: "channels", timeout: 5 });
    worker.stderr.emit("data", "worker stderr line\n");
    worker.stdout.emit("data", `${JSON.stringify({ type: "success", channels: [], channelCount: 0 })}\n`);

    await promise;
    expect(stderrSpy).toHaveBeenCalledWith("worker stderr line\n");
  });

  it("keeps stderr filtered when SURF_DEBUG is not set", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    __setSlackRuntimeForTests({ spawn, existsSync: () => true });

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true as any);

    const promise = querySlackMessages({ action: "channels", timeout: 5 });
    worker.stderr.emit("data", "plain stderr\n");
    worker.stdout.emit("data", `${JSON.stringify({ type: "success", channels: [], channelCount: 0 })}\n`);

    await promise;
    expect(stderrSpy).not.toHaveBeenCalledWith("plain stderr\n");
  });
});
