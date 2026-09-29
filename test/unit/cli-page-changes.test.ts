import { afterEach, describe, expect, it } from "vitest";

declare const process: {
  cwd(): string;
  env: Record<string, string | undefined>;
  execPath: string;
  platform: string;
};
declare const require: (moduleName: string) => any;

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const tempPaths: string[] = [];
const cliPath = path.join(process.cwd(), "native", "cli.cjs");

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "surf-cli-page-changes-"));
  tempPaths.push(dir);
  return dir;
}

async function runCli(
  args: string[],
  { surfJson, reply = {} }: { surfJson?: object; reply?: Record<string, unknown> } = {},
) {
  // The CLI reads surf.json from its cwd, then from the home directory.
  const home = tempDir();
  if (surfJson) {
    fs.writeFileSync(path.join(home, "surf.json"), JSON.stringify(surfJson));
  }
  const socketPath =
    process.platform === "win32"
      ? `\\\\.\\pipe\\surf-cli-page-changes-${Date.now()}-${Math.random().toString(16).slice(2)}`
      : path.join(home, "surf.sock");

  let request: any;
  const server = net.createServer((socket: any) => {
    let buffer = "";
    socket.on("data", (chunk: { toString(): string }) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        request = JSON.parse(line);
        socket.write(
          `${JSON.stringify({
            id: request.id,
            result: {
              content: [{ type: "text", text: "OK\nScreenshot (pending): /tmp/pi-auto-1.png" }],
            },
            ...reply,
          })}\n`,
        );
        socket.end();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });

  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve) => {
      const child = spawn(process.execPath, [cliPath, ...args], {
        cwd: home,
        env: { ...process.env, HOME: home, SURF_SOCKET: socketPath },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: { toString(): string }) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: { toString(): string }) => {
        stderr += chunk.toString();
      });
      child.on("close", (code: number | null) => resolve({ code, stdout, stderr }));
    },
  );
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return { ...result, request };
}

const pageChanges = {
  settle: { state: "settled", ms: 340 },
  navigated: null,
  changes: [
    {
      kind: "changed",
      ref: "e5",
      role: "checkbox",
      name: "Agree",
      property: "checked",
      from: false,
      to: true,
    },
  ],
  text: [],
  omitted: 0,
};

afterEach(() => {
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

describe("page changes CLI", () => {
  it("requests page changes for actions with the default settle cap", async () => {
    const click = await runCli(["click", "e5"]);
    expect(click.request.params.args.pageChanges).toEqual({ settleMs: 2000 });
    const select = await runCli(["select", "#size", "large"]);
    expect(select.request.params.args.pageChanges).toEqual({ settleMs: 2000 });
    const read = await runCli(["read"]);
    expect(read.request.params.args.pageChanges).toBeUndefined();
  });

  it("uses --settle, then surf.json settleMs, and --no-diff turns it off", async () => {
    const flag = await runCli(["click", "e5", "--settle", "30000"], {
      surfJson: { settleMs: 800 },
    });
    expect(flag.request.params.args.pageChanges).toEqual({ settleMs: 30000 });
    expect(flag.request.params.args.settle).toBeUndefined();
    const config = await runCli(["click", "e5"], { surfJson: { settleMs: 800 } });
    expect(config.request.params.args.pageChanges).toEqual({ settleMs: 800 });
    const off = await runCli(["click", "e5", "--no-diff"]);
    expect(off.request.params.args.pageChanges).toBeUndefined();
    expect(off.request.params.args["no-diff"]).toBeUndefined();
  });

  it("rejects invalid settle values before sending a request", async () => {
    for (const value of ["abc", "1.5", "-1", "30001"]) {
      const result = await runCli(["click", "e5", "--settle", value]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(
        "--settle requires a whole number of milliseconds from 0 to 30000",
      );
      expect(result.request).toBeUndefined();
    }
    for (const settleMs of ["fast", 30001]) {
      const config = await runCli(["click", "e5"], { surfJson: { settleMs } });
      expect(config.code).toBe(1);
      expect(config.stderr).toMatch(
        /settleMs in .*surf\.json must be a whole number of milliseconds from 0 to 30000/,
      );
      expect(config.request).toBeUndefined();
    }
  });

  it("prints changes between the action output and the screenshot line", async () => {
    const result = await runCli(["click", "e5"], { reply: { pageChanges } });
    expect(result.stdout).toBe(
      'OK\nchanged (settled in 340ms):\n  ~ e5 checkbox "Agree"  now checked\nScreenshot (pending): /tmp/pi-auto-1.png\n',
    );
    const plain = await runCli(["click", "e5"]);
    expect(plain.stdout).toBe("OK\nScreenshot (pending): /tmp/pi-auto-1.png\n");
  });

  it("passes pageChanges through under --json", async () => {
    const result = await runCli(["click", "e5", "--json"], { reply: { pageChanges } });
    expect(JSON.parse(result.stdout)).toEqual({
      result: "OK\nScreenshot (pending): /tmp/pi-auto-1.png",
      target: null,
      notice: null,
      pageChanges,
    });
  });
});
