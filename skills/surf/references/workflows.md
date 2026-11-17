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
- Write ops need `--write`. Surf records the intent before sending, so a retry can't submit twice: a write recorded with `pb record` blocks the same inputs for 5 minutes once it succeeded, and for good while its result is unknown; `--repeat` sends it again.
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

A draft that clicked or typed is a write, as is one whose recorded requests include one other than GET, HEAD or OPTIONS (beacons, analytics, and the PerimeterX, DataDome and Qualtrics-intercept sensors aside). Scrolling and zoom don't make a draft a write. When the flow only read data, stop with `--draft --read`: Surf drafts a read, and first names each captured request that can change data and each step that acts beyond the page (cookies, tabs, windows, emulation, AI providers). A record without `--network` has no requests to check, and Surf says so. A read op still can't replay PUT, PATCH or DELETE.

The draft replays the top-ranked request (never telemetry, page assets or preflights; never a write on a read draft, nor a read on a draft made a write by a captured request); a weak top score, one within 3 points of the next, or a pick that may have passed over the page's data (a JSON with records demoted for a banner-like path, or one next to a document too large to compare) adds a warning. `record candidates` ranks your active record live, else your latest one, or a record id you pass; choose with `--request-id` on `record stop --draft` or `save --from-record`.

`save --from-record` saves `draft/op.json` as you edited it, checked like any op file, and lists each way it differs from what the record drafts (`differs`: effect, safety, strategies, request, steps, origins, inputs), such as `effect: read (the record drafts write: it captured POST …)`. It lets the playbook send to the page the record ran on and to the request the op replays (`api.resy.com` for a search on `resy.com`), no other captured origin, unless the draft lists more. A write op's workflow may have several steps (`type`, then `click`); its receipt starts at the first step that can commit (any page write but a fill: `click`, `submit`, `key`, `check`, a `type` with `--submit` or a line break), so a fill, navigation or read that fails before it leaves none, and a failure at or after it needs `--repeat`. A write runs only its first strategy: a draft whose network strategy replays a write and whose workflow is more than one page-write step is saved with the request alone (`saved network-only: …`), keeping only the inputs the request sends, and one whose request is a read warns that its workflow never runs. When the record captured several writes, or its one write is on another origin than the page (an `api.` host), `record stop --draft` and `save` refuse until `--request-id` names the write; the error lists the ids. Only `--request-id` on `record stop --draft` or `save` names the request, never the draft's `provenance`. Captured text and recorded step arguments that read like an input (`{{action}}`, `%{review_key}`) are saved as `{{!}}action}}` and `%{!}review_key}` and sent as recorded (so is `pb client derive`'s endpoint, and an op saved from recent activity); `save` marks such an op `provenance.escaped: true`, and only a marked op reads `{{!}}` and `%{!}` that way, so a hand-written op and `surf do` send them as written. An input's value is never read that way: `--text '%{!}'` types `%{!}`. A read goes on to its next strategy (the recorded steps) when its request or a check (`extract`, `verify`, `expect`) fails; a write never does once it has sent. `save` prints the origins it allows and warns when the replayed request's origin isn't the page's. A write refused before it sends (a missing `--env` variable, a disallowed origin, a missing input) leaves no receipt, so the same inputs work on the next try.

Name a recorded op's inputs with `pb param`. A field is `query.<param>` (plus `.<json.path>` inside a JSON-valued param), `path.<n>` (`path.1` is the first segment), `body.<path>` (JSON, urlencoded or multipart) or `headers.<name>`. The input defaults to the recorded value unless you pass `--required` or `--default`. Surf prints a diff, saves the op where it is, and also templates a workflow step that carries the same value:

```bash
surf playbook param books get_books path.2 --value 2 --as page   # page-2.html → page-{{page}}.html
surf playbook param shop search query.q body.query --as q --required  # one input, several fields
surf playbook param resy search headers.authorization --env RESY_API_KEY
surf playbook param hr search query.nameOrId --as name --required --link text   # the typed step takes --name too; --text goes
surf use books get_books --page 3
```

A draft never stores a typed value, so its workflow types `{{text}}`, an input of its own; `--link text` gives those steps the new input and drops `text` (a safety key the op declares follows). `pb param` names such inputs in its note.

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

Records, traces and the activity journal are private. Auth headers are always dropped. Typed inputs, request bodies and the values the record's steps typed into captured URLs (`?q=<text>`, `/<value>`, one placeholder per typing step: `<text>`, `<text-2>`) are redacted unless you pass `--include-input-values` to `record start` or `record stop` (or set `"includeInputValues": true` in `~/surf.json`). A network strategy holding a placeholder is never sent; `pb param <playbook> <op> query.q --as q` names it as a required input and takes over the step that typed it. `surf use` returns a workflow op's step captures (`as`) under `vars`, never its inputs. `network.export` redacts secret-named body fields unless `--raw-bodies`. Traces keep no response bodies or values, only each response's kind, size, record count, field count per type, and page-text overlap (no field names); `record candidates` prints a short sample only for an active record, from memory.

A generated client replays an endpoint without the browser and never contains cookies or secret headers. Without `--request-id`, `client derive` takes the top-ranked request only when it clearly leads. `client export` of an op with inputs gives a client that takes the same `--<name>` options. A client of a write needs `--write`: `derive` of a captured write (POST, PUT, PATCH or DELETE; POST reads included) or `export` of a write op. It sends with no receipt, and its body is as captured, so a record that kept input values puts them, passwords included, in `surf-client.json` (`noEmbeddedSecrets: false`); make a body field an input with `pb param` first to leave it out. `client verify --live` of a write client needs `--write` too:

```bash
surf playbook client derive example --op read --from-record <record-id> --request-id <request-id> --out ./client
surf playbook client verify ./client
```
