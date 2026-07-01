declare const process: {
  cwd(): string;
  env: Record<string, string | undefined>;
  execPath: string;
  pid: number;
  platform: string;
};
declare const require: (moduleName: string) => any;

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

function createSocketPath() {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\surf-test-${process.pid}-${Date.now()}-${Math.random()}`;
  }

  return path.join(os.tmpdir(), `surf-test-${process.pid}-${Date.now()}-${Math.random()}.sock`);
}

function cleanupSocket(socketPath: string) {
  if (process.platform === "win32") {
    return;
  }

  try {
    fs.unlinkSync(socketPath);
  } catch {
    // The socket may already be gone after the server closes.
  }
}

function runCli(args: string[]): Promise<{ request: any; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const socketPath = createSocketPath();
    cleanupSocket(socketPath);

    let stdout = "";
    let stderr = "";
    let request: any;

    const server = net.createServer((socket: any) => {
      let buffer = "";
      socket.on("data", (chunk: { toString(): string }) => {
        buffer += chunk.toString();
        const lineEnd = buffer.indexOf("\n");
        if (lineEnd === -1) {
          return;
        }

        request = JSON.parse(buffer.slice(0, lineEnd));
        socket.write(
          `${JSON.stringify({ result: { content: [{ type: "text", text: "OK" }] } })}\n`,
        );
        socket.end();
      });
    });

    server.on("error", reject);
    server.listen(socketPath, () => {
      const child = spawn(process.execPath, ["native/cli.cjs", ...args], {
        cwd: process.cwd(),
        env: { ...process.env, SURF_SOCKET: socketPath },
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout.on("data", (chunk: { toString(): string }) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: { toString(): string }) => {
        stderr += chunk.toString();
      });
      child.on("error", (error: Error) => {
        server.close();
        reject(error);
      });
      child.on("close", (code: number) => {
        server.close(() => {
          cleanupSocket(socketPath);

          if (code !== 0) {
            reject(new Error(`CLI exited ${code}: ${stderr}`));
            return;
          }

          resolve({ request, stdout, stderr });
        });
      });
    });
  });
}

describe("CLI argument parsing", () => {
  it("maps resize positional width and height", async () => {
    const { request } = await runCli(["resize", "375", "812"]);

    expect(request.params.tool).toBe("resize");
    expect(request.params.args).toMatchObject({ width: 375, height: 812 });
  });

  it("maps resize single positional argument to width only", async () => {
    const { request } = await runCli(["resize", "375"]);

    expect(request.params.tool).toBe("resize");
    expect(request.params.args.width).toBe(375);
    expect(request.params.args).not.toHaveProperty("height");
  });

  it("preserves resize width and height flags", async () => {
    const { request } = await runCli(["resize", "--width", "375", "--height", "812"]);

    expect(request.params.tool).toBe("resize");
    expect(request.params.args).toMatchObject({ width: 375, height: 812 });
  });

  it("does not map emulate.viewport positional values to width and height", async () => {
    const { request } = await runCli(["emulate.viewport", "375", "812"]);

    expect(request.params.tool).toBe("emulate.viewport");
    expect(request.params.args).not.toHaveProperty("width");
    expect(request.params.args).not.toHaveProperty("height");
  });
});
