// Assertions and env-header values: what pb test may save, and what a run reports and journals.
import { afterEach, describe, expect, it, vi } from "vitest";

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

function tempShop() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "surf-assert-secrets-"));
  tempDirs.push(cwd);
  const directory = path.join(cwd, ".surf", "playbooks", "shop");
  fs.mkdirSync(path.join(directory, "ops"), { recursive: true });
  fs.writeFileSync(
    path.join(directory, "playbook.json"),
    JSON.stringify({ id: "shop", version: "1.0.0", origins: ["https://api.test"] }),
  );
  const file = path.join(directory, "ops", "items.json");
  fs.writeFileSync(file, `${JSON.stringify(op, null, 2)}\n`);
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
function hostRun(result: unknown, secret: string, assert: unknown[], onEvent = () => {}) {
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
    const failed = await hostRun({ x: "other" }, QUOTED, [{ path: "$.x", op: "equals", value: QUOTED }], (event: Record<string, unknown>) => events.push(event));
    expect(failed.status).toBe("failed");
    expect(failed.attempts[0].assertions[0]).toMatchObject({ value: "<redacted>", pass: false });
    const failures = events.filter((event) => event.type === "strategy.failed");
    expect(failures).toHaveLength(1);
    // The raw strings: JSON.stringify of the whole result would escape them again and hide a leak.
    for (const text of [failed.error, failed.attempts[0].error, ...failures.map((event) => event.error)]) {
      expect(text).not.toContain(escaped);
      expect(text).not.toContain(QUOTED);
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
