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
- **Chat**: `orchestrate-cloakbrowser-2B5267` | **Mode**: plan

### Response
Hi Daniel — tight boundary pass; small blast radius, strong payoff.



# 1. Summary

Harden surf-cli’s local socket trust boundary by centralizing socket endpoint resolution and safety checks in `native/socket-path.cjs`, then route all CLI, host, and MCP socket usage through that module without changing the JSON-line `tool_request` / `tool_response` protocol. Keep defaults backward-compatible (`/tmp/surf.sock` on Unix, `//./pipe/surf` on Windows), add an additive `SURF_SOCKET_PATH` / `--socket-path` override path, validate Unix paths before connecting/listening, refuse non-socket filesystem targets, and preserve existing user-facing ENOENT/ECONNREFUSED messages. Validate with deterministic resolver/CLI/MCP tests plus a separate real Cloak ChatGPT headless subagent pass. No persistence schema change.

# 2. Current-state analysis

## Socket ownership and data flow

### CLI client path — `native/cli.cjs`

Relevant current responsibilities:

- Main executable and argument parser.
- Resolves global options including `--socket-path`.
- Opens local socket connections for:
  - normal one-shot tool requests via `startLegacySocketPath()`;
  - streaming `console --stream` / `network --stream`;
  - script mode `--script`;
  - auto-capture helper requests;
  - `surf server` MCP startup wiring;
  - `surf do` workflow context.
- Sends JSON-line requests:
  ```text
  CLI → Unix socket / named pipe → host.cjs → extension/CDP → host.cjs → CLI
  ```
- Existing protocol shape must remain unchanged:
  ```js
  {
    type: "tool_request",
    method: "execute_tool",
    params: { tool, args },
    id,
    tabId?,
    windowId?
  }
  ```

Reusable code already present:

- `resolveSocketEndpoint()`, `assertClientSafeSocketPath()`, and `formatSocketClientError()` from `native/socket-path.cjs`.
- `openSocketConnection()` wrapper in `cli.cjs`; this should remain the only local socket open helper in CLI code.
- Existing CLI behavior tests in `native/tests/cli-tests.sh`.

Blocking risk:

- `native/cli.cjs` is large and has multiple socket call sites. Any future socket call site that bypasses `openSocketConnection()` can reintroduce hardcoded `/tmp/surf.sock` drift.

### Host server path — `native/host.cjs`

Relevant current responsibilities:

- Native messaging host process.
- Resolves socket endpoint from environment/default.
- Prepares Unix socket file before listening.
- Creates `net.createServer()`.
- Handles JSON-line socket clients and forwards requests to the browser extension through native messaging framing.
- Applies `chmod 0600` after listen on Unix.
- Cleans up owned socket endpoint on shutdown.

Reusable code already present:

- `prepareSocketEndpointForListen()` from `native/socket-path.cjs`.
- Existing signal cleanup hooks: `SIGTERM`, `SIGINT`, `stdin end`, `uncaughtException`.

Blocking/race point to validate:

- `cleanupSocketEndpoint()` is guarded by `ownsSocketEndpoint`. Ensure cleanup runs for any successfully bound socket, including startup-error paths. If the current `ownsSocketEndpoint` timing misses a bind-before-error edge, adjust only that lifecycle seam.

### MCP client path — `native/mcp-server.cjs`

Relevant current responsibilities:

- Exposes MCP tools/resources.
- Sends requests to the same local socket using `sendSocketRequest(tool, args, socketPath?)`.
- Formats socket responses into MCP tool/resource results.
- `PiChromeMcpServer` accepts `{ socketPath }`, and `surf server --socket-path <path>` passes the normalized path.

Reusable code already present:

- `resolveSocketEndpoint()`, `assertClientSafeSocketPath()`, `formatSocketClientError()`.

Contract constraint:

- MCP response formatting must not change. Only endpoint resolution/error mapping is in scope.

## Central socket module — `native/socket-path.cjs`

Current module responsibilities:

- Owns defaults:
  - Unix: `/tmp/surf.sock`
  - Windows: `//./pipe/surf`
- Resolves endpoint with precedence:
  1. explicit override flag;
  2. `SURF_SOCKET_PATH`;
  3. platform default.
- Produces endpoint shape:
  ```js
  {
    path: string,
    transport: "unix" | "pipe",
    source: "flag" | "env" | "default",
    isDefault: boolean
  }
  ```
- Unix validation:
  - non-empty;
  - no NUL;
  - absolute;
  - not filesystem root;
  - under platform byte limit;
  - existing directory rejected.
- Windows validation:
  - requires named-pipe form `//./pipe/NAME`;
  - normalizes backslashes to slashes.
- Client safety:
  - refuses existing non-socket files.
- Server listen safety:
  - creates custom parent dirs with `0700`;
  - refuses to remove non-socket files;
  - probes existing sockets;
  - active socket → `socket_path_in_use`;
  - stale refused socket → unlink;
  - cleanup only unlinks if target is still a socket.
- Error formatting preserves old UX:
  - ENOENT → `Socket not found. Is Chrome running with the extension?`
  - ECONNREFUSED → `Connection refused. Native host not running.`

Design decision:

- Do not add persistent `surf.json` socket-path config. `SURF_SOCKET_PATH` + `--socket-path` are enough and avoid config schema/migration risk.

## Session / Cloak side effects

ChatGPT headless paths are mostly independent of the local browser socket:

- `cli.cjs → chatgpt-cloak-bridge.cjs → chatgpt-cloak-worker.mjs / chatgpt-cloak-chats-worker.mjs`
- session persistence through `session-store.cjs`
- recovery through `session-reconciler.cjs`

Socket hardening must not modify:

- Cloak timeout semantics in `chatgpt-cloak-timeout.cjs`;
- session metadata schema;
- recovered response artifact behavior;
- chats formatter behavior.

Real ChatGPT validation should be a separate subagent because it depends on local profile/auth/Cloak runtime state.

# 3. Design

## A. Targeted change, not broad refactor

Use a targeted hardening pass. The trust boundary is localized to three modules (`cli.cjs`, `host.cjs`, `mcp-server.cjs`) and one shared helper (`socket-path.cjs`). A broader refactor of `cli.cjs` or native host dispatch would increase risk without improving the socket boundary. The JSON protocol, session system, and AI/Cloak paths remain unchanged.

## B. `native/socket-path.cjs` — canonical endpoint resolver

### Component

- **Name:** `socket-path.cjs`
- **Kind:** CommonJS utility module.
- **Why:** Existing codebase uses CJS in native runtime; a single utility prevents hardcoded socket constant drift.

### Owned state

No mutable module state. All functions are pure except filesystem/network checks.

### Public internal interfaces

Keep these exports as the only socket-boundary API:

```js
resolveSocketEndpoint({ overridePath?, env?, platform? }) -> SocketEndpoint
assertClientSafeSocketPath(endpoint) -> endpoint
prepareSocketEndpointForListen(endpoint, options?) -> Promise<{ cleanup() }>
formatSocketClientError(error, endpoint?) -> { code, message }
getUnixSocketPathLimit(platform?) -> number
```

Endpoint shape:

```js
SocketEndpoint = {
  path: string,
  transport: "unix" | "pipe",
  source: "flag" | "env" | "default",
  isDefault: boolean
}
```

### Validation contract

Unix:

- `overridePath` / `SURF_SOCKET_PATH` must be a non-empty absolute path.
- Reject NUL bytes.
- Normalize with `path.normalize()`.
- Reject normalized filesystem root.
- Reject overlong paths using `getUnixSocketPathLimit(platform)`.
- Reject existing directories.
- Do **not** reject `..` syntactically after normalization, because there is no trusted base directory to escape; the normalized absolute path is the actual OS path.

Windows:

- Only named-pipe paths are accepted.
- Normalize `\\.\pipe\surf-custom`-style input to `//./pipe/surf-custom` if current implementation supports slash replacement.
- Reject `C:\...` filesystem paths.

Client-side filesystem guard:

- If a Unix path exists and is not a socket, throw `socket_path_not_socket`.
- If it does not exist, allow connection attempt so ENOENT is formatted as the legacy “Chrome running?” message.

Server-side filesystem guard:

- For non-default Unix paths, create missing parent dirs with `0700`.
- Never unlink a regular file, directory, symlink-to-file, or other non-socket.
- Existing socket:
  - connect succeeds → reject as active/in-use;
  - ECONNREFUSED/ENOENT during probe → stale socket, unlink;
  - timeout → reject as in-use/unsafe;
  - other error → propagate.

Cleanup contract:

- `cleanup()` may unlink only if current path still exists and `lstat().isSocket()`.
- Cleanup must be idempotent.

### Error handling

Use stable error codes:

- `invalid_socket_path`
- `socket_path_not_socket`
- `socket_path_in_use`

Do not expose stack traces in CLI/MCP user output.

## C. `native/cli.cjs` — client integration

### Interfaces

Additive public CLI/env interface:

Before:

```text
surf <command> ...
```

After:

```text
surf <command> ... [--socket-path <path>]
SURF_SOCKET_PATH=/path/to/surf.sock surf <command> ...
```

Precedence:

1. `--socket-path`
2. `SURF_SOCKET_PATH`
3. default

### Required call-site behavior

All local socket opens in `cli.cjs` must go through one wrapper:

```js
openSocketConnection(onConnect) -> { endpoint, socket }
```

That wrapper must:

1. call `getSocketEndpoint()`;
2. call `assertClientSafeSocketPath(endpoint)`;
3. call `net.createConnection(endpoint.path, onConnect)`.

Call sites that must use it:

- script mode `sendScriptRequest()`;
- stream mode;
- generic `sendRequest()` for auto-capture;
- `startLegacySocketPath()`;
- any future helper that opens a local host socket.

`toolArgs["socket-path"]` must be deleted before building `request.params.args` so the extension/host protocol does not receive a new argument accidentally.

### `surf do` behavior

`do` has its own parser. It must preserve:

- `surf do 'tab.list' --socket-path /tmp/custom.sock`
- `SURF_SOCKET_PATH=/tmp/custom.sock surf do 'tab.list'`

Expected path:

```text
cli.cjs do parser
→ context.socketPath
→ executeDoSteps(...)
→ each nested socket request uses same override
```

Unknown to validate:

- `native/do-executor.cjs` is not included in the provided contents. Confirm it consumes `context.socketPath` and routes requests through the socket resolver or a compatible path. If it constructs a raw socket path itself, update it to use the same resolver/helper pattern.

### User-facing errors

Preserve compatible output strings:

- missing socket: `Error: Socket not found. Is Chrome running with the extension?`
- refused stale socket: `Error: Connection refused. Native host not running.`
- unsafe file: `Error: Refusing to use non-socket path: <path>`

## D. `native/host.cjs` — server integration

### Startup flow

Target startup flow:

```text
process env
→ resolveSocketEndpoint({ env: process.env, platform: process.platform })
→ prepareSocketEndpointForListen(endpoint)
→ server.listen(endpoint.path)
→ chmod 0600 on Unix
→ HOST_READY
```

### Lifecycle and ownership

- Host supports env/default only; no `--socket-path` flag is needed for Chrome native messaging host.
- Keep `chmod 0600` for Unix socket file.
- Ensure `socketEndpointLifecycle.cleanup()` runs on:
  - `SIGTERM`;
  - `SIGINT`;
  - `stdin end`;
  - startup failure after socket preparation;
  - uncaught exception.
- Validate whether `ownsSocketEndpoint` is set early enough. If not, adjust so a successfully bound socket is cleaned even if an error occurs before `HOST_READY`.

### Compatibility

No change to:

- `net.createServer()` request format;
- `handleToolRequest()`;
- extension native messaging framing;
- socket response format.

### Operational note

When using a non-default socket with Chrome-launched native host, the host process must receive `SURF_SOCKET_PATH` in its environment. Terminal env overrides affect CLI/MCP immediately but may not affect an already-running GUI-launched browser host. Document this in README if not already explicit enough.

## E. `native/mcp-server.cjs` — MCP integration

### Interfaces

Keep `sendSocketRequest()` backward compatible:

Before:

```js
sendSocketRequest(tool, args)
```

After:

```js
sendSocketRequest(tool, args, socketPath?)
```

`socketPath` is optional and treated as the explicit override. If omitted, `SURF_SOCKET_PATH` and default behavior apply.

`PiChromeMcpServer` constructor:

```js
new PiChromeMcpServer({ socketPath? })
```

### Data flow

```text
MCP tool/resource call
→ sendSocketRequest(name, args, this.socketPath)
→ resolve endpoint
→ assert client-safe path
→ net.createConnection(endpoint.path)
→ unchanged tool_request JSON line
→ host response
→ formatResult()
```

### `surf server --socket-path`

`cli.cjs` should remain responsible for parsing `surf server --socket-path <path>` and passing the normalized endpoint path into `new PiChromeMcpServer({ socketPath })`.

No protocol or MCP schema changes.

## F. Tests and validation design

### Unit tests — `test/unit/socket-path.test.ts`

Required coverage:

- default Unix endpoint;
- default Windows pipe endpoint;
- explicit flag beats env var;
- env var beats default;
- empty Unix path rejected;
- relative Unix path rejected;
- Windows filesystem path rejected;
- overlong Unix path rejected;
- existing regular file rejected for client;
- existing regular file refused before listen and preserved;
- stale Unix socket removed before listen;
- active socket reported in use;
- custom parent dirs created with `0700`;
- cleanup never deletes non-socket file.

### MCP tests — `test/unit/mcp-server.test.ts`

Required coverage:

- `sendSocketRequest()` honors custom socket path and preserves `tool_response` parsing.
- missing socket formats as “Socket not found...”.
- stale/refused socket formats as “Connection refused...”.

### CLI shell tests — `native/tests/cli-tests.sh`

Required coverage:

- `--help-full` includes `--socket-path <path>`.
- `surf tab.list --socket-path <stub>` reaches socket stub.
- `SURF_SOCKET_PATH=<stub> surf tab.list` reaches socket stub.
- `surf do 'tab.list' --socket-path <stub>` reaches socket stub.
- `SURF_SOCKET_PATH=<stub> surf do 'tab.list'` reaches socket stub.
- regular file path is rejected with “Refusing to use non-socket path”.

### Local gates

Run after implementation:

```text
npm run test
npm run check
npm run lint
bash native/tests/cli-tests.sh
```

If `npm run lint` reports unrelated pre-existing formatting issues, record them separately and ensure all socket-specific tests pass.

## G. Documentation updates

### `README.md`

Required sections:

- Environment Variables:
  - add/keep `SURF_SOCKET_PATH`.
  - explain default Unix/Windows endpoints.
  - explain Unix custom paths must be absolute.
  - explain Windows custom paths must use named-pipe form.
  - mention custom parent dirs are created by host when needed.
- Socket API:
  - replace hardcoded-only example with:
    ```bash
    SOCK="${SURF_SOCKET_PATH:-/tmp/surf.sock}"
    ```
  - state defaults remain backward-compatible.
  - state non-default endpoints require both client and host/MCP server to target the same path.

### Optional docs to validate

Unknown because contents were not provided:

- `skills/surf/SKILL.md`
- `CHANGELOG.md`

Validation approach:

- Search for hardcoded `/tmp/surf.sock` references after implementation.
- Update only user-facing docs/examples that would become misleading.

# 4. File-by-file impact

## `native/socket-path.cjs`

- **Change:** Keep/introduce canonical socket endpoint module.
- **Why:** Prevent drift among CLI, host, and MCP socket constants.
- **Key responsibilities:** defaults, precedence, Unix/Windows validation, client guard, listen preparation, stale-socket probing, cleanup, error formatting.
- **Depends on:** none.
- **Ordering:** implement first.

## `native/cli.cjs`

- **Change:** Route all socket opens through `openSocketConnection()`.
- **Change:** Parse global `--socket-path` before normal command parsing.
- **Change:** Remove `socket-path` from `toolArgs`.
- **Change:** Pass socket override into `surf server` and `surf do`.
- **Change:** Add help text for `--socket-path`.
- **Why:** CLI is the main local socket client and has the most call sites.
- **Depends on:** `native/socket-path.cjs`.

## `native/host.cjs`

- **Change:** Resolve endpoint through `resolveSocketEndpoint()`.
- **Change:** Prepare listen path through `prepareSocketEndpointForListen()`.
- **Change:** Use endpoint path for `server.listen()`.
- **Change:** Ensure cleanup lifecycle cannot leave owned socket files behind.
- **Why:** Host owns the server-side trust boundary and must never unlink non-socket files.
- **Depends on:** `native/socket-path.cjs`.

## `native/mcp-server.cjs`

- **Change:** Resolve socket endpoint in `sendSocketRequest()`.
- **Change:** Accept optional socket path in `sendSocketRequest()` and `PiChromeMcpServer`.
- **Change:** Preserve existing MCP response formatting and timeout behavior.
- **Why:** MCP is an independent socket client path.
- **Depends on:** `native/socket-path.cjs`.

## `native/do-executor.cjs`

- **Change:** Validate whether `context.socketPath` is already honored.
- **If needed:** route nested workflow socket requests through the same endpoint resolution behavior.
- **Why:** `surf do ... --socket-path` must be end-to-end, not only parsed.
- **Depends on:** `native/cli.cjs` context handoff.

## `test/unit/socket-path.test.ts`

- **Change:** Add focused resolver/listen/client safety tests.
- **Why:** Deterministic coverage for trust-boundary behavior.
- **Depends on:** `native/socket-path.cjs`.

## `test/unit/mcp-server.test.ts`

- **Change:** Add MCP custom socket and error-format tests.
- **Why:** MCP has independent socket client wiring.
- **Depends on:** `native/mcp-server.cjs`, `native/socket-path.cjs`.

## `native/tests/cli-tests.sh`

- **Change:** Add socket stub harness and CLI override assertions.
- **Why:** Verifies real CLI argument/env behavior without requiring Chrome extension.
- **Depends on:** `native/cli.cjs`.

## `README.md`

- **Change:** Document `SURF_SOCKET_PATH`, `--socket-path`, defaults, Unix/Windows constraints, and Socket API example.
- **Why:** Public behavior changed additively and must be discoverable.
- **Depends on:** implementation semantics.

# 5. Risks and migration

## Compatibility risks

- Existing clients using `/tmp/surf.sock` continue to work.
- Existing `nc -U /tmp/surf.sock` examples continue to work.
- New stricter behavior refuses existing non-socket paths instead of deleting/using them. This is intentional hardening and may surface as an error if a user has a regular file at `/tmp/surf.sock`.
- Empty `SURF_SOCKET_PATH` should be treated as invalid because the env var is explicitly set. Users should unset it to use defaults.

## Native host env risk

Terminal `SURF_SOCKET_PATH` may not propagate to a Chrome-launched native messaging host, especially on macOS GUI browser launches. For true end-to-end override, ensure both the client process and host process use the same endpoint. Tests can use a stub or manually launched host; live browser validation must record the actual host environment assumption.

## Rollback

No persisted data changes. Rollback is simple:

- remove use of `SURF_SOCKET_PATH` / `--socket-path`;
- default `/tmp/surf.sock` behavior remains compatible.

# 6. Subagent execution plan

Because this turn is text-only, no subagents or commands can be executed here. Dispatch these bounded subagents during implementation.

## Subagent 1 — implementation

Scope:

- `native/socket-path.cjs`
- `native/cli.cjs`
- `native/host.cjs`
- `native/mcp-server.cjs`
- `native/do-executor.cjs` only if required for `context.socketPath`
- tests/docs listed above

Deliverables:

- focused code changes only;
- no protocol changes;
- no session/Cloak changes;
- test output for focused socket tests and CLI shell tests.

## Subagent 2 — review/refactor

Scope:

- Read-only audit after Subagent 1.
- Search for duplicate socket constants and raw `net.createConnection("/tmp/surf.sock")`-style calls.
- Confirm error messages and docs match implementation.
- Confirm no coupling with:
  - `SURF_NETWORK_PATH`;
  - `SURF_SESSIONS_DIR`;
  - ChatGPT/Bun/Cloak env flags.

Deliverables:

- findings ordered by severity;
- exact file/line references;
- no broad refactor unless duplicate socket opening remains.

## Subagent 3 — real ChatGPT headless validation

Scope:

- Cloak-only, headless-only validation.
- No headed fallback unless diagnosing a blocker.

Commands to run with the known local profile:

```bash
SURF_USE_CLOAK_CHATGPT=1 node native/cli.cjs chatgpt \
  "Reply with exactly: surf-socket-ok" \
  --profile dsebban883@gmail.com \
  --model gpt-5.3 \
  --timeout 120 \
  --json
```

```bash
SURF_USE_CLOAK_CHATGPT=1 node native/cli.cjs chatgpt.chats \
  --limit 1 \
  --json \
  --profile dsebban883@gmail.com
```

Recovery-oriented validation:

1. Create isolated sessions dir.
2. Start a Cloak ChatGPT query in background with `SURF_SESSIONS_DIR=<tmp>`.
3. Poll session `output.log` until `[session] checkpoint: sent`.
4. Kill the local CLI process to simulate worker/client interruption after remote send.
5. Run:
   ```bash
   SURF_USE_CLOAK_CHATGPT=1 SURF_SESSIONS_DIR=<tmp> \
     node native/cli.cjs session --reconcile --network --all
   ```
6. View recovered session:
   ```bash
   SURF_SESSIONS_DIR=<tmp> node native/cli.cjs session <id>
   ```
7. Expected result:
   - `recovered` if remote response completed;
   - `unresolved` if ChatGPT still reports `in_progress`;
   - never silent loss without session metadata.

Deliverables:

- exact commands;
- stdout/stderr snippets;
- session ids and response artifact paths;
- exact blocker if auth/profile/Cloak fails.

# 7. Implementation order

1. **Central resolver first**
   - Finalize `native/socket-path.cjs`.
   - Run `test/unit/socket-path.test.ts`.

2. **CLI integration**
   - Wire `cli.cjs` to resolver for every socket call site.
   - Add global help text and strip `socket-path` from tool args.
   - Validate `surf do` socket override path; patch `do-executor.cjs` only if necessary.

3. **Host integration**
   - Wire startup/listen/cleanup through resolver and lifecycle helper.
   - Verify Unix socket permissions and cleanup behavior through unit coverage.

4. **MCP integration**
   - Wire `sendSocketRequest()` and `PiChromeMcpServer`.
   - Preserve MCP formatting and timeout behavior.

5. **Tests**
   - Add/confirm resolver unit tests.
   - Add/confirm MCP socket tests.
   - Extend `native/tests/cli-tests.sh`.

6. **Docs**
   - Update `README.md`.
   - Search for stale hardcoded socket docs and update only public-facing references.

7. **Local gates**
   - Run:
     ```text
     npm run test
     npm run check
     npm run lint
     bash native/tests/cli-tests.sh
     ```

8. **Review subagent**
   - Audit for duplicate constants/raw socket openings.
   - Fix only socket-boundary issues found.

9. **Real ChatGPT validation subagent**
   - Run Cloak headless query/chats/reconcile checks.
   - Record artifacts/blockers.

10. **Final report**
   - Summarize changed files.
   - Include verification results.
   - Call out any live ChatGPT blocker separately from local test status.


> 💡 Continue this plan conversation with ask_oracle(chat_id: "orchestrate-cloakbrowser-2B5267", new_chat: false)