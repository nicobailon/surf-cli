---
name: surf-skills
description: Package index for Surf skills. Use when you need install or layout notes for the Surf skill bundle.
disable-model-invocation: true
---

# Surf Skills

This directory contains skill files for AI coding agents:

- **`surf/`** — the core browser-automation skill: rules, everyday commands and the name of every command in `SKILL.md`, with semantic, oracle, remote, workflow and troubleshooting details in `references/`.
- **`deep-x-research/`** — a research procedure built on surf: exhaustive, multi-angle X (Twitter) research with categorized findings and full post-URL traceability. Requires x.com login in Chrome.

Install each skill as a whole folder (symlink or copy). `surf/SKILL.md` points to files in `surf/references/`, so copying `SKILL.md` alone leaves those pointers broken.

## Pi Agent

To use a skill with [Pi coding agent](https://github.com/badlogic/pi-mono):

```bash
# Option 1: Symlink (auto-updates)
ln -s "$(pwd)/skills/surf" ~/.agents/skills/surf
ln -s "$(pwd)/skills/deep-x-research" ~/.agents/skills/deep-x-research

# Option 2: Copy
cp -r skills/surf skills/deep-x-research ~/.agents/skills/
```

The skills will be available when pi detects browser automation or X research tasks.

## Other Agents

Other agents (Claude Code, Codex) load the same folders: copy or symlink each whole skill folder into the agent's skills directory (e.g. `~/.claude/skills/`, `~/.agents/skills/`).
