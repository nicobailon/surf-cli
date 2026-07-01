# Changelog

## [Unreleased]

### Added
- **Cookie subcommands** - Added space-separated cookie commands (`surf cookie list`, `get`, `set`, `clear --all`, and `delete`) while keeping existing `cookie.*` commands working.

### Fixed
- **Resize shorthand parsing** - `surf resize 375 812` now maps positional width and height, while `surf resize 375` sets width only.
- **Grok UI drift** - Updated default model selection for the current Grok menu, broadened send-button validation, and trimmed trailing suggested follow-up chips from extracted responses.
- **WSL2 native messaging host install** - Install/uninstall now target Windows browser manifests from WSL2 by default, preserve manifest origins, forward wrapper arguments, and include clearer socket diagnostics.
- **JavaScript expression evaluation** - `surf js` now returns single-expression values while preserving statement-script fallback behavior.
- **Baseline CI validation** - Restored lint, typecheck, tests, and critical audit checks on current dependencies.
- **Native messaging host portability** - Generated Unix wrappers now use `#!/usr/bin/env bash` so Chrome can launch the host on NixOS, Guix, and other non-FHS Linux systems. (@ppetru)
- **Gemini blob-backed generated images** - Detect and extract Gemini-generated `blob:` images from the page while preserving existing `gg-dl` URL downloads. (@goneflyin)
- **Accessibility tree nested labels** - Include nested text content when naming interactive links, buttons, and summaries so child spans contribute accessible names. (@skyeryg)

### Dependencies
- Bump Vitest package group from 4.0.18 to 4.1.9 to clear the critical audit advisory.

## [2.7.2] - 2026-04-10

### Fixed
- **ChatGPT login detection** - Accept chunked NextAuth session cookies such as `__Secure-next-auth.session-token.0` during login checks, matching ChatGPT's current cookie layout.
- **ChatGPT response extraction** - Improved assistant turn detection and completion polling so responses are still captured when ChatGPT's DOM structure shifts or thinking output renders through newer turn containers.
- **ChatGPT model selection** - Updated `surf chatgpt --model` to match the current ChatGPT model menu and select `Instant`, `Thinking`, and `Pro` reliably.
- **ChatGPT error reporting** - Preserve `/backend-api/me` login check failures instead of downgrading them to a generic `ChatGPT login required` error.

## [2.7.1] - 2026-02-28

### Fixed
- **Scroll command failing silently** - Fixed `surf scroll` not working on sites with `scroll-behavior: smooth` (e.g., component.gallery). CDP `mouseWheel` events were silently ignored on these sites. Now uses `window.scrollBy()` via script evaluation, which works reliably on all sites.

## [2.7.0] - 2026-02-25

### Added
- **Gemini image generation** (`surf gemini --generate-image`) - Generate images via UI automation. Google made image generation session-bound, blocking external HTTP requests. This feature automates the browser UI: opens a Gemini tab, types the prompt, clicks send, polls for generated images, and downloads via the extension's credentialed fetch.
- **Gemini image editing** (`surf gemini --edit-image`) - Edit existing images with text prompts. Uses CDP file chooser interception to upload images, then follows the same UI automation flow as generation.

### Fixed
- **Gemini file upload reliability** - Added retry logic (3 attempts with 10s/15s/20s timeouts) and stale menu handling for the file chooser flow.

## [2.6.0] - 2026-02-21

### Added
- **AI Studio provider** (`surf aistudio`) - Query Gemini models via aistudio.google.com using your browser session. Supports `--model` for best-effort model selection and `--with-page` to include current page context. Extracts responses from both DOM and network (GenerateContent RPC), with thinking-model support. (co-authored by @w-winter)
- **AI Studio App Builder** (`surf aistudio.build`) - Automate AI Studio's App Builder to generate web apps from a text prompt. Downloads the result as a zip file and optionally extracts it to `--output`. Supports `--model`, `--timeout`, and `--keep-open`.
- **Windows support** - Named pipes for socket paths, `SURF_TMP` for temp files, ImageMagick quoting fixes, skip Unix-only `unlinkSync`/`chmodSync`. (@marcfargas)
- **Helium browser support** - Detect and connect to Helium browser alongside Chrome. (@aliou)
- **Env var overrides** - `SURF_SOCKET_PATH`, `SURF_HOST_PATH`, and `SURF_MANIFEST_PATH` for package manager installs. (@aliou)
- **Skills in npm package** - Skills directory now included in published package. (@aliou)

### Fixed
- **CLI --version** - Read version dynamically from `package.json` instead of a hardcoded constant. (@davidguttman)

### Dependencies
- Bump `vite-plugin-node-polyfills` from 0.24.0 to 0.25.0

## [2.5.2] - 2026-01-28

### Fixed
- **CLI version display** - Fixed hardcoded VERSION constant showing "2.0.0" instead of actual version

### Docs
- **SKILL.md overhaul** - Comprehensive update with all v2.1-2.5 features including semantic locators, workflows with loops/arguments, frame context, window isolation, and more

## [2.5.1] - 2026-01-28

### Fixed
- **Gemini client hanging** - Fixed HTTP requests hanging indefinitely when called through native messaging host. Root cause was missing `content-length` header - Node.js failed to auto-calculate content length in the native messaging stdio context, causing the server to wait for more data that never came.
- **Gemini SSL/TLS** - Added `rejectUnauthorized: false` for Gemini API requests (matches Python library behavior)
- **Gemini host header** - Added explicit `host: gemini.google.com` header required by Google's servers

### Improved
- **HTTP request robustness** - Added explicit timeouts, better error handling, and debug logging throughout the Gemini client
- **Buffer handling** - Proper UTF-8 encoding for POST request bodies

## [2.5.0] - 2026-01-23

### Added
- **Named workflows** - Save workflows as JSON files in `~/.surf/workflows/` (user) or `./.surf/workflows/` (project) and run by name: `surf do my-workflow --arg1 value`
- **Workflow arguments** - Define typed arguments with `required` and `default` values. Variable substitution via `%{argname}` syntax in step args.
- **Step outputs** - Capture step results with `as` field for use in later steps: `{ "tool": "js", "args": {...}, "as": "result" }`
- **Loops** - `repeat` for fixed iterations, `each` for array iteration, with optional `until` exit condition:
  ```json
  { "repeat": 5, "steps": [...] }
  { "each": "%{items}", "as": "item", "steps": [...] }
  { "repeat": 20, "until": { "tool": "js", "args": {...} }, "steps": [...] }
  ```
- **Workflow discovery commands**:
  - `surf workflow.list` - List available workflows
  - `surf workflow.info <name>` - Show workflow details, arguments, and steps
  - `surf workflow.validate <file>` - Validate workflow JSON structure
- **Workflow metadata** - `name`, `description`, and `args` schema in workflow files for documentation and validation

### Changed
- **Dry-run output improved** - Shows workflow name, description, formatted steps with loop structure, and resolved variables

## [2.4.2] - 2026-01-23

### Fixed
- **Grok response detection** - Fixed timeout issues where Grok responses were visible in the browser but not detected by the CLI. Improved completion detection by:
  - Using DOM-based response extraction (articles, conversation containers) instead of relying on body text parsing
  - Tracking response text stability rather than noisy full-page body text
  - Recognizing "Thought for Xs" as a definitive completion signal for thinking models
  - Fixing false positive "isThinking" detection that matched Grok model names
- **Grok thinking model support** - Long-running thinking queries (1+ minutes) now reliably return complete responses

## [2.4.1] - 2026-01-22

### Changed
- **Workflow syntax** - Pipe separator `|` is now the primary way to chain commands inline:
  `surf do 'go "https://example.com" | click e5 | screenshot'`
  Newlines still supported for file-based workflows and heredocs.

## [2.4.0] - 2026-01-22

### Added
- **Workflow execution** - New `surf do` command to execute multi-step browser workflows as a single operation. Reduces token overhead and improves reliability for common automation sequences.
  - Inline workflows: `surf do 'go "url" | click e5 | screenshot'`
  - File-based workflows: `surf do --file workflow.json`
  - Dry run validation: `surf do '...' --dry-run`
  - Smart auto-waits after navigation, clicks, and form submissions
  - Configurable error handling: `--on-error stop|continue`
  - Adjustable step delay: `--step-delay 200` (or `0` to disable)
  - JSON output: `--json` for structured results
  - Tab/window targeting: `--tab-id`, `--window-id`
- **Workflow parser** - Newline-separated command syntax with comment support (`#` lines), quote-aware tokenization, and automatic alias resolution.
- **Workflow executor** - Sequential execution with streaming progress output, command-specific auto-waits (wait.load for navigation, wait.dom for clicks), and variable substitution support (`%{varname}` syntax for Phase 2).
- **Workflow unit tests** - 42 new tests covering parser tokenization, command parsing, and executor auto-wait logic.

## [2.3.1] - 2026-01-20

### Changed
- Added tropical beach banner image to README with robot surfing, Chrome logos, and palm trees.
- Added npm version, license, and platform badges to README.

## [2.3.0] - 2026-01-20

### Added
- **Grok AI integration** - Query X.com's Grok AI via `surf grok "query"`. Supports `--with-page` for context, `--deep-search` for DeepSearch mode, and `--model` for model selection. Requires X.com login in Chrome.
- **Grok validation command** - `surf grok --validate` checks UI structure and lists available models. Use `--save-models` to persist discovered models to `surf.json` config for when X updates their UI.
- **Grok response warnings** - Agents receive warnings when model selection fails or differs from requested, with actionable suggestions to run `--validate`.
- **Grok unit tests** - 17 new tests covering response extraction, cookie validation, and model loading.

### Fixed
- Fixed AI query response detection being too slow due to overly strict completion checks.
- Fixed short responses (like "4" for math queries) not being detected due to minimum length requirement.

## [2.2.0] - 2025-01-19

### Added
- **Element styles inspection** - New `element.styles` command to get computed CSS styles from elements. Returns font, color, background, border, padding, and bounding box. Accepts refs or CSS selectors.
- **Dropdown select command** - New `select` command to select options in `<select>` dropdowns. Supports single/multi-select, matching by value (default), label, or index.

## [2.1.0] - 2025-01-17

### Added
- **Frame context for iframe support** - `frame.switch` now properly affects subsequent commands (`page.read`, `locate.*`, `click`, `search`, etc.). Switch to an iframe and all content script operations target that frame.
- **Semantic locators** - `locate.role`, `locate.text`, `locate.label` commands to find elements by ARIA role, text content, or label. Supports `--action click|fill|hover|text` to act on found elements.
- **Device emulation** - `emulate.device` with 19 device presets (iPhone, iPad, Pixel, Galaxy, Nest Hub). Includes `emulate.viewport`, `emulate.touch` for custom configurations.
- **Performance tracing** - `perf.start`, `perf.stop`, `perf.metrics` for capturing Chrome performance traces.
- **Page read optimization** - `--depth` and `--compact` flags for `page.read` to reduce output size for LLM efficiency.
- **Window isolation for multi-agent workflows** - New `window.*` commands (`new`, `list`, `focus`, `close`, `resize`) and `--window-id` global option. Agents can work in separate browser windows without interfering with user browsing.
- **Helpful hints in CLI output** - Commands now show actionable hints (e.g., `window.new` shows how to use `--window-id`)
- **Auto-tab creation** - When targeting a window with only restricted tabs (chrome://, extensions), Surf auto-creates a usable tab
- **Linux support (experimental)** - Added ImageMagick fallback for screenshot resizing, supports both IM6 (`convert`) and IM7 (`magick`). Install script already handles Linux native messaging paths.
- **`surf --help-topic windows`** - New help topic explaining window isolation workflow
- **Screenshot auto-save control** - New `--no-save` flag and `autoSaveScreenshots` config option to disable auto-saving screenshots to `/tmp`. When disabled, returns base64 + ID instead of file path, saving context for agents that don't need the file.
- **Extension disconnect detection** - CLI detects when extension disconnects and exits cleanly with a helpful message
- **Testing infrastructure** - Added vitest with coverage, Chrome API mocks, and network formatter tests
- **Biome linter** - Strict linting for test code with rules for test best practices (no focused/skipped tests, no console, no any, etc.)
- **Perplexity AI integration** - Query Perplexity using browser session via `surf perplexity "query"`. Supports `--with-page` for context, `--mode` for search modes, and `--model` for model selection (Pro features).
- **`surf read` now includes visible text by default** - Reduces agent round-trips by returning both accessibility tree and page text content in one call. Use `--no-text` to get only interactive elements.

### Changed
- `surf read` behavior changed: now includes `--- Page Text ---` section by default
- Added `--no-text` flag to `surf read` to exclude text content (previous default behavior)
- `tab.list` now respects `--window-id` to show only tabs in that window
- `tab.new` now respects `--window-id` to create tabs in a specific window

### Fixed
- Fixed `locate.role`, `locate.text`, `locate.label`, `emulate.device`, `frame.js` not accepting positional arguments (missing from PRIMARY_ARG_MAP)
- Fixed `emulate.device --list` requiring a tab when it shouldn't (added to COMMANDS_WITHOUT_TAB)
- Fixed `surf screenshot` without `--output` returning an unusable in-memory ID instead of saving to file. Now auto-saves to `/tmp/surf-snap-*.png` like the `snap` alias, ensuring agents always get a usable file path. The `screenshotId` is still returned for use with `upload_image` workflow.
- Fixed MCP server `screenshot` tool not accepting `output` parameter (was only accepting `savePath`)
- Fixed frame context not being used by most content script operations (now `frame.switch` properly affects `page.read`, `locate.*`, `click`, `type`, `search`, etc.)
- Fixed frame context memory leak on tab close
- Fixed frame context not clearing on page navigation
- Fixed device emulation matching preferring shorter names ("iPhone 14" over "iPhone 14 Pro" when user typed "iphone14pro")
- Fixed `--depth` not being parsed as integer for `page.read`
- Fixed device presets out of sync between CLI and extension (now 19 devices in both)
- Fixed `performLocateAction` helper not respecting frame context for `--action` operations
- Fixed internal message `id` leaking into JSON output for window commands
- Fixed `windowId` not being forwarded from CLI through native host to extension
- Fixed `tab.new` not creating tabs in the specified window when using `--window-id`
- Fixed `tab.list` not filtering by window when using `--window-id`
- Fixed `tab.list` showing no output when no tabs exist (now shows helpful message)
- Fixed `--window-id` and `--tab-id` not being parsed as integers (caused Chrome API errors with helpful validation)
- Fixed ImageMagick 7 compatibility (`magick identify` fallback for systems without standalone `identify`)
- Fixed text content not being included when screenshots were also present in page read responses

### Removed
- Removed `session.*` commands - sessions couldn't actually provide profile isolation via native messaging (use `window.new --incognito` for cookie isolation instead)
- Removed non-functional base64 image output from CLI (was not being interpreted by agents)
