import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeMock, resetChromeMock } from "../../mocks/chrome";

const cdpState = vi.hoisted(() => ({
  startScreencast: vi.fn(),
  stopScreencast: vi.fn(),
  subscribeToScreencast: vi.fn(),
  unsubscribeFromScreencast: vi.fn(),
}));
const nativeState = vi.hoisted(() => ({
  initNativeMessaging: vi.fn(),
  postToNativeHost: vi.fn(),
}));

vi.mock("../../../src/cdp/controller", () => ({
  CDPController: class {
    startScreencast = cdpState.startScreencast;
    stopScreencast = cdpState.stopScreencast;
    subscribeToScreencast = cdpState.subscribeToScreencast;
    unsubscribeFromScreencast = cdpState.unsubscribeFromScreencast;
  },
}));

vi.mock("../../../src/native/port-manager", () => ({
  initNativeMessaging: nativeState.initNativeMessaging,
  postToNativeHost: nativeState.postToNativeHost,
}));

async function loadHandleMessage() {
  vi.resetModules();
  (globalThis as any).chrome = createChromeMock();
  const module = await import("../../../src/service-worker/index");
  return module.handleMessage;
}

describe("service-worker video handlers", () => {
  beforeEach(() => {
    resetChromeMock();
    nativeState.initNativeMessaging.mockReset();
    cdpState.startScreencast.mockReset().mockResolvedValue({});
    cdpState.stopScreencast.mockReset().mockResolvedValue({});
    cdpState.subscribeToScreencast.mockReset();
    cdpState.unsubscribeFromScreencast.mockReset();
    nativeState.postToNativeHost.mockReset();
  });

  it("starts a screencast, forwards frames, and stops it", async () => {
    const handleMessage = await loadHandleMessage();
    const start = await handleMessage(
      { type: "VIDEO_START", tabId: 42, recorderId: "video-1", fps: 30 },
      {},
    );

    expect(start).toEqual({
      success: true,
      recording: true,
      recorderId: "video-1",
      tabId: 42,
      fps: 30,
    });
    expect(cdpState.startScreencast).toHaveBeenCalledWith(42, {
      format: "jpeg",
      quality: 80,
      everyNthFrame: 1,
    });
    const onFrame = cdpState.subscribeToScreencast.mock.calls[0][2] as (frame: unknown) => void;
    onFrame({ data: "jpeg-base64", metadata: { pageScaleFactor: 1 }, sessionId: 7 });
    expect(nativeState.postToNativeHost).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "VIDEO_FRAME",
        recorderId: "video-1",
        tabId: 42,
        data: "jpeg-base64",
        sessionId: 7,
      }),
    );

    await expect(
      handleMessage({ type: "VIDEO_STOP", tabId: 42, recorderId: "video-1" }, {}),
    ).resolves.toEqual({
      success: true,
      stopped: true,
      recorderId: "video-1",
      tabId: 42,
    });
    expect(cdpState.stopScreencast).toHaveBeenCalledWith(42);
    expect(cdpState.unsubscribeFromScreencast).toHaveBeenCalledWith(42, "video-1");
  });

  it("keeps the recorder active for fail-closed cleanup after a screencast failure", async () => {
    const handleMessage = await loadHandleMessage();
    await handleMessage({ type: "VIDEO_START", tabId: 42, recorderId: "video-1", fps: 30 }, {});

    const onError = cdpState.subscribeToScreencast.mock.calls[0][3] as (error: Error) => void;
    onError(Object.assign(new Error("screencast ACK failed"), { code: "screencast_ack_failed" }));
    expect(nativeState.postToNativeHost).toHaveBeenCalledWith({
      type: "VIDEO_ERROR",
      recorderId: "video-1",
      tabId: 42,
      errorCode: "screencast_ack_failed",
      error: "screencast ACK failed",
    });
    expect(cdpState.stopScreencast).not.toHaveBeenCalled();

    await expect(
      handleMessage({ type: "VIDEO_STOP", tabId: 42, recorderId: "video-1" }, {}),
    ).resolves.toMatchObject({ success: true, stopped: true });
    expect(cdpState.stopScreencast).toHaveBeenCalledWith(42);
    expect(cdpState.unsubscribeFromScreencast).toHaveBeenCalledWith(42, "video-1");
  });

  it("stops and clears the recorder when the native host disconnects", async () => {
    const handleMessage = await loadHandleMessage();
    await handleMessage({ type: "VIDEO_START", tabId: 42, recorderId: "video-1", fps: 30 }, {});

    const onDisconnect = nativeState.initNativeMessaging.mock.calls[0][1] as () => Promise<void>;
    await onDisconnect();

    expect(cdpState.stopScreencast).toHaveBeenCalledWith(42);
    expect(cdpState.unsubscribeFromScreencast).toHaveBeenCalledWith(42, "video-1");
    await expect(
      handleMessage({ type: "VIDEO_START", tabId: 43, recorderId: "video-2", fps: 30 }, {}),
    ).resolves.toMatchObject({ success: true, recorderId: "video-2", tabId: 43 });
  });
});
