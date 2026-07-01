#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync, execSync } = require("child_process");

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

function isWsl() {
  if (process.platform !== "linux") return false;
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    return /microsoft|wsl/i.test(fs.readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
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

function getWslWindowsManifestPath(browserConfig) {
  const localAppData = getWindowsEnv("LOCALAPPDATA");
  if (!localAppData || !browserConfig.wsl) return null;
  return path.join(windowsPathToWslPath(localAppData), browserConfig.wsl, `${HOST_NAME}.json`);
}

function removeManifest(browser, target) {
  const browserConfig = BROWSERS[browser];

  if (!browserConfig) return null;

  if (target === "wsl-windows") {
    const manifestPath = getWslWindowsManifestPath(browserConfig);
    if (!manifestPath) return null;
    try {
      fs.unlinkSync(manifestPath);
      return manifestPath;
    } catch {
      return null;
    }
  }

  const platform = process.platform;
  if (!browserConfig[platform]) return null;

  if (platform === "win32") {
    return removeWindowsRegistry(browser);
  }

  const manifestPath = path.join(
    os.homedir(),
    browserConfig[platform],
    `${HOST_NAME}.json`
  );

  try {
    fs.unlinkSync(manifestPath);
    return manifestPath;
  } catch {
    return null;
  }
}

function removeWindowsRegistry(browser) {
  const browserConfig = BROWSERS[browser];
  const regPath = `HKCU\\Software\\${browserConfig.win32}\\NativeMessagingHosts\\${HOST_NAME}`;

  try {
    execSync(`reg delete "${regPath}" /f`, { stdio: "pipe" });
    return regPath;
  } catch {
    return null;
  }
}

function removeWrapperDir(target) {
  const wrapperDir = getWrapperDir(target);
  if (!wrapperDir) return null;

  try {
    fs.rmSync(wrapperDir, { recursive: true, force: true });
    return wrapperDir;
  } catch {
    return null;
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { browsers: ["chrome"], all: false, target: "auto" };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--browser" || arg === "-b") {
      const browserArg = args[++i];
      if (browserArg === "all") {
        result.browsers = Object.keys(BROWSERS);
        result.all = true;
      } else {
        result.browsers = browserArg.split(",").map((b) => b.trim().toLowerCase());
      }
    } else if (arg === "--all" || arg === "-a") {
      result.browsers = Object.keys(BROWSERS);
      result.all = true;
    } else if (arg === "--target") {
      result.target = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return result;
}

function printHelp() {
  console.log(`
Surf CLI Native Host Uninstaller

Usage: uninstall-native-host.cjs [options]

Options:
  -b, --browser   Browser(s) to uninstall from (default: chrome)
                  Values: chrome, chromium, brave, edge, arc, helium, all
  -a, --all       Uninstall from all browsers and remove wrapper
  --target        Install target to remove: auto, linux, windows
                  On WSL2, auto removes Windows-browser manifests. Use linux for WSLg/Linux browsers.

Examples:
  node uninstall-native-host.cjs
  node uninstall-native-host.cjs --browser brave
  node uninstall-native-host.cjs --all
  node uninstall-native-host.cjs --target linux
`);
}

function main() {
  const { browsers, all, target } = parseArgs();

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

  console.log(`Platform: ${process.platform}${runningInWsl ? " (WSL2 detected)" : ""}`);
  console.log(`Target: ${effectiveTarget === "wsl-windows" ? "Windows browser from WSL2" : effectiveTarget}`);
  console.log("");

  const removed = [];
  const notFound = [];

  for (const browser of browsers) {
    if (!BROWSERS[browser]) {
      console.error(`Unknown browser: ${browser}`);
      continue;
    }

    const result = removeManifest(browser, effectiveTarget);
    if (result) {
      removed.push({ browser: BROWSERS[browser].name, path: result });
    } else {
      notFound.push(BROWSERS[browser].name);
    }
  }

  if (removed.length > 0) {
    console.log("Removed manifests:");
    for (const { browser, path: p } of removed) {
      console.log(`  ${browser}: ${p}`);
    }
  }

  if (notFound.length > 0) {
    console.log(`\nNot found: ${notFound.join(", ")}`);
  }

  if (all) {
    const wrapperDir = removeWrapperDir(effectiveTarget);
    if (wrapperDir) {
      console.log(`\nRemoved wrapper directory: ${wrapperDir}`);
    }
  }

  console.log("\nDone!");
}

main();
