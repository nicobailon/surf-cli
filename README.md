<p>
  <img src="surf-banner.png" alt="surf" width="1100">
</p>

# Surf

**The CLI for AI agents to control Chrome. Zero config, agent-agnostic, battle-tested.**

[![npm version](https://img.shields.io/npm/v/surf-cli?style=for-the-badge)](https://www.npmjs.com/package/surf-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows-blue?style=for-the-badge)]()

> **v2.6.0** — AI Studio support (`surf aistudio`, `surf aistudio.build`), Windows support, Helium browser support, env var overrides. See [CHANGELOG](CHANGELOG.md).

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
| Local-only | Yes | No (cloud) | Partial | Yes | Partial |
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
surf page.text                      # Raw text content only
surf page.state                     # Modals, loading state, scroll position
```

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
surf locate.role button --action click

surf frame.main                     # Return to main page
```

### Interaction

```bash
surf click e5                       # Click by element ref
surf click --selector ".btn"        # Click by CSS selector
surf click 100 200                  # Click by coordinates
surf type "hello" --submit          # Type and press Enter
surf type "email@example.com" --ref e12  # Type into specific element
surf key Escape                     # Press key
surf scroll.bottom                  # Scroll to bottom
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
surf tab.name "dashboard"           # Name current tab
surf tab.switch "dashboard"         # Switch by name
surf tab.group --name "Work" --color blue
```

### Window Isolation

Keep using your browser while the agent works in a separate window:

```bash
# Create isolated window for agent
surf window.new "https://example.com"
# Returns: Window 123456 (tab 789)

# All subsequent commands target that window
surf click e5 --window-id 123456
surf read --window-id 123456
surf tab.new "https://other.com" --window-id 123456

# Or manage windows directly
surf window.list                    # List all windows
surf window.list --tabs             # Include tab details
surf window.focus 123456            # Bring window to front
surf window.close 123456            # Close window
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
surf chatgpt "analyze" --model gpt-4o    # Specify model
surf chatgpt "review" --file code.ts     # Attach file

# Gemini
surf gemini "explain quantum computing"
surf gemini "summarize" --with-page                           # Include page context
surf gemini "analyze" --file data.csv                         # Attach file
surf gemini "a robot surfing" --generate-image /tmp/robot.png # Generate image
surf gemini "add sunglasses" --edit-image photo.jpg --output out.jpg
surf gemini "summarize" --youtube "https://youtube.com/..."   # YouTube analysis
surf gemini "hello" --model gemini-2.5-flash                  # Model selection

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

# AI Studio App Builder (generates full web apps from a prompt)
surf aistudio.build "build a portfolio site"
surf aistudio.build "todo app" --model gemini-3.1-pro-preview # Model override
surf aistudio.build "crm dashboard" --output ./out            # Extract zip to directory
surf aistudio.build "game" --keep-open --timeout 600          # Keep tab open, 10min timeout
```

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

# Drill down
surf network.get r_001                # Full request/response details
surf network.body r_001               # Response body (for piping to jq)
surf network.curl r_001               # Generate curl command
surf network.origins                  # List captured domains

# Management
surf network.clear                    # Clear captured data
surf network.stats                    # Capture statistics
```

Storage location: `/tmp/surf/` (override with `--network-path` or `SURF_NETWORK_PATH` env).
Auto-cleanup: 24 hours TTL, 200MB max.

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

## Global Options

```bash
--tab-id <id>      # Target specific tab
--window-id <id>   # Target specific window (isolate agent from your browsing)
--json             # Output raw JSON
--soft-fail        # Warn instead of error (exit 0) on restricted pages
--no-screenshot    # Skip auto-screenshot after actions
--full             # Full resolution screenshots (skip resize)
--network-path <path>  # Custom path for network logs (default: /tmp/surf, or SURF_NETWORK_PATH env)
```

## Environment Variables

```bash
SURF_NETWORK_PATH         # Path for network capture logs (default: /tmp/surf)
SURF_SOCKET               # Socket path or named pipe (default: /tmp/surf.sock, Windows: //./pipe/surf)
SURF_NODE_PATH            # Path to node binary (for native host wrapper)
SURF_HOST_PATH            # Path to native/host.cjs (for native host wrapper)
SURF_EXTENSION_PATH       # Path to extension dist/ directory
```

**Use cases:**
- `SURF_SOCKET`: Advanced socket override. Set it for both the native host and CLI if you need a non-default socket.
- `SURF_NODE_PATH` / `SURF_HOST_PATH`: Package manager installs (e.g., Nix) that store binaries in non-standard locations
- `SURF_EXTENSION_PATH`: Package managers that create stable symlinks instead of changing paths on reinstall

**Example (Nix):**
```bash
export SURF_NODE_PATH=~/.local/share/surf-cli/node
export SURF_HOST_PATH=~/.local/share/surf-cli/native/host.cjs
export SURF_EXTENSION_PATH=~/.local/share/surf-cli/extension
```

## Troubleshooting native host connections

If a command fails with `Socket connect failed`, read the `Attempted socket:` line first. The CLI and native host must agree on the same socket path. By default this is `/tmp/surf.sock` on macOS/Linux/WSL2 and `//./pipe/surf` on Windows.

Common fixes:
- Restart the browser after `surf install <extension-id>`.
- Confirm the Surf extension is enabled and the extension ID matches the one passed to `surf install`.
- On WSL2 with Windows Chrome, run `surf install <extension-id>` from WSL2 and restart Windows Chrome. Use `--target linux` only for a Linux browser running inside WSLg.
- If `SURF_SOCKET` is set, set the same value for both the browser-launched native host and the shell running `surf`.

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
