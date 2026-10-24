# Remote browser host

Drive Chrome on another machine (for example over Tailscale). Network reachability is not permission: each client needs its own credential, and that credential carries full Surf authority over the browser.

## On the browser host (macOS or Linux)

```bash
surf remote authorize laptop --output ./laptop.json      # mode 0600; move it to the client securely
surf install <extension-id> --listen 100.101.102.103:4321
surf remote list
surf remote revoke laptop
```

## On the client

```bash
surf --remote 100.101.102.103:4321 --remote-credential ./laptop.json page.read
```

`SURF_REMOTE` and `SURF_REMOTE_CREDENTIAL` set the same thing for every command. For TLS, put a TLS-terminating reverse proxy in front of the listener and add `--remote-tls` (`SURF_REMOTE_TLS=1`); `--remote-tls-ca <pem>` (`SURF_REMOTE_TLS_CA`) replaces the system roots, and `SURF_REMOTE_TLS_SERVER_NAME` overrides the name checked.

## Files

- Paths are on the client by default (`local:./file` says so explicitly); `remote:/absolute/path` means a file on the browser host.
- Per command: one upload or AI-site input file, plus one screenshot, network export or image output. Action screenshots and `--auto-capture` files come back to client paths.
- Limits: 256 MiB per file, 512 MiB and 32 files per connection.
- Not available remotely: `record`, `video.*`, `aistudio.build`, smoke screenshot folders, folders, and several input files at once.

## Sharing locally instead

`surf install <extension-id> --socket-mode 660 --socket-group <group>` lets every member of that group use the local socket with full authority, so use a small dedicated group. Run `surf install <extension-id>` without those flags to undo it.
