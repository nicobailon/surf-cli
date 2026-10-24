# Troubleshooting

## Can't connect

`Socket connect failed` means the CLI can't reach the native host that Chrome starts.

1. Run `surf doctor` (`surf doctor --browser all` for Brave, Edge, Arc, Helium and others) and read its `Attempted socket:` line.
2. The default socket is `/tmp/surf.sock` (Windows `//./pipe/surf`). If `SURF_SOCKET` is set, Chrome's host and your shell must use the same value.
3. macOS: Chrome reads `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/surf.browser.host.json`. Its `allowed_origins` id must match the extension id on `chrome://extensions`. If not, run `surf install <extension-id>`, restart Chrome, and reload the extension.
4. WSL2 with Windows Chrome: run `surf install <extension-id>` inside WSL2. Add `--target linux` only for a Linux browser running in WSLg.
5. Extension logs: open Surf's service-worker console from `chrome://extensions`. For more detail, turn on Debug Mode under Details > Extension options, reproduce, then turn it off.

## Slow or busy

- The first browser command after a while takes 5–8 s while the debugger attaches; later ones are fast.
- Commands on one tab run in order; other tabs run in parallel; AI sites take the whole browser. `--no-wait` returns `tab_busy` or `browser_busy` instead of waiting, and `surf session.info <name> --refresh` shows what is queued.
- `--auto-capture` saves a screenshot and console log to `/tmp/surf-error-*.png` when a command fails.

## AI sites

- "login required": ask the user to log in to that site in Chrome.
- A model or page-element error usually means the site changed. Run `surf grok --validate` or `surf kimi --validate` to see the models the site offers (`surf grok --validate --save-models` also stores them), then retry with a listed `--model` and a longer `--timeout`.
- AI Studio gives less filtered Gemini models with strict daily limits; its `--model` is best effort.
- For exhaustive research on X, use the `deep-x-research` skill instead of one Grok question.

## Isolation

Sessions share the Chrome profile: cookies, storage, downloads and history. For hard isolation, run a separate browser profile with its own `SURF_SOCKET`.
