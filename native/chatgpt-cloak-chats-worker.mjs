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
  resolveAssistantWaitSeconds,
} = require('./chatgpt-cloak-timeout.cjs');
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
    : resolveAssistantWaitSeconds(undefined);
  const baselineAssistantMessageId = options.baselineAssistantMessageId || null;
  const startedAt = Date.now();

  let conversation = null;
  let conversationState = 'invalid';
  let stabilized = false;
  let lastKeepaliveAt = 0;

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

    if ((Date.now() - lastKeepaliveAt) >= 8_000) {
      emit({
        type: 'keepalive',
        reason: 'wait_for_assistant',
        phase: 'Waiting for assistant',
        conversationId,
        conversationState,
        elapsedMs: Date.now() - startedAt,
      });
      lastKeepaliveAt = Date.now();
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
  waitForAssistantTimeoutSec = undefined,
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
