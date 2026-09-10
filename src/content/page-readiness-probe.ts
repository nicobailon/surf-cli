import {
  CAPTCHA_FRAME_SELECTORS,
  CHALLENGE_MARKER_SELECTORS,
  type ReadinessExpectations,
  type ReadinessSnapshot,
  type ReadinessVerdict,
  classifyReadiness,
  normalizeText,
} from "../utils/page-readiness";

/**
 * The minimal view of a document the snapshot collector needs. Real pages
 * go through `createDomProbe`; tests can hand in a plain object.
 */
export interface ReadinessProbeDom {
  href: string;
  title: string;
  readyState: string;
  /** Full normalized visible text of the body. */
  bodyText(): string;
  /** Number of elements matching `selector` that are rendered and visible. */
  countVisible(selector: string): number;
  /** Visible h1/h2 texts in document order. */
  visibleHeadings(): string[];
}

export const BODY_TEXT_SAMPLE_LENGTH = 4000;

const TEXT_INPUT_SELECTOR =
  "input:not([type]), input[type='text'], input[type='email'], input[type='tel'], input[type='search'], input[type='url'], textarea";

export class InvalidReadinessSelectorError extends Error {
  constructor(selector: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Invalid CSS selector "${selector}": ${reason}`);
    this.name = "InvalidReadinessSelectorError";
  }
}

function safeCount(dom: ReadinessProbeDom, selector: string): number {
  try {
    return dom.countVisible(selector);
  } catch {
    return 0;
  }
}

/** Rejects invalid caller-provided CSS. */
export function collectReadinessSnapshot(
  dom: ReadinessProbeDom,
  expect: ReadinessExpectations = {},
): ReadinessSnapshot {
  const bodyText = dom.bodyText();
  const lowerBody = bodyText.toLowerCase();
  const snapshot: ReadinessSnapshot = {
    href: dom.href,
    title: normalizeText(dom.title),
    readyState: dom.readyState,
    bodyTextSample: bodyText.slice(0, BODY_TEXT_SAMPLE_LENGTH),
    bodyTextLength: bodyText.length,
    headings: dom.visibleHeadings().map(normalizeText).filter(Boolean).slice(0, 5),
    visiblePasswordInputs: safeCount(dom, "input[type='password']"),
    visibleTextInputs: safeCount(dom, TEXT_INPUT_SELECTOR),
    challengeMarkers: CHALLENGE_MARKER_SELECTORS.filter((selector) => safeCount(dom, selector) > 0),
    captchaFrames: CAPTCHA_FRAME_SELECTORS.reduce((sum, selector) => sum + safeCount(dom, selector), 0),
  };

  if (expect.selector) {
    try {
      snapshot.selector = { expected: expect.selector, matched: dom.countVisible(expect.selector) > 0 };
    } catch (error) {
      throw new InvalidReadinessSelectorError(expect.selector, error);
    }
  }
  if (expect.text) {
    snapshot.text = {
      expected: expect.text,
      matched: lowerBody.includes(normalizeText(expect.text).toLowerCase()),
    };
  }
  if (expect.urlPrefix) {
    snapshot.urlPrefix = { expected: expect.urlPrefix, matched: dom.href.startsWith(expect.urlPrefix) };
  }
  if (expect.emptyText) {
    snapshot.emptyText = {
      expected: expect.emptyText,
      matched: lowerBody.includes(normalizeText(expect.emptyText).toLowerCase()),
    };
  }
  return snapshot;
}

export interface PageReadinessReport extends ReadinessVerdict {
  href: string;
  title: string;
  readyState: string;
  snapshot: Omit<ReadinessSnapshot, "bodyTextSample">;
}

export function probePageReadiness(
  dom: ReadinessProbeDom,
  expect: ReadinessExpectations = {},
): PageReadinessReport {
  const snapshot = collectReadinessSnapshot(dom, expect);
  const verdict = classifyReadiness(snapshot);
  const { bodyTextSample: _sample, ...rest } = snapshot;
  return {
    ...verdict,
    href: snapshot.href,
    title: snapshot.title,
    readyState: snapshot.readyState,
    snapshot: rest,
  };
}

/** Adapter over a live document. Visibility follows the same rules as wait.element. */
export function createDomProbe(doc: Document, win: Window): ReadinessProbeDom {
  const isVisible = (element: Element): boolean => {
    const style = win.getComputedStyle(element);
    const box = element as HTMLElement;
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      box.offsetWidth > 0 &&
      box.offsetHeight > 0
    );
  };
  return {
    href: win.location.href,
    title: doc.title,
    readyState: doc.readyState,
    bodyText: () => normalizeText(doc.body?.innerText ?? doc.body?.textContent ?? ""),
    countVisible: (selector) => Array.from(doc.querySelectorAll(selector)).filter(isVisible).length,
    visibleHeadings: () =>
      Array.from(doc.querySelectorAll("h1, h2"))
        .filter(isVisible)
        .map((element) => normalizeText(element.textContent)),
  };
}
