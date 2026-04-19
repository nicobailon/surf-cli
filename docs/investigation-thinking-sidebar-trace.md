# Investigation: ChatGPT Right-Side Thinking Trace Capture

## Summary

Right-side reasoning trace still exists in ChatGPT UI, but the old **React fiber extraction path is no longer viable**. Current client-side data no longer exposes reasoning content through `allMessages`; headless can still detect trigger chips, but **cannot extract full reasoning content**. Remaining path: **headed-mode flyout click + DOM read**. Current trigger patterns to watch: `Detail`, `Details`, `Reasoning`, plus legacy `Thought for` / `Thinking for`.

## Symptoms

- Current `surf chatgpt` cloak path only surfaces live inline trace labels (`⏳ Thinking`, snippets) via `DETECT_PHASE_JS`
- User reports clicking the trace chip in ChatGPT opens a right sidebar with elapsed time + full thinking trace
- Need to know whether surf-cli can capture that richer sidebar instead of only the inline phase label

## Initial Assessment

Current code only watches the **last assistant turn** and extracts:
- rendered answer text via `EXTRACT_TEXT_JS`
- inline phase label via `DETECT_PHASE_JS`

It does **not**:
- click the trace chip
- inspect global portal/flyout containers
- persist sidebar text in worker success payload

Relevant code:
- `native/chatgpt-cloak-worker.mjs:145-223` — turn selectors, `EXTRACT_TEXT_JS`, `DETECT_PHASE_JS`
- `native/chatgpt-cloak-worker.mjs:539-620` — response polling loop, emits `trace` events only
- `native/chatgpt-cloak-bridge.cjs:98-126` — forwards `trace` events only
- `native/cli.cjs:3121-3143` — prints `[cloak-chatgpt] ⏳ ...` only

## Investigation Log

### Phase 1 — Existing code path
**Hypothesis:** maybe current worker is already close to sidebar capture.

**Findings:**
- Current cloak worker scopes all reading to the **last assistant turn** via `FIND_LAST_ASSISTANT_JS`
- `DETECT_PHASE_JS` clones the turn and strips `.markdown` to infer a short phase label only
- No selectors/state for trace-chip trigger, flyout root, sidebar content, or close button

**Evidence:**
- `native/chatgpt-cloak-worker.mjs:145-223`
- `native/chatgpt-cloak-worker.mjs:539-620`

**Conclusion:** confirmed — current implementation cannot capture the right-side trace without a new post-response step.

### Phase 2 — External repo scan
**Hypothesis:** other ChatGPT automation projects may already capture the full sidebar trace.

**Findings:**
- I checked multiple browser automation / reverse-engineered ChatGPT projects via `librarian`
- None showed code that clicks the thinking chip and parses the right sidebar
- Most repos capture only:
  - final assistant text from DOM, or
  - final `message.content.parts[0]` from API/SSE
- No repo found with sidebar selectors, flyout parsing, or elapsed-thinking-time extraction

**Conclusion:** this would be a **novel implementation** in surf-cli, not a standard borrowed pattern.

### Phase 3 — Runtime probe: headless Cloak
**Hypothesis:** the trace chip opens a flyout in headless too; we just need selectors.

**Experiment:** one-off probe script `tmp/reasoning-sidebar-probe.mjs`
- sends a thinking-model prompt
- waits for response
- finds the `Thought for Ns` button near the assistant turn
- clicks it
- inspects right-side DOM, mutations, screenshots, network

**Findings:**
- Headless run found the chip/button text, e.g. `Thought for 5s` / `Thought for 9s`
- But clicking did **not** open a visible flyout
- Screenshots before/after were visually identical
- Right-side scan returned no pane
- Mutations did not show a flyout node
- Network after click did not show a dedicated reasoning-panel request

**Evidence:**
- `/tmp/reasoning-sidebar-before.png`
- `/tmp/reasoning-sidebar-after.png`
- `/tmp/reasoning-sidebar-probe.log`

**Conclusion:** in headless Cloak, this affordance was **not reliably openable** in my probe.

### Phase 4 — Runtime probe: headed Cloak
**Hypothesis:** UI behavior differs in headed mode; the trace chip may become interactive.

**Experiment:** same probe script in headed mode

**Findings:**
- The trace chip/button was present and hoverable: `Thought for 17s`
- Playwright-level click opened a real right-side flyout
- Flyout root had stable selector: `data-testid="stage-thread-flyout"`
- Flyout geometry: right-side panel at approx `x=1040, w=400, h=1000`
- Flyout text included:
  - header: `Activity · 17s`
  - section heading: `Thinking`
  - full point-by-point reasoning trace
  - footer: `Thought for 17s Done`
- Mutation log showed repeated width/style changes on the flyout as it animated open
- No evidence of a dedicated post-click trace-network request; panel appears to be rendered from existing client state / DOM model

**Evidence:**
- Screenshot after click: `/tmp/reasoning-sidebar-after.png`
- Headed probe log: `/tmp/reasoning-sidebar-headed.log`
- Key DOM evidence from log:
  - trigger text: `Thought for 17s`
  - flyout root: `data-testid="stage-thread-flyout"`
  - flyout class: `stage-thread-flyout-preset-default`
  - flyout text prefix: `Activity · 17s Thinking ...`

**Conclusion:** confirmed — the full sidebar trace is capturable from DOM in headed mode.

## Root Cause / Why surf-cli misses it today

surf-cli misses the full trace because the current cloak worker only performs **passive turn-local polling**:
- reads final answer text from the assistant turn
- reads an inline phase label from the assistant turn
- never activates the trace UI affordance
- never inspects global flyout containers attached outside the turn tree

So the richer trace is not “missing from the page entirely”; it is simply outside the current extraction model.

## Source Classification

Best current classification: **client-side flyout / DOM state**, not a trace-specific network fetch.

Why:
- Headed click produced a flyout with stable `data-testid="stage-thread-flyout"`
- Mutation log showed style/width animation on the flyout
- No trace-specific post-click request was observed
- Therefore the likely source is: existing client/React state rendered into the flyout on click

## Important Caveat

### Headed vs headless divergence

This is the main risk.

Observed behavior:
- **Headed Cloak:** trace chip opens flyout successfully
- **Headless Cloak:** chip exists, but flyout did not open in my probes

Possible explanations:
1. ChatGPT disables this interaction in headless
2. Different CSS/interaction state makes the chip effectively non-interactive in headless
3. More precise pointer choreography is required in headless
4. A/B experiment / account / viewport variance

So: **capturable, yes — but not yet proven reliable in current production headless path.**

## Recommended Fix Shape

### Safe path: additive post-response probe in cloak worker

Add a new post-response step in `native/chatgpt-cloak-worker.mjs`, after response completion and before `success(...)`:

1. find trace trigger near latest assistant turn
   - visible button text matching `Thought for` / `Thinking for`
2. click it with Playwright-level click/hover
3. poll for flyout root:
   - `[data-testid="stage-thread-flyout"]`
4. extract:
   - elapsed time from header (`Activity · 17s`)
   - section title(s) (`Thinking`)
   - full flyout text / bullet steps
5. optionally close flyout
6. return additive payload in `success(...)`, e.g.
   - `thinkingTraceText`
   - `thinkingTraceElapsed`
   - `thinkingTraceAvailable`

### Why this shape
- keeps main response capture stable
- additive; no protocol break required
- easy to guard behind thinking/pro modes only
- easier to debug than embedding into main poll loop

## Minimal Selector Set Discovered

### Trigger
- visible button within last assistant turn
- current text patterns: `Detail`, `Details`, `Reasoning`
- legacy fallback: `Thought for <n>s`, `Thinking for <n>s`

### Flyout root
- `[data-testid="stage-thread-flyout"]`
- practical only in headed mode

### Flyout contents
Observed visible text structure:
- `Activity · <elapsed>`
- `Thinking`
- bullet / prose reasoning trace
- trailing status: `Thought for <elapsed>` + `Done`

## 2026-04 Update: React Fiber Extraction Broken

Key findings:
- Trigger text changed. Old `Thought for Xs` no longer reliable. Current UI shows `Detail` / `Details` / `Reasoning`. In latest probe, singular `Detail` appeared.
- React fiber `allMessages` shape changed. It now exposes only `content_type: "text"` in this path.
- No `content_type: "thoughts"`.
- No `content_type: "reasoning_recap"`.
- Net: OpenAI locked down reasoning access in the client-side data model.

Implications:
- Worker trigger regex updated to match `Detail` / `Details` / `Reasoning`, with legacy fallback to `Thought for` / `Thinking for`.
- Headless extraction now blocked. Trigger can be found; reasoning body cannot.
- Old fiber walk can still produce diagnostics, not reasoning content.
- Only remaining viable path: **headed mode**, click trigger, read `stage-thread-flyout` DOM.

Status:
- React fiber extraction: historical only; no longer viable for reasoning capture.
- Headless reasoning capture: blocked.
- Headed flyout extraction: only remaining path.

## Eliminated Hypotheses

- **Dedicated post-click network fetch for trace panel** — not supported by observed traffic
- **Another repo already solved this** — no evidence found in librarian scan
- **Current worker already nearly captures it** — false; passive polling is insufficient
- **SSE/HTTP stream contains thoughts** — false; ChatGPT moved to WebSocket conduit
- **Flyout approach works headless** — false in current probes; headless extraction blocked
- **React fiber still exposes reasoning** — false in 2026-04 probes; `allMessages` now text-only here
- **Fetch monkey-patch captures data** — false; HTTP response is just a conduit token

## Artifacts

- Probe scripts: `tmp/reasoning-sidebar-probe.mjs`, `tmp/extract-recap-probe.mjs`, `tmp/ws-full-probe.mjs`
- Headless log: `/tmp/reasoning-sidebar-probe.log`
- Headed log: `/tmp/reasoning-sidebar-headed.log`
- WebSocket dump: `/tmp/ws-encoded-items.txt`
- Before screenshot: `/tmp/reasoning-sidebar-before.png`
- After screenshot: `/tmp/reasoning-sidebar-after.png`
