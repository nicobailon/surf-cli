export function scrollToPosition(pos: string | number, selector: string | null = null) {
  const findScrollable = (): Element => {
    const candidates = [...document.querySelectorAll("*")]
      .filter((element) => element.scrollHeight > element.clientHeight && element.clientHeight > 200)
      .sort((left, right) => right.scrollHeight - left.scrollHeight);
    return candidates[0] || document.documentElement;
  };

  const container = selector ? document.querySelector(selector) || findScrollable() : findScrollable();
  if (!container) return { error: "No scrollable container found" };

  if (pos === "bottom") {
    container.scrollTop = container.scrollHeight;
  } else if (pos === "top") {
    container.scrollTop = 0;
  } else if (typeof pos === "number") {
    container.scrollTop = pos;
  }

  return {
    scrollTop: container.scrollTop,
    scrollHeight: container.scrollHeight,
    clientHeight: container.clientHeight,
    atBottom: container.scrollTop + container.clientHeight >= container.scrollHeight - 10,
    atTop: container.scrollTop < 10,
  };
}

export interface SemanticScrollGeometry {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  intervalStart: number;
  intervalEnd: number;
  atTop: boolean;
  atBottom: boolean;
}

type PinnedScope = { element: WeakRef<Element>; documentToken: string };
const semanticScrollScopes = new Map<string, PinnedScope>();

function selectSemanticScrollContainer(): Element | null {
  const candidates = [...document.querySelectorAll("*")]
    .filter((element) => element.scrollHeight > element.clientHeight && element.clientHeight > 0)
    .sort((left, right) => right.scrollHeight - left.scrollHeight);
  return candidates[0] || document.scrollingElement || document.documentElement || null;
}

function clippedGeometry(container: Element): SemanticScrollGeometry | null {
  const scrollHeight = Math.max(0, Number(container.scrollHeight) || 0);
  const rawClientHeight = Math.max(0, Number(container.clientHeight) || 0);
  const scrollTop = Math.min(
    Math.max(0, Number(container.scrollTop) || 0),
    Math.max(0, scrollHeight - rawClientHeight),
  );
  const isDocument = container === document.documentElement || container === document.scrollingElement;
  let clippedOffset = 0;
  let clientHeight = Math.min(rawClientHeight || window.innerHeight, window.innerHeight);

  if (!isDocument) {
    const rect = container.getBoundingClientRect();
    const clippedTop = Math.max(0, rect.top);
    const clippedBottom = Math.min(window.innerHeight, rect.bottom);
    clientHeight = Math.max(0, Math.min(rawClientHeight, clippedBottom - clippedTop));
    clippedOffset = Math.max(0, clippedTop - rect.top);
  }
  if (clientHeight <= 0) return null;

  const intervalStart = Math.min(scrollHeight, scrollTop + clippedOffset);
  const intervalEnd = Math.min(scrollHeight, intervalStart + clientHeight);
  return {
    scrollTop,
    scrollHeight,
    clientHeight,
    intervalStart,
    intervalEnd,
    atTop: scrollTop <= 0,
    atBottom: intervalEnd >= scrollHeight,
  };
}

export function inspectSemanticScrollScope(documentToken: string) {
  const container = selectSemanticScrollContainer();
  if (!container) return { success: false, reason: "unsupported_scroll_scope" };
  const geometry = clippedGeometry(container);
  if (!geometry) return { success: false, reason: "unsupported_scroll_scope" };
  const scopeToken = globalThis.crypto?.randomUUID?.() ||
    `scope-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  semanticScrollScopes.set(scopeToken, { element: new WeakRef(container), documentToken });
  return { success: true, scopeToken, geometry };
}

export function moveSemanticScrollScope(
  action: "top" | "advance",
  scopeToken: string,
  documentToken: string,
) {
  const scope = semanticScrollScopes.get(scopeToken);
  const container = scope?.element.deref();
  if (
    !scope || scope.documentToken !== documentToken || !container ||
    ("isConnected" in container && container.isConnected === false)
  ) {
    semanticScrollScopes.delete(scopeToken);
    return { success: false, reason: "stale_scroll_scope" };
  }
  const before = clippedGeometry(container);
  if (!before) return { success: false, reason: "stale_scroll_scope" };

  if (action === "top") {
    container.scrollTop = 0;
  } else if (action === "advance") {
    container.scrollTop = before.scrollTop + Math.floor(before.clientHeight * 0.75);
  } else {
    return { success: false, reason: "unsupported_scroll_action" };
  }

  const geometry = clippedGeometry(container);
  if (!geometry) return { success: false, reason: "stale_scroll_scope" };
  return { success: true, scopeToken, geometry };
}
