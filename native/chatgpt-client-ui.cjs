const { abortableDelay, throwIfAborted } = require("./abort.cjs");
const {
  CHATGPT_EFFORT_CHOICES,
  boundedOptionLabels,
  normalizeChatGPTEffortChoice,
  normalizeChatGPTModelChoice,
  resolveChatGPTEffortMenuOption,
  resolveChatGPTModelMenuOption,
  verifyChatGPTEffortSelection,
  verifyChatGPTModelSelection,
} = require("./chatgpt-client-selection.cjs");

const SELECTORS = {
  promptTextarea:
    '#prompt-textarea, [data-testid="composer-textarea"], textarea[name="prompt-textarea"], .ProseMirror, [contenteditable="true"][data-virtualkeyboard="true"]',
  promptEditor: "#prompt-textarea",
  promptFallback: 'textarea[name="prompt-textarea"]',
  loginCta: 'a[href*="/auth/login"], button',
  sendButton:
    'button[data-testid="send-button"], button[data-testid*="composer-send"], form button[type="submit"]',
  modelButton:
    '[data-testid="model-switcher-dropdown-button"], [data-testid="composer-footer-actions"] button[aria-haspopup="menu"], button.__composer-pill[aria-haspopup="menu"], .__composer-pill-composite button[aria-haspopup="menu"]',
  modelMenu: '[role="menu"][data-radix-menu-content]',
  modelMenuItem: 'button, [role="menuitem"], [role="menuitemradio"]',
  menuItemPrimaryLabel: '.min-w-0 > span',
  effortButton:
    '[data-testid="composer-footer-actions"] button[aria-haspopup="menu"], button.__composer-pill[aria-haspopup="menu"], .__composer-pill-composite button[aria-haspopup="menu"]',
  effortMenu: '[role="menu"], [data-radix-collection-root], [role="group"]',
  effortMenuItem: 'button, [role="menuitem"], [role="menuitemradio"]',
  effortMenuLabel: '.__menu-label, [class*="menu-label"]',
  effortSubmenuTrigger: '[role="menuitem"][aria-haspopup="menu"], button[aria-haspopup="menu"]',
  selectedMenuIndicator:
    '[aria-checked="true"], [aria-selected="true"], [data-selected="true"], [data-state="checked"], [data-state="selected"], [data-state="on"]',
  assistantMessage:
    '[data-message-author-role="assistant"], [data-turn="assistant"], [data-testid*="assistant-message"], [data-testid*="assistant-turn"], [data-testid*="assistant-response"]',
  assistantContent:
    '.markdown, [data-message-content], .prose, [class*="markdown"], [dir="auto"]',
  stopButton:
    '[data-testid="stop-button"], [data-testid*="stop"], button[aria-label*="Stop"], button[aria-label*="stop"]',
  finishedActions:
    'button[data-testid="copy-turn-action-button"], button[data-testid="good-response-turn-action-button"], button[data-testid*="turn-action"], button[aria-label*="Copy"], button[aria-label*="copy"], button[aria-label*="Read aloud"], button[aria-label*="read aloud"]',
  conversationTurn: '[data-testid^="conversation-turn"], [data-testid*="conversation-turn"]',
  cloudflareScript: 'script[src*="/challenge-platform/"]',
};

function delay(ms, signal) {
  return abortableDelay(ms, signal);
}

function buildClickDispatcher() {
  return `function dispatchClickSequence(target){
    if(!target || !(target instanceof EventTarget)) return false;
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

async function evaluate(cdp, expression, signal) {
  throwIfAborted(signal);
  const result = await cdp(expression);
  throwIfAborted(signal);
  if (result.exceptionDetails) {
    const desc =
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      "Evaluation failed";
    throw new Error(desc);
  }
  if (result.error) {
    throw new Error(result.error);
  }
  return result.result?.value;
}

async function waitForPageLoad(cdp, timeoutMs = 45000, signal) {
  throwIfAborted(signal);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await evaluate(cdp, "document.readyState");
    if (ready === "complete" || ready === "interactive") {
      return;
    }
    await delay(100, signal);
  }
  throw new Error("Page did not load in time");
}

async function isCloudflareBlocked(cdp) {
  const title = await evaluate(cdp, "document.title.toLowerCase()");
  if (title && (title.includes("just a moment") || title.includes("verify you are human"))) {
    return true;
  }
  return evaluate(
    cdp,
    `(() => {
      const hasPrompt = Boolean(document.querySelector(${JSON.stringify(SELECTORS.promptTextarea)}));
      if (hasPrompt) return false;
      const text = (document.body?.innerText || '').toLowerCase();
      const challengeText = [
        'checking if the site connection is secure',
        'verify you are human',
        'review the security of your connection',
        'needs to review the security of your connection',
        'cloudflare ray id'
      ];
      return challengeText.some(marker => text.includes(marker))
        || Boolean(document.querySelector('input[name="cf-turnstile-response"], .cf-turnstile, #challenge-stage, iframe[src*="challenges.cloudflare.com"]'));
    })()`,
  );
}

async function checkLoginStatus(cdp) {
  const result = await evaluate(
    cdp,
    `(async () => {
      try {
        const response = await fetch('/backend-api/me', {
          cache: 'no-store',
          credentials: 'include'
        });
        const hasLoginCta = Array.from(document.querySelectorAll(${JSON.stringify(SELECTORS.loginCta)}))
          .some(el => {
            const text = (el.textContent || '').toLowerCase().trim();
            return text.startsWith('log in') || text.startsWith('sign in');
          });
        return {
          status: response.status,
          hasLoginCta,
          url: location.href
        };
      } catch (e) {
        return { status: 0, error: e.message, url: location.href };
      }
    })()`,
  );
  return result || { status: 0 };
}

async function waitForPromptReady(cdp, timeoutMs = 30000, signal) {
  throwIfAborted(signal);
  const deadline = Date.now() + timeoutMs;
  const selectors = JSON.stringify(SELECTORS.promptTextarea.split(", "));
  while (Date.now() < deadline) {
    const found = await evaluate(
      cdp,
      `(() => {
        const selectors = ${selectors};
        for (const selector of selectors) {
          const node = document.querySelector(selector);
          if (node && !node.hasAttribute('disabled')) {
            return true;
          }
        }
        return false;
      })()`,
    );
    if (found) return true;
    await delay(200, signal);
  }
  return false;
}

function verificationError(kind, requested, items = [], invalid = false) {
  const safeRequested = String(requested || "").replace(/\s+/g, " ").trim().slice(0, 80);
  const available = boundedOptionLabels(items);
  const accepted = kind === "effort" ? ` Accepted: ${CHATGPT_EFFORT_CHOICES.join(", ")}.` : "";
  const availableMessage = available.length > 0 ? ` Available: ${available.join(", ")}.` : "";
  const error = new Error(
    invalid
      ? `Invalid ChatGPT effort "${safeRequested}".${accepted}`
      : `ChatGPT ${kind} verification failed for "${safeRequested}".${accepted}${availableMessage}`,
  );
  error.code = "model_verification_failed";
  return error;
}

async function readPicker(cdp, kind, click = false) {
  const selector = kind === "model" ? SELECTORS.modelButton : SELECTORS.effortButton;
  return evaluate(
    cdp,
    `(() => {
      ${buildClickDispatcher()}
      const kind = ${JSON.stringify(kind)};
      const effortChoices = new Set(${JSON.stringify(CHATGPT_EFFORT_CHOICES)});
      const effortOwnerLabels = new Set([...effortChoices, 'thinking']);
      const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const labelFor = (node) => {
        const labelledBy = String(node.getAttribute?.('aria-labelledby') || '')
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent || '')
          .join(' ');
        const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
        const aria = (node.getAttribute?.('aria-label') || '').replace(/\s+/g, ' ').trim();
        const title = (node.getAttribute?.('title') || '').replace(/\s+/g, ' ').trim();
        return [text, aria, labelledBy, title].filter(Boolean).join(' | ');
      };
      let nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).filter((node) => {
        const value = normalize(labelFor(node));
        if (kind !== 'model') {
          const words = value.split(/\s+/).filter(Boolean);
          const hasEffort = words.some((word) => effortOwnerLabels.has(word));
          const looksLikeModel = node.getAttribute?.('data-testid') === 'model-switcher-dropdown-button' ||
            value.includes('current model') || value.includes('gpt') || value.includes('instant');
          return hasEffort && !looksLikeModel;
        }
        return value.includes('gpt') || value.includes('thinking') || value.includes('instant');
      });
      if (kind === 'model' && nodes.length === 0) {
        nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).filter((node) => {
          const value = normalize(labelFor(node));
          return value.includes('pro');
        });
      }
      if (kind === 'model' && nodes.length === 0) {
        nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).filter((node) =>
          node.getAttribute?.('aria-haspopup') === 'menu' || node.getAttribute?.('aria-expanded') !== null
        );
      }
      const items = nodes.map((node) => {
        const text = (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
        const aria = (node.getAttribute?.('aria-label') || '').replace(/\\s+/g, ' ').trim();
        const labelledBy = String(node.getAttribute?.('aria-labelledby') || '')
          .split(/\\s+/)
          .map((id) => document.getElementById(id)?.textContent || '')
          .join(' ')
          .replace(/\\s+/g, ' ')
          .trim();
        const title = (node.getAttribute?.('title') || '').replace(/\\s+/g, ' ').trim();
        return {
          role: node.getAttribute?.('role') || (node.tagName === 'BUTTON' ? 'button' : null),
          label: [text, aria, labelledBy, title].filter(Boolean).join(' | ').slice(0, 240),
          displayLabel: (text || aria || labelledBy || title).slice(0, 80),
          testId: node.getAttribute?.('data-testid') || null,
        };
      });
      if (${click} && nodes.length === 1) dispatchClickSequence(nodes[0]);
      return { items };
    })()`,
  );
}

async function readMenu(cdp, kind, allowSubmenu) {
  const isModel = kind === "model";
  const menuSelector = isModel ? SELECTORS.modelMenu : SELECTORS.effortMenu;
  const itemSelector = isModel ? SELECTORS.modelMenuItem : SELECTORS.effortMenuItem;
  return evaluate(
    cdp,
    `(() => {
      ${buildClickDispatcher()}
      const isModel = ${isModel};
      const choices = ${JSON.stringify(CHATGPT_EFFORT_CHOICES)};
      const containers = Array.from(document.querySelectorAll(${JSON.stringify(menuSelector)}));
      const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      let menu = isModel ? containers.find((container) => {
        const labels = Array.from(container.querySelectorAll(${JSON.stringify(itemSelector)}))
          .filter((item) => item.getAttribute?.('aria-haspopup') !== 'menu')
          .map((item) => normalize((item.getAttribute?.('aria-label') || '') + ' ' + (item.textContent || '')));
        return labels.some((label) => label.includes('gpt') || /^o[0-9]/.test(label));
      }) : containers.find((container) => {
        const label = normalize(container.querySelector?.(${JSON.stringify(SELECTORS.effortMenuLabel)})?.textContent);
        const levels = new Set(Array.from(container.querySelectorAll(${JSON.stringify(itemSelector)}))
          .flatMap((item) => normalize(item.textContent).split(/\\s+/))
          .filter((word) => choices.includes(word)));
        return label.includes('thinking time') || levels.size >= 2;
      });
      if (!menu && isModel && ${allowSubmenu}) {
        for (const container of containers) {
          const trigger = Array.from(container.querySelectorAll(${JSON.stringify(SELECTORS.effortSubmenuTrigger)}))
            .find((item) => {
              const label = normalize((item.getAttribute?.('aria-label') || '') + ' ' + (item.textContent || ''));
              return label.includes('model') || label.includes('advanced');
            });
          if (trigger) {
            dispatchClickSequence(trigger);
            return { found: false, submenuOpened: true, items: [] };
          }
        }
      }
      if (!menu && !isModel && ${allowSubmenu}) {
        for (const container of containers) {
          const trigger = Array.from(container.querySelectorAll(${JSON.stringify(SELECTORS.effortSubmenuTrigger)}))
            .find((item) => {
              const label = normalize((item.getAttribute?.('aria-label') || '') + ' ' + (item.textContent || ''));
              return label.includes('thinking time') || label.includes('reasoning effort');
            });
          if (trigger) {
            dispatchClickSequence(trigger);
            return { found: false, submenuOpened: true, items: [] };
          }
        }
      }
      if (!menu) return { found: false, items: [] };
      const items = Array.from(menu.querySelectorAll(${JSON.stringify(itemSelector)})).map((item) => {
        const primary = isModel ? item.querySelector?.(${JSON.stringify(SELECTORS.menuItemPrimaryLabel)}) : null;
        const label = (primary?.textContent || item.getAttribute?.('aria-label') || item.textContent || '')
          .replace(/\\s+/g, ' ').trim().slice(0, 80);
        const state = (item.getAttribute?.('data-state') || '').toLowerCase();
        const selected = item.getAttribute?.('aria-checked') === 'true' ||
          item.getAttribute?.('aria-selected') === 'true' || item.getAttribute?.('data-selected') === 'true' ||
          ['checked', 'selected', 'on'].includes(state) ||
          Boolean(item.querySelector?.(${JSON.stringify(SELECTORS.selectedMenuIndicator)}));
        return {
          role: item.getAttribute?.('role') || (item.tagName === 'BUTTON' ? 'button' : null),
          label,
          testId: item.getAttribute?.('data-testid') || null,
          selected,
        };
      });
      return { found: true, items };
    })()`,
  );
}

async function waitForMenu(cdp, kind, timeoutMs, signal) {
  const deadline = Date.now() + timeoutMs;
  let allowSubmenu = true;
  while (Date.now() < deadline) {
    const result = await readMenu(cdp, kind, allowSubmenu);
    if (result?.found) return result;
    if (result?.submenuOpened) allowSubmenu = false;
    await delay(100, signal);
  }
  return { found: false, items: [] };
}

async function clickMenuItem(cdp, kind, match) {
  const isModel = kind === "model";
  const menuSelector = isModel ? SELECTORS.modelMenu : SELECTORS.effortMenu;
  const itemSelector = isModel ? SELECTORS.modelMenuItem : SELECTORS.effortMenuItem;
  return evaluate(
    cdp,
    `(() => {
      ${buildClickDispatcher()}
      const expectedTestId = ${JSON.stringify(match.testId)};
      const expectedLabel = ${JSON.stringify(match.label)};
      const items = Array.from(new Set(
        Array.from(document.querySelectorAll(${JSON.stringify(menuSelector)}))
          .flatMap((menu) => Array.from(menu.querySelectorAll(${JSON.stringify(itemSelector)}))),
      ));
      const matches = items.filter((item) => {
        if (expectedTestId) return item.getAttribute?.('data-testid') === expectedTestId;
        const primary = ${isModel} ? item.querySelector?.(${JSON.stringify(SELECTORS.menuItemPrimaryLabel)}) : null;
        const label = (primary?.textContent || item.getAttribute?.('aria-label') || item.textContent || '')
          .replace(/\\s+/g, ' ').trim().slice(0, 80);
        return label === expectedLabel;
      });
      return matches.length >= 1 ? dispatchClickSequence(matches[0]) : false;
    })()`,
  );
}

async function selectModel(cdp, desiredModel, timeoutMs = 8000, signal) {
  throwIfAborted(signal);
  const picker = await readPicker(cdp, "model", true);
  if (picker?.items?.length !== 1) throw verificationError("model", desiredModel);
  await delay(300, signal);
  const menu = await waitForMenu(cdp, "model", timeoutMs, signal);
  const currentAdvancedModel = verifyChatGPTModelSelection(
    menu.items.filter((item) => /\bmodel\b/i.test(String(item?.label || ""))),
    desiredModel,
  );
  if (currentAdvancedModel) return currentAdvancedModel.displayLabel || currentAdvancedModel.label;

  const match = resolveChatGPTModelMenuOption(menu.items, desiredModel);
  if (!match || !(await clickMenuItem(cdp, "model", match))) {
    throw verificationError("model", desiredModel, menu.items);
  }
  await delay(200, signal);
  const state = await readPicker(cdp, "model");
  const verified = verifyChatGPTModelSelection(state?.items, desiredModel);
  if (verified) return verified.displayLabel || verified.label;

  const reopened = await readPicker(cdp, "model", true);
  if (reopened?.items?.length !== 1) throw verificationError("model", desiredModel, menu.items);
  const readbackMenu = await waitForMenu(cdp, "model", timeoutMs, signal);
  const readbackVerified = verifyChatGPTModelSelection(
    readbackMenu.items.filter((item) => item.selected),
    desiredModel,
  );
  if (!readbackVerified) throw verificationError("model", desiredModel, readbackMenu.items);
  return readbackVerified.label;
}

async function selectEffort(cdp, desiredEffort, timeoutMs = 8000, signal) {
  throwIfAborted(signal);
  const normalizedEffort = normalizeChatGPTEffortChoice(desiredEffort);
  if (!normalizedEffort) throw verificationError("effort", desiredEffort, [], true);
  const picker = await readPicker(cdp, "effort", true);
  if (picker?.items?.length !== 1) throw verificationError("effort", desiredEffort);
  await delay(300, signal);
  const menu = await waitForMenu(cdp, "effort", timeoutMs, signal);
  const match = resolveChatGPTEffortMenuOption(menu.items, normalizedEffort);
  if (!match || !(await clickMenuItem(cdp, "effort", match))) {
    throw verificationError("effort", desiredEffort, menu.items);
  }
  await delay(200, signal);
  const pillState = await readPicker(cdp, "effort");
  const pillVerified = verifyChatGPTEffortSelection(pillState?.items, normalizedEffort);
  if (pillVerified) return pillVerified.displayLabel || pillVerified.label;

  const reopened = await readPicker(cdp, "effort", true);
  if (reopened?.items?.length !== 1) throw verificationError("effort", desiredEffort, menu.items);
  const readbackMenu = await waitForMenu(cdp, "effort", timeoutMs, signal);
  const verified = verifyChatGPTEffortSelection(
    readbackMenu.items.filter((item) => item.selected),
    normalizedEffort,
  );
  if (!verified) throw verificationError("effort", desiredEffort, readbackMenu.items);
  return verified.label;
}

async function typePrompt(cdp, inputCdp, prompt, signal) {
  throwIfAborted(signal);
  const selectors = JSON.stringify(SELECTORS.promptTextarea.split(", "));
  const encodedPrompt = JSON.stringify(prompt);
  const focused = await evaluate(
    cdp,
    `(() => {
      ${buildClickDispatcher()}
      const selectors = ${selectors};
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (!node) continue;
        dispatchClickSequence(node);
        if (typeof node.focus === 'function') node.focus();
        const doc = node.ownerDocument;
        const selection = doc?.getSelection?.();
        if (selection) {
          const range = doc.createRange();
          range.selectNodeContents(node);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        return true;
      }
      return false;
    })()`,
  );
  if (!focused) {
    throw new Error("Failed to focus prompt textarea");
  }
  await inputCdp("Input.insertText", { text: prompt });
  await delay(300, signal);
  const verified = await evaluate(
    cdp,
    `(() => {
      const selectors = ${selectors};
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (!node) continue;
        const text = node.innerText || node.value || node.textContent || '';
        if (text.trim().length > 0) return true;
      }
      return false;
    })()`,
  );
  if (!verified) {
    await evaluate(
      cdp,
      `(() => {
        const editor = document.querySelector(${JSON.stringify(SELECTORS.promptEditor)});
        const fallback = document.querySelector(${JSON.stringify(SELECTORS.promptFallback)});
        if (fallback) {
          fallback.value = ${encodedPrompt};
          fallback.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${encodedPrompt}, inputType: 'insertFromPaste' }));
        }
        if (editor) {
          editor.textContent = ${encodedPrompt};
          editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${encodedPrompt}, inputType: 'insertFromPaste' }));
        }
      })()`,
    );
  }
}

async function clickSend(cdp, inputCdp, signal) {
  throwIfAborted(signal);
  const selectorsJson = JSON.stringify(SELECTORS.sendButton.split(", "));
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const result = await evaluate(
      cdp,
      `(() => {
        ${buildClickDispatcher()}
        const selectors = ${selectorsJson};
        let button = null;
        for (const selector of selectors) {
          button = document.querySelector(selector);
          if (button) break;
        }
        if (!button) return 'missing';
        const disabled = button.hasAttribute('disabled') ||
                        button.getAttribute('aria-disabled') === 'true' ||
                        button.getAttribute('data-disabled') === 'true';
        if (disabled) return 'disabled';
        dispatchClickSequence(button);
        return 'clicked';
      })()`,
    );
    if (result === "clicked") return true;
    if (result === "missing") break;
    await delay(100, signal);
  }
  await inputCdp("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    text: "\r",
  });
  await inputCdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  return true;
}

module.exports = {
  SELECTORS,
  checkLoginStatus,
  clickSend,
  delay,
  evaluate,
  isCloudflareBlocked,
  normalizeChatGPTEffortChoice,
  normalizeChatGPTModelChoice,
  resolveChatGPTEffortMenuOption,
  resolveChatGPTModelMenuOption,
  selectEffort,
  selectModel,
  verifyChatGPTEffortSelection,
  verifyChatGPTModelSelection,
  typePrompt,
  waitForPageLoad,
  waitForPromptReady,
};
