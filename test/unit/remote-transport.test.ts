import { afterEach, describe, expect, it } from "vitest";

declare const require: (moduleName: string) => unknown;
declare const Buffer: {
  from(value: string): BufferLike;
  alloc(size: number, fill?: number): BufferLike;
};
type BufferLike = { toString(encoding?: string): string };
type SocketLike = {
  once(event: string, listener: (...args: unknown[]) => void): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  write(data: unknown): boolean;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
  destroy(error?: Error): void;
};
type ServerLike = {
  listen(port: number, host: string, callback: () => void): void;
  close(callback: () => void): void;
  address(): { port: number } | string | null;
};
const fs = require("node:fs") as {
  mkdtempSync(prefix: string): string;
  rmSync(filePath: string, options: { recursive?: boolean; force?: boolean }): void;
};
const net = require("node:net") as {
  createServer(handler: (socket: SocketLike) => void): ServerLike;
  createConnection(options: { host: string; port: number }): SocketLike;
};
const os = require("node:os") as { tmpdir(): string };
const path = require("node:path") as { join(...parts: string[]): string };

const sessions = require("../../native/host-sessions.cjs") as {
  HostSessionManager: new () => {
    admit(socket: object, isRemote: boolean): Record<string, unknown>;
    authenticate(
      context: Record<string, unknown>,
      principal: { clientId: string; label: string },
    ): void;
    close(context: Record<string, unknown>): void;
  };
};
const auth = require("../../native/remote-auth.cjs") as {
  authorizeClient(label: string, outputPath: string, stateDir: string): unknown;
  loadCredential(filePath: string): Record<string, unknown>;
  revokeClient(label: string, stateDir: string): void;
  signProof(credential: Record<string, unknown>, clientNonce: string, serverNonce: string): string;
};
const transport = require("../../native/remote-transport.cjs") as {
  authenticateClient(
    socket: SocketLike,
    credential: string | Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<{ clientId: string; label: string }>;
  createFrameParser(options: {
    onFrame: (value: Record<string, unknown>) => void;
    onError: (error: Error) => void;
    frameTimeoutMs?: number;
  }): { push(chunk: BufferLike): void; close(): void };
  createServerAuthSession(options: {
    socket: SocketLike;
    stateDir: string;
    timeoutMs?: number;
    onAuthenticated: (principal: { clientId: string; label: string }) => void;
    onError: (error: Error) => void;
  }): {
    authenticated: boolean;
    failed: boolean;
    principal: { clientId: string; label: string } | null;
    handle(message: Record<string, unknown>): Promise<boolean>;
    close(): void;
  };
  isClientAuthorized(stateDir: string, clientId: string): boolean;
  createSocketWriter(
    socket: SocketLike,
    options?: {
      maxPendingBytes?: number;
      onOverflow?: (value: { stream: boolean; error: Error }) => void;
    },
  ): {
    send(value: Record<string, unknown>, sendOptions?: { stream?: boolean }): Promise<void>;
    close(): void;
  };
  writeFrame(socket: SocketLike, value: Record<string, unknown>): Promise<void>;
};

const tempDirs: string[] = [];
const servers: ServerLike[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createState() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "surf-remote-transport-"));
  tempDirs.push(dir);
  return dir;
}

async function startAuthServer(
  stateDir: string,
  authTimeoutMs = 5000,
  sessionManager?: InstanceType<typeof sessions.HostSessionManager>,
) {
  const server = net.createServer((socket: SocketLike) => {
    socket.on("error", () => undefined);
    const context = sessionManager?.admit(socket, true);
    const session = transport.createServerAuthSession({
      socket,
      stateDir,
      timeoutMs: authTimeoutMs,
      onAuthenticated: (principal) => {
        if (sessionManager && context) {
          sessionManager.authenticate(context, principal);
        }
      },
      onError: (error) => {
        transport
          .writeFrame(socket, { type: "auth_error", message: error.message })
          .finally(() => socket.destroy())
          .catch(() => socket.destroy());
      },
    });
    const parser = transport.createFrameParser({
      onFrame: (message) => {
        (async () => {
          if (!session.authenticated) {
            await session.handle(message);
            return;
          }
          if (
            !session.principal ||
            !transport.isClientAuthorized(stateDir, session.principal.clientId)
          ) {
            await transport.writeFrame(socket, {
              error: "remote client authorization was revoked",
            });
            socket.destroy();
            return;
          }
          await transport.writeFrame(socket, { type: "tool_response", id: message.id || null });
        })().catch(() => socket.destroy());
      },
      onError: () => socket.destroy(),
      frameTimeoutMs: 100,
    });
    socket.on("data", (...args: unknown[]) => parser.push(args[0] as BufferLike));
    socket.on("close", () => {
      parser.close();
      session.close();
      if (sessionManager && context) {
        sessionManager.close(context);
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server did not bind");
  }
  return address.port;
}

function connect(port: number) {
  return new Promise<SocketLike>((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function readFrame(socket: SocketLike) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const onData = (...args: unknown[]) => {
      const text = (args[0] as BufferLike).toString("utf8");
      const line = text.split("\\n")[0];
      try {
        socket.removeListener("error", onError);
        resolve(JSON.parse(line) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    };
    const onError = (...args: unknown[]) => reject(args[0]);
    socket.once("data", onData);
    socket.once("error", onError);
  });
}

describe("remote transport authentication", () => {
  it("authenticates a real client over loopback and rejects commands before auth", async () => {
    const stateDir = createState();
    const credentialPath = path.join(stateDir, "client.json");
    auth.authorizeClient("alice", credentialPath, stateDir);
    const port = await startAuthServer(stateDir);
    const unauthenticated = await connect(port);
    unauthenticated.on("error", () => undefined);
    const preAuth = new Promise<string>((resolve) =>
      unauthenticated.once("data", (...args: unknown[]) =>
        resolve((args[0] as BufferLike).toString("utf8")),
      ),
    );
    await transport.writeFrame(unauthenticated, { type: "tool_request", id: "before-auth" });
    expect(await preAuth).toContain("authentication required");
    unauthenticated.destroy();

    const socket = await connect(port);
    socket.on("error", () => undefined);
    await expect(transport.authenticateClient(socket, credentialPath)).resolves.toMatchObject({
      label: "alice",
    });
    await transport.writeFrame(socket, { type: "tool_request", id: "request-1" });
    socket.destroy();
  });

  it("rejects the fifth authenticated connection before sending auth_ok", async () => {
    const stateDir = createState();
    const credentialPath = path.join(stateDir, "client.json");
    auth.authorizeClient("alice", credentialPath, stateDir);
    const sessionManager = new sessions.HostSessionManager();
    const port = await startAuthServer(stateDir, 5000, sessionManager);
    const sockets = await Promise.all(Array.from({ length: 5 }, () => connect(port)));
    for (const socket of sockets) {
      socket.on("error", () => undefined);
    }
    for (const socket of sockets.slice(0, 4)) {
      await expect(transport.authenticateClient(socket, credentialPath)).resolves.toMatchObject({
        label: "alice",
      });
    }
    await expect(transport.authenticateClient(sockets[4], credentialPath)).rejects.toThrow(
      "maximum connections",
    );
    for (const socket of sockets) {
      socket.destroy();
    }
  });

  it("fails closed for revoked clients and pinned server mismatches", async () => {
    const stateDir = createState();
    const credentialPath = path.join(stateDir, "client.json");
    auth.authorizeClient("alice", credentialPath, stateDir);
    const port = await startAuthServer(stateDir);
    auth.revokeClient("alice", stateDir);
    const revoked = await connect(port);
    revoked.on("error", () => undefined);
    await expect(transport.authenticateClient(revoked, credentialPath)).rejects.toThrow(
      "not authorized",
    );
    revoked.destroy();

    const replacementPath = path.join(stateDir, "replacement.json");
    auth.authorizeClient("alice", replacementPath, stateDir);
    const credential = auth.loadCredential(replacementPath);
    credential.hostPublicKey = Buffer.alloc(32, 8).toString("base64");
    const wrongPin = await connect(port);
    wrongPin.on("error", () => undefined);
    await expect(transport.authenticateClient(wrongPin, credential)).rejects.toThrow(
      "identity verification failed",
    );
    wrongPin.destroy();
  });

  it("rejects malformed client proofs", async () => {
    const stateDir = createState();
    const credentialPath = path.join(stateDir, "client.json");
    auth.authorizeClient("alice", credentialPath, stateDir);
    const credential = auth.loadCredential(credentialPath);
    const port = await startAuthServer(stateDir);
    const socket = await connect(port);
    socket.on("error", () => undefined);
    const clientNonce = Buffer.alloc(32, 4).toString("base64");
    await transport.writeFrame(socket, {
      type: "auth_hello",
      version: 1,
      clientId: credential.clientId,
      clientNonce,
    });
    await readFrame(socket);
    await transport.writeFrame(socket, {
      type: "auth_proof",
      version: 1,
      clientId: credential.clientId,
      proof: Buffer.alloc(64, 7).toString("base64"),
    });
    await expect(readFrame(socket)).resolves.toMatchObject({
      type: "auth_error",
      message: "remote client proof verification failed",
    });
    socket.destroy();
  });

  it("times out clients that never complete authentication", async () => {
    const stateDir = createState();
    const port = await startAuthServer(stateDir, 20);
    const socket = await connect(port);
    socket.on("error", () => undefined);
    await expect(readFrame(socket)).resolves.toMatchObject({
      type: "auth_error",
      message: "authentication timed out",
    });
    socket.destroy();
  });

  it("rejects a captured proof replayed against a fresh server nonce", async () => {
    const stateDir = createState();
    const credentialPath = path.join(stateDir, "client.json");
    auth.authorizeClient("alice", credentialPath, stateDir);
    const credential = auth.loadCredential(credentialPath);
    const clientNonce = Buffer.alloc(32, 9).toString("base64");
    const port = await startAuthServer(stateDir);
    const first = await connect(port);
    first.on("error", () => undefined);
    await transport.writeFrame(first, {
      type: "auth_hello",
      version: 1,
      clientId: credential.clientId,
      clientNonce,
    });
    const firstChallenge = await readFrame(first);
    const capturedProof = auth.signProof(
      credential,
      clientNonce,
      firstChallenge.serverNonce as string,
    );
    await transport.writeFrame(first, {
      type: "auth_proof",
      version: 1,
      clientId: credential.clientId,
      proof: capturedProof,
    });
    await expect(readFrame(first)).resolves.toMatchObject({ type: "auth_ok" });
    first.destroy();

    const second = await connect(port);
    second.on("error", () => undefined);
    await transport.writeFrame(second, {
      type: "auth_hello",
      version: 1,
      clientId: credential.clientId,
      clientNonce,
    });
    await readFrame(second);
    await transport.writeFrame(second, {
      type: "auth_proof",
      version: 1,
      clientId: credential.clientId,
      proof: capturedProof,
    });
    await expect(readFrame(second)).resolves.toMatchObject({
      type: "auth_error",
      message: "remote client proof verification failed",
    });
    second.destroy();
  });

  it("rejects the next request after an authenticated client is revoked", async () => {
    const stateDir = createState();
    const credentialPath = path.join(stateDir, "client.json");
    auth.authorizeClient("alice", credentialPath, stateDir);
    const port = await startAuthServer(stateDir);
    const socket = await connect(port);
    socket.on("error", () => undefined);
    await expect(transport.authenticateClient(socket, credentialPath)).resolves.toMatchObject({
      label: "alice",
    });
    auth.revokeClient("alice", stateDir);
    await transport.writeFrame(socket, { type: "tool_request", id: "revoked-request" });
    await expect(readFrame(socket)).resolves.toMatchObject({
      error: "remote client authorization was revoked",
    });
    socket.destroy();
  });

  it("rejects an oversized remainder after a valid frame", () => {
    const errors: string[] = [];
    const parser = transport.createFrameParser({
      onFrame: () => undefined,
      onError: (error) => errors.push(error.message),
    });
    parser.push(Buffer.from(`{"ok":true}\n${"x".repeat(1024 * 1024 + 1)}`));
    expect(errors).toEqual(["frame exceeds byte limit"]);
  });

  it("rejects a backpressured frame when the socket closes cleanly", async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const socket: SocketLike = {
      once(event, listener) {
        listeners.set(event, listener);
      },
      on(event, listener) {
        listeners.set(event, listener);
      },
      removeListener(event, listener) {
        if (listeners.get(event) === listener) {
          listeners.delete(event);
        }
      },
      write: () => false,
      destroy: () => undefined,
    };
    const pending = transport.writeFrame(socket, { frame: true });
    listeners.get("close")?.();
    await expect(pending).rejects.toThrow("closed");
    expect(listeners.has("drain")).toBe(false);
  });

  it("serializes writes and rejects bounded queue overflow", async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const socket: SocketLike = {
      once(event, listener) {
        listeners.set(event, listener);
      },
      on(event, listener) {
        listeners.set(event, listener);
      },
      removeListener(event, listener) {
        if (listeners.get(event) === listener) {
          listeners.delete(event);
        }
      },
      write: () => false,
      destroy: () => undefined,
    };
    let overflow: { stream: boolean } | undefined;
    const writer = transport.createSocketWriter(socket, {
      maxPendingBytes: 100,
      onOverflow: (value) => {
        overflow = value;
      },
    });
    const first = writer.send({ first: true });
    await expect(writer.send({ second: "x".repeat(90) }, { stream: true })).rejects.toThrow(
      "queue is full",
    );
    expect(overflow?.stream).toBe(true);
    writer.close();
    await expect(first).rejects.toThrow("socket writer closed");
  });

  it("counts the backpressured frame against the writer bound", async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const socket: SocketLike = {
      once(event, listener) {
        listeners.set(event, listener);
      },
      on(event, listener) {
        listeners.set(event, listener);
      },
      removeListener(event, listener) {
        if (listeners.get(event) === listener) {
          listeners.delete(event);
        }
      },
      write: () => false,
      destroy: () => undefined,
    };
    const writer = transport.createSocketWriter(socket, { maxPendingBytes: 40 });
    const first = writer.send({ first: true });
    await expect(writer.send({ second: "123456789012" })).rejects.toThrow("queue is full");
    writer.close();
    await expect(first).rejects.toThrow("socket writer closed");
  });

  it("rejects malformed JSON and incomplete frames", async () => {
    const errors: string[] = [];
    const parser = transport.createFrameParser({
      onFrame: () => undefined,
      onError: (error) => errors.push(error.message),
      frameTimeoutMs: 10,
    });
    parser.push(Buffer.from("{not-json}\n"));
    expect(errors).toEqual(["frame contains invalid JSON"]);
    const timeoutParser = transport.createFrameParser({
      onFrame: () => undefined,
      onError: (error) => errors.push(error.message),
      frameTimeoutMs: 10,
    });
    timeoutParser.push(Buffer.from('{"partial":'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(errors).toContain("incomplete frame timed out");
  });
});
