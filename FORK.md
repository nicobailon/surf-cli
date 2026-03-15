# RE:Surf

**A WSL2-hardened fork of [surf-cli](https://github.com/nicobailon/surf-cli).**

Forked from `nicobailon/surf-cli` v2.7.1 on 2026-03-15.

## Why This Fork Exists

surf-cli is an excellent browser automation tool for AI agents. However, running it on WSL2 (Windows Subsystem for Linux) — where Chrome is a Windows app but the CLI and native host run in Linux — exposes several gaps:

1. **Native messaging manifest only installed to Linux path** — Chrome on WSL2 reads from Windows AppData, not `~/.config/google-chrome/`. New extension IDs silently fail with "Access to the specified native messaging host is forbidden."

2. **Shell wrapper doesn't forward Chrome's arguments** — Chrome passes the extension origin as a CLI arg to the native host. The wrapper script (`host-wrapper.sh`) didn't include `"$@"`, so the host never received it.

3. **Error messages don't show socket path** — When connection fails, the error says "Socket not found" without saying WHERE it looked, making debugging on WSL2 (where paths are non-obvious) unnecessarily hard.

4. **No `SURF_SOCKET` env var at init** — Documented in help text but not actually wired up at startup.

## Changes from Upstream

### `scripts/install-native-host.cjs`
- **WSL2 detection** — `isWSL()` reads `/proc/version` for "microsoft"/"wsl"
- **Windows-side manifest** — On WSL2, also writes manifest to `C:\Users\<user>\AppData\Local\Google\Chrome\User Data\NativeMessagingHosts\`
- **Manifest merging** — Running the installer with a new extension ID appends to `allowed_origins` instead of overwriting. Supports multiple Chrome profiles.
- **Wrapper arg forwarding** — Both `.sh` and `.bat` wrappers now forward `"$@"` / `%*`

### `native/cli.cjs`
- **`SURF_SOCKET` env var** — Respected at startup (was only used in `--socket` flag)
- **Better error messages** — Show socket path and suggest `SURF_SOCKET`/`--socket` in error output

## Upstream Contributions

These fixes are submitted as PRs to the upstream repo. If merged, this fork can be archived.

## Maintainer

- **SeMmy** (Daniel) — [github.com/SeMmyT](https://github.com/SeMmyT)
