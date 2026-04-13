"use strict";

const { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, unlinkSync } = require("fs");
const { homedir, tmpdir } = require("os");
const { join } = require("path");

const SHARED_PROFILE_DIR = () => join(homedir(), ".surf", "cloak-profile");
const DEFAULT_TEMP_PREFIX = "surf-cloak-session-";

function fallbackLog() {}

function cleanupSingletonLock(userDataDir, { log = fallbackLog } = {}) {
  if (!userDataDir) return false;
  const lockPath = join(userDataDir, "SingletonLock");
  try {
    lstatSync(lockPath);
  } catch {
    return false;
  }

  try {
    const target = readlinkSync(lockPath);
    const pidMatch = target.match(/-(\d+)$/);
    if (pidMatch) {
      try {
        process.kill(Number(pidMatch[1]), 0);
        return false;
      } catch {
        unlinkSync(lockPath);
        log("info", "Cleaned stale SingletonLock", { target, lockPath });
        return true;
      }
    }
    return false;
  } catch {
    try {
      unlinkSync(lockPath);
      log("info", "Removed unreadable SingletonLock", { lockPath });
      return true;
    } catch (error) {
      try {
        rmSync(lockPath, { force: true });
        log("info", "Removed unreadable SingletonLock via rmSync", { lockPath });
        return true;
      } catch {
        log("warn", "Failed to remove SingletonLock", { lockPath, error: error?.message || String(error) });
        return false;
      }
    }
  }
}

function sharedProfileDir({ log = fallbackLog } = {}) {
  const dir = SHARED_PROFILE_DIR();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  cleanupSingletonLock(dir, { log });
  return dir;
}

function tempProfileDir(prefix = DEFAULT_TEMP_PREFIX) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function buildLaunchOpts(userDataDir) {
  return {
    userDataDir,
    headless: true,
    humanize: true,
    humanPreset: "careful",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
    timezoneId: "America/New_York",
    args: ["--fingerprint-storage-quota=5000"],
  };
}

function isRecoverableProfileLaunchError(error) {
  const text = [
    error?.message || "",
    error?.stderr || "",
    error?.details?.message || "",
    error?.cause?.message || "",
  ].join(" ");
  return /ProcessSingleton|SingletonLock|profile directory|profile.+in use|already in use/i.test(text);
}

function normalizeProfileLaunchError(error, userDataDir) {
  const normalized = Object.assign(
    new Error("CloakBrowser profile locked. Close other surf instances first."),
    {
      code: "profile_locked",
      userDataDir,
      details: {
        userDataDir,
        originalMessage: error?.message || String(error),
      },
      cause: error,
    },
  );
  return normalized;
}

async function launchPersistentContextWithRecovery({
  launchPersistentContext,
  userDataDir,
  isSharedProfile = false,
  log = fallbackLog,
} = {}) {
  const launchOnce = () => launchPersistentContext(buildLaunchOpts(userDataDir));

  try {
    return await launchOnce();
  } catch (error) {
    const recoverable = isRecoverableProfileLaunchError(error);
    if (!recoverable) throw error;
    if (!isSharedProfile) throw normalizeProfileLaunchError(error, userDataDir);

    log("warn", "Recoverable profile launch failure; retrying after lock cleanup", {
      userDataDir,
      error: error?.message || String(error),
    });
    cleanupSingletonLock(userDataDir, { log });

    try {
      return await launchOnce();
    } catch (retryError) {
      if (isRecoverableProfileLaunchError(retryError)) {
        throw normalizeProfileLaunchError(retryError, userDataDir);
      }
      throw retryError;
    }
  }
}

module.exports = {
  buildLaunchOpts,
  cleanupSingletonLock,
  isRecoverableProfileLaunchError,
  launchPersistentContextWithRecovery,
  sharedProfileDir,
  tempProfileDir,
};
