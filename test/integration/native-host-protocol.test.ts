// biome-ignore-all lint/suspicious/noExplicitAny: runtime CJS doubles are intentionally untyped.
import { afterEach, describe, expect, it } from "vitest";

// Native protocol CJS doubles intentionally use runtime-shaped values because this project does not include Node typings.

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
  readdirSync(targetPath: string): string[];
  writeFileSync(targetPath: string, content: string): void;
  readFileSync(targetPath: string, encoding: string): string;
};
const os = require("node:os") as { tmpdir(): string };
const path = require("node:path") as { join(...paths: string[]): string };
const net = require("node:net") as any;
const { createListenerLifecycle } = require("../../native/host.cjs") as any;
const remoteAuth = require("../../native/remote-auth.cjs") as any;
const remoteTransport = require("../../native/remote-transport.cjs") as any;
const { openClientTransport } = require("../../native/client-transport.cjs") as any;
const fileTransfer = require("../../native/file-transfer.cjs") as any;
const crypto = require("node:crypto") as any;

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
  remoteCredentialPath?: string;
  remoteStateDir?: string;
  stderr(): string;
  waitForMessage(
    predicate: (message: NativeMessage) => boolean,
    label: string,
  ): Promise<NativeMessage>;
  expectNoMessage(
    predicate: (message: NativeMessage) => boolean,
    label: string,
    timeoutMs?: number,
  ): Promise<void>;
};

async function startHostHarness(
  env: Record<string, string | undefined> = {},
  tcpPort?: number,
): Promise<HostHarness> {
  const socketPath = createSocketPath();
  const remoteStateDir =
    tcpPort === undefined
      ? undefined
      : fs.mkdtempSync(path.join(os.tmpdir(), "surf-host-remote-state-"));
  const remoteCredentialPath =
    remoteStateDir === undefined ? undefined : path.join(remoteStateDir, "client.json");
  if (remoteStateDir && remoteCredentialPath) {
    tempDirs.push(remoteStateDir);
    remoteAuth.authorizeClient("integration-client", remoteCredentialPath, remoteStateDir);
  }
  const hostPath = path.join(process.cwd(), "native", "host.cjs");
  const preloadedListener =
    tcpPort === undefined
      ? undefined
      : (() => {
          const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "surf-host-listener-preload-"));
          tempDirs.push(tempDir);
          const preloadPath = path.join(tempDir, "listener-preload.cjs");
          const listenerPath = path.join(process.cwd(), "native", "listener.cjs");
          fs.writeFileSync(
            preloadPath,
            `const listener = require(${JSON.stringify(listenerPath)}); listener.parseListenEndpoint = () => ({ host: "127.0.0.1", port: ${tcpPort}, display: "127.0.0.1:${tcpPort}" });`,
          );
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
      SURF_REMOTE_STATE_DIR: remoteStateDir,
      NODE_OPTIONS: preloadedListener
        ? `${process.env.NODE_OPTIONS || ""} --require ${preloadedListener}`.trim()
        : process.env.NODE_OPTIONS,
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

  const expectNoMessage = async (
    predicate: (message: NativeMessage) => boolean,
    label: string,
    timeoutMs = 50,
  ): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));
    const unexpectedIndex = messages.findIndex(predicate);
    if (unexpectedIndex !== -1) {
      const unexpected = messages.splice(unexpectedIndex, 1)[0];
      throw new Error(`Unexpected native host message for ${label}: ${JSON.stringify(unexpected)}`);
    }
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
    remoteCredentialPath,
    remoteStateDir,
    send(message) {
      child.stdin.write(encodeNativeMessage(message));
    },
    socketPath,
    stderr() {
      return stderr;
    },
    waitForMessage,
    expectNoMessage,
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
      onReady() {
        ready = true;
      },
      onFatal(error: Error) {
        throw error;
      },
    });
    expect(await lifecycle.start()).toBe(true);
    expect(ready).toBe(true);
    const tcpAddress = lifecycle.tcpServer.address();
    expect(tcpAddress.port).toBeGreaterThan(0);

    const request = '{"type":"tool_request","method":"unknown","id":"shared"}\n';
    const requestReply = async (socket: any) =>
      await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Timed out waiting for listener reply")),
          1000,
        );
        socket.once("data", (data: any) => {
          clearTimeout(timeout);
          resolve(data.toString("utf8"));
        });
      });
    const local = net.createConnection(localPath);
    await new Promise<void>((resolve) => local.once("connect", resolve));
    const localReply = requestReply(local);
    local.write(request);
    expect(await localReply).toContain("Unknown method: unknown");
    const tcp = net.createConnection({ host: "127.0.0.1", port: tcpAddress.port });
    await new Promise<void>((resolve) => tcp.once("connect", resolve));
    const tcpReply = requestReply(tcp);
    tcp.write(request);
    expect(await tcpReply).toContain("Unknown method: unknown");
    expect(received).toEqual([request, request]);
    local.end();
    tcp.end();
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
      localPath,
      tcpEndpoint: { host: "127.0.0.1", port: address.port },
      handler() {
        return undefined;
      },
      onReady() {
        ready = true;
      },
      onFatal(error: Error) {
        fatal = error;
      },
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
      localPath,
      tcpEndpoint: { host: "127.0.0.1", port: 0 },
      handler() {
        return undefined;
      },
      onReady() {
        return undefined;
      },
      onFatal(error: Error) {
        throw error;
      },
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
    await new Promise<void>((resolve) =>
      reservation.listen({ host: "127.0.0.1", port: 0 }, resolve),
    );
    const tcpPort = reservation.address().port;
    await new Promise<void>((resolve) => reservation.close(resolve));
    const host = await startHostHarness({}, tcpPort);
    const socket = net.createConnection({ host: "127.0.0.1", port: tcpPort });
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    await remoteTransport.authenticateClient(socket, host.remoteCredentialPath);
    const response = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for production TCP response")),
        1000,
      );
      socket.once("data", (chunk: any) => {
        clearTimeout(timeout);
        resolve(chunk.toString("utf8"));
      });
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

    const readResponse = (client: any) =>
      new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Timed out waiting for socket response")),
          1000,
        );
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
    socket.write(
      '{"type":"stream_request","streamType":"ARBITRARY_EXTENSION_MESSAGE","id":"stream"}\n',
    );
    expect(await rejectedStream).toContain("Unsupported stream type: ARBITRARY_EXTENSION_MESSAGE");

    const unicodeResponse = readResponse(socket);
    const unicodeFrame = Buffer.from('{"type":"tool_request","method":"unknown","id":"✓"}\n');
    // Deliberately split inside the three-byte UTF-8 encoding of ✓.
    socket.write(unicodeFrame.slice(0, unicodeFrame.length - 3));
    socket.write(unicodeFrame.slice(unicodeFrame.length - 3));
    expect(await unicodeResponse).toContain("Unknown method: unknown");
    socket.end();

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

  it("stages authenticated remote uploads before fake extension dispatch", async () => {
    const reservation = net.createServer();
    await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const tcpPort = reservation.address().port;
    await new Promise<void>((resolve) => reservation.close(resolve));
    const host = await startHostHarness({}, tcpPort);
    const socket = net.createConnection({ host: "127.0.0.1", port: tcpPort });
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    await remoteTransport.authenticateClient(socket, host.remoteCredentialPath);
    const _buffer = Buffer.alloc(0);
    const messages: NativeMessage[] = [];
    const waiters: Array<{
      predicate: (message: NativeMessage) => boolean;
      resolve: (message: NativeMessage) => void;
    }> = [];
    const publish = (message: NativeMessage) => {
      const index = waiters.findIndex((waiter) => waiter.predicate(message));
      if (index === -1) {
        messages.push(message);
      } else {
        waiters.splice(index, 1)[0].resolve(message);
      }
    };
    const parser = remoteTransport.createFrameParser({
      onFrame: publish,
      onError: () => undefined,
    });
    socket.on("data", (chunk: any) => parser.push(chunk));
    const waitRemote = async (predicate: (message: NativeMessage) => boolean) => {
      const queued = messages.findIndex(predicate);
      if (queued !== -1) {
        return Promise.resolve(messages.splice(queued, 1)[0]);
      }
      return new Promise<NativeMessage>((resolve) => waiters.push({ predicate, resolve }));
    };
    const data = Buffer.from("abc");
    const transferId = "upload-integration";
    const sha256 = crypto.createHash("sha256").update(data).digest("hex");
    remoteTransport.writeFrame(socket, {
      type: "transfer_begin",
      version: 1,
      direction: "upload",
      transferId,
      size: data.length,
      sha256,
    });
    await waitRemote((message) => message.type === "transfer_ready");
    remoteTransport.writeFrame(socket, {
      type: "transfer_chunk",
      version: 1,
      transferId,
      sequence: 0,
      data: data.toString("base64"),
    });
    remoteTransport.writeFrame(socket, { type: "transfer_end", version: 1, transferId });
    const transferComplete = await waitRemote((message) => message.type === "transfer_complete");
    expect(transferComplete.path).toBeUndefined();
    remoteTransport.writeFrame(socket, {
      type: "tool_request",
      method: "execute_tool",
      params: { tool: "upload", args: { ref: "e5", files: ["client.txt"] } },
      _surfPaths: [
        {
          field: "files",
          kind: "input",
          original: "client.txt",
          path: "client.txt",
          pathKind: "local",
        },
      ],
      _surfTransfers: {
        uploads: [{ transferId, field: "files", original: "client.txt", kind: "upload" }],
        downloads: [],
      },
      id: "upload-integration-request",
    });
    const extensionRequest = await host.waitForMessage(
      (message) => message.type === "UPLOAD_FILE",
      "remote UPLOAD_FILE",
    );
    const extensionFiles = extensionRequest.files as string[];
    expect(extensionFiles).toHaveLength(1);
    expect(extensionFiles[0]).not.toBe("client.txt");
    expect(extensionFiles[0]).toMatch(host.remoteCredentialPath ? /[A-Za-z0-9]/ : /never/);
    const stagedPath = extensionFiles[0];
    host.send({
      id: extensionRequest.id,
      success: true,
      path: stagedPath,
      message: `stored ${stagedPath}`,
      nested: [stagedPath],
    });
    const response = await waitRemote((message) => message.id === "upload-integration-request");
    expect(response.error).toBeUndefined();
    const responseText = JSON.stringify(response);
    expect(responseText).toContain("client.txt");
    expect(responseText).not.toContain("surf-transfer-");
    expect(responseText).not.toContain(stagedPath);
    socket.destroy();
  });

  it("dispatches direct remote upload and screenshot paths without staging", async () => {
    const reservation = net.createServer();
    await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const tcpPort = reservation.address().port;
    await new Promise<void>((resolve) => reservation.close(resolve));
    const transferRoot = fs.mkdtempSync(path.join(os.tmpdir(), "surf-direct-transfer-root-"));
    tempDirs.push(transferRoot);
    const host = await startHostHarness({ SURF_TMP: transferRoot }, tcpPort);
    expect(
      fs.readdirSync(transferRoot).filter((entry) => entry.startsWith("surf-transfer-")).length,
    ).toBe(0);
    const directFile = path.join(os.tmpdir(), `surf-direct-${process.pid}-${Date.now()}.txt`);
    const directShot = path.join(os.tmpdir(), `surf-direct-shot-${process.pid}-${Date.now()}.png`);
    fs.writeFileSync(directFile, "direct");
    const transport = await openClientTransport({
      kind: "remote",
      connectionOptions: { host: "127.0.0.1", port: tcpPort },
      credentialPath: host.remoteCredentialPath,
    });
    try {
      const uploadResponse = transport.request(
        {
          type: "tool_request",
          method: "execute_tool",
          params: { tool: "upload", args: { ref: "e5", files: [`remote:${directFile}`] } },
          id: "direct-upload",
        },
        30000,
        {
          pathRefs: [
            {
              field: "files",
              kind: "input",
              original: `remote:${directFile}`,
              path: directFile,
              pathKind: "remote",
            },
          ],
          uploads: [],
          downloads: [],
        },
      );
      const uploadMessage = await host.waitForMessage(
        (message) => message.type === "UPLOAD_FILE",
        "direct upload",
      );
      expect(uploadMessage.files).toEqual([directFile]);
      host.send({ id: uploadMessage.id, success: true });
      expect((await uploadResponse).error).toBeUndefined();
      expect(
        fs.readdirSync(transferRoot).filter((entry) => entry.startsWith("surf-transfer-")).length,
      ).toBe(0);

      const screenshotResponse = transport.request(
        {
          type: "tool_request",
          method: "execute_tool",
          params: { tool: "screenshot", args: { savePath: `remote:${directShot}` } },
          id: "direct-screenshot",
        },
        30000,
        {
          pathRefs: [
            {
              field: "savePath",
              kind: "output",
              original: `remote:${directShot}`,
              path: directShot,
              pathKind: "remote",
            },
          ],
          uploads: [],
          downloads: [],
        },
      );
      const screenshotMessage = await host.waitForMessage(
        (message) => message.type === "EXECUTE_SCREENSHOT",
        "direct screenshot",
      );
      expect(screenshotMessage.savePath).toBe(directShot);
      host.send({
        id: screenshotMessage.id,
        base64: Buffer.from("direct-shot").toString("base64"),
        width: 1,
        height: 1,
      });
      const screenshotResult = await screenshotResponse;
      expect(screenshotResult.error).toBeUndefined();
      expect(fs.readFileSync(directShot, "utf8")).toBe("direct-shot");
      expect(screenshotResult.result.content[0].text).toContain(`remote:${directShot}`);
      expect(screenshotResult.result.content[0].text).not.toContain("surf-transfer-");
      expect(
        fs.readdirSync(transferRoot).filter((entry) => entry.startsWith("surf-transfer-")).length,
      ).toBe(0);
    } finally {
      await transport.close();
      expect(
        fs.readdirSync(transferRoot).filter((entry) => entry.startsWith("surf-transfer-")).length,
      ).toBe(0);
      fs.rmSync(directFile, { recursive: false, force: true });
      fs.rmSync(directShot, { recursive: false, force: true });
    }
  });

  it("downloads remote screenshots atomically and hides host staging paths", async () => {
    const reservation = net.createServer();
    await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const tcpPort = reservation.address().port;
    await new Promise<void>((resolve) => reservation.close(resolve));
    const host = await startHostHarness({}, tcpPort);
    const destination = path.join(os.tmpdir(), `surf-remote-shot-${process.pid}-${Date.now()}.png`);
    const errorDestination = path.join(
      os.tmpdir(),
      `surf-remote-shot-error-${process.pid}-${Date.now()}.png`,
    );
    const endpoint = {
      kind: "remote",
      connectionOptions: { host: "127.0.0.1", port: tcpPort },
      credentialPath: host.remoteCredentialPath,
    };
    const transport = await openClientTransport(endpoint);
    try {
      const responsePromise = transport.request(
        {
          type: "tool_request",
          method: "execute_tool",
          params: { tool: "screenshot", args: { savePath: destination } },
          id: "screenshot-download",
        },
        30000,
        {
          pathRefs: [
            {
              field: "savePath",
              kind: "output",
              original: destination,
              path: destination,
              pathKind: "local",
            },
          ],
          downloads: [
            {
              transferId: "screenshot-download-file",
              field: "savePath",
              original: destination,
              destination,
            },
          ],
          uploads: [],
        },
      );
      const extensionRequest = await host.waitForMessage(
        (message) => message.type === "EXECUTE_SCREENSHOT",
        "remote screenshot",
      );
      host.send({
        id: extensionRequest.id,
        base64: Buffer.from("fake-png").toString("base64"),
        width: 10,
        height: 10,
      });
      const response = await responsePromise;
      expect(response.error).toBeUndefined();
      expect(await fs.readFileSync(destination, "utf8")).toBe("fake-png");
      const text = response.result.content[0].text;
      expect(text).toContain(destination);
      expect(text).not.toContain("surf-transfer-");

      const failed = fileTransfer.prepareRemoteTool("screenshot", { savePath: errorDestination });
      const failedResponsePromise = transport.request(
        {
          type: "tool_request",
          method: "execute_tool",
          params: { tool: "screenshot", args: failed.args },
          id: "screenshot-download-error",
        },
        30000,
        failed,
      );
      const failedExtensionRequest = await host.waitForMessage(
        (message) => message.type === "EXECUTE_SCREENSHOT",
        "failed remote screenshot",
      );
      host.send({
        id: failedExtensionRequest.id,
        error: `cannot write ${failedExtensionRequest.savePath}`,
      });
      const failedResponse = await failedResponsePromise;
      expect(failedResponse.error.content[0].text).toContain(errorDestination);
      expect(failedResponse.error.content[0].text).not.toContain("surf-transfer-");
      expect(fs.existsSync(errorDestination)).toBe(false);
    } finally {
      await transport.close();
      fs.rmSync(destination, { recursive: false, force: true });
      fs.rmSync(errorDestination, { recursive: false, force: true });
    }
  });

  it("exports remote network data through transferred and direct outputs", async () => {
    const reservation = net.createServer();
    await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const tcpPort = reservation.address().port;
    await new Promise<void>((resolve) => reservation.close(resolve));
    const host = await startHostHarness({}, tcpPort);
    const destination = path.join(
      os.tmpdir(),
      `surf-network-export-${process.pid}-${Date.now()}.json`,
    );
    const directDestination = path.join(
      os.tmpdir(),
      `surf-network-export-direct-${process.pid}-${Date.now()}.json`,
    );
    const transport = await openClientTransport({
      kind: "remote",
      connectionOptions: { host: "127.0.0.1", port: tcpPort },
      credentialPath: host.remoteCredentialPath,
    });
    const entries = [{ id: "r1", url: "https://example.test", _requestId: "hidden" }];
    try {
      const prepared = fileTransfer.prepareRemoteTool("network.export", { output: destination });
      const transferredResponse = transport.request(
        {
          type: "tool_request",
          method: "execute_tool",
          params: { tool: "network.export", args: prepared.args },
          id: "network-export-transferred",
        },
        30000,
        prepared,
      );
      const extensionRequest = await host.waitForMessage(
        (message) => message.type === "EXPORT_NETWORK_REQUESTS",
        "network export transfer",
      );
      expect(extensionRequest.output).toBeUndefined();
      host.send({ id: extensionRequest.id, entries, jsonl: false, har: false });
      const transferred = await transferredResponse;
      expect(transferred.error).toBeUndefined();
      const exported = JSON.parse(fs.readFileSync(destination, "utf8"));
      expect(exported).toEqual([{ id: "r1", url: "https://example.test" }]);

      const direct = fileTransfer.prepareRemoteTool("network.export", {
        output: `remote:${directDestination}`,
      });
      const directResponse = transport.request(
        {
          type: "tool_request",
          method: "execute_tool",
          params: { tool: "network.export", args: direct.args },
          id: "network-export-direct",
        },
        30000,
        direct,
      );
      const directRequest = await host.waitForMessage(
        (message) => message.type === "EXPORT_NETWORK_REQUESTS",
        "direct network export",
      );
      expect(directRequest.output).toBeUndefined();
      host.send({ id: directRequest.id, entries, jsonl: false, har: false });
      expect((await directResponse).error).toBeUndefined();
      expect(JSON.parse(fs.readFileSync(directDestination, "utf8"))).toEqual([
        { id: "r1", url: "https://example.test" },
      ]);
    } finally {
      await transport.close();
      fs.rmSync(destination, { recursive: false, force: true });
      fs.rmSync(directDestination, { recursive: false, force: true });
    }
  });

  it("transfers successful remote auto-screenshots without inline image data", async () => {
    const reservation = net.createServer();
    await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const tcpPort = reservation.address().port;
    await new Promise<void>((resolve) => reservation.close(resolve));
    const transferRoot = fs.mkdtempSync(path.join(os.tmpdir(), "surf-auto-transfer-root-"));
    tempDirs.push(transferRoot);
    const host = await startHostHarness({ SURF_TMP: transferRoot }, tcpPort);
    const transport = await openClientTransport({
      kind: "remote",
      connectionOptions: { host: "127.0.0.1", port: tcpPort },
      credentialPath: host.remoteCredentialPath,
    });
    const prepared = fileTransfer.prepareRemoteTool("click", {
      selector: "#go",
      autoScreenshot: true,
    });
    try {
      const responsePromise = transport.request(
        {
          type: "tool_request",
          method: "execute_tool",
          params: { tool: "click", args: prepared.args },
          tabId: 1,
          id: "auto-screenshot-transfer",
        },
        30000,
        prepared,
      );
      const click = await host.waitForMessage(
        (message) => message.type === "CLICK_SELECTOR",
        "auto screenshot click",
      );
      host.send({ id: click.id, success: true });
      const screenshot = await host.waitForMessage(
        (message) => message.type === "EXECUTE_SCREENSHOT",
        "auto screenshot capture",
      );
      host.send({
        id: screenshot.id,
        base64: Buffer.from("auto-png").toString("base64"),
        width: 1,
        height: 1,
      });
      const response = await responsePromise;
      expect(response.error).toBeUndefined();
      expect(response.result.content).toHaveLength(1);
      expect(response.result.content[0].type).toBe("text");
      expect(response.result.content[0].text).toContain(prepared.downloads[0].destination);
      expect(response.result.content[0].text).not.toContain("surf-transfer-");
      expect(JSON.stringify(response)).not.toContain("auto-png");
      const stagingDirectories = fs
        .readdirSync(transferRoot)
        .filter((entry) => entry.startsWith("surf-transfer-"));
      expect(stagingDirectories).toHaveLength(1);
      expect(fs.readdirSync(path.join(transferRoot, stagingDirectories[0]))).toEqual([]);
    } finally {
      await transport.close();
      fs.rmSync(prepared.downloads[0].destination, { recursive: false, force: true });
    }
  });

  it("fails remote auto-screenshot downloads without hanging or leaking staging", async () => {
    const reservation = net.createServer();
    await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const tcpPort = reservation.address().port;
    await new Promise<void>((resolve) => reservation.close(resolve));
    const transferRoot = fs.mkdtempSync(path.join(os.tmpdir(), "surf-auto-failure-root-"));
    tempDirs.push(transferRoot);
    const host = await startHostHarness({ SURF_TMP: transferRoot }, tcpPort);
    const transport = await openClientTransport({
      kind: "remote",
      connectionOptions: { host: "127.0.0.1", port: tcpPort },
      credentialPath: host.remoteCredentialPath,
    });
    try {
      const runFailure = async (id: string, screenshotResponse: NativeMessage) => {
        const prepared = fileTransfer.prepareRemoteTool("click", {
          selector: "#go",
          autoScreenshot: true,
        });
        const responsePromise = transport.request(
          {
            type: "tool_request",
            method: "execute_tool",
            params: { tool: "click", args: prepared.args },
            tabId: 1,
            id,
          },
          30000,
          prepared,
        );
        const click = await host.waitForMessage(
          (message) => message.type === "CLICK_SELECTOR",
          `${id} click`,
        );
        host.send({ id: click.id, success: true });
        const screenshot = await host.waitForMessage(
          (message) => message.type === "EXECUTE_SCREENSHOT",
          `${id} screenshot`,
        );
        host.send({ id: screenshot.id, ...screenshotResponse });
        const response = await responsePromise;
        expect(response.error).toBeTruthy();
        expect(fs.existsSync(prepared.downloads[0].destination)).toBe(false);
        expect(JSON.stringify(response)).not.toContain("surf-transfer-");
        expect(JSON.stringify(response)).not.toContain("auto-png");
      };

      await runFailure("auto-missing-base64", {});
      await runFailure("auto-nested-error", { error: "capture failed" });

      const primaryFailure = fileTransfer.prepareRemoteTool("click", {
        selector: "#go",
        autoScreenshot: true,
      });
      const primaryFailureResponse = transport.request(
        {
          type: "tool_request",
          method: "execute_tool",
          params: { tool: "click", args: primaryFailure.args },
          tabId: 1,
          id: "auto-primary-error",
        },
        30000,
        primaryFailure,
      );
      const failedClick = await host.waitForMessage(
        (message) => message.type === "CLICK_SELECTOR",
        "auto primary-error click",
      );
      host.send({ id: failedClick.id, error: "primary click failure" });
      await host.expectNoMessage(
        (message) => message.type === "EXECUTE_SCREENSHOT",
        "screenshot after primary action failure",
      );
      expect((await primaryFailureResponse).error.content[0].text).toContain(
        "primary click failure",
      );
      expect(fs.existsSync(primaryFailure.downloads[0].destination)).toBe(false);

      const nextPromise = transport.request({
        type: "tool_request",
        method: "execute_tool",
        params: { tool: "tab.list", args: {} },
        id: "auto-after-failure",
      });
      const next = await host.waitForMessage(
        (message) => message.type === "LIST_TABS",
        "auto after failure",
      );
      host.send({ id: next.id, tabs: [] });
      expect((await nextPromise).error).toBeUndefined();
    } finally {
      await transport.close();
    }
  });

  it("rejects transfer frames after remote credential revocation", async () => {
    const reservation = net.createServer();
    await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const tcpPort = reservation.address().port;
    await new Promise<void>((resolve) => reservation.close(resolve));
    const host = await startHostHarness({}, tcpPort);
    const socket = net.createConnection({ host: "127.0.0.1", port: tcpPort });
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    await remoteTransport.authenticateClient(socket, host.remoteCredentialPath);
    if (!host.remoteStateDir) {
      throw new Error("remote state directory missing");
    }
    remoteAuth.revokeClient("integration-client", host.remoteStateDir);
    let sawReady = false;
    const parser = remoteTransport.createFrameParser({
      onFrame: (message: NativeMessage) => {
        if (message.type === "transfer_ready") {
          sawReady = true;
        }
      },
      onError: () => undefined,
    });
    socket.on("data", (chunk: any) => parser.push(chunk));
    const data = Buffer.from("revoked");
    remoteTransport.writeFrame(socket, {
      type: "transfer_begin",
      version: 1,
      direction: "upload",
      transferId: "revoked-transfer",
      size: data.length,
      sha256: crypto.createHash("sha256").update(data).digest("hex"),
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sawReady).toBe(false);
    expect(socket.destroyed || socket.writableEnded).toBe(true);
    socket.destroy();
  });

  it("cleans a timed-out staged upload before the next lease dispatch", async () => {
    const reservation = net.createServer();
    await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const tcpPort = reservation.address().port;
    await new Promise<void>((resolve) => reservation.close(resolve));
    const transferRoot = fs.mkdtempSync(path.join(os.tmpdir(), "surf-transfer-timeout-"));
    tempDirs.push(transferRoot);
    const host = await startHostHarness(
      { SURF_TMP: transferRoot, SURF_TEST_MODE: "1", SURF_TEST_REQUEST_DEADLINE_MS: "100" },
      tcpPort,
    );
    const source = path.join(transferRoot, "client-upload.txt");
    fs.writeFileSync(source, "staged before timeout");
    const endpoint = {
      kind: "remote",
      connectionOptions: { host: "127.0.0.1", port: tcpPort },
      credentialPath: host.remoteCredentialPath,
    };
    const transport = await openClientTransport(endpoint);
    const prepared = fileTransfer.prepareRemoteTool("upload", { ref: "e5", files: [source] });
    const timeoutPromise = transport.request(
      {
        type: "tool_request",
        method: "execute_tool",
        id: "timeout-upload",
        params: { tool: "upload", args: prepared.args },
      },
      5000,
      prepared,
    );
    const upload = await host.waitForMessage(
      (message) => message.type === "UPLOAD_FILE",
      "timed upload",
    );
    const stagedPath = (upload.files as string[])[0];
    expect(fs.existsSync(stagedPath)).toBe(true);
    expect((await timeoutPromise).error).toBeTruthy();

    const nextPromise = transport.request({
      type: "tool_request",
      method: "execute_tool",
      id: "after-timeout",
      params: { tool: "tab.list", args: {} },
    });
    const next = await host.waitForMessage(
      (message) => message.type === "LIST_TABS",
      "after timeout LIST_TABS",
    );
    expect(fs.existsSync(stagedPath)).toBe(false);
    const stagingDirectories = fs
      .readdirSync(transferRoot)
      .filter((entry) => entry.startsWith("surf-transfer-"));
    expect(stagingDirectories).toHaveLength(1);
    expect(fs.readdirSync(path.join(transferRoot, stagingDirectories[0]))).toEqual([]);
    host.send({ id: next.id, tabs: [] });
    expect((await nextPromise).error).toBeUndefined();
    await transport.close();
  });

  it("awaits staged transfer cleanup before host shutdown exits", async () => {
    const reservation = net.createServer();
    await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const tcpPort = reservation.address().port;
    await new Promise<void>((resolve) => reservation.close(resolve));
    const transferRoot = fs.mkdtempSync(path.join(os.tmpdir(), "surf-transfer-shutdown-"));
    tempDirs.push(transferRoot);
    const host = await startHostHarness({ SURF_TMP: transferRoot }, tcpPort);
    const source = path.join(os.tmpdir(), `surf-shutdown-source-${process.pid}-${Date.now()}.txt`);
    fs.writeFileSync(source, "shutdown cleanup");
    const transport = await openClientTransport({
      kind: "remote",
      connectionOptions: { host: "127.0.0.1", port: tcpPort },
      credentialPath: host.remoteCredentialPath,
    });
    try {
      const prepared = fileTransfer.prepareRemoteTool("upload", { ref: "e5", files: [source] });
      const requestPromise = transport.request(
        {
          type: "tool_request",
          method: "execute_tool",
          params: { tool: "upload", args: prepared.args },
          id: "shutdown-upload",
        },
        30000,
        prepared,
      );
      requestPromise.catch(() => undefined);
      const extensionRequest = await host.waitForMessage(
        (message) => message.type === "UPLOAD_FILE",
        "shutdown upload",
      );
      const stagedPath = (extensionRequest.files as string[])[0];
      expect(fs.existsSync(stagedPath)).toBe(true);
      host.child.kill("SIGTERM");
      await waitForExit(host.child, 2000);
      expect(fs.existsSync(stagedPath)).toBe(false);
      expect(
        fs.readdirSync(transferRoot).filter((entry) => entry.startsWith("surf-transfer-")).length,
      ).toBe(0);
      await requestPromise.catch(() => undefined);
    } finally {
      await transport.close();
      fs.rmSync(source, { recursive: false, force: true });
    }
  });

  it("does not create transfer staging for unauthenticated TCP sockets", async () => {
    const reservation = net.createServer();
    await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const tcpPort = reservation.address().port;
    await new Promise<void>((resolve) => reservation.close(resolve));
    const transferRoot = fs.mkdtempSync(path.join(os.tmpdir(), "surf-transfer-lazy-"));
    tempDirs.push(transferRoot);
    const _host = await startHostHarness({ SURF_TMP: transferRoot }, tcpPort);
    const socket = net.createConnection({ host: "127.0.0.1", port: tcpPort });
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(
      fs.readdirSync(transferRoot).filter((entry) => entry.startsWith("surf-transfer-")).length,
    ).toBe(0);
    socket.destroy();
  });

  it("rejects forged and prototype-like path metadata before dispatch", async () => {
    const reservation = net.createServer();
    await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const tcpPort = reservation.address().port;
    await new Promise<void>((resolve) => reservation.close(resolve));
    const transferRoot = fs.mkdtempSync(path.join(os.tmpdir(), "surf-transfer-malformed-"));
    tempDirs.push(transferRoot);
    const host = await startHostHarness({ SURF_TMP: transferRoot }, tcpPort);
    const socket = net.createConnection({ host: "127.0.0.1", port: tcpPort });
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    await remoteTransport.authenticateClient(socket, host.remoteCredentialPath);
    const responses = new Map<string, NativeMessage>();
    const responseWaiters = new Map<string, (message: NativeMessage) => void>();
    const responseParser = remoteTransport.createFrameParser({
      onFrame: (message: NativeMessage) => {
        if (typeof message.id === "string" && responseWaiters.has(message.id)) {
          responseWaiters.get(message.id)?.(message);
        } else if (typeof message.id === "string") {
          responses.set(message.id, message);
        }
      },
      onError: () => undefined,
    });
    socket.on("data", (chunk: any) => responseParser.push(chunk));
    const waitResponse = async (id: string) => {
      const queued = responses.get(id);
      if (queued) {
        responses.delete(id);
        return queued;
      }
      return new Promise<NativeMessage>((resolve) => responseWaiters.set(id, resolve));
    };
    const expectRejected = async (message: NativeMessage, extensionType: string, label: string) => {
      remoteTransport.writeFrame(socket, message);
      await host.expectNoMessage((candidate) => candidate.type === extensionType, label);
      expect((await waitResponse(message.id as string)).error).toBeTruthy();
    };
    remoteTransport.writeFrame(socket, {
      type: "tool_request",
      method: "execute_tool",
      id: "forged-path",
      params: { tool: "upload", args: { ref: "e5", files: ["/etc/passwd"] } },
      _surfPaths: [
        {
          field: "files",
          kind: "input",
          original: "client.txt",
          path: "client.txt",
          pathKind: "local",
        },
      ],
      _surfTransfers: {
        uploads: [
          { transferId: "missing", field: "files", original: "client.txt", kind: "upload" },
        ],
        downloads: [],
      },
    });
    await host.expectNoMessage((message) => message.type === "UPLOAD_FILE", "forged upload");
    expect((await waitResponse("forged-path")).error).toBeTruthy();
    await expectRejected(
      {
        type: "tool_request",
        method: "execute_tool",
        id: "auto-disallowed-tool",
        params: { tool: "tab.list", args: { autoScreenshot: true } },
      },
      "LIST_TABS",
      "auto screenshot disallowed tool",
    );
    await expectRejected(
      {
        type: "tool_request",
        method: "execute_tool",
        id: "auto-non-boolean",
        params: { tool: "click", args: { selector: "#go", autoScreenshot: "yes" } },
      },
      "CLICK_SELECTOR",
      "auto screenshot non-boolean",
    );
    const validRemoteScreenshot = (
      id: string,
      descriptor: Record<string, unknown>,
      transfers: Record<string, unknown> = { uploads: [], downloads: [] },
      descriptors = [descriptor],
    ) => ({
      type: "tool_request",
      method: "execute_tool",
      id,
      params: { tool: "screenshot", args: { savePath: "remote:/tmp/raw.png" } },
      _surfPaths: descriptors,
      _surfTransfers: transfers,
    });
    const unknownDescriptor = JSON.parse(
      '{"field":"savePath","kind":"output","original":"remote:/tmp/raw.png","path":"/tmp/raw.png","pathKind":"remote","__proto__":"reject"}',
    );
    await expectRejected(
      validRemoteScreenshot("prototype-path", unknownDescriptor),
      "EXECUTE_SCREENSHOT",
      "prototype screenshot",
    );
    await expectRejected(
      validRemoteScreenshot("path-kind", {
        field: "savePath",
        kind: "output",
        original: "remote:/tmp/raw.png",
        path: "/tmp/raw.png",
        pathKind: "local",
      }),
      "EXECUTE_SCREENSHOT",
      "path kind mismatch",
    );
    await expectRejected(
      validRemoteScreenshot("path-value", {
        field: "savePath",
        kind: "output",
        original: "remote:/tmp/raw.png",
        path: "/tmp/other.png",
        pathKind: "remote",
      }),
      "EXECUTE_SCREENSHOT",
      "path value mismatch",
    );
    await expectRejected(
      validRemoteScreenshot(
        "extra-meta",
        {
          field: "savePath",
          kind: "output",
          original: "remote:/tmp/raw.png",
          path: "/tmp/raw.png",
          pathKind: "remote",
        },
        { uploads: [], downloads: [], extra: true },
      ),
      "EXECUTE_SCREENSHOT",
      "extra transfer metadata",
    );
    const duplicate = {
      field: "savePath",
      kind: "output",
      original: "remote:/tmp/raw.png",
      path: "/tmp/raw.png",
      pathKind: "remote",
    };
    await expectRejected(
      validRemoteScreenshot("duplicate-path", duplicate, { uploads: [], downloads: [] }, [
        duplicate,
        { ...duplicate },
      ]),
      "EXECUTE_SCREENSHOT",
      "duplicate path descriptor",
    );
    await expectRejected(
      validRemoteScreenshot("multiple-transfers", duplicate, {
        uploads: [
          { transferId: "a", field: "files", original: "a", kind: "upload" },
          { transferId: "b", field: "files", original: "b", kind: "upload" },
        ],
        downloads: [],
      }),
      "EXECUTE_SCREENSHOT",
      "multiple transfer metadata",
    );
    await expectRejected(
      {
        type: "tool_request",
        method: "execute_tool",
        id: "invalid-local-transfer-id",
        params: { tool: "screenshot", args: { savePath: "local:shot.png" } },
        _surfPaths: [
          {
            field: "savePath",
            kind: "output",
            original: "local:shot.png",
            path: "local:shot.png",
            pathKind: "local",
          },
        ],
        _surfTransfers: {
          uploads: [],
          downloads: [
            {
              transferId: 7,
              field: "savePath",
              original: "local:shot.png",
              kind: "download",
            },
          ],
        },
      },
      "EXECUTE_SCREENSHOT",
      "invalid local transfer ID",
    );
    await expectRejected(
      {
        type: "tool_request",
        method: "execute_tool",
        id: "forged-local-descriptor-path",
        params: { tool: "screenshot", args: { savePath: "local:shot.png" } },
        _surfPaths: [
          {
            field: "savePath",
            kind: "output",
            original: "local:shot.png",
            path: "/forged/client/path.png",
            pathKind: "local",
          },
        ],
        _surfTransfers: {
          uploads: [],
          downloads: [
            {
              transferId: "valid-download-id",
              field: "savePath",
              original: "local:shot.png",
              kind: "download",
            },
          ],
        },
      },
      "EXECUTE_SCREENSHOT",
      "forged local descriptor path",
    );
    expect(
      fs.readdirSync(transferRoot).filter((entry) => entry.startsWith("surf-transfer-")).length,
    ).toBe(0);
    socket.destroy();
  });

  it("serializes local and authenticated remote requests through one host lease", async () => {
    const reservation = net.createServer();
    await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const tcpPort = reservation.address().port;
    await new Promise<void>((resolve) => reservation.close(resolve));
    const host = await startHostHarness({}, tcpPort);
    const local = net.createConnection(host.socketPath);
    await new Promise<void>((resolve) => local.once("connect", resolve));
    const remote = net.createConnection({ host: "127.0.0.1", port: tcpPort });
    await new Promise<void>((resolve) => remote.once("connect", resolve));
    await remoteTransport.authenticateClient(remote, host.remoteCredentialPath);
    const readRemote = new Promise<string>((resolve) =>
      remote.once("data", (chunk: any) => resolve(chunk.toString("utf8"))),
    );

    remoteTransport.writeFrame(local, {
      type: "tool_request",
      method: "execute_tool",
      params: { tool: "tab.list", args: {} },
      id: "local",
    });
    const firstExtensionRequest = await host.waitForMessage(
      (message) => message.type === "LIST_TABS",
      "first LIST_TABS",
    );
    remoteTransport.writeFrame(remote, {
      type: "tool_request",
      method: "execute_tool",
      params: { tool: "page.text", args: {} },
      id: "remote",
    });
    await host.expectNoMessage(
      (message) => message.type === "GET_PAGE_TEXT",
      "remote request before local lease release",
    );
    host.send({ id: firstExtensionRequest.id, tabs: [] });
    await new Promise<void>((resolve) => local.once("data", () => resolve()));
    local.end();
    const secondExtensionRequest = await host.waitForMessage(
      (message) => message.type === "GET_PAGE_TEXT",
      "second GET_PAGE_TEXT",
    );
    host.send({ id: secondExtensionRequest.id, text: "remote result" });
    expect(await readRemote).toContain('"id":"remote"');
    remote.destroy();
  });

  it("keeps a disconnected active request leased until extension settlement", async () => {
    const host = await startHostHarness();
    const first = net.createConnection(host.socketPath);
    await new Promise<void>((resolve) => first.once("connect", resolve));
    remoteTransport.writeFrame(first, {
      type: "tool_request",
      method: "execute_tool",
      params: { tool: "tab.list", args: {} },
      id: "abandoned",
    });
    const extensionRequest = await host.waitForMessage(
      (message) => message.type === "LIST_TABS",
      "abandoned LIST_TABS",
    );
    first.destroy();
    const second = net.createConnection(host.socketPath);
    await new Promise<void>((resolve) => second.once("connect", resolve));
    remoteTransport.writeFrame(second, {
      type: "tool_request",
      method: "execute_tool",
      params: { tool: "tab.list", args: {} },
      id: "queued",
    });
    await host.expectNoMessage(
      (message) => message.type === "LIST_TABS",
      "queued request before abandoned operation settles",
    );
    host.send({ id: extensionRequest.id, tabs: [] });
    const secondExtensionRequest = await host.waitForMessage(
      (message) => message.type === "LIST_TABS",
      "queued LIST_TABS",
    );
    host.send({ id: secondExtensionRequest.id, tabs: [] });
    second.destroy();
  });

  it("retains a nested provider tombstone until its late page response", async () => {
    const host = await startHostHarness();
    const first = net.createConnection(host.socketPath);
    await new Promise<void>((resolve) => first.once("connect", resolve));
    remoteTransport.writeFrame(first, {
      type: "tool_request",
      method: "execute_tool",
      params: { tool: "chatgpt", args: { query: "nested", "with-page": true } },
      id: "nested-abandoned",
    });
    const pageRequest = await host.waitForMessage(
      (message) => message.type === "GET_PAGE_TEXT",
      "nested provider page request",
    );
    first.destroy();
    const second = net.createConnection(host.socketPath);
    await new Promise<void>((resolve) => second.once("connect", resolve));
    remoteTransport.writeFrame(second, {
      type: "tool_request",
      method: "execute_tool",
      params: { tool: "tab.list", args: {} },
      id: "nested-next",
    });
    await host.expectNoMessage(
      (message) => message.type === "LIST_TABS",
      "next request before nested tombstone drains",
    );
    host.send({ id: pageRequest.id, text: "late page" });
    const nextRequest = await host.waitForMessage(
      (message) => message.type === "LIST_TABS",
      "next request after nested tombstone drains",
    );
    host.send({ id: nextRequest.id, tabs: [] });
    second.destroy();
  });

  it("holds the lease until provider tombstones and tab cleanup both drain", async () => {
    const host = await startHostHarness();
    const first = net.createConnection(host.socketPath);
    await new Promise<void>((resolve) => first.once("connect", resolve));
    remoteTransport.writeFrame(first, {
      type: "tool_request",
      method: "execute_tool",
      params: { tool: "chatgpt", args: { query: "cancel me" } },
      id: "provider-abandoned",
    });

    const cookieRequest = await host.waitForMessage(
      (message) => message.type === "GET_CHATGPT_COOKIES",
      "ChatGPT cookies",
    );
    host.send({
      id: cookieRequest.id,
      cookies: [{ name: "__Secure-next-auth.session-token", value: "token" }],
    });
    const tabRequest = await host.waitForMessage(
      (message) => message.type === "CHATGPT_NEW_TAB",
      "ChatGPT tab",
    );
    host.send({ id: tabRequest.id, tabId: 42 });
    const evaluateRequest = await host.waitForMessage(
      (message) => message.type === "CHATGPT_EVALUATE",
      "ChatGPT page evaluation",
    );

    first.destroy();
    const closeRequest = await host.waitForMessage(
      (message) => message.type === "CHATGPT_CLOSE_TAB",
      "ChatGPT cleanup",
    );
    const second = net.createConnection(host.socketPath);
    await new Promise<void>((resolve) => second.once("connect", resolve));
    remoteTransport.writeFrame(second, {
      type: "tool_request",
      method: "execute_tool",
      params: { tool: "tab.list", args: {} },
      id: "after-provider-cleanup",
    });

    await host.expectNoMessage(
      (message) => message.type === "LIST_TABS",
      "next request before provider tombstone drains",
    );
    host.send({ id: evaluateRequest.id, result: { value: "complete" } });
    await host.expectNoMessage(
      (message) => message.type === "LIST_TABS",
      "next request before provider tab cleanup drains",
    );
    host.send({ id: closeRequest.id, success: true });
    const nextRequest = await host.waitForMessage(
      (message) => message.type === "LIST_TABS",
      "next request after provider cleanup",
    );
    host.send({ id: nextRequest.id, tabs: [] });
    second.destroy();
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
