## Final Prompt
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

## Selection
- Files: 53 total (50 full, 1 slice, 2 codemap)
- Total tokens: 115072 (Auto view)
- Token breakdown: full 87511, slice 25842, codemap 1719

### Files
### Selected Files
├── _git_data/
│   └── repos/
│       └── surf-cli-3245402f/
│           └── 2026-04-12/
│               └── 0642/
│                   └── diff/
│                       └── per-file/
│                           ├── manifest.json.patch — 492 tokens (full)
│                           ├── native__chatgpt-bun-bridge.cjs.patch — 1,064 tokens (full)
│                           ├── native__chatgpt-bun-worker.ts.patch — 343 tokens (full)
│                           ├── native__chatgpt-cloak-bridge.cjs.patch — 521 tokens (full)
│                           ├── native__chatgpt-cloak-chats-worker.mjs.patch — 160 tokens (full)
│                           ├── native__chatgpt-cloak-worker.mjs.patch — 641 tokens (full)
│                           ├── native__cli.cjs.patch — 5,872 tokens (full)
│                           ├── native__config.cjs.patch — 276 tokens (full)
│                           ├── native__do-executor.cjs.patch — 1,697 tokens (full)
│                           ├── native__do-parser.cjs.patch — 1,541 tokens (full)
│                           ├── native__gemini-bun-bridge.cjs.patch — 1,059 tokens (full)
│                           ├── native__gemini-bun-worker.ts.patch — 808 tokens (full)
│                           ├── native__mcp-server.cjs.patch — 5,463 tokens (full)
│                           ├── native__protocol.cjs.patch — 252 tokens (full)
│                           ├── native__session-reconciler.cjs.patch — 202 tokens (full)
│                           ├── native__session-store.cjs.patch — 289 tokens (full)
│                           ├── native__tests__cli-tests.sh.patch — 2,326 tokens (full)
│                           ├── package.json.patch — 530 tokens (full)
│                           ├── skills__surf__SKILL.md.patch — 3,820 tokens (full)
│                           ├── test__unit__chatgpt-bun-bridge.test.ts.patch — 550 tokens (full)
│                           ├── test__unit__chatgpt-cloak-bridge.test.ts.patch — 736 tokens (full)
│                           ├── test__unit__do-executor.test.ts.patch — 1,277 tokens (full)
│                           └── test__unit__gemini-bun-bridge.test.ts.patch — 563 tokens (full)
├── native/
│   ├── tests/
│   │   └── cli-tests.sh — 1,667 tokens (full)
│   ├── chatgpt-bun-bridge.cjs — 1,736 tokens (full)
│   ├── chatgpt-cloak-bridge.cjs — 2,257 tokens (full)
│   ├── chatgpt-cloak-worker.mjs — 14,453 tokens (full)
│   ├── cli.cjs — 25,842 tokens (lines 1-220 (Top-level imports, embedded SURF_SKILL_DOC constant, prompt-file loader, and workflow helpers that inform headless-only behavior and skill embedding.), 480-700 (Command aliasing/removal map and TOOLS metadata showing potential stale help/options references after headless-only refactor.), 1660-2420 (Headless help surfaces, command list, skills command output, session command handling, and remaining install/extension command branches for stale/dead-code review.), 2880-4344 (Main argument parsing and runtime routing for chatgpt/chatgpt.chats/chatgpt.reply/gemini, Bun/Cloak/legacy fallback logic, and socket fallback path used to detect regressions.))
│   ├── config.cjs — 481 tokens (full)
│   ├── do-executor.cjs — 3,656 tokens (full)
│   ├── do-parser.cjs — 1,229 tokens (full)
│   ├── gemini-bun-bridge.cjs — 1,861 tokens (full)
│   ├── gemini-common.cjs — 1,717 tokens (full)
│   ├── headless-command-runner.cjs — 1,416 tokens (full)
│   ├── mcp-server.cjs — 1,831 tokens (full)
│   ├── session-reconciler.cjs — 3,524 tokens (full)
│   └── session-store.cjs — 4,209 tokens (full)
├── skills/
│   ├── surf/
│   │   └── SKILL.md — 1,336 tokens (full)
│   └── README.md — 195 tokens (full)
├── test/
│   ├── e2e/
│   │   └── chatgpt-cloak-local.test.ts — 297 tokens (full)
│   └── unit/
│       ├── chatgpt-bun-bridge.test.ts — 1,647 tokens (full)
│       ├── chatgpt-cloak-bridge.test.ts — 3,112 tokens (full)
│       ├── do-executor.test.ts — 726 tokens (full)
│       ├── do-parser.test.ts — 2,203 tokens (full)
│       ├── gemini-bun-bridge.test.ts — 1,946 tokens (full)
│       ├── headless-command-runner.test.ts — 1,465 tokens (full)
│       └── mcp-server.test.ts — 1,276 tokens (full)
├── README.md — 2,027 tokens (full)
├── package.json — 401 tokens (full)
├── tsconfig.json — 152 tokens (full)
└── vitest.config.ts — 209 tokens (full)

### Codemaps
native/
├── chatgpt-bun-worker.ts — 892 tokens (manual)
└── gemini-bun-worker.ts — 827 tokens (manual)


---

## Code Review

## Chat Send ✅
- **Chat**: `headless-refactor-review-1F35F3` | **Mode**: review

### Response
Hi Daniel — strong direction; the surface is much cleaner. This refactor moves `surf-cli` from broad extension/browser automation toward a headless AI CLI: embedded skill docs, headless help/listing, MCP/do restricted to ChatGPT/Gemini, ChatGPT defaulting to CloakBrowser, Gemini defaulting to Bun WebView, and extension artifacts/package entries removed. Main risk: several removed extension/provider paths are still routable, and a few public options still imply headed/page-context behavior that no longer works.

## P1 — Should Fix

### `native/headless-command-runner.cjs:97` — `surf do` / MCP relative paths resolve against the surf package, not the caller project

**What’s wrong:**  
`runSurfHeadlessCommand()` forces child CLI processes to run with:

```js
cwd: REPO_ROOT
```

The child `cli.cjs` then resolves `--file`, `--prompt-file`, image outputs, exports, etc. with `path.resolve(...)`. For workflows and MCP calls, relative paths like `diff.patch`, `prompt.md`, or `workflow.json` will resolve under the installed `surf-cli` package instead of the user’s current project.

This breaks documented/core examples such as:

```bash
surf do 'chatgpt "Review this" --file diff.patch --profile user@gmail.com'
```

and MCP `promptFile` / `file` arguments when clients pass project-relative paths.

**Suggestion:**  
Default the runner cwd to the caller cwd:

```js
cwd: options.cwd || process.cwd()
```

Then thread `cwd` through `do-executor` and MCP as needed. Add a regression test where a temp cwd contains `prompt.md` / `diff.patch` and the spawned argv resolves from that cwd.

---

### `native/cli.cjs:503`, `native/cli.cjs:3650`, `native/cli.cjs:3900` — `--with-page` is still advertised/routed despite being unsupported

**What’s wrong:**  
Help still lists `--with-page` for `chatgpt` and `gemini`, while the embedded skill says it is unsupported.

Runtime behavior is inconsistent:

- `surf chatgpt "summarize" --with-page` without `--profile` is routed to Cloak and the flag is effectively ignored, so the user gets a normal prompt response, not page context.
- `surf gemini "summarize" --with-page` makes Bun ineligible and falls into `startLegacySocketPath()`, despite extension infrastructure being removed.
- `surf gemini ... --profile ...` with Bun unavailable can emit the wrong error: `--profile cannot be used with --with-page`, even when the real reason is `bun_not_found`.

**Suggestion:**  
For headless-only mode, fail fast before routing:

```js
if ((tool === "chatgpt" || tool === "gemini") && (toolArgs["with-page"] || toolArgs.withPage)) {
  console.error("Error: --with-page is not supported in headless-only mode");
  process.exit(1);
}
```

For Gemini, also fail fast on `bun_not_found` / unsupported platform instead of using the legacy socket fallback.

---

### `native/cli.cjs:530`, `native/cli.cjs:3140`, `native/chatgpt-cloak-worker.mjs:108`, `native/chatgpt-cloak-chats-worker.mjs:54` — `--continue` / headed Cloak mode is now a no-op

**What’s wrong:**  
`chatgpt.chats` and `chatgpt.reply` help still advertise:

```txt
--continue  Run in headed CloakBrowser
```

`cli.cjs` still has `withOptionalHeadedCloak()` that sets `CLOAK_HEADLESS=0`, but both Cloak workers now hardcode:

```js
headless: true,
humanize: true,
```

So `--continue` silently does nothing. This is especially risky because the removed headed retry path used to recover some `chatgpt.chats get` failures.

**Suggestion:**  
Either:

1. remove `--continue` from help/parsing and reject it explicitly in headless-only mode, or  
2. restore env-driven launch options if headed mode is still a supported escape hatch.

Add a CLI/unit test that proves `--continue` is rejected or actually changes launch options.

---

### `native/cli.cjs:2180`, `native/cli.cjs:2205`, `native/cli.cjs:2240`, `package.json:27` — extension install/path commands remain but required artifacts are removed from the package

**What’s wrong:**  
The refactor deletes `manifest.json`, removes `scripts/` and `dist/` from `package.json.files`, and hides extension commands from top-level help. But `cli.cjs` still supports:

- `surf extension-path` / `surf path`
- `surf install <extension-id>`
- `surf uninstall`
- many legacy socket-backed commands through `startLegacySocketPath()`

`surf install <id>` now attempts to spawn:

```js
../scripts/install-native-host.cjs
```

which is no longer shipped. `surf extension-path` returns `../dist`, which is also no longer shipped.

**Suggestion:**  
If extension support is intentionally removed, remove these command branches and return a clear “removed in headless-only mode” error. If extension compatibility is intentionally retained, keep the required `scripts/`, `dist/`, and manifest artifacts packaged and covered by tests.

---

### `native/chatgpt-bun-worker.ts:1`, `native/gemini-bun-worker.ts:1`, `native/gemini-bun-worker.ts:917` — removing `bun-webview.d.ts` likely breaks `npm run check`

**What’s wrong:**  
Both Bun workers replaced:

```ts
/// <reference path="./bun-webview.d.ts" />
```

with:

```ts
declare const Bun: any;
```

But the Gemini worker still uses the `WebView` type, e.g.:

```ts
async function activateCreateImageTool(wv: WebView, ...)
```

`tsconfig.json` includes `native/**/*.ts`, so `tsc --noEmit` will likely fail with `Cannot find name 'WebView'`.

**Suggestion:**  
Restore the reference, import/provide a real `WebView` type, or add a local fallback type:

```ts
type WebView = any;
```

Then ensure `npm run check` is part of the required verification for this branch.

## P2 — Consider

### `native/cli.cjs:9`, `native/cli.cjs:3799`, `native/chatgpt-bun-bridge.cjs:216` — stale ChatGPT Bun routing code references removed exports/contracts

**What’s wrong:**  
`cli.cjs` still imports `shouldUseBunChatGPT`, but `chatgpt-bun-bridge.cjs` no longer exports it. The later Bun ChatGPT block is currently unreachable because `tool === "chatgpt"` returns after Cloak routing, but the dead block still checks removed concepts like `fallbackRecommended`.

This is not currently user-visible, but it is confusing and fragile: any future routing tweak could turn this into `TypeError: shouldUseBunChatGPT is not a function`.

**Suggestion:**  
If ChatGPT is Cloak-only now, remove the Bun ChatGPT import and unreachable routing block. If Bun remains a supported fallback, restore the feature flag export and tests.

---

### `native/cli.cjs:480`, `native/cli.cjs:1660`, `native/cli.cjs:2880` — hidden legacy command metadata still leaks stale behavior

**What’s wrong:**  
Top-level `--help-full` and `--list` now show only headless commands, but `TOOLS`, `ALL_SOCKET_TOOLS`, `SEE_ALSO`, `REMOVED_COMMANDS`, and `startLegacySocketPath()` still preserve a large old browser/provider surface. As a result, commands like these can still produce old help or socket errors:

```bash
surf screenshot --help
surf tab
surf perplexity --help
surf --about tab
```

That conflicts with the headless-only contract and makes failures look like local extension setup problems.

**Suggestion:**  
Add a single supported-command gate after parsing. For unsupported legacy commands, print a clear removed/headless-only error. Then delete or quarantine stale `TOOLS` groups so command help cannot advertise removed capabilities.

---

### `native/tests/cli-tests.sh`, `test/unit/headless-command-runner.test.ts`, `test/unit/mcp-server.test.ts` — missing tests for the highest-risk routing regressions

**What’s missing:**  
Current tests cover some help/listing and bridge behavior, but not the most failure-prone headless-only transitions:

- `surf chatgpt "x" --with-page` should fail clearly.
- `surf gemini "x" --with-page` should not use legacy socket fallback.
- `surf gemini "x"` with Bun unavailable should show a Bun-specific error, not socket/extension guidance.
- `surf do ... --file relative-path` should resolve relative to the caller cwd.
- MCP `promptFile` / `file` should preserve caller/project-relative paths.
- `surf install`, `surf extension-path`, and a removed browser command should either work with packaged artifacts or fail as removed.

**Suggestion:**  
Add focused CLI/unit tests around these routing contracts. These will catch most regressions from the extension/provider removal without needing real ChatGPT/Gemini E2E runs.


> 💡 Continue this review conversation with ask_oracle(chat_id: "headless-refactor-review-1F35F3", new_chat: false)