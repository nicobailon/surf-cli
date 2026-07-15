const fs = require("fs");
const { raceAbort, throwIfAborted } = require("./abort.cjs");
const { execFileSync } = require("child_process");
const {
  delay,
  hasRequiredCookies,
  normalizeModelString,
  buildClickDispatcher,
} = require("./aistudio-parser.cjs");

const AISTUDIO_APPS_URL = "https://aistudio.google.com/apps";
const DEFAULT_MODEL = "gemini-3-flash-preview";
const BUILD_LAYOUT_ERROR = "AI Studio Build page layout changed — check selectors.";

async function evaluate(cdp, expression) {
  const result = await cdp(expression);
  if (result.exceptionDetails) {
    const desc = result.exceptionDetails.exception?.description ||
                 result.exceptionDetails.text ||
                 "Evaluation failed";
    throw new Error(desc);
  }
  if (result.error) {
    throw new Error(result.error);
  }
  return result.result?.value;
}

function parseDurationSeconds(value) {
  const n = parseInt(String(value || "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function tokenizeModelInput(model) {
  return String(model || "")
    .toLowerCase()
    .split("-")
    .map((part) => part.trim())
    .filter(Boolean);
}

function tokenizeModelOption(optionText) {
  return String(optionText || "")
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[^a-z0-9.\s]/g, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function pickBestModelOption(options, userModel) {
  const userTokens = tokenizeModelInput(userModel);
  if (userTokens.length === 0) return null;

  const candidates = options.filter((option) => {
    const optionTokens = tokenizeModelOption(option.text);
    if (optionTokens.length === 0) return false;
    return userTokens.every((token) => optionTokens.includes(token));
  });

  if (candidates.length === 0) return null;

  const sorted = candidates.sort((a, b) => {
    const aDefault = /\bdefault\b/i.test(a.text);
    const bDefault = /\bdefault\b/i.test(b.text);
    if (aDefault !== bDefault) return aDefault ? 1 : -1;
    if (a.text.length !== b.text.length) return a.text.length - b.text.length;
    return a.text.localeCompare(b.text);
  });

  return sorted[0];
}

async function waitForBuildPageReady(cdp, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let sawTextareaAt = 0;

  while (Date.now() < deadline) {
    const state = await evaluate(cdp, `(() => {
      const url = location.href;
      const login = url.includes("accounts.google.com") || url.includes("/signin");
      const textarea = document.querySelector("ms-applet-generator-form textarea.prompt-textarea")
        || Array.from(document.querySelectorAll("textarea")).find((el) => {
          const ph = (el.getAttribute("placeholder") || "").toLowerCase();
          return ph.includes("describe your idea");
        });
      const buildButton = Array.from(document.querySelectorAll("ms-applet-generator-form button"))
        .find((btn) => (btn.textContent || "").toLowerCase().includes("build"));

      return {
        login,
        hasTextarea: !!textarea,
        hasBuildButton: !!buildButton,
      };
    })()`);

    if (state?.login) {
      throw new Error("Sign into Google in Chrome first.");
    }

    if (state?.hasTextarea) {
      if (!sawTextareaAt) sawTextareaAt = Date.now();
      if (state.hasBuildButton) return;
      if (Date.now() - sawTextareaAt > 10000) {
        throw new Error(BUILD_LAYOUT_ERROR);
      }
    }

    await delay(250);
  }

  throw new Error(BUILD_LAYOUT_ERROR);
}

async function selectModelInAdvancedSettings(cdp, inputCdp, requestedModel, log) {
  const openResult = await evaluate(cdp, `(() => {
    ${buildClickDispatcher()}
    const btn = document.querySelector("button.model-button");
    if (!btn) return { success: false };
    dispatchClickSequence(btn);
    return { success: true };
  })()`);

  if (!openResult?.success) {
    throw new Error(BUILD_LAYOUT_ERROR);
  }

  const dialogDeadline = Date.now() + 8000;
  while (Date.now() < dialogDeadline) {
    const dialogOpen = await evaluate(cdp, "Boolean(document.querySelector('mat-dialog-container'))");
    if (dialogOpen) break;
    await delay(150);
  }

  const dialogExists = await evaluate(cdp, "Boolean(document.querySelector('mat-dialog-container'))");
  if (!dialogExists) {
    throw new Error(BUILD_LAYOUT_ERROR);
  }

  const dropdownClicked = await evaluate(cdp, `(() => {
    ${buildClickDispatcher()}
    const dialog = document.querySelector("mat-dialog-container");
    if (!dialog) return { success: false };
    const trigger = dialog.querySelector('mat-select[role="combobox"]');
    if (!trigger) return { success: false };
    dispatchClickSequence(trigger);
    return { success: true };
  })()`);

  if (!dropdownClicked?.success) {
    throw new Error(BUILD_LAYOUT_ERROR);
  }

  const optionDeadline = Date.now() + 8000;
  let options = [];
  while (Date.now() < optionDeadline) {
    const currentOptions = await evaluate(cdp, `(() => {
      return Array.from(document.querySelectorAll('mat-option[role="option"]')).map((el) => {
        return { text: (el.textContent || "").replace(/\\s+/g, " ").trim() };
      });
    })()`);

    if (Array.isArray(currentOptions) && currentOptions.length > 0) {
      options = currentOptions;
      break;
    }
    await delay(150);
  }

  const match = pickBestModelOption(
    options.map((option, index) => ({ ...option, index })),
    requestedModel
  );

  if (!match) {
    log(`Model '${requestedModel}' not found in dropdown, using default`);
    await pressEscape(inputCdp);
    await delay(120);
    await pressEscape(inputCdp);
    await delay(200);
    return false;
  }

  const selected = await evaluate(cdp, `(() => {
    ${buildClickDispatcher()}
    const options = Array.from(document.querySelectorAll('mat-option[role="option"]'));
    const target = options[${match.index}];
    if (!target) return { success: false };
    dispatchClickSequence(target);
    return { success: true };
  })()`);

  if (!selected?.success) {
    throw new Error(BUILD_LAYOUT_ERROR);
  }

  await delay(150);
  await pressEscape(inputCdp);
  await delay(120);
  await pressEscape(inputCdp);
  await delay(200);
  return true;
}

async function typePromptAndBuild(cdp, inputCdp, prompt) {
  const focused = await evaluate(cdp, `(() => {
    ${buildClickDispatcher()}
    const input = document.querySelector("ms-applet-generator-form textarea.prompt-textarea");
    if (!input) return { success: false };
    dispatchClickSequence(input);
    input.focus?.();
    return { success: true };
  })()`);

  if (!focused?.success) {
    throw new Error(BUILD_LAYOUT_ERROR);
  }

  await delay(200);
  await inputCdp("Input.insertText", { text: String(prompt || "") });
  await delay(250);

  const deadline = Date.now() + 10000;
  let ready = false;
  while (Date.now() < deadline) {
    const enabled = await evaluate(cdp, `(() => {
      const btn = Array.from(document.querySelectorAll("ms-applet-generator-form button"))
        .find((b) => (b.textContent || "").toLowerCase().includes("build"));
      return Boolean(btn && btn.getAttribute("aria-disabled") === "false");
    })()`);

    if (enabled) { ready = true; break; }
    await delay(150);
  }

  if (!ready) {
    throw new Error(BUILD_LAYOUT_ERROR);
  }

  const clicked = await evaluate(cdp, `(() => {
    ${buildClickDispatcher()}
    const btn = Array.from(document.querySelectorAll("ms-applet-generator-form button"))
      .find((b) => (b.textContent || "").toLowerCase().includes("build"));
    if (!btn) return { success: false };
    dispatchClickSequence(btn);
    return { success: true };
  })()`);

  if (!clicked?.success) {
    throw new Error(BUILD_LAYOUT_ERROR);
  }
}

async function waitForBuildCompletion(cdp, timeoutMs, log = () => {}) {
  const deadline = Date.now() + timeoutMs;
  let lastProgress = "";

  while (Date.now() < deadline) {
    const state = await evaluate(cdp, `(() => {
      const url = location.href;
      const isLogin = url.includes("accounts.google.com") || url.includes("/signin");
      const commandTexts = Array.from(document.querySelectorAll("span.command-text"))
        .map((el) => (el.textContent || "").replace(/\\s+/g, " ").trim())
        .filter(Boolean);
      const lowerCommands = commandTexts.map((t) => t.toLowerCase());
      const hasBuilt = commandTexts.some((text) => text.trim() === "Built");
      const hasSpinner = Boolean(document.querySelector("mat-spinner, mat-progress-spinner"));
      const turnHeader = document.querySelector(".turn-header");
      const turnHeaderText = (turnHeader?.textContent || "").replace(/\\s+/g, " ").trim();
      const durationText = (turnHeader?.querySelector(".duration")?.textContent || "").trim();
      const snack = Array.from(document.querySelectorAll("mat-snack-bar-container, simple-snack-bar, .mat-mdc-snack-bar-label"))
        .map((el) => (el.textContent || "").replace(/\\s+/g, " ").trim())
        .find((text) => /failed|error|exception|quota|limit/i.test(text || "")) || "";
      const commandError = commandTexts.find((text) => /failed|error/i.test(text)) || "";
      const bannerError = Array.from(document.querySelectorAll("[role='alert'], [class*='error'], [class*='Error']"))
        .map((el) => (el.textContent || "").replace(/\\s+/g, " ").trim())
        .find((text) => /failed|error|exception/i.test(text || "")) || "";
      const errorText = snack || commandError || bannerError || "";
      const runningText = /running/i.test(turnHeaderText);

      return {
        isLogin,
        hasBuilt,
        hasSpinner,
        runningText,
        commandTexts,
        errorText,
        durationText,
        lowerCommands,
      };
    })()`);

    if (state?.isLogin) {
      throw new Error("Sign into Google in Chrome first.");
    }

    if (state?.errorText) {
      throw new Error(`Build failed: ${state.errorText}`);
    }

    const commandTexts = Array.isArray(state?.commandTexts) ? state.commandTexts : [];
    const progress = commandTexts.join(" | ");
    if (progress && progress !== lastProgress) {
      lastProgress = progress;
      log(progress);
    }

    if (state?.hasBuilt) {
      const duration = parseDurationSeconds(state?.durationText);
      return {
        buildDuration: duration,
      };
    }

    if (!state?.hasSpinner && !state?.runningText && state?.lowerCommands?.includes("built")) {
      const duration = parseDurationSeconds(state?.durationText);
      return {
        buildDuration: duration,
      };
    }

    await delay(500);
  }

  const timeoutSec = Math.floor(timeoutMs / 1000);
  throw new Error(`Build did not complete within ${timeoutSec}s. Check aistudio.google.com/apps for status.`);
}

async function dispatchMouseHoverClick(inputCdp, x, y) {
  await inputCdp("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
    button: "none",
  });
  await delay(40);
  await inputCdp("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await delay(40);
  await inputCdp("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
}

async function pressEscape(inputCdp) {
  await inputCdp("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  await inputCdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
}

async function activateCodeTab(cdp, inputCdp) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const info = await evaluate(cdp, `(() => {
      const btn = document.querySelector('button[data-test-id="code-editor-toggle"]');
      if (!btn) return { found: false };
      const rect = btn.getBoundingClientRect();
      const selected = btn.getAttribute("aria-selected") === "true";
      return {
        found: true,
        selected,
        x: rect.left + (rect.width / 2),
        y: rect.top + (rect.height / 2),
      };
    })()`);

    if (!info?.found) {
      throw new Error("Could not switch to Code view.");
    }

    if (info.selected) {
      return;
    }

    await dispatchMouseHoverClick(inputCdp, info.x, info.y);
    await delay(250);

    const activated = await evaluate(cdp, `(() => {
      const btn = document.querySelector('button[data-test-id="code-editor-toggle"]');
      return Boolean(btn && btn.getAttribute("aria-selected") === "true");
    })()`);

    if (activated) {
      return;
    }

    if (attempt === 0) {
      await pressEscape(inputCdp);
      await delay(200);
    }
  }

  throw new Error("Could not switch to Code view.");
}

async function waitForDownloadButton(cdp, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await evaluate(cdp, `(() => {
      const btn = document.querySelector('button[aria-label="Download app"]');
      if (!btn) return false;
      const visible = btn.offsetParent !== null || btn.getClientRects().length > 0;
      return Boolean(visible);
    })()`);
    if (found) return;
    await delay(120);
  }
  throw new Error("Download button not found in Code view.");
}

async function clickDownloadButton(cdp) {
  const clicked = await evaluate(cdp, `(() => {
    ${buildClickDispatcher()}
    const btn = document.querySelector('button[aria-label="Download app"]');
    if (!btn) return false;
    dispatchClickSequence(btn);
    return true;
  })()`);

  if (!clicked) {
    throw new Error("Download button not found in Code view.");
  }
}

async function waitForDownloadComplete(searchDownloads, sinceId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const downloads = await searchDownloads({
      orderBy: ["-startTime"],
      limit: 10,
    });
    const items = Array.isArray(downloads) ? downloads : [];

    const completed = items.find((d) => d.id > sinceId && d.state === "complete");
    if (completed) return completed.filename;

    const failed = items.find((d) => d.id > sinceId && d.state === "interrupted");
    if (failed) throw new Error(`Download failed: ${failed.error || "unknown error"}`);

    await delay(500);
  }
  throw new Error("Could not download zip — check Chrome downloads.");
}

function extractZip(zipPath, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  if (process.platform === "win32") {
    execFileSync("tar", ["-xf", zipPath, "-C", outputDir], { stdio: "pipe" });
    return;
  }
  execFileSync("unzip", ["-o", zipPath, "-d", outputDir], { stdio: "pipe" });
}

async function build({
  prompt,
  model,
  output,
  keepOpen,
  timeout,
  getCookies,
  createTab,
  closeTab,
  cdpEvaluate,
  cdpCommand,
  searchDownloads,
  log = () => {},
  signal,
}) {
  throwIfAborted(signal);
  const guardedSearchDownloads = (...args) => raceAbort(() => searchDownloads(...args), signal);
  const startedAt = Date.now();
  const timeoutMs = Number.isFinite(timeout) ? timeout : 600000;
  const requestedModel = normalizeModelString(model || "");
  const resolvedModel = requestedModel || DEFAULT_MODEL;

  const cookieResult = await raceAbort(getCookies, signal);
  const cookies = cookieResult?.cookies || [];
  if (!hasRequiredCookies(cookies)) {
    throw new Error("Sign into Google in Chrome first.");
  }

  const tabInfo = await raceAbort(() => createTab(AISTUDIO_APPS_URL), signal);
  const tabId = tabInfo?.tabId;
  if (!tabId) {
    throw new Error(`Failed to create AI Studio tab: ${JSON.stringify(tabInfo)}`);
  }

  const cdp = (expression) => raceAbort(() => cdpEvaluate(tabId, expression), signal);
  const inputCdp = (method, params) => raceAbort(() => cdpCommand(tabId, method, params), signal);

  let buildDuration = null;
  let zipPath = null;
  let extractedPath;
  let modelUsed = resolvedModel;

  try {
    await raceAbort(waitForBuildPageReady(cdp, 30000), signal);

    if (requestedModel) {
      const applied = await selectModelInAdvancedSettings(cdp, inputCdp, requestedModel, log);
      modelUsed = applied ? requestedModel : DEFAULT_MODEL;
    }

    await typePromptAndBuild(cdp, inputCdp, prompt);
    const completion = await raceAbort(waitForBuildCompletion(cdp, timeoutMs, log), signal);
    buildDuration = completion.buildDuration;

    await raceAbort(activateCodeTab(cdp, inputCdp), signal);
    await raceAbort(waitForDownloadButton(cdp, 5000), signal);

    const beforeDownloads = await guardedSearchDownloads({
      limit: 1,
      orderBy: ["-startTime"],
    });
    const latestIdBefore = beforeDownloads?.[0]?.id || 0;

    await raceAbort(clickDownloadButton(cdp), signal);
    zipPath = await waitForDownloadComplete(guardedSearchDownloads, latestIdBefore, 30000);

    if (output) {
      const outputDir = String(output);
      try {
        extractZip(zipPath, outputDir);
        extractedPath = outputDir;
      } catch (err) {
        const stderr = Buffer.isBuffer(err?.stderr) ? err.stderr.toString("utf8").trim() : "";
        const detail = stderr || err?.message || "Unknown extraction error";
        log(`Failed to extract zip: ${detail}`);
      }
    }

    return {
      zipPath,
      ...(extractedPath ? { extractedPath } : {}),
      model: modelUsed,
      buildDuration: Number.isFinite(buildDuration) ? buildDuration : Math.floor((Date.now() - startedAt) / 1000),
      tookMs: Date.now() - startedAt,
    };
  } finally {
    if (!keepOpen || signal?.aborted) {
      try {
        await closeTab(tabId);
      } catch (error) {
        log(`Failed to close AI Studio Build tab ${tabId}: ${error?.message || error}`);
      }
    }
  }
}

module.exports = { build };
