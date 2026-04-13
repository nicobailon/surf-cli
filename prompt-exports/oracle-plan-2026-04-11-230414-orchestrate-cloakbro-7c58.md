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
- Files: 27 total (27 full)
- Total tokens: 118610 (Auto view)
- Token breakdown: full 118610

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
│   │   └── cli-tests.sh — 2,469 tokens (full)
│   ├── chatgpt-chats-formatter.cjs — 2,192 tokens (full)
│   ├── chatgpt-cloak-bridge.cjs — 2,571 tokens (full)
│   ├── chatgpt-cloak-chats-worker.mjs — 8,100 tokens (full)
│   ├── chatgpt-cloak-prompt-validation.cjs — 1,251 tokens (full)
│   ├── chatgpt-cloak-timeout.cjs — 736 tokens (full)
│   ├── cli.cjs — 40,450 tokens (full)
│   ├── config.cjs — 643 tokens (full)
│   ├── host.cjs — 15,468 tokens (full)
│   ├── mcp-server.cjs — 3,971 tokens (full)
│   ├── session-reconciler.cjs — 3,542 tokens (full)
│   ├── session-store.cjs — 4,285 tokens (full)
│   └── socket-path.cjs — 2,143 tokens (full)
├── test/
│   └── unit/
│       ├── chatgpt-bun-bridge.test.ts — 1,934 tokens (full)
│       ├── chatgpt-cloak-bridge.test.ts — 3,507 tokens (full)
│       ├── chatgpt-cloak-timeout.test.ts — 1,128 tokens (full)
│       ├── gemini-bun-bridge.test.ts — 2,229 tokens (full)
│       ├── mcp-server.test.ts — 967 tokens (full)
│       ├── session-reconciler.test.ts — 5,990 tokens (full)
│       ├── session-store.test.ts — 1,130 tokens (full)
│       └── socket-path.test.ts — 1,974 tokens (full)
├── README.md — 6,623 tokens (full)
└── package.json — 505 tokens (full)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `orchestrate-cloakbrowser-BA9C9C` | **Mode**: plan

### Response
Hi Daniel — tight scope, high-signal hardening pass.

## 1. **Summary**

The current code already implements most of the requested socket hardening: a centralized `native/socket-path.cjs` resolver, `SURF_SOCKET_PATH` / `--socket-path` precedence, Unix path validation, stale-socket handling, CLI/MCP error normalization, README updates, and focused unit/CLI tests. The remaining plan should be a small compatibility-and-validation pass: audit for any lingering hardcoded socket behavior, tighten lifecycle edge cases without broad refactor, extend MCP/host/CLI end-to-end confidence, and run real Cloak ChatGPT validation in isolated subagent lanes. No protocol changes; default socket remains `/tmp/surf.sock` on Unix and `//./pipe/surf` on Windows.

## 2. **Current-state analysis**

### Socket boundary responsibilities

#### `native/socket-path.cjs`

Centralized ownership now lives here.

Responsibilities:

- Defines defaults:
  - Unix: `/tmp/surf.sock`
  - Windows: `//./pipe/surf`
- Resolves endpoint precedence:
  1. explicit `overridePath`
  2. `env.SURF_SOCKET_PATH`
  3. platform default
- Normalizes / validates:
  - Windows named-pipe form only.
  - Unix absolute, non-empty, non-root paths.
  - Unix NUL rejection.
  - Unix byte-length limit via `getUnixSocketPathLimit(platform)`.
  - Directory path rejection.
- Client-side trust boundary:
  - `assertClientSafeSocketPath(endpoint)` refuses existing non-socket Unix paths.
- Server-side trust boundary:
  - `prepareSocketEndpointForListen(endpoint)`:
    - ensures custom parent dir exists with `0700`.
    - refuses to remove non-socket paths.
    - probes existing sockets.
    - refuses active sockets.
    - removes stale disconnected socket files.
    - cleanup only unlinks socket files, never regular files.
- User-facing error mapping:
  - `formatSocketClientError()` preserves familiar `ENOENT` / `ECONNREFUSED` messages.

This file should remain the single socket-path authority; do not duplicate resolver logic elsewhere.

#### `native/cli.cjs`

Socket client ownership:

- Imports:
  - `assertClientSafeSocketPath`
  - `formatSocketClientError`
  - `resolveSocketEndpoint`
- Parses global `--socket-path` early with `extractRawOptionValue(args, "socket-path")`.
- Resolves lazily through `getSocketEndpoint()`.
- Opens sockets via `openSocketConnection(onConnect)`.
- Uses normalized `getSocketErrorMessage(error, endpoint)` across:
  - script mode
  - `do`
  - stream mode
  - legacy socket path
  - MCP server startup path
- Removes `socket-path` from command args before sending tool request:
  - `delete toolArgs["socket-path"]`
- Preserves protocol payload:
  - `tool_request`
  - `method: "execute_tool"`
  - `params: { tool, args }`
  - `id`
  - optional `tabId`, `windowId`

Mutation points:

- No persistent config mutation.
- Only environment read is `process.env.SURF_SOCKET_PATH`.
- `networkStore.setBasePath()` remains separate and should not be coupled to socket path.

Blocking/edge observation:

- `extractRawOptionValue()` returns `true` if `--socket-path` has no value. That flows into `resolveSocketEndpoint()` and becomes `"true"` on Unix, producing an absolute-path validation error. Behavior is safe but message may be less direct than “requires a value”. Keep unless UX cleanup is desired.

#### `native/host.cjs`

Socket server ownership:

- Imports:
  - `formatSocketClientError`
  - `prepareSocketEndpointForListen`
  - `resolveSocketEndpoint`
- Resolves host endpoint from environment only:
  - `resolveSocketEndpoint({ env: process.env, platform: process.platform })`
- Prepares endpoint before `server.listen()`.
- Tracks lifecycle:
  - `socketEndpoint`
  - `socketEndpointLifecycle`
  - `ownsSocketEndpoint`
  - `serverReady`
  - `shuttingDown`
- Applies Unix `chmod 0600` after listen.
- Cleans up only owned endpoint on shutdown, stdin end, and uncaught exception.

Data flow:

`SURF_SOCKET_PATH` → `resolveHostSocketEndpoint()` → `prepareSocketEndpointForListen()` → `server.listen(socketEndpoint.path)` → `chmod 0600` → clients connect.

Important lifecycle constraint:

- `ownsSocketEndpoint` is set only inside `server.listen()` callback. If `listen()` fails after `prepareSocketEndpointForListen()` succeeds but before `ownsSocketEndpoint = true`, cleanup may not run through `cleanupSocketEndpoint()`. This is low-risk because `server.on("error")` calls cleanup only if `ownsSocketEndpoint`, but worth auditing in review.

#### `native/mcp-server.cjs`

MCP socket client ownership:

- Imports same resolver functions.
- `sendSocketRequest(tool, args, socketPath)`:
  - resolves explicit `socketPath` over env/default.
  - checks client-safe path.
  - connects with `net.createConnection(endpoint.path)`.
  - sends unchanged `tool_request`.
  - preserves `REQUEST_TIMEOUT = 30000`.
  - formats socket errors through `formatSocketClientError()`.
- `PiChromeMcpServer` accepts `{ socketPath }`.
- CLI `surf server --socket-path <path>` passes resolved endpoint path into MCP server.

Compatibility boundary:

- MCP protocol surface remains unchanged.
- Only socket routing changed.

### Existing reusable tests

#### `test/unit/socket-path.test.ts`

Already covers:

- default Unix and Windows endpoint shape.
- flag precedence over env.
- env override.
- empty / relative / Windows filesystem path rejection.
- overlong Unix path rejection.
- client refusal of regular files.
- server refusal to remove regular files.
- stale socket unlink.
- active socket in-use detection.
- custom parent dir `0700`.
- cleanup never deleting regular files.

This is the primary regression suite for the trust boundary.

#### `test/unit/mcp-server.test.ts`

Already covers:

- custom socket path honored by MCP.
- normal `tool_response` parsing preserved.
- missing socket error message.
- connection refused error message.

#### `native/tests/cli-tests.sh`

Already extended with:

- help exposes `--socket-path <path>`.
- CLI `tab.list --socket-path <custom>` against local stub.
- `SURF_SOCKET_PATH=<custom>` against local stub.
- `do` honors flag/env socket path.
- client rejects regular file as socket path.

This gives realistic CLI behavior coverage without requiring extension/Chrome.

### ChatGPT / session current state relevant to validation

#### `native/chatgpt-cloak-timeout.cjs`

Centralizes Cloak timeout semantics:

- Query default: `2700s`.
- Chats default: `120s`.
- Keepalive interval bounded `1000–15000ms`.
- `detectResponseActivity()` filters stale baseline churn and timer-label churn.

#### `native/chatgpt-cloak-bridge.cjs`

Worker supervision:

- `runCloakWorker()` spawns workers and reads JSON-lines stdout.
- Re-arms timeout on:
  - `progress`
  - `trace`
  - `meta_update`
  - `keepalive`
  - `success`
  - `error`
- Does **not** re-arm on log chatter.
- Maps:
  - query success → `{ response, model, tookMs, imagePath, partial, backend, conversationId, thinkingTrace? }`
  - chats success → raw worker payload minus `type`
- Headed retry for `chatgpt.chats get` when worker exits cleanly without result.

#### `native/session-store.cjs`

Session persistence:

- Creates `~/.surf/sessions/<id>/`.
- Persists:
  - `meta.json`
  - `output.log`
  - `response.md` artifact for full response bodies.
- Falls back to inline response fields if artifact write fails.
- `loadSession()` prefers:
  1. artifact
  2. inline response
  3. legacy `recoveredResponse`

#### `native/session-reconciler.cjs`

Recovery flow:

- Lists running sessions.
- PID alive:
  - recent → no mutation.
  - old → annotate stale, keep running.
- PID dead:
  - optionally polls ChatGPT via `manageChats({ action: "get" })` when:
    - `pollNetwork` enabled
    - conversation ID exists
    - sent checkpoint exists or legacy metadata lacks checkpoint fields
- Completed remote conversation:
  - extracts current assistant payload.
  - writes response artifact via `persistSessionResponse()`.
  - marks session completed.
- In-progress remote conversation:
  - leaves session running, annotates unresolved.
- Failed/ambiguous:
  - marks orphaned.

This is sufficient for real validation of query, chats, and reconcile behavior.

## 3. **Design**

### A. Socket endpoint resolver: keep as single module

#### Component

`native/socket-path.cjs`

Kind: CommonJS module.

Reason: shared by CLI, host, and MCP without introducing package-level TypeScript build requirements.

Owned state: none; all functions are pure except filesystem/socket probes.

Key interfaces:

```js
resolveSocketEndpoint({
  overridePath,
  env,
  platform,
}) => {
  path,
  transport: "unix" | "pipe",
  source: "flag" | "env" | "default",
  isDefault,
}

assertClientSafeSocketPath(endpoint) => endpoint | throws

prepareSocketEndpointForListen(endpoint, options?) =>
  Promise<{ cleanup(): void }>

formatSocketClientError(error, endpoint?) =>
  { code, message }
```

Design decision:

- Keep all validation here.
- Do not move socket path into `surf.json`; env/flag is enough and avoids persistent config migration.

#### Behavior contract

Unix:

- Default remains `/tmp/surf.sock`.
- Custom path must:
  - be non-empty
  - be absolute
  - not contain NUL
  - not be `/`
  - fit platform socket path byte limit
  - not point to a directory
- Existing non-socket file at client path:
  - CLI/MCP must refuse.
- Existing non-socket file at server path:
  - host must refuse and never unlink.
- Existing active socket:
  - host must refuse as in-use.
- Existing stale socket:
  - host may unlink and replace.
- Custom parent directories:
  - host creates with `0700`.
- Socket file:
  - host keeps `0600` after listen.

Windows:

- Default remains `//./pipe/surf`.
- Override must use named pipe form `//./pipe/NAME`.
- No Unix filesystem checks.

#### Data flow

CLI:

`argv --socket-path` → `extractRawOptionValue()` → `resolveSocketEndpoint()` → `assertClientSafeSocketPath()` → `net.createConnection(endpoint.path)`

Host:

`process.env.SURF_SOCKET_PATH` → `resolveSocketEndpoint()` → `prepareSocketEndpointForListen()` → `server.listen(endpoint.path)`

MCP:

`PiChromeMcpServer.socketPath` or env/default → `sendSocketRequest()` → `resolveSocketEndpoint()` → `assertClientSafeSocketPath()` → `net.createConnection(endpoint.path)`

#### Edge handling

- Duplicate env/flag values:
  - flag wins.
- Missing socket:
  - message remains “Socket not found. Is Chrome running with the extension?”
- Refused stale socket:
  - client gets “Connection refused. Native host not running.”
- Invalid path:
  - message is resolver validation error.
- Host startup failure:
  - host logs formatted error and exits `1`.

### B. CLI compatibility surface

#### Component

`native/cli.cjs`

Kind: existing CommonJS executable.

Modified/validated areas only:

- `extractRawOptionValue()`
- socket helpers:
  - `getSocketEndpoint()`
  - `openSocketConnection()`
  - `getSocketErrorMessage()`
- all connection call sites.

No protocol changes.

#### Required call sites to keep routed through `openSocketConnection()`

- `sendScriptRequest()` inside `--script` mode.
- `do` workflow path via `executeDoSteps(... context.socketPath ...)`.
- streaming path for `console --stream` / `network --stream`.
- `sendRequest()` helper for auto-capture.
- `startLegacySocketPath()` normal request path.
- `surf server --socket-path` startup path must continue passing resolved endpoint into `PiChromeMcpServer`.

#### UX compatibility

Existing user-visible messages should stay:

- `ENOENT` → “Socket not found. Is Chrome running with the extension?”
- `ECONNREFUSED` → “Connection refused. Native host not running.”
- unknown socket errors retain underlying message.

Optional small improvement:

- If `rawSocketPathOverride === true`, fail early with:
  - `Error: --socket-path requires a path`
- This is additive UX; not required for hardening.

### C. Host lifecycle hardening

#### Component

`native/host.cjs`

Kind: existing CommonJS native messaging host.

Current implementation is acceptable. Review phase should validate one subtle lifecycle point:

- `prepareSocketEndpointForListen()` may return cleanup before `server.listen()`.
- `ownsSocketEndpoint` becomes true only after listen callback.
- If listen emits error after preparation but before callback, cleanup may be skipped because `cleanupSocketEndpoint()` checks `ownsSocketEndpoint`.

Recommended targeted adjustment:

- Track prepared cleanup separately from “listening ownership”.
- Ensure startup failure always invokes `socketEndpointLifecycle.cleanup()` if preparation succeeded.
- Do not broaden lifecycle refactor.

Desired behavior:

```text
prepare succeeds
listen fails
→ cleanup prepared socket path if it is still a socket
→ exit 1
```

Keep cleanup safety in `socket-path.cjs`; host does not need to inspect file type.

### D. MCP compatibility

#### Component

`native/mcp-server.cjs`

Kind: existing CommonJS MCP server.

Keep:

- `sendSocketRequest(tool, args, socketPath)` public export for tests.
- `PiChromeMcpServer({ socketPath })` constructor argument.
- `REQUEST_TIMEOUT = 30000`.

Validate:

- `surf server --socket-path <path>` uses the custom endpoint.
- MCP direct env fallback works because `sendSocketRequest()` resolves env when constructor socketPath absent.

No schema changes to MCP tools/resources.

### E. Tests and validation strategy

#### Unit tests

Keep and expand only if gaps are found.

Required focused tests:

1. `test/unit/socket-path.test.ts`
   - Already sufficient for resolver behavior.
   - Add only if implementing early `--socket-path` missing-value UX is exposed through a helper.
2. `test/unit/mcp-server.test.ts`
   - Already validates custom path and formatted errors.
   - Add env override test if not redundant:
     - call `sendSocketRequest("tab.list", {}, undefined)` with temporary `SURF_SOCKET_PATH`.
3. No need to add tests for every CLI connection flow; `cli-tests.sh` covers realistic paths.

#### CLI harness

`native/tests/cli-tests.sh`

Keep existing socket-path cases. If adding the missing-value UX, add:

```text
node cli.cjs tab.list --socket-path
→ "--socket-path requires a path"
```

Do not require Chrome/extension.

#### Real behavior checks

Required by final execution agent:

1. Default CLI/host compatibility:
   - Start host or socket stub at default.
   - `node native/cli.cjs tab.list` reaches server/stub.
2. Override CLI/host compatibility:
   - Start host/stub with custom socket path.
   - `node native/cli.cjs tab.list --socket-path <path>` reaches it.
   - `SURF_SOCKET_PATH=<path> node native/cli.cjs tab.list` reaches it.
3. MCP compatibility:
   - `sendSocketRequest()` against custom stub returns expected `tool_response`.
4. Permissions:
   - On Unix, custom socket parent dir mode is `0700`.
   - socket file mode is `0600` after host listen.

### F. Subagent execution design

Because the task explicitly calls for subagents, split execution into four independent lanes. Each lane should produce a short artifact: commands run, files touched, findings, and blockers.

#### Subagent 1: socket implementation / compatibility

Scope:

- `native/socket-path.cjs`
- `native/cli.cjs`
- `native/host.cjs`
- `native/mcp-server.cjs`
- `README.md`
- socket-related tests only

Tasks:

- Confirm no hardcoded socket constants remain outside `socket-path.cjs` except docs/examples.
- Apply the host startup cleanup fix if validation confirms the gap.
- Keep protocol unchanged.

Exit criteria:

- Focused unit tests pass.
- CLI socket tests pass.

#### Subagent 2: review/refactor audit

Scope: read-only unless one-line cleanup is clearly safe.

Checklist:

- Duplicate socket resolution removed.
- No accidental coupling to:
  - `SURF_NETWORK_PATH`
  - `SURF_SESSIONS_DIR`
  - `SURF_NODE_PATH`
  - `SURF_HOST_PATH`
  - `SURF_EXTENSION_PATH`
- Error messages compatible.
- Windows named pipe behavior not regressed.
- Tests assert behavior, not implementation details.

Exit criteria:

- Findings list with severity.
- Explicit “no findings” if clean.

#### Subagent 3: deterministic verification

Commands:

```bash
npm run test -- test/unit/socket-path.test.ts test/unit/mcp-server.test.ts
npm run test
bash native/tests/cli-tests.sh
npm run check
npm run lint
```

If lint is too broad due unrelated existing issues, report exact unrelated blockers and run focused alternatives.

Exit criteria:

- Pass/fail table.
- Exact failing command output if blocked.

#### Subagent 4: real ChatGPT headless validation

Scope:

- No code changes.
- Use Cloak only.
- Use explicit profile to avoid shared profile locks.

Commands shape:

```bash
SURF_USE_CLOAK_CHATGPT=1 node native/cli.cjs chatgpt "Reply with exactly: surf socket smoke ok" --profile <profile> --timeout 2700
SURF_USE_CLOAK_CHATGPT=1 node native/cli.cjs chatgpt.chats --limit 1 --json --profile <profile>
SURF_USE_CLOAK_CHATGPT=1 node native/cli.cjs session --reconcile --network --hours 24
```

Optional interrupted recovery scenario:

1. Start a long-ish query with a low timeout, enough to reach sent checkpoint.
2. Let it fail or kill only the worker process if safe.
3. Run:
   ```bash
   SURF_USE_CLOAK_CHATGPT=1 node native/cli.cjs session --reconcile --network --hours 24
   ```
4. Confirm session becomes:
   - `completed` with `result.responsePath`, or
   - `running` unresolved if remote still in progress.

Blocker handling:

- If auth/profile fails:
  - record exact error.
  - run `chatgpt.chats --limit 1 --json --profile <profile>` as diagnostic.
- If profile lock fails:
  - retry with explicit `--profile`.
  - do not switch to headed mode unless validation explicitly allows it.
- If Cloak unavailable:
  - record install error and rely on deterministic tests.

## 4. **File-by-file impact**

### `native/socket-path.cjs`

Changes:

- Keep as authoritative resolver.
- Optionally add one helper only if needed for better CLI missing-value handling; otherwise no change.

Why:

- Centralized socket trust boundary already exists.

Dependencies:

- Used by CLI, host, MCP, tests.

### `native/cli.cjs`

Changes:

- Verify all socket clients use `openSocketConnection()`.
- Optional: fail early when `--socket-path` is present without a value.
- No protocol payload changes.

Why:

- CLI is main user-facing socket client and highest compatibility risk.

Dependencies:

- `native/socket-path.cjs`.

### `native/host.cjs`

Changes:

- Targeted lifecycle cleanup hardening around startup failure after endpoint preparation.
- Keep `chmod 0600`.

Why:

- Prevent stale prepared socket on startup failure.

Dependencies:

- `prepareSocketEndpointForListen()` cleanup safety.

### `native/mcp-server.cjs`

Changes:

- No required change if current tests pass.
- Optional env override test may validate existing behavior.

Why:

- MCP must remain compatible with CLI/host socket route.

Dependencies:

- `native/socket-path.cjs`.

### `README.md`

Changes:

- Keep Socket API examples using:
  - `SOCK="${SURF_SOCKET_PATH:-/tmp/surf.sock}"`
- Keep Environment Variables section documenting:
  - `SURF_SOCKET_PATH`
  - Unix absolute path requirement
  - Windows named pipe form
  - parent-dir creation

Why:

- Docs must match override behavior and default compatibility.

Dependencies:

- Resolver behavior.

### `native/tests/cli-tests.sh`

Changes:

- Already includes needed socket override cases.
- Add missing-value test only if CLI UX is improved.

Why:

- Realistic no-extension compatibility harness.

Dependencies:

- CLI behavior.

### `test/unit/socket-path.test.ts`

Changes:

- Likely no required changes.
- Add cases only for new helper/behavior.

Why:

- Primary trust-boundary regression suite.

Dependencies:

- `native/socket-path.cjs`.

### `test/unit/mcp-server.test.ts`

Changes:

- Optional env override case for `sendSocketRequest()`.

Why:

- Ensures MCP honors env when no constructor override is supplied.

Dependencies:

- temporary Unix socket stub.

### ChatGPT/session files

No code changes planned unless validation reveals regression:

- `native/chatgpt-cloak-bridge.cjs`
- `native/chatgpt-cloak-timeout.cjs`
- `native/chatgpt-cloak-chats-worker.mjs`
- `native/session-store.cjs`
- `native/session-reconciler.cjs`
- `native/chatgpt-chats-formatter.cjs`

Why:

- Current timeout/recovery/session behavior is already covered and outside socket hardening scope.

## 5. **Risks and migration**

### Compatibility risks

- Existing users expect `/tmp/surf.sock`; default remains unchanged.
- Existing MCP clients expect same `tool_request` / `tool_response`; protocol remains unchanged.
- Users with custom scripts hardcoding `/tmp/surf.sock` continue working.
- Users can opt into `SURF_SOCKET_PATH` without config migration.

### Security / trust-boundary risks

- Unix socket path replacement attacks are reduced by:
  - refusing non-socket paths.
  - refusing to unlink regular files.
  - checking active vs stale sockets.
  - restrictive parent/socket permissions.
- Remaining inherent limitation:
  - `/tmp` default parent is world-writable. Backward compatibility keeps default unchanged. For stronger isolation, users should set `SURF_SOCKET_PATH` under a private directory.

### Rollback

- Since default behavior is unchanged, rollback is straightforward:
  - remove `SURF_SOCKET_PATH` usage from environment.
  - omit `--socket-path`.
- No persistence schema change.

## 6. **Implementation order**

1. **Audit current socket usages**
   - Search for hardcoded `/tmp/surf.sock`, `//./pipe/surf`, `SOCKET_PATH`, and direct `net.createConnection`.
   - Confirm only `socket-path.cjs` owns defaults.
   - Confirm all CLI/MCP connection paths use resolver.

2. **Apply host startup cleanup hardening**
   - Target only `native/host.cjs`.
   - Ensure prepared endpoint cleanup runs if listen fails before ready.
   - Keep existing shutdown behavior.

3. **Optional CLI missing-value UX**
   - If chosen, add early validation for `--socket-path` with no following value.
   - Add one CLI harness assertion.
   - Do not alter valid override behavior.

4. **Run focused deterministic tests**
   - `npm run test -- test/unit/socket-path.test.ts test/unit/mcp-server.test.ts`
   - `bash native/tests/cli-tests.sh`

5. **Run full local gates**
   - `npm run test`
   - `npm run check`
   - `npm run lint`

6. **Review/refactor subagent**
   - Read-only audit first.
   - Apply only tiny cleanup if directly tied to socket hardening.

7. **Real ChatGPT headless subagent**
   - Run Cloak query/chats/reconcile commands with explicit `--profile`.
   - Capture session IDs and response artifacts.
   - Report exact blockers if auth/Cloak/profile unavailable.

8. **Final acceptance**
   - Default CLI/host/MCP path works.
   - `SURF_SOCKET_PATH` and `--socket-path` work.
   - Unsafe Unix paths are refused.
   - Host socket permissions remain restrictive.
   - README matches behavior.
   - ChatGPT headless validation either passes or has exact environmental blocker evidence.


> 💡 Continue this plan conversation with ask_oracle(chat_id: "orchestrate-cloakbrowser-BA9C9C", new_chat: false)