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

class FakeMutationObserver {
  static active = new Set<FakeMutationObserver>();

  constructor(private callback: (records: unknown[]) => void) {}

  observe(): void {
    FakeMutationObserver.active.add(this);
  }

  disconnect(): void {
    FakeMutationObserver.active.delete(this);
  }

  static mutate(records: unknown[] = [{ type: "attributes", target: {} }]): void {
    for (const observer of FakeMutationObserver.active) {
      observer.callback(records);
    }
  }
}

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
    (globalThis as any).MutationObserver = FakeMutationObserver;
    FakeMutationObserver.active.clear();

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

  afterEach(() => {
    vi.useRealTimers();
  });

  const sendMessage = (message: Record<string, unknown>): any => {
    let response: any;
    messageHandler?.(message, {}, (result) => {
      response = result;
    });
    return response;
  };

  // Resolves after the full cap so every settle outcome has delivered its async response.
  const endPageChanges = async (capMs = 2000): Promise<{ keptOpen: unknown; result: any }> => {
    let result: any;
    const keptOpen = messageHandler?.(
      { type: "END_PAGE_CHANGES", token: "action-1", capMs },
      {},
      (response) => {
        result = response;
      },
    );
    await vi.advanceTimersByTimeAsync(capMs);
    return { keptOpen, result };
  };

  const beginPageChanges = (): any => {
    vi.useFakeTimers();
    (document as any).documentElement = new FakeElement("html");
    return sendMessage({ type: "BEGIN_PAGE_CHANGES", token: "action-1" });
  };

  it("reports an opened dialog and its buttons with refs that the next click resolves", async () => {
    const open = element("button");
    open.append(text("Delete project"));
    const body = document.body as unknown as FakeElement;
    body.append(open);
    expect(beginPageChanges()).toEqual({
      ok: true,
      url: "https://example.test/page",
      title: "Example",
    });

    await vi.advanceTimersByTimeAsync(40);
    const dialog = element("div", { role: "dialog", "aria-label": "Delete project?" });
    const warning = element("p");
    warning.append(text("This cannot be undone."));
    const cancel = element("button");
    cancel.append(text("Cancel"));
    const confirm = element("button");
    confirm.append(text("Delete"));
    dialog.append(warning, cancel, confirm);
    body.append(dialog);
    FakeMutationObserver.mutate();

    const { keptOpen, result } = await endPageChanges();
    expect(keptOpen).toBe(true);
    const dialogRef = result.changes[0].ref;
    expect(result).toEqual({
      settle: { state: "settled", ms: 340 },
      navigated: null,
      changes: [
        { kind: "added", ref: dialogRef, role: "dialog", name: "Delete project?" },
        {
          kind: "added",
          ref: expect.any(String),
          role: "button",
          name: "Cancel",
          within: dialogRef,
        },
        {
          kind: "added",
          ref: expect.any(String),
          role: "button",
          name: "Delete",
          within: dialogRef,
        },
      ],
      text: [{ region: 'dialog "Delete project?"', added: 1, removed: 0 }],
      omitted: 0,
    });
    expect(dialogRef).toEqual(expect.any(String));

    expect(
      sendMessage({ type: "CLICK_ELEMENT", ref: result.changes[2].ref, button: "left" }),
    ).toEqual({
      success: true,
    });
    expect(confirm.clicked).toBe(true);
    expect(cancel.clicked).toBe(false);
  });

  it("gives added elements refs that suggest their replacement after a re-render", async () => {
    const label = "Save ".repeat(20).trim();
    const body = document.body as unknown as FakeElement;
    beginPageChanges();
    const first = element("button");
    first.append(text(label));
    body.append(first);
    FakeMutationObserver.mutate();
    const { result } = await endPageChanges();
    const staleRef = result.changes[0].ref;

    first.isConnected = false;
    body.childNodes = body.childNodes.filter((child) => child !== first);
    const replacement = element("button");
    replacement.append(text(label));
    body.append(replacement);

    expect(sendMessage({ type: "CLICK_ELEMENT", ref: staleRef, button: "left" }).error).toMatch(
      new RegExp(
        `^Element ${staleRef} no longer exists\\. Did you mean e\\d+ \\(button "${label}"\\)\\?`,
      ),
    );
  });

  it("reports a toggled checkbox as one checked state change", async () => {
    const checkbox = new FakeInputElement("input");
    checkbox.setAttribute("type", "checkbox");
    checkbox.setAttribute("aria-label", "Remember me");
    (document.body as unknown as FakeElement).append(checkbox);
    beginPageChanges();

    checkbox.checked = true;

    const { result } = await endPageChanges();
    expect(result.changes).toEqual([
      {
        kind: "changed",
        ref: expect.any(String),
        role: "checkbox",
        name: "Remember me",
        property: "checked",
        from: false,
        to: true,
      },
    ]);
  });

  it("does not report a re-render that swaps a button for an identical node", async () => {
    const body = document.body as unknown as FakeElement;
    const original = element("button");
    original.append(text("Save"));
    body.append(original);
    beginPageChanges();

    const replacement = element("button");
    replacement.append(text("Save"));
    body.childNodes = [];
    body.append(replacement);
    FakeMutationObserver.mutate();

    const { result } = await endPageChanges();
    expect(result).toMatchObject({
      settle: { state: "settled" },
      changes: [],
      text: [],
      omitted: 0,
    });
  });

  it("redacts sensitive field value changes and reports ordinary values", async () => {
    const password = new FakeInputElement("input");
    password.setAttribute("type", "password");
    password.setAttribute("aria-label", "Password");
    password.value = "old-password-sentinel";
    const card = new FakeInputElement("input");
    card.setAttribute("autocomplete", "billing cc-number");
    card.setAttribute("aria-label", "Card");
    const email = new FakeInputElement("input");
    email.setAttribute("type", "email");
    email.setAttribute("aria-label", "Email");
    (document.body as unknown as FakeElement).append(password, card, email);
    beginPageChanges();

    password.value = "new-password-sentinel";
    card.value = "4111-card-sentinel";
    email.value = "me@example.test";

    const { result } = await endPageChanges();
    expect(result.changes).toEqual([
      {
        kind: "changed",
        ref: expect.any(String),
        role: "textbox",
        name: "Password",
        property: "value",
        redacted: true,
      },
      {
        kind: "changed",
        ref: expect.any(String),
        role: "textbox",
        name: "Card",
        property: "value",
        redacted: true,
      },
      {
        kind: "changed",
        ref: expect.any(String),
        role: "textbox",
        name: "Email",
        property: "value",
        from: "",
        to: "me@example.test",
      },
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("password-sentinel");
    expect(serialized).not.toContain("card-sentinel");
  });

  it("reports quiet when nothing but the surf indicator mutates", async () => {
    beginPageChanges();
    const glow = element("div", { id: "pi-agent-glow" });
    (document.body as unknown as FakeElement).append(glow);
    FakeMutationObserver.mutate([
      { type: "childList", target: document.body, addedNodes: [glow], removedNodes: [] },
    ]);

    const { result } = await endPageChanges();
    expect(result).toEqual({
      settle: { state: "quiet", ms: 300 },
      navigated: null,
      changes: [],
      text: [],
      omitted: 0,
    });
  });

  it("reports unsettled with partial changes when mutations continue past the cap", async () => {
    beginPageChanges();
    const ticker = setInterval(() => FakeMutationObserver.mutate(), 50);

    const { result } = await endPageChanges(1000);
    clearInterval(ticker);
    expect(result.settle).toEqual({ state: "unsettled", ms: 1000 });
  });

  it("returns unknown_token when the document holding the before snapshot is gone", () => {
    expect(sendMessage({ type: "END_PAGE_CHANGES", token: "never-begun", capMs: 2000 })).toEqual({
      error: "unknown_token",
    });
  });

  it("returns a full tree on back-to-back reads instead of a hidden diff", () => {
    const button = element("button");
    button.append(text("Continue"));
    (document.body as unknown as FakeElement).append(button);

    sendMessage({ type: "GENERATE_ACCESSIBILITY_TREE", options: { filter: "interactive" } });
    const second = sendMessage({
      type: "GENERATE_ACCESSIBILITY_TREE",
      options: { filter: "interactive" },
    });
    expect(second.pageContent).toContain('button "Continue"');
    expect(second).not.toHaveProperty("diff");
    expect(second).not.toHaveProperty("isIncremental");
  });

  it("summarizes headings, control counts per region, open dialogs and alerts without refs", () => {
    const withText = (node: FakeElement, value: string): FakeElement => {
      node.append(text(value));
      return node;
    };
    const banner = element("header");
    banner.append(
      withText(element("h1"), "Example Store"),
      withText(element("a", { href: "/" }), "Home"),
    );
    const nav = element("nav", { "aria-label": "Primary" });
    nav.append(
      withText(element("a", { href: "/deals" }), "Deals"),
      withText(element("a", { href: "/help" }), "Help"),
    );
    const main = element("main");
    main.append(
      withText(element("h2"), "Products"),
      element("input", { type: "search", "aria-label": "Search products" }),
      withText(element("button"), "Add lamp"),
      withText(element("button"), "Add chair"),
      withText(element("a", { href: "/cart" }), "Cart"),
    );
    const alert = withText(element("div", { role: "alert" }), "Saved to cart");
    const status = withText(element("div", { role: "status" }), "2 items");
    const dialog = element("div", { role: "dialog", "aria-label": "Sign in" });
    dialog.append(
      withText(element("div", { role: "heading", "aria-level": "3" }), "Welcome back"),
      element("input", { type: "email", "aria-label": "Email" }),
      withText(element("button"), "Continue"),
    );
    (document.body as unknown as FakeElement).append(
      banner,
      nav,
      main,
      withText(element("button"), "Feedback"),
      alert,
      status,
      dialog,
    );

    const summary = sendMessage({
      type: "GENERATE_ACCESSIBILITY_TREE",
      options: { summary: true },
    });

    expect(summary).toEqual({
      title: "Example",
      url: "https://example.test/page",
      headings: [
        { level: 1, name: "Example Store" },
        { level: 2, name: "Products" },
        { level: 3, name: "Welcome back" },
      ],
      headingsOmitted: 0,
      regions: [
        { region: "banner", controls: { link: 1 } },
        { region: 'navigation "Primary"', controls: { link: 2 } },
        { region: "main", controls: { button: 2, searchbox: 1, link: 1 } },
        { region: "page", controls: { button: 1 } },
        { region: 'dialog "Sign in"', controls: { textbox: 1, button: 1 } },
      ],
      dialogs: [{ role: "dialog", name: "Sign in" }],
      alerts: [{ role: "alert", name: "Saved to cart" }],
    });
    expect(JSON.stringify(summary)).not.toMatch(/\be\d+\b/);
  });

  it("caps summary headings and counts the rest", () => {
    const body = document.body as unknown as FakeElement;
    for (let index = 1; index <= 12; index++) {
      const heading = element("div", { role: "heading" });
      heading.append(text(`Section ${index}`));
      body.append(heading);
    }

    const summary = sendMessage({
      type: "GENERATE_ACCESSIBILITY_TREE",
      options: { summary: true },
    });

    expect(summary.headings).toHaveLength(10);
    expect(summary.headings[9]).toEqual({ level: 2, name: "Section 10" });
    expect(summary.headingsOmitted).toBe(2);
    expect(summary.regions).toEqual([]);
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

  it("lists offscreen elements under the all filter and hidden ones only when asked", () => {
    const offscreen = element("button");
    offscreen.append(text("Below the fold"));
    offscreen.rect = { top: 2000, bottom: 2010, left: 0, right: 10 };
    const collapsed = element("button");
    collapsed.append(text("Collapsed menu"));
    collapsed.offsetWidth = 0;
    const decorative = element("button", { "aria-hidden": "true" });
    decorative.append(text("Decorative"));
    (document.body as unknown as FakeElement).append(offscreen, collapsed, decorative);
    const read = (options: Record<string, unknown>) => {
      let response: any;
      messageHandler?.({ type: "GENERATE_ACCESSIBILITY_TREE", options }, {}, (result) => {
        response = result;
      });
      return response.pageContent as string;
    };

    const all = read({ filter: "all" });
    expect(all).toContain('"Below the fold"');
    expect(all).not.toContain("Collapsed menu");
    expect(all).not.toContain("Decorative");

    const withHidden = read({ filter: "all", includeHidden: true });
    expect(withHidden).toContain("Collapsed menu");
    expect(withHidden).toContain("Decorative");
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

  describe("refs whose element was re-rendered", () => {
    const send = (message: Record<string, unknown>) => {
      let response: any;
      messageHandler?.(message, {}, (result) => {
        response = result;
      });
      return response;
    };
    const body = () => document.body as unknown as FakeElement;
    const button = (label: string) => {
      const node = element("button");
      node.append(text(label));
      return node;
    };
    const readRef = (label: string) => {
      const content = send({
        type: "GENERATE_ACCESSIBILITY_TREE",
        options: { filter: "interactive" },
      }).pageContent;
      return content.match(new RegExp(`button "${label}" \\[(e\\d+)\\]`))[1] as string;
    };
    const replaceBody = (...children: FakeElement[]) => {
      for (const child of body().children) {
        child.isConnected = false;
      }
      body().childNodes = [];
      body().append(...children);
    };

    it("names the replacement element when role and name match exactly one", () => {
      const original = button("Save");
      body().append(original);
      const staleRef = readRef("Save");

      const replacement = button("Save");
      const otherRole = element("a", { href: "/save" });
      otherRole.append(text("Save"));
      replaceBody(button("Save draft"), otherRole, replacement);

      const stale = send({ type: "CLICK_ELEMENT", ref: staleRef, button: "left" });
      const suggested = stale.error.match(/Did you mean (e\d+) /)?.[1];
      expect(stale.error).toBe(
        `Element ${staleRef} no longer exists. Did you mean ${suggested} (button "Save")? Otherwise run surf read.`,
      );
      expect(suggested).not.toBe(staleRef);
      expect(original.clicked).toBe(false);

      expect(send({ type: "CLICK_ELEMENT", ref: suggested, button: "left" })).toEqual({
        success: true,
      });
      expect(replacement.clicked).toBe(true);
    });

    it("returns a plain error when no single element has the same role and name", () => {
      body().append(button("Save"));
      const staleRef = readRef("Save");
      const plain = `Element ${staleRef} no longer exists. Run surf read to get current refs.`;

      const link = element("a", { href: "/save" });
      link.append(text("Save"));
      replaceBody(button("Save as"), link);
      expect(send({ type: "CLICK_ELEMENT", ref: staleRef, button: "left" })).toEqual({
        error: plain,
      });

      replaceBody(button("Save"), button("Save"));
      expect(send({ type: "SCROLL_TO_ELEMENT", ref: staleRef })).toEqual({
        success: false,
        error: plain,
      });

      expect(send({ type: "GET_ELEMENT_COORDINATES", ref: "e999" })).toMatchObject({
        error: "Element e999 not found. Run surf read to get current refs.",
      });
    });

    it("matches a located ref by the element's own name, not the locator query", () => {
      (document as any).querySelectorAll = (selector: string) =>
        selector === "button" ? body().children.filter((child) => child.tagName === "BUTTON") : [];
      body().append(button("Save changes"));
      const staleRef = send({ type: "LOCATE_ROLE", role: "button", name: "Save" }).ref;

      replaceBody(button("Save"));
      expect(send({ type: "CLICK_ELEMENT", ref: staleRef, button: "left" })).toEqual({
        error: `Element ${staleRef} no longer exists. Run surf read to get current refs.`,
      });

      const replacement = button("Save changes");
      replaceBody(button("Save"), replacement);
      const { error } = send({ type: "CLICK_ELEMENT", ref: staleRef, button: "left" });
      const suggested = error.match(/Did you mean (e\d+) \(button "Save changes"\)\?/)?.[1];
      send({ type: "CLICK_ELEMENT", ref: suggested, button: "left" });
      expect(replacement.clicked).toBe(true);
    });

    it("does not suggest an element inside an aria-hidden container", () => {
      body().append(button("Save"));
      const staleRef = readRef("Save");

      const hidden = element("div", { "aria-hidden": "true" });
      hidden.append(button("Save"));
      replaceBody(hidden);
      expect(send({ type: "CLICK_ELEMENT", ref: staleRef, button: "left" })).toEqual({
        error: `Element ${staleRef} no longer exists. Run surf read to get current refs.`,
      });
    });
  });

  it("returns the whole visible text so the host can mark a cut", () => {
    const long = "😀".repeat(30000);
    (document.body as unknown as FakeElement).append(text(long));

    let response: any;
    messageHandler?.({ type: "GET_PAGE_TEXT" }, {}, (result) => {
      response = result;
    });

    expect(response).toEqual({ text: long, title: "Example", url: "https://example.test/page" });
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
});
