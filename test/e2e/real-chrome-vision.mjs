#!/usr/bin/env node
// --vision in real Chrome: tiles are drawn from each control's own icon, never from page pixels.
// Run `npm run build` first. Sheets and page screenshots are kept under $TMPDIR/surf-vision-e2e for a visual check.
import assert from "node:assert/strict";
import { createPrivateKey } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { launchVisionChrome } from "./vision-chrome.mjs";

const repo = process.cwd();
const artifacts = join(tmpdir(), "surf-vision-e2e");
mkdirSync(artifacts, { recursive: true });

// --- Assets: PNGs and a one-glyph-per-codepoint TrueType icon font, generated here.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (bytes) => ~bytes.reduce((c, byte) => crcTable[(c ^ byte) & 255] ^ (c >>> 8), ~0) >>> 0;
const pngChunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc(body), body.length + 4);
  return out;
};
function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * (width * 4 + 1) + 1 + x * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}
const PLUS = png(40, 40, (x, y) => {
  const [dx, dy] = [x - 19.5, y - 19.5];
  if (dx * dx + dy * dy > 18 * 18) return [0, 0, 0, 0];
  return (Math.abs(dx) < 3 && Math.abs(dy) < 12) || (Math.abs(dy) < 3 && Math.abs(dx) < 12) ? [255, 255, 255, 255] : [240, 120, 0, 255];
});
const DIAMOND = png(40, 40, (x, y) => (Math.abs(x - 19.5) + Math.abs(y - 19.5) < 18 ? [0, 0, 0, 255] : [0, 0, 0, 0]));
const SPRITE = png(80, 40, (x, y) => (x < 40 ? [0, 0, 255, 255] : Math.abs(x - 59.5) < 8 && Math.abs(y - 19.5) < 8 ? [0, 0, 0, 0] : [0, 160, 0, 255]));
const HEART = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#d81b60" d="M12 21 3 12a5 5 0 0 1 9-6 5 5 0 0 1 9 6z"/></svg>';

function pack(fields) {
  const sizes = { u8: 1, u16: 2, i16: 2, u32: 4 };
  const out = Buffer.alloc(fields.reduce((total, [type]) => total + sizes[type], 0));
  let at = 0;
  for (const [type, value] of fields) {
    if (type === "u8") out.writeUInt8(value, at);
    if (type === "u16") out.writeUInt16BE(value & 0xffff, at);
    if (type === "i16") out.writeInt16BE(value, at);
    if (type === "u32") out.writeUInt32BE(value >>> 0, at);
    at += sizes[type];
  }
  return out;
}
const polygon = (points, cx, cy, radii) =>
  Array.from({ length: points }, (_, i) => {
    const angle = Math.PI / 2 - (i * Math.PI * 2) / points;
    const r = radii[i % radii.length];
    return [Math.round(cx + r * Math.cos(angle)), Math.round(cy + r * Math.sin(angle))];
  });
/** `glyphs` is [[codepoint, contours]] in ascending codepoint order; contours are [x, y] lists in 1000 units/em. */
function iconFont(glyphs) {
  const outlines = [[], ...glyphs.map(([, contours]) => contours)];
  const glyf = [];
  const loca = [0];
  for (const contours of outlines) {
    const points = contours.flat();
    if (points.length) {
      const xs = points.map(([x]) => x);
      const ys = points.map(([, y]) => y);
      const deltas = (axis) => points.map((point, i) => ["i16", point[axis] - (i ? points[i - 1][axis] : 0)]);
      let end = -1;
      let data = Buffer.concat([
        pack([["i16", contours.length], ["i16", Math.min(...xs)], ["i16", Math.min(...ys)], ["i16", Math.max(...xs)], ["i16", Math.max(...ys)]]),
        pack(contours.map((contour) => ["u16", (end += contour.length)])),
        pack([["u16", 0], ...points.map(() => ["u8", 1]), ...deltas(0), ...deltas(1)]),
      ]);
      data = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
      glyf.push(data);
    }
    loca.push(loca.at(-1) + (points.length ? glyf.at(-1).length : 0));
  }
  const count = outlines.length;
  const segments = [...glyphs.map(([code], i) => [code, (i + 1 - code) & 0xffff]), [0xffff, 1]];
  const log = Math.floor(Math.log2(segments.length));
  const cmapBody = [
    ["u16", segments.length * 2], ["u16", 2 ** (log + 1)], ["u16", log], ["u16", segments.length * 2 - 2 ** (log + 1)],
    ...segments.map(([code]) => ["u16", code]), ["u16", 0], ...segments.map(([code]) => ["u16", code]),
    ...segments.map(([, delta]) => ["u16", delta]), ...segments.map(() => ["u16", 0]),
  ];
  const subtable = pack([["u16", 4], ["u16", 6 + cmapBody.length * 2], ["u16", 0], ...cmapBody]);
  const names = ["", "SurfTestIcons", "Regular", "SurfTestIcons", "SurfTestIcons", "Version 1.0", "SurfTestIcons-Regular"];
  const strings = names.slice(1).map((text) => Buffer.from(text, "utf16le").swap16());
  let stringAt = 0;
  const nameTable = Buffer.concat([
    pack([["u16", 0], ["u16", strings.length], ["u16", 6 + strings.length * 12]]),
    pack(strings.flatMap((text, i) => {
      const record = [["u16", 3], ["u16", 1], ["u16", 0x409], ["u16", i + 1], ["u16", text.length], ["u16", stringAt]];
      stringAt += text.length;
      return record;
    })),
    ...strings,
  ]);
  const maxPoints = Math.max(...outlines.map((contours) => contours.flat().length));
  const tables = {
    "OS/2": pack([
      ["u16", 4], ["i16", 1000], ["u16", 400], ["u16", 5], ["u16", 0], ...Array(10).fill(["i16", 0]), ["i16", 0],
      ...Array(10).fill(["u8", 0]), ["u32", 1], ["u32", 0], ["u32", 1 << 28], ["u32", 0], ["u32", 0x53555246], ["u16", 0x40],
      ["u16", glyphs[0][0]], ["u16", glyphs.at(-1)[0]], ["i16", 800], ["i16", -200], ["i16", 0], ["u16", 800], ["u16", 200],
      ["u32", 1], ["u32", 0], ["i16", 500], ["i16", 700], ["u16", 0], ["u16", 32], ["u16", 1],
    ]),
    cmap: Buffer.concat([pack([["u16", 0], ["u16", 1], ["u16", 3], ["u16", 1], ["u32", 12]]), subtable]),
    glyf: Buffer.concat(glyf),
    head: pack([
      ["u32", 0x10000], ["u32", 0x10000], ["u32", 0], ["u32", 0x5f0f3cf5], ["u16", 0x000b], ["u16", 1000],
      ["u32", 0], ["u32", 0], ["u32", 0], ["u32", 0], ["i16", 0], ["i16", -200], ["i16", 1000], ["i16", 800],
      ["u16", 0], ["u16", 8], ["i16", 2], ["i16", 1], ["i16", 0],
    ]),
    hhea: pack([
      ["u32", 0x10000], ["i16", 800], ["i16", -200], ["i16", 0], ["u16", 1000], ["i16", 0], ["i16", 0], ["i16", 1000],
      ["i16", 1], ["i16", 0], ["i16", 0], ["i16", 0], ["i16", 0], ["i16", 0], ["i16", 0], ["i16", 0], ["u16", count],
    ]),
    hmtx: pack(outlines.flatMap((contours) => [["u16", 1000], ["i16", contours.length ? Math.min(...contours.flat().map(([x]) => x)) : 0]])),
    loca: pack(loca.map((offset) => ["u32", offset])),
    maxp: pack([
      ["u32", 0x10000], ["u16", count], ["u16", maxPoints], ["u16", Math.max(...outlines.map((c) => c.length))],
      ["u16", 0], ["u16", 0], ["u16", 2], ...Array(8).fill(["u16", 0]),
    ]),
    name: nameTable,
    post: pack([["u32", 0x30000], ["u32", 0], ["i16", -100], ["i16", 50], ["u32", 0], ["u32", 0], ["u32", 0], ["u32", 0], ["u32", 0]]),
  };
  const tags = Object.keys(tables).sort();
  const padded = tags.map((tag) => Buffer.concat([tables[tag], Buffer.alloc((4 - (tables[tag].length % 4)) % 4)]));
  const checksum = (data) => Array.from({ length: data.length / 4 }, (_, i) => data.readUInt32BE(i * 4)).reduce((sum, word) => (sum + word) >>> 0, 0);
  let offset = 12 + tags.length * 16;
  const directory = tags.map((tag, i) => {
    const record = pack([["u32", Buffer.from(tag).readUInt32BE(0)], ["u32", checksum(padded[i])], ["u32", offset], ["u32", tables[tag].length]]);
    offset += padded[i].length;
    return record;
  });
  const log2 = Math.floor(Math.log2(tags.length));
  return Buffer.concat([pack([["u32", 0x10000], ["u16", tags.length], ["u16", 16 * 2 ** log2], ["u16", log2], ["u16", tags.length * 16 - 16 * 2 ** log2]]), ...directory, ...padded]);
}
const FONT = iconFont([
  [0x41, [polygon(10, 500, 300, [480, 200])]], // "A": a star
  [0xe001, [[[100, -150], [900, -150], [900, 50], [600, 50], [600, 750], [400, 750], [400, 50], [100, 50]]]], // an upside-down T
  [0xe002, [polygon(3, 500, 300, [480])]], // a triangle
]);

// --- A second origin (https://localhost vs http://127.0.0.1) with no CORS headers, except /cors/*. HTTPS because the
// extension's CSP only lets the service worker fetch https: icons; the test certificate is from test/fixtures/tls.
const crossAssets = {
  "/plus.png": ["image/png", PLUS],
  "/heart.svg": ["image/svg+xml", HEART],
  "/sprite.png": ["image/png", SPRITE],
  "/mask.png": ["image/png", DIAMOND],
  "/cors/mask.png": ["image/png", DIAMOND],
  "/picker": ["text/html", '<!doctype html><input id="d" type="date" style="width:180px"><button id="go" onclick="d.showPicker()">open</button>'],
};
let crossRequests = 0;
const tls = join(repo, "test/fixtures/tls");
const key = createPrivateKey({
  key: readFileSync(join(tls, "localhost-key.enc.der")),
  format: "der",
  type: "pkcs8",
  passphrase: "surf-test-fixture",
}).export({ format: "pem", type: "pkcs8" });
const cross = createServer({ key, cert: readFileSync(join(tls, "localhost-cert.pem")) }, (request, response) => {
  crossRequests++;
  const path = new URL(request.url, "https://localhost").pathname;
  const asset = crossAssets[path];
  response.writeHead(asset ? 200 : 404, {
    "content-type": asset?.[0] ?? "text/plain",
    ...(path.startsWith("/cors/") ? { "access-control-allow-origin": "*" } : {}),
  });
  response.end(asset?.[1] ?? "");
});
await new Promise((done) => cross.listen(0, "127.0.0.1", done));
const B = `https://localhost:${cross.address().port}`;

const STYLE = `<style>
@font-face{font-family:"SurfTestIcons";src:url(/icons.ttf) format("truetype")}
@font-face{font-family:"MissingIcons";src:url(/missing.ttf) format("truetype")}
body{font:14px sans-serif;margin:20px}
button,[role=button]{width:56px;height:56px;margin:6px;padding:0;display:inline-flex;align-items:center;justify-content:center;background:#eee;border:1px solid #999;color:#1565c0;vertical-align:top;box-sizing:border-box}
.ti{font-family:"SurfTestIcons";font-size:36px;font-style:normal;line-height:1;color:#c62828}
.ti-before::before{content:"\\e001"} .ti-after::after{content:"\\e002";color:#6a1b9a}
.css-fill path{fill:#ff6f00}
.box{display:block;width:40px;height:40px}
.bg{background:no-repeat center/contain}
.mask{background-color:#e91e63;mask:url(/mask.png) center/contain no-repeat}
.mask-cors{color:#2e7d32;background-color:currentColor;mask:url(${B}/cors/mask.png) center/contain no-repeat}
.mask-cross{background-color:#e91e63;mask:url(${B}/mask.png) center/contain no-repeat}
.missing{font-family:"MissingIcons";font-size:30px}
.content-url::before{content:url(/plus.png)}
</style>
<svg style="display:none"><symbol id="i-star" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2l3 7h7l-5.5 4.5 2 7.5-6.5-4.5-6.5 4.5 2-7.5L2 9h7z"/></symbol></svg>`;
const heartData = `data:image/svg+xml,${encodeURIComponent(HEART)}`;
const SEARCH = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>';
const SUPPORTED = {
  "svg": `<button>${SEARCH}</button>`,
  "svg-stylesheet-fill": '<button style="color:#000"><svg class="css-fill" width="40" height="40" viewBox="0 0 24 24"><path d="M3 12h18M12 3v18" stroke="#000" stroke-width="3"/><path d="M6 6h5v5H6z"/></svg></button>',
  "svg-use": '<button style="color:#2e7d32"><svg width="40" height="40"><use href="#i-star"/></svg></button>',
  "img-same-origin": '<button><img src="/plus.png" width="40" height="40" alt=""></button>',
  "img-cross-origin": `<button><img src="${B}/plus.png" width="40" height="40" alt=""></button>`,
  "img-svg-cross-origin": `<button><img src="${B}/heart.svg" width="40" height="40" alt=""></button>`,
  "img-data": `<button><img src="${heartData}" width="40" height="40" alt=""></button>`,
  "picture": `<button><picture><source srcset="${B}/heart.svg" type="image/svg+xml"><img src="/plus.png" width="40" height="40" alt=""></picture></button>`,
  "input-image": `<input type="image" src="${B}/plus.png" width="40" height="40" alt="">`,
  "background-same-origin": '<button><span class="box bg" style="background-image:url(/plus.png)"></span></button>',
  "background-cross-origin": `<button><span class="box bg" style="background-image:url(${B}/heart.svg)"></span></button>`,
  "background-sprite": `<button><span class="box" style="background:url(${B}/sprite.png) -40px 0 no-repeat"></span></button>`,
  "mask-same-origin": '<button><span class="box mask"></span></button>',
  "mask-cors": '<button><span class="box mask-cors"></span></button>',
  // A <button>'s text is its name; a ligature icon is unnamed in a role=button element.
  "font-text": '<div role="button" tabindex="0"><span class="ti">A</span></div>',
  "font-before": '<button><i class="ti ti-before"></i></button>',
  "font-after": '<button><i class="ti ti-after"></i></button>',
};
const UNSUPPORTED = {
  "gradient": '<button style="background:linear-gradient(#f00,#00f)"></button>',
  "external-use": '<button><svg width="40" height="40"><use href="/sprite.svg#star"/></svg></button>',
  "canvas": '<button><canvas width="40" height="40"></canvas></button>',
  "content-url": '<button><i class="content-url"></i></button>',
  "font-load-failed": '<div role="button" tabindex="0"><span class="missing">A</span></div>',
  "plain-text-glyph": '<div role="button" tabindex="0"><span style="font-size:30px">×</span></div>',
  "mask-cross-origin-no-cors": '<button><span class="box mask-cross"></span></button>',
};

// T1: the same icon buttons on a blank page and under fields, pickers, a validation bubble, frames and a popover.
const T1_BUTTONS = ["svg", "svg-use", "img-cross-origin", "background-cross-origin", "font-text", "font-before"]
  .map((kind) => SUPPORTED[kind]).join("");
const pages = {
  "/icons.ttf": { type: "font/ttf", body: FONT },
  "/plus.png": { type: "image/png", body: PLUS },
  "/mask.png": { type: "image/png", body: DIAMOND },
  "/t1-blank": `<!doctype html>${STYLE}<div style="position:relative">${T1_BUTTONS}</div>`,
  "/t1": `<!doctype html>${STYLE}<style>.over{position:absolute;left:0;top:0;opacity:.85}</style>
<div style="position:relative">${T1_BUTTONS}
<input id="typed" class="over" style="width:380px;height:40px;font-size:20px">
<form class="over" style="top:30px"><input id="required" required style="width:200px"></form>
<input id="date" type="date" class="over" style="top:10px;left:40px">
<iframe class="over" style="left:120px;width:260px;height:300px" src="${B}/picker"></iframe>
<iframe id="sandboxed" class="over" style="left:200px;width:200px;height:200px" sandbox="allow-scripts"
  srcdoc="<input type=date id=d><script>onclick=()=>d.showPicker()</script>"></iframe>
<div id="popover" popover style="position:fixed;inset:20px auto auto 20px;width:300px;height:120px;background:#ff0;margin:0">POPOVER over the buttons</div>
</div>
<button id="open-date" style="position:absolute;left:600px;top:400px;width:auto" onclick="date.showPicker()">Open date</button>`,
};
for (const [kind, html] of Object.entries({ ...SUPPORTED, ...UNSUPPORTED })) pages[`/kind/${kind}`] = `<!doctype html>${STYLE}${html}`;
const supportedKinds = Object.keys(SUPPORTED);
pages["/sheet-1"] = `<!doctype html>${STYLE}${supportedKinds.slice(0, 16).map((kind) => SUPPORTED[kind]).join("")}`;
pages["/sheet-2"] = `<!doctype html>${STYLE}${[...supportedKinds.slice(16).map((kind) => SUPPORTED[kind]), ...Object.values(UNSUPPORTED)].join("")}`;

const VISION = { semanticObservation: true, semanticVision: true };
let harness;
let failure;
try {
  harness = await launchVisionChrome(repo, pages, { args: ["--ignore-certificate-errors"] });
  const decoder = await harness.browser.newPage();
  // Pixels of each tile on the sheet, as base64 RGBA, plus how many are not white.
  const tilePixels = (vision) => decoder.evaluate(async (data, tiles) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = Object.assign(document.createElement("canvas"), { width: image.width, height: image.height });
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    return tiles.map(({ x, y, width, height }) => {
      const rgba = context.getImageData(x, y, width, height).data;
      let ink = 0;
      for (let i = 0; i < rgba.length; i += 4) if (rgba[i] < 245 || rgba[i + 1] < 245 || rgba[i + 2] < 245) ink++;
      let binary = "";
      for (let i = 0; i < rgba.length; i++) binary += String.fromCharCode(rgba[i]);
      return { pixels: btoa(binary), ink };
    });
  }, vision.image.data, vision.tiles);
  const save = (name, vision) => writeFileSync(join(artifacts, `${name}.png`), Buffer.from(vision.image.data, "base64"));

  const { tabId, page } = await harness.openTab("/kind/svg");
  const visit = async (path) => {
    await page.goto(`${harness.baseUrl}${path}`, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
  };

  // Without --vision nothing is drawn or fetched and the observation has no vision.
  await visit("/kind/img-cross-origin");
  const before = crossRequests;
  const plain = await harness.readPage(tabId, { semanticObservation: true });
  assert.equal(crossRequests, before, "a read without --vision fetched an icon");
  assert.equal("vision" in plain, false);
  const withVision = await harness.readPage(tabId, VISION);
  const { vision: _drawn, ...observationOnly } = withVision;
  assert.deepEqual(observationOnly, plain);
  console.log("ok: without --vision nothing is drawn and the observation is unchanged");

  // T2: every supported kind draws a non-empty tile; unsupported kinds are counted in skipped.
  for (const kind of supportedKinds) {
    await visit(`/kind/${kind}`);
    const { vision } = await harness.readPage(tabId, VISION);
    assert.equal(vision.tiles.length, 1, `${kind}: ${JSON.stringify({ ...vision, image: vision.image && "…" })}`);
    assert.equal(vision.skipped, 0, kind);
    const [{ ink }] = await tilePixels(vision);
    assert.ok(ink > 20, `${kind}: tile is blank (${ink} inked pixels)`);
    console.log(`ok: ${kind} tile (${ink} inked pixels)`);
  }
  for (const kind of Object.keys(UNSUPPORTED)) {
    await visit(`/kind/${kind}`);
    const { vision } = await harness.readPage(tabId, VISION);
    assert.deepEqual(vision, { image: null, tiles: [], skipped: 1 }, kind);
    console.log(`ok: ${kind} skipped`);
  }
  for (const name of ["sheet-1", "sheet-2"]) {
    await visit(`/${name}`);
    await page.screenshot({ path: join(artifacts, `${name}-page.png`) });
    const { vision } = await harness.readPage(tabId, VISION);
    save(name, vision);
  }

  // T1: the tiles under overlays are byte-identical to the blank page's.
  await visit("/t1-blank");
  const blank = (await harness.readPage(tabId, VISION)).vision;
  save("t1-blank", blank);
  await visit("/t1");
  await page.type("#typed", "secret typed text 1234");
  await page.click("#open-date");
  await page.frames().find((frame) => frame.url().endsWith("/picker"))?.click("#go");
  await page.evaluate(() => {
    document.getElementById("required").reportValidity();
    document.getElementById("popover").showPopover();
  });
  await page.mouse.move(0, 0);
  await new Promise((done) => setTimeout(done, 300));
  await page.screenshot({ path: join(artifacts, "t1-page.png") });
  const covered = (await harness.readPage(tabId, VISION)).vision;
  save("t1-covered", covered);
  assert.equal(blank.tiles.length, 6);
  assert.equal(covered.tiles.length, blank.tiles.length);
  const [blankTiles, coveredTiles] = [await tilePixels(blank), await tilePixels(covered)];
  for (const [index, tile] of blank.tiles.entries()) {
    assert.deepEqual([covered.tiles[index].width, covered.tiles[index].height], [tile.width, tile.height]);
    assert.ok(coveredTiles[index].pixels === blankTiles[index].pixels, `T1 tile ${index + 1} differs from the blank page`);
  }
  console.log("ok: T1 tiles under overlays are byte-identical to the blank page");
  console.log(`artifacts: ${artifacts}`);
} catch (error) {
  failure = error;
} finally {
  await harness?.close();
  await new Promise((done) => cross.close(done));
}
if (failure) {
  console.error(failure);
  process.exitCode = 1;
}
