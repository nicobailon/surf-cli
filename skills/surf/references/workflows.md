# Workflows and playbooks

Use `surf do` for a one-off sequence of commands. Use a playbook for a site operation you will run again, such as reading a feed, with recorded provenance and protection against double writes.

## surf do

```bash
surf do 'go "https://example.com/login" | type "me@example.com" --into "#email" | click --selector "button[type=submit]"' --dry-run
surf do --file login.json --email me@example.com      # or a saved name: surf do login --email …
surf batch --actions '[{"type":"frame.switch","index":0},{"type":"click","selector":"#pay"}]'
```

Steps wait on their own: for the page to load after `go`, `back` and `forward`; for the DOM to settle after clicks, keys and fills; for the tab after a switch. `--on-error continue` keeps going after a failed step, `--step-delay <ms>` (default 100) spaces steps, `--no-auto-wait` turns the waits off. Saved workflows live in `./.surf/workflows/` and `~/.surf/workflows/` (`surf workflow.list`, `surf workflow.info <name>`, `surf workflow.validate <file>`).

Workflow file:

```json
{"name":"Login","args":{"email":{"required":true},"url":{"default":"https://example.com/login"}},
 "steps":[{"tool":"navigate","args":{"url":"%{url}"}},
  {"tool":"type","args":{"text":"%{email}","selector":"input[name=email]"}},
  {"tool":"js","args":{"code":"return [1,2,3]"},"as":"items"},
  {"repeat":5,"steps":[{"tool":"click","args":{"ref":"e5"}}]},
  {"each":"%{items}","as":"item","steps":[{"tool":"js","args":{"code":"console.log('%{item}')"}}]},
  {"repeat":20,"until":{"tool":"js","args":{"code":"return done"}},"steps":[]}]}
```

Semantic steps (`semantic.step`) are in [semantic.md](semantic.md).

## Playbooks

```bash
surf playbook list                       # project ./.surf/playbooks/, then ~/.surf/playbooks/, then built-in
surf playbook ops x                      # an op's inputs
surf use x thread --url https://x.com/<user>/status/<id> --format md
surf use <playbook> <op> --format jsonl  # one record per line
surf use books list_books --pages 3      # follow the op's page rule
surf use books list_books --dry-run      # print the request; send nothing
surf playbook test books                 # each read op with its examples; exit 1 when expect fails
```

- An op file with `request` (or `open` + `steps`), `extract` and `expect` is in the README's "Ops" section. The body is read in Node: JSON by path, HTML by selector, embedded page data with `extract.in`.

- Write ops need `--write`. Surf records the intent before sending, so a retry can't submit twice.
- Script strategies need `--allow-script`.
- To write a recipe for a new site's feed API (the `api` and `collect` strategies), follow `docs/threads-and-feeds.md` in the Surf repository.

Make an op with `surf hook` first. It opens the page, runs `--do` steps, picks the request that carries the data, names its inputs, infers the extract, tests the op and saves it to `~/.surf/playbooks/<site>/ops/<op>.json`:

```bash
surf hook 'https://books.toscrape.com/catalogue/page-{{page}}.html' --page 2 --goal "books with prices" --as books/list_books
surf hook https://quotes.toscrape.com/scroll --goal quotes --do 'scroll.bottom'   # picks the JSON the scroll loads
```

- `{{name}}` in the URL or a `--do` step, with `--name <sample>`, becomes the op's input; a search key, a page number and an id in the path become inputs on their own.
- Exit 2: no request clearly leads. Rerun the printed line, with `--match` a part of the right request's URL.
- Exit 1: an error, or the request is a write (it saves reads only). It prints the draft op: fix it, save it as the op file, run `surf playbook test <site>`.
- When hook can't get there (a login, steps it can't express), record by hand: `pb record start`, do the steps, `pb record stop`. Stop picks, tests and saves the same way (`--match` too; `--draft` only drafts).

```bash
surf playbook suggest --since 1h
surf playbook save example --op read --from-recent 1h
surf playbook record start example --op read --watch
surf playbook record mark "loaded results"
surf playbook record stop
surf playbook trace export --from-record <record-id> --har ./trace.har
surf playbook export example --out ./example-playbook
surf playbook import ./example-playbook
```

Records, traces and the activity journal are private. Auth headers are always dropped. Typed inputs and request bodies are redacted unless you pass `--include-input-values`.

A generated client replays a read endpoint without the browser and never contains browser credentials:

```bash
surf playbook client derive example --op read --from-record <record-id> --request-id <request-id> --out ./client
surf playbook client verify ./client
```
