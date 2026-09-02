<p>
  <img src="surf-banner.png" alt="surf" width="1100">
</p>

# Surf

**The CLI for AI agents to control Chrome. Zero config, agent-agnostic, battle-tested.**

[![npm version](https://img.shields.io/npm/v/surf-cli?style=for-the-badge)](https://www.npmjs.com/package/surf-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows-blue?style=for-the-badge)]()

> See [CHANGELOG](CHANGELOG.md) for current release notes.

```bash
surf go "https://example.com"
surf read
surf click e5
surf snap
```

## Why Surf

Browser automation for AI agents is harder than it looks. Most tools require complex setup, tie you to specific AI providers, or break on real-world pages.

Surf takes a different approach:

**Agent-Agnostic** - Pure CLI commands over Unix socket. Works with Claude Code, GPT, Gemini, Cursor, custom agents, shell scripts - anything that can run commands.

**Zero Config** - Install the extension, run commands. No MCP servers to configure, no relay processes, no subscriptions.

**Battle-Tested** - Built by reverse-engineering production browser extensions and methodically working through agent-hostile pages like Discord settings. Falls back gracefully when CDP fails.

**Smart Defaults** - Screenshots auto-resize to 1200px (saves tokens). Actions auto-capture screenshots (saves round-trips). Errors on restricted pages warn instead of fail.

**AI Without API Keys** - Query ChatGPT, Gemini, Perplexity, and Grok using your existing browser logins. No API keys needed.

**Network Capture** - Automatically logs all network requests while active. Filter, search, and replay API calls without manually setting up request interception.

## Comparison

| Feature | Surf | Manus | Claude Extension | DevTools MCP | dev-browser |
|---------|------|-------|------------------|--------------|-------------|
| Agent-agnostic | Yes | No (Manus only) | No (Claude only) | Partial | No (Claude skill) |
| Zero config | Yes | No (subscription) | No (subscription) | No (MCP setup) | No (relay server) |
| Self-hosted (local or Tailnet) | Yes | No (cloud) | Partial | Yes | Partial |
| CLI interface | Yes | No | No | No | No |
| Free | Yes | No | No | Yes | Yes |
| AI via browser cookies | Yes | No | No | No | No |

## Installation

### Quick Start

```bash
# 1. Install globally
npm install -g surf-cli

# 2. Load extension in Chrome
#    - Open chrome://extensions
#    - Enable "Developer mode"
#    - Click "Load unpacked"
#    - Paste the path from: surf extension-path

# 3. Install native host (copy extension ID from chrome://extensions)
surf install <extension-id>

# 4. Restart Chrome and test
surf tab.list
```

### Multi-Browser Support

```bash
surf install <extension-id>                    # Chrome (default)
surf install <extension-id> --browser brave    # Brave
surf install <extension-id> --browser helium   # Helium
surf install <extension-id> --browser all      # All supported browsers
surf install <extension-id> --target linux     # WSLg/Linux browser from WSL2
```

Supported: `chrome`, `chromium`, `brave`, `edge`, `arc`, `helium`

**WSL2 with Windows Chrome**
When you run `surf install <extension-id>` inside WSL2, Surf detects WSL2 and installs a Windows-side native messaging manifest for Windows Chrome/Brave/Edge by default. The generated Windows wrapper launches the WSL2 host with `wsl.exe`, so `surf` commands run inside WSL2 still connect to the WSL socket.

If you use a Linux browser inside WSLg instead, install with:
```bash
surf install <extension-id> --target linux
```

Restart Windows Chrome after installing. If the extension reports `Access to the specified native messaging host is forbidden`, rerun `surf install <extension-id>` from the same WSL distro and confirm the extension ID was copied from `chrome://extensions`.

**Package Manager Installs (Nix, Homebrew, etc.)**
If surf is installed via a package manager that stores binaries in non-standard locations, set these environment variables before running `surf install`:
```bash
export SURF_NODE_PATH=/path/to/node
export SURF_HOST_PATH=/path/to/native/host.cjs
export SURF_EXTENSION_PATH=/path/to/extension/dist
```
See [Environment Variables](#environment-variables) for details.

### Uninstall

```bash
surf uninstall                  # Chrome only
surf uninstall --all            # All browsers + wrapper files
surf uninstall --target linux   # Remove WSLg/Linux-browser config from WSL2
```

### Remote Surf over Tailscale

Remote Surf runs the browser and native host on one Tailnet machine while the CLI runs on another. The listener is available only while the browser extension's native-messaging connection is alive. Tailnet reachability is not authorization: every remote client also needs its own Surf credential.

On the browser host, authorize a client before installing the listener:

```bash
surf remote authorize agent-macbook --output ~/agent-macbook.surf-credential.json
surf remote list
surf install <extension-id> --listen 100.101.102.103:4321
```

`authorize` creates a mode-0600 credential containing the client's Ed25519 private identity and the pinned host identity. Move it to that client through an existing secure channel, then remove the generated copy from the host if it is no longer needed there. The host keeps only the client's public identity in `~/.surf/remote/remote-clients.json`.

From the authorized client:

```bash
surf --remote 100.101.102.103:4321 \
  --remote-credential ~/.config/surf/agent-macbook.json \
  tab.list

# Environment equivalent
SURF_REMOTE=100.101.102.103:4321 \
SURF_REMOTE_CREDENTIAL=~/.config/surf/agent-macbook.json \
  surf tab.list
```

Surf performs mutual Ed25519 challenge-response with fresh nonces and checks authorization throughout the connection. A credential grants the same browser and host-file authority as a trusted local Surf user. Give each client its own credential, do not share it, and revoke it immediately if the client or file is lost:

```bash
surf remote revoke agent-macbook
surf remote list
```

`--remote <host>:<port>` takes precedence over `SURF_REMOTE`; `--remote-credential` takes precedence over `SURF_REMOTE_CREDENTIAL`. A selected remote endpoint overrides `SURF_SOCKET` and the default local socket. Local and remote requests share the same host scheduler: each tab has a FIFO lane, different tabs may execute concurrently, and browser-wide writers are exclusive. Disconnects and timeouts abort queued or in-flight work and retain admission until request-owned cleanup drains or the hard deadline is reached. Browser side effects that already completed are not rolled back.

`surf install --listen` persists the explicit Tailnet address in the native-host wrapper. Re-run `surf install` without `--listen` to remove it. The address must be a Tailscale IPv4 or IPv6 address with a port; Surf does not bind every interface. Remote listeners currently require a POSIX browser host and are not supported by Windows native-host wrappers.

Keep Tailscale policy restrictions as defense in depth. For example:

```json
{
  "acls": [
    {
      "action": "accept",
      "src": ["tag:surf-agent"],
      "dst": ["tag:surf-browser:4321"]
    }
  ]
}
```

Adapt tags and ports to your Tailnet. Surf authentication does not replace Tailnet policy, and Surf does not add a separate TLS or SSH tunnel.

**Operations and troubleshooting**

```bash
tailscale status
tailscale ping 100.101.102.103
surf doctor --remote 100.101.102.103:4321 \
  --remote-credential ~/.config/surf/agent-macbook.json
```

Use `tailscale status` and `tailscale ping` to confirm reachability, then use `doctor` to verify endpoint selection and authentication.

**Remote filesystem and transfer semantics**

Unprefixed paths and `local:` paths refer to the client. Only `remote:/absolute/path` refers directly to the browser host. For example:

```bash
surf --remote "$SURF_REMOTE" --remote-credential "$SURF_REMOTE_CREDENTIAL" \
  upload --ref e5 --files ./client-file.pdf
surf --remote "$SURF_REMOTE" --remote-credential "$SURF_REMOTE_CREDENTIAL" \
  screenshot --output local:./shot.png
surf --remote "$SURF_REMOTE" --remote-credential "$SURF_REMOTE_CREDENTIAL" \
  network.export --output remote:/var/tmp/network.har --har
```

Client-local inputs are staged privately on the host and removed after the request. Client-local outputs are downloaded with size/hash verification and atomic destination replacement. `surf js --file` and `perf-audit --output` are handled by the client itself. `network.export` defaults to a generated client-local `.json`, `.jsonl`, or `.har` path. Gemini edits default to client-local `edited.png`. Successful remote actions transfer their automatic screenshot to a generated client-local path; `--auto-capture` on failure remains a separate screenshot and console diagnostic.

The remote single-file boundary supports one `upload` file, one ChatGPT attachment, or one Gemini attachment/edit input, plus one screenshot, network export, or Gemini image output. Transfers are limited to 256 MiB per file, 512 MiB and 32 files per connection, with 256 KiB decoded chunks. Remote `record`, `aistudio.build`, smoke screenshot directories, directory transfer, and multi-file inputs are intentionally rejected. A `remote:` path bypasses transfer and gives the trusted client direct authority over that absolute host path.

### Development Setup

```bash
git clone https://github.com/nicobailon/surf-cli.git
cd surf-cli
npm install
npm run build
# Then load dist/ as unpacked extension
```

## Usage

```bash
surf <command> [args] [options]
surf --help                    # Basic help
surf --llm-context             # Compact reference for AI agents
surf --help-full               # All 50+ commands
surf <command> --help          # Command details
surf --find <query>            # Search commands
```

### Navigation

```bash
surf go "https://example.com"
surf back
surf forward
surf tab.reload --hard
```

### Reading Pages

```bash
surf read                           # Accessibility tree + visible text content
surf read --no-text                 # Accessibility tree only (no text)
surf read --depth 3                 # Limit tree depth (smaller output)
surf read --compact                 # Remove empty structural elements
surf read --depth 3 --compact       # Both (60% smaller output)
surf read --max-bytes 2000          # Cap visible text on a UTF-8 byte boundary
surf page.text                      # Raw text content only
surf page.html                      # Rendered document HTML
surf page.html --strip-scripts > artifact.html # Save a safe static Claude artifact
surf page.save --selector "#artifact" --strip-scripts --output artifact.html # Save one rendered element
surf page.state                     # Modals, loading state, scroll position
```

Use `surf page.html --strip-scripts` after the page loads when you need a static export of a Claude artifact or other rendered DOM. Use `--selector <css>` to export one element. Both commands target the active frame when `frame.switch` is active.

Element refs (`e1`, `e2`, `e3`...) are stable identifiers from the accessibility tree - semantic, predictable, and resilient to DOM changes.

### Semantic Locators

Find and interact with elements by role, text, or label - no refs or selectors needed:

```bash
# By ARIA role
surf locate.role button --name "Submit"           # Find button
surf locate.role button --name "Submit" --action click  # Find and click
surf locate.role textbox --action fill --value "hello"  # Find and fill
surf locate.role link --all                       # List all links

# By text content  
surf locate.text "Sign In" --action click         # Click element with text
surf locate.text "Accept" --exact                 # Exact match only

# By form label
surf locate.label "Email" --action fill --value "test@example.com"
```

### Iframe Support

Work with content inside iframes:

```bash
surf frame.list                     # List all frames
surf frame.switch --index 0         # Switch to first iframe
surf frame.switch --name "payment"  # Switch by frame name
surf frame.switch --selector "#checkout-frame"  # Switch by CSS selector

# Now all commands target the iframe
surf read                           # Read iframe content
surf click e5                       # Click in iframe
surf type "4242" --into "#card-number"
surf locate.role button --action click

surf frame.main                     # Return to main page
```

### Interaction

```bash
surf click e5                       # Click by element ref
surf click --selector ".btn"        # Click by CSS selector
surf click 100 200                  # Click by coordinates
surf type "hello" --submit          # Type at the current focus with CDP events
surf type "email@example.com" --ref e12  # Fill an element from page.read
surf type "hello" --into "#message"     # Fill a selector in the active frame
surf key Escape                     # Press key
surf scroll down 800                # Scroll down 800px
surf scroll bottom                  # Scroll to bottom
surf scroll.bottom                  # Dot command form also works
```

### Forms

Select options in dropdown menus:

```bash
surf select e5 "US"                         # Select by value
surf select "#country" "US"                 # Select by CSS selector
surf select e5 "opt1" "opt2"                # Multi-select
surf select e5 --by label "United States"   # Select by visible text
surf select e5 --by index 0                 # Select first option
```

### Element Inspection

Get computed styles from elements:

```bash
surf element.styles e5              # Get styles by ref
surf element.styles ".header"       # Get styles by CSS selector (can return multiple)
```

Returns font, color, background, border, padding, and bounding box for design debugging.

### Screenshots

Screenshots auto-save to `/tmp` by default (optimized for AI agents):

```bash
surf screenshot                             # Auto-saves to /tmp/surf-snap-*.png
surf screenshot --output /tmp/shot.png      # Save to specific path
surf screenshot --full --output /tmp/hd.png # Full resolution (skip resize)
surf screenshot --annotate                  # With element labels
surf screenshot --fullpage                  # Entire page
surf screenshot --full-page /tmp/full.png   # Entire page, save to path
surf screenshot --no-save                   # Return base64 + ID only (no file)
surf snap                                   # Alias for screenshot
```

To disable auto-save globally, set `autoSaveScreenshots: false` in `surf.json`.

Actions like `click`, `type`, and `scroll` automatically capture a screenshot after execution - no extra command needed.

### Tabs

```bash
surf tab.list
surf tab.new "https://example.com"
surf tab.switch 123
surf tab.close 123
surf tab.move 123 --to-window 456   # Move one tab; use --ids 123,124 for several
surf tab.name "dashboard"           # Name current tab
surf tab.switch "dashboard"         # Switch by name
surf tab.group --name "Work" --color blue
```

### Browser Sessions and Concurrent Agents

Give every independent agent a durable Surf session before its first browser command. `session.ensure` is idempotent: it creates a missing session, reuses a live one, and reopens a stale or closed binding.

```bash
# First command rule for every independent agent shell
export SURF_SESSION="$(basename "$PWD" | sed 's/[^A-Za-z0-9._-]/-/g')"
surf session.ensure "$SURF_SESSION" about:blank

# All later tab-scoped commands use that session automatically
surf go "https://example.com"
surf read
surf click e5
```

Use a distinct worktree/directory name per agent. When several agents share one directory, append a stable agent identifier instead of reusing the same `SURF_SESSION` value.

A session owns one explicit Chrome tab. New sessions use a separate **unfocused normal window** by default, so Chrome focus changes cannot retarget another agent's commands.

```bash
surf session.new research "https://example.com"   # separate unfocused window
surf session.ensure research about:blank           # safe to run repeatedly
surf session.new scout about:blank --tab            # inactive tab instead

surf --session research read                        # explicit selector
SURF_SESSION=research surf screenshot               # environment selector

surf session.list --refresh                         # all bindings + queue state
surf session.info research --refresh                # target and scheduler details
surf session.close research                         # closes Surf-created target
surf session.cleanup --idle-after 1h --dry-run      # preview forgotten sessions
surf session.cleanup --idle-after 1h                 # remove idle bindings
surf session.rebind research --tab-id 789            # adopt an existing tab
surf session.reopen research                         # recreate from last URL
```

`session.cleanup` is an explicit, one-shot cleanup operation; `--idle-after` is required. It inspects current bindings first, removes gone or stale records, and removes live inactive bindings older than the threshold. Only Surf-created targets are closed. Adopted targets remain open while their session binding is removed. Use `--dry-run` to report the exact bindings and target actions without changing the store or browser.

Commands for the same session tab run FIFO. Commands for different session tabs can overlap. Browser-wide mutations—such as creating, moving, closing, or focusing tabs/windows and writing cookies—wait for active tab lanes to drain. Add `--no-wait` to return `tab_busy` or `browser_busy` immediately instead of queueing.

Recovery errors print an exact command that can be copied directly:

```text
Error: The tab for session research is gone.
Recovery: surf session.reopen research
```

`session.info` distinguishes work queued on the session's own tab, activity on other tabs, and an active or waiting browser-wide writer. Browser-login provider commands such as `surf chatgpt`, `surf gemini`, and `surf oracle ask` print a warning before taking exclusive browser access, so a queued provider flow is not mistaken for a hung command.

Sessions share the same Chrome profile. Cookies, authentication, same-origin storage, downloads, history, bookmarks, and other profile state are shared. For hard isolation, use separate browser profiles/instances with separate native hosts and `SURF_SOCKET` values.

### Explicit Tabs and Windows

Session targeting is the recommended coordination mechanism. Explicit IDs and named tabs remain available for one-off work:

```bash
surf window.new "https://example.com"
surf read --tab-id 789
surf click e5 --window-id 123456
surf tab.name dashboard --tab-id 789
surf tab.switch dashboard
```

### Device Emulation

Test responsive designs and mobile layouts:

```bash
surf emulate.device --list                    # Show available devices
surf emulate.device "iPhone 14"               # Emulate iPhone 14
surf emulate.device "Pixel 7"                 # Emulate Pixel 7
surf emulate.device reset                     # Return to desktop

# Custom viewport
surf emulate.viewport --width 375 --height 812
surf emulate.viewport --width 1920 --height 1080 --scale 2

# Touch emulation
surf emulate.touch                            # Enable touch
surf emulate.touch --enabled false            # Disable touch
```

Available devices: iPhone 12-14 (Pro/Max), iPhone SE, iPad (Pro/Mini), Pixel 5-7 (Pro), Galaxy S21-S23, Galaxy Tab S7, Nest Hub (Max).

### Animation Recording

Capture a screenshot burst and assemble it into an animated GIF with ImageMagick:

```bash
surf record --duration 2000 --fps 10 --output /tmp/anim.gif
surf record --trigger "click:#btn" --output /tmp/click.gif
surf record --rect 0,200,1440,800 --output /tmp/region.gif
```

`record` defaults to 2000ms at 10fps and writes to `/tmp/surf-record-*.gif` when no output is provided. `--duration` is capped at 10000ms and `--fps` is capped at 30. `--trigger` supports `click:<selector>`, `scroll:up|down|left|right|top|bottom`, and `scroll:<selector>` to scroll a container to the bottom before capture. `--rect` crops the GIF using `x,y,width,height`. ImageMagick must be available as `magick` or `convert`.

### Animation Audit

Sample matching elements over time and return a bounded JSON timeline for agent inspection:

```bash
surf animate-audit --selector ".thing" --duration 2000 --fps 10
```

The command captures rect, opacity, transform, visibility, display, and a short text snippet for up to 25 matching elements per sample. `--selector` is required. `--duration` defaults to 2000ms and is capped at 10000ms; `--fps` defaults to 10 and is capped at 30. This command returns JSON only and does not record GIF/video output.

### Performance Audit

Capture layout shift, long animation frame, event timing, long task, and paint entries during a short window:

```bash
surf perf-audit --duration 3000 --trigger "click:.cta" --output /tmp/perf.json
surf perf-audit --duration 1000 --json
```

`perf-audit` defaults to 3000ms and is capped at 10000ms. `--trigger` supports the same `click:<selector>` and `scroll:<target>` forms as `record`. `--output` writes the JSON snapshot to disk.

### Performance Tracing

Capture performance metrics and traces:

```bash
surf perf.metrics                   # Current performance metrics
surf perf.start                     # Start tracing
surf perf.stop                      # Stop and get trace data
```

### AI Queries (No API Keys)

Query AI models using your browser's logged-in session:

```bash
# ChatGPT
surf chatgpt "explain this code"
surf chatgpt "summarize" --with-page     # Include page context
surf chatgpt "analyze" --model gpt-5.5   # Specify model
surf chatgpt "review" --file code.ts     # Attach file

# Gemini
surf gemini "explain quantum computing"
surf gemini "summarize" --with-page                           # Include page context
surf gemini "analyze" --file data.csv                         # Attach file
surf gemini "a robot surfing" --generate-image /tmp/robot.png # Generate image
surf gemini "add sunglasses" --edit-image photo.jpg --output out.jpg
surf gemini "summarize" --youtube "https://youtube.com/..."   # YouTube analysis
surf gemini "hello" --model gemini-3.5-flash                  # Model selection

# Perplexity
surf perplexity "what is quantum computing"
surf perplexity "explain this page" --with-page               # Include page context
surf perplexity "deep dive" --mode research                   # Research mode (Pro)
surf perplexity "latest news" --model sonar                   # Model selection (Pro)

# Grok (queries x.com/i/grok using your X.com login)
surf grok "what are the latest AI agent trends on X"          # Search X posts
surf grok "analyze @username recent activity"                 # Profile analysis
surf grok "summarize this page" --with-page                   # Include page context
surf grok "find viral AI posts" --deep-search                 # DeepSearch mode
surf grok "quick question" --model fast                       # Models: auto, fast, expert, grok-4.20-beta
surf grok --validate                                          # Check UI and available models
surf grok --validate --save-models                            # Save discovered models to settings

# AI Studio (queries aistudio.google.com using your Google login)
surf aistudio "explain quantum computing"
surf aistudio "redteam this" --with-page                      # Include page context
surf aistudio "quick answer" --model gemini-3-flash-preview   # Model selection

# Kimi (queries kimi.com - Moonshot K-series - using your browser login)
surf kimi "explain quantum computing"
surf kimi "summarize" --with-page                             # Include page context
surf kimi "quick answer" --model thinking                     # Models: instant (default), thinking, high
surf kimi --validate                                           # Check kimi.com UI and available models

# AI Studio App Builder (generates full web apps from a prompt)
surf aistudio.build "build a portfolio site"
surf aistudio.build "todo app" --model gemini-3.1-pro-preview # Model override
surf aistudio.build "crm dashboard" --output ./out            # Extract zip to directory
surf aistudio.build "game" --keep-open --timeout 600          # Keep tab open, 10min timeout
```

#### Oracle

Use `surf oracle` for a durable, local ChatGPT consult instead of a quick `surf chatgpt` one-shot. It persists jobs by conversation URL, supports repeatable file-context globs, one direct local attachment with `--file`, and verifies requested model and reasoning effort before submission. Add `--github` when the consult needs the ChatGPT Chat tab and connected GitHub tool. ChatGPT model aliases include `instant`, `thinking`, `pro`, `gpt-5.5`, and `gpt-5.6-sol`. Use `--model gpt-5.6-sol --effort pro` for GPT-5.6 Sol with Pro effort.

```bash
surf oracle ask "review this change" --files "src/**/*.ts" --file ./design.md --model gpt-5.5 --effort pro --github --detach --json
surf oracle status <job-id> --json
surf oracle result <job-id> --wait --json
surf oracle follow <job-id> "challenge that recommendation" --file ./follow-up.md --github --detach --json
```

Only one oracle job can be in flight. Sensitive filename patterns and gitignored context are blocked unless `--allow-sensitive` is explicit.

Each AI tool uses your existing browser login - no API keys needed. Just be logged into the respective service in Chrome (chatgpt.com, gemini.google.com, perplexity.ai, x.com, or aistudio.google.com).

**Grok troubleshooting:** If queries fail, run `surf grok --validate` to check if the UI structure changed. Use `--save-models` to update the model cache in `surf.json`. Default model is `fast`.

### Waiting

```bash
surf wait 2                         # Wait 2 seconds
surf wait.element ".loaded"         # Wait for element
surf wait.network                   # Wait for network idle
surf wait.url "/dashboard"          # Wait for URL pattern
```

### Other

```bash
surf js "return document.title"     # Execute JavaScript
surf record --duration 2000 --fps 10 --output /tmp/anim.gif      # Animated GIF capture
surf animate-audit --selector ".thing" --duration 2000 --fps 10  # JSON animation timeline
surf perf-audit --duration 3000 --output /tmp/perf.json           # PerformanceObserver snapshot
surf search "login"                 # Find text in page
surf cookie list                    # List cookies
surf zoom 1.5                       # Set zoom to 150%
surf console                        # Read console messages
surf network                        # Read network requests
```

### Network Capture

Surf automatically captures all network requests while active. No explicit start needed.

```bash
# Overview (token-efficient for LLMs)
surf network                          # Recent requests, compact table
surf network --urls                   # Just URLs (minimal output)
surf network --format curl            # As curl commands

# Filtering
surf network --origin api.github.com  # Filter by origin/domain
surf network --method POST            # Only POST requests
surf network --type json              # Only JSON responses
surf network --status 4xx,5xx         # Only errors
surf network --since 5m               # Last 5 minutes
surf network --exclude-static         # Skip images/fonts/css/js
surf network -vv --body-mode text      # Full entries with capped text bodies

# Drill down
surf network.get r_001                # Full request/response details
surf network.body r_001               # Response body (for piping to jq)
surf network.curl r_001               # Generate curl command
surf network.origins                  # List captured domains

# Management
surf network.clear                    # Clear captured data
surf network.stats                    # Capture statistics
surf network.export --har --output ./trace.har
```

Response bodies are fetched at `Network.loadingFinished` when capture is enabled. `--body-mode none|text|all`, `--per-body-bytes`, and `--total-body-bytes` control content and caps; exports include completeness metadata.

Storage location: `~/.surf/state/network/` (override with `SURF_NETWORK_PATH` in the native host environment). Surf creates private `0700` directories and `0600` files and rejects symlink targets. Auto-cleanup: 24 hours TTL, 200MB max.

### Workflows

Execute multi-step browser automation as a single command:

```bash
# Inline workflow (pipe-separated)
surf do 'go "https://example.com" | click e5 | screenshot'

# Multi-step login flow
surf do 'go "https://example.com/login" | type "user@example.com" --selector "#email" | type "pass" --selector "#password" | click --selector "button[type=submit]"'

# From JSON file
surf do --file workflow.json

# Run named workflow with arguments
surf do my-workflow --url "https://example.com" --max_items 10

# Validate without executing
surf do 'go "url" | click e5 | screenshot' --dry-run
```

**Why workflows?** Instead of 6-8 separate CLI calls with LLM orchestration between each step, a workflow executes deterministically with smart auto-waits. Faster, cheaper, and more reliable.

**Options:**
- `--file`, `-f` - Load workflow from JSON file
- `--dry-run` - Parse and validate without executing
- `--on-error stop|continue` - Error handling (default: stop)
- `--step-delay <ms>` - Delay between steps (default: 100, use 0 to disable)
- `--no-auto-wait` - Disable automatic waits between steps
- `--json` - Output structured JSON result
- `--<arg> <value>` - Pass arguments to workflow (e.g., `--url "..."`)

**Auto-waits:** Commands that trigger page changes automatically wait for completion:
- Navigation (`go`, `back`, `forward`) → waits for page load
- Clicks, key presses, form fills → waits for DOM stability
- Tab switches → waits for tab to load

#### Workflow Files

Workflows can be saved as JSON files and run by name. Place them in `~/.surf/workflows/` (user) or `./.surf/workflows/` (project).

**Basic format:**
```json
{
  "name": "login-flow",
  "description": "Log into example.com",
  "args": {
    "email": { "required": true, "desc": "Login email" },
    "password": { "required": true, "desc": "Login password" }
  },
  "steps": [
    { "tool": "navigate", "args": { "url": "https://example.com/login" } },
    { "tool": "type", "args": { "text": "%{email}", "selector": "input[name=email]" } },
    { "tool": "type", "args": { "text": "%{password}", "selector": "input[name=password]" } },
    { "tool": "click", "args": { "selector": "button[type=submit]" } }
  ]
}
```

**Step outputs** - Capture results for use in later steps:
```json
{
  "steps": [
    { "tool": "js", "args": { "code": "return document.title" }, "as": "title" },
    { "tool": "js", "args": { "code": "return 'Page: ' + '%{title}'" } }
  ]
}
```

**Loops** - `repeat` for fixed iterations, `each` for arrays:
```json
{
  "steps": [
    { "tool": "js", "args": { "code": "return ['a', 'b', 'c']" }, "as": "items" },
    {
      "each": "%{items}",
      "as": "item",
      "steps": [
        { "tool": "js", "args": { "code": "return 'Processing: %{item}'" } }
      ]
    }
  ]
}
```

```json
{
  "steps": [
    {
      "repeat": 5,
      "steps": [
        { "tool": "scroll", "args": { "direction": "down" } },
        { "tool": "wait", "args": { "duration": 500 } }
      ]
    }
  ]
}
```

**Loop with exit condition** - Stop early when condition is met:
```json
{
  "repeat": 20,
  "until": { "tool": "js", "args": { "code": "return !document.querySelector('.next-page')" } },
  "steps": [
    { "tool": "click", "args": { "selector": ".next-page" } },
    { "tool": "wait.load" }
  ]
}
```

#### Workflow Management

```bash
# List available workflows
surf workflow.list

# Show workflow details and arguments
surf workflow.info my-workflow

# Validate workflow JSON
surf workflow.validate ./my-workflow.json
```

**Supported commands:** All surf commands work in workflows. Use aliases (`go`, `snap`, `read`) or full names (`navigate`, `screenshot`, `page.read`).

### Playbooks

Use `surf do` for a direct sequence of browser commands. Use a playbook for a reusable site capability that can try a browser-session network request and fall back to a workflow when the endpoint drifts.

```bash
surf playbook list
surf pb show page
surf pb ops page
surf use page read --json

# Write ops require explicit authorization and a durable duplicate-safety receipt.
surf use <site> <write-op> --write --resource-id 123
```

Playbook read ops can also use a trusted `script` strategy when fixed JSON steps are too rigid. Scripts require `--allow-script` at run time. Only run scripts from playbooks you trust. This is not a security sandbox.

The script gets `input`, `tools.run`, `tools.all`, `tools.ref`/`refs`, `emit`, and `console`. Tool calls still use Surf workflow step behavior, including auto-waits unless `autoWait` is `false`.

```json
{
  "using": "script",
  "script": [
    "const page = await tools.run('page', { tool: 'page.text', args: {} });",
    "const clicked = await tools.all(input.selectors.map((selector) => ({ key: selector.slice(1), tool: 'click', args: { selector } })));",
    "return { page: page.output, clicked: clicked.map((link) => link.output) };"
  ]
}
```

Project playbooks in `./.surf/playbooks/` override user playbooks in `~/.surf/playbooks/`; built-ins are the final fallback. `show` reports the selected source. Provider compatibility commands continue to use their validated command paths until provider playbooks have real login-flow validation.

Author a playbook from redacted recent activity or an explicit evidence record:

```bash
surf pb suggest --since 1h
surf pb save example --op read --from-recent 1h
surf pb record start example --op read --network --watch
surf pb record mark "loaded results"
surf pb record stop --draft
surf pb save --from-record <record-id>
surf pb trace export --from-record <record-id> --har ./trace.har
surf pb export example --out ./example-playbook
surf pb import ./example-playbook
```

Records, traces, receipts, and recent-use journals live under private Surf state. Input values and authentication headers are redacted by default; `--include-input-values` is an explicit recording choice.

Generate a standalone client only from an observed or validated read endpoint:

```bash
surf pb client derive example --op read --from-record <record-id> --request-id <request-id> --out ./client
surf pb client export example --op read --out ./client
surf pb client verify ./client
```

Generated manifests declare provenance and authentication environment inputs. Surf excludes cookies, bearer tokens, and captured credentials and does not export write-capable clients without explicit review.

## Global Options

```bash
--session <name>   # Target a durable browser session (or set SURF_SESSION)
--tab-id <id>      # Target a specific tab
--window-id <id>   # Target a specific window
--no-wait          # Return tab_busy/browser_busy instead of queueing
--json             # Raw JSON including resolved target metadata
--soft-fail        # Warn instead of error (exit 0) on restricted pages
--no-lock          # Bypass the legacy lock for compound client-side commands
--no-screenshot    # Skip auto-screenshot after actions
--full             # Full resolution screenshots (skip resize)
```

## Environment Variables

```bash
SURF_NETWORK_PATH         # Native-host network state root (default: ~/.surf/state/network)
SURF_STATE_DIR            # Private Surf state root, including browser sessions (default: ~/.surf/state)
SURF_SESSION              # Default named browser session for tab-scoped commands
SURF_SOCKET               # Socket path or named pipe (default: /tmp/surf.sock, Windows: //./pipe/surf)
SURF_REMOTE               # Remote Surf endpoint as host:port (overrides SURF_SOCKET)
SURF_REMOTE_CREDENTIAL    # Client Ed25519 credential for the selected remote endpoint
SURF_REMOTE_STATE_DIR     # Host identity/authorization directory (default: ~/.surf/remote)
SURF_LISTEN               # Native-host Tailnet bind address as <tailscale-ip>:<port>
SURF_NODE_PATH            # Path to node binary (for native host wrapper)
SURF_HOST_PATH            # Path to native/host.cjs (for native host wrapper)
SURF_EXTENSION_PATH       # Path to extension dist/ directory
```

**Use cases:**
- `SURF_SESSION`: Per-shell default session. Give each independent agent a unique value and run `surf session.ensure "$SURF_SESSION" about:blank` before its first browser command.
- `SURF_STATE_DIR`: Private mode-0700 state root for durable browser-session bindings and other Surf state.
- `SURF_SOCKET`: Advanced socket override. Set it for both the native host and CLI when separate browser/profile instances need hard isolation.
- `SURF_REMOTE`: Remote client endpoint. `--remote <host>:<port>` overrides it; both override `SURF_SOCKET`.
- `SURF_REMOTE_CREDENTIAL`: Credential used for mutual remote authentication. `--remote-credential <path>` overrides it.
- `SURF_REMOTE_STATE_DIR`: Advanced host-side override for the mode-0700 identity and client registry directory.
- `SURF_LISTEN`: Native-host listener address on the browser machine. Use `surf install ... --listen <tailscale-ip>:<port>` to persist it in that host's wrapper.
- `SURF_NODE_PATH` / `SURF_HOST_PATH`: Package manager installs (e.g., Nix) that store binaries in non-standard locations
- `SURF_EXTENSION_PATH`: Package managers that create stable symlinks instead of changing paths on reinstall

**Example (Nix):**
```bash
export SURF_NODE_PATH=~/.local/share/surf-cli/node
export SURF_HOST_PATH=~/.local/share/surf-cli/native/host.cjs
export SURF_EXTENSION_PATH=~/.local/share/surf-cli/extension
```

## Troubleshooting native host connections

If a command fails with `Socket connect failed`, start with:

```bash
surf doctor
surf doctor --browser all
surf doctor --json
```

`doctor` does not require a working browser connection. It checks the socket path, native messaging manifest, manifest `allowed_origins`, and wrapper path, then prints targeted next steps.

Read the `Attempted socket:` line first. The CLI and native host must agree on the same socket path. By default this is `/tmp/surf.sock` on macOS/Linux/WSL2 and `//./pipe/surf` on Windows.

Common fixes:
- Restart the browser after `surf install <extension-id>`.
- Confirm the Surf extension is enabled and the extension ID matches the one passed to `surf install`.
- On WSL2 with Windows Chrome, run `surf install <extension-id>` from WSL2 and restart Windows Chrome. Use `--target linux` only for a Linux browser running inside WSLg.
- If `SURF_SOCKET` is set, set the same value for both the browser-launched native host and the shell running `surf`.

macOS checklist:
- Confirm Chrome has a native messaging manifest at `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/surf.browser.host.json`.
- Confirm the manifest `allowed_origins` entry uses the same extension ID shown on `chrome://extensions` for the Surf extension.
- Reinstall the manifest with `surf install <extension-id>` after copying a fresh extension build or if the extension ID changed.
- Fully restart Chrome, then reload the Surf extension on `chrome://extensions`.
- Open the extension service worker from `chrome://extensions` and check its console for native messaging or socket errors.
- If `SURF_SOCKET` is set in your shell, make sure Chrome launches the native host with the same value; otherwise both sides should use `/tmp/surf.sock`.
- Run a simple CLI command such as `surf tab.list`; if it fails, compare its `Attempted socket:` line with the socket expected by the native host.

## Socket API

For programmatic integration, send JSON to `/tmp/surf.sock` by default, or to `SURF_SOCKET` when set:

```bash
echo '{"type":"tool_request","method":"execute_tool","params":{"tool":"tab.list","args":{}},"id":"1"}' | nc -U /tmp/surf.sock
```

### Protocol Reference

**Request:**
```json
{
  "type": "tool_request",
  "method": "execute_tool",
  "params": {
    "tool": "click",
    "args": { "ref": "e5" }
  },
  "id": "unique-request-id",
  "tabId": 123,
  "windowId": 456
}
```

**Success Response:**
```json
{
  "type": "tool_response",
  "id": "unique-request-id",
  "result": {
    "content": [{ "type": "text", "text": "Result message" }]
  }
}
```

**Error Response:**
```json
{
  "type": "tool_response",
  "id": "unique-request-id",
  "error": {
    "content": [{ "type": "text", "text": "Error message" }]
  }
}
```

## Command Groups

| Group | Commands |
|-------|----------|
| `workflow` | `do`, `workflow.list`, `workflow.info`, `workflow.validate` |
| `window.*` | `new`, `list`, `focus`, `close`, `resize` |
| `tab.*` | `list`, `new`, `switch`, `close`, `name`, `unname`, `named`, `group`, `ungroup`, `groups`, `reload` |
| `scroll.*` | `top`, `bottom`, `to`, `info` |
| `page.*` | `read`, `text`, `state` |
| `locate.*` | `role`, `text`, `label` |
| `element.*` | `styles` |
| `frame.*` | `list`, `switch`, `main`, `js` |
| `wait.*` | `element`, `network`, `url`, `dom`, `load` |
| `cookie` / `cookie.*` | `list`, `get`, `set`, `clear`, `delete` |
| `bookmark.*` | `add`, `remove`, `list` |
| `history.*` | `list`, `search` |
| `dialog.*` | `accept`, `dismiss`, `info` |
| `emulate.*` | `network`, `cpu`, `geo`, `device`, `viewport`, `touch` |
| `perf.*` | `start`, `stop`, `metrics` |
| `network.*` | `get`, `body`, `curl`, `origins`, `clear`, `stats`, `export`, `path` |

## Aliases

| Alias | Command |
|-------|---------|
| `snap` | `screenshot` |
| `read` | `page.read` |
| `find` | `search` |
| `go` | `navigate` |

## How It Works

```
CLI (surf) → Unix Socket → Native Host → Chrome Extension → CDP/Scripting API
```

Surf uses Chrome DevTools Protocol for most operations, with automatic fallback to `chrome.scripting` API when CDP is unavailable (restricted pages, certain contexts). Screenshots fall back to `captureVisibleTab` when CDP capture fails.

## Limitations

- Cannot automate `chrome://` pages or the Chrome Web Store (Chrome restriction)
- First CDP operation on a new tab takes ~100-500ms (debugger attachment)
- Some operations on restricted pages return warnings instead of results

## Linux Support (Experimental)

Surf should work on Linux with Chromium. Not yet tested in production.

```bash
# Install dependencies
sudo apt install chromium-browser nodejs npm imagemagick

# For headless server: add Xvfb + VNC
sudo apt install xvfb tigervnc-standalone-server

# Install Surf and native host
npm install -g surf-cli
surf install <extension-id> --browser chromium
```

**Notes:**
- Use Chromium (no official Chrome for Linux ARM64)
- Screenshot resize uses ImageMagick instead of macOS `sips`
- Headless servers need Xvfb + VNC for initial login setup

## AI Agent Integration

Surf includes a skill file for AI coding agents like [Pi](https://github.com/badlogic/pi-mono):

```bash
# Symlink for auto-updates
ln -s "$(pwd)/skills/surf" ~/.pi/agent/skills/surf

# Or copy
cp -r skills/surf ~/.pi/agent/skills/
```

See [`skills/README.md`](skills/README.md) for details.

### Pi extension

Surf also includes an optional Pi extension. Install or load Surf as a Pi package, or load it from a checkout:

```bash
pi install npm:surf-cli
pi -e /path/to/surf-cli/pi-extension/surf.ts
```

It registers `surf_read`, `surf_screenshot`, `surf_click`, `surf_type`, `surf_tool`, and the `surf_oracle_*` tools. Browser calls use Surf's native-host socket, not shell commands. If `pi-subagents/background-work` is installed, the extension also reports active oracle jobs started by that Pi session. Pi still loads the browser tools when pi-subagents is not installed.

The extension also registers a `surf-oracle` external-job provider when a Pi runtime exposes that provider bridge. The provider implements pi-subagents' external-job contract: `start`, `status`, `result`, and `reattach` operations that return `providerJobId`, a contract state (`queued`, `running`, `completed`, `failed`), the durable conversation URL, the captured result text as `output`, and failure code and message when present. It reads `options.model`, `options.effort`, `options.file`, and `options.github` for starts and follow-ups, so a Pi profile can request `model: gpt-5.6-sol` plus `effort: pro` and reach ChatGPT GPT-5.6 Sol with Pro effort through Surf, while `github: true` requires Chat mode and the connected GitHub tool. Capacity stays fail-closed: Surf returns the blocking job id instead of silently queueing a second ChatGPT job.

When Surf is installed as a Pi package, it also exposes an optional `gpt-pro` package agent for `pi-subagents`. That profile uses `runner.type: external-job`, provider `surf-oracle`, `options.model: gpt-5.6-sol`, and `options.effort: pro`. Surf remains useful without Pi or `pi-subagents`; the package agent only wires Surf's browser-backed model alias into Pi's agent picker.

Shell-based agents should select a unique session with `SURF_SESSION` and call `surf session.ensure` before their first browser command. The optional Pi extension still uses its existing socket-tool interface; callers that coordinate several Pi workers should pass explicit tab targets until session selection is exposed by that integration.

## Development

```bash
npm run dev       # Watch mode
npm run build     # Production build
```

After changes:
- **Extension** (`src/`): Reload at `chrome://extensions`
- **Host** (`native/`): Restart `node native/host.cjs`

## License

MIT
