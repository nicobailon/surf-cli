---
name: surf-codebase
description: Navigate and modify surf-cli codebase - Chrome extension + native host for AI browser automation. Use for surf-cli code work, architecture questions, implementing browser control/CDP/accessibility/network features.
---

# surf-cli Codebase

## Architecture
```
cli.cjs --socket:/tmp/surf.sock--> host.cjs --native-msg--> service-worker/index.ts --CDP/chrome-APIs--> browser
```

## Add CLI Command

1. Add to `TOOLS` in native/cli.cjs:158 (args, opts, examples)
2. Add handler in src/service-worker/index.ts:50 `handleMessage()` switch
3. CDP op? → add method src/cdp/controller.ts:60
4. DOM interaction? → add handler src/content/accessibility-tree.ts:99

## Add CDP Operation

1. Add method to `CDPController` class src/cdp/controller.ts:60
2. Use `this.send(tabId, "Domain.method", params)`
3. Handle events in `handleCDPEvent()` if needed

## Core Files

**src/service-worker/index.ts** (~2500L) - Central msg router, CDP ops, screenshot cache, tab registry
- Msg types: EXECUTE_CLICK, EXECUTE_TYPE, READ_PAGE, EXECUTE_SCREENSHOT
- Screenshot cache: generateScreenshotId(), cacheScreenshot(), getScreenshot()
- Tab names: tabNameRegistry Map<name,tabId>

**src/cdp/controller.ts** (~1000L) - CDP wrapper, CDPController class
- Mouse: click(), rightClick(), doubleClick(), hover(), drag()
- Keyboard: type(), pressKey(), pressKeyChord()
- Screenshots: captureScreenshot(), captureRegion()
- Network/Console: enableNetworkTracking(), getNetworkRequests(), getResponseBody(), subscribeToNetwork(), enableConsoleTracking(), getConsoleMessages()
- Emulation: emulateNetwork(), emulateCPU(), emulateGeolocation()

**src/content/accessibility-tree.ts** (~1900L) - Content script, generates a11y tree YAML, element interactions
- Handlers: GENERATE_ACCESSIBILITY_TREE, CLICK_ELEMENT, FORM_INPUT, GET_ELEMENT_COORDINATES, WAIT_FOR_ELEMENT, WAIT_FOR_URL
- Element refs: e1, e2... in window.__piRefs for stable references

**native/cli.cjs** (~2100L) - CLI parser, socket client
- TOOLS: command defs with args/opts
- ALIASES: shortcut→command map
- AUTO_SCREENSHOT_TOOLS: commands that auto-capture
- parseArgs(), sendRequest()

**native/host.cjs** (~2100L) - Socket server, AI integration
- handleToolRequest(): main dispatcher
- mapToolToMessage(): tool→extension msg converter
- queueAiRequest(): AI request serialization
- AI clients: chatgptClient, geminiClient, perplexityClient

**src/native/port-manager.ts** - Extension↔native messaging, auto-reconnect, request/response tracking

## Message Flow

1. CLI: `surf click e5`
2. cli.cjs parses → socket → host.cjs
3. host.cjs routes to EXECUTE_CLICK msg
4. Native msg → service-worker/index.ts
5. Service worker: CDP (cdp/controller.ts) or content script (chrome.tabs.sendMessage)
6. Response flows back to CLI

## Debug

- Extension logs: chrome://extensions → Service Worker → Console
- Host logs: /tmp/surf-host.log
- CLI raw output: `--json` flag

## Test

```bash
npm run build            # Build ext
npm test                 # Run tests
npm run test:coverage    # Coverage
```

## Element Refs

A11y tree assigns e1, e2... during READ_PAGE. Stored window.__piRefs. Reset each `read` command.

## Network Capture

- CDP captures via Network.* events cdp/controller.ts:73
- Storage: /tmp/surf/requests.jsonl
- Formatters: native/formatters/network.cjs:259

## Build/Install

```bash
npm run dev              # Watch mode
npm run build            # Prod → dist/
# Load dist/ as unpacked ext
surf install             # Register native host; prints the dist/ folder to load
```

## Gotchas

- CDP attach: 100-500ms first time/tab
- chrome:// pages restricted
- Content script needs page refresh on existing tabs
- Screenshots auto-resize 1200px unless --full
