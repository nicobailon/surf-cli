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
  /**
   * Path of shadow hosts the iframe sits under (`div#host > x-widget`), or
   * null when it is in the light DOM. `document.querySelectorAll("iframe")`
   * never sees the former.
   */
  shadowHost?: string | null;
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

/** The name CDP reports for a frame is the iframe's `name`, else its `id`. */
function frameName(iframe: DomIframeEntry): string {
  return iframe.name || iframe.id || "";
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
    const name = frameName(iframe);
    // CDP names frames after the iframe's name/id, which is the only handle a
    // srcdoc or about:blank frame has.
    const matchesCdp = (frame: CdpFrameEntry): boolean =>
      frame.parentId !== undefined && (matchesUrl(frame.url) || (name !== "" && frame.name === name));
    return {
      ...iframe,
      shadowHost: iframe.shadowHost ?? null,
      origin,
      crossOrigin: origin !== null && mainOrigin !== null && origin !== mainOrigin,
      blank,
      zeroSize: iframe.rect.width <= 0 || iframe.rect.height <= 0,
      scriptsBlocked: sandboxBlocksScripts(iframe.sandbox),
      extensionFrameIds: childExtensionFrames.filter((frame) => matchesUrl(frame.url)).map((frame) => frame.frameId),
      cdpFrameIds: input.cdpFrames.filter(matchesCdp).map((frame) => frame.frameId),
    };
  });

  const unmatchedBlank = domIframes.filter((iframe) => iframe.blank && iframe.cdpFrameIds.length === 0);
  if (unmatchedBlank.length > 0) {
    warnings.push(
      `${unmatchedBlank.length} iframe(s) have no URL (about:blank or srcdoc): DOM indexes ${unmatchedBlank.map((iframe) => iframe.domIndex).join(", ")}. No CDP frame carries their name or id, so their content cannot be matched; give them a name or id attribute, or use frame.switch --index.`,
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
    if (!iframe.blank && iframe.extensionFrameIds.length > 0 && iframe.cdpFrameIds.length === 0) {
      const reachable = iframe.extensionFrameIds.every(
        (id) => input.extensionFrames.find((frame) => frame.frameId === id)?.contentScriptReachable === true,
      );
      if (iframe.crossOrigin) {
        warnings.push(
          `iframe ${iframe.domIndex} (${short(iframe.src)}) is out-of-process: it is missing from this tab's CDP frame tree, so frame.js cannot reach it; ${
            reachable
              ? "its content script answers, so frame.switch, page.read and click by ref work there."
              : "its content script is unreachable too, so nothing in this tab can drive it."
          }`,
        );
      } else {
        warnings.push(
          `iframe ${iframe.domIndex} (${short(iframe.src)}) has an extension frame but no CDP frame: it is still loading, navigated, or runs out of process; retry, or use frame.switch.`,
        );
      }
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
    const nested = childExtensionFrames.filter((frame) => frame.parentFrameId !== 0).length;
    const shadowed = domIframes.filter((iframe) => iframe.shadowHost).length;
    const explained = domIframes.length === childExtensionFrames.length - nested;
    warnings.push(
      `DOM lists ${domIframes.length} iframe(s)${shadowed > 0 ? ` (${shadowed} inside open shadow roots)` : ""} but the extension sees ${childExtensionFrames.length} child frame(s)${nested > 0 ? `, ${nested} of them nested below another frame` : ""}; ${
        explained
          ? "the nested frames account for the difference."
          : "the rest live in closed shadow roots, were created after the snapshot, or are detached."
      }`,
    );
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
  const describe = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.classList.length ? "." + Array.from(el.classList).slice(0, 2).join(".") : "");
  const found = [];
  // Walk open shadow roots too: querySelectorAll("iframe") on the document
  // misses every frame a custom element renders inside its shadow tree.
  const walk = (root, hostPath) => {
    for (const el of root.querySelectorAll("iframe")) found.push({ el, hostPath });
    for (const host of root.querySelectorAll("*")) {
      if (host.shadowRoot) walk(host.shadowRoot, hostPath ? hostPath + " > " + describe(host) : describe(host));
    }
  };
  walk(document, "");
  const iframes = found.map(({ el, hostPath }, domIndex) => {
    const rect = el.getBoundingClientRect();
    return {
      domIndex,
      shadowHost: hostPath || null,
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
