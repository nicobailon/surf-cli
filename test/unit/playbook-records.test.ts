import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const journal = require("../../native/activity-journal.cjs");
const authoring = require("../../native/playbook-authoring.cjs");
const records = require("../../native/playbook-records.cjs");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("activity and explicit record evidence", () => {
  it("redacts normal input and keeps append-only events separate from record summary", () => {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surf-records-")), "state");
    roots.push(path.dirname(root));
    journal.journalCommand("type", { text: "top secret", selector: "#q" }, { root });
    expect(fs.readFileSync(journal.journalPath(root), "utf8")).not.toContain("top secret");

    const record = records.startRecord({ site: "fixture", op: "read", root });
    records.appendRecordEvent(
      {
        type: "tool.completed",
        command: "page.text",
        argsRedacted: {},
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        resultSummary: "success",
      },
      { root },
    );
    records.markRecord("opened page", root);
    const stopped = records.stopRecord({ draft: true, root });
    const summary = fs.readFileSync(
      path.join(records.recordsRoot(root), record.id, "record.json"),
      "utf8",
    );
    const events = fs.readFileSync(
      path.join(records.recordsRoot(root), record.id, "events.jsonl"),
      "utf8",
    );
    expect(summary).not.toContain("opened page");
    expect(events).toContain("opened page");
    expect(stopped.record.status).toBe("draft_created");
    expect(stopped.draft.run[0]).toMatchObject({ using: "workflow" });
  });

  it("does not turn recent or recorded page writes into an unreviewed read op", () => {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surf-records-")), "state");
    roots.push(path.dirname(root));
    journal.journalCommand("click", { selector: "#submit" }, { root });
    expect(() =>
      authoring.saveFromRecent({
        site: "fixture",
        op: "submit",
        root,
        home: path.dirname(root),
      }),
    ).toThrow(/write-capable/);

    records.startRecord({ site: "fixture", op: "submit", root });
    records.appendRecordEvent(
      {
        type: "tool.completed",
        command: "click",
        argsRedacted: { selector: "#submit" },
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      },
      { root },
    );
    expect(records.stopRecord({ draft: true, root }).draft.effect).toBe("write");
  });
});
