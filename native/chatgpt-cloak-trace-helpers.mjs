/**
 * Pure helper functions for thinking trace parsing and browser state detection.
 * This module has no side effects and does not depend on CloakBrowser.
 */

// Max thoughts to return (cap payload size for very long Pro sessions)
const MAX_THINKING_TRACE_THOUGHTS = 100;
const MAX_THOUGHT_CONTENT_CHARS = 2000;

export function parseThinkingTraceDurationSec(raw) {
  const text = typeof raw === 'string' ? raw : '';
  if (!text) return null;
  const patterns = [
    /Activity\s*[·•]\s*(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?\b/i,
    /(?:Thought|Thinking)\s+for\s+(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?\b/i,
    // Composite formats: "2m 17s", "1h 3m", "1h 2m 30s"
    /Activity\s*[·•]\s*(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+(?:\.\d+)?)s)?/i,
    /(?:Thought|Thinking)\s+for\s+(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+(?:\.\d+)?)s)?/i,
  ];
  // Try simple second-based patterns first
  for (const pattern of patterns.slice(0, 2)) {
    const match = text.match(pattern);
    if (!match) continue;
    const numeric = Number.parseFloat(match[1]);
    if (Number.isFinite(numeric)) return numeric;
  }
  // Try composite patterns
  for (const pattern of patterns.slice(2)) {
    const match = text.match(pattern);
    if (!match) continue;
    const hours = match[1] ? Number.parseInt(match[1], 10) : 0;
    const minutes = match[2] ? Number.parseInt(match[2], 10) : 0;
    const seconds = match[3] ? Number.parseFloat(match[3]) : 0;
    if (hours > 0 || minutes > 0 || seconds > 0) {
      return hours * 3600 + minutes * 60 + seconds;
    }
  }
  return null;
}

export function buildThinkingTraceThoughtsFromText(rawText = '') {
  const normalized = String(rawText || '').replace(/\u00a0/g, ' ').replace(/\r/g, '').trim();
  if (!normalized) return { thoughts: [], truncated: false };

  let chunks = normalized
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  if (chunks.length <= 1) {
    const lines = normalized
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length > 1) chunks = lines;
  }
  if (chunks.length === 0) chunks = [normalized];

  let truncated = false;
  const thoughts = [];
  for (const chunk of chunks) {
    if (thoughts.length >= MAX_THINKING_TRACE_THOUGHTS) {
      truncated = true;
      break;
    }
    const content = chunk.slice(0, MAX_THOUGHT_CONTENT_CHARS);
    if (content.length < chunk.length) truncated = true;
    thoughts.push({ summary: '', content });
  }
  return { thoughts, truncated };
}

export function parseThinkingTraceFlyoutText(raw) {
  const normalized = String(raw || '').replace(/\u00a0/g, ' ').replace(/\r/g, '').trim();
  if (!normalized) return null;

  const durationSec = parseThinkingTraceDurationSec(normalized);
  const recapText = normalized
    .replace(/^Activity\s*[·•]\s*(?:\d+h\s*)?(?:\d+m\s*)?(?:\d+(?:\.\d+)?s?)?\s*\n?/i, '')
    .replace(/^(?:Thinking|Reasoning|Details?)\s*(?:\n|$)/i, '')
    .replace(/\n?(?:Thought|Thinking)\s+for\s+(?:\d+h\s*)?(?:\d+m\s*)?(?:\d+(?:\.\d+)?s?)?\s*\n?Done\s*$/i, '')
    .replace(/\n?Done\s*$/i, '')
    .trim();

  const { thoughts, truncated } = buildThinkingTraceThoughtsFromText(recapText);
  if (!recapText && durationSec === null) return null;

  return {
    thoughts,
    durationSec,
    recapText: recapText || null,
    truncated,
  };
}

export function coerceHeadlessBoolean(value) {
  if (value === true || value === false) return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'headless'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'headed'].includes(normalized)) return false;
  return null;
}

export function detectBrowserHeadlessState({ context, launchOptions } = {}) {
  const candidates = [
    context?._options?.headless,
    context?._browser?._options?.headless,
    context?._browser?._browserType?._defaultLaunchOptions?.headless,
    launchOptions?.headless,
    process.env.CLOAK_HEADLESS,
  ];
  for (const candidate of candidates) {
    const resolved = coerceHeadlessBoolean(candidate);
    if (resolved !== null) return resolved;
  }
  return true;
}
