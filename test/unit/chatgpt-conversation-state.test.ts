import { describe, expect, it } from "vitest";

const { classifyConversationProgress, extractCompletedAssistantPayload } =
  require("../../native/chatgpt-conversation-state.cjs") as {
    classifyConversationProgress: (
      conversation: any,
      options?: { baselineAssistantMessageId?: string | null },
    ) => {
      state: string;
      nodeId: string | null;
      role: string | null;
      status: string | null;
      hasText: boolean;
      model: string | null;
    };
    extractCompletedAssistantPayload: (
      conversation: any,
      options?: { nodeId?: string | null },
    ) => {
      nodeId: string | null;
      responseText: string;
      model: string | null;
    } | null;
  };

describe("chatgpt-conversation-state", () => {
  it("classifies a new completed assistant turn", () => {
    const conversation = {
      current_node: "a2",
      mapping: {
        a2: {
          message: {
            author: { role: "assistant" },
            status: "finished_successfully",
            content: { parts: ["done"] },
            metadata: { model_slug: "gpt-5.4-pro" },
          },
        },
      },
    };

    expect(
      classifyConversationProgress(conversation, { baselineAssistantMessageId: "a1" }),
    ).toEqual({
      state: "assistant_complete",
      nodeId: "a2",
      role: "assistant",
      status: "finished_successfully",
      hasText: true,
      model: "gpt-5.4-pro",
    });
  });

  it("classifies the baseline assistant turn separately", () => {
    const conversation = {
      current_node: "a1",
      mapping: {
        a1: {
          message: {
            author: { role: "assistant" },
            status: "finished_successfully",
            content: { parts: ["old"] },
            metadata: {},
          },
        },
      },
    };

    expect(
      classifyConversationProgress(conversation, { baselineAssistantMessageId: "a1" }).state,
    ).toBe("assistant_complete_baseline");
  });

  it("classifies a current user node as awaiting_assistant", () => {
    const conversation = {
      current_node: "u1",
      mapping: {
        u1: {
          message: {
            author: { role: "user" },
            status: "finished_successfully",
            content: { parts: ["hello"] },
          },
        },
      },
    };

    expect(classifyConversationProgress(conversation).state).toBe("awaiting_assistant");
  });

  it("classifies assistant in-progress turns", () => {
    const conversation = {
      current_node: "a2",
      mapping: {
        a2: {
          message: {
            author: { role: "assistant" },
            status: "in_progress",
            content: { parts: ["partial"] },
          },
        },
      },
    };

    expect(classifyConversationProgress(conversation).state).toBe("assistant_in_progress");
  });

  it("keeps empty finished assistant turns in progress until text materializes", () => {
    const conversation = {
      current_node: "a3",
      mapping: {
        a3: {
          message: {
            author: { role: "assistant" },
            status: "finished_successfully",
            content: { parts: [] },
            metadata: {},
          },
        },
      },
    };

    expect(classifyConversationProgress(conversation).state).toBe("assistant_in_progress");
  });

  it("allows explicit non-text completion signals to count as complete", () => {
    const conversation = {
      current_node: "a4",
      mapping: {
        a4: {
          message: {
            author: { role: "assistant" },
            status: "finished_successfully",
            content: { content_type: "image_asset_pointer", parts: [] },
            metadata: {},
          },
        },
      },
    };

    expect(classifyConversationProgress(conversation).state).toBe("assistant_complete");
  });

  it("returns invalid for missing or ill-formed current node state", () => {
    expect(classifyConversationProgress(null).state).toBe("invalid");
    expect(classifyConversationProgress({ current_node: "x", mapping: {} }).state).toBe("invalid");
  });

  it("extracts payload for a completed assistant node", () => {
    const conversation = {
      current_node: "a2",
      mapping: {
        a2: {
          message: {
            author: { role: "assistant" },
            status: "finished_successfully",
            content: { parts: ["done"] },
            metadata: { model_slug: "gpt-5.4-pro" },
          },
        },
      },
    };

    expect(extractCompletedAssistantPayload(conversation, { nodeId: "a2" })).toEqual({
      nodeId: "a2",
      responseText: "done",
      model: "gpt-5.4-pro",
    });
  });

  it("does not fall back to older assistant text when the requested node is empty", () => {
    const conversation = {
      current_node: "a2",
      mapping: {
        a1: {
          id: "a1",
          message: {
            author: { role: "assistant" },
            status: "finished_successfully",
            content: { parts: ["older"] },
            metadata: { model_slug: "gpt-5.4-thinking" },
          },
        },
        a2: {
          id: "a2",
          parent: "a1",
          message: {
            author: { role: "assistant" },
            status: "finished_successfully",
            content: { parts: [] },
            metadata: { model_slug: "gpt-5.4-pro" },
          },
        },
      },
    };

    expect(extractCompletedAssistantPayload(conversation, { nodeId: "a2" })).toBeNull();
  });

  it("falls back to the latest visible assistant when no node is specified", () => {
    const conversation = {
      current_node: "a2",
      mapping: {
        u1: {
          id: "u1",
          message: {
            author: { role: "user" },
            status: "finished_successfully",
            content: { parts: ["hello"] },
          },
          parent: null,
          children: ["a2"],
        },
        a2: {
          id: "a2",
          parent: "u1",
          children: [],
          message: {
            author: { role: "assistant" },
            status: "finished_successfully",
            content: { parts: ["latest"] },
            metadata: { model_slug: "gpt-5.4-pro" },
          },
        },
      },
    };

    expect(extractCompletedAssistantPayload(conversation)).toEqual({
      nodeId: "a2",
      responseText: "latest",
      model: "gpt-5.4-pro",
    });
  });
});
