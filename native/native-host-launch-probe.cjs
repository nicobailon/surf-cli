const { execFileSync } = require("child_process");
const { runWindowsExecutable } = require("../scripts/windows-interop.cjs");

const LAUNCH_PROBE_ARGUMENT = "--surf-native-host-launch-probe";
const LAUNCH_PROBE_MARKER = "SURF_NATIVE_HOST_LAUNCH_PROBE_OK";
const WRAPPER_PROBE_CAPABILITY_MARKER = "rem SURF_NATIVE_HOST_LAUNCH_PROBE_V1";
const LAUNCH_PROBE_TIMEOUT_MS = 5000;

function renderWslWrapper(nodePath, hostPath, distro) {
  const path = require("path");
  for (const value of [nodePath, hostPath, distro].filter((value) => value !== undefined)) {
    if (/["%!\r\n]/.test(value)) throw new Error("WSL wrapper path or distro contains unsupported batch characters");
  }
  const distroArg = distro ? ` -d "${distro}"` : "";
  return `@echo off\r\n${WRAPPER_PROBE_CAPABILITY_MARKER}\r\nwsl.exe${distroArg} --cd "${path.dirname(hostPath)}" --exec "${nodePath}" "${hostPath}" %*\r\n`;
}

function probeWindowsWrapper(wrapperPath, deps = {}) {
  if (!/^[a-z]:\\[^"%\r\n]*\.cmd$/i.test(wrapperPath) || /[&|<>^!]/.test(wrapperPath)) {
    throw new Error("Native host wrapper path cannot be safely passed to cmd.exe");
  }
  let output;
  try {
    output = runWindowsExecutable(
      "cmd.exe",
      ["/d", "/s", "/c", `""${wrapperPath}" ${LAUNCH_PROBE_ARGUMENT}${deps.verifyDistro ? "-distro" : ""}"`],
      {
        execFileSync: deps.execFileSync || execFileSync,
        allowWslFallback: true,
        execOptions: {
          encoding: "utf8",
          timeout: deps.timeoutMs ?? LAUNCH_PROBE_TIMEOUT_MS,
          maxBuffer: 64 * 1024,
          windowsHide: true,
        },
      },
    );
  } catch (error) {
    throw new Error(`Native host wrapper launch probe failed: ${error.message}`);
  }

  const response = String(output).trim();
  if (deps.verifyDistro) {
    if (!response.startsWith(`${LAUNCH_PROBE_MARKER}:`)) {
      throw new Error("Native host wrapper launch probe failed: host returned unexpected output");
    }
    let distro;
    try {
      distro = JSON.parse(response.slice(LAUNCH_PROBE_MARKER.length + 1));
    } catch {
      throw new Error("Native host wrapper launch probe failed: invalid distro identity");
    }
    if (distro !== null && (typeof distro !== "string" || !distro)) {
      throw new Error("Native host wrapper launch probe failed: invalid distro identity");
    }
    return distro;
  }
  if (response !== LAUNCH_PROBE_MARKER) {
    throw new Error("Native host wrapper launch probe failed: host returned unexpected output");
  }
}

module.exports = {
  LAUNCH_PROBE_ARGUMENT,
  LAUNCH_PROBE_MARKER,
  WRAPPER_PROBE_CAPABILITY_MARKER,
  renderWslWrapper,
  probeWindowsWrapper,
};
