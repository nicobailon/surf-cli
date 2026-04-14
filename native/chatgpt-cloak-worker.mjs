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
  classifyConversationProgress,
  extractCompletedAssistantPayload,
} = require('./chatgpt-conversation-state.cjs');
const {
  launchPersistentContextWithRecovery,
  sharedProfileDir,
  tempProfileDir,
} = require('./chatgpt-cloak-runtime.cjs');
const {
  attemptSendAndConfirm,
} = require('./chatgpt-cloak-send-confirmation.cjs');
const { enterPromptWithVerification } = require('./chatgpt-cloak-prompt-entry.cjs');
const {
  extractLatestActiveUserMessage,
  evaluatePromptPersistence,
} = require('./chatgpt-cloak-prompt-validation.cjs');
const {
  DEFAULT_CHATGPT_QUERY_TIMEOUT_SEC,
  detectResponseActivity,
  resolveAssistantWaitSeconds,
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
      sendButtonSelectors: SEND_BUTTON_SELECTORS,
      promptSelectors: PROMPT_SELECTOR_LIST,
      stopSelector: STOP_BUTTON_SELECTOR,
      sleep,
      log,
      waitForPromptPersistenceValidation,
      extractConversationIdFromUrl,
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

    if (conversationId) {
      emit({
        type: 'meta_update',
        source: 'send_attempted',
        lastCheckpoint: 'send_attempted',
        sentAt,
        conversationId: conversationId || null,
        baselineAssistantMessageId: baselineMessageId || null,
        t: Date.now(),
      });
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
    const assistantWaitMs = resolveAssistantWaitSeconds(undefined) * 1000;
    const keepaliveIntervalMs = resolveKeepaliveIntervalMs(timeoutSec);
    const phase6StartedAtMs = Date.now();
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
    let lastSignalAtMs = phase6StartedAtMs;
    let lastRemotePollAtMs = 0;
    let remoteRecoveryStartedAtMs = null;
    let remoteConversationState = null;
    let timedOut = false;

    const noteActivity = () => {
      const now = Date.now();
      deadline = now + timeoutMs;
      lastSignalAtMs = now;
      remoteRecoveryStartedAtMs = null;
      remoteConversationState = null;
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
        noteActivity();
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

      const nowMs = Date.now();
      if ((nowMs - lastKeepaliveAtMs) >= keepaliveIntervalMs) {
        emit({
          type: 'keepalive',
          reason: remoteRecoveryStartedAtMs ? 'remote_wait' : 'response_wait',
          phase: lastPhase || 'Waiting for response',
          elapsedMs: nowMs - phase6StartedAtMs,
          conversationId: conversationId || null,
          conversationState: remoteConversationState,
        });
        lastKeepaliveAtMs = nowMs;
      }

      if (conversationId && (nowMs - lastSignalAtMs) >= 30_000) {
        if (!remoteRecoveryStartedAtMs) {
          remoteRecoveryStartedAtMs = nowMs;
          log('info', 'Starting remote completion recovery', { conversationId });
        }

        const withinRemoteRecoveryWindow = (nowMs - remoteRecoveryStartedAtMs) < assistantWaitMs;
        if (withinRemoteRecoveryWindow && (nowMs - lastRemotePollAtMs) >= 5_000) {
          lastRemotePollAtMs = nowMs;
          const remoteResult = await fetchConversation(page, conversationId);
          if (remoteResult?.ok) {
            const classified = classifyConversationProgress(remoteResult.conversation, {
              baselineAssistantMessageId: baselineMessageId || null,
            });
            remoteConversationState = classified.state;
            if (classified.state === 'assistant_complete') {
              const recoveredPayload = extractCompletedAssistantPayload(remoteResult.conversation, {
                nodeId: classified.nodeId || null,
              });
              if (recoveredPayload?.responseText) {
                responseText = recoveredPayload.responseText;
                capturedModel = recoveredPayload.model || capturedModel;
                responseTurnId = classified.nodeId || responseTurnId;
                log('info', 'Recovered completed remote reply during response wait', {
                  conversationId,
                  nodeId: classified.nodeId || null,
                });
                break;
              }
            }
          } else {
            remoteConversationState = remoteResult?.code || 'poll_failed';
            log('warn', 'Remote completion recovery poll failed', {
              conversationId,
              code: remoteResult?.code || null,
              status: remoteResult?.status || null,
              message: remoteResult?.message || null,
            });
          }
        }
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
