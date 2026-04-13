import { describe, expect, it, vi } from "vitest";

const { attemptSendAndConfirm } = require("../../native/chatgpt-cloak-send-confirmation.cjs") as {
  attemptSendAndConfirm: (args: any) => Promise<any>;
};

function createPage({ evaluateResults = [], clickError = null }: { evaluateResults?: any[]; clickError?: Error | null } = {}) {
  const evaluate = vi.fn();
  for (const result of evaluateResults) evaluate.mockResolvedValueOnce(result);
  const click = clickError ? vi.fn().mockRejectedValue(clickError) : vi.fn().mockResolvedValue(undefined);
  const press = vi.fn().mockResolvedValue(undefined);
  return {
    page: {
      evaluate,
      url: () => "https://chatgpt.com",
      locator: vi.fn().mockReturnValue({
        first: () => ({
          click,
        }),
      }),
    },
    textarea: { press },
    click,
    press,
    evaluate,
  };
}

describe("chatgpt-cloak-send-confirmation", () => {
  it("falls back to Enter when click attempt fails and no send was dispatched", async () => {
    const stateNoSend = {
      stopVisible: false,
      composerCleared: false,
      promptStillPresent: true,
      composerChars: 12,
    };
    const stateAfterEnter = {
      stopVisible: false,
      composerCleared: true,
      promptStillPresent: false,
      composerChars: 0,
    };
    const { page, textarea, press, click } = createPage({
      evaluateResults: [stateNoSend, stateAfterEnter],
      clickError: new Error("click failed"),
    });

    const result = await attemptSendAndConfirm({
      page,
      textarea,
      promptEntry: { sendEnabled: true, sendButtonFound: true },
      finalPrompt: "hello world",
      conversationId: null,
      baselineUserNodeId: null,
      sendButtonSelectors: ["button[data-testid=\"send-button\"]"],
      promptSelectors: ["#prompt-textarea"],
      stopSelector: "button[data-testid=\"stop-button\"]",
      sleep: async () => {},
      waitForPromptPersistenceValidation: vi.fn(),
      extractConversationIdFromUrl: () => null,
      log: () => {},
    });

    expect(click).toHaveBeenCalledTimes(1);
    expect(page.evaluate).toHaveBeenCalled();
    const firstEvaluateCall = page.evaluate.mock.calls[0];
    expect(firstEvaluateCall).toHaveLength(2);
    expect(firstEvaluateCall[1]).toEqual({
      promptSelectors: ["#prompt-textarea"],
      stopSelector: "button[data-testid=\"stop-button\"]",
      expected: "hello world",
    });
    expect(press).toHaveBeenCalledWith("Enter");
    expect(result.method).toBe("enter");
    expect(result.status).toBe("confirmed");
    expect(result.confirmationSource).toBe("composer_cleared");
  });

  it("fails with send_confirmation_timeout on ambiguous confirmation", async () => {
    const ambiguousState = {
      stopVisible: false,
      composerCleared: false,
      promptStillPresent: false,
      composerChars: 4,
    };
    const { page, textarea } = createPage({
      evaluateResults: [ambiguousState],
      clickError: new Error("click failed"),
    });
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);

    await expect(
      attemptSendAndConfirm({
        page,
        textarea,
        promptEntry: { sendEnabled: true, sendButtonFound: true },
        finalPrompt: "hello world",
        conversationId: "conv-123",
        baselineUserNodeId: null,
        sendButtonSelectors: ["button[data-testid=\"send-button\"]"],
        promptSelectors: ["#prompt-textarea"],
        stopSelector: "button[data-testid=\"stop-button\"]",
        sleep: async () => {
          now += 6_000;
        },
        waitForPromptPersistenceValidation: vi.fn().mockResolvedValue({
          ok: false,
          failureReason: "validation_not_started",
        }),
        extractConversationIdFromUrl: () => "conv-123",
        log: () => {},
      }),
    ).rejects.toMatchObject({ code: "send_confirmation_timeout" });
  });
});
