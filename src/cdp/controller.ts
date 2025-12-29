type Debuggee = chrome.debugger.Debuggee;
type MouseButton = "left" | "right" | "middle" | "none";

interface ConsoleMessage {
  type: string;
  text: string;
  timestamp: number;
  url?: string;
  line?: number;
}

interface NetworkRequest {
  requestId: string;
  url: string;
  method: string;
  status?: number;
  type?: string;
  timestamp: number;
}

interface PendingDialog {
  type: "alert" | "confirm" | "prompt" | "beforeunload";
  message: string;
  defaultPrompt?: string;
  timestamp: number;
}

type ConsoleEventCallback = (event: ConsoleMessage) => void;
type NetworkEventCallback = (event: {
  method: string;
  url: string;
  status?: number;
  duration?: number;
  timestamp: number;
}) => void;

const MODIFIERS = {
  alt: 1,
  ctrl: 2,
  control: 2,
  meta: 4,
  cmd: 4,
  command: 4,
  win: 4,
  windows: 4,
  shift: 8,
} as const;

interface KeyDefinition {
  key: string;
  code: string;
  keyCode: number;
  text?: string;
  location?: number;
}

const KEY_DEFINITIONS: Record<string, KeyDefinition> = {
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  space: { key: " ", code: "Space", keyCode: 32, text: " " },
  f1: { key: "F1", code: "F1", keyCode: 112 },
  f2: { key: "F2", code: "F2", keyCode: 113 },
  f3: { key: "F3", code: "F3", keyCode: 114 },
  f4: { key: "F4", code: "F4", keyCode: 115 },
  f5: { key: "F5", code: "F5", keyCode: 116 },
  f6: { key: "F6", code: "F6", keyCode: 117 },
  f7: { key: "F7", code: "F7", keyCode: 118 },
  f8: { key: "F8", code: "F8", keyCode: 119 },
  f9: { key: "F9", code: "F9", keyCode: 120 },
  f10: { key: "F10", code: "F10", keyCode: 121 },
  f11: { key: "F11", code: "F11", keyCode: 122 },
  f12: { key: "F12", code: "F12", keyCode: 123 },
};

export class CDPController {
  private targets = new Map<number, Debuggee>();
  private consoleMessages: Map<number, ConsoleMessage[]> = new Map();
  private networkRequests: Map<number, NetworkRequest[]> = new Map();
  private consoleCallbacks: Map<number, Map<number, ConsoleEventCallback>> = new Map();
  private networkCallbacks: Map<number, Map<number, NetworkEventCallback>> = new Map();
  private networkRequestStartTimes: Map<string, number> = new Map();
  private pendingDialogs: Map<number, PendingDialog> = new Map();
  private static debuggerListenerRegistered = false;

  async attach(tabId: number): Promise<void> {
    if (this.targets.has(tabId)) return;
    
    const target: Debuggee = { tabId };
    try {
      await chrome.debugger.attach(target, "1.3");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Cannot access") || message.includes("Cannot attach")) {
        throw new Error(`Cannot control this page. Chrome restricts automation on chrome://, extensions, and web store pages.`);
      }
      throw new Error(`Failed to attach debugger: ${message}`);
    }
    this.targets.set(tabId, target);

    this.setupEventListener();
    this.consoleMessages.set(tabId, []);
    this.networkRequests.set(tabId, []);

    try {
      await this.send(tabId, "Page.enable");
    } catch (e) {}
  }

  async detach(tabId: number): Promise<void> {
    const target = this.targets.get(tabId);
    if (target) {
      try {
        await chrome.debugger.detach(target);
      } catch (e) {
        console.warn("[CDPController] Error detaching:", e);
      }
      this.targets.delete(tabId);
      this.consoleMessages.delete(tabId);
      this.networkRequests.delete(tabId);
      this.consoleCallbacks.delete(tabId);
      this.networkCallbacks.delete(tabId);
      this.pendingDialogs.delete(tabId);
    }
  }

  async detachAll(): Promise<void> {
    for (const tabId of this.targets.keys()) {
      await this.detach(tabId);
    }
  }

  private setupEventListener(): void {
    if (CDPController.debuggerListenerRegistered) return;
    CDPController.debuggerListenerRegistered = true;

    chrome.debugger.onEvent.addListener((source, method, params) => {
      const tabId = source.tabId;
      if (!tabId || !this.targets.has(tabId)) return;

      this.handleCDPEvent(tabId, method, params);
    });
  }

  private handleCDPEvent(tabId: number, method: string, params: any): void {
    switch (method) {
      case "Runtime.consoleAPICalled":
        this.handleRuntimeConsole(tabId, params);
        break;
      case "Runtime.exceptionThrown":
        this.handleRuntimeException(tabId, params);
        break;
      case "Network.requestWillBeSent":
        this.handleNetworkRequest(tabId, params);
        break;
      case "Network.responseReceived":
        this.handleNetworkResponse(tabId, params);
        break;
      case "Network.loadingFailed":
        this.handleNetworkFailed(tabId, params);
        break;
      case "Page.javascriptDialogOpening":
        this.handleDialogOpening(tabId, params);
        break;
      case "Page.javascriptDialogClosed":
        this.pendingDialogs.delete(tabId);
        break;
    }
  }

  private handleRuntimeConsole(tabId: number, params: any): void {
    const messages = this.consoleMessages.get(tabId) || [];
    const args = params.args || [];

    const text = args
      .map((a: any) => {
        if (a.value !== undefined) return String(a.value);
        if (a.description) return a.description;
        return "";
      })
      .join(" ");

    const callFrame = params.stackTrace?.callFrames?.[0];

    const msg: ConsoleMessage = {
      type: params.type || "log",
      text,
      timestamp: params.timestamp || Date.now(),
      url: callFrame?.url,
      line: callFrame?.lineNumber,
    };

    messages.push(msg);
    if (messages.length > 1000) messages.shift();
    this.consoleMessages.set(tabId, messages);

    const callbacks = this.consoleCallbacks.get(tabId);
    if (callbacks) {
      for (const cb of callbacks.values()) {
        cb(msg);
      }
    }
  }

  private handleRuntimeException(tabId: number, params: any): void {
    const messages = this.consoleMessages.get(tabId) || [];
    const details = params.exceptionDetails;
    if (!details) return;

    const msg: ConsoleMessage = {
      type: "exception",
      text: details.exception?.description || details.text || "Unknown exception",
      timestamp: details.timestamp || Date.now(),
      url: details.url,
      line: details.lineNumber,
    };

    messages.push(msg);
    if (messages.length > 1000) messages.shift();
    this.consoleMessages.set(tabId, messages);

    const callbacks = this.consoleCallbacks.get(tabId);
    if (callbacks) {
      for (const cb of callbacks.values()) {
        cb(msg);
      }
    }
  }

  private handleNetworkRequest(tabId: number, params: any): void {
    const requests = this.networkRequests.get(tabId) || [];
    const req = params.request;
    if (!req) return;

    const timestamp = params.timestamp || Date.now();
    this.networkRequestStartTimes.set(params.requestId, timestamp);

    requests.push({
      requestId: params.requestId,
      url: req.url,
      method: req.method,
      type: params.type,
      timestamp,
    });

    if (requests.length > 500) requests.shift();
    this.networkRequests.set(tabId, requests);
  }

  private handleNetworkResponse(tabId: number, params: any): void {
    const requests = this.networkRequests.get(tabId) || [];
    const existing = requests.find((r) => r.requestId === params.requestId);
    if (existing) {
      existing.status = params.response?.status;

      const callbacks = this.networkCallbacks.get(tabId);
      if (callbacks) {
        const startTime = this.networkRequestStartTimes.get(params.requestId);
        const now = Date.now();
        const duration = startTime ? Math.round(now - startTime) : undefined;
        this.networkRequestStartTimes.delete(params.requestId);

        for (const cb of callbacks.values()) {
          cb({
            method: existing.method,
            url: existing.url,
            status: existing.status,
            duration,
            timestamp: now,
          });
        }
      }
    }
  }

  private handleNetworkFailed(tabId: number, params: any): void {
    const requests = this.networkRequests.get(tabId) || [];
    const existing = requests.find((r) => r.requestId === params.requestId);
    if (existing && !existing.status) {
      existing.status = 0;

      const callbacks = this.networkCallbacks.get(tabId);
      if (callbacks) {
        const startTime = this.networkRequestStartTimes.get(params.requestId);
        const now = Date.now();
        const duration = startTime ? Math.round(now - startTime) : undefined;
        this.networkRequestStartTimes.delete(params.requestId);

        for (const cb of callbacks.values()) {
          cb({
            method: existing.method,
            url: existing.url,
            status: 0,
            duration,
            timestamp: now,
          });
        }
      }
    }
  }

  private handleDialogOpening(tabId: number, params: any): void {
    this.pendingDialogs.set(tabId, {
      type: params.type,
      message: params.message,
      defaultPrompt: params.defaultPrompt,
      timestamp: Date.now(),
    });
  }

  async enableConsoleTracking(tabId: number): Promise<void> {
    await this.ensureAttached(tabId);
    try {
      await this.send(tabId, "Runtime.enable");
    } catch (e) {}
  }

  async enableNetworkTracking(tabId: number): Promise<void> {
    await this.ensureAttached(tabId);
    try {
      await this.send(tabId, "Network.enable", { maxPostDataSize: 65536 });
    } catch (e) {}
  }

  async enablePageEvents(tabId: number): Promise<void> {
    await this.ensureAttached(tabId);
    try {
      await this.send(tabId, "Page.enable");
    } catch (e) {}
  }

  async handleDialog(tabId: number, accept: boolean, promptText?: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.send(tabId, "Page.handleJavaScriptDialog", {
        accept,
        promptText,
      });
      this.pendingDialogs.delete(tabId);
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  getDialogInfo(tabId: number): PendingDialog | null {
    return this.pendingDialogs.get(tabId) || null;
  }

  async emulateNetwork(tabId: number, preset: string): Promise<{ success: boolean; error?: string }> {
    await this.ensureAttached(tabId);
    const presets: Record<string, { offline: boolean; latency: number; downloadThroughput: number; uploadThroughput: number }> = {
      "offline": { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
      "slow-3g": { offline: false, latency: 2000, downloadThroughput: 50000, uploadThroughput: 50000 },
      "fast-3g": { offline: false, latency: 562.5, downloadThroughput: 180000, uploadThroughput: 84375 },
      "4g": { offline: false, latency: 100, downloadThroughput: 4000000, uploadThroughput: 3000000 },
      "reset": { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
    };
    const config = presets[preset.toLowerCase().replace(/\s+/g, "-")];
    if (!config) {
      return { success: false, error: `Unknown preset: ${preset}. Available: ${Object.keys(presets).join(", ")}` };
    }
    try {
      await this.send(tabId, "Network.enable");
      await this.send(tabId, "Network.emulateNetworkConditions", config);
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async emulateCPU(tabId: number, rate: number): Promise<{ success: boolean; error?: string }> {
    await this.ensureAttached(tabId);
    if (rate < 1) {
      return { success: false, error: "CPU throttling rate must be >= 1 (1 = no throttle, 4 = 4x slower)" };
    }
    try {
      await this.send(tabId, "Emulation.setCPUThrottlingRate", { rate });
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async emulateGeolocation(tabId: number, latitude: number, longitude: number, accuracy?: number): Promise<{ success: boolean; error?: string }> {
    await this.ensureAttached(tabId);
    try {
      await this.send(tabId, "Emulation.setGeolocationOverride", {
        latitude,
        longitude,
        accuracy: accuracy || 100,
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async clearGeolocation(tabId: number): Promise<{ success: boolean; error?: string }> {
    await this.ensureAttached(tabId);
    try {
      await this.send(tabId, "Emulation.clearGeolocationOverride");
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  getConsoleMessages(
    tabId: number,
    options?: {
      onlyErrors?: boolean;
      pattern?: string;
      limit?: number;
    }
  ): ConsoleMessage[] {
    let messages = this.consoleMessages.get(tabId) || [];

    if (options?.onlyErrors) {
      messages = messages.filter((m) => m.type === "error" || m.type === "exception");
    }
    if (options?.pattern) {
      try {
        const regex = new RegExp(options.pattern, "i");
        messages = messages.filter((m) => regex.test(m.text));
      } catch (e) {
        messages = messages.filter((m) => m.text.includes(options.pattern!));
      }
    }
    if (options?.limit) {
      messages = messages.slice(-options.limit);
    }

    return [...messages];
  }

  clearConsoleMessages(tabId: number): void {
    this.consoleMessages.set(tabId, []);
  }

  getNetworkRequests(
    tabId: number,
    options?: {
      urlPattern?: string;
      limit?: number;
    }
  ): NetworkRequest[] {
    let requests = this.networkRequests.get(tabId) || [];

    if (options?.urlPattern) {
      requests = requests.filter((r) => r.url.includes(options.urlPattern!));
    }
    if (options?.limit) {
      requests = requests.slice(-options.limit);
    }

    return [...requests];
  }

  clearNetworkRequests(tabId: number): void {
    this.networkRequests.set(tabId, []);
  }

  subscribeToConsole(tabId: number, streamId: number, callback: ConsoleEventCallback): void {
    if (!this.consoleCallbacks.has(tabId)) {
      this.consoleCallbacks.set(tabId, new Map());
    }
    this.consoleCallbacks.get(tabId)!.set(streamId, callback);
  }

  unsubscribeFromConsole(tabId: number, streamId: number): void {
    const callbacks = this.consoleCallbacks.get(tabId);
    if (callbacks) {
      callbacks.delete(streamId);
      if (callbacks.size === 0) {
        this.consoleCallbacks.delete(tabId);
      }
    }
  }

  subscribeToNetwork(tabId: number, streamId: number, callback: NetworkEventCallback): void {
    if (!this.networkCallbacks.has(tabId)) {
      this.networkCallbacks.set(tabId, new Map());
    }
    this.networkCallbacks.get(tabId)!.set(streamId, callback);
  }

  unsubscribeFromNetwork(tabId: number, streamId: number): void {
    const callbacks = this.networkCallbacks.get(tabId);
    if (callbacks) {
      callbacks.delete(streamId);
      if (callbacks.size === 0) {
        this.networkCallbacks.delete(tabId);
      }
    }
  }

  async evaluateScript(tabId: number, expression: string): Promise<{
    result?: { value?: any; type?: string; description?: string };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  }> {
    await this.ensureAttached(tabId);
    try {
      await this.send(tabId, "Runtime.enable");
    } catch (e) {}
    
    return this.send(tabId, "Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      timeout: 10000,
    });
  }

  private async send(tabId: number, method: string, params?: object): Promise<any> {
    await this.ensureAttached(tabId);
    const target = this.targets.get(tabId)!;
    return chrome.debugger.sendCommand(target, method, params);
  }

  private async ensureAttached(tabId: number): Promise<void> {
    if (!this.targets.has(tabId)) {
      await this.attach(tabId);
    }
  }

  async getViewportSize(tabId: number): Promise<{ width: number; height: number }> {
    const layoutMetrics = await this.send(tabId, "Page.getLayoutMetrics");
    const viewport = layoutMetrics.visualViewport || layoutMetrics.layoutViewport;
    return {
      width: Math.round(viewport.clientWidth),
      height: Math.round(viewport.clientHeight),
    };
  }

  async captureScreenshot(tabId: number): Promise<{
    base64: string;
    width: number;
    height: number;
  }> {
    const result = await this.send(tabId, "Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    const { width, height } = await this.getViewportSize(tabId);
    return { base64: result.data, width, height };
  }

  async captureRegion(tabId: number, x: number, y: number, width: number, height: number): Promise<{
    base64: string;
    width: number;
    height: number;
  }> {
    const result = await this.send(tabId, "Page.captureScreenshot", {
      format: "png",
      clip: { x, y, width, height, scale: 1 },
    });
    return { base64: result.data, width, height };
  }

  private async dispatchMouseEvent(
    tabId: number,
    type: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel",
    x: number,
    y: number,
    options: {
      button?: MouseButton;
      buttons?: number;
      clickCount?: number;
      modifiers?: number;
      deltaX?: number;
      deltaY?: number;
    } = {}
  ): Promise<void> {
    const params: Record<string, any> = {
      type,
      x: Math.round(x),
      y: Math.round(y),
      modifiers: options.modifiers || 0,
    };

    if (type === "mousePressed" || type === "mouseReleased" || type === "mouseMoved") {
      params.button = options.button || "none";
      if (type === "mousePressed" || type === "mouseReleased") {
        params.clickCount = options.clickCount || 1;
      }
    }

    if (type !== "mouseWheel") {
      params.buttons = options.buttons ?? 0;
    }

    if (type === "mouseWheel") {
      params.deltaX = options.deltaX || 0;
      params.deltaY = options.deltaY || 0;
    }

    await this.send(tabId, "Input.dispatchMouseEvent", params);
  }

  async click(
    tabId: number,
    x: number,
    y: number,
    button: MouseButton = "left",
    clickCount = 1,
    modifiers = 0
  ): Promise<void> {
    const buttonValue = button === "left" ? 1 : button === "right" ? 2 : button === "middle" ? 4 : 0;

    await this.dispatchMouseEvent(tabId, "mouseMoved", x, y, { button: "none", buttons: 0, modifiers });
    await new Promise(resolve => setTimeout(resolve, 100));

    for (let i = 1; i <= clickCount; i++) {
      await this.dispatchMouseEvent(tabId, "mousePressed", x, y, {
        button,
        buttons: buttonValue,
        clickCount: i,
        modifiers,
      });
      await new Promise(resolve => setTimeout(resolve, 12));
      await this.dispatchMouseEvent(tabId, "mouseReleased", x, y, {
        button,
        buttons: 0,
        clickCount: i,
        modifiers,
      });
      if (i < clickCount) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }

  async rightClick(tabId: number, x: number, y: number, modifiers = 0): Promise<void> {
    await this.click(tabId, x, y, "right", 1, modifiers);
  }

  async doubleClick(tabId: number, x: number, y: number, modifiers = 0): Promise<void> {
    await this.click(tabId, x, y, "left", 2, modifiers);
  }

  async tripleClick(tabId: number, x: number, y: number, modifiers = 0): Promise<void> {
    await this.click(tabId, x, y, "left", 3, modifiers);
  }

  async hover(tabId: number, x: number, y: number): Promise<void> {
    await this.dispatchMouseEvent(tabId, "mouseMoved", x, y, { button: "none", buttons: 0 });
  }

  async drag(
    tabId: number,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    modifiers = 0
  ): Promise<void> {
    await this.dispatchMouseEvent(tabId, "mouseMoved", startX, startY, { button: "none", buttons: 0 });
    await new Promise(resolve => setTimeout(resolve, 50));

    await this.dispatchMouseEvent(tabId, "mousePressed", startX, startY, {
      button: "left",
      buttons: 1,
      clickCount: 1,
      modifiers,
    });
    await new Promise(resolve => setTimeout(resolve, 50));

    await this.dispatchMouseEvent(tabId, "mouseMoved", endX, endY, { button: "left", buttons: 1, modifiers });
    await new Promise(resolve => setTimeout(resolve, 50));

    await this.dispatchMouseEvent(tabId, "mouseReleased", endX, endY, {
      button: "left",
      buttons: 0,
      clickCount: 1,
      modifiers,
    });
  }

  async scroll(tabId: number, x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    await this.dispatchMouseEvent(tabId, "mouseWheel", x, y, { deltaX, deltaY });
  }

  async type(tabId: number, text: string): Promise<void> {
    for (const char of text) {
      if (char === "\n" || char === "\r") {
        await this.pressKey(tabId, "Enter");
      } else {
        const keyDef = this.getKeyDefinition(char);
        if (keyDef) {
          const needsShift = this.requiresShift(char);
          await this.pressKey(tabId, char, needsShift ? MODIFIERS.shift : 0);
        } else {
          await this.send(tabId, "Input.insertText", { text: char });
        }
      }
    }
  }

  private requiresShift(char: string): boolean {
    return /[A-Z!@#$%^&*()_+{}|:"<>?~]/.test(char);
  }

  private async dispatchKeyEvent(
    tabId: number,
    type: "keyDown" | "keyUp" | "rawKeyDown" | "char",
    keyDef: KeyDefinition,
    modifiers = 0
  ): Promise<void> {
    await this.send(tabId, "Input.dispatchKeyEvent", {
      type: keyDef.text ? type : (type === "keyDown" ? "rawKeyDown" : type),
      key: keyDef.key,
      code: keyDef.code,
      windowsVirtualKeyCode: keyDef.keyCode,
      modifiers,
      text: keyDef.text ?? "",
      unmodifiedText: keyDef.text ?? "",
      location: keyDef.location ?? 0,
    });
  }

  async pressKey(tabId: number, key: string, modifiers = 0): Promise<void> {
    const keyDef = this.getKeyDefinition(key);
    if (!keyDef) {
      throw new Error(`Unknown key: ${key}`);
    }

    await this.dispatchKeyEvent(tabId, "keyDown", keyDef, modifiers);
    await this.dispatchKeyEvent(tabId, "keyUp", keyDef, modifiers);
  }

  async pressKeyChord(tabId: number, chord: string): Promise<void> {
    const parts = chord.toLowerCase().split("+");
    const modifierKeys: string[] = [];
    let mainKey = "";

    for (const part of parts) {
      if (part in MODIFIERS) {
        modifierKeys.push(part);
      } else {
        mainKey = part;
      }
    }

    let modifiers = 0;
    for (const mod of modifierKeys) {
      modifiers |= MODIFIERS[mod as keyof typeof MODIFIERS] || 0;
    }

    if (mainKey) {
      await this.pressKey(tabId, mainKey, modifiers);
    }
  }

  private getKeyDefinition(key: string): KeyDefinition | null {
    const lowerKey = key.toLowerCase();
    
    if (KEY_DEFINITIONS[lowerKey]) {
      return KEY_DEFINITIONS[lowerKey];
    }

    if (key.length === 1) {
      const code = key.toUpperCase().charCodeAt(0);
      return {
        key,
        code: `Key${key.toUpperCase()}`,
        keyCode: code,
        text: key,
      };
    }

    return null;
  }

  parseModifiers(modifierString?: string): number {
    if (!modifierString) return 0;
    
    let result = 0;
    const parts = modifierString.toLowerCase().split("+");
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed in MODIFIERS) {
        result |= MODIFIERS[trimmed as keyof typeof MODIFIERS];
      }
    }
    return result;
  }
}
