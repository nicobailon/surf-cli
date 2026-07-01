const fs = require("fs");
const path = require("path");
const os = require("os");

const CONFIG_NAME = "surf.json";

let cachedConfig = null;
let cachedConfigPath = null;

const STARTER_CONFIG = {
  // Set to false to disable auto-saving screenshots to /tmp
  // When disabled, screenshots return base64 + ID instead of file path
  autoSaveScreenshots: true,
  routes: {
    main: ["http://localhost:3000"]
  },
  selectors: {
    chatgpt: {
      input: "#prompt-textarea"
    }
  }
};

// Grok models can be customized in surf.json if X.com UI changes:
// {
//   "grok": {
//     "models": {
//       "auto": { "id": "auto", "name": "Auto" },
//       "fast": { "id": "fast", "name": "Fast" },
//       "expert": { "id": "expert", "name": "Expert" },
//       "grok-4.20-beta": { "id": "grok-4.20-beta", "name": "Grok 4.20 Beta" }
//     }
//   }
// }

function findConfigPath() {
  const cwdPath = path.join(process.cwd(), CONFIG_NAME);
  if (fs.existsSync(cwdPath)) {
    return cwdPath;
  }
  const homePath = path.join(os.homedir(), CONFIG_NAME);
  if (fs.existsSync(homePath)) {
    return homePath;
  }
  return null;
}

function loadConfig() {
  if (cachedConfig !== null) {
    return cachedConfig;
  }
  const configPath = findConfigPath();
  if (!configPath) {
    cachedConfig = {};
    cachedConfigPath = null;
    return cachedConfig;
  }
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    cachedConfig = JSON.parse(content);
    cachedConfigPath = configPath;
    return cachedConfig;
  } catch (err) {
    console.error(`Warning: Failed to parse ${configPath}: ${err.message}`);
    cachedConfig = {};
    cachedConfigPath = null;
    return cachedConfig;
  }
}

function getConfigPath() {
  if (cachedConfig === null) {
    loadConfig();
  }
  return cachedConfigPath;
}

function createStarterConfig(targetDir = process.cwd()) {
  const targetPath = path.join(targetDir, CONFIG_NAME);
  if (fs.existsSync(targetPath)) {
    return { success: false, error: "Config already exists", path: targetPath };
  }
  try {
    fs.writeFileSync(targetPath, JSON.stringify(STARTER_CONFIG, null, 2) + "\n");
    return { success: true, path: targetPath };
  } catch (err) {
    return { success: false, error: err.message, path: targetPath };
  }
}

function clearCache() {
  cachedConfig = null;
  cachedConfigPath = null;
}

module.exports = {
  loadConfig,
  getConfigPath,
  createStarterConfig,
  clearCache,
  STARTER_CONFIG,
};
