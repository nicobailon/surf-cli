import { CDPController } from "../cdp/controller";
import { debugLog } from "../utils/debug";
import { initNativeMessaging, postToNativeHost } from "../native/port-manager";

debugLog("Service worker loaded");

const cdp = new CDPController();
const activeStreamTabs = new Map<number, number>();

const screenshotCache = new Map<string, { base64: string; width: number; height: number }>();
let screenshotCounter = 0;

function generateScreenshotId(): string {
  return `screenshot_${++screenshotCounter}_${Date.now()}`;
}

function cacheScreenshot(id: string, data: { base64: string; width: number; height: number }): void {
  screenshotCache.set(id, data);
  if (screenshotCache.size > 10) {
    const oldest = screenshotCache.keys().next().value;
    if (oldest) screenshotCache.delete(oldest);
  }
}

function getScreenshot(id: string): { base64: string; width: number; height: number } | null {
  return screenshotCache.get(id) || null;
}

const tabGroups = new Map<number, number>();
const navigationResolvers = new Map<number, () => void>();
const tabNameRegistry = new Map<string, number>();

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId === 0) {
    const resolver = navigationResolvers.get(details.tabId);
    if (resolver) {
      resolver();
      navigationResolvers.delete(details.tabId);
    }
  }
});

chrome.webNavigation.onErrorOccurred.addListener((details) => {
  if (details.frameId === 0) {
    const resolver = navigationResolvers.get(details.tabId);
    if (resolver) {
      resolver();
      navigationResolvers.delete(details.tabId);
    }
  }
});

async function openSidePanel(tabId: number): Promise<void> {
  chrome.sidePanel.setOptions({
    tabId,
    path: `sidepanel/index.html?tabId=${encodeURIComponent(tabId)}`,
    enabled: true,
  });
  chrome.sidePanel.open({ tabId });
  
  await ensureTabGroup(tabId);
}

async function ensureTabGroup(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    
    if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      tabGroups.set(tabId, tab.groupId);
      return;
    }
    
    const groupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(groupId, {
      title: "Pi Agent",
      color: "blue",
      collapsed: false,
    });
    tabGroups.set(tabId, groupId);
  } catch (e) {
    debugLog("Could not create tab group:", e);
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    await openSidePanel(tab.id);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-side-panel") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await openSidePanel(tab.id);
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  cdp.detach(tabId);
  tabGroups.delete(tabId);
  for (const [name, id] of tabNameRegistry) {
    if (id === tabId) {
      tabNameRegistry.delete(name);
    }
  }
  for (const [streamId, streamTabId] of activeStreamTabs) {
    if (streamTabId === tabId) {
      activeStreamTabs.delete(streamId);
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message }));
  return true;
});

async function handleMessage(
  message: any,
  sender: chrome.runtime.MessageSender
): Promise<any> {
  const tabId = message.tabId;

  switch (message.type) {
    case "GET_CURRENT_TAB_ID": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return { tabId: tab?.id };
    }

    case "EXECUTE_SCREENSHOT": {
      if (!tabId) throw new Error("No tabId provided");
      try {
        await chrome.tabs.sendMessage(tabId, { type: "HIDE_FOR_TOOL_USE" });
      } catch (e) {}
      await new Promise(resolve => setTimeout(resolve, 50));
      
      try {
        const result = await cdp.captureScreenshot(tabId);
        const screenshotId = generateScreenshotId();
        cacheScreenshot(screenshotId, result);
        return { ...result, screenshotId };
      } finally {
        try {
          await chrome.tabs.sendMessage(tabId, { type: "SHOW_AFTER_TOOL_USE" });
        } catch (e) {}
      }
    }

    case "EXECUTE_CLICK": {
      if (!tabId) throw new Error("No tabId provided");
      const mods = message.modifiers ? cdp.parseModifiers(message.modifiers) : 0;
      await cdp.click(tabId, message.x, message.y, "left", 1, mods);
      return { success: true };
    }

    case "EXECUTE_RIGHT_CLICK": {
      if (!tabId) throw new Error("No tabId provided");
      const mods = message.modifiers ? cdp.parseModifiers(message.modifiers) : 0;
      await cdp.rightClick(tabId, message.x, message.y, mods);
      return { success: true };
    }

    case "EXECUTE_DOUBLE_CLICK": {
      if (!tabId) throw new Error("No tabId provided");
      const mods = message.modifiers ? cdp.parseModifiers(message.modifiers) : 0;
      await cdp.doubleClick(tabId, message.x, message.y, mods);
      return { success: true };
    }

    case "EXECUTE_TRIPLE_CLICK": {
      if (!tabId) throw new Error("No tabId provided");
      const mods = message.modifiers ? cdp.parseModifiers(message.modifiers) : 0;
      await cdp.tripleClick(tabId, message.x, message.y, mods);
      return { success: true };
    }

    case "EXECUTE_DRAG": {
      if (!tabId) throw new Error("No tabId provided");
      const mods = message.modifiers ? cdp.parseModifiers(message.modifiers) : 0;
      await cdp.drag(tabId, message.startX, message.startY, message.endX, message.endY, mods);
      return { success: true };
    }

    case "EXECUTE_HOVER": {
      if (!tabId) throw new Error("No tabId provided");
      await cdp.hover(tabId, message.x, message.y);
      return { success: true };
    }

    case "EXECUTE_TYPE": {
      if (!tabId) throw new Error("No tabId provided");
      if (message.text === undefined || message.text === null) throw new Error("No text provided");
      await cdp.type(tabId, message.text);
      return { success: true };
    }

    case "TYPE_SUBMIT": {
      if (!tabId) throw new Error("No tabId provided");
      if (!message.text) throw new Error("No text provided");
      await cdp.type(tabId, message.text);
      await cdp.pressKey(tabId, message.submitKey || "Enter");
      return { success: true };
    }

    case "CLICK_TYPE": {
      if (!tabId) throw new Error("No tabId provided");
      if (!message.text) throw new Error("No text provided");
      let clicked = false;
      if (message.ref) {
        try {
          const result = await chrome.tabs.sendMessage(tabId, { type: "CLICK_ELEMENT", ref: message.ref, button: "left" }, { frameId: 0 });
          if (!result.error) clicked = true;
        } catch {}
      }
      if (!clicked && message.coordinate) {
        await cdp.click(tabId, message.coordinate[0], message.coordinate[1], "left", 1, 0);
        clicked = true;
      }
      if (!clicked) {
        const result = await cdp.evaluateScript(tabId, `(() => {
          const el = document.querySelector('textarea, input[type="text"], input[type="search"], input:not([type]), [contenteditable="true"]');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width/2, y: r.top + r.height/2 };
        })()`);
        if (result.result?.value) {
          await cdp.click(tabId, result.result.value.x, result.result.value.y, "left", 1, 0);
          clicked = true;
        }
      }
      if (!clicked) return { error: "Could not find input element" };
      await cdp.type(tabId, message.text);
      return { success: true };
    }

    case "CLICK_TYPE_SUBMIT": {
      if (!tabId) throw new Error("No tabId provided");
      if (!message.text) throw new Error("No text provided");
      let clicked = false;
      if (message.ref) {
        try {
          const result = await chrome.tabs.sendMessage(tabId, { type: "CLICK_ELEMENT", ref: message.ref, button: "left" }, { frameId: 0 });
          if (!result.error) clicked = true;
        } catch {}
      }
      if (!clicked && message.coordinate) {
        await cdp.click(tabId, message.coordinate[0], message.coordinate[1], "left", 1, 0);
        clicked = true;
      }
      if (!clicked) {
        const result = await cdp.evaluateScript(tabId, `(() => {
          const el = document.querySelector('textarea, input[type="text"], input[type="search"], input:not([type]), [contenteditable="true"]');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width/2, y: r.top + r.height/2 };
        })()`);
        if (result.result?.value) {
          await cdp.click(tabId, result.result.value.x, result.result.value.y, "left", 1, 0);
          clicked = true;
        }
      }
      if (!clicked) return { error: "Could not find input element" };
      await cdp.type(tabId, message.text);
      await cdp.pressKey(tabId, message.submitKey || "Enter");
      return { success: true };
    }

    case "FIND_AND_TYPE": {
      if (!tabId) throw new Error("No tabId provided");
      if (!message.text) throw new Error("No text provided");
      const findResult = await cdp.evaluateScript(tabId, `(() => {
        const selectors = [
          'textarea:not([readonly]):not([disabled])',
          'input[type="text"]:not([readonly]):not([disabled])',
          'input[type="search"]:not([readonly]):not([disabled])',
          'input:not([type]):not([readonly]):not([disabled])',
          '[contenteditable="true"]',
          '[role="textbox"]'
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              el.focus();
              return { x: r.left + r.width/2, y: r.top + r.height/2, found: true };
            }
          }
        }
        return { found: false };
      })()`);
      const coords = findResult.result?.value;
      if (!coords?.found) return { error: "No input field found on page" };
      await cdp.click(tabId, coords.x, coords.y, "left", 1, 0);
      await cdp.type(tabId, message.text);
      if (message.submit) {
        await cdp.pressKey(tabId, message.submitKey || "Enter");
      }
      return { success: true, coordinates: { x: coords.x, y: coords.y } };
    }

    case "AUTOCOMPLETE_SELECT": {
      if (!tabId) throw new Error("No tabId provided");
      if (!message.text) throw new Error("No text provided");
      let clicked = false;
      if (message.ref) {
        try {
          const result = await chrome.tabs.sendMessage(tabId, { type: "CLICK_ELEMENT", ref: message.ref, button: "left" }, { frameId: 0 });
          if (!result.error) clicked = true;
        } catch {}
      }
      if (!clicked && message.coordinate) {
        await cdp.click(tabId, message.coordinate[0], message.coordinate[1], "left", 1, 0);
        clicked = true;
      }
      if (!clicked) return { error: "ref or coordinate required" };
      await new Promise(r => setTimeout(r, 100));
      await cdp.type(tabId, message.text);
      const waitMs = message.waitMs || 500;
      await new Promise(r => setTimeout(r, waitMs));
      if (message.index && message.index > 0) {
        for (let i = 0; i < message.index; i++) {
          await cdp.pressKey(tabId, "ArrowDown");
          await new Promise(r => setTimeout(r, 50));
        }
      }
      await cdp.pressKey(tabId, "Enter");
      return { success: true };
    }

    case "SET_INPUT_VALUE": {
      if (!tabId) throw new Error("No tabId provided");
      if (message.value === undefined) throw new Error("No value provided");
      const selector = message.selector;
      const ref = message.ref;
      if (!selector && !ref) throw new Error("selector or ref required");
      
      const script = ref 
        ? `(() => {
            const el = document.querySelector('[data-pi-ref="${ref}"]') || 
                       [...document.querySelectorAll('*')].find(e => e.getAttribute?.('data-ref') === '${ref}');
            if (!el) return { error: 'Element not found' };
            el.focus();
            const isContentEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true';
            const target = isContentEditable ? (el.querySelector('p') || el) : el;
            if (isContentEditable) {
              target.textContent = ${JSON.stringify(message.value)};
            } else {
              el.value = ${JSON.stringify(message.value)};
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { success: true, contentEditable: isContentEditable };
          })()`
        : `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return { error: 'Element not found: ' + ${JSON.stringify(selector)} };
            el.focus();
            const isContentEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true';
            const target = isContentEditable ? (el.querySelector('p') || el) : el;
            if (isContentEditable) {
              target.textContent = ${JSON.stringify(message.value)};
            } else {
              el.value = ${JSON.stringify(message.value)};
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { success: true, contentEditable: isContentEditable };
          })()`;
      
      const result = await cdp.evaluateScript(tabId, script);
      return result.result?.value || { error: "Script failed" };
    }

    case "SMART_TYPE": {
      if (!tabId) throw new Error("No tabId provided");
      const { selector, text, clear = true, submit = false } = message;
      if (!selector) throw new Error("selector required");
      if (text === undefined) throw new Error("text required");
      
      const script = `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { error: 'Element not found: ' + ${JSON.stringify(selector)} };
        
        const isContentEditable = el.isContentEditable || 
                                   el.getAttribute('contenteditable') === 'true';
        const hasContentEditableChild = el.querySelector('[contenteditable="true"]');
        
        const target = hasContentEditableChild || el;
        const useContentEditable = isContentEditable || !!hasContentEditableChild;
        
        target.focus();
        
        if (${clear}) {
          if (useContentEditable) {
            target.textContent = '';
          } else {
            target.value = '';
          }
        }
        
        if (useContentEditable) {
          target.textContent = ${JSON.stringify(text)};
        } else {
          target.value = ${JSON.stringify(text)};
        }
        
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        
        if (${submit}) {
          const form = el.closest('form');
          const submitBtn = document.querySelector('button[type="submit"], button[data-testid*="send"], button[aria-label*="Send"]');
          if (submitBtn) {
            submitBtn.click();
          } else if (form) {
            form.dispatchEvent(new Event('submit', { bubbles: true }));
          } else {
            target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          }
        }
        
        return { success: true, contentEditable: useContentEditable };
      })()`;
      
      const result = await cdp.evaluateScript(tabId, script);
      return result.result?.value || { error: "Script failed" };
    }

    case "CLOSE_DIALOGS": {
      if (!tabId) throw new Error("No tabId provided");
      const maxAttempts = message.maxAttempts || 3;
      for (let i = 0; i < maxAttempts; i++) {
        await cdp.pressKey(tabId, "Escape");
        await new Promise(r => setTimeout(r, 100));
      }
      return { success: true };
    }

    case "PAGE_STATE": {
      if (!tabId) throw new Error("No tabId provided");
      const stateScript = `(() => {
        const hasModal = !!(
          document.querySelector('[role="dialog"]') ||
          document.querySelector('[role="alertdialog"]') ||
          document.querySelector('.modal:not([hidden])') ||
          document.querySelector('[aria-modal="true"]') ||
          document.querySelector('.MuiModal-root') ||
          document.querySelector('.MuiDialog-root')
        );
        const hasDropdown = !!(
          document.querySelector('[role="listbox"]') ||
          document.querySelector('[role="menu"]:not([hidden])') ||
          document.querySelector('.dropdown-menu.show') ||
          document.querySelector('[aria-expanded="true"]')
        );
        const hasDatePicker = !!(
          document.querySelector('[role="grid"][aria-label*="calendar" i]') ||
          document.querySelector('.react-datepicker') ||
          document.querySelector('.flatpickr-calendar.open') ||
          document.querySelector('[class*="DatePicker"]')
        );
        const focusedEl = document.activeElement;
        const focusedTag = focusedEl?.tagName?.toLowerCase();
        const focusedType = focusedEl?.getAttribute?.('type');
        return {
          hasModal,
          hasDropdown,
          hasDatePicker,
          hasOverlay: hasModal || hasDropdown || hasDatePicker,
          focusedElement: focusedTag ? { tag: focusedTag, type: focusedType } : null,
          url: location.href,
          title: document.title
        };
      })()`;
      const stateResult = await cdp.evaluateScript(tabId, stateScript);
      return stateResult.result?.value || { error: "Failed to get page state" };
    }

    case "EXECUTE_SCROLL": {
      if (!tabId) throw new Error("No tabId provided");
      const viewport = await cdp.getViewportSize(tabId);
      const x = message.x ?? viewport.width / 2;
      const y = message.y ?? viewport.height / 2;
      await cdp.scroll(tabId, x, y, message.deltaX, message.deltaY);
      return { success: true };
    }

    case "EXECUTE_KEY": {
      if (!tabId) throw new Error("No tabId provided");
      const key = message.key;
      if (!key) throw new Error("No key provided");
      if (key.includes("+")) {
        await cdp.pressKeyChord(tabId, key);
      } else {
        await cdp.pressKey(tabId, key);
      }
      return { success: true };
    }

    case "EXECUTE_NAVIGATE": {
      if (!tabId) throw new Error("No tabId provided");
      if (!message.url) throw new Error("No url provided");
      
      const navigationPromise = new Promise<void>((resolve) => {
        navigationResolvers.set(tabId, resolve);
        setTimeout(() => {
          if (navigationResolvers.has(tabId)) {
            navigationResolvers.delete(tabId);
            resolve();
          }
        }, 30000);
      });
      
      await chrome.tabs.update(tabId, { url: message.url });
      await navigationPromise;
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      return { success: true };
    }

    case "GET_VIEWPORT_SIZE": {
      if (!tabId) throw new Error("No tabId provided");
      return await cdp.getViewportSize(tabId);
    }

    case "READ_PAGE": {
      if (!tabId) throw new Error("No tabId provided");
      try {
        await chrome.tabs.sendMessage(tabId, { type: "HIDE_FOR_TOOL_USE" }, { frameId: 0 });
      } catch (e) {}
      await new Promise(resolve => setTimeout(resolve, 50));
      
      let result;
      try {
        result = await chrome.tabs.sendMessage(tabId, {
          type: "GENERATE_ACCESSIBILITY_TREE",
          options: message.options || {},
        }, { frameId: 0 });
      } catch (err) {
        return { 
          error: "Content script not loaded. Try refreshing the page.",
          pageContent: "",
          viewport: { width: 0, height: 0 }
        };
      } finally {
        try {
          await chrome.tabs.sendMessage(tabId, { type: "SHOW_AFTER_TOOL_USE" });
        } catch (e) {}
      }
      
      if (message.options?.includeScreenshot) {
        try {
          const screenshot = await cdp.captureScreenshot(tabId);
          return { ...result, screenshot };
        } catch (err) {
          return { ...result, screenshotError: "Failed to capture screenshot" };
        }
      }
      return result;
    }

    case "GET_ELEMENT_COORDINATES": {
      if (!tabId) throw new Error("No tabId provided");
      try {
        return await chrome.tabs.sendMessage(tabId, {
          type: "GET_ELEMENT_COORDINATES",
          ref: message.ref,
        }, { frameId: 0 });
      } catch (err) {
        return { error: "Content script not loaded. Try refreshing the page." };
      }
    }

    case "FORM_INPUT": {
      if (!tabId) throw new Error("No tabId provided");
      try {
        return await chrome.tabs.sendMessage(tabId, {
          type: "FORM_INPUT",
          ref: message.ref,
          value: message.value,
        }, { frameId: 0 });
      } catch (err) {
        return { error: "Content script not loaded. Try refreshing the page." };
      }
    }

    case "SCROLL_TO_ELEMENT": {
      if (!tabId) throw new Error("No tabId provided");
      try {
        return await chrome.tabs.sendMessage(tabId, {
          type: "SCROLL_TO_ELEMENT",
          ref: message.ref,
        }, { frameId: 0 });
      } catch (err) {
        return { error: "Content script not loaded. Try refreshing the page." };
      }
    }

    case "SCROLL_TO_POSITION": {
      if (!tabId) throw new Error("No tabId provided");
      const position = message.position;
      if (position === undefined) throw new Error("position required (\"top\", \"bottom\", or number)");
      const selector = message.selector;
      
      const script = `(() => {
        const findScrollable = () => {
          const candidates = [...document.querySelectorAll("*")].filter(el => 
            el.scrollHeight > el.clientHeight && el.clientHeight > 200
          ).sort((a,b) => b.scrollHeight - a.scrollHeight);
          return candidates[0] || document.documentElement;
        };
        
        const container = ${selector ? `document.querySelector(${JSON.stringify(selector)}) || findScrollable()` : `findScrollable()`};
        if (!container) return { error: "No scrollable container found" };
        
        const pos = ${JSON.stringify(position)};
        if (pos === "bottom") {
          container.scrollTop = container.scrollHeight;
        } else if (pos === "top") {
          container.scrollTop = 0;
        } else if (typeof pos === "number") {
          container.scrollTop = pos;
        }
        
        return { 
          scrollTop: container.scrollTop,
          scrollHeight: container.scrollHeight,
          clientHeight: container.clientHeight,
          atBottom: container.scrollTop + container.clientHeight >= container.scrollHeight - 10,
          atTop: container.scrollTop < 10
        };
      })()`;
      
      const result = await cdp.evaluateScript(tabId, script);
      return result.result?.value || { error: "Script failed" };
    }

    case "GET_SCROLL_INFO": {
      if (!tabId) throw new Error("No tabId provided");
      const selector = message.selector;
      
      const script = `(() => {
        const findScrollable = () => {
          const candidates = [...document.querySelectorAll("*")].filter(el => 
            el.scrollHeight > el.clientHeight && el.clientHeight > 200
          ).sort((a,b) => b.scrollHeight - a.scrollHeight);
          return candidates[0] || document.documentElement;
        };
        
        const container = ${selector ? `document.querySelector(${JSON.stringify(selector)}) || findScrollable()` : `findScrollable()`};
        if (!container) return { error: "No scrollable container found" };
        
        const maxScroll = container.scrollHeight - container.clientHeight;
        return { 
          scrollTop: container.scrollTop,
          scrollHeight: container.scrollHeight,
          clientHeight: container.clientHeight,
          atBottom: container.scrollTop + container.clientHeight >= container.scrollHeight - 10,
          atTop: container.scrollTop < 10,
          scrollPercentage: maxScroll > 0 ? Math.round((container.scrollTop / maxScroll) * 100) : 100
        };
      })()`;
      
      const result = await cdp.evaluateScript(tabId, script);
      return result.result?.value || { error: "Script failed" };
    }

    case "GET_PAGE_TEXT": {
      if (!tabId) throw new Error("No tabId provided");
      try {
        return await chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_TEXT" }, { frameId: 0 });
      } catch (err) {
        return { error: "Content script not loaded. Try refreshing the page." };
      }
    }

    case "SHOW_AGENT_INDICATORS":
    case "HIDE_AGENT_INDICATORS":
    case "SHOW_STATIC_INDICATOR":
    case "HIDE_STATIC_INDICATOR": {
      if (!tabId) throw new Error("No tabId provided");
      try {
        return await chrome.tabs.sendMessage(tabId, { type: message.type });
      } catch (err) {
        return { error: "Content script not loaded. Try refreshing the page." };
      }
    }

    case "STOP_AGENT": {
      const fromTabId = message.fromTabId;
      let targetTabId: number | undefined;
      
      if (fromTabId === "CURRENT_TAB" && sender.tab?.id) {
        targetTabId = sender.tab.id;
      } else if (typeof fromTabId === "number") {
        targetTabId = fromTabId;
      }
      
      if (targetTabId) {
        chrome.runtime.sendMessage({ type: "STOP_AGENT", targetTabId });
      }
      return { success: true };
    }

    case "OPEN_SIDEPANEL": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await openSidePanel(tab.id);
      }
      return { success: true };
    }

    case "DISMISS_STATIC_INDICATOR": {
      return { success: true };
    }

    case "STATIC_INDICATOR_HEARTBEAT": {
      return { success: true };
    }

    case "CLICK_REF": {
      if (!tabId) throw new Error("No tabId provided");
      try {
        const result = await chrome.tabs.sendMessage(tabId, {
          type: "CLICK_ELEMENT",
          ref: message.ref,
          button: message.button || "left",
        }, { frameId: 0 });
        if (result.error) return { error: result.error };
        return { success: true };
      } catch (err) {
        return { error: "Content script not loaded. Try refreshing the page." };
      }
    }

    case "HOVER_REF": {
      if (!tabId) throw new Error("No tabId provided");
      try {
        const coords = await chrome.tabs.sendMessage(tabId, {
          type: "GET_ELEMENT_COORDINATES",
          ref: message.ref,
        }, { frameId: 0 });
        if (coords.error) return { error: coords.error };
        await cdp.hover(tabId, coords.x, coords.y);
        return { success: true };
      } catch (err) {
        return { error: "Content script not loaded. Try refreshing the page." };
      }
    }

    case "PING": {
      return { success: true, status: "connected" };
    }

    case "HEALTH_CHECK_URL": {
      if (!message.url) throw new Error("No url provided");
      const timeout = message.timeout || 30000;
      const expect = message.expect || 200;
      const startTime = Date.now();
      const pollInterval = 500;

      let lastError: string | null = null;
      while (Date.now() - startTime < timeout) {
        try {
          const response = await fetch(message.url, { method: "GET" });
          await response.text();
          if (response.status === expect) {
            return { success: true, status: response.status, time: Date.now() - startTime };
          }
          lastError = `Got status ${response.status}`;
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
        }
        await new Promise((r) => setTimeout(r, pollInterval));
      }
      return { 
        error: `Timeout waiting for ${message.url} to return ${expect}`, 
        lastError,
        time: Date.now() - startTime 
      };
    }

    case "SMOKE_TEST": {
      const urls: string[] = message.urls || [];
      const captureScreenshots: boolean = message.savePath !== undefined;
      const failFast: boolean = message.failFast || false;
      
      if (urls.length === 0) {
        return { error: "No URLs provided for smoke test" };
      }

      const results: Array<{
        url: string;
        status: "pass" | "fail";
        time: number;
        errors: string[];
        screenshotBase64?: string;
        hostname?: string;
      }> = [];

      let pass = 0;
      let fail = 0;

      for (const url of urls) {
        const startTime = Date.now();
        const errors: string[] = [];
        let screenshotBase64: string | undefined;
        let hostname: string | undefined;
        let testTabId: number | undefined;

        try {
          hostname = new URL(url).hostname.replace(/[^a-zA-Z0-9.-]/g, "_");
          const testTab = await chrome.tabs.create({ url, active: false });
          if (!testTab.id) throw new Error("Failed to create tab");
          testTabId = testTab.id;

          try {
            await cdp.enableConsoleTracking(testTabId);
          } catch (e) {}

          await new Promise<void>((resolve) => {
            const onComplete = (details: chrome.webNavigation.WebNavigationFramedCallbackDetails) => {
              if (details.tabId === testTabId && details.frameId === 0) {
                chrome.webNavigation.onCompleted.removeListener(onComplete);
                chrome.webNavigation.onErrorOccurred.removeListener(onError);
                resolve();
              }
            };
            const onError = (details: chrome.webNavigation.WebNavigationFramedErrorCallbackDetails) => {
              if (details.tabId === testTabId && details.frameId === 0) {
                chrome.webNavigation.onCompleted.removeListener(onComplete);
                chrome.webNavigation.onErrorOccurred.removeListener(onError);
                errors.push(`Navigation error: ${details.error}`);
                resolve();
              }
            };
            chrome.webNavigation.onCompleted.addListener(onComplete);
            chrome.webNavigation.onErrorOccurred.addListener(onError);
            setTimeout(() => {
              chrome.webNavigation.onCompleted.removeListener(onComplete);
              chrome.webNavigation.onErrorOccurred.removeListener(onError);
              errors.push("Navigation timeout (30s)");
              resolve();
            }, 30000);
          });

          await new Promise(r => setTimeout(r, 2000));

          const consoleMessages = cdp.getConsoleMessages(testTabId, { onlyErrors: true, limit: 50 });
          for (const msg of consoleMessages) {
            errors.push(`[${msg.type}] ${msg.text}`);
          }

          if (captureScreenshots) {
            try {
              const screenshot = await cdp.captureScreenshot(testTabId);
              screenshotBase64 = screenshot.base64;
            } catch (e) {}
          }
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        } finally {
          if (testTabId) {
            try { await chrome.tabs.remove(testTabId); } catch {}
          }
        }

        const elapsed = Date.now() - startTime;
        const status = errors.length === 0 ? "pass" : "fail";
        if (status === "pass") pass++;
        else fail++;

        results.push({
          url,
          status,
          time: elapsed,
          errors,
          ...(screenshotBase64 && { screenshotBase64, hostname }),
        });

        if (failFast && status === "fail") {
          break;
        }
      }

      return {
        results,
        summary: { pass, fail, total: results.length },
        savePath: message.savePath,
      };
    }

    case "WAIT_FOR_ELEMENT": {
      if (!tabId) throw new Error("No tabId provided");
      if (!message.selector) throw new Error("No selector provided");
      
      try {
        await chrome.tabs.sendMessage(tabId, { type: "HIDE_FOR_TOOL_USE" }, { frameId: 0 });
      } catch (e) {}
      await new Promise(resolve => setTimeout(resolve, 50));
      
      try {
        const result = await chrome.tabs.sendMessage(tabId, {
          type: "WAIT_FOR_ELEMENT",
          selector: message.selector,
          state: message.state || "visible",
          timeout: message.timeout || 20000,
        }, { frameId: 0 });
        return result;
      } catch (err) {
        return { 
          error: "Content script not loaded. Try refreshing the page.",
          pageContent: "",
          viewport: { width: 0, height: 0 }
        };
      } finally {
        try {
          await chrome.tabs.sendMessage(tabId, { type: "SHOW_AFTER_TOOL_USE" });
        } catch (e) {}
      }
    }

    case "WAIT_FOR_URL": {
      if (!tabId) throw new Error("No tabId provided");
      if (!message.pattern) throw new Error("No URL pattern provided");
      
      try {
        await chrome.tabs.sendMessage(tabId, { type: "HIDE_FOR_TOOL_USE" }, { frameId: 0 });
      } catch (e) {}
      await new Promise(resolve => setTimeout(resolve, 50));
      
      try {
        const result = await chrome.tabs.sendMessage(tabId, {
          type: "WAIT_FOR_URL",
          pattern: message.pattern,
          timeout: message.timeout || 20000,
        }, { frameId: 0 });
        return result;
      } catch (err) {
        return { 
          error: "Content script not loaded. Try refreshing the page.",
          pageContent: "",
          viewport: { width: 0, height: 0 }
        };
      } finally {
        try {
          await chrome.tabs.sendMessage(tabId, { type: "SHOW_AFTER_TOOL_USE" });
        } catch (e) {}
      }
    }

    case "WAIT_FOR_NETWORK_IDLE": {
      if (!tabId) throw new Error("No tabId provided");
      
      try {
        await chrome.tabs.sendMessage(tabId, { type: "HIDE_FOR_TOOL_USE" }, { frameId: 0 });
      } catch (e) {}
      await new Promise(resolve => setTimeout(resolve, 50));
      
      try {
        const result = await chrome.tabs.sendMessage(tabId, {
          type: "WAIT_FOR_NETWORK_IDLE",
          timeout: message.timeout || 10000,
        }, { frameId: 0 });
        return result;
      } catch (err) {
        return { 
          error: "Content script not loaded. Try refreshing the page.",
          pageContent: "",
          viewport: { width: 0, height: 0 }
        };
      } finally {
        try {
          await chrome.tabs.sendMessage(tabId, { type: "SHOW_AFTER_TOOL_USE" });
        } catch (e) {}
      }
    }

    case "WAIT_FOR_DOM_STABLE": {
      if (!tabId) throw new Error("No tabId provided");
      
      try {
        await chrome.tabs.sendMessage(tabId, { type: "HIDE_FOR_TOOL_USE" }, { frameId: 0 });
      } catch (e) {}
      await new Promise(resolve => setTimeout(resolve, 50));
      
      try {
        const result = await chrome.tabs.sendMessage(tabId, {
          type: "WAIT_FOR_DOM_STABLE",
          stable: message.stable || 100,
          timeout: message.timeout || 5000,
        }, { frameId: 0 });
        return result;
      } catch (err) {
        return { 
          error: "Content script not loaded. Try refreshing the page.",
          pageContent: "",
          viewport: { width: 0, height: 0 }
        };
      } finally {
        try {
          await chrome.tabs.sendMessage(tabId, { type: "SHOW_AFTER_TOOL_USE" });
        } catch (e) {}
      }
    }

    case "DIALOG_ACCEPT": {
      if (!tabId) throw new Error("No tabId provided");
      const result = await cdp.handleDialog(tabId, true, message.text);
      return result;
    }

    case "DIALOG_DISMISS": {
      if (!tabId) throw new Error("No tabId provided");
      const result = await cdp.handleDialog(tabId, false);
      return result;
    }

    case "DIALOG_INFO": {
      if (!tabId) throw new Error("No tabId provided");
      const dialog = cdp.getDialogInfo(tabId);
      if (!dialog) {
        return { hasDialog: false };
      }
      return {
        hasDialog: true,
        type: dialog.type,
        message: dialog.message,
        defaultPrompt: dialog.defaultPrompt,
      };
    }

    case "EMULATE_NETWORK": {
      if (!tabId) throw new Error("No tabId provided");
      if (!message.preset) throw new Error("No preset provided");
      const result = await cdp.emulateNetwork(tabId, message.preset);
      if (!result.success) throw new Error(result.error);
      return { success: true, preset: message.preset };
    }

    case "EMULATE_CPU": {
      if (!tabId) throw new Error("No tabId provided");
      if (message.rate === undefined) throw new Error("No rate provided");
      const result = await cdp.emulateCPU(tabId, message.rate);
      if (!result.success) throw new Error(result.error);
      return { success: true, rate: message.rate };
    }

    case "EMULATE_GEO": {
      if (!tabId) throw new Error("No tabId provided");
      if (message.clear) {
        const result = await cdp.clearGeolocation(tabId);
        if (!result.success) throw new Error(result.error);
        return { success: true, cleared: true };
      }
      if (message.latitude === undefined || message.longitude === undefined) {
        throw new Error("Latitude and longitude required");
      }
      const result = await cdp.emulateGeolocation(tabId, message.latitude, message.longitude, message.accuracy);
      if (!result.success) throw new Error(result.error);
      return { success: true, latitude: message.latitude, longitude: message.longitude };
    }

    case "FORM_FILL": {
      if (!tabId) throw new Error("No tabId provided");
      if (!message.data) throw new Error("No data provided");
      const response = await chrome.tabs.sendMessage(tabId, {
        type: "FORM_FILL",
        data: message.data,
      });
      return response;
    }

    case "EXECUTE_JAVASCRIPT": {
      if (!tabId) throw new Error("No tabId provided");
      if (!message.code) throw new Error("No code provided");

      try {
        const piHelpersCode = `if(!window.piHelpers){const piHelpers={wait(ms){return new Promise(r=>setTimeout(r,ms))},async waitForSelector(sel,opts={}){const{state='visible',timeout=20000}=opts;const isVis=el=>el&&getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).opacity!=='0'&&el.offsetWidth>0&&el.offsetHeight>0;const chk=()=>{const el=document.querySelector(sel);switch(state){case'attached':return el;case'detached':return el?null:document.body;case'hidden':return(!el||!isVis(el))?(el||document.body):null;default:return isVis(el)?el:null}};return new Promise((res,rej)=>{const r=chk();if(r){res(state==='detached'||state==='hidden'?null:r);return}const obs=new MutationObserver(()=>{const r=chk();if(r){obs.disconnect();clearTimeout(tid);res(state==='detached'||state==='hidden'?null:r)}});const tid=setTimeout(()=>{obs.disconnect();rej(new Error('Timeout'))},timeout);obs.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class','hidden']})})},async waitForText(text,opts={}){const{selector,timeout=20000}=opts;const chk=()=>{const root=selector?document.querySelector(selector):document.body;if(!root)return null;const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);while(w.nextNode())if(w.currentNode.textContent?.includes(text))return w.currentNode.parentElement;return null};return new Promise((res,rej)=>{const r=chk();if(r){res(r);return}const obs=new MutationObserver(()=>{const r=chk();if(r){obs.disconnect();clearTimeout(tid);res(r)}});const tid=setTimeout(()=>{obs.disconnect();rej(new Error('Timeout'))},timeout);obs.observe(document.documentElement,{childList:true,subtree:true,characterData:true})})},async waitForHidden(sel,t=20000){await piHelpers.waitForSelector(sel,{state:'hidden',timeout:t})},getByRole(role,opts={}){const{name}=opts;const roles={button:['button','input[type=button]','input[type=submit]','input[type=reset]'],link:['a[href]'],textbox:['input:not([type])','input[type=text]','input[type=email]','input[type=password]','textarea'],checkbox:['input[type=checkbox]'],radio:['input[type=radio]'],combobox:['select'],heading:['h1','h2','h3','h4','h5','h6']};const cands=[...document.querySelectorAll('[role='+role+']')];if(roles[role])roles[role].forEach(s=>cands.push(...document.querySelectorAll(s+':not([role])')));if(!name)return cands[0]||null;const n=name.toLowerCase().trim();for(const el of cands){const l=el.getAttribute('aria-label')?.toLowerCase().trim();const t=el.textContent?.toLowerCase().trim();if(l===n||t===n||l?.includes(n)||t?.includes(n))return el}return null}};window.__piHelpers=piHelpers;window.piHelpers=piHelpers}`;
        await cdp.evaluateScript(tabId, piHelpersCode);
        
        const escaped = message.code.replace(/`/g, "\\`").replace(/\$/g, "\\$");
        const expression = `(async () => { 'use strict'; ${escaped} })()`;
        
        const result = await cdp.evaluateScript(tabId, expression);
        
        if (result.exceptionDetails) {
          const err = result.exceptionDetails.exception?.description || 
                      result.exceptionDetails.text || 
                      "Script execution failed";
          return { error: err };
        }
        
        const value = result.result?.value;
        const output = value === undefined ? "undefined" : JSON.stringify(value, null, 2);
        return { output: output?.substring(0, 50000) || "undefined" };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Script execution failed";
        if (msg.includes("Cannot access") || msg.includes("Cannot attach")) {
          return { error: "Cannot execute JavaScript on this page (restricted URL)" };
        }
        return { error: msg };
      }
    }

    case "READ_CONSOLE_MESSAGES": {
      if (!tabId) throw new Error("No tabId provided");

      try {
        await cdp.enableConsoleTracking(tabId);
      } catch (e) {}

      const messages = cdp.getConsoleMessages(tabId, {
        onlyErrors: message.onlyErrors,
        pattern: message.pattern,
        limit: message.limit || 100,
      });

      if (message.clear) {
        cdp.clearConsoleMessages(tabId);
      }

      return { messages };
    }

    case "CLEAR_CONSOLE_MESSAGES": {
      if (!tabId) throw new Error("No tabId provided");
      cdp.clearConsoleMessages(tabId);
      return { success: true };
    }

    case "READ_NETWORK_REQUESTS": {
      if (!tabId) throw new Error("No tabId provided");

      try {
        await cdp.enableNetworkTracking(tabId);
      } catch (e) {}

      const requests = cdp.getNetworkRequests(tabId, {
        urlPattern: message.urlPattern,
        limit: message.limit || 100,
      });

      if (message.clear) {
        cdp.clearNetworkRequests(tabId);
      }

      return { requests };
    }

    case "CLEAR_NETWORK_REQUESTS": {
      if (!tabId) throw new Error("No tabId provided");
      cdp.clearNetworkRequests(tabId);
      return { success: true };
    }

    case "RESIZE_WINDOW": {
      if (!tabId) throw new Error("No tabId provided");
      if (!message.width || !message.height) throw new Error("width and height required");

      const tab = await chrome.tabs.get(tabId);
      if (!tab.windowId) throw new Error("Tab has no window");

      await chrome.windows.update(tab.windowId, {
        width: Math.floor(message.width),
        height: Math.floor(message.height),
      });

      return { success: true, width: message.width, height: message.height };
    }

    case "TABS_CREATE": {
      const activeTab = tabId ? await chrome.tabs.get(tabId) : null;

      const newTab = await chrome.tabs.create({
        url: message.url || "about:blank",
        active: false,
      });

      if (!newTab.id) throw new Error("Failed to create tab");

      if (activeTab?.groupId && activeTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        await chrome.tabs.group({ tabIds: newTab.id, groupId: activeTab.groupId });
      }

      return { 
        success: true, 
        tabId: newTab.id, 
        url: newTab.url || message.url || "about:blank" 
      };
    }

    case "UPLOAD_IMAGE": {
      if (!tabId) throw new Error("No tabId provided");
      if (!message.screenshotId) throw new Error("screenshotId required");
      if (!message.ref && !message.coordinate) throw new Error("ref or coordinate required");

      const screenshot = getScreenshot(message.screenshotId);
      if (!screenshot) throw new Error(`Screenshot not found: ${message.screenshotId}`);

      try {
        const result = await chrome.tabs.sendMessage(tabId, {
          type: "UPLOAD_IMAGE",
          base64: screenshot.base64,
          ref: message.ref,
          coordinate: message.coordinate,
          filename: message.filename || "screenshot.png",
        }, { frameId: 0 });

        return result;
      } catch (err) {
        return { error: "Content script not loaded. Try refreshing the page." };
      }
    }

    case "GET_TABS": {
      const tabs = await chrome.tabs.query({});
      return {
        tabs: tabs.map((t) => ({ id: t.id, title: t.title, url: t.url })),
      };
    }

    case "LIST_TABS": {
      const tabs = await chrome.tabs.query({});
      return {
        tabs: tabs.map((t) => ({
          id: t.id,
          title: t.title,
          url: t.url,
          active: t.active,
          windowId: t.windowId,
        })),
      };
    }

    case "NEW_TAB": {
      const urls = message.urls || (message.url ? [message.url] : ["about:blank"]);
      const createdTabs = [];
      for (let i = 0; i < urls.length; i++) {
        const newTab = await chrome.tabs.create({
          url: urls[i],
          active: i === 0,
        });
        if (newTab.id) createdTabs.push({ tabId: newTab.id, url: urls[i] });
      }
      if (createdTabs.length === 1) {
        return { success: true, tabId: createdTabs[0].tabId, url: createdTabs[0].url };
      }
      return { success: true, tabs: createdTabs };
    }

    case "SWITCH_TAB": {
      const targetTabId = message.tabId;
      if (!targetTabId) throw new Error("No tabId provided");
      const tab = await chrome.tabs.update(targetTabId, { active: true });
      if (tab.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      return { success: true, tabId: targetTabId, url: tab.url, title: tab.title };
    }

    case "CLOSE_TAB": {
      const tabIds = message.tabIds || (message.tabId ? [message.tabId] : []);
      if (tabIds.length === 0) throw new Error("No tabId(s) provided");
      await chrome.tabs.remove(tabIds);
      if (tabIds.length === 1) {
        return { success: true, tabId: tabIds[0] };
      }
      return { success: true, closed: tabIds };
    }

    case "TABS_REGISTER": {
      if (!tabId) throw new Error("No tabId provided");
      if (!message.name) throw new Error("No name provided");
      tabNameRegistry.set(message.name, tabId);
      return { success: true, name: message.name, tabId };
    }

    case "TABS_GET_BY_NAME": {
      if (!message.name) throw new Error("No name provided");
      const registeredTabId = tabNameRegistry.get(message.name);
      if (!registeredTabId) {
        return { error: `No tab registered with name "${message.name}"` };
      }
      try {
        const tab = await chrome.tabs.get(registeredTabId);
        return { tabId: registeredTabId, url: tab.url, title: tab.title };
      } catch (e) {
        tabNameRegistry.delete(message.name);
        return { error: `Tab "${message.name}" no longer exists` };
      }
    }

    case "TABS_LIST_NAMED": {
      const namedTabs: { name: string; tabId: number; url?: string; title?: string }[] = [];
      for (const [name, id] of tabNameRegistry) {
        try {
          const tab = await chrome.tabs.get(id);
          namedTabs.push({ name, tabId: id, url: tab.url, title: tab.title });
        } catch (e) {
          tabNameRegistry.delete(name);
        }
      }
      return { tabs: namedTabs };
    }

    case "TABS_UNREGISTER": {
      if (!message.name) throw new Error("No name provided");
      const deleted = tabNameRegistry.delete(message.name);
      if (!deleted) {
        return { success: false, error: `No tab registered with name "${message.name}"` };
      }
      return { success: true };
    }

    case "GET_AUTH": {
      const { sendToNativeHost } = await import("../native/port-manager");
      try {
        const result = await sendToNativeHost({ type: "GET_AUTH" });
        return result;
      } catch (err) {
        return { 
          auth: null, 
          hint: "Native host not connected. Make sure pi-chrome native host is installed." 
        };
      }
    }

    case "NATIVE_API_REQUEST": {
      const { sendToNativeHost } = await import("../native/port-manager");
      try {
        await sendToNativeHost({
          type: "API_REQUEST",
          streamId: message.streamId,
          url: message.url,
          method: message.method,
          headers: message.headers,
          body: message.body,
        });
        return { sent: true };
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Unknown error" };
      }
    }

    case "STREAM_CONSOLE": {
      if (!tabId) throw new Error("No tabId provided");
      const streamId = message.streamId;

      try {
        await cdp.enableConsoleTracking(tabId);
        activeStreamTabs.set(streamId, tabId);

        cdp.subscribeToConsole(tabId, streamId, (event) => {
          postToNativeHost({
            type: "STREAM_EVENT",
            streamId,
            event: {
              type: "console_event",
              level: event.type === "exception" ? "error" : event.type,
              text: event.text,
              timestamp: event.timestamp,
              url: event.url,
              line: event.line,
            },
          });
        });

        return { success: true, streaming: true };
      } catch (err) {
        postToNativeHost({
          type: "STREAM_ERROR",
          streamId,
          error: err instanceof Error ? err.message : "Failed to start console stream",
        });
        return { error: err instanceof Error ? err.message : "Failed to start console stream" };
      }
    }

    case "STREAM_NETWORK": {
      if (!tabId) throw new Error("No tabId provided");
      const streamId = message.streamId;

      try {
        await cdp.enableNetworkTracking(tabId);
        activeStreamTabs.set(streamId, tabId);

        cdp.subscribeToNetwork(tabId, streamId, (event) => {
          postToNativeHost({
            type: "STREAM_EVENT",
            streamId,
            event: {
              type: "network_event",
              method: event.method,
              url: event.url,
              status: event.status,
              duration: event.duration,
              timestamp: event.timestamp,
            },
          });
        });

        return { success: true, streaming: true };
      } catch (err) {
        postToNativeHost({
          type: "STREAM_ERROR",
          streamId,
          error: err instanceof Error ? err.message : "Failed to start network stream",
        });
        return { error: err instanceof Error ? err.message : "Failed to start network stream" };
      }
    }

    case "STREAM_STOP": {
      const streamId = message.streamId;
      const streamTabId = activeStreamTabs.get(streamId);
      
      if (streamTabId !== undefined) {
        cdp.unsubscribeFromConsole(streamTabId, streamId);
        cdp.unsubscribeFromNetwork(streamTabId, streamId);
        activeStreamTabs.delete(streamId);
      }

      return { success: true };
    }

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  debugLog("Extension installed/updated:", details.reason);
});

initNativeMessaging(async (msg) => {
  let tabId = msg.tabId;
  const isDialogCommand = msg.type?.startsWith("DIALOG_");
  if (tabId && !isDialogCommand) {
    try {
      await chrome.tabs.get(tabId);
    } catch {
      throw new Error(`Invalid tab ID: ${tabId}`);
    }
  } else if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
  }
  const result = await handleMessage({ ...msg, tabId }, {} as chrome.runtime.MessageSender);
  return { ...result, _resolvedTabId: tabId };
});
