import { afterEach, describe, expect, it } from "vitest";
import { captureTab } from "../fixtures/capture-tab";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const journal = require("../../native/activity-journal.cjs");
const authoring = require("../../native/playbook-authoring.cjs");
const records = require("../../native/playbook-records.cjs");
const { paramOp } = require("../../native/playbook-param.cjs");
const { renderRequest, resolveArgValues } = require("../../native/playbook-template.cjs");
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
  includeInputValues = false,
  stop = { draft: true },
}: {
  commands?: Step[];
  trace?: Entry[];
  capture?: Entry | null;
  truncatedAt?: number;
  origin?: string;
  pageText?: string;
  includeInputValues?: boolean;
  stop?: { draft?: boolean; read?: boolean; requestId?: string };
}) {
  const root = tempRoot();
  const record = records.startRecord({
    site: "fixture",
    op: "search",
    tabId: 1,
    origin,
    network: trace !== undefined,
    includeInputValues,
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
// Bot-sensor and survey POSTs a page sends to third parties (resy.com, blast.ncbi.nlm.nih.gov).
const sensors = [
  {
    id: "r_px",
    method: "POST",
    status: 200,
    type: "XHR",
    url: "https://collector-pxabc123.px-cloud.net/api/v2/collector",
  },
  {
    id: "r_qualtrics",
    method: "POST",
    status: 200,
    type: "XHR",
    url: "https://zn0abc.siteintercept.qualtrics.com/WRSiteInterceptEngine/Targeting.php?Q_ZoneID=ZN_0abc",
  },
  {
    id: "r_datadome",
    method: "POST",
    status: 200,
    type: "XHR",
    url: "https://api-js.datadome.co/js/",
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
      "a bot-sensor or survey POST doesn't block --read",
      { commands: ["click"], trace: [page, ...sensors], stop: { draft: true, read: true } },
      "read",
    ],
    [
      "a bot-sensor or survey POST doesn't make a navigation a write",
      { commands: ["navigate"], trace: [page, ...sensors] },
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
      "a survey vendor's own site",
      {
        trace: [
          {
            ...sensors[1],
            url: "https://siteintercept.qualtrics.com/WRSiteInterceptEngine/Targeting.php",
          },
        ],
        origin: "https://www.qualtrics.com",
      },
      /captured POST https:\/\/siteintercept\.qualtrics\.com/,
    ],
    [
      "the bot-sensor vendor's own site",
      { trace: [sensors[0]], origin: "https://www.humansecurity.com" },
      /captured POST https:\/\/collector-pxabc123\.px-cloud\.net/,
    ],
    [
      "the bot-sensor vendor's own site (DataDome)",
      { trace: [sensors[2]], origin: "https://datadome.co" },
      /captured POST https:\/\/api-js\.datadome\.co/,
    ],
    [
      "a feedback form's submission (Medallia), which isn't a sensor",
      {
        trace: [
          page,
          { ...create, id: "r_feedback", url: "https://api-us.kampyle.com/api/v1/feedback" },
        ],
      },
      /captured POST https:\/\/api-us\.kampyle\.com\/api\/v1\/feedback/,
    ],
    [
      "a DataDome host other than its collector",
      {
        trace: [page, { ...create, id: "r_dd", url: "https://customer-api.datadome.co/1.1/rules" }],
      },
      /captured POST https:\/\/customer-api\.datadome\.co/,
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
    // A bot sensor's POST is never the draft's request, nor one --request-id may choose.
    const sensed = stopFlow({ commands: ["navigate"], trace: [...sensors, page] });
    expect(sensed.draft.run[0].request).toMatchObject({ url: "https://example.test/search" });
    expect(
      recordFlow({
        commands: ["navigate"],
        trace: [page, ...sensors],
        stop: { draft: true, requestId: "r_px" },
      }).stopped,
    ).toThrow(
      /request r_px \(POST https:\/\/collector-pxabc123\.px-cloud\.net\/api\/v2\/collector\) is telemetry/,
    );
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

  describe("a JSON with records demoted only for its banner-like path", () => {
    const shell = {
      id: "r_page",
      method: "GET",
      status: 200,
      type: "Document",
      mimeType: "text/html",
      url: "https://example.test/dashboard",
      responseBody:
        '<html><head><title>Dashboard</title></head><body><div id="app">Loading</div><script src="/app.js"></script></body></html>',
      bodyCapture: { mode: "text", complete: true },
    };
    const overCap = {
      ...shell,
      responseBody: undefined,
      bodyCapture: { mode: "text", complete: false, reason: "per-body-cap", sizeBytes: 248_000 },
    };
    const metrics = json("r_metrics", "https://example.test/api/banner/metrics", {
      points: [
        { t: 1001, v: 2.5, n: 1 },
        { t: 1002, v: 3.5, n: 2 },
        { t: 1003, v: 5.5, n: 3 },
      ],
    });

    it.each([
      ["an empty shell", shell],
      ["a document over the capture cap", overCap],
    ])("warns when it picks %s over it", (_, picked) => {
      const { draft, warnings, record } = stopFlow({
        commands: ["click"],
        trace: [picked, metrics],
        pageText: PAGE_TEXT,
        stop: { draft: true, read: true },
      });
      expect(networkRequest(draft)).toMatchObject({ url: "https://example.test/dashboard" });
      expect(warnings).toEqual([
        `the draft's network strategy, GET https://example.test/dashboard (score 6), was picked over GET https://example.test/api/banner/metrics (score 3), whose 3 records weren't counted because its path reads like a banner or announcements feed; counted, it would score 9; run surf pb record candidates ${record.id} and choose with --request-id`,
      ]);
    });

    it("keeps arXiv's announcements feed from winning over an unsampled search page, with a warning", () => {
      const notices = json(
        "r_notices",
        "https://static.example.test/static/json/announcements.json",
        {
          announcements: [1, 2, 3, 4, 5].map((id) => ({ id, text: `Scheduled maintenance ${id}` })),
        },
      );
      const manifest = json(
        "r_manifest",
        "https://static.example.test/site.webmanifest",
        { name: "Example", icons: [{ src: "/a.png" }, { src: "/b.png" }] },
        { type: "Manifest", mimeType: "application/manifest+json" },
      );
      const { draft, warnings } = stopFlow({
        commands: ["click"],
        trace: [overCap, notices, manifest],
        pageText: PAGE_TEXT,
        stop: { draft: true, read: true },
      });
      expect(networkRequest(draft)).toMatchObject({ url: "https://example.test/dashboard" });
      expect(warnings).toHaveLength(1);
      expect(warnings?.[0]).toMatch(
        /was picked over GET https:\/\/static\.example\.test\/static\/json\/announcements\.json \(score 3\), whose 5 records weren't counted/,
      );
    });
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

  describe("a write draft whose workflow isn't one commit step", () => {
    const typed = step("type", { text: "<text>", selector: "#seq" });
    const savedOp = (saved: { directory: string }) =>
      JSON.parse(fs.readFileSync(path.join(saved.directory, "ops", "search.json"), "utf8"));

    it.each([
      ["a navigate (resy.com)", ["navigate"], "navigate"],
      ["a type and a click (NCBI BLAST)", [typed, "click"], "type + click"],
    ])("saves network-only after %s, with a note", (_case, commands, shown) => {
      const { root, stopped } = recordFlow({ commands: commands as Step[], trace: [page, create] });
      const { record, draft } = stopped();
      expect(draft.effect).toBe("write");
      const saved = authoring.saveFromRecord({
        recordId: record.id,
        root,
        home: path.dirname(root),
      });
      expect(saved.warnings).toEqual([
        `saved network-only: a write op's workflow fallback must be one page-write step, and this draft's is ${shown}, so the op replays POST https://example.test/api/employees alone`,
      ]);
      const op = savedOp(saved);
      expect(op.run.map((strategy: { using: string }) => strategy.using)).toEqual(["network"]);
      // The workflow's typed input goes with it; the write keeps its review key.
      expect(op.args).toEqual({
        review_key: { required: true, desc: "Semantic key for reviewed write replay" },
      });
      expect(op.safety).toMatchObject({
        authorization: "explicit",
        duplicate: "transactional",
        key: ["review_key"],
      });
    });

    it("allows the page's origin and the replayed request's, and no other captured origin", () => {
      const search = {
        ...create,
        id: "r_search",
        url: "https://api.resy.test/3/venuesearch/search",
        tabUrl: "https://resy.test/search",
      };
      const cdn = { ...page, id: "r_cdn", url: "https://cdn.other.test/config.json" };
      const { root, stopped } = recordFlow({
        commands: ["navigate"],
        origin: "https://resy.test",
        trace: [{ ...page, url: "https://resy.test/search" }, cdn, search],
        stop: { draft: true, requestId: "r_search" },
      });
      const { record } = stopped();
      const saved = authoring.saveFromRecord({
        recordId: record.id,
        root,
        home: path.dirname(root),
      });
      const origins = ["https://resy.test", "https://api.resy.test"];
      expect(
        JSON.parse(fs.readFileSync(path.join(saved.directory, "playbook.json"), "utf8")).origins,
      ).toEqual(origins);
      expect(savedOp(saved).origins).toEqual(origins);
      // The save names the origins, and warns that api.resy.test isn't the page's origin.
      expect(saved.origins).toEqual(origins);
      expect(saved.warnings).toContain(
        "the op may also send to https://api.resy.test, the origin of the request it replays (POST https://api.resy.test/3/venuesearch/search), which isn't the origin of the record's page (https://resy.test); if that is the wrong request, save again with --request-id <r_…> from pb record candidates",
      );
      // A request on another site (a CDN's JSON) is allowed too, with a warning naming it.
      const onCdn = recordFlow({
        origin: "https://resy.test",
        trace: [{ ...page, url: "https://resy.test/search" }, cdn],
        stop: { draft: true, requestId: "r_cdn" },
      });
      const cdnSaved = authoring.saveFromRecord({
        recordId: onCdn.stopped().record.id,
        root: onCdn.root,
        home: path.dirname(onCdn.root),
      });
      expect(cdnSaved.origins).toEqual(["https://resy.test", "https://cdn.other.test"]);
      expect(cdnSaved.warnings).toEqual([
        "the op may also send to https://cdn.other.test, the origin of the request it replays (GET https://cdn.other.test/config.json), which isn't the origin of the record's page (https://resy.test); if that is the wrong request, save again with --request-id <r_…> from pb record candidates",
      ]);
      // A read replayed on the page's own origin keeps that one origin.
      const read = recordFlow({
        origin: "https://resy.test",
        trace: [{ ...page, url: "https://resy.test/search" }, cdn],
      });
      const readSaved = authoring.saveFromRecord({
        recordId: read.stopped().record.id,
        root: read.root,
        home: path.dirname(read.root),
      });
      expect(savedOp(readSaved).origins).toEqual(["https://resy.test"]);
    });

    it("refuses when it has no network strategy for the write", () => {
      const update = {
        ...create,
        id: "r_put",
        method: "PUT",
        url: "https://example.test/api/employees/7",
      };
      const { root, stopped } = recordFlow({ commands: ["navigate"], trace: [update] });
      const { record } = stopped();
      expect(() =>
        authoring.saveFromRecord({ recordId: record.id, root, home: path.dirname(root) }),
      ).toThrow(
        "write op search can't be saved: a write op's workflow fallback must be one page-write step, and this draft's is navigate, and the draft has no network strategy to replay the write instead. Record the write as a single click, or start the record with --network so the draft can replay its request",
      );
    });

    describe("which write it replays", () => {
      const update = {
        ...create,
        id: "r_put",
        method: "PUT",
        url: "https://example.test/api/employees/7",
      };
      const heartbeat = {
        ...create,
        id: "r_hb",
        status: 200,
        url: "https://heartbeat.vendor.test/ping",
      };
      const second = { ...create, id: "r_note", url: "https://example.test/api/notes" };
      const save = (root: string, recordId: string, requestId?: string) =>
        authoring.saveFromRecord({
          recordId,
          root,
          home: path.dirname(root),
          ...(requestId ? { requestId } : {}),
        });

      it("refuses a choice among several captured writes unless --request-id names one", () => {
        const { root, stopped } = recordFlow({
          commands: ["navigate"],
          trace: [update, heartbeat],
        });
        const { record, draft } = stopped();
        // The draft's pick, the only write it can replay, is the unrelated third-party heartbeat.
        expect(draft.run[0].request.url).toBe("https://heartbeat.vendor.test/ping");
        expect(() => save(root, record.id)).toThrow(
          "write op search can't be saved network-only: the record captured 2 writes (r_put PUT https://example.test/api/employees/7, r_hb POST https://heartbeat.vendor.test/ping); name the one the op replays with pb save --from-record <id> --request-id <r_…>",
        );
        // Named explicitly, a write on another origin saves, with a warning naming that origin.
        expect(save(root, record.id, "r_hb").warnings).toContain(
          "the op may also send to https://heartbeat.vendor.test, the origin of the request it replays (POST https://heartbeat.vendor.test/ping), which isn't the origin of the record's page (https://example.test); if that is the wrong request, save again with --request-id <r_…> from pb record candidates",
        );
      });

      it.each([
        [
          "another user's site on a shared host",
          "https://alice.github.io",
          "https://bob.github.io/api/save",
        ],
        ["the site's api. subdomain", "https://example.test", "https://api.example.test/save"],
      ])("replays a write on %s only when --request-id names it", (_case, origin, url) => {
        const write = { ...create, id: "r_other", url };
        const flow = recordFlow({
          commands: ["navigate"],
          origin,
          trace: [{ ...page, url: `${origin}/` }, write],
        });
        const { record } = flow.stopped();
        const other = new URL(url).origin;
        expect(() => save(flow.root, record.id)).toThrow(
          `write op search can't be saved network-only: it would replay POST ${url}, whose origin (${other}) isn't the record's page origin (${origin}); name it with --request-id r_other to replay it anyway`,
        );
        const saved = save(flow.root, record.id, "r_other");
        expect(saved.origins).toEqual([origin, other]);
        expect(saved.warnings).toContain(
          `the op may also send to ${other}, the origin of the request it replays (POST ${url}), which isn't the origin of the record's page (${origin}); if that is the wrong request, save again with --request-id <r_…> from pb record candidates`,
        );
      });

      it("saves the write named with --request-id, at stop or at save", () => {
        const atStop = recordFlow({
          commands: ["navigate"],
          trace: [page, create, second],
          stop: { draft: true, requestId: "r_note" },
        });
        const stoppedAt = atStop.stopped();
        expect(save(atStop.root, stoppedAt.record.id).warnings).toEqual([
          expect.stringMatching(
            /so the op replays POST https:\/\/example\.test\/api\/notes alone$/,
          ),
        ]);
        const atSave = recordFlow({ commands: ["navigate"], trace: [page, create, second] });
        const { record } = atSave.stopped();
        expect(() => save(atSave.root, record.id)).toThrow(/the record captured 2 writes/);
        const saved = save(atSave.root, record.id, "r_2");
        expect(savedOp(saved).run[0].request.url).toBe("https://example.test/api/employees");
      });
    });

    it("refuses when its network strategy replays a read, not the write", () => {
      const { root, stopped } = recordFlow({ commands: [typed, "click"], trace: [page] });
      const { record, draft } = stopped();
      expect(draft.effect).toBe("write");
      expect(() =>
        authoring.saveFromRecord({ recordId: record.id, root, home: path.dirname(root) }),
      ).toThrow(
        "write op search can't be saved: a write op's workflow fallback must be one page-write step, and this draft's is type + click, and its network strategy replays GET https://example.test/search, a read, not the write",
      );
    });
  });

  describe("a single-click write draft's network strategy", () => {
    const save = (root: string, recordId: string, requestId?: string) =>
      authoring.saveFromRecord({
        recordId,
        root,
        home: path.dirname(root),
        ...(requestId ? { requestId } : {}),
      });

    it("replays a write on another origin only when --request-id names it, at save or at stop", () => {
      const origin = "https://alice.github.io";
      const trace = [
        { ...page, url: `${origin}/` },
        { ...create, id: "r_other", url: "https://bob.github.io/save" },
      ];
      const flow = recordFlow({ commands: ["click"], origin, trace });
      const { record, draft } = flow.stopped();
      expect(draft.run.map((strategy: { using: string }) => strategy.using)).toEqual([
        "network",
        "workflow",
      ]);
      expect(() => save(flow.root, record.id)).toThrow(
        "write op search can't be saved: it would replay POST https://bob.github.io/save, whose origin (https://bob.github.io) isn't the record's page origin (https://alice.github.io); name it with --request-id r_other to replay it anyway",
      );
      const warning =
        "the op may also send to https://bob.github.io, the origin of the request it replays (POST https://bob.github.io/save), which isn't the origin of the record's page (https://alice.github.io); if that is the wrong request, save again with --request-id <r_…> from pb record candidates";
      const saved = save(flow.root, record.id, "r_other");
      expect(saved.origins).toEqual([origin, "https://bob.github.io"]);
      expect(saved.warnings).toEqual([warning]);
      const atStop = recordFlow({
        commands: ["click"],
        origin,
        trace,
        stop: { draft: true, requestId: "r_other" },
      });
      expect(save(atStop.root, atStop.stopped().record.id).warnings).toEqual([warning]);
    });

    it("saves a write on the record page's own origin", () => {
      const { root, stopped } = recordFlow({ commands: ["click"], trace: [page, create] });
      const saved = save(root, stopped().record.id);
      expect(saved.origins).toEqual(["https://example.test"]);
      expect(saved.warnings).toBeUndefined();
    });
  });

  describe("a write draft with no recorded steps", () => {
    const save = (root: string, recordId: string, requestId?: string) =>
      authoring.saveFromRecord({
        recordId,
        root,
        home: path.dirname(root),
        ...(requestId ? { requestId } : {}),
      });

    it("replays a write on another origin only when --request-id names it", () => {
      const origin = "https://alice.github.io";
      const flow = recordFlow({
        origin,
        trace: [
          { ...page, url: `${origin}/` },
          { ...create, id: "r_other", url: "https://bob.github.io/save" },
        ],
      });
      const { record, draft } = flow.stopped();
      expect(draft.effect).toBe("write");
      expect(draft.run.map((strategy: { using: string }) => strategy.using)).toEqual(["network"]);
      expect(() => save(flow.root, record.id)).toThrow(
        "write op search can't be saved network-only: it would replay POST https://bob.github.io/save, whose origin (https://bob.github.io) isn't the record's page origin (https://alice.github.io); name it with --request-id r_other to replay it anyway",
      );
      const saved = save(flow.root, record.id, "r_other");
      expect(saved.origins).toEqual([origin, "https://bob.github.io"]);
      expect(saved.warnings).toEqual([
        "the op may also send to https://bob.github.io, the origin of the request it replays (POST https://bob.github.io/save), which isn't the origin of the record's page (https://alice.github.io); if that is the wrong request, save again with --request-id <r_…> from pb record candidates",
      ]);
    });

    it("saves a write on the record page's own origin", () => {
      const { root, stopped } = recordFlow({ trace: [page, create] });
      const saved = save(root, stopped().record.id);
      expect(saved.origins).toEqual(["https://example.test"]);
      expect(saved.warnings).toBeUndefined();
    });
  });

  // The draft's network strategy decides, not its effect label or its workflow: a write it replays
  // must be one the record captured, on the record page's origin unless --request-id names it.
  describe("a hand-edited draft's network write", () => {
    const origin = "https://alice.github.io";
    const bob = "POST https://bob.github.io/save";
    const trace = [
      { ...page, url: `${origin}/` },
      { ...create, id: "r_other", url: "https://bob.github.io/save" },
    ];
    type Op = { effect?: string; run: { using: string; request?: { url: string } }[] };
    const edit = (root: string, recordId: string, change: (op: Op) => void) => {
      const file = path.join(records.recordsRoot(root), recordId, "draft", "op.json");
      const op = JSON.parse(fs.readFileSync(file, "utf8"));
      change(op);
      fs.writeFileSync(file, JSON.stringify(op));
    };
    const save = (root: string, recordId: string, requestId?: string) =>
      authoring.saveFromRecord({
        recordId,
        root,
        home: path.dirname(root),
        ...(requestId ? { requestId } : {}),
      });
    const shapes: [string, Step[], string][] = [
      ["no steps", [], "write op search can't be saved network-only"],
      ["one click", ["click"], "write op search can't be saved"],
      ["several steps", ["navigate", "click"], "write op search can't be saved network-only"],
    ];
    const asRead = [
      ['"read"', (op: Op) => (op.effect = "read")],
      ["missing", (op: Op) => Reflect.deleteProperty(op, "effect")],
    ] as const;
    const readRefusal = (effect: string) =>
      `op search can't be saved: the record drafts a write op (it captured ${bob}), and the draft's effect is ${effect}; a draft can't change an op's effect`;

    describe.each(shapes)("with %s", (_shape, commands, prefix) => {
      it.each(asRead)("refuses a captured write when its effect is %s", (_effect, change) => {
        const flow = recordFlow({ commands, origin, trace });
        const { record } = flow.stopped();
        edit(flow.root, record.id, change);
        expect(() => save(flow.root, record.id)).toThrow(readRefusal(_effect));
      });

      it.each(asRead)(
        "refuses it when its effect is %s, though --request-id at stop names it",
        (_effect, change) => {
          const flow = recordFlow({
            commands,
            origin,
            trace,
            stop: { draft: true, requestId: "r_other" },
          });
          const { record } = flow.stopped();
          edit(flow.root, record.id, change);
          expect(() => save(flow.root, record.id)).toThrow(readRefusal(_effect));
        },
      );

      it("redrafts with --request-id at save from the record: a write, whatever the draft's effect", () => {
        const flow = recordFlow({ commands, origin, trace });
        const { record } = flow.stopped();
        edit(flow.root, record.id, (op) => (op.effect = "read"));
        expect(save(flow.root, record.id, "r_other").origins).toEqual([
          origin,
          "https://bob.github.io",
        ]);
        edit(flow.root, record.id, (op) => Reflect.deleteProperty(op, "effect"));
        const saved = save(flow.root, record.id, "r_other");
        expect(saved.origins).toEqual([origin, "https://bob.github.io"]);
        expect(saved.warnings).toContain(
          `the op may also send to https://bob.github.io, the origin of the request it replays (${bob}), which isn't the origin of the record's page (${origin}); if that is the wrong request, save again with --request-id <r_…> from pb record candidates`,
        );
      });

      it("refuses a write the record didn't capture, on the page's own origin too", () => {
        const uncaptured = (op: Op) => {
          const network = op.run.find((strategy) => strategy.using === "network");
          if (network?.request) {
            network.request.url = `${origin}/uncaptured-write`;
          }
        };
        const why = `it would replay POST ${origin}/uncaptured-write, which isn't a write the record captured`;
        const flow = recordFlow({ commands, origin, trace });
        const { record } = flow.stopped();
        edit(flow.root, record.id, uncaptured);
        expect(() => save(flow.root, record.id)).toThrow(`${prefix}: ${why}`);
        edit(flow.root, record.id, (op) => (op.effect = "read"));
        expect(() => save(flow.root, record.id)).toThrow(readRefusal('"read"'));
        // --request-id at stop names Bob's write, not the edited request.
        const named = recordFlow({
          commands,
          origin,
          trace,
          stop: { draft: true, requestId: "r_other" },
        });
        const stopped = named.stopped();
        edit(named.root, stopped.record.id, uncaptured);
        expect(() => save(named.root, stopped.record.id)).toThrow(`${prefix}: ${why}`);
        // At save it redrafts with the write it names, which saves with a warning.
        expect(save(named.root, stopped.record.id, "r_other").origins).toEqual([
          origin,
          "https://bob.github.io",
        ]);
      });
    });

    it("refuses a request without a method, which would send a GET", () => {
      const flow = recordFlow({ commands: ["navigate"], trace: [page, create] });
      const { record } = flow.stopped();
      edit(flow.root, record.id, (op) => {
        const network = op.run.find((strategy) => strategy.using === "network");
        Reflect.deleteProperty(network?.request ?? {}, "method");
      });
      expect(() => save(flow.root, record.id)).toThrow(
        "write op search can't be saved: its network strategy has no method, and a draft keeps the method the record captured (POST https://example.test/api/employees)",
      );
    });
  });

  // Save rebuilds every network write from the trace entry it stands for, so what a draft file says
  // about a write's method, URL, query, headers or body is never sent.
  describe("a draft's network writes, rebuilt from the trace", () => {
    const origin = "https://alice.github.io";
    const preview = {
      id: "r_preview",
      method: "POST",
      status: 200,
      type: "XHR",
      url: `${origin}/save?action=preview`,
      requestHeaders: { "content-type": "application/json", "x-action": "preview" },
      requestBody: '{"action":"preview"}',
    };
    const captured = {
      method: "POST",
      url: `${origin}/save`,
      query: { action: "preview" },
      headers: { "content-type": "application/json", "x-action": "preview" },
      body: '{"action":"preview"}',
    };
    type Request = Entry & { url: string; query?: Entry; headers?: Entry; body?: unknown };
    type Strategy = Entry & { using: string; request?: Request };
    type Op = Entry & { effect?: string; run: Strategy[] };
    const flow = (commands: Step[], options: { includeInputValues?: boolean } = {}) => {
      const recorded = recordFlow({
        commands,
        origin,
        trace: [{ ...page, url: `${origin}/` }, preview],
        includeInputValues: options.includeInputValues ?? true,
      });
      const { record, draft } = recorded.stopped();
      const file = path.join(records.recordsRoot(recorded.root), record.id, "draft", "op.json");
      const save = (change: (op: Op) => void) => {
        const op = JSON.parse(fs.readFileSync(file, "utf8"));
        change(op);
        fs.writeFileSync(file, JSON.stringify(op));
        return authoring.saveFromRecord({
          recordId: record.id,
          root: recorded.root,
          home: path.dirname(recorded.root),
        });
      };
      return { draft: draft as Op, save };
    };
    const savedRun = (saved: { directory: string }): Strategy[] =>
      JSON.parse(fs.readFileSync(path.join(saved.directory, "ops", "search.json"), "utf8")).run;
    const networkOf = (op: Op) =>
      op.run.find((strategy) => strategy.using === "network") as Strategy;
    const shapes: [string, Step[], string][] = [
      ["no steps", [], "write op search can't be saved network-only"],
      ["one click", ["click"], "write op search can't be saved"],
      ["navigate + click", ["navigate", "click"], "write op search can't be saved network-only"],
    ];
    const edits: [string, (request: Request) => void][] = [
      [
        "the URL's query",
        (request) => {
          request.url += "?action=deleteAll";
          Reflect.deleteProperty(request, "query");
        },
      ],
      ["the query object", (request) => (request.query = { action: "deleteAll" })],
      ["the body", (request) => (request.body = '{"action":"deleteAll"}')],
      [
        "a header",
        (request) => (request.headers = { ...request.headers, "x-action": "deleteAll" }),
      ],
      ["an added header", (request) => (request.headers = { ...request.headers, "x-extra": "1" })],
    ];

    describe.each(shapes)("with %s", (_shape, commands, prefix) => {
      it("drafts the captured request", () => {
        expect(networkOf(flow(commands).draft).request).toEqual(captured);
      });

      it.each(edits)("saves the captured request, not an edit to %s", (_edit, change) => {
        const saved = flow(commands).save((op) => change(networkOf(op).request as Request));
        const run = savedRun(saved);
        expect(networkOf({ run }).request).toEqual(captured);
        expect(run.filter((strategy) => strategy.using === "network")).toHaveLength(1);
      });

      it("keeps <request-body> when the record captured no input values", () => {
        const { draft, save } = flow(commands, { includeInputValues: false });
        const drafted = networkOf(draft).request;
        expect(drafted?.body).toBe("<request-body>");
        const saved = save(
          (op) =>
            (networkOf(op).request = { ...drafted, body: '{"action":"deleteAll"}' } as Request),
        );
        expect(networkOf({ run: savedRun(saved) }).request).toEqual(drafted);
      });

      it("keeps the strategy's extract, verify and acceptStatus, and drops other fields", () => {
        const saved = flow(commands).save((op) => {
          Object.assign(networkOf(op), {
            extract: { jsonPath: "$.id" },
            verify: { status: 200 },
            acceptStatus: [409],
            stray: "dropped",
          });
        });
        expect(networkOf({ run: savedRun(saved) })).toEqual({
          using: "network",
          request: captured,
          extract: { jsonPath: "$.id" },
          verify: { status: 200 },
          acceptStatus: [409],
        });
      });

      it("refuses a write whose method the record didn't capture on that path", () => {
        const { save } = flow(commands);
        expect(() => save((op) => ((networkOf(op).request as Request).method = "PATCH"))).toThrow(
          `${prefix}: it would replay PATCH ${origin}/save, which isn't a write the record captured`,
        );
      });

      it("refuses a second network write the record didn't capture", () => {
        const { save } = flow(commands);
        const why = `it would replay POST ${origin}/uncaptured-delete, which isn't a write the record captured`;
        const second = {
          using: "network",
          request: { method: "POST", url: `${origin}/uncaptured-delete`, body: '{"all":true}' },
        };
        expect(() => save((op) => op.run.splice(1, 0, second))).toThrow(`${prefix}: ${why}`);
      });

      it("rebuilds a second network write that stands for the captured one", () => {
        const saved = flow(commands).save((op) => {
          const copy = structuredClone(networkOf(op));
          (copy.request as Request).query = { action: "deleteAll" };
          op.run.splice(1, 0, copy);
        });
        const writes = savedRun(saved).filter((strategy) => strategy.using === "network");
        expect(writes.map((strategy) => strategy.request)).toEqual([captured, captured]);
      });

      it("refuses a {{…}} placeholder in a write, which pb param adds after save", () => {
        const { save } = flow(commands);
        expect(() =>
          save((op) => (networkOf(op).request = { ...captured, body: '{"action":"{{action}}"}' })),
        ).toThrow(
          `${prefix}: its network write POST ${origin}/save holds {{action}}, and a write is saved as the record captured it; save it as drafted, then make the input with surf pb param`,
        );
      });

      it("refuses safety.serverIdempotency, which changes the write it replays", () => {
        const { save } = flow(commands);
        expect(() =>
          save((op) =>
            Object.assign(op.safety as Entry, { serverIdempotency: { query: "action" } }),
          ),
        ).toThrow(
          `write op search can't be saved: its safety is drafted as {"authorization":"explicit","duplicate":"transactional","key":["review_key"]}, and a draft can't change it; change it on the saved op`,
        );
      });
    });

    it("refuses a write network strategy in a read op, which the record never captured", () => {
      const reading = recordFlow({
        origin,
        trace: [{ ...page, id: "r_read", type: "XHR", url: `${origin}/read` }],
      });
      const { record, draft } = reading.stopped();
      expect(draft.effect).toBe("read");
      const file = path.join(records.recordsRoot(reading.root), record.id, "draft", "op.json");
      fs.writeFileSync(
        file,
        JSON.stringify({
          ...draft,
          run: [
            ...draft.run,
            { using: "network", request: { method: "POST", url: `${origin}/uncaptured-delete` } },
          ],
        }),
      );
      expect(() =>
        authoring.saveFromRecord({
          recordId: record.id,
          root: reading.root,
          home: path.dirname(reading.root),
        }),
      ).toThrow(
        `op search can't be saved: it would replay POST ${origin}/uncaptured-delete, which isn't a write the record captured`,
      );
    });

    it("refuses a write the draft builder never replays, though the record captured it", () => {
      const put = { ...preview, id: "r_put", method: "PUT", url: `${origin}/items/7` };
      const recorded = recordFlow({
        commands: ["navigate"],
        origin,
        trace: [{ ...page, url: `${origin}/` }, put],
      });
      const { record, draft } = recorded.stopped();
      expect(draft.run.map((strategy: Strategy) => strategy.using)).toEqual(["workflow"]);
      const file = path.join(records.recordsRoot(recorded.root), record.id, "draft", "op.json");
      fs.writeFileSync(
        file,
        JSON.stringify({
          ...draft,
          run: [{ using: "network", request: { method: "PUT", url: `${origin}/items/7` } }],
        }),
      );
      expect(() =>
        authoring.saveFromRecord({
          recordId: record.id,
          root: recorded.root,
          home: path.dirname(recorded.root),
        }),
      ).toThrow(
        `write op search can't be saved network-only: it would replay PUT ${origin}/items/7, a PUT (a draft replays only GET, HEAD and POST)`,
      );
    });

    it.each([
      ["an api strategy that may POST", { using: "api", allowPost: true, url: `${origin}/delete` }],
      ["a script strategy", { using: "script", script: "fetch('/delete', { method: 'POST' })" }],
    ])("refuses %s, which the draft builder never makes", (_case, strategy) => {
      const { save } = flow([]);
      expect(() => save((op) => op.run.push(strategy))).toThrow(
        `write op search can't be saved network-only: an op saved from a record runs only network and workflow strategies, and this draft has a ${strategy.using} strategy`,
      );
    });
  });

  // The record decides what an op saved from it sends: its steps, the request --request-id names
  // and the text it captured. draft/op.json only names and describes the op.
  describe("a hand-edited draft, held to the record", () => {
    const origin = "https://alice.github.io";
    type Strategy = Entry & { using: string; request?: Entry; steps?: Entry[] };
    type Op = Entry & {
      effect?: string;
      args?: Record<string, Entry>;
      provenance?: Entry;
      run: Strategy[];
    };
    const edit = (root: string, recordId: string, change: (op: Op) => void) => {
      const file = path.join(records.recordsRoot(root), recordId, "draft", "op.json");
      const op = JSON.parse(fs.readFileSync(file, "utf8"));
      change(op);
      fs.writeFileSync(file, JSON.stringify(op));
    };
    const save = (root: string, recordId: string) =>
      authoring.saveFromRecord({ recordId, root, home: path.dirname(root) });
    const savedOp = (saved: { directory: string }): Op =>
      JSON.parse(fs.readFileSync(path.join(saved.directory, "ops", "search.json"), "utf8"));
    const strategyOf = (op: Op, using: string) =>
      op.run.find((strategy) => strategy.using === using) as Strategy;
    const shapes: [string, Step[]][] = [
      ["no steps", []],
      ["one click", ["click"]],
      ["navigate + click", [step("navigate", { url: `${origin}/` }), "click"]],
    ];
    const write = {
      id: "r_save",
      method: "POST",
      status: 200,
      type: "XHR",
      url: `${origin}/save`,
      requestHeaders: { "content-type": "application/json" },
      requestBody: '{"action":"preview"}',
    };
    const bobDelete =
      "fetch('https://bob.github.io/uncaptured-delete', { method: 'POST', body: 'deleteAll' })";

    describe("its workflow", () => {
      // Adds `added` to the draft's workflow, making one when the draft has none.
      const addStep = (added: Entry) => (op: Op) => {
        const workflow = op.run.find((strategy) => strategy.using === "workflow");
        if (workflow) {
          (workflow.steps as Entry[]).push(added);
        } else {
          op.run.push({ using: "workflow", steps: [added] });
        }
      };
      const unrecordable = ["js", "javascript_tool", "frame.js"];

      describe.each(shapes)("with %s", (_shape, commands) => {
        const label = "write op search can't be saved";

        it.each(unrecordable)("refuses a %s step the draft adds", (tool) => {
          const flow = recordFlow({
            commands,
            origin,
            trace: [{ ...page, url: `${origin}/` }, write],
          });
          const { record } = flow.stopped();
          edit(flow.root, record.id, addStep({ tool, args: { code: bobDelete } }));
          expect(() => save(flow.root, record.id)).toThrow(
            `${label}: its workflow runs ${tool}, a step no record holds; an op saved from a record runs only the steps the record ran`,
          );
        });

        it.each(unrecordable)("refuses a %s step inside a repeat loop", (tool) => {
          const flow = recordFlow({
            commands,
            origin,
            trace: [{ ...page, url: `${origin}/` }, write],
          });
          const { record } = flow.stopped();
          edit(
            flow.root,
            record.id,
            addStep({ repeat: 2, steps: [{ tool, args: { code: bobDelete } }] }),
          );
          expect(() => save(flow.root, record.id)).toThrow(
            `${label}: its workflow runs ${tool}, a step no record holds`,
          );
        });

        it("refuses a loop of recorded steps, which no record holds", () => {
          const flow = recordFlow({
            commands,
            origin,
            trace: [{ ...page, url: `${origin}/` }, write],
          });
          const { record } = flow.stopped();
          edit(flow.root, record.id, addStep({ repeat: 2, steps: [{ tool: "click", args: {} }] }));
          expect(() => save(flow.root, record.id)).toThrow(
            `${label}: its workflow repeats steps in a loop, and a record holds no loop`,
          );
        });

        it("refuses a recordable step the record didn't run", () => {
          const flow = recordFlow({
            commands,
            origin,
            trace: [{ ...page, url: `${origin}/` }, write],
          });
          const { record } = flow.stopped();
          edit(
            flow.root,
            record.id,
            addStep({ tool: "navigate", args: { url: "https://bob.github.io/uncaptured-delete" } }),
          );
          const ran = commands.map((item) => (typeof item === "string" ? item : item[0]));
          expect(() => save(flow.root, record.id)).toThrow(
            `${label}: its workflow runs ${[...ran, "navigate"].join(" + ")}, and the record ran ${ran.join(" + ") || "no steps"}`,
          );
        });
      });

      // The reviewer's case: a read record's draft, its effect kept, with a script step added.
      it.each([
        ["no steps", []],
        ["a navigate", [step("navigate", { url: `${origin}/` })]],
      ] as [string, Step[]][])("refuses a script step in a read op with %s", (_shape, commands) => {
        const read = { ...page, id: "r_read", url: `${origin}/read`, type: "XHR" };
        const flow = recordFlow({ commands, origin, trace: [read] });
        const { record, draft } = flow.stopped();
        expect(draft.effect).toBe("read");
        for (const added of [
          { tool: "javascript_tool", args: { code: bobDelete } },
          { repeat: 2, steps: [{ tool: "javascript_tool", args: { code: bobDelete } }] },
        ]) {
          edit(flow.root, record.id, (op) => {
            op.run = op.run.filter((strategy) => strategy.using !== "workflow");
            addStep(added)(op);
          });
          expect(() => save(flow.root, record.id)).toThrow(
            "op search can't be saved: its workflow runs javascript_tool, a step no record holds",
          );
        }
      });

      it("saves the recorded steps' arguments, not the draft's", () => {
        const recorded = [step("navigate", { url: `${origin}/` })];
        const read = { ...page, id: "r_read", url: `${origin}/read`, type: "XHR" };
        const flow = recordFlow({ commands: recorded, origin, trace: [read] });
        const { record } = flow.stopped();
        edit(flow.root, record.id, (op) => {
          (strategyOf(op, "workflow").steps as Entry[])[0].args = { url: "https://bob.github.io/" };
          Object.assign(strategyOf(op, "workflow"), { onError: "continue", stepDelay: 0 });
        });
        expect(strategyOf(savedOp(save(flow.root, record.id)), "workflow")).toEqual({
          using: "workflow",
          steps: [{ cmd: "navigate", args: { url: `${origin}/` } }],
        });
        const click = recordFlow({
          commands: ["click"],
          origin,
          trace: [{ ...page, url: `${origin}/` }, write],
        });
        const stopped = click.stopped();
        edit(click.root, stopped.record.id, (op) => {
          (strategyOf(op, "workflow").steps as Entry[])[0].args = { selector: "#delete-all" };
        });
        expect(strategyOf(savedOp(save(click.root, stopped.record.id)), "workflow").steps).toEqual([
          { cmd: "click", args: {} },
        ]);
      });
    });

    describe("the request --request-id names", () => {
      const trace = [
        { ...page, url: `${origin}/` },
        { ...write, id: "r_other", url: "https://bob.github.io/save" },
      ];
      const prefixes: Record<string, string> = {
        "no steps": "write op search can't be saved network-only",
        "one click": "write op search can't be saved",
        "navigate + click": "write op search can't be saved network-only",
      };

      describe.each(shapes)("with %s", (shape, commands) => {
        it("takes it from pb save or pb record stop, not from the draft's provenance", () => {
          const flow = recordFlow({ commands, origin, trace });
          const { record } = flow.stopped();
          edit(
            flow.root,
            record.id,
            (op) => (op.provenance = { recordId: record.id, requestId: "r_other" }),
          );
          expect(() => save(flow.root, record.id)).toThrow(
            `${prefixes[shape]}: it would replay POST https://bob.github.io/save, whose origin (https://bob.github.io) isn't the record's page origin (${origin}); name it with --request-id r_other to replay it anyway`,
          );
        });

        it("keeps the one pb record stop --request-id named in the record", () => {
          const flow = recordFlow({
            commands,
            origin,
            trace,
            stop: { draft: true, requestId: "r_other" },
          });
          const { record } = flow.stopped();
          expect(records.readRecord(record.id, flow.root).requestId).toBe("r_other");
          edit(
            flow.root,
            record.id,
            (op) => (op.provenance = { recordId: "rec-0-forged", requestId: "r_forged" }),
          );
          const saved = save(flow.root, record.id);
          expect(saved.origins).toEqual([origin, "https://bob.github.io"]);
          expect(savedOp(saved).provenance).toEqual({ recordId: record.id, requestId: "r_other" });
        });
      });
    });

    describe("a captured {{…}}", () => {
      const literal = {
        ...write,
        url: `${origin}/save?note={{review_key}}`,
        requestHeaders: { "content-type": "application/json", "x-note": "{{review_key}}" },
        requestBody: '{"action":"{{action}}","key":"{{review_key}}"}',
      };
      const flow = (commands: Step[]) => {
        const recorded = recordFlow({
          commands,
          origin,
          trace: [{ ...page, url: `${origin}/` }, literal],
          includeInputValues: true,
        });
        return { root: recorded.root, record: recorded.stopped().record };
      };
      const sent = (op: Op, provided: Entry) =>
        renderRequest(strategyOf(op, "network").request, resolveArgValues(op.args, provided));

      describe.each(shapes)("with %s", (_shape, commands) => {
        it("is sent as the record captured it, whatever the review key", () => {
          const { root, record } = flow(commands);
          const request = sent(savedOp(save(root, record.id)), { review_key: "k-1" });
          expect(request).toMatchObject({
            url: `${origin}/save`,
            query: { note: "{{review_key}}" },
            headers: { "x-note": "{{review_key}}" },
            body: '{"action":"{{action}}","key":"{{review_key}}"}',
          });
        });

        it("refuses an input the record didn't draft", () => {
          const { root, record } = flow(commands);
          edit(
            root,
            record.id,
            (op) => (op.args = { ...op.args, action: { default: "deleteAll" } }),
          );
          expect(() => save(root, record.id)).toThrow(
            "write op search can't be saved: its input action isn't one the record drafts (review_key); make inputs after save with surf pb param",
          );
        });

        it("refuses a drafted input changed beyond its desc, and keeps a new desc", () => {
          const { root, record } = flow(commands);
          edit(root, record.id, (op) =>
            Object.assign(op.args?.review_key ?? {}, { default: "deleteAll" }),
          );
          expect(() => save(root, record.id)).toThrow(
            "write op search can't be saved: its input review_key is drafted as {\"required\":true}, and a draft may change only an input's desc",
          );
          edit(
            root,
            record.id,
            (op) => (op.args = { review_key: { required: true, desc: "Order key" } }),
          );
          expect(savedOp(save(root, record.id)).args).toEqual({
            review_key: { required: true, desc: "Order key" },
          });
        });
      });

      it("stays literal after pb param makes another field an input", () => {
        const { root, record } = flow(["click"]);
        const saved = savedOp(save(root, record.id));
        const { op } = paramOp(saved, { fields: ["body.action"], as: "verb" });
        expect(op.args.verb).toEqual({ type: "string", default: "{{action}}" });
        expect(sent(op, { review_key: "k-1" }).body).toEqual({
          action: "{{action}}",
          key: "{{review_key}}",
        });
        expect(sent(op, { review_key: "k-1", verb: "archive" })).toMatchObject({
          query: { note: "{{review_key}}" },
          headers: { "x-note": "{{review_key}}" },
          body: { action: "archive", key: "{{review_key}}" },
        });
      });
    });
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

// pb save --from-record takes what an op sends, and whether it needs --write, from the record:
// its effect, safety, inputs, strategies, steps and requests. draft/op.json only names and
// describes the op.
describe("what a hand-edited draft can't change", () => {
  const runtime = require("../../native/playbook-runtime.cjs");
  const origin = "https://alice.github.io";
  const home = { ...page, url: `${origin}/` };
  const write = {
    id: "r_save",
    method: "POST",
    status: 200,
    type: "XHR",
    url: `${origin}/save?action=preview`,
    requestHeaders: { "content-type": "application/json", "x-action": "preview" },
    requestBody: '{"action":"preview"}',
  };
  const read = {
    id: "r_read",
    method: "GET",
    status: 200,
    type: "XHR",
    url: `${origin}/read?q=shoes`,
    requestHeaders: { accept: "application/json" },
  };
  const DRAFTED_SAFETY = {
    authorization: "explicit",
    duplicate: "transactional",
    key: ["review_key"],
  };
  type Request = Entry & { url: string; method?: string; headers?: Entry };
  type Strategy = Entry & { using: string; request?: Request; steps?: Entry[] };
  type Op = Entry & {
    effect?: string;
    args?: Record<string, Entry>;
    safety?: Entry;
    run: Strategy[];
  };
  const flow = (options: Parameters<typeof recordFlow>[0]) => {
    const recorded = recordFlow({ origin, includeInputValues: true, ...options });
    const { record, draft } = recorded.stopped();
    const file = path.join(records.recordsRoot(recorded.root), record.id, "draft", "op.json");
    const save = (change: (op: Op) => void = () => undefined, requestId?: string) => {
      const op = JSON.parse(fs.readFileSync(file, "utf8"));
      change(op);
      fs.writeFileSync(file, JSON.stringify(op));
      return authoring.saveFromRecord({
        recordId: record.id,
        root: recorded.root,
        home: path.dirname(recorded.root),
        ...(requestId ? { requestId } : {}),
      });
    };
    const saved = (change?: (op: Op) => void, requestId?: string): Op => {
      const result = save(change, requestId);
      return JSON.parse(fs.readFileSync(path.join(result.directory, "ops", "search.json"), "utf8"));
    };
    return { root: recorded.root, record, draft: draft as Op, save, saved };
  };
  const networkOf = (op: Op) => op.run.find((strategy) => strategy.using === "network") as Strategy;
  const shapes: [string, Step[], string][] = [
    ["no steps", [], "write op search can't be saved"],
    ["one click", ["click"], "write op search can't be saved"],
    [
      "navigate + click",
      [step("navigate", { url: `${origin}/` }), "click"],
      "write op search can't be saved",
    ],
  ];
  // What the op dispatches: each tool and its arguments, run with a fake tab.
  const dispatched = async (op: Op, args: Entry = {}) => {
    const calls: { tool: string; args: Entry }[] = [];
    // The fake tab answers every tool with {}, so a network strategy fails after it sends.
    await runtime
      .runPlaybookOp({
        playbook: { id: "fixture", origins: [origin] },
        op,
        args,
        executeTool: async (tool: string, toolArgs: Entry) => {
          if (!tool.startsWith("wait")) {
            calls.push({ tool, args: toolArgs });
          }
          return { output: "{}" };
        },
        sleep: async () => undefined,
      })
      .catch(() => undefined);
    return calls;
  };

  describe.each(shapes)("a write record with %s", (_shape, commands, prefix) => {
    const writeFlow = () => flow({ commands, trace: [home, write] });

    it.each([
      [
        "an implicit, repeatable safety",
        (op: Op) =>
          Object.assign(op.safety as Entry, {
            authorization: "implicit",
            duplicate: "repeatable-window",
            windowMs: 0,
          }),
      ],
      ["no safety", (op: Op) => Reflect.deleteProperty(op, "safety")],
      ["another safety key", (op: Op) => ((op.safety as Entry).key = ["other"])],
    ])("refuses %s", (_case, change) => {
      expect(() => writeFlow().save(change)).toThrow(
        `${prefix}: its safety is drafted as ${JSON.stringify(DRAFTED_SAFETY)}, and a draft can't change it; change it on the saved op`,
      );
    });

    it.each([
      ["read", (op: Op) => (op.effect = "read")],
      ["missing", (op: Op) => Reflect.deleteProperty(op, "effect")],
    ])("refuses an effect of %s, whatever else the draft drops", (_case, change) => {
      const refusal = `op search can't be saved: the record drafts a write op (it captured POST ${origin}/save), and the draft's effect is ${_case === "read" ? '"read"' : "missing"}; a draft can't change an op's effect`;
      expect(() => writeFlow().save(change)).toThrow(refusal);
      expect(() =>
        writeFlow().save((op) => {
          change(op);
          op.run = op.run.filter((strategy) => strategy.using !== "network");
          Reflect.deleteProperty(op, "safety");
          Reflect.deleteProperty(op.args ?? {}, "review_key");
        }),
      ).toThrow(refusal);
    });

    it("refuses a draft that drops the network strategy the record drafts", () => {
      expect(() =>
        writeFlow().save((op) => {
          op.run = op.run.filter((strategy) => strategy.using !== "network");
          if (op.run.length === 0) {
            op.run.push({ using: "workflow", steps: [] });
          }
        }),
      ).toThrow(
        `${prefix}: it drops the network strategy the record drafts (POST ${origin}/save); a draft holds the record's strategies`,
      );
    });

    it("refuses a network request without a method", () => {
      expect(() =>
        writeFlow().save((op) => Reflect.deleteProperty(networkOf(op).request ?? {}, "method")),
      ).toThrow(
        `${prefix}: its network strategy has no method, and a draft keeps the method the record captured (POST ${origin}/save)`,
      );
    });

    it("refuses a read network strategy the draft adds", () => {
      expect(() =>
        writeFlow().save((op) =>
          op.run.splice(1, 0, {
            using: "network",
            request: { method: "GET", url: `${origin}/delete-all` },
          }),
        ),
      ).toThrow(
        `${prefix}: its network strategy sends GET ${origin}/delete-all, and the record drafts POST ${origin}/save`,
      );
    });

    it("saves the record's effect and safety with the draft's names and descriptions", () => {
      const saved = writeFlow().saved((op) => {
        op.description = "Save the form";
        (op.args as Record<string, Entry>).review_key.desc = "Order key";
      });
      expect(saved).toMatchObject({
        description: "Save the form",
        effect: "write",
        safety: DRAFTED_SAFETY,
        args: { review_key: { required: true, desc: "Order key" } },
      });
    });
  });

  it("refuses a click-only write op saved as a read, without its safety", () => {
    const click = flow({ commands: [step("click", { selector: "#submit" })], trace: [home] });
    expect(click.draft.effect).toBe("write");
    expect(() =>
      click.save((op) => {
        op.effect = "read";
        Reflect.deleteProperty(op, "safety");
        op.args = {};
      }),
    ).toThrow(
      "op search can't be saved: the record drafts a write op (it ran click, a page write), and the draft's effect is \"read\"; a draft can't change an op's effect",
    );
  });

  it("refuses a read record's draft saved as a write", () => {
    const reading = flow({ commands: [step("navigate", { url: `${origin}/` })], trace: [read] });
    expect(reading.draft.effect).toBe("read");
    expect(() =>
      reading.save((op) => {
        op.effect = "write";
        op.safety = DRAFTED_SAFETY;
        op.args = { review_key: { required: true } };
      }),
    ).toThrow(
      "write op search can't be saved: the record drafts a read op, and the draft's effect is \"write\"; a draft can't change an op's effect",
    );
  });

  it("keeps a read pb record stop --read drafted, at save and with --request-id at save", () => {
    const other = { ...read, id: "r_other", url: `${origin}/other?q=boots` };
    const reading = flow({
      commands: ["click"],
      trace: [read, other],
      stop: { draft: true, read: true },
    });
    expect(reading.draft.effect).toBe("read");
    expect(records.readRecord(reading.record.id, reading.root).read).toBe(true);
    expect(reading.saved()).toMatchObject({ effect: "read" });
    // The redraft takes --read from the record, not from the draft's effect.
    const redrafted = reading.saved((op) => Reflect.deleteProperty(op, "effect"), "r_other");
    expect(redrafted.effect).toBe("read");
    expect(networkOf(redrafted).request?.url).toBe(`${origin}/other`);
  });

  it("refuses an origin the draft adds to origins or auth.origins", () => {
    const both = [origin, "https://bob.github.io"];
    for (const change of [
      (draft: Op) => (draft.origins = both),
      (draft: Op) => (draft.auth = { origins: both }),
      (draft: Op) => Object.assign(draft, { origins: both, auth: { origins: both } }),
    ]) {
      const reading = flow({ trace: [read] });
      expect(() => reading.save(change)).toThrow(
        `op search can't be saved: its origins come from the record (${origin}), and a draft can't change them`,
      );
      expect(fs.existsSync(path.join(path.dirname(reading.root), ".surf"))).toBe(false);
    }
    // The record's own origins, written out, save.
    const saved = flow({ trace: [read] }).saved((draft) =>
      Object.assign(draft, { origins: [origin], auth: { origins: [origin] } }),
    );
    expect(saved).toMatchObject({ origins: [origin], auth: { origins: [origin] } });
  });

  describe("a read's network request", () => {
    const captured = {
      method: "GET",
      url: `${origin}/read`,
      query: { q: "shoes" },
      headers: { accept: "application/json" },
    };

    it.each([
      ["no steps", [] as Step[]],
      ["a navigate", [step("navigate", { url: `${origin}/` })]],
    ])("is the captured request with %s, whatever the draft edits", async (_shape, commands) => {
      const reading = flow({ commands, trace: [read] });
      expect(reading.draft.effect).toBe("read");
      const op = reading.saved((draft) => {
        const request = networkOf(draft).request as Request;
        request.url = `${origin}/read?q=deleteAll`;
        request.headers = { ...request.headers, "x-edited": "yes" };
        request.body = "edited";
      });
      expect(networkOf(op).request).toEqual(captured);
      expect(op.origins).toEqual([origin]);
      const tab = captureTab();
      await runtime.runPlaybookOp({
        playbook: { id: "fixture", origins: [origin] },
        op: { ...op, run: [networkOf(op)] },
        executeTool: tab.executeTool,
      });
      const [url, init] = tab.fetchImpl.mock.calls[0] as [string, Entry];
      expect(url).toBe(`${origin}/read?q=shoes`);
      expect(init).toMatchObject({ method: "GET", headers: { accept: "application/json" } });
      expect(init.body).toBeUndefined();
    });

    it.each([
      ["another site", "https://bob.github.io/uncaptured"],
      ["another path", `${origin}/uncaptured`],
    ])("refuses a URL on %s", (_case, url) => {
      expect(() =>
        flow({ trace: [read] }).save((op) => {
          const request = networkOf(op).request as Request;
          request.url = url;
          request.headers = { "x-edited": "yes" };
        }),
      ).toThrow(
        `op search can't be saved: its network strategy sends GET ${url}, and the record drafts GET ${origin}/read; save again with --request-id <r_…> to replay another captured request`,
      );
    });

    it("refuses a request without a method", () => {
      expect(() =>
        flow({ trace: [read] }).save((op) =>
          Reflect.deleteProperty(networkOf(op).request ?? {}, "method"),
        ),
      ).toThrow(
        `op search can't be saved: its network strategy has no method, and a draft keeps the method the record captured (GET ${origin}/read)`,
      );
    });

    it("refuses a network strategy a record that drafts none gets", () => {
      expect(() =>
        flow({
          commands: [step("navigate", { url: `${origin}/` })],
          trace: [{ ...home, type: "Image", url: `${origin}/logo.png` }],
        }).save((op) =>
          op.run.unshift({ using: "network", request: { method: "GET", url: `${origin}/` } }),
        ),
      ).toThrow(
        `op search can't be saved: its network strategy sends GET ${origin}/, and the record drafts no network strategy`,
      );
    });
  });

  describe("recorded step arguments", () => {
    it("are sent as recorded, a selector holding {{review_key}} or %{review_key} too", async () => {
      const selector = '[data-x="{{review_key}}"] .a-%{review_key}';
      const click = flow({ commands: [step("click", { selector })] });
      const op = click.saved();
      expect(op.args).toEqual({ review_key: records.REVIEW_KEY_ARG });
      expect(await dispatched(op, { review_key: "deleteAll" })).toEqual([
        { tool: "click", args: { selector } },
      ]);
    });

    it("are sent as recorded in a URL and a locate name", async () => {
      const url = `${origin}/p?q={{x}}&r=%{x}&s={{_open}}`;
      const reading = flow({
        commands: [step("navigate", { url }), step("locate.role", { role: "link", name: "{{x}}" })],
      });
      expect(reading.draft.effect).toBe("read");
      const calls = await dispatched(reading.saved());
      expect(calls.map((call) => call.args)).toEqual([{ url }, { role: "link", name: "{{x}}" }]);
    });

    it("keep a recorded input as an input", async () => {
      const typed = flow({ commands: [step("type", { text: "<text>", selector: "#q{{text}}" })] });
      const op = typed.saved();
      expect(op.args).toEqual({ text: { required: true, desc: "Recorded text" } });
      expect(await dispatched(op, { text: "hello" })).toEqual([
        { tool: "type", args: { text: "hello", selector: "#q{{text}}" } },
      ]);
    });
  });
});
