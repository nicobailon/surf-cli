import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const timeoutHelpers = require("../../native/chatgpt-cloak-timeout.cjs");

describe("chatgpt-cloak-timeout", () => {
  it("uses 2700s as the default query timeout", () => {
    expect(timeoutHelpers.resolveQueryTimeoutSeconds()).toBe(2700);
    expect(timeoutHelpers.resolveQueryTimeoutSeconds(0)).toBe(2700);
    expect(timeoutHelpers.resolveQueryTimeoutSeconds(null)).toBe(2700);
    expect(timeoutHelpers.resolveQueryTimeoutSeconds(45)).toBe(45);
  });

  it("keeps chats default at 120s", () => {
    expect(timeoutHelpers.resolveChatsTimeoutSeconds()).toBe(120);
    expect(timeoutHelpers.resolveChatsTimeoutSeconds(0)).toBe(120);
    expect(timeoutHelpers.resolveChatsTimeoutSeconds(30)).toBe(30);
  });

  it("uses 180s as the default assistant wait", () => {
    expect(timeoutHelpers.resolveAssistantWaitSeconds()).toBe(180);
    expect(timeoutHelpers.resolveAssistantWaitSeconds(0)).toBe(180);
    expect(timeoutHelpers.resolveAssistantWaitSeconds(null)).toBe(180);
    expect(timeoutHelpers.resolveAssistantWaitSeconds(45)).toBe(45);
  });

  it("detects fresh response activity only when content actually advances", () => {
    const idle = timeoutHelpers.detectResponseActivity({
      phase: "Waiting for response",
      previousPhase: "Waiting for response",
      turnId: "turn-1",
      previousTurnId: "turn-1",
      currentText: "same",
      previousText: "same",
      streamText: "same",
      previousStreamText: "same",
      thinkingText: "",
      previousThinkingText: "",
    });
    expect(idle).toEqual({ active: false, reasons: [] });

    const active = timeoutHelpers.detectResponseActivity({
      phase: "Thinking",
      previousPhase: "Waiting for response",
      turnId: "turn-2",
      previousTurnId: "turn-1",
      currentText: "draft",
      previousText: "",
      streamText: "draft",
      previousStreamText: "",
      thinkingText: "step 1",
      previousThinkingText: "",
    });
    expect(active.active).toBe(true);
    expect(active.reasons).toEqual(
      expect.arrayContaining(["phase", "turn", "stream", "text", "thinking"]),
    );
  });

  it("ignores stale baseline turn phase/text churn", () => {
    const active = timeoutHelpers.detectResponseActivity({
      phase: "Thinking",
      previousPhase: "Waiting for response",
      turnId: null,
      previousTurnId: null,
      observedTurnId: "turn-baseline",
      baselineTurnId: "turn-baseline",
      currentText: "old assistant reply",
      previousText: "",
      baselineText: "old assistant reply",
      streamText: "",
      previousStreamText: "",
      thinkingText: "",
      previousThinkingText: "",
    });
    expect(active).toEqual({ active: false, reasons: [] });
  });

  it("treats text-only deltas as activity after trust is established", () => {
    const active = timeoutHelpers.detectResponseActivity({
      phase: "Waiting for response",
      previousPhase: "Waiting for response",
      turnId: "turn-1",
      previousTurnId: "turn-1",
      currentText: "new text",
      previousText: "",
      streamText: "",
      previousStreamText: "",
      thinkingText: "",
      previousThinkingText: "",
      trustedActivitySeen: true,
    });
    expect(active).toEqual({ active: true, reasons: ["text"] });
  });

  it("caps keepalive heartbeat interval for long-running queries", () => {
    expect(timeoutHelpers.resolveKeepaliveIntervalMs(5)).toBe(1250);
    expect(timeoutHelpers.resolveKeepaliveIntervalMs(2700)).toBe(15000);
  });

  it("does not treat thought timer label churn as fresh activity", () => {
    const active = timeoutHelpers.detectResponseActivity({
      phase: "Thought for 4 seconds",
      previousPhase: "Thought for 3 seconds",
      turnId: "turn-1",
      previousTurnId: "turn-1",
      currentText: "",
      previousText: "",
      streamText: "",
      previousStreamText: "",
      thinkingText: "",
      previousThinkingText: "",
    });
    expect(active).toEqual({ active: false, reasons: [] });
  });

  it("does not treat thinking timer label churn as fresh activity", () => {
    const active = timeoutHelpers.detectResponseActivity({
      phase: "Thinking for 4 seconds",
      previousPhase: "Thinking for 3 seconds",
      turnId: "turn-1",
      previousTurnId: "turn-1",
      currentText: "",
      previousText: "",
      streamText: "",
      previousStreamText: "",
      thinkingText: "",
      previousThinkingText: "",
    });
    expect(active).toEqual({ active: false, reasons: [] });
  });
});
