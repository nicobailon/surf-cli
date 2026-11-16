// What surf do and surf --script print before and while they run: no typed text or variable values.
import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const executor = require("../../native/do-executor.cjs");

const cli = resolve("native/cli.cjs");
// A dummy value, built from parts so no literal here reads as a credential.
const TYPED = ["dummy", "typed", "pw", "5"].join("-");
const roots: string[] = [];

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), "surf-do-redaction-"));
  roots.push(root);
  return root;
}

function run(args: string[], root: string) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, SURF_SOCKET: join(root, "absent.sock") },
  });
  return { ...result, output: `${result.stdout}${result.stderr}` };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("surf do and surf --script output", () => {
  it("prints a step's typed text as its argument name while running", async () => {
    const printed: string[] = [];
    const { stdout } = (
      globalThis as unknown as { process: { stdout: { write(chunk: unknown): boolean } } }
    ).process;
    vi.spyOn(stdout, "write").mockImplementation((chunk: unknown) => {
      printed.push(String(chunk));
      return true;
    });
    vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      printed.push(parts.join(" "));
    });
    await executor.executeDoSteps(
      [
        { cmd: "type", args: { selector: "#pw", text: TYPED } },
        { cmd: "key", args: { key: TYPED } },
      ],
      { executeTool: async () => ({ result: {} }), stepDelay: 0, autoWait: false },
    );
    vi.restoreAllMocks();
    expect(printed.join("")).not.toContain(TYPED);
    expect(printed.join("")).toContain('[1/2] type selector="#pw" text="<text>"');
  });

  it("dry-runs a literal step without printing what it types", () => {
    const root = tempRoot();
    const result = run(["do", `type "${TYPED}"`, "--dry-run"], root);
    expect(result.status).toBe(0);
    expect(result.output).toContain("type");
    expect(result.output).not.toContain(TYPED);
  });

  it("dry-runs a workflow without printing its variables' values", () => {
    const root = tempRoot();
    const file = join(root, "login.json");
    writeFileSync(
      file,
      JSON.stringify({
        name: "login",
        args: { password: { required: true } },
        steps: [{ tool: "type", args: { selector: "#pw", text: "%{password}" } }],
      }),
    );
    const result = run(["do", "--file", file, "--dry-run", "--password", TYPED], root);
    expect(result.status).toBe(0);
    expect(result.output).toContain("password");
    expect(result.output).not.toContain(TYPED);
  });

  it("dry-runs a --script without printing what its steps type", () => {
    const root = tempRoot();
    const file = join(root, "script.json");
    writeFileSync(
      file,
      JSON.stringify({ steps: [{ tool: "type", args: { selector: "#pw", text: TYPED } }] }),
    );
    const result = run(["--script", file, "--dry-run"], root);
    expect(result.status).toBe(0);
    expect(result.output).toContain("type");
    expect(result.output).not.toContain(TYPED);
  });
});
