"use strict";
/**
 * Grok Web Client for surf-cli
 * 
 * CDP-based client for X.com's Grok AI using browser automation.
 * Provides access to Grok's unique real-time X/Twitter data capabilities.
 */

const { loadConfig, getConfigPath, clearCache } = require("./config.cjs");

const GROK_URL = "https://x.com/i/grok";
const DEFAULT_MODEL = "thinking";

// Default models (as of Jan 2026)
const DEFAULT_GROK_MODELS = {
  "auto": { id: "auto", name: "Auto", desc: "Chooses Fast or Expert" },
  "fast": { id: "fast", name: "Fast", desc: "Quick responses" },
  "expert": { id: "expert", name: "Expert", desc: "Thinks hard" },
  "thinking": { id: "thinking", name: "Grok 4.1 Thinking", desc: "Thinks fast" },
};

// Load models from surf.json config or use defaults
function getGrokModels() {
  try {
    const config = loadConfig();
    if (config.grok?.models && typeof config.grok.models === "object" && Object.keys(config.grok.models).length > 0) {
      return config.grok.models;
    }
  } catch (e) {
    // Ignore errors, use defaults
  }
  return DEFAULT_GROK_MODELS;
}

// For backwards compatibility
const GROK_MODELS = DEFAULT_GROK_MODELS;

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

function hasRequiredCookies(cookies) {
  if (!cookies || !Array.isArray(cookies)) return false;
  // auth_token is the primary session cookie for X.com
  // ct0 is a CSRF token that's set dynamically, not strictly required for page load
  const authToken = cookies.find(c => c.name === "auth_token" && c.value);
  return Boolean(authToken);
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
      // Extra wait for X.com's React app to hydrate
      await delay(1500);
      return;
    }
    await delay(100);
  }
  throw new Error("Page did not load in time");
}

async function checkLoginStatus(cdp) {
  const result = await evaluate(cdp, `(() => {
    const body = document.body.innerText.toLowerCase();
    const hasLoginButton = !!document.querySelector('a[href*="/login"], [data-testid="loginButton"]');
    const hasGrokUI = body.includes('ask anything') || body.includes('grok');
    const hasPremiumPrompt = body.includes('subscribe') || body.includes('premium required');
    
    return {
      loggedIn: !hasLoginButton && hasGrokUI,
      hasPremium: hasGrokUI && !hasPremiumPrompt,
      url: location.href
    };
  })()`);
  
  return result || { loggedIn: false, hasPremium: false };
}

async function waitForGrokReady(cdp, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  
  while (Date.now() < deadline) {
    const state = await evaluate(cdp, `(() => {
      // Check for Grok-specific elements
      const hasInput = !!document.querySelector('textarea, [contenteditable="true"][role="textbox"], [data-testid="grokComposerInput"]');
      const hasGrokBranding = document.body.innerText.includes('Grok') || 
                               !!document.querySelector('[data-testid*="grok"]');
      const isGrokPage = location.pathname.includes('/grok');
      const isLoginPage = location.pathname.includes('/login') || location.pathname.includes('/i/flow');
      
      return {
        ready: isGrokPage && (hasInput || hasGrokBranding),
        hasInput,
        isGrokPage,
        isLoginPage,
        url: location.href
      };
    })()`);
    
    lastState = state;
    
    if (state && state.ready) {
      return state;
    }
    
    // If redirected to login, fail fast
    if (state && state.isLoginPage) {
      throw new Error("Redirected to login page - X.com login required");
    }
    
    await delay(200);
  }
  
  // Timeout - provide helpful error based on last state
  if (lastState && !lastState.isGrokPage) {
    throw new Error(`Not on Grok page (current: ${lastState.url}) - may need to log in`);
  }
  
  // Return fallback for edge cases where we're on Grok page but UI isn't detected
  return { ready: true, fallback: true };
}

// ============================================================================
// Model Selection
// ============================================================================

async function selectModel(cdp, desiredModel, timeoutMs = 8000) {
  const normalizedModel = desiredModel.toLowerCase().replace(/[^a-z0-9.-]/g, "");
  
  // First, find and click the model selector button
  const buttonClicked = await evaluate(cdp, `(() => {
    ${buildClickDispatcher()}
    
    // Look for model selector button (shows current model: Auto, Fast, Expert, or Grok 4.1 Thinking)
    const buttons = Array.from(document.querySelectorAll('button'));
    const modelBtn = buttons.find(b => {
      const text = (b.textContent || '').toLowerCase();
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      const testId = (b.getAttribute('data-testid') || '').toLowerCase();
      // Match model names or model-related attributes
      const hasModelName = /^(auto|fast|expert|grok\\s*4)/i.test(text.trim());
      const hasModelLabel = label.includes('model') || testId.includes('model');
      return hasModelName || hasModelLabel;
    });
    
    if (!modelBtn) return { success: false, error: 'Model selector not found' };
    
    dispatchClickSequence(modelBtn);
    return { success: true };
  })()`);
  
  if (!buttonClicked || !buttonClicked.success) {
    // Model selector might not exist (single model), continue anyway
    return desiredModel;
  }
  
  await delay(400);
  
  // Select from menu - loop in Node.js to avoid CDP timeout issues
  const deadline = Date.now() + timeoutMs;
  
  while (Date.now() < deadline) {
    const result = await evaluate(cdp, `(() => {
      ${buildClickDispatcher()}
      
      const targetModel = ${JSON.stringify(normalizedModel)};
      const normalize = (text) => (text || '').toLowerCase().replace(/[^a-z0-9.-]/g, '');
      
      // Look for menu items
      const items = document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"]');
      
      if (items.length === 0) {
        return { found: false, waiting: true };
      }
      
      let bestMatch = null;
      let bestScore = 0;
      
      for (const item of items) {
        const text = normalize(item.textContent || '');
        let score = 0;
        
        if (text.includes(targetModel)) score = 100;
        else if (targetModel.includes(text) && text.length > 3) score = 50;
        else if (text.includes('thinking') && targetModel.includes('thinking')) score = 75;
        
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
      // Items found but no match - close menu and return default
      await evaluate(cdp, `document.body.click()`);
      return desiredModel;
    }
    
    await delay(100);
  }
  
  // Timeout - close menu
  await evaluate(cdp, `document.body.click()`);
  return desiredModel;
}

// ============================================================================
// DeepSearch Toggle
// ============================================================================

async function enableDeepSearch(cdp) {
  const result = await evaluate(cdp, `(() => {
    ${buildClickDispatcher()}
    
    // Look for DeepSearch toggle or button
    const buttons = Array.from(document.querySelectorAll('button, [role="switch"]'));
    const deepSearchBtn = buttons.find(b => {
      const text = (b.textContent || '').toLowerCase();
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      // Be specific to avoid clicking unrelated search buttons
      return text.includes('deepsearch') || text.includes('deep search') ||
             label.includes('deepsearch') || label.includes('deep search');
    });
    
    if (!deepSearchBtn) {
      return { success: false, error: 'DeepSearch toggle not found' };
    }
    
    // Check if already enabled
    const isEnabled = deepSearchBtn.getAttribute('aria-checked') === 'true' ||
                      deepSearchBtn.classList.contains('active');
    
    if (isEnabled) {
      return { success: true, alreadyEnabled: true };
    }
    
    dispatchClickSequence(deepSearchBtn);
    return { success: true };
  })()`);
  
  if (result && result.success) {
    await delay(300);
  }
  
  return result || { success: false };
}

// ============================================================================
// Input and Submission
// ============================================================================

async function typePrompt(cdp, inputCdp, prompt) {
  // Focus the input area
  const focused = await evaluate(cdp, `(() => {
    ${buildClickDispatcher()}
    
    // Strategy 1: Find textarea or contenteditable
    const inputs = document.querySelectorAll('textarea, [contenteditable="true"][role="textbox"], [data-testid="grokComposerInput"]');
    for (const el of inputs) {
      if (el.offsetParent !== null) {
        dispatchClickSequence(el);
        el.focus?.();
        return { success: true, method: 'input' };
      }
    }
    
    // Strategy 2: Look for elements with "Ask" placeholder (more targeted selector)
    const placeholderEls = document.querySelectorAll('[placeholder*="Ask"], [placeholder*="ask"], [aria-placeholder*="Ask"]');
    for (const el of placeholderEls) {
      if (el.offsetParent !== null) {
        dispatchClickSequence(el);
        el.focus?.();
        return { success: true, method: 'placeholder' };
      }
    }
    
    return { success: false, error: 'Input not found' };
  })()`);
  
  if (!focused || !focused.success) {
    throw new Error(`Could not focus input: ${focused?.error || 'unknown'}`);
  }
  
  await delay(300);
  
  // Type using CDP Input API
  await inputCdp("Input.insertText", { text: prompt });
  await delay(200);
}

async function submitPrompt(cdp, inputCdp) {
  // Try to click send button
  const clicked = await evaluate(cdp, `(() => {
    ${buildClickDispatcher()}
    
    // Look for send button
    const buttons = Array.from(document.querySelectorAll('button'));
    const sendBtn = buttons.find(b => {
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      const testId = b.getAttribute('data-testid') || '';
      return label.includes('send') || testId.includes('send') || 
             testId.includes('submit') || testId.includes('grokSend');
    });
    
    if (sendBtn && !sendBtn.disabled) {
      dispatchClickSequence(sendBtn);
      return { success: true, method: 'button' };
    }
    
    return { success: false };
  })()`);
  
  if (!clicked || !clicked.success) {
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

// Extract Grok's response from the full page body text
function extractGrokResponse(bodyText, userPrompt = '') {
  if (!bodyText) return null;
  
  // Split into lines and filter out navigation/UI elements
  const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l);
  
  // Known UI elements to skip
  const uiPatterns = [
    /^(Home|Explore|Notifications|Messages|Chat|Grok|Premium|Bookmarks|Communities|Profile|More|Post)$/i,
    /^(Creator Studio|Lists|Verified Orgs)$/i,
    /^(History|Private|Create Images|Edit Image|Latest News)$/i,
    /^(Create recurring tasks|Get access to|Explore)$/i,
    /^(Think Harder)$/i,
    /^(Auto|Fast|Expert)$/i, // Model names
    /^Grok\s*\d/i, // "Grok 4.1 Thinking" etc
    /^@\w+$/, // Username mentions alone
    /^[A-Z][a-z]+ \d+$/, // Dates like "Jan 20"
    /^(See new posts|Talk to Grok|Get access to)/, // Sidebar promos
  ];
  
  // Normalize prompt for comparison (first 30 chars to handle truncation)
  const promptNorm = userPrompt.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 30);
  
  // Find the LAST occurrence of the user's question to get the most recent conversation
  let lastQuestionIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const lineNorm = lines[i].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (promptNorm && lineNorm.includes(promptNorm)) {
      lastQuestionIndex = i;
      break;
    }
  }
  
  // Extract content after the last question
  const contentLines = [];
  const startIndex = lastQuestionIndex >= 0 ? lastQuestionIndex + 1 : 0;
  
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    
    // Skip empty and UI lines
    if (!line || uiPatterns.some(p => p.test(line))) continue;
    
    // Skip very short lines that are likely icons/buttons (but keep numbers)
    if (line.length <= 2 && !/^\d+$/.test(line)) continue;
    
    // Stop at follow-up suggestions (they mark the end of the response)
    if (/^(Explain|Tell me|Learn more|Show me|Multiplication)/i.test(line)) break;
    
    contentLines.push(line);
  }
  
  // If we found content after the question, return the response
  if (contentLines.length > 0) {
    return contentLines.join('\n').trim();
  }
  
  // Fallback: look for the LAST standalone numeric answer
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (/^\d+\.?\d*$/.test(line)) {
      return line;
    }
  }
  
  return null;
}

async function waitForResponse(cdp, timeoutMs = 300000, userPrompt = '') {
  // Grok can take a long time:
  // - Thinking models (Grok 4.1 Thinking): 40-60+ seconds to think, then streams
  // - Fast/Auto models: No thinking phase, just streams directly
  
  const deadline = Date.now() + timeoutMs;
  let previousText = '';
  let previousLength = 0;
  let lastChangeAt = Date.now();
  let thinkingTime = null;
  let thinkingComplete = false;
  let lastResponseText = '';
  let responseStableCycles = 0;
  
  while (Date.now() < deadline) {
    // Get page state with multiple completion indicators
    const snapshot = await evaluate(cdp, `(function() {
      const bodyText = document.body.innerText || '';
      
      // Check for stop/cancel button (indicates still generating)
      const hasStopBtn = !!document.querySelector('button[aria-label*="Stop"], button[aria-label*="stop"], button[aria-label*="Cancel"]');
      
      // Check for "Thought for Xs" which indicates thinking model completed thinking
      const thinkMatch = bodyText.match(/Thought for (\\d+)s/i);
      const thinkingDone = !!thinkMatch;
      const thinkingSecs = thinkMatch ? parseInt(thinkMatch[1], 10) : null;
      
      // Check if actively showing "thinking..." or similar loading state
      const isThinking = /\\bthinking\\.\\.\\./i.test(bodyText) || 
                         /\\bSearching\\.\\.\\./i.test(bodyText) ||
                         bodyText.includes('Grok is thinking') ||
                         bodyText.includes('is thinking...');
      
      // Try to find the actual Grok response in the DOM
      // Look for the main content area - Grok responses appear in the conversation area
      let responseText = '';
      
      // Strategy 1: Look for article elements or main content containers
      const articles = document.querySelectorAll('article');
      if (articles.length > 0) {
        // Get the last article which should be the response
        const lastArticle = articles[articles.length - 1];
        responseText = lastArticle.innerText || '';
      }
      
      // Strategy 2: If no articles, look for the conversation container
      if (!responseText) {
        const convArea = document.querySelector('[data-testid="conversation"], [role="main"] > div > div');
        if (convArea) {
          responseText = convArea.innerText || '';
        }
      }
      
      // Strategy 3: Fallback to looking for text after common Grok UI patterns
      if (!responseText || responseText.length < 10) {
        // Find content between user question and follow-up suggestions
        const mainArea = document.querySelector('main') || document.body;
        responseText = mainArea.innerText || bodyText;
      }
      
      return {
        bodyText: bodyText,
        responseText: responseText,
        bodyLength: bodyText.length,
        hasStopBtn: hasStopBtn,
        thinkingDone: thinkingDone,
        thinkingSecs: thinkingSecs,
        isThinking: isThinking,
        url: location.href
      };
    })()`);
    
    if (!snapshot || !snapshot.bodyText) {
      await delay(300);
      continue;
    }
    
    const bodyText = snapshot.bodyText;
    const bodyLength = snapshot.bodyLength;
    
    // Track thinking time (for thinking models)
    if (snapshot.thinkingSecs) {
      if (!thinkingTime || snapshot.thinkingSecs > thinkingTime) {
        thinkingTime = snapshot.thinkingSecs;
      }
    }
    
    // Detect when thinking completes (thinking models only)
    // "Thought for Xs" is a DEFINITIVE signal that thinking AND response generation is done
    if (snapshot.thinkingDone && !thinkingComplete) {
      thinkingComplete = true;
      // Give a brief moment for final render, then we're done
      await delay(500);
    }
    
    // Extract the actual response text - try DOM-extracted first, fall back to body parsing
    let currentResponseText = '';
    if (snapshot.responseText && snapshot.responseText.length > 10) {
      currentResponseText = extractGrokResponse(snapshot.responseText, userPrompt) || '';
    }
    if (!currentResponseText || currentResponseText.length < 5) {
      currentResponseText = extractGrokResponse(bodyText, userPrompt) || '';
    }
    
    // Track RESPONSE text stability (more reliable than body text)
    if (currentResponseText !== lastResponseText) {
      lastResponseText = currentResponseText;
      responseStableCycles = 0;
      lastChangeAt = Date.now();
    } else if (currentResponseText.length > 0) {
      responseStableCycles++;
    }
    
    // Track body text for timeout fallback
    if (bodyLength !== previousLength) {
      previousText = bodyText;
      previousLength = bodyLength;
    }
    
    const stableMs = Date.now() - lastChangeAt;
    const noStopButton = !snapshot.hasStopBtn;
    
    // Response is stable if the extracted response text hasn't changed
    // Use shorter thresholds since we're checking actual content, not noisy body text
    // 4 cycles (1.2s) + 1.5s minimum is enough for response stability
    const responseIsStable = responseStableCycles >= 4 && stableMs >= 1500 && currentResponseText.length > 10;
    
    // "Thought for Xs" is the strongest completion signal - response is definitely done
    const thinkingModelDone = snapshot.thinkingDone && noStopButton;
    
    // SIMPLE CHECK: If we have response content, no stop button, and stable for 3+ cycles
    const hasResponseNoStop = currentResponseText.length > 5 && noStopButton && responseStableCycles >= 3;
    
    // Response is complete when:
    // 1. Has meaningful response content (> 5 chars)
    // 2. No stop button
    // 3. Either: thinking done, response stable for 3+ cycles, OR stable for 4+ cycles with 1.5s
    const isDone = currentResponseText.length > 5 && noStopButton &&
                   (thinkingModelDone || hasResponseNoStop || responseIsStable);
    
    if (isDone) {
      return {
        text: currentResponseText,
        thinkingTime: thinkingTime,
        url: snapshot.url,
      };
    }
    
    await delay(300);
  }
  
  // Timeout - return whatever we have (partial response is better than nothing)
  const finalText = extractGrokResponse(previousText, userPrompt);
  if (finalText && finalText.length > 10) {
    return {
      text: finalText,
      thinkingTime: thinkingTime,
      partial: true,
    };
  }
  
  throw new Error("Response timeout - Grok did not complete in time");
}

// ============================================================================
// Main Query Function
// ============================================================================

async function query(options) {
  const {
    prompt,
    model,
    deepSearch = false,
    timeout = 300000, // 5 minutes default (Grok Thinking is slow)
    getCookies,
    createTab,
    closeTab,
    cdpEvaluate,
    cdpCommand,
    log = () => {},
  } = options;
  
  const startTime = Date.now();
  log("Starting Grok query");
  
  // Check cookies for X.com authentication
  const { cookies } = await getCookies();
  if (!hasRequiredCookies(cookies)) {
    throw new Error("X.com login required - log in to x.com in Chrome first");
  }
  log(`Got ${cookies.length} cookies`);
  
  // Create tab
  const tabInfo = await createTab();
  const { tabId } = tabInfo || {};
  
  if (!tabId) {
    throw new Error(`Failed to create Grok tab: ${JSON.stringify(tabInfo)}`);
  }
  log(`Created tab ${tabId}`);
  
  const cdp = (expr) => cdpEvaluate(tabId, expr);
  const inputCdp = (method, params) => cdpCommand(tabId, method, params);
  
  try {
    // Wait for page load
    await waitForPageLoad(cdp);
    log("Page loaded");
    
    // Check login status
    const loginStatus = await checkLoginStatus(cdp);
    if (!loginStatus.loggedIn) {
      throw new Error("X.com login required - log in to x.com in Chrome first");
    }
    if (!loginStatus.hasPremium) {
      log("Warning: X Premium may be required for some Grok features");
    }
    log(`Login: yes${loginStatus.hasPremium ? ' (Premium)' : ''}`);
    
    // Track warnings for agent feedback
    const warnings = [];
    
    // Wait for Grok UI
    await waitForGrokReady(cdp);
    log("Grok ready");
    
    // Select model (use default if not specified)
    const targetModel = model || DEFAULT_MODEL;
    let selectedModel = targetModel;
    let modelSelectionFailed = false;
    try {
      selectedModel = await selectModel(cdp, targetModel);
      log(`Model: ${selectedModel}`);
      // Check if we got a different model than requested
      const requestedNorm = targetModel.toLowerCase().replace(/[^a-z0-9]/g, '');
      const selectedNorm = selectedModel.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!selectedNorm.includes(requestedNorm) && !requestedNorm.includes(selectedNorm)) {
        warnings.push(`Requested model "${targetModel}" but got "${selectedModel}" - model may not be available`);
      }
    } catch (e) {
      modelSelectionFailed = true;
      warnings.push(`Model selection failed: ${e.message}. Run 'surf grok --validate' to check available models.`);
      log(`Model selection failed: ${e.message}`);
    }
    
    // Enable DeepSearch if requested
    let deepSearchEnabled = false;
    if (deepSearch) {
      try {
        const dsResult = await enableDeepSearch(cdp);
        if (dsResult.success) {
          deepSearchEnabled = true;
          log("DeepSearch enabled");
        } else {
          warnings.push(`DeepSearch toggle not found - feature may require X Premium or UI changed`);
        }
      } catch (e) {
        warnings.push(`DeepSearch toggle failed: ${e.message}`);
        log(`DeepSearch toggle failed: ${e.message}`);
      }
    }
    
    // Type prompt
    await typePrompt(cdp, inputCdp, prompt);
    log("Prompt typed");
    
    // Submit
    await submitPrompt(cdp, inputCdp);
    log("Submitted, waiting for response...");
    
    // Wait for response
    const response = await waitForResponse(cdp, timeout, prompt);
    const thinkingInfo = response.thinkingTime ? ` (thought for ${response.thinkingTime}s)` : '';
    log(`Response: ${response.text.length} chars${thinkingInfo}${response.partial ? ' (partial)' : ''}`);
    
    return {
      response: response.text,
      model: selectedModel,
      requestedModel: targetModel,
      modelSelectionFailed,
      thinkingTime: response.thinkingTime,
      deepSearch: deepSearch,
      deepSearchEnabled,
      url: response.url,
      partial: response.partial || false,
      warnings: warnings.length > 0 ? warnings : undefined,
      tookMs: Date.now() - startTime,
    };
  } finally {
    await closeTab(tabId).catch(() => {});
  }
}

// ============================================================================
// Validate Function - Check UI structure and scrape available models
// ============================================================================

async function validate(options) {
  const {
    getCookies,
    createTab,
    closeTab,
    cdpEvaluate,
    log = () => {},
  } = options;
  
  const startTime = Date.now();
  log("Starting Grok validation");
  
  const result = {
    authenticated: false,
    premium: false,
    models: [],
    expectedModels: Object.keys(getGrokModels()),
    modelMismatch: false,
    inputFound: false,
    sendButtonFound: false,
    errors: [],
    configPath: getConfigPath() || "~/surf.json",
  };
  
  // Check cookies
  try {
    const { cookies } = await getCookies();
    result.authenticated = hasRequiredCookies(cookies);
    if (!result.authenticated) {
      result.errors.push("Not authenticated - log in to x.com in Chrome first");
      return { ...result, tookMs: Date.now() - startTime };
    }
    log("Cookies OK");
  } catch (e) {
    result.errors.push(`Cookie check failed: ${e.message}`);
    return { ...result, tookMs: Date.now() - startTime };
  }
  
  // Create tab
  let tabId;
  try {
    const tabInfo = await createTab();
    tabId = tabInfo?.tabId;
    if (!tabId) {
      result.errors.push("Failed to create tab");
      return { ...result, tookMs: Date.now() - startTime };
    }
    log(`Created tab ${tabId}`);
  } catch (e) {
    result.errors.push(`Tab creation failed: ${e.message}`);
    return { ...result, tookMs: Date.now() - startTime };
  }
  
  const cdp = (expr) => cdpEvaluate(tabId, expr);
  
  try {
    // Wait for page load
    await waitForPageLoad(cdp);
    log("Page loaded");
    
    // Check login status
    const loginStatus = await checkLoginStatus(cdp);
    result.authenticated = loginStatus.loggedIn;
    result.premium = loginStatus.hasPremium;
    
    if (!loginStatus.loggedIn) {
      result.errors.push("Page shows logged out state");
      return { ...result, tookMs: Date.now() - startTime };
    }
    log(`Login: yes${result.premium ? ' (Premium)' : ''}`);
    
    // Wait for Grok UI
    await waitForGrokReady(cdp);
    log("Grok ready");
    
    // Check for input field
    const inputCheck = await evaluate(cdp, `(() => {
      const input = document.querySelector('textarea, [contenteditable="true"][role="textbox"], [data-testid="grokComposerInput"]');
      return { found: !!input && input.offsetParent !== null };
    })()`);
    result.inputFound = inputCheck?.found || false;
    log(`Input field: ${result.inputFound ? 'found' : 'NOT FOUND'}`);
    
    // Check for send button
    const sendCheck = await evaluate(cdp, `(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const sendBtn = buttons.find(b => {
        const label = (b.getAttribute('aria-label') || '').toLowerCase();
        const testId = b.getAttribute('data-testid') || '';
        return label.includes('send') || testId.includes('send') || testId.includes('submit');
      });
      return { found: !!sendBtn };
    })()`);
    result.sendButtonFound = sendCheck?.found || false;
    log(`Send button: ${result.sendButtonFound ? 'found' : 'NOT FOUND'}`);
    
    // Click model selector and scrape models
    const modelButtonClicked = await evaluate(cdp, `(() => {
      ${buildClickDispatcher()}
      const buttons = Array.from(document.querySelectorAll('button'));
      const modelBtn = buttons.find(b => {
        const text = (b.textContent || '').toLowerCase();
        const label = (b.getAttribute('aria-label') || '').toLowerCase();
        const testId = (b.getAttribute('data-testid') || '').toLowerCase();
        const hasModelName = /^(auto|fast|expert|grok\\s*4)/i.test(text.trim());
        const hasModelLabel = label.includes('model') || testId.includes('model');
        return hasModelName || hasModelLabel;
      });
      if (!modelBtn) return { success: false };
      dispatchClickSequence(modelBtn);
      return { success: true };
    })()`);
    
    if (modelButtonClicked?.success) {
      await delay(500);
      
      // Scrape model options
      const modelScrape = await evaluate(cdp, `(() => {
        const items = document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"]');
        const models = [];
        for (const item of items) {
          const text = (item.textContent || '').trim();
          // Skip non-model items like "Go to grok.com"
          if (text && !text.toLowerCase().includes('go to') && !text.toLowerCase().includes('grok.com')) {
            // Extract just the model name (first line if multi-line)
            const name = text.split('\\n')[0].trim();
            if (name) models.push(name);
          }
        }
        return { models };
      })()`);
      
      result.models = modelScrape?.models || [];
      log(`Found models: ${result.models.join(', ')}`);
      
      // Close the menu
      await evaluate(cdp, `document.body.click()`);
    } else {
      log("Could not open model selector");
      result.errors.push("Model selector button not found");
    }
    
    // Check for model mismatch
    const expectedNames = Object.values(getGrokModels()).map(m => m.name.toLowerCase());
    const foundNames = result.models.map(m => m.toLowerCase());
    
    const missing = expectedNames.filter(e => !foundNames.some(f => f.includes(e) || e.includes(f)));
    const extra = foundNames.filter(f => !expectedNames.some(e => f.includes(e) || e.includes(f)));
    
    if (missing.length > 0 || extra.length > 0) {
      result.modelMismatch = true;
      if (missing.length > 0) {
        result.errors.push(`Expected models not found: ${missing.join(', ')}`);
      }
      if (extra.length > 0) {
        result.errors.push(`Unexpected models found: ${extra.join(', ')}`);
      }
    }
    
  } catch (e) {
    result.errors.push(`Validation error: ${e.message}`);
  } finally {
    await closeTab(tabId).catch(() => {});
  }
  
  result.tookMs = Date.now() - startTime;
  return result;
}

// Save discovered models to surf.json config
function saveModels(models) {
  const fs = require("fs");
  const path = require("path");
  const os = require("os");
  
  try {
    // Use existing config path or default to ~/surf.json
    let configPath = getConfigPath();
    if (!configPath) {
      configPath = path.join(os.homedir(), "surf.json");
    }
    
    // Load existing config or start fresh
    let config = {};
    if (fs.existsSync(configPath)) {
      try {
        config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      } catch (e) {
        // Start fresh if parse fails
      }
    }
    
    // Update grok.models
    config.grok = config.grok || {};
    config.grok.models = models;
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    clearCache(); // Clear config cache so subsequent reads see new values
    return { success: true, path: configPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = { 
  query,
  validate,
  hasRequiredCookies, 
  getGrokModels,
  saveModels,
  extractGrokResponse,
  GROK_URL,
  GROK_MODELS,
  DEFAULT_GROK_MODELS,
  DEFAULT_MODEL,
};
