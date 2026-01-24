---
name: surf
description: Control Chrome browser via CLI for testing, automation, and debugging. Use when the user needs browser automation, screenshots, form filling, page inspection, network/CPU emulation, DevTools streaming, or AI queries via ChatGPT/Gemini/Perplexity/Grok.
---

# Surf Browser Automation

Control Chrome browser via CLI or Unix socket.

## CLI Quick Reference

```bash
surf --help                    # Full help
surf <group>                   # Group help (tab, scroll, page, wait, dialog, emulate, form, perf, ai)
surf --list                    # All 60+ tools
surf --find <term>             # Search tools
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
surf gemini "hello" --model gemini-2.5-flash      # Model selection
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
surf grok "quick question" --model fast           # Models: auto, fast, expert, thinking (default)
```

**Grok Validation & Troubleshooting:**
```bash
# Validate Grok UI and check available models (no query sent)
surf grok --validate

# If models changed, save discovered models to surf.json config
surf grok --validate --save-models
```

### AI Tool Troubleshooting

When AI queries fail, check these common issues:

1. **Not logged in**: The error "login required" means you need to log into the service in Chrome
2. **Model selection failed**: The UI may have changed. Run `surf grok --validate` to check
3. **Response timeout**: Thinking models (ChatGPT o1, Grok thinking) can take 45+ seconds
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

# Named tabs (aliases)
surf tab.name myapp            # Name current tab
surf tab.switch myapp          # Switch by name
surf tab.named                 # List named tabs
```

## Window Management

```bash
surf window.list                              # List all windows
surf window.new                               # New window
surf window.new --url "https://example.com"   # New window with URL
surf window.new --incognito                   # New incognito window
surf window.focus 12345                       # Focus window by ID
surf window.close 12345                       # Close window
surf window.resize --width 1920 --height 1080 # Resize current window
```

## Input Methods

```bash
# CDP method (real events) - default
surf type --text "hello"
surf click --x 100 --y 200

# JS method (DOM manipulation) - for contenteditable
surf type --text "hello" --selector "#input" --method js

# Keys
surf key Enter
surf key "cmd+a"
surf key.repeat --key Tab --count 5           # Repeat key presses
```

## Page Inspection

```bash
surf page.read                 # Accessibility tree with refs
surf page.read --ref e5        # Get specific element details
surf page.text                 # Plain text content
surf page.state                # Modals, loading state, scroll info
```

## Scrolling

```bash
surf scroll down               # Scroll down (default amount)
surf scroll up                 # Scroll up
surf scroll down --amount 5    # Scroll down more (1-10)
surf scroll.bottom             # Scroll to bottom of page
surf scroll.top                # Scroll to top of page
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

# Device emulation
surf emulate.device "iPhone 14"
surf emulate.device --list     # List available devices

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
```

## File Upload

```bash
surf upload --ref e5 --files "/path/to/file.txt"
surf upload --ref e5 --files "/path/file1.txt,/path/file2.txt"
```

## Network Inspection

```bash
surf network                   # List captured requests
surf network --stream          # Real-time network events
surf network.body --id "req-123"  # Get response body
surf network.clear             # Clear captured requests
```

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

## Iframe Handling

```bash
surf frame.list                # List frames with IDs
surf frame.js --id "FRAME_ID" --code "return document.title"
```

## Performance

```bash
surf perf.metrics              # Current metrics snapshot
surf perf.start                # Start trace
surf perf.stop                 # Stop and get results
```

## Screenshots

```bash
surf screenshot                           # To stdout (base64)
surf screenshot --output /tmp/shot.png    # Save to file
surf screenshot --selector ".card"        # Element only
surf screenshot --full-page               # Full page scroll capture
```

## Cookies & Storage

```bash
surf cookies                   # List cookies for current page
surf cookies --domain .google.com
surf cookie.set --name "token" --value "abc123"
surf cookie.delete --name "token"
```

## History & Bookmarks

```bash
surf history --query "github" --max 20
surf bookmarks --query "docs"
surf bookmark.add --url "https://..." --title "My Bookmark"
```

## Health Checks & Smoke Tests

```bash
surf health --url "http://localhost:3000"
surf smoke --urls "http://localhost:3000" "http://localhost:3000/about"
surf smoke --urls "..." --screenshot /tmp/smoke
```

## Workflows

Execute multi-step browser automation as a single command with smart auto-waits:

```bash
# Inline workflow (pipe-separated)
surf do 'go "https://example.com" | click e5 | screenshot'

# Multi-step login flow
surf do 'go "https://example.com/login" | type "user@example.com" --selector "#email" | type "pass" --selector "#password" | click --selector "button[type=submit]"'

# From JSON file
surf do --file workflow.json

# Validate without executing
surf do 'go "url" | click e5' --dry-run
```

**Why use `do`?** Instead of 6-8 separate CLI calls with LLM orchestration between each, a workflow executes deterministically. Faster, cheaper, and more reliable.

**Options:**
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

**JSON file format:**
```json
{
  "name": "Login Flow",
  "steps": [
    { "tool": "navigate", "args": { "url": "https://example.com" } },
    { "tool": "type", "args": { "text": "user@example.com", "selector": "input[name=email]" } },
    { "tool": "click", "args": { "selector": "button[type=submit]" } },
    { "tool": "screenshot", "args": {} }
  ]
}
```

## Script Mode (Legacy)

```bash
surf --script workflow.json
surf --script workflow.json --dry-run
```

Same JSON format as `surf do --file`. The `do` command is preferred as it also supports inline workflows.

## Error Diagnostics

```bash
# Auto-capture screenshot + console on failure
surf wait.element ".missing" --auto-capture --timeout 2000
# Saves to /tmp/surf-error-*.png
```

## Common Options

```bash
--tab-id <id>         # Target specific tab
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
6. **AI tools use browser session** - Must be logged into the service, no API keys needed
7. **Grok validation** - Run `surf grok --validate` if queries fail to check UI changes
8. **Long timeouts for thinking models** - ChatGPT o1, Grok thinking can take 60+ seconds
9. **Use `surf do` for multi-step tasks** - Reduces token overhead and improves reliability
10. **Dry-run workflows first** - `surf do '...' --dry-run` validates without executing

## Socket API

For programmatic access:

```bash
echo '{"type":"tool_request","method":"execute_tool","params":{"tool":"tab.list","args":{}},"id":"1"}' | nc -U /tmp/surf.sock
```
