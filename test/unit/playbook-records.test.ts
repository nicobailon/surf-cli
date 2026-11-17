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
        command: "search",
        argsRedacted: { term: "<term>" },
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
    expect(stopped.draft.args.term).toMatchObject({ required: true });
    expect(stopped.draft.run[0]).toMatchObject({ using: "workflow" });
    expect(stopped.draft.run[0].steps[0].args.term).toBe("{{term}}");
  });

  it("redacts nested activity and trace credentials before drafting", () => {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surf-records-")), "state");
    roots.push(path.dirname(root));
    journal.journalCommand(
      "form.fill",
      { data: [{ selector: "#email", value: "top secret" }] },
      { root },
    );
    journal.journalCommand(
      "navigate",
      { url: "https://example.test/?access_token=captured-secret&q=ok" },
      { root },
    );
    journal.journalCommand("unknown.tool", { text: "do not record" }, { root });
    const recent = fs.readFileSync(journal.journalPath(root), "utf8");
    expect(recent).not.toContain("top secret");
    expect(recent).not.toContain("do not record");

    const record = records.startRecord({ site: "fixture", op: "read", root });
    records.appendRecordEvent(
      { type: "tool.issued", command: "click", argsRedacted: { selector: "#go" } },
      { root },
    );
    records.appendRecordEvent(
      { type: "tool.completed", command: "click", argsRedacted: { selector: "#go" } },
      { root },
    );
    records.attachNetworkTrace(
      record.id,
      [
        {
          id: "r-1",
          method: "GET",
          status: 200,
          url: "https://example.test/api?access_token=captured-secret&q=ok",
          requestHeaders: { "x-api-key": "captured-secret", accept: "application/json" },
          responseHeaders: { "set-cookie": "sid=captured-secret" },
          requestBody: "captured-secret",
          responseBody: "captured-secret",
        },
      ],
      root,
    );
    const stopped = records.stopRecord({ draft: true, root });
    const trace = fs.readFileSync(
      path.join(records.recordsRoot(root), record.id, "network", "trace.json"),
      "utf8",
    );
    expect(trace).not.toContain("captured-secret");
    expect(
      stopped.draft.run.find((strategy: { using: string }) => strategy.using === "workflow").steps,
    ).toHaveLength(1);
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
    const stopped = records.stopRecord({ draft: true, root });
    expect(stopped.draft).toMatchObject({
      effect: "write",
      safety: { authorization: "explicit", duplicate: "transactional", key: ["review_key"] },
    });
    expect(() =>
      authoring.saveFromRecord({ recordId: stopped.record.id, root, home: path.dirname(root) }),
    ).not.toThrow();
  });
});
