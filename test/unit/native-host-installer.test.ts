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
  installWithValidatedWrapper,
  installManifest,
  probeWindowsWrapper,
  writeManifest,
  assertListenTargetSupported,
  assertSocketAccessTargetSupported,
} = require("../../scripts/install-native-host.cjs");
const { removeManifest } = require("../../scripts/uninstall-native-host.cjs");
const { runWindowsExecutable } = require("../../scripts/windows-interop.cjs");
const { parseListenEndpoint } = require("../../native/listener.cjs");
const {
  normalizeSocketConfig,
  parseSocketMode,
  validateSocketGroup,
} = require("../../native/socket-permissions.cjs");

const extensionA = "abcdefghijklmnopabcdefghijklmnop";
const extensionB = "bcdefghijklmnopabcdefghijklmnopa";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "surf-native-host-test-"));
}

function envWithoutPersistedSettings() {
  const env = { ...process.env };
  env.SURF_LISTEN = undefined;
  env.SURF_SOCKET_MODE = undefined;
  env.SURF_SOCKET_GROUP = undefined;
  return env;
}

function writeWslManifest(tempDir: string, relativeDir: string) {
  const manifestPath = path.join(tempDir, relativeDir, "surf.browser.host.json");
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, "{}");
  return manifestPath;
}

function wslRegistryFailure(tempDir: string, stderr: string) {
  return {
    execFileSync: (file: string, args: string[]) => {
      if (file === "cmd.exe") {
        return "C:\\Users\\Test\\AppData\\Local\r\n";
      }
      if (file === "wslpath" && args[0] === "-u") {
        return `${tempDir}\n`;
      }
      throw Object.assign(new Error("reg delete failed"), { stderr });
    },
  };
}

describe("native host installer", () => {
  it("uses a bare Windows tool when it is available", () => {
    const calls: any[] = [];
    const output = runWindowsExecutable("cmd.exe", ["/c", "echo", "ok"], {
      allowWslFallback: true,
      execFileSync: (file: string, args: string[]) => {
        calls.push([file, args]);
        return "ok\r\n";
      },
    });

    expect(output).toBe("ok\r\n");
    expect(calls).toEqual([["cmd.exe", ["/c", "echo", "ok"]]]);
  });

  it("resolves a missing bare Windows tool through wslpath", () => {
    const calls: any[] = [];
    const output = runWindowsExecutable("cmd.exe", ["/c", "echo", "ok"], {
      allowWslFallback: true,
      execFileSync: (file: string, args: string[]) => {
        calls.push([file, args]);
        if (file === "cmd.exe") {
          throw Object.assign(new Error("spawn cmd.exe ENOENT"), { code: "ENOENT" });
        }
        if (file === "wslpath") {
          return "/windows/System32/cmd.exe\n";
        }
        return "ok\r\n";
      },
    });

    expect(output).toBe("ok\r\n");
    expect(calls.map(([file]) => file)).toEqual([
      "cmd.exe",
      "wslpath",
      "/windows/System32/cmd.exe",
    ]);
  });

  it("reports both bare and fallback Windows tool lookup failures", () => {
    expect(() =>
      runWindowsExecutable("cmd.exe", ["/c", "echo", "ok"], {
        allowWslFallback: true,
        execFileSync: (file: string) => {
          if (file === "cmd.exe") {
            throw Object.assign(new Error("bare missing"), { code: "ENOENT" });
          }
          throw new Error("wslpath missing");
        },
      }),
    ).toThrow(/cmd\.exe.*bare missing.*wslpath.*wslpath missing/);
  });

  it("does not fall back when the bare Windows tool fails for another reason", () => {
    const calls: string[] = [];
    expect(() =>
      runWindowsExecutable("cmd.exe", ["/c", "exit", "1"], {
        allowWslFallback: true,
        execFileSync: (file: string) => {
          calls.push(file);
          throw Object.assign(new Error("access denied"), { code: "EACCES" });
        },
      }),
    ).toThrow(/cmd\.exe.*access denied/);
    expect(calls).toEqual(["cmd.exe"]);
  });

  it("registers a WSL Windows install and unregisters it on uninstall", () => {
    const tempDir = makeTempDir();
    const calls: any[] = [];
    const manifestFsPath = path.join(
      tempDir,
      "BraveSoftware/Brave-Browser/User Data/NativeMessagingHosts/surf.browser.host.json",
    );
    const windowsManifestPath =
      "C:\\Users\\Nico\\AppData\\Local\\BraveSoftware\\Brave-Browser\\User Data\\NativeMessagingHosts\\surf.browser.host.json";
    const execFileSync = (file: string, args: string[]) => {
      calls.push([file, args]);
      if (file === "cmd.exe") {
        return "C:\\Users\\Nico\\AppData\\Local\r\n";
      }
      if (file === "wslpath" && args[0] === "-u") {
        return `${tempDir}\n`;
      }
      if (file === "wslpath" && args[0] === "-w") {
        return `${windowsManifestPath}\r\n`;
      }
      if (file === "reg.exe") {
        expect(fs.existsSync(manifestFsPath)).toBe(true);
        return "completed";
      }
      throw new Error(`unexpected command: ${file} ${args.join(" ")}`);
    };
    const deps = { execFileSync };

    const manifestPath = installManifest(
      "brave",
      extensionA,
      "C:\\Users\\Nico\\AppData\\Local\\surf-cli\\host-wrapper-wsl.cmd",
      "wsl-windows",
      deps,
    );
    expect(manifestPath).toBe(manifestFsPath);
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(calls).toContainEqual([
      "reg.exe",
      [
        "add",
        "HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\surf.browser.host",
        "/ve",
        "/t",
        "REG_SZ",
        "/d",
        windowsManifestPath,
        "/f",
      ],
    ]);

    expect(removeManifest("brave", "wsl-windows", deps)).toBe(manifestPath);
    expect(fs.existsSync(manifestPath)).toBe(false);
    expect(calls).toContainEqual([
      "reg.exe",
      [
        "delete",
        "HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\surf.browser.host",
        "/f",
      ],
    ]);
  });

  it("removes a pre-fix WSL manifest when its registry key is already absent", () => {
    const tempDir = makeTempDir();
    const manifestPath = writeWslManifest(tempDir, "Google/Chrome/User Data/NativeMessagingHosts");
    const deps = wslRegistryFailure(
      tempDir,
      "ERROR: The system was unable to find the specified registry key or value.\r\n",
    );
    const result = removeManifest("chrome", "wsl-windows", deps);

    expect(result).toBe(manifestPath);
    expect(fs.existsSync(manifestPath)).toBe(false);
  });

  it("keeps the WSL manifest when registry deletion is denied", () => {
    const tempDir = makeTempDir();
    const manifestPath = writeWslManifest(tempDir, "Google/Chrome/User Data/NativeMessagingHosts");
    const deps = wslRegistryFailure(tempDir, "ERROR: Access is denied.\r\n");
    const remove = () => removeManifest("chrome", "wsl-windows", deps);

    expect(remove).toThrow(/reg\.exe.*Access is denied/);
    expect(fs.existsSync(manifestPath)).toBe(true);
  });

  it("fails a WSL Windows install when registry registration fails", () => {
    const tempDir = makeTempDir();
    const execFileSync = (file: string, args: string[]) => {
      if (file === "cmd.exe") {
        return "C:\\Users\\Nico\\AppData\\Local\r\n";
      }
      if (file === "wslpath" && args[0] === "-u") {
        return `${tempDir}\n`;
      }
      if (file === "wslpath" && args[0] === "-w") {
        return "C:\\manifest.json\r\n";
      }
      throw new Error("registry access denied");
    };

    expect(() =>
      installManifest("chrome", extensionA, "C:\\wrapper.cmd", "wsl-windows", {
        execFileSync,
      }),
    ).toThrow(/reg\.exe.*registry access denied/);
  });

  it("documents the Tailnet-only listener option", () => {
    const result = spawnSync(process.execPath, ["scripts/install-native-host.cjs", "--help"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--listen <tailscale-ip>:<port>");
    expect(result.stdout).toContain("Tailnet-only listener endpoint");
    expect(result.stdout).toContain("--socket-mode <600|660>");
    expect(result.stdout).toContain("--socket-group <group-or-gid>");
  });

  it("accepts only the private socket modes and safe group values", () => {
    expect(parseSocketMode(undefined)).toBe(0o600);
    expect(parseSocketMode(600)).toBe(0o600);
    expect(parseSocketMode(660)).toBe(0o660);
    expect(parseSocketMode("600")).toBe(0o600);
    expect(parseSocketMode("0660")).toBe(0o660);
    expect(() => parseSocketMode("664")).toThrow(/600 or 660/);
    expect(() => parseSocketMode("777")).toThrow(/600 or 660/);
    expect(() => parseSocketMode("6000")).toThrow(/600 or 660/);
    expect(validateSocketGroup("surf")).toBe("surf");
    expect(validateSocketGroup("1000")).toBe("1000");
    expect(() => validateSocketGroup("surf;id")).toThrow(/group/i);
    expect(() => validateSocketGroup(null)).toThrow(/group/i);
    expect(() => normalizeSocketConfig("660", undefined)).toThrow(/requires/i);
    expect(() => assertSocketAccessTargetSupported("660", "surf", "win32")).toThrow(/POSIX/i);
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
      "process.stdout.write(JSON.stringify({ listen: process.env.SURF_LISTEN, mode: process.env.SURF_SOCKET_MODE, group: process.env.SURF_SOCKET_GROUP, args: process.argv.slice(2) }));",
    );

    const nativeWrapperPath = createWrapper(tempDir, nodePath, hostPath, "linux");
    const nativeWrapperContent = fs.readFileSync(nativeWrapperPath, "utf8");
    if (process.platform === "win32") {
      expect(nativeWrapperContent).toContain(`"${hostPath}" %*`);
    } else {
      expect(nativeWrapperContent).toContain(`"${hostPath}" "$@"`);
      const persisted = spawnSync(nativeWrapperPath, ["one"], {
        encoding: "utf8",
        env: envWithoutPersistedSettings(),
      });
      expect(JSON.parse(persisted.stdout)).toEqual({
        listen: undefined,
        mode: undefined,
        group: undefined,
        args: ["one"],
      });

      const configuredWrapper = createWrapper(
        tempDir,
        nodePath,
        hostPath,
        "linux",
        "100.64.1.2:4321",
      );
      const defaulted = spawnSync(configuredWrapper, ["two"], {
        encoding: "utf8",
        env: envWithoutPersistedSettings(),
      });
      expect(JSON.parse(defaulted.stdout)).toEqual({
        listen: "100.64.1.2:4321",
        mode: undefined,
        group: undefined,
        args: ["two"],
      });
      const overridden = spawnSync(configuredWrapper, ["three"], {
        encoding: "utf8",
        env: { ...envWithoutPersistedSettings(), SURF_LISTEN: "100.64.1.3:4321" },
      });
      expect(JSON.parse(overridden.stdout)).toEqual({
        listen: "100.64.1.3:4321",
        mode: undefined,
        group: undefined,
        args: ["three"],
      });

      const socketConfiguredWrapper = createWrapper(
        tempDir,
        nodePath,
        hostPath,
        "linux",
        undefined,
        "660",
        "surf",
      );
      const socketDefaulted = spawnSync(socketConfiguredWrapper, ["four"], {
        encoding: "utf8",
        env: envWithoutPersistedSettings(),
      });
      expect(JSON.parse(socketDefaulted.stdout)).toEqual({
        listen: undefined,
        mode: "660",
        group: "surf",
        args: ["four"],
      });
      const socketOverridden = spawnSync(socketConfiguredWrapper, ["five"], {
        encoding: "utf8",
        env: {
          ...envWithoutPersistedSettings(),
          SURF_SOCKET_MODE: "600",
          SURF_SOCKET_GROUP: "other",
        },
      });
      expect(JSON.parse(socketOverridden.stdout)).toEqual({
        listen: undefined,
        mode: "600",
        group: "other",
        args: ["five"],
      });

      const reinstalled = createWrapper(tempDir, nodePath, hostPath, "linux");
      expect(fs.readFileSync(reinstalled, "utf8")).not.toContain("SURF_LISTEN");
      expect(fs.readFileSync(reinstalled, "utf8")).not.toContain("SURF_SOCKET_MODE");
      expect(fs.readFileSync(reinstalled, "utf8")).not.toContain("SURF_SOCKET_GROUP");
      const inherited = spawnSync(reinstalled, ["six"], {
        encoding: "utf8",
        env: {
          ...envWithoutPersistedSettings(),
          SURF_LISTEN: "100.64.1.4:4321",
          SURF_SOCKET_MODE: "660",
          SURF_SOCKET_GROUP: "inherited",
        },
      });
      expect(JSON.parse(inherited.stdout)).toEqual({
        listen: "100.64.1.4:4321",
        mode: "660",
        group: "inherited",
        args: ["six"],
      });
    }

    const previousDistro = process.env.WSL_DISTRO_NAME;
    process.env.WSL_DISTRO_NAME = "Ubuntu-24.04";
    try {
      const cmdPath = createWrapper(tempDir, nodePath, hostPath, "wsl-windows");
      expect(fs.readFileSync(path.join(tempDir, "host-wrapper-wsl.cmd"), "utf8")).toBe(
        `@echo off\r\nrem SURF_NATIVE_HOST_LAUNCH_PROBE_V1\r\nwsl.exe -d "Ubuntu-24.04" --cd "${path.dirname(hostPath)}" --exec "${nodePath}" "${hostPath}" %*\r\n`,
      );
      expect(cmdPath).toBeTruthy();
    } finally {
      if (previousDistro === undefined) {
        delete process.env.WSL_DISTRO_NAME;
      } else {
        process.env.WSL_DISTRO_NAME = previousDistro;
      }
    }
  });

  it("probes a generated WSL Windows wrapper through bounded cmd interop", () => {
    const calls: any[] = [];
    probeWindowsWrapper("C:\\Users\\Test User\\surf-cli\\host-wrapper-wsl.cmd", {
      execFileSync: (file: string, args: string[], options: any) => {
        calls.push([file, args, options]);
        return "SURF_NATIVE_HOST_LAUNCH_PROBE_OK\r\n";
      },
    });

    expect(calls).toEqual([
      [
        "cmd.exe",
        [
          "/d",
          "/s",
          "/c",
          '""C:\\Users\\Test User\\surf-cli\\host-wrapper-wsl.cmd" --surf-native-host-launch-probe"',
        ],
        expect.objectContaining({ encoding: "utf8", timeout: 5000 }),
      ],
    ]);
  });

  it("preserves an installed wrapper when its Windows path cannot be resolved", () => {
    const wrapperDir = makeTempDir();
    const wrapperFsPath = path.join(wrapperDir, "host-wrapper-wsl.cmd");
    fs.writeFileSync(wrapperFsPath, "existing working wrapper");
    expect(() =>
      createWrapper(
        wrapperDir,
        "/usr/bin/node",
        "/home/surf/native/host.cjs",
        "wsl-windows",
        undefined,
        undefined,
        undefined,
        "Ubuntu",
        () => {
          throw new Error("wslpath conversion failed");
        },
      ),
    ).toThrow("wslpath conversion failed");
    expect(fs.readFileSync(wrapperFsPath, "utf8")).toBe("existing working wrapper");
  });

  it("reports failed, timed out, and malformed WSL wrapper probes", () => {
    expect(() =>
      probeWindowsWrapper("C:\\surf\\host-wrapper-wsl.cmd", {
        execFileSync: () => {
          throw Object.assign(new Error("wrapper exited with status 1"), {
            stderr: "wsl.exe could not start the distro",
          });
        },
      }),
    ).toThrow(/launch probe failed.*wsl\.exe could not start the distro/);

    expect(() =>
      probeWindowsWrapper("C:\\surf\\host-wrapper-wsl.cmd", {
        execFileSync: () => "not the probe marker\n",
      }),
    ).toThrow(/launch probe failed.*unexpected output/);

    expect(() =>
      probeWindowsWrapper("C:\\surf\\host-wrapper-wsl.cmd", {
        timeoutMs: 25,
        execFileSync: (_file: string, _args: string[], options: any) => {
          expect(options.timeout).toBe(25);
          throw Object.assign(new Error("spawnSync cmd.exe ETIMEDOUT"), { code: "ETIMEDOUT" });
        },
      }),
    ).toThrow(/launch probe failed.*ETIMEDOUT/);
  });

  it("does not register a WSL wrapper when its launch probe fails", () => {
    const tempDir = makeTempDir();
    const wrapperFsPath = path.join(tempDir, "host-wrapper-wsl.cmd");
    fs.writeFileSync(wrapperFsPath, "original wrapper");
    let registered = false;
    expect(() =>
      installWithValidatedWrapper(
        "C:\\surf\\host-wrapper-wsl.cmd",
        "wsl-windows",
        () => {
          registered = true;
        },
        {
          wrapperFsPath,
          nodePath: "/usr/bin/node",
          hostPath: "/home/surf/native/host.cjs",
          distro: "Ubuntu",
          execFileSync: () => "wrong output\n",
        },
      ),
    ).toThrow(/before registration/);
    expect(registered).toBe(false);
    expect(fs.readFileSync(wrapperFsPath, "utf8")).toBe("original wrapper");
  });

  it("uses the Windows default distro only after the launch probe confirms its identity", () => {
    const tempDir = makeTempDir();
    const wrapperFsPath = path.join(tempDir, "host-wrapper-wsl.cmd");
    const nodePath = "/usr/bin/node";
    const hostPath = "/home/surf/native/host.cjs";
    const explicit = `@echo off\r\nrem SURF_NATIVE_HOST_LAUNCH_PROBE_V1\r\nwsl.exe -d "Ubuntu" --cd "/home/surf/native" --exec "${nodePath}" "${hostPath}" %*\r\n`;
    const fallback = `@echo off\r\nrem SURF_NATIVE_HOST_LAUNCH_PROBE_V1\r\nwsl.exe --cd "/home/surf/native" --exec "${nodePath}" "${hostPath}" %*\r\n`;
    fs.writeFileSync(wrapperFsPath, explicit);
    let attempts = 0;
    const result = installWithValidatedWrapper(
      "C:\\surf\\host-wrapper-wsl.cmd",
      "wsl-windows",
      () => "registered",
      {
        wrapperFsPath,
        nodePath,
        hostPath,
        distro: "Ubuntu",
        execFileSync: (_file: string, args: string[]) => {
          attempts++;
          if (attempts === 1) {
            expect(fs.readFileSync(wrapperFsPath, "utf8")).toBe(explicit);
            throw new Error("WSL_E_DISTRO_NOT_FOUND");
          }
          expect(fs.readFileSync(wrapperFsPath, "utf8")).toBe(fallback);
          expect(args[3]).toContain("--surf-native-host-launch-probe-distro");
          return 'SURF_NATIVE_HOST_LAUNCH_PROBE_OK:"Ubuntu"\n';
        },
      },
    );
    expect(result).toBe("registered");
    expect(attempts).toBe(2);
    expect(fs.readFileSync(wrapperFsPath, "utf8")).toBe(fallback);
  });

  it("keeps explicit distro selection when its wrapper launches successfully", () => {
    const tempDir = makeTempDir();
    const wrapperFsPath = path.join(tempDir, "host-wrapper-wsl.cmd");
    fs.writeFileSync(wrapperFsPath, "explicit wrapper");
    const installed = installWithValidatedWrapper(
      "C:\\surf\\host-wrapper-wsl.cmd",
      "wsl-windows",
      () => "registered",
      {
        wrapperFsPath,
        distro: "Ubuntu",
        execFileSync: () => "SURF_NATIVE_HOST_LAUNCH_PROBE_OK\n",
      },
    );
    expect(installed).toBe("registered");
    expect(fs.readFileSync(wrapperFsPath, "utf8")).toBe("explicit wrapper");
  });

  it.each([null, "Other", "broken"])("rejects an unverified default distro %s", (identity) => {
    const tempDir = makeTempDir();
    const wrapperFsPath = path.join(tempDir, "host-wrapper-wsl.cmd");
    fs.writeFileSync(wrapperFsPath, "explicit wrapper");
    let registered = false;
    let attempts = 0;
    expect(() =>
      installWithValidatedWrapper(
        "C:\\surf\\host-wrapper-wsl.cmd",
        "wsl-windows",
        () => {
          registered = true;
        },
        {
          wrapperFsPath,
          nodePath: "/usr/bin/node",
          hostPath: "/home/surf/native/host.cjs",
          distro: "Ubuntu",
          execFileSync: () => {
            attempts++;
            if (attempts === 1) {
              throw new Error("WSL_E_DISTRO_NOT_FOUND");
            }
            return identity === "broken"
              ? "unexpected output"
              : `SURF_NATIVE_HOST_LAUNCH_PROBE_OK:${JSON.stringify(identity)}\n`;
          },
        },
      ),
    ).toThrow(/before registration/);
    expect(registered).toBe(false);
    expect(fs.readFileSync(wrapperFsPath, "utf8")).toBe("explicit wrapper");
  });

  it("does not probe ordinary native-host wrappers", () => {
    const result = installWithValidatedWrapper("/tmp/host-wrapper.sh", "linux", () => "installed", {
      execFileSync: () => {
        throw new Error("probe should not run");
      },
    });

    expect(result).toBe("installed");
  });

  it("launch probe exits without creating a Surf socket", () => {
    const tempDir = makeTempDir();
    const socketPath = path.join(tempDir, "surf.sock");
    const result = spawnSync(
      process.execPath,
      ["native/host.cjs", "--surf-native-host-launch-probe"],
      {
        encoding: "utf8",
        env: { ...process.env, SURF_SOCKET: socketPath },
        timeout: 5000,
      },
    );

    expect(result.status).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stdout).toBe("SURF_NATIVE_HOST_LAUNCH_PROBE_OK\n");
    expect(result.stderr).toBe("");
    expect(fs.existsSync(socketPath)).toBe(false);
  });

  it("launch probe reports only the WSL distro identity without opening a socket", () => {
    const socketPath = path.join(makeTempDir(), "surf.sock");
    const result = spawnSync(
      process.execPath,
      ["native/host.cjs", "--surf-native-host-launch-probe-distro"],
      {
        encoding: "utf8",
        env: { ...process.env, SURF_SOCKET: socketPath, WSL_DISTRO_NAME: "Ubuntu" },
        timeout: 5000,
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('SURF_NATIVE_HOST_LAUNCH_PROBE_OK:"Ubuntu"\n');
    expect(result.stderr).toBe("");
    expect(fs.existsSync(socketPath)).toBe(false);
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

  it("does not mutate the Windows registry for explicit Linux install or uninstall in WSL", ({
    skip,
  }) => {
    if (process.platform !== "linux") {
      skip();
    }
    const tempDir = makeTempDir();
    const binDir = path.join(tempDir, "bin");
    const marker = path.join(tempDir, "registry-called");
    fs.mkdirSync(binDir);
    const regPath = path.join(binDir, "reg.exe");
    fs.writeFileSync(regPath, `#!/bin/sh\ntouch "${marker}"\n`);
    fs.chmodSync(regPath, 0o755);
    const env = {
      ...process.env,
      HOME: tempDir,
      PATH: `${binDir}:${process.env.PATH}`,
      WSL_DISTRO_NAME: "SurfTest",
      SURF_NODE_PATH: process.execPath,
      SURF_HOST_PATH: path.resolve("native/host.cjs"),
    };

    for (const args of [
      ["scripts/install-native-host.cjs", extensionA, "--target", "linux"],
      ["scripts/uninstall-native-host.cjs", "--target", "linux"],
    ]) {
      const result = spawnSync(process.execPath, args, { encoding: "utf8", env });
      expect(result.status).toBe(0);
      expect(fs.existsSync(marker)).toBe(false);
    }
  });

  it("continues WSL --all cleanup when one browser registry key is already absent", ({ skip }) => {
    if (process.platform !== "linux") {
      skip();
    }
    const tempDir = makeTempDir();
    const binDir = path.join(tempDir, "bin");
    const wrapperDir = path.join(tempDir, "surf-cli");
    const chromeManifest = writeWslManifest(
      tempDir,
      "Google/Chrome/User Data/NativeMessagingHosts",
    );
    const braveManifest = writeWslManifest(
      tempDir,
      "BraveSoftware/Brave-Browser/User Data/NativeMessagingHosts",
    );
    fs.mkdirSync(binDir);
    fs.mkdirSync(wrapperDir);
    fs.writeFileSync(path.join(wrapperDir, "host-wrapper-wsl.cmd"), "@echo off\r\n");
    fs.writeFileSync(
      path.join(binDir, "cmd.exe"),
      "#!/bin/sh\nprintf '%s\\r\\n' 'C:\\Users\\Test\\AppData\\Local'\n",
    );
    fs.writeFileSync(path.join(binDir, "wslpath"), `#!/bin/sh\nprintf '%s\\n' '${tempDir}'\n`);
    fs.writeFileSync(
      path.join(binDir, "reg.exe"),
      "#!/bin/sh\ncase \"$*\" in *'Google\\Chrome'*) echo 'ERROR: The system was unable to find the specified registry key or value.' >&2; exit 1;; esac\n",
    );
    for (const file of ["cmd.exe", "wslpath", "reg.exe"]) {
      fs.chmodSync(path.join(binDir, file), 0o755);
    }

    const result = spawnSync(
      process.execPath,
      ["scripts/uninstall-native-host.cjs", "--all", "--target", "windows"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`,
          WSL_DISTRO_NAME: "SurfTest",
        },
      },
    );

    expect(result.status).toBe(0);
    expect(fs.existsSync(chromeManifest)).toBe(false);
    expect(fs.existsSync(braveManifest)).toBe(false);
    expect(fs.existsSync(wrapperDir)).toBe(false);
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
