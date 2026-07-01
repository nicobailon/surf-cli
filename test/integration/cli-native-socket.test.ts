import { afterEach, describe, expect, it } from "vitest";

declare const process: {
  cwd(): string;
  env: Record<string, string | undefined>;
  execPath: string;
  kill(pid: number, signal?: string): void;
  pid: number;
  platform: string;
};
declare const require: (moduleName: string) => unknown;

type CliRequest = {
  id: string;
  type: string;
  method: string;
  params: {
    tool: string;
    args: Record<string, unknown>;
  };
  tabId?: number;
  windowId?: number;
};

type HostResponse = {
  id: string;
  result?: {
    content: Array<{ type: string; text: string }>;
  };
  error?: {
    content: Array<{ type: string; text: string }>;
  };
};

type EventEmitterLike = {
  on(event: string, listener: (...args: unknown[]) => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
};

type ChildProcessLike = EventEmitterLike & {
  stdout: EventEmitterLike;
  stderr: EventEmitterLike;
  kill(signal: string): void;
};

type SocketLike = EventEmitterLike & {
  destroy(): void;
  end(): void;
  write(data: string): void;
};

type ServerLike = EventEmitterLike & {
  close(callback: (error?: Error) => void): void;
  listen(socketPath: string, callback: () => void): void;
  listening: boolean;
};

const { spawn } = require("node:child_process") as {
  spawn: (command: string, args: string[], options: Record<string, unknown>) => ChildProcessLike;
};
const fs = require("node:fs") as {
  mkdtempSync(prefix: string): string;
  rmSync(targetPath: string, options: { recursive: boolean; force: boolean }): void;
};
const net = require("node:net") as {
  createServer(connectionListener: (socket: SocketLike) => void): ServerLike;
};
const os = require("node:os") as { tmpdir(): string };
const path = require("node:path") as { join(...paths: string[]): string };

const tempDirs: string[] = [];

function createSocketPath() {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\surf-cli-integration-${process.pid}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "surf-cli-integration-"));
  tempDirs.push(tempDir);
  return path.join(tempDir, "surf.sock");
}

function responseWithText(request: CliRequest, text: string): HostResponse {
  return {
    id: request.id,
    result: {
      content: [{ type: "text", text }],
    },
  };
}

async function closeServer(server: ServerLike) {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error: Error | undefined) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function runCliWithFakeHost(
  args: string[],
  createResponse: (request: CliRequest) => HostResponse,
): Promise<{
  code: number | null;
  request: CliRequest;
  rawRequest: string;
  stdout: string;
  stderr: string;
}> {
  const socketPath = createSocketPath();
  const cliPath = path.join(process.cwd(), "native", "cli.cjs");
  const sockets: SocketLike[] = [];
  let request: CliRequest | undefined;
  let rawRequest = "";

  const server = net.createServer((socket: SocketLike) => {
    sockets.push(socket);
    let buffer = "";

    socket.on("data", (chunk) => {
      const text = String(chunk);
      buffer += text;
      rawRequest += text;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        request = JSON.parse(line) as CliRequest;
        socket.write(`${JSON.stringify(createResponse(request))}\n`);
        socket.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });

  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [cliPath, ...args], {
        cwd: process.cwd(),
        env: { ...process.env, SURF_SOCKET: socketPath },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`CLI timed out: ${args.join(" ")}`));
      }, 5000);

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        resolve({ code: typeof code === "number" ? code : null, stdout, stderr });
      });
    },
  );

  for (const socket of sockets) {
    socket.destroy();
  }
  await closeServer(server);

  if (!request) {
    throw new Error(`CLI did not send a request. stderr: ${result.stderr}`);
  }

  return { ...result, request, rawRequest };
}

async function runCliWithMissingSocket(args: string[]) {
  const socketPath = createSocketPath();
  const cliPath = path.join(process.cwd(), "native", "cli.cjs");

  return await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, SURF_SOCKET: socketPath },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) =>
      resolve({ code: typeof code === "number" ? code : null, stdout, stderr }),
    );
  });
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("CLI native socket integration", () => {
  it("sends newline-framed tab.list requests and renders successful tab responses", async () => {
    const result = await runCliWithFakeHost(["tab.list"], (request) =>
      responseWithText(
        request,
        JSON.stringify({
          tabs: [{ id: 123, title: "Example", url: "https://example.test/" }],
        }),
      ),
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("123\tExample\thttps://example.test/\n");
    expect(result.rawRequest).toContain("\n");
    expect(JSON.parse(result.rawRequest.trim())).toEqual(result.request);
    expect(result.request).toMatchObject({
      type: "tool_request",
      method: "execute_tool",
      params: { tool: "tab.list", args: {} },
    });
    expect(result.request.id).toMatch(/^cli-/);
  });

  it("sends command args and global options over SURF_SOCKET", async () => {
    const result = await runCliWithFakeHost(
      ["go", "https://example.test/path", "--window-id", "77", "--no-screenshot"],
      (request) => responseWithText(request, JSON.stringify({ success: true })),
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("OK\n");
    expect(result.stderr).toBe("");
    expect(result.request).toMatchObject({
      type: "tool_request",
      method: "execute_tool",
      windowId: 77,
      params: {
        tool: "navigate",
        args: { url: "https://example.test/path" },
      },
    });
  });

  it("propagates native host errors to stderr and exits non-zero", async () => {
    const result = await runCliWithFakeHost(["tab.list"], (request) => ({
      id: request.id,
      error: {
        content: [{ type: "text", text: "native host exploded" }],
      },
    }));

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Error: native host exploded");
    expect(result.request.params.tool).toBe("tab.list");
  });

  it("prints socket diagnostics when SURF_SOCKET points at a missing socket", async () => {
    const result = await runCliWithMissingSocket(["tab.list"]);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Socket connect failed: Socket not found.");
    expect(result.stderr).toContain("Attempted socket:");
    expect(result.stderr).toContain(
      "SURF_SOCKET is set; make sure the native host and CLI use the same value.",
    );
    expect(result.stderr).not.toContain("/tmp/surf.sock");
  });
});
