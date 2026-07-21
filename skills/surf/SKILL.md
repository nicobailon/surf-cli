---
name: surf
description: Control Chrome browser via CLI for testing, automation, and debugging. Use when the user needs browser automation, screenshots, form filling, page inspection, network/CPU emulation, DevTools streaming, or AI queries via ChatGPT/Gemini/Perplexity/Grok/AI Studio.
---

# Surf Browser Automation

Control Chrome browser via CLI or Unix socket.

## Native Host / Socket Notes

For WSL2 with Windows Chrome, run `surf install <extension-id>` inside WSL2. Surf detects WSL2 and writes the Windows-side native messaging manifest plus a wrapper that launches the WSL host. Use `surf install <extension-id> --target linux` only for Linux browsers running inside WSLg.

On macOS, Chrome reads the native messaging manifest at `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/surf.browser.host.json`. If native messaging fails, confirm that file exists, its `allowed_origins` extension ID matches `chrome://extensions`, then rerun `surf install <extension-id>`, restart Chrome, reload the extension, and inspect the extension service-worker console.

If a command reports `Socket connect failed`, run `surf doctor` first, then check the `Attempted socket:` line. Default sockets are `/tmp/surf.sock` on macOS/Linux/WSL2 and `//./pipe/surf` on Windows. If `SURF_SOCKET` is set, the browser-launched host and the shell running `surf` must use the same value.

## Remote Surf

Remote clients require a per-client credential; Tailnet reachability alone is not authorization. On the POSIX browser host, authorize the client before installing the listener:

```bash
surf remote authorize agent-macbook --output ~/agent-macbook.surf-credential.json
surf install <extension-id> --listen 100.101.102.103:4321
surf remote list
```

Move the mode-0600 credential to the client through a secure channel. It grants full trusted Surf authority. Use it explicitly or through `SURF_REMOTE` and `SURF_REMOTE_CREDENTIAL`:

```bash
surf --remote 100.101.102.103:4321 \
  --remote-credential ~/.config/surf/agent-macbook.json \
  page.read

surf remote revoke agent-macbook  # Run on the browser host
```

Remote paths are client-local by default. `local:./file` is explicit client-local syntax; only `remote:/absolute/path` accesses the browser host directly. Remote transfer supports one upload or ChatGPT/Gemini input and one screenshot, network-export, or Gemini image output. Limits are 256 MiB per file, 512 MiB and 32 files per connection, and 256 KiB decoded chunks. `record`, `aistudio.build`, smoke screenshot directories, directories, and multi-file inputs are not supported remotely. Successful action screenshots and failure `--auto-capture` diagnostics are transferred back to client-local paths.

## CLI Quick Reference

```bash
surf --help                    # Full help
surf <group>                   # Group help (tab, scroll, page, wait, dialog, emulate, form, perf, ai)
surf --help-full               # All commands
surf --find <term>             # Search tools
surf --help-topic <topic>      # Topic guide (refs, semantic, frames, devices, windows)
```

## Core Workflow

```bash
# 1. Navigate to page
surf navigate "https://example.com"

# 2. Read page to get element refs
surf page.read

# 3. Click by ref or coordinates
surf click --ref "e1"
surf click --x 100 --y 200

# 4. Type text
surf type --text "hello"

# 5. Screenshot
surf screenshot --output /tmp/shot.png

# Inspect animation/style changes as JSON
surf animate-audit --selector ".thing" --duration 2000 --fps 10
```

## AI Assistants (No API Keys)

Query AI models using your browser's logged-in session. Must be logged into the respective service in Chrome.

### ChatGPT
```bash
surf chatgpt "explain this code"
surf chatgpt "summarize" --with-page              # Include current page context
surf chatgpt "review" --model gpt-4o              # Specify model
surf chatgpt "analyze" --file document.pdf        # With file attachment
```

### Gemini
```bash
surf gemini "explain quantum computing"
surf gemini "summarize" --with-page               # Include page context
surf gemini "analyze" --file data.csv             # Attach file
surf gemini "a robot surfing" --generate-image /tmp/robot.png
surf gemini "add sunglasses" --edit-image photo.jpg --output out.jpg
surf gemini "summarize" --youtube "https://youtube.com/..."
surf gemini "hello" --model gemini-3.5-flash      # Models: gemini-3.1-pro (default), gemini-3.5-flash, gemini-3.1-flash-lite
surf gemini "wide banner" --generate-image /tmp/banner.png --aspect-ratio 16:9
```

### Perplexity
```bash
surf perplexity "what is quantum computing"
surf perplexity "explain this page" --with-page   # Include page context
surf perplexity "deep dive" --mode research       # Research mode (Pro)
surf perplexity "latest news" --model sonar       # Model selection (Pro)
```

### Grok (via x.com - requires X.com login in Chrome)
```bash
surf grok "what are the latest AI trends on X"    # Search X posts
surf grok "analyze @username recent activity"     # Profile analysis  
surf grok "summarize this page" --with-page       # Include page context
surf grok "find viral AI posts" --deep-search     # DeepSearch mode
surf grok "quick question" --model fast           # Models: auto, fast, expert, grok-4.20-beta
```

For exhaustive, multi-angle X research with categorized findings and full post-URL traceability, use the `deep-x-research` skill (`skills/deep-x-research/`) instead of a single Grok query.

**Grok Validation & Troubleshooting:**
```bash
# Validate Grok UI and check available models (no query sent)
surf grok --validate

# If models changed, save discovered models to surf.json config
surf grok --validate --save-models
```

### AI Studio (via aistudio.google.com - requires Google login in Chrome)
```bash
surf aistudio "explain quantum computing"
surf aistudio "redteam this" --with-page          # Include current page context
surf aistudio "quick answer" --model gemini-3-flash-preview  # Model selection
surf aistudio "analyze" --timeout 600             # Custom timeout (default: 300s)
```

**Why AI Studio over Gemini?** AI Studio gives access to less restricted Gemini models. For Gemini 3 Pro the difference can be significant with certain prompts. Downside: aggressive per-day rate limits on Pro and Flash models.

**Model selection is best-effort:** Pass any AI Studio model id (e.g. `gemini-3.1-pro-preview`, `gemini-3-flash-preview`, `gemini-flash-lite-latest`). If the model isn't found, AI Studio uses whatever model was last selected in the UI.

### AI Studio App Builder
```bash
surf aistudio.build "build a portfolio site"
surf aistudio.build "todo app" --model gemini-3.1-pro-preview   # Model override
surf aistudio.build "crm dashboard" --output ./out              # Extract zip to directory
surf aistudio.build "game" --keep-open --timeout 600            # Keep tab open, 10min timeout
```

Automates AI Studio's App Builder at `aistudio.google.com/apps`. Types your prompt, clicks Build, waits for completion, downloads the generated zip, and optionally extracts it.

- `--output <dir>` extracts the zip to a directory
- `--model <id>` overrides the model in Advanced Settings
- `--timeout <seconds>` build timeout (default: 600s)
- `--keep-open` leaves the AI Studio tab open after completion

Returns `zipPath`, `extractedPath`, `model`, `buildDuration`, and `tookMs`.

### AI Tool Troubleshooting

When AI queries fail, check these common issues:

1. **Not logged in**: The error "login required" means you need to log into the service in Chrome (chatgpt.com, gemini.google.com, perplexity.ai, x.com, or aistudio.google.com)
2. **Model selection failed**: The UI may have changed. Run `surf grok --validate` to check
3. **Response timeout**: Reasoning-heavy models (ChatGPT o1, Grok Expert) can take 45+ seconds. AI Studio builds can take several minutes.
4. **Element not found**: The service's UI changed. Check for surf-cli updates

**Debugging workflow for agents:**
```bash
# 1. Check if the service is accessible and UI is valid
surf grok --validate

# 2. If models mismatch, update the local settings
surf grok --validate --save-models

# 3. Retry with explicit model name from validation output
surf grok "query" --model <model-from-validation>

# 4. If still failing, try with longer timeout
surf grok "query" --timeout 600
```

## Tab Management

```bash
surf tab.list
surf tab.new "https://google.com"
surf tab.switch 12345
surf tab.close 12345
surf tab.move 12345 --to-window 67890
surf tab.reload                # Reload current tab

# Named tabs (aliases)
surf tab.name myapp            # Name current tab
surf tab.switch myapp          # Switch by name
surf tab.named                 # List named tabs
surf tab.unname myapp          # Remove name

# Tab groups
surf tab.group                 # Create/add to tab group
surf tab.ungroup               # Remove from group
surf tab.groups                # List all tab groups
```

## Window Management

```bash
surf window.list                              # List all windows
surf resize 1280 720                         # Resize current browser window
surf resize 1280                             # Set current window width only
surf window.list --tabs                       # Include tab details
surf window.new                               # New window
surf window.new --url "https://example.com"   # New window with URL
surf window.new --incognito                   # New incognito window
surf window.new --unfocused                   # Don't focus new window
surf window.focus 12345                       # Focus window by ID
surf window.close 12345                       # Close window
surf window.resize --id 123 --width 1920 --height 1080
surf window.resize --id 123 --state maximized # States: normal, minimized, maximized, fullscreen
```

**Multi-agent isolation:**
```bash
# Create a separate window for one agent and keep using its ID
surf window.new "https://example.com"
surf --window-id 123 tab.list
surf --window-id 123 go "https://other.com"

# Pin work to a specific tab, or name it for easier handoff
surf read --tab-id 456
surf tab.name agent-a --tab-id 456
surf tab.switch agent-a
```

Use `window.new`, `--window-id`, `--tab-id`, and named tabs to keep parallel agents on separate targets. Surf serializes non-streaming browser CLI requests per socket with a file-based lock, so agents sharing one native host wait instead of interleaving commands. Use `--no-lock` only for intentional bypasses. For hard isolation, run separate browser/profile instances with separate native hosts and `SURF_SOCKET` values; each socket gets its own lock. Surf does not yet have `session.new`, session IDs, or independent per-agent CDP sessions.

## Input Methods

```bash
# CDP method (real events) types at the current focus
surf type --text "hello"
surf click --x 100 --y 200

# Selector/ref targets use frame-aware DOM input
surf type "hello" --into "#input"
surf type "hello" --ref e5

# Keys
surf key Enter
surf key "cmd+a"
surf key.repeat --key Tab --count 5           # Repeat key presses

# Hover and drag
surf hover --ref e5
surf drag --from-x 100 --from-y 100 --to-x 200 --to-y 200
```

## Page Inspection

```bash
surf page.read                 # Accessibility tree with refs + page text
surf page.read --no-text       # Interactive elements only (no text content)
surf animate-audit --selector ".thing" --duration 2000 --fps 10  # JSON animation timeline
surf page.read --ref e5        # Get specific element details
surf page.read --depth 3       # Limit tree depth
surf page.read --compact       # Minimal output for LLM efficiency
surf page.read --max-bytes 2000 # Cap visible text at a UTF-8 byte boundary
surf page.text                 # Plain text content only
surf page.state                # Modals, loading state, scroll info
```

## Semantic Element Location

Find and act on elements by role, text, or label instead of refs:

```bash
# Find by ARIA role
surf locate.role button --name "Submit" --action click
surf locate.role textbox --name "Email" --action fill --value "test@example.com"
surf locate.role link --all                    # Return all matches

# Find by text content
surf locate.text "Sign In" --action click
surf locate.text "Accept" --exact --action click

# Find form field by label
surf locate.label "Username" --action fill --value "john"
surf locate.label "Password" --action fill --value "secret"
```

**Actions:** `click`, `fill`, `hover`, `text` (get text content)

## Text Search

```bash
surf search "login"                    # Find text in page
surf search "Error" --case-sensitive   # Case-sensitive
surf search "button" --limit 5         # Limit results
surf find "login"                      # Alias for search
```

## Element Inspection

```bash
surf element.styles e5                 # Get computed styles by ref
surf element.styles ".card"            # Or by CSS selector
# Returns: font, color, background, border, padding, bounding box
```

## Scrolling

```bash
surf scroll down 800           # Scroll down 800px
surf scroll up 400             # Scroll up 400px
surf scroll bottom             # Scroll to bottom
surf scroll top                # Scroll to top
surf scroll.bottom             # Dot command form also works
surf scroll.top
surf scroll.to --ref e5        # Scroll element into view
surf scroll.info               # Get scroll position
```

## Waiting

```bash
surf wait 2                    # Wait 2 seconds
surf wait.element ".loaded"    # Wait for element
surf wait.network              # Wait for network idle
surf wait.url "/success"       # Wait for URL pattern
surf wait.dom --stable 100     # Wait for DOM stability
surf wait.load                 # Wait for page load complete
```

## Dialog Handling

```bash
surf dialog.info               # Get current dialog type/message
surf dialog.accept             # Accept (OK)
surf dialog.accept --text "response"  # Accept prompt with text
surf dialog.dismiss            # Dismiss (Cancel)
```

## Device/Network Emulation

```bash
# Network throttling
surf emulate.network slow-3g   # Presets: slow-3g, fast-3g, 4g, offline
surf emulate.network reset     # Disable throttling

# CPU throttling  
surf emulate.cpu 4             # 4x slower
surf emulate.cpu 1             # Reset

# Device emulation (19 presets)
surf emulate.device "iPhone 14"
surf emulate.device "Pixel 7"
surf emulate.device --list     # List available devices

# Custom viewport
surf emulate.viewport --width 1280 --height 720
surf emulate.touch --enable    # Enable touch emulation

# Geolocation
surf emulate.geo --lat 37.7749 --lon -122.4194
surf emulate.geo --clear
```

## Form Automation

```bash
surf page.read                 # Get element refs first

# Fill by ref
surf form.fill --data '[{"ref":"e1","value":"John"},{"ref":"e2","value":"john@example.com"}]'

# Checkboxes: true/false
surf form.fill --data '[{"ref":"e7","value":true}]'

# Dropdown selection
surf select e5 "Option A"                    # By value (default)
surf select e5 "Option A" "Option B"         # Multi-select
surf select e5 --by label "Display Text"     # By visible label
surf select e5 --by index 2                  # By index (0-based)
```

## File Upload

```bash
surf upload --ref e5 --files "/path/to/file.txt"
surf upload --ref e5 --files "/path/file1.txt,/path/file2.txt"
```

## Iframe Handling

```bash
surf frame.list                # List frames with IDs
surf frame.switch "FRAME_ID"   # Switch to iframe context
surf frame.main                # Return to main frame
surf frame.js --id "FRAME_ID" --code "return document.title"

# After frame.switch, subsequent commands target that frame:
surf frame.switch "iframe-1"
surf page.read                 # Reads iframe content
surf click e5                  # Clicks in iframe
surf frame.main                # Back to main page
```

## Network Inspection

```bash
surf network                   # List captured requests
surf network --stream          # Real-time network events
surf network.get --id "req-123"   # Full request details
surf network.body --id "req-123"  # Get response body
surf network.curl --id "req-123"  # Generate curl command
surf network.origins           # List origins with stats
surf network.stats             # Capture statistics
surf network -vv --body-mode text --per-body-bytes 65536
surf network.export --har --output ./trace.har
surf network.clear             # Clear captured requests
```

Response-body capture supports `none`, `text`, and `all` modes plus per-body and per-tab-session byte caps. HAR exports carry body completeness metadata. Persistent network state is private under `~/.surf/state/network/` by default; configure `SURF_NETWORK_PATH` in the native host environment to change it.

## Console

```bash
surf console                   # Get console messages
surf console --stream          # Real-time console
surf console --stream --level error  # Errors only
```

## JavaScript Execution

```bash
surf js "return document.title"
surf js "document.querySelector('.btn').click()"
```

## Performance

```bash
surf perf.metrics              # Current metrics snapshot
surf perf.start                # Start trace
surf perf.stop                 # Stop and get results
```

## Screenshots

```bash
surf screenshot                           # Auto-saves to /tmp/surf-snap-*.png
surf screenshot --output /tmp/shot.png    # Save to specific file
surf screenshot --selector ".card"        # Element only
surf screenshot --full-page               # Full page scroll capture
surf screenshot --full-page /tmp/full.png # Full page saved to path
surf screenshot --no-save                 # Return base64 only, don't save file
```

## Zoom

```bash
surf zoom                      # Get current zoom level
surf zoom 1.5                  # Set zoom to 150%
surf zoom 1                    # Reset to 100%
```

## Cookies & Storage

```bash
surf cookie list               # List cookies for current page
surf cookie list --domain .google.com
surf cookie set --name "token" --value "abc123"
surf cookie get "token"
surf cookie clear --all        # Clear all cookies
surf cookie delete "token"     # Clear one cookie
```

## History & Bookmarks

```bash
surf history --query "github" --max 20
surf bookmarks --query "docs"
surf bookmark.add --url "https://..." --title "My Bookmark"
surf bookmark.remove
```

## Health Checks & Smoke Tests

```bash
surf health --url "http://localhost:3000"
surf smoke --urls "http://localhost:3000" "http://localhost:3000/about"
surf smoke --urls "..." --screenshot /tmp/smoke
```

## Workflows

Execute multi-step browser automation as a single command with smart auto-waits.

### Inline Workflows

```bash
# Pipe-separated commands
surf do 'go "https://example.com" | click e5 | screenshot'

# Multi-step login flow
surf do 'go "https://example.com/login" | type "user@example.com" --selector "#email" | type "pass" --selector "#password" | click --selector "button[type=submit]"'

# Validate without executing
surf do 'go "url" | click e5' --dry-run
```

### Named Workflows

Save workflows as JSON files in `~/.surf/workflows/` (user) or `./.surf/workflows/` (project):

```bash
# List available workflows
surf workflow.list

# Show workflow details
surf workflow.info my-workflow

# Run by name with arguments
surf do my-workflow --email "user@example.com" --password "secret"

# Validate workflow file
surf workflow.validate workflow.json
```

### Workflow JSON Format

```json
{
  "name": "Login Flow",
  "description": "Automate login process",
  "args": {
    "email": { "required": true },
    "password": { "required": true },
    "url": { "default": "https://example.com/login" }
  },
  "steps": [
    { "tool": "navigate", "args": { "url": "%{url}" } },
    { "tool": "type", "args": { "text": "%{email}", "selector": "input[name=email]" } },
    { "tool": "type", "args": { "text": "%{password}", "selector": "input[name=password]" } },
    { "tool": "click", "args": { "selector": "button[type=submit]" } },
    { "tool": "screenshot", "args": {}, "as": "result" }
  ]
}
```

### Loops and Step Outputs

```json
{
  "steps": [
    // Capture step output for later use
    { "tool": "js", "args": { "code": "return [1,2,3]" }, "as": "items" },
    
    // Fixed iterations
    { "repeat": 5, "steps": [
      { "tool": "click", "args": { "ref": "e5" } }
    ]},
    
    // Iterate over array
    { "each": "%{items}", "as": "item", "steps": [
      { "tool": "js", "args": { "code": "console.log('%{item}')" } }
    ]},
    
    // Repeat until condition
    { "repeat": 20, "until": { "tool": "js", "args": { "code": "return done" } }, "steps": [...] }
  ]
}
```

### Workflow Options

```bash
--file, -f <path>     # Load from JSON file
--dry-run             # Parse and validate without executing
--on-error stop|continue  # Error handling (default: stop)
--step-delay <ms>     # Delay between steps (default: 100, 0 to disable)
--no-auto-wait        # Disable automatic waits
--json                # Structured JSON output
```

**Auto-waits:** Commands automatically wait for completion:
- Navigation (`go`, `back`, `forward`) → waits for page load
- Clicks, key presses, form fills → waits for DOM stability
- Tab switches → waits for tab to load

**Why use `do`?** Instead of 6-8 separate CLI calls with LLM orchestration between each, a workflow executes deterministically. Faster, cheaper, and more reliable.

## Playbooks

Use `surf do` for a direct command sequence. Use a playbook for a reusable site capability with provenance, browser-session network execution, workflow fallback, and write-safety policy.

```bash
surf playbook list
surf pb show page
surf pb ops page
surf use page read --json
```

Resolution order is project (`./.surf/playbooks/`), user (`~/.surf/playbooks/`), then built-in. Provider compatibility commands stay on their validated command paths until provider playbooks have real login-flow validation. A write op requires `--write`; Surf records semantic intent before dispatch so a timeout or concurrent retry cannot silently double-submit.

Author from redacted recent activity when it contains only read/navigation behavior, or use an explicit record for richer evidence:

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

Records, trace slices, receipts, and the bounded activity journal are private Surf state. Inputs and authentication headers are redacted by default. Use `--include-input-values` only when the saved values are necessary and acceptable.

Client projections replay a validated read endpoint and never embed captured browser credentials:

```bash
surf pb client derive example --op read --from-record <record-id> --request-id <request-id> --out ./client
surf pb client export example --op read --out ./client
surf pb client verify ./client
```

## Error Diagnostics

```bash
# Auto-capture screenshot + console on failure
surf wait.element ".missing" --auto-capture --timeout 2000
# Saves to /tmp/surf-error-*.png
```

## Common Options

```bash
--tab-id <id>         # Target specific tab
--window-id <id>      # Target specific window
--json                # Raw JSON output  
--auto-capture        # Screenshot + console on error
--timeout <ms>        # Override default timeout
```

## Tips

1. **First CDP operation is slow** (~5-8s) - debugger attachment overhead, subsequent calls fast
2. **Use refs from page.read** for reliable element targeting over CSS selectors
3. **JS method for contenteditable** - Modern editors (ChatGPT, Claude, Notion) need `--method js`
4. **Named tabs for workflows** - `tab.name app` then `tab.switch app`
5. **Auto-capture for debugging** - `--auto-capture` saves diagnostics on failure
6. **AI tools use browser session** - Must be logged into the service (ChatGPT, Gemini, Perplexity, Grok, AI Studio), no API keys needed
7. **Grok validation** - Run `surf grok --validate` if queries fail to check UI changes
8. **Long timeouts for reasoning-heavy models** - ChatGPT o1 and Grok Expert can take 60+ seconds. AI Studio builds default to 600s.
9. **AI Studio for unrestricted Gemini** - `surf aistudio` gives less filtered responses than `surf gemini` for the same models
10. **Use `surf do` for multi-step tasks** - Reduces token overhead and improves reliability
11. **Dry-run workflows first** - `surf do '...' --dry-run` validates without executing
12. **Window isolation** - Use `window.new` + `--window-id` or `--tab-id` to keep agent work separate from your browsing
13. **Request lock** - Non-streaming browser CLI requests serialize per socket; use `--no-lock` only when you intentionally want to bypass it
14. **Native host diagnostics** - If commands fail with socket/native-host errors, run `surf doctor` or `surf doctor --browser all` before guessing at reinstall steps
15. **Animation capture** - Use `surf record --duration 2000 --fps 10 --output /tmp/anim.gif` when the agent needs to see motion; use `animate-audit` for numeric timelines and `perf-audit` for jank/layout-shift snapshots
16. **Hard isolation** - Use separate browser/profile instances plus separate `SURF_SOCKET` values when agents must not share a host or target
17. **Semantic locators** - `locate.role`, `locate.text`, `locate.label` for more robust element finding
18. **Frame context** - Use `frame.switch` before interacting with iframe content

## Socket API

For programmatic access:

```bash
echo '{"type":"tool_request","method":"execute_tool","params":{"tool":"tab.list","args":{}},"id":"1"}' | nc -U /tmp/surf.sock
```
