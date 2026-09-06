/**
 * Page readiness classification.
 *
 * A navigation can settle in states other than "the page you wanted": an
 * anti-bot interstitial, a bounce to a login form, a not-found page, a
 * browser error page, or an explicit "no results" render. Waiting for a
 * selector on such a page only times out and hides the cause. This module
 * turns a DOM snapshot into a typed verdict so callers can branch on the
 * state instead of on a timeout.
 *
 * The classifier is pure: it only looks at the `ReadinessSnapshot` it is
 * given. The snapshot is collected in the content script (see
 * `src/content/page-readiness-probe.ts`), and every rule below is
 * site-independent: it relies on browser behaviour, vendor-neutral markup
 * conventions and generic wording, never on a particular site's layout.
 *
 * This module is bundled into the content script only. The service worker
 * side (state lists, error codes, the poll loop) lives in
 * `./readiness-poll.ts`; the two share only types, so the extension build
 * does not emit a chunk that a classic content script could not import.
 */

import type { ReadinessState } from "./readiness-poll";

export interface ReadinessExpectations {
  /** CSS selector that must be present and visible before the page counts as ready. */
  selector?: string;
  /** Text that must appear in the page before it counts as ready. */
  text?: string;
  /** The page URL must start with this prefix; a different URL is a bounce. */
  urlPrefix?: string;
  /** Text that marks an explicit "no results" render (state `empty`). */
  emptyText?: string;
}

export interface ExpectationOutcome<T> {
  expected: T;
  matched: boolean;
}

export interface ReadinessSnapshot {
  href: string;
  title: string;
  readyState: string;
  /** `chrome.tabs.Tab.status` when the caller knows it. */
  tabStatus?: string;
  /** Normalized visible body text, truncated to a few thousand characters. */
  bodyTextSample: string;
  /** Length of the full normalized body text. */
  bodyTextLength: number;
  /** Visible h1/h2 texts, document order. */
  headings: string[];
  visiblePasswordInputs: number;
  visibleTextInputs: number;
  /** Selectors from CHALLENGE_MARKER_SELECTORS that matched. */
  challengeMarkers: string[];
  /** Visible captcha or challenge iframes. */
  captchaFrames: number;
  selector?: ExpectationOutcome<string>;
  text?: ExpectationOutcome<string>;
  urlPrefix?: ExpectationOutcome<string>;
  emptyText?: ExpectationOutcome<string>;
}

export interface ReadinessVerdict {
  state: ReadinessState;
  /** Human-readable reasons, most decisive first. */
  evidence: string[];
}

/**
 * Vendor-neutral markup left by common anti-bot interstitials. These are
 * markers of the challenge vendors themselves, not of any target site.
 */
export const CHALLENGE_MARKER_SELECTORS: readonly string[] = [
  "#challenge-running",
  "#challenge-form",
  "#challenge-stage",
  "#cf-challenge-running",
  "form[action*='captcha' i]",
  "[data-sitekey][data-callback]",
];

/** iframes that host captcha widgets. Only decisive on otherwise empty pages. */
export const CAPTCHA_FRAME_SELECTORS: readonly string[] = [
  "iframe[src*='captcha' i]",
  "iframe[src*='challenge' i]",
  "iframe[title*='captcha' i]",
];

export const CHALLENGE_TITLE_PATTERN =
  /just a moment|attention required|access denied|verify(?:ing)? (?:that )?you are (?:a )?human|security check|checking your browser|are you a robot|bot (?:detection|check|protection)|captcha|one more step|please wait while we verify/i;

export const CHALLENGE_TEXT_PATTERN =
  /verify(?:ing)? (?:that )?you are (?:a )?human|checking (?:your|the) browser|enable javascript and cookies|unusual traffic|automated (?:access|requests|queries)|complete the security check|prove you are human/i;

export const NOT_FOUND_PATTERN =
  /\b404\b|\bnot found\b|page (?:doesn.t|does not|cannot be|could not be|can.t be) (?:exist|found)|no longer (?:available|exists)|(?:doesn.t|does not) exist\b/i;

export const LOGIN_PATH_PATTERN =
  /(?:^|\/)(?:log-?in|sign-?in|sign-?on|auth|authenticate|authorize|sso|oauth2?|session\/new|users\/sign_in|account\/login)(?:\/|$|\?|#)/i;

export const LOGIN_TITLE_PATTERN = /\b(?:log ?in|sign ?in|sign ?on|authenticate|authentication)\b/i;

export const BROWSER_ERROR_PATTERN =
  /this site can.t be reached|took too long to respond|ERR_[A-Z_]{4,}|no internet|connection (?:was )?(?:reset|refused)/i;

/** Body text shorter than this is treated as an interstitial or error page, not content. */
export const SHORT_PAGE_TEXT_LENGTH = 800;

export function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function pathnameOf(href: string): string {
  try {
    return new URL(href).pathname;
  } catch {
    return "";
  }
}

function isBlankHref(href: string): boolean {
  return href === "" || href === "about:blank" || href.startsWith("about:blank?");
}

function classifyError(snapshot: ReadinessSnapshot): ReadinessVerdict | null {
  if (snapshot.href.startsWith("chrome-error://")) {
    return { state: "error", evidence: [`browser error page ${snapshot.href}`] };
  }
  if (snapshot.bodyTextLength < SHORT_PAGE_TEXT_LENGTH) {
    const match = snapshot.bodyTextSample.match(BROWSER_ERROR_PATTERN);
    if (match) {
      return { state: "error", evidence: [`page text reads like a browser error: "${match[0]}"`] };
    }
  }
  return null;
}

function classifyChallenge(snapshot: ReadinessSnapshot): ReadinessVerdict | null {
  const evidence: string[] = [];
  if (snapshot.challengeMarkers.length > 0) {
    evidence.push(`challenge markup present: ${snapshot.challengeMarkers.join(", ")}`);
  }
  const titleMatch = snapshot.title.match(CHALLENGE_TITLE_PATTERN);
  if (titleMatch) {
    evidence.push(`title "${snapshot.title}" matches challenge wording`);
  }
  const shortPage = snapshot.bodyTextLength < SHORT_PAGE_TEXT_LENGTH;
  if (shortPage) {
    const headingMatch = snapshot.headings.find((heading) => CHALLENGE_TITLE_PATTERN.test(heading));
    if (headingMatch) {
      evidence.push(`heading "${headingMatch}" matches challenge wording`);
    }
    const textMatch = snapshot.bodyTextSample.match(CHALLENGE_TEXT_PATTERN);
    if (textMatch) {
      evidence.push(`short page text contains "${textMatch[0]}"`);
    }
    if (snapshot.captchaFrames > 0) {
      evidence.push(`${snapshot.captchaFrames} captcha frame(s) on a short page`);
    }
  }
  if (evidence.length === 0) {
    return null;
  }
  // A lone captcha frame on a short page is weak on its own (cookie banners,
  // tiny login forms); require a second signal for it.
  if (evidence.length === 1 && snapshot.captchaFrames > 0 && snapshot.challengeMarkers.length === 0 && !titleMatch) {
    return null;
  }
  return { state: "challenge", evidence };
}

function classifyNotFound(snapshot: ReadinessSnapshot): ReadinessVerdict | null {
  const titleMatch = snapshot.title.match(NOT_FOUND_PATTERN);
  if (titleMatch) {
    return { state: "not-found", evidence: [`title "${snapshot.title}" matches not-found wording`] };
  }
  const heading = snapshot.headings.find((text) => NOT_FOUND_PATTERN.test(text));
  if (heading) {
    return { state: "not-found", evidence: [`heading "${heading}" matches not-found wording`] };
  }
  return null;
}

function classifyLogin(snapshot: ReadinessSnapshot): ReadinessVerdict | null {
  const evidence: string[] = [];
  const passwordVisible = snapshot.visiblePasswordInputs > 0;
  const urlLooksLogin = LOGIN_PATH_PATTERN.test(pathnameOf(snapshot.href));
  const titleLooksLogin = LOGIN_TITLE_PATTERN.test(snapshot.title);
  const bounced = snapshot.urlPrefix !== undefined && !snapshot.urlPrefix.matched;

  if (passwordVisible) evidence.push(`${snapshot.visiblePasswordInputs} visible password field(s)`);
  if (urlLooksLogin) evidence.push(`URL path ${pathnameOf(snapshot.href)} looks like a login route`);
  if (titleLooksLogin) evidence.push(`title "${snapshot.title}" mentions signing in`);
  if (bounced && snapshot.urlPrefix) {
    evidence.push(`URL ${snapshot.href} left the expected prefix ${snapshot.urlPrefix.expected}`);
  }

  const isLogin =
    (passwordVisible && (urlLooksLogin || titleLooksLogin || bounced)) ||
    (urlLooksLogin && (titleLooksLogin || bounced));
  return isLogin ? { state: "login", evidence } : null;
}

function describeExpectation(name: string, outcome: ExpectationOutcome<string> | undefined): string | null {
  if (!outcome) return null;
  return `${name} "${outcome.expected}" ${outcome.matched ? "found" : "not found"}`;
}

/**
 * Classify a snapshot. Negative states win over loading so a bounce is
 * reported as soon as it renders instead of after a timeout; an explicit
 * empty render wins over a missing content selector; expectations gate
 * `ready`.
 */
export function classifyReadiness(snapshot: ReadinessSnapshot): ReadinessVerdict {
  const negative =
    classifyError(snapshot) ??
    classifyChallenge(snapshot) ??
    classifyNotFound(snapshot) ??
    classifyLogin(snapshot);
  if (negative) {
    return negative;
  }

  const evidence: string[] = [];
  const blank = isBlankHref(snapshot.href);
  const expectsBlank = snapshot.urlPrefix?.expected.startsWith("about:blank") === true;
  if (blank && !expectsBlank) {
    return { state: "loading", evidence: [`URL is ${snapshot.href || "empty"}`] };
  }
  if (snapshot.urlPrefix && !snapshot.urlPrefix.matched) {
    return {
      state: "loading",
      evidence: [`URL ${snapshot.href} does not start with ${snapshot.urlPrefix.expected}`],
    };
  }

  const contentPresent = snapshot.selector?.matched === true || snapshot.text?.matched === true;
  if (snapshot.readyState !== "complete" && !contentPresent) {
    evidence.push(`document.readyState is ${snapshot.readyState}`);
    if (snapshot.tabStatus && snapshot.tabStatus !== "complete") {
      evidence.push(`tab status is ${snapshot.tabStatus}`);
    }
    return { state: "loading", evidence };
  }

  if (snapshot.emptyText?.matched) {
    return { state: "empty", evidence: [`empty-state text "${snapshot.emptyText.expected}" found`] };
  }

  const missing = [
    snapshot.selector && !snapshot.selector.matched ? describeExpectation("selector", snapshot.selector) : null,
    snapshot.text && !snapshot.text.matched ? describeExpectation("text", snapshot.text) : null,
  ].filter((entry): entry is string => entry !== null);
  if (missing.length > 0) {
    return { state: "loading", evidence: missing };
  }

  const matched = [
    describeExpectation("selector", snapshot.selector),
    describeExpectation("text", snapshot.text),
  ].filter((entry): entry is string => entry !== null);
  if (matched.length === 0) {
    matched.push(`document.readyState is ${snapshot.readyState}`);
  }
  if (snapshot.visiblePasswordInputs > 0) {
    matched.push(`${snapshot.visiblePasswordInputs} visible password field(s), page otherwise looks ready`);
  }
  return { state: "ready", evidence: matched };
}
