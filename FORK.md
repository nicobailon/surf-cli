# RE:Surf

**A WSL2-hardened, security-patched fork of [surf-cli](https://github.com/nicobailon/surf-cli).**

Forked from `nicobailon/surf-cli` v2.7.1 on 2026-03-15.

## Why This Fork Exists

surf-cli is an excellent browser automation tool for AI agents. However, running it on WSL2 (Windows Subsystem for Linux) — where Chrome is a Windows app but the CLI and native host run in Linux — exposes several gaps. Additionally, a security audit found critical vulnerabilities in the upstream code.

## Changes from Upstream

### Security Fixes (`native/host.cjs`, `native/cli.cjs`)

| ID | Severity | Fix |
|----|----------|-----|
| C1 | CRITICAL | **Command injection in `resizeImage()`** — replaced `execSync` with template strings to `execFileSync` with argument arrays. Input sanitization on `maxSize` and `filePath`. |
| H3 | HIGH | **Buffer overflow** — added 50MB max message size check on native messaging input buffer to prevent memory exhaustion from malformed length headers. |
| P3/H5 | HIGH | **Log exhaustion** — truncated logged messages to 500 chars to prevent disk exhaustion from base64 screenshot data. |

### Socket Conflict Prevention (`native/host.cjs`)

- **PID lockfile** — each host writes `/tmp/surf.sock.pid` on startup. Before deleting an existing socket, the new host checks if the owning PID is still alive. If it is, the new host exits gracefully with `HOST_DUPLICATE` instead of stomping the socket.
- **Clean shutdown** — lockfile removed on SIGTERM, SIGINT, and stdin close (extension disconnect).
- **Prevents the race condition** where two Chrome profiles launch native hosts simultaneously, each deleting the other's socket.

### WSL2 Native Messaging (`scripts/install-native-host.cjs`)

- **WSL2 detection** — `isWSL()` reads `/proc/version` for "microsoft"/"wsl"
- **Windows-side manifest** — on WSL2, also writes manifest to `C:\Users\<user>\AppData\Local\Google\Chrome\User Data\NativeMessagingHosts\`
- **Manifest merging** — running the installer with a new extension ID appends to `allowed_origins` instead of overwriting. Supports multiple Chrome profiles.
- **Wrapper arg forwarding** — both `.sh` and `.bat` wrappers now forward `"$@"` / `%*` to pass Chrome's extension origin arg through to the host.

### CLI Improvements (`native/cli.cjs`)

- **`SURF_SOCKET` env var** — respected at startup (was documented in help but not wired up)
- **Better error messages** — show socket path and suggest `SURF_SOCKET`/`--socket` in error output

### Config (`biome.json`)

- **VCS-aware** — enabled git integration so biome respects `.gitignore`

### Documentation

- **`FORK.md`** — this file
- **`docs/AUDIT-2026-03-15.md`** — full security audit: 4 critical, 7 high, 9 medium findings with remediation guidance

## Remaining Audit Items (Not Yet Fixed)

| ID | Severity | Issue |
|----|----------|-------|
| C2 | CRITICAL | Arbitrary file write via `savePath` — needs allowlist |
| C3 | CRITICAL | Auth credential exposure via unauthenticated socket |
| C4 | CRITICAL | Unrestricted JS execution via unauthenticated socket |
| H1 | HIGH | No authentication on Unix socket |
| H2 | HIGH | `pendingToolRequests` Map grows without bounds |
| M1-M3 | MEDIUM | Massive code duplication (~5x AI client boilerplate, resizeImage duplicated) |
| M7 | MEDIUM | `handleApiRequest` acts as open HTTP proxy |

## Upstream Contributions

- Issue: [nicobailon/surf-cli#68](https://github.com/nicobailon/surf-cli/issues/68) — Native messaging fails on WSL2
- PR: [nicobailon/surf-cli#69](https://github.com/nicobailon/surf-cli/pull/69) — WSL2 native messaging support + manifest merging

## Maintainer

- **SeMmy** (Daniel) — [github.com/SeMmyT](https://github.com/SeMmyT)
