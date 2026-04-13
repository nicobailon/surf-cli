# Oracle Response

Hi Daniel — good catch; these two close the last big reliability holes.

## 4. Export guardrails / zero-body prevention

### Summary
This is a **workflow-layer correctness bug**, not a Cloak runtime bug.  
Fix at the oracle/export pipeline: force the right RepoPrompt build path, then hard-stop if exported file bodies are missing.

### Design

#### A. Enforce correct export path
**Out-of-repo file:** `~/Library/Application Support/RepoPrompt/Workflows/surf-gpt-pro-oracle.md`

Add/adjust steps so the flow always:

1. uses `context_builder` with `response_type: "clarify"` for broad / plan / review asks
2. uses the correct export preset via `prompt export`
   - `plan`
   - `codeReview`
   - `standard`
3. includes the phrase **“code review”** in `context_builder` instructions for review flows, so diff analysis activates
4. uses **`--prompt-file` only**
5. never uses **`--file`** for exported context

#### B. Add a hard guard before surf
Same workflow file:

- after export, parse/check export stats
- if `Files: 0`, abort before `surf`
- also fail if bytes/tokens look tree-only and no file bodies were selected
- emit explicit error: export invalid; rebuild selection/preset first

#### C. Oracle/pair-agent contract
**Out-of-repo agent/workflow layer**  
Whichever oracle/pair agent assembles the surf call must:

- use `context_builder` first
- verify exported preset is correct
- verify `Files > 0`
- only then call `surf chatgpt --prompt-file ...`

#### D. Repo-facing docs sync
**Repo files to update:**
- `README.md`
- `native/cli.cjs` (`SURF_SKILL_DOC`)

Add brief operator guidance:

- exported RepoPrompt context → use `--prompt-file`
- `--file` uploads; does not inline prompt text
- broad/review exports need proper preset selection
- if export stats show `Files: 0`, do not send

### File impact addendum
- **Out-of-repo:** `~/Library/Application Support/RepoPrompt/Workflows/surf-gpt-pro-oracle.md`
  - add `context_builder` requirement, preset routing, `Files > 0` guard, `--prompt-file` enforcement
- **Out-of-repo:** oracle/pair-agent workflow/prompt
  - require export validation before surf
- **`README.md`**
  - document `--prompt-file` vs `--file`
- **`native/cli.cjs`**
  - sync embedded skill doc with the same rule set

---

## 5. Timeout mismatch + recovery hydration follow-through

### Summary
This is a **runtime contract bug**.  
Query path must default to **2700s**, matching CLI/docs.  
Recovery hydration is already partly represented in current selected code path; treat it as **verify-and-complete**, not assumed-done.

### Design

#### A. Align query default timeout to 2700s
**Primary file:** `native/chatgpt-cloak-bridge.cjs`

Fix the remaining 120s defaults on the query path:

- `runCloakWorker()` must not accidentally default query workers to chats timeout
- `queryWithCloakBrowser()` should resolve to `2700` when omitted
- chats path stays `120`

#### B. Keep worker default consistent
**File:** `native/chatgpt-cloak-worker.mjs`

Current selected code already defaults `runQuery()` to `DEFAULT_CHATGPT_QUERY_TIMEOUT_SEC`.  
Plan item: verify worker always receives/respects 2700 from bridge; no new worker design unless inspection finds drift.

#### C. Recovery hydration
**Files to inspect before editing:**
- `native/session-store.cjs`
- `native/session-reconciler.cjs`

From current selected code, `session-reconciler.cjs` already calls `persistSessionResponse()` and stores recovered artifact metadata.  
So plan here is:

1. inspect `session-store.cjs`
2. verify recovered assistant body is truly persisted and surfaced on session view
3. only patch if a gap remains

If gap exists, fix should be:

- persist full recovered assistant text to artifact/session storage
- keep preview in meta
- make `surf session <id>` surface `responsePath` consistently

#### D. Docs + stale investigation cleanup
**Files:**
- `README.md`
- `native/cli.cjs`
- `docs/investigations/rp-surf-oracle-missing-reply-recovery.md`

Update docs so they no longer describe the stale 120s query default after the fix lands.

### File impact addendum
- **`native/chatgpt-cloak-bridge.cjs`**
  - fix query timeout default to 2700
  - keep chats timeout at 120
- **`native/chatgpt-cloak-worker.mjs`**
  - verify no fallback drift; patch only if needed
- **`test/unit/chatgpt-cloak-bridge.test.ts`**
  - assert query default = 2700
  - assert chats default = 120
- **`native/session-reconciler.cjs`**
  - only patch if recovered-body persistence/surfacing still incomplete after inspection
- **`native/session-store.cjs`**
  - inspect first; patch only if artifact/session view gap exists
- **`README.md`**
  - keep advertised timeout aligned
- **`native/cli.cjs`**
  - keep embedded skill/help text aligned
- **`docs/investigations/rp-surf-oracle-missing-reply-recovery.md`**
  - mark timeout mismatch resolved once landed

---

## Updated implementation order

1. `chatgpt-cloak-runtime.cjs` + runtime tests  
2. Switch both Cloak workers to shared runtime helper  
3. `chatgpt-conversation-state.cjs` + state tests  
4. Assistant-wait polling through bridge/chats worker/reconciler  
5. **Timeout alignment** in `native/chatgpt-cloak-bridge.cjs` + bridge tests  
6. Query send-confirmation / authoritative sent checkpoint in `native/chatgpt-cloak-worker.mjs`  
7. CLI env cleanup in `native/cli.cjs`  
8. Inspect `native/session-store.cjs`; patch recovery hydration only if still incomplete  
9. Repo docs sync: `README.md`, `native/cli.cjs`, investigations note  
10. **Out-of-repo oracle/export workflow fixes**: `surf-gpt-pro-oracle.md`, oracle/pair-agent guard logic  
11. Manual validation:
   - stale lock launch recovery
   - no duplicate send
   - waited export includes assistant
   - RepoPrompt export shows `Files > 0`
   - oracle flow uses `--prompt-file`
   - long ChatGPT run survives default timeout window