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

type NativeMessage = Record<string, unknown> & {
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

type FakeHostOptions = {
  targetActive?: boolean;
  env?: Record<string, string>;
  // Requests the page made before the test, already in network capture.
  pageTraffic?: CapturedRequest[];
  // Captured on each navigation, each time under a new id.
  navigationTraffic?: CapturedRequest[];
  // Merged into what capture holds for each script's request (a response body, say).
  scriptResponse?: Record<string, unknown>;
  // Answers a playbook record's page context and network capture, and clicks.
  recording?: boolean;
  // Runs each script in the tab instead of answering it, as the tab would.
  runScript?: (code: string) => Promise<Record<string, unknown>>;
};

// What the extension answers for a playbook record, a click and typing, with `recording` on.
function recordingResponse(message: NativeMessage, currentUrl: string) {
  switch (message.type) {
    case "GET_PLAYBOOK_RECORD_CONTEXT":
      return { id: message.id, origin: new URL(currentUrl).origin, _resolvedTabId: 42 };
    case "START_NETWORK_CAPTURE":
    case "STOP_NETWORK_CAPTURE":
      return {
        id: message.id,
        success: true,
        _resolvedTabId: 42,
        active: message.type === "START_NETWORK_CAPTURE",
        interruptions: [],
      };
    case "CLICK_SELECTOR":
    case "SMART_TYPE":
    case "SEARCH_PAGE":
      return { id: message.id, success: true, output: "{}", _resolvedTabId: 42 };
    default:
      return null;
  }
}

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
  existsSync(targetPath: string): boolean;
  mkdirSync(targetPath: string, options: { recursive: boolean }): void;
  mkdtempSync(prefix: string): string;
  readdirSync(
    targetPath: string,
    options: { withFileTypes: true },
  ): Array<{ name: string; isDirectory(): boolean }>;
  readFileSync(targetPath: string, encoding: "utf8"): string;
  rmSync(targetPath: string, options: { recursive: boolean; force: boolean }): void;
  writeFileSync(targetPath: string, content: string, options?: { mode?: number }): void;
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
const { version: packageVersion } = require("../../package.json") as { version: string };

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

type CapturedRequest = Record<string, unknown> & { id: string };

// What network capture holds for a script's request to the fixture API.
function capturedRequest(message: NativeMessage, seq: number): CapturedRequest {
  return {
    id: `r_${seq}`,
    ts: Date.now(),
    method: /method: "([A-Z]+)"/.exec(String(message.code))?.[1] || "GET",
    url: "https://fixture.test/api",
    status: 200,
    responseHeaders: {},
    flags: [],
    _loadingFinished: true,
  };
}

function buildExtensionResponse(
  message: NativeMessage,
  currentUrl: string,
  targetActive: boolean,
  captured: CapturedRequest[],
  scriptOutput: Record<string, unknown>,
) {
  switch (message.type) {
    case "TARGET_RESOLVE":
    case "TARGET_INSPECT":
      return {
        id: message.id,
        tabId: message.tabId || 42,
        windowId: 7,
        title: "Contract Fixture",
        url: currentUrl,
        active: targetActive,
        restricted: false,
      };
    case "SESSION_CLOSE_TARGET":
      return { id: message.id, success: true, tabId: message.tabId };
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
    case "EXECUTE_JAVASCRIPT":
      return {
        id: message.id,
        output: JSON.stringify({
          status: 200,
          ok: true,
          url: "https://fixture.test/api",
          headers: {},
          sentAt: Date.now(),
          doneAt: Date.now(),
          ...scriptOutput,
        }),
      };
    // Network capture holds what each script sent; its body is the fixture API's.
    case "READ_NETWORK_REQUESTS":
      return { id: message.id, entries: captured };
    case "GET_NETWORK_ENTRY": {
      const entry = captured.find((candidate) => candidate.id === message.requestId);
      return entry
        ? { id: message.id, entry }
        : { id: message.id, error: `Entry not found: ${String(message.requestId)}` };
    }
    case "GET_RESPONSE_BODY":
      return {
        id: message.id,
        success: true,
        base64Encoded: false,
        body:
          captured.find((entry) => entry.id === message.requestId)?.responseBody ?? '{"ok":true}',
      };
    default:
      return { id: message.id, error: `Unhandled fake extension message: ${message.type}` };
  }
}

function startHost(socketPath: string, options: FakeHostOptions = {}) {
  const hostPath = path.join(process.cwd(), "native", "host.cjs");
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surf-e2e-state-"));
  tempDirs.push(stateDir);
  const child = spawn(process.execPath, [hostPath], {
    cwd: process.cwd(),
    env: { ...process.env, ...options.env, SURF_SOCKET: socketPath, SURF_STATE_DIR: stateDir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const messages: NativeMessage[] = [];
  const waiters: MessageWaiter[] = [];
  let stdoutBuffer = BufferCtor.alloc(0);
  let currentUrl = "about:blank";
  const captured: CapturedRequest[] = [...(options.pageTraffic ?? [])];
  const targetActive = options.targetActive !== false;
  // Merged into what each script answers (a status, say); setScriptOutput changes it.
  let scriptOutput: Record<string, unknown> = {};
  // Answers go out in the order their messages came, a script the tab runs included.
  let answering = Promise.resolve();
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

  // What network capture records for a navigation or a script's request.
  const captureTraffic = (message: NativeMessage) => {
    if (message.type === "EXECUTE_NAVIGATE") {
      for (const request of options.navigationTraffic ?? []) {
        captured.push({ ...request, id: `${request.id}_${captured.length + 1}`, ts: Date.now() });
      }
    }
    if (message.type === "EXECUTE_JAVASCRIPT") {
      captured.push({
        ...capturedRequest(message, captured.length + 1),
        ...options.scriptResponse,
      });
    }
  };

  const respond = async (message: NativeMessage) => {
    if (options.runScript && message.type === "EXECUTE_JAVASCRIPT") {
      return { id: message.id, ...(await options.runScript(String(message.code))) };
    }
    return (
      (options.recording ? recordingResponse(message, currentUrl) : null) ??
      buildExtensionResponse(message, currentUrl, targetActive, captured, scriptOutput)
    );
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

      if (message.type === "HOST_READY") {
        writeNativeMessage(child.stdin, {
          type: "EXTENSION_HELLO",
          protocolVersion: 2,
          extensionVersion: packageVersion,
          browserInstanceId: "contract-browser",
          browserEpoch: `contract-epoch-${process.pid}`,
          capabilities: ["browser-sessions", "strict-targets", "keyed-lanes"],
        });
        continue;
      }
      if (message.type === "EXECUTE_NAVIGATE" && message.url) {
        currentUrl = message.url;
      }
      captureTraffic(message);
      answering = answering.then(async () => {
        writeNativeMessage(child.stdin, await respond(message));
      });
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
    stateDir,
    messages,
    setScriptOutput(output: Record<string, unknown>) {
      scriptOutput = output;
    },
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

async function runCli(
  socketPath: string,
  args: string[],
  cwd = process.cwd(),
  env: Record<string, string> = {},
) {
  const cliPath = path.join(process.cwd(), "native", "cli.cjs");

  return await new Promise<CliResult>((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      env: { ...process.env, ...env, SURF_SOCKET: socketPath },
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

function seedOldSession(stateDir: string, ownership = "surf-created") {
  const browserEpoch = `contract-epoch-${process.pid}`;
  fs.writeFileSync(
    path.join(stateDir, "browser-sessions.json"),
    JSON.stringify({
      version: 1,
      browsers: {
        "contract-browser": {
          sessions: {
            old: {
              bindingId: "old-binding",
              name: "old",
              browserInstanceId: "contract-browser",
              browserEpoch,
              tabId: 42,
              windowId: 7,
              mode: "window",
              ownership,
              lastUrl: "https://fixture.test/old",
              createdAt: "2000-01-01T00:00:00.000Z",
              updatedAt: "2000-01-01T00:00:00.000Z",
              lastAccessedAt: "2000-01-01T00:00:00.000Z",
              lastValidatedAt: "2000-01-01T00:00:00.000Z",
            },
          },
          namedTabs: {},
        },
      },
    }),
    { mode: 0o600 },
  );
}

function sessionAccessTime(stateDir: string) {
  const state = JSON.parse(
    fs.readFileSync(path.join(stateDir, "browser-sessions.json"), "utf8"),
  ) as {
    browsers: { "contract-browser": { sessions: { old: { lastAccessedAt?: string } } } };
  };
  return state.browsers["contract-browser"].sessions.old.lastAccessedAt;
}

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
      expect(navigation).toMatchObject({ code: 0, stdout: "OK\n" });
      expect(navigation.stderr).toMatch(/\[surf tab=42 window=7(?: queued=\d+ms)?\]/);

      const pageText = await runCli(socketPath, ["page.text"]);
      expect(pageText.code).toBe(0);
      expect(pageText.stderr).toMatch(/\[surf tab=42 window=7(?: queued=\d+ms)?\]/);
      expect(pageText.stdout).toContain("Title: Contract Fixture");
      expect(pageText.stdout).toContain("URL: https://fixture.test/page");
      expect(pageText.stdout).toContain("Contract fixture page text from the fake extension.");

      const pageRead = await runCli(socketPath, ["read", "--depth", "2", "--compact"]);
      expect(pageRead.code).toBe(0);
      expect(pageRead.stderr).toMatch(/\[surf tab=42 window=7(?: queued=\d+ms)?\]/);
      expect(pageRead.stdout).toContain('[e1] heading "Contract Fixture"');
      expect(pageRead.stdout).toContain('[e2] button "Continue"');

      const screenshot = await runCli(socketPath, ["screenshot", "--no-save"]);
      expect(screenshot.code).toBe(0);
      expect(screenshot.stderr).toMatch(/\[surf tab=42 window=7(?: queued=\d+ms)?\]/);
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

  it("runs a playbook under one host lease and blocks a duplicate semantic write", async () => {
    const socketPath = createSocketPath();
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "surf-playbook-project-"));
    tempDirs.push(project);
    const playbookDir = path.join(project, ".surf", "playbooks", "mutation", "ops");
    fs.mkdirSync(playbookDir, { recursive: true });
    fs.writeFileSync(
      path.join(project, ".surf", "playbooks", "mutation", "playbook.json"),
      JSON.stringify({ id: "mutation", version: "1.0.0", origins: ["https://fixture.test"] }),
    );
    fs.writeFileSync(
      path.join(playbookDir, "submit.json"),
      JSON.stringify({
        id: "submit",
        effect: "write",
        args: { action: { required: true } },
        safety: { authorization: "explicit", duplicate: "transactional", key: ["action"] },
        run: [
          {
            using: "network",
            request: {
              method: "POST",
              url: "https://fixture.test/api",
              body: { action: "{{action}}" },
            },
            extract: { jsonPath: "$.ok" },
            expect: { truthy: true },
          },
        ],
      }),
    );
    const host = startHost(socketPath);

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      const read = await runCli(socketPath, ["use", "page", "read", "--json"]);
      expect(read).toMatchObject({ code: 0, stderr: "" });
      expect(JSON.parse(read.stdout)).toMatchObject({
        status: "completed",
        strategy: "network",
        provenance: { scope: "built-in" },
      });

      const results = await Promise.all([
        runCli(
          socketPath,
          ["use", "mutation", "submit", "--action", "same", "--write", "--no-lock"],
          project,
        ),
        runCli(
          socketPath,
          ["use", "mutation", "submit", "--action", "same", "--write", "--no-lock"],
          project,
        ),
      ]);
      expect(results.filter((result) => result.code === 0)).toHaveLength(1);
      expect(results.filter((result) => result.code === 1)[0]?.stderr).toMatch(
        /write blocked by verified receipt/,
      );
      expect(host.messages.filter((message) => message.type === "EXECUTE_JAVASCRIPT")).toHaveLength(
        2,
      );
    } finally {
      await host.dispose();
    }
  });

  it("leaves no write receipt for a run refused before it sends, so the same key runs next", async () => {
    const socketPath = createSocketPath();
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "surf-playbook-project-"));
    tempDirs.push(project);
    const opsDir = path.join(project, ".surf", "playbooks", "mutation", "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    fs.writeFileSync(
      path.join(project, ".surf", "playbooks", "mutation", "playbook.json"),
      JSON.stringify({ id: "mutation", version: "1.0.0", origins: ["https://fixture.test"] }),
    );
    const writeOp = (id: string, url: string, extra: Record<string, unknown> = {}) =>
      fs.writeFileSync(
        path.join(opsDir, `${id}.json`),
        JSON.stringify({
          id,
          effect: "write",
          args: { action: { required: true } },
          safety: { authorization: "explicit", duplicate: "transactional", key: ["action"] },
          run: [
            {
              using: "network",
              request: { method: "POST", url, body: { action: "{{action}}" }, ...extra },
              extract: { jsonPath: "$.ok" },
              expect: { truthy: true },
            },
          ],
        }),
      );
    writeOp("submit", "https://fixture.test/api", {
      authInputs: [{ env: "SURF_E2E_SITE_KEY", header: "X-Site-Key", required: true }],
    });
    writeOp("elsewhere", "https://other.test/api");
    writeOp("untemplated", "https://fixture.test/{{missing}}");
    const host = startHost(socketPath);
    const receipts = () => {
      const root = path.join(host.stateDir, "playbook-receipts");
      if (!fs.existsSync(root)) {
        return [];
      }
      return fs
        .readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((claim) =>
          fs
            .readdirSync(path.join(root, claim.name), { withFileTypes: true })
            .filter((entry) => entry.name.endsWith(".json"))
            .map((entry) =>
              JSON.parse(fs.readFileSync(path.join(root, claim.name, entry.name), "utf8")),
            ),
        );
    };
    const sent = () => host.messages.filter((message) => message.type === "EXECUTE_JAVASCRIPT");
    const use = (op: string, env: Record<string, string> = {}) =>
      runCli(socketPath, ["use", "mutation", op, "--action", "same", "--write"], project, env);

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      const refusals = [
        [await use("submit"), /environment variable SURF_E2E_SITE_KEY is not set/],
        [await use("elsewhere"), /playbook network origin is not allowed: https:\/\/other\.test/],
        [await use("untemplated"), /missing template argument: missing/],
      ] as const;
      for (const [result, error] of refusals) {
        expect(result.code).toBe(1);
        expect(result.stderr).toMatch(error);
      }
      expect(sent()).toHaveLength(0);
      expect(receipts()).toEqual([]);

      const run = await use("submit", { SURF_E2E_SITE_KEY: "dummy-site-key" });
      expect(run).toMatchObject({ code: 0, stderr: "" });
      expect(sent()).toHaveLength(1);
      expect(receipts()).toEqual([expect.objectContaining({ op: "submit", status: "verified" })]);
    } finally {
      await host.dispose();
    }
  });

  it("saves a recorded op as the record made it, whatever its draft file says", async () => {
    const socketPath = createSocketPath();
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "surf-record-save-"));
    tempDirs.push(project);
    const host = startHost(socketPath, { recording: true });
    // pb save reads the record from the CLI's own process.
    const cli = (args: string[]) =>
      runCli(socketPath, args, project, { SURF_STATE_DIR: host.stateDir });
    // Text that reads like an input or an escape, which the saved op clicks as recorded.
    const selector = '[data-x="{{review_key}}"] .y-%{review_key} [data-z="{{!}}%{!}"]';
    const clicks = () => host.messages.filter((message) => message.type === "CLICK_SELECTOR");

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      expect((await cli(["navigate", "https://fixture.test/form"])).code).toBe(0);
      expect(
        (await cli(["pb", "record", "start", "fixture", "--op", "save", "--network"])).code,
      ).toBe(0);
      expect((await cli(["click", "--selector", selector, "--no-screenshot"])).code).toBe(0);
      const stopped = await cli(["pb", "record", "stop", "--draft", "--json"]);
      expect(stopped.code).toBe(0);
      const { record, draft } = JSON.parse(stopped.stdout);
      expect(draft).toMatchObject({ effect: "write", safety: { authorization: "explicit" } });
      const file = path.join(host.stateDir, "records", record.id, "draft", "op.json");
      const original = fs.readFileSync(file, "utf8");
      type Draft = {
        effect?: string;
        safety: Record<string, unknown>;
        args: Record<string, unknown>;
        provenance?: Record<string, unknown>;
      };
      const save = (change: (op: Draft) => void) => {
        const op = JSON.parse(original);
        change(op);
        fs.writeFileSync(file, JSON.stringify(op));
        return cli(["pb", "save", "--from-record", record.id, "--project", "--json"]);
      };

      // A draft that makes the write implicit and repeatable, or a read, doesn't save.
      const repeatable = await save((op) =>
        Object.assign(op.safety, {
          authorization: "implicit",
          duplicate: "repeatable-window",
          windowMs: 0,
        }),
      );
      expect(repeatable.code).toBe(1);
      expect(repeatable.stderr).toContain("its safety is drafted as");
      const asRead = await save((op) => {
        op.effect = "read";
        Reflect.deleteProperty(op, "safety");
        Reflect.deleteProperty(op.args, "review_key");
      });
      expect(asRead.code).toBe(1);
      expect(asRead.stderr).toContain(
        'the record drafts a write op (it ran click, a page write), and the draft\'s effect is "read"',
      );
      expect((await cli(["use", "fixture", "save", "--review_key", "k-1"])).stderr).toMatch(
        /Playbook not found: fixture/,
      );
      expect(clicks()).toHaveLength(1);

      // As drafted, it saves a write that needs --write and clicks the selector as recorded: pb
      // save, not the draft, marks the op as holding escaped text.
      const drafted = await save((op) => {
        op.provenance = { escaped: false };
      });
      expect(drafted.code).toBe(0);
      const unwritten = await cli(["use", "fixture", "save", "--review_key", "deleteAll"]);
      expect(unwritten.stderr).toMatch(/write op fixture save requires --write/);
      expect(clicks()).toHaveLength(1);
      const run = await cli([
        "use",
        "fixture",
        "save",
        "--review_key",
        "deleteAll",
        "--write",
        "--json",
      ]);
      expect(run).toMatchObject({ code: 0, stderr: "" });
      expect(clicks().slice(1)).toEqual([expect.objectContaining({ selector })]);
    } finally {
      await host.dispose();
    }
  }, 60000);

  // The record, not the draft file, decides the strategies and their order; a draft's check can
  // make the op fail, never send more.
  it("replays a recorded one-click write in the record's order, and stops at a failed check", async () => {
    const socketPath = createSocketPath();
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "surf-record-order-"));
    tempDirs.push(project);
    const host = startHost(socketPath, { recording: true });
    const cli = (args: string[]) =>
      runCli(socketPath, args, project, { SURF_STATE_DIR: host.stateDir });
    const sent = () =>
      host.messages
        .filter((message) =>
          ["EXECUTE_JAVASCRIPT", "CLICK_SELECTOR"].includes(String(message.type)),
        )
        .map((message) => message.type);

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      expect((await cli(["navigate", "https://fixture.test/form"])).code).toBe(0);
      expect(
        (await cli(["pb", "record", "start", "fixture", "--op", "save", "--network"])).code,
      ).toBe(0);
      // The page's own POST, captured while the record runs, then the click that made it.
      expect((await cli(["js", 'fetch("/api", { method: "POST" })'])).code).toBe(0);
      expect((await cli(["click", "--selector", "#submit", "--no-screenshot"])).code).toBe(0);
      const stopped = await cli(["pb", "record", "stop", "--draft", "--json"]);
      expect(stopped.code).toBe(0);
      const { record, draft } = JSON.parse(stopped.stdout);
      expect(draft.run.map((strategy: { using: string }) => strategy.using)).toEqual([
        "network",
        "workflow",
      ]);
      const file = path.join(host.stateDir, "records", record.id, "draft", "op.json");
      const original = fs.readFileSync(file, "utf8");
      type Draft = { run: Array<Record<string, unknown>> };
      const save = (change: (op: Draft) => void) => {
        const op = JSON.parse(original);
        change(op);
        fs.writeFileSync(file, JSON.stringify(op));
        return cli(["pb", "save", "--from-record", record.id, "--project", "--json"]);
      };
      const before = sent().length;

      const reversed = await save((op) => op.run.reverse());
      expect(reversed.code).toBe(1);
      expect(reversed.stderr).toContain(
        "its strategies are workflow, then network, and the record drafts network, then workflow",
      );
      const twice = await save((op) => op.run.splice(1, 0, structuredClone(op.run[0])));
      expect(twice.code).toBe(1);
      expect(twice.stderr).toContain("its strategies are network, then network, then workflow");
      expect(
        (await cli(["use", "fixture", "save", "--review_key", "k-1", "--write"])).stderr,
      ).toMatch(/Playbook not found: fixture/);
      expect(sent()).toHaveLength(before);

      // Saved as recorded with a check its answer fails: the POST is sent once, the click never.
      const checked = await save((op) => (op.run[0].verify = { status: 201 }));
      expect(checked.code).toBe(0);
      const run = await cli(["use", "fixture", "save", "--review_key", "k-1", "--write", "--json"]);
      expect(run.code).toBe(1);
      expect(run.stderr).toContain("expected status 201");
      expect(sent().slice(before)).toEqual(["EXECUTE_JAVASCRIPT"]);
    } finally {
      await host.dispose();
    }
  }, 60000);

  // A network-only write's inputs and duplicate key come from what it sends, never from its checks.
  it("keeps a recorded write's duplicate key when a draft's check names a step's input", async () => {
    const socketPath = createSocketPath();
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "surf-record-key-"));
    tempDirs.push(project);
    const host = startHost(socketPath, { recording: true });
    const cli = (args: string[]) =>
      runCli(socketPath, args, project, { SURF_STATE_DIR: host.stateDir });
    const posts = () => host.messages.filter((message) => message.type === "EXECUTE_JAVASCRIPT");
    const savedOp = () =>
      JSON.parse(
        fs.readFileSync(
          path.join(project, ".surf", "playbooks", "fixture", "ops", "submit.json"),
          "utf8",
        ),
      );

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      expect((await cli(["navigate", "https://fixture.test/form"])).code).toBe(0);
      expect(
        (await cli(["pb", "record", "start", "fixture", "--op", "submit", "--network"])).code,
      ).toBe(0);
      expect((await cli(["type", "dummy text", "--selector", "#q"])).code).toBe(0);
      expect((await cli(["js", 'fetch("/api", { method: "POST" })'])).code).toBe(0);
      expect((await cli(["click", "--selector", "#commit", "--no-screenshot"])).code).toBe(0);
      const stopped = await cli(["pb", "record", "stop", "--draft", "--json"]);
      expect(stopped.code).toBe(0);
      const { record } = JSON.parse(stopped.stdout);
      const file = path.join(host.stateDir, "records", record.id, "draft", "op.json");
      const original = JSON.parse(fs.readFileSync(file, "utf8"));
      const save = async (op: Record<string, unknown>) => {
        fs.writeFileSync(file, JSON.stringify(op));
        const saved = await cli(["pb", "save", "--from-record", record.id, "--project", "--json"]);
        expect(saved.code).toBe(0);
        return savedOp();
      };

      const drafted = await save(original);
      expect(drafted.safety.key).toEqual(["review_key"]);
      const checked = structuredClone(original);
      checked.run[0].verify = { truthy: true, note: "{{text}}" };
      const withCheck = await save(checked);
      expect({ safety: withCheck.safety, args: withCheck.args }).toEqual({
        safety: drafted.safety,
        args: drafted.args,
      });

      const before = posts().length;
      const use = (key: string) =>
        cli(["use", "fixture", "submit", "--review_key", key, "--write", "--json"]);
      expect((await use("one")).code).toBe(0);
      const again = await use("one");
      expect(again.code).toBe(1);
      expect(again.stderr).toMatch(/write blocked by verified receipt/);
      const byText = await cli(["use", "fixture", "submit", "--text", "two", "--write"]);
      expect(byText.stderr).toMatch(/Unknown input --text/);
      expect(posts().length - before).toBe(1);
    } finally {
      await host.dispose();
    }
  }, 60000);

  // A draft's extract runs in the tab after the answer; a failure anywhere in it, the page it
  // prepares from the response included, is final.
  it("stops a recorded read whose extract can't prepare the response", async () => {
    const socketPath = createSocketPath();
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "surf-record-extract-"));
    tempDirs.push(project);
    const vm = require("node:vm") as {
      runInNewContext(code: string, context: Record<string, unknown>): unknown;
    };
    const html = '<html><head><base href="http://["></head><body>ok</body></html>';
    // The tab's fetch answers with that page, and its DOMParser keeps the base as written.
    const tab = {
      URL,
      location: { href: "https://fixture.test/form" },
      fetch: async (url: string) => ({
        status: 200,
        ok: true,
        url,
        redirected: false,
        headers: new Map([["content-type", "text/html"]]),
        text: async () => html,
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
      DOMParser: class {
        parseFromString() {
          const base = { getAttribute: () => "http://[", setAttribute: () => undefined };
          return { querySelector: (selector: string) => (selector === "base[href]" ? base : null) };
        }
      },
    };
    const api = {
      id: "r_api",
      method: "GET",
      url: "https://fixture.test/api",
      status: 200,
      type: "XHR",
      responseHeaders: {},
      flags: [],
      _loadingFinished: true,
    };
    let running = false;
    const host = startHost(socketPath, {
      recording: true,
      navigationTraffic: [api],
      runScript: async (code) => {
        if (!running) {
          return { output: "{}" };
        }
        try {
          return { output: JSON.stringify(await vm.runInNewContext(code, { ...tab })) };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      },
    });
    const cli = (args: string[]) =>
      runCli(socketPath, args, project, { SURF_STATE_DIR: host.stateDir });
    const sent = () =>
      host.messages
        .filter((message) =>
          ["EXECUTE_JAVASCRIPT", "EXECUTE_NAVIGATE"].includes(String(message.type)),
        )
        .map((message) => message.type);

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      expect((await cli(["navigate", "https://fixture.test/form"])).code).toBe(0);
      expect(
        (await cli(["pb", "record", "start", "fixture", "--op", "page", "--network"])).code,
      ).toBe(0);
      expect((await cli(["navigate", "https://fixture.test/extra"])).code).toBe(0);
      const stopped = await cli(["pb", "record", "stop", "--draft", "--json"]);
      expect(stopped.code).toBe(0);
      const { record } = JSON.parse(stopped.stdout);
      const file = path.join(host.stateDir, "records", record.id, "draft", "op.json");
      const op = JSON.parse(fs.readFileSync(file, "utf8"));
      op.run[0].extract = { html: { value: "body" } };
      fs.writeFileSync(file, JSON.stringify(op));
      expect(
        (await cli(["pb", "save", "--from-record", record.id, "--project", "--json"])).code,
      ).toBe(0);
      running = true;
      const before = sent().length;
      const run = await cli(["use", "fixture", "page", "--json"]);
      expect(run.code).toBe(1);
      expect(run.stderr).toContain("network strategy failed after its request was answered: ");
      expect(run.stderr).toContain("Invalid URL");
      expect(sent().slice(before)).toEqual(["EXECUTE_JAVASCRIPT"]);
    } finally {
      await host.dispose();
    }
  }, 60000);

  // A read's recorded steps are its fallback when the request is answered with a failure the
  // runtime sees itself, as a 401; a draft's check failing is final.
  it("runs a recorded read's steps after a 401, and stops it at a failed check", async () => {
    const socketPath = createSocketPath();
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "surf-record-check-"));
    tempDirs.push(project);
    const api = {
      id: "r_api",
      method: "GET",
      url: "https://fixture.test/api",
      status: 200,
      type: "XHR",
      responseHeaders: {},
      flags: [],
      _loadingFinished: true,
    };
    const host = startHost(socketPath, { recording: true, navigationTraffic: [api] });
    const cli = (args: string[]) =>
      runCli(socketPath, args, project, { SURF_STATE_DIR: host.stateDir });
    const sent = () =>
      host.messages
        .filter((message) =>
          ["EXECUTE_JAVASCRIPT", "EXECUTE_NAVIGATE"].includes(String(message.type)),
        )
        .map((message) => message.type);

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      expect((await cli(["navigate", "https://fixture.test/form"])).code).toBe(0);
      expect(
        (await cli(["pb", "record", "start", "fixture", "--op", "search", "--network"])).code,
      ).toBe(0);
      expect((await cli(["navigate", "https://fixture.test/extra"])).code).toBe(0);
      const stopped = await cli(["pb", "record", "stop", "--draft", "--json"]);
      expect(stopped.code).toBe(0);
      const { record, draft } = JSON.parse(stopped.stdout);
      expect(draft).toMatchObject({ effect: "read" });
      expect(draft.run.map((strategy: { using: string }) => strategy.using)).toEqual([
        "network",
        "workflow",
      ]);
      const file = path.join(host.stateDir, "records", record.id, "draft", "op.json");
      const save = async () =>
        expect(
          (await cli(["pb", "save", "--from-record", record.id, "--project", "--json"])).code,
        ).toBe(0);

      // As drafted, a 401 sends the recorded navigate instead.
      await save();
      host.setScriptOutput({ status: 401, ok: false });
      const unauthorized = sent().length;
      const fellBack = await cli(["use", "fixture", "search", "--json"]);
      expect(fellBack.code).toBe(0);
      expect(JSON.parse(fellBack.stdout)).toMatchObject({ strategy: "workflow" });
      expect(sent().slice(unauthorized)).toEqual(["EXECUTE_JAVASCRIPT", "EXECUTE_NAVIGATE"]);
      host.setScriptOutput({});

      const op = JSON.parse(fs.readFileSync(file, "utf8"));
      op.run[0].verify = { status: 201 };
      fs.writeFileSync(file, JSON.stringify(op));
      await save();
      const before = sent().length;
      const run = await cli(["use", "fixture", "search", "--json"]);
      expect(run.code).toBe(1);
      expect(run.stderr).toContain(
        "network strategy failed after its request was answered: expected status 201",
      );
      expect(sent().slice(before)).toEqual(["EXECUTE_JAVASCRIPT"]);
    } finally {
      await host.dispose();
    }
  }, 60000);

  // `{{!}}` and `%{!}` stand for `{{` and `%{` only in an op pb save made from a record or recent
  // activity: surf do and a hand-written op send them as written, as before.
  it("sends {{!}} and %{!} as written from surf do and a hand-written op", async () => {
    const socketPath = createSocketPath();
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "surf-do-escape-"));
    tempDirs.push(project);
    const opsDir = path.join(project, ".surf", "playbooks", "manual", "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    fs.writeFileSync(
      path.join(project, ".surf", "playbooks", "manual", "playbook.json"),
      JSON.stringify({ id: "manual", version: "1.0.0", origins: ["https://fixture.test"] }),
    );
    // Its request fails its check, so the op goes on to its steps.
    fs.writeFileSync(
      path.join(opsDir, "find.json"),
      JSON.stringify({
        id: "find",
        effect: "read",
        run: [
          {
            using: "network",
            request: { method: "GET", url: "https://fixture.test/api", query: { q: "x{{!}}y" } },
            verify: { status: 201 },
          },
          {
            using: "workflow",
            steps: [{ cmd: "type", args: { text: "x{{!}}y%{!}z", selector: "#field" } }],
          },
        ],
      }),
    );
    const host = startHost(socketPath, { recording: true });
    const typed = () =>
      host.messages
        .filter((message) => message.type === "SMART_TYPE")
        .map((message) => message.text);

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      const texts = ["%{_open}", "pre%{_open}post", "{{_open}}", "%{!}", "%{!}_open}", "{{!}}"];
      for (const text of texts) {
        const result = await runCli(
          socketPath,
          [
            "do",
            `type "${text}" --selector #field`,
            "--_open",
            "INTENDED",
            "--no-auto-wait",
            "--step-delay",
            "0",
            "--json",
          ],
          project,
        );
        expect(result.code).toBe(0);
      }
      expect(typed()).toEqual([
        "INTENDED",
        "preINTENDEDpost",
        "{{_open}}",
        "%{!}",
        "%{!}_open}",
        "{{!}}",
      ]);

      const found = await runCli(socketPath, ["use", "manual", "find", "--json"], project);
      expect(found.code).toBe(0);
      const script = host.messages.find((message) => message.type === "EXECUTE_JAVASCRIPT");
      expect(String(script?.code)).toContain('{"q":"x{{!}}y"}');
      expect(typed().at(-1)).toBe("x{{!}}y%{!}z");
    } finally {
      await host.dispose();
    }
  }, 60000);

  // pb save decodes the text it stored, never an input's value: each input is typed as given, and
  // two inputs the escape would have made the same are two values to the duplicate guard.
  it("types a saved op's input exactly as given, and keys its duplicate guard on that value", async () => {
    const socketPath = createSocketPath();
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "surf-record-input-"));
    tempDirs.push(project);
    const host = startHost(socketPath, { recording: true });
    const cli = (args: string[]) =>
      runCli(socketPath, args, project, { SURF_STATE_DIR: host.stateDir });
    const sent = (type: string, field: string) =>
      host.messages.filter((message) => message.type === type).map((message) => message[field]);
    // Escapes, inputs and vars as text, one naming the op's own input inside a longer value.
    const values = ["%{!}", "{{!}}", "%{x}", "{{x}}", "%{!}_open}", "a%{text}b", "x{{text}}y"];

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      expect((await cli(["navigate", "https://fixture.test/form"])).code).toBe(0);
      expect((await cli(["pb", "record", "start", "fixture", "--op", "type"])).code).toBe(0);
      expect((await cli(["type", "dummy text", "--selector", "#field"])).code).toBe(0);
      const stopped = await cli(["pb", "record", "stop", "--draft", "--json"]);
      expect(stopped.code).toBe(0);
      const { record } = JSON.parse(stopped.stdout);
      expect(
        (await cli(["pb", "save", "--from-record", record.id, "--project", "--json"])).code,
      ).toBe(0);

      const before = sent("SMART_TYPE", "text").length;
      const use = (text: string) =>
        cli(["use", "fixture", "type", "--text", text, "--write", "--json"]);
      for (const text of values) {
        expect(await use(text)).toMatchObject({ code: 0, stderr: "" });
      }
      // `%{` is the text the escape stands for, and a value of its own.
      expect(await use("%{")).toMatchObject({ code: 0, stderr: "" });
      const again = await use("%{!}");
      expect(again.code).toBe(1);
      expect(again.stderr).toMatch(/write blocked by verified receipt/);
      expect(sent("SMART_TYPE", "text").slice(before)).toEqual([...values, "%{"]);
    } finally {
      await host.dispose();
    }
  }, 60000);

  it("searches for an input of an op saved from recent activity exactly as given", async () => {
    const socketPath = createSocketPath();
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "surf-recent-input-"));
    tempDirs.push(project);
    const host = startHost(socketPath, { recording: true });
    const cli = (args: string[]) =>
      runCli(socketPath, args, project, { SURF_STATE_DIR: host.stateDir });
    const searched = () =>
      host.messages
        .filter((message) => message.type === "SEARCH_PAGE")
        .map((message) => message.term);
    const values = ["%{!}", "{{!}}", "%{x}", "{{x}}", "%{!}_open}", "a%{term}b", "x{{term}}y"];

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      expect((await cli(["search", "recorded"])).code).toBe(0);
      expect(
        (
          await cli([
            "pb",
            "save",
            "recent",
            "--op",
            "find",
            "--from-recent",
            "--project",
            "--json",
          ])
        ).code,
      ).toBe(0);
      const before = searched().length;
      for (const term of values) {
        expect(await cli(["use", "recent", "find", "--term", term, "--json"])).toMatchObject({
          code: 0,
          stderr: "",
        });
      }
      expect(searched().slice(before)).toEqual(values);
    } finally {
      await host.dispose();
    }
  }, 60000);

  // A saved op (pb save, provenance.escaped) whose workflow runs the given steps for each op id;
  // `run` returns the terms the steps searched for.
  async function startSavedOps(
    ops: Record<string, unknown[]>,
    inputs: Record<string, unknown> = {},
  ) {
    const socketPath = createSocketPath();
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "surf-escaped-steps-"));
    tempDirs.push(project);
    const opsDir = path.join(project, ".surf", "playbooks", "saved", "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    fs.writeFileSync(
      path.join(project, ".surf", "playbooks", "saved", "playbook.json"),
      JSON.stringify({ id: "saved", version: "1.0.0", origins: [] }),
    );
    for (const [id, steps] of Object.entries(ops)) {
      fs.writeFileSync(
        path.join(opsDir, `${id}.json`),
        JSON.stringify({
          id,
          effect: "read",
          provenance: { escaped: true },
          args: {
            text: { required: true },
            other: { default: "OTHER" },
            count: { default: "2" },
            name: { default: "entry" },
            tool: { default: "search" },
            ...inputs,
          },
          run: [{ using: "workflow", steps, autoWait: false, stepDelay: 0 }],
        }),
      );
    }
    const host = startHost(socketPath, { recording: true });
    await host.waitForMessage((message) => message.type === "HOST_READY");
    const searched = () =>
      host.messages
        .filter((message) => message.type === "SEARCH_PAGE")
        .map((message) => message.term);
    const run = async (id: string, text: string) => {
      const before = searched().length;
      const result = await runCli(
        socketPath,
        ["use", "saved", id, "--text", text, "--json"],
        project,
        {
          SURF_STATE_DIR: host.stateDir,
        },
      );
      if (result.code !== 0 || result.stderr) {
        throw new Error(`surf use saved ${id} failed: ${result.stderr}`);
      }
      return searched().slice(before);
    };
    return { run, dispose: () => host.dispose() };
  }
  const search = (term: unknown) => ({ cmd: "search", args: { term } });
  // Input values that read like stored escapes, vars and other inputs.
  const literalInputs = ["%{!}{{other}}", "{{!}}%{item}", "a%{text}b{{text}}"];

  it("fills a saved op's input into an inline each list", async () => {
    const saved = await startSavedOps({
      inline: [{ each: ["{{text}}"], steps: [search("%{item}")] }],
    });
    try {
      expect(await saved.run("inline", "hello")).toEqual(["hello"]);
    } finally {
      await saved.dispose();
    }
  }, 60000);

  it("fills a saved op's input into an object nested in an each list", async () => {
    const saved = await startSavedOps({
      nested: [
        {
          each: ["x"],
          steps: [
            {
              each: [{ q: "{{text}}", deep: ["<{{text}}>", { r: "{{text}}" }] }],
              steps: [search("%{item}")],
            },
          ],
        },
      ],
    });
    try {
      expect(await saved.run("nested", "hello")).toEqual([
        { q: "hello", deep: ["<hello>", { r: "hello" }] },
      ]);
    } finally {
      await saved.dispose();
    }
  }, 60000);

  it("decodes the escapes a saved op's each list stores, without filling what they stand for", async () => {
    const saved = await startSavedOps({
      stored: [
        {
          each: ["a{{!}}b%{!}c", { q: "{{!}}text}}", r: ["%{!}item}"] }],
          steps: [search("%{item}")],
        },
      ],
    });
    try {
      expect(await saved.run("stored", "hello")).toEqual([
        "a{{b%{c",
        { q: "{{text}}", r: ["%{item}"] },
      ]);
    } finally {
      await saved.dispose();
    }
  }, 60000);

  it("sends an input's value as given from a saved op's each lists", async () => {
    const saved = await startSavedOps({
      inline: [{ each: ["{{text}}", "<{{text}}>"], steps: [search("%{item}")] }],
      nested: [{ each: [{ q: "{{text}}", r: ["<{{text}}>"] }], steps: [search("%{item}")] }],
    });
    try {
      for (const text of literalInputs) {
        expect(await saved.run("inline", text)).toEqual([text, `<${text}>`]);
        expect(await saved.run("nested", text)).toEqual([{ q: text, r: [`<${text}>`] }]);
      }
    } finally {
      await saved.dispose();
    }
  }, 60000);

  // The CLI passes an input as text, so the list is the input's default.
  it("iterates a saved op's list input as given, never reading its entries", async () => {
    const items = ["%{!}", "{{!}}", "{{other}}", "%{item}", { q: "{{text}}", r: ["%{!}"] }];
    const saved = await startSavedOps(
      { input: [{ each: "{{items}}", steps: [search("%{item}")] }] },
      { items: { default: items } },
    );
    try {
      expect(await saved.run("input", "hello")).toEqual(items);
    } finally {
      await saved.dispose();
    }
  }, 60000);

  it("fills a saved op's input into args arrays and objects, and sends it as given", async () => {
    const saved = await startSavedOps({
      args: [
        search(["{{text}}", "<{{text}}>", "%{!}", ["{{text}}"]]),
        search({ q: "{{text}}", r: { s: "<{{text}}>", t: ["{{text}}", "{{!}}"] } }),
      ],
    });
    try {
      for (const text of ["hello", ...literalInputs]) {
        expect(await saved.run("args", text)).toEqual([
          [text, `<${text}>`, "%{", [text]],
          { q: text, r: { s: `<${text}>`, t: [text, "{{"] } },
        ]);
      }
    } finally {
      await saved.dispose();
    }
  }, 60000);

  it("fills a saved op's inputs into repeat, until and a step's cmd and as", async () => {
    // The until step's search answers {}, which is not a stop, so the loop runs its two times.
    const saved = await startSavedOps({
      loops: [
        {
          repeat: "{{count}}",
          steps: [search("<{{text}}>")],
          until: { cmd: "{{tool}}", args: { term: ["{{text}}", { q: "{{text}}" }] } },
        },
      ],
      fields: [
        {
          each: ["{{text}}"],
          as: "{{name}}",
          steps: [{ cmd: "{{tool}}", args: { term: "%{entry}" } }],
        },
      ],
    });
    try {
      for (const text of ["hello", ...literalInputs]) {
        const iteration = [`<${text}>`, [text, { q: text }]];
        expect(await saved.run("loops", text)).toEqual([...iteration, ...iteration]);
        expect(await saved.run("fields", text)).toEqual([text]);
      }
    } finally {
      await saved.dispose();
    }
  }, 60000);

  // An input --link joins sends its value as given from both strategies: typed by the workflow,
  // in the network write's body.
  it("sends a linked input exactly as given from a saved op's workflow and its request", async () => {
    const socketPath = createSocketPath();
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "surf-record-link-"));
    tempDirs.push(project);
    const vm = require("node:vm") as {
      runInNewContext(code: string, context: Record<string, unknown>): unknown;
    };
    const bodies: unknown[] = [];
    const tab = {
      URL,
      location: { href: "https://fixture.test/form" },
      fetch: async (url: string, init: { body?: unknown }) => {
        bodies.push(init.body);
        return {
          status: 200,
          ok: true,
          url,
          redirected: false,
          headers: new Map([["content-type", "application/json"]]),
          text: async () => '{"ok":true}',
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      },
    };
    let running = false;
    const host = startHost(socketPath, {
      recording: true,
      // The page's POST, as capture holds it, with the body the input is linked into.
      scriptResponse: {
        requestHeaders: { "content-type": "application/json" },
        requestBody: '{"value":"seed","keep":"literal"}',
      },
      runScript: async (code) => {
        if (!running) {
          return { output: "{}" };
        }
        try {
          return { output: JSON.stringify(await vm.runInNewContext(code, { ...tab })) };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      },
    });
    const cli = (args: string[]) =>
      runCli(socketPath, args, project, { SURF_STATE_DIR: host.stateDir });
    const typed = () =>
      host.messages
        .filter((message) => message.type === "SMART_TYPE")
        .map((message) => message.text);
    const values = ["%{!}", "{{!}}", "%{x}", "{{x}}", "%{!}_open}", "a%{value}b", "x{{value}}y"];

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      expect((await cli(["navigate", "https://fixture.test/form"])).code).toBe(0);
      expect(
        (
          await cli([
            "pb",
            "record",
            "start",
            "fixture",
            "--op",
            "type",
            "--network",
            "--include-input-values",
          ])
        ).code,
      ).toBe(0);
      expect((await cli(["type", "dummy text", "--selector", "#field"])).code).toBe(0);
      expect((await cli(["js", 'fetch("/api", { method: "POST" })'])).code).toBe(0);
      const stopped = await cli(["pb", "record", "stop", "--draft", "--json"]);
      expect(stopped.code).toBe(0);
      const { record } = JSON.parse(stopped.stdout);
      expect(
        (await cli(["pb", "save", "--from-record", record.id, "--project", "--json"])).code,
      ).toBe(0);
      const linked = await cli([
        "pb",
        "param",
        "fixture",
        "type",
        "body.value",
        "--as",
        "value",
        "--link",
        "text",
        "--json",
      ]);
      expect(linked).toMatchObject({ code: 0, stderr: "" });

      running = true;
      const before = typed().length;
      const test = (value: string, strategy: string) =>
        cli([
          "pb",
          "test",
          "fixture",
          "type",
          "--value",
          value,
          "--write",
          "--strategy",
          strategy,
          "--json",
        ]);
      // Each run is a write the duplicate guard keys on its value, so the request gets its own.
      const sentValues = values.map((value) => `${value} (sent)`);
      for (const value of values) {
        const workflow = await test(value, "workflow");
        expect(workflow.code).toBe(0);
        expect(JSON.parse(workflow.stdout)).toMatchObject({ ok: true, strategy: "workflow" });
      }
      for (const value of sentValues) {
        const network = await test(value, "network");
        expect(network.code).toBe(0);
        expect(JSON.parse(network.stdout)).toMatchObject({ ok: true, strategy: "network" });
      }
      expect(typed().slice(before)).toEqual(values);
      expect(bodies.map((body) => JSON.parse(String(body)))).toEqual(
        sentValues.map((value) => ({ value, keep: "literal" })),
      );
    } finally {
      await host.dispose();
    }
  }, 60000);

  it("sends an env-supplied header from the caller's shell and writes its value nowhere", async () => {
    const socketPath = createSocketPath();
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "surf-secret-header-"));
    tempDirs.push(scratch);
    const env = { HOME: path.join(scratch, "home"), SURF_TMP: path.join(scratch, "tmp") };
    const project = path.join(scratch, "project");
    const opsDir = path.join(project, ".surf", "playbooks", "api", "ops");
    for (const directory of [env.HOME, env.SURF_TMP, opsDir]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    fs.writeFileSync(
      path.join(project, ".surf", "playbooks", "api", "playbook.json"),
      JSON.stringify({ id: "api", version: "1.0.0", origins: ["https://fixture.test"] }),
    );
    fs.writeFileSync(
      path.join(opsDir, "search.json"),
      JSON.stringify({
        id: "search",
        effect: "read",
        run: [
          {
            using: "network",
            request: {
              method: "GET",
              url: "https://fixture.test/api",
              authInputs: [{ env: "SURF_E2E_SITE_KEY", header: "Authorization", required: true }],
            },
          },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(opsDir, "paper.json"),
      JSON.stringify({
        id: "paper",
        effect: "read",
        args: { id: { type: "string", required: true } },
        run: [
          { using: "network", request: { method: "GET", url: "https://fixture.test/abs/{{id}}" } },
        ],
      }),
    );
    const secret = "dummy-shell-value-7f3a9c41";
    const host = startHost(socketPath, { env });
    const executions = () =>
      host.messages.filter((message) => message.type === "EXECUTE_JAVASCRIPT");

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      const missing = await runCli(socketPath, ["use", "api", "search", "--json"], project, env);
      expect(missing.code).toBe(1);
      expect(missing.stderr).toMatch(/environment variable SURF_E2E_SITE_KEY is not set/);
      expect(executions()).toHaveLength(0);

      const run = await runCli(socketPath, ["use", "api", "search", "--json"], project, {
        ...env,
        SURF_E2E_SITE_KEY: secret,
      });
      expect(run.code).toBe(0);
      expect(JSON.parse(run.stdout)).toMatchObject({ status: "completed", strategy: "network" });
      expect(executions()).toHaveLength(1);
      expect(JSON.stringify(executions()[0])).toContain(`"Authorization\\":\\"${secret}`);

      // A string input keeps its text: 2101.10010 isn't read as the number 2101.1001.
      const paper = await runCli(
        socketPath,
        ["use", "api", "paper", "--id", "2101.10010"],
        project,
        env,
      );
      expect(paper.code).toBe(0);
      expect(JSON.stringify(executions()[1])).toContain("https://fixture.test/abs/2101.10010");

      // The env value travels outside the op's inputs, so the undefined-input check (#480) lets it
      // through, still refuses a real typo, and the refusal doesn't quote the value.
      const typo = await runCli(socketPath, ["use", "api", "paper", "--idd", "x"], project, {
        ...env,
        SURF_E2E_SITE_KEY: secret,
      });
      expect(typo.code).toBe(1);
      expect(typo.stderr).toMatch(/Unknown input --idd for api paper\. Did you mean --id\?/);
      const typoWithSecret = await runCli(
        socketPath,
        ["use", "api", "search", "--q", "x"],
        project,
        {
          ...env,
          SURF_E2E_SITE_KEY: secret,
        },
      );
      expect(typoWithSecret.stderr).toMatch(
        /Unknown input --q for api search\. It takes no inputs/,
      );
      expect(`${typo.stderr}${typoWithSecret.stderr}`).not.toContain(secret);
      expect(executions()).toHaveLength(2);

      const files: string[] = [];
      const walk = (directory: string) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const target = path.join(directory, entry.name);
          if (entry.isDirectory()) {
            walk(target);
          } else {
            files.push(target);
          }
        }
      };
      walk(scratch);
      walk(host.stateDir);
      expect(files.length).toBeGreaterThan(2);
      expect(files.filter((file) => fs.readFileSync(file, "utf8").includes(secret))).toEqual([]);
      expect(`${run.stdout}${run.stderr}${missing.stderr}`).not.toContain(secret);
    } finally {
      await host.dispose();
    }
  });

  it("shows a captured request's secret headers as <redacted> and still replays them", async () => {
    const socketPath = createSocketPath();
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "surf-network-view-"));
    tempDirs.push(scratch);
    const env = { HOME: path.join(scratch, "home"), SURF_TMP: path.join(scratch, "tmp") };
    for (const directory of [env.HOME, env.SURF_TMP]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    const auth = "dummy-auth-value-for-tests";
    const cookie = "dummy-cookie-value-for-tests";
    const host = startHost(socketPath, {
      env,
      pageTraffic: [
        {
          id: "r_auth",
          ts: Date.now() - 60_000,
          method: "GET",
          url: "https://fixture.test/headers?session_token=dummy-query-value",
          type: "Fetch",
          requestHeaders: {
            Authorization: auth,
            Cookie: `sid=${cookie}`,
            Accept: "application/json",
          },
          status: 200,
          responseHeaders: { "content-type": "application/json", "set-cookie": `sid=${cookie}` },
          responseBody: `{"headers":{"Authorization":"${auth}"}}`,
          flags: [],
          _loadingFinished: true,
        },
      ],
    });
    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      const views = [
        ["network.get", "r_auth"],
        ["network.get", "r_auth", "--json"],
        ["network.curl", "r_auth"],
        ["network", "-v"],
        ["network", "--format", "raw"],
        ["network", "--format", "curl"],
      ];
      for (const args of views) {
        const view = await runCli(socketPath, args, scratch, env);
        expect(view.code, args.join(" ")).toBe(0);
        expect(view.stdout, args.join(" ")).toMatch(/authorization\W+<redacted>/i);
        for (const secret of [auth, cookie, "dummy-query-value"]) {
          expect(view.stdout, args.join(" ")).not.toContain(secret);
        }
      }
      const replay = await runCli(socketPath, ["network.replay", "r_auth", "--json"], scratch, env);
      expect(replay.code).toBe(0);
      const sent = host.messages.filter((message) => message.type === "EXECUTE_JAVASCRIPT");
      expect(JSON.stringify(sent.at(-1))).toContain(auth);
    } finally {
      await host.dispose();
    }
  });

  it("hides an echoed secret header in network.wait, network.replay and network.body, over the CLI and MCP", async () => {
    const socketPath = createSocketPath();
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "surf-network-echo-"));
    tempDirs.push(scratch);
    const env = { HOME: path.join(scratch, "home"), SURF_TMP: path.join(scratch, "tmp") };
    for (const directory of [env.HOME, env.SURF_TMP]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    const auth = "dummy-echo-value-for-tests";
    const echo = {
      mimeType: "application/json",
      responseBody: `{"headers":{"Authorization":"${auth}"}}`,
    };
    const sentWithAuth = {
      id: "r_echo",
      ts: Date.now() - 60_000,
      method: "GET",
      url: "https://fixture.test/headers",
      type: "Fetch",
      requestHeaders: { Authorization: auth, Accept: "application/json" },
      status: 200,
      responseHeaders: { "content-type": "application/json" },
      ...echo,
      flags: [],
      _loadingFinished: true,
    };
    const host = startHost(socketPath, {
      env,
      pageTraffic: [sentWithAuth],
      navigationTraffic: [sentWithAuth],
      scriptResponse: echo,
    });
    const sent = () =>
      JSON.stringify(
        host.messages.filter((message) => message.type === "EXECUTE_JAVASCRIPT").at(-1),
      );
    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      const views = [
        ["network.body", "r_echo"],
        ["network.wait", "/headers", "--open", "https://fixture.test/", "--json"],
        ["network.wait", "/headers", "--open", "https://fixture.test/"],
        ["network.replay", "r_echo", "--json"],
        ["network.replay", "r_echo"],
      ];
      // A body read from Chrome when capture has no entry for it still prints.
      const uncaptured = await runCli(socketPath, ["network.body", "r_cdp_only"], scratch, env);
      expect(uncaptured, uncaptured.stderr).toMatchObject({ code: 0, stdout: '{"ok":true}' });

      for (const args of views) {
        const view = await runCli(socketPath, args, scratch, env);
        expect(view.code, `${args.join(" ")}: ${view.stderr}`).toBe(0);
        expect(view.stdout, args.join(" ")).toContain("<redacted>");
        expect(view.stdout, args.join(" ")).not.toContain(auth);
        if (args[0] === "network.replay") {
          expect(sent()).toContain(auth);
        }
      }

      const { Client } = require("@modelcontextprotocol/sdk/client/index.js") as {
        Client: new (info: {
          name: string;
          version: string;
        }) => {
          connect(transport: unknown): Promise<void>;
          callTool(request: { name: string; arguments: Record<string, unknown> }): Promise<{
            content: Array<{ text?: string }>;
            isError?: boolean;
          }>;
          close(): Promise<void>;
        };
      };
      const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js") as {
        InMemoryTransport: { createLinkedPair(): [unknown, unknown] };
      };
      const { PiChromeMcpServer } = require("../../native/mcp-server.cjs") as {
        PiChromeMcpServer: new (
          endpoint: unknown,
        ) => { server: { connect(t: unknown): Promise<void> } };
      };
      const { selectEndpoint } = require("../../native/endpoint.cjs") as {
        selectEndpoint(args: string[], env: Record<string, string>): { endpoint: unknown };
      };
      const mcp = new PiChromeMcpServer(selectEndpoint([], { SURF_SOCKET: socketPath }).endpoint);
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await mcp.server.connect(serverSide);
      const client = new Client({ name: "surf-e2e", version: "1.0.0" });
      await client.connect(clientSide);
      try {
        const calls = [
          { name: "network.wait", arguments: { match: "/headers", open: "https://fixture.test/" } },
          { name: "network.replay", arguments: { id: "r_echo" } },
        ];
        for (const call of calls) {
          const result = await client.callTool(call);
          const text = result.content.map((item) => item.text ?? "").join("\n");
          expect(result.isError, `${call.name}: ${text}`).toBeFalsy();
          expect(text, call.name).toContain("<redacted>");
          expect(text, call.name).not.toContain(auth);
        }
        expect(sent()).toContain(auth);
      } finally {
        await client.close();
      }
    } finally {
      await host.dispose();
    }
  });

  it("keeps the page's other captured requests off disk when surf use and network.replay read capture", async () => {
    const socketPath = createSocketPath();
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "surf-capture-disk-"));
    tempDirs.push(scratch);
    const env = { HOME: path.join(scratch, "home"), SURF_TMP: path.join(scratch, "tmp") };
    const project = path.join(scratch, "project");
    const opsDir = path.join(project, ".surf", "playbooks", "api", "ops");
    for (const directory of [env.HOME, env.SURF_TMP, opsDir]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    fs.writeFileSync(
      path.join(project, ".surf", "playbooks", "api", "playbook.json"),
      JSON.stringify({ id: "api", version: "1.0.0", origins: ["https://fixture.test"] }),
    );
    fs.writeFileSync(
      path.join(opsDir, "read.json"),
      JSON.stringify({
        id: "read",
        effect: "read",
        run: [{ using: "network", request: { method: "GET", url: "https://fixture.test/api" } }],
      }),
    );
    const marker = "dummy-page-marker-for-tests";
    const host = startHost(socketPath, {
      env,
      pageTraffic: [
        {
          id: "r_page",
          ts: Date.now() - 60_000,
          method: "GET",
          url: "https://fixture.test/api",
          requestHeaders: { "x-page-token": marker },
          status: 200,
          responseHeaders: {},
          responseBody: `{"note":"${marker}"}`,
          flags: [],
          _loadingFinished: true,
        },
      ],
    });
    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      const run = await runCli(socketPath, ["use", "api", "read", "--json"], project, env);
      expect(run).toMatchObject({ code: 0, stderr: "" });
      expect(JSON.parse(run.stdout)).toMatchObject({ strategy: "network" });
      const replay = await runCli(socketPath, ["network.replay", "r_page", "--json"], project, env);
      expect(replay.code).toBe(0);
      expect(
        host.messages.filter((message) => message.type === "READ_NETWORK_REQUESTS").length,
      ).toBeGreaterThan(1);

      const files: string[] = [];
      const walk = (directory: string) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const target = path.join(directory, entry.name);
          if (entry.isDirectory()) {
            walk(target);
          } else {
            files.push(target);
          }
        }
      };
      walk(scratch);
      walk(host.stateDir);
      expect(files.filter((file) => fs.readFileSync(file, "utf8").includes(marker))).toEqual([]);
      expect(fs.existsSync(path.join(host.stateDir, "network"))).toBe(false);
    } finally {
      await host.dispose();
    }
  });

  it("falls back to the host's environment for an env-supplied header the shell doesn't set", async () => {
    const socketPath = createSocketPath();
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "surf-host-env-header-"));
    tempDirs.push(project);
    const opsDir = path.join(project, ".surf", "playbooks", "api", "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    fs.writeFileSync(
      path.join(project, ".surf", "playbooks", "api", "playbook.json"),
      JSON.stringify({ id: "api", version: "1.0.0", origins: ["https://fixture.test"] }),
    );
    const authOp = (env: string) => ({
      id: env === "SURF_E2E_HOST_ONLY_KEY" ? "host" : "nowhere",
      effect: "read",
      run: [
        {
          using: "network",
          request: {
            method: "GET",
            url: "https://fixture.test/api",
            authInputs: [{ env, header: "X-Site-Key", required: true }],
          },
        },
      ],
    });
    fs.writeFileSync(
      path.join(opsDir, "host.json"),
      JSON.stringify(authOp("SURF_E2E_HOST_ONLY_KEY")),
    );
    fs.writeFileSync(
      path.join(opsDir, "nowhere.json"),
      JSON.stringify(authOp("SURF_E2E_UNSET_KEY")),
    );
    const host = startHost(socketPath, { env: { SURF_E2E_HOST_ONLY_KEY: "host-side-value-31" } });
    const executions = () =>
      host.messages.filter((message) => message.type === "EXECUTE_JAVASCRIPT");
    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      const run = await runCli(socketPath, ["use", "api", "host", "--json"], project);
      expect(run).toMatchObject({ code: 0 });
      expect(JSON.stringify(executions()[0])).toContain("host-side-value-31");

      const missing = await runCli(socketPath, ["use", "api", "nowhere", "--json"], project);
      expect(missing.code).toBe(1);
      expect(missing.stderr).toMatch(/environment variable SURF_E2E_UNSET_KEY is not set/);
      expect(executions()).toHaveLength(1);
    } finally {
      await host.dispose();
    }
  });

  it("removes an old live Surf-created session and its target", async () => {
    const socketPath = createSocketPath();
    const host = startHost(socketPath, { targetActive: false });

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      seedOldSession(host.stateDir);

      const cleanup = await runCli(socketPath, ["session.cleanup", "--idle-after", "1s", "--json"]);
      expect(cleanup).toMatchObject({ code: 0, stderr: "" });
      expect(JSON.parse(cleanup.stdout)).toMatchObject({
        dryRun: false,
        removed: [{ name: "old", targetAction: "close", targetClosed: true }],
      });
      expect(host.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "SESSION_CLOSE_TARGET", tabId: 42 }),
        ]),
      );

      const listed = await runCli(socketPath, ["session.list", "--json"]);
      expect(JSON.parse(listed.stdout).sessions).toEqual([]);
    } finally {
      await host.dispose();
    }
  });

  it("keeps an old session and target during cleanup dry-run", async () => {
    const socketPath = createSocketPath();
    const host = startHost(socketPath, { targetActive: false });

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      seedOldSession(host.stateDir);

      const cleanup = await runCli(socketPath, [
        "session.cleanup",
        "--idle-after",
        "1s",
        "--dry-run",
        "--json",
      ]);
      expect(cleanup).toMatchObject({ code: 0, stderr: "" });
      expect(JSON.parse(cleanup.stdout)).toMatchObject({
        dryRun: true,
        removed: [{ name: "old", targetAction: "close", targetClosed: true }],
      });
      expect(host.messages.some((message) => message.type === "SESSION_CLOSE_TARGET")).toBe(false);

      const listed = await runCli(socketPath, ["session.list", "--json"]);
      expect(JSON.parse(listed.stdout).sessions).toHaveLength(1);
    } finally {
      await host.dispose();
    }
  });

  it("removes an idle adopted binding without closing its target", async () => {
    const socketPath = createSocketPath();
    const host = startHost(socketPath, { targetActive: false });

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      seedOldSession(host.stateDir, "adopted");

      const cleanup = await runCli(socketPath, ["session.cleanup", "--idle-after", "1s", "--json"]);
      expect(cleanup).toMatchObject({ code: 0, stderr: "" });
      expect(JSON.parse(cleanup.stdout)).toMatchObject({
        removed: [{ name: "old", ownership: "adopted", targetAction: "keep", targetClosed: false }],
      });
      expect(host.messages.some((message) => message.type === "SESSION_CLOSE_TARGET")).toBe(false);

      const listed = await runCli(socketPath, ["session.list", "--json"]);
      expect(JSON.parse(listed.stdout).sessions).toEqual([]);
    } finally {
      await host.dispose();
    }
  });

  it("does not refresh idle activity during list/info validation", async () => {
    const socketPath = createSocketPath();
    const host = startHost(socketPath, { targetActive: false });

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      seedOldSession(host.stateDir);
      const originalAccessTime = sessionAccessTime(host.stateDir);

      const listed = await runCli(socketPath, ["session.list", "--refresh", "--json"]);
      expect(listed.code).toBe(0);
      expect(sessionAccessTime(host.stateDir)).toBe(originalAccessTime);

      const info = await runCli(socketPath, ["session.info", "old", "--refresh", "--json"]);
      expect(info.code).toBe(0);
      expect(sessionAccessTime(host.stateDir)).toBe(originalAccessTime);

      const cleanup = await runCli(socketPath, ["session.cleanup", "--idle-after", "1s", "--json"]);
      expect(cleanup.code).toBe(0);
      expect(JSON.parse(cleanup.stdout).removed).toMatchObject([
        { name: "old", reason: "idle", targetAction: "close" },
      ]);
    } finally {
      await host.dispose();
    }
  });
});
