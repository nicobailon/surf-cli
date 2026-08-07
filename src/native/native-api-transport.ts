import { sendToNativeHost } from "./port-manager";

export interface ApiStreamCallbacks {
  onStart: (status: number, headers: Record<string, string>) => void;
  onChunk: (chunk: string) => void;
  onEnd: () => void;
  onError: (error: string) => void;
}

const streamCallbacks = new Map<string, ApiStreamCallbacks>();
let streamIdCounter = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function failStream(callbacks: ApiStreamCallbacks, streamId: string, error: string): true {
  callbacks.onError(error);
  streamCallbacks.delete(streamId);
  return true;
}

export function handleNativeApiResponse(msg: unknown): boolean {
  if (!isRecord(msg)) return false;
  const { type, streamId } = msg;
  
  if (typeof streamId !== "string" || !streamCallbacks.has(streamId)) {
    return false;
  }
  
  const callbacks = streamCallbacks.get(streamId)!;
  
  switch (type) {
    case "API_RESPONSE_START":
      if (typeof msg.status !== "number" || !isStringRecord(msg.headers)) {
        return failStream(callbacks, streamId, "Malformed API response start");
      }
      callbacks.onStart(msg.status, msg.headers);
      return true;
    case "API_RESPONSE_CHUNK":
      if (typeof msg.chunk !== "string") {
        return failStream(callbacks, streamId, "Malformed API response chunk");
      }
      callbacks.onChunk(msg.chunk);
      return true;
    case "API_RESPONSE_END":
      callbacks.onEnd();
      streamCallbacks.delete(streamId);
      return true;
    case "API_RESPONSE_ERROR":
      if (typeof msg.error !== "string") {
        return failStream(callbacks, streamId, "Malformed API response error");
      }
      callbacks.onError(msg.error);
      streamCallbacks.delete(streamId);
      return true;
    default:
      return false;
  }
}

export async function nativeApiFetch(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
  callbacks: ApiStreamCallbacks
): Promise<void> {
  const streamId = `stream_${++streamIdCounter}_${Date.now()}`;
  
  streamCallbacks.set(streamId, callbacks);
  
  try {
    await sendToNativeHost({
      type: "API_REQUEST",
      streamId,
      url,
      method: options.method || "POST",
      headers: options.headers || {},
      body: options.body,
    });
  } catch (err) {
    streamCallbacks.delete(streamId);
    callbacks.onError(err instanceof Error ? err.message : "Unknown error");
  }
}
