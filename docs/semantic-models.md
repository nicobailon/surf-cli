# Semantic model evaluation

Surf's semantic commands (`semantic.find`, `semantic.filter`, `semantic.verify`,
`semantic.act`, and semantic `surf do` steps) can run on three decision models:

| Model | Provider | Endpoint |
| --- | --- | --- |
| `jev-1.13.0` (default) | TypeSafe | `https://api.typesafe.ai` |
| `clef` | Cloudflare Workers AI | `https://api.cloudflare.com/client/v4/accounts/{id}/ai/run/@cf/cloudflare/clef` |
| `clef-flash` | Cloudflare Workers AI | `https://api.cloudflare.com/client/v4/accounts/{id}/ai/run/@cf/cloudflare/clef-flash` |

Each model has its own set of eight confidence thresholds. Surf accepts only
models in its registry, and a model enters the registry only with all eight
thresholds measured, so no model runs with partial or borrowed thresholds.

This page explains how the Clef thresholds were chosen and how the three models
compared on the same fixtures.

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
- **Latency.** Provider latency is the round trip of each provider call, measured by the shared evaluator that every semantic command uses. It was measured from one developer machine on 2026-10-05, so it includes that machine's network path to each API.
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

### Chosen thresholds

| Key | Jev (floor) | `clef` highest wrong | `clef` | `clef-flash` highest wrong | `clef-flash` |
| --- | --- | --- | --- | --- | --- |
| find | 0.70 | none | 0.70 (floor) | none | 0.70 (floor) |
| filter | 0.65 | none | 0.65 (floor) | none | 0.65 (floor) |
| verifyPositive | 0.85 | none | 0.85 (floor) | none | 0.85 (floor) |
| verifyNegative | 0.85 | none | 0.85 (floor) | 0.8845 | **0.94 (measured)** |
| prerequisiteSupported | 0.75 | none | 0.75 (floor) | none | 0.75 (floor) |
| prerequisiteBlocked | 0.90 | none | 0.90 (floor) | none | 0.90 (floor) |
| write | 0.95 | 0.7373 | 0.95 (floor) | 0.5856 | 0.95 (floor) |
| exactRefWrite | 0.65 | 0.7373 (pooled) | **0.79 (measured)** | 0.5856 (pooled) | 0.65 (floor) |

Two values come from the measurements: `clef` `exactRefWrite` 0.79 and
`clef-flash` `verifyNegative` 0.94. Every other Clef value is Jev's floor.

The wrong writes behind the `write` column came from the two unsatisfiable
goals. There, both Clef models picked "Add to cart" (`clef` at 0.737,
`clef-flash` at 0.526 and 0.586) while also, correctly, judging the prerequisite
`blocked`. Surf rejects these writes for two reasons: their probability is below
the write threshold, and a write also requires the prerequisite to be `supported`.

## Results (shipped thresholds, 10 repetitions × 19 cases per model)

| Model | Pass rate | Wrong writes | Errors | find | filter | verify | act |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `jev-1.13.0` | 100% (190/190) | 0 | 0 | 40/40 | 30/30 | 40/40 | 80/80 |
| `clef` | 84.2% (160/190) | 0 | 0 | 40/40 | 30/30 | 40/40 | 50/80 |
| `clef-flash` | 52.6% (100/190) | 0 | 0 | 40/40 | 30/30 | 10/40 | 20/80 |

Provider latency per decision, in ms (median / p95):

| Model | find | filter | verify | act |
| --- | --- | --- | --- | --- |
| `jev-1.13.0` | 101 / 195 | 97 / 239 | 92 / 150 | 101 / 174 |
| `clef` | 407 / 697 | 481 / 911 | 379 / 708 | 459 / 766 |
| `clef-flash` | 220 / 521 | 225 / 580 | 217 / 523 | 206 / 529 |

In the calibration run, Clef had one `provider_timeout` (the 5 s limit) in 190
calls. The confirmation run above had no errors.

### Why Clef cases fail

Every failing Clef case failed the same way on all 10 repetitions. None of the
failures is a wrong write; each one is a rejection: Surf reported `uncertain`
and did nothing.

- **`clef`: 3 failing cases, all caused by the Jev floor.**
  - The fill was chosen correctly at 0.946, below `write` 0.95.
  - Both unsatisfiable goals were judged `blocked` correctly, at 0.805 and 0.825, below `prerequisiteBlocked` 0.90. They report `uncertain` instead of `blocked`.
- **`clef-flash`: 9 failing cases.**
  - Six are caused by the Jev floor:
    - Four correct writes were chosen at 0.910–0.946, below `write` 0.95.
    - Two `blocked` judgments, at 0.897 and 0.739, were below 0.90.
  - Two are caused by the measured `verifyNegative` 0.94: correct `not_satisfied` verdicts at 0.875 and 0.938.
  - One is a model error: on the page that says "Your notification preferences were saved", it answered `not_satisfied` (0.884). The threshold rejected it.

On these fixtures, Clef's probabilities are less extreme than Jev's. Jev puts
about 0.99–1.00 on correct answers; Clef puts 0.94–0.99 and Clef-flash
0.88–0.98. So Jev's write floor of 0.95 rejects many correct Clef writes. A
user who accepts that trade-off for a run can pass `--threshold write=<value>`;
the override never grants write authority.

## Limits

- 19 synthetic fixtures are a small set. One fixture can move a threshold, and real pages are noisier.
- Latency comes from a single client location and day. Cloudflare publishes lower server-side medians: 209 ms for Clef and 39 ms for Clef-flash. Run the harness, or compare the `providerLatencyMs` that every semantic result reports, from your own network.
- Changing the default model is out of scope here. That decision is left for later, based on these and future numbers.
