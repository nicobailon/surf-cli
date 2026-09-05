// biome-ignore-all format: fake DOM picker harness intentionally keeps branchy selector and CDP doubles local to the regression tests.
// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity lint/style/useBlockStatements lint/style/noNestedTernary: fake DOM picker harness intentionally keeps branchy selector and CDP doubles local to the regression tests.
import { vi } from "vitest";
// @ts-expect-error - CommonJS module without type definitions
import * as chatgptClient from "../../native/chatgpt-client.cjs";
// @ts-expect-error - CommonJS module without type definitions
import * as chatgptClientUi from "../../native/chatgpt-client-ui.cjs";

function createReadyChatGptEvaluate(
  loginStatus: Record<string, unknown> = { status: 200, hasLoginCta: false },
) {
  return async (_tabId: number, expression: string) => {
    if (expression === "document.readyState") {
      return { result: { value: "complete" } };
    }
    if (expression === "document.title.toLowerCase()") {
      return { result: { value: "chatgpt" } };
    }
    if (expression.includes("challenge-platform") || expression.includes("cloudflare ray id")) {
      return { result: { value: false } };
    }
    if (expression.includes("fetch('/backend-api/me'")) {
      return { result: { value: loginStatus } };
    }
    if (expression.includes("const selectors") && expression.includes("prompt-textarea")) {
      return { result: { value: true } };
    }
    throw new Error(`Unexpected expression: ${expression}`);
  };
}

describe("chatgpt-client", () => {
  describe("isCloudflareBlocked", () => {
    it("does not treat normal logged-in ChatGPT pages with challenge scripts as blocked", async () => {
      const result = await chatgptClient.isCloudflareBlocked(async (expression: string) => {
        if (expression === "document.title.toLowerCase()") {
          return { result: { value: "chatgpt" } };
        }
        return { result: { value: false } };
      });

      expect(result).toBe(false);
    });

    it("detects visible Cloudflare challenge pages", async () => {
      const result = await chatgptClient.isCloudflareBlocked(async (expression: string) => {
        if (expression === "document.title.toLowerCase()") {
          return { result: { value: "chatgpt" } };
        }
        return { result: { value: true } };
      });

      expect(result).toBe(true);
    });
  });

  describe("cleanChatGPTResponseText", () => {
    it.each([
      [
        "trims outer blank lines and strips only trailing chrome clusters",
        ["", "Copy", "Answer line", "Read aloud", "Share", ""].join("\n"),
        "Copy\nAnswer line",
      ],
      [
        "preserves markdown and code fences",
        [
          "Good response",
          "Here is code:",
          "```js",
          "Copy",
          "const x = 1;    ",
          "```",
          "Retry",
        ].join("\r\n"),
        ["Good response", "Here is code:", "```js", "Copy", "const x = 1;", "```", "Retry"].join(
          "\n",
        ),
      ],
      ["preserves legitimate standalone single-word response: Copy", "Copy", "Copy"],
      ["preserves legitimate standalone single-word response: Edit", "Edit", "Edit"],
      [
        "strips only trailing chrome clusters",
        ["Answer line", "Copy", "Read aloud"].join("\n"),
        "Answer line",
      ],
      [
        "preserves a single trailing chrome-like line",
        ["Answer line", "Edit"].join("\n"),
        "Answer line\nEdit",
      ],
    ])("%s", (_, input, expected) => {
      expect(chatgptClient.cleanChatGPTResponseText(input)).toBe(expected);
    });
  });

  describe("extractLatestAssistantSnapshot", () => {
    it("returns latest populated assistant", () => {
      const snapshot = chatgptClient.extractLatestAssistantSnapshot([
        { role: "user", turn: "user", text: "hello" },
        {
          role: "assistant",
          turn: "assistant",
          isAssistant: true,
          text: "Earlier answer",
          messageId: "msg-1",
        },
        {
          role: "assistant",
          turn: "assistant",
          isAssistant: true,
          text: "Final answer\nCopy\nRead aloud",
          messageId: "msg-2",
          hasFinishedActions: true,
        },
      ]);

      expect(snapshot).toEqual({
        role: "assistant",
        turn: "assistant",
        isAssistant: true,
        text: "Final answer",
        messageId: "msg-2",
        hasFinishedActions: true,
        turnIndex: 2,
      });
    });

    it("prefers populated over empty trailing shell", () => {
      const snapshot = chatgptClient.extractLatestAssistantSnapshot([
        {
          role: "assistant",
          turn: "assistant",
          isAssistant: true,
          text: "Actual reply",
          messageId: "msg-1",
        },
        {
          role: "assistant",
          turn: "assistant",
          isAssistant: true,
          text: "\n\nCopy\nRead aloud\n",
          messageId: "msg-2",
        },
      ]);

      expect(snapshot).toEqual({
        role: "assistant",
        turn: "assistant",
        isAssistant: true,
        text: "Actual reply",
        messageId: "msg-1",
        turnIndex: 0,
      });
    });

    it("falls back to empty assistant when all are empty", () => {
      const snapshot = chatgptClient.extractLatestAssistantSnapshot([
        { role: "assistant", turn: "assistant", isAssistant: true, text: "", messageId: "msg-1" },
        {
          role: "assistant",
          turn: "assistant",
          isAssistant: true,
          text: "\n\n",
          messageId: "msg-2",
        },
      ]);

      expect(snapshot).toEqual({
        role: "assistant",
        turn: "assistant",
        isAssistant: true,
        text: "",
        messageId: "msg-2",
        turnIndex: 1,
      });
    });

    it("returns null for non-assistant candidates only", () => {
      expect(
        chatgptClient.extractLatestAssistantSnapshot([
          { role: "user", turn: "user", text: "hello" },
        ]),
      ).toBeNull();
    });

    it("accepts isAssistant: true without role/turn metadata", () => {
      const snapshot = chatgptClient.extractLatestAssistantSnapshot([
        { role: null, turn: null, isAssistant: true, text: "Answer from testid-only node" },
      ]);

      expect(snapshot?.text).toBe("Answer from testid-only node");
      expect(snapshot?.turnIndex).toBe(0);
    });
  });


  describe("normalizeChatGPTModelChoice", () => {
    it.each([
      ["Latest", "latest"],
      ["GPT-6 Astra", "gpt6astra"],
      ["GPT-6", "gpt6astra"],
      ["6", "gpt6astra"],
      ["GPT-5.5", "gpt55"],
      ["ChatGPT 5.5", "gpt55"],
      ["5.5", "gpt55"],
      ["GPT-5.6 Sol", "gpt56sol"],
      ["ChatGPT 5.6 Sol", "gpt56sol"],
      ["5.6 Sol", "gpt56sol"],
      ["something-else", "somethingelse"],
    ])("normalizes %s", (input, expected) => {
      expect(chatgptClient.normalizeChatGPTModelChoice(input)).toBe(expected);
    });
  });

  describe("resolveChatGPTModelMenuOption", () => {
    const currentOptions = [
      { role: "menuitemradio", label: "Latest", testId: null },
      { role: "menuitemradio", label: "GPT-5.6 Sol", testId: null },
      { role: "menuitemradio", label: "GPT-5.5", testId: null },
      { role: "menuitem", label: "Configure...", testId: "model-configure-modal" },
    ];

    it("selects the current model menu entries", () => {
      expect(chatgptClient.resolveChatGPTModelMenuOption(currentOptions, "gpt-5.6-sol")).toEqual({
        role: "menuitemradio",
        label: "GPT-5.6 Sol",
        testId: null,
      });
      expect(chatgptClient.resolveChatGPTModelMenuOption(currentOptions, "gpt-5.5")).toEqual({
        role: "menuitemradio",
        label: "GPT-5.5",
        testId: null,
      });
      expect(chatgptClient.resolveChatGPTModelMenuOption(currentOptions, "latest")).toEqual({
        role: "menuitemradio",
        label: "Latest",
        testId: null,
      });
    });

    it("uses Latest as the selectable row for GPT-6 Astra but not as verification evidence", () => {
      expect(chatgptClient.resolveChatGPTModelMenuOption(currentOptions, "gpt-6-astra")).toEqual({
        role: "menuitemradio",
        label: "Latest",
        testId: null,
      });
      expect(
        chatgptClient.verifyChatGPTModelSelection(
          [{ role: "menuitemradio", label: "Latest", selected: true, testId: null }],
          "gpt-6-astra",
        ),
      ).toBeNull();
      expect(
        chatgptClient.verifyChatGPTModelSelection(
          [{ role: "menuitemradio", label: "GPT-5.6 Sol", selected: false, testId: null }],
          "gpt-5.6-sol",
        ),
      ).toBeNull();
    });
  });

  describe("verified ChatGPT picker state", () => {
    it.each([
      ["GPT-6 Astra readback from current pill", [{ role: "button", label: "6 Pro" }], "gpt-6-astra", "6 Pro"],
      ["GPT-5.5 readback", [{ role: "button", label: "5.5 Pro" }], "gpt-5.5", "5.5 Pro"],
      ["GPT-5.6 Sol readback", [{ role: "button", label: "5.6 Sol Pro" }], "gpt-5.6-sol", "5.6 Sol Pro"],
      ["Latest explicit readback", [{ role: "menuitemradio", label: "Latest", selected: true }], "latest", "Latest"],
      ["GPT-6 Astra rejects floating Latest alone", [{ role: "menuitemradio", label: "Latest", selected: true }], "gpt-6-astra", null],
      ["requested model missing", [{ role: "button", label: "5.6 Sol Pro" }], "gpt-6-astra", null],
      ["ambiguous model state", [{ role: "button", label: "6 Pro" }, { role: "menuitem", label: "GPT-6 Astra" }], "gpt-6-astra", null],
    ])("handles %s", (_, items, requested, expectedLabel) => {
      expect(chatgptClient.verifyChatGPTModelSelection(items, requested)?.label ?? null).toBe(
        expectedLabel,
      );
    });

    it.each([
      ["Instant", [{ role: "slider", label: "Instant, 1 of 5.", value: 0 }], "instant", "Instant, 1 of 5."],
      ["Medium", [{ role: "slider", label: "Medium, 2 of 5.", value: 1 }], "medium", "Medium, 2 of 5."],
      ["High", [{ role: "slider", label: "High, 3 of 5.", value: 2 }], "high", "High, 3 of 5."],
      ["Extra High", [{ role: "slider", label: "Extra High, 4 of 5.", value: 3 }], "xhigh", "Extra High, 4 of 5."],
      ["Pro", [{ role: "slider", label: "Pro, 5 of 5.", value: 4 }], "pro", "Pro, 5 of 5."],
      ["max value without label evidence", [{ role: "slider", label: "", value: 4 }], "pro", null],
      ["obsolete effort name rejected", [{ role: "slider", label: "High, 3 of 5.", value: 2 }], "extended", null],
    ])("handles effort %s", (_, items, requested, expectedLabel) => {
      expect(chatgptClient.verifyChatGPTEffortSelection(items, requested)?.label ?? null).toBe(
        expectedLabel,
      );
    });

    it("resolves effort options and accepts only the current vocabulary", () => {
      const options = [
        { role: "slider", label: "Instant", value: 0 },
        { role: "slider", label: "Medium", value: 1 },
        { role: "slider", label: "High", value: 2 },
        { role: "slider", label: "Extra High", value: 3 },
        { role: "slider", label: "Pro", value: 4 },
      ];
      expect(chatgptClient.resolveChatGPTEffortMenuOption(options, "extra-high")).toEqual(options[3]);
      expect(chatgptClient.normalizeChatGPTEffortChoice("xhigh")).toBe("xhigh");
      expect(chatgptClient.normalizeChatGPTEffortChoice("Pro")).toBe("pro");
      expect(chatgptClient.normalizeChatGPTEffortChoice("standard")).toBeNull();
    });
  });

  describe("current combined ChatGPT picker DOM operations", () => {
    class FakeEventTarget {
      nodeType = 1;

      dispatchEvent(event: { type?: string; key?: string }) {
        if (event.type === "click") {
          this.handleClick();
        }
        if (event.type === "keydown") {
          this.handleKey(event.key || "");
        }
        return true;
      }

      handleClick(): void {
        // Default no-op for base fake target.
      }
      handleKey(_key: string): void {
        // Default no-op for base fake target.
      }
    }

    class FakeElement extends FakeEventTarget {
      tagName: string;
      attributes: Record<string, string>;
      className: string;
      children: FakeElement[];
      parentElement: FakeElement | null = null;
      textContent: string;
      innerText: string;
      onClick?: () => void;
      onKey?: (key: string) => void;

      constructor(tagName: string, text: string, attributes: Record<string, string> = {}, children: FakeElement[] = []) {
        super();
        this.tagName = tagName.toUpperCase();
        this.textContent = text;
        this.innerText = text;
        this.attributes = { ...attributes };
        this.className = attributes.class || "";
        this.children = children;
        for (const child of children) {
          child.parentElement = this;
        }
      }

      getAttribute(name: string) {
        return this.attributes[name] ?? null;
      }

      hasAttribute(name: string) {
        return Object.hasOwn(this.attributes, name);
      }

      setAttribute(name: string, value: string) {
        this.attributes[name] = value;
        if (name === "class") {
          this.className = value;
        }
      }

      removeAttribute(name: string) {
        delete this.attributes[name];
      }

      getBoundingClientRect() {
        return { width: 10, height: 10 };
      }

      focus() {
        fakeDocument.activeElement = this;
      }

      blur() {
        if (fakeDocument.activeElement === this) {
          fakeDocument.activeElement = null;
        }
      }

      handleClick() {
        this.onClick?.();
      }

      handleKey(key: string) {
        this.onKey?.(key);
      }

      querySelectorAll(selector: string) {
        return querySelectorAll(this, selector, false);
      }

      querySelector(selector: string) {
        return this.querySelectorAll(selector)[0] || null;
      }
    }

    const fakeDocument: {
      body: FakeElement;
      activeElement: FakeElement | null;
      getElementById(id: string): FakeElement | null;
      querySelectorAll(selector: string): FakeElement[];
      querySelector(selector: string): FakeElement | null;
    } = {
      body: new FakeElement("body", ""),
      activeElement: null,
      getElementById: () => null,
      querySelectorAll: (selector) => querySelectorAll(fakeDocument.body, selector, true),
      querySelector: (selector) => fakeDocument.querySelectorAll(selector)[0] || null,
    };

    class FakeMouseEvent {
      constructor(readonly type: string, readonly init: unknown) {}
    }

    class FakeKeyboardEvent extends FakeMouseEvent {
      key: string;

      constructor(type: string, init: { key?: string }) {
        super(type, init);
        this.key = init.key || "";
      }
    }

    function descendants(root: FakeElement, includeSelf: boolean) {
      const nodes: FakeElement[] = includeSelf ? [root] : [];
      for (const child of root.children) {
        nodes.push(child, ...descendants(child, false));
      }
      return nodes;
    }

    function hasHiddenAncestor(node: FakeElement) {
      for (let current: FakeElement | null = node; current; current = current.parentElement) {
        if (current.hasAttribute("hidden") || current.hasAttribute("inert") || current.getAttribute("aria-hidden") === "true") {
          return true;
        }
      }
      return false;
    }

    const selectorMatchers = new Map<string, (node: FakeElement) => boolean>([
      ["span", (node) => node.tagName === "SPAN"],
      [
        "button.__composer-pill[aria-haspopup=\"menu\"]",
        (node) => node.tagName === "BUTTON" && node.className.includes("__composer-pill") && node.getAttribute("aria-haspopup") === "menu",
      ],
      ["[role=\"menu\"][data-radix-menu-content]", (node) => node.getAttribute("role") === "menu" && node.hasAttribute("data-radix-menu-content")],
      ["[data-testid=\"composer-intelligence-picker-content\"]", (node) => node.getAttribute("data-testid") === "composer-intelligence-picker-content"],
      ["[data-testid=\"composer-model-picker-slider-simple-view\"]", (node) => node.getAttribute("data-testid") === "composer-model-picker-slider-simple-view"],
      ["[data-testid=\"composer-model-picker-slider-advanced-view\"]", (node) => node.getAttribute("data-testid") === "composer-model-picker-slider-advanced-view"],
      ["[data-view=\"simple\"]", (node) => node.getAttribute("data-view") === "simple"],
      ["[data-view=\"advanced\"]", (node) => node.getAttribute("data-view") === "advanced"],
      ["[role=\"menuitem\"][aria-label=\"Select model\"]", (node) => node.getAttribute("role") === "menuitem" && node.getAttribute("aria-label") === "Select model"],
      ["[role=\"menuitem\"][aria-label=\"Power\"]", (node) => node.getAttribute("role") === "menuitem" && node.getAttribute("aria-label") === "Power"],
      ["[role=\"menuitemradio\"]", (node) => node.getAttribute("role") === "menuitemradio"],
      ["[role=\"slider\"]", (node) => node.getAttribute("role") === "slider"],
      ["[data-model-reasoning-effort-slider]", (node) => node.hasAttribute("data-model-reasoning-effort-slider")],
    ]);

    function matchesSelector(node: FakeElement, selector: string) {
      return selectorMatchers.get(selector.trim())?.(node) ?? false;
    }

    function querySelectorAll(root: FakeElement, selector: string, includeSelf: boolean): FakeElement[] {
      if (selector.includes(",")) {
        return [...new Set(selector.split(",").flatMap((part) => querySelectorAll(root, part, includeSelf)))];
      }
      if (selector.trim() === "[data-model-reasoning-effort-slider] [role=\"slider\"]") {
        return descendants(root, includeSelf).filter((node) =>
          matchesSelector(node, '[role="slider"]') &&
          !hasHiddenAncestor(node.parentElement || node) &&
          descendants(root, includeSelf).some((candidate) => matchesSelector(candidate, "[data-model-reasoning-effort-slider]") && descendants(candidate, false).includes(node)),
        );
      }
      return descendants(root, includeSelf).filter((node) => matchesSelector(node, selector) && !hasHiddenAncestor(node));
    }

    function createPickerDom(options: { model?: string; effort?: number; latestResolvesTo?: string; hiddenSiblingModel?: string; shortSolPill?: boolean } = {}) {
      let open = false;
      let advanced = false;
      let model = options.model || "5.6 Sol";
      let selectedRadio = model === "5.5" ? "GPT-5.5" : model === "5.6 Sol" ? "GPT-5.6 Sol" : "Latest";
      let effort = options.effort ?? 0;
      const labels = ["Instant", "Medium", "High", "Extra High", "Pro"];
      const byId = new Map<string, FakeElement>();
      const button = new FakeElement("button", "", { class: "__composer-pill", "aria-haspopup": "menu" });
      const modelSpan = new FakeElement("span", "");
      const effortSpan = new FakeElement("span", "");
      button.children = [modelSpan, effortSpan];
      modelSpan.parentElement = button;
      effortSpan.parentElement = button;
      button.onClick = () => {
        open = !open;
        refresh();
      };
      fakeDocument.body = new FakeElement("body", "", {}, [button]);
      fakeDocument.getElementById = (id) => byId.get(id) || null;
      fakeDocument.body.onClick = () => {
        open = false;
        refresh();
      };
      const inputEvents: Array<{ key?: string; type?: string }> = [];

      function refresh() {
        const pillModel = options.shortSolPill && model === "5.6 Sol" ? "5.6" : model;
        modelSpan.textContent = pillModel;
        modelSpan.innerText = pillModel;
        effortSpan.textContent = labels[effort];
        effortSpan.innerText = labels[effort];
        button.textContent = `${pillModel}\n${labels[effort]}`;
        button.innerText = button.textContent;
        byId.clear();
        fakeDocument.body.children = [button];
        button.parentElement = fakeDocument.body;
        if (!open) return;
        const modelToggle = new FakeElement("div", `${pillModel} ${labels[effort]}`, {
          role: "menuitem",
          "aria-label": "Select model",
          "aria-expanded": advanced ? "true" : "false",
        }, [new FakeElement("span", pillModel), new FakeElement("span", labels[effort])]);
        modelToggle.onClick = () => {
          advanced = true;
          refresh();
        };
        const simplePanel = new FakeElement("div", "", { "data-view": "simple", "data-testid": "composer-model-picker-slider-simple-view", ...(advanced ? { inert: "" } : {}) });
        const advancedPanel = new FakeElement("div", "", { "data-view": "advanced", "data-testid": "composer-model-picker-slider-advanced-view", ...(advanced ? {} : { inert: "" }) });
        for (const label of ["Latest", "GPT-5.6 Sol", "GPT-5.5"]) {
          const option = new FakeElement("div", label, { role: "menuitemradio", "aria-checked": selectedRadio === label ? "true" : "false", "data-state": selectedRadio === label ? "checked" : "unchecked" });
          option.onClick = () => {
            selectedRadio = label;
            if (label === "Latest") model = options.latestResolvesTo || "6";
            else model = label.replace("GPT-", "");
            advanced = false;
            refresh();
          };
          advancedPanel.children.push(option);
          option.parentElement = advancedPanel;
        }
        if (options.hiddenSiblingModel) {
          const hidden = new FakeElement("div", options.hiddenSiblingModel, { role: "menuitemradio", "aria-checked": "true", "data-state": "checked", hidden: "" });
          simplePanel.children.push(hidden);
          hidden.parentElement = simplePanel;
        }
        const announce = new FakeElement("div", `${labels[effort]}, ${effort + 1} of 5.`, { id: "effort-announcement" });
        const instructions = new FakeElement("div", "Use arrow keys", { id: "effort-instructions" });
        byId.set("effort-announcement", announce);
        byId.set("effort-instructions", instructions);
        const slider = new FakeElement("span", "", { role: "slider", "aria-valuemin": "0", "aria-valuemax": "4", "aria-valuenow": String(effort), tabindex: "-1", "aria-hidden": "true" });
        const sliderWrap = new FakeElement("div", "", { "data-model-reasoning-effort-slider": "" }, [slider]);
        const power = new FakeElement("div", labels[effort], { role: "menuitem", "aria-label": "Power", "aria-keyshortcuts": "ArrowLeft ArrowRight", "aria-describedby": "effort-announcement effort-instructions" }, [sliderWrap, announce, instructions]);
        power.onKey = (key) => {
          if (key === "ArrowRight") effort = Math.min(4, effort + 1);
          if (key === "ArrowLeft") effort = Math.max(0, effort - 1);
          refresh();
        };
        const content = new FakeElement("div", "", { "data-testid": "composer-intelligence-picker-content" }, [modelToggle, simplePanel, advancedPanel, power]);
        const menu = new FakeElement("div", "", { role: "menu", "data-radix-menu-content": "" }, [content]);
        fakeDocument.body.children.push(menu);
        menu.parentElement = fakeDocument.body;
      }

      refresh();
      return {
        cdp: async (expression: string) => ({
          result: {
            value: Function("document", "EventTarget", "MouseEvent", "PointerEvent", "KeyboardEvent", "window", `return ${expression};`)(
              fakeDocument,
              FakeEventTarget,
              FakeMouseEvent,
              undefined,
              FakeKeyboardEvent,
              { getComputedStyle: () => ({ display: "block", visibility: "visible" }) },
            ),
          },
        }),
        inputCdp: async (_method: string, params: { key?: string; type?: string }) => {
          inputEvents.push({ key: params.key, type: params.type });
          if (params.key === "Escape") {
            open = false;
            refresh();
          } else if ((params.key === "ArrowLeft" || params.key === "ArrowRight") && params.type === "keyDown") {
            fakeDocument.activeElement?.dispatchEvent({ type: "keydown", key: params.key });
          }
          return {};
        },
        inputEvents,
      };
    }

    it("selects GPT-6 Astra through Latest only when readback resolves to model 6", async () => {
      const picker = createPickerDom({ model: "5.6 Sol", effort: 4, latestResolvesTo: "6" });
      await expect(chatgptClientUi.selectModel(picker.cdp, picker.inputCdp, "gpt-6-astra", 500)).resolves.toBe("6 Pro");
    });

    it("verifies explicit Latest from the checked advanced radio even when the pill reads 6", async () => {
      const picker = createPickerDom({ model: "5.6 Sol", effort: 4, latestResolvesTo: "6" });
      await expect(chatgptClientUi.selectModel(picker.cdp, picker.inputCdp, "latest", 500)).resolves.toBe("Latest");
      await expect(chatgptClientUi.verifyCurrentModel(picker.cdp, picker.inputCdp, "latest", 500)).resolves.toBe("Latest");
    });

    it("rejects GPT-6 Astra when Latest readback resolves to a non-6 model", async () => {
      const picker = createPickerDom({ model: "5.6 Sol", effort: 4, latestResolvesTo: "5.6 Sol" });
      await expect(chatgptClientUi.selectModel(picker.cdp, picker.inputCdp, "gpt-6-astra", 500)).rejects.toMatchObject({ code: "model_verification_failed" });
    });

    it("selects Pro from a lower effort and xhigh from Pro through Power key events", async () => {
      const lower = createPickerDom({ model: "6", effort: 0 });
      await expect(chatgptClientUi.selectEffort(lower.cdp, lower.inputCdp, "pro", 500)).resolves.toContain("Pro");
      const upper = createPickerDom({ model: "6", effort: 4 });
      await expect(chatgptClientUi.selectEffort(upper.cdp, upper.inputCdp, "extra-high", 500)).resolves.toContain("Extra High");
    });

    it("accepts an already-selected Pro effort from aria-hidden slider metadata inside visible Power", async () => {
      const picker = createPickerDom({ model: "6", effort: 4 });
      await expect(chatgptClientUi.selectEffort(picker.cdp, picker.inputCdp, "pro", 500)).resolves.toContain("Pro");
    });

    it("does not count inert sibling model radios as selection evidence", async () => {
      const picker = createPickerDom({ model: "6", effort: 4, hiddenSiblingModel: "GPT-5.6 Sol" });
      await expect(chatgptClientUi.selectModel(picker.cdp, picker.inputCdp, "gpt-5.6-sol", 500)).resolves.toBe("5.6 Sol Pro");
    });

    it("does not verify a merely present unselected model option as current", async () => {
      const picker = createPickerDom({ model: "5.5", effort: 4 });
      await expect(chatgptClientUi.verifyCurrentModel(picker.cdp, picker.inputCdp, "gpt-5.6-sol", 500)).rejects.toMatchObject({ code: "model_verification_failed" });
    });

    it("uses the checked Sol radio when the composer pill shortens Sol to 5.6 Pro", async () => {
      const picker = createPickerDom({ model: "5.6 Sol", effort: 4, shortSolPill: true });
      await expect(chatgptClientUi.verifyCurrentModel(picker.cdp, picker.inputCdp, "gpt-5.6-sol", 500)).resolves.toBe("GPT-5.6 Sol");
    });

    it("keeps the picker close sequence reliable across model, effort, and final model verification without submitting", async () => {
      const picker = createPickerDom({ model: "5.6 Sol", effort: 3, latestResolvesTo: "6" });
      await expect(chatgptClientUi.selectModel(picker.cdp, picker.inputCdp, "gpt-6-astra", 500)).resolves.toBe("6 Extra High");
      await expect(chatgptClientUi.selectEffort(picker.cdp, picker.inputCdp, "pro", 500)).resolves.toContain("Pro");
      await expect(chatgptClientUi.verifyCurrentModel(picker.cdp, picker.inputCdp, "gpt-6-astra", 500)).resolves.toBe("6 Pro");
      expect(picker.inputEvents.some((event) => event.key === "Enter")).toBe(false);
    });
  });
    it("clears stale composer text before typing the prompt", async () => {
      class FakeEventTarget {
        dispatchEvent() {
          return true;
        }
      }
      class FakeInputEvent {
        constructor(
          readonly type: string,
          readonly init: unknown,
        ) {}
      }
      class FakeMouseEvent extends FakeInputEvent {}
      let focused = false;
      const textarea = new (class extends FakeEventTarget {
        tagName = "TEXTAREA";
        value = "stale text";
        innerText = "";
        textContent = "";
        ownerDocument = {
          getSelection: () => null,
        };

        focus() {
          focused = true;
        }
      })();
      const document = {
        querySelector: (selector: string) => (selector === "#prompt-textarea" ? textarea : null),
      };
      const cdp = async (expression: string) => ({
        result: {
          value: Function(
            "document",
            "EventTarget",
            "MouseEvent",
            "PointerEvent",
            "InputEvent",
            "window",
            `return ${expression};`,
          )(document, FakeEventTarget, FakeMouseEvent, undefined, FakeInputEvent, {}),
        },
      });
      const inputCdp = async (_method: string, params: { text: string }) => {
        textarea.value += params.text;
        return {};
      };

      await chatgptClientUi.typePrompt(cdp, inputCdp, "Reply with exactly: READY");

      expect(textarea.value).toBe("Reply with exactly: READY");
      expect(focused).toBe(true);
    });

    it("selects Chat before a repository-aware Oracle request", async () => {
      const cdp = vi
        .fn()
        .mockResolvedValueOnce({
          result: {
            value: {
              chat: [{ label: "Chat", selected: false }],
              work: [{ label: "Work", selected: true }],
            },
          },
        })
        .mockResolvedValueOnce({ result: { value: true } })
        .mockResolvedValueOnce({
          result: {
            value: {
              chat: [{ label: "Chat", selected: true }],
              work: [{ label: "Work", selected: false }],
            },
          },
        });

      await expect(chatgptClientUi.selectChatTab(cdp, 500)).resolves.toBe("Chat");
    });

    it("fails closed when ChatGPT exposes only Work mode", async () => {
      const cdp = async (expression: string) => {
        if (expression.includes("const details = (node)")) {
          return { result: { value: { chat: [], work: [{ label: "Work", selected: true }] } } };
        }
        throw new Error(`Unexpected expression: ${expression}`);
      };

      await expect(chatgptClientUi.selectChatTab(cdp, 100)).rejects.toMatchObject({
        code: "chat_mode_unavailable",
        message: expect.stringContaining("only exposes Work mode"),
      });
    });

    it("selects and verifies the connected GitHub tool", async () => {
      const cdp = vi
        .fn()
        .mockResolvedValueOnce({ result: { value: { controls: [] } } })
        .mockResolvedValueOnce({ result: { value: true } })
        .mockResolvedValueOnce({
          result: {
            value: {
              controls: [
                {
                  label: "GitHub (connected)",
                  role: "menuitem",
                  selected: false,
                  disconnected: false,
                  testId: null,
                },
              ],
            },
          },
        })
        .mockResolvedValueOnce({ result: { value: true } })
        .mockResolvedValueOnce({
          result: {
            value: {
              controls: [
                {
                  label: "GitHub (connected)",
                  role: "menuitem",
                  selected: true,
                  disconnected: false,
                  testId: null,
                },
              ],
            },
          },
        });

      await expect(chatgptClientUi.selectGitHubTool(cdp, 500)).resolves.toBe("GitHub (connected)");
    });

    it("reports ChatGPT attachment processing failures", async () => {
      const cdp = async (expression: string) => {
        if (expression.includes("const scope = document.querySelector('form')")) {
          return {
            result: {
              value: {
                fileCount: 0,
                hasAttachmentNode: false,
                processingError: true,
                text: "Upload failed",
              },
            },
          };
        }
        throw new Error(`Unexpected expression: ${expression}`);
      };

      await expect(
        chatgptClientUi.waitForChatGPTAttachment(cdp, ["/tmp/report.md"], 100),
      ).rejects.toMatchObject({
        code: "attachment_processing",
        message: expect.stringContaining("processing failed"),
      });
    });

    it("does not treat a selected file input as processed attachment", async () => {
      const cdp = async (expression: string) => {
        if (expression.includes("const scope = document.querySelector('form')")) {
          return {
            result: {
              value: {
                fileCount: 1,
                hasAttachmentNode: false,
                attachmentLabels: [],
                processingError: false,
                text: "",
              },
            },
          };
        }
        throw new Error(`Unexpected expression: ${expression}`);
      };

      await expect(
        chatgptClientUi.waitForChatGPTAttachment(cdp, ["/tmp/report.md"], 100),
      ).rejects.toMatchObject({ code: "attachment_processing" });
    });


  describe("isNewAssistantContent", () => {
    it.each([
      ["no latest", null, { text: "Answer" }, 2, 1, false],
      ["no baseline", { text: "Answer" }, null, 1, 0, true],
      [
        "identical snapshot",
        { text: "Answer", messageId: "msg-1" },
        { text: "Answer", messageId: "msg-1" },
        2,
        2,
        false,
      ],
      [
        "new turn with same text",
        { text: "4", messageId: null, turnIndex: 1 },
        { text: "4", messageId: null, turnIndex: 0 },
        2,
        1,
        true,
      ],
      [
        "empty shell growth",
        { text: "4", messageId: null, turnIndex: 0 },
        { text: "4", messageId: null, turnIndex: 0 },
        2,
        1,
        false,
      ],
      [
        "text changed",
        { text: "New answer", messageId: "msg-1" },
        { text: "Old answer", messageId: "msg-1" },
        2,
        2,
        true,
      ],
      [
        "messageId changed",
        { text: "Answer", messageId: "msg-2" },
        { text: "Answer", messageId: "msg-1" },
        2,
        2,
        true,
      ],
    ])(
      "%s",
      (_, latestAssistant, baselineAssistant, assistantCount, baselineAssistantCount, expected) => {
        expect(
          chatgptClient.isNewAssistantContent(
            latestAssistant,
            baselineAssistant,
            assistantCount,
            baselineAssistantCount,
          ),
        ).toBe(expected);
      },
    );
  });

  describe("isChatGPTResponseComplete", () => {
    it("returns false for empty text", () => {
      expect(
        chatgptClient.isChatGPTResponseComplete(
          { text: "", stopVisible: false, hasFinishedActions: true },
          6,
          1200,
        ),
      ).toBe(false);
    });

    it("returns false when stop button is still visible", () => {
      expect(
        chatgptClient.isChatGPTResponseComplete(
          { text: "Answer", stopVisible: true, hasFinishedActions: true },
          6,
          1200,
        ),
      ).toBe(false);
    });

    it("returns true when finished actions are visible and stop is hidden", () => {
      expect(
        chatgptClient.isChatGPTResponseComplete(
          { text: "Answer", stopVisible: false, hasFinishedActions: true },
          0,
          0,
        ),
      ).toBe(true);
    });

    it("returns true when text has been stable long enough", () => {
      expect(
        chatgptClient.isChatGPTResponseComplete(
          { text: "Answer", stopVisible: false, hasFinishedActions: false },
          6,
          1200,
        ),
      ).toBe(true);
    });

    it("returns false when stability thresholds are not met", () => {
      expect(
        chatgptClient.isChatGPTResponseComplete(
          { text: "Answer", stopVisible: false, hasFinishedActions: false },
          5,
          1199,
        ),
      ).toBe(false);
    });
  });

  describe("fresh-tab harvest gates", () => {
    it("preserves Cloudflare challenge classification", async () => {
      const closeTab = vi.fn(async () => undefined);

      await expect(
        chatgptClient.harvest({
          tabId: null,
          conversationUrl: "https://chatgpt.com/c/conversation-id",
          promptEcho: "review",
          createTab: async () => ({ tabId: 123 }),
          closeTab,
          cdpCommand: vi.fn(async () => ({})),
          cdpEvaluate: async (_tabId: number, expression: string) => {
            if (expression === "document.readyState") {
              return { result: { value: "complete" } };
            }
            if (expression === "document.title.toLowerCase()") {
              return { result: { value: "just a moment" } };
            }
            throw new Error(`Unexpected expression: ${expression}`);
          },
        }),
      ).rejects.toMatchObject({ code: "cloudflare" });
      expect(closeTab).toHaveBeenCalledWith(123);
    });

    it("preserves login failure classification", async () => {
      const closeTab = vi.fn(async () => undefined);

      await expect(
        chatgptClient.harvest({
          tabId: null,
          conversationUrl: "https://chatgpt.com/c/conversation-id",
          promptEcho: "review",
          createTab: async () => ({ tabId: 123 }),
          closeTab,
          cdpCommand: vi.fn(async () => ({})),
          cdpEvaluate: createReadyChatGptEvaluate({ status: 401, hasLoginCta: true }),
        }),
      ).rejects.toMatchObject({ code: "auth" });
      expect(closeTab).toHaveBeenCalledWith(123);
    });
  });

  describe("query", () => {
    it("invokes the upload callback for ChatGPT files and propagates upload errors", async () => {
      const uploadFile = vi.fn(async () => ({ error: "composer file input not found" }));
      const closeCalls: number[] = [];

      await expect(
        chatgptClient.query({
          prompt: "summarize this",
          file: "fixtures/report.txt",
          getCookies: async () => ({
            cookies: [{ name: "__Secure-next-auth.session-token.0", value: "abc" }],
          }),
          createTab: async () => ({ tabId: 123 }),
          closeTab: async (tabId: number) => {
            closeCalls.push(tabId);
          },
          uploadFile,
          cdpCommand: async () => {
            throw new Error("cdpCommand should not be called before upload succeeds");
          },
          cdpEvaluate: createReadyChatGptEvaluate(),
        }),
      ).rejects.toThrow("ChatGPT file upload failed: composer file input not found");

      expect(uploadFile).toHaveBeenCalledWith(123, [
        expect.stringContaining("fixtures/report.txt"),
      ]);
      expect(closeCalls).toEqual([123]);
    });

    it("throws a clear error when ChatGPT file upload is requested without a host callback", async () => {
      await expect(
        chatgptClient.query({
          prompt: "summarize this",
          file: "report.txt",
          getCookies: async () => ({
            cookies: [{ name: "__Secure-next-auth.session-token.0", value: "abc" }],
          }),
          createTab: async () => ({ tabId: 123 }),
          closeTab: async () => undefined,
          cdpCommand: async () => {
            throw new Error("cdpCommand should not be called");
          },
          cdpEvaluate: createReadyChatGptEvaluate(),
        }),
      ).rejects.toThrow(
        "ChatGPT file upload unavailable: native host did not provide upload callback",
      );
    });

    it("preserves login check failures instead of downgrading them to login required", async () => {
      const closeCalls: number[] = [];

      await expect(
        chatgptClient.query({
          prompt: "hello",
          getCookies: async () => ({
            cookies: [{ name: "__Secure-next-auth.session-token.0", value: "abc" }],
          }),
          createTab: async () => ({ tabId: 123 }),
          closeTab: async (tabId: number) => {
            closeCalls.push(tabId);
          },
          cdpCommand: async () => {
            throw new Error("cdpCommand should not be called");
          },
          cdpEvaluate: createReadyChatGptEvaluate({
            status: 0,
            error: "TypeError: Failed to fetch",
            url: "https://chatgpt.com/",

          }),
        }),
      ).rejects.toThrow("ChatGPT login check failed: TypeError: Failed to fetch");

      expect(closeCalls).toEqual([123]);
    });

    it("refuses to submit when final model verification fails after effort changes", async () => {
      let combinedReads = 0;
      let effortValue = 0;
      let promptTyped = false;
      let sendEvaluations = 0;
      let enterDispatches = 0;

      const combinedState = (modelLabel: string, effortLabel: string, menuFound = true) => ({
        pickerButtons: [{ role: "button", label: modelLabel, displayLabel: modelLabel }],
        menuFound,
        modelItems: menuFound
          ? [{ role: "menuitem", label: modelLabel, displayLabel: modelLabel }]
          : [{ role: "button", label: modelLabel, displayLabel: modelLabel }],
        modelOptions: [],
        effortItems: [{ role: "slider", label: `${effortLabel}, ${effortValue + 1} of 5.`, displayLabel: `${effortLabel}, ${effortValue + 1} of 5.`, value: effortValue, min: 0, max: 4 }],
      });

      const cdpEvaluate = async (_tabId: number, expression: string) => {
        if (expression === "document.readyState") return { result: { value: "complete" } };
        if (expression === "document.title.toLowerCase()") return { result: { value: "chatgpt" } };
        if (expression.includes("challenge-platform") || expression.includes("cloudflare ray id")) return { result: { value: false } };
        if (expression.includes("fetch('/backend-api/me'")) return { result: { value: { status: 200, hasLoginCta: false } } };
        if (expression.includes("deleteContentBackward")) return { result: { value: true } };
        if (expression.includes("text.trim().length > 0")) return { result: { value: promptTyped } };
        if (expression.includes("prompt-textarea")) return { result: { value: true } };
        if (expression.includes("power.focus")) return { result: { value: true } };
        if (expression.includes("send-button")) {
          sendEvaluations += 1;
          return { result: { value: "clicked" } };
        }
        if (expression.includes("pickerSelector")) {
          combinedReads += 1;
          if (combinedReads <= 2) return { result: { value: combinedState("6 Pro", "Instant", combinedReads === 1) } };
          if (combinedReads <= 5) return { result: { value: combinedState("6 Pro", effortValue === 4 ? "Pro" : "Instant") } };
          if (combinedReads === 6) return { result: { value: combinedState("5.6 Sol Pro", "Pro", false) } };
          return { result: { value: combinedState("5.6 Sol Pro", "Pro", true) } };
        }
        throw new Error(`Unexpected expression: ${expression}`);
      };
      const cdpCommand = async (_tabId: number, _method: string, params: { key?: string; type?: string; text?: string }) => {
        if (params.text) promptTyped = true;
        if (params.key === "ArrowRight" && params.type === "keyDown") effortValue = Math.min(4, effortValue + 1);
        if (params.key === "Enter") enterDispatches += 1;
        return {};
      };

      await expect(
        chatgptClient.dispatch({
          prompt: "review",
          model: "gpt-6-astra",
          effort: "pro",
          getCookies: async () => ({ cookies: [{ name: "__Secure-next-auth.session-token.0", value: "abc" }] }),
          createTab: async () => ({ tabId: 123 }),
          closeTab: async () => undefined,
          cdpEvaluate,
          cdpCommand,
        }),
      ).rejects.toMatchObject({ code: "model_verification_failed" });

      expect(sendEvaluations).toBe(0);
      expect(enterDispatches).toBe(0);
    });
  });

  describe("hasRequiredCookies", () => {
    it("accepts exact session cookie", () => {
      expect(
        chatgptClient.hasRequiredCookies([
          { name: "__Secure-next-auth.session-token", value: "abc" },
        ]),
      ).toBe(true);
    });

    it("accepts chunked session cookie .0", () => {
      expect(
        chatgptClient.hasRequiredCookies([
          { name: "__Secure-next-auth.session-token.0", value: "abc" },
        ]),
      ).toBe(true);
    });

    it("accepts chunked session cookie .1", () => {
      expect(
        chatgptClient.hasRequiredCookies([
          { name: "__Secure-next-auth.session-token.1", value: "abc" },
        ]),
      ).toBe(true);
    });

    it("rejects exact cookie with empty value", () => {
      expect(
        chatgptClient.hasRequiredCookies([{ name: "__Secure-next-auth.session-token", value: "" }]),
      ).toBe(false);
    });

    it("rejects chunked cookie with empty value", () => {
      expect(
        chatgptClient.hasRequiredCookies([
          { name: "__Secure-next-auth.session-token.0", value: "" },
        ]),
      ).toBe(false);
    });

    it("rejects non-numeric chunk suffix", () => {
      expect(
        chatgptClient.hasRequiredCookies([
          { name: "__Secure-next-auth.session-token.foo", value: "abc" },
        ]),
      ).toBe(false);
    });

    it("rejects trailing dot without suffix", () => {
      expect(
        chatgptClient.hasRequiredCookies([
          { name: "__Secure-next-auth.session-token.", value: "abc" },
        ]),
      ).toBe(false);
    });

    it("rejects lookalike with different separator", () => {
      expect(
        chatgptClient.hasRequiredCookies([
          { name: "__Secure-next-auth.session-token-extra", value: "abc" },
        ]),
      ).toBe(false);
    });

    it("rejects null and undefined", () => {
      expect(chatgptClient.hasRequiredCookies(null)).toBe(false);
      expect(chatgptClient.hasRequiredCookies(undefined)).toBe(false);
    });

    it("rejects non-array input", () => {
      expect(chatgptClient.hasRequiredCookies({} as unknown as [])).toBe(false);
    });

    it("rejects unrelated cookies", () => {
      expect(
        chatgptClient.hasRequiredCookies([
          { name: "oai-did", value: "abc" },
          { name: "__Host-next-auth.csrf-token", value: "abc" },
        ]),
      ).toBe(false);
    });
  });
});
