## Final Prompt
<taskname="Socket Hardening Plan"/>
<task>Plan and execute a focused hardening + validation pass for surf-cli with subagents. Scope: harden the local socket-path trust boundary and keep CLI/host/MCP behavior compatible; then run review/refactor and real ChatGPT headless validation in subagents. Keep changes small, shippable, and backward-compatible.</task>

<architecture>
- Socket boundary and transport:
  - `native/cli.cjs` is the main client/entrypoint. It defines `SOCKET_PATH`, opens socket connections in multiple flows (normal requests, streaming, legacy fallback), and prints user-facing socket errors.
  - `native/host.cjs` is the socket server (`net.createServer`), unlinks stale socket file, listens on `SOCKET_PATH`, and applies `chmod 0600` on non-Windows.
  - `native/mcp-server.cjs` is another socket client path for MCP tools/resources; it has its own `SOCKET_PATH` and timeout behavior.
- Session/recovery and Cloak runtime:
  - `native/chatgpt-cloak-bridge.cjs`, `native/chatgpt-cloak-chats-worker.mjs`, `native/chatgpt-cloak-timeout.cjs` implement headless ChatGPT/Cloak orchestration and timeout resets.
  - `native/session-store.cjs` and `native/session-reconciler.cjs` persist/reconcile sessions and recovered output artifacts.
- Tests/docs:
  - `native/tests/cli-tests.sh` covers CLI help/validation + session reconcile basics.
  - Unit tests in `test/unit/*` cover cloak bridge/timeout/session behavior and env-flag patterns (bun bridges).
  - `README.md` documents Socket API and environment variables; currently references `/tmp/surf.sock` directly.
</architecture>

<selected_context>
README.md: CLI docs, headless ChatGPT guidance, Socket API docs with hardcoded `/tmp/surf.sock`, env-var section.
package.json: test/lint/build scripts and deps.
native/cli.cjs: `SOCKET_PATH` constant, socket client calls, legacy fallback path, session command surface, cloak/bun routing.
native/host.cjs: `SOCKET_PATH` constant, socket server lifecycle (`unlinkSync`, `listen`, `chmod`, signal cleanup), CLI request handling.
native/mcp-server.cjs: `SOCKET_PATH` constant, MCP tool/resource bridge to socket via `sendSocketRequest()`.
native/config.cjs: existing surf config loader; candidate place if introducing persistent socket-path config.
native/tests/cli-tests.sh: current CLI behavior checks; baseline to extend with socket-path compatibility checks.
native/chatgpt-cloak-bridge.cjs: worker supervision/timers/progress forwarding for cloak query/chats.
native/chatgpt-cloak-timeout.cjs: query/chats default timeout and activity heuristics.
native/chatgpt-cloak-chats-worker.mjs: chats/reply worker path used for real ChatGPT recovery/validation flows.
native/chatgpt-chats-formatter.cjs: conversation formatting for recovery/export validation.
native/chatgpt-cloak-prompt-validation.cjs: prompt path validation and large-payload guards.
native/session-store.cjs: session metadata/log/response persistence.
native/session-reconciler.cjs: orphan/stale/recovered reconciliation logic.
test/unit/chatgpt-cloak-bridge.test.ts: timeout reset/retry/progress/meta propagation tests.
test/unit/chatgpt-cloak-timeout.test.ts: timeout default + activity detection tests.
test/unit/session-store.test.ts: response artifact persistence/load behavior.
test/unit/session-reconciler.test.ts: dead/alive/stale/recovery matrix.
test/unit/chatgpt-bun-bridge.test.ts: env flag parsing + request contract tests (good pattern for new env flag tests).
test/unit/gemini-bun-bridge.test.ts: same env-flag and request-contract test style.
docs/chatgpt-headless-investigation.md: constraints/findings for headless extraction behavior.
docs/investigations/surf-chats-profile-lock.md: profile-lock failure mode + required `--profile` behavior.
docs/investigations/rp-surf-oracle-missing-reply-recovery.md: long-run timeout/recovery failure mode and reconcile workflow.
docs/investigations/orchestrate-pro-surf-oracle-flow.md: subagent-oriented long-run supervision/recovery patterns.
</selected_context>

<relationships>
- CLI legacy path: `cli.cjs` -> Unix socket (`SOCKET_PATH`) -> `host.cjs` request dispatch -> extension/CDP actions.
- MCP path: `mcp-server.cjs` -> same Unix socket (`SOCKET_PATH`) -> `host.cjs`.
- Socket hardcoding exists independently in three places (`cli.cjs`, `host.cjs`, `mcp-server.cjs`), creating contract drift risk.
- Session lifecycle: `cli.cjs` uses `session-store.cjs`; `session-reconciler.cjs` updates persisted state and can recover via chats path.
- Cloak validation path: `cli.cjs` -> `chatgpt-cloak-bridge.cjs` -> `chatgpt-cloak-chats-worker.mjs`; results are formatted by `chatgpt-chats-formatter.cjs` and persisted via session modules.
- Timeout semantics for cloak are centralized in `chatgpt-cloak-timeout.cjs` and asserted by `chatgpt-cloak-timeout.test.ts` / `chatgpt-cloak-bridge.test.ts`.
</relationships>

<implementation_plan>
1. Socket-path hardening (implementation subagent)
- Introduce a single resolver for socket endpoint with explicit precedence and validation.
- Recommended precedence: CLI flag (if added) > env var (new, e.g. `SURF_SOCKET_PATH`) > platform default (`/tmp/surf.sock` or Windows pipe).
- Apply resolver consistently in `cli.cjs`, `host.cjs`, `mcp-server.cjs`.
- Preserve backward compatibility: default remains unchanged when no override is set.
- Harden local trust boundary on Unix:
  - ensure parent dir exists with restrictive perms if non-default path is used;
  - reject clearly unsafe path forms (empty, non-absolute on Unix, path traversal patterns where relevant);
  - keep `chmod 0600` behavior for socket file.

2. Contract-compatibility pass (implementation subagent)
- Keep request/response protocol unchanged (`tool_request` / `tool_response`) so existing clients do not break.
- Ensure existing error messages remain compatible where possible (especially ENOENT/ECONNREFUSED UX in CLI/MCP).
- Update README Socket API and env-var docs to document the new override and default behavior.
- Add migration note if examples still use `/tmp/surf.sock`.

3. Tests and harness upgrades (implementation subagent)
- Add focused unit tests for socket resolver behavior and precedence.
- Extend CLI tests with compatibility assertions for default socket behavior and override behavior.
- Add lightweight MCP/host contract tests if feasible (or targeted unit tests around `sendSocketRequest` + resolver wiring).
- Keep tests deterministic and non-interactive.

4. Review/refactor phase (separate subagent)
- Audit for duplicate socket-path constants/usages after implementation.
- Reduce duplication in connection timeout/error mapping without broad refactor.
- Check for unintended coupling with network-path/session-path env vars.
- Confirm docs/code/test naming consistency.

5. Real ChatGPT headless validation phase (separate subagent)
- Run headless-only smoke validations with Cloak path (no headed Chromium).
- Validate both normal query and recovery-oriented flows:
  - `SURF_USE_CLOAK_CHATGPT=1 surf chatgpt ... --profile ...`
  - `SURF_USE_CLOAK_CHATGPT=1 surf chatgpt.chats --limit 1 --json --profile ...`
  - `SURF_USE_CLOAK_CHATGPT=1 surf session --reconcile --network`
- Include at least one long-ish run that exercises keepalive/progress/session persistence expectations.
- Record concrete command outputs/artifacts and failures for follow-up.
</implementation_plan>

<verification_guidance>
- Required local gates: `npm run test` and any focused tests touched.
- Required behavior checks:
  - default behavior unchanged with no new env/flags (CLI + host + MCP still communicate).
  - overridden socket path works end-to-end across CLI/host/MCP.
  - socket file permissions remain restrictive on Unix.
  - README examples and env docs match implementation.
- Required headless real-ChatGPT checks in subagent:
  - successful query response path;
  - chats list/get path;
  - session reconcile path after an interrupted/timeout scenario.
- If live ChatGPT validation is blocked (auth/profile lock), capture exact blocker and fallback evidence from unit/integration checks.
</verification_guidance>

<ambiguities>
- `native/cli.cjs` and `native/host.cjs` are large, multi-responsibility files; keep edit scope tight around socket resolution and compatibility seams.
- Current repo has many unrelated changed files vs main; avoid scope drift into extension/UI or dist outputs.
- Real ChatGPT validation reliability depends on local profile/auth state and Cloak runtime availability.
</ambiguities>

## Selection
- Files: 24 total (24 full)
- Total tokens: 111398 (Auto view)
- Token breakdown: full 111398

### Files
### Selected Files
├── docs/
│   ├── investigations/
│   │   ├── orchestrate-pro-surf-oracle-flow.md — 1,211 tokens (full)
│   │   ├── rp-surf-oracle-missing-reply-recovery.md — 1,567 tokens (full)
│   │   └── surf-chats-profile-lock.md — 906 tokens (full)
│   └── chatgpt-headless-investigation.md — 1,118 tokens (full)
├── native/
│   ├── tests/
│   │   └── cli-tests.sh — 1,847 tokens (full)
│   ├── chatgpt-chats-formatter.cjs — 2,192 tokens (full)
│   ├── chatgpt-cloak-bridge.cjs — 2,571 tokens (full)
│   ├── chatgpt-cloak-chats-worker.mjs — 8,100 tokens (full)
│   ├── chatgpt-cloak-prompt-validation.cjs — 1,251 tokens (full)
│   ├── chatgpt-cloak-timeout.cjs — 736 tokens (full)
│   ├── cli.cjs — 39,792 tokens (full)
│   ├── config.cjs — 643 tokens (full)
│   ├── host.cjs — 15,053 tokens (full)
│   ├── mcp-server.cjs — 3,744 tokens (full)
│   ├── session-reconciler.cjs — 3,542 tokens (full)
│   └── session-store.cjs — 4,285 tokens (full)
├── test/
│   └── unit/
│       ├── chatgpt-bun-bridge.test.ts — 1,934 tokens (full)
│       ├── chatgpt-cloak-bridge.test.ts — 3,507 tokens (full)
│       ├── chatgpt-cloak-timeout.test.ts — 1,128 tokens (full)
│       ├── gemini-bun-bridge.test.ts — 2,229 tokens (full)
│       ├── session-reconciler.test.ts — 5,990 tokens (full)
│       └── session-store.test.ts — 1,130 tokens (full)
├── README.md — 6,417 tokens (full)
└── package.json — 505 tokens (full)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `socket-hardening-plan-D062B6` | **Mode**: plan

### Response
Hi Daniel — tight IPC hardening here buys safer local automation with low churn.



# 1. **Summary**

This should be a **targeted change**, not a transport refactor: add one shared socket-endpoint resolver and one shared Unix-socket safety layer, wire `native/cli.cjs`, `native/host.cjs`, and `native/mcp-server.cjs` to it, preserve the existing JSON request/response protocol and current default endpoint, then validate with focused unit/shell tests plus separate review and real Cloak/ChatGPT regression passes. The core fix is eliminating duplicated hardcoded socket paths and replacing `host.cjs`’s blind socket-file deletion with safe stale-socket handling.

# 2. **Current-state analysis**

## Socket ownership and call flow today

### CLI path
`native/cli.cjs` hardcodes:

- Unix: `/tmp/surf.sock`
- Windows: `//./pipe/surf`

That constant is used in three separate client flows:

1. **Main legacy socket path**  
   `startLegacySocketPath()` → `net.createConnection(SOCKET_PATH)` → sends JSON line request → waits for one JSON line response.
2. **Ad hoc socket helper**  
   `sendRequest()` → same connection logic for internal helper calls like auto-capture.
3. **Streaming path**  
   `console --stream` / `network --stream` → same socket, different request type.

This means endpoint selection, connection errors, and trust checks are duplicated inside one file.

### Host path
`native/host.cjs` is the socket server:

- unconditionally `unlinkSync(SOCKET_PATH)` on startup on non-Windows
- `server.listen(SOCKET_PATH)`
- after bind, `chmodSync(SOCKET_PATH, 0o600)`
- on `SIGTERM`/`SIGINT`, unconditionally `unlinkSync(SOCKET_PATH)` again

That is the biggest trust-boundary weakness: if the configured path exists and is **not** a socket, `host.cjs` will still try to delete it. It also does not distinguish an active socket owner from a stale orphaned socket file.

### MCP path
`native/mcp-server.cjs` hardcodes the same constant independently and uses it in `sendSocketRequest()` for MCP tools/resources. Error mapping is similar to CLI, but not identical.

## Protocol and compatibility constraints

The actual socket payload contract is stable and should not change:

- request: `tool_request`, `stream_request`, etc.
- response: `tool_response` with `result.content` or `error.content`

That contract is consumed by:

- `native/cli.cjs`
- `native/mcp-server.cjs`
- `native/host.cjs`
- existing extension/native-host flows

So the endpoint/path work must stay below the protocol layer.

## Non-socket paths that must stay untouched

Headless ChatGPT/Cloak and Bun flows in `native/cli.cjs` do **not** use the local socket path:

- `chatgpt` with Cloak → `chatgpt-cloak-bridge.cjs`
- `chatgpt.chats` / `chatgpt.reply` with Cloak → `chatgpt-cloak-bridge.cjs`
- Bun ChatGPT/Gemini bridges

These are selected for validation only, not for design changes. Session persistence/recovery in `session-store.cjs` and `session-reconciler.cjs` is also already in good shape and should not be altered for this task.

## Reusable code and patterns

Existing code/patterns to reuse rather than duplicate:

- `native/config.cjs` already centralizes config loading, but should **not** be used here; adding persistent socket config broadens scope and creates native-host deployment ambiguity.
- `native/chatgpt-cloak-timeout.cjs` is a good example of extracting cross-file constants/logic into a small shared helper module.
- unit tests in `test/unit/chatgpt-bun-bridge.test.ts` and `test/unit/gemini-bun-bridge.test.ts` show the repo pattern for small CJS helper tests with explicit input/output contracts.

## Blocking issues in current code

1. **Contract drift risk**: socket endpoint is hardcoded separately in three files.
2. **Unsafe cleanup**: `host.cjs` blindly deletes whatever is at `SOCKET_PATH`.
3. **No override contract**: there is no single supported way to point CLI/host/MCP at a different endpoint.
4. **Docs drift**: `README.md` documents `/tmp/surf.sock` as if it were fixed.
5. **Error drift**: CLI and MCP surface similar but non-centralized connection errors.

# 3. **Design**

## A. Shared socket endpoint module

### Decision
Add a new small module, e.g. `native/socket-path.cjs`, and keep scope limited to:

- endpoint resolution
- endpoint validation
- Unix server-side safe preparation/cleanup
- shared client-side error formatting

This is preferable to a broader “socket client/server abstraction” because the real problem is endpoint drift and unsafe file handling, not request transport structure.

### New component

**`native/socket-path.cjs`** — module

Suggested exported surface:

```js
resolveSocketEndpoint({
  overridePath,   // CLI flag / ctor arg
  env,
  platform,
}) => {
  path,
  transport,      // "unix" | "pipe"
  source,         // "flag" | "env" | "default"
  isDefault,
}

prepareSocketEndpointForListen(endpoint) => {
  cleanup,        // idempotent function
}

assertClientSafeSocketPath(endpoint) => void

formatSocketClientError(error, endpoint) => {
  message,
  code,
}
```

### Resolution contract

#### Precedence
For client processes:

1. explicit override argument (`--socket-path` in CLI, ctor arg in MCP)
2. `SURF_SOCKET_PATH`
3. existing platform default

For `host.cjs`:

1. `SURF_SOCKET_PATH`
2. existing platform default

Do **not** introduce persistent `surf.json` support in this pass. Rationale: native-host lifetime/env semantics are already complex; adding config would be a broader product decision.

### Validation rules

#### Unix
Accept only a normalized absolute filesystem path.

Reject with explicit `invalid_socket_path` if:

- empty or whitespace-only
- not absolute
- points to root directory
- contains `\0`
- normalized value resolves to a directory path target
- encoded path length exceeds platform-safe Unix socket limit

Use conservative path-length validation:

- macOS / unknown Unix: max 103 bytes
- Linux: max 107 bytes

Use `Buffer.byteLength(path)`.

#### Windows
Accept only named-pipe paths compatible with Node `net`:

- existing default form `//./pipe/surf`
- equivalent `\\.\pipe\...` style if normalized

Reject regular filesystem paths.

### Server-side hardening behavior

`prepareSocketEndpointForListen()` is the critical trust-boundary function.

#### Unix existing-path handling
Before `server.listen()`:

1. `lstat` final socket path if it exists.
2. If path does not exist: continue.
3. If final path exists and is **not** a socket: fail fast; do **not** delete it.
4. If final path is a socket:
   - probe it with a short local connect
   - if connect succeeds: treat as active listener; fail with `socket_path_in_use`
   - if connect fails with `ECONNREFUSED`/`ENOENT`: treat as stale; unlink it
   - any other probe result: fail rather than deleting

#### Custom parent directory
For non-default Unix paths only:

- ensure parent dir exists
- create missing parent dirs with `0700`
- do not recursively chmod existing dirs
- if parent target is not a directory, fail fast

#### Cleanup
Returned `cleanup()` should:

- no-op on Windows
- on Unix, `lstat` final path and unlink only if it is still a socket
- never unlink a non-socket path
- be safe to call on repeated shutdown/error paths

### Client-side trust checks

Before connect on Unix:

- if endpoint exists and is not a socket, fail immediately with clear message
- otherwise connect normally

Do **not** add ownership or permission enforcement on the default `/tmp/surf.sock`, because default behavior must remain compatible and `/tmp` is intentionally world-writable.

### Error model

New explicit internal error codes:

- `invalid_socket_path`
- `socket_path_not_socket`
- `socket_path_in_use`

Preserve current user-facing messaging for existing network failures:

- `ENOENT` → “Socket not found. Is Chrome running with the extension?”
- `ECONNREFUSED` → “Connection refused. Native host not running.”

New validation failures should produce clear path-specific messages.

## B. CLI integration

### Modified component
**`native/cli.cjs`** — existing entrypoint

### Interface change
Add one additive global option:

```text
--socket-path <path>
```

This is a **client-side override**. It must be stripped from tool args before request dispatch so it never leaks into extension tool payloads.

### Data flow changes

#### Normal legacy socket flow
Raw argv  
→ parse `--socket-path`  
→ `resolveSocketEndpoint()`  
→ `assertClientSafeSocketPath()`  
→ `net.createConnection(endpoint.path)`  
→ existing JSON line protocol unchanged

#### Stream flow
Same endpoint resolution path as normal requests.

#### `sendRequest()` helper
Must use the same resolved endpoint, not an independent constant.

#### `surf server`
Today `cli.cjs` directly instantiates `PiChromeMcpServer`. After change:

- resolve endpoint once in CLI
- pass resolved path into `new PiChromeMcpServer({ socketPath })`

This avoids a second round of implicit path resolution in the same process.

### Parsing/lifecycle details

`cli.cjs` has early command branches before generic `parseArgs()`, notably `server`. So socket-path extraction must happen in two places:

1. a lightweight early raw-argv extractor for `server`
2. normal parsed option handling for tool commands

`session` commands do not use the socket and do not need the override.

### Help/docs inside CLI
Update:

- full help global options
- `server --help` text
- optionally basic help only if brevity allows

Do not add more CLI surface than the single flag.

### Compatibility constraints

- default endpoint unchanged
- existing command routing unchanged
- existing JSON request payloads unchanged
- existing ENOENT/ECONNREFUSED wording unchanged

## C. Host integration

### Modified component
**`native/host.cjs`** — existing server

### Changes
Replace:

- top-level hardcoded `SOCKET_PATH`
- blind startup unlink
- blind signal cleanup unlink

with resolved/prepared endpoint flow:

1. resolve endpoint from env/default
2. call `prepareSocketEndpointForListen(endpoint)`
3. listen on `endpoint.path`
4. after listen, `chmod 0600` on Unix
5. on shutdown/error, call returned cleanup

### Lifecycle and race handling

This module is single-threaded on the Node event loop, but there are startup races across processes.

Required behavior:

- if another active host owns the socket, do not delete/replace it
- if stale socket exists, remove it before bind
- if bind still fails with `EADDRINUSE`, surface explicit log and exit; do not retry-delete on bind failure

### Logging
Keep current logging style, but include endpoint path in startup/bind failure log lines.

### Unknown to validate during implementation
Because browser native-host launch behavior is environment-sensitive, implementation must verify whether an installed browser-launched host reliably sees `SURF_SOCKET_PATH`. If not, docs must scope that env var to “process/manual-host override” instead of claiming persistent browser-wide override. No wrapper/config changes in this pass.

## D. MCP integration

### Modified component
**`native/mcp-server.cjs`**

### Interface changes

Internal only:

Before:
```js
sendSocketRequest(tool, args = {})
new PiChromeMcpServer()
```

After:
```js
sendSocketRequest(tool, args = {}, socketPath)
new PiChromeMcpServer({ socketPath } = {})
```

Constructor arg is additive and backward-compatible.

### Data flow
MCP tool/resource request  
→ `sendSocketRequest(..., socketPath)`  
→ same host socket  
→ same `tool_request` / `tool_response` contract

### Error handling
Use the shared formatter so MCP and CLI agree on:

- missing socket
- refused connection
- invalid/non-socket endpoint

Keep result formatting unchanged.

## E. Tests and validation wiring

### New/modified tests

#### 1. `test/unit/socket-path.test.ts` — new
Covers the new module directly.

Required cases:

- default Unix endpoint
- default Windows named pipe
- flag overrides env
- env overrides default
- invalid empty/relative Unix path rejected
- invalid Windows filesystem path rejected
- overlong Unix path rejected
- existing regular file at Unix socket path rejected
- stale Unix socket is removed
- active Unix socket is reported in-use, not removed
- custom parent dir is created with restrictive mode when missing

For active/stale socket cases, use real temp socket files on Unix rather than a mocked FS abstraction; that keeps behavior honest and still deterministic.

#### 2. `native/tests/cli-tests.sh` — extend
Add a small stub-socket section:

- start a temporary Node server on a temp socket path
- have it return a fixed `tool_response`
- assert `node cli.cjs tab.list --socket-path <temp>` reads it
- assert `SURF_SOCKET_PATH=<temp> node cli.cjs tab.list` reads it
- assert `--help-full` includes `--socket-path`

Do **not** use `/tmp/surf.sock` in shell tests; use temp paths only.

#### 3. `test/unit/mcp-server.test.ts` — new
Add a lightweight contract test around `sendSocketRequest` or a test-only exported helper:

- custom socket path is honored
- response parsing unchanged
- ENOENT/ECONNREFUSED formatting preserved

### No changes to ChatGPT/session unit tests
`chatgpt-cloak-*`, `session-store`, and `session-reconciler` tests should remain unchanged unless the CLI flag parsing accidentally impacts them. Their role here is regression coverage via full `npm run test`.

## F. Documentation

### Modified component
**`README.md`**

### Required changes

#### Socket API section
Replace hardcoded example:

```bash
echo ... | nc -U /tmp/surf.sock
```

with default-aware form, e.g.:

```bash
SOCK="${SURF_SOCKET_PATH:-/tmp/surf.sock}"
echo ... | nc -U "$SOCK"
```

#### Environment variables
Add:

- `SURF_SOCKET_PATH` — shared socket override for CLI/MCP/manual host
- Unix requirements: absolute path, custom parent dir auto-created by host if missing
- Windows requirement: named-pipe form only

#### Compatibility note
State clearly:

- default remains `/tmp/surf.sock` on Unix and `//./pipe/surf` on Windows
- no protocol changes
- existing clients continue working with defaults

### What not to document
Do not promise persistent browser-native-host override unless implementation verifies env propagation for installed hosts.

## G. Review/refactor subagent scope

This is a separate review pass, not new architecture.

Review checklist:

1. grep for leftover hardcoded socket constants (`/tmp/surf.sock`, `//./pipe/surf`)
2. ensure only one resolver owns precedence logic
3. ensure CLI and MCP use the same connection-error wording
4. ensure `--socket-path` never leaks into tool args
5. ensure no accidental coupling to `SURF_NETWORK_PATH` / `SURF_SESSIONS_DIR`
6. verify no unrelated edits in session/Cloak modules

If a tiny follow-up refactor is needed, limit it to deduplicating client-side socket error formatting; do not introduce a generic transport layer.

## H. Real ChatGPT headless validation subagent scope

No code changes planned in these modules; this is a regression pass.

### Use repo-local CLI
Because PATH `surf` may be stale in this environment, validation must use:

```bash
node native/cli.cjs ...
```

from repo root.

### Required live checks

#### 1. Basic query
```bash
SURF_USE_CLOAK_CHATGPT=1 node native/cli.cjs chatgpt "short validation prompt" --profile <email> --timeout 300
```

Verify:

- response returned
- session written
- no socket-path changes interfere with non-socket CLI routing

#### 2. Chats list/get
```bash
SURF_USE_CLOAK_CHATGPT=1 node native/cli.cjs chatgpt.chats --limit 1 --json --profile <email>
```

and, if an ID is available:

```bash
SURF_USE_CLOAK_CHATGPT=1 node native/cli.cjs chatgpt.chats <conversation-id> --profile <email>
```

Verify:

- chats flow still works
- profile/temp-profile path behavior unchanged

#### 3. Recovery/reconcile
Create an interrupted session deliberately:

1. start a longer prompt
2. wait until session log shows sent checkpoint / conversation ID
3. kill the local worker process
4. run:

```bash
SURF_USE_CLOAK_CHATGPT=1 node native/cli.cjs session --reconcile --network
```

Verify:

- orphaned vs recovered behavior matches `session-reconciler.cjs`
- recovered response artifact/meta behavior still matches existing tests

If blocked by auth/profile lock/Cloak install, capture:

- exact command
- exact stderr
- whether chats path works independently
- whether unit tests already cover the missed path

# 4. **File-by-file impact**

## `native/socket-path.cjs` — **new**
- Add shared endpoint resolver/validator.
- Add Unix safe prepare/cleanup helpers.
- Add shared client error formatter.
- Why: eliminate hardcoded drift and centralize trust-boundary logic.
- Dependency order: first file to land; all other code depends on it.

## `native/cli.cjs` — **modified**
- Remove direct dependence on local `SOCKET_PATH` constant.
- Parse and strip `--socket-path`.
- Resolve endpoint once per process for socket-using flows.
- Apply shared error formatting in:
  - stream mode
  - `sendRequest()`
  - `startLegacySocketPath()`
- Pass `socketPath` into `PiChromeMcpServer` in `server` command.
- Update help text for new global option.
- Why: keep client behavior compatible while making endpoint override explicit and consistent.
- Depends on: `native/socket-path.cjs`.

## `native/host.cjs` — **modified**
- Replace hardcoded `SOCKET_PATH`.
- Replace blind unlink-on-startup and unlink-on-shutdown.
- Use safe prepare/cleanup lifecycle.
- Preserve `chmod 0600` after successful bind.
- Improve bind failure logging for active/in-use socket cases.
- Why: this is the actual trust-boundary hardening.
- Depends on: `native/socket-path.cjs`.

## `native/mcp-server.cjs` — **modified**
- Remove hardcoded `SOCKET_PATH`.
- Accept constructor-level `socketPath`.
- Resolve/default path for standalone use.
- Route client connection errors through shared formatter.
- Why: prevent MCP drift from CLI/host endpoint rules.
- Depends on: `native/socket-path.cjs`.

## `test/unit/socket-path.test.ts` — **new**
- Add direct tests for precedence, validation, and Unix prepare/cleanup behavior.
- Why: most of the hardening lives in the new helper module.
- Depends on: `native/socket-path.cjs`.

## `test/unit/mcp-server.test.ts` — **new**
- Add lightweight socket-request contract tests at custom paths.
- Why: verifies MCP wiring without needing a real browser host.
- Depends on: `native/mcp-server.cjs`, `native/socket-path.cjs`.

## `native/tests/cli-tests.sh` — **modified**
- Add `--socket-path` help assertion.
- Add temp-socket stub server tests for flag/env override on CLI.
- Why: preserve current CLI compatibility and validate end-to-end client behavior.
- Depends on: `native/cli.cjs`.

## `README.md` — **modified**
- Document `SURF_SOCKET_PATH`.
- Update Socket API examples to default-aware path usage.
- Clarify defaults remain unchanged.
- Why: docs currently imply the endpoint is fixed.
- Depends on: final behavior being settled.

# 5. **Risks and migration**

This is additive and backward-compatible, but there are two behavior changes worth calling out:

1. **Unsafe existing path now fails fast**  
   If the chosen socket path points to a regular file/symlink/non-socket, new code should refuse to delete it. Old code would have tried to unlink it.
2. **Active existing listener now blocks takeover**  
   If another host already owns the socket, new code should report “in use” instead of deleting/rebinding.

Rollback is simple:

- stop using `--socket-path`
- unset `SURF_SOCKET_PATH`
- default endpoint behavior remains unchanged

No session schema, socket protocol, or persisted data migration is involved.

# 6. **Implementation order**

1. **Create `native/socket-path.cjs` and its unit tests**  
   Implement resolution, validation, error formatting, Unix prepare/cleanup.  
   This step should compile and test independently.

2. **Wire `native/host.cjs` to the shared module**  
   Replace startup/shutdown unlink logic first; keep listen/protocol behavior unchanged.  
   This step must land with the resolver module.

3. **Wire `native/cli.cjs` to the shared module**  
   Add `--socket-path`, strip it from tool args, update all socket client paths, and pass `socketPath` into MCP server construction.  
   This step must land atomically with help-text updates if shell tests assert help output.

4. **Wire `native/mcp-server.cjs` to the shared module**  
   Add ctor arg support and shared error formatting.  
   Keep MCP response formatting unchanged.

5. **Add/extend targeted tests**  
   - `test/unit/socket-path.test.ts`
   - `test/unit/mcp-server.test.ts`
   - `native/tests/cli-tests.sh`  
   Run `npm run test` plus the CLI shell script.

6. **Update `README.md`**  
   Document override semantics only after implementation behavior is final.  
   Do not overstate installed-browser env propagation unless verified.

7. **Review subagent pass**  
   Audit for leftover hardcoded socket constants and error-message drift.  
   Only allow tiny cleanup edits.

8. **Live ChatGPT/Cloak validation subagent pass**  
   Use repo-local `node native/cli.cjs ...` commands.  
   Capture command transcripts, session IDs, and artifact paths.  
   If blocked, record exact blockers and fallback evidence.

9. **Final verification bundle**  
   Required before merge:
   - `npm run test`
   - `bash native/tests/cli-tests.sh`
   - focused manual Unix permission check on custom socket path
   - live Cloak validation or explicit blocker report


> 💡 Continue this plan conversation with ask_oracle(chat_id: "socket-hardening-plan-D062B6", new_chat: false)