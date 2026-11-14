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

describe("record network trace", () => {
  it("keeps requests captured after the record started whatever clock stamped them", () => {
    const startedAt = "2026-11-14T10:00:00.000Z";
    const start = Date.parse(startedAt);
    const kept = records.traceEntriesForRecord({ startedAt }, [
      { id: "r_before", ts: start - 5000 },
      { id: "r_after", ts: start + 1500 },
      // Extensions before the fix stamped `ts` with Chrome's monotonic clock (ms since boot).
      { id: "r_monotonic", ts: 1_160_000_500 },
    ]);
    expect(kept.map((entry: { id: string }) => entry.id)).toEqual(["r_after", "r_monotonic"]);
  });
});

describe("record network capture gaps", () => {
  it("says when capture was interrupted and stops trusting the trace to clear page writes", () => {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surf-records-")), "state");
    roots.push(path.dirname(root));
    const record = records.startRecord({
      site: "fixture",
      op: "search",
      tabId: 1,
      network: true,
      root,
    });
    records.appendRecordEvent(
      { type: "tool.completed", command: "click", argsRedacted: {} },
      { target: { tabId: 1 }, root },
    );
    const at = Date.parse("2026-11-14T10:00:00Z");
    records.attachNetworkTrace(
      record.id,
      [{ id: "r_1", method: "GET", status: 200, url: "https://example.test/search" }],
      root,
      {
        capture: {
          active: true,
          interruptions: [{ reason: "target_closed", at, resumedAt: at + 5000 }],
        },
      },
    );
    const stopped = records.stopRecord({ target: { tabId: 1 }, draft: true, root });
    expect(stopped.warnings).toEqual([
      "network capture was interrupted at 2026-11-14T10:00:00.000Z (debugger detached: target_closed) until 2026-11-14T10:00:05.000Z; requests in between were not captured",
    ]);
    expect(stopped.record.trace).toMatchObject({ count: 1, complete: false });
    expect(stopped.draft.effect).toBe("write");
  });

  it("says when capture was not running at stop and was never seen to stop", () => {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surf-records-")), "state");
    roots.push(path.dirname(root));
    const record = records.startRecord({
      site: "fixture",
      op: "search",
      tabId: 1,
      network: true,
      root,
    });
    records.attachNetworkTrace(record.id, [], root, {
      capture: { active: false, interruptions: [] },
    });
    expect(records.stopRecord({ target: { tabId: 1 }, root }).warnings).toEqual([
      "network capture was not running when the record stopped (the extension may have restarted); requests may be missing",
    ]);
  });
});

describe("record ownership", () => {
  const tempRoot = () => {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surf-records-")), "state");
    roots.push(path.dirname(root));
    return root;
  };
  const completed = (command: string) => ({
    type: "tool.completed",
    command,
    argsRedacted: {},
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
  });
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
    records.appendRecordEvent(completed("navigate"), {
      target: { session: "alpha", tabId: 11 },
      root,
    });
    records.appendRecordEvent(completed("click"), { target: { session: "beta", tabId: 22 }, root });
    expect(
      records.appendRecordEvent(completed("type"), {
        target: { session: "gamma", tabId: 33 },
        root,
      }),
    ).toBe(false);
    // An unnamed caller on alpha's tab is not alpha.
    expect(records.appendRecordEvent(completed("key"), { target: { tabId: 11 }, root })).toBe(
      false,
    );
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
    records.appendRecordEvent(completed("tab.new"), {
      target: { browser: true, session: "alpha" },
      root,
    });
    records.appendRecordEvent(completed("window.new"), { target: { browser: true }, root });
    expect(
      records.appendRecordEvent(completed("tab.close"), {
        target: { browser: true, session: "beta" },
        root,
      }),
    ).toBe(false);
    expect(commands(alpha.id, root)).toEqual(["tab.new"]);
    expect(commands(loose.id, root)).toEqual(["window.new"]);

    // Without a session, the record must be the only one started without a session.
    records.startRecord({ site: "c", op: "read", tabId: 33, root });
    expect(
      records.appendRecordEvent(completed("tab.switch"), { target: { browser: true }, root }),
    ).toBe(false);
  });

  it("refuses mark, stop and discard from a session that does not own the record", () => {
    const root = tempRoot();
    const alpha = records.startRecord({ site: "a", op: "read", tabId: 11, session: "alpha", root });
    const other = { target: { session: "beta", tabId: 22 }, root };
    expect(() => records.markRecord("x", other)).toThrow(/session alpha/);
    expect(() => records.stopRecord(other)).toThrow(/session alpha/);
    expect(() => records.discardRecord(other)).toThrow(/session alpha/);
    expect(() => records.pauseRecord(other)).toThrow(/session alpha/);
    expect(() => records.stopRecord({ target: { tabId: 11 }, root })).toThrow(
      /record on tab 11 belongs to session alpha/,
    );
    expect(() =>
      records.startRecord({ site: "a", op: "again", tabId: 44, session: "alpha", root }),
    ).toThrow(/already active for session alpha/);
    expect(() => records.startRecord({ site: "c", op: "read", tabId: 11, root })).toThrow(
      /already active for session alpha/,
    );
    expect(records.recordStatus({ target: { session: "beta", tabId: 22 }, root })).toMatchObject({
      status: "idle",
      otherRecords: [{ id: alpha.id, session: "alpha", tabId: 11 }],
    });
    expect(
      records.stopRecord({ target: { session: "alpha", tabId: 11 }, root }).record.status,
    ).toBe("stopped");
    expect(records.activeRecords(root)).toEqual([]);
  });

  it("still finds a record started before records had owners", () => {
    const root = tempRoot();
    const record = records.startRecord({ site: "a", op: "read", tabId: 5, root });
    const activePath = path.join(records.recordsRoot(root), "active.json");
    fs.writeFileSync(activePath, JSON.stringify({ recordId: record.id }));
    expect(records.recordStatus({ target: { tabId: 5 }, root })).toMatchObject({ id: record.id });
  });
});

describe("draft effect", () => {
  const draft = ({
    commands,
    trace,
    origin = "https://example.test",
    capture = { active: true, interruptions: [] },
  }: {
    commands: string[];
    trace?: Array<Record<string, unknown>>;
    origin?: string;
    capture?: Record<string, unknown>;
  }) => {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surf-records-")), "state");
    roots.push(path.dirname(root));
    const record = records.startRecord({
      site: "fixture",
      op: "search",
      tabId: 1,
      origin,
      network: trace !== undefined,
      root,
    });
    for (const command of commands) {
      records.appendRecordEvent(
        { type: "tool.completed", command, argsRedacted: {}, startedAt: new Date().toISOString() },
        { target: { tabId: 1 }, root },
      );
    }
    if (trace) {
      records.attachNetworkTrace(record.id, trace, root, { capture });
    }
    return records.stopRecord({ target: { tabId: 1 }, draft: true, root }).draft;
  };
  const search = {
    id: "r_1",
    method: "GET",
    status: 200,
    type: "Document",
    url: "https://example.test/search?q=x",
  };
  const telemetry = [
    { id: "r_2", method: "POST", status: 204, type: "Ping", url: "https://example.test/beacon" },
    {
      id: "r_3",
      method: "POST",
      status: 200,
      type: "XHR",
      url: "https://www.google-analytics.com/g/collect?v=2",
    },
    {
      id: "r_4",
      method: "POST",
      status: 202,
      type: "Fetch",
      url: "https://o1.ingest.sentry.io/api/1/envelope/",
    },
  ];

  it("drafts a search done by typing and clicking as a read when it sent only reads and telemetry", () => {
    const op = draft({ commands: ["type", "click", "key"], trace: [search, ...telemetry] });
    expect(op.effect).toBe("read");
    expect(op.safety).toBeUndefined();
    expect(op.args.review_key).toBeUndefined();
  });

  it("adds no network strategy when the request it picks is telemetry, and never a write strategy to a read", () => {
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surf-records-")), "state");
    roots.push(path.dirname(root));
    const record = records.startRecord({
      site: "fixture",
      op: "search",
      tabId: 1,
      origin: "https://example.test",
      network: true,
      root,
    });
    records.appendRecordEvent(
      { type: "tool.completed", command: "click", argsRedacted: {} },
      { target: { tabId: 1 }, root },
    );
    // The last 2xx/3xx request is the error-reporting POST, as on main.
    records.attachNetworkTrace(record.id, [search, ...telemetry], root, {
      capture: { active: true, interruptions: [] },
    });
    const stopped = records.stopRecord({ target: { tabId: 1 }, draft: true, root });
    expect(stopped.draft.effect).toBe("read");
    expect(stopped.draft.run.map((strategy: { using: string }) => strategy.using)).toEqual([
      "workflow",
    ]);
    for (const strategy of stopped.draft.run.filter(
      (item: { using: string }) => item.using === "network",
    )) {
      expect(["GET", "HEAD", "OPTIONS"]).toContain(strategy.request.method);
    }
    expect(stopped.warnings).toEqual([
      "the draft has no network strategy: the request it would replay, POST https://o1.ingest.sentry.io/api/1/envelope/, is telemetry",
    ]);
    // Picking stays the same rule: when the last request is the search, the search is replayed.
    expect(draft({ commands: ["click"], trace: [...telemetry, search] }).run[0]).toMatchObject({
      using: "network",
      request: { method: "GET", url: "https://example.test/search" },
    });
  });

  it("drafts a write when the flow sent a request that can change data", () => {
    const create = {
      id: "r_5",
      method: "POST",
      status: 201,
      type: "XHR",
      url: "https://example.test/api/employees",
    };
    const op = draft({ commands: ["type", "click"], trace: [search, ...telemetry, create] });
    expect(op).toMatchObject({ effect: "write", safety: { authorization: "explicit" } });
    expect(op.run[0]).toMatchObject({
      using: "network",
      request: { method: "POST", url: "https://example.test/api/employees" },
    });
    expect(
      draft({ commands: ["click"], trace: [{ ...create, method: "DELETE", status: 0 }] }).effect,
    ).toBe("write");
  });

  it("treats an analytics vendor's own site as the site, not as telemetry", () => {
    const dashboard = {
      id: "r_6",
      method: "POST",
      status: 201,
      type: "XHR",
      url: "https://us.posthog.com/api/projects/1/dashboards/",
    };
    expect(
      draft({ commands: ["click"], trace: [dashboard], origin: "https://us.posthog.com" }).effect,
    ).toBe("write");
    expect(
      draft({ commands: ["click"], trace: [dashboard], origin: "https://app.posthog.com" }).effect,
    ).toBe("write");
    expect(draft({ commands: ["click"], trace: [dashboard] }).effect).toBe("read");
  });

  it("keeps page writes as writes when the trace dropped requests or hit the read limit", () => {
    expect(
      draft({
        commands: ["click"],
        trace: [search],
        capture: { active: true, interruptions: [], dropped: 4 },
      }).effect,
    ).toBe("write");
    const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surf-records-")), "state");
    roots.push(path.dirname(root));
    const record = records.startRecord({
      site: "fixture",
      op: "search",
      tabId: 1,
      network: true,
      root,
    });
    records.appendRecordEvent(
      { type: "tool.completed", command: "click", argsRedacted: {} },
      { target: { tabId: 1 }, root },
    );
    records.attachNetworkTrace(record.id, [search], root, {
      capture: { active: true, interruptions: [], dropped: 4 },
      truncatedAt: 500,
    });
    const stopped = records.stopRecord({ target: { tabId: 1 }, draft: true, root });
    expect(stopped.record.trace.complete).toBe(false);
    expect(stopped.warnings).toEqual([
      "network capture dropped the 4 oldest requests (it keeps about 500 per tab), so the trace is missing them",
      "the trace holds only the first 500 requests read from the tab; later ones are missing",
    ]);
    expect(stopped.draft.effect).toBe("write");
  });

  it("keeps page writes as writes when the page opened a WebSocket, which can carry writes", () => {
    const socket = {
      id: "r_7",
      method: "GET",
      type: "WebSocket",
      url: "wss://example.test/socket",
    };
    expect(draft({ commands: ["click"], trace: [search, socket] }).effect).toBe("write");
    expect(draft({ commands: ["navigate"], trace: [search, socket] }).effect).toBe("read");
  });

  it("keeps page writes as writes without network evidence or when they act beyond the page", () => {
    expect(draft({ commands: ["click"] }).effect).toBe("write");
    expect(draft({ commands: ["click", "cookie.set"], trace: [search] }).effect).toBe("write");
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
      { target: { tabId: 1 }, root },
    );
    records.markRecord("opened page", { target: { tabId: 1 }, root });
    const stopped = records.stopRecord({ target: { tabId: 1 }, draft: true, root });
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
      { target: { tabId: 1 }, root },
    );
    journal.journalCommand(
      "navigate",
      { url: "https://example.test/?access_token=captured-secret&q=ok" },
      { target: { tabId: 1 }, root },
    );
    journal.journalCommand("unknown.tool", { text: "do not record" }, { root });
    const recent = fs.readFileSync(journal.journalPath(root), "utf8");
    expect(recent).not.toContain("top secret");
    expect(recent).not.toContain("do not record");

    const record = records.startRecord({ site: "fixture", op: "read", tabId: 1, root });
    records.appendRecordEvent(
      { type: "tool.issued", command: "click", argsRedacted: { selector: "#go" } },
      { target: { tabId: 1 }, root },
    );
    records.appendRecordEvent(
      { type: "tool.completed", command: "click", argsRedacted: { selector: "#go" } },
      { target: { tabId: 1 }, root },
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
    const stopped = records.stopRecord({ target: { tabId: 1 }, draft: true, root });
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

    records.startRecord({ site: "fixture", op: "submit", tabId: 1, root });
    records.appendRecordEvent(
      {
        type: "tool.completed",
        command: "click",
        argsRedacted: { selector: "#submit" },
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      },
      { target: { tabId: 1 }, root },
    );
    const stopped = records.stopRecord({ target: { tabId: 1 }, draft: true, root });
    expect(stopped.draft).toMatchObject({
      effect: "write",
      safety: { authorization: "explicit", duplicate: "transactional", key: ["review_key"] },
    });
    expect(() =>
      authoring.saveFromRecord({ recordId: stopped.record.id, root, home: path.dirname(root) }),
    ).not.toThrow();
  });
});
