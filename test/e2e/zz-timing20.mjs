import { createServer } from "node:http";
import { launchVisionChrome } from "./vision-chrome.mjs";
const icon = `<svg width="24" height="24"><circle cx="12" cy="12" r="8" fill="blue"/></svg>`;
const button = `<button style="position:absolute;left:100px;top:100px;width:140px;height:40px;border:0;background:#fff">${icon}</button>`;
// A slow server on another port: its frame is still loading (no content script yet) during the read.
const slow = createServer((req, res) => setTimeout(() => { res.writeHead(200, { "content-type": "text/html" }); res.end("<p>slow</p>"); }, 4000));
await new Promise((r) => slow.listen(0, "127.0.0.1", r));
const slowPort = slow.address().port;
const frames = (n, cross) => Array.from({ length: n }, (_, i) => `<iframe class="f" data-cross="${cross ? 1 : 0}" style="position:absolute;left:${300 + (i % 10) * 60}px;top:${cross ? 400 : 300}px;width:50px;height:50px;border:0"></iframe>`).join("");
const pages = {
  "/blank": `<!doctype html><body><p>Ad</p></body>`,
  "/none": `<!doctype html><body style="margin:0">${button}</body>`,
  "/twenty": `<!doctype html><body style="margin:0">${button}${frames(10, false)}${frames(10, true)}
<script>for (const f of document.querySelectorAll(".f")) { f.addEventListener("load", () => { window.loads = (window.loads ?? 0) + 1; }); f.src = (f.dataset.cross === "1" ? location.origin.replace("127.0.0.1", "localhost") : location.origin) + "/blank"; }</script></body>`,
  "/slow": `<!doctype html><body style="margin:0">${button}<iframe id="s" style="position:absolute;left:400px;top:300px;width:100px;height:100px;border:0"></iframe>
<script>document.querySelector("#s").src = "http://localhost:${slowPort}/slow";</script></body>`,
};
const h = await launchVisionChrome(process.cwd(), pages);
const med = (v) => { const s = [...v].sort((a, b) => a - b); return Math.round(s[Math.floor((s.length - 1) / 2)]); };
try {
  await h.worker.evaluate(() => {
    const send = chrome.tabs.sendMessage.bind(chrome.tabs);
    globalThis.__frameAsk = [];
    chrome.tabs.sendMessage = async (...a) => {
      if (a[1]?.type !== "SEMANTIC_VISION_FRAME_SURFACES") return send(...a);
      const t0 = performance.now();
      try { return await send(...a); } finally { __frameAsk.push(performance.now() - t0); }
    };
  });
  for (const path of ["/none", "/twenty"]) {
    const tab = await h.openTab(path);
    if (path === "/twenty") await tab.page.waitForFunction(() => window.loads === 20);
    const reads = []; const asks = []; let last;
    for (let i = 0; i < 6; i++) {
      await h.worker.evaluate(() => { __frameAsk = []; });
      const t0 = performance.now();
      last = await h.readPage(tab.tabId, { semanticObservation: true, semanticVision: true });
      reads.push(performance.now() - t0);
      asks.push(Math.max(0, ...(await h.worker.evaluate(() => __frameAsk))));
    }
    const frameCount = await h.worker.evaluate(async (tabId) => (await chrome.webNavigation.getAllFrames({ tabId })).length, tab.tabId);
    console.log(path, JSON.stringify({ frames: frameCount, tiles: last.vision.tiles.length, skipped: last.vision.skipped, visionReadMs: med(reads.slice(1)), slowestFrameAnswerMs: med(asks.slice(1)) }));
  }
  const tab = await h.openTab("/slow");
  await new Promise((r) => setTimeout(r, 300));
  const t0 = performance.now();
  const o = await h.readPage(tab.tabId, { semanticObservation: true, semanticVision: true });
  console.log("/slow (frame still loading)", JSON.stringify({ tiles: o.vision.tiles.length, skipped: o.vision.skipped, readMs: Math.round(performance.now() - t0) }));
} finally { await h.close(); slow.close(); }
