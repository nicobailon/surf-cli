#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync, execSync } = require("child_process");
const { parseListenEndpoint } = require("../native/listener.cjs");
const { getStateDir, loadHostIdentity, loadRegistry } = require("../native/remote-auth.cjs");

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
    darwin:
      "Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts",
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
    darwin:
      "Library/Application Support/Arc/User Data/NativeMessagingHosts",
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

const NODE_PATHS = {
  darwin: [
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "/usr/bin/node",
  ],
  linux: [
    "/usr/bin/node",
    "/usr/local/bin/node",
  ],
  win32: [
    "C:\\Program Files\\nodejs\\node.exe",
    "C:\\Program Files (x86)\\nodejs\\node.exe",
  ],
};

function isWsl() {
  if (process.platform !== "linux") return false;
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    return /microsoft|wsl/i.test(fs.readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

function findNode() {
  if (process.env.SURF_NODE_PATH && fs.existsSync(process.env.SURF_NODE_PATH)) {
    return process.env.SURF_NODE_PATH;
  }
  const platform = process.platform;
  const paths = NODE_PATHS[platform] || [];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  try {
    const which = platform === "win32" ? "where" : "which";
    const result = execSync(`${which} node`, { encoding: "utf8" }).trim();
    if (result) return result.split("\n")[0];
  } catch {}
  return null;
}

function findNpmGlobalRoot() {
  try {
    return execSync("npm root -g", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function getWrapperDir(target = process.platform) {
  const home = os.homedir();
  if (target === "wsl-windows") {
    const localAppData = getWindowsEnv("LOCALAPPDATA");
    if (!localAppData) return null;
    return path.join(windowsPathToWslPath(localAppData), "surf-cli");
  }
  switch (process.platform) {
    case "darwin":
      return path.join(home, "Library/Application Support/surf-cli");
    case "linux":
      return path.join(home, ".local/share/surf-cli");
    case "win32":
      return path.join(process.env.LOCALAPPDATA || path.join(home, "AppData/Local"), "surf-cli");
    default:
      return null;
  }
}

function getHostPath() {
  if (process.env.SURF_HOST_PATH && fs.existsSync(process.env.SURF_HOST_PATH)) {
    return process.env.SURF_HOST_PATH;
  }
  const npmRoot = findNpmGlobalRoot();
  if (npmRoot) {
    const globalPath = path.join(npmRoot, "surf-cli/native/host.cjs");
    if (fs.existsSync(globalPath)) return globalPath;
  }
  const localPath = path.resolve(__dirname, "../native/host.cjs");
  if (fs.existsSync(localPath)) return localPath;
  return null;
}

function getWindowsEnv(name) {
  try {
    return execFileSync("cmd.exe", ["/c", "echo", `%${name}%`], { encoding: "utf8" })
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

function wslPathToWindowsPath(wslPath) {
  try {
    return execFileSync("wslpath", ["-w", wslPath], { encoding: "utf8" }).trim().replace(/\r/g, "");
  } catch {
    const match = wslPath.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
    if (match) return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, "\\")}`;
    return wslPath;
  }
}

function createWrapper(wrapperDir, nodePath, hostPath, target = process.platform, listen) {
  fs.mkdirSync(wrapperDir, { recursive: true });

  if (target === "wsl-windows") {
    const cmdPath = path.join(wrapperDir, "host-wrapper-wsl.cmd");
    const distroArg = process.env.WSL_DISTRO_NAME ? ` -d "${process.env.WSL_DISTRO_NAME}"` : "";
    const content = `@echo off\r\nwsl.exe${distroArg} --cd "${path.dirname(hostPath)}" --exec "${nodePath}" "${hostPath}" %*\r\n`;
    fs.writeFileSync(cmdPath, content);
    return wslPathToWindowsPath(cmdPath);
  }

  if (process.platform === "win32") {
    const batPath = path.join(wrapperDir, "host-wrapper.bat");
    const content = `@echo off\r\n"${nodePath}" "${hostPath}" %*\r\n`;
    fs.writeFileSync(batPath, content);
    return batPath;
  }

  const shPath = path.join(wrapperDir, "host-wrapper.sh");
  const hostDir = path.dirname(hostPath);
  const content = `#!/usr/bin/env bash
cd "${hostDir}"
${listen ? `: "\${SURF_LISTEN:=${listen}}"\nexport SURF_LISTEN\n` : ""}exec "${nodePath}" "${hostPath}" "$@"
`;
  fs.writeFileSync(shPath, content);
  fs.chmodSync(shPath, "755");
  return shPath;
}

function assertListenTargetSupported(listen, target) {
  if (listen && (target === "win32" || target === "wsl-windows")) {
    throw new Error("--listen is not supported for Windows native-host wrappers");
  }
}

function readExistingManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) return {};
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function writeManifest(manifestPath, extensionId, wrapperPath) {
  const origin = `chrome-extension://${extensionId}/`;
  const existing = readExistingManifest(manifestPath);
  const allowedOrigins = Array.isArray(existing.allowed_origins) ? existing.allowed_origins : [];

  const manifest = {
    ...existing,
    name: HOST_NAME,
    description: existing.description || "Surf CLI Native Host",
    path: wrapperPath,
    type: "stdio",
    allowed_origins: Array.from(new Set([...allowedOrigins, origin])),
  };

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

function getWslWindowsManifestDir(browserConfig) {
  const localAppData = getWindowsEnv("LOCALAPPDATA");
  if (!localAppData || !browserConfig.wsl) return null;
  return path.join(windowsPathToWslPath(localAppData), browserConfig.wsl);
}

function installManifest(browser, extensionId, wrapperPath, target) {
  const browserConfig = BROWSERS[browser];

  if (!browserConfig) return null;

  if (target === "wsl-windows") {
    const manifestDir = getWslWindowsManifestDir(browserConfig);
    if (!manifestDir) return null;
    const manifestPath = path.join(manifestDir, `${HOST_NAME}.json`);
    return writeManifest(manifestPath, extensionId, wrapperPath);
  }

  const platform = process.platform;
  if (!browserConfig[platform]) return null;

  if (platform === "win32") {
    return installWindowsRegistry(browser, extensionId, wrapperPath);
  }

  const manifestDir = path.join(os.homedir(), browserConfig[platform]);
  const manifestPath = path.join(manifestDir, `${HOST_NAME}.json`);
  return writeManifest(manifestPath, extensionId, wrapperPath);
}

function installWindowsRegistry(browser, extensionId, wrapperPath) {
  const browserConfig = BROWSERS[browser];
  const regPath = `HKCU\\Software\\${browserConfig.win32}\\NativeMessagingHosts\\${HOST_NAME}`;

  const manifestDir = getWrapperDir();
  const manifestPath = path.join(manifestDir, `${HOST_NAME}.json`);
  writeManifest(manifestPath, extensionId, wrapperPath);

  try {
    execSync(`reg add "${regPath}" /ve /t REG_SZ /d "${manifestPath}" /f`, {
      stdio: "pipe",
    });
    return manifestPath;
  } catch (e) {
    console.error(`Failed to add registry entry: ${e.message}`);
    return null;
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { extensionId: null, browsers: ["chrome"], target: "auto", listen: undefined };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--browser" || arg === "-b") {
      const browserArg = args[++i];
      if (browserArg === "all") {
        result.browsers = Object.keys(BROWSERS);
      } else {
        result.browsers = browserArg.split(",").map((b) => b.trim().toLowerCase());
      }
    } else if (arg === "--target") {
      result.target = args[++i];
    } else if (arg === "--listen") {
      result.listen = args[++i];
      if (!result.listen || result.listen.startsWith("--")) throw new Error("--listen requires a Tailnet IP and port");
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith("-")) {
      result.extensionId = arg;
    }
  }
  return result;
}

function printHelp() {
  console.log(`
Surf CLI Native Host Installer

Usage: install-native-host.cjs <extension-id> [options]

Arguments:
  extension-id    Chrome extension ID (32 lowercase letters a-p)
                  Find at chrome://extensions with Developer Mode enabled

Options:
  -b, --browser   Browser(s) to install for (default: chrome)
                  Values: chrome, chromium, brave, edge, arc, helium, all
                  Multiple: --browser chrome,brave
  --target        Install target: auto, linux, windows
                  On WSL2, auto installs for Windows Chrome. Use linux for WSLg/Linux browsers.
  --listen <tailscale-ip>:<port>
                  Persist an authenticated Tailnet-only listener endpoint.
                  Requires at least one surf remote authorize client first.
                  Supports Tailscale IPv4 or IPv6 addresses; POSIX wrappers only.

Examples:
  node install-native-host.cjs abcdefghijklmnopabcdefghijklmnop
  node install-native-host.cjs abcdefghijklmnop --browser brave
  node install-native-host.cjs abcdefghijklmnop --browser all
  node install-native-host.cjs abcdefghijklmnop --target linux
  node install-native-host.cjs abcdefghijklmnop --listen 100.64.1.2:4321
`);
}

function main() {
  let parsed;
  try { parsed = parseArgs(); } catch (error) { console.error(`Error: ${error.message}`); process.exit(1); }
  const { extensionId, browsers, target, listen } = parsed;

  if (!extensionId) {
    console.error("Error: Extension ID required");
    console.error("Usage: install-native-host.cjs <extension-id> [--browser chrome|chromium|brave|edge|arc|helium|all] [--target auto|linux|windows]");
    console.error("\nFind your extension ID at chrome://extensions (enable Developer Mode)");
    process.exit(1);
  }

  if (!/^[a-p]{32}$/.test(extensionId)) {
    console.error("Error: Invalid extension ID format");
    console.error("Expected 32 lowercase letters (a-p)");
    process.exit(1);
  }
  let listener;
  try {
    listener = listen ? parseListenEndpoint(listen).display : undefined;
    if (listener) {
      const stateDir = getStateDir();
      loadHostIdentity(stateDir);
      if (loadRegistry(stateDir).clients.length === 0) {
        throw new Error("--listen requires at least one authorized remote client; run `surf remote authorize <label> --output <path>` first");
      }
    }
  } catch (error) { console.error(`Error: ${error.message}`); process.exit(1); }

  if (!["auto", "linux", "windows"].includes(target)) {
    console.error("Error: Invalid --target value. Expected auto, linux, or windows");
    process.exit(1);
  }

  const runningInWsl = isWsl();
  if (target === "windows" && !runningInWsl && process.platform !== "win32") {
    console.error("Error: --target windows is only supported on Windows or WSL2");
    process.exit(1);
  }

  if (target === "linux" && process.platform !== "linux") {
    console.error("Error: --target linux is only supported on Linux or WSL2");
    process.exit(1);
  }

  const effectiveTarget = runningInWsl && target !== "linux" ? "wsl-windows" : process.platform;
  try { assertListenTargetSupported(listen, effectiveTarget); } catch (error) { console.error(`Error: ${error.message}`); process.exit(1); }

  const nodePath = findNode();
  if (!nodePath) {
    console.error("Error: Could not find Node.js");
    console.error("Make sure Node.js is installed and in your PATH");
    process.exit(1);
  }

  const hostPath = getHostPath();
  if (!hostPath) {
    console.error("Error: Could not find host.cjs");
    console.error("Make sure surf-cli is installed correctly");
    process.exit(1);
  }

  const wrapperDir = getWrapperDir(effectiveTarget);
  if (!wrapperDir) {
    console.error("Error: Unsupported platform or Windows interop unavailable");
    process.exit(1);
  }

  console.log(`Platform: ${process.platform}${runningInWsl ? " (WSL2 detected)" : ""}`);
  console.log(`Target: ${effectiveTarget === "wsl-windows" ? "Windows browser from WSL2" : effectiveTarget}`);
  console.log(`Node: ${nodePath}`);
  console.log(`Host: ${hostPath}`);
  console.log(`Wrapper dir: ${wrapperDir}`);
  console.log("");

  const wrapperPath = createWrapper(wrapperDir, nodePath, hostPath, effectiveTarget, listener);
  console.log(`Created wrapper: ${wrapperPath}`);
  console.log("");

  const installed = [];
  const skipped = [];

  for (const browser of browsers) {
    if (!BROWSERS[browser]) {
      console.error(`Unknown browser: ${browser}`);
      continue;
    }

    const result = installManifest(browser, extensionId, wrapperPath, effectiveTarget);
    if (result) {
      installed.push({ browser: BROWSERS[browser].name, path: result });
    } else {
      skipped.push(BROWSERS[browser].name);
    }
  }

  if (installed.length > 0) {
    console.log("Installed for:");
    for (const { browser, path: p } of installed) {
      console.log(`  ${browser}: ${p}`);
    }
  }

  if (skipped.length > 0) {
    console.log(`\nSkipped (not supported for ${effectiveTarget}): ${skipped.join(", ")}`);
  }

  console.log("\nDone! Restart your browser for changes to take effect.");
}

if (require.main === module) {
  main();
}

module.exports = {
  createWrapper,
  writeManifest,
  assertListenTargetSupported,
};
