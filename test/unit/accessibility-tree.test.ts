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

  beforeEach(async () => {
    vi.resetModules();
    messageHandler = undefined;

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
      getComputedStyle: () => ({
        display: "block",
        visibility: "visible",
        opacity: "1",
        cursor: "default",
      }),
    };

    (globalThis as any).document = {
      body: new FakeElement("body"),
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
});
