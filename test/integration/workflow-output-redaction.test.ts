// What surf do and surf --script print before and while they run: no typed text or variable values.
import { afterEach, describe, expect, it, vi } from "vitest";

const { spawn, spawnSync } = require("node:child_process");
const net = require("node:net");
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
    // Its own HOME, so an echoValue in the user's ~/surf.json doesn't apply.
    env: { ...process.env, HOME: root, SURF_SOCKET: join(root, "absent.sock") },
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
        { cmd: "key", args: { key: "Enter", text: TYPED } },
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
    expect(result.output).toContain("  password = <redacted>");
    expect(result.output).not.toContain(TYPED);
    const echoed = run(
      ["do", "--file", file, "--dry-run", "--echo-value", "--password", TYPED],
      root,
    );
    expect(echoed.status).toBe(0);
    expect(echoed.output).toContain(`  password = "${TYPED}"`);
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

  it("prints a failed --script step's error without the text it typed", async () => {
    const root = tempRoot();
    // A dummy value with a quote and a backslash, quoted back by the error as is and escaped.
    const quoted = ["dummy", 'quo"ted', "va\\lue", "5"].join("-");
    const file = join(root, "script.json");
    writeFileSync(
      file,
      JSON.stringify({ steps: [{ tool: "type", args: { selector: "#pw", text: quoted } }] }),
    );
    const socketPath = join(tmpdir(), `surf-script-${process.pid}-${Date.now()}.sock`);
    const error = `could not type "${quoted}" (${JSON.stringify(quoted)})`;
    const server = net.createServer(
      (socket: {
        on(event: string, listener: (chunk: unknown) => void): void;
        write(text: string): void;
      }) => {
        let buffer = "";
        socket.on("data", (chunk: unknown) => {
          buffer += String(chunk);
          for (let end = buffer.indexOf("\n"); end !== -1; end = buffer.indexOf("\n")) {
            const request = JSON.parse(buffer.slice(0, end));
            buffer = buffer.slice(end + 1);
            socket.write(
              `${JSON.stringify({ id: request.id, error: { content: [{ type: "text", text: error }] } })}\n`,
            );
          }
        });
      },
    );
    await new Promise((listening) => server.listen(socketPath, listening));
    try {
      const output = await new Promise<string>((done) => {
        const child = spawn(process.execPath, [cli, "--script", file], {
          env: { ...process.env, SURF_SOCKET: socketPath },
        });
        let text = "";
        child.stdout.on("data", (chunk: unknown) => {
          text += String(chunk);
        });
        child.stderr.on("data", (chunk: unknown) => {
          text += String(chunk);
        });
        child.on("close", () => done(text));
      });
      expect(output).toContain("FAIL");
      expect(output).toContain("could not type");
      expect(output).not.toContain("dummy");
    } finally {
      await new Promise((closed) => server.close(closed));
      rmSync(socketPath, { force: true });
    }
  });
});
