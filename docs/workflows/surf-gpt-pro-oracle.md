---
id: A6BE7311-3356-4DAA-9F61-C703C1195828
name: "Surf Oracle (Pro)"
icon: "sparkles"
tooltip: "Clarify with builder, then ask GPT Pro via surf CLI (headless only)"
description: "Run builder-clarify in a subagent, then export RepoPrompt context to ChatGPT Pro via surf headless-only with polling and recovery."
source: "~/Library/Application Support/RepoPrompt/Workflows/surf-gpt-pro-oracle.md"
---

# Surf Oracle (Pro)

Repo copy of the RepoPrompt Application Support workflow.

Raw request: $ARGUMENTS

Your job: produce a strong external-model answer using RepoPrompt context and ChatGPT Pro.
Default: **do not implement code**. Clarify, export, run headless-only, poll, recover, summarize.

## Default stance

- Local repo truth first
- Builder clarify first
- Use `exa-cli` only if latest external facts materially matter
- Use `--prompt-file`, never `--file`, for RepoPrompt exports
- Headless only — never use headed Chromium, `--continue`, or legacy ChatGPT/Cloak env toggles
- Long GPT Pro runs must be detached + polled; do not block on one long wait

---

## Phase 0 — Quick orient

Do **2-3 lightweight repo/tool calls max** to restate the task in repo terms.

```json
{"tool":"get_file_tree","args":{"type":"files","mode":"auto"}}
{"tool":"file_search","args":{"pattern":"<key term>","mode":"both"}}
{"tool":"get_code_structure","args":{"paths":["<likely area>/"]}}
```

No deep reading yet.

---

## Phase 1 — Clarify subagent (required)

Spawn an `explore` agent. Its only job: run `context_builder` with `response_type:"clarify"` and return the clarified context.

```json
{"tool":"agent_run","args":{
  "op":"start",
  "model_id":"explore",
  "session_name":"Clarify: <task>",
  "message":"Reformulate the task in repo terms, then run context_builder with response_type clarify. Use ~60k token target unless the user gave a better limit. For review asks, include the exact phrase code review in the context_builder instructions so diff analysis activates. Return only: current-state summary, key paths/patterns, open decisions tagged FACT vs DESIGN vs PREFERENCE, and whether latest external facts matter. Do not implement.",
  "detach":true
}}
{"tool":"agent_run","args":{"op":"wait","session_id":"<clarify_session_id>","timeout":300}}
```

If the user supplied a plan/spec file, include it in the subagent brief and tell the subagent to read it before builder.

Harvest from the result:
- reformulated task
- clarified selection/tab context
- likely impacted files/modules
- whether a tiny `exa-cli` grounding pass is needed

---

## Phase 2 — Optional exa grounding

Use `exa-cli` only if the answer depends on unstable external facts, current docs, or web-grounded examples.
Keep it brief. Fold findings into the export prompt; do not let web research dominate repo truth.

---

## Phase 3 — Surf GPT Pro run

Spawn a dedicated `pair` agent to execute the oracle lane.
That agent should explicitly use the `rp-surf-oracle` and `surf` skills, and must stay headless-only.

```json
{"tool":"agent_run","args":{
  "op":"start",
  "model_id":"pair",
  "session_name":"Surf Oracle: <task>",
  "message":"Reuse the clarified RepoPrompt tab/selection. Stay headless-only and do not rely on legacy ChatGPT/Cloak env toggles. If latest external facts matter, do a brief exa-cli grounding pass first. Choose the right prompt export preset (plan/codeReview/standard), export to .surf/exports/, validate the export stats before surf, then run ChatGPT Pro via surf in tmux with --prompt-file only, poll the log for thinking/progress, reconcile if needed, recover via chatgpt.chats if needed, and return the final answer plus artifact paths/ids. Do not implement code.",
  "detach":true
}}
```

### Required operating pattern for the oracle agent

1. **Headless-only invariant**
   - never use `--continue` or any headed browser flow
   - never rely on `SURF_USE_CLOAK_CHATGPT` or `CLOAK_HEADLESS`; they are obsolete for this lane
   - if the task would require interactive/login/headed recovery, stop and report that headless-only mode cannot do it

2. **Pick surf command carefully**
   - inside `surf-cli`: `SURF_CMD="node native/cli.cjs"`
   - otherwise: `SURF_CMD="surf"`
   - if PATH `surf session` is missing/stale, fall back to repo-local `node native/cli.cjs session`

3. **Choose export preset by intent**
   - review → `codeReview`
   - plan → `plan`
   - bounded question → `standard`
   - default to `plan` when ambiguous
   - export with `prompt export`; never switch to `--file` uploads for RepoPrompt context

4. **Validate export before surf**
   - inspect export stats immediately after `prompt export`
   - if stats show `Files: 0`, abort and rebuild selection/preset first
   - also abort when the export looks tree-only / prompt-only with no file bodies selected
   - emit an explicit error: `Export invalid; rebuild selection/preset before surf.`

5. **Run detached in tmux**
```bash
tmux new -d -s rp-oracle-<slug> "bash -lc '$SURF_CMD chatgpt \
  --prompt-file "$EXPORT_PATH" \
  --model gpt-5.4-pro \
  --profile dsebban883@gmail.com \
  --timeout 3000 \
  2>&1 | tee "$LOG_PATH"'"
```

6. **Poll instead of blocking**
```bash
tail -n 40 "$LOG_PATH"
$SURF_CMD session --hours 1
$SURF_CMD session --reconcile --network
```
Treat `[cloak-chatgpt] 🧠 ...`, `⏳ ...`, and the new keepalive wait lines as live progress.

7. **Recovery lane**
```bash
$SURF_CMD chatgpt.chats <conversation-id> \
  --export "$RECOVERY_PATH" \
  --format markdown \
  --profile dsebban883@gmail.com
```
If stdout response is missing but chats export succeeds, treat that as recovered success.

8. **Return artifacts + answer**
   - export path
   - response log path
   - tmux session name
   - conversation id / session id if known
   - whether the answer was live or recovered
   - concise GPT Pro answer / plan / review summary

### How you should wait on the oracle agent

Use short waits:

```json
{"tool":"agent_run","args":{"op":"wait","session_id":"<oracle_session_id>","timeout":60}}
```

If still running, summarize status briefly and wait again.

---

## Final output

Return:
- clarified understanding of the task
- whether exa grounding was used
- GPT Pro answer summary
- export/log/recovery artifact paths
- conversation id / session id if available
- any caveats or follow-ups

## Anti-patterns

- 🚫 skipping builder clarify
- 🚫 using `--file` instead of `--prompt-file`
- 🚫 sending a RepoPrompt export when stats show `Files: 0`
- 🚫 running GPT Pro inline without tmux
- 🚫 waiting silently without polling logs/session state
- 🚫 ignoring `session --reconcile --network` or `chatgpt.chats` recovery when stdout is missing
- 🚫 relying on legacy ChatGPT/Cloak env toggles or launching headed Chromium
