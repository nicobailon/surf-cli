import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const state = require("../../native/private-state.cjs");
const networkStore = require("../../native/network-store.cjs");
const roots: string[] = [];
const originalNetworkPath = process.env.SURF_NETWORK_PATH;

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  if (originalNetworkPath === undefined) {
    delete process.env.SURF_NETWORK_PATH;
  } else {
    process.env.SURF_NETWORK_PATH = originalNetworkPath;
  }
});

describe("private state boundary", () => {
  it("creates private paths, atomically replaces files, and rejects symlinks", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "surf-private-state-"));
    roots.push(parent);
    const root = path.join(parent, "state");
    const directory = path.join(root, "records", "rec-1");
    state.ensurePrivateDir(directory, root);
    const file = path.join(directory, "record.json");
    state.atomicWriteJson(file, { status: "recording" }, { root });
    state.atomicWriteJson(file, { status: "stopped" }, { root });
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ status: "stopped" });
    expect(fs.statSync(root).mode & 0o777).toBe(0o700);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);

    const networkRoot = path.join(root, "network");
    process.env.SURF_NETWORK_PATH = networkRoot;
    networkStore.appendEntrySync({ method: "GET", url: "https://example.test" });
    expect(fs.statSync(networkStore.getRequestsPath()).mode & 0o777).toBe(0o600);

    const target = path.join(root, "target");
    fs.mkdirSync(target);
    const link = path.join(root, "linked");
    fs.symlinkSync(target, link);
    expect(() => state.ensurePrivateDir(path.join(link, "nested"), root)).toThrow(/symbolic link/);
  });

  it("enforces private file mode checks on POSIX but skips them on Windows", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "surf-private-state-"));
    roots.push(parent);
    const root = path.join(parent, "state");
    state.ensurePrivateDir(root, root);
    const file = path.join(root, "private.json");
    fs.writeFileSync(file, "private");
    fs.chmodSync(file, 0o644);
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    if (!platformDescriptor) {
      throw new Error("process.platform descriptor is unavailable");
    }

    try {
      Object.defineProperty(process, "platform", { value: "linux" });
      expect(() => state.readPrivateFile(file, { root, encoding: "utf8" })).toThrow(
        /permissions are too broad/,
      );

      Object.defineProperty(process, "platform", { value: "win32" });
      expect(state.readPrivateFile(file, { root, encoding: "utf8" })).toBe("private");
    } finally {
      Object.defineProperty(process, "platform", platformDescriptor);
    }
  });
});
