import { describe, expect, it } from "vitest";

declare const process: {
  execPath: string;
  platform: string;
};
declare const require: (moduleName: string) => any;

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createWrapper, writeManifest } = require("../../scripts/install-native-host.cjs");

const extensionA = "abcdefghijklmnopabcdefghijklmnop";
const extensionB = "bcdefghijklmnopabcdefghijklmnopa";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "surf-native-host-test-"));
}

describe("native host installer", () => {
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

  it("forwards wrapper arguments for POSIX and WSL Windows wrappers", () => {
    const tempDir = makeTempDir();
    const nodePath = process.execPath;
    const hostPath = path.join(tempDir, "host.cjs");
    fs.writeFileSync(hostPath, "");

    const nativeWrapperPath = createWrapper(tempDir, nodePath, hostPath, "linux");
    const nativeWrapperContent = fs.readFileSync(nativeWrapperPath, "utf8");
    if (process.platform === "win32") {
      expect(nativeWrapperContent).toContain(`"${hostPath}" %*`);
    } else {
      expect(nativeWrapperContent).toContain(`"${hostPath}" "$@"`);
    }

    const cmdPath = createWrapper(tempDir, nodePath, hostPath, "wsl-windows");
    expect(fs.readFileSync(path.join(tempDir, "host-wrapper-wsl.cmd"), "utf8")).toContain(
      `"${hostPath}" %*`,
    );
    expect(cmdPath).toBeTruthy();
  });

  it.runIf(process.platform !== "linux")(
    "rejects install --target linux on non-Linux platforms",
    () => {
      const result = spawnSync(
        process.execPath,
        ["scripts/install-native-host.cjs", extensionA, "--target", "linux"],
        { encoding: "utf8" },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("--target linux is only supported on Linux or WSL2");
    },
  );

  it.runIf(process.platform !== "linux")(
    "rejects uninstall --target linux on non-Linux platforms",
    () => {
      const result = spawnSync(
        process.execPath,
        ["scripts/uninstall-native-host.cjs", "--target", "linux"],
        { encoding: "utf8" },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("--target linux is only supported on Linux or WSL2");
    },
  );
});
