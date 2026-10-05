#!/usr/bin/env node
// Live --vision eval in real Chrome: node test/eval/real-vision.mjs [--models clef,clef-flash] [--repeat 10] [--out <dir>]
// Needs `npm run build`, the pinned Chrome for Testing (see test/e2e/real-chrome.mjs), SURF_REAL_SEMANTIC=1,
// CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { launchVisionChrome } from "../e2e/vision-chrome.mjs";

const repo = process.cwd();

if (process.env.SURF_REAL_SEMANTIC !== "1") {
  console.error("Refusing network evaluation without SURF_REAL_SEMANTIC=1");
  process.exit(2);
}
if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
  console.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN");
  process.exit(2);
}

function flag(name, fallback) {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : fallback;
}
const models = flag("--models", "clef,clef-flash").split(",");
const repeat = Number(flag("--repeat", "10"));
const readSamples = Number(flag("--read-samples", "20"));
const outDir = resolve(flag("--out", join(tmpdir(), "surf-vision-eval")));

// Feather icons (MIT), drawn without any title, label or text, so each button's accessible name is "".
const ICONS = {
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
};
const STATUS = { share: "Share link copied", download: "Download started", settings: "Settings opened", save: "Report saved" };
const iconButton = (id) =>
  `<button id="${id}" class="icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[id]}</svg></button>`;
const TOOLBAR = `<!doctype html><html><head><title>Quarterly report</title>
<style>body{font:16px system-ui;margin:24px}.bar{display:flex;gap:12px;align-items:center}.icon{width:40px;height:40px;display:grid;place-items:center;border:1px solid #ccc;border-radius:6px;background:#fff}</style></head>
<body><main><h1>Quarterly report</h1><div class="bar">${iconButton("share")}${iconButton("download")}${iconButton("settings")}<button id="save">Save</button></div>
<p id="status">Ready</p><p id="log" hidden></p></main>
<script>const status=${JSON.stringify(STATUS)};for(const b of document.querySelectorAll("button"))b.addEventListener("click",()=>{document.querySelector("#log").textContent=b.id;document.querySelector("#status").textContent=status[b.id];});</script>
</body></html>`;

const QUERIES = [
  { target: "settings", find: "the settings icon", act: "Open settings" },
  { target: "download", find: "the download icon", act: "Download the report" },
  { target: "share", find: "the share icon", act: "Share the report" },
  { target: "save", find: "the save button", act: "Save the report" },
];

async function surfJson(...args) {
  try {
    const parsed = JSON.parse(await harness.surf(...args, "--json"));
    return parsed && typeof parsed === "object" && "result" in parsed && "target" in parsed ? parsed.result : parsed;
  } catch (error) {
    return { error: (error.stderr || error.message || String(error)).trim().split("\n")[0] };
  }
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
};
const p95 = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] : null;
};

let harness;
let failure;
try {
  harness = await launchVisionChrome(repo, { "/report": TOOLBAR });
  mkdirSync(outDir, { recursive: true });
  const { tabId: tabNumber, page } = await harness.openTab("/report");
  const tabId = String(tabNumber);
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
  const reset = () => page.evaluate(() => {
    document.querySelector("#log").textContent = "";
    document.querySelector("#status").textContent = "Ready";
  });
  const clicked = () => page.evaluate(() => document.querySelector("#log").textContent || null);

  // Map each observed ref to its element by clicking it once.
  const refs = [...(await harness.surf("read", "--tab-id", tabId)).matchAll(/button[^\n]*\[(e\d+)\]/g)].map((match) => match[1]);
  const elementByRef = {};
  for (const ref of refs) {
    await reset();
    await harness.surf("click", ref, "--tab-id", tabId);
    elementByRef[ref] = await clicked();
  }
  await reset();
  if (Object.values(elementByRef).sort().join() !== "download,save,settings,share") {
    throw new Error(`could not map refs to buttons: ${JSON.stringify(elementByRef)}`);
  }

  // Direct page.read timing, with and without the contact sheet.
  const read = async (vision) => {
    const started = performance.now();
    const observation = await harness.readPage(
      tabNumber,
      vision ? { semanticObservation: true, semanticVision: true } : { semanticObservation: true },
    );
    return { ms: performance.now() - started, observation };
  };
  const reads = { text: [], vision: [] };
  let sheet;
  for (let index = 0; index < readSamples; index++) {
    reads.text.push((await read(false)).ms);
    const sample = await read(true);
    reads.vision.push(sample.ms);
    sheet = sample.observation.vision;
  }
  if (sheet.image) writeFileSync(join(outDir, "contact-sheet.png"), Buffer.from(sheet.image.data, "base64"));

  const runs = [];
  for (const model of models) {
    for (const vision of [false, true]) {
      for (const command of ["find", "act"]) {
        for (const query of QUERIES) {
          for (let index = 0; index < repeat; index++) {
            await reset();
            const args = command === "find"
              ? ["semantic.find", query.find]
              : ["semantic.act", query.act, "--allow-write", "--max-steps", "1"];
            const started = performance.now();
            const result = await surfJson(...args, "--model", model, "--tab-id", tabId, ...(vision ? ["--vision"] : []));
            const wallMs = Math.round(performance.now() - started);
            const decisionRef = command === "find"
              ? (result.decision?.label && result.decision.label !== "none" ? result.decision.label : null)
              : (result.trace?.[0]?.ref || result.concreteDecision?.ref || null);
            const decisionProbability = command === "find" ? result.decision?.probability : (result.trace?.[0]?.logicalProbability ?? result.decision?.probability);
            const picked = decisionRef ? elementByRef[decisionRef] ?? decisionRef : null;
            const executed = command === "act" ? await clicked() : (result.status === "found" ? elementByRef[result.candidate?.id] : null);
            runs.push({
              model, vision, command, query: command === "find" ? query.find : query.act, expected: query.target,
              status: result.status ?? null, stopReason: result.stopReason ?? null, error: result.error ?? null,
              picked, pickedProbability: decisionProbability ?? null, executed,
              correctPick: picked === query.target, correctResult: executed === query.target,
              wrongResult: Boolean(executed && executed !== query.target),
              tile: Boolean(result.candidate?.tile || result.trace?.[0]?.tile || result.concreteDecision?.tile),
              visionCounts: result.vision ?? null, providerCalls: result.providerCalls ?? null,
              providerLatencyMs: result.providerLatencyMs ?? null, wallMs,
            });
            process.stderr.write(".");
          }
        }
      }
    }
  }
  process.stderr.write("\n");

  const summary = [];
  for (const model of models) {
    for (const vision of [false, true]) {
      for (const command of ["find", "act"]) {
        for (const icons of [true, false]) {
          const set = runs.filter((run) => run.model === model && run.vision === vision && run.command === command && (run.expected !== "save") === icons);
          summary.push({
            model, vision, command, targets: icons ? "icons" : "labeled",
            runs: set.length,
            correctPick: set.filter((run) => run.correctPick).length,
            correctResult: set.filter((run) => run.correctResult).length,
            wrongResult: set.filter((run) => run.wrongResult).length,
            errors: set.filter((run) => run.error).length,
            providerLatencyMedianMs: median(set.map((run) => run.providerLatencyMs).filter(Number.isFinite)),
          });
        }
      }
    }
  }
  const output = {
    date: new Date().toISOString(),
    chrome: await harness.browser.version(),
    viewport,
    repeat,
    elementByRef,
    sheet: sheet && { tiles: sheet.tiles, skipped: sheet.skipped, pngBytes: sheet.image ? Buffer.from(sheet.image.data, "base64").length : 0 },
    pageRead: {
      samples: readSamples,
      textMs: { median: median(reads.text), p95: p95(reads.text) },
      visionMs: { median: median(reads.vision), p95: p95(reads.vision) },
      raw: reads,
    },
    summary,
    runs,
  };
  writeFileSync(join(outDir, "vision-eval.json"), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ pageRead: { text: output.pageRead.textMs, vision: output.pageRead.visionMs }, sheet: output.sheet, summary }, null, 2));
} catch (error) {
  failure = error;
} finally {
  await harness?.close();
}
if (failure) throw failure;
