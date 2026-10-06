export type VisionRect = { x: number; y: number; width: number; height: number };

/** A control's icon tile from the content script: a PNG (base64) of its own icon on a blank canvas. */
export type SemanticVisionTile = { ref: string; data: string; width: number; height: number };

export type SemanticVision = {
  image: { mimeType: "image/png"; data: string } | null;
  tiles: Array<{ ref: string } & VisionRect>;
  skipped: number;
};

type ContactSheetPlan = {
  width: number;
  height: number;
  /** `sheet` is where the tile is drawn and `label` the band above it that carries the ref, in sheet pixels. */
  tiles: Array<{ ref: string; sheet: VisionRect; label: VisionRect }>;
};

export const SEMANTIC_VISION_MAX_TILES = 16;
const SEMANTIC_VISION_MAX_SIDE = 1024;
const GAP = 8;
const LABEL_HEIGHT = 16;
const LABEL_FONT = "12px monospace";
const ICON_FETCH_MAX_BYTES = 512 * 1024;
const ICON_FETCH_TIMEOUT_MS = 2_000;

/** Lays the tiles out in a grid whose long side is at most 1024 pixels, shrinking a tile only when it doesn't fit. */
export function planContactSheet(tiles: Array<{ ref: string; width: number; height: number }>): ContactSheetPlan {
  const columns = Math.ceil(Math.sqrt(tiles.length));
  const rows = Math.ceil(tiles.length / columns);
  const cellWidth = Math.floor((SEMANTIC_VISION_MAX_SIDE - GAP * (columns + 1)) / columns);
  const cellHeight = Math.floor((SEMANTIC_VISION_MAX_SIDE - GAP * (rows + 1)) / rows) - LABEL_HEIGHT;
  const sized = tiles.map((tile) => {
    const factor = Math.min(1, cellWidth / tile.width, cellHeight / tile.height);
    return {
      ref: tile.ref,
      width: Math.max(1, Math.floor(tile.width * factor)),
      height: Math.max(1, Math.floor(tile.height * factor)),
      labelWidth: Math.min(cellWidth, tile.ref.length * 8 + 4),
    };
  });
  const columnWidths = Array.from({ length: columns }, (_, column) =>
    Math.max(...sized.filter((_, index) => index % columns === column).map((item) => Math.max(item.width, item.labelWidth))));
  const rowHeights = Array.from({ length: rows }, (_, row) =>
    LABEL_HEIGHT + Math.max(...sized.slice(row * columns, (row + 1) * columns).map((item) => item.height)));
  const offset = (sizes: number[], index: number) =>
    GAP + sizes.slice(0, index).reduce((total, size) => total + size + GAP, 0);
  return {
    width: offset(columnWidths, columns),
    height: offset(rowHeights, rows),
    tiles: sized.map((item, index) => {
      const x = offset(columnWidths, index % columns);
      const y = offset(rowHeights, Math.floor(index / columns));
      return {
        ref: item.ref,
        sheet: { x, y: y + LABEL_HEIGHT, width: item.width, height: item.height },
        label: { x, y, width: columnWidths[index % columns], height: LABEL_HEIGHT },
      };
    }),
  };
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function renderContactSheet(plan: ContactSheetPlan, tiles: SemanticVisionTile[]): Promise<string> {
  const sheet = new OffscreenCanvas(plan.width, plan.height);
  const context = sheet.getContext("2d");
  if (!context) throw new Error("Failed to get canvas context");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, plan.width, plan.height);
  for (const [index, tile] of plan.tiles.entries()) {
    const bitmap = await createImageBitmap(new Blob([base64ToBytes(tiles[index].data)], { type: "image/png" }));
    try {
      context.drawImage(bitmap, tile.sheet.x, tile.sheet.y, tile.sheet.width, tile.sheet.height);
    } finally {
      bitmap.close();
    }
    context.strokeStyle = "#888888";
    context.lineWidth = 1;
    context.strokeRect(tile.sheet.x - 0.5, tile.sheet.y - 0.5, tile.sheet.width + 1, tile.sheet.height + 1);
    context.fillStyle = "#000000";
    context.font = LABEL_FONT;
    context.textBaseline = "top";
    context.fillText(tile.ref, tile.label.x + 2, tile.label.y + 2, tile.label.width - 4);
  }
  const blob = await sheet.convertToBlob({ type: "image/png" });
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

function validTiles(tiles: unknown, refs: string[]): tiles is SemanticVisionTile[] {
  const seen = new Set<string>();
  return Array.isArray(tiles) && tiles.every((tile) => {
    const valid = typeof tile?.ref === "string" && refs.includes(tile.ref) && !seen.has(tile.ref) &&
      typeof tile.data === "string" && tile.data.startsWith("iVBORw0KGgo") &&
      [tile.width, tile.height].every((side) => Number.isInteger(side) && side > 0);
    seen.add(tile?.ref);
    return valid;
  });
}

/**
 * The vision part of a semantic observation. `refs` are the read frame's unnamed, non-field controls; only the main
 * frame's are drawn, up to 16, by `renderTiles` (the content script). Every control without a tile counts as skipped.
 */
export async function buildSemanticVision(
  frameId: number,
  refs: string[],
  renderTiles: (refs: string[]) => Promise<unknown>,
): Promise<SemanticVision> {
  if (frameId !== 0 || refs.length === 0) return { image: null, tiles: [], skipped: refs.length };
  const requested = refs.slice(0, SEMANTIC_VISION_MAX_TILES);
  const tiles = await renderTiles(requested);
  if (!validTiles(tiles, requested)) throw new Error("the page returned invalid icon tiles");
  const skipped = refs.length - tiles.length;
  if (tiles.length === 0) return { image: null, tiles: [], skipped };
  const plan = planContactSheet(tiles);
  return {
    image: { mimeType: "image/png", data: await renderContactSheet(plan, tiles) },
    tiles: plan.tiles.map(({ ref, sheet }) => ({ ref, ...sheet })),
    skipped,
  };
}

/**
 * Fetches an icon image the page shows but the content script can't read (cross-origin without CORS). No cookies,
 * the HTTP cache when it has the bytes, at most 512 KiB and 2 s.
 */
export async function fetchSemanticVisionIcon(url: string): Promise<{ mimeType: string; data: string }> {
  const { protocol } = new URL(url);
  if (protocol !== "https:") throw new Error("icon URL must be https");
  const response = await fetch(url, {
    credentials: "omit",
    cache: "force-cache",
    redirect: "error",
    signal: AbortSignal.timeout(ICON_FETCH_TIMEOUT_MS),
  });
  if (!response.ok || !response.body) throw new Error(`icon fetch failed: HTTP ${response.status}`);
  const mimeType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!mimeType.startsWith("image/")) {
    await response.body.cancel();
    throw new Error("icon fetch returned no image");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > ICON_FETCH_MAX_BYTES) {
      await reader.cancel();
      throw new Error("icon image is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return { mimeType, data: bytesToBase64(bytes) };
}
