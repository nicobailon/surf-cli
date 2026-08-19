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
const remoteAuth = require("../../native/remote-auth.cjs");
const remoteTransport = require("../../native/remote-transport.cjs");

let socketCounter = 0;

function createRemoteCredential() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surf-cli-remote-test-"));
  const credentialPath = path.join(stateDir, "client.json");
  remoteAuth.authorizeClient("test-client", credentialPath, stateDir);
  return { stateDir, credentialPath };
}

function attachAuthenticatedServer(
  socket: any,
  stateDir: string,
  onRequest: (message: any, clientSocket: any) => void,
) {
  socket.on("error", () => undefined);
  const session = remoteTransport.createServerAuthSession({
    socket,
    stateDir,
    onAuthenticated: () => undefined,
    onError: (error: Error) => {
      remoteTransport
        .writeFrame(socket, { type: "auth_error", message: error.message })
        .finally(() => socket.destroy())
        .catch(() => socket.destroy());
    },
  });
  let messageChain = Promise.resolve();
  const parser = remoteTransport.createFrameParser({
    onFrame: (message: any) => {
      messageChain = messageChain
        .then(async () => {
          if (!session.authenticated) {
            await session.handle(message);
            return;
          }
          onRequest(message, socket);
        })
        .catch(() => socket.destroy());
    },
    onError: () => socket.destroy(),
  });
  socket.on("data", (chunk: any) => parser.push(chunk));
  socket.on("close", () => {
    parser.close();
    session.close();
  });
}

function createSocketPath() {
  socketCounter++;
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\surf-test-${process.pid}-${socketCounter}`;
  }

  return path.join(os.tmpdir(), `surf-${process.pid}-${socketCounter}.sock`);
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

function createCliEnv(socketPath?: string) {
  const env = { ...process.env };
  env.SURF_NO_LOCK = undefined;
  env.SURF_LOCK_TIMEOUT_MS = undefined;
  env.SURF_REMOTE = undefined;
  env.SURF_SESSION = undefined;

  if (socketPath) {
    env.SURF_SOCKET = socketPath;
  } else {
    env.SURF_SOCKET = undefined;
    env.SURF_SOCKET_PATH = undefined;
  }

  return env;
}

function runCliWithoutSocket(
  args: string[],
  overrides: Record<string, string | undefined> = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const child = spawn(process.execPath, ["native/cli.cjs", ...args], {
      cwd: process.cwd(),
      env: { ...createCliEnv(), ...overrides },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk: { toString(): string }) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: { toString(): string }) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code: number | null) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function createCliFixtureResult(request: any) {
  if (request.params.tool === "network.export") {
    fs.writeFileSync(request.params.args.output, "[]");
    return { path: request.params.args.output, format: "json", count: 0 };
  }
  if (request.params.tool === "screenshot") {
    return {
      base64: require("node:buffer").Buffer.from("local-screenshot").toString("base64"),
      width: 1,
      height: 1,
    };
  }
  if (request.params.tool === "page.html" || request.params.tool === "page.save") {
    return { html: "<!doctype html>\n<html><body>Rendered</body></html>" };
  }
  return "OK";
}

function runCli(
  args: string[],
  extraEnv: Record<string, string | undefined> = {},
): Promise<{ request: any; stdout: string; stderr: string }> {
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
        const result = createCliFixtureResult(request);
        socket.write(
          `${JSON.stringify({ id: request.id, result: { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }] } })}\n`,
        );
        socket.end();
      });
    });

    server.on("error", reject);
    server.listen(socketPath, () => {
      const child = spawn(process.execPath, ["native/cli.cjs", ...args], {
        cwd: process.cwd(),
        env: { ...createCliEnv(socketPath), ...extraEnv },
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

function spawnCliWithSocket(
  args: string[],
  socketPath: string,
  extraEnv: Record<string, string | undefined> = {},
) {
  let stdout = "";
  let stderr = "";
  const child = spawn(process.execPath, ["native/cli.cjs", ...args], {
    cwd: process.cwd(),
    env: { ...createCliEnv(socketPath), ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk: { toString(): string }) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: { toString(): string }) => {
    stderr += chunk.toString();
  });

  return {
    done: new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code: number | null) => resolve({ code, stdout, stderr }));
      },
    ),
  };
}

function waitFor<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), ms),
    ),
  ]);
}

describe("CLI argument parsing", () => {
  it("prints LLM context without requiring a socket", async () => {
    const { code, stdout, stderr } = await runCliWithoutSocket(["--llm-context"]);

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("SURF CLI LLM CONTEXT");
    expect(stdout).toContain("surf page.read --depth 3 --compact");
    expect(stdout).toContain("surf click e5");
    expect(stdout).toContain("surf screenshot --full-page /tmp/full.png");
    expect(stdout).toContain("surf record --duration 2000 --fps 10 --output /tmp/anim.gif");
    expect(stdout).toContain(
      'surf perf-audit --duration 3000 --trigger "click:.cta" --output /tmp/perf.json',
    );
    expect(stdout).toContain("surf scroll down 800");
    expect(stdout).toContain("surf cookie list");
    expect(stdout).toContain("surf resize 375 812");
  });

  it("mentions LLM context in top-level help", async () => {
    const { code, stdout, stderr } = await runCliWithoutSocket(["--help"]);

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("surf --llm-context");
    expect(stdout).toContain("--remote <host>:<port>");
  });

  it("shows page.html command help without a socket", async () => {
    const { code, stdout, stderr } = await runCliWithoutSocket(["page.html", "--help"]);

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("page.html - Print rendered document HTML");
  });

  it("keeps remote credential management local when remote routing is configured", async () => {
    const credential = createRemoteCredential();
    const result = await runCliWithoutSocket(["remote", "list"], {
      SURF_REMOTE: "127.0.0.1:1",
      SURF_REMOTE_CREDENTIAL: undefined,
      SURF_REMOTE_STATE_DIR: credential.stateDir,
    });
    fs.rmSync(credential.stateDir, { recursive: true, force: true });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("test-client");
  });

  it("rejects remote record before attempting a connection", async () => {
    const credential = createRemoteCredential();
    const result = await runCliWithoutSocket([
      "record",
      "--remote",
      "browser.tailnet:4321",
      "--remote-credential",
      credential.credentialPath,
    ]);
    fs.rmSync(credential.stateDir, { recursive: true, force: true });

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "record is not supported with remote endpoint browser.tailnet:4321",
    );
    expect(result.stderr).not.toContain("/tmp/surf.sock");
  });

  it("rejects remote playbook catalog before attempting a connection", async () => {
    const credential = createRemoteCredential();
    const result = await runCliWithoutSocket([
      "pb",
      "list",
      "--remote",
      "browser.tailnet:4321",
      "--remote-credential",
      credential.credentialPath,
    ]);
    fs.rmSync(credential.stateDir, { recursive: true, force: true });

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("playbook list is local-only with --remote");
    expect(result.stderr).not.toContain("/tmp/surf.sock");
  });

  it("routes normal, script, and workflow requests to TCP remote without forwarding --remote", async () => {
    const requests: any[] = [];
    const connections = new Set<any>();
    const credential = createRemoteCredential();
    const server = net.createServer((socket: any) =>
      attachAuthenticatedServer(socket, credential.stateDir, (request: any, client: any) => {
        requests.push(request);
        connections.add(client);
        remoteTransport.writeFrame(client, {
          id: request.id,
          result: { content: [{ type: "text", text: "OK" }] },
        });
      }),
    );
    await new Promise<void>((resolve, reject) => {
      server.on("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const port = (server.address() as any).port;
    const remote = `127.0.0.1:${port}`;
    const scriptPath = path.join(
      os.tmpdir(),
      `surf-remote-script-${process.pid}-${Date.now()}.json`,
    );
    fs.writeFileSync(
      scriptPath,
      JSON.stringify({ steps: [{ tool: "page.state" }, { tool: "page.text" }] }),
    );
    const invoke = (args: string[]) =>
      new Promise<number | null>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "native/cli.cjs",
            ...args,
            "--remote",
            remote,
            "--remote-credential",
            credential.credentialPath,
            "--no-lock",
          ],
          {
            cwd: process.cwd(),
            env: createCliEnv(),
            stdio: ["ignore", "ignore", "pipe"],
          },
        );
        child.on("error", reject);
        child.on("close", resolve);
      });
    try {
      expect(await invoke(["page.read"])).toBe(0);
      expect(await invoke(["--script", scriptPath])).toBe(0);
      expect(await invoke(["do", "page.text\npage.state"])).toBe(0);
      expect(requests.map((request) => request.params.tool)).toEqual([
        "page.read",
        "page.state",
        "page.text",
        "page.text",
        "page.state",
      ]);
      expect(connections.size).toBe(3);
      expect(requests.every((request) => request.params.args.remote === undefined)).toBe(true);
    } finally {
      fs.rmSync(scriptPath, { force: true });
      fs.rmSync(credential.stateDir, { recursive: true, force: true });
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("generates a local network-export output when omitted", async () => {
    const { request, stdout } = await runCli(["network.export"]);
    expect(request.params.tool).toBe("network.export");
    expect(request.params.args.output).toMatch(/\.json$/);
    expect(path.isAbsolute(request.params.args.output)).toBe(true);
    expect(fs.readFileSync(request.params.args.output, "utf8")).toBe("[]");
    expect(stdout).toContain(request.params.args.output);
    fs.rmSync(request.params.args.output, { force: true });
  });

  it("preserves network-path for host-side persistence", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "surf-network-path-"));
    const { request } = await runCli(["network", "--network-path", directory]);
    expect(request.params.tool).toBe("network");
    expect(request.params.args["network-path"]).toBe(directory);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("writes local-prefixed screenshot output to the normalized path", async () => {
    const output = path.join(os.tmpdir(), `surf-local-screenshot-${process.pid}-${Date.now()}.png`);
    try {
      const { request } = await runCli(["screenshot", "--output", `local:${output}`]);
      expect(request.params.args.savePath).toBe(output);
      expect(fs.readFileSync(output, "utf8")).toBe("local-screenshot");
    } finally {
      fs.rmSync(output, { force: true });
    }
  });

  it("preserves direct remote provider and network paths through CLI preprocessing", async () => {
    const requests: any[] = [];
    const credential = createRemoteCredential();
    const server = net.createServer((socket: any) =>
      attachAuthenticatedServer(socket, credential.stateDir, (request: any, client: any) => {
        requests.push(request);
        remoteTransport.writeFrame(client, {
          id: request.id,
          result: { content: [{ type: "text", text: "OK" }] },
        });
      }),
    );
    await new Promise<void>((resolve, reject) => {
      server.on("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const remote = `127.0.0.1:${(server.address() as any).port}`;
    const invoke = (args: string[]) =>
      new Promise<number | null>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "native/cli.cjs",
            ...args,
            "--remote",
            remote,
            "--remote-credential",
            credential.credentialPath,
          ],
          { cwd: process.cwd(), env: createCliEnv(), stdio: ["ignore", "ignore", "pipe"] },
        );
        child.on("error", reject);
        child.on("close", resolve);
      });
    try {
      expect(await invoke(["chatgpt", "q", "--file", "remote:/tmp/input.txt"])).toBe(0);
      expect(
        await invoke([
          "gemini",
          "edit",
          "--edit-image",
          "remote:/tmp/in.png",
          "--output",
          "remote:/tmp/out.png",
        ]),
      ).toBe(0);
      expect(await invoke(["network.export", "--output", "remote:/tmp/network.json"])).toBe(0);
      expect(requests[0].params.args.file).toBe("remote:/tmp/input.txt");
      expect(requests[1].params.args["edit-image"]).toBe("remote:/tmp/in.png");
      expect(requests[1].params.args.output).toBe("remote:/tmp/out.png");
      expect(requests[2].params.args.output).toBe("remote:/tmp/network.json");
    } finally {
      fs.rmSync(credential.stateDir, { recursive: true, force: true });
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("auto-captures a remote primary error through a normal screenshot transfer", async () => {
    const credential = createRemoteCredential();
    const captureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "surf-cli-auto-capture-"));
    const server = net.createServer((socket: any) => {
      const writeFrame = (message: any) => remoteTransport.writeFrame(socket, message);
      const toolHandlers: Record<string, (message: any) => Promise<void>> = {
        "page.text": async (message) => {
          await writeFrame({
            id: message.id,
            error: { content: [{ type: "text", text: "primary failure" }] },
          });
        },
        console: async (message) => {
          await writeFrame({
            id: message.id,
            result: { content: [{ type: "text", text: JSON.stringify({ messages: [] }) }] },
          });
        },
        screenshot: async (message) => {
          const download = message._surfTransfers?.downloads?.[0];
          const bytes = require("node:buffer").Buffer.from("remote-auto-capture");
          const sha256 = require("node:crypto").createHash("sha256").update(bytes).digest("hex");
          await writeFrame({
            type: "transfer_begin",
            version: 1,
            direction: "download",
            transferId: download.transferId,
            size: bytes.length,
            sha256,
          });
          await writeFrame({
            type: "transfer_chunk",
            version: 1,
            transferId: download.transferId,
            sequence: 0,
            data: bytes.toString("base64"),
          });
          await writeFrame({
            type: "transfer_end",
            version: 1,
            transferId: download.transferId,
          });
          await writeFrame({
            id: message.id,
            result: { content: [{ type: "text", text: "screenshot transferred" }] },
          });
        },
      };
      const auth = remoteTransport.createServerAuthSession({
        socket,
        stateDir: credential.stateDir,
        onAuthenticated: () => undefined,
        onError: () => socket.destroy(),
      });
      const parser = remoteTransport.createFrameParser({
        onFrame: async (message: any) => {
          if (!auth.authenticated) {
            await auth.handle(message);
            return;
          }
          const handler =
            message.type === "tool_request" ? toolHandlers[message.params?.tool] : null;
          await handler?.(message);
        },
        onError: () => socket.destroy(),
      });
      socket.on("data", (chunk: any) => parser.push(chunk));
    });
    await new Promise<void>((resolve, reject) => {
      server.on("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const remote = `127.0.0.1:${(server.address() as any).port}`;
    const child = spawn(
      process.execPath,
      [
        "native/cli.cjs",
        "page.text",
        "--auto-capture",
        "--remote",
        remote,
        "--remote-credential",
        credential.credentialPath,
      ],
      {
        cwd: process.cwd(),
        env: { ...createCliEnv(), SURF_TMP: captureRoot },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: { toString(): string }) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: { toString(): string }) => {
      stderr += chunk.toString();
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    try {
      expect(code).toBe(1);
      expect(stderr).toContain("Auto-captured:");
      expect(stderr).not.toContain("surf-transfer-");
      const captures = fs
        .readdirSync(captureRoot)
        .filter((entry: string) => entry.startsWith("surf-error-") && entry.endsWith(".png"));
      expect(captures).toHaveLength(1);
      expect(fs.readFileSync(path.join(captureRoot, captures[0]), "utf8")).toBe(
        "remote-auto-capture",
      );
      expect(stdout).toBe("");
    } finally {
      fs.rmSync(captureRoot, { recursive: true, force: true });
      fs.rmSync(credential.stateDir, { recursive: true, force: true });
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("sends stream requests over the selected TCP endpoint without forwarding remote", async () => {
    let request: any;
    let receivedRequest!: () => void;
    const requestReceived = new Promise<void>((resolve) => {
      receivedRequest = resolve;
    });
    const credential = createRemoteCredential();
    const server = net.createServer((socket: any) =>
      attachAuthenticatedServer(socket, credential.stateDir, (message: any, client: any) => {
        request = message;
        receivedRequest();
        remoteTransport.writeFrame(client, { type: "stream_started" }).catch(() => undefined);
      }),
    );
    await new Promise<void>((resolve, reject) => {
      server.on("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const remote = `127.0.0.1:${(server.address() as any).port}`;
    const child = spawn(
      process.execPath,
      [
        "native/cli.cjs",
        "console",
        "--stream",
        "--remote",
        remote,
        "--remote-credential",
        credential.credentialPath,
        "--no-lock",
      ],
      {
        cwd: process.cwd(),
        env: createCliEnv(),
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    try {
      await waitFor(requestReceived, 1000, "stream request");
      expect(request).toMatchObject({ type: "stream_request", streamType: "STREAM_CONSOLE" });
      expect(JSON.stringify(request)).not.toContain("remote");
    } finally {
      child.kill("SIGINT");
      await new Promise<void>((resolve) => child.once("close", () => resolve()));
      fs.rmSync(credential.stateDir, { recursive: true, force: true });
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("routes MCP tool calls over the selected TCP endpoint", async () => {
    let request: any;
    let receivedRequest!: () => void;
    const requestReceived = new Promise<void>((resolve) => {
      receivedRequest = resolve;
    });
    const credential = createRemoteCredential();
    const server = net.createServer((socket: any) =>
      attachAuthenticatedServer(socket, credential.stateDir, (message: any, client: any) => {
        request = message;
        receivedRequest();
        remoteTransport
          .writeFrame(client, {
            id: message.id,
            result: { content: [{ type: "text", text: "OK" }] },
          })
          .finally(() => client.end())
          .catch(() => client.end());
      }),
    );
    await new Promise<void>((resolve, reject) => {
      server.on("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const remote = `127.0.0.1:${(server.address() as any).port}`;
    const child = spawn(
      process.execPath,
      [
        "native/cli.cjs",
        "server",
        "--remote",
        remote,
        "--remote-credential",
        credential.credentialPath,
      ],
      {
        cwd: process.cwd(),
        env: createCliEnv(),
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let initialized!: () => void;
    const initializationComplete = new Promise<void>((resolve) => {
      initialized = resolve;
    });
    let completed!: () => void;
    const toolCallComplete = new Promise<void>((resolve) => {
      completed = resolve;
    });
    child.stdout.on("data", (chunk: { toString(): string }) => {
      const output = chunk.toString();
      if (output.includes('"id":1')) {
        initialized();
      }
      if (output.includes('"id":2')) {
        completed();
      }
    });
    const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
    try {
      send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      });
      await waitFor(initializationComplete, 1000, "MCP initialization");
      send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "page.text", arguments: {} },
      });
      await waitFor(requestReceived, 1000, "MCP TCP request");
      expect(request.params.tool).toBe("page.text");
      expect(JSON.stringify(request)).not.toContain("remote");
      await waitFor(toolCallComplete, 1000, "MCP tool response");
    } finally {
      child.stdin.end();
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => child.once("close", () => resolve()));
      fs.rmSync(credential.stateDir, { recursive: true, force: true });
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

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

  it("preserves zoom level flags", async () => {
    const { request } = await runCli(["zoom", "--level", "1.5"]);

    expect(request.params.tool).toBe("zoom");
    expect(request.params.args.level).toBe(1.5);
  });

  it("maps tab.move positional tab id and destination window", async () => {
    const { request } = await runCli(["tab.move", "123", "--to-window", "456", "--index", "0"]);

    expect(request.params.tool).toBe("tab.move");
    expect(request.params.args).toMatchObject({ id: 123, "to-window": 456, index: 0 });
  });

  it("preserves page.read max-bytes", async () => {
    const { request } = await runCli(["page.read", "--compact", "--max-bytes", "1200"]);

    expect(request.params.tool).toBe("page.read");
    expect(request.params.args).toMatchObject({ compact: true, "max-bytes": 1200 });
  });

  it("requests and prints rendered page HTML", async () => {
    const { request, stdout } = await runCli([
      "page.html",
      "--selector",
      "#artifact",
      "--strip-scripts",
    ]);

    expect(request.params.tool).toBe("page.html");
    expect(request.params.args).toEqual({ selector: "#artifact", "strip-scripts": true });
    expect(stdout).toBe("<!doctype html>\n<html><body>Rendered</body></html>\n");
  });

  it("saves rendered page HTML through the page HTML tool", async () => {
    const output = path.join(os.tmpdir(), `surf-page-save-${process.pid}-${Date.now()}.html`);
    try {
      const { request, stdout } = await runCli([
        "page.save",
        "--selector",
        "#artifact",
        "--strip-scripts",
        "--output",
        output,
      ]);
      expect(request.params.tool).toBe("page.save");
      expect(request.params.args).toEqual({ selector: "#artifact", "strip-scripts": true });
      expect(fs.readFileSync(output, "utf8")).toBe(
        "<!doctype html>\n<html><body>Rendered</body></html>",
      );
      expect(stdout).toContain(`Saved rendered page HTML to ${output}`);
    } finally {
      fs.rmSync(output, { force: true });
    }
  });

  it("rejects explicit CDP typing with selector targets", async () => {
    const { code, stderr } = await runCliWithoutSocket([
      "type",
      "hello",
      "--into",
      "#target",
      "--method",
      "cdp",
    ]);

    expect(code).toBe(1);
    expect(stderr).toContain("--method cdp types at the current focus");
  });

  it("rejects explicit CDP method on smart_type", async () => {
    const { code, stderr } = await runCliWithoutSocket([
      "smart_type",
      "--selector",
      "#target",
      "--text",
      "hello",
      "--method",
      "cdp",
    ]);

    expect(code).toBe(1);
    expect(stderr).toContain("smart_type uses the JS input path");
  });

  it("keeps ref typing on the frame-aware form path with --method js", async () => {
    const { request } = await runCli(["type", "hello", "--ref", "e1", "--method", "js"]);

    expect(request.params.tool).toBe("type");
    expect(request.params.args).toMatchObject({ text: "hello", ref: "e1" });
  });

  it("does not map emulate.viewport positional values to width and height", async () => {
    const { request } = await runCli(["emulate.viewport", "375", "812"]);

    expect(request.params.tool).toBe("emulate.viewport");
    expect(request.params.args).not.toHaveProperty("width");
    expect(request.params.args).not.toHaveProperty("height");
  });

  it("resolves ChatGPT file paths before sending to the native host", async () => {
    const { request } = await runCli(["chatgpt", "summarize", "--file", "fixtures/report.txt"]);

    expect(request.params.tool).toBe("chatgpt");
    expect(request.params.args.file).toBe(path.resolve("fixtures/report.txt"));
  });

  it("parses idempotent session.ensure in dotted and spaced forms", async () => {
    const dotted = await runCli(["session.ensure", "research", "about:blank"]);
    expect(dotted.request.params).toEqual({
      tool: "session.ensure",
      args: { name: "research", url: "about:blank" },
    });

    const spaced = await runCli(["session", "ensure", "scout", "https://example.com/"]);
    expect(spaced.request.params).toEqual({
      tool: "session.ensure",
      args: { name: "scout", url: "https://example.com/" },
    });
  });

  it("sends explicit session selection and no-wait admission outside tool args", async () => {
    const { request } = await runCli(["--session", "research", "page.read", "--no-wait"]);

    expect(request).toMatchObject({
      session: "research",
      sessionSource: "explicit",
      admission: { wait: false },
      params: { tool: "page.read", args: {} },
    });
  });

  it("uses SURF_SESSION only for default-tab tools and lets explicit tabs override it", async () => {
    const selected = await runCli(["page.read"], { SURF_SESSION: "research" });
    expect(selected.request).toMatchObject({ session: "research", sessionSource: "environment" });

    const explicitTab = await runCli(["page.read", "--tab-id", "42"], { SURF_SESSION: "research" });
    expect(explicitTab.request.tabId).toBe(42);
    expect(explicitTab.request).not.toHaveProperty("session");
  });

  it("keeps batch workflows bound to SURF_SESSION", async () => {
    const selected = await runCli(
      [
        "batch",
        "--actions",
        '[{"type":"frame.switch","index":0},{"type":"click","selector":"#pay"}]',
      ],
      { SURF_SESSION: "research" },
    );

    expect(selected.request).toMatchObject({
      session: "research",
      sessionSource: "environment",
      params: {
        tool: "batch",
        args: {
          actions: [
            { type: "frame.switch", index: 0 },
            { type: "click", selector: "#pay" },
          ],
        },
      },
    });
  });

  it("keeps a no-ID tab.close bound to SURF_SESSION", async () => {
    const selected = await runCli(["tab.close"], { SURF_SESSION: "research" });
    expect(selected.request).toMatchObject({
      session: "research",
      sessionSource: "environment",
      params: { tool: "tab.close", args: {} },
    });
  });

  it("does not apply SURF_SESSION to an explicit tab.close target", async () => {
    const selected = await runCli(["tab.close", "42"], { SURF_SESSION: "research" });
    expect(selected.request).not.toHaveProperty("session");
    expect(selected.request.params).toMatchObject({ tool: "tab.close", args: { id: 42 } });
  });

  it("rejects --session on browser-global commands", async () => {
    const result = await runCliWithoutSocket(["--session", "research", "tab.list"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--session does not apply to tab.list");
  });

  it("warns before provider tools request exclusive browser access", async () => {
    const { stderr } = await runCli(["--session", "research", "chatgpt", "hello"]);
    expect(stderr).toContain("requires exclusive browser access");
    expect(stderr).toContain("Session research remains selected");
  });

  it("propagates session selection and no-wait to script and do workflows", async () => {
    const scriptPath = path.join(
      os.tmpdir(),
      `surf-session-script-${process.pid}-${Date.now()}.json`,
    );
    fs.writeFileSync(scriptPath, JSON.stringify({ steps: [{ tool: "page.state" }] }));
    try {
      const script = await runCli(["--script", scriptPath, "--session", "research", "--no-wait"]);
      expect(script.request).toMatchObject({
        session: "research",
        sessionSource: "explicit",
        admission: { wait: false },
        params: { tool: "page.state" },
      });

      const workflow = await runCli(["do", "page.state", "--session", "research", "--no-wait"]);
      expect(workflow.request).toMatchObject({
        session: "research",
        sessionSource: "explicit",
        admission: { wait: false },
        params: { tool: "page.state" },
      });
    } finally {
      fs.rmSync(scriptPath, { force: true });
    }
  });

  it("propagates session selection and no-wait to playbook runs", async () => {
    const result = await runCli(["use", "page", "read", "--session", "research", "--no-wait"]);

    expect(result.request).toMatchObject({
      session: "research",
      sessionSource: "explicit",
      admission: { wait: false },
      params: {
        tool: "playbook.run",
        args: { playbook: "page", op: "read" },
      },
    });
  });

  it("lets ordinary one-shot requests reach the host concurrently", async () => {
    const socketPath = createSocketPath();
    cleanupSocket(socketPath);
    let requestCount = 0;
    let firstRequestAt = 0;
    let secondRequestAt = 0;
    let resolveFirstRequest!: () => void;
    let resolveSecondRequest!: () => void;
    const firstRequest = new Promise<void>((resolve) => {
      resolveFirstRequest = resolve;
    });
    const secondRequest = new Promise<void>((resolve) => {
      resolveSecondRequest = resolve;
    });

    const server = net.createServer((socket: any) => {
      let buffer = "";
      socket.on("data", (chunk: { toString(): string }) => {
        buffer += chunk.toString();
        const lineEnd = buffer.indexOf("\n");
        if (lineEnd === -1) {
          return;
        }

        const request = JSON.parse(buffer.slice(0, lineEnd));
        requestCount++;
        if (requestCount === 1) {
          firstRequestAt = Date.now();
          resolveFirstRequest();
          setTimeout(() => {
            socket.write(
              `${JSON.stringify({ id: request.id, result: { content: [{ type: "text", text: "first" }] } })}\n`,
            );
            socket.end();
          }, 250);
          return;
        }

        secondRequestAt = Date.now();
        resolveSecondRequest();
        socket.write(
          `${JSON.stringify({ id: request.id, result: { content: [{ type: "text", text: "second" }] } })}\n`,
        );
        socket.end();
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.on("error", reject);
      server.listen(socketPath, resolve);
    });

    try {
      const first = spawnCliWithSocket(["page.text"], socketPath);
      await waitFor(firstRequest, 1000, "first request");
      const second = spawnCliWithSocket(["page.state"], socketPath);
      await waitFor(secondRequest, 200, "second concurrent request");
      const [firstDone, secondDone] = await Promise.all([first.done, second.done]);

      expect(firstDone.code).toBe(0);
      expect(secondDone.code).toBe(0);
      expect(requestCount).toBe(2);
      expect(secondRequestAt - firstRequestAt).toBeLessThan(200);
    } finally {
      server.close();
      cleanupSocket(socketPath);
    }
  });

  for (const workflowCase of [
    {
      name: "--script",
      args: () => {
        const scriptPath = path.join(os.tmpdir(), `surf-script-${process.pid}-${Date.now()}.json`);
        fs.writeFileSync(scriptPath, JSON.stringify({ steps: [{ tool: "page.state" }] }));
        return { args: ["--script", scriptPath], cleanup: () => fs.unlinkSync(scriptPath) };
      },
    },
    {
      name: "surf do",
      args: () => ({ args: ["do", "page.state"], cleanup: () => undefined }),
    },
  ]) {
    it(`lets ${workflowCase.name} requests reach the host scheduler concurrently`, async () => {
      const socketPath = createSocketPath();
      cleanupSocket(socketPath);
      const workflow = workflowCase.args();
      let requestCount = 0;
      let firstRequestAt = 0;
      let secondRequestAt = 0;
      let resolveFirstRequest!: () => void;
      let resolveSecondRequest!: () => void;
      const firstRequest = new Promise<void>((resolve) => {
        resolveFirstRequest = resolve;
      });
      const secondRequest = new Promise<void>((resolve) => {
        resolveSecondRequest = resolve;
      });

      const server = net.createServer((socket: any) => {
        let buffer = "";
        socket.on("data", (chunk: { toString(): string }) => {
          buffer += chunk.toString();
          const lineEnd = buffer.indexOf("\n");
          if (lineEnd === -1) {
            return;
          }

          const request = JSON.parse(buffer.slice(0, lineEnd));
          buffer = buffer.slice(lineEnd + 1);
          requestCount++;
          if (requestCount === 1) {
            firstRequestAt = Date.now();
            resolveFirstRequest();
            setTimeout(() => {
              socket.write(
                `${JSON.stringify({ id: request.id, result: { content: [{ type: "text", text: "first" }] } })}\n`,
              );
              socket.end();
            }, 250);
            return;
          }

          secondRequestAt = Date.now();
          resolveSecondRequest();
          socket.write(
            `${JSON.stringify({ id: request.id, result: { content: [{ type: "text", text: "second" }] } })}\n`,
          );
          socket.end();
        });
      });

      await new Promise<void>((resolve, reject) => {
        server.on("error", reject);
        server.listen(socketPath, resolve);
      });

      try {
        const first = spawnCliWithSocket(["page.text"], socketPath);
        await waitFor(firstRequest, 1000, "first request");
        const second = spawnCliWithSocket(workflow.args, socketPath);
        await waitFor(secondRequest, 200, "second concurrent request");
        const [firstDone, secondDone] = await Promise.all([first.done, second.done]);

        expect(firstDone.code).toBe(0);
        expect(secondDone.code).toBe(0);
        expect(requestCount).toBe(2);
        expect(secondRequestAt - firstRequestAt).toBeLessThan(200);
      } finally {
        server.close();
        cleanupSocket(socketPath);
        workflow.cleanup();
      }
    });
  }

  it("records screenshot frames into a GIF", async () => {
    const socketPath = createSocketPath();
    cleanupSocket(socketPath);
    const outputPath = path.join(os.tmpdir(), `surf-record-${process.pid}-${Date.now()}.gif`);
    const magickDir = fs.mkdtempSync(path.join(os.tmpdir(), "surf-magick-"));
    const magickPath = path.join(magickDir, "magick");
    fs.writeFileSync(magickPath, '#!/bin/sh\nfor last do :; done\nprintf "GIF89a" > "$last"\n');
    fs.chmodSync(magickPath, 0o755);

    const requests: any[] = [];
    const server = net.createServer((socket: any) => {
      let buffer = "";
      socket.on("data", (chunk: { toString(): string }) => {
        buffer += chunk.toString();
        const lineEnd = buffer.indexOf("\n");
        if (lineEnd === -1) {
          return;
        }

        const request = JSON.parse(buffer.slice(0, lineEnd));
        requests.push(request);
        socket.write(
          `${JSON.stringify({ id: request.id, result: { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] } })}\n`,
        );
        socket.end();
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.on("error", reject);
      server.listen(socketPath, resolve);
    });

    try {
      const child = spawnCliWithSocket(
        [
          "record",
          "--duration",
          "200",
          "--fps",
          "10",
          "--trigger",
          "click:#go",
          "--rect",
          "0,10,200,100",
          "--output",
          outputPath,
          "--json",
        ],
        socketPath,
        { PATH: `${magickDir}${path.delimiter}${process.env.PATH || ""}` },
      );
      const done = await waitFor(child.done, 3000, "record command");

      expect(done.code).toBe(0);
      expect(done.stderr).toBe("");
      expect(fs.readFileSync(outputPath, "utf8")).toBe("GIF89a");
      const summary = JSON.parse(done.stdout);
      expect(summary).toMatchObject({ output: outputPath, frames: 2, durationMs: 200, fps: 10 });
      expect(summary.trigger).toEqual({ action: "click", selector: "#go" });
      expect(summary.rect).toEqual({ x: 0, y: 10, width: 200, height: 100 });
      expect(requests.map((request) => request.params.tool)).toEqual([
        "click",
        "screenshot",
        "screenshot",
      ]);
      expect(requests[0].params.args.selector).toBe("#go");
      expect(requests[1].params.args.savePath).toContain("frame-0000.png");
      expect(requests[2].params.args.savePath).toContain("frame-0001.png");
    } finally {
      server.close();
      cleanupSocket(socketPath);
      fs.rmSync(magickDir, { recursive: true, force: true });
      fs.rmSync(outputPath, { force: true });
    }
  });

  it("saves perf-audit JSON output", async () => {
    const socketPath = createSocketPath();
    cleanupSocket(socketPath);
    const outputPath = path.join(os.tmpdir(), `surf-perf-${process.pid}-${Date.now()}.json`);
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
          `${JSON.stringify({
            id: request.id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    durationMs: 300,
                    summary: { cumulativeLayoutShift: 0.1 },
                    entries: { layoutShifts: [] },
                  }),
                },
              ],
            },
          })}\n`,
        );
        socket.end();
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.on("error", reject);
      server.listen(socketPath, resolve);
    });

    try {
      const child = spawnCliWithSocket(
        ["perf-audit", "--duration", "300", "--trigger", "click:.cta", "--output", outputPath],
        socketPath,
      );
      const done = await waitFor(child.done, 3000, "perf-audit command");

      expect(done.code).toBe(0);
      expect(done.stderr).toBe("");
      expect(done.stdout).toContain(`Saved perf audit to ${outputPath}`);
      expect(request.params).toMatchObject({
        tool: "perf-audit",
        args: { duration: 300, trigger: "click:.cta" },
      });
      expect(JSON.parse(fs.readFileSync(outputPath, "utf8"))).toMatchObject({
        durationMs: 300,
        summary: { cumulativeLayoutShift: 0.1 },
      });
    } finally {
      server.close();
      cleanupSocket(socketPath);
      fs.rmSync(outputPath, { force: true });
    }
  });

  it("allows --no-lock to bypass a held browser lock", async () => {
    const socketPath = createSocketPath();
    cleanupSocket(socketPath);
    let requestCount = 0;
    let resolveFirstRequest!: () => void;
    let resolveSecondRequest!: () => void;
    const firstRequest = new Promise<void>((resolve) => {
      resolveFirstRequest = resolve;
    });
    const secondRequest = new Promise<void>((resolve) => {
      resolveSecondRequest = resolve;
    });

    const server = net.createServer((socket: any) => {
      let buffer = "";
      socket.on("data", (chunk: { toString(): string }) => {
        buffer += chunk.toString();
        const lineEnd = buffer.indexOf("\n");
        if (lineEnd === -1) {
          return;
        }

        const request = JSON.parse(buffer.slice(0, lineEnd));
        buffer = buffer.slice(lineEnd + 1);
        requestCount++;
        if (requestCount === 1) {
          resolveFirstRequest();
          setTimeout(() => {
            socket.write(
              `${JSON.stringify({ id: request.id, result: { content: [{ type: "text", text: "first" }] } })}\n`,
            );
            socket.end();
          }, 300);
          return;
        }

        resolveSecondRequest();
        socket.write(
          `${JSON.stringify({ id: request.id, result: { content: [{ type: "text", text: "second" }] } })}\n`,
        );
        socket.end();
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.on("error", reject);
      server.listen(socketPath, resolve);
    });

    try {
      const first = spawnCliWithSocket(["page.text"], socketPath);
      await waitFor(firstRequest, 1000, "first request");
      const second = spawnCliWithSocket(["page.state", "--no-lock"], socketPath);
      await waitFor(secondRequest, 200, "second no-lock request");
      const [firstDone, secondDone] = await Promise.all([first.done, second.done]);

      expect(firstDone.code).toBe(0);
      expect(secondDone.code).toBe(0);
      expect(requestCount).toBe(2);
    } finally {
      server.close();
      cleanupSocket(socketPath);
    }
  });
});
