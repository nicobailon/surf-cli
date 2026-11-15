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

// A dummy env value: not a key, just text a response can echo.
const KEY = "dummy-env-value-for-tests";
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

/** Every character as a \xNN escape, so the pattern's source never contains the text. */
const hexEscaped = (text: string) =>
  [...text].map((char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`).join("");

describe("pb test --save and env values", () => {
  function saveRun(cwd: string, asserts: string[], runOp: (...args: any[]) => unknown, key = KEY) {
    return pbTest.runPlaybookTest({
      argv: ["shop", "items", ...asserts, "--save"],
      cwd,
      home: cwd,
      env: { SURF_TEST_ITEMS_KEY: key },
      runOp,
    });
  }

  it("refuses, before running, an assertion whose path, value or pattern holds the env value", async () => {
    const cwd = tempDir();
    const file = writeShop(cwd, op);
    const before = fs.readFileSync(file, "utf8");
    const runOp = vi.fn();
    const contains = (n: number) =>
      new RegExp(`--save refused: assertion ${n} contains the value of SURF_TEST_ITEMS_KEY`);
    const matches = (n: number) =>
      new RegExp(
        `--save refused: assertion ${n}'s pattern matches the value of SURF_TEST_ITEMS_KEY`,
      );
    const cases: Array<[string[], RegExp, string?]> = [
      [
        ["--assert", "$", "array_min_len", "1", "--assert", "$[0].echo", "equals", `key ${KEY}`],
        contains(2),
      ],
      [["--assert", `$.${KEY}`, "not_null"], contains(1)],
      [["--assert", "$[0].echo", "matches", `^key ${KEY}$`], contains(1)],
      [["--assert", "$.a", "equals", JSON.stringify({ a: { [KEY]: 1 } })], contains(1)],
      [["--assert", "$.a", "equals", JSON.stringify({ a: [{ b: `prefix ${KEY}` }] })], contains(1)],
      [["--assert", "$.n", "equals", "98765432"], contains(1), "98765432"],
      // JSON escapes the quote and backslash, so the value's JSON text doesn't contain the key as is.
      [
        ["--assert", "$.a", "equals", JSON.stringify({ a: { b: 'x"q\\uote-key-1' } })],
        contains(1),
        'x"q\\uote-key-1',
      ],
      [["--assert", "$[0].echo", "matches", hexEscaped(KEY)], matches(1)],
      [["--assert", "$[0].echo", "matches", ".*"], matches(1)],
    ];
    for (const [asserts, expected, key] of cases) {
      const run = saveRun(cwd, asserts, runOp, key);
      await expect(run, asserts.join(" ")).rejects.toThrow(expected);
      await run.catch((error: Error) => expect(error.message).not.toContain(key ?? KEY));
    }
    expect(runOp).not.toHaveBeenCalled();
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("refuses an assertion the host marks secret-sensitive, even past the 200-character preview", async () => {
    const cwd = tempDir();
    const file = writeShop(cwd, op);
    const before = fs.readFileSync(file, "utf8");
    const echo = `${"x".repeat(210)}${KEY}`;
    // A real run on the "host": the variable is only in the host's environment (env), not this shell.
    const hostRun = (params: Record<string, any>) =>
      runtime.testPlaybookOp({
        playbook: { id: "shop", provenance: { scope: "test" } },
        op,
        args: params.args,
        assertions: params.assert,
        env: { SURF_TEST_ITEMS_KEY: KEY },
        executeTool: async (_tool: string, args: { code: string }) => {
          const fetchImpl = async (url: string) => ({
            status: 200,
            ok: true,
            url,
            headers: new Headers({ "content-type": "application/json" }),
            text: async () => JSON.stringify({ items: [{ name: "a", note: echo }] }),
          });
          const value = await new Function("fetch", "location", `return ${args.code}`)(fetchImpl, {
            href: "https://api.test/",
          });
          return { output: JSON.stringify(value) };
        },
      });
    const save = (asserts: string[]) =>
      pbTest.runPlaybookTest({
        argv: ["shop", "items", "--assert", "$", "array_min_len", "1", ...asserts, "--save"],
        cwd,
        home: cwd,
        env: {},
        runOp: hostRun,
      });
    const refused =
      /--save refused: assertion 2's value passed through env-header redaction, so it can't be saved/;
    // The reviewer's case: the secret sits past the preview, and the pattern spells it in hex.
    const pattern = `^x{210}${hexEscaped(KEY)}$`;
    const direct = await hostRun({
      args: {},
      assert: [{ path: "$[0].echo", op: "matches", value: pattern }],
    });
    expect(direct.assertions[0]).toMatchObject({ pass: true, secretSensitive: true });
    expect(direct.assertions[0].actual).not.toContain("<redacted");
    expect(JSON.stringify(direct)).not.toContain(KEY);
    await expect(save(["--assert", "$[0].echo", "matches", pattern])).rejects.toThrow(refused);
    // The previous bypass: an alternative that matches the redacted text.
    await expect(
      save(["--assert", "$[0].echo", "matches", `^x{210}(?:${hexEscaped(KEY)}|<redacted>)$`]),
    ).rejects.toThrow(refused);
    // A pattern that matches the secret itself, and a value or path holding it.
    await expect(save(["--assert", "$[0].title", "matches", "^a$|^dummy-"])).rejects.toThrow(refused);
    await expect(save(["--assert", "$[0].echo", "equals", echo])).rejects.toThrow(refused);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    const saved = await save(["--assert", "$[0].title", "equals", "a"]);
    expect(saved.saved).toBe(file);
    expect(saved.assertions[1]).not.toHaveProperty("secretSensitive");
  });
});
