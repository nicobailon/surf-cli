/**
 * Host-side half of page readiness: the state vocabulary, error codes,
 * `--accept` parsing and the bounded poll loop. Bundled into the service
 * worker only; the DOM classifier in `./page-readiness.ts` is content-script
 * only and imports nothing but types from here.
 */

export type ReadinessState =
  | "ready"
  | "empty"
  | "loading"
  | "login"
  | "challenge"
  | "not-found"
  | "error";

/** States that mean "stop waiting, the page will not become ready". */
export const NEGATIVE_READINESS_STATES: readonly ReadinessState[] = [
  "challenge",
  "login",
  "not-found",
  "error",
];

/** States that mean "the page has settled and can be read". */
export const SETTLED_READINESS_STATES: readonly ReadinessState[] = ["ready", "empty"];

/** Error code for a negative state, or null for states that are not errors. */
export function readinessErrorCode(state: ReadinessState): string | null {
  switch (state) {
    case "challenge":
      return "page_challenge";
    case "login":
      return "page_login";
    case "not-found":
      return "page_not_found";
    case "error":
      return "page_error";
    default:
      return null;
  }
}

export function isReadinessState(value: unknown): value is ReadinessState {
  return (
    value === "ready" ||
    value === "empty" ||
    value === "loading" ||
    NEGATIVE_READINESS_STATES.includes(value as ReadinessState)
  );
}

/** Parse `--accept login,challenge` style input into a state list. */
export function parseAcceptStates(input: unknown): ReadinessState[] {
  const raw: unknown[] = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];
  const states: ReadinessState[] = [];
  for (const entry of raw) {
    const trimmed = typeof entry === "string" ? entry.trim() : "";
    if (!isReadinessState(trimmed)) {
      throw new Error(
        `Unknown readiness state "${String(entry)}". Expected one of: challenge, login, not-found, error`,
      );
    }
    if (!states.includes(trimmed)) states.push(trimmed);
  }
  return states;
}

/** What one probe of the page reports. */
export interface ReadinessProbeResult {
  state: ReadinessState;
  evidence: string[];
  href?: string;
  title?: string;
  readyState?: string;
  tabStatus?: string;
}

export interface ReadinessBudget {
  timeoutMs: number;
  intervalMs: number;
}

export const DEFAULT_READINESS_TIMEOUT_MS = 20_000;
export const MAX_READINESS_TIMEOUT_MS = 120_000;
export const DEFAULT_READINESS_INTERVAL_MS = 400;
export const MIN_READINESS_INTERVAL_MS = 50;

/** Clamp caller-supplied numbers into a bounded polling budget. */
export function clampReadinessBudget(input: { timeoutMs?: unknown; intervalMs?: unknown }): ReadinessBudget {
  const timeoutRaw = Number(input.timeoutMs);
  const intervalRaw = Number(input.intervalMs);
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0
    ? Math.min(timeoutRaw, MAX_READINESS_TIMEOUT_MS)
    : DEFAULT_READINESS_TIMEOUT_MS;
  const intervalBase = Number.isFinite(intervalRaw) && intervalRaw > 0 ? intervalRaw : DEFAULT_READINESS_INTERVAL_MS;
  const intervalMs = Math.min(Math.max(intervalBase, MIN_READINESS_INTERVAL_MS), timeoutMs);
  return { timeoutMs, intervalMs };
}

export interface ReadinessPollOptions extends ReadinessBudget {
  probe: () => Promise<ReadinessProbeResult>;
  /** Negative states that end the wait successfully instead of failing it. */
  accept?: readonly ReadinessState[];
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Called after every probe; useful for debug lines. */
  onPoll?: (result: ReadinessProbeResult, poll: number, waitedMs: number) => void;
}

export type ReadinessPollKind = "settled" | "accepted" | "negative" | "timeout";

export interface ReadinessPollOutcome {
  kind: ReadinessPollKind;
  result: ReadinessProbeResult;
  polls: number;
  waitedMs: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Probe until the page settles, a negative state appears, or the budget is
 * spent. The loop never spins faster than `intervalMs` and always makes at
 * least one probe.
 */
export async function pollReadiness(options: ReadinessPollOptions): Promise<ReadinessPollOutcome> {
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const accept = options.accept ?? [];
  const startedAt = now();
  let polls = 0;
  let last: ReadinessProbeResult = { state: "loading", evidence: ["no probe completed"] };

  for (;;) {
    last = await options.probe();
    polls += 1;
    const waitedMs = now() - startedAt;
    options.onPoll?.(last, polls, waitedMs);

    if (SETTLED_READINESS_STATES.includes(last.state)) {
      return { kind: "settled", result: last, polls, waitedMs };
    }
    if (NEGATIVE_READINESS_STATES.includes(last.state)) {
      return { kind: accept.includes(last.state) ? "accepted" : "negative", result: last, polls, waitedMs };
    }
    const remaining = options.timeoutMs - (now() - startedAt);
    if (remaining <= 0) {
      return { kind: "timeout", result: last, polls, waitedMs: now() - startedAt };
    }
    await sleep(Math.min(options.intervalMs, remaining));
  }
}
