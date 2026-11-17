#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync, execSync } = require("child_process");
const {
  convertWindowsPath,
  convertWslPath,
  getWindowsEnv,
  nativeMessagingRegistryPath,
  runWindowsExecutable,
} = require("./windows-interop.cjs");
const { parseListenEndpoint } = require("../native/listener.cjs");
const { normalizeSocketConfig } = require("../native/socket-permissions.cjs");
const { getStateDir, loadHostIdentity, loadRegistry } = require("../native/remote-auth.cjs");
const {
  renderWslWrapper,
  probeWindowsWrapper,
} = require("../native/native-host-launch-probe.cjs");

const HOST_NAME = "surf.browser.host";
// Chrome derives this from the public `key` in manifest.json, so every unpacked Surf build has this ID.
const SURF_EXTENSION_ID = "oaclimdkkglbnpekeignmjenkodkaaka";

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

function getWrapperDir(target = process.platform) {
  const home = os.homedir();
  if (target === "wsl-windows") {
    const localAppData = getWindowsEnv("LOCALAPPDATA");
    return path.join(convertWindowsPath(localAppData), "surf-cli");
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
  // Never `npm root -g`: with two installs on PATH it may name another surf-cli.
  const localPath = path.resolve(__dirname, "../native/host.cjs");
  return fs.existsSync(localPath) ? localPath : null;
}

function wslPathToWindowsPath(wslPath) {
  if (!isWsl()) return wslPath;
  return convertWslPath(wslPath);
}

function createWrapper(wrapperDir, nodePath, hostPath, target = process.platform, listen, socketMode, socketGroup, distro = process.env.WSL_DISTRO_NAME, convertPath = wslPathToWindowsPath) {
  const socketConfig = normalizeSocketConfig(socketMode, socketGroup);
  assertSocketAccessTargetSupported(socketConfig.mode, socketConfig.group, target);
  fs.mkdirSync(wrapperDir, { recursive: true });

  if (target === "wsl-windows") {
    const cmdPath = path.join(wrapperDir, "host-wrapper-wsl.cmd");
    const windowsPath = convertPath(cmdPath);
    fs.writeFileSync(cmdPath, renderWslWrapper(nodePath, hostPath, distro));
    return windowsPath;
  }

  if (process.platform === "win32") {
    const batPath = path.join(wrapperDir, "host-wrapper.bat");
    const content = `@echo off\r\n"${nodePath}" "${hostPath}" %*\r\n`;
    fs.writeFileSync(batPath, content);
    return batPath;
  }

  const shPath = path.join(wrapperDir, "host-wrapper.sh");
  const hostDir = path.dirname(hostPath);
  const socketEnvironment = [
    socketConfig.mode === undefined ? "" : `: "\${SURF_SOCKET_MODE:=${socketConfig.mode.toString(8)}}"\nexport SURF_SOCKET_MODE\n`,
    socketConfig.group === undefined ? "" : `: "\${SURF_SOCKET_GROUP:=${socketConfig.group}}"\nexport SURF_SOCKET_GROUP\n`,
  ].join("");
  const content = `#!/usr/bin/env bash
cd "${hostDir}"
${listen ? `: "\${SURF_LISTEN:=${listen}}"\nexport SURF_LISTEN\n` : ""}${socketEnvironment}exec "${nodePath}" "${hostPath}" "$@"
`;
  fs.writeFileSync(shPath, content);
  fs.chmodSync(shPath, "755");
  return shPath;
}

function installWithValidatedWrapper(wrapperPath, target, install, deps = {}) {
  if (target === "wsl-windows") {
    if (!deps.distro) throw new Error("WSL_DISTRO_NAME is required for Windows browser installation");
    try {
      probeWindowsWrapper(wrapperPath, deps);
    } catch (error) {
      if (!error.message.includes("WSL_E_DISTRO_NOT_FOUND")) {
        throw new Error(`WSL wrapper validation failed before registration: ${error.message}`);
      }
      const explicitFailure = error;
      const original = fs.readFileSync(deps.wrapperFsPath, "utf8");
      fs.writeFileSync(deps.wrapperFsPath, renderWslWrapper(deps.nodePath, deps.hostPath, null));
      try {
        const defaultDistro = probeWindowsWrapper(wrapperPath, { ...deps, verifyDistro: true });
        if (defaultDistro !== deps.distro) {
          throw new Error("Windows default WSL distro does not match the installing distro");
        }
      } catch (fallbackError) {
        fs.writeFileSync(deps.wrapperFsPath, original);
        throw new Error(`WSL wrapper validation failed before registration (explicit distro: ${explicitFailure.message}; default distro: ${fallbackError.message})`);
      }
    }
  }
  return install();
}

function assertListenTargetSupported(listen, target) {
  if (listen && (target === "win32" || target === "wsl-windows")) {
    throw new Error("--listen is not supported for Windows native-host wrappers");
  }
}

function assertSocketAccessTargetSupported(socketMode, socketGroup, target) {
  if ((socketMode !== undefined || socketGroup !== undefined) && (target === "win32" || target === "wsl-windows")) {
    throw new Error("--socket-mode and --socket-group are only supported for POSIX native-host wrappers");
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

function getWslWindowsManifestDir(browserConfig, deps = {}) {
  if (!browserConfig.wsl) return null;
  const localAppData = getWindowsEnv("LOCALAPPDATA", deps);
  return path.join(convertWindowsPath(localAppData, deps), browserConfig.wsl);
}

function installManifest(browser, extensionId, wrapperPath, target, deps = {}) {
  const browserConfig = BROWSERS[browser];

  if (!browserConfig) return null;

  if (target === "wsl-windows") {
    const manifestDir = getWslWindowsManifestDir(browserConfig, deps);
    if (!manifestDir) return null;
    const manifestPath = path.join(manifestDir, `${HOST_NAME}.json`);
    writeManifest(manifestPath, extensionId, wrapperPath);
    addWindowsRegistry(browser, convertWslPath(manifestPath, deps), true, deps);
    return manifestPath;
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

function addWindowsRegistry(browser, manifestPath, allowWslFallback = false, deps = {}) {
  const browserConfig = BROWSERS[browser];
  const regPath = nativeMessagingRegistryPath(browserConfig.win32, HOST_NAME);

  runWindowsExecutable("reg.exe", ["add", regPath, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"], {
    execFileSync: deps.execFileSync || execFileSync,
    allowWslFallback,
    execOptions: { stdio: "pipe", encoding: "utf8" },
  });
  return regPath;
}

function installWindowsRegistry(browser, extensionId, wrapperPath) {
  const browserConfig = BROWSERS[browser];
  if (!browserConfig.win32) return null;

  const manifestDir = getWrapperDir();
  const manifestPath = path.join(manifestDir, `${HOST_NAME}.json`);
  writeManifest(manifestPath, extensionId, wrapperPath);
  addWindowsRegistry(browser, manifestPath);
  return manifestPath;
}

function installedManifestPath(browser, target) {
  const config = BROWSERS[browser];
  if (target === "wsl-windows") {
    const dir = getWslWindowsManifestDir(config);
    return dir ? path.join(dir, `${HOST_NAME}.json`) : null;
  }
  if (!config[process.platform]) return null;
  if (process.platform === "win32") {
    // Windows browsers share one manifest; a browser has Surf when its registry key exists.
    try {
      runWindowsExecutable("reg.exe", ["query", nativeMessagingRegistryPath(config.win32, HOST_NAME), "/ve"], {
        execFileSync,
        execOptions: { stdio: "pipe", encoding: "utf8" },
      });
    } catch {
      return null;
    }
    return path.join(getWrapperDir(), `${HOST_NAME}.json`);
  }
  return path.join(os.homedir(), config[process.platform], `${HOST_NAME}.json`);
}

// For `--refresh` (run by `surf update`): the browsers whose manifest allows an extension, and
// the settings persisted in their wrapper, so none is lost.
function findInstalled(target) {
  const browsers = [];
  let wrapper = "";
  for (const browser of Object.keys(BROWSERS)) {
    const manifestPath = installedManifestPath(browser, target);
    if (!manifestPath || !fs.existsSync(manifestPath)) continue;
    const manifest = readExistingManifest(manifestPath);
    const origins = Array.isArray(manifest.allowed_origins) ? manifest.allowed_origins : [];
    if (!origins.some((origin) => /^chrome-extension:\/\/[a-p]{32}\/$/.test(origin))) continue;
    browsers.push(browser);
    try { wrapper ||= fs.readFileSync(manifest.path, "utf8"); } catch {}
  }
  const persisted = (name) => new RegExp(`\\$\\{${name}:=([^}]*)\\}`).exec(wrapper)?.[1];
  return { browsers, listen: persisted("SURF_LISTEN"), socketMode: persisted("SURF_SOCKET_MODE"), socketGroup: persisted("SURF_SOCKET_GROUP") };
}

// pi already loads skills/ from the surf-cli package (package.json "pi.skills"),
// so a second copy under ~/.pi/agent/skills would be a duplicate.
function piLoadsSurfPackage(home) {
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(home, ".pi/agent/settings.json"), "utf8"));
    const packages = Array.isArray(settings.packages) ? settings.packages : [];
    return packages.some((entry) => {
      const source = typeof entry === "string" ? entry : entry?.source;
      return typeof source === "string" && /(^|[/\\:])surf-cli(@[^/\\]*)?(\.git)?[/\\]?$/.test(source);
    });
  } catch {
    return false;
  }
}

function linkAgentSkills(home = os.homedir(), skillDir = path.resolve(__dirname, "../skills/surf")) {
  const lines = [];
  const agents = [
    { parent: path.join(home, ".claude/skills") },
    { parent: path.join(home, ".pi/agent/skills"), pi: true },
  ];
  for (const { parent, pi } of agents) {
    if (!fs.existsSync(parent)) continue;
    const linkPath = path.join(parent, "surf");
    if (pi && piLoadsSurfPackage(home)) {
      lines.push(`Skipped ${linkPath}: pi already loads surf's skill from the surf-cli package`);
      continue;
    }
    try {
      const stat = fs.lstatSync(linkPath, { throwIfNoEntry: false });
      if (stat && !stat.isSymbolicLink()) {
        lines.push(`Kept your own ${linkPath}; to use the skill that ships with surf, remove it and rerun \`surf install\``);
        continue;
      }
      if (!stat || path.resolve(parent, fs.readlinkSync(linkPath)) !== skillDir) {
        if (stat) fs.unlinkSync(linkPath);
        fs.symlinkSync(skillDir, linkPath, process.platform === "win32" ? "junction" : "dir");
      }
      lines.push(`Linked ${linkPath} -> ${skillDir}`);
    } catch (error) {
      lines.push(`Could not link ${linkPath}: ${error.message}`);
    }
  }
  return lines;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    extensionId: null,
    browsers: ["chrome"],
    target: "auto",
    listen: undefined,
    socketMode: undefined,
    socketGroup: undefined,
    refresh: false,
  };

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
    } else if (arg === "--refresh") {
      result.refresh = true;
    } else if (arg === "--listen") {
      result.listen = args[++i];
      if (!result.listen || result.listen.startsWith("--")) throw new Error("--listen requires a Tailnet IP and port");
    } else if (arg === "--socket-mode") {
      result.socketMode = args[++i];
      if (!result.socketMode || result.socketMode.startsWith("--")) throw new Error("--socket-mode requires 600 or 660");
    } else if (arg === "--socket-group") {
      result.socketGroup = args[++i];
      if (!result.socketGroup || result.socketGroup.startsWith("--")) throw new Error("--socket-group requires a group name or gid");
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

Usage: install-native-host.cjs [extension-id] [options]

Arguments:
  extension-id    Chrome extension ID (32 lowercase letters a-p). Optional:
                  defaults to Surf's own ID, ${SURF_EXTENSION_ID}.
                  Give one only for a fork or a build with a different ID.

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
  --socket-mode <600|660>
                  Persist the local Unix socket mode (default: 600).
                  Mode 660 requires --socket-group; POSIX wrappers only.
  --socket-group <group-or-gid>
                  Persist the local Unix socket group for mode 660.
                  Use a dedicated group; this grants full Surf authority.
  --refresh       Rewrite existing installs (keeping their IDs and settings), add Surf's ID
                  and relink the agent skill (run by surf update).

Examples:
  node install-native-host.cjs
  node install-native-host.cjs --browser brave
  node install-native-host.cjs abcdefghijklmnopabcdefghijklmnop
  node install-native-host.cjs --browser all
  node install-native-host.cjs --target linux
  node install-native-host.cjs --listen 100.64.1.2:4321
  node install-native-host.cjs --socket-mode 660 --socket-group surf
`);
}

function main() {
  let parsed;
  try { parsed = parseArgs(); } catch (error) { console.error(`Error: ${error.message}`); process.exit(1); }
  let { browsers, target, listen, socketMode, socketGroup, refresh } = parsed;
  const pinnedId = !refresh && !parsed.extensionId;
  // A refresh adds Surf's pinned ID to each install; writeManifest keeps the IDs already there.
  const extensionId = (!refresh && parsed.extensionId) || SURF_EXTENSION_ID;
  if (refresh) {
    ({ browsers, listen, socketMode, socketGroup } = findInstalled(isWsl() && target !== "linux" ? "wsl-windows" : process.platform));
    if (browsers.length === 0) {
      console.log("No browser has the Surf native host installed; run `surf install` to install it.");
      for (const line of linkAgentSkills()) console.log(`  ${line}`);
      return;
    }
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
  let socketConfig;
  try {
    socketConfig = normalizeSocketConfig(socketMode, socketGroup);
    assertListenTargetSupported(listen, effectiveTarget);
    assertSocketAccessTargetSupported(socketMode, socketGroup, effectiveTarget);
  } catch (error) { console.error(`Error: ${error.message}`); process.exit(1); }

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

  const wrapperFsPath = path.join(wrapperDir, "host-wrapper-wsl.cmd");
  const previousWrapper = effectiveTarget === "wsl-windows" && fs.existsSync(wrapperFsPath)
    ? fs.readFileSync(wrapperFsPath, "utf8") : null;
  const wrapperPath = createWrapper(
    wrapperDir,
    nodePath,
    hostPath,
    effectiveTarget,
    listener,
    socketConfig.mode,
    socketConfig.group,
  );
  console.log(`Created wrapper: ${wrapperPath}`);
  console.log("");

  const installed = [];
  const skipped = [];

  try {
    installWithValidatedWrapper(wrapperPath, effectiveTarget, () => {
      for (const browser of browsers) {
        if (!BROWSERS[browser]) {
          console.error(`Unknown browser: ${browser}`);
          continue;
        }

        let result;
        try {
          result = installManifest(browser, extensionId, wrapperPath, effectiveTarget);
        } catch (error) {
          throw new Error(`Failed to install ${BROWSERS[browser].name}: ${error.message}`);
        }
        if (result) {
          installed.push({ browser: BROWSERS[browser].name, path: result });
        } else {
          skipped.push(BROWSERS[browser].name);
        }
      }
    }, { wrapperFsPath, nodePath, hostPath, distro: process.env.WSL_DISTRO_NAME });
  } catch (error) {
    if (effectiveTarget === "wsl-windows" && installed.length === 0) {
      if (previousWrapper === null) fs.rmSync(wrapperFsPath, { force: true });
      else fs.writeFileSync(wrapperFsPath, previousWrapper);
    }
    console.error(`Error: ${error.message}`);
    process.exit(1);
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

  const skillLines = linkAgentSkills();
  if (skillLines.length > 0) {
    console.log("\nAgent skill:");
    for (const line of skillLines) console.log(`  ${line}`);
  }

  if (pinnedId) {
    const extensionPath = process.env.SURF_EXTENSION_PATH || path.resolve(__dirname, "../dist");
    console.log("\nExtension:");
    console.log("  In chrome://extensions, turn on Developer mode, click \"Load unpacked\" and choose:");
    console.log(`  ${extensionPath}`);
    console.log(`  If Surf is already loaded, reload it there instead. chrome://extensions should then show its ID as ${SURF_EXTENSION_ID}.`);
  }

  if (!refresh) console.log("\nDone! Restart your browser for changes to take effect.");
}

if (require.main === module) {
  main();
}

module.exports = {
  SURF_EXTENSION_ID,
  createWrapper,
  findNode,
  getHostPath,
  probeWindowsWrapper,
  installWithValidatedWrapper,
  writeManifest,
  assertListenTargetSupported,
  assertSocketAccessTargetSupported,
  installManifest,
};
