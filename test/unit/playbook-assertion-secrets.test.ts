// Assertions and env-header values: what pb test may save, and what a run reports and journals.
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureTab } from "../fixtures/capture-tab";

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

const runtime = require("../../native/playbook-runtime.cjs");
const assertions = require("../../native/playbook-assertions.cjs");
const clients = require("../../native/playbook-client.cjs");
const pbTest = require("../../native/playbook-test.cjs");

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
