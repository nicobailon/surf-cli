const fs = require("fs");
const path = require("path");
const { readRecent } = require("./activity-journal.cjs");
const { writeNetworkExport } = require("./network-export.cjs");
const { getPrivateStateRoot, readPrivateJson } = require("./private-state.cjs");
const { draftFromRecord, readRecord, recordsRoot } = require("./playbook-records.cjs");
const { savePlaybook, validateOp } = require("./playbooks.cjs");
const { commandMetadata } = require("./workflow-definition.cjs");

function suggestions({ since = "1h", root } = {}) {
  const events = readRecent({ since, root });
  const counts = new Map();
  for (const event of events.filter((entry) => entry.type === "tool.issued")) counts.set(event.command, (counts.get(event.command) || 0) + 1);
  return [...counts.entries()].map(([command, count]) => ({ command, count })).sort((a, b) => b.count - a.count || a.command.localeCompare(b.command));
}

function inferArgs(steps) {
  const args = {};
  for (const step of steps) {
    for (const value of Object.values(step.args || {})) {
      const match = typeof value === "string" && value.match(/^<([a-zA-Z0-9._-]+)>$/);
      if (match) args[match[1]] = { required: true, desc: `Recorded ${match[1]}` };
    }
  }
  return args;
}

function saveFromRecent({ site, op: opId, since = "1h", scope = "user", cwd, home, root }) {
  const events = readRecent({ since, root }).filter((event) => event.type === "tool.issued");
  if (events.length === 0) throw new Error("no recent Surf activity to save");
  if (events.some((event) => ["page-write", "unknown"].includes(commandMetadata(event.command).effect))) {
    throw new Error("recent activity includes write-capable commands; use an explicit record and review its draft before saving");
  }
  const steps = events.map((event) => ({ tool: event.command, args: event.argsRedacted || {} }));
  const op = { id: opId, description: "Drafted from recent Surf activity", effect: "read", args: inferArgs(steps), run: [{ using: "workflow", steps }], provenance: { recentSince: since } };
  validateOp(op, { origins: [] });
  return savePlaybook({ manifest: { id: site, name: site, version: "1.0.0", origins: [] }, op, scope, cwd, home });
}

function saveFromRecord({ recordId, scope = "user", cwd, home, root = getPrivateStateRoot() }) {
  const record = readRecord(recordId, root);
  if (!record) throw new Error(`record not found: ${recordId}`);
  const draftPath = path.join(recordsRoot(root), recordId, "draft", "op.json");
  const op = fs.existsSync(draftPath) ? readPrivateJson(draftPath, null, { root }) : draftFromRecord(recordId, root);
  validateOp(op, { origins: record.origin ? [record.origin] : [] });
  return savePlaybook({ manifest: { id: record.site, name: record.site, version: "1.0.0", origins: record.origin ? [record.origin] : [] }, op, scope, cwd, home });
}

function exportRecordHar(recordId, output, root = getPrivateStateRoot()) {
  const trace = readPrivateJson(path.join(recordsRoot(root), recordId, "network", "trace.json"), null, { root });
  if (!trace) throw new Error(`record ${recordId} has no network trace`);
  return writeNetworkExport(path.resolve(output), trace.entries, "har");
}

module.exports = { exportRecordHar, saveFromRecent, saveFromRecord, suggestions };
