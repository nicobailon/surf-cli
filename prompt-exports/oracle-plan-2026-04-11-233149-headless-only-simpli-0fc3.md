# Oracle Plan

Hi Daniel — clean cut, less ceremony, stronger tool.

## 1. **Summary**

Simplify `surf-cli` from an extension-backed Chrome automation suite into a terminal-only, headless-first tool. This is a **broad refactor**, not a targeted cleanup, because removing the extension also removes the current web navigation/scraping runtime, the native host/socket execution path, MCP’s backend, and provider fallback behavior. The new architecture should route CLI and MCP through a shared in-process dispatcher: ChatGPT defaults to headless CloakBrowser, Gemini defaults to headless Bun WebView, and web navigation/scraping uses a new headless Playwright/CDP backend. All headed/headless env toggles, extension install commands, native messaging host files, extension-only providers, and legacy socket fallback paths are removed.

---

## 2. **Current-state analysis**

### CLI routing and ownership today

`native/cli.cjs` is currently the central command parser and router.

Relevant current imports:

- Provider bridges:
  - `chatgpt-cloak-bridge.cjs`
  - `chatgpt-bun-bridge.cjs`
  - `gemini-bun-bridge.cjs`
- Legacy socket path:
  - `net`
  - `socket-path.cjs`
  - `openSocketConnection(...)`
  - `startLegacySocketPath()`
- Workflow:
  - `do-parser.cjs`
  - `do-executor.cjs`
- Session/persistence:
  - `session-store.cjs`
  - `session-reconciler.cjs`
  - `network-store.cjs`

Today, ChatGPT and Gemini route through three possible backends:

1. **ChatGPT Cloak path**
   - Enabled only when `SURF_USE_CLOAK_CHATGPT=1`.
   - CLI calls `queryWithCloakBrowser(...)` or `manageChatsWithCloakBrowser(...)`.
   - Bridge spawns `chatgpt-cloak-worker.mjs` / `chatgpt-cloak-chats-worker.mjs`.

2. **ChatGPT/Gemini Bun path**
   - Enabled by `SURF_USE_BUN_CHATGPT=1` or `SURF_USE_BUN_GEMINI=1`.
   - Bridges detect Bun, build worker request, spawn Bun worker.
   - Workers are already hardcoded `headless: true`.
   - Bridges return `fallbackRecommended`, currently meaning “try legacy extension path”.

3. **Legacy extension/socket path**
   - Default for most commands and fallback for provider failures.
   - CLI opens a local socket using `socket-path.cjs`.
   - Sends:
     ```json
     {
       "type": "tool_request",
       "method": "execute_tool",
       "params": { "tool": "...", "args": {} }
     }
     ```