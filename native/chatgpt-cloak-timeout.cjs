const DEFAULT_CHATGPT_QUERY_TIMEOUT_SEC = 2700;
const DEFAULT_CHATGPT_CHATS_TIMEOUT_SEC = 120;
const DEFAULT_CHATGPT_ASSISTANT_WAIT_SEC = 180;
const MIN_KEEPALIVE_INTERVAL_MS = 1000;
const MAX_KEEPALIVE_INTERVAL_MS = 15000;

function resolvePositiveTimeoutSeconds(timeout, fallback) {
  const numeric = Number(timeout);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function resolveQueryTimeoutSeconds(timeout) {
  return resolvePositiveTimeoutSeconds(timeout, DEFAULT_CHATGPT_QUERY_TIMEOUT_SEC);
}

function resolveChatsTimeoutSeconds(timeout) {
  return resolvePositiveTimeoutSeconds(timeout, DEFAULT_CHATGPT_CHATS_TIMEOUT_SEC);
}

function resolveAssistantWaitSeconds(timeout) {
  return resolvePositiveTimeoutSeconds(timeout, DEFAULT_CHATGPT_ASSISTANT_WAIT_SEC);
}

function resolveKeepaliveIntervalMs(timeout) {
  const timeoutMs = resolveQueryTimeoutSeconds(timeout) * 1000;
  return Math.min(MAX_KEEPALIVE_INTERVAL_MS, Math.max(MIN_KEEPALIVE_INTERVAL_MS, Math.floor(timeoutMs / 4)));
}

function normalizeActivityPhase(phase) {
  const trimmed = typeof phase === "string" ? phase.trim() : "";
  if (!trimmed) return "";
  if (/^(?:thought|thinking)\s+for\s+[\d.,]+\s+seconds?$/i.test(trimmed)) return "Thinking";
  return trimmed;
}

function detectResponseActivity({
  phase,
  previousPhase,
  turnId,
  previousTurnId,
  observedTurnId,
  baselineTurnId,
  currentText,
  previousText,
  baselineText,
  streamText,
  previousStreamText,
  thinkingText,
  previousThinkingText,
  trustedActivitySeen = false,
}) {
  const normalizedPhase = normalizeActivityPhase(phase);
  const normalizedPreviousPhase = normalizeActivityPhase(previousPhase);
  const onBaselineTurn = !!(baselineTurnId && observedTurnId && observedTurnId === baselineTurnId);
  const phaseChanged = !!(normalizedPhase && normalizedPhase !== normalizedPreviousPhase && !onBaselineTurn);
  const turnChanged = !!(turnId && turnId !== previousTurnId);
  const streamChanged = !!(streamText && streamText !== previousStreamText);
  const thinkingChanged = !!(thinkingText && thinkingText !== previousThinkingText);
  const textMatchesBaseline = !!(onBaselineTurn && baselineText && currentText === baselineText);
  const textChanged = !!(
    currentText &&
    currentText !== previousText &&
    !textMatchesBaseline &&
    (trustedActivitySeen || previousText || phaseChanged || turnChanged || streamChanged || thinkingChanged || !onBaselineTurn)
  );
  const reasons = [];
  if (phaseChanged) reasons.push("phase");
  if (turnChanged) reasons.push("turn");
  if (streamChanged) reasons.push("stream");
  if (textChanged) reasons.push("text");
  if (thinkingChanged) reasons.push("thinking");
  return { active: reasons.length > 0, reasons };
}

module.exports = {
  DEFAULT_CHATGPT_QUERY_TIMEOUT_SEC,
  DEFAULT_CHATGPT_CHATS_TIMEOUT_SEC,
  DEFAULT_CHATGPT_ASSISTANT_WAIT_SEC,
  resolveQueryTimeoutSeconds,
  resolveChatsTimeoutSeconds,
  resolveAssistantWaitSeconds,
  resolveKeepaliveIntervalMs,
  normalizeActivityPhase,
  detectResponseActivity,
};
