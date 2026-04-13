<file_map>
/Users/danielsivan/dev/surf-cli
├── native
│   ├── tests
│   │   └── cli-tests.sh *
│   ├── formatters
│   │   └── network.cjs
│   ├── chatgpt-bun-bridge.cjs *
│   ├── chatgpt-cloak-bridge.cjs *
│   ├── chatgpt-cloak-worker.mjs *
│   ├── cli.cjs *
│   ├── config.cjs *
│   ├── do-executor.cjs *
│   ├── do-parser.cjs *
│   ├── gemini-bun-bridge.cjs *
│   ├── gemini-common.cjs *
│   ├── headless-command-runner.cjs *
│   ├── mcp-server.cjs *
│   ├── session-reconciler.cjs *
│   ├── session-store.cjs *
│   ├── cdp-stealth.cjs
│   ├── chatgpt-bun-profile-auth.ts +
│   ├── chatgpt-bun-worker-logic.ts +
│   ├── chatgpt-bun-worker.ts +
│   ├── chatgpt-chats-cache.cjs
│   ├── chatgpt-chats-formatter.cjs
│   ├── chatgpt-chats-search.d.mts
│   ├── chatgpt-chats-search.mjs
│   ├── chatgpt-client.cjs
│   ├── chatgpt-cloak-chats-worker.mjs
│   ├── chatgpt-cloak-profile-auth.mjs
│   ├── chatgpt-cloak-prompt-entry.cjs
│   ├── chatgpt-cloak-prompt-validation.cjs
│   ├── chatgpt-cloak-timeout.cjs
│   ├── chrome-profile-utils.cjs
│   ├── device-presets.cjs
│   ├── gemini-bun-profile-auth.ts +
│   ├── gemini-bun-worker.ts +
│   └── network-store.cjs
├── skills
│   ├── surf
│   │   └── SKILL.md *
│   └── README.md *
├── test
│   ├── e2e
│   │   ├── chatgpt-cloak-local.test.ts * +
│   │   └── .gitkeep
│   ├── unit
│   │   ├── cdp
│   │   ├── formatters
│   │   │   └── network.test.ts +
│   │   ├── chatgpt-bun-bridge.test.ts * +
│   │   ├── chatgpt-cloak-bridge.test.ts * +
│   │   ├── do-executor.test.ts * +
│   │   ├── do-parser.test.ts * +
│   │   ├── gemini-bun-bridge.test.ts * +
│   │   ├── headless-command-runner.test.ts * +
│   │   ├── mcp-server.test.ts * +
│   │   ├── .gitkeep
│   │   ├── cdp-stealth.test.ts +
│   │   ├── chatgpt-bun-worker-logic.test.ts +
│   │   ├── chatgpt-chats-cache.test.ts +
│   │   ├── chatgpt-chats-formatter.test.ts +
│   │   ├── chatgpt-chats-search.test.ts +
│   │   ├── chatgpt-cloak-prompt-entry.test.ts +
│   │   ├── chatgpt-cloak-prompt-validation.test.ts +
│   │   ├── chatgpt-cloak-timeout.test.ts +
│   │   ├── chrome-profile-utils.test.ts +
│   │   ├── gemini-common.test.ts +
│   │   ├── session-reconciler.test.ts +
│   │   └── session-store.test.ts +
│   ├── integration
│   │   └── .gitkeep
│   ├── mocks
│   └── network-capture.test.cjs
├── .claude
│   └── skills
│       └── surf-codebase
│           └── SKILL.md
├── .github
│   ├── workflows
│   │   ├── ci.yml
│   │   ├── codeql.yml
│   │   └── gitleaks.yml
│   └── dependabot.yml
├── docs
│   ├── investigations
│   │   ├── chatgpt-prosemirror-bypass.md
│   │   ├── orchestrate-pro-surf-oracle-flow.md
│   │   ├── rp-surf-oracle-missing-reply-recovery.md
│   │   └── surf-chats-profile-lock.md
│   ├── chatgpt-headless-investigation.md
│   ├── cloakbrowser-integration-plan.md
│   ├── investigation-chatgpt-chats-feature.md
│   ├── investigation-chatgpt-thinking-trace.md
│   ├── investigation-cloak-capture-bug.md
│   ├── investigation-gemini-file-upload.md
│   └── investigation-thinking-sidebar-trace.md
├── prompt-exports
│   ├── oracle-plan-2026-04-10-183937-socket-hardening-pla-146e.md
│   ├── oracle-plan-2026-04-11-230117-orchestrate-cloakbro-a1a7.md
│   ├── oracle-plan-2026-04-11-230414-orchestrate-cloakbro-7c58.md
│   ├── oracle-plan-2026-04-11-232831-headless-only-simpli-764c.md
│   ├── oracle-plan-2026-04-11-233149-headless-only-simpli-0fc3.md
│   ├── oracle-plan-2026-04-11-233446-headless-only-simpli-cef6.md
│   ├── oracle-plan-2026-04-12-005501-embed-skill-doc-210f-2984.md
│   └── oracle-review-2026-04-12-064859-headless-refactor-re-2cfa.md
├── README.md *
├── package.json *
├── tsconfig.json *
├── vitest.config.ts * +
├── .gitignore
├── .npmignore
├── AGENTS.md
├── CHANGELOG.md
├── LICENSE
├── biome.json
├── package-lock.json
└── surf-banner.png


(* denotes selected files)
(+ denotes code-map available)

File: /Users/danielsivan/dev/surf-cli/native/chatgpt-bun-worker.ts
Imports:
---
Classes:
  - Progress
    Methods:
      - L91: constructor(steps: string[])
      - L96: step(detail?: string)
      - L106: done(detail: string)
    Properties:
      - private current
      - private total: number
      - private startMs
      - private steps: string[]

Interfaces:
  - WorkerRequest
    Properties:
      - prompt: string
      - model?: string
      - file?: string | null
      - generateImage?: string | null
      - timeoutMs?: number
      - profileEmail?: string | null
  - WorkerResult
    Properties:
      - response: string
      - model: string
      - tookMs: number
      - imagePath: string | null
      - messageId: string | null
      - partial: boolean
  - WorkerResponse
    Properties:
      - ok: true
      - result: WorkerResult
  - WorkerError
    Properties:
      - ok: false
      - code: string
      - error: string
  - ImageCandidate
    Properties:
      - source: string
      - kind: "img" | "link"
      - width: number
      - height: number
      - fingerprint: string
      - isDisplayImage: boolean
  - PollState
    Properties:
      - text: string
      - imageCandidates: ImageCandidate[]
      - isStreaming: boolean
      - isThinking: boolean
      - thinkingLabel: string
      - assistantTurnCount: number
      - latestAssistantTurnId: string | null
      - messageId: string | null
      - finished: boolean

Type-aliases:
  - WebView

Functions:
  - L81: function log(msg: string)
  - L118: function delay(ms: number): Promise<void>
  - L122: async function pollUntil<T>( fn: () => Promise<T>, check: (val: T) => boolean, intervalMs: number, timeoutMs: number, label: string, ): Promise<T>
  - L140: async function pageEval(wv: WebView, js: string): Promise<any>
  - L152: async function waitForReady(wv: WebView, timeoutMs: number)
  - L172: async function isCloudflareBlocked(wv: WebView): Promise<boolean>
  - L182: async function checkLoginStatus(wv: WebView): Promise<{ loggedIn: boolean; hasLoginCta: boolean }>
  - L204: async function focusEditor(wv: WebView)
  - L221: async function readEditorContent(wv: WebView): Promise<string>
  - L235: async function waitForSendButton(wv: WebView, timeoutMs = 5000)
  - L258: async function clickSend(wv: WebView): Promise<string>
  - L296: async function trySelectModel(wv: WebView, model: string): Promise<void>
  - L397: async function uploadFileViaCDP( wv: WebView, filePath: string, timeoutMs: number, ): Promise<void>
  - L485: async function activateImageTool(wv: WebView, timeoutMs = 5000): Promise<void>
  - L538: async function injectFetchStreamCapture(wv: WebView): Promise<void>
  - L631: async function readStreamResponse(wv: WebView): Promise<{ text: string; done: boolean; messageId: string | null; model: string | null }>
  - L660: async function pollResponseState(wv: WebView): Promise<PollState>
  - L793: function newCandidates(state: PollState, baseline: PollState): ImageCandidate[]
  - L798: async function waitForResponse( wv: WebView, baseline: PollState, timeoutMs: number, expectsImage: boolean, ): Promise<{ text: string; imageCandidates: ImageCandidate[]; messageId: string | null; partial: boolean }>
  - L938: async function saveGeneratedImage( wv: WebView, candidates: ImageCandidate[], outputPath: string, ): Promise<void>
  - L1060: async function main()

Global vars:
  - CHATGPT_URL
  - SEL
  - CLICK_DISPATCH_JS

Exports:
  - export {};
---


File: /Users/danielsivan/dev/surf-cli/native/gemini-bun-worker.ts
Imports:
---
Classes:
  - Progress
    Methods:
      - L76: constructor(steps: string[])
      - L82: step(detail?: string)
      - L92: done(detail: string)
    Properties:
      - private current
      - private total: number
      - private startMs
      - private steps: string[]

Interfaces:
  - WorkerRequest
    Properties:
      - prompt: string
      - model?: string
      - file?: string | null
      - generateImage?: string | null
      - editImage?: string | null
      - output?: string | null
      - youtube?: string | null
      - aspectRatio?: string | null
      - timeoutMs?: number
      - profileEmail?: string | null
  - WorkerResult
    Properties:
      - response: string
      - model: string
      - tookMs: number
      - imagePath: string | null
      - imageCount: number
      - thoughts: string | null
  - WorkerResponse
    Properties:
      - ok: true
      - result: WorkerResult
  - WorkerError
    Properties:
      - ok: false
      - code: string
      - error: string
  - ImageCandidate
    Properties:
      - source: string
      - kind: "img" | "source" | "link"
      - width: number
      - height: number
      - fingerprint: string
      - isDisplayImage: boolean
  - PollState
    Properties:
      - text: string
      - imageCandidates: ImageCandidate[]
      - loading: boolean
      - turnCount: number
      - latestTurnKey: string

Type-aliases:
  - WebView

Functions:
  - L66: function log(msg: string)
  - L104: function delay(ms: number): Promise<void>
  - L108: async function pollUntil<T>( fn: () => Promise<T>, check: (val: T) => boolean, intervalMs: number, timeoutMs: number, label: string, ): Promise<T>
  - L135: async function pageEval(wv: WebView, js: string): Promise<any>
  - L144: async function waitForReady(wv: WebView, timeoutMs: number)
  - L166: async function focusEditor(wv: WebView)
  - L179: async function readEditorContent(wv: WebView): Promise<string>
  - L189: async function clickSend(wv: WebView): Promise<string>
  - L209: async function waitForSendButton(wv: WebView, timeoutMs = 3000)
  - L251: async function pollResponseState(wv: WebView): Promise<PollState>
  - L339: function isImagePlaceholderText(text: string): boolean
  - L343: function newDisplayCandidates(state: PollState, baseline: PollState): ImageCandidate[]
  - L348: async function waitForResponse( wv: WebView, baseline: PollState, timeoutMs: number, expectsImage: boolean, ): Promise<{ text: string; imageCandidates: ImageCandidate[] }>
  - L430: async function uploadFileViaCDP( wv: WebView, filePath: string, timeoutMs: number, )
  - L597: async function waitForUploadChip(wv: WebView, timeoutMs: number)
  - L622: async function saveGeneratedImage( wv: WebView, candidates: ImageCandidate[], outputPath: string, )
  - L756: async function activateCreateImageTool(wv: WebView, timeoutMs = 5000): Promise<void>
  - L938: function modelToModeKeywords(model: string): string[]
  - L948: async function trySelectModel(wv: WebView, model: string)
  - L1025: async function main()

Global vars:
  - IMAGE_GENERATING_PATTERNS
  - MODEL_TO_MODE_KEYWORDS: Record<string, string[]>

Exports:
  - export {};
---

</file_map>
<file_contents>
File: /Users/danielsivan/dev/surf-cli/native/cli.cjs
(lines 1-220: Top-level imports, embedded SURF_SKILL_DOC constant, prompt-file loader, and workflow helpers that inform headless-only behavior and skill embedding.)
```cjs
#!/usr/bin/env node
const net = require("net");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");
const { loadConfig, getConfigPath, createStarterConfig } = require("./config.cjs");
const networkFormatters = require("./formatters/network.cjs");
const networkStore = require("./network-store.cjs");
const { parseDoCommands } = require("./do-parser.cjs");
const { executeDoSteps } = require("./do-executor.cjs");
const { isBunGeminiEligible, runGeminiViaBun } = require("./gemini-bun-bridge.cjs");
const { shouldUseBunChatGPT, isBunChatGPTEligible, runChatGPTViaBun } = require("./chatgpt-bun-bridge.cjs");
const { isCloakBrowserAvailable, queryWithCloakBrowser, manageChatsWithCloakBrowser } = require("./chatgpt-cloak-bridge.cjs");
const chatgptChatsFormatter = require("./chatgpt-chats-formatter.cjs");
const chatgptChatsCache = require("./chatgpt-chats-cache.cjs");
const sessionStore     = require("./session-store.cjs");
const sessionReconciler = require("./session-reconciler.cjs");
const { version: VERSION } = require("../package.json");

const IS_WIN = process.platform === "win32";
const SURF_TMP = IS_WIN ? path.join(os.tmpdir(), "surf") : "/tmp";
const SOCKET_PATH = IS_WIN ? "//./pipe/surf" : "/tmp/surf.sock";
if (IS_WIN) { try { fs.mkdirSync(SURF_TMP, { recursive: true }); } catch {} }

const SURF_SKILL_BT = "`";
const SURF_SKILL_DOC = String.raw`---
name: surf
description: Run the headless-only surf CLI for ChatGPT and Gemini terminal workflows.
---

# Surf

Headless terminal AI via local signed-in browser profiles.
Prefer real CLI execution over guessed provider APIs.

Repo + local CLI verified against **surf-cli v2.11.1**.

## Use when

- ChatGPT prompts, file review, prompt-file runs, image generation
- Gemini prompts, file/video analysis, image generation/editing
- ChatGPT conversation list/search/view/export/reply/manage flows
- Long-running browser-session AI from shell, tmux, or agent workflows

## Defaults

- Headless-only CLI.
- ChatGPT uses CloakBrowser headless by default.
- Gemini uses Bun WebView headless by default.
- Default profile on macOS: ${SURF_SKILL_BT}dsebban883@gmail.com${SURF_SKILL_BT} unless the user asks for another account.
- Use ${SURF_SKILL_BT}--profile dsebban883@gmail.com${SURF_SKILL_BT} for reliable auth and file/image/chats features.

## Sanity check

${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}bash
surf --version
surf --help
surf chatgpt.chats --limit 1 --profile dsebban883@gmail.com
${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}

## ChatGPT

${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}bash
surf chatgpt "explain this code" --profile dsebban883@gmail.com
surf chatgpt "review this PR" --file diff.patch --profile dsebban883@gmail.com
surf chatgpt --prompt-file prompt.md --model gpt-5.4-pro --profile dsebban883@gmail.com
surf chatgpt "a robot surfing" --generate-image /tmp/robot.png --profile dsebban883@gmail.com
surf chatgpt "deep analysis" --model gpt-5.4-pro --profile dsebban883@gmail.com
${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}

${SURF_SKILL_BT}--prompt-file${SURF_SKILL_BT} reads the file as prompt text. Use it for large exported contexts. ${SURF_SKILL_BT}--file${SURF_SKILL_BT} uploads as an attachment.

### ChatGPT model aliases

- ${SURF_SKILL_BT}instant${SURF_SKILL_BT}, ${SURF_SKILL_BT}gpt-5.3${SURF_SKILL_BT}, ${SURF_SKILL_BT}gpt-4o${SURF_SKILL_BT}, ${SURF_SKILL_BT}gpt-4.1${SURF_SKILL_BT}, ${SURF_SKILL_BT}gpt-4.1-mini${SURF_SKILL_BT} → GPT-5.3 Instant
- ${SURF_SKILL_BT}thinking${SURF_SKILL_BT}, ${SURF_SKILL_BT}gpt-5.4-thinking${SURF_SKILL_BT}, ${SURF_SKILL_BT}o3${SURF_SKILL_BT}, ${SURF_SKILL_BT}o4-mini${SURF_SKILL_BT} → GPT-5.4 Thinking
- ${SURF_SKILL_BT}pro${SURF_SKILL_BT}, ${SURF_SKILL_BT}gpt-5.4-pro${SURF_SKILL_BT}, ${SURF_SKILL_BT}chatgpt-pro${SURF_SKILL_BT}, ${SURF_SKILL_BT}o1-pro${SURF_SKILL_BT} → GPT-5.4 Pro

## ChatGPT conversations

${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}bash
surf chatgpt.chats --limit 20 --profile dsebban883@gmail.com
surf chatgpt.chats --search "auth system" --profile dsebban883@gmail.com
surf chatgpt.chats <conversation-id> --profile dsebban883@gmail.com
surf chatgpt.chats <conversation-id> --export /tmp/chat.md --profile dsebban883@gmail.com
surf chatgpt.chats <conversation-id> --export /tmp/chat.json --format json --json --profile dsebban883@gmail.com
surf chatgpt.reply <conversation-id> "follow-up" --profile dsebban883@gmail.com
surf chatgpt.reply <conversation-id> --prompt-file followup.md --model gpt-5.4-thinking --profile dsebban883@gmail.com
surf chatgpt.chats <conversation-id> --rename "New Title" --profile dsebban883@gmail.com
surf chatgpt.chats <conversation-id> --delete --profile dsebban883@gmail.com
surf chatgpt.chats <conversation-id> --download-file <file-id> --output /tmp/file.txt --profile dsebban883@gmail.com
${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}

Notes:
- ${SURF_SKILL_BT}--delete${SURF_SKILL_BT} is destructive; no CLI undo.
- Search may use a recent-history fallback; if JSON shows ${SURF_SKILL_BT}partial: true${SURF_SKILL_BT}, misses are not authoritative for older chats.
- ${SURF_SKILL_BT}--download-file${SURF_SKILL_BT} needs ${SURF_SKILL_BT}--output${SURF_SKILL_BT}.

## ChatGPT thinking trace

Pro/Thinking models stream live thinking content via ${SURF_SKILL_BT}🧠${SURF_SKILL_BT} lines.

${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}bash
surf chatgpt "complex problem" --model gpt-5.4-pro --profile dsebban883@gmail.com
${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}

## Gemini

${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}bash
surf gemini "explain quantum computing" --profile dsebban883@gmail.com
surf gemini "analyze this chart" --file chart.jpg --profile dsebban883@gmail.com
surf gemini "reason about this architecture" --model thinking --profile dsebban883@gmail.com
surf gemini "advanced math problem" --model pro --profile dsebban883@gmail.com
surf gemini "a robot surfing" --generate-image /tmp/robot.png --profile dsebban883@gmail.com
surf gemini "wide banner" --generate-image /tmp/banner.png --aspect-ratio 16:9 --profile dsebban883@gmail.com
surf gemini "add sunglasses" --edit-image photo.jpg --output out.jpg --profile dsebban883@gmail.com
${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}

### Gemini model notes

Gemini 3 tiers (use ${SURF_SKILL_BT}--model <alias>${SURF_SKILL_BT}):

- **Fast** (default): ${SURF_SKILL_BT}gemini-3-pro${SURF_SKILL_BT}, ${SURF_SKILL_BT}fast${SURF_SKILL_BT}, ${SURF_SKILL_BT}gemini-2.5-flash${SURF_SKILL_BT}
- **Thinking**: ${SURF_SKILL_BT}thinking${SURF_SKILL_BT}, ${SURF_SKILL_BT}gemini-2.5-pro${SURF_SKILL_BT}, ${SURF_SKILL_BT}gemini-3.1-thinking${SURF_SKILL_BT}
- **Pro** (3.1 Pro): ${SURF_SKILL_BT}pro${SURF_SKILL_BT}, ${SURF_SKILL_BT}gemini-3.1-pro-preview${SURF_SKILL_BT}, ${SURF_SKILL_BT}gemini-3.1-pro${SURF_SKILL_BT}

Unknown model names are passed through to the UI picker best-effort.

## Workflows

${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}bash
surf do 'chatgpt "Draft release notes" --profile dsebban883@gmail.com | gemini "Make it concise" --profile dsebban883@gmail.com'
surf do 'chatgpt "Review this" --file diff.patch --profile dsebban883@gmail.com' --dry-run
${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}

## Sessions & reconciliation

Every surf AI command creates a session in ${SURF_SKILL_BT}~/.surf/sessions/${SURF_SKILL_BT}.

${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}bash
surf session
surf session <id>
surf session --reconcile
surf session --reconcile --network
${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}

For long runs, use tmux:

${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}bash
tmux new -d -s surf-chat "bash -lc 'surf chatgpt \"complex analysis\" --model gpt-5.4-pro --profile dsebban883@gmail.com --timeout 3000 2>&1 | tee /tmp/surf-chatgpt.log'"
tail -f /tmp/surf-chatgpt.log
${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}

## Troubleshooting

- ${SURF_SKILL_BT}--profile${SURF_SKILL_BT} is macOS-only.
- ${SURF_SKILL_BT}--with-page${SURF_SKILL_BT} is not supported.
- Page-context/browser-extension commands were removed.
- Default ChatGPT timeout: **2700s**.
- If auth fails, sign in with the same local profile and retry.
- Use ${SURF_SKILL_BT}surf session <id>${SURF_SKILL_BT} to inspect stderr/result details.
`;

/**
 * Read a prompt file and return its content. Exits on error/empty.
 * Logs file size to stderr.
 * @param {string} rawPath - the --prompt-file argument value
 * @returns {string} prompt content
 */
function loadPromptFile(rawPath) {
  const resolved = path.resolve(rawPath);
  let content;
  try {
    content = fs.readFileSync(resolved, "utf-8");
  } catch (e) {
    console.error(`Error: Failed to read prompt file: ${e.message}`);
    process.exit(1);
  }
  if (!content.trim()) {
    console.error(`Error: prompt file is empty: ${resolved}`);
    process.exit(1);
  }
  const sizeKB = (Buffer.byteLength(content, "utf-8") / 1024).toFixed(1);
  const lines = content.split("\n").length;
  const estTokens = Math.ceil(content.length / 4);
  const tokenKStr = (estTokens / 1000).toFixed(1) + "K";
  console.error(`[prompt-file] Read ${sizeKB}KB (${lines} lines, ~${tokenKStr} tokens) from ${resolved}`);
  if (estTokens > 120_000) {
    console.error(`[prompt-file] ⚠ ~${tokenKStr} tokens — approaching GPT Pro 150K limit`);
  }
  return content;
}

// ============================================================================
// Workflow Resolution and Management
// ============================================================================

/**
 * Get workflow search directories
 * @returns {Array<{path: string, scope: string}>}
 */
function getWorkflowDirs() {
  return [
    { path: path.join(process.cwd(), '.surf', 'workflows'), scope: 'project' },
    { path: path.join(os.homedir(), '.surf', 'workflows'), scope: 'user' },
  ];
}

/**
 * Resolve a workflow by name or path
 * @param {string} nameOrPath - Workflow name or file path
 * @returns {{ type: 'inline'|'file'|'not_found', content?: string, path?: string, name?: string }}
 */
function resolveWorkflow(nameOrPath) {
  // Check if it's an inline workflow (contains pipe)
  if (nameOrPath.includes('|')) {
    return { type: 'inline', content: nameOrPath };
  }
  

```

(lines 480-700: Command aliasing/removal map and TOOLS metadata showing potential stale help/options references after headless-only refactor.)
```cjs
  net: "network",
  "network.dump": "network.get",
};

const REMOVED_COMMANDS = {
  read_page: "page.read",
  get_page_text: "page.text",
  page_state: "page.state",
  list_tabs: "tab.list",
  new_tab: "tab.new",
  switch_tab: "tab.switch",
  close_tab: "tab.close",
  scroll_to: "scroll.to",
  scroll_to_position: "scroll.to",
  get_scroll_info: "scroll.info",
  wait_for_element: "wait.element",
  wait_for_url: "wait.url",
  wait_for_network_idle: "wait.network",
  javascript_tool: "js",
  read_console_messages: "console",
  read_network_requests: "network",
  tabs_context: "tab.list",
  tabs_create: "tab.new",
  tabs_register: "tab.name",
  tabs_unregister: "tab.unname",
  tabs_get_by_name: "tab.switch",
  tabs_list_named: "tab.named",
  upload_image: "upload",
  resize_window: "resize",
  type_submit: "type --submit",
  left_click: "click",
  right_click: "click --button right",
  double_click: "click --button double",
  triple_click: "click --button triple",
  left_click_drag: "drag",
};

const TOOLS = {
  ai: {
    desc: "AI assistants (ChatGPT, Gemini)",
    commands: {
      "chatgpt": { 
        desc: "Send prompt to ChatGPT (uses browser cookies)", 
        args: ["query"], 
        opts: { 
          "with-page": "Include current page context",
          model: "Model: gpt-4o, o3, o4-mini, etc.",
          file: "Attach file",
          "generate-image": "Generate image and save to path",
          timeout: "Inactivity timeout in seconds (default: 2700 = 45min)",
          profile: "Chrome profile email for headless auth (macOS)"
        },
        examples: [
          { cmd: 'chatgpt "explain this code"', desc: "Basic query" },
          { cmd: 'chatgpt "summarize" --with-page', desc: "With page context" },
          { cmd: 'chatgpt "review" --file code.ts', desc: "With file (headless)" },
          { cmd: 'chatgpt --prompt-file prompt.md --model gpt-5.4-pro', desc: "Prompt from file (large context)" },
          { cmd: 'chatgpt "analyze" --model gpt-4o', desc: "Specify model" },
          { cmd: 'chatgpt "robot surfing" --generate-image /tmp/robot.png', desc: "Generate image (headless)" },
          { cmd: 'chatgpt "hello" --profile me@gmail.com', desc: "Use Chrome profile (headless)" },
        ]
      },
      "chatgpt.chats": {
        desc: "List, search, view, and export ChatGPT conversations (Cloak only)",
        args: ["conversation_id"],
        opts: {
          limit: "List count or last N visible messages when viewing",
          all: "Fetch all conversations",
          search: "Search conversations by query",
          export: "Export viewed conversation to file",
          format: "Export format: markdown|json",
          rename: "Rename a conversation by ID",
          delete: "Delete a conversation by ID",
          "delete-ids": "Bulk-delete conversations by comma-separated IDs",
          "download-file": "Download attached file by file ID (use with --output)",
          continue: "Run in headed CloakBrowser (sets CLOAK_HEADLESS=0 for this command)",
          "no-cache": "Bypass local chats cache",
          timeout: "Timeout in seconds (default: 120)",
          profile: "Chrome profile email for headless auth (macOS)",
        },
        examples: [
          { cmd: "chatgpt.chats", desc: "List recent conversations" },
          { cmd: 'chatgpt.chats --search "auth system"', desc: "Search conversations" },
          { cmd: "chatgpt.chats <conversation-id>", desc: "View conversation" },
          { cmd: "chatgpt.chats <conversation-id> --export /tmp/chat.md", desc: "Export markdown" },
          { cmd: 'chatgpt.chats <conversation-id> --rename "New Title"', desc: "Rename conversation" },
        ],
      },
      "chatgpt.reply": {
        desc: "Reply inside an existing ChatGPT conversation (Cloak only)",
        args: ["conversation_id", "prompt"],
        opts: {
          model: "Model override (optional)",
          continue: "Run in headed CloakBrowser (sets CLOAK_HEADLESS=0 for this command)",
          timeout: "Inactivity timeout in seconds (default: 2700 = 45min)",
          profile: "Chrome profile email for headless auth (macOS)",
        },
        examples: [
          { cmd: 'chatgpt.reply <conversation-id> "follow-up question"', desc: "Reply in-thread" },
          { cmd: 'chatgpt.reply <conversation-id> "follow-up" --model gpt-5.4-thinking', desc: "Reply with model override" },
        ],
      },
      "gemini": { 
        desc: "Send prompt to Gemini (uses browser cookies)", 
        args: ["query"], 
        opts: { 
          "with-page": "Include current page context",
          model: "Model tiers: Fast (gemini-3-pro/default, fast, gemini-2.5-flash), Thinking (gemini-2.5-pro, thinking, gemini-3.1-thinking), Pro (gemini-3.1-pro-preview, pro, gemini-3.1-pro)",
          file: "Attach file to analyze",
          "generate-image": "Generate image and save to path",
          "edit-image": "Edit existing image (use with --output)",
          output: "Output file path for image operations",
          youtube: "YouTube video URL to analyze",
          "aspect-ratio": "Aspect ratio for image generation (e.g., 1:1, 16:9)",
          timeout: "Timeout in seconds (default: 300)",
          profile: "Chrome profile email for Bun headless auth (macOS, requires SURF_USE_BUN_GEMINI=1)"
        },
        examples: [
          { cmd: 'gemini "explain quantum computing"', desc: "Basic query" },
          { cmd: 'gemini "summarize" --with-page', desc: "With page context" },
          { cmd: 'gemini "analyze" --file data.csv', desc: "With file attachment" },
          { cmd: 'gemini "a robot surfing" --generate-image /tmp/robot.png', desc: "Generate image" },
          { cmd: 'gemini "add sunglasses" --edit-image photo.jpg --output out.jpg', desc: "Edit image" },
          { cmd: 'gemini "summarize this video" --youtube "https://youtube.com/..."', desc: "YouTube analysis" },
          { cmd: 'gemini "summarize" --profile dsebban883@gmail.com', desc: "Use specific Chrome profile (Bun)" },
        ]
      },
      "perplexity": {
        desc: "Search with Perplexity AI (uses browser session)",
        args: ["query"],
        opts: {
          "with-page": "Include current page context",
          mode: "Mode: search (default), research",
          model: "Model (Pro users): sonar, gpt-4o, claude, etc.",
          timeout: "Timeout in seconds (default: 120)"
        },
        examples: [
          { cmd: 'perplexity "what is quantum computing"', desc: "Basic search" },
          { cmd: 'perplexity "explain this page" --with-page', desc: "With page context" },
          { cmd: 'perplexity "deep dive into transformers" --mode research', desc: "Research mode" },
          { cmd: 'perplexity "latest AI news" --model sonar', desc: "Specify model (Pro)" },
        ]
      },
      "grok": {
        desc: "Query Grok AI with real-time X/Twitter data access (uses browser session)",
        args: ["query"],
        opts: {
          "with-page": "Include current page context",
          model: "Model: auto, fast, expert, thinking (default)",
          "deep-search": "Enable DeepSearch for X post searching",
          timeout: "Timeout in seconds (default: 300 for thinking models)",
          validate: "Check Grok UI and scrape available models (no query sent)",
          "save-models": "Save discovered models to surf.json config"
        },
        examples: [
          { cmd: 'grok "what are the latest AI agent trends on X"', desc: "Search X posts" },
          { cmd: 'grok "analyze @username recent activity"', desc: "Profile analysis" },
          { cmd: 'grok "summarize this page" --with-page', desc: "With page context" },
          { cmd: 'grok "find viral AI posts" --deep-search', desc: "DeepSearch mode" },
          { cmd: 'grok "quick question" --model fast', desc: "Faster model" },
          { cmd: 'grok --validate', desc: "Check UI and list available models" },
          { cmd: 'grok --validate --save-models', desc: "Save discovered models to settings" },
        ]
      },
      "aistudio": {
        desc: "Query via Google AI Studio (uses browser session)",
        args: ["query"],
        opts: {
          "with-page": "Include current page context",
          model: "Model (best-effort): pass an AI Studio model id like gemini-3.1-pro-preview, gemini-3-flash-preview, gemini-flash-lite-latest. If invalid, AI Studio uses the last-selected UI model",
          timeout: "Timeout in seconds (default: 300)"
        },
        examples: [
          { cmd: 'aistudio "explain quantum computing"', desc: "Basic query" },
          { cmd: 'aistudio "redteam this" --with-page', desc: "With page context" },
          { cmd: 'aistudio "quick answer" --model gemini-3-flash-preview', desc: "Model selection" },
        ]
      },
      "aistudio.build": {
        desc: "Build an app via Google AI Studio App Builder (uses browser session)",
        args: ["query"],
        opts: {
          model: "Model override for Advanced Settings (e.g. gemini-3.1-pro-preview)",
          output: "Directory to extract the downloaded zip",
          timeout: "Build timeout in seconds (default: 600)",
          "keep-open": "Keep the AI Studio tab open after completion",
        },
        examples: [
          { cmd: 'aistudio.build "build a portfolio site"', desc: "Build with defaults" },
          { cmd: 'aistudio.build "todo app with auth" --model gemini-3.1-pro-preview', desc: "Build with model override" },
          { cmd: 'aistudio.build "crm dashboard" --output ./out', desc: "Build and extract to directory" },
        ]
      },
      "ai": { 
        desc: "Analyze page with AI (requires GOOGLE_API_KEY)", 
        args: ["query"], 
        opts: { mode: "Query mode: find|summary|extract (auto-detected)" },
        examples: [
          { cmd: 'ai "find the login button"', desc: "Find element" },
          { cmd: 'ai "summarize this page"', desc: "Get summary" },
          { cmd: 'ai "extract all links as json"', desc: "Extract data" },
        ]
      },
    }
  },
  tab: {
    desc: "Tab management",
    commands: {
      "tab.list": { desc: "List all open tabs", args: [], examples: [{ cmd: "tab.list", desc: "Show all tabs" }] },
      "tab.new": { 
        desc: "Open new tab", 
        args: ["url"], 
        opts: { urls: "Open multiple URLs" },
        examples: [
          { cmd: 'tab.new "https://google.com"', desc: "Open single tab" },
          { cmd: 'tab.new --urls "https://a.com" "https://b.com"', desc: "Open multiple" },
        ]
      },
      "tab.switch": { 
        desc: "Switch to tab by ID or name", 
        args: ["id"],

```

(lines 1660-2420: Headless help surfaces, command list, skills command output, session command handling, and remaining install/extension command branches for stale/dead-code review.)
```cjs
  page.read --no-text           # Skip visible text section`
  },
};

const ALL_SOCKET_TOOLS = [
  "ai", "screenshot", "navigate",
  "form_input", "find_and_type", "autocomplete", "set_value", "smart_type",
  "scroll_to_position", "get_scroll_info", "close_dialogs", "page_state",
  "javascript_tool", "health", "smoke",
  "click_type", "click_type_submit", "type", "key", "type_submit",
  "scroll", "scroll_to", "hover", "left_click_drag", "drag", "wait",
  "computer",
  "page.read", "page.text", "page.state",
  "locate.role", "locate.text", "locate.label",
  "tab.list", "tab.new", "tab.switch", "tab.close", "tab.name", "tab.unname", "tab.named",
  "tab.group", "tab.ungroup", "tab.groups", "tab.reload",
  "scroll.top", "scroll.bottom", "scroll.to", "scroll.info",
  "wait.element", "wait.network", "wait.url", "wait.dom", "wait.load",
  "click", "hover", "drag",
  "js", "console", "network", 
  "network.get", "network.body", "network.curl", "network.origins", 
  "network.clear", "network.stats", "network.export", "network.path",
  "dialog.accept", "dialog.dismiss", "dialog.info",
  "emulate.network", "emulate.cpu", "emulate.geo", "emulate.device", "emulate.viewport", "emulate.touch",
  "form.fill",
  "perf.start", "perf.stop", "perf.metrics",
  "upload",
  "frame.list", "frame.switch", "frame.main", "frame.js",
  "cookie.list", "cookie.get", "cookie.set", "cookie.clear",
  "search", "batch",
  "zoom", "resize",
  "back", "forward",
  "bookmark.add", "bookmark.remove", "bookmark.list",
  "history.list", "history.search",
  "window.new", "window.list", "window.focus", "window.close", "window.resize",
];

// See also suggestions for related commands
const SEE_ALSO = {
  "click": ["locate.role", "locate.text", "page.read"],
  "type": ["locate.label", "form.fill", "smart_type"],
  "page.read": ["--depth for smaller output", "--compact to skip empty containers", "page.text"],
  "locate.role": ["locate.text", "locate.label", "click --selector"],
  "locate.text": ["locate.role", "locate.label", "search"],
  "locate.label": ["locate.role", "form.fill"],
  "tab.list": ["window.list"],
  "tab.new": ["window.new for isolation"],
  "window.new": ["window.list"],
  "window.list": ["tab.list"],
  "frame.list": ["frame.switch", "frame.main"],
  "frame.switch": ["frame.list", "frame.main", "frame.js"],
  "frame.main": ["frame.list", "frame.switch"],
  "frame.js": ["frame.switch", "js"],
  "emulate.network": ["emulate.device", "emulate.cpu"],
  "emulate.device": ["emulate.viewport", "emulate.touch"],
  "emulate.viewport": ["emulate.device", "emulate.touch"],
  "emulate.touch": ["emulate.device", "emulate.viewport"],
  "emulate.cpu": ["emulate.network", "perf.metrics"],
  "perf.start": ["perf.stop", "perf.metrics"],
  "perf.stop": ["perf.start", "perf.metrics"],
  "perf.metrics": ["perf.start", "console", "network"],
  "navigate": ["wait.load", "page.read"],
  "screenshot": ["page.read", "scroll.bottom for fullpage"],
  "search": ["locate.text", "page.read"],
  "wait.element": ["wait.load", "wait.network"],
  "wait.load": ["wait.element", "wait.network"],
  "wait.network": ["wait.load", "wait.element"],
  "scroll.to": ["click", "page.read"],
  "console": ["network", "perf.metrics"],
  "network": ["console", "network.get"],
};

const HEADLESS_COMMAND_HELP = {
  chatgpt: "Send prompt to ChatGPT",
  "chatgpt.chats": "Search conversations",
  "chatgpt.reply": "Reply in-thread",
  gemini: "Send prompt to Gemini",
  session: "Inspect and reconcile AI sessions",
  do: "Execute multiple commands",
  server: "Start MCP server",
  skills: "Print the full agent skill reference",
};

const HEADLESS_COMMAND_LIST = [
  "chatgpt",
  "chatgpt.chats",
  "chatgpt.reply",
  "gemini",
  "session",
  "do",
  "server",
  "skills",
];

const showBasicHelp = () => {
  console.log(`surf v${VERSION} - Headless terminal AI CLI

Usage: surf <command> [args] [options]

AI Commands (headless-only):
  chatgpt <query>                Send prompt to ChatGPT
  chatgpt.chats [conversation_id] List/search/view conversations
  chatgpt.reply <conversation_id> <prompt> Reply inside a conversation
  gemini <query>                 Send prompt to Gemini

Workflow + Session:
  do <commands>                  Execute multiple commands as a workflow
  session                        List recent AI sessions
  session <id>                   View session log
  session --reconcile            Reconcile orphaned sessions

Platform:
  server                         Start MCP server
  skills                         Print the embedded skill reference

Quick Examples:
  surf chatgpt "review this PR" --file diff.patch --profile user@gmail.com
  surf gemini "analyze this chart" --file chart.jpg --model gemini-3-pro --profile user@gmail.com
  surf do 'chatgpt "Draft" --profile user@gmail.com | gemini "Tighten" --profile user@gmail.com'

More Help:
  surf --help-full           All headless commands
  surf <command> --help      Command details
  surf --find <query>        Search supported commands
`);
};

const showFullHelp = () => {
  console.log(`surf v${VERSION} - Headless terminal AI CLI

Usage: surf <command> [args] [options]

AI - AI assistants (headless-only)
  chatgpt <query>               Send prompt to ChatGPT
  chatgpt.chats <conversation_id> Search conversations
  chatgpt.reply <conversation_id> <prompt> Reply in-thread
  gemini <query>                Send prompt to Gemini

WORKFLOW
  do <commands>                 Execute multiple commands

SESSIONS
  session                       List/review/reconcile sessions

MCP
  server                        Start MCP server

DOCS
  skills                        Print embedded skill reference
`);
};

const showHelpTopic = (topic) => {
  const t = HELP_TOPICS[topic];
  if (!t) {
    console.error(`Unknown topic: ${topic}`);
    console.error(`Available topics: ${Object.keys(HELP_TOPICS).join(", ")}`);
    process.exit(1);
  }
  console.log(`\n${t.title}\n${"=".repeat(t.title.length)}\n\n${t.content}\n`);
};

const showGroupHelp = (groupName) => {
  const group = TOOLS[groupName];
  if (!group) {
    console.error(`Unknown group: ${groupName}`);
    console.error(`Available groups: ${Object.keys(TOOLS).join(", ")}`);
    process.exit(1);
  }
  console.log(`\n${groupName} - ${group.desc}\n`);
  for (const [cmd, info] of Object.entries(group.commands)) {
    if (info.alias) {
      console.log(`  ${cmd} -> ${info.alias}\n`);
      continue;
    }
    const argStr = info.args?.length ? `<${info.args.join("> <")}>` : "";
    console.log(`  ${cmd} ${argStr}`);
    console.log(`      ${info.desc}`);
    if (info.opts) {
      for (const [opt, desc] of Object.entries(info.opts)) {
        console.log(`      --${opt.padEnd(14)} ${desc}`);
      }
    }
    if (info.examples?.length) {
      console.log("      Examples:");
      for (const ex of info.examples) {
        console.log(`        surf ${ex.cmd}`);
      }
    }
    console.log();
  }
};

const showToolHelp = (toolName) => {
  for (const [groupName, group] of Object.entries(TOOLS)) {
    const info = group.commands[toolName];
    if (info) {
      if (info.alias) {
        console.log(`\n  ${toolName} -> ${info.alias}\n`);
        showToolHelp(info.alias);
        return;
      }
      const argStr = info.args?.length ? `<${info.args.join("> <")}>` : "";
      console.log(`\n${toolName} - ${info.desc}\n`);
      console.log(`Usage: surf ${toolName} ${argStr}\n`);
      if (info.args?.length) {
        console.log("Arguments:");
        for (const arg of info.args) {
          console.log(`  <${arg}>`);
        }
        console.log();
      }
      if (info.opts) {
        console.log("Options:");
        for (const [opt, desc] of Object.entries(info.opts)) {
          console.log(`  --${opt.padEnd(18)} ${desc}`);
        }
        console.log();
      }
      if (info.examples?.length) {
        console.log("Examples:");
        for (const ex of info.examples) {
          console.log(`  surf ${ex.cmd.padEnd(40)} ${ex.desc}`);
        }
        console.log();
      }
      // Show related commands
      const related = SEE_ALSO[toolName];
      if (related && related.length > 0) {
        console.log(`See also: ${related.join(", ")}`);
        console.log();
      }
      return;
    }
  }
  if (ALL_SOCKET_TOOLS.includes(toolName)) {
    console.log(`\n  ${toolName}\n`);
    console.log("  Socket API tool. Use --json to see response format.\n");
    // Show related commands for socket tools too
    const related = SEE_ALSO[toolName];
    if (related && related.length > 0) {
      console.log(`See also: ${related.join(", ")}`);
      console.log();
    }
    return;
  }
  console.error(`Unknown command: ${toolName}`);
  process.exit(1);
};

const fuzzyFind = (query) => {
  const terms = query.toLowerCase().split(/\s+/);
  const results = [];

  for (const cmd of HEADLESS_COMMAND_LIST) {
    const desc = HEADLESS_COMMAND_HELP[cmd] || "";
    const searchText = `${cmd} ${desc} headless ai`.toLowerCase();
    const score = terms.filter((t) => searchText.includes(t)).length;
    if (score > 0) {
      results.push({ cmd, desc, group: "headless", score });
    }
  }

  return results.sort((a, b) => b.score - a.score);
};

const showFindResults = (query) => {
  const results = fuzzyFind(query);
  if (results.length === 0) {
    console.log(`No commands found for: "${query}"`);
    return;
  }
  console.log(`\nSearch results for "${query}":\n`);
  for (const r of results.slice(0, 10)) {
    console.log(`  ${r.cmd.padEnd(24)} ${r.desc}`);
  }
  console.log();
};

const showAbout = (topic) => {
  const t = HELP_TOPICS[topic];
  if (t) {
    showHelpTopic(topic);
    return;
  }
  const topicLower = topic.toLowerCase();
  for (const [groupName, group] of Object.entries(TOOLS)) {
    if (groupName === topicLower || group.desc.toLowerCase().includes(topicLower)) {
      showGroupHelp(groupName);
      return;
    }
  }
  console.error(`Unknown topic: ${topic}`);
  console.error(`Available topics: ${Object.keys(HELP_TOPICS).join(", ")}`);
  console.error(`Or use a group name: ${Object.keys(TOOLS).join(", ")}`);
  process.exit(1);
};

const showAllTools = () => {
  console.log("\n  All available commands:\n");
  const sorted = [...HEADLESS_COMMAND_LIST].sort();
  for (const cmd of sorted) {
    console.log(`  ${cmd.padEnd(24)} ${HEADLESS_COMMAND_HELP[cmd] || ""}`);
  }
  console.log(`\n  Total: ${HEADLESS_COMMAND_LIST.length} commands\n`);
};

const showSessionHelp = () => {
  console.log(`
session - inspect and reconcile saved surf sessions

Usage:
  surf session                      List recent sessions
  surf session <id>                 View a session
  surf session --reconcile          Reconcile orphaned sessions
  surf session --reconcile --network  + poll ChatGPT remotely
  surf session --all                Show all sessions
  surf session --hours 72           Last 72 hours
  surf session --clear              Delete all sessions
  surf session --clear --hours 24   Delete sessions older than 24h
`);
};

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  showBasicHelp();
  process.exit(0);
}

if (args[0] === "--help-full") {
  showFullHelp();
  process.exit(0);
}

if (args[0] === "--help-topic" && args[1]) {
  showHelpTopic(args[1]);
  process.exit(0);
}

if (args[0] === "--version" || args[0] === "-v") {
  console.log(`surf version ${VERSION}`);
  process.exit(0);
}

if (args[0] === "--list") {
  showAllTools();
  process.exit(0);
}

if (args[0] === "--find" && args[1]) {
  showFindResults(args.slice(1).join(" "));
  process.exit(0);
}

if (args[0] === "--about" && args[1]) {
  showAbout(args[1]);
  process.exit(0);
}

if ((args[0] === "session" || args[0] === "sessions") && (args.includes("--help") || args.includes("-h"))) {
  showSessionHelp();
  process.exit(0);
}

if (args[0] === "server") {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: surf server");
    console.log("");
    console.log("Start MCP server for Claude Desktop/Cursor integration.");
    console.log("Communicates via stdio using the Model Context Protocol.");
    process.exit(0);
  }
  const { PiChromeMcpServer } = require("./mcp-server.cjs");
  const server = new PiChromeMcpServer();
  server.start().catch((err) => {
    console.error("MCP Server error:", err.message);
    process.exit(1);
  });
  return;
}

if (args[0] === "skills" || args[0] === "skill") {
  process.stdout.write(SURF_SKILL_DOC);
  process.exit(0);
}

// ============================================================================
// surf session — list / view / clear sessions (Oracle-style)
// ============================================================================

if (args[0] === "session" || args[0] === "sessions") {
  const sessionArgs = args.slice(1);

  // Guard: --clear and --reconcile are mutually exclusive
  if (sessionArgs.includes("--clear") && sessionArgs.includes("--reconcile")) {
    console.error("Error: cannot combine --clear with --reconcile");
    process.exit(1);
  }

  // surf session --reconcile [--hours N] [--all] [--network]
  if (sessionArgs.includes("--reconcile")) {
    const allFlag    = sessionArgs.includes("--all");
    const networkFlag = sessionArgs.includes("--network");
    const hoursIdx   = sessionArgs.indexOf("--hours");
    const rawHours   = hoursIdx !== -1 ? Number(sessionArgs[hoursIdx + 1]) : 72;
    const hours      = (Number.isFinite(rawHours) && rawHours > 0) ? rawHours : 72;

    let manageChats = null;
    let skipNetworkReason = null;
    if (networkFlag) {
      if (!isCloakBrowserAvailable()) {
        skipNetworkReason = "CloakBrowser not installed";
      } else {
        manageChats = manageChatsWithCloakBrowser;
      }
    }
    if (skipNetworkReason) {
      console.error(`Warning: ${skipNetworkReason} — skipping network poll`);
    }

    (async () => {
      const { reconciled, sessions } = await sessionReconciler.reconcileSessions({
        hours,
        all: allFlag,
        pollNetwork: networkFlag && !skipNetworkReason,
        manageChats,
      });

      if (sessions.length === 0) {
        console.log("No running sessions to reconcile.");
        process.exit(0);
      }

      const actionLabel = { none: "alive", stale: "stale", orphaned: "orphaned", recovered: "recovered", unresolved: "unresolved" };
      for (const r of sessions) {
        const icon = r.action === "none" ? "~" : r.action === "recovered" ? "✓" : r.action === "unresolved" ? "?" : r.action === "stale" ? "!" : "✗";
        const extra = r.conversationId ? ` (conv: ${r.conversationId.slice(0,  8)}…)` : "";
        const pid   = r.meta.pid ? ` pid:${r.meta.pid}` : "";
        const age   = r.meta.reconcile ? ` age:${Math.round(r.meta.reconcile.ageSec / 60)}min` : "";
        console.log(`  ${icon} ${r.meta.id.slice(0, 52)}  → ${actionLabel[r.action] || r.action}${pid}${age}${extra}`);
      }
      console.log(`\nReconciled ${reconciled} session(s).${networkFlag && !skipNetworkReason ? " (with network poll)" : ""}`);
      process.exit(0);
    })();
    return;
  }

  // surf session --clear [--hours N | --all]
  if (sessionArgs.includes("--clear")) {
    const allFlag  = sessionArgs.includes("--all");
    const hoursIdx = sessionArgs.indexOf("--hours");
    let hours      = undefined;
    if (hoursIdx !== -1) {
      const raw = Number(sessionArgs[hoursIdx + 1]);
      if (!Number.isFinite(raw) || raw <= 0) {
        console.error(`Error: --hours must be a positive number (got: ${sessionArgs[hoursIdx + 1]})`);
        process.exit(1);
      }
      hours = raw;
    }
    const { deleted, remaining } = sessionStore.deleteSessions({ all: allFlag, hours });
    const label = allFlag ? "all sessions" : hours ? `sessions older than ${hours}h` : "all sessions";
    console.log(`Deleted ${deleted} sessions (${label}). ${remaining} sessions remain.`);
    process.exit(0);
  }

  // surf session <id>  — view a single session log
  // Skip values that follow --hours / --limit (they're numeric args, not session IDs)
  const flagsWithValues = new Set(["--hours", "--limit"]);
  const idArg = sessionArgs.find((a, i) => {
    if (a.startsWith("-")) return false;
    if (i > 0 && flagsWithValues.has(sessionArgs[i - 1])) return false;
    return true;
  });
  if (idArg) {
    const found = sessionStore.loadSession(idArg);
    if (!found) {
      console.error(`Session not found: ${idArg}`);
      process.exit(1);
    }
    const { meta, log } = found;
    const status  = meta.status === "completed" ? "✓" : meta.status === "error" ? "✗" : "◌";
    const elapsed = meta.elapsedMs ? `${(meta.elapsedMs / 1000).toFixed(1)}s` : "-";
    console.log(`\n${status} ${meta.id}`);
    console.log(`  Tool:    ${meta.tool}`);
    console.log(`  Status:  ${meta.status}`);
    console.log(`  Created: ${meta.createdAt}`);
    console.log(`  Elapsed: ${elapsed}`);
    if (meta.args?.query)  console.log(`  Query:   ${meta.args.query}`);
    if (meta.args?.file)   console.log(`  File:    ${meta.args.file}`);
    if (meta.args?.model)  console.log(`  Model:   ${meta.args.model}`);
    if (meta.result?.responsePath) console.log(`  Response: ${meta.result.responsePath}`);
    if (meta.error)        console.log(`  Error:   ${meta.error.message}`);
    if (log) {
      console.log(`\n--- output.log ---`);
      console.log(log);
    }
    process.exit(0);
  }

  // surf session [--all] [--hours N] [--limit N]  — list sessions
  const allFlag  = sessionArgs.includes("--all");
  const hoursIdx = sessionArgs.indexOf("--hours");
  const rawHours = hoursIdx !== -1 ? Number(sessionArgs[hoursIdx + 1]) : 24;
  const hours    = (Number.isFinite(rawHours) && rawHours > 0) ? rawHours : 24;
  const limitIdx = sessionArgs.indexOf("--limit");
  const rawLimit = limitIdx !== -1 ? Number(sessionArgs[limitIdx + 1]) : 50;
  const limit    = (Number.isFinite(rawLimit) && rawLimit > 0) ? Math.floor(rawLimit) : 50;

  // Auto-reconcile (local PID check only — fast, no network) before displaying
  (async () => {
    await sessionReconciler.reconcileSessions({ hours, all: allFlag, limit, pollNetwork: false });

    const sessions = sessionStore.listSessions({ hours, all: allFlag, limit });

    if (sessions.length === 0) {
      console.log(`No sessions found in the last ${allFlag ? "" : hours + "h "}at ${sessionStore.SESSIONS_DIR}`);
      console.log(`  surf session --all          Show all sessions`);
      console.log(`  surf session --hours 72     Last 72 hours`);
      process.exit(0);
    }

    // Header
    console.log(`\nSurf sessions (${sessions.length}) — ${sessionStore.SESSIONS_DIR}\n`);
    const pad = (s, n) => String(s ?? "").padEnd(n);

    // Status label: show reconcile state for annotated running sessions
    const statusLabel = (s) => {
      if (s.status === "completed") return "✓ completed";
      if (s.status === "error") {
        if (s.reconcile) return "✗ orphaned";
        return "✗ error";
      }
      if (s.status === "running") {
        if (s.reconcile) {
          const st = s.reconcile.state;
          if (st === "stale" || st === "orphaned") return "! stale";
          if (st === "unresolved") return "? running";
          if (st === "recovered") return "✓ recovered";
        }
        return "◌ running";
      }
      return `· ${s.status}`;
    };

    // Column widths
    const maxId  = Math.min(48, Math.max(20, ...sessions.map(s => s.id.length)));
    const header = `  ${pad("STATUS",13)} ${pad("TOOL",10)} ${pad("ID", maxId)} ${pad("ELAPSED",8)} CREATED`;
    console.log(header);
    console.log("  " + "-".repeat(header.length - 2));

    for (const s of sessions) {
      const label   = statusLabel(s);
      const elapsed = s.elapsedMs ? `${(s.elapsedMs / 1000).toFixed(1)}s` : "-";
      const created = new Date(s.createdAt).toLocaleString("en-US", {
        month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
      });
      console.log(`  ${pad(label,13)} ${pad(s.tool,10)} ${pad(s.id, maxId)} ${pad(elapsed,8)} ${created}`);
    }

    console.log(`\nUsage:`);
    console.log(`  surf session <id>                View session log`);
    console.log(`  surf session --reconcile         Fix orphaned sessions`);
    console.log(`  surf session --reconcile --network  + poll ChatGPT API`);
    console.log(`  surf session --hours 72          Last 72h`);
    console.log(`  surf session --all               All sessions`);
    console.log(`  surf session --clear             Delete all`);
    console.log(`  surf session --clear --hours 24  Delete sessions older than 24h`);
    process.exit(0);
  })();
}

if (args[0] === "extension-path" || args[0] === "path") {
  const distPath = process.env.SURF_EXTENSION_PATH || path.resolve(__dirname, "../dist");
  console.log(distPath);
  process.exit(0);
}

if (args[0] === "install") {
  const { spawnSync } = require("child_process");
  const scriptPath = require("path").resolve(__dirname, "../scripts/install-native-host.cjs");
  const installArgs = args.slice(1);
  
  if (installArgs.length === 0 || installArgs[0] === "--help" || installArgs[0] === "-h") {
    console.log(`
Usage: surf install <extension-id> [options]

Install native messaging host for browser communication.

Arguments:
  extension-id    Chrome extension ID (32 lowercase letters a-p)
                  Find at chrome://extensions with Developer Mode enabled

Options:
  -b, --browser   Browser(s) to install for (default: chrome)
                  Values: chrome, chromium, brave, edge, arc, helium, all
                  Multiple: --browser chrome,brave

Examples:
  surf install hnfbepgmaoklhekckbpjnleifhahkcpl
  surf install hnfbepgmaoklhekckbpjnleifhahkcpl --browser brave
  surf install hnfbepgmaoklhekckbpjnleifhahkcpl --browser all
`);
    process.exit(0);
  }

  const result = spawnSync(process.execPath, [scriptPath, ...installArgs], {
    stdio: "inherit",
  });
  process.exit(result.status || 0);
}

if (args[0] === "uninstall") {
  const { spawnSync } = require("child_process");
  const scriptPath = require("path").resolve(__dirname, "../scripts/uninstall-native-host.cjs");
  const uninstallArgs = args.slice(1);
  
  if (uninstallArgs.includes("--help") || uninstallArgs.includes("-h")) {
    console.log(`
Usage: surf uninstall [options]

Remove native messaging host configuration.

Options:
  -b, --browser   Browser(s) to uninstall from (default: chrome)
                  Values: chrome, chromium, brave, edge, arc, helium, all
  -a, --all       Uninstall from all browsers and remove wrapper

Examples:
  surf uninstall
  surf uninstall --browser brave
  surf uninstall --all
`);
    process.exit(0);
  }

  const result = spawnSync(process.execPath, [scriptPath, ...uninstallArgs], {
    stdio: "inherit",
  });
  process.exit(result.status || 0);
}

if (args.includes("--help") || args.includes("-h")) {
  const tool = args[0];
  if (TOOLS[tool]) {
    showGroupHelp(tool);
  } else {
    showToolHelp(tool);
  }
  process.exit(0);
}

if (TOOLS[args[0]] && args.length === 1) {
  const group = TOOLS[args[0]];
  const sameNameCmd = group.commands[args[0]];
  const executableAlone = ["zoom"];
  if (sameNameCmd && executableAlone.includes(args[0])) {
    // Command that works without args - execute it
  } else {
    showGroupHelp(args[0]);
    process.exit(0);
  }
}

if (args[0] === "config") {
  const configArgs = args.slice(1);
  const hasInit = configArgs.includes("--init");
  const hasPath = configArgs.includes("--path");

  if (hasInit) {
    const result = createStarterConfig();
    if (result.success) {
      console.log(`Created: ${result.path}`);
    } else {
      console.error(`Error: ${result.error}`);
      console.error(`Path: ${result.path}`);
      process.exit(1);
    }
    process.exit(0);
  }

  if (hasPath) {
    loadConfig();
    const configPath = getConfigPath();
    if (configPath) {
      console.log(configPath);
    } else {
      console.log("No config found");
    }
    process.exit(0);
  }

  const config = loadConfig();
  const configPath = getConfigPath();
  if (configPath) {
    console.log(JSON.stringify(config, null, 2));
  } else {
    console.log("No config found");
    console.log("Create one with: surf config --init");
  }
  process.exit(0);
}

if (args.includes("--script")) {
  const scriptIdx = args.indexOf("--script");
  const scriptPath = args[scriptIdx + 1];
  const dryRun = args.includes("--dry-run");
  const stopOnError = args.includes("--stop-on-error");

  const tabIdIdx = args.indexOf("--tab-id");
  const scriptTabId = tabIdIdx !== -1 ? args[tabIdIdx + 1] : undefined;

  if (!scriptPath || scriptPath.startsWith("--")) {
    console.error("Error: --script requires a file path");
    process.exit(1);
  }

  if (!fs.existsSync(scriptPath)) {
    console.error(`Error: Script file not found: ${scriptPath}`);
    process.exit(1);
  }

  let script;
  try {
    const content = fs.readFileSync(scriptPath, "utf8");
    script = JSON.parse(content);
  } catch (e) {
    console.error(`Error: Failed to parse script: ${e.message}`);
    process.exit(1);
  }

  if (!script.steps || !Array.isArray(script.steps)) {
    console.error("Error: Script must have a 'steps' array");
    process.exit(1);
  }

  const sendScriptRequest = (toolName, toolArgs = {}) => {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(SOCKET_PATH, () => {
        const req = {
          type: "tool_request",
          method: "execute_tool",
          params: { tool: toolName, args: toolArgs },
          id: "cli-" + Date.now() + "-" + Math.random(),
        };
        if (scriptTabId) req.tabId = parseInt(scriptTabId, 10);
        sock.write(JSON.stringify(req) + "\n");
      });
      let buf = "";
      sock.on("data", (d) => {
        buf += d.toString();
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const resp = JSON.parse(line);
            sock.end();
            resolve(resp);
          } catch {
            sock.end();
            reject(new Error("Invalid JSON"));

```

(lines 2880-4344: Main argument parsing and runtime routing for chatgpt/chatgpt.chats/chatgpt.reply/gemini, Bun/Cloak/legacy fallback logic, and socket fallback path used to detect regressions.)
```cjs
          else if (/^-?\d+\.\d+$/.test(val)) val = parseFloat(val);
          result.options[key] = val;
          i++;
        } else {
          result.options[key] = true;
        }
      }
    } else if (arg === "-v") {
      result.options.v = true;
    } else if (arg === "-vv") {
      result.options.vv = true;
    } else if (arg === "-f" && rawArgs[i + 1] && !rawArgs[i + 1].startsWith("-")) {
      // -f takes a file path argument (for surf do -f <file>)
      result.options.file = rawArgs[i + 1];
      i++;
    } else if (arg.startsWith("-") && arg.length === 2) {
      // Short flag like -n
      result.options[arg.slice(1)] = true;
    } else {
      result.positional.push(arg);
    }
  }
  return result;
};

let { positional, options } = parseArgs(args);
let tool = positional[0];
let firstArg = positional[1];

if (!tool) {
  console.error("Error: No command specified");
  process.exit(1);
}

if (REMOVED_COMMANDS[tool]) {
  console.error(`Error: Unknown command: ${tool}`);
  console.error(`This command was renamed. Use: ${REMOVED_COMMANDS[tool]}`);
  process.exit(1);
}

tool = ALIASES[tool] || tool;

// Auto-save screenshots to temp file when no --output specified
// This ensures agents always get a usable file path, not just an in-memory ID
// Can be disabled with --no-save flag or autoSaveScreenshots: false in surf.json
const config = loadConfig();
const autoSaveEnabled = config.autoSaveScreenshots !== false && !options["no-save"];
if (tool === "screenshot" && !options.output && !options.savePath && autoSaveEnabled) {
  options.savePath = path.join(SURF_TMP, `surf-snap-${Date.now()}.png`);
}

if (tool === "smoke") {
  const smokeUrls = [];
  const smokeArgs = args.slice(1);
  for (let i = 0; i < smokeArgs.length; i++) {
    const arg = smokeArgs[i];
    if (arg === "--urls") {
      i++;
      while (i < smokeArgs.length && !smokeArgs[i].startsWith("--")) {
        smokeUrls.push(smokeArgs[i]);
        i++;
      }
      i--;
    } else if (arg === "--routes") {
      options.routes = smokeArgs[i + 1];
      i++;
    } else if (arg === "--screenshot") {
      options.screenshot = smokeArgs[i + 1];
      i++;
    } else if (arg === "--fail-fast") {
      options["fail-fast"] = true;
    }
  }
  if (smokeUrls.length > 0) {
    options.urls = smokeUrls;
  }
}

const PRIMARY_ARG_MAP = {
  ai: "query",
  gemini: "query",
  chatgpt: "query",
  "chatgpt.chats": "conversationId",
  "chatgpt.reply": "conversationId",
  perplexity: "query",
  grok: "query",
  aistudio: "query",
  "aistudio.build": "query",
  navigate: "url",
  go: "url",
  js: "code",
  javascript_tool: "code",
  key: "key",
  wait: "duration",
  health: "url",
  new_tab: "url",
  "tab.new": "url",
  switch_tab: "tab_id",
  "tab.switch": "id",
  close_tab: "tab_id",
  "tab.close": "id",
  "tab.name": "name",
  "tab.unname": "name",
  scroll_to_position: "position",
  type: "text",
  smart_type: "text",
  "emulate.network": "preset",
  "emulate.cpu": "rate",
  search: "term",
  find: "term",
  "wait.element": "selector",
  "wait.url": "pattern",
  zoom: "level",
  "history.search": "query",
  "network.get": "id",
  "network.body": "id",
  "network.curl": "id",
  "network.path": "id",
  "window.new": "url",
  "window.focus": "id",
  "window.close": "id",
  "locate.role": "role",
  "locate.text": "text",
  "locate.label": "label",
  "emulate.device": "device",
  "frame.js": "code",
  "element.styles": "selector",
  "select": "selector",
};

const toolArgs = { ...options };

if (tool === "click" && firstArg) {
  if (/^e\d+$/.test(firstArg)) {
    toolArgs.ref = firstArg;
    firstArg = undefined;
  } else if (/^\d+$/.test(firstArg) && positional[2] && /^\d+$/.test(positional[2])) {
    toolArgs.x = parseInt(firstArg, 10);
    toolArgs.y = parseInt(positional[2], 10);
    firstArg = undefined;
  }
}

if (firstArg !== undefined) {
  const primaryKey = PRIMARY_ARG_MAP[tool];
  if (primaryKey && toolArgs[primaryKey] === undefined) {
    let val = firstArg;
    if (val === "true") val = true;
    else if (val === "false") val = false;
    else if (/^-?\d+$/.test(val)) val = parseInt(val, 10);
    toolArgs[primaryKey] = val;
  }
}

if (tool === "chatgpt.reply") {
  toolArgs.prompt = positional.slice(2).join(" ").trim();
  toolArgs.query = toolArgs.prompt;
}

if (tool === "js" && toolArgs.file) {
  try {
    toolArgs.code = fs.readFileSync(toolArgs.file, "utf8");
    delete toolArgs.file;
  } catch (e) {
    console.error(`Error: Failed to read file: ${e.message}`);
    process.exit(1);
  }
}

// Handle select command: capture multiple values after selector
if (tool === "select" && positional.length > 2) {
  const values = positional.slice(2);  // All args after "select <selector>"
  toolArgs.values = values.length === 1 ? values[0] : values;
} else if (tool === "select" && positional.length === 2) {
  // Only selector provided, no values
  console.error("Error: select requires at least one value");
  console.error("Usage: surf select <selector> <value...>");
  process.exit(1);
}

if (toolArgs.into && !toolArgs.selector) {
  toolArgs.selector = toolArgs.into;
  delete toolArgs.into;
}

const globalOpts = {};
if (toolArgs["tab-id"] !== undefined) {
  const tid = parseInt(toolArgs["tab-id"], 10);
  if (isNaN(tid)) {
    console.error("Error: --tab-id must be a number");
    process.exit(1);
  }
  globalOpts.tabId = tid;
  delete toolArgs["tab-id"];
}
if (toolArgs["window-id"] !== undefined) {
  const wid = parseInt(toolArgs["window-id"], 10);
  if (isNaN(wid)) {
    console.error("Error: --window-id must be a number");
    process.exit(1);
  }
  globalOpts.windowId = wid;
  delete toolArgs["window-id"];
}
if (toolArgs["network-path"] !== undefined) {
  networkStore.setBasePath(toolArgs["network-path"]);
  delete toolArgs["network-path"];
}
const wantJson = toolArgs.json === true;
delete toolArgs.json;

const autoCapture = toolArgs["auto-capture"] === true;
delete toolArgs["auto-capture"];

const noScreenshot = toolArgs["no-screenshot"] === true;
delete toolArgs["no-screenshot"];

const softFail = toolArgs["soft-fail"] === true;
delete toolArgs["soft-fail"];

if (!noScreenshot && AUTO_SCREENSHOT_TOOLS.includes(tool)) {
  toolArgs.autoScreenshot = true;
}

const outputPath = toolArgs.output;
delete toolArgs.output;
if (tool === "aistudio.build" && outputPath) {
  toolArgs.output = path.resolve(outputPath);
}
if (tool === "gemini") {
  if (outputPath) toolArgs.output = path.resolve(outputPath);
  if (toolArgs["generate-image"] && typeof toolArgs["generate-image"] === "string") {
    toolArgs["generate-image"] = path.resolve(toolArgs["generate-image"]);
  }
  if (toolArgs["edit-image"] && typeof toolArgs["edit-image"] === "string") {
    toolArgs["edit-image"] = path.resolve(toolArgs["edit-image"]);
  }
  if (toolArgs.file && typeof toolArgs.file === "string") {
    toolArgs.file = path.resolve(toolArgs.file);
  }
}

if (tool === "chatgpt") {
  if (toolArgs["generate-image"] && typeof toolArgs["generate-image"] === "string") {
    toolArgs["generate-image"] = path.resolve(toolArgs["generate-image"]);
  }
  if (toolArgs.file && typeof toolArgs.file === "string") {
    toolArgs.file = path.resolve(toolArgs.file);
  }
  // --prompt-file: read file content as the prompt (for large exported prompts)
  if (toolArgs["prompt-file"] && typeof toolArgs["prompt-file"] === "string") {
    toolArgs.query = loadPromptFile(toolArgs["prompt-file"]);
    delete toolArgs["prompt-file"];
  }
}

if (tool === "chatgpt.chats" && typeof toolArgs.export === "string") {
  toolArgs.export = path.resolve(toolArgs.export);
}

if (tool === "screenshot" && outputPath) {
  if (typeof outputPath !== "string") {
    console.error("Error: --output requires a file path");
    process.exit(1);
  }
  toolArgs.savePath = outputPath;
  if (options.full) toolArgs.full = true;
  if (options["max-size"]) toolArgs["max-size"] = options["max-size"];
}

const methodFlag = toolArgs.method;
// Keep method for network filtering, only delete for other tools
if (tool !== 'network' && tool !== 'get_network_entries') {
  delete toolArgs.method;
}

const streamMode = toolArgs.stream === true;
delete toolArgs.stream;

const streamLevel = toolArgs.level;
delete toolArgs.level;

const streamFilter = toolArgs.filter;
delete toolArgs.filter;

let finalTool = tool;
if (methodFlag === "js") {
  if (tool === "type") {
    if (!toolArgs.selector) {
      console.error("Error: --selector or --into required for type with --method js");
      process.exit(1);
    }
    finalTool = "smart_type";
  } else if (tool === "click") {
    if (!toolArgs.selector) {
      console.error("Error: --selector required for click with --method js");
      process.exit(1);
    }
    toolArgs.code = `document.querySelector(${JSON.stringify(toolArgs.selector)})?.click()`;
    delete toolArgs.selector;
    finalTool = "js";
  }
} else if (methodFlag === "cdp") {
  if (tool === "smart_type") {
    finalTool = "type";
  }
}

if (streamMode && (tool === "console" || tool === "network")) {
  const streamType = tool === "console" ? "STREAM_CONSOLE" : "STREAM_NETWORK";
  const streamOpts = {
    level: streamLevel,
    filter: streamFilter,
  };

  const formatTime = (ts) => {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 });
  };

  let connectionTimeout = null;
  let receivedData = false;

  const sock = net.createConnection(SOCKET_PATH, () => {
    const req = {
      type: "stream_request",
      streamType,
      options: streamOpts,
      id: "cli-stream-" + Date.now(),
      ...globalOpts,
    };
    sock.write(JSON.stringify(req) + "\n");
    connectionTimeout = setTimeout(() => {
      if (!receivedData) {
        console.error("Error: Stream connection timeout (10s) - no data received");
        sock.destroy();
        process.exit(1);
      }
    }, 10000);
  });

  let buf = "";
  sock.on("data", (d) => {
    if (!receivedData) {
      receivedData = true;
      if (connectionTimeout) {
        clearTimeout(connectionTimeout);
        connectionTimeout = null;
      }
    }
    buf += d.toString();
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.error) {
          console.error("Error:", msg.error);
          sock.end();
          process.exit(1);
        }
        if (msg.type === "extension_disconnected") {
          console.error(msg.message);
          sock.end();
          process.exit(1);
        }
        if (msg.type === "stream_started") {
          continue;
        }
        if (msg.type === "console_event") {
          const { level, text, timestamp } = msg;
          if (streamLevel && level !== streamLevel) continue;
          console.log(`[console] [${level}] ${formatTime(timestamp)} ${text}`);
        } else if (msg.type === "network_event") {
          const { method, url, status, duration } = msg;
          if (streamFilter && !url.includes(streamFilter)) continue;
          const statusStr = status !== undefined ? status : "...";
          const durationStr = duration !== undefined ? ` (${duration}ms)` : "";
          console.log(`[network] ${method} ${url} ${statusStr}${durationStr}`);
        }
      } catch {}
    }
  });

  sock.on("error", (e) => {
    if (e.code === "ENOENT") {
      console.error("Error: Socket not found. Is Chrome running with the extension?");
    } else {
      console.error("Error:", e.message);
    }
    process.exit(1);
  });

  process.on("SIGINT", () => {
    sock.write(JSON.stringify({ type: "stream_stop" }) + "\n");
    sock.end();
    process.exit(0);
  });

  return;
}

const request = {
  type: "tool_request",
  method: "execute_tool",
  params: { tool: finalTool, args: toolArgs },
  id: "cli-" + Date.now(),
  ...globalOpts,
};

const sendRequest = (toolName, toolArgs = {}) => {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(SOCKET_PATH, () => {
      const req = {
        type: "tool_request",
        method: "execute_tool",
        params: { tool: toolName, args: toolArgs },
        id: "cli-" + Date.now() + "-" + Math.random(),
        ...globalOpts,
      };
      sock.write(JSON.stringify(req) + "\n");
    });
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const resp = JSON.parse(line);
          if (resp.type === "extension_disconnected") {
            sock.end();
            reject(new Error(resp.message));
            return;
          }
          sock.end();
          resolve(resp);
        } catch {
          sock.end();
          reject(new Error("Invalid JSON"));
        }
      }
    });
    sock.on("error", (e) => reject(e));
    let timeoutId;
    timeoutId = setTimeout(() => { sock.destroy(); reject(new Error("Timeout")); }, 5000);
    sock.on("close", () => clearTimeout(timeoutId));
  });
};

const performAutoCapture = async () => {
  const timestamp = Date.now();
  const screenshotPath = path.join(SURF_TMP, `surf-error-${timestamp}.png`);

  try {
    const [screenshotResp, consoleResp] = await Promise.all([
      sendRequest("screenshot", { savePath: screenshotPath }),
      sendRequest("console", {}),
    ]);

    if (screenshotResp.result) {
      console.error(`Auto-captured: ${screenshotPath}`);
    } else {
      console.error("Auto-captured: (screenshot failed)");
    }

    let consoleErrors = "(none)";
    const consoleText = consoleResp.result?.content?.[0]?.text;
    if (consoleText) {
      try {
        const parsed = JSON.parse(consoleText);
        const msgs = parsed.messages || parsed || [];
        const errors = msgs.filter(m => m.level === "error" || m.type === "error");
        if (errors.length > 0) {
          consoleErrors = errors.map(e => e.text || e.message || JSON.stringify(e)).join("\n  ");
        }
      } catch {
        consoleErrors = consoleText;
      }
    }
    console.error(`Console errors: ${consoleErrors}`);
  } catch (captureErr) {
    console.error(`Auto-capture failed: ${captureErr.message}`);
  }
};

const CHATGPT_CLOAK_ONLY_TOOLS = new Set(["chatgpt.chats", "chatgpt.reply"]);

const withOptionalHeadedCloak = async (enabled, fn) => {
  const previous = process.env.CLOAK_HEADLESS;
  if (enabled) process.env.CLOAK_HEADLESS = "0";
  try {
    return await fn();
  } finally {
    if (enabled) {
      if (previous === undefined) delete process.env.CLOAK_HEADLESS;
      else process.env.CLOAK_HEADLESS = previous;
    }
  }
};

const printChatGptChatsResult = (result, opts = {}) => {
  if (result.action === "rename") {
    if (wantJson) console.log(JSON.stringify(result ?? null, null, 2));
    else console.log(`Renamed conversation ${result.conversationId} to: ${result.title}`);
    return;
  }
  if (result.action === "delete") {
    if (wantJson) console.log(JSON.stringify(result ?? null, null, 2));
    else console.log(`Deleted conversation: ${result.conversationId}`);
    return;
  }
  if (result.action === "bulk_delete") {
    if (wantJson) console.log(JSON.stringify(result ?? null, null, 2));
    else {
      const results = result.results || [];
      const ok = results.filter(r => r.deleteMethod !== "error").length;
      const failed = results.filter(r => r.deleteMethod === "error").length;
      console.log(`Deleted ${ok} conversation${ok !== 1 ? 's' : ''}${failed ? ` (${failed} failed)` : ''}`);
    }
    return;
  }
  if (result.action === "download") {
    if (wantJson) console.log(JSON.stringify(result ?? null, null, 2));
    else if (result.file?.savedPath) console.log(`Downloaded file to: ${result.file.savedPath}`);
    else if (!opts.outputPath) console.log(result.result?.download_url || `Download ready for file: ${result.fileId}`);
    return;
  }

  if (result.action === "get") {
    const markdown = chatgptChatsFormatter.formatConversationMarkdown({
      conversation: result.conversation,
      messageLimit: opts.messageLimit,
    });
    if (opts.exportPath) {
      const format = chatgptChatsFormatter.inferExportFormat({
        exportPath: opts.exportPath,
        explicitFormat: opts.format,
      });
      fs.mkdirSync(path.dirname(opts.exportPath), { recursive: true });
      fs.writeFileSync(
        opts.exportPath,
        format === "json" ? JSON.stringify(result.conversation, null, 2) + "\n" : markdown,
      );
      if (wantJson) {
        process.stderr.write(`Exported conversation to: ${opts.exportPath}\n`);
      } else {
        console.log(`Exported conversation to: ${opts.exportPath}`);
      }
    }
    if (wantJson) {
      console.log(JSON.stringify(result.conversation ?? null, null, 2));
      return;
    }
    if (!opts.exportPath) process.stdout.write(markdown);
    return;
  }

  if (wantJson) {
    console.log(JSON.stringify(result ?? null, null, 2));
    return;
  }

  const label = result.action === "search"
    ? `ChatGPT Search — ${result.query}`
    : "ChatGPT Conversations";
  console.log(chatgptChatsFormatter.formatConversationList({
    items: result.items,
    total: result.total,
    label,
  }));
  if (result.action === "search" && result.partial) {
    console.error(`Note: search fallback scanned recent ${result.fallbackScanned || 0} of ${result.fallbackTotal || "?"} conversations.`);
  }
};

const runChatGptCloakQueryDirect = async (sessionTool, queryArgs) => {
  if (!isCloakBrowserAvailable()) {
    console.error("Error: CloakBrowser not installed. Run: npm install -g cloakbrowser");
    process.exit(1);
  }

  const sess = sessionStore.createSession(sessionTool, queryArgs, process.env);
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (data, ...rest) => {
    sess.step(String(typeof data === "string" ? data : data.toString()).trimEnd());
    return originalWrite(data, ...rest);
  };

  const startMs = Date.now();
  let lastProgress = "";
  let sawSentCheckpoint = false;
  try {
    const result = await withOptionalHeadedCloak(queryArgs.continueInBrowser === true, () => queryWithCloakBrowser(queryArgs, (progress) => {
      if (progress.type === "meta_update") {
        const patch = {};
        if (progress.conversationId)             patch.conversationId             = progress.conversationId;
        if (progress.baselineAssistantMessageId) patch.baselineAssistantMessageId = progress.baselineAssistantMessageId;
        if (progress.lastCheckpoint)             patch.lastCheckpoint             = progress.lastCheckpoint;
        if (progress.sentAt)                     patch.sentAt                     = progress.sentAt;
        if (Object.keys(patch).length > 0)       sess.update(patch);
        if (!sawSentCheckpoint && progress.lastCheckpoint === "sent") {
          sawSentCheckpoint = true;
          sess.step(`[session] checkpoint: sent (${progress.source || "?"}) conv:${progress.conversationId || "?"} baseline:${progress.baselineAssistantMessageId || "?"}`);
        }
        return;
      }
      if (progress.type === "trace") {
        // Rich thinking text — print deltas as they arrive
        if (progress.traceType === "thinking_text") {
          const chunk = String(progress.thoughtDelta || progress.thoughtText || "").trim();
          if (chunk) {
            const lines = chunk.split("\n");
            process.stderr.write(`[cloak-${sessionTool}] 🧠 ${lines[0]}\n`);
            for (const line of lines.slice(1)) {
              process.stderr.write(`[cloak-${sessionTool}]    ${line}\n`);
            }
          }
          return;
        }
        const msg = `[cloak-${sessionTool}] ⏳ ${progress.phase}`;
        if (msg !== lastProgress) {
          process.stderr.write(msg + "\n");
          lastProgress = msg;
        }
        return;
      }
      const msg = `[cloak-${sessionTool}] [${progress.step}/${progress.total}] ${progress.message}`;
      if (msg !== lastProgress) {
        process.stderr.write(msg + "\n");
        lastProgress = msg;
      }
    }));

    const durationMs = result.tookMs || (Date.now() - startMs);
    if (sessionTool === "chatgpt.reply") chatgptChatsCache.invalidateCachedChats();
    // Also invalidate after a new chatgpt query — a new conversation was created
    if (sessionTool === "chatgpt" && result.conversationId) chatgptChatsCache.invalidateCachedChats();
    sess.finish({
      model: result.model || sessionTool,
      tookMs: durationMs,
      imagePath: result.imagePath,
      response: result.response,
      responsePreview: result.response ? result.response.slice(0, 160) : `${sessionTool} completed`,
    });

    if (result.imagePath) process.stderr.write(`Image saved: ${result.imagePath}\n`);
    if (result.thinkingTrace) {
      const tc = result.thinkingTrace;
      const tCount = tc.thoughts ? tc.thoughts.length : 0;
      const dur = tc.durationSec ? `${tc.durationSec}s` : (tc.recapText || 'unknown');
      process.stderr.write(`[cloak-${sessionTool}] 🧠 Thinking trace: ${tCount} step(s), ${dur}\n`);
    }
    if (wantJson) {
      console.log(JSON.stringify({
        response: result.response,
        model: result.model,
        tookMs: durationMs,
        imagePath: result.imagePath || undefined,
        partial: result.partial || undefined,
        backend: "cloak",
        conversationId: result.conversationId || undefined,
        thinkingTrace: result.thinkingTrace || undefined,
      }, null, 2));
    } else {
      console.log(result.response);
      const suffix = result.partial ? " | partial" : "";
      console.error(`\n[${result.model || "unknown"} | ${(durationMs / 1000).toFixed(1)}s | cloak${suffix}]`);
    }
    process.exit(0);
  } catch (err) {
    sess.fail(err);
    const errMsg = `CloakBrowser failed: ${err.message}`;
    if (softFail) {
      console.warn(`Warning: ${errMsg}`);
      process.exit(0);
    }
    console.error(`Error: ${errMsg}`);
    if (autoCapture) await performAutoCapture();
    process.exit(1);
  } finally {
    process.stderr.write = originalWrite;
  }
};

const runChatGptChatsDirect = async (chatArgs, renderOpts = {}) => {
  if (!isCloakBrowserAvailable()) {
    console.error("Error: CloakBrowser not installed. Run: npm install -g cloakbrowser");
    process.exit(1);
  }

  const sess = sessionStore.createSession("chatgpt.chats", chatArgs, process.env);
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (data, ...rest) => {
    sess.step(String(typeof data === "string" ? data : data.toString()).trimEnd());
    return originalWrite(data, ...rest);
  };

  const startMs = Date.now();
  let lastProgress = "";
  try {
    const cacheable = ["list", "search", "get"].includes(chatArgs.action)
      && chatArgs.useCache !== false
      && chatArgs.continueInBrowser !== true;
    if (cacheable) {
      const cached = chatgptChatsCache.getCachedChats(chatArgs);
      if (cached) {
        sess.step("[cache] hit chatgpt chats cache");
        sess.finish({ model: `chatgpt.chats:${cached.action}:cache`, tookMs: Date.now() - startMs, responsePreview: `${cached.action} cache` });
        printChatGptChatsResult(cached, renderOpts);
        process.exit(0);
      }
    }

    const result = await withOptionalHeadedCloak(chatArgs.continueInBrowser === true, () => manageChatsWithCloakBrowser(chatArgs, (progress) => {
      const msg = `[cloak-chatgpt.chats] [${progress.step}/${progress.total}] ${progress.message}`;
      if (msg !== lastProgress) {
        process.stderr.write(msg + "\n");
        lastProgress = msg;
      }
    }));

    if (cacheable) chatgptChatsCache.setCachedChats(chatArgs, result);
    if (["rename", "delete", "bulk_delete"].includes(chatArgs.action)) chatgptChatsCache.invalidateCachedChats();

    const durationMs = Date.now() - startMs;
    const preview = result.action === "get"
      ? `view ${result.conversationId || ""}`
      : `${result.action} ${(result.items || []).length}/${result.total || 0}`;
    sess.finish({ model: `chatgpt.chats:${result.action}`, tookMs: durationMs, responsePreview: preview.trim() });
    printChatGptChatsResult(result, renderOpts);
    process.exit(0);
  } catch (err) {
    sess.fail(err);
    const errMsg = `CloakBrowser failed: ${err.message}`;
    if (softFail) {
      console.warn(`Warning: ${errMsg}`);
      process.exit(0);
    }
    console.error(`Error: ${errMsg}`);
    if (autoCapture) await performAutoCapture();
    process.exit(1);
  } finally {
    process.stderr.write = originalWrite;
  }
};

// ---------------------------------------------------------------------------
// Bun-native ChatGPT path (opt-in via SURF_USE_BUN_CHATGPT=1)
// ---------------------------------------------------------------------------

// Extract --profile before routing (Bun-only, macOS-only) — shared by both Gemini and ChatGPT
const requestedProfile = (() => {
  const raw = toolArgs.profile;
  delete toolArgs.profile;   // never leak to legacy socket request
  if (raw && typeof raw === "string") return raw.trim().toLowerCase();
  return undefined;
})();

// Retained for legacy Bun fallback block below (currently unreachable in headless-only mode).
const hasBunOnlyChatGPTFeature = !!(
  toolArgs.file || toolArgs["generate-image"] || requestedProfile
);

if ((tool === "chatgpt" || CHATGPT_CLOAK_ONLY_TOOLS.has(tool)) && requestedProfile) {
  if (process.platform !== "darwin") {
    console.error("Error: --profile is only supported on macOS");
    process.exit(1);
  }
  if (tool === "chatgpt" && (toolArgs["with-page"] || toolArgs.withPage)) {
    console.error("Error: --profile cannot be used with --with-page");
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// CloakBrowser ChatGPT path (default)
// ---------------------------------------------------------------------------

if (tool === "chatgpt") {
  (async () => {
    if (requestedProfile) toolArgs.profile = requestedProfile;
    if (toolArgs["generate-image"]) toolArgs.generateImage = toolArgs["generate-image"];
    await runChatGptCloakQueryDirect("chatgpt", toolArgs);
  })();
  return; // Prevent falling through to Bun or legacy
}

if (tool === "chatgpt.chats") {
  const exportPath = toolArgs.export;
  const explicitFormat = toolArgs.format;
  const searchQuery = typeof toolArgs.search === "string" ? toolArgs.search.trim() : "";
  const conversationId = typeof toolArgs.conversationId === "string" ? toolArgs.conversationId.trim() : "";
  const renameTitle = typeof toolArgs.rename === "string" ? toolArgs.rename.trim() : "";
  const fileId = typeof toolArgs["download-file"] === "string" ? toolArgs["download-file"].trim() : "";
  const limit = toolArgs.limit === undefined ? undefined : parseInt(String(toolArgs.limit), 10);
  const wantsDelete = toolArgs.delete === true;
  const bulkDeleteIds = typeof toolArgs["delete-ids"] === "string"
    ? toolArgs["delete-ids"].split(",").map(s => s.trim()).filter(Boolean)
    : [];
  const continueInBrowser = toolArgs.continue === true;
  const useCache = toolArgs["no-cache"] !== true;

  if (toolArgs.limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
    console.error("Error: --limit must be a positive integer");
    process.exit(1);
  }
  if (conversationId && searchQuery) {
    console.error("Error: cannot use conversation ID with --search");
    process.exit(1);
  }
  if (toolArgs.all && conversationId) {
    console.error("Error: --all is only valid when listing conversations");
    process.exit(1);
  }
  if (toolArgs.all && toolArgs.limit !== undefined) {
    console.error("Error: --all cannot be combined with --limit");
    process.exit(1);
  }
  if (exportPath && !conversationId) {
    console.error("Error: --export requires a conversation ID");
    process.exit(1);
  }
  if (explicitFormat && !["markdown", "md", "json"].includes(String(explicitFormat).toLowerCase())) {
    console.error("Error: --format must be markdown, md, or json");
    process.exit(1);
  }

  const advancedCount = [renameTitle ? 1 : 0, wantsDelete ? 1 : 0, bulkDeleteIds.length > 0 ? 1 : 0, fileId ? 1 : 0].reduce((sum, n) => sum + n, 0);
  if (advancedCount > 1) {
    console.error("Error: use only one of --rename, --delete, --delete-ids, or --download-file");
    process.exit(1);
  }
  if ((renameTitle || wantsDelete || fileId) && !conversationId) {
    console.error("Error: conversation ID required for this action");
    process.exit(1);
  }
  if (bulkDeleteIds.length > 0 && conversationId) {
    console.error("Error: --delete-ids cannot be used with a conversation ID positional arg");
    process.exit(1);
  }
  if (fileId && !outputPath) {
    console.error("Error: --download-file requires --output <path>");
    process.exit(1);
  }
  if (outputPath && !fileId) {
    console.error("Error: --output is only supported with --download-file");
    process.exit(1);
  }
  if ((renameTitle || wantsDelete || fileId) && exportPath) {
    console.error("Error: --export is only supported when viewing a conversation");
    process.exit(1);
  }

  const action = renameTitle
    ? "rename"
    : wantsDelete
      ? "delete"
      : bulkDeleteIds.length > 0
        ? "bulk_delete"
        : fileId
          ? "download"
          : conversationId
            ? "get"
            : searchQuery
              ? "search"
              : "list";
  (async () => {
    const chatArgs = {
      action,
      conversationId: conversationId || undefined,
      conversationIds: bulkDeleteIds.length > 0 ? bulkDeleteIds : undefined,
      query: searchQuery || undefined,
      limit,
      all: toolArgs.all === true,
      profile: requestedProfile,
      timeout: toolArgs.timeout,
      title: renameTitle || undefined,
      fileId: fileId || undefined,
      includeBytes: !!fileId,
      outputPath: outputPath || undefined,
      continueInBrowser,
      useCache,
    };
    await runChatGptChatsDirect(chatArgs, {
      messageLimit: action === "get" ? limit : undefined,
      exportPath,
      format: explicitFormat,
      outputPath,
    });
  })();
  return;
}

if (tool === "chatgpt.reply") {
  const conversationId = typeof toolArgs.conversationId === "string" ? toolArgs.conversationId.trim() : "";
  // --prompt-file overrides positional prompt for chatgpt.reply too
  if (toolArgs["prompt-file"] && typeof toolArgs["prompt-file"] === "string") {
    toolArgs.prompt = loadPromptFile(toolArgs["prompt-file"]);
    toolArgs.query = toolArgs.prompt;
    delete toolArgs["prompt-file"];
  }
  const prompt = typeof toolArgs.prompt === "string" ? toolArgs.prompt.trim() : "";
  if (!conversationId || !prompt) {
    console.error("Error: Usage: surf chatgpt.reply <conversation-id> \"prompt\"");
    process.exit(1);
  }

  (async () => {
    const replyArgs = {
      ...toolArgs,
      profile: requestedProfile,
      prompt,
      query: prompt,
      conversationId,
      continueInBrowser: toolArgs.continue === true,
    };
    await runChatGptCloakQueryDirect("chatgpt.reply", replyArgs);
  })();
  return;
}

// ---------------------------------------------------------------------------
// Bun-native ChatGPT path (opt-in via SURF_USE_BUN_CHATGPT=1)
// ---------------------------------------------------------------------------

if (tool === "chatgpt" && shouldUseBunChatGPT(process.env)) {
  const eligibility = isBunChatGPTEligible(toolArgs);
  if (eligibility.eligible) {
    if (requestedProfile) toolArgs.profile = requestedProfile;
    (async () => {
      const sess = sessionStore.createSession("chatgpt", toolArgs, process.env);
      const _origWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = (data, ...rest) => { sess.step(String(typeof data==="string"?data:data.toString()).trimEnd()); return _origWrite(data, ...rest); };
      try {
        const bunResult = await runChatGPTViaBun(toolArgs);
        process.stderr.write = _origWrite;
        if (bunResult.ok) {
            const data = bunResult.result;
            sess.finish({ model: data.model, tookMs: data.tookMs, imagePath: data.imagePath,
              response: data.response,
              responsePreview: data.response ? data.response.slice(0, 160) : "" });
          if (wantJson) {
            console.log(JSON.stringify(data, null, 2));
          } else {
            console.log(data.response);
            if (data.imagePath) {
              console.log(`\nImage saved: ${data.imagePath}`);
            }
            console.error(`\n[${data.model || 'unknown'} | ${((data.tookMs || 0) / 1000).toFixed(1)}s | bun]`);
          }
          process.exit(0);
        } else if (bunResult.fallbackRecommended) {
          process.stderr.write = _origWrite;
          if (requestedProfile) {
            sess.fail(new Error(bunResult.error || "bun chatgpt failed"));
            console.error(`Error: Bun ChatGPT failed with --profile: ${bunResult.error}`);
            process.exit(1);
          }
          if (hasBunOnlyChatGPTFeature) {
            sess.fail(new Error(bunResult.error || "bun chatgpt failed"));
            console.error(`Error: ${bunResult.error}`);
            process.exit(1);
          }
          // Mark bun attempt as cancelled — legacy path will run independently (no new session)
          sess.fail(Object.assign(new Error(bunResult.error || "bun chatgpt fallback"), { code: "fallback" }));
          process.stderr.write(`[bun-chatgpt] Falling back to legacy path: ${bunResult.error}\n`);
          startLegacySocketPath();
        } else {
          const errMsg = bunResult.error || "Bun ChatGPT worker error";
          sess.fail(new Error(errMsg));
          process.stderr.write = _origWrite;
          if (softFail) {
            console.warn(`Warning: ${errMsg}`);
            process.exit(0);
          }
          console.error(`Error: ${errMsg}`);
          if (autoCapture) {
            await performAutoCapture();
          }
          process.exit(1);
        }
      } catch (err) {
        sess.fail(err);
        process.stderr.write = _origWrite;
        const errMsg = `Bun ChatGPT bridge failed: ${err.message}`;
        if (softFail) {
          console.warn(`Warning: ${errMsg}`);
          process.exit(0);
        }
        console.error(`Error: ${errMsg}`);
        if (autoCapture) {
          await performAutoCapture();
        }
        process.exit(1);
      }
    })();
  } else {
    if (requestedProfile) {
      console.error(`Error: --profile cannot be used with --with-page`);
      process.exit(1);
    }
    if (hasBunOnlyChatGPTFeature) {
      console.error(`Error: Bun ChatGPT not eligible (${eligibility.reason}) but Bun-only features requested`);
      process.exit(1);
    }
    if (eligibility.reason !== "with_page") {
      process.stderr.write(`[bun-chatgpt] Not eligible: ${eligibility.reason}, using legacy path\n`);
    }
    startLegacySocketPath();
  }
} else if (tool === "chatgpt") {
  startLegacySocketPath();
}

// ---------------------------------------------------------------------------
// Bun-native Gemini path (default)
// ---------------------------------------------------------------------------

if (tool === "gemini" && requestedProfile) {
  // --profile was explicitly requested — fail fast if conditions aren't met
  if (process.platform !== "darwin") {
    console.error("Error: --profile is only supported on macOS");
    process.exit(1);
  }
  if (toolArgs["with-page"] || toolArgs.withPage) {
    console.error("Error: --profile cannot be used with --with-page");
    process.exit(1);
  }
}

if (tool === "gemini") {
  const eligibility = isBunGeminiEligible(toolArgs);
  if (eligibility.eligible) {
    // Pass profile into the toolArgs for the bridge
    if (requestedProfile) toolArgs.profile = requestedProfile;
    (async () => {
      const sess = sessionStore.createSession("gemini", toolArgs, process.env);
      const _origWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = (data, ...rest) => { sess.step(String(typeof data==="string"?data:data.toString()).trimEnd()); return _origWrite(data, ...rest); };
      try {
        const bunResult = await runGeminiViaBun(toolArgs);
        process.stderr.write = _origWrite;
        if (bunResult.ok) {
            const data = bunResult.result;
            sess.finish({ model: data.model, tookMs: data.tookMs, imagePath: data.imagePath,
              response: data.response,
              responsePreview: data.response ? data.response.slice(0, 160) : "" });
          if (wantJson) {
            console.log(JSON.stringify(data, null, 2));
          } else {
            console.log(data.response);
            if (data.imagePath) {
              console.log(`\nImage saved: ${data.imagePath}`);
            }
            console.error(`\n[${data.model || 'unknown'} | ${((data.tookMs || 0) / 1000).toFixed(1)}s | bun]`);
          }
          process.exit(0);
        } else if (bunResult.fallbackRecommended) {
          // When --profile was explicit, never fall back (wrong account risk)
          if (requestedProfile) {
            sess.fail(new Error(bunResult.error || "bun gemini failed"));
            process.stderr.write = _origWrite;
            console.error(`Error: Bun Gemini failed with --profile: ${bunResult.error}`);
            process.exit(1);
          }
          process.stderr.write = _origWrite;
          // Mark bun attempt as cancelled — legacy path will run independently
          sess.fail(Object.assign(new Error(bunResult.error || "bun gemini fallback"), { code: "fallback" }));
          process.stderr.write(`[bun-gemini] Falling back to legacy path: ${bunResult.error}\n`);
          startLegacySocketPath();
        } else {
          // Runtime error — honor --soft-fail / --auto-capture like legacy path
          const errMsg = bunResult.error || "Bun Gemini worker error";
          sess.fail(new Error(errMsg));
          process.stderr.write = _origWrite;
          if (softFail) {
            console.warn(`Warning: ${errMsg}`);
            process.exit(0);
          }
          console.error(`Error: ${errMsg}`);
          if (autoCapture) {
            await performAutoCapture();
          }
          process.exit(1);
        }
      } catch (err) {
        sess.fail(err);
        process.stderr.write = _origWrite;
        const errMsg = `Bun Gemini bridge failed: ${err.message}`;
        if (softFail) {
          console.warn(`Warning: ${errMsg}`);
          process.exit(0);
        }
        console.error(`Error: ${errMsg}`);
        if (autoCapture) {
          await performAutoCapture();
        }
        process.exit(1);
      }
    })();
  } else {
    // Not eligible for Bun (e.g. --with-page) → legacy path
    if (requestedProfile) {
      console.error(`Error: --profile cannot be used with --with-page`);
      process.exit(1);
    }
    if (eligibility.reason !== "with_page") {
      process.stderr.write(`[bun-gemini] Not eligible: ${eligibility.reason}, using legacy path\n`);
    }
    startLegacySocketPath();
  }
} else if (tool !== "chatgpt") {
  // Non-Gemini, non-ChatGPT tools → legacy socket path
  startLegacySocketPath();
}

function startLegacySocketPath() {

const socket = net.createConnection(SOCKET_PATH, () => {
  socket.write(JSON.stringify(request) + "\n");
});

const AI_TOOLS = ["smoke", "chatgpt", "gemini", "perplexity", "grok", "aistudio", "aistudio.build", "ai"];
let requestTimeout = AI_TOOLS.includes(tool) ? 300000 : 30000;
if (tool === "aistudio.build") {
  const userTimeoutSec = parseInt(options.timeout || "600", 10);
  requestTimeout = (userTimeoutSec * 1000) + 60000;
}
const timeout = setTimeout(() => {
  console.error(`Error: Request timed out (${requestTimeout / 1000}s)`);
  socket.destroy();
  process.exit(1);
}, requestTimeout);

let buffer = "";

socket.on("data", (data) => {
  buffer += data.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop();

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      
      if (msg.type === "extension_disconnected") {
        clearTimeout(timeout);
        console.error(msg.message);
        socket.end();
        process.exit(1);
      }
      
      handleResponse(msg).catch((err) => {
        console.error("Handler error:", err.message);
        process.exit(1);
      });
    } catch (e) {
      console.error("Invalid JSON response:", line);
      process.exit(1);
    }
  }
});

socket.on("error", (err) => {
  clearTimeout(timeout);
  if (err.code === "ENOENT") {
    console.error("Error: Socket not found. Is Chrome running with the extension?");
  } else if (err.code === "ECONNREFUSED") {
    console.error("Error: Connection refused. Native host not running.");
  } else {
    console.error("Error:", err.message);
  }
  process.exit(1);
});

socket.on("close", () => {
  clearTimeout(timeout);
});

async function handleResponse(response) {
  clearTimeout(timeout);

  if (response.error) {
    const errContent = response.error.content?.[0]?.text || JSON.stringify(response.error);
    if (softFail) {
      console.warn("Warning:", errContent);
      socket.end();
      process.exit(0);
    }
    console.error("Error:", errContent);

    if (autoCapture) {
      await performAutoCapture();
    }

    socket.end();
    process.exit(1);
  }

  const result = response.result?.content?.[0]?.text;
  
  let data;
  try {
    data = result ? JSON.parse(result) : response.result;
  } catch {
    data = result || response.result;
  }

  if (tool === 'aistudio' && typeof data === 'string') {
    data = { response: data };
  }

  if (wantJson) {
    console.log(JSON.stringify(data ?? null, null, 2));
    socket.end();
    process.exit(0);
  }

  if (tool === "screenshot" && data?.base64 && (outputPath || toolArgs.savePath)) {
    const saveTo = outputPath || toolArgs.savePath;
    fs.writeFileSync(saveTo, Buffer.from(data.base64, "base64"));
    
    const skipResize = options.full || toolArgs.full;
    const maxSize = parseInt(options["max-size"] || toolArgs["max-size"] || "1200", 10);
    const origWidth = data.width || 0;
    const origHeight = data.height || 0;
    
    if (!skipResize && (origWidth > maxSize || origHeight > maxSize)) {
      const result = resizeImage(saveTo, maxSize);
      if (result.success) {
        console.log(`Saved to ${saveTo} (${result.width}x${result.height}, resized from ${origWidth}x${origHeight})`);
      } else {
        console.log(`Saved to ${saveTo} (${origWidth}x${origHeight}, resize failed: ${result.error})`);
      }
    } else {
      console.log(`Saved to ${saveTo} (${origWidth}x${origHeight})`);
    }
  } else if (tool === "screenshot" && data?.message) {
    console.log(data.message);
    if (data.screenshotId) {
      console.log(`[Screenshot ID: ${data.screenshotId}]`);
    }
  } else if (tool === "tab.list") {
    const tabs = data?.tabs || data || [];
    if (Array.isArray(tabs)) {
      if (tabs.length === 0) {
        if (globalOpts.windowId) {
          console.log(`No tabs in window ${globalOpts.windowId}. Window may not exist - use 'surf window.list' to verify.`);
        } else {
          console.log("No tabs found.");
        }
      } else {
        for (const t of tabs) {
          console.log(`${t.id}\t${t.title}\t${t.url}`);
        }
      }
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  } else if (tool === "tab.named") {
    const named = data?.tabs || data?.namedTabs || data || [];
    if (Array.isArray(named)) {
      if (named.length === 0) {
        console.log("No named tabs");
      } else {
        for (const t of named) {
          console.log(`${t.name}\t${t.tabId}\t${t.title || ""}\t${t.url || ""}`);
        }
      }
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  } else if (tool === "ai" && data?.aiResult) {
    if (data.mode === "find") {
      console.log(data.ref || "NOT_FOUND");
    } else {
      console.log(data.content);
    }
  } else if (tool === "page.read" && data?.pageContent) {
    console.log(data.pageContent);
  } else if (tool === "page.text" && data?.text) {
    console.log(data.text);
  } else if (tool === "emulate.device" && data?.devices) {
    console.log("Available devices:\n");
    const devices = data.devices;
    for (const d of devices) {
      console.log(`  ${d}`);
    }
    console.log("\nUsage: surf emulate.device \"<device name>\"");
    console.log('Reset:  surf emulate.device "reset"');
  } else if (tool === "js") {
    if (data?.result !== undefined) {
      const val = data.result.value ?? data.result;
      console.log(typeof val === "string" ? val : JSON.stringify(val, null, 2));
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  } else if (tool === "health") {
    if (data?.success) {
      const timeStr = data.time ? ` (${data.time}ms)` : "";
      if (data.status) {
        console.log(`OK: ${data.status}${timeStr}`);
      } else if (data.found) {
        console.log(`OK: element found${timeStr}`);
      } else {
        console.log(`OK${timeStr}`);
      }
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  } else if (tool === "smoke" && data?.results) {
    const results = data.results;
    const summary = data.summary || { pass: 0, fail: 0, total: results.length };
    
    for (const r of results) {
      const status = r.status === "pass" ? "PASS" : "FAIL";
      const timeStr = r.time ? ` (${r.time}ms)` : "";
      const ssStr = r.screenshot ? ` [${r.screenshot}]` : "";
      console.log(`[${status}] ${r.url}${timeStr}${ssStr}`);
      if (r.errors && r.errors.length > 0) {
        for (const err of r.errors) {
          console.log(`  - ${err}`);
        }
      }
    }
    
    console.log("");
    console.log(`Summary: ${summary.pass} passed, ${summary.fail} failed, ${summary.total} total`);
    
    if (summary.fail > 0) {
      socket.end();
      process.exit(1);
    }
  } else if (tool === "zoom" && data?.zoom !== undefined) {
    console.log(`Zoom: ${Math.round(data.zoom * 100)}%`);
  } else if (tool === "back" || tool === "forward") {
    console.log("OK");
  } else if (tool === "network" && (data?.entries || data?.requests)) {
    // Network list - handle both new (entries) and old (requests) formats
    const items = data.entries || data.requests || [];
    
    if (items.length === 0) {
      console.log("No network requests captured");
    } else if (data._format === 'raw') {
      // Raw JSON output - print entries array directly
      console.log(JSON.stringify(items, null, 2));
    } else {
      // Simple compact format for now
      for (const req of items) {
        const status = req.status || '-';
        const method = (req.method || 'GET').padEnd(6);
        const type = (req.type || '').padEnd(10);
        const url = req.url || '';
        console.log(`${status} ${method} ${type} ${url}`);
      }
    }
  } else if (tool === "network.get" && data?.entry) {
    console.log(networkFormatters.formatEntry(data.entry));
  } else if (tool === "network.body" && data?.body !== undefined) {
    // Raw body for piping
    process.stdout.write(data.body);
  } else if (tool === "network.curl" && data?.curl) {
    console.log(data.curl);
  } else if (tool === "network.curl" && data?.entry) {
    console.log(networkFormatters.formatCurl(data.entry));
  } else if (tool === "network.origins" && data?.origins) {
    console.log(networkFormatters.formatOrigins(data.origins));
  } else if (tool === "network.stats" && data?.stats) {
    console.log(networkFormatters.formatStats(data.stats));
  } else if (tool === "network.clear" && data?.cleared !== undefined) {
    console.log(`Cleared ${data.cleared} requests`);
  } else if (tool === "network.export" && data?.path) {
    console.log(`Exported to: ${data.path}`);
  } else if (tool === "network.path" && data?.paths) {
    for (const [key, val] of Object.entries(data.paths)) {
      console.log(`${key}: ${val}`);
    }
  } else if ((tool === "chatgpt" || tool === "gemini") && data?.response) {
    console.log(data.response);
    if (data.imagePath) {
      console.log(`\nImage saved: ${data.imagePath}`);
    }
    console.error(`\n[${data.model || 'unknown'} | ${((data.tookMs || 0) / 1000).toFixed(1)}s]`);
  } else if (tool === "aistudio" && data?.response) {
    console.log(data.response);

    const meta = [];
    if (data.model) meta.push(data.model);
    if (data.thinkingTime) meta.push(`thought ${data.thinkingTime}s`);
    if (Number.isFinite(data.tookMs)) meta.push(`${(data.tookMs / 1000).toFixed(1)}s`);
    if (meta.length > 0) {
      console.error(`\n[${meta.join(' | ')}]`);
    }
  } else if (tool === "aistudio.build" && data?.zipPath) {
    console.error(`Downloaded: ${data.zipPath}`);
    if (data.extractedPath) {
      console.error(`Extracted: ${data.extractedPath}`);
      console.error("");
    }

    const meta = [];
    if (data.model) meta.push(data.model);
    if (Number.isFinite(data.buildDuration)) meta.push(`built ${data.buildDuration}s`);
    if (Number.isFinite(data.tookMs)) meta.push(`${(data.tookMs / 1000).toFixed(1)}s total`);
    if (meta.length > 0) {
      console.error(`[${meta.join(" | ")}]`);
    }
  } else if (tool === "perplexity" && data?.response) {
    console.log(data.response);
    const meta = [];
    if (data.sources) meta.push(`${data.sources} sources`);
    if (data.mode) meta.push(data.mode);
    if (data.model && data.model !== 'default') meta.push(data.model);
    meta.push(`${((data.tookMs || 0) / 1000).toFixed(1)}s`);
    console.error(`\n[${meta.join(' | ')}]`);
    if (data.url) console.error(`URL: ${data.url}`);
  } else if (tool === "window.list" && data?.windows) {
    if (data.windows.length === 0) {
      console.log("No windows. Use 'surf window.new' to create one.");
    } else {
      for (const w of data.windows) {
        const focused = w.focused ? " [focused]" : "";
        const state = w.state !== "normal" ? ` (${w.state})` : "";
        console.log(`${w.id}\t${w.tabCount} tabs\t${w.width}x${w.height}${focused}${state}`);
        if (w.tabs) {
          for (const t of w.tabs) {
            const active = t.active ? "*" : " ";
            console.log(`  ${active} ${t.id}\t${t.title || "(no title)"}\t${t.url || ""}`);
          }
        }
      }
      // Hint for agents
      if (data.windows.length > 0 && !globalOpts.windowId) {
        console.log("\n[hint] Use --window-id <id> to isolate commands to a specific window");
      }
    }
  } else if (typeof data === "string") {
    console.log(data);
  } else if (data?.success === true) {
    console.log("OK");
  } else if (data?.error) {
    if (softFail) {
      console.warn("Warning:", data.error);
      socket.end();
      process.exit(0);
    }
    console.error("Error:", data.error);
    if (autoCapture) {
      await performAutoCapture();
    }
    socket.end();
    process.exit(1);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }

  socket.end();
  process.exit(0);
}

} // end startLegacySocketPath

```

File: /Users/danielsivan/dev/surf-cli/native/config.cjs
```cjs
const fs = require("fs");
const path = require("path");
const os = require("os");

const CONFIG_NAME = "surf.json";

let cachedConfig = null;
let cachedConfigPath = null;

const STARTER_CONFIG = {
  chatgpt: {},
  gemini: {}
};

function findConfigPath() {
  const cwdPath = path.join(process.cwd(), CONFIG_NAME);
  if (fs.existsSync(cwdPath)) {
    return cwdPath;
  }
  const homePath = path.join(os.homedir(), CONFIG_NAME);
  if (fs.existsSync(homePath)) {
    return homePath;
  }
  return null;
}

function loadConfig() {
  if (cachedConfig !== null) {
    return cachedConfig;
  }
  const configPath = findConfigPath();
  if (!configPath) {
    cachedConfig = {};
    cachedConfigPath = null;
    return cachedConfig;
  }
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    cachedConfig = JSON.parse(content);
    cachedConfigPath = configPath;
    return cachedConfig;
  } catch (err) {
    console.error(`Warning: Failed to parse ${configPath}: ${err.message}`);
    cachedConfig = {};
    cachedConfigPath = null;
    return cachedConfig;
  }
}

function getConfigPath() {
  if (cachedConfig === null) {
    loadConfig();
  }
  return cachedConfigPath;
}

function createStarterConfig(targetDir = process.cwd()) {
  const targetPath = path.join(targetDir, CONFIG_NAME);
  if (fs.existsSync(targetPath)) {
    return { success: false, error: "Config already exists", path: targetPath };
  }
  try {
    fs.writeFileSync(targetPath, JSON.stringify(STARTER_CONFIG, null, 2) + "\n");
    return { success: true, path: targetPath };
  } catch (err) {
    return { success: false, error: err.message, path: targetPath };
  }
}

function clearCache() {
  cachedConfig = null;
  cachedConfigPath = null;
}

module.exports = {
  loadConfig,
  getConfigPath,
  createStarterConfig,
  clearCache,
  STARTER_CONFIG,
};

```

File: /Users/danielsivan/dev/surf-cli/native/do-parser.cjs
```cjs
/**
 * Parser for surf `do` workflow commands
 * 
 * Parses newline-separated commands into structured step arrays:
 * 
 * Input:
 *   'chatgpt "Draft release notes"
 *    gemini "Make them shorter"'
 * 
 * Output:
 *   [
 *     { cmd: 'chatgpt', args: { query: 'Draft release notes' } },
 *     { cmd: 'gemini', args: { query: 'Make them shorter' } }
 *   ]
 */

// Aliases mapping (matches cli.cjs)
const ALIASES = {};

// Primary argument mapping for positional args (matches cli.cjs)
const PRIMARY_ARG_MAP = {
  gemini: "query",
  chatgpt: "query",
  "chatgpt.reply": "conversationId",
  "chatgpt.chats": "conversationId",
};

/**
 * Tokenize a command line, respecting single and double quotes
 * @param {string} line - Single line to tokenize
 * @returns {string[]} - Array of tokens
 */
function tokenize(line) {
  const tokens = [];
  let current = '';
  let inQuote = null;
  
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    
    if (inQuote) {
      if (ch === inQuote) {
        // End of quoted string
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      // Start of quoted string
      inQuote = ch;
    } else if (ch === ' ' || ch === '\t') {
      // Whitespace separator
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  
  // Don't forget last token
  if (current) {
    tokens.push(current);
  }
  
  return tokens;
}

function splitCommands(input, separator) {
  const parts = [];
  let current = "";
  let inQuote = null;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuote) {
      current += ch;
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === "\"" || ch === "'") {
      inQuote = ch;
      current += ch;
      continue;
    }
    if (ch === separator) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }

  parts.push(current);
  return parts;
}

function hasUnquotedPipe(input) {
  return splitCommands(input, "|").length > 1;
}

/**
 * Parse a single command line into a step object
 * @param {string} line - Single command line
 * @returns {{ cmd: string, args: object } | null}
 */
function parseCommandLine(line) {
  const tokens = tokenize(line);
  if (tokens.length === 0) return null;
  
  // Get command and apply alias
  let cmd = tokens[0];
  cmd = ALIASES[cmd] || cmd;
  
  const args = {};
  let i = 1;
  
  // Handle first positional argument based on command type
  if (i < tokens.length && !tokens[i].startsWith('--')) {
    const firstArg = tokens[i];
    
    const primaryKey = PRIMARY_ARG_MAP[cmd];
    if (primaryKey) {
      args[primaryKey] = firstArg;
      i++;
    }
    if (cmd === "chatgpt.reply" && i < tokens.length && !tokens[i].startsWith("--")) {
      args.prompt = tokens[i];
      i++;
    }
  }
  
  // Parse --flag value pairs
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = tokens[i + 1];
      if (next && !next.startsWith('--')) {
        // Flag with value
        let val = next;
        // Type coercion
        if (val === "true") val = true;
        else if (val === "false") val = false;
        else if (/^-?\d+$/.test(val)) val = parseInt(val, 10);
        else if (/^-?\d+\.\d+$/.test(val)) val = parseFloat(val);
        args[key] = val;
        i += 2;
      } else {
        // Boolean flag
        args[key] = true;
        i++;
      }
    } else {
      // Skip unrecognized positional (shouldn't happen normally)
      i++;
    }
  }
  
  return { cmd, args };
}

/**
 * Parse a workflow string into step array
 * Supports pipe-separated (inline) or newline-separated (file) commands
 * @param {string} input - Workflow string
 * @returns {Array<{ cmd: string, args: object }>}
 */
function parseDoCommands(input) {
  // Determine separator: use unquoted pipe if present, otherwise newlines.
  // Newlines are preferred for prompts that contain literal pipe characters.
  const hasPipe = hasUnquotedPipe(input);
  const separator = hasPipe ? '|' : '\n';
  
  // Also handle literal \n for backwards compatibility
  const normalized = hasPipe ? input : input.replace(/\\n/g, '\n');
  
  return splitCommands(normalized, separator)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => parseCommandLine(line))
    .filter(step => step !== null);
}

module.exports = { 
  parseDoCommands, 
  parseCommandLine, 
  splitCommands,
  hasUnquotedPipe,
  tokenize,
  ALIASES,
  PRIMARY_ARG_MAP
};

```

File: /Users/danielsivan/dev/surf-cli/native/do-executor.cjs
```cjs
/**
 * Executor for surf `do` workflow commands
 * 
 * Executes steps sequentially with auto-waits and streaming progress output.
 * Supports:
 *   - Step outputs: capture results with `as` field
 *   - Loops: `repeat` for fixed iterations, `each` for array iteration
 *   - Variable substitution: %{varname} syntax
 * 
 * Runs the supported headless commands through the CLI entrypoint.
 */

const {
  SUPPORTED_HEADLESS_COMMANDS,
  runSurfHeadlessCommand,
} = require("./headless-command-runner.cjs");

// Maximum iterations for loops (safety cap)
const MAX_LOOP_ITERATIONS = 100;

const AUTO_WAIT_COMMANDS = [];
const AUTO_WAIT_MAP = {};

/**
 * Check if a command should trigger an auto-wait
 * @param {string} cmd - Command name
 * @returns {boolean}
 */
function shouldAutoWait(cmd) {
  return AUTO_WAIT_COMMANDS.some(c => cmd === c || cmd.startsWith(c + '.'));
}

/**
 * Get the appropriate auto-wait command for a given command
 * @param {string} cmd - Command name
 * @returns {string|null} - Wait command to execute, or null
 */
function getAutoWaitCommand(cmd) {
  // Check exact match first
  if (AUTO_WAIT_MAP[cmd] !== undefined) return AUTO_WAIT_MAP[cmd];
  
  // Check prefix match
  for (const [prefix, waitCmd] of Object.entries(AUTO_WAIT_MAP)) {
    if (cmd.startsWith(prefix + '.')) return waitCmd;
  }
  
  return null;
}

/**
 * Resolve a variable reference or perform string substitution
 * @param {*} template - Value to resolve (may contain %{var} references)
 * @param {object} vars - Variables map
 * @returns {*} - Resolved value
 */
function resolveVar(template, vars) {
  if (typeof template !== 'string') return template;
  
  // Check if it's a simple variable reference like %{urls}
  const match = template.match(/^%\{(\w+)\}$/);
  if (match) {
    const value = vars[match[1]];
    return value !== undefined ? value : template;
  }
  
  // Otherwise do string substitution
  return template.replace(/%\{(\w+)\}/g, (_, name) => {
    const val = vars[name];
    if (val === undefined) return `%{${name}}`;
    // Convert objects/arrays to string for interpolation
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  });
}

/**
 * Substitute variables in arguments using %{varname} syntax
 * @param {object} args - Arguments object
 * @param {object} vars - Variables map
 * @returns {object} - Arguments with variables substituted
 */
function substituteVars(args, vars) {
  if (!args || typeof args !== 'object') return args;
  
  // Handle arrays specially to preserve array type
  if (Array.isArray(args)) {
    return args.map(item => {
      if (typeof item === 'string') {
        return resolveVar(item, vars);
      } else if (typeof item === 'object' && item !== null) {
        return substituteVars(item, vars);
      } else {
        return item;
      }
    });
  }
  
  // Handle plain objects
  const result = {};
  for (const [key, val] of Object.entries(args)) {
    if (typeof val === 'string') {
      result[key] = resolveVar(val, vars);
    } else if (Array.isArray(val)) {
      result[key] = substituteVars(val, vars);
    } else if (typeof val === 'object' && val !== null) {
      result[key] = substituteVars(val, vars);
    } else {
      result[key] = val;
    }
  }
  return result;
}

/**
 * Extract usable output from a step response for the `as` capture
 * @param {object} resp - Response from sendDoRequest
 * @returns {*} - Extracted value
 */
function extractStepOutput(resp) {
  // MCP format: resp.result.content[0].text
  if (resp.result?.content?.[0]?.text) {
    const text = resp.result.content[0].text;
    // Try to parse as JSON, otherwise return raw text
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  
  // Direct value (some tools return this)
  if (resp.value !== undefined) return resp.value;
  
  // Direct result object
  if (resp.result !== undefined) return resp.result;
  
  // Fallback to the whole response
  return resp;
}

/**
 * Execute a single tool step (non-loop)
 * @param {object} step - Step to execute { cmd, args, as? }
 * @param {object} vars - Variables map (mutated if step has `as`)
 * @param {object} context - Execution context
 * @param {object} options - Execution options
 * @returns {Promise<object>} - Result { success, error?, output? }
 */
async function executeSingleStep(step, vars, context, options) {
  const { stepDelay = 100, quiet = false } = options;
  
  // Substitute variables in args
  const resolvedArgs = substituteVars(step.args || {}, vars);
  
  try {
    if (!SUPPORTED_HEADLESS_COMMANDS.has(step.cmd)) {
      return {
        success: false,
        error: `Command "${step.cmd}" is not supported by the headless-only workflow runtime.`,
      };
    }

    const resp = await runSurfHeadlessCommand(step.cmd, resolvedArgs, {
      json: true,
      onStderr: quiet ? undefined : (text) => process.stderr.write(text),
    });

    // Capture output if step has `as` field
    if (step.as) {
      const output = extractStepOutput(resp);
      vars[step.as] = output;
    }

    // Delay between steps
    if (stepDelay > 0) {
      await new Promise(r => setTimeout(r, stepDelay));
    }
    
    return { success: true, output: step.as ? vars[step.as] : undefined };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Execute a single step, handling loops recursively
 * @param {object} step - Step to execute (may be a loop or regular step)
 * @param {object} vars - Variables map
 * @param {object} context - Execution context
 * @param {object} options - Execution options
 * @param {function} onProgress - Progress callback for streaming output
 * @returns {Promise<object>} - Result { success, error?, stepsExecuted }
 */
async function executeStep(step, vars, context, options, onProgress) {
  const { onError = 'stop' } = options;
  
  // Handle `repeat` loop
  if (step.repeat !== undefined) {
    // Resolve repeat count (may be a variable)
    let max = resolveVar(step.repeat, vars);
    if (typeof max === 'string') max = parseInt(max, 10);
    if (typeof max !== 'number' || isNaN(max)) max = 1;
    
    // Safety cap
    max = Math.min(max, MAX_LOOP_ITERATIONS);
    
    if (!Array.isArray(step.steps) || step.steps.length === 0) {
      return { success: false, error: 'repeat: steps array required', stepsExecuted: 0 };
    }
    
    let totalExecuted = 0;
    
    for (let i = 0; i < max; i++) {
      // Create loop-scoped variables
      const loopVars = { ...vars, _index: i, _iteration: i + 1 };
      
      // Execute nested steps
      for (const nestedStep of step.steps) {
        const result = await executeStep(nestedStep, loopVars, context, options, onProgress);
        totalExecuted += result.stepsExecuted || 1;
        
        if (!result.success && onError === 'stop') {
          return { success: false, error: result.error, stepsExecuted: totalExecuted };
        }
      }
      
      // Copy captured variables back to parent scope (only from regular steps, not loops)
      for (const nestedStep of step.steps) {
        // Skip loop steps - their 'as' is the loop variable, not an output capture
        const isNestedLoop = nestedStep.repeat !== undefined || nestedStep.each !== undefined;
        if (!isNestedLoop && nestedStep.as && loopVars[nestedStep.as] !== undefined) {
          vars[nestedStep.as] = loopVars[nestedStep.as];
        }
      }
      
      // Check `until` condition
      if (step.until) {
        const untilResult = await executeSingleStep(step.until, loopVars, context, options);
        totalExecuted++;
        
        // Exit loop if until condition is truthy
        const exitValue = untilResult.output;
        if (exitValue === true || exitValue === 'true' || exitValue) {
          break;
        }
      }
    }
    
    return { success: true, stepsExecuted: totalExecuted };
  }
  
  // Handle `each` loop
  if (step.each !== undefined) {
    const items = resolveVar(step.each, vars);
    
    if (!Array.isArray(items)) {
      return { 
        success: false, 
        error: `each: expected array, got ${typeof items}${items === undefined ? ' (undefined)' : ''}`, 
        stepsExecuted: 0 
      };
    }
    
    if (!Array.isArray(step.steps) || step.steps.length === 0) {
      return { success: false, error: 'each: steps array required', stepsExecuted: 0 };
    }
    
    // Safety cap
    const maxItems = Math.min(items.length, MAX_LOOP_ITERATIONS);
    const itemVar = step.as || 'item';
    let totalExecuted = 0;
    
    for (let i = 0; i < maxItems; i++) {
      // Create loop-scoped variables
      const loopVars = { ...vars, [itemVar]: items[i], _index: i, _iteration: i + 1 };
      
      // Execute nested steps
      for (const nestedStep of step.steps) {
        const result = await executeStep(nestedStep, loopVars, context, options, onProgress);
        totalExecuted += result.stepsExecuted || 1;
        
        if (!result.success && onError === 'stop') {
          return { success: false, error: result.error, stepsExecuted: totalExecuted };
        }
      }
      
      // Copy captured variables back to parent scope (only from regular steps, not loops)
      for (const nestedStep of step.steps) {
        // Skip loop steps - their 'as' is the loop variable, not an output capture
        const isNestedLoop = nestedStep.repeat !== undefined || nestedStep.each !== undefined;
        if (!isNestedLoop && nestedStep.as && loopVars[nestedStep.as] !== undefined) {
          vars[nestedStep.as] = loopVars[nestedStep.as];
        }
      }
    }
    
    return { success: true, stepsExecuted: totalExecuted };
  }
  
  // Regular step (non-loop)
  if (onProgress) {
    onProgress(step, 'start');
  }
  
  const result = await executeSingleStep(step, vars, context, options);
  
  if (onProgress) {
    onProgress(step, result.success ? 'ok' : 'fail', result.error);
  }
  
  return { ...result, stepsExecuted: 1 };
}

/**
 * Execute all workflow steps sequentially
 * @param {Array<object>} steps - Steps to execute
 * @param {object} options - Execution options
 * @returns {Promise<object>} - Execution result
 */
async function executeDoSteps(steps, options = {}) {
  const {
    onError = 'stop',
    autoWait = true,
    stepDelay = 100,
    context = {},
    quiet = false,  // For --json mode, suppress streaming output
    vars: initialVars = {},
  } = options;
  
  const results = [];
  const vars = { ...initialVars, ...(context.vars || {}) };
  const total = steps.length;
  let failed = 0;
  let stepsExecuted = 0;
  const startTotal = Date.now();
  
  for (let i = 0; i < total; i++) {
    const step = steps[i];
    const startTime = Date.now();
    
    // Check if this is a loop step
    const isLoop = step.repeat !== undefined || step.each !== undefined;
    
    if (isLoop) {
      // Loops handle their own progress output
      if (!quiet) {
        const loopType = step.repeat !== undefined ? `repeat ${step.repeat}` : `each ${step.each}`;
        console.log(`[${i + 1}/${total}] Loop: ${loopType} (${step.steps?.length || 0} nested steps)`);
      }
      
      const result = await executeStep(step, vars, context, { onError, autoWait, stepDelay, quiet }, null);
      const ms = Date.now() - startTime;
      
      stepsExecuted += result.stepsExecuted || 0;
      
      if (!result.success) {
        results.push({ step: i + 1, type: 'loop', status: 'error', error: result.error, ms });
        failed++;
        
        if (onError === 'stop') {
          return { 
            status: 'failed', 
            completedSteps: stepsExecuted, 
            totalSteps: total, 
            results, 
            error: result.error,
            totalMs: Date.now() - startTotal,
            vars
          };
        }
      } else {
        results.push({ step: i + 1, type: 'loop', status: 'ok', stepsExecuted: result.stepsExecuted, ms });
        if (!quiet) {
          console.log(`     Loop completed: ${result.stepsExecuted} steps (${ms}ms)`);
        }
      }
    } else {
      // Regular step
      const stepNum = `[${i + 1}/${total}]`;
      const argSummary = Object.entries(step.args || {})
        .map(([k, v]) => typeof v === "string" && v.length > 40 
          ? `${k}="${v.slice(0, 37)}..."` 
          : `${k}=${JSON.stringify(v)}`)
        .join(" ");
      const desc = argSummary ? `${step.cmd} ${argSummary}` : step.cmd;
      
      if (!quiet) {
        process.stdout.write(`${stepNum} ${desc} ... `);
      }
      
      const result = await executeSingleStep(step, vars, context, { onError, autoWait, stepDelay, quiet });
      const ms = Date.now() - startTime;
      stepsExecuted++;
      
      if (!result.success) {
        if (!quiet) {
          console.log('FAIL');
          console.log(`     Error: ${result.error}`);
        }
        
        results.push({ step: i + 1, cmd: step.cmd, status: 'error', error: result.error, ms });
        failed++;
        
        if (onError === 'stop') {
          return { 
            status: 'failed', 
            completedSteps: stepsExecuted - 1, 
            totalSteps: total, 
            results, 
            error: result.error,
            totalMs: Date.now() - startTotal,
            vars
          };
        }
      } else {
        if (!quiet) {
          console.log(`OK (${ms}ms)`);
        }
        results.push({ step: i + 1, cmd: step.cmd, status: 'ok', ms });
      }
    }
  }
  
  return { 
    status: failed > 0 ? 'partial' : 'completed', 
    completedSteps: stepsExecuted, 
    totalSteps: total, 
    results,
    failed,
    totalMs: Date.now() - startTotal,
    vars
  };
}

module.exports = { 
  executeDoSteps, 
  shouldAutoWait,
  getAutoWaitCommand,
  substituteVars,
  resolveVar,
  extractStepOutput,
  executeStep,
  executeSingleStep,
  AUTO_WAIT_COMMANDS,
  AUTO_WAIT_MAP,
  MAX_LOOP_ITERATIONS
};

```

File: /Users/danielsivan/dev/surf-cli/README.md
```md
<p>
  <img src="surf-banner.png" alt="surf" width="1100">
</p>

# surf-cli

**Headless terminal AI for ChatGPT and Gemini.**

[![npm version](https://img.shields.io/npm/v/surf-cli?style=for-the-badge)](https://www.npmjs.com/package/surf-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

`surf` lets agents and shell scripts use signed-in ChatGPT and Gemini accounts from the terminal. It is local-first, prompt-file friendly, and built for long-running AI workflows.

```bash
npm install -g surf-cli

surf chatgpt "Review this patch" --file diff.patch --model pro --profile user@gmail.com
surf gemini "Summarize this dataset" --file data.csv --model gemini-3-pro --profile user@gmail.com
surf chatgpt.chats --search "release notes" --profile user@gmail.com
surf session --all
```

## What runs under the hood

- **ChatGPT**: CloakBrowser headless Chromium via CDP.
- **Gemini**: Bun WebView headless runtime.
- **Auth**: use an existing local profile with `--profile user@gmail.com`.
- **Agent integration**: `surf server` exposes the MCP server over stdio.
- **Sessions**: AI runs are logged under `~/.surf/sessions/` for inspection and reconciliation.

## Requirements

- Node.js and npm for the `surf` CLI.
- ChatGPT uses the bundled CloakBrowser runtime.
- Gemini requires `bun` on `PATH` for the Bun WebView runtime.
- `--profile <email>` profile selection is currently macOS-only; without it, ChatGPT uses `~/.surf/cloak-profile`.

## Installation

```bash
npm install -g surf-cli
surf --version
```

For development:

```bash
git clone https://github.com/nicobailon/surf-cli.git
cd surf-cli
npm install
npm test
npm run check
```

## Commands

### `surf chatgpt`

Send a prompt to ChatGPT through the CloakBrowser headless runtime.

```bash
surf chatgpt "Explain this error" --profile user@gmail.com
surf chatgpt --prompt-file prompt.md --model gpt-5.4-pro --profile user@gmail.com
surf chatgpt "Review this file" --file code.ts --model thinking --profile user@gmail.com
surf chatgpt "A robot surfing a neon wave" --generate-image /tmp/robot.png --profile user@gmail.com
```

Common options:

- `--profile <email>`: local profile email to use for signed-in auth.
- `--model <model>`: `instant`, `thinking`, `pro`, or provider model names such as `gpt-5.4-pro`.
- `--file <path>`: attach a file.
- `--prompt-file <path>`: read the prompt from a file.
- `--generate-image <path>`: generate an image and save it.
- `--timeout <seconds>`: inactivity timeout. Default: `2700` seconds.

### `surf gemini`

Send a prompt to Gemini through the Bun WebView headless runtime.

```bash
surf gemini "Explain quantum computing" --profile user@gmail.com
surf gemini "Analyze this CSV" --file data.csv --model gemini-3-pro --profile user@gmail.com
surf gemini "A robot surfing" --generate-image /tmp/gemini.png --aspect-ratio 16:9 --profile user@gmail.com
surf gemini "Add sunglasses" --edit-image photo.jpg --output edited.jpg --profile user@gmail.com
surf gemini "Summarize this video" --youtube "https://youtube.com/watch?v=..." --profile user@gmail.com
```

Common options:

- `--profile <email>`: local profile email to use for signed-in auth.
- `--model <model>`: Gemini model name, such as `gemini-3-pro`, `gemini-2.5-pro`, or `gemini-2.5-flash`.
- `--file <path>`: attach a file.
- `--generate-image <path>`: generate an image and save it.
- `--edit-image <path> --output <path>`: edit an existing image.
- `--youtube <url>`: analyze a YouTube video URL.
- `--aspect-ratio <ratio>`: image ratio such as `1:1` or `16:9`.
- `--timeout <seconds>`: request timeout. Default: `300` seconds.

### `surf chatgpt.chats`

List, search, view, export, rename, delete, and download ChatGPT conversation data.

```bash
surf chatgpt.chats --profile user@gmail.com
surf chatgpt.chats --search "auth bug" --profile user@gmail.com
surf chatgpt.chats <conversation-id> --profile user@gmail.com
surf chatgpt.chats <conversation-id> --export /tmp/chat.md --format markdown --profile user@gmail.com
surf chatgpt.chats <conversation-id> --rename "New title" --profile user@gmail.com
surf chatgpt.chats <conversation-id> --download-file file-abc --output /tmp/file.bin --profile user@gmail.com
```

Useful options:

- `--limit <n>`: list count or last N visible messages when viewing.
- `--all`: fetch all conversations.
- `--search <query>`: search conversation titles and content.
- `--export <path>` and `--format markdown|json`: save a viewed conversation.
- `--rename <title>`: rename a conversation.
- `--delete` or `--delete-ids <ids>`: delete conversations.
- `--download-file <file-id> --output <path>`: download an attachment.
- `--no-cache`: bypass local chats cache.

### `surf chatgpt.reply`

Reply inside an existing ChatGPT conversation.

```bash
surf chatgpt.reply <conversation-id> "Follow up with a shorter version" --profile user@gmail.com
surf chatgpt.reply <conversation-id> --prompt-file followup.md --model gpt-5.4-thinking --profile user@gmail.com
```

### `surf session`

Inspect and clean up saved AI sessions.

```bash
surf session
surf session --all
surf session <session-id>
surf session --reconcile
surf session --reconcile --network
surf session --clear
surf session --clear --hours 24
```

Session records include stderr logs, results, model metadata, conversation IDs, process IDs, and reconciliation status.

### `surf do`

Parse and run supported commands as a workflow.

```bash
surf do 'chatgpt "Draft release notes" --profile user@gmail.com | gemini "Make it concise" --profile user@gmail.com'
surf do 'chatgpt "Review this" --file diff.patch --profile user@gmail.com' --dry-run
surf do --file workflow.json --on-error continue
```

Use `--dry-run` to validate a workflow without executing it.

### `surf server`

Start the MCP server for AI-agent integration over stdio.

```bash
surf server
```

Use this when configuring an MCP-capable agent to call surf tools directly.

## Model shortcuts

ChatGPT accepts both shortcuts and provider names:

| Shortcut | Maps to |
| --- | --- |
| `instant` | fast ChatGPT model |
| `thinking` | reasoning ChatGPT model |
| `pro` | highest-capability ChatGPT model |

You can also pass explicit model names, for example `gpt-5.4-pro` or `gemini-3-pro`.

## Profile auth

Use `--profile user@gmail.com` on ChatGPT and Gemini commands to select the local signed-in profile for that account.

```bash
surf chatgpt "Hello" --profile user@gmail.com
surf gemini "Hello" --profile user@gmail.com
```

If auth is missing or expired, sign in with the relevant account in that local profile, then retry the command.

## Files and images

Attach files:

```bash
surf chatgpt "Review this" --file code.ts --profile user@gmail.com
surf gemini "Summarize" --file report.pdf --profile user@gmail.com
```

Generate images:

```bash
surf chatgpt "A watercolor lighthouse" --generate-image /tmp/lighthouse.png --profile user@gmail.com
surf gemini "A cyberpunk cat" --generate-image /tmp/cat.png --aspect-ratio 1:1 --profile user@gmail.com
```

Edit images with Gemini:

```bash
surf gemini "Remove the background" --edit-image photo.jpg --output cutout.png --profile user@gmail.com
```

## MCP integration

Start the stdio MCP server:

```bash
surf server
```

Then point your MCP-capable agent at the `surf` binary with the `server` argument.

## Troubleshooting

- Run `surf --help` for the current command summary.
- Run `surf <command> --help` for command-specific options.
- Run `surf session <id>` to inspect a failed or long-running AI request.
- Use `--timeout <seconds>` for long prompts, file uploads, or image generation.
- Use `--profile <email>` consistently when multiple local accounts are signed in.

## License

MIT

```

File: /Users/danielsivan/dev/surf-cli/package.json
```json
{
  "name": "surf-cli",
  "version": "2.11.1",
  "description": "Headless terminal AI tool for ChatGPT and Gemini.",
  "keywords": [
    "chatgpt",
    "gemini",
    "ai",
    "agent",
    "cli",
    "headless",
    "mcp"
  ],
  "author": "Nico Bailon",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/nicobailon/surf-cli.git"
  },
  "bugs": {
    "url": "https://github.com/nicobailon/surf-cli/issues"
  },
  "homepage": "https://github.com/nicobailon/surf-cli#readme",
  "type": "module",
  "bin": {
    "surf": "native/cli.cjs"
  },
  "files": [
    "native/",
    "skills/",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "check": "tsc --noEmit",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "lint:test": "biome check test/",
    "format": "biome format --write .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:ui": "vitest --ui",
    "test:e2e:cloak:local": "SURF_E2E_CLOAK_CHATGPT_LOCAL=1 vitest run test/e2e/chatgpt-cloak-local.test.ts"
  },
  "dependencies": {
    "@google/generative-ai": "^0.24.1",
    "@modelcontextprotocol/sdk": "^1.26.0",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.9",
    "@types/node": "^25.5.0",
    "@vitest/coverage-v8": "^4.0.18",
    "@vitest/ui": "^4.0.18",
    "typescript": "^5.7.2",
    "vitest": "^4.0.18"
  },
  "optionalDependencies": {
    "cloakbrowser": "^0.3.24",
    "playwright-core": "^1.58.2"
  }
}

```

File: /Users/danielsivan/dev/surf-cli/native/gemini-bun-bridge.cjs
```cjs
/**
 * Bridge module: spawns the Bun WebView worker for Gemini queries.
 *
 * Handles:
 *  - Bun executable detection
 *  - Eligibility checks (--with-page is not supported by the headless worker)
 *  - Worker spawn + stdin/stdout JSON protocol
 *  - Structured errors
 */

const { execFileSync, spawn } = require("child_process");
const path = require("path");

// ============================================================================
// Bun detection
// ============================================================================

let _bunPath = undefined; // cache

function detectBunPath() {
  if (_bunPath !== undefined) return _bunPath;
  try {
    const out = execFileSync("which", ["bun"], {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    _bunPath = out || null;
  } catch {
    _bunPath = null;
  }
  return _bunPath;
}

// ============================================================================
// Eligibility
// ============================================================================

/**
 * Check whether the given CLI args are eligible for the Bun path.
 *
 * @param {object} args - Parsed tool args from CLI
 * @returns {{ eligible: boolean, reason?: string }}
 */
function isBunGeminiEligible(args) {
  if (args.withPage || args["with-page"]) {
    return { eligible: false, reason: "with_page" };
  }
  if (process.platform === "win32") {
    return { eligible: false, reason: "unsupported_platform" };
  }
  if (args.profile && process.platform !== "darwin") {
    return { eligible: false, reason: "profile_unsupported_platform" };
  }
  const bun = detectBunPath();
  if (!bun) {
    return { eligible: false, reason: "bun_not_found" };
  }
  return { eligible: true };
}

// ============================================================================
// Worker protocol
// ============================================================================

/**
 * Build the worker request payload from CLI-parsed args.
 *
 * @param {object} args
 * @param {string} args.query       - User prompt
 * @param {string} [args.model]     - Model name
 * @param {string} [args.file]      - Absolute file path
 * @param {string} [args.generateImage] - Absolute output path for generated image
 * @param {string} [args.editImage] - Absolute path to image to edit
 * @param {string} [args.output]    - Explicit output path
 * @param {string} [args.youtube]   - YouTube URL
 * @param {string} [args.aspectRatio] - Aspect ratio
 * @param {number} [args.timeout]   - Timeout in **seconds** (CLI convention)
 * @returns {object}
 */
function buildWorkerRequest(args) {
  // CLI --timeout is always in seconds; always multiply by 1000.
  // Cap at 24h (86400s) to catch accidental ms values passed directly.
  const MAX_TIMEOUT_S = 86400;
  let timeoutMs = 300000;
  if (args.timeout != null && args.timeout > 0) {
    const secs = Math.min(Number(args.timeout), MAX_TIMEOUT_S);
    timeoutMs = secs * 1000;
  }
  return {
    prompt: args.query || "",
    model: args.model || undefined,
    file: args.file || null,
    generateImage: args.generateImage || args["generate-image"] || null,
    editImage: args.editImage || args["edit-image"] || null,
    output: args.output || null,
    youtube: args.youtube || null,
    aspectRatio: args.aspectRatio || args["aspect-ratio"] || null,
    timeoutMs,
    profileEmail: args.profile || null,
  };
}

// ============================================================================
// Spawn
// ============================================================================

/**
 * Run the Gemini Bun worker.
 *
 * @param {object} args - CLI-parsed tool args
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs] - Kill worker after this many ms
 * @returns {Promise<{ ok: true, result: object } | { ok: false, error: string, code: string }>}
 */
async function runGeminiViaBun(args, opts = {}) {
  const bunPath = detectBunPath();
  if (!bunPath) {
    return {
      ok: false,
      code: "bun_not_found",
      error: "Bun executable not found. Install Bun for headless Gemini.",
    };
  }

  const workerPath = path.join(__dirname, "gemini-bun-worker.ts");
  const request = buildWorkerRequest(args);
  const timeoutMs = opts.timeoutMs || request.timeoutMs || 300000;

  return new Promise((resolve) => {
    let resolved = false;
    let stdout = "";
    let stderr = "";

    const child = spawn(bunPath, [workerPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      timeout: timeoutMs + 5000, // give worker 5s grace beyond its internal timeout
    });

    // Send request
    child.stdin.write(JSON.stringify(request));
    child.stdin.end();

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      // Forward worker diagnostics to CLI stderr
      process.stderr.write(chunk);
    });

    const killTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { child.kill("SIGKILL"); } catch {}
        resolve({
          ok: false,
          code: "timeout",
          error: `Bun worker killed after ${timeoutMs}ms`,
        });
      }
    }, timeoutMs + 5000);

    child.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(killTimer);
      resolve({
        ok: false,
        code: "spawn_failed",
        error: `Failed to spawn Bun worker: ${err.message}`,
      });
    });

    child.on("close", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(killTimer);

      // Parse worker response from stdout
      const lines = stdout.trim().split("\n").filter(Boolean);
      const lastLine = lines[lines.length - 1];

      if (!lastLine) {
        resolve({
          ok: false,
          code: "protocol_error",
          error: `Bun worker produced no output (exit ${code}). stderr: ${stderr.slice(0, 300)}`,
        });
        return;
      }

      try {
        const response = JSON.parse(lastLine);
        if (response.ok === true && response.result) {
          resolve({ ok: true, result: response.result });
        } else if (response.ok === false) {
          resolve({
            ok: false,
            code: response.code || "unknown",
            error: response.error || "Bun worker error",
          });
        } else {
          resolve({
            ok: false,
            code: "protocol_error",
            error: `Unexpected worker response shape: ${lastLine.slice(0, 200)}`,
          });
        }
      } catch (parseErr) {
        resolve({
          ok: false,
          code: "protocol_error",
          error: `Failed to parse worker JSON: ${parseErr.message}. Output: ${lastLine.slice(0, 200)}`,
        });
      }
    });
  });
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  isBunGeminiEligible,
  runGeminiViaBun,
  detectBunPath,
  buildWorkerRequest,
};

```

File: /Users/danielsivan/dev/surf-cli/test/unit/do-executor.test.ts
```ts
import { describe, expect, it } from "vitest";

// @ts-expect-error - CommonJS module without type definitions
import * as executor from "../../native/do-executor.cjs";

describe("shouldAutoWait", () => {
  it("returns false after browser auto-waits were removed", () => {
    expect(executor.shouldAutoWait("chatgpt")).toBe(false);
    expect(executor.shouldAutoWait("gemini")).toBe(false);
    expect(executor.shouldAutoWait("click")).toBe(false);
  });
});

describe("getAutoWaitCommand", () => {
  it("returns null because headless AI commands do not need browser auto-waits", () => {
    expect(executor.getAutoWaitCommand("chatgpt")).toBe(null);
    expect(executor.getAutoWaitCommand("gemini")).toBe(null);
    expect(executor.getAutoWaitCommand("click")).toBe(null);
  });
});

describe("substituteVars", () => {
  it("substitutes variables in strings", () => {
    const args = { url: "https://%{domain}/path" };
    const vars = { domain: "example.com" };
    const result = executor.substituteVars(args, vars);
    expect(result.url).toBe("https://example.com/path");
  });

  it("keeps undefined variables as-is", () => {
    const args = { url: "https://%{domain}/path" };
    const vars = {};
    const result = executor.substituteVars(args, vars);
    expect(result.url).toBe("https://%{domain}/path");
  });

  it("handles multiple variables", () => {
    const args = { text: "%{greeting} %{name}!" };
    const vars = { greeting: "Hello", name: "World" };
    const result = executor.substituteVars(args, vars);
    expect(result.text).toBe("Hello World!");
  });

  it("preserves non-string values", () => {
    const args = { x: 100, enabled: true, text: "%{val}" };
    const vars = { val: "test" };
    const result = executor.substituteVars(args, vars);
    expect(result.x).toBe(100);
    expect(result.enabled).toBe(true);
    expect(result.text).toBe("test");
  });

  it("handles null and undefined args", () => {
    expect(executor.substituteVars(null, {})).toBe(null);
    expect(executor.substituteVars(undefined, {})).toBe(undefined);
  });
});

describe("executeSingleStep", () => {
  it("rejects commands outside the headless workflow runtime", async () => {
    const result = await executor.executeSingleStep(
      { cmd: "screenshot", args: {} },
      {},
      {},
      { quiet: true },
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("not supported by the headless-only workflow runtime");
  });
});

describe("AUTO_WAIT_COMMANDS", () => {
  it("is empty in headless-only mode", () => {
    expect(executor.AUTO_WAIT_COMMANDS).toEqual([]);
  });
});

describe("AUTO_WAIT_MAP", () => {
  it("is empty in headless-only mode", () => {
    expect(executor.AUTO_WAIT_MAP).toEqual({});
  });
});

```

File: /Users/danielsivan/dev/surf-cli/native/headless-command-runner.cjs
```cjs
const { spawn } = require("node:child_process");
const path = require("node:path");

const CLI_PATH = path.join(__dirname, "cli.cjs");
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_RUNNER_TIMEOUT_MS = 60 * 60 * 1000;
const SUPPORTED_HEADLESS_COMMANDS = new Set([
  "chatgpt",
  "gemini",
  "chatgpt.chats",
  "chatgpt.reply",
]);

function optionName(key) {
  return String(key)
    .replace(/_/g, "-")
    .replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function appendOption(argv, key, value) {
  if (value === undefined || value === null || value === false) return;
  const flag = `--${optionName(key)}`;
  if (value === true) {
    argv.push(flag);
    return;
  }
  if (Array.isArray(value)) {
    argv.push(flag, value.join(","));
    return;
  }
  argv.push(flag, String(value));
}

function buildCliArgs(command, args = {}, options = {}) {
  if (!SUPPORTED_HEADLESS_COMMANDS.has(command)) {
    throw new Error(`Command "${command}" is not supported by the headless-only workflow runtime.`);
  }

  const argv = [command];
  const consumed = new Set();
  const consume = (key) => {
    consumed.add(key);
    return args[key];
  };

  if (command === "chatgpt" || command === "gemini") {
    const query = consume("query");
    const promptArg = consume("prompt");
    const prompt = query ?? promptArg;
    if (prompt !== undefined) argv.push(String(prompt));
  } else if (command === "chatgpt.chats") {
    const camelConversationId = consume("conversationId");
    const kebabConversationId = consume("conversation-id");
    const conversationId = camelConversationId ?? kebabConversationId;
    if (conversationId !== undefined) argv.push(String(conversationId));
  } else if (command === "chatgpt.reply") {
    const camelConversationId = consume("conversationId");
    const kebabConversationId = consume("conversation-id");
    const conversationId = camelConversationId ?? kebabConversationId;
    const promptArg = consume("prompt");
    const query = consume("query");
    const prompt = promptArg ?? query;
    if (conversationId !== undefined) argv.push(String(conversationId));
    if (prompt !== undefined) argv.push(String(prompt));
  }

  for (const [key, value] of Object.entries(args || {})) {
    if (consumed.has(key)) continue;
    appendOption(argv, key, value);
  }

  if (options.json !== false && !argv.includes("--json")) {
    argv.push("--json");
  }

  return argv;
}

function parseJsonOutput(stdout) {
  const trimmed = String(stdout || "").trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return { text: trimmed };
  }
}

function resolveRunnerTimeoutMs(args = {}, options = {}) {
  if (options.timeoutMs === false || options.timeoutMs === 0) return 0;
  if (Number.isFinite(options.timeoutMs) && options.timeoutMs > 0) return options.timeoutMs;
  const requestSeconds = Number(args.timeout);
  if (Number.isFinite(requestSeconds) && requestSeconds > 0) {
    return (requestSeconds + 30) * 1000;
  }
  return DEFAULT_RUNNER_TIMEOUT_MS;
}

function runSurfHeadlessCommand(command, args = {}, options = {}) {
  return new Promise((resolve, reject) => {
    let argv;
    try {
      argv = buildCliArgs(command, args, { json: options.json });
    } catch (error) {
      reject(error);
      return;
    }

    const child = spawn(process.execPath, [CLI_PATH, ...argv], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...(options.env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeoutMs = resolveRunnerTimeoutMs(args, options);
    const timeout = timeoutMs > 0
      ? setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGTERM");
        const error = new Error(`${command} failed: runner timed out after ${timeoutMs}ms`);
        error.code = "runner_timeout";
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }, timeoutMs)
      : null;
    const clearRunnerTimeout = () => {
      if (timeout) clearTimeout(timeout);
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (options.onStdout) options.onStdout(chunk.toString());
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (options.onStderr) options.onStderr(text);
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearRunnerTimeout();
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearRunnerTimeout();
      if (code === 0) {
        resolve({
          command,
          args: argv,
          stdout,
          stderr,
          result: options.json === false ? stdout : parseJsonOutput(stdout),
        });
        return;
      }

      const detail = stderr.trim() || stdout.trim() || (signal ? `killed by ${signal}` : `exit code ${code}`);
      const error = new Error(`${command} failed: ${detail}`);
      error.code = code;
      error.signal = signal;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

module.exports = {
  DEFAULT_RUNNER_TIMEOUT_MS,
  SUPPORTED_HEADLESS_COMMANDS,
  buildCliArgs,
  resolveRunnerTimeoutMs,
  runSurfHeadlessCommand,
};

```

File: /Users/danielsivan/dev/surf-cli/test/unit/mcp-server.test.ts
```ts
import { describe, expect, it } from "vitest";

const {
  TOOL_SCHEMAS,
  formatResultPayload,
  normalizeToolArgs,
  runMcpHeadlessTool,
  validateMcpArgs,
} = require("../../native/mcp-server.cjs");

describe("mcp-server headless tool surface", () => {
  it("registers only supported headless tools", () => {
    expect(Object.keys(TOOL_SCHEMAS).sort()).toEqual([
      "chatgpt",
      "chatgpt.chats",
      "chatgpt.reply",
      "gemini",
    ]);
  });

  it("normalizes prompt args for prompt-based tools", () => {
    expect(normalizeToolArgs("chatgpt", { prompt: "hello", model: "pro" })).toEqual({
      query: "hello",
      model: "pro",
    });
    expect(normalizeToolArgs("gemini", { prompt: "hello" })).toEqual({ query: "hello" });
  });

  it("formats provider response text as MCP text content", () => {
    expect(formatResultPayload({ result: { response: "ok" } })).toEqual({
      content: [{ type: "text", text: "ok" }],
    });
  });

  it("preserves provider metadata alongside response text", () => {
    const formatted = formatResultPayload({ result: { response: "ok", model: "gpt", conversationId: "abc" } });
    expect(formatted.content[0].text).toBe("ok");
    expect(formatted.content[1].text).toContain('"conversationId"');
  });

  it("formats arbitrary objects as JSON MCP text content", () => {
    const formatted = formatResultPayload({ result: { conversations: [{ id: "abc" }] } });
    expect(formatted.content[0].text).toContain('"conversations"');
  });

  it("formats raw string payloads as MCP text content", () => {
    expect(formatResultPayload("hello")).toEqual({ content: [{ type: "text", text: "hello" }] });
  });

  it("formats text property payloads as MCP text content", () => {
    expect(formatResultPayload({ result: { text: "hello" } })).toEqual({
      content: [{ type: "text", text: "hello" }],
    });
  });

  it("formats empty payloads as JSON object text", () => {
    expect(formatResultPayload(undefined)).toEqual({ content: [{ type: "text", text: "{}" }] });
  });

  it("leaves conversation args unchanged when no prompt normalization is needed", () => {
    expect(normalizeToolArgs("chatgpt.chats", { conversationId: "abc", limit: 1 })).toEqual({
      conversationId: "abc",
      limit: 1,
    });
  });

  it("accepts prompt-file-only ChatGPT MCP args", () => {
    expect(() => validateMcpArgs("chatgpt", { promptFile: "prompt.md" })).not.toThrow();
  });

  it("accepts prompt-file-only ChatGPT reply MCP args", () => {
    expect(() => validateMcpArgs("chatgpt.reply", { conversationId: "abc", promptFile: "reply.md" })).not.toThrow();
  });

  it("rejects ChatGPT MCP args without prompt input", () => {
    expect(() => validateMcpArgs("chatgpt", { model: "pro" })).toThrow("requires prompt or promptFile");
  });

  it("does not mutate MCP args during normalization", () => {
    const args = { prompt: "hello", profile: "user@example.com" };
    normalizeToolArgs("chatgpt", args);
    expect(args).toEqual({ prompt: "hello", profile: "user@example.com" });
  });

  it("runs tools through the injected headless runner", async () => {
    const calls: any[] = [];
    const response = await runMcpHeadlessTool(
      "chatgpt",
      { prompt: "hello", profile: "user@example.com" },
      async (...args: any[]) => {
        calls.push(args);
        return { result: { response: "done" } };
      },
    );

    expect(calls[0][0]).toBe("chatgpt");
    expect(calls[0][1]).toEqual({ query: "hello", profile: "user@example.com" });
    expect(calls[0][2]).toEqual({ json: true });
    expect(response).toEqual({ content: [{ type: "text", text: "done" }] });
  });

  it("passes Gemini args through the injected headless runner", async () => {
    const calls: any[] = [];
    const response = await runMcpHeadlessTool(
      "gemini",
      { prompt: "hello", aspectRatio: "16:9" },
      async (...args: any[]) => {
        calls.push(args);
        return { result: { response: "gemini done" } };
      },
    );

    expect(calls[0][0]).toBe("gemini");
    expect(calls[0][1]).toEqual({ query: "hello", aspectRatio: "16:9" });
    expect(response.content[0].text).toBe("gemini done");
  });

  it("passes reply args through the injected headless runner", async () => {
    const calls: any[] = [];
    await runMcpHeadlessTool("chatgpt.reply", { conversationId: "abc", prompt: "hello" }, async (...args: any[]) => {
      calls.push(args);
      return { result: { response: "ok" } };
    });

    expect(calls[0][1]).toEqual({ conversationId: "abc", prompt: "hello" });
  });

  it("returns MCP errors when the runner fails", async () => {
    const response = await runMcpHeadlessTool("gemini", { prompt: "hello" }, async () => {
      throw new Error("boom");
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("boom");
  });
});

```

File: /Users/danielsivan/dev/surf-cli/native/gemini-common.cjs
```cjs
/**
 * Shared Gemini helpers used by both legacy HTTP path and Bun WebView worker.
 * Pure sync functions — no state, no I/O.
 */

// ============================================================================
// Constants
// ============================================================================

const GEMINI_APP_URL = "https://gemini.google.com/app";

// ---------------------------------------------------------------------------
// Auth cookie allow-lists (shared by legacy HTTP path + Bun WebView worker)
// ---------------------------------------------------------------------------

const REQUIRED_COOKIES = ["__Secure-1PSID", "__Secure-1PSIDTS"];

const ALL_COOKIE_NAMES = [
  "__Secure-1PSID",
  "__Secure-1PSIDTS",
  "__Secure-1PSIDCC",
  "__Secure-1PAPISID",
  "NID",
  "AEC",
  "SOCS",
  "__Secure-BUCKET",
  "__Secure-ENID",
  "SID",
  "HSID",
  "SSID",
  "APISID",
  "SAPISID",
  "__Secure-3PSID",
  "__Secure-3PSIDTS",
  "__Secure-3PAPISID",
  "SIDCC",
];

const DEFAULT_GEMINI_MODEL = "gemini-3-pro";

const SUPPORTED_GEMINI_MODELS = [
  "gemini-3-pro",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
];

const MODEL_HEADER_NAME = "x-goog-ext-525001261-jspb";

// Best-effort only — these private IDs may drift.
// Use SURF_GEMINI_MODEL_HEADERS env to override.
const MODEL_HEADERS = {
  "gemini-3-pro": '[1,null,null,null,"9d8ca3786ebdfbea",null,null,0,[4]]',
  "gemini-2.5-pro": '[1,null,null,null,"4af6c7f5da75d65d",null,null,0,[4]]',
  "gemini-2.5-flash": '[1,null,null,null,"9ec249fc9ad08861",null,null,0,[4]]',
};

const MODEL_HEADER_OVERRIDES = (() => {
  try {
    const p = JSON.parse(process.env.SURF_GEMINI_MODEL_HEADERS || "");
    return p && typeof p === "object" && !Array.isArray(p) ? p : {};
  } catch {
    return {};
  }
})();

// ============================================================================
// Model Resolution
// ============================================================================

/**
 * Resolve requested model to a known Gemini model string.
 * For HTTP transport: falls back to DEFAULT_GEMINI_MODEL if unknown.
 * For UI/headless transport: pass-through unknown names so trySelectModel can attempt UI selection.
 * Use resolveGeminiModelForUI() in headless workers.
 */
function resolveGeminiModel(model) {
  if (!model) return DEFAULT_GEMINI_MODEL;
  const m = String(model).trim().toLowerCase();
  if (MODEL_HEADER_OVERRIDES[m] || MODEL_HEADERS[m]) return m;
  return DEFAULT_GEMINI_MODEL;
}

/**
 * Resolve model for headless/UI mode.
 * Known models are normalised; unknown model names are passed through as-is
 * so the UI model picker can attempt to select them (e.g. gemini-3.1-pro-preview).
 */
function resolveGeminiModelForUI(model) {
  if (!model) return DEFAULT_GEMINI_MODEL;
  const m = String(model).trim().toLowerCase();
  // Known models: normalise
  if (MODEL_HEADER_OVERRIDES[m] || MODEL_HEADERS[m]) return m;
  // Unknown: pass through raw (UI picker will attempt best-effort match)
  return String(model).trim();
}

/**
 * Return ordered list of model header candidates for HTTP transport.
 * [requested-header, fallback-header, null (no-header)]
 */
function getModelHeaderCandidates(model) {
  const get = (m) => MODEL_HEADER_OVERRIDES[m] || MODEL_HEADERS[m] || null;
  const seen = new Set();
  const out = [];
  for (const h of [
    get(model),
    model !== DEFAULT_GEMINI_MODEL ? get(DEFAULT_GEMINI_MODEL) : null,
    null,
  ]) {
    const k = h ?? "__none__";
    if (!seen.has(k)) {
      seen.add(k);
      out.push(h);
    }
  }
  return out;
}

// ============================================================================
// Prompt Building
// ============================================================================

/**
 * Build the full Gemini prompt from user input + options.
 *
 * @param {object} opts
 * @param {string} opts.prompt       - User prompt text
 * @param {string} [opts.youtube]    - YouTube URL to append
 * @param {string} [opts.aspectRatio]- Aspect ratio suffix (e.g. "1:1")
 * @param {string} [opts.generateImage] - Truthy → prefix with "Generate an image:"
 * @param {string} [opts.editImage]  - Truthy → treat as edit (no prefix)
 * @returns {string}
 */
function buildGeminiPrompt(opts) {
  let prompt = opts.prompt || "";

  if (opts.aspectRatio && (opts.generateImage || opts.editImage)) {
    prompt = `${prompt} (aspect ratio: ${opts.aspectRatio})`;
  }
  if (opts.youtube) {
    prompt = `${prompt}\n\nYouTube video: ${opts.youtube}`;
  }
  if (opts.generateImage && !opts.editImage) {
    prompt = `Generate an image: ${prompt}`;
  }

  return prompt;
}

// ============================================================================
// Image URL Helpers
// ============================================================================

/**
 * Ensure a gg-dl image URL has a full-size parameter.
 */
function ensureFullSizeImageUrl(url) {
  if (url.includes("=s")) return url;
  return `${url}=s2048`;
}

/**
 * Extract unique gg-dl image URLs from raw text.
 */
function extractGgdlUrls(rawText) {
  const matches =
    rawText.match(
      /https:\/\/lh3\.googleusercontent\.com\/gg-dl\/[^\s"']+/g,
    ) ?? [];
  const seen = new Set();
  const urls = [];
  for (const match of matches) {
    if (!seen.has(match)) {
      seen.add(match);
      urls.push(match);
    }
  }
  return urls;
}

// ============================================================================
// Output Path Resolution
// ============================================================================

/**
 * Resolve the output path for image save operations.
 *
 * @param {object} opts
 * @param {string} [opts.output]        - Explicit --output path
 * @param {string} [opts.generateImage] - --generate-image path
 * @param {string} [opts.editImage]     - --edit-image path (implies editing)
 * @returns {string}
 */
function resolveImageOutputPath(opts) {
  if (opts.output) return opts.output;
  if (opts.generateImage) return opts.generateImage;
  return "edited.png";
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  GEMINI_APP_URL,
  DEFAULT_GEMINI_MODEL,
  SUPPORTED_GEMINI_MODELS,
  MODEL_HEADER_NAME,
  MODEL_HEADERS,
  MODEL_HEADER_OVERRIDES,
  resolveGeminiModel,
  resolveGeminiModelForUI,
  getModelHeaderCandidates,
  buildGeminiPrompt,
  ensureFullSizeImageUrl,
  extractGgdlUrls,
  resolveImageOutputPath,
  REQUIRED_COOKIES,
  ALL_COOKIE_NAMES,
};

```

File: /Users/danielsivan/dev/surf-cli/native/chatgpt-cloak-bridge.cjs
```cjs
/**
 * ChatGPT CloakBrowser Bridge
 *
 * Node.js module that spawns CloakBrowser workers (.mjs) and
 * communicates via stdin/stdout JSON-lines protocol.
 */

const { spawn } = require("child_process");
const { existsSync } = require("fs");
const { join, dirname } = require("path");
const {
  DEFAULT_CHATGPT_CHATS_TIMEOUT_SEC,
  resolveChatsTimeoutSeconds,
  resolveQueryTimeoutSeconds,
} = require("./chatgpt-cloak-timeout.cjs");

const DEFAULT_RUNTIME = { spawn, existsSync };
let runtime = { ...DEFAULT_RUNTIME };

const QUERY_WORKER_PATH = join(__dirname, "chatgpt-cloak-worker.mjs");
const CHATS_WORKER_PATH = join(__dirname, "chatgpt-cloak-chats-worker.mjs");

// ---------------------------------------------------------------------------
// Availability check
// ---------------------------------------------------------------------------

function isCloakBrowserAvailable() {
  try {
    let dir = __dirname;
    for (let i = 0; i < 6; i++) {
      if (runtime.existsSync(join(dir, "node_modules", "cloakbrowser", "package.json"))) return true;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return false;
  } catch {
    return false;
  }
}

function ensureAvailability(workerPath) {
  if (!isCloakBrowserAvailable()) {
    throw Object.assign(
      new Error("CloakBrowser not installed. Run: npm install cloakbrowser playwright-core"),
      { code: "cloakbrowser_not_installed" }
    );
  }

  if (!runtime.existsSync(workerPath)) {
    throw Object.assign(
      new Error("CloakBrowser worker not found: " + workerPath),
      { code: "worker_not_found" }
    );
  }
}

function runCloakWorker({ workerPath, request, timeout = DEFAULT_CHATGPT_CHATS_TIMEOUT_SEC, onProgress = () => {}, mapSuccess = (msg) => msg }) {
  ensureAvailability(workerPath);

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const clearWorkerTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        clearWorkerTimer();
        fn(value);
      }
    };

    const worker = runtime.spawn(process.execPath, [workerPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    const timeoutMs = timeout * 1000;
    const armWorkerTimer = () => {
      clearWorkerTimer();
      timer = setTimeout(() => {
        worker.kill("SIGTERM");
        settle(reject, Object.assign(new Error(`CloakBrowser worker killed after ${timeoutMs}ms`), { code: "timeout" }));
      }, timeoutMs);
    };
    armWorkerTimer();

    const handleWorkerMessage = (msg) => {
      if (msg.type === "progress" || msg.type === "trace" || msg.type === "meta_update" || msg.type === "keepalive" || msg.type === "success" || msg.type === "error") {
        armWorkerTimer();
      }
      switch (msg.type) {
        case "progress":
          onProgress(msg);
          return false;
        case "success":
          settle(resolve, mapSuccess(msg));
          return true;
        case "error":
          settle(reject, Object.assign(new Error(msg.message), { code: msg.code, details: msg.details }));
          return true;
        case "trace":
          onProgress({
            type: "trace",
            phase: msg.phase,
            isThinking: msg.isThinking,
            traceType: msg.traceType,
            thoughtText: msg.thoughtText,
            thoughtDelta: msg.thoughtDelta,
            thoughtCount: msg.thoughtCount,
            durationSec: msg.durationSec,
            recapText: msg.recapText,
          });
          return false;
        case "meta_update":
          onProgress({
            type:                       "meta_update",
            conversationId:             msg.conversationId || null,
            baselineAssistantMessageId: msg.baselineAssistantMessageId || null,
            lastCheckpoint:             msg.lastCheckpoint || null,
            sentAt:                     msg.sentAt || null,
            source:                     msg.source || null,
            t:                          msg.t || Date.now(),
          });
          return false;
        case "keepalive":
          return false;
        case "log":
          if (process.env.SURF_DEBUG) {
            process.stderr.write(`[cloak:${msg.level}] ${msg.message}\n`);
          }
          return false;
        default:
          return false;
      }
    };

    let stdoutBuf = "";
    worker.stdout.setEncoding("utf8");
    worker.stdout.on("data", (chunk) => {
      stdoutBuf += chunk;
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          handleWorkerMessage(msg);
        } catch {
          // Ignore non-JSON lines.
        }
      }
    });

    worker.stderr.setEncoding("utf8");
    worker.stderr.on("data", (chunk) => {
      if (chunk.includes("[cloakbrowser]")) {
        process.stderr.write(chunk);
      }
    });

    const tryHandleLine = (line) => {
      if (!line || !line.trim()) return false;
      try {
        const msg = JSON.parse(line);
        return handleWorkerMessage(msg);
      } catch {
        return false;
      }
    };

    worker.on("close", (code, signal) => {
      clearWorkerTimer();
      if (settled) return;
      if (stdoutBuf.trim()) {
        const handled = tryHandleLine(stdoutBuf);
        stdoutBuf = "";
        if (handled || settled) return;
      }
      if (signal) {
        settle(reject, Object.assign(new Error(`CloakBrowser worker killed by ${signal}`), { code: "worker_killed", signal }));
      } else {
        settle(reject, Object.assign(new Error(`CloakBrowser worker exited ${code} without result`), { code: "worker_exit", exitCode: code }));
      }
    });

    worker.stdin.write(JSON.stringify(request) + "\n");
  });
}

async function queryWithCloakBrowser(opts, onProgress = () => {}) {
  const timeout = resolveQueryTimeoutSeconds(opts.timeout);
  const { model, file, profile, conversationId } = opts;
  const prompt = opts.prompt || opts.query || "";
  const promptKB = (Buffer.byteLength(prompt, "utf-8") / 1024).toFixed(1);
  const estimatedTokens = Math.ceil(prompt.length / 4);
  const tokenKStr = (estimatedTokens / 1000).toFixed(1) + "K";
  if (Number(promptKB) > 10) {
    console.error(`[cloak-bridge] Prompt: ${promptKB}KB (${prompt.split("\n").length} lines, ~${tokenKStr} tokens)`);
  }
  if (estimatedTokens > 120_000) {
    console.error(`[cloak-bridge] ⚠ Prompt ~${tokenKStr} tokens — approaching GPT Pro 150K limit`);
  }
  const generateImage = opts["generate-image"] || opts.generateImage || null;

  return runCloakWorker({
    workerPath: QUERY_WORKER_PATH,
    request: {
      type: "query",
      prompt,
      model,
      file,
      profile,
      timeout,
      generateImage,
      conversationId,
    },
    timeout,
    onProgress,
    mapSuccess: (msg) => ({
      response: msg.response || msg.text || "",
      model: msg.model,
      tookMs: msg.tookMs || msg.durationMs || 0,
      imagePath: msg.imagePath || null,
      partial: !!msg.partial,
      backend: msg.backend || "cloak",
      conversationId: msg.conversationId || conversationId || null,
      ...(msg.thinkingTrace ? { thinkingTrace: msg.thinkingTrace } : {}),
    }),
  });
}

async function manageChatsWithCloakBrowser(opts, onProgress = () => {}) {
  const timeout = resolveChatsTimeoutSeconds(opts.timeout);
  const runChatsRequest = () => runCloakWorker({
    workerPath: CHATS_WORKER_PATH,
    request: {
      type: "chats",
      action: opts.action,
      conversationId: opts.conversationId,
      conversationIds: opts.conversationIds,
      query: opts.query,
      limit: opts.limit,
      all: opts.all,
      profile: opts.profile,
      timeout,
      title: opts.title,
      fileId: opts.fileId,
      includeBytes: opts.includeBytes,
      outputPath: opts.outputPath,
    },
    timeout,
    onProgress,
    mapSuccess: (msg) => {
      const out = { ...msg };
      delete out.type;
      return out;
    },
  });

  return await runChatsRequest();
}

function __setBridgeRuntimeForTests(overrides = {}) {
  runtime = { ...runtime, ...overrides };
}

function __resetBridgeRuntimeForTests() {
  runtime = { ...DEFAULT_RUNTIME };
}

module.exports = {
  isCloakBrowserAvailable,
  queryWithCloakBrowser,
  manageChatsWithCloakBrowser,
  __setBridgeRuntimeForTests,
  __resetBridgeRuntimeForTests,
};

```

File: /Users/danielsivan/dev/surf-cli/tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "declaration": false,
    "declarationMap": false,
    "sourceMap": true,
    "outDir": "./dist",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vitest/globals", "node"]
  },
  "include": ["native/**/*.ts", "test/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}

```

File: /Users/danielsivan/dev/surf-cli/native/tests/cli-tests.sh
```sh
#!/bin/bash
cd "$(dirname "$0")/.."

PASS=0
FAIL=0

test_output() {
  local name="$1"
  local cmd="$2"
  local expect="$3"

  output=$(eval "$cmd" 2>&1) || true
  if echo "$output" | grep -q -- "$expect"; then
    echo "PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $name"
    echo "  Command: $cmd"
    echo "  Expected: $expect"
    echo "  Got: $output"
    FAIL=$((FAIL + 1))
  fi
}

test_no_output() {
  local name="$1"
  local cmd="$2"
  local unexpected="$3"

  output=$(eval "$cmd" 2>&1) || true
  if echo "$output" | grep -q -- "$unexpected"; then
    echo "FAIL: $name"
    echo "  Command: $cmd"
    echo "  Unexpected: $unexpected"
    echo "  Got: $output"
    FAIL=$((FAIL + 1))
  else
    echo "PASS: $name"
    PASS=$((PASS + 1))
  fi
}

echo "=== CLI Unit Tests (headless-only) ==="
echo ""

echo "-- Version and Help --"
test_output "version flag" "node cli.cjs --version" "surf version"
test_output "version short" "node cli.cjs -v" "surf version"
test_output "basic help" "node cli.cjs --help" "Headless terminal AI CLI"
test_output "basic help AI commands" "node cli.cjs --help" "AI Commands (headless-only)"
test_output "full help chatgpt" "node cli.cjs --help-full" "chatgpt"
test_output "full help gemini" "node cli.cjs --help-full" "gemini"
test_output "full help session" "node cli.cjs --help-full" "session"
test_output "full help workflow" "node cli.cjs --help-full" "do"
test_output "full help mcp" "node cli.cjs --help-full" "server"
test_no_output "full help omits screenshot" "node cli.cjs --help-full" "screenshot"

echo ""
echo "-- Supported Command Discovery --"
test_output "list shows chatgpt" "node cli.cjs --list" "chatgpt"
test_output "list shows gemini" "node cli.cjs --list" "gemini"
test_output "list shows session" "node cli.cjs --list" "session"
test_output "list shows do" "node cli.cjs --list" "do"
test_output "list shows server" "node cli.cjs --list" "server"
test_no_output "list omits screenshot" "node cli.cjs --list" "screenshot"
test_no_output "list omits tab.list" "node cli.cjs --list" "tab.list"
test_output "find chatgpt" "node cli.cjs --find chatgpt" "chatgpt"
test_output "find gemini" "node cli.cjs --find gemini" "gemini"
test_output "find session" "node cli.cjs --find session" "session"
test_output "find old screenshot empty" "node cli.cjs --find screenshot" "No commands found"

echo ""
echo "-- Skill Command --"
test_output "skills prints frontmatter" "node cli.cjs skills" "name: surf"
test_output "skill alias works" "node cli.cjs skill" "Headless terminal AI via local signed-in browser profiles"
test_output "skills version current" "node cli.cjs skills" "surf-cli v2.11.1"
test_output "skills chatgpt aliases current" "node cli.cjs skills" "gpt-4.1-mini"
test_output "skills gemini preview current" "node cli.cjs skills" "gemini-3.1-pro-preview"
test_no_output "skills no missing file error" "node cli.cjs skills" "SKILL.md not found"

echo ""
echo "-- Command Help --"
test_output "chatgpt help" "node cli.cjs chatgpt --help" "Send prompt to ChatGPT"
test_output "gemini help" "node cli.cjs gemini --help" "Send prompt to Gemini"
test_output "chatgpt.chats help" "node cli.cjs chatgpt.chats --help" "Search conversations"
test_output "chatgpt.reply help" "node cli.cjs chatgpt.reply --help" "Reply in-thread"
test_output "session help" "node cli.cjs session --help" "inspect and reconcile"
test_output "do help" "node cli.cjs do --help" "Execute multiple commands"

echo ""
echo "-- ChatGPT Chats Validation --"
test_output "chatgpt.chats invalid combo" "node cli.cjs chatgpt.chats abc --search test" "cannot use conversation ID with --search"
test_output "chatgpt.chats all+limit invalid" "node cli.cjs chatgpt.chats --all --limit 5" "cannot be combined with --limit"
test_output "chatgpt.chats advanced conflict" "node cli.cjs chatgpt.chats abc --rename 'New Title' --delete" "use only one of --rename, --delete, --delete-ids, or --download-file"
test_output "chatgpt.chats download requires output" "node cli.cjs chatgpt.chats abc --download-file file-123" "requires --output"
test_output "chatgpt.reply usage" "node cli.cjs chatgpt.reply" "Usage: surf chatgpt.reply"

echo ""
echo "-- Session Reconcile --"
tmp_sessions=$(mktemp -d)
test_output "session reconcile empty" \
  "SURF_SESSIONS_DIR=$tmp_sessions node cli.cjs session --reconcile" \
  "No running sessions"
test_output "session clear+reconcile invalid" \
  "node cli.cjs session --clear --reconcile" \
  "cannot combine --clear with --reconcile"
# stale session: dead pid, old createdAt
mkdir -p "$tmp_sessions/chatgpt-stale_2000-01-01_000000.000_0001"
cat > "$tmp_sessions/chatgpt-stale_2000-01-01_000000.000_0001/meta.json" <<'METAMETA'
{"id":"chatgpt-stale_2000-01-01_000000.000_0001","tool":"chatgpt","status":"running","createdAt":"2000-01-01T00:00:00.000Z","pid":999999999,"conversationId":null,"reconcile":null}
METAMETA
test_output "session list shows orphaned" \
  "SURF_SESSIONS_DIR=$tmp_sessions node cli.cjs session --all" \
  "orphaned"
# alive pid but very old → stale, NOT orphaned
mkdir -p "$tmp_sessions/chatgpt-alive-but-old_2000-01-01_000000.000_0002"
cat > "$tmp_sessions/chatgpt-alive-but-old_2000-01-01_000000.000_0002/meta.json" <<'METAMETA'
{"id":"chatgpt-alive-but-old_2000-01-01_000000.000_0002","tool":"chatgpt","status":"running","createdAt":"2000-01-01T00:00:00.000Z","pid":$$,"conversationId":null,"reconcile":null}
METAMETA
test_output "session list shows stale not orphaned" \
  "SURF_SESSIONS_DIR=$tmp_sessions node cli.cjs session --all" \
  "stale"
rm -rf "$tmp_sessions"
# --hours N should not be parsed as a session ID
tmp_sessions=$(mktemp -d)
test_output "session --hours arg not treated as ID" \
  "SURF_SESSIONS_DIR=$tmp_sessions node cli.cjs session --hours 1" \
  "No sessions found"
rm -rf "$tmp_sessions"

echo ""
echo "-- Prompt File --"
test_output "prompt-file missing file" \
  "node cli.cjs chatgpt --prompt-file /tmp/nonexistent_prompt_$$.md 2>&1 || true" \
  "Failed to read prompt file"
empty_prompt=$(mktemp)
test_output "prompt-file empty" \
  "node cli.cjs chatgpt --prompt-file $empty_prompt 2>&1 || true" \
  "prompt file is empty"
rm -f "$empty_prompt"

echo ""
echo "==================================="
echo "Results: $PASS passed, $FAIL failed"
echo "==================================="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0

```

File: /Users/danielsivan/dev/surf-cli/test/unit/do-parser.test.ts
```ts
import { describe, expect, it } from "vitest";

// @ts-expect-error - CommonJS module without type definitions
import * as parser from "../../native/do-parser.cjs";

describe("parseDoCommands", () => {
  it("parses single command", () => {
    const input = 'chatgpt "hello"';
    const steps = parser.parseDoCommands(input);
    expect(steps).toHaveLength(1);
    expect(steps[0].cmd).toBe("chatgpt");
    expect(steps[0].args).toEqual({ query: "hello" });
  });

  it("parses pipe-separated commands", () => {
    const input = 'chatgpt "Draft release notes" | gemini "Make them concise"';
    const steps = parser.parseDoCommands(input);
    expect(steps).toHaveLength(2);
    expect(steps[0].cmd).toBe("chatgpt");
    expect(steps[0].args.query).toBe("Draft release notes");
    expect(steps[1].cmd).toBe("gemini");
    expect(steps[1].args.query).toBe("Make them concise");
  });

  it("parses newline-separated commands", () => {
    const input = 'chatgpt "hello"\ngemini "world"';
    const steps = parser.parseDoCommands(input);
    expect(steps).toHaveLength(2);
    expect(steps[0].cmd).toBe("chatgpt");
    expect(steps[0].args.query).toBe("hello");
    expect(steps[1].cmd).toBe("gemini");
    expect(steps[1].args.query).toBe("world");
  });

  it("ignores blank lines", () => {
    const input = 'chatgpt "hello"\n\n\ngemini "world"';
    const steps = parser.parseDoCommands(input);
    expect(steps).toHaveLength(2);
  });

  it("ignores comment lines", () => {
    const input = '# comment\nchatgpt "hello"\n# another comment\ngemini "world"';
    const steps = parser.parseDoCommands(input);
    expect(steps).toHaveLength(2);
    expect(steps[0].cmd).toBe("chatgpt");
    expect(steps[1].cmd).toBe("gemini");
  });

  it("handles quoted strings with spaces", () => {
    const input = 'chatgpt "hello world"';
    const steps = parser.parseDoCommands(input);
    expect(steps[0].args.query).toBe("hello world");
  });

  it("handles single-quoted strings", () => {
    const input = "chatgpt 'hello world'";
    const steps = parser.parseDoCommands(input);
    expect(steps[0].args.query).toBe("hello world");
  });

  it("parses options with values", () => {
    const input = 'chatgpt "hello" --model pro --profile user@example.com';
    const steps = parser.parseDoCommands(input);
    expect(steps[0].args.query).toBe("hello");
    expect(steps[0].args.model).toBe("pro");
    expect(steps[0].args.profile).toBe("user@example.com");
  });

  it("parses numeric option values", () => {
    const input = 'gemini "hello" --timeout 500';
    const steps = parser.parseDoCommands(input);
    expect(steps[0].args.timeout).toBe(500);
  });

  it("parses boolean option values", () => {
    const input = 'chatgpt.chats --all true';
    const steps = parser.parseDoCommands(input);
    expect(steps[0].args.all).toBe(true);
  });

  it("parses boolean false option values", () => {
    const input = 'chatgpt.chats --all false';
    const steps = parser.parseDoCommands(input);
    expect(steps[0].args.all).toBe(false);
  });

  it("parses chatgpt.chats conversation id", () => {
    const input = "chatgpt.chats abc123 --limit 5";
    const steps = parser.parseDoCommands(input);
    expect(steps[0].args.conversationId).toBe("abc123");
    expect(steps[0].args.limit).toBe(5);
  });

  it("parses chatgpt.reply with options after prompt", () => {
    const input = 'chatgpt.reply abc123 "hello" --model pro';
    const steps = parser.parseDoCommands(input);
    expect(steps[0].args).toEqual({ conversationId: "abc123", prompt: "hello", model: "pro" });
  });

  it("parses prompt-file only ChatGPT commands", () => {
    const input = "chatgpt --prompt-file prompt.md --model pro";
    const steps = parser.parseDoCommands(input);
    expect(steps[0].args).toEqual({ "prompt-file": "prompt.md", model: "pro" });
  });

  it("parses Gemini image options", () => {
    const input = 'gemini "robot" --generate-image /tmp/out.png --aspect-ratio 16:9';
    const steps = parser.parseDoCommands(input);
    expect(steps[0].args).toEqual({
      query: "robot",
      "generate-image": "/tmp/out.png",
      "aspect-ratio": "16:9",
    });
  });

  it("keeps unknown commands parseable so executor can reject them", () => {
    const input = "screenshot --output /tmp/out.png";
    const steps = parser.parseDoCommands(input);
    expect(steps[0]).toEqual({ cmd: "screenshot", args: { output: "/tmp/out.png" } });
  });

  it("coerces decimal option values", () => {
    const input = 'gemini "hello" --temperature 0.5';
    const steps = parser.parseDoCommands(input);
    expect(steps[0].args.temperature).toBe(0.5);
  });

  it("parses complex workflow", () => {
    const input = `
# AI workflow
chatgpt "Draft release notes" --profile user@example.com --model pro
gemini "Make them concise" --profile user@example.com
chatgpt.chats --limit 1 --profile user@example.com
chatgpt.reply abc123 "Thanks" --profile user@example.com
`;
    const steps = parser.parseDoCommands(input);
    expect(steps).toHaveLength(4);
    expect(steps[0].cmd).toBe("chatgpt");
    expect(steps[0].args.model).toBe("pro");
    expect(steps[1].cmd).toBe("gemini");
    expect(steps[2].cmd).toBe("chatgpt.chats");
    expect(steps[2].args.limit).toBe(1);
    expect(steps[3].cmd).toBe("chatgpt.reply");
    expect(steps[3].args.conversationId).toBe("abc123");
    expect(steps[3].args.prompt).toBe("Thanks");
  });

  it("handles prompts with special characters", () => {
    const input = 'chatgpt "https://example.com/path?query=value&foo=bar"';
    const steps = parser.parseDoCommands(input);
    expect(steps[0].args.query).toBe("https://example.com/path?query=value&foo=bar");
  });

  it("does not split quoted pipe characters inside prompts", () => {
    const input = 'chatgpt "compare A | B" | gemini "summarize"';
    const steps = parser.parseDoCommands(input);
    expect(steps).toHaveLength(2);
    expect(steps[0].args.query).toBe("compare A | B");
  });

  it("treats quoted pipe-only input as a single command", () => {
    const input = 'chatgpt "markdown | table"';
    const steps = parser.parseDoCommands(input);
    expect(steps).toHaveLength(1);
    expect(steps[0].args.query).toBe("markdown | table");
  });

  it("exposes quote-aware split helper", () => {
    expect(parser.splitCommands('a "b|c" | d', "|").map((part: string) => part.trim())).toEqual([
      'a "b|c"',
      "d",
    ]);
  });

  it("handles literal backslash-n as newline separator", () => {
    // Simulates bash single-quoted string: 'chatgpt "hello"\ngemini "world"'
    const input = 'chatgpt "hello"\\ngemini "world"\\nchatgpt.chats --limit 1';
    const steps = parser.parseDoCommands(input);
    expect(steps).toHaveLength(3);
    expect(steps[0].cmd).toBe("chatgpt");
    expect(steps[1].cmd).toBe("gemini");
    expect(steps[2].cmd).toBe("chatgpt.chats");
  });
});

describe("tokenize", () => {
  it("splits on spaces", () => {
    expect(parser.tokenize("chatgpt hello")).toEqual(["chatgpt", "hello"]);
  });

  it("respects double quotes", () => {
    expect(parser.tokenize('chatgpt "hello world"')).toEqual(["chatgpt", "hello world"]);
  });

  it("respects single quotes", () => {
    expect(parser.tokenize("gemini 'hello world'")).toEqual(["gemini", "hello world"]);
  });

  it("handles mixed quotes", () => {
    expect(parser.tokenize("chatgpt \"hello\" --profile 'user@example.com'")).toEqual([
      "chatgpt",
      "hello",
      "--profile",
      "user@example.com",
    ]);
  });

  it("handles empty input", () => {
    expect(parser.tokenize("")).toEqual([]);
  });

  it("handles multiple spaces", () => {
    expect(parser.tokenize("chatgpt    hello")).toEqual(["chatgpt", "hello"]);
  });

  it("handles tabs", () => {
    expect(parser.tokenize("chatgpt\thello")).toEqual(["chatgpt", "hello"]);
  });
});

describe("parseCommandLine", () => {
  it("returns null for empty input", () => {
    expect(parser.parseCommandLine("")).toBe(null);
  });

  it("parses command without args", () => {
    const result = parser.parseCommandLine("chatgpt.chats");
    expect(result).toEqual({ cmd: "chatgpt.chats", args: {} });
  });

  it("parses chatgpt.reply positional args", () => {
    const result = parser.parseCommandLine('chatgpt.reply abc123 "hello"');
    expect(result).toEqual({ cmd: "chatgpt.reply", args: { conversationId: "abc123", prompt: "hello" } });
  });
});

```

File: /Users/danielsivan/dev/surf-cli/native/session-reconciler.cjs
```cjs
/**
 * surf-cli session reconciler
 *
 * Detects orphaned / stale sessions whose worker died without calling
 * session.finish() or session.fail(), and optionally polls the ChatGPT API
 * to recover completed conversations.
 *
 * Public API:
 *   defaultPidIsAlive(pid)           — liveness check for a stored pid
 *   isChatGptCloakSession(meta)      — true when session used cloak
 *   resolveConversationId(meta)      — extract conversationId from meta/args
 *   inspectConversation(conv, meta)  — determine outcome from GET response
 *   reconcileSessions(opts)          — main reconcile pass (local + optional network)
 */

"use strict";

const { listSessions, updateSession, appendSessionLog, persistSessionResponse } = require("./session-store.cjs");
const { extractMessageText, summarizeConversation } = require("./chatgpt-chats-formatter.cjs");

// ============================================================================
// Constants
// ============================================================================

/** Sessions still "running" beyond this age are considered orphaned. */
const MAX_RUNNING_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check whether a PID is still alive using signal 0.
 * Returns false for invalid / missing PIDs.
 */
function defaultPidIsAlive(pid) {
  if (!pid || typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** True when the session was run via CloakBrowser. ChatGPT is always Cloak in headless-only mode. */
function isChatGptCloakSession(meta) {
  return meta.tool === "chatgpt" || meta.tool === "chatgpt.reply";
}

/** Pull the ChatGPT conversation ID out of wherever it may be stored. */
function resolveConversationId(meta) {
  return (
    meta.conversationId ||
    (meta.args && meta.args.conversationId) ||
    null
  );
}

function hasSentCheckpoint(meta) {
  const hasCheckpointFields =
    meta &&
    (Object.prototype.hasOwnProperty.call(meta, "lastCheckpoint") ||
      Object.prototype.hasOwnProperty.call(meta, "sentAt"));

  if (!hasCheckpointFields) {
    return true;
  }

  return (
    meta.lastCheckpoint === "sent" ||
    (typeof meta.sentAt === "string" && meta.sentAt.trim() !== "")
  );
}

function extractRecoveredAssistantPayload(conversation, nodeId = null) {
  if (!conversation || typeof conversation !== "object") return null;
  const mapping = conversation.mapping && typeof conversation.mapping === "object" ? conversation.mapping : null;
  const node = mapping && nodeId ? mapping[nodeId] : null;
  const nodeMessage = node && node.message ? node.message : null;
  const nodeText = extractMessageText(nodeMessage);
  const summary = summarizeConversation(conversation);
  const lastAssistant = Array.isArray(summary.messages)
    ? [...summary.messages].reverse().find((msg) => msg && msg.role === "assistant")
    : null;
  const fallbackText = lastAssistant && (!nodeId || lastAssistant.id === nodeId) ? lastAssistant.text : "";
  const responseText = String(nodeText || fallbackText || "").trim();
  if (!responseText) return null;
  return {
    responseText,
    model: nodeMessage?.metadata?.model_slug || lastAssistant?.model || summary.model || null,
  };
}

// ============================================================================
// inspectConversation
// ============================================================================

/**
 * Analyse a GET /backend-api/conversation/{id} response to determine whether
 * the conversation completed, is still in progress, or is ambiguous.
 *
 * @param {object}  conversation  Raw conversation object from the API.
 * @param {object}  meta          Session meta (for baseline comparison).
 * @returns {{ outcome: string, nodeId: string|null }}
 *   outcome: 'completed' | 'no_new_assistant' | 'in_progress' | 'ambiguous'
 */
function inspectConversation(conversation, meta = {}) {
  if (!conversation || typeof conversation !== "object") {
    return { outcome: "ambiguous", nodeId: null };
  }

  const mapping       = conversation.mapping;
  const currentNodeId = conversation.current_node;

  if (!mapping || !currentNodeId || !mapping[currentNodeId]) {
    return { outcome: "ambiguous", nodeId: null };
  }

  const node = mapping[currentNodeId];
  const msg  = node.message;
  if (!msg) return { outcome: "ambiguous", nodeId: currentNodeId };

  const status = msg.status;
  const role   = msg.author && msg.author.role;

  // Current node must be an assistant turn for a completed response
  if (role !== "assistant") {
    return { outcome: "no_new_assistant", nodeId: currentNodeId };
  }

  if (status === "finished_successfully") {
    // Check if this is just the pre-existing baseline (same turn, no new content)
    const baseline = meta.baselineAssistantMessageId;
    if (baseline && currentNodeId === baseline) {
      return { outcome: "no_new_assistant", nodeId: currentNodeId };
    }
    return { outcome: "completed", nodeId: currentNodeId };
  }

  if (status === "in_progress") {
    return { outcome: "in_progress", nodeId: currentNodeId };
  }

  return { outcome: "ambiguous", nodeId: currentNodeId };
}

// ============================================================================
// reconcileSessions
// ============================================================================

/**
 * Main reconcile pass.
 *
 * Local-only (fast, no network):
 *   - Checks stored pid liveness
 *   - Marks orphaned sessions as status "error" with code "session_orphaned"
 *
 * Network-enhanced (pollNetwork: true):
 *   - For sessions with a known conversationId, calls manageChats({ action:'get' })
 *   - Recovered sessions become status "completed"
 *   - Unresolved (in_progress) sessions stay "running" with reconcile.state = 'unresolved'
 *
 * @param {object}  opts
 * @param {number}  [opts.hours=72]        Look back window for listSessions.
 * @param {boolean} [opts.all=false]       Pass through to listSessions.
 * @param {number}  [opts.limit=200]       Pass through to listSessions.
 * @param {boolean} [opts.pollNetwork]     Enable network polling.
 * @param {Function}[opts.manageChats]     manageChatsWithCloakBrowser function ref.
 *
 * Network polling gate:
 *   - New sessions poll only after the worker persisted a sent checkpoint.
 *   - Legacy sessions (pre-checkpoint metadata) still poll when conversationId exists.
 *
 * @returns {{ reconciled: number, sessions: Array }}
 */
async function reconcileSessions(opts = {}) {
  const {
    hours        = 72,
    all          = false,
    limit        = 200,
    pollNetwork  = false,
    manageChats  = null,
  } = opts;

  const sessions = listSessions({ hours, all, limit });
  const running  = sessions.filter(s => s.status === "running");

  if (running.length === 0) return { reconciled: 0, sessions: [] };

  const results = [];
  const now     = Date.now();

  for (const meta of running) {
    const createdMs = new Date(meta.createdAt).getTime();
    const age       = now - createdMs;
    const pidAlive  = defaultPidIsAlive(meta.pid);
    const tooOld    = age > MAX_RUNNING_AGE_MS;

    // ── PID still alive → annotate but never mutate status ──────────────────
    // (even if very old — could be a legitimate long-running session)
    if (pidAlive) {
      if (tooOld) {
        // Annotate as "stale" but keep running — active worker may still complete
        const reconcile = {
          reconciledAt: new Date().toISOString(),
          pidAlive:     true,
          ageSec:       Math.round(age / 1000),
          state:        "stale",
          remote:       null,
        };
        updateSession(meta.id, { reconcile });
        results.push({ meta, action: "stale", reason: "old_but_pid_alive" });
      } else {
        results.push({ meta, action: "none", reason: "pid_alive" });
      }
      continue;
    }

    // PID is dead — proceed to orphan / network recovery
    // Build reconcile record (will be written regardless of network result)
    const reconcile = {
      reconciledAt: new Date().toISOString(),
      pidAlive:     false,
      ageSec:       Math.round(age / 1000),
      state:        "orphaned",
      remote:       null,
    };

    const conversationId = resolveConversationId(meta);
    let   recovered      = false;

    // ── Optional network poll ──────────────────────────────────────────────
    if (pollNetwork && hasSentCheckpoint(meta) && conversationId && typeof manageChats === "function") {
      try {
        const chatResult = await manageChats({
          action:         "get",
          conversationId,
          profile:        meta.args && meta.args.profile,
          timeout:        30,
        });

        // manageChatsWithCloakBrowser wraps the result — unwrap conversation
        const convo = (
          chatResult &&
          (chatResult.conversation ||
            (chatResult.data && chatResult.data.conversation))
        ) || null;

        const inspection = inspectConversation(convo, meta);
        reconcile.remote = {
          conversationId,
          outcome: inspection.outcome,
          nodeId:  inspection.nodeId || null,
        };

        if (inspection.outcome === "completed") {
          const recoveredPayload = extractRecoveredAssistantPayload(convo, inspection.nodeId);
          const recoveredResponse = recoveredPayload?.responseText || "";
          const responsePreview = recoveredResponse ? recoveredResponse.slice(0, 160) : null;
          const responseArtifact = persistSessionResponse(meta.id, recoveredResponse);
          const result = {
            ok:            true,
            reconciled:    true,
            recovered:     true,
            conversationId,
            nodeId:        inspection.nodeId,
            model:         recoveredPayload?.model || null,
            responsePreview,
            responsePath: responseArtifact?.responsePath || null,
            responseChars: responseArtifact?.responseChars || 0,
          };
          if (!responseArtifact?.responsePath && recoveredResponse) {
            result.inlineResponse = recoveredResponse;
            result.inlineResponseTruncated = false;
            result.inlineResponseChars = recoveredResponse.length;
          }
          reconcile.state = "recovered";
          updateSession(meta.id, {
            status:      "completed",
            completedAt: new Date().toISOString(),
            elapsedMs:   age,
            reconcile,
            result,
          });
          appendSessionLog(meta.id, `[session] ✓ recovered remote reply from conversation ${conversationId}`);
          if (responseArtifact?.responsePath) {
            appendSessionLog(meta.id, `[session] response saved: ${responseArtifact.responsePath}`);
          } else if (recoveredResponse) {
            appendSessionLog(meta.id, `[session] recovered assistant reply stored in inline fallback (${recoveredResponse.length} chars)`);
          }
          results.push({ meta, action: "recovered", reason: "conversation_completed", conversationId });
          recovered = true;

        } else if (inspection.outcome === "in_progress") {
          // Still generating on ChatGPT side — leave running but annotate
          reconcile.state = "unresolved";
          updateSession(meta.id, { reconcile });
          results.push({ meta, action: "unresolved", reason: "conversation_in_progress", conversationId });
          recovered = true; // don't mark error

        } else {
          // no_new_assistant / ambiguous → fall through to orphan
          reconcile.state = "orphaned";
          if (inspection.outcome === "no_new_assistant") {
            reconcile.remote = { ...reconcile.remote, reason: "no_new_assistant" };
          }
        }
      } catch (e) {
        reconcile.remote = {
          conversationId,
          outcome: "poll_failed",
          error:   e.message,
        };
        reconcile.state = "orphaned";
      }
    }

    // ── Mark orphaned ──────────────────────────────────────────────────────
    if (!recovered) {
      updateSession(meta.id, {
        status:      "error",
        completedAt: new Date().toISOString(),
        elapsedMs:   age,
        reconcile,
        error: {
          message: "Session orphaned — process exited without completing",
          code:    "session_orphaned",
        },
      });
      results.push({ meta, action: "orphaned", reason: pollNetwork ? "network_poll_failed_or_no_convo" : "pid_dead" });
    }
  }

  return {
    reconciled: results.filter(r => r.action !== "none").length,
    sessions:   results,
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  defaultPidIsAlive,
  isChatGptCloakSession,
  resolveConversationId,
  inspectConversation,
  reconcileSessions,
  MAX_RUNNING_AGE_MS,
};

```

File: /Users/danielsivan/dev/surf-cli/skills/README.md
```md
# Surf Skills

This directory contains skill files for AI coding agents.

## Pi Agent

To use the surf skill with [Pi coding agent](https://github.com/badlogic/pi-mono):

```bash
# Option 1: Symlink (auto-updates)
ln -s "$(pwd)/skills/surf" ~/.agents/skills/surf

# Option 2: Copy
cp -r skills/surf ~/.agents/skills/
```

The skill will be available when pi detects headless ChatGPT/Gemini terminal tasks.

The bundled surf skill covers the current operator flow: profile-based auth, `--prompt-file` for inline large prompts, and `surf session --reconcile --network` for recovery checks.

## Other Agents

The `SKILL.md` file is a comprehensive reference that can be adapted for other AI coding agents or used as documentation for LLM prompts.

```

File: /Users/danielsivan/dev/surf-cli/native/chatgpt-bun-bridge.cjs
```cjs
/**
 * Bridge module: spawns the Bun WebView worker for ChatGPT queries.
 *
 * Handles:
 *  - Bun executable detection
 *  - Eligibility checks (--with-page is not supported by the headless worker)
 *  - Worker spawn + stdin/stdout JSON protocol
 *  - Structured errors
 */

const { execFileSync, spawn } = require("child_process");
const path = require("path");

// ============================================================================
// Bun detection
// ============================================================================

let _bunPath = undefined; // cache

function detectBunPath() {
  if (_bunPath !== undefined) return _bunPath;
  try {
    const out = execFileSync("which", ["bun"], {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    _bunPath = out || null;
  } catch {
    _bunPath = null;
  }
  return _bunPath;
}

// ============================================================================
// Eligibility
// ============================================================================

/**
 * Check whether the given CLI args are eligible for the Bun path.
 *
 * @param {object} args - Parsed tool args from CLI
 * @returns {{ eligible: boolean, reason?: string }}
 */
function isBunChatGPTEligible(args) {
  if (args.withPage || args["with-page"]) {
    return { eligible: false, reason: "with_page" };
  }
  if (process.platform === "win32") {
    return { eligible: false, reason: "unsupported_platform" };
  }
  if (args.profile && process.platform !== "darwin") {
    return { eligible: false, reason: "profile_unsupported_platform" };
  }
  const bun = detectBunPath();
  if (!bun) {
    return { eligible: false, reason: "bun_not_found" };
  }
  return { eligible: true };
}

// ============================================================================
// Worker protocol
// ============================================================================

/**
 * Build the worker request payload from CLI-parsed args.
 *
 * @param {object} args
 * @param {string} args.query       - User prompt
 * @param {string} [args.model]     - Model name (gpt-4o, o3, o4-mini, etc.)
 * @param {string} [args.file]      - Absolute file path
 * @param {string} [args.generateImage] - Absolute output path for generated image
 * @param {number} [args.timeout]   - Timeout in **seconds** (CLI convention)
 * @param {string} [args.profile]   - Chrome profile email
 * @returns {object}
 */
function buildWorkerRequest(args) {
  // CLI --timeout is always in seconds; always multiply by 1000.
  // Cap at 24h (86400s) to catch accidental ms values passed directly.
  const MAX_TIMEOUT_S = 86400;
  let timeoutMs = 300000;
  if (args.timeout != null && args.timeout > 0) {
    const secs = Math.min(Number(args.timeout), MAX_TIMEOUT_S);
    timeoutMs = secs * 1000;
  }
  return {
    prompt: args.query || "",
    model: args.model || undefined,
    file: args.file || null,
    generateImage: args.generateImage || args["generate-image"] || null,
    timeoutMs,
    profileEmail: args.profile || null,
  };
}

// ============================================================================
// Spawn
// ============================================================================

/**
 * Run the ChatGPT Bun worker.
 *
 * @param {object} args - CLI-parsed tool args
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs] - Kill worker after this many ms
 * @returns {Promise<{ ok: true, result: object } | { ok: false, error: string, code: string }>}
 */
async function runChatGPTViaBun(args, opts = {}) {
  const bunPath = detectBunPath();
  if (!bunPath) {
    return {
      ok: false,
      code: "bun_not_found",
      error: "Bun executable not found. Install Bun for headless ChatGPT.",
    };
  }

  const workerPath = path.join(__dirname, "chatgpt-bun-worker.ts");
  const request = buildWorkerRequest(args);
  const timeoutMs = opts.timeoutMs || request.timeoutMs || 300000;

  return new Promise((resolve) => {
    let resolved = false;
    let stdout = "";
    let stderr = "";

    const child = spawn(bunPath, [workerPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      timeout: timeoutMs + 5000,
    });

    // Send request
    child.stdin.write(JSON.stringify(request));
    child.stdin.end();

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });

    const killTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { child.kill("SIGKILL"); } catch {}
        resolve({
          ok: false,
          code: "timeout",
          error: `Bun worker killed after ${timeoutMs}ms`,
        });
      }
    }, timeoutMs + 5000);

    child.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(killTimer);
      resolve({
        ok: false,
        code: "spawn_failed",
        error: `Failed to spawn Bun worker: ${err.message}`,
      });
    });

    child.on("close", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(killTimer);

      const lines = stdout.trim().split("\n").filter(Boolean);
      const lastLine = lines[lines.length - 1];

      if (!lastLine) {
        resolve({
          ok: false,
          code: "protocol_error",
          error: `Bun worker produced no output (exit ${code}). stderr: ${stderr.slice(0, 300)}`,
        });
        return;
      }

      try {
        const response = JSON.parse(lastLine);
        if (response.ok === true && response.result) {
          resolve({ ok: true, result: response.result });
        } else if (response.ok === false) {
          resolve({
            ok: false,
            code: response.code || "unknown",
            error: response.error || "Bun worker error",
          });
        } else {
          resolve({
            ok: false,
            code: "protocol_error",
            error: `Unexpected worker response shape: ${lastLine.slice(0, 200)}`,
          });
        }
      } catch (parseErr) {
        resolve({
          ok: false,
          code: "protocol_error",
          error: `Failed to parse worker JSON: ${parseErr.message}. Output: ${lastLine.slice(0, 200)}`,
        });
      }
    });
  });
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  isBunChatGPTEligible,
  runChatGPTViaBun,
  detectBunPath,
  buildWorkerRequest,
};

```

File: /Users/danielsivan/dev/surf-cli/test/unit/gemini-bun-bridge.test.ts
```ts
import { describe, expect, it } from "vitest";

const bridge = require("../../native/gemini-bun-bridge.cjs");

describe("gemini-bun-bridge", () => {
  describe("isBunGeminiEligible", () => {
    it("returns ineligible for --with-page", () => {
      const result = bridge.isBunGeminiEligible({ "with-page": true });
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe("with_page");
    });

    it("returns ineligible for withPage", () => {
      const result = bridge.isBunGeminiEligible({ withPage: true });
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe("with_page");
    });

    it("returns eligible for basic query", () => {
      // This test may fail if Bun is not installed
      const result = bridge.isBunGeminiEligible({ query: "test" });
      if (result.eligible) {
        expect(result.eligible).toBe(true);
      } else {
        // Bun not installed — still valid
        expect(result.reason).toBe("bun_not_found");
      }
    });
  });

  describe("buildWorkerRequest", () => {
    it("maps CLI args to worker request shape", () => {
      const req = bridge.buildWorkerRequest({
        query: "explain quantum computing",
        model: "gemini-2.5-pro",
        file: "/tmp/data.csv",
        "generate-image": "/tmp/out.png",
        youtube: "https://youtube.com/watch?v=abc",
        "aspect-ratio": "16:9",
        timeout: 120,
      });

      expect(req.prompt).toBe("explain quantum computing");
      expect(req.model).toBe("gemini-2.5-pro");
      expect(req.file).toBe("/tmp/data.csv");
      expect(req.generateImage).toBe("/tmp/out.png");
      expect(req.youtube).toBe("https://youtube.com/watch?v=abc");
      expect(req.aspectRatio).toBe("16:9");
      expect(req.timeoutMs).toBe(120000); // 120s → 120000ms
    });

    it("handles minimal args", () => {
      const req = bridge.buildWorkerRequest({ query: "hello" });
      expect(req.prompt).toBe("hello");
      expect(req.file).toBeNull();
      expect(req.generateImage).toBeNull();
      expect(req.editImage).toBeNull();
      expect(req.youtube).toBeNull();
      expect(req.timeoutMs).toBe(300000);
    });

    it("handles edit-image with output", () => {
      const req = bridge.buildWorkerRequest({
        query: "add sunglasses",
        "edit-image": "/tmp/photo.jpg",
        output: "/tmp/edited.jpg",
      });
      expect(req.editImage).toBe("/tmp/photo.jpg");
      expect(req.output).toBe("/tmp/edited.jpg");
    });

    // --- P1 fix: timeout conversion ---
    it("converts --timeout seconds to milliseconds", () => {
      const req = bridge.buildWorkerRequest({ query: "q", timeout: 60 });
      expect(req.timeoutMs).toBe(60000);
    });

    it("converts --timeout 300 (seconds) to 300000ms", () => {
      const req = bridge.buildWorkerRequest({ query: "q", timeout: 300 });
      expect(req.timeoutMs).toBe(300000);
    });

    it("always treats --timeout as seconds, even for large values", () => {
      // e.g. --timeout 10000 = 10000 seconds = 10,000,000ms (not 10s)
      const req = bridge.buildWorkerRequest({ query: "q", timeout: 10000 });
      expect(req.timeoutMs).toBe(10000 * 1000);
    });

    it("caps timeout at 86400s (24h) to guard against accidental ms pass-through", () => {
      const req = bridge.buildWorkerRequest({ query: "q", timeout: 999999 });
      expect(req.timeoutMs).toBe(86400 * 1000);
    });

    it("uses default 300000ms when timeout is 0 or null", () => {
      expect(bridge.buildWorkerRequest({ query: "q", timeout: 0 }).timeoutMs).toBe(300000);
      expect(bridge.buildWorkerRequest({ query: "q", timeout: null }).timeoutMs).toBe(300000);
      expect(bridge.buildWorkerRequest({ query: "q" }).timeoutMs).toBe(300000);
    });
  });

  // --- P2 fix: protocol edge cases ---
  describe("runGeminiViaBun - protocol edge cases", () => {
    it("returns protocol error for empty stdout", async () => {
      // We can't easily mock spawn, but we can test with a deliberately bad worker
      // by pointing to a non-existent script — spawn_failed
      const { execFileSync } = require("node:child_process");
      try {
        execFileSync("which", ["bun"], { encoding: "utf-8", timeout: 3000 });
      } catch {
        // Bun not installed — skip
        return;
      }

      // Create a temp worker that outputs nothing
      const fs = require("node:fs");
      const path = require("node:path");
      const tmpWorker = path.join(require("node:os").tmpdir(), "surf-test-empty-worker.ts");
      fs.writeFileSync(tmpWorker, "// empty — no output\n");

      // Monkey-patch __dirname temporarily — not feasible in CJS module,
      // so just validate the protocol error shape from a real spawn
      // We'll test the bridge's internal parsing via a controlled child
      const { spawn } = require("node:child_process");
      const result = await new Promise((resolve) => {
        const bunPath = execFileSync("which", ["bun"], { encoding: "utf-8" }).trim();
        const child = spawn(bunPath, [tmpWorker], { stdio: ["pipe", "pipe", "pipe"] });
        child.stdin.write(JSON.stringify({ prompt: "test" }));
        child.stdin.end();
        let stdout = "";
        child.stdout.on("data", (d: any) => {
          stdout += d.toString();
        });
        child.on("close", (_code: number) => {
          // Simulate bridge parsing
          const lines = stdout.trim().split("\n").filter(Boolean);
          const lastLine = lines[lines.length - 1] || "";
          if (!lastLine) {
            resolve({ ok: false, code: "protocol_error", empty: true });
          } else {
            try {
              resolve(JSON.parse(lastLine));
            } catch {
              resolve({ ok: false, code: "parse_error" });
            }
          }
        });
      });

      expect((result as any).ok).toBe(false);
      fs.unlinkSync(tmpWorker);
    });

    it("handles invalid JSON from worker stdout", async () => {
      const { execFileSync } = require("node:child_process");
      try {
        execFileSync("which", ["bun"], { encoding: "utf-8", timeout: 3000 });
      } catch {
        return; // Bun not installed — skip
      }

      const fs = require("node:fs");
      const path = require("node:path");
      const tmpWorker = path.join(require("node:os").tmpdir(), "surf-test-bad-json-worker.ts");
      fs.writeFileSync(tmpWorker, 'process.stdout.write("NOT_JSON\\n");\n');

      const { spawn } = require("node:child_process");
      const result = await new Promise((resolve) => {
        const bunPath = execFileSync("which", ["bun"], { encoding: "utf-8" }).trim();
        const child = spawn(bunPath, [tmpWorker], { stdio: ["pipe", "pipe", "pipe"] });
        child.stdin.write(JSON.stringify({ prompt: "test" }));
        child.stdin.end();
        let stdout = "";
        child.stdout.on("data", (d: any) => {
          stdout += d.toString();
        });
        child.on("close", () => {
          const lines = stdout.trim().split("\n").filter(Boolean);
          const lastLine = lines[lines.length - 1] || "";
          try {
            resolve(JSON.parse(lastLine));
          } catch {
            resolve({ ok: false, code: "parse_error" });
          }
        });
      });

      expect((result as any).ok).toBe(false);
      expect((result as any).code).toBe("parse_error");
      fs.unlinkSync(tmpWorker);
    });
  });
});

```

File: /Users/danielsivan/dev/surf-cli/skills/surf/SKILL.md
```md
---
name: surf
description: Run the headless-only surf CLI for ChatGPT and Gemini terminal workflows.
---

# Surf

Headless terminal AI via local signed-in browser profiles.
Prefer real CLI execution over guessed provider APIs.

Repo + local CLI verified against **surf-cli v2.11.1**.

## Use when

- ChatGPT prompts, file review, prompt-file runs, image generation
- Gemini prompts, file/video analysis, image generation/editing
- ChatGPT conversation list/search/view/export/reply/manage flows
- Long-running browser-session AI from shell, tmux, or agent workflows

## Defaults

- Headless-only CLI.
- ChatGPT uses CloakBrowser headless by default.
- Gemini uses Bun WebView headless by default.
- Default profile on macOS: `dsebban883@gmail.com` unless the user asks for another account.
- Use `--profile dsebban883@gmail.com` for reliable auth and file/image/chats features.

## Sanity check

```bash
surf --version
surf --help
surf chatgpt.chats --limit 1 --profile dsebban883@gmail.com
```

## ChatGPT

```bash
surf chatgpt "explain this code" --profile dsebban883@gmail.com
surf chatgpt "review this PR" --file diff.patch --profile dsebban883@gmail.com
surf chatgpt --prompt-file prompt.md --model gpt-5.4-pro --profile dsebban883@gmail.com
surf chatgpt "a robot surfing" --generate-image /tmp/robot.png --profile dsebban883@gmail.com
surf chatgpt "deep analysis" --model gpt-5.4-pro --profile dsebban883@gmail.com
```

`--prompt-file` reads the file as prompt text. Use it for large exported contexts. `--file` uploads as an attachment.

### ChatGPT model aliases

- `instant`, `gpt-5.3`, `gpt-4o`, `gpt-4.1`, `gpt-4.1-mini` → GPT-5.3 Instant
- `thinking`, `gpt-5.4-thinking`, `o3`, `o4-mini` → GPT-5.4 Thinking
- `pro`, `gpt-5.4-pro`, `chatgpt-pro`, `o1-pro` → GPT-5.4 Pro

## ChatGPT conversations

```bash
surf chatgpt.chats --limit 20 --profile dsebban883@gmail.com
surf chatgpt.chats --search "auth system" --profile dsebban883@gmail.com
surf chatgpt.chats <conversation-id> --profile dsebban883@gmail.com
surf chatgpt.chats <conversation-id> --export /tmp/chat.md --profile dsebban883@gmail.com
surf chatgpt.chats <conversation-id> --export /tmp/chat.json --format json --json --profile dsebban883@gmail.com
surf chatgpt.reply <conversation-id> "follow-up" --profile dsebban883@gmail.com
surf chatgpt.reply <conversation-id> --prompt-file followup.md --model gpt-5.4-thinking --profile dsebban883@gmail.com
surf chatgpt.chats <conversation-id> --rename "New Title" --profile dsebban883@gmail.com
surf chatgpt.chats <conversation-id> --delete --profile dsebban883@gmail.com
surf chatgpt.chats <conversation-id> --download-file <file-id> --output /tmp/file.txt --profile dsebban883@gmail.com
```

Notes:
- `--delete` is destructive; no CLI undo.
- Search may use a recent-history fallback; if JSON shows `partial: true`, misses are not authoritative for older chats.
- `--download-file` needs `--output`.

## ChatGPT thinking trace

Pro/Thinking models stream live thinking content via `🧠` lines.

```bash
surf chatgpt "complex problem" --model gpt-5.4-pro --profile dsebban883@gmail.com
```

## Gemini

```bash
surf gemini "explain quantum computing" --profile dsebban883@gmail.com
surf gemini "analyze this chart" --file chart.jpg --profile dsebban883@gmail.com
surf gemini "reason about this architecture" --model thinking --profile dsebban883@gmail.com
surf gemini "advanced math problem" --model pro --profile dsebban883@gmail.com
surf gemini "a robot surfing" --generate-image /tmp/robot.png --profile dsebban883@gmail.com
surf gemini "wide banner" --generate-image /tmp/banner.png --aspect-ratio 16:9 --profile dsebban883@gmail.com
surf gemini "add sunglasses" --edit-image photo.jpg --output out.jpg --profile dsebban883@gmail.com
```

### Gemini model notes

Gemini 3 tiers (use `--model <alias>`):

- **Fast** (default): `gemini-3-pro`, `fast`, `gemini-2.5-flash`
- **Thinking**: `thinking`, `gemini-2.5-pro`, `gemini-3.1-thinking`
- **Pro** (3.1 Pro): `pro`, `gemini-3.1-pro-preview`, `gemini-3.1-pro`

Unknown model names are passed through to the UI picker best-effort.

## Workflows

```bash
surf do 'chatgpt "Draft release notes" --profile dsebban883@gmail.com | gemini "Make it concise" --profile dsebban883@gmail.com'
surf do 'chatgpt "Review this" --file diff.patch --profile dsebban883@gmail.com' --dry-run
```

## Sessions & reconciliation

Every surf AI command creates a session in `~/.surf/sessions/`.

```bash
surf session
surf session <id>
surf session --reconcile
surf session --reconcile --network
```

For long runs, use tmux:

```bash
tmux new -d -s surf-chat "bash -lc 'surf chatgpt \"complex analysis\" --model gpt-5.4-pro --profile dsebban883@gmail.com --timeout 3000 2>&1 | tee /tmp/surf-chatgpt.log'"
tail -f /tmp/surf-chatgpt.log
```

## Troubleshooting

- `--profile` is macOS-only.
- `--with-page` is not supported.
- Page-context/browser-extension commands were removed.
- Default ChatGPT timeout: **2700s**.
- If auth fails, sign in with the same local profile and retry.
- Use `surf session <id>` to inspect stderr/result details.

```

File: /Users/danielsivan/dev/surf-cli/vitest.config.ts
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Test file patterns
    include: [
      "test/unit/**/*.test.ts",
      "test/integration/**/*.test.ts",
      "test/e2e/**/*.test.ts",
    ],

    // Environment
    environment: "node",

    // Coverage configuration
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["native/**/*.cjs", "native/**/*.ts"],
      exclude: [
        "node_modules",
        "test",
        "native/cli.cjs",
        "**/*.d.ts",
        "**/*.config.*",
      ],
    },

    // Timeouts
    testTimeout: 10000,
    hookTimeout: 10000,

    // Reporter
    reporters: ["verbose"],

    // Global test utilities
    globals: true,
  },
});

```

File: /Users/danielsivan/dev/surf-cli/test/e2e/chatgpt-cloak-local.test.ts
```ts
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isCloakBrowserAvailable, queryWithCloakBrowser } = require("../../native/chatgpt-cloak-bridge.cjs") as {
  isCloakBrowserAvailable: () => boolean;
  queryWithCloakBrowser: (opts: {
    query: string;
    model: string;
    timeout: number;
  }) => Promise<{
    response: string;
    model: string;
    backend: string;
  }>;
};

const RUN_LOCAL = process.env.SURF_E2E_CLOAK_CHATGPT_LOCAL === "1";
const localIt = RUN_LOCAL ? it : it.skip;

describe("e2e: chatgpt cloak local", () => {
  localIt(
    "answers a trivial prompt in instant mode",
    { timeout: 45_000 },
    async () => {
      expect(isCloakBrowserAvailable()).toBe(true);

      const result = await queryWithCloakBrowser({
        query: "Reply with only the number: 2+2",
        model: "instant",
        timeout: 30,
      });

      expect(result.backend).toBe("cloak");
      expect((result.model || "").toLowerCase()).toMatch(/gpt-5\.3|instant/);
      expect(result.response).toMatch(/\b4\b/);
    },
  );
});

```

File: /Users/danielsivan/dev/surf-cli/native/mcp-server.cjs
```cjs
#!/usr/bin/env node
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const { runSurfHeadlessCommand } = require("./headless-command-runner.cjs");

const TOOL_SCHEMAS = {
  chatgpt: {
    desc: "Send a prompt to ChatGPT via CloakBrowser headless",
    schema: {
      prompt: z.string().optional().describe("Prompt text"),
      model: z.string().optional().describe("Model shortcut or provider model name"),
      file: z.string().optional().describe("File path to attach"),
      promptFile: z.string().optional().describe("Read prompt text from this file path"),
      generateImage: z.string().optional().describe("Generate an image and save it to this path"),
      profile: z.string().optional().describe("macOS Chrome profile email for auth"),
      timeout: z.number().optional().describe("Inactivity timeout in seconds"),
    },
  },
  gemini: {
    desc: "Send a prompt to Gemini via Bun WebView headless",
    schema: {
      prompt: z.string().describe("Prompt text"),
      model: z.string().optional().describe("Gemini model name"),
      file: z.string().optional().describe("File path to attach"),
      generateImage: z.string().optional().describe("Generate an image and save it to this path"),
      editImage: z.string().optional().describe("Image path to edit"),
      output: z.string().optional().describe("Output path for image editing"),
      youtube: z.string().optional().describe("YouTube URL to analyze"),
      aspectRatio: z.string().optional().describe("Image aspect ratio, e.g. 1:1 or 16:9"),
      profile: z.string().optional().describe("macOS Chrome profile email for auth"),
      timeout: z.number().optional().describe("Request timeout in seconds"),
    },
  },
  "chatgpt.chats": {
    desc: "List, search, view, export, rename, delete, and download ChatGPT conversations",
    schema: {
      conversationId: z.string().optional().describe("Conversation ID to view or manage"),
      limit: z.number().optional().describe("List count or message limit"),
      all: z.boolean().optional().describe("Fetch all conversations"),
      search: z.string().optional().describe("Search query"),
      export: z.string().optional().describe("Export path"),
      format: z.enum(["markdown", "md", "json"]).optional().describe("Export format"),
      rename: z.string().optional().describe("New title"),
      delete: z.boolean().optional().describe("Delete conversation"),
      deleteIds: z.string().optional().describe("Comma-separated conversation IDs to delete"),
      downloadFile: z.string().optional().describe("File ID to download"),
      output: z.string().optional().describe("Output path for downloaded file"),
      noCache: z.boolean().optional().describe("Bypass local chats cache"),
      profile: z.string().optional().describe("macOS Chrome profile email for auth"),
      timeout: z.number().optional().describe("Timeout in seconds"),
    },
  },
  "chatgpt.reply": {
    desc: "Reply inside an existing ChatGPT conversation",
    schema: {
      conversationId: z.string().describe("Conversation ID"),
      prompt: z.string().optional().describe("Reply prompt"),
      model: z.string().optional().describe("Model shortcut or provider model name"),
      promptFile: z.string().optional().describe("Read reply prompt from this file path"),
      profile: z.string().optional().describe("macOS Chrome profile email for auth"),
      timeout: z.number().optional().describe("Inactivity timeout in seconds"),
    },
  },
};

function normalizeToolArgs(tool, args = {}) {
  const normalized = { ...args };
  if ((tool === "chatgpt" || tool === "gemini") && normalized.prompt !== undefined) {
    normalized.query = normalized.prompt;
    delete normalized.prompt;
  }
  return normalized;
}

function hasPromptInput(args) {
  return Boolean(args.query || args.prompt || args.promptFile || args["prompt-file"]);
}

function validateMcpArgs(tool, args = {}) {
  if ((tool === "chatgpt" || tool === "chatgpt.reply") && !hasPromptInput(args)) {
    throw new Error(`${tool} requires prompt or promptFile`);
  }
}

function formatResultPayload(value) {
  const result = value && value.result !== undefined ? value.result : value;
  if (result && typeof result === "object" && typeof result.response === "string") {
    const metadata = { ...result };
    delete metadata.response;
    if (Object.keys(metadata).length > 0) {
      return {
        content: [
          { type: "text", text: result.response },
          { type: "text", text: JSON.stringify(metadata, null, 2) },
        ],
      };
    }
    return { content: [{ type: "text", text: result.response }] };
  }
  if (result && typeof result === "object" && typeof result.text === "string") {
    const metadata = { ...result };
    delete metadata.text;
    if (Object.keys(metadata).length > 0) {
      return {
        content: [
          { type: "text", text: result.text },
          { type: "text", text: JSON.stringify(metadata, null, 2) },
        ],
      };
    }
    return { content: [{ type: "text", text: result.text }] };
  }
  if (typeof result === "string") {
    return { content: [{ type: "text", text: result }] };
  }
  return { content: [{ type: "text", text: JSON.stringify(result ?? {}, null, 2) }] };
}

async function runMcpHeadlessTool(name, args, runner = runSurfHeadlessCommand) {
  try {
    const normalizedArgs = normalizeToolArgs(name, args);
    validateMcpArgs(name, normalizedArgs);
    const value = await runner(name, normalizedArgs, { json: true });
    return formatResultPayload(value);
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
}

class SurfMcpServer {
  constructor({ runner = runSurfHeadlessCommand } = {}) {
    this.runner = runner;
    this.server = new McpServer({
      name: "surf",
      version: "1.0.0",
    });
    this.registerTools();
  }

  registerTools() {
    for (const [name, def] of Object.entries(TOOL_SCHEMAS)) {
      const schemaObj = {};
      for (const [key, val] of Object.entries(def.schema)) {
        schemaObj[key] = val;
      }

      this.server.tool(
        name,
        def.desc,
        schemaObj,
        async (args) => runMcpHeadlessTool(name, args, this.runner),
      );
    }
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("surf MCP server started");
  }
}

async function main() {
  const server = new SurfMcpServer();
  await server.start();
}

if (require.main === module) {
  main().catch((err) => {
    console.error("MCP Server error:", err.message);
    process.exit(1);
  });
}

module.exports = {
  SurfMcpServer,
  PiChromeMcpServer: SurfMcpServer,
  TOOL_SCHEMAS,
  formatResultPayload,
  normalizeToolArgs,
  runMcpHeadlessTool,
  validateMcpArgs,
};

```

File: /Users/danielsivan/dev/surf-cli/test/unit/headless-command-runner.test.ts
```ts
import { describe, expect, it } from "vitest";

const runner = require("../../native/headless-command-runner.cjs");

describe("headless-command-runner buildCliArgs", () => {
  it("builds ChatGPT prompt args with JSON output", () => {
    expect(runner.buildCliArgs("chatgpt", { query: "hello", model: "pro", profile: "user@example.com" })).toEqual([
      "chatgpt",
      "hello",
      "--model",
      "pro",
      "--profile",
      "user@example.com",
      "--json",
    ]);
  });

  it("builds Gemini prompt args", () => {
    expect(runner.buildCliArgs("gemini", { prompt: "hello", file: "data.csv" })).toEqual([
      "gemini",
      "hello",
      "--file",
      "data.csv",
      "--json",
    ]);
  });

  it("builds ChatGPT conversation args", () => {
    expect(runner.buildCliArgs("chatgpt.chats", { conversationId: "abc", noCache: true, limit: 3 })).toEqual([
      "chatgpt.chats",
      "abc",
      "--no-cache",
      "--limit",
      "3",
      "--json",
    ]);
  });

  it("builds ChatGPT reply args", () => {
    expect(runner.buildCliArgs("chatgpt.reply", { conversationId: "abc", prompt: "thanks" })).toEqual([
      "chatgpt.reply",
      "abc",
      "thanks",
      "--json",
    ]);
  });

  it("accepts kebab conversation-id for reply args", () => {
    expect(runner.buildCliArgs("chatgpt.reply", { "conversation-id": "abc", query: "thanks" })).toEqual([
      "chatgpt.reply",
      "abc",
      "thanks",
      "--json",
    ]);
  });

  it("accepts kebab conversation-id for chats args", () => {
    expect(runner.buildCliArgs("chatgpt.chats", { "conversation-id": "abc" })).toEqual([
      "chatgpt.chats",
      "abc",
      "--json",
    ]);
  });

  it("does not add JSON when disabled", () => {
    expect(runner.buildCliArgs("chatgpt", { query: "hello" }, { json: false })).toEqual([
      "chatgpt",
      "hello",
    ]);
  });

  it("does not duplicate existing JSON flag", () => {
    expect(runner.buildCliArgs("gemini", { query: "hello", json: true })).toEqual([
      "gemini",
      "hello",
      "--json",
    ]);
  });

  it("skips false null and undefined options", () => {
    expect(runner.buildCliArgs("chatgpt", {
      query: "hello",
      all: false,
      model: null,
      profile: undefined,
    })).toEqual(["chatgpt", "hello", "--json"]);
  });

  it("converts camelCase options to kebab flags", () => {
    expect(runner.buildCliArgs("chatgpt", {
      query: "hello",
      promptFile: "prompt.md",
      generateImage: "/tmp/out.png",
    })).toEqual([
      "chatgpt",
      "hello",
      "--prompt-file",
      "prompt.md",
      "--generate-image",
      "/tmp/out.png",
      "--json",
    ]);
  });

  it("consumes both prompt aliases without leaking duplicate flags", () => {
    expect(runner.buildCliArgs("chatgpt", { query: "query text", prompt: "prompt text" })).toEqual([
      "chatgpt",
      "query text",
      "--json",
    ]);
  });

  it("consumes both conversation-id aliases without leaking duplicate flags", () => {
    expect(runner.buildCliArgs("chatgpt.chats", {
      conversationId: "camel",
      "conversation-id": "kebab",
    })).toEqual(["chatgpt.chats", "camel", "--json"]);
  });

  it("converts underscore options to kebab flags", () => {
    expect(runner.buildCliArgs("gemini", {
      query: "hello",
      aspect_ratio: "16:9",
    })).toEqual(["gemini", "hello", "--aspect-ratio", "16:9", "--json"]);
  });

  it("serializes array options as comma-separated values", () => {
    expect(runner.buildCliArgs("chatgpt.chats", { deleteIds: ["a", "b"] })).toEqual([
      "chatgpt.chats",
      "--delete-ids",
      "a,b",
      "--json",
    ]);
  });

  it("supports prompt-less chats list", () => {
    expect(runner.buildCliArgs("chatgpt.chats", {})).toEqual(["chatgpt.chats", "--json"]);
  });

  it("supports prompt-less ChatGPT command shape for prompt-file only", () => {
    expect(runner.buildCliArgs("chatgpt", { promptFile: "prompt.md" })).toEqual([
      "chatgpt",
      "--prompt-file",
      "prompt.md",
      "--json",
    ]);
  });

  it("keeps numeric option values as strings in argv", () => {
    expect(runner.buildCliArgs("gemini", { query: "hello", timeout: 30 })).toEqual([
      "gemini",
      "hello",
      "--timeout",
      "30",
      "--json",
    ]);
  });

  it("derives runner timeout from request timeout seconds", () => {
    expect(runner.resolveRunnerTimeoutMs({ timeout: 30 }, {})).toBe(60000);
  });

  it("allows runner timeout override", () => {
    expect(runner.resolveRunnerTimeoutMs({ timeout: 30 }, { timeoutMs: 123 })).toBe(123);
  });

  it("allows disabling runner timeout", () => {
    expect(runner.resolveRunnerTimeoutMs({}, { timeoutMs: false })).toBe(0);
  });

  it("uses a default runner timeout when request timeout is absent", () => {
    expect(runner.resolveRunnerTimeoutMs({}, {})).toBe(runner.DEFAULT_RUNNER_TIMEOUT_MS);
  });

  it("exports the supported command set", () => {
    expect(Array.from(runner.SUPPORTED_HEADLESS_COMMANDS).sort()).toEqual([
      "chatgpt",
      "chatgpt.chats",
      "chatgpt.reply",
      "gemini",
    ]);
  });

  it("does not include removed provider commands in the supported command set", () => {
    expect(runner.SUPPORTED_HEADLESS_COMMANDS.has("aistudio")).toBe(false);
    expect(runner.SUPPORTED_HEADLESS_COMMANDS.has("perplexity")).toBe(false);
    expect(runner.SUPPORTED_HEADLESS_COMMANDS.has("grok")).toBe(false);
  });

  it("rejects removed browser commands", () => {
    expect(() => runner.buildCliArgs("screenshot", {})).toThrow("not supported");
  });
});

```

File: /Users/danielsivan/dev/surf-cli/native/chatgpt-cloak-worker.mjs
```mjs
/**
 * ChatGPT CloakBrowser Worker
 *
 * Stealth Chromium automation using CloakBrowser (Playwright-based).
 * Defeats bot detection via 33 C++ source-level patches + behavioral humanization.
 *
 * Protocol: stdin JSON lines → stdout JSON lines
 *   Input:  { type:"query", prompt, model?, file?, profile?, timeout?, generateImage? }
 *   Output: { type:"progress"|"success"|"error", … }
 */

import { launchPersistentContext } from 'cloakbrowser';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { createRequire } from 'module';
import { homedir, tmpdir } from 'os';
import { join, resolve as pathResolve } from 'path';
import { loadAndInjectChatgptCookies } from './chatgpt-cloak-profile-auth.mjs';

const require = createRequire(import.meta.url);
const { enterPromptWithVerification } = require('./chatgpt-cloak-prompt-entry.cjs');
const {
  extractLatestActiveUserMessage,
  evaluatePromptPersistence,
} = require('./chatgpt-cloak-prompt-validation.cjs');
const {
  DEFAULT_CHATGPT_QUERY_TIMEOUT_SEC,
  detectResponseActivity,
  resolveKeepaliveIntervalMs,
  resolveQueryTimeoutSeconds,
} = require('./chatgpt-cloak-timeout.cjs');

// ============================================================================
// Logging helpers — everything goes to stdout as JSON lines

const emit = (obj) => process.stdout.write(JSON.stringify({ ...obj, t: Date.now() }) + '\n');
const log   = (level, message, data) => emit({ type: 'log', level, message, data });
const progress = (step, total, msg)  => emit({ type: 'progress', step, total, message: msg });
const success  = (payload)           => emit({ type: 'success', ...payload });
const fail     = (code, message, d)  => emit({ type: 'error', code, message, details: d });

/** Native sleep — does NOT leak CDP signals (unlike page.waitForTimeout). */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ============================================================================
// Model mapping — mirrors chatgpt-bun-worker-logic.ts

const MODEL_MAP = {
  'gpt-4o':            { mode: 'instant',  tid: 'model-switcher-gpt-5-3' },
  'gpt-4.1':           { mode: 'instant',  tid: 'model-switcher-gpt-5-3' },
  'gpt-4.1-mini':      { mode: 'instant',  tid: 'model-switcher-gpt-5-3' },
  'gpt-5.3':           { mode: 'instant',  tid: 'model-switcher-gpt-5-3' },
  'instant':           { mode: 'instant',  tid: 'model-switcher-gpt-5-3' },
  'o3':                { mode: 'thinking', tid: 'model-switcher-gpt-5-4-thinking' },
  'o4-mini':           { mode: 'thinking', tid: 'model-switcher-gpt-5-4-thinking' },
  'gpt-5.4-thinking':  { mode: 'thinking', tid: 'model-switcher-gpt-5-4-thinking' },
  'thinking':          { mode: 'thinking', tid: 'model-switcher-gpt-5-4-thinking' },
  'o1-pro':            { mode: 'pro',      tid: 'model-switcher-gpt-5-4-pro' },
  'gpt-5.4-pro':       { mode: 'pro',      tid: 'model-switcher-gpt-5-4-pro' },
  'pro':               { mode: 'pro',      tid: 'model-switcher-gpt-5-4-pro' },
  'chatgpt-pro':       { mode: 'pro',      tid: 'model-switcher-gpt-5-4-pro' },
};

function resolveModel(id) {
  return MODEL_MAP[(id || '').toLowerCase().trim()] || { mode: 'default', tid: null };
}

// ============================================================================
// UI noise patterns — strips chrome from DOM text

const UI_NOISE = [
  /^ChatGPT said:\s*/i,
  /Thought for [\w\s]+ seconds?\s*/gi,
  /^Thinking\s*/i,
  /^Analyzing image\s*/i,
  /^Searching the web\s*/i,
  /Give feedback\s*/gi,
  /ChatGPT Instruments\s*/gi,
  /\s*Copy\s*$/gm,
  /^Sources\s*/gm,
  /^\d+\s*\/\s*\d+\s*$/gm,         // pagination "1/3"
  /Upgrade to Plus to use .*$/gim,
  /You've reached the .* limit.*$/gim,
];

function sanitize(raw) {
  if (!raw) return '';
  let text = raw;
  for (const re of UI_NOISE) text = text.replace(re, '');
  return text.trim();
}

// ============================================================================
// Profile directory management

/** Shared persistent profile for no-auth sessions */
function sharedProfileDir() {
  const dir = join(homedir(), '.surf', 'cloak-profile');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Isolated temp profile for --profile sessions (prevents cookie contamination) */
function tempProfileDir() {
  return mkdtempSync(join(tmpdir(), 'surf-cloak-session-'));
}

// ============================================================================
// Launch options builder

function buildLaunchOpts(userDataDir) {
  return {
    userDataDir,
    headless: true,
    humanize: true,
    humanPreset: 'careful',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    args: ['--fingerprint-storage-quota=5000'],
  };
}

// ============================================================================
// Readiness checks

async function waitForReady(page, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await page.evaluate((promptSelectors) => {
      // Cloudflare challenge
      if (document.title.toLowerCase().includes('just a moment')) return 'cloudflare';
      // Editor present = ready (try multiple selectors)
      if (document.querySelector(promptSelectors)) return 'ready';
      // Login page
      const btns = Array.from(document.querySelectorAll('button, a'));
      if (btns.some(b => /^(log in|sign in|sign up)$/i.test((b.textContent || '').trim()))) return 'login';
      return 'loading';
    }, PROMPT_SELECTORS_CSS);

    if (state === 'ready') return { ready: true, loggedIn: true };
    if (state === 'login') return { ready: true, loggedIn: false };
    if (state === 'cloudflare') {
      log('warn', 'Cloudflare challenge detected, waiting...');
    }
    await sleep(1000);
  }
  return { ready: false, loggedIn: false };
}

async function waitForConversationReady(page, conversationId, timeoutMs = 30_000) {
  const expectedPath = `/c/${conversationId}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const currentUrl = page.url();
    const state = await page.evaluate((promptSelectors) => {
      if (document.querySelector(promptSelectors)) return 'ready';
      const btns = Array.from(document.querySelectorAll('button, a'));
      if (btns.some((b) => /^(log in|sign in|sign up)$/i.test((b.textContent || '').trim()))) return 'login';
      return 'loading';
    }, PROMPT_SELECTORS_CSS);

    if (state === 'login') return { ready: false, loggedIn: false, currentUrl };
    if (currentUrl.includes(expectedPath) && state === 'ready') {
      return { ready: true, loggedIn: true, currentUrl };
    }
    if (currentUrl === 'https://chatgpt.com/' || currentUrl === 'https://chatgpt.com') {
      return { ready: false, loggedIn: true, currentUrl };
    }
    await sleep(1000);
  }
  return { ready: false, loggedIn: true, currentUrl: page.url() };
}

function extractConversationIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/\/c\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

async function waitForConversationIdFromUrl(page, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const id = extractConversationIdFromUrl(page.url());
    if (id) return id;
    await sleep(500);
  }
  return extractConversationIdFromUrl(page.url());
}

async function fetchConversation(page, conversationId) {
  return await page.evaluate(async (id) => {
    const safeJson = async (response) => {
      const text = await response.text();
      if (!text) return { text: '', json: null };
      try { return { text, json: JSON.parse(text) }; }
      catch { return { text, json: null }; }
    };

    try {
      const sessionResp = await fetch('/api/auth/session', { credentials: 'same-origin' });
      const sessionPayload = await safeJson(sessionResp);
      const accessToken = sessionPayload.json?.accessToken;
      if (!sessionResp.ok || !accessToken) {
        return { ok: false, code: 'login_required', status: sessionResp.status || 401, body: sessionPayload.text };
      }

      const response = await fetch(`/backend-api/conversation/${encodeURIComponent(id)}`, {
        credentials: 'same-origin',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });
      const payload = await safeJson(response);
      if (!response.ok) {
        return {
          ok: false,
          code: response.status === 404 ? 'conversation_not_found' : 'backend_error',
          status: response.status,
          body: payload.text,
        };
      }
      return { ok: true, conversation: payload.json };
    } catch (error) {
      return { ok: false, code: error?.code || 'backend_error', message: error?.message || String(error) };
    }
  }, conversationId);
}

function summarizePromptValidation(validation) {
  const actualText = typeof validation?.actualText === 'string' ? validation.actualText : '';
  const previewChars = 120;
  return {
    conversationId: validation?.conversationId || null,
    code: validation?.code || null,
    failureReason: validation?.failureReason || null,
    expectedChars: validation?.expectedChars || 0,
    actualChars: validation?.actualChars || 0,
    exactMatch: validation?.exactMatch === true,
    latestUserNodeId: validation?.latestUserNodeId || null,
    advancedPastBaseline:
      Object.prototype.hasOwnProperty.call(validation || {}, 'advancedPastBaseline')
        ? validation.advancedPastBaseline
        : null,
    fileMapOnly: validation?.fileMapOnly === true,
    hasBigPasteAttachment: validation?.hasBigPasteAttachment === true,
    attachmentCount: validation?.attachmentCount || 0,
    attachmentNames: Array.isArray(validation?.attachmentNames) ? validation.attachmentNames : [],
    timedOut: validation?.timedOut === true,
    status: validation?.status || null,
    actualPreviewStart: actualText ? actualText.slice(0, previewChars) : '',
    actualPreviewEnd: actualText.length > previewChars ? actualText.slice(-previewChars) : '',
  };
}

async function captureBaselineUserNodeId(page, conversationId) {
  if (!conversationId) return null;
  const result = await fetchConversation(page, conversationId);
  if (!result?.ok) return { ok: false, code: result?.code || 'prompt_validation_fetch_failed', status: result?.status, body: result?.body };
  const latestUser = extractLatestActiveUserMessage(result.conversation);
  return { ok: true, baselineUserNodeId: latestUser?.nodeId || null };
}

async function resolveConversationIdForValidation(page, existingConversationId, timeoutMs = 30_000) {
  if (existingConversationId) return existingConversationId;
  return await waitForConversationIdFromUrl(page, timeoutMs);
}

async function waitForPromptPersistenceValidation({
  page,
  conversationId,
  expectedPrompt,
  baselineUserNodeId = null,
  timeoutMs = 30_000,
  pollMs = 1_000,
}) {
  const deadline = Date.now() + timeoutMs;
  let lastObserved = {
    ok: false,
    failureReason: 'validation_not_started',
    expectedChars: expectedPrompt.length,
    actualChars: 0,
    exactMatch: false,
    latestUserNodeId: null,
    advancedPastBaseline: baselineUserNodeId ? false : null,
    fileMapOnly: false,
    hasBigPasteAttachment: false,
    attachmentCount: 0,
    attachmentNames: [],
    actualText: '',
    conversationId,
  };

  while (Date.now() < deadline) {
    const result = await fetchConversation(page, conversationId);
    if (!result?.ok) {
      lastObserved = {
        ok: false,
        code: result?.code || 'prompt_validation_fetch_failed',
        failureReason: result?.code || 'prompt_validation_fetch_failed',
        status: result?.status,
        body: result?.body,
        conversationId,
      };
      if (lastObserved.code === 'login_required') return lastObserved;
    } else {
      lastObserved = {
        ...evaluatePromptPersistence({
          conversation: result.conversation,
          expectedPrompt,
          baselineUserNodeId,
        }),
        conversationId,
      };
      if (lastObserved.ok) return lastObserved;
      if (lastObserved.failureReason === 'file_map_placeholder' || lastObserved.failureReason === 'big_paste_attachment') {
        return lastObserved;
      }
    }
    await sleep(pollMs);
  }

  return { ...lastObserved, ok: false, timedOut: true };
}

// ============================================================================
// Shared selectors — unified assistant-turn detection (mirrors bun worker)

const ASSISTANT_SELECTOR =
  '[data-message-author-role="assistant"], [data-turn="assistant"]';

const CONVERSATION_TURN_SELECTOR =
  'section[data-testid^="conversation-turn"], article[data-testid^="conversation-turn"], div[data-testid^="conversation-turn"]';

const STOP_BUTTON_SELECTOR =
  'button[data-testid="stop-button"], button[aria-label="Stop"]';

const IS_ACTIVE_STOP_BUTTON_JS = `(() => {
  var STOP_SEL = '${STOP_BUTTON_SELECTOR}';
  function isVisible(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    var style = window.getComputedStyle(el);
    if (!style) return false;
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function isEnabled(el) {
    if (!el) return false;
    if (el.disabled) return false;
    var aria = (el.getAttribute('aria-disabled') || '').toLowerCase();
    if (aria === 'true') return false;
    return true;
  }
  var buttons = document.querySelectorAll(STOP_SEL);
  for (var i = 0; i < buttons.length; i++) {
    var btn = buttons[i];
    if (isVisible(btn) && isEnabled(btn)) return true;
  }
  return false;
})()`;

// Prompt composer selectors — broader than just #prompt-textarea to handle ChatGPT DOM changes
const PROMPT_SELECTOR_LIST = [
  '#prompt-textarea',
  '[data-testid="composer-textarea"]',
  'textarea[name="prompt-textarea"]',
  '.ProseMirror',
  '[contenteditable="true"][data-virtualkeyboard="true"]',
];
const PROMPT_SELECTORS_CSS = PROMPT_SELECTOR_LIST.join(', ');

// Keep this list strict. Generic form buttons can match attach/model controls,
// causing false-ready verification or clicking the wrong action.
const SEND_BUTTON_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[data-testid*="composer-send"]',
  'button[aria-label="Send prompt"]',
  'button[aria-label="Send"]',
];

const FINISHED_ACTION_SELECTOR =
  'button[data-testid="copy-turn-action-button"], button[data-testid="good-response-turn-action-button"]';

// Helper JS fragment: resolve last assistant turn node (shared by extract/detect/image)
const FIND_LAST_ASSISTANT_JS = `
  var TURN_SEL = '${CONVERSATION_TURN_SELECTOR}';
  var ASSISTANT_SEL = '${ASSISTANT_SELECTOR}';
  function isAssistant(node) {
    if (!(node instanceof HTMLElement)) return false;
    var sr = node.querySelector('.sr-only');
    if (sr) {
      var srText = (sr.textContent || '').toLowerCase().trim();
      if (srText.includes('chatgpt said') || srText.includes('assistant said')) return true;
      if (srText.includes('you said') || srText.includes('user said')) return false;
    }
    var role = (node.getAttribute('data-message-author-role') || '').toLowerCase();
    if (role === 'assistant') return true;
    if (role === 'user') return false;
    var turn = (node.getAttribute('data-turn') || '').toLowerCase();
    if (turn === 'assistant') return true;
    return !!node.querySelector(ASSISTANT_SEL);
  }
  var turns = document.querySelectorAll(TURN_SEL);
  var lastAssistant = null;
  for (var i = turns.length - 1; i >= 0; i--) {
    if (isAssistant(turns[i])) { lastAssistant = turns[i]; break; }
  }
`;

// ============================================================================
// Response text extraction from DOM — structured return + innerText

const EXTRACT_TEXT_JS = `(() => {
  ${FIND_LAST_ASSISTANT_JS}
  var FINISH_SEL = '${FINISHED_ACTION_SELECTOR}';
  if (!lastAssistant) return { text: '', finished: false, messageId: null, hasAssistantTurn: false };
  var text = '';
  var md = lastAssistant.querySelector('.markdown');
  if (md) {
    text = (md.innerText || '').trim();
  } else {
    var content = lastAssistant.querySelector('[data-message-content]')
               || lastAssistant.querySelector('.prose')
               || lastAssistant;
    var clone = content.cloneNode(true);
    var remove = clone.querySelectorAll('.sr-only, button, nav, form, script, style');
    for (var r = 0; r < remove.length; r++) remove[r].remove();
    text = (clone.innerText || '').trim();
  }
  var msgEl = lastAssistant.querySelector('[data-message-id]');
  var messageId = msgEl ? msgEl.getAttribute('data-message-id') : null;
  var finished = !!lastAssistant.querySelector(FINISH_SEL);
  var turnId = lastAssistant.getAttribute('data-testid') || null;
  return { text: text, finished: finished, messageId: messageId, hasAssistantTurn: true, turnId: turnId };
})()`;

const DETECT_PHASE_JS = `(() => {
  var STOP_SEL = '${STOP_BUTTON_SELECTOR}';
  function isVisible(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    var style = window.getComputedStyle(el);
    if (!style) return false;
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function isEnabled(el) {
    if (!el) return false;
    if (el.disabled) return false;
    var aria = (el.getAttribute('aria-disabled') || '').toLowerCase();
    if (aria === 'true') return false;
    return true;
  }
  var stop = null;
  var buttons = document.querySelectorAll(STOP_SEL);
  for (var i = 0; i < buttons.length; i++) {
    var candidate = buttons[i];
    if (isVisible(candidate) && isEnabled(candidate)) { stop = candidate; break; }
  }
  if (!stop) return { phase: '', isThinking: false, thinkingText: '' };
  ${FIND_LAST_ASSISTANT_JS}
  if (!lastAssistant) return { phase: 'Connecting', isThinking: true, thinkingText: '' };

  // Check for thinking indicators (Pro model uses details/summary for thinking bubble)
  // The thinking element can coexist with .markdown — check it FIRST
  var thinkingEl = lastAssistant.querySelector('details') || lastAssistant.querySelector('[class*="think"]');
  var isThinking = false;
  var thinkingText = '';
  if (thinkingEl) {
    // Check if the thinking bubble is still "open" / actively being streamed
    var summary = thinkingEl.querySelector('summary');
    var summaryText = summary ? (summary.textContent || '').trim() : '';
    // "Thinking" (active) vs "Thought for Ns" (completed)
    var isActiveThinking = summaryText === 'Thinking' || summaryText.startsWith('Thinking');
    if (isActiveThinking) {
      isThinking = true;
      // Get the thinking content (everything except the summary)
      var thinkClone = thinkingEl.cloneNode(true);
      var sumEl = thinkClone.querySelector('summary');
      if (sumEl) sumEl.remove();
      thinkingText = (thinkClone.textContent || '').trim();
    }
  }

  var md = lastAssistant.querySelector('.markdown');
  var hasResponse = md && (md.innerText || '').trim();

  if (hasResponse && !isThinking) return { phase: 'Responding', isThinking: false, thinkingText: '' };

  // If actively thinking (with or without response started)
  if (isThinking) {
    var label = thinkingText ? thinkingText.split('\\n')[0].trim().slice(0, 80) || 'Thinking' : 'Thinking';
    return { phase: label, isThinking: true, thinkingText: thinkingText };
  }

  // Fallback: raw assistant-turn text. Avoid clone-pruning here; current ChatGPT Pro
  // thinking previews can live under generic text containers and disappear if we over-prune.
  var raw = (lastAssistant.textContent || '').trim();
  raw = raw.replace(/^(ChatGPT said:|Assistant said:)/i, '').trim();
  var label = raw.split('\\n')[0].trim().slice(0, 80) || 'Thinking';
  var body = raw;
  var timerMatch = raw.match(/^(Thought|Thinking)\\s+(for\\s+)?\\d+\\s*s(econds?)?\\n?/);
  if (timerMatch) body = raw.slice(timerMatch[0].length);
  return { phase: label, isThinking: true, thinkingText: body };
})()`;

// ============================================================================
// SSE fetch stream capture — ported from bun worker

async function injectFetchStreamCapture(page) {
  await page.evaluate(`
    (function() {
      if (window.__surfChatFetchPatched) return;
      window.__surfChatFetchPatched = true;
      window.__surfChatResponse = { text: '', done: false, messageId: null, model: null, parts: [] };
      var origFetch = window.fetch;
      window.fetch = function() {
        var args = arguments;
        var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
        var opts = args[1] || {};
        var method = (opts.method || 'GET').toUpperCase();
        var result = origFetch.apply(this, args);
        var isConv = method === 'POST' && (url.indexOf('/backend-api/f/conversation') !== -1 || url.indexOf('/backend-api/conversation') !== -1);
        if (isConv) {
          result.then(function(resp) {
            if (!resp.body || !resp.ok) return;
            window.__surfChatResponse = { text: '', done: false, messageId: null, model: null, parts: [] };
            var clone = resp.clone();
            var reader = clone.body.getReader();
            var decoder = new TextDecoder();
            var buf = '';
            function applyOp(op) {
              var r = window.__surfChatResponse;
              var m = op.p.match(/^\\/message\\/content\\/parts\\/(\\d+)$/);
              if (m) {
                var idx = parseInt(m[1], 10);
                while (r.parts.length <= idx) r.parts.push('');
                if (op.o === 'append' && typeof op.v === 'string') r.parts[idx] += op.v;
                else if (op.o === 'replace') r.parts[idx] = typeof op.v === 'string' ? op.v : JSON.stringify(op.v);
                r.text = r.parts.join('');
                return;
              }
              if (op.p === '/message/status' && op.o === 'replace' && op.v === 'finished_successfully') { r.done = true; return; }
              if (op.p === '/message/id' && op.o === 'replace' && typeof op.v === 'string') { r.messageId = op.v; return; }
              if (op.p === '/message/metadata/model_slug' && op.o === 'replace' && typeof op.v === 'string') { r.model = op.v; return; }
            }
            function pump() {
              reader.read().then(function(chunk) {
                if (chunk.done) { window.__surfChatResponse.done = true; return; }
                buf += decoder.decode(chunk.value, { stream: true });
                var lines = buf.split('\\n');
                buf = lines.pop() || '';
                for (var i = 0; i < lines.length; i++) {
                  var line = lines[i].trim();
                  if (!line) continue;
                  if (line.indexOf('event:') === 0) continue;
                  if (line.indexOf('data: ') === 0) line = line.slice(6).trim();
                  if (line === '[DONE]') { window.__surfChatResponse.done = true; continue; }
                  if (line === 'message_stream_complete') { window.__surfChatResponse.done = true; continue; }
                  if (line[0] !== '{') continue;
                  try {
                    var obj = JSON.parse(line);
                    if (obj.type === 'message_stream_complete') { window.__surfChatResponse.done = true; continue; }
                    var msg = (obj.v && obj.v.message) || obj.message;
                    if (msg && msg.author && msg.author.role === 'assistant' && msg.content && msg.content.parts) {
                      var t = msg.content.parts.join('');
                      if (t) { window.__surfChatResponse.text = t; window.__surfChatResponse.parts = msg.content.parts.slice(); }
                      if (msg.id) window.__surfChatResponse.messageId = msg.id;
                      if (msg.metadata && msg.metadata.model_slug) window.__surfChatResponse.model = msg.metadata.model_slug;
                      if (msg.status === 'finished_successfully') window.__surfChatResponse.done = true;
                      continue;
                    }
                    if (typeof obj.o === 'string' && typeof obj.p === 'string') { applyOp(obj); continue; }
                    if (Array.isArray(obj.v)) {
                      for (var j = 0; j < obj.v.length; j++) {
                        var op = obj.v[j];
                        if (typeof op.o === 'string' && typeof op.p === 'string') applyOp(op);
                      }
                      continue;
                    }
                  } catch(e) {}
                }
                pump();
              }).catch(function() { window.__surfChatResponse.done = true; });
            }
            pump();
          }).catch(function() {});
        }
        return result;
      };
    })()
  `);
}

async function readStreamResponse(page) {
  return await page.evaluate(`window.__surfChatResponse || { text: '', done: false, messageId: null, model: null }`);
}

// ============================================================================
// Text arbitration + stability — local equivalents of bun helpers

// Note: streamDone accepted to match bun helper call shape but not consulted here
function chooseBestText({ streamText, domText, streamDone, domFinished }) {
  if (domFinished && domText.length > 0) return domText;
  if (streamText.length > 0) return streamText;
  return domText || streamText;
}

function advanceTextStability({ text, previousText, isStreaming, finished, stableCycles, lastChangeAtMs, nowMs, requiredStableCycles, minStableMs }) {
  if (text !== previousText) return { stableCycles: 0, lastChangeAtMs: nowMs, shouldComplete: false };
  if (finished && text.length > 0) return { stableCycles: stableCycles + 1, lastChangeAtMs, shouldComplete: true };
  const newStable = stableCycles + 1;
  const stableMs = nowMs - lastChangeAtMs;
  if (!isStreaming && text.length > 0 && newStable >= requiredStableCycles && stableMs >= minStableMs) {
    return { stableCycles: newStable, lastChangeAtMs, shouldComplete: true };
  }
  return { stableCycles: newStable, lastChangeAtMs, shouldComplete: false };
}

// ============================================================================
// Thinking trace extraction — reads React fiber state (works headless)

// Max thoughts to return (cap payload size for very long Pro sessions)
const MAX_THINKING_TRACE_THOUGHTS = 100;
const MAX_THOUGHT_CONTENT_CHARS = 2000;

// Accepts optional turnId to scope extraction to the current response turn.
// Falls back to last assistant turn if turnId not provided.
const makeExtractThinkingTraceJS = (rawTurnId) => {
  // Sanitize turnId — only allow alphanumeric, hyphens, underscores (data-testid values)
  const turnId = rawTurnId && /^[a-zA-Z0-9_-]+$/.test(rawTurnId) ? rawTurnId : null;
  return `(() => {
  ${FIND_LAST_ASSISTANT_JS}
  // Scope to specific turn if turnId provided, otherwise use last assistant
  var targetTurn = null;
  ${turnId ? `
  var specificTurn = document.querySelector('[data-testid="${turnId}"]');
  if (specificTurn) targetTurn = specificTurn;
  ` : ''}
  if (!targetTurn) targetTurn = lastAssistant;
  if (!targetTurn) return null;

  // Find "Thought for" / "Thinking for" button WITHIN the target turn only
  var buttons = Array.from(targetTurn.querySelectorAll('button'));
  var thoughtBtn = buttons.find(function(b) {
    return /Thought for|Thinking for/i.test(b.innerText || b.textContent);
  });
  if (!thoughtBtn) return null;

  // Walk React fiber tree to find allMessages with thinking data
  var fiberKey = Object.keys(thoughtBtn).find(function(k) { return k.startsWith('__reactFiber$'); });
  if (!fiberKey) return null;

  var MAX_THOUGHTS = ${MAX_THINKING_TRACE_THOUGHTS};
  var MAX_CONTENT = ${MAX_THOUGHT_CONTENT_CHARS};
  var fiber = thoughtBtn[fiberKey];
  var depth = 0;
  while (fiber && depth < 50) {
    if (fiber.memoizedProps && fiber.memoizedProps.allMessages) {
      var msgs = fiber.memoizedProps.allMessages;
      var thoughts = [];
      var durationSec = null;
      var recapText = null;
      var _debugContentTypes = [];

      for (var i = 0; i < msgs.length; i++) {
        var m = msgs[i];
        if (!m || !m.content) continue;
        if (m.content.content_type) _debugContentTypes.push(m.content.content_type);

        // Extract thoughts array (point-by-point reasoning trace)
        if (m.content.content_type === 'thoughts' && Array.isArray(m.content.thoughts)) {
          for (var j = 0; j < m.content.thoughts.length && thoughts.length < MAX_THOUGHTS; j++) {
            var t = m.content.thoughts[j];
            if (typeof t === 'string') {
              thoughts.push({ summary: '', content: t.slice(0, MAX_CONTENT) });
            } else if (t && typeof t === 'object') {
              var chunkText = Array.isArray(t.chunks)
                ? t.chunks.filter(function(c) { return typeof c === 'string'; }).join('')
                : '';
              var contentText = '';
              if (typeof t.content === 'string' && t.content) contentText = t.content;
              else if (chunkText) contentText = chunkText;
              thoughts.push({
                summary: (t.summary || '').slice(0, 200),
                content: contentText.slice(0, MAX_CONTENT),
                finished: t.finished === true,
              });
            }
          }
        }

        // Extract duration and recap from reasoning_recap message
        if (m.content.content_type === 'reasoning_recap') {
          recapText = m.content.content || null;
          if (m.metadata && typeof m.metadata.finished_duration_sec === 'number') {
            durationSec = m.metadata.finished_duration_sec;
          }
        }
      }

      if (thoughts.length === 0 && !recapText) return null;
      return {
        thoughts: thoughts,
        durationSec: durationSec,
        recapText: recapText,
        truncated: thoughts.length >= MAX_THOUGHTS,
        _debugContentTypes: _debugContentTypes,
      };
    }
    fiber = fiber.return;
    depth++;
  }
  return null;
})()`;
};

async function extractThinkingTrace(page, turnId) {
  try {
    const js = makeExtractThinkingTraceJS(turnId || null);
    const result = await page.evaluate(js);
    return result;
  } catch (e) {
    log('warn', 'Thinking trace extraction failed', { error: e.message });
    return null;
  }
}

// ============================================================================
// Image detection + save — uses unified assistant-root resolution

async function detectAndSaveImage(page, savePath) {
  const imgData = await page.evaluate(`(() => {
    ${FIND_LAST_ASSISTANT_JS}
    if (!lastAssistant) return null;
    var imgs = lastAssistant.querySelectorAll('img:not([alt="User"]):not([alt="ChatGPT"])');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (img.naturalWidth > 100 && img.naturalHeight > 100) {
        return { src: img.src, width: img.naturalWidth, height: img.naturalHeight };
      }
    }
    return null;
  })()`);

  if (!imgData) return null;

  log('info', 'Image candidate found', { width: imgData.width, height: imgData.height });

  // Fetch image bytes in page context (handles auth/CORS)
  const base64 = await page.evaluate(async (src) => {
    try {
      const resp = await fetch(src);
      const buf = await resp.arrayBuffer();
      return btoa(String.fromCharCode(...new Uint8Array(buf)));
    } catch { return null; }
  }, imgData.src);

  if (!base64) {
    log('warn', 'Image fetch failed');
    return null;
  }

  const resolved = pathResolve(savePath);
  const dir = join(resolved, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(resolved, Buffer.from(base64, 'base64'));
  log('info', 'Image saved', { path: resolved, bytes: Buffer.from(base64, 'base64').length });
  return resolved;
}

// ============================================================================
// Main query handler

async function runQuery({ prompt, model, file, profile, timeout = DEFAULT_CHATGPT_QUERY_TIMEOUT_SEC, generateImage, conversationId }) {
  const t0 = Date.now();
  const resolved = resolveModel(model);
  const useInjectedProfile = !!profile;
  let tempDir = null;

  // ── Phase 1: Launch ──────────────────────────────────────────────────
  progress(1, 6, `Launching CloakBrowser — ${resolved.mode}`);

  // Profile strategy:
  // - With --profile: temp dir + injected cookies (isolated, no contamination)
  // - Without: shared persistent dir (relies on prior login)
  let userDataDir;
  if (useInjectedProfile) {
    tempDir = tempProfileDir();
    userDataDir = tempDir;
    log('info', 'Using isolated profile for cookie injection', { tempDir });
  } else {
    userDataDir = sharedProfileDir();
    log('info', 'Using shared persistent profile');
  }

  const context = await launchPersistentContext(buildLaunchOpts(userDataDir));
  log('info', 'CloakBrowser launched', {
    headless: true,
    humanize: true,
  });

  // Cleanup on forced kill
  const cleanup = async () => {
    try { await context.close(); } catch {}
    if (tempDir) try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  };
  process.on('SIGTERM', () => cleanup().then(() => process.exit(1)));
  process.on('SIGINT', () => cleanup().then(() => process.exit(1)));

  try {
    const page = context.pages()[0] || await context.newPage();

    // ── Phase 2: Cookie injection (if --profile) ─────────────────────
    if (useInjectedProfile) {
      progress(2, 6, `Authenticating — ${profile}`);
      try {
        const authResult = await loadAndInjectChatgptCookies(context, {
          profileEmail: profile,
          log: (msg) => log('info', msg),
        });
        log('info', 'Cookie auth complete', authResult);
      } catch (e) {
        fail(e.code || 'auth_failed', e.message);
        return;
      }
    } else {
      progress(2, 6, 'Using existing session');
    }

    // ── Phase 3: Navigate ────────────────────────────────────────────
    progress(3, 6, conversationId ? 'Loading conversation' : 'Loading ChatGPT');
    const targetUrl = conversationId
      ? `https://chatgpt.com/c/${encodeURIComponent(conversationId)}`
      : 'https://chatgpt.com/';
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await sleep(2000); // human-like dwell

    if (conversationId) {
      const convoReady = await waitForConversationReady(page, conversationId, 30_000);
      log('info', 'Conversation page state', convoReady);
      if (!convoReady.loggedIn) {
        fail('login_required',
          useInjectedProfile
            ? `Login failed for profile "${profile}". Session cookie may be expired.`
            : 'ChatGPT login required. Use --profile <email> or authenticate the shared ~/.surf/cloak-profile session.'
        );
        return;
      }
      if (!convoReady.ready) {
        const code = convoReady.currentUrl.includes(`/c/${conversationId}`)
          ? 'conversation_load_timeout'
          : 'conversation_not_found';
        fail(code, `Failed to load conversation ${conversationId}`);
        return;
      }
    } else {
      const { ready, loggedIn } = await waitForReady(page, 30_000);
      log('info', 'Page state', { ready, loggedIn });

      if (!ready) {
        fail('ui_timeout', 'ChatGPT page did not become ready within 30s');
        return;
      }
      if (!loggedIn) {
        fail('login_required',
          useInjectedProfile
            ? `Login failed for profile "${profile}". Session cookie may be expired.`
            : 'ChatGPT login required. Use --profile <email> or authenticate the shared ~/.surf/cloak-profile session.'
        );
        return;
      }
    }

    // ── Inject SSE stream capture (must be before any send) ──────────
    await injectFetchStreamCapture(page);
    log('info', 'SSE stream capture injected');

    // ── Phase 4: Model selection ─────────────────────────────────────
    if (resolved.tid) {
      progress(4, 6, `Selecting model — ${resolved.mode}`);
      try {
        const dropdown = page.locator('[data-testid="model-switcher-dropdown-button"]').first();
        await dropdown.click({ timeout: 5_000 });
        await sleep(600);
        const modelBtn = page.locator(`[data-testid="${resolved.tid}"]`).first();
        await modelBtn.click({ timeout: 5_000 });
        await sleep(400);
        log('info', 'Model selected', { mode: resolved.mode, tid: resolved.tid });
      } catch (e) {
        log('warn', 'Model selection failed (continuing with default)', { error: e.message });
      }
    } else {
      progress(4, 6, 'Using default model');
    }

    // ── Phase 5: File upload + send prompt ───────────────────────────
    progress(5, 6, file ? `Uploading ${file.split('/').pop()} + sending prompt` : 'Sending prompt');

    // File upload
    if (file && existsSync(file)) {
      try {
        // Click the attach button first to reveal file input
        const attachBtn = page.locator('button[aria-label*="Attach"], button[data-testid="composer-attach-button"]').first();
        const hasAttach = await attachBtn.count() > 0;
        if (hasAttach) {
          await attachBtn.click({ timeout: 5_000 });
          await sleep(500);
        }

        // Find and use file input
        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.setInputFiles(file);
        await sleep(3_000); // wait for upload
        log('info', 'File attached', { file });
      } catch (e) {
        log('warn', 'File upload failed', { error: e.message });
      }
    }

    // Prompt entry — try each selector until one matches
    let textarea = null;
    let promptSelector = PROMPT_SELECTORS_CSS;
    for (const sel of PROMPT_SELECTOR_LIST) {
      const loc = page.locator(sel).first();
      const count = await loc.count().catch(() => 0);
      if (count > 0) {
        textarea = loc;
        promptSelector = sel;
        log('info', `Composer found: ${sel}`);
        break;
      }
    }
    if (!textarea) {
      fail('composer_not_found', 'No editable ChatGPT composer found', { triedSelectors: PROMPT_SELECTOR_LIST });
      return;
    }
    await textarea.click({ timeout: 10_000 });
    await sleep(500);
    for (const sel of PROMPT_SELECTOR_LIST) {
      const loc = page.locator(sel).first();
      const count = await loc.count().catch(() => 0);
      if (count > 0) {
        textarea = loc;
        promptSelector = sel;
        log('info', `Composer active: ${sel}`);
        break;
      }
    }

    // Prepare prompt (prefix for image generation)
    let finalPrompt = prompt;
    if (generateImage && !prompt.toLowerCase().startsWith('generate')) {
      finalPrompt = `Generate an image: ${prompt}`;
    }

    // Token estimation: ~4 chars/token for English text
    const promptBytes = Buffer.byteLength(finalPrompt, 'utf-8');
    const promptKB = (promptBytes / 1024).toFixed(1);
    const promptLines = finalPrompt.split('\n').length;
    const estimatedTokens = Math.ceil(finalPrompt.length / 4);
    const tokenKStr = (estimatedTokens / 1000).toFixed(1) + 'K';
    log('info', `Prompt: ${promptKB}KB, ${promptLines} lines, ~${tokenKStr} tokens`);
    if (estimatedTokens > 120_000) {
      log('warn', `⚠ Prompt ~${tokenKStr} tokens — approaching GPT Pro 150K limit`);
    }

    const promptEntry = await enterPromptWithVerification({
      page,
      textarea,
      prompt: finalPrompt,
      log,
      sleep,
      promptSelector,
      sendButtonSelectors: SEND_BUTTON_SELECTORS,
    });
    log('info', 'Prompt entry metrics', promptEntry);
    await sleep(300);

    let baselineUserNodeId = null;
    if (conversationId) {
      const baselineUser = await captureBaselineUserNodeId(page, conversationId);
      if (baselineUser?.ok) {
        baselineUserNodeId = baselineUser.baselineUserNodeId || null;
        log('info', 'Baseline user captured', { conversationId, baselineUserNodeId });
      } else {
        log('warn', 'Baseline user capture failed', baselineUser);
      }
    }

    // Capture baseline before send (detect stale assistant turns)
    // Use data-message-id (backend message UUID) not data-testid (DOM turn id)
    const baseline = await page.evaluate(EXTRACT_TEXT_JS);
    const baselineText = sanitize(baseline.text || '');
    const baselineTurnId = baseline.turnId || null; // For DOM change detection
    const baselineMessageId = baseline.messageId || null; // For reconcile API comparison
    log('info', 'Baseline captured', { turnId: baselineTurnId, messageId: baselineMessageId });

    // Send — prefer click when enabled, otherwise press Enter directly.
    let sendTriggered = false;
    if (promptEntry.sendEnabled) {
      for (const sel of SEND_BUTTON_SELECTORS) {
        try {
          const btn = page.locator(sel).first();
          await btn.click({ timeout: 5_000 });
          sendTriggered = true;
          log('info', `Send button clicked: ${sel}`);
          break;
        } catch {
          log('info', `Send selector miss: ${sel}`);
        }
      }
    }
    if (!sendTriggered) {
      log(
        promptEntry.sendButtonFound ? 'warn' : 'info',
        promptEntry.sendButtonFound
          ? 'Send button not usable after inline insert — pressing Enter'
          : 'No send button found — pressing Enter'
      );
      await textarea.press('Enter');
    }

    const sentAt = new Date().toISOString();
    emit({
      type: 'meta_update',
      source: 'post_send',
      lastCheckpoint: 'sent',
      sentAt,
      conversationId: conversationId || null,
      baselineAssistantMessageId: baselineMessageId || null,
      t: Date.now(),
    });

    const conversationIdBeforeResolve = conversationId || null;
    conversationId = await resolveConversationIdForValidation(page, conversationId, 30_000);
    if ((conversationId || null) !== conversationIdBeforeResolve) {
      emit({
        type: 'meta_update',
        source: 'conversation_resolved',
        lastCheckpoint: 'sent',
        sentAt,
        conversationId: conversationId || null,
        baselineAssistantMessageId: baselineMessageId || null,
        t: Date.now(),
      });
    }

    if (!conversationId) {
      fail(
        'prompt_sent_validation_failed',
        'Prompt send validation failed: conversationId did not resolve after send',
        { failureReason: 'conversation_id_unresolved' },
      );
      return;
    }

    const sentPromptValidation = await waitForPromptPersistenceValidation({
      page,
      conversationId,
      expectedPrompt: finalPrompt,
      baselineUserNodeId,
      timeoutMs: 30_000,
      pollMs: 1_000,
    });
    const validationSummary = summarizePromptValidation(sentPromptValidation);
    log('info', 'Sent prompt validation', validationSummary);
    if (!sentPromptValidation.ok) {
      const failureReason = sentPromptValidation.failureReason || sentPromptValidation.code || 'prompt_sent_validation_failed';
      fail(
        failureReason === 'file_map_placeholder' ? 'prompt_materialized_as_file_map' : 'prompt_sent_validation_failed',
        failureReason === 'file_map_placeholder'
          ? 'Prompt sent incorrectly: latest user message became <file_map> instead of inline prompt'
          : failureReason === 'big_paste_attachment'
            ? 'Prompt sent incorrectly: latest user message materialized as big-paste attachment'
            : `Prompt sent incorrectly: ${validationSummary.actualChars || 0}/${validationSummary.expectedChars || 0} chars persisted`,
        validationSummary,
      );
      return;
    }

    // ── Phase 6: Wait for response (hybrid stream + DOM) ────────────
    progress(6, 6, 'Waiting for response');

    const timeoutSec = resolveQueryTimeoutSeconds(timeout);
    const timeoutMs = timeoutSec * 1000;
    const keepaliveIntervalMs = resolveKeepaliveIntervalMs(timeoutSec);
    let deadline = Date.now() + timeoutMs;
    let responseText = '';
    let sawActivity = false;
    let capturedModel = null;
    let stableCycles = 0;
    let lastChangeAtMs = Date.now();
    let lastText = '';
    let lastPhase = '';
    let imagePath = null;
    let responseTurnId = null;
    let liveThinkingTrace = null;
    let lastThinkingText = '';
    let lastStreamText = '';
    let lastStreamChangeAtMs = Date.now();
    let lastKeepaliveAtMs = 0;
    let timedOut = false;

    const noteActivity = (reason) => {
      const now = Date.now();
      deadline = now + timeoutMs;
      if ((now - lastKeepaliveAtMs) >= keepaliveIntervalMs) {
        emit({ type: 'keepalive', reason, phase: lastPhase || 'Waiting for response' });
        lastKeepaliveAtMs = now;
      }
    };

    while (true) {
      if (Date.now() >= deadline) {
        timedOut = true;
        break;
      }
      await sleep(500);

      // 1. Detect phase
      const phaseResult = await page.evaluate(DETECT_PHASE_JS);
      const phase = (phaseResult && phaseResult.phase) || '';
      const previousPhase = lastPhase;
      if (phase && phase !== lastPhase) {
        log('info', `⏳ ${phase}`);
        emit({ type: 'trace', phase, isThinking: !!(phaseResult && phaseResult.isThinking) });
        lastPhase = phase;
      }

      // 2. DOM snapshot (structured)
      const dom = await page.evaluate(EXTRACT_TEXT_JS);
      const sanitizedDom = sanitize(dom.text || '');

      // 3. Stream snapshot
      const stream = await readStreamResponse(page);
      if (stream.model) capturedModel = stream.model;

      // 4. Streaming state
      const isStreaming = await page.evaluate(IS_ACTIVE_STOP_BUTTON_JS);

      // 5. Arbitrate best text
      const currentText = chooseBestText({
        streamText: stream.text || '',
        domText: sanitizedDom,
        streamDone: !!stream.done,
        domFinished: !!dom.finished,
      });

      // Track activity — only if we see a NEW turn (not baseline stale content)
      const observedTurnId = dom.turnId || null;
      const isNewTurn = observedTurnId && observedTurnId !== baselineTurnId;
      const previousTurnId = responseTurnId;
      if (isNewTurn) responseTurnId = observedTurnId;
      const isThinkingPhase = !!(phaseResult && phaseResult.isThinking);
      const fullThinkingText = isThinkingPhase ? (phaseResult.thinkingText || '').trim() : '';
      const activity = detectResponseActivity({
        phase,
        previousPhase,
        turnId: responseTurnId || null,
        previousTurnId: previousTurnId || null,
        observedTurnId,
        baselineTurnId,
        currentText,
        previousText: lastText,
        baselineText,
        streamText: stream.text || '',
        previousStreamText: lastStreamText,
        thinkingText: fullThinkingText,
        previousThinkingText: lastThinkingText,
        trustedActivitySeen: sawActivity,
      });
      if (activity.active) {
        sawActivity = true;
        noteActivity(activity.reasons[0] || 'response');
      }
      const streamText = stream.text || '';
      if (streamText !== lastStreamText) {
        lastStreamText = streamText;
        lastStreamChangeAtMs = Date.now();
      }
      const isBaselineTurn = !!(baselineTurnId && observedTurnId && observedTurnId === baselineTurnId);
      const isBaselineResponseSnapshot = !!(
        isBaselineTurn &&
        baselineText &&
        currentText === baselineText &&
        !streamText
      );
      if (!sawActivity) continue;

      // Detect conversationId from URL for new conversations (URL becomes /c/{id} once activity starts)
      if (!conversationId) {
        try {
          const detectedConversationId = extractConversationIdFromUrl(page.url());
          if (detectedConversationId) {
            conversationId = detectedConversationId;
            emit({ type: 'meta_update', conversationId, source: 'url', t: Date.now() });
          }
        } catch {}
      }

      // 5b. Live thinking trace — emit DOM thinking text as deltas
      if (isThinkingPhase) {
        // DOM-based delta emission (timer line already stripped in DETECT_PHASE_JS)
        const fullText = fullThinkingText;
        if (fullText && fullText !== lastThinkingText) {
          let delta;
          if (lastThinkingText && fullText.startsWith(lastThinkingText)) {
            delta = fullText.slice(lastThinkingText.length).replace(/^\n+/, '');
          } else {
            delta = fullText;
          }
          // Cap emitted delta to 4k to avoid flooding CLI; source state is uncapped
          if (delta.trim()) {
            emit({
              type: 'trace',
              traceType: 'thinking_text',
              phase: phase || 'Thinking',
              isThinking: true,
              thoughtText: fullText.slice(0, 8000),
              thoughtDelta: delta.slice(0, 4000),
            });
          }
          lastThinkingText = fullText;
        }
        // Fiber extraction (independent of DOM text — may populate later in thinking)
        try {
          const nextTrace = await extractThinkingTrace(page, responseTurnId || null);
          if (nextTrace) liveThinkingTrace = nextTrace;
        } catch {}
      }

      // 6. Completion: stream.done with stream text = authoritative
      if (stream.done && stream.text && stream.text.length > 0) {
        responseText = currentText || sanitizedDom || stream.text;
        break;
      }

      // 7. DOM stability fallback (requiredStableCycles=4, minStableMs=2500)
      // While model is still in thinking phase (stop button visible + thinking label),
      // treat as streaming to prevent premature completion on thinking-phase text.
      // (isThinkingPhase already computed in step 5b above)
      const stability = advanceTextStability({
        text: currentText,
        previousText: lastText,
        isStreaming: isStreaming || isThinkingPhase,
        finished: !!dom.finished && !isThinkingPhase,
        stableCycles,
        lastChangeAtMs,
        nowMs: Date.now(),
        requiredStableCycles: 4,
        minStableMs: 2500,
      });
      stableCycles = stability.stableCycles;
      lastChangeAtMs = stability.lastChangeAtMs;
      lastText = currentText;

      if (stability.shouldComplete && currentText.length > 0 && !isBaselineResponseSnapshot) {
        responseText = currentText;
        break;
      }

      const nowMs = Date.now();
      const phaseLooksFinalizing = /^Finalizing\b/i.test(phase || '');
      const textStableMs = nowMs - lastChangeAtMs;
      const streamStableMs = nowMs - lastStreamChangeAtMs;
      if (
        currentText.length > 0 &&
        sawActivity &&
        phaseLooksFinalizing &&
        textStableMs >= 20000 &&
        streamStableMs >= 20000 &&
        !isBaselineResponseSnapshot
      ) {
        log('warn', 'Completing response after finalizing-phase stability fallback', {
          textStableMs,
          streamStableMs,
          phase,
        });
        responseText = currentText;
        break;
      }

      if (currentText && !isBaselineResponseSnapshot) responseText = currentText;
    }

    // Thinking trace extraction (post-response, from React fiber state)
    // Fall back to live-captured trace if final extraction fails
    let thinkingTrace = liveThinkingTrace;
    try {
      const finalTrace = await extractThinkingTrace(page, responseTurnId);
      if (finalTrace) {
        thinkingTrace = finalTrace;
        log('info', 'Thinking trace captured', {
          thoughtCount: finalTrace.thoughts?.length || 0,
          durationSec: finalTrace.durationSec,
          recapText: finalTrace.recapText,
          _debugContentTypes: finalTrace._debugContentTypes,
        });
      } else if (liveThinkingTrace) {
        log('info', 'Using live-captured thinking trace (final extraction empty)', {
          thoughtCount: liveThinkingTrace.thoughts?.length || 0,
        });
      }
    } catch (e) {
      log('warn', 'Thinking trace extraction error', { error: e.message });
    }

    // Image detection
    if (generateImage && responseText) {
      try {
        imagePath = await detectAndSaveImage(page, generateImage);
      } catch (e) {
        log('warn', 'Image detection/save failed', { error: e.message });
      }
    }

    const durationMs = Date.now() - t0;

    if (!responseText) {
      fail('no_response', 'No response text captured within timeout');
      return;
    }

    success({
      response: responseText,
      model: capturedModel || model || resolved.mode,
      tookMs: durationMs,
      imagePath,
      partial: timedOut,
      backend: 'cloak',
      conversationId: conversationId || null,
      thinkingTrace: thinkingTrace || undefined,
    });

  } catch (e) {
    log('error', 'Query failed', { error: e.message, stack: e.stack, code: e.code });
    fail(e.code || 'query_failed', e.message, e.details);
  } finally {
    await context.close();
    if (tempDir) {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  }
}

// ============================================================================
// Stdin protocol — read one query, run it, exit.

async function main() {
  log('info', 'CloakBrowser worker started');

  let buffer = '';
  let resolved = false;

  const queryPromise = new Promise((resolve) => {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'query' && !resolved) {
            resolved = true;
            resolve(msg);
          }
        } catch {
          fail('protocol', 'Invalid JSON');
        }
      }
    });
    process.stdin.on('end', () => {
      if (!resolved) resolve(null);
    });
  });

  const msg = await queryPromise;
  if (msg) {
    await runQuery(msg).catch(e => fail('unhandled', e.message, e.details));
  } else {
    fail('no_query', 'Stdin closed without receiving a query');
  }

  process.exit(0);
}

main().catch(e => {
  fail('fatal', e.message, e.details);
  process.exit(1);
});

```

File: /Users/danielsivan/dev/surf-cli/native/session-store.cjs
```cjs
/**
 * surf-cli session store — inspired by steipete/oracle
 *
 * Layout:
 *   ~/.surf/sessions/<tool>-<slug>_<YYYYMMDD-HHMMSS>/
 *     meta.json   – tool, args, status, timestamps, result, error
 *     output.log  – chronological step-by-step log (stderr progress + final)
 *
 * Public API:
 *   createSession(tool, args, env)  → Session
 *   session.step(msg)
 *   session.finish(result)
 *   session.fail(err)
 *   listSessions({ hours, all, limit })
 *   loadSession(idOrPrefix)
 *   appendSessionLog(id, message)
 *   deleteSessions({ hours, all })
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");

// ============================================================================
// Constants
// ============================================================================

const VERSION = (() => {
  try { return require("../package.json").version; } catch { return "unknown"; }
})();

// Read lazily so SURF_SESSIONS_DIR overrides work in tests without module reloading
const getSessionsDir = () =>
  process.env.SURF_SESSIONS_DIR || path.join(os.homedir(), ".surf", "sessions");



const DEFAULT_TTL_HOURS = 72;
const MAX_SESSIONS      = 500;
const RESPONSE_ARTIFACT_NAME = "response.md";
const INLINE_RESPONSE_FIELD = "inlineResponse";
const INLINE_RESPONSE_TRUNCATED_FIELD = "inlineResponseTruncated";
const INLINE_RESPONSE_CHARS_FIELD = "inlineResponseChars";

// ============================================================================
// Slug helpers (Oracle-style: prompt words → kebab)
// ============================================================================

function slugify(text, maxWords = 5) {
  if (!text) return "run";
  const words = String(text).toLowerCase().match(/[a-z0-9]+/g) || [];
  return words.slice(0, maxWords).join("-") || "run";
}

function makeSessionId(tool, args) {
  // Derive slug from prompt/query or first meaningful arg
  const promptSource =
    args.query || args.prompt || args.url ||
    (Array.isArray(args._) ? args._.join(" ") : "") || tool;
  const slug = slugify(promptSource, 5);
  // ms precision + pid suffix to prevent collisions on same-second concurrent runs
  const now  = new Date();
  const ts   = now.toISOString()
    .replace(/T/, "_").replace(/:/g, "").replace(/\.(\d{3}).+/, ".$1");  // YYYYMMDD_HHmmss.mmm
  const pid  = (process.pid % 9999).toString().padStart(4, "0");
  return `${tool}-${slug}_${ts}_${pid}`;
}

// ============================================================================
// Arg sanitiser — strip secrets before writing to disk
// ============================================================================

const REDACT_KEYS = new Set(["password", "token", "secret", "key", "auth"]);

function sanitizeArgs(args) {
  if (!args || typeof args !== "object") return args;
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    if (REDACT_KEYS.has(k.toLowerCase())) {
      out[k] = "[redacted]";
    } else if (k === "query" || k === "prompt") {
      // Truncate long prompts in meta (full text is in output.log)
      out[k] = String(v).slice(0, 200) + (String(v).length > 200 ? "…" : "");
    } else {
      out[k] = v;
    }
  }
  return out;
}

function persistResponseArtifact(dir, response, filename = RESPONSE_ARTIFACT_NAME) {
  if (!dir || typeof response !== "string" || response.length === 0) return null;
  const responsePath = path.join(dir, filename);
  try {
    fs.writeFileSync(responsePath, response, { mode: 0o600 });
    return {
      responsePath,
      responseChars: response.length,
    };
  } catch {
    return null;
  }
}

function applyResponsePersistenceResult(result, response, responseArtifact) {
  const nextResult = result && typeof result === "object" ? result : {};
  delete nextResult[INLINE_RESPONSE_FIELD];
  delete nextResult[INLINE_RESPONSE_TRUNCATED_FIELD];
  delete nextResult[INLINE_RESPONSE_CHARS_FIELD];
  if (responseArtifact) {
    Object.assign(nextResult, responseArtifact);
    return nextResult;
  }
  if (typeof response === "string" && response.length > 0) {
    nextResult[INLINE_RESPONSE_FIELD] = response;
    nextResult[INLINE_RESPONSE_TRUNCATED_FIELD] = false;
    nextResult[INLINE_RESPONSE_CHARS_FIELD] = response.length;
  }
  return nextResult;
}

// ============================================================================
// Session class
// ============================================================================

class Session {
  constructor(id, dir, meta) {
    this.id  = id;
    this.dir = dir;
    this._meta = meta;
    this._logPath = path.join(dir, "output.log");
  }

  get logPath() { return this._logPath; }

  // Merge a partial patch into meta (e.g. conversationId, baselineAssistantMessageId)
  update(patch = {}) {
    if (patch && typeof patch === "object") {
      Object.assign(this._meta, patch);
    }
    this._writeMeta();
  }

  // Append a line to output.log (structured for replay)
  step(msg) {
    const line = `${msg}\n`;
    try { fs.appendFileSync(this._logPath, line); } catch {}
  }

  // Mark completed
  finish(result = {}) {
    const now = Date.now();
    this._meta.status      = "completed";
    this._meta.completedAt = new Date().toISOString();
    this._meta.elapsedMs   = now - this._meta._startMs;
    delete this._meta._startMs;

    const nextResult = { ...(this._meta.result || {}), ok: true };
    if (result.model) nextResult.model = result.model;
    if (result.tookMs) this._meta.elapsedMs = result.tookMs;
    if (result.imagePath) nextResult.imagePath = result.imagePath;
    if (result.responsePreview) nextResult.responsePreview = String(result.responsePreview).slice(0, 160);
    const responseArtifact = persistResponseArtifact(this.dir, result.response);
    this._meta.result = applyResponsePersistenceResult(nextResult, result.response, responseArtifact);

    this._writeMeta();
    if (responseArtifact?.responsePath) this.step(`[session] response saved: ${responseArtifact.responsePath}`);
    this.step(`[session] ✓ completed in ${(this._meta.elapsedMs/1000).toFixed(1)}s`);
  }

  // Mark failed
  fail(err) {
    const now = Date.now();
    this._meta.status      = "error";
    this._meta.completedAt = new Date().toISOString();
    this._meta.elapsedMs   = now - (this._meta._startMs || now);
    delete this._meta._startMs;
    this._meta.error = {
      message: err?.message || String(err),
      code:    err?.code    || undefined,
    };
    this._writeMeta();
    this.step(`[session] ✗ error: ${err?.message || err}`);
  }

  _writeMeta() {
    try {
      const metaPath = path.join(this.dir, "meta.json");
      fs.writeFileSync(metaPath, JSON.stringify(this._meta, null, 2), { mode: 0o600 });
    } catch {}
  }
}

// ============================================================================
// createSession
// ============================================================================

function createSession(tool, args = {}, env = {}) {
  const sessionsDir = getSessionsDir();
  try {
    fs.mkdirSync(sessionsDir, { recursive: true, mode: 0o700 });
  } catch {}

  const id  = makeSessionId(tool, args);
  const dir = path.join(sessionsDir, id);
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch {}

  const meta = {
    id,
    version:   VERSION,
    tool,
    args:      sanitizeArgs(args),
    status:    "running",
    createdAt: new Date().toISOString(),
    _startMs:  Date.now(),
    pid:       process.pid,
    conversationId:             args.conversationId || null,
    baselineAssistantMessageId: null,
    lastCheckpoint:             "created",
    sentAt:                     null,
    reconcile:                  null,
  };

  const session = new Session(id, dir, meta);
  session._writeMeta();

  // Write header to output.log
  const cmdPreview = [
    `surf ${tool}`,
    args.query ? `"${String(args.query).slice(0, 80)}"` : "",
    args.file  ? `--file ${args.file}` : "",
    args.model ? `--model ${args.model}` : "",
  ].filter(Boolean).join(" ");

  session.step(`[session] ${new Date().toISOString()}`);
  session.step(`[session] ${cmdPreview}`);
  session.step(`[session] id: ${id}`);
  session.step("");

  return session;
}

// ============================================================================
// listSessions
// ============================================================================

function listSessions({ hours = DEFAULT_TTL_HOURS, all = false, limit = 50 } = {}) {
  try { fs.mkdirSync(getSessionsDir(), { recursive: true }); } catch {}

  let entries;
  try {
    entries = fs.readdirSync(getSessionsDir());
  } catch {
    return [];
  }

  const cutoff = all ? 0 : Date.now() - hours * 3600 * 1000;

  const sessions = [];
  for (const name of entries) {
    const metaPath = path.join(getSessionsDir(), name, "meta.json");
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      const ts   = new Date(meta.createdAt).getTime();
      if (!all && ts < cutoff) continue;
      sessions.push(meta);
    } catch {}
  }

  // Sort newest first
  sessions.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return sessions.slice(0, limit);
}

// ============================================================================
// loadSession
// ============================================================================

function loadSession(idOrPrefix) {
  try { fs.mkdirSync(getSessionsDir(), { recursive: true }); } catch {}

  // Exact match first
  const exactDir = path.join(getSessionsDir(), idOrPrefix);
  if (fs.existsSync(exactDir)) {
    const metaPath = path.join(exactDir, "meta.json");
    const logPath  = path.join(exactDir, "output.log");
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      const responseInfo = resolveSessionResponse(meta, exactDir);
      return {
        meta,
        log:  fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "",
        ...responseInfo,
      };
    } catch {}
  }

  // Prefix search
  let entries;
  try { entries = fs.readdirSync(getSessionsDir()); } catch { return null; }

  const matches = entries.filter(e => e.startsWith(idOrPrefix));
  if (matches.length === 0) return null;

  // Sort by createdAt descending (parse each meta.json, fall back to dir name sort)
  const candidates = [];
  for (const name of matches) {
    const mp = path.join(getSessionsDir(), name, "meta.json");
    try {
      const m = JSON.parse(fs.readFileSync(mp, "utf8"));
      candidates.push({ name, createdAt: m.createdAt || "" });
    } catch {
      candidates.push({ name, createdAt: "" });
    }
  }
  candidates.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));

  const dir      = path.join(getSessionsDir(), candidates[0].name);
  const metaPath = path.join(dir, "meta.json");
  const logPath  = path.join(dir, "output.log");
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    const responseInfo = resolveSessionResponse(meta, dir);
    return {
      meta,
      log:  fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "",
      ...responseInfo,
    };
  } catch { return null; }
}

// ============================================================================
// deleteSessions
// ============================================================================

function deleteSessions({ hours, all = false } = {}) {
  let entries;
  try { entries = fs.readdirSync(getSessionsDir()); } catch { return { deleted: 0, remaining: 0 }; }

  // Validate hours: must be a finite positive number; reject NaN/0/negative.
  // If hours is provided but invalid, refuse to run — do NOT silently delete-all.
  const validHours = (typeof hours === "number" && Number.isFinite(hours) && hours > 0) ? hours : null;
  if (hours !== undefined && hours !== null && validHours === null) {
    throw new Error(`deleteSessions: invalid hours value (${hours}) — must be a positive number`);
  }
  const cutoff = all
    ? Infinity
    : validHours !== null
      ? Date.now() - validHours * 3600 * 1000
      : Infinity;  // no hours + no all — treat as delete-all (explicit opt-in path)

  let deleted = 0;
  for (const name of entries) {
    const dir      = path.join(getSessionsDir(), name);
    const metaPath = path.join(dir, "meta.json");
    try {
      if (all) {
        fs.rmSync(dir, { recursive: true, force: true });
        deleted++;
      } else {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
        if (new Date(meta.createdAt).getTime() < cutoff) {
          fs.rmSync(dir, { recursive: true, force: true });
          deleted++;
        }
      }
    } catch {}
  }

  let remaining = 0;
  try { remaining = fs.readdirSync(getSessionsDir()).length; } catch {}
  return { deleted, remaining };
}

// ============================================================================
// Exports
// ============================================================================

// ============================================================================
// updateSession — patch meta.json for an existing session by id
// ============================================================================

function updateSession(id, patch = {}) {
  const dir      = path.join(getSessionsDir(), id);
  const metaPath = path.join(dir, "meta.json");
  try {
    const meta    = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    const updated = Object.assign({}, meta, patch);
    fs.writeFileSync(metaPath, JSON.stringify(updated, null, 2), { mode: 0o600 });
    return updated;
  } catch {
    return null;
  }
}

function appendSessionLog(id, message) {
  if (!id) return false;
  const dir = path.join(getSessionsDir(), id);
  const logPath = path.join(dir, "output.log");
  try {
    fs.appendFileSync(logPath, `${String(message ?? "")}\n`);
    return true;
  } catch {
    return false;
  }
}

function persistSessionResponse(id, response, filename = RESPONSE_ARTIFACT_NAME) {
  if (!id) return null;
  const dir = path.join(getSessionsDir(), id);
  return persistResponseArtifact(dir, response, filename);
}

function resolveSessionResponse(meta, dir) {
  const result = (meta && typeof meta === "object" && meta.result && typeof meta.result === "object") ? meta.result : {};
  const configuredResponsePath = typeof result.responsePath === "string" && result.responsePath.trim() ? result.responsePath : null;
  const artifactCandidates = configuredResponsePath
    ? [configuredResponsePath, path.join(dir, RESPONSE_ARTIFACT_NAME)]
    : [path.join(dir, RESPONSE_ARTIFACT_NAME)];

  for (const candidate of artifactCandidates) {
    if (!candidate) continue;
    try {
      if (!fs.existsSync(candidate)) continue;
      const response = fs.readFileSync(candidate, "utf8");
      return { response, responseSource: "artifact", responsePath: candidate };
    } catch {
      // fall through to legacy field
    }
  }

  if (typeof result[INLINE_RESPONSE_FIELD] === "string" && result[INLINE_RESPONSE_FIELD].length > 0) {
    return { response: result[INLINE_RESPONSE_FIELD], responseSource: "inline_response", responsePath: configuredResponsePath };
  }

  if (typeof result.recoveredResponse === "string" && result.recoveredResponse.length > 0) {
    return { response: result.recoveredResponse, responseSource: "legacy_recoveredResponse", responsePath: configuredResponsePath };
  }

  return { response: null, responseSource: null, responsePath: configuredResponsePath };
}

// ============================================================================
// Exports
// ============================================================================

const exports_ = {
  createSession,
  listSessions,
  loadSession,
  deleteSessions,
  updateSession,
  appendSessionLog,
  persistSessionResponse,
};
// Dynamic getter so SURF_SESSIONS_DIR env changes are reflected immediately
Object.defineProperty(exports_, "SESSIONS_DIR", {
  get: getSessionsDir,
  enumerable: true,
});
module.exports = exports_;

```

File: /Users/danielsivan/dev/surf-cli/test/unit/chatgpt-bun-bridge.test.ts
```ts
import { describe, expect, it } from "vitest";

const bridge = require("../../native/chatgpt-bun-bridge.cjs");

describe("chatgpt-bun-bridge", () => {
  describe("isBunChatGPTEligible", () => {
    it("returns ineligible for --with-page", () => {
      const result = bridge.isBunChatGPTEligible({ "with-page": true });
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe("with_page");
    });

    it("returns ineligible for withPage", () => {
      const result = bridge.isBunChatGPTEligible({ withPage: true });
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe("with_page");
    });

    it("returns eligible for basic query", () => {
      const result = bridge.isBunChatGPTEligible({ query: "test" });
      if (result.eligible) {
        expect(result.eligible).toBe(true);
      } else {
        // Bun not installed — still valid
        expect(result.reason).toBe("bun_not_found");
      }
    });
  });

  describe("buildWorkerRequest", () => {
    it("maps CLI args to worker request shape", () => {
      const req = bridge.buildWorkerRequest({
        query: "explain quantum computing",
        model: "gpt-4o",
        file: "/tmp/data.csv",
        "generate-image": "/tmp/out.png",
        timeout: 120,
        profile: "user@gmail.com",
      });

      expect(req.prompt).toBe("explain quantum computing");
      expect(req.model).toBe("gpt-4o");
      expect(req.file).toBe("/tmp/data.csv");
      expect(req.generateImage).toBe("/tmp/out.png");
      expect(req.timeoutMs).toBe(120000);
      expect(req.profileEmail).toBe("user@gmail.com");
    });

    it("handles minimal args", () => {
      const req = bridge.buildWorkerRequest({ query: "hello" });
      expect(req.prompt).toBe("hello");
      expect(req.file).toBeNull();
      expect(req.generateImage).toBeNull();
      expect(req.timeoutMs).toBe(300000);
      expect(req.profileEmail).toBeNull();
    });

    it("converts --timeout seconds to milliseconds", () => {
      const req = bridge.buildWorkerRequest({ query: "q", timeout: 60 });
      expect(req.timeoutMs).toBe(60000);
    });

    it("converts --timeout 300 (seconds) to 300000ms", () => {
      const req = bridge.buildWorkerRequest({ query: "q", timeout: 300 });
      expect(req.timeoutMs).toBe(300000);
    });

    it("always treats --timeout as seconds, even for large values", () => {
      const req = bridge.buildWorkerRequest({ query: "q", timeout: 10000 });
      expect(req.timeoutMs).toBe(10000 * 1000);
    });

    it("caps timeout at 86400s (24h)", () => {
      const req = bridge.buildWorkerRequest({ query: "q", timeout: 999999 });
      expect(req.timeoutMs).toBe(86400 * 1000);
    });

    it("uses default 300000ms when timeout is 0 or null", () => {
      expect(bridge.buildWorkerRequest({ query: "q", timeout: 0 }).timeoutMs).toBe(300000);
      expect(bridge.buildWorkerRequest({ query: "q", timeout: null }).timeoutMs).toBe(300000);
      expect(bridge.buildWorkerRequest({ query: "q" }).timeoutMs).toBe(300000);
    });
  });

  // Protocol edge cases
  describe("runChatGPTViaBun - protocol edge cases", () => {
    it("returns protocol error for empty stdout", async () => {
      const { execFileSync } = require("node:child_process");
      try {
        execFileSync("which", ["bun"], { encoding: "utf-8", timeout: 3000 });
      } catch {
        return; // Bun not installed — skip
      }

      const fs = require("node:fs");
      const path = require("node:path");
      const tmpWorker = path.join(require("node:os").tmpdir(), "surf-test-chatgpt-empty-worker.ts");
      fs.writeFileSync(tmpWorker, "// empty — no output\n");

      const { spawn } = require("node:child_process");
      const result = await new Promise((resolve) => {
        const bunPath = execFileSync("which", ["bun"], { encoding: "utf-8" }).trim();
        const child = spawn(bunPath, [tmpWorker], { stdio: ["pipe", "pipe", "pipe"] });
        child.stdin.write(JSON.stringify({ prompt: "test" }));
        child.stdin.end();
        let stdout = "";
        child.stdout.on("data", (d: any) => {
          stdout += d.toString();
        });
        child.on("close", (_code: number) => {
          const lines = stdout.trim().split("\n").filter(Boolean);
          const lastLine = lines[lines.length - 1] || "";
          if (!lastLine) {
            resolve({ ok: false, code: "protocol_error", empty: true });
          } else {
            try {
              resolve(JSON.parse(lastLine));
            } catch {
              resolve({ ok: false, code: "parse_error" });
            }
          }
        });
      });

      expect((result as any).ok).toBe(false);
      fs.unlinkSync(tmpWorker);
    });

    it("handles invalid JSON from worker stdout", async () => {
      const { execFileSync } = require("node:child_process");
      try {
        execFileSync("which", ["bun"], { encoding: "utf-8", timeout: 3000 });
      } catch {
        return; // Bun not installed — skip
      }

      const fs = require("node:fs");
      const path = require("node:path");
      const tmpWorker = path.join(
        require("node:os").tmpdir(),
        "surf-test-chatgpt-bad-json-worker.ts",
      );
      fs.writeFileSync(tmpWorker, 'process.stdout.write("NOT_JSON\\n");\n');

      const { spawn } = require("node:child_process");
      const result = await new Promise((resolve) => {
        const bunPath = execFileSync("which", ["bun"], { encoding: "utf-8" }).trim();
        const child = spawn(bunPath, [tmpWorker], { stdio: ["pipe", "pipe", "pipe"] });
        child.stdin.write(JSON.stringify({ prompt: "test" }));
        child.stdin.end();
        let stdout = "";
        child.stdout.on("data", (d: any) => {
          stdout += d.toString();
        });
        child.on("close", () => {
          const lines = stdout.trim().split("\n").filter(Boolean);
          const lastLine = lines[lines.length - 1] || "";
          try {
            resolve(JSON.parse(lastLine));
          } catch {
            resolve({ ok: false, code: "parse_error" });
          }
        });
      });

      expect((result as any).ok).toBe(false);
      expect((result as any).code).toBe("parse_error");
      fs.unlinkSync(tmpWorker);
    });
  });
});

```

File: /Users/danielsivan/dev/surf-cli/test/unit/chatgpt-cloak-bridge.test.ts
```ts
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

function createWorker() {
  const worker = new EventEmitter() as any;
  worker.stdout = new EventEmitter();
  worker.stderr = new EventEmitter();
  worker.stdout.setEncoding = vi.fn();
  worker.stderr.setEncoding = vi.fn();
  worker.stdin = { write: vi.fn() };
  worker.kill = vi.fn();
  return worker;
}

describe("chatgpt-cloak-bridge", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
  });

  it("maps query worker success payload", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.queryWithCloakBrowser({ query: "hello", timeout: 5 });

    expect(worker.stdin.write).toHaveBeenCalledWith(expect.stringContaining('"type":"query"'));

    worker.stdout.emit(
      "data",
      `${JSON.stringify({
        type: "success",
        response: "hi",
        model: "gpt-5.3",
        tookMs: 1234,
        backend: "cloak",
      })}\n`,
    );

    await expect(promise).resolves.toEqual({
      response: "hi",
      model: "gpt-5.3",
      tookMs: 1234,
      imagePath: null,
      partial: false,
      backend: "cloak",
      conversationId: null,
    });
    bridge.__resetBridgeRuntimeForTests();
  });

  it("uses 2700s default timeout for query workers", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.queryWithCloakBrowser({ query: "hello" });

    expect(worker.stdin.write).toHaveBeenCalledWith(expect.stringContaining('"timeout":2700'));

    worker.stdout.emit(
      "data",
      `${JSON.stringify({ type: "success", response: "hi", model: "gpt-5.4-pro", tookMs: 10, backend: "cloak" })}\n`,
    );

    await expect(promise).resolves.toMatchObject({ response: "hi", model: "gpt-5.4-pro" });
    bridge.__resetBridgeRuntimeForTests();
  });

  it("forwards progress and maps chats success payload", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });
    const progress = vi.fn();

    const promise = bridge.manageChatsWithCloakBrowser(
      { action: "list", limit: 2, timeout: 5 },
      progress,
    );

    worker.stdout.emit(
      "data",
      `${JSON.stringify({ type: "progress", step: 1, total: 4, message: "Loading" })}\n`,
    );
    worker.stdout.emit(
      "data",
      `${JSON.stringify({
        type: "success",
        action: "list",
        items: [{ id: "c1" }],
        total: 1,
        backend: "cloak",
      })}\n`,
    );

    await expect(promise).resolves.toEqual({
      action: "list",
      items: [{ id: "c1" }],
      total: 1,
      backend: "cloak",
    });
    expect(progress).toHaveBeenCalledWith({
      type: "progress",
      step: 1,
      total: 4,
      message: "Loading",
    });
    bridge.__resetBridgeRuntimeForTests();
  });

  it("propagates worker errors", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.manageChatsWithCloakBrowser({
      action: "get",
      conversationId: "bad",
      timeout: 5,
    });
    worker.stdout.emit(
      "data",
      `${JSON.stringify({
        type: "error",
        code: "conversation_not_found",
        message: "Missing",
        details: { status: 404 },
      })}\n`,
    );

    await expect(promise).rejects.toMatchObject({
      message: "Missing",
      code: "conversation_not_found",
      details: { status: 404 },
    });
    bridge.__resetBridgeRuntimeForTests();
  });

  it("does not retry chat get after clean worker_exit in headless-only mode", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.manageChatsWithCloakBrowser({
      action: "get",
      conversationId: "conv-err",
      timeout: 5,
    });

    worker.emit("close", 0, null);

    await expect(promise).rejects.toMatchObject({
      code: "worker_exit",
      exitCode: 0,
    });
    expect(spawn).toHaveBeenCalledTimes(1);

    bridge.__resetBridgeRuntimeForTests();
  });

  it("passes thinkingTrace through mapSuccess", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.queryWithCloakBrowser({ query: "think hard", timeout: 5 });

    const trace = {
      thoughts: [{ summary: "Analyzing", content: "Let me think..." }],
      durationSec: 12,
      recapText: "Thought for 12s",
      truncated: false,
    };
    worker.stdout.emit(
      "data",
      `${JSON.stringify({
        type: "success",
        response: "answer",
        model: "gpt-5-4-thinking",
        tookMs: 15000,
        backend: "cloak",
        thinkingTrace: trace,
      })}\n`,
    );

    await expect(promise).resolves.toEqual({
      response: "answer",
      model: "gpt-5-4-thinking",
      tookMs: 15000,
      imagePath: null,
      partial: false,
      backend: "cloak",
      conversationId: null,
      thinkingTrace: trace,
    });
    bridge.__resetBridgeRuntimeForTests();
  });

  it("omits thinkingTrace when not present", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.queryWithCloakBrowser({ query: "hello", timeout: 5 });

    worker.stdout.emit(
      "data",
      `${JSON.stringify({
        type: "success",
        response: "hi",
        model: "gpt-5.3",
        tookMs: 500,
        backend: "cloak",
      })}\n`,
    );

    const result = await promise;
    expect(result.thinkingTrace).toBeUndefined();
    expect("thinkingTrace" in result).toBe(false);
    bridge.__resetBridgeRuntimeForTests();
  });

  it("forwards rich thinking trace progress payload", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });
    const progress = vi.fn();

    const promise = bridge.queryWithCloakBrowser({ query: "think", timeout: 5 }, progress);

    worker.stdout.emit(
      "data",
      `${JSON.stringify({
        type: "trace",
        traceType: "thinking_text",
        phase: "Thinking",
        isThinking: true,
        thoughtText: "Plan\nFirst, inspect the inputs.",
        thoughtDelta: "Plan\nFirst, inspect the inputs.",
        thoughtCount: 1,
        durationSec: 4,
      })}\n`,
    );

    worker.stdout.emit(
      "data",
      JSON.stringify({ type: "success", response: "done", model: "gpt-5-4-pro", tookMs: 1000 }) +
        "\n",
    );

    await promise;

    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "trace",
        traceType: "thinking_text",
        phase: "Thinking",
        isThinking: true,
        thoughtText: "Plan\nFirst, inspect the inputs.",
        thoughtDelta: "Plan\nFirst, inspect the inputs.",
        thoughtCount: 1,
        durationSec: 4,
      }),
    );

    bridge.__resetBridgeRuntimeForTests();
  });

  it("forwards sent checkpoint metadata", async () => {
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });
    const progressSpy = vi.fn();

    const promise = bridge.queryWithCloakBrowser({ query: "hello", timeout: 5 }, progressSpy);
    const sentAt = "2026-04-05T12:34:56.000Z";

    worker.stdout.emit(
      "data",
      `${JSON.stringify({
        type: "meta_update",
        lastCheckpoint: "sent",
        sentAt,
        conversationId: "conv-123",
        baselineAssistantMessageId: "msg-456",
        source: "pre_phase_6",
      })}\n`,
    );
    worker.stdout.emit(
      "data",
      `${JSON.stringify({ type: "success", response: "done", model: "gpt-5.3", tookMs: 100 })}\n`,
    );

    await promise;

    expect(progressSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "meta_update",
        lastCheckpoint: "sent",
        sentAt,
        conversationId: "conv-123",
        baselineAssistantMessageId: "msg-456",
        source: "pre_phase_6",
      }),
    );

    bridge.__resetBridgeRuntimeForTests();
  });

  it("times out workers", async () => {
    vi.useFakeTimers();
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.manageChatsWithCloakBrowser({ action: "list", timeout: 1 });
    const rejection = expect(promise).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(1000);

    await rejection;
    expect(worker.kill).toHaveBeenCalledWith("SIGTERM");
    bridge.__resetBridgeRuntimeForTests();
  });

  it("resets the worker timer on keepalive activity", async () => {
    vi.useFakeTimers();
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.queryWithCloakBrowser({ query: "hello", timeout: 1 });

    await vi.advanceTimersByTimeAsync(900);
    worker.stdout.emit("data", `${JSON.stringify({ type: "keepalive", reason: "text" })}\n`);
    await vi.advanceTimersByTimeAsync(900);

    expect(worker.kill).not.toHaveBeenCalled();

    worker.stdout.emit(
      "data",
      `${JSON.stringify({ type: "success", response: "done", model: "gpt-5.4-pro", tookMs: 1500, backend: "cloak" })}\n`,
    );

    await expect(promise).resolves.toMatchObject({ response: "done", model: "gpt-5.4-pro" });
    bridge.__resetBridgeRuntimeForTests();
  });

  it("does not let log chatter extend the worker timer", async () => {
    vi.useFakeTimers();
    const worker = createWorker();
    const spawn = vi.fn().mockReturnValue(worker);
    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });

    const promise = bridge.queryWithCloakBrowser({ query: "hello", timeout: 1 });
    const rejection = expect(promise).rejects.toMatchObject({ code: "timeout" });

    await vi.advanceTimersByTimeAsync(900);
    worker.stdout.emit(
      "data",
      `${JSON.stringify({ type: "log", level: "warn", message: "Cloudflare challenge detected, waiting..." })}\n`,
    );
    await vi.advanceTimersByTimeAsync(100);

    await rejection;
    expect(worker.kill).toHaveBeenCalledWith("SIGTERM");
    bridge.__resetBridgeRuntimeForTests();
  });
});

```
</file_contents>
<git_diff>
diff --git a/native/chatgpt-cloak-bridge.cjs b/native/chatgpt-cloak-bridge.cjs
index b0c7c02..875c009 100644
--- a/native/chatgpt-cloak-bridge.cjs
+++ b/native/chatgpt-cloak-bridge.cjs
@@ -77,11 +77,7 @@ function runCloakWorker({ workerPath, request, timeout = DEFAULT_CHATGPT_CHATS_T
 
     const worker = runtime.spawn(process.execPath, [workerPath], {
       stdio: ["pipe", "pipe", "pipe"],
-      env: {
-        ...process.env,
-        CLOAK_HEADLESS: process.env.CLOAK_HEADLESS ?? "1",
-        CLOAK_HUMANIZE: process.env.CLOAK_HUMANIZE ?? "1",
-      },
+      env: { ...process.env },
     });
 
     const timeoutMs = timeout * 1000;
@@ -267,43 +263,7 @@ async function manageChatsWithCloakBrowser(opts, onProgress = () => {}) {
     },
   });
 
-  try {
-    return await runChatsRequest();
-  } catch (err) {
-    const shouldRetryHeaded = (
-      opts?.action === "get" &&
-      opts?.continueInBrowser !== true &&
-      err?.code === "worker_exit" &&
-      err?.exitCode === 0
-    );
-    if (!shouldRetryHeaded) throw err;
-    onProgress({
-      type: "progress",
-      step: 0,
-      total: 0,
-      message: "Worker exited without result; retrying in headed CloakBrowser",
-    });
-    const previousHeadless = process.env.CLOAK_HEADLESS;
-    try {
-      process.env.CLOAK_HEADLESS = "0";
-      return await runChatsRequest();
-    } catch (retryErr) {
-      const retryContext = {
-        initialError: {
-          code: err?.code || null,
-          exitCode: err?.exitCode ?? null,
-          message: err?.message || String(err),
-        },
-      };
-      if (retryErr && typeof retryErr === "object") {
-        retryErr.retryContext = retryContext;
-      }
-      throw retryErr;
-    } finally {
-      if (previousHeadless === undefined) delete process.env.CLOAK_HEADLESS;
-      else process.env.CLOAK_HEADLESS = previousHeadless;
-    }
-  }
+  return await runChatsRequest();
 }
 
 function __setBridgeRuntimeForTests(overrides = {}) {


diff --git a/native/protocol.cjs b/native/protocol.cjs
deleted file mode 100644
index 6647e50..0000000
--- a/native/protocol.cjs
+++ /dev/null
@@ -1,27 +0,0 @@
-const encodeMessage = (obj) => {
-  const json = JSON.stringify(obj);
-  const buf = Buffer.alloc(4 + Buffer.byteLength(json));
-  buf.writeUInt32LE(Buffer.byteLength(json), 0);
-  buf.write(json, 4);
-  return buf;
-};
-
-const createMessageReader = (onMessage) => {
-  let buffer = Buffer.alloc(0);
-  return (chunk) => {
-    buffer = Buffer.concat([buffer, chunk]);
-    while (buffer.length >= 4) {
-      const msgLen = buffer.readUInt32LE(0);
-      if (buffer.length < 4 + msgLen) break;
-      const json = buffer.slice(4, 4 + msgLen).toString();
-      buffer = buffer.slice(4 + msgLen);
-      try {
-        onMessage(JSON.parse(json));
-      } catch {
-        onMessage({ error: "Invalid JSON" });
-      }
-    }
-  };
-};
-
-module.exports = { encodeMessage, createMessageReader };


diff --git a/native/config.cjs b/native/config.cjs
index ff50281..c725de9 100644
--- a/native/config.cjs
+++ b/native/config.cjs
@@ -8,31 +8,10 @@ let cachedConfig = null;
 let cachedConfigPath = null;
 
 const STARTER_CONFIG = {
-  // Set to false to disable auto-saving screenshots to /tmp
-  // When disabled, screenshots return base64 + ID instead of file path
-  autoSaveScreenshots: true,
-  routes: {
-    main: ["http://localhost:3000"]
-  },
-  selectors: {
-    chatgpt: {
-      input: "#prompt-textarea"
-    }
-  }
+  chatgpt: {},
+  gemini: {}
 };
 
-// Grok models can be customized in surf.json if X.com UI changes:
-// {
-//   "grok": {
-//     "models": {
-//       "thinking": { "id": "thinking", "name": "Grok 4.1 Thinking" },
-//       "auto": { "id": "auto", "name": "Auto" },
-//       "fast": { "id": "fast", "name": "Fast" },
-//       "expert": { "id": "expert", "name": "Expert" }
-//     }
-//   }
-// }
-
 function findConfigPath() {
   const cwdPath = path.join(process.cwd(), CONFIG_NAME);
   if (fs.existsSync(cwdPath)) {


diff --git a/native/mcp-server.cjs b/native/mcp-server.cjs
index 5652f9d..32d1aa1 100644
--- a/native/mcp-server.cjs
+++ b/native/mcp-server.cjs
@@ -1,360 +1,144 @@
 #!/usr/bin/env node
-const net = require("net");
 const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
 const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
 const { z } = require("zod");
-
-const SOCKET_PATH = process.platform === "win32" ? "//./pipe/surf" : "/tmp/surf.sock";
-const REQUEST_TIMEOUT = 30000;
+const { runSurfHeadlessCommand } = require("./headless-command-runner.cjs");
 
 const TOOL_SCHEMAS = {
-  navigate: {
-    desc: "Navigate browser to URL",
-    schema: { url: z.string().describe("URL to navigate to") }
-  },
-  screenshot: {
-    desc: "Capture screenshot of current page",
-    schema: {
-      output: z.string().optional().describe("Save to file path"),
-      selector: z.string().optional().describe("Capture specific element")
-    }
-  },
-  "page.read": {
-    desc: "Get page accessibility tree for element refs",
-    schema: {
-      ref: z.string().optional().describe("Get specific element by ref")
-    }
-  },
-  "page.text": {
-    desc: "Extract all text content from page",
-    schema: {}
-  },
-  "page.state": {
-    desc: "Get page state (modals, loading indicators, etc.)",
-    schema: {}
-  },
-  click: {
-    desc: "Click element by ref or coordinates",
-    schema: {
-      ref: z.string().optional().describe("Element ref from page.read"),
-      x: z.number().optional().describe("X coordinate"),
-      y: z.number().optional().describe("Y coordinate"),
-      button: z.enum(["left", "right", "double", "triple"]).optional().describe("Click type"),
-      selector: z.string().optional().describe("CSS selector (js method)")
-    }
-  },
-  type: {
-    desc: "Type text into focused element",
-    schema: {
-      text: z.string().describe("Text to type"),
-      selector: z.string().optional().describe("CSS selector"),
-      submit: z.boolean().optional().describe("Press enter after"),
-      clear: z.boolean().optional().describe("Clear field first")
-    }
-  },
-  key: {
-    desc: "Press keyboard key",
-    schema: {
-      key: z.string().describe("Key to press (Enter, Escape, cmd+a, ctrl+shift+p, etc.)")
-    }
-  },
-  hover: {
-    desc: "Hover over element",
-    schema: {
-      ref: z.string().optional().describe("Element ref"),
-      x: z.number().optional().describe("X coordinate"),
-      y: z.number().optional().describe("Y coordinate")
-    }
-  },
-  drag: {
-    desc: "Drag between two points",
-    schema: {
-      from: z.string().optional().describe("Start x,y coordinates"),
-      to: z.string().optional().describe("End x,y coordinates")
-    }
-  },
-  "scroll.top": {
-    desc: "Scroll to top of page",
-    schema: { selector: z.string().optional().describe("Target specific container") }
-  },
-  "scroll.bottom": {
-    desc: "Scroll to bottom of page",
-    schema: { selector: z.string().optional().describe("Target specific container") }
-  },
-  "scroll.to": {
-    desc: "Scroll element into view",
-    schema: { ref: z.string().describe("Element ref from page.read") }
-  },
-  "scroll.info": {
-    desc: "Get scroll position info",
-    schema: { selector: z.string().optional().describe("Target specific container") }
-  },
-  "tab.list": {
-    desc: "List all open browser tabs",
-    schema: {}
-  },
-  "tab.new": {
-    desc: "Open new tab",
-    schema: {
-      url: z.string().describe("URL to open"),
-      urls: z.string().optional().describe("Multiple URLs (space-separated)")
-    }
-  },
-  "tab.switch": {
-    desc: "Switch to tab by ID or name",
-    schema: { id: z.string().describe("Tab ID or registered name") }
-  },
-  "tab.close": {
-    desc: "Close tab by ID or name",
-    schema: {
-      id: z.string().optional().describe("Tab ID or name"),
-      ids: z.string().optional().describe("Multiple tab IDs")
-    }
-  },
-  "tab.name": {
-    desc: "Register current tab with a name",
-    schema: { name: z.string().describe("Name for the tab") }
-  },
-  "tab.unname": {
-    desc: "Unregister a named tab",
-    schema: { name: z.string().describe("Tab name to unregister") }
-  },
-  "tab.named": {
-    desc: "List all named tabs",
-    schema: {}
-  },
-  js: {
-    desc: "Execute JavaScript in page context",
-    schema: {
-      code: z.string().describe("JavaScript code to execute (use 'return' for values)")
-    }
-  },
-  wait: {
-    desc: "Wait for specified duration",
-    schema: { duration: z.number().describe("Seconds to wait (max 30)") }
-  },
-  "wait.element": {
-    desc: "Wait for element to appear",
-    schema: {
-      selector: z.string().describe("CSS selector"),
-      timeout: z.number().optional().describe("Timeout in ms")
-    }
-  },
-  "wait.network": {
-    desc: "Wait for network to be idle",
-    schema: { timeout: z.number().optional().describe("Timeout in ms") }
-  },
-  "wait.url": {
-    desc: "Wait for URL to match pattern",
-    schema: {
-      pattern: z.string().describe("URL pattern to match"),
-      timeout: z.number().optional().describe("Timeout in ms")
-    }
-  },
-  "wait.dom": {
-    desc: "Wait for DOM to stabilize",
-    schema: {
-      stable: z.number().optional().describe("Stability window in ms"),
-      timeout: z.number().optional().describe("Max wait time in ms")
-    }
-  },
-  "wait.load": {
-    desc: "Wait for page to fully load",
-    schema: { timeout: z.number().optional().describe("Max wait time in ms") }
-  },
-  console: {
-    desc: "Read browser console messages",
-    schema: {
-      clear: z.boolean().optional().describe("Clear after reading"),
-      level: z.string().optional().describe("Filter by level (log,warn,error)")
-    }
-  },
-  network: {
-    desc: "Read network requests",
-    schema: {
-      clear: z.boolean().optional().describe("Clear after reading"),
-      filter: z.string().optional().describe("Filter by URL pattern")
-    }
+  chatgpt: {
+    desc: "Send a prompt to ChatGPT via CloakBrowser headless",
+    schema: {
+      prompt: z.string().optional().describe("Prompt text"),
+      model: z.string().optional().describe("Model shortcut or provider model name"),
+      file: z.string().optional().describe("File path to attach"),
+      promptFile: z.string().optional().describe("Read prompt text from this file path"),
+      generateImage: z.string().optional().describe("Generate an image and save it to this path"),
+      profile: z.string().optional().describe("macOS Chrome profile email for auth"),
+      timeout: z.number().optional().describe("Inactivity timeout in seconds"),
+    },
+  },
+  gemini: {
+    desc: "Send a prompt to Gemini via Bun WebView headless",
+    schema: {
+      prompt: z.string().describe("Prompt text"),
+      model: z.string().optional().describe("Gemini model name"),
+      file: z.string().optional().describe("File path to attach"),
+      generateImage: z.string().optional().describe("Generate an image and save it to this path"),
+      editImage: z.string().optional().describe("Image path to edit"),
+      output: z.string().optional().describe("Output path for image editing"),
+      youtube: z.string().optional().describe("YouTube URL to analyze"),
+      aspectRatio: z.string().optional().describe("Image aspect ratio, e.g. 1:1 or 16:9"),
+      profile: z.string().optional().describe("macOS Chrome profile email for auth"),
+      timeout: z.number().optional().describe("Request timeout in seconds"),
+    },
+  },
+  "chatgpt.chats": {
+    desc: "List, search, view, export, rename, delete, and download ChatGPT conversations",
+    schema: {
+      conversationId: z.string().optional().describe("Conversation ID to view or manage"),
+      limit: z.number().optional().describe("List count or message limit"),
+      all: z.boolean().optional().describe("Fetch all conversations"),
+      search: z.string().optional().describe("Search query"),
+      export: z.string().optional().describe("Export path"),
+      format: z.enum(["markdown", "md", "json"]).optional().describe("Export format"),
+      rename: z.string().optional().describe("New title"),
+      delete: z.boolean().optional().describe("Delete conversation"),
+      deleteIds: z.string().optional().describe("Comma-separated conversation IDs to delete"),
+      downloadFile: z.string().optional().describe("File ID to download"),
+      output: z.string().optional().describe("Output path for downloaded file"),
+      noCache: z.boolean().optional().describe("Bypass local chats cache"),
+      profile: z.string().optional().describe("macOS Chrome profile email for auth"),
+      timeout: z.number().optional().describe("Timeout in seconds"),
+    },
+  },
+  "chatgpt.reply": {
+    desc: "Reply inside an existing ChatGPT conversation",
+    schema: {
+      conversationId: z.string().describe("Conversation ID"),
+      prompt: z.string().optional().describe("Reply prompt"),
+      model: z.string().optional().describe("Model shortcut or provider model name"),
+      promptFile: z.string().optional().describe("Read reply prompt from this file path"),
+      profile: z.string().optional().describe("macOS Chrome profile email for auth"),
+      timeout: z.number().optional().describe("Inactivity timeout in seconds"),
+    },
   },
-  health: {
-    desc: "Health check - wait for URL response or element",
-    schema: {
-      url: z.string().optional().describe("URL to check (expects 200)"),
-      selector: z.string().optional().describe("CSS selector to wait for"),
-      expect: z.number().optional().describe("Expected status code"),
-      timeout: z.number().optional().describe("Timeout in ms")
-    }
-  },
-  "dialog.accept": {
-    desc: "Accept current browser dialog",
-    schema: { text: z.string().optional().describe("Text for prompt input") }
-  },
-  "dialog.dismiss": {
-    desc: "Dismiss current browser dialog",
-    schema: {}
-  },
-  "dialog.info": {
-    desc: "Get current dialog info",
-    schema: {}
-  },
-  "emulate.network": {
-    desc: "Emulate network conditions",
-    schema: { preset: z.string().describe("Network preset (slow-3g, fast-3g, offline)") }
-  },
-  "emulate.cpu": {
-    desc: "Throttle CPU",
-    schema: { rate: z.number().describe("Throttle rate (>= 1)") }
-  },
-  "emulate.geo": {
-    desc: "Override geolocation",
-    schema: {
-      lat: z.number().optional().describe("Latitude"),
-      lon: z.number().optional().describe("Longitude"),
-      accuracy: z.number().optional().describe("Accuracy in meters"),
-      clear: z.boolean().optional().describe("Clear override")
-    }
-  },
-  "form.fill": {
-    desc: "Batch fill form fields",
-    schema: { data: z.string().describe("JSON array of {ref, value}") }
-  },
-  "perf.start": {
-    desc: "Start performance trace",
-    schema: { categories: z.string().optional().describe("Trace categories (comma-separated)") }
-  },
-  "perf.stop": {
-    desc: "Stop trace and get metrics",
-    schema: {}
-  },
-  "perf.metrics": {
-    desc: "Get current performance metrics",
-    schema: {}
-  },
-  upload: {
-    desc: "Upload file(s) to input",
-    schema: {
-      ref: z.string().describe("Element ref (e.g., e5)"),
-      files: z.string().describe("File path(s) comma-separated")
-    }
-  },
-  "frame.list": {
-    desc: "List all frames in page",
-    schema: {}
-  },
-  "frame.js": {
-    desc: "Execute JS in specific frame",
-    schema: {
-      id: z.string().describe("Frame ID from frame.list"),
-      code: z.string().describe("JavaScript code")
-    }
-  },
-  smart_type: {
-    desc: "Type into specific element with options",
-    schema: {
-      selector: z.string().describe("CSS selector"),
-      text: z.string().describe("Text to type"),
-      clear: z.boolean().optional().describe("Clear first"),
-      submit: z.boolean().optional().describe("Submit after")
-    }
-  },
-  ai: {
-    desc: "AI-powered page analysis (requires GOOGLE_API_KEY)",
-    schema: {
-      query: z.string().describe("Question about the page"),
-      mode: z.enum(["find", "summary", "extract"]).optional().describe("Query mode")
-    }
-  }
 };
 
-function sendSocketRequest(tool, args = {}) {
-  return new Promise((resolve, reject) => {
-    const sock = net.createConnection(SOCKET_PATH, () => {
-      const req = {
-        type: "tool_request",
-        method: "execute_tool",
-        params: { tool, args },
-        id: "mcp-" + Date.now() + "-" + Math.random()
-      };
-      sock.write(JSON.stringify(req) + "\n");
-    });
-
-    let buf = "";
-    const timeout = setTimeout(() => {
-      sock.destroy();
-      reject(new Error("Request timeout"));
-    }, REQUEST_TIMEOUT);
-
-    sock.on("data", (d) => {
-      buf += d.toString();
-      const lines = buf.split("\n");
-      buf = lines.pop();
-      for (const line of lines) {
-        if (!line.trim()) continue;
-        try {
-          clearTimeout(timeout);
-          const resp = JSON.parse(line);
-          sock.end();
-          resolve(resp);
-        } catch {
-          clearTimeout(timeout);
-          sock.end();
-          reject(new Error("Invalid JSON response"));
-        }
-      }
-    });
-
-    sock.on("error", (e) => {
-      clearTimeout(timeout);
-      if (e.code === "ENOENT") {
-        reject(new Error("Socket not found. Is Chrome running with the surf extension?"));
-      } else {
-        reject(e);
-      }
-    });
+function normalizeToolArgs(tool, args = {}) {
+  const normalized = { ...args };
+  if ((tool === "chatgpt" || tool === "gemini") && normalized.prompt !== undefined) {
+    normalized.query = normalized.prompt;
+    delete normalized.prompt;
+  }
+  return normalized;
+}
 
-    sock.on("close", () => {
-      clearTimeout(timeout);
-      reject(new Error("Socket closed unexpectedly"));
-    });
-  });
+function hasPromptInput(args) {
+  return Boolean(args.query || args.prompt || args.promptFile || args["prompt-file"]);
 }
 
-function formatResult(resp) {
-  if (resp.error) {
-    const errText = resp.error.content?.[0]?.text || JSON.stringify(resp.error);
-    return { content: [{ type: "text", text: errText }], isError: true };
+function validateMcpArgs(tool, args = {}) {
+  if ((tool === "chatgpt" || tool === "chatgpt.reply") && !hasPromptInput(args)) {
+    throw new Error(`${tool} requires prompt or promptFile`);
   }
+}
 
-  const content = resp.result?.content || [];
-  const formatted = [];
-
-  for (const item of content) {
-    if (item.type === "text") {
-      formatted.push({ type: "text", text: item.text });
-    } else if (item.type === "image") {
-      formatted.push({
-        type: "image",
-        data: item.data,
-        mimeType: item.mimeType || "image/png"
-      });
+function formatResultPayload(value) {
+  const result = value && value.result !== undefined ? value.result : value;
+  if (result && typeof result === "object" && typeof result.response === "string") {
+    const metadata = { ...result };
+    delete metadata.response;
+    if (Object.keys(metadata).length > 0) {
+      return {
+        content: [
+          { type: "text", text: result.response },
+          { type: "text", text: JSON.stringify(metadata, null, 2) },
+        ],
+      };
     }
+    return { content: [{ type: "text", text: result.response }] };
   }
-
-  if (formatted.length === 0) {
-    formatted.push({ type: "text", text: "OK" });
+  if (result && typeof result === "object" && typeof result.text === "string") {
+    const metadata = { ...result };
+    delete metadata.text;
+    if (Object.keys(metadata).length > 0) {
+      return {
+        content: [
+          { type: "text", text: result.text },
+          { type: "text", text: JSON.stringify(metadata, null, 2) },
+        ],
+      };
+    }
+    return { content: [{ type: "text", text: result.text }] };
   }
+  if (typeof result === "string") {
+    return { content: [{ type: "text", text: result }] };
+  }
+  return { content: [{ type: "text", text: JSON.stringify(result ?? {}, null, 2) }] };
+}
 
-  return { content: formatted };
+async function runMcpHeadlessTool(name, args, runner = runSurfHeadlessCommand) {
+  try {
+    const normalizedArgs = normalizeToolArgs(name, args);
+    validateMcpArgs(name, normalizedArgs);
+    const value = await runner(name, normalizedArgs, { json: true });
+    return formatResultPayload(value);
+  } catch (err) {
+    return {
+      content: [{ type: "text", text: `Error: ${err.message}` }],
+      isError: true,
+    };
+  }
 }
 
-class PiChromeMcpServer {
-  constructor() {
+class SurfMcpServer {
+  constructor({ runner = runSurfHeadlessCommand } = {}) {
+    this.runner = runner;
     this.server = new McpServer({
       name: "surf",
-      version: "1.0.0"
+      version: "1.0.0",
     });
     this.registerTools();
-    this.registerResources();
   }
 
   registerTools() {
@@ -368,136 +152,20 @@ class PiChromeMcpServer {
         name,
         def.desc,
         schemaObj,
-        async (args) => {
-          try {
-            const resp = await sendSocketRequest(name, args);
-            return formatResult(resp);
-          } catch (err) {
-            return {
-              content: [{ type: "text", text: `Error: ${err.message}` }],
-              isError: true
-            };
-          }
-        }
+        async (args) => runMcpHeadlessTool(name, args, this.runner),
       );
     }
   }
 
-  registerResources() {
-    this.server.resource(
-      "page",
-      "page://current",
-      async (uri) => {
-        try {
-          const resp = await sendSocketRequest("page.read", {});
-          const text = resp.result?.content?.[0]?.text || "No content";
-          return {
-            contents: [{
-              uri: uri.href,
-              text,
-              mimeType: "text/plain"
-            }]
-          };
-        } catch (err) {
-          return {
-            contents: [{
-              uri: uri.href,
-              text: `Error: ${err.message}`,
-              mimeType: "text/plain"
-            }]
-          };
-        }
-      }
-    );
-
-    this.server.resource(
-      "tabs",
-      "tabs://list",
-      async (uri) => {
-        try {
-          const resp = await sendSocketRequest("tab.list", {});
-          const text = resp.result?.content?.[0]?.text || "[]";
-          return {
-            contents: [{
-              uri: uri.href,
-              text,
-              mimeType: "application/json"
-            }]
-          };
-        } catch (err) {
-          return {
-            contents: [{
-              uri: uri.href,
-              text: `Error: ${err.message}`,
-              mimeType: "text/plain"
-            }]
-          };
-        }
-      }
-    );
-
-    this.server.resource(
-      "console",
-      "console://messages",
-      async (uri) => {
-        try {
-          const resp = await sendSocketRequest("console", {});
-          const text = resp.result?.content?.[0]?.text || "No messages";
-          return {
-            contents: [{
-              uri: uri.href,
-              text,
-              mimeType: "text/plain"
-            }]
-          };
-        } catch (err) {
-          return {
-            contents: [{
-              uri: uri.href,
-              text: `Error: ${err.message}`,
-              mimeType: "text/plain"
-            }]
-          };
-        }
-      }
-    );
-
-    this.server.resource(
-      "network",
-      "network://requests",
-      async (uri) => {
-        try {
-          const resp = await sendSocketRequest("network", {});
-          const text = resp.result?.content?.[0]?.text || "No requests";
-          return {
-            contents: [{
-              uri: uri.href,
-              text,
-              mimeType: "text/plain"
-            }]
-          };
-        } catch (err) {
-          return {
-            contents: [{
-              uri: uri.href,
-              text: `Error: ${err.message}`,
-              mimeType: "text/plain"
-            }]
-          };
-        }
-      }
-    );
-  }
-
   async start() {
     const transport = new StdioServerTransport();
     await this.server.connect(transport);
-    console.error("Pi Chrome MCP Server started");
+    console.error("surf MCP server started");
   }
 }
 
 async function main() {
-  const server = new PiChromeMcpServer();
+  const server = new SurfMcpServer();
   await server.start();
 }
 
@@ -508,4 +176,12 @@ if (require.main === module) {
   });
 }
 
-module.exports = { PiChromeMcpServer };
+module.exports = {
+  SurfMcpServer,
+  PiChromeMcpServer: SurfMcpServer,
+  TOOL_SCHEMAS,
+  formatResultPayload,
+  normalizeToolArgs,
+  runMcpHeadlessTool,
+  validateMcpArgs,
+};


diff --git a/native/do-executor.cjs b/native/do-executor.cjs
index 85ada96..0a80798 100644
--- a/native/do-executor.cjs
+++ b/native/do-executor.cjs
@@ -7,36 +7,19 @@
  *   - Loops: `repeat` for fixed iterations, `each` for array iteration
  *   - Variable substitution: %{varname} syntax
  * 
- * Follows the same socket communication pattern as --script mode in cli.cjs.
+ * Runs the supported headless commands through the CLI entrypoint.
  */
 
-const net = require("net");
-
-const SOCKET_PATH = process.platform === "win32" ? "//./pipe/surf" : "/tmp/surf.sock";
+const {
+  SUPPORTED_HEADLESS_COMMANDS,
+  runSurfHeadlessCommand,
+} = require("./headless-command-runner.cjs");
 
 // Maximum iterations for loops (safety cap)
 const MAX_LOOP_ITERATIONS = 100;
 
-// Commands that trigger auto-wait after execution
-// Note: 'type' is intentionally excluded - typing doesn't trigger navigation or DOM changes
-const AUTO_WAIT_COMMANDS = [
-  'go', 'navigate', 'click', 'key', 'form.fill', 'submit',
-  'tab.switch', 'tab.new', 'back', 'forward'
-];
-
-// Auto-wait strategies per command type
-const AUTO_WAIT_MAP = {
-  'navigate': 'wait.load',
-  'go': 'wait.load',
-  'click': 'wait.dom',
-  'key': 'wait.dom',
-  'form.fill': 'wait.dom',
-  'submit': 'wait.load',  // Form submission typically triggers navigation
-  'tab.switch': 'wait.load',
-  'tab.new': 'wait.load',
-  'back': 'wait.load',
-  'forward': 'wait.load',
-};
+const AUTO_WAIT_COMMANDS = [];
+const AUTO_WAIT_MAP = {};
 
 /**
  * Check if a command should trigger an auto-wait
@@ -64,64 +47,6 @@ function getAutoWaitCommand(cmd) {
   return null;
 }
 
-/**
- * Send a single tool request over socket
- * @param {string} toolName - Tool/command name
- * @param {object} toolArgs - Tool arguments
- * @param {object} context - Execution context (tabId, windowId)
- * @returns {Promise<object>} - Response from host
- */
-function sendDoRequest(toolName, toolArgs, context = {}) {
-  return new Promise((resolve, reject) => {
-    const sock = net.createConnection(SOCKET_PATH, () => {
-      const req = {
-        type: "tool_request",
-        method: "execute_tool",
-        params: { tool: toolName, args: toolArgs },
-        id: "do-" + Date.now() + "-" + Math.random(),
-      };
-      if (context.tabId) req.tabId = context.tabId;
-      if (context.windowId) req.windowId = context.windowId;
-      sock.write(JSON.stringify(req) + "\n");
-    });
-    
-    let buf = "";
-    sock.on("data", (d) => {
-      buf += d.toString();
-      const lines = buf.split("\n");
-      buf = lines.pop();
-      for (const line of lines) {
-        if (!line.trim()) continue;
-        try {
-          const resp = JSON.parse(line);
-          sock.end();
-          resolve(resp);
-        } catch {
-          sock.end();
-          reject(new Error("Invalid JSON response"));
-        }
-      }
-    });
-    
-    sock.on("error", (e) => {
-      if (e.code === "ENOENT") {
-        reject(new Error("Socket not found. Is Chrome running with the extension?"));
-      } else if (e.code === "ECONNREFUSED") {
-        reject(new Error("Connection refused. Native host not running."));
-      } else {
-        reject(e);
-      }
-    });
-    
-    const timeoutId = setTimeout(() => { 
-      sock.destroy(); 
-      reject(new Error("Request timeout")); 
-    }, 30000);
-    
-    sock.on("close", () => clearTimeout(timeoutId));
-  });
-}
-
 /**
  * Resolve a variable reference or perform string substitution
  * @param {*} template - Value to resolve (may contain %{var} references)
@@ -222,40 +147,30 @@ function extractStepOutput(resp) {
  * @returns {Promise<object>} - Result { success, error?, output? }
  */
 async function executeSingleStep(step, vars, context, options) {
-  const { autoWait = true, stepDelay = 100 } = options;
+  const { stepDelay = 100, quiet = false } = options;
   
   // Substitute variables in args
   const resolvedArgs = substituteVars(step.args || {}, vars);
   
   try {
-    const resp = await sendDoRequest(step.cmd, resolvedArgs, context);
-    
-    if (resp.error) {
-      const errText = resp.error.content?.[0]?.text || JSON.stringify(resp.error);
-      return { success: false, error: errText };
+    if (!SUPPORTED_HEADLESS_COMMANDS.has(step.cmd)) {
+      return {
+        success: false,
+        error: `Command "${step.cmd}" is not supported by the headless-only workflow runtime.`,
+      };
     }
-    
+
+    const resp = await runSurfHeadlessCommand(step.cmd, resolvedArgs, {
+      json: true,
+      onStderr: quiet ? undefined : (text) => process.stderr.write(text),
+    });
+
     // Capture output if step has `as` field
     if (step.as) {
       const output = extractStepOutput(resp);
       vars[step.as] = output;
     }
-    
-    // Command-specific auto-wait
-    if (autoWait) {
-      const waitCmd = getAutoWaitCommand(step.cmd);
-      if (waitCmd) {
-        const waitArgs = waitCmd === 'wait.load' 
-          ? { timeout: 10000 } 
-          : { stable: 100, timeout: 5000 };
-        try {
-          await sendDoRequest(waitCmd, waitArgs, context);
-        } catch {
-          // Ignore auto-wait failures silently
-        }
-      }
-    }
-    
+
     // Delay between steps
     if (stepDelay > 0) {
       await new Promise(r => setTimeout(r, stepDelay));
@@ -433,7 +348,7 @@ async function executeDoSteps(steps, options = {}) {
         console.log(`[${i + 1}/${total}] Loop: ${loopType} (${step.steps?.length || 0} nested steps)`);
       }
       
-      const result = await executeStep(step, vars, context, { onError, autoWait, stepDelay }, null);
+      const result = await executeStep(step, vars, context, { onError, autoWait, stepDelay, quiet }, null);
       const ms = Date.now() - startTime;
       
       stepsExecuted += result.stepsExecuted || 0;
@@ -473,7 +388,7 @@ async function executeDoSteps(steps, options = {}) {
         process.stdout.write(`${stepNum} ${desc} ... `);
       }
       
-      const result = await executeSingleStep(step, vars, context, { onError, autoWait, stepDelay });
+      const result = await executeSingleStep(step, vars, context, { onError, autoWait, stepDelay, quiet });
       const ms = Date.now() - startTime;
       stepsExecuted++;
       
@@ -519,7 +434,6 @@ async function executeDoSteps(steps, options = {}) {
 
 module.exports = { 
   executeDoSteps, 
-  sendDoRequest, 
   shouldAutoWait,
   getAutoWaitCommand,
   substituteVars,


diff --git a/native/cli.cjs b/native/cli.cjs
index 69d2c71..733aacd 100755
--- a/native/cli.cjs
+++ b/native/cli.cjs
@@ -9,7 +9,7 @@ const networkFormatters = require("./formatters/network.cjs");
 const networkStore = require("./network-store.cjs");
 const { parseDoCommands } = require("./do-parser.cjs");
 const { executeDoSteps } = require("./do-executor.cjs");
-const { shouldUseBunGemini, isBunGeminiEligible, runGeminiViaBun } = require("./gemini-bun-bridge.cjs");
+const { isBunGeminiEligible, runGeminiViaBun } = require("./gemini-bun-bridge.cjs");
 const { shouldUseBunChatGPT, isBunChatGPTEligible, runChatGPTViaBun } = require("./chatgpt-bun-bridge.cjs");
 const { isCloakBrowserAvailable, queryWithCloakBrowser, manageChatsWithCloakBrowser } = require("./chatgpt-cloak-bridge.cjs");
 const chatgptChatsFormatter = require("./chatgpt-chats-formatter.cjs");
@@ -23,6 +23,145 @@ const SURF_TMP = IS_WIN ? path.join(os.tmpdir(), "surf") : "/tmp";
 const SOCKET_PATH = IS_WIN ? "//./pipe/surf" : "/tmp/surf.sock";
 if (IS_WIN) { try { fs.mkdirSync(SURF_TMP, { recursive: true }); } catch {} }
 
+const SURF_SKILL_BT = "`";
+const SURF_SKILL_DOC = String.raw`---
+name: surf
+description: Run the headless-only surf CLI for ChatGPT and Gemini terminal workflows.
+---
+
+# Surf
+
+Headless terminal AI via local signed-in browser profiles.
+Prefer real CLI execution over guessed provider APIs.
+
+Repo + local CLI verified against **surf-cli v2.11.1**.
+
+## Use when
+
+- ChatGPT prompts, file review, prompt-file runs, image generation
+- Gemini prompts, file/video analysis, image generation/editing
+- ChatGPT conversation list/search/view/export/reply/manage flows
+- Long-running browser-session AI from shell, tmux, or agent workflows
+
+## Defaults
+
+- Headless-only CLI.
+- ChatGPT uses CloakBrowser headless by default.
+- Gemini uses Bun WebView headless by default.
+- Default profile on macOS: ${SURF_SKILL_BT}dsebban883@gmail.com${SURF_SKILL_BT} unless the user asks for another account.
+- Use ${SURF_SKILL_BT}--profile dsebban883@gmail.com${SURF_SKILL_BT} for reliable auth and file/image/chats features.
+
+## Sanity check
+
+${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}bash
+surf --version
+surf --help
+surf chatgpt.chats --limit 1 --profile dsebban883@gmail.com
+${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}
+
+## ChatGPT
+
+${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}bash
+surf chatgpt "explain this code" --profile dsebban883@gmail.com
+surf chatgpt "review this PR" --file diff.patch --profile dsebban883@gmail.com
+surf chatgpt --prompt-file prompt.md --model gpt-5.4-pro --profile dsebban883@gmail.com
+surf chatgpt "a robot surfing" --generate-image /tmp/robot.png --profile dsebban883@gmail.com
+surf chatgpt "deep analysis" --model gpt-5.4-pro --profile dsebban883@gmail.com
+${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}
+
+${SURF_SKILL_BT}--prompt-file${SURF_SKILL_BT} reads the file as prompt text. Use it for large exported contexts. ${SURF_SKILL_BT}--file${SURF_SKILL_BT} uploads as an attachment.
+
+### ChatGPT model aliases
+
+- ${SURF_SKILL_BT}instant${SURF_SKILL_BT}, ${SURF_SKILL_BT}gpt-5.3${SURF_SKILL_BT}, ${SURF_SKILL_BT}gpt-4o${SURF_SKILL_BT}, ${SURF_SKILL_BT}gpt-4.1${SURF_SKILL_BT}, ${SURF_SKILL_BT}gpt-4.1-mini${SURF_SKILL_BT} → GPT-5.3 Instant
+- ${SURF_SKILL_BT}thinking${SURF_SKILL_BT}, ${SURF_SKILL_BT}gpt-5.4-thinking${SURF_SKILL_BT}, ${SURF_SKILL_BT}o3${SURF_SKILL_BT}, ${SURF_SKILL_BT}o4-mini${SURF_SKILL_BT} → GPT-5.4 Thinking
+- ${SURF_SKILL_BT}pro${SURF_SKILL_BT}, ${SURF_SKILL_BT}gpt-5.4-pro${SURF_SKILL_BT}, ${SURF_SKILL_BT}chatgpt-pro${SURF_SKILL_BT}, ${SURF_SKILL_BT}o1-pro${SURF_SKILL_BT} → GPT-5.4 Pro
+
+## ChatGPT conversations
+
+${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}bash
+surf chatgpt.chats --limit 20 --profile dsebban883@gmail.com
+surf chatgpt.chats --search "auth system" --profile dsebban883@gmail.com
+surf chatgpt.chats <conversation-id> --profile dsebban883@gmail.com
+surf chatgpt.chats <conversation-id> --export /tmp/chat.md --profile dsebban883@gmail.com
+surf chatgpt.chats <conversation-id> --export /tmp/chat.json --format json --json --profile dsebban883@gmail.com
+surf chatgpt.reply <conversation-id> "follow-up" --profile dsebban883@gmail.com
+surf chatgpt.reply <conversation-id> --prompt-file followup.md --model gpt-5.4-thinking --profile dsebban883@gmail.com
+surf chatgpt.chats <conversation-id> --rename "New Title" --profile dsebban883@gmail.com
+surf chatgpt.chats <conversation-id> --delete --profile dsebban883@gmail.com
+surf chatgpt.chats <conversation-id> --download-file <file-id> --output /tmp/file.txt --profile dsebban883@gmail.com
+${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}
+
+Notes:
+- ${SURF_SKILL_BT}--delete${SURF_SKILL_BT} is destructive; no CLI undo.
+- Search may use a recent-history fallback; if JSON shows ${SURF_SKILL_BT}partial: true${SURF_SKILL_BT}, misses are not authoritative for older chats.
+- ${SURF_SKILL_BT}--download-file${SURF_SKILL_BT} needs ${SURF_SKILL_BT}--output${SURF_SKILL_BT}.
+
+## ChatGPT thinking trace
+
+Pro/Thinking models stream live thinking content via ${SURF_SKILL_BT}🧠${SURF_SKILL_BT} lines.
+
+${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}bash
+surf chatgpt "complex problem" --model gpt-5.4-pro --profile dsebban883@gmail.com
+${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}
+
+## Gemini
+
+${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}bash
+surf gemini "explain quantum computing" --profile dsebban883@gmail.com
+surf gemini "analyze this chart" --file chart.jpg --profile dsebban883@gmail.com
+surf gemini "reason about this architecture" --model thinking --profile dsebban883@gmail.com
+surf gemini "advanced math problem" --model pro --profile dsebban883@gmail.com
+surf gemini "a robot surfing" --generate-image /tmp/robot.png --profile dsebban883@gmail.com
+surf gemini "wide banner" --generate-image /tmp/banner.png --aspect-ratio 16:9 --profile dsebban883@gmail.com
+surf gemini "add sunglasses" --edit-image photo.jpg --output out.jpg --profile dsebban883@gmail.com
+${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}
+
+### Gemini model notes
+
+Gemini 3 tiers (use ${SURF_SKILL_BT}--model <alias>${SURF_SKILL_BT}):
+
+- **Fast** (default): ${SURF_SKILL_BT}gemini-3-pro${SURF_SKILL_BT}, ${SURF_SKILL_BT}fast${SURF_SKILL_BT}, ${SURF_SKILL_BT}gemini-2.5-flash${SURF_SKILL_BT}
+- **Thinking**: ${SURF_SKILL_BT}thinking${SURF_SKILL_BT}, ${SURF_SKILL_BT}gemini-2.5-pro${SURF_SKILL_BT}, ${SURF_SKILL_BT}gemini-3.1-thinking${SURF_SKILL_BT}
+- **Pro** (3.1 Pro): ${SURF_SKILL_BT}pro${SURF_SKILL_BT}, ${SURF_SKILL_BT}gemini-3.1-pro-preview${SURF_SKILL_BT}, ${SURF_SKILL_BT}gemini-3.1-pro${SURF_SKILL_BT}
+
+Unknown model names are passed through to the UI picker best-effort.
+
+## Workflows
+
+${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}bash
+surf do 'chatgpt "Draft release notes" --profile dsebban883@gmail.com | gemini "Make it concise" --profile dsebban883@gmail.com'
+surf do 'chatgpt "Review this" --file diff.patch --profile dsebban883@gmail.com' --dry-run
+${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}
+
+## Sessions & reconciliation
+
+Every surf AI command creates a session in ${SURF_SKILL_BT}~/.surf/sessions/${SURF_SKILL_BT}.
+
+${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}bash
+surf session
+surf session <id>
+surf session --reconcile
+surf session --reconcile --network
+${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}
+
+For long runs, use tmux:
+
+${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}bash
+tmux new -d -s surf-chat "bash -lc 'surf chatgpt \"complex analysis\" --model gpt-5.4-pro --profile dsebban883@gmail.com --timeout 3000 2>&1 | tee /tmp/surf-chatgpt.log'"
+tail -f /tmp/surf-chatgpt.log
+${SURF_SKILL_BT}${SURF_SKILL_BT}${SURF_SKILL_BT}
+
+## Troubleshooting
+
+- ${SURF_SKILL_BT}--profile${SURF_SKILL_BT} is macOS-only.
+- ${SURF_SKILL_BT}--with-page${SURF_SKILL_BT} is not supported.
+- Page-context/browser-extension commands were removed.
+- Default ChatGPT timeout: **2700s**.
+- If auth fails, sign in with the same local profile and retry.
+- Use ${SURF_SKILL_BT}surf session <id>${SURF_SKILL_BT} to inspect stderr/result details.
+`;
+
 /**
  * Read a prompt file and return its content. Exits on error/empty.
  * Logs file size to stderr.
@@ -385,10 +524,10 @@ const TOOLS = {
         opts: { 
           "with-page": "Include current page context",
           model: "Model: gpt-4o, o3, o4-mini, etc.",
-          file: "Attach file (requires SURF_USE_CLOAK_CHATGPT=1 or SURF_USE_BUN_CHATGPT=1)",
-          "generate-image": "Generate image and save to path (requires SURF_USE_CLOAK_CHATGPT=1 or SURF_USE_BUN_CHATGPT=1)",
+          file: "Attach file",
+          "generate-image": "Generate image and save to path",
           timeout: "Inactivity timeout in seconds (default: 2700 = 45min)",
-          profile: "Chrome profile email for headless auth (macOS, requires SURF_USE_CLOAK_CHATGPT=1 or SURF_USE_BUN_CHATGPT=1)"
+          profile: "Chrome profile email for headless auth (macOS)"
         },
         examples: [
           { cmd: 'chatgpt "explain this code"', desc: "Basic query" },
@@ -416,7 +555,7 @@ const TOOLS = {
           continue: "Run in headed CloakBrowser (sets CLOAK_HEADLESS=0 for this command)",
           "no-cache": "Bypass local chats cache",
           timeout: "Timeout in seconds (default: 120)",
-          profile: "Chrome profile email for headless auth (macOS, requires SURF_USE_CLOAK_CHATGPT=1)",
+          profile: "Chrome profile email for headless auth (macOS)",
         },
         examples: [
           { cmd: "chatgpt.chats", desc: "List recent conversations" },
@@ -433,7 +572,7 @@ const TOOLS = {
           model: "Model override (optional)",
           continue: "Run in headed CloakBrowser (sets CLOAK_HEADLESS=0 for this command)",
           timeout: "Inactivity timeout in seconds (default: 2700 = 45min)",
-          profile: "Chrome profile email for headless auth (macOS, requires SURF_USE_CLOAK_CHATGPT=1)",
+          profile: "Chrome profile email for headless auth (macOS)",
         },
         examples: [
           { cmd: 'chatgpt.reply <conversation-id> "follow-up question"', desc: "Reply in-thread" },
@@ -445,7 +584,7 @@ const TOOLS = {
         args: ["query"], 
         opts: { 
           "with-page": "Include current page context",
-          model: "Model: gemini-3-pro (default), gemini-2.5-pro, gemini-2.5-flash",
+          model: "Model tiers: Fast (gemini-3-pro/default, fast, gemini-2.5-flash), Thinking (gemini-2.5-pro, thinking, gemini-3.1-thinking), Pro (gemini-3.1-pro-preview, pro, gemini-3.1-pro)",
           file: "Attach file to analyze",
           "generate-image": "Generate image and save to path",
           "edit-image": "Edit existing image (use with --output)",
@@ -1590,88 +1729,83 @@ const SEE_ALSO = {
   "network": ["console", "network.get"],
 };
 
+const HEADLESS_COMMAND_HELP = {
+  chatgpt: "Send prompt to ChatGPT",
+  "chatgpt.chats": "Search conversations",
+  "chatgpt.reply": "Reply in-thread",
+  gemini: "Send prompt to Gemini",
+  session: "Inspect and reconcile AI sessions",
+  do: "Execute multiple commands",
+  server: "Start MCP server",
+  skills: "Print the full agent skill reference",
+};
+
+const HEADLESS_COMMAND_LIST = [
+  "chatgpt",
+  "chatgpt.chats",
+  "chatgpt.reply",
+  "gemini",
+  "session",
+  "do",
+  "server",
+  "skills",
+];
+
 const showBasicHelp = () => {
-  console.log(`surf v${VERSION} - Browser automation CLI
+  console.log(`surf v${VERSION} - Headless terminal AI CLI
 
 Usage: surf <command> [args] [options]
 
-Common Commands:
-  navigate <url>     Go to URL (alias: go)
-  click <ref>        Click element by ref or selector
-  type <text>        Type text at cursor or into element
-  screenshot         Capture screenshot (alias: snap)
-  page.read          Get page accessibility tree (alias: read)
-  locate.role <role> Find element by ARIA role
-  search <term>      Search for text in page (alias: find)
-  window.new <url>   Create isolated browser window
-  wait <seconds>     Wait N seconds
+AI Commands (headless-only):
+  chatgpt <query>                Send prompt to ChatGPT
+  chatgpt.chats [conversation_id] List/search/view conversations
+  chatgpt.reply <conversation_id> <prompt> Reply inside a conversation
+  gemini <query>                 Send prompt to Gemini
+
+Workflow + Session:
+  do <commands>                  Execute multiple commands as a workflow
+  session                        List recent AI sessions
+  session <id>                   View session log
+  session --reconcile            Reconcile orphaned sessions
+
+Platform:
+  server                         Start MCP server
+  skills                         Print the embedded skill reference
 
 Quick Examples:
-  surf go "https://example.com"
-  surf read
-  surf click e5
-  surf type "hello" --submit
-  surf locate.role button --name "Submit" --action click
-  surf read --depth 3 --compact
-  surf emulate.device "iPhone 14"
-  surf window.new "https://example.com" && surf --window-id 123 go "https://other.com"
-
-AI Headless Mode:
-  ChatGPT (recommended — defeats Cloudflare/reCAPTCHA via CloakBrowser):
-    SURF_USE_CLOAK_CHATGPT=1 surf chatgpt "prompt" --profile user@gmail.com
-    SURF_USE_CLOAK_CHATGPT=1 surf chatgpt "prompt" --file code.ts --model gpt-5.4-pro
-    SURF_USE_CLOAK_CHATGPT=1 surf chatgpt "prompt" --generate-image /tmp/out.png
-  Fallback (Bun.WebView):
-    SURF_USE_BUN_CHATGPT=1 surf chatgpt "prompt" --profile user@gmail.com
-
-  Gemini (headless, no extension needed):
-    SURF_USE_BUN_GEMINI=1 surf gemini "prompt" --profile user@gmail.com
-    SURF_USE_BUN_GEMINI=1 surf gemini "prompt" --file data.csv --model gemini-3-pro
-
-  ChatGPT models: instant (gpt-5.3), thinking (gpt-5.4), pro (gpt-5.4-pro)
-  Also accepts legacy aliases: gpt-4o → instant, o3/o4-mini → thinking, o1-pro → pro
+  surf chatgpt "review this PR" --file diff.patch --profile user@gmail.com
+  surf gemini "analyze this chart" --file chart.jpg --model gemini-3-pro --profile user@gmail.com
+  surf do 'chatgpt "Draft" --profile user@gmail.com | gemini "Tighten" --profile user@gmail.com'
 
 More Help:
-  surf --help-full           All commands
-  surf --help-topic <topic>  Topic guide (refs, semantic, frames, devices...)
+  surf --help-full           All headless commands
   surf <command> --help      Command details
-  surf --find <query>        Search for commands
-  surf --about <topic>       Learn about a topic
-  surf skills                Print the full agent skill reference (SKILL.md)
-  surf session               List recent AI sessions (~/.surf/sessions/)
-  surf session <id>          View session log (full stderr + result)
-  surf session --clear       Delete all sessions
+  surf --find <query>        Search supported commands
 `);
 };
 
 const showFullHelp = () => {
-  console.log(`surf v${VERSION} - Browser automation CLI
+  console.log(`surf v${VERSION} - Headless terminal AI CLI
 
 Usage: surf <command> [args] [options]
 
-`);
-  for (const [groupName, group] of Object.entries(TOOLS)) {
-    console.log(`${groupName.toUpperCase()} - ${group.desc}`);
-    for (const [cmd, info] of Object.entries(group.commands)) {
-      if (info.alias) continue;
-      const argStr = info.args?.length ? `<${info.args.join("> <")}>` : "";
-      const line = `  ${cmd} ${argStr}`.padEnd(32);
-      console.log(`${line}${info.desc}`);
-    }
-    console.log();
-  }
-  console.log(`Aliases: snap -> screenshot, read -> page.read, find -> search, go -> navigate
+AI - AI assistants (headless-only)
+  chatgpt <query>               Send prompt to ChatGPT
+  chatgpt.chats <conversation_id> Search conversations
+  chatgpt.reply <conversation_id> <prompt> Reply in-thread
+  gemini <query>                Send prompt to Gemini
 
-Options:
-  --tab-id <id>     Target specific tab
-  --window-id <id>  Target specific window (isolate from your browsing)
-  --json            Output raw JSON
-  --auto-capture    On error: capture screenshot + console to /tmp
-  --soft-fail       On error: warn and exit 0 (for non-critical commands)
-
-Script Mode:
-  surf --script <file>     Run workflow from JSON
-  surf --script <file> --dry-run
+WORKFLOW
+  do <commands>                 Execute multiple commands
+
+SESSIONS
+  session                       List/review/reconcile sessions
+
+MCP
+  server                        Start MCP server
+
+DOCS
+  skills                        Print embedded skill reference
 `);
 };
 
@@ -1776,18 +1910,16 @@ const showToolHelp = (toolName) => {
 const fuzzyFind = (query) => {
   const terms = query.toLowerCase().split(/\s+/);
   const results = [];
-  
-  for (const [groupName, group] of Object.entries(TOOLS)) {
-    for (const [cmd, info] of Object.entries(group.commands)) {
-      if (info.alias) continue;
-      const searchText = `${cmd} ${info.desc} ${groupName}`.toLowerCase();
-      const score = terms.filter(t => searchText.includes(t)).length;
-      if (score > 0) {
-        results.push({ cmd, desc: info.desc, group: groupName, score });
-      }
+
+  for (const cmd of HEADLESS_COMMAND_LIST) {
+    const desc = HEADLESS_COMMAND_HELP[cmd] || "";
+    const searchText = `${cmd} ${desc} headless ai`.toLowerCase();
+    const score = terms.filter((t) => searchText.includes(t)).length;
+    if (score > 0) {
+      results.push({ cmd, desc, group: "headless", score });
     }
   }
-  
+
   return results.sort((a, b) => b.score - a.score);
 };
 
@@ -1825,14 +1957,11 @@ const showAbout = (topic) => {
 
 const showAllTools = () => {
   console.log("\n  All available commands:\n");
-  const sorted = [...ALL_SOCKET_TOOLS].sort();
-  const cols = 4;
-  const width = 22;
-  for (let i = 0; i < sorted.length; i += cols) {
-    const row = sorted.slice(i, i + cols).map(t => t.padEnd(width)).join("");
-    console.log("  " + row);
+  const sorted = [...HEADLESS_COMMAND_LIST].sort();
+  for (const cmd of sorted) {
+    console.log(`  ${cmd.padEnd(24)} ${HEADLESS_COMMAND_HELP[cmd] || ""}`);
   }
-  console.log(`\n  Total: ${ALL_SOCKET_TOOLS.length} commands\n`);
+  console.log(`\n  Total: ${HEADLESS_COMMAND_LIST.length} commands\n`);
 };
 
 const showSessionHelp = () => {
@@ -1909,20 +2038,7 @@ if (args[0] === "server") {
 }
 
 if (args[0] === "skills" || args[0] === "skill") {
-  const fs = require("fs");
-  // Search order: npm package skills dir, then symlinked agent skill
-  const candidatePaths = [
-    path.resolve(__dirname, "../skills/surf/SKILL.md"),
-    path.join(os.homedir(), ".pi", "agent", "skills", "surf", "SKILL.md"),
-    path.join(os.homedir(), ".agents", "skills", "surf", "SKILL.md"),
-  ];
-  const skillPath = candidatePaths.find(p => fs.existsSync(p));
-  if (!skillPath) {
-    console.error("SKILL.md not found. Expected at: " + candidatePaths[0]);
-    console.error("To install: ln -s \"$(npm root -g)/surf-cli/skills/surf\" ~/.agents/skills/surf");
-    process.exit(1);
-  }
-  process.stdout.write(fs.readFileSync(skillPath, "utf-8"));
+  process.stdout.write(SURF_SKILL_DOC);
   process.exit(0);
 }
 
@@ -3522,25 +3638,11 @@ const requestedProfile = (() => {
   return undefined;
 })();
 
-// Bun-only ChatGPT features: --file, --generate-image, --profile
+// Retained for legacy Bun fallback block below (currently unreachable in headless-only mode).
 const hasBunOnlyChatGPTFeature = !!(
   toolArgs.file || toolArgs["generate-image"] || requestedProfile
 );
 
-// CloakBrowser check (defined here to avoid TDZ issues)
-const shouldUseCloakChatGPT = () => process.env.SURF_USE_CLOAK_CHATGPT === "1";
-
-if (tool === "chatgpt" && hasBunOnlyChatGPTFeature && !shouldUseBunChatGPT(process.env) && !shouldUseCloakChatGPT()) {
-  // Bun-only feature requested but env flag not set — fail fast
-  const features = [
-    toolArgs.file && "--file",
-    toolArgs["generate-image"] && "--generate-image",
-    requestedProfile && "--profile",
-  ].filter(Boolean).join(", ");
-  console.error(`Error: ${features} requires headless mode (set SURF_USE_CLOAK_CHATGPT=1 or SURF_USE_BUN_CHATGPT=1)`);
-  process.exit(1);
-}
-
 if ((tool === "chatgpt" || CHATGPT_CLOAK_ONLY_TOOLS.has(tool)) && requestedProfile) {
   if (process.platform !== "darwin") {
     console.error("Error: --profile is only supported on macOS");
@@ -3552,17 +3654,11 @@ if ((tool === "chatgpt" || CHATGPT_CLOAK_ONLY_TOOLS.has(tool)) && requestedProfi
   }
 }
 
-if (CHATGPT_CLOAK_ONLY_TOOLS.has(tool) && !shouldUseCloakChatGPT()) {
-  console.error("Error: this command requires CloakBrowser mode (set SURF_USE_CLOAK_CHATGPT=1)");
-  process.exit(1);
-}
-
 // ---------------------------------------------------------------------------
-// CloakBrowser ChatGPT path (opt-in via SURF_USE_CLOAK_CHATGPT=1)
-// Premium stealth: C++ patches, human-like behavior, defeats detection
+// CloakBrowser ChatGPT path (default)
 // ---------------------------------------------------------------------------
 
-if (tool === "chatgpt" && shouldUseCloakChatGPT()) {
+if (tool === "chatgpt") {
   (async () => {
     if (requestedProfile) toolArgs.profile = requestedProfile;
     if (toolArgs["generate-image"]) toolArgs.generateImage = toolArgs["generate-image"];
@@ -3799,7 +3895,7 @@ if (tool === "chatgpt" && shouldUseBunChatGPT(process.env)) {
 }
 
 // ---------------------------------------------------------------------------
-// Bun-native Gemini path (opt-in via SURF_USE_BUN_GEMINI=1)
+// Bun-native Gemini path (default)
 // ---------------------------------------------------------------------------
 
 if (tool === "gemini" && requestedProfile) {
@@ -3808,17 +3904,13 @@ if (tool === "gemini" && requestedProfile) {
     console.error("Error: --profile is only supported on macOS");
     process.exit(1);
   }
-  if (!shouldUseBunGemini(process.env)) {
-    console.error("Error: --profile requires Bun Gemini (set SURF_USE_BUN_GEMINI=1)");
-    process.exit(1);
-  }
   if (toolArgs["with-page"] || toolArgs.withPage) {
     console.error("Error: --profile cannot be used with --with-page");
     process.exit(1);
   }
 }
 
-if (tool === "gemini" && shouldUseBunGemini(process.env)) {
+if (tool === "gemini") {
   const eligibility = isBunGeminiEligible(toolArgs);
   if (eligibility.eligible) {
     // Pass profile into the toolArgs for the bridge


diff --git a/test/unit/gemini-bun-bridge.test.ts b/test/unit/gemini-bun-bridge.test.ts
index 9772548..ac84ffd 100644
--- a/test/unit/gemini-bun-bridge.test.ts
+++ b/test/unit/gemini-bun-bridge.test.ts
@@ -3,32 +3,6 @@ import { describe, expect, it } from "vitest";
 const bridge = require("../../native/gemini-bun-bridge.cjs");
 
 describe("gemini-bun-bridge", () => {
-  describe("shouldUseBunGemini", () => {
-    it("returns false when env not set", () => {
-      expect(bridge.shouldUseBunGemini({})).toBe(false);
-    });
-
-    it("returns false for empty string", () => {
-      expect(bridge.shouldUseBunGemini({ SURF_USE_BUN_GEMINI: "" })).toBe(false);
-    });
-
-    it("returns true for '1'", () => {
-      expect(bridge.shouldUseBunGemini({ SURF_USE_BUN_GEMINI: "1" })).toBe(true);
-    });
-
-    it("returns true for 'true' (case-insensitive)", () => {
-      expect(bridge.shouldUseBunGemini({ SURF_USE_BUN_GEMINI: "true" })).toBe(true);
-      expect(bridge.shouldUseBunGemini({ SURF_USE_BUN_GEMINI: "True" })).toBe(true);
-      expect(bridge.shouldUseBunGemini({ SURF_USE_BUN_GEMINI: "TRUE" })).toBe(true);
-    });
-
-    it("returns false for other values", () => {
-      expect(bridge.shouldUseBunGemini({ SURF_USE_BUN_GEMINI: "0" })).toBe(false);
-      expect(bridge.shouldUseBunGemini({ SURF_USE_BUN_GEMINI: "false" })).toBe(false);
-      expect(bridge.shouldUseBunGemini({ SURF_USE_BUN_GEMINI: "yes" })).toBe(false);
-    });
-  });
-
   describe("isBunGeminiEligible", () => {
     it("returns ineligible for --with-page", () => {
       const result = bridge.isBunGeminiEligible({ "with-page": true });
@@ -126,7 +100,7 @@ describe("gemini-bun-bridge", () => {
 
   // --- P2 fix: protocol edge cases ---
   describe("runGeminiViaBun - protocol edge cases", () => {
-    it("returns error with fallback for empty stdout", async () => {
+    it("returns protocol error for empty stdout", async () => {
       // We can't easily mock spawn, but we can test with a deliberately bad worker
       // by pointing to a non-existent script — spawn_failed
       const { execFileSync } = require("node:child_process");


diff --git a/native/chatgpt-bun-worker.ts b/native/chatgpt-bun-worker.ts
index e9d5dd7..2c374e8 100644
--- a/native/chatgpt-bun-worker.ts
+++ b/native/chatgpt-bun-worker.ts
@@ -1,5 +1,5 @@
 #!/usr/bin/env bun
-/// <reference path="./bun-webview.d.ts" />
+declare const Bun: any;
 /**
  * Bun WebView worker for ChatGPT queries.
  *
@@ -72,7 +72,6 @@ interface WorkerError {
   ok: false;
   code: string;
   error: string;
-  fallbackRecommended: boolean;
 }
 
 // ============================================================================
@@ -1284,23 +1283,12 @@ async function main() {
     const message = err.message || String(err);
     log(`Error [${code}]: ${message}`);
 
-    // Fallback policy: hard-fail for Bun-only features; recommend fallback for others
-    const HARD_FAIL_CODES = new Set([
-      "upload_failed",
-      "image_save_failed",
-      "profile_not_found",
-      "profile_ambiguous",
-      "profile_unsupported_platform",
-      "protocol_error",
-    ]);
-
     console.log(
       JSON.stringify({
         ok: false,
         code,
         error: message,
-        fallbackRecommended: !HARD_FAIL_CODES.has(code),
-      }),
+      } satisfies WorkerError),
     );
   } finally {
     if (wv) {
@@ -1310,3 +1298,5 @@ async function main() {
 }
 
 main();
+
+export {};


diff --git a/test/unit/chatgpt-bun-bridge.test.ts b/test/unit/chatgpt-bun-bridge.test.ts
index 0905bff..eadf87f 100644
--- a/test/unit/chatgpt-bun-bridge.test.ts
+++ b/test/unit/chatgpt-bun-bridge.test.ts
@@ -3,32 +3,6 @@ import { describe, expect, it } from "vitest";
 const bridge = require("../../native/chatgpt-bun-bridge.cjs");
 
 describe("chatgpt-bun-bridge", () => {
-  describe("shouldUseBunChatGPT", () => {
-    it("returns false when env not set", () => {
-      expect(bridge.shouldUseBunChatGPT({})).toBe(false);
-    });
-
-    it("returns false for empty string", () => {
-      expect(bridge.shouldUseBunChatGPT({ SURF_USE_BUN_CHATGPT: "" })).toBe(false);
-    });
-
-    it("returns true for '1'", () => {
-      expect(bridge.shouldUseBunChatGPT({ SURF_USE_BUN_CHATGPT: "1" })).toBe(true);
-    });
-
-    it("returns true for 'true' (case-insensitive)", () => {
-      expect(bridge.shouldUseBunChatGPT({ SURF_USE_BUN_CHATGPT: "true" })).toBe(true);
-      expect(bridge.shouldUseBunChatGPT({ SURF_USE_BUN_CHATGPT: "True" })).toBe(true);
-      expect(bridge.shouldUseBunChatGPT({ SURF_USE_BUN_CHATGPT: "TRUE" })).toBe(true);
-    });
-
-    it("returns false for other values", () => {
-      expect(bridge.shouldUseBunChatGPT({ SURF_USE_BUN_CHATGPT: "0" })).toBe(false);
-      expect(bridge.shouldUseBunChatGPT({ SURF_USE_BUN_CHATGPT: "false" })).toBe(false);
-      expect(bridge.shouldUseBunChatGPT({ SURF_USE_BUN_CHATGPT: "yes" })).toBe(false);
-    });
-  });
-
   describe("isBunChatGPTEligible", () => {
     it("returns ineligible for --with-page", () => {
       const result = bridge.isBunChatGPTEligible({ "with-page": true });
@@ -110,7 +84,7 @@ describe("chatgpt-bun-bridge", () => {
 
   // Protocol edge cases
   describe("runChatGPTViaBun - protocol edge cases", () => {
-    it("returns error with fallback for empty stdout", async () => {
+    it("returns protocol error for empty stdout", async () => {
       const { execFileSync } = require("node:child_process");
       try {
         execFileSync("which", ["bun"], { encoding: "utf-8", timeout: 3000 });


diff --git a/test/unit/do-executor.test.ts b/test/unit/do-executor.test.ts
index 062d9fb..682de67 100644
--- a/test/unit/do-executor.test.ts
+++ b/test/unit/do-executor.test.ts
@@ -4,65 +4,18 @@ import { describe, expect, it } from "vitest";
 import * as executor from "../../native/do-executor.cjs";
 
 describe("shouldAutoWait", () => {
-  it("returns true for navigation commands", () => {
-    expect(executor.shouldAutoWait("go")).toBe(true);
-    expect(executor.shouldAutoWait("navigate")).toBe(true);
-    expect(executor.shouldAutoWait("back")).toBe(true);
-    expect(executor.shouldAutoWait("forward")).toBe(true);
-  });
-
-  it("returns true for interaction commands", () => {
-    expect(executor.shouldAutoWait("click")).toBe(true);
-    expect(executor.shouldAutoWait("key")).toBe(true);
-    expect(executor.shouldAutoWait("form.fill")).toBe(true);
-    expect(executor.shouldAutoWait("submit")).toBe(true);
-  });
-
-  it("returns false for type (no DOM changes expected)", () => {
-    expect(executor.shouldAutoWait("type")).toBe(false);
-  });
-
-  it("returns true for tab commands", () => {
-    expect(executor.shouldAutoWait("tab.switch")).toBe(true);
-    expect(executor.shouldAutoWait("tab.new")).toBe(true);
-  });
-
-  it("returns false for read-only commands", () => {
-    expect(executor.shouldAutoWait("screenshot")).toBe(false);
-    expect(executor.shouldAutoWait("page.read")).toBe(false);
-    expect(executor.shouldAutoWait("tab.list")).toBe(false);
-    expect(executor.shouldAutoWait("ai")).toBe(false);
+  it("returns false after browser auto-waits were removed", () => {
+    expect(executor.shouldAutoWait("chatgpt")).toBe(false);
+    expect(executor.shouldAutoWait("gemini")).toBe(false);
+    expect(executor.shouldAutoWait("click")).toBe(false);
   });
 });
 
 describe("getAutoWaitCommand", () => {
-  it("returns wait.load for navigation", () => {
-    expect(executor.getAutoWaitCommand("navigate")).toBe("wait.load");
-    expect(executor.getAutoWaitCommand("go")).toBe("wait.load");
-    expect(executor.getAutoWaitCommand("back")).toBe("wait.load");
-    expect(executor.getAutoWaitCommand("forward")).toBe("wait.load");
-  });
-
-  it("returns wait.dom for click", () => {
-    expect(executor.getAutoWaitCommand("click")).toBe("wait.dom");
-  });
-
-  it("returns wait.load for submit", () => {
-    expect(executor.getAutoWaitCommand("submit")).toBe("wait.load");
-  });
-
-  it("returns null for type", () => {
-    expect(executor.getAutoWaitCommand("type")).toBe(null);
-  });
-
-  it("returns wait.load for tab commands", () => {
-    expect(executor.getAutoWaitCommand("tab.switch")).toBe("wait.load");
-    expect(executor.getAutoWaitCommand("tab.new")).toBe("wait.load");
-  });
-
-  it("returns null for unknown commands", () => {
-    expect(executor.getAutoWaitCommand("screenshot")).toBe(null);
-    expect(executor.getAutoWaitCommand("page.read")).toBe(null);
+  it("returns null because headless AI commands do not need browser auto-waits", () => {
+    expect(executor.getAutoWaitCommand("chatgpt")).toBe(null);
+    expect(executor.getAutoWaitCommand("gemini")).toBe(null);
+    expect(executor.getAutoWaitCommand("click")).toBe(null);
   });
 });
 
@@ -103,30 +56,27 @@ describe("substituteVars", () => {
   });
 });
 
-describe("AUTO_WAIT_COMMANDS", () => {
-  it("includes expected commands", () => {
-    expect(executor.AUTO_WAIT_COMMANDS).toContain("go");
-    expect(executor.AUTO_WAIT_COMMANDS).toContain("navigate");
-    expect(executor.AUTO_WAIT_COMMANDS).toContain("click");
-    expect(executor.AUTO_WAIT_COMMANDS).toContain("key");
+describe("executeSingleStep", () => {
+  it("rejects commands outside the headless workflow runtime", async () => {
+    const result = await executor.executeSingleStep(
+      { cmd: "screenshot", args: {} },
+      {},
+      {},
+      { quiet: true },
+    );
+    expect(result.success).toBe(false);
+    expect(result.error).toContain("not supported by the headless-only workflow runtime");
   });
+});
 
-  it("excludes type (typing doesn't trigger waits)", () => {
-    expect(executor.AUTO_WAIT_COMMANDS).not.toContain("type");
+describe("AUTO_WAIT_COMMANDS", () => {
+  it("is empty in headless-only mode", () => {
+    expect(executor.AUTO_WAIT_COMMANDS).toEqual([]);
   });
 });
 
 describe("AUTO_WAIT_MAP", () => {
-  it("maps navigation to wait.load", () => {
-    expect(executor.AUTO_WAIT_MAP.navigate).toBe("wait.load");
-    expect(executor.AUTO_WAIT_MAP.go).toBe("wait.load");
-  });
-
-  it("maps click to wait.dom", () => {
-    expect(executor.AUTO_WAIT_MAP.click).toBe("wait.dom");
-  });
-
-  it("does not include type (not an auto-wait command)", () => {
-    expect(executor.AUTO_WAIT_MAP.type).toBeUndefined();
+  it("is empty in headless-only mode", () => {
+    expect(executor.AUTO_WAIT_MAP).toEqual({});
   });
 });


diff --git a/native/gemini-bun-worker.ts b/native/gemini-bun-worker.ts
index 3374f7d..4d3a245 100644
--- a/native/gemini-bun-worker.ts
+++ b/native/gemini-bun-worker.ts
@@ -1,5 +1,5 @@
 #!/usr/bin/env bun
-/// <reference path="./bun-webview.d.ts" />
+declare const Bun: any;
 /**
  * Bun WebView worker for Gemini queries.
  *
@@ -57,7 +57,6 @@ interface WorkerError {
   ok: false;
   code: string;
   error: string;
-  fallbackRecommended: boolean;
 }
 
 // ============================================================================
@@ -574,7 +573,7 @@ async function uploadFileViaCDP(
         lastError = err;
         log(`Upload attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
         if (attempt === maxAttempts) {
-          throw new Error(`File upload failed after ${maxAttempts} attempts: ${lastError.message}`);
+          throw new Error(`File upload failed after ${maxAttempts} attempts: ${lastError?.message || err.message || String(err)}`);
         }
         await delay(1000);
       }
@@ -918,14 +917,20 @@ async function activateCreateImageTool(wv: WebView, timeoutMs = 5000): Promise<v
  */
 const MODEL_TO_MODE_KEYWORDS: Record<string, string[]> = {
   // Fast / Flash tier
+  "fast":                           ["fast"],
+  "gemini-3-fast":                  ["fast"],
   "gemini-3-pro":                   ["fast"],
   "gemini-2.5-flash":               ["fast"],
   "gemini-3.1-flash-lite-preview":  ["fast"],
   "gemini-3.1-flash":               ["fast"],
   // Thinking tier
+  "thinking":                       ["thinking"],
+  "gemini-3-thinking":              ["thinking"],
   "gemini-3.1-thinking":            ["thinking"],
   "gemini-2.5-pro":                 ["thinking"],
   // Pro tier
+  "pro":                            ["pro"],
+  "gemini-3-pro-full":              ["pro"],
   "gemini-3.1-pro-preview":         ["pro"],
   "gemini-3.1-pro":                 ["pro"],
 };
@@ -1243,23 +1248,10 @@ async function main() {
     process.stdout.write(JSON.stringify(result) + "\n");
   } catch (err: any) {
     const code = err.code || "unknown";
-    // Hard failures: explicit user choices that shouldn't silently fall back
-    const hardFailCodes = new Set([
-      "upload_failed",           // file doesn't exist — not a transient issue
-      "profile_not_found",       // --profile specified but not found
-      "profile_ambiguous",       // --profile matched multiple profiles
-      "profile_unsupported_platform",
-    ]);
-    // Everything else (including "unknown" DOM/CDP failures) recommends fallback
-    // so the legacy extension path gets a chance. The CLI will override this
-    // and hard-fail if --profile was explicitly passed by the user.
-    const fallbackRecommended = !hardFailCodes.has(code);
-
     const errorResp: WorkerError = {
       ok: false,
       code,
       error: err.message || String(err),
-      fallbackRecommended,
     };
     process.stdout.write(JSON.stringify(errorResp) + "\n");
     process.exit(1);
@@ -1273,3 +1265,5 @@ async function main() {
 }
 
 main();
+
+export {};


diff --git a/package.json b/package.json
index 3905de7..869a659 100644
--- a/package.json
+++ b/package.json
@@ -1,16 +1,15 @@
 {
   "name": "surf-cli",
   "version": "2.11.1",
-  "description": "CLI for AI agents to control Chrome. Zero config, agent-agnostic, battle-tested.",
+  "description": "Headless terminal AI tool for ChatGPT and Gemini.",
   "keywords": [
-    "chrome",
-    "browser",
-    "automation",
+    "chatgpt",
+    "gemini",
     "ai",
     "agent",
     "cli",
-    "cdp",
-    "devtools"
+    "headless",
+    "mcp"
   ],
   "author": "Nico Bailon",
   "license": "MIT",
@@ -28,15 +27,11 @@
   },
   "files": [
     "native/",
-    "scripts/",
-    "dist/",
     "skills/",
     "README.md",
     "LICENSE"
   ],
   "scripts": {
-    "dev": "vite build --watch --mode development",
-    "build": "vite build",
     "check": "tsc --noEmit",
     "lint": "biome check .",
     "lint:fix": "biome check --write .",
@@ -46,31 +41,23 @@
     "test:watch": "vitest",
     "test:coverage": "vitest run --coverage",
     "test:ui": "vitest --ui",
-    "install:native": "node scripts/install-native-host.cjs",
-    "uninstall:native": "node scripts/uninstall-native-host.cjs"
+    "test:e2e:cloak:local": "SURF_E2E_CLOAK_CHATGPT_LOCAL=1 vitest run test/e2e/chatgpt-cloak-local.test.ts"
   },
   "dependencies": {
     "@google/generative-ai": "^0.24.1",
     "@modelcontextprotocol/sdk": "^1.26.0",
-    "buffer": "^6.0.3",
-    "crypto-browserify": "^3.12.1",
-    "events": "^3.3.0",
-    "stream-browserify": "^3.0.0",
-    "vite-plugin-node-polyfills": "^0.25.0",
     "zod": "^4.3.6"
   },
   "devDependencies": {
     "@biomejs/biome": "^2.4.9",
-    "@types/chrome": "^0.1.37",
     "@types/node": "^25.5.0",
     "@vitest/coverage-v8": "^4.0.18",
     "@vitest/ui": "^4.0.18",
     "typescript": "^5.7.2",
-    "vite": "^7.3.1",
     "vitest": "^4.0.18"
   },
   "optionalDependencies": {
-    "cloakbrowser": "^0.3.20",
+    "cloakbrowser": "^0.3.24",
     "playwright-core": "^1.58.2"
   }
 }


diff --git a/native/gemini-bun-bridge.cjs b/native/gemini-bun-bridge.cjs
index 39f284a..49a3be0 100644
--- a/native/gemini-bun-bridge.cjs
+++ b/native/gemini-bun-bridge.cjs
@@ -2,26 +2,15 @@
  * Bridge module: spawns the Bun WebView worker for Gemini queries.
  *
  * Handles:
- *  - SURF_USE_BUN_GEMINI env flag
  *  - Bun executable detection
- *  - Eligibility checks (--with-page → ineligible)
+ *  - Eligibility checks (--with-page is not supported by the headless worker)
  *  - Worker spawn + stdin/stdout JSON protocol
- *  - Structured error / fallback policy
+ *  - Structured errors
  */
 
 const { execFileSync, spawn } = require("child_process");
 const path = require("path");
 
-// ============================================================================
-// Feature flag
-// ============================================================================
-
-function shouldUseBunGemini(env) {
-  const flag = (env || process.env).SURF_USE_BUN_GEMINI;
-  if (!flag) return false;
-  return flag === "1" || flag.toLowerCase() === "true";
-}
-
 // ============================================================================
 // Bun detection
 // ============================================================================
@@ -121,7 +110,7 @@ function buildWorkerRequest(args) {
  * @param {object} args - CLI-parsed tool args
  * @param {object} [opts]
  * @param {number} [opts.timeoutMs] - Kill worker after this many ms
- * @returns {Promise<{ ok: true, result: object } | { ok: false, error: string, code: string, fallbackRecommended: boolean }>}
+ * @returns {Promise<{ ok: true, result: object } | { ok: false, error: string, code: string }>}
  */
 async function runGeminiViaBun(args, opts = {}) {
   const bunPath = detectBunPath();
@@ -129,8 +118,7 @@ async function runGeminiViaBun(args, opts = {}) {
     return {
       ok: false,
       code: "bun_not_found",
-      error: "Bun executable not found. Install Bun canary for headless Gemini.",
-      fallbackRecommended: true,
+      error: "Bun executable not found. Install Bun for headless Gemini.",
     };
   }
 
@@ -171,7 +159,6 @@ async function runGeminiViaBun(args, opts = {}) {
           ok: false,
           code: "timeout",
           error: `Bun worker killed after ${timeoutMs}ms`,
-          fallbackRecommended: false,
         });
       }
     }, timeoutMs + 5000);
@@ -184,7 +171,6 @@ async function runGeminiViaBun(args, opts = {}) {
         ok: false,
         code: "spawn_failed",
         error: `Failed to spawn Bun worker: ${err.message}`,
-        fallbackRecommended: true,
       });
     });
 
@@ -202,7 +188,6 @@ async function runGeminiViaBun(args, opts = {}) {
           ok: false,
           code: "protocol_error",
           error: `Bun worker produced no output (exit ${code}). stderr: ${stderr.slice(0, 300)}`,
-          fallbackRecommended: true,
         });
         return;
       }
@@ -216,14 +201,12 @@ async function runGeminiViaBun(args, opts = {}) {
             ok: false,
             code: response.code || "unknown",
             error: response.error || "Bun worker error",
-            fallbackRecommended: response.fallbackRecommended ?? false,
           });
         } else {
           resolve({
             ok: false,
             code: "protocol_error",
             error: `Unexpected worker response shape: ${lastLine.slice(0, 200)}`,
-            fallbackRecommended: true,
           });
         }
       } catch (parseErr) {
@@ -231,7 +214,6 @@ async function runGeminiViaBun(args, opts = {}) {
           ok: false,
           code: "protocol_error",
           error: `Failed to parse worker JSON: ${parseErr.message}. Output: ${lastLine.slice(0, 200)}`,
-          fallbackRecommended: true,
         });
       }
     });
@@ -243,7 +225,6 @@ async function runGeminiViaBun(args, opts = {}) {
 // ============================================================================
 
 module.exports = {
-  shouldUseBunGemini,
   isBunGeminiEligible,
   runGeminiViaBun,
   detectBunPath,


diff --git a/native/do-parser.cjs b/native/do-parser.cjs
index 39b1655..bc24795 100644
--- a/native/do-parser.cjs
+++ b/native/do-parser.cjs
@@ -4,75 +4,25 @@
  * Parses newline-separated commands into structured step arrays:
  * 
  * Input:
- *   'go "https://example.com"
- *    click e5
- *    screenshot'
+ *   'chatgpt "Draft release notes"
+ *    gemini "Make them shorter"'
  * 
  * Output:
  *   [
- *     { cmd: 'navigate', args: { url: 'https://example.com' } },
- *     { cmd: 'click', args: { ref: 'e5' } },
- *     { cmd: 'screenshot', args: {} }
+ *     { cmd: 'chatgpt', args: { query: 'Draft release notes' } },
+ *     { cmd: 'gemini', args: { query: 'Make them shorter' } }
  *   ]
  */
 
 // Aliases mapping (matches cli.cjs)
-const ALIASES = {
-  snap: "screenshot",
-  read: "page.read",
-  find: "search",
-  go: "navigate",
-  net: "network",
-  "network.dump": "network.get",
-};
+const ALIASES = {};
 
 // Primary argument mapping for positional args (matches cli.cjs)
 const PRIMARY_ARG_MAP = {
-  ai: "query",
   gemini: "query",
   chatgpt: "query",
-  perplexity: "query",
-  grok: "query",
-  navigate: "url",
-  go: "url",
-  js: "code",
-  javascript_tool: "code",
-  key: "key",
-  wait: "duration",
-  health: "url",
-  new_tab: "url",
-  "tab.new": "url",
-  switch_tab: "tab_id",
-  "tab.switch": "id",
-  close_tab: "tab_id",
-  "tab.close": "id",
-  "tab.name": "name",
-  "tab.unname": "name",
-  scroll_to_position: "position",
-  type: "text",
-  smart_type: "text",
-  "emulate.network": "preset",
-  "emulate.cpu": "rate",
-  search: "term",
-  find: "term",
-  "wait.element": "selector",
-  "wait.url": "pattern",
-  zoom: "level",
-  "history.search": "query",
-  "network.get": "id",
-  "network.body": "id",
-  "network.curl": "id",
-  "network.path": "id",
-  "window.new": "url",
-  "window.focus": "id",
-  "window.close": "id",
-  "locate.role": "role",
-  "locate.text": "text",
-  "locate.label": "label",
-  "emulate.device": "device",
-  "frame.js": "code",
-  "element.styles": "selector",
-  "select": "selector",
+  "chatgpt.reply": "conversationId",
+  "chatgpt.chats": "conversationId",
 };
 
 /**
@@ -117,6 +67,39 @@ function tokenize(line) {
   return tokens;
 }
 
+function splitCommands(input, separator) {
+  const parts = [];
+  let current = "";
+  let inQuote = null;
+
+  for (let i = 0; i < input.length; i++) {
+    const ch = input[i];
+    if (inQuote) {
+      current += ch;
+      if (ch === inQuote) inQuote = null;
+      continue;
+    }
+    if (ch === "\"" || ch === "'") {
+      inQuote = ch;
+      current += ch;
+      continue;
+    }
+    if (ch === separator) {
+      parts.push(current);
+      current = "";
+      continue;
+    }
+    current += ch;
+  }
+
+  parts.push(current);
+  return parts;
+}
+
+function hasUnquotedPipe(input) {
+  return splitCommands(input, "|").length > 1;
+}
+
 /**
  * Parse a single command line into a step object
  * @param {string} line - Single command line
@@ -137,41 +120,14 @@ function parseCommandLine(line) {
   if (i < tokens.length && !tokens[i].startsWith('--')) {
     const firstArg = tokens[i];
     
-    // Special handling for click command
-    if (cmd === 'click') {
-      if (/^e\d+$/.test(firstArg)) {
-        // Element reference: e5 -> ref
-        args.ref = firstArg;
-        i++;
-      } else if (/^\d+$/.test(firstArg) && tokens[i + 1] && /^\d+$/.test(tokens[i + 1])) {
-        // Coordinates: 100 200 -> x, y
-        args.x = parseInt(firstArg, 10);
-        args.y = parseInt(tokens[i + 1], 10);
-        i += 2;
-      }
-    } else if (cmd === 'select') {
-      // Select takes selector + one or more values: select e5 "US" or select e5 "opt1" "opt2"
-      args.selector = firstArg;
+    const primaryKey = PRIMARY_ARG_MAP[cmd];
+    if (primaryKey) {
+      args[primaryKey] = firstArg;
+      i++;
+    }
+    if (cmd === "chatgpt.reply" && i < tokens.length && !tokens[i].startsWith("--")) {
+      args.prompt = tokens[i];
       i++;
-      // Collect remaining positional args as values
-      const values = [];
-      while (i < tokens.length && !tokens[i].startsWith('--')) {
-        values.push(tokens[i]);
-        i++;
-      }
-      // Host expects 'values' (always), matching CLI behavior
-      if (values.length === 1) {
-        args.values = values[0];  // Single value as string (host will wrap in array)
-      } else if (values.length > 1) {
-        args.values = values;     // Multiple values as array
-      }
-    } else {
-      // Use PRIMARY_ARG_MAP for other commands
-      const primaryKey = PRIMARY_ARG_MAP[cmd];
-      if (primaryKey) {
-        args[primaryKey] = firstArg;
-        i++;
-      }
     }
   }
   
@@ -212,17 +168,15 @@ function parseCommandLine(line) {
  * @returns {Array<{ cmd: string, args: object }>}
  */
 function parseDoCommands(input) {
-  // Determine separator: use pipe if present, otherwise newlines
-  // Pipe is preferred for inline: 'go "url" | click e5 | screenshot'
-  // Newlines for files or heredocs
-  const hasPipe = input.includes('|');
+  // Determine separator: use unquoted pipe if present, otherwise newlines.
+  // Newlines are preferred for prompts that contain literal pipe characters.
+  const hasPipe = hasUnquotedPipe(input);
   const separator = hasPipe ? '|' : '\n';
   
   // Also handle literal \n for backwards compatibility
   const normalized = hasPipe ? input : input.replace(/\\n/g, '\n');
   
-  return normalized
-    .split(separator)
+  return splitCommands(normalized, separator)
     .map(line => line.trim())
     .filter(line => line && !line.startsWith('#'))
     .map(line => parseCommandLine(line))
@@ -232,6 +186,8 @@ function parseDoCommands(input) {
 module.exports = { 
   parseDoCommands, 
   parseCommandLine, 
+  splitCommands,
+  hasUnquotedPipe,
   tokenize,
   ALIASES,
   PRIMARY_ARG_MAP


diff --git a/test/unit/chatgpt-cloak-bridge.test.ts b/test/unit/chatgpt-cloak-bridge.test.ts
index 857cefa..84269b6 100644
--- a/test/unit/chatgpt-cloak-bridge.test.ts
+++ b/test/unit/chatgpt-cloak-bridge.test.ts
@@ -141,50 +141,9 @@ describe("chatgpt-cloak-bridge", () => {
     bridge.__resetBridgeRuntimeForTests();
   });
 
-  it("retries chat get in headed mode after clean worker_exit", async () => {
-    const worker1 = createWorker();
-    const worker2 = createWorker();
-    const spawn = vi.fn().mockReturnValueOnce(worker1).mockReturnValueOnce(worker2);
-    const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
-    bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });
-    const progress = vi.fn();
-
-    const promise = bridge.manageChatsWithCloakBrowser(
-      { action: "get", conversationId: "conv-123", timeout: 5 },
-      progress,
-    );
-
-    worker1.emit("close", 0, null);
-    await Promise.resolve();
-    await Promise.resolve();
-    worker2.stdout.emit(
-      "data",
-      `${JSON.stringify({
-        type: "success",
-        action: "get",
-        conversationId: "conv-123",
-        conversation: { current_node: "n1", mapping: { n1: {} } },
-      })}\n`,
-    );
-
-    await expect(promise).resolves.toMatchObject({
-      action: "get",
-      conversationId: "conv-123",
-    });
-    expect(spawn).toHaveBeenCalledTimes(2);
-    expect(progress).toHaveBeenCalledWith(
-      expect.objectContaining({
-        type: "progress",
-        message: expect.stringContaining("retrying"),
-      }),
-    );
-    bridge.__resetBridgeRuntimeForTests();
-  });
-
-  it("keeps original worker_exit context when headed retry also fails", async () => {
-    const worker1 = createWorker();
-    const worker2 = createWorker();
-    const spawn = vi.fn().mockReturnValueOnce(worker1).mockReturnValueOnce(worker2);
+  it("does not retry chat get after clean worker_exit in headless-only mode", async () => {
+    const worker = createWorker();
+    const spawn = vi.fn().mockReturnValue(worker);
     const bridge = require("../../native/chatgpt-cloak-bridge.cjs");
     bridge.__setBridgeRuntimeForTests({ spawn, existsSync: () => true });
 
@@ -194,21 +153,13 @@ describe("chatgpt-cloak-bridge", () => {
       timeout: 5,
     });
 
-    worker1.emit("close", 0, null);
-    await Promise.resolve();
-    await Promise.resolve();
-    worker2.emit("close", 0, null);
+    worker.emit("close", 0, null);
 
     await expect(promise).rejects.toMatchObject({
       code: "worker_exit",
       exitCode: 0,
-      retryContext: {
-        initialError: {
-          code: "worker_exit",
-          exitCode: 0,
-        },
-      },
     });
+    expect(spawn).toHaveBeenCalledTimes(1);
 
     bridge.__resetBridgeRuntimeForTests();
   });


diff --git a/native/chatgpt-cloak-chats-worker.mjs b/native/chatgpt-cloak-chats-worker.mjs
index f338b7e..4707e76 100644
--- a/native/chatgpt-cloak-chats-worker.mjs
+++ b/native/chatgpt-cloak-chats-worker.mjs
@@ -54,12 +54,10 @@ function tempProfileDir() {
 }
 
 function buildLaunchOpts(userDataDir) {
-  const headless = process.env.CLOAK_HEADLESS !== '0';
-  const humanize = process.env.CLOAK_HUMANIZE !== '0';
   return {
     userDataDir,
-    headless,
-    humanize,
+    headless: true,
+    humanize: true,
     humanPreset: 'careful',
     viewport: { width: 1280, height: 800 },
     locale: 'en-US',


diff --git a/native/tests/cli-tests.sh b/native/tests/cli-tests.sh
index cae17a8..ffae092 100755
--- a/native/tests/cli-tests.sh
+++ b/native/tests/cli-tests.sh
@@ -8,9 +8,9 @@ test_output() {
   local name="$1"
   local cmd="$2"
   local expect="$3"
-  
+
   output=$(eval "$cmd" 2>&1) || true
-  if echo "$output" | grep -q "$expect"; then
+  if echo "$output" | grep -q -- "$expect"; then
     echo "PASS: $name"
     PASS=$((PASS + 1))
   else
@@ -22,94 +22,78 @@ test_output() {
   fi
 }
 
-test_exit_code() {
+test_no_output() {
   local name="$1"
   local cmd="$2"
-  local expect_code="$3"
-  
-  eval "$cmd" > /dev/null 2>&1
-  actual_code=$?
-  if [ "$actual_code" -eq "$expect_code" ]; then
-    echo "PASS: $name"
-    PASS=$((PASS + 1))
-  else
+  local unexpected="$3"
+
+  output=$(eval "$cmd" 2>&1) || true
+  if echo "$output" | grep -q -- "$unexpected"; then
     echo "FAIL: $name"
     echo "  Command: $cmd"
-    echo "  Expected exit code: $expect_code"
-    echo "  Got: $actual_code"
+    echo "  Unexpected: $unexpected"
+    echo "  Got: $output"
     FAIL=$((FAIL + 1))
+  else
+    echo "PASS: $name"
+    PASS=$((PASS + 1))
   fi
 }
 
-echo "=== CLI Unit Tests (no extension required) ==="
+echo "=== CLI Unit Tests (headless-only) ==="
 echo ""
 
 echo "-- Version and Help --"
 test_output "version flag" "node cli.cjs --version" "surf version"
 test_output "version short" "node cli.cjs -v" "surf version"
-test_output "basic help" "node cli.cjs --help" "Common Commands"
-test_output "full help" "node cli.cjs --help-full" "Aliases:"
-test_output "help topic refs" "node cli.cjs --help-topic refs" "Element References"
-test_output "help topic selectors" "node cli.cjs --help-topic selectors" "CSS Selectors"
-test_output "help topic cookies" "node cli.cjs --help-topic cookies" "Cookie Management"
-
-echo ""
-echo "-- Migration Hints --"
-test_output "removed read_page" "node cli.cjs read_page" "Use: page.read"
-test_output "removed list_tabs" "node cli.cjs list_tabs" "Use: tab.list"
-test_output "removed wait_for_element" "node cli.cjs wait_for_element" "Use: wait.element"
-test_output "removed javascript_tool" "node cli.cjs javascript_tool" "Use: js"
-
-echo ""
-echo "-- Aliases --"
-test_output "snap help" "node cli.cjs snap --help" "snap -> screenshot"
-test_output "read help" "node cli.cjs read --help" "accessibility tree"
-test_output "find help" "node cli.cjs find --help" "search"
-test_output "go help" "node cli.cjs go --help" "URL"
+test_output "basic help" "node cli.cjs --help" "Headless terminal AI CLI"
+test_output "basic help AI commands" "node cli.cjs --help" "AI Commands (headless-only)"
+test_output "full help chatgpt" "node cli.cjs --help-full" "chatgpt"
+test_output "full help gemini" "node cli.cjs --help-full" "gemini"
+test_output "full help session" "node cli.cjs --help-full" "session"
+test_output "full help workflow" "node cli.cjs --help-full" "do"
+test_output "full help mcp" "node cli.cjs --help-full" "server"
+test_no_output "full help omits screenshot" "node cli.cjs --help-full" "screenshot"
 
 echo ""
-echo "-- Find Command --"
-test_output "find screenshot" "node cli.cjs --find screenshot" "screenshot"
-test_output "find cookie" "node cli.cjs --find cookie" "cookie"
-test_output "find wait" "node cli.cjs --find wait" "wait"
+echo "-- Supported Command Discovery --"
+test_output "list shows chatgpt" "node cli.cjs --list" "chatgpt"
+test_output "list shows gemini" "node cli.cjs --list" "gemini"
+test_output "list shows session" "node cli.cjs --list" "session"
+test_output "list shows do" "node cli.cjs --list" "do"
+test_output "list shows server" "node cli.cjs --list" "server"
+test_no_output "list omits screenshot" "node cli.cjs --list" "screenshot"
+test_no_output "list omits tab.list" "node cli.cjs --list" "tab.list"
+test_output "find chatgpt" "node cli.cjs --find chatgpt" "chatgpt"
+test_output "find gemini" "node cli.cjs --find gemini" "gemini"
+test_output "find session" "node cli.cjs --find session" "session"
+test_output "find old screenshot empty" "node cli.cjs --find screenshot" "No commands found"
 
 echo ""
-echo "-- About Command --"
-test_output "about refs" "node cli.cjs --about refs" "Element References"
-test_output "about cookies" "node cli.cjs --about cookies" "Cookie Management"
-test_output "about tab" "node cli.cjs --about tab" "Tab management"
+echo "-- Skill Command --"
+test_output "skills prints frontmatter" "node cli.cjs skills" "name: surf"
+test_output "skill alias works" "node cli.cjs skill" "Headless terminal AI via local signed-in browser profiles"
+test_output "skills version current" "node cli.cjs skills" "surf-cli v2.11.1"
+test_output "skills chatgpt aliases current" "node cli.cjs skills" "gpt-4.1-mini"
+test_output "skills gemini preview current" "node cli.cjs skills" "gemini-3.1-pro-preview"
+test_no_output "skills no missing file error" "node cli.cjs skills" "SKILL.md not found"
 
 echo ""
-echo "-- Group Help --"
-test_output "tab group help" "node cli.cjs tab" "tab.list"
-test_output "cookie group help" "node cli.cjs cookie" "cookie.list"
-test_output "scroll group help" "node cli.cjs scroll" "scroll.top"
-
-echo ""
-echo "-- Command Help with Examples --"
-test_output "click help examples" "node cli.cjs click --help" "Examples"
-test_output "type help examples" "node cli.cjs type --help" "Examples"
-test_output "screenshot help examples" "node cli.cjs screenshot --help" "Examples"
-test_output "session help" "node cli.cjs session --help" "inspect and reconcile"
+echo "-- Command Help --"
+test_output "chatgpt help" "node cli.cjs chatgpt --help" "Send prompt to ChatGPT"
+test_output "gemini help" "node cli.cjs gemini --help" "Send prompt to Gemini"
 test_output "chatgpt.chats help" "node cli.cjs chatgpt.chats --help" "Search conversations"
 test_output "chatgpt.reply help" "node cli.cjs chatgpt.reply --help" "Reply in-thread"
-
-echo ""
-echo "-- New Commands in Help --"
-test_output "back in help" "node cli.cjs --help-full" "back"
-test_output "forward in help" "node cli.cjs --help-full" "forward"
-test_output "zoom in help" "node cli.cjs --help-full" "zoom"
-test_output "bookmark in help" "node cli.cjs --help-full" "bookmark"
-test_output "history in help" "node cli.cjs --help-full" "history"
+test_output "session help" "node cli.cjs session --help" "inspect and reconcile"
+test_output "do help" "node cli.cjs do --help" "Execute multiple commands"
 
 echo ""
 echo "-- ChatGPT Chats Validation --"
-test_output "chatgpt.chats cloak hint" "node cli.cjs chatgpt.chats" "requires CloakBrowser mode"
-test_output "chatgpt.chats invalid combo" "SURF_USE_CLOAK_CHATGPT=1 node cli.cjs chatgpt.chats abc --search test" "cannot use conversation ID with --search"
-test_output "chatgpt.chats all+limit invalid" "SURF_USE_CLOAK_CHATGPT=1 node cli.cjs chatgpt.chats --all --limit 5" "cannot be combined with --limit"
-test_output "chatgpt.chats advanced conflict" "SURF_USE_CLOAK_CHATGPT=1 node cli.cjs chatgpt.chats abc --rename 'New Title' --delete" "use only one of --rename, --delete, --delete-ids, or --download-file"
-test_output "chatgpt.chats download requires output" "SURF_USE_CLOAK_CHATGPT=1 node cli.cjs chatgpt.chats abc --download-file file-123" "requires --output"
-test_output "chatgpt.reply usage" "SURF_USE_CLOAK_CHATGPT=1 node cli.cjs chatgpt.reply" "Usage: surf chatgpt.reply"
+test_output "chatgpt.chats invalid combo" "node cli.cjs chatgpt.chats abc --search test" "cannot use conversation ID with --search"
+test_output "chatgpt.chats all+limit invalid" "node cli.cjs chatgpt.chats --all --limit 5" "cannot be combined with --limit"
+test_output "chatgpt.chats advanced conflict" "node cli.cjs chatgpt.chats abc --rename 'New Title' --delete" "use only one of --rename, --delete, --delete-ids, or --download-file"
+test_output "chatgpt.chats download requires output" "node cli.cjs chatgpt.chats abc --download-file file-123" "requires --output"
+test_output "chatgpt.reply usage" "node cli.cjs chatgpt.reply" "Usage: surf chatgpt.reply"
 
 echo ""
 echo "-- Session Reconcile --"
@@ -146,22 +130,15 @@ rm -rf "$tmp_sessions"
 
 echo ""
 echo "-- Prompt File --"
-# --prompt-file with missing file should error
 test_output "prompt-file missing file" \
   "node cli.cjs chatgpt --prompt-file /tmp/nonexistent_prompt_$$.md 2>&1 || true" \
   "Failed to read prompt file"
-# --prompt-file with empty file should error
 empty_prompt=$(mktemp)
 test_output "prompt-file empty" \
   "node cli.cjs chatgpt --prompt-file $empty_prompt 2>&1 || true" \
   "prompt file is empty"
 rm -f "$empty_prompt"
 
-echo ""
-echo "-- List Command --"
-test_output "list shows new commands" "node cli.cjs --list" "back"
-test_output "list shows zoom" "node cli.cjs --list" "zoom"
-
 echo ""
 echo "==================================="
 echo "Results: $PASS passed, $FAIL failed"


diff --git a/skills/surf/SKILL.md b/skills/surf/SKILL.md
index 6be1224..da2fe3d 100644
--- a/skills/surf/SKILL.md
+++ b/skills/surf/SKILL.md
@@ -1,263 +1,136 @@
 ---
 name: surf
-description: Control Chrome browser via CLI for testing, automation, debugging, and browser-session AI. Use for real browser interaction, screenshots, DOM inspection, file upload, and especially headless ChatGPT/Gemini workflows.
+description: Run the headless-only surf CLI for ChatGPT and Gemini terminal workflows.
 ---
 
 # Surf
 
-Real Chrome-family browser control via CLI / native host / extension.
-Prefer real browser state over guessed APIs.
+Headless terminal AI via local signed-in browser profiles.
+Prefer real CLI execution over guessed provider APIs.
 
 Repo + local CLI verified against **surf-cli v2.11.1**.
 
 ## Use when
 
-- real browser interaction needed
-- screenshots / DOM / console / network capture
-- form fill / upload / waits / iframe work
-- browser-session AI via ChatGPT / Gemini / AI Studio / Perplexity / Grok
+- ChatGPT prompts, file review, prompt-file runs, image generation
+- Gemini prompts, file/video analysis, image generation/editing
+- ChatGPT conversation list/search/view/export/reply/manage flows
+- Long-running browser-session AI from shell, tmux, or agent workflows
 
-## Sanity check
-
-Always use Surf to discover live paths.
-
-```bash
-surf extension-path
-surf install <extension-id>
-surf tab.list
-```
-
-If commands break after upgrade:
-1. reload unpacked extension from `surf extension-path`
-2. rerun `surf install <extension-id>`
-3. restart Chrome fully
-
-## Core browser loop
-
-```bash
-surf go "https://example.com"
-surf read
-surf click e5
-surf type "hello"
-surf snap
-```
+## Defaults
 
-Aliases:
+- Headless-only CLI.
+- ChatGPT uses CloakBrowser headless by default.
+- Gemini uses Bun WebView headless by default.
+- Default profile on macOS: `dsebban883@gmail.com` unless the user asks for another account.
+- Use `--profile dsebban883@gmail.com` for reliable auth and file/image/chats features.
 
-```bash
-surf read   # page.read
-surf snap   # screenshot
-surf go     # navigate
-surf find   # search
-```
-
-## High-signal primitives
+## Sanity check
 
 ```bash
-surf read --depth 3 --compact
-surf page.state
-surf console
-surf network
-surf locate.role button --name "Submit" --action click
-surf locate.label "Email" --action fill --value "test@example.com"
-surf wait.element ".loaded"
-surf snap --output /tmp/shot.png
-surf upload --ref e5 --files "/path/to/file.txt"
-surf js "return document.title"
+surf --version
+surf --help
+surf chatgpt.chats --limit 1 --profile dsebban883@gmail.com
 ```
 
-## ChatGPT — headless first
-
-**Default to CloakBrowser headless.**
-Always set `SURF_USE_CLOAK_CHATGPT=1`.
-**Default profile on macOS: `dsebban883@gmail.com`.** Use that `--profile` by default unless the user asks for another account.
-Use `--profile dsebban883@gmail.com` for reliable auth and for file / image / chats features.
+## ChatGPT
 
 ```bash
-SURF_USE_CLOAK_CHATGPT=1 surf chatgpt "explain this code" --profile dsebban883@gmail.com
-SURF_USE_CLOAK_CHATGPT=1 surf chatgpt "review this PR" --file diff.patch --profile dsebban883@gmail.com
-SURF_USE_CLOAK_CHATGPT=1 surf chatgpt --prompt-file prompt.md --model gpt-5.4-pro --profile dsebban883@gmail.com
-SURF_USE_CLOAK_CHATGPT=1 surf chatgpt "a robot surfing" --generate-image /tmp/robot.png --profile dsebban883@gmail.com
-SURF_USE_CLOAK_CHATGPT=1 surf chatgpt "deep analysis" --model gpt-5.4-pro --profile dsebban883@gmail.com
+surf chatgpt "explain this code" --profile dsebban883@gmail.com
+surf chatgpt "review this PR" --file diff.patch --profile dsebban883@gmail.com
+surf chatgpt --prompt-file prompt.md --model gpt-5.4-pro --profile dsebban883@gmail.com
+surf chatgpt "a robot surfing" --generate-image /tmp/robot.png --profile dsebban883@gmail.com
+surf chatgpt "deep analysis" --model gpt-5.4-pro --profile dsebban883@gmail.com
 ```
 
-**`--prompt-file`** reads a file as the prompt text (for large exported contexts). Unlike `--file` which uploads as an attachment.
-For large exports, prefer `--prompt-file` so the worker verifies the actual latest user turn instead of accepting a pasted-file placeholder.
+`--prompt-file` reads the file as prompt text. Use it for large exported contexts. `--file` uploads as an attachment.
 
 ### ChatGPT model aliases
 
-- `instant`, `gpt-5.3`, `gpt-4o` → GPT-5.3 Instant
+- `instant`, `gpt-5.3`, `gpt-4o`, `gpt-4.1`, `gpt-4.1-mini` → GPT-5.3 Instant
 - `thinking`, `gpt-5.4-thinking`, `o3`, `o4-mini` → GPT-5.4 Thinking
-- `pro`, `gpt-5.4-pro`, `o1-pro` → GPT-5.4 Pro
+- `pro`, `gpt-5.4-pro`, `chatgpt-pro`, `o1-pro` → GPT-5.4 Pro
 
-### ChatGPT conversations
-
-These are **Cloak-only** commands.
+## ChatGPT conversations
 
 ```bash
-# list / search
-SURF_USE_CLOAK_CHATGPT=1 surf chatgpt.chats --limit 20 --profile dsebban883@gmail.com
-SURF_USE_CLOAK_CHATGPT=1 surf chatgpt.chats --search "auth system" --profile dsebban883@gmail.com
-
-# view / export
-SURF_USE_CLOAK_CHATGPT=1 surf chatgpt.chats <conversation-id> --profile dsebban883@gmail.com
-SURF_USE_CLOAK_CHATGPT=1 surf chatgpt.chats <conversation-id> --export /tmp/chat.md --profile dsebban883@gmail.com
-SURF_USE_CLOAK_CHATGPT=1 surf chatgpt.chats <conversation-id> --export /tmp/chat.json --format json --json --profile dsebban883@gmail.com
-
-# reply / manage
-SURF_USE_CLOAK_CHATGPT=1 surf chatgpt.reply <conversation-id> "follow-up" --profile dsebban883@gmail.com
-SURF_USE_CLOAK_CHATGPT=1 surf chatgpt.chats <conversation-id> --rename "New Title" --profile dsebban883@gmail.com
-SURF_USE_CLOAK_CHATGPT=1 surf chatgpt.chats <conversation-id> --delete --profile dsebban883@gmail.com
-SURF_USE_CLOAK_CHATGPT=1 surf chatgpt.chats <conversation-id> --download-file <file-id> --output /tmp/file.txt --profile dsebban883@gmail.com
-SURF_USE_CLOAK_CHATGPT=1 surf chatgpt.chats --limit 1 --json --continue --profile dsebban883@gmail.com
+surf chatgpt.chats --limit 20 --profile dsebban883@gmail.com
+surf chatgpt.chats --search "auth system" --profile dsebban883@gmail.com
+surf chatgpt.chats <conversation-id> --profile dsebban883@gmail.com
+surf chatgpt.chats <conversation-id> --export /tmp/chat.md --profile dsebban883@gmail.com
+surf chatgpt.chats <conversation-id> --export /tmp/chat.json --format json --json --profile dsebban883@gmail.com
+surf chatgpt.reply <conversation-id> "follow-up" --profile dsebban883@gmail.com
+surf chatgpt.reply <conversation-id> --prompt-file followup.md --model gpt-5.4-thinking --profile dsebban883@gmail.com
+surf chatgpt.chats <conversation-id> --rename "New Title" --profile dsebban883@gmail.com
+surf chatgpt.chats <conversation-id> --delete --profile dsebban883@gmail.com
+surf chatgpt.chats <conversation-id> --download-file <file-id> --output /tmp/file.txt --profile dsebban883@gmail.com
 ```
 
 Notes:
-- `--continue` runs headed CloakBrowser for that command
-- `--delete` is destructive; no CLI undo
-- search may use a recent-history fallback; if JSON shows `partial: true`, misses are **not authoritative** for older chats
-- `--download-file` needs `--output`
+- `--delete` is destructive; no CLI undo.
+- Search may use a recent-history fallback; if JSON shows `partial: true`, misses are not authoritative for older chats.
+- `--download-file` needs `--output`.
 
-### ChatGPT thinking trace
+## ChatGPT thinking trace
 
-Pro/Thinking models stream live thinking content via `🧠` lines:
+Pro/Thinking models stream live thinking content via `🧠` lines.
 
 ```bash
-# Thinking trace shows during generation
-SURF_USE_CLOAK_CHATGPT=1 surf chatgpt "complex problem" --model gpt-5.4-pro --profile dsebban883@gmail.com
-# Output:
-# [cloak-chatgpt] ⏳ Thinking
-# [cloak-chatgpt] 🧠 The user wants me to analyze the trade setup...
-# [cloak-chatgpt] 🧠 Looking at the volume profile and price action...
-# [cloak-chatgpt] ⏳ Responding
+surf chatgpt "complex problem" --model gpt-5.4-pro --profile dsebban883@gmail.com
 ```
 
-### ChatGPT constraints
-
-- `--profile` macOS only
-- `--profile` incompatible with `--with-page`
-- `--file` / `--generate-image` / `--profile` require headless
-- default timeout: **2700s**
-
-### Long-running ChatGPT runs
-
-Use tmux for long-think models.
-If a run dies after send or status looks uncertain, check `surf session <id>` then `surf session --reconcile --network` to confirm whether ChatGPT persisted the turn.
+## Gemini
 
 ```bash
-tmux new -d -s surf-chat "bash -lc 'SURF_USE_CLOAK_CHATGPT=1 surf chatgpt \"complex analysis\" --model gpt-5.4-pro --profile dsebban883@gmail.com --timeout 3000 2>&1 | tee /tmp/surf-chatgpt.log'"
-tail -f /tmp/surf-chatgpt.log
-```
-
-### Legacy fallback
-
-Only if headless is unavailable:
-
-```bash
-surf chatgpt "explain this code"
-surf chatgpt "summarize" --with-page
-```
-
-## Gemini — headless first
-
-**Default to Bun headless Gemini.**
-**Default profile on macOS: `dsebban883@gmail.com`.** Use that `--profile` by default unless the user asks for another account.
-Always use `SURF_USE_BUN_GEMINI=1` with `--profile dsebban883@gmail.com`.
-This path is faster, cleaner, and avoids tab pollution.
-
-```bash
-SURF_USE_BUN_GEMINI=1 surf gemini "explain quantum computing" --profile dsebban883@gmail.com
-SURF_USE_BUN_GEMINI=1 surf gemini "analyze this chart" --file chart.jpg --profile dsebban883@gmail.com
-SURF_USE_BUN_GEMINI=1 surf gemini "summarize this video" --youtube "https://youtube.com/..." --profile dsebban883@gmail.com
-```
-
-### Gemini image workflows
-
-```bash
-SURF_USE_BUN_GEMINI=1 surf gemini "a robot surfing" --generate-image /tmp/robot.png --profile dsebban883@gmail.com
-SURF_USE_BUN_GEMINI=1 surf gemini "wide banner" --generate-image /tmp/banner.png --aspect-ratio 16:9 --profile dsebban883@gmail.com
-SURF_USE_BUN_GEMINI=1 surf gemini "add sunglasses" --edit-image photo.jpg --output out.jpg --profile dsebban883@gmail.com
+surf gemini "explain quantum computing" --profile dsebban883@gmail.com
+surf gemini "analyze this chart" --file chart.jpg --profile dsebban883@gmail.com
+surf gemini "reason about this architecture" --model thinking --profile dsebban883@gmail.com
+surf gemini "advanced math problem" --model pro --profile dsebban883@gmail.com
+surf gemini "a robot surfing" --generate-image /tmp/robot.png --profile dsebban883@gmail.com
+surf gemini "wide banner" --generate-image /tmp/banner.png --aspect-ratio 16:9 --profile dsebban883@gmail.com
+surf gemini "add sunglasses" --edit-image photo.jpg --output out.jpg --profile dsebban883@gmail.com
 ```
 
 ### Gemini model notes
 
-Local help lists:
-- `gemini-3-pro` default
-- `gemini-2.5-pro`
-- `gemini-2.5-flash`
-
-Also works:
-- `gemini-3.1-pro-preview`
+Gemini 3 tiers (use `--model <alias>`):
 
-Use `gemini-3.1-pro-preview` for strongest reasoning / image analysis.
+- **Fast** (default): `gemini-3-pro`, `fast`, `gemini-2.5-flash`
+- **Thinking**: `thinking`, `gemini-2.5-pro`, `gemini-3.1-thinking`
+- **Pro** (3.1 Pro): `pro`, `gemini-3.1-pro-preview`, `gemini-3.1-pro`
 
-### Gemini fallback
+Unknown model names are passed through to the UI picker best-effort.
 
-Only if headless is unavailable:
+## Workflows
 
 ```bash
-surf gemini "explain quantum computing"
-surf gemini "summarize" --with-page
+surf do 'chatgpt "Draft release notes" --profile dsebban883@gmail.com | gemini "Make it concise" --profile dsebban883@gmail.com'
+surf do 'chatgpt "Review this" --file diff.patch --profile dsebban883@gmail.com' --dry-run
 ```
 
-## AI Studio
+## Sessions & reconciliation
 
-Use when you need latest Gemini model ids and AI Studio-specific behavior.
+Every surf AI command creates a session in `~/.surf/sessions/`.
 
 ```bash
-surf aistudio "review this architecture" --model gemini-3.1-pro-preview
-surf aistudio "summarize this page" --with-page --model gemini-3.1-flash-lite-preview
+surf session
+surf session <id>
+surf session --reconcile
+surf session --reconcile --network
 ```
 
-Preferred ids:
-- `gemini-3.1-pro-preview`
-- `gemini-3.1-flash-lite-preview`
-- `gemini-3.1-flash-image-preview`
-
-## Sessions & Reconciliation
-
-Every surf command creates a session in `~/.surf/sessions/`.
+For long runs, use tmux:
 
 ```bash
-# List sessions
-surf session                    # last 72h
-surf session --hours 1          # last 1h
-surf session --all              # everything
-
-# View session detail
-surf session <session-id>
-
-# Reconcile orphaned sessions (auto-runs on list, or explicit)
-surf session --reconcile              # local PID check only
-surf session --reconcile --network    # + poll ChatGPT API for conversation status
-surf session --reconcile --all        # include old sessions
-
-# Clean up old sessions
-surf session --clear --hours 48       # delete sessions older than 48h
-surf session --clear --all            # delete all
+tmux new -d -s surf-chat "bash -lc 'surf chatgpt \"complex analysis\" --model gpt-5.4-pro --profile dsebban883@gmail.com --timeout 3000 2>&1 | tee /tmp/surf-chatgpt.log'"
+tail -f /tmp/surf-chatgpt.log
 ```
 
-### Session status labels
-
-| Label | Meaning |
-|-------|--------|
-| `✓ completed` | Finished successfully |
-| `✗ error` | Failed (timeout, crash, etc.) |
-| `✗ orphaned` | Worker died without completing — auto-detected by reconciler |
-| `! stale` | PID alive but session > 4h — annotated, not killed |
-| `◌ running` | Active session |
-| `? running` | Network poll says conversation still in progress |
-| `✓ recovered` | Reconciler confirmed conversation completed on ChatGPT side |
-
-Reconciler stores `pid` in session metadata. On list, auto-checks if PID is alive. Dead PID → orphaned. Alive PID → never mutated (even if old).
-
-## Practical rules
-
-- prefer headless for ChatGPT and Gemini
-- default macOS profile: `dsebban883@gmail.com` unless user asks otherwise
-- always use profile-based auth when available
-- use tmux for long jobs
-- treat browser-session AI as UI automation: poll logs, expect latency, verify outputs
-- for ChatGPT search, JSON `partial: true` means recent-window fallback only
-- use `surf session` to check status of long-running jobs
-- `surf session --reconcile` fixes orphaned sessions automatically
+## Troubleshooting
+
+- `--profile` is macOS-only.
+- `--with-page` is not supported.
+- Page-context/browser-extension commands were removed.
+- Default ChatGPT timeout: **2700s**.
+- If auth fails, sign in with the same local profile and retry.
+- Use `surf session <id>` to inspect stderr/result details.


diff --git a/native/chatgpt-cloak-worker.mjs b/native/chatgpt-cloak-worker.mjs
index d3025d3..73c2686 100644
--- a/native/chatgpt-cloak-worker.mjs
+++ b/native/chatgpt-cloak-worker.mjs
@@ -7,10 +7,6 @@
  * Protocol: stdin JSON lines → stdout JSON lines
  *   Input:  { type:"query", prompt, model?, file?, profile?, timeout?, generateImage? }
  *   Output: { type:"progress"|"success"|"error", … }
- *
- * Environment:
- *   CLOAK_HEADLESS  — "0" for headed (default "1")
- *   CLOAK_HUMANIZE  — "0" to disable (default "1")
  */
 
 import { launchPersistentContext } from 'cloakbrowser';
@@ -112,12 +108,10 @@ function tempProfileDir() {
 // Launch options builder
 
 function buildLaunchOpts(userDataDir) {
-  const headless = process.env.CLOAK_HEADLESS !== '0';
-  const humanize = process.env.CLOAK_HUMANIZE !== '0';
   return {
     userDataDir,
-    headless,
-    humanize,
+    headless: true,
+    humanize: true,
     humanPreset: 'careful',
     viewport: { width: 1280, height: 800 },
     locale: 'en-US',
@@ -804,8 +798,8 @@ async function runQuery({ prompt, model, file, profile, timeout = DEFAULT_CHATGP
 
   const context = await launchPersistentContext(buildLaunchOpts(userDataDir));
   log('info', 'CloakBrowser launched', {
-    headless: process.env.CLOAK_HEADLESS !== '0',
-    humanize: process.env.CLOAK_HUMANIZE !== '0',
+    headless: true,
+    humanize: true,
   });
 
   // Cleanup on forced kill
@@ -854,7 +848,7 @@ async function runQuery({ prompt, model, file, profile, timeout = DEFAULT_CHATGP
         fail('login_required',
           useInjectedProfile
             ? `Login failed for profile "${profile}". Session cookie may be expired.`
-            : 'ChatGPT login required. Use --profile <email> or log in via CLOAK_HEADLESS=0.'
+            : 'ChatGPT login required. Use --profile <email> or authenticate the shared ~/.surf/cloak-profile session.'
         );
         return;
       }
@@ -877,7 +871,7 @@ async function runQuery({ prompt, model, file, profile, timeout = DEFAULT_CHATGP
         fail('login_required',
           useInjectedProfile
             ? `Login failed for profile "${profile}". Session cookie may be expired.`
-            : 'ChatGPT login required. Use --profile <email> or log in via CLOAK_HEADLESS=0.'
+            : 'ChatGPT login required. Use --profile <email> or authenticate the shared ~/.surf/cloak-profile session.'
         );
         return;
       }


diff --git a/manifest.json b/manifest.json
deleted file mode 100644
index bd4df03..0000000
--- a/manifest.json
+++ /dev/null
@@ -1,70 +0,0 @@
-{
-  "manifest_version": 3,
-  "name": "Surf",
-  "version": "2.6.0",
-  "description": "Browser automation CLI for AI agents",
-  "options_page": "options/options.html",
-  "icons": {
-    "16": "icons/icon-16.png",
-    "48": "icons/icon-48.png",
-    "128": "icons/icon-128.png"
-  },
-  "action": {
-    "default_title": "Surf CLI",
-    "default_icon": {
-      "16": "icons/icon-16.png",
-      "48": "icons/icon-48.png",
-      "128": "icons/icon-128.png"
-    }
-  },
-  "background": {
-    "service_worker": "service-worker-loader.js",
-    "type": "module"
-  },
-  "content_scripts": [
-    {
-      "matches": ["<all_urls>"],
-      "js": ["content/accessibility-tree.js"],
-      "run_at": "document_start",
-      "all_frames": true
-    },
-    {
-      "matches": ["<all_urls>"],
-      "js": ["content/visual-indicator.js"],
-      "run_at": "document_idle",
-      "all_frames": false
-    }
-  ],
-  "permissions": [
-    "storage",
-    "unlimitedStorage",
-    "activeTab",
-    "scripting",
-    "debugger",
-    "tabs",
-    "tabGroups",
-    "alarms",
-    "notifications",
-    "system.display",
-    "webNavigation",
-    "nativeMessaging",
-    "downloads",
-    "cookies",
-    "bookmarks",
-    "history"
-  ],
-  "host_permissions": ["<all_urls>"],
-  "content_security_policy": {
-    "extension_pages": "script-src 'self'; object-src 'self'; connect-src 'self' https: wss:; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:;"
-  },
-  "web_accessible_resources": [
-    {
-      "matches": ["<all_urls>"],
-      "resources": [
-        "content/accessibility-tree.js",
-        "content/visual-indicator.js"
-      ],
-      "use_dynamic_url": false
-    }
-  ]
-}


diff --git a/native/chatgpt-bun-bridge.cjs b/native/chatgpt-bun-bridge.cjs
index 06a5372..382c992 100644
--- a/native/chatgpt-bun-bridge.cjs
+++ b/native/chatgpt-bun-bridge.cjs
@@ -2,26 +2,15 @@
  * Bridge module: spawns the Bun WebView worker for ChatGPT queries.
  *
  * Handles:
- *  - SURF_USE_BUN_CHATGPT env flag
  *  - Bun executable detection
- *  - Eligibility checks (--with-page → ineligible)
+ *  - Eligibility checks (--with-page is not supported by the headless worker)
  *  - Worker spawn + stdin/stdout JSON protocol
- *  - Structured error / fallback policy
+ *  - Structured errors
  */
 
 const { execFileSync, spawn } = require("child_process");
 const path = require("path");
 
-// ============================================================================
-// Feature flag
-// ============================================================================
-
-function shouldUseBunChatGPT(env) {
-  const flag = (env || process.env).SURF_USE_BUN_CHATGPT;
-  if (!flag) return false;
-  return flag === "1" || flag.toLowerCase() === "true";
-}
-
 // ============================================================================
 // Bun detection
 // ============================================================================
@@ -114,7 +103,7 @@ function buildWorkerRequest(args) {
  * @param {object} args - CLI-parsed tool args
  * @param {object} [opts]
  * @param {number} [opts.timeoutMs] - Kill worker after this many ms
- * @returns {Promise<{ ok: true, result: object } | { ok: false, error: string, code: string, fallbackRecommended: boolean }>}
+ * @returns {Promise<{ ok: true, result: object } | { ok: false, error: string, code: string }>}
  */
 async function runChatGPTViaBun(args, opts = {}) {
   const bunPath = detectBunPath();
@@ -122,8 +111,7 @@ async function runChatGPTViaBun(args, opts = {}) {
     return {
       ok: false,
       code: "bun_not_found",
-      error: "Bun executable not found. Install Bun canary for headless ChatGPT.",
-      fallbackRecommended: true,
+      error: "Bun executable not found. Install Bun for headless ChatGPT.",
     };
   }
 
@@ -163,7 +151,6 @@ async function runChatGPTViaBun(args, opts = {}) {
           ok: false,
           code: "timeout",
           error: `Bun worker killed after ${timeoutMs}ms`,
-          fallbackRecommended: false,
         });
       }
     }, timeoutMs + 5000);
@@ -176,7 +163,6 @@ async function runChatGPTViaBun(args, opts = {}) {
         ok: false,
         code: "spawn_failed",
         error: `Failed to spawn Bun worker: ${err.message}`,
-        fallbackRecommended: true,
       });
     });
 
@@ -193,7 +179,6 @@ async function runChatGPTViaBun(args, opts = {}) {
           ok: false,
           code: "protocol_error",
           error: `Bun worker produced no output (exit ${code}). stderr: ${stderr.slice(0, 300)}`,
-          fallbackRecommended: true,
         });
         return;
       }
@@ -207,14 +192,12 @@ async function runChatGPTViaBun(args, opts = {}) {
             ok: false,
             code: response.code || "unknown",
             error: response.error || "Bun worker error",
-            fallbackRecommended: response.fallbackRecommended ?? false,
           });
         } else {
           resolve({
             ok: false,
             code: "protocol_error",
             error: `Unexpected worker response shape: ${lastLine.slice(0, 200)}`,
-            fallbackRecommended: true,
           });
         }
       } catch (parseErr) {
@@ -222,7 +205,6 @@ async function runChatGPTViaBun(args, opts = {}) {
           ok: false,
           code: "protocol_error",
           error: `Failed to parse worker JSON: ${parseErr.message}. Output: ${lastLine.slice(0, 200)}`,
-          fallbackRecommended: true,
         });
       }
     });
@@ -234,7 +216,6 @@ async function runChatGPTViaBun(args, opts = {}) {
 // ============================================================================
 
 module.exports = {
-  shouldUseBunChatGPT,
   isBunChatGPTEligible,
   runChatGPTViaBun,
   detectBunPath,


diff --git a/native/session-store.cjs b/native/session-store.cjs
index a7e2908..7676250 100644
--- a/native/session-store.cjs
+++ b/native/session-store.cjs
@@ -207,18 +207,11 @@ function createSession(tool, args = {}, env = {}) {
   const dir = path.join(sessionsDir, id);
   try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch {}
 
-  // Capture relevant env flags
-  const envFlags = {};
-  for (const key of ["SURF_USE_BUN_GEMINI","SURF_USE_BUN_CHATGPT","SURF_USE_CLOAK_CHATGPT"]) {
-    if (env[key]) envFlags[key] = env[key];
-  }
-
   const meta = {
     id,
     version:   VERSION,
     tool,
     args:      sanitizeArgs(args),
-    env:       envFlags,
     status:    "running",
     createdAt: new Date().toISOString(),
     _startMs:  Date.now(),
@@ -235,7 +228,6 @@ function createSession(tool, args = {}, env = {}) {
 
   // Write header to output.log
   const cmdPreview = [
-    Object.entries(envFlags).map(([k]) => `${k}=1`).join(" "),
     `surf ${tool}`,
     args.query ? `"${String(args.query).slice(0, 80)}"` : "",
     args.file  ? `--file ${args.file}` : "",


diff --git a/native/session-reconciler.cjs b/native/session-reconciler.cjs
index 9cb1d5b..56d7249 100644
--- a/native/session-reconciler.cjs
+++ b/native/session-reconciler.cjs
@@ -43,12 +43,9 @@ function defaultPidIsAlive(pid) {
   }
 }
 
-/** True when the session was run via CloakBrowser (as opposed to Bun headless). */
+/** True when the session was run via CloakBrowser. ChatGPT is always Cloak in headless-only mode. */
 function isChatGptCloakSession(meta) {
-  return (
-    meta.tool === "chatgpt" &&
-    !!(meta.env && (meta.env.SURF_USE_CLOAK_CHATGPT === "1" || meta.env.SURF_USE_CLOAK_CHATGPT === true))
-  );
+  return meta.tool === "chatgpt" || meta.tool === "chatgpt.reply";
 }
 
 /** Pull the ChatGPT conversation ID out of wherever it may be stored. */

</git_diff>
<meta prompt 1 = "[Review]">
You are reviewing code changes with git diffs included in the prompt. The git diff shows what changed; the file contents show full context. Use both.

**Review Criteria:**

1. **Correctness & Safety**:
	- Do the changes achieve their intended purpose without regressions?
	- Are edge cases and error paths handled?
	- Any security vulnerabilities, race conditions, or resource leaks?
	- Any breaking changes to APIs or contracts?

2. **Design & Complexity**:
	- Do changes increase coupling or reduce separation of concerns?
	- Is new complexity justified, or can the same result be achieved more simply?
	- Are there DRY violations — duplicated logic that should be extracted?
	- Do abstractions sit at the right level (not too early, not too late)?

3. **Intentionality**:
	- Does every change have a clear purpose? Flag accidental modifications or dead code.
	- Are the changes minimal and focused, or is scope creeping in?

**Severity Levels — be disciplined about classification:**
- **P0 (Must fix)**: Bugs, data loss, security holes, crashes — things that break correctness.
- **P1 (Should fix)**: Design issues that will compound — poor separation of concerns, growing complexity, DRY violations, missing error handling for reachable paths.
- **P2 (Consider)**: Style, naming, minor refactoring opportunities, test coverage gaps.

Most findings should be P1 or P2. Reserve P0 for genuinely broken behavior.

**Output Format:**
1. One-paragraph summary of what the changes accomplish.
2. Findings grouped by severity (P0 → P1 → P2), each with: file reference, what's wrong, and a concrete suggestion. Omit empty severity groups.
3. If no issues found at a severity level, skip it — don't pad the review.
</meta prompt 1>
<user_instructions>
<taskname="Headless Refactor Review"/>
<task>
Code review surf-cli headless-only simplification (compare against fork/main). Focus on correctness and regressions from removing extension/provider infrastructure and routing everything to ChatGPT Cloak + Gemini Bun paths. Prioritize findings in routing logic, stale/dead references, missing or misleading help/docs, test coverage gaps, and error-handling regressions.
</task>

<architecture>
- `native/cli.cjs` is command parsing + routing + user-facing help. It now embeds the surf skill doc and routes AI commands through Cloak/Bun or legacy socket fallback.
- ChatGPT runtime path: `native/chatgpt-cloak-bridge.cjs` + `native/chatgpt-cloak-worker.mjs`; optional Bun bridge code still exists in `native/chatgpt-bun-bridge.cjs`.
- Gemini runtime path: `native/gemini-bun-bridge.cjs` (and codemap for `native/gemini-bun-worker.ts`), with model constants in `native/gemini-common.cjs`.
- Workflow and orchestration: `native/do-parser.cjs`, `native/do-executor.cjs`, `native/mcp-server.cjs`, `native/headless-command-runner.cjs`.
- Session lifecycle and reconciliation: `native/session-store.cjs`, `native/session-reconciler.cjs`.
- Behavior contracts/tests: `native/tests/cli-tests.sh` and unit tests under `test/unit/*bridge*`, `do-*`, `mcp-server`, `headless-command-runner`.
- Diff artifacts are selected for core modified files and key removal indicators (`manifest.json`, `native/protocol.cjs`).
</architecture>

<selected_context>
native/cli.cjs (slices): embedded `SURF_SKILL_DOC`, command metadata/help, alias/removal maps, skills command, session command, argument parsing, ChatGPT/Gemini/Cloak/Bun routing, and legacy socket fallback path.
native/chatgpt-cloak-worker.mjs: ChatGPT model alias map and cloak worker behavior.
native/chatgpt-cloak-bridge.cjs: cloak bridge invocation/availability checks.
native/chatgpt-bun-bridge.cjs: remaining Bun ChatGPT eligibility/fallback hooks.
native/gemini-bun-bridge.cjs + native/gemini-common.cjs + codemap(native/gemini-bun-worker.ts): Gemini model selection and Bun bridge path.
native/do-executor.cjs + native/do-parser.cjs: `surf do` parsing/execution after headless-only cleanup.
native/mcp-server.cjs + native/headless-command-runner.cjs: MCP/server and command runner changes for headless-only operation.
native/session-store.cjs + native/session-reconciler.cjs: session state and reconciliation side effects.
native/tests/cli-tests.sh and unit tests (bridges/do-parser/do-executor/mcp-server/headless-runner): regression expectations.
skills/surf/SKILL.md + skills/README.md + README.md + package.json + tsconfig.json + vitest.config.ts: user-facing contract/version/build/test surface.
Diff artifacts: selected per-file patches for the above runtime/test files + `manifest.json.patch` + `native__protocol.cjs.patch`.
</selected_context>

<relationships>
- `cli.cjs` -> (`chatgpt-cloak-bridge.cjs` / `chatgpt-bun-bridge.cjs` / `gemini-bun-bridge.cjs`) decides runtime backend.
- `cli.cjs` -> `do-parser.cjs` -> `do-executor.cjs` for pipeline execution.
- `cli.cjs` -> `mcp-server.cjs` for `surf server`.
- `cli.cjs` -> `session-store.cjs` + `session-reconciler.cjs` for `surf session*` and AI run tracking.
- `chatgpt-cloak-bridge.cjs` delegates to `chatgpt-cloak-worker.mjs`; `gemini-bun-bridge.cjs` delegates to Bun worker logic.
- Tests mirror these contracts (`cli-tests.sh`, bridge tests, do-parser/do-executor tests, mcp-server/headless-runner tests).
</relationships>

<ambiguities>
- `cli.cjs` still contains broad legacy command metadata/help and `startLegacySocketPath()` despite headless-only intent; determine whether these are intentionally retained compatibility paths or stale dead code.
- Some help text/options still mention removed or env-driven behavior (`--with-page`, CLOAK/Bun toggles wording); verify if behavior and docs are fully aligned.
- Large deletion patches for old providers/extension code are not fully selected due token budget; use selected indicators plus current-source references to detect lingering references.
</ambiguities>
</user_instructions>
