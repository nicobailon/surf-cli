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

// A step is a command name, or [name, args] for a command whose effect depends on its arguments.
type Step = string | [string, Entry];
const step = (command: string, args: Entry): Step => [command, args];
const completed = (item: Step) => ({
  type: "tool.completed",
  command: typeof item === "string" ? item : item[0],
  argsRedacted: typeof item === "string" ? {} : item[1],
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
  pageText,
  stop = { draft: true },
}: {
  commands?: Step[];
  trace?: Entry[];
  capture?: Entry | null;
  truncatedAt?: number;
  origin?: string;
  pageText?: string;
  stop?: { draft?: boolean; read?: boolean; requestId?: string };
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
    records.attachNetworkTrace(record.id, trace, root, { capture, truncatedAt, pageText });
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
      "an extension too old to report capture status",
      { capture: null },
      [
        "the extension did not report whether network capture ran (it may be older than this Surf); requests may be missing",
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
      "a locate click is a write",
      { commands: [step("locate.role", { role: "button", action: "click" })], trace: [page] },
      "write",
    ],
    [
      "a locate read stays a read",
      { commands: [step("locate.text", { action: "text" })], trace: [page] },
      "read",
    ],
    [
      "--read accepts a locate fill as a page step",
      {
        commands: [step("locate.label", { action: "fill" })],
        trace: [page],
        stop: { draft: true, read: true },
      },
      "read",
    ],
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
      "a POST answered with JavaScript",
      {
        trace: [
          page,
          {
            ...create,
            type: "XHR",
            mimeType: "text/javascript",
            url: "https://example.test/cart/add",
          },
        ],
      },
      /--read refused: the record captured POST https:\/\/example\.test\/cart\/add/,
    ],
    [
      "a POST replay, which acts beyond the page",
      { trace: [page], commands: [step("network.replay", { id: "r_1", "allow-post": true })] },
      /--read refused: the record ran network\.replay, which acts beyond the page/,
    ],
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

  it("never replays a page asset (image, script, stylesheet, font, media)", () => {
    const search = {
      id: "r_7",
      method: "GET",
      status: 200,
      type: "XHR",
      url: "https://example.test/api/search?q=x",
    };
    const assets = ["Image", "Stylesheet", "Script", "Font", "Media"].map((type, index) => ({
      id: `r_a${index}`,
      method: "GET",
      status: 200,
      type,
      url: `https://example.test/asset-${index}`,
    }));
    const { draft } = stopFlow({
      commands: ["click"],
      trace: [search, ...assets],
      stop: { draft: true, read: true },
    });
    expect(draft.run[0]).toMatchObject({
      using: "network",
      request: { url: "https://example.test/api/search" },
    });
  });

  it("replays the top-ranked request, not the last, and never telemetry", () => {
    // The last 2xx/3xx request (the rule before ranking) is the error-reporting POST.
    const stopped = stopFlow({
      commands: ["click"],
      trace: [page, ...telemetry],
      stop: { draft: true, read: true },
    });
    expect(stopped.draft.run[0]).toMatchObject({
      using: "network",
      request: { method: "GET", url: "https://example.test/search" },
    });
    expect(stopped.warnings).toBeUndefined();
    // A write draft replays the write it captured, the request that holds its effect.
    const { draft } = stopFlow({ commands: ["click"], trace: [create, page] });
    expect(draft.effect).toBe("write");
    expect(draft.run[0].request).toMatchObject({
      method: "POST",
      url: "https://example.test/api/employees",
    });
  });
});

describe("choosing the draft's request", () => {
  const PAGE_TEXT =
    "Results for shoes: Runner Pro trainers, Trail Blazer boots, City Walker sneakers, Summit hiking shoes";
  const json = (id: string, url: string, value: unknown, extra: Entry = {}) => {
    const body = JSON.stringify(value);
    return {
      id,
      method: "GET",
      status: 200,
      type: "XHR",
      mimeType: "application/json",
      url,
      responseBody: body,
      bodyCapture: { mode: "text", complete: true, capturedBytes: body.length },
      ...extra,
    };
  };
  const products = json("r_products", "https://example.test/api/search?q=shoes", {
    items: [
      { name: "Runner Pro trainers", session_token: "s3cr3t-value" },
      { name: "Trail Blazer boots" },
      { name: "City Walker sneakers" },
    ],
  });
  const banner = json("r_banner", "https://example.test/static/announcements.json", {
    banner: { text: "Free shipping this week on everything in the store".repeat(3) },
  });
  const font = {
    id: "r_font",
    method: "GET",
    status: 200,
    type: "Font",
    url: "https://example.test/f.woff2",
  };
  const preflight = {
    id: "r_preflight",
    method: "OPTIONS",
    status: 204,
    type: "Preflight",
    url: "https://example.test/api/search",
  };
  const networkRequest = (draft: { run: { using: string; request?: Entry }[] }) =>
    draft.run.find((strategy) => strategy.using === "network")?.request;

  it("keeps only the structure of each response in the trace: no values, no text", () => {
    const { root, record } = recordFlow({ trace: [products, font], pageText: PAGE_TEXT });
    const trace = JSON.parse(
      fs.readFileSync(
        path.join(records.recordsRoot(root), record.id, "network", "trace.json"),
        "utf8",
      ),
    );
    expect(trace.entries[0].responseBody).toBe("<response-body>");
    expect(trace.entries[0].responseSummary).toEqual({
      kind: "json",
      bytes: expect.any(Number),
      records: 3,
      fields: 1,
      types: { array: 1 },
      overlap: expect.any(Number),
    });
    expect(trace.entries[0].responseSummary.overlap).toBeGreaterThan(0);
    expect(JSON.stringify(trace)).not.toContain("Runner Pro");
    expect(JSON.stringify(trace)).not.toContain(PAGE_TEXT);
    expect(trace.entries[1]).not.toHaveProperty("responseSummary");
  });

  it("writes no response values to any file a record, its draft or a saved playbook makes", () => {
    const NAME = "Jane Placeholder";
    const EMAIL = "jane.placeholder@example.test";
    const ACCOUNT = "GB29NWBK60161331926819";
    const USERNAME = "jane_placeholder";
    const people = json("r_people", "https://example.test/api/people", {
      people: [
        { name: NAME, email: EMAIL, account: ACCOUNT },
        { name: "Runner Pro", email: "x", account: "y" },
      ],
    });
    // Keys can be data: a map keyed by account number, and one keyed by username.
    const accounts = json("r_accounts", "https://example.test/api/accounts", {
      [ACCOUNT]: { balance: 10 },
      [USERNAME]: { followers: 3 },
    });
    const profile = {
      id: "r_profile",
      method: "GET",
      status: 200,
      type: "Document",
      mimeType: "text/html",
      url: "https://example.test/profile",
      responseBody: `<html><body><h1>${NAME}</h1><p>${EMAIL}</p><p>Account ${ACCOUNT}</p></body></html>`,
    };
    const { root, record } = recordFlow({
      commands: ["click"],
      trace: [profile, people, accounts],
      pageText: `${NAME} ${EMAIL} ${ACCOUNT} ${PAGE_TEXT}`,
    });
    records.stopRecord({ target: TAB, draft: true, read: true, root });
    const home = path.dirname(root);
    authoring.saveFromRecord({ recordId: record.id, requestId: "r_profile", root, home });
    const written = fs
      .readdirSync(home, { recursive: true, withFileTypes: true })
      .filter((entry: { isFile: () => boolean }) => entry.isFile())
      .map((entry: { parentPath: string; name: string }) =>
        fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8"),
      )
      .join("\n");
    expect(written).toContain(record.id);
    for (const value of [NAME, EMAIL, ACCOUNT, USERNAME]) {
      expect(written).not.toContain(value);
    }
  });

  it("drafts the top-ranked read: the JSON results, not the later banner, font or preflight", () => {
    const { draft, warnings } = stopFlow({
      commands: ["click"],
      trace: [page, products, banner, font, preflight],
      pageText: PAGE_TEXT,
      stop: { draft: true, read: true },
    });
    expect(networkRequest(draft)).toMatchObject({
      url: "https://example.test/api/search",
      query: { q: "shoes" },
    });
    expect(warnings).toBeUndefined();
  });

  it("warns when the pick ties or nearly ties with the next read, pointing at pb record candidates", () => {
    const more = json("r_more", "https://example.test/api/related?q=shoes", {
      items: [{ name: "Summit hiking shoes" }, { name: "Runner Pro trainers" }],
    });
    const { draft, warnings, record } = stopFlow({
      commands: ["click"],
      trace: [products, more],
      pageText: PAGE_TEXT,
      stop: { draft: true, read: true },
    });
    expect(networkRequest(draft)).toMatchObject({ url: "https://example.test/api/related" });
    expect(warnings).toEqual([
      `the draft's network strategy, GET https://example.test/api/related (score 12), ties with GET https://example.test/api/search (score 12); run surf pb record candidates ${record.id} and choose with --request-id`,
    ]);
  });

  it("warns when it picks a document too large to compare with the page over a JSON with records", () => {
    const bigPage = {
      id: "r_page",
      method: "GET",
      status: 200,
      type: "Document",
      mimeType: "text/html",
      url: "https://example.test/search?q=shoes",
      bodyCapture: { mode: "text", complete: false, reason: "per-body-cap", sizeBytes: 248_000 },
    };
    const stock = json("r_stock", "https://cdn.other.test/api/stock?q=shoes", {
      levels: [
        { sku: 1, n: 4 },
        { sku: 2, n: 0 },
        { sku: 3, n: 9 },
      ],
    });
    const { draft, warnings, record } = stopFlow({
      commands: ["click"],
      trace: [bigPage, stock],
      pageText: PAGE_TEXT,
      stop: { draft: true, read: true },
    });
    expect(networkRequest(draft)).toMatchObject({ url: "https://example.test/search" });
    expect(warnings).toEqual([
      `the draft's network strategy, GET https://example.test/search (score 6), is a document too large to compare with the page (per-body-cap), and GET https://cdn.other.test/api/stock (score 2) holds 3 records; run surf pb record candidates ${record.id} and choose with --request-id`,
    ]);
  });

  it("warns when the best request scores low, pointing at pb record candidates", () => {
    const thirdParty = {
      id: "r_x",
      method: "GET",
      status: 200,
      type: "XHR",
      url: "https://cdn.other.test/x",
    };
    const { draft, warnings, record } = stopFlow({
      commands: ["click"],
      trace: [thirdParty],
      stop: { draft: true, read: true },
    });
    expect(networkRequest(draft)).toMatchObject({ url: "https://cdn.other.test/x" });
    expect(warnings).toEqual([
      `the draft's network strategy, GET https://cdn.other.test/x, is a weak match (score -2); run surf pb record candidates ${record.id} and choose with --request-id`,
    ]);
  });

  it("gives a draft no network strategy when only telemetry, assets and preflights were captured", () => {
    const { draft, warnings } = stopFlow({
      commands: ["click"],
      trace: [font, preflight, ...telemetry],
      stop: { draft: true, read: true },
    });
    expect(draft.run.map((strategy: { using: string }) => strategy.using)).toEqual(["workflow"]);
    expect(warnings).toEqual([
      "the draft has no network strategy: the trace holds no request it can replay (telemetry, page assets and preflights are never replayed)",
    ]);
  });

  it("replays the request chosen with --request-id", () => {
    const { draft } = stopFlow({
      commands: ["click"],
      trace: [page, products, banner],
      pageText: PAGE_TEXT,
      stop: { draft: true, read: true, requestId: "r_1" },
    });
    // Neither the last request (the banner) nor the top-ranked one (the products).
    expect(networkRequest(draft)).toMatchObject({ url: "https://example.test/search" });
    expect(draft.effect).toBe("read");
  });

  it("drafts a chosen write as a write, and --read still refuses it", () => {
    const { draft } = stopFlow({
      commands: ["click"],
      trace: [create, page],
      stop: { draft: true, requestId: "r_2" },
    });
    expect(draft).toMatchObject({ effect: "write", safety: { authorization: "explicit" } });
    expect(networkRequest(draft)).toMatchObject({ method: "POST" });
    const flow = recordFlow({
      commands: ["click"],
      trace: [page, create],
      stop: { draft: true, read: true, requestId: "r_2" },
    });
    expect(flow.stopped).toThrow(/--read refused: the record captured POST/);
  });

  it.each([
    [
      "an id not in the trace",
      "r_missing",
      /request r_missing is not in the trace of rec-[^;]+; run surf pb record candidates/,
    ],
    [
      "telemetry",
      "r_4",
      /request r_4 \(POST https:\/\/www\.google-analytics\.com\/g\/collect\) is telemetry; a draft never replays it/,
    ],
    [
      "a page asset",
      "r_font",
      /request r_font \(GET https:\/\/example\.test\/f\.woff2\) is a page asset \(Font\); a draft never replays it/,
    ],
    [
      "a preflight",
      "r_preflight",
      /request r_preflight .* is a CORS preflight; a draft never replays it/,
    ],
  ])("refuses --request-id for %s, leaving the record recording", (_case, requestId, error) => {
    const flow = recordFlow({
      commands: ["click"],
      trace: [page, font, preflight, ...telemetry],
      stop: { draft: true, requestId },
    });
    expect(flow.stopped).toThrow(error);
    expect(records.recordStatus({ target: TAB, root: flow.root }).status).toBe("recording");
  });

  it("never gives a write draft a read to replay in place of a write it can't replay", () => {
    const update = {
      id: "r_put",
      method: "PUT",
      status: 200,
      type: "XHR",
      url: "https://example.test/api/employees/7",
    };
    const reload = { ...page, id: "r_get", url: "https://example.test/api/employees/7" };
    const { draft, warnings } = stopFlow({ commands: ["click"], trace: [update, reload] });
    expect(draft.effect).toBe("write");
    expect(draft.run.map((strategy: { using: string }) => strategy.using)).toEqual(["workflow"]);
    expect(warnings).toEqual([
      "the draft has no network strategy: it is a write because of PUT https://example.test/api/employees/7, which is a PUT (a draft replays only GET, HEAD and POST), and a write draft never replays a read in its place",
    ]);
    const chooseRead = recordFlow({
      commands: ["click"],
      trace: [update, reload],
      stop: { draft: true, requestId: "r_get" },
    });
    expect(chooseRead.stopped).toThrow(
      "request r_get (GET https://example.test/api/employees/7) is a read, but the record captured PUT https://example.test/api/employees/7, which makes the draft a write; a write draft replays its write, never a read",
    );
    const choosePut = recordFlow({
      commands: ["click"],
      trace: [update, reload],
      stop: { draft: true, requestId: "r_put" },
    });
    expect(choosePut.stopped).toThrow(
      "request r_put (PUT https://example.test/api/employees/7) is a PUT (a draft replays only GET, HEAD and POST); a draft never replays it",
    );
  });

  it("refuses --request-id without --draft", () => {
    expect(() => stopFlow({ trace: [page], stop: { requestId: "r_1" } })).toThrow(
      /--request-id applies only with --draft/,
    );
  });

  it("pb save --from-record --request-id redrafts with that request and keeps the draft's read", () => {
    const { root, record } = recordFlow({
      commands: ["click"],
      trace: [page, products, banner],
      pageText: PAGE_TEXT,
    });
    records.stopRecord({ target: TAB, draft: true, read: true, root });
    const home = path.dirname(root);
    const saved = authoring.saveFromRecord({
      recordId: record.id,
      requestId: "r_banner",
      root,
      home,
    });
    const op = JSON.parse(
      fs.readFileSync(path.join(saved.directory, "ops", "search.json"), "utf8"),
    );
    expect(op.effect).toBe("read");
    expect(op.run[0]).toMatchObject({
      using: "network",
      request: { url: "https://example.test/static/announcements.json" },
    });
    expect(() =>
      authoring.saveFromRecord({ recordId: record.id, requestId: "r_nope", root, home }),
    ).toThrow(/request r_nope is not in the trace/);
  });
});

describe("pb record candidates", () => {
  const trace = [
    page,
    { id: "r_font", method: "GET", status: 200, type: "Font", url: "https://example.test/f.woff2" },
  ];

  it("ranks an explicit record's trace, cut to --limit", () => {
    const { root, record } = recordFlow({ trace });
    records.stopRecord({ target: TAB, root });
    const result = records.recordCandidates(
      records.findCandidatesRecord({ recordId: record.id, target: TAB, root }),
      { root, limit: 1 },
    );
    expect(result).toMatchObject({
      recordId: record.id,
      site: "fixture",
      op: "search",
      live: false,
      total: 2,
    });
    expect(result.candidates.map((item: { id: string }) => item.id)).toEqual(["r_1"]);
  });

  it("defaults to the caller's active record, then its latest one, never another session's", async () => {
    const root = tempRoot();
    const older = records.startRecord({
      site: "a",
      op: "one",
      tabId: 11,
      session: "alpha",
      network: true,
      root,
    });
    records.stopRecord({ target: { session: "alpha", tabId: 11 }, root });
    // Records sort by start time, to the millisecond.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = records.startRecord({
      site: "a",
      op: "two",
      tabId: 11,
      session: "alpha",
      network: true,
      root,
    });
    records.stopRecord({ target: { session: "alpha", tabId: 11 }, root });
    records.startRecord({
      site: "b",
      op: "other",
      tabId: 22,
      session: "beta",
      network: true,
      root,
    });
    expect(records.findCandidatesRecord({ target: { session: "alpha", tabId: 11 }, root }).id).toBe(
      newer.id,
    );
    expect(newer.id).not.toBe(older.id);
    const active = records.startRecord({
      site: "a",
      op: "three",
      tabId: 11,
      session: "alpha",
      network: true,
      root,
    });
    expect(records.findCandidatesRecord({ target: { session: "alpha", tabId: 11 }, root }).id).toBe(
      active.id,
    );
    expect(() =>
      records.findCandidatesRecord({ target: { session: "gamma", tabId: 33 }, root }),
    ).toThrow("no playbook record for session gamma; pass a record id");
  });

  it("refuses a record id that belongs to another session or tab, saying whose it is", () => {
    const root = tempRoot();
    const alpha = records.startRecord({
      site: "a",
      op: "one",
      tabId: 11,
      session: "alpha",
      network: true,
      root,
    });
    records.stopRecord({ target: { session: "alpha", tabId: 11 }, root });
    const loose = records.startRecord({ site: "b", op: "two", tabId: 5, network: true, root });
    records.stopRecord({ target: { tabId: 5 }, root });
    const find = (recordId: string, target: Entry) => () =>
      records.findCandidatesRecord({ recordId, target, root });
    expect(find(alpha.id, { session: "beta", tabId: 22 })).toThrow(
      `record ${alpha.id} belongs to session alpha; run it with --session alpha`,
    );
    expect(find(alpha.id, { tabId: 11 })).toThrow(
      `record ${alpha.id} belongs to session alpha; run it with --session alpha`,
    );
    expect(find(loose.id, { session: "alpha", tabId: 5 })).toThrow(
      `record ${loose.id} belongs to tab 5; it was started without a session, so run it without --session or SURF_SESSION, with --tab-id 5`,
    );
    expect(find(loose.id, { tabId: 6 })).toThrow(
      `record ${loose.id} belongs to tab 5; it was started without a session, so run it without --session or SURF_SESSION, with --tab-id 5`,
    );
    expect(find(alpha.id, { session: "alpha", tabId: 99 })().id).toBe(alpha.id);
    expect(find(loose.id, { tabId: 5 })().id).toBe(loose.id);
  });

  it("ranks an active record from the entries read live, and says so", () => {
    const root = tempRoot();
    const record = records.startRecord({ site: "a", op: "one", tabId: 11, network: true, root });
    const result = records.recordCandidates(record, {
      root,
      live: { entries: trace, pageText: "" },
    });
    expect(result).toMatchObject({ live: true, total: 2 });
    expect(result.candidates[0].id).toBe("r_1");
  });

  it("shows a live sample without writing it anywhere", () => {
    const root = tempRoot();
    const record = records.startRecord({ site: "a", op: "one", tabId: 11, network: true, root });
    const body = JSON.stringify({
      people: [{ name: "Jane Placeholder" }, { name: "Max Example" }],
    });
    const result = records.recordCandidates(record, {
      root,
      live: {
        entries: [
          {
            id: "r_p",
            method: "GET",
            status: 200,
            type: "XHR",
            mimeType: "application/json",
            url: "https://a.test/p",
            responseBody: body,
          },
        ],
        pageText: "",
      },
    });
    expect(result.candidates[0].sample).toContain("Jane Placeholder");
    const written = fs
      .readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry: { isFile: () => boolean }) => entry.isFile())
      .map((entry: { parentPath: string; name: string }) =>
        fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8"),
      )
      .join("\n");
    expect(written).not.toContain("Jane Placeholder");
  });

  it("explains a record without a network trace", () => {
    const root = tempRoot();
    const record = records.startRecord({ site: "a", op: "one", tabId: 11, root });
    records.stopRecord({ target: { tabId: 11 }, root });
    expect(() => records.recordCandidates(records.readRecord(record.id, root), { root })).toThrow(
      `record ${record.id} has no network trace; start a record with --network to rank its requests`,
    );
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

  it("tells a session caller to stop a record started without a session without --session", () => {
    const root = tempRoot();
    records.startRecord({ site: "a", op: "read", tabId: 5, root });
    expect(() => records.stopRecord({ target: { session: "alpha", tabId: 5 }, root })).toThrow(
      "the playbook record on tab 5 belongs to tab 5; it was started without a session, so stop it without --session or SURF_SESSION",
    );
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

  it.each([
    ["locate.role", { role: "button", name: "Save", action: "click" }],
    ["network.replay", { id: "r_1", "allow-post": true }],
  ])("saves a write draft whose one step is a %s that writes", (command, args) => {
    const { root, stopped } = recordFlow({ commands: [step(command, args)] });
    const { draft, record } = stopped();
    expect(draft.effect).toBe("write");
    expect(() =>
      authoring.saveFromRecord({ recordId: record.id, root, home: path.dirname(root) }),
    ).not.toThrow();
  });

  it("does not save recent activity with a locate click as a read op", () => {
    const root = tempRoot();
    journal.journalCommand(
      "locate.role",
      { role: "button", name: "Save", action: "click" },
      { root },
    );
    expect(() =>
      authoring.saveFromRecent({ site: "fixture", op: "save", root, home: path.dirname(root) }),
    ).toThrow(/write-capable/);
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

describe("values typed with locate.* --action fill", () => {
  const { redactCommandArgs } = require("../../native/workflow-definition.cjs");
  const SECRET = "hunter2-S3cret!";
  const fill = {
    "locate.role": { role: "textbox", name: "Password", action: "fill", value: SECRET },
    "locate.text": { text: "Password", action: "fill", value: SECRET },
    "locate.label": { label: "Password", action: "fill", value: SECRET },
  };
  // A completed event the way the host writes it to the activity journal and the record.
  const hostEvent = (command: string, args: Entry) => ({
    type: "tool.completed",
    command,
    argsRedacted: redactCommandArgs(command, args),
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    resultSummary: "success",
  });
  // Every file under `directory`, joined, so a test can search all of it for a value.
  const everyFile = (directory: string): string =>
    fs
      .readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry: { isFile: () => boolean }) => entry.isFile())
      .map((entry: { parentPath: string; name: string }) =>
        fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8"),
      )
      .join("\n");

  it.each(Object.entries(fill))("redacts the value %s fills", (command, args) => {
    const redacted = redactCommandArgs(command, args);
    expect(JSON.stringify(redacted)).not.toContain("hunter2-S3cret!");
    expect(redacted.value).toBe("<value>");
  });

  it("redacts a --value passed with an action other than fill", () => {
    const redacted = redactCommandArgs("locate.role", {
      role: "button",
      name: "Save",
      action: "click",
      value: SECRET,
    });
    expect(JSON.stringify(redacted)).not.toContain("hunter2-S3cret!");
  });

  it.each(["click", "hover"])("leaves locate.role --action %s unchanged", (action) => {
    const args = { role: "button", name: "Save", action };
    expect(redactCommandArgs("locate.role", args)).toEqual(args);
  });

  it.each([false, true])(
    "keeps or redacts the value as type does its text (include input values: %s)",
    (includeInputValues) => {
      const typed = redactCommandArgs(
        "type",
        { selector: "#pw", text: SECRET },
        includeInputValues,
      );
      const filled = redactCommandArgs("locate.label", fill["locate.label"], includeInputValues);
      expect(typed.text).toBe(includeInputValues ? SECRET : "<text>");
      expect(filled.value).toBe(includeInputValues ? SECRET : "<value>");
    },
  );

  it("writes the value to no file a record, its draft or a saved playbook makes", () => {
    const root = tempRoot();
    const home = path.dirname(root);
    const args = fill["locate.label"];
    journal.journalCommand("locate.label", args, { root });
    const record = records.startRecord({
      site: "fixture",
      op: "login",
      tabId: 1,
      origin: "https://example.test",
      network: true,
      root,
    });
    records.appendRecordEvent(hostEvent("locate.label", args), { target: TAB, root });
    records.attachNetworkTrace(
      record.id,
      [{ ...create, requestBody: `password=${encodeURIComponent(SECRET)}` }],
      root,
      { capture: COMPLETE },
    );
    const { draft } = records.stopRecord({ target: TAB, draft: true, root });
    authoring.saveFromRecord({ recordId: record.id, root, home });
    expect(() => authoring.saveFromRecent({ site: "fixture", op: "recent", root, home })).toThrow(
      /write-capable/,
    );

    const workflow = draft.run.find((strategy: { using: string }) => strategy.using === "workflow");
    expect(workflow.steps[0].args.value).toBe("{{value}}");
    expect(draft.args.value).toMatchObject({ required: true });
    const written = everyFile(home);
    expect(written).toContain('"login"');
    expect(written).not.toContain("hunter2-S3cret!");
  });

  it.each([
    ["type", { selector: "#pw", text: SECRET }],
    ["locate.label", fill["locate.label"]],
  ])(
    "treats a %s value the same in a record started with --include-input-values",
    (command, args) => {
      const root = tempRoot();
      const record = records.startRecord({
        site: "fixture",
        op: "login",
        tabId: 1,
        origin: "https://example.test",
        includeInputValues: true,
        root,
      });
      records.appendRecordEvent(hostEvent(command, args), { target: TAB, root });
      records.stopRecord({ target: TAB, draft: true, root });
      expect(everyFile(path.join(records.recordsRoot(root), record.id))).not.toContain(
        "hunter2-S3cret!",
      );
    },
  );
});
