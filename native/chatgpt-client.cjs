const CHATGPT_URL = "https://chatgpt.com/";

const SELECTORS = {
  promptTextarea: '#prompt-textarea, [data-testid="composer-textarea"], textarea[name="prompt-textarea"], .ProseMirror, [contenteditable="true"][data-virtualkeyboard="true"]',
  sendButton: 'button[data-testid="send-button"], button[data-testid*="composer-send"], form button[type="submit"]',
  modelButton: '[data-testid="model-switcher-dropdown-button"]',
  assistantMessage: '[data-message-author-role="assistant"], [data-turn="assistant"], [data-testid*="assistant-message"], [data-testid*="assistant-turn"], [data-testid*="assistant-response"]',
  assistantContent: '.markdown, [data-message-content], .prose, [class*="markdown"], [dir="auto"]',
  stopButton: '[data-testid="stop-button"], [data-testid*="stop"], button[aria-label*="Stop"], button[aria-label*="stop"]',
  finishedActions: 'button[data-testid="copy-turn-action-button"], button[data-testid="good-response-turn-action-button"], button[data-testid*="turn-action"], button[aria-label*="Copy"], button[aria-label*="copy"], button[aria-label*="Read aloud"], button[aria-label*="read aloud"]',
  conversationTurn: '[data-testid^="conversation-turn"], [data-testid*="conversation-turn"]',
  cloudflareScript: 'script[src*="/challenge-platform/"]',
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function hasRequiredCookies(cookies) {
  if (!cookies || !Array.isArray(cookies)) return false;
  return cookies.some(
    (c) =>
      typeof c?.name === "string" &&
      Boolean(c.value) &&
      (c.name === "__Secure-next-auth.session-token" ||
        /^__Secure-next-auth\.session-token\.\d+$/.test(c.name))
  );
}

function cleanChatGPTResponseText(rawText) {
  if (!rawText) return "";

  const chromeLines = new Set([
    "copy",
    "good response",
    "bad response",
    "read aloud",
    "edit",
    "retry",
    "continue generating",
    "share",
  ]);

  const lines = [];
  let inCodeFence = false;

  for (const line of String(rawText).replace(/\r\n?/g, "\n").split("\n")) {
    const trimmed = line.trim();
    const isFenceLine = trimmed.startsWith("```");
    const normalizedLine = inCodeFence || isFenceLine ? line.replace(/[\t ]+$/g, "") : line;

    lines.push({
      text: normalizedLine,
      trimmed,
      isChrome: trimmed.length > 0 && chromeLines.has(trimmed.toLowerCase()),
      inCodeFence,
      isFenceLine,
    });

    if (isFenceLine) {
      inCodeFence = !inCodeFence;
    }
  }

  while (lines.length > 0 && lines[0].trimmed.length === 0) {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1].trimmed.length === 0) {
    lines.pop();
  }

  let trailingChromeStart = lines.length;
  while (trailingChromeStart > 0) {
    const line = lines[trailingChromeStart - 1];
    if (line.inCodeFence || line.isFenceLine || !line.isChrome) break;
    trailingChromeStart--;
  }

  const trailingChromeCount = lines.length - trailingChromeStart;
  if (trailingChromeCount >= 2) {
    lines.splice(trailingChromeStart);
  }

  while (lines.length > 0 && lines[0].trimmed.length === 0) {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1].trimmed.length === 0) {
    lines.pop();
  }

  return lines.map((line) => line.text).join("\n");
}

function extractLatestAssistantSnapshot(candidates) {
  if (!Array.isArray(candidates)) return null;

  let latestEmptyAssistant = null;

  for (let i = candidates.length - 1; i >= 0; i--) {
    const candidate = candidates[i];
    if (!candidate?.isAssistant) continue;

    const snapshot = {
      ...candidate,
      text: cleanChatGPTResponseText(candidate?.text || ""),
      turnIndex: i,
    };

    if (snapshot.text) {
      return snapshot;
    }

    if (!latestEmptyAssistant) {
      latestEmptyAssistant = snapshot;
    }
  }

  return latestEmptyAssistant;
}

function normalizeResponseSnapshot(rawSnapshot) {
  const candidates = rawSnapshot?.candidates;
  return {
    latestAssistant: extractLatestAssistantSnapshot(candidates),
    assistantCount: Array.isArray(candidates)
      ? candidates.filter((candidate) => candidate?.isAssistant).length
      : 0,
    stopVisible: Boolean(rawSnapshot?.stopVisible),
  };
}

function isNewAssistantContent(
  latestAssistant,
  baselineAssistant,
  assistantCount = 0,
  baselineAssistantCount = 0
) {
  if (!latestAssistant) return false;
  if (!baselineAssistant) return true;
  if (latestAssistant.messageId && baselineAssistant.messageId) {
    if (latestAssistant.messageId !== baselineAssistant.messageId) {
      return true;
    }
  }

  const currentText = latestAssistant.text || "";
  const baselineText = baselineAssistant.text || "";

  if (assistantCount > baselineAssistantCount) {
    if (latestAssistant.turnIndex !== baselineAssistant.turnIndex) {
      return true;
    }
    if (currentText !== baselineText) {
      return true;
    }
    return false;
  }

  if (currentText !== baselineText) {
    return true;
  }
  return false;
}

function isChatGPTResponseComplete(snapshot, stableCycles, stableMs) {
  if (!snapshot?.text) return false;
  if (snapshot.stopVisible) return false;
  if (snapshot.hasFinishedActions) return true;
  return stableCycles >= 6 && stableMs >= 1200;
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

async function waitForPageLoad(cdp, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await evaluate(cdp, "document.readyState");
    if (ready === "complete" || ready === "interactive") {
      return;
    }
    await delay(100);
  }
  throw new Error("Page did not load in time");
}

async function isCloudflareBlocked(cdp) {
  const title = await evaluate(cdp, "document.title.toLowerCase()");
  if (title && title.includes("just a moment")) return true;
  const hasScript = await evaluate(
    cdp,
    `Boolean(document.querySelector('${SELECTORS.cloudflareScript}'))`
  );
  return hasScript;
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
    })()`
  );
  return result || { status: 0 };
}

async function waitForPromptReady(cdp, timeoutMs = 30000) {
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
      })()`
    );
    if (found) return true;
    await delay(200);
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

  return items.find((item) => {
    if (item?.role !== "menuitemradio") return false;
    if (typeof item?.testId !== "string" || !item.testId.startsWith("model-switcher-")) return false;

    const label = normalizeChatGPTModelChoice(item.label || "");
    const testId = normalizeChatGPTModelChoice(item.testId.replace(/^model-switcher-/, ""));
    return label === targetModel || testId === targetModel;
  }) || null;
}

async function selectModel(cdp, desiredModel, timeoutMs = 8000) {
  const modelButton = await evaluate(
    cdp,
    `(() => {
      const btn = document.querySelector('${SELECTORS.modelButton}');
      return btn ? true : false;
    })()`
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
    })()`
  );
  await delay(300);

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
      })()`
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
          })()`
        );
        await delay(200);
        return match.label;
      }

      const available = Array.isArray(result.items)
        ? result.items
            .filter((item) => item?.role === "menuitemradio" && typeof item?.testId === "string" && item.testId.startsWith("model-switcher-"))
            .map((item) => item.label)
            .filter(Boolean)
            .join(", ")
        : "";
      throw new Error(
        available
          ? `Model not found: ${desiredModel}. Available: ${available}`
          : `Model not found: ${desiredModel}`
      );
    }

    await delay(100);
  }

  throw new Error(`Model not found: ${desiredModel} (timeout)`);
}

async function typePrompt(cdp, inputCdp, prompt) {
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
    })()`
  );
  if (!focused) {
    throw new Error("Failed to focus prompt textarea");
  }
  await inputCdp("Input.insertText", { text: prompt });
  await delay(300);
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
    })()`
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
      })()`
    );
  }
}

async function clickSend(cdp, inputCdp) {
  const selectors = SELECTORS.sendButton.split(", ");
  const selectorsJson = JSON.stringify(selectors);
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
      })()`
    );
    if (result === "clicked") return true;
    if (result === "missing") break;
    await delay(100);
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

async function readChatGPTResponseSnapshot(cdp) {
  return evaluate(
    cdp,
    `(() => {
      const scope = document.querySelector('main') || document;
      const CONVERSATION_SELECTOR = ${JSON.stringify(SELECTORS.conversationTurn)};
      const ASSISTANT_SELECTOR = ${JSON.stringify(SELECTORS.assistantMessage)};
      const CONTENT_SELECTORS = ${JSON.stringify(SELECTORS.assistantContent.split(", "))};
      const STOP_SELECTOR = ${JSON.stringify(SELECTORS.stopButton)};
      const FINISHED_SELECTOR = ${JSON.stringify(SELECTORS.finishedActions)};

      const toCandidate = (turnNode, messageRoot = null) => {
        const resolvedMessageRoot = messageRoot || (turnNode.matches?.(ASSISTANT_SELECTOR)
          ? turnNode
          : turnNode.querySelector(ASSISTANT_SELECTOR));
        const searchRoot = resolvedMessageRoot || turnNode;
        let contentRoot = null;

        for (const selector of CONTENT_SELECTORS) {
          const match = selector === '[dir="auto"]'
            ? (searchRoot.matches?.(selector) ? searchRoot : null)
            : (searchRoot.matches?.(selector) ? searchRoot : searchRoot.querySelector(selector));
          if (match) {
            contentRoot = match;
            break;
          }
        }

        const role =
          resolvedMessageRoot?.getAttribute('data-message-author-role') ||
          turnNode.getAttribute('data-message-author-role') ||
          null;
        const turn =
          resolvedMessageRoot?.getAttribute('data-turn') ||
          turnNode.getAttribute('data-turn') ||
          null;
        const isAssistant =
          role === 'assistant' ||
          turn === 'assistant' ||
          resolvedMessageRoot !== null;
        const text = (contentRoot || turnNode).innerText || (contentRoot || turnNode).textContent || '';
        const messageId =
          resolvedMessageRoot?.getAttribute('data-message-id') ||
          turnNode.getAttribute('data-message-id') ||
          null;
        const hasFinishedActions = Boolean(turnNode.querySelector(FINISHED_SELECTOR));

        return {
          role,
          turn,
          isAssistant,
          text,
          messageId,
          hasFinishedActions,
        };
      };

      let candidates = Array.from(scope.querySelectorAll(CONVERSATION_SELECTOR)).map((turnNode) =>
        toCandidate(turnNode)
      );

      if (candidates.length === 0) {
        candidates = Array.from(scope.querySelectorAll(ASSISTANT_SELECTOR)).map((messageRoot) =>
          toCandidate(messageRoot, messageRoot)
        );
      }

      return {
        candidates,
        stopVisible: Boolean(scope.querySelector(STOP_SELECTOR)),
      };
    })()`
  );
}

async function waitForResponse(
  cdp,
  timeoutMs = 2700000,
  baselineAssistant,
  baselineAssistantCount
) {
  const deadline = Date.now() + timeoutMs;
  let previousText = "";
  let stableCycles = 0;
  let lastChangeAt = Date.now();

  previousText = baselineAssistant?.text || "";
  lastChangeAt = Date.now();

  while (Date.now() < deadline) {
    const snapshot = await readChatGPTResponseSnapshot(cdp);

    if (!snapshot) {
      await delay(400);
      continue;
    }

    const { latestAssistant, assistantCount, stopVisible } = normalizeResponseSnapshot(snapshot);
    const currentText = latestAssistant?.text || "";
    const hasNewAssistantContent = isNewAssistantContent(
      latestAssistant,
      baselineAssistant,
      assistantCount,
      baselineAssistantCount
    );

    if (!hasNewAssistantContent) {
      await delay(400);
      continue;
    }

    if (currentText !== previousText) {
      previousText = currentText;
      stableCycles = 0;
      lastChangeAt = Date.now();
    } else if (currentText) {
      stableCycles++;
    } else {
      stableCycles = 0;
      lastChangeAt = Date.now();
    }

    const stableMs = Date.now() - lastChangeAt;
    const completionSnapshot = latestAssistant
      ? { ...latestAssistant, stopVisible }
      : { text: "", stopVisible, hasFinishedActions: false };

    if (isChatGPTResponseComplete(completionSnapshot, stableCycles, stableMs)) {
      return {
        text: latestAssistant.text,
        messageId: latestAssistant.messageId,
        turnIndex: latestAssistant.turnIndex,
      };
    }

    await delay(400);
  }

  throw new Error("Response timeout");
}

async function query(options) {
  const {
    prompt,
    model,
    file,
    timeout = 2700000,
    getCookies,
    createTab,
    closeTab,
    cdpEvaluate,
    cdpCommand,
    log = () => {},
  } = options;
  const startTime = Date.now();
  log("Starting ChatGPT query");
  const { cookies } = await getCookies();
  if (!hasRequiredCookies(cookies)) {
    throw new Error("ChatGPT login required");
  }
  log(`Got ${cookies.length} cookies`);
  const tabInfo = await createTab();
  const { tabId } = tabInfo;
  if (!tabId) {
    throw new Error("Failed to create ChatGPT tab");
  }
  log(`Created tab ${tabId}`);
  
  const cdp = (expr) => cdpEvaluate(tabId, expr);
  const inputCdp = (method, params) => cdpCommand(tabId, method, params);
  
  try {
    await waitForPageLoad(cdp);
    log("Page loaded");
    if (await isCloudflareBlocked(cdp)) {
      throw new Error("Cloudflare challenge detected - complete in browser");
    }
    const loginStatus = await checkLoginStatus(cdp);
    if (loginStatus.status === 0) {
      throw new Error(
        loginStatus.error
          ? `ChatGPT login check failed: ${loginStatus.error}`
          : "ChatGPT login check failed"
      );
    }
    if (loginStatus.status !== 200 || loginStatus.hasLoginCta) {
      throw new Error("ChatGPT login required");
    }
    log("Login verified");
    const promptReady = await waitForPromptReady(cdp);
    if (!promptReady) {
      throw new Error("Prompt textarea not ready");
    }
    log("Prompt ready");
    if (model) {
      const selectedLabel = await selectModel(cdp, model);
      log(`Selected model: ${selectedLabel}`);
    }
    if (file) {
      throw new Error("File upload not yet implemented");
    }
    await typePrompt(cdp, inputCdp, prompt);
    log("Prompt typed");
    const baseline = normalizeResponseSnapshot(await readChatGPTResponseSnapshot(cdp));
    await clickSend(cdp, inputCdp);
    log("Prompt sent, waiting for response...");
    const response = await waitForResponse(
      cdp,
      timeout,
      baseline.latestAssistant,
      baseline.assistantCount
    );
    log(`Response received (${response.text.length} chars)`);
    return {
      response: response.text,
      model: model || "current",
      messageId: response.messageId,
      tookMs: Date.now() - startTime,
    };
  } finally {
    try {
      await closeTab(tabId);
    } catch (error) {
      log(`Failed to close ChatGPT tab ${tabId}: ${error?.message || error}`);
    }
  }
}

module.exports = {
  query,
  hasRequiredCookies,
  cleanChatGPTResponseText,
  extractLatestAssistantSnapshot,
  normalizeChatGPTModelChoice,
  resolveChatGPTModelMenuOption,
  isNewAssistantContent,
  isChatGPTResponseComplete,
  CHATGPT_URL,
};
