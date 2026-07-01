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
declare function clearTimeout(timeoutId: unknown): void;
declare function setTimeout(callback: () => void, ms: number): unknown;

type BufferLike = {
  length: number;
  readUInt32LE(offset: number): number;
  slice(start: number, end?: number): BufferLike;
  toString(encoding?: string): string;
  write(value: string, offset?: number): number;
  writeUInt32LE(value: number, offset: number): number;
};

type EventEmitterLike = {
  on(event: string, listener: (...args: unknown[]) => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
};

type WritableLike = EventEmitterLike & {
  end(): void;
  write(data: string | BufferLike): boolean;
};

type ReadableLike = EventEmitterLike;

type ChildProcessLike = EventEmitterLike & {
  pid?: number;
  stdin: WritableLike;
  stdout: ReadableLike;
  stderr: ReadableLike;
  kill(signal: string): void;
};

type NativeMessage = {
  id?: number;
  type?: string;
  url?: string;
  tabId?: number;
  options?: {
    filter?: string;
    includeText?: boolean;
    depth?: number;
    compact?: boolean;
  };
  savePath?: string;
  annotate?: boolean;
  fullpage?: boolean;
};

type CliResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

type MessageWaiter = {
  predicate: (message: NativeMessage) => boolean;
  resolve: (message: NativeMessage) => void;
  reject: (error: Error) => void;
  timeout: unknown;
};

const { spawn } = require("node:child_process") as {
  spawn: (command: string, args: string[], options: Record<string, unknown>) => ChildProcessLike;
};
const fs = require("node:fs") as {
  mkdtempSync(prefix: string): string;
  rmSync(targetPath: string, options: { recursive: boolean; force: boolean }): void;
};
const os = require("node:os") as { tmpdir(): string };
const path = require("node:path") as { join(...paths: string[]): string };
const { Buffer: BufferCtor } = require("node:buffer") as {
  Buffer: {
    alloc(size: number): BufferLike;
    byteLength(value: string): number;
    concat(chunks: BufferLike[]): BufferLike;
    from(value: string, encoding?: string): BufferLike;
  };
};

const tempDirs: string[] = [];
const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

function createSocketPath() {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\surf-e2e-contract-${process.pid}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "surf-e2e-contract-"));
  tempDirs.push(tempDir);
  return path.join(tempDir, "surf.sock");
}

function writeNativeMessage(stdin: WritableLike, message: NativeMessage) {
  const json = JSON.stringify(message);
  const header = BufferCtor.alloc(4);
  header.writeUInt32LE(BufferCtor.byteLength(json), 0);
  stdin.write(BufferCtor.concat([header, BufferCtor.from(json, "utf8")]));
}

function buildExtensionResponse(message: NativeMessage, currentUrl: string) {
  switch (message.type) {
    case "LIST_TABS":
      return {
        id: message.id,
        tabs: [{ id: 42, title: "Contract Fixture", url: currentUrl, active: true }],
      };
    case "EXECUTE_NAVIGATE":
      return {
        id: message.id,
        success: true,
        _resolvedTabId: 42,
      };
    case "GET_PAGE_TEXT":
      return {
        id: message.id,
        title: "Contract Fixture",
        url: currentUrl,
        text: "Contract fixture page text from the fake extension.",
      };
    case "READ_PAGE":
      return {
        id: message.id,
        pageContent:
          '[e1] heading "Contract Fixture"\n[e2] button "Continue"\nText: fake extension page content',
        text: "Contract fixture page text from the fake extension.",
      };
    case "EXECUTE_SCREENSHOT":
      return {
        id: message.id,
        screenshotId: "fake-screenshot-1",
        base64: tinyPngBase64,
        width: 1,
        height: 1,
      };
    default:
      return { id: message.id, error: `Unhandled fake extension message: ${message.type}` };
  }
}

function startHost(socketPath: string) {
  const hostPath = path.join(process.cwd(), "native", "host.cjs");
  const child = spawn(process.execPath, [hostPath], {
    cwd: process.cwd(),
    env: { ...process.env, SURF_SOCKET: socketPath },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const messages: NativeMessage[] = [];
  const waiters: MessageWaiter[] = [];
  let stdoutBuffer = BufferCtor.alloc(0);
  let currentUrl = "about:blank";
  let stderr = "";
  let closed = false;

  const rejectWaiters = (error: Error) => {
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      if (waiter) {
        clearTimeout(waiter.timeout);
        waiter.reject(error);
      }
    }
  };

  const notifyWaiters = (message: NativeMessage) => {
    for (let index = 0; index < waiters.length; index += 1) {
      const waiter = waiters[index];
      if (waiter?.predicate(message)) {
        waiters.splice(index, 1);
        clearTimeout(waiter.timeout);
        waiter.resolve(message);
        index -= 1;
      }
    }
  };

  child.stdout.on("data", (chunk: unknown) => {
    stdoutBuffer = BufferCtor.concat([stdoutBuffer, chunk as BufferLike]);

    while (stdoutBuffer.length >= 4) {
      const messageLength = stdoutBuffer.readUInt32LE(0);
      if (stdoutBuffer.length < 4 + messageLength) {
        break;
      }

      const message = JSON.parse(
        stdoutBuffer.slice(4, 4 + messageLength).toString("utf8"),
      ) as NativeMessage;
      stdoutBuffer = stdoutBuffer.slice(4 + messageLength);
      messages.push(message);
      notifyWaiters(message);

      if (message.type === "EXECUTE_NAVIGATE" && message.url) {
        currentUrl = message.url;
      }
      if (message.type !== "HOST_READY") {
        writeNativeMessage(child.stdin, buildExtensionResponse(message, currentUrl));
      }
    }
  });

  child.stderr.on("data", (chunk: unknown) => {
    stderr += String(chunk);
  });
  child.on("close", (code) => {
    closed = true;
    rejectWaiters(new Error(`native host exited ${String(code)}: ${stderr}`));
  });
  child.on("error", (error) => {
    const hostError = error instanceof Error ? error : new Error(String(error));
    rejectWaiters(hostError);
  });

  return {
    child,
    messages,
    waitForMessage(
      predicate: (message: NativeMessage) => boolean,
      timeoutMs = 5000,
    ): Promise<NativeMessage> {
      const existing = messages.find(predicate);
      if (existing) {
        return Promise.resolve(existing);
      }

      return new Promise<NativeMessage>((resolve, reject) => {
        const timeout = setTimeout(() => {
          const index = waiters.findIndex((waiter) => waiter.predicate === predicate);
          if (index !== -1) {
            waiters.splice(index, 1);
          }
          reject(
            new Error(
              `Timed out waiting for native message. Saw: ${JSON.stringify(messages)}. Host stderr: ${stderr}`,
            ),
          );
        }, timeoutMs);
        waiters.push({ predicate, resolve, reject, timeout });
      });
    },
    async dispose() {
      rejectWaiters(new Error("native host disposed"));
      child.stdin.end();
      if (!closed && child.pid !== undefined) {
        child.kill("SIGTERM");
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 1000);
          child.once("close", () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }
      if (!closed && child.pid !== undefined) {
        try {
          process.kill(child.pid, "SIGKILL");
        } catch (error) {
          if (!(error instanceof Error)) {
            throw new Error(String(error));
          }
        }
      }
    },
  };
}

async function runCli(socketPath: string, args: string[]) {
  const cliPath = path.join(process.cwd(), "native", "cli.cjs");

  return await new Promise<CliResult>((resolve, reject) => {
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
    }, 10000);

    child.stdout.on("data", (chunk: unknown) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk: unknown) => {
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
  });
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("CLI/native-host/fake-extension E2E contract", () => {
  it("runs browser-like navigation, page text, and screenshot flows without Chrome", async () => {
    const socketPath = createSocketPath();
    const host = startHost(socketPath);

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");

      const tabs = await runCli(socketPath, ["tab.list"]);
      expect(tabs).toMatchObject({ code: 0, stderr: "" });
      expect(tabs.stdout).toBe("42\tContract Fixture\tabout:blank\n");

      const navigation = await runCli(socketPath, [
        "go",
        "https://fixture.test/page",
        "--no-screenshot",
      ]);
      expect(navigation).toMatchObject({ code: 0, stderr: "", stdout: "OK\n" });

      const pageText = await runCli(socketPath, ["page.text"]);
      expect(pageText).toMatchObject({ code: 0, stderr: "" });
      expect(pageText.stdout).toContain("Title: Contract Fixture");
      expect(pageText.stdout).toContain("URL: https://fixture.test/page");
      expect(pageText.stdout).toContain("Contract fixture page text from the fake extension.");

      const pageRead = await runCli(socketPath, ["read", "--depth", "2", "--compact"]);
      expect(pageRead).toMatchObject({ code: 0, stderr: "" });
      expect(pageRead.stdout).toContain('[e1] heading "Contract Fixture"');
      expect(pageRead.stdout).toContain('[e2] button "Continue"');

      const screenshot = await runCli(socketPath, ["screenshot", "--no-save"]);
      expect(screenshot).toMatchObject({ code: 0, stderr: "" });
      expect(screenshot.stdout).toContain("Screenshot captured (1x1) - ID: fake-screenshot-1");

      expect(host.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "HOST_READY" }),
          expect.objectContaining({ type: "LIST_TABS" }),
          expect.objectContaining({ type: "EXECUTE_NAVIGATE", url: "https://fixture.test/page" }),
          expect.objectContaining({ type: "GET_PAGE_TEXT" }),
          expect.objectContaining({
            type: "READ_PAGE",
            options: expect.objectContaining({ filter: "interactive", depth: 2, compact: true }),
          }),
          expect.objectContaining({ type: "EXECUTE_SCREENSHOT" }),
        ]),
      );
    } finally {
      await host.dispose();
    }
  });
});
