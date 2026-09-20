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
  selectedIndex = -1;
  options: FakeElement[] = [];
  value = "";
  disabled = false;
  indeterminate = false;
  checked = false;
  focused = false;
  clicked = false;
  isContentEditable = false;

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

  getBoundingClientRect(): { top: number; bottom: number; left: number; right: number } {
    return { top: 0, bottom: 10, left: 0, right: 10 };
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
    expect(JSON.stringify(response.semanticObservation)).not.toContain("unique-password-sentinel");
    expect(
      new TextEncoder().encode(JSON.stringify(response.semanticObservation)).length,
    ).toBeLessThanOrEqual(24 * 1024);
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
