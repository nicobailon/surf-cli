const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// How to start each supported browser: macOS app name for `open -a`, Linux binaries tried in
// order on PATH, and the Windows name `start` resolves through App Paths.
const LAUNCHERS = {
  chrome: { darwin: "Google Chrome", linux: ["google-chrome-stable", "google-chrome"], win32: "chrome" },
  chromium: { darwin: "Chromium", linux: ["chromium", "chromium-browser"] },
  brave: { darwin: "Brave Browser", linux: ["brave-browser", "brave"], win32: "brave" },
  edge: { darwin: "Microsoft Edge", linux: ["microsoft-edge-stable", "microsoft-edge"], win32: "msedge" },
  arc: { darwin: "Arc" },
  helium: { darwin: "Helium" },
};

/** The argv that starts the browser from surf.json's `browser` settings, opening `url` if given. */
function launchArgv({ app = "chrome", command, url }, { platform = process.platform, env = process.env } = {}) {
  // Only a parsed URL reaches the command line: it has no raw quote (cmd) and can't pass as a flag.
  let href;
  try {
    href = url ? new URL(url).href : undefined;
  } catch {}
  const urlArgs = href ? [href] : [];
  if (command !== undefined) {
    if (!Array.isArray(command) || command.length === 0 || !command.every((part) => typeof part === "string" && part)) {
      throw new Error("surf.json browser.command must be a non-empty array of strings");
    }
    return [...command, ...urlArgs];
  }
  const launcher = LAUNCHERS[app];
  if (!launcher) {
    throw new Error(`surf.json browser.app must be one of ${Object.keys(LAUNCHERS).join(", ")}`);
  }
  const target = launcher[platform];
  if (!target) throw new Error(`Surf can't start ${app} on ${platform}; set browser.command in surf.json`);
  if (platform === "darwin") return ["open", "-a", target, ...urlArgs];
  // Passed verbatim to cmd: the empty title keeps `start` from taking the quoted URL as one.
  if (platform === "win32") return ["cmd", "/c", "start", '""', target, ...urlArgs.map((u) => `"${u}"`)];
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) {
    throw new Error(`Surf can't start ${app}: no display (DISPLAY and WAYLAND_DISPLAY are unset)`);
  }
  const dirs = (env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const binary of target) {
    const found = dirs.map((dir) => path.join(dir, binary)).find((file) => fs.existsSync(file));
    if (found) return [found, ...urlArgs];
  }
  throw new Error(`Surf can't find ${target.join(" or ")} on PATH; set browser.command in surf.json`);
}

/** Starts the browser detached. `launch.error` is set if it can't be spawned or exits with an error. */
function launchBrowser(argv) {
  const launch = { error: null };
  const child = spawn(argv[0], argv.slice(1), {
    detached: true,
    stdio: "ignore",
    windowsVerbatimArguments: argv[0] === "cmd",
  });
  child.on("error", (error) => { launch.error = error; });
  child.on("exit", (code) => { if (code) launch.error = new Error(`exited with code ${code}`); });
  child.unref();
  return launch;
}

module.exports = { launchArgv, launchBrowser };
