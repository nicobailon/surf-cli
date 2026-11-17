// Assertions and env-header values: what pb test may save, and what a run reports and journals.
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { captureTab } from "../fixtures/capture-tab";
import { corpusPatterns, corpusValues } from "../fixtures/pattern-corpus";

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

const runtime = require("../../native/playbook-runtime.cjs");
const assertions = require("../../native/playbook-assertions.cjs");
const clients = require("../../native/playbook-client.cjs");
const pbTest = require("../../native/playbook-test.cjs");
const redaction = require("../../native/redaction.cjs");

const tempDirs: string[] = [];
afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const ENV = "SURF_TEST_ITEMS_KEY";
const op = {
  id: "items",
  effect: "read",
  args: {},
  run: [
    {
      using: "network",
      request: {
        method: "GET",
        url: "https://api.test/v1/items",
        authInputs: [{ env: ENV, header: "X-Api-Key" }],
      },
      extract: { jsonPath: "$.result" },
    },
  ],
};

function tempShop(value: Record<string, unknown> = op) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "surf-assert-secrets-"));
  tempDirs.push(cwd);
  const directory = path.join(cwd, ".surf", "playbooks", "shop");
  fs.mkdirSync(path.join(directory, "ops"), { recursive: true });
  fs.writeFileSync(
    path.join(directory, "playbook.json"),
    JSON.stringify({ id: "shop", version: "1.0.0", origins: ["https://api.test"] }),
  );
  const file = path.join(directory, "ops", "items.json");
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return { cwd, file };
}

/** A tab whose response is `{ result }`, run through the op's real in-tab extract. */
function tabAnswering(result: unknown) {
  return async (_tool: string, args: { code: string }) => {
    const fetchImpl = async (url: string) => ({
      status: 200,
      ok: true,
      url,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => JSON.stringify({ result }),
    });
    const value = await new Function("fetch", "location", `return ${args.code}`)(fetchImpl, {
      href: "https://api.test/",
    });
    return { output: JSON.stringify(value) };
  };
}

/** A pb test run on the browser host, whose environment alone holds the env value. */
function hostRun(
  result: unknown,
  secret: string,
  assert: unknown[],
  onEvent: (event: Record<string, unknown>) => void = () => undefined,
) {
  return runtime.testPlaybookOp({
    playbook: { id: "shop", provenance: { scope: "test" } },
    op,
    env: { [ENV]: secret },
    assertions: assert,
    executeTool: tabAnswering(result),
    onEvent,
  });
}

function save(cwd: string, asserts: string[], env: Record<string, string>, runOp: unknown) {
  return pbTest.runPlaybookTest({
    argv: ["shop", "items", ...asserts, "--save"],
    cwd,
    home: cwd,
    env,
    runOp,
  });
}

describe("pb test --save and env values that read as JSON literals", () => {
  it("refuses an env value of true, false or null, before the run and after it", async () => {
    const { cwd, file } = tempShop();
    const before = fs.readFileSync(file, "utf8");
    for (const literal of ["true", "false", "null"]) {
      // In this shell: refused before anything runs.
      const runOp = vi.fn();
      await expect(
        save(cwd, ["--assert", "$", "equals", literal], { [ENV]: literal }, runOp),
        literal,
      ).rejects.toThrow(/--save refused: assertion 1 contains the value of SURF_TEST_ITEMS_KEY/);
      expect(runOp).not.toHaveBeenCalled();
      // Only in the host's environment: the run marks it.
      const hosted = (params: Record<string, any>) =>
        hostRun({ flag: JSON.parse(literal) }, literal, params.assert);
      await expect(
        save(cwd, ["--assert", "$.flag", "equals", literal], {}, hosted),
        literal,
      ).rejects.toThrow(/--save refused: assertion 1's value passed through env-header redaction/);
    }
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });
});

describe("env values that read as numbers", () => {
  const NUMBER = "123456789012";

  it("are redacted from a run's result and from pb test's assertion values and actuals", async () => {
    const result = await hostRun({ n: Number(NUMBER), list: [Number(NUMBER), 7] }, NUMBER, [
      { path: "$.n", op: "equals", value: Number(NUMBER) },
    ]);
    expect(result.status).toBe("completed");
    expect(result.value).toEqual({ n: "<redacted>", list: ["<redacted>", 7] });
    expect(result.assertions[0]).toMatchObject({ value: "<redacted>", actual: "<redacted>" });
    expect(JSON.stringify(result)).not.toContain(NUMBER);
  });

  it("are redacted from a generated client's output", async () => {
    const out = path.join(tempShop().cwd, "client");
    clients.generateClient({
      playbookId: "shop",
      op,
      strategy: op.run[0],
      provenance: { type: "playbook", id: "shop" },
      out,
    });
    const server = http.createServer((req: any, res: any) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ result: { n: Number(req.headers["x-api-key"]), other: 7 } }));
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
              [ENV]: NUMBER,
              SURF_CLIENT_ORIGIN: `http://127.0.0.1:${server.address().port}`,
            },
          },
          (error: Error | null, output: string) => (error ? reject(error) : resolve(output)),
        ),
      );
      expect(stdout).not.toContain(NUMBER);
      expect(JSON.parse(stdout)).toEqual({ n: "<redacted>", other: 7 });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("a failed assertion and env values", () => {
  // JSON escapes the quote and backslash, so the JSON text of this value doesn't contain it as is.
  const QUOTED = 'dummy"quoted\\value';
  const escaped = JSON.stringify(QUOTED).slice(1, -1);

  it("keeps a value JSON would escape out of the error, the attempts and the journal", async () => {
    const events: Array<Record<string, unknown>> = [];
    const failed = await hostRun(
      { x: "other" },
      QUOTED,
      [{ path: "$.x", op: "equals", value: QUOTED }],
      (event: Record<string, unknown>) => events.push(event),
    );
    expect(failed.status).toBe("failed");
    expect(failed.attempts[0].assertions[0]).toMatchObject({ value: "<redacted>", pass: false });
    const failures = events.filter((event) => event.type === "strategy.failed");
    expect(failures).toHaveLength(1);
    // The raw strings: JSON.stringify of the whole result would escape them again and hide a leak.
    for (const text of [
      failed.error,
      failed.attempts[0].error,
      ...failures.map((event) => event.error),
    ]) {
      expect(text).not.toContain(escaped);
      expect(text).not.toContain(QUOTED);
    }
  });

  it("redacts the value's JSON-escaped form, as a raw JSON body echoes it, from the result and the preview", async () => {
    // httpbin's /headers answers with JSON text, so the run's raw body holds the escaped form.
    const body = JSON.stringify({ headers: { Authorization: QUOTED } });
    const failed = await hostRun({ body }, QUOTED, [{ path: "$.body", op: "equals", value: "y" }]);
    expect(failed.attempts[0].assertions[0]).toMatchObject({
      actual: '{"headers":{"Authorization":"<redacted>"}}',
      secretSensitive: true,
    });
    const passed = await hostRun({ body }, QUOTED, [{ path: "$.body", op: "not_null" }]);
    expect(passed.value.body).toBe('{"headers":{"Authorization":"<redacted>"}}');
    for (const text of [JSON.stringify(failed), JSON.stringify(passed)]) {
      expect(text).not.toContain(JSON.stringify(escaped).slice(1, -1));
    }
  });

  it("redacts the value's JSON-escaped form from a generated client's output", async () => {
    const out = path.join(tempShop().cwd, "client");
    clients.generateClient({
      playbookId: "shop",
      op,
      strategy: op.run[0],
      provenance: { type: "playbook", id: "shop" },
      out,
    });
    const server = http.createServer((req: any, res: any) => {
      res.writeHead(200, { "content-type": "application/json" });
      const text = JSON.stringify({ Authorization: req.headers["x-api-key"] });
      res.end(JSON.stringify({ result: { text } }));
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
              [ENV]: QUOTED,
              SURF_CLIENT_ORIGIN: `http://127.0.0.1:${server.address().port}`,
            },
          },
          (error: Error | null, output: string) => (error ? reject(error) : resolve(output)),
        ),
      );
      expect(JSON.parse(stdout)).toEqual({ text: '{"Authorization":"<redacted>"}' });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("redacts an actual value in full before cutting it to its 200-character preview", async () => {
    const long = `dummy-env-value-${"0123456789".repeat(4)}`;
    const failed = await hostRun({ x: `${"x".repeat(190)}${long}` }, long, [
      { path: "$.x", op: "equals", value: "y" },
    ]);
    expect(failed.attempts[0].assertions[0].actual).toBe(`${"x".repeat(190)}<redacted>`);
    expect(JSON.stringify(failed)).not.toContain(long.slice(0, 10));
  });
});

describe("matches patterns and env values over the 64 KB match cap", () => {
  const LONG = `${"a".repeat(66000)}z`;
  const pattern = "^(?:a{66000}z|ok)$";

  it("refuses --save, before the run and after it", async () => {
    const { cwd, file } = tempShop();
    const before = fs.readFileSync(file, "utf8");
    const runOp = vi.fn();
    await expect(
      save(cwd, ["--assert", "$.x", "matches", pattern], { [ENV]: LONG }, runOp),
    ).rejects.toThrow(
      /--save refused: the value of SURF_TEST_ITEMS_KEY is over 64 KB, too long to check assertion 1's pattern against/,
    );
    expect(runOp).not.toHaveBeenCalled();
    const hosted = (params: Record<string, any>) => hostRun({ x: "ok" }, LONG, params.assert);
    await expect(save(cwd, ["--assert", "$.x", "matches", pattern], {}, hosted)).rejects.toThrow(
      /--save refused: assertion 1's value passed through env-header redaction/,
    );
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    const [checked] = assertions.checkAssertions(
      "ok",
      [{ path: "$", op: "matches", value: pattern }],
      [LONG],
    );
    expect(checked).toMatchObject({ pass: true, secretSensitive: true });
  });
});

describe("the JSON-escaped spelling of an env value", () => {
  const QUOTED = 'dummy"quoted\\value';
  const escaped = JSON.stringify(QUOTED).slice(1, -1);
  const twiceEscaped = JSON.stringify(escaped).slice(1, -1);
  // No extract: the body is read from network capture, as for httpbin's /headers.
  const rawOp = { ...op, run: [{ ...op.run[0], extract: undefined }] };

  it("is refused by both --save checks (the reviewer's reproduction)", async () => {
    const { cwd, file } = tempShop(rawOp);
    const before = fs.readFileSync(file, "utf8");
    const body = JSON.stringify({ echo: QUOTED });
    const hosted = vi.fn((params: Record<string, any>) =>
      runtime.testPlaybookOp({
        playbook: { id: "shop", provenance: { scope: "test" } },
        op: rawOp,
        secrets: params.secret ?? {},
        env: { [ENV]: QUOTED },
        assertions: params.assert,
        executeTool: captureTab({ reply: () => ({ body }) }).executeTool,
      }),
    );
    // The value is a JSON string literal, so the assertion holds the body's text, not its object.
    const asserts = ["--assert", "$.body", "equals", JSON.stringify(body)];
    // Set in the caller's shell (and the host's): refused before the run.
    await expect(save(cwd, asserts, { [ENV]: QUOTED }, hosted)).rejects.toThrow(
      /--save refused: assertion 1 contains the value of SURF_TEST_ITEMS_KEY/,
    );
    expect(hosted).not.toHaveBeenCalled();
    // Only in the host's environment: the run marks it.
    await expect(save(cwd, asserts, {}, hosted)).rejects.toThrow(
      /--save refused: assertion 1's value passed through env-header redaction/,
    );
    // A pattern that matches only the escaped spelling.
    await expect(
      save(
        cwd,
        ["--assert", "$.body", "matches", "quoted\\\\\\\\value"],
        { [ENV]: QUOTED },
        hosted,
      ),
    ).rejects.toThrow(
      /--save refused: assertion 1's pattern matches the value of SURF_TEST_ITEMS_KEY/,
    );
    expect(hosted).toHaveBeenCalledOnce();
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("is redacted from a structured tab error before it becomes text", async () => {
    for (const echo of [QUOTED, JSON.stringify({ echo: QUOTED })]) {
      const events: Array<Record<string, unknown>> = [];
      const failed = await runtime.testPlaybookOp({
        playbook: { id: "shop", provenance: { scope: "test" } },
        op,
        env: { [ENV]: QUOTED },
        executeTool: async () => ({ error: { nested: { echo } } }),
        onEvent: (event: Record<string, unknown>) => events.push(event),
      });
      expect(failed.status).toBe("failed");
      const failures = events.filter((event) => event.type === "strategy.failed");
      for (const text of [
        failed.error,
        failed.attempts[0].error,
        ...failures.map((event) => event.error),
      ]) {
        expect(text).toContain("<redacted>");
        for (const spelling of [QUOTED, escaped, twiceEscaped]) {
          expect(text).not.toContain(spelling);
        }
      }
    }
  });

  it("is redacted from a workflow strategy's structured extract error, as from the network strategy's", async () => {
    const workflowOp = {
      ...op,
      run: [
        {
          using: "workflow",
          steps: [{ cmd: "navigate", args: { url: "https://api.test/" } }],
          stepDelay: 0,
          autoWait: false,
          extract: { html: { value: "h1" } },
        },
        op.run[0],
      ],
    };
    const executeTool = async (tool: string) =>
      tool === "javascript_tool"
        ? { error: { nested: { echo: JSON.stringify({ echo: QUOTED }) } } }
        : { success: true };
    const failed = await runtime.testPlaybookOp({
      playbook: { id: "shop", provenance: { scope: "test" } },
      op: workflowOp,
      env: { [ENV]: QUOTED },
      executeTool,
      sleep: vi.fn(),
    });
    expect(failed.status).toBe("failed");
    expect(failed.attempts.map((attempt: { using: string }) => attempt.using)).toEqual([
      "workflow",
      "network",
    ]);
    for (const text of [failed.error, ...failed.attempts.map((attempt: any) => attempt.error)]) {
      expect(text).toContain("<redacted>");
      for (const spelling of [QUOTED, escaped, twiceEscaped]) {
        expect(text).not.toContain(spelling);
      }
    }
  });

  it("is redacted from a generated client's HTTP error, before the error is cut to 500 characters", async () => {
    const out = path.join(tempShop().cwd, "client");
    clients.generateClient({
      playbookId: "shop",
      op,
      strategy: op.run[0],
      provenance: { type: "playbook", id: "shop" },
      out,
    });
    const long = `dummy-env-value-${"0123456789".repeat(4)}`;
    const cases = [
      {
        key: QUOTED,
        body: (key: string) => JSON.stringify({ echo: key }),
        hidden: [QUOTED, escaped],
      },
      { key: long, body: (key: string) => `${"x".repeat(490)}${key}`, hidden: [long.slice(0, 10)] },
    ];
    for (const { key, body, hidden } of cases) {
      const server = http.createServer((req: any, res: any) => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(body(req.headers["x-api-key"]));
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const stderr = await new Promise<string>((resolve) =>
          execFile(
            process.execPath,
            [path.join(out, "client.mjs")],
            {
              env: {
                ...process.env,
                [ENV]: key,
                SURF_CLIENT_ORIGIN: `http://127.0.0.1:${server.address().port}`,
              },
            },
            (_error: Error | null, _stdout: string, output: string) => resolve(output),
          ),
        );
        expect(stderr).toContain("HTTP 500: ");
        expect(stderr).toContain("<redacted>");
        for (const text of hidden) {
          expect(stderr).not.toContain(text);
        }
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    }
  });
});

describe("an env value escaped more than once", () => {
  const QUOTED = 'dummy"quoted\\value';
  const escapeOnce = (text: string) => JSON.stringify(text).slice(1, -1);
  // JSON inside a JSON string field: each level escapes the value once more.
  const wrap = (text: string) => JSON.stringify({ data: text });
  const twice = wrap(JSON.stringify({ echo: QUOTED }));
  const thrice = wrap(twice);
  const rawOp = { ...op, run: [{ ...op.run[0], extract: undefined }] };
  // "quoted" appears in no text but the value, whatever its escaping.
  const leaks = (text: string) => text.includes("quoted");

  it("has one spelling per level of escaping, up to 3, and one for a value JSON leaves as is", () => {
    expect(redaction.secretSpellings([QUOTED], 3)).toEqual([
      QUOTED,
      escapeOnce(QUOTED),
      escapeOnce(escapeOnce(QUOTED)),
      escapeOnce(escapeOnce(escapeOnce(QUOTED))),
    ]);
    expect(redaction.secretSpellings(["dummy-plain-value"], 3)).toEqual(["dummy-plain-value"]);
  });

  it("is refused by both --save checks", async () => {
    for (const body of [twice, thrice]) {
      const { cwd, file } = tempShop(rawOp);
      const before = fs.readFileSync(file, "utf8");
      const hosted = vi.fn((params: Record<string, any>) =>
        runtime.testPlaybookOp({
          playbook: { id: "shop", provenance: { scope: "test" } },
          op: rawOp,
          secrets: params.secret ?? {},
          env: { [ENV]: QUOTED },
          assertions: params.assert,
          executeTool: captureTab({ reply: () => ({ body }) }).executeTool,
        }),
      );
      const asserts = ["--assert", "$.body", "equals", JSON.stringify(body)];
      await expect(save(cwd, asserts, { [ENV]: QUOTED }, hosted)).rejects.toThrow(
        /--save refused: assertion 1 contains the value of SURF_TEST_ITEMS_KEY/,
      );
      expect(hosted).not.toHaveBeenCalled();
      await expect(save(cwd, asserts, {}, hosted)).rejects.toThrow(
        /--save refused: assertion 1's value passed through env-header redaction/,
      );
      expect(fs.readFileSync(file, "utf8")).toBe(before);
    }
  });

  it("is redacted from surf use's raw body and parsed body", async () => {
    for (const body of [twice, thrice]) {
      const result = await runtime.runPlaybookOp({
        playbook: { id: "shop", provenance: { scope: "test" } },
        op: rawOp,
        env: { [ENV]: QUOTED },
        executeTool: captureTab({ reply: () => ({ body }) }).executeTool,
      });
      expect(result.value.body).toContain("<redacted>");
      expect(leaks(result.value.body)).toBe(false);
      expect(leaks(JSON.stringify(result.value.bodyJson))).toBe(false);
    }
  });

  it("is redacted from a structured tab error, its attempts and strategy.failed", async () => {
    for (const echo of [twice, thrice]) {
      const events: Array<Record<string, unknown>> = [];
      const failed = await runtime.testPlaybookOp({
        playbook: { id: "shop", provenance: { scope: "test" } },
        op,
        env: { [ENV]: QUOTED },
        executeTool: async () => ({ error: { nested: { echo } } }),
        onEvent: (event: Record<string, unknown>) => events.push(event),
      });
      expect(failed.status).toBe("failed");
      const failures = events.filter((event) => event.type === "strategy.failed");
      expect(failures).toHaveLength(1);
      for (const text of [failed.error, failed.attempts[0].error, failures[0].error]) {
        expect(text).toContain("<redacted>");
        expect(leaks(text as string)).toBe(false);
      }
    }
  });

  it("is redacted from a generated client's output and HTTP error", async () => {
    const out = path.join(tempShop().cwd, "client");
    clients.generateClient({
      playbookId: "shop",
      op,
      strategy: op.run[0],
      provenance: { type: "playbook", id: "shop" },
      out,
    });
    for (const status of [200, 500]) {
      for (const levels of [2, 3]) {
        const server = http.createServer((req: any, res: any) => {
          let text = JSON.stringify({ echo: req.headers["x-api-key"] });
          for (let level = 1; level < levels; level++) {
            text = wrap(text);
          }
          res.writeHead(status, { "content-type": "application/json" });
          res.end(status === 200 ? JSON.stringify({ result: { text } }) : text);
        });
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        try {
          const output = await new Promise<string>((resolve) =>
            execFile(
              process.execPath,
              [path.join(out, "client.mjs")],
              {
                env: {
                  ...process.env,
                  [ENV]: QUOTED,
                  SURF_CLIENT_ORIGIN: `http://127.0.0.1:${server.address().port}`,
                },
              },
              (_error: Error | null, stdout: string, stderr: string) => resolve(stdout + stderr),
            ),
          );
          expect(output, `${status} at ${levels} levels`).toContain("<redacted>");
          expect(leaks(output), `${status} at ${levels} levels`).toBe(false);
        } finally {
          await new Promise((resolve) => server.close(resolve));
        }
      }
    }
  });
});

describe("an env value in any JSON spelling the decoder reads", () => {
  const join = (...parts: string[]) => parts.join("");
  const QUOTED = join("dummy", '"', "quoted", "\\", "value");
  const SLASHED = ["dummy", "slash", "value"].join("/");
  const UNICODE = ["dummy", "unicode", "value"].join("-");
  // JSON inside a JSON string field, `levels` deep: the value is escaped `levels` times.
  const nested = (value: string, levels: number) => {
    let text = JSON.stringify({ echo: value });
    for (let level = 1; level < levels; level++) {
      text = JSON.stringify({ data: text });
    }
    return text;
  };
  const unicodeEscaped = [...UNICODE]
    .map((char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`)
    .join("");
  // Each body echoes its secret; `fragments` appear in no spelling of the output but the secret's.
  const cases = [
    { name: "escaped 4 times", secret: QUOTED, body: nested(QUOTED, 4), fragments: ["quoted"] },
    { name: "escaped 6 times", secret: QUOTED, body: nested(QUOTED, 6), fragments: ["quoted"] },
    {
      name: "written with \\/",
      secret: SLASHED,
      body: `{"echo":"${SLASHED.replaceAll("/", "\\/")}"}`,
      fragments: ["slash"],
    },
    {
      name: "written with \\u escapes",
      secret: UNICODE,
      body: `{"echo":"${unicodeEscaped}"}`,
      fragments: ["unicode", "006e"],
    },
    {
      name: "escaped 10 times, past the 8 levels read",
      secret: QUOTED,
      body: nested(QUOTED, 10),
      fragments: ["quoted"],
    },
  ];
  const rawOp = { ...op, run: [{ ...op.run[0], extract: undefined }] };
  const playbook = { id: "shop", provenance: { scope: "test" } };
  const exposed = (text: string, fragments: string[]) =>
    fragments.filter((fragment) => text.includes(fragment));
  // Both forms surf prints: indented (the CLI) and compact (--json, MCP).
  const printed = (value: unknown) => [JSON.stringify(value, null, 2), JSON.stringify(value)];

  function hostedRun(secret: string, body: string, runOp: Record<string, unknown> = rawOp) {
    return vi.fn((params: Record<string, any>) =>
      runtime.testPlaybookOp({
        playbook,
        op: runOp,
        secrets: params.secret ?? {},
        env: { [ENV]: secret },
        assertions: params.assert,
        executeTool: captureTab({ reply: () => ({ body }) }).executeTool,
      }),
    );
  }

  // One generated client for the block's runs, removed after them.
  let client = "";
  afterAll(() => {
    if (client) {
      fs.rmSync(path.dirname(client), { recursive: true, force: true });
    }
  });
  async function runClient(secret: string, status: number, body: string) {
    if (!client) {
      client = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surf-assert-client-")), "client");
      clients.generateClient({
        playbookId: "shop",
        op,
        strategy: op.run[0],
        provenance: { type: "playbook", id: "shop" },
        out: client,
      });
    }
    const out = client;
    const server = http.createServer((_req: any, res: any) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(body);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      return await new Promise<string>((resolve) =>
        execFile(
          process.execPath,
          [path.join(out, "client.mjs")],
          {
            env: {
              ...process.env,
              [ENV]: secret,
              SURF_CLIENT_ORIGIN: `http://127.0.0.1:${server.address().port}`,
            },
          },
          (_error: Error | null, stdout: string, stderr: string) => resolve(stdout + stderr),
        ),
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  it("is refused by both --save checks", async () => {
    for (const { name, secret, body } of cases) {
      const { cwd, file } = tempShop(rawOp);
      const before = fs.readFileSync(file, "utf8");
      const hosted = hostedRun(secret, body);
      const asserts = ["--assert", "$.body", "equals", JSON.stringify(body)];
      await expect(save(cwd, asserts, { [ENV]: secret }, hosted), name).rejects.toThrow(
        /--save refused: assertion 1 (contains the value of|holds JSON escaped more than 8 times, too deep to check for) SURF_TEST_ITEMS_KEY/,
      );
      expect(hosted, name).not.toHaveBeenCalled();
      await expect(save(cwd, asserts, {}, hosted), name).rejects.toThrow(
        /--save refused: assertion 1's value passed through env-header redaction/,
      );
      expect(fs.readFileSync(file, "utf8"), name).toBe(before);
    }
  });

  it("names a value escaped past 8 levels as too deep to check, before the run", async () => {
    const { cwd } = tempShop(rawOp);
    const body = nested(QUOTED, 10);
    const hosted = hostedRun(QUOTED, body);
    await expect(
      save(cwd, ["--assert", "$.body", "equals", JSON.stringify(body)], { [ENV]: QUOTED }, hosted),
    ).rejects.toThrow(
      "--save refused: assertion 1 holds JSON escaped more than 8 times, too deep to check for SURF_TEST_ITEMS_KEY; assert on something else",
    );
    expect(hosted).not.toHaveBeenCalled();
  });

  it("reads text with an unclosed run of escaped quotes in one pass", () => {
    // After the echo, each of 400,000 quotes starts a JSON string that never closes.
    const tail = `"${'\\"'.repeat(200_000)}`;
    const text = `x {"echo":"${unicodeEscaped}"} ${tail}`;
    const started = performance.now();
    expect(redaction.redactText(text, [UNICODE])).toBe(`x {"echo":"<redacted>"} ${tail}`);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("is redacted from surf use's result", async () => {
    for (const { name, secret, body, fragments } of cases) {
      const result = await runtime.runPlaybookOp({
        playbook,
        op: rawOp,
        env: { [ENV]: secret },
        executeTool: captureTab({ reply: () => ({ body }) }).executeTool,
      });
      for (const text of printed(result)) {
        expect(text, name).toContain("<redacted>");
        expect(exposed(text, fragments), name).toEqual([]);
      }
    }
  });

  it("is redacted from a structured tab error and a network strategy's error text", async () => {
    for (const { name, secret, body, fragments } of cases) {
      for (const error of [{ nested: { echo: body } }, `fetch failed: ${body}`]) {
        const events: Array<Record<string, unknown>> = [];
        const failed = await runtime.testPlaybookOp({
          playbook,
          op,
          env: { [ENV]: secret },
          executeTool: async () => ({ error }),
          onEvent: (event: Record<string, unknown>) => events.push(event),
        });
        expect(failed.status, name).toBe("failed");
        const failures = events.filter((event) => event.type === "strategy.failed");
        for (const text of [
          failed.error,
          failed.attempts[0].error,
          ...failures.map((event) => event.error as string),
          ...printed(failed),
        ]) {
          expect(text, name).toContain("<redacted>");
          expect(exposed(text, fragments), name).toEqual([]);
        }
      }
    }
  });

  it("is redacted from a generated client's output and HTTP error", async () => {
    for (const { name, secret, body, fragments } of cases) {
      for (const [status, served] of [
        [200, JSON.stringify({ result: { text: body } })],
        [500, body],
        [500, `${"x".repeat(400)}${body}`],
      ] as const) {
        const output = await runClient(secret, status, served);
        expect(output, `${name}, ${status}`).toContain("<redacted>");
        expect(exposed(output, fragments), `${name}, ${status}`).toEqual([]);
      }
    }
  }, 60_000);

  it("is masked from surf use and a client when it spans JSON keys and values", async () => {
    const spaced = join("dummy-left", '": "', "dummy-right");
    const compact = join("dummy-left", '":null,"', "dummy-right");
    for (const [secret, value] of [
      [spaced, { "dummy-left": "dummy-right" }],
      [compact, { "dummy-left": null, "dummy-right": 1 }],
    ] as const) {
      const result = await runtime.runPlaybookOp({
        playbook,
        op: rawOp,
        env: { [ENV]: secret },
        executeTool: captureTab({ reply: () => ({ body: JSON.stringify(value) }) }).executeTool,
      });
      expect(result.value).toBe("<redacted>");
      for (const text of printed(result)) {
        expect(text).not.toContain(secret);
      }
      const output = await runClient(secret, 200, JSON.stringify({ result: value }));
      expect(output).toContain("<redacted>");
      expect(output).not.toContain("dummy-left");
    }
    // A tab error object prints compact, which holds the compact one.
    const failed = await runtime.testPlaybookOp({
      playbook,
      op,
      env: { [ENV]: compact },
      executeTool: async () => ({ error: { "dummy-left": null, "dummy-right": 1 } }),
    });
    expect(failed.error).toContain("<redacted>");
    expect(failed.error).not.toContain("dummy-left");
  });

  it("is refused by both --save checks when it spans JSON keys and values", async () => {
    const spaced = join("dummy-left", '": "', "dummy-right");
    const compact = join("dummy-left", '":null,"', "dummy-right");
    for (const [secret, value] of [
      [spaced, { "dummy-left": "dummy-right" }],
      [compact, { "dummy-left": null, "dummy-right": 1 }],
    ] as const) {
      const { cwd, file } = tempShop(rawOp);
      const before = fs.readFileSync(file, "utf8");
      const hosted = hostedRun(secret, JSON.stringify(value));
      const asserts = ["--assert", "$.bodyJson", "equals", JSON.stringify(value)];
      await expect(save(cwd, asserts, { [ENV]: secret }, hosted)).rejects.toThrow(
        /--save refused: assertion 1 contains the value of SURF_TEST_ITEMS_KEY/,
      );
      expect(hosted).not.toHaveBeenCalled();
      await expect(save(cwd, asserts, {}, hosted)).rejects.toThrow(
        /--save refused: assertion 1's value passed through env-header redaction/,
      );
      expect(fs.readFileSync(file, "utf8")).toBe(before);
    }
  });

  it("masks text escaped past 8 levels even when no level shows the value", async () => {
    // 10 levels: its JSON string field holds text escaped 9 times.
    const deep = nested(join("dummy", "-other-", "text"), 10);
    const result = await runtime.runPlaybookOp({
      playbook,
      op: rawOp,
      env: { [ENV]: QUOTED },
      executeTool: captureTab({ reply: () => ({ body: deep }) }).executeTool,
    });
    expect(result.value.body).toBe('{"data":"<redacted>"}');
    // The parsed body's field holds 9 levels, which the 8 levels read reach.
    expect(result.value.bodyJson).toEqual(JSON.parse(deep));
    const output = await runClient(QUOTED, 500, deep);
    expect(output).toContain('HTTP 500: {"data":"<redacted>"}');
    expect(output).not.toContain("other");
    // An op without env values decodes and masks nothing.
    const request = { ...rawOp.run[0].request, authInputs: [] };
    const plain = await runtime.runPlaybookOp({
      playbook,
      op: { ...rawOp, run: [{ ...rawOp.run[0], request }] },
      env: {},
      executeTool: captureTab({ reply: () => ({ body: deep }) }).executeTool,
    });
    expect(plain.value.body).toBe(deep);
  });

  it("leaves values without it as they were, escapes and nested JSON included", async () => {
    const body = JSON.stringify({
      note: "a\\/b caf\\u00e9",
      data: JSON.stringify({ inner: JSON.stringify({ deeper: "dummy-plain/text" }) }),
      n: 12,
    });
    const result = await runtime.runPlaybookOp({
      playbook,
      op: rawOp,
      env: { [ENV]: QUOTED },
      executeTool: captureTab({ reply: () => ({ body }) }).executeTool,
    });
    expect(result.value.body).toBe(body);
    expect(result.value.bodyJson).toEqual(JSON.parse(body));
    const output = await runClient(QUOTED, 200, JSON.stringify({ result: JSON.parse(body) }));
    expect(JSON.parse(output)).toEqual(JSON.parse(body));
    // A plain echo keeps the text around it, as before.
    const echoed = await runtime.runPlaybookOp({
      playbook,
      op: rawOp,
      env: { [ENV]: QUOTED },
      executeTool: captureTab({ reply: () => ({ body: JSON.stringify({ key: QUOTED, n: 1 }) }) })
        .executeTool,
    });
    expect(echoed.value.body).toBe('{"key":"<redacted>","n":1}');
    expect(echoed.value.bodyJson).toEqual({ key: "<redacted>", n: 1 });
  });

  const MARKER = join("<", "redacted", ">");
  const TAIL = join("dummy", "-envelope-", "tail");
  // Each character as a regex \xNN escape, so the pattern's source spells nothing itself.
  const hexEscaped = (text: string) =>
    [...text].map((char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`).join("");
  const escapeTimes = (text: string, times: number) => {
    let spelled = text;
    for (let level = 0; level < times; level++) {
      spelled = JSON.stringify(spelled).slice(1, -1);
    }
    return spelled;
  };
  // The extracted value is the response's `tail`, or the whole response.
  const tailOp = (jsonPath: string) => ({
    ...rawOp,
    run: [{ ...rawOp.run[0], extract: { jsonPath } }],
  });

  it("finds a value that reads as redaction's marker, and both --save checks refuse it", async () => {
    expect(redaction.secretIn(MARKER, [MARKER])).toBe("found");
    const { cwd, file } = tempShop(rawOp);
    const before = fs.readFileSync(file, "utf8");
    const hosted = hostedRun(MARKER, JSON.stringify({ echo: MARKER }));
    const asserts = ["--assert", "$.bodyJson.echo", "equals", JSON.stringify(MARKER)];
    await expect(save(cwd, asserts, { [ENV]: MARKER }, hosted)).rejects.toThrow(
      /--save refused: assertion 1 contains the value of SURF_TEST_ITEMS_KEY/,
    );
    expect(hosted).not.toHaveBeenCalled();
    await expect(save(cwd, asserts, {}, hosted)).rejects.toThrow(
      /--save refused: assertion 1's value passed through env-header redaction/,
    );
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("refuses a matches pattern that spells the value with regex escapes, in both --save checks", async () => {
    const level4 = escapeTimes(QUOTED, 4);
    const patterns = [
      ["escaped 4 times", QUOTED, `^(?:ok|${hexEscaped(level4)})$`],
      ["written with \\/", SLASHED, `^(?:ok|${hexEscaped(SLASHED.replaceAll("/", "\\/"))})$`],
      ["written with \\u escapes", UNICODE, `^(?:ok|${hexEscaped(unicodeEscaped)})$`],
      // Escaped 4 times, its backslashes as {n} repeats and one letter in a group.
      [
        "with repeats and a group",
        QUOTED,
        "^(?:ok|dumm(?:y|z)\\x5c{15}\\x22quoted\\x5c{16}value)$",
      ],
    ];
    for (const [name, secret, pattern] of patterns) {
      expect(new RegExp(pattern).test("ok"), name).toBe(true);
      const { cwd, file } = tempShop(rawOp);
      const before = fs.readFileSync(file, "utf8");
      const hosted = hostedRun(secret, JSON.stringify({ text: "ok" }));
      const asserts = ["--assert", "$.bodyJson.text", "matches", pattern];
      await expect(save(cwd, asserts, { [ENV]: secret }, hosted), name).rejects.toThrow(
        /--save refused: assertion 1's pattern contains the value of SURF_TEST_ITEMS_KEY/,
      );
      expect(hosted, name).not.toHaveBeenCalled();
      await expect(save(cwd, asserts, {}, hosted), name).rejects.toThrow(
        /--save refused: assertion 1's value passed through env-header redaction/,
      );
      expect(fs.readFileSync(file, "utf8"), name).toBe(before);
    }
  });

  it("saves ordinary patterns with an env value set", async () => {
    const body = JSON.stringify({ text: "ok", n: "123", code: "ABC" });
    const { cwd, file } = tempShop(rawOp);
    const asserts = [
      ["$.bodyJson.n", "^\\d+$"],
      ["$.bodyJson.text", ".*ok.*"],
      ["$.bodyJson.code", "^[A-Z]{3}$"],
      ["$.bodyJson.text", "(?:ok|done)"],
      ["$.bodyJson.text", "^(?=\\w+$)ok$"],
    ].flatMap(([at, pattern]) => ["--assert", at, "matches", pattern]);
    const report = await save(cwd, asserts, { [ENV]: QUOTED }, hostedRun(QUOTED, body));
    expect(report.saved).toBe(file);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).on.success.expect.assert).toHaveLength(5);
    // The browser host, holding the value alone, marks none of them.
    const hosted = tempShop(rawOp);
    expect((await save(hosted.cwd, asserts, {}, hostedRun(QUOTED, body))).saved).toBe(hosted.file);
  });

  it("refuses a pattern that spells the value with classes or groups, or around a class", async () => {
    const body = JSON.stringify({ text: "ok" });
    const refused = [
      // One-character classes and groups stand for their characters.
      [`^(?:ok|${[...UNICODE].map((char) => `[${char}]`).join("")})$`, "contains the value of"],
      [`^(?:ok|${[...UNICODE].map((char) => `(?:${char})`).join("")})$`, "contains the value of"],
      [`^(?:ok|[\\x64]ummy-unicode-value)$`, "contains the value of"],
      // A class or . in place of a character the run doesn't reach still spells the rest.
      [
        "^(?:ok|dumm[xz]-unicode-valu.e)$",
        "spells most of the value of SURF_TEST_ITEMS_KEY around a character class",
      ],
      ["^(o)\\1?k$", "uses a backreference, which could repeat part of the value of"],
    ];
    for (const [pattern, reason] of refused) {
      expect(new RegExp(pattern).test("ok"), pattern).toBe(true);
      const { cwd, file } = tempShop(rawOp);
      const before = fs.readFileSync(file, "utf8");
      const hosted = hostedRun(UNICODE, body);
      const asserts = ["--assert", "$.bodyJson.text", "matches", pattern];
      await expect(save(cwd, asserts, { [ENV]: UNICODE }, hosted), pattern).rejects.toThrow(
        `--save refused: assertion 1's pattern ${reason}`,
      );
      expect(hosted, pattern).not.toHaveBeenCalled();
      await expect(save(cwd, asserts, {}, hosted), pattern).rejects.toThrow(
        /--save refused: assertion 1's value passed through env-header redaction/,
      );
      expect(fs.readFileSync(file, "utf8"), pattern).toBe(before);
    }
  });

  it("masks the result when surf's own fields and the response spell an env value together", async () => {
    // Compact (sent to the CLI, --json) and indented (printed): each spans the strategy or the key.
    for (const [secret, jsonPath] of [
      [join("network", '","value":"', TAIL), "$.tail"],
      [join("network", '","value":{"tail":"', TAIL), "$"],
      [join("value", '": "', TAIL), "$.tail"],
    ]) {
      const extractOp = tailOp(jsonPath);
      const executeTool = captureTab({
        reply: () => ({ body: JSON.stringify({ tail: TAIL }) }),
      }).executeTool;
      for (const run of [runtime.runPlaybookOp, runtime.testPlaybookOp]) {
        const result = await run({ playbook, op: extractOp, env: { [ENV]: secret }, executeTool });
        expect(result.value, secret).toBe("<redacted>");
        for (const text of printed(result)) {
          expect(text, secret).not.toContain(secret);
        }
      }
    }
    // A failed run's envelope, and the line pb test prints for its attempt.
    const secret = join("network: ", TAIL);
    const failed = await runtime.testPlaybookOp({
      playbook,
      op,
      env: { [ENV]: secret },
      executeTool: async () => ({ error: TAIL }),
    });
    expect(failed.status).toBe("failed");
    for (const text of [
      ...printed(failed),
      ...failed.attempts.map(
        (attempt: Record<string, unknown>) => `${attempt.using}: ${attempt.error}`,
      ),
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("refuses an assertion whose op and value spell an env value together", async () => {
    const secret = join("equals", '","value":"', TAIL);
    const extractOp = tailOp("$.tail");
    const { cwd, file } = tempShop(extractOp);
    const before = fs.readFileSync(file, "utf8");
    const hosted = hostedRun(secret, JSON.stringify({ tail: TAIL }), extractOp);
    const asserts = ["--assert", "$", "equals", JSON.stringify(TAIL)];
    await expect(save(cwd, asserts, { [ENV]: secret }, hosted)).rejects.toThrow(
      /--save refused: assertion 1 contains the value of SURF_TEST_ITEMS_KEY/,
    );
    expect(hosted).not.toHaveBeenCalled();
    await expect(save(cwd, asserts, {}, hosted)).rejects.toThrow(
      /--save refused: assertion 1's value passed through env-header redaction/,
    );
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    const report = await pbTest.runPlaybookTest({
      argv: ["shop", "items", ...asserts, "--json"],
      cwd,
      home: cwd,
      env: {},
      runOp: hosted,
    });
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  it("spends decoding work in proportion to its input, and masks what its budget can't cover", () => {
    // The reviewer's shape: a \u-escaped echo, then a long run of escaped quotes.
    const prefix = `{"echo":"${unicodeEscaped}"}`;
    const steps = [100_000, 200_000, 400_000, 800_000].map((size) => {
      const body = `${prefix}"${'\\"'.repeat(size / 2)}`;
      const budget = { steps: 0, limit: Number.POSITIVE_INFINITY };
      const redacted = redaction.redactJson({ body }, [UNICODE], budget);
      expect(redacted.body.startsWith('{"echo":"<redacted>"}"')).toBe(true);
      expect(budget.steps).toBeLessThan(redaction.decodeBudget(body.length).limit);
      return budget.steps;
    });
    for (let index = 1; index < steps.length; index++) {
      const ratio = steps[index] / steps[index - 1];
      expect(ratio).toBeGreaterThan(1.8);
      expect(ratio).toBeLessThan(2.2);
    }
    // Text the budget can't cover counts as holding the value: masked, and refused for --save.
    const spent = () => ({ steps: 0, limit: 10 });
    const text = "x".repeat(100);
    expect(redaction.secretIn(text, [UNICODE], { budget: spent() })).toBe("too costly");
    expect(redaction.redactText(text, [UNICODE], spent())).toBe("<redacted>");
    expect(redaction.redactJson({ text }, [UNICODE], spent())).toBe("<redacted>");
    expect(assertions.jsonSecretIn(text, [UNICODE], { budget: spent() })).toBe("too costly");
  });

  // A pb test --save of `$.bodyJson.text matches <pattern>` against a response of `ok`, with the
  // value in the caller's shell and then only on the browser host: each refusal's message (or
  // "saved"), whether the run started before the caller's refusal, and whether the file is as it was.
  async function bothSaves(secret: string, pattern: string) {
    return bothSavesOf(secret, ["--assert", "$.bodyJson.text", "matches", pattern]);
  }
  /** --save of `asserts` with `secret` in the shell, then on the host alone, answered with `body`. */
  async function bothSavesOf(secret: string, asserts: string[], body: unknown = { text: "ok" }) {
    const { cwd, file } = tempShop(rawOp);
    const before = fs.readFileSync(file, "utf8");
    const hosted = hostedRun(secret, JSON.stringify(body));
    const outcome = (env: Record<string, string>) =>
      save(cwd, asserts, env, hosted).then(
        (report: { saved: string | null; notSaved?: string }) =>
          report.saved ? "saved" : report.notSaved,
        (error: Error) => error.message,
      );
    const caller = await outcome({ [ENV]: secret });
    const ranBeforeCaller = hosted.mock.calls.length > 0;
    const host = await outcome({});
    return { caller, host, ranBeforeCaller, unchanged: fs.readFileSync(file, "utf8") === before };
  }
  const HOST_REFUSAL = /--save refused: assertion 1's value passed through env-header redaction/;

  it("checks a pattern on one work budget, and refuses one it can't cover", async () => {
    // The reviewer's shape: 64 alternatives, each a long run then a class, against a long value.
    const shape = (size: number) => `^(?:ok|(?:a|b|c|d|e|f|g|h){2}x{${size}}.)$`;
    const steps = [1000, 2000, 4000, 8000].map((size) => {
      const pattern = shape(size);
      const secret = "z".repeat(size);
      const work = assertions.patternWork(pattern, [secret]);
      expect(assertions.patternSecretIn(pattern, [secret], { work }), String(size)).toBe(
        "too costly",
      );
      expect(work.steps).toBeGreaterThan(0);
      expect(work.steps).toBeLessThanOrEqual(work.limit);
      return work.steps;
    });
    // Each doubling at most doubles the work, give or take: nothing grows with its square.
    for (let index = 1; index < steps.length; index++) {
      expect(steps[index] / steps[index - 1]).toBeLessThan(2.5);
    }
    // The run marks it, and --save refuses it with its own message.
    const secret = "z".repeat(2000);
    const [checked] = assertions.checkAssertions(
      { text: "ok" },
      [{ path: "$.text", op: "matches", value: shape(2000) }],
      [secret],
    );
    expect(checked.pass).toBe(true);
    expect(checked.secretSensitive).toBe(true);
    const saves = await bothSaves(secret, shape(2000));
    expect(saves.caller).toContain(
      "--save refused: checking assertion 1's pattern against the value of SURF_TEST_ITEMS_KEY takes more work than the check allows",
    );
    expect(saves).toMatchObject({ ranBeforeCaller: false, unchanged: true });
    expect(saves.host).toMatch(HOST_REFUSAL);
  });

  it("refuses a pattern whose characters are each optional, however it marks them", async () => {
    const secret = ["review", "unique", "env", "value"].join("-");
    const forms = [
      (char: string) => `${char}?`,
      (char: string) => `${char}*`,
      (char: string) => `${char}{0,1}`,
      (char: string) => `[${char}]?`,
      (char: string) => `(?:|${char})`,
    ];
    for (const form of forms) {
      const pattern = `^(?:ok|${[...secret].map(form).join("")}X)$`;
      // Stripping the marks gives the value: the pattern stores it.
      expect(new RegExp(pattern).test(`${secret}X`), pattern).toBe(true);
      expect(new RegExp(pattern).test("ok"), pattern).toBe(true);
      const saves = await bothSaves(secret, pattern);
      expect(saves.caller, pattern).toContain(
        "--save refused: assertion 1's pattern contains the value of SURF_TEST_ITEMS_KEY",
      );
      expect(saves, pattern).toMatchObject({ ranBeforeCaller: false, unchanged: true });
      expect(saves.host, pattern).toMatch(HOST_REFUSAL);
    }
  });

  it("tests a pattern against each spelling whole, never against its start alone", async () => {
    // Its first 2 KB match ^(?:ok|A+)$; the whole value doesn't.
    const secret = `${"A".repeat(2048)}-B`;
    const pattern = "^(?:ok|A+)$";
    expect(new RegExp(pattern).test(secret)).toBe(false);
    expect(assertions.patternSecretIn(pattern, [secret])).toBeNull();
    const body = JSON.stringify({ text: "ok" });
    const asserts = ["--assert", "$.bodyJson.text", "matches", pattern];
    const { cwd, file } = tempShop(rawOp);
    expect((await save(cwd, asserts, { [ENV]: secret }, hostedRun(secret, body))).saved).toBe(file);
    const hosted = tempShop(rawOp);
    expect((await save(hosted.cwd, asserts, {}, hostedRun(secret, body))).saved).toBe(hosted.file);
  });

  it("runs no regex on a spelling that lacks the text every match of the pattern holds", () => {
    // A spent regex budget fails any run, so null means none ran: `ok`, `done` and `ok` again are
    // in no spelling of the value, escaped or not.
    const spent = () => assertions.createRegexBudget(0);
    for (const pattern of [".*ok.*", "(?:ok|done)", "^\\w+ok\\b"]) {
      expect(
        assertions.patternSecretIn(pattern, [QUOTED], { budget: spent() }),
        pattern,
      ).toBeNull();
    }
    // A pattern without such text, or whose text the value holds, still runs.
    expect(assertions.patternSecretIn("^\\d+$", [QUOTED], { budget: spent() })).toBe(
      assertions.MATCH_SKIPPED,
    );
    expect(assertions.patternSecretIn("quoted", [QUOTED], { budget: spent() })).toBe(
      assertions.MATCH_SKIPPED,
    );
  });

  it("masks pb test's printed report where its assertion line spells an env value", async () => {
    // The line reads `FAIL  $ equals "ok" (<actual>)`: op, expected value and actual spell it.
    const secret = join('equals "ok" (', TAIL, ")");
    const extractOp = tailOp("$.tail");
    const asserts = ["--assert", "$", "equals", '"ok"'];
    for (const env of [{ [ENV]: secret }, {}]) {
      const { cwd } = tempShop(extractOp);
      const hosted = hostedRun(secret, JSON.stringify({ tail: TAIL }), extractOp);
      const report = await pbTest.runPlaybookTest({
        argv: ["shop", "items", ...asserts],
        cwd,
        home: cwd,
        env,
        runOp: hosted,
      });
      expect(report.ok).toBe(false);
      const shown = pbTest.formatTestReport(report);
      expect(shown).toContain("FAIL  <redacted> equals");
      for (const text of [shown, ...printed(report)]) {
        expect(text).not.toContain(secret);
      }
    }
    // A runOp that hands back the assertions as checked: the caller's own check masks them.
    const { cwd } = tempShop(extractOp);
    const raw = {
      status: "failed",
      error: "All strategies failed",
      attempts: [
        {
          using: "network",
          error: "assertion failed: $ equals",
          assertions: [{ path: "$", op: "equals", value: "ok", pass: false, actual: TAIL }],
        },
      ],
    };
    const report = await pbTest.runPlaybookTest({
      argv: ["shop", "items", ...asserts],
      cwd,
      home: cwd,
      env: { [ENV]: secret },
      runOp: async () => raw,
    });
    expect(pbTest.formatTestReport(report)).not.toContain(secret);
  });

  it("treats an unset or empty env value as no value, not as the text undefined", async () => {
    const optional = {
      ...op,
      run: [
        {
          ...op.run[0],
          request: {
            ...op.run[0].request,
            authInputs: [{ env: ENV, header: "X-Api-Key", required: false }],
          },
        },
      ],
    };
    const failed = await runtime.testPlaybookOp({
      playbook,
      op: optional,
      env: {},
      executeTool: async () => ({ error: "server said undefined" }),
    });
    expect(failed.error).toContain("server said undefined");
    expect(failed.attempts[0].error).toContain("server said undefined");
    const result = { status: "completed", value: "the server returned undefined", attempts: [] };
    expect(redaction.redactResult(result, [undefined, ""])).toEqual(result);
    expect(redaction.secretIn("undefined", [undefined, null, ""])).toBeNull();
    expect(redaction.redactValues("undefined null", [undefined, null])).toBe("undefined null");
  });

  it("refuses a pattern with more readings than it can list when a listed one shares 6 characters with the value", async () => {
    // The reviewer's shape: 17 × 17 readings, the value in a reading that is neither side's first.
    // The listed readings hold each side's half next to the other side's first.
    const side = (name: string) =>
      Array.from({ length: 17 }, (_, index) => [name, String(index).padStart(2, "0")].join(""));
    const left = side(["head", "a"].join("-"));
    const right = side(["tail", "b"].join("-"));
    const secret = left[1] + right[1];
    const pattern = `^(?:ok|(?:${left.join("|")})(?:${right.join("|")})X)$`;
    expect(new RegExp(pattern).test(`${secret}X`)).toBe(true);
    expect(assertions.patternTexts(pattern).exact).toBe(false);
    expect(assertions.patternSecretIn(pattern, [secret])).toBe("shares");
    const saves = await bothSaves(secret, pattern);
    expect(saves.caller).toContain(
      "--save refused: assertion 1's pattern shares 6 or more characters in a row with the value of SURF_TEST_ITEMS_KEY; assert on something else",
    );
    expect(saves).toMatchObject({ ranBeforeCaller: false, unchanged: true });
    expect(saves.host).toMatch(HOST_REFUSAL);
  });

  it("lists every reading of ordinary patterns, so they still save with a long env value", async () => {
    const secret = "z".repeat(8192);
    const ordinary = [
      ["^\\d+$", "123"],
      [".*ok.*", "ok"],
      ["^[A-Z]{3}$", "ABC"],
      ["(?:ok|done)", "ok"],
      ["^(?=\\w+$)ok$", "ok"],
      ["\\bok\\b", "ok"],
      ["[a-f0-9]{32}", "a".repeat(32)],
      // A wide repeat of a class lists as the class and any more copies: nothing is lost.
      ["^\\w{1,300}$", "ok"],
      ["^(?!error)ok$", "ok"],
      ["^(?=.*ok)\\w+ok$", "took"],
    ];
    for (const [pattern, text] of ordinary) {
      expect(assertions.patternTexts(pattern).exact, pattern).toBe(true);
      expect(assertions.patternSecretIn(pattern, [secret]), pattern).toBeNull();
      const body = JSON.stringify({ text });
      const asserts = ["--assert", "$.bodyJson.text", "matches", pattern];
      const { cwd, file } = tempShop(rawOp);
      expect(
        (await save(cwd, asserts, { [ENV]: secret }, hostedRun(secret, body))).saved,
        pattern,
      ).toBe(file);
      const hosted = tempShop(rawOp);
      expect((await save(hosted.cwd, asserts, {}, hostedRun(secret, body))).saved, pattern).toBe(
        hosted.file,
      );
    }
  });

  it("reads a pattern's lookarounds in place, so their texts and the rest can't split the value", async () => {
    const first = ["prefix", "fragment"].join("-");
    const last = ["suffix", "fragment"].join("-");
    const secret = first + last;
    const splits = [
      // The reviewer's case: two lookaheads, each under 3/4 of the value. It matches only ok,
      // but its text stores the value.
      {
        pattern: `^(?:ok|(?=${first})(?=.{${first.length}}${last})X)$`,
        refusal: "spells most of the value of SURF_TEST_ITEMS_KEY around the wildcard .",
      },
      // One lookahead and the text after it.
      {
        pattern: `^(?:ok|(?=${first}).{${first.length}}${last}X)$`,
        refusal: "spells most of the value of SURF_TEST_ITEMS_KEY around the wildcard .",
      },
      // A lookahead right after the text before it.
      {
        pattern: `^(?:ok|${first}(?=${last}).+X)$`,
        refusal: "contains the value of SURF_TEST_ITEMS_KEY",
      },
    ];
    expect(new RegExp(splits[1].pattern).test(`${secret}X`)).toBe(true);
    expect(new RegExp(splits[2].pattern).test(`${secret}X`)).toBe(true);
    for (const { pattern, refusal } of splits) {
      expect(new RegExp(pattern).test("ok"), pattern).toBe(true);
      const saves = await bothSaves(secret, pattern);
      expect(saves.caller, pattern).toContain(`--save refused: assertion 1's pattern ${refusal}`);
      expect(saves, pattern).toMatchObject({ ranBeforeCaller: false, unchanged: true });
      expect(saves.host, pattern).toMatch(HOST_REFUSAL);
    }
  });
  it("refuses a pattern that shares 6 characters in a row with any spelling of the value", async () => {
    const secret = ["dummy", "shared", "run", "value", "for", "tests"].join("-");
    const quoted = join("dummy", '"', "quoted", "-shared-run-value");
    const slashed = ["dummy", "slashed", "run", "value", "for", "tests"].join("/");
    const hex = (text: string) =>
      [...text].map((char) => `\\x${char.charCodeAt(0).toString(16)}`).join("");
    const unicode = (text: string) =>
      [...text].map((char) => `\\\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
    const refused = [
      // Six characters of the value, as they are and as regex escapes.
      { secret, pattern: `^(?:ok|${secret.slice(6, 12)}X)$` },
      { secret, pattern: `^(?:ok|${hex(secret.slice(6, 12))}X)$` },
      // Six characters of its JSON-escaped, \/ and \uXXXX spellings, which the value lacks.
      { secret: quoted, pattern: `^(?:ok|y\\\\"quoX)$` },
      { secret: slashed, pattern: `^(?:ok|y\\\\\\/sla)$` },
      { secret, pattern: `^(?:ok|${unicode("sh")}X)$` },
    ];
    for (const { secret: value, pattern } of refused) {
      expect(assertions.patternSecretIn(pattern, [value]), pattern).toBe("shares");
      const saves = await bothSaves(value, pattern);
      expect(saves.caller, pattern).toContain(
        "--save refused: assertion 1's pattern shares 6 or more characters in a row with the value of SURF_TEST_ITEMS_KEY; assert on something else",
      );
      expect(saves, pattern).toMatchObject({ ranBeforeCaller: false, unchanged: true });
      expect(saves.host, pattern).toMatch(HOST_REFUSAL);
    }
    // Five characters, or six split by a class, are not a shared run.
    const kept = [
      `^(?:ok|${secret.slice(6, 11)}X)$`,
      `^(?:ok|${secret.slice(6, 9)}[ab]${secret.slice(9, 12)}X)$`,
    ];
    for (const pattern of kept) {
      expect(assertions.patternSecretIn(pattern, [secret]), pattern).toBeNull();
      expect((await bothSaves(secret, pattern)).caller, pattern).toBe("saved");
    }
  });

  it("refuses a pattern whose text holds a whole short value, beside other characters", async () => {
    // Under 8 characters, secretIn finds a value only where it stands alone, and the shared-run
    // rule needs 6 characters: a whole copy next to a letter, overflowing or not, is still one.
    const three = ["n", "Q7"].join("");
    const five = ["nQ7", "zR"].join("");
    const hex = (text: string) =>
      [...text].map((char) => `\\x${char.charCodeAt(0).toString(16)}`).join("");
    const unicode = (text: string) =>
      [...text].map((char) => `\\\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
    const words = "(?:red|green|blue|orange){6}!";
    // Where the pattern as written holds it, the check of the assertion's value finds it first.
    const value = "assertion 1";
    const refused = [
      // The reviewer's cases: a{1,300} and the {6} group overflow the listing.
      { secret: three, pattern: `^(?:ok|a{1,300}${three}X)$`, where: value },
      { secret: five, pattern: `^(?:ok|${five}X|${words})$`, where: value },
      { secret: five, pattern: `^(?:ok|${hex(five)}X|${words})$`, where: "assertion 1's pattern" },
      // Without an overflow, and in the JSON-escaped, \/ and \uXXXX spellings.
      { secret: three, pattern: `^(?:ok|${three}X)$`, where: value },
      { secret: join("q", '"', "7"), pattern: '^(?:ok|q\\\\"7X)$', where: value },
      { secret: join("q", "/", "7"), pattern: "^(?:ok|q\\\\\\/7X)$", where: value },
      { secret: three, pattern: `^(?:ok|${unicode(three)}X)$`, where: value },
    ];
    for (const { secret, pattern, where } of refused) {
      expect(new RegExp(pattern).test("ok"), pattern).toBe(true);
      expect(assertions.patternSecretIn(pattern, [secret]), pattern).toBe("found");
      const saves = await bothSaves(secret, pattern);
      expect(saves.caller, pattern).toBe(
        `--save refused: ${where} contains the value of SURF_TEST_ITEMS_KEY, which is never stored; assert on something else`,
      );
      expect(saves, pattern).toMatchObject({ ranBeforeCaller: false, unchanged: true });
      expect(saves.host, pattern).toMatch(HOST_REFUSAL);
    }
    // Part of the value is not a whole copy.
    const kept = [
      { secret: three, pattern: `^(?:ok|a{1,300}${three.slice(0, 2)}X)$` },
      { secret: five, pattern: `^(?:ok|${five.slice(0, 4)}X|${words})$` },
    ];
    for (const { secret, pattern } of kept) {
      expect(assertions.patternSecretIn(pattern, [secret]), pattern).toBeNull();
      expect((await bothSaves(secret, pattern)).caller, pattern).toBe("saved");
    }
  });

  it("refuses a pattern whose source or decoded text holds a whole short value", async () => {
    // A value with regex syntax, pasted as it is, reads as other characters once parsed; and a
    // JSON escape may use either case of hex, at any depth.
    const back = "\\";
    const lt = String.fromCharCode(0x3c);
    // The assertion's value holds the pattern as written, so both checks read it there first.
    const refused = [
      { secret: join("n", ".", "Q"), pattern: "^(?:ok|n.QX)$" },
      { secret: join("n", "?", "Q"), pattern: "^(?:ok|n?QX)$" },
      { secret: join("n", "|", "Q"), pattern: "^(?:ok|n|QX)$" },
      { secret: join("n", "(Q)"), pattern: "^(?:ok|n(Q)X)$" },
      { secret: join("n", "{3}"), pattern: "^(?:ok|n{3}X)$" },
      { secret: join("n", back, back, "Q"), pattern: join("^(?:ok|n", back, back, "QX)$") },
      // \u003C as JSON in the pattern's text: uppercase, mixed with \u0037, two levels deep, optional.
      { secret: join(lt, "Q7"), pattern: join("^(?:ok|", back, back, "u003CQ7X)$") },
      {
        secret: join(lt, "Q7"),
        pattern: join("^(?:ok|", back, back, "u003CQ", back, back, "u0037X)$"),
      },
      { secret: join(lt, "Q7"), pattern: join("^(?:ok|", back.repeat(4), "u003CQ7X)$") },
      // Both at once: only the source, decoded, holds it.
      { secret: join(lt, ".Q"), pattern: join("^(?:ok|", back, back, "u003C.QX)$") },
    ].map((test) => ({ ...test, where: "assertion 1" }));
    // Only the pattern's texts, decoded, hold it: \x5c is a backslash, and (?:<)? spells < too.
    for (const pattern of [
      join("^(?:ok|", back, "x5cu003CQ7X)$"),
      join("^(?:ok|(?:", back, back, "u003C)?Q?7?X)$"),
    ]) {
      refused.push({ secret: join(lt, "Q7"), pattern, where: "assertion 1's pattern" });
    }
    for (const { secret, pattern, where } of refused) {
      expect(new RegExp(pattern).test("ok"), pattern).toBe(true);
      expect(assertions.patternSecretIn(pattern, [secret]), pattern).toBe("found");
      const saves = await bothSaves(secret, pattern);
      expect(saves.caller, pattern).toBe(
        `--save refused: ${where} contains the value of SURF_TEST_ITEMS_KEY, which is never stored; assert on something else`,
      );
      expect(saves, pattern).toMatchObject({ ranBeforeCaller: false, unchanged: true });
      expect(saves.host, pattern).toMatch(HOST_REFUSAL);
    }
    // Part of the value, in the source or decoded, is not a whole copy.
    const kept = [
      { secret: join("n", ".", "Q"), pattern: "^(?:ok|n.X)$" },
      { secret: join("n", back, back, "Q"), pattern: join("^(?:ok|n", back, back, "X)$") },
      { secret: join(lt, "Q7"), pattern: join("^(?:ok|", back, back, "u003CQX)$") },
    ];
    for (const { secret, pattern } of kept) {
      expect(assertions.patternSecretIn(pattern, [secret]), pattern).toBeNull();
      expect((await bothSaves(secret, pattern)).caller, pattern).toBe("saved");
    }
  });

  it("refuses any assertion whose path, op or value holds a short value next to other characters", async () => {
    // Output redaction masks a short value only where it stands alone; --save refuses any copy.
    const secret = join("z", "9");
    // Each passes, so the host would save it but for the check.
    const escaped = join("X", "\\", "u007a9X");
    const refused = [
      { asserts: ["--assert", "$.bodyJson.text", "equals", '"Xz9X"'], body: { text: "Xz9X" } },
      { asserts: ["--assert", "$.bodyJson.Xz9X", "exists"], body: { Xz9X: 1 } },
      {
        asserts: ["--assert", "$.bodyJson.text", "equals", '{"Xz9X":1}'],
        body: { text: { Xz9X: 1 } },
      },
      {
        asserts: ["--assert", "$.bodyJson.text", "equals", JSON.stringify(escaped)],
        body: { text: escaped },
      },
    ];
    for (const { asserts, body } of refused) {
      const saves = await bothSavesOf(secret, asserts, body);
      expect(saves.caller, asserts.join(" ")).toBe(
        "--save refused: assertion 1 contains the value of SURF_TEST_ITEMS_KEY, which is never stored; assert on something else",
      );
      expect(saves, asserts.join(" ")).toMatchObject({ ranBeforeCaller: false, unchanged: true });
      expect(saves.host, asserts.join(" ")).toMatch(HOST_REFUSAL);
    }
    // An assertion that doesn't hold it saves, on both paths; so does a response holding it.
    const kept = [
      { asserts: ["--assert", "$.bodyJson.text", "exists"], body: { text: "Xz9X" } },
      { asserts: ["--assert", "$.bodyJson.text", "not_null"], body: { text: "Xz9X" } },
      { asserts: ["--assert", "$.bodyJson.text", "equals", '"Xz8X"'], body: { text: "Xz8X" } },
    ];
    for (const { asserts, body } of kept) {
      const saves = await bothSavesOf(secret, asserts, body);
      expect(saves, asserts.join(" ")).toMatchObject({ caller: "saved", host: "saved" });
    }
    // Printed results still mask a short value only where it stands alone.
    expect(redaction.redactText("Xz9X", [secret])).toBe("Xz9X");
  });

  it("saves an assertion whose op or path syntax alone spells a short value, and refuses a copy across a path's keys", async () => {
    // surf's own words and a path's syntax hold no pasted value.
    const kept = [
      { secret: join("e", "x"), asserts: ["$.bodyJson.title", "exists"], body: { title: "ok" } },
      {
        secret: join("q", "u"),
        asserts: ["$.bodyJson.text", "equals", '"ok"'],
        body: { text: "ok" },
      },
      { secret: join("o", "t"), asserts: ["$.bodyJson.text", "not_null"], body: { text: "ok" } },
      {
        secret: join("a", "y"),
        asserts: ["$.bodyJson.text", "array_min_len", "1"],
        body: { text: [1] },
      },
      {
        secret: join("t", "ch"),
        asserts: ["$.bodyJson.text", "matches", "^ok$"],
        body: { text: "ok" },
      },
      { secret: join("$", "."), asserts: ["$.bodyJson.text", "exists"], body: { text: "ok" } },
      { secret: join("."), asserts: ["$.bodyJson.text", "exists"], body: { text: "ok" } },
      {
        secret: join("[", "0]"),
        asserts: ["$.bodyJson.items[0].text", "exists"],
        body: { items: [{ text: "ok" }] },
      },
      {
        secret: join("[", "*]."),
        asserts: ["$.bodyJson.items[*].text", "exists"],
        body: { items: [{ text: "ok" }] },
      },
      {
        secret: join("? "),
        asserts: ["$.bodyJson.gone ?? bodyJson.text", "exists"],
        body: { text: "ok" },
      },
    ];
    for (const { secret, asserts, body } of kept) {
      const saves = await bothSavesOf(secret, ["--assert", ...asserts], body);
      expect(saves, `${secret} ${asserts.join(" ")}`).toMatchObject({
        caller: "saved",
        host: "saved",
      });
    }
    // A copy with any key character in it is refused, across keys and indexes too.
    const refused = [
      { secret: join("n", ".Q"), asserts: ["$.bodyJson.Xn.QX", "exists"], body: { Xn: { QX: 1 } } },
      {
        secret: join("n", "[0]"),
        asserts: ["$.bodyJson.Xn[0].text", "exists"],
        body: { Xn: [{ text: 1 }] },
      },
      {
        secret: join("z", "9"),
        asserts: ["$.bodyJson.text", "equals", '"Xz9X"'],
        body: { text: "Xz9X" },
      },
      { secret: join("z", "9"), asserts: ["$.bodyJson.Xz9X", "exists"], body: { Xz9X: 1 } },
    ];
    for (const { secret, asserts, body } of refused) {
      const saves = await bothSavesOf(secret, ["--assert", ...asserts], body);
      expect(saves.caller, `${secret} ${asserts.join(" ")}`).toBe(
        "--save refused: assertion 1 contains the value of SURF_TEST_ITEMS_KEY, which is never stored; assert on something else",
      );
      expect(saves.host, `${secret} ${asserts.join(" ")}`).toMatch(HOST_REFUSAL);
    }
    // A key's JSON escapes are read as the key characters they spell.
    const escaped = { path: join("$.X", "\\", "u006e.QX"), op: "exists" };
    expect(assertions.assertionSecretIn(escaped, [join("n", ".Q")])).toBe("found");
    expect(assertions.assertionSecretIn(escaped, [join("6", "e.")])).toBe("found");
    expect(
      assertions.assertionSecretIn({ path: "$.items[1234]", op: "exists" }, [join("2", "3")]),
    ).toBeNull();
    expect(assertions.assertionSecretIn({ path: "$.X$X", op: "exists" }, [join("$")])).toBe(
      "found",
    );
    // A key holding it is a copy, whatever the op: te(ex)t.
    expect(assertions.assertionSecretIn({ path: "$.text", op: "exists" }, [join("e", "x")])).toBe(
      "found",
    );
  });

  it("saves a pattern whose readings overflow the listing, checking what it lists", async () => {
    // Without an a: a{1,300} matches any value holding one, which the spelling test still refuses.
    const secret = ["dummy", "env", "text", "for", "overflow"].join("-");
    const overflowing = [
      ["^(?i:ok)$", "OK"],
      ["a{1,300}", "aaa"],
      ["^(?:red|green|blue|orange){6}!$", "redgreenblueorangeredred!"],
      ["^(?:ok|(?:red|green|blue|orange){6}!)$", "ok"],
      ["^https://api\\.example\\.com(?:/[a-z0-9-]+){0,300}$", "https://api.example.com/v1/items"],
    ];
    for (const [pattern, text] of overflowing) {
      expect(new RegExp(pattern).test(text), pattern).toBe(true);
      expect(assertions.patternTexts(pattern).exact, pattern).toBe(false);
      expect(assertions.patternSecretIn(pattern, [secret]), pattern).toBeNull();
      const body = JSON.stringify({ text });
      const asserts = ["--assert", "$.bodyJson.text", "matches", pattern];
      const { cwd, file } = tempShop(rawOp);
      expect(
        (await save(cwd, asserts, { [ENV]: secret }, hostedRun(secret, body))).saved,
        pattern,
      ).toBe(file);
      const hosted = tempShop(rawOp);
      expect((await save(hosted.cwd, asserts, {}, hostedRun(secret, body))).saved, pattern).toBe(
        hosted.file,
      );
    }
  });

  it("refuses none of the review corpus's guard patterns, and few of its ordinary ones", () => {
    // 44 patterns × 32 values: 1,408 pairs, each checked alone.
    const values = corpusValues();
    const counts: Record<string, number> = {};
    const refused: string[] = [];
    for (const [name, pattern] of corpusPatterns) {
      for (const [valueName, value] of values) {
        const found = assertions.patternSecretIn(pattern, [value]);
        if (found !== null) {
          const status = typeof found === "string" ? found : "around";
          counts[status] = (counts[status] ?? 0) + 1;
          refused.push(`${name} ${valueName} ${status}`);
        }
      }
    }
    expect(corpusPatterns.length * values.length).toBe(1408);
    // A guard is refused only where the pattern matches the value itself (.*ok.* on a value
    // holding ok), never by the 6-character rule.
    expect(
      refused.filter((pair) => pair.startsWith("guard-") && !pair.endsWith(" matches")),
    ).toEqual([]);
    // The spelling test refuses 28 pairs whose pattern matches the value; the 6-character rule
    // 5 more (0.36%), each sharing a prefix such as https: or authen with a composite value.
    expect(counts).toEqual({ matches: 28, shares: 5 });
  });
});
