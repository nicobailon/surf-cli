<file_map>
/Users/danielsivan/dev/surf-cli
├── docs
│   ├── investigations
│   │   ├── rp-surf-oracle-missing-reply-recovery.md *
│   │   ├── surf-chats-profile-lock.md *
│   │   ├── chatgpt-prosemirror-bypass.md
│   │   └── orchestrate-pro-surf-oracle-flow.md
│   ├── chatgpt-headless-investigation.md
│   ├── cloakbrowser-integration-plan.md
│   ├── investigation-chatgpt-chats-feature.md
│   ├── investigation-chatgpt-thinking-trace.md
│   ├── investigation-cloak-capture-bug.md
│   ├── investigation-gemini-file-upload.md
│   └── investigation-thinking-sidebar-trace.md
├── native
│   ├── formatters
│   │   └── network.cjs
│   ├── tests
│   │   └── cli-tests.sh
│   ├── chatgpt-chats-formatter.cjs *
│   ├── chatgpt-cloak-bridge.cjs *
│   ├── chatgpt-cloak-chats-worker.mjs *
│   ├── chatgpt-cloak-prompt-entry.cjs *
│   ├── chatgpt-cloak-prompt-validation.cjs *
│   ├── chatgpt-cloak-runtime.cjs *
│   ├── chatgpt-cloak-timeout.cjs *
│   ├── chatgpt-cloak-worker.mjs *
│   ├── chatgpt-conversation-state.cjs *
│   ├── cli.cjs *
│   ├── session-reconciler.cjs *
│   ├── cdp-stealth.cjs
│   ├── chatgpt-bun-bridge.cjs
│   ├── chatgpt-bun-profile-auth.ts +
│   ├── chatgpt-bun-worker-logic.ts +
│   ├── chatgpt-bun-worker.ts +
│   ├── chatgpt-chats-cache.cjs
│   ├── chatgpt-chats-search.d.mts
│   ├── chatgpt-chats-search.mjs
│   ├── chatgpt-client.cjs
│   ├── chatgpt-cloak-profile-auth.mjs
│   ├── chrome-profile-utils.cjs
│   ├── config.cjs
│   ├── device-presets.cjs
│   ├── do-executor.cjs
│   ├── do-parser.cjs
│   ├── gemini-bun-bridge.cjs
│   ├── gemini-bun-profile-auth.ts +
│   ├── gemini-bun-worker.ts +
│   ├── gemini-common.cjs
│   ├── headless-command-runner.cjs
│   ├── mcp-server.cjs
│   ├── network-store.cjs
│   ├── session-store.cjs
│   ├── slack-cloak-bridge.cjs
│   ├── slack-cloak-profile-auth.mjs
│   ├── slack-cloak-worker.mjs
│   └── slack-formatter.cjs
├── test
│   ├── unit
│   │   ├── cdp
│   │   ├── formatters
│   │   │   └── network.test.ts +
│   │   ├── chatgpt-chats-formatter.test.ts * +
│   │   ├── chatgpt-cloak-bridge.test.ts * +
│   │   ├── chatgpt-cloak-prompt-entry.test.ts * +
│   │   ├── chatgpt-cloak-runtime.test.ts * +
│   │   ├── chatgpt-cloak-timeout.test.ts * +
│   │   ├── chatgpt-conversation-state.test.ts * +
│   │   ├── session-reconciler.test.ts * +
│   │   ├── .gitkeep
│   │   ├── cdp-stealth.test.ts +
│   │   ├── chatgpt-bun-bridge.test.ts +
│   │   ├── chatgpt-bun-worker-logic.test.ts +
│   │   ├── chatgpt-chats-cache.test.ts +
│   │   ├── chatgpt-chats-search.test.ts +
│   │   ├── chatgpt-cloak-prompt-validation.test.ts +
│   │   ├── chrome-profile-utils.test.ts +
│   │   ├── do-executor.test.ts +
│   │   ├── do-parser.test.ts +
│   │   ├── gemini-bun-bridge.test.ts +
│   │   ├── gemini-common.test.ts +
│   │   ├── headless-command-runner.test.ts +
│   │   ├── mcp-server.test.ts +
│   │   ├── session-store.test.ts +
│   │   ├── slack-cloak-bridge.test.ts +
│   │   └── slack-formatter.test.ts +
│   ├── e2e
│   │   ├── .gitkeep
│   │   └── chatgpt-cloak-local.test.ts +
│   ├── integration
│   │   └── .gitkeep
│   ├── mocks
│   └── network-capture.test.cjs
├── .claude
│   └── skills
│       └── surf-codebase
│           └── SKILL.md
├── .github
│   ├── workflows
│   │   ├── ci.yml
│   │   ├── codeql.yml
│   │   └── gitleaks.yml
│   └── dependabot.yml
├── .surf
│   └── exports
│       └── 2026-04-13-000209-review-slack-extension.md
├── prompt-exports
│   ├── 2026-04-12-064859-review-headless-refactor-surf-cli.md
│   ├── oracle-chat-2026-04-13-102715-cloak-flow-triage-f2-f1fa.md
│   ├── oracle-plan-2026-04-10-183937-socket-hardening-pla-146e.md
│   ├── oracle-plan-2026-04-11-230117-orchestrate-cloakbro-a1a7.md
│   ├── oracle-plan-2026-04-11-230414-orchestrate-cloakbro-7c58.md
│   ├── oracle-plan-2026-04-11-232831-headless-only-simpli-764c.md
│   ├── oracle-plan-2026-04-11-233149-headless-only-simpli-0fc3.md
│   ├── oracle-plan-2026-04-11-233446-headless-only-simpli-cef6.md
│   ├── oracle-plan-2026-04-12-005501-embed-skill-doc-210f-2984.md
│   ├── oracle-plan-2026-04-13-102511-cloak-flow-triage-f2-65dd.md
│   └── oracle-review-2026-04-12-064859-headless-refactor-re-2cfa.md
├── skills
│   ├── surf
│   │   └── SKILL.md
│   └── README.md
├── README.md *
├── .gitignore
├── .npmignore
├── AGENTS.md
├── CHANGELOG.md
├── LICENSE
├── biome.json
├── package-lock.json
├── package.json
├── surf-banner.png
├── tsconfig.json
└── vitest.config.ts +


(* denotes selected files)
(+ denotes code-map available)
</file_map>
<file_contents>
File: /Users/danielsivan/dev/surf-cli/native/chatgpt-cloak-worker.mjs
```mjs
/**
 * ChatGPT CloakBrowser Worker
 *
 * Stealth Chromium automation using CloakBrowser (Playwright-based).
 * Defeats bot detection via 33 C++ source-level patches + behavioral humanization.
 *
 * Protocol: stdin JSON lines → stdout JSON lines
 *   Input:  { type:"query", prompt, model?, file?, profile?, timeout?, generateImage? }
 *   Output: { type:"progress"|"success"|"error", … }
 */

import { launchPersistentContext } from 'cloakbrowser';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { createRequire } from 'module';
import { join, resolve as pathResolve } from 'path';
import { loadAndInjectChatgptCookies } from './chatgpt-cloak-profile-auth.mjs';

const require = createRequire(import.meta.url);
const {
  launchPersistentContextWithRecovery,
  sharedProfileDir,
  tempProfileDir,
} = require('./chatgpt-cloak-runtime.cjs');
const { enterPromptWithVerification } = require('./chatgpt-cloak-prompt-entry.cjs');
const {
  extractLatestActiveUserMessage,
  evaluatePromptPersistence,
} = require('./chatgpt-cloak-prompt-validation.cjs');
const {
  DEFAULT_CHATGPT_QUERY_TIMEOUT_SEC,
  detectResponseActivity,
  resolveKeepaliveIntervalMs,
  resolveQueryTimeoutSeconds,
} = require('./chatgpt-cloak-timeout.cjs');

// ============================================================================
// Logging helpers — everything goes to stdout as JSON lines

const emit = (obj) => process.stdout.write(JSON.stringify({ ...obj, t: Date.now() }) + '\n');
const log   = (level, message, data) => emit({ type: 'log', level, message, data });
const progress = (step, total, msg)  => emit({ type: 'progress', step, total, message: msg });
const success  = (payload)           => emit({ type: 'success', ...payload });
const fail     = (code, message, d)  => emit({ type: 'error', code, message, details: d });

/** Native sleep — does NOT leak CDP signals (unlike page.waitForTimeout). */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ============================================================================
// Model mapping — mirrors chatgpt-bun-worker-logic.ts

const MODEL_MAP = {
  'gpt-4o':            { mode: 'instant',  tid: 'model-switcher-gpt-5-3' },
  'gpt-4.1':           { mode: 'instant',  tid: 'model-switcher-gpt-5-3' },
  'gpt-4.1-mini':      { mode: 'instant',  tid: 'model-switcher-gpt-5-3' },
  'gpt-5.3':           { mode: 'instant',  tid: 'model-switcher-gpt-5-3' },
  'instant':           { mode: 'instant',  tid: 'model-switcher-gpt-5-3' },
  'o3':                { mode: 'thinking', tid: 'model-switcher-gpt-5-4-thinking' },
  'o4-mini':           { mode: 'thinking', tid: 'model-switcher-gpt-5-4-thinking' },
  'gpt-5.4-thinking':  { mode: 'thinking', tid: 'model-switcher-gpt-5-4-thinking' },
  'thinking':          { mode: 'thinking', tid: 'model-switcher-gpt-5-4-thinking' },
  'o1-pro':            { mode: 'pro',      tid: 'model-switcher-gpt-5-4-pro' },
  'gpt-5.4-pro':       { mode: 'pro',      tid: 'model-switcher-gpt-5-4-pro' },
  'pro':               { mode: 'pro',      tid: 'model-switcher-gpt-5-4-pro' },
  'chatgpt-pro':       { mode: 'pro',      tid: 'model-switcher-gpt-5-4-pro' },
};

function resolveModel(id) {
  return MODEL_MAP[(id || '').toLowerCase().trim()] || { mode: 'default', tid: null };
}

// ============================================================================
// UI noise patterns — strips chrome from DOM text

const UI_NOISE = [
  /^ChatGPT said:\s*/i,
  /Thought for [\w\s]+ seconds?\s*/gi,
  /^Thinking\s*/i,
  /^Analyzing image\s*/i,
  /^Searching the web\s*/i,
  /Give feedback\s*/gi,
  /ChatGPT Instruments\s*/gi,
  /\s*Copy\s*$/gm,
  /^Sources\s*/gm,
  /^\d+\s*\/\s*\d+\s*$/gm,         // pagination "1/3"
  /Upgrade to Plus to use .*$/gim,
  /You've reached the .* limit.*$/gim,
];

function sanitize(raw) {
  if (!raw) return '';
  let text = raw;
  for (const re of UI_NOISE) text = text.replace(re, '');
  return text.trim();
}

// Readiness checks

async function waitForReady(page, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await page.evaluate((promptSelectors) => {
      // Cloudflare challenge
      if (document.title.toLowerCase().includes('just a moment')) return 'cloudflare';
      // Editor present = ready (try multiple selectors)
      if (document.querySelector(promptSelectors)) return 'ready';
      // Login page
      const btns = Array.from(document.querySelectorAll('button, a'));
      if (btns.some(b => /^(log in|sign in|sign up)$/i.test((b.textContent || '').trim()))) return 'login';
      return 'loading';
    }, PROMPT_SELECTORS_CSS);

    if (state === 'ready') return { ready: true, loggedIn: true };
    if (state === 'login') return { ready: true, loggedIn: false };
    if (state === 'cloudflare') {
      log('warn', 'Cloudflare challenge detected, waiting...');
    }
    await sleep(1000);
  }
  return { ready: false, loggedIn: false };
}

async function waitForConversationReady(page, conversationId, timeoutMs = 30_000) {
  const expectedPath = `/c/${conversationId}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const currentUrl = page.url();
    const state = await page.evaluate((promptSelectors) => {
      if (document.querySelector(promptSelectors)) return 'ready';
      const btns = Array.from(document.querySelectorAll('button, a'));
      if (btns.some((b) => /^(log in|sign in|sign up)$/i.test((b.textContent || '').trim()))) return 'login';
      return 'loading';
    }, PROMPT_SELECTORS_CSS);

    if (state === 'login') return { ready: false, loggedIn: false, currentUrl };
    if (currentUrl.includes(expectedPath) && state === 'ready') {
      return { ready: true, loggedIn: true, currentUrl };
    }
    if (currentUrl === 'https://chatgpt.com/' || currentUrl === 'https://chatgpt.com') {
      return { ready: false, loggedIn: true, currentUrl };
    }
    await sleep(1000);
  }
  return { ready: false, loggedIn: true, currentUrl: page.url() };
}

function extractConversationIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/\/c\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

async function waitForConversationIdFromUrl(page, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const id = extractConversationIdFromUrl(page.url());
    if (id) return id;
    await sleep(500);
  }
  return extractConversationIdFromUrl(page.url());
}

async function fetchConversation(page, conversationId) {
  return await page.evaluate(async (id) => {
    const safeJson = async (response) => {
      const text = await response.text();
      if (!text) return { text: '', json: null };
      try { return { text, json: JSON.parse(text) }; }
      catch { return { text, json: null }; }
    };

    try {
      const sessionResp = await fetch('/api/auth/session', { credentials: 'same-origin' });
      const sessionPayload = await safeJson(sessionResp);
      const accessToken = sessionPayload.json?.accessToken;
      if (!sessionResp.ok || !accessToken) {
        return { ok: false, code: 'login_required', status: sessionResp.status || 401, body: sessionPayload.text };
      }

      const response = await fetch(`/backend-api/conversation/${encodeURIComponent(id)}`, {
        credentials: 'same-origin',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });
      const payload = await safeJson(response);
      if (!response.ok) {
        return {
          ok: false,
          code: response.status === 404 ? 'conversation_not_found' : 'backend_error',
          status: response.status,
          body: payload.text,
        };
      }
      return { ok: true, conversation: payload.json };
    } catch (error) {
      return { ok: false, code: error?.code || 'backend_error', message: error?.message || String(error) };
    }
  }, conversationId);
}

function summarizePromptValidation(validation) {
  const actualText = typeof validation?.actualText === 'string' ? validation.actualText : '';
  const previewChars = 120;
  return {
    conversationId: validation?.conversationId || null,
    code: validation?.code || null,
    failureReason: validation?.failureReason || null,
    expectedChars: validation?.expectedChars || 0,
    actualChars: validation?.actualChars || 0,
    exactMatch: validation?.exactMatch === true,
    latestUserNodeId: validation?.latestUserNodeId || null,
    advancedPastBaseline:
      Object.prototype.hasOwnProperty.call(validation || {}, 'advancedPastBaseline')
        ? validation.advancedPastBaseline
        : null,
    fileMapOnly: validation?.fileMapOnly === true,
    hasBigPasteAttachment: validation?.hasBigPasteAttachment === true,
    attachmentCount: validation?.attachmentCount || 0,
    attachmentNames: Array.isArray(validation?.attachmentNames) ? validation.attachmentNames : [],
    timedOut: validation?.timedOut === true,
    status: validation?.status || null,
    actualPreviewStart: actualText ? actualText.slice(0, previewChars) : '',
    actualPreviewEnd: actualText.length > previewChars ? actualText.slice(-previewChars) : '',
  };
}

async function captureBaselineUserNodeId(page, conversationId) {
  if (!conversationId) return null;
  const result = await fetchConversation(page, conversationId);
  if (!result?.ok) return { ok: false, code: result?.code || 'prompt_validation_fetch_failed', status: result?.status, body: result?.body };
  const latestUser = extractLatestActiveUserMessage(result.conversation);
  return { ok: true, baselineUserNodeId: latestUser?.nodeId || null };
}

async function resolveConversationIdForValidation(page, existingConversationId, timeoutMs = 30_000) {
  if (existingConversationId) return existingConversationId;
  return await waitForConversationIdFromUrl(page, timeoutMs);
}

async function waitForPromptPersistenceValidation({
  page,
  conversationId,
  expectedPrompt,
  baselineUserNodeId = null,
  timeoutMs = 30_000,
  pollMs = 1_000,
}) {
  const deadline = Date.now() + timeoutMs;
  let lastObserved = {
    ok: false,
    failureReason: 'validation_not_started',
    expectedChars: expectedPrompt.length,
    actualChars: 0,
    exactMatch: false,
    latestUserNodeId: null,
    advancedPastBaseline: baselineUserNodeId ? false : null,
    fileMapOnly: false,
    hasBigPasteAttachment: false,
    attachmentCount: 0,
    attachmentNames: [],
    actualText: '',
    conversationId,
  };

  while (Date.now() < deadline) {
    const result = await fetchConversation(page, conversationId);
    if (!result?.ok) {
      lastObserved = {
        ok: false,
        code: result?.code || 'prompt_validation_fetch_failed',
        failureReason: result?.code || 'prompt_validation_fetch_failed',
        status: result?.status,
        body: result?.body,
        conversationId,
      };
      if (lastObserved.code === 'login_required') return lastObserved;
    } else {
      lastObserved = {
        ...evaluatePromptPersistence({
          conversation: result.conversation,
          expectedPrompt,
          baselineUserNodeId,
        }),
        conversationId,
      };
      if (lastObserved.ok) return lastObserved;
      if (lastObserved.failureReason === 'file_map_placeholder' || lastObserved.failureReason === 'big_paste_attachment') {
        return lastObserved;
      }
    }
    await sleep(pollMs);
  }

  return { ...lastObserved, ok: false, timedOut: true };
}

async function inspectSendStartState(page, expectedPrompt) {
  return await page.evaluate((promptSelectors, stopSelector, expected) => {
    const normalize = (value) => String(value || '').replace(/\r\n/g, '\n').trim();
    const isVisible = (el) => {
      if (!el || !(el instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(el);
      if (!style) return false;
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const isEnabled = (el) => {
      if (!el) return false;
      if (el.disabled) return false;
      const aria = (el.getAttribute('aria-disabled') || '').toLowerCase();
      return aria !== 'true';
    };

    let stopVisible = false;
    const stopButtons = document.querySelectorAll(stopSelector);
    for (const button of stopButtons) {
      if (isVisible(button) && isEnabled(button)) {
        stopVisible = true;
        break;
      }
    }

    let composerText = '';
    for (const selector of promptSelectors) {
      const el = document.querySelector(selector);
      if (!el) continue;
      if ('value' in el && typeof el.value === 'string') {
        composerText = el.value;
      } else {
        composerText = el.innerText || el.textContent || '';
      }
      break;
    }

    const normalizedComposer = normalize(composerText);
    const normalizedExpected = normalize(expected);
    return {
      stopVisible,
      composerCleared: normalizedComposer.length === 0,
      promptStillPresent: normalizedComposer.length > 0 && normalizedComposer === normalizedExpected,
      composerChars: normalizedComposer.length,
    };
  }, PROMPT_SELECTOR_LIST, STOP_BUTTON_SELECTOR, expectedPrompt);
}

async function probeSendConfirmation({
  page,
  expectedPrompt,
  conversationId,
  baselineUserNodeId,
  timeoutMs = 5_000,
}) {
  const deadline = Date.now() + timeoutMs;
  const hadConversationIdBeforeSend = !!conversationId;
  let lastDomState = null;

  while (Date.now() < deadline) {
    const detectedConversationId = conversationId || extractConversationIdFromUrl(page.url());
    if (detectedConversationId) {
      const validation = await waitForPromptPersistenceValidation({
        page,
        conversationId: detectedConversationId,
        expectedPrompt,
        baselineUserNodeId,
        timeoutMs: Math.max(1_500, Math.min(4_000, timeoutMs)),
        pollMs: 400,
      });
      if (validation.ok) {
        return {
          confirmed: true,
          conversationId: detectedConversationId,
          validation,
          confirmationSource: 'prompt_persisted',
        };
      }

      lastDomState = await inspectSendStartState(page, expectedPrompt);
      const definitiveValidationFailure = ['file_map_placeholder', 'big_paste_attachment'].includes(validation.failureReason || '');
      const independentSendSignal = !hadConversationIdBeforeSend
        || lastDomState.stopVisible
        || lastDomState.composerCleared
        || !lastDomState.promptStillPresent;
      if (definitiveValidationFailure || independentSendSignal) {
        return {
          confirmed: true,
          conversationId: detectedConversationId,
          validation,
          confirmationSource: definitiveValidationFailure ? 'prompt_persisted_invalid' : 'conversation_detected',
          domState: lastDomState,
        };
      }

      await sleep(350);
      continue;
    }

    lastDomState = await inspectSendStartState(page, expectedPrompt);
    if (lastDomState.stopVisible || lastDomState.composerCleared || !lastDomState.promptStillPresent) {
      return {
        confirmed: true,
        conversationId: null,
        validation: null,
        confirmationSource: lastDomState.stopVisible
          ? 'stop_button'
          : lastDomState.composerCleared
            ? 'composer_cleared'
            : 'composer_changed',
        domState: lastDomState,
      };
    }

    await sleep(350);
  }

  return {
    confirmed: false,
    conversationId: null,
    validation: null,
    confirmationSource: null,
    domState: lastDomState,
  };
}

async function attemptSendAndConfirm({
  page,
  textarea,
  promptEntry,
  finalPrompt,
  conversationId,
  baselineUserNodeId,
}) {
  const tryConfirmation = async ({ method, selector = null, attemptError = null }) => {
    const sentAt = new Date().toISOString();
    const probe = await probeSendConfirmation({
      page,
      expectedPrompt: finalPrompt,
      conversationId,
      baselineUserNodeId,
      timeoutMs: 5_000,
    });
    return {
      ...probe,
      method,
      selector,
      sentAt,
      attemptError: attemptError ? (attemptError.message || String(attemptError)) : null,
    };
  };

  if (promptEntry.sendEnabled) {
    for (const sel of SEND_BUTTON_SELECTORS) {
      let attemptError = null;
      try {
        const btn = page.locator(sel).first();
        await btn.click({ timeout: 5_000 });
        log('info', `Send button clicked: ${sel}`);
      } catch (error) {
        attemptError = error;
        log('warn', `Send button attempt threw: ${sel}`, { error: error?.message || String(error) });
      }

      const result = await tryConfirmation({ method: 'click', selector: sel, attemptError });
      if (result.confirmed) return result;
      log('info', `Send attempt unconfirmed: ${sel}`, result.domState || {});
    }
  }

  log(
    promptEntry.sendButtonFound ? 'warn' : 'info',
    promptEntry.sendButtonFound
      ? 'Send button not confirmed after click attempts — pressing Enter'
      : 'No send button found — pressing Enter'
  );

  let enterError = null;
  try {
    await textarea.press('Enter');
  } catch (error) {
    enterError = error;
    log('warn', 'Enter send attempt threw', { error: error?.message || String(error) });
  }

  const result = await tryConfirmation({ method: 'enter', attemptError: enterError });
  if (result.confirmed) return result;

  throw Object.assign(
    new Error('Prompt send did not confirm via click or Enter'),
    { code: 'send_not_confirmed', details: { lastProbe: result.domState || null } },
  );
}

// ============================================================================
// Shared selectors — unified assistant-turn detection (mirrors bun worker)

const ASSISTANT_SELECTOR =
  '[data-message-author-role="assistant"], [data-turn="assistant"]';

const CONVERSATION_TURN_SELECTOR =
  'section[data-testid^="conversation-turn"], article[data-testid^="conversation-turn"], div[data-testid^="conversation-turn"]';

const STOP_BUTTON_SELECTOR =
  'button[data-testid="stop-button"], button[aria-label="Stop"]';

const IS_ACTIVE_STOP_BUTTON_JS = `(() => {
  var STOP_SEL = '${STOP_BUTTON_SELECTOR}';
  function isVisible(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    var style = window.getComputedStyle(el);
    if (!style) return false;
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function isEnabled(el) {
    if (!el) return false;
    if (el.disabled) return false;
    var aria = (el.getAttribute('aria-disabled') || '').toLowerCase();
    if (aria === 'true') return false;
    return true;
  }
  var buttons = document.querySelectorAll(STOP_SEL);
  for (var i = 0; i < buttons.length; i++) {
    var btn = buttons[i];
    if (isVisible(btn) && isEnabled(btn)) return true;
  }
  return false;
})()`;

// Prompt composer selectors — broader than just #prompt-textarea to handle ChatGPT DOM changes
const PROMPT_SELECTOR_LIST = [
  '#prompt-textarea',
  '[data-testid="composer-textarea"]',
  'textarea[name="prompt-textarea"]',
  '.ProseMirror',
  '[contenteditable="true"][data-virtualkeyboard="true"]',
];
const PROMPT_SELECTORS_CSS = PROMPT_SELECTOR_LIST.join(', ');

// Keep this list strict. Generic form buttons can match attach/model controls,
// causing false-ready verification or clicking the wrong action.
const SEND_BUTTON_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[data-testid*="composer-send"]',
  'button[aria-label="Send prompt"]',
  'button[aria-label="Send"]',
];

const FINISHED_ACTION_SELECTOR =
  'button[data-testid="copy-turn-action-button"], button[data-testid="good-response-turn-action-button"]';

// Helper JS fragment: resolve last assistant turn node (shared by extract/detect/image)
const FIND_LAST_ASSISTANT_JS = `
  var TURN_SEL = '${CONVERSATION_TURN_SELECTOR}';
  var ASSISTANT_SEL = '${ASSISTANT_SELECTOR}';
  function isAssistant(node) {
    if (!(node instanceof HTMLElement)) return false;
    var sr = node.querySelector('.sr-only');
    if (sr) {
      var srText = (sr.textContent || '').toLowerCase().trim();
      if (srText.includes('chatgpt said') || srText.includes('assistant said')) return true;
      if (srText.includes('you said') || srText.includes('user said')) return false;
    }
    var role = (node.getAttribute('data-message-author-role') || '').toLowerCase();
    if (role === 'assistant') return true;
    if (role === 'user') return false;
    var turn = (node.getAttribute('data-turn') || '').toLowerCase();
    if (turn === 'assistant') return true;
    return !!node.querySelector(ASSISTANT_SEL);
  }
  var turns = document.querySelectorAll(TURN_SEL);
  var lastAssistant = null;
  for (var i = turns.length - 1; i >= 0; i--) {
    if (isAssistant(turns[i])) { lastAssistant = turns[i]; break; }
  }
`;

// ============================================================================
// Response text extraction from DOM — structured return + innerText

const EXTRACT_TEXT_JS = `(() => {
  ${FIND_LAST_ASSISTANT_JS}
  var FINISH_SEL = '${FINISHED_ACTION_SELECTOR}';
  if (!lastAssistant) return { text: '', finished: false, messageId: null, hasAssistantTurn: false };
  var text = '';
  var md = lastAssistant.querySelector('.markdown');
  if (md) {
    text = (md.innerText || '').trim();
  } else {
    var content = lastAssistant.querySelector('[data-message-content]')
               || lastAssistant.querySelector('.prose')
               || lastAssistant;
    var clone = content.cloneNode(true);
    var remove = clone.querySelectorAll('.sr-only, button, nav, form, script, style');
    for (var r = 0; r < remove.length; r++) remove[r].remove();
    text = (clone.innerText || '').trim();
  }
  var msgEl = lastAssistant.querySelector('[data-message-id]');
  var messageId = msgEl ? msgEl.getAttribute('data-message-id') : null;
  var finished = !!lastAssistant.querySelector(FINISH_SEL);
  var turnId = lastAssistant.getAttribute('data-testid') || null;
  return { text: text, finished: finished, messageId: messageId, hasAssistantTurn: true, turnId: turnId };
})()`;

const DETECT_PHASE_JS = `(() => {
  var STOP_SEL = '${STOP_BUTTON_SELECTOR}';
  function isVisible(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    var style = window.getComputedStyle(el);
    if (!style) return false;
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function isEnabled(el) {
    if (!el) return false;
    if (el.disabled) return false;
    var aria = (el.getAttribute('aria-disabled') || '').toLowerCase();
    if (aria === 'true') return false;
    return true;
  }
  var stop = null;
  var buttons = document.querySelectorAll(STOP_SEL);
  for (var i = 0; i < buttons.length; i++) {
    var candidate = buttons[i];
    if (isVisible(candidate) && isEnabled(candidate)) { stop = candidate; break; }
  }
  if (!stop) return { phase: '', isThinking: false, thinkingText: '' };
  ${FIND_LAST_ASSISTANT_JS}
  if (!lastAssistant) return { phase: 'Connecting', isThinking: true, thinkingText: '' };

  // Check for thinking indicators (Pro model uses details/summary for thinking bubble)
  // The thinking element can coexist with .markdown — check it FIRST
  var thinkingEl = lastAssistant.querySelector('details') || lastAssistant.querySelector('[class*="think"]');
  var isThinking = false;
  var thinkingText = '';
  if (thinkingEl) {
    // Check if the thinking bubble is still "open" / actively being streamed
    var summary = thinkingEl.querySelector('summary');
    var summaryText = summary ? (summary.textContent || '').trim() : '';
    // "Thinking" (active) vs "Thought for Ns" (completed)
    var isActiveThinking = summaryText === 'Thinking' || summaryText.startsWith('Thinking');
    if (isActiveThinking) {
      isThinking = true;
      // Get the thinking content (everything except the summary)
      var thinkClone = thinkingEl.cloneNode(true);
      var sumEl = thinkClone.querySelector('summary');
      if (sumEl) sumEl.remove();
      thinkingText = (thinkClone.textContent || '').trim();
    }
  }

  var md = lastAssistant.querySelector('.markdown');
  var hasResponse = md && (md.innerText || '').trim();

  if (hasResponse && !isThinking) return { phase: 'Responding', isThinking: false, thinkingText: '' };

  // If actively thinking (with or without response started)
  if (isThinking) {
    var label = thinkingText ? thinkingText.split('\\n')[0].trim().slice(0, 80) || 'Thinking' : 'Thinking';
    return { phase: label, isThinking: true, thinkingText: thinkingText };
  }

  // Fallback: raw assistant-turn text. Avoid clone-pruning here; current ChatGPT Pro
  // thinking previews can live under generic text containers and disappear if we over-prune.
  var raw = (lastAssistant.textContent || '').trim();
  raw = raw.replace(/^(ChatGPT said:|Assistant said:)/i, '').trim();
  var label = raw.split('\\n')[0].trim().slice(0, 80) || 'Thinking';
  var body = raw;
  var timerMatch = raw.match(/^(Thought|Thinking)\\s+(for\\s+)?\\d+\\s*s(econds?)?\\n?/);
  if (timerMatch) body = raw.slice(timerMatch[0].length);
  return { phase: label, isThinking: true, thinkingText: body };
})()`;

// ============================================================================
// SSE fetch stream capture — ported from bun worker

async function injectFetchStreamCapture(page) {
  await page.evaluate(`
    (function() {
      if (window.__surfChatFetchPatched) return;
      window.__surfChatFetchPatched = true;
      window.__surfChatResponse = { text: '', done: false, messageId: null, model: null, parts: [] };
      var origFetch = window.fetch;
      window.fetch = function() {
        var args = arguments;
        var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
        var opts = args[1] || {};
        var method = (opts.method || 'GET').toUpperCase();
        var result = origFetch.apply(this, args);
        var isConv = method === 'POST' && (url.indexOf('/backend-api/f/conversation') !== -1 || url.indexOf('/backend-api/conversation') !== -1);
        if (isConv) {
          result.then(function(resp) {
            if (!resp.body || !resp.ok) return;
            window.__surfChatResponse = { text: '', done: false, messageId: null, model: null, parts: [] };
            var clone = resp.clone();
            var reader = clone.body.getReader();
            var decoder = new TextDecoder();
            var buf = '';
            function applyOp(op) {
              var r = window.__surfChatResponse;
              var m = op.p.match(/^\\/message\\/content\\/parts\\/(\\d+)$/);
              if (m) {
                var idx = parseInt(m[1], 10);
                while (r.parts.length <= idx) r.parts.push('');
                if (op.o === 'append' && typeof op.v === 'string') r.parts[idx] += op.v;
                else if (op.o === 'replace') r.parts[idx] = typeof op.v === 'string' ? op.v : JSON.stringify(op.v);
                r.text = r.parts.join('');
                return;
              }
              if (op.p === '/message/status' && op.o === 'replace' && op.v === 'finished_successfully') { r.done = true; return; }
              if (op.p === '/message/id' && op.o === 'replace' && typeof op.v === 'string') { r.messageId = op.v; return; }
              if (op.p === '/message/metadata/model_slug' && op.o === 'replace' && typeof op.v === 'string') { r.model = op.v; return; }
            }
            function pump() {
              reader.read().then(function(chunk) {
                if (chunk.done) { window.__surfChatResponse.done = true; return; }
                buf += decoder.decode(chunk.value, { stream: true });
                var lines = buf.split('\\n');
                buf = lines.pop() || '';
                for (var i = 0; i < lines.length; i++) {
                  var line = lines[i].trim();
                  if (!line) continue;
                  if (line.indexOf('event:') === 0) continue;
                  if (line.indexOf('data: ') === 0) line = line.slice(6).trim();
                  if (line === '[DONE]') { window.__surfChatResponse.done = true; continue; }
                  if (line === 'message_stream_complete') { window.__surfChatResponse.done = true; continue; }
                  if (line[0] !== '{') continue;
                  try {
                    var obj = JSON.parse(line);
                    if (obj.type === 'message_stream_complete') { window.__surfChatResponse.done = true; continue; }
                    var msg = (obj.v && obj.v.message) || obj.message;
                    if (msg && msg.author && msg.author.role === 'assistant' && msg.content && msg.content.parts) {
                      var t = msg.content.parts.join('');
                      if (t) { window.__surfChatResponse.text = t; window.__surfChatResponse.parts = msg.content.parts.slice(); }
                      if (msg.id) window.__surfChatResponse.messageId = msg.id;
                      if (msg.metadata && msg.metadata.model_slug) window.__surfChatResponse.model = msg.metadata.model_slug;
                      if (msg.status === 'finished_successfully') window.__surfChatResponse.done = true;
                      continue;
                    }
                    if (typeof obj.o === 'string' && typeof obj.p === 'string') { applyOp(obj); continue; }
                    if (Array.isArray(obj.v)) {
                      for (var j = 0; j < obj.v.length; j++) {
                        var op = obj.v[j];
                        if (typeof op.o === 'string' && typeof op.p === 'string') applyOp(op);
                      }
                      continue;
                    }
                  } catch(e) {}
                }
                pump();
              }).catch(function() { window.__surfChatResponse.done = true; });
            }
            pump();
          }).catch(function() {});
        }
        return result;
      };
    })()
  `);
}

async function readStreamResponse(page) {
  return await page.evaluate(`window.__surfChatResponse || { text: '', done: false, messageId: null, model: null }`);
}

// ============================================================================
// Text arbitration + stability — local equivalents of bun helpers

// Note: streamDone accepted to match bun helper call shape but not consulted here
function chooseBestText({ streamText, domText, streamDone, domFinished }) {
  if (domFinished && domText.length > 0) return domText;
  if (streamText.length > 0) return streamText;
  return domText || streamText;
}

function advanceTextStability({ text, previousText, isStreaming, finished, stableCycles, lastChangeAtMs, nowMs, requiredStableCycles, minStableMs }) {
  if (text !== previousText) return { stableCycles: 0, lastChangeAtMs: nowMs, shouldComplete: false };
  if (finished && text.length > 0) return { stableCycles: stableCycles + 1, lastChangeAtMs, shouldComplete: true };
  const newStable = stableCycles + 1;
  const stableMs = nowMs - lastChangeAtMs;
  if (!isStreaming && text.length > 0 && newStable >= requiredStableCycles && stableMs >= minStableMs) {
    return { stableCycles: newStable, lastChangeAtMs, shouldComplete: true };
  }
  return { stableCycles: newStable, lastChangeAtMs, shouldComplete: false };
}

// ============================================================================
// Thinking trace extraction — reads React fiber state (works headless)

// Max thoughts to return (cap payload size for very long Pro sessions)
const MAX_THINKING_TRACE_THOUGHTS = 100;
const MAX_THOUGHT_CONTENT_CHARS = 2000;

// Accepts optional turnId to scope extraction to the current response turn.
// Falls back to last assistant turn if turnId not provided.
const makeExtractThinkingTraceJS = (rawTurnId) => {
  // Sanitize turnId — only allow alphanumeric, hyphens, underscores (data-testid values)
  const turnId = rawTurnId && /^[a-zA-Z0-9_-]+$/.test(rawTurnId) ? rawTurnId : null;
  return `(() => {
  ${FIND_LAST_ASSISTANT_JS}
  // Scope to specific turn if turnId provided, otherwise use last assistant
  var targetTurn = null;
  ${turnId ? `
  var specificTurn = document.querySelector('[data-testid="${turnId}"]');
  if (specificTurn) targetTurn = specificTurn;
  ` : ''}
  if (!targetTurn) targetTurn = lastAssistant;
  if (!targetTurn) return null;

  // Find "Thought for" / "Thinking for" button WITHIN the target turn only
  var buttons = Array.from(targetTurn.querySelectorAll('button'));
  var thoughtBtn = buttons.find(function(b) {
    return /Thought for|Thinking for/i.test(b.innerText || b.textContent);
  });
  if (!thoughtBtn) return null;

  // Walk React fiber tree to find allMessages with thinking data
  var fiberKey = Object.keys(thoughtBtn).find(function(k) { return k.startsWith('__reactFiber$'); });
  if (!fiberKey) return null;

  var MAX_THOUGHTS = ${MAX_THINKING_TRACE_THOUGHTS};
  var MAX_CONTENT = ${MAX_THOUGHT_CONTENT_CHARS};
  var fiber = thoughtBtn[fiberKey];
  var depth = 0;
  while (fiber && depth < 50) {
    if (fiber.memoizedProps && fiber.memoizedProps.allMessages) {
      var msgs = fiber.memoizedProps.allMessages;
      var thoughts = [];
      var durationSec = null;
      var recapText = null;
      var _debugContentTypes = [];

      for (var i = 0; i < msgs.length; i++) {
        var m = msgs[i];
        if (!m || !m.content) continue;
        if (m.content.content_type) _debugContentTypes.push(m.content.content_type);

        // Extract thoughts array (point-by-point reasoning trace)
        if (m.content.content_type === 'thoughts' && Array.isArray(m.content.thoughts)) {
          for (var j = 0; j < m.content.thoughts.length && thoughts.length < MAX_THOUGHTS; j++) {
            var t = m.content.thoughts[j];
            if (typeof t === 'string') {
              thoughts.push({ summary: '', content: t.slice(0, MAX_CONTENT) });
            } else if (t && typeof t === 'object') {
              var chunkText = Array.isArray(t.chunks)
                ? t.chunks.filter(function(c) { return typeof c === 'string'; }).join('')
                : '';
              var contentText = '';
              if (typeof t.content === 'string' && t.content) contentText = t.content;
              else if (chunkText) contentText = chunkText;
              thoughts.push({
                summary: (t.summary || '').slice(0, 200),
                content: contentText.slice(0, MAX_CONTENT),
                finished: t.finished === true,
              });
            }
          }
        }

        // Extract duration and recap from reasoning_recap message
        if (m.content.content_type === 'reasoning_recap') {
          recapText = m.content.content || null;
          if (m.metadata && typeof m.metadata.finished_duration_sec === 'number') {
            durationSec = m.metadata.finished_duration_sec;
          }
        }
      }

      if (thoughts.length === 0 && !recapText) return null;
      return {
        thoughts: thoughts,
        durationSec: durationSec,
        recapText: recapText,
        truncated: thoughts.length >= MAX_THOUGHTS,
        _debugContentTypes: _debugContentTypes,
      };
    }
    fiber = fiber.return;
    depth++;
  }
  return null;
})()`;
};

async function extractThinkingTrace(page, turnId) {
  try {
    const js = makeExtractThinkingTraceJS(turnId || null);
    const result = await page.evaluate(js);
    return result;
  } catch (e) {
    log('warn', 'Thinking trace extraction failed', { error: e.message });
    return null;
  }
}

// ============================================================================
// Image detection + save — uses unified assistant-root resolution

async function detectAndSaveImage(page, savePath) {
  const imgData = await page.evaluate(`(() => {
    ${FIND_LAST_ASSISTANT_JS}
    if (!lastAssistant) return null;
    var imgs = lastAssistant.querySelectorAll('img:not([alt="User"]):not([alt="ChatGPT"])');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (img.naturalWidth > 100 && img.naturalHeight > 100) {
        return { src: img.src, width: img.naturalWidth, height: img.naturalHeight };
      }
    }
    return null;
  })()`);

  if (!imgData) return null;

  log('info', 'Image candidate found', { width: imgData.width, height: imgData.height });

  // Fetch image bytes in page context (handles auth/CORS)
  const base64 = await page.evaluate(async (src) => {
    try {
      const resp = await fetch(src);
      const buf = await resp.arrayBuffer();
      return btoa(String.fromCharCode(...new Uint8Array(buf)));
    } catch { return null; }
  }, imgData.src);

  if (!base64) {
    log('warn', 'Image fetch failed');
    return null;
  }

  const resolved = pathResolve(savePath);
  const dir = join(resolved, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(resolved, Buffer.from(base64, 'base64'));
  log('info', 'Image saved', { path: resolved, bytes: Buffer.from(base64, 'base64').length });
  return resolved;
}

// ============================================================================
// Main query handler

async function runQuery({ prompt, model, file, profile, timeout = DEFAULT_CHATGPT_QUERY_TIMEOUT_SEC, generateImage, conversationId }) {
  const t0 = Date.now();
  const resolved = resolveModel(model);
  const useInjectedProfile = !!profile;
  let tempDir = null;
  let context = null;

  // ── Phase 1: Launch ──────────────────────────────────────────────────
  progress(1, 6, `Launching CloakBrowser — ${resolved.mode}`);

  // Profile strategy:
  // - With --profile: temp dir + injected cookies (isolated, no contamination)
  // - Without: shared persistent dir (relies on prior login)
  let userDataDir;
  if (useInjectedProfile) {
    tempDir = tempProfileDir();
    userDataDir = tempDir;
    log('info', 'Using isolated profile for cookie injection', { tempDir });
  } else {
    userDataDir = sharedProfileDir({ log });
    log('info', 'Using shared persistent profile');
  }

  // Cleanup on forced kill
  const cleanup = async () => {
    try { await context.close(); } catch {}
    if (tempDir) try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  };
  process.on('SIGTERM', () => cleanup().then(() => process.exit(1)));
  process.on('SIGINT', () => cleanup().then(() => process.exit(1)));

  try {
    context = await launchPersistentContextWithRecovery({
      launchPersistentContext,
      userDataDir,
      isSharedProfile: !useInjectedProfile,
      log,
    });
    log('info', 'CloakBrowser launched', {
      headless: true,
      humanize: true,
    });

    const page = context.pages()[0] || await context.newPage();

    // ── Phase 2: Cookie injection (if --profile) ─────────────────────
    if (useInjectedProfile) {
      progress(2, 6, `Authenticating — ${profile}`);
      try {
        const authResult = await loadAndInjectChatgptCookies(context, {
          profileEmail: profile,
          log: (msg) => log('info', msg),
        });
        log('info', 'Cookie auth complete', authResult);
      } catch (e) {
        fail(e.code || 'auth_failed', e.message);
        return;
      }
    } else {
      progress(2, 6, 'Using existing session');
    }

    // ── Phase 3: Navigate ────────────────────────────────────────────
    progress(3, 6, conversationId ? 'Loading conversation' : 'Loading ChatGPT');
    const targetUrl = conversationId
      ? `https://chatgpt.com/c/${encodeURIComponent(conversationId)}`
      : 'https://chatgpt.com/';
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await sleep(2000); // human-like dwell

    if (conversationId) {
      const convoReady = await waitForConversationReady(page, conversationId, 30_000);
      log('info', 'Conversation page state', convoReady);
      if (!convoReady.loggedIn) {
        fail('login_required',
          useInjectedProfile
            ? `Login failed for profile "${profile}". Session cookie may be expired.`
            : 'ChatGPT login required. Use --profile <email> or authenticate the shared ~/.surf/cloak-profile session.'
        );
        return;
      }
      if (!convoReady.ready) {
        const code = convoReady.currentUrl.includes(`/c/${conversationId}`)
          ? 'conversation_load_timeout'
          : 'conversation_not_found';
        fail(code, `Failed to load conversation ${conversationId}`);
        return;
      }
    } else {
      const { ready, loggedIn } = await waitForReady(page, 30_000);
      log('info', 'Page state', { ready, loggedIn });

      if (!ready) {
        fail('ui_timeout', 'ChatGPT page did not become ready within 30s');
        return;
      }
      if (!loggedIn) {
        fail('login_required',
          useInjectedProfile
            ? `Login failed for profile "${profile}". Session cookie may be expired.`
            : 'ChatGPT login required. Use --profile <email> or authenticate the shared ~/.surf/cloak-profile session.'
        );
        return;
      }
    }

    // ── Inject SSE stream capture (must be before any send) ──────────
    await injectFetchStreamCapture(page);
    log('info', 'SSE stream capture injected');

    // ── Phase 4: Model selection ─────────────────────────────────────
    if (resolved.tid) {
      progress(4, 6, `Selecting model — ${resolved.mode}`);
      try {
        const dropdown = page.locator('[data-testid="model-switcher-dropdown-button"]').first();
        await dropdown.click({ timeout: 5_000 });
        await sleep(600);
        const modelBtn = page.locator(`[data-testid="${resolved.tid}"]`).first();
        await modelBtn.click({ timeout: 5_000 });
        await sleep(400);
        log('info', 'Model selected', { mode: resolved.mode, tid: resolved.tid });
      } catch (e) {
        log('warn', 'Model selection failed (continuing with default)', { error: e.message });
      }
    } else {
      progress(4, 6, 'Using default model');
    }

    // ── Phase 5: File upload + send prompt ───────────────────────────
    progress(5, 6, file ? `Uploading ${file.split('/').pop()} + sending prompt` : 'Sending prompt');

    // File upload
    if (file && existsSync(file)) {
      try {
        // Click the attach button first to reveal file input
        const attachBtn = page.locator('button[aria-label*="Attach"], button[data-testid="composer-attach-button"]').first();
        const hasAttach = await attachBtn.count() > 0;
        if (hasAttach) {
          await attachBtn.click({ timeout: 5_000 });
          await sleep(500);
        }

        // Find and use file input
        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.setInputFiles(file);
        await sleep(3_000); // wait for upload
        log('info', 'File attached', { file });
      } catch (e) {
        log('warn', 'File upload failed', { error: e.message });
      }
    }

    // Prompt entry — try each selector until one matches
    let textarea = null;
    let promptSelector = PROMPT_SELECTORS_CSS;
    for (const sel of PROMPT_SELECTOR_LIST) {
      const loc = page.locator(sel).first();
      const count = await loc.count().catch(() => 0);
      if (count > 0) {
        textarea = loc;
        promptSelector = sel;
        log('info', `Composer found: ${sel}`);
        break;
      }
    }
    if (!textarea) {
      fail('composer_not_found', 'No editable ChatGPT composer found', { triedSelectors: PROMPT_SELECTOR_LIST });
      return;
    }
    await textarea.click({ timeout: 10_000 });
    await sleep(500);
    for (const sel of PROMPT_SELECTOR_LIST) {
      const loc = page.locator(sel).first();
      const count = await loc.count().catch(() => 0);
      if (count > 0) {
        textarea = loc;
        promptSelector = sel;
        log('info', `Composer active: ${sel}`);
        break;
      }
    }

    // Prepare prompt (prefix for image generation)
    let finalPrompt = prompt;
    if (generateImage && !prompt.toLowerCase().startsWith('generate')) {
      finalPrompt = `Generate an image: ${prompt}`;
    }

    // Token estimation: ~4 chars/token for English text
    const promptBytes = Buffer.byteLength(finalPrompt, 'utf-8');
    const promptKB = (promptBytes / 1024).toFixed(1);
    const promptLines = finalPrompt.split('\n').length;
    const estimatedTokens = Math.ceil(finalPrompt.length / 4);
    const tokenKStr = (estimatedTokens / 1000).toFixed(1) + 'K';
    log('info', `Prompt: ${promptKB}KB, ${promptLines} lines, ~${tokenKStr} tokens`);
    if (estimatedTokens > 120_000) {
      log('warn', `⚠ Prompt ~${tokenKStr} tokens — approaching GPT Pro 150K limit`);
    }

    const promptEntry = await enterPromptWithVerification({
      page,
      textarea,
      prompt: finalPrompt,
      log,
      sleep,
      promptSelector,
      sendButtonSelectors: SEND_BUTTON_SELECTORS,
    });
    log('info', 'Prompt entry metrics', promptEntry);
    await sleep(300);

    let baselineUserNodeId = null;
    if (conversationId) {
      const baselineUser = await captureBaselineUserNodeId(page, conversationId);
      if (baselineUser?.ok) {
        baselineUserNodeId = baselineUser.baselineUserNodeId || null;
        log('info', 'Baseline user captured', { conversationId, baselineUserNodeId });
      } else {
        log('warn', 'Baseline user capture failed', baselineUser);
      }
    }

    // Capture baseline before send (detect stale assistant turns)
    // Use data-message-id (backend message UUID) not data-testid (DOM turn id)
    const baseline = await page.evaluate(EXTRACT_TEXT_JS);
    const baselineText = sanitize(baseline.text || '');
    const baselineTurnId = baseline.turnId || null; // For DOM change detection
    const baselineMessageId = baseline.messageId || null; // For reconcile API comparison
    log('info', 'Baseline captured', { turnId: baselineTurnId, messageId: baselineMessageId });

    const sendAttempt = await attemptSendAndConfirm({
      page,
      textarea,
      promptEntry,
      finalPrompt,
      conversationId,
      baselineUserNodeId,
    });
    const sentAt = sendAttempt.sentAt;
    log('info', 'Send confirmed', {
      method: sendAttempt.method,
      selector: sendAttempt.selector || null,
      confirmationSource: sendAttempt.confirmationSource,
      conversationId: sendAttempt.conversationId || conversationId || null,
      attemptError: sendAttempt.attemptError || null,
    });

    conversationId = sendAttempt.conversationId || conversationId;

    if (!conversationId) {
      conversationId = await resolveConversationIdForValidation(page, conversationId, 30_000);
    }

    if (!conversationId) {
      fail(
        'send_not_confirmed',
        'Prompt send could not be confirmed: conversationId did not resolve after send',
        { failureReason: 'conversation_id_unresolved' },
      );
      return;
    }

    const sentPromptValidation = sendAttempt.validation?.ok
      ? sendAttempt.validation
      : await waitForPromptPersistenceValidation({
          page,
          conversationId,
          expectedPrompt: finalPrompt,
          baselineUserNodeId,
          timeoutMs: 30_000,
          pollMs: 1_000,
        });
    const validationSummary = summarizePromptValidation(sentPromptValidation);
    log('info', 'Sent prompt validation', validationSummary);
    if (!sentPromptValidation.ok) {
      const failureReason = sentPromptValidation.failureReason || sentPromptValidation.code || 'prompt_sent_validation_failed';
      fail(
        failureReason === 'file_map_placeholder' ? 'prompt_materialized_as_file_map' : 'prompt_sent_validation_failed',
        failureReason === 'file_map_placeholder'
          ? 'Prompt sent incorrectly: latest user message became <file_map> instead of inline prompt'
          : failureReason === 'big_paste_attachment'
            ? 'Prompt sent incorrectly: latest user message materialized as big-paste attachment'
            : `Prompt sent incorrectly: ${validationSummary.actualChars || 0}/${validationSummary.expectedChars || 0} chars persisted`,
        validationSummary,
      );
      return;
    }

    emit({
      type: 'meta_update',
      source: 'prompt_persisted',
      lastCheckpoint: 'sent',
      sentAt,
      conversationId: conversationId || null,
      baselineAssistantMessageId: baselineMessageId || null,
      t: Date.now(),
    });

    // ── Phase 6: Wait for response (hybrid stream + DOM) ────────────
    progress(6, 6, 'Waiting for response');

    const timeoutSec = resolveQueryTimeoutSeconds(timeout);
    const timeoutMs = timeoutSec * 1000;
    const keepaliveIntervalMs = resolveKeepaliveIntervalMs(timeoutSec);
    let deadline = Date.now() + timeoutMs;
    let responseText = '';
    let sawActivity = false;
    let capturedModel = null;
    let stableCycles = 0;
    let lastChangeAtMs = Date.now();
    let lastText = '';
    let lastPhase = '';
    let imagePath = null;
    let responseTurnId = null;
    let liveThinkingTrace = null;
    let lastThinkingText = '';
    let lastStreamText = '';
    let lastStreamChangeAtMs = Date.now();
    let lastKeepaliveAtMs = 0;
    let timedOut = false;

    const noteActivity = (reason) => {
      const now = Date.now();
      deadline = now + timeoutMs;
      if ((now - lastKeepaliveAtMs) >= keepaliveIntervalMs) {
        emit({ type: 'keepalive', reason, phase: lastPhase || 'Waiting for response' });
        lastKeepaliveAtMs = now;
      }
    };

    while (true) {
      if (Date.now() >= deadline) {
        timedOut = true;
        break;
      }
      await sleep(500);

      // 1. Detect phase
      const phaseResult = await page.evaluate(DETECT_PHASE_JS);
      const phase = (phaseResult && phaseResult.phase) || '';
      const previousPhase = lastPhase;
      if (phase && phase !== lastPhase) {
        log('info', `⏳ ${phase}`);
        emit({ type: 'trace', phase, isThinking: !!(phaseResult && phaseResult.isThinking) });
        lastPhase = phase;
      }

      // 2. DOM snapshot (structured)
      const dom = await page.evaluate(EXTRACT_TEXT_JS);
      const sanitizedDom = sanitize(dom.text || '');

      // 3. Stream snapshot
      const stream = await readStreamResponse(page);
      if (stream.model) capturedModel = stream.model;

      // 4. Streaming state
      const isStreaming = await page.evaluate(IS_ACTIVE_STOP_BUTTON_JS);

      // 5. Arbitrate best text
      const currentText = chooseBestText({
        streamText: stream.text || '',
        domText: sanitizedDom,
        streamDone: !!stream.done,
        domFinished: !!dom.finished,
      });

      // Track activity — only if we see a NEW turn (not baseline stale content)
      const observedTurnId = dom.turnId || null;
      const isNewTurn = observedTurnId && observedTurnId !== baselineTurnId;
      const previousTurnId = responseTurnId;
      if (isNewTurn) responseTurnId = observedTurnId;
      const isThinkingPhase = !!(phaseResult && phaseResult.isThinking);
      const fullThinkingText = isThinkingPhase ? (phaseResult.thinkingText || '').trim() : '';
      const activity = detectResponseActivity({
        phase,
        previousPhase,
        turnId: responseTurnId || null,
        previousTurnId: previousTurnId || null,
        observedTurnId,
        baselineTurnId,
        currentText,
        previousText: lastText,
        baselineText,
        streamText: stream.text || '',
        previousStreamText: lastStreamText,
        thinkingText: fullThinkingText,
        previousThinkingText: lastThinkingText,
        trustedActivitySeen: sawActivity,
      });
      if (activity.active) {
        sawActivity = true;
        noteActivity(activity.reasons[0] || 'response');
      }
      const streamText = stream.text || '';
      if (streamText !== lastStreamText) {
        lastStreamText = streamText;
        lastStreamChangeAtMs = Date.now();
      }
      const isBaselineTurn = !!(baselineTurnId && observedTurnId && observedTurnId === baselineTurnId);
      const isBaselineResponseSnapshot = !!(
        isBaselineTurn &&
        baselineText &&
        currentText === baselineText &&
        !streamText
      );
      if (!sawActivity) continue;

      // Detect conversationId from URL for new conversations (URL becomes /c/{id} once activity starts)
      if (!conversationId) {
        try {
          const detectedConversationId = extractConversationIdFromUrl(page.url());
          if (detectedConversationId) {
            conversationId = detectedConversationId;
            emit({ type: 'meta_update', conversationId, source: 'url', t: Date.now() });
          }
        } catch {}
      }

      // 5b. Live thinking trace — emit DOM thinking text as deltas
      if (isThinkingPhase) {
        // DOM-based delta emission (timer line already stripped in DETECT_PHASE_JS)
        const fullText = fullThinkingText;
        if (fullText && fullText !== lastThinkingText) {
          let delta;
          if (lastThinkingText && fullText.startsWith(lastThinkingText)) {
            delta = fullText.slice(lastThinkingText.length).replace(/^\n+/, '');
          } else {
            delta = fullText;
          }
          // Cap emitted delta to 4k to avoid flooding CLI; source state is uncapped
          if (delta.trim()) {
            emit({
              type: 'trace',
              traceType: 'thinking_text',
              phase: phase || 'Thinking',
              isThinking: true,
              thoughtText: fullText.slice(0, 8000),
              thoughtDelta: delta.slice(0, 4000),
            });
          }
          lastThinkingText = fullText;
        }
        // Fiber extraction (independent of DOM text — may populate later in thinking)
        try {
          const nextTrace = await extractThinkingTrace(page, responseTurnId || null);
          if (nextTrace) liveThinkingTrace = nextTrace;
        } catch {}
      }

      // 6. Completion: stream.done with stream text = authoritative
      if (stream.done && stream.text && stream.text.length > 0) {
        responseText = currentText || sanitizedDom || stream.text;
        break;
      }

      // 7. DOM stability fallback (requiredStableCycles=4, minStableMs=2500)
      // While model is still in thinking phase (stop button visible + thinking label),
      // treat as streaming to prevent premature completion on thinking-phase text.
      // (isThinkingPhase already computed in step 5b above)
      const stability = advanceTextStability({
        text: currentText,
        previousText: lastText,
        isStreaming: isStreaming || isThinkingPhase,
        finished: !!dom.finished && !isThinkingPhase,
        stableCycles,
        lastChangeAtMs,
        nowMs: Date.now(),
        requiredStableCycles: 4,
        minStableMs: 2500,
      });
      stableCycles = stability.stableCycles;
      lastChangeAtMs = stability.lastChangeAtMs;
      lastText = currentText;

      if (stability.shouldComplete && currentText.length > 0 && !isBaselineResponseSnapshot) {
        responseText = currentText;
        break;
      }

      const nowMs = Date.now();
      const phaseLooksFinalizing = /^Finalizing\b/i.test(phase || '');
      const textStableMs = nowMs - lastChangeAtMs;
      const streamStableMs = nowMs - lastStreamChangeAtMs;
      if (
        currentText.length > 0 &&
        sawActivity &&
        phaseLooksFinalizing &&
        textStableMs >= 20000 &&
        streamStableMs >= 20000 &&
        !isBaselineResponseSnapshot
      ) {
        log('warn', 'Completing response after finalizing-phase stability fallback', {
          textStableMs,
          streamStableMs,
          phase,
        });
        responseText = currentText;
        break;
      }

      if (currentText && !isBaselineResponseSnapshot) responseText = currentText;
    }

    // Thinking trace extraction (post-response, from React fiber state)
    // Fall back to live-captured trace if final extraction fails
    let thinkingTrace = liveThinkingTrace;
    try {
      const finalTrace = await extractThinkingTrace(page, responseTurnId);
      if (finalTrace) {
        thinkingTrace = finalTrace;
        log('info', 'Thinking trace captured', {
          thoughtCount: finalTrace.thoughts?.length || 0,
          durationSec: finalTrace.durationSec,
          recapText: finalTrace.recapText,
          _debugContentTypes: finalTrace._debugContentTypes,
        });
      } else if (liveThinkingTrace) {
        log('info', 'Using live-captured thinking trace (final extraction empty)', {
          thoughtCount: liveThinkingTrace.thoughts?.length || 0,
        });
      }
    } catch (e) {
      log('warn', 'Thinking trace extraction error', { error: e.message });
    }

    // Image detection
    if (generateImage && responseText) {
      try {
        imagePath = await detectAndSaveImage(page, generateImage);
      } catch (e) {
        log('warn', 'Image detection/save failed', { error: e.message });
      }
    }

    const durationMs = Date.now() - t0;

    if (!responseText) {
      fail('no_response', 'No response text captured within timeout');
      return;
    }

    success({
      response: responseText,
      model: capturedModel || model || resolved.mode,
      tookMs: durationMs,
      imagePath,
      partial: timedOut,
      backend: 'cloak',
      conversationId: conversationId || null,
      thinkingTrace: thinkingTrace || undefined,
    });

  } catch (e) {
    log('error', 'Query failed', { error: e.message, stack: e.stack, code: e.code });
    fail(e.code || 'query_failed', e.message, e.details);
  } finally {
    if (context) {
      try { await context.close(); } catch {}
    }
    if (tempDir) {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  }
}

// ============================================================================
// Stdin protocol — read one query, run it, exit.

async function main() {
  log('info', 'CloakBrowser worker started');

  let buffer = '';
  let resolved = false;

  const queryPromise = new Promise((resolve) => {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'query' && !resolved) {
            resolved = true;
            resolve(msg);
          }
        } catch {
          fail('protocol', 'Invalid JSON');
        }
      }
    });
    process.stdin.on('end', () => {
      if (!resolved) resolve(null);
    });
  });

  const msg = await queryPromise;
  if (msg) {
    await runQuery(msg).catch(e => fail('unhandled', e.message, e.details));
  } else {
    fail('no_query', 'Stdin closed without receiving a query');
  }

  process.exit(0);
}

main().catch(e => {
  fail('fatal', e.message, e.details);
  process.exit(1);
});

```

File: /Users/danielsivan/dev/surf-cli/native/chatgpt-cloak-chats-worker.mjs
```mjs
/**
 * ChatGPT CloakBrowser Chats Worker
 *
 * Read-only / light-management access to ChatGPT conversations via backend API,
 * executed inside the authenticated browser context with page.evaluate(fetch()).
 */

import { launchPersistentContext } from 'cloakbrowser';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { join, dirname, resolve as pathResolve } from 'path';
import { loadAndInjectChatgptCookies } from './chatgpt-cloak-profile-auth.mjs';
import {
  filterConversationSearchItems,
  mergeConversationSearchItems,
  normalizeConversationSearchItems,
} from './chatgpt-chats-search.mjs';

const require = createRequire(import.meta.url);
const {
  classifyConversationProgress,
} = require('./chatgpt-conversation-state.cjs');
const {
  launchPersistentContextWithRecovery,
  sharedProfileDir,
  tempProfileDir,
} = require('./chatgpt-cloak-runtime.cjs');

const emit = (obj) => process.stdout.write(JSON.stringify({ ...obj, t: Date.now() }) + '\n');
const log = (level, message, data) => emit({ type: 'log', level, message, data });
const progress = (step, total, message) => emit({ type: 'progress', step, total, message });
const success = (payload) => emit({ type: 'success', ...payload });
const fail = (code, message, details) => emit({ type: 'error', code, message, details });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForReady(page, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      if (document.title.toLowerCase().includes('just a moment')) return 'cloudflare';
      if (document.querySelector('#prompt-textarea')) return 'ready';
      const btns = Array.from(document.querySelectorAll('button, a'));
      if (btns.some((b) => /^(log in|sign in|sign up)$/i.test((b.textContent || '').trim()))) return 'login';
      return 'loading';
    });

    if (state === 'ready') return { ready: true, loggedIn: true };
    if (state === 'login') return { ready: true, loggedIn: false };
    if (state === 'cloudflare') log('warn', 'Cloudflare challenge detected, waiting...');
    await sleep(1000);
  }
  return { ready: false, loggedIn: false };
}

function buildBackendError(error, fallbackCode = 'backend_error') {
  if (!error || typeof error !== 'object') {
    return { code: fallbackCode, message: String(error || 'Unknown error') };
  }

  const status = Number.isFinite(error.status) ? error.status : undefined;
  const body = error.body;
  let code = error.code || fallbackCode;
  if (status === 401 || status === 403) code = 'login_required';
  else if (status === 404) code = 'conversation_not_found';
  else if (status === 429) code = 'rate_limited';
  else if (status >= 500) code = 'backend_error';

  return {
    code,
    status,
    body,
    message: error.message || `HTTP ${status || 500}`,
  };
}

async function fetchBackendJson(page, { pathname, method = 'GET', body } = {}) {
  const result = await page.evaluate(async (request) => {
    const readCookie = (name) => {
      const prefix = `${name}=`;
      for (const part of document.cookie.split(';')) {
        const trimmed = part.trim();
        if (trimmed.startsWith(prefix)) return decodeURIComponent(trimmed.slice(prefix.length));
      }
      return null;
    };

    const safeJson = async (response) => {
      const text = await response.text();
      if (!text) return { text: '', json: null };
      try {
        return { text, json: JSON.parse(text) };
      } catch {
        return { text, json: null };
      }
    };

    try {
      const sessionResp = await fetch('/api/auth/session', { credentials: 'same-origin' });
      const sessionPayload = await safeJson(sessionResp);
      const accessToken = sessionPayload.json?.accessToken;
      if (!sessionResp.ok || !accessToken) {
        return {
          ok: false,
          error: {
            code: 'login_required',
            status: sessionResp.status || 401,
            message: 'ChatGPT session unavailable — missing access token',
            body: sessionPayload.text,
          },
        };
      }

      const response = await fetch(request.pathname, {
        credentials: 'same-origin',
        method: request.method || 'GET',
        body: request.body,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Oai-Device-Id': readCookie('oai-did') || crypto.randomUUID(),
          'Oai-Language': 'en-US',
        },
      });
      const payload = await safeJson(response);
      if (!response.ok) {
        return {
          ok: false,
          error: {
            status: response.status,
            body: payload.text,
            message:
              payload.json?.detail ||
              payload.json?.message ||
              payload.json?.error ||
              `HTTP ${response.status}`,
          },
        };
      }
      return { ok: true, data: payload.json };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: error?.code || 'backend_error',
          status: Number.isFinite(error?.status) ? error.status : undefined,
          message: error?.message || String(error),
          body: error?.body,
        },
      };
    }
  }, { pathname, method, body });

  if (!result?.ok) {
    const mapped = buildBackendError(result?.error, 'backend_error');
    throw Object.assign(new Error(mapped.message), mapped);
  }
  return result.data;
}

async function searchConversations(page, { query, limit } = {}) {
  const requestedLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.trunc(Number(limit))) : 20;

  // Try backend search first; if it fails entirely, fall through to local scan
  let backendItems = [];
  let backendTotal = 0;
  let backendSearchFailed = false;
  try {
    const backendPayload = await fetchBackendJson(page, {
      pathname: `/backend-api/conversations/search?query=${encodeURIComponent(query)}`,
    });
    backendItems = normalizeConversationSearchItems(backendPayload);
    backendTotal = Number.isFinite(Number(backendPayload?.total)) ? Number(backendPayload.total) : backendItems.length;
  } catch (err) {
    log('warn', 'Backend search failed, falling back to local scan', { error: err.message, code: err.code });
    backendSearchFailed = true;
  }
  let mergedItems = mergeConversationSearchItems(backendItems);

  let fallbackScanned = 0;
  let fallbackTotal = 0;
  let partial = false;

  if (mergedItems.length < requestedLimit) {
    let offset = 0;
    let total = 0;
    let pagesFetched = 0;
    const maxLocalPages = Number.isFinite(Number(limit)) ? Math.max(3, Math.ceil(requestedLimit / 100)) : 3;

    while (pagesFetched < maxLocalPages) {
      const listPayload = await fetchBackendJson(page, {
        pathname: `/backend-api/conversations?offset=${offset}&limit=100`,
      });
      const batch = Array.isArray(listPayload?.items) ? listPayload.items : [];
      mergedItems = mergeConversationSearchItems(mergedItems, filterConversationSearchItems(batch, query));
      total = Number.isFinite(Number(listPayload?.total)) ? Number(listPayload.total) : Math.max(total, offset + batch.length);
      fallbackScanned += batch.length;
      fallbackTotal = total;
      pagesFetched += 1;
      if (mergedItems.length >= requestedLimit) break;
      if (batch.length === 0 || offset + batch.length >= total) break;
      offset += batch.length;
    }

    partial = fallbackTotal > 0 && fallbackScanned < fallbackTotal && mergedItems.length < requestedLimit;
  }

  return {
    action: 'search',
    query,
    items: mergedItems.slice(0, requestedLimit),
    total: Math.max(backendTotal, mergedItems.length),
    limit: requestedLimit,
    partial,
    backendSearchFailed,
    fallbackScanned,
    fallbackTotal,
  };
}

async function callBackend(page, request) {
  const result = await page.evaluate(async (req) => {
    const readCookie = (name) => {
      const prefix = `${name}=`;
      for (const part of document.cookie.split(';')) {
        const trimmed = part.trim();
        if (trimmed.startsWith(prefix)) return decodeURIComponent(trimmed.slice(prefix.length));
      }
      return null;
    };

    const safeJson = async (response) => {
      const text = await response.text();
      if (!text) return { text: '', json: null };
      try {
        return { text, json: JSON.parse(text) };
      } catch {
        return { text, json: null };
      }
    };

    try {
      const sessionResp = await fetch('/api/auth/session', { credentials: 'same-origin' });
      const sessionPayload = await safeJson(sessionResp);
      const accessToken = sessionPayload.json?.accessToken;
      if (!sessionResp.ok || !accessToken) {
        return {
          ok: false,
          error: {
            code: 'login_required',
            status: sessionResp.status || 401,
            message: 'ChatGPT session unavailable — missing access token',
            body: sessionPayload.text,
          },
        };
      }

      const baseHeaders = {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Oai-Device-Id': readCookie('oai-did') || crypto.randomUUID(),
        'Oai-Language': 'en-US',
      };

      const api = async (pathname, init = {}) => {
        const response = await fetch(pathname, {
          credentials: 'same-origin',
          ...init,
          headers: {
            ...baseHeaders,
            ...(init.headers || {}),
          },
        });
        const payload = await safeJson(response);
        if (!response.ok) {
          return {
            ok: false,
            error: {
              status: response.status,
              body: payload.text,
              message:
                payload.json?.detail ||
                payload.json?.message ||
                payload.json?.error ||
                `HTTP ${response.status}`,
            },
          };
        }
        return { ok: true, data: payload.json };
      };

      if (req.action === 'list') {
        const requestedLimit = Number.isFinite(Number(req.limit)) ? Math.max(1, Math.trunc(Number(req.limit))) : 20;
        const items = [];
        let offset = 0;
        let total = 0;

        while (true) {
          const remaining = req.all ? 100 : Math.max(1, Math.min(100, requestedLimit - items.length));
          const response = await api(`/backend-api/conversations?offset=${offset}&limit=${remaining}`);
          if (!response.ok) return response;
          const payload = response.data || {};
          const batch = Array.isArray(payload.items) ? payload.items : [];
          items.push(...batch);
          total = Number.isFinite(Number(payload.total)) ? Number(payload.total) : Math.max(total, items.length);
          if (!req.all && items.length >= requestedLimit) break;
          if (batch.length === 0 || items.length >= total) break;
          offset += batch.length;
        }

        return {
          ok: true,
          data: {
            action: 'list',
            items,
            total,
            offset: 0,
            limit: req.all ? items.length : requestedLimit,
            all: !!req.all,
          },
        };
      }

      if (req.action === 'search') {
        const query = String(req.query || '').trim();
        if (!query) {
          return { ok: false, error: { code: 'invalid_request', message: 'Search query is required' } };
        }
        const response = await api(`/backend-api/conversations/search?query=${encodeURIComponent(query)}`);
        if (!response.ok) return response;
        const payload = response.data;
        const rawItems = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.items)
            ? payload.items
            : Array.isArray(payload?.results)
              ? payload.results
              : [];
        const items = rawItems.map((item) => ({
          id: item.id || item.conversation_id || item.conversationId || null,
          conversation_id: item.conversation_id || item.id || item.conversationId || null,
          title: item.title || '(untitled)',
          create_time: item.create_time || item.createTime || null,
          update_time: item.update_time || item.updateTime || null,
          current_node_id: item.current_node_id || item.currentNodeId || null,
          snippet: item.snippet || item.payload?.snippet || null,
          is_archived: item.is_archived ?? false,
        })).filter((item) => item.id || item.conversation_id);
        const requestedLimit = Number.isFinite(Number(req.limit)) ? Math.max(1, Math.trunc(Number(req.limit))) : items.length;
        return {
          ok: true,
          data: {
            action: 'search',
            query,
            items: items.slice(0, requestedLimit),
            total: Number.isFinite(Number(payload?.total)) ? Number(payload.total) : items.length,
            limit: requestedLimit,
          },
        };
      }

      if (req.action === 'get') {
        const conversationId = String(req.conversationId || '').trim();
        if (!conversationId) {
          return { ok: false, error: { code: 'invalid_request', message: 'Conversation ID is required' } };
        }
        const response = await api(`/backend-api/conversation/${encodeURIComponent(conversationId)}`);
        if (!response.ok) return response;
        return {
          ok: true,
          data: {
            action: 'get',
            conversationId,
            conversation: response.data,
          },
        };
      }

      if (req.action === 'rename') {
        const conversationId = String(req.conversationId || '').trim();
        const title = String(req.title || '').trim();
        if (!conversationId || !title) {
          return { ok: false, error: { code: 'invalid_request', message: 'Conversation ID and title are required' } };
        }
        const response = await api(`/backend-api/conversation/${encodeURIComponent(conversationId)}`, {
          method: 'PATCH',
          body: JSON.stringify({ title }),
        });
        if (!response.ok) return response;
        return { ok: true, data: { action: 'rename', conversationId, title, result: response.data } };
      }

      if (req.action === 'delete') {
        const conversationId = String(req.conversationId || '').trim();
        if (!conversationId) {
          return { ok: false, error: { code: 'invalid_request', message: 'Conversation ID is required' } };
        }

        const hideResponse = await api(`/backend-api/conversation/${encodeURIComponent(conversationId)}`, {
          method: 'PATCH',
          body: JSON.stringify({ is_visible: false }),
        });
        if (hideResponse.ok) {
          return {
            ok: true,
            data: { action: 'delete', conversationId, deleteMethod: 'hide', result: hideResponse.data },
          };
        }
        if (![404, 405].includes(Number(hideResponse.error?.status))) {
          return hideResponse;
        }

        const bulkDeleteResponse = await api('/backend-api/conversations/delete', {
          method: 'POST',
          body: JSON.stringify({ conversation_ids: [conversationId] }),
        });
        if (!bulkDeleteResponse.ok) return bulkDeleteResponse;
        return {
          ok: true,
          data: { action: 'delete', conversationId, deleteMethod: 'bulk', result: bulkDeleteResponse.data },
        };
      }

      if (req.action === 'download') {
        const fileId = String(req.fileId || '').trim();
        if (!fileId) {
          return { ok: false, error: { code: 'invalid_request', message: 'File ID is required' } };
        }
        const response = await api(`/backend-api/files/download/${encodeURIComponent(fileId)}`);
        if (!response.ok) return response;

        // Return metadata only — actual file download is streamed Node-side
        return { ok: true, data: { action: 'download', fileId, result: response.data, file: null, outputPath: req.outputPath || null } };
      }

      return { ok: false, error: { code: 'invalid_action', message: `Unsupported action: ${req.action}` } };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: error?.code || 'backend_error',
          status: Number.isFinite(error?.status) ? error.status : undefined,
          message: error?.message || String(error),
          body: error?.body,
        },
      };
    }
  }, request);

  if (!result?.ok) {
    const mapped = buildBackendError(result?.error, 'backend_error');
    throw Object.assign(new Error(mapped.message), mapped);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// API-direct helpers (no page.goto / no readiness polling)
// Uses context.request (Playwright HTTP API) with the context's cookie jar.
// ---------------------------------------------------------------------------

const CHATGPT_BASE = 'https://chatgpt.com';

async function fetchAccessToken(context) {
  const resp = await context.request.get(`${CHATGPT_BASE}/api/auth/session`);
  if (!resp.ok()) {
    throw Object.assign(new Error('Session unavailable — missing access token'), {
      code: 'login_required', status: resp.status(),
    });
  }
  const data = await resp.json();
  if (!data?.accessToken) {
    throw Object.assign(new Error('Session response missing accessToken'), {
      code: 'login_required',
    });
  }
  return data.accessToken;
}

function apiHeaders(accessToken) {
  return {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Oai-Device-Id': crypto.randomUUID(),
    'Oai-Language': 'en-US',
  };
}

async function apiRequest(context, { pathname, method = 'GET', body, accessToken }) {
  const headers = apiHeaders(accessToken);
  const url = `${CHATGPT_BASE}${pathname}`;
  const opts = { headers };
  let resp;
  switch (method) {
    case 'POST':
      resp = await context.request.post(url, { ...opts, data: body }); break;
    case 'PATCH':
      resp = await context.request.patch(url, { ...opts, data: body }); break;
    case 'DELETE':
      resp = await context.request.delete(url, { ...opts }); break;
    default:
      resp = await context.request.get(url, { ...opts }); break;
  }
  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!resp.ok()) {
    const mapped = buildBackendError({
      status: resp.status(),
      body: text,
      message: json?.detail || json?.message || json?.error || `HTTP ${resp.status()}`,
    });
    throw Object.assign(new Error(mapped.message), mapped);
  }
  return json;
}

// ---------------------------------------------------------------------------
// API-direct action runners (fast path — no page navigation)
// ---------------------------------------------------------------------------

async function apiListConversations(context, accessToken, { limit, all }) {
  const requestedLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.trunc(Number(limit))) : 20;
  const items = [];
  let offset = 0;
  let total = 0;
  while (true) {
    const remaining = all ? 100 : Math.max(1, Math.min(100, requestedLimit - items.length));
    const data = await apiRequest(context, {
      pathname: `/backend-api/conversations?offset=${offset}&limit=${remaining}`,
      accessToken,
    });
    const batch = Array.isArray(data?.items) ? data.items : [];
    items.push(...batch);
    total = Number.isFinite(Number(data?.total)) ? Number(data.total) : Math.max(total, items.length);
    if (!all && items.length >= requestedLimit) break;
    if (batch.length === 0 || items.length >= total) break;
    offset += batch.length;
  }
  return { action: 'list', items, total, offset: 0, limit: all ? items.length : requestedLimit, all: !!all };
}

async function apiSearchConversations(context, accessToken, { query, limit }) {
  const requestedLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.trunc(Number(limit))) : 20;
  let backendItems = [];
  let backendTotal = 0;
  let backendSearchFailed = false;
  try {
    const data = await apiRequest(context, {
      pathname: `/backend-api/conversations/search?query=${encodeURIComponent(query)}`,
      accessToken,
    });
    backendItems = normalizeConversationSearchItems(data);
    backendTotal = Number.isFinite(Number(data?.total)) ? Number(data.total) : backendItems.length;
  } catch (err) {
    log('warn', 'Backend search failed, falling back to local scan', { error: err.message });
    backendSearchFailed = true;
  }
  let mergedItems = mergeConversationSearchItems(backendItems);
  let fallbackScanned = 0, fallbackTotal = 0, partial = false;
  if (mergedItems.length < requestedLimit) {
    let offset = 0, totalEst = 0, pagesFetched = 0;
    const maxPages = Math.max(3, Math.ceil(requestedLimit / 100));
    while (pagesFetched < maxPages) {
      const data = await apiRequest(context, {
        pathname: `/backend-api/conversations?offset=${offset}&limit=100`,
        accessToken,
      });
      const batch = Array.isArray(data?.items) ? data.items : [];
      mergedItems = mergeConversationSearchItems(mergedItems, filterConversationSearchItems(batch, query));
      totalEst = Number.isFinite(Number(data?.total)) ? Number(data.total) : Math.max(totalEst, offset + batch.length);
      fallbackScanned += batch.length;
      fallbackTotal = totalEst;
      pagesFetched++;
      if (mergedItems.length >= requestedLimit || batch.length === 0 || offset + batch.length >= totalEst) break;
      offset += batch.length;
    }
    partial = fallbackTotal > 0 && fallbackScanned < fallbackTotal && mergedItems.length < requestedLimit;
  }
  return {
    action: 'search', query,
    items: mergedItems.slice(0, requestedLimit),
    total: Math.max(backendTotal, mergedItems.length),
    limit: requestedLimit, partial, backendSearchFailed, fallbackScanned, fallbackTotal,
  };
}

async function apiGetConversation(context, accessToken, conversationId, options = {}) {
  const waitForAssistant = options.waitForAssistant === true;
  const waitForAssistantTimeoutSec = Number.isFinite(Number(options.waitForAssistantTimeoutSec))
    ? Math.max(1, Math.trunc(Number(options.waitForAssistantTimeoutSec)))
    : 30;
  const baselineAssistantMessageId = options.baselineAssistantMessageId || null;
  const startedAt = Date.now();

  let conversation = null;
  let conversationState = 'invalid';
  let stabilized = false;

  while (true) {
    conversation = await apiRequest(context, {
      pathname: `/backend-api/conversation/${encodeURIComponent(conversationId)}`,
      accessToken,
    });
    const classified = classifyConversationProgress(conversation, { baselineAssistantMessageId });
    conversationState = classified.state;

    if (!waitForAssistant) {
      stabilized = classified.state === 'assistant_complete';
      break;
    }

    if (!['awaiting_assistant', 'assistant_in_progress', 'assistant_complete_baseline'].includes(classified.state)) {
      stabilized = classified.state === 'assistant_complete';
      break;
    }

    if ((Date.now() - startedAt) >= waitForAssistantTimeoutSec * 1000) {
      stabilized = false;
      break;
    }

    await sleep(1000);
  }

  return {
    action: 'get',
    conversationId,
    conversation,
    stabilized,
    conversationState,
    waitedMs: Date.now() - startedAt,
  };
}

async function apiDeleteConversation(context, accessToken, conversationId) {
  try {
    const data = await apiRequest(context, {
      pathname: `/backend-api/conversation/${encodeURIComponent(conversationId)}`,
      method: 'PATCH',
      body: { is_visible: false },
      accessToken,
    });
    return { action: 'delete', conversationId, deleteMethod: 'hide', result: data };
  } catch (err) {
    if (![404, 405].includes(err.status)) throw err;
  }
  const data = await apiRequest(context, {
    pathname: '/backend-api/conversations/delete',
    method: 'POST',
    body: { conversation_ids: [conversationId] },
    accessToken,
  });
  return { action: 'delete', conversationId, deleteMethod: 'bulk', result: data };
}

async function apiBulkDelete(context, accessToken, conversationIds) {
  const results = [];
  // Use bulk endpoint for efficiency when multiple IDs
  if (conversationIds.length > 1) {
    try {
      const data = await apiRequest(context, {
        pathname: '/backend-api/conversations/delete',
        method: 'POST',
        body: { conversation_ids: conversationIds },
        accessToken,
      });
      return conversationIds.map(id => ({ action: 'delete', conversationId: id, deleteMethod: 'bulk', result: data }));
    } catch (err) {
      log('warn', 'Bulk delete failed, falling back to individual deletes', { error: err.message });
    }
  }
  // Fallback: individual deletes (parallel, bounded)
  const CONCURRENCY = 4;
  for (let i = 0; i < conversationIds.length; i += CONCURRENCY) {
    const batch = conversationIds.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(id => apiDeleteConversation(context, accessToken, id).catch(err => ({
        action: 'delete', conversationId: id, deleteMethod: 'error', error: err.message,
      })))
    );
    results.push(...batchResults);
    progress(3, 4, `Deleted ${Math.min(i + CONCURRENCY, conversationIds.length)}/${conversationIds.length}`);
  }
  return results;
}

async function apiRenameConversation(context, accessToken, conversationId, title) {
  const data = await apiRequest(context, {
    pathname: `/backend-api/conversation/${encodeURIComponent(conversationId)}`,
    method: 'PATCH',
    body: { title },
    accessToken,
  });
  return { action: 'rename', conversationId, title, result: data };
}

async function apiDownloadFile(context, accessToken, fileId, outputPath) {
  const meta = await apiRequest(context, {
    pathname: `/backend-api/files/download/${encodeURIComponent(fileId)}`,
    accessToken,
  });
  const downloadUrl = meta?.download_url;
  const result = { action: 'download', fileId, result: meta, file: null, outputPath: outputPath || null };
  if (outputPath && downloadUrl) {
    const resolvedPath = pathResolve(outputPath);
    const outDir = dirname(resolvedPath);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    const downloadResp = await context.request.fetch(downloadUrl);
    if (!downloadResp.ok()) {
      throw Object.assign(new Error(`Download failed: HTTP ${downloadResp.status()}`), { code: 'download_failed' });
    }
    const body = await downloadResp.body();
    writeFileSync(resolvedPath, body);
    const disposition = downloadResp.headers()['content-disposition'] || '';
    const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
    result.file = {
      savedPath: resolvedPath,
      mimeType: downloadResp.headers()['content-type'] || null,
      fileName: decodeURIComponent(match?.[1] || match?.[2] || ''),
      size: body.byteLength,
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main action runner (uses API-direct fast path — no page navigation)
// ---------------------------------------------------------------------------

async function runAction({
  action,
  conversationId,
  conversationIds,
  query,
  limit,
  all,
  profile,
  timeout = 120,
  title,
  fileId,
  outputPath,
  waitForAssistant = false,
  waitForAssistantTimeoutSec = 30,
  baselineAssistantMessageId = null,
}) {
  let context = null;
  let tempDir = null;
  try {
    progress(1, 4, 'Launching CloakBrowser');

    const userDataDir = profile ? (tempDir = tempProfileDir('surf-cloak-chats-')) : sharedProfileDir({ log });
    context = await launchPersistentContextWithRecovery({
      launchPersistentContext,
      userDataDir,
      isSharedProfile: !profile,
      log,
    });

    if (profile) {
      progress(2, 4, 'Loading ChatGPT cookies from Chrome profile');
      await loadAndInjectChatgptCookies(context, {
        profileEmail: profile,
        log: (message) => log('info', message),
      });
    }

    progress(2, 4, 'Authenticating');
    const accessToken = await fetchAccessToken(context);

    progress(3, 4, action === 'search' ? 'Searching' : action === 'bulk_delete' ? 'Deleting conversations' : 'Fetching');

    let result;
    switch (action) {
      case 'list':
        result = await apiListConversations(context, accessToken, { limit, all }); break;
      case 'search':
        result = await apiSearchConversations(context, accessToken, { query, limit }); break;
      case 'get':
        result = await apiGetConversation(context, accessToken, conversationId, {
          waitForAssistant,
          waitForAssistantTimeoutSec,
          baselineAssistantMessageId,
        }); break;
      case 'delete':
        result = await apiDeleteConversation(context, accessToken, conversationId); break;
      case 'bulk_delete':
        result = await apiBulkDelete(context, accessToken, conversationIds || [conversationId]); break;
      case 'rename':
        result = await apiRenameConversation(context, accessToken, conversationId, title); break;
      case 'download':
        result = await apiDownloadFile(context, accessToken, fileId, outputPath); break;
      default:
        fail('invalid_action', `Unsupported action: ${action}`);
        return;
    }

    success(Array.isArray(result)
      ? { action: 'bulk_delete', results: result, backend: 'cloak' }
      : { ...result, backend: 'cloak' });
  } catch (error) {
    log('error', 'Chats worker failed', { error: error.message, code: error.code, status: error.status });
    fail(error.code || 'query_failed', error.message, {
      status: error.status,
      body: error.body,
    });
  } finally {
    if (context) {
      try { await context.close(); } catch {}
    }
    if (tempDir) {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  }
}

async function main() {
  log('info', 'Cloak chats worker started');

  let buffer = '';
  let resolved = false;
  const message = await new Promise((resolve) => {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'chats' && !resolved) {
            resolved = true;
            resolve(msg);
          }
        } catch {
          fail('protocol', 'Invalid JSON');
        }
      }
    });
    process.stdin.on('end', () => {
      if (!resolved) resolve(null);
    });
  });

  if (!message) {
    fail('no_query', 'Stdin closed without receiving a chats request');
    process.exit(0);
  }

  await runAction(message).catch((error) => fail('unhandled', error.message));
  process.exit(0);
}

main().catch((error) => {
  fail('fatal', error.message);
  process.exit(1);
});

```

File: /Users/danielsivan/dev/surf-cli/native/cli.cjs
```cjs
#!/usr/bin/env node
const net = require("net");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");
const { loadConfig, getConfigPath, createStarterConfig } = require("./config.cjs");
const networkFormatters = require("./formatters/network.cjs");
const networkStore = require("./network-store.cjs");
const { parseDoCommands } = require("./do-parser.cjs");
const { executeDoSteps } = require("./do-executor.cjs");
const { isBunGeminiEligible, runGeminiViaBun } = require("./gemini-bun-bridge.cjs");
const { isCloakBrowserAvailable, queryWithCloakBrowser, manageChatsWithCloakBrowser } = require("./chatgpt-cloak-bridge.cjs");
const { isSlackCloakAvailable, querySlackMessages } = require("./slack-cloak-bridge.cjs");
const chatgptChatsFormatter = require("./chatgpt-chats-formatter.cjs");
const chatgptChatsCache = require("./chatgpt-chats-cache.cjs");
const slackFormatter = require("./slack-formatter.cjs");
const sessionStore     = require("./session-store.cjs");
const sessionReconciler = require("./session-reconciler.cjs");
const { version: VERSION } = require("../package.json");

const IS_WIN = process.platform === "win32";
const SURF_TMP = IS_WIN ? path.join(os.tmpdir(), "surf") : "/tmp";
const SOCKET_PATH = IS_WIN ? "//./pipe/surf" : "/tmp/surf.sock";
if (IS_WIN) { try { fs.mkdirSync(SURF_TMP, { recursive: true }); } catch {} }

const SURF_SKILL_BT = "`";
const SURF_SKILL_DOC = String.raw`---
name: surf
description: Run the headless-only surf CLI for ChatGPT and Gemini terminal workflows.
---

# Surf

Headless terminal AI via local signed-in browser profiles.
Prefer real CLI execution over guessed provider APIs.

Repo + local CLI verified against **surf-cli v2.11.1**.

## Use when

- ChatGPT prompts, file review, prompt-file runs, image generation
- Gemini prompts, file/video analysis, image generation/editing
- ChatGPT conversation list/search/view/export/reply/manage flows
- Long-running browser-session AI from shell, tmux, or agent workflows

## Defaults

- Headless-only CLI.
- ChatGPT uses CloakBrowser headless by default.
- Gemini uses Bun WebView headless by default.
- CLOAK_HEADLESS cannot enable headed mode.
- SURF_USE_CLOAK_CHATGPT is obsolete.
- Default profile on macOS: ${SURF_SKILL_BT}dsebban883@gmail.com${SURF_SKILL_BT} unless the user asks for another account.
- Use ${SURF_SKILL_BT}--profile dsebban883@gmail.com${SURF_SKILL_BT} for reliable auth and file/image/chats features.

## Sanity check

${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}bash
surf --version
surf --help
surf chatgpt.chats --limit 1 --profile dsebban883@gmail.com
${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}

## ChatGPT

${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}bash
surf chatgpt "explain this code" --profile dsebban883@gmail.com
surf chatgpt "review this PR" --file diff.patch --profile dsebban883@gmail.com
surf chatgpt --prompt-file prompt.md --model gpt-5.4-pro --profile dsebban883@gmail.com
surf chatgpt "a robot surfing" --generate-image /tmp/robot.png --profile dsebban883@gmail.com
surf chatgpt "deep analysis" --model gpt-5.4-pro --profile dsebban883@gmail.com
${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}

${SURF_SKILL_BT}--prompt-file${SURF_SKILL_BT} reads the file as prompt text. Use it for large exported contexts. ${SURF_SKILL_BT}--file${SURF_SKILL_BT} uploads as an attachment.
If RepoPrompt export stats show ${SURF_SKILL_BT}Files: 0${SURF_SKILL_BT}, rebuild selection/preset before sending.

### ChatGPT model aliases

- ${SURF_SKILL_BT}instant${SURF_SKILL_BT}, ${SURF_SKILL_BT}gpt-5.3${SURF_SKILL_BT}, ${SURF_SKILL_BT}gpt-4o${SURF_SKILL_BT}, ${SURF_SKILL_BT}gpt-4.1${SURF_SKILL_BT}, ${SURF_SKILL_BT}gpt-4.1-mini${SURF_SKILL_BT} → GPT-5.3 Instant
- ${SURF_SKILL_BT}thinking${SURF_SKILL_BT}, ${SURF_SKILL_BT}gpt-5.4-thinking${SURF_SKILL_BT}, ${SURF_SKILL_BT}o3${SURF_SKILL_BT}, ${SURF_SKILL_BT}o4-mini${SURF_SKILL_BT} → GPT-5.4 Thinking
- ${SURF_SKILL_BT}pro${SURF_SKILL_BT}, ${SURF_SKILL_BT}gpt-5.4-pro${SURF_SKILL_BT}, ${SURF_SKILL_BT}chatgpt-pro${SURF_SKILL_BT}, ${SURF_SKILL_BT}o1-pro${SURF_SKILL_BT} → GPT-5.4 Pro

## ChatGPT conversations

${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}bash
surf chatgpt.chats --limit 20 --profile dsebban883@gmail.com
surf chatgpt.chats --search "auth system" --profile dsebban883@gmail.com
surf chatgpt.chats <conversation-id> --profile dsebban883@gmail.com
surf chatgpt.chats <conversation-id> --export /tmp/chat.md --profile dsebban883@gmail.com
surf chatgpt.chats <conversation-id> --export /tmp/chat.json --format json --json --profile dsebban883@gmail.com
surf chatgpt.reply <conversation-id> "follow-up" --profile dsebban883@gmail.com
surf chatgpt.reply <conversation-id> --prompt-file followup.md --model gpt-5.4-thinking --profile dsebban883@gmail.com
surf chatgpt.chats <conversation-id> --rename "New Title" --profile dsebban883@gmail.com
surf chatgpt.chats <conversation-id> --delete --profile dsebban883@gmail.com
surf chatgpt.chats <conversation-id> --download-file <file-id> --output /tmp/file.txt --profile dsebban883@gmail.com
${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}

Notes:
- ${SURF_SKILL_BT}--delete${SURF_SKILL_BT} is destructive; no CLI undo.
- Search may use a recent-history fallback; if JSON shows ${SURF_SKILL_BT}partial: true${SURF_SKILL_BT}, misses are not authoritative for older chats.
- ${SURF_SKILL_BT}--download-file${SURF_SKILL_BT} needs ${SURF_SKILL_BT}--output${SURF_SKILL_BT}.
- ${SURF_SKILL_BT}--export${SURF_SKILL_BT} waits briefly for a pending assistant turn before rendering.

## ChatGPT thinking trace

Pro/Thinking models stream live thinking content via ${SURF_SKILL_BT}🧠${SURF_SKILL_BT} lines.

${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}bash
surf chatgpt "complex problem" --model gpt-5.4-pro --profile dsebban883@gmail.com
${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}

## Gemini

${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}bash
surf gemini "explain quantum computing" --profile dsebban883@gmail.com
surf gemini "analyze this chart" --file chart.jpg --profile dsebban883@gmail.com
surf gemini "reason about this architecture" --model thinking --profile dsebban883@gmail.com
surf gemini "advanced math problem" --model pro --profile dsebban883@gmail.com
surf gemini "a robot surfing" --generate-image /tmp/robot.png --profile dsebban883@gmail.com
surf gemini "wide banner" --generate-image /tmp/banner.png --aspect-ratio 16:9 --profile dsebban883@gmail.com
surf gemini "add sunglasses" --edit-image photo.jpg --output out.jpg --profile dsebban883@gmail.com
${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}

### Gemini model notes

Gemini 3 tiers (use ${SURF_SKILL_BT}--model <alias>${SURF_SKILL_BT}):

- **Fast** (default): ${SURF_SKILL_BT}gemini-3-pro${SURF_SKILL_BT}, ${SURF_SKILL_BT}fast${SURF_SKILL_BT}, ${SURF_SKILL_BT}gemini-2.5-flash${SURF_SKILL_BT}
- **Thinking**: ${SURF_SKILL_BT}thinking${SURF_SKILL_BT}, ${SURF_SKILL_BT}gemini-2.5-pro${SURF_SKILL_BT}, ${SURF_SKILL_BT}gemini-3.1-thinking${SURF_SKILL_BT}
- **Pro** (3.1 Pro): ${SURF_SKILL_BT}pro${SURF_SKILL_BT}, ${SURF_SKILL_BT}gemini-3.1-pro-preview${SURF_SKILL_BT}, ${SURF_SKILL_BT}gemini-3.1-pro${SURF_SKILL_BT}

Unknown model names are passed through to the UI picker best-effort.

## Workflows

${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}bash
surf do 'chatgpt "Draft release notes" --profile dsebban883@gmail.com | gemini "Make it concise" --profile dsebban883@gmail.com'
surf do 'chatgpt "Review this" --file diff.patch --profile dsebban883@gmail.com' --dry-run
${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}

## Sessions & reconciliation

Every surf AI command creates a session in ${SURF_SKILL_BT}~/.surf/sessions/${SURF_SKILL_BT}.

${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}bash
surf session
surf session <id>
surf session --reconcile
surf session --reconcile --network
${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}

For long runs, use tmux:

${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}bash
tmux new -d -s surf-chat "bash -lc 'surf chatgpt \"complex analysis\" --model gpt-5.4-pro --profile dsebban883@gmail.com --timeout 3000 2>&1 | tee /tmp/surf-chatgpt.log'"
tail -f /tmp/surf-chatgpt.log
${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}

## Troubleshooting

- ${SURF_SKILL_BT}--profile${SURF_SKILL_BT} is macOS-only.
- ${SURF_SKILL_BT}--with-page${SURF_SKILL_BT} is not supported.
- Page-context/browser-extension commands were removed.
- Default ChatGPT timeout: **2700s**.
- If auth fails, sign in with the same local profile and retry.
- Use ${SURF_SKILL_BT}surf session <id>${SURF_SKILL_BT} to inspect stderr/result details.
`;

/**
 * Read a prompt file and return its content. Exits on error/empty.
 * Logs file size to stderr.
 * @param {string} rawPath - the --prompt-file argument value
 * @returns {string} prompt content
 */
function loadPromptFile(rawPath) {
  const resolved = path.resolve(rawPath);
  let content;
  try {
    content = fs.readFileSync(resolved, "utf-8");
  } catch (e) {
    console.error(`Error: Failed to read prompt file: ${e.message}`);
    process.exit(1);
  }
  if (!content.trim()) {
    console.error(`Error: prompt file is empty: ${resolved}`);
    process.exit(1);
  }
  const sizeKB = (Buffer.byteLength(content, "utf-8") / 1024).toFixed(1);
  const lines = content.split("\n").length;
  const estTokens = Math.ceil(content.length / 4);
  const tokenKStr = (estTokens / 1000).toFixed(1) + "K";
  console.error(`[prompt-file] Read ${sizeKB}KB (${lines} lines, ~${tokenKStr} tokens) from ${resolved}`);
  if (estTokens > 120_000) {
    console.error(`[prompt-file] ⚠ ~${tokenKStr} tokens — approaching GPT Pro 150K limit`);
  }
  return content;
}

function normalizeLegacyChatGptEnv() {
  const debugEnabled = !!process.env.SURF_DEBUG;
  const rawCloakHeadless = process.env.CLOAK_HEADLESS;
  const rawLegacyCloakToggle = process.env.SURF_USE_CLOAK_CHATGPT;

  if (rawCloakHeadless !== undefined) {
    const normalized = String(rawCloakHeadless).trim().toLowerCase();
    if (["0", "false", "no", "headed"].includes(normalized)) {
      process.stderr.write("Warning: CLOAK_HEADLESS headed mode is unsupported and will be ignored.\n");
    }
    delete process.env.CLOAK_HEADLESS;
  }

  if (rawLegacyCloakToggle !== undefined) {
    if (debugEnabled) {
      process.stderr.write("[debug] Ignoring obsolete SURF_USE_CLOAK_CHATGPT env var.\n");
    }
    delete process.env.SURF_USE_CLOAK_CHATGPT;
  }
}

// ============================================================================
// Workflow Resolution and Management
// ============================================================================

/**
 * Get workflow search directories
 * @returns {Array<{path: string, scope: string}>}
 */
function getWorkflowDirs() {
  return [
    { path: path.join(process.cwd(), '.surf', 'workflows'), scope: 'project' },
    { path: path.join(os.homedir(), '.surf', 'workflows'), scope: 'user' },
  ];
}

/**
 * Resolve a workflow by name or path
 * @param {string} nameOrPath - Workflow name or file path
 * @returns {{ type: 'inline'|'file'|'not_found', content?: string, path?: string, name?: string }}
 */
function resolveWorkflow(nameOrPath) {
  // Check if it's an inline workflow (contains pipe)
  if (nameOrPath.includes('|')) {
    return { type: 'inline', content: nameOrPath };
  }
  
  // Check if it's a direct file path (with extension or path separator)
  if (nameOrPath.includes('/') || nameOrPath.includes('\\') || nameOrPath.endsWith('.json')) {
    if (fs.existsSync(nameOrPath)) {
      return { type: 'file', path: nameOrPath };
    }
    return { type: 'not_found', name: nameOrPath };
  }
  
  // Look up by name in workflow directories
  const searchDirs = getWorkflowDirs();
  
  for (const { path: dir } of searchDirs) {
    const filePath = path.join(dir, `${nameOrPath}.json`);
    if (fs.existsSync(filePath)) {
      return { type: 'file', path: filePath };
    }
  }
  
  return { type: 'not_found', name: nameOrPath };
}

/**
 * List all available workflows
 * @returns {Array<{name: string, description: string, scope: string, path: string, args?: object}>}
 */
function listWorkflows() {
  const workflows = [];
  const searchDirs = getWorkflowDirs();
  
  for (const { path: dir, scope } of searchDirs) {
    if (fs.existsSync(dir)) {
      try {
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
        for (const file of files) {
          const filePath = path.join(dir, file);
          try {
            const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            workflows.push({
              name: content.name || file.replace('.json', ''),
              description: content.description || '',
              scope,
              path: filePath,
              args: content.args,
              stepCount: content.steps?.length || 0,
            });
          } catch {
            // Skip invalid JSON files
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    }
  }
  
  return workflows;
}

/**
 * Get detailed info about a workflow
 * @param {string} name - Workflow name
 * @returns {{ error?: string, name?: string, description?: string, args?: object, steps?: Array, path?: string }}
 */
function getWorkflowInfo(name) {
  const resolved = resolveWorkflow(name);
  
  if (resolved.type === 'not_found') {
    return { error: `Workflow not found: ${name}` };
  }
  
  if (resolved.type === 'inline') {
    return { error: 'Cannot get info for inline workflows' };
  }
  
  try {
    const content = JSON.parse(fs.readFileSync(resolved.path, 'utf8'));
    return {
      name: content.name || name,
      description: content.description || '',
      args: content.args || {},
      steps: content.steps || [],
      path: resolved.path,
    };
  } catch (e) {
    return { error: `Failed to parse workflow: ${e.message}` };
  }
}

/**
 * Validate workflow args against schema
 * @param {object} workflow - Workflow with args schema
 * @param {object} providedArgs - User-provided args
 * @returns {string[]} - Array of error messages
 */
function validateWorkflowArgs(workflow, providedArgs) {
  const errors = [];
  if (workflow.args) {
    for (const [name, spec] of Object.entries(workflow.args)) {
      if (spec.required && providedArgs[name] === undefined) {
        errors.push(`Missing required argument: --${name}`);
      }
    }
  }
  return errors;
}

/**
 * Apply default values to workflow args
 * @param {object} workflow - Workflow with args schema
 * @param {object} providedArgs - User-provided args
 * @returns {object} - Args with defaults applied
 */
function applyArgDefaults(workflow, providedArgs) {
  const vars = { ...providedArgs };
  if (workflow.args) {
    for (const [name, spec] of Object.entries(workflow.args)) {
      if (vars[name] === undefined && spec.default !== undefined) {
        vars[name] = spec.default;
      }
    }
  }
  return vars;
}

/**
 * Validate a workflow JSON file
 * @param {string} filePath - Path to workflow file
 * @returns {{ valid: boolean, error?: string, workflow?: object }}
 */
function validateWorkflowFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { valid: false, error: `File not found: ${filePath}` };
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const workflow = JSON.parse(content);
    
    // Basic structure validation
    if (!workflow.steps || !Array.isArray(workflow.steps)) {
      return { valid: false, error: "Workflow must have a 'steps' array" };
    }
    
    if (workflow.steps.length === 0) {
      return { valid: false, error: "Workflow has no steps" };
    }
    
    // Validate each step
    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      
      // Check for loops
      if (step.repeat !== undefined || step.each !== undefined) {
        if (!step.steps || !Array.isArray(step.steps)) {
          return { valid: false, error: `Step ${i + 1}: loop must have a 'steps' array` };
        }
        continue;
      }
      
      // Regular step must have tool/cmd
      if (!step.tool && !step.cmd) {
        return { valid: false, error: `Step ${i + 1}: must have 'tool' field` };
      }
    }
    
    // Validate args schema if present
    if (workflow.args && typeof workflow.args !== 'object') {
      return { valid: false, error: "'args' must be an object" };
    }
    
    return { valid: true, workflow };
  } catch (e) {
    return { valid: false, error: `Invalid JSON: ${e.message}` };
  }
}

/**
 * Format a step for display
 * @param {object} step - Workflow step
 * @param {number} indent - Indentation level
 * @returns {string}
 */
function formatStep(step, indent = 0) {
  const pad = '  '.repeat(indent);
  
  if (step.repeat !== undefined) {
    const lines = [`${pad}repeat ${step.repeat} times:`];
    for (const s of step.steps || []) {
      lines.push(formatStep(s, indent + 1));
    }
    if (step.until) {
      lines.push(`${pad}  until: ${step.until.tool || step.until.cmd}`);
    }
    return lines.join('\n');
  }
  
  if (step.each !== undefined) {
    const lines = [`${pad}each ${step.each} as ${step.as || 'item'}:`];
    for (const s of step.steps || []) {
      lines.push(formatStep(s, indent + 1));
    }
    return lines.join('\n');
  }
  
  const tool = step.tool || step.cmd;
  const args = step.args || {};
  const argStr = Object.entries(args)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' ');
  
  let line = `${pad}${tool}`;
  if (argStr) line += ` ${argStr}`;
  if (step.as) line += ` → ${step.as}`;
  
  return line;
}

// Cross-platform image resize (macOS: sips, Linux: ImageMagick)
function resizeImage(filePath, maxSize) {
  const platform = process.platform;
  
  try {
    if (platform === "darwin") {
      // macOS: use sips
      execSync(`sips --resampleHeightWidthMax ${maxSize} "${filePath}" --out "${filePath}" 2>/dev/null`, { stdio: "pipe" });
      const sizeInfo = execSync(`sips -g pixelWidth -g pixelHeight "${filePath}" 2>/dev/null`, { encoding: "utf8" });
      const width = parseInt(sizeInfo.match(/pixelWidth:\s*(\d+)/)?.[1] || "0", 10);
      const height = parseInt(sizeInfo.match(/pixelHeight:\s*(\d+)/)?.[1] || "0", 10);
      return { success: true, width, height };
    } else {
      // Linux/Windows: use ImageMagick (try IM6 first, then IM7)
      const resizeArg = IS_WIN ? `"${maxSize}x${maxSize}>"` : `${maxSize}x${maxSize}\\>`;
      try {
        execSync(`convert "${filePath}" -resize ${resizeArg} "${filePath}"`, { stdio: "pipe" });
      } catch {
        // IM7 uses 'magick' as main command
        execSync(`magick "${filePath}" -resize ${resizeArg} "${filePath}"`, { stdio: "pipe" });
      }
      // Get dimensions (IM7 may need 'magick identify' instead of just 'identify')
      let sizeInfo;
      try {
        sizeInfo = execSync(`identify -format "%w %h" "${filePath}"`, { encoding: "utf8" });
      } catch {
        sizeInfo = execSync(`magick identify -format "%w %h" "${filePath}"`, { encoding: "utf8" });
      }
      const [width, height] = sizeInfo.trim().split(" ").map(Number);
      return { success: true, width, height };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}
const args = process.argv.slice(2);

const ALIASES = {
  snap: "screenshot",
  read: "page.read",
  find: "search",
  go: "navigate",
  net: "network",
  "network.dump": "network.get",
};

const REMOVED_COMMANDS = {
  read_page: "page.read",
  get_page_text: "page.text",
  page_state: "page.state",
  list_tabs: "tab.list",
  new_tab: "tab.new",
  switch_tab: "tab.switch",
  close_tab: "tab.close",
  scroll_to: "scroll.to",
  scroll_to_position: "scroll.to",
  get_scroll_info: "scroll.info",
  wait_for_element: "wait.element",
  wait_for_url: "wait.url",
  wait_for_network_idle: "wait.network",
  javascript_tool: "js",
  read_console_messages: "console",
  read_network_requests: "network",
  tabs_context: "tab.list",
  tabs_create: "tab.new",
  tabs_register: "tab.name",
  tabs_unregister: "tab.unname",
  tabs_get_by_name: "tab.switch",
  tabs_list_named: "tab.named",
  upload_image: "upload",
  resize_window: "resize",
  type_submit: "type --submit",
  left_click: "click",
  right_click: "click --button right",
  double_click: "click --button double",
  triple_click: "click --button triple",
  left_click_drag: "drag",
};

const UNSUPPORTED_HEADLESS_COMMANDS = new Set([
  "perplexity",
  "grok",
  "aistudio",
  "aistudio.build",
]);

const TOOLS = {
  ai: {
    desc: "AI assistants (ChatGPT, Gemini)",
    commands: {
      "chatgpt": { 
        desc: "Send prompt to ChatGPT (uses browser cookies)", 
        args: ["query"], 
        opts: { 
          model: "Model: gpt-4o, o3, o4-mini, etc.",
          file: "Attach file",
          "generate-image": "Generate image and save to path",
          timeout: "Inactivity timeout in seconds (default: 2700 = 45min)",
          profile: "Chrome profile email for headless auth (macOS)"
        },
        examples: [
          { cmd: 'chatgpt "explain this code"', desc: "Basic query" },
          { cmd: 'chatgpt "review" --file code.ts', desc: "With file (headless)" },
          { cmd: 'chatgpt --prompt-file prompt.md --model gpt-5.4-pro', desc: "Prompt from file (large context)" },
          { cmd: 'chatgpt "analyze" --model gpt-4o', desc: "Specify model" },
          { cmd: 'chatgpt "robot surfing" --generate-image /tmp/robot.png', desc: "Generate image (headless)" },
          { cmd: 'chatgpt "hello" --profile me@gmail.com', desc: "Use Chrome profile (headless)" },
        ]
      },
      "chatgpt.chats": {
        desc: "List, search, view, and export ChatGPT conversations (Cloak only)",
        args: ["conversation_id"],
        opts: {
          limit: "List count or last N visible messages when viewing",
          all: "Fetch all conversations",
          search: "Search conversations by query",
          export: "Export viewed conversation to file",
          format: "Export format: markdown|json",
          rename: "Rename a conversation by ID",
          delete: "Delete a conversation by ID",
          "delete-ids": "Bulk-delete conversations by comma-separated IDs",
          "download-file": "Download attached file by file ID (use with --output)",
          "no-cache": "Bypass local chats cache",
          timeout: "Timeout in seconds (default: 120)",
          profile: "Chrome profile email for headless auth (macOS)",
        },
        examples: [
          { cmd: "chatgpt.chats", desc: "List recent conversations" },
          { cmd: 'chatgpt.chats --search "auth system"', desc: "Search conversations" },
          { cmd: "chatgpt.chats <conversation-id>", desc: "View conversation" },
          { cmd: "chatgpt.chats <conversation-id> --export /tmp/chat.md", desc: "Export markdown" },
          { cmd: 'chatgpt.chats <conversation-id> --rename "New Title"', desc: "Rename conversation" },
        ],
      },
      "chatgpt.reply": {
        desc: "Reply inside an existing ChatGPT conversation (Cloak only)",
        args: ["conversation_id", "prompt"],
        opts: {
          model: "Model override (optional)",
          timeout: "Inactivity timeout in seconds (default: 2700 = 45min)",
          profile: "Chrome profile email for headless auth (macOS)",
        },
        examples: [
          { cmd: 'chatgpt.reply <conversation-id> "follow-up question"', desc: "Reply in-thread" },
          { cmd: 'chatgpt.reply <conversation-id> "follow-up" --model gpt-5.4-thinking', desc: "Reply with model override" },
        ],
      },
      "slack.read": {
        desc: "Read Slack conversations from the web UI (Cloak only)",
        args: ["channel_id"],
        opts: {
          thread: "Thread timestamp to fetch replies for",
          channels: "List available channels instead of reading messages",
          "include-dms": "Include DMs and group DMs when listing channels",
          workspace: "Slack workspace/team ID when profile has multiple workspaces",
          limit: "Number of messages to fetch (default: 50)",
          days: "How many days back to fetch (default: 7)",
          format: "Output format: markdown|json (default: markdown)",
          timeout: "Timeout in seconds (default: 120)",
          profile: "Optional Chrome profile email for cookie auth fallback (macOS)",
        },
        examples: [
          { cmd: 'slack.read C0ABW197BHP --profile user@company.com', desc: "Read channel messages" },
          { cmd: 'slack.read C0ABW197BHP --thread 1234567890.123456 --profile user@company.com', desc: "Read thread replies" },
          { cmd: 'slack.read --channels --profile user@company.com', desc: "List channels" },
          { cmd: 'slack.read --channels --include-dms --profile user@company.com', desc: "List channels + DMs" },
          { cmd: 'slack.read C0ABW197BHP --days 30 --limit 200 --format json --profile user@company.com', desc: "JSON export, 30 days" },
        ],
      },
      "gemini": { 
        desc: "Send prompt to Gemini (uses browser cookies)", 
        args: ["query"], 
        opts: { 
          model: "Model tiers: Fast (gemini-3-pro/default, fast, gemini-2.5-flash), Thinking (gemini-2.5-pro, thinking, gemini-3.1-thinking), Pro (gemini-3.1-pro-preview, pro, gemini-3.1-pro)",
          file: "Attach file to analyze",
          "generate-image": "Generate image and save to path",
          "edit-image": "Edit existing image (use with --output)",
          output: "Output file path for image operations",
          youtube: "YouTube video URL to analyze",
          "aspect-ratio": "Aspect ratio for image generation (e.g., 1:1, 16:9)",
          timeout: "Timeout in seconds (default: 300)",
          profile: "Chrome profile email for Bun headless auth (macOS)"
        },
        examples: [
          { cmd: 'gemini "explain quantum computing"', desc: "Basic query" },
          { cmd: 'gemini "analyze" --file data.csv', desc: "With file attachment" },
          { cmd: 'gemini "a robot surfing" --generate-image /tmp/robot.png', desc: "Generate image" },
          { cmd: 'gemini "add sunglasses" --edit-image photo.jpg --output out.jpg', desc: "Edit image" },
          { cmd: 'gemini "summarize this video" --youtube "https://youtube.com/..."', desc: "YouTube analysis" },
          { cmd: 'gemini "summarize" --profile dsebban883@gmail.com', desc: "Use specific Chrome profile (Bun)" },
        ]
      },
      "ai": { 
        desc: "Analyze page with AI (requires GOOGLE_API_KEY)", 
        args: ["query"], 
        opts: { mode: "Query mode: find|summary|extract (auto-detected)" },
        examples: [
          { cmd: 'ai "find the login button"', desc: "Find element" },
          { cmd: 'ai "summarize this page"', desc: "Get summary" },
          { cmd: 'ai "extract all links as json"', desc: "Extract data" },
        ]
      },
    }
  },
  tab: {
    desc: "Tab management",
    commands: {
      "tab.list": { desc: "List all open tabs", args: [], examples: [{ cmd: "tab.list", desc: "Show all tabs" }] },
      "tab.new": { 
        desc: "Open new tab", 
        args: ["url"], 
        opts: { urls: "Open multiple URLs" },
        examples: [
          { cmd: 'tab.new "https://google.com"', desc: "Open single tab" },
          { cmd: 'tab.new --urls "https://a.com" "https://b.com"', desc: "Open multiple" },
        ]
      },
      "tab.switch": { 
        desc: "Switch to tab by ID or name", 
        args: ["id"],
        examples: [
          { cmd: "tab.switch 123", desc: "Switch by ID" },
          { cmd: 'tab.switch "myTab"', desc: "Switch by name" },
        ]
      },
      "tab.close": { 
        desc: "Close tab by ID or name", 
        args: ["id"], 
        opts: { ids: "Close multiple tabs" },
        examples: [{ cmd: "tab.close 123", desc: "Close tab" }]
      },
      "tab.name": { 
        desc: "Register current tab with a name", 
        args: ["name"],
        examples: [{ cmd: 'tab.name "dashboard"', desc: "Name current tab" }]
      },
      "tab.unname": { desc: "Unregister a named tab", args: ["name"] },
      "tab.named": { desc: "List all named tabs", args: [] },
      "tab.group": { 
        desc: "Create/add to tab group", 
        args: [], 
        opts: { name: "Group name", tabs: "Tab IDs (comma-separated)", color: "Group color" },
        examples: [
          { cmd: 'tab.group --name "Work" --color blue', desc: "Group current tab" },
          { cmd: 'tab.group --name "Research" --tabs 1,2,3', desc: "Group multiple" },
        ]
      },
      "tab.ungroup": { desc: "Remove tabs from group", args: [], opts: { tabs: "Tab IDs (comma-separated)" } },
      "tab.groups": { desc: "List all tab groups", args: [] },
      "tab.reload": { 
        desc: "Reload current tab", 
        args: [], 
        opts: { hard: "Bypass cache" },
        examples: [
          { cmd: "tab.reload", desc: "Soft reload" },
          { cmd: "tab.reload --hard", desc: "Hard reload (bypass cache)" },
        ]
      },
    }
  },
  nav: {
    desc: "Navigation",
    commands: {
      "navigate": { 
        desc: "Go to URL", 
        args: ["url"],
        examples: [{ cmd: 'navigate "https://example.com"', desc: "Go to URL" }]
      },
      "go": { desc: "Alias for navigate", args: ["url"], alias: "navigate" },
      "back": { 
        desc: "Go back in history", 
        args: [],
        examples: [{ cmd: "back", desc: "Browser back" }]
      },
      "forward": { 
        desc: "Go forward in history", 
        args: [],
        examples: [{ cmd: "forward", desc: "Browser forward" }]
      },
      "screenshot": { 
        desc: "Capture screenshot (auto-saves to /tmp by default)", 
        args: [], 
        opts: { 
          output: "Save to file", 
          selector: "Capture specific element", 
          annotate: "Draw element labels", 
          fullpage: "Capture full page", 
          "max-height": "Max height for fullpage (default: 4000)",
          full: "Skip resize, save at full resolution",
          "max-size": "Max dimension in px (default: 1200)",
          "no-save": "Don't auto-save, return base64 + ID (saves context)"
        },
        examples: [
          { cmd: "screenshot", desc: "Auto-save to /tmp (default)" },
          { cmd: "screenshot --output /tmp/shot.png", desc: "Save to specific file" },
          { cmd: "screenshot --no-save", desc: "Return base64 without saving" },
          { cmd: "screenshot --annotate", desc: "With element labels" },
          { cmd: "snap", desc: "Alias for screenshot" },
        ]
      },
      "snap": { desc: "Alias for screenshot (auto-saves to /tmp)", args: [], alias: "screenshot" },
    }
  },
  scroll: {
    desc: "Scrolling",
    commands: {
      "scroll": { 
        desc: "Scroll in direction", 
        args: [], 
        opts: { direction: "up|down|left|right", amount: "Scroll amount (1-10)" },
        examples: [{ cmd: "scroll --direction down --amount 3", desc: "Scroll down" }]
      },
      "scroll.top": { desc: "Scroll to top of page", args: [], opts: { selector: "Target specific container" } },
      "scroll.bottom": { desc: "Scroll to bottom of page", args: [], opts: { selector: "Target specific container" } },
      "scroll.to": { 
        desc: "Scroll element into view", 
        args: [], 
        opts: { ref: "Element ref" },
        examples: [{ cmd: "scroll.to --ref e5", desc: "Scroll to element" }]
      },
      "scroll.info": { desc: "Get scroll position info", args: [], opts: { selector: "Target specific container" } },
    }
  },
  page: {
    desc: "Page inspection",
    commands: {
      "page.read": { 
        desc: "Get accessibility tree + visible text", 
        args: [], 
        opts: { 
          all: "Include all elements", 
          ref: "Get specific element", 
          "no-text": "Exclude visible text content",
          depth: "Maximum tree depth (default: unlimited)",
          compact: "Remove empty structural elements",
        },
        examples: [
          { cmd: "page.read", desc: "Interactive elements + text content" },
          { cmd: "page.read --all", desc: "All elements + text" },
          { cmd: "page.read --no-text", desc: "Interactive elements only (no text)" },
          { cmd: "page.read --depth 3", desc: "Limit to 3 levels deep" },
          { cmd: "page.read --compact", desc: "Skip empty containers" },
          { cmd: "page.read --depth 3 --compact", desc: "Shallow + compact (60% smaller)" },
          { cmd: "read", desc: "Alias" },
        ]
      },
      "read": { desc: "Alias for page.read", args: [], alias: "page.read" },
      "page.text": { desc: "Extract all text from page", args: [] },
      "page.state": { desc: "Get page state (modals, loading, etc.)", args: [] },
    }
  },
  locate: {
    desc: "Semantic element location",
    commands: {
      "locate.role": {
        desc: "Find element by ARIA role",
        args: ["role"],
        opts: { 
          name: "Element name/text",
          action: "Action to perform (click|fill|hover|text)",
          value: "Value for fill action",
          all: "Return all matches"
        },
        examples: [
          { cmd: 'locate.role button --name "Submit" --action click', desc: "Click button by name" },
          { cmd: 'locate.role textbox --name "Email" --action fill --value "test@test.com"', desc: "Fill input" },
          { cmd: 'locate.role link --all', desc: "List all links with refs" },
        ]
      },
      "locate.text": {
        desc: "Find element by text content",
        args: ["text"],
        opts: {
          exact: "Exact match",
          action: "Action to perform",
          value: "Value for fill action"
        },
        examples: [
          { cmd: 'locate.text "Sign In" --action click', desc: "Click by text" },
          { cmd: 'locate.text "Accept" --exact --action click', desc: "Exact text match" },
        ]
      },
      "locate.label": {
        desc: "Find form field by label",
        args: ["label"],
        opts: {
          action: "Action to perform",
          value: "Value for fill action"
        },
        examples: [
          { cmd: 'locate.label "Username" --action fill --value "john"', desc: "Fill by label" },
        ]
      },
    }
  },
  element: {
    desc: "Element inspection",
    commands: {
      "element.styles": {
        desc: "Get computed styles from element(s)",
        args: ["ref_or_selector"],
        examples: [
          { cmd: "element.styles e5", desc: "Get styles by ref" },
          { cmd: 'element.styles ".header"', desc: "Get styles by selector (can return multiple)" },
        ]
      },
    }
  },
  forms: {
    desc: "Form interactions",
    commands: {
      "select": {
        desc: "Select option(s) in dropdown",
        args: ["ref_or_selector", "values..."],
        opts: {
          by: "Match by: value (default), label, index"
        },
        examples: [
          { cmd: 'select e5 "US"', desc: "Select by value" },
          { cmd: 'select e5 "opt1" "opt2"', desc: "Multi-select" },
          { cmd: 'select e5 --by label "United States"', desc: "Select by visible text" },
          { cmd: 'select e5 --by index 0', desc: "Select first option" },
        ]
      },
    }
  },
  wait: {
    desc: "Waiting",
    commands: {
      "wait": { 
        desc: "Wait N seconds", 
        args: ["duration"],
        examples: [{ cmd: "wait 2", desc: "Wait 2 seconds" }]
      },
      "wait.element": { 
        desc: "Wait for element to appear", 
        args: ["selector"], 
        opts: { timeout: "Timeout in ms" },
        examples: [
          { cmd: 'wait.element ".loading"', desc: "Wait for element" },
          { cmd: 'wait.element "#result" --timeout 10000', desc: "With timeout" },
        ]
      },
      "wait.network": { desc: "Wait for network idle", args: [], opts: { timeout: "Timeout in ms" } },
      "wait.url": { 
        desc: "Wait for URL to match", 
        args: ["pattern"], 
        opts: { timeout: "Timeout in ms" },
        examples: [{ cmd: 'wait.url "/dashboard"', desc: "Wait for URL pattern" }]
      },
      "wait.dom": { desc: "Wait for DOM to stabilize", args: [], opts: { stable: "Stability window in ms (default: 100)", timeout: "Max wait time in ms" } },
      "wait.load": { desc: "Wait for page to fully load", args: [], opts: { timeout: "Max wait time in ms (default: 30000)" } },
    }
  },
  input: {
    desc: "Input actions",
    commands: {
      "click": { 
        desc: "Click element or coordinates", 
        args: ["ref"], 
        opts: { 
          ref: "Element ref", 
          x: "X coordinate", 
          y: "Y coordinate", 
          button: "left|right|double|triple", 
          selector: "CSS selector", 
          index: "Which match (0-indexed) for selector",
        },
        examples: [
          { cmd: "click e5", desc: "Click by ref" },
          { cmd: 'click --selector ".btn"', desc: "Click by selector" },
          { cmd: 'click --selector ".item" --index 2', desc: "Click 3rd match" },
          { cmd: "click --x 100 --y 200", desc: "Click coordinates" },
        ]
      },
      "type": { 
        desc: "Type text (uses form.fill when --ref provided for better modal/form support)", 
        args: ["text"], 
        opts: { 
          into: "Target selector",
          ref: "Element ref (uses JS DOM method, more reliable for modals)", 
          submit: "Press enter after", 
          clear: "Clear first", 
          method: "cdp|js (default: cdp, but ref uses JS automatically)" 
        },
        examples: [
          { cmd: 'type "hello world"', desc: "Type at cursor (CDP events)" },
          { cmd: 'type "user@example.com" --ref e5', desc: "Type into element by ref (JS DOM)" },
          { cmd: 'type "search query" --submit', desc: "Type and press Enter" },
        ]
      },
      "smart_type": { desc: "Type into specific element (js method)", args: [], opts: { selector: "CSS selector", text: "Text to type", clear: "Clear first (default: true)", submit: "Submit after" } },
      "key": { 
        desc: "Press key", 
        args: ["key"], 
        examples: [
          { cmd: "key Enter", desc: "Press Enter" },
          { cmd: "key Escape", desc: "Press Escape" },
          { cmd: "key cmd+a", desc: "Select all (Mac)" },
          { cmd: "key ctrl+shift+p", desc: "Key combo" },
        ]
      },
      "hover": { desc: "Hover over element", args: [], opts: { ref: "Element ref", x: "X coordinate", y: "Y coordinate" } },
      "drag": { desc: "Drag between points", args: [], opts: { from: "Start x,y", to: "End x,y" } },
    }
  },
  js: {
    desc: "JavaScript execution",
    commands: {
      "js": { 
        desc: "Execute JavaScript (use 'return' for values)", 
        args: ["code"], 
        opts: { file: "Run JS from file" },
        examples: [
          { cmd: 'js "return document.title"', desc: "Get title" },
          { cmd: 'js "document.body.style.background = \'red\'"', desc: "Run code" },
          { cmd: "js --file script.js", desc: "Run file" },
        ]
      },
    }
  },
  dev: {
    desc: "Dev tools",
    commands: {
      "console": { 
        desc: "Read console messages", 
        args: [], 
        opts: { clear: "Clear after reading", stream: "Continuous output", level: "Filter by level (log,warn,error)", limit: "Max messages" },
        examples: [
          { cmd: "console", desc: "Get recent messages" },
          { cmd: "console --level error", desc: "Only errors" },
          { cmd: "console --stream", desc: "Stream live" },
        ]
      },
    }
  },
  network: {
    desc: "Network capture",
    commands: {
      "network": { 
        desc: "List captured network requests", 
        args: [], 
        opts: { 
          origin: "Filter by origin (domain)",
          method: "Filter by method (GET,POST,...)",
          status: "Filter by status (200, 4xx, 5xx)",
          type: "Filter by content type (json, html, proto)",
          since: "Show requests since (5m, 1h, timestamp)",
          last: "Show last N requests",
          "has-body": "Only requests with body",
          "exclude-static": "Exclude images/fonts/css/js",
          filter: "URL pattern filter",
          format: "Output format: compact, urls, curl, raw",
          all: "Show all (no limit)",
          v: "Verbose output",
          vv: "Very verbose output",
          clear: "Clear after reading",
          stream: "Continuous output"
        },
        examples: [
          { cmd: "network", desc: "Show recent requests" },
          { cmd: "network --origin api.github.com", desc: "Filter by origin" },
          { cmd: "network --method POST --type json", desc: "POST JSON requests" },
          { cmd: "network --format curl", desc: "Output as curl commands" },
          { cmd: "network -v", desc: "Verbose with headers" },
        ]
      },
      "network.get": { 
        desc: "Get full details for a request", 
        args: ["id"],
        opts: {},
        examples: [
          { cmd: "network.get r_001", desc: "Get request details" }
        ]
      },
      "network.body": { 
        desc: "Get response body (for piping)", 
        args: ["id"],
        opts: { request: "Get request body instead" },
        examples: [
          { cmd: "network.body r_001", desc: "Get response body" },
          { cmd: "network.body r_001 | jq .", desc: "Pipe JSON to jq" }
        ]
      },
      "network.curl": { 
        desc: "Generate curl command for request", 
        args: ["id"],
        opts: {},
        examples: [
          { cmd: "network.curl r_001", desc: "Generate curl" }
        ]
      },
      "network.origins": { 
        desc: "List captured origins with stats", 
        args: [],
        opts: { "by-tab": "Group by tab" },
        examples: [
          { cmd: "network.origins", desc: "List origins" }
        ]
      },
      "network.clear": { 
        desc: "Clear captured requests", 
        args: [],
        opts: { before: "Clear before timestamp/duration", origin: "Clear specific origin" },
        examples: [
          { cmd: "network.clear", desc: "Clear all" },
          { cmd: "network.clear --before 1h", desc: "Clear older than 1 hour" }
        ]
      },
      "network.stats": { 
        desc: "Show capture statistics", 
        args: [],
        opts: {},
        examples: [
          { cmd: "network.stats", desc: "Show stats" }
        ]
      },
      "network.export": { 
        desc: "Export captured requests", 
        args: [],
        opts: { jsonl: "Export as JSONL", output: "Output file path" },
        examples: [
          { cmd: "network.export --jsonl --output /tmp/requests.jsonl", desc: "Export as JSONL" }
        ]
      },
      "network.path": { 
        desc: "Get file paths for request data", 
        args: ["id"],
        opts: {},
        examples: [
          { cmd: "network.path r_001", desc: "Get file paths" }
        ]
      },
    }
  },
  health: {
    desc: "Health checks",
    commands: {
      "health": { 
        desc: "Wait for URL or element", 
        args: [], 
        opts: { url: "URL to check (expects 200)", selector: "CSS selector to wait for", expect: "Expected status code (default: 200)", timeout: "Timeout in ms" },
        examples: [
          { cmd: 'health --url "https://api.example.com"', desc: "Check URL" },
          { cmd: 'health --selector ".loaded"', desc: "Wait for element" },
        ]
      },
    }
  },
  smoke: {
    desc: "Smoke testing",
    commands: {
      "smoke": { desc: "Run smoke tests on URLs", args: [], opts: { urls: "URLs to test (space-separated)", routes: "Route group from config", screenshot: "Directory to save screenshots", "fail-fast": "Stop on first error" } },
    }
  },
  dialog: {
    desc: "Browser dialog handling",
    commands: {
      "dialog.accept": { desc: "Accept current dialog", args: [], opts: { text: "Text for prompt input" } },
      "dialog.dismiss": { 
        desc: "Dismiss current dialog", 
        args: [], 
        opts: { all: "Dismiss all dialogs repeatedly" },
        examples: [
          { cmd: "dialog.dismiss", desc: "Dismiss once" },
          { cmd: "dialog.dismiss --all", desc: "Dismiss all" },
        ]
      },
      "dialog.info": { desc: "Get current dialog info", args: [] },
    }
  },
  emulate: {
    desc: "Device/network emulation",
    commands: {
      "emulate.network": { desc: "Emulate network conditions", args: ["preset"], opts: {} },
      "emulate.cpu": { desc: "CPU throttling (rate >= 1)", args: ["rate"], opts: {} },
      "emulate.geo": { desc: "Override geolocation", args: [], opts: { lat: "Latitude", lon: "Longitude", accuracy: "Accuracy in meters (default: 100)", clear: "Clear override" } },
      "emulate.device": {
        desc: "Emulate mobile device",
        args: ["device"],
        opts: { list: "List available devices" },
        examples: [
          { cmd: 'emulate.device "iPhone 14"', desc: "Emulate iPhone" },
          { cmd: 'emulate.device "Pixel 7"', desc: "Emulate Pixel" },
          { cmd: "emulate.device --list", desc: "Show all devices" },
          { cmd: 'emulate.device "reset"', desc: "Return to desktop" },
        ]
      },
      "emulate.viewport": {
        desc: "Set custom viewport",
        args: [],
        opts: { width: "Viewport width", height: "Viewport height", scale: "Device scale factor", mobile: "Enable mobile mode" },
        examples: [
          { cmd: "emulate.viewport --width 375 --height 812", desc: "iPhone size" },
          { cmd: "emulate.viewport --width 1920 --height 1080 --scale 2", desc: "Retina display" },
        ]
      },
      "emulate.touch": {
        desc: "Enable/disable touch emulation",
        args: [],
        opts: { enabled: "Enable touch (default: true)" },
        examples: [
          { cmd: "emulate.touch", desc: "Enable touch" },
          { cmd: "emulate.touch --enabled false", desc: "Disable touch" },
        ]
      },
    }
  },
  form: {
    desc: "Form automation",
    commands: {
      "form.fill": { desc: "Batch fill form fields", args: [], opts: { data: "JSON array of {ref, value}" } },
    }
  },
  perf: {
    desc: "Performance tracing",
    commands: {
      "perf.start": { desc: "Start performance trace", args: [], opts: { categories: "Trace categories (comma-separated)" } },
      "perf.stop": { desc: "Stop trace and get metrics", args: [] },
      "perf.metrics": { desc: "Get current performance metrics", args: [] },
    }
  },
  upload: {
    desc: "File upload",
    commands: {
      "upload": { 
        desc: "Upload file(s) to input", 
        args: [], 
        opts: { ref: "Element ref", files: "File path(s) comma-separated" },
        examples: [{ cmd: 'upload --ref e5 --files "/path/to/file.pdf"', desc: "Upload file" }]
      },
    }
  },
  frame: {
    desc: "Iframe handling",
    commands: {
      "frame.list": { 
        desc: "List all frames in page", 
        args: [],
        examples: [{ cmd: "frame.list", desc: "Show frame tree" }]
      },
      "frame.switch": {
        desc: "Switch to iframe context",
        args: [],
        opts: {
          selector: "Frame CSS selector",
          name: "Frame name attribute",
          index: "Frame index (0-based)"
        },
        examples: [
          { cmd: 'frame.switch --selector "#payment-iframe"', desc: "Switch by selector" },
          { cmd: 'frame.switch --name "payment"', desc: "Switch by name" },
          { cmd: "frame.switch --index 0", desc: "Switch to first frame" },
        ]
      },
      "frame.main": {
        desc: "Return to main frame",
        args: [],
        examples: [{ cmd: "frame.main", desc: "Exit iframe context" }]
      },
      "frame.js": { 
        desc: "Execute JS in specific frame", 
        args: ["code"], 
        opts: { id: "Frame ID from frame.list", file: "Run JS from file" },
        examples: [
          { cmd: 'frame.js "return document.title" --id frame1', desc: "JS in specific frame" },
        ]
      },
    }
  },
  cookie: {
    desc: "Cookie management",
    commands: {
      "cookie.list": { 
        desc: "List all cookies for current tab's domain", 
        args: [],
        examples: [{ cmd: "cookie.list", desc: "Show all cookies" }]
      },
      "cookie.get": { desc: "Get specific cookie", args: [], opts: { name: "Cookie name" } },
      "cookie.set": { 
        desc: "Set a cookie", 
        args: [], 
        opts: { name: "Cookie name", value: "Cookie value", expires: "Expiry date (optional)" },
        examples: [{ cmd: 'cookie.set --name "session" --value "abc123"', desc: "Set cookie" }]
      },
      "cookie.clear": { 
        desc: "Clear cookies", 
        args: [], 
        opts: { name: "Specific cookie (optional)", all: "Clear all for domain" },
        examples: [
          { cmd: 'cookie.clear --name "session"', desc: "Clear one" },
          { cmd: "cookie.clear --all", desc: "Clear all" },
        ]
      },
    }
  },
  search: {
    desc: "Text search",
    commands: {
      "search": { 
        desc: "Search for text in page", 
        args: ["term"], 
        opts: { "case-sensitive": "Case-sensitive match", limit: "Max results" },
        examples: [
          { cmd: 'search "login"', desc: "Find text" },
          { cmd: 'search "Error" --case-sensitive', desc: "Case sensitive" },
          { cmd: 'find "button"', desc: "Using alias" },
        ]
      },
      "find": { desc: "Alias for search", args: ["term"], alias: "search" },
    }
  },
  batch: {
    desc: "Batch execution",
    commands: {
      "batch": { 
        desc: "Execute multiple actions", 
        args: [], 
        opts: { actions: "JSON array of actions", file: "Path to actions JSON file" },
        examples: [
          { cmd: 'batch --actions \'[{"type":"click","ref":"e1"},{"type":"wait","ms":500}]\'', desc: "Inline actions" },
          { cmd: "batch --file workflow.json", desc: "From file" },
        ]
      },
    }
  },
  workflow: {
    desc: "Workflow execution and management",
    commands: {
      "do": {
        desc: "Execute multiple commands as a single workflow",
        args: ["commands"],
        opts: {
          file: "Load workflow from JSON file",
          "on-error": "stop (default) | continue",
          "no-auto-wait": "Disable automatic waits between steps",
          "step-delay": "Delay between steps in ms (default: 100)",
          "dry-run": "Parse and validate without executing"
        },
        examples: [
          { cmd: 'do \'go "https://example.com" | click e5 | screenshot\'', desc: "Inline workflow" },
          { cmd: 'do -f login.json', desc: "From JSON file" },
          { cmd: 'do github-login --email "x" --password "y"', desc: "Named workflow with args" },
          { cmd: 'do \'go "url" | click e5\' --dry-run', desc: "Validate without running" },
        ]
      },
      "workflow.list": {
        desc: "List available workflows",
        args: [],
        opts: {},
        examples: [
          { cmd: 'workflow.list', desc: "Show all workflows" },
        ]
      },
      "workflow.info": {
        desc: "Show workflow details and arguments",
        args: ["name"],
        opts: {},
        examples: [
          { cmd: 'workflow.info github-login', desc: "Show workflow details" },
        ]
      },
      "workflow.validate": {
        desc: "Validate workflow JSON file",
        args: ["file"],
        opts: {},
        examples: [
          { cmd: 'workflow.validate ./my-flow.json', desc: "Check JSON validity" },
        ]
      },
    }
  },
  zoom: {
    desc: "Zoom control",
    commands: {
      "zoom": { 
        desc: "Get or set zoom level", 
        args: [], 
        opts: { level: "Zoom level (e.g., 1.5 for 150%)", reset: "Reset to default zoom" },
        examples: [
          { cmd: "zoom", desc: "Get current zoom" },
          { cmd: "zoom 1.5", desc: "Set to 150%" },
          { cmd: "zoom --reset", desc: "Reset to 100%" },
        ]
      },
    }
  },
  resize: {
    desc: "Window management",
    commands: {
      "resize": { 
        desc: "Resize browser window", 
        args: [], 
        opts: { width: "Window width", height: "Window height" },
        examples: [{ cmd: "resize --width 1280 --height 720", desc: "Set size" }]
      },
    }
  },
  bookmark: {
    desc: "Bookmark management",
    commands: {
      "bookmark.add": { desc: "Bookmark current page", args: [], opts: { folder: "Folder name" } },
      "bookmark.remove": { desc: "Remove bookmark for current page", args: [] },
      "bookmark.list": { desc: "List bookmarks", args: [], opts: { folder: "Folder name", limit: "Max results" } },
    }
  },
  history: {
    desc: "Browser history",
    commands: {
      "history.list": { 
        desc: "Recent history", 
        args: [], 
        opts: { limit: "Max results" },
        examples: [{ cmd: "history.list --limit 20", desc: "Last 20 items" }]
      },
      "history.search": { 
        desc: "Search history", 
        args: ["query"],
        examples: [{ cmd: 'history.search "github"', desc: "Search history" }]
      },
    }
  },
  window: {
    desc: "Window management (isolate agent from your browsing)",
    commands: {
      "window.new": { 
        desc: "Create new browser window", 
        args: ["url"], 
        opts: { 
          width: "Window width",
          height: "Window height",
          incognito: "Open incognito window",
          unfocused: "Don't focus the new window"
        },
        examples: [
          { cmd: 'window.new "https://example.com"', desc: "New window with URL" },
          { cmd: 'window.new --width 1280 --height 720', desc: "Sized window" },
          { cmd: 'window.new --incognito', desc: "Incognito window" },
        ]
      },
      "window.list": { 
        desc: "List all browser windows", 
        args: [],
        opts: { tabs: "Include tab details" },
        examples: [{ cmd: "window.list", desc: "Show all windows" }]
      },
      "window.focus": { 
        desc: "Focus a window by ID", 
        args: ["id"],
        examples: [{ cmd: "window.focus 123", desc: "Focus window" }]
      },
      "window.close": { 
        desc: "Close a window by ID", 
        args: ["id"],
        examples: [{ cmd: "window.close 123", desc: "Close window" }]
      },
      "window.resize": { 
        desc: "Resize or reposition a window", 
        args: [], 
        opts: { 
          id: "Window ID (required)", 
          width: "Window width", 
          height: "Window height",
          left: "Window X position",
          top: "Window Y position",
          state: "Window state: normal, minimized, maximized, fullscreen"
        },
        examples: [
          { cmd: "window.resize --id 123 --width 1920 --height 1080", desc: "Resize" },
          { cmd: "window.resize --id 123 --left 0 --top 0", desc: "Move to corner" },
          { cmd: "window.resize --id 123 --state maximized", desc: "Maximize" },
        ]
      },
    }
  },
};

const HELP_TOPICS = {
  refs: {
    title: "Element References",
    content: `Element refs (e1, e2, e3...) are stable identifiers from page.read.

Usage:
  1. Run page.read to get the accessibility tree
  2. Find elements with refs like [e5] button "Submit"
  3. Use the ref: click e5, scroll.to --ref e5, type "text" --ref e5

Refs are more reliable than selectors for dynamic pages.`
  },
  selectors: {
    title: "CSS Selectors",
    content: `Use CSS selectors when you know the element's structure.

Examples:
  click --selector "#submit-btn"
  click --selector ".btn-primary"
  click --selector "[data-testid='login']"
  click --selector "button:contains('Submit')"
  wait.element ".loading-spinner"

Use --index to select from multiple matches:
  click --selector ".item" --index 2   # 3rd match (0-indexed)`
  },
  cookies: {
    title: "Cookie Management",
    content: `Cookies are scoped to the current tab's domain.

Commands:
  cookie.list           List all cookies
  cookie.get --name X   Get specific cookie
  cookie.set            Set a cookie
  cookie.clear          Clear cookies

Notes:
  - HttpOnly cookies are accessible
  - Use --expires with ISO date: "2025-12-31T00:00:00Z"`
  },
  batch: {
    title: "Batch Execution",
    content: `Run multiple actions in sequence.

JSON format:
  [
    {"type": "click", "ref": "e1"},
    {"type": "wait", "ms": 500},
    {"type": "type", "text": "hello"},
    {"type": "key", "key": "Enter"}
  ]

Supported types: click, type, key, wait, scroll, screenshot, navigate

Options:
  --actions '[...]'    Inline JSON
  --file workflow.json Load from file`
  },
  screenshots: {
    title: "Screenshots",
    content: `Capture screenshots with various options.

Commands:
  screenshot --output file.png                          Basic screenshot
  screenshot --annotate --output file.png               With element labels
  screenshot --fullpage --output file.png               Full page capture
  screenshot --annotate --fullpage --output file.png    Full page with labels
  snap                                                  Auto-save to /tmp

Options:
  --output      Save path
  --annotate    Draw element refs
  --fullpage    Capture entire page
  --max-height  Max height for fullpage (default: 4000)`
  },
  automation: {
    title: "Automation Patterns",
    content: `Common automation patterns:

Wait for page load:
  navigate "https://example.com"
  wait.load

Fill a form:
  type "user@email.com" --into "#email"
  type "password123" --into "#password"
  click --selector "button[type=submit]"

Wait for dynamic content:
  click e5
  wait.element ".results"
  page.read

Scroll and capture:
  scroll.bottom
  screenshot --fullpage --output full.png`
  },
  windows: {
    title: "Window Isolation",
    content: `Keep agent work separate from your browsing.

Create a dedicated window:
  surf window.new "https://example.com"
  # Returns: Window 123 (tab 456)
  # Use --window-id 123 to target this window

All commands in that window:
  surf navigate "https://other.com" --window-id 123
  surf read --window-id 123
  surf click e5 --window-id 123
  surf screenshot --output /tmp/shot.png --window-id 123

Manage windows:
  surf window.list              # List all windows
  surf window.list --tabs       # Include tab details  
  surf window.focus 123         # Bring window to front
  surf window.close 123         # Close when done

Tips:
  - Agent commands won't affect your active browser window
  - If window has no usable tabs, one is auto-created
  - Use window.new --incognito for isolated cookies`
  },
  semantic: {
    title: "Semantic Locators",
    content: `Find elements by role, text, or label instead of refs or selectors.

By ARIA role:
  locate.role button --name "Submit" --action click
  locate.role textbox --name "Email" --action fill --value "test@test.com"
  locate.role link --all                              # List all links

By text content:
  locate.text "Sign In" --action click
  locate.text "Accept" --exact --action click         # Exact match

By form label:
  locate.label "Username" --action fill --value "john"
  locate.label "Password" --action fill --value "secret"

Available actions: click, fill, hover, text
Without --action, returns the ref for later use.`
  },
  frames: {
    title: "Iframe Navigation",
    content: `Work with embedded iframes.

List frames:
  frame.list                    # Show frame tree with IDs

Switch context:
  frame.switch --selector "#payment-iframe"
  frame.switch --name "checkout"
  frame.switch --index 0        # First iframe

Return to main:
  frame.main

Execute JS in frame:
  frame.js "return document.title" --id frame1

After frame.switch, subsequent commands target that frame context.`
  },
  devices: {
    title: "Device Emulation",
    content: `Test responsive designs and mobile views.

Emulate a device:
  emulate.device "iPhone 14"
  emulate.device "Pixel 7"
  emulate.device --list         # Show all devices
  emulate.device "reset"        # Return to desktop

Custom viewport:
  emulate.viewport --width 375 --height 812
  emulate.viewport --width 1920 --height 1080 --scale 2

Touch events:
  emulate.touch                 # Enable touch
  emulate.touch --enabled false # Disable

Popular devices: iPhone 14, iPhone SE, iPad, iPad Pro,
Pixel 7, Galaxy S23, Nest Hub`
  },
  optimization: {
    title: "Token Optimization",
    content: `Reduce output size for LLM efficiency.

Limit tree depth:
  page.read --depth 3           # Max 3 levels deep

Skip empty containers:
  page.read --compact           # Remove empty structural elements

Combine for best results:
  page.read --depth 3 --compact # ~60% smaller output

Filter to interactive only:
  page.read                     # Default: interactive elements only
  page.read --all               # Include all elements

Exclude text content:
  page.read --no-text           # Skip visible text section`
  },
};

const ALL_SOCKET_TOOLS = [
  "ai", "screenshot", "navigate",
  "form_input", "find_and_type", "autocomplete", "set_value", "smart_type",
  "scroll_to_position", "get_scroll_info", "close_dialogs", "page_state",
  "javascript_tool", "health", "smoke",
  "click_type", "click_type_submit", "type", "key", "type_submit",
  "scroll", "scroll_to", "hover", "left_click_drag", "drag", "wait",
  "computer",
  "page.read", "page.text", "page.state",
  "locate.role", "locate.text", "locate.label",
  "tab.list", "tab.new", "tab.switch", "tab.close", "tab.name", "tab.unname", "tab.named",
  "tab.group", "tab.ungroup", "tab.groups", "tab.reload",
  "scroll.top", "scroll.bottom", "scroll.to", "scroll.info",
  "wait.element", "wait.network", "wait.url", "wait.dom", "wait.load",
  "click", "hover", "drag",
  "js", "console", "network", 
  "network.get", "network.body", "network.curl", "network.origins", 
  "network.clear", "network.stats", "network.export", "network.path",
  "dialog.accept", "dialog.dismiss", "dialog.info",
  "emulate.network", "emulate.cpu", "emulate.geo", "emulate.device", "emulate.viewport", "emulate.touch",
  "form.fill",
  "perf.start", "perf.stop", "perf.metrics",
  "upload",
  "frame.list", "frame.switch", "frame.main", "frame.js",
  "cookie.list", "cookie.get", "cookie.set", "cookie.clear",
  "search", "batch",
  "zoom", "resize",
  "back", "forward",
  "bookmark.add", "bookmark.remove", "bookmark.list",
  "history.list", "history.search",
  "window.new", "window.list", "window.focus", "window.close", "window.resize",
];

// See also suggestions for related commands
const SEE_ALSO = {
  "click": ["locate.role", "locate.text", "page.read"],
  "type": ["locate.label", "form.fill", "smart_type"],
  "page.read": ["--depth for smaller output", "--compact to skip empty containers", "page.text"],
  "locate.role": ["locate.text", "locate.label", "click --selector"],
  "locate.text": ["locate.role", "locate.label", "search"],
  "locate.label": ["locate.role", "form.fill"],
  "tab.list": ["window.list"],
  "tab.new": ["window.new for isolation"],
  "window.new": ["window.list"],
  "window.list": ["tab.list"],
  "frame.list": ["frame.switch", "frame.main"],
  "frame.switch": ["frame.list", "frame.main", "frame.js"],
  "frame.main": ["frame.list", "frame.switch"],
  "frame.js": ["frame.switch", "js"],
  "emulate.network": ["emulate.device", "emulate.cpu"],
  "emulate.device": ["emulate.viewport", "emulate.touch"],
  "emulate.viewport": ["emulate.device", "emulate.touch"],
  "emulate.touch": ["emulate.device", "emulate.viewport"],
  "emulate.cpu": ["emulate.network", "perf.metrics"],
  "perf.start": ["perf.stop", "perf.metrics"],
  "perf.stop": ["perf.start", "perf.metrics"],
  "perf.metrics": ["perf.start", "console", "network"],
  "navigate": ["wait.load", "page.read"],
  "screenshot": ["page.read", "scroll.bottom for fullpage"],
  "search": ["locate.text", "page.read"],
  "wait.element": ["wait.load", "wait.network"],
  "wait.load": ["wait.element", "wait.network"],
  "wait.network": ["wait.load", "wait.element"],
  "scroll.to": ["click", "page.read"],
  "console": ["network", "perf.metrics"],
  "network": ["console", "network.get"],
};

const HEADLESS_COMMAND_HELP = {
  chatgpt: "Send prompt to ChatGPT",
  "chatgpt.chats": "Search conversations",
  "chatgpt.reply": "Reply in-thread",
  "slack.read": "Read Slack conversations",
  gemini: "Send prompt to Gemini",
  session: "Inspect and reconcile AI sessions",
  do: "Execute multiple commands",
  server: "Start MCP server",
  skills: "Print the full agent skill reference",
};

const HEADLESS_COMMAND_LIST = [
  "chatgpt",
  "chatgpt.chats",
  "chatgpt.reply",
  "slack.read",
  "gemini",
  "session",
  "do",
  "server",
  "skills",
];

const showBasicHelp = () => {
  console.log(`surf v${VERSION} - Headless terminal AI CLI

Usage: surf <command> [args] [options]

AI Commands (headless-only):
  chatgpt <query>                Send prompt to ChatGPT
  chatgpt.chats [conversation_id] List/search/view conversations
  chatgpt.reply <conversation_id> <prompt> Reply inside a conversation
  gemini <query>                 Send prompt to Gemini
  slack.read [channel_id]        Read Slack conversations

Workflow + Session:
  do <commands>                  Execute multiple commands as a workflow
  session                        List recent AI sessions
  session <id>                   View session log
  session --reconcile            Reconcile orphaned sessions

Platform:
  server                         Start MCP server
  skills                         Print the embedded skill reference

Quick Examples:
  surf chatgpt "review this PR" --file diff.patch --profile user@gmail.com
  surf gemini "analyze this chart" --file chart.jpg --model gemini-3-pro --profile user@gmail.com
  surf do 'chatgpt "Draft" --profile user@gmail.com | gemini "Tighten" --profile user@gmail.com'

More Help:
  surf --help-full           All headless commands
  surf <command> --help      Command details
  surf --find <query>        Search supported commands
`);
};

const showFullHelp = () => {
  console.log(`surf v${VERSION} - Headless terminal AI CLI

Usage: surf <command> [args] [options]

AI - AI assistants (headless-only)
  chatgpt <query>               Send prompt to ChatGPT
  chatgpt.chats <conversation_id> Search conversations
  chatgpt.reply <conversation_id> <prompt> Reply in-thread
  gemini <query>                Send prompt to Gemini
  slack.read [channel_id]       Read Slack conversations

WORKFLOW
  do <commands>                 Execute multiple commands

SESSIONS
  session                       List/review/reconcile sessions

MCP
  server                        Start MCP server

DOCS
  skills                        Print embedded skill reference
`);
};

const showHelpTopic = (topic) => {
  const t = HELP_TOPICS[topic];
  if (!t) {
    console.error(`Unknown topic: ${topic}`);
    console.error(`Available topics: ${Object.keys(HELP_TOPICS).join(", ")}`);
    process.exit(1);
  }
  console.log(`\n${t.title}\n${"=".repeat(t.title.length)}\n\n${t.content}\n`);
};

const showGroupHelp = (groupName) => {
  const group = TOOLS[groupName];
  if (!group) {
    console.error(`Unknown group: ${groupName}`);
    console.error(`Available groups: ${Object.keys(TOOLS).join(", ")}`);
    process.exit(1);
  }
  console.log(`\n${groupName} - ${group.desc}\n`);
  for (const [cmd, info] of Object.entries(group.commands)) {
    if (info.alias) {
      console.log(`  ${cmd} -> ${info.alias}\n`);
      continue;
    }
    const argStr = info.args?.length ? `<${info.args.join("> <")}>` : "";
    console.log(`  ${cmd} ${argStr}`);
    console.log(`      ${info.desc}`);
    if (info.opts) {
      for (const [opt, desc] of Object.entries(info.opts)) {
        console.log(`      --${opt.padEnd(14)} ${desc}`);
      }
    }
    if (info.examples?.length) {
      console.log("      Examples:");
      for (const ex of info.examples) {
        console.log(`        surf ${ex.cmd}`);
      }
    }
    console.log();
  }
};

const showToolHelp = (toolName) => {
  for (const [groupName, group] of Object.entries(TOOLS)) {
    const info = group.commands[toolName];
    if (info) {
      if (info.alias) {
        console.log(`\n  ${toolName} -> ${info.alias}\n`);
        showToolHelp(info.alias);
        return;
      }
      const argStr = info.args?.length ? `<${info.args.join("> <")}>` : "";
      console.log(`\n${toolName} - ${info.desc}\n`);
      console.log(`Usage: surf ${toolName} ${argStr}\n`);
      if (info.args?.length) {
        console.log("Arguments:");
        for (const arg of info.args) {
          console.log(`  <${arg}>`);
        }
        console.log();
      }
      if (info.opts) {
        console.log("Options:");
        for (const [opt, desc] of Object.entries(info.opts)) {
          console.log(`  --${opt.padEnd(18)} ${desc}`);
        }
        console.log();
      }
      if (info.examples?.length) {
        console.log("Examples:");
        for (const ex of info.examples) {
          console.log(`  surf ${ex.cmd.padEnd(40)} ${ex.desc}`);
        }
        console.log();
      }
      // Show related commands
      const related = SEE_ALSO[toolName];
      if (related && related.length > 0) {
        console.log(`See also: ${related.join(", ")}`);
        console.log();
      }
      return;
    }
  }
  if (ALL_SOCKET_TOOLS.includes(toolName)) {
    console.log(`\n  ${toolName}\n`);
    console.log("  Socket API tool. Use --json to see response format.\n");
    // Show related commands for socket tools too
    const related = SEE_ALSO[toolName];
    if (related && related.length > 0) {
      console.log(`See also: ${related.join(", ")}`);
      console.log();
    }
    return;
  }
  console.error(`Unknown command: ${toolName}`);
  process.exit(1);
};

const fuzzyFind = (query) => {
  const terms = query.toLowerCase().split(/\s+/);
  const results = [];

  for (const cmd of HEADLESS_COMMAND_LIST) {
    const desc = HEADLESS_COMMAND_HELP[cmd] || "";
    const searchText = `${cmd} ${desc} headless ai`.toLowerCase();
    const score = terms.filter((t) => searchText.includes(t)).length;
    if (score > 0) {
      results.push({ cmd, desc, group: "headless", score });
    }
  }

  return results.sort((a, b) => b.score - a.score);
};

const showFindResults = (query) => {
  const results = fuzzyFind(query);
  if (results.length === 0) {
    console.log(`No commands found for: "${query}"`);
    return;
  }
  console.log(`\nSearch results for "${query}":\n`);
  for (const r of results.slice(0, 10)) {
    console.log(`  ${r.cmd.padEnd(24)} ${r.desc}`);
  }
  console.log();
};

const showAbout = (topic) => {
  const t = HELP_TOPICS[topic];
  if (t) {
    showHelpTopic(topic);
    return;
  }
  const topicLower = topic.toLowerCase();
  for (const [groupName, group] of Object.entries(TOOLS)) {
    if (groupName === topicLower || group.desc.toLowerCase().includes(topicLower)) {
      showGroupHelp(groupName);
      return;
    }
  }
  console.error(`Unknown topic: ${topic}`);
  console.error(`Available topics: ${Object.keys(HELP_TOPICS).join(", ")}`);
  console.error(`Or use a group name: ${Object.keys(TOOLS).join(", ")}`);
  process.exit(1);
};

const showAllTools = () => {
  console.log("\n  All available commands:\n");
  const sorted = [...HEADLESS_COMMAND_LIST].sort();
  for (const cmd of sorted) {
    console.log(`  ${cmd.padEnd(24)} ${HEADLESS_COMMAND_HELP[cmd] || ""}`);
  }
  console.log(`\n  Total: ${HEADLESS_COMMAND_LIST.length} commands\n`);
};

const showSessionHelp = () => {
  console.log(`
session - inspect and reconcile saved surf sessions

Usage:
  surf session                      List recent sessions
  surf session <id>                 View a session
  surf session --reconcile          Reconcile orphaned sessions
  surf session --reconcile --network  + poll ChatGPT remotely
  surf session --all                Show all sessions
  surf session --hours 72           Last 72 hours
  surf session --clear              Delete all sessions
  surf session --clear --hours 24   Delete sessions older than 24h
`);
};

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  showBasicHelp();
  process.exit(0);
}

if (args[0] === "--help-full") {
  showFullHelp();
  process.exit(0);
}

if (args[0] === "--help-topic" && args[1]) {
  showHelpTopic(args[1]);
  process.exit(0);
}

if (args[0] === "--version" || args[0] === "-v") {
  console.log(`surf version ${VERSION}`);
  process.exit(0);
}

if (args[0] === "--list") {
  showAllTools();
  process.exit(0);
}

if (args[0] === "--find" && args[1]) {
  showFindResults(args.slice(1).join(" "));
  process.exit(0);
}

if (args[0] === "--about" && args[1]) {
  showAbout(args[1]);
  process.exit(0);
}

if ((args[0] === "session" || args[0] === "sessions") && (args.includes("--help") || args.includes("-h"))) {
  showSessionHelp();
  process.exit(0);
}

if (args[0] === "server") {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: surf server");
    console.log("");
    console.log("Start MCP server for Claude Desktop/Cursor integration.");
    console.log("Communicates via stdio using the Model Context Protocol.");
    process.exit(0);
  }
  const { PiChromeMcpServer } = require("./mcp-server.cjs");
  const server = new PiChromeMcpServer();
  server.start().catch((err) => {
    console.error("MCP Server error:", err.message);
    process.exit(1);
  });
  return;
}

if (args[0] === "skills" || args[0] === "skill") {
  process.stdout.write(SURF_SKILL_DOC);
  process.exit(0);
}

// ============================================================================
// surf session — list / view / clear sessions (Oracle-style)
// ============================================================================

if (args[0] === "session" || args[0] === "sessions") {
  const sessionArgs = args.slice(1);

  // Guard: --clear and --reconcile are mutually exclusive
  if (sessionArgs.includes("--clear") && sessionArgs.includes("--reconcile")) {
    console.error("Error: cannot combine --clear with --reconcile");
    process.exit(1);
  }

  // surf session --reconcile [--hours N] [--all] [--network]
  if (sessionArgs.includes("--reconcile")) {
    const allFlag    = sessionArgs.includes("--all");
    const networkFlag = sessionArgs.includes("--network");
    const hoursIdx   = sessionArgs.indexOf("--hours");
    const rawHours   = hoursIdx !== -1 ? Number(sessionArgs[hoursIdx + 1]) : 72;
    const hours      = (Number.isFinite(rawHours) && rawHours > 0) ? rawHours : 72;

    let manageChats = null;
    let skipNetworkReason = null;
    if (networkFlag) {
      if (!isCloakBrowserAvailable()) {
        skipNetworkReason = "CloakBrowser not installed";
      } else {
        manageChats = manageChatsWithCloakBrowser;
      }
    }
    if (skipNetworkReason) {
      console.error(`Warning: ${skipNetworkReason} — skipping network poll`);
    }

    (async () => {
      const { reconciled, sessions } = await sessionReconciler.reconcileSessions({
        hours,
        all: allFlag,
        pollNetwork: networkFlag && !skipNetworkReason,
        manageChats,
      });

      if (sessions.length === 0) {
        console.log("No running sessions to reconcile.");
        process.exit(0);
      }

      const actionLabel = { none: "alive", stale: "stale", orphaned: "orphaned", recovered: "recovered", unresolved: "unresolved" };
      for (const r of sessions) {
        const icon = r.action === "none" ? "~" : r.action === "recovered" ? "✓" : r.action === "unresolved" ? "?" : r.action === "stale" ? "!" : "✗";
        const extra = r.conversationId ? ` (conv: ${r.conversationId.slice(0,  8)}…)` : "";
        const pid   = r.meta.pid ? ` pid:${r.meta.pid}` : "";
        const age   = r.meta.reconcile ? ` age:${Math.round(r.meta.reconcile.ageSec / 60)}min` : "";
        console.log(`  ${icon} ${r.meta.id.slice(0, 52)}  → ${actionLabel[r.action] || r.action}${pid}${age}${extra}`);
      }
      console.log(`\nReconciled ${reconciled} session(s).${networkFlag && !skipNetworkReason ? " (with network poll)" : ""}`);
      process.exit(0);
    })();
    return;
  }

  // surf session --clear [--hours N | --all]
  if (sessionArgs.includes("--clear")) {
    const allFlag  = sessionArgs.includes("--all");
    const hoursIdx = sessionArgs.indexOf("--hours");
    let hours      = undefined;
    if (hoursIdx !== -1) {
      const raw = Number(sessionArgs[hoursIdx + 1]);
      if (!Number.isFinite(raw) || raw <= 0) {
        console.error(`Error: --hours must be a positive number (got: ${sessionArgs[hoursIdx + 1]})`);
        process.exit(1);
      }
      hours = raw;
    }
    const { deleted, remaining } = sessionStore.deleteSessions({ all: allFlag, hours });
    const label = allFlag ? "all sessions" : hours ? `sessions older than ${hours}h` : "all sessions";
    console.log(`Deleted ${deleted} sessions (${label}). ${remaining} sessions remain.`);
    process.exit(0);
  }

  // surf session <id>  — view a single session log
  // Skip values that follow --hours / --limit (they're numeric args, not session IDs)
  const flagsWithValues = new Set(["--hours", "--limit"]);
  const idArg = sessionArgs.find((a, i) => {
    if (a.startsWith("-")) return false;
    if (i > 0 && flagsWithValues.has(sessionArgs[i - 1])) return false;
    return true;
  });
  if (idArg) {
    const found = sessionStore.loadSession(idArg);
    if (!found) {
      console.error(`Session not found: ${idArg}`);
      process.exit(1);
    }
    const { meta, log } = found;
    const status  = meta.status === "completed" ? "✓" : meta.status === "error" ? "✗" : "◌";
    const elapsed = meta.elapsedMs ? `${(meta.elapsedMs / 1000).toFixed(1)}s` : "-";
    console.log(`\n${status} ${meta.id}`);
    console.log(`  Tool:    ${meta.tool}`);
    console.log(`  Status:  ${meta.status}`);
    console.log(`  Created: ${meta.createdAt}`);
    console.log(`  Elapsed: ${elapsed}`);
    if (meta.args?.query)  console.log(`  Query:   ${meta.args.query}`);
    if (meta.args?.file)   console.log(`  File:    ${meta.args.file}`);
    if (meta.args?.model)  console.log(`  Model:   ${meta.args.model}`);
    if (meta.result?.responsePath) console.log(`  Response: ${meta.result.responsePath}`);
    if (meta.error)        console.log(`  Error:   ${meta.error.message}`);
    if (log) {
      console.log(`\n--- output.log ---`);
      console.log(log);
    }
    process.exit(0);
  }

  // surf session [--all] [--hours N] [--limit N]  — list sessions
  const allFlag  = sessionArgs.includes("--all");
  const hoursIdx = sessionArgs.indexOf("--hours");
  const rawHours = hoursIdx !== -1 ? Number(sessionArgs[hoursIdx + 1]) : 24;
  const hours    = (Number.isFinite(rawHours) && rawHours > 0) ? rawHours : 24;
  const limitIdx = sessionArgs.indexOf("--limit");
  const rawLimit = limitIdx !== -1 ? Number(sessionArgs[limitIdx + 1]) : 50;
  const limit    = (Number.isFinite(rawLimit) && rawLimit > 0) ? Math.floor(rawLimit) : 50;

  // Auto-reconcile (local PID check only — fast, no network) before displaying
  (async () => {
    await sessionReconciler.reconcileSessions({ hours, all: allFlag, limit, pollNetwork: false });

    const sessions = sessionStore.listSessions({ hours, all: allFlag, limit });

    if (sessions.length === 0) {
      console.log(`No sessions found in the last ${allFlag ? "" : hours + "h "}at ${sessionStore.SESSIONS_DIR}`);
      console.log(`  surf session --all          Show all sessions`);
      console.log(`  surf session --hours 72     Last 72 hours`);
      process.exit(0);
    }

    // Header
    console.log(`\nSurf sessions (${sessions.length}) — ${sessionStore.SESSIONS_DIR}\n`);
    const pad = (s, n) => String(s ?? "").padEnd(n);

    // Status label: show reconcile state for annotated running sessions
    const statusLabel = (s) => {
      if (s.status === "completed") return "✓ completed";
      if (s.status === "error") {
        if (s.reconcile) return "✗ orphaned";
        return "✗ error";
      }
      if (s.status === "running") {
        if (s.reconcile) {
          const st = s.reconcile.state;
          if (st === "stale" || st === "orphaned") return "! stale";
          if (st === "unresolved") return "? running";
          if (st === "recovered") return "✓ recovered";
        }
        return "◌ running";
      }
      return `· ${s.status}`;
    };

    // Column widths
    const maxId  = Math.min(48, Math.max(20, ...sessions.map(s => s.id.length)));
    const header = `  ${pad("STATUS",13)} ${pad("TOOL",10)} ${pad("ID", maxId)} ${pad("ELAPSED",8)} CREATED`;
    console.log(header);
    console.log("  " + "-".repeat(header.length - 2));

    for (const s of sessions) {
      const label   = statusLabel(s);
      const elapsed = s.elapsedMs ? `${(s.elapsedMs / 1000).toFixed(1)}s` : "-";
      const created = new Date(s.createdAt).toLocaleString("en-US", {
        month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
      });
      console.log(`  ${pad(label,13)} ${pad(s.tool,10)} ${pad(s.id, maxId)} ${pad(elapsed,8)} ${created}`);
    }

    console.log(`\nUsage:`);
    console.log(`  surf session <id>                View session log`);
    console.log(`  surf session --reconcile         Fix orphaned sessions`);
    console.log(`  surf session --reconcile --network  + poll ChatGPT API`);
    console.log(`  surf session --hours 72          Last 72h`);
    console.log(`  surf session --all               All sessions`);
    console.log(`  surf session --clear             Delete all`);
    console.log(`  surf session --clear --hours 24  Delete sessions older than 24h`);
    process.exit(0);
  })();
}

if (["extension-path", "path", "install", "uninstall"].includes(args[0])) {
  console.error("Error: extension commands were removed in headless-only mode");
  process.exit(1);
}

if (args.includes("--help") || args.includes("-h")) {
  const tool = args[0];
  if (TOOLS[tool]) {
    showGroupHelp(tool);
  } else {
    showToolHelp(tool);
  }
  process.exit(0);
}

if (TOOLS[args[0]] && args.length === 1) {
  const group = TOOLS[args[0]];
  const sameNameCmd = group.commands[args[0]];
  const executableAlone = ["zoom"];
  if (sameNameCmd && executableAlone.includes(args[0])) {
    // Command that works without args - execute it
  } else {
    showGroupHelp(args[0]);
    process.exit(0);
  }
}

if (args[0] === "config") {
  const configArgs = args.slice(1);
  const hasInit = configArgs.includes("--init");
  const hasPath = configArgs.includes("--path");

  if (hasInit) {
    const result = createStarterConfig();
    if (result.success) {
      console.log(`Created: ${result.path}`);
    } else {
      console.error(`Error: ${result.error}`);
      console.error(`Path: ${result.path}`);
      process.exit(1);
    }
    process.exit(0);
  }

  if (hasPath) {
    loadConfig();
    const configPath = getConfigPath();
    if (configPath) {
      console.log(configPath);
    } else {
      console.log("No config found");
    }
    process.exit(0);
  }

  const config = loadConfig();
  const configPath = getConfigPath();
  if (configPath) {
    console.log(JSON.stringify(config, null, 2));
  } else {
    console.log("No config found");
    console.log("Create one with: surf config --init");
  }
  process.exit(0);
}

if (args.includes("--script")) {
  const scriptIdx = args.indexOf("--script");
  const scriptPath = args[scriptIdx + 1];
  const dryRun = args.includes("--dry-run");
  const stopOnError = args.includes("--stop-on-error");

  const tabIdIdx = args.indexOf("--tab-id");
  const scriptTabId = tabIdIdx !== -1 ? args[tabIdIdx + 1] : undefined;

  if (!scriptPath || scriptPath.startsWith("--")) {
    console.error("Error: --script requires a file path");
    process.exit(1);
  }

  if (!fs.existsSync(scriptPath)) {
    console.error(`Error: Script file not found: ${scriptPath}`);
    process.exit(1);
  }

  let script;
  try {
    const content = fs.readFileSync(scriptPath, "utf8");
    script = JSON.parse(content);
  } catch (e) {
    console.error(`Error: Failed to parse script: ${e.message}`);
    process.exit(1);
  }

  if (!script.steps || !Array.isArray(script.steps)) {
    console.error("Error: Script must have a 'steps' array");
    process.exit(1);
  }

  const sendScriptRequest = (toolName, toolArgs = {}) => {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(SOCKET_PATH, () => {
        const req = {
          type: "tool_request",
          method: "execute_tool",
          params: { tool: toolName, args: toolArgs },
          id: "cli-" + Date.now() + "-" + Math.random(),
        };
        if (scriptTabId) req.tabId = parseInt(scriptTabId, 10);
        sock.write(JSON.stringify(req) + "\n");
      });
      let buf = "";
      sock.on("data", (d) => {
        buf += d.toString();
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const resp = JSON.parse(line);
            sock.end();
            resolve(resp);
          } catch {
            sock.end();
            reject(new Error("Invalid JSON"));
          }
        }
      });
      sock.on("error", (e) => reject(e));
      let timeoutId;
      timeoutId = setTimeout(() => { sock.destroy(); reject(new Error("Timeout")); }, 30000);
      sock.on("close", () => clearTimeout(timeoutId));
    });
  };

  const runScript = async () => {
    const total = script.steps.length;
    const results = [];
    let failed = 0;

    console.log(`Running: ${script.name || scriptPath} (${total} steps)`);
    if (dryRun) console.log("(dry-run mode)\n");
    else console.log("");

    for (let i = 0; i < total; i++) {
      const step = script.steps[i];
      const stepNum = `[${i + 1}/${total}]`;
      const toolName = step.tool;
      const toolArgs = step.args || {};

      const argSummary = Object.entries(toolArgs)
        .map(([k, v]) => typeof v === "string" && v.length > 40 ? `${k}="${v.slice(0, 37)}..."` : `${k}=${JSON.stringify(v)}`)
        .join(" ");
      const desc = argSummary ? `${toolName} ${argSummary}` : toolName;

      if (dryRun) {
        console.log(`${stepNum} ${desc}`);
        results.push({ step: i + 1, tool: toolName, status: "skipped" });
        continue;
      }

      process.stdout.write(`${stepNum} ${desc} ... `);

      try {
        const resp = await sendScriptRequest(toolName, toolArgs);
        if (resp.error) {
          const errText = resp.error.content?.[0]?.text || JSON.stringify(resp.error);
          console.log(`FAIL`);
          console.log(`     Error: ${errText}`);
          results.push({ step: i + 1, tool: toolName, status: "fail", error: errText });
          failed++;
          if (stopOnError) break;
        } else {
          console.log("OK");
          results.push({ step: i + 1, tool: toolName, status: "ok" });
        }
      } catch (e) {
        console.log(`FAIL`);
        console.log(`     Error: ${e.message}`);
        results.push({ step: i + 1, tool: toolName, status: "fail", error: e.message });
        failed++;
        if (stopOnError) break;
      }
    }

    console.log("");
    const passed = results.filter(r => r.status === "ok").length;
    const skipped = results.filter(r => r.status === "skipped").length;
    if (dryRun) {
      console.log(`Summary: ${skipped} steps would run`);
    } else {
      console.log(`Summary: ${passed} passed, ${failed} failed, ${total} total`);
    }

    process.exit(failed > 0 ? 1 : 0);
  };

  runScript();
  return;
}

// Handle `surf do` workflow command
// Must be parsed before general parseArgs since it uses its own arg handling
if (args[0] === "do") {
  const doArgs = args.slice(1);
  let commandsInput = null;
  let fileInput = null;
  let dryRun = false;
  let onError = "stop";
  let noAutoWait = false;
  let stepDelay = 100;
  let wantJson = false;
  let tabId = undefined;
  let windowId = undefined;
  
  // Reserved flags that aren't workflow args
  const reservedFlags = ['file', 'f', 'dry-run', 'on-error', 'no-auto-wait', 'step-delay', 'json', 'tab-id', 'window-id'];
  
  // Workflow-specific args (collected for variable substitution)
  const workflowArgs = {};
  
  // Parse do-specific arguments
  for (let i = 0; i < doArgs.length; i++) {
    const arg = doArgs[i];
    if (arg === "--file" || arg === "-f") {
      fileInput = doArgs[i + 1];
      i++;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--on-error") {
      onError = doArgs[i + 1] || "stop";
      i++;
    } else if (arg === "--no-auto-wait") {
      noAutoWait = true;
    } else if (arg === "--step-delay") {
      const parsed = parseInt(doArgs[i + 1], 10);
      stepDelay = isNaN(parsed) ? 100 : parsed;
      i++;
    } else if (arg === "--json") {
      wantJson = true;
    } else if (arg === "--tab-id") {
      tabId = parseInt(doArgs[i + 1], 10);
      i++;
    } else if (arg === "--window-id") {
      windowId = parseInt(doArgs[i + 1], 10);
      i++;
    } else if (arg.startsWith("--")) {
      // Workflow-specific arg (e.g., --email, --password)
      const key = arg.slice(2);
      if (!reservedFlags.includes(key)) {
        const next = doArgs[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          // Type coercion
          let val = next;
          if (val === "true") val = true;
          else if (val === "false") val = false;
          else if (/^-?\d+$/.test(val)) val = parseInt(val, 10);
          else if (/^-?\d+\.\d+$/.test(val)) val = parseFloat(val);
          workflowArgs[key] = val;
          i++;
        } else {
          workflowArgs[key] = true;
        }
      }
    } else if (!arg.startsWith("-")) {
      commandsInput = arg;
    }
  }
  
  if (!commandsInput && !fileInput) {
    console.error("Error: commands string, workflow name, or --file required");
    console.error('Usage: surf do \'go "url" | click e5\'');
    console.error("       surf do --file workflow.json");
    console.error("       surf do my-workflow --arg1 value1 --arg2 value2");
    process.exit(1);
  }
  
  let steps;
  let workflow = null; // Full workflow object (for arg validation)
  let workflowName = null;
  
  try {
    if (fileInput) {
      // Explicit file path via --file
      if (!fs.existsSync(fileInput)) {
        console.error(`Error: File not found: ${fileInput}`);
        process.exit(1);
      }
      const content = fs.readFileSync(fileInput, "utf8");
      workflow = JSON.parse(content);
      workflowName = workflow.name || fileInput;
    } else {
      // Resolve: inline | file path | named workflow
      const resolved = resolveWorkflow(commandsInput);
      
      if (resolved.type === 'inline') {
        // Inline pipe syntax
        steps = parseDoCommands(resolved.content);
      } else if (resolved.type === 'file') {
        // Found workflow file
        const content = fs.readFileSync(resolved.path, "utf8");
        workflow = JSON.parse(content);
        workflowName = workflow.name || commandsInput;
      } else {
        // Not found - try parsing as inline (might be a single command)
        steps = parseDoCommands(commandsInput);
        if (steps.length === 0) {
          console.error(`Error: Workflow not found: ${commandsInput}`);
          console.error(`Searched in:`);
          for (const { path: dir } of getWorkflowDirs()) {
            console.error(`  ${dir}`);
          }
          console.error(`\nRun 'surf workflow.list' to see available workflows.`);
          process.exit(1);
        }
      }
    }
    
    // Process workflow file if loaded
    if (workflow) {
      if (!workflow.steps || !Array.isArray(workflow.steps)) {
        throw new Error("Workflow must have a 'steps' array");
      }
      
      // Validate required args
      const argErrors = validateWorkflowArgs(workflow, workflowArgs);
      if (argErrors.length > 0) {
        console.error("Error: Missing required arguments:");
        argErrors.forEach(e => console.error(`  ${e}`));
        if (workflow.args) {
          console.error(`\nWorkflow arguments:`);
          for (const [name, spec] of Object.entries(workflow.args)) {
            const req = spec.required ? ' (required)' : '';
            const def = spec.default !== undefined ? ` [default: ${spec.default}]` : '';
            const desc = spec.desc || spec.description || '';
            console.error(`  --${name}${req}${def}${desc ? ` - ${desc}` : ''}`);
          }
        }
        console.error(`\nRun 'surf workflow.info ${workflowName}' for details.`);
        process.exit(1);
      }
      
      // Convert steps: support both { tool, args } and { cmd, args } formats
      // Also preserve loop steps as-is
      steps = workflow.steps.map(s => {
        if (s.repeat !== undefined || s.each !== undefined) {
          // Loop step - convert nested steps recursively
          const convertSteps = (stepsArr) => stepsArr.map(ns => {
            if (ns.repeat !== undefined || ns.each !== undefined) {
              // Recursively convert nested loop steps and until condition
              return { 
                ...ns, 
                steps: convertSteps(ns.steps || []),
                until: ns.until ? { cmd: ns.until.tool || ns.until.cmd, args: ns.until.args || {} } : undefined
              };
            }
            return { cmd: ns.tool || ns.cmd, args: ns.args || {}, as: ns.as };
          });
          return { 
            ...s, 
            steps: convertSteps(s.steps || []),
            until: s.until ? { cmd: s.until.tool || s.until.cmd, args: s.until.args || {} } : undefined
          };
        }
        return { cmd: s.tool || s.cmd, args: s.args || {}, as: s.as };
      });
    }
  } catch (e) {
    console.error(`Error: Failed to parse workflow: ${e.message}`);
    process.exit(1);
  }
  
  if (!steps || steps.length === 0) {
    console.error("Error: No commands found in workflow");
    process.exit(1);
  }
  
  // Apply arg defaults
  const vars = workflow ? applyArgDefaults(workflow, workflowArgs) : workflowArgs;
  
  // Validate with --dry-run
  if (dryRun) {
    if (workflowName) {
      console.log(`Workflow: ${workflowName}`);
      if (workflow?.description) console.log(`Description: ${workflow.description}`);
    }
    console.log(`\nWould execute ${steps.length} steps:`);
    steps.forEach((s, i) => {
      console.log(`  ${i + 1}. ${formatStep(s)}`);
    });
    if (Object.keys(vars).length > 0) {
      console.log(`\nVariables:`);
      for (const [k, v] of Object.entries(vars)) {
        console.log(`  ${k} = ${JSON.stringify(v)}`);
      }
    }
    process.exit(0);
  }
  
  if (!wantJson) {
    if (workflowName) {
      console.log(`Running workflow: ${workflowName} (${steps.length} steps)...\n`);
    } else {
      console.log(`Running workflow (${steps.length} steps)...\n`);
    }
  }
  
  const runWorkflow = async () => {
    const result = await executeDoSteps(steps, {
      onError,
      autoWait: !noAutoWait,
      stepDelay,
      quiet: wantJson,
      vars,
      context: {
        tabId,
        windowId,
      },
    });
    
    // Print summary
    if (wantJson) {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.status === "completed" ? 0 : 1);
    }
    
    console.log("");
    if (result.status === "completed") {
      console.log(`Completed: ${result.completedSteps}/${result.totalSteps} steps (${result.totalMs}ms)`);
      process.exit(0);
    } else if (result.status === "partial") {
      console.log(`Partial: ${result.completedSteps}/${result.totalSteps} steps completed, ${result.failed} failed`);
      process.exit(1);
    } else {
      console.error(`Failed: ${result.completedSteps}/${result.totalSteps} steps completed`);
      if (result.error) console.error(`Error: ${result.error}`);
      process.exit(1);
    }
  };
  
  runWorkflow();
  return;
}

// Handle workflow management commands
if (args[0] === "workflow.list") {
  const workflows = listWorkflows();
  
  if (workflows.length === 0) {
    console.log("No workflows found.");
    console.log(`\nWorkflow directories:`);
    for (const { path: dir, scope } of getWorkflowDirs()) {
      console.log(`  ${scope}: ${dir}`);
    }
    console.log(`\nCreate a workflow JSON file in one of these directories.`);
    process.exit(0);
  }
  
  // Group by scope
  const byScope = { project: [], user: [] };
  for (const w of workflows) {
    byScope[w.scope].push(w);
  }
  
  if (byScope.user.length > 0) {
    console.log(`User Workflows (~/.surf/workflows/):`);
    for (const w of byScope.user) {
      const desc = w.description ? ` - ${w.description}` : '';
      console.log(`  ${w.name.padEnd(20)} ${desc}`);
    }
    console.log("");
  }
  
  if (byScope.project.length > 0) {
    console.log(`Project Workflows (./.surf/workflows/):`);
    for (const w of byScope.project) {
      const desc = w.description ? ` - ${w.description}` : '';
      console.log(`  ${w.name.padEnd(20)} ${desc}`);
    }
    console.log("");
  }
  
  console.log(`Run 'surf workflow.info <name>' for details.`);
  process.exit(0);
}

if (args[0] === "workflow.info") {
  const name = args[1];
  if (!name) {
    console.error("Error: workflow name required");
    console.error("Usage: surf workflow.info <name>");
    process.exit(1);
  }
  
  const info = getWorkflowInfo(name);
  if (info.error) {
    console.error(`Error: ${info.error}`);
    process.exit(1);
  }
  
  console.log(`${info.name}${info.description ? ` - ${info.description}` : ''}`);
  console.log("");
  
  // Arguments
  if (info.args && Object.keys(info.args).length > 0) {
    console.log("Arguments:");
    for (const [argName, spec] of Object.entries(info.args)) {
      const req = spec.required ? ' (required)' : '';
      const def = spec.default !== undefined ? ` [default: ${spec.default}]` : '';
      const desc = spec.desc || spec.description || '';
      console.log(`  --${argName}${req}${def}`);
      if (desc) console.log(`      ${desc}`);
    }
    console.log("");
  }
  
  // Steps
  console.log(`Steps (${info.steps.length}):`);
  info.steps.forEach((step, i) => {
    console.log(`  ${i + 1}. ${formatStep(step)}`);
  });
  console.log("");
  
  // Location
  console.log(`Location: ${info.path}`);
  console.log("");
  
  // Example run command
  const argExample = Object.entries(info.args || {})
    .filter(([_, spec]) => spec.required)
    .map(([name, _]) => `--${name} "..."`)
    .join(' ');
  console.log(`Run:`);
  console.log(`  surf do ${name}${argExample ? ' ' + argExample : ''}`);
  
  process.exit(0);
}

if (args[0] === "workflow.validate") {
  const filePath = args[1];
  if (!filePath) {
    console.error("Error: file path required");
    console.error("Usage: surf workflow.validate <file>");
    process.exit(1);
  }
  
  const result = validateWorkflowFile(filePath);
  
  if (result.valid) {
    console.log(`✓ Valid workflow: ${filePath}`);
    console.log(`  Name: ${result.workflow.name || '(unnamed)'}`);
    console.log(`  Steps: ${result.workflow.steps.length}`);
    if (result.workflow.args) {
      const argCount = Object.keys(result.workflow.args).length;
      const reqCount = Object.values(result.workflow.args).filter(a => a.required).length;
      console.log(`  Args: ${argCount} (${reqCount} required)`);
    }
    process.exit(0);
  } else {
    console.error(`✗ Invalid workflow: ${filePath}`);
    console.error(`  Error: ${result.error}`);
    process.exit(1);
  }
}

const BOOLEAN_FLAGS = ["auto-capture", "json", "stream", "dry-run", "stop-on-error", "fail-fast", "clear", "submit", "all", "case-sensitive", "hard", "annotate", "fullpage", "reset", "no-screenshot", "full", "soft-fail", "has-body", "exclude-static", "v", "vv", "request", "by-tab", "har", "jsonl", "no-save", "no-auto-wait", "with-page", "continue"];

const AUTO_SCREENSHOT_TOOLS = ["click", "type", "key", "smart_type", "form.fill", "form_input", "drag", "hover", "scroll", "scroll.top", "scroll.bottom", "scroll.to", "dialog.accept", "dialog.dismiss", "js", "eval"];

const parseArgs = (rawArgs) => {
  const result = { positional: [], options: {} };
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (BOOLEAN_FLAGS.includes(key)) {
        result.options[key] = true;
      } else {
        const next = rawArgs[i + 1];
        if (next !== undefined && !next.startsWith("--") && !next.startsWith("-")) {
          let val = next;
          if (val === "true") val = true;
          else if (val === "false") val = false;
          else if (/^-?\d+$/.test(val)) val = parseInt(val, 10);
          else if (/^-?\d+\.\d+$/.test(val)) val = parseFloat(val);
          result.options[key] = val;
          i++;
        } else {
          result.options[key] = true;
        }
      }
    } else if (arg === "-v") {
      result.options.v = true;
    } else if (arg === "-vv") {
      result.options.vv = true;
    } else if (arg === "-f" && rawArgs[i + 1] && !rawArgs[i + 1].startsWith("-")) {
      // -f takes a file path argument (for surf do -f <file>)
      result.options.file = rawArgs[i + 1];
      i++;
    } else if (arg.startsWith("-") && arg.length === 2) {
      // Short flag like -n
      result.options[arg.slice(1)] = true;
    } else {
      result.positional.push(arg);
    }
  }
  return result;
};

let { positional, options } = parseArgs(args);
let tool = positional[0];
let firstArg = positional[1];

if (!tool) {
  console.error("Error: No command specified");
  process.exit(1);
}

if (REMOVED_COMMANDS[tool]) {
  console.error(`Error: Unknown command: ${tool}`);
  console.error(`This command was renamed. Use: ${REMOVED_COMMANDS[tool]}`);
  process.exit(1);
}

tool = ALIASES[tool] || tool;

if (UNSUPPORTED_HEADLESS_COMMANDS.has(tool)) {
  console.error(`Error: Command '${tool}' is no longer supported in headless-only mode.`);
  console.error("Supported AI commands: chatgpt, gemini");
  process.exit(1);
}

// Auto-save screenshots to temp file when no --output specified
// This ensures agents always get a usable file path, not just an in-memory ID
// Can be disabled with --no-save flag or autoSaveScreenshots: false in surf.json
const config = loadConfig();
const autoSaveEnabled = config.autoSaveScreenshots !== false && !options["no-save"];
if (tool === "screenshot" && !options.output && !options.savePath && autoSaveEnabled) {
  options.savePath = path.join(SURF_TMP, `surf-snap-${Date.now()}.png`);
}

if (tool === "smoke") {
  const smokeUrls = [];
  const smokeArgs = args.slice(1);
  for (let i = 0; i < smokeArgs.length; i++) {
    const arg = smokeArgs[i];
    if (arg === "--urls") {
      i++;
      while (i < smokeArgs.length && !smokeArgs[i].startsWith("--")) {
        smokeUrls.push(smokeArgs[i]);
        i++;
      }
      i--;
    } else if (arg === "--routes") {
      options.routes = smokeArgs[i + 1];
      i++;
    } else if (arg === "--screenshot") {
      options.screenshot = smokeArgs[i + 1];
      i++;
    } else if (arg === "--fail-fast") {
      options["fail-fast"] = true;
    }
  }
  if (smokeUrls.length > 0) {
    options.urls = smokeUrls;
  }
}

const PRIMARY_ARG_MAP = {
  ai: "query",
  gemini: "query",
  chatgpt: "query",
  "chatgpt.chats": "conversationId",
  "chatgpt.reply": "conversationId",
  "slack.read": "channelId",
  navigate: "url",
  go: "url",
  js: "code",
  javascript_tool: "code",
  key: "key",
  wait: "duration",
  health: "url",
  new_tab: "url",
  "tab.new": "url",
  switch_tab: "tab_id",
  "tab.switch": "id",
  close_tab: "tab_id",
  "tab.close": "id",
  "tab.name": "name",
  "tab.unname": "name",
  scroll_to_position: "position",
  type: "text",
  smart_type: "text",
  "emulate.network": "preset",
  "emulate.cpu": "rate",
  search: "term",
  find: "term",
  "wait.element": "selector",
  "wait.url": "pattern",
  zoom: "level",
  "history.search": "query",
  "network.get": "id",
  "network.body": "id",
  "network.curl": "id",
  "network.path": "id",
  "window.new": "url",
  "window.focus": "id",
  "window.close": "id",
  "locate.role": "role",
  "locate.text": "text",
  "locate.label": "label",
  "emulate.device": "device",
  "frame.js": "code",
  "element.styles": "selector",
  "select": "selector",
};

const toolArgs = { ...options };

if (tool === "click" && firstArg) {
  if (/^e\d+$/.test(firstArg)) {
    toolArgs.ref = firstArg;
    firstArg = undefined;
  } else if (/^\d+$/.test(firstArg) && positional[2] && /^\d+$/.test(positional[2])) {
    toolArgs.x = parseInt(firstArg, 10);
    toolArgs.y = parseInt(positional[2], 10);
    firstArg = undefined;
  }
}

if (firstArg !== undefined) {
  const primaryKey = PRIMARY_ARG_MAP[tool];
  if (primaryKey && toolArgs[primaryKey] === undefined) {
    let val = firstArg;
    if (val === "true") val = true;
    else if (val === "false") val = false;
    else if (/^-?\d+$/.test(val)) val = parseInt(val, 10);
    toolArgs[primaryKey] = val;
  }
}

if (tool === "chatgpt.reply") {
  toolArgs.prompt = positional.slice(2).join(" ").trim();
  toolArgs.query = toolArgs.prompt;
}

if ((tool === "chatgpt" || tool === "gemini") && (toolArgs["with-page"] || toolArgs.withPage)) {
  console.error("Error: --with-page is not supported in headless-only mode");
  process.exit(1);
}

if ((tool === "chatgpt" || tool === "chatgpt.chats" || tool === "chatgpt.reply") && toolArgs.continue) {
  console.error("Error: --continue (headed mode) is not supported in headless-only mode");
  process.exit(1);
}

if (tool === "js" && toolArgs.file) {
  try {
    toolArgs.code = fs.readFileSync(toolArgs.file, "utf8");
    delete toolArgs.file;
  } catch (e) {
    console.error(`Error: Failed to read file: ${e.message}`);
    process.exit(1);
  }
}

// Handle select command: capture multiple values after selector
if (tool === "select" && positional.length > 2) {
  const values = positional.slice(2);  // All args after "select <selector>"
  toolArgs.values = values.length === 1 ? values[0] : values;
} else if (tool === "select" && positional.length === 2) {
  // Only selector provided, no values
  console.error("Error: select requires at least one value");
  console.error("Usage: surf select <selector> <value...>");
  process.exit(1);
}

if (toolArgs.into && !toolArgs.selector) {
  toolArgs.selector = toolArgs.into;
  delete toolArgs.into;
}

const globalOpts = {};
if (toolArgs["tab-id"] !== undefined) {
  const tid = parseInt(toolArgs["tab-id"], 10);
  if (isNaN(tid)) {
    console.error("Error: --tab-id must be a number");
    process.exit(1);
  }
  globalOpts.tabId = tid;
  delete toolArgs["tab-id"];
}
if (toolArgs["window-id"] !== undefined) {
  const wid = parseInt(toolArgs["window-id"], 10);
  if (isNaN(wid)) {
    console.error("Error: --window-id must be a number");
    process.exit(1);
  }
  globalOpts.windowId = wid;
  delete toolArgs["window-id"];
}
if (toolArgs["network-path"] !== undefined) {
  networkStore.setBasePath(toolArgs["network-path"]);
  delete toolArgs["network-path"];
}
const wantJson = toolArgs.json === true;
delete toolArgs.json;

const autoCapture = toolArgs["auto-capture"] === true;
delete toolArgs["auto-capture"];

const noScreenshot = toolArgs["no-screenshot"] === true;
delete toolArgs["no-screenshot"];

const softFail = toolArgs["soft-fail"] === true;
delete toolArgs["soft-fail"];

normalizeLegacyChatGptEnv();

if (!noScreenshot && AUTO_SCREENSHOT_TOOLS.includes(tool)) {
  toolArgs.autoScreenshot = true;
}

const outputPath = toolArgs.output;
delete toolArgs.output;
if (tool === "gemini") {
  if (outputPath) toolArgs.output = path.resolve(outputPath);
  if (toolArgs["generate-image"] && typeof toolArgs["generate-image"] === "string") {
    toolArgs["generate-image"] = path.resolve(toolArgs["generate-image"]);
  }
  if (toolArgs["edit-image"] && typeof toolArgs["edit-image"] === "string") {
    toolArgs["edit-image"] = path.resolve(toolArgs["edit-image"]);
  }
  if (toolArgs.file && typeof toolArgs.file === "string") {
    toolArgs.file = path.resolve(toolArgs.file);
  }
}

if (tool === "chatgpt") {
  if (toolArgs["generate-image"] && typeof toolArgs["generate-image"] === "string") {
    toolArgs["generate-image"] = path.resolve(toolArgs["generate-image"]);
  }
  if (toolArgs.file && typeof toolArgs.file === "string") {
    toolArgs.file = path.resolve(toolArgs.file);
  }
  // --prompt-file: read file content as the prompt (for large exported prompts)
  if (toolArgs["prompt-file"] && typeof toolArgs["prompt-file"] === "string") {
    toolArgs.query = loadPromptFile(toolArgs["prompt-file"]);
    delete toolArgs["prompt-file"];
  }
}

if (tool === "chatgpt.chats" && typeof toolArgs.export === "string") {
  toolArgs.export = path.resolve(toolArgs.export);
}

if (tool === "screenshot" && outputPath) {
  if (typeof outputPath !== "string") {
    console.error("Error: --output requires a file path");
    process.exit(1);
  }
  toolArgs.savePath = outputPath;
  if (options.full) toolArgs.full = true;
  if (options["max-size"]) toolArgs["max-size"] = options["max-size"];
}

const methodFlag = toolArgs.method;
// Keep method for network filtering, only delete for other tools
if (tool !== 'network' && tool !== 'get_network_entries') {
  delete toolArgs.method;
}

const streamMode = toolArgs.stream === true;
delete toolArgs.stream;

const streamLevel = toolArgs.level;
delete toolArgs.level;

const streamFilter = toolArgs.filter;
delete toolArgs.filter;

let finalTool = tool;
if (methodFlag === "js") {
  if (tool === "type") {
    if (!toolArgs.selector) {
      console.error("Error: --selector or --into required for type with --method js");
      process.exit(1);
    }
    finalTool = "smart_type";
  } else if (tool === "click") {
    if (!toolArgs.selector) {
      console.error("Error: --selector required for click with --method js");
      process.exit(1);
    }
    toolArgs.code = `document.querySelector(${JSON.stringify(toolArgs.selector)})?.click()`;
    delete toolArgs.selector;
    finalTool = "js";
  }
} else if (methodFlag === "cdp") {
  if (tool === "smart_type") {
    finalTool = "type";
  }
}

if (streamMode && (tool === "console" || tool === "network")) {
  const streamType = tool === "console" ? "STREAM_CONSOLE" : "STREAM_NETWORK";
  const streamOpts = {
    level: streamLevel,
    filter: streamFilter,
  };

  const formatTime = (ts) => {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 });
  };

  let connectionTimeout = null;
  let receivedData = false;

  const sock = net.createConnection(SOCKET_PATH, () => {
    const req = {
      type: "stream_request",
      streamType,
      options: streamOpts,
      id: "cli-stream-" + Date.now(),
      ...globalOpts,
    };
    sock.write(JSON.stringify(req) + "\n");
    connectionTimeout = setTimeout(() => {
      if (!receivedData) {
        console.error("Error: Stream connection timeout (10s) - no data received");
        sock.destroy();
        process.exit(1);
      }
    }, 10000);
  });

  let buf = "";
  sock.on("data", (d) => {
    if (!receivedData) {
      receivedData = true;
      if (connectionTimeout) {
        clearTimeout(connectionTimeout);
        connectionTimeout = null;
      }
    }
    buf += d.toString();
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.error) {
          console.error("Error:", msg.error);
          sock.end();
          process.exit(1);
        }
        if (msg.type === "extension_disconnected") {
          console.error(msg.message);
          sock.end();
          process.exit(1);
        }
        if (msg.type === "stream_started") {
          continue;
        }
        if (msg.type === "console_event") {
          const { level, text, timestamp } = msg;
          if (streamLevel && level !== streamLevel) continue;
          console.log(`[console] [${level}] ${formatTime(timestamp)} ${text}`);
        } else if (msg.type === "network_event") {
          const { method, url, status, duration } = msg;
          if (streamFilter && !url.includes(streamFilter)) continue;
          const statusStr = status !== undefined ? status : "...";
          const durationStr = duration !== undefined ? ` (${duration}ms)` : "";
          console.log(`[network] ${method} ${url} ${statusStr}${durationStr}`);
        }
      } catch {}
    }
  });

  sock.on("error", (e) => {
    if (e.code === "ENOENT") {
      console.error("Error: Socket not found. Is Chrome running with the extension?");
    } else {
      console.error("Error:", e.message);
    }
    process.exit(1);
  });

  process.on("SIGINT", () => {
    sock.write(JSON.stringify({ type: "stream_stop" }) + "\n");
    sock.end();
    process.exit(0);
  });

  return;
}

const request = {
  type: "tool_request",
  method: "execute_tool",
  params: { tool: finalTool, args: toolArgs },
  id: "cli-" + Date.now(),
  ...globalOpts,
};

const sendRequest = (toolName, toolArgs = {}) => {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(SOCKET_PATH, () => {
      const req = {
        type: "tool_request",
        method: "execute_tool",
        params: { tool: toolName, args: toolArgs },
        id: "cli-" + Date.now() + "-" + Math.random(),
        ...globalOpts,
      };
      sock.write(JSON.stringify(req) + "\n");
    });
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const resp = JSON.parse(line);
          if (resp.type === "extension_disconnected") {
            sock.end();
            reject(new Error(resp.message));
            return;
          }
          sock.end();
          resolve(resp);
        } catch {
          sock.end();
          reject(new Error("Invalid JSON"));
        }
      }
    });
    sock.on("error", (e) => reject(e));
    let timeoutId;
    timeoutId = setTimeout(() => { sock.destroy(); reject(new Error("Timeout")); }, 5000);
    sock.on("close", () => clearTimeout(timeoutId));
  });
};

const performAutoCapture = async () => {
  const timestamp = Date.now();
  const screenshotPath = path.join(SURF_TMP, `surf-error-${timestamp}.png`);

  try {
    const [screenshotResp, consoleResp] = await Promise.all([
      sendRequest("screenshot", { savePath: screenshotPath }),
      sendRequest("console", {}),
    ]);

    if (screenshotResp.result) {
      console.error(`Auto-captured: ${screenshotPath}`);
    } else {
      console.error("Auto-captured: (screenshot failed)");
    }

    let consoleErrors = "(none)";
    const consoleText = consoleResp.result?.content?.[0]?.text;
    if (consoleText) {
      try {
        const parsed = JSON.parse(consoleText);
        const msgs = parsed.messages || parsed || [];
        const errors = msgs.filter(m => m.level === "error" || m.type === "error");
        if (errors.length > 0) {
          consoleErrors = errors.map(e => e.text || e.message || JSON.stringify(e)).join("\n  ");
        }
      } catch {
        consoleErrors = consoleText;
      }
    }
    console.error(`Console errors: ${consoleErrors}`);
  } catch (captureErr) {
    console.error(`Auto-capture failed: ${captureErr.message}`);
  }
};

const CHATGPT_CLOAK_ONLY_TOOLS = new Set(["chatgpt.chats", "chatgpt.reply"]);
const SLACK_CLOAK_TOOLS = new Set(["slack.read"]);

const printChatGptChatsResult = (result, opts = {}) => {
  if (result.action === "rename") {
    if (wantJson) console.log(JSON.stringify(result ?? null, null, 2));
    else console.log(`Renamed conversation ${result.conversationId} to: ${result.title}`);
    return;
  }
  if (result.action === "delete") {
    if (wantJson) console.log(JSON.stringify(result ?? null, null, 2));
    else console.log(`Deleted conversation: ${result.conversationId}`);
    return;
  }
  if (result.action === "bulk_delete") {
    if (wantJson) console.log(JSON.stringify(result ?? null, null, 2));
    else {
      const results = result.results || [];
      const ok = results.filter(r => r.deleteMethod !== "error").length;
      const failed = results.filter(r => r.deleteMethod === "error").length;
      console.log(`Deleted ${ok} conversation${ok !== 1 ? 's' : ''}${failed ? ` (${failed} failed)` : ''}`);
    }
    return;
  }
  if (result.action === "download") {
    if (wantJson) console.log(JSON.stringify(result ?? null, null, 2));
    else if (result.file?.savedPath) console.log(`Downloaded file to: ${result.file.savedPath}`);
    else if (!opts.outputPath) console.log(result.result?.download_url || `Download ready for file: ${result.fileId}`);
    return;
  }

  if (result.action === "get") {
    const markdown = chatgptChatsFormatter.formatConversationMarkdown({
      conversation: result.conversation,
      messageLimit: opts.messageLimit,
    });
    if (opts.exportPath) {
      const format = chatgptChatsFormatter.inferExportFormat({
        exportPath: opts.exportPath,
        explicitFormat: opts.format,
      });
      fs.mkdirSync(path.dirname(opts.exportPath), { recursive: true });
      fs.writeFileSync(
        opts.exportPath,
        format === "json" ? JSON.stringify(result.conversation, null, 2) + "\n" : markdown,
      );
      if (wantJson) {
        process.stderr.write(`Exported conversation to: ${opts.exportPath}\n`);
      } else {
        console.log(`Exported conversation to: ${opts.exportPath}`);
      }
      if (result.stabilized === false) {
        process.stderr.write("Warning: export completed before assistant turn stabilized; output may still be incomplete.\n");
      }
    }
    if (wantJson) {
      console.log(JSON.stringify(result.conversation ?? null, null, 2));
      return;
    }
    if (!opts.exportPath) process.stdout.write(markdown);
    return;
  }

  if (wantJson) {
    console.log(JSON.stringify(result ?? null, null, 2));
    return;
  }

  const label = result.action === "search"
    ? `ChatGPT Search — ${result.query}`
    : "ChatGPT Conversations";
  console.log(chatgptChatsFormatter.formatConversationList({
    items: result.items,
    total: result.total,
    label,
  }));
  if (result.action === "search" && result.partial) {
    console.error(`Note: search fallback scanned recent ${result.fallbackScanned || 0} of ${result.fallbackTotal || "?"} conversations.`);
  }
};

const runChatGptCloakQueryDirect = async (sessionTool, queryArgs) => {
  if (!isCloakBrowserAvailable()) {
    console.error("Error: CloakBrowser not installed. Run: npm install -g cloakbrowser");
    process.exit(1);
  }

  const sess = sessionStore.createSession(sessionTool, queryArgs, process.env);
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (data, ...rest) => {
    sess.step(String(typeof data === "string" ? data : data.toString()).trimEnd());
    return originalWrite(data, ...rest);
  };

  const startMs = Date.now();
  let lastProgress = "";
  let sawSentCheckpoint = false;
  try {
    const result = await queryWithCloakBrowser(queryArgs, (progress) => {
      if (progress.type === "meta_update") {
        const patch = {};
        if (progress.conversationId)             patch.conversationId             = progress.conversationId;
        if (progress.baselineAssistantMessageId) patch.baselineAssistantMessageId = progress.baselineAssistantMessageId;
        if (progress.lastCheckpoint)             patch.lastCheckpoint             = progress.lastCheckpoint;
        if (progress.sentAt)                     patch.sentAt                     = progress.sentAt;
        if (Object.keys(patch).length > 0)       sess.update(patch);
        if (!sawSentCheckpoint && progress.lastCheckpoint === "sent") {
          sawSentCheckpoint = true;
          sess.step(`[session] checkpoint: sent (${progress.source || "?"}) conv:${progress.conversationId || "?"} baseline:${progress.baselineAssistantMessageId || "?"}`);
        }
        return;
      }
      if (progress.type === "trace") {
        // Rich thinking text — print deltas as they arrive
        if (progress.traceType === "thinking_text") {
          const chunk = String(progress.thoughtDelta || progress.thoughtText || "").trim();
          if (chunk) {
            const lines = chunk.split("\n");
            process.stderr.write(`[cloak-${sessionTool}] 🧠 ${lines[0]}\n`);
            for (const line of lines.slice(1)) {
              process.stderr.write(`[cloak-${sessionTool}]    ${line}\n`);
            }
          }
          return;
        }
        const msg = `[cloak-${sessionTool}] ⏳ ${progress.phase}`;
        if (msg !== lastProgress) {
          process.stderr.write(msg + "\n");
          lastProgress = msg;
        }
        return;
      }
      const msg = `[cloak-${sessionTool}] [${progress.step}/${progress.total}] ${progress.message}`;
      if (msg !== lastProgress) {
        process.stderr.write(msg + "\n");
        lastProgress = msg;
      }
    });

    const durationMs = result.tookMs || (Date.now() - startMs);
    if (sessionTool === "chatgpt.reply") chatgptChatsCache.invalidateCachedChats();
    // Also invalidate after a new chatgpt query — a new conversation was created
    if (sessionTool === "chatgpt" && result.conversationId) chatgptChatsCache.invalidateCachedChats();
    sess.finish({
      model: result.model || sessionTool,
      tookMs: durationMs,
      imagePath: result.imagePath,
      response: result.response,
      responsePreview: result.response ? result.response.slice(0, 160) : `${sessionTool} completed`,
    });

    if (result.imagePath) process.stderr.write(`Image saved: ${result.imagePath}\n`);
    if (result.thinkingTrace) {
      const tc = result.thinkingTrace;
      const tCount = tc.thoughts ? tc.thoughts.length : 0;
      const dur = tc.durationSec ? `${tc.durationSec}s` : (tc.recapText || 'unknown');
      process.stderr.write(`[cloak-${sessionTool}] 🧠 Thinking trace: ${tCount} step(s), ${dur}\n`);
    }
    if (wantJson) {
      console.log(JSON.stringify({
        response: result.response,
        model: result.model,
        tookMs: durationMs,
        imagePath: result.imagePath || undefined,
        partial: result.partial || undefined,
        backend: "cloak",
        conversationId: result.conversationId || undefined,
        thinkingTrace: result.thinkingTrace || undefined,
      }, null, 2));
    } else {
      console.log(result.response);
      const suffix = result.partial ? " | partial" : "";
      console.error(`\n[${result.model || "unknown"} | ${(durationMs / 1000).toFixed(1)}s | cloak${suffix}]`);
    }
    process.exit(0);
  } catch (err) {
    sess.fail(err);
    const errMsg = `CloakBrowser failed: ${err.message}`;
    if (softFail) {
      console.warn(`Warning: ${errMsg}`);
      process.exit(0);
    }
    console.error(`Error: ${errMsg}`);
    if (autoCapture) await performAutoCapture();
    process.exit(1);
  } finally {
    process.stderr.write = originalWrite;
  }
};

const runChatGptChatsDirect = async (chatArgs, renderOpts = {}) => {
  if (!isCloakBrowserAvailable()) {
    console.error("Error: CloakBrowser not installed. Run: npm install -g cloakbrowser");
    process.exit(1);
  }

  const sess = sessionStore.createSession("chatgpt.chats", chatArgs, process.env);
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (data, ...rest) => {
    sess.step(String(typeof data === "string" ? data : data.toString()).trimEnd());
    return originalWrite(data, ...rest);
  };

  const startMs = Date.now();
  let lastProgress = "";
  try {
    const cacheable = ["list", "search", "get"].includes(chatArgs.action)
      && chatArgs.useCache !== false
      && !(chatArgs.action === "get" && chatArgs.waitForAssistant === true);
    if (cacheable) {
      const cached = chatgptChatsCache.getCachedChats(chatArgs);
      if (cached) {
        sess.step("[cache] hit chatgpt chats cache");
        sess.finish({ model: `chatgpt.chats:${cached.action}:cache`, tookMs: Date.now() - startMs, responsePreview: `${cached.action} cache` });
        printChatGptChatsResult(cached, renderOpts);
        process.exit(0);
      }
    }

    const result = await manageChatsWithCloakBrowser(chatArgs, (progress) => {
      const msg = `[cloak-chatgpt.chats] [${progress.step}/${progress.total}] ${progress.message}`;
      if (msg !== lastProgress) {
        process.stderr.write(msg + "\n");
        lastProgress = msg;
      }
    });

    if (cacheable) chatgptChatsCache.setCachedChats(chatArgs, result);
    if (["rename", "delete", "bulk_delete"].includes(chatArgs.action)) chatgptChatsCache.invalidateCachedChats();

    const durationMs = Date.now() - startMs;
    const preview = result.action === "get"
      ? `view ${result.conversationId || ""}`
      : `${result.action} ${(result.items || []).length}/${result.total || 0}`;
    sess.finish({ model: `chatgpt.chats:${result.action}`, tookMs: durationMs, responsePreview: preview.trim() });
    printChatGptChatsResult(result, renderOpts);
    process.exit(0);
  } catch (err) {
    sess.fail(err);
    const errMsg = `CloakBrowser failed: ${err.message}`;
    if (softFail) {
      console.warn(`Warning: ${errMsg}`);
      process.exit(0);
    }
    console.error(`Error: ${errMsg}`);
    if (autoCapture) await performAutoCapture();
    process.exit(1);
  } finally {
    process.stderr.write = originalWrite;
  }
};

// ---------------------------------------------------------------------------
// ChatGPT routing
// ---------------------------------------------------------------------------

// Extract --profile before routing (Bun-only, macOS-only) — shared by both Gemini and ChatGPT
const requestedProfile = (() => {
  const raw = toolArgs.profile;
  delete toolArgs.profile;   // never leak to legacy socket request
  if (raw && typeof raw === "string") return raw.trim().toLowerCase();
  return undefined;
})();

if ((tool === "chatgpt" || CHATGPT_CLOAK_ONLY_TOOLS.has(tool) || SLACK_CLOAK_TOOLS.has(tool)) && requestedProfile) {
  if (process.platform !== "darwin") {
    console.error("Error: --profile is only supported on macOS");
    process.exit(1);
  }
  if (tool === "chatgpt" && (toolArgs["with-page"] || toolArgs.withPage)) {
    console.error("Error: --profile cannot be used with --with-page");
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// CloakBrowser ChatGPT path (default)
// ---------------------------------------------------------------------------

if (tool === "chatgpt") {
  (async () => {
    if (requestedProfile) toolArgs.profile = requestedProfile;
    if (toolArgs["generate-image"]) toolArgs.generateImage = toolArgs["generate-image"];
    await runChatGptCloakQueryDirect("chatgpt", toolArgs);
  })();
  return; // Prevent falling through to Bun or legacy
}

if (tool === "slack.read") {
  const parsePositiveIntegerOption = (raw) => {
    const value = String(raw).trim();
    if (!/^\d+$/.test(value)) return NaN;
    return Number.parseInt(value, 10);
  };

  const channelId = typeof toolArgs.channelId === "string" ? toolArgs.channelId.trim() : "";
  const threadTs = toolArgs.thread === undefined ? "" : String(toolArgs.thread).trim();
  const wantChannels = toolArgs.channels === true;
  const includeDms = toolArgs["include-dms"] === true;
  const workspace = toolArgs.workspace === undefined ? undefined : String(toolArgs.workspace).trim();
  const limit = toolArgs.limit === undefined ? undefined : parsePositiveIntegerOption(toolArgs.limit);
  const days = toolArgs.days === undefined ? undefined : parsePositiveIntegerOption(toolArgs.days);
  const explicitFormat = toolArgs.format;
  const timeout = toolArgs.timeout === undefined ? undefined : parsePositiveIntegerOption(toolArgs.timeout);

  if (toolArgs.limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
    console.error("Error: --limit must be a positive integer");
    process.exit(1);
  }
  if (toolArgs.days !== undefined && (!Number.isFinite(days) || days <= 0)) {
    console.error("Error: --days must be a positive integer");
    process.exit(1);
  }
  if (toolArgs.timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {
    console.error("Error: --timeout must be a positive integer");
    process.exit(1);
  }
  if (toolArgs.workspace !== undefined && !workspace) {
    console.error("Error: --workspace requires a non-empty workspace/team ID");
    process.exit(1);
  }
  if (threadTs && !channelId) {
    console.error("Error: --thread requires a channel ID");
    process.exit(1);
  }
  if (!wantChannels && !channelId) {
    console.error("Error: channel ID required. Use: surf slack.read <channel-id>");
    console.error("       Or list channels: surf slack.read --channels");
    process.exit(1);
  }

  const action = wantChannels ? "channels" : threadTs ? "replies" : "history";
  const format = wantJson
    ? "json"
    : ((explicitFormat && ["json", "markdown", "md"].includes(String(explicitFormat).toLowerCase()))
      ? (explicitFormat === "md" ? "markdown" : explicitFormat)
      : "markdown");

  (async () => {
    try {
      if (!isSlackCloakAvailable()) {
        console.error("Error: CloakBrowser not installed. Run: npm install cloakbrowser playwright-core");
        process.exit(1);
      }

      const progressCb = (msg) => {
        if (msg.type === "progress" && msg.message) {
          process.stderr.write(`  ${msg.message}\n`);
        }
      };

      const result = await querySlackMessages({
        action,
        channel: channelId || undefined,
        threadTs: threadTs || undefined,
        limit: limit || undefined,
        days: days || undefined,
        profile: requestedProfile,
        workspace,
        includeDms,
        timeout,
      }, progressCb);

      if (format === "json") {
        console.log(slackFormatter.formatSlackResult(result, action, "json"));
      } else {
        console.log(slackFormatter.formatSlackResult(result, action, "markdown"));
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
      if (err.code) console.error(`Code: ${err.code}`);
      process.exit(1);
    }
  })();
  return;
}

if (tool === "chatgpt.chats") {
  const exportPath = toolArgs.export;
  const explicitFormat = toolArgs.format;
  const searchQuery = typeof toolArgs.search === "string" ? toolArgs.search.trim() : "";
  const conversationId = typeof toolArgs.conversationId === "string" ? toolArgs.conversationId.trim() : "";
  const renameTitle = typeof toolArgs.rename === "string" ? toolArgs.rename.trim() : "";
  const fileId = typeof toolArgs["download-file"] === "string" ? toolArgs["download-file"].trim() : "";
  const limit = toolArgs.limit === undefined ? undefined : parseInt(String(toolArgs.limit), 10);
  const wantsDelete = toolArgs.delete === true;
  const bulkDeleteIds = typeof toolArgs["delete-ids"] === "string"
    ? toolArgs["delete-ids"].split(",").map(s => s.trim()).filter(Boolean)
    : [];
  const useCache = toolArgs["no-cache"] !== true;

  if (toolArgs.limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
    console.error("Error: --limit must be a positive integer");
    process.exit(1);
  }
  if (conversationId && searchQuery) {
    console.error("Error: cannot use conversation ID with --search");
    process.exit(1);
  }
  if (toolArgs.all && conversationId) {
    console.error("Error: --all is only valid when listing conversations");
    process.exit(1);
  }
  if (toolArgs.all && toolArgs.limit !== undefined) {
    console.error("Error: --all cannot be combined with --limit");
    process.exit(1);
  }
  if (exportPath && !conversationId) {
    console.error("Error: --export requires a conversation ID");
    process.exit(1);
  }
  if (explicitFormat && !["markdown", "md", "json"].includes(String(explicitFormat).toLowerCase())) {
    console.error("Error: --format must be markdown, md, or json");
    process.exit(1);
  }

  const advancedCount = [renameTitle ? 1 : 0, wantsDelete ? 1 : 0, bulkDeleteIds.length > 0 ? 1 : 0, fileId ? 1 : 0].reduce((sum, n) => sum + n, 0);
  if (advancedCount > 1) {
    console.error("Error: use only one of --rename, --delete, --delete-ids, or --download-file");
    process.exit(1);
  }
  if ((renameTitle || wantsDelete || fileId) && !conversationId) {
    console.error("Error: conversation ID required for this action");
    process.exit(1);
  }
  if (bulkDeleteIds.length > 0 && conversationId) {
    console.error("Error: --delete-ids cannot be used with a conversation ID positional arg");
    process.exit(1);
  }
  if (fileId && !outputPath) {
    console.error("Error: --download-file requires --output <path>");
    process.exit(1);
  }
  if (outputPath && !fileId) {
    console.error("Error: --output is only supported with --download-file");
    process.exit(1);
  }
  if ((renameTitle || wantsDelete || fileId) && exportPath) {
    console.error("Error: --export is only supported when viewing a conversation");
    process.exit(1);
  }

  const action = renameTitle
    ? "rename"
    : wantsDelete
      ? "delete"
      : bulkDeleteIds.length > 0
        ? "bulk_delete"
        : fileId
          ? "download"
          : conversationId
            ? "get"
            : searchQuery
              ? "search"
              : "list";
  (async () => {
    const waitForAssistant = action === "get" && !!exportPath;
    const chatArgs = {
      action,
      conversationId: conversationId || undefined,
      conversationIds: bulkDeleteIds.length > 0 ? bulkDeleteIds : undefined,
      query: searchQuery || undefined,
      limit,
      all: toolArgs.all === true,
      profile: requestedProfile,
      timeout: toolArgs.timeout,
      title: renameTitle || undefined,
      fileId: fileId || undefined,
      includeBytes: !!fileId,
      outputPath: outputPath || undefined,
      useCache,
      waitForAssistant,
      waitForAssistantTimeoutSec: waitForAssistant ? 30 : undefined,
    };
    await runChatGptChatsDirect(chatArgs, {
      messageLimit: action === "get" ? limit : undefined,
      exportPath,
      format: explicitFormat,
      outputPath,
    });
  })();
  return;
}

if (tool === "chatgpt.reply") {
  const conversationId = typeof toolArgs.conversationId === "string" ? toolArgs.conversationId.trim() : "";
  // --prompt-file overrides positional prompt for chatgpt.reply too
  if (toolArgs["prompt-file"] && typeof toolArgs["prompt-file"] === "string") {
    toolArgs.prompt = loadPromptFile(toolArgs["prompt-file"]);
    toolArgs.query = toolArgs.prompt;
    delete toolArgs["prompt-file"];
  }
  const prompt = typeof toolArgs.prompt === "string" ? toolArgs.prompt.trim() : "";
  if (!conversationId || !prompt) {
    console.error("Error: Usage: surf chatgpt.reply <conversation-id> \"prompt\"");
    process.exit(1);
  }

  (async () => {
    const replyArgs = {
      ...toolArgs,
      profile: requestedProfile,
      prompt,
      query: prompt,
      conversationId,
    };
    await runChatGptCloakQueryDirect("chatgpt.reply", replyArgs);
  })();
  return;
}

// ---------------------------------------------------------------------------
// Bun-native Gemini path (default)
// ---------------------------------------------------------------------------

if (tool === "gemini" && requestedProfile) {
  // --profile was explicitly requested — fail fast if conditions aren't met
  if (process.platform !== "darwin") {
    console.error("Error: --profile is only supported on macOS");
    process.exit(1);
  }
  if (toolArgs["with-page"] || toolArgs.withPage) {
    console.error("Error: --profile cannot be used with --with-page");
    process.exit(1);
  }
}

if (tool === "gemini") {
  const eligibility = isBunGeminiEligible(toolArgs);
  if (eligibility.eligible) {
    // Pass profile into the toolArgs for the bridge
    if (requestedProfile) toolArgs.profile = requestedProfile;
    (async () => {
      const sess = sessionStore.createSession("gemini", toolArgs, process.env);
      const _origWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = (data, ...rest) => { sess.step(String(typeof data==="string"?data:data.toString()).trimEnd()); return _origWrite(data, ...rest); };
      try {
        const bunResult = await runGeminiViaBun(toolArgs);
        process.stderr.write = _origWrite;
        if (bunResult.ok) {
            const data = bunResult.result;
            sess.finish({ model: data.model, tookMs: data.tookMs, imagePath: data.imagePath,
              response: data.response,
              responsePreview: data.response ? data.response.slice(0, 160) : "" });
          if (wantJson) {
            console.log(JSON.stringify(data, null, 2));
          } else {
            console.log(data.response);
            if (data.imagePath) {
              console.log(`\nImage saved: ${data.imagePath}`);
            }
            console.error(`\n[${data.model || 'unknown'} | ${((data.tookMs || 0) / 1000).toFixed(1)}s | bun]`);
          }
          process.exit(0);
        } else if (bunResult.fallbackRecommended) {
          const errMsg = bunResult.error || "Bun Gemini fallback requested";
          sess.fail(new Error(errMsg));
          process.stderr.write = _origWrite;
          console.error(`Error: Gemini requires Bun in headless-only mode. ${errMsg}`);
          process.exit(1);
        } else {
          // Runtime error — honor --soft-fail / --auto-capture like legacy path
          const errMsg = bunResult.error || "Bun Gemini worker error";
          sess.fail(new Error(errMsg));
          process.stderr.write = _origWrite;
          if (softFail) {
            console.warn(`Warning: ${errMsg}`);
            process.exit(0);
          }
          console.error(`Error: ${errMsg}`);
          if (autoCapture) {
            await performAutoCapture();
          }
          process.exit(1);
        }
      } catch (err) {
        sess.fail(err);
        process.stderr.write = _origWrite;
        const errMsg = `Bun Gemini bridge failed: ${err.message}`;
        if (softFail) {
          console.warn(`Warning: ${errMsg}`);
          process.exit(0);
        }
        console.error(`Error: ${errMsg}`);
        if (autoCapture) {
          await performAutoCapture();
        }
        process.exit(1);
      }
    })();
  } else {
    if (requestedProfile && (toolArgs["with-page"] || toolArgs.withPage)) {
      console.error("Error: --profile cannot be used with --with-page");
      process.exit(1);
    }
    const reason = eligibility.reason || "not_eligible";
    console.error(`Error: Gemini requires Bun in headless-only mode. Not eligible for Bun (${reason}).`);
    process.exit(1);
  }
} else if (tool !== "chatgpt") {
  // Headless-only mode: no legacy socket commands
  const HEADLESS_TOOLS = new Set(["chatgpt", "chatgpt.chats", "chatgpt.reply", "gemini", "slack.read", "smoke", "do", "session"]);
  if (!HEADLESS_TOOLS.has(tool)) {
    console.error(`Error: Unknown or unsupported command: ${tool}`);
    console.error("Available commands: chatgpt, chatgpt.chats, chatgpt.reply, gemini, slack.read");
    console.error("Run 'surf --help' for usage.");
    process.exit(1);
  }
  // Fallback for any remaining supported tools that still need socket
  startLegacySocketPath();
}

function startLegacySocketPath() {

const socket = net.createConnection(SOCKET_PATH, () => {
  socket.write(JSON.stringify(request) + "\n");
});

const AI_TOOLS = ["smoke", "chatgpt", "gemini", "ai"];
let requestTimeout = AI_TOOLS.includes(tool) ? 300000 : 30000;
const timeout = setTimeout(() => {
  console.error(`Error: Request timed out (${requestTimeout / 1000}s)`);
  socket.destroy();
  process.exit(1);
}, requestTimeout);

let buffer = "";

socket.on("data", (data) => {
  buffer += data.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop();

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      
      if (msg.type === "extension_disconnected") {
        clearTimeout(timeout);
        console.error(msg.message);
        socket.end();
        process.exit(1);
      }
      
      handleResponse(msg).catch((err) => {
        console.error("Handler error:", err.message);
        process.exit(1);
      });
    } catch (e) {
      console.error("Invalid JSON response:", line);
      process.exit(1);
    }
  }
});

socket.on("error", (err) => {
  clearTimeout(timeout);
  if (err.code === "ENOENT") {
    console.error("Error: Socket not found. Is Chrome running with the extension?");
  } else if (err.code === "ECONNREFUSED") {
    console.error("Error: Connection refused. Native host not running.");
  } else {
    console.error("Error:", err.message);
  }
  process.exit(1);
});

socket.on("close", () => {
  clearTimeout(timeout);
});

async function handleResponse(response) {
  clearTimeout(timeout);

  if (response.error) {
    const errContent = response.error.content?.[0]?.text || JSON.stringify(response.error);
    if (softFail) {
      console.warn("Warning:", errContent);
      socket.end();
      process.exit(0);
    }
    console.error("Error:", errContent);

    if (autoCapture) {
      await performAutoCapture();
    }

    socket.end();
    process.exit(1);
  }

  const result = response.result?.content?.[0]?.text;
  
  let data;
  try {
    data = result ? JSON.parse(result) : response.result;
  } catch {
    data = result || response.result;
  }

  if (wantJson) {
    console.log(JSON.stringify(data ?? null, null, 2));
    socket.end();
    process.exit(0);
  }

  if (tool === "screenshot" && data?.base64 && (outputPath || toolArgs.savePath)) {
    const saveTo = outputPath || toolArgs.savePath;
    fs.writeFileSync(saveTo, Buffer.from(data.base64, "base64"));
    
    const skipResize = options.full || toolArgs.full;
    const maxSize = parseInt(options["max-size"] || toolArgs["max-size"] || "1200", 10);
    const origWidth = data.width || 0;
    const origHeight = data.height || 0;
    
    if (!skipResize && (origWidth > maxSize || origHeight > maxSize)) {
      const result = resizeImage(saveTo, maxSize);
      if (result.success) {
        console.log(`Saved to ${saveTo} (${result.width}x${result.height}, resized from ${origWidth}x${origHeight})`);
      } else {
        console.log(`Saved to ${saveTo} (${origWidth}x${origHeight}, resize failed: ${result.error})`);
      }
    } else {
      console.log(`Saved to ${saveTo} (${origWidth}x${origHeight})`);
    }
  } else if (tool === "screenshot" && data?.message) {
    console.log(data.message);
    if (data.screenshotId) {
      console.log(`[Screenshot ID: ${data.screenshotId}]`);
    }
  } else if (tool === "tab.list") {
    const tabs = data?.tabs || data || [];
    if (Array.isArray(tabs)) {
      if (tabs.length === 0) {
        if (globalOpts.windowId) {
          console.log(`No tabs in window ${globalOpts.windowId}. Window may not exist - use 'surf window.list' to verify.`);
        } else {
          console.log("No tabs found.");
        }
      } else {
        for (const t of tabs) {
          console.log(`${t.id}\t${t.title}\t${t.url}`);
        }
      }
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  } else if (tool === "tab.named") {
    const named = data?.tabs || data?.namedTabs || data || [];
    if (Array.isArray(named)) {
      if (named.length === 0) {
        console.log("No named tabs");
      } else {
        for (const t of named) {
          console.log(`${t.name}\t${t.tabId}\t${t.title || ""}\t${t.url || ""}`);
        }
      }
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  } else if (tool === "ai" && data?.aiResult) {
    if (data.mode === "find") {
      console.log(data.ref || "NOT_FOUND");
    } else {
      console.log(data.content);
    }
  } else if (tool === "page.read" && data?.pageContent) {
    console.log(data.pageContent);
  } else if (tool === "page.text" && data?.text) {
    console.log(data.text);
  } else if (tool === "emulate.device" && data?.devices) {
    console.log("Available devices:\n");
    const devices = data.devices;
    for (const d of devices) {
      console.log(`  ${d}`);
    }
    console.log("\nUsage: surf emulate.device \"<device name>\"");
    console.log('Reset:  surf emulate.device "reset"');
  } else if (tool === "js") {
    if (data?.result !== undefined) {
      const val = data.result.value ?? data.result;
      console.log(typeof val === "string" ? val : JSON.stringify(val, null, 2));
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  } else if (tool === "health") {
    if (data?.success) {
      const timeStr = data.time ? ` (${data.time}ms)` : "";
      if (data.status) {
        console.log(`OK: ${data.status}${timeStr}`);
      } else if (data.found) {
        console.log(`OK: element found${timeStr}`);
      } else {
        console.log(`OK${timeStr}`);
      }
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  } else if (tool === "smoke" && data?.results) {
    const results = data.results;
    const summary = data.summary || { pass: 0, fail: 0, total: results.length };
    
    for (const r of results) {
      const status = r.status === "pass" ? "PASS" : "FAIL";
      const timeStr = r.time ? ` (${r.time}ms)` : "";
      const ssStr = r.screenshot ? ` [${r.screenshot}]` : "";
      console.log(`[${status}] ${r.url}${timeStr}${ssStr}`);
      if (r.errors && r.errors.length > 0) {
        for (const err of r.errors) {
          console.log(`  - ${err}`);
        }
      }
    }
    
    console.log("");
    console.log(`Summary: ${summary.pass} passed, ${summary.fail} failed, ${summary.total} total`);
    
    if (summary.fail > 0) {
      socket.end();
      process.exit(1);
    }
  } else if (tool === "zoom" && data?.zoom !== undefined) {
    console.log(`Zoom: ${Math.round(data.zoom * 100)}%`);
  } else if (tool === "back" || tool === "forward") {
    console.log("OK");
  } else if (tool === "network" && (data?.entries || data?.requests)) {
    // Network list - handle both new (entries) and old (requests) formats
    const items = data.entries || data.requests || [];
    
    if (items.length === 0) {
      console.log("No network requests captured");
    } else if (data._format === 'raw') {
      // Raw JSON output - print entries array directly
      console.log(JSON.stringify(items, null, 2));
    } else {
      // Simple compact format for now
      for (const req of items) {
        const status = req.status || '-';
        const method = (req.method || 'GET').padEnd(6);
        const type = (req.type || '').padEnd(10);
        const url = req.url || '';
        console.log(`${status} ${method} ${type} ${url}`);
      }
    }
  } else if (tool === "network.get" && data?.entry) {
    console.log(networkFormatters.formatEntry(data.entry));
  } else if (tool === "network.body" && data?.body !== undefined) {
    // Raw body for piping
    process.stdout.write(data.body);
  } else if (tool === "network.curl" && data?.curl) {
    console.log(data.curl);
  } else if (tool === "network.curl" && data?.entry) {
    console.log(networkFormatters.formatCurl(data.entry));
  } else if (tool === "network.origins" && data?.origins) {
    console.log(networkFormatters.formatOrigins(data.origins));
  } else if (tool === "network.stats" && data?.stats) {
    console.log(networkFormatters.formatStats(data.stats));
  } else if (tool === "network.clear" && data?.cleared !== undefined) {
    console.log(`Cleared ${data.cleared} requests`);
  } else if (tool === "network.export" && data?.path) {
    console.log(`Exported to: ${data.path}`);
  } else if (tool === "network.path" && data?.paths) {
    for (const [key, val] of Object.entries(data.paths)) {
      console.log(`${key}: ${val}`);
    }
  } else if ((tool === "chatgpt" || tool === "gemini") && data?.response) {
    console.log(data.response);
    if (data.imagePath) {
      console.log(`\nImage saved: ${data.imagePath}`);
    }
    console.error(`\n[${data.model || 'unknown'} | ${((data.tookMs || 0) / 1000).toFixed(1)}s]`);
  } else if (tool === "window.list" && data?.windows) {
    if (data.windows.length === 0) {
      console.log("No windows. Use 'surf window.new' to create one.");
    } else {
      for (const w of data.windows) {
        const focused = w.focused ? " [focused]" : "";
        const state = w.state !== "normal" ? ` (${w.state})` : "";
        console.log(`${w.id}\t${w.tabCount} tabs\t${w.width}x${w.height}${focused}${state}`);
        if (w.tabs) {
          for (const t of w.tabs) {
            const active = t.active ? "*" : " ";
            console.log(`  ${active} ${t.id}\t${t.title || "(no title)"}\t${t.url || ""}`);
          }
        }
      }
      // Hint for agents
      if (data.windows.length > 0 && !globalOpts.windowId) {
        console.log("\n[hint] Use --window-id <id> to isolate commands to a specific window");
      }
    }
  } else if (typeof data === "string") {
    console.log(data);
  } else if (data?.success === true) {
    console.log("OK");
  } else if (data?.error) {
    if (softFail) {
      console.warn("Warning:", data.error);
      socket.end();
      process.exit(0);
    }
    console.error("Error:", data.error);
    if (autoCapture) {
      await performAutoCapture();
    }
    socket.end();
    process.exit(1);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }

  socket.end();
  process.exit(0);
}

} // end startLegacySocketPath

```

File: /Users/danielsivan/dev/surf-cli/docs/investigations/surf-chats-profile-lock.md
```md
# Investigation: pi-surf-chats CloakBrowser profile lock

## Summary
`/surf-chats` was still failing because the extension never passed `--profile dsebban883@gmail.com`, so `chatgpt.chats` always used the shared `~/.surf/cloak-profile` directory. That shared path was the one colliding; the same command succeeded immediately once `--profile dsebban883@gmail.com` was supplied.

## Symptoms
- Opening `/surf-chats` failed with `CloakBrowser profile locked. Close other surf instances first.`
- Prior fix changed CLI resolution, but runtime still hit the profile-lock path.

## Investigation Log

### Phase 1 - Initial assessment
**Hypothesis:** Extension reached the correct CLI now, but surf-cli/CloakBrowser was still using a shared locked profile path.
**Findings:** Confirmed.
**Evidence:**
- `.pi/extensions/pi-surf-chats/surf-client.ts:121-152` invoked `chatgpt.chats` commands without any `--profile` flag.
- `native/cli.cjs:3458-3465` forwards `requestedProfile` into `chatArgs.profile` for `chatgpt.chats`.
- `native/chatgpt-cloak-chats-worker.mjs:502-510` chooses `tempProfileDir()` when `profile` is set, otherwise `sharedProfileDir()`.
- Repro without profile: `node native/cli.cjs chatgpt.chats --json --limit 1` failed with `Failed to create a ProcessSingleton for your profile directory` against `/Users/danielsivan/.surf/cloak-profile`.
- Repro with profile: `node native/cli.cjs chatgpt.chats --json --limit 1 --profile dsebban883@gmail.com` succeeded and returned conversation JSON.
**Conclusion:** Root cause confirmed: extension omitted `--profile`, so isolated temp-profile mode never activated.

### Phase 2 - Fix
**Hypothesis:** Defaulting the extension to `--profile dsebban883@gmail.com` on macOS will route chats operations onto the isolated temp-profile path and avoid shared-profile collisions.
**Findings:** Implemented in extension client.
**Evidence:**
- `.pi/extensions/pi-surf-chats/surf-client.ts` now defines a default profile and appends `--profile dsebban883@gmail.com` to all surf invocations on macOS.
- `.pi/extensions/pi-surf-chats/index.ts`, `types.ts`, and `overlay.ts` now expose the resolved profile in overlay debug info.
**Conclusion:** Fix applied; requires `/reload` in pi to pick up updated extension code.

## Root Cause
The extension runtime did not inherit behavior from `~/.agents/skills/surf/SKILL.md`; that skill only affects agent command choice, not the extension's direct `pi.exec()` calls. In the extension, `.pi/extensions/pi-surf-chats/surf-client.ts:143-152` called `chatgpt.chats` without `--profile`. In surf-cli, `native/cli.cjs:3464` forwards `profile: requestedProfile`, and `native/chatgpt-cloak-chats-worker.mjs:502-510` switches to an isolated temporary user-data dir only when `profile` is truthy. Without `--profile`, the worker fell back to the shared persistent directory `~/.surf/cloak-profile`, which was already locked.

## Recommendations
1. Reload pi with `/reload`, then reopen `/surf-chats`.
2. Verify overlay footer now shows `Profile: dsebban883@gmail.com`.
3. If a lock ever reappears outside the extension, prefer explicit `--profile dsebban883@gmail.com` for direct `surf chatgpt.chats` commands too.

## Preventive Measures
- Keep profile choice explicit in extension-owned CLI wrappers; do not assume agent skills affect extension runtime.
- Surface resolved CLI path + profile in the overlay for fast diagnosis.

```

File: /Users/danielsivan/dev/surf-cli/test/unit/chatgpt-cloak-bridge.test.ts
```ts
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

function createWorker() {
  const worker = new EventEmitter() as any;
  worker.stdout = new EventEmitter();
  worker.stderr = new EventEmitter();
  worker.stdout.setEncoding = vi.fn();
  worker.stderr.setEncoding = vi.fn();
  worker.stdin = { write: vi.fn() };
  worker.kill = vi.fn();
  return worker;
}

describe("chatgpt-cloak-bridge", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
  });

  it("maps query worker success payload", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.queryWithCloakBrowser({ query: "hello", timeout: 5 });

    expect(worker.stdin.write).toHaveBeenCalledWith(expect.stringContaining('"type":"query"'));

    worker.stdout.emit(
      "data",
      `${JSON.stringify({
        type: "success",
        response: "hi",
        model: "gpt-5.3",
        tookMs: 1234,
        backend: "cloak",
      })}\n`,
    );

    await expect(promise).resolves.toEqual({
      response: "hi",
      model: "gpt-5.3",
      tookMs: 1234,
      imagePath: null,
      partial: false,
      backend: "cloak",
      conversationId: null,
    });
    bridge.__resetBridgeRuntimeForTests();
  });

  it("uses 2700s default timeout for query workers", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.queryWithCloakBrowser({ query: "hello" });

    expect(worker.stdin.write).toHaveBeenCalledWith(expect.stringContaining('"timeout":2700'));

    worker.stdout.emit(
      "data",
      `${JSON.stringify({ type: "success", response: "hi", model: "gpt-5.4-pro", tookMs: 10, backend: "cloak" })}\n`,
    );

    await expect(promise).resolves.toMatchObject({ response: "hi", model: "gpt-5.4-pro" });
    bridge.__resetBridgeRuntimeForTests();
  });

  it("uses 120s default timeout for chats workers", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.manageChatsWithCloakBrowser({ action: "list" });

    expect(worker.stdin.write).toHaveBeenCalledWith(expect.stringContaining('"timeout":120'));

    worker.stdout.emit(
      "data",
      `${JSON.stringify({ type: "success", action: "list", items: [], total: 0, backend: "cloak" })}\n`,
    );

    await expect(promise).resolves.toMatchObject({ action: "list", total: 0 });
    bridge.__resetBridgeRuntimeForTests();
  });

  it("forwards progress and maps chats success payload", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });
    const progress = vi.fn();

    const promise = bridge.manageChatsWithCloakBrowser(
      { action: "list", limit: 2, timeout: 5 },
      progress,
    );

    worker.stdout.emit(
      "data",
      `${JSON.stringify({ type: "progress", step: 1, total: 4, message: "Loading" })}\n`,
    );
    worker.stdout.emit(
      "data",
      `${JSON.stringify({
        type: "success",
        action: "list",
        items: [{ id: "c1" }],
        total: 1,
        backend: "cloak",
      })}\n`,
    );

    await expect(promise).resolves.toEqual({
      action: "list",
      items: [{ id: "c1" }],
      total: 1,
      backend: "cloak",
    });
    expect(progress).toHaveBeenCalledWith({
      type: "progress",
      step: 1,
      total: 4,
      message: "Loading",
    });
    bridge.__resetBridgeRuntimeForTests();
  });

  it("forwards assistant-wait fields to chats workers", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.manageChatsWithCloakBrowser({
      action: "get",
      conversationId: "conv-123",
      waitForAssistant: true,
      waitForAssistantTimeoutSec: 45,
      baselineAssistantMessageId: "msg-456",
    });

    expect(worker.stdin.write).toHaveBeenCalledWith(
      expect.stringContaining('"waitForAssistant":true'),
    );
    expect(worker.stdin.write).toHaveBeenCalledWith(
      expect.stringContaining('"waitForAssistantTimeoutSec":45'),
    );
    expect(worker.stdin.write).toHaveBeenCalledWith(
      expect.stringContaining('"baselineAssistantMessageId":"msg-456"'),
    );

    worker.stdout.emit(
      "data",
      `${JSON.stringify({
        type: "success",
        action: "get",
        conversationId: "conv-123",
        conversation: { id: "conv-123" },
        stabilized: true,
        conversationState: "assistant_complete",
        waitedMs: 900,
        backend: "cloak",
      })}\n`,
    );

    await expect(promise).resolves.toMatchObject({
      action: "get",
      stabilized: true,
      conversationState: "assistant_complete",
      waitedMs: 900,
    });
    bridge.__resetBridgeRuntimeForTests();
  });

  it("propagates worker errors", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.manageChatsWithCloakBrowser({
      action: "get",
      conversationId: "bad",
      timeout: 5,
    });
    worker.stdout.emit(
      "data",
      `${JSON.stringify({
        type: "error",
        code: "conversation_not_found",
        message: "Missing",
        details: { status: 404 },
      })}\n`,
    );

    await expect(promise).rejects.toMatchObject({
      message: "Missing",
      code: "conversation_not_found",
      details: { status: 404 },
    });
    bridge.__resetBridgeRuntimeForTests();
  });

  it("does not retry chat get after clean worker_exit in headless-only mode", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.manageChatsWithCloakBrowser({
      action: "get",
      conversationId: "conv-err",
      timeout: 5,
    });

    worker.emit("close", 0, null);

    await expect(promise).rejects.toMatchObject({
      code: "worker_exit",
      exitCode: 0,
    });
    expect(spawn).toHaveBeenCalledTimes(1);

    bridge.__resetBridgeRuntimeForTests();
  });

  it("passes thinkingTrace through mapSuccess", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.queryWithCloakBrowser({ query: "think hard", timeout: 5 });

    const trace = {
      thoughts: [{ summary: "Analyzing", content: "Let me think..." }],
      durationSec: 12,
      recapText: "Thought for 12s",
      truncated: false,
    };
    worker.stdout.emit(
      "data",
      `${JSON.stringify({
        type: "success",
        response: "answer",
        model: "gpt-5-4-thinking",
        tookMs: 15000,
        backend: "cloak",
        thinkingTrace: trace,
      })}\n`,
    );

    await expect(promise).resolves.toEqual({
      response: "answer",
      model: "gpt-5-4-thinking",
      tookMs: 15000,
      imagePath: null,
      partial: false,
      backend: "cloak",
      conversationId: null,
      thinkingTrace: trace,
    });
    bridge.__resetBridgeRuntimeForTests();
  });

  it("omits thinkingTrace when not present", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.queryWithCloakBrowser({ query: "hello", timeout: 5 });

    worker.stdout.emit(
      "data",
      `${JSON.stringify({
        type: "success",
        response: "hi",
        model: "gpt-5.3",
        tookMs: 500,
        backend: "cloak",
      })}\n`,
    );

    const result = await promise;
    expect(result.thinkingTrace).toBeUndefined();
    expect("thinkingTrace" in result).toBe(false);
    bridge.__resetBridgeRuntimeForTests();
  });

  it("forwards rich thinking trace progress payload", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });
    const progress = vi.fn();

    const promise = bridge.queryWithCloakBrowser({ query: "think", timeout: 5 }, progress);

    worker.stdout.emit(
      "data",
      `${JSON.stringify({
        type: "trace",
        traceType: "thinking_text",
        phase: "Thinking",
        isThinking: true,
        thoughtText: "Plan\nFirst, inspect the inputs.",
        thoughtDelta: "Plan\nFirst, inspect the inputs.",
        thoughtCount: 1,
        durationSec: 4,
      })}\n`,
    );

    worker.stdout.emit(
      "data",
      JSON.stringify({ type: "success", response: "done", model: "gpt-5-4-pro", tookMs: 1000 }) +
        "\n",
    );

    await promise;

    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "trace",
        traceType: "thinking_text",
        phase: "Thinking",
        isThinking: true,
        thoughtText: "Plan\nFirst, inspect the inputs.",
        thoughtDelta: "Plan\nFirst, inspect the inputs.",
        thoughtCount: 1,
        durationSec: 4,
      }),
    );

    bridge.__resetBridgeRuntimeForTests();
  });

  it("forwards sent checkpoint metadata", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });
    const progressSpy = vi.fn();

    const promise = bridge.queryWithCloakBrowser({ query: "hello", timeout: 5 }, progressSpy);
    const sentAt = "2026-04-05T12:34:56.000Z";

    worker.stdout.emit(
      "data",
      `${JSON.stringify({
        type: "meta_update",
        lastCheckpoint: "sent",
        sentAt,
        conversationId: "conv-123",
        baselineAssistantMessageId: "msg-456",
        source: "pre_phase_6",
      })}\n`,
    );
    worker.stdout.emit(
      "data",
      `${JSON.stringify({ type: "success", response: "done", model: "gpt-5.3", tookMs: 100 })}\n`,
    );

    await promise;

    expect(progressSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "meta_update",
        lastCheckpoint: "sent",
        sentAt,
        conversationId: "conv-123",
        baselineAssistantMessageId: "msg-456",
        source: "pre_phase_6",
      }),
    );

    bridge.__resetBridgeRuntimeForTests();
  });

  it("times out workers", async () => {
    vi.useFakeTimers();
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.manageChatsWithCloakBrowser({ action: "list", timeout: 1 });
    const rejection = expect(promise).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(1000);

    await rejection;
    expect(worker.kill).toHaveBeenCalledWith("SIGTERM");
    bridge.__resetBridgeRuntimeForTests();
  });

  it("resets the worker timer on keepalive activity", async () => {
    vi.useFakeTimers();
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.queryWithCloakBrowser({ query: "hello", timeout: 1 });

    await vi.advanceTimersByTimeAsync(900);
    worker.stdout.emit("data", `${JSON.stringify({ type: "keepalive", reason: "text" })}\n`);
    await vi.advanceTimersByTimeAsync(900);

    expect(worker.kill).not.toHaveBeenCalled();

    worker.stdout.emit(
      "data",
      `${JSON.stringify({ type: "success", response: "done", model: "gpt-5.4-pro", tookMs: 1500, backend: "cloak" })}\n`,
    );

    await expect(promise).resolves.toMatchObject({ response: "done", model: "gpt-5.4-pro" });
    bridge.__resetBridgeRuntimeForTests();
  });

  it("does not let log chatter extend the worker timer", async () => {
    vi.useFakeTimers();
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.queryWithCloakBrowser({ query: "hello", timeout: 1 });
    const rejection = expect(promise).rejects.toMatchObject({ code: "timeout" });

    await vi.advanceTimersByTimeAsync(900);
    worker.stdout.emit(
      "data",
      `${JSON.stringify({ type: "log", level: "warn", message: "Cloudflare challenge detected, waiting..." })}\n`,
    );
    await vi.advanceTimersByTimeAsync(100);

    await rejection;
    expect(worker.kill).toHaveBeenCalledWith("SIGTERM");
    bridge.__resetBridgeRuntimeForTests();
  });
});

```

File: /Users/danielsivan/dev/surf-cli/native/chatgpt-cloak-bridge.cjs
```cjs
/**
 * ChatGPT CloakBrowser Bridge
 *
 * Node.js module that spawns CloakBrowser workers (.mjs) and
 * communicates via stdin/stdout JSON-lines protocol.
 */

const { spawn } = require("child_process");
const { existsSync } = require("fs");
const { join, dirname } = require("path");
const {
  resolveChatsTimeoutSeconds,
  resolveQueryTimeoutSeconds,
} = require("./chatgpt-cloak-timeout.cjs");

const DEFAULT_RUNTIME = { spawn, existsSync };
let runtime = { ...DEFAULT_RUNTIME };

const QUERY_WORKER_PATH = join(__dirname, "chatgpt-cloak-worker.mjs");
const CHATS_WORKER_PATH = join(__dirname, "chatgpt-cloak-chats-worker.mjs");

// ---------------------------------------------------------------------------
// Availability check
// ---------------------------------------------------------------------------

function isCloakBrowserAvailable() {
  try {
    let dir = __dirname;
    for (let i = 0; i < 6; i++) {
      if (runtime.existsSync(join(dir, "node_modules", "cloakbrowser", "package.json"))) return true;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return false;
  } catch {
    return false;
  }
}

function ensureAvailability(workerPath) {
  if (!isCloakBrowserAvailable()) {
    throw Object.assign(
      new Error("CloakBrowser not installed. Run: npm install cloakbrowser playwright-core"),
      { code: "cloakbrowser_not_installed" }
    );
  }

  if (!runtime.existsSync(workerPath)) {
    throw Object.assign(
      new Error("CloakBrowser worker not found: " + workerPath),
      { code: "worker_not_found" }
    );
  }
}

function resolveWorkerTimeoutSeconds(timeout, request) {
  const numeric = Number(timeout);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  return request?.type === "query"
    ? resolveQueryTimeoutSeconds(undefined)
    : resolveChatsTimeoutSeconds(undefined);
}

function runCloakWorker({ workerPath, request, timeout, onProgress = () => {}, mapSuccess = (msg) => msg }) {
  ensureAvailability(workerPath);

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const clearWorkerTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        clearWorkerTimer();
        fn(value);
      }
    };

    const worker = runtime.spawn(process.execPath, [workerPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    const timeoutSec = resolveWorkerTimeoutSeconds(timeout, request);
    const timeoutMs = timeoutSec * 1000;
    const armWorkerTimer = () => {
      clearWorkerTimer();
      timer = setTimeout(() => {
        worker.kill("SIGTERM");
        settle(reject, Object.assign(new Error(`CloakBrowser worker killed after ${timeoutMs}ms`), { code: "timeout" }));
      }, timeoutMs);
    };
    armWorkerTimer();

    const handleWorkerMessage = (msg) => {
      if (msg.type === "progress" || msg.type === "trace" || msg.type === "meta_update" || msg.type === "keepalive" || msg.type === "success" || msg.type === "error") {
        armWorkerTimer();
      }
      switch (msg.type) {
        case "progress":
          onProgress(msg);
          return false;
        case "success":
          settle(resolve, mapSuccess(msg));
          return true;
        case "error":
          settle(reject, Object.assign(new Error(msg.message), { code: msg.code, details: msg.details }));
          return true;
        case "trace":
          onProgress({
            type: "trace",
            phase: msg.phase,
            isThinking: msg.isThinking,
            traceType: msg.traceType,
            thoughtText: msg.thoughtText,
            thoughtDelta: msg.thoughtDelta,
            thoughtCount: msg.thoughtCount,
            durationSec: msg.durationSec,
            recapText: msg.recapText,
          });
          return false;
        case "meta_update":
          onProgress({
            type:                       "meta_update",
            conversationId:             msg.conversationId || null,
            baselineAssistantMessageId: msg.baselineAssistantMessageId || null,
            lastCheckpoint:             msg.lastCheckpoint || null,
            sentAt:                     msg.sentAt || null,
            source:                     msg.source || null,
            t:                          msg.t || Date.now(),
          });
          return false;
        case "keepalive":
          return false;
        case "log":
          if (process.env.SURF_DEBUG) {
            process.stderr.write(`[cloak:${msg.level}] ${msg.message}\n`);
          }
          return false;
        default:
          return false;
      }
    };

    let stdoutBuf = "";
    worker.stdout.setEncoding("utf8");
    worker.stdout.on("data", (chunk) => {
      stdoutBuf += chunk;
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          handleWorkerMessage(msg);
        } catch {
          // Ignore non-JSON lines.
        }
      }
    });

    worker.stderr.setEncoding("utf8");
    worker.stderr.on("data", (chunk) => {
      if (chunk.includes("[cloakbrowser]")) {
        process.stderr.write(chunk);
      }
    });

    const tryHandleLine = (line) => {
      if (!line || !line.trim()) return false;
      try {
        const msg = JSON.parse(line);
        return handleWorkerMessage(msg);
      } catch {
        return false;
      }
    };

    worker.on("close", (code, signal) => {
      clearWorkerTimer();
      if (settled) return;
      if (stdoutBuf.trim()) {
        const handled = tryHandleLine(stdoutBuf);
        stdoutBuf = "";
        if (handled || settled) return;
      }
      if (signal) {
        settle(reject, Object.assign(new Error(`CloakBrowser worker killed by ${signal}`), { code: "worker_killed", signal }));
      } else {
        settle(reject, Object.assign(new Error(`CloakBrowser worker exited ${code} without result`), { code: "worker_exit", exitCode: code }));
      }
    });

    worker.stdin.write(JSON.stringify(request) + "\n");
  });
}

async function queryWithCloakBrowser(opts, onProgress = () => {}) {
  const timeout = resolveQueryTimeoutSeconds(opts.timeout);
  const { model, file, profile, conversationId } = opts;
  const prompt = opts.prompt || opts.query || "";
  const promptKB = (Buffer.byteLength(prompt, "utf-8") / 1024).toFixed(1);
  const estimatedTokens = Math.ceil(prompt.length / 4);
  const tokenKStr = (estimatedTokens / 1000).toFixed(1) + "K";
  if (Number(promptKB) > 10) {
    console.error(`[cloak-bridge] Prompt: ${promptKB}KB (${prompt.split("\n").length} lines, ~${tokenKStr} tokens)`);
  }
  if (estimatedTokens > 120_000) {
    console.error(`[cloak-bridge] ⚠ Prompt ~${tokenKStr} tokens — approaching GPT Pro 150K limit`);
  }
  const generateImage = opts["generate-image"] || opts.generateImage || null;

  return runCloakWorker({
    workerPath: QUERY_WORKER_PATH,
    request: {
      type: "query",
      prompt,
      model,
      file,
      profile,
      timeout,
      generateImage,
      conversationId,
    },
    timeout,
    onProgress,
    mapSuccess: (msg) => ({
      response: msg.response || msg.text || "",
      model: msg.model,
      tookMs: msg.tookMs || msg.durationMs || 0,
      imagePath: msg.imagePath || null,
      partial: !!msg.partial,
      backend: msg.backend || "cloak",
      conversationId: msg.conversationId || conversationId || null,
      ...(msg.thinkingTrace ? { thinkingTrace: msg.thinkingTrace } : {}),
    }),
  });
}

async function manageChatsWithCloakBrowser(opts, onProgress = () => {}) {
  const timeout = resolveChatsTimeoutSeconds(opts.timeout);
  const runChatsRequest = () => runCloakWorker({
    workerPath: CHATS_WORKER_PATH,
    request: {
      type: "chats",
      action: opts.action,
      conversationId: opts.conversationId,
      conversationIds: opts.conversationIds,
      query: opts.query,
      limit: opts.limit,
      all: opts.all,
      profile: opts.profile,
      timeout,
      title: opts.title,
      fileId: opts.fileId,
      includeBytes: opts.includeBytes,
      outputPath: opts.outputPath,
      waitForAssistant: opts.waitForAssistant,
      waitForAssistantTimeoutSec: opts.waitForAssistantTimeoutSec,
      baselineAssistantMessageId: opts.baselineAssistantMessageId,
    },
    timeout,
    onProgress,
    mapSuccess: (msg) => {
      const out = { ...msg };
      delete out.type;
      return out;
    },
  });

  return await runChatsRequest();
}

function __setBridgeRuntimeForTests(overrides = {}) {
  runtime = { ...runtime, ...overrides };
}

function __resetBridgeRuntimeForTests() {
  runtime = { ...DEFAULT_RUNTIME };
}

module.exports = {
  isCloakBrowserAvailable,
  queryWithCloakBrowser,
  manageChatsWithCloakBrowser,
  __setBridgeRuntimeForTests,
  __resetBridgeRuntimeForTests,
};

```

File: /Users/danielsivan/dev/surf-cli/native/chatgpt-cloak-timeout.cjs
```cjs
const DEFAULT_CHATGPT_QUERY_TIMEOUT_SEC = 2700;
const DEFAULT_CHATGPT_CHATS_TIMEOUT_SEC = 120;
const MIN_KEEPALIVE_INTERVAL_MS = 1000;
const MAX_KEEPALIVE_INTERVAL_MS = 15000;

function resolvePositiveTimeoutSeconds(timeout, fallback) {
  const numeric = Number(timeout);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function resolveQueryTimeoutSeconds(timeout) {
  return resolvePositiveTimeoutSeconds(timeout, DEFAULT_CHATGPT_QUERY_TIMEOUT_SEC);
}

function resolveChatsTimeoutSeconds(timeout) {
  return resolvePositiveTimeoutSeconds(timeout, DEFAULT_CHATGPT_CHATS_TIMEOUT_SEC);
}

function resolveKeepaliveIntervalMs(timeout) {
  const timeoutMs = resolveQueryTimeoutSeconds(timeout) * 1000;
  return Math.min(MAX_KEEPALIVE_INTERVAL_MS, Math.max(MIN_KEEPALIVE_INTERVAL_MS, Math.floor(timeoutMs / 4)));
}

function normalizeActivityPhase(phase) {
  const trimmed = typeof phase === "string" ? phase.trim() : "";
  if (!trimmed) return "";
  if (/^(?:thought|thinking)\s+for\s+[\d.,]+\s+seconds?$/i.test(trimmed)) return "Thinking";
  return trimmed;
}

function detectResponseActivity({
  phase,
  previousPhase,
  turnId,
  previousTurnId,
  observedTurnId,
  baselineTurnId,
  currentText,
  previousText,
  baselineText,
  streamText,
  previousStreamText,
  thinkingText,
  previousThinkingText,
  trustedActivitySeen = false,
}) {
  const normalizedPhase = normalizeActivityPhase(phase);
  const normalizedPreviousPhase = normalizeActivityPhase(previousPhase);
  const onBaselineTurn = !!(baselineTurnId && observedTurnId && observedTurnId === baselineTurnId);
  const phaseChanged = !!(normalizedPhase && normalizedPhase !== normalizedPreviousPhase && !onBaselineTurn);
  const turnChanged = !!(turnId && turnId !== previousTurnId);
  const streamChanged = !!(streamText && streamText !== previousStreamText);
  const thinkingChanged = !!(thinkingText && thinkingText !== previousThinkingText);
  const textMatchesBaseline = !!(onBaselineTurn && baselineText && currentText === baselineText);
  const textChanged = !!(
    currentText &&
    currentText !== previousText &&
    !textMatchesBaseline &&
    (trustedActivitySeen || previousText || phaseChanged || turnChanged || streamChanged || thinkingChanged || !onBaselineTurn)
  );
  const reasons = [];
  if (phaseChanged) reasons.push("phase");
  if (turnChanged) reasons.push("turn");
  if (streamChanged) reasons.push("stream");
  if (textChanged) reasons.push("text");
  if (thinkingChanged) reasons.push("thinking");
  return { active: reasons.length > 0, reasons };
}

module.exports = {
  DEFAULT_CHATGPT_QUERY_TIMEOUT_SEC,
  DEFAULT_CHATGPT_CHATS_TIMEOUT_SEC,
  resolveQueryTimeoutSeconds,
  resolveChatsTimeoutSeconds,
  resolveKeepaliveIntervalMs,
  normalizeActivityPhase,
  detectResponseActivity,
};

```

File: /Users/danielsivan/dev/surf-cli/native/session-reconciler.cjs
```cjs
/**
 * surf-cli session reconciler
 *
 * Detects orphaned / stale sessions whose worker died without calling
 * session.finish() or session.fail(), and optionally polls the ChatGPT API
 * to recover completed conversations.
 *
 * Public API:
 *   defaultPidIsAlive(pid)           — liveness check for a stored pid
 *   isChatGptCloakSession(meta)      — true when session used cloak
 *   resolveConversationId(meta)      — extract conversationId from meta/args
 *   inspectConversation(conv, meta)  — determine outcome from GET response
 *   reconcileSessions(opts)          — main reconcile pass (local + optional network)
 */

"use strict";

const { listSessions, updateSession, appendSessionLog, persistSessionResponse } = require("./session-store.cjs");
const { extractMessageText, summarizeConversation } = require("./chatgpt-chats-formatter.cjs");
const { classifyConversationProgress } = require("./chatgpt-conversation-state.cjs");

// ============================================================================
// Constants
// ============================================================================

/** Sessions still "running" beyond this age are considered orphaned. */
const MAX_RUNNING_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check whether a PID is still alive using signal 0.
 * Returns false for invalid / missing PIDs.
 */
function defaultPidIsAlive(pid) {
  if (!pid || typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** True when the session was run via CloakBrowser. ChatGPT is always Cloak in headless-only mode. */
function isChatGptCloakSession(meta) {
  return meta.tool === "chatgpt" || meta.tool === "chatgpt.reply";
}

/** Pull the ChatGPT conversation ID out of wherever it may be stored. */
function resolveConversationId(meta) {
  return (
    meta.conversationId ||
    (meta.args && meta.args.conversationId) ||
    null
  );
}

function hasSentCheckpoint(meta) {
  const hasCheckpointFields =
    meta &&
    (Object.prototype.hasOwnProperty.call(meta, "lastCheckpoint") ||
      Object.prototype.hasOwnProperty.call(meta, "sentAt"));

  if (!hasCheckpointFields) {
    return true;
  }

  return (
    meta.lastCheckpoint === "sent" ||
    (typeof meta.sentAt === "string" && meta.sentAt.trim() !== "")
  );
}

function extractRecoveredAssistantPayload(conversation, nodeId = null) {
  if (!conversation || typeof conversation !== "object") return null;
  const mapping = conversation.mapping && typeof conversation.mapping === "object" ? conversation.mapping : null;
  const node = mapping && nodeId ? mapping[nodeId] : null;
  const nodeMessage = node && node.message ? node.message : null;
  const nodeText = extractMessageText(nodeMessage);
  const summary = summarizeConversation(conversation);
  const lastAssistant = Array.isArray(summary.messages)
    ? [...summary.messages].reverse().find((msg) => msg && msg.role === "assistant")
    : null;
  const fallbackText = lastAssistant && (!nodeId || lastAssistant.id === nodeId) ? lastAssistant.text : "";
  const responseText = String(nodeText || fallbackText || "").trim();
  if (!responseText) return null;
  return {
    responseText,
    model: nodeMessage?.metadata?.model_slug || lastAssistant?.model || summary.model || null,
  };
}

// ============================================================================
// inspectConversation
// ============================================================================

/**
 * Analyse a GET /backend-api/conversation/{id} response to determine whether
 * the conversation completed, is still in progress, or is ambiguous.
 *
 * @param {object}  conversation  Raw conversation object from the API.
 * @param {object}  meta          Session meta (for baseline comparison).
 * @returns {{ outcome: string, nodeId: string|null }}
 *   outcome: 'completed' | 'no_new_assistant' | 'in_progress' | 'ambiguous'
 */
function inspectConversation(conversation, meta = {}) {
  const classified = classifyConversationProgress(conversation, {
    baselineAssistantMessageId: meta.baselineAssistantMessageId || null,
  });
  switch (classified.state) {
    case "assistant_complete":
      return { outcome: "completed", nodeId: classified.nodeId || null };
    case "assistant_complete_baseline":
      return { outcome: "no_new_assistant", nodeId: classified.nodeId || null };
    case "assistant_in_progress":
    case "awaiting_assistant":
      return { outcome: "in_progress", nodeId: classified.nodeId || null };
    default:
      return { outcome: "ambiguous", nodeId: classified.nodeId || null };
  }
}

// ============================================================================
// reconcileSessions
// ============================================================================

/**
 * Main reconcile pass.
 *
 * Local-only (fast, no network):
 *   - Checks stored pid liveness
 *   - Marks orphaned sessions as status "error" with code "session_orphaned"
 *
 * Network-enhanced (pollNetwork: true):
 *   - For sessions with a known conversationId, calls manageChats({ action:'get' })
 *   - Recovered sessions become status "completed"
 *   - Unresolved (in_progress) sessions stay "running" with reconcile.state = 'unresolved'
 *
 * @param {object}  opts
 * @param {number}  [opts.hours=72]        Look back window for listSessions.
 * @param {boolean} [opts.all=false]       Pass through to listSessions.
 * @param {number}  [opts.limit=200]       Pass through to listSessions.
 * @param {boolean} [opts.pollNetwork]     Enable network polling.
 * @param {Function}[opts.manageChats]     manageChatsWithCloakBrowser function ref.
 *
 * Network polling gate:
 *   - New sessions poll only after the worker persisted a sent checkpoint.
 *   - Legacy sessions (pre-checkpoint metadata) still poll when conversationId exists.
 *
 * @returns {{ reconciled: number, sessions: Array }}
 */
async function reconcileSessions(opts = {}) {
  const {
    hours        = 72,
    all          = false,
    limit        = 200,
    pollNetwork  = false,
    manageChats  = null,
  } = opts;

  const sessions = listSessions({ hours, all, limit });
  const running  = sessions.filter(s => s.status === "running");

  if (running.length === 0) return { reconciled: 0, sessions: [] };

  const results = [];
  const now     = Date.now();

  for (const meta of running) {
    const createdMs = new Date(meta.createdAt).getTime();
    const age       = now - createdMs;
    const pidAlive  = defaultPidIsAlive(meta.pid);
    const tooOld    = age > MAX_RUNNING_AGE_MS;

    // ── PID still alive → annotate but never mutate status ──────────────────
    // (even if very old — could be a legitimate long-running session)
    if (pidAlive) {
      if (tooOld) {
        // Annotate as "stale" but keep running — active worker may still complete
        const reconcile = {
          reconciledAt: new Date().toISOString(),
          pidAlive:     true,
          ageSec:       Math.round(age / 1000),
          state:        "stale",
          remote:       null,
        };
        updateSession(meta.id, { reconcile });
        results.push({ meta, action: "stale", reason: "old_but_pid_alive" });
      } else {
        results.push({ meta, action: "none", reason: "pid_alive" });
      }
      continue;
    }

    // PID is dead — proceed to orphan / network recovery
    // Build reconcile record (will be written regardless of network result)
    const reconcile = {
      reconciledAt: new Date().toISOString(),
      pidAlive:     false,
      ageSec:       Math.round(age / 1000),
      state:        "orphaned",
      remote:       null,
    };

    const conversationId = resolveConversationId(meta);
    let   recovered      = false;

    // ── Optional network poll ──────────────────────────────────────────────
    if (pollNetwork && hasSentCheckpoint(meta) && conversationId && typeof manageChats === "function") {
      try {
        const chatResult = await manageChats({
          action:         "get",
          conversationId,
          profile:        meta.args && meta.args.profile,
          timeout:        30,
          waitForAssistant: true,
          waitForAssistantTimeoutSec: 30,
          baselineAssistantMessageId: meta.baselineAssistantMessageId || null,
        });

        // manageChatsWithCloakBrowser wraps the result — unwrap conversation
        const convo = (
          chatResult &&
          (chatResult.conversation ||
            (chatResult.data && chatResult.data.conversation))
        ) || null;

        const inspection = inspectConversation(convo, meta);
        reconcile.remote = {
          conversationId,
          outcome: inspection.outcome,
          nodeId:  inspection.nodeId || null,
        };

        if (inspection.outcome === "completed") {
          const recoveredPayload = extractRecoveredAssistantPayload(convo, inspection.nodeId);
          const recoveredResponse = recoveredPayload?.responseText || "";
          const responsePreview = recoveredResponse ? recoveredResponse.slice(0, 160) : null;
          const responseArtifact = persistSessionResponse(meta.id, recoveredResponse);
          const result = {
            ok:            true,
            reconciled:    true,
            recovered:     true,
            conversationId,
            nodeId:        inspection.nodeId,
            model:         recoveredPayload?.model || null,
            responsePreview,
            responsePath: responseArtifact?.responsePath || null,
            responseChars: responseArtifact?.responseChars || 0,
          };
          if (!responseArtifact?.responsePath && recoveredResponse) {
            result.inlineResponse = recoveredResponse;
            result.inlineResponseTruncated = false;
            result.inlineResponseChars = recoveredResponse.length;
          }
          reconcile.state = "recovered";
          updateSession(meta.id, {
            status:      "completed",
            completedAt: new Date().toISOString(),
            elapsedMs:   age,
            reconcile,
            result,
          });
          appendSessionLog(meta.id, `[session] ✓ recovered remote reply from conversation ${conversationId}`);
          if (responseArtifact?.responsePath) {
            appendSessionLog(meta.id, `[session] response saved: ${responseArtifact.responsePath}`);
          } else if (recoveredResponse) {
            appendSessionLog(meta.id, `[session] recovered assistant reply stored in inline fallback (${recoveredResponse.length} chars)`);
          }
          results.push({ meta, action: "recovered", reason: "conversation_completed", conversationId });
          recovered = true;

        } else if (inspection.outcome === "in_progress") {
          // Still generating on ChatGPT side — leave running but annotate
          reconcile.state = "unresolved";
          updateSession(meta.id, { reconcile });
          results.push({ meta, action: "unresolved", reason: "conversation_in_progress", conversationId });
          recovered = true; // don't mark error

        } else {
          // no_new_assistant / ambiguous → fall through to orphan
          reconcile.state = "orphaned";
          if (inspection.outcome === "no_new_assistant") {
            reconcile.remote = { ...reconcile.remote, reason: "no_new_assistant" };
          }
        }
      } catch (e) {
        reconcile.remote = {
          conversationId,
          outcome: "poll_failed",
          error:   e.message,
        };
        reconcile.state = "orphaned";
      }
    }

    // ── Mark orphaned ──────────────────────────────────────────────────────
    if (!recovered) {
      updateSession(meta.id, {
        status:      "error",
        completedAt: new Date().toISOString(),
        elapsedMs:   age,
        reconcile,
        error: {
          message: "Session orphaned — process exited without completing",
          code:    "session_orphaned",
        },
      });
      results.push({ meta, action: "orphaned", reason: pollNetwork ? "network_poll_failed_or_no_convo" : "pid_dead" });
    }
  }

  return {
    reconciled: results.filter(r => r.action !== "none").length,
    sessions:   results,
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  defaultPidIsAlive,
  isChatGptCloakSession,
  resolveConversationId,
  inspectConversation,
  reconcileSessions,
  MAX_RUNNING_AGE_MS,
};

```

File: /Users/danielsivan/dev/surf-cli/docs/investigations/rp-surf-oracle-missing-reply-recovery.md
```md
# Investigation: rp-surf-oracle missing local reply despite ChatGPT Pro UI response

> Status (2026-04-13): fixed in surf-cli. Query default timeout now matches the documented 2700s, and reconcile persists recovered assistant bodies to session response artifacts when available.

## Summary
The ChatGPT Pro run did produce a valid assistant response remotely, and that response was recoverable via the chats retrieval path. The local `rp-surf-oracle` / `surf chatgpt` run failed to return it because the cloak query path used a 120s default timeout while CLI help advertised 2700s, and this specific GPT-5.4 Pro conversation ran for roughly 46 minutes. Reconcile also used to mark the session completed before persisting the recovered assistant body.

## Symptoms
- Prompt insertion succeeded for a ~446KB RepoPrompt export.
- Backend prompt persistence validation succeeded.
- Session log reached `[6/6] Waiting for response` and thinking trace streamed.
- No final local `success` payload or assistant body was returned.
- ChatGPT UI showed a completed response.
- `surf session --reconcile --network` later recovered the session.

## Investigation Log

### Query timeout defaults
**Hypothesis:** the local worker was timing out before a long GPT-5.4 Pro reply completed.

**Findings:** CLI help says ChatGPT timeout default is 2700s, but the cloak query implementation defaults to 120s in both bridge and worker.

**Evidence:**
- `native/cli.cjs:390` advertises `Timeout in seconds (default: 2700 = 45min)`.
- `native/chatgpt-cloak-bridge.cjs:49-50` starts the worker timer from `timeout = 120`.
- `native/chatgpt-cloak-bridge.cjs:211` destructures `timeout = 120` in `queryWithCloakBrowser()`.
- `native/chatgpt-cloak-worker.mjs:1025-1026` enters phase 6 response wait with `const deadline = Date.now() + timeout * 1000`.

**Conclusion:** confirmed. This run used the cloak path and the real timeout default on that path is 120s, not 2700s.

### Conversation duration vs timeout
**Hypothesis:** this particular conversation outlasted the 120s timeout.

**Findings:** the recovered conversation markdown shows the initial user turn at `07:53` and the final assistant turn at `08:39`.

**Evidence:**
- Export command used:
  - `surf chatgpt.chats 69d730dc-7f68-8389-9001-9993d8d8020d --export /tmp/chatgpt-69d730dc.md --format markdown --profile dsebban883@gmail.com`
- Exported file: `/tmp/chatgpt-69d730dc.md`
- Header/body markers in export:
  - first user turn: `### You · 07:53`
  - final assistant turn: `### ChatGPT · 08:39`

**Conclusion:** confirmed. The remote run lasted far beyond 120s, so a local 120s timeout is sufficient to explain why the worker did not deliver the final reply.

### Session recovery behavior
**Hypothesis:** reconcile marks completion but does not hydrate the final assistant text.

**Findings:** reconcile stores recovery metadata only: `conversationId`, `nodeId`, `ok`, `reconciled`. No assistant body is persisted.

**Evidence:**
- `native/session-reconciler.cjs:237-252` updates session to `completed` with:
  - `result.ok = true`
  - `result.reconciled = true`
  - `result.conversationId`
  - `result.nodeId`
- `native/session-store.cjs:108-118` `Session.finish()` only persists model/image/`responsePreview`; there is no field for full assistant text.

**Conclusion:** confirmed at investigation time. This is now fixed: recovered assistant text is persisted into the session response artifact (or inline fallback when artifact persistence fails).

### Direct recovery path
**Hypothesis:** the final answer can be recovered outside the query path using the existing chats API worker.

**Findings:** `chatgpt.chats <conversationId>` uses the dedicated chats worker, which calls the backend conversation GET endpoint and can export markdown.

**Evidence:**
- `native/chatgpt-cloak-chats-worker.mjs:625-630` returns `{ action: 'get', conversationId, conversation: data }`.
- `native/chatgpt-chats-formatter.cjs:228-245` renders the full conversation into markdown.
- Actual recovery succeeded with the command above and produced `/tmp/chatgpt-69d730dc.md`.

**Conclusion:** confirmed. The reply is recoverable today using `surf chatgpt.chats <conversationId>`.

## Root Cause
Primary cause for this run: timeout mismatch.

The user-facing CLI help says ChatGPT queries default to 2700 seconds (`native/cli.cjs:390`), but the cloak query path actually defaults to 120 seconds in both `queryWithCloakBrowser()` and `runCloakWorker()` (`native/chatgpt-cloak-bridge.cjs:49-50`, `native/chatgpt-cloak-bridge.cjs:211`). This run used GPT-5.4 Pro and the recovered conversation spans roughly 46 minutes (`/tmp/chatgpt-69d730dc.md`: `### You · 07:53` to `### ChatGPT · 08:39`), so the local worker would have been killed long before the remote reply finished.

Secondary issue at investigation time: even after recovery, the session system did not hydrate the full assistant text. That follow-up has now landed, so recovered sessions persist the assistant body to the response artifact path when possible.

## Recovered Response
The full recovered conversation is saved at:
- `/tmp/chatgpt-69d730dc.md`

The final assistant turn begins:
- `Implemented a targeted stabilization pass for the CloakBrowser ChatGPT path...`

## Recommendations
1. Align the ChatGPT cloak query default timeout with CLI help and intended Pro behavior.
   - Files: `native/chatgpt-cloak-bridge.cjs`, possibly worker call sites / argument normalization in `native/cli.cjs`.
2. Add a recovery path that can hydrate assistant text into recovered sessions.
   - Files: `native/session-reconciler.cjs`, `native/session-store.cjs`, possibly `native/cli.cjs` session display.
3. Add a regression test for “remote reply exists after query worker death/timeout”.
   - Files: `test/unit/chatgpt-cloak-bridge.test.ts`, `test/unit/session-reconciler.test.ts`.

## Preventive Measures
- Keep help/defaults in sync with actual query path behavior.
- For long-running ChatGPT Pro runs, either pass explicit `--timeout 2700` or raise the cloak default.
- Persist recoverable response text or export path when network reconcile succeeds.

```

File: /Users/danielsivan/dev/surf-cli/README.md
```md
<p>
  <img src="surf-banner.png" alt="surf" width="1100">
</p>

# surf-cli

**Headless terminal AI for ChatGPT and Gemini.**

[![npm version](https://img.shields.io/npm/v/surf-cli?style=for-the-badge)](https://www.npmjs.com/package/surf-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

`surf` lets agents and shell scripts use signed-in ChatGPT and Gemini accounts from the terminal. It is local-first, prompt-file friendly, and built for long-running AI workflows.

```bash
npm install -g surf-cli

surf chatgpt "Review this patch" --file diff.patch --model pro --profile user@gmail.com
surf gemini "Summarize this dataset" --file data.csv --model gemini-3-pro --profile user@gmail.com
surf chatgpt.chats --search "release notes" --profile user@gmail.com
surf session --all
```

## What runs under the hood

- **ChatGPT**: CloakBrowser headless Chromium via CDP.
- **Gemini**: Bun WebView headless runtime.
- **Auth**: use an existing local profile with `--profile user@gmail.com`.
- **Agent integration**: `surf server` exposes the MCP server over stdio.
- **Sessions**: AI runs are logged under `~/.surf/sessions/` for inspection and reconciliation.

## Requirements

- Node.js and npm for the `surf` CLI.
- ChatGPT uses the bundled CloakBrowser runtime.
- Gemini requires `bun` on `PATH` for the Bun WebView runtime.
- `--profile <email>` profile selection is currently macOS-only; without it, ChatGPT uses `~/.surf/cloak-profile`.
- ChatGPT always runs through CloakBrowser in headless mode. `CLOAK_HEADLESS` cannot enable headed mode, and `SURF_USE_CLOAK_CHATGPT` is obsolete.

## Installation

```bash
npm install -g surf-cli
surf --version
```

For development:

```bash
git clone https://github.com/nicobailon/surf-cli.git
cd surf-cli
npm install
npm test
npm run check
```

## Commands

### `surf chatgpt`

Send a prompt to ChatGPT through the CloakBrowser headless runtime.

```bash
surf chatgpt "Explain this error" --profile user@gmail.com
surf chatgpt --prompt-file prompt.md --model gpt-5.4-pro --profile user@gmail.com
surf chatgpt "Review this file" --file code.ts --model thinking --profile user@gmail.com
surf chatgpt "A robot surfing a neon wave" --generate-image /tmp/robot.png --profile user@gmail.com
```

Common options:

- `--profile <email>`: local profile email to use for signed-in auth.
- `--model <model>`: `instant`, `thinking`, `pro`, or provider model names such as `gpt-5.4-pro`.
- `--file <path>`: attach a file.
- `--prompt-file <path>`: read the prompt from a file. Use this for exported RepoPrompt context; `--file` uploads an attachment instead of inlining prompt text.
- `--generate-image <path>`: generate an image and save it.
- `--timeout <seconds>`: inactivity timeout. Default: `2700` seconds.

### `surf gemini`

Send a prompt to Gemini through the Bun WebView headless runtime.

```bash
surf gemini "Explain quantum computing" --profile user@gmail.com
surf gemini "Analyze this CSV" --file data.csv --model gemini-3-pro --profile user@gmail.com
surf gemini "A robot surfing" --generate-image /tmp/gemini.png --aspect-ratio 16:9 --profile user@gmail.com
surf gemini "Add sunglasses" --edit-image photo.jpg --output edited.jpg --profile user@gmail.com
surf gemini "Summarize this video" --youtube "https://youtube.com/watch?v=..." --profile user@gmail.com
```

Common options:

- `--profile <email>`: local profile email to use for signed-in auth.
- `--model <model>`: Gemini model name, such as `gemini-3-pro`, `gemini-2.5-pro`, or `gemini-2.5-flash`.
- `--file <path>`: attach a file.
- `--generate-image <path>`: generate an image and save it.
- `--edit-image <path> --output <path>`: edit an existing image.
- `--youtube <url>`: analyze a YouTube video URL.
- `--aspect-ratio <ratio>`: image ratio such as `1:1` or `16:9`.
- `--timeout <seconds>`: request timeout. Default: `300` seconds.

### `surf chatgpt.chats`

List, search, view, export, rename, delete, and download ChatGPT conversation data.

```bash
surf chatgpt.chats --profile user@gmail.com
surf chatgpt.chats --search "auth bug" --profile user@gmail.com
surf chatgpt.chats <conversation-id> --profile user@gmail.com
surf chatgpt.chats <conversation-id> --export /tmp/chat.md --format markdown --profile user@gmail.com
surf chatgpt.chats <conversation-id> --rename "New title" --profile user@gmail.com
surf chatgpt.chats <conversation-id> --download-file file-abc --output /tmp/file.bin --profile user@gmail.com
```

Useful options:

- `--limit <n>`: list count or last N visible messages when viewing.
- `--all`: fetch all conversations.
- `--search <query>`: search conversation titles and content.
- `--export <path>` and `--format markdown|json`: save a viewed conversation. Export waits briefly for a pending assistant turn before rendering.
- `--rename <title>`: rename a conversation.
- `--delete` or `--delete-ids <ids>`: delete conversations.
- `--download-file <file-id> --output <path>`: download an attachment.
- `--no-cache`: bypass local chats cache.

RepoPrompt / oracle export note:

- Use `--prompt-file` for exported context, never `--file`.
- If RepoPrompt export stats show `Files: 0`, rebuild the selection/preset before sending.

### `surf chatgpt.reply`

Reply inside an existing ChatGPT conversation.

```bash
surf chatgpt.reply <conversation-id> "Follow up with a shorter version" --profile user@gmail.com
surf chatgpt.reply <conversation-id> --prompt-file followup.md --model gpt-5.4-thinking --profile user@gmail.com
```

### `surf session`

Inspect and clean up saved AI sessions.

```bash
surf session
surf session --all
surf session <session-id>
surf session --reconcile
surf session --reconcile --network
surf session --clear
surf session --clear --hours 24
```

Session records include stderr logs, results, model metadata, conversation IDs, process IDs, and reconciliation status.

### `surf do`

Parse and run supported commands as a workflow.

```bash
surf do 'chatgpt "Draft release notes" --profile user@gmail.com | gemini "Make it concise" --profile user@gmail.com'
surf do 'chatgpt "Review this" --file diff.patch --profile user@gmail.com' --dry-run
surf do --file workflow.json --on-error continue
```

Use `--dry-run` to validate a workflow without executing it.

### `surf server`

Start the MCP server for AI-agent integration over stdio.

```bash
surf server
```

Use this when configuring an MCP-capable agent to call surf tools directly.

## Model shortcuts

ChatGPT accepts both shortcuts and provider names:

| Shortcut | Maps to |
| --- | --- |
| `instant` | fast ChatGPT model |
| `thinking` | reasoning ChatGPT model |
| `pro` | highest-capability ChatGPT model |

You can also pass explicit model names, for example `gpt-5.4-pro` or `gemini-3-pro`.

## Profile auth

Use `--profile user@gmail.com` on ChatGPT and Gemini commands to select the local signed-in profile for that account.

```bash
surf chatgpt "Hello" --profile user@gmail.com
surf gemini "Hello" --profile user@gmail.com
```

If auth is missing or expired, sign in with the relevant account in that local profile, then retry the command.

## Files and images

Attach files:

```bash
surf chatgpt "Review this" --file code.ts --profile user@gmail.com
surf gemini "Summarize" --file report.pdf --profile user@gmail.com
```

Generate images:

```bash
surf chatgpt "A watercolor lighthouse" --generate-image /tmp/lighthouse.png --profile user@gmail.com
surf gemini "A cyberpunk cat" --generate-image /tmp/cat.png --aspect-ratio 1:1 --profile user@gmail.com
```

Edit images with Gemini:

```bash
surf gemini "Remove the background" --edit-image photo.jpg --output cutout.png --profile user@gmail.com
```

## MCP integration

Start the stdio MCP server:

```bash
surf server
```

Then point your MCP-capable agent at the `surf` binary with the `server` argument.

## Troubleshooting

- Run `surf --help` for the current command summary.
- Run `surf <command> --help` for command-specific options.
- Run `surf session <id>` to inspect a failed or long-running AI request.
- Use `--timeout <seconds>` for long prompts, file uploads, or image generation.
- Use `--profile <email>` consistently when multiple local accounts are signed in.
- If you see `Files: 0` in RepoPrompt export stats, do not send that export to ChatGPT yet.

## License

MIT

```

File: /Users/danielsivan/dev/surf-cli/test/unit/chatgpt-chats-formatter.test.ts
```ts
import { describe, expect, it } from "vitest";

const formatter = require("../../native/chatgpt-chats-formatter.cjs");

const conversation = {
  title: "Auth system design",
  create_time: 1711800120.123,
  current_node: "m5",
  mapping: {
    root: { id: "root", parent: null, children: ["m1"] },
    m1: {
      id: "m1",
      parent: "root",
      children: ["m2", "m3"],
      message: {
        author: { role: "user" },
        content: { parts: ["Design auth"] },
        create_time: 1711800120.3,
        metadata: {},
      },
    },
    m2: {
      id: "m2",
      parent: "m1",
      children: [],
      message: {
        author: { role: "assistant" },
        content: { parts: ["Branch A"] },
        create_time: 1711800180.5,
        metadata: { model_slug: "gpt-5.3" },
      },
    },
    m3: {
      id: "m3",
      parent: "m1",
      children: ["m4", "m-hidden", "m-system"],
      message: {
        author: { role: "assistant" },
        content: { parts: ["Branch B"] },
        create_time: 1711800200,
        metadata: { model_slug: "gpt-5.4-thinking" },
      },
    },
    m4: {
      id: "m4",
      parent: "m3",
      children: ["m5"],
      message: {
        author: { role: "user" },
        content: { parts: ["Go deeper"] },
        create_time: 1711800300,
        metadata: {},
      },
    },
    m5: {
      id: "m5",
      parent: "m4",
      children: [],
      message: {
        author: { role: "assistant" },
        content: { parts: ["Detailed plan"] },
        create_time: 1711800400,
        metadata: { model_slug: "gpt-5.4-thinking" },
      },
    },
    "m-hidden": {
      id: "m-hidden",
      parent: "m3",
      children: [],
      message: {
        author: { role: "assistant" },
        content: { parts: ["hidden"] },
        create_time: 1711800350,
        metadata: { is_hidden: true },
      },
    },
    "m-system": {
      id: "m-system",
      parent: "m3",
      children: [],
      message: {
        author: { role: "system" },
        content: { parts: ["sys"] },
        create_time: 1711800360,
        metadata: {},
      },
    },
  },
};

describe("chatgpt-chats-formatter", () => {
  it("normalizes conversation list items and sorts by updated time", () => {
    const items = formatter.normalizeConversationItems({
      items: [
        { id: "b", title: "Older", create_time: "2025-03-30T11:05:00.000Z" },
        {
          id: "a",
          title: "Newer",
          update_time: "2025-03-30T14:22:00.000Z",
          create_time: "2025-03-30T10:00:00.000Z",
        },
      ],
    });

    expect(items.map((item: any) => item.id)).toEqual(["a", "b"]);
    expect(items[1].update_time).toBe("2025-03-30T11:05:00.000Z");
  });

  it("walks active path (root → current_node) by default, excluding abandoned branches", () => {
    const messages = formatter.walkConversationMessages(conversation);
    // current_node = m5, so active path is: root → m1 → m3 → m4 → m5
    // m2 (Branch A) is on an abandoned branch and should NOT appear
    expect(messages.map((msg: any) => msg.id)).toEqual(["m1", "m3", "m4", "m5"]);
    expect(messages.map((msg: any) => msg.text)).toEqual([
      "Design auth",
      "Branch B",
      "Go deeper",
      "Detailed plan",
    ]);
  });

  it("walks all branches in full mode (DFS)", () => {
    const messages = formatter.walkConversationMessages(conversation, { mode: "full" });
    expect(messages.map((msg: any) => msg.id)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(messages.map((msg: any) => msg.text)).toEqual([
      "Design auth",
      "Branch A",
      "Branch B",
      "Go deeper",
      "Detailed plan",
    ]);
  });

  it("falls back to full DFS when current_node is missing", () => {
    const noCurrentNode = { ...conversation, current_node: null };
    const messages = formatter.walkConversationMessages(noCurrentNode);
    // Without current_node, falls back to full DFS
    expect(messages.map((msg: any) => msg.id)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
  });

  it("summarizes conversation using active path and keeps last assistant model", () => {
    const summary = formatter.summarizeConversation(conversation);
    // Active path: m1, m3, m4, m5 (m2 excluded)
    expect(summary.totalMessages).toBe(4);
    expect(summary.model).toBe("gpt-5.4-thinking");
    expect(summary.title).toBe("Auth system design");
  });

  it("applies message limit from the tail of visible messages", () => {
    const summary = formatter.summarizeConversation(conversation, { messageLimit: 2 });
    expect(summary.messages.map((msg: any) => msg.id)).toEqual(["m4", "m5"]);
  });

  it("formats conversation markdown using active path (no abandoned branches)", () => {
    const markdown = formatter.formatConversationMarkdown({ conversation, messageLimit: 3 });
    expect(markdown).toContain("# Auth system design");
    expect(markdown).toContain("### ChatGPT ·");
    expect(markdown).toContain("Detailed plan");
    expect(markdown).not.toContain("hidden");
    expect(markdown).not.toContain("\nsys\n");
    // Branch A (m2) is on abandoned branch → excluded from active path
    expect(markdown).not.toContain("Branch A");
    expect(markdown).toContain("Branch B");
  });

  it("formats conversation list table", () => {
    const output = formatter.formatConversationList({
      items: [
        {
          id: "abc1234567890",
          title: "Auth system design",
          update_time: "2025-03-30T14:22:00.000Z",
        },
      ],
      total: 1,
    });

    expect(output).toContain("ChatGPT Conversations (1 of 1)");
    expect(output).toContain("Auth system design");
    expect(output).toContain("abc1234567890");
  });

  it("returns empty-state list output", () => {
    expect(formatter.formatConversationList({ items: [], total: 0 })).toBe(
      "No conversations found.",
    );
  });

  it("infers export format from explicit flag or extension", () => {
    expect(formatter.inferExportFormat({ exportPath: "/tmp/chat.md" })).toBe("markdown");
    expect(formatter.inferExportFormat({ exportPath: "/tmp/chat.json" })).toBe("json");
    expect(formatter.inferExportFormat({ explicitFormat: "md" })).toBe("markdown");
  });
});

```

File: /Users/danielsivan/dev/surf-cli/test/unit/session-reconciler.test.ts
```ts
/**
 * Unit tests for native/session-reconciler.cjs
 *
 * Tests:
 *  - defaultPidIsAlive: invalid/dead/alive pids
 *  - inspectConversation: completed / no_new_assistant / in_progress / ambiguous
 *  - reconcileSessions: pid-alive skip / orphan local / recovered (network) / unresolved / poll_failed
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── helpers ──────────────────────────────────────────────────────────────────

type Reconciler = {
  defaultPidIsAlive: (pid: unknown) => boolean;
  isChatGptCloakSession: (meta: unknown) => boolean;
  resolveConversationId: (meta: unknown) => string | null;
  inspectConversation: (
    conv: unknown,
    meta?: unknown,
  ) => { outcome: string; nodeId: string | null };
  reconcileSessions: (opts?: Record<string, unknown>) => Promise<{
    reconciled: number;
    sessions: Array<{ meta: unknown; action: string; conversationId?: string }>;
  }>;
  MAX_RUNNING_AGE_MS: number;
};

// Load once; all functions read SURF_SESSIONS_DIR lazily so env changes are picked up per call
const reconciler = require("../../native/session-reconciler.cjs") as Reconciler;
function loadReconciler(): Reconciler {
  return reconciler;
}

function makeTmpSessionDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "surf-test-sessions-"));
}

function writeSessionMeta(dir: string, meta: Record<string, unknown>) {
  const sessionDir = path.join(dir, meta.id as string);
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, "meta.json"), JSON.stringify(meta, null, 2));
}

function readSessionMeta(dir: string, id: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(dir, id, "meta.json"), "utf8"));
}

function readSessionLog(dir: string, id: string): string {
  return fs.readFileSync(path.join(dir, id, "output.log"), "utf8");
}

// ── defaultPidIsAlive ────────────────────────────────────────────────────────

describe("defaultPidIsAlive", () => {
  it("returns false for null", () => {
    const { defaultPidIsAlive } = loadReconciler();
    expect(defaultPidIsAlive(null)).toBe(false);
  });

  it("returns false for 0", () => {
    const { defaultPidIsAlive } = loadReconciler();
    expect(defaultPidIsAlive(0)).toBe(false);
  });

  it("returns false for negative", () => {
    const { defaultPidIsAlive } = loadReconciler();
    expect(defaultPidIsAlive(-1)).toBe(false);
  });

  it("returns false for string", () => {
    const { defaultPidIsAlive } = loadReconciler();
    expect(defaultPidIsAlive("1234")).toBe(false);
  });

  it("returns false for dead PID (999999999)", () => {
    const { defaultPidIsAlive } = loadReconciler();
    expect(defaultPidIsAlive(999999999)).toBe(false);
  });

  it("returns true for current process PID", () => {
    const { defaultPidIsAlive } = loadReconciler();
    expect(defaultPidIsAlive(process.pid)).toBe(true);
  });
});

// ── inspectConversation ───────────────────────────────────────────────────────

describe("inspectConversation", () => {
  const { inspectConversation } = loadReconciler();

  it("returns ambiguous for null", () => {
    expect(inspectConversation(null)).toEqual({ outcome: "ambiguous", nodeId: null });
  });

  it("returns ambiguous when mapping missing", () => {
    expect(inspectConversation({ current_node: "n1" })).toEqual({
      outcome: "ambiguous",
      nodeId: "n1",
    });
  });

  it("returns ambiguous when current_node missing", () => {
    expect(inspectConversation({ mapping: { n1: {} } })).toEqual({
      outcome: "ambiguous",
      nodeId: null,
    });
  });

  // Regression: baseline comes from DOM data-message-id, not data-testid
  // Realistic test where DOM baseline (msg-abc) differs from API current_node (msg-xyz)
  it("returns completed when current_node differs from baseline (real-world scenario)", () => {
    const conv = {
      current_node: "msg-new-response",
      mapping: {
        "msg-old-assistant": {
          message: {
            status: "finished_successfully",
            author: { role: "assistant" },
            create_time: 1000,
          },
        },
        "msg-new-response": {
          message: {
            status: "finished_successfully",
            author: { role: "assistant" },
            create_time: 2000,
          },
        },
      },
    };
    // Baseline is the OLD assistant message from DOM
    const result = inspectConversation(conv, { baselineAssistantMessageId: "msg-old-assistant" });
    expect(result.outcome).toBe("completed"); // new response is completed
    expect(result.nodeId).toBe("msg-new-response");
  });

  it("returns completed when last node is finished_successfully assistant", () => {
    const conv = {
      current_node: "n1",
      mapping: {
        n1: {
          message: {
            status: "finished_successfully",
            author: { role: "assistant" },
          },
        },
      },
    };
    const result = inspectConversation(conv);
    expect(result.outcome).toBe("completed");
    expect(result.nodeId).toBe("n1");
  });

  it("returns no_new_assistant when node is same as baseline", () => {
    const conv = {
      current_node: "n1",
      mapping: {
        n1: {
          message: {
            status: "finished_successfully",
            author: { role: "assistant" },
          },
        },
      },
    };
    const result = inspectConversation(conv, { baselineAssistantMessageId: "n1" });
    expect(result.outcome).toBe("no_new_assistant");
  });

  it("returns in_progress when last node is user role", () => {
    const conv = {
      current_node: "n1",
      mapping: {
        n1: {
          message: { status: "finished_successfully", author: { role: "user" } },
        },
      },
    };
    expect(inspectConversation(conv).outcome).toBe("in_progress");
  });

  it("returns in_progress when status is in_progress", () => {
    const conv = {
      current_node: "n1",
      mapping: {
        n1: {
          message: { status: "in_progress", author: { role: "assistant" } },
        },
      },
    };
    expect(inspectConversation(conv).outcome).toBe("in_progress");
  });

  it("returns ambiguous for unknown status", () => {
    const conv = {
      current_node: "n1",
      mapping: {
        n1: { message: { status: "unknown_status", author: { role: "assistant" } } },
      },
    };
    expect(inspectConversation(conv).outcome).toBe("ambiguous");
  });
});

// ── reconcileSessions ─────────────────────────────────────────────────────────

describe("reconcileSessions", () => {
  let tmpDir: string;
  const origEnv = process.env.SURF_SESSIONS_DIR;

  beforeEach(() => {
    tmpDir = makeTmpSessionDir();
    process.env.SURF_SESSIONS_DIR = tmpDir;
  });

  afterEach(() => {
    if (origEnv === undefined) {
      process.env.SURF_SESSIONS_DIR = undefined as unknown as string;
    } else {
      process.env.SURF_SESSIONS_DIR = origEnv;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns reconciled=0 when no running sessions", async () => {
    const r = loadReconciler();
    writeSessionMeta(tmpDir, {
      id: "chatgpt-done",
      tool: "chatgpt",
      status: "completed",
      createdAt: new Date().toISOString(),
      pid: process.pid,
    });

    const { reconciled } = await r.reconcileSessions({ all: true });
    expect(reconciled).toBe(0);
  });

  it("skips session whose pid is alive and not too old", async () => {
    const r = loadReconciler();
    writeSessionMeta(tmpDir, {
      id: "chatgpt-alive",
      tool: "chatgpt",
      status: "running",
      createdAt: new Date().toISOString(), // recent
      pid: process.pid, // alive
    });

    const { reconciled, sessions } = await r.reconcileSessions({ all: true });
    expect(reconciled).toBe(0);
    expect(sessions[0].action).toBe("none");

    // meta.json unchanged
    const meta = readSessionMeta(tmpDir, "chatgpt-alive");
    expect(meta.status).toBe("running");
  });

  it("marks orphaned when pid is dead", async () => {
    const r = loadReconciler();
    writeSessionMeta(tmpDir, {
      id: "chatgpt-dead",
      tool: "chatgpt",
      status: "running",
      createdAt: new Date(Date.now() - 10_000).toISOString(),
      pid: 999999999, // dead
    });

    const { reconciled, sessions } = await r.reconcileSessions({ all: true });
    expect(reconciled).toBe(1);
    expect(sessions[0].action).toBe("orphaned");

    const meta = readSessionMeta(tmpDir, "chatgpt-dead") as any;
    expect(meta.status).toBe("error");
    expect(meta.error.code).toBe("session_orphaned");
    expect(meta.reconcile.pidAlive).toBe(false);
    expect(meta.reconcile.state).toBe("orphaned");
  });

  it("annotates as stale when session is old but pid still alive (never orphans)", async () => {
    const r = loadReconciler();
    const oldDate = new Date(Date.now() - r.MAX_RUNNING_AGE_MS - 60_000).toISOString();
    writeSessionMeta(tmpDir, {
      id: "chatgpt-old",
      tool: "chatgpt",
      status: "running",
      createdAt: oldDate,
      pid: process.pid, // alive but too old
    });

    const { reconciled, sessions } = await r.reconcileSessions({ all: true });
    expect(reconciled).toBe(1); // stale is counted as reconciled
    expect(sessions[0].action).toBe("stale");

    const meta = readSessionMeta(tmpDir, "chatgpt-old") as any;
    expect(meta.status).toBe("running"); // NOT changed to error
    expect(meta.reconcile.state).toBe("stale");
    expect(meta.reconcile.pidAlive).toBe(true);
  });

  it("recovers dead session with sent checkpoint + conversationId", async () => {
    const r = loadReconciler();
    writeSessionMeta(tmpDir, {
      id: "chatgpt-recoverable",
      tool: "chatgpt",
      status: "running",
      createdAt: new Date(Date.now() - 10_000).toISOString(),
      pid: 999999999,
      conversationId: "conv-abc123",
      baselineAssistantMessageId: null,
      lastCheckpoint: "sent",
      sentAt: "2026-04-05T12:00:00.000Z",
    });

    const completedConv = {
      current_node: "new-node",
      mapping: {
        "new-node": {
          message: {
            status: "finished_successfully",
            author: { role: "assistant" },
            content: { parts: ["Recovered answer line 1\n\nRecovered answer line 2"] },
            metadata: { model_slug: "gpt-5.4-pro" },
          },
        },
      },
      title: "Recovered conversation",
    };

    const mockManageChats = vi.fn().mockResolvedValue({ conversation: completedConv });

    const { reconciled, sessions } = await r.reconcileSessions({
      all: true,
      pollNetwork: true,
      manageChats: mockManageChats,
    });

    expect(reconciled).toBe(1);
    expect(sessions[0].action).toBe("recovered");
    expect(sessions[0].conversationId).toBe("conv-abc123");

    const meta = readSessionMeta(tmpDir, "chatgpt-recoverable") as any;
    expect(meta.status).toBe("completed");
    expect(meta.reconcile.state).toBe("recovered");
    expect(meta.result.reconciled).toBe(true);
    expect(meta.result.recovered).toBe(true);
    expect(meta.result.model).toBe("gpt-5.4-pro");
    expect(meta.result.responsePreview).toContain("Recovered answer line 1");
    expect(meta.result.responsePath).toContain("response.md");
    expect(meta.result.responseChars).toBeGreaterThan(0);
    expect(meta.result.inlineResponse).toBeUndefined();
    expect(meta.result.inlineResponseChars).toBeUndefined();
    expect(meta.result.recoveredResponse).toBeUndefined();
    const log = readSessionLog(tmpDir, "chatgpt-recoverable");
    expect(log).toContain("response saved:");
    expect(log).not.toContain("Recovered answer line 1");
    expect(mockManageChats).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "get",
        conversationId: "conv-abc123",
        waitForAssistant: true,
        waitForAssistantTimeoutSec: 30,
        baselineAssistantMessageId: null,
      }),
    );
  });

  it("keeps long recovered responses in the artifact instead of meta/log", async () => {
    const r = loadReconciler();
    writeSessionMeta(tmpDir, {
      id: "chatgpt-recover-truncated",
      tool: "chatgpt",
      status: "running",
      createdAt: new Date(Date.now() - 10_000).toISOString(),
      pid: 999999999,
      conversationId: "conv-truncated",
      baselineAssistantMessageId: null,
      lastCheckpoint: "sent",
      sentAt: "2026-04-05T12:00:00.000Z",
    });

    const longReply = "A".repeat(13005);
    const completedConv = {
      current_node: "long-node",
      mapping: {
        "long-node": {
          message: {
            status: "finished_successfully",
            author: { role: "assistant" },
            content: { parts: [longReply] },
          },
        },
      },
    };

    const mockManageChats = vi.fn().mockResolvedValue({ conversation: completedConv });
    await r.reconcileSessions({ all: true, pollNetwork: true, manageChats: mockManageChats });

    const meta = readSessionMeta(tmpDir, "chatgpt-recover-truncated") as any;
    expect(meta.result.responsePath).toContain("response.md");
    expect(meta.result.responseChars).toBe(13005);
    expect(meta.result.inlineResponse).toBeUndefined();
    expect(meta.result.inlineResponseTruncated).toBeUndefined();
    expect(meta.result.inlineResponseChars).toBeUndefined();
    expect(meta.result.recoveredResponse).toBeUndefined();
    expect(fs.readFileSync(meta.result.responsePath, "utf8")).toBe(longReply);

    const log = readSessionLog(tmpDir, "chatgpt-recover-truncated");
    expect(log).toContain("response saved:");
    expect(log).not.toContain(longReply);
  });

  it("falls back to meta storage when the response artifact cannot be written", async () => {
    const r = loadReconciler();
    writeSessionMeta(tmpDir, {
      id: "chatgpt-recover-fallback",
      tool: "chatgpt",
      status: "running",
      createdAt: new Date(Date.now() - 10_000).toISOString(),
      pid: 999999999,
      conversationId: "conv-fallback",
      baselineAssistantMessageId: null,
      lastCheckpoint: "sent",
      sentAt: "2026-04-05T12:00:00.000Z",
    });
    fs.mkdirSync(path.join(tmpDir, "chatgpt-recover-fallback", "response.md"));

    const recoveredReply = "Recovered via fallback storage.";
    const completedConv = {
      current_node: "fallback-node",
      mapping: {
        "fallback-node": {
          message: {
            status: "finished_successfully",
            author: { role: "assistant" },
            content: { parts: [recoveredReply] },
          },
        },
      },
    };

    const mockManageChats = vi.fn().mockResolvedValue({ conversation: completedConv });
    await r.reconcileSessions({ all: true, pollNetwork: true, manageChats: mockManageChats });

    const meta = readSessionMeta(tmpDir, "chatgpt-recover-fallback") as any;
    expect(meta.result.responsePath).toBe(null);
    expect(meta.result.responseChars).toBe(0);
    expect(meta.result.inlineResponse).toBe(recoveredReply);
    expect(meta.result.inlineResponseTruncated).toBe(false);
    expect(meta.result.inlineResponseChars).toBe(recoveredReply.length);
    expect(meta.result.recoveredResponse).toBeUndefined();

    const log = readSessionLog(tmpDir, "chatgpt-recover-fallback");
    expect(log).toContain("stored in inline fallback");
    expect(log).not.toContain(recoveredReply);
  });

  it("does not hydrate stale older assistant text when recovered node has no text", async () => {
    const r = loadReconciler();
    writeSessionMeta(tmpDir, {
      id: "chatgpt-recover-empty-current",
      tool: "chatgpt",
      status: "running",
      createdAt: new Date(Date.now() - 10_000).toISOString(),
      pid: 999999999,
      conversationId: "conv-empty-current",
      baselineAssistantMessageId: "old-node",
      lastCheckpoint: "sent",
      sentAt: "2026-04-05T12:00:00.000Z",
    });

    const completedConv = {
      current_node: "new-node",
      mapping: {
        "old-node": {
          id: "old-node",
          parent: null,
          children: ["new-node"],
          message: {
            status: "finished_successfully",
            author: { role: "assistant" },
            content: { parts: ["Older assistant reply"] },
          },
        },
        "new-node": {
          id: "new-node",
          parent: "old-node",
          children: [],
          message: {
            status: "finished_successfully",
            author: { role: "assistant" },
            content: { parts: [] },
          },
        },
      },
    };

    const mockManageChats = vi.fn().mockResolvedValue({ conversation: completedConv });
    await r.reconcileSessions({ all: true, pollNetwork: true, manageChats: mockManageChats });

    const meta = readSessionMeta(tmpDir, "chatgpt-recover-empty-current") as any;
    expect(meta.status).toBe("completed");
    expect(meta.result.recovered).toBe(true);
    expect(meta.result.responsePreview).toBe(null);
    expect(meta.result.responsePath).toBe(null);
    expect(meta.result.responseChars).toBe(0);
    expect(meta.result.inlineResponse).toBeUndefined();
    expect(meta.result.inlineResponseChars).toBeUndefined();
    expect(meta.result.recoveredResponse).toBeUndefined();

    const log = readSessionLog(tmpDir, "chatgpt-recover-empty-current");
    expect(log).toContain("recovered remote reply from conversation conv-empty-current");
    expect(log).not.toContain("Older assistant reply");
  });

  it("recovers legacy dead session with conversationId but no checkpoint metadata", async () => {
    const r = loadReconciler();
    writeSessionMeta(tmpDir, {
      id: "chatgpt-legacy-recoverable",
      tool: "chatgpt",
      status: "running",
      createdAt: new Date(Date.now() - 10_000).toISOString(),
      pid: 999999999,
      conversationId: "conv-legacy",
      baselineAssistantMessageId: null,
    });

    const completedConv = {
      current_node: "legacy-node",
      mapping: {
        "legacy-node": {
          message: {
            status: "finished_successfully",
            author: { role: "assistant" },
          },
        },
      },
    };

    const mockManageChats = vi.fn().mockResolvedValue({ conversation: completedConv });

    const { reconciled, sessions } = await r.reconcileSessions({
      all: true,
      pollNetwork: true,
      manageChats: mockManageChats,
    });

    expect(reconciled).toBe(1);
    expect(sessions[0].action).toBe("recovered");
    expect(mockManageChats).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "get",
        conversationId: "conv-legacy",
        waitForAssistant: true,
        waitForAssistantTimeoutSec: 30,
        baselineAssistantMessageId: null,
      }),
    );

    const meta = readSessionMeta(tmpDir, "chatgpt-legacy-recoverable") as any;
    expect(meta.status).toBe("completed");
    expect(meta.reconcile.state).toBe("recovered");
  });

  it("marks orphaned when dead session has conversationId but no sent checkpoint", async () => {
    const r = loadReconciler();
    writeSessionMeta(tmpDir, {
      id: "chatgpt-nosent",
      tool: "chatgpt",
      status: "running",
      createdAt: new Date(Date.now() - 5_000).toISOString(),
      pid: 999999999,
      conversationId: "conv-nosent",
      baselineAssistantMessageId: null,
      lastCheckpoint: "created",
      sentAt: null,
    });

    const mockManageChats = vi.fn();

    const { sessions } = await r.reconcileSessions({
      all: true,
      pollNetwork: true,
      manageChats: mockManageChats,
    });

    expect(sessions[0].action).toBe("orphaned");
    expect(mockManageChats).not.toHaveBeenCalled();

    const meta = readSessionMeta(tmpDir, "chatgpt-nosent") as any;
    expect(meta.status).toBe("error");
    expect(meta.error.code).toBe("session_orphaned");
  });

  it("marks unresolved when conversation still in_progress", async () => {
    const r = loadReconciler();
    writeSessionMeta(tmpDir, {
      id: "chatgpt-inprogress",
      tool: "chatgpt",
      status: "running",
      createdAt: new Date(Date.now() - 5_000).toISOString(),
      pid: 999999999,
      conversationId: "conv-inprog",
      lastCheckpoint: "sent",
      sentAt: "2026-04-05T12:01:00.000Z",
    });

    const inProgressConv = {
      current_node: "n1",
      mapping: {
        n1: { message: { status: "in_progress", author: { role: "assistant" } } },
      },
    };

    const mockManageChats = vi.fn().mockResolvedValue({ conversation: inProgressConv });

    const { sessions } = await r.reconcileSessions({
      all: true,
      pollNetwork: true,
      manageChats: mockManageChats,
    });

    expect(sessions[0].action).toBe("unresolved");
    const meta = readSessionMeta(tmpDir, "chatgpt-inprogress") as any;
    expect(meta.status).toBe("running"); // not changed
    expect(meta.reconcile.state).toBe("unresolved");
  });

  it("marks unresolved when the remote current node is still the user turn", async () => {
    const r = loadReconciler();
    writeSessionMeta(tmpDir, {
      id: "chatgpt-awaiting-assistant",
      tool: "chatgpt",
      status: "running",
      createdAt: new Date(Date.now() - 5_000).toISOString(),
      pid: 999999999,
      conversationId: "conv-awaiting",
      baselineAssistantMessageId: "old-assistant",
      lastCheckpoint: "sent",
      sentAt: "2026-04-05T12:01:00.000Z",
    });

    const awaitingAssistantConv = {
      current_node: "u1",
      mapping: {
        u1: {
          message: { status: "finished_successfully", author: { role: "user" }, content: { parts: ["still waiting"] } },
        },
      },
    };

    const mockManageChats = vi.fn().mockResolvedValue({ conversation: awaitingAssistantConv });

    const { sessions } = await r.reconcileSessions({
      all: true,
      pollNetwork: true,
      manageChats: mockManageChats,
    });

    expect(sessions[0].action).toBe("unresolved");
    expect(mockManageChats).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "get",
        conversationId: "conv-awaiting",
        waitForAssistant: true,
        waitForAssistantTimeoutSec: 30,
        baselineAssistantMessageId: "old-assistant",
      }),
    );

    const meta = readSessionMeta(tmpDir, "chatgpt-awaiting-assistant") as any;
    expect(meta.status).toBe("running");
    expect(meta.reconcile.state).toBe("unresolved");
    expect(meta.reconcile.remote.outcome).toBe("in_progress");
  });

  it("handles poll failure gracefully — marks orphaned", async () => {
    const r = loadReconciler();
    writeSessionMeta(tmpDir, {
      id: "chatgpt-pollfail",
      tool: "chatgpt",
      status: "running",
      createdAt: new Date(Date.now() - 5_000).toISOString(),
      pid: 999999999,
      conversationId: "conv-pollfail",
      lastCheckpoint: "sent",
      sentAt: "2026-04-05T12:02:00.000Z",
    });

    const mockManageChats = vi.fn().mockRejectedValue(new Error("login_required"));

    const { sessions } = await r.reconcileSessions({
      all: true,
      pollNetwork: true,
      manageChats: mockManageChats,
    });

    expect(sessions[0].action).toBe("orphaned");
    const meta = readSessionMeta(tmpDir, "chatgpt-pollfail") as any;
    expect(meta.status).toBe("error");
    expect(meta.reconcile.remote.outcome).toBe("poll_failed");
    expect(meta.reconcile.remote.error).toBe("login_required");
  });

  it("marks orphaned when dead session has sent checkpoint but no conversationId", async () => {
    const r = loadReconciler();
    writeSessionMeta(tmpDir, {
      id: "chatgpt-noconv",
      tool: "chatgpt",
      status: "running",
      createdAt: new Date(Date.now() - 5_000).toISOString(),
      pid: 999999999,
      conversationId: null,
      lastCheckpoint: "sent",
      sentAt: "2026-04-05T12:03:00.000Z",
    });

    const mockManageChats = vi.fn();

    const { sessions } = await r.reconcileSessions({
      all: true,
      pollNetwork: true,
      manageChats: mockManageChats,
    });

    expect(sessions[0].action).toBe("orphaned");
    expect(mockManageChats).not.toHaveBeenCalled();
  });
});

```

File: /Users/danielsivan/dev/surf-cli/native/chatgpt-chats-formatter.cjs
```cjs
"use strict";

function toEpochMs(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value > 1e12 ? value : value * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

function formatListTimestamp(value) {
  const ms = toEpochMs(value);
  if (!ms) return "-";
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${min}`;
}

function formatMessageTimestamp(value) {
  const ms = toEpochMs(value);
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatHeaderDate(value) {
  const ms = toEpochMs(value);
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function truncate(text, max) {
  const value = String(text ?? "");
  if (value.length <= max) return value;
  if (max <= 1) return value.slice(0, max);
  return `${value.slice(0, max - 1)}…`;
}

function normalizeConversationItems(raw) {
  const source = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.items)
      ? raw.items
      : Array.isArray(raw?.conversations)
        ? raw.conversations
        : [];

  return source
    .filter(Boolean)
    .map((item) => {
      const updatedAt = item.update_time ?? item.updateTime ?? item.create_time ?? item.createTime ?? null;
      const createdAt = item.create_time ?? item.createTime ?? updatedAt ?? null;
      return {
        ...item,
        id: item.id ?? item.conversation_id ?? item.conversationId ?? "",
        title: item.title || "(untitled)",
        create_time: createdAt,
        update_time: updatedAt,
      };
    })
    .filter((item) => item.id)
    .sort((a, b) => (toEpochMs(b.update_time) || 0) - (toEpochMs(a.update_time) || 0));
}

function extractMessageText(message) {
  const content = message?.content;
  if (!content) return "";

  if (Array.isArray(content.parts)) {
    return content.parts
      .flatMap((part) => {
        if (typeof part === "string") return [part];
        if (part && typeof part.text === "string") return [part.text];
        return [];
      })
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }

  if (typeof content.text === "string") return content.text.trim();
  return "";
}

function getRootNodeIds(mapping) {
  return Object.values(mapping)
    .filter((node) => node && (!node.parent || !mapping[node.parent]))
    .map((node) => node.id)
    .filter(Boolean)
    .sort();
}

/**
 * Build the active linear path from root → current_node.
 * Returns null if current_node is missing or can't be traced to a root.
 */
function buildActivePathIds(mapping, currentNode) {
  if (!currentNode || !mapping[currentNode]) return null;
  const chain = [];
  let nodeId = currentNode;
  while (nodeId && mapping[nodeId]) {
    chain.push(nodeId);
    nodeId = mapping[nodeId].parent;
  }
  chain.reverse(); // root → leaf
  return chain;
}

/**
 * Extract a message record from a mapping node, or null if not renderable.
 */
function nodeToMessage(node) {
  if (!node) return null;
  const msg = node.message;
  const role = msg?.author?.role;
  const text = extractMessageText(msg);
  if (!role || role === "system" || msg?.metadata?.is_hidden || !text) return null;
  return {
    id: node.id,
    role,
    text,
    time: msg.create_time ?? node.create_time ?? null,
    model: msg.metadata?.model_slug || null,
    parent: node.parent || null,
    children: Array.isArray(node.children) ? node.children.slice() : [],
  };
}

/**
 * Walk the conversation tree.
 *
 * Default (mode="active"): follows the linear path root → current_node,
 * producing a clean transcript without abandoned/regenerated branches.
 *
 * mode="full": DFS over all branches (legacy behavior).
 *
 * Falls back to "full" when current_node is absent or unreachable.
 */
function walkConversationMessages(conversation, options = {}) {
  const mapping = conversation?.mapping || {};
  const mode = options.mode || "active";
  const currentNode = conversation?.current_node;

  // Active-path walk: linear, no branches
  if (mode === "active") {
    const activePath = buildActivePathIds(mapping, currentNode);
    if (activePath) {
      const messages = [];
      for (const nodeId of activePath) {
        const msg = nodeToMessage(mapping[nodeId]);
        if (msg) messages.push(msg);
      }
      return messages;
    }
    // current_node missing / unreachable → fall through to full DFS
  }

  // Full DFS walk (all branches, sorted by id)
  const seen = new Set();
  const messages = [];

  const visit = (nodeId) => {
    if (!nodeId || seen.has(nodeId)) return;
    seen.add(nodeId);
    const node = mapping[nodeId];
    if (!node) return;

    const msg = nodeToMessage(node);
    if (msg) messages.push(msg);

    const children = Array.isArray(node.children) ? node.children.slice().sort() : [];
    for (const childId of children) visit(childId);
  };

  for (const rootId of getRootNodeIds(mapping)) visit(rootId);
  return messages;
}

function summarizeConversation(conversation, options = {}) {
  const messageLimit = Number.isFinite(Number(options.messageLimit))
    ? Math.max(1, Math.trunc(Number(options.messageLimit)))
    : null;
  const messages = walkConversationMessages(conversation);
  const visibleMessages = messageLimit ? messages.slice(-messageLimit) : messages;
  const lastAssistant = [...visibleMessages].reverse().find((m) => m.role === "assistant");

  return {
    title: conversation?.title || "(untitled)",
    create_time: conversation?.create_time ?? visibleMessages[0]?.time ?? null,
    current_node: conversation?.current_node ?? null,
    messages: visibleMessages,
    totalMessages: messages.length,
    model: lastAssistant?.model || null,
  };
}

function formatConversationList({ items, total, label } = {}) {
  const normalized = normalizeConversationItems(items);
  if (normalized.length === 0) return "No conversations found.";

  const shown = normalized.length;
  const totalCount = Number.isFinite(Number(total)) ? Number(total) : shown;
  const heading = label || "ChatGPT Conversations";
  const lines = [`${heading} (${shown} of ${totalCount})`, "", `  ${"UPDATED".padEnd(16)} ${"TITLE".padEnd(40)} ID`, `  ${"─".repeat(16)} ${"─".repeat(40)} ${"─".repeat(18)}`];

  for (const item of normalized) {
    const updated = formatListTimestamp(item.update_time);
    const title = truncate(item.title || "(untitled)", 40);
    const id = truncate(item.id, 18);
    lines.push(`  ${updated.padEnd(16)} ${title.padEnd(40)} ${id}`);
  }

  return lines.join("\n");
}

function formatConversationMarkdown({ conversation, messageLimit } = {}) {
  const summary = summarizeConversation(conversation, { messageLimit });
  const meta = [formatHeaderDate(summary.create_time), summary.model, `${summary.totalMessages} messages`].filter(Boolean);
  const lines = [`# ${summary.title}`];
  if (meta.length > 0) lines.push(`_${meta.join(" | ")}_`);
  lines.push("", "---", "");

  for (const message of summary.messages) {
    const who = message.role === "user" ? "You" : message.role === "assistant" ? "ChatGPT" : message.role;
    const ts = formatMessageTimestamp(message.time);
    lines.push(`### ${who}${ts ? ` · ${ts}` : ""}`, "", message.text, "", "---", "");
  }

  if (summary.messages.length === 0) {
    lines.push("_No visible messages found._", "");
  }

  return lines.join("\n").trimEnd() + "\n";
}

function inferExportFormat({ exportPath, explicitFormat } = {}) {
  const fmt = explicitFormat ? String(explicitFormat).toLowerCase() : "";
  if (fmt === "md") return "markdown";
  if (fmt === "markdown" || fmt === "json") return fmt;
  if (exportPath && String(exportPath).toLowerCase().endsWith(".json")) return "json";
  return "markdown";
}

module.exports = {
  extractMessageText,
  formatConversationList,
  formatConversationMarkdown,
  inferExportFormat,
  normalizeConversationItems,
  summarizeConversation,
  walkConversationMessages,
};

```

File: /Users/danielsivan/dev/surf-cli/native/chatgpt-cloak-prompt-entry.cjs
```cjs
const { Buffer } = require("buffer");

const DEFAULT_THRESHOLDS = {
  settleMs: 700,
  sendReadyTimeoutMs: 2500,
  sendReadyPollMs: 100,
  nativeInsertChunkBytes: 8 * 1024,
  nativeInsertYieldMs: 10,
  nativeInsertTimeoutMs: 120_000,
  nativeInsertTimeoutPerKBMs: 600,
  fillFallbackPreferredMinBytes: 256 * 1024,
  // Prompts >= this byte size attempt ProseMirror direct replacement instead of keyboardInsertText
  proseMirrorReplaceMinBytes: 8 * 1024,
  minSuccessRatio: 0.95,
  allowedDeltaChars: 2,
};

const EDITABLE_SELECTOR = 'textarea, input, [contenteditable="true"], .ProseMirror';

function normalizeForLengthComparison(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n+$/, "");
}

function byteLength(text) {
  return Buffer.byteLength(String(text || ""), "utf8");
}

function splitUtf8Chunks(text, chunkBytes = DEFAULT_THRESHOLDS.nativeInsertChunkBytes) {
  const chunks = [];
  let current = "";
  let currentBytes = 0;

  for (const char of String(text || "")) {
    const charBytes = byteLength(char);
    if (current && currentBytes + charBytes > chunkBytes) {
      chunks.push({ text: current, bytes: currentBytes, chars: current.length, index: chunks.length });
      current = char;
      currentBytes = charBytes;
    } else {
      current += char;
      currentBytes += charBytes;
    }
  }

  if (current || chunks.length === 0) {
    chunks.push({ text: current, bytes: currentBytes, chars: current.length, index: chunks.length });
  }

  return chunks;
}

function splitNativeInsertChunks(text, chunkBytes = DEFAULT_THRESHOLDS.nativeInsertChunkBytes) {
  return splitUtf8Chunks(text, chunkBytes).map((chunk) => chunk.text);
}

async function readComposerState(page, promptSelector, sendButtonSelectors = []) {
  return await page.evaluate(({ promptSelector, sendButtonSelectors, editableSelector }) => {
    const resolveEditable = (selector) => {
      const selectors = String(selector || "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      for (const candidate of selectors) {
        const root = document.querySelector(candidate);
        if (!root) continue;
        if (typeof root.matches === "function" && root.matches(editableSelector)) return root;
        if (typeof root.querySelector === "function") {
          const nested = root.querySelector(editableSelector);
          if (nested) return nested;
        }
      }
      return null;
    };

    const el = resolveEditable(promptSelector);
    const readProseMirrorText = (node) => {
      if (!node || !node.classList || !node.classList.contains("ProseMirror")) return null;
      const blocks = Array.from(node.children || []);
      if (blocks.length === 0) return node.textContent || "";
      return blocks.map((block) => {
        const text = block.textContent || "";
        if (text) return text;
        const trailingBreak = block.querySelector && block.querySelector("br.ProseMirror-trailingBreak");
        return trailingBreak ? "" : text;
      }).join("\n");
    };

    const rawValue = el && typeof el.value === "string" ? el.value : "";
    const rawInnerText = el && typeof el.innerText === "string" ? el.innerText : "";
    const rawTextContent = el ? (el.textContent || "") : "";
    const rawProseMirrorText = readProseMirrorText(el);
    const actualText = rawValue || rawProseMirrorText || rawInnerText || rawTextContent || "";

    let sendEnabled = false;
    let sendButtonFound = false;
    for (const selector of sendButtonSelectors || []) {
      const buttons = Array.from(document.querySelectorAll(selector));
      for (const btn of buttons) {
        sendButtonFound = true;
        const disabled = btn.hasAttribute("disabled")
          || btn.getAttribute("aria-disabled") === "true"
          || btn.getAttribute("data-disabled") === "true";
        if (!disabled) {
          sendEnabled = true;
          break;
        }
      }
      if (sendEnabled) break;
    }

    return {
      actualText,
      actualChars: actualText.length,
      rawLengths: {
        value: rawValue.length,
        textContent: rawTextContent.length,
        innerText: rawInnerText.length,
      },
      sendEnabled,
      sendButtonFound,
      sendState: sendEnabled ? "enabled" : (sendButtonFound ? "disabled" : "unknown"),
    };
  }, { promptSelector, sendButtonSelectors, editableSelector: EDITABLE_SELECTOR });
}

async function clearComposer(page, promptSelector) {
  return await page.evaluate(({ selector, editableSelector }) => {
    const resolveEditable = (promptRootSelector) => {
      const selectors = String(promptRootSelector || "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      for (const candidate of selectors) {
        const root = document.querySelector(candidate);
        if (!root) continue;
        if (typeof root.matches === "function" && root.matches(editableSelector)) return root;
        if (typeof root.querySelector === "function") {
          const nested = root.querySelector(editableSelector);
          if (nested) return nested;
        }
      }
      return null;
    };

    const el = resolveEditable(selector);
    if (!el) return false;
    if (typeof el.focus === "function") el.focus();

    try {
      if (typeof InputEvent !== "undefined") {
        el.dispatchEvent(new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          data: "",
          inputType: "deleteContentBackward",
        }));
      }
    } catch {}

    if (typeof el.value === "string") {
      const proto = Object.getPrototypeOf(el);
      const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, "value") : null;
      if (descriptor && typeof descriptor.set === "function") descriptor.set.call(el, "");
      else el.value = "";
      if (typeof el.setSelectionRange === "function") {
        try { el.setSelectionRange(0, 0); } catch {}
      }
    }

    if (el.isContentEditable || el.getAttribute("contenteditable") === "true" || el.classList?.contains("ProseMirror")) {
      el.innerHTML = '<p><br class="ProseMirror-trailingBreak"></p>';
      const selection = typeof window.getSelection === "function" ? window.getSelection() : null;
      if (selection && typeof document.createRange === "function") {
        try {
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        } catch {}
      }
    }

    if (typeof InputEvent !== "undefined") {
      el.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: "",
        inputType: "deleteContentBackward",
      }));
    } else {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, { selector: promptSelector, editableSelector: EDITABLE_SELECTOR });
}

/**
 * Attempt to replace the ProseMirror composer content via a direct EditorView transaction.
 *
 * Returns a result object:
 *   { applied: true, composerKind: "prosemirror", viewResolutionMethod, paragraphCount }
 *   { applied: false, composerKind, fallbackSafe: true, fallbackReason }
 */
async function tryReplaceViaProseMirror(page, promptSelector, prompt, { log } = {}) {
  const logf = typeof log === "function" ? log : () => {};

  const result = await page.evaluate(
    ({ promptSelector: sel, prompt: text, editableSelector }) => {
      const resolveEditable = (selector) => {
        const parts = String(selector || "").split(",").map((s) => s.trim()).filter(Boolean);
        for (const candidate of parts) {
          const root = document.querySelector(candidate);
          if (!root) continue;
          if (typeof root.matches === "function" && root.matches(editableSelector)) return root;
          if (typeof root.querySelector === "function") {
            const nested = root.querySelector(editableSelector);
            if (nested) return nested;
          }
        }
        return null;
      };

      const el = resolveEditable(sel);
      if (!el) return { applied: false, fallbackSafe: true, composerKind: "unknown", fallbackReason: "not_prosemirror" };

      const isPM = el.classList && el.classList.contains("ProseMirror");
      if (!isPM) {
        const kind = typeof el.value === "string" ? (el.tagName === "TEXTAREA" ? "textarea" : "input") : "contenteditable";
        return { applied: false, fallbackSafe: true, composerKind: kind, fallbackReason: "not_prosemirror" };
      }

      let view = null;
      let viewResolutionMethod = null;

      if (el.pmViewDesc && el.pmViewDesc.view && typeof el.pmViewDesc.view.dispatch === "function") {
        view = el.pmViewDesc.view;
        viewResolutionMethod = "pmViewDesc";
      }

      if (!view) {
        const isValidView = (candidate) =>
          candidate
          && typeof candidate === "object"
          && candidate.state
          && candidate.state.doc
          && typeof candidate.dispatch === "function"
          && candidate.dom
          && candidate.state.schema;

        const targets = [el];
        let node = el.parentElement;
        for (let i = 0; i < 5 && node; i += 1, node = node.parentElement) targets.push(node);

        outer: for (const target of targets) {
          for (const key of Object.keys(target)) {
            if (key.startsWith("__reactFiber") || key.startsWith("__reactProps")) continue;
            try {
              const candidate = target[key];
              if (isValidView(candidate) && (candidate.dom === el || el.contains(candidate.dom) || candidate.dom.contains(el))) {
                view = candidate;
                viewResolutionMethod = "property_scan";
                break outer;
              }
            } catch {}
          }
        }
      }

      if (!view) {
        return { applied: false, fallbackSafe: true, composerKind: "prosemirror", fallbackReason: "view_not_found" };
      }

      const schema = view.state.schema;
      if (!schema || !schema.nodes || !schema.nodes.paragraph || !schema.nodes.text) {
        return { applied: false, fallbackSafe: true, composerKind: "prosemirror", fallbackReason: "unsupported_schema" };
      }

      const lines = text.split(/\r\n|\r|\n/);
      const paragraphs = lines.map((line) => {
        if (line.length === 0) return schema.nodes.paragraph.create();
        return schema.nodes.paragraph.create(null, [schema.text(line)]);
      });

      const state = view.state;
      const tr = state.tr.replaceWith(0, state.doc.content.size, paragraphs);
      tr.scrollIntoView();
      view.dispatch(tr);

      if (typeof view.focus === "function") view.focus();
      view.dom.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
      view.dom.dispatchEvent(new Event("change", { bubbles: true }));

      return {
        applied: true,
        composerKind: "prosemirror",
        viewResolutionMethod,
        paragraphCount: paragraphs.length,
      };
    },
    { promptSelector, prompt, editableSelector: EDITABLE_SELECTOR },
  );

  if (result.applied) {
    logf("info", `ProseMirror replace applied: ${result.paragraphCount} paragraphs via ${result.viewResolutionMethod}`);
  } else {
    logf("info", `ProseMirror replace skipped (fallbackSafe=${result.fallbackSafe}): composerKind=${result.composerKind}, reason=${result.fallbackReason}`);
  }

  return result;
}

function resolveNativeInsertText(page) {
  if (page?.keyboard && typeof page.keyboard.insertText === "function") {
    return (text) => page.keyboard.insertText(text);
  }
  if (page?._original && typeof page._original.keyboardInsertText === "function") {
    return (text) => page._original.keyboardInsertText(text);
  }
  return null;
}

function resolveNativeInsertTimeoutMs(text, thresholds = DEFAULT_THRESHOLDS) {
  const bytes = byteLength(text);
  const perKB = thresholds?.nativeInsertTimeoutPerKBMs || DEFAULT_THRESHOLDS.nativeInsertTimeoutPerKBMs;
  const baseTimeout = thresholds?.nativeInsertTimeoutMs || DEFAULT_THRESHOLDS.nativeInsertTimeoutMs;
  return Math.max(baseTimeout, Math.ceil(bytes / 1024) * perKB);
}

async function insertViaNativeInsertText(page, prompt, { log, thresholds, methodName = "native_insert_text" } = {}) {
  const insertText = resolveNativeInsertText(page);
  if (!insertText) {
    throw makeInsertionError("prompt_insertion_failed", "Native keyboardInsertText unavailable", {
      method: methodName,
      failureReason: "native_insert_text_unavailable",
    });
  }

  const logf = typeof log === "function" ? log : () => {};
  const startedAt = Date.now();
  const timeoutMs = resolveNativeInsertTimeoutMs(prompt, thresholds);
  let timeoutId = null;
  try {
    await Promise.race([
      insertText(prompt),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(makeInsertionError("prompt_insertion_failed", `Native keyboardInsertText timed out for ${methodName}`, {
            method: methodName,
            failureReason: "native_insert_text_timeout",
            chunkCount: 1,
            chunkChars: String(prompt || "").length,
            chunkBytes: byteLength(prompt),
            chunkElapsedMs: Date.now() - startedAt,
            timeoutMs,
          }));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  logf("info", `${methodName} inserted ${String(prompt || "").length} chars in ${Date.now() - startedAt}ms`);
  return true;
}

async function insertViaChunkedNativeInsertText(page, prompt, { log, sleep, thresholds, methodName = "native_insert_text_chunked" } = {}) {
  const insertText = resolveNativeInsertText(page);
  if (!insertText) {
    throw makeInsertionError("prompt_insertion_failed", "Native keyboardInsertText unavailable", {
      method: methodName,
      failureReason: "native_insert_text_unavailable",
    });
  }

  const logf = typeof log === "function" ? log : () => {};
  const chunks = splitUtf8Chunks(prompt, thresholds?.nativeInsertChunkBytes);
  if (chunks.length > 1) {
    logf("info", `${methodName} chunking enabled: ${chunks.length} chunks, maxBytes=${thresholds?.nativeInsertChunkBytes}`);
  }

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const startedAt = Date.now();
    let timeoutId = null;
    try {
      await Promise.race([
        insertText(chunk.text),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(makeInsertionError("prompt_insertion_failed", `Native keyboardInsertText timed out on chunk ${index + 1}/${chunks.length}`, {
              method: methodName,
              failureReason: "native_insert_text_timeout",
              chunkIndex: index,
              chunkCount: chunks.length,
              chunkChars: chunk.chars,
              chunkBytes: chunk.bytes,
              chunkElapsedMs: Date.now() - startedAt,
            }));
          }, thresholds?.nativeInsertTimeoutMs || DEFAULT_THRESHOLDS.nativeInsertTimeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    if (chunks.length > 1) {
      logf("info", `${methodName} chunk ${index + 1}/${chunks.length}: ${chunk.chars} chars/${chunk.bytes} bytes in ${Date.now() - startedAt}ms`);
    }
    if (index < chunks.length - 1 && typeof sleep === "function" && (thresholds?.nativeInsertYieldMs || 0) > 0) {
      await sleep(thresholds.nativeInsertYieldMs);
    }
  }

  return true;
}

async function insertViaFillFallback(page, textarea, promptSelector, prompt, { log } = {}) {
  const logf = typeof log === "function" ? log : () => {};
  void textarea;

  await page.evaluate(({ selector, text, editableSelector }) => {
    const resolveEditable = (promptRootSelector) => {
      const selectors = String(promptRootSelector || "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      for (const candidate of selectors) {
        const root = document.querySelector(candidate);
        if (!root) continue;
        if (typeof root.matches === "function" && root.matches(editableSelector)) return root;
        if (typeof root.querySelector === "function") {
          const nested = root.querySelector(editableSelector);
          if (nested) return nested;
        }
      }
      return null;
    };

    const escapeHtml = (value) => String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const el = resolveEditable(selector);
    if (!el) return false;

    if (typeof el.focus === "function") el.focus();

    if (typeof el.value === "string") {
      const proto = Object.getPrototypeOf(el);
      const descriptor = proto ? Object.getOwnPropertyDescriptor(proto, "value") : null;
      if (descriptor && typeof descriptor.set === "function") descriptor.set.call(el, text);
      else el.value = text;
    }

    if (el.isContentEditable || el.getAttribute("contenteditable") === "true" || el.classList?.contains("ProseMirror")) {
      const lines = String(text || "").split(/\r\n|\r|\n/);
      el.innerHTML = lines.map((line) => {
        if (!line) return '<p><br class="ProseMirror-trailingBreak"></p>';
        return `<p>${escapeHtml(line)}</p>`;
      }).join("");
    } else {
      if ("textContent" in el) el.textContent = text;
      if ("innerText" in el) {
        try { el.innerText = text; } catch {}
      }
    }

    const inputEvent = typeof InputEvent !== "undefined"
      ? new InputEvent("input", { bubbles: true, data: text, inputType: "insertFromPaste" })
      : new Event("input", { bubbles: true });
    el.dispatchEvent(inputEvent);
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, { selector: promptSelector, text: prompt, editableSelector: EDITABLE_SELECTOR });
  logf("info", "fill_fallback DOM assignment applied");
}

function buildMetrics({ method, expectedText, actualState, composerKind }) {
  const normalizedExpected = normalizeForLengthComparison(expectedText);
  const normalizedActual = normalizeForLengthComparison(actualState?.actualText || "");
  const expectedChars = normalizedExpected.length;
  const actualChars = normalizedActual.length;
  const deltaChars = actualChars - expectedChars;
  const ratio = expectedChars > 0 ? actualChars / expectedChars : 1;
  return {
    method: method || "native_insert_text",
    composerKind: composerKind || undefined,
    expectedChars,
    actualChars,
    deltaChars,
    ratio,
    exactMatch: normalizedActual === normalizedExpected,
    sendEnabled: !!actualState?.sendEnabled,
    sendButtonFound: !!actualState?.sendButtonFound,
    sendState: actualState?.sendState || "unknown",
    rawLengths: actualState?.rawLengths || { value: 0, textContent: 0, innerText: 0 },
    actualPreview: normalizedActual.slice(0, 200),
  };
}

function isSoftTextMatch(metrics, thresholds = DEFAULT_THRESHOLDS) {
  return Math.abs(metrics.deltaChars) <= thresholds.allowedDeltaChars && metrics.ratio >= thresholds.minSuccessRatio;
}

function isSuccess(metrics, thresholds = DEFAULT_THRESHOLDS) {
  void thresholds;
  return metrics.exactMatch;
}

async function waitForSendReady({ page, promptSelector, sendButtonSelectors, sleep, thresholds, initialState }) {
  let state = initialState || await readComposerState(page, promptSelector, sendButtonSelectors);
  if (state.sendEnabled || !state.sendButtonFound || typeof sleep !== "function") return state;
  const maxPolls = Math.ceil(thresholds.sendReadyTimeoutMs / thresholds.sendReadyPollMs);
  for (let i = 0; i < maxPolls; i += 1) {
    await sleep(thresholds.sendReadyPollMs);
    state = await readComposerState(page, promptSelector, sendButtonSelectors);
    if (state.sendEnabled || !state.sendButtonFound) return state;
  }
  return state;
}

function makeInsertionError(code, message, details) {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  return err;
}

async function enterPromptWithVerification({
  page,
  textarea,
  prompt,
  log,
  sleep,
  promptSelector,
  sendButtonSelectors,
  thresholds = {},
}) {
  const merged = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const logf = typeof log === "function" ? log : () => {};
  const promptBytes = byteLength(prompt);
  const promptChars = normalizeForLengthComparison(prompt).length;

  let actualState = null;
  let metrics = null;
  let composerKind = undefined;
  let fillAlreadyTried = false;

  const verify = async (method) => {
    actualState = await readComposerState(page, promptSelector, sendButtonSelectors);
    actualState = await waitForSendReady({
      page,
      promptSelector,
      sendButtonSelectors,
      sleep,
      thresholds: merged,
      initialState: actualState,
    });
    metrics = buildMetrics({ method, expectedText: prompt, actualState, composerKind });
    logf(
      "info",
      `Prompt insert verify: ${metrics.method} ${metrics.actualChars}/${metrics.expectedChars} chars (${(metrics.ratio * 100).toFixed(1)}%), delta=${metrics.deltaChars}, exactMatch=${metrics.exactMatch}, sendEnabled=${metrics.sendEnabled}, sendState=${metrics.sendState}`,
    );
    return metrics;
  };

  const settleAndVerify = async (method) => {
    if (typeof sleep === "function") await sleep(merged.settleMs);
    return await verify(method);
  };

  const tryNativePath = async ({ method, mode }) => {
    logf("info", `Clearing composer before ${method}`);
    await clearComposer(page, promptSelector);
    logf("info", `Composer cleared; starting ${method}`);
    if (mode === "chunked") {
      await insertViaChunkedNativeInsertText(page, prompt, { log: logf, sleep, thresholds: merged, methodName: method });
    } else if (mode === "fill") {
      await insertViaFillFallback(page, textarea, promptSelector, prompt, { log: logf });
    } else {
      await insertViaNativeInsertText(page, prompt, { log: logf, thresholds: merged, methodName: method });
    }
    logf("info", `${method} completed; settling before readback`);
    return await settleAndVerify(method);
  };

  if (promptBytes >= merged.proseMirrorReplaceMinBytes) {
    logf("info", `Prompt insert strategy: attempting prosemirror_replace (${(promptBytes / 1024).toFixed(1)}KB, ${promptChars} chars)`);
    const pmResult = await tryReplaceViaProseMirror(page, promptSelector, prompt, { log: logf });
    composerKind = pmResult.composerKind;

    if (pmResult.applied) {
      const pmMetrics = await settleAndVerify("prosemirror_replace");
      const pmSendReady = pmMetrics.sendEnabled || !pmMetrics.sendButtonFound;
      if (isSuccess(pmMetrics, merged) && pmSendReady) {
        logf("info", `Prompt insert success: ${pmMetrics.method} ${pmMetrics.actualChars}/${pmMetrics.expectedChars} chars (${(pmMetrics.ratio * 100).toFixed(1)}%), sendEnabled=${pmMetrics.sendEnabled}, sendState=${pmMetrics.sendState}`);
        return pmMetrics;
      }
      if (pmMetrics.exactMatch && !pmSendReady) {
        logf("warn", "ProseMirror replace produced exact text but send did not become ready; falling back to native insertion");
      } else {
        logf("warn", "ProseMirror replace verification failed; falling back to native insertion");
      }
    } else {
      logf("info", `ProseMirror replace not available (${pmResult.fallbackReason}); falling back to native insertion`);
    }
  } else {
    logf("info", `Prompt insert strategy: native_insert_text (${(promptBytes / 1024).toFixed(1)}KB, ${promptChars} chars)`);
  }

  if (promptBytes >= merged.fillFallbackPreferredMinBytes) {
    logf("info", `Prompt insert strategy: trying fill_fallback first for very large payload (${(promptBytes / 1024).toFixed(1)}KB)`);
    fillAlreadyTried = true;
    const preferredFillMetrics = await tryNativePath({ method: "fill_fallback", mode: "fill" });
    if (isSuccess(preferredFillMetrics, merged)) {
      logf("info", `Prompt insert success: ${preferredFillMetrics.method} ${preferredFillMetrics.actualChars}/${preferredFillMetrics.expectedChars} chars (${(preferredFillMetrics.ratio * 100).toFixed(1)}%), sendEnabled=${preferredFillMetrics.sendEnabled}, sendState=${preferredFillMetrics.sendState}`);
      return preferredFillMetrics;
    }
    logf("warn", "fill_fallback verification failed for very large payload; falling back to native insertion");
  }

  const bulkMetrics = await tryNativePath({ method: "native_insert_text", mode: "bulk" });
  if (isSuccess(bulkMetrics, merged)) {
    logf("info", `Prompt insert success: ${bulkMetrics.method} ${bulkMetrics.actualChars}/${bulkMetrics.expectedChars} chars (${(bulkMetrics.ratio * 100).toFixed(1)}%), sendEnabled=${bulkMetrics.sendEnabled}, sendState=${bulkMetrics.sendState}`);
    return bulkMetrics;
  }

  if (!bulkMetrics.exactMatch) {
    logf("warn", `Prompt insert bulk verify failed; falling back to chunked native insert`);
  }
  const chunkedMetrics = await tryNativePath({ method: "native_insert_text_chunked", mode: "chunked" });
  if (isSuccess(chunkedMetrics, merged)) {
    logf("info", `Prompt insert success: ${chunkedMetrics.method} ${chunkedMetrics.actualChars}/${chunkedMetrics.expectedChars} chars (${(chunkedMetrics.ratio * 100).toFixed(1)}%), sendEnabled=${chunkedMetrics.sendEnabled}, sendState=${chunkedMetrics.sendState}`);
    return chunkedMetrics;
  }

  if (fillAlreadyTried) {
    const finalMetrics = chunkedMetrics || bulkMetrics || metrics;
    throw makeInsertionError(
      finalMetrics.sendButtonFound && !finalMetrics.sendEnabled ? "prompt_send_not_ready" : "prompt_insertion_failed",
      `Prompt insertion failed: ${finalMetrics.actualChars}/${finalMetrics.expectedChars} chars (${(finalMetrics.ratio * 100).toFixed(1)}%), delta=${finalMetrics.deltaChars}, sendEnabled=${finalMetrics.sendEnabled}, sendState=${finalMetrics.sendState}`,
      {
        ...finalMetrics,
        failureReason: finalMetrics.exactMatch ? "send_not_ready" : "content_mismatch",
      },
    );
  }

  logf("warn", `Prompt insert chunked verify failed; falling back to fill_fallback`);
  const fillMetrics = await tryNativePath({ method: "fill_fallback", mode: "fill" });
  if (isSuccess(fillMetrics, merged)) {
    logf("info", `Prompt insert success: ${fillMetrics.method} ${fillMetrics.actualChars}/${fillMetrics.expectedChars} chars (${(fillMetrics.ratio * 100).toFixed(1)}%), sendEnabled=${fillMetrics.sendEnabled}, sendState=${fillMetrics.sendState}`);
    return fillMetrics;
  }

  const finalMetrics = fillMetrics || chunkedMetrics || bulkMetrics || metrics;
  const textFailed = !finalMetrics.exactMatch;
  throw makeInsertionError(
    !textFailed && finalMetrics.sendButtonFound && !finalMetrics.sendEnabled ? "prompt_send_not_ready" : "prompt_insertion_failed",
    `Prompt insertion failed: ${finalMetrics.actualChars}/${finalMetrics.expectedChars} chars (${(finalMetrics.ratio * 100).toFixed(1)}%), delta=${finalMetrics.deltaChars}, sendEnabled=${finalMetrics.sendEnabled}, sendState=${finalMetrics.sendState}`,
    {
      ...finalMetrics,
      failureReason: textFailed ? "content_mismatch" : "send_not_ready",
    },
  );
}

module.exports = {
  enterPromptWithVerification,
  __private: {
    DEFAULT_THRESHOLDS,
    normalizeForLengthComparison,
    byteLength,
    resolveNativeInsertTimeoutMs,
    splitUtf8Chunks,
    splitNativeInsertChunks,
    readComposerState,
    clearComposer,
    buildMetrics,
    isSoftTextMatch,
    isSuccess,
    tryReplaceViaProseMirror,
  },
};

```

File: /Users/danielsivan/dev/surf-cli/test/unit/chatgpt-cloak-timeout.test.ts
```ts
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const timeoutHelpers = require("../../native/chatgpt-cloak-timeout.cjs");

describe("chatgpt-cloak-timeout", () => {
  it("uses 2700s as the default query timeout", () => {
    expect(timeoutHelpers.resolveQueryTimeoutSeconds()).toBe(2700);
    expect(timeoutHelpers.resolveQueryTimeoutSeconds(0)).toBe(2700);
    expect(timeoutHelpers.resolveQueryTimeoutSeconds(null)).toBe(2700);
    expect(timeoutHelpers.resolveQueryTimeoutSeconds(45)).toBe(45);
  });

  it("keeps chats default at 120s", () => {
    expect(timeoutHelpers.resolveChatsTimeoutSeconds()).toBe(120);
    expect(timeoutHelpers.resolveChatsTimeoutSeconds(0)).toBe(120);
    expect(timeoutHelpers.resolveChatsTimeoutSeconds(30)).toBe(30);
  });

  it("detects fresh response activity only when content actually advances", () => {
    const idle = timeoutHelpers.detectResponseActivity({
      phase: "Waiting for response",
      previousPhase: "Waiting for response",
      turnId: "turn-1",
      previousTurnId: "turn-1",
      currentText: "same",
      previousText: "same",
      streamText: "same",
      previousStreamText: "same",
      thinkingText: "",
      previousThinkingText: "",
    });
    expect(idle).toEqual({ active: false, reasons: [] });

    const active = timeoutHelpers.detectResponseActivity({
      phase: "Thinking",
      previousPhase: "Waiting for response",
      turnId: "turn-2",
      previousTurnId: "turn-1",
      currentText: "draft",
      previousText: "",
      streamText: "draft",
      previousStreamText: "",
      thinkingText: "step 1",
      previousThinkingText: "",
    });
    expect(active.active).toBe(true);
    expect(active.reasons).toEqual(
      expect.arrayContaining(["phase", "turn", "stream", "text", "thinking"]),
    );
  });

  it("ignores stale baseline turn phase/text churn", () => {
    const active = timeoutHelpers.detectResponseActivity({
      phase: "Thinking",
      previousPhase: "Waiting for response",
      turnId: null,
      previousTurnId: null,
      observedTurnId: "turn-baseline",
      baselineTurnId: "turn-baseline",
      currentText: "old assistant reply",
      previousText: "",
      baselineText: "old assistant reply",
      streamText: "",
      previousStreamText: "",
      thinkingText: "",
      previousThinkingText: "",
    });
    expect(active).toEqual({ active: false, reasons: [] });
  });

  it("treats text-only deltas as activity after trust is established", () => {
    const active = timeoutHelpers.detectResponseActivity({
      phase: "Waiting for response",
      previousPhase: "Waiting for response",
      turnId: "turn-1",
      previousTurnId: "turn-1",
      currentText: "new text",
      previousText: "",
      streamText: "",
      previousStreamText: "",
      thinkingText: "",
      previousThinkingText: "",
      trustedActivitySeen: true,
    });
    expect(active).toEqual({ active: true, reasons: ["text"] });
  });

  it("caps keepalive heartbeat interval for long-running queries", () => {
    expect(timeoutHelpers.resolveKeepaliveIntervalMs(5)).toBe(1250);
    expect(timeoutHelpers.resolveKeepaliveIntervalMs(2700)).toBe(15000);
  });

  it("does not treat thought timer label churn as fresh activity", () => {
    const active = timeoutHelpers.detectResponseActivity({
      phase: "Thought for 4 seconds",
      previousPhase: "Thought for 3 seconds",
      turnId: "turn-1",
      previousTurnId: "turn-1",
      currentText: "",
      previousText: "",
      streamText: "",
      previousStreamText: "",
      thinkingText: "",
      previousThinkingText: "",
    });
    expect(active).toEqual({ active: false, reasons: [] });
  });

  it("does not treat thinking timer label churn as fresh activity", () => {
    const active = timeoutHelpers.detectResponseActivity({
      phase: "Thinking for 4 seconds",
      previousPhase: "Thinking for 3 seconds",
      turnId: "turn-1",
      previousTurnId: "turn-1",
      currentText: "",
      previousText: "",
      streamText: "",
      previousStreamText: "",
      thinkingText: "",
      previousThinkingText: "",
    });
    expect(active).toEqual({ active: false, reasons: [] });
  });
});

```

File: /Users/danielsivan/dev/surf-cli/native/chatgpt-cloak-prompt-validation.cjs
```cjs
"use strict";

const { walkConversationMessages } = require("./chatgpt-chats-formatter.cjs");

function normalizePromptForComparison(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n+$/, "");
}

function hasActivePath(conversation) {
  const mapping = conversation && conversation.mapping ? conversation.mapping : null;
  const currentNode = conversation && conversation.current_node ? conversation.current_node : null;
  return !!(mapping && typeof mapping === "object" && currentNode && mapping[currentNode]);
}

function getActiveUserNodeId(conversation) {
  if (!hasActivePath(conversation)) return null;
  const messages = walkConversationMessages(conversation, { mode: "active" });
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i] && messages[i].role === "user" && messages[i].id) return messages[i].id;
  }
  return null;
}

function extractRawMessageText(message) {
  const parts = Array.isArray(message?.content?.parts) ? message.content.parts : null;
  if (!parts) return typeof message?.content?.text === "string" ? message.content.text : "";
  return parts
    .flatMap((part) => {
      if (typeof part === "string") return [part];
      if (part && typeof part.text === "string") return [part.text];
      return [];
    })
    .join("");
}

function isBigPasteAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") return false;
  return attachment.is_big_paste === true
    || attachment?.metadata?.is_big_paste === true
    || attachment.name === "Pasted text.txt";
}

function extractLatestActiveUserMessage(conversation) {
  if (!hasActivePath(conversation)) return null;
  const mapping = conversation.mapping || {};
  const nodeId = getActiveUserNodeId(conversation);
  if (!nodeId || !mapping[nodeId] || !mapping[nodeId].message) return null;

  const message = mapping[nodeId].message;
  const attachments = Array.isArray(message?.metadata?.attachments) ? message.metadata.attachments : [];
  const text = normalizePromptForComparison(extractRawMessageText(message));

  return {
    nodeId,
    text,
    createTime: message.create_time ?? null,
    attachments,
    attachmentCount: attachments.length,
    attachmentNames: attachments.map((attachment) => attachment?.name).filter(Boolean),
    hasBigPasteAttachment: attachments.some(isBigPasteAttachment),
    fileMapOnly: text.trim() === "<file_map>",
  };
}

function evaluatePromptPersistence({ conversation, expectedPrompt, baselineUserNodeId = null }) {
  const expectedText = normalizePromptForComparison(expectedPrompt);

  if (!hasActivePath(conversation)) {
    return {
      ok: false,
      failureReason: "no_active_path",
      expectedChars: expectedText.length,
      actualChars: 0,
      exactMatch: false,
      latestUserNodeId: null,
      advancedPastBaseline: baselineUserNodeId ? false : null,
      fileMapOnly: false,
      hasBigPasteAttachment: false,
      attachmentCount: 0,
      attachmentNames: [],
      actualText: "",
    };
  }

  const latestUser = extractLatestActiveUserMessage(conversation);
  if (!latestUser) {
    return {
      ok: false,
      failureReason: "no_user_message",
      expectedChars: expectedText.length,
      actualChars: 0,
      exactMatch: false,
      latestUserNodeId: null,
      advancedPastBaseline: baselineUserNodeId ? false : null,
      fileMapOnly: false,
      hasBigPasteAttachment: false,
      attachmentCount: 0,
      attachmentNames: [],
      actualText: "",
    };
  }

  const actualText = latestUser.text;
  const exactMatch = actualText === expectedText;
  const advancedPastBaseline = baselineUserNodeId ? latestUser.nodeId !== baselineUserNodeId : null;

  let failureReason = null;
  if (baselineUserNodeId && latestUser.nodeId === baselineUserNodeId) failureReason = "latest_user_not_advanced";
  else if (latestUser.fileMapOnly) failureReason = "file_map_placeholder";
  else if (latestUser.hasBigPasteAttachment) failureReason = "big_paste_attachment";
  else if (!exactMatch) failureReason = "content_mismatch";

  return {
    ok: !failureReason,
    failureReason,
    expectedChars: expectedText.length,
    actualChars: actualText.length,
    exactMatch,
    latestUserNodeId: latestUser.nodeId,
    advancedPastBaseline,
    fileMapOnly: latestUser.fileMapOnly,
    hasBigPasteAttachment: latestUser.hasBigPasteAttachment,
    attachmentCount: latestUser.attachmentCount,
    attachmentNames: latestUser.attachmentNames,
    actualText,
  };
}

module.exports = {
  normalizePromptForComparison,
  extractLatestActiveUserMessage,
  evaluatePromptPersistence,
  __private: {
    hasActivePath,
    extractRawMessageText,
    isBigPasteAttachment,
  },
};

```

File: /Users/danielsivan/dev/surf-cli/test/unit/chatgpt-cloak-prompt-entry.test.ts
```ts
import { describe, expect, it, vi } from "vitest";

const {
  enterPromptWithVerification,
  __private,
} = require("../../native/chatgpt-cloak-prompt-entry.cjs");

type HarnessOptions = {
  insertTransform?: (text: string, state: HarnessState) => string;
  sendEnabledFunc?: (state: HarnessState) => boolean;
  sendThreshold?: number;
  sendButtonFound?: boolean;
  // ProseMirror simulation
  composerKind?: "prosemirror" | "textarea" | "unknown";
  prosemirrorViewAvailable?: boolean;
  prosemirrorViewResolutionMethod?: "pmViewDesc" | "property_scan";
  prosemirrorFallbackReason?: "view_not_found" | "unsupported_schema";
  // Optional transform for PM replace (text → composer text after PM replace)
  prosemirrorReplaceTransform?: (text: string) => string;
};

type HarnessState = {
  composerText: string;
  insertCalls: number;
  readCalls: number;
  sendEnabled: boolean;
  pmReplaceCalled: boolean;
  lastMethod: string;
};

function createSleepMock() {
  return vi.fn(async () => undefined);
}

function updateSendEnabled(state: HarnessState, options: HarnessOptions) {
  if (typeof options.sendEnabledFunc === "function") {
    state.sendEnabled = !!options.sendEnabledFunc(state);
    return;
  }
  state.sendEnabled = state.composerText.length >= (options.sendThreshold ?? 1);
}

function resolveSendState(sendButtonFound: boolean, sendEnabled: boolean) {
  if (!sendButtonFound) {
    return "unknown";
  }
  return sendEnabled ? "enabled" : "disabled";
}

function readState(state: HarnessState, options: HarnessOptions) {
  state.readCalls += 1;
  updateSendEnabled(state, options);
  const sendButtonFound = options.sendButtonFound ?? true;
  return {
    actualText: state.composerText,
    actualChars: state.composerText.length,
    rawLengths: {
      value: 0,
      textContent: state.composerText.length,
      innerText: state.composerText.length,
    },
    sendEnabled: sendButtonFound ? state.sendEnabled : false,
    sendButtonFound,
    sendState: resolveSendState(sendButtonFound, state.sendEnabled),
  };
}

function isReadStateCall(source: string) {
  return source.includes("readProseMirrorText") && source.includes("sendEnabled");
}

function isClearComposerCall(source: string) {
  return source.includes("deleteContentBackward") && source.includes("ProseMirror-trailingBreak");
}

function isFillFallbackCall(source: string) {
  return source.includes("insertFromPaste") && source.includes("escapeHtml");
}

function isProseMirrorReplaceCall(source: string) {
  return source.includes("pmViewDesc") && source.includes("replaceWith");
}

function createPmFallbackResult(
  composerKind: "prosemirror" | "textarea" | "unknown",
  fallbackReason: "not_prosemirror" | "view_not_found" | "unsupported_schema",
) {
  return {
    applied: false,
    fallbackSafe: true,
    composerKind,
    fallbackReason,
  };
}

function handleEvaluate(source: string, state: HarnessState, options: HarnessOptions) {
  if (isReadStateCall(source)) {
    return readState(state, options);
  }

  if (isClearComposerCall(source)) {
    state.composerText = "";
    updateSendEnabled(state, options);
    return true;
  }

  if (isFillFallbackCall(source)) {
    return true;
  }

  if (isProseMirrorReplaceCall(source)) {
    const kind = options.composerKind ?? "textarea";
    if (kind !== "prosemirror") {
      return createPmFallbackResult(kind, "not_prosemirror");
    }
    if (options.prosemirrorFallbackReason) {
      return createPmFallbackResult("prosemirror", options.prosemirrorFallbackReason);
    }
    if (options.prosemirrorViewAvailable === false) {
      return createPmFallbackResult("prosemirror", "view_not_found");
    }
    state.pmReplaceCalled = true;
    state.lastMethod = "prosemirror_replace";
    return {
      applied: true,
      composerKind: "prosemirror",
      viewResolutionMethod: options.prosemirrorViewResolutionMethod ?? "pmViewDesc",
      paragraphCount: 1,
    };
  }

  throw new Error(`Unhandled evaluate call: ${source.slice(0, 140)}`);
}

function createHarness(options: HarnessOptions = {}) {
  const state: HarnessState = {
    composerText: "",
    insertCalls: 0,
    readCalls: 0,
    sendEnabled: false,
    pmReplaceCalled: false,
    lastMethod: "",
  };

  const textarea = {
    type: vi.fn(async () => undefined),
    fill: vi.fn(async () => undefined),
  };

  const applyEvaluateArgs = (source: string, args: unknown) => {
    if (isProseMirrorReplaceCall(source)) {
      const promptArgs = args as { prompt?: string } | undefined;
      const canApplyPrompt =
        promptArgs?.prompt !== undefined &&
        options.composerKind === "prosemirror" &&
        options.prosemirrorViewAvailable !== false &&
        !options.prosemirrorFallbackReason;
      if (canApplyPrompt) {
        const prompt = promptArgs.prompt;
        if (prompt === undefined) {
          return;
        }
        const transform = options.prosemirrorReplaceTransform ?? ((t: string) => t);
        state.composerText = transform(prompt);
        updateSendEnabled(state, options);
      }
    }

    if (isFillFallbackCall(source)) {
      const fillArgs = args as { text?: string } | undefined;
      if (fillArgs?.text !== undefined) {
        state.composerText = fillArgs.text;
        updateSendEnabled(state, options);
      }
    }
  };

  const page = {
    evaluate: vi.fn(async (fn: unknown, args?: unknown) => {
      const source = typeof fn === "function" ? fn.toString() : String(fn);
      applyEvaluateArgs(source, args);
      return handleEvaluate(source, state, options);
    }),
    _original: {
      keyboardInsertText: vi.fn(async (text: string) => {
        state.insertCalls += 1;
        state.composerText = options.insertTransform ? options.insertTransform(text, state) : text;
        updateSendEnabled(state, options);
      }),
    },
  };

  return { page, textarea, state };
}

describe("chatgpt-cloak-prompt-entry", () => {
  it("inserts exact text via native keyboardInsertText for small prompts", async () => {
    const harness = createHarness();
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt: "small prompt",
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("native_insert_text");
    expect(result.exactMatch).toBe(true);
    expect(harness.page._original.keyboardInsertText).toHaveBeenCalledTimes(1);
    expect(harness.textarea.type).not.toHaveBeenCalled();
    expect(harness.textarea.fill).not.toHaveBeenCalled();
  });

  it("inserts exact text via native keyboardInsertText bulk insert for very large prompts when not ProseMirror", async () => {
    const harness = createHarness({
      composerKind: "textarea",
    });
    const sleep = createSleepMock();
    const prompt = "abcd".repeat(60 * 1024);

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("native_insert_text");
    expect(result.exactMatch).toBe(true);
    expect(result.actualChars).toBe(prompt.length);
    expect(harness.page._original.keyboardInsertText).toHaveBeenCalledTimes(1);
  });

  it("waits briefly for delayed send readiness", async () => {
    const harness = createHarness({
      sendEnabledFunc: (state) => state.readCalls >= 4,
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt: "delayed ready",
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.exactMatch).toBe(true);
    expect(result.sendEnabled).toBe(true);
    expect(sleep).toHaveBeenCalled();
  });

  it("does not fail when exact text matches but send button remains disabled", async () => {
    const harness = createHarness({
      sendEnabledFunc: () => false,
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt: "exact text, disabled send",
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.exactMatch).toBe(true);
    expect(result.sendEnabled).toBe(false);
    expect(result.sendState).toBe("disabled");
  });

  it("does not fail when send selector is missing", async () => {
    const harness = createHarness({
      sendButtonFound: false,
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt: "selector drift",
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.exactMatch).toBe(true);
    expect(result.sendButtonFound).toBe(false);
    expect(result.sendState).toBe("unknown");
  });

  it("recovers via fill_fallback when native insertion strategies mismatch", async () => {
    const harness = createHarness({
      insertTransform: (text, state) =>
        `${state.composerText}${text.slice(0, Math.floor(text.length * 0.4))}`,
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt: "x".repeat(20 * 1024),
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("fill_fallback");
    expect(result.exactMatch).toBe(true);
  });

  it("uses prosemirror_replace for large prompts when ProseMirror EditorView is available", async () => {
    const largePrompt = "hello world\nsecond line".padEnd(10 * 1024, " x");
    const harness = createHarness({
      composerKind: "prosemirror",
      prosemirrorViewAvailable: true,
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt: largePrompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("prosemirror_replace");
    expect(result.exactMatch).toBe(true);
    expect(harness.page._original.keyboardInsertText).not.toHaveBeenCalled();
    expect(harness.state.pmReplaceCalled).toBe(true);
  });

  it("falls back to native_insert_text for large prompts when ProseMirror EditorView is not available", async () => {
    const largePrompt = "x".repeat(10 * 1024);
    const harness = createHarness({
      composerKind: "prosemirror",
      prosemirrorViewAvailable: false,
      insertTransform: (text, state) => `${state.composerText}${text}`,
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt: largePrompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("native_insert_text");
    expect(result.exactMatch).toBe(true);
    expect(harness.page._original.keyboardInsertText).toHaveBeenCalled();
  });

  it("falls back to native_insert_text for large prompts when composer is not ProseMirror", async () => {
    const largePrompt = "x".repeat(10 * 1024);
    const harness = createHarness({
      composerKind: "textarea",
      insertTransform: (text, state) => `${state.composerText}${text}`,
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt: largePrompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("native_insert_text");
    expect(result.exactMatch).toBe(true);
  });

  it("prosemirror_replace preserves multiline structure with blank lines after normalization", async () => {
    const prompt = ["line one", "", "line three", "", "line five"]
      .join("\n")
      .padEnd(9 * 1024, "\npadding");
    const harness = createHarness({
      composerKind: "prosemirror",
      prosemirrorViewAvailable: true,
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("prosemirror_replace");
    expect(result.exactMatch).toBe(true);
  });

  it("falls back to native insertion when prosemirror_replace verification mismatches", async () => {
    const largePrompt = "x".repeat(10 * 1024);
    const harness = createHarness({
      composerKind: "prosemirror",
      prosemirrorViewAvailable: true,
      // Simulate PM writing only half the content (drift/bug)
      prosemirrorReplaceTransform: (text) => text.slice(0, Math.floor(text.length / 2)),
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt: largePrompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("native_insert_text");
    expect(result.exactMatch).toBe(true);
    expect(harness.page._original.keyboardInsertText).toHaveBeenCalledTimes(1);
  });

  it("prosemirror_replace still honors delayed send readiness", async () => {
    const largePrompt = "x".repeat(10 * 1024);
    const harness = createHarness({
      composerKind: "prosemirror",
      prosemirrorViewAvailable: true,
      sendEnabledFunc: (state) => state.readCalls >= 3,
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt: largePrompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("prosemirror_replace");
    expect(result.sendEnabled).toBe(true);
    expect(sleep).toHaveBeenCalled();
  });

  it("does not accept large same-length native mismatches and falls back to fill_fallback", async () => {
    const harness = createHarness({
      composerKind: "textarea",
      insertTransform: (text) => `y${text.slice(1)}`,
    });
    const sleep = createSleepMock();
    const prompt = "x".repeat(9 * 1024);

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("fill_fallback");
    expect(result.exactMatch).toBe(true);
  });

  it("falls back to chunked native insertion after severe bulk mismatch", async () => {
    const prompt = "abcd".repeat(5 * 1024);
    const harness = createHarness({
      composerKind: "textarea",
      insertTransform: (text, state) => {
        if (state.insertCalls === 1) {
          return text.slice(0, Math.floor(text.length / 4));
        }
        return `${state.composerText}${text}`;
      },
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("native_insert_text_chunked");
    expect(result.exactMatch).toBe(true);
    expect(harness.page._original.keyboardInsertText).toHaveBeenCalledTimes(4);
  });

  it("buildMetrics normalizes line endings, terminal newlines, and nbsp", () => {
    expect(
      __private.buildMetrics({
        method: "native_insert_text",
        expectedText: "a\r\n\u00a0b\n\n",
        actualState: {
          actualText: "a\n b",
          sendEnabled: false,
          sendButtonFound: true,
          sendState: "disabled",
          rawLengths: { value: 3, textContent: 3, innerText: 3 },
        },
      }),
    ).toMatchObject({
      exactMatch: true,
      expectedChars: 4,
      actualChars: 4,
    });
  });

  it("splits native insert chunks at the configured boundary", () => {
    expect(__private.splitNativeInsertChunks("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("scales native insert timeout with very large payloads", () => {
    expect(__private.resolveNativeInsertTimeoutMs("x".repeat(4 * 1024))).toBe(120_000);
    expect(__private.resolveNativeInsertTimeoutMs("x".repeat(446 * 1024))).toBeGreaterThan(120_000);
  });

  it("prefers fill_fallback first for very large payloads", async () => {
    const prompt = "x".repeat(300 * 1024);
    const harness = createHarness({
      composerKind: "textarea",
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("fill_fallback");
    expect(result.exactMatch).toBe(true);
    expect(harness.page._original.keyboardInsertText).not.toHaveBeenCalled();
  });

  it("uses proseMirror byte threshold for multibyte-heavy prompts", async () => {
    const prompt = "🙂".repeat(3_000);
    expect(prompt.length).toBeLessThan(8 * 1024);
    expect(__private.byteLength(prompt)).toBeGreaterThan(8 * 1024);
    const harness = createHarness({
      composerKind: "prosemirror",
      prosemirrorViewAvailable: true,
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("prosemirror_replace");
    expect(result.exactMatch).toBe(true);
  });

  it("falls back to native insertion when proseMirror text is exact but send stays disabled", async () => {
    const largePrompt = "x".repeat(10 * 1024);
    const harness = createHarness({
      composerKind: "prosemirror",
      prosemirrorViewAvailable: true,
      sendEnabledFunc: () => false,
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt: largePrompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("native_insert_text");
    expect(result.exactMatch).toBe(true);
    expect(harness.page._original.keyboardInsertText).toHaveBeenCalledTimes(1);
  });

  it("reports property_scan when proseMirror view is discovered via fallback scan", async () => {
    const largePrompt = "x".repeat(10 * 1024);
    const harness = createHarness({
      composerKind: "prosemirror",
      prosemirrorViewAvailable: true,
      prosemirrorViewResolutionMethod: "property_scan",
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt: largePrompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("prosemirror_replace");
    expect(harness.state.pmReplaceCalled).toBe(true);
  });

  it("falls back to native insertion when proseMirror schema is unsupported", async () => {
    const largePrompt = "x".repeat(10 * 1024);
    const harness = createHarness({
      composerKind: "prosemirror",
      prosemirrorFallbackReason: "unsupported_schema",
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt: largePrompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("native_insert_text");
    expect(result.exactMatch).toBe(true);
  });

  it("splits utf8 chunks without breaking multibyte characters", () => {
    const text = "🙂🙂🙂🙂🙂";
    const chunks = __private.splitUtf8Chunks(text, 8);
    expect(chunks.map((chunk: { text: string }) => chunk.text).join("")).toBe(text);
    expect(chunks.every((chunk: { bytes: number }) => chunk.bytes <= 8)).toBe(true);
  });
});

```

File: /Users/danielsivan/Library/Application Support/RepoPrompt/Workspaces/Workspace-surf-cli-20A2B9F5-2872-48AA-B0F4-87F54BAC5C7A/_git_data/repos/surf-cli-3245402f/2026-04-13/1652/MAP.txt
```txt
# MAP.txt v1
# (grep tip: search for "SNAPSHOT_" or "SECTION:")

SECTION: SNAPSHOT_META
SNAPSHOT_ID: 2026-04-13/1652
SNAPSHOT_DIR: repos/surf-cli-3245402f/2026-04-13/1652
SNAPSHOT_GENERATED_AT: 2026-04-13T13:52:01Z
SNAPSHOT_MODE: standard
SNAPSHOT_MODE_DETAILS: standard: full diff patches (all.patch + per-file when size allows)
SNAPSHOT_COMPARE: uncommitted
SNAPSHOT_SCOPE: all
SNAPSHOT_CHANGED_FILES: 27
SNAPSHOT_INSERTIONS: 18413
SNAPSHOT_DELETIONS: 223

SECTION: REPOSITORY
REPO_KEY: surf-cli-3245402f
REPO_ROOT: /Users/danielsivan/dev/surf-cli

SECTION: FINGERPRINT
FINGERPRINT_HEAD_SHA: e3e73ab96b01afbea3f1c18fadabb195c8d7239e
FINGERPRINT_BASE_REF: HEAD
FINGERPRINT_STATUS_HASH: 159b02cc3fa6f1397139b400fb09ca404204a079cc938519e4a95711f87c7d42

SECTION: ADVANCED
ADV_CONTEXT_LINES: 3
ADV_DETECT_RENAMES: false

SECTION: ARTIFACTS
ARTIFACT_MANIFEST: manifest.json
ARTIFACT_MAP: MAP.txt
ARTIFACT_FILES_TSV: index/files.tsv
ARTIFACT_CHANGED_LINES: index/changed_lines.tsv
ARTIFACT_TREE: index/files.tree.txt
ARTIFACT_ALL_PATCH: diff/all.patch

SECTION: CHANGED_LINES_FORMAT
index/changed_lines.tsv: TSV columns: path, line_number, change_type(+/-), content
  - line_number: new-file line for '+', old-file line for '-'

SECTION: COMMIT_GRAPH
* e3e73ab (HEAD -> feat/slack-extension, fork/feat/slack-extension) fix: address GPT Pro review findings for slack extension
* af43848 fix: address review findings — remove legacy providers, harden slack workspace selection
* fb56523 refactor: address review fixes for Slack extension
* aae0639 feat: add surf slack.read extension for reading Slack conversations
* 3bb0a7c fix: biome lint — formatter, import order, assertion placement
* 8c2086e refactor: headless-only simplification — remove extension, AI Studio, Perplexity, Grok
* 3f5a852 fix: headless-only guards, cwd fix, WebView type, remove dead extension commands
* 587d296 feat: update Gemini 3 model tier aliases (fast/thinking/pro) and SKILL.md
* a3c90c3 fix: embed SKILL.md in CLI, remove stale env var guards, all ChatGPT/Gemini headless-only
* ac331a4 fix: harden cloak session timeout and persistence
* 927e583 docs: update surf headless prompt guidance
* fea52ca fix: harden cloak prompt persistence
* e6281b5 fix: use keyboard.insertText() for large prompts instead of clipboard paste
* 3331531 fix: use real clipboard API + keyboard paste for large prompts
* 0bb35af feat: add clipboard_paste strategy for large prompts (>50KB)
* ecd0882 fix: use selector list loop for Playwright locator instead of CSS comma string
* a4eb90b fix: widen cloak selectors + poll for send-ready + tolerate missing send button
* b968044 fix: harden cloak send and legacy reconciliation
* 800e346 (tag: v2.11.1) fix: restore pro thinking trace + prompt-file stability
* 6b0ac8e (tag: v2.11.0) chore: bump version to 2.11.0

SECTION: CHANGED_FILE_TREE
docs/
  investigations/
    rp-surf-oracle-missing-reply-recovery.md  [01] M +5 -3
native/
  chatgpt-cloak-bridge.cjs  [02] M +14 -3
  chatgpt-cloak-chats-worker.mjs  [03] M +86 -54
  chatgpt-cloak-runtime.cjs  [04] ?? +142 -0
  chatgpt-cloak-worker.mjs  [05] M +259 -98
  chatgpt-conversation-state.cjs  [06] ?? +55 -0
  cli.cjs  [07] M +39 -18
  session-reconciler.cjs  [08] M +17 -36
prompt-exports/
  2026-04-12-064859-review-headless-refactor-surf-cli.md  [09] ?? +12738 -0
  oracle-chat-2026-04-13-102715-cloak-flow-triage-f2-f1fa.md  [10] ?? +158 -0
  oracle-plan-2026-04-10-183937-socket-hardening-pla-146e.md  [11] ?? +814 -0
  oracle-plan-2026-04-11-230117-orchestrate-cloakbro-a1a7.md  [12] ?? +884 -0
  oracle-plan-2026-04-11-230414-orchestrate-cloakbro-7c58.md  [13] ?? +960 -0
  oracle-plan-2026-04-11-232831-headless-only-simpli-764c.md  [14] ?? +146 -0
  oracle-plan-2026-04-11-233149-headless-only-simpli-0fc3.md  [15] ?? +59 -0
  oracle-plan-2026-04-11-233446-headless-only-simpli-cef6.md  [16] ?? +3 -0
  oracle-plan-2026-04-12-005501-embed-skill-doc-210f-2984.md  [17] ?? +661 -0
  oracle-plan-2026-04-13-102511-cloak-flow-triage-f2-65dd.md  [18] ?? +709 -0
  oracle-review-2026-04-12-064859-headless-refactor-re-2cfa.md  [19] ?? +324 -0
test/
  unit/
    chatgpt-cloak-bridge.test.ts  [21] M +66 -0
    chatgpt-cloak-runtime.test.ts  [22] ?? +89 -0
    chatgpt-conversation-state.test.ts  [23] ?? +98 -0
    session-reconciler.test.ts  [24] M +65 -5
    slack-cloak-bridge.test.ts  [25] M +7 -2
    slack-formatter.test.ts  [26] M +5 -1
README.md  [20] M +9 -2
tsconfig.json  [27] M +1 -1

SECTION: JUMP_TABLE
[01] M +5 -3  docs/investigations/rp-surf-oracle-missing-reply-recovery.md -> diff/per-file/docs__investigations__rp-surf-oracle-missing-reply-recovery.md.patch
[02] M +14 -3  native/chatgpt-cloak-bridge.cjs -> diff/per-file/native__chatgpt-cloak-bridge.cjs.patch
[03] M +86 -54  native/chatgpt-cloak-chats-worker.mjs -> diff/per-file/native__chatgpt-cloak-chats-worker.mjs.patch
[04] ?? +142 -0  native/chatgpt-cloak-runtime.cjs -> diff/per-file/native__chatgpt-cloak-runtime.cjs.patch
[05] M +259 -98  native/chatgpt-cloak-worker.mjs -> diff/per-file/native__chatgpt-cloak-worker.mjs.patch
[06] ?? +55 -0  native/chatgpt-conversation-state.cjs -> diff/per-file/native__chatgpt-conversation-state.cjs.patch
[07] M +39 -18  native/cli.cjs -> diff/per-file/native__cli.cjs.patch
[08] M +17 -36  native/session-reconciler.cjs -> diff/per-file/native__session-reconciler.cjs.patch
[09] ?? +12738 -0  prompt-exports/2026-04-12-064859-review-headless-refactor-surf-cli.md -> diff/per-file/prompt-exports__2026-04-12-064859-review-headless-refactor-surf-cli.md.patch
[10] ?? +158 -0  prompt-exports/oracle-chat-2026-04-13-102715-cloak-flow-triage-f2-f1fa.md -> diff/per-file/prompt-exports__oracle-chat-2026-04-13-102715-cloak-flow-triage-f2-f1fa.md.patch
[11] ?? +814 -0  prompt-exports/oracle-plan-2026-04-10-183937-socket-hardening-pla-146e.md -> diff/per-file/prompt-exports__oracle-plan-2026-04-10-183937-socket-hardening-pla-146e.md.patch
[12] ?? +884 -0  prompt-exports/oracle-plan-2026-04-11-230117-orchestrate-cloakbro-a1a7.md -> diff/per-file/prompt-exports__oracle-plan-2026-04-11-230117-orchestrate-cloakbro-a1a7.md.patch
[13] ?? +960 -0  prompt-exports/oracle-plan-2026-04-11-230414-orchestrate-cloakbro-7c58.md -> diff/per-file/prompt-exports__oracle-plan-2026-04-11-230414-orchestrate-cloakbro-7c58.md.patch
[14] ?? +146 -0  prompt-exports/oracle-plan-2026-04-11-232831-headless-only-simpli-764c.md -> diff/per-file/prompt-exports__oracle-plan-2026-04-11-232831-headless-only-simpli-764c.md.patch
[15] ?? +59 -0  prompt-exports/oracle-plan-2026-04-11-233149-headless-only-simpli-0fc3.md -> diff/per-file/prompt-exports__oracle-plan-2026-04-11-233149-headless-only-simpli-0fc3.md.patch
[16] ?? +3 -0  prompt-exports/oracle-plan-2026-04-11-233446-headless-only-simpli-cef6.md -> diff/per-file/prompt-exports__oracle-plan-2026-04-11-233446-headless-only-simpli-cef6.md.patch
[17] ?? +661 -0  prompt-exports/oracle-plan-2026-04-12-005501-embed-skill-doc-210f-2984.md -> diff/per-file/prompt-exports__oracle-plan-2026-04-12-005501-embed-skill-doc-210f-2984.md.patch
[18] ?? +709 -0  prompt-exports/oracle-plan-2026-04-13-102511-cloak-flow-triage-f2-65dd.md -> diff/per-file/prompt-exports__oracle-plan-2026-04-13-102511-cloak-flow-triage-f2-65dd.md.patch
[19] ?? +324 -0  prompt-exports/oracle-review-2026-04-12-064859-headless-refactor-re-2cfa.md -> diff/per-file/prompt-exports__oracle-review-2026-04-12-064859-headless-refactor-re-2cfa.md.patch
[20] M +9 -2  README.md -> diff/per-file/README.md.patch
[21] M +66 -0  test/unit/chatgpt-cloak-bridge.test.ts -> diff/per-file/test__unit__chatgpt-cloak-bridge.test.ts.patch
[22] ?? +89 -0  test/unit/chatgpt-cloak-runtime.test.ts -> diff/per-file/test__unit__chatgpt-cloak-runtime.test.ts.patch
[23] ?? +98 -0  test/unit/chatgpt-conversation-state.test.ts -> diff/per-file/test__unit__chatgpt-conversation-state.test.ts.patch
[24] M +65 -5  test/unit/session-reconciler.test.ts -> diff/per-file/test__unit__session-reconciler.test.ts.patch
[25] M +7 -2  test/unit/slack-cloak-bridge.test.ts -> diff/per-file/test__unit__slack-cloak-bridge.test.ts.patch
[26] M +5 -1  test/unit/slack-formatter.test.ts -> diff/per-file/test__unit__slack-formatter.test.ts.patch
[27] M +1 -1  tsconfig.json -> diff/per-file/tsconfig.json.patch

SECTION: PER_FILE_PATCH_SELECTION_PATHS
(selection-ready `_git_data/...` paths for direct selection; no manual snapshot-dir reconstruction or `__` filename encoding required)
[01] M +5 -3  docs/investigations/rp-surf-oracle-missing-reply-recovery.md -> _git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/docs__investigations__rp-surf-oracle-missing-reply-recovery.md.patch
[02] M +14 -3  native/chatgpt-cloak-bridge.cjs -> _git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/native__chatgpt-cloak-bridge.cjs.patch
[03] M +86 -54  native/chatgpt-cloak-chats-worker.mjs -> _git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/native__chatgpt-cloak-chats-worker.mjs.patch
[04] ?? +142 -0  native/chatgpt-cloak-runtime.cjs -> _git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/native__chatgpt-cloak-runtime.cjs.patch
[05] M +259 -98  native/chatgpt-cloak-worker.mjs -> _git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/native__chatgpt-cloak-worker.mjs.patch
[06] ?? +55 -0  native/chatgpt-conversation-state.cjs -> _git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/native__chatgpt-conversation-state.cjs.patch
[07] M +39 -18  native/cli.cjs -> _git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/native__cli.cjs.patch
[08] M +17 -36  native/session-reconciler.cjs -> _git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/native__session-reconciler.cjs.patch
[09] ?? +12738 -0  prompt-exports/2026-04-12-064859-review-headless-refactor-surf-cli.md -> _git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/prompt-exports__2026-04-12-064859-review-headless-refactor-surf-cli.md.patch
[10] ?? +158 -0  prompt-exports/oracle-chat-2026-04-13-102715-cloak-flow-triage-f2-f1fa.md -> _git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/prompt-exports__oracle-chat-2026-04-13-102715-cloak-flow-triage-f2-f1fa.md.patch
[11] ?? +814 -0  prompt-exports/oracle-plan-2026-04-10-183937-socket-hardening-pla-146e.md -> _git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/prompt-exports__oracle-plan-2026-04-10-183937-socket-hardening-pla-146e.md.patch
[12] ?? +884 -0  prompt-exports/oracle-plan-2026-04-11-230117-orchestrate-cloakbro-a1a7.md -> _git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/prompt-exports__oracle-plan-2026-04-11-230117-orchestrate-cloakbro-a1a7.md.patch
[13] ?? +960 -0  prompt-exports/oracle-plan-2026-04-11-230414-orchestrate-cloakbro-7c58.md -> _git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/prompt-exports__oracle-plan-2026-04-11-230414-orchestrate-cloakbro-7c58.md.patch
[14] ?? +146 -0  prompt-exports/oracle-plan-2026-04-11-232831-headless-only-simpli-764c.md -> _git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/prompt-exports__oracle-plan-2026-04-11-232831-headless-only-simpli-764c.md.patch
[15] ?? +59 -0  prompt-exports/oracle-plan-2026-04-11-233149-headless-only-simpli-0fc3.md -> _git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/prompt-exports__oracle-plan-2026-04-11-233149-headless-only-simpli-0fc3.md.patch
[16] ?? +3 -0  prompt-exports/oracle-plan-2026-04-11-233446-headless-only-simpli-cef6.md -> _git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/prompt-exports__oracle-plan-2026-04-11-233446-headless-only-simpli-cef6.md.patch
[17] ?? +661 -0  prompt-exports/oracle-plan-2026-04-12-005501-embed-skill-doc-210f-2984.md -> _git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/prompt-exports__oracle-plan-2026-04-12-005501-embed-skill-doc-210f-2984.md.patch
[18] ?? +709 -0  prompt-exports/oracle-plan-2026-04-13-102511-cloak-flow-triage-f2-65dd.md -> _git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/prompt-exports__oracle-plan-2026-04-13-102511-cloak-flow-triage-f2-65dd.md.patch
[19] ?? +324 -0  prompt-exports/oracle-review-2026-04-12-064859-headless-refactor-re-2cfa.md -> _git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/prompt-exports__oracle-review-2026-04-12-064859-headless-refactor-re-2cfa.md.patch
[20] M +9 -2  README.md -> _git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/README.md.patch
[21] M +66 -0  test/unit/chatgpt-cloak-bridge.test.ts -> _git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/test__unit__chatgpt-cloak-bridge.test.ts.patch
[22] ?? +89 -0  test/unit/chatgpt-cloak-runtime.test.ts -> _git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/test__unit__chatgpt-cloak-runtime.test.ts.patch
[23] ?? +98 -0  test/unit/chatgpt-conversation-state.test.ts -> _git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/test__unit__chatgpt-conversation-state.test.ts.patch
[24] M +65 -5  test/unit/session-reconciler.test.ts -> _git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/test__unit__session-reconciler.test.ts.patch
[25] M +7 -2  test/unit/slack-cloak-bridge.test.ts -> _git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/test__unit__slack-cloak-bridge.test.ts.patch
[26] M +5 -1  test/unit/slack-formatter.test.ts -> _git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/test__unit__slack-formatter.test.ts.patch
[27] M +1 -1  tsconfig.json -> _git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/tsconfig.json.patch

SECTION: NOTES
NOTE_PATCH_OMITTED_COUNT: 0
NOTE_QUICK_MODE: false
```

File: /Users/danielsivan/dev/surf-cli/native/chatgpt-cloak-runtime.cjs
```cjs
"use strict";

const { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, unlinkSync } = require("fs");
const { homedir, tmpdir } = require("os");
const { join } = require("path");

const SHARED_PROFILE_DIR = () => join(homedir(), ".surf", "cloak-profile");
const DEFAULT_TEMP_PREFIX = "surf-cloak-session-";

function fallbackLog() {}

function cleanupSingletonLock(userDataDir, { log = fallbackLog } = {}) {
  if (!userDataDir) return false;
  const lockPath = join(userDataDir, "SingletonLock");
  try {
    lstatSync(lockPath);
  } catch {
    return false;
  }

  try {
    const target = readlinkSync(lockPath);
    const pidMatch = target.match(/-(\d+)$/);
    if (pidMatch) {
      try {
        process.kill(Number(pidMatch[1]), 0);
        return false;
      } catch {
        unlinkSync(lockPath);
        log("info", "Cleaned stale SingletonLock", { target, lockPath });
        return true;
      }
    }
    return false;
  } catch {
    try {
      unlinkSync(lockPath);
      log("info", "Removed unreadable SingletonLock", { lockPath });
      return true;
    } catch (error) {
      try {
        rmSync(lockPath, { force: true });
        log("info", "Removed unreadable SingletonLock via rmSync", { lockPath });
        return true;
      } catch {
        log("warn", "Failed to remove SingletonLock", { lockPath, error: error?.message || String(error) });
        return false;
      }
    }
  }
}

function sharedProfileDir({ log = fallbackLog } = {}) {
  const dir = SHARED_PROFILE_DIR();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  cleanupSingletonLock(dir, { log });
  return dir;
}

function tempProfileDir(prefix = DEFAULT_TEMP_PREFIX) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function buildLaunchOpts(userDataDir) {
  return {
    userDataDir,
    headless: true,
    humanize: true,
    humanPreset: "careful",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
    timezoneId: "America/New_York",
    args: ["--fingerprint-storage-quota=5000"],
  };
}

function isRecoverableProfileLaunchError(error) {
  const text = [
    error?.message || "",
    error?.stderr || "",
    error?.details?.message || "",
    error?.cause?.message || "",
  ].join(" ");
  return /ProcessSingleton|SingletonLock|profile directory|profile.+in use|already in use/i.test(text);
}

function normalizeProfileLaunchError(error, userDataDir) {
  const normalized = Object.assign(
    new Error("CloakBrowser profile locked. Close other surf instances first."),
    {
      code: "profile_locked",
      userDataDir,
      details: {
        userDataDir,
        originalMessage: error?.message || String(error),
      },
      cause: error,
    },
  );
  return normalized;
}

async function launchPersistentContextWithRecovery({
  launchPersistentContext,
  userDataDir,
  isSharedProfile = false,
  log = fallbackLog,
} = {}) {
  const launchOnce = () => launchPersistentContext(buildLaunchOpts(userDataDir));

  try {
    return await launchOnce();
  } catch (error) {
    const recoverable = isRecoverableProfileLaunchError(error);
    if (!recoverable) throw error;
    if (!isSharedProfile) throw normalizeProfileLaunchError(error, userDataDir);

    log("warn", "Recoverable profile launch failure; retrying after lock cleanup", {
      userDataDir,
      error: error?.message || String(error),
    });
    cleanupSingletonLock(userDataDir, { log });

    try {
      return await launchOnce();
    } catch (retryError) {
      if (isRecoverableProfileLaunchError(retryError)) {
        throw normalizeProfileLaunchError(retryError, userDataDir);
      }
      throw retryError;
    }
  }
}

module.exports = {
  buildLaunchOpts,
  cleanupSingletonLock,
  isRecoverableProfileLaunchError,
  launchPersistentContextWithRecovery,
  sharedProfileDir,
  tempProfileDir,
};

```

File: /Users/danielsivan/dev/surf-cli/test/unit/chatgpt-cloak-runtime.test.ts
```ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const runtime = require("../../native/chatgpt-cloak-runtime.cjs") as {
  cleanupSingletonLock: (dir: string, opts?: { log?: (...args: any[]) => void }) => boolean;
  sharedProfileDir: (opts?: { log?: (...args: any[]) => void }) => string;
  launchPersistentContextWithRecovery: (opts: {
    launchPersistentContext: (opts: any) => Promise<any>;
    userDataDir: string;
    isSharedProfile?: boolean;
    log?: (...args: any[]) => void;
  }) => Promise<any>;
};

describe("chatgpt-cloak-runtime", () => {
  const originalHome = process.env.HOME;

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  });

  it("cleans a stale SingletonLock symlink when the pid is gone", () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "surf-runtime-home-"));
    process.env.HOME = tmpHome;

    const profileDir = runtime.sharedProfileDir();
    const lockPath = path.join(profileDir, "SingletonLock");
    fs.symlinkSync(`host-999999999`, lockPath);

    const removed = runtime.cleanupSingletonLock(profileDir);

    expect(removed).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(false);
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("removes a non-symlink SingletonLock via fallback cleanup", () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "surf-runtime-home-"));
    process.env.HOME = tmpHome;

    const profileDir = runtime.sharedProfileDir();
    const lockPath = path.join(profileDir, "SingletonLock");
    fs.writeFileSync(lockPath, "not-a-symlink");

    const removed = runtime.cleanupSingletonLock(profileDir);

    expect(removed).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(false);
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("retries once on shared-profile launch lock errors and returns the retried context", async () => {
    const launchPersistentContext = vi
      .fn()
      .mockRejectedValueOnce(new Error("Failed to create a ProcessSingleton for your profile directory"))
      .mockResolvedValueOnce({ ok: true });

    const result = await runtime.launchPersistentContextWithRecovery({
      launchPersistentContext,
      userDataDir: "/tmp/shared-profile",
      isSharedProfile: true,
    });

    expect(result).toEqual({ ok: true });
    expect(launchPersistentContext).toHaveBeenCalledTimes(2);
  });

  it("does not retry lock errors for non-shared profiles", async () => {
    const launchPersistentContext = vi
      .fn()
      .mockRejectedValue(new Error("Failed to create a ProcessSingleton for your profile directory"));

    await expect(
      runtime.launchPersistentContextWithRecovery({
        launchPersistentContext,
        userDataDir: "/tmp/temp-profile",
        isSharedProfile: false,
      }),
    ).rejects.toMatchObject({
      code: "profile_locked",
      userDataDir: "/tmp/temp-profile",
    });

    expect(launchPersistentContext).toHaveBeenCalledTimes(1);
  });
});

```

File: /Users/danielsivan/dev/surf-cli/test/unit/chatgpt-conversation-state.test.ts
```ts
import { describe, expect, it } from "vitest";

const { classifyConversationProgress } = require("../../native/chatgpt-conversation-state.cjs") as {
  classifyConversationProgress: (conversation: any, options?: { baselineAssistantMessageId?: string | null }) => {
    state: string;
    nodeId: string | null;
    role: string | null;
    status: string | null;
    hasText: boolean;
    model: string | null;
  };
};

describe("chatgpt-conversation-state", () => {
  it("classifies a new completed assistant turn", () => {
    const conversation = {
      current_node: "a2",
      mapping: {
        a2: {
          message: {
            author: { role: "assistant" },
            status: "finished_successfully",
            content: { parts: ["done"] },
            metadata: { model_slug: "gpt-5.4-pro" },
          },
        },
      },
    };

    expect(classifyConversationProgress(conversation, { baselineAssistantMessageId: "a1" })).toEqual({
      state: "assistant_complete",
      nodeId: "a2",
      role: "assistant",
      status: "finished_successfully",
      hasText: true,
      model: "gpt-5.4-pro",
    });
  });

  it("classifies the baseline assistant turn separately", () => {
    const conversation = {
      current_node: "a1",
      mapping: {
        a1: {
          message: {
            author: { role: "assistant" },
            status: "finished_successfully",
            content: { parts: ["old"] },
            metadata: {},
          },
        },
      },
    };

    expect(classifyConversationProgress(conversation, { baselineAssistantMessageId: "a1" }).state).toBe(
      "assistant_complete_baseline",
    );
  });

  it("classifies a current user node as awaiting_assistant", () => {
    const conversation = {
      current_node: "u1",
      mapping: {
        u1: {
          message: {
            author: { role: "user" },
            status: "finished_successfully",
            content: { parts: ["hello"] },
          },
        },
      },
    };

    expect(classifyConversationProgress(conversation).state).toBe("awaiting_assistant");
  });

  it("classifies assistant in-progress turns", () => {
    const conversation = {
      current_node: "a2",
      mapping: {
        a2: {
          message: {
            author: { role: "assistant" },
            status: "in_progress",
            content: { parts: ["partial"] },
          },
        },
      },
    };

    expect(classifyConversationProgress(conversation).state).toBe("assistant_in_progress");
  });

  it("returns invalid for missing or ill-formed current node state", () => {
    expect(classifyConversationProgress(null).state).toBe("invalid");
    expect(classifyConversationProgress({ current_node: "x", mapping: {} }).state).toBe("invalid");
  });
});

```

File: /Users/danielsivan/dev/surf-cli/native/chatgpt-conversation-state.cjs
```cjs
"use strict";

const { extractMessageText } = require("./chatgpt-chats-formatter.cjs");

function isAssistantCompleteStatus(status) {
  return typeof status === "string" && /^(finished_successfully|finished)$/i.test(status.trim());
}

function isAssistantInProgressStatus(status) {
  return typeof status === "string" && /^(in_progress|streaming|pending|queued)$/i.test(status.trim());
}

function classifyConversationProgress(conversation, { baselineAssistantMessageId = null } = {}) {
  if (!conversation || typeof conversation !== "object") {
    return { state: "invalid", nodeId: null, role: null, status: null, hasText: false, model: null };
  }

  const currentNodeId = typeof conversation.current_node === "string" ? conversation.current_node : null;
  const mapping = conversation.mapping && typeof conversation.mapping === "object" ? conversation.mapping : null;
  const node = currentNodeId && mapping ? mapping[currentNodeId] : null;
  const message = node && typeof node === "object" ? node.message : null;
  const role = message?.author?.role || null;
  const status = message?.status || null;
  const model = message?.metadata?.model_slug || null;
  const hasText = !!String(extractMessageText(message) || "").trim();

  if (!currentNodeId || !mapping || !node || !message || !role) {
    return { state: "invalid", nodeId: currentNodeId, role, status, hasText, model };
  }

  if (role === "user") {
    return { state: "awaiting_assistant", nodeId: currentNodeId, role, status, hasText, model };
  }

  if (role !== "assistant") {
    return { state: "invalid", nodeId: currentNodeId, role, status, hasText, model };
  }

  if (isAssistantCompleteStatus(status)) {
    const state = baselineAssistantMessageId && currentNodeId === baselineAssistantMessageId
      ? "assistant_complete_baseline"
      : "assistant_complete";
    return { state, nodeId: currentNodeId, role, status, hasText, model };
  }

  if (isAssistantInProgressStatus(status)) {
    return { state: "assistant_in_progress", nodeId: currentNodeId, role, status, hasText, model };
  }

  return { state: "invalid", nodeId: currentNodeId, role, status, hasText, model };
}

module.exports = {
  classifyConversationProgress,
};

```
</file_contents>
<git_diff>
diff --git a/native/chatgpt-cloak-runtime.cjs b/native/chatgpt-cloak-runtime.cjs
new file mode 100644
index 0000000..16eec3b
--- /dev/null
+++ b/native/chatgpt-cloak-runtime.cjs
@@ -0,0 +1,142 @@
+"use strict";
+
+const { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, unlinkSync } = require("fs");
+const { homedir, tmpdir } = require("os");
+const { join } = require("path");
+
+const SHARED_PROFILE_DIR = () => join(homedir(), ".surf", "cloak-profile");
+const DEFAULT_TEMP_PREFIX = "surf-cloak-session-";
+
+function fallbackLog() {}
+
+function cleanupSingletonLock(userDataDir, { log = fallbackLog } = {}) {
+  if (!userDataDir) return false;
+  const lockPath = join(userDataDir, "SingletonLock");
+  try {
+    lstatSync(lockPath);
+  } catch {
+    return false;
+  }
+
+  try {
+    const target = readlinkSync(lockPath);
+    const pidMatch = target.match(/-(\d+)$/);
+    if (pidMatch) {
+      try {
+        process.kill(Number(pidMatch[1]), 0);
+        return false;
+      } catch {
+        unlinkSync(lockPath);
+        log("info", "Cleaned stale SingletonLock", { target, lockPath });
+        return true;
+      }
+    }
+    return false;
+  } catch {
+    try {
+      unlinkSync(lockPath);
+      log("info", "Removed unreadable SingletonLock", { lockPath });
+      return true;
+    } catch (error) {
+      try {
+        rmSync(lockPath, { force: true });
+        log("info", "Removed unreadable SingletonLock via rmSync", { lockPath });
+        return true;
+      } catch {
+        log("warn", "Failed to remove SingletonLock", { lockPath, error: error?.message || String(error) });
+        return false;
+      }
+    }
+  }
+}
+
+function sharedProfileDir({ log = fallbackLog } = {}) {
+  const dir = SHARED_PROFILE_DIR();
+  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
+  cleanupSingletonLock(dir, { log });
+  return dir;
+}
+
+function tempProfileDir(prefix = DEFAULT_TEMP_PREFIX) {
+  return mkdtempSync(join(tmpdir(), prefix));
+}
+
+function buildLaunchOpts(userDataDir) {
+  return {
+    userDataDir,
+    headless: true,
+    humanize: true,
+    humanPreset: "careful",
+    viewport: { width: 1280, height: 800 },
+    locale: "en-US",
+    timezoneId: "America/New_York",
+    args: ["--fingerprint-storage-quota=5000"],
+  };
+}
+
+function isRecoverableProfileLaunchError(error) {
+  const text = [
+    error?.message || "",
+    error?.stderr || "",
+    error?.details?.message || "",
+    error?.cause?.message || "",
+  ].join(" ");
+  return /ProcessSingleton|SingletonLock|profile directory|profile.+in use|already in use/i.test(text);
+}
+
+function normalizeProfileLaunchError(error, userDataDir) {
+  const normalized = Object.assign(
+    new Error("CloakBrowser profile locked. Close other surf instances first."),
+    {
+      code: "profile_locked",
+      userDataDir,
+      details: {
+        userDataDir,
+        originalMessage: error?.message || String(error),
+      },
+      cause: error,
+    },
+  );
+  return normalized;
+}
+
+async function launchPersistentContextWithRecovery({
+  launchPersistentContext,
+  userDataDir,
+  isSharedProfile = false,
+  log = fallbackLog,
+} = {}) {
+  const launchOnce = () => launchPersistentContext(buildLaunchOpts(userDataDir));
+
+  try {
+    return await launchOnce();
+  } catch (error) {
+    const recoverable = isRecoverableProfileLaunchError(error);
+    if (!recoverable) throw error;
+    if (!isSharedProfile) throw normalizeProfileLaunchError(error, userDataDir);
+
+    log("warn", "Recoverable profile launch failure; retrying after lock cleanup", {
+      userDataDir,
+      error: error?.message || String(error),
+    });
+    cleanupSingletonLock(userDataDir, { log });
+
+    try {
+      return await launchOnce();
+    } catch (retryError) {
+      if (isRecoverableProfileLaunchError(retryError)) {
+        throw normalizeProfileLaunchError(retryError, userDataDir);
+      }
+      throw retryError;
+    }
+  }
+}
+
+module.exports = {
+  buildLaunchOpts,
+  cleanupSingletonLock,
+  isRecoverableProfileLaunchError,
+  launchPersistentContextWithRecovery,
+  sharedProfileDir,
+  tempProfileDir,
+};


diff --git a/native/cli.cjs b/native/cli.cjs
index d7ff7ab..f4c053a 100755
--- a/native/cli.cjs
+++ b/native/cli.cjs
@@ -49,6 +49,8 @@ Repo + local CLI verified against **surf-cli v2.11.1**.
 - Headless-only CLI.
 - ChatGPT uses CloakBrowser headless by default.
 - Gemini uses Bun WebView headless by default.
+- CLOAK_HEADLESS cannot enable headed mode.
+- SURF_USE_CLOAK_CHATGPT is obsolete.
 - Default profile on macOS: ${SURF_SKILL_BT}dsebban883@gmail.com${SURF_SKILL_BT} unless the user asks for another account.
 - Use ${SURF_SKILL_BT}--profile dsebban883@gmail.com${SURF_SKILL_BT} for reliable auth and file/image/chats features.
 
@@ -71,6 +73,7 @@ surf chatgpt "deep analysis" --model gpt-5.4-pro --profile dsebban883@gmail.com
 ${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}
 
 ${SURF_SKILL_BT}--prompt-file${SURF_SKILL_BT} reads the file as prompt text. Use it for large exported contexts. ${SURF_SKILL_BT}--file${SURF_SKILL_BT} uploads as an attachment.
+If RepoPrompt export stats show ${SURF_SKILL_BT}Files: 0${SURF_SKILL_BT}, rebuild selection/preset before sending.
 
 ### ChatGPT model aliases
 
@@ -97,6 +100,7 @@ Notes:
 - ${SURF_SKILL_BT}--delete${SURF_SKILL_BT} is destructive; no CLI undo.
 - Search may use a recent-history fallback; if JSON shows ${SURF_SKILL_BT}partial: true${SURF_SKILL_BT}, misses are not authoritative for older chats.
 - ${SURF_SKILL_BT}--download-file${SURF_SKILL_BT} needs ${SURF_SKILL_BT}--output${SURF_SKILL_BT}.
+- ${SURF_SKILL_BT}--export${SURF_SKILL_BT} waits briefly for a pending assistant turn before rendering.
 
 ## ChatGPT thinking trace
 
@@ -193,6 +197,27 @@ function loadPromptFile(rawPath) {
   return content;
 }
 
+function normalizeLegacyChatGptEnv() {
+  const debugEnabled = !!process.env.SURF_DEBUG;
+  const rawCloakHeadless = process.env.CLOAK_HEADLESS;
+  const rawLegacyCloakToggle = process.env.SURF_USE_CLOAK_CHATGPT;
+
+  if (rawCloakHeadless !== undefined) {
+    const normalized = String(rawCloakHeadless).trim().toLowerCase();
+    if (["0", "false", "no", "headed"].includes(normalized)) {
+      process.stderr.write("Warning: CLOAK_HEADLESS headed mode is unsupported and will be ignored.\n");
+    }
+    delete process.env.CLOAK_HEADLESS;
+  }
+
+  if (rawLegacyCloakToggle !== undefined) {
+    if (debugEnabled) {
+      process.stderr.write("[debug] Ignoring obsolete SURF_USE_CLOAK_CHATGPT env var.\n");
+    }
+    delete process.env.SURF_USE_CLOAK_CHATGPT;
+  }
+}
+
 // ============================================================================
 // Workflow Resolution and Management
 // ============================================================================
@@ -3007,6 +3032,8 @@ delete toolArgs["no-screenshot"];
 const softFail = toolArgs["soft-fail"] === true;
 delete toolArgs["soft-fail"];
 
+normalizeLegacyChatGptEnv();
+
 if (!noScreenshot && AUTO_SCREENSHOT_TOOLS.includes(tool)) {
   toolArgs.autoScreenshot = true;
 }
@@ -3275,19 +3302,6 @@ const performAutoCapture = async () => {
 const CHATGPT_CLOAK_ONLY_TOOLS = new Set(["chatgpt.chats", "chatgpt.reply"]);
 const SLACK_CLOAK_TOOLS = new Set(["slack.read"]);
 
-const withOptionalHeadedCloak = async (enabled, fn) => {
-  const previous = process.env.CLOAK_HEADLESS;
-  if (enabled) process.env.CLOAK_HEADLESS = "0";
-  try {
-    return await fn();
-  } finally {
-    if (enabled) {
-      if (previous === undefined) delete process.env.CLOAK_HEADLESS;
-      else process.env.CLOAK_HEADLESS = previous;
-    }
-  }
-};
-
 const printChatGptChatsResult = (result, opts = {}) => {
   if (result.action === "rename") {
     if (wantJson) console.log(JSON.stringify(result ?? null, null, 2));
@@ -3336,6 +3350,9 @@ const printChatGptChatsResult = (result, opts = {}) => {
       } else {
         console.log(`Exported conversation to: ${opts.exportPath}`);
       }
+      if (result.stabilized === false) {
+        process.stderr.write("Warning: export completed before assistant turn stabilized; output may still be incomplete.\n");
+      }
     }
     if (wantJson) {
       console.log(JSON.stringify(result.conversation ?? null, null, 2));
@@ -3380,7 +3397,7 @@ const runChatGptCloakQueryDirect = async (sessionTool, queryArgs) => {
   let lastProgress = "";
   let sawSentCheckpoint = false;
   try {
-    const result = await withOptionalHeadedCloak(false, () => queryWithCloakBrowser(queryArgs, (progress) => {
+    const result = await queryWithCloakBrowser(queryArgs, (progress) => {
       if (progress.type === "meta_update") {
         const patch = {};
         if (progress.conversationId)             patch.conversationId             = progress.conversationId;
@@ -3419,7 +3436,7 @@ const runChatGptCloakQueryDirect = async (sessionTool, queryArgs) => {
         process.stderr.write(msg + "\n");
         lastProgress = msg;
       }
-    }));
+    });
 
     const durationMs = result.tookMs || (Date.now() - startMs);
     if (sessionTool === "chatgpt.reply") chatgptChatsCache.invalidateCachedChats();
@@ -3489,7 +3506,8 @@ const runChatGptChatsDirect = async (chatArgs, renderOpts = {}) => {
   let lastProgress = "";
   try {
     const cacheable = ["list", "search", "get"].includes(chatArgs.action)
-      && chatArgs.useCache !== false;
+      && chatArgs.useCache !== false
+      && !(chatArgs.action === "get" && chatArgs.waitForAssistant === true);
     if (cacheable) {
       const cached = chatgptChatsCache.getCachedChats(chatArgs);
       if (cached) {
@@ -3500,13 +3518,13 @@ const runChatGptChatsDirect = async (chatArgs, renderOpts = {}) => {
       }
     }
 
-    const result = await withOptionalHeadedCloak(false, () => manageChatsWithCloakBrowser(chatArgs, (progress) => {
+    const result = await manageChatsWithCloakBrowser(chatArgs, (progress) => {
       const msg = `[cloak-chatgpt.chats] [${progress.step}/${progress.total}] ${progress.message}`;
       if (msg !== lastProgress) {
         process.stderr.write(msg + "\n");
         lastProgress = msg;
       }
-    }));
+    });
 
     if (cacheable) chatgptChatsCache.setCachedChats(chatArgs, result);
     if (["rename", "delete", "bulk_delete"].includes(chatArgs.action)) chatgptChatsCache.invalidateCachedChats();
@@ -3737,6 +3755,7 @@ if (tool === "chatgpt.chats") {
               ? "search"
               : "list";
   (async () => {
+    const waitForAssistant = action === "get" && !!exportPath;
     const chatArgs = {
       action,
       conversationId: conversationId || undefined,
@@ -3751,6 +3770,8 @@ if (tool === "chatgpt.chats") {
       includeBytes: !!fileId,
       outputPath: outputPath || undefined,
       useCache,
+      waitForAssistant,
+      waitForAssistantTimeoutSec: waitForAssistant ? 30 : undefined,
     };
     await runChatGptChatsDirect(chatArgs, {
       messageLimit: action === "get" ? limit : undefined,


diff --git a/native/chatgpt-cloak-chats-worker.mjs b/native/chatgpt-cloak-chats-worker.mjs
index 4707e76..fe1e97e 100644
--- a/native/chatgpt-cloak-chats-worker.mjs
+++ b/native/chatgpt-cloak-chats-worker.mjs
@@ -6,8 +6,8 @@
  */
 
 import { launchPersistentContext } from 'cloakbrowser';
-import { existsSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, unlinkSync, writeFileSync } from 'fs';
-import { homedir, tmpdir } from 'os';
+import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
+import { createRequire } from 'module';
 import { join, dirname, resolve as pathResolve } from 'path';
 import { loadAndInjectChatgptCookies } from './chatgpt-cloak-profile-auth.mjs';
 import {
@@ -16,6 +16,16 @@ import {
   normalizeConversationSearchItems,
 } from './chatgpt-chats-search.mjs';
 
+const require = createRequire(import.meta.url);
+const {
+  classifyConversationProgress,
+} = require('./chatgpt-conversation-state.cjs');
+const {
+  launchPersistentContextWithRecovery,
+  sharedProfileDir,
+  tempProfileDir,
+} = require('./chatgpt-cloak-runtime.cjs');
+
 const emit = (obj) => process.stdout.write(JSON.stringify({ ...obj, t: Date.now() }) + '\n');
 const log = (level, message, data) => emit({ type: 'log', level, message, data });
 const progress = (step, total, message) => emit({ type: 'progress', step, total, message });
@@ -24,48 +34,6 @@ const fail = (code, message, details) => emit({ type: 'error', code, message, de
 
 const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
 
-function sharedProfileDir() {
-  const dir = join(homedir(), '.surf', 'cloak-profile');
-  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
-  // Clean stale SingletonLock from crashed sessions
-  const lockPath = join(dir, 'SingletonLock');
-  if (existsSync(lockPath)) {
-    try {
-      const target = readlinkSync(lockPath);
-      // Format: hostname-pid — check if PID is still alive
-      const pidMatch = target.match(/-(\d+)$/);
-      if (pidMatch) {
-        try { process.kill(Number(pidMatch[1]), 0); } catch {
-          // PID not running → stale lock
-          unlinkSync(lockPath);
-          log('info', 'Cleaned stale SingletonLock', { target });
-        }
-      }
-    } catch {
-      // readlink failed (not a symlink) or unlink failed — try removing anyway
-      try { unlinkSync(lockPath); } catch {}
-    }
-  }
-  return dir;
-}
-
-function tempProfileDir() {
-  return mkdtempSync(join(tmpdir(), 'surf-cloak-chats-'));
-}
-
-function buildLaunchOpts(userDataDir) {
-  return {
-    userDataDir,
-    headless: true,
-    humanize: true,
-    humanPreset: 'careful',
-    viewport: { width: 1280, height: 800 },
-    locale: 'en-US',
-    timezoneId: 'America/New_York',
-    args: ['--fingerprint-storage-quota=5000'],
-  };
-}
-
 async function waitForReady(page, timeoutMs = 30_000) {
   const deadline = Date.now() + timeoutMs;
   while (Date.now() < deadline) {
@@ -620,12 +588,52 @@ async function apiSearchConversations(context, accessToken, { query, limit }) {
   };
 }
 
-async function apiGetConversation(context, accessToken, conversationId) {
-  const data = await apiRequest(context, {
-    pathname: `/backend-api/conversation/${encodeURIComponent(conversationId)}`,
-    accessToken,
-  });
-  return { action: 'get', conversationId, conversation: data };
+async function apiGetConversation(context, accessToken, conversationId, options = {}) {
+  const waitForAssistant = options.waitForAssistant === true;
+  const waitForAssistantTimeoutSec = Number.isFinite(Number(options.waitForAssistantTimeoutSec))
+    ? Math.max(1, Math.trunc(Number(options.waitForAssistantTimeoutSec)))
+    : 30;
+  const baselineAssistantMessageId = options.baselineAssistantMessageId || null;
+  const startedAt = Date.now();
+
+  let conversation = null;
+  let conversationState = 'invalid';
+  let stabilized = false;
+
+  while (true) {
+    conversation = await apiRequest(context, {
+      pathname: `/backend-api/conversation/${encodeURIComponent(conversationId)}`,
+      accessToken,
+    });
+    const classified = classifyConversationProgress(conversation, { baselineAssistantMessageId });
+    conversationState = classified.state;
+
+    if (!waitForAssistant) {
+      stabilized = classified.state === 'assistant_complete';
+      break;
+    }
+
+    if (!['awaiting_assistant', 'assistant_in_progress', 'assistant_complete_baseline'].includes(classified.state)) {
+      stabilized = classified.state === 'assistant_complete';
+      break;
+    }
+
+    if ((Date.now() - startedAt) >= waitForAssistantTimeoutSec * 1000) {
+      stabilized = false;
+      break;
+    }
+
+    await sleep(1000);
+  }
+
+  return {
+    action: 'get',
+    conversationId,
+    conversation,
+    stabilized,
+    conversationState,
+    waitedMs: Date.now() - startedAt,
+  };
 }
 
 async function apiDeleteConversation(context, accessToken, conversationId) {
@@ -723,14 +731,34 @@ async function apiDownloadFile(context, accessToken, fileId, outputPath) {
 // Main action runner (uses API-direct fast path — no page navigation)
 // ---------------------------------------------------------------------------
 
-async function runAction({ action, conversationId, conversationIds, query, limit, all, profile, timeout = 120, title, fileId, outputPath }) {
+async function runAction({
+  action,
+  conversationId,
+  conversationIds,
+  query,
+  limit,
+  all,
+  profile,
+  timeout = 120,
+  title,
+  fileId,
+  outputPath,
+  waitForAssistant = false,
+  waitForAssistantTimeoutSec = 30,
+  baselineAssistantMessageId = null,
+}) {
   let context = null;
   let tempDir = null;
   try {
     progress(1, 4, 'Launching CloakBrowser');
 
-    const userDataDir = profile ? (tempDir = tempProfileDir()) : sharedProfileDir();
-    context = await launchPersistentContext(buildLaunchOpts(userDataDir));
+    const userDataDir = profile ? (tempDir = tempProfileDir('surf-cloak-chats-')) : sharedProfileDir({ log });
+    context = await launchPersistentContextWithRecovery({
+      launchPersistentContext,
+      userDataDir,
+      isSharedProfile: !profile,
+      log,
+    });
 
     if (profile) {
       progress(2, 4, 'Loading ChatGPT cookies from Chrome profile');
@@ -752,7 +780,11 @@ async function runAction({ action, conversationId, conversationIds, query, limit
       case 'search':
         result = await apiSearchConversations(context, accessToken, { query, limit }); break;
       case 'get':
-        result = await apiGetConversation(context, accessToken, conversationId); break;
+        result = await apiGetConversation(context, accessToken, conversationId, {
+          waitForAssistant,
+          waitForAssistantTimeoutSec,
+          baselineAssistantMessageId,
+        }); break;
       case 'delete':
         result = await apiDeleteConversation(context, accessToken, conversationId); break;
       case 'bulk_delete':


diff --git a/test/unit/chatgpt-cloak-runtime.test.ts b/test/unit/chatgpt-cloak-runtime.test.ts
new file mode 100644
index 0000000..b0bd64f
--- /dev/null
+++ b/test/unit/chatgpt-cloak-runtime.test.ts
@@ -0,0 +1,89 @@
+import * as fs from "node:fs";
+import * as os from "node:os";
+import * as path from "node:path";
+import { afterEach, describe, expect, it, vi } from "vitest";
+
+const runtime = require("../../native/chatgpt-cloak-runtime.cjs") as {
+  cleanupSingletonLock: (dir: string, opts?: { log?: (...args: any[]) => void }) => boolean;
+  sharedProfileDir: (opts?: { log?: (...args: any[]) => void }) => string;
+  launchPersistentContextWithRecovery: (opts: {
+    launchPersistentContext: (opts: any) => Promise<any>;
+    userDataDir: string;
+    isSharedProfile?: boolean;
+    log?: (...args: any[]) => void;
+  }) => Promise<any>;
+};
+
+describe("chatgpt-cloak-runtime", () => {
+  const originalHome = process.env.HOME;
+
+  afterEach(() => {
+    if (originalHome === undefined) delete process.env.HOME;
+    else process.env.HOME = originalHome;
+  });
+
+  it("cleans a stale SingletonLock symlink when the pid is gone", () => {
+    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "surf-runtime-home-"));
+    process.env.HOME = tmpHome;
+
+    const profileDir = runtime.sharedProfileDir();
+    const lockPath = path.join(profileDir, "SingletonLock");
+    fs.symlinkSync(`host-999999999`, lockPath);
+
+    const removed = runtime.cleanupSingletonLock(profileDir);
+
+    expect(removed).toBe(true);
+    expect(fs.existsSync(lockPath)).toBe(false);
+    fs.rmSync(tmpHome, { recursive: true, force: true });
+  });
+
+  it("removes a non-symlink SingletonLock via fallback cleanup", () => {
+    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "surf-runtime-home-"));
+    process.env.HOME = tmpHome;
+
+    const profileDir = runtime.sharedProfileDir();
+    const lockPath = path.join(profileDir, "SingletonLock");
+    fs.writeFileSync(lockPath, "not-a-symlink");
+
+    const removed = runtime.cleanupSingletonLock(profileDir);
+
+    expect(removed).toBe(true);
+    expect(fs.existsSync(lockPath)).toBe(false);
+    fs.rmSync(tmpHome, { recursive: true, force: true });
+  });
+
+  it("retries once on shared-profile launch lock errors and returns the retried context", async () => {
+    const launchPersistentContext = vi
+      .fn()
+      .mockRejectedValueOnce(new Error("Failed to create a ProcessSingleton for your profile directory"))
+      .mockResolvedValueOnce({ ok: true });
+
+    const result = await runtime.launchPersistentContextWithRecovery({
+      launchPersistentContext,
+      userDataDir: "/tmp/shared-profile",
+      isSharedProfile: true,
+    });
+
+    expect(result).toEqual({ ok: true });
+    expect(launchPersistentContext).toHaveBeenCalledTimes(2);
+  });
+
+  it("does not retry lock errors for non-shared profiles", async () => {
+    const launchPersistentContext = vi
+      .fn()
+      .mockRejectedValue(new Error("Failed to create a ProcessSingleton for your profile directory"));
+
+    await expect(
+      runtime.launchPersistentContextWithRecovery({
+        launchPersistentContext,
+        userDataDir: "/tmp/temp-profile",
+        isSharedProfile: false,
+      }),
+    ).rejects.toMatchObject({
+      code: "profile_locked",
+      userDataDir: "/tmp/temp-profile",
+    });
+
+    expect(launchPersistentContext).toHaveBeenCalledTimes(1);
+  });
+});


diff --git a/native/chatgpt-cloak-worker.mjs b/native/chatgpt-cloak-worker.mjs
index 73c2686..cf2a2ae 100644
--- a/native/chatgpt-cloak-worker.mjs
+++ b/native/chatgpt-cloak-worker.mjs
@@ -10,13 +10,17 @@
  */
 
 import { launchPersistentContext } from 'cloakbrowser';
-import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
+import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
 import { createRequire } from 'module';
-import { homedir, tmpdir } from 'os';
 import { join, resolve as pathResolve } from 'path';
 import { loadAndInjectChatgptCookies } from './chatgpt-cloak-profile-auth.mjs';
 
 const require = createRequire(import.meta.url);
+const {
+  launchPersistentContextWithRecovery,
+  sharedProfileDir,
+  tempProfileDir,
+} = require('./chatgpt-cloak-runtime.cjs');
 const { enterPromptWithVerification } = require('./chatgpt-cloak-prompt-entry.cjs');
 const {
   extractLatestActiveUserMessage,
@@ -89,38 +93,6 @@ function sanitize(raw) {
   return text.trim();
 }
 
-// ============================================================================
-// Profile directory management
-
-/** Shared persistent profile for no-auth sessions */
-function sharedProfileDir() {
-  const dir = join(homedir(), '.surf', 'cloak-profile');
-  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
-  return dir;
-}
-
-/** Isolated temp profile for --profile sessions (prevents cookie contamination) */
-function tempProfileDir() {
-  return mkdtempSync(join(tmpdir(), 'surf-cloak-session-'));
-}
-
-// ============================================================================
-// Launch options builder
-
-function buildLaunchOpts(userDataDir) {
-  return {
-    userDataDir,
-    headless: true,
-    humanize: true,
-    humanPreset: 'careful',
-    viewport: { width: 1280, height: 800 },
-    locale: 'en-US',
-    timezoneId: 'America/New_York',
-    args: ['--fingerprint-storage-quota=5000'],
-  };
-}
-
-// ============================================================================
 // Readiness checks
 
 async function waitForReady(page, timeoutMs = 30_000) {
@@ -324,6 +296,202 @@ async function waitForPromptPersistenceValidation({
   return { ...lastObserved, ok: false, timedOut: true };
 }
 
+async function inspectSendStartState(page, expectedPrompt) {
+  return await page.evaluate((promptSelectors, stopSelector, expected) => {
+    const normalize = (value) => String(value || '').replace(/\r\n/g, '\n').trim();
+    const isVisible = (el) => {
+      if (!el || !(el instanceof HTMLElement)) return false;
+      const style = window.getComputedStyle(el);
+      if (!style) return false;
+      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) return false;
+      const rect = el.getBoundingClientRect();
+      return rect.width > 0 && rect.height > 0;
+    };
+    const isEnabled = (el) => {
+      if (!el) return false;
+      if (el.disabled) return false;
+      const aria = (el.getAttribute('aria-disabled') || '').toLowerCase();
+      return aria !== 'true';
+    };
+
+    let stopVisible = false;
+    const stopButtons = document.querySelectorAll(stopSelector);
+    for (const button of stopButtons) {
+      if (isVisible(button) && isEnabled(button)) {
+        stopVisible = true;
+        break;
+      }
+    }
+
+    let composerText = '';
+    for (const selector of promptSelectors) {
+      const el = document.querySelector(selector);
+      if (!el) continue;
+      if ('value' in el && typeof el.value === 'string') {
+        composerText = el.value;
+      } else {
+        composerText = el.innerText || el.textContent || '';
+      }
+      break;
+    }
+
+    const normalizedComposer = normalize(composerText);
+    const normalizedExpected = normalize(expected);
+    return {
+      stopVisible,
+      composerCleared: normalizedComposer.length === 0,
+      promptStillPresent: normalizedComposer.length > 0 && normalizedComposer === normalizedExpected,
+      composerChars: normalizedComposer.length,
+    };
+  }, PROMPT_SELECTOR_LIST, STOP_BUTTON_SELECTOR, expectedPrompt);
+}
+
+async function probeSendConfirmation({
+  page,
+  expectedPrompt,
+  conversationId,
+  baselineUserNodeId,
+  timeoutMs = 5_000,
+}) {
+  const deadline = Date.now() + timeoutMs;
+  const hadConversationIdBeforeSend = !!conversationId;
+  let lastDomState = null;
+
+  while (Date.now() < deadline) {
+    const detectedConversationId = conversationId || extractConversationIdFromUrl(page.url());
+    if (detectedConversationId) {
+      const validation = await waitForPromptPersistenceValidation({
+        page,
+        conversationId: detectedConversationId,
+        expectedPrompt,
+        baselineUserNodeId,
+        timeoutMs: Math.max(1_500, Math.min(4_000, timeoutMs)),
+        pollMs: 400,
+      });
+      if (validation.ok) {
+        return {
+          confirmed: true,
+          conversationId: detectedConversationId,
+          validation,
+          confirmationSource: 'prompt_persisted',
+        };
+      }
+
+      lastDomState = await inspectSendStartState(page, expectedPrompt);
+      const definitiveValidationFailure = ['file_map_placeholder', 'big_paste_attachment'].includes(validation.failureReason || '');
+      const independentSendSignal = !hadConversationIdBeforeSend
+        || lastDomState.stopVisible
+        || lastDomState.composerCleared
+        || !lastDomState.promptStillPresent;
+      if (definitiveValidationFailure || independentSendSignal) {
+        return {
+          confirmed: true,
+          conversationId: detectedConversationId,
+          validation,
+          confirmationSource: definitiveValidationFailure ? 'prompt_persisted_invalid' : 'conversation_detected',
+          domState: lastDomState,
+        };
+      }
+
+      await sleep(350);
+      continue;
+    }
+
+    lastDomState = await inspectSendStartState(page, expectedPrompt);
+    if (lastDomState.stopVisible || lastDomState.composerCleared || !lastDomState.promptStillPresent) {
+      return {
+        confirmed: true,
+        conversationId: null,
+        validation: null,
+        confirmationSource: lastDomState.stopVisible
+          ? 'stop_button'
+          : lastDomState.composerCleared
+            ? 'composer_cleared'
+            : 'composer_changed',
+        domState: lastDomState,
+      };
+    }
+
+    await sleep(350);
+  }
+
+  return {
+    confirmed: false,
+    conversationId: null,
+    validation: null,
+    confirmationSource: null,
+    domState: lastDomState,
+  };
+}
+
+async function attemptSendAndConfirm({
+  page,
+  textarea,
+  promptEntry,
+  finalPrompt,
+  conversationId,
+  baselineUserNodeId,
+}) {
+  const tryConfirmation = async ({ method, selector = null, attemptError = null }) => {
+    const sentAt = new Date().toISOString();
+    const probe = await probeSendConfirmation({
+      page,
+      expectedPrompt: finalPrompt,
+      conversationId,
+      baselineUserNodeId,
+      timeoutMs: 5_000,
+    });
+    return {
+      ...probe,
+      method,
+      selector,
+      sentAt,
+      attemptError: attemptError ? (attemptError.message || String(attemptError)) : null,
+    };
+  };
+
+  if (promptEntry.sendEnabled) {
+    for (const sel of SEND_BUTTON_SELECTORS) {
+      let attemptError = null;
+      try {
+        const btn = page.locator(sel).first();
+        await btn.click({ timeout: 5_000 });
+        log('info', `Send button clicked: ${sel}`);
+      } catch (error) {
+        attemptError = error;
+        log('warn', `Send button attempt threw: ${sel}`, { error: error?.message || String(error) });
+      }
+
+      const result = await tryConfirmation({ method: 'click', selector: sel, attemptError });
+      if (result.confirmed) return result;
+      log('info', `Send attempt unconfirmed: ${sel}`, result.domState || {});
+    }
+  }
+
+  log(
+    promptEntry.sendButtonFound ? 'warn' : 'info',
+    promptEntry.sendButtonFound
+      ? 'Send button not confirmed after click attempts — pressing Enter'
+      : 'No send button found — pressing Enter'
+  );
+
+  let enterError = null;
+  try {
+    await textarea.press('Enter');
+  } catch (error) {
+    enterError = error;
+    log('warn', 'Enter send attempt threw', { error: error?.message || String(error) });
+  }
+
+  const result = await tryConfirmation({ method: 'enter', attemptError: enterError });
+  if (result.confirmed) return result;
+
+  throw Object.assign(
+    new Error('Prompt send did not confirm via click or Enter'),
+    { code: 'send_not_confirmed', details: { lastProbe: result.domState || null } },
+  );
+}
+
 // ============================================================================
 // Shared selectors — unified assistant-turn detection (mirrors bun worker)
 
@@ -779,6 +947,7 @@ async function runQuery({ prompt, model, file, profile, timeout = DEFAULT_CHATGP
   const resolved = resolveModel(model);
   const useInjectedProfile = !!profile;
   let tempDir = null;
+  let context = null;
 
   // ── Phase 1: Launch ──────────────────────────────────────────────────
   progress(1, 6, `Launching CloakBrowser — ${resolved.mode}`);
@@ -792,16 +961,10 @@ async function runQuery({ prompt, model, file, profile, timeout = DEFAULT_CHATGP
     userDataDir = tempDir;
     log('info', 'Using isolated profile for cookie injection', { tempDir });
   } else {
-    userDataDir = sharedProfileDir();
+    userDataDir = sharedProfileDir({ log });
     log('info', 'Using shared persistent profile');
   }
 
-  const context = await launchPersistentContext(buildLaunchOpts(userDataDir));
-  log('info', 'CloakBrowser launched', {
-    headless: true,
-    humanize: true,
-  });
-
   // Cleanup on forced kill
   const cleanup = async () => {
     try { await context.close(); } catch {}
@@ -811,6 +974,17 @@ async function runQuery({ prompt, model, file, profile, timeout = DEFAULT_CHATGP
   process.on('SIGINT', () => cleanup().then(() => process.exit(1)));
 
   try {
+    context = await launchPersistentContextWithRecovery({
+      launchPersistentContext,
+      userDataDir,
+      isSharedProfile: !useInjectedProfile,
+      log,
+    });
+    log('info', 'CloakBrowser launched', {
+      headless: true,
+      humanize: true,
+    });
+
     const page = context.pages()[0] || await context.newPage();
 
     // ── Phase 2: Cookie injection (if --profile) ─────────────────────
@@ -1001,73 +1175,48 @@ async function runQuery({ prompt, model, file, profile, timeout = DEFAULT_CHATGP
     const baselineMessageId = baseline.messageId || null; // For reconcile API comparison
     log('info', 'Baseline captured', { turnId: baselineTurnId, messageId: baselineMessageId });
 
-    // Send — prefer click when enabled, otherwise press Enter directly.
-    let sendTriggered = false;
-    if (promptEntry.sendEnabled) {
-      for (const sel of SEND_BUTTON_SELECTORS) {
-        try {
-          const btn = page.locator(sel).first();
-          await btn.click({ timeout: 5_000 });
-          sendTriggered = true;
-          log('info', `Send button clicked: ${sel}`);
-          break;
-        } catch {
-          log('info', `Send selector miss: ${sel}`);
-        }
-      }
-    }
-    if (!sendTriggered) {
-      log(
-        promptEntry.sendButtonFound ? 'warn' : 'info',
-        promptEntry.sendButtonFound
-          ? 'Send button not usable after inline insert — pressing Enter'
-          : 'No send button found — pressing Enter'
-      );
-      await textarea.press('Enter');
-    }
-
-    const sentAt = new Date().toISOString();
-    emit({
-      type: 'meta_update',
-      source: 'post_send',
-      lastCheckpoint: 'sent',
-      sentAt,
-      conversationId: conversationId || null,
-      baselineAssistantMessageId: baselineMessageId || null,
-      t: Date.now(),
+    const sendAttempt = await attemptSendAndConfirm({
+      page,
+      textarea,
+      promptEntry,
+      finalPrompt,
+      conversationId,
+      baselineUserNodeId,
+    });
+    const sentAt = sendAttempt.sentAt;
+    log('info', 'Send confirmed', {
+      method: sendAttempt.method,
+      selector: sendAttempt.selector || null,
+      confirmationSource: sendAttempt.confirmationSource,
+      conversationId: sendAttempt.conversationId || conversationId || null,
+      attemptError: sendAttempt.attemptError || null,
     });
 
-    const conversationIdBeforeResolve = conversationId || null;
-    conversationId = await resolveConversationIdForValidation(page, conversationId, 30_000);
-    if ((conversationId || null) !== conversationIdBeforeResolve) {
-      emit({
-        type: 'meta_update',
-        source: 'conversation_resolved',
-        lastCheckpoint: 'sent',
-        sentAt,
-        conversationId: conversationId || null,
-        baselineAssistantMessageId: baselineMessageId || null,
-        t: Date.now(),
-      });
+    conversationId = sendAttempt.conversationId || conversationId;
+
+    if (!conversationId) {
+      conversationId = await resolveConversationIdForValidation(page, conversationId, 30_000);
     }
 
     if (!conversationId) {
       fail(
-        'prompt_sent_validation_failed',
-        'Prompt send validation failed: conversationId did not resolve after send',
+        'send_not_confirmed',
+        'Prompt send could not be confirmed: conversationId did not resolve after send',
         { failureReason: 'conversation_id_unresolved' },
       );
       return;
     }
 
-    const sentPromptValidation = await waitForPromptPersistenceValidation({
-      page,
-      conversationId,
-      expectedPrompt: finalPrompt,
-      baselineUserNodeId,
-      timeoutMs: 30_000,
-      pollMs: 1_000,
-    });
+    const sentPromptValidation = sendAttempt.validation?.ok
+      ? sendAttempt.validation
+      : await waitForPromptPersistenceValidation({
+          page,
+          conversationId,
+          expectedPrompt: finalPrompt,
+          baselineUserNodeId,
+          timeoutMs: 30_000,
+          pollMs: 1_000,
+        });
     const validationSummary = summarizePromptValidation(sentPromptValidation);
     log('info', 'Sent prompt validation', validationSummary);
     if (!sentPromptValidation.ok) {
@@ -1084,6 +1233,16 @@ async function runQuery({ prompt, model, file, profile, timeout = DEFAULT_CHATGP
       return;
     }
 
+    emit({
+      type: 'meta_update',
+      source: 'prompt_persisted',
+      lastCheckpoint: 'sent',
+      sentAt,
+      conversationId: conversationId || null,
+      baselineAssistantMessageId: baselineMessageId || null,
+      t: Date.now(),
+    });
+
     // ── Phase 6: Wait for response (hybrid stream + DOM) ────────────
     progress(6, 6, 'Waiting for response');
 
@@ -1342,7 +1501,9 @@ async function runQuery({ prompt, model, file, profile, timeout = DEFAULT_CHATGP
     log('error', 'Query failed', { error: e.message, stack: e.stack, code: e.code });
     fail(e.code || 'query_failed', e.message, e.details);
   } finally {
-    await context.close();
+    if (context) {
+      try { await context.close(); } catch {}
+    }
     if (tempDir) {
       try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
     }


diff --git a/native/session-reconciler.cjs b/native/session-reconciler.cjs
index 56d7249..caa3b2e 100644
--- a/native/session-reconciler.cjs
+++ b/native/session-reconciler.cjs
@@ -17,6 +17,7 @@
 
 const { listSessions, updateSession, appendSessionLog, persistSessionResponse } = require("./session-store.cjs");
 const { extractMessageText, summarizeConversation } = require("./chatgpt-chats-formatter.cjs");
+const { classifyConversationProgress } = require("./chatgpt-conversation-state.cjs");
 
 // ============================================================================
 // Constants
@@ -106,43 +107,20 @@ function extractRecoveredAssistantPayload(conversation, nodeId = null) {
  *   outcome: 'completed' | 'no_new_assistant' | 'in_progress' | 'ambiguous'
  */
 function inspectConversation(conversation, meta = {}) {
-  if (!conversation || typeof conversation !== "object") {
-    return { outcome: "ambiguous", nodeId: null };
+  const classified = classifyConversationProgress(conversation, {
+    baselineAssistantMessageId: meta.baselineAssistantMessageId || null,
+  });
+  switch (classified.state) {
+    case "assistant_complete":
+      return { outcome: "completed", nodeId: classified.nodeId || null };
+    case "assistant_complete_baseline":
+      return { outcome: "no_new_assistant", nodeId: classified.nodeId || null };
+    case "assistant_in_progress":
+    case "awaiting_assistant":
+      return { outcome: "in_progress", nodeId: classified.nodeId || null };
+    default:
+      return { outcome: "ambiguous", nodeId: classified.nodeId || null };
   }
-
-  const mapping       = conversation.mapping;
-  const currentNodeId = conversation.current_node;
-
-  if (!mapping || !currentNodeId || !mapping[currentNodeId]) {
-    return { outcome: "ambiguous", nodeId: null };
-  }
-
-  const node = mapping[currentNodeId];
-  const msg  = node.message;
-  if (!msg) return { outcome: "ambiguous", nodeId: currentNodeId };
-
-  const status = msg.status;
-  const role   = msg.author && msg.author.role;
-
-  // Current node must be an assistant turn for a completed response
-  if (role !== "assistant") {
-    return { outcome: "no_new_assistant", nodeId: currentNodeId };
-  }
-
-  if (status === "finished_successfully") {
-    // Check if this is just the pre-existing baseline (same turn, no new content)
-    const baseline = meta.baselineAssistantMessageId;
-    if (baseline && currentNodeId === baseline) {
-      return { outcome: "no_new_assistant", nodeId: currentNodeId };
-    }
-    return { outcome: "completed", nodeId: currentNodeId };
-  }
-
-  if (status === "in_progress") {
-    return { outcome: "in_progress", nodeId: currentNodeId };
-  }
-
-  return { outcome: "ambiguous", nodeId: currentNodeId };
 }
 
 // ============================================================================
@@ -238,6 +216,9 @@ async function reconcileSessions(opts = {}) {
           conversationId,
           profile:        meta.args && meta.args.profile,
           timeout:        30,
+          waitForAssistant: true,
+          waitForAssistantTimeoutSec: 30,
+          baselineAssistantMessageId: meta.baselineAssistantMessageId || null,
         });
 
         // manageChatsWithCloakBrowser wraps the result — unwrap conversation


diff --git a/test/unit/session-reconciler.test.ts b/test/unit/session-reconciler.test.ts
index 83dc98b..efadb92 100644
--- a/test/unit/session-reconciler.test.ts
+++ b/test/unit/session-reconciler.test.ts
@@ -99,7 +99,7 @@ describe("inspectConversation", () => {
   it("returns ambiguous when mapping missing", () => {
     expect(inspectConversation({ current_node: "n1" })).toEqual({
       outcome: "ambiguous",
-      nodeId: null,
+      nodeId: "n1",
     });
   });
 
@@ -171,7 +171,7 @@ describe("inspectConversation", () => {
     expect(result.outcome).toBe("no_new_assistant");
   });
 
-  it("returns no_new_assistant when last node is user role", () => {
+  it("returns in_progress when last node is user role", () => {
     const conv = {
       current_node: "n1",
       mapping: {
@@ -180,7 +180,7 @@ describe("inspectConversation", () => {
         },
       },
     };
-    expect(inspectConversation(conv).outcome).toBe("no_new_assistant");
+    expect(inspectConversation(conv).outcome).toBe("in_progress");
   });
 
   it("returns in_progress when status is in_progress", () => {
@@ -358,7 +358,13 @@ describe("reconcileSessions", () => {
     expect(log).toContain("response saved:");
     expect(log).not.toContain("Recovered answer line 1");
     expect(mockManageChats).toHaveBeenCalledWith(
-      expect.objectContaining({ action: "get", conversationId: "conv-abc123" }),
+      expect.objectContaining({
+        action: "get",
+        conversationId: "conv-abc123",
+        waitForAssistant: true,
+        waitForAssistantTimeoutSec: 30,
+        baselineAssistantMessageId: null,
+      }),
     );
   });
 
@@ -545,7 +551,13 @@ describe("reconcileSessions", () => {
     expect(reconciled).toBe(1);
     expect(sessions[0].action).toBe("recovered");
     expect(mockManageChats).toHaveBeenCalledWith(
-      expect.objectContaining({ action: "get", conversationId: "conv-legacy" }),
+      expect.objectContaining({
+        action: "get",
+        conversationId: "conv-legacy",
+        waitForAssistant: true,
+        waitForAssistantTimeoutSec: 30,
+        baselineAssistantMessageId: null,
+      }),
     );
 
     const meta = readSessionMeta(tmpDir, "chatgpt-legacy-recoverable") as any;
@@ -617,6 +629,54 @@ describe("reconcileSessions", () => {
     expect(meta.reconcile.state).toBe("unresolved");
   });
 
+  it("marks unresolved when the remote current node is still the user turn", async () => {
+    const r = loadReconciler();
+    writeSessionMeta(tmpDir, {
+      id: "chatgpt-awaiting-assistant",
+      tool: "chatgpt",
+      status: "running",
+      createdAt: new Date(Date.now() - 5_000).toISOString(),
+      pid: 999999999,
+      conversationId: "conv-awaiting",
+      baselineAssistantMessageId: "old-assistant",
+      lastCheckpoint: "sent",
+      sentAt: "2026-04-05T12:01:00.000Z",
+    });
+
+    const awaitingAssistantConv = {
+      current_node: "u1",
+      mapping: {
+        u1: {
+          message: { status: "finished_successfully", author: { role: "user" }, content: { parts: ["still waiting"] } },
+        },
+      },
+    };
+
+    const mockManageChats = vi.fn().mockResolvedValue({ conversation: awaitingAssistantConv });
+
+    const { sessions } = await r.reconcileSessions({
+      all: true,
+      pollNetwork: true,
+      manageChats: mockManageChats,
+    });
+
+    expect(sessions[0].action).toBe("unresolved");
+    expect(mockManageChats).toHaveBeenCalledWith(
+      expect.objectContaining({
+        action: "get",
+        conversationId: "conv-awaiting",
+        waitForAssistant: true,
+        waitForAssistantTimeoutSec: 30,
+        baselineAssistantMessageId: "old-assistant",
+      }),
+    );
+
+    const meta = readSessionMeta(tmpDir, "chatgpt-awaiting-assistant") as any;
+    expect(meta.status).toBe("running");
+    expect(meta.reconcile.state).toBe("unresolved");
+    expect(meta.reconcile.remote.outcome).toBe("in_progress");
+  });
+
   it("handles poll failure gracefully — marks orphaned", async () => {
     const r = loadReconciler();
     writeSessionMeta(tmpDir, {


diff --git a/README.md b/README.md
index de27788..1b830f0 100644
--- a/README.md
+++ b/README.md
@@ -34,6 +34,7 @@ surf session --all
 - ChatGPT uses the bundled CloakBrowser runtime.
 - Gemini requires `bun` on `PATH` for the Bun WebView runtime.
 - `--profile <email>` profile selection is currently macOS-only; without it, ChatGPT uses `~/.surf/cloak-profile`.
+- ChatGPT always runs through CloakBrowser in headless mode. `CLOAK_HEADLESS` cannot enable headed mode, and `SURF_USE_CLOAK_CHATGPT` is obsolete.
 
 ## Installation
 
@@ -70,7 +71,7 @@ Common options:
 - `--profile <email>`: local profile email to use for signed-in auth.
 - `--model <model>`: `instant`, `thinking`, `pro`, or provider model names such as `gpt-5.4-pro`.
 - `--file <path>`: attach a file.
-- `--prompt-file <path>`: read the prompt from a file.
+- `--prompt-file <path>`: read the prompt from a file. Use this for exported RepoPrompt context; `--file` uploads an attachment instead of inlining prompt text.
 - `--generate-image <path>`: generate an image and save it.
 - `--timeout <seconds>`: inactivity timeout. Default: `2700` seconds.
 
@@ -115,12 +116,17 @@ Useful options:
 - `--limit <n>`: list count or last N visible messages when viewing.
 - `--all`: fetch all conversations.
 - `--search <query>`: search conversation titles and content.
-- `--export <path>` and `--format markdown|json`: save a viewed conversation.
+- `--export <path>` and `--format markdown|json`: save a viewed conversation. Export waits briefly for a pending assistant turn before rendering.
 - `--rename <title>`: rename a conversation.
 - `--delete` or `--delete-ids <ids>`: delete conversations.
 - `--download-file <file-id> --output <path>`: download an attachment.
 - `--no-cache`: bypass local chats cache.
 
+RepoPrompt / oracle export note:
+
+- Use `--prompt-file` for exported context, never `--file`.
+- If RepoPrompt export stats show `Files: 0`, rebuild the selection/preset before sending.
+
 ### `surf chatgpt.reply`
 
 Reply inside an existing ChatGPT conversation.
@@ -230,6 +236,7 @@ Then point your MCP-capable agent at the `surf` binary with the `server` argumen
 - Run `surf session <id>` to inspect a failed or long-running AI request.
 - Use `--timeout <seconds>` for long prompts, file uploads, or image generation.
 - Use `--profile <email>` consistently when multiple local accounts are signed in.
+- If you see `Files: 0` in RepoPrompt export stats, do not send that export to ChatGPT yet.
 
 ## License
 


diff --git a/native/chatgpt-cloak-bridge.cjs b/native/chatgpt-cloak-bridge.cjs
index 875c009..294143c 100644
--- a/native/chatgpt-cloak-bridge.cjs
+++ b/native/chatgpt-cloak-bridge.cjs
@@ -9,7 +9,6 @@ const { spawn } = require("child_process");
 const { existsSync } = require("fs");
 const { join, dirname } = require("path");
 const {
-  DEFAULT_CHATGPT_CHATS_TIMEOUT_SEC,
   resolveChatsTimeoutSeconds,
   resolveQueryTimeoutSeconds,
 } = require("./chatgpt-cloak-timeout.cjs");
@@ -55,7 +54,15 @@ function ensureAvailability(workerPath) {
   }
 }
 
-function runCloakWorker({ workerPath, request, timeout = DEFAULT_CHATGPT_CHATS_TIMEOUT_SEC, onProgress = () => {}, mapSuccess = (msg) => msg }) {
+function resolveWorkerTimeoutSeconds(timeout, request) {
+  const numeric = Number(timeout);
+  if (Number.isFinite(numeric) && numeric > 0) return numeric;
+  return request?.type === "query"
+    ? resolveQueryTimeoutSeconds(undefined)
+    : resolveChatsTimeoutSeconds(undefined);
+}
+
+function runCloakWorker({ workerPath, request, timeout, onProgress = () => {}, mapSuccess = (msg) => msg }) {
   ensureAvailability(workerPath);
 
   return new Promise((resolve, reject) => {
@@ -80,7 +87,8 @@ function runCloakWorker({ workerPath, request, timeout = DEFAULT_CHATGPT_CHATS_T
       env: { ...process.env },
     });
 
-    const timeoutMs = timeout * 1000;
+    const timeoutSec = resolveWorkerTimeoutSeconds(timeout, request);
+    const timeoutMs = timeoutSec * 1000;
     const armWorkerTimer = () => {
       clearWorkerTimer();
       timer = setTimeout(() => {
@@ -253,6 +261,9 @@ async function manageChatsWithCloakBrowser(opts, onProgress = () => {}) {
       fileId: opts.fileId,
       includeBytes: opts.includeBytes,
       outputPath: opts.outputPath,
+      waitForAssistant: opts.waitForAssistant,
+      waitForAssistantTimeoutSec: opts.waitForAssistantTimeoutSec,
+      baselineAssistantMessageId: opts.baselineAssistantMessageId,
     },
     timeout,
     onProgress,


diff --git a/native/chatgpt-conversation-state.cjs b/native/chatgpt-conversation-state.cjs
new file mode 100644
index 0000000..3447f5d
--- /dev/null
+++ b/native/chatgpt-conversation-state.cjs
@@ -0,0 +1,55 @@
+"use strict";
+
+const { extractMessageText } = require("./chatgpt-chats-formatter.cjs");
+
+function isAssistantCompleteStatus(status) {
+  return typeof status === "string" && /^(finished_successfully|finished)$/i.test(status.trim());
+}
+
+function isAssistantInProgressStatus(status) {
+  return typeof status === "string" && /^(in_progress|streaming|pending|queued)$/i.test(status.trim());
+}
+
+function classifyConversationProgress(conversation, { baselineAssistantMessageId = null } = {}) {
+  if (!conversation || typeof conversation !== "object") {
+    return { state: "invalid", nodeId: null, role: null, status: null, hasText: false, model: null };
+  }
+
+  const currentNodeId = typeof conversation.current_node === "string" ? conversation.current_node : null;
+  const mapping = conversation.mapping && typeof conversation.mapping === "object" ? conversation.mapping : null;
+  const node = currentNodeId && mapping ? mapping[currentNodeId] : null;
+  const message = node && typeof node === "object" ? node.message : null;
+  const role = message?.author?.role || null;
+  const status = message?.status || null;
+  const model = message?.metadata?.model_slug || null;
+  const hasText = !!String(extractMessageText(message) || "").trim();
+
+  if (!currentNodeId || !mapping || !node || !message || !role) {
+    return { state: "invalid", nodeId: currentNodeId, role, status, hasText, model };
+  }
+
+  if (role === "user") {
+    return { state: "awaiting_assistant", nodeId: currentNodeId, role, status, hasText, model };
+  }
+
+  if (role !== "assistant") {
+    return { state: "invalid", nodeId: currentNodeId, role, status, hasText, model };
+  }
+
+  if (isAssistantCompleteStatus(status)) {
+    const state = baselineAssistantMessageId && currentNodeId === baselineAssistantMessageId
+      ? "assistant_complete_baseline"
+      : "assistant_complete";
+    return { state, nodeId: currentNodeId, role, status, hasText, model };
+  }
+
+  if (isAssistantInProgressStatus(status)) {
+    return { state: "assistant_in_progress", nodeId: currentNodeId, role, status, hasText, model };
+  }
+
+  return { state: "invalid", nodeId: currentNodeId, role, status, hasText, model };
+}
+
+module.exports = {
+  classifyConversationProgress,
+};


diff --git a/docs/investigations/rp-surf-oracle-missing-reply-recovery.md b/docs/investigations/rp-surf-oracle-missing-reply-recovery.md
index 468a532..1f3bcc5 100644
--- a/docs/investigations/rp-surf-oracle-missing-reply-recovery.md
+++ b/docs/investigations/rp-surf-oracle-missing-reply-recovery.md
@@ -1,7 +1,9 @@
 # Investigation: rp-surf-oracle missing local reply despite ChatGPT Pro UI response
 
+> Status (2026-04-13): fixed in surf-cli. Query default timeout now matches the documented 2700s, and reconcile persists recovered assistant bodies to session response artifacts when available.
+
 ## Summary
-The ChatGPT Pro run did produce a valid assistant response remotely, and that response is recoverable via the chats retrieval path. The local `rp-surf-oracle` / `surf chatgpt` run failed to return it because the cloak query path uses a 120s default timeout while CLI help advertises 2700s, and this specific GPT-5.4 Pro conversation ran for roughly 46 minutes. Reconcile later marked the session completed, but it only stores recovery metadata, not the final assistant body.
+The ChatGPT Pro run did produce a valid assistant response remotely, and that response was recoverable via the chats retrieval path. The local `rp-surf-oracle` / `surf chatgpt` run failed to return it because the cloak query path used a 120s default timeout while CLI help advertised 2700s, and this specific GPT-5.4 Pro conversation ran for roughly 46 minutes. Reconcile also used to mark the session completed before persisting the recovered assistant body.
 
 ## Symptoms
 - Prompt insertion succeeded for a ~446KB RepoPrompt export.
@@ -54,7 +56,7 @@ The ChatGPT Pro run did produce a valid assistant response remotely, and that re
   - `result.nodeId`
 - `native/session-store.cjs:108-118` `Session.finish()` only persists model/image/`responsePreview`; there is no field for full assistant text.
 
-**Conclusion:** confirmed. Reconcile can close the session state, but it cannot recover the missing answer into session output today.
+**Conclusion:** confirmed at investigation time. This is now fixed: recovered assistant text is persisted into the session response artifact (or inline fallback when artifact persistence fails).
 
 ### Direct recovery path
 **Hypothesis:** the final answer can be recovered outside the query path using the existing chats API worker.
@@ -73,7 +75,7 @@ Primary cause for this run: timeout mismatch.
 
 The user-facing CLI help says ChatGPT queries default to 2700 seconds (`native/cli.cjs:390`), but the cloak query path actually defaults to 120 seconds in both `queryWithCloakBrowser()` and `runCloakWorker()` (`native/chatgpt-cloak-bridge.cjs:49-50`, `native/chatgpt-cloak-bridge.cjs:211`). This run used GPT-5.4 Pro and the recovered conversation spans roughly 46 minutes (`/tmp/chatgpt-69d730dc.md`: `### You · 07:53` to `### ChatGPT · 08:39`), so the local worker would have been killed long before the remote reply finished.
 
-Secondary issue: even after recovery, the session system does not hydrate the full assistant text. `reconcileSessions()` only marks the session completed with metadata (`native/session-reconciler.cjs:237-252`), and `Session.finish()` only persists a preview (`native/session-store.cjs:108-118`).
+Secondary issue at investigation time: even after recovery, the session system did not hydrate the full assistant text. That follow-up has now landed, so recovered sessions persist the assistant body to the response artifact path when possible.
 
 ## Recovered Response
 The full recovered conversation is saved at:


diff --git a/test/unit/chatgpt-conversation-state.test.ts b/test/unit/chatgpt-conversation-state.test.ts
new file mode 100644
index 0000000..96b155d
--- /dev/null
+++ b/test/unit/chatgpt-conversation-state.test.ts
@@ -0,0 +1,98 @@
+import { describe, expect, it } from "vitest";
+
+const { classifyConversationProgress } = require("../../native/chatgpt-conversation-state.cjs") as {
+  classifyConversationProgress: (conversation: any, options?: { baselineAssistantMessageId?: string | null }) => {
+    state: string;
+    nodeId: string | null;
+    role: string | null;
+    status: string | null;
+    hasText: boolean;
+    model: string | null;
+  };
+};
+
+describe("chatgpt-conversation-state", () => {
+  it("classifies a new completed assistant turn", () => {
+    const conversation = {
+      current_node: "a2",
+      mapping: {
+        a2: {
+          message: {
+            author: { role: "assistant" },
+            status: "finished_successfully",
+            content: { parts: ["done"] },
+            metadata: { model_slug: "gpt-5.4-pro" },
+          },
+        },
+      },
+    };
+
+    expect(classifyConversationProgress(conversation, { baselineAssistantMessageId: "a1" })).toEqual({
+      state: "assistant_complete",
+      nodeId: "a2",
+      role: "assistant",
+      status: "finished_successfully",
+      hasText: true,
+      model: "gpt-5.4-pro",
+    });
+  });
+
+  it("classifies the baseline assistant turn separately", () => {
+    const conversation = {
+      current_node: "a1",
+      mapping: {
+        a1: {
+          message: {
+            author: { role: "assistant" },
+            status: "finished_successfully",
+            content: { parts: ["old"] },
+            metadata: {},
+          },
+        },
+      },
+    };
+
+    expect(classifyConversationProgress(conversation, { baselineAssistantMessageId: "a1" }).state).toBe(
+      "assistant_complete_baseline",
+    );
+  });
+
+  it("classifies a current user node as awaiting_assistant", () => {
+    const conversation = {
+      current_node: "u1",
+      mapping: {
+        u1: {
+          message: {
+            author: { role: "user" },
+            status: "finished_successfully",
+            content: { parts: ["hello"] },
+          },
+        },
+      },
+    };
+
+    expect(classifyConversationProgress(conversation).state).toBe("awaiting_assistant");
+  });
+
+  it("classifies assistant in-progress turns", () => {
+    const conversation = {
+      current_node: "a2",
+      mapping: {
+        a2: {
+          message: {
+            author: { role: "assistant" },
+            status: "in_progress",
+            content: { parts: ["partial"] },
+          },
+        },
+      },
+    };
+
+    expect(classifyConversationProgress(conversation).state).toBe("assistant_in_progress");
+  });
+
+  it("returns invalid for missing or ill-formed current node state", () => {
+    expect(classifyConversationProgress(null).state).toBe("invalid");
+    expect(classifyConversationProgress({ current_node: "x", mapping: {} }).state).toBe("invalid");
+  });
+});


diff --git a/test/unit/chatgpt-cloak-bridge.test.ts b/test/unit/chatgpt-cloak-bridge.test.ts
index 84269b6..66f48b7 100644
--- a/test/unit/chatgpt-cloak-bridge.test.ts
+++ b/test/unit/chatgpt-cloak-bridge.test.ts
@@ -70,6 +70,25 @@ describe("chatgpt-cloak-bridge", () => {
     bridge.__resetBridgeRuntimeForTests();
   });
 
+  it("uses 120s default timeout for chats workers", async () => {
+    const worker = createWorker();
+    const spawn = vi.fn().mockReturnValue(worker);
+    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
+    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });
+
+    const promise = bridge.manageChatsWithCloakBrowser({ action: "list" });
+
+    expect(worker.stdin.write).toHaveBeenCalledWith(expect.stringContaining('"timeout":120'));
+
+    worker.stdout.emit(
+      "data",
+      `${JSON.stringify({ type: "success", action: "list", items: [], total: 0, backend: "cloak" })}\n`,
+    );
+
+    await expect(promise).resolves.toMatchObject({ action: "list", total: 0 });
+    bridge.__resetBridgeRuntimeForTests();
+  });
+
   it("forwards progress and maps chats success payload", async () => {
     const worker = createWorker();
     const spawn = vi.fn().mockReturnValue(worker);
@@ -112,6 +131,53 @@ describe("chatgpt-cloak-bridge", () => {
     bridge.__resetBridgeRuntimeForTests();
   });
 
+  it("forwards assistant-wait fields to chats workers", async () => {
+    const worker = createWorker();
+    const spawn = vi.fn().mockReturnValue(worker);
+    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
+    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });
+
+    const promise = bridge.manageChatsWithCloakBrowser({
+      action: "get",
+      conversationId: "conv-123",
+      waitForAssistant: true,
+      waitForAssistantTimeoutSec: 45,
+      baselineAssistantMessageId: "msg-456",
+    });
+
+    expect(worker.stdin.write).toHaveBeenCalledWith(
+      expect.stringContaining('"waitForAssistant":true'),
+    );
+    expect(worker.stdin.write).toHaveBeenCalledWith(
+      expect.stringContaining('"waitForAssistantTimeoutSec":45'),
+    );
+    expect(worker.stdin.write).toHaveBeenCalledWith(
+      expect.stringContaining('"baselineAssistantMessageId":"msg-456"'),
+    );
+
+    worker.stdout.emit(
+      "data",
+      `${JSON.stringify({
+        type: "success",
+        action: "get",
+        conversationId: "conv-123",
+        conversation: { id: "conv-123" },
+        stabilized: true,
+        conversationState: "assistant_complete",
+        waitedMs: 900,
+        backend: "cloak",
+      })}\n`,
+    );
+
+    await expect(promise).resolves.toMatchObject({
+      action: "get",
+      stabilized: true,
+      conversationState: "assistant_complete",
+      waitedMs: 900,
+    });
+    bridge.__resetBridgeRuntimeForTests();
+  });
+
   it("propagates worker errors", async () => {
     const worker = createWorker();
     const spawn = vi.fn().mockReturnValue(worker);

</git_diff>
<meta prompt 1 = "[Review]">
You are reviewing code changes with git diffs included in the prompt. The git diff shows what changed; the file contents show full context. Use both.

**Review Criteria:**

1. **Correctness & Safety**:
	- Do the changes achieve their intended purpose without regressions?
	- Are edge cases and error paths handled?
	- Any security vulnerabilities, race conditions, or resource leaks?
	- Any breaking changes to APIs or contracts?

2. **Design & Complexity**:
	- Do changes increase coupling or reduce separation of concerns?
	- Is new complexity justified, or can the same result be achieved more simply?
	- Are there DRY violations — duplicated logic that should be extracted?
	- Do abstractions sit at the right level (not too early, not too late)?

3. **Intentionality**:
	- Does every change have a clear purpose? Flag accidental modifications or dead code.
	- Are the changes minimal and focused, or is scope creeping in?

**Severity Levels — be disciplined about classification:**
- **P0 (Must fix)**: Bugs, data loss, security holes, crashes — things that break correctness.
- **P1 (Should fix)**: Design issues that will compound — poor separation of concerns, growing complexity, DRY violations, missing error handling for reachable paths.
- **P2 (Consider)**: Style, naming, minor refactoring opportunities, test coverage gaps.

Most findings should be P1 or P2. Reserve P0 for genuinely broken behavior.

**Output Format:**
1. One-paragraph summary of what the changes accomplish.
2. Findings grouped by severity (P0 → P1 → P2), each with: file reference, what's wrong, and a concrete suggestion. Omit empty severity groups.
3. If no issues found at a severity level, skip it — don't pad the review.
</meta prompt 1>
<user_instructions>
<taskname="Cloak review scope"/>
<task>Perform a code review of the ChatGPT CloakBrowser feature in surf-cli, prioritizing correctness, reliability, race conditions, recovery behavior, and regression risk across query, chats, and session-reconcile flows after the recent refactor.</task>

<architecture>
- `native/cli.cjs` is the top-level router and session logger for `chatgpt`, `chatgpt.chats`, `chatgpt.reply`, and `session --reconcile`; it also normalizes/removes legacy env vars (`CLOAK_HEADLESS`, `SURF_USE_CLOAK_CHATGPT`).
- `native/chatgpt-cloak-bridge.cjs` is the process boundary: spawns worker `.mjs` processes, maps JSONL protocol messages, resets worker timeout on progress/trace/meta events, and forwards `meta_update` into CLI session metadata.
- `native/chatgpt-cloak-worker.mjs` implements ChatGPT query execution: launch/auth/navigation, prompt entry verification, send confirmation, prompt persistence validation, response polling/activity detection, thinking-trace capture, and final success/fail signaling.
- `native/chatgpt-cloak-chats-worker.mjs` implements API-driven conversation operations (`list/search/get/delete/rename/download`) and optional `waitForAssistant` stabilization logic for recovery and exports.
- New helpers: `native/chatgpt-cloak-runtime.cjs` centralizes profile/lock handling and recoverable launch retry logic; `native/chatgpt-conversation-state.cjs` centralizes conversation progress classification.
- `native/session-reconciler.cjs` inspects running sessions, gates network polling on sent-checkpoint metadata, calls chats `get` with assistant wait, classifies outcomes, and persists recovered assistant payloads.
- `native/chatgpt-chats-formatter.cjs` extracts/walks active-path conversation text used by chats export and reconciler fallback extraction.
</architecture>

<selected_context>
native/chatgpt-cloak-worker.mjs: send-confirmation path (`attemptSendAndConfirm`), prompt persistence checks, `meta_update` emission on sent checkpoint, response polling loop using `detectResponseActivity`, timeout keepalives, conversation-id propagation, and thinking trace handling.
native/chatgpt-cloak-bridge.cjs: `runCloakWorker` timeout lifecycle, progress/trace/meta forwarding, error/exit mapping, request shaping for query/chats workers.
native/chatgpt-cloak-prompt-entry.cjs: insertion methods, send-readiness checks, and verification metrics before send.
native/chatgpt-cloak-prompt-validation.cjs: `evaluatePromptPersistence` and latest active user message validation semantics.
native/chatgpt-cloak-timeout.cjs: timeout normalization and `detectResponseActivity` heuristics that drive deadline extension.
native/chatgpt-cloak-chats-worker.mjs: API auth/request flow, `apiGetConversation` stabilization loop, baseline assistant handling, and action dispatcher.
native/chatgpt-cloak-runtime.cjs: stale `SingletonLock` cleanup, shared/temp profile directory strategy, recoverable profile-lock detection and retry normalization.
native/chatgpt-conversation-state.cjs: `classifyConversationProgress` state machine (`awaiting_assistant`, `assistant_in_progress`, `assistant_complete`, `assistant_complete_baseline`, `invalid`).
native/session-reconciler.cjs: sent-checkpoint gate (`hasSentCheckpoint`), `inspectConversation`, network poll behavior, recovered payload persistence.
native/cli.cjs: cloak routing, session checkpoint recording from bridge `meta_update`, chats command flow, and reconcile command plumbing.
native/chatgpt-chats-formatter.cjs: active-path traversal and assistant text extraction used in exports/recovery.

test/unit/chatgpt-cloak-bridge.test.ts: worker protocol mapping, timeout defaults, meta/wait-field forwarding, exit/error expectations.
test/unit/chatgpt-cloak-prompt-entry.test.ts: insertion fallback and send-readiness behavior.
test/unit/chatgpt-cloak-timeout.test.ts: activity detection edge cases.
test/unit/chatgpt-cloak-runtime.test.ts: singleton lock cleanup and launch-retry behavior.
test/unit/chatgpt-conversation-state.test.ts: progress classifier cases.
test/unit/session-reconciler.test.ts: sent checkpoint gating and reconcile outcomes.
test/unit/chatgpt-chats-formatter.test.ts: active-path vs tree rendering behavior.

docs/investigations/rp-surf-oracle-missing-reply-recovery.md: observed recovery/export timing behavior.
docs/investigations/surf-chats-profile-lock.md: prior profile lock evidence.
README.md: user-facing env/docs updates tied to refactor.

_git_data/repos/surf-cli-3245402f/2026-04-13/1652/MAP.txt: changed-file index for this review snapshot.
_git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/native__chatgpt-cloak-bridge.cjs.patch: precise delta.
_git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/native__chatgpt-cloak-chats-worker.mjs.patch: precise delta.
_git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/native__chatgpt-cloak-runtime.cjs.patch: precise delta.
_git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/native__chatgpt-cloak-worker.mjs.patch: precise delta.
_git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/native__chatgpt-conversation-state.cjs.patch: precise delta.
_git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/native__cli.cjs.patch: precise delta.
_git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/native__session-reconciler.cjs.patch: precise delta.
_git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/test__unit__chatgpt-cloak-bridge.test.ts.patch: test delta.
_git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/test__unit__chatgpt-cloak-runtime.test.ts.patch: test delta.
_git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/test__unit__chatgpt-conversation-state.test.ts.patch: test delta.
_git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/test__unit__session-reconciler.test.ts.patch: test delta.
_git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/README.md.patch: docs delta.
_git_data/repos/surf-cli-3245402f/2026-04-13/1652/diff/per-file/docs__investigations__rp-surf-oracle-missing-reply-recovery.md.patch: investigation delta.
</selected_context>

<relationships>
- `cli.cjs` → `queryWithCloakBrowser()` / `manageChatsWithCloakBrowser()` in `chatgpt-cloak-bridge.cjs`.
- `chatgpt-cloak-bridge.cjs` → worker protocol (`chatgpt-cloak-worker.mjs`, `chatgpt-cloak-chats-worker.mjs`) and returns mapped success/error payloads.
- Both workers depend on `chatgpt-cloak-runtime.cjs` for profile dir choice + recoverable lock retry behavior.
- Query worker flow: `enterPromptWithVerification()` → send confirmation probes → `evaluatePromptPersistence()` checks → emit sent checkpoint meta → polling loop via `detectResponseActivity()`.
- Chats worker `apiGetConversation(...waitForAssistant...)` and reconciler both depend on `classifyConversationProgress()` from `chatgpt-conversation-state.cjs`.
- Reconciler network recovery path: `session-reconciler.cjs` → bridge `manageChatsWithCloakBrowser({action:'get', waitForAssistant:true,...})` → chats worker → conversation formatter extraction + session-store persistence.
- `chatgpt-chats-formatter.cjs` active-path logic affects both `chatgpt.chats` output and recovered assistant payload extraction.
</relationships>

<ambiguities>
- `native/cli.cjs` is very large and includes unrelated command surfaces; review focus should stay on ChatGPT/Cloak/session-reconcile sections.
- “Double-send” risk appears to be timing/state dependent rather than explicit duplicate send calls; confirm with send-confirmation and checkpoint ordering logic.
- Missing assistant content in recovery/export may be timing/state classification or active-path selection behavior; examine classifier + wait loop + formatter interplay together.
</ambiguities>
</user_instructions>
