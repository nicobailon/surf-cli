import { afterEach, describe, expect, it } from "vitest";
import { captureTab } from "../fixtures/capture-tab";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const journal = require("../../native/activity-journal.cjs");
const authoring = require("../../native/playbook-authoring.cjs");
const records = require("../../native/playbook-records.cjs");
const { paramOp } = require("../../native/playbook-param.cjs");
const {
  escapedOp,
  renderRequest,
  resolveArgValues,
} = require("../../native/playbook-template.cjs");
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

// Every file under `directory`, joined, so a test can search all of it for a value.
const everyFile = (directory: string): string =>
  fs
    .readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry: { isFile: () => boolean }) => entry.isFile())
    .map((entry: { parentPath: string; name: string }) =>
      fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8"),
    )
    .join("\n");

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

  describe("a live sample of a response that reflects what was sent", () => {
    // Dummy values, built from parts so no literal here reads as a credential.
    const TYPED = ["dummy", "typed", "6"].join("-");
    const AUTH = ["dummy", "auth", "6", 'with"quote'].join("-");
    const reflecting = (extra: Entry = {}) => ({
      id: "r_p",
      method: "GET",
      status: 200,
      type: "XHR",
      mimeType: "application/json",
      url: "https://a.test/p",
      responseBody: JSON.stringify({
        people: [{ name: "Jane Placeholder", searched: TYPED, auth: `got ${AUTH}` }],
      }),
      ...extra,
    });
    const typedEvent = (value: string) => ({
      type: "browser.event",
      event: "input",
      selector: "#q",
      value,
      timestamp: new Date().toISOString(),
    });
    const sampleOf = (record: Entry, root: string, entry: Entry) =>
      records.recordCandidates(record, { root, live: { entries: [entry], pageText: "" } });

    it("redacts the text the record typed, when the record kept it", () => {
      const root = tempRoot();
      const record = records.startRecord({
        site: "a",
        op: "one",
        tabId: 11,
        network: true,
        includeInputValues: true,
        root,
      });
      records.appendRecordEvent(typedEvent(TYPED), { target: { tabId: 11 }, root });
      const result = sampleOf(record, root, reflecting());
      expect(result.candidates[0].sample).toContain("Jane Placeholder");
      expect(result.candidates[0].sample).toContain("<redacted>");
      expect(JSON.stringify(result)).not.toContain(TYPED);
    });

    it("leaves the sample out when the record typed text it didn't keep", () => {
      const root = tempRoot();
      const record = records.startRecord({ site: "a", op: "one", tabId: 11, network: true, root });
      records.appendRecordEvent(typedEvent("<input>"), { target: { tabId: 11 }, root });
      const result = sampleOf(record, root, reflecting());
      expect(result.candidates[0]).not.toHaveProperty("sample");
      expect(result.warnings?.join("\n")).toMatch(/typed/);
      expect(JSON.stringify(result)).not.toContain(TYPED);
    });

    it("redacts the secret header values the request carried, JSON-escaped too", () => {
      const root = tempRoot();
      const record = records.startRecord({ site: "a", op: "one", tabId: 11, network: true, root });
      const result = sampleOf(
        record,
        root,
        reflecting({ requestHeaders: { Authorization: AUTH } }),
      );
      const { sample } = result.candidates[0];
      expect(sample).toContain("Jane Placeholder");
      expect(sample).not.toContain(JSON.stringify(AUTH).slice(1, -1));
      expect(sample).not.toContain("dummy-auth-6");
    });
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

    // Its inputs and duplicate key come from what it sends: a check naming {{text}} keeps neither.
    it.each([
      ["verify", { verify: { truthy: true, note: "{{text}}" } }],
      ["expect", { expect: { truthy: true, note: "{{text}}" } }],
      ["extract", { extract: { jsonPath: "$.{{text}}" } }],
    ])("keeps the record's key and inputs whatever its %s names", (_case, check) => {
      const saveWith = (checks: Entry) => {
        const { root, stopped } = recordFlow({ commands: [typed, "click"], trace: [page, create] });
        const { record } = stopped();
        const file = path.join(records.recordsRoot(root), record.id, "draft", "op.json");
        const draft = JSON.parse(fs.readFileSync(file, "utf8"));
        Object.assign(draft.run[0], checks);
        fs.writeFileSync(file, JSON.stringify(draft));
        return savedOp(
          authoring.saveFromRecord({ recordId: record.id, root, home: path.dirname(root) }),
        );
      };
      const plain = saveWith({});
      const checked = saveWith(check);
      expect(checked.safety).toEqual(plain.safety);
      expect(checked.args).toEqual(plain.args);
      expect(checked.safety.key).toEqual(["review_key"]);
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

      it("refuses a second network write, even one that stands for the captured one", () => {
        const { draft, save } = flow(commands);
        const drafted = draft.run.map((strategy: Strategy) => strategy.using);
        const given = [drafted[0], ...drafted].join(", then ");
        expect(() =>
          save((op) => {
            const copy = structuredClone(networkOf(op));
            (copy.request as Request).query = { action: "deleteAll" };
            op.run.splice(1, 0, copy);
          }),
        ).toThrow(
          `write op search can't be saved: its strategies are ${given}, and the record drafts ${drafted.join(", then ")}; a draft can't change which strategies run, their order or how many there are`,
        );
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
            (op) =>
              (op.provenance = { recordId: "rec-0-forged", requestId: "r_forged", escaped: false }),
          );
          const saved = save(flow.root, record.id);
          expect(saved.origins).toEqual([origin, "https://bob.github.io"]);
          // The saver marks the op's text as escaped, whatever the draft says.
          expect(savedOp(saved).provenance).toEqual({
            recordId: record.id,
            requestId: "r_other",
            escaped: true,
          });
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
      // Rendered as the runtime renders the saved op, with the escape its provenance marks.
      const sent = (op: Op, provided: Entry) =>
        renderRequest(strategyOf(op, "network").request, resolveArgValues(op.args, provided), {
          escapes: escapedOp(op),
        });

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

  it.each(["%{term}", "#q{{term}}", "{{term}}", "%{_open}", "{{!}}", "%{!}"])(
    "saves recent activity with a recorded literal %s that is sent as recorded, not filled",
    async (selector) => {
      const root = tempRoot();
      const home = path.dirname(root);
      journal.journalCommand("search", { term: "dummy" }, { root });
      journal.journalCommand("hover", { selector }, { root });
      const saved = authoring.saveFromRecent({ site: "fixture", op: "recent", root, home });
      const op = JSON.parse(
        fs.readFileSync(path.join(saved.directory, "ops", "recent.json"), "utf8"),
      );
      expect(op.args).toEqual({ term: { required: true, desc: "Recorded term" } });
      const sent: Array<{ tool: string; args: Record<string, unknown> }> = [];
      await require("../../native/playbook-runtime.cjs").runPlaybookOp({
        playbook: { id: "fixture", origins: [] },
        op,
        args: { term: "#OTHER" },
        executeTool: async (tool: string, args: Record<string, unknown>) => {
          sent.push({ tool, args });
          return { output: "{}" };
        },
        sleep: async () => undefined,
      });
      expect(sent).toEqual([
        { tool: "search", args: { term: "#OTHER" } },
        { tool: "hover", args: { selector } },
      ]);
    },
  );

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

  it.each(["click", "hover"])(
    "keeps locate.role --action %s, redacting only its name",
    (action) => {
      const args = { role: "button", name: "Save", action };
      expect(redactCommandArgs("locate.role", args)).toEqual({ ...args, name: "<name>" });
    },
  );

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

  // The record decides which strategies run, in what order and how many: a draft can't put the
  // click before the captured request, or run a strategy twice.
  describe("the strategies", () => {
    const writeClick = () => flow({ commands: ["click"], trace: [home, write] });
    const readFlow = () =>
      flow({ commands: [step("navigate", { url: `${origin}/extra` })], trace: [read] });
    const refusal = (prefix: string, given: string) =>
      `${prefix}: its strategies are ${given}, and the record drafts network, then workflow; a draft can't change which strategies run, their order or how many there are`;

    it.each([
      ["reversed", (op: Op) => op.run.reverse(), "workflow, then network"],
      [
        "with the network strategy twice",
        (op: Op) => op.run.splice(1, 0, structuredClone(op.run[0])),
        "network, then network, then workflow",
      ],
      ["without the workflow", (op: Op) => op.run.pop(), "network"],
    ])("refuses a write draft's strategies %s", (_case, change, given) => {
      expect(writeClick().draft.run.map((strategy) => strategy.using)).toEqual([
        "network",
        "workflow",
      ]);
      expect(() => writeClick().save(change)).toThrow(
        refusal("write op search can't be saved", given),
      );
    });

    it("refuses a write draft's workflow twice", () => {
      expect(() => writeClick().save((op) => op.run.push(structuredClone(op.run[1])))).toThrow(
        "write op search can't be saved: it has 2 workflow strategies, and a record drafts one",
      );
    });

    it("refuses a read draft's strategies reversed, or its network strategy twice", () => {
      expect(() => readFlow().save((op) => op.run.reverse())).toThrow(
        refusal("op search can't be saved", "workflow, then network"),
      );
      expect(() =>
        readFlow().save((op) => {
          (op.run[0] as Entry).verify = { status: 201 };
          op.run.splice(1, 0, { using: "network", request: op.run[0].request });
        }),
      ).toThrow(refusal("op search can't be saved", "network, then network, then workflow"));
    });

    it("saves the record's order with the draft's checks", () => {
      const saved = writeClick().saved((op) => ((op.run[0] as Entry).verify = { status: 200 }));
      expect(saved.run.map((strategy) => strategy.using)).toEqual(["network", "workflow"]);
      expect(saved.run[0].verify).toEqual({ status: 200 });
    });
  });

  // A draft's checks may make an op saved from a record fail, never send more: once a strategy's
  // request is answered (or a workflow step has run), a failure is the op's.
  describe("a failed check", () => {
    const readFlow = () =>
      flow({ commands: [step("navigate", { url: `${origin}/extra` })], trace: [read] });
    const answered = `${origin}/answered`;
    // A tab whose requests come back with `status` (200) and show in network capture, or fail
    // before reaching the server (`unreached`). It notes each tool that sends something: capture
    // reads send nothing.
    const fakeTab = ({
      unreached = false,
      status = 200,
    }: {
      unreached?: boolean;
      status?: number;
    }) => {
      const calls: string[] = [];
      const captured: Entry[] = [];
      const send = (code: unknown) => {
        if (unreached) {
          return { error: "TypeError: Failed to fetch" };
        }
        const method = /method: "([A-Z]+)"/.exec(String(code))?.[1];
        const now = Date.now();
        captured.push({
          id: "c_1",
          method,
          url: answered,
          status,
          ts: now,
          flags: [],
          _loadingFinished: true,
        });
        const ok = status >= 200 && status < 300;
        const head = { status, ok, requestUrl: answered, url: answered, headers: {} };
        return { output: JSON.stringify({ ...head, sentAt: now, doneAt: now }) };
      };
      const reads: Record<string, () => unknown> = {
        network: () => ({ entries: captured }),
        "network.body": () => ({ body: '{"ok":true}' }),
      };
      const executeTool = async (tool: string, toolArgs: Entry) => {
        const capture = reads[tool];
        if (capture) {
          return capture();
        }
        if (!tool.startsWith("wait")) {
          calls.push(tool);
        }
        return tool === "javascript_tool" ? send(toolArgs.code) : { output: "{}" };
      };
      return { calls, executeTool };
    };
    const run = async (saved: Op, args: Entry = {}, answer: Parameters<typeof fakeTab>[0] = {}) => {
      const tab = fakeTab(answer);
      let error = "";
      await runtime
        .runPlaybookOp({
          playbook: { id: "fixture", origins: [origin] },
          op: saved,
          args,
          executeTool: tab.executeTool,
          sleep: async () => undefined,
        })
        .catch((caught: Error) => {
          error = caught.message;
        });
      return { calls: tab.calls, error };
    };

    it.each([
      ["verify", (op: Op) => ((op.run[0] as Entry).verify = { status: 201 })],
      ["expect", (op: Op) => ((op.run[0] as Entry).expect = { status: 201 })],
      ["on.success.expect", (op: Op) => (op.on = { success: { expect: { status: 201 } } })],
    ])("in a read's %s is final: the recorded workflow doesn't run", async (_case, change) => {
      const { calls, error } = await run(readFlow().saved(change));
      expect(calls).toEqual(["javascript_tool"]);
      expect(error).toMatch(/^network strategy failed after its request was answered: /);
    });

    it("in a write is final: the click doesn't run after the POST", async () => {
      const saved = flow({ commands: ["click"], trace: [home, write] }).saved(
        (op) => ((op.run[0] as Entry).verify = { status: 201 }),
      );
      const { calls, error } = await run(saved, { review_key: "k" });
      expect(calls).toEqual(["javascript_tool"]);
      expect(error).toBe("expected status 201");
    });

    it("still lets a read whose request never reached the server run the recorded workflow", async () => {
      const saved = readFlow().saved((op) => ((op.run[0] as Entry).verify = { status: 201 }));
      expect(await run(saved, {}, { unreached: true })).toEqual({
        calls: ["javascript_tool", "navigate"],
        error: "",
      });
    });

    // The runtime's own status check isn't a draft's: the recorded workflow is the read's fallback.
    it.each([401, 500])("lets a read answered %i run the recorded workflow", async (status) => {
      expect(await run(readFlow().saved(), {}, { status })).toEqual({
        calls: ["javascript_tool", "navigate"],
        error: "",
      });
    });

    it("in a read's extract is final", async () => {
      const saved = readFlow().saved(
        (op) => ((op.run[0] as Entry).extract = { jsonPath: "$.missing" }),
      );
      const { calls, error } = await run(saved);
      expect(calls).toEqual(["javascript_tool"]);
      expect(error).toMatch(/^network strategy failed after its request was answered: /);
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
      const url = `${origin}/p?q={{x}}&r=%{x}&s={{_open}}&t={{!}}&u=%{!}&v=%{_open}`;
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

describe("values typed during a record, in captured URLs", () => {
  const { redactCommandArgs } = require("../../native/workflow-definition.cjs");
  const {
    findRedactedPlaceholder,
    placeholderError,
  } = require("../../native/record-typed-values.cjs");
  const runtime = require("../../native/playbook-runtime.cjs");
  const TYPED = "dummy echo words";
  const FILLED = "dummyfoxtrot";
  const hostEvent = (command: string, args: Entry) => ({
    type: "tool.completed",
    command,
    argsRedacted: redactCommandArgs(command, args),
    startedAt: new Date().toISOString(),
  });
  const typeArgs = { selector: "#q", text: TYPED };
  const fillArgs = { label: "City", action: "fill", value: FILLED };
  const search = {
    id: "r_1",
    method: "GET",
    status: 200,
    type: "XHR",
    url: `https://example.test/api/search?q=${encodeURIComponent(TYPED).replace(/%20/g, "+")}&page=1`,
    tabUrl: `https://example.test/search/${encodeURIComponent(FILLED)}?term=${encodeURIComponent(TYPED)}`,
    requestHeaders: {
      accept: "application/json",
      referer: `https://example.test/?q=${TYPED.replace(/ /g, "+")}`,
    },
    responseHeaders: { "content-type": "application/json" },
  };
  function recordSearch(includeInputValues: boolean) {
    const root = tempRoot();
    const home = path.dirname(root);
    const record = records.startRecord({
      site: "fixture",
      op: "search",
      tabId: 1,
      origin: "https://example.test",
      network: true,
      includeInputValues,
      root,
    });
    records.appendRecordEvent(hostEvent("type", typeArgs), { target: TAB, root, args: typeArgs });
    records.appendRecordEvent(hostEvent("locate.label", fillArgs), {
      target: TAB,
      root,
      args: fillArgs,
    });
    records.attachNetworkTrace(record.id, [search], root, { capture: COMPLETE });
    const { draft } = records.stopRecord({ target: TAB, draft: true, read: true, root });
    authoring.saveFromRecord({ recordId: record.id, root, home });
    authoring.exportRecordHar(record.id, path.join(home, "trace.har"), root);
    return { root, home, record, draft };
  }

  it("puts <text> and <value> where the typed values were, in the trace, draft, playbook and HAR", () => {
    const { root, home, record, draft } = recordSearch(false);
    const trace = JSON.parse(
      fs.readFileSync(
        path.join(records.recordsRoot(root), record.id, "network", "trace.json"),
        "utf8",
      ),
    );
    expect(trace.entries[0].url).toBe("https://example.test/api/search?q=<text>&page=1");
    expect(trace.entries[0].tabUrl).toBe("https://example.test/search/<value>?term=<text>");
    expect(trace.entries[0].requestHeaders.referer).toBe("https://example.test/?q=<text>");
    const network = draft.run.find((strategy: { using: string }) => strategy.using === "network");
    expect(network.request.query).toEqual({ q: "<text>", page: "1" });
    const written = everyFile(home);
    expect(written).toContain("<text>");
    for (const form of [TYPED, encodeURIComponent(TYPED), TYPED.replace(/ /g, "+"), FILLED]) {
      expect(written).not.toContain(form);
    }
  });

  it("keeps the URLs as captured in a record started with --include-input-values", () => {
    const { draft, home } = recordSearch(true);
    const network = draft.run.find((strategy: { using: string }) => strategy.using === "network");
    expect(network.request.query).toEqual({ q: TYPED, page: "1" });
    expect(everyFile(home)).toContain(FILLED);
  });

  it("lets pb param name a redacted value, taking over the step that typed it", () => {
    const { draft } = recordSearch(false);
    const { op, notes } = paramOp(draft, { fields: ["query.q"], as: "q" });
    const network = op.run.find((strategy: { using: string }) => strategy.using === "network");
    expect(network.request.query.q).toBe("{{q}}");
    expect(op.args.q).toEqual({ type: "string", required: true });
    expect(op.args).not.toHaveProperty("text");
    const workflow = op.run.find((strategy: { using: string }) => strategy.using === "workflow");
    expect(workflow.steps[0].args.text).toBe("{{q}}");
    expect(notes.join("\n")).toMatch(/redacted/);
  });

  it("gives each typing step its own placeholder, which pb param links to that step", () => {
    const root = tempRoot();
    const record = records.startRecord({
      site: "fixture",
      op: "search",
      tabId: 1,
      origin: "https://example.test",
      network: true,
      root,
    });
    for (const text of ["dummy first words", "dummy second words"]) {
      const args = { selector: "#q", text };
      records.appendRecordEvent(hostEvent("type", args), { target: TAB, root, args });
    }
    const url = "https://example.test/api?a=dummy+first+words&b=dummy+second+words";
    records.attachNetworkTrace(record.id, [{ ...search, url, tabUrl: undefined }], root, {
      capture: COMPLETE,
    });
    const { draft } = records.stopRecord({ target: TAB, draft: true, read: true, root });
    const network = draft.run.find((strategy: { using: string }) => strategy.using === "network");
    expect(network.request.query).toEqual({ a: "<text>", b: "<text-2>" });
    const typing = (op: typeof draft) =>
      op.run
        .find((candidate: { using: string }) => candidate.using === "workflow")
        .steps.filter((item: { tool: string }) => item.tool === "type")
        .map((item: { args: Entry }) => item.args.text);
    expect(typing(draft)).toEqual(["{{text}}", "{{text-2}}"]);
    const named = paramOp(paramOp(draft, { fields: ["query.a"], as: "first" }).op, {
      fields: ["query.b"],
      as: "second",
    }).op;
    expect(typing(named)).toEqual(["{{first}}", "{{second}}"]);
    expect(Object.keys(named.args).sort()).toEqual(["first", "second"]);
  });

  // Types each text, captures `url` (and `tabUrl`), and stops with a draft.
  function draftTyping(texts: string[], url: string, tabUrl?: string) {
    const root = tempRoot();
    const record = records.startRecord({
      site: "fixture",
      op: "search",
      tabId: 1,
      origin: "https://example.test",
      network: true,
      root,
    });
    for (const text of texts) {
      const args = { selector: "#q", text };
      records.appendRecordEvent(hostEvent("type", args), { target: TAB, root, args });
    }
    records.attachNetworkTrace(record.id, [{ ...search, url, tabUrl }], root, {
      capture: COMPLETE,
    });
    const { draft } = records.stopRecord({ target: TAB, draft: true, read: true, root });
    const trace = JSON.parse(
      fs.readFileSync(
        path.join(records.recordsRoot(root), record.id, "network", "trace.json"),
        "utf8",
      ),
    );
    return { draft, trace, record, root };
  }
  const networkOf = (op: { run: Array<{ using: string; request?: Entry }> }) =>
    op.run.find((strategy) => strategy.using === "network")?.request as Record<string, any>;

  it("keeps a JSON query param valid when a typed number is redacted, so pb param can name it", () => {
    const variables = JSON.stringify({ year: 2024, live: true });
    const { draft } = draftTyping(
      ["2024"],
      `https://example.test/graphql?variables=${encodeURIComponent(variables)}`,
    );
    expect(JSON.parse(networkOf(draft).query.variables)).toEqual({ year: "<text>", live: true });
    const { op } = paramOp(draft, { fields: ["query.variables.year"], as: "year" });
    expect(op.args.year).toEqual({ type: "number", required: true });
    expect(networkOf(op)).not.toHaveProperty("redactedTypes");
    const rendered = renderRequest(networkOf(op), { year: 2031 });
    expect(JSON.parse(rendered.query.variables)).toEqual({ year: 2031, live: true });
    expect(findRedactedPlaceholder(networkOf(op))).toBeNull();
  });

  it("replays a typed year it masked in GraphQL variables as a number", async () => {
    const { draft } = draftTyping(
      ["2024"],
      "https://example.test/graphql?variables=%7B%22year%22:2024%7D&op=dummy",
    );
    expect(networkOf(draft).query).toEqual({ variables: '{"year":"<text>"}', op: "dummy" });
    expect(networkOf(draft).redactedTypes).toEqual({ "query.variables.year": "number" });
    const { op } = paramOp(draft, { fields: ["query.variables.year"], as: "year" });
    // The endpoint refuses a year sent as a string.
    const tab = captureTab({
      reply: (url: string) => {
        const year = JSON.parse(new URL(url).searchParams.get("variables") as string).year;
        return Number.isInteger(year)
          ? { body: JSON.stringify({ year }) }
          : { status: 400, body: '{"error":"year must be an integer"}' };
      },
    });
    const result = await runtime.runPlaybookOp({
      playbook: { id: "fixture" },
      op: {
        ...op,
        run: op.run.filter((strategy: { using: string }) => strategy.using === "network"),
      },
      args: { year: "2031" },
      executeTool: tab.executeTool,
    });
    expect(result).toMatchObject({ status: "completed", strategy: "network" });
    expect(result.value.bodyJson).toEqual({ year: 2031 });
    const sent = new URL(tab.fetchImpl.mock.calls[0][0]);
    expect(sent.searchParams.get("variables")).toBe('{"year":2031}');
  });

  // The JSON param is stored escaped as one string, so its keys read {{!}}field}} there; the record
  // names the masked values by their captured keys. pb param does too, and keeps their types.
  it("replays a masked number and boolean under JSON keys that read like inputs with their types", () => {
    const variables = JSON.stringify({ "{{field}}": 2024, "{{flag}}": true, "{{!}}kept": "seed" });
    const { record, root } = draftTyping(
      ["2024", "true"],
      `https://example.test/g?v=${encodeURIComponent(variables)}`,
    );
    const { directory } = authoring.saveFromRecord({
      recordId: record.id,
      root,
      home: path.dirname(root),
    });
    const saved = JSON.parse(fs.readFileSync(path.join(directory, "ops", "search.json"), "utf8"));
    expect(networkOf(saved).redactedTypes).toEqual({
      "query.v.{{field}}": "number",
      "query.v.{{flag}}": "boolean",
    });
    const year = paramOp(saved, { fields: ["query.v.{{field}}"], as: "year" }).op;
    const { op } = paramOp(year, { fields: ["query.v.{{flag}}"], as: "live" });
    expect(op.args.year).toEqual({ type: "number", required: true });
    expect(op.args.live).toEqual({ type: "boolean", required: true });
    expect(networkOf(op)).not.toHaveProperty("redactedTypes");
    const args = resolveArgValues(op.args, { year: "2031", live: "false" });
    const rendered = renderRequest(networkOf(op), args, { escapes: escapedOp(op) });
    expect(JSON.parse(rendered.query.v)).toEqual({
      "{{field}}": 2031,
      "{{flag}}": false,
      "{{!}}kept": "seed",
    });
    // The stored spelling isn't a captured key.
    expect(() => paramOp(saved, { fields: ["query.v.{{!}}field}}"], as: "year" })).toThrow(
      'query.v.{{!}}field}}: no "{{!}}field}}" at the top level (has: {{field}}, {{flag}}, {{!}}kept)',
    );
  });

  // pb param stores the parsed JSON with its captured key {{text}} escaped, as {{!}}text}}, which
  // takes no input and is sent as captured, so the drafted --text input still goes once its typing
  // step takes --year.
  it("drops the drafted input when a JSON key that reads like it holds the masked value", () => {
    const variables = JSON.stringify({ "{{text}}": 2024 });
    const { record, root } = draftTyping(
      ["2024"],
      `https://example.test/g?v=${encodeURIComponent(variables)}`,
    );
    const { directory } = authoring.saveFromRecord({
      recordId: record.id,
      root,
      home: path.dirname(root),
    });
    const saved = JSON.parse(fs.readFileSync(path.join(directory, "ops", "search.json"), "utf8"));
    expect(Object.keys(saved.args)).toEqual(["text"]);
    const { op, notes } = paramOp(saved, { fields: ["query.v.{{text}}"], as: "year" });
    expect(networkOf(op).query).toEqual({ v: { "{{!}}text}}": "{{year}}" } });
    expect(Object.keys(op.args)).toEqual(["year"]);
    const sent = renderRequest(networkOf(op), { year: 2031 }, { escapes: escapedOp(op) });
    expect(JSON.parse(sent.query.v)).toEqual({ "{{text}}": 2031 });
    expect(notes).toContain("input text is now year");
    const workflow = op.run.find((strategy: { using: string }) => strategy.using === "workflow");
    expect(workflow.steps.map((item: { args: Entry }) => item.args.text)).toEqual(["{{year}}"]);
  });

  it("keeps a query key the URL sends twice in the URL, masked, with no type, and never sends it", () => {
    const pair = (year: string) => `v=${encodeURIComponent(`{"year":${year}}`)}`;
    const { draft, trace } = draftTyping(
      ["2024"],
      `https://example.test/g?${pair("2024")}&${pair('"2024"')}`,
    );
    // Both pairs stay in the URL as the record masked them; the first pair's number says nothing
    // of the second's string, so the key gets no type.
    expect(trace.entries[0].urlMarkers).toHaveLength(2);
    const request = networkOf(draft);
    expect(request.query).toEqual({});
    expect(new URL(request.url).searchParams.getAll("v")).toEqual([
      '{"year":"<text>"}',
      '{"year":"<text>"}',
    ]);
    expect(request).not.toHaveProperty("redactedTypes");
    expect(request.repeatedQuery).toEqual(["v"]);
    expect(JSON.stringify(draft)).not.toContain("2024");
    const placeholder = findRedactedPlaceholder(request);
    expect(placeholder).toEqual({ field: "query.v", placeholder: "<text>", inUrl: true });
    expect(placeholderError(placeholder).message).toMatch(
      /query\.v holds <text> in the request URL.*include-input-values/,
    );
    expect(() => paramOp(draft, { fields: ["query.v.year"], as: "year" })).toThrow(
      'query.v.year: query param "v" repeats (2 values), so it stays in the request URL as captured and can\'t be an input',
    );
  });

  it("masks a JSON string leaf encoded once more in the trace and the draft", () => {
    const url = `https://example.test/g?v=${encodeURIComponent('{"q":"foo%20bar"}')}`;
    const { draft, trace } = draftTyping(["foo bar"], url);
    expect(trace.entries[0].url).toBe("https://example.test/g?v=%7B%22q%22%3A%22<text>%22%7D");
    expect(networkOf(draft).query).toEqual({ v: '{"q":"<text>"}' });
    expect(JSON.stringify(trace)).not.toMatch(/foo(%20|%2520| )bar/);
  });

  it("masks every spelling of a typed value in one JSON leaf in the trace and the draft", () => {
    const url = `https://example.test/g?v=${encodeURIComponent('{"q":"foo bar, foo%20bar"}')}`;
    const { draft, trace } = draftTyping(["foo bar"], url);
    expect(networkOf(draft).query).toEqual({ v: '{"q":"<text>"}' });
    expect(JSON.stringify([trace, draft])).not.toMatch(/foo/);
  });

  it("masks two path segments holding a typed value; pb param templates both with one input", () => {
    const { draft } = draftTyping(["users"], "https://example.test/users/users");
    expect(networkOf(draft).url).toBe("https://example.test/%3Ctext%3E/%3Ctext%3E");
    const one = paramOp(draft, { fields: ["path.2"], as: "who" });
    expect(one.notes.join("\n")).toMatch(/path\.1 holds <text> too.*path\.1 path\.2/);
    expect(findRedactedPlaceholder(networkOf(one.op))).toEqual({
      field: "path.1",
      placeholder: "<text>",
    });
    const both = paramOp(draft, { fields: ["path.1", "path.2"], as: "who" });
    expect(findRedactedPlaceholder(networkOf(both.op))).toBeNull();
    expect(renderRequest(networkOf(both.op), { who: "dummy" }).url).toBe(
      "https://example.test/dummy/dummy",
    );
  });

  it("keeps a route segment that also holds the typed value, so pb param leaves nothing redacted", () => {
    const { draft } = draftTyping(["users"], "https://example.test/api/users?q=users");
    expect(networkOf(draft).url).toBe("https://example.test/api/users");
    expect(networkOf(draft).query).toEqual({ q: "<text>" });
    const { op } = paramOp(draft, { fields: ["query.q"], as: "q" });
    expect(findRedactedPlaceholder(networkOf(op))).toBeNull();
  });

  it("replaces a whole fragment holding a slash in the trace", () => {
    const { trace } = draftTyping(
      ["dummy/slash"],
      "https://example.test/api?x=1",
      "https://example.test/page#dummy/slash",
    );
    expect(trace.entries[0].tabUrl).toBe("https://example.test/page#<text>");
  });

  it("redacts values a playbook typed in the host process during the record", () => {
    const root = tempRoot();
    const record = records.startRecord({
      site: "fixture",
      op: "search",
      tabId: 1,
      origin: "https://example.test",
      network: true,
      root,
    });
    // The host's playbook runner hands each tool call to rememberRecordInput before running it;
    // the workflow's own event comes after, without arguments.
    records.rememberRecordInput("type", typeArgs, { target: TAB, root });
    records.appendRecordEvent(hostEvent("type", typeArgs), { target: TAB, root });
    records.attachNetworkTrace(record.id, [search], root, { capture: COMPLETE });
    const { record: stopped, warnings } = records.stopRecord({ target: TAB, root });
    const trace = fs.readFileSync(
      path.join(records.recordsRoot(root), stopped.id, "network", "trace.json"),
      "utf8",
    );
    expect(trace).toContain("q=<text>");
    expect(trace).not.toContain("dummy+echo+words");
    expect(warnings).toBeUndefined();
  });

  it("warns when typing steps ran before this host held their values", () => {
    const root = tempRoot();
    const record = records.startRecord({
      site: "fixture",
      op: "search",
      tabId: 1,
      origin: "https://example.test",
      network: true,
      root,
    });
    records.appendRecordEvent(hostEvent("type", typeArgs), { target: TAB, root });
    records.attachNetworkTrace(record.id, [search], root, { capture: COMPLETE });
    const { warnings } = records.stopRecord({ target: TAB, root });
    expect(warnings.join("\n")).toMatch(
      /1 typing step entered a value this Surf host no longer holds \(it restarted during the record\), so it may remain in the trace's URLs/,
    );
  });
});

describe("values typed during a record, in watch events", () => {
  const { redactCommandArgs } = require("../../native/workflow-definition.cjs");
  const TYPED = "dummy golf words";
  const typeArgs = { selector: "#q", text: TYPED };
  const watchEvent = (event: string, url: string) => ({
    type: "browser.event",
    event,
    url,
    tabId: 1,
    timestamp: new Date().toISOString(),
  });

  it.each([false, true])(
    "puts <text> in the page URLs a watch event carries (includeInputValues %s)",
    (includeInputValues) => {
      const root = tempRoot();
      const record = records.startRecord({
        site: "fixture",
        op: "search",
        tabId: 1,
        origin: "https://example.test",
        watch: true,
        includeInputValues,
        root,
      });
      const pageTarget = { tabId: 1, page: true };
      const url = "https://example.test/get?q=dummy+golf+words&x=1";
      // A navigation the typing itself caused (type --submit) can arrive before the typing step ends.
      records.appendRecordEvent(watchEvent("navigation", url), { target: pageTarget, root });
      records.appendRecordEvent(
        {
          type: "tool.completed",
          command: "type",
          argsRedacted: redactCommandArgs("type", typeArgs, includeInputValues),
          startedAt: new Date().toISOString(),
        },
        { target: TAB, root, args: typeArgs },
      );
      records.appendRecordEvent(watchEvent("click", url), { target: pageTarget, root });
      const before = records
        .readEvents(record.id, root)
        .filter((e: Entry) => e.type === "browser.event");
      if (!includeInputValues) {
        expect(before[1].url).toBe("https://example.test/get?q=<text>&x=1");
      }
      records.stopRecord({ target: TAB, root });
      const events = records
        .readEvents(record.id, root)
        .filter((e: Entry) => e.type === "browser.event");
      const file = fs.readFileSync(
        path.join(records.recordsRoot(root), record.id, "events.jsonl"),
        "utf8",
      );
      if (includeInputValues) {
        expect(events.map((e: Entry) => e.url)).toEqual([url, url]);
      } else {
        expect(events.map((e: Entry) => e.url)).toEqual([
          "https://example.test/get?q=<text>&x=1",
          "https://example.test/get?q=<text>&x=1",
        ]);
        expect(file).not.toContain("golf");
      }
    },
  );

  function watchTyping(steps: Array<{ text: string } | { url: string }>) {
    const root = tempRoot();
    const record = records.startRecord({
      site: "fixture",
      op: "search",
      tabId: 1,
      origin: "https://example.test",
      watch: true,
      root,
    });
    for (const item of steps) {
      if ("url" in item) {
        records.appendRecordEvent(watchEvent("click", item.url), {
          target: { tabId: 1, page: true },
          root,
        });
        continue;
      }
      const args = { selector: "#q", text: item.text };
      records.appendRecordEvent(
        {
          type: "tool.completed",
          command: "type",
          argsRedacted: redactCommandArgs("type", args, false),
          startedAt: new Date().toISOString(),
        },
        { target: TAB, root, args },
      );
    }
    records.stopRecord({ target: TAB, root });
    return records
      .readEvents(record.id, root)
      .filter((e: Entry) => e.type === "browser.event")
      .map((e: Entry) => e.url);
  }

  it("keeps the placeholders already in an event's URL when it redacts again at stop", () => {
    expect(
      watchTyping([
        { text: "romeo" },
        { url: "https://example.test/get?q=romeo" },
        { text: "text" },
        { url: "https://example.test/get?q=romeo&r=text" },
      ]),
    ).toEqual([
      "https://example.test/get?q=<text>",
      "https://example.test/get?q=<text>&r=<text-2>",
    ]);
  });

  it("masks a route segment typed later while paused, though an earlier value shares the marker's name", () => {
    const root = tempRoot();
    const record = records.startRecord({
      site: "fixture",
      op: "search",
      tabId: 1,
      origin: "https://example.test",
      watch: true,
      root,
    });
    const pausedTyping = (text: string) => {
      records.pauseRecord({ target: TAB, root });
      records.rememberRecordInput("type", { selector: "#q", text }, { target: TAB, root });
      records.resumeRecord({ target: TAB, root });
    };
    pausedTyping("romeo");
    records.appendRecordEvent(watchEvent("navigation", "https://example.test/secrets?q=romeo"), {
      target: { tabId: 1, page: true },
      root,
    });
    pausedTyping("secrets");
    records.stopRecord({ target: TAB, root });
    const [event] = records
      .readEvents(record.id, root)
      .filter((e: Entry) => e.type === "browser.event");
    expect(event.url).toBe("https://example.test/<redacted>?q=<redacted>");
  });

  it("keeps an event's marker when a later step types that marker's text", () => {
    expect(
      watchTyping([
        { text: "romeo" },
        { url: "https://example.test/get?q=romeo" },
        { text: "<text>" },
        { url: "https://example.test/get?r=%3Ctext%3E" },
      ]),
    ).toEqual(["https://example.test/get?q=<text>", "https://example.test/get?r=<text-2>"]);
  });

  it("masks a route segment typed later, beside a value it couldn't read, which counts as no typed value", () => {
    // Encoded more often than the check reads, so the first pass masks it whole as <redacted>.
    const unreadable = `%${"25".repeat(1000)}41`;
    expect(
      watchTyping([
        { text: "romeo" },
        { url: `https://example.test/redacted?q=${unreadable}` },
        { text: "redacted" },
      ]),
    ).toEqual(["https://example.test/<text-2>?q=<redacted>"]);
  });

  it("replaces a whole fragment holding a slash in an event's URL", () => {
    expect(
      watchTyping([{ text: "dummy/slash" }, { url: "https://example.test/page#dummy/slash" }]),
    ).toEqual(["https://example.test/page#<text>"]);
  });
});

describe("a typed value a URL holds only on a guessed reading, through every artifact", () => {
  const { redactCommandArgs } = require("../../native/workflow-definition.cjs");
  const { serializeNetworkExport } = require("../../native/network-export.cjs");
  const TYPED = "dummy kilo words";
  const ROUTE = `https://example.test/${encodeURIComponent(TYPED)}`;
  const spelled = TYPED.replace(/ /g, "+");
  const typeArgs = { selector: "#q", text: TYPED };
  const everyPath = (directory: string) =>
    fs
      .readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry: { isFile: () => boolean }) => entry.isFile())
      .map((entry: { parentPath: string; name: string }) =>
        path.join(entry.parentPath, entry.name),
      );

  // Records typing TYPED, a navigation to `url` and one request to it, then drafts, saves and exports.
  function pipeline(url: string, request: Entry = {}) {
    const root = tempRoot();
    const home = path.join(path.dirname(root), "home");
    fs.mkdirSync(home);
    const record = records.startRecord({
      site: "fixture",
      op: "search",
      tabId: 1,
      origin: "https://example.test",
      network: true,
      watch: true,
      root,
    });
    records.appendRecordEvent(
      {
        type: "tool.completed",
        command: "type",
        argsRedacted: redactCommandArgs("type", typeArgs),
        startedAt: new Date().toISOString(),
      },
      { target: TAB, root, args: typeArgs },
    );
    records.appendRecordEvent(
      {
        type: "browser.event",
        event: "navigation",
        url,
        tabId: 1,
        timestamp: new Date().toISOString(),
      },
      { target: { tabId: 1, page: true }, root },
    );
    const entry = {
      id: "r_1",
      method: "GET",
      status: 200,
      type: "XHR",
      url,
      requestHeaders: { accept: "application/json" },
      responseHeaders: { "content-type": "application/json" },
      ...request,
    };
    records.attachNetworkTrace(record.id, [entry], root, { capture: COMPLETE });
    const { draft } = records.stopRecord({ target: TAB, draft: true, root });
    authoring.saveFromRecord({ recordId: record.id, root, home });
    authoring.exportRecordHar(record.id, path.join(home, "trace.har"), root);
    const folder = path.join(records.recordsRoot(root), record.id);
    const trace = JSON.parse(fs.readFileSync(path.join(folder, "network", "trace.json"), "utf8"));
    fs.writeFileSync(path.join(home, "export.json"), serializeNetworkExport(trace.entries, "json"));
    const events = records
      .readEvents(record.id, root)
      .filter((e: Entry) => e.type === "browser.event");
    const files = [...everyPath(home), ...everyPath(folder)];
    return { draft, trace, events, files, home, folder };
  }

  for (const next of ["/s%23q%3Dfoo%2Bbar", "./s%3Fq%3Dfoo%2Bbar", "s?q=foo+bar"].map((shape) =>
    shape.replace("foo%2Bbar", encodeURIComponent(spelled)).replace("foo+bar", spelled),
  )) {
    it(`masks the JSON value and the route in the trace, watch events, draft, op, HAR and export: ${next}`, () => {
      const url = `${ROUTE}?v=${encodeURIComponent(JSON.stringify({ next }))}`;
      const { draft, trace, events, files } = pipeline(url);
      expect(trace.entries[0].url).toBe("https://example.test/<text>?v=<text>");
      expect(events.map((e: Entry) => e.url)).toEqual(["https://example.test/<text>?v=<text>"]);
      const network = draft.run.find((strategy: { using: string }) => strategy.using === "network");
      expect(network.request.url).toBe("https://example.test/%3Ctext%3E");
      expect(network.request.query).toEqual({ v: "<text>" });
      expect(files.map((file: string) => path.basename(file))).toEqual(
        expect.arrayContaining([
          "search.json",
          "trace.har",
          "export.json",
          "op.json",
          "events.jsonl",
          "trace.json",
        ]),
      );
      for (const file of files) {
        expect(fs.readFileSync(file, "utf8")).not.toContain("kilo");
      }
    });
  }

  it("masks the route when only a guessed URL in the JSON request body holds the typed value", () => {
    const next = `/s%23q%3D${encodeURIComponent(spelled)}`;
    const { trace, files } = pipeline(ROUTE, {
      method: "POST",
      requestHeaders: { "content-type": "application/json" },
      requestBody: JSON.stringify({ next }),
    });
    expect(trace.entries[0].url).toBe("https://example.test/<text>");
    for (const file of files) {
      expect(fs.readFileSync(file, "utf8")).not.toContain("kilo");
    }
  });
});

describe("values key, network.replay --set and locate.role --name carry", () => {
  const { redactCommandArgs } = require("../../native/workflow-definition.cjs");
  // A dummy value, built from parts so no literal here reads as a credential.
  const TYPED = ["dummy", "typed", "3"].join("-");
  const commands: Array<[string, Entry, string]> = [
    ["key", { key: TYPED }, "key"],
    ["key", { text: TYPED }, "text"],
    ["network.replay", { id: "r_1", set: { "query.q": TYPED } }, "set"],
    ["locate.role", { role: "textbox", name: TYPED, action: "click" }, "name"],
  ];
  it.each(commands)("redacts %s %j", (command, args, name) => {
    expect(redactCommandArgs(command, args)[name]).toBe(`<${name}>`);
    expect(redactCommandArgs(command, args, true)[name]).toEqual(args[name]);
  });

  it.each(commands)("writes %s %j to no journal, record or draft file", (command, args) => {
    const root = tempRoot();
    journal.journalCommand(command, args, { root });
    records.startRecord({ site: "fixture", op: "flow", tabId: 1, root });
    records.appendRecordEvent(
      {
        type: "tool.completed",
        command,
        argsRedacted: redactCommandArgs(command, args),
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      },
      { target: TAB, root },
    );
    records.stopRecord({ target: TAB, draft: true, root });
    const written = everyFile(root);
    expect(written).toContain('"flow"');
    expect(written).not.toContain(TYPED);
  });
});

describe("a record's trace, when a secret header holds a short value", () => {
  // Records `entry` with --include-input-values and stops with a draft; returns the trace entry the
  // record kept and the request its draft replays.
  function traceAndDraft(entry: Entry) {
    const root = tempRoot();
    const record = records.startRecord({
      site: "fixture",
      op: "search",
      tabId: 1,
      origin: "https://example.test",
      network: true,
      includeInputValues: true,
      root,
    });
    records.attachNetworkTrace(record.id, [entry], root, { capture: COMPLETE });
    const kept = JSON.parse(
      fs.readFileSync(path.join(root, "records", record.id, "network", "trace.json"), "utf8"),
    ).entries[0];
    const { draft } = records.stopRecord({ target: TAB, draft: true, root });
    return { kept, request: draft.run.find((s: Entry) => s.using === "network").request };
  }
  const sent = (headers: Entry, url: string, body: unknown): Entry => ({
    id: "r_1",
    method: "POST",
    status: 200,
    type: "Fetch",
    mimeType: "application/json",
    url,
    requestHeaders: { "content-type": "application/json", ...headers },
    requestBody: JSON.stringify(body),
  });

  it("redacts a whole query value that equals a one-character x-csrf-token, and keeps a JSON number", () => {
    const url = "https://example.test/api/search?page=1&q=x&n=12";
    const { kept, request } = traceAndDraft(
      sent({ "x-csrf-token": "1" }, url, { page: 1, q: "x", token: "1" }),
    );
    expect(kept.url).toBe("https://example.test/api/search?page=<redacted>&q=x&n=12");
    expect(JSON.parse(kept.requestBody)).toEqual({ page: 1, q: "x", token: "<redacted>" });
    expect(request.query).toEqual({ page: "<redacted>", q: "x", n: "12" });
    expect(JSON.parse(request.body)).toEqual({ page: 1, q: "x", token: "<redacted>" });
  });

  it("redacts a whole query value that equals a numeric x-csrf-token, and keeps page=1", () => {
    const code = ["123", "4567"].join("");
    const { kept, request } = traceAndDraft(
      sent({ "x-csrf-token": code }, `https://example.test/api/verify?code=${code}&page=1`, {}),
    );
    expect(kept.url).toBe("https://example.test/api/verify?code=<redacted>&page=1");
    expect(request.query).toEqual({ code: "<redacted>", page: "1" });
  });

  it.each(["v", "id", "true"])(
    "redacts a short quoted auth parameter (%s) from the trace and draft, which still parse",
    (value) => {
      const { kept, request } = traceAndDraft(
        sent(
          { Authorization: `ResyAPI api_key="${value}"` },
          `https://example.test/api/search?key=${value}&q=x`,
          { key: value, q: "x", ok: true },
        ),
      );
      expect(kept.url).toBe("https://example.test/api/search?key=<redacted>&q=x");
      expect(JSON.parse(kept.requestBody)).toEqual({ key: "<redacted>", q: "x", ok: true });
      expect(request.query).toEqual({ key: "<redacted>", q: "x" });
      expect(JSON.parse(request.body)).toEqual({ key: "<redacted>", q: "x", ok: true });
    },
  );

  it("never rewrites a key that equals the token, only a whole string value", () => {
    const { kept, request } = traceAndDraft(
      sent({ "x-csrf-token": "id" }, "https://example.test/api/items?id=7&kind=id", { id: "id" }),
    );
    expect(kept.url).toBe("https://example.test/api/items?id=7&kind=<redacted>");
    expect(JSON.parse(kept.requestBody)).toEqual({ id: "<redacted>" });
    expect(request.query).toEqual({ id: "7", kind: "<redacted>" });
    expect(JSON.parse(request.body)).toEqual({ id: "<redacted>" });
  });

  it("redacts a short cookie value as a whole query or JSON value, keeping the query name", () => {
    const url = "https://example.test/api/search?lang=en&q=x";
    const { kept, request } = traceAndDraft(sent({ Cookie: "lang=en" }, url, { lang: "en" }));
    expect(kept.url).toBe("https://example.test/api/search?lang=<redacted>&q=x");
    expect(JSON.parse(kept.requestBody)).toEqual({ lang: "<redacted>" });
    expect(request.query).toEqual({ lang: "<redacted>", q: "x" });
  });

  it("keeps both query parameters whose names are short auth parameters, numbered", () => {
    const shop = ["sh", "op"].join("");
    const realm = ["tr", "ue"].join("");
    const { kept, request } = traceAndDraft(
      sent(
        { Authorization: `ResyAPI api_key="${shop}", realm="${realm}"` },
        `https://example.test/anything?${shop}=first&${realm}=second`,
        { q: "x" },
      ),
    );
    expect(kept.url).toBe("https://example.test/anything?<redacted>=first&<redacted-2>=second");
    expect(request.query).toEqual({ "<redacted>": "first", "<redacted-2>": "second" });
  });

  it("keeps a query name without a value and a bare JSON scalar body in the draft, which still parses", () => {
    const shop = ["sh", "op"].join("");
    const realm = ["tr", "ue"].join("");
    const { kept, request } = traceAndDraft(
      sent(
        { Authorization: `ResyAPI api_key="${shop}", realm="${realm}"` },
        `https://example.test/anything?${shop}&${realm}=two`,
        true,
      ),
    );
    expect(kept.url).toBe("https://example.test/anything?<redacted>&<redacted-2>=two");
    expect(request.query).toEqual({ "<redacted>": "", "<redacted-2>": "two" });
    expect(JSON.parse(kept.requestBody)).toBe("<redacted>");
    expect(JSON.parse(request.body)).toBe("<redacted>");
  });
});

describe("a draft of a request whose query repeats a name", () => {
  function draftOf(url: string) {
    const root = tempRoot();
    const record = records.startRecord({
      site: "fixture",
      op: "search",
      tabId: 1,
      origin: "https://example.test",
      network: true,
      root,
    });
    records.attachNetworkTrace(
      record.id,
      [{ id: "r_1", method: "GET", status: 200, type: "Fetch", mimeType: "application/json", url }],
      root,
      { capture: COMPLETE },
    );
    const { draft, warnings } = records.stopRecord({ target: TAB, draft: true, root });
    return {
      request: draft.run.find((s: Entry) => s.using === "network").request,
      warnings: warnings || [],
    };
  }

  it("keeps every value of a repeated name in the URL, and the other names as query inputs", () => {
    const { request, warnings } = draftOf("https://example.test/api/search?tag=1&q=x&tag=2&tag");
    const sent = new URL(request.url);
    for (const [name, value] of Object.entries(request.query)) {
      sent.searchParams.set(name, String(value));
    }
    expect([...sent.searchParams.entries()].sort()).toEqual([
      ["q", "x"],
      ["tag", ""],
      ["tag", "1"],
      ["tag", "2"],
    ]);
    expect(request.query).toEqual({ q: "x" });
    expect(warnings.join("\n")).toContain('query param "tag" repeats');
  });

  it("keeps the query as before when no name repeats", () => {
    const { request, warnings } = draftOf("https://example.test/api/search?a=1&b=2");
    expect(request.url).toBe("https://example.test/api/search");
    expect(request.query).toEqual({ a: "1", b: "2" });
    expect(warnings.join("\n")).not.toContain("repeats");
  });
});

describe("a record's trace, when a body key is a secret header's value", () => {
  // Dummy values, built from parts so no literal here reads as a credential.
  const LONG = ["dummy", "long", "key", "22"].join("-");
  const QUOTED = ["dummy", 'quo"ted', "va\\lue", "22"].join("-");

  it("keeps a long and a quoted secret key out of the trace and draft, which still parse", () => {
    const root = tempRoot();
    const record = records.startRecord({
      site: "fixture",
      op: "search",
      tabId: 1,
      origin: "https://example.test",
      network: true,
      includeInputValues: true,
      root,
    });
    records.attachNetworkTrace(
      record.id,
      [
        {
          id: "r_1",
          method: "POST",
          status: 200,
          type: "Fetch",
          mimeType: "application/json",
          url: "https://example.test/api/search",
          requestHeaders: {
            "content-type": "application/json",
            Authorization: `Bearer ${LONG}`,
            "x-api-key": QUOTED,
          },
          requestBody: JSON.stringify({ [LONG]: "ok", [QUOTED]: "ok", q: "x" }),
        },
      ],
      root,
      { capture: COMPLETE },
    );
    const { draft } = records.stopRecord({ target: TAB, draft: true, root });
    const request = draft.run.find((s: Entry) => s.using === "network").request;
    expect(JSON.parse(request.body)).toEqual({ "<redacted>": "ok", "<redacted-2>": "ok", q: "x" });
    const written = everyFile(root);
    expect(written).not.toContain("dummy");
  });
});
