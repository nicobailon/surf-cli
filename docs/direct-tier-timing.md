# Timing `surf use`: direct tier vs in-tab

How to measure a network op sent from the host (`tier: direct`) against the same op sent from the
tab (`--no-direct`, `tier: tab`), cold (the op's first run) and warm (its third). Run it against an
isolated Chrome for Testing with its own Surf extension, host socket and state directory, never
your everyday browser.

## Ops

An HTML extract runs in the tab, so the timed ops return the raw response. Put these in a scratch
project's `.surf/playbooks/`:

`books/playbook.json`: `{ "id": "books", "version": "1.0.0", "origins": ["https://books.toscrape.com"] }`

`books/ops/page.json`:

```json
{
  "id": "page",
  "effect": "read",
  "args": { "page": { "type": "string", "default": "2" } },
  "run": [
    { "using": "network", "request": { "method": "GET", "url": "https://books.toscrape.com/catalogue/page-{{page}}.html" }, "expect": { "truthy": true } }
  ]
}
```

`httpbin/playbook.json`: `{ "id": "httpbin", "version": "1.0.0", "origins": ["https://httpbin.org"] }`

`httpbin/ops/cookies.json`:

```json
{
  "id": "cookies",
  "effect": "read",
  "run": [
    { "using": "network", "request": { "method": "GET", "url": "https://httpbin.org/cookies" }, "extract": { "jsonPath": "$.cookies" } }
  ]
}
```

To see live cookies reach the direct tier, open `https://httpbin.org/cookies/set?surfproof=live1`
in the isolated browser first; `surf use httpbin cookies --json` then answers
`{ "surfproof": "live1" }` with `tier: "direct"`.

## Harness

Run from the scratch project, with `SURF_SOCKET` and `SURF_STATE_DIR` pointing at the isolated
host. Each mode starts from a cleared tier memory, so run 1 is cold and run 3 warm.

```bash
#!/usr/bin/env bash
# time-tiers.sh <playbook> <op> [inputs...]
set -euo pipefail
now() { node -e 'console.log(Date.now())'; }
for mode in direct tab; do
  flag=()
  [ "$mode" = tab ] && flag=(--no-direct)
  rm -f "$SURF_STATE_DIR/playbook-tiers.json"
  for run in 1 2 3; do
    start=$(now)
    out=$(surf use "$@" "${flag[@]}" --json)
    end=$(now)
    tier=$(printf '%s' "$out" | node -e 'let s="";process.stdin.on("data",(c)=>(s+=c)).on("end",()=>console.log(JSON.parse(s).tier))')
    echo "$1 $2 $mode run $run: $((end - start)) ms (tier $tier)"
  done
done
```

```bash
./time-tiers.sh books page --page 2
./time-tiers.sh httpbin cookies
```
