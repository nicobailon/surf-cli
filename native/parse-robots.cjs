// robots.txt for surf parse (RFC 9309): the group for "surf", else "*"; the longest matching rule
// wins and Allow wins a tie; `*` matches any text and a final `$` ends the path.

const AGENT = "surf";

function parseRobots(text, agent = AGENT) {
  const groups = [];
  let group;
  let lastWasAgent = false;
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.replace(/#.*/, "").match(/^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*$/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    if (key === "user-agent") {
      if (!lastWasAgent) groups.push((group = { agents: [], rules: [] }));
      group.agents.push(match[2].toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!group) continue;
    if ((key === "allow" || key === "disallow") && match[2]) group.rules.push({ allow: key === "allow", pattern: match[2] });
    if (key === "crawl-delay" && Number.isFinite(Number(match[2]))) group.crawlDelay = Number(match[2]);
  }
  const named = groups.filter((entry) => entry.agents.includes(agent.toLowerCase()));
  const chosen = named.length > 0 ? named : groups.filter((entry) => entry.agents.includes("*"));
  const crawlDelay = chosen.map((entry) => entry.crawlDelay).find((value) => value !== undefined);
  return { rules: chosen.flatMap((entry) => entry.rules), ...(crawlDelay !== undefined ? { crawlDelay } : {}) };
}

function ruleMatches(pattern, path) {
  const anchored = pattern.endsWith("$");
  const source = (anchored ? pattern.slice(0, -1) : pattern).split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`).test(path);
}

/** `path` is the URL's path and query. */
function robotsAllows({ rules }, path) {
  let best;
  for (const rule of rules) {
    if (!ruleMatches(rule.pattern, path)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule;
  }
  if (!best || best.allow) return { allowed: true };
  return { allowed: false, rule: `Disallow: ${best.pattern}` };
}

// A 4xx means no rules; a 5xx or no answer means the whole site is off limits.
async function checkRobots(url, { fetch = globalThis.fetch, timeoutMs = 10000 } = {}) {
  const target = new URL(url);
  const robotsUrl = `${target.origin}/robots.txt`;
  let response;
  try {
    response = await fetch(robotsUrl, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": AGENT } });
  } catch (error) {
    return { allowed: false, robotsUrl, rule: `robots.txt unreachable (${error.message})` };
  }
  if (response.status >= 500) return { allowed: false, robotsUrl, rule: `robots.txt answered ${response.status}` };
  if (response.status >= 400) return { allowed: true, robotsUrl };
  const parsed = parseRobots(await response.text());
  return { ...robotsAllows(parsed, `${target.pathname}${target.search}`), robotsUrl, ...(parsed.crawlDelay !== undefined ? { crawlDelay: parsed.crawlDelay } : {}) };
}

module.exports = { checkRobots, parseRobots, robotsAllows };
