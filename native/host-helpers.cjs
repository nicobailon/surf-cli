const fs = require("fs");
const networkFormatters = require("./formatters/network.cjs");
const networkStore = require("./network-store.cjs");

function buildProviderUploadMessage(provider, tabId, filePaths, id) {
  const normalizedProvider = String(provider || "").toLowerCase();
  if (!["chatgpt", "gemini"].includes(normalizedProvider)) {
    throw new Error(`Unsupported upload provider: ${provider}`);
  }
  return { type: "AI_UPLOAD_FILE_TO_TAB", provider: normalizedProvider, tabId, filePaths, id };
}

function normalizeModelString(model) {
  return String(model || "").trim().toLowerCase();
}

/**
 * Format tool result content for MCP response
 * @param {*} result - The result object from the extension
 * @param {Function} log - Logging function (defaults to no-op for testing)
 * @returns {Array} Array of content objects with type and text/data
 */
function formatToolContent(result, log = () => {}) {
  const text = (s) => [{ type: "text", text: s }];
  
  if (!result) return text("OK");
  
  if (result.aiResult) {
    if (result.mode === "find") {
      return text(result.ref || "NOT_FOUND");
    }
    return text(result.content);
  }
  
  // Handle element.styles response
  if (result.styles && Array.isArray(result.styles)) {
    const output = result.styles.map(el => {
      const lines = [`<${el.tag}>${el.text ? ` "${el.text.slice(0, 50)}${el.text.length > 50 ? '...' : ''}"` : ''}`];
      if (el.box) lines.push(`  box: ${el.box.x},${el.box.y} ${el.box.width}x${el.box.height}`);
      const s = el.styles;
      if (s) {
        if (s.fontSize) lines.push(`  font: ${s.fontSize} ${s.fontWeight} ${s.fontFamily}`);
        if (s.color) lines.push(`  color: ${s.color}`);
        if (s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)') lines.push(`  bg: ${s.backgroundColor}`);
        if (s.borderRadius && s.borderRadius !== '0px') lines.push(`  radius: ${s.borderRadius}`);
        if (s.border) lines.push(`  border: ${s.border}`);
        if (s.boxShadow) lines.push(`  shadow: ${s.boxShadow}`);
        if (s.padding && s.padding !== '0px') lines.push(`  padding: ${s.padding}`);
      }
      return lines.join('\n');
    }).join('\n\n');
    return text(output || "No elements found");
  }
  
  // Handle select response
  if (result.selected !== undefined) {
    let output = Array.isArray(result.selected) 
      ? `Selected: ${result.selected.join(', ')}`
      : `Selected: ${result.selected}`;
    if (result.warning) {
      output += `\n[Warning: ${result.warning}]`;
    }
    return text(output);
  }
  
  // Handle Grok validation results
  if (result.authenticated !== undefined && result.models !== undefined && result.expectedModels !== undefined) {
    let output = "## Grok Validation Results\n\n";
    output += `**Authenticated:** ${result.authenticated ? 'Yes' : 'No'}\n`;
    output += `**Premium:** ${result.premium ? 'Yes' : 'No'}\n`;
    output += `**Input Field:** ${result.inputFound ? 'Found' : 'Not Found'}\n`;
    output += `**Send Button:** ${result.sendButtonFound ? 'Found' : 'Not Found'}\n\n`;
    
    output += `**Available Models:** ${result.models.length > 0 ? result.models.join(', ') : 'None found'}\n`;
    output += `**Expected Models:** ${result.expectedModels.join(', ')}\n`;
    output += `**Model Mismatch:** ${result.modelMismatch ? 'Yes' : 'No'}\n\n`;
    
    if (result.errors && result.errors.length > 0) {
      output += `**Errors:**\n${result.errors.map(e => `- ${e}`).join('\n')}\n\n`;
    }
    
    if (result.savedModels) {
      if (result.savedModels.success) {
        output += `**Models saved to:** ${result.savedModels.path}\n`;
      } else {
        output += `**Failed to save models:** ${result.savedModels.error}\n`;
      }
    }
    
    output += `\n*Config: ${result.configPath}*\n`;
    output += `*Completed in ${result.tookMs}ms*`;
    
    return text(output);
  }
  
  // Handle ChatGPT/Gemini/Grok responses
  if (result.response !== undefined && result.model !== undefined && result.tookMs !== undefined) {
    let output = result.response;
    if (result.imagePath) {
      output += `\n\n*Image saved to: ${result.imagePath}*`;
    }
    if (result.thinkingTime) {
      output += `\n\n*Grok thought for ${result.thinkingTime}s*`;
    }
    if (result.partial) {
      output += `\n\n*Warning: Response was truncated due to timeout*`;
    }
    if (result.warnings && result.warnings.length > 0) {
      output += `\n\n**Warnings:**\n${result.warnings.map(w => `- ${w}`).join('\n')}`;
    }
    return text(output);
  }
  
  if (result.messages && Array.isArray(result.messages)) {
    const formatted = result.messages.map(m => {
      let loc = "";
      if (m.url) loc = m.line !== undefined ? ` (${m.url}:${m.line})` : ` (${m.url})`;
      return `[${m.type}] ${m.text}${loc}`;
    }).join("\n");
    return text(formatted || "No console messages");
  }

  // Handle both requests (basic) and entries (full) formats
  const items = result.requests || result.entries;
  if (items && Array.isArray(items)) {
    // Persist entries with full data to disk
    if (result.entries && items.length > 0) {
      (async () => {
        for (const entry of items) {
          try {
            await networkStore.appendEntry(entry);
          } catch (err) {
            log(`Failed to persist network entry: ${err.message}`);
          }
        }
      })();
    }
    
    if (items.length === 0) {
      return text("No network requests captured");
    }
    let formatted;
    if (result.format === 'curl') {
      formatted = networkFormatters.formatCurlBatch(items);
    } else if (result.format === 'urls') {
      formatted = networkFormatters.formatUrls(items);
    } else if (result.format === 'raw') {
      formatted = networkFormatters.formatRaw(items);
    } else if (result.verbose > 0) {
      formatted = networkFormatters.formatVerbose(items, result.verbose);
    } else if (result.entries) {
      // entries format means full data was requested - use verbose level 1
      formatted = networkFormatters.formatVerbose(items, 1);
    } else {
      formatted = items.map(r => {
        const status = String(r.status || '-').padStart(3);
        const method = (r.method || 'GET').padEnd(7);
        const type = (r.type || '').padEnd(10);
        return `${status} ${method} ${type} ${r.url}`;
      }).join("\n");
    }
    return text(formatted);
  }

  if (result.output !== undefined) {
    return text(result.output);
  }

  // Screenshot saved to file (has path but no base64)
  if (result.path && result.message && !result.base64) {
    let msg = result.message;
    if (result.screenshotId) {
      msg += `\n[Screenshot ID: ${result.screenshotId} - use with upload_image]`;
    }
    return text(msg);
  }

  // Screenshot with inline base64 (MCP flow or no savePath)
  if (result.screenshotId && result.base64) {
    const dims = result.width && result.height 
      ? `${result.width}x${result.height}` 
      : "unknown dimensions";
    return [
      { type: "text", text: `Screenshot captured (${dims}) - ID: ${result.screenshotId}` },
      { type: "image", data: result.base64, mimeType: "image/png" }
    ];
  }

  if (result.base64) {
    const dims = result.width && result.height 
      ? `${result.width}x${result.height}` 
      : "unknown dimensions";
    return [
      { type: "text", text: `Screenshot (${dims})` },
      { type: "image", data: result.base64, mimeType: "image/png" }
    ];
  }
  
  if (result.pageContent !== undefined) {
    const content = result.pageContent || "No content";
    let output = '';
    
    if (result.waited !== undefined) {
      output += `[Waited ${result.waited}ms]\n\n`;
    }
    
    output += content;
    
    if (result.isIncremental && result.diff) {
      output += `\n--- Diff from previous snapshot ---\n${result.diff}`;
    }
    
    if (result.modalStates && result.modalStates.length > 0) {
      output += `\n\n[ACTION REQUIRED] Modal blocking page - dismiss before proceeding:`;
      output += `\n  -> Press Escape key: computer(action="key", text="Escape")`;
      for (const modal of result.modalStates) {
        output += `\n  - ${modal.description}`;
      }
    }
    
    if (result.error) {
      return text(`Error: ${result.error}\n\n${output}`);
    }
    
    // Include page text content if requested via --text flag
    if (result.text) {
      output += `\n\n--- Page Text ---\n${result.text}`;
    }
    
    if (result.screenshot && result.screenshot.base64) {
      const dims = result.screenshot.width && result.screenshot.height 
        ? `${result.screenshot.width}x${result.screenshot.height}` 
        : "unknown";
      return [
        { type: "text", text: output },
        { type: "text", text: `\n[Screenshot included (${dims})]` },
        { type: "image", data: result.screenshot.base64, mimeType: "image/png" }
      ];
    }
    
    return text(output);
  }

  // Window commands - check before generic tabs check
  if (result.windowId !== undefined && result.success) {
    // window.new, window.focus, window.close, window.resize
    let msg = `Window ${result.windowId}`;
    if (result.tabId) msg += ` (tab ${result.tabId})`;
    if (result.width && result.height) msg += ` ${result.width}x${result.height}`;
    if (result.hint) msg += `\n${result.hint}`;
    return text(msg);
  }

  if (result.windows) {
    // window.list - preserve structure for CLI formatting (exclude internal id)
    return text(JSON.stringify({ windows: result.windows }, null, 2));
  }
  
  if (result.tabs) {
    return text(JSON.stringify(result.tabs, null, 2));
  }

  if (result.cookies && Array.isArray(result.cookies)) {
    return text(JSON.stringify(result.cookies, null, 2));
  }

  if (result.cookie) {
    return text(JSON.stringify(result.cookie, null, 2));
  }

  if (result.cleared !== undefined) {
    if (typeof result.cleared === "number") {
      return text(`Cleared ${result.cleared} cookies`);
    }
    return text(`Cleared cookie: ${result.cleared}`);
  }

  if (result.query !== undefined && result.matches) {
    const header = `Found ${result.count} matches for "${result.query}":`;
    if (result.matches.length === 0) return text(header);
    const matchList = result.matches.map(m => 
      `  ${m.ref}: "${m.text}" in "...${m.context}..."${m.elementRef ? ` [${m.elementRef}]` : ""}`
    ).join("\n");
    return text(`${header}\n${matchList}`);
  }

  if (result.groupId !== undefined && result.name !== undefined) {
    return text(`Tab group "${result.name}" (id: ${result.groupId}) with tabs: ${(result.tabIds || []).join(", ")}`);
  }

  if (result.ungrouped) {
    return text(`Ungrouped tabs: ${result.ungrouped.join(", ")}`);
  }

  if (result.groups && Array.isArray(result.groups)) {
    if (result.groups.length === 0) return text("No tab groups");
    const formatted = result.groups.map(g => {
      const tabList = g.tabs.map(t => `    ${t.id}: ${t.title}`).join("\n");
      return `${g.name} (${g.color}, ${g.tabs.length} tabs):\n${tabList}`;
    }).join("\n\n");
    return text(formatted);
  }

  if (result.completedActions !== undefined && result.totalActions !== undefined) {
    const status = result.success ? "SUCCESS" : "FAILED";
    const header = `Batch ${status}: ${result.completedActions}/${result.totalActions} actions completed`;
    if (result.results && result.results.length > 0) {
      const details = result.results.map(r => 
        `  [${r.index}] ${r.type}: ${r.success ? "OK" : "FAILED"}${r.error ? ` - ${r.error}` : ""}`
      ).join("\n");
      return text(`${header}\n${details}${result.error ? `\n\nError: ${result.error}` : ""}`);
    }
    return text(header);
  }

  if (result.zoom !== undefined) {
    return text(`Zoom: ${Math.round(result.zoom * 100)}%`);
  }

  if (result.bookmarks && Array.isArray(result.bookmarks)) {
    if (result.bookmarks.length === 0) return text("No bookmarks");
    const formatted = result.bookmarks.map(b => 
      `${b.title}\n  ${b.url}`
    ).join("\n\n");
    return text(formatted);
  }

  if (result.bookmark && result.bookmark.id) {
    return text(`Bookmarked: ${result.bookmark.title}\n  ${result.bookmark.url}`);
  }

  if (result.history && Array.isArray(result.history)) {
    if (result.history.length === 0) return text("No history");
    const formatted = result.history.map(h => {
      const date = h.lastVisitTime ? new Date(h.lastVisitTime).toLocaleString() : "unknown";
      return `${h.title || "(no title)"}\n  ${h.url}\n  Last visited: ${date}`;
    }).join("\n\n");
    return text(formatted);
  }
  
  if (result.text !== undefined) {
    const textContent = result.text || "No text content";
    let output = "";
    if (result.title) output += `Title: ${result.title}\n`;
    if (result.url) output += `URL: ${result.url}\n`;
    if (output) output += "\n";
    output += textContent;
    if (result.error) {
      return text(`Error: ${result.error}\n\n${output}`);
    }
    return text(output);
  }

  if (
    result.scrollTop !== undefined &&
    result.scrollHeight !== undefined &&
    result.scrollPercentage === undefined
  ) {
    return text(`Scrolled to Y:${result.scrollTop} (page height: ${result.scrollHeight})`);
  }

  if (result.scrollY !== undefined) {
    const pageHeight = result.pageHeight !== undefined ? ` (page height: ${result.pageHeight})` : "";
    return text(`Scrolled to Y:${result.scrollY}${pageHeight}`);
  }
  
  if (result.success && result.name && result.tabId !== undefined) {
    return text(`Registered tab ${result.tabId} as "${result.name}"`);
  }

  if (result.success && result.tabId && result.title !== undefined) {
    return text(`Switched to tab ${result.tabId}: ${result.title}`);
  }

  if (result.success && result.tabId && result.url) {
    return text(`Created tab ${result.tabId}: ${result.url}`);
  }

  if (result.success && result.closed) {
    return text(`Closed ${result.closed.length} tabs: ${result.closed.join(", ")}`);
  }

  if (result.success && result.tabId && !result.url) {
    return text(`Closed tab ${result.tabId}`);
  }

  if (result.success && result.width && result.height) {
    return text(`Resized window to ${result.width}x${result.height}`);
  }

  if (result.autoScreenshot) {
    const { path: ssPath, width, height } = result.autoScreenshot;
    try {
      const imgData = fs.readFileSync(ssPath);
      const base64 = imgData.toString("base64");
      const dims = width && height ? `${width}x${height}` : "unknown";
      return [
        { type: "text", text: `OK\nScreenshot (${dims}): ${ssPath}` },
        { type: "image", data: base64, mimeType: "image/png" }
      ];
    } catch {
      return text(`OK\nScreenshot saved: ${ssPath}`);
    }
  }

  if (result.autoScreenshotError) {
    return text(`OK\n[Screenshot failed: ${result.autoScreenshotError}]`);
  }

  // Bug fix: Handle success with metrics/frames/readyState/hint in one block
  if (result.success) {
    if (result.metrics) {
      return text(JSON.stringify(result.metrics, null, 2));
    }
    if (result.frames) {
      return text(JSON.stringify(result.frames, null, 2));
    }
    if (result.readyState) {
      return text(`Page loaded (readyState: ${result.readyState})`);
    }
    // Include _hint handling here instead of unreachable code below
    let msg = "OK";
    if (result._hint) msg += `\n[hint] ${result._hint}`;
    return text(msg);
  }

  if (result.value !== undefined) {
    return text(typeof result.value === "string" ? result.value : JSON.stringify(result.value, null, 2));
  }
  
  // Strip internal fields before JSON output
  const { _resolvedTabId, _hint, ...cleanResult } = result;
  if (_hint) {
    return text(JSON.stringify(cleanResult) + `\n[hint] ${_hint}`);
  }
  return text(JSON.stringify(cleanResult));
}

/**
 * Map computer action to extension message
 */
function mapComputerAction(args, tabId) {
  const a = args || {};
  const { action, text, scroll_direction, scroll_amount, 
          start_coordinate, ref, duration, modifiers } = a;
  const coordinate = a.coordinate || (a.x !== undefined && a.y !== undefined ? [a.x, a.y] : undefined);
  const baseMsg = { tabId };
  
  if (!action) {
    return { type: "UNSUPPORTED_ACTION", action: null, message: "No action specified for computer tool" };
  }
  
  switch (action) {
    case "screenshot":
      return { type: "EXECUTE_SCREENSHOT", ...baseMsg };
    
    case "left_click":
      if (ref) return { type: "CLICK_REF", ref, button: "left", ...baseMsg };
      if (a.selector) return { type: "CLICK_SELECTOR", selector: a.selector, index: a.index || 0, button: "left", ...baseMsg };
      return { type: "EXECUTE_CLICK", x: coordinate?.[0], y: coordinate?.[1], modifiers, ...baseMsg };
    
    case "right_click":
      if (ref) return { type: "CLICK_REF", ref, button: "right", ...baseMsg };
      return { type: "EXECUTE_RIGHT_CLICK", x: coordinate?.[0], y: coordinate?.[1], modifiers, ...baseMsg };
    
    case "double_click":
      if (ref) return { type: "CLICK_REF", ref, button: "double", ...baseMsg };
      return { type: "EXECUTE_DOUBLE_CLICK", x: coordinate?.[0], y: coordinate?.[1], modifiers, ...baseMsg };
    
    case "triple_click":
      if (ref) return { type: "CLICK_REF", ref, button: "triple", ...baseMsg };
      return { type: "EXECUTE_TRIPLE_CLICK", x: coordinate?.[0], y: coordinate?.[1], modifiers, ...baseMsg };
    
    case "type":
      if (ref) {
        return { type: "FORM_FILL", data: [{ ref, value: text }], ...baseMsg };
      }
      return { type: "EXECUTE_TYPE", text, ...baseMsg };
    
    case "key": {
      const keyValue = a.key || text;
      const repeatCount = Math.min(100, Math.max(1, a.repeat || 1));
      if (repeatCount > 1) {
        return { type: "EXECUTE_KEY_REPEAT", key: keyValue, repeat: repeatCount, tabId };
      }
      return { type: "EXECUTE_KEY", key: keyValue, ...baseMsg };
    }
    
    case "type_submit":
      return { type: "TYPE_SUBMIT", text, submitKey: a.submitKey || "Enter", ...baseMsg };
    
    case "click_type":
      return { type: "CLICK_TYPE", text, ref, coordinate, ...baseMsg };
    
    case "click_type_submit":
      return { type: "CLICK_TYPE_SUBMIT", text, ref, coordinate, submitKey: a.submitKey || "Enter", ...baseMsg };
    
    case "find_and_type":
      return { type: "FIND_AND_TYPE", text, submit: a.submit ?? false, submitKey: a.submitKey || "Enter", ...baseMsg };
    
    case "scroll": {
      const direction = a.direction || scroll_direction;
      const amount = a.scroll_pixels ?? ((a.amount ?? scroll_amount ?? 3) * 100);
      const deltas = {
        up: { deltaX: 0, deltaY: -amount },
        down: { deltaX: 0, deltaY: amount },
        left: { deltaX: -amount, deltaY: 0 },
        right: { deltaX: amount, deltaY: 0 },
      };
      const { deltaX, deltaY } = deltas[direction] || { deltaX: 0, deltaY: 0 };
      return { type: "EXECUTE_SCROLL", deltaX, deltaY, x: coordinate?.[0], y: coordinate?.[1], ...baseMsg };
    }
    
    case "scroll_to":
      return { type: "SCROLL_TO_ELEMENT", ref, ...baseMsg };
    
    case "hover":
      if (ref) return { type: "HOVER_REF", ref, ...baseMsg };
      return { type: "EXECUTE_HOVER", x: coordinate?.[0], y: coordinate?.[1], ...baseMsg };
    
    case "left_click_drag":
    case "drag":
      return { 
        type: "EXECUTE_DRAG", 
        startX: start_coordinate?.[0], 
        startY: start_coordinate?.[1],
        endX: coordinate?.[0],
        endY: coordinate?.[1],
        modifiers,
        ...baseMsg 
      };
    
    case "wait":
      return { type: "LOCAL_WAIT", seconds: Math.min(30, duration || 1) };
    
    case "zoom":
      if (a.reset) return { type: "ZOOM_RESET", tabId };
      if (a.level !== undefined) return { type: "ZOOM_SET", level: parseFloat(a.level), tabId };
      return { type: "ZOOM_GET", tabId };
    
    default:
      return { type: "UNSUPPORTED_ACTION", action, message: `Unknown computer action: ${action}` };
  }
}

/**
 * Map tool name and args to extension message
 */
function mapToolToMessage(tool, args, tabId) {
  const baseMsg = { tabId };
  const a = args || {};
  
  switch (tool) {
    case "computer":
      return mapComputerAction(args, tabId);
    case "navigate":
      return { type: "EXECUTE_NAVIGATE", url: a.url, ...baseMsg };
    case "read_page":
      return { 
        type: "READ_PAGE", 
        options: { 
          filter: a.filter || "interactive",
          depth: a.depth,
          refId: a.ref_id,
          format: a.format,
          forceFullSnapshot: a.forceFullSnapshot ?? false,
          includeScreenshot: a.includeScreenshot ?? false
        },
        ...baseMsg 
      };
    case "get_page_text":
      return { type: "GET_PAGE_TEXT", ...baseMsg };
    case "form_input":
      return { type: "FORM_INPUT", ref: a.ref, value: a.value, ...baseMsg };
    case "eval":
      return { type: "EVAL_IN_PAGE", code: a.code, ...baseMsg };
    case "find_and_type":
      return { type: "FIND_AND_TYPE", text: a.text, submit: a.submit ?? false, submitKey: a.submitKey || "Enter", ...baseMsg };
    case "autocomplete":
      return { type: "AUTOCOMPLETE_SELECT", text: a.text, ref: a.ref, coordinate: a.coordinate, index: a.index ?? 0, waitMs: a.waitMs ?? 500, ...baseMsg };
    case "set_value":
      return { type: "SET_INPUT_VALUE", selector: a.selector, ref: a.ref, value: a.value, ...baseMsg };
    case "smart_type":
      return { type: "SMART_TYPE", selector: a.selector, text: a.text, clear: a.clear ?? true, submit: a.submit ?? false, ...baseMsg };
    case "scroll_to_position":
      return { type: "SCROLL_TO_POSITION", position: a.position, selector: a.selector, ...baseMsg };
    case "get_scroll_info":
      return { type: "GET_SCROLL_INFO", selector: a.selector, ...baseMsg };
    case "close_dialogs":
      return { type: "CLOSE_DIALOGS", maxAttempts: a.maxAttempts ?? 3, ...baseMsg };
    case "page_state":
      return { type: "PAGE_STATE", ...baseMsg };
    case "tabs_context":
      return { type: "GET_TABS" };
    case "screenshot":
      return { 
        type: "EXECUTE_SCREENSHOT", 
        savePath: a.savePath || a.output,  // Accept both savePath (CLI) and output (MCP)
        annotate: a.annotate || false,
        fullpage: a.fullpage || a["full-page"] || false,
        maxHeight: a["max-height"] || 4000,
        fullRes: a.full || false,
        maxSize: a["max-size"] || 1200,
        ...baseMsg 
      };
    case "javascript_tool":
      return { type: "EXECUTE_JAVASCRIPT", code: a.code, ...baseMsg };
    case "animate-audit": {
      if (!a.selector || typeof a.selector !== "string") throw new Error("selector required");
      if (typeof a.duration === "boolean") throw new Error("duration must be a number");
      if (typeof a.fps === "boolean") throw new Error("fps must be a number");
      const durationMs = a.duration !== undefined ? Number(a.duration) : 2000;
      const fps = a.fps !== undefined ? Number(a.fps) : 10;
      if (!Number.isFinite(durationMs) || durationMs < 100 || durationMs > 10000) {
        throw new Error("duration must be between 100 and 10000 ms");
      }
      if (!Number.isFinite(fps) || fps < 1 || fps > 30) {
        throw new Error("fps must be between 1 and 30");
      }
      return { type: "ANIMATE_AUDIT", selector: a.selector, durationMs, fps, ...baseMsg };
    }
    case "perf-audit": {
      if (typeof a.duration === "boolean") throw new Error("duration must be a number");
      if (a.trigger !== undefined && typeof a.trigger !== "string") {
        throw new Error("trigger must be action:target");
      }
      const durationMs = a.duration !== undefined ? Number(a.duration) : 3000;
      if (!Number.isFinite(durationMs) || durationMs < 100 || durationMs > 10000) {
        throw new Error("duration must be between 100 and 10000 ms");
      }
      return { type: "PERF_AUDIT", durationMs, trigger: a.trigger, ...baseMsg };
    }
    case "wait_for_element":
      return { 
        type: "WAIT_FOR_ELEMENT", 
        selector: a.selector,
        state: a.state || "visible",
        timeout: a.timeout || 20000,
        ...baseMsg 
      };
    case "wait_for_url":
      return { 
        type: "WAIT_FOR_URL", 
        pattern: a.pattern || a.url || a.urlContains,
        timeout: a.timeout || 20000,
        ...baseMsg 
      };
    case "wait_for_network_idle":
      return { 
        type: "WAIT_FOR_NETWORK_IDLE", 
        timeout: a.timeout || 10000,
        ...baseMsg 
      };
    case "console":
    case "read_console_messages":
      return { 
        type: "READ_CONSOLE_MESSAGES", 
        onlyErrors: a.only_errors,
        pattern: a.pattern,
        limit: a.limit,
        clear: a.clear,
        ...baseMsg 
      };
    case "network":
    case "get_network_entries":
      return { 
        type: "READ_NETWORK_REQUESTS",
        full: a.v || a.vv || a.format === 'curl' || a.format === 'verbose' || a.format === 'raw',
        urlPattern: a.filter || a.url_pattern || a.origin,
        method: a.method,
        status: a.status,
        contentType: a.type,
        limit: a.limit || a.last,
        format: a.format,
        verbose: a.v ? 1 : (a.vv ? 2 : 0),
        ...baseMsg 
      };

    case "network.get":
    case "get_network_entry":
      return { 
        type: "GET_NETWORK_ENTRY", 
        requestId: a.id || args[0],
        ...baseMsg 
      };

    case "network.body":
      return { 
        type: "GET_RESPONSE_BODY", 
        requestId: a.id || args[0],
        isRequest: a.request,
        ...baseMsg 
      };

    case "network.curl":
      return { 
        type: "GET_NETWORK_ENTRY", 
        requestId: a.id || args[0],
        formatAsCurl: true,
        ...baseMsg 
      };

    case "network.origins":
      return { 
        type: "GET_NETWORK_ORIGINS",
        byTab: a["by-tab"] || a.byTab,
        ...baseMsg 
      };

    case "network.clear":
      return { 
        type: "CLEAR_NETWORK_REQUESTS",
        before: a.before,
        origin: a.origin,
        ...baseMsg 
      };

    case "network.stats":
      return { 
        type: "GET_NETWORK_STATS",
        ...baseMsg 
      };

    case "network.export":
      return { 
        type: "EXPORT_NETWORK_REQUESTS",
        har: a.har,
        jsonl: a.jsonl,
        output: a.output,
        ...baseMsg 
      };

    case "network.path":
      return { 
        type: "GET_NETWORK_PATHS",
        requestId: a.id || args[0],
        ...baseMsg 
      };

    case "read_network_requests":
      return { 
        type: "READ_NETWORK_REQUESTS", 
        urlPattern: a.url_pattern,
        limit: a.limit,
        clear: a.clear,
        ...baseMsg 
      };
    case "upload_image":
      return { 
        type: "UPLOAD_IMAGE", 
        screenshotId: a.screenshot_id,
        ref: a.ref,
        coordinate: a.coordinate,
        filename: a.filename,
        ...baseMsg 
      };
    case "resize_window":
      return { 
        type: "RESIZE_WINDOW", 
        width: a.width, 
        height: a.height, 
        ...baseMsg 
      };
    case "tabs_create":
      return { type: "TABS_CREATE", url: a.url, ...baseMsg };
    case "tabs_register":
      return { type: "TABS_REGISTER", name: a.name, ...baseMsg };
    case "tabs_get_by_name":
      return { type: "TABS_GET_BY_NAME", name: a.name };
    case "tabs_list_named":
      return { type: "TABS_LIST_NAMED" };
    case "tabs_unregister":
      return { type: "TABS_UNREGISTER", name: a.name };
    case "list_tabs":
      return { type: "LIST_TABS" };
    case "new_tab":
      return { type: "NEW_TAB", url: a.url, urls: a.urls };
    case "switch_tab":
      return { type: "SWITCH_TAB", tabId: a.tab_id || a.tabId };
    case "close_tab":
      return { type: "CLOSE_TAB", tabId: a.tab_id || a.tabId, tabIds: a.tab_ids || a.tabIds };
    case "tab.list":
      return { type: "LIST_TABS" };
    case "tab.new":
      return { type: "NEW_TAB", url: a.url, urls: a.urls };
    case "tab.switch": {
      const id = a.id || a.tab_id || a.tabId;
      if (typeof id === "string" && !/^\d+$/.test(id)) {
        return { type: "NAMED_TAB_SWITCH", name: id };
      }
      return { type: "SWITCH_TAB", tabId: id };
    }
    case "tab.close": {
      const id = a.id || a.tab_id || a.tabId;
      const ids = a.ids || a.tab_ids || a.tabIds;
      if (typeof id === "string" && !/^\d+$/.test(id)) {
        return { type: "NAMED_TAB_CLOSE", name: id };
      }
      return { type: "CLOSE_TAB", tabId: id, tabIds: ids };
    }
    case "tab.name":
      return { type: "TABS_REGISTER", name: a.name, ...baseMsg };
    case "tab.unname":
      return { type: "TABS_UNREGISTER", name: a.name };
    case "tab.named":
      return { type: "TABS_LIST_NAMED" };
    case "js":
      return { type: "EXECUTE_JAVASCRIPT", code: a.code, ...baseMsg };
    case "scroll.top":
      return { type: "SCROLL_TO_POSITION", position: "top", selector: a.selector, ...baseMsg };
    case "scroll.bottom":
      return { type: "SCROLL_TO_POSITION", position: "bottom", selector: a.selector, ...baseMsg };
    case "scroll.info":
      return { type: "GET_SCROLL_INFO", selector: a.selector, ...baseMsg };
    case "scroll.to":
      return { type: "SCROLL_TO_ELEMENT", ref: a.ref, ...baseMsg };
    case "wait.element":
      return { type: "WAIT_FOR_ELEMENT", selector: a.selector, timeout: a.timeout, ...baseMsg };
    case "wait.network":
      return { type: "WAIT_FOR_NETWORK_IDLE", timeout: a.timeout, ...baseMsg };
    case "wait.url":
      return { type: "WAIT_FOR_URL", pattern: a.pattern || a.url, timeout: a.timeout, ...baseMsg };
    case "wait.dom":
      return { type: "WAIT_FOR_DOM_STABLE", stable: a.stable || 100, timeout: a.timeout || 5000, ...baseMsg };
    case "wait.load":
      return { type: "WAIT_FOR_LOAD", timeout: a.timeout || 30000, ...baseMsg };
    case "frame.list":
      return { type: "GET_FRAMES", ...baseMsg };
    case "frame.switch":
      return { 
        type: "FRAME_SWITCH", 
        selector: a.selector,
        name: a.name,
        index: a.index !== undefined ? parseInt(a.index, 10) : undefined,
        ...baseMsg 
      };
    case "frame.main":
      return { type: "FRAME_MAIN", ...baseMsg };
    case "frame.js":
      return { type: "EVALUATE_IN_FRAME", frameId: a.id, code: a.code, ...baseMsg };
    case "dialog.accept":
      return { type: "DIALOG_ACCEPT", text: a.text, ...baseMsg };
    case "dialog.dismiss":
      if (a.all) return { type: "CLOSE_DIALOGS", maxAttempts: a.maxAttempts || 3, ...baseMsg };
      return { type: "DIALOG_DISMISS", ...baseMsg };
    case "dialog.info":
      return { type: "DIALOG_INFO", ...baseMsg };
    case "emulate.network":
      return { type: "EMULATE_NETWORK", preset: a.preset, ...baseMsg };
    case "emulate.cpu":
      const cpuRate = parseFloat(a.rate);
      return { type: "EMULATE_CPU", rate: isNaN(cpuRate) ? 1 : cpuRate, ...baseMsg };
    case "emulate.geo":
      if (a.clear) {
        return { type: "EMULATE_GEO", clear: true, ...baseMsg };
      }
      if (a.lat === undefined || a.lon === undefined) {
        throw new Error("--lat and --lon required");
      }
      return { type: "EMULATE_GEO", latitude: parseFloat(a.lat), longitude: parseFloat(a.lon), accuracy: parseFloat(a.accuracy) || 100, ...baseMsg };
    case "emulate.device":
      if (a.list) {
        return { type: "EMULATE_DEVICE_LIST" };
      }
      if (!a.device) throw new Error("device name required");
      return { type: "EMULATE_DEVICE", device: a.device, ...baseMsg };
    case "emulate.viewport":
      return { 
        type: "EMULATE_VIEWPORT", 
        width: a.width ? parseInt(a.width, 10) : undefined,
        height: a.height ? parseInt(a.height, 10) : undefined,
        deviceScaleFactor: a.scale ? parseFloat(a.scale) : undefined,
        mobile: a.mobile,
        ...baseMsg 
      };
    case "emulate.touch":
      return { type: "EMULATE_TOUCH", enabled: a.enabled !== false, ...baseMsg };
    case "form.fill":
      let fillData = a.data;
      if (typeof fillData === "string") {
        try { fillData = JSON.parse(fillData); } catch (e) { throw new Error("invalid --data JSON"); }
      }
      return { type: "FORM_FILL", data: fillData, ...baseMsg };
    case "perf.start":
      return { type: "PERF_START", categories: a.categories ? a.categories.split(",") : undefined, ...baseMsg };
    case "perf.stop":
      return { type: "PERF_STOP", ...baseMsg };
    case "perf.metrics":
      return { type: "PERF_METRICS", ...baseMsg };
    case "upload":
      const files = a.files ? (typeof a.files === "string" ? a.files.split(",").map(f => f.trim()) : a.files) : [];
      return { type: "UPLOAD_FILE", ref: a.ref, files, ...baseMsg };
    case "page.read":
      return { 
        type: "READ_PAGE", 
        options: { 
          filter: a.filter || "interactive", 
          refId: a.ref, 
          includeText: a["no-text"] !== true,
          depth: a.depth !== undefined ? parseInt(a.depth, 10) : undefined,
          compact: a.compact || false,
        }, 
        ...baseMsg 
      };
    case "page.text":
      return { type: "GET_PAGE_TEXT", ...baseMsg };
    case "page.state":
      return { type: "PAGE_STATE", ...baseMsg };
    case "locate.role":
      if (!a.role) throw new Error("role argument required");
      return { 
        type: "LOCATE_ROLE", 
        role: a.role,
        name: a.name,
        action: a.action,
        value: a.value,
        all: a.all || false,
        ...baseMsg 
      };
    case "locate.text":
      if (!a.text) throw new Error("text argument required");
      return { 
        type: "LOCATE_TEXT", 
        text: a.text,
        exact: a.exact || false,
        action: a.action,
        value: a.value,
        ...baseMsg 
      };
    case "locate.label":
      if (!a.label) throw new Error("label argument required");
      return { 
        type: "LOCATE_LABEL", 
        label: a.label,
        action: a.action,
        value: a.value,
        ...baseMsg 
      };
    case "element.styles":
      if (!a.selector) throw new Error("selector argument required");
      return { 
        type: "GET_ELEMENT_STYLES", 
        selector: a.selector,
        ...baseMsg 
      };
    case "select": {
      if (!a.selector) throw new Error("selector argument required");
      const values = Array.isArray(a.values) ? a.values : (a.values ? [a.values] : []);
      if (values.length === 0) throw new Error("at least one value required");
      return { 
        type: "SELECT_OPTION", 
        selector: a.selector,
        values,
        by: a.by || "value",  // value, label, or index
        ...baseMsg 
      };
    }
    case "ai":
      return { type: "AI_ANALYZE", query: a.query, act: a.act, mode: a.mode, ...baseMsg };
    case "wait":
      return { type: "LOCAL_WAIT", seconds: Math.min(30, a.duration || a.seconds || 1) };
    case "health":
      if (a.url) {
        return { type: "HEALTH_CHECK_URL", url: a.url, expect: a.expect || 200, timeout: a.timeout || 30000 };
      } else if (a.selector) {
        return { type: "WAIT_FOR_ELEMENT", selector: a.selector, timeout: a.timeout || 30000, ...baseMsg };
      }
      return { type: "ERROR", error: "--url or --selector required" };
    case "smoke":
      return { 
        type: "SMOKE_TEST", 
        urls: a.urls || [],
        routes: a.routes,
        savePath: a.screenshot,
        failFast: a["fail-fast"] || false,
        ...baseMsg 
      };
    case "type":
    case "left_click":
    case "right_click":
    case "double_click":
    case "triple_click":
    case "key":
    case "hover":
    case "drag":
    case "scroll":
      return mapComputerAction({ ...a, action: tool }, tabId);
    case "click":
      return mapComputerAction({ ...a, action: "left_click" }, tabId);
    case "cookie.list":
      return { type: "COOKIE_LIST", ...baseMsg };
    case "cookie.get":
      if (!a.name) throw new Error("--name required");
      return { type: "COOKIE_GET", name: a.name, ...baseMsg };
    case "cookie.set":
      if (!a.name) throw new Error("--name required");
      if (a.value === undefined) throw new Error("--value required");
      return { type: "COOKIE_SET", name: a.name, value: a.value, expires: a.expires, ...baseMsg };
    case "cookie.clear":
      if (a.all) return { type: "COOKIE_CLEAR_ALL", ...baseMsg };
      if (!a.name) throw new Error("--name or --all required");
      return { type: "COOKIE_CLEAR", name: a.name, ...baseMsg };
    case "search":
      if (!a.term) throw new Error("search term required");
      return { type: "SEARCH_PAGE", term: a.term, caseSensitive: a["case-sensitive"] || false, limit: a.limit || 10, ...baseMsg };
    case "tab.group": {
      const tabIds = a.tabs ? String(a.tabs).split(",").map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id)) : [];
      return { type: "TAB_GROUP_CREATE", name: a.name, tabIds, color: a.color || "blue", ...baseMsg };
    }
    case "tab.ungroup": {
      const tabIds = a.tabs ? String(a.tabs).split(",").map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id)) : [];
      return { type: "TAB_GROUP_REMOVE", tabIds, ...baseMsg };
    }
    case "tab.groups":
      return { type: "TAB_GROUPS_LIST" };
    case "batch": {
      let actions = a.actions;
      
      if (a.file) {
        if (!fs.existsSync(a.file)) {
          throw new Error(`file not found: ${a.file}`);
        }
        const content = fs.readFileSync(a.file, "utf8");
        try {
          actions = JSON.parse(content);
        } catch (e) {
          throw new Error(`invalid JSON in ${a.file}`);
        }
      }
      
      if (typeof actions === "string") {
        try {
          actions = JSON.parse(actions);
        } catch (e) {
          throw new Error("invalid --actions JSON");
        }
      }
      
      if (!Array.isArray(actions)) {
        throw new Error("actions must be array");
      }
      
      return { type: "BATCH_EXECUTE", actions, ...baseMsg };
    }
    case "back":
      return { type: "EXECUTE_JAVASCRIPT", code: "history.back()", ...baseMsg };
    case "forward":
      return { type: "EXECUTE_JAVASCRIPT", code: "history.forward()", ...baseMsg };
    case "tab.reload":
      return { type: "TAB_RELOAD", hard: a.hard || false, ...baseMsg };
    case "zoom":
      if (a.reset) return { type: "ZOOM_RESET", ...baseMsg };
      if (a.level !== undefined) return { type: "ZOOM_SET", level: parseFloat(a.level), ...baseMsg };
      return { type: "ZOOM_GET", ...baseMsg };
    case "resize":
      return { type: "RESIZE_WINDOW", width: a.width, height: a.height, ...baseMsg };
    case "bookmark.add":
      return { type: "BOOKMARK_ADD", folder: a.folder, ...baseMsg };
    case "bookmark.remove":
      return { type: "BOOKMARK_REMOVE", ...baseMsg };
    case "bookmark.list":
      return { type: "BOOKMARK_LIST", folder: a.folder, limit: a.limit !== undefined ? parseInt(a.limit, 10) : 50 };
    case "history.list":
      return { type: "HISTORY_LIST", limit: a.limit !== undefined ? parseInt(a.limit, 10) : 20 };
    case "history.search":
      if (!a.query) throw new Error("query required");
      return { type: "HISTORY_SEARCH", query: a.query, limit: a.limit !== undefined ? parseInt(a.limit, 10) : 20 };
    case "chatgpt":
      if (!a.query) throw new Error("query required");
      return { 
        type: "CHATGPT_QUERY", 
        query: a.query, 
        model: a.model,
        withPage: a["with-page"],
        file: a.file,
        timeout: a.timeout ? parseInt(a.timeout, 10) * 1000 : 2700000,
        ...baseMsg 
      };
    case "gemini":
      if (!a.query && !a["generate-image"]) throw new Error("query required");
      return {
        type: "GEMINI_QUERY",
        query: a.query,
        model: a.model || "gemini-3-pro",
        withPage: a["with-page"],
        file: a.file,
        generateImage: a["generate-image"],
        editImage: a["edit-image"],
        output: a.output,
        youtube: a.youtube,
        aspectRatio: a["aspect-ratio"],
        timeout: a.timeout ? parseInt(a.timeout, 10) * 1000 : 300000,
        ...baseMsg
      };
    case "perplexity":
      if (!a.query) throw new Error("query required");
      return {
        type: "PERPLEXITY_QUERY",
        query: a.query,
        mode: a.mode || "search",
        model: a.model,
        withPage: a["with-page"],
        timeout: a.timeout ? parseInt(a.timeout, 10) * 1000 : 120000,
        ...baseMsg
      };
    case "grok":
      if (a.validate) {
        return {
          type: "GROK_VALIDATE",
          saveModels: a["save-models"] || a.saveModels || false,
          ...baseMsg
        };
      }
      if (!a.query) throw new Error("query required");
      return {
        type: "GROK_QUERY",
        query: a.query,
        model: a.model,
        deepSearch: a["deep-search"] || a.deepSearch || false,
        withPage: a["with-page"],
        timeout: a.timeout ? parseInt(a.timeout, 10) * 1000 : 300000,
        ...baseMsg
      };
    case "aistudio": {
      if (!a.query) throw new Error("query required");

      return {
        type: "AISTUDIO_QUERY",
        query: a.query,
        model: a.model ? normalizeModelString(a.model) : undefined,
        withPage: a["with-page"],
        timeout: a.timeout ? parseInt(a.timeout, 10) * 1000 : 300000,
        ...baseMsg
      };
    }
    case "aistudio.build": {
      if (!a.query) throw new Error("query required");

      return {
        type: "AISTUDIO_BUILD",
        query: a.query,
        model: a.model ? normalizeModelString(a.model) : undefined,
        output: a.output,
        keepOpen: Boolean(a["keep-open"] || a.keepOpen),
        timeout: a.timeout ? parseInt(a.timeout, 10) * 1000 : 600000,
        ...baseMsg,
      };
    }
    case "window.new":
      return { 
        type: "WINDOW_NEW", 
        url: a.url, 
        width: a.width ? parseInt(a.width, 10) : undefined,
        height: a.height ? parseInt(a.height, 10) : undefined,
        incognito: a.incognito || false,
        focused: a.unfocused ? false : true,
      };
    case "window.list":
      return { type: "WINDOW_LIST", includeTabs: a.tabs || false };
    case "window.focus":
      if (!a.id) throw new Error("window id required");
      return { type: "WINDOW_FOCUS", windowId: parseInt(a.id, 10) };
    case "window.close":
      if (!a.id) throw new Error("window id required");
      return { type: "WINDOW_CLOSE", windowId: parseInt(a.id, 10) };
    case "window.resize":
      if (!a.id) throw new Error("--id required");
      return { 
        type: "WINDOW_RESIZE", 
        windowId: parseInt(a.id, 10),
        width: a.width ? parseInt(a.width, 10) : undefined,
        height: a.height ? parseInt(a.height, 10) : undefined,
        left: a.left !== undefined ? parseInt(a.left, 10) : undefined,
        top: a.top !== undefined ? parseInt(a.top, 10) : undefined,
        state: a.state,
      };
    default:
      return null;
  }
}

module.exports = { mapToolToMessage, mapComputerAction, formatToolContent, buildProviderUploadMessage };
