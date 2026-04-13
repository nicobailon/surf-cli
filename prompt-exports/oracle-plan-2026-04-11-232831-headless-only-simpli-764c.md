## Final Prompt
<taskname="Headless Only Simplify"/>
<task>
Simplify `surf-cli` into a terminal-only, headless-first tool with no headed/headless env toggles. Remove extension infrastructure and toggle ceremony while preserving: (1) ChatGPT provider support, (2) Gemini provider support, and (3) web navigation/scraping capabilities. Keep CLI/host/MCP behavior coherent after the simplification.
</task>

<architecture>
- CLI routing + mode gates:
  - `native/cli.cjs` currently routes ChatGPT/Gemini through three paths: Cloak worker, Bun worker, and legacy extension/socket path.
  - Routing is controlled by env toggles (`SURF_USE_CLOAK_CHATGPT`, `SURF_USE_BUN_CHATGPT`, `SURF_USE_BUN_GEMINI`) and optional headed override (`CLOAK_HEADLESS=0` via `--continue`).
- Legacy extension stack:
  - `native/host.cjs` + `native/host-helpers.cjs` translate socket `tool_request` into extension messages and depend on extension lifecycle (`HOST_READY`, `extension_disconnected`, native messaging stdin/stdout).
  - Browser extension runtime lives in `src/` (codemap selected): service worker orchestrates tab/CDP/content-script actions, content scripts extract page structure/text, and native messaging bridge (`src/native/port-manager.ts`) connects extension to host.
  - Build/install plumbing for extension is in `manifest.json`, `vite.config.ts`, and `scripts/install-native-host.cjs` / `scripts/uninstall-native-host.cjs`.
- Headless provider runtimes:
  - ChatGPT Cloak path: `native/chatgpt-cloak-bridge.cjs` + `native/chatgpt-cloak-worker.mjs` (+ chats worker/profile auth/timeout/prompt validation helpers).
  - ChatGPT Bun path: `native/chatgpt-bun-bridge.cjs` + `native/chatgpt-bun-worker.ts` (+ worker logic/profile auth).
  - Gemini Bun path: `native/gemini-bun-bridge.cjs` + `native/gemini-bun-worker.ts` (+ common/profile auth).
  - Bun workers are already hardcoded `headless: true`; bridges/CLI still expose fallback and mode gating.
- MCP/socket boundary:
  - `native/mcp-server.cjs` sends MCP tools over local socket to host.
  - `native/socket-path.cjs` centralizes endpoint resolution/safety checks for CLI/MCP/host.
</architecture>

<selected_context>
native/cli.cjs (slices): env-gated provider routing, extension install commands, legacy socket fallback, help text that documents toggles.
native/host.cjs (slices): extension-coupled socket server and provider dispatch paths.
native/host-helpers.cjs: large tool-to-extension message mapper (core extension coupling).
native/mcp-server.cjs: MCP tool facade currently depends on socket host path.
native/socket-path.cjs: shared socket resolution/validation primitives.

native/chatgpt-cloak-bridge.cjs: sets `CLOAK_HEADLESS`/`CLOAK_HUMANIZE`, worker spawn contract.
native/chatgpt-cloak-worker.mjs (slice): Cloak worker env + launch options.
native/chatgpt-cloak-chats-worker.mjs (slices): chats/reply backend flow and fallback behavior.
native/chatgpt-cloak-timeout.cjs, native/chatgpt-cloak-prompt-validation.cjs, native/chatgpt-cloak-profile-auth.mjs, native/chatgpt-chats-formatter.cjs, native/chatgpt-chats-search.mjs: supporting ChatGPT headless runtime pieces.

native/chatgpt-bun-bridge.cjs + native/chatgpt-bun-worker.ts (slices) + native/chatgpt-bun-worker-logic.ts: Bun ChatGPT path and fallback-to-legacy semantics.
native/gemini-bun-bridge.cjs + native/gemini-bun-worker.ts (slices) + native/gemini-common.cjs: Bun Gemini path and fallback-to-legacy semantics.
native/chrome-profile-utils.cjs + native/cdp-stealth.cjs: shared auth/stealth dependencies for headless workers.

manifest.json, vite.config.ts, tsconfig.json, scripts/install-native-host.cjs, scripts/uninstall-native-host.cjs: extension packaging/install toolchain targeted for removal/rework.
README.md + package.json + vitest.config.ts: docs/scripts/deps still extension-oriented and toggle-oriented.

Tests: native/tests/cli-tests.sh, test/unit/chatgpt-bun-bridge.test.ts, test/unit/gemini-bun-bridge.test.ts, test/unit/chatgpt-cloak-bridge.test.ts, test/unit/chatgpt-cloak-timeout.test.ts, test/unit/mcp-server.test.ts, test/unit/socket-path.test.ts, test/e2e/chatgpt-cloak-local.test.ts.

src codemaps: src/service-worker/index.ts, src/content/accessibility-tree.ts, src/cdp/controller.ts, src/native/port-manager.ts, src/content/visual-indicator.ts, src/options/main.ts (extension-only architecture overview).
</selected_context>

<relationships>
- `cli.cjs` -> (Cloak bridge | Bun bridge | legacy socket path) determines actual execution backend.
- Legacy backend: `cli.cjs`/`mcp-server.cjs` -> Unix socket -> `host.cjs` -> `host-helpers.cjs` message mapping -> extension runtime (`src/service-worker/index.ts` + content scripts).
- Headless backends: `cli.cjs` -> bridge files -> worker files (Cloak/Bun) -> provider websites.
- Current compatibility behavior relies on fallback chains: Bun/Cloak failures may recommend returning to legacy extension path.
- Extension build/install docs/scripts are tightly coupled to current onboarding and command surface (`surf extension-path`, `surf install`, `surf uninstall`).
</relationships>

<ambiguities>
- Web navigation/scraping currently lives in extension service-worker/content-script architecture; if extension is removed, equivalent terminal-only runtime for these tools must be explicitly defined (backend choice and API surface).
- Scope says keep ChatGPT + Gemini + navigation/scraping; repo still contains Perplexity/Grok/AI Studio legacy paths in host slices. It is unclear whether those must be removed now or temporarily tolerated as non-goal legacy code.
- Bun path retention is intentionally open in the task; code supports both Cloak and Bun today, with different fallback/error semantics.
- MCP presently fronts socket host; removing host/extension path may require MCP re-targeting or host repurposing.
</ambiguities>

## Selection
- Files: 49 total (36 full, 6 slice, 7 codemap)
- Total tokens: 114261 (Auto view)
- Token breakdown: full 82998, slice 27577, codemap 3686

### Files
### Selected Files
├── native/
│   ├── formatters/
│   │   └── network.cjs — 3,045 tokens (full)
│   ├── tests/
│   │   └── cli-tests.sh — 2,469 tokens (full)
│   ├── cdp-stealth.cjs — 1,862 tokens (full)
│   ├── chatgpt-bun-bridge.cjs — 1,929 tokens (full)
│   ├── chatgpt-bun-worker-logic.ts — 2,815 tokens (full)
│   ├── chatgpt-bun-worker.ts — 2,848 tokens (lines 1-120 (Bun ChatGPT worker contract and hardcoded headless WebView stance; clarifies what already runs headless vs what is env-gated in CLI.), 1080-1312 (Main execution + fallbackRecommended policy currently signaling legacy extension fallback when worker errors occur.))
│   ├── chatgpt-chats-formatter.cjs — 2,192 tokens (full)
│   ├── chatgpt-chats-search.mjs — 797 tokens (full)
│   ├── chatgpt-cloak-bridge.cjs — 2,571 tokens (full)
│   ├── chatgpt-cloak-chats-worker.mjs — 4,431 tokens (lines 1-180 (Chats worker contract, profile/headless launch options, readiness/auth checks, and backend fetch wrappers.), 560-831 (Chat operations flow (get/search/delete/download) and backend fallback semantics used by chatgpt.chats CLI commands.))
│   ├── chatgpt-cloak-profile-auth.mjs — 1,910 tokens (full)
│   ├── chatgpt-cloak-prompt-validation.cjs — 1,251 tokens (full)
│   ├── chatgpt-cloak-timeout.cjs — 736 tokens (full)
│   ├── chatgpt-cloak-worker.mjs — 1,821 tokens (lines 1-170 (Worker contract and launch options including CLOAK_HEADLESS/CLOAK_HUMANIZE environment toggles; core area for headless-only normalization.))
│   ├── chrome-profile-utils.cjs — 2,497 tokens (full)
│   ├── cli.cjs — 9,575 tokens (lines 1-140 (Top-level imports and runtime dependencies show current routing split across Bun bridges, Cloak bridge, socket transport, sessions, and config.), 1600-1715 (CLI help text and command summary exposing headless env toggles and provider messaging that must be rewritten for headless-only default behavior.), 2160-2309 (extension-path/install/uninstall command handlers and native-host installer UX, central to removing extension onboarding paths.), 3580-4179 (Primary provider routing and fallback orchestration: SURF_USE_CLOAK_CHATGPT, SURF_USE_BUN_CHATGPT, SURF_USE_BUN_GEMINI gates plus legacy socket fallback and response handling.))
│   ├── config.cjs — 643 tokens (full)
│   ├── gemini-bun-bridge.cjs — 2,054 tokens (full)
│   ├── gemini-bun-worker.ts — 2,662 tokens (lines 1-120 (Bun Gemini worker protocol and runtime model showing terminal/headless operation.), 1060-1275 (Main execution and fallbackRecommended behavior that currently points back to legacy extension route on many failures.))
│   ├── gemini-common.cjs — 1,717 tokens (full)
│   ├── host-helpers.cjs — 10,699 tokens (full)
│   ├── host.cjs — 6,240 tokens (lines 1-60 (Host imports and dependency graph reveal extension-coupled provider clients and socket boundary modules.), 299-451 (Socket endpoint lifecycle and tool_request dispatch setup, including mapToolToMessage translation boundary.), 500-823 (ChatGPT/Gemini/Perplexity/Grok request paths currently executed through extension-mediated workflows; key for deciding what is removed or retained.), 1600-1781 (stdin extension channel handling and socket server startup flow showing HOST_READY and extension disconnect semantics to retire or replace.))
│   ├── mcp-server.cjs — 3,971 tokens (full)
│   ├── network-store.cjs — 5,481 tokens (full)
│   ├── session-reconciler.cjs — 3,542 tokens (full)
│   ├── session-store.cjs — 4,285 tokens (full)
│   └── socket-path.cjs — 2,143 tokens (full)
├── scripts/
│   ├── install-native-host.cjs — 2,381 tokens (full)
│   └── uninstall-native-host.cjs — 1,305 tokens (full)
├── test/
│   ├── e2e/
│   │   └── chatgpt-cloak-local.test.ts — 376 tokens (full)
│   └── unit/
│       ├── chatgpt-bun-bridge.test.ts — 1,934 tokens (full)
│       ├── chatgpt-cloak-bridge.test.ts — 3,507 tokens (full)
│       ├── chatgpt-cloak-timeout.test.ts — 1,128 tokens (full)
│       ├── gemini-bun-bridge.test.ts — 2,229 tokens (full)
│       ├── mcp-server.test.ts — 967 tokens (full)
│       └── socket-path.test.ts — 1,974 tokens (full)
├── README.md — 6,623 tokens (full)
├── manifest.json — 437 tokens (full)
├── package.json — 533 tokens (full)
├── tsconfig.json — 142 tokens (full)
├── vite.config.ts — 645 tokens (full)
└── vitest.config.ts — 208 tokens (full)

### Codemaps
├── native/
│   └── chatgpt-bun-profile-auth.ts — 233 tokens (manual)
└── src/
    ├── cdp/
    │   └── controller.ts — 2,153 tokens (manual)
    ├── content/
    │   ├── accessibility-tree.ts — 504 tokens (manual)
    │   └── visual-indicator.ts — 194 tokens (manual)
    ├── native/
    │   └── port-manager.ts — 172 tokens (manual)
    ├── options/
    │   └── main.ts — 17 tokens (manual)
    └── service-worker/
        └── index.ts — 413 tokens (manual)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `headless-only-simplify-C6E96E` | **Mode**: plan


> 💡 Continue this plan conversation with ask_oracle(chat_id: "headless-only-simplify-C6E96E", new_chat: false)