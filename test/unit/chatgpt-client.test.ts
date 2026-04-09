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
        { role: "assistant", turn: "assistant", isAssistant: true, text: "Actual reply", messageId: "msg-1" },
        { role: "assistant", turn: "assistant", isAssistant: true, text: "\n\nCopy\nRead aloud\n", messageId: "msg-2" },
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
        chatgptClient.extractLatestAssistantSnapshot([
          { role: "user", turn: "user", text: "hello" },
        ])
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

  describe("hasRequiredCookies", () => {
    it("accepts exact session cookie", () => {
      expect(
        chatgptClient.hasRequiredCookies([
          { name: "__Secure-next-auth.session-token", value: "abc" },
        ])
      ).toBe(true);
    });

    it("rejects exact cookie with empty value", () => {
      expect(
        chatgptClient.hasRequiredCookies([
          { name: "__Secure-next-auth.session-token", value: "" },
        ])
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
        ])
      ).toBe(false);
    });
  });
});
