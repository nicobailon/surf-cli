// @ts-expect-error - CommonJS module without type definitions
import * as chatgptClient from "../../native/chatgpt-client.cjs";

describe("chatgpt-client primitives", () => {
  it("normalizes whitespace and matches the first 200 prompt characters", () => {
    expect(chatgptClient.normalizePromptEcho("  review\n\tthis   code  ")).toBe("review this code");

    const prompt = `Review ${"x".repeat(250)}`;
    const echo = chatgptClient.normalizePromptEcho(prompt);
    expect(echo).toHaveLength(200);
    expect(chatgptClient.matchesPromptEcho(prompt, echo)).toBe(true);
    expect(chatgptClient.matchesPromptEcho(`Different ${"x".repeat(250)}`, echo)).toBe(false);
  });

  it.each([
    ["https://chatgpt.com/c/abc-123", "https://chatgpt.com/c/abc-123"],
    ["https://chatgpt.com/c/abc-123?model=pro#turn", "https://chatgpt.com/c/abc-123"],
    ["https://chatgpt.com/", null],
    ["https://example.com/c/abc-123", null],
    ["not a URL", null],
  ])("extracts a canonical conversation URL from %s", (input, expected) => {
    expect(chatgptClient.extractConversationUrl(input)).toBe(expected);
  });
});
