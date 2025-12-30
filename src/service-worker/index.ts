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

const ELEMENT_COLORS: Record<string, string> = {
  button: '#FF6B6B',
  input: '#4ECDC4',
  select: '#45B7D1',
  a: '#96CEB4',
  textarea: '#FF8C42',
  default: '#DDA0DD',
};

async function annotateScreenshot(
  screenshot: { base64: string; width: number; height: number },
  elements: Array<{ ref: string; tag: string; bounds: { x: number; y: number; width: number; height: number } }>,
  scale: { scaleX: number; scaleY: number }
): Promise<{ base64: string; width: number; height: number }> {
  const blob = base64ToBlob(screenshot.base64);
  const bitmap = await createImageBitmap(blob);
  
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get canvas context");
  
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  
  const scaleFactor = Math.min(scale.scaleX, scale.scaleY);
  
  for (const element of elements) {
    const color = ELEMENT_COLORS[element.tag] || ELEMENT_COLORS.default;
    
    const x = Math.round(element.bounds.x * scaleFactor);
    const y = Math.round(element.bounds.y * scaleFactor);
    const w = Math.round(element.bounds.width * scaleFactor);
    const h = Math.round(element.bounds.height * scaleFactor);
    
    if (w < 1 || h < 1) continue;
    
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    
    const labelText = element.ref;
    const fontSize = Math.max(10, Math.min(16, Math.round(canvas.width * 0.01)));
    ctx.font = `bold ${fontSize}px sans-serif`;
    const textWidth = ctx.measureText(labelText).width;
    const padding = 4;
    const labelWidth = textWidth + padding * 2;
    const labelHeight = fontSize + padding * 2;
    
    let labelX = x + Math.floor((w - labelWidth) / 2);
    let labelY = y + 2;
    if (w < 60 || h < 30) {
      labelY = y - labelHeight - 2 < 0 ? y + h + 2 : y - labelHeight - 2;
    }
    
    labelX = Math.max(0, Math.min(canvas.width - labelWidth, labelX));
    labelY = Math.max(0, Math.min(canvas.height - labelHeight, labelY));
    
    ctx.fillStyle = color;
    ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
    ctx.strokeStyle = "white";
    ctx.lineWidth = 1;
    ctx.strokeRect(labelX, labelY, labelWidth, labelHeight);
    
    ctx.fillStyle = "white";
    ctx.textBaseline = "top";
    ctx.fillText(labelText, labelX + padding, labelY + padding);
  }
  
  const resultBlob = await canvas.convertToBlob({ type: "image/png" });
  const base64 = await blobToBase64(resultBlob);
  
  return { base64, width: canvas.width, height: canvas.height };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Failed to convert blob to base64"));
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64: string, mimeType = "image/png"): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

async function executeScriptWithFallback<T>(
  tabId: number,
  scriptFn: () => T
): Promise<T> {
  try {
    const result = await cdp.evaluateScript(tabId, `(${scriptFn.toString()})()`);
    return result.result?.value;
  } catch (cdpError) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: scriptFn,
    });
    return results[0]?.result as T;
  }
}

async function captureFullPage(tabId: number, maxHeight: number): Promise<{ base64: string; width: number; height: number }> {
  const dimensionsResult = await cdp.evaluateScript(tabId, `(() => ({
    viewportHeight: window.innerHeight,
    totalHeight: Math.min(document.documentElement.scrollHeight, ${maxHeight}),
    width: window.innerWidth,
    devicePixelRatio: window.devicePixelRatio || 1,
    originalScrollY: window.scrollY,
  }))()`);
  
  const dimensions = dimensionsResult.result?.value;
  if (!dimensions) throw new Error("Failed to get page dimensions");
  
  const { viewportHeight, totalHeight, width, devicePixelRatio, originalScrollY } = dimensions;
  const chunks: ImageBitmap[] = [];
  let currentY = 0;
  
  while (currentY < totalHeight) {
    await cdp.evaluateScript(tabId, `window.scrollTo(0, ${currentY})`);
    await new Promise(r => setTimeout(r, 300));
    
    const chunk = await cdp.captureScreenshot(tabId);
    const chunkBlob = base64ToBlob(chunk.base64);
    chunks.push(await createImageBitmap(chunkBlob));
    
    currentY += viewportHeight;
  }
  
  await cdp.evaluateScript(tabId, `window.scrollTo(0, ${originalScrollY})`);
  
  const canvasWidth = Math.round(width * devicePixelRatio);
  const canvasHeight = Math.round(totalHeight * devicePixelRatio);
  const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get canvas context");
  
  let y = 0;
  const chunkHeight = Math.round(viewportHeight * devicePixelRatio);
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const remainingHeight = canvasHeight - y;
    const drawHeight = Math.min(chunkHeight, remainingHeight);
    ctx.drawImage(chunk, 0, 0, chunk.width, drawHeight, 0, y, chunk.width, drawHeight);
    y += drawHeight;
    chunk.close();
  }
  
  const resultBlob = await canvas.convertToBlob({ type: "image/png" });
  const base64 = await blobToBase64(resultBlob);
  
  return { base64, width: canvasWidth, height: canvasHeight };
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
      title: "Surf",
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
        let result: { base64: string; width: number; height: number };
        let scaleInfo = { scaleX: 1, scaleY: 1 };
        let usedFallback = false;
        
        if (message.fullpage) {
          result = await captureFullPage(tabId, message.maxHeight || 4000);
          try {
            const viewport = await cdp.getViewportSize(tabId);
            const dpr = result.width / viewport.width;
            scaleInfo = { scaleX: dpr, scaleY: dpr };
          } catch {}
        } else {
          try {
            const rawResult = await cdp.captureScreenshot(tabId);
            result = rawResult;
            try {
              const viewport = await cdp.getViewportSize(tabId);
              scaleInfo = {
                scaleX: rawResult.width / viewport.width,
                scaleY: rawResult.height / viewport.height,
              };
            } catch {}
          } catch (cdpError) {
            const tab = await chrome.tabs.get(tabId);
            if (!tab.windowId) throw cdpError;
            const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
            const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
            const binaryString = atob(base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: "image/png" });
            const bitmap = await createImageBitmap(blob);
            result = { base64, width: bitmap.width, height: bitmap.height };
            bitmap.close();
            usedFallback = true;
          }
        }
        
        if (message.annotate && !usedFallback) {
          try {
            const treeResult = await chrome.tabs.sendMessage(tabId, {
              type: "GET_ELEMENT_BOUNDS_FOR_ANNOTATION",
            }, { frameId: 0 });
            
            if (treeResult?.elements && treeResult.elements.length > 0) {
              result = await annotateScreenshot(result, treeResult.elements, scaleInfo);
            }
          } catch {}
        }
        
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
      const deltaX = message.deltaX || 0;
      const deltaY = message.deltaY || 0;
      
      try {
        const viewport = await cdp.getViewportSize(tabId);
        const x = message.x ?? viewport.width / 2;
        const y = message.y ?? viewport.height / 2;
        await cdp.scroll(tabId, x, y, deltaX, deltaY);
      } catch {
        const scrollFallback = (dx: number, dy: number) => {
          window.scrollBy(dx, dy);
          return { scrollX: window.scrollX, scrollY: window.scrollY };
        };
        await chrome.scripting.executeScript({
          target: { tabId },
          func: scrollFallback,
          args: [deltaX, deltaY],
        });
      }
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

    case "EVAL_IN_PAGE": {
      if (!tabId) throw new Error("No tabId provided");
      if (!message.code) throw new Error("No code provided");
      try {
        return await chrome.tabs.sendMessage(tabId, {
          type: "EVAL_IN_PAGE",
          code: message.code,
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
      
      const scrollScript = (pos: string | number, sel: string | null) => {
        const findScrollable = () => {
          const candidates = [...document.querySelectorAll("*")].filter(el => 
            el.scrollHeight > el.clientHeight && el.clientHeight > 200
          ).sort((a,b) => b.scrollHeight - a.scrollHeight);
          return candidates[0] || document.documentElement;
        };
        
        const container = sel ? document.querySelector(sel) || findScrollable() : findScrollable();
        if (!container) return { error: "No scrollable container found" };
        
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
      };
      
      try {
        const script = `(${scrollScript.toString()})(${JSON.stringify(position)}, ${JSON.stringify(selector)})`;
        const result = await cdp.evaluateScript(tabId, script);
        return result.result?.value || { error: "Script failed" };
      } catch {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: scrollScript,
          args: [position, selector],
        });
        return results[0]?.result || { error: "Script failed" };
      }
    }

    case "GET_SCROLL_INFO": {
      if (!tabId) throw new Error("No tabId provided");
      const selector = message.selector;
      
      const scrollInfoScript = (sel: string | null) => {
        const findScrollable = () => {
          const candidates = [...document.querySelectorAll("*")].filter(el => 
            el.scrollHeight > el.clientHeight && el.clientHeight > 200
          ).sort((a,b) => b.scrollHeight - a.scrollHeight);
          return candidates[0] || document.documentElement;
        };
        
        const container = sel ? document.querySelector(sel) || findScrollable() : findScrollable();
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
      };
      
      try {
        const script = `(${scrollInfoScript.toString()})(${JSON.stringify(selector)})`;
        const result = await cdp.evaluateScript(tabId, script);
        return result.result?.value || { error: "Script failed" };
      } catch {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: scrollInfoScript,
          args: [selector],
        });
        return results[0]?.result || { error: "Script failed" };
      }
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
          await chrome.tabs.sendMessage(tabId, { type: "SHOW_AFTER_TOOL_USE" }, { frameId: 0 });
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
      }, { frameId: 0 });
      return response;
    }

    case "PERF_START": {
      if (!tabId) throw new Error("No tabId provided");
      const result = await cdp.startPerformanceTrace(tabId, message.categories);
      if (!result.success) throw new Error(result.error);
      return { success: true, message: "Performance tracing started" };
    }

    case "PERF_STOP": {
      if (!tabId) throw new Error("No tabId provided");
      const result = await cdp.stopPerformanceTrace(tabId);
      if (!result.success) throw new Error(result.error);
      return { success: true, metrics: result.metrics };
    }

    case "PERF_METRICS": {
      if (!tabId) throw new Error("No tabId provided");
      const result = await cdp.getPerformanceMetrics(tabId);
      if (!result.success) throw new Error(result.error);
      return { success: true, metrics: result.metrics };
    }

    case "UPLOAD_FILE": {
      if (!tabId) throw new Error("No tabId provided");
      if (!message.ref) throw new Error("No ref provided");
      if (!message.files || !message.files.length) throw new Error("No files provided");
      const selectorResult = await chrome.tabs.sendMessage(tabId, {
        type: "GET_FILE_INPUT_SELECTOR",
        ref: message.ref,
      }, { frameId: 0 });
      if (selectorResult.error) throw new Error(selectorResult.error);
      const setResult = await cdp.setFileInputBySelector(tabId, selectorResult.selector, message.files);
      if (!setResult.success) throw new Error(setResult.error);
      return { success: true, filesSet: message.files.length };
    }

    case "WAIT_FOR_LOAD": {
      if (!tabId) throw new Error("No tabId provided");
      const result = await cdp.waitForLoad(tabId, message.timeout || 30000);
      if (!result.success) throw new Error(result.error);
      return { success: true, readyState: result.readyState };
    }

    case "GET_FRAMES": {
      if (!tabId) throw new Error("No tabId provided");
      const result = await cdp.getFrames(tabId);
      if (!result.success) throw new Error(result.error);
      return { success: true, frames: result.frames };
    }

    case "EVALUATE_IN_FRAME": {
      if (!tabId) throw new Error("No tabId provided");
      if (!message.frameId) throw new Error("No frameId provided");
      if (!message.code) throw new Error("No code provided");
      const result = await cdp.evaluateInFrame(tabId, message.frameId, message.code);
      if (!result.success) throw new Error(result.error);
      return { value: result.result };
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
          hint: "Native host not connected. Make sure surf native host is installed." 
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

    case "SEARCH_PAGE": {
      if (!tabId) throw new Error("No tabId provided");
      if (!message.term) throw new Error("Search term required");
      try {
        const result = await chrome.tabs.sendMessage(tabId, {
          type: "SEARCH_PAGE",
          term: message.term,
          caseSensitive: message.caseSensitive || false,
          limit: message.limit || 10,
        }, { frameId: 0 });
        return result;
      } catch {
        return { error: "Content script not loaded. Try refreshing the page." };
      }
    }

    case "TAB_GROUP_CREATE": {
      const tabIds = [...(message.tabIds || [])];
      const name = message.name || "Surf";
      const validColors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
      const color = validColors.includes(message.color) ? message.color : 'blue';
      
      if (tabIds.length === 0 && tabId) {
        tabIds.push(tabId);
      }
      
      if (tabIds.length === 0) throw new Error("No tabs specified");
      
      const existingGroups = await chrome.tabGroups.query({ title: name });
      let groupId: number;
      
      if (existingGroups.length > 0) {
        groupId = existingGroups[0].id;
        await chrome.tabs.group({ tabIds, groupId });
      } else {
        groupId = await chrome.tabs.group({ tabIds });
        await chrome.tabGroups.update(groupId, {
          title: name,
          color: color as chrome.tabGroups.ColorEnum,
          collapsed: false,
        });
      }
      
      return { success: true, groupId, name, tabIds };
    }

    case "TAB_GROUP_REMOVE": {
      const tabIds = [...(message.tabIds || [])];
      if (tabIds.length === 0 && tabId) {
        tabIds.push(tabId);
      }
      
      if (tabIds.length === 0) throw new Error("No tabs specified");
      
      await chrome.tabs.ungroup(tabIds);
      return { success: true, ungrouped: tabIds };
    }

    case "TAB_GROUPS_LIST": {
      const groups = await chrome.tabGroups.query({});
      const result = [];
      
      for (const group of groups) {
        const tabs = await chrome.tabs.query({ groupId: group.id });
        result.push({
          id: group.id,
          name: group.title || "(unnamed)",
          color: group.color,
          collapsed: group.collapsed,
          tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url })),
        });
      }
      
      return { groups: result };
    }

    case "CLICK_SELECTOR": {
      if (!tabId) throw new Error("No tabId provided");
      const selector = message.selector;
      const index = message.index || 0;
      
      const script = `(() => {
        const elements = document.querySelectorAll(${JSON.stringify(selector)});
        if (elements.length === 0) return { error: "No elements match selector" };
        if (${index} >= elements.length) return { error: "Index " + ${index} + " out of range (found " + elements.length + " elements)" };
        
        const el = elements[${index}];
        const rect = el.getBoundingClientRect();
        return { 
          x: rect.left + rect.width / 2, 
          y: rect.top + rect.height / 2,
          count: elements.length
        };
      })()`;
      
      const result = await cdp.evaluateScript(tabId, script);
      const coords = result.result?.value;
      
      if (coords?.error) return { error: coords.error };
      if (!coords) return { error: "Failed to get element coordinates" };
      
      await cdp.click(tabId, coords.x, coords.y, "left", 1, 0);
      return { success: true, selector, index, matchCount: coords.count };
    }

    case "COOKIE_LIST": {
      if (!tabId) throw new Error("No tabId provided");
      const tab = await chrome.tabs.get(tabId);
      const url = tab.url;
      if (!url) throw new Error("Tab has no URL");
      const cookies = await chrome.cookies.getAll({ url });
      return { cookies };
    }

    case "COOKIE_GET": {
      if (!tabId) throw new Error("No tabId provided");
      const tab = await chrome.tabs.get(tabId);
      const url = tab.url;
      if (!url) throw new Error("Tab has no URL");
      if (!message.name) throw new Error("Cookie name required");
      const cookie = await chrome.cookies.get({ url, name: message.name });
      if (!cookie) return { error: `Cookie "${message.name}" not found` };
      return { cookie };
    }

    case "COOKIE_SET": {
      if (!tabId) throw new Error("No tabId provided");
      const tab = await chrome.tabs.get(tabId);
      const url = tab.url;
      if (!url) throw new Error("Tab has no URL");
      if (!message.name) throw new Error("Cookie name required");
      if (message.value === undefined) throw new Error("Cookie value required");
      
      const cookieDetails: chrome.cookies.SetDetails = {
        url,
        name: message.name,
        value: message.value,
      };
      
      if (message.expires) {
        const expirationDate = new Date(message.expires).getTime() / 1000;
        if (isNaN(expirationDate)) {
          throw new Error(`Invalid expiration date: ${message.expires}`);
        }
        cookieDetails.expirationDate = expirationDate;
      }
      
      const result = await chrome.cookies.set(cookieDetails);
      return { success: true, cookie: result };
    }

    case "COOKIE_CLEAR": {
      if (!tabId) throw new Error("No tabId provided");
      const tab = await chrome.tabs.get(tabId);
      const url = tab.url;
      if (!url) throw new Error("Tab has no URL");
      if (!message.name) throw new Error("Cookie name required");
      
      await chrome.cookies.remove({ url, name: message.name });
      return { success: true, cleared: message.name };
    }

    case "COOKIE_CLEAR_ALL": {
      if (!tabId) throw new Error("No tabId provided");
      const tab = await chrome.tabs.get(tabId);
      const url = tab.url;
      if (!url) throw new Error("Tab has no URL");
      
      const cookies = await chrome.cookies.getAll({ url });
      for (const cookie of cookies) {
        await chrome.cookies.remove({ url, name: cookie.name });
      }
      return { success: true, cleared: cookies.length };
    }

    case "TAB_RELOAD": {
      if (!tabId) throw new Error("No tabId provided");
      await chrome.tabs.reload(tabId, { bypassCache: message.hard || false });
      return { success: true };
    }

    case "ZOOM_GET": {
      if (!tabId) throw new Error("No tabId provided");
      const zoom = await chrome.tabs.getZoom(tabId);
      return { zoom };
    }

    case "ZOOM_SET": {
      if (!tabId) throw new Error("No tabId provided");
      const level = message.level;
      if (level < 0.25 || level > 5) throw new Error("Zoom level must be between 0.25 and 5");
      await chrome.tabs.setZoom(tabId, level);
      return { success: true, zoom: level };
    }

    case "ZOOM_RESET": {
      if (!tabId) throw new Error("No tabId provided");
      await chrome.tabs.setZoom(tabId, 0);
      return { success: true, zoom: 1.0 };
    }

    case "BOOKMARK_ADD": {
      if (!tabId) throw new Error("No tabId provided");
      const tab = await chrome.tabs.get(tabId);
      const createProps: { title: string; url?: string; parentId?: string } = {
        title: tab.title || "Untitled",
        url: tab.url,
      };
      if (message.folder) {
        const search = await chrome.bookmarks.search({ title: message.folder });
        const folder = search.find(b => !b.url);
        if (folder) {
          createProps.parentId = folder.id;
        }
      }
      const bookmark = await chrome.bookmarks.create(createProps);
      return { success: true, bookmark: { id: bookmark.id, title: bookmark.title, url: bookmark.url } };
    }

    case "BOOKMARK_REMOVE": {
      if (!tabId) throw new Error("No tabId provided");
      const tab = await chrome.tabs.get(tabId);
      if (!tab.url) throw new Error("Tab has no URL");
      const bookmarks = await chrome.bookmarks.search({ url: tab.url });
      if (bookmarks.length === 0) throw new Error("No bookmark found for this URL");
      await chrome.bookmarks.remove(bookmarks[0].id);
      return { success: true };
    }

    case "BOOKMARK_LIST": {
      const limit = typeof message.limit === 'number' ? message.limit : 50;
      let bookmarks: chrome.bookmarks.BookmarkTreeNode[] = [];
      
      if (message.folder) {
        const search = await chrome.bookmarks.search({ title: message.folder });
        const folder = search.find(b => !b.url);
        if (folder) {
          const children = await chrome.bookmarks.getChildren(folder.id);
          bookmarks = children.filter(b => b.url).slice(0, limit);
        }
      } else {
        const recent = await chrome.bookmarks.getRecent(limit);
        bookmarks = recent;
      }
      
      return { 
        bookmarks: bookmarks.map(b => ({ 
          id: b.id, 
          title: b.title, 
          url: b.url,
          dateAdded: b.dateAdded
        }))
      };
    }

    case "HISTORY_LIST": {
      const limit = typeof message.limit === 'number' ? message.limit : 20;
      const items = await chrome.history.search({ 
        text: "", 
        maxResults: limit,
        startTime: 0 
      });
      return { 
        history: items.map(h => ({ 
          url: h.url, 
          title: h.title, 
          lastVisitTime: h.lastVisitTime,
          visitCount: h.visitCount
        }))
      };
    }

    case "HISTORY_SEARCH": {
      const query = message.query;
      const limit = typeof message.limit === 'number' ? message.limit : 20;
      const items = await chrome.history.search({ 
        text: query, 
        maxResults: limit,
        startTime: 0 
      });
      return { 
        history: items.map(h => ({ 
          url: h.url, 
          title: h.title, 
          lastVisitTime: h.lastVisitTime,
          visitCount: h.visitCount
        }))
      };
    }

    case "GET_CHATGPT_COOKIES": {
      const cookies = await chrome.cookies.getAll({ domain: ".chatgpt.com" });
      const openaiCookies = await chrome.cookies.getAll({ domain: ".openai.com" });
      return { cookies: [...cookies, ...openaiCookies] };
    }

    case "CHATGPT_NEW_TAB": {
      const tab = await chrome.tabs.create({
        url: "https://chatgpt.com/",
        active: true,
      });
      if (!tab.id) throw new Error("Failed to create tab");
      const currentTab = await chrome.tabs.get(tab.id);
      if (currentTab.status !== "complete") {
        await new Promise<void>((resolve) => {
          const listener = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
            if (tabId === tab.id && info.status === "complete") {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
          setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }, 30000);
        });
      }
      await cdp.attach(tab.id);
      return { tabId: tab.id };
    }

    case "CHATGPT_CLOSE_TAB": {
      const chatTabId = message.tabId;
      if (chatTabId) {
        try {
          await cdp.detach(chatTabId);
        } catch {}
        try {
          await chrome.tabs.remove(chatTabId);
        } catch {}
      }
      return { success: true };
    }

    case "CHATGPT_CDP_COMMAND": {
      const { method, params } = message;
      const result = await cdp.sendCommand(message.tabId, method, params || {});
      return result;
    }

    case "CHATGPT_EVALUATE": {
      const result = await cdp.evaluateScript(message.tabId, message.expression);
      return result;
    }

    case "GET_GOOGLE_COOKIES": {
      const googleCookies = await chrome.cookies.getAll({ domain: ".google.com" });
      const geminiCookies = await chrome.cookies.getAll({ domain: ".gemini.google.com" });
      return { cookies: [...googleCookies, ...geminiCookies] };
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
    let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || tab.url?.startsWith('chrome-extension://')) {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    }
    if (!tab || tab.url?.startsWith('chrome-extension://') || tab.url?.startsWith('chrome://')) {
      const tabs = await chrome.tabs.query({ active: true });
      tab = tabs.find(t => !t.url?.startsWith('chrome-extension://') && !t.url?.startsWith('chrome://'));
    }
    tabId = tab?.id;
  }
  const result = await handleMessage({ ...msg, tabId }, {} as chrome.runtime.MessageSender);
  return { ...result, _resolvedTabId: tabId };
});
