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
      ["Instant", "instant"],
      ["gpt-5-3", "instant"],
      ["Thinking", "thinking"],
      ["gpt-5-4-thinking", "thinking"],
      ["Pro", "pro"],
      ["gpt-5-4-pro", "pro"],
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
    it("matches current ChatGPT model menu options by visible label", () => {
      expect(
        chatgptClient.resolveChatGPTModelMenuOption(
          [
            { role: null, label: "Latest", testId: null },
            { role: "menuitemradio", label: "Instant", testId: "model-switcher-gpt-5-3" },
            { role: "menuitemradio", label: "Thinking", testId: "model-switcher-gpt-5-4-thinking" },
            { role: "menuitemradio", label: "Pro", testId: "model-switcher-gpt-5-4-pro" },
            { role: "menuitem", label: "Configure...", testId: "model-configure-modal" },
          ],
          "thinking",
        ),
      ).toEqual({
        role: "menuitemradio",
        label: "Thinking",
        testId: "model-switcher-gpt-5-4-thinking",
      });
    });

    it("matches current ChatGPT model menu options by internal test id alias", () => {
      expect(
        chatgptClient.resolveChatGPTModelMenuOption(
          [
            { role: null, label: "Latest", testId: null },
            { role: "menuitemradio", label: "Instant", testId: "model-switcher-gpt-5-3" },
            { role: "menuitemradio", label: "Thinking", testId: "model-switcher-gpt-5-4-thinking" },
            { role: "menuitemradio", label: "Pro", testId: "model-switcher-gpt-5-4-pro" },
            { role: "menuitem", label: "Configure...", testId: "model-configure-modal" },
          ],
          "gpt-5-4-pro",
        ),
      ).toEqual({
        role: "menuitemradio",
        label: "Pro",
        testId: "model-switcher-gpt-5-4-pro",
      });
    });

    it("matches nested advanced model options without model-switcher test ids", () => {
      expect(
        chatgptClient.resolveChatGPTModelMenuOption(
          [
            { role: "menuitemradio", label: "GPT-5.6 Sol", testId: null },
            { role: "menuitemradio", label: "GPT-5.5", testId: null },
            { role: "menuitemradio", label: "o3 Leaving on August 26", testId: null },
          ],
          "gpt-5.6-sol",
        ),
      ).toEqual({ role: "menuitemradio", label: "GPT-5.6 Sol", testId: null });
      expect(
        chatgptClient.resolveChatGPTModelMenuOption(
          [
            { role: "menuitemradio", label: "GPT-5.6 Sol", testId: null },
            { role: "menuitemradio", label: "GPT-5.5", testId: null },
            { role: "menuitemradio", label: "o3 Leaving on August 26", testId: null },
          ],
          "gpt-5.5",
        ),
      ).toEqual({ role: "menuitemradio", label: "GPT-5.5", testId: null });
      expect(
        chatgptClient.resolveChatGPTModelMenuOption(
          [
            { role: "menuitemradio", label: "GPT-5.6 Sol", testId: null },
            { role: "menuitemradio", label: "GPT-5.5", testId: null },
          ],
          "pro",
        ),
      ).toBeNull();
    });

    it("ignores non-selectable menu rows like section labels and configure", () => {
      expect(
        chatgptClient.resolveChatGPTModelMenuOption(
          [
            { role: null, label: "Latest", testId: null },
            { role: "menuitem", label: "Configure...", testId: "model-configure-modal" },
          ],
          "latest",
        ),
      ).toBeNull();
    });
  });

  describe("verified ChatGPT picker state", () => {
    const modelState = [
      {
        role: "button",
        label: "ChatGPT 5.4 Thinking",
        testId: "model-switcher-dropdown-button",
      },
    ];
    const effortOptions = [
      { role: "menuitemradio", label: "Light", testId: "thinking-time-light" },
      { role: "menuitemradio", label: "Standard", testId: "thinking-time-standard" },
      { role: "menuitemradio", label: "Extended", testId: "thinking-time-extended" },
      { role: "menuitemradio", label: "Heavy", testId: "thinking-time-heavy" },
    ];

    it.each([
      ["requested model found", modelState, "thinking", "ChatGPT 5.4 Thinking"],
      [
        "GPT-5.5 readback",
        [{ role: "button", label: "ChatGPT 5.5 | Current model is ChatGPT 5.5", testId: null }],
        "gpt-5.5",
        "ChatGPT 5.5 | Current model is ChatGPT 5.5",
      ],
      [
        "GPT-5.6 Sol readback",
        [
          {
            role: "button",
            label: "ChatGPT 5.6 Sol | Current model is ChatGPT 5.6 Sol",
            testId: null,
          },
        ],
        "gpt-5.6-sol",
        "ChatGPT 5.6 Sol | Current model is ChatGPT 5.6 Sol",
      ],
      [
        "advanced menu current model row",
        [{ role: "menuitem", label: "Model GPT-5.6 Sol", testId: null }],
        "gpt-5.6-sol",
        "Model GPT-5.6 Sol",
      ],
      [
        "model readback ignores separate Pro effort",
        [
          {
            role: "button",
            label: "ChatGPT 5.6 Sol | Current model is ChatGPT 5.6 Sol",
            testId: null,
          },
          { role: "button", label: "Pro", testId: null },
        ],
        "gpt-5.6-sol",
        "ChatGPT 5.6 Sol | Current model is ChatGPT 5.6 Sol",
      ],
      [
        "Pro model readback",
        [
          {
            role: "button",
            label: "Pro | Current model is Pro",
            testId: null,
          },
        ],
        "pro",
        "Pro | Current model is Pro",
      ],
      ["requested model missing", modelState, "pro", null],
      ["ambiguous model state", [...modelState, ...modelState], "thinking", null],
      ["unreadable model state", [{ role: "button", label: "", testId: null }], "thinking", null],
    ])("handles %s", (_, items, requested, expectedLabel) => {
      expect(chatgptClient.verifyChatGPTModelSelection(items, requested)?.label ?? null).toBe(
        expectedLabel,
      );
    });

    it.each([
      ["requested effort found", [effortOptions[2]], "extended", "Extended"],
      [
        "visible Pro label wins over unrelated test id metadata",
        [{ role: "button", label: "Pro", testId: "thinking-time-standard" }],
        "pro",
        "Pro",
      ],
      [
        "ambiguous visible label stays fail-closed",
        [{ role: "button", label: "Pro Extended", testId: "thinking-time-pro" }],
        "pro",
        null,
      ],
      ["requested effort missing", [effortOptions[1]], "extended", null],
      ["ambiguous effort state", [effortOptions[2], effortOptions[2]], "extended", null],
      [
        "unreadable effort state",
        [{ role: "menuitemradio", label: "", testId: null }],
        "extended",
        null,
      ],
    ])("handles %s", (_, items, requested, expectedLabel) => {
      expect(chatgptClient.verifyChatGPTEffortSelection(items, requested)?.label ?? null).toBe(
        expectedLabel,
      );
    });

    it("verifies Pro after opening a Thinking composer effort pill", async () => {
      class FakeEventTarget {
        dispatchEvent() {
          return true;
        }
      }
      class FakeButton extends FakeEventTarget {
        tagName = "BUTTON";
        textContent: string;
        innerText: string;
        attributes: Record<string, string>;

        constructor(textContent: string, attributes: Record<string, string>) {
          super();
          this.textContent = textContent;
          this.innerText = textContent;
          this.attributes = attributes;
        }

        getAttribute(name: string) {
          return this.attributes[name] ?? null;
        }
      }
      class FakeMouseEvent {
        constructor(
          readonly type: string,
          readonly init: unknown,
        ) {}
      }

      const modelButton = new FakeButton("Pro", {
        "aria-haspopup": "menu",
        "data-testid": "model-switcher-dropdown-button",
      });
      const effortButton = new FakeButton("", {
        "aria-haspopup": "menu",
        "aria-labelledby": "effort-label",
      });
      let effortLabel = "Thinking";
      const document = {
        getElementById: (id: string) =>
          id === "effort-label" ? { textContent: effortLabel } : null,
        querySelectorAll: () => [modelButton, effortButton],
      };

      const cdp = async (expression: string) => {
        if (expression.includes('const kind = "effort"')) {
          return {
            result: {
              value: Function(
                "document",
                "EventTarget",
                "MouseEvent",
                "PointerEvent",
                "window",
                `return ${expression};`,
              )(document, FakeEventTarget, FakeMouseEvent, undefined, {}),
            },
          };
        }
        if (expression.includes("const containers = Array.from")) {
          return {
            result: {
              value: {
                found: true,
                items: [{ role: "menuitemradio", label: "Pro", testId: null, selected: false }],
              },
            },
          };
        }
        if (expression.includes("const expectedLabel")) {
          effortLabel = "Pro";
          return { result: { value: true } };
        }
        throw new Error(`Unexpected expression: ${expression}`);
      };

      await expect(chatgptClientUi.selectEffort(cdp, "pro", 100)).resolves.toBe("Pro");
    });

    it("resolves effort options and accepts only the documented vocabulary", () => {
      expect(chatgptClient.resolveChatGPTEffortMenuOption(effortOptions, "extended")).toEqual(
        effortOptions[2],
      );
      expect(chatgptClient.normalizeChatGPTEffortChoice("STANDARD")).toBe("standard");
      expect(chatgptClient.normalizeChatGPTEffortChoice("Pro")).toBe("pro");
      expect(chatgptClient.normalizeChatGPTEffortChoice("maximum")).toBeNull();
    });
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
