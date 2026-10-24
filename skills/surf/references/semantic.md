# Semantic commands

Use them on unfamiliar pages; once the path is known, switch to plain commands (`click e5`), which are faster and cost nothing.

## Models and what leaves the machine

- `semantic.find`, `semantic.filter`, `semantic.verify`, `semantic.act`: `--model jev-1.13.0` (default, TypeSafe `api.typesafe.ai`) or `clef` / `clef-flash` (Cloudflare Workers AI). `SURF_SEMANTIC_MODEL` sets the default; it is the only way to choose the model for `surf do` workflows.
- `semantic.extract` always uses `clairic` on Cloudflare.
- The provider gets a bounded page observation without field values. Every result reports `provider`, `model`, `providerCalls` and `providerLatencyMs`.
- `--vision` (find and act, `clef` models only) also sends one image of the controls that have no name, drawn from their own icons, never a screenshot of the page. Results carry `vision: {tiles, skipped}` and `"tile": true` on a tiled answer; take a screenshot before trusting a tiled write target.

## Credentials

- TypeSafe: `TYPESAFE_API_KEY` (wins; use it in CI), or the shared file `${XDG_CONFIG_HOME:-~/.config}/typesafe/credentials.json` (Windows `%APPDATA%\TypeSafe\credentials.json`), which other TypeSafe clients also read, so clearing it signs them all out.
- Cloudflare: `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (both or neither), or the private file `${XDG_CONFIG_HOME:-~/.config}/surf/cloudflare-credentials.json` (Windows `%APPDATA%\surf\cloudflare-credentials.json`).
- Save from stdin, never as an argument:

```bash
printf '%s\n' "$KEY" | surf semantic auth set
printf '%s\n%s\n' "$ACCOUNT_ID" "$TOKEN" | surf semantic auth set --provider cloudflare
surf semantic auth status          # source and fingerprint only
```

## Thresholds

An answer below its threshold comes back uncertain and nothing is clicked. `--threshold name=v` overrides one for a single run and never grants write permission.

| name | jev-1.13.0 | clef | clef-flash |
| --- | --- | --- | --- |
| write (broad `--allow-write`) | 0.95 | 0.85 | 0.95 |
| exact-ref-write (one `--allow-ref`, one write) | 0.65 | 0.79 | 0.65 |
| prerequisite-supported (goal looks doable) | 0.75 | 0.70 | 0.75 |
| verify-negative | 0.85 | 0.85 | 0.94 |

Others for all three: find 0.70, filter 0.65, verify-positive 0.85, prerequisite-blocked 0.90. `semantic.extract`: extract 0.80.

## semantic.act

It loops observe → choose → act → verify until the goal is done, it is unsure, or `--max-steps` (1–8) runs out. It allows only same-origin navigation, scrolls, waits, and, with `--allow-write`, clicks and fills. `--allow-write` covers submit, purchase, delete, send and publish buttons too, so pass `--allow-ref` for each element it may touch. An unknown write outcome stops the run without retrying; a new run can repeat an external effect.

## semantic.extract

Each field comes back `extracted` with a value, `null` (not on the page), or `uncertain` with a `guess`. When a page shows several similar values, describe the field fully ("Total charged for the order, including shipping and tax"). Types: `text number integer date time datetime duration duration.<unit> list list.number list.date`. `--fields-json` adds units, decimals and per-field null thresholds; `--reference-date` anchors dates written without a year.

## Workflow steps

A workflow JSON with `"semantic": {"version": 1}` uses linear `"tool": "semantic.step"` steps. The README's "Bounded semantic workflow steps" section has a complete file to start from.

```text
find           target [+ search], usually "as"
open           target (same-origin)
ensureChecked  target + checked
fill           target + input
click          target + expect
assert         mode semantic + claim | predicate (checked locally) | mode value + binding + field + (equals | input | min/max)
extract        fields (the --fields-json object) + "as"
```

```bash
surf workflow.validate ./product.json
printf '%s' '{"quantity":"2"}' | surf do --file product.json --inputs-stdin --allow-semantic --allow-write --json
```

Inputs never reach the provider, variables, events or checkpoints. Extracted values appear only in `do --json` under `vars.<as>`. A value `assert` fails on `null` or `uncertain`, never compares a `guess`, and reports only a reason code.
