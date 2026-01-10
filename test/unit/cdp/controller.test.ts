import { vi } from "vitest";
import { CDPController } from "../../../src/cdp/controller";

// Mock chrome.debugger API
const mockChrome = {
  debugger: {
    attach: vi.fn(),
    detach: vi.fn(),
    sendCommand: vi.fn(),
    onEvent: { addListener: vi.fn(), removeListener: vi.fn() },
    onDetach: { addListener: vi.fn(), removeListener: vi.fn() },
  },
};

// Set global chrome before tests
vi.stubGlobal("chrome", mockChrome);

describe("CDPController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parseModifiers", () => {
    let controller: CDPController;

    beforeEach(() => {
      controller = new CDPController();
    });

    it("returns 0 for undefined input", () => {
      expect(controller.parseModifiers(undefined)).toBe(0);
    });

    it("returns 0 for empty string", () => {
      expect(controller.parseModifiers("")).toBe(0);
    });

    it("parses single modifier 'shift'", () => {
      expect(controller.parseModifiers("shift")).toBe(8);
    });

    it("parses single modifier 'ctrl'", () => {
      expect(controller.parseModifiers("ctrl")).toBe(2);
    });

    it("parses single modifier 'alt'", () => {
      expect(controller.parseModifiers("alt")).toBe(1);
    });

    it("parses single modifier 'meta'", () => {
      expect(controller.parseModifiers("meta")).toBe(4);
    });

    it("parses combined modifiers 'ctrl+shift'", () => {
      // ctrl=2, shift=8, combined=10
      expect(controller.parseModifiers("ctrl+shift")).toBe(10);
    });

    it("parses combined modifiers 'alt+shift+ctrl'", () => {
      // alt=1, ctrl=2, shift=8, combined=11
      expect(controller.parseModifiers("alt+shift+ctrl")).toBe(11);
    });

    it("handles case insensitivity", () => {
      expect(controller.parseModifiers("SHIFT")).toBe(8);
      expect(controller.parseModifiers("Ctrl")).toBe(2);
    });

    it("handles aliases for ctrl", () => {
      expect(controller.parseModifiers("control")).toBe(2);
    });

    it("handles aliases for meta", () => {
      expect(controller.parseModifiers("cmd")).toBe(4);
      expect(controller.parseModifiers("command")).toBe(4);
      expect(controller.parseModifiers("win")).toBe(4);
      expect(controller.parseModifiers("windows")).toBe(4);
    });

    it("ignores unknown modifiers", () => {
      expect(controller.parseModifiers("unknown")).toBe(0);
      expect(controller.parseModifiers("ctrl+unknown")).toBe(2);
    });
  });

  describe("getConsoleMessages", () => {
    let controller: CDPController;
    const tabId = 123;

    beforeEach(() => {
      controller = new CDPController();
      // Clear console messages returns empty array for unknown tab
    });

    it("returns empty array for tab with no messages", () => {
      const messages = controller.getConsoleMessages(tabId);
      expect(messages).toStrictEqual([]);
    });

    it("returns empty array after clearing messages", () => {
      controller.clearConsoleMessages(tabId);
      const messages = controller.getConsoleMessages(tabId);
      expect(messages).toStrictEqual([]);
    });
  });

  describe("getNetworkRequests", () => {
    let controller: CDPController;
    const tabId = 456;

    beforeEach(() => {
      controller = new CDPController();
    });

    it("returns empty array for tab with no requests", () => {
      const requests = controller.getNetworkRequests(tabId);
      expect(requests).toStrictEqual([]);
    });

    it("returns empty array after clearing requests", () => {
      controller.clearNetworkRequests(tabId);
      const requests = controller.getNetworkRequests(tabId);
      expect(requests).toStrictEqual([]);
    });
  });

  describe("getDialogInfo", () => {
    let controller: CDPController;
    const tabId = 789;

    beforeEach(() => {
      controller = new CDPController();
    });

    it("returns null when no dialog is pending", () => {
      const dialog = controller.getDialogInfo(tabId);
      expect(dialog).toBeNull();
    });
  });

  describe("attach", () => {
    let controller: CDPController;
    const tabId = 100;

    beforeEach(() => {
      controller = new CDPController();
      mockChrome.debugger.attach.mockResolvedValue(undefined);
      mockChrome.debugger.sendCommand.mockResolvedValue({});
    });

    it("attaches debugger to tab", async () => {
      await controller.attach(tabId);

      expect(mockChrome.debugger.attach).toHaveBeenCalledWith({ tabId }, "1.3");
    });

    it("enables Page domain after attaching", async () => {
      await controller.attach(tabId);

      expect(mockChrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId },
        "Page.enable",
        undefined,
      );
    });

    it("does not attach twice to same tab", async () => {
      await controller.attach(tabId);
      await controller.attach(tabId);

      expect(mockChrome.debugger.attach).toHaveBeenCalledTimes(1);
    });

    it("throws descriptive error for restricted pages", async () => {
      mockChrome.debugger.attach.mockRejectedValue(new Error("Cannot access a chrome:// URL"));

      let error: Error | undefined;
      try {
        await controller.attach(tabId);
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
      expect(error?.message).toContain("Cannot control this page");
    });

    it("throws descriptive error when attach fails", async () => {
      mockChrome.debugger.attach.mockRejectedValue(new Error("Some other error"));

      let error: Error | undefined;
      try {
        await controller.attach(tabId);
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
      expect(error?.message).toBe("Failed to attach debugger: Some other error");
    });
  });

  describe("detach", () => {
    let controller: CDPController;
    const tabId = 200;

    beforeEach(() => {
      controller = new CDPController();
      mockChrome.debugger.attach.mockResolvedValue(undefined);
      mockChrome.debugger.detach.mockResolvedValue(undefined);
      mockChrome.debugger.sendCommand.mockResolvedValue({});
    });

    it("detaches debugger from attached tab", async () => {
      await controller.attach(tabId);
      await controller.detach(tabId);

      expect(mockChrome.debugger.detach).toHaveBeenCalledWith({ tabId });
    });

    it("does nothing for tab that was never attached", async () => {
      await controller.detach(tabId);

      expect(mockChrome.debugger.detach).not.toHaveBeenCalled();
    });

    it("clears tab data after detaching", async () => {
      await controller.attach(tabId);
      await controller.detach(tabId);

      // After detach, getConsoleMessages returns empty
      expect(controller.getConsoleMessages(tabId)).toStrictEqual([]);
      expect(controller.getNetworkRequests(tabId)).toStrictEqual([]);
    });
  });

  describe("detachAll", () => {
    let controller: CDPController;

    beforeEach(() => {
      controller = new CDPController();
      mockChrome.debugger.attach.mockResolvedValue(undefined);
      mockChrome.debugger.detach.mockResolvedValue(undefined);
      mockChrome.debugger.sendCommand.mockResolvedValue({});
    });

    it("detaches all attached tabs", async () => {
      await controller.attach(301);
      await controller.attach(302);
      await controller.attach(303);

      await controller.detachAll();

      expect(mockChrome.debugger.detach).toHaveBeenCalledTimes(3);
    });
  });

  describe("emulateNetwork", () => {
    let controller: CDPController;
    const tabId = 400;

    beforeEach(() => {
      controller = new CDPController();
      mockChrome.debugger.attach.mockResolvedValue(undefined);
      mockChrome.debugger.sendCommand.mockResolvedValue({});
    });

    it("returns error for unknown preset", async () => {
      const result = await controller.emulateNetwork(tabId, "unknown-preset");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown preset");
    });

    it("applies offline preset", async () => {
      const result = await controller.emulateNetwork(tabId, "offline");

      expect(result.success).toBe(true);
      expect(mockChrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId },
        "Network.emulateNetworkConditions",
        { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
      );
    });

    it("applies slow-3g preset", async () => {
      const result = await controller.emulateNetwork(tabId, "slow-3g");

      expect(result.success).toBe(true);
      expect(mockChrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId },
        "Network.emulateNetworkConditions",
        { offline: false, latency: 2000, downloadThroughput: 50000, uploadThroughput: 50000 },
      );
    });

    it("applies reset preset", async () => {
      const result = await controller.emulateNetwork(tabId, "reset");

      expect(result.success).toBe(true);
      expect(mockChrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId },
        "Network.emulateNetworkConditions",
        { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
      );
    });
  });

  describe("emulateCPU", () => {
    let controller: CDPController;
    const tabId = 500;

    beforeEach(() => {
      controller = new CDPController();
      mockChrome.debugger.attach.mockResolvedValue(undefined);
      mockChrome.debugger.sendCommand.mockResolvedValue({});
    });

    it("returns error for rate less than 1", async () => {
      const result = await controller.emulateCPU(tabId, 0.5);

      expect(result.success).toBe(false);
      expect(result.error).toContain("rate must be >= 1");
    });

    it("applies cpu throttling rate", async () => {
      const result = await controller.emulateCPU(tabId, 4);

      expect(result.success).toBe(true);
      expect(mockChrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId },
        "Emulation.setCPUThrottlingRate",
        { rate: 4 },
      );
    });
  });

  describe("emulateGeolocation", () => {
    let controller: CDPController;
    const tabId = 600;

    beforeEach(() => {
      controller = new CDPController();
      mockChrome.debugger.attach.mockResolvedValue(undefined);
      mockChrome.debugger.sendCommand.mockResolvedValue({});
    });

    it("sets geolocation with default accuracy", async () => {
      const result = await controller.emulateGeolocation(tabId, 37.7749, -122.4194);

      expect(result.success).toBe(true);
      expect(mockChrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId },
        "Emulation.setGeolocationOverride",
        { latitude: 37.7749, longitude: -122.4194, accuracy: 100 },
      );
    });

    it("sets geolocation with custom accuracy", async () => {
      const result = await controller.emulateGeolocation(tabId, 51.5074, -0.1278, 50);

      expect(result.success).toBe(true);
      expect(mockChrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId },
        "Emulation.setGeolocationOverride",
        { latitude: 51.5074, longitude: -0.1278, accuracy: 50 },
      );
    });
  });

  describe("clearGeolocation", () => {
    let controller: CDPController;
    const tabId = 700;

    beforeEach(() => {
      controller = new CDPController();
      mockChrome.debugger.attach.mockResolvedValue(undefined);
      mockChrome.debugger.sendCommand.mockResolvedValue({});
    });

    it("clears geolocation override", async () => {
      const result = await controller.clearGeolocation(tabId);

      expect(result.success).toBe(true);
      expect(mockChrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId },
        "Emulation.clearGeolocationOverride",
        undefined,
      );
    });
  });

  describe("getViewportSize", () => {
    let controller: CDPController;
    const tabId = 800;

    beforeEach(() => {
      controller = new CDPController();
      mockChrome.debugger.attach.mockResolvedValue(undefined);
    });

    it("returns viewport dimensions from visualViewport", async () => {
      mockChrome.debugger.sendCommand.mockResolvedValue({
        visualViewport: { clientWidth: 1280, clientHeight: 720 },
      });

      const result = await controller.getViewportSize(tabId);

      expect(result).toStrictEqual({ width: 1280, height: 720 });
    });

    it("falls back to layoutViewport", async () => {
      mockChrome.debugger.sendCommand.mockResolvedValue({
        layoutViewport: { clientWidth: 1024, clientHeight: 768 },
      });

      const result = await controller.getViewportSize(tabId);

      expect(result).toStrictEqual({ width: 1024, height: 768 });
    });

    it("rounds dimensions to integers", async () => {
      mockChrome.debugger.sendCommand.mockResolvedValue({
        visualViewport: { clientWidth: 1280.5, clientHeight: 720.7 },
      });

      const result = await controller.getViewportSize(tabId);

      expect(result).toStrictEqual({ width: 1281, height: 721 });
    });
  });

  describe("captureScreenshot", () => {
    let controller: CDPController;
    const tabId = 900;

    beforeEach(() => {
      controller = new CDPController();
      mockChrome.debugger.attach.mockResolvedValue(undefined);
    });

    it("captures screenshot and returns base64 with dimensions", async () => {
      mockChrome.debugger.sendCommand
        .mockResolvedValueOnce({}) // Page.enable from attach
        .mockResolvedValueOnce({ data: "base64imagedata" }) // captureScreenshot
        .mockResolvedValueOnce({
          visualViewport: { clientWidth: 1920, clientHeight: 1080 },
        }); // getLayoutMetrics

      const result = await controller.captureScreenshot(tabId);

      expect(result.base64).toBe("base64imagedata");
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
    });

    it("calls Page.captureScreenshot with png format", async () => {
      mockChrome.debugger.sendCommand
        .mockResolvedValueOnce({}) // Page.enable
        .mockResolvedValueOnce({ data: "base64" })
        .mockResolvedValueOnce({
          visualViewport: { clientWidth: 800, clientHeight: 600 },
        });

      await controller.captureScreenshot(tabId);

      expect(mockChrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId },
        "Page.captureScreenshot",
        { format: "png", captureBeyondViewport: false },
      );
    });
  });

  describe("captureRegion", () => {
    let controller: CDPController;
    const tabId = 1000;

    beforeEach(() => {
      controller = new CDPController();
      mockChrome.debugger.attach.mockResolvedValue(undefined);
      mockChrome.debugger.sendCommand
        .mockResolvedValueOnce({}) // Page.enable
        .mockResolvedValueOnce({ data: "regiondata" }); // captureScreenshot
    });

    it("captures region with clip parameters", async () => {
      const result = await controller.captureRegion(tabId, 100, 200, 300, 400);

      expect(result.base64).toBe("regiondata");
      expect(result.width).toBe(300);
      expect(result.height).toBe(400);
      expect(mockChrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId },
        "Page.captureScreenshot",
        { format: "png", clip: { x: 100, y: 200, width: 300, height: 400, scale: 1 } },
      );
    });
  });

  describe("hover", () => {
    let controller: CDPController;
    const tabId = 1100;

    beforeEach(() => {
      controller = new CDPController();
      mockChrome.debugger.attach.mockResolvedValue(undefined);
      mockChrome.debugger.sendCommand.mockResolvedValue({});
    });

    it("dispatches mouseMoved event", async () => {
      await controller.hover(tabId, 150, 250);

      expect(mockChrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId },
        "Input.dispatchMouseEvent",
        expect.objectContaining({
          type: "mouseMoved",
          x: 150,
          y: 250,
          button: "none",
        }),
      );
    });
  });

  describe("scroll", () => {
    let controller: CDPController;
    const tabId = 1200;

    beforeEach(() => {
      controller = new CDPController();
      mockChrome.debugger.attach.mockResolvedValue(undefined);
      mockChrome.debugger.sendCommand.mockResolvedValue({});
    });

    it("dispatches mouseWheel event with deltas", async () => {
      await controller.scroll(tabId, 100, 200, 0, 300);

      expect(mockChrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId },
        "Input.dispatchMouseEvent",
        expect.objectContaining({
          type: "mouseWheel",
          x: 100,
          y: 200,
          deltaX: 0,
          deltaY: 300,
        }),
      );
    });
  });

  describe("evaluateScript", () => {
    let controller: CDPController;
    const tabId = 1300;

    beforeEach(() => {
      controller = new CDPController();
      mockChrome.debugger.attach.mockResolvedValue(undefined);
    });

    it("evaluates expression and returns result", async () => {
      mockChrome.debugger.sendCommand
        .mockResolvedValueOnce({}) // Page.enable
        .mockResolvedValueOnce({}) // Runtime.enable
        .mockResolvedValueOnce({
          result: { value: 42, type: "number" },
        });

      const result = await controller.evaluateScript(tabId, "21 + 21");

      expect(result.result?.value).toBe(42);
      expect(mockChrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId },
        "Runtime.evaluate",
        expect.objectContaining({
          expression: "21 + 21",
          returnByValue: true,
          awaitPromise: true,
        }),
      );
    });

    it("returns exception details on error", async () => {
      mockChrome.debugger.sendCommand
        .mockResolvedValueOnce({}) // Page.enable
        .mockResolvedValueOnce({}) // Runtime.enable
        .mockResolvedValueOnce({
          exceptionDetails: { text: "ReferenceError: x is not defined" },
        });

      const result = await controller.evaluateScript(tabId, "x");

      expect(result.exceptionDetails?.text).toBe("ReferenceError: x is not defined");
    });
  });

  describe("sendCommand", () => {
    let controller: CDPController;
    const tabId = 1400;

    beforeEach(() => {
      controller = new CDPController();
      mockChrome.debugger.attach.mockResolvedValue(undefined);
      mockChrome.debugger.sendCommand.mockResolvedValue({ result: "test" });
    });

    it("sends arbitrary CDP command", async () => {
      const result = await controller.sendCommand(tabId, "DOM.getDocument", { depth: 1 });

      expect(result).toStrictEqual({ result: "test" });
      expect(mockChrome.debugger.sendCommand).toHaveBeenCalledWith({ tabId }, "DOM.getDocument", {
        depth: 1,
      });
    });
  });

  describe("click", () => {
    let controller: CDPController;
    const tabId = 1500;

    beforeEach(() => {
      controller = new CDPController();
      mockChrome.debugger.attach.mockResolvedValue(undefined);
      mockChrome.debugger.sendCommand.mockResolvedValue({});
    });

    it("dispatches mouse move, press, and release events", async () => {
      await controller.click(tabId, 100, 200);

      const calls = mockChrome.debugger.sendCommand.mock.calls.filter(
        (call) => call[1] === "Input.dispatchMouseEvent",
      );

      // Should have: mouseMoved, mousePressed, mouseReleased
      expect(calls.length).toBeGreaterThanOrEqual(3);

      // Check mouseMoved
      const moveCall = calls.find((c) => c[2].type === "mouseMoved");
      expect(moveCall).toBeDefined();
      expect(moveCall?.[2].x).toBe(100);
      expect(moveCall?.[2].y).toBe(200);

      // Check mousePressed
      const pressCall = calls.find((c) => c[2].type === "mousePressed");
      expect(pressCall).toBeDefined();
      expect(pressCall?.[2].button).toBe("left");

      // Check mouseReleased
      const releaseCall = calls.find((c) => c[2].type === "mouseReleased");
      expect(releaseCall).toBeDefined();
    });

    it("uses specified button", async () => {
      await controller.click(tabId, 50, 50, "right");

      const pressCall = mockChrome.debugger.sendCommand.mock.calls.find(
        (call) => call[1] === "Input.dispatchMouseEvent" && call[2].type === "mousePressed",
      );

      expect(pressCall?.[2].button).toBe("right");
    });
  });

  describe("rightClick", () => {
    let controller: CDPController;
    const tabId = 1600;

    beforeEach(() => {
      controller = new CDPController();
      mockChrome.debugger.attach.mockResolvedValue(undefined);
      mockChrome.debugger.sendCommand.mockResolvedValue({});
    });

    it("clicks with right button", async () => {
      await controller.rightClick(tabId, 100, 200);

      const pressCall = mockChrome.debugger.sendCommand.mock.calls.find(
        (call) => call[1] === "Input.dispatchMouseEvent" && call[2].type === "mousePressed",
      );

      expect(pressCall?.[2].button).toBe("right");
    });
  });

  describe("doubleClick", () => {
    let controller: CDPController;
    const tabId = 1700;

    beforeEach(() => {
      controller = new CDPController();
      mockChrome.debugger.attach.mockResolvedValue(undefined);
      mockChrome.debugger.sendCommand.mockResolvedValue({});
    });

    it("clicks twice with clickCount 2", async () => {
      await controller.doubleClick(tabId, 100, 200);

      const pressCalls = mockChrome.debugger.sendCommand.mock.calls.filter(
        (call) => call[1] === "Input.dispatchMouseEvent" && call[2].type === "mousePressed",
      );

      // Should have 2 press events for double click
      expect(pressCalls.length).toBe(2);
      expect(pressCalls[1]?.[2].clickCount).toBe(2);
    });
  });

  describe("pressKey", () => {
    let controller: CDPController;
    const tabId = 1800;

    beforeEach(() => {
      controller = new CDPController();
      mockChrome.debugger.attach.mockResolvedValue(undefined);
      mockChrome.debugger.sendCommand.mockResolvedValue({});
    });

    it("dispatches keyDown and keyUp events for Enter", async () => {
      await controller.pressKey(tabId, "Enter");

      const calls = mockChrome.debugger.sendCommand.mock.calls.filter(
        (call) => call[1] === "Input.dispatchKeyEvent",
      );

      expect(calls.length).toBe(2);

      const keyDown = calls.find((c) => c[2].type === "keyDown");
      expect(keyDown?.[2].key).toBe("Enter");
      expect(keyDown?.[2].code).toBe("Enter");

      const keyUp = calls.find((c) => c[2].type === "keyUp");
      expect(keyUp?.[2].key).toBe("Enter");
    });

    it("dispatches events for regular character", async () => {
      await controller.pressKey(tabId, "a");

      const keyDown = mockChrome.debugger.sendCommand.mock.calls.find(
        (call) => call[1] === "Input.dispatchKeyEvent" && call[2].type === "keyDown",
      );

      expect(keyDown?.[2].key).toBe("a");
      expect(keyDown?.[2].code).toBe("KeyA");
      expect(keyDown?.[2].text).toBe("a");
    });

    it("throws error for unknown key", async () => {
      let error: Error | undefined;
      try {
        await controller.pressKey(tabId, "UnknownSpecialKey");
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
      expect(error?.message).toContain("Unknown key");
    });
  });

  describe("pressKeyChord", () => {
    let controller: CDPController;
    const tabId = 1900;

    beforeEach(() => {
      controller = new CDPController();
      mockChrome.debugger.attach.mockResolvedValue(undefined);
      mockChrome.debugger.sendCommand.mockResolvedValue({});
    });

    it("parses and applies modifiers for ctrl+a", async () => {
      await controller.pressKeyChord(tabId, "ctrl+a");

      const keyDown = mockChrome.debugger.sendCommand.mock.calls.find(
        (call) => call[1] === "Input.dispatchKeyEvent" && call[2].type === "keyDown",
      );

      expect(keyDown?.[2].key).toBe("a");
      expect(keyDown?.[2].modifiers).toBe(2); // ctrl = 2
    });

    it("handles multiple modifiers", async () => {
      await controller.pressKeyChord(tabId, "ctrl+shift+a");

      const keyDown = mockChrome.debugger.sendCommand.mock.calls.find(
        (call) => call[1] === "Input.dispatchKeyEvent" && call[2].type === "keyDown",
      );

      expect(keyDown?.[2].modifiers).toBe(10); // ctrl=2 + shift=8
    });
  });

  describe("drag", () => {
    let controller: CDPController;
    const tabId = 2000;

    beforeEach(() => {
      controller = new CDPController();
      mockChrome.debugger.attach.mockResolvedValue(undefined);
      mockChrome.debugger.sendCommand.mockResolvedValue({});
    });

    it("performs drag from start to end coordinates", async () => {
      await controller.drag(tabId, 100, 100, 200, 200);

      const calls = mockChrome.debugger.sendCommand.mock.calls.filter(
        (call) => call[1] === "Input.dispatchMouseEvent",
      );

      // Should have: initial move, press, move to end, release
      expect(calls.length).toBeGreaterThanOrEqual(4);

      // Check press at start
      const pressCall = calls.find((c) => c[2].type === "mousePressed");
      expect(pressCall?.[2].x).toBe(100);
      expect(pressCall?.[2].y).toBe(100);

      // Check release at end
      const releaseCall = calls.find((c) => c[2].type === "mouseReleased");
      expect(releaseCall?.[2].x).toBe(200);
      expect(releaseCall?.[2].y).toBe(200);
    });
  });

  describe("subscribeToConsole", () => {
    let controller: CDPController;
    const tabId = 2100;

    beforeEach(() => {
      controller = new CDPController();
    });

    it("registers callback for stream", () => {
      const callback = vi.fn();
      controller.subscribeToConsole(tabId, 1, callback);

      // No error means success - callback is stored internally
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("unsubscribeFromConsole", () => {
    let controller: CDPController;
    const tabId = 2200;

    beforeEach(() => {
      controller = new CDPController();
    });

    it("removes callback without error", () => {
      const callback = vi.fn();
      controller.subscribeToConsole(tabId, 1, callback);
      controller.unsubscribeFromConsole(tabId, 1);

      // No error means success
      expect(true).toBe(true);
    });

    it("handles unsubscribe for non-existent stream", () => {
      // Should not throw
      controller.unsubscribeFromConsole(tabId, 999);
      expect(true).toBe(true);
    });
  });

  describe("subscribeToNetwork", () => {
    let controller: CDPController;
    const tabId = 2300;

    beforeEach(() => {
      controller = new CDPController();
    });

    it("registers callback for stream", () => {
      const callback = vi.fn();
      controller.subscribeToNetwork(tabId, 1, callback);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("unsubscribeFromNetwork", () => {
    let controller: CDPController;
    const tabId = 2400;

    beforeEach(() => {
      controller = new CDPController();
    });

    it("removes callback without error", () => {
      const callback = vi.fn();
      controller.subscribeToNetwork(tabId, 1, callback);
      controller.unsubscribeFromNetwork(tabId, 1);

      expect(true).toBe(true);
    });
  });

  describe("enableConsoleTracking", () => {
    let controller: CDPController;
    const tabId = 2500;

    beforeEach(() => {
      controller = new CDPController();
      mockChrome.debugger.attach.mockResolvedValue(undefined);
      mockChrome.debugger.sendCommand.mockResolvedValue({});
    });

    it("enables Runtime domain", async () => {
      await controller.enableConsoleTracking(tabId);

      expect(mockChrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId },
        "Runtime.enable",
        undefined,
      );
    });
  });

  describe("enableNetworkTracking", () => {
    let controller: CDPController;
    const tabId = 2600;

    beforeEach(() => {
      controller = new CDPController();
      mockChrome.debugger.attach.mockResolvedValue(undefined);
      mockChrome.debugger.sendCommand.mockResolvedValue({});
    });

    it("enables Network domain with maxPostDataSize", async () => {
      await controller.enableNetworkTracking(tabId);

      expect(mockChrome.debugger.sendCommand).toHaveBeenCalledWith({ tabId }, "Network.enable", {
        maxPostDataSize: 65536,
      });
    });
  });

  describe("handleDialog", () => {
    let controller: CDPController;
    const tabId = 2700;

    beforeEach(() => {
      controller = new CDPController();
      mockChrome.debugger.attach.mockResolvedValue(undefined);
      mockChrome.debugger.sendCommand.mockResolvedValue({});
    });

    it("accepts dialog", async () => {
      await controller.attach(tabId);
      const result = await controller.handleDialog(tabId, true);

      expect(result.success).toBe(true);
      expect(mockChrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId },
        "Page.handleJavaScriptDialog",
        { accept: true, promptText: undefined },
      );
    });

    it("dismisses dialog", async () => {
      await controller.attach(tabId);
      const result = await controller.handleDialog(tabId, false);

      expect(result.success).toBe(true);
      expect(mockChrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId },
        "Page.handleJavaScriptDialog",
        { accept: false, promptText: undefined },
      );
    });

    it("accepts prompt with text", async () => {
      await controller.attach(tabId);
      const result = await controller.handleDialog(tabId, true, "user input");

      expect(result.success).toBe(true);
      expect(mockChrome.debugger.sendCommand).toHaveBeenCalledWith(
        { tabId },
        "Page.handleJavaScriptDialog",
        { accept: true, promptText: "user input" },
      );
    });

    it("returns error on failure", async () => {
      await controller.attach(tabId);
      mockChrome.debugger.sendCommand.mockRejectedValueOnce(new Error("No dialog"));

      const result = await controller.handleDialog(tabId, true);

      expect(result.success).toBe(false);
      expect(result.error).toContain("No dialog");
    });
  });

  describe("getNetworkEntries", () => {
    let controller: CDPController;
    const tabId = 2800;

    beforeEach(() => {
      controller = new CDPController();
    });

    it("returns empty array for tab with no entries", () => {
      const entries = controller.getNetworkEntries(tabId);
      expect(entries).toStrictEqual([]);
    });
  });
});
