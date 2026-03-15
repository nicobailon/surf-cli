"use strict";
/**
 * AI Studio model selection for surf-cli
 *
 * Handles reading, verifying, and selecting models in the AI Studio UI.
 * Uses a three-tier strategy: URL param → wait for UI to reflect → click selector.
 */

const {
  normalizeModelString,
  extractModelKeywords,
  buildClickDispatcher,
  delay,
} = require("./aistudio-parser.cjs");

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

async function readCurrentModelInfo(cdp) {
  return evaluate(cdp, `(() => {
    const normalize = (text) => (text || '').replace(/\\s+/g, ' ').trim();

    const selector = document.querySelector('button.model-selector-card, .model-selector-card');
    if (!selector) {
      return { found: false, label: '', modelId: '' };
    }

    const raw = normalize(selector.textContent || '');
    const lower = raw.toLowerCase();
    const compact = lower.replace(/\\s+/g, '');
    const modelIdMatch = compact.match(/gemini-[a-z0-9.\-]*(?:preview|latest)/) ||
      lower.match(/gemini-[a-z0-9.\-]*(?:preview|latest)/);

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

    const normalize = (text) => (text || '').replace(/\\s+/g, ' ').trim();
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
      const normalize = (text) => (text || '').replace(/\\s+/g, ' ').trim();
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

module.exports = {
  readCurrentModelInfo,
  waitForModelToApply,
  closeModelSelectorIfOpen,
  selectModel,
};
