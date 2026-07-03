import { describe, expect, it } from "vitest";

declare const process: {
  cwd(): string;
  env: Record<string, string | undefined>;
  execPath: string;
  platform: string;
};
declare const require: (moduleName: string) => any;

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parseDoctorArgs, runDoctor, windowsPathToWslPath } = require("../../native/doctor.cjs");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "surf-doctor-test-"));
}

function writeChromeManifest(homeDir: string, manifest: any) {
  const manifestPath = path.join(
    homeDir,
    "Library/Application Support/Google/Chrome/NativeMessagingHosts/surf.browser.host.json",
  );
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

function writeManifest(manifestPath: string, wrapperPath: string) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        name: "surf.browser.host",
        type: "stdio",
        path: wrapperPath,
        allowed_origins: ["chrome-extension://abcdefghijklmnopabcdefghijklmnop/"],
      },
      null,
      2,
    ),
  );
}

describe("surf doctor", () => {
  it("parses scoped doctor options", () => {
    expect(
      parseDoctorArgs([
        "--browser",
        "chrome,brave",
        "--target",
        "linux",
        "--socket",
        "/tmp/custom.sock",
        "--connect-timeout",
        "123",
        "--json",
      ]),
    ).toMatchObject({
      browser: "chrome,brave",
      target: "linux",
      socket: "/tmp/custom.sock",
      connectTimeoutMs: 123,
      json: true,
    });
  });

  it("rejects an empty comma-only browser list", async () => {
    await expect(
      runDoctor(
        { browser: ",", socket: "/tmp/missing-surf.sock" },
        {
          platform: "darwin",
          homeDir: makeTempDir(),
          env: {},
          connectSocket: async () => ({ ok: false, code: "ENOENT", message: "missing" }),
        },
      ),
    ).rejects.toThrow("--browser requires a browser name or all");
  });

  it("reports missing socket and manifest with actionable recommendations", async () => {
    const homeDir = makeTempDir();
    const report = await runDoctor(
      { browser: "chrome", socket: "/tmp/missing-surf.sock" },
      {
        platform: "darwin",
        homeDir,
        env: {},
        connectSocket: async () => ({ ok: false, code: "ENOENT", message: "missing" }),
      },
    );

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "socket-file", status: "fail" }),
        expect.objectContaining({ id: "socket-connect", status: "fail" }),
        expect.objectContaining({ id: "manifest-file", status: "fail", browser: "chrome" }),
      ]),
    );
    expect(report.recommendations.join("\n")).toContain("surf install <extension-id>");
    expect(report.recommendations.join("\n")).toContain("restart the browser");
  });

  it("passes when the socket connects and Chrome manifest points to an executable wrapper", async () => {
    const homeDir = makeTempDir();
    const wrapperPath = path.join(homeDir, "wrapper.sh");
    fs.writeFileSync(wrapperPath, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(wrapperPath, 0o755);
    writeChromeManifest(homeDir, {
      name: "surf.browser.host",
      type: "stdio",
      path: wrapperPath,
      allowed_origins: ["chrome-extension://abcdefghijklmnopabcdefghijklmnop/"],
    });

    const socketPath = path.join(homeDir, "surf.sock");
    const report = await runDoctor(
      { browser: "chrome", socket: socketPath },
      {
        platform: "darwin",
        homeDir,
        env: {},
        fs: {
          existsSync: (filePath: string) => filePath === socketPath || fs.existsSync(filePath),
          statSync: (filePath: string) =>
            filePath === socketPath ? { isSocket: () => true } : fs.statSync(filePath),
          readFileSync: fs.readFileSync,
        },
        connectSocket: async () => ({ ok: true, message: "connected" }),
      },
    );

    expect(report.ok).toBe(true);
    expect(report.summary.fail).toBe(0);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "manifest-file", status: "pass", browser: "chrome" }),
        expect.objectContaining({ id: "manifest-origins", status: "pass", browser: "chrome" }),
        expect.objectContaining({ id: "manifest-path", status: "pass", browser: "chrome" }),
        expect.objectContaining({ id: "socket-connect", status: "pass" }),
      ]),
    );
  });

  it("fails when a POSIX manifest wrapper is not executable", async () => {
    const homeDir = makeTempDir();
    const socketPath = path.join(homeDir, "surf.sock");
    const wrapperPath = path.join(homeDir, "wrapper.sh");
    fs.writeFileSync(wrapperPath, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(wrapperPath, 0o644);
    writeChromeManifest(homeDir, {
      name: "surf.browser.host",
      type: "stdio",
      path: wrapperPath,
      allowed_origins: ["chrome-extension://abcdefghijklmnopabcdefghijklmnop/"],
    });

    const report = await runDoctor(
      { browser: "chrome", socket: socketPath },
      {
        platform: "darwin",
        homeDir,
        env: {},
        fs: {
          existsSync: (filePath: string) => filePath === socketPath || fs.existsSync(filePath),
          statSync: (filePath: string) =>
            filePath === socketPath ? { isSocket: () => true } : fs.statSync(filePath),
          readFileSync: fs.readFileSync,
        },
        connectSocket: async () => ({ ok: true, message: "connected" }),
      },
    );

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "manifest-path-executable",
          status: "fail",
          browser: "chrome",
        }),
      ]),
    );
  });

  it("reports malformed manifest shapes instead of throwing", async () => {
    const homeDir = makeTempDir();
    const socketPath = path.join(homeDir, "surf.sock");
    const manifestPath = path.join(
      homeDir,
      "Library/Application Support/Google/Chrome/NativeMessagingHosts/surf.browser.host.json",
    );
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, "null");

    const report = await runDoctor(
      { browser: "chrome", socket: socketPath },
      {
        platform: "darwin",
        homeDir,
        env: {},
        fs: {
          existsSync: (filePath: string) => filePath === socketPath || fs.existsSync(filePath),
          statSync: (filePath: string) =>
            filePath === socketPath ? { isSocket: () => true } : fs.statSync(filePath),
          readFileSync: fs.readFileSync,
        },
        connectSocket: async () => ({ ok: true, message: "connected" }),
      },
    );

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "manifest-json", status: "pass", browser: "chrome" }),
        expect.objectContaining({ id: "manifest-shape", status: "fail", browser: "chrome" }),
      ]),
    );
  });

  it("checks the Windows per-browser native messaging registry entry", async () => {
    const tempDir = makeTempDir();
    const wrapperPath = path.join(tempDir, "host-wrapper.bat");
    const manifestPath = path.join(tempDir, "surf-cli", "surf.browser.host.json");
    fs.writeFileSync(wrapperPath, "@echo off\r\n");
    writeManifest(manifestPath, wrapperPath);

    const report = await runDoctor(
      { browser: "chrome", socket: "//./pipe/surf" },
      {
        platform: "win32",
        homeDir: tempDir,
        env: { LOCALAPPDATA: tempDir },
        connectSocket: async () => ({ ok: true, message: "connected" }),
        execFileSync: () =>
          `HKEY_CURRENT_USER\\Software\\Google\\Chrome\\NativeMessagingHosts\\surf.browser.host\r\n    (Default)    REG_SZ    ${manifestPath}\r\n`,
      },
    );

    expect(report.ok).toBe(true);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "windows-registry", status: "pass", browser: "chrome" }),
        expect.objectContaining({ id: "manifest-file", status: "pass", browser: "chrome" }),
      ]),
    );
  });

  it("fails Windows doctor when the per-browser registry entry is missing", async () => {
    const tempDir = makeTempDir();
    const wrapperPath = path.join(tempDir, "host-wrapper.bat");
    const manifestPath = path.join(tempDir, "surf-cli", "surf.browser.host.json");
    fs.writeFileSync(wrapperPath, "@echo off\r\n");
    writeManifest(manifestPath, wrapperPath);

    const report = await runDoctor(
      { browser: "chrome", socket: "//./pipe/surf" },
      {
        platform: "win32",
        homeDir: tempDir,
        env: { LOCALAPPDATA: tempDir },
        connectSocket: async () => ({ ok: true, message: "connected" }),
        execFileSync: () => {
          throw new Error("missing registry");
        },
      },
    );

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "windows-registry", status: "fail", browser: "chrome" }),
      ]),
    );
    expect(report.recommendations.join("\n")).toContain(
      "Windows registers the native messaging host",
    );
  });

  it("does not report unsupported Windows browsers as healthy", async () => {
    const report = await runDoctor(
      { browser: "arc", socket: "//./pipe/surf" },
      {
        platform: "win32",
        homeDir: makeTempDir(),
        env: {},
        connectSocket: async () => ({ ok: true, message: "connected" }),
      },
    );

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "manifest-supported", status: "fail", browser: "arc" }),
      ]),
    );
  });

  it("converts Windows paths for WSL manifest checks", () => {
    expect(windowsPathToWslPath("C:\\Users\\Nico\\AppData\\Local")).toBe(
      "/mnt/c/Users/Nico/AppData/Local",
    );
  });

  it("routes `surf doctor --help` without requiring a socket", () => {
    const result = spawnSync(process.execPath, ["native/cli.cjs", "doctor", "--help"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, SURF_SOCKET: "/tmp/nonexistent-surf-test.sock" },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: surf doctor");
    expect(result.stderr).toBe("");
  });
});
