const { execFileSync } = require("child_process");

function errorDetail(error) {
  if (!error) return "unknown error";
  const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
  return stderr || error.message || String(error);
}

function runWindowsExecutable(executable, args, options = {}) {
  const execFile = options.execFileSync || execFileSync;
  const execOptions = options.execOptions || { encoding: "utf8" };

  try {
    return execFile(executable, args, execOptions);
  } catch (directError) {
    if (!options.allowWslFallback || directError?.code !== "ENOENT") {
      throw new Error(`Failed to run ${executable}: ${errorDetail(directError)}`);
    }

    const windowsPath = `C:\\Windows\\System32\\${executable}`;
    let resolvedPath;
    try {
      resolvedPath = execFile("wslpath", ["-u", windowsPath], { encoding: "utf8" }).trim();
    } catch (resolveError) {
      throw new Error(
        `Could not find ${executable} (bare lookup: ${errorDetail(directError)}; ` +
          `wslpath ${windowsPath}: ${errorDetail(resolveError)})`,
      );
    }
    if (!resolvedPath) {
      throw new Error(`Could not find ${executable}: wslpath returned an empty path for ${windowsPath}`);
    }

    try {
      return execFile(resolvedPath, args, execOptions);
    } catch (resolvedError) {
      throw new Error(
        `Failed to run ${executable} at ${resolvedPath}: ${errorDetail(resolvedError)}`,
      );
    }
  }
}

function getWindowsEnv(name, options = {}) {
  const value = runWindowsExecutable("cmd.exe", ["/c", "echo", `%${name}%`], {
    execFileSync: options.execFileSync || execFileSync,
    allowWslFallback: true,
    execOptions: { encoding: "utf8" },
  }).trim().replace(/\r/g, "");
  if (!value || value === `%${name}%`) {
    throw new Error(
      `Windows environment variable ${name} is unavailable (cmd.exe returned ${JSON.stringify(value)})`,
    );
  }
  return value;
}

function nativeMessagingRegistryPath(browserRegistryRoot, hostName) {
  return `HKCU\\Software\\${browserRegistryRoot}\\NativeMessagingHosts\\${hostName}`;
}

function convertWindowsPath(windowsPath, options = {}) {
  const execFile = options.execFileSync || execFileSync;
  try {
    const converted = execFile("wslpath", ["-u", windowsPath], { encoding: "utf8" }).trim();
    if (!converted) throw new Error("wslpath returned an empty path");
    return converted;
  } catch (error) {
    throw new Error(`Could not convert Windows path ${windowsPath}: ${errorDetail(error)}`);
  }
}

function convertWslPath(wslPath, options = {}) {
  const execFile = options.execFileSync || execFileSync;
  try {
    const converted = execFile("wslpath", ["-w", wslPath], { encoding: "utf8" }).trim();
    if (!converted) throw new Error("wslpath returned an empty path");
    return converted.replace(/\r/g, "");
  } catch (error) {
    throw new Error(`Could not convert WSL path ${wslPath}: ${errorDetail(error)}`);
  }
}

module.exports = {
  convertWindowsPath,
  convertWslPath,
  getWindowsEnv,
  nativeMessagingRegistryPath,
  runWindowsExecutable,
};
