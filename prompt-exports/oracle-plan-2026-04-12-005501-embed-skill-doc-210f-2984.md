## Final Prompt
<taskname="Embed Skill Doc"/>
<task>
Make `surf skill` / `surf skills` self-contained by embedding the SKILL document text in `native/cli.cjs` (string constant near top-level), instead of reading `skills/surf/SKILL.md` from disk. Update `skills/surf/SKILL.md` so its version line, model aliases, and command examples match the current headless-only surf-cli behavior and naming.
</task>

<architecture>
- `native/cli.cjs` is the single CLI entrypoint and command router. It handles help output, command parsing, and the `skills|skill` command branch.
- `skills/surf/SKILL.md` is the authored skill reference currently printed by `surf skills` via file I/O.
- `native/tests/cli-tests.sh` is the closest CLI regression harness; it validates help/list/find and command validation paths.
- Version truth source is `package.json` (`version`).
- Model truth sources:
  - ChatGPT aliases and canonical mapping: `native/chatgpt-cloak-worker.mjs` (`MODEL_MAP`, `resolveModel`).
  - Gemini default/supported model IDs: `native/gemini-common.cjs` (`DEFAULT_GEMINI_MODEL`, `SUPPORTED_GEMINI_MODELS`).
  - Gemini UI mode mapping and accepted preview model strings: `native/gemini-bun-worker.ts` (`MODEL_TO_MODE_KEYWORDS`, `trySelectModel`).
- User-facing command/examples references are in `README.md` and `skills/README.md`.
</architecture>

<selected_context>
native/cli.cjs: Full CLI implementation; includes current disk-based `skills|skill` branch (candidatePaths + fs.existsSync + readFileSync), help text, model notes in help output, and all command examples.
skills/surf/SKILL.md: Current skill content to be embedded and updated.
native/tests/cli-tests.sh: Existing CLI test harness; likely place to add regression for embedded-skill behavior and no filesystem dependency.
package.json: Current version (`2.11.1`) used to align SKILL.md version statement.
native/chatgpt-cloak-worker.mjs: ChatGPT model alias map (`gpt-4o/o3/o4-mini/o1-pro` + `instant/thinking/pro` + GPT-5.3/5.4 names).
native/gemini-common.cjs: Gemini default and officially supported model IDs.
native/gemini-bun-worker.ts: Additional Gemini model-mode mappings (includes 3.1 preview/pro/thinking/flash variants used by UI selection logic).
README.md: Public command examples and headless-only positioning; useful for consistency with SKILL examples.
skills/README.md: Packaging/usage notes for surf skill distribution.
</selected_context>

<relationships>
- `surf skills` path: `native/cli.cjs` command dispatch -> skills branch -> currently `fs.readFileSync(SKILL.md)`; target is static embedded string output.
- Skill content consistency chain: `skills/surf/SKILL.md` should reflect runtime behavior from `cli.cjs` + provider model mappings from worker/common files.
- Version consistency: SKILL version line should track `package.json` version.
- Regression coverage anchor: `native/tests/cli-tests.sh` exercises CLI text/behavior and can validate `skills` output path behavior.
</relationships>

<ambiguities>
- Gemini model messaging differs by layer: `cli.cjs` help advertises `gemini-3-pro`, `gemini-2.5-pro`, `gemini-2.5-flash`; `gemini-bun-worker.ts` also maps `gemini-3.1-*` preview/pro/thinking variants. Decide whether SKILL.md should present only officially supported defaults or also mention accepted UI-selectable preview models.
- `cli.cjs` still contains extensive legacy command metadata in `TOOLS`, while runtime allows only headless AI commands; SKILL examples should stay aligned with actually supported headless command surface.
- Embedding source-of-truth strategy: whether embedded string should be manually maintained in `cli.cjs` vs generated from `skills/surf/SKILL.md` during release is not prescribed here.
</ambiguities>

## Selection
- Files: 11 total (9 full, 2 codemap)
- Total tokens: 62863 (Auto view)
- Token breakdown: full 61738, codemap 1125

### Files
### Selected Files
├── native/
│   ├── tests/
│   │   └── cli-tests.sh — 1,519 tokens (full)
│   ├── chatgpt-cloak-worker.mjs — 14,453 tokens (full)
│   ├── cli.cjs — 28,825 tokens (full)
│   ├── gemini-bun-worker.ts — 11,355 tokens (full)
│   └── gemini-common.cjs — 1,717 tokens (full)
├── skills/
│   ├── surf/
│   │   └── SKILL.md — 1,246 tokens (full)
│   └── README.md — 195 tokens (full)
├── README.md — 2,027 tokens (full)
└── package.json — 401 tokens (full)

### Codemaps
native/
├── chatgpt-bun-profile-auth.ts — 233 tokens (auto)
└── chatgpt-bun-worker.ts — 892 tokens (auto)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `embed-skill-doc-210F5F` | **Mode**: plan

### Response
Hi Daniel — focused CLI polish; clean verification path.



## 1. **Summary**

Embed the surf agent skill text directly in `native/cli.cjs` as a top-level string constant, and make the `surf skill` / `surf skills` branch print that constant instead of reading `skills/surf/SKILL.md` at runtime. Keep `skills/surf/SKILL.md` as the authored source distributed with the package, but update its version line, model alias notes, and examples to match current headless-only behavior from `package.json`, `chatgpt-cloak-worker.mjs`, `gemini-common.cjs`, `gemini-bun-worker.ts`, `README.md`, and `cli.cjs`. This is a targeted change: one runtime branch, one documentation file, and one CLI regression harness update.

## 2. **Current-state analysis**

### Runtime command flow

- `native/cli.cjs` is the single Node CLI entrypoint.
- CLI arguments are read once near the top:

  ```js
  const args = process.argv.slice(2);
  ```

- Early command dispatch handles global help/version/list/find before general parsing.
- The `skills|skill` branch currently appears before session handling and before generic parser setup:

  ```js
  if (args[0] === "skills" || args[0] === "skill") {
    const fs = require("fs");
    const candidatePaths = [
      path.resolve(__dirname, "../skills/surf/SKILL.md"),
      path.join(os.homedir(), ".agents", "skills", "surf", "SKILL.md"),
    ];
    const skillPath = candidatePaths.find(p => fs.existsSync(p));
    if (!skillPath) {
      console.error("SKILL.md not found...");
      process.exit(1);
    }
    process.stdout.write(fs.readFileSync(skillPath, "utf-8"));
    process.exit(0);
  }
  ```

### Current responsibilities

- `cli.cjs`
  - Owns command routing.
  - Owns help output.
  - Owns runtime behavior for `surf skills`.
  - Already imports `fs`, `path`, `os`, and package `VERSION`.
- `skills/surf/SKILL.md`
  - Authored skill reference.
  - Currently also the runtime output source for `surf skills`.
- `skills/README.md`
  - Explains installation/symlink of skill files for agents.
  - Does not participate in CLI runtime.
- `native/tests/cli-tests.sh`
  - Shell-based CLI regression harness.
  - Validates help/list/find and command validation.
  - Does not currently test `surf skills`.

### Existing reusable sources of truth

- Version:
  - `package.json`: `"version": "2.11.1"`
  - `cli.cjs` already imports `VERSION`.
- ChatGPT model aliases:
  - `native/chatgpt-cloak-worker.mjs` `MODEL_MAP`
  - Current mappings:
    - `instant`, `gpt-5.3`, `gpt-4o`, `gpt-4.1`, `gpt-4.1-mini` → `model-switcher-gpt-5-3`
    - `thinking`, `gpt-5.4-thinking`, `o3`, `o4-mini` → `model-switcher-gpt-5-4-thinking`
    - `pro`, `gpt-5.4-pro`, `o1-pro`, `chatgpt-pro` → `model-switcher-gpt-5-4-pro`
- Gemini defaults/support:
  - `native/gemini-common.cjs`
  - Default: `gemini-3-pro`
  - Supported model IDs: `gemini-3-pro`, `gemini-2.5-pro`, `gemini-2.5-flash`
- Gemini UI best-effort model mapping:
  - `native/gemini-bun-worker.ts` `MODEL_TO_MODE_KEYWORDS`
  - Additional accepted/best-effort UI IDs:
    - `gemini-3.1-pro-preview`
    - `gemini-3.1-pro`
    - `gemini-3.1-thinking`
    - `gemini-3.1-flash`
    - `gemini-3.1-flash-lite-preview`
- User-facing examples:
  - `README.md`
  - `cli.cjs` help metadata under `TOOLS.ai.commands`
  - Current actual runtime allows only headless commands:
    - `chatgpt`
    - `chatgpt.chats`
    - `chatgpt.reply`
    - `gemini`
    - `session`
    - `do`
    - `server`
    - `skills`

### Blocking issue

`surf skills` depends on the package filesystem layout at runtime. If `skills/surf/SKILL.md` is absent from an installed package, broken symlink, minimal bundle, or copied binary tree, the command exits with an error. The requested behavior is self-contained CLI output, so this runtime file read must be removed from the `skills|skill` branch.

## 3. **Design**

### A. Embedded skill text in `native/cli.cjs`

#### Change type

Targeted change. No broader refactor.

#### Rationale

Only one command branch needs to become self-contained. Existing CLI architecture is a single-file command router, so a top-level constant is the simplest fit and avoids new build steps or generated artifacts.

#### New top-level constant

Add a string constant near other top-level constants after `VERSION` and platform constants, before helper functions:

```js
const SURF_SKILL_DOC = String.raw`...`;
```

Design requirements:

- Use `String.raw` with a template literal.
  - Reason: preserves Markdown backslashes and command examples without accidental escape handling.
- Content must match the updated `skills/surf/SKILL.md` byte-for-byte except trailing newline handling.
- Include the YAML frontmatter currently present in `SKILL.md`.
  - Reason: current `surf skills` prints the complete file, including frontmatter; agents may rely on it.
- Ensure the embedded string ends with exactly one newline.
  - `process.stdout.write(SURF_SKILL_DOC);`
  - No `console.log`, to avoid adding an extra newline.

#### Modified command branch

Replace runtime file lookup with direct output:

Before:

```js
if (args[0] === "skills" || args[0] === "skill") {
  const fs = require("fs");
  const candidatePaths = [...]
  ...
  process.stdout.write(fs.readFileSync(skillPath, "utf-8"));
  process.exit(0);
}
```

After shape:

```js
if (args[0] === "skills" || args[0] === "skill") {
  process.stdout.write(SURF_SKILL_DOC);
  process.exit(0);
}
```

Remove from this branch:

- Local `const fs = require("fs");`
- `candidatePaths`
- `existsSync` lookup
- missing-file error text
- `readFileSync`

Do **not** remove the top-level `fs` import. `cli.cjs` uses it broadly for prompts, workflows, exports, config-adjacent paths, etc.

#### Runtime behavior

- `surf skills`
  - Always prints embedded skill text.
  - Exits `0`.
  - Does not inspect `skills/surf/SKILL.md`.
  - Does not inspect `~/.agents/skills/surf/SKILL.md`.
- `surf skill`
  - Same output and exit behavior as `surf skills`.
- Missing `skills/` directory no longer affects this command.
- Help text remains unchanged unless tests reveal an obvious mismatch; task scope does not require help text edits.

#### Error handling

- No runtime error path for missing skill doc.
- If the embedded string is accidentally empty, command still exits `0`; prevent by regression tests.

#### Concurrency/lifecycle

- Synchronous CLI output only.
- No async behavior, no worker process, no persistence.

---

### B. Updated authored skill file: `skills/surf/SKILL.md`

#### Role

Keep as the human-maintained skill reference included in the package. It should mirror `SURF_SKILL_DOC`.

#### Required content updates

Update only the inaccurate/stale parts. Preserve the skill’s concise style and existing structure.

##### Version line

Current:

```md
Repo + local CLI verified against **surf-cli v2.11.1**.
```

Required:

```md
Repo + local CLI verified against **surf-cli v2.11.1**.
```

Because `package.json` is currently `2.11.1`, this line already matches. Implementation should still validate it against `package.json` and keep it unchanged unless package version changed during implementation.

##### Headless-only behavior

Ensure the skill says:

- ChatGPT uses CloakBrowser headless.
- Gemini uses Bun WebView headless.
- Page-context/browser-extension commands are removed.
- `--with-page` is not supported.

The current file already says most of this. Tighten wording where necessary to avoid implying extension/runtime commands exist.

##### ChatGPT aliases

Replace the current shorter alias list with the full current runtime mapping from `MODEL_MAP`.

Required content shape:

```md
### ChatGPT model aliases

- `instant`, `gpt-5.3`, `gpt-4o`, `gpt-4.1`, `gpt-4.1-mini` → GPT-5.3 Instant
- `thinking`, `gpt-5.4-thinking`, `o3`, `o4-mini` → GPT-5.4 Thinking
- `pro`, `gpt-5.4-pro`, `chatgpt-pro`, `o1-pro` → GPT-5.4 Pro
```

Rationale:

- `cli.cjs` basic help mentions only a subset.
- `chatgpt-cloak-worker.mjs` is runtime truth for actual selection.
- Skill should reflect actual accepted names, not only public examples.

##### Gemini model notes

Resolve the ambiguity by documenting both supported/default IDs and best-effort UI-selectable IDs.

Required content shape:

```md
### Gemini model notes

Default/listed models:

- `gemini-3-pro` default
- `gemini-2.5-pro`
- `gemini-2.5-flash`

Gemini UI selection also accepts best-effort mode IDs when available:

- `gemini-3.1-pro-preview`
- `gemini-3.1-pro`
- `gemini-3.1-thinking`
- `gemini-3.1-flash`
- `gemini-3.1-flash-lite-preview`

Use `gemini-3.1-pro-preview` for strongest reasoning/image analysis when the account UI exposes it. Unknown Gemini model names are passed through to the UI picker best-effort.
```

Rationale:

- `gemini-common.cjs` defines official default/supported IDs.
- `gemini-bun-worker.ts` intentionally supports additional UI mappings and pass-through unknown names via `resolveGeminiModelForUI`.

##### Command examples

Update examples to match actual headless-only commands and current naming.

Keep these examples:

```md
surf chatgpt "explain this code" --profile dsebban883@gmail.com
surf chatgpt "review this PR" --file diff.patch --profile dsebban883@gmail.com
surf chatgpt --prompt-file prompt.md --model gpt-5.4-pro --profile dsebban883@gmail.com
surf chatgpt "a robot surfing" --generate-image /tmp/robot.png --profile dsebban883@gmail.com
surf chatgpt "deep analysis" --model gpt-5.4-pro --profile dsebban883@gmail.com
```

Add or adjust examples to include:

```md
surf chatgpt.reply <conversation-id> --prompt-file followup.md --model gpt-5.4-thinking --profile dsebban883@gmail.com
```

Gemini examples should use current supported/default names and one explicit preview example:

```md
surf gemini "explain quantum computing" --profile dsebban883@gmail.com
surf gemini "analyze this chart" --file chart.jpg --model gemini-3-pro --profile dsebban883@gmail.com
surf gemini "reason about this architecture" --model gemini-3.1-pro-preview --profile dsebban883@gmail.com
surf gemini "summarize this video" --youtube "https://youtube.com/..." --profile dsebban883@gmail.com
surf gemini "a robot surfing" --generate-image /tmp/robot.png --profile dsebban883@gmail.com
surf gemini "wide banner" --generate-image /tmp/banner.png --aspect-ratio 16:9 --profile dsebban883@gmail.com
surf gemini "add sunglasses" --edit-image photo.jpg --output out.jpg --profile dsebban883@gmail.com
```

Workflow examples should remain headless-only:

```md
surf do 'chatgpt "Draft release notes" --profile dsebban883@gmail.com | gemini "Make it concise" --profile dsebban883@gmail.com'
surf do 'chatgpt "Review this" --file diff.patch --profile dsebban883@gmail.com' --dry-run
```

Session examples remain valid:

```md
surf session
surf session <id>
surf session --reconcile
surf session --reconcile --network
```

##### Terminology

Use:

- “CloakBrowser headless”
- “Bun WebView headless”
- “ChatGPT conversations”
- “headless-only CLI”

Avoid:

- “browser automation runtime” as if general browser commands are still available.
- Extension/page command examples.
- Legacy non-headless commands such as `screenshot`, `tab.*`, `page.read`, etc.

---

### C. Synchronization strategy between embedded constant and `SKILL.md`

#### Decision

Manual mirroring for this change. No build generation.

#### Rationale

The repo currently has no generation pipeline, and `package.json` scripts are simple (`test`, `check`, `lint`). Adding a generator would broaden the change beyond the request. A regression test can catch drift for key output content without introducing new tooling.

#### Implementation rule

After editing `skills/surf/SKILL.md`, copy its exact contents into `SURF_SKILL_DOC`.

Validation should confirm:

- `node native/cli.cjs skills` output contains the updated version line.
- `node native/cli.cjs skill` output contains the same key lines.
- Output does not depend on `skills/surf/SKILL.md` existing at runtime.

---

### D. CLI regression tests: `native/tests/cli-tests.sh`

Add tests in the “Version and Help” or new “Skill Command” section.

#### New test section

Add after help/list tests:

```sh
echo ""
echo "-- Skill Command --"
```

#### Required tests

1. `skills` prints skill frontmatter/name:

```sh
test_output "skills prints skill doc" "node cli.cjs skills" "name: surf"
```

2. Singular alias works:

```sh
test_output "skill alias prints skill doc" "node cli.cjs skill" "Headless terminal AI via local signed-in browser profiles"
```

3. Embedded doc includes current version:

```sh
test_output "skills version current" "node cli.cjs skills" "surf-cli v2.11.1"
```

4. Embedded doc includes expanded ChatGPT alias:

```sh
test_output "skills chatgpt aliases current" "node cli.cjs skills" "gpt-4.1-mini"
```

5. Embedded doc includes Gemini preview mapping note:

```sh
test_output "skills gemini preview current" "node cli.cjs skills" "gemini-3.1-pro-preview"
```

#### Filesystem-independence test

Because `cli-tests.sh` runs from `native/`, simulate a missing package skill doc without destructive repo changes by running the CLI from a temporary copy containing only `cli.cjs` plus required runtime files.

However, `cli.cjs` imports many sibling modules at startup, so a minimal copy is brittle. Prefer a non-invasive static behavior test:

- Add a test that the old missing-file error string is absent:

```sh
test_no_output "skills no missing file error" "node cli.cjs skills" "SKILL.md not found"
```

This does not prove absence of disk I/O, but it catches the user-visible old failure path.

For stronger verification during implementation, do a manual local check outside `cli-tests.sh`:

- Temporarily move `skills/surf/SKILL.md` aside with `mv`, run `node native/cli.cjs skills`, restore the file.
- Because this is risky in shared worktrees, do it only if implementation context permits and restore immediately.
- Do **not** encode this destructive move into the regression harness.

Given the final code branch has no file lookup, code review plus the new tests are enough.

---

## 4. **File-by-file impact**

### `native/cli.cjs`

**Changes**

- Add top-level `SURF_SKILL_DOC` string constant near existing constants after `VERSION`.
- Replace `if (args[0] === "skills" || args[0] === "skill")` body with direct `process.stdout.write(SURF_SKILL_DOC); process.exit(0);`.
- Remove old `candidatePaths` lookup and missing-file error path from that branch only.

**Why**

- Makes `surf skill` / `surf skills` self-contained.
- Removes runtime dependency on `skills/surf/SKILL.md` and user-level symlink.

**Dependencies**

- Should be updated after `skills/surf/SKILL.md` content is finalized so embedded text can mirror it.
- Must be landed with test updates.

---

### `skills/surf/SKILL.md`

**Changes**

- Keep version line aligned with `package.json` `2.11.1`.
- Expand ChatGPT model alias section to include all aliases from `MODEL_MAP`.
- Expand Gemini model notes to distinguish:
  - default/listed models from `gemini-common.cjs`
  - best-effort UI models from `gemini-bun-worker.ts`
- Refresh examples to current headless-only commands and naming.
- Ensure no examples mention removed extension/browser automation commands.

**Why**

- This remains the distributed authored skill reference.
- Embedded runtime string should mirror this updated document.

**Dependencies**

- Source content for `SURF_SKILL_DOC`.

---

### `native/tests/cli-tests.sh`

**Changes**

- Add a “Skill Command” section.
- Add tests for:
  - `skills` output
  - singular `skill` alias
  - current version line
  - expanded ChatGPT alias content
  - Gemini preview model content
  - absence of old missing-file error

**Why**

- Protects the new runtime command branch.
- Prevents stale embedded text for key version/model lines.

**Dependencies**

- Requires `native/cli.cjs` embedded output to include updated skill content.

---

### No change: `package.json`

**Reason**

- Version is already `2.11.1`.
- No new scripts or dependencies required.
- Existing package `files` can continue including `skills/`; the CLI no longer requires it at runtime, but distribution of skill docs remains useful.

---

### No change required: `skills/README.md`

**Reason**

- It describes skill distribution for agents.
- The embedded CLI output does not make the skill directory obsolete.
- Optional wording update could mention `surf skills` prints an embedded copy, but not required by the task. Avoid scope drift.

## 5. **Risks and migration**

### Runtime behavior change

- Old behavior allowed `surf skills` to print a user-level override at `~/.agents/skills/surf/SKILL.md` if package skill file was missing.
- New behavior always prints bundled embedded text.
- This is intentional for self-contained behavior.

### Drift risk

- `SURF_SKILL_DOC` and `skills/surf/SKILL.md` can diverge.
- Mitigation:
  - Keep content identical during this change.
  - Add tests for key lines.
  - During future releases, update both together.

### Package size

- Negligible increase in `cli.cjs` size.
- No dependency changes.

### Rollback

- Rollback is simple: restore disk-read branch.
- No persistence or data migration.

## 6. **Implementation order**

1. **Update `skills/surf/SKILL.md` content first**
   - Validate version line against `package.json`.
   - Expand ChatGPT aliases from `chatgpt-cloak-worker.mjs`.
   - Expand Gemini notes from `gemini-common.cjs` and `gemini-bun-worker.ts`.
   - Refresh examples to headless-only commands.

2. **Embed the updated skill doc in `native/cli.cjs`**
   - Add `SURF_SKILL_DOC` top-level constant.
   - Copy updated `skills/surf/SKILL.md` contents exactly.
   - Preserve one trailing newline.

3. **Replace `skills|skill` command branch**
   - Remove filesystem lookup.
   - Print `SURF_SKILL_DOC`.
   - Exit `0`.

4. **Add CLI regression tests**
   - Update `native/tests/cli-tests.sh`.
   - Add the skill command tests listed above.

5. **Run focused verification**
   - From repo root:
     - `bash native/tests/cli-tests.sh`
   - Direct behavior checks:
     - `node native/cli.cjs skills | head`
     - `node native/cli.cjs skill | grep "surf-cli v2.11.1"`
     - `node native/cli.cjs skills | grep "gpt-4.1-mini"`
     - `node native/cli.cjs skills | grep "gemini-3.1-pro-preview"`

6. **Run nearest broader checks**
   - `npm test`
   - `npm run check`
   - `npm run lint`
   - If lint formats the embedded Markdown string awkwardly, adjust with the repo’s accepted formatter style rather than adding ignore comments unless necessary.


> 💡 Continue this plan conversation with ask_oracle(chat_id: "embed-skill-doc-210F5F", new_chat: false)