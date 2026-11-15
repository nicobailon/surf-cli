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
```

- An input the op doesn't define (`--lmit`) fails before anything runs and lists the op's inputs. Surf's global flags and `--timeout` aren't inputs unless the op declares them.
- Write ops need `--write`. Surf records the intent before sending, so a retry can't submit twice.
- Script strategies need `--allow-script`.
- To write a recipe for a new site's feed API (the `api` and `collect` strategies), follow `docs/threads-and-feeds.md` in the Surf repository.

Author from what you just did, or from a recording:

```bash
surf playbook suggest --since 1h
surf playbook save example --op read --from-recent 1h
surf playbook record start example --op read --network --watch
surf playbook record mark "loaded results"
surf playbook record candidates               # rank the requests: r_… id, score, reasons, sample
surf playbook record stop --draft --request-id <r_…>
surf playbook trace export --from-record <record-id> --har ./trace.har
surf playbook export example --out ./example-playbook
surf playbook import ./example-playbook
```

A draft that clicked or typed is a write, as is one whose recorded requests include one other than GET, HEAD or OPTIONS (beacons and analytics aside). When the flow only read data, stop with `--draft --read`; it needs `--network`, and Surf refuses it if a captured request can change data or a step acts beyond the page (cookies, tabs, windows, emulation, AI providers).

The draft replays the top-ranked request (never telemetry, page assets or preflights; never a write on a read draft, nor a read on a draft made a write by a captured request); a weak top score adds a warning. `record candidates` ranks your active record live, else your latest one, or a record id you pass; choose with `--request-id` on `record stop --draft` or `save --from-record`.

Name a recorded op's inputs with `pb param`. A field is `query.<param>` (plus `.<json.path>` inside a JSON-valued param), `path.<n>` (`path.1` is the first segment), `body.<path>` (JSON, urlencoded or multipart) or `headers.<name>`. The input defaults to the recorded value unless you pass `--required` or `--default`. Surf prints a diff, saves the op where it is, and also templates a workflow step that carries the same value:

```bash
surf playbook param books get_books path.2 --value 2 --as page   # page-2.html → page-{{page}}.html
surf playbook param shop search query.q body.query --as q --required  # one input, several fields
surf playbook param resy search headers.authorization --env RESY_API_KEY
surf use books get_books --page 3
```

`--env` headers are read from the shell that runs `surf use` (or a generated client) and are never stored; secret headers take only `--env`.

A record belongs to the session that started it (or its tab, without a session): only that session's commands go into it, only that session can mark, stop or discard it, and other sessions can record at the same time.

Records, traces and the activity journal are private. Auth headers are always dropped. Typed inputs and request bodies are redacted unless you pass `--include-input-values`. Traces keep no response bodies or values, only each response's kind, size, record count, field count per type, and page-text overlap (no field names); `record candidates` prints a short sample only for an active record, from memory.

A generated client replays a read endpoint without the browser and never contains browser credentials. Without `--request-id`, `client derive` takes the top-ranked request only when it clearly leads. `client export` of an op with inputs gives a client that takes the same `--<name>` options. For now it refuses any request other than GET, HEAD or OPTIONS, POST reads included:

```bash
surf playbook client derive example --op read --from-record <record-id> --request-id <request-id> --out ./client
surf playbook client verify ./client
```
