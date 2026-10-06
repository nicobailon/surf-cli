// --vision tiles: each unlabeled control's own icon drawn onto a blank canvas. No page pixels are ever read.

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const SVG_PROPERTIES = [
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity", "fill-opacity", "stroke-opacity",
  "fill-rule", "display", "visibility", "color",
];
// Longest tile side in device pixels, and the time one tile may take (image loads, font loads, extension fetches).
const TILE_MAX_SIDE = 1024;
const TILE_TIMEOUT_MS = 3_000;
const MAX_USE_EXPANSIONS = 64;

export type SemanticVisionIconSource =
  | { kind: "svg"; element: Element }
  | { kind: "image"; element: Element }
  | { kind: "glyph"; element: Element; pseudo: "::before" | "::after" | null; text: string }
  | { kind: "mask"; element: Element }
  | { kind: "background"; element: Element };

export type SemanticVisionTile = { ref: string; data: string; width: number; height: number };

type Drawable = { image: CanvasImageSource; width: number; height: number };
type Loader = (url: string) => Promise<Drawable>;
type Box = { x: number; y: number; width: number; height: number };

function rendered(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && element.checkVisibility({ visibilityProperty: true, opacityProperty: true });
}

function ownText(element: Element): string {
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent)
    .join("")
    .trim();
}

// Text of a computed `content` that is a single CSS string; null for none, normal, url(), attr(), counters and alt text.
function pseudoText(element: Element, pseudo: "::before" | "::after"): string | null {
  const match = /^"((?:[^"\\]|\\.)*)"$/.exec(getComputedStyle(element, pseudo).content);
  const text = match ? match[1].replace(/\\(.)/g, "$1") : "";
  return text.trim() ? text : null;
}

function glyphSource(element: Element): SemanticVisionIconSource | null {
  const text = ownText(element);
  if (text) return { kind: "glyph", element, pseudo: null, text };
  for (const pseudo of ["::before", "::after"] as const) {
    const content = pseudoText(element, pseudo);
    if (content) return { kind: "glyph", element, pseudo, text: content };
  }
  return null;
}

function maskImage(style: CSSStyleDeclaration): string {
  return style.getPropertyValue("mask-image") || style.getPropertyValue("-webkit-mask-image") || "none";
}

/**
 * The icon source of a control, from the control and its rendered descendants, in fixed priority order: inline svg,
 * image (img, picture, input type=image), icon-font glyph (own text, ::before, ::after), CSS mask-image, CSS
 * background-image. Null when none applies.
 */
export function semanticVisionIconSource(control: Element): SemanticVisionIconSource | null {
  const elements = [control, ...Array.from(control.querySelectorAll("*"))].filter(rendered);
  const first = (pick: (element: Element) => SemanticVisionIconSource | null) => {
    for (const element of elements) {
      const source = pick(element);
      if (source) return source;
    }
    return null;
  };
  return first((element) => element.localName === "svg" && element.namespaceURI === SVG_NS ? { kind: "svg", element } : null) ??
    first((element) =>
      element.localName === "img" || (element.localName === "input" && (element as HTMLInputElement).type === "image")
        ? { kind: "image", element }
        : null) ??
    first(glyphSource) ??
    first((element) => maskImage(getComputedStyle(element)) !== "none" ? { kind: "mask", element } : null) ??
    first((element) => getComputedStyle(element).backgroundImage !== "none" ? { kind: "background", element } : null);
}

// Splits a computed comma-separated list at top level (data: URLs carry commas inside url("...")).
function layers(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (quote) {
      if (char === "\\") index++;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function cssUrl(layer: string): string | null {
  const match = /^url\("((?:[^"\\]|\\.)*)"\)$/.exec(layer);
  return match ? match[1].replace(/\\(.)/g, "$1") : null;
}

function length(token: string, box: number): number | null {
  if (token === "auto") return null;
  const value = parseFloat(token);
  if (!Number.isFinite(value) || !/^-?[\d.]+(px|%)$/.test(token)) throw new Error(`unsupported CSS length ${token}`);
  return token.endsWith("%") ? (value / 100) * box : value;
}

// Painted size of an image layer for a computed background-size / mask-size.
function layerSize(value: string, image: Drawable, box: Box): [number, number] {
  const width = image.width || box.width;
  const height = image.height || box.height;
  if (value === "contain" || value === "cover") {
    const scale = (value === "contain" ? Math.min : Math.max)(box.width / width, box.height / height);
    return [width * scale, height * scale];
  }
  const [first, second = "auto"] = value.split(/\s+/);
  let w = length(first, box.width);
  let h = length(second, box.height);
  if (w === null && h === null) return [width, height];
  if (w === null) w = ((h as number) * width) / height;
  if (h === null) h = (w * height) / width;
  return [w, h];
}

function layerPosition(value: string, size: [number, number], box: Box): [number, number] {
  const tokens = value.split(/\s+/);
  if (tokens.length !== 2) throw new Error(`unsupported CSS position ${value}`);
  return tokens.map((token, axis) => {
    const free = (axis ? box.height : box.width) - size[axis];
    return token.endsWith("%") ? (parseFloat(token) / 100) * free : (length(token, 0) as number);
  }) as [number, number];
}

function drawLayer(context: CanvasRenderingContext2D, image: Drawable, box: Box, size: string, position: string): void {
  const painted = layerSize(size, image, box);
  const [x, y] = layerPosition(position, painted, box);
  context.save();
  context.beginPath();
  context.rect(box.x, box.y, box.width, box.height);
  context.clip();
  context.drawImage(image.image, box.x + x, box.y + y, painted[0], painted[1]);
  context.restore();
}

function loadImage(url: string, crossOrigin: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (crossOrigin) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("icon image failed to load"));
    image.src = url;
  });
}

async function imageDrawable(url: string, crossOrigin: boolean): Promise<Drawable> {
  const image = await loadImage(url, crossOrigin);
  return { image, width: image.naturalWidth, height: image.naturalHeight };
}

async function blobDrawable(blob: Blob): Promise<Drawable> {
  if (blob.type !== "image/svg+xml") {
    const bitmap = await createImageBitmap(blob);
    return { image: bitmap, width: bitmap.width, height: bitmap.height };
  }
  // An <img> from this world's own blob: URL never taints the canvas.
  const url = URL.createObjectURL(blob);
  try {
    return await imageDrawable(url, false);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Draws as the page does: same-origin, data: and CORS-readable images are used directly (a cross-origin one without
// CORS taints the canvas). Masks load in CORS mode, as the page loads them, so a mask the page can't render fails.
const directLoader: Loader = (url) => imageDrawable(url, false);
const corsLoader: Loader = (url) => imageDrawable(url, true);

// Bytes fetched by the service worker with the extension's host permissions, for images the page shows but this
// world can't read.
const extensionLoader: Loader = async (url) => {
  const response = await chrome.runtime.sendMessage({ type: "SEMANTIC_VISION_ICON_FETCH", url });
  if (typeof response?.data !== "string" || typeof response.mimeType !== "string") {
    throw new Error(response?.error || "icon fetch failed");
  }
  const binary = atob(response.data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return blobDrawable(new Blob([bytes], { type: response.mimeType }));
};

async function svgDrawable(svg: Element, box: Box): Promise<Drawable> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const originals = [svg, ...Array.from(svg.querySelectorAll("*"))];
  const copies = [clone, ...Array.from(clone.querySelectorAll("*"))] as SVGElement[];
  originals.forEach((original, index) => {
    const computed = getComputedStyle(original);
    for (const property of SVG_PROPERTIES) copies[index].style.setProperty(property, computed.getPropertyValue(property));
  });
  const root = svg.getRootNode() as Document | ShadowRoot;
  let expansions = 0;
  for (let use = clone.querySelector("use"); use; use = clone.querySelector("use")) {
    const href = use.getAttribute("href") ?? use.getAttributeNS(XLINK_NS, "href") ?? "";
    // Only same-document references; an external sprite file is not drawn.
    if (!href.startsWith("#") || ++expansions > MAX_USE_EXPANSIONS) throw new Error("unsupported <use> reference");
    const target = root.getElementById(href.slice(1));
    if (!target) throw new Error("missing <use> target");
    const nested = document.createElementNS(SVG_NS, "svg");
    if (target.localName === "symbol") {
      for (const name of ["viewBox", "preserveAspectRatio"]) {
        const value = target.getAttribute(name);
        if (value !== null) nested.setAttribute(name, value);
      }
      for (const child of Array.from(target.childNodes)) nested.append(child.cloneNode(true));
    } else {
      nested.append(target.cloneNode(true));
    }
    // The <use>'s resolved fill, stroke and color sit in its style, so the inlined symbol inherits them.
    for (const name of ["x", "y", "width", "height", "style"]) {
      const value = use.getAttribute(name);
      if (value !== null) nested.setAttribute(name, value);
    }
    use.replaceWith(nested);
  }
  clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("width", String(box.width));
  clone.setAttribute("height", String(box.height));
  clone.style.setProperty("width", `${box.width}px`);
  clone.style.setProperty("height", `${box.height}px`);
  return blobDrawable(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
}

function iconFontFamily(family: string): boolean {
  const first = layers(family)[0]?.replace(/^["']|["']$/g, "");
  return Array.from(document.fonts).some((face) => face.family.replace(/^["']|["']$/g, "") === first);
}

async function drawGlyph(
  context: CanvasRenderingContext2D,
  source: Extract<SemanticVisionIconSource, { kind: "glyph" }>,
  box: Box,
): Promise<void> {
  const style = getComputedStyle(source.element, source.pseudo);
  // Only glyphs of a web font the page loaded (an icon font); plain text in system fonts is not an icon.
  if (!iconFontFamily(style.fontFamily)) throw new Error("glyph is not in a loaded icon font");
  const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  await document.fonts.load(font, source.text);
  if (!document.fonts.check(font, source.text)) throw new Error("icon font is not available");
  context.font = font;
  context.fillStyle = style.color;
  const metrics = context.measureText(source.text);
  const width = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
  const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
  context.fillText(
    source.text,
    box.x + (box.width - width) / 2 + metrics.actualBoundingBoxLeft,
    box.y + (box.height - height) / 2 + metrics.actualBoundingBoxAscent,
  );
}

async function drawMask(context: CanvasRenderingContext2D, element: Element, box: Box, scale: number): Promise<void> {
  const style = getComputedStyle(element);
  const images = layers(maskImage(style));
  const url = images.length === 1 ? cssUrl(images[0]) : null;
  if (!url) throw new Error("mask is not a single url() layer");
  const image = await corsLoader(url);
  const canvas = document.createElement("canvas");
  canvas.width = context.canvas.width;
  canvas.height = context.canvas.height;
  const layer = canvas.getContext("2d") as CanvasRenderingContext2D;
  layer.scale(scale, scale);
  drawLayer(
    layer,
    image,
    box,
    style.getPropertyValue("mask-size") || style.getPropertyValue("-webkit-mask-size"),
    style.getPropertyValue("mask-position") || style.getPropertyValue("-webkit-mask-position"),
  );
  layer.globalCompositeOperation = "source-in";
  const background = style.backgroundColor;
  layer.fillStyle = background === "transparent" || background === "rgba(0, 0, 0, 0)" ? style.color : background;
  layer.fillRect(box.x, box.y, box.width, box.height);
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.drawImage(canvas, 0, 0);
  context.restore();
}

async function drawSource(
  context: CanvasRenderingContext2D,
  source: SemanticVisionIconSource,
  box: Box,
  scale: number,
  loader: Loader,
): Promise<void> {
  if (source.kind === "svg") {
    const image = await svgDrawable(source.element, box);
    context.drawImage(image.image, box.x, box.y, box.width, box.height);
  } else if (source.kind === "image") {
    const element = source.element as HTMLImageElement | HTMLInputElement;
    const url = element.localName === "img" ? (element as HTMLImageElement).currentSrc : element.src;
    if (!url) throw new Error("image has no source");
    context.drawImage((await loader(url)).image, box.x, box.y, box.width, box.height);
  } else if (source.kind === "glyph") {
    await drawGlyph(context, source, box);
  } else if (source.kind === "mask") {
    await drawMask(context, source.element, box, scale);
  } else {
    const style = getComputedStyle(source.element);
    const images = layers(style.backgroundImage);
    const index = images.findIndex((layer) => cssUrl(layer) !== null);
    if (index < 0) throw new Error("background has no url() layer");
    const pick = (value: string) => {
      const list = layers(value);
      return list[index % list.length];
    };
    const image = await loader(cssUrl(images[index]) as string);
    drawLayer(context, image, box, pick(style.backgroundSize), pick(style.backgroundPosition));
  }
}

function isTaint(error: unknown): boolean {
  return error instanceof DOMException && error.name === "SecurityError";
}

async function renderTile(control: Element): Promise<Omit<SemanticVisionTile, "ref"> | null> {
  const source = semanticVisionIconSource(control);
  if (!source) return null;
  const outer = control.getBoundingClientRect();
  const inner = source.element.getBoundingClientRect();
  const box = { x: inner.left - outer.left, y: inner.top - outer.top, width: inner.width, height: inner.height };
  const scale = Math.min(window.devicePixelRatio || 1, TILE_MAX_SIDE / outer.width, TILE_MAX_SIDE / outer.height);
  const width = Math.max(1, Math.round(outer.width * scale));
  const height = Math.max(1, Math.round(outer.height * scale));
  const paint = async (loader: Loader) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d") as CanvasRenderingContext2D;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.scale(scale, scale);
    await drawSource(context, source, box, scale, loader);
    // Throws SecurityError when a cross-origin image without CORS tainted the canvas.
    return canvas.toDataURL("image/png").slice("data:image/png;base64,".length);
  };
  try {
    return { data: await paint(directLoader), width, height };
  } catch (error) {
    if (!isTaint(error) || (source.kind !== "image" && source.kind !== "background")) throw error;
    return { data: await paint(extensionLoader), width, height };
  }
}

/** One tile per control whose icon could be drawn; a control without one is left out (the caller counts it skipped). */
export async function renderSemanticVisionTiles(
  targets: Array<{ ref: string; element: Element | undefined }>,
): Promise<SemanticVisionTile[]> {
  const tiles = await Promise.all(targets.map(async ({ ref, element }) => {
    if (!element?.isConnected) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const tile = await Promise.race([
        renderTile(element),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), TILE_TIMEOUT_MS);
        }),
      ]);
      return tile ? { ref, ...tile } : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }));
  return tiles.filter((tile): tile is SemanticVisionTile => tile !== null);
}
