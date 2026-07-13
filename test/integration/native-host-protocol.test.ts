import { afterEach, describe, expect, it } from "vitest";

declare const Buffer: {
  alloc(size: number): BufferLike;
  byteLength(value: string): number;
  concat(values: BufferLike[]): BufferLike;
  from(values: number[] | string): BufferLike;
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
  indexOf(value: number): number;
  slice(start: number, end?: number): BufferLike;
  subarray(start: number, end?: number): BufferLike;
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
  writeFileSync(targetPath: string, content: string): void;
};
const os = require("node:os") as { tmpdir(): string };
const path = require("node:path") as { join(...paths: string[]): string };
const net = require("node:net") as any;
const { createListenerLifecycle, MAX_CLIENT_FRAME_BYTES } = require("../../native/host.cjs") as any;

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

async function startHostHarness(env: Record<string, string | undefined> = {}, tcpPort?: number): Promise<HostHarness> {
  const socketPath = createSocketPath();
  const hostPath = path.join(process.cwd(), "native", "host.cjs");
  const preloadedListener = tcpPort === undefined ? undefined : (() => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "surf-host-listener-preload-"));
    tempDirs.push(tempDir);
    const preloadPath = path.join(tempDir, "listener-preload.cjs");
    const listenerPath = path.join(process.cwd(), "native", "listener.cjs");
    fs.writeFileSync(preloadPath, `const listener = require(${JSON.stringify(listenerPath)}); listener.parseListenEndpoint = () => ({ host: "127.0.0.1", port: ${tcpPort}, display: "127.0.0.1:${tcpPort}" });`);
    return preloadPath;
  })();
  const child = spawn(process.execPath, [hostPath], {
    cwd: process.cwd(),
    // Do not accidentally expose a developer's Tailnet listener to these
    // local protocol tests. Callers must opt in explicitly.
    env: {
      ...process.env,
      SURF_SOCKET: socketPath,
      SURF_LISTEN: tcpPort === undefined ? undefined : `100.64.1.1:${tcpPort}`,
      NODE_OPTIONS: preloadedListener ? `${process.env.NODE_OPTIONS || ""} --require ${preloadedListener}`.trim() : process.env.NODE_OPTIONS,
      ...env,
    },
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
  it("starts local and TCP listeners together, forwards both, and only then reports ready", async () => {
    const localPath = createSocketPath();
    const received: string[] = [];
    let ready = false;
    const lifecycle = createListenerLifecycle({
      localPath,
      tcpEndpoint: { host: "127.0.0.1", port: 0 },
      handler(socket: any) {
        socket.on("data", (data: any) => {
          received.push(data.toString("utf8"));
          socket.write('{"type":"tool_response","error":"Unknown method: unknown"}\n');
        });
      },
      onReady() { ready = true; },
      onFatal(error: Error) { throw error; },
    });
    expect(await lifecycle.start()).toBe(true);
    expect(ready).toBe(true);
    const tcpAddress = lifecycle.tcpServer.address();
    expect(tcpAddress.port).toBeGreaterThan(0);

    const request = '{"type":"tool_request","method":"unknown","id":"shared"}\n';
    const requestReply = async (socket: any) => await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for listener reply")), 1000);
      socket.once("data", (data: any) => { clearTimeout(timeout); resolve(data.toString("utf8")); });
    });
    const local = net.createConnection(localPath);
    await new Promise<void>((resolve) => local.once("connect", resolve));
    const localReply = requestReply(local); local.write(request);
    expect(await localReply).toContain("Unknown method: unknown");
    const tcp = net.createConnection({ host: "127.0.0.1", port: tcpAddress.port });
    await new Promise<void>((resolve) => tcp.once("connect", resolve));
    const tcpReply = requestReply(tcp); tcp.write(request);
    expect(await tcpReply).toContain("Unknown method: unknown");
    expect(received).toEqual([request, request]);
    local.end(); tcp.end();
    await lifecycle.shutdown();
    expect(fs.existsSync(localPath)).toBe(false);
  });

  it("cleans up local listener when the TCP bind conflicts", async () => {
    const localPath = createSocketPath();
    const blocker = net.createServer();
    await new Promise<void>((resolve) => blocker.listen({ host: "127.0.0.1", port: 0 }, resolve));
    const address = blocker.address();
    let ready = false;
    let fatal: Error | undefined;
    const lifecycle = createListenerLifecycle({
      localPath, tcpEndpoint: { host: "127.0.0.1", port: address.port }, handler() {},
      onReady() { ready = true; }, onFatal(error: Error) { fatal = error; },
    });
    expect(await lifecycle.start()).toBe(false);
    expect(ready).toBe(false);
    expect(fatal).toBeInstanceOf(Error);
    expect(fs.existsSync(localPath)).toBe(false);
    await new Promise<void>((resolve) => blocker.close(resolve));
  });

  it("closes both listeners and unlinks local socket during shutdown", async () => {
    const localPath = createSocketPath();
    const lifecycle = createListenerLifecycle({
      localPath, tcpEndpoint: { host: "127.0.0.1", port: 0 }, handler() {}, onReady() {}, onFatal(error: Error) { throw error; },
    });
    await lifecycle.start();
    const address = lifecycle.tcpServer.address();
    await lifecycle.shutdown();
    expect(fs.existsSync(localPath)).toBe(false);
    await new Promise<void>((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port: address.port });
      socket.once("error", () => resolve());
    });
  });

  it("uses the production TCP handler for a UTF-8 code point split across writes", async () => {
    const reservation = net.createServer();
    await new Promise<void>((resolve) => reservation.listen({ host: "127.0.0.1", port: 0 }, resolve));
    const tcpPort = reservation.address().port;
    await new Promise<void>((resolve) => reservation.close(resolve));
    const host = await startHostHarness({}, tcpPort);
    const socket = net.createConnection({ host: "127.0.0.1", port: tcpPort });
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    const response = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for production TCP response")), 1000);
      socket.once("data", (chunk: any) => { clearTimeout(timeout); resolve(chunk.toString("utf8")); });
    });
    const beforeCheckmark = '{"type":"tool_request","method":"unknown","id":"';
    const frame = Buffer.from(`${beforeCheckmark}✓"}\n`);
    const checkmarkByteIndex = Buffer.byteLength(beforeCheckmark);
    // ✓ is three UTF-8 bytes; write its first byte separately from the rest.
    socket.write(frame.slice(0, checkmarkByteIndex + 1));
    socket.write(frame.slice(checkmarkByteIndex + 1));
    expect(await response).toContain("Unknown method: unknown");
    socket.end();
  });
  it("handles fragmented and multiple local frames, while rejecting malformed UTF-8 and oversized frames", async () => {
    const host = await startHostHarness();
    const socket = net.createConnection(host.socketPath);
    await new Promise<void>((resolve) => socket.once("connect", resolve));

    const readResponse = (client: any) => new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for socket response")), 1000);
      client.once("data", (chunk: any) => {
        clearTimeout(timeout);
        resolve(chunk.toString("utf8"));
      });
    });

    // One request split across writes, followed by a second complete frame.
    const firstResponse = readResponse(socket);
    socket.write('{"type":"tool_request","method":"unknown","id":"first"');
    socket.write("}\n");
    expect(await firstResponse).toContain("Unknown method: unknown");
    const secondResponse = readResponse(socket);
    socket.write('{"type":"tool_request","method":"unknown","id":"second"}\n');
    expect(await secondResponse).toContain("Unknown method: unknown");

    const rejectedResponse = readResponse(socket);
    socket.write('{"type":"GET_AUTH","id":"auth"}\n');
    expect(await rejectedResponse).toContain("Unsupported request type: GET_AUTH");

    const rejectedStream = readResponse(socket);
    socket.write('{"type":"stream_request","streamType":"ARBITRARY_EXTENSION_MESSAGE","id":"stream"}\n');
    expect(await rejectedStream).toContain("Unsupported stream type: ARBITRARY_EXTENSION_MESSAGE");

    const unicodeResponse = readResponse(socket);
    const unicodeFrame = Buffer.from('{"type":"tool_request","method":"unknown","id":"✓"}\n');
    // Deliberately split inside the three-byte UTF-8 encoding of ✓.
    socket.write(unicodeFrame.slice(0, unicodeFrame.length - 3));
    socket.write(unicodeFrame.slice(unicodeFrame.length - 3));
    expect(await unicodeResponse).toContain("Unknown method: unknown");

    const malformed = net.createConnection(host.socketPath);
    await new Promise<void>((resolve) => malformed.once("connect", resolve));
    const malformedClosed = new Promise<void>((resolve) => malformed.once("close", resolve));
    malformed.write(Buffer.from([0xc3, 0x0a])); // incomplete UTF-8 before frame delimiter
    await malformedClosed;

    const exact = net.createConnection(host.socketPath);
    await new Promise<void>((resolve) => exact.once("connect", resolve));
    const exactResponse = readResponse(exact);
    const prefix = '{"type":"tool_request","method":"unknown","id":"exact","padding":"';
    const frame = `${prefix}${"x".repeat(1024 * 1024 - Buffer.byteLength(prefix) - 2)}"}`;
    expect(Buffer.byteLength(frame)).toBe(1024 * 1024);
    exact.write(`${frame}\n`);
    expect(await exactResponse).toContain("Unknown method: unknown");
    exact.end();

    const oversized = net.createConnection(host.socketPath);
    await new Promise<void>((resolve) => oversized.once("connect", resolve));
    const oversizedClosed = new Promise<void>((resolve) => oversized.once("close", resolve));
    oversized.write(`${"x".repeat(1024 * 1024 + 1)}\n`);
    await oversizedClosed;
    socket.end();
  });

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
