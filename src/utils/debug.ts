let debugMode = false;
let initialized = false;
const pendingLogs: unknown[][] = [];

chrome.storage.local.get("debugMode").then(({ debugMode: stored }) => {
  debugMode = !!stored;
  initialized = true;
  if (debugMode) {
    for (const args of pendingLogs) {
      console.log("[Surf]", ...args);
    }
  }
  pendingLogs.length = 0;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.debugMode) {
    debugMode = !!changes.debugMode.newValue;
  }
});

export function debugLog(...args: unknown[]): void {
  if (!initialized) {
    pendingLogs.push(args);
    return;
  }
  if (debugMode) {
    console.log("[Surf]", ...args);
  }
}
