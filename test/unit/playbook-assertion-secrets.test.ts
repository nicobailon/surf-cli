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
