---
name: surf
description: Run the headless-only surf CLI for ChatGPT and Gemini terminal workflows.
---

# Surf

Headless terminal AI via local signed-in browser profiles.
Prefer real CLI execution over guessed provider APIs.

Repo + local CLI verified against **surf-cli v2.11.1**.

## Use when

- ChatGPT prompts, file review, prompt-file runs, image generation
- Gemini prompts, file/video analysis, image generation/editing
- ChatGPT conversation list/search/view/export/reply/manage flows
- Long-running browser-session AI from shell, tmux, or agent workflows

## Defaults

- Headless-only CLI.
- ChatGPT uses CloakBrowser headless by default.
- Gemini uses Bun WebView headless by default.
- Default profile on macOS: `dsebban883@gmail.com` unless the user asks for another account.
- Use `--profile dsebban883@gmail.com` for reliable auth and file/image/chats features.

## Sanity check

```bash
surf --version
surf --help
surf chatgpt.chats --limit 1 --profile dsebban883@gmail.com
```

## ChatGPT

```bash
surf chatgpt "explain this code" --profile dsebban883@gmail.com
surf chatgpt "review this PR" --file diff.patch --profile dsebban883@gmail.com
surf chatgpt --prompt-file prompt.md --model gpt-5.4-pro --profile dsebban883@gmail.com
surf chatgpt "a robot surfing" --generate-image /tmp/robot.png --profile dsebban883@gmail.com
surf chatgpt "deep analysis" --model gpt-5.4-pro --profile dsebban883@gmail.com
```

`--prompt-file` reads the file as prompt text. Use it for large exported contexts. `--file` uploads as an attachment.

### ChatGPT model aliases

- `instant`, `gpt-5.3`, `gpt-4o`, `gpt-4.1`, `gpt-4.1-mini` → GPT-5.3 Instant
- `thinking`, `gpt-5.4-thinking`, `o3`, `o4-mini` → GPT-5.4 Thinking
- `pro`, `gpt-5.4-pro`, `chatgpt-pro`, `o1-pro` → GPT-5.4 Pro

## ChatGPT conversations

```bash
surf chatgpt.chats --limit 20 --profile dsebban883@gmail.com
surf chatgpt.chats --search "auth system" --profile dsebban883@gmail.com
surf chatgpt.chats <conversation-id> --profile dsebban883@gmail.com
surf chatgpt.chats <conversation-id> --export /tmp/chat.md --profile dsebban883@gmail.com
surf chatgpt.chats <conversation-id> --export /tmp/chat.json --format json --json --profile dsebban883@gmail.com
surf chatgpt.reply <conversation-id> "follow-up" --profile dsebban883@gmail.com
surf chatgpt.reply <conversation-id> --prompt-file followup.md --model gpt-5.4-thinking --profile dsebban883@gmail.com
surf chatgpt.chats <conversation-id> --rename "New Title" --profile dsebban883@gmail.com
surf chatgpt.chats <conversation-id> --delete --profile dsebban883@gmail.com
surf chatgpt.chats <conversation-id> --download-file <file-id> --output /tmp/file.txt --profile dsebban883@gmail.com
```

Notes:
- `--delete` is destructive; no CLI undo.
- Search may use a recent-history fallback; if JSON shows `partial: true`, misses are not authoritative for older chats.
- `--download-file` needs `--output`.

## ChatGPT thinking trace

Pro/Thinking models stream live thinking content via `🧠` lines.

```bash
surf chatgpt "complex problem" --model gpt-5.4-pro --profile dsebban883@gmail.com
```

## Gemini

```bash
surf gemini "explain quantum computing" --profile dsebban883@gmail.com
surf gemini "analyze this chart" --file chart.jpg --profile dsebban883@gmail.com
surf gemini "reason about this architecture" --model thinking --profile dsebban883@gmail.com
surf gemini "advanced math problem" --model pro --profile dsebban883@gmail.com
surf gemini "a robot surfing" --generate-image /tmp/robot.png --profile dsebban883@gmail.com
surf gemini "wide banner" --generate-image /tmp/banner.png --aspect-ratio 16:9 --profile dsebban883@gmail.com
surf gemini "add sunglasses" --edit-image photo.jpg --output out.jpg --profile dsebban883@gmail.com
```

### Gemini model notes

Gemini 3 tiers (use `--model <alias>`):

- **Fast** (default): `gemini-3-pro`, `fast`, `gemini-2.5-flash`
- **Thinking**: `thinking`, `gemini-2.5-pro`, `gemini-3.1-thinking`
- **Pro** (3.1 Pro): `pro`, `gemini-3.1-pro-preview`, `gemini-3.1-pro`

Unknown model names are passed through to the UI picker best-effort.

## Workflows

```bash
surf do 'chatgpt "Draft release notes" --profile dsebban883@gmail.com | gemini "Make it concise" --profile dsebban883@gmail.com'
surf do 'chatgpt "Review this" --file diff.patch --profile dsebban883@gmail.com' --dry-run
```

For RepoPrompt → GPT Pro oracle runs, use:

- `docs/workflows/surf-gpt-pro-oracle.md`

## Sessions & reconciliation

Every surf AI command creates a session in `~/.surf/sessions/`.

```bash
surf session
surf session <id>
surf session --reconcile
surf session --reconcile --network
```

For long runs, use tmux:

```bash
tmux new -d -s surf-chat "bash -lc 'surf chatgpt \"complex analysis\" --model gpt-5.4-pro --profile dsebban883@gmail.com --timeout 3000 2>&1 | tee /tmp/surf-chatgpt.log'"
tail -f /tmp/surf-chatgpt.log
```

During long GPT Pro runs, expect keepalive lines such as:
- `… still waiting — Reasoning`
- `↻ checking remote completion — assistant_in_progress`

If the local query path exits after send, surf now attempts bounded remote recovery automatically before surfacing failure. Manual fallback remains:

```bash
node native/cli.cjs session --reconcile --network
node native/cli.cjs chatgpt.chats <conversation-id> --export /tmp/chat.md --format markdown --profile dsebban883@gmail.com
```

## Troubleshooting

- `--profile` is macOS-only.
- `--with-page` is not supported.
- Page-context/browser-extension commands were removed.
- Default ChatGPT timeout: **2700s**.
- If auth fails, sign in with the same local profile and retry.
- Use `surf session <id>` to inspect stderr/result details.
