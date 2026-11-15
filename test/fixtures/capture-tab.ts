import { vi } from "vitest";

// The extension cuts a javascript_tool result at this many characters.
const SCRIPT_OUTPUT_LIMIT = 50000;

export type CapturedEntry = {
  id: string;
  ts: number;
  method: string;
  url: string;
  status: number;
  responseHeaders: Record<string, string>;
  flags: string[];
  bodyCapture: Record<string, unknown>;
  _loadingFinished: boolean;
};

export type Reply = {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  // The capture entry's body state, when capture skipped the body.
  bodyCapture?: Record<string, unknown>;
  // Chrome no longer has the body either.
  bodyGone?: boolean;
  // The status capture shows, when it differs from what fetch sees (304 for a revalidated response).
  capturedStatus?: number;
};

/**
 * A tab whose page-context scripts run against a fake fetch, with network capture like the
 * extension's: `network` lists the captured entries, `network.body` returns a body, and script
 * output is cut at 50,000 characters. `pageSends` adds requests the page itself makes while a
 * script's request is in flight.
 */
export function captureTab({
  href = "https://api.test/page",
  reply = () => ({}),
  pageSends = () => [],
}: {
  href?: string;
  reply?: (url: string, init: { method?: string }) => Reply;
  pageSends?: (url: string, method: string) => Array<Partial<CapturedEntry> & { body?: string }>;
} = {}) {
  const entries: CapturedEntry[] = [];
  const bodies = new Map<string, string>();
  let seq = 0;
  const add = (entry: Partial<CapturedEntry> & { body?: string; bodyGone?: boolean }) => {
    const id = `r_${++seq}`;
    const { body, bodyGone, ...rest } = entry;
    entries.push({
      id,
      ts: Date.now(),
      method: "GET",
      url: "",
      status: 200,
      responseHeaders: {},
      flags: [],
      bodyCapture: { mode: "text", complete: true },
      _loadingFinished: true,
      ...rest,
    });
    if (body !== undefined && !bodyGone) {
      bodies.set(id, body);
    }
    return id;
  };
  const fetchImpl = vi.fn(async (url: string, init: { method?: string } = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    const answer = { status: 200, headers: {}, body: "{}", ...reply(url, init) };
    for (const sent of pageSends(url, method)) {
      add({ url, method, ...sent });
    }
    add({
      url,
      method,
      status: answer.capturedStatus ?? answer.status,
      responseHeaders: answer.headers,
      body: answer.body,
      bodyGone: answer.bodyGone,
      ...(answer.bodyCapture ? { bodyCapture: answer.bodyCapture } : {}),
    });
    return {
      status: answer.status,
      ok: answer.status >= 200 && answer.status < 300,
      url,
      redirected: false,
      headers: new Map(Object.entries(answer.headers)),
      text: async () => answer.body,
      arrayBuffer: async () => new ArrayBuffer(answer.body.length),
    };
  });
  const executeTool = vi.fn(async (tool: string, args: Record<string, unknown>) => {
    if (tool === "javascript_tool") {
      const execute = new Function("location", "fetch", `return ${String(args.code)}`);
      const value = await execute({ href, origin: new URL(href).origin }, fetchImpl);
      return { output: JSON.stringify(value).substring(0, SCRIPT_OUTPUT_LIMIT) };
    }
    if (tool === "network") {
      const filter = typeof args.filter === "string" ? args.filter : "";
      return {
        entries: entries
          .filter((entry) => entry.url.includes(filter))
          .map((entry) => ({ ...entry })),
      };
    }
    if (tool === "network.body") {
      const body = bodies.get(String(args.id));
      if (body === undefined) {
        throw new Error(`Response body for ${args.id} is gone`);
      }
      return { body, base64Encoded: false };
    }
    throw new Error(`unexpected tool ${tool}`);
  });
  return { entries, executeTool, fetchImpl, add };
}
