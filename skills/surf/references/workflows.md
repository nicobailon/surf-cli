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

A draft that clicked or typed is a write, as is one whose recorded requests include one other than GET, HEAD or OPTIONS (beacons, analytics, and the PerimeterX, DataDome and Qualtrics-intercept sensors aside). When the flow only read data, stop with `--draft --read`; it needs `--network`, and Surf refuses it if a captured request can change data or a step acts beyond the page (cookies, tabs, windows, emulation, AI providers).

The draft replays the top-ranked request (never telemetry, page assets or preflights; never a write on a read draft, nor a read on a draft made a write by a captured request); a weak top score, one within 3 points of the next, or a pick that may have passed over the page's data (a JSON with records demoted for a banner-like path, or one next to a document too large to compare) adds a warning. `record candidates` ranks your active record live, else your latest one, or a record id you pass; choose with `--request-id` on `record stop --draft` or `save --from-record`.

`save --from-record` lets the playbook send to the page the record ran on and to the request its draft replays (`api.resy.com` for a search on `resy.com`), no other captured origin. A write op's browser fallback must be one page-write step; a write draft whose workflow isn't (a `navigate` first, or a `type` and a `click`) is saved with its network strategy alone, with a note, when that replays a write the record captured on the page's own origin, and refused otherwise; a write on another origin (an `api.` host) or one of several captured writes needs `--request-id`. The record decides what the op sends and whether it needs `--write`; `draft/op.json` only names and describes it. Its effect is the builder's (a read only after `record stop --draft --read`), its `safety` is as drafted, and every network strategy, reads included, is rebuilt from the request the record drafts: edits to its method, URL, query, headers or body are dropped, and a draft that changes the effect, safety or origins, drops the network strategy, leaves out a method, or points at another request is refused. A write saves only when the record captured it, and a `{{…}}` in one is refused, so make inputs with `pb param` after `save`. An op saved from a record holds only network and workflow strategies, and its workflow is the record's steps: a step the record didn't run (`javascript_tool`, `js`, `frame.js`, a loop) is refused. Only `--request-id` on `record stop --draft` or `save` names the request, never the draft's `provenance`. Captured text and recorded step arguments that read like an input (`{{action}}`, `%{review_key}`) are saved as `{{!}}action}}` and `%{!}review_key}` and sent as recorded (so is `pb client derive`'s endpoint, and an op saved from recent activity); `save` marks such an op `provenance.escaped: true`, and only a marked op reads `{{!}}` and `%{!}` that way, so a hand-written op and `surf do` send them as written. An input's value is never read that way: `--text '%{!}'` types `%{!}`. The inputs a write saved network-only keeps, and its safety key, are the ones its request uses, never ones its checks name, and a draft may describe its inputs but not add or change them. A draft keeps the record's strategies in the record's order and number; its `extract`, `verify` and `expect` may make the op fail, and such a failure is final, so the op doesn't go on to its recorded steps. A read still goes on to them when its request fails as Surf sees it (never answered, or a status such as 401 or 500 that isn't in `acceptStatus`); a write never does once it has sent. `save` prints the origins it allows and warns when the replayed request's origin isn't the page's. A write refused before it sends (a missing `--env` variable, a disallowed origin, a missing input) leaves no receipt, so the same `--review_key` works on the next try.

Name a recorded op's inputs with `pb param`. A field is `query.<param>` (plus `.<json.path>` inside a JSON-valued param), `path.<n>` (`path.1` is the first segment), `body.<path>` (JSON, urlencoded or multipart) or `headers.<name>`. The input defaults to the recorded value unless you pass `--required` or `--default`. Surf prints a diff, saves the op where it is, and also templates a workflow step that carries the same value:

```bash
surf playbook param books get_books path.2 --value 2 --as page   # page-2.html → page-{{page}}.html
surf playbook param shop search query.q body.query --as q --required  # one input, several fields
surf playbook param resy search headers.authorization --env RESY_API_KEY
surf playbook param hr search query.nameOrId --as name --required --link text   # the typed step takes --name too; --text goes
surf use books get_books --page 3
```

A draft never stores a typed value, so its workflow types `{{text}}`, an input of its own; `--link text` gives those steps the new input and drops `text` (a write's safety key follows). `pb param` names such inputs in its note.

`--env` headers are read from the shell that runs `surf use` (or a generated client) and are never stored; secret headers take only `--env`.

Make an op return records instead of the raw page or JSON (saved in the op, with a diff):

```bash
surf playbook extract books get_books --item article.product_pod --field 'title=h3 a@title' --field 'url=h3 a@href'   # HTML, collect's field specs
surf playbook extract blast submit --value 'input[name=RID]@value'                                                     # one HTML value
surf playbook extract resy search --records '$.search.hits' --field name=name --field id=id.resy --filter type=venue    # JSON records, renamed
```

Check an op (exit 1 on failure); `--save` keeps the assertions in the op, and `surf use` then checks them too:

```bash
surf playbook test books get_books --page 2 --assert '$' array_min_len 1 --assert '$[0].title' not_null --strategy network --save
surf playbook test books get_books --json   # rerun the saved assertions
```

A record belongs to the session that started it (or its tab, without a session): only that session's commands go into it, only that session can mark, stop or discard it, and other sessions can record at the same time.

Records, traces and the activity journal are private. Auth headers are always dropped. Typed inputs and request bodies are redacted unless you pass `--include-input-values`. Traces keep no response bodies or values, only each response's kind, size, record count, field count per type, and page-text overlap (no field names); `record candidates` prints a short sample only for an active record, from memory.

A generated client replays a read endpoint without the browser and never contains browser credentials. Without `--request-id`, `client derive` takes the top-ranked request only when it clearly leads. `client export` of an op with inputs gives a client that takes the same `--<name>` options. For now it refuses any request other than GET, HEAD or OPTIONS, POST reads included:

```bash
surf playbook client derive example --op read --from-record <record-id> --request-id <request-id> --out ./client
surf playbook client verify ./client
```
