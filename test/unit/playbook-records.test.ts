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

type Entry = Record<string, unknown>;
const TAB = { tabId: 1 };
const COMPLETE = { active: true, interruptions: [] };

function tempRoot() {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surf-records-")), "state");
  roots.push(path.dirname(root));
  return root;
}

const completed = (command: string) => ({
  type: "tool.completed",
  command,
  argsRedacted: {},
  startedAt: new Date().toISOString(),
});

/**
 * Records `commands` on tab 1, attaches `trace` when given (the record then captured the network),
 * and stops the record with `stop`'s options.
 */
function recordFlow({
  commands = [],
  trace,
  capture = COMPLETE,
  truncatedAt,
  origin = "https://example.test",
  stop = { draft: true },
}: {
  commands?: string[];
  trace?: Entry[];
  capture?: Entry;
  truncatedAt?: number;
  origin?: string;
  stop?: { draft?: boolean; read?: boolean };
}) {
  const root = tempRoot();
  const record = records.startRecord({
    site: "fixture",
    op: "search",
    tabId: 1,
    origin,
    network: trace !== undefined,
    root,
  });
  for (const command of commands) {
    records.appendRecordEvent(completed(command), { target: TAB, root });
  }
  if (trace) {
    records.attachNetworkTrace(record.id, trace, root, { capture, truncatedAt });
  }
  return { root, record, stopped: () => records.stopRecord({ target: TAB, ...stop, root }) };
}
const stopFlow = (options: Parameters<typeof recordFlow>[0]) => recordFlow(options).stopped();

const page = {
  id: "r_1",
  method: "GET",
  status: 200,
  type: "Document",
  url: "https://example.test/search?q=x",
};
const create = {
  id: "r_2",
  method: "POST",
  status: 201,
  type: "XHR",
  url: "https://example.test/api/employees?x=1",
};
const telemetry = [
  { id: "r_3", method: "POST", status: 204, type: "Ping", url: "https://example.test/beacon" },
  {
    id: "r_4",
    method: "POST",
    status: 200,
    type: "XHR",
    url: "https://www.google-analytics.com/g/collect?v=2",
  },
  {
    id: "r_5",
    method: "POST",
    status: 202,
    type: "Fetch",
    url: "https://o1.ingest.sentry.io/api/1/envelope/",
  },
];
const sentryCreate = {
  id: "r_6",
  method: "POST",
  status: 201,
  type: "XHR",
  url: "https://sentry.io/api/0/teams/acme/core/projects/",
};
const at = Date.parse("2026-11-14T10:00:00Z");

describe("record network trace", () => {
  it("keeps requests captured after the record started whatever clock stamped them", () => {
    const startedAt = "2026-11-14T10:00:00.000Z";
    const kept = records.traceEntriesForRecord({ startedAt }, [
      { id: "r_before", ts: at - 5000 },
      { id: "r_after", ts: at + 1500 },
      // Extensions before the fix stamped `ts` with Chrome's monotonic clock (ms since boot).
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
      { capture: { ...COMPLETE, clearedAt: at } },
      [
        "the captured requests were cleared at 2026-11-14T10:00:00.000Z (network.clear or --clear), so the trace is missing the ones before",
      ],
    ],
    [
      "dropped requests and a read cut at its limit",
      { capture: { ...COMPLETE, dropped: 4 }, truncatedAt: 500 },
      [
        "network capture dropped the 4 oldest requests (it keeps about 500 per tab), so the trace is missing them",
        "the trace holds only the first 500 requests read from the tab; later ones are missing",
      ],
    ],
  ])("marks the trace incomplete and warns about %s", (_case, options, warnings) => {
    const stopped = stopFlow({ trace: [page], stop: {}, ...options });
    expect(stopped.warnings).toEqual(warnings);
    expect(stopped.record.trace).toMatchObject({ count: 1, complete: false });
  });
});

describe("draft effect and pb record stop --read", () => {
  it.each([
    ["a click draft defaults to a write", { commands: ["type", "click"], trace: [page] }, "write"],
    [
      "a captured write makes a draft without clicks a write",
      { commands: ["navigate"], trace: [page, create] },
      "write",
    ],
    [
      "--read gives a read",
      { commands: ["type", "click"], trace: [page], stop: { draft: true, read: true } },
      "read",
    ],
    [
      "an analytics POST doesn't block --read",
      { commands: ["click"], trace: [page, ...telemetry], stop: { draft: true, read: true } },
      "read",
    ],
    [
      "a vendor's request from another site's page is telemetry",
      {
        commands: ["click"],
        trace: [page, { ...sentryCreate, tabUrl: "https://example.test/" }],
        stop: { draft: true, read: true },
      },
      "read",
    ],
  ])("%s", (_case, options, effect) => {
    const { draft } = stopFlow(options);
    expect(draft.effect).toBe(effect);
    expect(draft.safety === undefined).toBe(effect === "read");
  });

  it.each([
    [
      "a captured write",
      { trace: [page, create] },
      /--read refused: the record captured POST https:\/\/example\.test\/api\/employees, which can change data/,
    ],
    [
      "the vendor's own site (record origin)",
      { trace: [sentryCreate], origin: "https://sentry.io" },
      /captured POST https:\/\/sentry\.io/,
    ],
    [
      "the vendor's own site (sending page)",
      { trace: [{ ...sentryCreate, tabUrl: "https://sentry.io/organizations/acme/" }] },
      /captured POST https:\/\/sentry\.io/,
    ],
    [
      "a vendor host with no known site",
      { trace: [sentryCreate], origin: "" },
      /captured POST https:\/\/sentry\.io/,
    ],
    ["a record without --network", {}, /--read needs a record started with --network/],
    [
      "a cookie step, which acts beyond the page",
      { trace: [page], commands: ["click", "cookie.set"] },
      /--read refused: the record ran cookie\.set, which acts beyond the page/,
    ],
    [
      "a tab step, which acts beyond the page",
      { trace: [page], commands: ["type", "tab.close"] },
      /--read refused: the record ran tab\.close, which acts beyond the page/,
    ],
  ])("refuses --read because of %s, leaving the record recording", (_case, options, error) => {
    const flow = recordFlow({ commands: ["click"], stop: { draft: true, read: true }, ...options });
    expect(flow.stopped).toThrow(error);
    expect(records.recordStatus({ target: TAB, root: flow.root }).status).toBe("recording");
  });

  it("refuses --read without --draft", () => {
    expect(() => stopFlow({ trace: [page], stop: { read: true } })).toThrow(
      /--read applies only with --draft/,
    );
  });

  it("accepts --read on an incomplete trace with a warning", () => {
    const stopped = stopFlow({
      commands: ["click"],
      trace: [page],
      capture: { ...COMPLETE, dropped: 4 },
      stop: { draft: true, read: true },
    });
    expect(stopped.draft.effect).toBe("read");
    expect(stopped.warnings).toContain(
      "--read could not check every request: the trace is incomplete (see the warnings above)",
    );
  });

  it("gives a draft no network strategy when the request it picks is telemetry, and a read no write strategy", () => {
    // The last 2xx/3xx request (the rule main uses) is the error-reporting POST.
    const stopped = stopFlow({
      commands: ["click"],
      trace: [page, ...telemetry],
      stop: { draft: true, read: true },
    });
    expect(stopped.draft.run.map((strategy: { using: string }) => strategy.using)).toEqual([
      "workflow",
    ]);
    expect(stopped.warnings).toEqual([
      "the draft has no network strategy: the request it would replay, POST https://o1.ingest.sentry.io/api/1/envelope/, is telemetry",
    ]);
    for (const trace of [
      [...telemetry, page],
      [page, create],
    ]) {
      const read = trace.includes(create) ? undefined : true;
      const { draft } = stopFlow({ commands: ["click"], trace, stop: { draft: true, read } });
      const network = draft.run.find((strategy: { using: string }) => strategy.using === "network");
      if (draft.effect === "read") {
        expect(["GET", "HEAD", "OPTIONS"]).toContain(network.request.method);
      }
      expect(network.request.url).toBe(trace.at(-1)?.url.split("?")[0]);
    }
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

  it("refuses mark, stop and discard from a session that does not own the record", () => {
    const root = tempRoot();
    const alpha = records.startRecord({ site: "a", op: "read", tabId: 11, session: "alpha", root });
    const other = { target: { session: "beta", tabId: 22 }, root };
    for (const act of [
      records.stopRecord,
      records.discardRecord,
      records.pauseRecord,
      (o: Entry) => records.markRecord("x", o),
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

  it("still finds a record started before records had owners", () => {
    const root = tempRoot();
    const record = records.startRecord({ site: "a", op: "read", tabId: 5, root });
    fs.writeFileSync(
      path.join(records.recordsRoot(root), "active.json"),
      JSON.stringify({ recordId: record.id }),
    );
    expect(records.recordStatus({ target: { tabId: 5 }, root })).toMatchObject({ id: record.id });
  });
});

describe("activity and explicit record evidence", () => {
  it("redacts normal input and keeps append-only events separate from record summary", () => {
    const root = tempRoot();
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
    const root = tempRoot();
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

  it("does not turn recent or recorded page writes into an unreviewed read op", () => {
    const root = tempRoot();
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
