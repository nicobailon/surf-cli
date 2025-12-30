#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const os = require("os");

const HOST_NAME = "surf.browser.host";
const extensionId = process.argv[2];

if (!extensionId) {
  console.error("Usage: install-native-host.js <extension-id>");
  console.error("Find your extension ID at chrome://extensions");
  process.exit(1);
}

if (!/^[a-p]{32}$/.test(extensionId)) {
  console.error("Invalid extension ID format.");
  console.error("Expected 32 lowercase letters (a-p). Example: abcdefghijklmnopabcdefghijklmnop");
  process.exit(1);
}

let manifestDir;
switch (process.platform) {
  case "darwin":
    manifestDir = path.join(
      os.homedir(),
      "Library/Application Support/Google/Chrome/NativeMessagingHosts"
    );
    break;
  case "linux":
    manifestDir = path.join(
      os.homedir(),
      ".config/google-chrome/NativeMessagingHosts"
    );
    break;
  default:
    console.error("Windows requires registry modification. See docs.");
    process.exit(1);
}

fs.mkdirSync(manifestDir, { recursive: true });

const hostPath = path.resolve(__dirname, "../native/host-wrapper.py");
const manifest = {
  name: HOST_NAME,
  description: "Surf CLI Native Host",
  path: hostPath,
  type: "stdio",
  allowed_origins: [`chrome-extension://${extensionId}/`],
};

const manifestPath = path.join(manifestDir, `${HOST_NAME}.json`);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
fs.chmodSync(hostPath, "755");

console.log(`Installed native host manifest to: ${manifestPath}`);
console.log(`Host executable: ${hostPath}`);
