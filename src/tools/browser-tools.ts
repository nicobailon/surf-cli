import type { AgentTool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { computerTool, setComputerToolTabId } from "./computer-tool";
import { setSharedTargetTabId, getSharedTargetTabId } from "./shared";

export function setTargetTabId(tabId: number | null): void {
  setSharedTargetTabId(tabId);
  setComputerToolTabId(tabId);
}

const getTargetTabId = getSharedTargetTabId;

const screenshotSchema = Type.Object({});
const screenshotTool: AgentTool<typeof screenshotSchema, any> = {
  name: "screenshot",
  label: "Screenshot",
  description: "Capture a screenshot of the current page. Returns a base64-encoded PNG image. Use to see page state before clicking or to verify actions completed.",
  parameters: screenshotSchema,
  execute: async (toolCallId, params, signal) => {
    const tabId = await getTargetTabId();
    const result = await chrome.runtime.sendMessage({
      type: "EXECUTE_SCREENSHOT",
      tabId,
    });
    if (result.error) throw new Error(result.error);
    return {
      content: [{ type: "image", data: result.base64, mimeType: "image/png" }],
      details: { width: result.width, height: result.height },
    };
  },
};

const readPageSchema = Type.Object({
  filter: Type.Optional(Type.Union([
    Type.Literal("interactive"),
    Type.Literal("all"),
  ], { description: "Filter: 'interactive' (default) or 'all'" })),
  ref_id: Type.Optional(Type.String({
    description: "Focus on subtree of element with this ref_id",
  })),
  forceFullSnapshot: Type.Optional(Type.Boolean({
    description: "Force full snapshot even if incremental update is available (default: false)",
  })),
});
const readPageTool: AgentTool<typeof readPageSchema, any> = {
  name: "read_page",
  label: "Read Page",
  description: "Get accessibility tree with element refs for interaction. Use filter='interactive' for clickable elements only. Returns refs like [s1_ref_42] that can be used with computer tool clicks and form_input. Includes ARIA states (checked, disabled, expanded, etc.) and incremental diff when called repeatedly within 5 seconds. Output limited to 50KB.",
  parameters: readPageSchema,
  execute: async (toolCallId, { filter, ref_id, forceFullSnapshot }, signal) => {
    const tabId = await getTargetTabId();
    const result = await chrome.runtime.sendMessage({
      type: "READ_PAGE",
      tabId,
      options: { 
        filter: filter || "interactive", 
        refId: ref_id,
        forceFullSnapshot: forceFullSnapshot ?? false,
      },
    });
    if (result.error) {
      return {
        content: [{ type: "text", text: `Error: ${result.error}` }],
        details: { viewport: result.viewport },
      };
    }
    
    const parts: string[] = [result.pageContent];
    
    if (result.isIncremental && result.diff) {
      parts.push(`\n--- Diff from previous snapshot ---\n${result.diff}`);
    }
    
    if (result.modalStates && result.modalStates.length > 0) {
      parts.push(`\n--- Active Modals ---`);
      for (const modal of result.modalStates) {
        parts.push(`${modal.description} (dismiss: ${modal.clearedBy})`);
      }
    }
    
    return {
      content: [{ type: "text", text: parts.join('\n') }],
      details: { 
        viewport: result.viewport,
        isIncremental: result.isIncremental,
        modalLimitations: result.modalLimitations,
      },
    };
  },
};

const formInputSchema = Type.Object({
  ref: Type.String({ description: "Element ref from read_page (e.g., s1_ref_42)" }),
  value: Type.Union([Type.String(), Type.Boolean(), Type.Number()], {
    description: "Value to set (string for text, boolean for checkbox, etc.)",
  }),
});
const formInputTool: AgentTool<typeof formInputSchema, any> = {
  name: "form_input",
  label: "Form Input",
  description: "Set a form field value by ref_id from read_page. More reliable than click+type for inputs, dropdowns, checkboxes. Works with text inputs, selects, date pickers, and checkboxes.",
  parameters: formInputSchema,
  execute: async (toolCallId, { ref, value }, signal) => {
    const tabId = await getTargetTabId();
    const result = await chrome.runtime.sendMessage({
      type: "FORM_INPUT",
      tabId,
      ref,
      value,
    });
    if (result.error) {
      return {
        content: [{ type: "text", text: `Error: ${result.error}` }],
        details: { ref },
      };
    }
    return {
      content: [{ type: "text", text: `Set ${ref} to "${value}"` }],
      details: { ref, value },
    };
  },
};

const navigateSchema = Type.Object({
  url: Type.String({ description: "URL to navigate to" }),
});
const navigateTool: AgentTool<typeof navigateSchema, any> = {
  name: "navigate",
  label: "Navigate",
  description: "Navigate to a URL, or use 'back'/'forward' for browser history. Waits for page load before returning.",
  parameters: navigateSchema,
  execute: async (toolCallId, { url }, signal) => {
    const tabId = await getTargetTabId();
    await chrome.runtime.sendMessage({
      type: "EXECUTE_NAVIGATE",
      tabId,
      url,
    });
    return {
      content: [{ type: "text", text: `Navigated to ${url}` }],
      details: { url },
    };
  },
};

const getPageTextSchema = Type.Object({});
const getPageTextTool: AgentTool<typeof getPageTextSchema, any> = {
  name: "get_page_text",
  label: "Get Page Text",
  description: "Extract raw text content from the page, prioritizing article content. Ideal for reading articles, blog posts, documentation. Returns plain text without HTML. Includes page title and URL.",
  parameters: getPageTextSchema,
  execute: async (toolCallId, params, signal) => {
    const tabId = await getTargetTabId();
    const result = await chrome.runtime.sendMessage({
      type: "GET_PAGE_TEXT",
      tabId,
    });
    return {
      content: [{ type: "text", text: result.text || result.error }],
      details: { text: result.text?.substring(0, 100) || "" },
    };
  },
};

const waitSchema = Type.Object({
  duration: Type.Number({ description: "Seconds to wait (max 30)", minimum: 0, maximum: 30 }),
});
const waitTool: AgentTool<typeof waitSchema, any> = {
  name: "wait",
  label: "Wait",
  description: "Wait for a specified number of seconds",
  parameters: waitSchema,
  execute: async (toolCallId, { duration }, signal) => {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, duration * 1000);
      signal?.addEventListener("abort", () => {
        clearTimeout(timeout);
        reject(new Error("Aborted"));
      }, { once: true });
    });
    return {
      content: [{ type: "text", text: `Waited ${duration} seconds` }],
      details: { duration },
    };
  },
};

export function getBrowserTools(): AgentTool<any>[] {
  return [
    computerTool,
    screenshotTool,
    readPageTool,
    formInputTool,
    navigateTool,
    getPageTextTool,
    waitTool,
  ];
}

export const BROWSER_AGENT_SYSTEM_PROMPT = `You are Pi Agent, an AI assistant that can control the browser.

## Available Tools
- **computer**: Unified tool for all mouse/keyboard actions (click, type, key, scroll, etc.)
- **read_page**: Get accessibility tree with element ref_ids
- **form_input**: Set form field values by ref_id
- **screenshot**: Capture the current page
- **navigate**: Go to a URL
- **get_page_text**: Extract readable text from page
- **wait**: Wait for a duration

## Workflow
1. Use read_page or screenshot to understand the page
2. Use computer tool actions to interact (clicks, typing, etc.)
3. Verify results with another screenshot or read_page
`;
