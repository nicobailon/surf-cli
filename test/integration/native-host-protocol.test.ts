import { afterEach, describe, expect, it } from "vitest";

declare const Buffer: {
  alloc(size: number): BufferLike;
  byteLength(value: string): number;
  concat(values: BufferLike[]): BufferLike;
};
declare const process: {
  cwd(): string;
  env: Record<string, string | undefined>;
  execPath: string;
  pid: number;
  platform: string;
};
declare const require: (moduleName: string) => unknown;

type BufferLike = {
  length: number;
  readUInt32LE(offset: number): number;
  slice(start: number, end?: number): BufferLike;
  toString(encoding?: string): string;
  write(value: string, offset?: number): number;
  writeUInt32LE(value: number, offset: number): number;
};

type NativeMessage = Record<string, unknown> & {
  error?: string;
  id?: number | string;
  type?: string;
};

type CliResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

type EventEmitterLike = {
  on(event: string, listener: (...args: unknown[]) => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
};

type WritableLike = {
  end(): void;
  write(data: BufferLike): void;
};

type ChildProcessLike = EventEmitterLike & {
  killed: boolean;
  pid?: number;
  stdin: WritableLike;
  stdout: EventEmitterLike;
  stderr: EventEmitterLike;
  kill(signal: string): void;
};

const { spawn } = require("node:child_process") as {
  spawn: (command: string, args: string[], options: Record<string, unknown>) => ChildProcessLike;
};
const fs = require("node:fs") as {
  existsSync(targetPath: string): boolean;
  mkdtempSync(prefix: string): string;
  rmSync(targetPath: string, options: { recursive: boolean; force: boolean }): void;
};
const os = require("node:os") as { tmpdir(): string };
const path = require("node:path") as { join(...paths: string[]): string };

const tempDirs: string[] = [];
const children: ChildProcessLike[] = [];
const closedChildren = new WeakSet<ChildProcessLike>();

function createSocketPath() {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\surf-host-integration-${process.pid}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "surf-host-integration-"));
  tempDirs.push(tempDir);
  return path.join(tempDir, "surf.sock");
}

function encodeNativeMessage(message: NativeMessage) {
  const json = JSON.stringify(message);
  const frame = Buffer.alloc(4 + Buffer.byteLength(json));
  frame.writeUInt32LE(Buffer.byteLength(json), 0);
  frame.write(json, 4);
  return frame;
}

function parseNativeFrames(
  currentBuffer: BufferLike,
  chunk: BufferLike,
): { buffer: BufferLike; messages: NativeMessage[] } {
  let buffer = Buffer.concat([currentBuffer, chunk]);
  const messages: NativeMessage[] = [];

  while (buffer.length >= 4) {
    const messageLength = buffer.readUInt32LE(0);
    if (buffer.length < 4 + messageLength) {
      break;
    }

    const messageJson = buffer.slice(4, 4 + messageLength).toString("utf8");
    messages.push(JSON.parse(messageJson) as NativeMessage);
    buffer = buffer.slice(4 + messageLength);
  }

  return { buffer, messages };
}

async function waitForExit(child: ChildProcessLike, timeoutMs = 1000) {
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    child.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function cleanupChild(child: ChildProcessLike) {
  if (child.killed || closedChildren.has(child)) {
    return;
  }

  child.kill("SIGTERM");
  await waitForExit(child);
  if (!child.killed) {
    child.kill("SIGKILL");
    await waitForExit(child);
  }
}

async function runCli(args: string[], socketPath: string): Promise<CliResult> {
  const cliPath = path.join(process.cwd(), "native", "cli.cjs");

  return await new Promise<CliResult>((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, SURF_SOCKET: socketPath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);

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
      closedChildren.add(child);
      clearTimeout(timeout);
      resolve({ code: typeof code === "number" ? code : null, stdout, stderr });
    });
  });
}

type HostHarness = {
  child: ChildProcessLike;
  send(message: NativeMessage): void;
  socketPath: string;
  stderr(): string;
  waitForMessage(
    predicate: (message: NativeMessage) => boolean,
    label: string,
  ): Promise<NativeMessage>;
};

async function startHostHarness(): Promise<HostHarness> {
  const socketPath = createSocketPath();
  const hostPath = path.join(process.cwd(), "native", "host.cjs");
  const child = spawn(process.execPath, [hostPath], {
    cwd: process.cwd(),
    env: { ...process.env, SURF_SOCKET: socketPath },
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.push(child);

  let stdoutBuffer = Buffer.alloc(0);
  let stderr = "";
  const messages: NativeMessage[] = [];
  const waiters: Array<{
    label: string;
    predicate: (message: NativeMessage) => boolean;
    resolve: (message: NativeMessage) => void;
  }> = [];

  const publish = (message: NativeMessage) => {
    const waiterIndex = waiters.findIndex((queuedWaiter) => queuedWaiter.predicate(message));
    if (waiterIndex === -1) {
      messages.push(message);
      return;
    }

    const matchedWaiter = waiters.splice(waiterIndex, 1)[0];
    matchedWaiter.resolve(message);
  };

  child.stdout.on("data", (chunk) => {
    const parsed = parseNativeFrames(stdoutBuffer, chunk as BufferLike);
    stdoutBuffer = parsed.buffer;
    for (const message of parsed.messages) {
      publish(message);
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const waitForMessage = async (
    predicate: (message: NativeMessage) => boolean,
    label: string,
  ): Promise<NativeMessage> => {
    const queuedIndex = messages.findIndex(predicate);
    if (queuedIndex !== -1) {
      const queuedMessage = messages.splice(queuedIndex, 1)[0];
      return queuedMessage;
    }

    return await new Promise<NativeMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for native host message: ${label}. stderr: ${stderr}`));
      }, 5000);
      waiters.push({
        label,
        predicate,
        resolve: (message) => {
          clearTimeout(timeout);
          resolve(message);
        },
      });
    });
  };

  child.on("error", (error) => {
    throw error instanceof Error ? error : new Error(String(error));
  });
  child.on("close", () => {
    closedChildren.add(child);
  });

  await waitForMessage((message) => message.type === "HOST_READY", "HOST_READY");
  if (!fs.existsSync(socketPath)) {
    throw new Error(`Native host did not create socket: ${socketPath}`);
  }

  return {
    child,
    send(message) {
      child.stdin.write(encodeNativeMessage(message));
    },
    socketPath,
    stderr() {
      return stderr;
    },
    waitForMessage,
  };
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    await cleanupChild(child);
  }

  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("native host protocol integration", () => {
  it("forwards a real CLI request to the extension and returns the extension response", async () => {
    const host = await startHostHarness();
    const cliPromise = runCli(["tab.list"], host.socketPath);

    const extensionRequest = await host.waitForMessage(
      (message) => message.type === "LIST_TABS",
      "LIST_TABS",
    );
    expect(extensionRequest).toMatchObject({ type: "LIST_TABS" });
    expect(typeof extensionRequest.id).toBe("number");

    host.send({
      id: extensionRequest.id,
      tabs: [{ id: 123, title: "Example", url: "https://example.test/" }],
    });

    const result = await cliPromise;
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("123\tExample\thttps://example.test/\n");
    expect(host.stderr()).toBe("");
  });

  it("propagates extension errors through the native host to CLI stderr", async () => {
    const host = await startHostHarness();
    const cliPromise = runCli(["tab.list"], host.socketPath);

    const extensionRequest = await host.waitForMessage(
      (message) => message.type === "LIST_TABS",
      "LIST_TABS",
    );
    host.send({ id: extensionRequest.id, error: "extension exploded" });

    const result = await cliPromise;
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Error: extension exploded");
    expect(host.stderr()).toBe("");
  });
});
