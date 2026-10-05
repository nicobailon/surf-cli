#!/usr/bin/env node
// Real-Chrome privacy checks for --vision contact sheets: field content must never reach the encoded sheet.
// Each populated read is compared with an empty-field control read of the same fixture: any tinted pixel
// (G - max(R, B) >= 2) in the populated tile that the control does not have fails. Fields are restored after
// every read. Run `npm run build` first. No provider is called; sheets stay in memory.
import { launchVisionChrome } from "./vision-chrome.mjs";

const BUTTON = (css = "background:#fff") =>
  `<button id="target" style="position:absolute;left:100px;top:100px;width:140px;height:40px;margin:0;padding:0;border:0;${css}"><svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#00f"/></svg></button>`;
const page = (body, buttonCss) =>
  `<!doctype html><html><head><title>Vision privacy fixture</title><style>.off{display:none}</style></head><body style="margin:0;background:#fff">${BUTTON(buttonCss)}${body}</body></html>`;
const BOX = "position:absolute;left:100px;top:100px;width:60px;height:40px;margin:0;padding:0;border:0;box-sizing:border-box;z-index:1";
const INPUT = (attributes = "", style = `${BOX};background:#0f0;font:16px monospace`) =>
  `<input id="secret" value="PRIVATE-1234" ${attributes} style="${style}">`;
const EDITOR = (css) => `<div id="secret" contenteditable="true" style="position:absolute;color:#0f0;white-space:nowrap;z-index:1;${css}"></div>`;
const CLOSED_INPUT = `<input value="PRIVATE-1234" style="width:60px;height:40px;margin:0;padding:0;border:0;box-sizing:border-box;background:#0f0;font:16px monospace">`;

const type = (text, { blur = true } = {}) => async (tab) => {
  await tab.focus("#secret");
  await tab.keyboard.type(text);
  if (blur) await tab.evaluate(() => document.activeElement.blur());
};
const clearSecret = (tab) =>
  tab.evaluate(() => {
    const secret = document.querySelector("#secret");
    if ("value" in secret) secret.value = "";
    else secret.textContent = "";
  });

const scenarios = [
  { name: "clean page keeps its tile", html: page(""), expect: "tile" },
  {
    name: "closed shadow root",
    html: page(`<closed-field id="host" style="${BOX};display:block"></closed-field>
<script>window.__closedRoot = document.querySelector("#host").attachShadow({ mode: "closed" }); window.__closedRoot.innerHTML = '${CLOSED_INPUT}';</script>`),
    expect: "tile",
    masked: true,
    clear: (tab) => tab.evaluate(() => { window.__closedRoot.querySelector("input").value = ""; }),
  },
  {
    name: "multi-line editor typed past its height",
    html: page(EDITOR("left:100px;top:60px;width:60px;height:40px;white-space:normal;font:16px/20px monospace")),
    populate: async (tab) => {
      await tab.focus("#secret");
      await tab.keyboard.type("note");
      await tab.keyboard.press("Enter");
      await tab.keyboard.type("note");
      await tab.keyboard.press("Enter");
      await tab.keyboard.type("PRIVATE-1234");
      await tab.evaluate(() => document.activeElement.blur());
    },
    expect: "tile",
  },
  {
    name: "single-line editor typed past its width",
    html: page(EDITOR("left:20px;top:100px;width:60px;height:40px;font:16px/20px monospace")),
    populate: type("PRIVATE-1234"),
    expect: "tile",
  },
  {
    name: "text shadow cast onto the button",
    html: page(EDITOR("left:100px;top:20px;width:120px;height:20px;text-shadow:0 85px 0 #0f0;font:16px/20px monospace")),
    populate: type("PRIVATE"),
    expect: "tile",
  },
  {
    name: "::first-line text shadow",
    html: page(`<style>#secret::first-line{text-shadow:0 8px 6px #0f0}</style>${EDITOR("left:100px;top:80px;width:120px;height:20px;font:16px/20px monospace")}`),
    populate: type("PRIVATE-1234"),
    expect: "tile",
  },
  {
    name: "::first-letter text shadow",
    html: page(`<style>#secret::first-letter{text-shadow:0 12px 6px #0f0}</style>${EDITOR("left:100px;top:80px;width:120px;height:20px;font:16px/20px monospace")}`),
    populate: type("PRIVATE-1234"),
    expect: "tile",
  },
  {
    name: "scale(4) italic glyphs",
    html: page(EDITOR("left:0px;top:85px;width:40px;height:20px;font:italic 16px/20px Times;transform:scale(4);transform-origin:top left")),
    populate: type("fffffffff"),
    expect: "tile",
  },
  {
    name: "zoom:4 italic glyphs",
    html: page(EDITOR("left:0px;top:21.25px;width:40px;height:20px;font:italic 16px/20px Times;zoom:4")),
    populate: type("fffffffff"),
    expect: "tile",
  },
  {
    name: "100px italic glyph",
    html: page(EDITOR("left:100px;top:90px;font:italic 100px/100px Times")),
    populate: type("f"),
    expect: "tile",
  },
  ...[8, 16].map((blur) => ({
    name: `backdrop-filter blur(${blur}px) over a typed input`,
    html: page(
      `<input id="secret" style="${BOX};z-index:0;background:#fff;color:#0f0;font:16px/20px monospace">`,
      `background:rgba(255,255,255,.1);backdrop-filter:blur(${blur}px);z-index:2`,
    ),
    populate: type("PRIVATE-1234"),
    expect: "tile",
  })),
  {
    name: "emoji value",
    html: page(`<input id="secret" style="${BOX};background:#fff;font:28px sans-serif">`),
    populate: type("😀🍉🚗"),
    expect: "tile",
    anyDifference: true,
  },
  {
    name: "popover inside an editing host",
    html: page(`<div id="host" contenteditable="true" style="position:absolute;left:400px;top:300px;width:60px;height:20px">x<div id="pop" popover="manual" style="position:fixed;inset:auto;left:100px;top:100px;margin:0;padding:0;border:0;width:60px;height:40px;background:#0f0">PRIVATE</div></div>`),
    populate: (tab) => tab.evaluate(() => document.querySelector("#pop").showPopover()),
    clear: (tab) => tab.evaluate(() => document.querySelector("#pop").hidePopover()),
    expect: "tile",
  },
  {
    name: "focused input keeps its focus",
    html: page(`<input id="secret" style="${BOX};background:#fff;color:#0f0;caret-color:transparent;font:16px monospace">`),
    populate: type("PRIVATE-1234", { blur: false }),
    expect: "tile",
    focused: true,
  },
  {
    name: "running opacity transition on a field",
    html: page(INPUT("", `${BOX};background:#0f0;font:16px monospace;opacity:0.2;transition:opacity 5s linear`)),
    populate: (tab) => tab.evaluate(() => { document.querySelector("#secret").style.opacity = "1"; }),
    expect: "either",
    restore: false,
  },
  {
    name: "animated field container",
    html: page(`<style>@keyframes drift{from{transform:translateX(0)}to{transform:translateX(1px)}}</style><div style="animation:drift 1s infinite alternate">${INPUT()}</div>`),
    expect: "tile",
    restore: false,
  },
  {
    name: "shadow popover showing an editing host's text through a slot",
    html: page(`<div id="secret" contenteditable="true" style="position:absolute;left:400px;top:300px;width:60px;height:20px;color:#0f0;font:16px/20px monospace"></div>
<script>const root = document.querySelector("#secret").attachShadow({ mode: "open" });
root.innerHTML = '<div id="pop" popover="manual" style="position:fixed;inset:auto;left:100px;top:100px;margin:0;padding:0;border:0;width:60px;height:40px;color:#0f0;background:white;font:16px/20px monospace"><slot></slot></div>';
root.querySelector("#pop").showPopover();</script>`),
    populate: type("PRIVATE-1234"),
    expect: "tile",
  },
  {
    // Documented limit: a custom element whose only field signal is an ElementInternals role or form association,
    // with no native field or editable region inside, is not detected. Recorded, not asserted.
    name: "ElementInternals combobox (documented limit)",
    html: page(`<form><private-select id="secret" name="choice" tabindex="0" style="${BOX};color:#0f0;font:16px/20px monospace"></private-select></form>
<script>customElements.define("private-select", class extends HTMLElement {
  static formAssociated = true;
  constructor() {
    super();
    this.internals = this.attachInternals();
    this.internals.role = "combobox";
    this.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") { this.textContent = "PRIVATE-1234"; this.internals.setFormValue(this.textContent); event.preventDefault(); }
    });
  }
});</script>`),
    populate: async (tab) => {
      await tab.focus("#secret");
      await tab.keyboard.press("ArrowDown");
      await tab.evaluate(() => document.activeElement.blur());
    },
    expect: "limit",
  },
  // Skipped reads: nothing in the frame can be proven field-free.
  {
    // Chrome lets the user type here, but no selector matches CSS-made editability, so the read is skipped.
    name: "field made editable by -webkit-user-modify",
    html: page(
      `<div id="secret" tabindex="0" style="${BOX};color:#0f0;font:16px/20px monospace;-webkit-user-modify:read-write"></div>`,
    ),
    populate: type("PRIVATE-1234"),
    expect: "skipped",
  },
  {
    name: "display:contents editing host with direct text",
    html: page(`<div style="position:absolute;left:100px;top:100px;color:#0f0;z-index:1"><div contenteditable="true" style="display:contents">PRIVATE-1234</div></div>`),
    expect: "skipped",
  },
  {
    name: "display:contents editable wrapper",
    html: page(`<div contenteditable="true" style="display:contents"><div style="${BOX};background:#0f0">PRIVATE</div></div>`),
    expect: "skipped",
  },
  {
    name: "designMode page",
    html: page(`<p style="${BOX};color:#0f0">PRIVATE</p><script>document.designMode = "on";</script>`),
    expect: "skipped",
  },
  {
    name: "field kept visible by inline !important",
    html: page(INPUT("", `${BOX};background:#0f0;font:16px monospace;opacity:1 !important`)),
    expect: "skipped",
  },
  {
    name: "active view transition",
    html: page(`<style>::view-transition-group(*),::view-transition-old(*),::view-transition-new(*){animation-duration:60s}</style>${INPUT()}`),
    populate: async (tab) => {
      await tab.evaluate(() => { document.startViewTransition(() => {}); });
      await tab.waitForFunction(() => document.activeViewTransition);
    },
    expect: "skipped",
    restore: false,
  },
  { name: "field removed after the screenshot", html: page(INPUT()), after: () => document.querySelector("#secret").remove(), expect: "skipped" },
  {
    name: "display:none field shown during the screenshot",
    html: page(INPUT("", `${BOX};background:#0f0;font:16px monospace;display:none`)),
    before: () => { document.querySelector("#secret").style.display = "block"; },
    after: () => { document.querySelector("#secret").style.display = "none"; },
    expect: "skipped",
  },
  {
    name: "hidden field shown during the screenshot",
    html: page(INPUT("hidden")),
    before: () => { document.querySelector("#secret").hidden = false; },
    after: () => { document.querySelector("#secret").hidden = true; },
    expect: "skipped",
  },
  {
    name: "field revealed by an ancestor class during the screenshot",
    html: page(`<div id="wrap" class="off">${INPUT()}</div>`),
    before: () => document.querySelector("#wrap").classList.remove("off"),
    after: () => document.querySelector("#wrap").classList.add("off"),
    expect: "skipped",
  },
  {
    name: "shadow root attached during the window, field removed before the recheck",
    html: page(`<closed-field id="host" style="${BOX};display:block"></closed-field>`),
    before: (closedInput) => {
      window.secretRoot = document.querySelector("#host").attachShadow({ mode: "closed" });
      window.secretRoot.innerHTML = closedInput;
    },
    after: () => window.secretRoot.querySelector("input").remove(),
    expect: "skipped",
  },
  {
    name: "recheck held past the 2 s limit",
    html: page(INPUT()),
    holdMs: 2_600,
    expect: "skipped",
  },
];

async function waitFor(predicate, label) {
  const deadline = Date.now() + 20_000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

const pages = Object.fromEntries(scenarios.map((scenario, index) => [`/s${index}`, scenario.html]));
const harness = await launchVisionChrome(process.cwd(), pages);
const results = {};
const failures = [];
let failure;
try {
  // Test-only gates in the extension's service worker: hold the read right after the fields are hidden
  // (before the screenshot), and again after the screenshot, before the recheck restores them.
  await harness.worker.evaluate(() => {
    const send = chrome.tabs.sendMessage.bind(chrome.tabs);
    const gate = (name) =>
      new Promise((resolve) => {
        globalThis.__gates[name] = resolve;
      });
    globalThis.__gates = {};
    chrome.tabs.sendMessage = async (...args) => {
      const message = args[1];
      if (message?.type === "SEMANTIC_VISION_PREPARE") {
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
  // RGBA pixels of a rect of a base64 PNG.
  const pixels = (data, rect) =>
    decoder.evaluate(
      async (data, rect) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const box = rect ?? { x: 0, y: 0, width: image.width, height: image.height };
        return Array.from(context.getImageData(box.x, box.y, box.width, box.height).data);
      },
      data,
      rect,
    );
  const tinted = (rgba) => {
    const set = new Set();
    for (let index = 0; index < rgba.length; index += 4) {
      if (rgba[index + 1] - Math.max(rgba[index], rgba[index + 2]) >= 2) set.add(index / 4);
    }
    return set;
  };
  const pageTint = async (tab) => tinted(await pixels(await tab.page.screenshot({ encoding: "base64" }))).size;
  const pageState = (tab) =>
    tab.page.evaluate(() => ({
      focus: document.activeElement?.id ?? null,
      sheets: document.adoptedStyleSheets.length,
      closedRootSheets: window.__closedRoot?.adoptedStyleSheets.length ?? null,
    }));

  // One gated vision read. Returns the button's tile pixels, or null when it was skipped.
  const read = async (scenario, tab) => {
    let done = false;
    const reading = harness.readPage(tab.tabId, { semanticObservation: true, semanticVision: true }).finally(() => {
      done = true;
    });
    // Awaited below; this only keeps a read cut short by a failure from crashing the run.
    reading.catch(() => {});
    await waitFor(async () => done || (await atGate("pre")) || (await atGate("post")), `${scenario.name}: fields hidden`);
    if (!done && (await atGate("pre"))) {
      results[scenario.name] = { ...results[scenario.name], hidden: await pageState(tab) };
      try {
        if (scenario.before) {
          await tab.page.evaluate(scenario.before, CLOSED_INPUT);
          await tab.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        }
      } finally {
        await release("pre");
      }
      await waitFor(async () => done || (await atGate("post")), `${scenario.name}: screenshot`);
    }
    if (!done) {
      try {
        if (scenario.after) await tab.page.evaluate(scenario.after);
        if (scenario.holdMs) {
          await new Promise((resolve) => setTimeout(resolve, scenario.holdMs - 300));
          results[scenario.name] = { ...results[scenario.name], tintDuringHold: await pageTint(tab) };
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      } finally {
        await release("post");
      }
    }
    const observation = await reading;
    const button = observation.candidates.find((candidate) => candidate.role === "button" && candidate.name === "");
    const tile = observation.vision.tiles.find((item) => item.ref === button.ref);
    if (!tile) return { observation, tile: null };
    const dpr = await tab.page.evaluate(() => devicePixelRatio);
    const cropX = Math.floor(96 * dpr);
    const cropY = Math.floor(96 * dpr);
    const factor = tile.width / (Math.ceil(244 * dpr) - cropX);
    const at = async (x, y) =>
      pixels(observation.vision.image.data, {
        x: Math.floor(tile.x + (x * dpr - cropX) * factor),
        y: Math.floor(tile.y + (y * dpr - cropY) * factor),
        width: 1,
        height: 1,
      });
    return {
      observation,
      tile: await pixels(observation.vision.image.data, tile),
      field: await at(103, 103),
      control: await at(235, 105),
    };
  };

  const black = ([r, g, b]) => r <= 16 && g <= 16 && b <= 16;
  const white = ([r, g, b]) => r >= 240 && g >= 240 && b >= 240;
  const checkScenario = async (scenario, tab) => {
    if (scenario.populate) await scenario.populate(tab.page);
    // Screenshots for the restoration check only where it applies: one can end a running view transition.
    const snapshot = async () => (scenario.restore === false ? null : { tint: await pageTint(tab), ...(await pageState(tab)) });
    const before = await snapshot();
    const populated = await read(scenario, tab);
    const after = await snapshot();
    const result = {
      ...results[scenario.name],
      tiles: populated.observation.vision.tiles.length,
      skipped: populated.observation.vision.skipped,
    };
    results[scenario.name] = result;
    const fail = (message) => failures.push(`${scenario.name}: ${message}`);

    if (scenario.expect === "skipped" && populated.tile) fail("expected the read to be skipped");
    if (scenario.expect === "tile" && !populated.tile) fail("expected a tile");
    if (populated.tile) {
      if (!white(populated.control)) fail("tile sampling is misaligned");
      if (scenario.masked && !black(populated.field)) fail("expected the field box blacked out");
      // Empty-field control read of the same fixture.
      const clear = scenario.clear ?? (scenario.populate ? clearSecret : null);
      let control = null;
      if (clear) {
        await clear(tab.page);
        control = await read({ name: `${scenario.name} (empty)` }, tab);
      }
      if (control && !control.tile) {
        fail("the empty-field control read sent no tile");
      } else {
        const controlTint = control ? tinted(control.tile) : new Set();
        const leaked = [...tinted(populated.tile)].filter((pixel) => !controlTint.has(pixel)).length;
        result.tintedPixels = leaked;
        if (leaked > 0 && scenario.expect !== "limit") fail(`${leaked} tinted pixels reached the sheet`);
        if (scenario.anyDifference && control) {
          let differing = 0;
          for (let channel = 0; channel < populated.tile.length; channel += 4) {
            if ([0, 1, 2].some((offset) => Math.abs(populated.tile[channel + offset] - control.tile[channel + offset]) > 2)) differing++;
          }
          result.differingPixels = differing;
          if (differing > 0) fail(`${differing} pixels differ from the empty-field read`);
        }
      }
    }
    if (scenario.holdMs && result.tintDuringHold !== before.tint) {
      fail(`fields were not restored after the 2 s limit (tint ${result.tintDuringHold} vs ${before.tint})`);
    }
    // Restoration: the fields paint again, focus and adopted style sheets are as before.
    if (scenario.restore !== false && !scenario.before && !scenario.after) {
      result.restored = { before, after };
      if (after.tint !== before.tint) fail(`field pixels not restored (tint ${after.tint} vs ${before.tint})`);
      if (after.focus !== before.focus) fail(`focus moved from ${before.focus} to ${after.focus}`);
      if (after.sheets !== before.sheets || after.closedRootSheets !== before.closedRootSheets) {
        fail("adoptedStyleSheets not back to baseline");
      }
      // While the fields were hidden the page saw one more sheet, so the baseline check above is meaningful.
      const during = result.hidden;
      if (populated.tile && (during?.sheets !== before.sheets + 1 || (before.closedRootSheets !== null && during.closedRootSheets !== before.closedRootSheets + 1))) {
        fail(`the sheet was not adopted while hidden: ${JSON.stringify(during)}`);
      }
      if (scenario.focused && after.focus !== "secret") fail("the focused field lost focus");
    }
  };

  for (const [index, scenario] of scenarios.entries()) {
    const tab = await harness.openTab(`/s${index}`);
    try {
      await checkScenario(scenario, tab);
    } catch (error) {
      // A read that breaks still counts as one failed scenario; the rest keep running.
      failures.push(`${scenario.name}: ${error.message.split("\n")[0]}`);
    }
    await tab.page.close();
  }
  console.log(JSON.stringify(results, null, 2));
  if (failures.length) throw new Error(failures.join("\n"));
} catch (error) {
  failure = error;
} finally {
  await harness.close();
}
if (failure) throw failure;
