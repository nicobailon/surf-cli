# Oracle: long ChatGPT consults

Use `chatgpt` for a quick question. Use `oracle` for a long consult that should survive restarts: it picks model and effort, sends file context, and lets you collect the answer later. It runs on the local browser only.

## Agent pattern

```bash
surf oracle ask "Review this design" --files 'src/**/*.ts' --effort high --detach --json   # keep .id
surf oracle status <id> --json          # no browser needed
surf oracle result <id> --wait --json   # has "response" once the job is captured
surf oracle follow <id> "And the tests?" --detach --json   # each follow-up has a new id
surf oracle list
```

Once a job is `awaiting`, `oracle result` recovers it across CLI, host and Chrome restarts. Ctrl-C exits with code 130.

## Model, effort and quota

- `--model gpt-6-astra|latest|gpt-5.6-sol|gpt-5.5`; `--effort instant|medium|high|xhigh|pro`.
- Pro quota is scarce, so ask for it explicitly with `--effort pro`. Surf reads the model and effort back before sending; a mismatch fails with `model_verification_failed`. Ask the user before retrying `gpt-6-astra` as `latest`.
- One job runs at a time. A `capacity` error names the job in flight: wait for it with `oracle result`, then ask again.

## Files

- `--files <glob>` (repeatable) adds context. Up to 60,000 characters go inline; more becomes one private attachment. `--file <path>` attaches one file as is.
- It fails on no match, unreadable, binary or non-UTF-8 files. Gitignored files and `.env* *.pem *.key id_rsa* id_ed25519* *.p12 *.pfx credentials* secrets*` are refused unless `--allow-sensitive`, which sends them unredacted.
- `--github` requires ChatGPT's GitHub tool in the Chat tab.

## Pi

Installed as a Pi package, Surf adds the `surf-oracle` background-job provider (start, status, result, reattach; reattach never sends the prompt again) and a `gpt-pro` agent (gpt-6-astra at pro effort).
