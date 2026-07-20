const fs = require("fs");
const path = require("path");
const { appendPrivateJsonLine, atomicWriteFile, ensurePrivateDir, getPrivateStateRoot, readPrivateFile } = require("./private-state.cjs");
const { commandMetadata, redactCommandArgs } = require("./workflow-definition.cjs");

const MAX_JOURNAL_BYTES = 1024 * 1024;
const MAX_JOURNAL_EVENTS = 500;

function journalPath(root = getPrivateStateRoot()) {
  return path.join(root, "activity-journal", "events.jsonl");
}

function compactJournal(filePath, root) {
  const stat = fs.statSync(filePath);
  if (stat.size <= MAX_JOURNAL_BYTES) return;
  const lines = readPrivateFile(filePath, { root, encoding: "utf8" }).trim().split("\n").filter(Boolean).slice(-MAX_JOURNAL_EVENTS);
  atomicWriteFile(filePath, `${lines.join("\n")}\n`, { root, encoding: "utf8" });
}

function appendActivity(event, { root = getPrivateStateRoot() } = {}) {
  const filePath = journalPath(root);
  ensurePrivateDir(path.dirname(filePath), root);
  appendPrivateJsonLine(filePath, { version: 1, ...event }, { root });
  compactJournal(filePath, root);
}

function journalCommand(command, args, options = {}) {
  const metadata = commandMetadata(command);
  if (!metadata.recordable) return;
  appendActivity({
    type: "tool.issued",
    command: metadata.name,
    argsRedacted: redactCommandArgs(command, args, options.includeInputValues === true),
    effect: metadata.effect,
    ...(options.tabId ? { tabId: options.tabId } : {}),
    ...(options.origin ? { origin: options.origin } : {}),
    startedAt: new Date().toISOString(),
  }, options);
}

function sinceMilliseconds(value) {
  if (!value) return 60 * 60 * 1000;
  const match = String(value).match(/^(\d+)(m|h|d)$/);
  if (!match) throw new Error("--since must be a duration such as 30m, 1h, or 2d");
  return Number(match[1]) * { m: 60000, h: 3600000, d: 86400000 }[match[2]];
}

function readRecent({ since = "1h", root = getPrivateStateRoot() } = {}) {
  const filePath = journalPath(root);
  const content = readPrivateFile(filePath, { root, allowMissing: true, fallback: "", encoding: "utf8" });
  const cutoff = Date.now() - sinceMilliseconds(since);
  return content.split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((event) => Date.parse(event.startedAt || event.timestamp) >= cutoff);
}

module.exports = { appendActivity, journalCommand, journalPath, readRecent };
