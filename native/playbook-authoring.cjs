const fs = require("fs");
const path = require("path");
const { readRecent } = require("./activity-journal.cjs");
const { writeNetworkExport } = require("./network-export.cjs");
const { getPrivateStateRoot, readPrivateJson } = require("./private-state.cjs");
const { REVIEW_KEY_ARG, draftFromRecord, readRecord, recordsRoot } = require("./playbook-records.cjs");
const { isCommitWorkflow, savePlaybook, validateOp } = require("./playbooks.cjs");
const { siteOf } = require("./record-candidates.cjs");
const { hostname, isTelemetryRequest, requestEffect, shownUrl } = require("./request-kinds.cjs");
const { commandMetadata, normalizeStep, promoteRedactedStepArgs } = require("./workflow-definition.cjs");

function suggestions({ since = "1h", root } = {}) {
  const events = readRecent({ since, root });
  const counts = new Map();
  for (const event of events.filter((entry) => entry.type === "tool.issued")) counts.set(event.command, (counts.get(event.command) || 0) + 1);
  return [...counts.entries()].map(([command, count]) => ({ command, count })).sort((a, b) => b.count - a.count || a.command.localeCompare(b.command));
}

function saveFromRecent({ site, op: opId, since = "1h", scope = "user", cwd, home, root }) {
  const events = readRecent({ since, root }).filter((event) => event.type === "tool.issued");
  if (events.length === 0) throw new Error("no recent Surf activity to save");
  if (events.some((event) => ["page-write", "unknown"].includes(commandMetadata(event.command, event.argsRedacted).effect))) {
    throw new Error("recent activity includes write-capable commands; use an explicit record (with --network, so its requests show whether the flow writes) and review its draft before saving");
  }
  const promoted = promoteRedactedStepArgs(events.map((event) => ({ tool: event.command, args: event.argsRedacted || {} })));
  const op = { id: opId, description: "Drafted from recent Surf activity", effect: "read", args: promoted.args, run: [{ using: "workflow", steps: promoted.steps }], provenance: { recentSince: since } };
  validateOp(op, { origins: [] });
  return savePlaybook({ manifest: { id: site, name: site, version: "1.0.0", origins: [] }, op, scope, cwd, home });
}

// The captured write a network-only write op replays: the site's own, and when the record holds
// several writes, the one named with --request-id (at stop or at save).
function replayedWrite({ op, record, trace, requestId, request }) {
  const fail = (why) => new Error(`write op ${op.id} can't be saved network-only: ${why}`);
  const writes = (trace?.entries || []).filter((entry) => requestEffect(entry) === "write" && !isTelemetryRequest(entry, record.origin));
  const chosen = requestId ?? op.provenance?.requestId;
  if (!chosen && writes.length > 1) {
    const listed = writes.map((entry) => `${entry.id} ${shownUrl(entry)}`).join(", ");
    throw fail(`the record captured ${writes.length} writes (${listed}); name the one the op replays with pb save --from-record <id> --request-id <r_…>`);
  }
  const entry = chosen ? writes.find((candidate) => candidate.id === chosen) : writes[0];
  const sent = `${request.method} ${request.url}`;
  if (!entry || shownUrl(entry) !== sent) throw fail(`it would replay ${shownUrl(request)}, which isn't a write the record captured`);
  const site = hostname(record.origin || entry.tabUrl);
  if (!site || siteOf(hostname(entry.url)) !== siteOf(site)) {
    throw fail(`it would replay ${sent}, which isn't on the record's site (${record.origin || "unknown"}); the op must replay the site's own write`);
  }
}

// A write draft whose workflow can't be its fallback (a navigate first, or a type and a click)
// saves with its network strategy alone when that replays the site's own captured write. The
// workflow's inputs go with it, and the review key takes their place as the safety key when none
// is left.
function fitWriteWorkflow(op, { record, trace, requestId }, warnings) {
  const workflow = op.effect === "write" && op.run.find((strategy) => strategy.using === "workflow");
  if (!workflow) return op;
  const steps = workflow.steps.map(normalizeStep);
  if (isCommitWorkflow(steps)) return op;
  const why = `a write op's workflow fallback must be one page-write step, and this draft's is ${steps.map((step) => step.cmd).join(" + ")}`;
  const network = op.run.find((strategy) => strategy.using === "network");
  if (!network) {
    throw new Error(`write op ${op.id} can't be saved: ${why}, and the draft has no network strategy to replay the write instead. Record the write as a single click, or start the record with --network so the draft can replay its request`);
  }
  const shown = shownUrl(network.request);
  if (requestEffect(network.request) !== "write") throw new Error(`write op ${op.id} can't be saved: ${why}, and its network strategy replays ${shown}, a read, not the write`);
  replayedWrite({ op, record, trace, requestId, request: network.request });
  warnings.push(`saved network-only: ${why}, so the op replays ${shown} alone`);
  const run = op.run.filter((strategy) => strategy !== workflow);
  const used = JSON.stringify(run);
  const args = Object.fromEntries(Object.entries(op.args || {}).filter(([name]) => used.includes(`{{${name}}}`)));
  let key = op.safety.key.filter((name) => Object.hasOwn(args, name));
  if (key.length === 0) {
    key = ["review_key"];
    args.review_key = REVIEW_KEY_ARG;
  }
  return { ...op, args, safety: { ...op.safety, key }, run };
}

// The origins an op saved from a record may send to: the page the record ran on, and the request
// its network strategy replays (an API on another host, as api.resy.com for resy.com). Other
// captured origins stay out.
// A replayed request on another site than the page (a CDN's JSON, say) is allowed with a warning,
// so a wrong pick shows.
function allowedOrigins(record, op, warnings) {
  const request = op.run.find((strategy) => strategy.using === "network")?.request;
  const replayed = request && new URL(request.url).origin;
  if (replayed && record.origin && siteOf(hostname(replayed)) !== siteOf(hostname(record.origin))) {
    warnings.push(`the op may also send to ${replayed}, the origin of the request it replays (${shownUrl(request)}), which is on another site than the record's page (${record.origin}); if that is the wrong request, save again with --request-id <r_…> from pb record candidates`);
  }
  return [...new Set([record.origin, replayed].filter(Boolean))];
}

// `requestId` redrafts the op to replay that request, keeping a read draft a read (its checks rerun).
function saveFromRecord({ recordId, requestId, scope = "user", cwd, home, root = getPrivateStateRoot() }) {
  const record = readRecord(recordId, root);
  if (!record) throw new Error(`record not found: ${recordId}`);
  const draftPath = path.join(recordsRoot(root), recordId, "draft", "op.json");
  const draft = fs.existsSync(draftPath) ? readPrivateJson(draftPath, null, { root }) : null;
  const warnings = [];
  const drafted = draft && !requestId ? draft : draftFromRecord(recordId, root, { read: draft?.effect === "read", requestId, warnings });
  const trace = readPrivateJson(path.join(recordsRoot(root), recordId, "network", "trace.json"), null, { root });
  const op = fitWriteWorkflow(drafted, { record, trace, requestId }, warnings);
  const origins = allowedOrigins(record, op, warnings);
  validateOp(op, { origins });
  const saved = savePlaybook({ manifest: { id: record.site, name: record.site, version: "1.0.0", origins }, op, scope, cwd, home });
  return { ...saved, origins, ...(warnings.length > 0 ? { warnings } : {}) };
}

function exportRecordHar(recordId, output, root = getPrivateStateRoot()) {
  const trace = readPrivateJson(path.join(recordsRoot(root), recordId, "network", "trace.json"), null, { root });
  if (!trace) throw new Error(`record ${recordId} has no network trace`);
  return writeNetworkExport(path.resolve(output), trace.entries, "har");
}

module.exports = { exportRecordHar, saveFromRecent, saveFromRecord, suggestions };
