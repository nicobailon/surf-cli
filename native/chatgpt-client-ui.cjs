const { abortableDelay, throwIfAborted } = require("./abort.cjs");

const SELECTORS = {
  promptTextarea:
    '#prompt-textarea, [data-testid="composer-textarea"], textarea[name="prompt-textarea"], .ProseMirror, [contenteditable="true"][data-virtualkeyboard="true"]',
  sendButton:
    'button[data-testid="send-button"], button[data-testid*="composer-send"], form button[type="submit"]',
  modelButton: '[data-testid="model-switcher-dropdown-button"]',
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
  if (title && title.includes("just a moment")) return true;
  return evaluate(cdp, `Boolean(document.querySelector('${SELECTORS.cloudflareScript}'))`);
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
        const hasLoginCta = Array.from(document.querySelectorAll('a[href*="/auth/login"], button'))
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

function normalizeChatGPTModelChoice(desiredModel) {
  const normalized = String(desiredModel || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  if (["instant", "gpt53"].includes(normalized)) return "instant";
  if (["thinking", "gpt54thinking"].includes(normalized)) return "thinking";
  if (["pro", "gpt54pro"].includes(normalized)) return "pro";

  return normalized;
}

function resolveChatGPTModelMenuOption(items, desiredModel) {
  if (!Array.isArray(items)) return null;

  const targetModel = normalizeChatGPTModelChoice(desiredModel);

  return (
    items.find((item) => {
      if (item?.role !== "menuitemradio") return false;
      if (typeof item?.testId !== "string" || !item.testId.startsWith("model-switcher-")) {
        return false;
      }

      const label = normalizeChatGPTModelChoice(item.label || "");
      const testId = normalizeChatGPTModelChoice(item.testId.replace(/^model-switcher-/, ""));
      return label === targetModel || testId === targetModel;
    }) || null
  );
}

async function selectModel(cdp, desiredModel, timeoutMs = 8000, signal) {
  throwIfAborted(signal);
  const modelButton = await evaluate(
    cdp,
    `(() => {
      const btn = document.querySelector('${SELECTORS.modelButton}');
      return btn ? true : false;
    })()`,
  );
  if (!modelButton) {
    throw new Error("Model selector button not found");
  }
  await evaluate(
    cdp,
    `(() => {
      ${buildClickDispatcher()}
      const btn = document.querySelector('${SELECTORS.modelButton}');
      if (btn) dispatchClickSequence(btn);
    })()`,
  );
  await delay(300, signal);

  const normalizedModel = normalizeChatGPTModelChoice(desiredModel);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await evaluate(
      cdp,
      `(() => {
        const menu = document.querySelector('[role="menu"][data-radix-menu-content]');
        if (!menu) {
          return { found: false, waiting: true };
        }

        return {
          found: true,
          items: Array.from(menu.children).map((item) => {
            const primary = item.querySelector?.('.min-w-0 > span');
            return {
              role: item.getAttribute?.('role') || null,
              label: (primary?.textContent || item.getAttribute?.('aria-label') || item.textContent || '').trim(),
              testId: item.getAttribute?.('data-testid') || null,
            };
          }),
        };
      })()`,
    );

    if (result && result.found) {
      const match = resolveChatGPTModelMenuOption(result.items, normalizedModel);
      if (match) {
        await evaluate(
          cdp,
          `(() => {
            ${buildClickDispatcher()}
            const menu = document.querySelector('[role="menu"][data-radix-menu-content]');
            const item = menu?.querySelector('[data-testid="${match.testId}"]');
            if (item) dispatchClickSequence(item);
          })()`,
        );
        await delay(200, signal);
        return match.label;
      }

      const available = Array.isArray(result.items)
        ? result.items
            .filter(
              (item) =>
                item?.role === "menuitemradio" &&
                typeof item?.testId === "string" &&
                item.testId.startsWith("model-switcher-"),
            )
            .map((item) => item.label)
            .filter(Boolean)
            .join(", ")
        : "";
      throw new Error(
        available
          ? `Model not found: ${desiredModel}. Available: ${available}`
          : `Model not found: ${desiredModel}`,
      );
    }

    await delay(100, signal);
  }

  throw new Error(`Model not found: ${desiredModel} (timeout)`);
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
        const editor = document.querySelector('#prompt-textarea');
        const fallback = document.querySelector('textarea[name="prompt-textarea"]');
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
  normalizeChatGPTModelChoice,
  resolveChatGPTModelMenuOption,
  selectModel,
  typePrompt,
  waitForPageLoad,
  waitForPromptReady,
};
