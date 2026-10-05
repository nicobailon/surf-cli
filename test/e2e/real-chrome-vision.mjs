#!/usr/bin/env node
// Real-Chrome privacy checks for --vision contact sheets: field pixels must never reach the encoded sheet.
// Run `npm run build` first. No provider is called; sheets stay in memory.
import { launchVisionChrome } from "./vision-chrome.mjs";

const FIELD_STYLE =
  "position:absolute;left:100px;top:100px;width:60px;height:40px;margin:0;padding:0;border:0;box-sizing:border-box;background:#0f0;font:16px monospace;z-index:1";
// An unnamed icon button whose left part sits under a field; its center stays uncovered, so it is tiled.
const page = (field) => `<!doctype html><html><head><title>Vision privacy fixture</title></head>
<body style="margin:0">
<button id="target" style="position:absolute;left:100px;top:100px;width:140px;height:40px;margin:0;padding:0;border:0;background:#fff"><svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#00f"/></svg></button>
${field}
</body></html>`;
const pages = {
  "/closed-root": page(`<closed-field id="secret" style="${FIELD_STYLE};display:block"></closed-field>
<script>document.querySelector("#secret").attachShadow({ mode: "closed" }).innerHTML = '<input value="PRIVATE-1234" style="width:60px;height:40px;margin:0;padding:0;border:0;box-sizing:border-box;background:#0f0;font:16px monospace">';</script>`),
  "/removed-field": page(`<input id="secret" value="PRIVATE-1234" style="${FIELD_STYLE}">`),
};
const VISION_READ = { semanticObservation: true, semanticVision: true };

async function waitFor(predicate, label) {
  const deadline = Date.now() + 20_000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

const harness = await launchVisionChrome(process.cwd(), pages);
const results = {};
const leaks = [];
let failure;
try {
  const decoder = await harness.browser.newPage();
  const pixel = (data, x, y) =>
    decoder.evaluate(
      async (data, x, y) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        return Array.from(context.getImageData(x, y, 1, 1).data);
      },
      data,
      x,
      y,
    );

  // Samples the sheet where the field was drawn, inside the button's tile. Returns null when the tile was skipped.
  const sampleField = async (observation, geometry) => {
    const button = observation.candidates.find((candidate) => candidate.role === "button" && candidate.name === "");
    const tile = observation.vision.tiles.find((item) => item.ref === button.ref);
    if (!tile) return null;
    const { target, field, dpr } = geometry;
    const cropX = Math.floor((target.x - 4) * dpr);
    const cropY = Math.floor((target.y - 4) * dpr);
    const factor = tile.width / (Math.ceil((target.x + target.width + 4) * dpr) - cropX);
    const at = async (x, y) =>
      pixel(
        observation.vision.image.data,
        Math.floor(tile.x + (x * dpr - cropX) * factor),
        Math.floor(tile.y + (y * dpr - cropY) * factor),
      );
    return {
      field: await at(field.x + 3, field.y + 3),
      // Same tile, away from the field: proves the sampling lands on the crop.
      button: await at(target.x + target.width - 5, target.y + 5),
    };
  };
  const measure = (tab) =>
    tab.page.evaluate(() => {
      const box = (selector) => {
        const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
        return { x, y, width, height };
      };
      return { target: box("#target"), field: box("#secret"), dpr: devicePixelRatio };
    });
  const black = ([r, g, b]) => r <= 16 && g <= 16 && b <= 16;
  const white = ([r, g, b]) => r >= 240 && g >= 240 && b >= 240;

  // A field inside a closed shadow root is masked.
  const closed = await harness.openTab("/closed-root");
  const closedGeometry = await measure(closed);
  const closedSheet = await harness.readPage(closed.tabId, VISION_READ);
  const closedSample = await sampleField(closedSheet, closedGeometry);
  results.closedRoot = { vision: { tiles: closedSheet.vision.tiles.length, skipped: closedSheet.vision.skipped }, sample: closedSample };
  if (!closedSample || !white(closedSample.button) || !black(closedSample.field)) {
    leaks.push(`closed-root field reached the sheet unmasked: ${JSON.stringify(results.closedRoot)}`);
  }

  // A field removed after the capture but before the recheck is still masked, or the tile is skipped.
  const removed = await harness.openTab("/removed-field");
  const removedGeometry = await measure(removed);
  await harness.worker.evaluate(() => {
    const send = chrome.tabs.sendMessage.bind(chrome.tabs);
    globalThis.__recheckGate = { held: false, release: null };
    chrome.tabs.sendMessage = (...args) => {
      if (args[1]?.type !== "SEMANTIC_VISION_RECHECK") return send(...args);
      globalThis.__recheckGate.held = true;
      return new Promise((resolve) => {
        globalThis.__recheckGate.release = resolve;
      }).then(() => send(...args));
    };
  });
  const reading = harness.readPage(removed.tabId, VISION_READ);
  await waitFor(() => harness.worker.evaluate(() => globalThis.__recheckGate.held), "the capture");
  await removed.page.evaluate(() => document.querySelector("#secret").remove());
  await harness.worker.evaluate(() => globalThis.__recheckGate.release());
  const removedSheet = await reading;
  const removedSample = await sampleField(removedSheet, removedGeometry);
  results.removedField = { vision: { tiles: removedSheet.vision.tiles.length, skipped: removedSheet.vision.skipped }, sample: removedSample };
  if (removedSample && !black(removedSample.field)) {
    leaks.push(`field removed after the capture reached the sheet unmasked: ${JSON.stringify(results.removedField)}`);
  }
  console.log(JSON.stringify(results, null, 2));
  if (leaks.length) throw new Error(leaks.join("\n"));
} catch (error) {
  failure = error;
} finally {
  await harness.close();
}
if (failure) throw failure;
