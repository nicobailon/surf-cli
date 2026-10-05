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
  shadowRoot: { querySelectorAll(selector: string): FakeElement[] } | null = null;
  shadowParent: FakeShadowRoot | null = null;
  popoverOpen = false;
  pickerOpen = false;
  invalid = false;
  userInvalid = false;
  namespaceURI = "http://www.w3.org/1999/xhtml";

  get parentNode(): FakeElement | FakeShadowRoot | null {
    return this.parentElement ?? this.shadowParent;
  }
  rect = { top: 0, bottom: 10, left: 0, right: 10 };
  computed: Record<string, string> = {};

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

  contains(other: FakeElement | null): boolean {
    for (let node = other; node; node = node.parentElement) {
      if (node === this) {
        return true;
      }
    }
    return false;
  }

  getRootNode(): unknown {
    return document;
  }

  querySelector(): FakeElement | null {
    return null;
  }

  matches(selector: string): boolean {
    return selector.split(/,\s*/).some((part) => this.matchesPart(part));
  }

  private matchesPart(part: string): boolean {
    // `tag:pseudo`, as in "select:open", matches the tag and then the pseudo-class.
    const tagged = /^([a-z]+)(:.+)$/.exec(part);
    if (tagged) {
      return tagged[1] === this.tagName.toLowerCase() && this.matchesPart(tagged[2]);
    }
    const states: Record<string, () => boolean> = {
      ":read-write": () => ["INPUT", "TEXTAREA"].includes(this.tagName) || this.isContentEditable,
      "[popover]": () => this.hasAttribute("popover"),
      ":popover-open": () => this.popoverOpen,
      ":open": () => this.pickerOpen,
      ":invalid": () => this.invalid,
      ":user-invalid": () => this.userInvalid,
    };
    return states[part]?.() ?? part === this.tagName.toLowerCase();
  }

  querySelectorAll(selector: string): FakeElement[] {
    const descendants = this.children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
    return selector === "*" ? descendants : descendants.filter((node) => node.matches(selector));
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

  // Fields paint nothing while the surf vision sheet is adopted.
  hiddenBySheet(): boolean {
    const field =
      this instanceof FakeInputElement ||
      this instanceof FakeTextAreaElement ||
      this.isContentEditable;
    return field && (globalThis as any).document.adoptedStyleSheets?.length > 0;
  }
}

class FakeShadowRoot {
  adoptedStyleSheets: Array<{ text: string }> = [];
  activeElement: FakeElement | null = null;

  constructor(
    public host: FakeElement,
    private nodes: FakeElement[],
  ) {
    for (const node of nodes) {
      node.shadowParent = this;
    }
  }

  querySelectorAll(selector: string): FakeElement[] {
    const all = this.nodes.flatMap((node) => [node, ...node.querySelectorAll("*")]);
    return selector === "*" ? all : all.filter((node) => node.matches(selector));
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
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

  takeRecords(): unknown[] {
    return [];
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
    (globalThis as any).ShadowRoot = FakeShadowRoot;
    (globalThis as any).CSSStyleSheet = class {
      text = "";
      replaceSync(cssText: string): void {
        this.text = cssText;
      }
    };
    (globalThis as any).requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);
    FakeMutationObserver.active.clear();

    (globalThis as any).window = {
      innerWidth: 1024,
      innerHeight: 768,
      location: { href: "https://example.test/page" },
      getComputedStyle: (node?: FakeElement, pseudo?: string) => ({
        display:
          pseudo === "::picker(select)"
            ? (node?.computed.picker ?? "none")
            : (node?.computed.display ?? "block"),
        visibility: "visible",
        opacity: node?.computed.opacity ?? (node?.hiddenBySheet() ? "0" : "1"),
        webkitUserModify: node?.computed.webkitUserModify ?? "read-only",
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
      adoptedStyleSheets: [],
      designMode: "off",
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

  const iconToolbar = () => {
    const settings = element("button");
    settings.rect = { top: 10, bottom: 34, left: 10, right: 34 };
    const share = element("a", { href: "/share" });
    share.rect = { top: 10, bottom: 34, left: 50, right: 74 };
    const save = element("button");
    save.append(text("Save"));
    const search = new FakeInputElement("input");
    const notes = new FakeTextAreaElement("textarea");
    const editor = element("div", { tabindex: "0" });
    editor.isContentEditable = true;
    (document.body as unknown as FakeElement).append(settings, share, save, search, notes, editor);
    const entries = { settings, share, save, search, notes, editor };
    window.__piElementMap = Object.fromEntries(
      Object.entries(entries).map(([ref, node]) => [
        ref,
        { element: new WeakRef(node as unknown as Element), role: "", name: "" },
      ]),
    );
    return entries;
  };

  it("lists unnamed non-field candidates for vision without changing the observation", () => {
    iconToolbar();
    const plain = sendMessage({
      type: "GENERATE_ACCESSIBILITY_TREE",
      options: { semanticObservation: true },
    });
    const withVision = sendMessage({
      type: "GENERATE_ACCESSIBILITY_TREE",
      options: { semanticObservation: true, semanticVision: true },
    });

    expect(plain).not.toHaveProperty("semanticVisionTargets");
    expect(withVision.semanticObservation).toEqual(plain.semanticObservation);
    expect(withVision.semanticObservation).not.toHaveProperty("vision");
    expect(JSON.stringify(withVision.semanticObservation)).not.toContain('"rect"');
    expect(
      withVision.semanticObservation.candidates
        .filter((candidate: any) => candidate.name === "")
        .map((candidate: any) => candidate.ref),
    ).toEqual(["settings", "share", "search", "notes", "editor"]);
    expect(withVision.semanticVisionTargets).toEqual([
      { ref: "settings", rect: { x: 10, y: 10, width: 24, height: 24 } },
      { ref: "share", rect: { x: 50, y: 10, width: 24, height: 24 } },
    ]);
  });

  const prepare = () =>
    new Promise<any>((resolve) => {
      messageHandler?.({ type: "SEMANTIC_VISION_PREPARE" }, {}, resolve);
    });
  const recheck = (refs: string[] = []) => sendMessage({ type: "SEMANTIC_VISION_RECHECK", refs });
  // A toolbar with an in-viewport input, an offscreen textarea, and an input in a closed shadow root.
  const visionPage = () => {
    const toolbar = iconToolbar();
    const glyph = element("svg");
    toolbar.settings.append(glyph);
    (document as any).elementFromPoint = (x: number) => (x < 40 ? glyph : element("div"));
    toolbar.search.rect = { top: 20, bottom: 40, left: 30, right: 230 };
    toolbar.notes.rect = { top: 2000, bottom: 2100, left: 0, right: 200 };
    const closedField = new FakeInputElement("input");
    closedField.rect = { top: 100, bottom: 120, left: 0, right: 200 };
    const host = element("custom-widget");
    const closedRoot = {
      adoptedStyleSheets: [] as object[],
      querySelectorAll: (selector: string) => (selector === "*" ? [closedField] : []),
      querySelector: (_selector: string): FakeElement | null => null,
    };
    const elements: FakeElement[] = [toolbar.settings, toolbar.search, toolbar.notes, host];
    (document as any).querySelectorAll = (selector: string) =>
      selector === "*" ? elements : elements.filter((node) => node.matches(selector));
    (document as any).querySelector = (selector: string) =>
      (document as any).querySelectorAll(selector)[0] ?? null;
    (globalThis as any).chrome.dom = {
      openOrClosedShadowRoot: (node: FakeElement) => (node === host ? closedRoot : null),
    };
    return { ...toolbar, closedField, host, closedRoot, elements };
  };

  it("hides every field for the capture, masks their border boxes, and restores them at the recheck", async () => {
    const { closedRoot } = visionPage();

    const prepared = await prepare();

    expect(prepared).toEqual({
      masks: [
        { x: 30, y: 20, width: 200, height: 20 },
        { x: 0, y: 100, width: 200, height: 20 },
      ],
    });
    expect((document as any).adoptedStyleSheets).toHaveLength(1);
    expect(closedRoot.adoptedStyleSheets).toEqual((document as any).adoptedStyleSheets);
    expect((document as any).adoptedStyleSheets[0].text).toMatch(
      /^@layer surf-vision \{[\s\S]*\{ opacity: 0 !important; transition: none !important; \}\s*\}$/,
    );

    expect(recheck(["settings", "share", "missing"])).toEqual({
      viewport: { width: 1024, height: 768 },
      current: { settings: { x: 10, y: 10, width: 24, height: 24 }, share: null, missing: null },
      masks: [
        { x: 30, y: 20, width: 200, height: 20 },
        { x: 0, y: 100, width: 200, height: 20 },
      ],
      fieldsChanged: false,
    });
    expect((document as any).adoptedStyleSheets).toEqual([]);
    expect(closedRoot.adoptedStyleSheets).toEqual([]);
    expect(recheck().fieldsChanged).toBe(true);
  });

  it("skips the read when fields cannot be proven hidden", async () => {
    const { search, host } = visionPage();
    const skipped = async () => {
      expect(await prepare()).toEqual({ masks: [null] });
      expect((document as any).adoptedStyleSheets).toEqual([]);
    };

    (document as any).designMode = "on";
    await skipped();
    (document as any).designMode = "off";
    (document as any).activeViewTransition = {};
    await skipped();
    (document as any).activeViewTransition = null;
    search.computed.display = "contents";
    await skipped();
    search.computed = { opacity: "1" };
    await skipped();
    search.computed = {};
    (globalThis as any).chrome.dom = {
      openOrClosedShadowRoot: (node: FakeElement) => {
        if (node === host) {
          throw new Error("cannot read root");
        }
        return null;
      },
    };
    await skipped();
    (globalThis as any).chrome.dom = undefined;
    await skipped();
    (globalThis as any).chrome.dom = { openOrClosedShadowRoot: () => null };
    search.rect = { top: Number.NaN, bottom: 40, left: 30, right: 230 };
    await skipped();
  });

  it("hides and verifies every open top-layer element inside a field, across shadow roots", async () => {
    const { settings, elements } = visionPage();
    // A non-editable chip inside an editor, with an open popover in its shadow tree.
    const editor = element("div");
    editor.isContentEditable = true;
    editor.rect = { top: 300, bottom: 320, left: 400, right: 460 };
    const chip = element("span", { contenteditable: "false" });
    editor.append(chip);
    const chipPopover = element("div", { popover: "manual" });
    chipPopover.popoverOpen = true;
    chipPopover.rect = { top: 100, bottom: 140, left: 100, right: 160 };
    const chipRoot = new FakeShadowRoot(chip, [chipPopover]);
    // An explicit combobox with an open popover child in the light DOM.
    const combobox = element("div", { role: "combobox" });
    combobox.rect = { top: 400, bottom: 420, left: 400, right: 460 };
    const listbox = element("div", { popover: "manual" });
    listbox.popoverOpen = true;
    listbox.rect = { top: 200, bottom: 240, left: 100, right: 160 };
    combobox.append(listbox);
    // An open popover menu outside any field.
    const menu = element("div", { popover: "manual" });
    menu.popoverOpen = true;
    menu.rect = { top: 500, bottom: 540, left: 100, right: 160 };
    elements.push(editor, chip, combobox, listbox, menu);
    (globalThis as any).chrome.dom = {
      openOrClosedShadowRoot: (node: FakeElement) => (node === chip ? chipRoot : null),
    };
    chipPopover.computed.opacity = "0";
    listbox.computed.opacity = "0";
    combobox.computed.opacity = "0";

    const { masks } = await prepare();
    expect(masks).toContainEqual({ x: 100, y: 100, width: 60, height: 40 });
    expect(masks).toContainEqual({ x: 100, y: 200, width: 60, height: 40 });
    expect(masks).not.toContainEqual({ x: 100, y: 500, width: 60, height: 40 });
    const [documentSheet] = (document as any).adoptedStyleSheets;
    expect(documentSheet.text).toContain(":read-write) :is([popover], dialog, :fullscreen)");
    // The chip's shadow root is inside a field, so its sheet hides every top-layer element.
    expect(chipRoot.adoptedStyleSheets[0]).not.toBe(documentSheet);
    expect(chipRoot.adoptedStyleSheets[0].text).toMatch(/, \[popover\], dialog, :fullscreen\n/);
    expect(recheck().fieldsChanged).toBe(false);
    expect(chipRoot.adoptedStyleSheets).toEqual([]);

    // A top-layer element inside a field that still paints skips the read, in a shadow root or the light DOM.
    for (const leaking of [chipPopover, listbox]) {
      leaking.computed.opacity = "1";
      expect(await prepare()).toEqual({ masks: [null] });
      leaking.computed.opacity = "0";
    }
    // A popover opened inside a field after the fields were hidden is caught at the recheck.
    await prepare();
    listbox.computed.opacity = "1";
    expect(recheck().fieldsChanged).toBe(true);
    listbox.computed.opacity = "0";

    // Content made editable by CSS has no selector, so the read is skipped.
    settings.computed.webkitUserModify = "read-write";
    expect(await prepare()).toEqual({ masks: [null] });
  });

  it("follows slots to fields in the flat tree, and skips the read while a native picker or validation message may show", async () => {
    const { elements } = visionPage();
    const slotOf = (assigned: FakeElement[]) =>
      Object.assign(element("slot"), { assignedElements: () => assigned });
    const openPopover = (top: number) => {
      const popover = element("div", { popover: "manual" });
      popover.popoverOpen = true;
      popover.rect = { top, bottom: top + 40, left: 100, right: 160 };
      return popover;
    };
    // <ui-combobox> renders its light-DOM popover inside a role=combobox through a slot (assignedSlot is null when
    // the root is closed, so the slot map comes from the slots).
    const comboboxHost = element("ui-combobox");
    const slotted = openPopover(100);
    comboboxHost.append(slotted);
    const comboboxRoot = new FakeShadowRoot(comboboxHost, [
      Object.assign(element("div", { role: "combobox" }), {
        rect: { top: 300, bottom: 320, left: 400, right: 460 },
      }),
    ]);
    comboboxRoot.querySelectorAll("div")[0].append(slotOf([slotted]));
    // <ui-outer> forwards its popover through its own slot into an inner role=combobox slot.
    const outerHost = element("ui-outer");
    const chained = openPopover(200);
    outerHost.append(chained);
    const innerHost = element("ui-inner");
    const outerSlot = slotOf([chained]);
    innerHost.append(outerSlot);
    const outerRoot = new FakeShadowRoot(outerHost, [innerHost]);
    const innerField = element("div", { role: "combobox" });
    innerField.append(slotOf([outerSlot]));
    const innerRoot = new FakeShadowRoot(innerHost, [innerField]);
    // A popover menu slotted beside a field, not into it.
    const menuHost = element("ui-menu");
    const menu = openPopover(500);
    menuHost.append(menu);
    const menuRoot = new FakeShadowRoot(menuHost, [
      element("div", { role: "combobox" }),
      element("div"),
    ]);
    menuRoot.querySelectorAll("div")[1].append(slotOf([menu]));
    const select = new FakeSelectElement("select");
    select.computed.opacity = "0";
    elements.push(comboboxHost, slotted, outerHost, chained, menuHost, menu, select);
    const roots = new Map<FakeElement, FakeShadowRoot>([
      [comboboxHost, comboboxRoot],
      [outerHost, outerRoot],
      [innerHost, innerRoot],
      [menuHost, menuRoot],
    ]);
    (globalThis as any).chrome.dom = {
      openOrClosedShadowRoot: (node: FakeElement) => roots.get(node) ?? null,
    };
    for (const root of roots.values()) {
      for (const field of root.querySelectorAll("div")) {
        field.computed.opacity = "0";
      }
    }

    // Slotted popovers that still paint skip the read; the menu beside the field does not.
    expect(await prepare()).toEqual({ masks: [null] });
    slotted.computed.opacity = "0";
    expect(await prepare()).toEqual({ masks: [null] });
    chained.computed.opacity = "0";
    const { masks } = await prepare();
    expect(masks).toContainEqual({ x: 100, y: 100, width: 60, height: 40 });
    expect(masks).toContainEqual({ x: 100, y: 200, width: 60, height: 40 });
    expect(masks).not.toContainEqual({ x: 100, y: 500, width: 60, height: 40 });
    expect((document as any).adoptedStyleSheets[0].text).toContain(
      ":read-write) ::slotted(:is([popover], dialog, :fullscreen))",
    );
    expect(recheck().fieldsChanged).toBe(false);

    // A closed popover inside a field is checked too: one still rendered while closing (an exit transition) skips
    // the read, at the recheck too; a closed one (display: none) passes.
    slotted.popoverOpen = false;
    slotted.computed.opacity = "1";
    expect(await prepare()).toEqual({ masks: [null] });
    slotted.computed.display = "none";
    expect((await prepare()).masks).not.toContain(null);
    slotted.computed.display = "block";
    expect(recheck().fieldsChanged).toBe(true);
    slotted.computed.display = "none";

    // A select picker that is open, or closing (no longer `:open` but still rendered), is out of reach, so the read
    // is skipped, at the recheck too.
    select.pickerOpen = true;
    expect(await prepare()).toEqual({ masks: [null] });
    select.pickerOpen = false;
    select.computed.picker = "block";
    expect(await prepare()).toEqual({ masks: [null] });
    select.computed.picker = "none";
    await prepare();
    select.computed.picker = "block";
    expect(recheck().fieldsChanged).toBe(true);
    select.computed.picker = "none";
    await prepare();
    select.pickerOpen = true;
    expect(recheck().fieldsChanged).toBe(true);
    select.pickerOpen = false;

    // Any field with an open native picker (a date or time input's, drawn inside the page) skips the read; an open
    // element that is not a field, such as <details>, does not.
    const dateInput = new FakeInputElement("input");
    dateInput.computed.opacity = "0";
    const details = element("details");
    // An open <details> inside an editor matches `:open` and `:read-write`, but is no input or select.
    details.isContentEditable = true;
    details.computed.opacity = "0";
    details.pickerOpen = true;
    elements.push(dateInput, details);
    expect(await prepare()).not.toEqual({ masks: [null] });
    recheck();
    dateInput.pickerOpen = true;
    expect(await prepare()).toEqual({ masks: [null] });
    dateInput.pickerOpen = false;

    // Chrome may be showing a validation message for the focused field, found through shadow roots, when it is an
    // invalid native field; the read is skipped, at the recheck too. Focus elsewhere does not skip.
    const email = new FakeInputElement("input");
    email.computed.opacity = "0";
    email.invalid = true;
    (document as any).activeElement = comboboxHost;
    comboboxRoot.activeElement = email;
    expect(await prepare()).toEqual({ masks: [null] });
    email.invalid = false;
    await prepare();
    email.invalid = true;
    expect(recheck().fieldsChanged).toBe(true);
    comboboxRoot.activeElement = null;
    expect(await prepare()).not.toEqual({ masks: [null] });
    recheck();
  });

  it("answers whether this frame shows a picker or validation message, and leaves frames to themselves", async () => {
    const { elements, closedRoot } = visionPage();
    const frameSurfaces = () => sendMessage({ type: "SEMANTIC_VISION_FRAME_SURFACES" });
    expect(frameSurfaces()).toEqual({ shown: false });

    // A picker open, or a select picker still closing, in this document.
    const date = new FakeInputElement("input");
    date.computed.opacity = "0";
    elements.push(date);
    date.pickerOpen = true;
    expect(frameSurfaces()).toEqual({ shown: true });
    date.pickerOpen = false;
    const select = new FakeSelectElement("select");
    select.computed.opacity = "0";
    elements.push(select);
    select.computed.picker = "block";
    expect(frameSurfaces()).toEqual({ shown: true });
    select.computed.picker = "none";

    // A failed submit in a closed shadow root.
    const shadowed = new FakeInputElement("input");
    shadowed.userInvalid = true;
    closedRoot.querySelector = (selector: string) => (shadowed.matches(selector) ? shadowed : null);
    expect(frameSurfaces()).toEqual({ shown: true });
    shadowed.userInvalid = false;

    // The focused field is invalid; with no chrome.dom the frame can't check, so it answers shown.
    (document as any).activeElement = date;
    date.invalid = true;
    expect(frameSurfaces()).toEqual({ shown: true });
    date.invalid = false;
    expect(frameSurfaces()).toEqual({ shown: false });
    const dom = (globalThis as any).chrome.dom;
    (globalThis as any).chrome.dom = undefined;
    expect(frameSurfaces()).toEqual({ shown: true });
    (globalThis as any).chrome.dom = dom;

    // The page no longer reads frame documents, nor treats focus on a frame as a skip: each frame answers itself.
    const frameField = new FakeInputElement("input");
    frameField.userInvalid = true;
    const frame = Object.assign(element("iframe"), {
      contentDocument: {
        querySelector: () => frameField,
        querySelectorAll: () => [frameField],
        activeElement: frameField,
      },
    });
    frame.computed.opacity = "0";
    elements.push(frame);
    (document as any).activeElement = frame;
    expect(await prepare()).not.toEqual({ masks: [null] });
    recheck();
  });

  it("reports any change between hiding the fields and the recheck", async () => {
    const { search, host, closedRoot, elements } = visionPage();

    await prepare();
    FakeMutationObserver.mutate([{ type: "attributes", target: element("div") }]);
    expect(recheck().fieldsChanged).toBe(true);

    await prepare();
    const lateRoot = {
      adoptedStyleSheets: [],
      querySelectorAll: () => [],
      querySelector: () => null,
    };
    const lateHost = element("late-widget");
    elements.push(lateHost);
    (globalThis as any).chrome.dom = {
      openOrClosedShadowRoot: (node: FakeElement) =>
        new Map<FakeElement, object>([
          [host, closedRoot],
          [lateHost, lateRoot],
        ]).get(node) ?? null,
    };
    expect(recheck().fieldsChanged).toBe(true);
    elements.pop();

    await prepare();
    search.computed = { opacity: "1" };
    expect(recheck().fieldsChanged).toBe(true);
    search.computed = {};

    await prepare();
    closedRoot.adoptedStyleSheets = [];
    expect(recheck().fieldsChanged).toBe(true);
  });

  it("restores the fields after 2 s or on release without a recheck", async () => {
    const { closedRoot } = visionPage();
    vi.useFakeTimers();
    const prepared = prepare();
    await vi.advanceTimersByTimeAsync(100);
    expect((await prepared).masks).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect((document as any).adoptedStyleSheets).toEqual([]);
    expect(closedRoot.adoptedStyleSheets).toEqual([]);
    expect(recheck().fieldsChanged).toBe(true);

    const again = prepare();
    await vi.advanceTimersByTimeAsync(100);
    await again;
    expect(sendMessage({ type: "SEMANTIC_VISION_RELEASE" })).toEqual({ released: true });
    expect((document as any).adoptedStyleSheets).toEqual([]);
    expect(recheck().fieldsChanged).toBe(true);
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
