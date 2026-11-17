# Parse a site into a reusable op

Run `surf parse <url> --goal "<what you want>"` first: it does these steps itself, from robots.txt to a saved shape test, and prints the `pb param` and `pb extract` lines it ran, so you can rename an input or field and run one again. Use this recipe when parse exits 1 (an error, a disallowed path, a goal that needs a click, scroll or write, or a test that failed) or 2 (a weak or tied pick: it prints the top 3 candidates and a rerun line with `--request-id`), when the data shows only after a click, search or scroll, and for writes and chains.

The recipe goes from a URL and a goal ("all books with price and rating") to a saved, tested op that `surf use` answers from the site's own request. Each step's flags and edge cases are in [workflows.md](workflows.md#playbooks). `<pb>` is the playbook (a short site name) and `<op>` a verb phrase (`list_books`, `get_book`).

## 0. Before you start

- Read the site's `robots.txt`. Skip disallowed paths (arXiv disallows `/search`, so use `/list/<cat>/recent` instead) and keep to its `Crawl-delay`. Leave at least 3 s between requests anyway. Every `pb test` and `surf use` sends one.
- Open the session (SKILL.md, "Own a session"). Leave the tab on `about:blank` or on the site. If the tab is on another site, the record adds that site's origin, and network runs fail with CORS.
- Stop on `page_challenge`, a CAPTCHA, a 403 block page or a 429. Report it and don't work around it.

## 1. Record the request that carries the data

```bash
surf playbook record start <pb> --op <op> --network     # add --include-input-values for a write's body (Writes, below)
surf navigate '<url>' && surf wait.ready           # or the click, search or scroll that loads the data
surf playbook record candidates --limit 5                # while recording: r_… ids, score, reasons, a sample
surf playbook record stop --draft --read                 # --read only when the flow changed nothing
surf playbook save --from-record <rec-id>                # add --request-id r_… when the draft picked the wrong one
```

- **Load by URL when you have one.** A recorded `navigate` becomes the browser fallback, and `pb param` templates it along with the request. Recorded clicks keep their refs (`e154`), which are stale in any later session, so record a click as `locate.role <role> --name <text> --action click`, which finds the element again.
- **Pick the request.** The top candidate is right when it is the page's Document (HTML) or a JSON response with records whose sample matches what the goal asks for. A banner or manifest JSON can sit just below it. Documents over the sample cap show `(no sample: per-body-cap)` and score lower (Lever: 4 to 6), but they are still picked when nothing else carries data. When a JSON response has the records the page shows, take it over the Document: pass its id with `--request-id`.
- `save` prints the origins it allows. Check that they are the site's.

## 2. Turn values into inputs

```bash
surf playbook param <pb> <op> query.q --as query --required             # what the user will vary
surf playbook param <pb> <op> path.2 --as book --required --desc "…"    # path segment n (path.1 is first)
surf playbook param <pb> <op> path.2 --value 2 --as page                # only the 2 in page-2.html
surf playbook param <pb> <op> query.skip --as skip                      # paging: keeps the recorded default
```

- Make an input of each value the goal varies (a search term, an id, a category, a company) and of each paging slot (`page`, `skip`, `offset`, `start`, `page-N.html`). Leave the rest as recorded.
- Name an input after what it means, not its wire name: `terms-0-term` → `query`, `/abs/<id>` → `arxiv_id`.
- An input is `--required` when no single value makes sense (an id, a query). Paging and filters keep the recorded value as default.
- The note `workflow fallback takes the input too` means the fallback follows it. `workflow strategy unchanged` means the fallback still replays the recorded click, which ignores the input.
- A typed search draws `<text>` placeholders: param the field with `--link text` (workflows.md).

## 3. Return records

Find selectors in the tab first, and measure the size. The result must fit in 50,000 characters of pretty-printed JSON. This measure counts the records alone, and the cap is checked on the whole nested result, so leave a few thousand characters of margin:

```bash
surf js 'const r=[...document.querySelectorAll("<item>")].map(e=>({title:e.querySelector("h3 a")?.title})); return [r.length, JSON.stringify(r,null,2).length]'
```

```bash
surf playbook extract <pb> <op> --item article.product_pod --field 'title=h3 a@title' --field price=.price_color --field 'url=h3 a@href'   # HTML list
surf playbook extract <pb> <op> --item html --field 'title=meta[name=citation_title]@content' --field 'authors=meta[name=citation_author]@content[]'   # HTML detail
surf playbook extract <pb> <op> --records '$.slideshow.slides' --field title=title --field type=type   # JSON records
surf playbook extract <pb> <op> --value '$.args'                                                       # one JSON value
```

- **HTML list:** the item is the repeated element holding one record. Fields are its descendants (`sel`, `sel@attr`, `sel[]`, `:scope@data-id`). Keep the field that the detail op needs as input (an id or a URL).
- **HTML detail:** `--item html`. Prefer `meta` tags (`citation_*`, `og:*`), then `h1`/`h2`, labelled table cells (`table tr:nth-child(1) td`), and the main text block.
- **Records split across siblings** (arXiv's `dt`/`dd` pairs) have no item selector. Use the container as the item, with parallel `[]` fields (`--item 'dl#articles' --field 'id=dt a[title=Abstract]@id[]' --field 'title=dd .list-title[]'`).
- **Over the cap:** drop long or derivable fields (a URL you can build from the id, descriptions, abstracts) until it fits. A 301-posting board fit at 3 fields, not 5.
- Values come out as the page writes them (`star-rating Three`, `£12.84`, `Full-time /`). There are no transforms. Note that in the decision log.

## 4. Test, then print the run line

```bash
surf playbook test <pb> <op> --<input> <A> --strategy network --assert '$' array_min_len 1 --assert '$[0].title' not_null --save
surf use <pb> <op> --<input> <B> --json            # .strategy is network, and the records differ from A's
```

- **Save only shape checks** (`array_min_len`, `not_null`, `exists`). `surf use` runs the saved checks on every call, so `equals thriller` breaks every other query. Check values with a test you don't save.
- `equals` reads its value as JSON: `equals 3` is the number, and a string needs `equals '"3"'`.
- `--strategy network` keeps the fallback out, so a pass means the replayed request answered.
- Prove the input works. The first title or id for B must differ from A's. An op that ignores its input returns A's records.
- End with the line that runs it: `surf use <pb> <op> --<input> <value>`.

## Cases

**JSON API vs HTML.** If the page calls a JSON endpoint (`Fetch`/`XHR` with records in the sample), take it: its fields are stable paths, and a Node client (`pb client export`) can return records. For an HTML Document, extract with selectors. `surf use` returns records, and a Node client prints the raw HTML.

**List → detail.** Build two ops: `list_<things>` with an id or URL field, and `get_<thing>` taking that id as a required input (`path.2 --as posting_id`). Until ops can chain, the caller maps the field to the input by hand: books `url` `…/catalogue/<slug>/index.html` → `--book <slug>`, Lever `id` → `--posting_id`. Write that mapping in the decision log.

**Data that appears after a click, search or scroll.** Start the record on the page, then do only the action that loads the data. Navigate or expand the UI before `record start`. Read `candidates` for the `Fetch`/`XHR` the action sent. If the data is in that request, the op is network-first, and its fallback replays the action. For a search, param the query with `--link text`. For infinite scroll, see `docs/threads-and-feeds.md` in the Surf repository (the `api` strategy follows cursors, and `collect` scrolls).

**Writes.** A record that clicked or typed drafts a write: `effect: write` and a safety block. Record with `--include-input-values` if the body matters, and param body fields with `pb param body.<path>` so no typed value stays in the op. Check what it would send with `surf use <pb> <op> --dry-run` (pass the inputs `surf playbook ops <pb>` lists), then send once with `--write`. A second run with the same inputs is blocked by its receipt for 5 minutes; pass `--repeat` to send it again. Test it on a test site or a test record only. Write rules, receipts and `pb client export --write` are in [workflows.md](workflows.md#playbooks).

## Decision log

Finish your answer with a short block of each choice you made by hand and why, so it can be checked and reused:

```text
parse-log <pb> <op>  <url>
request   r_… Document|Fetch <url>  (top candidate | --request-id: why)
inputs    path.2 → book (required; slug from list_books url) · query.skip → skip (paging, default 0)
extract   item article.product_pod; title=h3 a@title, price=.price_color, rating=p.star-rating@class, url=h3 a@href
dropped   commitment, url (over the 50,000 cap; url = board + id)
asserts   $ array_min_len 1, $[0].title not_null
checks    A=page 2 "In Her Wake" · B=page 3 "Slow States of Collapse" (network)
walls     none | robots: /search disallowed, used /list | 429 at step n
run       surf use books get_book --book in-her-wake_980
```
