/**
 * AI Studio Web Client for surf-cli
 *
 * CDP-based client for aistudio.google.com using browser automation.
 * Provides access to Gemini models with AI Studio's system prompt
 * and configuration (temperature 1.0, high thinking effort).
 *
 * DOM reference (as of Feb 2026):
 *   - Prompt input: textbox[placeholder*="Start typing"] or role="textbox"
 *   - Submit: button[type="submit"] (disabled until text entered)
 *   - Submit shortcut: Cmd+Enter (macOS) / Ctrl+Enter
 *   - Model selector: button containing model name, opens dropdown
 *   - System instructions: expandable section
 */

const {
  normalizeModelString,
  buildAiStudioUrl,
  delay,
  buildClickDispatcher,
  hasRequiredCookies,
  extractGenerateEntries,
} = require("./aistudio-parser.cjs");

const {
  readCurrentModelInfo,
  waitForModelToApply,
  closeModelSelectorIfOpen,
  selectModel,
} = require("./aistudio-model.cjs");

const {
  waitForGenerateResponseFromNetwork,
  waitForResponse,
} = require("./aistudio-response.cjs");
const { raceAbort, throwIfAborted } = require("./abort.cjs");

const DEFAULT_MODEL = "gemini-3.1-pro-preview";

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

async function waitForPageLoad(cdp, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await evaluate(cdp, "document.readyState");
    if (ready === "complete" || ready === "interactive") {
      await delay(2500);
      return;
    }
    await delay(100);
  }
  throw new Error("Page did not load in time");
}

async function waitForStudioReady(cdp, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const state = await evaluate(cdp, `(() => {
      const url = location.href;
      const isLoginPage = url.includes('accounts.google.com') || url.includes('/signin');
      const isStudioPage = url.includes('aistudio.google.com');

      const isVisible = (el) => Boolean(el && (el.offsetParent !== null || el.getClientRects().length > 0));

      const candidates = Array.from(document.querySelectorAll('[role="textbox"], textarea'))
        .filter((el) => isVisible(el));

      const byPlaceholder = (el) => {
        const placeholder = (el.getAttribute && el.getAttribute('placeholder') ? el.getAttribute('placeholder') : '') || '';
        const p = placeholder.toLowerCase();
        return p.includes('prompt') || p.includes('start typing') || p.includes('enter');
      };

      const promptInput = candidates.find(byPlaceholder) || (candidates.length ? candidates[candidates.length - 1] : null);

      return {
        ready: isStudioPage && !!promptInput,
        hasInput: !!promptInput,
        isStudioPage,
        isLoginPage,
        url
      };
    })()`);

    if (state && state.ready) {
      return state;
    }

    if (state && state.isLoginPage) {
      throw new Error("Redirected to login page - sign into Google in Chrome first");
    }

    await delay(300);
  }

  throw new Error("AI Studio chat input not found - page may not have loaded correctly");
}

async function enableUnformattedMarkdownView(cdp, log = () => {}, timeoutMs = 8000) {
  try {
    const alreadyEnabled = await evaluate(cdp, `(() => {
      const t = (document.body && document.body.innerText ? document.body.innerText : '').toLowerCase();
      return t.includes('show conversation with markdown formatting') || t.includes('raw mode');
    })()`);

    if (alreadyEnabled) {
      log('Markdown toggle: already enabled (detected on page)');
      return { success: true, alreadyEnabled: true, detected: true };
    }
  } catch {
    // Ignore detection failures and fall back to menu interaction
  }

  const openMenu = await evaluate(cdp, `(() => {
    ${buildClickDispatcher()}
    const buttons = Array.from(document.querySelectorAll('button'));
    const menuBtn = buttons.find(b => {
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      const text = (b.textContent || '').toLowerCase();
      return label.includes('view more actions') || text.includes('view more actions');
    });
    if (!menuBtn) return { success: false, error: 'View more actions button not found' };
    dispatchClickSequence(menuBtn);
    return { success: true };
  })()`);

  if (!openMenu || !openMenu.success) {
    log(`Markdown toggle: ${openMenu?.error || 'menu not available'}`);
    return { success: false, reason: openMenu?.error || 'menu not available' };
  }

  const deadline = Date.now() + timeoutMs;
  let result = null;

  while (Date.now() < deadline) {
    result = await evaluate(cdp, `(() => {
      ${buildClickDispatcher()}

      const menu = document.querySelector('[role="menu"]');
      if (!menu) return { ready: false };

      const items = Array.from(menu.querySelectorAll('button,[role="menuitem"]'));
      const normalize = (s) => (s || '').toLowerCase().replace(/\\s+/g, ' ').trim();

      const target = items.find(el => {
        const t = normalize(el.textContent || '');
        return t.includes('raw mode') || t.includes('raw output') || t.includes('viewing raw output');
      });

      if (!target) {
        return {
          ready: true,
          found: false,
          candidates: items.slice(0, 6).map(el => normalize(el.textContent || '').slice(0, 80)),
        };
      }

      const label = normalize(target.textContent || '');
      const ariaChecked = target.getAttribute('aria-checked');
      const ariaPressed = target.getAttribute('aria-pressed');
      const isEnabled = ariaChecked === 'true' || ariaPressed === 'true' || label.includes('check');

      if (!isEnabled) {
        dispatchClickSequence(target);
      }

      return {
        ready: true,
        found: true,
        label: label,
        isEnabled: isEnabled,
        clicked: !isEnabled,
      };
    })()`);

    if (result && result.ready) {
      break;
    }

    await delay(150);
  }

  await evaluate(cdp, `(() => {
    const esc = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true });
    document.dispatchEvent(esc);
  })()`).catch(() => {});

  if (!result || !result.ready) {
    log('Markdown toggle: menu did not appear');
    return { success: false, reason: 'menu did not appear' };
  }

  if (!result.found) {
    log(`Markdown toggle: Raw Mode item not found (candidates: ${(result.candidates || []).join(' | ')})`);
    return { success: false, reason: 'raw mode item not found' };
  }

  if (result.isEnabled) {
    log('Markdown toggle: already enabled (Raw Mode)');
    return { success: true, alreadyEnabled: true };
  }

  if (result.clicked) {
    log('Markdown toggle: enabled (Raw Mode)');
    await delay(200);
    return { success: true, enabled: true };
  }

  log('Markdown toggle: not enabled (unexpected)');
  return { success: false, reason: 'unexpected raw mode toggle state' };
}

async function typePrompt(cdp, inputCdp, prompt) {
  const focused = await evaluate(cdp, `(() => {
    ${buildClickDispatcher()}

    const isVisible = (el) => Boolean(el && (el.offsetParent !== null || el.getClientRects().length > 0));

    const candidates = Array.from(document.querySelectorAll('[role="textbox"], textarea'))
      .filter((el) => isVisible(el));

    const byPlaceholder = (el) => {
      const placeholder = (el.getAttribute && el.getAttribute('placeholder') ? el.getAttribute('placeholder') : '') || '';
      const p = placeholder.toLowerCase();
      return p.includes('prompt') || p.includes('start typing') || p.includes('enter');
    };

    const promptInput = candidates.find(byPlaceholder) || (candidates.length ? candidates[candidates.length - 1] : null);

    if (promptInput) {
      dispatchClickSequence(promptInput);
      promptInput.focus?.();
      return { success: true, method: byPlaceholder(promptInput) ? 'placeholder-match' : 'visible-textbox-fallback' };
    }

    return { success: false, error: 'Prompt input not found' };
  })()`);

  if (!focused || !focused.success) {
    throw new Error(`Could not focus prompt input: ${focused?.error || 'unknown'}`);
  }

  await delay(300);

  await inputCdp("Input.insertText", { text: prompt });
  await delay(300);
}

async function submitPrompt(cdp, inputCdp) {
  await delay(200);

  const clicked = await evaluate(cdp, `(() => {
    ${buildClickDispatcher()}
    const submitBtn = document.querySelector('button[type="submit"]:not([disabled])');
    if (submitBtn) {
      dispatchClickSequence(submitBtn);
      return { success: true, method: 'submit-button' };
    }
    return { success: false };
  })()`);

  if (clicked && clicked.success) {
    await delay(500);
    return;
  }

  const modifiers = process.platform === "darwin" ? 4 : 2;
  await inputCdp("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    modifiers,
    text: "\r",
  });
  await inputCdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    modifiers,
  });

  await delay(500);
}

async function query(options) {
  const {
    prompt,
    model = DEFAULT_MODEL,
    timeout = 300000,
    getCookies,
    createTab,
    closeTab,
    cdpEvaluate,
    cdpCommand,
    readNetworkEntries,
    log = () => {},
    signal,
  } = options;
  throwIfAborted(signal);

  const guardedReadNetworkEntries = readNetworkEntries
    ? (...args) => raceAbort(() => readNetworkEntries(...args), signal)
    : readNetworkEntries;
  const startTime = Date.now();
  log("Starting AI Studio query");

  const resolvedModel = normalizeModelString(model) || DEFAULT_MODEL;
  log(`Requested model: ${resolvedModel}`);

  const { cookies } = await raceAbort(getCookies, signal);
  if (!hasRequiredCookies(cookies)) {
    throw new Error("Google login required - sign into Google in Chrome first");
  }
  log(`Got ${cookies.length} cookies`);

  const createdUrl = buildAiStudioUrl(resolvedModel);
  const tabInfo = await raceAbort(() => createTab(createdUrl), signal);
  const { tabId } = tabInfo || {};

  if (!tabId) {
    throw new Error(`Failed to create AI Studio tab: ${JSON.stringify(tabInfo)}`);
  }
  log(`Created tab ${tabId}`);

  const cdp = (expr) => raceAbort(() => cdpEvaluate(tabId, expr), signal);
  const inputCdp = (method, params) => raceAbort(() => cdpCommand(tabId, method, params), signal);

  let baselineGenerateEntryIds = new Set();

  try {
    await raceAbort(waitForPageLoad(cdp), signal);
    log("Page loaded");

    await raceAbort(waitForStudioReady(cdp), signal);
    log("AI Studio ready");

    if (typeof readNetworkEntries === 'function') {
      try {
        const baselineNetwork = await guardedReadNetworkEntries(tabId);
        const baselineEntries = Array.isArray(baselineNetwork?.entries)
          ? baselineNetwork.entries
          : Array.isArray(baselineNetwork?.requests)
            ? baselineNetwork.requests
            : [];

        baselineGenerateEntryIds = new Set(
          extractGenerateEntries(baselineEntries)
            .map((entry) => entry.id)
            .filter(Boolean)
        );

        log(`Network baseline ready (${baselineGenerateEntryIds.size} GenerateContent entries)`);
      } catch (e) {
        if (signal?.aborted) throw e;
        log(`Network baseline failed: ${e.message || e}`);
      }
    }

    try {
      await enableUnformattedMarkdownView(cdp, log);
    } catch (e) {
      if (signal?.aborted) throw e;
      log(`Markdown toggle failed: ${e.message}`);
    }

    const usedUrlParam = createdUrl.includes('?model=');

    let runtimeUrl = await evaluate(cdp, 'location.href');
    let runtimeModelParam = await evaluate(cdp, `(() => {
      try {
        return new URLSearchParams(location.search).get('model') || '';
      } catch {
        return '';
      }
    })()`);

    if (usedUrlParam && !runtimeModelParam) {
      try {
        log(`Runtime model param missing; retrying direct navigation: ${createdUrl}`);
        await inputCdp('Page.navigate', { url: createdUrl });
        await raceAbort(waitForPageLoad(cdp), signal);
        await raceAbort(waitForStudioReady(cdp), signal);
        runtimeUrl = await evaluate(cdp, 'location.href');
        runtimeModelParam = await evaluate(cdp, `(() => {
          try {
            return new URLSearchParams(location.search).get('model') || '';
          } catch {
            return '';
          }
        })()`);
      } catch (e) {
        if (signal?.aborted) throw e;
        log(`Direct model URL navigation retry failed: ${e.message || e}`);
      }
    }

    if (usedUrlParam) {
      log(`Model via URL param: requested="${resolvedModel}", runtimeParam="${runtimeModelParam || '(none)'}"`);
    } else {
      log(`Model via UI (no URL param): requested="${resolvedModel}"`);
    }

    const currentModelInfo = await readCurrentModelInfo(cdp).catch((error) => {
      if (signal?.aborted) throw error;
      return { found: false, label: '', modelId: '' };
    });

    log(`AI Studio URL: ${runtimeUrl}`);
    if (currentModelInfo?.label) {
      log(`AI Studio UI model label: ${currentModelInfo.label.slice(0, 120)}`);
    }
    if (currentModelInfo?.modelId) {
      log(`AI Studio UI model id: ${currentModelInfo.modelId}`);
    }

    let modelApplied = false;

    if (usedUrlParam && runtimeModelParam === resolvedModel) {
      modelApplied = true;
      log(`Model confirmed by URL param: ${runtimeModelParam}`);
    }

    if (!modelApplied && usedUrlParam) {
      try {
        modelApplied = await raceAbort(waitForModelToApply(cdp, resolvedModel, log), signal);
      } catch (e) {
        if (signal?.aborted) throw e;
        log(`Model apply wait failed: ${e.message}`);
      }
    }

    if (!modelApplied) {
      try {
        log(`Attempting UI model selection fallback: ${resolvedModel}`);
        await raceAbort(selectModel(cdp, resolvedModel, log), signal);
        modelApplied = await raceAbort(waitForModelToApply(cdp, resolvedModel, log, 10000), signal);
      } catch (e) {
        if (signal?.aborted) throw e;
        log(`UI model selection fallback failed: ${e.message}`);
      }
    }

    await raceAbort(closeModelSelectorIfOpen(cdp, log), signal);

    await raceAbort(typePrompt(cdp, inputCdp, prompt), signal);
    log("Prompt typed");

    await raceAbort(submitPrompt(cdp, inputCdp), signal);
    log("Submitted, waiting for response...");

    let response;

    if (typeof readNetworkEntries === 'function') {
      try {
        const networkResult = await waitForGenerateResponseFromNetwork({
          tabId,
          readNetworkEntries: guardedReadNetworkEntries,
          timeoutMs: timeout,
          baselineEntryIds: baselineGenerateEntryIds,
          prompt,
          signal,
          log,
        });

        response = {
          text: networkResult.text,
          thinkingTime: null,
        };

        log(
          `Network response: ${response.text.length} chars` +
          `${networkResult.requestId ? ` (request ${networkResult.requestId})` : ''}`
        );
      } catch (networkErr) {
        if (signal?.aborted) throw networkErr;
        log(`Network extraction failed, falling back to DOM: ${networkErr.message || networkErr}`);

        const remainingTimeoutMs = Math.max(timeout - (Date.now() - startTime), 10000);
        response = await raceAbort(waitForResponse(cdp, remainingTimeoutMs, prompt, log), signal);
      }
    } else {
      response = await raceAbort(waitForResponse(cdp, timeout, prompt, log), signal);
    }

    const thinkingInfo = response.thinkingTime ? ` (thought for ${response.thinkingTime}s)` : '';
    log(`Response: ${response.text.length} chars${thinkingInfo}`);

    return {
      response: response.text,
      model: resolvedModel,
      thinkingTime: response.thinkingTime,
      tookMs: Date.now() - startTime,
    };
  } finally {
    try {
      await closeTab(tabId);
    } catch (error) {
      log(`Failed to close AI Studio tab ${tabId}: ${error?.message || error}`);
    }
  }
}

module.exports = {
  query,
};
