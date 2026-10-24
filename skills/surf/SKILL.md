---
name: surf
description: Drive the user's logged-in Chrome from the shell. Use for browser automation (open, read, click, fill, upload, screenshot), reading a site's feed or API, or asking ChatGPT, Gemini, Perplexity or Grok through the browser.
---

# Surf

`surf` controls the user's real, logged-in Chrome. Below: the rules, the everyday commands in full, examples of the tricky shapes, and every other command by name. Before the first use of a command not shown in full, run `surf <cmd> --help` (flags, allowed values, examples). `surf --find <term>` searches commands; `surf --help-topic <topic>` explains refs, selectors, frames and more.

## Rules

**Own a session.** Once per agent shell, before any browser command:

```bash
export SURF_SESSION="$(basename "$PWD" | sed 's/[^A-Za-z0-9._-]/-/g; s/^[^A-Za-z0-9]*//')-<agent-id>"   # letters, digits . _ - only
surf session.ensure "$SURF_SESSION" about:blank   # creates, reuses or reopens
```

It is one tab in its own background window, and its commands run in order. Sessions share the Chrome profile (cookies, logins, downloads). On `tab_gone` or `session_epoch_stale`, run the command the error prints after `Recovery:`.

**Read → act on refs → read the diff.** `page.read` gives refs (`e5`); act on refs, not CSS. Each action prints what changed; when the report ends `+N more changes...`, run the smaller command it suggests instead of a full read.

**Errors** from the browser print `[code]` on stderr and exit 1; `--json` adds `{error:{code,message}}` on stdout. Usage and connection errors are plain stderr.

**Fail fast on walls.** `wait.ready` returns when the page is ready and fails with `page_login|page_challenge|page_not_found|page_error|page_timeout`; `--accept login` returns that state instead.

**API before scroll.** For feeds and threads, read the site's own API: `use x thread`, or `network.wait` then `network.replay --set`. `collect` scrolls the page when there is no API and needs a visible tab (`session.ensure <name> <url> --window --focused`).

**Values, not pages.** To read a few values (a total, a date, a count), use `semantic.extract`: it returns typed values without a full page read.

**Pipe multi-step work.** `surf do` runs steps with waits between them; run it with `--dry-run` first.

**Rich editors** (ChatGPT, Notion, other contenteditable fields): target the field, `type <text> --ref e5` or `--into <css>`, instead of typing at the cursor.

**AI sites** (`chatgpt gemini perplexity grok kimi aistudio`, `oracle ask`) use the user's login, no API key, and take the whole browser while they run; a waiting message means queued. Reasoning models take 60 s or more.

**Semantic commands are optional model calls.**
- `semantic.*` sends page text, without field values, to TypeSafe (`jev-1.13.0`, the default) or Cloudflare Workers AI (`clef`, `clef-flash`, and `clairic` for `semantic.extract`).
- Clicks and fills need `--allow-write`; `--allow-ref` limits which elements it can touch.
- Each write has to clear a confidence threshold. `--threshold` changes it for one run and never grants write permission.

## Everyday commands

`<x>` required, `[--f <v>]` optional, `a|b` allowed values, `=v` default, `…` repeatable. Global flags: `--session <n> --tab-id <id> --json --no-diff`.

```text commands
session.ensure <name> <url> [--window|--tab] [--focused]
navigate <url>                    # alias go
page.read [--ref e5] [--all] [--no-text] [--depth <n>] [--compact] [--summary]   # alias read
click <ref> | --selector <css> [--index <n>] | --x <n> --y <n>   [--button left|right|double|triple]
type <text> [--ref e5|--into <css>] [--submit] [--clear] [--method cdp|js]
key <key> [--repeat <n>]          # Enter, Escape, cmd+a
select <ref|css> <value>… [--by value|label|index]
locate.role <role> [--name <text>] [--action click|fill|hover|text] [--value <v>]
wait.ready [--selector <css>] [--text <t>] [--url-prefix <u>] [--accept login,challenge,…] [--timeout <ms>=20000]
screenshot [--output <f>] [--full-page] [--annotate] [--no-save]   # auto-saves to /tmp
js <code> [--file <f>]            # `return` a value
scroll up|down|left|right [<px>] | scroll.top | scroll.bottom
frame.switch --selector <css>|--name <n>|--index <i> | frame.main
tab.list | tab.new <url> | tab.switch <id> | tab.close <id> | tab.reload [--hard]
cookie.get <name>
emulate.viewport --width <px> --height <px> [--mobile]
console [--limit <n>] [--stream [--level error]]
chatgpt|gemini|perplexity|grok <prompt> [--with-page] [--model <m>]   # --file <f>: chatgpt, gemini
doctor [--browser all]            # can't connect
```

## Examples of the tricky shapes

```bash
surf do 'go "https://example.com" | read | click e5 | screenshot'   # refs reset on navigation; read assigns them again
surf form.fill --data '[{"ref":"e1","value":"John"},{"ref":"e7","value":true}]'
surf upload --ref e12 --files ./resume.pdf          # e12 may be the "Upload" button
surf drag --from 100,200 --to 300,200
surf use x thread --url https://x.com/<user>/status/<id> --format md
surf network.wait "/api/**/feed" --json             # prints the response and its request id
surf network.replay r_001 --set query.cursor=abc    # next page
surf collect --item article --key 'a@href' --field title=h2 --field url=a@href
surf semantic.extract --field total:number:"Order total incl. tax" --field delivery:date
surf semantic.act "add 2 to the cart" --allow-write --allow-ref e14 --allow-ref e15
surf oracle ask "Review this design" --files 'src/**/*.ts' --effort pro --detach --json   # keep .id
surf oracle result <id> --wait --json
```

## Every other command

```text index
session: session.new session.list session.info session.close session.rebind session.reopen session.cleanup
nav: back forward
tab: tab.move tab.name tab.unname tab.named tab.group tab.ungroup tab.groups
window: window.new window.list window.focus window.close window.resize resize zoom
read: page.text page.html page.save page.state page.readiness search locate.text locate.label element.styles frame.list frame.diagnose frame.js
act: hover smart_type dialog.info dialog.accept dialog.dismiss scroll.to scroll.info
wait: wait wait.element wait.network wait.url wait.dom wait.load
capture: snap record video.start video.stop video.status video.restart animate-audit perf-audit perf.start perf.stop perf.metrics
data: extract network network.get network.body network.curl network.path network.origins network.stats network.clear network.export
browser: cookie.list cookie.set cookie.clear history.list history.search bookmark.list bookmark.add bookmark.remove
emulate: emulate.network emulate.cpu emulate.geo emulate.device emulate.touch
ai: kimi aistudio aistudio.build ai
semantic: semantic.find semantic.filter semantic.verify | semantic auth set | semantic auth status | semantic auth clear
oracle: oracle follow | oracle status | oracle list
playbook: playbook list | playbook show | playbook ops | playbook run | playbook suggest | playbook save | playbook record start | playbook record mark | playbook record stop | playbook record status | playbook trace export | playbook export | playbook import | playbook client derive | playbook client export | playbook client verify
workflow: batch workflow.list workflow.info workflow.validate
setup: install uninstall config server extension-path health smoke remote authorize | remote list | remote revoke
```

## Read when the case applies

- iframes → `surf --help-topic frames`
- can't connect, AI-site errors, slow first call → [references/troubleshooting.md](references/troubleshooting.md)
- semantic credentials, models, thresholds, workflow steps → [references/semantic.md](references/semantic.md)
- oracle jobs, files, Pro quota → [references/oracle.md](references/oracle.md)
- browser on another machine → [references/remote.md](references/remote.md)
- workflow JSON, playbooks → [references/workflows.md](references/workflows.md)
