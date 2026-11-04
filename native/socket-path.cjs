const path = require("path");
const os = require("os");

const IS_WIN = process.platform === "win32";
const DEFAULT_SOCKET_PATH = IS_WIN ? "//./pipe/surf" : "/tmp/surf.sock";
const SOCKET_PATH = process.env.SURF_SOCKET || DEFAULT_SOCKET_PATH;
const SURF_TMP = process.env.SURF_TMP || (IS_WIN ? path.join(os.tmpdir(), "surf") : "/tmp");
const ANDROID_REMOTE_HINT =
  "Browsers on Android can't run the Surf extension's native host. Run the browser on a desktop machine and connect from here with `surf --remote <host>:<port> --remote-credential <file>` (or SURF_REMOTE and SURF_REMOTE_CREDENTIAL); see \"Remote Surf over Tailscale\" in the README.";

function getSocketTroubleshootingHint() {
  const lines = [
    `Attempted socket: ${SOCKET_PATH}`,
    process.platform === "android"
      ? ANDROID_REMOTE_HINT
      : "Make sure the browser is running with the Surf extension enabled, then restart the browser after native host install changes.",
    "Run `surf doctor --browser all` for detailed native host diagnostics.",
  ];

  if (process.env.SURF_SOCKET) {
    lines.push("SURF_SOCKET is set; make sure the native host and CLI use the same value.");
  }

  if (process.platform === "linux") {
    lines.push("On WSL2 with Windows Chrome, run `surf install <extension-id>` from WSL and restart Windows Chrome.");
  }

  return lines.join("\n");
}

function formatSocketError(error, context = "connect") {
  let message;
  if (error && error.code === "ENOENT") {
    message = "Socket not found.";
  } else if (error && error.code === "ECONNREFUSED") {
    message = "Connection refused. Native host is not accepting connections.";
  } else {
    message = error && error.message ? error.message : String(error);
  }

  return `Socket ${context} failed: ${message}\n${getSocketTroubleshootingHint()}`;
}

module.exports = {
  ANDROID_REMOTE_HINT,
  DEFAULT_SOCKET_PATH,
  SOCKET_PATH,
  SURF_TMP,
  formatSocketError,
  getSocketTroubleshootingHint,
};
