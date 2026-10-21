import { describe, expect, it } from "vitest";

// @ts-expect-error - CommonJS module without type definitions
import * as harvest from "../../native/api-harvest.cjs";

type Entry = {
  id: string;
  url: string;
  method: string;
  status: number;
  type: string;
  requestHeaders: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  _loadingFinished: boolean;
  flags: string[];
};

const SECRET = "Bearer sk-live-0123456789";
const PAGE_HEADERS = {
  authorization: SECRET,
  "x-csrf-token": "csrf-abcdef123456",
  cookie: "session=1",
  ":authority": "site.test",
  "sec-fetch-mode": "cors",
};

const feedUrl = (cursor?: string) =>
  `https://site.test/api/v1/feed?variables=${encodeURIComponent(JSON.stringify(cursor ? { user: "a", cursor } : { user: "a" }))}`;

/**
 * A fake browser tab on a site whose feed API pages with a Bottom cursor (c1, c2, ...).
 * `replay`: "ok", "status" (the server answers 403), or "throw" (the browser error echoes a header).
 */
function fakeSite({ pages = 3, replay = "ok", repeatCursor = false, visibility = "visible" } = {}) {
  const log: Entry[] = [];
  const bodies = new Map<string, string>();
  const calls: string[] = [];
  const replays: Array<{
    url: string;
    init: { headers: Record<string, string>; credentials: string };
  }> = [];
  let served = 0;
  let pageCursor: string | undefined;

  const pageFor = (cursor: string | undefined) => {
    const n = cursor ? Number(cursor.slice(1)) : 0;
    served++;
    let next = n + 1 < pages ? `c${n + 1}` : undefined;
    if (repeatCursor) {
      next = "c1";
    }
    return {
      data: {
        items: [
          { id: `${n}a-${repeatCursor ? served : ""}`, text: `page ${n} first` },
          { id: `${n}b-${repeatCursor ? served : ""}`, text: `page ${n} second` },
        ],
        cursors: [
          { type: "Top", value: "top" },
          ...(next ? [{ type: "Bottom", value: next }] : []),
        ],
      },
    };
  };
  const respond = (url: string, status: number, body: unknown, method = "GET", type = "Fetch") => {
    // The feed API is cross-origin with custom headers, so Chrome logs a CORS preflight first.
    if (method === "GET" && type === "Fetch") {
      log.push({
        id: `r_${log.length + 1}`,
        url,
        method: "OPTIONS",
        status: 204,
        type: "Preflight",
        requestHeaders: {},
        _loadingFinished: true,
        flags: [],
      });
    }
    const id = `r_${log.length + 1}`;
    log.push({
      id,
      url,
      method,
      status,
      type,
      requestHeaders: { ...PAGE_HEADERS },
      _loadingFinished: true,
      flags: [],
    });
    bodies.set(id, JSON.stringify(body));
  };
  const cursorOf = (url: string) =>
    JSON.parse(new URL(url).searchParams.get("variables") as string).cursor;
  const pageLoads = (cursor?: string) => {
    const body = pageFor(cursor);
    pageCursor = body.data.cursors.find((c) => c.type === "Bottom")?.value;
    respond(feedUrl(cursor), 200, body);
  };
  const fetch = async (
    url: string,
    init: { headers: Record<string, string>; credentials: string },
  ) => {
    replays.push({ url, init });
    if (replay === "throw") {
      throw new Error(`Failed to execute 'fetch': invalid header ${init.headers.authorization}`);
    }
    if (replay === "status") {
      respond(url, 403, { errors: ["bad request"] });
    } else {
      respond(url, 200, pageFor(cursorOf(url)));
    }
    return {
      status: replay === "status" ? 403 : 200,
      url,
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  };

  // A hidden tab ignores scrolling.
  const scrolled = () => {
    if (pageCursor && visibility === "visible") {
      pageLoads(pageCursor);
    }
  };

  async function executeTool(tool: string, args: Record<string, unknown>) {
    calls.push(tool);
    if (tool === "network") {
      const filter = args.filter as string | undefined;
      return { entries: log.filter((entry) => !filter || entry.url.includes(filter)) };
    }
    if (tool === "navigate") {
      respond("https://site.test/static/app.js", 200, "", "GET", "Script");
      pageLoads();
      return { success: true };
    }
    if (tool === "scroll.bottom") {
      scrolled();
      return { success: true };
    }
    if (tool === "network.body") {
      return { success: true, body: bodies.get(args.id as string) };
    }
    if (tool === "network.get") {
      return { entry: log.find((entry) => entry.id === args.id) };
    }
    if (tool === "javascript_tool") {
      const run = new Function("fetch", "location", "document", `return ${args.code}`);
      const value = await run(
        fetch,
        { origin: "https://site.test" },
        { visibilityState: visibility },
      );
      return { output: JSON.stringify(value, null, 2) };
    }
    throw new Error(`unexpected tool ${tool}`);
  }

  let clock = 0;
  return {
    log,
    calls,
    replays,
    respond,
    executeTool,
    sleep: async (ms: number) => {
      clock += ms;
    },
    now: () => clock,
  };
}

const spec = {
  open: "https://site.test/feed",
  match: "/api/*/feed",
  records: { find: { exists: ["id", "text"] }, key: "id", fields: { id: "id", text: "text" } },
  cursor: { find: { equals: { type: "Bottom" } }, path: "value", into: "query.variables.cursor" },
};
const ids = (records: Array<{ id: string }>) => records.map((record) => record.id);

describe("api harvest runners", () => {
  it("replays the captured request with each next cursor and merges every page", async () => {
    const site = fakeSite({ pages: 3 });
    const records = await harvest.runApiHarvest({ ...site, spec });
    expect(ids(records)).toEqual(["0a-", "0b-", "1a-", "1b-", "2a-", "2b-"]);
    expect(site.calls).not.toContain("scroll.bottom");
    expect(
      site.replays.map(({ url }) =>
        JSON.parse(new URL(url).searchParams.get("variables") as string),
      ),
    ).toEqual([
      { user: "a", cursor: "c1" },
      { user: "a", cursor: "c2" },
    ]);
    expect(site.replays[0].init).toMatchObject({
      credentials: "include",
      headers: { authorization: SECRET, "x-csrf-token": "csrf-abcdef123456" },
    });
    expect(Object.keys(site.replays[0].init.headers).sort()).toEqual([
      "authorization",
      "x-csrf-token",
    ]);
  });

  it("falls back to driving the page when a replay fails, without leaking header values", async () => {
    const site = fakeSite({ pages: 3, replay: "throw" });
    const events: unknown[] = [];
    const records = await harvest.runApiHarvest({
      ...site,
      spec,
      onEvent: (event: unknown) => events.push(event),
    });
    expect(ids(records)).toEqual(["0a-", "0b-", "1a-", "1b-", "2a-", "2b-"]);
    expect(site.replays).toHaveLength(1);
    expect(events).toEqual([
      expect.objectContaining({ type: "api.fallback", from: "replay", to: "drive" }),
    ]);
    expect(JSON.stringify(events)).not.toContain("sk-live-0123456789");

    const strict = fakeSite({ pages: 3, replay: "throw" });
    const failure = await harvest
      .runApiHarvest({ ...strict, spec: { ...spec, mode: "replay" } })
      .catch((error: Error) => error);
    expect(failure.message).toContain("invalid header");
    expect(failure.message).not.toContain("sk-live-0123456789");
  });

  it("falls back to driving the page when the server rejects replays", async () => {
    const site = fakeSite({ pages: 3, replay: "status" });
    const records = await harvest.runApiHarvest({ ...site, spec });
    expect(ids(records)).toEqual(["0a-", "0b-", "1a-", "1b-", "2a-", "2b-"]);
  });

  it("stops when the cursor repeats", async () => {
    const site = fakeSite({ repeatCursor: true });
    const records = await harvest.runApiHarvest({ ...site, spec });
    expect(site.replays).toHaveLength(1);
    expect(records).toHaveLength(4);
  });

  it("refuses to replay a POST unless allowed", async () => {
    const site = fakeSite();
    site.respond(feedUrl(), 200, {}, "POST");
    await expect(harvest.replay({ ...site, id: "r_1" })).rejects.toThrow(
      /refusing to replay POST \/api\/v1\/feed/,
    );
    expect(site.replays).toHaveLength(0);

    const allowed = await harvest.replay({
      ...site,
      id: "r_1",
      allowPost: true,
      set: { "query.variables.cursor": "c1" },
    });
    expect(allowed).toMatchObject({
      status: 200,
      json: { data: { items: [{ id: "1a-" }, { id: "1b-" }] } },
    });
  });

  it("sends credentials only where the page could have: same origin or allowed cross-origin", async () => {
    const site = fakeSite();
    const entry = (url: string, responseHeaders: Record<string, string>) => {
      site.respond(url, 200, {});
      Object.assign(site.log[site.log.length - 1], { responseHeaders });
      return site.log[site.log.length - 1].id;
    };
    const sameOrigin = entry(feedUrl(), {});
    const crossOrigin = entry(
      `https://api.other.test/api/v1/feed?variables=${encodeURIComponent("{}")}`,
      {
        "Access-Control-Allow-Origin": "*",
      },
    );
    const crossOriginWithCredentials = entry(
      `https://api.other.test/api/v1/feed?variables=${encodeURIComponent("{}")}`,
      {
        "Access-Control-Allow-Credentials": "true",
      },
    );
    for (const id of [sameOrigin, crossOrigin, crossOriginWithCredentials]) {
      await harvest.replay({ ...site, id });
    }
    expect(site.replays.map(({ init }) => init.credentials)).toEqual([
      "include",
      "omit",
      "include",
    ]);
  });

  it("fails instead of returning partial pages when it must drive a hidden tab", async () => {
    const site = fakeSite({ pages: 3, replay: "throw", visibility: "hidden" });
    await expect(harvest.runApiHarvest({ ...site, spec })).rejects.toThrow(
      /api drive mode needs a visible tab.*--window --focused/,
    );
  });

  it("names the glob and the API paths it saw when nothing matches", async () => {
    const site = fakeSite();
    const failure = await harvest
      .waitForResponse({
        ...site,
        match: "/api/*/timeline",
        open: "https://site.test/feed",
        timeoutMs: 2000,
      })
      .catch((error: Error) => error);
    expect(failure.message).toBe(
      'No response matched "/api/*/timeline" within 2s. Recent API requests: /api/v1/feed',
    );
  });
});
