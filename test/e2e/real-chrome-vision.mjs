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
const POPOVER = `<div popover="manual" style="position:fixed;inset:auto;left:100px;top:100px;margin:0;padding:0;border:0;width:60px;height:40px;color:#0f0;background:white;font:16px/20px monospace"></div>`;
const BUTTON_AT = (x, y) =>
  `<button style="position:absolute;left:${x}px;top:${y}px;width:40px;height:40px;margin:0;padding:0;border:0;background:#fff"><svg width="24" height="24" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" fill="#00f"/></svg></button>`;
const SECRET_POPOVER = POPOVER.replace("<div popover", '<div id="secret" popover').replace("></div>", ">PRIVATE-1234</div>");
const SHOW_SECRET = `<script>document.querySelector("#secret").showPopover();</script>`;
// An email field and its submit button, served at /frame-form for <object data>, and inline for an iframe's srcdoc
// (quotes escaped for the attribute). FRAME_DATE is a date input with a value, for a srcdoc iframe.
const FRAME_FORM_PAGE = `<!doctype html><body style="margin:0"><form><input id="f" type="email" aria-label="Email" style="width:300px;height:28px"><button id="go">Subscribe</button></form></body>`;
const FRAME_FORM = FRAME_FORM_PAGE.replace("<!doctype html>", "").replaceAll('"', "&quot;");
const FRAME_DATE_PAGE = `<!doctype html><body style="margin:0"><input id="f" type="date" value="2031-02-14" aria-label="When" style="width:200px;height:28px"></body>`;
const FRAME_DATE = FRAME_DATE_PAGE.replace("<!doctype html>", "").replaceAll('"', "&quot;");
// A field-less embedded page, like an ad or a video player.
const FRAME_BLANK_PAGE = `<!doctype html><body style="margin:0;background:#eee"><p>Advertisement</p></body>`;
// The same server under another origin (localhost instead of 127.0.0.1): a cross-origin, out-of-process frame.
const crossOrigin = (path) => `location.origin.replace("127.0.0.1", "localhost") + "${path}"`;
// Opens the date picker in the cross-origin frame with a real click on the calendar button at the right end of the
// date input (page coordinates; Puppeteer can't reach into the out-of-process frame here), and confirms it is open
// from the extension, in every frame of the tab, before going on.
const openFramePicker = async (tab) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    await tab.bringToFront();
    await tab.mouse.click(286, 70);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const open = await harness.worker.evaluate(async (url) => {
      const [target] = await chrome.tabs.query({ url });
      const frames = await chrome.scripting.executeScript({
        target: { tabId: target.id, allFrames: true },
        func: () => document.querySelector("#f")?.matches(":open") ?? false,
      });
      return frames.some((frame) => frame.result === true);
    }, tab.url());
    if (open) return;
  }
  throw new Error("the date picker in the cross-origin frame did not open");
};
// The first child frame (iframe, or <object>/<embed> document) that has the selector.
const childFrame = async (tab, selector) => {
  for (let attempt = 0; attempt < 50; attempt++) {
    for (const frame of tab.frames()) {
      if (frame !== tab.mainFrame() && (await frame.$(selector).catch(() => null))) return frame;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`no child frame with ${selector}`);
};
const closeSecret = (tab) =>
  tab.evaluate(() => {
    const secret = document.querySelector("#secret");
    secret.localName === "dialog" ? secret.close() : secret.hidePopover();
  });
const FIELD_AT = "position:absolute;left:400px;top:300px;width:60px;height:20px;color:#0f0;font:16px/20px monospace";
// A custom element whose shadow tree is `inner`.
const COMPONENT = (name, mode, inner) => `<script>customElements.define("${name}", class extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: "${mode}" }).innerHTML = '${inner}'; }
});</script>`;

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
    // A non-editable chip inside an editor shows its text through a slot in its own shadow popover.
    name: "shadow popover of a non-editable chip inside an editor",
    html: page(`<div contenteditable="true" style="position:absolute;left:400px;top:300px;width:60px;height:20px;color:#0f0;font:16px/20px monospace"><span id="secret" contenteditable="false">PRIVATE-1234</span></div>
<script>const root = document.querySelector("#secret").attachShadow({ mode: "open" });
root.innerHTML = '<div popover="manual" style="position:fixed;inset:auto;left:100px;top:100px;margin:0;padding:0;border:0;width:60px;height:40px;color:#0f0;background:white;font:16px/20px monospace"><slot></slot></div>';
root.querySelector("[popover]").showPopover();</script>`),
    clear: clearSecret,
    expect: "tile",
  },
  ...["shadow", "light"].map((variant) => ({
    // An explicit role=combobox shows its selected value in its own popover.
    name: `role=combobox value in a ${variant} popover`,
    html: page(`<div id="secret" role="combobox" tabindex="0" aria-expanded="true" style="position:absolute;left:400px;top:300px;width:60px;height:20px;color:#0f0;font:16px/20px monospace">${variant === "light" ? POPOVER : ""}</div>
<script>const combobox = document.querySelector("#secret");
const pop = ${variant === "light" ? 'combobox.querySelector("[popover]")' : `combobox.attachShadow({ mode: "open" }); pop.innerHTML = '${POPOVER.replace("></div>", "><slot></slot></div>")}'`};
(pop.querySelector?.("[popover]") ?? pop).showPopover();
combobox.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown") return;
  (combobox.querySelector("[popover]") ?? combobox).textContent = "PRIVATE-1234";
  event.preventDefault();
});</script>`),
    populate: async (tab) => {
      await tab.focus("#secret");
      await tab.keyboard.press("ArrowDown");
      await tab.evaluate(() => document.activeElement.blur());
    },
    clear: (tab) =>
      tab.evaluate(() => {
        const secret = document.querySelector("#secret");
        (secret.querySelector("[popover]") ?? secret).textContent = "";
      }),
    expect: "tile",
  })),
  {
    // An open popover menu that is not inside a field keeps its tiles.
    name: "open popover menu outside any field",
    html: page(`<div id="menu" popover="manual" style="position:fixed;inset:auto;left:300px;top:300px;width:100px;height:48px;margin:0;padding:0;border:1px solid #ccc;background:#fff">${BUTTON_AT(4, 4)}${BUTTON_AT(56, 4)}</div>
<script>document.querySelector("#menu").showPopover();</script>`),
    expect: "tile",
    minTiles: 3,
  },
  ...["open", "closed"].map((mode) => ({
    // A component's role=combobox renders its light-DOM value, an open popover, through a slot.
    name: `popover slotted into a role=combobox in a ${mode} shadow root`,
    html: page(`${COMPONENT("ui-combobox", mode, `<div role="combobox" tabindex="0" style="${FIELD_AT}"><slot></slot></div>`)}
<ui-combobox>${SECRET_POPOVER}</ui-combobox>${SHOW_SECRET}`),
    clear: clearSecret,
    expect: "tile",
  })),
  {
    // An editor component's content is its light DOM, rendered inside a contenteditable through a slot.
    name: "popover slotted into a contenteditable component",
    html: page(`${COMPONENT("ui-editor", "open", `<div contenteditable="true" style="${FIELD_AT}"><slot></slot></div>`)}
<ui-editor>${SECRET_POPOVER}</ui-editor>${SHOW_SECRET}`),
    clear: clearSecret,
    expect: "tile",
  },
  {
    // The same popover nested in a slotted paragraph: no sheet reaches it, so the read is skipped.
    name: "popover nested in content slotted into a contenteditable component",
    html: page(`${COMPONENT("ui-editor", "open", `<div contenteditable="true" style="${FIELD_AT}"><slot></slot></div>`)}
<ui-editor><p style="margin:0">x${SECRET_POPOVER.replaceAll("div", "span")}</p></ui-editor>${SHOW_SECRET}`),
    clear: clearSecret,
    expect: "skipped",
  },
  {
    // A popover nested in content slotted into a role=combobox is not hidden by a sheet; the check skips the read.
    name: "popover nested in content slotted into a role=combobox",
    html: page(`${COMPONENT("ui-combobox", "closed", `<div role="combobox" tabindex="0" style="${FIELD_AT}"><slot></slot></div>`)}
<ui-combobox><p style="margin:0">x${SECRET_POPOVER.replaceAll("div", "span")}</p></ui-combobox>${SHOW_SECRET}`),
    clear: clearSecret,
    expect: "skipped",
  },
  ...["popover", "dialog"].map((kind) => ({
    // A top-layer element nested in slotted field content, closing with a display/overlay exit transition: it still
    // paints while no longer open, so the read is skipped.
    name: `closing ${kind} nested in content slotted into a contenteditable component`,
    html: page(`<style>#secret { transition: display 3s allow-discrete, overlay 3s allow-discrete } #secret::backdrop { display: none }</style>
${COMPONENT("ui-editor", "open", `<div contenteditable="true" style="${FIELD_AT}"><slot></slot></div>`)}
<ui-editor><div style="margin:0">x<span>${kind === "dialog" ? SECRET_POPOVER.replaceAll("div", "dialog").replace(' popover="manual"', "") : SECRET_POPOVER.replaceAll("div", "span")}</span></div></ui-editor>
<script>const secret = document.querySelector("#secret"); secret.localName === "dialog" ? secret.showModal() : secret.showPopover();</script>`),
    populate: closeSecret,
    clear: async (tab) => {
      await tab.evaluate(async () => {
        const secret = document.querySelector("#secret");
        secret.textContent = "";
        secret.localName === "dialog" ? secret.showModal() : secret.showPopover();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      await closeSecret(tab);
    },
    expect: "skipped",
    restore: false,
  })),
  {
    // ui-outer forwards its light DOM through its own slot into a ui-combobox slot.
    name: "popover slotted into a role=combobox through a two-level slot chain",
    html: page(`${COMPONENT("ui-combobox", "open", `<div role="combobox" tabindex="0" style="${FIELD_AT}"><slot></slot></div>`)}
${COMPONENT("ui-outer", "open", "<ui-combobox><slot></slot></ui-combobox>")}
<ui-outer>${SECRET_POPOVER}</ui-outer>${SHOW_SECRET}`),
    clear: clearSecret,
    expect: "tile",
  },
  {
    // A popover menu slotted beside a field, not into it, keeps its tiles.
    name: "popover menu slotted beside a field",
    html: page(`${COMPONENT("ui-picker", "open", `<div role="combobox" tabindex="0" style="${FIELD_AT}"></div><div><slot></slot></div>`)}
<ui-picker><div id="menu" popover="manual" style="position:fixed;inset:auto;left:300px;top:300px;width:100px;height:48px;margin:0;padding:0;border:1px solid #ccc;background:#fff">${BUTTON_AT(4, 4)}${BUTTON_AT(56, 4)}</div></ui-picker>
<script>document.querySelector("#menu").showPopover();</script>`),
    expect: "tile",
    minTiles: 3,
  },
  {
    // An open customizable select draws its picker in the select's own shadow tree, out of reach: skipped.
    name: "open customizable select picker",
    html: page(`<style>select, ::picker(select) { appearance: base-select }
select { position:absolute;left:0;top:60px;width:120px;white-space:nowrap;color:#0f0;font:16px/20px monospace }
option { color: #0f0 }</style>
<select id="secret" aria-label="Account"><option>Choose</option><option selected>PRIVATE-1234</option></select>`),
    populate: async (tab) => {
      await tab.click("#secret");
      await tab.waitForFunction(() => document.querySelector("#secret").matches(":open"));
    },
    clear: (tab) =>
      tab.evaluate(() => {
        document.querySelector("#secret").selectedOptions[0].textContent = "";
      }),
    expect: "skipped",
  },
  ...[
    ["Escape", (tab) => tab.keyboard.press("Escape")],
    ["picking an option", (tab) => tab.mouse.click(110, 110)],
  ].map(([how, close]) => {
    // A customizable select's picker over the button, closing with a display/overlay exit transition: no longer
    // `:open`, but it still paints the options, so the read is skipped.
    const openAndClose = async (tab) => {
      await tab.click("#secret");
      await tab.waitForFunction(() => document.querySelector("#secret").matches(":open"));
      await close(tab);
      await tab.waitForFunction(() => !document.querySelector("#secret").matches(":open"));
    };
    return {
      name: `customizable select picker closing after ${how}`,
      html: page(`<style>select, ::picker(select) { appearance: base-select }
select { position:absolute;left:400px;top:300px;width:80px;height:24px;color:#0f0;font:16px/20px monospace }
::picker(select) { position-area:none;position-try:none;position:fixed;inset:auto;left:100px;top:100px;margin:0;padding:0;border:0;width:60px;color:#0f0;background:white;font:16px/20px monospace;
  transition: display 3s allow-discrete, overlay 3s allow-discrete }
option { padding:0;margin:0;min-block-size:0;color:#0f0 } option::checkmark { display:none }</style>
<select id="secret" aria-label="Account"><option>PRIVATE-1234</option><option>PRIVATE-5678</option></select>`),
      populate: openAndClose,
      clear: async (tab) => {
        await tab.evaluate(async () => {
          // A non-breaking space keeps each option's line box, so the pick lands on an option again.
          for (const option of document.querySelectorAll("option")) option.textContent = String.fromCharCode(160);
          // Let the previous exit transition finish before opening again.
          await new Promise((resolve) => setTimeout(resolve, 3200));
        });
        await openAndClose(tab);
      },
      expect: "skipped",
      restore: false,
    };
  }),
  ...[
    ["date", "2031-02-14"],
    ["time", "09:30"],
  ].map(([type, value]) => {
    // Chrome draws a date or time input's picker inside the page, over the button, showing the field's value:
    // the read is skipped while it is open.
    const openPicker = async (tab) => {
      await tab.evaluate(() => document.querySelector("#secret").showPicker());
      await tab.waitForFunction(() => document.querySelector("#secret").matches(":open"));
    };
    return {
      name: `open ${type} input picker`,
      html: page(`<input id="secret" type="${type}" value="${value}" aria-label="When" style="position:absolute;left:100px;top:60px;width:200px;height:28px">`),
      populate: openPicker,
      clear: async (tab) => {
        await tab.keyboard.press("Escape");
        await tab.evaluate(() => {
          document.querySelector("#secret").value = "";
        });
        await openPicker(tab);
      },
      expect: "skipped",
      anyDifference: true,
    };
  }),
  {
    // The same date input with its picker closed keeps the button's tile.
    name: "idle date input above the button",
    html: page(`<input id="secret" type="date" value="2031-02-14" aria-label="When" style="position:absolute;left:100px;top:60px;width:200px;height:28px">`),
    clear: clearSecret,
    expect: "tile",
    anyDifference: true,
  },
  ...[
    ["a submit click", (tab) => tab.click("#submit")],
    ["reportValidity()", (tab) => tab.evaluate(() => document.querySelector("form").reportValidity())],
  ].map(([how, validate]) => ({
    // Chrome draws the validation message for the focused invalid field inside the page, over the button, and it
    // quotes the value ("'john.smith.private' is missing an '@'"): the read is skipped while that field is focused.
    name: `email validation message after ${how}`,
    html: page(`<form><input id="secret" type="email" aria-label="Email" style="position:absolute;left:100px;top:60px;width:300px;height:28px">
<button id="submit" type="submit" style="position:absolute;left:600px;top:400px">Sign up</button></form>`),
    populate: async (tab) => {
      await type("john.smith.private", { blur: false })(tab);
      await validate(tab);
      await new Promise((resolve) => setTimeout(resolve, 300));
    },
    clear: async (tab) => {
      // An empty email field is valid: blur it so its message goes away before the empty read.
      await tab.evaluate(() => {
        const secret = document.querySelector("#secret");
        secret.value = "";
        secret.blur();
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
    },
    expect: "skipped",
    anyDifference: true,
  })),
  {
    // A field in a same-origin iframe: Chrome draws its validation message over the parent page, outside the hidden
    // frame, while the parent's activeElement is the iframe. After the failed submit the read is skipped.
    name: "validation message of a field in a same-origin iframe",
    html: page(`<iframe id="frame" style="position:absolute;left:100px;top:56px;width:380px;height:40px;border:0" srcdoc="${FRAME_FORM}"></iframe>`),
    populate: async (tab) => {
      const frame = tab.frames().find((candidate) => candidate !== tab.mainFrame());
      await frame.type("#f", "john.smith.private");
      await frame.click("#go");
      await new Promise((resolve) => setTimeout(resolve, 300));
    },
    clear: async (tab) => {
      const frame = tab.frames().find((candidate) => candidate !== tab.mainFrame());
      await frame.evaluate(() => {
        const field = document.querySelector("#f");
        field.value = "";
        field.blur();
      });
      await tab.evaluate(() => document.querySelector("#frame").blur());
      await new Promise((resolve) => setTimeout(resolve, 300));
    },
    expect: "skipped",
    anyDifference: true,
  },
  {
    // The same iframe with an untouched field keeps the button's tile.
    name: "same-origin iframe with an untouched form",
    html: page(`<iframe id="frame" style="position:absolute;left:100px;top:56px;width:380px;height:40px;border:0" srcdoc="${FRAME_FORM}"></iframe>`),
    expect: "tile",
  },
  {
    // An embedded same-origin HTML document (<object data>): after a failed submit inside it, Chrome draws the
    // validation message over the parent page. The object's document is walked like a frame, so the read is skipped.
    name: "validation message of a field in a same-origin <object> document",
    html: page(`<object id="frame" type="text/html" data="/frame-form" style="position:absolute;left:100px;top:56px;width:380px;height:40px"></object>`),
    populate: async (tab) => {
      const frame = await childFrame(tab, "#f");
      await frame.type("#f", "john.smith.private");
      await frame.click("#go");
      await new Promise((resolve) => setTimeout(resolve, 300));
    },
    clear: async (tab) => {
      const frame = await childFrame(tab, "#f");
      await frame.evaluate(() => {
        const field = document.querySelector("#f");
        field.value = "";
        field.blur();
      });
      await tab.evaluate(() => document.activeElement.blur());
      await new Promise((resolve) => setTimeout(resolve, 300));
    },
    expect: "skipped",
    anyDifference: true,
  },
  {
    // The same <object> with an untouched form keeps the button's tile.
    name: "same-origin <object> document with an untouched form",
    html: page(`<object id="frame" type="text/html" data="/frame-form" style="position:absolute;left:100px;top:56px;width:380px;height:40px"></object>`),
    expect: "tile",
  },
  {
    // A date picker opened by a click in a cross-origin iframe stays drawn over the page after the host moves focus
    // away (as a focus-trap chat widget does). Only that frame can see it, and it answers that it is shown.
    name: "date picker in a cross-origin iframe after the host moves focus",
    html: page(`<iframe id="frame" style="position:absolute;left:100px;top:56px;width:300px;height:36px;border:0"></iframe>
<button id="chat" style="position:absolute;left:600px;top:450px">Start chat</button>
<script>const frame = document.querySelector("#frame");
frame.addEventListener("load", () => { window.frameLoads = (window.frameLoads ?? 0) + 1; });
frame.src = ${crossOrigin("/frame-date")};</script>`),
    // Puppeteer can't reach into the out-of-process frame here, so the picker is opened with a real click on the
    // calendar button at the right end of the date input, at page coordinates.
    populate: async (tab) => {
      await tab.waitForFunction(() => window.frameLoads === 1);
      await openFramePicker(tab);
      await tab.evaluate(() => document.querySelector("#chat").focus());
      await new Promise((resolve) => setTimeout(resolve, 200));
    },
    // The empty control reloads the frame with no value, then opens the picker the same way.
    clear: async (tab) => {
      await tab.keyboard.press("Escape");
      await tab.evaluate((src) => {
        document.querySelector("#frame").src = src;
      }, `${new URL(tab.url()).origin.replace("127.0.0.1", "localhost")}/frame-date?empty`);
      await tab.waitForFunction(() => window.frameLoads === 2);
      await openFramePicker(tab);
      await tab.evaluate(() => document.querySelector("#chat").focus());
      await new Promise((resolve) => setTimeout(resolve, 200));
    },
    expect: "skipped",
    anyDifference: true,
  },
  {
    // Field-less cross-origin iframes (ads, video players) answer that nothing is shown: tiles are kept.
    name: "field-less cross-origin iframes",
    html: page(`${[0, 1, 2].map((index) => `<iframe class="ad" style="position:absolute;left:${400 + index * 160}px;top:300px;width:150px;height:100px;border:0"></iframe>`).join("")}
<script>for (const ad of document.querySelectorAll(".ad")) {
  ad.addEventListener("load", () => { window.frameLoads = (window.frameLoads ?? 0) + 1; });
  ad.src = ${crossOrigin("/frame-blank")};
}</script>`),
    populate: (tab) => tab.waitForFunction(() => window.frameLoads === 3),
    // Nothing to clear: the empty control reads the same page again.
    clear: async () => {},
    expect: "tile",
  },
  {
    // A script-built about:blank iframe (an ad slot) also answers, since the content script runs there too.
    name: "script-built about:blank iframe without fields",
    html: page(`<iframe id="slot" style="position:absolute;left:400px;top:300px;width:300px;height:250px;border:0"></iframe>
<script>document.querySelector("#slot").contentDocument.body.innerHTML = '<div style="width:300px;height:250px;background:#eee">Advertisement</div>';</script>`),
    expect: "tile",
  },
  {
    // An iframe whose load failed (here a closed port, as with an ad blocker) shows Chrome's error page, where no
    // content script runs; it holds no page fields, so it doesn't stop the read.
    name: "iframe whose load failed",
    html: page(`<iframe id="frame" style="position:absolute;left:400px;top:300px;width:300px;height:100px;border:0"></iframe>
<script>const frame = document.querySelector("#frame");
frame.addEventListener("load", () => { window.frameLoads = 1; });
frame.src = "http://127.0.0.1:9/";</script>`),
    populate: (tab) => tab.waitForFunction(() => window.frameLoads === 1),
    // Nothing to clear: the empty control reads the same page again.
    clear: async () => {},
    expect: "tile",
  },
  {
    // A date input in a same-origin iframe with its picker open: Chrome draws the picker in the page, showing the
    // value, so the read is skipped.
    name: "open date input picker in a same-origin iframe",
    html: page(`<iframe id="frame" style="position:absolute;left:100px;top:56px;width:300px;height:36px;border:0" srcdoc="${FRAME_DATE}"></iframe>`),
    populate: async (tab) => {
      const frame = await childFrame(tab, "#f");
      await frame.evaluate(() => document.querySelector("#f").showPicker());
      await frame.waitForFunction(() => document.querySelector("#f").matches(":open"));
    },
    clear: async (tab) => {
      const frame = await childFrame(tab, "#f");
      await tab.keyboard.press("Escape");
      await frame.evaluate(() => {
        document.querySelector("#f").value = "";
      });
      await frame.evaluate(() => document.querySelector("#f").showPicker());
      await frame.waitForFunction(() => document.querySelector("#f").matches(":open"));
    },
    expect: "skipped",
    anyDifference: true,
  },
  {
    // A failed submit focuses the invalid field and the page moves focus away at once (as a focus trap does): Chrome
    // still shows the message, and the field matches :user-invalid, so the read is skipped.
    name: "validation message after a submit that moves focus away",
    html: page(`<form><input id="secret" type="email" aria-label="Email" style="position:absolute;left:100px;top:60px;width:300px;height:28px">
<button id="submit" type="submit" style="position:absolute;left:600px;top:400px">Sign up</button></form>
<button id="chat" style="position:absolute;left:600px;top:450px">Start chat</button>`),
    populate: async (tab) => {
      await type("john.smith.private", { blur: false })(tab);
      await tab.evaluate(() => {
        const chat = document.querySelector("#chat");
        document.querySelector("#secret").addEventListener("focus", () => chat.focus());
      });
      await tab.click("#submit");
      await new Promise((resolve) => setTimeout(resolve, 300));
    },
    clear: async (tab) => {
      await tab.evaluate(() => {
        document.querySelector("#secret").value = "";
        document.activeElement.blur();
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
    },
    expect: "skipped",
    anyDifference: true,
  },
  {
    // An open <details> inside an editor is hidden with the editor and draws no browser surface: tiles are kept.
    name: "open details inside a contenteditable",
    html: page(`<div id="secret" contenteditable="true" style="${FIELD_AT}"><details open><summary>PRIVATE</summary>PRIVATE-1234</details></div>`),
    clear: clearSecret,
    expect: "tile",
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

const pages = {
  ...Object.fromEntries(scenarios.map((scenario, index) => [`/s${index}`, scenario.html])),
  "/frame-form": FRAME_FORM_PAGE,
  // Served for the cross-origin frame: `?empty` clears the value for the empty control.
  "/frame-date": FRAME_DATE_PAGE.replace(
    "</body>",
    `<script>if (location.search) document.querySelector("#f").value = "";</script></body>`,
  ),
  "/frame-blank": FRAME_BLANK_PAGE,
};
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
    if (scenario.minTiles && populated.observation.vision.tiles.length < scenario.minTiles) {
      fail(`expected at least ${scenario.minTiles} tiles`);
    }
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
