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
