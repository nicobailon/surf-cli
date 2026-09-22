import { vi } from "vitest";

class FakeNode {
  static TEXT_NODE = 3;
}

class FakeText extends FakeNode {
  nodeType = 3;

  constructor(public textContent: string) {
    super();
  }
}

class FakeElement extends FakeNode {
  childNodes: Array<FakeElement | FakeText> = [];
  parentElement: FakeElement | null = null;
  offsetWidth = 10;
  offsetHeight = 10;
  clientHeight = 0;
  scrollHeight = 0;
  scrollTop = 0;
  selectedIndex = -1;
  options: FakeElement[] = [];
  value = "";
  disabled = false;
  indeterminate = false;
  checked = false;
  focused = false;
  clicked = false;
  listeners = new Map<string, Array<() => void>>();
  isContentEditable = false;
  isConnected = true;
  rect = { top: 0, bottom: 10, left: 0, right: 10 };

  private attrs = new Map<string, string>();

  constructor(public tagName: string) {
    super();
    this.tagName = tagName.toUpperCase();
  }

  get id(): string {
    return this.getAttribute("id") || "";
  }

  get type(): string {
    return this.getAttribute("type") || "";
  }

  get children(): FakeElement[] {
    return this.childNodes.filter((child): child is FakeElement => child instanceof FakeElement);
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent || "").join("");
  }

  set textContent(value: string) {
    this.childNodes = [new FakeText(value)];
  }

  append(...children: Array<FakeElement | FakeText>): void {
    for (const child of children) {
      if (child instanceof FakeElement) {
        child.parentElement = this;
      }
      this.childNodes.push(child);
    }
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }

  closest(): FakeElement | null {
    return null;
  }

  querySelector(): FakeElement | null {
    return null;
  }

  focus(): void {
    this.focused = true;
  }

  click(): void {
    this.clicked = true;
  }

  dispatchEvent(_event: Event): boolean {
    return true;
  }

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  getBoundingClientRect(): { top: number; bottom: number; left: number; right: number } {
    return this.rect;
  }
}

class FakeButtonElement extends FakeElement {}
class FakeInputElement extends FakeElement {}
class FakeSelectElement extends FakeElement {}
class FakeTextAreaElement extends FakeElement {}

function text(value: string): FakeText {
  return new FakeText(value);
}

function element(tagName: string, attrs: Record<string, string> = {}): FakeElement {
  const node = tagName === "button" ? new FakeButtonElement(tagName) : new FakeElement(tagName);
  for (const [name, value] of Object.entries(attrs)) {
    node.setAttribute(name, value);
  }
  return node;
}

describe("accessibility tree", () => {
  let messageHandler:
    | ((message: any, sender: any, sendResponse: (response: any) => void) => boolean)
    | undefined;
  let visualIndicatorHandler: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    messageHandler = undefined;
    visualIndicatorHandler = vi.fn();

    (globalThis as any).Element = FakeElement;
    (globalThis as any).HTMLElement = FakeElement;
    (globalThis as any).HTMLButtonElement = FakeButtonElement;
    (globalThis as any).HTMLInputElement = FakeInputElement;
    (globalThis as any).HTMLSelectElement = FakeSelectElement;
    (globalThis as any).HTMLTextAreaElement = FakeTextAreaElement;
    (globalThis as any).Node = FakeNode;

    (globalThis as any).window = {
      innerWidth: 1024,
      innerHeight: 768,
      location: { href: "https://example.test/page" },
      getComputedStyle: () => ({
        display: "block",
        visibility: "visible",
        opacity: "1",
        cursor: "default",
      }),
      __piVisualIndicatorMessageHandler: visualIndicatorHandler,
    };

    (globalThis as any).document = {
      body: new FakeElement("body"),
      title: "Example",
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
    };

    (globalThis as any).chrome = {
      runtime: {
        onMessage: {
          addListener: (handler: typeof messageHandler) => {
            messageHandler = handler;
          },
        },
      },
    };

    await import("../../src/content/accessibility-tree");
  });

  it("routes visual indicator commands through the sole content-message listener", () => {
    let response: any;
    const listenerResult = messageHandler?.({ type: "SHOW_AGENT_INDICATORS" }, {}, (result) => {
      response = result;
    });

    expect(listenerResult).toBe(false);
    expect(visualIndicatorHandler).toHaveBeenCalledWith("SHOW_AGENT_INDICATORS");
    expect(response).toEqual({ success: true });
  });

  it("does not classify listener-backed anchors as mutation-safe or suppress authorized clicks", () => {
    const anchor = element("a", { href: "/account" });
    anchor.append(text("Account"));
    anchor.addEventListener("click", () => {
      anchor.clicked = true;
    });
    (document.body as unknown as FakeElement).append(anchor);
    window.__piElementMap = {
      account: {
        element: new WeakRef(anchor as unknown as Element),
        role: "link",
        name: "Account",
      },
    };

    let response: any;
    messageHandler?.(
      {
        type: "GENERATE_ACCESSIBILITY_TREE",
        options: { filter: "interactive", semanticObservation: true },
      },
      {},
      (result) => {
        response = result;
      },
    );

    const candidate = response.semanticObservation.candidates.find(
      (item: Record<string, any>) => item.ref === "account",
    );
    expect(candidate).toMatchObject({ role: "link", href: "/account" });
    expect(candidate).not.toHaveProperty("safeNavigation");

    const { buildActions } = require("../../native/semantic-cli.cjs");
    const readonly = buildActions(response.semanticObservation, {}, false);
    const writable = buildActions(response.semanticObservation, {}, true);
    expect(readonly).toContainEqual(expect.objectContaining({ kind: "navigate" }));
    expect(readonly.some((action: Record<string, any>) => action.kind === "click")).toBe(false);
    expect(writable).toContainEqual(expect.objectContaining({ kind: "click", ref: "account" }));
  });

  it("reports when the visual indicator content script is not loaded", () => {
    window.__piVisualIndicatorMessageHandler = undefined;
    let response: any;
    messageHandler?.({ type: "HIDE_AGENT_INDICATORS" }, {}, (result) => {
      response = result;
    });

    expect(response).toEqual({ error: "Visual indicator content script not loaded." });
  });

  it("uses nested text for interactive link and button names", () => {
    const link = element("a", { href: "/docs" });
    const linkLabel = element("span");
    linkLabel.append(text("Read docs"));
    link.append(linkLabel);

    const button = element("button");
    const buttonLabel = element("span");
    buttonLabel.append(text("Save changes"));
    button.append(buttonLabel);

    (document.body as unknown as FakeElement).append(link, button);

    let response: any;
    messageHandler?.(
      { type: "GENERATE_ACCESSIBILITY_TREE", options: { filter: "interactive" } },
      {},
      (result) => {
        response = result;
      },
    );

    expect(response.error).toBeUndefined();
    expect(response.pageContent).toContain('link "Read docs"');
    expect(response.pageContent).toContain('button "Save changes"');
  });

  it("returns a bounded value-free semantic observation only when requested", () => {
    const password = new FakeInputElement("input");
    password.setAttribute("type", "password");
    password.setAttribute("aria-label", "Account password");
    password.value = "unique-password-sentinel";
    const button = new FakeButtonElement("button");
    button.append(text("Continue"));
    (document.body as unknown as FakeElement).append(password, button, text("Public nearby copy"));

    let ordinary: any;
    messageHandler?.(
      { type: "GENERATE_ACCESSIBILITY_TREE", options: { filter: "interactive" } },
      {},
      (result) => {
        ordinary = result;
      },
    );
    expect(ordinary.semanticObservation).toBeUndefined();

    let response: any;
    messageHandler?.(
      {
        type: "GENERATE_ACCESSIBILITY_TREE",
        options: { filter: "interactive", semanticObservation: true },
      },
      {},
      (result) => {
        response = result;
      },
    );

    expect(response.semanticObservation.identity).toMatchObject({
      fullUrl: "https://example.test/page",
    });
    expect(response.semanticObservation.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "textbox", name: "Account password", type: "password" }),
        expect.objectContaining({ role: "button", name: "Continue", type: "button" }),
      ]),
    );
    const observedRefs = response.semanticObservation.candidates.map(
      (candidate: any) => candidate.ref,
    );
    expect(response.semanticObservation.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ refs: expect.arrayContaining(observedRefs) }),
      ]),
    );
    expect(JSON.stringify(response.semanticObservation)).not.toContain("unique-password-sentinel");
    expect(
      new TextEncoder().encode(JSON.stringify(response.semanticObservation)).length,
    ).toBeLessThanOrEqual(24 * 1024);
  });

  it("associates value-free checked and selected state with semantic refs and evidence", () => {
    const size = new FakeInputElement("input");
    size.setAttribute("type", "radio");
    size.setAttribute("aria-label", 'M \\ "Tall"');
    size.value = "private-size-value";
    size.checked = true;
    const color = element("button", {
      role: "option",
      "aria-label": "Black",
      "aria-selected": "false",
    });
    color.value = "private-color-value";
    (document.body as unknown as FakeElement).append(size, color);
    window.__piElementMap = {
      size: { element: new WeakRef(size as unknown as Element), role: "radio", name: "M" },
      color: { element: new WeakRef(color as unknown as Element), role: "option", name: "Black" },
    };

    let observation: any;
    messageHandler?.(
      { type: "GENERATE_ACCESSIBILITY_TREE", options: { semanticObservation: true } },
      {},
      (result) => {
        observation = result.semanticObservation;
      },
    );

    expect(observation.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ref: "size", state: { checked: true } }),
        expect.objectContaining({ ref: "color", state: { selected: false } }),
      ]),
    );
    expect(observation.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: 'radio "M \\\\ \\"Tall\\"" [checked]', refs: ["size"] }),
        expect.objectContaining({ text: 'option "Black" [not-selected]', refs: ["color"] }),
      ]),
    );
    expect(JSON.stringify(observation)).not.toContain("private-size-value");
    expect(JSON.stringify(observation)).not.toContain("private-color-value");
    expect(observation.candidates).toHaveLength(2);
  });

  it("emits one semantic candidate when repeated reads assigned multiple refs to one element", () => {
    const quantity = new FakeInputElement("input");
    quantity.setAttribute("type", "number");
    (document.body as unknown as FakeElement).append(quantity);
    window.__piElementMap = {
      old: { element: new WeakRef(quantity as unknown as Element), role: "spinbutton", name: "" },
      fresh: { element: new WeakRef(quantity as unknown as Element), role: "spinbutton", name: "" },
    };

    let response: any;
    messageHandler?.(
      { type: "GENERATE_ACCESSIBILITY_TREE", options: { semanticObservation: true } },
      {},
      (result) => {
        response = result;
      },
    );

    expect(
      response.semanticObservation.candidates.filter(
        (candidate: any) => candidate.role === "spinbutton",
      ),
    ).toHaveLength(1);
  });

  it("rejects stale guarded clicks without executing the action", () => {
    const button = new FakeButtonElement("button");
    button.append(text("Continue"));
    window.__piElementMap = {
      target: {
        element: new WeakRef(button as unknown as Element),
        role: "button",
        name: "Continue",
      },
    };

    let response: any;
    messageHandler?.(
      {
        type: "CLICK_ELEMENT",
        ref: "target",
        button: "left",
        expectedIdentity: {
          fullUrl: "https://example.test/old",
          documentToken: "old-document",
          ref: "target",
          role: "button",
          name: "Continue",
          type: "button",
        },
      },
      {},
      (result) => {
        response = result;
      },
    );

    expect(response).toEqual({ error: "stale_observation", code: "stale_observation" });
    expect(button.clicked).toBe(false);
  });

  it("rejects stale guarded fills without changing the control value", () => {
    const input = new FakeInputElement("input");
    input.setAttribute("type", "email");
    input.setAttribute("aria-label", "Email");
    input.value = "original";
    window.__piElementMap = {
      target: { element: new WeakRef(input as unknown as Element), role: "textbox", name: "Email" },
    };

    let response: any;
    messageHandler?.(
      {
        type: "FORM_FILL",
        data: [{ ref: "target", value: "replacement" }],
        expectedIdentity: {
          fullUrl: "https://example.test/page",
          documentToken: "stale-document",
          ref: "target",
          role: "textbox",
          name: "Email",
          type: "email",
        },
      },
      {},
      (result) => {
        response = result;
      },
    );

    expect(response).toMatchObject({ success: false, code: "stale_observation", filled: 0 });
    expect(input.value).toBe("original");
  });

  it.each([
    { type: "SEMANTIC_NAVIGATE", url: "https://example.test/next" },
    { type: "SEMANTIC_SCROLL", deltaX: 0, deltaY: 600 },
  ])("rejects stale guarded $type without acting on a replacement document", (message) => {
    const scrollBy = vi.fn();
    const scrollTo = vi.fn();
    (window as any).scrollBy = scrollBy;
    (window as any).scrollTo = scrollTo;
    let response: any;
    messageHandler?.(
      {
        ...message,
        expectedIdentity: {
          fullUrl: "https://example.test/replaced",
          documentToken: "old-document",
        },
      },
      {},
      (result) => {
        response = result;
      },
    );
    expect(response).toEqual({ error: "stale_observation", code: "stale_observation" });
    expect(window.location.href).toBe("https://example.test/page");
    expect(scrollBy).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it.each([
    { type: "SCROLL_TO_POSITION", position: "top" },
    { type: "SCROLL_TO_POSITION", position: "bottom" },
    { type: "SEMANTIC_SCROLL", position: "top" },
    { type: "SEMANTIC_SCROLL", position: "bottom" },
  ])("$type $position uses the largest scrollable container", ({ type, position }) => {
    const viewport = new FakeElement("html");
    viewport.clientHeight = 768;
    viewport.scrollHeight = 768;
    const overflow = new FakeElement("main");
    overflow.clientHeight = 400;
    overflow.scrollHeight = 2_000;
    overflow.scrollTop = position === "top" ? 800 : 0;
    (overflow as any).style = { overflow: "auto" };
    (document as any).documentElement = viewport;
    (document as any).querySelectorAll = () => [viewport, overflow];

    let observation: any;
    messageHandler?.(
      {
        type: "GENERATE_ACCESSIBILITY_TREE",
        options: { filter: "interactive", semanticObservation: true },
      },
      {},
      (result) => {
        observation = result.semanticObservation;
      },
    );

    let response: any;
    messageHandler?.(
      {
        type,
        position,
        ...(type === "SEMANTIC_SCROLL" ? { expectedIdentity: observation.identity } : {}),
      },
      {},
      (result) => {
        response = result;
      },
    );

    expect(overflow.scrollTop).toBe(position === "top" ? 0 : overflow.scrollHeight);
    expect(response).toMatchObject({
      scrollTop: overflow.scrollTop,
      scrollHeight: 2_000,
      clientHeight: 400,
    });
    expect(viewport.scrollTop).toBe(0);
  });

  it.each(["top", "bottom"])(
    "stale guarded semantic scroll.%s does not mutate the selected container",
    (position) => {
      const overflow = new FakeElement("main");
      overflow.clientHeight = 400;
      overflow.scrollHeight = 2_000;
      overflow.scrollTop = 500;
      const querySelectorAll = vi.fn(() => [overflow]);
      (document as any).querySelectorAll = querySelectorAll;

      let response: any;
      messageHandler?.(
        {
          type: "SEMANTIC_SCROLL",
          position,
          expectedIdentity: {
            fullUrl: "https://example.test/replaced",
            documentToken: "old-document",
          },
        },
        {},
        (result) => {
          response = result;
        },
      );

      expect(response).toEqual({ error: "stale_observation", code: "stale_observation" });
      expect(overflow.scrollTop).toBe(500);
      expect(querySelectorAll).not.toHaveBeenCalled();
    },
  );

  it("compares guarded value and checked state without disclosing either actual value", () => {
    const input = new FakeInputElement("input");
    input.setAttribute("type", "password");
    input.setAttribute("aria-label", "Secret");
    input.value = "private-value-sentinel";
    const checkbox = new FakeInputElement("input");
    checkbox.setAttribute("type", "checkbox");
    checkbox.setAttribute("aria-label", "Remember");
    checkbox.checked = true;
    window.__piElementMap = {
      secret: {
        element: new WeakRef(input as unknown as Element),
        role: "textbox",
        name: "Secret",
      },
      remember: {
        element: new WeakRef(checkbox as unknown as Element),
        role: "checkbox",
        name: "Remember",
      },
    };

    let observation: any;
    messageHandler?.(
      { type: "GENERATE_ACCESSIBILITY_TREE", options: { semanticObservation: true } },
      {},
      (result) => {
        observation = result.semanticObservation;
      },
    );
    const compare = (ref: string, predicate: any) => {
      const candidate = observation.candidates.find((item: any) => item.ref === ref);
      let response: any;
      messageHandler?.(
        {
          type: "SEMANTIC_LOCAL_COMPARE",
          ref,
          predicate,
          expectedIdentity: { ...observation.identity, ...candidate },
        },
        {},
        (result) => {
          response = result;
        },
      );
      return response;
    };

    const valueResult = compare("secret", {
      kind: "valueEquals",
      expected: "private-value-sentinel",
    });
    expect(valueResult).toMatchObject({ success: true, matches: true, reason: "compared" });
    expect(JSON.stringify(valueResult)).not.toContain("private-value-sentinel");
    const checkedResult = compare("remember", { kind: "checkedEquals", expected: true });
    expect(checkedResult).toMatchObject({ success: true, matches: true, reason: "compared" });
    expect(checkedResult).not.toHaveProperty("checked");
  });

  it("rejects stale local identity and unsupported controls explicitly", () => {
    const button = new FakeButtonElement("button");
    button.append(text("Save"));
    window.__piElementMap = {
      save: { element: new WeakRef(button as unknown as Element), role: "button", name: "Save" },
    };
    const request = (expectedIdentity: any, predicate: any) => {
      let response: any;
      messageHandler?.(
        { type: "SEMANTIC_LOCAL_COMPARE", ref: "save", expectedIdentity, predicate },
        {},
        (result) => {
          response = result;
        },
      );
      return response;
    };
    const identity = {
      fullUrl: "https://example.test/page",
      documentToken: "stale",
      ref: "save",
      role: "button",
      name: "Save",
      type: "button",
    };
    expect(request(identity, { kind: "visible" })).toMatchObject({
      success: false,
      matches: false,
      reason: "stale_observation",
    });

    let observation: any;
    messageHandler?.(
      { type: "GENERATE_ACCESSIBILITY_TREE", options: { semanticObservation: true } },
      {},
      (result) => {
        observation = result.semanticObservation;
      },
    );
    const freshIdentity = { ...observation.identity, ...observation.candidates[0] };
    expect(
      request(freshIdentity, {
        kind: "checkedEquals",
        expected: true,
      }),
    ).toMatchObject({ success: false, reason: "unsupported_control" });
    expect(
      request(freshIdentity, { kind: "computedStyleEquals", expected: "block" }),
    ).toMatchObject({ success: false, reason: "unsupported_predicate" });
  });

  it("pins nested scroll scope, overlaps seam targets, and recomputes stride after resize", () => {
    const viewport = new FakeElement("html");
    viewport.clientHeight = 600;
    viewport.scrollHeight = 600;
    const overflow = new FakeElement("main");
    overflow.clientHeight = 400;
    overflow.scrollHeight = 2_000;
    overflow.rect = { top: 100, bottom: 500, left: 0, right: 800 };
    (document as any).documentElement = viewport;
    (document as any).querySelectorAll = () => [viewport, overflow];

    let observation: any;
    messageHandler?.(
      { type: "GENERATE_ACCESSIBILITY_TREE", options: { semanticObservation: true } },
      {},
      (result) => {
        observation = result.semanticObservation;
      },
    );
    const send = (action: string, scopeToken?: string) => {
      let response: any;
      messageHandler?.(
        {
          type: "SEMANTIC_SCROLL_SCOPE",
          action,
          scopeToken,
          expectedIdentity: observation.identity,
        },
        {},
        (result) => {
          response = result;
        },
      );
      return response;
    };

    const inspected = send("inspect");
    expect(inspected).toMatchObject({
      success: true,
      geometry: {
        scrollTop: 0,
        clientHeight: 400,
        intervalStart: 0,
        intervalEnd: 400,
      },
    });
    const first = send("advance", inspected.scopeToken);
    expect(first.geometry).toMatchObject({ scrollTop: 300, intervalStart: 300, intervalEnd: 700 });
    expect(first.geometry.intervalStart).toBeLessThan(inspected.geometry.intervalEnd);

    overflow.clientHeight = 200;
    overflow.rect.bottom = 300;
    const resized = send("advance", inspected.scopeToken);
    expect(resized.geometry).toMatchObject({ scrollTop: 450, clientHeight: 200 });

    overflow.scrollTop = 1_900;
    const clamped = send("advance", inspected.scopeToken);
    expect(clamped.geometry).toMatchObject({
      scrollTop: 1_800,
      intervalEnd: 2_000,
      atBottom: true,
    });

    overflow.clientHeight = 1_000;
    overflow.rect = { top: 0, bottom: 500, left: 0, right: 800 };
    overflow.scrollTop = 1_000;
    const clipped = send("inspect");
    expect(clipped.geometry).toMatchObject({
      scrollTop: 1_000,
      clientHeight: 500,
      intervalEnd: 1_500,
      atBottom: false,
    });

    overflow.clientHeight = 1_000;
    overflow.rect = { top: -500, bottom: 500, left: 0, right: 800 };
    overflow.scrollTop = 0;
    const topClipped = send("inspect");
    expect(topClipped.geometry).toMatchObject({
      scrollTop: 0,
      clientHeight: 500,
      intervalStart: 500,
      intervalEnd: 1_000,
      atTop: false,
      atBottom: false,
    });
  });

  it("rejects stale scroll documents and disappeared pinned containers", () => {
    const overflow = new FakeElement("main");
    overflow.clientHeight = 300;
    overflow.scrollHeight = 1_000;
    overflow.rect = { top: 0, bottom: 300, left: 0, right: 500 };
    (document as any).documentElement = new FakeElement("html");
    (document as any).querySelectorAll = () => [overflow];
    let observation: any;
    messageHandler?.(
      { type: "GENERATE_ACCESSIBILITY_TREE", options: { semanticObservation: true } },
      {},
      (result) => {
        observation = result.semanticObservation;
      },
    );
    let inspected: any;
    messageHandler?.(
      { type: "SEMANTIC_SCROLL_SCOPE", action: "inspect", expectedIdentity: observation.identity },
      {},
      (result) => {
        inspected = result;
      },
    );

    let staleDocument: any;
    messageHandler?.(
      {
        type: "SEMANTIC_SCROLL_SCOPE",
        action: "advance",
        scopeToken: inspected.scopeToken,
        expectedIdentity: { ...observation.identity, fullUrl: "https://example.test/replaced" },
      },
      {},
      (result) => {
        staleDocument = result;
      },
    );
    expect(staleDocument).toMatchObject({ success: false, reason: "stale_observation" });

    overflow.isConnected = false;
    let staleScope: any;
    messageHandler?.(
      {
        type: "SEMANTIC_SCROLL_SCOPE",
        action: "advance",
        scopeToken: inspected.scopeToken,
        expectedIdentity: observation.identity,
      },
      {},
      (result) => {
        staleScope = result;
      },
    );
    expect(staleScope).toMatchObject({ success: false, reason: "stale_scroll_scope" });
  });

  it("caps visible text in compact mode", () => {
    (document.body as unknown as FakeElement).append(text("abcdef"));

    let response: any;
    messageHandler?.(
      { type: "GET_PAGE_TEXT", options: { compact: true, maxBytes: 3 } },
      {},
      (result) => {
        response = result;
      },
    );

    expect(response).toMatchObject({
      text: "abc",
      title: "Example",
      url: "https://example.test/page",
    });
  });

  it("preserves the existing 50000-character default when max-bytes is not given", () => {
    const long = "😀".repeat(30000);
    (document.body as unknown as FakeElement).append(text(long));

    let response: any;
    messageHandler?.({ type: "GET_PAGE_TEXT", options: { compact: true } }, {}, (result) => {
      response = result;
    });

    expect(response.text.length).toBe(50000);
    expect(new TextEncoder().encode(response.text).length).toBe(100000);
  });

  it("types into a selector in the content-script frame", () => {
    const input = new FakeInputElement("input");
    (document as any).querySelector = (selector: string) => (selector === "#target" ? input : null);

    let response: any;
    messageHandler?.(
      { type: "SMART_TYPE", selector: "#target", text: "hello", clear: true, submit: false },
      {},
      (result) => {
        response = result;
      },
    );

    expect(input.focused).toBe(true);
    expect(input.value).toBe("hello");
    expect(response).toEqual({ success: true, contentEditable: false });
  });

  it.each([
    ["SMART_TYPE", "input"],
    ["SMART_TYPE", "textarea"],
    ["FORM_INPUT", "input"],
    ["FORM_INPUT", "textarea"],
    ["FORM_FILL", "input"],
    ["FORM_FILL", "textarea"],
  ])("%s updates framework-observed %s state", (type, tag) => {
    const field = tag === "input" ? new FakeInputElement(tag) : new FakeTextAreaElement(tag);
    let domValue = "old";
    let trackedValue = "old";
    let mirror = "old";
    // Model a DOM prototype accessor shadowed by a framework's own tracker.
    const prototype = Object.create(Object.getPrototypeOf(field));
    Object.defineProperty(prototype, "value", {
      get: () => domValue,
      set: (value: string) => {
        domValue = value;
      },
    });
    Object.setPrototypeOf(field, prototype);
    Object.defineProperty(field, "value", {
      configurable: true,
      get: () => domValue,
      set: (value: string) => {
        domValue = value;
        trackedValue = value;
      },
    });
    const events: string[] = [];
    field.dispatchEvent = vi.fn((event: Event) => {
      events.push(event.type);
      if (event.type === "input" && domValue !== trackedValue) {
        mirror = domValue;
        trackedValue = domValue;
      }
      return true;
    });
    (document as any).querySelector = () => field;
    window.__piElementMap = {
      target: { element: new WeakRef(field as unknown as Element), role: "textbox", name: "" },
    };

    let response: any;
    messageHandler?.(
      {
        type,
        selector: "#target",
        text: "hello",
        ref: "target",
        value: "hello",
        data: [{ ref: "target", value: "hello" }],
      },
      {},
      (result) => {
        response = result;
      },
    );

    expect(response.success).toBe(true);
    expect(field.value).toBe("hello");
    expect(mirror).toBe("hello");
    expect(events).toEqual(["input", "change"]);
  });

  it.each(["FORM_INPUT", "FORM_FILL"])("%s preserves checkbox and select behavior", (type) => {
    const checkbox = new FakeInputElement("input");
    checkbox.setAttribute("type", "checkbox");
    const select = new FakeSelectElement("select");
    const option = new FakeElement("option");
    option.value = "chosen";
    select.options = [option];
    for (const [field, value] of [
      [checkbox, true],
      [select, "chosen"],
    ] as const) {
      const events: string[] = [];
      field.dispatchEvent = vi.fn((event: Event) => {
        events.push(event.type);
        return true;
      });
      window.__piElementMap = {
        target: { element: new WeakRef(field as unknown as Element), role: "", name: "" },
      };
      let response: any;
      messageHandler?.(
        { type, ref: "target", value, data: [{ ref: "target", value }] },
        {},
        (result) => {
          response = result;
        },
      );
      expect(response.success).toBe(true);
      expect(events).toEqual(["change"]);
    }
    expect(checkbox.checked).toBe(true);
    expect(select.value).toBe("chosen");
  });

  it("truncates multi-byte utf-8 text on a byte boundary, not a surrogate", () => {
    (document.body as unknown as FakeElement).append(text("😀😀"));

    let response: any;
    messageHandler?.(
      { type: "GET_PAGE_TEXT", options: { compact: true, maxBytes: 3 } },
      {},
      (result) => {
        response = result;
      },
    );

    expect(response.text).not.toContain("\uD83D");
    expect(response.text).not.toContain("\uDE00");
    const byteLen = new TextEncoder().encode(response.text).length;
    expect(byteLen).toBeLessThanOrEqual(3);
    expect(response.text).toBe("");
  });
});
