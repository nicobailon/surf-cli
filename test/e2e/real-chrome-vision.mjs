#!/usr/bin/env node
// Real-Chrome privacy checks for --vision contact sheets: field pixels must never reach the encoded sheet.
// Run `npm run build` first. No provider is called; sheets stay in memory.
import { launchVisionChrome } from "./vision-chrome.mjs";

const FIELD_BOX =
  "position:absolute;left:100px;top:100px;width:60px;height:40px;margin:0;padding:0;border:0;box-sizing:border-box;background:#0f0;font:16px monospace;z-index:1";
const INPUT = (attributes = "", style = FIELD_BOX) => `<input id="secret" value="PRIVATE-1234" ${attributes} style="${style}">`;
// An unnamed icon button whose left part sits under a field; its center stays uncovered, so it is tiled.
const page = (field) => `<!doctype html><html><head><title>Vision privacy fixture</title><style>.off{display:none}</style></head>
<body style="margin:0">
<button id="target" style="position:absolute;left:100px;top:100px;width:140px;height:40px;margin:0;padding:0;border:0;background:#fff"><svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#00f"/></svg></button>
${field}
</body></html>`;
const CLOSED_INPUT =
  '<input value="PRIVATE-1234" style="width:60px;height:40px;margin:0;padding:0;border:0;box-sizing:border-box;background:#0f0;font:16px monospace">';
const pages = {
  "/clean": page(""),
  "/closed-root": page(`<closed-field id="secret" style="${FIELD_BOX};display:block"></closed-field>
<script>document.querySelector("#secret").attachShadow({ mode: "closed" }).innerHTML = '${CLOSED_INPUT}';</script>`),
  "/removed-field": page(INPUT()),
  "/display": page(INPUT("", `${FIELD_BOX};display:none`)),
  "/hidden": page(INPUT("hidden")),
  "/ancestor-class": page(`<div id="wrap" class="off">${INPUT()}</div>`),
  "/late-closed-root": page(`<closed-field id="secret" style="${FIELD_BOX};display:block"></closed-field>`),
  "/animated": page(
    `<style>@keyframes drift{from{transform:translateX(0)}to{transform:translateX(1px)}}</style><div style="animation:drift 1s infinite alternate">${INPUT()}</div>`,
  ),
};
const TARGET = { x: 100, y: 100, width: 140, height: 40 };
const FIELD = { x: 100, y: 100 };

// Page changes made after the content script's pre-capture measurement and after the screenshot.
const scenarios = [
  { name: "clean page keeps its tile", path: "/clean", clean: true },
  { name: "closed shadow root", path: "/closed-root", masked: true },
  // A running animation can move a field without any DOM mutation, so the read sends nothing.
  { name: "animated field container", path: "/animated", skipped: true },
  { name: "field removed after the screenshot", path: "/removed-field", after: () => document.querySelector("#secret").remove() },
  {
    name: "display:none field shown during the screenshot",
    path: "/display",
    before: () => { document.querySelector("#secret").style.display = "block"; },
    after: () => { document.querySelector("#secret").style.display = "none"; },
  },
  {
    name: "hidden field shown during the screenshot",
    path: "/hidden",
    before: () => { document.querySelector("#secret").hidden = false; },
    after: () => { document.querySelector("#secret").hidden = true; },
  },
  {
    name: "field revealed by an ancestor class during the screenshot",
    path: "/ancestor-class",
    before: () => document.querySelector("#wrap").classList.remove("off"),
    after: () => document.querySelector("#wrap").classList.add("off"),
  },
  {
    name: "shadow root attached during the window, field removed before the recheck",
    path: "/late-closed-root",
    before: (closedInput) => {
      window.secretRoot = document.querySelector("#secret").attachShadow({ mode: "closed" });
      window.secretRoot.innerHTML = closedInput;
    },
    after: () => window.secretRoot.querySelector("input").remove(),
  },
];

async function waitFor(predicate, label) {
  const deadline = Date.now() + 20_000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

const harness = await launchVisionChrome(process.cwd(), pages);
const results = {};
const failures = [];
let failure;
try {
  // Test-only gates in the extension's service worker: hold the read right after the content script's
  // pre-capture measurement, and again after the screenshot, before the recheck.
  await harness.worker.evaluate(() => {
    const send = chrome.tabs.sendMessage.bind(chrome.tabs);
    const gate = (name) =>
      new Promise((resolve) => {
        globalThis.__gates[name] = resolve;
      });
    globalThis.__gates = {};
    chrome.tabs.sendMessage = async (...args) => {
      const message = args[1];
      if (message?.type === "GENERATE_ACCESSIBILITY_TREE" && message.options?.semanticVision) {
        const result = await send(...args);
        await gate("pre");
        return result;
      }
      if (message?.type === "SEMANTIC_VISION_RECHECK") await gate("post");
      return send(...args);
    };
  });
  const atGate = (name) => harness.worker.evaluate((name) => typeof globalThis.__gates[name] === "function", name);
  const release = (name) =>
    harness.worker.evaluate((name) => {
      const resolve = globalThis.__gates[name];
      delete globalThis.__gates[name];
      resolve();
    }, name);

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
  // Samples the sheet inside the button's tile: where the field was drawn, and on the button away from it.
  const sample = async (observation, dpr) => {
    const button = observation.candidates.find((candidate) => candidate.role === "button" && candidate.name === "");
    const tile = observation.vision.tiles.find((item) => item.ref === button.ref);
    if (!tile) return null;
    const cropX = Math.floor((TARGET.x - 4) * dpr);
    const cropY = Math.floor((TARGET.y - 4) * dpr);
    const factor = tile.width / (Math.ceil((TARGET.x + TARGET.width + 4) * dpr) - cropX);
    const at = (x, y) =>
      pixel(
        observation.vision.image.data,
        Math.floor(tile.x + (x * dpr - cropX) * factor),
        Math.floor(tile.y + (y * dpr - cropY) * factor),
      );
    return { field: await at(FIELD.x + 3, FIELD.y + 3), button: await at(TARGET.x + TARGET.width - 5, TARGET.y + 5) };
  };
  const black = ([r, g, b]) => r <= 16 && g <= 16 && b <= 16;
  const white = ([r, g, b]) => r >= 240 && g >= 240 && b >= 240;
  const frames = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));

  for (const scenario of scenarios) {
    const tab = await harness.openTab(scenario.path);
    const dpr = await tab.page.evaluate(() => devicePixelRatio);
    const reading = harness.readPage(tab.tabId, { semanticObservation: true, semanticVision: true });
    await waitFor(() => atGate("pre"), `${scenario.name}: pre-capture measurement`);
    if (scenario.before) {
      await tab.page.evaluate(scenario.before, CLOSED_INPUT);
      await tab.page.evaluate(frames);
    }
    await release("pre");
    await waitFor(() => atGate("post"), `${scenario.name}: screenshot`);
    if (scenario.after) await tab.page.evaluate(scenario.after);
    await release("post");
    const observation = await reading;
    const pixels = await sample(observation, dpr);
    results[scenario.name] = { tiles: observation.vision.tiles.length, skipped: observation.vision.skipped, pixels };
    if (scenario.clean && !(pixels && white(pixels.field) && white(pixels.button))) {
      failures.push(`${scenario.name}: the clean page did not send its tile`);
    }
    if (scenario.skipped && pixels) failures.push(`${scenario.name}: expected every tile to be skipped`);
    if (scenario.masked && !(pixels && black(pixels.field) && white(pixels.button))) {
      failures.push(`${scenario.name}: expected a tile with the field blacked out`);
    }
    if (!scenario.clean && pixels && !black(pixels.field)) {
      failures.push(`${scenario.name}: field pixels reached the sheet`);
    }
  }
  console.log(JSON.stringify(results, null, 2));
  if (failures.length) throw new Error(failures.join("\n"));
} catch (error) {
  failure = error;
} finally {
  await harness.close();
}
if (failure) throw failure;
