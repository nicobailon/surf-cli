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
  toolsButton:
    'button[data-testid="composer-plus-btn"], button[aria-label="Add files and more"]',
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

function uiError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function readChatTabState(cdp, signal) {
  return evaluate(
    cdp,
    `(() => {
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const visible = (node) => {
        if (!node || node.hasAttribute?.('hidden') || node.getAttribute?.('aria-hidden') === 'true') return false;
        const style = window.getComputedStyle?.(node);
        if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
        const rect = node.getBoundingClientRect?.();
        return !rect || (rect.width > 0 && rect.height > 0);
      };
      const selected = (node) => node.getAttribute?.('aria-selected') === 'true' ||
        node.getAttribute?.('aria-current') === 'page' ||
        node.getAttribute?.('data-state') === 'active' ||
        node.getAttribute?.('data-state') === 'selected' ||
        node.getAttribute?.('data-active') === 'true' ||
        /\\b(active|selected)\\b/i.test(String(node.className || ''));
      const labelFor = (node) => [
        node.innerText || node.textContent || '',
        node.getAttribute?.('aria-label') || '',
        node.getAttribute?.('title') || '',
      ].join(' ').replace(/\\s+/g, ' ').trim();
      const matchesName = (node, name) => [
        node.innerText || node.textContent || '',
        node.getAttribute?.('aria-label') || '',
        node.getAttribute?.('title') || '',
      ].some((value) => {
        const normalized = normalize(value);
        return normalized === name || normalized === name + ' tab' || normalized === 'switch to ' + name;
      });
      const nodes = Array.from(new Set([
        ...document.querySelectorAll('[role="tab"], button, a'),
      ])).filter(visible);
      const details = (node) => ({ label: labelFor(node).slice(0, 120), selected: selected(node) });
      const matches = (name) => nodes
        .filter((node) => matchesName(node, name))
        .map(details);
      return { chat: matches('chat'), work: matches('work') };
    })()`,
    signal,
  );
}

async function selectChatTab(cdp, timeoutMs = 8000, signal) {
  throwIfAborted(signal);
  const read = () => readChatTabState(cdp, signal);
  let state = await read();
  if (state?.chat?.length === 1 && state.chat[0].selected) return state.chat[0].label;
  if (state?.chat?.length === 0 && state?.work?.length > 0) {
    throw uiError(
      "chat_mode_unavailable",
      "ChatGPT only exposes Work mode; the Chat tab is required for Oracle",
    );
  }
  if (state?.chat?.length !== 1) {
    throw uiError(
      "chat_mode_selector_drift",
      state?.chat?.length
        ? "ChatGPT Chat tab selector drift: Chat tab is ambiguous"
        : "ChatGPT Chat tab selector drift: Chat tab was not found",
    );
  }

  const clicked = await evaluate(
    cdp,
    `(() => {
      ${buildClickDispatcher()}
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const matchesName = (node) => [
        node.innerText || node.textContent || '',
        node.getAttribute?.('aria-label') || '',
        node.getAttribute?.('title') || '',
      ].some((value) => {
        const normalized = normalize(value);
        return normalized === 'chat' || normalized === 'chat tab' || normalized === 'switch to chat';
      });
      const nodes = Array.from(new Set([
        ...document.querySelectorAll('[role="tab"], button, a'),
      ])).filter(matchesName);
      return nodes.length === 1 ? dispatchClickSequence(nodes[0]) : false;
    })()`,
    signal,
  );
  if (!clicked) {
    throw uiError("chat_mode_selector_drift", "ChatGPT Chat tab selector drift: Chat tab could not be clicked");
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await delay(100, signal);
    state = await read();
    if (state?.chat?.length === 1 && state.chat[0].selected) return state.chat[0].label;
    if (state?.chat?.length === 0 && state?.work?.length > 0) {
      throw uiError(
        "chat_mode_unavailable",
        "ChatGPT only exposes Work mode; the Chat tab is required for Oracle",
      );
    }
  }
  throw uiError("chat_mode_selection_failed", "ChatGPT Chat tab could not be selected before timeout");
}

async function readGitHubToolState(cdp, signal) {
  return evaluate(
    cdp,
    `(() => {
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const visible = (node) => {
        if (!node || node.hasAttribute?.('hidden') || node.getAttribute?.('aria-hidden') === 'true') return false;
        const style = window.getComputedStyle?.(node);
        if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
        const rect = node.getBoundingClientRect?.();
        return !rect || (rect.width > 0 && rect.height > 0);
      };
      const labelFor = (node) => [
        node.innerText || node.textContent || '',
        node.getAttribute?.('aria-label') || '',
        node.getAttribute?.('title') || '',
        node.getAttribute?.('data-testid') || '',
        node.getAttribute?.('data-tool') || '',
      ].join(' ').replace(/\\s+/g, ' ').trim();
      const selected = (node, label) => node.getAttribute?.('aria-checked') === 'true' ||
        node.getAttribute?.('aria-selected') === 'true' ||
        node.getAttribute?.('aria-pressed') === 'true' ||
        node.getAttribute?.('data-selected') === 'true' ||
        node.getAttribute?.('data-active') === 'true' ||
        ['checked', 'selected', 'on', 'active'].includes(normalize(node.getAttribute?.('data-state'))) ||
        /\\b(active|selected)\\b/i.test(label);
      const controls = Array.from(new Set([
        ...document.querySelectorAll('[role="menuitem"], [role="option"], [role="button"], button, [data-testid*="github" i], [data-tool*="github" i], [aria-label*="github" i], [title*="github" i]'),
      ])).filter(visible);
      const github = controls.filter((node) => normalize(labelFor(node)).includes('github'));
      return {
        controls: github.map((node) => {
          const label = labelFor(node).slice(0, 160);
          return {
            label,
            role: node.getAttribute?.('role') || (node.tagName === 'BUTTON' ? 'button' : null),
            selected: selected(node, label),
            disconnected: /\\b(disconnected|not connected|connect|authorize|sign in)\\b/i.test(label),
            testId: node.getAttribute?.('data-testid') || null,
          };
        }),
      };
    })()`,
    signal,
  );
}

async function openToolsMenu(cdp, signal) {
  return evaluate(
    cdp,
    `(() => {
      ${buildClickDispatcher()}
      const selectors = ${JSON.stringify(SELECTORS.toolsButton.split(", "))};
      const visible = (node) => {
        if (!node || node.hasAttribute?.('hidden') || node.getAttribute?.('aria-hidden') === 'true') return false;
        const style = window.getComputedStyle?.(node);
        return !style || (style.display !== 'none' && style.visibility !== 'hidden');
      };
      for (const selector of selectors) {
        const node = Array.from(document.querySelectorAll(selector)).find(visible);
        if (node) return dispatchClickSequence(node);
      }
      return false;
    })()`,
    signal,
  );
}

async function clickGitHubTool(cdp, signal) {
  return evaluate(
    cdp,
    `(() => {
      ${buildClickDispatcher()}
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const labelFor = (node) => [
        node.innerText || node.textContent || '',
        node.getAttribute?.('aria-label') || '',
        node.getAttribute?.('title') || '',
        node.getAttribute?.('data-testid') || '',
        node.getAttribute?.('data-tool') || '',
      ].join(' ').replace(/\\s+/g, ' ').trim();
      const controls = Array.from(new Set([
        ...document.querySelectorAll('[role="menuitem"], [role="option"], [role="button"], button, [data-testid*="github" i], [data-tool*="github" i], [aria-label*="github" i], [title*="github" i]'),
      ])).filter((node) => normalize(labelFor(node)).includes('github'));
      const menuItems = controls.filter((node) => ['menuitem', 'option'].includes(node.getAttribute?.('role')));
      const candidates = menuItems.length > 0 ? menuItems : controls;
      return candidates.length === 1 ? dispatchClickSequence(candidates[0]) : false;
    })()`,
    signal,
  );
}

async function selectGitHubTool(cdp, timeoutMs = 10000, signal) {
  throwIfAborted(signal);
  let state = await readGitHubToolState(cdp, signal);
  const findConnected = () => state?.controls?.filter((control) => !control.disconnected) || [];
  if (state?.controls?.some((control) => control.disconnected)) {
    throw uiError(
      "github_tool_disconnected",
      "ChatGPT GitHub tool is missing or disconnected; connect GitHub before running Oracle with --github",
    );
  }
  if (findConnected().length === 1 && state.controls[0].selected) return state.controls[0].label;
  if (state?.controls?.length > 1) {
    throw uiError("github_tool_selector_drift", "ChatGPT GitHub tool selector drift: GitHub tool is ambiguous");
  }
  if (state?.controls?.length === 0) {
    const opened = await openToolsMenu(cdp, signal);
    if (!opened) {
      throw uiError("github_tool_selector_drift", "ChatGPT tools selector drift: tools menu could not be opened");
    }
    const menuDeadline = Date.now() + timeoutMs;
    while (Date.now() < menuDeadline) {
      await delay(100, signal);
      state = await readGitHubToolState(cdp, signal);
      if (state?.controls?.some((control) => control.disconnected)) {
        throw uiError(
          "github_tool_disconnected",
          "ChatGPT GitHub tool is missing or disconnected; connect GitHub before running Oracle with --github",
        );
      }
      if (state?.controls?.length > 0) break;
    }
  }
  if (!state?.controls?.length) {
    throw uiError("github_tool_missing", "ChatGPT GitHub tool is not available in the tools menu");
  }
  if (state.controls.length === 1 && state.controls[0].selected) return state.controls[0].label;
  if (state.controls.length !== 1 || !(await clickGitHubTool(cdp, signal))) {
    throw uiError("github_tool_selector_drift", "ChatGPT GitHub tool selector drift: GitHub tool could not be selected");
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await delay(100, signal);
    state = await readGitHubToolState(cdp, signal);
    if (state?.controls?.some((control) => control.disconnected)) {
      throw uiError(
        "github_tool_disconnected",
        "ChatGPT GitHub tool became disconnected while selecting it",
      );
    }
    if (state?.controls?.length === 1 && state.controls[0].selected) return state.controls[0].label;
  }
  throw uiError("github_tool_selection_failed", "ChatGPT GitHub tool could not be verified after selection");
}

async function waitForChatGPTAttachment(cdp, filePaths, timeoutMs = 30000, signal) {
  const expectedNames = (Array.isArray(filePaths) ? filePaths : [filePaths])
    .map((filePath) => String(filePath).split(/[\\/]/).pop().toLowerCase());
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await evaluate(
      cdp,
      `(() => {
        const scope = document.querySelector('form') || document.querySelector('[data-testid*="composer"]') || document;
        const text = (scope.innerText || scope.textContent || '').replace(/\\s+/g, ' ').trim();
        const inputs = Array.from(scope.querySelectorAll?.('input[type="file"]') || []);
        const fileCount = inputs.reduce((count, input) => count + (input.files?.length || 0), 0);
        const attachmentNodes = Array.from(scope.querySelectorAll?.('[data-testid*="attachment" i], [data-testid*="file" i], [aria-label*="remove attachment" i], [aria-label*="remove file" i]') || [])
          .filter((node) => node.tagName !== 'INPUT' || node.type !== 'file');
        const hasAttachmentNode = attachmentNodes.some((node) => {
          const rect = node.getBoundingClientRect?.();
          return !rect || (rect.width > 0 && rect.height > 0);
        });
        const attachmentLabels = attachmentNodes
          .filter((node) => {
            const rect = node.getBoundingClientRect?.();
            return !rect || (rect.width > 0 && rect.height > 0);
          })
          .map((node) => [
            node.innerText || node.textContent || '',
            node.getAttribute?.('aria-label') || '',
            node.getAttribute?.('title') || '',
          ].join(' ').replace(/\\s+/g, ' ').trim().toLowerCase())
          .filter(Boolean);
        const processingError = /\\b(upload failed|failed to upload|couldn.t upload|unsupported file|file too large|processing failed|error processing)\\b/i.test(text);
        return { fileCount, hasAttachmentNode, attachmentLabels, processingError, text: text.slice(-300) };
      })()`,
      signal,
    );
    if (state?.processingError) {
      throw uiError(
        "attachment_processing",
        `ChatGPT attachment processing failed${state.text ? `: ${state.text}` : ""}`,
      );
    }
    const attachmentLabels = Array.isArray(state?.attachmentLabels) ? state.attachmentLabels : [];
    const hasExpectedName = expectedNames.every((expected) =>
      attachmentLabels.some((label) => label.includes(expected)),
    );
    const hasPotentialFilename = attachmentLabels.some((label) => /(?:^|\\s)[\\w.-]+\\.[a-z0-9]{1,8}(?:$|\\s|[)\\]])/i.test(label));
    if (state?.hasAttachmentNode && (hasExpectedName || !hasPotentialFilename)) return true;
    await delay(250, signal);
  }
  throw uiError(
    "attachment_processing",
    `ChatGPT attachment processing did not complete for ${expectedNames.filter(Boolean).join(", ") || "the selected file"}`,
  );
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
  const current = await readPicker(cdp, "effort");
  const currentVerified = verifyChatGPTEffortSelection(current?.items, normalizedEffort);
  if (currentVerified) return currentVerified.displayLabel || currentVerified.label;

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
        if ('value' in node) {
          node.value = '';
          node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
        } else {
          node.textContent = '';
          node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
        }
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
  selectChatTab,
  selectEffort,
  selectGitHubTool,
  selectModel,
  verifyChatGPTEffortSelection,
  verifyChatGPTModelSelection,
  waitForChatGPTAttachment,
  typePrompt,
  waitForPageLoad,
  waitForPromptReady,
};
