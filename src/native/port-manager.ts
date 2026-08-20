import { debugLog } from "../utils/debug";

let nativePort: chrome.runtime.Port | null = null;
let messageHandler: ((msg: any) => Promise<any>) | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingNativeRequests = new Map<number, { resolve: (value: any) => void; reject: (err: Error) => void }>();
let nativeRequestId = 0;

const INSTANCE_ID_KEY = "surfBrowserInstanceId";
const EPOCH_KEY = "surfBrowserEpoch";

function randomId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function getBrowserIdentity(): Promise<{ browserInstanceId: string; browserEpoch: string }> {
  const local = await chrome.storage.local.get(INSTANCE_ID_KEY);
  let browserInstanceId = local[INSTANCE_ID_KEY] as string | undefined;
  if (!browserInstanceId) {
    browserInstanceId = randomId();
    await chrome.storage.local.set({ [INSTANCE_ID_KEY]: browserInstanceId });
  }

  const session = await chrome.storage.session.get(EPOCH_KEY);
  let browserEpoch = session[EPOCH_KEY] as string | undefined;
  if (!browserEpoch) {
    browserEpoch = randomId();
    await chrome.storage.session.set({ [EPOCH_KEY]: browserEpoch });
  }
  return { browserInstanceId, browserEpoch };
}

async function postExtensionHello(port: chrome.runtime.Port): Promise<void> {
  const identity = await getBrowserIdentity();
  if (nativePort !== port) return;
  port.postMessage({
    type: "EXTENSION_HELLO",
    protocolVersion: 2,
    extensionVersion: chrome.runtime.getManifest().version,
    capabilities: ["browser-sessions", "strict-targets", "keyed-lanes"],
    ...identity,
  });
}

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
  if (nativePort) nativePort.postMessage(msg);
}

function connect(): void {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  try {
    const port = chrome.runtime.connectNative("surf.browser.host");
    nativePort = port;
    debugLog("Connecting to native host...");
    postExtensionHello(port).catch((error) => debugLog("Failed to send extension hello:", error));

    port.onMessage.addListener(async (msg) => {
      debugLog("Received from native host:", msg.type || msg.id);

      if (msg.type === "HOST_READY") {
        debugLog("Native host ready");
        postExtensionHello(port).catch((error) => debugLog("Failed to refresh extension hello:", error));
        return;
      }

      if (msg.type?.startsWith("API_RESPONSE_")) {
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
        if (nativePort !== port) {
          debugLog("Cannot send response - native host disconnected:", msg.id);
          return;
        }
        port.postMessage({ id: msg.id, ...result });
      } catch (err) {
        if (nativePort !== port) {
          debugLog("Cannot send error - native host disconnected:", msg.id);
          return;
        }
        const error = err as Error & { code?: string; details?: Record<string, unknown> };
        port.postMessage({
          id: msg.id,
          error: error instanceof Error ? error.message : "Unknown error",
          errorCode: typeof error?.code === "string" ? error.code : undefined,
          errorDetails: error?.details,
        });
      }
    });

    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      debugLog("Native host disconnected:", error?.message || "unknown reason");
      if (nativePort === port) nativePort = null;
      for (const pending of pendingNativeRequests.values()) {
        pending.reject(new Error("Native host disconnected"));
      }
      pendingNativeRequests.clear();

      if (!error?.message?.includes("not found")) {
        reconnectTimeout = setTimeout(connect, 5000);
      }
    });
  } catch (err) {
    debugLog("Failed to connect to native host:", err);
    reconnectTimeout = setTimeout(connect, 10000);
  }
}
