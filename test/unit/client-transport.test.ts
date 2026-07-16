import { afterEach, describe, expect, it } from "vitest";

type SocketLike = {
  on(event: string, listener: (...args: unknown[]) => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
  write(value: string): void;
  destroy(): void;
};
type ServerLike = {
  listen(port: number, host: string, callback: () => void): void;
  address(): { port: number } | string | null;
  close(callback: () => void): void;
};
const net = require("node:net") as {
  createServer(handler: (socket: SocketLike) => void): ServerLike;
};
const fs = require("node:fs") as {
  existsSync(filePath: string): boolean;
  mkdtempSync(prefix: string): string;
  readFileSync(filePath: string, encoding: string): string;
  rmSync(filePath: string, options: { recursive: boolean; force: boolean }): void;
  writeFileSync(filePath: string, value: string): void;
};
const os = require("node:os") as { tmpdir(): string };
const path = require("node:path") as { join(...parts: string[]): string };
const Buffer: any = require("node:buffer").Buffer;
const remoteAuth = require("../../native/remote-auth.cjs") as {
  authorizeClient(label: string, outputPath: string, stateDir: string): unknown;
};
const { openClientTransport } = require("../../native/client-transport.cjs") as {
  openClientTransport(
    endpoint: Record<string, unknown>,
    options?: { requestTimeoutMs?: number },
  ): Promise<{
    request(
      message: Record<string, unknown>,
      timeoutMs?: number,
      transferPlan?: Record<string, unknown>,
    ): Promise<Record<string, unknown>>;
    close(): void;
  }>;
};
const { writeFrame, createFrameParser, createServerAuthSession } =
  require("../../native/remote-transport.cjs") as {
    writeFrame(socket: SocketLike, value: Record<string, unknown>): Promise<void>;
    createFrameParser(options: Record<string, unknown>): { push(chunk: unknown): void };
    createServerAuthSession(options: Record<string, unknown>): {
      authenticated: boolean;
      handle(message: Record<string, unknown>): Promise<boolean>;
      close(): void;
    };
  };

const servers: ServerLike[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

async function startServer(handler: (socket: SocketLike) => void) {
  const server = net.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server did not bind");
  }
  return { kind: "local", connectionOptions: { host: "127.0.0.1", port: address.port } };
}

describe("client transport framing", () => {
  it("requires response IDs instead of matching arbitrary id-less frames", async () => {
    const endpoint = await startServer((socket) => {
      socket.on("data", () => {
        socket.write('{"type":"tool_response","result":{"ok":true}}\n');
      });
    });
    const transport = await openClientTransport(endpoint, { requestTimeoutMs: 20 });
    await expect(transport.request({ type: "tool_request", id: "request-1" })).rejects.toThrow(
      "request timed out",
    );
    transport.close();
  });

  it("settles a tool response only after a preceding download end is renamed", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surf-client-order-"));
    tempDirs.push(stateDir);
    const credentialPath = path.join(stateDir, "client.json");
    remoteAuth.authorizeClient("client", credentialPath, stateDir);
    const endpoint = await startServer((socket) => {
      const auth = createServerAuthSession({
        socket,
        stateDir,
        onAuthenticated: () => undefined,
        onError: () => socket.destroy(),
      });
      const parser = createFrameParser({
        onFrame: async (message: Record<string, unknown>) => {
          if (!auth.authenticated) {
            await auth.handle(message);
            return;
          }
          if (message.type === "tool_request") {
            const bytes = Buffer.from("ordered-download");
            const sha256 = require("node:crypto").createHash("sha256").update(bytes).digest("hex");
            await writeFrame(socket, {
              type: "transfer_begin",
              version: 1,
              direction: "download",
              transferId: "ordered-file",
              size: bytes.length,
              sha256,
            });
            await writeFrame(socket, {
              type: "transfer_chunk",
              version: 1,
              transferId: "ordered-file",
              sequence: 0,
              data: bytes.toString("base64"),
            });
            socket.write(
              `${JSON.stringify({ type: "transfer_end", version: 1, transferId: "ordered-file" })}\n${JSON.stringify({ type: "tool_response", id: message.id, result: { content: [{ type: "text", text: "done" }] } })}\n`,
            );
          }
        },
        onError: () => socket.destroy(),
      });
      socket.on("data", (chunk: unknown) => parser.push(chunk));
    });
    const destination = path.join(stateDir, "received.txt");
    const transport = await openClientTransport({
      kind: "remote",
      connectionOptions: endpoint.connectionOptions,
      credentialPath,
    });
    try {
      const response = await transport.request(
        { type: "tool_request", id: "ordered-request" },
        30000,
        {
          downloads: [
            { transferId: "ordered-file", field: "savePath", original: destination, destination },
          ],
          uploads: [],
          pathRefs: [],
        },
      );
      expect((response as any).result.content[0].text).toBe("done");
      expect(fs.readFileSync(destination, "utf8")).toBe("ordered-download");
    } finally {
      await transport.close();
    }
  });

  it("destroys a remote connection after request timeout and cancels downloads", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surf-client-timeout-"));
    tempDirs.push(stateDir);
    const credentialPath = path.join(stateDir, "client.json");
    remoteAuth.authorizeClient("client", credentialPath, stateDir);
    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const endpoint = await startServer((socket) => {
      socket.once("close", resolveClosed);
      const auth = createServerAuthSession({
        socket,
        stateDir,
        onAuthenticated: () => undefined,
        onError: () => socket.destroy(),
      });
      const parser = createFrameParser({
        onFrame: async (message: Record<string, unknown>) => {
          if (!auth.authenticated) {
            await auth.handle(message);
          }
        },
        onError: () => socket.destroy(),
      });
      socket.on("data", (chunk: unknown) => parser.push(chunk));
    });
    const destination = path.join(stateDir, "timeout.png");
    const transport = await openClientTransport(
      {
        kind: "remote",
        connectionOptions: endpoint.connectionOptions,
        credentialPath,
      },
      { requestTimeoutMs: 20 },
    );
    await expect(
      transport.request({ type: "tool_request", id: "timeout-request" }, 20, {
        uploads: [],
        pathRefs: [],
        downloads: [
          { transferId: "timeout-download", field: "output", original: destination, destination },
        ],
      }),
    ).rejects.toThrow("request timed out");
    await closed;
    expect(fs.existsSync(destination)).toBe(false);
    await expect(transport.request({ type: "tool_request", id: "after-timeout" })).rejects.toThrow(
      /closed/,
    );
    await transport.close();
  });

  it("times out stalled remote upload setup and destroys the connection", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surf-client-upload-timeout-"));
    tempDirs.push(stateDir);
    const credentialPath = path.join(stateDir, "client.json");
    const source = path.join(stateDir, "upload.txt");
    fs.writeFileSync(source, "stalled upload");
    remoteAuth.authorizeClient("client", credentialPath, stateDir);
    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const endpoint = await startServer((socket) => {
      socket.once("close", resolveClosed);
      const auth = createServerAuthSession({
        socket,
        stateDir,
        onAuthenticated: () => undefined,
        onError: () => socket.destroy(),
      });
      const parser = createFrameParser({
        onFrame: async (message: Record<string, unknown>) => {
          if (!auth.authenticated) {
            await auth.handle(message);
          }
        },
        onError: () => socket.destroy(),
      });
      socket.on("data", (chunk: unknown) => parser.push(chunk));
    });
    const transport = await openClientTransport(
      {
        kind: "remote",
        connectionOptions: endpoint.connectionOptions,
        credentialPath,
      },
      { requestTimeoutMs: 20 },
    );
    await expect(
      transport.request({ type: "tool_request", id: "upload-timeout" }, 20, {
        downloads: [],
        pathRefs: [],
        uploads: [{ transferId: "stalled-upload", field: "file", original: source, path: source }],
      }),
    ).rejects.toThrow("request timed out");
    await closed;
    await expect(
      transport.request({ type: "tool_request", id: "after-upload-timeout" }),
    ).rejects.toThrow(/closed/);
    await transport.close();
  });

  it("rejects a clean pre-auth peer close promptly", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surf-client-close-"));
    tempDirs.push(stateDir);
    const credentialPath = path.join(stateDir, "client.json");
    remoteAuth.authorizeClient("client", credentialPath, stateDir);
    const endpoint = await startServer((socket) => {
      socket.on("data", () => socket.destroy());
    });
    const started = Date.now();
    await expect(
      openClientTransport({
        kind: "remote",
        connectionOptions: endpoint.connectionOptions,
        credentialPath,
      }),
    ).rejects.toThrow("closed");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("forwards remote auth failure and closes the endpoint exactly once", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surf-client-transport-"));
    tempDirs.push(stateDir);
    const credentialPath = path.join(stateDir, "client.json");
    remoteAuth.authorizeClient("client", credentialPath, stateDir);
    let closeCount = 0;
    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const endpoint = await startServer((socket) => {
      socket.once("close", () => {
        closeCount += 1;
        resolveClosed();
      });
      socket.on("data", () => {
        writeFrame(socket, { type: "auth_error", message: "rejected" }).catch(() =>
          socket.destroy(),
        );
      });
    });
    const remoteEndpoint = {
      kind: "remote",
      connectionOptions: endpoint.connectionOptions,
      credentialPath,
    };
    await expect(openClientTransport(remoteEndpoint, { requestTimeoutMs: 20 })).rejects.toThrow(
      "rejected",
    );
    await closed;
    expect(closeCount).toBe(1);
  });

  it("rejects pending requests on the extension terminal frame", async () => {
    const endpoint = await startServer((socket) => {
      socket.on("data", () => {
        writeFrame(socket, {
          type: "extension_disconnected",
          message: "extension stopped",
        }).catch(() => socket.destroy());
      });
    });
    const transport = await openClientTransport(endpoint);
    await expect(transport.request({ type: "tool_request", id: "request-1" })).rejects.toThrow(
      "extension stopped",
    );
    transport.close();
  });
});
