import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const runtime = require("../../native/chatgpt-cloak-runtime.cjs") as {
  cleanupSingletonLock: (dir: string, opts?: { log?: (...args: any[]) => void }) => boolean;
  sharedProfileDir: (opts?: { log?: (...args: any[]) => void }) => string;
  launchPersistentContextWithRecovery: (opts: {
    launchPersistentContext: (opts: any) => Promise<any>;
    userDataDir: string;
    isSharedProfile?: boolean;
    log?: (...args: any[]) => void;
  }) => Promise<any>;
};

describe("chatgpt-cloak-runtime", () => {
  const originalHome = process.env.HOME;

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  });

  it("cleans a stale SingletonLock symlink when the pid is gone", () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "surf-runtime-home-"));
    process.env.HOME = tmpHome;

    const profileDir = runtime.sharedProfileDir();
    const lockPath = path.join(profileDir, "SingletonLock");
    fs.symlinkSync(`host-999999999`, lockPath);

    const removed = runtime.cleanupSingletonLock(profileDir);

    expect(removed).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(false);
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("removes a non-symlink SingletonLock via fallback cleanup", () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "surf-runtime-home-"));
    process.env.HOME = tmpHome;

    const profileDir = runtime.sharedProfileDir();
    const lockPath = path.join(profileDir, "SingletonLock");
    fs.writeFileSync(lockPath, "not-a-symlink");

    const removed = runtime.cleanupSingletonLock(profileDir);

    expect(removed).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(false);
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("retries once on shared-profile launch lock errors and returns the retried context", async () => {
    const launchPersistentContext = vi
      .fn()
      .mockRejectedValueOnce(new Error("Failed to create a ProcessSingleton for your profile directory"))
      .mockResolvedValueOnce({ ok: true });

    const result = await runtime.launchPersistentContextWithRecovery({
      launchPersistentContext,
      userDataDir: "/tmp/shared-profile",
      isSharedProfile: true,
    });

    expect(result).toEqual({ ok: true });
    expect(launchPersistentContext).toHaveBeenCalledTimes(2);
  });

  it("does not retry lock errors for non-shared profiles", async () => {
    const launchPersistentContext = vi
      .fn()
      .mockRejectedValue(new Error("Failed to create a ProcessSingleton for your profile directory"));

    await expect(
      runtime.launchPersistentContextWithRecovery({
        launchPersistentContext,
        userDataDir: "/tmp/temp-profile",
        isSharedProfile: false,
      }),
    ).rejects.toMatchObject({
      code: "profile_locked",
      userDataDir: "/tmp/temp-profile",
    });

    expect(launchPersistentContext).toHaveBeenCalledTimes(1);
  });
});
