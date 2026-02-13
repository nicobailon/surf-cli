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

const AISTUDIO_URL = "https://aistudio.google.com/prompts/new_chat";
const GENERATE_CONTENT_URL_FRAGMENT =
  "google.internal.alkali.applications.makersuite.v1.MakerSuiteService/GenerateContent";

// NOTE: For AI Studio, the URL-based model selector is only reliable when we pass
// the *exact* model id the UI expects (e.g. "gemini-3-pro-preview").
// We intentionally do NOT try to map friendly aliases like "gemini-3-pro" -> "...-preview"
// because those aliases have been unreliable in the browser UI
const DEFAULT_MODEL = "gemini-3-pro-preview";

function normalizeModelString(model) {
  return String(model || "").trim().toLowerCase();
}

function buildAiStudioUrl(model) {
  const normalized = normalizeModelString(model);
  if (!normalized) return AISTUDIO_URL;

  // Only use the URL param when the caller passes a literal AI Studio model id.
  // If the model id is wrong/unknown, AI Studio will fall back to the last-selected
  // model in the UI, which is acceptable.
  const looksLikeUrlModelId =
    /^[a-z0-9-]+$/.test(normalized) && (normalized.includes("preview") || normalized.includes("latest"));

  if (!looksLikeUrlModelId) return AISTUDIO_URL;

  return `${AISTUDIO_URL}?model=${encodeURIComponent(normalized)}`;
}

// ============================================================================
// Helpers
// ============================================================================

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getNestedValue(value, pathParts, fallback) {
  let current = value;
  for (const part of pathParts) {
    if (current == null) return fallback;
    if (typeof part === 'number') {
      if (!Array.isArray(current)) return fallback;
      current = current[part];
    } else {
      if (typeof current !== 'object') return fallback;
      current = current[part];
    }
  }
  return current ?? fallback;
}

function buildClickDispatcher() {
  return `function dispatchClickSequence(target) {
    if (!target || !(target instanceof EventTarget)) return false;
    const types = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
    for (const type of types) {
      const common = { bubbles: true, cancelable: true, view: window };
      let event;
      if (type.startsWith('pointer') && 'PointerEvent' in window) {
        event = new PointerEvent(type, { ...common, pointerId: 1, pointerType: 'mouse' });
      } else {
        event = new MouseEvent(type, common);
      }
      target.dispatchEvent(event);
    }
    return true;
  }`;
}

function cleanAiStudioResponse(rawText, userPrompt = '') {
  if (!rawText) return '';

  // Lines that match exactly (full trimmed line, case-insensitive) are stripped
  // These are AI Studio UI chrome artifacts that can leak into DOM text extraction
  const bannedExact = new Set([
    'user',
    'model',
    'info',
    'warning',
    'close',
    'edit',
    'more_vert',
    'thumb_up',
    'thumb_down',
    'good response',
    'bad response',
    'rerun this turn',
    'open options',
    'running...',

    // Code block UI chrome from AI Studio (can leak from rendered mode)
    'code',
    'download',
    'content_copy',
    'expand_less',
    'expand_more',
  ]);

  const promptTrimmed = String(userPrompt || '').trim();

  let lines = String(rawText).split(/\r?\n/);

  // If the raw extraction includes both roles, keep only the last model segment
  // Raw Mode commonly renders as:
  //   User
  //   <prompt>
  //   Model
  //   <response>
  // plus occasional UI banners
  const lastModelIdx = (() => {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (String(lines[i] || '').trim().toLowerCase() === 'model') return i;
    }
    return -1;
  })();

  if (lastModelIdx !== -1 && lastModelIdx + 1 < lines.length) {
    lines = lines.slice(lastModelIdx + 1);
  }

  let inCodeFence = false;
  let previousWasBlank = false;

  const cleanedLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    const isFenceLine = trimmed.startsWith('```');

    // Fence lines: preserve exactly (minus trailing whitespace)
    if (isFenceLine) {
      inCodeFence = !inCodeFence;
      cleanedLines.push(line.replace(/[\t ]+$/g, ''));
      previousWasBlank = false;
      continue;
    }

    // Inside code fences: preserve indentation and blank lines
    if (inCodeFence) {
      cleanedLines.push(line.replace(/[\t ]+$/g, ''));
      previousWasBlank = false;
      continue;
    }

    // Outside code: drop UI-only lines and prompt echo
    if (trimmed.length === 0) {
      if (!previousWasBlank) {
        cleanedLines.push('');
        previousWasBlank = true;
      }
      continue;
    }

    if (bannedExact.has(lower)) continue;
    if (promptTrimmed && trimmed === promptTrimmed) continue;

    // Common AI Studio footer/disclaimer
    if (lower.includes('google ai models may make mistakes')) continue;
    if (lower.includes('double-check outputs')) continue;
    if (lower.startsWith('response ready')) continue;

    // Drive enable prompt (AI Studio UI banner)
    if (lower.includes('turn drive on for future conversations')) continue;
    if (lower.includes('your work is currently not being saved')) continue;
    if (lower.includes('enable google drive')) continue;

    // Remove inline UI icon tokens, but only outside code
    const withoutIcons = trimmed
      .replace(/\bthumb_up\b/g, '')
      .replace(/\bthumb_down\b/g, '')
      .replace(/\bmore_vert\b/g, '')
      .trim();

    if (withoutIcons.length === 0) continue;

    cleanedLines.push(withoutIcons);
    previousWasBlank = false;
  }

  // Trim leading/trailing blank lines
  while (cleanedLines.length > 0 && cleanedLines[0].trim().length === 0) cleanedLines.shift();
  while (cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1].trim().length === 0) cleanedLines.pop();

  return cleanedLines.join('\n');
}

function hasRequiredCookies(cookies) {
  if (!cookies || !Array.isArray(cookies)) return false;
  const sid = cookies.find(c => c.name === "__Secure-1PSID" && c.value);
  return Boolean(sid);
}

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

// ============================================================================
// Page State Functions
// ============================================================================

function extractModelKeywords(modelId) {
  const normalized = normalizeModelString(modelId);
  if (!normalized) return [];

  const ignored = new Set(["gemini", "preview", "latest"]);

  const tokens = normalized
    .split("-")
    .map(t => t.trim())
    .filter(Boolean)
    .filter(t => !ignored.has(t))
    .filter(t => !/^\d+(?:\.\d+)?$/.test(t));

  // Keep short-but-meaningful tokens like "pro"
  const keywords = tokens.filter(t => t.length >= 3);

  return Array.from(new Set(keywords));
}

async function readCurrentModelInfo(cdp) {
  return evaluate(cdp, `(() => {
    const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();

    const selector = document.querySelector('button.model-selector-card, .model-selector-card');
    if (!selector) {
      return { found: false, label: '', modelId: '' };
    }

    const raw = normalize(selector.textContent || '');
    const lower = raw.toLowerCase();
    const compact = lower.replace(/\s+/g, '');
    const modelIdMatch = compact.match(/gemini-[a-z0-9-]*(?:preview|latest)/) ||
      lower.match(/gemini-[a-z0-9-]*(?:preview|latest)/);

    return {
      found: true,
      label: lower,
      modelId: modelIdMatch ? modelIdMatch[0] : '',
    };
  })()`);
}

async function waitForModelToApply(cdp, requestedModel, log, timeoutMs = 15000) {
  const normalizedRequested = normalizeModelString(requestedModel);
  const keywords = extractModelKeywords(normalizedRequested);
  if (!normalizedRequested) return true;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await readCurrentModelInfo(cdp).catch(() => ({ found: false, label: '', modelId: '' }));

    const modelIdMatches = info.modelId && info.modelId === normalizedRequested;
    const keywordMatches = info.label && keywords.length > 0 && keywords.every(k => info.label.includes(k));

    if (modelIdMatches || keywordMatches) {
      log(
        `Model appears applied: requested=${normalizedRequested}` +
        `${info.modelId ? `, detected=${info.modelId}` : ''}` +
        `${info.label ? `, label=${info.label.slice(0, 120)}` : ''}`
      );
      return true;
    }

    await delay(250);
  }

  log(`Model did not appear to apply within ${timeoutMs}ms (requested=${normalizedRequested})`);
  return false;
}

async function waitForPageLoad(cdp, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await evaluate(cdp, "document.readyState");
    if (ready === "complete" || ready === "interactive") {
      // Extra wait for AI Studio's SPA to hydrate
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

      // Prefer the canonical prompt input, but fall back to any visible textbox/textarea.
      // (Placeholders can change; role="textbox" tends to be stable in AI Studio.)
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

// ============================================================================
// Display Options
// ============================================================================

async function enableUnformattedMarkdownView(cdp, log = () => {}, timeoutMs = 8000) {
  // AI Studio currently exposes this as “Raw Mode” under the “View more actions” menu.
  // When enabled, the conversation view shows the raw markdown source (including ``` fences)

  // Fast path: if the page already visibly advertises the inverse toggle, Raw Mode is on
  // (This avoids opening the menu on every request)
  try {
    const alreadyEnabled = await evaluate(cdp, `(() => {
      const t = (document.body && document.body.innerText ? document.body.innerText : '').toLowerCase();
      return t.includes('show conversation with markdown formatting') || t.includes('raw mode');
    })()`);

    if (alreadyEnabled) {
      log('Markdown toggle: already enabled (detected on page)');
      return { success: true, alreadyEnabled: true, detected: true };
    }
  } catch (e) {
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
    // Keep this evaluate small and robust; the Raw Mode menu item is in the light DOM
    // as a button[role=menuitem] inside [role=menu]
    result = await evaluate(cdp, `(() => {
      ${buildClickDispatcher()}

      const menu = document.querySelector('[role="menu"]');
      if (!menu) return { ready: false };

      const items = Array.from(menu.querySelectorAll('button,[role="menuitem"]'));
      const normalize = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

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

  // Close menu (Escape)
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

// ============================================================================
// Model Selection
// ============================================================================

async function closeModelSelectorIfOpen(cdp, log = () => {}) {
  const closed = await evaluate(cdp, `(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return false;

    const hasModelOptions = dialog.querySelector('button.content-button, [role="option"], mat-option, mat-list-item');
    if (!hasModelOptions) return false;

    const esc = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true });
    document.dispatchEvent(esc);
    return true;
  })()`).catch(() => false);

  if (closed) {
    log('Closed model selector dialog before continuing');
    await delay(150);
  }

  return Boolean(closed);
}

async function selectModel(cdp, desiredModel, log, timeoutMs = 10000) {
  const normalizedTargetModel = normalizeModelString(desiredModel);
  if (!normalizedTargetModel) return desiredModel;

  const openSelector = await evaluate(cdp, `(() => {
    ${buildClickDispatcher()}

    const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => Boolean(el && (el.offsetParent !== null || el.getClientRects().length > 0));

    const direct = document.querySelector('button.model-selector-card, .model-selector-card');
    if (isVisible(direct)) {
      dispatchClickSequence(direct);
      return { success: true, method: 'model-selector-card', currentModel: normalize(direct.textContent || '').slice(0, 120) };
    }

    const fallbackButtons = Array.from(document.querySelectorAll('button')).filter((b) => {
      if (!isVisible(b)) return false;
      const cls = (b.className || '').toString().toLowerCase();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      const text = normalize(b.textContent || '').toLowerCase();

      if (cls.includes('model-selector-card')) return true;
      if (aria.includes('model') && text.includes('gemini')) return true;
      return false;
    });

    if (fallbackButtons.length > 0) {
      const target = fallbackButtons[0];
      dispatchClickSequence(target);
      return { success: true, method: 'fallback-model-button', currentModel: normalize(target.textContent || '').slice(0, 120) };
    }

    return { success: false, error: 'Model selector button not found' };
  })()`);

  if (!openSelector || !openSelector.success) {
    log(`Model selector not found: ${openSelector?.error || 'unknown'}`);
    return desiredModel;
  }

  log(`Opened model selector via ${openSelector.method}: ${openSelector.currentModel || '(unknown)'}`);

  const deadline = Date.now() + timeoutMs;
  const targetToken = normalizedTargetModel.replace(/[^a-z0-9]/g, '');

  while (Date.now() < deadline) {
    const result = await evaluate(cdp, `(() => {
      ${buildClickDispatcher()}

      const target = ${JSON.stringify(normalizedTargetModel)};
      const targetToken = ${JSON.stringify(targetToken)};
      const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
      const isVisible = (el) => Boolean(el && (el.offsetParent !== null || el.getClientRects().length > 0));
      const normalizeToken = (text) => (text || '').toLowerCase().replace(/[^a-z0-9]/g, '');

      const candidates = Array.from(document.querySelectorAll(
        'button.content-button, [role="dialog"] button, [role="option"], mat-option, mat-list-item, [role="menuitem"]'
      ))
        .filter(isVisible)
        .map((el) => {
          const raw = normalize(el.textContent || '');
          const lower = raw.toLowerCase();
          return {
            el,
            raw,
            lower,
            token: normalizeToken(raw),
          };
        })
        .filter((item) => {
          return item.lower.includes('gemini') || item.lower.includes('nano banana') || item.lower.includes('-preview');
        });

      if (candidates.length === 0) {
        return { found: false, waiting: true };
      }

      const exact = candidates.find((item) => item.lower.includes(target));
      if (exact) {
        dispatchClickSequence(exact.el);
        return { found: true, success: true, model: exact.raw.slice(0, 160), match: 'exact' };
      }

      const fuzzy = candidates.find((item) => item.token.includes(targetToken));
      if (fuzzy) {
        dispatchClickSequence(fuzzy.el);
        return { found: true, success: true, model: fuzzy.raw.slice(0, 160), match: 'fuzzy' };
      }

      return {
        found: true,
        success: false,
        models: candidates.slice(0, 8).map((item) => item.raw.slice(0, 80)),
      };
    })()`);

    if (result && result.found) {
      if (result.success) {
        log(`Selected model (${result.match}): ${result.model}`);
        await delay(300);
        return result.model;
      }

      log(`Model "${desiredModel}" not found in selector options: ${JSON.stringify(result.models || [])}`);
      break;
    }

    await delay(200);
  }

  await evaluate(cdp, `(() => {
    const esc = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true });
    document.dispatchEvent(esc);
  })()`).catch(() => {});

  return desiredModel;
}

// ============================================================================
// Input and Submission
// ============================================================================

async function typePrompt(cdp, inputCdp, prompt) {
  // Focus the prompt input - AI Studio uses a textbox with specific placeholder
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

  // Type using CDP Input API
  await inputCdp("Input.insertText", { text: prompt });
  await delay(300);
}

async function submitPrompt(cdp, inputCdp) {
  // Wait briefly for the submit button to become enabled after typing
  await delay(200);

  // Try clicking the submit button first
  const clicked = await evaluate(cdp, `(() => {
    ${buildClickDispatcher()}
    // AI Studio's submit button is button[type="submit"]
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

  // Fallback: Cmd+Enter (macOS) / Ctrl+Enter
  const modifiers = process.platform === "darwin" ? 4 : 2; // 4 = Meta (Cmd), 2 = Ctrl
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

// ============================================================================
// Response Handling
// ============================================================================

function normalizeAiStudioRpcJson(rawText) {
  let text = String(rawText || '').trim();
  if (!text) return text;

  // Strip Google's common XSSI prefix
  //   )]}'\n<json>
  if (text.startsWith(")]}'")) {
    const newlineIndex = text.indexOf('\n');
    text = (newlineIndex === -1 ? '' : text.slice(newlineIndex + 1)).trim();
    if (!text) return text;
  }

  // Some RPC errors are returned in JS-ish array form with a leading elision:
  //   [,[7,"The caller does not have permission"]]
  // Normalize this into valid JSON before parsing
  if (text.startsWith('[,')) {
    return `[null${text.slice(1)}`;
  }

  return text;
}

function parseAiStudioRpcError(rawText) {
  const normalized = normalizeAiStudioRpcJson(rawText);
  if (!normalized) return null;

  try {
    const parsed = JSON.parse(normalized);
    const code = getNestedValue(parsed, [1, 0], null);
    const message = getNestedValue(parsed, [1, 1], null);

    if (typeof message === 'string' && message.trim()) {
      return {
        code: typeof code === 'number' ? code : undefined,
        message: message.trim(),
      };
    }
  } catch {
    // ignore parse failures
  }

  return null;
}

function isThinkingModelChunk(chunk) {
  if (!Array.isArray(chunk)) return false;

  // Observed structure for thinking chunks:
  // [null, "<thinking>", ..., 1]
  if (chunk.length >= 16 && chunk[15] === 1) return true;

  const last = chunk[chunk.length - 1];
  return chunk.length > 2 && last === 1;
}

function collectModelTextSegments(node, out) {
  if (!Array.isArray(node)) return;

  // Stream chunk patterns seen in GenerateContent response payload:
  //   [ [[null, "<chunk>"]], "model" ]
  //   [ [[[null, "<chunk>"]]], "model" ]
  if (node.length >= 2 && node[1] === 'model') {
    const payloadLevel2 = getNestedValue(node, [0, 0], null);
    const payloadLevel3 = getNestedValue(node, [0, 0, 0], null);

    const segment = typeof payloadLevel2?.[1] === 'string'
      ? payloadLevel2[1]
      : typeof payloadLevel3?.[1] === 'string'
        ? payloadLevel3[1]
        : null;

    if (typeof segment === 'string' && segment.length > 0) {
      out.push({
        text: segment,
        thinking: isThinkingModelChunk(payloadLevel2) || isThinkingModelChunk(payloadLevel3),
      });

      return;
    }
  }

  for (const child of node) {
    if (Array.isArray(child)) {
      collectModelTextSegments(child, out);
    }
  }
}

function extractFinalResponseText(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  const lines = text.split(/\r?\n/);
  const headingIndex = lines.findIndex((line, index) => index > 0 && /^#{1,6}\s+/.test(String(line || '').trim()));

  if (headingIndex <= 0) {
    return text;
  }

  const preambleText = lines.slice(0, headingIndex).join('\n').trim();
  const finalText = lines.slice(headingIndex).join('\n').trim();

  if (!preambleText || !finalText) {
    return text;
  }

  const lower = preambleText.toLowerCase();
  const looksLikeThinking =
    lower.includes('considering') ||
    lower.includes('focusing') ||
    lower.includes('reasoning') ||
    lower.includes("i'm") ||
    lower.includes('i am');

  return looksLikeThinking ? finalText : text;
}

function parseAiStudioGenerateContentText(rawText) {
  const normalized = normalizeAiStudioRpcJson(rawText);
  if (!normalized) return '';

  let parsed;
  try {
    parsed = JSON.parse(normalized);
  } catch (e) {
    throw new Error(`Invalid GenerateContent JSON (${normalized.length} chars): ${e.message}`);
  }

  const segments = [];
  collectModelTextSegments(parsed, segments);

  const finalText = segments
    .filter((segment) => !segment.thinking)
    .map((segment) => segment.text)
    .join('')
    .trim();

  if (finalText) {
    return extractFinalResponseText(finalText);
  }

  const combinedText = segments
    .map((segment) => segment.text)
    .join('')
    .trim();

  return extractFinalResponseText(combinedText);
}

function extractGenerateEntries(entries) {
  if (!Array.isArray(entries)) return [];

  return entries
    .filter((entry) => {
      const url = String(entry?.url || '');
      return entry && typeof entry === 'object' && url.includes(GENERATE_CONTENT_URL_FRAGMENT);
    })
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
}

function extractLastUserPromptFromGenerateRequestBody(rawBody) {
  if (!rawBody || typeof rawBody !== 'string') return null;

  try {
    const parsed = JSON.parse(rawBody);
    const turns = Array.isArray(parsed?.[1]) ? parsed[1] : [];

    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = turns[i];
      if (!Array.isArray(turn) || turn[1] !== 'user') continue;

      const prompt = getNestedValue(turn, [0, 0, 1], null);
      if (typeof prompt === 'string' && prompt.trim()) {
        return prompt.trim();
      }
    }
  } catch {
    // ignore parse failures
  }

  return null;
}

function doesGenerateEntryMatchPrompt(entry, expectedPrompt) {
  const expected = String(expectedPrompt || '').trim();
  if (!expected) return true;

  const requestBody = typeof entry?.requestBody === 'string' ? entry.requestBody : '';
  if (!requestBody) return false;

  const extractedPrompt = extractLastUserPromptFromGenerateRequestBody(requestBody);
  if (extractedPrompt) {
    return extractedPrompt === expected;
  }

  // Fallback heuristic if request body parsing fails
  const probe = expected.slice(0, 120);
  return probe.length > 0 && requestBody.includes(probe);
}

async function waitForGenerateResponseFromNetwork(params) {
  const {
    tabId,
    readNetworkEntries,
    timeoutMs = 300000,
    baselineEntryIds = new Set(),
    prompt = '',
    log = () => {},
  } = params;

  const deadline = Date.now() + timeoutMs;
  let lastSeenCount = -1;
  const parseErrorCounts = new Map();

  while (Date.now() < deadline) {
    const network = await readNetworkEntries(tabId);

    if (network?.error) {
      throw new Error(String(network.error));
    }

    const allEntries = Array.isArray(network?.entries)
      ? network.entries
      : Array.isArray(network?.requests)
        ? network.requests
        : [];

    const generateEntries = extractGenerateEntries(allEntries);

    if (generateEntries.length !== lastSeenCount) {
      lastSeenCount = generateEntries.length;
      log(`GenerateContent network entries seen: ${generateEntries.length}`);
    }

    const freshEntries = generateEntries.filter((entry) => !baselineEntryIds.has(entry.id));

    for (const entry of freshEntries) {
      if (!doesGenerateEntryMatchPrompt(entry, prompt)) {
        log(`Skipping GenerateContent entry ${entry?.id || 'unknown'} (prompt mismatch)`);
        continue;
      }

      const status = Number(entry?.status || 0);
      const body = typeof entry?.responseBody === 'string' ? entry.responseBody : '';

      if (status >= 400) {
        const rpcError = parseAiStudioRpcError(body);
        const msg = rpcError?.message || `HTTP ${status}`;
        throw new Error(`AI Studio GenerateContent failed (${status}): ${msg}`);
      }

      if (status !== 200 || !body) {
        continue;
      }

      let parsedText = '';
      try {
        parsedText = parseAiStudioGenerateContentText(body);
      } catch (e) {
        const requestId = entry.id || 'unknown';
        const parseErrorCount = (parseErrorCounts.get(requestId) || 0) + 1;
        parseErrorCounts.set(requestId, parseErrorCount);

        log(`GenerateContent parse error (${requestId} #${parseErrorCount}): ${e.message || e}`);

        if (parseErrorCount >= 3) {
          throw new Error(`GenerateContent body for ${requestId} is not parseable; falling back to DOM`);
        }

        continue;
      }

      if (parsedText && parsedText.length > 0) {
        return {
          text: parsedText,
          requestId: entry.id,
          status,
        };
      }
    }

    await delay(350);
  }

  throw new Error('Timed out waiting for AI Studio GenerateContent network response');
}

async function waitForResponse(cdp, timeoutMs = 300000, userPrompt = '', log = () => {}) {
  const deadline = Date.now() + timeoutMs;

  // Wait a moment for the request to start
  await delay(1000);

  // Phase 1: Poll for completion signals only (lightweight)
  // Require the "done" condition for a few consecutive polls to avoid early exits
  let doneStreak = 0;

  while (Date.now() < deadline) {
    const status = await evaluate(cdp, `(function() {
      var buttons = Array.from(document.querySelectorAll('button'));

      var bodyText = (document.body && document.body.innerText ? document.body.innerText : '').toLowerCase();

      // Rate limit detection: match the *actual* AI Studio error strings (surgical)
      // Observed strings (Feb 2026):
      // - "You've reached your rate limit. Please try again later."
      // - "Failed to generate content: user has exceeded quota. Please try again later."
      var rateLimitMsg = null;
      if (bodyText.indexOf("you've reached your rate limit") !== -1) {
        rateLimitMsg = "You've reached your rate limit. Please try again later.";
      } else if (bodyText.indexOf('failed to generate content: user has exceeded quota') !== -1) {
        rateLimitMsg = "Failed to generate content: user has exceeded quota. Please try again later.";
      }
      var rateLimited = rateLimitMsg !== null;

      // Completion signal: rating buttons appear once the model finished generating
      var hasRatingBtns = buttons.some(function(b) {
        return (b.getAttribute('aria-label') || b.textContent || '').toLowerCase().indexOf('good response') !== -1;
      });

      // Stop button present during generation
      var hasStopBtn = buttons.some(function(b) {
        var label = (b.getAttribute('aria-label') || '').toLowerCase();
        var text = (b.textContent || '').toLowerCase();
        return text.indexOf('stop') !== -1 || label.indexOf('stop') !== -1 || text.indexOf('running') !== -1;
      });

      return {
        done: hasRatingBtns && !hasStopBtn,
        hasStopBtn: hasStopBtn,
        rateLimited: rateLimited,
        rateLimitMsg: rateLimitMsg
      };
    })()`);

    if (status && status.rateLimited) {
      const msg = status.rateLimitMsg || "You've reached your rate limit. Please try again later.";
      throw new Error(
        `AI Studio rate limited: ${msg} ` +
        "(Tip: use `surf gemini` / another provider as a fallback.)"
      );
    }

    if (status && status.done) {
      doneStreak++;
      if (doneStreak === 1) {
        log("Completion signal detected (waiting for stability...)");
      }
      if (doneStreak >= 3) {
        log("Completion signal stable");
        break;
      }
    } else {
      doneStreak = 0;
    }

    await delay(500);
  }

  if (Date.now() >= deadline) {
    throw new Error("Response timeout - AI Studio did not complete in time");
  }

  // Phase 2: Extract the response text via DOM walk
  // Even after the completion signal, AI Studio can still stream/finish rendering.
  // Re-extract until the cleaned response stabilizes to avoid returning truncated output
  await delay(800);

  const extractScript = `(function() {
    function stripUi(text) {
      if (!text) return '';

      var removeLabels = ['Edit', 'Rerun this turn', 'Open options', 'Good response', 'Bad response'];
      var removeSet = {};
      for (var i = 0; i < removeLabels.length; i++) {
        removeSet[String(removeLabels[i]).toLowerCase()] = true;
      }

      var lines = String(text).split(/\r?\n/);
      var kept = [];

      for (var j = 0; j < lines.length; j++) {
        var line = lines[j];
        var trimmed = (line || '').trim();
        if (!trimmed) {
          kept.push('');
          continue;
        }

        if (removeSet[trimmed.toLowerCase()]) continue;
        kept.push(line);
      }

      return kept.join('\n').trim();
    }

    var buttons = Array.from(document.querySelectorAll('button'));
    var goodBtn = buttons.find(function(b) {
      return (b.getAttribute('aria-label') || b.textContent || '').toLowerCase().indexOf('good response') !== -1;
    });

    // Prefer extracting relative to the model turn container (good response button)
    // so we don’t accidentally return the user prompt (especially with --with-page)
    if (goodBtn) {
      var container = goodBtn.parentElement;
      while (container && container !== document.body) {
        try {
          var big = Array.from(container.querySelectorAll('[class*="very-large-text-container"]'));
          if (big && big.length) {
            var t = (big[big.length - 1].innerText || '').trim();
            if (t && t.length > 10) {
              return { text: stripUi(t), method: 'good-btn-large-container' };
            }
          }
        } catch (e) {}

        var text = (container.innerText || '').trim();
        if (text.length > 50) {
          var cleaned = stripUi(text);
          if (cleaned.length > 20) {
            return { text: cleaned, method: 'good-btn-walk' };
          }
        }
        container = container.parentElement;
      }
    }

    // Fallback: dedicated container (may include user prompt; used only if we can’t locate goodBtn)
    var big2 = Array.from(document.querySelectorAll('[class*="very-large-text-container"]'));
    if (big2 && big2.length) {
      for (var j = big2.length - 1; j >= 0; j--) {
        var tt = (big2[j].innerText || '').trim();
        var ll = tt.toLowerCase();
        if (tt.length > 50 && ll.indexOf('google ai studio uses cookies') === -1) {
          return { text: stripUi(tt), method: 'very-large-text-container' };
        }
      }
    }

    var promptInput = document.querySelector('[role="textbox"][placeholder*="prompt" i], textarea[placeholder*="prompt" i]');
    if (promptInput) {
      var parent = promptInput.parentElement;
      while (parent && parent !== document.body) {
        var siblings = parent.parentElement ? Array.from(parent.parentElement.children) : [];
        var myIdx = siblings.indexOf(parent);
        for (var s = 0; s < myIdx; s++) {
          var sibText = (siblings[s].innerText || '').trim();
          if (sibText.length > 50) {
            return { text: stripUi(sibText), method: 'sibling-walk' };
          }
        }
        parent = parent.parentElement;
      }
    }

    return { text: document.body.innerText || '', method: 'body-fallback' };
  })()`;

  let bestText = '';
  let bestRaw = '';
  let bestExtracted = null;
  let lastText = null;
  let stableCount = 0;

  const extractDeadline = Math.min(deadline, Date.now() + 15000);

  while (Date.now() < extractDeadline) {
    const extracted = await evaluate(cdp, extractScript);
    const responseTextRaw = extracted
      ? String(extracted.text || '').trim()
      : '';
    const responseText = cleanAiStudioResponse(responseTextRaw, userPrompt);

    if (responseText.length > bestText.length) {
      bestText = responseText;
      bestRaw = responseTextRaw;
      bestExtracted = extracted;
    }

    if (lastText !== null && responseText === lastText && responseText.length > 5) {
      stableCount++;
      if (stableCount >= 2) {
        log(
          'Extraction stabilized: method=' + (extracted ? extracted.method : 'none') +
          ', raw length=' + responseTextRaw.length +
          ', cleaned length=' + responseText.length
        );
        return {
          text: responseText,
          thinkingTime: null,
          url: extracted ? (extracted.url || '') : '',
        };
      }
    } else {
      stableCount = 0;
      lastText = responseText;
    }

    await delay(700);
  }

  // If we couldn't stabilize, return the best (longest) extraction we saw
  log(
    'Extraction not stable before deadline; returning best length=' + bestText.length +
    ', raw length=' + bestRaw.length +
    ', method=' + (bestExtracted ? bestExtracted.method : 'none')
  );

  if (!bestText || bestText.length < 5) {
    throw new Error('Could not extract response text from AI Studio');
  }

  return {
    text: bestText,
    thinkingTime: null,
    url: bestExtracted ? (bestExtracted.url || '') : '',
  };
}

// ============================================================================
// Main Query Function
// ============================================================================

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
  } = options;

  const startTime = Date.now();
  log("Starting AI Studio query");

  const resolvedModel = normalizeModelString(model) || DEFAULT_MODEL;
  log(`Requested model: ${resolvedModel}`);

  // Check cookies for Google authentication
  const { cookies } = await getCookies();
  if (!hasRequiredCookies(cookies)) {
    throw new Error("Google login required - sign into Google in Chrome first");
  }
  log(`Got ${cookies.length} cookies`);

  // Create tab (try to select the model via URL param for reliability)
  const tabInfo = await createTab(buildAiStudioUrl(resolvedModel));
  const { tabId } = tabInfo || {};

  if (!tabId) {
    throw new Error(`Failed to create AI Studio tab: ${JSON.stringify(tabInfo)}`);
  }
  log(`Created tab ${tabId}`);

  const cdp = (expr) => cdpEvaluate(tabId, expr);
  const inputCdp = (method, params) => cdpCommand(tabId, method, params);

  let baselineGenerateEntryIds = new Set();

  try {
    // Wait for page load
    await waitForPageLoad(cdp);
    log("Page loaded");

    // Wait for AI Studio chat UI to be ready
    await waitForStudioReady(cdp);
    log("AI Studio ready");

    // Prime network tracking and capture baseline request ids for GenerateContent
    if (typeof readNetworkEntries === 'function') {
      try {
        const baselineNetwork = await readNetworkEntries(tabId);
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
        log(`Network baseline failed: ${e.message || e}`);
      }
    }

    // Enable raw markdown view (best-effort)
    try {
      await enableUnformattedMarkdownView(cdp, log);
    } catch (e) {
      log(`Markdown toggle failed: ${e.message}`);
    }

    // Model selection: best-effort via URL param only
    // If the model id is wrong/unknown, AI Studio will typically keep the last-selected model in the UI.
    const createdUrl = buildAiStudioUrl(resolvedModel);
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
        await waitForPageLoad(cdp);
        await waitForStudioReady(cdp);
        runtimeUrl = await evaluate(cdp, 'location.href');
        runtimeModelParam = await evaluate(cdp, `(() => {
          try {
            return new URLSearchParams(location.search).get('model') || '';
          } catch {
            return '';
          }
        })()`);
      } catch (e) {
        log(`Direct model URL navigation retry failed: ${e.message || e}`);
      }
    }

    if (usedUrlParam) {
      log(`Model via URL param: requested="${resolvedModel}", runtimeParam="${runtimeModelParam || '(none)'}"`);
    } else {
      log(`Model via UI (no URL param): requested="${resolvedModel}"`);
    }

    // Helpful debug: what the UI currently shows
    const currentModelInfo = await readCurrentModelInfo(cdp).catch(() => ({ found: false, label: '', modelId: '' }));

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
        modelApplied = await waitForModelToApply(cdp, resolvedModel, log);
      } catch (e) {
        log(`Model apply wait failed: ${e.message}`);
      }
    }

    if (!modelApplied) {
      try {
        log(`Attempting UI model selection fallback: ${resolvedModel}`);
        await selectModel(cdp, resolvedModel, log);
        modelApplied = await waitForModelToApply(cdp, resolvedModel, log, 10000);
      } catch (e) {
        log(`UI model selection fallback failed: ${e.message}`);
      }
    }

    await closeModelSelectorIfOpen(cdp, log);

    // Type prompt
    await typePrompt(cdp, inputCdp, prompt);
    log("Prompt typed");

    // Submit
    await submitPrompt(cdp, inputCdp);
    log("Submitted, waiting for response...");

    // Wait for response
    let response;

    if (typeof readNetworkEntries === 'function') {
      try {
        const networkResult = await waitForGenerateResponseFromNetwork({
          tabId,
          readNetworkEntries,
          timeoutMs: timeout,
          baselineEntryIds: baselineGenerateEntryIds,
          prompt,
          log,
        });

        response = {
          text: networkResult.text,
          thinkingTime: null,
          url: '',
          partial: false,
        };

        log(
          `Network response: ${response.text.length} chars` +
          `${networkResult.requestId ? ` (request ${networkResult.requestId})` : ''}`
        );
      } catch (networkErr) {
        log(`Network extraction failed, falling back to DOM: ${networkErr.message || networkErr}`);

        const remainingTimeoutMs = Math.max(timeout - (Date.now() - startTime), 10000);
        response = await waitForResponse(cdp, remainingTimeoutMs, prompt, log);
      }
    } else {
      response = await waitForResponse(cdp, timeout, prompt, log);
    }

    const thinkingInfo = response.thinkingTime ? ` (thought for ${response.thinkingTime}s)` : '';
    log(`Response: ${response.text.length} chars${thinkingInfo}${response.partial ? ' (partial)' : ''}`);

    return {
      response: response.text,
      model: resolvedModel,
      thinkingTime: response.thinkingTime,
      url: response.url,
      partial: response.partial || false,
      tookMs: Date.now() - startTime,
    };
  } finally {
    await closeTab(tabId).catch(() => {});
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  query,
  hasRequiredCookies,
  buildAiStudioUrl,
};
