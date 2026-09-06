/**
 * Frame diagnosis: three inventories of the same page side by side.
 *
 * A page can carry frames that each inventory sees differently:
 *
 * - The DOM lists `<iframe>` elements with their attributes and layout,
 *   but a `srcdoc` or script-created frame shows up as `about:blank`.
 * - `chrome.webNavigation.getAllFrames` lists the frames the extension can
 *   message, with the numeric ids `frame.switch` uses; a frame the content
 *   script did not load in (sandboxed, restricted, still loading) is
 *   listed but unreachable.
 * - The CDP frame tree (`Page.getFrameTree`) lists what the renderer knows,
 *   with the string ids `frame.js` uses, including out-of-process frames.
 *
 * `buildFrameDiagnosis` correlates the three by URL and explains the
 * mismatches, so an agent can pick the right frame command instead of
 * guessing why a selector never matches.
 */

export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DomIframeEntry {
  domIndex: number;
  /** Resolved absolute URL (`iframe.src`), empty for srcdoc/blank frames. */
  src: string;
  /** The literal `src` attribute, useful when it is relative. */
  srcAttribute?: string;
  srcdoc: boolean;
  title: string;
  name: string;
  id: string;
  sandbox: string | null;
  allow: string;
  rect: FrameRect;
}

export interface ExtensionFrameEntry {
  frameId: number;
  parentFrameId: number;
  url: string;
  errorOccurred: boolean;
  contentScriptReachable: boolean;
  contentScript?: { href?: string; readyState?: string };
  contentScriptError?: string;
}

export interface CdpFrameEntry {
  frameId: string;
  parentId?: string;
  url: string;
  name: string;
}

export interface FrameDiagnosisInput {
  mainPage: { href: string; title: string };
  domIframes: DomIframeEntry[];
  extensionFrames: ExtensionFrameEntry[];
  cdpFrames: CdpFrameEntry[];
}

export interface DiagnosedDomIframe extends DomIframeEntry {
  origin: string | null;
  crossOrigin: boolean;
  blank: boolean;
  zeroSize: boolean;
  scriptsBlocked: boolean;
  extensionFrameIds: number[];
  cdpFrameIds: string[];
}

export interface DiagnosedExtensionFrame extends ExtensionFrameEntry {
  isMain: boolean;
  origin: string | null;
  crossOrigin: boolean;
}

export interface DiagnosedCdpFrame extends CdpFrameEntry {
  isMain: boolean;
  origin: string | null;
  crossOrigin: boolean;
  extensionFrameIds: number[];
}

export interface FrameDiagnosis {
  mainPage: { href: string; title: string; origin: string | null };
  counts: { domIframes: number; extensionFrames: number; cdpFrames: number };
  domIframes: DiagnosedDomIframe[];
  extensionFrames: DiagnosedExtensionFrame[];
  cdpFrames: DiagnosedCdpFrame[];
  warnings: string[];
}

export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.origin === "null" ? null : parsed.origin;
  } catch {
    return null;
  }
}

export function isBlankFrameUrl(url: string): boolean {
  return url === "" || url === "about:blank" || url.startsWith("about:blank?") || url === "about:srcdoc";
}

/** Sandboxed frames run no scripts unless `allow-scripts` is present. */
export function sandboxBlocksScripts(sandbox: string | null): boolean {
  if (sandbox === null) return false;
  return !sandbox.split(/\s+/).includes("allow-scripts");
}

function sameUrl(a: string, b: string): boolean {
  if (isBlankFrameUrl(a) && isBlankFrameUrl(b)) return true;
  return a === b;
}

function short(url: string, max = 80): string {
  if (url.length <= max) return url;
  return `${url.slice(0, max - 3)}...`;
}

export function buildFrameDiagnosis(input: FrameDiagnosisInput): FrameDiagnosis {
  const mainOrigin = originOf(input.mainPage.href);
  const childExtensionFrames = input.extensionFrames.filter((frame) => frame.parentFrameId !== -1);
  const warnings: string[] = [];

  const extensionFrames: DiagnosedExtensionFrame[] = input.extensionFrames.map((frame) => {
    const origin = originOf(frame.url);
    return {
      ...frame,
      isMain: frame.parentFrameId === -1,
      origin,
      crossOrigin: origin !== null && mainOrigin !== null && origin !== mainOrigin,
    };
  });

  const cdpFrames: DiagnosedCdpFrame[] = input.cdpFrames.map((frame) => {
    const origin = originOf(frame.url);
    return {
      ...frame,
      isMain: frame.parentId === undefined,
      origin,
      crossOrigin: origin !== null && mainOrigin !== null && origin !== mainOrigin,
      extensionFrameIds: childExtensionFrames
        .filter((candidate) => !isBlankFrameUrl(frame.url) && sameUrl(candidate.url, frame.url))
        .map((candidate) => candidate.frameId),
    };
  });

  const domIframes: DiagnosedDomIframe[] = input.domIframes.map((iframe) => {
    const blank = iframe.srcdoc || isBlankFrameUrl(iframe.src);
    const origin = blank ? null : originOf(iframe.src);
    const matchesUrl = (url: string): boolean => !blank && sameUrl(url, iframe.src);
    return {
      ...iframe,
      origin,
      crossOrigin: origin !== null && mainOrigin !== null && origin !== mainOrigin,
      blank,
      zeroSize: iframe.rect.width <= 0 || iframe.rect.height <= 0,
      scriptsBlocked: sandboxBlocksScripts(iframe.sandbox),
      extensionFrameIds: childExtensionFrames.filter((frame) => matchesUrl(frame.url)).map((frame) => frame.frameId),
      cdpFrameIds: input.cdpFrames.filter((frame) => frame.parentId !== undefined && matchesUrl(frame.url)).map((frame) => frame.frameId),
    };
  });

  const blankIframes = domIframes.filter((iframe) => iframe.blank);
  if (blankIframes.length > 0) {
    warnings.push(
      `${blankIframes.length} iframe(s) have no URL (about:blank or srcdoc): DOM indexes ${blankIframes.map((iframe) => iframe.domIndex).join(", ")}. Their content cannot be matched by URL; reach it through frame.list / frame.js with the CDP frame id, or frame.switch --index.`,
    );
  }

  for (const iframe of domIframes) {
    if (iframe.scriptsBlocked) {
      warnings.push(`iframe ${iframe.domIndex} (${short(iframe.src) || "no src"}) is sandboxed without allow-scripts: no content script or page script runs inside it.`);
    }
    if (iframe.zeroSize) {
      warnings.push(`iframe ${iframe.domIndex} (${short(iframe.src) || "no src"}) is rendered at ${iframe.rect.width}x${iframe.rect.height}: hidden, collapsed, or not yet laid out.`);
    }
    if (!iframe.blank && iframe.extensionFrameIds.length === 0) {
      warnings.push(`iframe ${iframe.domIndex} (${short(iframe.src)}) has no matching extension frame: it may still be loading, be blocked, or have navigated elsewhere.`);
    }
    if (iframe.extensionFrameIds.length > 1) {
      warnings.push(`iframe ${iframe.domIndex} (${short(iframe.src)}) matches ${iframe.extensionFrameIds.length} extension frames by URL (${iframe.extensionFrameIds.join(", ")}); use frame.switch --index to pick one.`);
    }
  }

  for (const frame of extensionFrames) {
    if (frame.isMain) continue;
    if (!frame.contentScriptReachable) {
      const reason = frame.contentScriptError ? ` (${frame.contentScriptError})` : "";
      warnings.push(`extension frame ${frame.frameId} (${short(frame.url)}) has no reachable content script${reason}: page.read, click by ref and frame.switch will not work inside it; frame.js with its CDP frame id may.`);
    }
    if (frame.errorOccurred) {
      warnings.push(`extension frame ${frame.frameId} (${short(frame.url)}) reported a navigation error.`);
    }
  }

  const unseenByExtension = cdpFrames.filter(
    (frame) => !frame.isMain && !isBlankFrameUrl(frame.url) && frame.extensionFrameIds.length === 0,
  );
  for (const frame of unseenByExtension) {
    warnings.push(`CDP frame ${frame.frameId} (${short(frame.url)}) is not reported by chrome.webNavigation: likely out-of-process or detached; only frame.js can reach it.`);
  }

  const crossOriginCount = domIframes.filter((iframe) => iframe.crossOrigin).length;
  if (crossOriginCount > 0) {
    warnings.push(`${crossOriginCount} cross-origin iframe(s): selectors from the main page do not reach them; switch with frame.switch first.`);
  }

  if (domIframes.length !== childExtensionFrames.length) {
    warnings.push(`DOM lists ${domIframes.length} iframe(s) but the extension sees ${childExtensionFrames.length} child frame(s); nested or detached frames account for the difference.`);
  }

  return {
    mainPage: { ...input.mainPage, origin: mainOrigin },
    counts: {
      domIframes: domIframes.length,
      extensionFrames: extensionFrames.length,
      cdpFrames: cdpFrames.length,
    },
    domIframes,
    extensionFrames,
    cdpFrames,
    warnings,
  };
}

/** Page-side expression that returns the DOM iframe inventory as a plain object. */
export const DOM_IFRAME_INVENTORY_EXPRESSION = `(() => {
  const iframes = Array.from(document.querySelectorAll("iframe")).map((el, domIndex) => {
    const rect = el.getBoundingClientRect();
    return {
      domIndex,
      src: el.hasAttribute("srcdoc") ? "" : el.src || "",
      srcAttribute: el.getAttribute("src") || "",
      srcdoc: el.hasAttribute("srcdoc"),
      title: el.title || "",
      name: el.getAttribute("name") || "",
      id: el.id || "",
      sandbox: el.hasAttribute("sandbox") ? el.getAttribute("sandbox") : null,
      allow: el.getAttribute("allow") || "",
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  });
  return { href: location.href, title: document.title, iframes };
})()`;
