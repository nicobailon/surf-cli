export type VisionRect = { x: number; y: number; width: number; height: number };

type ContactSheetTile = {
  ref: string;
  /** Source rectangle in capture device pixels. */
  crop: VisionRect;
  /** Areas to black out, in crop space (device pixels relative to the crop origin). */
  masks: VisionRect[];
  /** Where the crop is drawn on the sheet, in sheet pixels. */
  sheet: VisionRect;
  /** Band above the tile that carries the ref label, in sheet pixels. */
  label: VisionRect;
};

export type ContactSheetPlan = {
  width: number;
  height: number;
  tiles: ContactSheetTile[];
  skipped: number;
};

const SEMANTIC_VISION_MAX_TILES = 16;
const SEMANTIC_VISION_MAX_SIDE = 1024;
const CROP_PADDING = 4;
const MOVE_TOLERANCE = 2;
const GAP = 8;
const LABEL_HEIGHT = 16;
const LABEL_FONT = "12px monospace";

function intersect(a: VisionRect, b: VisionRect): VisionRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

function toDevice(rect: VisionRect, scale: number): VisionRect {
  const x = Math.floor(rect.x * scale);
  const y = Math.floor(rect.y * scale);
  return {
    x,
    y,
    width: Math.ceil((rect.x + rect.width) * scale) - x,
    height: Math.ceil((rect.y + rect.height) * scale) - y,
  };
}

function moved(before: VisionRect, after: VisionRect): boolean {
  return Math.abs(before.x - after.x) > MOVE_TOLERANCE ||
    Math.abs(before.y - after.y) > MOVE_TOLERANCE ||
    Math.abs(before.width - after.width) > MOVE_TOLERANCE ||
    Math.abs(before.height - after.height) > MOVE_TOLERANCE;
}

/**
 * Plans one contact sheet from rects measured at observation time (`targets`) and
 * re-measured right after the capture (`current`; null means gone or covered).
 * Rects and the viewport are CSS pixels; `scale` is capture device pixels per CSS pixel.
 * A null mask is a field that could not be measured, so no crop can be proven clear of it.
 */
export function planContactSheet(input: {
  targets: Array<{ ref: string; rect: VisionRect | null }>;
  current: Record<string, VisionRect | null>;
  masks: Array<VisionRect | null>;
  scale: number;
  viewport: { width: number; height: number };
}): ContactSheetPlan {
  const { targets, current, masks, scale, viewport } = input;
  const capture = {
    x: 0,
    y: 0,
    width: Math.round(viewport.width * scale),
    height: Math.round(viewport.height * scale),
  };
  const maskable = masks.every((mask) => mask !== null);
  const crops: Array<{ ref: string; crop: VisionRect; masks: VisionRect[] }> = [];
  for (const { ref, rect } of targets) {
    if (crops.length === SEMANTIC_VISION_MAX_TILES || !maskable || !rect) continue;
    const after = current[ref];
    if (!after || after.width <= 0 || after.height <= 0 || moved(rect, after)) continue;
    const padded = {
      x: after.x - CROP_PADDING,
      y: after.y - CROP_PADDING,
      width: after.width + CROP_PADDING * 2,
      height: after.height + CROP_PADDING * 2,
    };
    const crop = intersect(toDevice(padded, scale), capture);
    if (!crop) continue;
    crops.push({
      ref,
      crop,
      masks: masks.flatMap((mask) => {
        const overlap = intersect(toDevice(mask as VisionRect, scale), crop);
        return overlap ? [{ ...overlap, x: overlap.x - crop.x, y: overlap.y - crop.y }] : [];
      }),
    });
  }
  const skipped = targets.length - crops.length;
  if (!crops.length) return { width: 0, height: 0, tiles: [], skipped };

  const columns = Math.ceil(Math.sqrt(crops.length));
  const rows = Math.ceil(crops.length / columns);
  const cellWidth = Math.floor((SEMANTIC_VISION_MAX_SIDE - GAP * (columns + 1)) / columns);
  const cellHeight = Math.floor((SEMANTIC_VISION_MAX_SIDE - GAP * (rows + 1)) / rows) - LABEL_HEIGHT;
  const sized = crops.map((item) => {
    const factor = Math.min(1, cellWidth / item.crop.width, cellHeight / item.crop.height);
    return {
      ...item,
      width: Math.max(1, Math.floor(item.crop.width * factor)),
      height: Math.max(1, Math.floor(item.crop.height * factor)),
      labelWidth: Math.min(cellWidth, item.ref.length * 8 + 4),
    };
  });
  const columnWidths = Array.from({ length: columns }, (_, column) =>
    Math.max(...sized.filter((_, index) => index % columns === column).map((item) => Math.max(item.width, item.labelWidth))));
  const rowHeights = Array.from({ length: rows }, (_, row) =>
    LABEL_HEIGHT + Math.max(...sized.slice(row * columns, (row + 1) * columns).map((item) => item.height)));
  const offset = (sizes: number[], index: number) =>
    GAP + sizes.slice(0, index).reduce((total, size) => total + size + GAP, 0);
  const tiles = sized.map((item, index) => {
    const x = offset(columnWidths, index % columns);
    const y = offset(rowHeights, Math.floor(index / columns));
    const column = columnWidths[index % columns];
    return {
      ref: item.ref,
      crop: item.crop,
      masks: item.masks,
      sheet: { x, y: y + LABEL_HEIGHT, width: item.width, height: item.height },
      label: { x, y, width: column, height: LABEL_HEIGHT },
    };
  });
  return {
    width: offset(columnWidths, columns),
    height: offset(rowHeights, rows),
    tiles,
    skipped,
  };
}

/** Draws each crop on its own canvas and blacks out its masks there, before it reaches the sheet. */
export async function renderContactSheet(source: CanvasImageSource, plan: ContactSheetPlan): Promise<Blob> {
  const sheet = new OffscreenCanvas(plan.width, plan.height);
  const context = sheet.getContext("2d");
  if (!context) throw new Error("Failed to get canvas context");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, plan.width, plan.height);
  for (const tile of plan.tiles) {
    const tileCanvas = new OffscreenCanvas(tile.crop.width, tile.crop.height);
    const tileContext = tileCanvas.getContext("2d");
    if (!tileContext) throw new Error("Failed to get canvas context");
    tileContext.drawImage(
      source,
      tile.crop.x, tile.crop.y, tile.crop.width, tile.crop.height,
      0, 0, tile.crop.width, tile.crop.height,
    );
    tileContext.fillStyle = "#000000";
    for (const mask of tile.masks) tileContext.fillRect(mask.x, mask.y, mask.width, mask.height);
    context.drawImage(tileCanvas, tile.sheet.x, tile.sheet.y, tile.sheet.width, tile.sheet.height);
    context.strokeStyle = "#888888";
    context.lineWidth = 1;
    context.strokeRect(tile.sheet.x - 0.5, tile.sheet.y - 0.5, tile.sheet.width + 1, tile.sheet.height + 1);
    context.fillStyle = "#000000";
    context.font = LABEL_FONT;
    context.textBaseline = "top";
    context.fillText(tile.ref, tile.label.x + 2, tile.label.y + 2, tile.label.width - 4);
  }
  return sheet.convertToBlob({ type: "image/png" });
}
