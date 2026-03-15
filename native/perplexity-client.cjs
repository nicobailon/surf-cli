"use strict";
/**
 * Perplexity Web Client for surf-cli
 * 
 * CDP-based client for perplexity.ai using browser automation.
 * Similar approach to the ChatGPT client.
 */

const PERPLEXITY_URL = "https://www.perplexity.ai/";

// ============================================================================
// Helpers
// ============================================================================

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildClickDispatcher() {
  return `function dispatchClickSequence(target) {
    if (!target || !(target instanceof EventTarget)) return false;
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

// ============================================================================
// Page State Functions
// ============================================================================

async function waitForPageLoad(cdp, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await evaluate(cdp, "document.readyState");
    if (ready === "complete" || ready === "interactive") {
      // Extra wait for Perplexity's React app to hydrate
      await delay(1000);
      return;
    }
    await delay(100);
  }
  throw new Error("Page did not load in time");
}

async function checkLoginStatus(cdp) {
  const result = await evaluate(cdp, `(() => {
    const buttons = Array.from(document.querySelectorAll('button, a'));
    
    // Look for sign-in indicators (not logged in)
    const hasSignIn = buttons.some(b => {
      const text = (b.textContent || '').toLowerCase().trim();
      return text === 'sign in' || text === 'log in';
    });
    
    // Look for account menu (logged in)
    const hasAccount = buttons.some(b => {
      const text = (b.textContent || '').toLowerCase();
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      return text.includes('account') || label.includes('account') || label.includes('profile');
    });
    
    // Check for upgrade button (logged in but not Pro)
    const hasUpgrade = buttons.some(b => {
      const text = (b.textContent || '').toLowerCase().trim();
      return text === 'upgrade';
    });
    
    return { 
      loggedIn: hasAccount || hasUpgrade || !hasSignIn,
      isPro: hasAccount && !hasUpgrade,
    };
  })()`);
  
  return result || { loggedIn: false, isPro: false };
}

async function waitForPromptReady(cdp, timeoutMs = 20000) {
  // Wait for page to be interactive and Perplexity's React app to hydrate
  // Instead of complex element detection, just wait for the page to settle
  const deadline = Date.now() + timeoutMs;
  
  // First wait for basic page ready
  while (Date.now() < deadline) {
    const state = await evaluate(cdp, `document.readyState`);
    if (state === 'complete') break;
    await delay(200);
  }
  
  // Extra wait for React hydration
  await delay(2000);
  
  // Try to verify the page has the expected structure
  const verified = await evaluate(cdp, `(() => {
    // Check if we're on Perplexity and the page is loaded
    const isPerplexity = location.hostname.includes('perplexity');
    const hasInput = document.body.innerText.includes('Ask anything') ||
                     document.body.innerText.includes('Ask a follow-up');
    return { ready: isPerplexity || hasInput, url: location.href };
  })()`);
  
  if (verified && verified.ready) {
    return verified;
  }
  
  // Even if verification fails, proceed anyway after timeout
  // since the page might have different text
  return { ready: true, fallback: true };
}

// ============================================================================
// Mode and Model Selection
// ============================================================================

async function selectMode(cdp, mode) {
  const normalizedMode = mode.toLowerCase();
  
  const result = await evaluate(cdp, `(() => {
    ${buildClickDispatcher()}
    
    const targetMode = ${JSON.stringify(normalizedMode)};
    const radios = document.querySelectorAll('[role=radio]');
    
    for (const radio of radios) {
      const text = (radio.textContent || '').toLowerCase().trim();
      if (text.includes(targetMode)) {
        if (radio.getAttribute('aria-checked') === 'true') {
          return { success: true, alreadySelected: true, mode: text };
        }
        if (radio.hasAttribute('disabled')) {
          return { success: false, error: 'Mode is disabled (may require Pro)', mode: text };
        }
        dispatchClickSequence(radio);
        return { success: true, mode: text };
      }
    }
    
    return { success: false, error: 'Mode not found' };
  })()`);
  
  if (!result || !result.success) {
    throw new Error(`Failed to select mode: ${result?.error || 'unknown'}`);
  }
  
  await delay(300);
  return result.mode;
}

async function selectModel(cdp, model, timeoutMs = 8000) {
  // Click the model selector button
  const buttonClicked = await evaluate(cdp, `(() => {
    ${buildClickDispatcher()}
    
    const buttons = Array.from(document.querySelectorAll('button'));
    const modelBtn = buttons.find(b => {
      const text = (b.textContent || '').toLowerCase();
      return text.includes('choose a model') || 
             text.includes('model') ||
             (text.includes('sonar') || text.includes('gpt') || text.includes('claude'));
    });
    
    if (!modelBtn) return { success: false, error: 'Model button not found' };
    
    dispatchClickSequence(modelBtn);
    return { success: true };
  })()`);
  
  if (!buttonClicked || !buttonClicked.success) {
    throw new Error(`Model selector not found: ${buttonClicked?.error}`);
  }
  
  await delay(500);
  
  // Select from menu - loop in Node.js to avoid CDP timeout issues
  const normalizedModel = model.toLowerCase().replace(/[^a-z0-9]/g, '');
  const deadline = Date.now() + timeoutMs;
  
  while (Date.now() < deadline) {
    const result = await evaluate(cdp, `(() => {
      ${buildClickDispatcher()}
      
      const targetModel = ${JSON.stringify(normalizedModel)};
      const normalize = (text) => (text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      
      const menuItems = document.querySelectorAll('[role=menuitem], [role=menuitemradio], [role=option]');
      
      if (menuItems.length === 0) {
        return { found: false, waiting: true };
      }
      
      let bestMatch = null;
      let bestScore = 0;
      
      for (const item of menuItems) {
        const text = normalize(item.textContent || '');
        let score = 0;
        
        if (text.includes(targetModel)) score = 100;
        else if (targetModel.includes(text) && text.length > 3) score = 50;
        
        if (score > bestScore) {
          bestScore = score;
          bestMatch = item;
        }
      }
      
      if (bestMatch) {
        dispatchClickSequence(bestMatch);
        return { found: true, success: true, model: bestMatch.textContent?.trim() };
      }
      
      return { found: true, success: false, error: 'No matching model in menu' };
    })()`);
    
    if (result && result.found) {
      if (result.success) {
        await delay(200);
        return result.model;
      }
      // Items found but no match - close menu and throw
      await evaluate(cdp, `document.body.click()`);
      throw new Error(`Failed to select model: ${result?.error}`);
    }
    
    await delay(100);
  }
  
  // Timeout - close menu
  await evaluate(cdp, `document.body.click()`);
  throw new Error(`Failed to select model: timeout waiting for menu`);
}

// ============================================================================
// Input and Submission
// ============================================================================

async function typePrompt(cdp, inputCdp, prompt) {
  // Click on the input area to focus it
  // Perplexity uses a complex input - just click in the general area
  const clicked = await evaluate(cdp, `(() => {
    ${buildClickDispatcher()}
    
    // Strategy 1: Find element with "Ask anything" placeholder text
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      const text = el.textContent || '';
      const placeholder = el.getAttribute('placeholder') || el.getAttribute('aria-placeholder') || '';
      if ((placeholder.includes('Ask') || text === 'Ask anything') && el.offsetParent) {
        dispatchClickSequence(el);
        el.focus?.();
        return { success: true, method: 'placeholder' };
      }
    }
    
    // Strategy 2: Find textarea or contenteditable
    const inputs = document.querySelectorAll('textarea, [contenteditable=true], [role=textbox]');
    for (const el of inputs) {
      if (el.offsetParent) {
        dispatchClickSequence(el);
        el.focus?.();
        return { success: true, method: 'input' };
      }
    }
    
    // Strategy 3: Click in the center of the page (where input usually is)
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const centerEl = document.elementFromPoint(centerX, centerY);
    if (centerEl) {
      dispatchClickSequence(centerEl);
      return { success: true, method: 'center' };
    }
    
    return { success: false, error: 'Could not find input' };
  })()`);
  
  await delay(500);
  
  // Type using CDP Input API (this works regardless of element type)
  await inputCdp("Input.insertText", { text: prompt });
  await delay(300);
  
  // Backspace then re-add last char to reveal submit button
  await inputCdp("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Backspace",
    code: "Backspace",
    windowsVirtualKeyCode: 8,
    nativeVirtualKeyCode: 8,
  });
  await inputCdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Backspace",
    code: "Backspace",
    windowsVirtualKeyCode: 8,
    nativeVirtualKeyCode: 8,
  });
  await delay(100);
  
  // Re-add last character
  const lastChar = prompt.slice(-1);
  await inputCdp("Input.insertText", { text: lastChar });
  await delay(300);
}

async function submitPrompt(cdp, inputCdp) {
  // Get submit button coordinates
  const btnInfo = await evaluate(cdp, "(function() { const btn = document.querySelector('button[aria-label=Submit]'); if (!btn) return null; const r = btn.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()");
  
  if (btnInfo && btnInfo.x && btnInfo.y) {
    // Click using CDP
    await inputCdp("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: btnInfo.x,
      y: btnInfo.y,
      button: "left",
      clickCount: 1
    });
    await inputCdp("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: btnInfo.x,
      y: btnInfo.y,
      button: "left",
      clickCount: 1
    });
  } else {
    // Fallback: press Enter
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
  }
  
  await delay(500);
}

// ============================================================================
// Response Handling
// ============================================================================

async function waitForResponse(cdp, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let previousText = '';
  let stableCycles = 0;
  const requiredStableCycles = 10;
  let lastChangeAt = Date.now();
  const minStableMs = 2500;
  
  // First, wait for navigation to search results page
  const navDeadline = Date.now() + 15000;
  while (Date.now() < navDeadline) {
    const url = await evaluate(cdp, 'location.href');
    if (url && url.includes('/search/')) {
      break;
    }
    await delay(200);
  }
  
  // Wait a bit for the response area to render
  await delay(1000);
  
  // Now poll for response completion
  while (Date.now() < deadline) {
    const snapshot = await evaluate(cdp, `(function() {
      const prose = document.querySelector('.prose');
      const text = prose ? prose.innerText : '';
      const hasStop = !!document.querySelector('button[aria-label*=stop], button[aria-label*=Stop]');
      const hasCopy = !!document.querySelector('button[aria-label*=copy], button[aria-label*=Copy]');
      const hasRelated = document.body.innerText.indexOf('Related') > -1;
      return {
        text: text,
        generating: hasStop,
        hasActions: hasCopy,
        hasRelated: hasRelated,
        hasFollowUp: false,
        sourcesCount: 0,
        url: location.href
      };
    })()`);
    
    if (!snapshot) {
      await delay(300);
      continue;
    }
    
    const currentText = snapshot.text || '';
    
    // Track text changes
    if (currentText !== previousText && currentText.length > previousText.length) {
      previousText = currentText;
      stableCycles = 0;
      lastChangeAt = Date.now();
    } else {
      stableCycles++;
    }
    
    const stableMs = Date.now() - lastChangeAt;
    
    // Response is complete if:
    // 1. Not generating (no stop button)
    // 2. Has action buttons OR Related section OR follow-up input OR stable for long enough
    // 3. Has meaningful content
    const isStable = stableCycles >= requiredStableCycles && stableMs >= minStableMs;
    const hasCompletionIndicators = snapshot.hasActions || snapshot.hasRelated || snapshot.hasFollowUp;
    const isDone = !snapshot.generating && (hasCompletionIndicators || isStable);
    
    if (isDone && currentText.length > 20) {
      // Clean up the response text
      let cleanText = currentText;
      
      // Remove "Related" section if present at the end
      const relatedIdx = cleanText.lastIndexOf('\nRelated\n');
      if (relatedIdx > 0) {
        cleanText = cleanText.substring(0, relatedIdx).trim();
      }
      
      return {
        text: cleanText,
        sources: snapshot.sourcesCount,
        url: snapshot.url,
      };
    }
    
    await delay(300);
  }
  
  // Timeout - return whatever we have
  if (previousText.length > 20) {
    return {
      text: previousText,
      sources: 0,
      url: await evaluate(cdp, 'location.href'),
      partial: true,
    };
  }
  
  throw new Error("Response timeout - Perplexity did not complete in time");
}

// ============================================================================
// Main Query Function
// ============================================================================

async function query(options) {
  const {
    prompt,
    model,
    mode = 'search',
    timeout = 120000,
    createTab,
    closeTab,
    cdpEvaluate,
    cdpCommand,
    log = () => {},
  } = options;
  
  const startTime = Date.now();
  log("Starting Perplexity query");
  
  // Create tab
  const tabInfo = await createTab();
  log(`createTab returned: ${JSON.stringify(tabInfo)}`);
  const { tabId } = tabInfo || {};
  
  if (!tabId) {
    throw new Error(`Failed to create Perplexity tab: ${JSON.stringify(tabInfo)}`);
  }
  log(`Created tab ${tabId}`);
  
  const cdp = (expr) => cdpEvaluate(tabId, expr);
  const inputCdp = (method, params) => cdpCommand(tabId, method, params);
  
  try {
    // Wait for page load
    await waitForPageLoad(cdp);
    log("Page loaded");
    
    // Check login status (informational)
    const loginStatus = await checkLoginStatus(cdp);
    log(`Login: ${loginStatus.loggedIn ? 'yes' : 'anonymous'}${loginStatus.isPro ? ' (Pro)' : ''}`);
    
    // Wait for input
    await waitForPromptReady(cdp);
    log("Prompt ready");
    
    // Select mode if not default
    if (mode && mode.toLowerCase() !== 'search') {
      try {
        const selectedMode = await selectMode(cdp, mode);
        log(`Mode: ${selectedMode}`);
      } catch (e) {
        log(`Mode selection failed: ${e.message}`);
      }
    }
    
    // Select model if specified
    if (model) {
      try {
        const selectedModel = await selectModel(cdp, model);
        log(`Model: ${selectedModel}`);
      } catch (e) {
        log(`Model selection failed: ${e.message}`);
      }
    }
    
    // Type prompt
    await typePrompt(cdp, inputCdp, prompt);
    log("Prompt typed");
    
    // Submit
    await submitPrompt(cdp, inputCdp);
    log("Submitted, waiting for response...");
    
    // Wait for response
    const response = await waitForResponse(cdp, timeout);
    log(`Response: ${response.text.length} chars, ${response.sources} sources${response.partial ? ' (partial)' : ''}`);
    
    return {
      response: response.text,
      sources: response.sources,
      url: response.url,
      model: model || 'default',
      mode: mode || 'search',
      partial: response.partial || false,
      tookMs: Date.now() - startTime,
    };
  } finally {
    await closeTab(tabId).catch(() => {});
  }
}

module.exports = { query, PERPLEXITY_URL };
