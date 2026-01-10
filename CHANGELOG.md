# Changelog

## [Unreleased]

### Added
- **Window isolation for multi-agent workflows** - New `window.*` commands (`new`, `list`, `focus`, `close`, `resize`) and `--window-id` global option. Agents can work in separate browser windows without interfering with user browsing.
- **Helpful hints in CLI output** - Commands now show actionable hints (e.g., `window.new` shows how to use `--window-id`)
- **Auto-tab creation** - When targeting a window with only restricted tabs (chrome://, extensions), Surf auto-creates a usable tab
- **Linux support (experimental)** - Added ImageMagick fallback for screenshot resizing, supports both IM6 (`convert`) and IM7 (`magick`). Install script already handles Linux native messaging paths.
- **`surf --help-topic windows`** - New help topic explaining window isolation workflow
- **Extension disconnect detection** - CLI detects when extension disconnects and exits cleanly with a helpful message
- **Testing infrastructure** - Added vitest with coverage, Chrome API mocks, and network formatter tests
- **Perplexity AI integration** - Query Perplexity using browser session via `surf perplexity "query"`. Supports `--with-page` for context, `--mode` for search modes, and `--model` for model selection (Pro features).
- **`surf read` now includes visible text by default** - Reduces agent round-trips by returning both accessibility tree and page text content in one call. Use `--no-text` to get only interactive elements.

### Changed
- `surf read` behavior changed: now includes `--- Page Text ---` section by default
- Added `--no-text` flag to `surf read` to exclude text content (previous default behavior)
- `tab.list` now respects `--window-id` to show only tabs in that window
- `tab.new` now respects `--window-id` to create tabs in a specific window

### Fixed
- Fixed internal message `id` leaking into JSON output for window commands
- Fixed `windowId` not being forwarded from CLI through native host to extension
- Fixed `tab.new` not creating tabs in the specified window when using `--window-id`
- Fixed `tab.list` not filtering by window when using `--window-id`
- Fixed `tab.list` showing no output when no tabs exist (now shows helpful message)
- Fixed `--window-id` and `--tab-id` not being parsed as integers (caused Chrome API errors with helpful validation)
- Fixed ImageMagick 7 compatibility (`magick identify` fallback for systems without standalone `identify`)
- Fixed text content not being included when screenshots were also present in page read responses

### Removed
- Removed non-functional base64 image output from CLI (was not being interpreted by agents)
