import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const journal = require("../../native/activity-journal.cjs");
const authoring = require("../../native/playbook-authoring.cjs");
const records = require("../../native/playbook-records.cjs");
const roots: string[] = [];
const TAB = { tabId: 1 };

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

type Entry = Record<string, unknown>;
const completed = (command: string) => ({
  type: "tool.completed",
  command,
  argsRedacted: {},
  startedAt: new Date().toISOString(),
});
const tempRoot = () => {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surf-records-")), "state");
  roots.push(path.dirname(root));
  return root;
};
const at = Date.parse("2026-11-14T10:00:00Z");

describe("record network trace", () => {
  it("keeps requests captured after the record started whatever clock stamped them", () => {
    const kept = records.traceEntriesForRecord({ startedAt: "2026-11-14T10:00:00.000Z" }, [
      { id: "r_before", ts: at - 5000 },
      { id: "r_after", ts: at + 1500 },
      // Extensions up to v2.26.0 stamped `ts` with Chrome's monotonic clock (ms since boot).
      { id: "r_monotonic", ts: 1_160_000_500 },
    ]);
    expect(kept.map((entry: { id: string }) => entry.id)).toEqual(["r_after", "r_monotonic"]);
  });

  it.each([
    [
      "an interruption",
      {
        capture: {
          active: true,
          interruptions: [{ reason: "target_closed", at, resumedAt: at + 5000 }],
        },
      },
      [
        "network capture was interrupted at 2026-11-14T10:00:00.000Z (debugger detached: target_closed) until 2026-11-14T10:00:05.000Z; requests in between were not captured",
      ],
    ],
    [
      "capture that was off at stop",
      { capture: { active: false, interruptions: [] } },
      [
        "network capture was not running when the record stopped (the extension may have restarted); requests may be missing",
      ],
    ],
    [
      "a clear during the record",
      { capture: { active: true, interruptions: [], clearedAt: at } },
      [
        "the captured requests were cleared at 2026-11-14T10:00:00.000Z (network.clear or --clear), so the trace is missing the ones before",
      ],
    ],
    [
      "dropped requests and a read cut at its limit",
      { capture: { active: true, interruptions: [], dropped: 4 }, truncatedAt: 500 },
      [
        "network capture dropped the 4 oldest requests (it keeps about 500 per tab), so the trace is missing them",
        "the trace holds only the first 500 requests read from the tab; later ones are missing",
      ],
    ],
  ])("warns at stop about %s", (_case, options, warnings) => {
    const root = tempRoot();
    const record = records.startRecord({
      site: "fixture",
      op: "read",
      tabId: 1,
      network: true,
      root,
    });
    const page = {
      id: "r_1",
      method: "GET",
      status: 200,
      type: "Document",
      url: "https://example.test/",
    };
    records.attachNetworkTrace(record.id, [page], root, options);
    const stopped = records.stopRecord({ target: TAB, root });
    expect(stopped.warnings).toEqual(warnings);
    expect(stopped.record.trace).toMatchObject({ count: 1 });
  });
});

describe("record ownership", () => {
  const commands = (recordId: string, root: string) =>
    records
      .readEvents(recordId, root)
      .map(
        (event: { command?: string; label?: string; event?: string }) =>
          event.command || event.label || event.event,
      );

  it("records only the starting session's tool events, alongside other sessions' records", () => {
    const root = tempRoot();
    const alpha = records.startRecord({ site: "a", op: "read", tabId: 11, session: "alpha", root });
    const beta = records.startRecord({ site: "b", op: "read", tabId: 22, session: "beta", root });
    const append = (command: string, target: Entry) =>
      records.appendRecordEvent(completed(command), { target, root });
    append("navigate", { session: "alpha", tabId: 11 });
    append("click", { session: "beta", tabId: 22 });
    expect(append("type", { session: "gamma", tabId: 33 })).toBe(false);
    // An unnamed caller on alpha's tab is not alpha.
    expect(append("key", { tabId: 11 })).toBe(false);
    // Page events from the watcher carry only the tab.
    records.appendRecordEvent(
      { type: "browser.event", event: "input" },
      { target: { tabId: 11, page: true }, root },
    );
    records.markRecord("alpha step", { target: { session: "alpha", tabId: 11 }, root });
    expect(commands(alpha.id, root)).toEqual(["navigate", "input", "alpha step"]);
    expect(commands(beta.id, root)).toEqual(["click"]);
  });

  it("records tab and window commands, which have no tab target, by the caller's session", () => {
    const root = tempRoot();
    const alpha = records.startRecord({ site: "a", op: "read", tabId: 11, session: "alpha", root });
    const loose = records.startRecord({ site: "b", op: "read", tabId: 22, root });
    const append = (command: string, session?: string) =>
      records.appendRecordEvent(completed(command), { target: { browser: true, session }, root });
    append("tab.new", "alpha");
    append("window.new");
    expect(append("tab.close", "beta")).toBe(false);
    expect(commands(alpha.id, root)).toEqual(["tab.new"]);
    expect(commands(loose.id, root)).toEqual(["window.new"]);
    // Without a session, the record must be the only one started without a session.
    records.startRecord({ site: "c", op: "read", tabId: 33, root });
    expect(append("tab.switch")).toBe(false);
  });

  it("refuses mark, stop, pause and discard from a session that does not own the record", () => {
    const root = tempRoot();
    const alpha = records.startRecord({ site: "a", op: "read", tabId: 11, session: "alpha", root });
    const other = { target: { session: "beta", tabId: 22 }, root };
    for (const act of [
      records.stopRecord,
      records.discardRecord,
      records.pauseRecord,
      (options: Entry) => records.markRecord("x", options),
    ]) {
      expect(() => act(other)).toThrow(/session alpha/);
    }
    expect(() => records.stopRecord({ target: { tabId: 11 }, root })).toThrow(
      /record on tab 11 belongs to session alpha/,
    );
    expect(() =>
      records.startRecord({ site: "a", op: "again", tabId: 44, session: "alpha", root }),
    ).toThrow(/already active for session alpha/);
    expect(() => records.startRecord({ site: "c", op: "read", tabId: 11, root })).toThrow(
      /already active for session alpha/,
    );
    expect(records.recordStatus(other)).toMatchObject({
      status: "idle",
      otherRecords: [{ id: alpha.id, session: "alpha", tabId: 11 }],
    });
    expect(
      records.stopRecord({ target: { session: "alpha", tabId: 11 }, root }).record.status,
    ).toBe("stopped");
    expect(records.activeRecords(root)).toEqual([]);
  });

  it("lets a session caller on its tab control a record started without a session", () => {
    const root = tempRoot();
    const record = records.startRecord({ site: "a", op: "read", tabId: 5, root });
    const alpha = { target: { session: "alpha", tabId: 5 }, root };
    expect(records.appendRecordEvent(completed("navigate"), alpha)).toBe(true);
    expect(records.markRecord("x", alpha).id).toBe(record.id);
    expect(records.stopRecord(alpha).record.status).toBe("stopped");
  });

  it("still finds a record started before records had owners, also from the session that started it", () => {
    const root = tempRoot();
    // v2.26.0 wrote { recordId } and a record with its tab but no session, even under SURF_SESSION.
    const record = records.startRecord({ site: "a", op: "read", tabId: 5, root });
    fs.writeFileSync(
      path.join(records.recordsRoot(root), "active.json"),
      JSON.stringify({ recordId: record.id }),
    );
    expect(records.recordStatus({ target: { tabId: 5 }, root })).toMatchObject({ id: record.id });
    const alpha = { target: { session: "alpha", tabId: 5 }, root };
    expect(records.recordStatus(alpha)).toMatchObject({ id: record.id });
    expect(records.appendRecordEvent(completed("navigate"), alpha)).toBe(true);
    expect(records.stopRecord(alpha).record.status).toBe("stopped");
    expect(commands(record.id, root)).toEqual(["navigate"]);
  });

  it("gives a caller without a session on another tab the only record started without a session", () => {
    const root = tempRoot();
    const record = records.startRecord({ site: "a", op: "read", tabId: 1, root });
    // After tab.new or a tab switch the caller's tab is another one, and the start tab may be closed.
    const other = { target: { tabId: 9 }, root };
    expect(records.recordStatus(other)).toMatchObject({ id: record.id });
    expect(records.appendRecordEvent(completed("navigate"), other)).toBe(true);
    expect(records.markRecord("on tab 9", other).id).toBe(record.id);
    expect(commands(record.id, root)).toEqual(["navigate", "on tab 9"]);
    expect(records.stopRecord(other).record.status).toBe("stopped");

    const again = records.startRecord({ site: "a", op: "read", tabId: 1, root });
    expect(records.discardRecord(other)).toEqual({ discarded: again.id });
  });

  it("keeps the fallback to the one record without a session, and out of session callers and session tabs", () => {
    const root = tempRoot();
    records.startRecord({ site: "a", op: "read", tabId: 11, session: "alpha", root });
    const loose = records.startRecord({ site: "b", op: "read", tabId: 1, root });
    expect(
      records.appendRecordEvent(completed("go"), { target: { session: "beta", tabId: 9 }, root }),
    ).toBe(false);
    expect(records.appendRecordEvent(completed("go"), { target: { tabId: 11 }, root })).toBe(false);
    expect(records.recordStatus({ target: { tabId: 9 }, root })).toMatchObject({ id: loose.id });
    records.startRecord({ site: "c", op: "read", tabId: 2, root });
    expect(records.appendRecordEvent(completed("go"), { target: { tabId: 9 }, root })).toBe(false);
    expect(() => records.stopRecord({ target: { tabId: 9 }, root })).toThrow(
      /no active playbook record for tab 9; active: /,
    );
  });

  it("names the session to stop a record from without suggesting --session with --tab-id", () => {
    const root = tempRoot();
    records.startRecord({ site: "a", op: "read", tabId: 11, session: "alpha", root });
    expect(() => records.stopRecord({ target: { tabId: 11 }, root })).toThrow(
      "the playbook record on tab 11 belongs to session alpha; run it with SURF_SESSION=alpha or --session alpha, without --tab-id",
    );
  });
});

describe("activity and explicit record evidence", () => {
  it("redacts normal input and keeps append-only events separate from record summary", () => {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surf-records-")), "state");
    roots.push(path.dirname(root));
    journal.journalCommand("type", { text: "top secret", selector: "#q" }, { root });
    expect(fs.readFileSync(journal.journalPath(root), "utf8")).not.toContain("top secret");

    const record = records.startRecord({ site: "fixture", op: "read", tabId: 1, root });
    records.appendRecordEvent(
      {
        type: "tool.completed",
        command: "search",
        argsRedacted: { term: "<term>" },
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        resultSummary: "success",
      },
      { target: TAB, root },
    );
    records.markRecord("opened page", { target: TAB, root });
    const stopped = records.stopRecord({ target: TAB, draft: true, root });
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

    const record = records.startRecord({ site: "fixture", op: "read", tabId: 1, root });
    records.appendRecordEvent(
      { type: "tool.issued", command: "click", argsRedacted: { selector: "#go" } },
      { target: TAB, root },
    );
    records.appendRecordEvent(
      { type: "tool.completed", command: "click", argsRedacted: { selector: "#go" } },
      { target: TAB, root },
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
    const stopped = records.stopRecord({ target: TAB, draft: true, root });
    const trace = fs.readFileSync(
      path.join(records.recordsRoot(root), record.id, "network", "trace.json"),
      "utf8",
    );
    expect(trace).not.toContain("captured-secret");
    expect(
      stopped.draft.run.find((strategy: { using: string }) => strategy.using === "workflow").steps,
    ).toHaveLength(1);
  });

  it("drafts a recorded click flow as its steps, not the last request it captured", () => {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surf-records-")), "state");
    roots.push(path.dirname(root));
    const trace = [
      { id: "r-1", method: "GET", status: 200, url: "https://example.test/pixel.gif" },
    ];
    const clicked = records.startRecord({ site: "fixture", op: "flow", tabId: 1, root });
    records.appendRecordEvent(
      { type: "tool.completed", command: "click", argsRedacted: { selector: "#go" } },
      { target: TAB, root },
    );
    records.attachNetworkTrace(clicked.id, trace, root);
    const flow = records.stopRecord({ target: TAB, draft: true, root });
    expect(flow.draft.run.map((strategy: { using: string }) => strategy.using)).toEqual([
      "workflow",
    ]);

    const read = records.startRecord({ site: "fixture", op: "read", tabId: 1, root });
    records.attachNetworkTrace(read.id, trace, root);
    const network = records.stopRecord({ target: TAB, draft: true, root });
    expect(network.draft.run.map((strategy: { using: string }) => strategy.using)).toEqual([
      "network",
    ]);
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

    records.startRecord({ site: "fixture", op: "submit", tabId: 1, root });
    records.appendRecordEvent(
      {
        type: "tool.completed",
        command: "click",
        argsRedacted: { selector: "#submit" },
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      },
      { target: TAB, root },
    );
    const stopped = records.stopRecord({ target: TAB, draft: true, root });
    expect(stopped.draft).toMatchObject({
      effect: "write",
      safety: { authorization: "explicit", duplicate: "transactional", key: ["review_key"] },
    });
    expect(() =>
      authoring.saveFromRecord({ recordId: stopped.record.id, root, home: path.dirname(root) }),
    ).not.toThrow();
  });
});
