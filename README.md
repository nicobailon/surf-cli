<p>
  <img src="surf-banner.png" alt="surf" width="1100">
</p>

# surf-cli

**Headless terminal AI for ChatGPT and Gemini.**

[![npm version](https://img.shields.io/npm/v/surf-cli?style=for-the-badge)](https://www.npmjs.com/package/surf-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

`surf` lets agents and shell scripts use signed-in ChatGPT and Gemini accounts from the terminal. It is local-first, prompt-file friendly, and built for long-running AI workflows.

```bash
npm install -g surf-cli

surf chatgpt "Review this patch" --file diff.patch --model pro --profile user@gmail.com
surf gemini "Summarize this dataset" --file data.csv --model gemini-3-pro --profile user@gmail.com
surf chatgpt.chats --search "release notes" --profile user@gmail.com
surf session --all
```

## What runs under the hood

- **ChatGPT**: CloakBrowser headless Chromium via CDP.
- **Gemini**: Bun WebView headless runtime.
- **Auth**: use an existing local profile with `--profile user@gmail.com`.
- **Agent integration**: `surf server` exposes the MCP server over stdio.
- **Sessions**: AI runs are logged under `~/.surf/sessions/` for inspection and reconciliation.

## Requirements

- Node.js and npm for the `surf` CLI.
- ChatGPT uses the bundled CloakBrowser runtime.
- Gemini requires `bun` on `PATH` for the Bun WebView runtime.
- `--profile <email>` profile selection is currently macOS-only; without it, ChatGPT uses `~/.surf/cloak-profile`.
- ChatGPT always runs through CloakBrowser in headless mode. `CLOAK_HEADLESS` cannot enable headed mode, and `SURF_USE_CLOAK_CHATGPT` is obsolete.

## Installation

```bash
npm install -g surf-cli
surf --version
```

For development:

```bash
git clone https://github.com/nicobailon/surf-cli.git
cd surf-cli
npm install
npm test
npm run check
```

Reusable RepoPrompt/Surf Oracle workflow:

- [`docs/workflows/surf-gpt-pro-oracle.md`](docs/workflows/surf-gpt-pro-oracle.md) — repo copy of the RepoPrompt workflow for detached GPT Pro oracle runs, polling, and recovery.

## Commands

### `surf chatgpt`

Send a prompt to ChatGPT through the CloakBrowser headless runtime.

```bash
surf chatgpt "Explain this error" --profile user@gmail.com
surf chatgpt --prompt-file prompt.md --model gpt-5.4-pro --profile user@gmail.com
surf chatgpt "Review this file" --file code.ts --model thinking --profile user@gmail.com
surf chatgpt "A robot surfing a neon wave" --generate-image /tmp/robot.png --profile user@gmail.com
```

Common options:

- `--profile <email>`: local profile email to use for signed-in auth.
- `--model <model>`: `instant`, `thinking`, `pro`, or provider model names such as `gpt-5.4-pro`.
- `--file <path>`: attach a file.
- `--prompt-file <path>`: read the prompt from a file. Use this for exported RepoPrompt context; `--file` uploads an attachment instead of inlining prompt text.
- `--generate-image <path>`: generate an image and save it.
- `--timeout <seconds>`: inactivity timeout. Default: `2700` seconds.
- Long GPT Pro runs emit periodic keepalive wait / remote-check lines instead of going silent.

### `surf gemini`

Send a prompt to Gemini through the Bun WebView headless runtime.

```bash
surf gemini "Explain quantum computing" --profile user@gmail.com
surf gemini "Analyze this CSV" --file data.csv --model gemini-3-pro --profile user@gmail.com
surf gemini "A robot surfing" --generate-image /tmp/gemini.png --aspect-ratio 16:9 --profile user@gmail.com
surf gemini "Add sunglasses" --edit-image photo.jpg --output edited.jpg --profile user@gmail.com
surf gemini "Summarize this video" --youtube "https://youtube.com/watch?v=..." --profile user@gmail.com
```

Common options:

- `--profile <email>`: local profile email to use for signed-in auth.
- `--model <model>`: Gemini model name, such as `gemini-3-pro`, `gemini-2.5-pro`, or `gemini-2.5-flash`.
- `--file <path>`: attach a file.
- `--generate-image <path>`: generate an image and save it.
- `--edit-image <path> --output <path>`: edit an existing image.
- `--youtube <url>`: analyze a YouTube video URL.
- `--aspect-ratio <ratio>`: image ratio such as `1:1` or `16:9`.
- `--timeout <seconds>`: request timeout. Default: `300` seconds.

### `surf chatgpt.chats`

List, search, view, export, rename, delete, and download ChatGPT conversation data.

```bash
surf chatgpt.chats --profile user@gmail.com
surf chatgpt.chats --search "auth bug" --profile user@gmail.com
surf chatgpt.chats <conversation-id> --profile user@gmail.com
surf chatgpt.chats <conversation-id> --export /tmp/chat.md --format markdown --profile user@gmail.com
surf chatgpt.chats <conversation-id> --rename "New title" --profile user@gmail.com
surf chatgpt.chats <conversation-id> --download-file file-abc --output /tmp/file.bin --profile user@gmail.com
```

Useful options:

- `--limit <n>`: list count or last N visible messages when viewing.
- `--all`: fetch all conversations.
- `--search <query>`: search conversation titles and content.
- `--export <path>` and `--format markdown|json`: save a viewed conversation. Export waits briefly for a pending assistant turn before rendering.
- `--rename <title>`: rename a conversation.
- `--delete` or `--delete-ids <ids>`: delete conversations.
- `--download-file <file-id> --output <path>`: download an attachment.
- `--no-cache`: bypass local chats cache.
- Export/reconcile assistant waits use a longer default window for GPT Pro late completions.

RepoPrompt / oracle export note:

- Use `--prompt-file` for exported context, never `--file`.
- If RepoPrompt export stats show `Files: 0`, rebuild the selection/preset before sending.

### `surf chatgpt.reply`

Reply inside an existing ChatGPT conversation.

```bash
surf chatgpt.reply <conversation-id> "Follow up with a shorter version" --profile user@gmail.com
surf chatgpt.reply <conversation-id> --prompt-file followup.md --model gpt-5.4-thinking --profile user@gmail.com
```

### `surf session`

Inspect and clean up saved AI sessions.

```bash
surf session
surf session --all
surf session <session-id>
surf session --reconcile
surf session --reconcile --network
surf session --clear
surf session --clear --hours 24
```

Session records include stderr logs, results, model metadata, conversation IDs, process IDs, and reconciliation status.
`--reconcile --network` is the fallback lane for late remote completions that landed upstream after the local query path stalled or exited.

### `surf do`

Parse and run supported commands as a workflow.

```bash
surf do 'chatgpt "Draft release notes" --profile user@gmail.com | gemini "Make it concise" --profile user@gmail.com'
surf do 'chatgpt "Review this" --file diff.patch --profile user@gmail.com' --dry-run
surf do --file workflow.json --on-error continue
```

Use `--dry-run` to validate a workflow without executing it.

### `surf server`

Start the MCP server for AI-agent integration over stdio.

```bash
surf server
```

Use this when configuring an MCP-capable agent to call surf tools directly.

## Model shortcuts

ChatGPT accepts both shortcuts and provider names:

| Shortcut | Maps to |
| --- | --- |
| `instant` | fast ChatGPT model |
| `thinking` | reasoning ChatGPT model |
| `pro` | highest-capability ChatGPT model |

You can also pass explicit model names, for example `gpt-5.4-pro` or `gemini-3-pro`.

## Profile auth

Use `--profile user@gmail.com` on ChatGPT and Gemini commands to select the local signed-in profile for that account.

```bash
surf chatgpt "Hello" --profile user@gmail.com
surf gemini "Hello" --profile user@gmail.com
```

If auth is missing or expired, sign in with the relevant account in that local profile, then retry the command.

## Files and images

Attach files:

```bash
surf chatgpt "Review this" --file code.ts --profile user@gmail.com
surf gemini "Summarize" --file report.pdf --profile user@gmail.com
```

Generate images:

```bash
surf chatgpt "A watercolor lighthouse" --generate-image /tmp/lighthouse.png --profile user@gmail.com
surf gemini "A cyberpunk cat" --generate-image /tmp/cat.png --aspect-ratio 1:1 --profile user@gmail.com
```

Edit images with Gemini:

```bash
surf gemini "Remove the background" --edit-image photo.jpg --output cutout.png --profile user@gmail.com
```

## MCP integration

Start the stdio MCP server:

```bash
surf server
```

Then point your MCP-capable agent at the `surf` binary with the `server` argument.

## Troubleshooting

- Run `surf --help` for the current command summary.
- Run `surf <command> --help` for command-specific options.
- Run `surf session <id>` to inspect a failed or long-running AI request.
- Long GPT Pro waits should show `… still waiting` / `↻ checking remote completion` keepalive lines while Surf monitors the run.
- Use `--timeout <seconds>` for long prompts, file uploads, or image generation.
- Use `--profile <email>` consistently when multiple local accounts are signed in.
- If you see `Files: 0` in RepoPrompt export stats, do not send that export to ChatGPT yet.

## License

MIT
