// surf parse <url> --goal "<text>": records the page from about:blank, picks the request that
// carries its data, saves it as a read op, names its inputs, infers an extract from the replayed
// response and saves a shape-only network test. Heuristics only: no model call. Exit 0 on a saved,
// tested op; 2 with the top candidates when the pick is weak or tied; 1 on errors.

const path = require("path");
const { resolveRequestDeadlineMs } = require("./host-sessions.cjs");
const { saveFromRecord } = require("./playbook-authoring.cjs");
const { requestHost } = require("./playbook-cli.cjs");
const { saveExtract } = require("./playbook-extract.cjs");
const { applyParam } = require("./playbook-param.cjs");
const { listRecords, recordsRoot, requestEffect } = require("./playbook-records.cjs");
const { formatTestReport, runPlaybookTest } = require("./playbook-test.cjs");
const { resolveOp } = require("./playbooks.cjs");
const { getPrivateStateRoot, readPrivateJson } = require("./private-state.cjs");
const { WINNER_MARGIN, formatCandidates, siteOf } = require("./record-candidates.cjs");
const { inferHtml, inferJson, keyFields } = require("./parse-infer.cjs");
const { goalNeedsRecipe, opName, planInputs, siteName } = require("./parse-inputs.cjs");
const { checkRobots } = require("./parse-robots.cjs");

const RECIPE = "follow the parse recipe instead (surf skill, references/parse-recipe.md)";
const USAGE = 'Usage: surf parse <url> --goal "<what you want>" [--op <name>] [--input name=field]... [--request-id r_…] [--json]';
// Below this many ms apart the requests parse sends to a site (robots.txt's Crawl-delay wins when longer).
const DEFAULT_GAP_MS = 3000;

const quote = (text) => (/^[\w@%+=:,./-]+$/.test(text) ? text : `'${String(text).replace(/'/g, "'\\''")}'`);
const shell = (words) => words.map(quote).join(" ");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const spec = { inputs: [] };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      if (spec.url) throw new Error(USAGE);
      spec.url = arg;
      continue;
    }
    const name = arg.slice(2);
    if (name === "json" || name === "no-wait") {
      spec[name] = true;
      continue;
    }
    const value = argv[++index];
    if (value === undefined) throw new Error(`${arg} needs a value. ${USAGE}`);
    if (name === "input") {
      const match = value.match(/^([A-Za-z_][\w-]*)=((?:path|query|body|headers)\..+)$/);
      if (!match) throw new Error(`--input needs name=field, as page=path.2 or query=query.q (got ${JSON.stringify(value)})`);
      spec.inputs.push({ name: match[1], field: match[2] });
    } else if (["goal", "op", "request-id", "session", "tab-id"].includes(name)) spec[name] = value;
    else throw new Error(`surf parse has no --${name} option. ${USAGE}`);
  }
  if (!spec.url || !spec.goal) throw new Error(USAGE);
  let url;
  try { url = new URL(spec.url); } catch { throw new Error(`not a URL: ${spec.url}`); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(`surf parse takes an http or https URL, not ${url.protocol}`);
  if (spec.op !== undefined && !/^[a-z0-9._-]+$/.test(spec.op)) throw new Error("--op must use lowercase letters, numbers, dot, underscore, or hyphen");
  return spec;
}

// Whether the pick can be trusted: the top read is a first-party JSON or HTML document and no other
// such request comes within the margin (a JSON with records beats a document too large to sample).
// A low score is fine when nothing competes. `fail` when there is nothing to pick: the page answered
// an error, or no request can be replayed.
function judgePick(candidates, url) {
  const site = siteOf(new URL(url).hostname);
  const hostOf = (link) => { try { return new URL(link).hostname; } catch { return ""; } };
  const isData = (candidate) => candidate.status >= 200 && candidate.status < 300 && siteOf(hostOf(candidate.url)) === site && candidate.reasons.some((reason) => reason === "JSON" || reason === "HTML document");
  const page = candidates.find((candidate) => candidate.type === "Document" && candidate.url === url) || candidates.find((candidate) => candidate.type === "Document");
  if (page?.status >= 400) return { fail: `the page answered ${page.status}` };
  const reads = candidates.filter((candidate) => candidate.eligible && candidate.effect === "read");
  const [top] = reads;
  if (!top) return { fail: "the record holds no request a read op can replay" };
  if (!isData(top)) return { why: `the top request, ${top.method} ${top.url} (score ${top.score}), isn't a first-party JSON or HTML document` };
  const records = (candidate) => candidate.reasons.some((reason) => /^\d+ records$/.test(reason));
  const rival = reads.slice(1).find((candidate) => isData(candidate) && (top.score - candidate.score < WINNER_MARGIN || (top.unsampled && top.type === "Document" && records(candidate))));
  if (rival) return { why: `${top.method} ${top.url} (score ${top.score}) and ${rival.method} ${rival.url} (score ${rival.score}) are too close to pick one` };
  return { pick: top };
}

// The latest record parse stopped for this op whose trace holds the request, so a rerun with
// --request-id saves from it without loading the page again.
function reusableRecord({ site, op, requestId }) {
  const root = getPrivateStateRoot();
  const records = listRecords(root).filter((record) => record.site === site && record.op === op && record.status === "draft_created").sort((a, b) => b.id.localeCompare(a.id));
  for (const record of records) {
    const trace = readPrivateJson(path.join(recordsRoot(root), record.id, "network", "trace.json"), null, { root });
    const entry = trace?.entries?.find((candidate) => candidate.id === requestId);
    if (entry) return { record, entry };
  }
  return undefined;
}

async function record({ spec, site, op, host, gapMs }) {
  await host("navigate", { url: "about:blank" });
  const started = await host("playbook.record.start", { site, op, network: true, watch: false, includeInputValues: false });
  try {
    // robots.txt was the last request to the site.
    await sleep(gapMs);
    await host("navigate", { url: spec.url });
    await host("wait.ready", { timeout: 20000 });
    let requestId = spec["request-id"];
    const live = await host("playbook.record.candidates", { limit: requestId ? 100 : 10 });
    if (requestId) {
      const named = live.candidates.find((candidate) => candidate.id === requestId);
      if (!named) throw new Error(`request ${requestId} isn't in this record; rerun without --request-id, or ${RECIPE}`);
      if (named.effect === "write") throw new Error(`request ${requestId} is a ${named.method}, which can change data; surf parse saves reads only, so ${RECIPE}`);
    } else {
      const verdict = judgePick(live.candidates, spec.url);
      if (verdict.fail) throw new Error(`${verdict.fail}; ${RECIPE}`);
      if (!verdict.pick) {
        await host("playbook.record.stop", { draft: true, read: true });
        return { weak: verdict.why, recordId: started.id, live };
      }
      requestId = verdict.pick.id;
    }
    await host("playbook.record.stop", { draft: true, read: true, requestId });
    return { recordId: started.id, requestId, url: live.candidates.find((candidate) => candidate.id === requestId)?.url, live };
  } catch (error) {
    await host("playbook.record.discard", {}).catch(() => {});
    throw error;
  }
}

function weakResult({ spec, site, op, recorded }) {
  const top = recorded.live.candidates.filter((candidate) => candidate.eligible && candidate.effect === "read").slice(0, 3);
  const rerun = shell(["surf", "parse", spec.url, "--goal", spec.goal, ...(spec.op ? ["--op", spec.op] : []), "--request-id", top[0]?.id ?? "r_…"]);
  const value = { ok: false, exitCode: 2, reason: recorded.weak, record: recorded.recordId, playbook: site, op, candidates: top, rerun };
  const text = [
    `weak pick: ${recorded.weak}`,
    formatCandidates({ recordId: recorded.recordId, site, op, live: false, total: recorded.live.total, candidates: top }),
    `rerun   ${rerun}`,
    `        (with the id of the request that holds the data; or ${RECIPE})`,
  ].join("\n");
  return spec.json ? { value, json: true, exitCode: 2 } : { value: text, json: false, exitCode: 2 };
}

async function handleParseCli(argv, { endpoint, cwd = process.cwd(), session, sessionSource, admission, env = process.env, fetch } = {}) {
  const spec = parseArgs(argv.slice(1));
  const needsRecipe = goalNeedsRecipe(spec.goal, spec.url);
  if (needsRecipe) throw new Error(`${needsRecipe}; ${RECIPE}`);
  if (endpoint?.kind === "remote") throw new Error("surf parse is local-only: it saves the op on this machine from a record on the browser host");
  const site = siteName(spec.url);
  const op = spec.op || opName(spec.goal);
  const robotsCache = new Map();
  const robots = await checkRobots(spec.url, { cache: robotsCache, ...(fetch ? { fetch } : {}) });
  if (!robots.allowed) throw new Error(`${robots.robotsUrl} disallows ${new URL(spec.url).pathname} (${robots.rule}); surf parse won't load it`);
  const setGap = Number(env.SURF_PARSE_DELAY_MS);
  const baseGapMs = env.SURF_PARSE_DELAY_MS !== undefined && env.SURF_PARSE_DELAY_MS !== "" && Number.isFinite(setGap) && setGap >= 0 ? setGap : DEFAULT_GAP_MS;
  let gapMs = Math.max(baseGapMs, (robots.crawlDelay ?? 0) * 1000);
  const target = { tabId: spec["tab-id"] === undefined ? undefined : Number(spec["tab-id"]), session: spec.session || session, sessionSource: spec.session ? "explicit" : sessionSource, admission: spec["no-wait"] ? { wait: false } : admission };
  const host = (tool, args) => requestHost(endpoint, tool, args, { ...target, timeoutMs: resolveRequestDeadlineMs(tool, args) });

  const reused = spec["request-id"] ? reusableRecord({ site, op, requestId: spec["request-id"] }) : undefined;
  if (reused && requestEffect(reused.entry) === "write") throw new Error(`request ${spec["request-id"]} is a ${reused.entry.method}, which can change data; surf parse saves reads only, so ${RECIPE}`);
  const recorded = reused ? { recordId: reused.record.id, requestId: spec["request-id"], url: reused.entry.url } : await record({ spec, site, op, host, gapMs });
  if (recorded.weak) return weakResult({ spec, site, op, recorded });

  // The op replays the picked request, on every surf use: its own host's robots.txt must allow it.
  if (recorded.url) {
    const replayed = new URL(recorded.url, spec.url);
    const allowed = await checkRobots(replayed.href, { cache: robotsCache, ...(fetch ? { fetch } : {}) });
    if (!allowed.allowed) throw new Error(`${allowed.robotsUrl} disallows ${replayed.pathname} (${allowed.rule}), the request that carries the data (${replayed.href}); surf parse won't replay it, so nothing was saved`);
    gapMs = Math.max(gapMs, (allowed.crawlDelay ?? 0) * 1000);
  }

  const saved = saveFromRecord({ recordId: recorded.recordId, requestId: recorded.requestId, cwd });
  try {
    return await finish({ spec, site, op, recorded, saved, cwd, gapMs, host, endpoint, target });
  } catch (error) {
    // The op is saved by now, without its inputs, extract or test.
    throw new Error(`saved ${site} ${op} (${path.join(saved.directory, "ops", `${op}.json`)}), but parse stopped: ${error.message}. The op has no extract or test yet: finish it with the recipe (surf skill, references/parse-recipe.md), or delete that file`);
  }
}

async function finish({ spec, site, op, recorded, saved, cwd, gapMs, host, endpoint, target }) {
  const warnings = [...(saved.warnings || [])];
  const request = resolveOp(site, op, { cwd }).op.run.find((strategy) => strategy.using === "network")?.request;
  if (!request) throw new Error("it has no network strategy to replay");

  // Inputs: the recorded value stays each one's test value.
  const { detail, inputs: planned } = planInputs({ request, goal: spec.goal, overrides: spec.inputs });
  const inputs = [];
  const commands = [];
  for (const input of planned) {
    try {
      applyParam({ playbook: site, op, fields: [input.field], cwd, as: input.as, required: input.required, ...(input.value !== undefined ? { value: input.value } : {}) });
    } catch (error) {
      if (input.explicit) throw error;
      warnings.push(`left ${input.field} as recorded: ${error.message}`);
      continue;
    }
    inputs.push(input);
    commands.push(shell(["surf", "pb", "param", site, op, input.field, ...(input.value !== undefined ? ["--value", input.value] : []), "--as", input.as, ...(input.required ? ["--required"] : [])]));
  }
  const args = Object.fromEntries(inputs.filter((input) => input.required && input.recorded !== undefined).map((input) => [input.as, String(input.recorded)]));
  const runArgs = Object.entries(args).flatMap(([name, value]) => [`--${name}`, value]);

  // The replayed response, which the extract is inferred from.
  await sleep(gapMs);
  const probeArgs = { playbook: site, op, args, projectDir: cwd, test: true, strategy: "network", write: false };
  const probe = await host("playbook.run", probeArgs);
  if (probe?.status !== "completed") throw new Error(`replaying its request failed: ${probe?.error || "no answer"}`);
  const response = probe.value || {};
  const found = response.bodyJson !== undefined ? inferJson(response.bodyJson) : typeof response.body === "string" ? inferHtml(response.body, { baseUrl: response.url || spec.url, detail }) : undefined;
  if (!found) throw new Error("found no records or fields to extract from its response");
  saveExtract({ playbook: site, op, extract: found.extract, cwd });
  commands.push(extractCommand(site, op, found.extract));

  const assertions = [found.records === null ? ["$", "not_null"] : ["$", "array_min_len", "1"], ...keyFields(found).map((name) => [`$[0].${name}`, "not_null"])].slice(0, 3);
  await sleep(gapMs);
  const report = await runPlaybookTest({
    argv: [site, op, ...runArgs, "--strategy", "network", ...assertions.flatMap((assertion) => ["--assert", ...assertion]), "--save"],
    cwd,
    runOp: (params) => {
      const testArgs = { ...params, projectDir: cwd, test: true };
      return requestHost(endpoint, "playbook.run", testArgs, { ...target, timeoutMs: resolveRequestDeadlineMs("playbook.run", testArgs) });
    },
  });
  const run = shell(["surf", "use", site, op, ...runArgs, "--json"]);
  // Renaming reruns parse on this record (no page load) with each input named.
  if (inputs.length) commands.unshift(shell(["surf", "parse", spec.url, "--goal", spec.goal, "--op", op, "--request-id", recorded.requestId, ...inputs.flatMap((input) => ["--input", `${input.as}=${input.field}`])]));
  const value = {
    ok: report.ok,
    exitCode: report.ok ? 0 : 1,
    playbook: site,
    op,
    record: recorded.recordId,
    request: recorded.requestId,
    origins: saved.origins,
    inputs: inputs.map(({ field, as, required, recorded: value, weak }) => ({ name: as, field, required, recorded: value, ...(weak ? { weak } : {}) })),
    extract: { mode: found.mode, ...found.extract, count: found.records, chars: found.chars, dropped: found.dropped },
    test: report,
    run,
    commands,
    ...(warnings.length ? { warnings } : {}),
  };
  return { value: spec.json ? value : formatResult(value), json: spec.json === true, exitCode: value.exitCode };
}

function extractCommand(site, op, extract) {
  const words = ["surf", "pb", "extract", site, op];
  if (extract.html) {
    words.push("--item", extract.html.item);
    for (const [name, field] of Object.entries(extract.html.fields)) words.push("--field", `${name}=${field}`);
  } else if (extract.jsonPath) words.push("--value", extract.jsonPath);
  else {
    words.push("--records", extract.records);
    for (const [name, field] of Object.entries(extract.fields || {})) words.push("--field", `${name}=${field}`);
  }
  return shell(words);
}

function formatResult(value) {
  const { extract, test } = value;
  const fields = extract.html ? Object.keys(extract.html.fields) : Object.keys(extract.fields || {});
  const where = extract.html ? extract.html.item : extract.records ?? extract.jsonPath;
  const lines = [
    `recorded ${value.record}  picked ${value.request}`,
    `saved   ${value.playbook} ${value.op}  origins: ${value.origins.join(", ")}`,
    `inputs  ${value.inputs.map((input) => `--${input.name} (${input.field}, ${input.required ? "required" : `default ${input.recorded}`}${input.weak ? ", weak name: rename it" : ""})`).join(" · ") || "none"}`,
    `extract ${extract.mode} ${where}${fields.length ? ` → ${fields.join(", ")}` : ""}   ${extract.count ?? 1} record${extract.count === 1 ? "" : "s"}, ${extract.chars.toLocaleString("en-US")} chars${extract.dropped.length ? ` (dropped ${extract.dropped.join(", ")} for the 50,000 cap)` : ""}`,
    ...formatTestReport(test).split("\n").map((line, index) => (index === 0 ? `test    ${line}` : `        ${line.trim()}`)),
  ];
  if (!value.ok) lines.push(`        the op is saved, but its test failed; refine it below, or ${RECIPE}`);
  lines.push("", `run     ${value.run}`, ...value.commands.map((command, index) => `${index === 0 ? "refine " : "       "} ${command}`));
  for (const warning of value.warnings || []) lines.push(`Warning: ${warning}`);
  return lines.join("\n");
}

module.exports = { handleParseCli, judgePick };
