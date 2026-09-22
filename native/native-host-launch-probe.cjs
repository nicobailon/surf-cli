const { execFileSync } = require("child_process");
const { runWindowsExecutable } = require("../scripts/windows-interop.cjs");

const LAUNCH_PROBE_ARGUMENT = "--surf-native-host-launch-probe";
const LAUNCH_PROBE_MARKER = "SURF_NATIVE_HOST_LAUNCH_PROBE_OK";
const WRAPPER_PROBE_CAPABILITY_MARKER = "rem SURF_NATIVE_HOST_LAUNCH_PROBE_V1";
const LAUNCH_PROBE_TIMEOUT_MS = 5000;

function hasLaunchProbeCapability(content) {
  return String(content).split(/\r?\n/).includes(WRAPPER_PROBE_CAPABILITY_MARKER);
}

function probeWindowsWrapper(wrapperPath, deps = {}) {
  let output;
  try {
    output = runWindowsExecutable(
      "cmd.exe",
      ["/d", "/s", "/c", wrapperPath, LAUNCH_PROBE_ARGUMENT],
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

  if (String(output).trim() !== LAUNCH_PROBE_MARKER) {
    throw new Error("Native host wrapper launch probe failed: host returned unexpected output");
  }
}

module.exports = {
  LAUNCH_PROBE_ARGUMENT,
  LAUNCH_PROBE_MARKER,
  WRAPPER_PROBE_CAPABILITY_MARKER,
  hasLaunchProbeCapability,
  probeWindowsWrapper,
};
