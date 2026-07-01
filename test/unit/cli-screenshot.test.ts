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

function socketPathForTest() {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\surf-cli-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "surf-cli-test-"));
  tempPaths.push(dir);
  return path.join(dir, "surf.sock");
}

async function captureCliRequest(args: string[]) {
  const socketPath = socketPathForTest();
  const cliPath = path.join(process.cwd(), "native", "cli.cjs");

  let capturedRequest: any;
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
        capturedRequest = JSON.parse(line);
        socket.write(
          `${JSON.stringify({
            id: capturedRequest.id,
            result: {
              content: [{ type: "text", text: JSON.stringify({ message: "ok" }) }],
            },
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
        cwd: process.cwd(),
        env: { ...process.env, SURF_SOCKET: socketPath },
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

  if (result.code !== 0 || result.stderr !== "") {
    throw new Error(`CLI failed with code ${result.code}: ${result.stderr}`);
  }
  if (!capturedRequest) {
    throw new Error("CLI did not send a request");
  }
  return capturedRequest;
}

afterEach(() => {
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

describe("screenshot CLI parsing", () => {
  it("treats --full-page with a path like fullpage screenshot output", async () => {
    const request = await captureCliRequest(["screenshot", "--full-page", "/tmp/full.png"]);

    expect(request.params.tool).toBe("screenshot");
    expect(request.params.args.fullpage).toBe(true);
    expect(request.params.args.savePath).toBe("/tmp/full.png");
    expect(request.params.args["full-page"]).toBeUndefined();
  });

  it("treats --full-page --output like fullpage screenshot output", async () => {
    const request = await captureCliRequest([
      "screenshot",
      "--full-page",
      "--output",
      "/tmp/full.png",
    ]);

    expect(request.params.tool).toBe("screenshot");
    expect(request.params.args.fullpage).toBe(true);
    expect(request.params.args.savePath).toBe("/tmp/full.png");
    expect(request.params.args["full-page"]).toBeUndefined();
  });

  it("preserves --fullpage auto-save behavior", async () => {
    const request = await captureCliRequest(["screenshot", "--fullpage"]);

    expect(request.params.args.fullpage).toBe(true);
    expect(request.params.args.savePath).toMatch(/^\/tmp\/surf-snap-\d+\.png$/);
  });
});
