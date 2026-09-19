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
const net = require("node:net");
const { spawnSync } = require("node:child_process");
const { parseDoctorArgs, runDoctor } = require("../../native/doctor.cjs");
const remoteAuth = require("../../native/remote-auth.cjs");

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

function wslRegistryExec(
  tempDir: string,
  registeredWindowsPath: string,
  manifestFsPath: string,
  wrapperFsPath: string,
) {
  const convertedPaths = new Map([
    ["C:\\Users\\Nico\\AppData\\Local", tempDir],
    [registeredWindowsPath, manifestFsPath],
    ["C:\\Users\\Nico\\AppData\\Local\\surf-cli\\host-wrapper-wsl.cmd", wrapperFsPath],
  ]);
  return (file: string, args: string[]) => {
    if (file === "reg.exe") {
      return `HKEY_CURRENT_USER\\Software\\Google\\Chrome\\NativeMessagingHosts\\surf.browser.host\r\n    (Default)    REG_SZ    ${registeredWindowsPath}\r\n`;
    }
    const converted = file === "wslpath" ? convertedPaths.get(args[1]) : undefined;
    if (converted) {
      return `${converted}\n`;
    }
    throw new Error(`unexpected command: ${file} ${args.join(" ")}`);
  };
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
    expect(report.recommendations.join("\n")).toContain("service worker console");
    expect(report.recommendations.join("\n")).toContain("Details > Extension options");
    expect(report.recommendations.join("\n")).toContain("disable Debug Mode when finished");
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
    expect(report.recommendations.join("\n")).not.toContain("Debug Mode");
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

  it.each([
    { name: "passes", registryPath: "expected", manifestStatus: "pass", ok: true },
    {
      name: "fails a registry path without its manifest",
      registryPath: "mismatch",
      manifestStatus: "fail",
      ok: false,
    },
  ])("$name for a WSL Windows registry manifest", async ({ registryPath, manifestStatus, ok }) => {
    const tempDir = makeTempDir();
    const socketPath = path.join(tempDir, "surf.sock");
    const manifestFsPath = path.join(
      tempDir,
      "Google/Chrome/User Data/NativeMessagingHosts/surf.browser.host.json",
    );
    const wrapperFsPath = path.join(tempDir, "surf-cli/host-wrapper-wsl.cmd");
    const expectedWindowsPath =
      "C:\\Users\\Nico\\AppData\\Local\\Google\\Chrome\\User Data\\NativeMessagingHosts\\surf.browser.host.json";
    const registeredWindowsPath =
      registryPath === "expected" ? expectedWindowsPath : "D:\\Other\\surf.browser.host.json";
    const registeredFsPath =
      registryPath === "expected" ? manifestFsPath : path.join(tempDir, "missing-manifest.json");
    fs.mkdirSync(path.dirname(wrapperFsPath), { recursive: true });
    fs.writeFileSync(wrapperFsPath, "@echo off\r\n");
    writeManifest(
      manifestFsPath,
      "C:\\Users\\Nico\\AppData\\Local\\surf-cli\\host-wrapper-wsl.cmd",
    );

    const report = await runDoctor(
      { browser: "chrome", socket: socketPath },
      {
        platform: "linux",
        homeDir: tempDir,
        env: { WSL_DISTRO_NAME: "Ubuntu" },
        fs: {
          existsSync: (filePath: string) => filePath === socketPath || fs.existsSync(filePath),
          statSync: (filePath: string) =>
            filePath === socketPath ? { isSocket: () => true } : fs.statSync(filePath),
          readFileSync: fs.readFileSync,
        },
        connectSocket: async () => ({ ok: true, message: "connected" }),
        execFileSync: wslRegistryExec(
          tempDir,
          registeredWindowsPath,
          registeredFsPath,
          wrapperFsPath,
        ),
      },
    );

    expect(report.ok).toBe(ok);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "windows-registry",
          status: "pass",
          browser: "chrome",
        }),
        expect.objectContaining({
          id: "manifest-file",
          status: manifestStatus,
          browser: "chrome",
        }),
      ]),
    );
    expect(report.manifests[0].path).toBe(registeredWindowsPath);
  });

  it("fails WSL Windows doctor when the registry entry is missing", async () => {
    const tempDir = makeTempDir();
    const socketPath = path.join(tempDir, "surf.sock");
    const report = await runDoctor(
      { browser: "chrome", socket: socketPath },
      {
        platform: "linux",
        homeDir: tempDir,
        env: { WSL_DISTRO_NAME: "Ubuntu", LOCALAPPDATA: "C:\\Users\\Nico\\AppData\\Local" },
        fs: {
          existsSync: (filePath: string) => filePath === socketPath,
          statSync: () => ({ isSocket: () => true }),
          readFileSync: fs.readFileSync,
        },
        connectSocket: async () => ({ ok: true, message: "connected" }),
        execFileSync: (file: string, args: string[]) => {
          if (file === "wslpath") {
            return `${tempDir}\n`;
          }
          throw new Error(`registry missing: ${file} ${args.join(" ")}`);
        },
      },
    );

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "windows-registry", status: "fail", browser: "chrome" }),
      ]),
    );
    expect(report.checks.find((check: any) => check.id === "windows-registry").message).toContain(
      "registry missing",
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
    expect(report.recommendations.join("\n")).not.toContain("Debug Mode");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "manifest-supported", status: "fail", browser: "arc" }),
      ]),
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

  it("does not treat a TCP acceptor that never authenticates as a doctor success", async () => {
    const stateDir = makeTempDir();
    const credentialPath = path.join(stateDir, "client.json");
    remoteAuth.authorizeClient("doctor-client", credentialPath, stateDir);
    let acceptedSocket: { destroy(): void } | undefined;
    const server = net.createServer((socket: any) => {
      acceptedSocket = socket;
      socket.on("error", () => undefined);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const report = await runDoctor(
      {
        connectTimeoutMs: 25,
        endpoint: {
          kind: "remote",
          host: "127.0.0.1",
          port,
          display: `127.0.0.1:${port}`,
          credentialPath,
          connectionOptions: { host: "127.0.0.1", port },
        },
      },
      { platform: "linux", env: {} },
    );
    acceptedSocket?.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(stateDir, { recursive: true, force: true });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "remote-connect", status: "fail", code: "EAUTH" }),
        expect.objectContaining({ id: "remote-auth", status: "fail" }),
      ]),
    );
  });

  it("runs remote-only diagnostics with Tailnet-specific connection guidance", async () => {
    const report = await runDoctor(
      {
        endpoint: {
          kind: "remote",
          host: "browser.tailnet",
          port: 4321,
          display: "browser.tailnet:4321",
        },
      },
      {
        platform: "linux",
        env: {},
        connectEndpoint: async () => ({ ok: false, code: "ETIMEDOUT", message: "timed out" }),
      },
    );

    expect(report.manifests).toEqual([]);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "remote-connect", code: "ETIMEDOUT" }),
      ]),
    );
    expect(report.recommendations.join("\n")).toContain("tailscale ping browser.tailnet");
    expect(report.recommendations.join("\n")).toContain("ACLs/grants");
  });

  it("keeps TLS validation failures in the remote-connect phase", async () => {
    const endpoint = {
      kind: "remote",
      host: "browser.example",
      port: 443,
      display: "browser.example:443",
      tls: { enabled: true },
    };
    const report = await runDoctor(
      { endpoint },
      {
        platform: "linux",
        env: {},
        connectEndpoint: async () => ({
          ok: false,
          code: "ERR_TLS_CERT_ALTNAME_INVALID",
          message: "hostname mismatch",
        }),
      },
    );

    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "remote-connect", status: "fail" }),
        expect.objectContaining({
          id: "remote-auth",
          status: "info",
          message: "Remote authentication was not reached",
        }),
      ]),
    );
    expect(report.checks.find((check: any) => check.id === "remote-connect").message).toContain(
      "(TLS)",
    );
    expect(report.recommendations.join("\n")).toContain("certificate chain");
    expect(report.recommendations.join("\n")).toContain("replaces system roots");
  });

  it("reports successful TLS only after remote authentication", async () => {
    const report = await runDoctor(
      {
        endpoint: {
          kind: "remote",
          host: "browser.example",
          port: 443,
          display: "browser.example:443",
          tls: { enabled: true },
        },
      },
      {
        platform: "linux",
        env: {},
        connectEndpoint: async () => ({ ok: true, message: "authenticated" }),
      },
    );

    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "remote-connect", status: "pass" }),
        expect.objectContaining({ id: "remote-auth", status: "pass" }),
      ]),
    );
  });
});
