import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeMock, resetChromeMock } from "../../mocks/chrome";

const cdpState = vi.hoisted(() => ({
  entries: [] as Array<Record<string, unknown>>,
  enableNetworkTracking: vi.fn(),
  disableNetworkTracking: vi.fn(),
  drainNetworkEvents: vi.fn(),
  getNetworkEntries: vi.fn(() => cdpState.entries),
}));

vi.mock("../../../src/cdp/controller", () => ({
  CDPController: class {
    enableNetworkTracking = cdpState.enableNetworkTracking;
    disableNetworkTracking = cdpState.disableNetworkTracking;
    drainNetworkEvents = cdpState.drainNetworkEvents;
    getNetworkEntries = cdpState.getNetworkEntries;
  },
}));

vi.mock("../../../src/native/port-manager", () => ({
  initNativeMessaging: vi.fn(),
  postToNativeHost: vi.fn(),
}));

async function loadHandleMessage() {
  vi.resetModules();
  (globalThis as any).chrome = createChromeMock();
  const mod = await import("../../../src/service-worker/index");
  return mod.handleMessage;
}

describe("network export handlers", () => {
  beforeEach(() => {
    resetChromeMock();
    cdpState.entries = [];
    cdpState.enableNetworkTracking.mockReset();
    cdpState.disableNetworkTracking.mockReset();
    cdpState.drainNetworkEvents.mockReset();
    cdpState.getNetworkEntries.mockClear();
  });

  it("returns captured entries and format flags", async () => {
    const handleMessage = await loadHandleMessage();
    cdpState.entries = [{ id: "r1", url: "https://example.test" }];
    const result = await handleMessage(
      { type: "EXPORT_NETWORK_REQUESTS", tabId: 42, har: true },
      {},
    );
    expect(result).toEqual({ entries: cdpState.entries, har: true, jsonl: false });
    expect(cdpState.enableNetworkTracking).toHaveBeenCalledWith(42);
    expect(cdpState.drainNetworkEvents).toHaveBeenCalledWith(42);
    expect(cdpState.getNetworkEntries).toHaveBeenCalledWith(42, {});
  });

  it("stops explicit network capture", async () => {
    const handleMessage = await loadHandleMessage();
    await expect(handleMessage({ type: "STOP_NETWORK_CAPTURE", tabId: 42 }, {})).resolves.toEqual({
      success: true,
    });
    expect(cdpState.disableNetworkTracking).toHaveBeenCalledWith(42);
  });

  it("rejects entries exceeding the native-message source cap", async () => {
    const handleMessage = await loadHandleMessage();
    cdpState.entries = [{ body: "x".repeat(17 * 1024 * 1024) }];
    await expect(handleMessage({ type: "EXPORT_NETWORK_REQUESTS", tabId: 42 }, {})).rejects.toThrow(
      /16 MiB native-message limit/,
    );
  });
});
