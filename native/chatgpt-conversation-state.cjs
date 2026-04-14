"use strict";

const { extractMessageText, summarizeConversation } = require("./chatgpt-chats-formatter.cjs");

function isAssistantCompleteStatus(status) {
  return typeof status === "string" && /^(finished_successfully|finished)$/i.test(status.trim());
}

function isAssistantInProgressStatus(status) {
  return typeof status === "string" && /^(in_progress|streaming|pending|queued)$/i.test(status.trim());
}

function hasExplicitNonTextCompletionSignal(message) {
  const contentType = message?.content?.content_type || null;
  if (typeof contentType === "string" && contentType && !["text", "multimodal_text"].includes(contentType)) {
    return true;
  }

  const parts = Array.isArray(message?.content?.parts) ? message.content.parts : [];
  if (parts.some((part) => part && typeof part === "object")) return true;

  const attachments = Array.isArray(message?.metadata?.attachments) ? message.metadata.attachments : [];
  return attachments.length > 0;
}

function classifyConversationProgress(conversation, { baselineAssistantMessageId = null } = {}) {
  if (!conversation || typeof conversation !== "object") {
    return { state: "invalid", nodeId: null, role: null, status: null, hasText: false, model: null };
  }

  const currentNodeId = typeof conversation.current_node === "string" ? conversation.current_node : null;
  const mapping = conversation.mapping && typeof conversation.mapping === "object" ? conversation.mapping : null;
  const node = currentNodeId && mapping ? mapping[currentNodeId] : null;
  const message = node && typeof node === "object" ? node.message : null;
  const role = message?.author?.role || null;
  const status = message?.status || null;
  const model = message?.metadata?.model_slug || null;
  const hasText = !!String(extractMessageText(message) || "").trim();

  if (!currentNodeId || !mapping || !node || !message || !role) {
    return { state: "invalid", nodeId: currentNodeId, role, status, hasText, model };
  }

  if (role === "user") {
    return { state: "awaiting_assistant", nodeId: currentNodeId, role, status, hasText, model };
  }

  if (role !== "assistant") {
    return { state: "invalid", nodeId: currentNodeId, role, status, hasText, model };
  }

  if (isAssistantCompleteStatus(status)) {
    if (!hasText && !hasExplicitNonTextCompletionSignal(message)) {
      return { state: "assistant_in_progress", nodeId: currentNodeId, role, status, hasText, model };
    }
    const state = baselineAssistantMessageId && currentNodeId === baselineAssistantMessageId
      ? "assistant_complete_baseline"
      : "assistant_complete";
    return { state, nodeId: currentNodeId, role, status, hasText, model };
  }

  if (isAssistantInProgressStatus(status)) {
    return { state: "assistant_in_progress", nodeId: currentNodeId, role, status, hasText, model };
  }

  return { state: "invalid", nodeId: currentNodeId, role, status, hasText, model };
}

function extractCompletedAssistantPayload(conversation, { nodeId = null } = {}) {
  if (!conversation || typeof conversation !== "object") return null;

  const mapping = conversation.mapping && typeof conversation.mapping === "object" ? conversation.mapping : null;
  if (nodeId && mapping) {
    const node = mapping[nodeId];
    const message = node && typeof node === "object" ? node.message : null;
    const role = message?.author?.role || null;
    const responseText = String(extractMessageText(message) || "").trim();
    if (role === "assistant" && responseText) {
      return {
        nodeId,
        responseText,
        model: message?.metadata?.model_slug || null,
      };
    }
    return null;
  }

  const summary = summarizeConversation(conversation);
  const lastAssistant = Array.isArray(summary.messages)
    ? [...summary.messages].reverse().find((message) => message && message.role === "assistant")
    : null;
  const responseText = String(lastAssistant?.text || "").trim();
  if (!responseText) return null;

  return {
    nodeId: lastAssistant?.id || null,
    responseText,
    model: lastAssistant?.model || summary.model || null,
  };
}

module.exports = {
  classifyConversationProgress,
  extractCompletedAssistantPayload,
};
