# Threads and feeds

Sites with long threads and feeds (X, Bluesky, Reddit, LinkedIn, YouTube and many more) load them in pages from their own JSON API, and the page keeps only a few items on screen at a time. Scraping the page means scrolling and re-reading over and over. Surf reads the API instead, and returns clean records.

```
recipe (JSON) ──► match   find the page's own API response by URL pattern
                  page    get the next pages:
                            replay  re-send that request from the tab with the next cursor
                            drive   if the site rejects replays, scroll and read each new response
                  map     JSON → records, deduped by key
                  format  json / jsonl / md
```

If a site has no usable API, the `collect` strategy scrolls the page and reads the items.

## X threads (built in)

```bash
surf use x thread --url https://x.com/<user>/status/<id> --format md
```

You get the thread author's posts in order, each with `id`, `author`, `name`, `time` (ISO 8601, UTC), `text` (long posts in full), `replyTo`, `media` (image URLs), `quoted` (the quoted post) and `url`. Use `--format jsonl` for one post per line, or `--json` for the full result. If reading X's `TweetDetail` response fails, the op falls back to `collect` on the page.

## Write a recipe for another site

A recipe is a playbook: a `playbook.json` plus one file per op. Put it in `./.surf/playbooks/<id>/` (this project) or `~/.surf/playbooks/<id>/` (all projects).

1. Find the request. Open the page, then list the JSON requests it made:
   ```bash
   surf go https://bsky.app/profile/bsky.app
   surf network --type json --format urls
   ```
2. Look at one response:
   ```bash
   surf network.wait --match "/xrpc/app.bsky.feed.getAuthorFeed" --open https://bsky.app/profile/bsky.app
   ```
3. Write the recipe. This one reads a Bluesky profile feed.

`.surf/playbooks/bsky/playbook.json`:

```json
{
  "id": "bsky",
  "name": "Bluesky",
  "version": "1.0.0",
  "origins": ["https://bsky.app", "https://public.api.bsky.app"]
}
```

`.surf/playbooks/bsky/ops/feed.json`:

```json
{
  "id": "feed",
  "description": "Posts from a profile feed",
  "effect": "read",
  "args": { "url": { "required": true } },
  "run": [
    {
      "using": "api",
      "open": "{{url}}",
      "match": "/xrpc/app.bsky.feed.getAuthorFeed",
      "records": {
        "find": { "exists": ["post.uri", "post.record.text"] },
        "key": "post.uri",
        "fields": {
          "author": "post.author.handle",
          "name": "post.author.displayName",
          "time": "post.record.createdAt",
          "text": "post.record.text",
          "postId": { "path": "post.uri", "match": "/app\\.bsky\\.feed\\.post/(.+)$" },
          "url": { "template": "https://bsky.app/profile/{{author}}/post/{{postId}}" }
        }
      },
      "cursor": { "find": { "exists": ["cursor", "feed"] }, "path": "cursor", "into": "query.cursor" },
      "maxPages": 3,
      "expect": { "minItems": 1 }
    }
  ],
  "markdown": {
    "title": "Bluesky feed",
    "heading": "{{name}} (@{{author}}) · {{time}}",
    "link": "{{url}}",
    "body": "text"
  }
}
```

```bash
surf use bsky feed --url https://bsky.app/profile/bsky.app --format md
```

Add a `collect` strategy after the `api` one if you want a fallback that reads the page. `playbooks/x/ops/thread.json` has an example of both.

## Recipe reference

### `api` strategy

| Key | Meaning |
| --- | --- |
| `open` | URL to open first. Capture starts before the page loads. Leave it out to use the current page. |
| `match` | URL pattern of the API request (see below). |
| `records` | How to turn each response into records (see below). |
| `cursor` | `{ find, path, into }`: where the next-page cursor is in a response, and where it goes in the next request. Leave it out for a single page. |
| `mode` | `auto` (default): replay, and if the site rejects it, drive. `replay` or `drive` forces one. |
| `maxPages` | Default 20. |
| `timeoutMs` | How long to wait for the first response. Default 30000. |
| `allowPost` | Allow replaying a request that isn't GET or HEAD. Default false. |

**`match`** is tested against the request URL without its query string. A pattern containing `://` must match the whole URL; otherwise it must match the whole path. `*` matches any run of characters except `/`, and `**` matches anything.

**`cursor.into`** says where the cursor goes:

- `query.<param>` sets a query parameter;
- `query.<param>.<path>` sets a field inside a query parameter that holds JSON (X uses `query.variables.cursor`);
- `body.<path>` sets a field in a JSON request body.

Paging stops when there is no cursor, the cursor repeats, `maxPages` is reached, or two pages in a row add no new records.

### Records

| Key | Meaning |
| --- | --- |
| `find` | `{ "exists": [paths], "equals": { path: value } }`. Surf searches the whole response and turns every object that matches into one record. Objects inside a match aren't searched, so a quoted post stays a field of its parent. |
| `key` | Path of a unique id, used to drop duplicates across pages. The first one seen wins. |
| `fields` | `name: path`, or an object (below). |
| `keep` | `{ field: value }`: keep only records whose field equals value. `"@first"` means the first record's value, for example to keep only the thread author's posts. |

**Paths** use dots (`post.author.handle`), indexes (`media[0]`), `[*]` for every item of an array (`media[*].url` gives a list), and `??` for fallbacks (`note.text ?? legacy.full_text`). A missing value is left out.

**Field objects:**

- `{ "path": "...", "match": "regex" }` keeps the regex's first capture group;
- `{ "path": "...", "as": "datetime" }` turns an ISO 8601 date-time with a zone (`2024-01-01T12:00+02:00`) or X's form (`Mon Jan 01 10:00:00 +0000 2024`) into ISO 8601 UTC (`2024-01-01T10:00:00.000Z`), and leaves anything else out. With `match`, the regex runs first;
- `{ "template": "https://site/{{author}}/{{id}}" }` builds a value from the record's other fields;
- `{ "path": "...", "fields": { ... } }` maps a nested object, or each object in a list, into a nested record.

### `collect` strategy

| Key | Meaning |
| --- | --- |
| `open` | URL to open first (optional). |
| `item` | CSS selector for one item in the list. |
| `key` | Field spec for a unique id per item. |
| `fields` | `name: spec`. Names with dots (`quoted.text`) build a nested record. |
| `maxItems` | Default 500. |
| `idleRounds` | Stop after this many scrolls that add no new items. Default 3. |
| `scrollDelayMs` | Wait after each scroll. Default 800. |
| `expand` | Selector for "show more" buttons to click inside each item before reading it (buttons only, never links). |
| `keep` | Same as for records. |

DOM field specs:

- `"h2"` gives the text of the first match;
- `"a@href"` gives an attribute;
- a trailing `[]` (`"img@src[]"`) gives every match as a list;
- `":scope"` means the item itself;
- the object form is `{ selector, attr, all, match, template }`.

The same options work on the command line: `surf collect --item article --key 'a@href' --field title=h2 --max 100`.

### `markdown`

An op-level `markdown` object controls `--format md`:

- `title` is a template over the op's arguments and the first record;
- `heading` and `link` are templates over each record;
- `body` names the text field;
- `quote` names a nested-record field, shown as a blockquote;
- `images` names a list of image URLs.

Without it, each record is shown as a list of its fields.

## Limits and safety

- **Visible tab for scrolling.** Background tabs don't render or load more on scroll. `collect`, and an `api` strategy that falls back to drive, fail with "needs a visible tab" instead of returning partial results. Use `surf session.ensure <name> <url> --window --focused` or bring the tab to the front. Replay works in a background tab.
- **Read requests only by default.** Replay only re-sends GET and HEAD unless you pass `--allow-post` (or `allowPost: true`), because re-sending a POST can repeat an action.
- **Origins.** When a playbook lists `origins`, replays to any other origin are refused.
- **Cookies** are sent the way the page itself must have sent them: always for same-origin requests, and for cross-origin requests only when the captured response allowed credentials.
- **Header values stay private.** The page's auth and CSRF header values are reused inside the tab, and never appear in output, events, the activity journal or error messages.
- **Body size.** `network.wait` and replay read the response body as soon as it arrives, so the 64 KB storage limit for `surf network` bodies doesn't apply to them.

## How the numbers were measured

The numbers were measured on 2026-10-21 in a logged-in Chrome with the installed surf host. They count every browser call surf made.

| Run | Browser calls | Time |
| --- | --- | --- |
| 13-post X thread, scrolling and re-reading the page by hand | about 30 | — |
| 13-post X thread, `surf use x thread` | 4 | 4.9 s |
| Bluesky profile feed, the recipe above (83 posts, 3 pages, all by replay) | 14 | 4.3 s |

The X thread fit in one `TweetDetail` response, so it needed no next page.

Not verified live:

- X's next-page cursor (`Bottom`);
- the `collect` fallback on X, including the "show more" wait.

Both are covered by tests on a fake site in `test/e2e/real-chrome.mjs`: replay, drive and collect each return 20 of 20 items.
