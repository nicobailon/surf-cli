---
name: deep-x-research
description: Research a topic exhaustively across X (Twitter) using Grok through surf.
disable-model-invocation: true
---

# Deep X Research

Research a topic across X by putting Grok to work from multiple angles — it runs keyword and semantic X searches and watches videos natively — then deliver categorized findings where every claim is traceable to a post URL.

Requires: surf installed and connected (`surf doctor`), Chrome logged into x.com. Command reference: the `surf` skill or `surf --help`.

**Quota:** X caps Grok requests (typically 15 per 20 hours on a standard plan). Every `surf grok` call spends one. Budget the session before the first query and make each query do multi-angle work — never spend a request on what a quota-free step can answer.

## Steps

### 1. Decompose the topic and budget the queries

Break the topic into angles: showcases/examples, techniques & tutorials, tools, notable creators, community discussion — adapt to the topic. Plan a Grok budget of **4-8 queries** covering every angle (combine related angles into one query rather than spending two). Done when each angle is assigned to a budgeted query.

### 2. Grok sweep

Run the budgeted queries sequentially. Engineer each so Grok does the fan-out internally and returns traceable sources:

```bash
# Broad pass — force multi-angle search and URLs
surf grok "Do deep research on TOPIC on X. Search both latest and top posts, keyword and semantic. Return the most relevant posts with full post URLs (x.com/user/status/ID) and a one-line description of each."

# Focused passes — one per remaining angle group
surf grok "TOPIC on X: tutorials, techniques, and the tools people use. Include post URLs for every example."

# Deepest pass — spend DeepSearch on the highest-value angle
surf grok "TOPIC: notable creators, how the trend is evolving, and the standout posts of the last 6 months. Post URLs required." --deep-search
```

Record every post Grok cites: author, one-line gist, full `https://x.com/USER/status/ID` URL. If a response gives claims without URLs, the *next* query in the budget re-asks for sources — never leave an angle sourceless. Done when every planned angle has been queried and the final response adds no new relevant posts, or the budget is spent.

### 3. Video pass (visual topics)

When the topic involves video, editing, or visual style, spend 1-3 budgeted queries having Grok analyze the strongest video posts — it can watch X videos natively:

```bash
surf grok "Analyze the videos in these posts: URL1 URL2 URL3 — for each, describe the techniques, pacing, and style, and why it works."
```

Batch several URLs per query to conserve budget. Done when each analyzed video has notes on what it shows and why it matters for the topic.

### 4. Enrich and verify — quota-free

For each cited post, open it directly with surf (no Grok spend) to verify the URL resolves and harvest detail Grok didn't give:

```bash
surf navigate "https://x.com/USER/status/ID" && surf wait 2
surf page.read --compact          # engagement numbers, thread context
surf network | grep video.twimg   # direct video URL after playback
```

Done when every URL destined for the References section has been resolved (dead or hallucinated links dropped or replaced).

### 5. Categorize and analyze

Group findings into categories that fit the topic. Extract trends: momentum on X, recurring techniques, notable creators, how the topic is evolving. Done when every recorded post is either placed in a category or deliberately dropped as irrelevant.

### 6. Report with full traceability

```md
# Deep Research on [Topic]

## Summary
[2-4 paragraphs: state of the topic on X]

## Key Trends
- ...

## Categorized Findings
### [Category]
- [Finding with inline post reference]

## Notable Creators & Techniques
- ...

## References
1. [Author — one-line description]
   https://x.com/USER/status/ID
   Video: https://video.twimg.com/... (when captured)
```

The report is done when **every post mentioned anywhere in it appears in References with its full, verified URL** — no bare @handles, no "a viral post showed…" without a link.

## Fallback: direct search when the Grok quota is exhausted

The x.com search UI costs no Grok requests. Slower and keyword-only, but it keeps the sweep going:

```bash
surf navigate "https://x.com/search?q=QUERY&f=live" && surf wait 3   # Latest
surf page.read --compact
surf scroll down 2000    # then page.read again — repeat to load more
```

Modes via the `f=` param: **Top is the default (no `f` param)** — there is no `f=top`; `f=live` = Latest, `f=user` = People, `f=media` = Media. Operators compose into the URL-encoded `q=`: `"exact phrase"`, `filter:videos`, `min_faves:100`, `min_retweets:50`, `from:user`, `since:2026-01-01`, `until:2026-06-01`.

## Troubleshooting

- Grok replies with a rate-limit message → quota exhausted; switch to the fallback sweep and tell the user when the quota resets.
- Grok queries fail outright → `surf grok --validate`, then retry with a model from the validation output (see the `surf` skill's AI troubleshooting section).
- Grok cites posts without URLs → re-ask in the next budgeted query; do not invent URLs.
- Search page shows a login wall → Chrome isn't logged into x.com; ask the user to log in.
