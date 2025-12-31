import { debugLog } from "../utils/debug";
import { handleNativeApiResponse } from "./native-api-transport";

let nativePort: chrome.runtime.Port | null = null;
let messageHandler: ((msg: any) => Promise<any>) | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingNativeRequests = new Map<number, { resolve: (value: any) => void; reject: (err: Error) => void }>();
let nativeRequestId = 0;

export function initNativeMessaging(
  handler: (msg: any) => Promise<any>
): void {
  messageHandler = handler;
  connect();
}

export function sendToNativeHost(msg: any): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!nativePort) {
      reject(new Error("Native host not connected"));
      return;
    }
    
    if (msg.type === "API_REQUEST") {
      nativePort.postMessage(msg);
      resolve({ sent: true });
      return;
    }
    
    const id = ++nativeRequestId;
    pendingNativeRequests.set(id, { resolve, reject });
    nativePort.postMessage({ ...msg, id });
    
    setTimeout(() => {
      if (pendingNativeRequests.has(id)) {
        pendingNativeRequests.delete(id);
        reject(new Error("Native host request timeout"));
      }
    }, 10000);
  });
}

export function postToNativeHost(msg: any): void {
  if (nativePort) {
    nativePort.postMessage(msg);
  }
}

function connect(): void {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  try {
    nativePort = chrome.runtime.connectNative("surf.browser.host");
    debugLog("Connecting to native host...");

    nativePort.onMessage.addListener(async (msg) => {
      debugLog("Received from native host:", msg.type || msg.id);

      if (msg.type === "HOST_READY") {
        debugLog("Native host ready");
        return;
      }

      if (msg.type?.startsWith("API_RESPONSE_")) {
        handleNativeApiResponse(msg);
        chrome.runtime.sendMessage(msg).catch(() => {});
        return;
      }

      if (msg.id && pendingNativeRequests.has(msg.id)) {
        const { resolve } = pendingNativeRequests.get(msg.id)!;
        pendingNativeRequests.delete(msg.id);
        resolve(msg);
        return;
      }

      if (!messageHandler) return;

      try {
        const result = await messageHandler(msg);
        if (!nativePort) {
          debugLog("Cannot send response - native host disconnected:", msg.id);
          return;
        }
        nativePort.postMessage({ id: msg.id, ...result });
      } catch (err) {
        if (!nativePort) {
          debugLog("Cannot send error - native host disconnected:", msg.id);
          return;
        }
        nativePort.postMessage({
          id: msg.id,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    });

    nativePort.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      debugLog(
        "Native host disconnected:",
        error?.message || "unknown reason"
      );
      nativePort = null;

      if (!error?.message?.includes("not found")) {
        reconnectTimeout = setTimeout(connect, 5000);
      }
    });
  } catch (err) {
    debugLog("Failed to connect to native host:", err);
    reconnectTimeout = setTimeout(connect, 10000);
  }
}
