import { describe, expect, it } from "vitest";

declare const process: {
  execPath: string;
  platform: string;
  env: Record<string, string | undefined>;
};
declare const require: (moduleName: string) => any;

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  createWrapper,
  writeManifest,
  assertListenTargetSupported,
} = require("../../scripts/install-native-host.cjs");
const { parseListenEndpoint } = require("../../native/listener.cjs");

const extensionA = "abcdefghijklmnopabcdefghijklmnop";
const extensionB = "bcdefghijklmnopabcdefghijklmnopa";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "surf-native-host-test-"));
}

function envWithoutListen() {
  const env = { ...process.env };
  env.SURF_LISTEN = undefined;
  return env;
}

describe("native host installer", () => {
  it("documents the Tailnet-only listener option", () => {
    const result = spawnSync(process.execPath, ["scripts/install-native-host.cjs", "--help"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--listen <tailscale-ip>:<port>");
    expect(result.stdout).toContain("Tailnet-only listener endpoint");
  });

  it("merges manifest allowed_origins without dropping existing fields", () => {
    const tempDir = makeTempDir();
    const manifestPath = path.join(tempDir, "surf.browser.host.json");
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          name: "custom.name",
          description: "Custom description",
          allowed_origins: [`chrome-extension://${extensionA}/`],
          extra: "kept",
        },
        null,
        2,
      ),
    );

    writeManifest(manifestPath, extensionB, "/tmp/host-wrapper.sh");

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(manifest).toMatchObject({
      name: "surf.browser.host",
      description: "Custom description",
      path: "/tmp/host-wrapper.sh",
      type: "stdio",
      extra: "kept",
    });
    expect(manifest.allowed_origins).toEqual([
      `chrome-extension://${extensionA}/`,
      `chrome-extension://${extensionB}/`,
    ]);
  });

  it("executes POSIX wrappers with persisted listen defaults and inherited overrides", () => {
    const tempDir = makeTempDir();
    const nodePath = process.execPath;
    const hostPath = path.join(tempDir, "host.cjs");
    fs.writeFileSync(
      hostPath,
      "process.stdout.write(JSON.stringify({ listen: process.env.SURF_LISTEN, args: process.argv.slice(2) }));",
    );

    const nativeWrapperPath = createWrapper(tempDir, nodePath, hostPath, "linux");
    const nativeWrapperContent = fs.readFileSync(nativeWrapperPath, "utf8");
    if (process.platform === "win32") {
      expect(nativeWrapperContent).toContain(`"${hostPath}" %*`);
    } else {
      expect(nativeWrapperContent).toContain(`"${hostPath}" "$@"`);
      const persisted = spawnSync(nativeWrapperPath, ["one"], {
        encoding: "utf8",
        env: envWithoutListen(),
      });
      expect(JSON.parse(persisted.stdout)).toEqual({ listen: undefined, args: ["one"] });

      const configuredWrapper = createWrapper(
        tempDir,
        nodePath,
        hostPath,
        "linux",
        "100.64.1.2:4321",
      );
      const defaulted = spawnSync(configuredWrapper, ["two"], {
        encoding: "utf8",
        env: envWithoutListen(),
      });
      expect(JSON.parse(defaulted.stdout)).toEqual({ listen: "100.64.1.2:4321", args: ["two"] });
      const overridden = spawnSync(configuredWrapper, ["three"], {
        encoding: "utf8",
        env: { ...envWithoutListen(), SURF_LISTEN: "100.64.1.3:4321" },
      });
      expect(JSON.parse(overridden.stdout)).toEqual({ listen: "100.64.1.3:4321", args: ["three"] });

      const reinstalled = createWrapper(tempDir, nodePath, hostPath, "linux");
      expect(fs.readFileSync(reinstalled, "utf8")).not.toContain("SURF_LISTEN");
      const inherited = spawnSync(reinstalled, ["four"], {
        encoding: "utf8",
        env: { ...envWithoutListen(), SURF_LISTEN: "100.64.1.4:4321" },
      });
      expect(JSON.parse(inherited.stdout)).toEqual({ listen: "100.64.1.4:4321", args: ["four"] });
    }

    const cmdPath = createWrapper(tempDir, nodePath, hostPath, "wsl-windows");
    expect(fs.readFileSync(path.join(tempDir, "host-wrapper-wsl.cmd"), "utf8")).toContain(
      `"${hostPath}" %*`,
    );
    expect(cmdPath).toBeTruthy();
  });

  it("validates Tailnet-only listener endpoints and persists the wrapper setting", () => {
    expect(parseListenEndpoint("100.64.1.2:4321")).toMatchObject({
      host: "100.64.1.2",
      port: 4321,
    });
    expect(parseListenEndpoint("[fd7a:115c:a1e0::1]:4321").display).toBe(
      "[fd7a:115c:a1e0::1]:4321",
    );
    for (const value of [
      "localhost:1",
      "127.0.0.1:1",
      "0.0.0.0:1",
      "host:1",
      "100.1.1.1:1",
      "100.64.1.2:0",
    ]) {
      expect(() => parseListenEndpoint(value)).toThrow();
    }
    const tempDir = makeTempDir();
    const wrapper = createWrapper(
      tempDir,
      process.execPath,
      "/tmp/host.cjs",
      "linux",
      "100.64.1.2:4321",
    );
    expect(fs.readFileSync(wrapper, "utf8")).toContain("SURF_LISTEN:=100.64.1.2:4321");
    const clearedWrapper = createWrapper(tempDir, process.execPath, "/tmp/host.cjs", "linux");
    expect(fs.readFileSync(clearedWrapper, "utf8")).not.toContain("unset SURF_LISTEN");
  });

  it("accepts only inclusive Tailscale IPv4 and IPv6 CIDR boundaries", () => {
    for (const host of ["100.64.0.0", "100.127.255.255"]) {
      expect(parseListenEndpoint(`${host}:1`).host).toBe(host);
    }
    for (const host of ["100.63.255.255", "100.128.0.0"]) {
      expect(() => parseListenEndpoint(`${host}:1`)).toThrow();
    }
    for (const host of ["fd7a:115c:a1e0::", "fd7a:115c:a1e0:ffff:ffff:ffff:ffff:ffff"]) {
      expect(parseListenEndpoint(`[${host}]:1`).host).toBe(host);
    }
    for (const host of ["fd7a:115c:a1df:ffff::1", "fd7a:115c:a1e1::1"]) {
      expect(() => parseListenEndpoint(`[${host}]:1`)).toThrow();
    }
  });

  it("rejects missing and Windows/WSL listener configuration explicitly", () => {
    const missing = spawnSync(
      process.execPath,
      ["scripts/install-native-host.cjs", extensionA, "--listen"],
      { encoding: "utf8" },
    );
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("--listen requires a Tailnet IP and port");
    expect(() => assertListenTargetSupported("100.64.1.2:4321", "win32")).toThrow(
      "Windows native-host wrappers",
    );
    expect(() => assertListenTargetSupported("100.64.1.2:4321", "wsl-windows")).toThrow(
      "Windows native-host wrappers",
    );
  });

  it("rejects install --target linux on non-Linux platforms", ({ skip }) => {
    if (process.platform === "linux") {
      skip();
    }

    const result = spawnSync(
      process.execPath,
      ["scripts/install-native-host.cjs", extensionA, "--target", "linux"],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--target linux is only supported on Linux or WSL2");
  });

  it("rejects uninstall --target linux on non-Linux platforms", ({ skip }) => {
    if (process.platform === "linux") {
      skip();
    }

    const result = spawnSync(
      process.execPath,
      ["scripts/uninstall-native-host.cjs", "--target", "linux"],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--target linux is only supported on Linux or WSL2");
  });
});
