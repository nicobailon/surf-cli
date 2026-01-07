# Changelog

All notable changes to surf CLI will be documented in this file.

## [2.2.0] - 2026-01-07

### Added
- Network capture: `network`, `network.stats`, `network.origins`, `network.get`, `network.clear`, `network.export`
- Filtering by method, status, URL, content-type
- Export formats: curl, raw JSON, URL list
- Persistence to `/tmp/surf/` (configurable via `SURF_NETWORK_PATH`)

## [2.1.0] - 2025-12-30

### Added

**ChatGPT Integration**
- `chatgpt <query>` - Send prompt to ChatGPT using browser cookies (no API key)
  - `--with-page` - Include current page context
  - `--model` - Specify model (gpt-4o, o1, etc.)
  - `--timeout` - Custom timeout (default: 45 minutes)
  - File attachments coming soon

**Gemini Integration (Coming Soon)**
- `gemini <query>` - Command structure ready, implementation pending

**Request Queue**
- AI requests are queued sequentially with 2s minimum delay between requests
- Prevents rate limiting when making multiple AI queries

### Technical Changes
- New `chatgpt-client.cjs` module for ChatGPT browser automation
- Extension: `GET_CHATGPT_COOKIES`, `GET_GOOGLE_COOKIES` handlers
- Extension: `CHATGPT_NEW_TAB`, `CHATGPT_CLOSE_TAB`, `CHATGPT_CDP_COMMAND`, `CHATGPT_EVALUATE` handlers
- CDP controller: Added public `sendCommand()` method

## [2.0.0] - 2025-12-27

### Breaking Changes
- Removed snake_case command aliases (use dot-notation instead)
  - `read_page` -> `page.read`
  - `list_tabs` -> `tab.list`
  - `wait_for_element` -> `wait.element`
  - `javascript_tool` -> `js`
  - And others (see REMOVED_COMMANDS in cli.cjs for full list)
- Removed all single-letter short flags for consistency
  - Use `--output` instead of `-o`
  - Use `--ref` instead of `-r`
  - Use `--annotate` instead of `-a`
  - Use `--fullpage` instead of `-f`
- Migration hints shown when using old command names

### Added

**Navigation**
- `back` - Go back in browser history
- `forward` - Go forward in browser history
- `tab.reload` - Reload tab (with `--hard` for cache bypass)

**Tab Groups**
- `tab.group` - Create or add to tab group
- `tab.ungroup` - Remove tabs from group
- `tab.groups` - List all tab groups

**Zoom Control**
- `zoom` - Get current zoom level
- `zoom <level>` - Set zoom (e.g., `zoom 1.5` for 150%)
- `zoom --reset` - Reset to default zoom

**Cookies**
- `cookie.list` - List cookies for current domain
- `cookie.get` - Get specific cookie by name
- `cookie.set` - Set a cookie
- `cookie.clear` - Clear specific cookie or all (`--all`)

**Search**
- `search <term>` - Search for text in page (alias: `find`)
- Returns match refs, context, and element associations

**Batch Execution**
- `batch --actions '[...]'` - Execute multiple actions
- `batch --file workflow.json` - Load actions from file

**Bookmarks**
- `bookmark.add` - Bookmark current page
- `bookmark.remove` - Remove bookmark for current page
- `bookmark.list` - List bookmarks

**History**
- `history.list` - Recent browser history
- `history.search <query>` - Search history

**Screenshot Enhancements**
- `--annotate` - Draw element labels on screenshot
- `--fullpage` - Capture entire scrollable page
- `--max-height` - Limit fullpage capture height (default: 4000px)
- Extension UI automatically hidden during capture

**Aliases**
- `snap` -> `screenshot` (auto-saves to /tmp if no output specified)
- `read` -> `page.read`
- `find` -> `search`
- `go` -> `navigate`

**Discovery Features**
- `--find <query>` - Fuzzy search for commands
- `--about <topic>` - Learn about a topic

**Help System**
- `--help` - Basic help with common commands
- `--help-full` - Complete command reference
- `--help-topic <topic>` - Topic-specific guide
- Command-level help with examples

**Other**
- `--version` - Show version
- `click 100 200` - Positional coordinates for click
- `click --selector ".btn" --index 2` - Click nth element matching selector

### Changed
- Primary argument support for commands:
  - `wait.element <selector>` (was `--selector`)
  - `wait.url <pattern>` (was `--pattern`)
  - `click <ref>` with e-prefix detection (e.g., `click e5`)
- Help output includes usage examples for all commands
- `dialog.dismiss --all` for repeatedly dismissing dialogs
- Fullpage screenshot delay increased to 300ms for lazy-loaded content
- Error messages standardized to terse format for AI consumption

### Fixed
- `--limit 0` now correctly returns empty results (was defaulting to max)
- Screenshot always hides extension UI (was conditional on `--clean` flag)

## [1.x] - Previous Releases

See git history for changes before v2.0.0.
