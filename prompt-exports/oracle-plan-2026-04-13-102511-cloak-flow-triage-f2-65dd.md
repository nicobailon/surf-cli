## Final Prompt
<taskname="Cloak flow triage"/>
<task>Address three linked ChatGPT CloakBrowser issues in surf-cli: (1) Chromium launch abort on macOS from stale profile lock and launch args, (2) stale workflow env vars (`SURF_USE_CLOAK_CHATGPT`, inert `CLOAK_HEADLESS` usage assumptions), and (3) polling/recovery instability including double-send risk and missing assistant content during recovery/export timing.</task>

<architecture>ChatGPT Cloak path is `cli.cjs` → `chatgpt-cloak-bridge.cjs` → `chatgpt-cloak-worker.mjs` (query) and `chatgpt-cloak-chats-worker.mjs` (conversation API). Prompt insertion/verification is isolated in `chatgpt-cloak-prompt-entry.cjs`; activity/poll gating is in `chatgpt-cloak-timeout.cjs`; post-crash recovery is in `session-reconciler.cjs` and uses `chatgpt-chats-formatter.cjs` for extracted assistant payload + markdown export. Unit tests in `test/unit/*` cover bridge mapping, timeout activity detection, prompt insertion paths, formatter active-path behavior, and reconcile outcomes.</architecture>

<selected_context>
native/chatgpt-cloak-worker.mjs: `sharedProfileDir()`, `buildLaunchOpts()`, `runQuery()` send/checkpoint/phase-6 polling/thinking trace logic; emits `meta_update` and validates prompt persistence.
native/chatgpt-cloak-chats-worker.mjs: known-good stale `SingletonLock` cleanup in `sharedProfileDir()`; `buildLaunchOpts()`; `apiGetConversation()`/`runAction()` used for recovery exports.
native/chatgpt-cloak-bridge.cjs: worker spawn protocol, timeout reset behavior, forwarding of `trace`/`meta_update`, `queryWithCloakBrowser()` and `manageChatsWithCloakBrowser()`.
native/chatgpt-cloak-prompt-entry.cjs: insertion strategy/fallbacks and send-readiness metrics returned to worker before send click/Enter branch.
native/chatgpt-cloak-prompt-validation.cjs: `evaluatePromptPersistence()` and latest-user-node checks used to guard against wrong materialization.
native/chatgpt-cloak-timeout.cjs: `detectResponseActivity()` and keepalive/phase normalization controlling polling deadlines.
native/session-reconciler.cjs: `hasSentCheckpoint()`, network poll gate, `inspectConversation()`, recovered assistant payload persistence.
native/chatgpt-chats-formatter.cjs: active-path conversation walk and markdown rendering used by `chatgpt.chats` export and reconcile payload extraction.
native/cli.cjs: routing, `withOptionalHeadedCloak()`, chatgpt/chats direct execution wrappers, session reconcile command and network poll flags.
test/unit/chatgpt-cloak-bridge.test.ts: progress/meta/trace forwarding and timeout/exit expectations.
test/unit/chatgpt-cloak-prompt-entry.test.ts: prompt insertion + send readiness semantics.
test/unit/chatgpt-cloak-timeout.test.ts: baseline-turn + thinking label churn activity detection.
test/unit/session-reconciler.test.ts: sent-checkpoint gating, recovery/orphan/unresolved/poll-failed paths.
test/unit/chatgpt-chats-formatter.test.ts: active-path vs full-tree message rendering behavior.
docs/investigations/rp-surf-oracle-missing-reply-recovery.md: confirms current recovery flow and observed missing local assistant body before later chats export.
docs/investigations/surf-chats-profile-lock.md: prior lock/profile findings for chats worker.
README.md: user-facing command/env documentation that may need sync with workflow/env changes.
</selected_context>

<relationships>
- `cli.cjs` `runChatGptCloakQueryDirect()` calls `queryWithCloakBrowser()`; current call path always uses `withOptionalHeadedCloak(false, ...)`.
- `chatgpt-cloak-bridge.cjs` forwards worker `meta_update` (`lastCheckpoint`, `sentAt`, `conversationId`, baseline assistant id) back to CLI session metadata.
- `chatgpt-cloak-worker.mjs` sets sent checkpoint immediately after send trigger and then runs conversation-id/prompt-persistence validation before response polling.
- `session-reconciler.cjs` only network-polls dead sessions when `pollNetwork && hasSentCheckpoint(meta) && conversationId`.
- Recovery poll fetches conversation via chats bridge/worker (`manageChatsWithCloakBrowser({action:'get'})`), then formatter-derived assistant text is stored via session-store artifact path.
- `chatgpt.chats` exports are rendered by `chatgpt-chats-formatter.cjs`; output depends on `current_node` active-path traversal timing.
- Lock cleanup implementation in chats worker is the concrete reference to port into query worker shared profile handling.
</relationships>

<ambiguities>
- External workflow file to edit for env cleanup (`~/Library/Application Support/RepoPrompt/Workflows/surf-gpt-pro-oracle.md`) is not in the loaded RepoPrompt root (`/Users/danielsivan/dev/surf-cli`) and is therefore not included in selection.
- “Double-send” appears session-observed; code currently has mutually exclusive send paths (button click OR Enter), so root cause may involve state timing around send readiness/selector behavior rather than obvious explicit dual-send code.
- “chatgpt.chats export only user message” can be timing-related when `current_node` has not advanced to assistant yet; formatter intentionally follows active path and will omit assistant if not on active node at fetch time.
</ambiguities>

## Selection
- Files: 17 total (17 full)
- Total tokens: 100913 (Auto view)
- Token breakdown: full 100913

### Files
### Selected Files
├── docs/
│   └── investigations/
│       ├── rp-surf-oracle-missing-reply-recovery.md — 1,561 tokens (full)
│       └── surf-chats-profile-lock.md — 893 tokens (full)
├── native/
│   ├── chatgpt-chats-formatter.cjs — 2,192 tokens (full)
│   ├── chatgpt-cloak-bridge.cjs — 2,257 tokens (full)
│   ├── chatgpt-cloak-chats-worker.mjs — 8,074 tokens (full)
│   ├── chatgpt-cloak-prompt-entry.cjs — 7,262 tokens (full)
│   ├── chatgpt-cloak-prompt-validation.cjs — 1,251 tokens (full)
│   ├── chatgpt-cloak-timeout.cjs — 736 tokens (full)
│   ├── chatgpt-cloak-worker.mjs — 14,453 tokens (full)
│   ├── cli.cjs — 39,120 tokens (full)
│   └── session-reconciler.cjs — 3,524 tokens (full)
├── test/
│   └── unit/
│       ├── chatgpt-chats-formatter.test.ts — 1,631 tokens (full)
│       ├── chatgpt-cloak-bridge.test.ts — 3,112 tokens (full)
│       ├── chatgpt-cloak-prompt-entry.test.ts — 5,702 tokens (full)
│       ├── chatgpt-cloak-timeout.test.ts — 1,128 tokens (full)
│       └── session-reconciler.test.ts — 5,990 tokens (full)
└── README.md — 2,027 tokens (full)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `cloak-flow-triage-F2F810` | **Mode**: plan

### Response
Hi Daniel — good news: this is a tight, local fix set, not a rewrite.



# 1. **Summary**

This should be handled as a **targeted coordinated change**, not a broad refactor: extract the already-proven profile/launch handling into one shared Cloak runtime helper, remove dead env-toggle behavior from `cli.cjs`, make query “sent” checkpointing authoritative only after prompt persistence is confirmed, and add assistant-turn wait polling to `chatgpt.chats get` for recovery/export flows. That reuses the existing separation of concerns (`cli.cjs` routing, `chatgpt-cloak-bridge.cjs` worker protocol, query/chats workers, prompt validation, session reconciliation) while fixing the three linked failures without creating parallel code paths.

# 2. **Current-state analysis**

## ChatGPT query path today

End-to-end call chain:

`native/cli.cjs`  
→ `runChatGptCloakQueryDirect()`  
→ `queryWithCloakBrowser()` in `native/chatgpt-cloak-bridge.cjs`  
→ `runCloakWorker()` spawns `native/chatgpt-cloak-worker.mjs`  
→ worker launches CloakBrowser, inserts prompt, sends, validates, polls response  
→ worker emits JSON lines (`progress`, `trace`, `meta_update`, `success`, `error`)  
→ CLI progress callback updates session metadata via `sess.update()` / `sess.finish()` / `sess.fail()`.

Relevant ownership/mutation points:

- `cli.cjs` owns process env, CLI routing, stderr logging, and session persistence.
- `chatgpt-cloak-bridge.cjs` owns child-process lifecycle and worker timeout reset rules.
- `chatgpt-cloak-worker.mjs` owns browser/page state and send/poll logic.
- `chatgpt-cloak-prompt-entry.cjs` owns prompt insertion only; it does **not** decide when a send is valid.
- `chatgpt-cloak-prompt-validation.cjs` already provides the authoritative “did the prompt actually persist” check and should be reused.

## ChatGPT chats/recovery/export path today

End-to-end call chain:

`native/cli.cjs`  
→ `runChatGptChatsDirect()`  
→ `manageChatsWithCloakBrowser()` in `native/chatgpt-cloak-bridge.cjs`  
→ `native/chatgpt-cloak-chats-worker.mjs`  
→ API-direct GET/search/list/etc using `context.request`  
→ `chatgpt-chats-formatter.cjs` renders active-path markdown/list output.

Recovery path:

`native/cli.cjs` `surf session --reconcile --network`  
→ `native/session-reconciler.cjs`  
→ `manageChatsWithCloakBrowser({ action: "get" })`  
→ chats worker returns one conversation snapshot  
→ `inspectConversation()` decides `completed` / `in_progress` / `no_new_assistant` / `ambiguous`  
→ on `completed`, `extractRecoveredAssistantPayload()` + session artifact persistence.

## What is already reusable

- `chatgpt-cloak-chats-worker.mjs` already contains the only existing stale `SingletonLock` cleanup logic in `sharedProfileDir()`. That is the concrete implementation to reuse for query launches.
- `chatgpt-cloak-prompt-validation.cjs` already detects whether the user message actually advanced and persisted correctly. That should become the send confirmation gate.
- `chatgpt-chats-formatter.cjs` active-path traversal is correct for final rendering; the problem is timing of the snapshot, not the formatter.
- `session-reconciler.cjs` already persists recovered assistant content to an artifact path; the remaining problem is unstable/too-early conversation snapshots.

## What is blocking today

### 1) Launch abort / stale lock drift

- `native/chatgpt-cloak-worker.mjs` has its own `sharedProfileDir()` and **does not** clean stale `SingletonLock`.
- `native/chatgpt-cloak-chats-worker.mjs` does clean stale `SingletonLock`.
- Both workers duplicate `buildLaunchOpts()`.
- Query worker launches the persistent context **before** entering its inner `try/catch`, so launch failures bypass its normal error mapping/cleanup path.

### 2) Dead env contract

- `SURF_USE_CLOAK_CHATGPT` is not read anywhere in the shown code.
- `cli.cjs` still carries `withOptionalHeadedCloak()`, which mutates `CLOAK_HEADLESS`, but every ChatGPT call site passes `false`, so the helper is inert and misleading.
- Bridge workers inherit `process.env` as-is, so stale env vars silently survive into child processes.

### 3) Polling / recovery instability

- Query worker emits `meta_update` with `lastCheckpoint: "sent"` **immediately after triggering send**, before prompt persistence validation succeeds.
- If a send button click actually triggers send but throws during the click path, the code can fall through to another selector or `Enter`, creating a real duplicate-send risk.
- `session-reconciler.cjs` trusts `hasSentCheckpoint(meta)` to decide whether network recovery should run.
- `chatgpt-cloak-chats-worker.mjs` `get` is single-shot. If called while `current_node` is still the user turn, export/recovery sees an incomplete conversation.
- `chatgpt-chats-formatter.cjs` intentionally follows `current_node`; if the snapshot is early, export will correctly omit the assistant because it is not on the active path yet.

## Hard constraints

- Worker protocol is JSON-lines over stdio; keep additive-compatible message shapes.
- CLI is headless-only; no headed fallback should be reintroduced.
- Session metadata is CLI-owned; workers only emit progress/meta events.
- `session-reconciler.cjs` must remain safe for legacy sessions with missing checkpoint fields.
- No persistence schema migration is required unless new persisted fields are introduced; avoid that.
- `chatgpt-cloak-timeout.cjs` timeout reset semantics in the bridge must remain unchanged unless a worker emits a supported activity event.

# 3. **Design**

## A. Shared Cloak runtime bootstrap

### New component

**`native/chatgpt-cloak-runtime.cjs`** — internal stateless helper module.

Use CJS so:

- unit tests can `require()` it directly,
- both `.cjs` and `.mjs` callers can reuse it via `require` / `createRequire`.

### Responsibilities

Own the shared filesystem + launch bootstrap logic currently duplicated across both workers:

- `sharedProfileDir()`
- `tempProfileDir()`
- `buildLaunchOpts(userDataDir)`
- stale singleton cleanup
- launch retry/error normalization for lock-related failures

### Interface shape

Partial shape:

```js
sharedProfileDir({ log? }) => string
tempProfileDir() => string
buildLaunchOpts(userDataDir) => LaunchOptions
isRecoverableProfileLaunchError(error) => boolean
launchPersistentContextWithRecovery({
  launchPersistentContext,
  userDataDir,
  isSharedProfile,
  log,
}) => Promise<context>
```

### Behavior

1. `sharedProfileDir()`:
   - create `~/.surf/cloak-profile` if missing,
   - run stale-lock cleanup before returning.
2. Cleanup logic:
   - port the exact `SingletonLock` cleanup behavior from `chatgpt-cloak-chats-worker.mjs`,
   - keep it idempotent,
   - log what was removed.
3. `launchPersistentContextWithRecovery()`:
   - attempt launch once,
   - on a lock-related failure and `isSharedProfile === true`, rerun cleanup and retry once,
   - if retry still fails, rethrow a normalized error with a stable code like `profile_locked` and `userDataDir` in details.

### Why this is enough

This is the smallest refactor that removes the current drift between query and chats workers without changing the higher-level bridge or CLI architecture.

### Unknown to validate during implementation

The only lock artifact proven in the current repo is `SingletonLock`. During implementation, validate the actual failing macOS abort message and profile contents from the repro. If Cloak/Chromium also leaves additional singleton artifacts in this profile, extend the helper in the same file with an explicit allowlist based on that repro, not speculation.

## B. CLI env contract cleanup

### Modified component

**`native/cli.cjs`**

### Changes

1. Remove `withOptionalHeadedCloak()`.
   - It is dead code semantically; all current call sites pass `false`.
2. Add a top-level env sanitizer, e.g. `normalizeLegacyChatGptEnv()`.
   - Strip `SURF_USE_CLOAK_CHATGPT` from `process.env`.
   - Strip `CLOAK_HEADLESS` from `process.env`.
3. Warning behavior:
   - if `CLOAK_HEADLESS` was explicitly set to a headed value (`0`, `false`), print a stderr warning that headed Cloak mode is unsupported and the env var is ignored.
   - if `SURF_USE_CLOAK_CHATGPT` is present, ignore silently unless `SURF_DEBUG` is enabled; it is obsolete and should not affect normal JSON consumers.

### Data flow

Trigger: CLI startup before routing.

Path:

`process.env`  
→ env normalization in `cli.cjs`  
→ sanitized env inherited by `chatgpt-cloak-bridge.cjs` workers and Bun bridge children.

### Call-site updates

Replace:

- `withOptionalHeadedCloak(false, () => queryWithCloakBrowser(...))`
- `withOptionalHeadedCloak(false, () => manageChatsWithCloakBrowser(...))`

with direct calls.

### Error/degraded behavior

No failure for stale env vars; they are ignored. Only headed-mode intent should produce a visible warning.

## C. Query send confirmation and authoritative checkpointing

### Modified component

**`native/chatgpt-cloak-worker.mjs`**

### Reuse, not replacement

Do **not** move prompt insertion logic into another layer. Keep using:

- `enterPromptWithVerification()` from `chatgpt-cloak-prompt-entry.cjs`
- `waitForPromptPersistenceValidation()` built on `chatgpt-cloak-prompt-validation.cjs`

The fix belongs in the worker’s orchestration around send, not in the insertion helper.

### New internal helper flow

Add a worker-local helper, conceptually:

```js
attemptSendAndConfirm({
  page,
  textarea,
  promptEntry,
  finalPrompt,
  conversationId,
  baselineUserNodeId,
  baselineAssistantMessageId,
}) => Promise<{
  method: "click" | "enter",
  conversationId: string | null,
  sentAt: string,
  validation
}>
```

### Algorithm

1. Capture baselines exactly as today:
   - latest active user node id for existing conversations,
   - baseline assistant turn/message id/text.
2. Try send button clicks only if `promptEntry.sendEnabled === true`.
3. After **each** click attempt:
   - treat both success and thrown-click cases as “attempted”, not “failed”,
   - run a short confirmation probe before trying any other send method.
4. Confirmation probe order:
   - short URL poll for conversation id appearance,
   - if conversation id exists, short prompt persistence validation (`waitForPromptPersistenceValidation`) against `finalPrompt`,
   - otherwise short DOM send-start checks only (`stop` visible, composer cleared, prompt no longer matches).
5. Only if the click attempt is unconfirmed after the short probe may the worker try the next selector or `Enter`.
6. `Enter` fallback gets the same confirmation probe.
7. If no method confirms send, fail with a dedicated code like `send_not_confirmed`.
8. **Move the authoritative `meta_update` emission** to after prompt persistence validation succeeds.
   - Emit one `meta_update` with:
     - `lastCheckpoint: "sent"`
     - `sentAt`
     - final resolved `conversationId`
     - `baselineAssistantMessageId`
     - source like `prompt_persisted`
   - remove the current pre-validation `post_send` checkpoint and the separate `conversation_resolved` checkpoint.

### Why this fixes the double-send risk

The current risk is not an explicit double-send branch; it is the “click may have worked but threw, then fallback fires again” timing hole. Confirmation between attempts closes that hole.

### Data flow after change

Trigger: prompt insertion completes.

Path:

`enterPromptWithVerification()` result  
→ worker send attempt  
→ confirmation via prompt persistence + URL/DOM probes  
→ authoritative `meta_update` to bridge  
→ CLI `sess.update()` persists sent checkpoint  
→ phase-6 response polling

### Ordering / dropped-event behavior

- If worker crashes before the authoritative `meta_update`, session metadata still lacks checkpoint fields; `session-reconciler.hasSentCheckpoint()` already treats that as legacy/unknown and can still poll when `conversationId` exists.
- No early false-positive “sent” state is persisted.

### Concurrency/lifecycle

Everything remains single-threaded in the worker event loop. No new shared mutable state across processes.

### Error handling

Possible failures:

- click path unconfirmed,
- Enter path unconfirmed,
- conversation id never resolves,
- prompt persists incorrectly (`file_map_placeholder`, `big_paste_attachment`, mismatch).

All should fail before phase 6 begins.

## D. Conversation-state classification and assistant wait polling

### New component

**`native/chatgpt-conversation-state.cjs`** — pure helper module for current-node classification.

### Why a new helper is justified

This logic is currently implicit and duplicated across:

- chats worker timing needs,
- session reconciler outcome mapping.

It is state classification, not formatting and not prompt validation.

### Interface shape

```js
classifyConversationProgress(conversation, {
  baselineAssistantMessageId = null,
}) => {
  state:
    | "assistant_complete"
    | "assistant_complete_baseline"
    | "assistant_in_progress"
    | "awaiting_assistant"
    | "invalid",
  nodeId,
  role,
  status,
  hasText,
  model,
}
```

### Variant definitions

- `assistant_complete`: `current_node` is assistant and terminal/successful, and not the baseline assistant.
- `assistant_complete_baseline`: `current_node` is assistant terminal/successful but still the known baseline assistant.
- `assistant_in_progress`: `current_node` is assistant but nonterminal/in progress.
- `awaiting_assistant`: `current_node` is the user turn; assistant has not attached yet.
- `invalid`: missing/ill-formed conversation state.

### Modified component: chats worker

**`native/chatgpt-cloak-chats-worker.mjs`**

Extend `get` action internals only.

#### API change

Before:

```js
apiGetConversation(context, accessToken, conversationId)
```

After:

```js
apiGetConversation(context, accessToken, conversationId, {
  waitForAssistant = false,
  waitForAssistantTimeoutSec = 30,
  baselineAssistantMessageId = null,
})
```

#### Worker request additions

Bridge request payload for `type: "chats"` gains additive internal fields:

- `waitForAssistant?: boolean`
- `waitForAssistantTimeoutSec?: number`
- `baselineAssistantMessageId?: string | null`

#### Polling algorithm

When `waitForAssistant` is false:
- current single GET behavior.

When `waitForAssistant` is true:
1. GET conversation.
2. Classify with `classifyConversationProgress()`.
3. Continue polling every ~1s while state is one of:
   - `awaiting_assistant`
   - `assistant_in_progress`
   - `assistant_complete_baseline`
4. Stop immediately on:
   - `assistant_complete`
   - `invalid`
   - timeout
5. Return the last snapshot plus additive metadata:
   - `stabilized: boolean`
   - `conversationState`
   - `waitedMs`

### CLI routing changes

**`native/cli.cjs`**

Set `waitForAssistant: true` automatically for:

- `chatgpt.chats <id> --export ...`
- session reconcile network GETs

Keep plain `chatgpt.chats <id>` immediate by default.

If a waited export returns `stabilized: false`, emit a stderr warning that the export may still be incomplete.

### Why formatter does not change

`chatgpt-chats-formatter.cjs` active-path rendering is correct once `current_node` is correct. Fix the snapshot timing, not the renderer.

## E. Reconciler integration and outcome mapping

### Modified component

**`native/session-reconciler.cjs`**

### Changes

1. Replace current-node ad hoc inspection with `classifyConversationProgress()`.
2. Update `inspectConversation()` mapping:
   - `assistant_complete` → `completed`
   - `assistant_complete_baseline` → `no_new_assistant`
   - `assistant_in_progress` → `in_progress`
   - `awaiting_assistant` → `in_progress`
   - `invalid` → `ambiguous`
3. When polling network:
   - call `manageChatsWithCloakBrowser({
       action: "get",
       conversationId,
       profile,
       timeout: 30,
       waitForAssistant: true,
       waitForAssistantTimeoutSec: 30,
       baselineAssistantMessageId: meta.baselineAssistantMessageId || null,
     })`

### Why `awaiting_assistant` should map to `in_progress`

For a dead session with a confirmed send, a current user node means “assistant not attached yet”, not “definitely no new assistant forever”. Marking that orphaned is what makes recovery unstable.

### Persistence impact

No schema migration. Existing persisted session fields remain valid.

Possible additive reconcile metadata:
- `reconcile.remote.outcome` may now reflect the refined state path more accurately, but that is internal/additive.

## F. Tests and docs

### Tests

#### New
- **`test/unit/chatgpt-cloak-runtime.test.ts`**
  - stale `SingletonLock` symlink cleanup
  - unreadable/non-symlink cleanup fallback
  - retry-on-lock-related-launch-error only for shared profile
- **`test/unit/chatgpt-conversation-state.test.ts`**
  - baseline assistant vs new assistant
  - user current node → `awaiting_assistant`
  - assistant in progress
  - invalid mapping/current_node

#### Modified
- **`test/unit/chatgpt-cloak-bridge.test.ts`**
  - assert chats request passes `waitForAssistant`, `waitForAssistantTimeoutSec`, `baselineAssistantMessageId`
  - existing meta/trace forwarding tests stay; no worker-protocol break
- **`test/unit/session-reconciler.test.ts`**
  - update expected `manageChats` arguments
  - role-user/current-user recoveries now become `unresolved`, not orphaned
  - baseline assistant polling path
- **`test/e2e/chatgpt-cloak-local.test.ts`** (if local-auth CI/manual harness supports it)
  - one prompt send results in exactly one new user turn
  - immediate export after reply waits for assistant and includes it

### Docs

#### `README.md`
Update:
- ChatGPT always uses CloakBrowser in headless mode.
- `SURF_USE_CLOAK_CHATGPT` is obsolete.
- `CLOAK_HEADLESS` does not enable headed mode.
- `chatgpt.chats --export` waits briefly for a pending assistant turn before rendering.

#### `native/cli.cjs`
Update embedded `SURF_SKILL_DOC` text to match README so agent-facing docs do not preserve stale env assumptions.

### Out-of-repo follow-up

The workflow file mentioned in the prompt (`~/Library/Application Support/RepoPrompt/Workflows/surf-gpt-pro-oracle.md`) is outside this repo/context. After landing the repo changes, remove the stale env vars there manually.

# 4. **File-by-file impact**

## `native/chatgpt-cloak-runtime.cjs` **(new)**
- Add shared profile-dir creation, stale lock cleanup, launch option builder, lock-error retry classification.
- Why: eliminate query/chats drift; make launch failure handling consistent.
- Depends on: none.

## `native/chatgpt-conversation-state.cjs` **(new)**
- Add pure conversation current-node classifier with baseline-aware states.
- Why: shared timing/recovery semantics for chats worker and reconciler.
- Depends on: `chatgpt-chats-formatter.cjs` text extraction helpers if reused.

## `native/chatgpt-cloak-worker.mjs`
- Replace local `sharedProfileDir()`, `tempProfileDir()`, `buildLaunchOpts()` usage with shared runtime helper.
- Move context launch into handled try path.
- Add send-attempt confirmation helper.
- Emit `meta_update` only after prompt persistence validation succeeds.
- Remove early false-positive sent checkpoint flow.
- Why: fix stale-lock launch abort, double-send window, and bad reconcile gating.
- Depends on: `chatgpt-cloak-runtime.cjs`; reuses existing prompt-entry/prompt-validation modules.

## `native/chatgpt-cloak-chats-worker.mjs`
- Replace duplicated profile/launch helpers with shared runtime helper.
- Extend `get` action to support assistant wait polling.
- Include additive response metadata (`stabilized`, `conversationState`, `waitedMs`).
- Why: fix export/recovery timing and keep query/chats launch behavior aligned.
- Depends on: `chatgpt-cloak-runtime.cjs`, `chatgpt-conversation-state.cjs`.

## `native/chatgpt-cloak-bridge.cjs`
- Pass through new chats request fields:
  - `waitForAssistant`
  - `waitForAssistantTimeoutSec`
  - `baselineAssistantMessageId`
- No protocol break; additive only.
- Why: bridge must carry the new internal wait/poll controls from CLI/reconciler to chats worker.
- Depends on: worker request shape changes.

## `native/session-reconciler.cjs`
- Replace current `inspectConversation()` internals with `chatgpt-conversation-state.cjs`.
- Treat `awaiting_assistant` as unresolved/in-progress.
- Pass assistant-wait options into `manageChats`.
- Why: stop orphaning recoverable sessions and wait for assistant materialization before deciding.
- Depends on: `chatgpt-conversation-state.cjs`, bridge/chats-worker request support.

## `native/cli.cjs`
- Add env sanitization for obsolete ChatGPT/Cloak env vars.
- Remove `withOptionalHeadedCloak()`.
- Direct-call query/chats bridge functions.
- Set `waitForAssistant` automatically for `chatgpt.chats ... --export`.
- Emit export warning when stabilization timed out.
- Update embedded `SURF_SKILL_DOC`.
- Why: remove dead env contract and wire new export stabilization behavior.
- Depends on: bridge/chats-worker additive request support.

## `test/unit/chatgpt-cloak-runtime.test.ts` **(new)**
- Unit-test stale lock cleanup and retry mapping.
- Why: pure regression coverage for issue (1).
- Depends on: `native/chatgpt-cloak-runtime.cjs`.

## `test/unit/chatgpt-conversation-state.test.ts` **(new)**
- Unit-test baseline-aware conversation classification.
- Why: pure regression coverage for issue (3).
- Depends on: `native/chatgpt-conversation-state.cjs`.

## `test/unit/chatgpt-cloak-bridge.test.ts`
- Add request-shape assertions for assistant-wait fields.
- Keep meta/trace coverage unchanged.
- Why: ensure CLI/reconciler options reach worker.
- Depends on: bridge changes.

## `test/unit/session-reconciler.test.ts`
- Update expected `manageChats` call args.
- Change user-current-node expectations from orphan/no-new-assistant to unresolved when appropriate.
- Add baseline-wait polling coverage.
- Why: regression coverage for new recovery semantics.
- Depends on: reconciler + conversation-state helper.

## `test/e2e/chatgpt-cloak-local.test.ts` **(modified if harness supports it)**
- Add real single-send/no-duplicate-user-turn assertion.
- Add immediate-export-after-reply assertion.
- Why: only realistic proof for the double-send/timing fixes.
- Depends on: worker + chats changes.

## `README.md`
- Document obsolete env vars and export wait behavior.
- Why: align user contract with actual runtime.
- Depends on: CLI/runtime behavior finalized.

# 5. **Risks and migration**

- **No persistence migration** required.
- **Stderr compatibility risk:** warnings for obsolete env vars can appear in scripts. Keep them narrow:
  - always warn only for headed intent (`CLOAK_HEADLESS=0/false`),
  - keep `SURF_USE_CLOAK_CHATGPT` silent unless `SURF_DEBUG`.
- **Behavioral change:** `chatgpt.chats --export` may wait briefly before returning. This is intentional and should be documented.
- **Out-of-repo migration:** remove stale env vars from external workflow files after landing this repo change; they cannot be fixed from this repo alone.

# 6. **Implementation order**

1. **Add `chatgpt-cloak-runtime.cjs` + unit tests.**
   - Port chats-worker stale lock cleanup there.
   - Add launch retry/error normalization.
   - Independently testable.

2. **Switch both workers to the shared runtime helper.**
   - Query worker first, then chats worker.
   - Move query launch into handled error path.
   - This step should land atomically for consistency.

3. **Add `chatgpt-conversation-state.cjs` + unit tests.**
   - Implement baseline-aware state classification.
   - Keep it pure and reusable.

4. **Plumb assistant-wait fields through bridge and chats worker.**
   - Add worker request fields.
   - Implement `apiGetConversation(..., waitForAssistant...)`.
   - Return additive stabilization metadata.
   - Test bridge request forwarding.

5. **Update `session-reconciler.cjs` to use conversation-state classification and assistant-wait polling.**
   - Update unit tests.
   - This should be compilable and testable without touching query send logic.

6. **Refactor query worker send orchestration.**
   - Add post-attempt confirmation.
   - Move authoritative `meta_update` to post-persistence-success.
   - Remove early sent checkpoint emission.
   - Keep prompt-entry module unchanged.

7. **Clean up CLI env contract.**
   - Remove `withOptionalHeadedCloak()`.
   - Add env normalization.
   - Wire `waitForAssistant` for `chatgpt.chats --export`.
   - Update embedded skill text.

8. **Update README and, if available, e2e coverage.**
   - Document env deprecations and export timing behavior.
   - Add/extend local e2e assertions for single-send and export timing.

9. **Manual validation pass.**
   - Repro stale shared-profile lock launch on macOS.
   - Run a query where send button click is intentionally flaky; verify only one user turn is created.
   - Run immediate `chatgpt.chats <id> --export` after a reply and verify assistant content is present or a timeout warning is emitted, not silent truncation.


> 💡 Continue this plan conversation with ask_oracle(chat_id: "cloak-flow-triage-F2F810", new_chat: false)