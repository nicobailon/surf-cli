/** Retries use fresh tabs, so caller scripts must be read-only or idempotent. */

const { applyOptionsPrelude } = require("./script-options.cjs");

const DEFAULT_RETRY_COUNT = 1;
const DEFAULT_RETRY_DELAY_MS = 500;
const MAX_RETRY_COUNT = 5;
const ROW_KEY_CANDIDATES = ["rows", "items", "results", "entries", "records", "data"];

const TRANSIENT_TAB_ERROR_MARKERS = [
  "navigated or closed",
  "Detached while handling command",
  "Cannot find default execution context",
  "Execution context was destroyed",
  "Receiving end does not exist",
  "Content script not loaded",
  "no longer exists",
  "Target closed",
];

const RETRYABLE_ERROR_CODES = new Set(["empty_result", "page_timeout", "tab_gone", "target_gone"]);

const FATAL_READINESS_CODES = new Set(["page_login", "page_challenge", "page_not_found", "page_error"]);

class ExtractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ExtractError";
    this.code = code;
    this.details = details;
  }
}

function errorMessageOf(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const text = error.content?.[0]?.text;
    if (typeof text === "string") return text;
    if (typeof error.message === "string") return error.message;
    return JSON.stringify(error);
  }
  return String(error);
}

function errorCodeOf(error) {
  if (error && typeof error === "object" && typeof error.code === "string") return error.code;
  return null;
}

function isTransientTabError(error) {
  const message = errorMessageOf(error);
  return TRANSIENT_TAB_ERROR_MARKERS.some((marker) => message.includes(marker));
}

/**
 * Whether a failed attempt is worth a fresh tab. Login bounces, challenges
 * and not-found pages are not: the next tab lands on the same page.
 */
function isRetryableExtractionError(error) {
  const code = errorCodeOf(error);
  if (code && FATAL_READINESS_CODES.has(code)) return false;
  if (code && RETRYABLE_ERROR_CODES.has(code)) return true;
  return isTransientTabError(error);
}

function responseText(response) {
  const text = response?.result?.content?.[0]?.text;
  return typeof text === "string" ? text : null;
}

function responseError(response, stage) {
  if (!response || !response.error) return null;
  const err = response.error;
  const code = errorCodeOf(err) || "tool_error";
  return new ExtractError(code, errorMessageOf(err), { stage, ...(err.details || {}) });
}

function parseExtractionOutput(text) {
  if (text === null || text === undefined || text.trim() === "" || text.trim() === "undefined") {
    throw new ExtractError(
      "no_output",
      "The extraction script returned nothing. End it with `return { rows: [...] }` or `return [...]`.",
    );
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ExtractError("invalid_output", `The extraction script did not return JSON: ${error.message}`, {
      preview: text.slice(0, 200),
    });
  }
}

/**
 * Pick the row array out of the script result: the result itself when it
 * is an array, `--rows <key>` when given, else the first conventional key
 * holding an array. Returns null when the result has no row concept.
 */
function selectRows(data, rowsKey) {
  if (rowsKey) {
    const rows = data && typeof data === "object" && !Array.isArray(data) ? data[rowsKey] : undefined;
    if (!Array.isArray(rows)) {
      throw new ExtractError("rows_key_missing", `The script result has no array at "${rowsKey}"`, {
        keys: data && typeof data === "object" ? Object.keys(data) : [],
      });
    }
    return rows;
  }
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const key of ROW_KEY_CANDIDATES) {
      if (Array.isArray(data[key])) return data[key];
    }
  }
  return null;
}

/**
 * Zero rows is a failure unless the caller opts in. A logged-out render,
 * a selector miss or a half-loaded page all look like "no results"; only
 * the caller knows whether an empty result is plausible.
 */
function enforceRowsInvariant(rows, { allowEmpty = false, readiness } = {}) {
  if (!Array.isArray(rows) || rows.length > 0 || allowEmpty) return;
  if (readiness?.state === "empty") return;
  throw new ExtractError(
    "empty_result",
    "The extraction returned zero rows (the page may be logged out, blocked, or the selectors missed). Pass --allow-empty to accept an empty result, or --empty-text to recognise the page's own no-results message.",
    { rows: 0 },
  );
}

function cellText(value) {
  let text;
  if (value === null || value === undefined) text = "";
  else if (typeof value === "string") text = value;
  else text = JSON.stringify(value);
  return text.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

/** Markdown for humans and LLMs: metadata bullets, then a table of rows. */
function renderExtractionMarkdown(data, rows, { title = "Extraction" } = {}) {
  const lines = [`# ${title}`, ""];
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const [key, value] of Object.entries(data)) {
      if (Array.isArray(value) || (value && typeof value === "object")) continue;
      lines.push(`- ${key}: ${cellText(value)}`);
    }
    if (lines.length > 2) lines.push("");
  }
  if (!Array.isArray(rows)) {
    lines.push("```json", JSON.stringify(data, null, 2), "```");
    return lines.join("\n");
  }
  lines.push(`${rows.length} row${rows.length === 1 ? "" : "s"}`, "");
  if (rows.length === 0) return lines.join("\n").trimEnd();
  if (!rows.every((row) => row !== null && typeof row === "object" && !Array.isArray(row))) {
    for (const row of rows) lines.push(`- ${cellText(row)}`);
    return lines.join("\n");
  }
  const columns = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }
  lines.push(`| ${columns.join(" | ")} |`);
  lines.push(`| ${columns.map(() => "---").join(" | ")} |`);
  for (const row of rows) {
    lines.push(`| ${columns.map((column) => cellText(row[column])).join(" | ")} |`);
  }
  return lines.join("\n");
}

function normalizeRetry(retry) {
  const count = Number.isInteger(retry?.count) ? Math.max(0, Math.min(retry.count, MAX_RETRY_COUNT)) : DEFAULT_RETRY_COUNT;
  const delayMs = Number.isFinite(retry?.delayMs) && retry.delayMs >= 0 ? retry.delayMs : DEFAULT_RETRY_DELAY_MS;
  return { count, delayMs };
}

function readinessArgs(ready = {}) {
  const args = {};
  if (ready.selector) args.selector = ready.selector;
  if (ready.text) args.text = ready.text;
  if (ready.urlPrefix) args.urlPrefix = ready.urlPrefix;
  if (ready.emptyText) args.emptyText = ready.emptyText;
  if (ready.timeout !== undefined) args.timeout = ready.timeout;
  if (ready.interval !== undefined) args.interval = ready.interval;
  return args;
}

/** Tab id from the stable structured field on a tab.new host response. */
function tabIdFromResponse(response) {
  const failure = responseError(response, "tab.new");
  if (failure) throw failure;
  const tabId = response?.result?.tabId;
  if (Number.isInteger(tabId) && tabId > 0) return tabId;
  throw new ExtractError("no_tab", "tab.new did not return a structured tab id");
}

function parseToolJson(response, stage) {
  const failure = responseError(response, stage);
  if (failure) throw failure;
  const text = responseText(response);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Drop transport-only fields from the readiness metadata returned to callers. */
function cleanReadiness(readiness) {
  if (!readiness || typeof readiness !== "object") return readiness;
  const { id, _resolvedTabId, _resolvedWindowId, _hint, ...publicReadiness } = readiness;
  return publicReadiness;
}

async function runAttemptOnTab(executeTool, tabId, settings) {
  const readiness = cleanReadiness(
    parseToolJson(await executeTool("wait.ready", readinessArgs(settings.ready), tabId), "wait.ready"),
  );
  const code = applyOptionsPrelude(settings.code, settings.options);
  const jsResponse = await executeTool("js", { code }, tabId);
  const failure = responseError(jsResponse, "js");
  if (failure) throw failure;
  const data = parseExtractionOutput(responseText(jsResponse));
  const rows = selectRows(data, settings.rowsKey);
  enforceRowsInvariant(rows, { allowEmpty: settings.allowEmpty, readiness });
  return { data, rows, readiness };
}

/**
 * @param {object} settings
 * @param {(tool: string, args: object, tabId?: number) => Promise<object>} settings.executeTool
 *   Sends one tool request. `tabId` overrides the target for owned tabs; when
 *   it is undefined the caller's default target (session/tab/window) applies.
 * @param {string} settings.code Page-side script; must `return` JSON.
 * @param {string} [settings.url] Page to open. Required unless `target` is set.
 * @param {object} [settings.options] Exposed to the script as SURF_OPTIONS.
 * @param {object} [settings.ready] wait.ready expectations (selector, text, urlPrefix, emptyText, timeout, interval).
 * @param {{count?: number, delayMs?: number}} [settings.retry]
 * @param {boolean} [settings.keepTab] Leave the owned tab open on success.
 * @param {boolean} [settings.allowEmpty]
 * @param {string} [settings.rowsKey]
 * @param {boolean} [settings.target] Use the caller's target instead of an owned tab.
 * @param {(error: unknown) => boolean} [settings.isRetryable]
 * @param {(ms: number) => Promise<void>} [settings.sleep]
 * @param {(event: object) => void} [settings.onEvent]
 */
async function runExtraction(settings) {
  const {
    executeTool,
    code,
    url,
    target = false,
    keepTab = false,
    isRetryable = isRetryableExtractionError,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    onEvent = () => {},
  } = settings;
  if (typeof executeTool !== "function") throw new Error("runExtraction requires executeTool");
  if (typeof code !== "string" || code.trim() === "") throw new ExtractError("no_script", "An extraction script is required (--file or --code)");
  if (!target && !url) throw new ExtractError("no_url", "A URL is required unless --tab-id or --session names the page to read");

  if (target) {
    // Caller-supplied target: navigate once if asked, never close, never retry.
    if (url) {
      const navigation = await executeTool("navigate", { url });
      const failure = responseError(navigation, "navigate");
      if (failure) throw failure;
    }
    onEvent({ type: "attempt", attempt: 1, of: 1, mode: "target" });
    const attempt = await runAttemptOnTab(executeTool, undefined, settings);
    return { ...attempt, rowCount: Array.isArray(attempt.rows) ? attempt.rows.length : null, attempts: 1, mode: "target", url: url ?? null };
  }

  const retry = normalizeRetry(settings.retry);
  const attempts = retry.count + 1;
  let lastError = null;
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    attemptsMade = attempt;
    if (attempt > 1) await sleep(retry.delayMs);
    onEvent({ type: "attempt", attempt, of: attempts, mode: "owned-tab" });
    let tabId = null;
    let result;
    try {
      tabId = tabIdFromResponse(await executeTool("tab.new", { url }));
      result = await runAttemptOnTab(executeTool, tabId, settings);
    } catch (error) {
      lastError = error;
      let cleanupError = null;
      if (tabId) {
        try {
          const closed = await executeTool("tab.close", { id: tabId }, tabId);
          const closeFailure = responseError(closed, "tab.close");
          if (closeFailure) throw closeFailure;
        } catch (closeError) {
          cleanupError = closeError;
          onEvent({ type: "close-failed", attempt, tabId, error: errorMessageOf(closeError) });
        }
      }
      if (cleanupError) {
        throw new ExtractError("cleanup_failed", `Extraction failed and the owned tab could not be closed: ${errorMessageOf(cleanupError)}`, {
          stage: "tab.close",
          tabId,
          attempts: attempt,
          extractionError: { code: errorCodeOf(error), message: errorMessageOf(error) },
        });
      }
      const retryable = attempt < attempts && isRetryable(error);
      onEvent({ type: "attempt-failed", attempt, of: attempts, error: errorMessageOf(error), code: errorCodeOf(error), retryable });
      if (!retryable) break;
      continue;
    }

    if (!keepTab) {
      try {
        const closed = await executeTool("tab.close", { id: tabId }, tabId);
        const closeFailure = responseError(closed, "tab.close");
        if (closeFailure) throw closeFailure;
      } catch (error) {
        throw new ExtractError("cleanup_failed", `Extraction succeeded but the owned tab could not be closed: ${errorMessageOf(error)}`, {
          stage: "tab.close",
          tabId,
          attempts: attempt,
          extractionSucceeded: true,
          rowCount: Array.isArray(result.rows) ? result.rows.length : null,
        });
      }
    }
    return {
      ...result,
      rowCount: Array.isArray(result.rows) ? result.rows.length : null,
      attempts: attempt,
      mode: "owned-tab",
      url,
      tabId: keepTab ? tabId : null,
    };
  }
  if (lastError instanceof ExtractError) {
    lastError.details = { ...lastError.details, attempts: attemptsMade };
    throw lastError;
  }
  throw new ExtractError(errorCodeOf(lastError) || "extraction_failed", errorMessageOf(lastError), { attempts: attemptsMade });
}

module.exports = {
  ExtractError,
  enforceRowsInvariant,
  isRetryableExtractionError,
  isTransientTabError,
  parseExtractionOutput,
  renderExtractionMarkdown,
  runExtraction,
  selectRows,
  tabIdFromResponse,
};
