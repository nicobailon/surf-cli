// @ts-expect-error - CommonJS module without type definitions
import * as chatgptClient from "../../native/chatgpt-client.cjs";

describe("chatgpt-client", () => {
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
        [
          "Good response",
          "Here is code:",
          "```js",
          "Copy",
          "const x = 1;",
          "```",
          "Retry",
        ].join("\n"),
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
        { role: "assistant", turn: "assistant", isAssistant: true, text: "\n\n", messageId: "msg-2" },
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
        chatgptClient.extractLatestAssistantSnapshot([{ role: "user", turn: "user", text: "hello" }]),
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

  describe("query", () => {
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
          cdpEvaluate: async (_tabId: number, expression: string) => {
            if (expression === "document.readyState") {
              return { result: { value: "complete" } };
            }
            if (expression === "document.title.toLowerCase()") {
              return { result: { value: "chatgpt" } };
            }
            if (expression.includes("challenge-platform")) {
              return { result: { value: false } };
            }
            if (expression.includes("fetch('/backend-api/me'")) {
              return {
                result: {
                  value: {
                    status: 0,
                    error: "TypeError: Failed to fetch",
                    url: "https://chatgpt.com/",
                  },
                },
              };
            }
            throw new Error(`Unexpected expression: ${expression}`);
          },
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
        chatgptClient.hasRequiredCookies([
          { name: "__Secure-next-auth.session-token", value: "" },
        ]),
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
