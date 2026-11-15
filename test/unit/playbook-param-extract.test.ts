// pb param inputs and env headers together with pb extract and pb test: one op that uses both.
import { afterEach, describe, expect, it, vi } from "vitest";

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

const runtime = require("../../native/playbook-runtime.cjs");
const clients = require("../../native/playbook-client.cjs");
const pbTest = require("../../native/playbook-test.cjs");
const { applyParam } = require("../../native/playbook-param.cjs");
const { saveExtract } = require("../../native/playbook-extract.cjs");
const playbooks = require("../../native/playbooks.cjs");

const tempDirs: string[] = [];
afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function tempDir() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "surf-param-extract-"));
  tempDirs.push(directory);
  return directory;
}

const KEY = "sk-live-secret-1234";
const extract = { records: "$.items", fields: { title: "name", echo: "note" } };
const request = {
  method: "GET",
  url: "https://api.test/v1/items/page-{{page}}.json",
  query: { sort: "{{sort}}" },
  headers: { Accept: "application/json" },
  authInputs: [{ env: "SURF_TEST_ITEMS_KEY", header: "X-Api-Key" }],
};
const op = {
  id: "items",
  effect: "read",
  args: { page: { type: "number", default: 1 }, sort: { default: "new" } },
  run: [{ using: "network", request, extract }],
};

/** Items for a page; each echoes the API key it was sent, as some sites do in error notes. */
function itemsFor(page: string, key: string | undefined) {
  return {
    items: [
      { name: `p${page}-a`, note: `key ${key}` },
      { name: `p${page}-b`, note: "plain" },
    ],
  };
}

describe("an op with pb param inputs and a JSON extract", () => {
  it("renders the request with its inputs, extracts in the tab and redacts the env value", async () => {
    const fetched: Array<{ url: string; headers: Record<string, string> }> = [];
    const executeTool = async (_tool: string, args: { code: string }) => {
      const fetchImpl = async (url: string, init: { headers: Record<string, string> }) => {
        fetched.push({ url, headers: init.headers });
        const page = url.match(/page-(\d+)/)?.[1] ?? "?";
        return {
          status: 200,
          ok: true,
          url,
          headers: new Headers({ "content-type": "application/json" }),
          text: async () => JSON.stringify(itemsFor(page, init.headers["X-Api-Key"])),
        };
      };
      const value = await new Function("fetch", "location", `return ${args.code}`)(fetchImpl, {
        href: "https://api.test/",
      });
      // The tab sends back only the extract's result.
      expect(value).not.toHaveProperty("bodyJson");
      return { output: JSON.stringify(value, null, 2) };
    };
    const result = await runtime.runPlaybookOp({
      playbook: { id: "shop", provenance: { scope: "test" } },
      op,
      args: { page: "2" },
      secrets: { SURF_TEST_ITEMS_KEY: KEY },
      env: {},
      assertions: [{ path: "$[0].echo", op: "not_null" }],
      executeTool,
    });
    expect(fetched).toEqual([
      {
        url: "https://api.test/v1/items/page-2.json?sort=new",
        headers: { Accept: "application/json", "X-Api-Key": KEY },
      },
    ]);
    expect(result.value).toEqual([
      { title: "p2-a", echo: "key <redacted>" },
      { title: "p2-b", echo: "plain" },
    ]);
    expect(result.assertions[0].actual).toBe("key <redacted>");
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("redacts the env value from a failed assertion's actual value", async () => {
    const executeTool = async (_tool: string, args: { code: string }) => {
      const fetchImpl = async (url: string, init: { headers: Record<string, string> }) => ({
        status: 200,
        ok: true,
        url,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => JSON.stringify(itemsFor("1", init.headers["X-Api-Key"])),
      });
      const value = await new Function("fetch", "location", `return ${args.code}`)(fetchImpl, {
        href: "https://api.test/",
      });
      return { output: JSON.stringify(value) };
    };
    const failed = await runtime.testPlaybookOp({
      playbook: { id: "shop", provenance: { scope: "test" } },
      op,
      secrets: { SURF_TEST_ITEMS_KEY: KEY },
      env: {},
      assertions: [{ path: "$[0].echo", op: "equals", value: "x" }],
      executeTool,
    });
    expect(failed.status).toBe("failed");
    expect(failed.attempts[0].assertions[0].actual).toBe("key <redacted>");
    expect(JSON.stringify(failed)).not.toContain(KEY);
  });
});

describe("a client for an op with inputs, an env header and a JSON extract", () => {
  it("carries the renderer, redaction and records.cjs together", async () => {
    const out = path.join(tempDir(), "client");
    const { manifest } = clients.generateClient({
      playbookId: "shop",
      op,
      strategy: op.run[0],
      provenance: { type: "playbook", id: "shop" },
      out,
    });
    expect(manifest.args).toEqual(op.args);
    expect(fs.readdirSync(out).sort()).toEqual([
      "client.mjs",
      "package.json",
      "records.cjs",
      "surf-client.json",
    ]);
    const source = fs.readFileSync(path.join(out, "client.mjs"), "utf8");
    expect(source).toContain("function renderRequest(");
    expect(source).toContain("function redactValues(");

    const seen: string[] = [];
    const server = http.createServer((req: any, res: any) => {
      seen.push(req.url);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify(itemsFor(req.url.match(/page-(\d+)/)?.[1] ?? "?", req.headers["x-api-key"])),
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const stdout = await new Promise<string>((resolve, reject) =>
        execFile(
          process.execPath,
          [path.join(out, "client.mjs"), "--page", "3"],
          {
            env: {
              ...process.env,
              SURF_TEST_ITEMS_KEY: KEY,
              SURF_CLIENT_ORIGIN: `http://127.0.0.1:${server.address().port}`,
            },
          },
          (error: Error | null, output: string) => (error ? reject(error) : resolve(output)),
        ),
      );
      expect(seen).toEqual(["/v1/items/page-3.json?sort=new"]);
      expect(JSON.parse(stdout)).toEqual([
        { title: "p3-a", echo: "key <redacted>" },
        { title: "p3-b", echo: "plain" },
      ]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    await expect(clients.verifyClient(out, { live: false })).resolves.toMatchObject({
      valid: true,
    });
  });
});

function writeShop(cwd: string, value: Record<string, unknown>) {
  const directory = path.join(cwd, ".surf", "playbooks", "shop");
  fs.mkdirSync(path.join(directory, "ops"), { recursive: true });
  fs.writeFileSync(
    path.join(directory, "playbook.json"),
    JSON.stringify({ id: "shop", version: "1.0.0", origins: ["https://api.test"] }),
  );
  const file = path.join(directory, "ops", "items.json");
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

describe("pb test on an op with an env header", () => {
  it("sends the env value from the caller's shell, as surf use does", async () => {
    const cwd = tempDir();
    writeShop(cwd, op);
    const runOp = vi.fn(async (_params: Record<string, unknown>) => ({
      status: "completed",
      strategy: "network",
      value: [],
      attempts: [],
      assertions: [],
    }));
    await pbTest.runPlaybookTest({
      argv: ["shop", "items", "--page", "2"],
      cwd,
      home: cwd,
      env: { SURF_TEST_ITEMS_KEY: KEY },
      runOp,
    });
    expect(runOp.mock.calls[0][0]).toMatchObject({
      args: { page: "2" },
      secret: { SURF_TEST_ITEMS_KEY: KEY },
    });
  });
});

describe("pb param and pb extract on one op", () => {
  it("keep each other's edits, through the one op-editing path", () => {
    const cwd = tempDir();
    const file = writeShop(cwd, {
      id: "items",
      effect: "read",
      run: [
        {
          using: "network",
          request: { method: "GET", url: "https://api.test/v1/items/page-1.json" },
        },
      ],
    });
    const extracted = saveExtract({ playbook: "shop", op: "items", extract, cwd, home: cwd });
    expect(extracted.diff).toContain('+      "extract": {');
    const param = applyParam({
      playbook: "shop",
      op: "items",
      fields: ["path.3"],
      as: "page",
      value: "1",
      cwd,
      home: cwd,
    });
    expect(param.diff).toMatch(/^-.*page-1\.json/m);
    expect(param.diff).toMatch(/^\+.*page-\{\{page\}\}\.json/m);
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(saved.run[0].extract).toEqual(extract);
    expect(saved.args.page).toBeDefined();
    expect(playbooks.resolveOp("shop", "items", { cwd, home: cwd }).op.run[0].request.url).toBe(
      "https://api.test/v1/items/page-{{page}}.json",
    );
  });
});

// A response that uses the env value as an object key, beside a key that already reads <redacted>.
function keyedBody(key: string) {
  return {
    result: { [key]: "first", other: 1, "<redacted>": "literal", list: [{ [key]: "nested" }] },
  };
}
const keyedOp = {
  id: "keyed",
  effect: "read",
  args: {},
  run: [
    {
      using: "network",
      request: { ...request, url: "https://api.test/v1/keyed", query: {} },
      extract: { jsonPath: "$.result" },
    },
  ],
};
const keyedResult = {
  "<redacted-2>": "first",
  other: 1,
  "<redacted>": "literal",
  list: [{ "<redacted>": "nested" }],
};

describe("redacting object keys", () => {
  it("redacts keys as well as values, keeping colliding keys under distinct placeholders", () => {
    const { redactObject } = require("../../native/redaction.cjs");
    expect(redactObject(keyedBody(KEY).result, [KEY])).toEqual(keyedResult);
    expect(redactObject({ a: { [`x-${KEY}`]: KEY } }, [KEY])).toEqual({
      a: { "x-<redacted>": "<redacted>" },
    });
  });

  it("in a run's result and in pb test's assertions", async () => {
    const executeTool = async (_tool: string, args: { code: string }) => {
      const fetchImpl = async (url: string, init: { headers: Record<string, string> }) => ({
        status: 200,
        ok: true,
        url,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => JSON.stringify(keyedBody(init.headers["X-Api-Key"])),
      });
      const value = await new Function("fetch", "location", `return ${args.code}`)(fetchImpl, {
        href: "https://api.test/",
      });
      return { output: JSON.stringify(value) };
    };
    const result = await runtime.testPlaybookOp({
      playbook: { id: "shop", provenance: { scope: "test" } },
      op: keyedOp,
      secrets: { SURF_TEST_ITEMS_KEY: KEY },
      env: {},
      assertions: [{ path: "$.list", op: "equals", value: [{ [KEY]: "nested" }] }],
      executeTool,
    });
    expect(result.status).toBe("completed");
    expect(result.value).toEqual(keyedResult);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("in a generated client's output", async () => {
    const out = path.join(tempDir(), "client");
    clients.generateClient({
      playbookId: "shop",
      op: keyedOp,
      strategy: keyedOp.run[0],
      provenance: { type: "playbook", id: "shop" },
      out,
    });
    const server = http.createServer((req: any, res: any) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(keyedBody(req.headers["x-api-key"])));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const stdout = await new Promise<string>((resolve, reject) =>
        execFile(
          process.execPath,
          [path.join(out, "client.mjs")],
          {
            env: {
              ...process.env,
              SURF_TEST_ITEMS_KEY: KEY,
              SURF_CLIENT_ORIGIN: `http://127.0.0.1:${server.address().port}`,
            },
          },
          (error: Error | null, output: string) => (error ? reject(error) : resolve(output)),
        ),
      );
      expect(stdout).not.toContain(KEY);
      expect(JSON.parse(stdout)).toEqual(keyedResult);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("pb test --save and env values", () => {
  it("refuses to save an assertion whose value, path or pattern holds the env value, naming its position", async () => {
    const cwd = tempDir();
    const file = writeShop(cwd, op);
    const before = fs.readFileSync(file, "utf8");
    const runOp = vi.fn();
    const cases: Array<[string[], number]> = [
      [["--assert", "$", "array_min_len", "1", "--assert", "$[0].echo", "equals", `key ${KEY}`], 2],
      [["--assert", `$.${KEY}`, "not_null"], 1],
      [["--assert", "$[0].echo", "matches", `^key ${KEY}$`], 1],
      [["--assert", "$[0].echo", "matches", `^key ${KEY.replace(/-/g, "\\-")}$`], 1],
    ];
    for (const [asserts, position] of cases) {
      const run = pbTest.runPlaybookTest({
        argv: ["shop", "items", ...asserts, "--save"],
        cwd,
        home: cwd,
        env: { SURF_TEST_ITEMS_KEY: KEY },
        runOp,
      });
      await expect(run).rejects.toThrow(
        new RegExp(
          `--save refused: assertion ${position} contains the value of SURF_TEST_ITEMS_KEY`,
        ),
      );
      await run.catch((error: Error) => expect(error.message).not.toContain(KEY));
    }
    expect(runOp).not.toHaveBeenCalled();
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });
});
