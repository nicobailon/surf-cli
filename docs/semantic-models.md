# Semantic model evaluation

Surf's semantic commands (`semantic.find`, `semantic.filter`, `semantic.verify`,
`semantic.act`, and semantic `surf do` steps) can run on three decision models,
and `semantic.extract` runs on one extraction model:

| Model | Provider | Endpoint |
| --- | --- | --- |
| `jev-1.13.0` (default) | TypeSafe | `https://api.typesafe.ai` |
| `clef` | Cloudflare Workers AI | `https://api.cloudflare.com/client/v4/accounts/{id}/ai/run/@cf/cloudflare/clef` |
| `clef-flash` | Cloudflare Workers AI | `https://api.cloudflare.com/client/v4/accounts/{id}/ai/run/@cf/cloudflare/clef-flash` |
| `clairic` (`semantic.extract` only) | Cloudflare Workers AI | `https://api.cloudflare.com/client/v4/accounts/{id}/ai/run/@cf/cloudflare/clairic` |

`clairic` is an extraction model, not a decision model, and is used only by
`semantic.extract`. It has its own two thresholds, measured in
[Extraction (Clairic)](#extraction-clairic).

Each decision model has its own set of eight confidence thresholds. Surf
accepts only models in its registry, and a model enters the registry only with
all its thresholds measured, so no model runs with partial or borrowed thresholds.

This page explains how the Clef thresholds were chosen and how the three models
compared on the same fixtures. Later sections measure what `--vision` adds for
icon-only controls and how the Clairic thresholds were chosen.

## Method

The harness is `test/eval/real-semantic.mjs`. It makes real network calls, so it
refuses to run unless `SURF_REAL_SEMANTIC=1` is set:

```bash
SURF_REAL_SEMANTIC=1 TYPESAFE_API_KEY=... \
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
npm run eval:semantic -- --models jev-1.13.0,clef,clef-flash --repeat 10
```

- **Fixtures.** There are 19 small synthetic pages and goals: a notification settings page, an account page, and a shoe product page with and without a cart confirmation. They exercise every decision Surf asks a model to make, in four families:
  - **find (4):** three controls to locate, plus one control that is not on the page, where the correct answer is `none`.
  - **filter (3):** pick the page region relevant to a goal.
  - **verify (4):** two outcomes that are visible and two that are not.
  - **act (8):** `chooseAction` with write authority (`allowWrite`):
    - a correct click
    - a decoy, where "Delete account" sits next to "Save preferences" and the goal is to save
    - a fill
    - add-to-cart with the size already selected
    - an exact `--allow-ref` click on the right control
    - an exact `--allow-ref` on the destructive control while the goal is to save
    - two goals the page cannot satisfy: a sold-out color and a different product
- **Repetitions.** Each case ran 10 times per model, one call at a time.
- **Decisions.** The harness calls the same `find`, `filter`, `verify`, and `chooseAction` functions the CLI uses, through the same evaluator factory, with the selected model's thresholds.
- **Latency.** Provider latency is the round trip of each provider call, measured by the shared evaluator that every semantic command uses. It was measured from one developer machine on 2026-10-05 (the `clef` row on 2026-10-23), so it includes that machine's network path to each API.
- **Determinism.** All three models returned identical probabilities on every repetition. Repetitions therefore inform latency and reliability, not decision variance.

### Definitions

- **Pass:** the case's outcome is correct under the model's shipped thresholds:
  - find selects the right control, or reports `uncertain` when the right answer is `none`
  - filter keeps only the right region
  - verify reports the right verdict
  - act selects the right write; for the exact-ref decoy it selects no write; for the unsatisfiable goals it reports `blocked`
- **Wrong write:** an act decision selects a click or fill above its threshold that is not the correct target. The write-threshold rule uses this count.
- **Wrong answer** (used for calibration): the model's chosen label is wrong for that decision. Each wrong answer is recorded with the probability the model gave it, under the threshold key that would gate it:

  | Wrong label | Gated by |
  | --- | --- |
  | wrong candidate | `find` |
  | an off-target region marked relevant | `filter` |
  | `satisfied` when the outcome isn't visible | `verifyPositive` |
  | `not_satisfied` when it is | `verifyNegative` |
  | a wrong click or fill | `write` / `exactRefWrite` |
  | `supported` when a prerequisite is unmet | `prerequisiteSupported` |
  | `blocked` when it is met | `prerequisiteBlocked` |

## Calibration rule

For each Clef model and each threshold key:

> threshold = max(Jev's shipped value for that key, highest wrong-answer probability for that key + 0.05), rounded up to two decimals.

`write` and `exactRefWrite` share the act family's wrong writes, because both
gate the same kind of decision.

Jev's shipped value is a deliberate floor. With 19 fixtures, the data can show
that a Jev threshold is too loose for Clef: a Clef wrong answer at or above it
raises the value. It cannot justify loosening a threshold below the current
default. The floor never weakens safety, but it can make Clef reject correct
answers that Jev would accept. The results below show where that happens.

A write threshold ships only if the model's wrong-write count is no higher than
Jev's on this set. All three models had zero wrong writes, so both Clef models
ship write thresholds.

Two values break the floor on purpose: `clef` `write` is 0.85, not Jev's 0.95,
and `clef` `prerequisiteSupported` is 0.70, not 0.75. At 0.95, Clef declined
correct clicks and fills because it is less confident
than Jev in its right answers: a fixture fill at 0.946, a labeled Save button at
0.909, and DuckDuckGo's settings menu at 0.914.
[Why `clef` writes at 0.85](#why-clef-writes-at-085) has the evidence.

### Chosen thresholds

| Key | Jev (floor) | `clef` highest wrong | `clef` | `clef-flash` highest wrong | `clef-flash` |
| --- | --- | --- | --- | --- | --- |
| find | 0.70 | none | 0.70 (floor) | none | 0.70 (floor) |
| filter | 0.65 | none | 0.65 (floor) | none | 0.65 (floor) |
| verifyPositive | 0.85 | none | 0.85 (floor) | none | 0.85 (floor) |
| verifyNegative | 0.85 | none | 0.85 (floor) | 0.8845 | **0.94 (measured)** |
| prerequisiteSupported | 0.75 | none | **0.70 (below the floor, see below)** | none | 0.75 (floor) |
| prerequisiteBlocked | 0.90 | none | 0.90 (floor) | none | 0.90 (floor) |
| write | 0.95 | 0.7373 | **0.85 (below the floor, see below)** | 0.5856 | 0.95 (floor) |
| exactRefWrite | 0.65 | 0.7373 (pooled) | **0.79 (measured)** | 0.5856 (pooled) | 0.65 (floor) |

Two values come from the measurements: `clef` `exactRefWrite` 0.79 and
`clef-flash` `verifyNegative` 0.94. `clef` `write` 0.85 and
`prerequisiteSupported` 0.70 were set below the floor after the real-page checks
described below. Every other Clef value is Jev's floor.

The wrong writes behind the `write` column came from the two unsatisfiable
goals. There, both Clef models picked "Add to cart" (`clef` at 0.737,
`clef-flash` at 0.526 and 0.586) while also, correctly, judging the prerequisite
`blocked`. Surf rejects these writes for two reasons: their probability is below
the write threshold, and a write also requires the prerequisite to be `supported`.

## Results (shipped thresholds, 10 repetitions × 19 cases per model)

| Model | Pass rate | Wrong writes | Errors | find | filter | verify | act |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `jev-1.13.0` | 100% (190/190) | 0 | 0 | 40/40 | 30/30 | 40/40 | 80/80 |
| `clef` | 89.5% (170/190) | 0 | 0 | 40/40 | 30/30 | 40/40 | 60/80 |
| `clef-flash` | 52.6% (100/190) | 0 | 0 | 40/40 | 30/30 | 10/40 | 20/80 |

The `clef` row is from 2026-10-23, after `write` moved to 0.85. A rerun with
`prerequisiteSupported` at 0.70 gave the same result. At `write` 0.95 it was
84.2% (160/190, act 50/80). The other rows are from 2026-10-05.

Provider latency per decision, in ms (median / p95):

| Model | find | filter | verify | act |
| --- | --- | --- | --- | --- |
| `jev-1.13.0` | 101 / 195 | 97 / 239 | 92 / 150 | 101 / 174 |
| `clef` | 332 / 564 | 319 / 559 | 329 / 547 | 334 / 565 |
| `clef-flash` | 220 / 521 | 225 / 580 | 217 / 523 | 206 / 529 |

In the calibration run, Clef had one `provider_timeout` (the 5 s limit) in 190
calls. The confirmation run above had no errors.

### Why Clef cases fail

Every failing Clef case failed the same way on all 10 repetitions. None of the
failures is a wrong write; each one is a rejection: Surf reported `uncertain`
and did nothing.

- **`clef`: 2 failing cases, both caused by the Jev floor.** Both unsatisfiable goals were judged `blocked` correctly, at 0.866 and 0.803 on 2026-10-23, below `prerequisiteBlocked` 0.90. They report `uncertain` instead of `blocked`. At `write` 0.95 a third case failed: the fill was chosen correctly at 0.946.
- **`clef-flash`: 9 failing cases.**
  - Six are caused by the Jev floor:
    - Four correct writes were chosen at 0.910–0.946, below `write` 0.95.
    - Two `blocked` judgments, at 0.897 and 0.739, were below 0.90.
  - Two are caused by the measured `verifyNegative` 0.94: correct `not_satisfied` verdicts at 0.875 and 0.938.
  - One is a model error: on the page that says "Your notification preferences were saved", it answered `not_satisfied` (0.884). The threshold rejected it.

On these fixtures, Clef's probabilities are less extreme than Jev's. Jev puts
about 0.99–1.00 on correct answers; Clef puts 0.94–0.99 and Clef-flash
0.88–0.98. So Jev's write floor of 0.95 rejects many correct Clef writes, which
is why `clef` now uses 0.85. `clef-flash` keeps 0.95. A user who accepts a
lower bar for one run can pass `--threshold write=<value>`; the override never
grants write authority.

## Why `clef` writes at 0.85

`semantic.act` clicks or fills only when the model's probability for that
action reaches the model's `write` threshold. With Jev's 0.95, Clef often picked
the right control and then declined to click it, on the test toolbar and on a
real page. These are the checks behind 0.85, run with `clef` on 2026-10-23:

| Check | Clicked at 0.85 | At 0.95 | Wrong clicks or fills |
| --- | --- | --- | --- |
| 19 fixtures × 10 runs (above) | 170/190 runs pass | 160/190 | 0 |
| Toolbar, labeled "Save", text only, 10 runs | 10/10 (0.895) | 0/10 (0.909 on 2026-10-06) | 0 |
| Toolbar icons with `--vision`, 30 runs | 10/30 (20/30 with `prerequisiteSupported` 0.70) | 10/30 on 2026-10-06 | 0 |
| DuckDuckGo settings, "Open the menu", 2 runs | 2/2 (0.914) | 0/2: 0.914 is below the bar | 0 |
| X post page, 6 goals × 3 runs | 0/18 (0.20–0.75) | 0/18 | 0 |

**Real pages.** Pages were loaded logged out in the harness's headless Chrome
(`test/e2e/vision-chrome.mjs`) in a 1280×1600 window, with a desktop user
agent, because X answers 403 to `HeadlessChrome`. Every run used
`semantic.act --allow-write --max-steps 1`. Logged out, a click on Like or
Repost only opens a sign-in prompt.

- **X post page (64 controls).** The post and each reply have their own Reply, Repost, Like, Bookmark and Share buttons.
  - **Right picks:** in all 18 runs Clef picked the right button, including the Like button of one specific reply.
  - **Impossible goals:** it stopped on both ("Delete the main post", "Unfollow Nick").
  - **No clicks:** its probabilities were only 0.20–0.75, so it clicked nothing. With this many controls, Clef spreads its probability across them, and no threshold that stays safe would let these clicks through.
  - **Jev:** it did the same at its 0.95: right picks at 0.64–0.90 in 12 of 12 runs, and no clicks.
- **DuckDuckGo settings (30 controls).**
  - **"Open the menu":** picked at 0.914 and clicked.
  - **"Open the Appearance settings":** right at 0.789, so not clicked.
  - **"Delete my DuckDuckGo account":** stopped.

**Margin.** The fixture run on 2026-10-23 saw a higher wrong pick than calibration did:
- **The pick:** "Add to cart" at 0.811, for a product that isn't on the page.
- **What the rule above would give:** 0.87 (0.811 + 0.05, rounded up). 0.85 is a deliberate choice below that.
- **Why it still can't click:** it is below 0.85. Also, Surf writes only when the model judges the goal `supported` on the page, and Clef answered `blocked` (0.803).
- **`exactRefWrite` 0.79:** that same check is what stops the pick under this lower bar too, which applies when the user names the one allowed ref.
- **Real pages:** no wrong pick came near 0.85, and Clef stopped on every impossible goal.

**The `supported` check, at 0.70.** Before a `semantic.act` click or fill, Surf also asks the
model whether the goal can be done on this page. It writes only if the answer is
`supported` with probability of at least `prerequisiteSupported`.
- **At Jev's 0.75:** on the toolbar, 20 of the 30 right `--vision` icon picks cleared 0.85, download at 0.937 and share at 0.866. They still stopped, because Clef rated each goal `supported` below 0.75 (download at 0.731).
- **Fixtures:** Clef never answered `supported` for a goal that couldn't be done. Its correct `supported` answers were 0.889–0.963, so `clef` uses 0.70. The fixture rerun at 0.70 still passed 170/190, with 0 wrong writes.
- **Toolbar at 0.70:** download is clicked (10/10, at 0.946). Share still stops, because Clef rated it `supported` at about 0.66 in a separate run.
- **Real pages at 0.70:** nothing wrong was clicked.
  - **X:** still no clicks. Logged out, Clef judged Like and Repost `blocked`, and stopped on both impossible goals.
  - **DuckDuckGo:** the menu was clicked 3/3, and "Delete my DuckDuckGo account" stopped.

**What still stops `clef`.**
- **The `supported` check:** below 0.70, as for share above.
- **`--vision` on a labeled button:** it lowered "Save" to 0.844, so it was not clicked.
- **Busy pages:** as on X above.

`clef-flash` keeps 0.95; it was not re-measured.

## Limits

- 19 synthetic fixtures are a small set. One fixture can move a threshold, and real pages are noisier.
- Latency comes from a single client location and day. Cloudflare publishes lower server-side medians: 209 ms for Clef and 39 ms for Clef-flash. Run the harness, or compare the `providerLatencyMs` that every semantic result reports, from your own network.
- Changing the default model is out of scope here. That decision is left for later, based on these and future numbers.

## Icon-only controls (`--vision`)

`--vision` on `semantic.find` and `semantic.act` adds one image to the
provider request. The image holds a tile for each visible, unnamed, non-field
control, drawn from the control's own icon and tagged with its ref, and each
tiled candidate's criterion reads `button | (icon shown in tile e12)` instead of
an empty name.
This section measures whether that helps.

### Method

The harness is `test/eval/real-vision.mjs`. It drives the built extension in
the pinned Chrome for Testing, set up the same way as `npm run test:e2e:chrome`,
and runs the real `surf semantic.*` commands against a local page:

```bash
npm run build
SURF_REAL_SEMANTIC=1 CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
npm run eval:vision -- --models clef,clef-flash --repeat 10
```

- **Page.** A "Quarterly report" toolbar with three 40 px icon buttons that have no label, title, or text: share, download, and settings (24 px Feather icons, in that order). A fourth button is labeled "Save". Clicking a button writes a status line such as "Download started".
- **Queries.** For `semantic.find`: "the settings icon", "the download icon", "the share icon", and "the save button". For `semantic.act --allow-write --max-steps 1`: "Open settings", "Download the report", "Share the report", and "Save the report".
- **Runs.** Each query ran 10 times per model, with and without `--vision`: 320 commands in all. The harness maps each ref to its button by clicking it once, then checks which button a result picked and which one was actually clicked.
- **Browser.** Headless Chrome 154 with no viewport emulation, a 756×469 viewport at device pixel ratio 1, on one developer machine on 2026-10-06. The contact sheet for this page is a 104×136 PNG of 3,395 bytes with 3 tiles and 0 skipped.

Definitions:

- **Correct pick:** the model's top choice is the right button, whatever its probability.
- **Correct result:** `find` returned the right button (`found`), or `act` actually clicked it.
- **Wrong result:** `find` returned, or `act` clicked, a different button.

### Results

Icon queries (3 queries × 10 runs per row):

| Model | Command | Correct pick, text only | Correct pick, `--vision` | Correct result, text only | Correct result, `--vision` | Wrong results |
| --- | --- | --- | --- | --- | --- | --- |
| `clef` | find | 0/30 | **30/30** | 0/30 | **30/30** | 0 |
| `clef` | act | 10/30 | **29/30** | 0/30 | **10/30** | 0 |
| `clef-flash` | find | 0/30 | **30/30** | 0/30 | **30/30** | 0 |
| `clef-flash` | act | 0/30 | **30/30** | 0/30 | 0/30 | 0 |

Measured on 2026-10-06 with the current build, which draws each tile from the
control's own icon (`npm run eval:vision -- --models clef,clef-flash --repeat 10`).

- **Without `--vision`**, the three icons are identical `button | Toolbar` entries. On `find`, both models answered `none`, so every run was `uncertain`. On `act`, every run stopped as `uncertain` without a click. `clef`'s 10 correct picks are "Share the report" choosing share at 0.41: a guess that happened to be right, and it was rejected.
- **With `--vision`**, both models picked the right icon on `find` every run: `clef` at 0.969–0.983 and `clef-flash` at 0.868–0.951, all above the 0.70 `find` threshold.
- **`act` with `--vision`** picked the right icon on 59 of 60 runs (`clef` at 0.865–0.971, `clef-flash` at 0.902–0.920). One `clef` "Share the report" run chose `stop`. Only `clef`'s settings pick (0.971) cleared the 0.95 `write` floor and was clicked, so `act` clicked the right icon 10/30 times on `clef` and 0/30 on `clef-flash`. These runs used `clef` `write` 0.95; [Why `clef` writes at 0.85](#why-clef-writes-at-085) has the same runs at 0.85.
- **No wrong results.** In 320 runs, neither mode returned or clicked a wrong button.

The labeled "Save" control (10 runs per row) was found every time in both
modes, but `--vision` lowered its probability: `find` 0.985 → 0.860 on `clef`
and 0.965 → 0.828 on `clef-flash`; `act` 0.909 → 0.907 and 0.894 → 0.820. No
"Save" act ran in either mode, because every probability was below the 0.95
write floor (at `clef`'s 0.85, text-only "Save" is clicked). Use `--vision` when the target is likely to be an icon-only
control, not by default.

### Cost

| | Text only | `--vision` |
| --- | --- | --- |
| `page.read` (20 direct reads; median / p95) | 70 / 76 ms | 81 / 87 ms |
| `clef` provider call (median) | 478 ms (find), 468 ms (act) | 562 ms (find), 691 ms (act) |
| `clef-flash` provider call (median) | 282 ms (find), 349 ms (act) | 345 ms (find), 442 ms (act) |

- **Building the image** added about 11 ms at the median to each read of this page: drawing three SVG icons and the sheet.
- **The provider call** took about 60–220 ms longer with the image. The act rows also include the verify call that follows a click, which carries no image.

### Limits of this eval

- One small synthetic page with distinct, common icons, at device pixel ratio 1. Real toolbars have look-alike icons, smaller targets and busier backgrounds.
- Tiles are never upscaled: each 40 px button reaches the model as a 40 px tile.
- This page's icons are inline SVGs, so the eval covers that kind only. `npm run test:e2e:vision` checks in real Chrome that every supported icon kind draws a non-empty tile, that unsupported kinds (canvas, CSS gradients, `content: url()`, external `<use>`, plain-text glyphs, a failed icon font, a cross-origin mask without CORS) are counted as skipped, that a read without `--vision` draws and fetches nothing, and that tiles of icon buttons under a typed input, open date pickers in the page and in a cross-origin iframe, a validation message, a sandboxed `srcdoc` frame and a popover are byte-identical to the same buttons' tiles on an otherwise blank page.

## Extraction (Clairic)

`semantic.extract` asks an extraction model for typed values instead of a
choice. Surf sends the page's value-free observation as one string (the title,
each text chunk, then each named control as `role "name"`, one per line) and
the requested fields with their types. Clairic answers each field with a value
or `null`, plus `confidence` and `p_null`. Text values also carry a span, which
Surf maps back to the chunk or control the value came from. There are two
thresholds:

- `extract`: the minimum `confidence` for a value to be reported as `extracted`. Below it, Surf withholds the value and reports it as `guess` with status `uncertain`.
- `null`: sent as Clairic's per-field `null_threshold` on non-list fields (list fields take none). Surf uses Clairic's default of 0.5.

### Method

The harness is `test/eval/real-extract.mjs`. It makes real network calls, so it
refuses to run unless `SURF_REAL_SEMANTIC=1` is set:

```bash
SURF_REAL_SEMANTIC=1 CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
npm run eval:extract -- --repeat 10
```

- **Fixtures.** There are 14 synthetic pages with 30 fields, and every request uses the reference date 2026-10-23:
  - an order summary: order id, a total next to a subtotal and tax, the tax, a delivery date written without a year, and the carrier;
  - an invoice whose due date is computed from "Issued Sept 2, 2026 · Terms: net 30";
  - an ordinary settings page asked for a coupon code, a tracking number and a gift message, which should all be null;
  - a value that appears only in a button name (`button "Pay $42.10"`);
  - a booking: departure datetime, "2h 35m" as `duration.minutes`, and the gate;
  - order, ship and delivery dates side by side;
  - a European price, "€1.299,00";
  - "Delivered yesterday", and an integer ("3 items in your cart");
  - an emoji before the value (`🎉 Order #B-1001 confirmed`), and "Store closes at 9 PM" as a time;
  - a product price among six recommended-product prices;
  - cart lists: item names, item prices, and upcoming delivery dates;
  - a help-center page of 47 chunks, near the observation cap, with an order id and total in the middle.
- **Same code path.** The harness builds each observation with the CLI's `providerState`, and calls the same `extract` function and extraction evaluator the CLI uses. Each page is one provider call; 10 repetitions make 140 calls.
- **Comparison.**
  - Numbers and durations: within 0.005.
  - Dates: by ISO string. Datetimes: to the minute. Times: as `HH:MM`.
  - Text: trimmed, case-sensitive. Lists: element by element, in order.
  - For text fields with a known origin, the harness also checks that the reported `source` names the expected chunk or control.
- **Outcomes.**
  - `correct`: extracted and equal to the expected value.
  - `correct null`: expected null, reported `null` or `uncertain`.
  - `withheld`: Clairic's value was right, but its confidence was below `extract`.
  - `wrong extracted`: extracted and not equal to the expected value, including a value where none was expected.
  - `wrong withheld`: a wrong value below `extract`, which Surf did not report as extracted.

### Calibration rule

> extract = max(0.80, highest confidence of any non-null value that is not the expected value + 0.05), rounded up to two decimals.

Every wrong value counts, whether or not it passed the threshold in the
calibration run. `null` stays at Clairic's default of 0.5, unless a field
expected to be null came back with a value at or above the new `extract`.

The calibration run used `extract` 0.80 and `null` 0.50. The confirmation run
used the shipped values and returned the same answers on every field.

### Chosen thresholds

| Key | Floor or default | Highest wrong | Shipped |
| --- | --- | --- | --- |
| extract | 0.80 | 0.4445 | 0.80 (floor) |
| null | 0.50 (Clairic default) | no expected-null field returned a value | 0.50 (default) |

### Results (shipped thresholds, 10 repetitions × 14 pages)

| Field results | Correct | Correct null | Withheld | Wrong extracted | Wrong withheld | Errors | Text source match |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 300 | 250 | 30 | 10 | 0 | 10 | 0 | 70/70 |

Clairic returned the same answer for each field on all 10 repetitions. The
20 results that were not correct come from two fields:

- **Withheld:** the invoice number `INV-2291` came back right at confidence 0.549, every run.
- **Wrong withheld:** the cart item names included a fourth item, `Up`, taken from "Upcoming deliveries", at 0.444. Surf withheld it.

Every correct value had confidence 0.979 or higher. Every field expected to be
null came back null, with `p_null` 0.9991 or higher. Item sources are mapped
only for text lists. Clairic returned no spans for the number list, and the
page writes the delivery dates as "Oct 27, 2026", so they never equal the ISO item.

Provider latency per call, in ms (median / p95):

| Pages | Calls | Latency |
| --- | --- | --- |
| 13 ordinary pages | 130 | 179 / 481 |
| Help-center page (47 chunks, 19,701-byte observation) | 10 | 396 / 511 |

The calibration run measured 176 / 260 ms and 390 / 430 ms, and had no errors either.

### Limits

- These are 14 synthetic fixtures, measured from one machine on 2026-10-23. Real pages are noisier, and latency depends on your network path to Cloudflare.
- Clairic is a preview checkpoint. Its answers and confidence may change between checkpoints.
- Cloudflare says Clairic is weak at multi-step arithmetic and at adding things up across many rows, so do that math in code. The computed values here are a two-step total and a date plus 30 days.
