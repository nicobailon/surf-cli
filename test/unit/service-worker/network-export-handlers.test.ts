import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeMock, resetChromeMock } from "../../mocks/chrome";

const cdpState = vi.hoisted(() => ({
  entries: [] as Array<Record<string, unknown>>,
  enableNetworkTracking: vi.fn(),
  disableNetworkTracking: vi.fn(),
  drainNetworkEvents: vi.fn(),
  getNetworkEntries: vi.fn(() => cdpState.entries),
  getNetworkEntry: vi.fn(() => null),
  getResponseBody: vi.fn(),
  getNetworkRequests: vi.fn(
    (_tab?: number, _options?: { limit?: number }) => [] as Array<Record<string, unknown>>,
  ),
  getNetworkCaptureStatus: vi.fn(),
}));

vi.mock("../../../src/cdp/controller", () => ({
  CDPController: class {
    enableNetworkTracking = cdpState.enableNetworkTracking;
    disableNetworkTracking = cdpState.disableNetworkTracking;
    drainNetworkEvents = cdpState.drainNetworkEvents;
    getNetworkEntries = cdpState.getNetworkEntries;
    getNetworkEntry = cdpState.getNetworkEntry;
    getResponseBody = cdpState.getResponseBody;
    getNetworkRequests = cdpState.getNetworkRequests;
    getNetworkCaptureStatus = cdpState.getNetworkCaptureStatus;
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
    cdpState.getResponseBody.mockReset();
    cdpState.getResponseBody.mockResolvedValue({
      success: false,
      error: "No resource with given identifier found",
    });
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

  it("reports capture interruptions as they stood before reading re-enables capture", async () => {
    const handleMessage = await loadHandleMessage();
    const capture = { active: false, interruptions: [{ reason: "target_closed", at: 1 }] };
    cdpState.getNetworkCaptureStatus.mockReturnValue(capture);
    cdpState.enableNetworkTracking.mockImplementation(() => {
      cdpState.getNetworkCaptureStatus.mockReturnValue({ ...capture, active: true });
    });
    const result = await handleMessage(
      { type: "READ_NETWORK_REQUESTS", tabId: 42, full: true },
      {},
    );
    expect(result).toMatchObject({ entries: [], capture });
  });

  const readIds = async (message: Record<string, unknown>) => {
    const handleMessage = await loadHandleMessage();
    const result = await handleMessage(
      { type: "READ_NETWORK_REQUESTS", tabId: 42, ...message },
      {},
    );
    return (result.requests || result.entries).map((item: { id: string }) => item.id);
  };

  it("filters --type by response MIME type, keeping resource types working", async () => {
    const requests = [
      { id: "r_1", url: "https://example.test/", type: "Document", mimeType: "text/html" },
      { id: "r_2", url: "https://example.test/api", type: "XHR", mimeType: "application/json" },
      { id: "r_3", url: "https://example.test/ld", type: "Fetch", mimeType: "application/ld+json" },
      {
        id: "r_4",
        url: "https://example.test/app.js",
        type: "Script",
        mimeType: "text/javascript",
      },
      {
        id: "r_5",
        url: "https://example.test/rpc",
        type: "Fetch",
        mimeType: "application/x-protobuf",
      },
    ];
    cdpState.getNetworkRequests.mockReturnValue(requests);
    cdpState.entries = requests;
    const cases: Array<[Record<string, unknown>, string[]]> = [
      [{ contentType: "json" }, ["r_2", "r_3"]],
      [{ contentType: "json", full: true }, ["r_2", "r_3"]],
      [{ contentType: "html" }, ["r_1"]],
      [{ contentType: "proto" }, ["r_5"]],
      [{ contentType: "Document" }, ["r_1"]],
      [{ contentType: "xhr" }, ["r_2"]],
      [{ contentType: "application/json" }, ["r_2"]],
      [{ contentType: "javascript" }, ["r_4"]],
    ];
    for (const [message, ids] of cases) {
      expect(await readIds(message)).toEqual(ids);
    }
  });

  it("reads static responses too when asked, so a POST answered with JavaScript isn't dropped", async () => {
    await readIds({ full: true, includeStatic: true });
    expect(cdpState.getNetworkEntries).toHaveBeenLastCalledWith(
      42,
      expect.objectContaining({ includeStatic: true }),
    );
  });

  it("filters requests before cutting the list to its limit", async () => {
    const requests = Array.from({ length: 150 }, (_, index) => ({
      id: `r_${index}`,
      url: `https://example.test/${index}`,
      method: index === 0 ? "POST" : "GET",
      type: index === 0 ? "XHR" : "Document",
      mimeType: index === 0 ? "application/json" : "text/html",
    }));
    // Like the controller, keep the newest `limit` requests.
    cdpState.getNetworkRequests.mockImplementation((_tab, options = {}) =>
      options.limit ? requests.slice(-options.limit) : requests,
    );
    expect(await readIds({ contentType: "json" })).toEqual(["r_0"]);
    expect(await readIds({ method: "POST" })).toEqual(["r_0"]);
    expect(await readIds({ contentType: "html", limit: 2 })).toEqual(["r_148", "r_149"]);
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

  it("returns a stored response body after Chrome has evicted it", async () => {
    const handleMessage = await loadHandleMessage();
    cdpState.entries = [
      { id: "r_1", _requestId: "cdp-1", responseBody: "AAEC", responseBodyEncoding: "base64" },
    ];
    await expect(
      handleMessage({ type: "GET_RESPONSE_BODY", tabId: 42, requestId: "r_1" }, {}),
    ).resolves.toEqual({ success: true, body: "AAEC", base64Encoded: true });
  });

  it("explains why a body is gone and how to get it", async () => {
    const handleMessage = await loadHandleMessage();
    cdpState.entries = [
      {
        id: "r_2",
        _requestId: "cdp-2",
        bodyCapture: {
          mode: "text",
          complete: false,
          reason: "per-body-cap",
          sizeBytes: 90000,
          limitBytes: 65536,
        },
      },
    ];
    const result = await handleMessage(
      { type: "GET_RESPONSE_BODY", tabId: 42, requestId: "r_2" },
      {},
    );
    expect(result.success).toBe(false);
    expect(result.body).toBeUndefined();
    expect(result.error).toContain("No resource with given identifier found");
    expect(result.error).toContain("90000 bytes, over the 65536-byte per-body cap");
    expect(result.error).toContain("--per-body-bytes");
    expect(result.error).toContain("network.wait");
  });
});
