/**
 * Type declarations for chatgpt-cloak-trace-helpers.mjs
 */

export interface ThinkingTraceThought {
  summary: string;
  content: string;
}

export interface ThinkingTrace {
  thoughts: ThinkingTraceThought[];
  durationSec: number | null;
  recapText: string;
  truncated: boolean;
}

/**
 * Parse duration strings like "17s", "2m 30s", "1h 5m 10s" into seconds.
 */
export function parseThinkingTraceDurationSec(raw: string): number | null;

/**
 * Build thoughts array from raw flyout text content.
 */
export function buildThinkingTraceThoughtsFromText(rawText?: string): ThinkingTraceThought[];

/**
 * Parse the full flyout text into a ThinkingTrace object.
 */
export function parseThinkingTraceFlyoutText(raw: string | null | undefined): ThinkingTrace | null;

/**
 * Coerce various headless option values to boolean.
 */
export function coerceHeadlessBoolean(value: unknown): boolean;

/**
 * Detect if browser is running in headless mode from context/launch options.
 */
export function detectBrowserHeadlessState(options?: {
  context?: { _options?: { headless?: boolean } };
  launchOptions?: { headless?: boolean | string };
}): boolean;
