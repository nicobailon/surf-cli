const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const HOST_NAME = "surf.browser.host";

const BROWSERS = {
  chrome: {
    name: "Google Chrome",
    darwin: "Library/Application Support/Google/Chrome/NativeMessagingHosts",
    linux: ".config/google-chrome/NativeMessagingHosts",
    win32: "Google\\Chrome",
    wsl: "Google/Chrome/User Data/NativeMessagingHosts",
  },
  chromium: {
    name: "Chromium",
    darwin: "Library/Application Support/Chromium/NativeMessagingHosts",
    linux: ".config/chromium/NativeMessagingHosts",
    win32: "Chromium",
    wsl: "Chromium/User Data/NativeMessagingHosts",
  },
  brave: {
    name: "Brave",
    darwin: "Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts",
    linux: ".config/BraveSoftware/Brave-Browser/NativeMessagingHosts",
    win32: "BraveSoftware\\Brave-Browser",
    wsl: "BraveSoftware/Brave-Browser/User Data/NativeMessagingHosts",
  },
  edge: {
    name: "Microsoft Edge",
    darwin: "Library/Application Support/Microsoft Edge/NativeMessagingHosts",
    linux: ".config/microsoft-edge/NativeMessagingHosts",
    win32: "Microsoft\\Edge",
    wsl: "Microsoft/Edge/User Data/NativeMessagingHosts",
  },
  arc: {
    name: "Arc",
    darwin: "Library/Application Support/Arc/User Data/NativeMessagingHosts",
    linux: null,
    win32: null,
    wsl: null,
  },
  helium: {
    name: "Helium",
    darwin: "Library/Application Support/net.imput.helium/NativeMessagingHosts",
    linux: null,
    win32: null,
    wsl: null,
  },
};

function isWsl({ platform = process.platform, env = process.env, readFileSync = fs.readFileSync } = {}) {
  if (platform !== "linux") return false;
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;
  try {
    return /microsoft|wsl/i.test(readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

function defaultSocketPath(platform = process.platform) {
  return platform === "win32" ? "//./pipe/surf" : "/tmp/surf.sock";
}

function parseDoctorArgs(rawArgs) {
  const options = {
    browser: "chrome",
    target: "auto",
    json: false,
    socket: undefined,
    connectTimeoutMs: 750,
  };

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--browser" || arg === "-b") {
      options.browser = rawArgs[++i] || "";
    } else if (arg === "--target") {
      options.target = rawArgs[++i] || "";
    } else if (arg === "--socket") {
      options.socket = rawArgs[++i] || "";
    } else if (arg === "--connect-timeout") {
      const value = Number(rawArgs[++i]);
      if (!Number.isFinite(value) || value < 0) throw new Error("--connect-timeout must be a non-negative number");
      options.connectTimeoutMs = value;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown doctor option: ${arg}`);
    }
  }

  if (!options.browser) throw new Error("--browser requires a value");
  if (!options.target) throw new Error("--target requires a value");
  if (!["auto", "linux", "windows"].includes(options.target)) {
    throw new Error("--target must be auto, linux, or windows");
  }
  if (options.socket === "") throw new Error("--socket requires a value");

  return options;
}

function resolveBrowsers(browserArg) {
  if (browserArg === "all") return Object.keys(BROWSERS);
  const browsers = browserArg.split(",").map((browser) => browser.trim().toLowerCase()).filter(Boolean);
  if (browsers.length === 0) throw new Error("--browser requires a browser name or all");
  const unknown = browsers.filter((browser) => !BROWSERS[browser]);
  if (unknown.length > 0) throw new Error(`Unknown browser: ${unknown.join(", ")}`);
  return browsers;
}

function getWindowsEnv(name, { env = process.env, execFileSync: execFile = execFileSync } = {}) {
  if (env[name]) return env[name];
  try {
    return execFile("cmd.exe", ["/c", "echo", `%${name}%`], { encoding: "utf8" })
      .trim()
      .replace(/\r/g, "");
  } catch {
    return null;
  }
}

function windowsPathToWslPath(winPath) {
  const normalized = winPath.replace(/\\/g, "/");
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!match) return normalized;
  return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
}

function manifestPathForBrowser(browserKey, context) {
  const browser = BROWSERS[browserKey];
  if (!browser) return null;

  if (context.effectiveTarget === "wsl-windows") {
    const localAppData = getWindowsEnv("LOCALAPPDATA", context);
    if (!localAppData || !browser.wsl) return null;
    return path.join(windowsPathToWslPath(localAppData), browser.wsl, `${HOST_NAME}.json`);
  }

  if (context.platform === "win32") {
    if (!browser.win32) return null;
    const localAppData = context.env.LOCALAPPDATA || path.join(context.homeDir, "AppData/Local");
    return path.join(localAppData, "surf-cli", `${HOST_NAME}.json`);
  }

  const manifestDir = browser[context.platform];
  if (!manifestDir) return null;
  return path.join(context.homeDir, manifestDir, `${HOST_NAME}.json`);
}

function fsPathFromManifestPath(manifestPath, context) {
  if (context.platform === "linux" && /^[A-Za-z]:[\\/]/.test(manifestPath)) {
    return windowsPathToWslPath(manifestPath);
  }
  return manifestPath;
}

function windowsRegistryPathForBrowser(browserKey) {
  const browser = BROWSERS[browserKey];
  if (!browser?.win32) return null;
  return `HKCU\\Software\\${browser.win32}\\NativeMessagingHosts\\${HOST_NAME}`;
}

function readWindowsRegistryManifestPath(registryPath, context) {
  try {
    const output = context.execFileSync("reg", ["query", registryPath, "/ve"], { encoding: "utf8" });
    const line = output.split(/\r?\n/).find((item) => item.includes("REG_SZ"));
    if (!line) return null;
    return line.replace(/^.*REG_SZ\s+/, "").trim() || null;
  } catch {
    return null;
  }
}

function checkWindowsRegistry(browserKey, context) {
  const registryPath = windowsRegistryPathForBrowser(browserKey);
  if (!registryPath) {
    return {
      check: {
        id: "windows-registry-supported",
        status: "fail",
        browser: browserKey,
        message: `${BROWSERS[browserKey].name} native messaging registry is not supported on Windows`,
      },
      manifestPath: null,
    };
  }

  const manifestPath = readWindowsRegistryManifestPath(registryPath, context);
  return {
    check: {
      id: "windows-registry",
      status: manifestPath ? "pass" : "fail",
      browser: browserKey,
      message: manifestPath
        ? `Windows native messaging registry points to ${manifestPath}`
        : `Windows native messaging registry entry not found: ${registryPath}`,
      registryPath,
      path: manifestPath,
    },
    manifestPath,
  };
}

function checkManifest(manifestPath, context) {
  const checks = [];
  const exists = manifestPath ? context.fs.existsSync(manifestPath) : false;
  checks.push({
    id: "manifest-file",
    status: exists ? "pass" : "fail",
    message: exists ? `Manifest found: ${manifestPath}` : "Native messaging manifest not found",
    path: manifestPath,
  });

  if (!exists) return { checks, manifest: null };

  let manifest;
  try {
    manifest = JSON.parse(context.fs.readFileSync(manifestPath, "utf8"));
    checks.push({ id: "manifest-json", status: "pass", message: "Manifest JSON is valid" });
  } catch (error) {
    checks.push({ id: "manifest-json", status: "fail", message: `Manifest JSON is invalid: ${error.message}` });
    return { checks, manifest: null };
  }

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    checks.push({
      id: "manifest-shape",
      status: "fail",
      message: "Manifest JSON must be an object",
    });
    return { checks, manifest: null };
  }

  checks.push({
    id: "manifest-name",
    status: manifest.name === HOST_NAME ? "pass" : "fail",
    message: manifest.name === HOST_NAME ? `Manifest name is ${HOST_NAME}` : `Manifest name is ${JSON.stringify(manifest.name)}; expected ${HOST_NAME}`,
  });
  checks.push({
    id: "manifest-type",
    status: manifest.type === "stdio" ? "pass" : "fail",
    message: manifest.type === "stdio" ? "Manifest type is stdio" : `Manifest type is ${JSON.stringify(manifest.type)}; expected stdio`,
  });

  const origins = Array.isArray(manifest.allowed_origins) ? manifest.allowed_origins : [];
  const chromeOrigins = origins.filter((origin) => /^chrome-extension:\/\/[a-p]{32}\/$/.test(origin));
  checks.push({
    id: "manifest-origins",
    status: chromeOrigins.length > 0 ? "pass" : "fail",
    message: chromeOrigins.length > 0
      ? `Manifest has ${chromeOrigins.length} Chrome extension origin${chromeOrigins.length === 1 ? "" : "s"}`
      : "Manifest has no valid chrome-extension://<extension-id>/ allowed_origins entry",
    origins,
  });

  if (typeof manifest.path === "string" && manifest.path.length > 0) {
    const manifestFsPath = fsPathFromManifestPath(manifest.path, context);
    const wrapperExists = context.fs.existsSync(manifestFsPath);
    checks.push({
      id: "manifest-path",
      status: wrapperExists ? "pass" : "fail",
      message: wrapperExists ? `Manifest path exists: ${manifest.path}` : `Manifest path does not exist: ${manifest.path}`,
      path: manifest.path,
      fsPath: manifestFsPath,
    });

    if (wrapperExists && context.platform !== "win32" && !manifest.path.endsWith(".cmd") && !manifest.path.endsWith(".bat")) {
      try {
        const mode = context.fs.statSync(manifestFsPath).mode;
        checks.push({
          id: "manifest-path-executable",
          status: mode & 0o111 ? "pass" : "fail",
          message: mode & 0o111 ? "Manifest wrapper is executable" : "Manifest wrapper exists but is not executable",
        });
      } catch {}
    }
  } else {
    checks.push({ id: "manifest-path", status: "fail", message: "Manifest path is missing" });
  }

  return { checks, manifest };
}

async function checkSocket(socketPath, context) {
  const checks = [];
  if (context.platform !== "win32") {
    const exists = context.fs.existsSync(socketPath);
    checks.push({
      id: "socket-file",
      status: exists ? "pass" : "fail",
      message: exists ? `Socket path exists: ${socketPath}` : `Socket path does not exist: ${socketPath}`,
      path: socketPath,
    });

    if (exists) {
      try {
        const stat = context.fs.statSync(socketPath);
        checks.push({
          id: "socket-type",
          status: stat.isSocket() ? "pass" : "warn",
          message: stat.isSocket() ? "Socket path is a Unix socket" : "Socket path exists but is not a Unix socket",
        });
      } catch (error) {
        checks.push({ id: "socket-type", status: "warn", message: `Could not stat socket path: ${error.message}` });
      }
    }
  }

  const connection = await context.connectSocket(socketPath, context.connectTimeoutMs);
  checks.push({
    id: "socket-connect",
    status: connection.ok ? "pass" : "fail",
    message: connection.ok ? "Connected to native host socket" : `Could not connect to socket: ${connection.message}`,
    code: connection.code,
  });
  return checks;
}

function connectSocket(socketPath, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.createConnection(socketPath);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      resolve(result);
    };
    const timeout = setTimeout(() => {
      finish({ ok: false, code: "ETIMEDOUT", message: `timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    socket.once("connect", () => finish({ ok: true, message: "connected" }));
    socket.once("error", (error) => finish({
      ok: false,
      code: error.code,
      message: error && error.message ? error.message : String(error),
    }));
  });
}

function resolveEffectiveTarget(options, context) {
  if (options.target === "linux" && context.platform !== "linux") {
    throw new Error("--target linux is only supported on Linux or WSL2");
  }
  if (options.target === "windows" && !context.runningInWsl && context.platform !== "win32") {
    throw new Error("--target windows is only supported on Windows or WSL2");
  }
  return context.runningInWsl && options.target !== "linux" ? "wsl-windows" : context.platform;
}

function statusRank(status) {
  return { fail: 3, warn: 2, pass: 1, info: 0 }[status] || 0;
}

function summarize(checks) {
  return {
    pass: checks.filter((check) => check.status === "pass").length,
    warn: checks.filter((check) => check.status === "warn").length,
    fail: checks.filter((check) => check.status === "fail").length,
  };
}

function buildRecommendations(report) {
  const recommendations = [];
  const failedIds = new Set(report.checks.filter((check) => check.status === "fail").map((check) => check.id));

  if (failedIds.has("windows-registry")) {
    recommendations.push("Run `surf install <extension-id> --browser <browser>` so Windows registers the native messaging host, then restart the browser.");
  }
  if (failedIds.has("manifest-file") || failedIds.has("manifest-shape")) {
    recommendations.push("Run `surf install <extension-id>` with the extension ID from chrome://extensions, then restart the browser.");
  }
  if (failedIds.has("manifest-origins")) {
    recommendations.push("Rerun `surf install <extension-id>` after copying the current Surf extension ID from chrome://extensions.");
  }
  if (failedIds.has("manifest-path") || failedIds.has("manifest-path-executable")) {
    recommendations.push("Reinstall the native host so the manifest path points at the current Surf wrapper.");
  }
  if (failedIds.has("manifest-supported")) {
    recommendations.push("Choose a browser supported for this target, or rerun with `--browser all` to inspect every supported setup.");
  }
  if (failedIds.has("socket-file") || failedIds.has("socket-connect")) {
    recommendations.push("Make sure the browser is running with the Surf extension enabled, then restart the browser after install changes.");
  }
  if (report.environment.surfSocketSet) {
    recommendations.push("SURF_SOCKET is set; make sure Chrome launches the native host with the same socket value.");
  }
  if (report.environment.runningInWsl && report.environment.effectiveTarget === "wsl-windows") {
    recommendations.push("For WSL2 with Windows Chrome, run `surf install <extension-id>` from the same WSL distro and restart Windows Chrome. Use `--target linux` only for a Linux browser in WSLg.");
  }
  if (report.environment.platform === "darwin") {
    recommendations.push("On macOS, confirm the extension ID in the manifest matches chrome://extensions and reopen the extension service worker console for native messaging errors.");
  }

  return Array.from(new Set(recommendations));
}

async function runDoctor(rawOptions = {}, deps = {}) {
  const env = deps.env || process.env;
  const platform = deps.platform || process.platform;
  const homeDir = deps.homeDir || os.homedir();
  const runningInWsl = isWsl({ platform, env, readFileSync: deps.readFileSync || fs.readFileSync });
  const options = {
    browser: rawOptions.browser || "chrome",
    target: rawOptions.target || "auto",
    socket: rawOptions.socket || env.SURF_SOCKET || defaultSocketPath(platform),
    connectTimeoutMs: rawOptions.connectTimeoutMs ?? 750,
  };
  const effectiveTarget = resolveEffectiveTarget(options, { platform, runningInWsl });
  const browsers = resolveBrowsers(options.browser);
  const context = {
    platform,
    homeDir,
    env,
    runningInWsl,
    effectiveTarget,
    fs: deps.fs || fs,
    execFileSync: deps.execFileSync || execFileSync,
    connectSocket: deps.connectSocket || connectSocket,
    connectTimeoutMs: options.connectTimeoutMs,
  };

  const checks = [];
  checks.push({ id: "platform", status: "info", message: `Platform: ${platform}${runningInWsl ? " (WSL2 detected)" : ""}` });
  checks.push({ id: "target", status: "info", message: `Install target: ${effectiveTarget === "wsl-windows" ? "Windows browser from WSL2" : effectiveTarget}` });
  checks.push({ id: "socket-path", status: "info", message: `Socket path: ${options.socket}`, path: options.socket });

  checks.push(...await checkSocket(options.socket, context));

  const manifests = [];
  for (const browserKey of browsers) {
    const browser = BROWSERS[browserKey];
    const browserChecks = [];
    let manifestPath = manifestPathForBrowser(browserKey, context);

    if (context.platform === "win32" && browser.win32) {
      const registry = checkWindowsRegistry(browserKey, context);
      browserChecks.push(registry.check);
      if (registry.manifestPath) manifestPath = registry.manifestPath;
    }

    if (!manifestPath) {
      const check = {
        id: "manifest-supported",
        status: options.browser === "all" ? "warn" : "fail",
        browser: browserKey,
        message: `${browser.name} native messaging is not supported for ${effectiveTarget}`,
      };
      browserChecks.push(check);
      checks.push(...browserChecks);
      manifests.push({ browser: browserKey, name: browser.name, path: null, supported: false, checks: browserChecks });
      continue;
    }

    const result = checkManifest(manifestPath, context);
    browserChecks.push(...result.checks.map((check) => ({ ...check, browser: browserKey })));
    checks.push(...browserChecks);
    manifests.push({
      browser: browserKey,
      name: browser.name,
      path: manifestPath,
      supported: true,
      manifest: result.manifest,
      checks: browserChecks,
    });
  }

  checks.sort((a, b) => statusRank(b.status) - statusRank(a.status));
  const summary = summarize(checks);
  const report = {
    ok: summary.fail === 0,
    summary,
    environment: {
      platform,
      runningInWsl,
      effectiveTarget,
      socketPath: options.socket,
      surfSocketSet: Boolean(env.SURF_SOCKET),
      socketOverrideSet: Boolean(rawOptions.socket),
      browsers,
    },
    manifests,
    checks,
  };
  report.recommendations = buildRecommendations(report);
  return report;
}

function formatCheck(check) {
  const labels = { pass: "PASS", warn: "WARN", fail: "FAIL", info: "INFO" };
  const browser = check.browser ? ` [${check.browser}]` : "";
  return `[${labels[check.status] || check.status.toUpperCase()}]${browser} ${check.message}`;
}

function formatDoctorReport(report) {
  const lines = ["Surf doctor", ""];
  lines.push(`Platform: ${report.environment.platform}${report.environment.runningInWsl ? " (WSL2 detected)" : ""}`);
  lines.push(`Target: ${report.environment.effectiveTarget === "wsl-windows" ? "Windows browser from WSL2" : report.environment.effectiveTarget}`);
  lines.push(`Socket: ${report.environment.socketPath}`);
  lines.push(`Browsers: ${report.environment.browsers.join(", ")}`);
  lines.push("");

  for (const check of report.checks.filter((item) => item.status !== "info")) {
    lines.push(formatCheck(check));
  }

  if (report.recommendations.length > 0) {
    lines.push("", "Next steps:");
    for (const recommendation of report.recommendations) {
      lines.push(`- ${recommendation}`);
    }
  }

  lines.push("", report.ok ? "Doctor result: OK" : "Doctor result: issues found");
  return lines.join("\n");
}

function doctorHelp() {
  return `Usage: surf doctor [options]

Diagnose native host and socket setup without requiring a working browser connection.

Options:
  -b, --browser <name>       Browser to inspect (default: chrome; supports chrome, chromium, brave, edge, arc, helium, all)
  --target <target>          Install target to inspect: auto, linux, windows (default: auto)
  --socket <path>            Socket path or named pipe to check (default: SURF_SOCKET or platform default)
  --connect-timeout <ms>     Socket connection timeout (default: 750)
  --json                     Print machine-readable diagnostics

Examples:
  surf doctor
  surf doctor --browser brave
  surf doctor --browser all --json
  surf doctor --target linux
`;
}

async function runDoctorCli(rawArgs) {
  let options;
  try {
    options = parseDoctorArgs(rawArgs);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    console.error("Run `surf doctor --help` for usage.");
    return 1;
  }

  if (options.help) {
    console.log(doctorHelp());
    return 0;
  }

  try {
    const report = await runDoctor(options);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatDoctorReport(report));
    }
    return report.ok ? 0 : 1;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return 1;
  }
}

module.exports = {
  BROWSERS,
  HOST_NAME,
  doctorHelp,
  formatDoctorReport,
  parseDoctorArgs,
  runDoctor,
  runDoctorCli,
  windowsPathToWslPath,
};
