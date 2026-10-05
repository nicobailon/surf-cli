import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ContactSheetPlan,
  planContactSheet,
  renderContactSheet,
} from "../../../src/service-worker/semantic-vision";

type Rect = { x: number; y: number; width: number; height: number };

function icons(count: number, size = 24): Array<{ ref: string; rect: Rect }> {
  return Array.from({ length: count }, (_, index) => ({
    ref: `e${index + 1}`,
    rect: {
      x: 20 + (index % 10) * 40,
      y: 20 + Math.floor(index / 10) * 40,
      width: size,
      height: size,
    },
  }));
}

function unchanged(targets: Array<{ ref: string; rect: Rect }>): Record<string, Rect> {
  return Object.fromEntries(targets.map(({ ref, rect }) => [ref, rect]));
}

const viewport = { width: 1280, height: 800 };

function fields(before: Array<Rect | null>, after = before, changed = false) {
  return { before, after, changed };
}

const noFields = fields([]);

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe("contact sheet planner", () => {
  it("caps the sheet at 16 tiles in candidate order and counts the rest as skipped", () => {
    const targets = icons(20);
    const plan = planContactSheet({
      targets,
      current: unchanged(targets),
      masks: noFields,
      scale: 2,
      viewport,
    });

    expect(plan.tiles.map((tile) => tile.ref)).toEqual(targets.slice(0, 16).map(({ ref }) => ref));
    expect(plan.skipped).toBe(4);
  });

  it("crops each control tightly with padding in device pixels and keeps tiles apart on the sheet", () => {
    const targets = [
      { ref: "e7", rect: { x: 100, y: 50, width: 24, height: 24 } },
      { ref: "e9", rect: { x: 300, y: 50, width: 40, height: 20 } },
      { ref: "e12", rect: { x: 500, y: 50, width: 16, height: 16 } },
    ];
    const plan = planContactSheet({
      targets,
      current: unchanged(targets),
      masks: noFields,
      scale: 2,
      viewport,
    });

    expect(plan.tiles.map(({ ref, crop }) => ({ ref, crop }))).toEqual([
      { ref: "e7", crop: { x: 192, y: 92, width: 64, height: 64 } },
      { ref: "e9", crop: { x: 592, y: 92, width: 96, height: 56 } },
      { ref: "e12", crop: { x: 992, y: 92, width: 48, height: 48 } },
    ]);
    for (const tile of plan.tiles) {
      expect(tile.sheet).toMatchObject({ width: tile.crop.width, height: tile.crop.height });
      expect(tile.sheet.x + tile.sheet.width).toBeLessThanOrEqual(plan.width);
      expect(tile.sheet.y + tile.sheet.height).toBeLessThanOrEqual(plan.height);
      expect(overlaps(tile.label, tile.sheet)).toBe(false);
    }
    const areas = plan.tiles.flatMap((tile) => [tile.sheet, tile.label]);
    for (const [index, area] of areas.entries()) {
      for (const other of areas.slice(index + 1)) {
        expect(overlaps(area, other)).toBe(false);
      }
    }
    expect(plan.skipped).toBe(0);
  });

  it("keeps the long side within 1024 px by scaling large crops down", () => {
    const wide = [{ ref: "e1", rect: { x: 0, y: 0, width: 1280, height: 300 } }];
    const single = planContactSheet({
      targets: wide,
      current: unchanged(wide),
      masks: noFields,
      scale: 2,
      viewport,
    });
    expect(Math.max(single.width, single.height)).toBeLessThanOrEqual(1024);
    expect(single.tiles[0].crop.width).toBe(2560);
    expect(single.tiles[0].sheet.width).toBeLessThan(1024);

    const large = Array.from({ length: 16 }, (_, index) => ({
      ref: `e${index + 100}`,
      rect: { x: (index % 4) * 320, y: Math.floor(index / 4) * 200, width: 300, height: 180 },
    }));
    const grid = planContactSheet({
      targets: large,
      current: unchanged(large),
      masks: noFields,
      scale: 3,
      viewport,
    });
    expect(grid.tiles).toHaveLength(16);
    expect(grid.width).toBeLessThanOrEqual(1024);
    expect(grid.height).toBeLessThanOrEqual(1024);
  });

  it("drops controls that moved, disappeared, or were covered after the capture", () => {
    const targets = icons(5);
    const { e5: _gone, ...current }: Record<string, Rect | null> = unchanged(targets);
    current.e2 = { ...targets[1].rect, x: targets[1].rect.x + 2 };
    current.e3 = { ...targets[2].rect, y: targets[2].rect.y + 3 };
    current.e4 = null;

    const plan = planContactSheet({ targets, current, masks: noFields, scale: 1, viewport });

    expect(plan.tiles.map((tile) => tile.ref)).toEqual(["e1", "e2"]);
    expect(plan.skipped).toBe(3);
  });
  it("masks the union of field rects measured before and after the capture, in each crop's space", () => {
    const targets = [
      { ref: "e1", rect: { x: 100, y: 50, width: 24, height: 24 } },
      { ref: "e2", rect: { x: 600, y: 400, width: 24, height: 24 } },
    ];
    const plan = planContactSheet({
      targets,
      current: unchanged(targets),
      masks: fields(
        [{ x: 110, y: 40, width: 100, height: 20 }],
        [{ x: 111, y: 41, width: 100, height: 20 }],
      ),
      scale: 2,
      viewport,
    });

    expect(plan.tiles[0].masks).toEqual([
      { x: 28, y: 0, width: 36, height: 28 },
      { x: 30, y: 0, width: 34, height: 30 },
    ]);
    expect(plan.tiles[1].masks).toEqual([]);

    // A field measured only once (it moved or went away) is still masked where it was.
    const once = planContactSheet({
      targets,
      current: unchanged(targets),
      masks: fields([{ x: 110, y: 40, width: 100, height: 20 }], []),
      scale: 2,
      viewport,
    });
    expect(once.tiles[0].masks).toEqual([{ x: 28, y: 0, width: 36, height: 28 }]);
  });

  it.each([
    ["a field could not be measured", fields([{ x: 0, y: 0, width: 10, height: 10 }, null])],
    ["the capture may not have been field-free", fields([], [], true)],
  ])("skips every tile when %s", (_reason, masks) => {
    const targets = icons(3);
    const plan = planContactSheet({
      targets,
      current: unchanged(targets),
      masks,
      scale: 1,
      viewport,
    });

    expect(plan).toEqual({ width: 0, height: 0, tiles: [], skipped: 3 });
  });
});

describe("contact sheet renderer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("blacks out masks on each crop before the crop reaches the sheet and before encoding", async () => {
    const calls: string[] = [];
    let canvases = 0;
    class FakeOffscreenCanvas {
      name: string;
      constructor(
        public width: number,
        public height: number,
      ) {
        this.name = canvases++ === 0 ? "sheet" : "tile";
      }
      getContext() {
        const record =
          (method: string) =>
          (...args: unknown[]) => {
            const source = args[0] instanceof FakeOffscreenCanvas ? args[0].name : "capture";
            calls.push(
              method === "drawImage"
                ? `${this.name}.drawImage(${source})`
                : `${this.name}.${method}(${args.join(",")})`,
            );
          };
        return {
          drawImage: record("drawImage"),
          fillRect: record("fillRect"),
          strokeRect: vi.fn(),
          fillText: record("fillText"),
        };
      }
      async convertToBlob(options: { type: string }) {
        calls.push(`${this.name}.convertToBlob(${options.type})`);
        return new Blob(["png"], { type: options.type });
      }
    }
    vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
    const plan: ContactSheetPlan = {
      width: 100,
      height: 60,
      skipped: 0,
      tiles: [
        {
          ref: "e3",
          crop: { x: 10, y: 10, width: 40, height: 30 },
          masks: [{ x: 5, y: 0, width: 10, height: 30 }],
          sheet: { x: 8, y: 24, width: 40, height: 30 },
          label: { x: 8, y: 8, width: 40, height: 16 },
        },
      ],
    };

    const blob = await renderContactSheet({} as CanvasImageSource, plan);

    expect(blob.type).toBe("image/png");
    expect(calls).toEqual([
      "sheet.fillRect(0,0,100,60)",
      "tile.drawImage(capture)",
      "tile.fillRect(5,0,10,30)",
      "sheet.drawImage(tile)",
      "sheet.fillText(e3,10,10,36)",
      "sheet.convertToBlob(image/png)",
    ]);
  });
});
