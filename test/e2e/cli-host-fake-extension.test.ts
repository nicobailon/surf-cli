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
    case "EXPORT_NETWORK_REQUESTS":
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

// Records a write whose captured POST is at `page.url` (the host's scriptResponse): each of `typed`
// is typed into the page first, so the record masks it there, and the op is saved from the record.
// Then capture holds each later request at the fixture API's URL, the one the fake extension
// answers, so an op's own send is found.
async function saveRecordedWrite({
  cli,
  page,
  typed,
}: {
  cli: (args: string[]) => Promise<CliResult>;
  page: { url: string };
  typed: string[];
}) {
  const run = async (args: string[]) => {
    const result = await cli(args);
    if (result.code !== 0) {
      throw new Error(`surf ${args.join(" ")} failed: ${result.stderr}`);
    }
    return result;
  };
  await run(["navigate", "https://fixture.test/form"]);
  await run(["pb", "record", "start", "fixture", "--op", "submit", "--network"]);
  for (const [index, text] of typed.entries()) {
    await run(["type", text, "--selector", `#field-${index}`]);
  }
  await run(["js", 'fetch("/api", { method: "POST" })']);
  await run(["click", "--selector", "#commit", "--no-screenshot"]);
  const { record } = JSON.parse((await run(["pb", "record", "stop", "--draft", "--json"])).stdout);
  page.url = "https://fixture.test/api";
  await run(["pb", "save", "--from-record", record.id, "--project", "--json"]);
}

function jsonQueryUrl(variables: Record<string, unknown>) {
  return `https://fixture.test/api?variables=${encodeURIComponent(JSON.stringify(variables))}`;
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
        /write blocked: attempt \S+ was sent at .+ and succeeded\. Add --repeat/,
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

  // A host killed mid-write leaves its attempt dispatched or reserved, or only its claim; --repeat
  // gets past each state, as it does past a verified or in-doubt one, and sends one request.
  it("sends one more request with --repeat whatever the last attempt's state, and names it without", async () => {
    const socketPath = createSocketPath();
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "surf-playbook-repeat-"));
    tempDirs.push(project);
    const opsDir = path.join(project, ".surf", "playbooks", "mutation", "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    fs.writeFileSync(
      path.join(project, ".surf", "playbooks", "mutation", "playbook.json"),
      JSON.stringify({ id: "mutation", version: "1.0.0", origins: ["https://fixture.test"] }),
    );
    const safety = { duplicate: "transactional", key: ["action"] };
    fs.writeFileSync(
      path.join(opsDir, "submit.json"),
      JSON.stringify({
        id: "submit",
        effect: "write",
        args: { action: { required: true } },
        safety: { authorization: "explicit", ...safety },
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
    const receipts = require("../../native/playbook-receipts.cjs") as {
      receiptRoot(root: string): string;
      semanticClaimKey(claim: Record<string, unknown>): string;
      reserveReceipt(claim: Record<string, unknown>): { attemptId: string };
      updateReceipt(handle: unknown, status: string, details: object, root: string): unknown;
    };
    const host = startHost(socketPath);
    // What a run that stopped in this state left behind, as surf writes it.
    const seed = (action: string, status: string | null) => {
      const claim = {
        playbookId: "mutation",
        op: { id: "submit", safety },
        args: { action },
        root: host.stateDir,
      };
      if (status === null) {
        fs.mkdirSync(
          path.join(receipts.receiptRoot(host.stateDir), receipts.semanticClaimKey(claim)),
          {
            recursive: true,
          },
        );
        return "";
      }
      const handle = receipts.reserveReceipt({ ...claim, op: { ...claim.op, effect: "write" } });
      if (status !== "reserved") {
        receipts.updateReceipt(handle, status, {}, host.stateDir);
      }
      return handle.attemptId;
    };
    const sent = () =>
      host.messages.filter((message) => message.type === "EXECUTE_JAVASCRIPT").length;
    const use = (action: string, ...flags: string[]) =>
      runCli(
        socketPath,
        ["use", "mutation", "submit", "--action", action, "--write", ...flags],
        project,
      );
    const at = "(\\d{4}-\\d{2}-\\d{2} )?\\d{2}:\\d{2}";

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      const states: Array<[string | null, (attempt: string) => string]> = [
        [
          "verified",
          (attempt) => `attempt ${attempt} was sent at ${at} and succeeded\\. Add --repeat`,
        ],
        [
          "indeterminate",
          (attempt) =>
            `attempt ${attempt} was sent at ${at} and its result is unknown\\. Check the site, then add --repeat`,
        ],
        [
          "dispatched",
          (attempt) =>
            `attempt ${attempt} was sent at ${at} and surf stopped before its answer came\\. Check the site, then add --repeat`,
        ],
        [
          "reserved",
          (attempt) =>
            `attempt ${attempt} began at ${at} and surf stopped before it knew whether it was sent\\. Check the site, then add --repeat`,
        ],
        [
          "not_dispatched",
          (attempt) => `attempt ${attempt} failed at ${at} before it was sent\\. Add --repeat`,
        ],
        [
          null,
          () =>
            `a run at ${at} claimed these inputs and stopped before it saved an attempt.*add --repeat`,
        ],
      ];
      for (const [status, wording] of states) {
        const action = `left-${status}`;
        const attempt = seed(action, status);
        const before = sent();
        const blocked = await use(action);
        expect(blocked.code).toBe(1);
        expect(blocked.stderr).toMatch(new RegExp(`write blocked: ${wording(attempt)}`));
        expect(sent()).toBe(before);
        expect(await use(action, "--repeat")).toMatchObject({ code: 0, stderr: "" });
        expect(sent()).toBe(before + 1);
        // The repeat is verified now, so the next run is blocked again.
        expect((await use(action)).stderr).toMatch(/succeeded\. Add --repeat to send it again/);
        expect(sent()).toBe(before + 1);
      }

      // --override-in-doubt is the old name for --repeat.
      seed("alias", "indeterminate");
      const before = sent();
      expect(await use("alias", "--override-in-doubt")).toMatchObject({ code: 0, stderr: "" });
      expect(sent()).toBe(before + 1);
    } finally {
      await host.dispose();
    }
  }, 60000);

  it("shows a write with --dry-run, sending nothing, and names it when --write is missing", async () => {
    const socketPath = createSocketPath();
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "surf-playbook-dry-run-"));
    tempDirs.push(project);
    const opsDir = path.join(project, ".surf", "playbooks", "fixture", "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    fs.writeFileSync(
      path.join(project, ".surf", "playbooks", "fixture", "playbook.json"),
      JSON.stringify({ id: "fixture", version: "1.0.0", origins: ["https://fixture.test"] }),
    );
    fs.writeFileSync(
      path.join(opsDir, "post.json"),
      JSON.stringify({
        id: "post",
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
              authInputs: [{ env: "SURF_E2E_SITE_KEY", header: "X-Site-Key", required: true }],
            },
            extract: { jsonPath: "$.ok" },
            expect: { truthy: true },
          },
        ],
      }),
    );
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
            .filter((entry) => entry.name.endsWith(".json")),
        );
    };
    const env = { SURF_E2E_SITE_KEY: "dummy-site-key" };
    const use = (...flags: string[]) =>
      runCli(socketPath, ["use", "fixture", "post", "--action", "same", ...flags], project, env);

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      const before = host.messages.length;

      const dryRun = await use("--dry-run");
      expect(dryRun).toMatchObject({ code: 0, stderr: "" });
      expect(dryRun.stdout).toContain("POST https://fixture.test/api");
      expect(dryRun.stdout).toContain("X-Site-Key");
      expect(dryRun.stdout).not.toContain("dummy-site-key");
      const json = JSON.parse((await use("--dry-run", "--json")).stdout);
      expect(json).toMatchObject({
        status: "dry-run",
        method: "POST",
        url: "https://fixture.test/api",
        headers: ["X-Site-Key"],
        body: { action: "same" },
        allowedOrigins: ["https://fixture.test"],
      });
      expect(host.messages.length).toBe(before);
      expect(receipts()).toEqual([]);

      // A value after --dry-run is refused, not read as "no dry run".
      for (const flags of [
        ["--dry-run", "true"],
        ["--write", "--dry-run", "true"],
      ]) {
        const valued = await use(...flags);
        expect(valued.code).toBe(1);
        expect(valued.stderr).toContain("--dry-run takes no value");
      }
      expect(host.messages.length).toBe(before);
      expect(receipts()).toEqual([]);

      const unwritten = await use();
      expect(unwritten.code).toBe(1);
      expect(unwritten.stderr).toMatch(
        /write op fixture post requires --write; it sends POST https:\/\/fixture\.test\/api/,
      );
      expect(host.messages.filter((message) => message.type === "EXECUTE_JAVASCRIPT")).toEqual([]);

      const written = await use("--write");
      expect(written).toMatchObject({ code: 0, stderr: "" });
      expect(host.messages.filter((message) => message.type === "EXECUTE_JAVASCRIPT")).toHaveLength(
        1,
      );
      expect(receipts()).toHaveLength(1);
    } finally {
      await host.dispose();
    }
  });

  it("saves a recorded op as its draft file says, listing what differs", async () => {
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

      // A draft edited to a read saves as a read, and the save lists each difference.
      const asRead = await save((op) => {
        op.effect = "read";
        Reflect.deleteProperty(op, "safety");
        Reflect.deleteProperty(op.args, "review_key");
      });
      expect(asRead.code).toBe(0);
      expect(JSON.parse(asRead.stdout).differs).toEqual([
        "effect: read (the record drafts write: it ran click, a page write)",
        'safety: none (the record drafts {"authorization":"explicit","duplicate":"transactional","key":["review_key"]})',
        "inputs: review_key removed",
      ]);

      // As drafted, it saves a write that needs --write and clicks the selector as recorded: pb
      // save, not the draft, marks the op as holding escaped text.
      const drafted = await save((op) => {
        op.provenance = { escaped: false };
      });
      expect(drafted.code).toBe(0);
      expect(JSON.parse(drafted.stdout).differs).toBeUndefined();
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

  // A write never tries its next strategy: a draft's check can make the op fail, never send more.
  it("replays a recorded one-click write once, and stops at a failed check", async () => {
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
      expect(again.stderr).toMatch(
        /write blocked: attempt \S+ was sent at .+ and succeeded\. Add --repeat/,
      );
      const byText = await cli(["use", "fixture", "submit", "--text", "two", "--write"]);
      expect(byText.stderr).toMatch(/Unknown input --text/);
      expect(posts().length - before).toBe(1);
    } finally {
      await host.dispose();
    }
  }, 60000);

  // A recorded write whose one step types the value it sends: its duplicate key is that step's
  // input. pb param on the masked number gives the request and the step one input, so the step's
  // own input goes and the key follows, though a draft's check still names it: a check is never
  // filled or sent. The same year is then blocked as a duplicate whatever else is given.
  it("keys a recorded write on the input it sends after pb param, not one only its check names", async () => {
    const socketPath = createSocketPath();
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "surf-record-check-key-"));
    tempDirs.push(project);
    const page = { url: jsonQueryUrl({ n: 2024 }) };
    const host = startHost(socketPath, { recording: true, scriptResponse: page });
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
      expect((await cli(["type", "2024", "--selector", "#year"])).code).toBe(0);
      expect((await cli(["js", 'fetch("/api", { method: "POST" })'])).code).toBe(0);
      const stopped = await cli(["pb", "record", "stop", "--draft", "--json"]);
      expect(stopped.code).toBe(0);
      const { record } = JSON.parse(stopped.stdout);
      const file = path.join(host.stateDir, "records", record.id, "draft", "op.json");
      const draft = JSON.parse(fs.readFileSync(file, "utf8"));
      draft.run[0].verify = { truthy: true, note: "{{text}}" };
      fs.writeFileSync(file, JSON.stringify(draft));
      page.url = "https://fixture.test/api";
      const saved = await cli(["pb", "save", "--from-record", record.id, "--project", "--json"]);
      expect(saved).toMatchObject({ code: 0, stderr: "" });
      expect(savedOp().safety.key).toEqual(["text"]);

      const param = await cli([
        "pb",
        "param",
        "fixture",
        "submit",
        "query.variables.n",
        "--as",
        "year",
        "--json",
      ]);
      expect(param).toMatchObject({ code: 0, stderr: "" });
      const op = savedOp();
      expect(op.run[0].verify).toEqual({ truthy: true, note: "{{text}}" });
      expect({ key: op.safety.key, inputs: Object.keys(op.args) }).toEqual({
        key: ["year"],
        inputs: ["year"],
      });

      const before = posts().length;
      const use = (...args: string[]) =>
        cli(["use", "fixture", "submit", "--year", "2031", ...args, "--write", "--json"]);
      const byText = await use("--text", "one");
      expect(byText.code).toBe(1);
      expect(byText.stderr).toMatch(/Unknown input --text/);
      expect((await use()).code).toBe(0);
      const again = await use();
      expect(again.code).toBe(1);
      expect(again.stderr).toMatch(
        /write blocked: attempt \S+ was sent at .+ and succeeded\. Add --repeat/,
      );
      expect(posts().length - before).toBe(1);
    } finally {
      await host.dispose();
    }
  }, 60000);

  // renderRequest never fills a request's note, nor its cache (an env header's request is sent
  // no-store whatever it says), so an input named only there is no input of the write: after pb
  // param the key is the year it sends, and the same year is blocked whatever else is given.
  for (const [label, unsent] of [
    ["note", { note: "{{text}}" }],
    [
      "cache, under an env header",
      { cache: "{{text}}", authInputs: [{ header: "X-Probe", env: "PROBE_KEY" }] },
    ],
  ] as const) {
    it(`keys a recorded write on the input it sends after pb param, not one only its ${label} names`, async () => {
      const socketPath = createSocketPath();
      const project = fs.mkdtempSync(path.join(os.tmpdir(), "surf-record-unsent-key-"));
      tempDirs.push(project);
      const page = { url: jsonQueryUrl({ n: 2024 }) };
      const host = startHost(socketPath, { recording: true, scriptResponse: page });
      const cli = (args: string[]) =>
        runCli(socketPath, args, project, {
          SURF_STATE_DIR: host.stateDir,
          PROBE_KEY: "dummy-key",
        });
      const posts = () => host.messages.filter((message) => message.type === "EXECUTE_JAVASCRIPT");
      const file = path.join(project, ".surf", "playbooks", "fixture", "ops", "submit.json");

      try {
        await host.waitForMessage((message) => message.type === "HOST_READY");
        expect((await cli(["navigate", "https://fixture.test/form"])).code).toBe(0);
        expect(
          (await cli(["pb", "record", "start", "fixture", "--op", "submit", "--network"])).code,
        ).toBe(0);
        expect((await cli(["type", "2024", "--selector", "#year"])).code).toBe(0);
        expect((await cli(["js", 'fetch("/api", { method: "POST" })'])).code).toBe(0);
        const { record } = JSON.parse(
          (await cli(["pb", "record", "stop", "--draft", "--json"])).stdout,
        );
        page.url = "https://fixture.test/api";
        expect(
          (await cli(["pb", "save", "--from-record", record.id, "--project", "--json"])).code,
        ).toBe(0);
        const saved = JSON.parse(fs.readFileSync(file, "utf8"));
        expect(saved.safety.key).toEqual(["text"]);
        Object.assign(saved.run[0].request, unsent);
        fs.writeFileSync(file, JSON.stringify(saved));
        const param = await cli([
          "pb",
          "param",
          "fixture",
          "submit",
          "query.variables.n",
          "--as",
          "year",
          "--json",
        ]);
        expect(param).toMatchObject({ code: 0, stderr: "" });
        const op = JSON.parse(fs.readFileSync(file, "utf8"));
        expect({ key: op.safety.key, inputs: Object.keys(op.args) }).toEqual({
          key: ["year"],
          inputs: ["year"],
        });

        const before = posts().length;
        const use = (...args: string[]) =>
          cli(["use", "fixture", "submit", "--year", "2031", ...args, "--write", "--json"]);
        expect((await use("--text", "one")).stderr).toMatch(/Unknown input --text/);
        expect((await use()).code).toBe(0);
        const again = await use();
        expect(again.code).toBe(1);
        expect(again.stderr).toMatch(
          /write blocked: attempt \S+ was sent at .+ and succeeded\. Add --repeat/,
        );
        expect(posts().length - before).toBe(1);
      } finally {
        await host.dispose();
      }
    }, 60000);
  }

  // The record keeps the type of a number it masked (redactedTypes) under the JSON key it sat at,
  // here a key reading {{text}}. That note is never sent, so it gives the op no input: the safety
  // key is review_key, and the same review key is blocked as a duplicate whatever else is given.
  for (const [label, field, input, value] of [
    ["the masked number", "query.variables.{{text}}", "year", "2031"],
    ["the whole JSON param", "query.variables", "variables", '{"{{text}}":2031}'],
  ]) {
    it(`keys a recorded write on what it sends, not the record's notes, after pb param on ${label}`, async () => {
      const socketPath = createSocketPath();
      const project = fs.mkdtempSync(path.join(os.tmpdir(), "surf-record-notes-"));
      tempDirs.push(project);
      const page = { url: jsonQueryUrl({ "{{text}}": 2024 }) };
      const host = startHost(socketPath, { recording: true, scriptResponse: page });
      const cli = (args: string[]) =>
        runCli(socketPath, args, project, { SURF_STATE_DIR: host.stateDir });
      const posts = () => host.messages.filter((message) => message.type === "EXECUTE_JAVASCRIPT");

      try {
        await host.waitForMessage((message) => message.type === "HOST_READY");
        await saveRecordedWrite({ cli, page, typed: ["2024"] });
        const param = await cli([
          "pb",
          "param",
          "fixture",
          "submit",
          field,
          "--as",
          input,
          "--required",
          "--json",
        ]);
        expect(param).toMatchObject({ code: 0, stderr: "" });
        const op = JSON.parse(
          fs.readFileSync(
            path.join(project, ".surf", "playbooks", "fixture", "ops", "submit.json"),
            "utf8",
          ),
        );
        expect(op.safety.key).toEqual(["review_key"]);
        expect(Object.keys(op.args).sort()).toEqual([input, "review_key"].sort());

        const before = posts().length;
        const use = (...args: string[]) =>
          cli(["use", "fixture", "submit", `--${input}`, value, ...args, "--write", "--json"]);
        const byText = await use("--text", "one", "--review_key", "k");
        expect(byText.code).toBe(1);
        expect(byText.stderr).toMatch(/Unknown input --text/);
        expect((await use("--review_key", "k")).code).toBe(0);
        const again = await use("--review_key", "k");
        expect(again.code).toBe(1);
        expect(again.stderr).toMatch(
          /write blocked: attempt \S+ was sent at .+ and succeeded\. Add --repeat/,
        );
        expect(posts().length - before).toBe(1);
      } finally {
        await host.dispose();
      }
    }, 60000);
  }

  // A JSON query param is stored escaped as one string, its keys with it. pb param names a key by
  // the text it was captured as, so a masked number there keeps its type, and every key goes out
  // as captured; an input's value is sent as given, {{!}} and %{!} included. (The next test has a
  // masked boolean.)
  it("templates a recorded JSON key that reads like an input, and sends it and each input as given", async () => {
    const socketPath = createSocketPath();
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "surf-record-json-key-"));
    tempDirs.push(project);
    const vm = require("node:vm") as {
      runInNewContext(code: string, context: Record<string, unknown>): unknown;
    };
    const sent: string[] = [];
    const tab = {
      URL,
      location: { href: "https://fixture.test/form" },
      fetch: async (url: string) => {
        sent.push(url);
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
    const page = {
      url: jsonQueryUrl({ "{{field}}": 2024, "{{flag}}": true, note: "seed", "{{!}}kept": 1 }),
    };
    const host = startHost(socketPath, {
      recording: true,
      scriptResponse: page,
      // The tab runs the request to see what it sends; the answer is the fake extension's, so
      // network capture finds the request it recorded.
      runScript: async (code) => {
        if (running) {
          await vm.runInNewContext(code, { ...tab });
        }
        const at = Date.now();
        return {
          output: JSON.stringify({
            status: 200,
            ok: true,
            url: "https://fixture.test/api",
            headers: {},
            sentAt: at,
            doneAt: at,
          }),
        };
      },
    });
    const cli = (args: string[]) =>
      runCli(socketPath, args, project, { SURF_STATE_DIR: host.stateDir });
    const param = (field: string, input: string) =>
      cli(["pb", "param", "fixture", "submit", field, "--as", input, "--json"]);

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      await saveRecordedWrite({ cli, page, typed: ["2024"] });
      expect(await param("query.variables.{{field}}", "year")).toMatchObject({
        code: 0,
        stderr: "",
      });
      expect(await param("query.variables.note", "note")).toMatchObject({ code: 0, stderr: "" });
      const op = JSON.parse(
        fs.readFileSync(
          path.join(project, ".surf", "playbooks", "fixture", "ops", "submit.json"),
          "utf8",
        ),
      );
      expect(op.args.year).toMatchObject({ type: "number", required: true });
      expect(op.run[0].request).not.toHaveProperty("redactedTypes");

      running = true;
      const notes = ["{{!}}x%{!}", "{{field}}", "%{note}"];
      for (const [index, note] of notes.entries()) {
        const ran = await cli([
          "use",
          "fixture",
          "submit",
          "--year",
          String(2031 + index),
          "--note",
          note,
          "--review_key",
          `k${index}`,
          "--write",
          "--json",
        ]);
        expect(ran).toMatchObject({ code: 0, stderr: "" });
      }
      expect(
        sent.map((url) => JSON.parse(new URL(url).searchParams.get("variables") ?? "")),
      ).toEqual(
        notes.map((note, index) => ({
          "{{field}}": 2031 + index,
          "{{flag}}": true,
          note,
          "{{!}}kept": 1,
        })),
      );
    } finally {
      await host.dispose();
    }
  }, 60000);

  // pb param on part of a JSON query param's text leaves it a string holding a live {{a}}; a
  // field templated inside it next keeps that input, so the replay sends each input as given and
  // the captured text as captured.
  it("keeps an input in a JSON param's text when a field inside it is templated next", async () => {
    const socketPath = createSocketPath();
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "surf-record-json-steps-"));
    tempDirs.push(project);
    const vm = require("node:vm") as {
      runInNewContext(code: string, context: Record<string, unknown>): unknown;
    };
    const sent: string[] = [];
    const tab = {
      URL,
      location: { href: "https://fixture.test/form" },
      fetch: async (url: string) => {
        sent.push(url);
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
    const raw = String.raw`{"a":"first-seed","b":"second-seed","c":"third-seed","literal":"{{keep}}","esc":"\u007b\u007bx}}","\u007b\u007b!}}k":1}`;
    const page = { url: `https://fixture.test/api?v=${encodeURIComponent(raw)}` };
    const host = startHost(socketPath, {
      recording: true,
      scriptResponse: page,
      runScript: async (code) => {
        if (running) {
          await vm.runInNewContext(code, { ...tab });
        }
        const at = Date.now();
        return {
          output: JSON.stringify({
            status: 200,
            ok: true,
            url: "https://fixture.test/api",
            headers: {},
            sentAt: at,
            doneAt: at,
          }),
        };
      },
    });
    const cli = async (args: string[]) => {
      const result = await runCli(socketPath, args, project, { SURF_STATE_DIR: host.stateDir });
      expect(result.code, `surf ${args.join(" ")}: ${result.stderr}`).toBe(0);
      return result;
    };
    const opFile = path.join(project, ".surf", "playbooks", "fixture", "ops", "probe.json");
    const given: Record<string, string> = {
      a: "live-a{{!}}%{!}",
      b: "live-b{{!}}%{!}",
      c: "live-c",
    };
    const orders = [
      [
        ["query.v", "a", "first-seed"],
        ["query.v.b", "b"],
      ],
      [
        ["query.v", "b", "second-seed"],
        ["query.v.a", "a"],
      ],
      [
        ["query.v", "a", "first-seed"],
        ["query.v", "b", "second-seed"],
        ["query.v.c", "c"],
      ],
    ];

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      await cli(["navigate", "https://fixture.test/form"]);
      await cli(["pb", "record", "start", "fixture", "--op", "probe", "--network"]);
      await cli(["js", 'fetch("/api")']);
      const { record } = JSON.parse(
        (await cli(["pb", "record", "stop", "--draft", "--read", "--json"])).stdout,
      );
      await cli(["pb", "save", "--from-record", record.id, "--project", "--json"]);
      const saved = fs.readFileSync(opFile, "utf8");
      page.url = "https://fixture.test/api";
      running = true;
      for (const steps of orders) {
        fs.writeFileSync(opFile, saved);
        for (const [field, input, value] of steps) {
          await cli([
            "pb",
            "param",
            "fixture",
            "probe",
            field,
            "--as",
            input,
            ...(value ? ["--value", value] : []),
            "--json",
          ]);
        }
        const inputs = steps.map(([, input]) => input);
        sent.length = 0;
        await cli([
          "use",
          "fixture",
          "probe",
          ...inputs.flatMap((input) => [`--${input}`, given[input]]),
          "--json",
        ]);
        expect(
          sent.map((url) => JSON.parse(new URL(url).searchParams.get("v") ?? "")),
          inputs.join(" then "),
        ).toEqual([
          {
            ...JSON.parse(raw),
            ...Object.fromEntries(inputs.map((input) => [input, given[input]])),
          },
        ]);
      }
    } finally {
      await host.dispose();
    }
  }, 60000);

  // pb param on part of a JSON query param's text can put an input in a key, beside a captured
  // key that reads the same, {{key}}. A field templated next keeps both keys: the replay sends the
  // input's key as given and the captured one as captured, and a field naming {{key}} is refused.
  it("keeps an input in a JSON param's key when a field inside it is templated next", async () => {
    const socketPath = createSocketPath();
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "surf-record-json-key-"));
    tempDirs.push(project);
    const vm = require("node:vm") as {
      runInNewContext(code: string, context: Record<string, unknown>): unknown;
    };
    const sent: string[] = [];
    const tab = {
      URL,
      location: { href: "https://fixture.test/form" },
      fetch: async (url: string) => {
        sent.push(url);
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
    const raw = String.raw`{"seed-key":"kept","{{key}}":"literal","{{field}}":"f","\u007b\u007bx}}":"esc","n":"start","m":"other"}`;
    const page = {
      url: `https://fixture.test/api?v=${encodeURIComponent(raw)}`,
    };
    const host = startHost(socketPath, {
      recording: true,
      scriptResponse: page,
      runScript: async (code) => {
        if (running) {
          await vm.runInNewContext(code, { ...tab });
        }
        const at = Date.now();
        return {
          output: JSON.stringify({
            status: 200,
            ok: true,
            url: "https://fixture.test/api",
            headers: {},
            sentAt: at,
            doneAt: at,
          }),
        };
      },
    });
    const run = (args: string[]) =>
      runCli(socketPath, args, project, { SURF_STATE_DIR: host.stateDir });
    const cli = async (args: string[]) => {
      const result = await run(args);
      expect(result.code, `surf ${args.join(" ")}: ${result.stderr}`).toBe(0);
      return result;
    };
    const opFile = path.join(project, ".surf", "playbooks", "fixture", "ops", "probe.json");
    const given: Record<string, string> = {
      key: "live-key{{!}}%{!}",
      n: "N{{!}}%{!}",
      m: "M",
    };
    // What the replay sends once `input` takes `field`: --value seed-key puts it in that key.
    const sentAfter = (expected: Record<string, unknown>, field: string, input: string) => {
      if (field === "query.v" && input === "key") {
        const { "seed-key": kept, ...rest } = expected;
        return { ...rest, [given.key]: kept };
      }
      return {
        ...expected,
        [field === "query.v" ? input : field.slice("query.v.".length)]: given[input],
      };
    };
    // The reviewer's order, a key then a field, and a value in the text before the key.
    const orders = [
      [
        ["query.v", "key", "seed-key"],
        ["query.v.n", "n"],
      ],
      [
        ["query.v", "n", "start"],
        ["query.v", "key", "seed-key"],
        ["query.v.m", "m"],
      ],
    ];

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      await cli(["navigate", "https://fixture.test/form"]);
      await cli(["pb", "record", "start", "fixture", "--op", "probe", "--network"]);
      await cli(["js", 'fetch("/api")']);
      const { record } = JSON.parse(
        (await cli(["pb", "record", "stop", "--draft", "--read", "--json"])).stdout,
      );
      await cli(["pb", "save", "--from-record", record.id, "--project", "--json"]);
      const saved = fs.readFileSync(opFile, "utf8");
      page.url = "https://fixture.test/api";
      running = true;
      for (const steps of orders) {
        fs.writeFileSync(opFile, saved);
        let expected: Record<string, unknown> = JSON.parse(raw);
        const inputs: string[] = [];
        for (const [field, input, value] of steps) {
          await cli([
            "pb",
            "param",
            "fixture",
            "probe",
            field,
            "--as",
            input,
            ...(value ? ["--value", value] : []),
            "--json",
          ]);
          inputs.push(input);
          expected = sentAfter(expected, field, input);
          sent.length = 0;
          await cli([
            "use",
            "fixture",
            "probe",
            ...inputs.flatMap((name) => [`--${name}`, given[name]]),
            "--json",
          ]);
          expect(
            sent.map((url) => JSON.parse(new URL(url).searchParams.get("v") ?? "")),
            inputs.join(" then "),
          ).toEqual([expected]);
        }
        const refused = await run([
          "pb",
          "param",
          "fixture",
          "probe",
          "query.v.{{key}}",
          "--as",
          "k",
          "--json",
        ]);
        expect(refused.code).not.toBe(0);
        expect(refused.stderr).toContain('more than one key at the top level reads "{{key}}"');
      }
    } finally {
      await host.dispose();
    }
  }, 60000);

  // The CLI types `true` as a boolean; the record holds it as the text it typed, as it does a
  // number, so a URL that sends it is masked in the trace, the saved op and the HAR, and a JSON
  // `true` there becomes a boolean input.
  it("masks a typed boolean in a recorded URL and keeps its type in a JSON value", async () => {
    const socketPath = createSocketPath();
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "surf-record-boolean-"));
    tempDirs.push(project);
    const page = {
      url: `https://fixture.test/api?q=true&v=${encodeURIComponent('{"flag":true}')}`,
    };
    const host = startHost(socketPath, { recording: true, scriptResponse: page });
    const cli = async (args: string[]) => {
      const result = await runCli(socketPath, args, project, { SURF_STATE_DIR: host.stateDir });
      expect(result.code, `surf ${args.join(" ")}: ${result.stderr}`).toBe(0);
      return result;
    };
    const { recordsRoot } = require("../../native/playbook-records.cjs") as {
      recordsRoot(root: string): string;
    };

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      await cli(["navigate", "https://fixture.test/form"]);
      await cli(["pb", "record", "start", "fixture", "--op", "probe", "--network"]);
      await cli(["type", "true", "--selector", "#field"]);
      expect(host.messages.find((message) => message.type === "SMART_TYPE")).toMatchObject({
        text: true,
      });
      await cli(["js", 'fetch("/api")']);
      const { record } = JSON.parse(
        (await cli(["pb", "record", "stop", "--draft", "--read", "--json"])).stdout,
      );
      // The JSON `true` becomes the string "<text>", noted as a boolean in the saved op.
      const masked = "https://fixture.test/api?q=<text>&v=%7B%22flag%22%3A%22<text>%22%7D";
      const trace = JSON.parse(
        fs.readFileSync(
          path.join(recordsRoot(host.stateDir), record.id, "network", "trace.json"),
          "utf8",
        ),
      );
      expect(trace.entries.map((entry: { url: string }) => entry.url)).toEqual([masked]);
      const har = path.join(project, "trace.har");
      await cli(["pb", "trace", "export", "--from-record", record.id, "--har", har]);
      expect(
        JSON.parse(fs.readFileSync(har, "utf8")).log.entries.map(
          (entry: { request: { url: string } }) => entry.request.url,
        ),
      ).toEqual([masked]);

      await cli(["pb", "save", "--from-record", record.id, "--project", "--json"]);
      const opFile = path.join(project, ".surf", "playbooks", "fixture", "ops", "probe.json");
      const saved = JSON.parse(fs.readFileSync(opFile, "utf8"));
      const request = saved.run.find((step: { using: string }) => step.using === "network").request;
      expect(JSON.stringify(request)).not.toContain("true");
      expect(request.redactedTypes).toEqual({ "query.v.flag": "boolean" });

      await cli(["pb", "param", "fixture", "probe", "query.v.flag", "--as", "live", "--json"]);
      const op = JSON.parse(fs.readFileSync(opFile, "utf8"));
      expect(op.args.live).toEqual({ type: "boolean", required: true });
      expect(
        op.run.find((step: { using: string }) => step.using === "network").request.query.v,
      ).toEqual({
        flag: "{{live}}",
      });
    } finally {
      await host.dispose();
    }
  }, 60000);

  // A draft's extract runs in the tab after the answer; a read whose extract fails, the page it
  // prepares from the response included, goes on to its recorded steps.
  it("runs a recorded read's steps when its extract can't prepare the response", async () => {
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
      expect(run.code).toBe(0);
      const result = JSON.parse(run.stdout);
      expect(result).toMatchObject({ strategy: "workflow" });
      expect(result.attempts[0].error).toContain("Invalid URL");
      expect(sent().slice(before)).toEqual(["EXECUTE_JAVASCRIPT", "EXECUTE_NAVIGATE"]);
    } finally {
      await host.dispose();
    }
  }, 60000);

  // A read's recorded steps are its fallback when the request is answered with a 401, and when a
  // draft's check fails.
  it("runs a recorded read's steps after a 401, and after a failed check", async () => {
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
      expect(run.code).toBe(0);
      expect(JSON.parse(run.stdout)).toMatchObject({
        strategy: "workflow",
        attempts: [{ using: "network", error: "expected status 201" }],
      });
      expect(sent().slice(before)).toEqual(["EXECUTE_JAVASCRIPT", "EXECUTE_NAVIGATE"]);
    } finally {
      await host.dispose();
    }
  }, 60000);

  // A workflow starts with the op's inputs as its vars, so a step's %{text} types --text: pb param
  // keeps that input, though the request no longer takes it and a check names it, in a hand-written
  // op and in one marked escaped alike, until --link names it.
  for (const escaped of [false, true]) {
    it(`keeps an input a workflow step reads as a var after pb param${escaped ? ", in an escaped op" : ""}`, async () => {
      const socketPath = createSocketPath();
      const project = fs.mkdtempSync(path.join(os.tmpdir(), "surf-workflow-var-"));
      tempDirs.push(project);
      const opsDir = path.join(project, ".surf", "playbooks", "manual", "ops");
      fs.mkdirSync(opsDir, { recursive: true });
      fs.writeFileSync(
        path.join(project, ".surf", "playbooks", "manual", "playbook.json"),
        JSON.stringify({ id: "manual", version: "1.0.0", origins: ["https://fixture.test"] }),
      );
      const file = path.join(opsDir, "find.json");
      // Its request fails its check, so the op goes on to its steps.
      fs.writeFileSync(
        file,
        JSON.stringify({
          id: "find",
          effect: "read",
          ...(escaped ? { provenance: { escaped: true } } : {}),
          args: { text: { required: true } },
          run: [
            {
              using: "network",
              request: { method: "GET", url: "https://fixture.test/api", query: { q: "<text>" } },
              verify: { status: 201, note: "{{text}}" },
            },
            {
              using: "workflow",
              steps: [{ cmd: "type", args: { text: "%{text}", selector: "#field" } }],
            },
          ],
        }),
      );
      const host = startHost(socketPath, { recording: true });
      const cli = (args: string[]) =>
        runCli(socketPath, args, project, { SURF_STATE_DIR: host.stateDir });
      const typed = () =>
        host.messages
          .filter((message) => message.type === "SMART_TYPE")
          .map((message) => message.text);

      try {
        await host.waitForMessage((message) => message.type === "HOST_READY");
        const param = await cli([
          "pb",
          "param",
          "manual",
          "find",
          "query.q",
          "--as",
          "q",
          "--json",
        ]);
        expect(param).toMatchObject({ code: 0, stderr: "" });
        expect(Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).args).sort()).toEqual([
          "q",
          "text",
        ]);

        const found = await cli([
          "use",
          "manual",
          "find",
          "--q",
          "new",
          "--text",
          "dummy-typed",
          "--json",
        ]);
        expect(found).toMatchObject({ code: 0 });
        expect(typed()).toEqual(["dummy-typed"]);

        // --link gives the step the named input as a var too, so the page gets --q.
        const linked = await cli([
          "pb",
          "param",
          "manual",
          "find",
          "query.q",
          "--as",
          "q",
          "--required",
          "--link",
          "text",
          "--json",
        ]);
        expect(linked).toMatchObject({ code: 0, stderr: "" });
        const op = JSON.parse(fs.readFileSync(file, "utf8"));
        expect({ inputs: Object.keys(op.args), steps: op.run[1].steps }).toEqual({
          inputs: ["q"],
          steps: [{ cmd: "type", args: { text: "%{q}", selector: "#field" } }],
        });
        expect((await cli(["use", "manual", "find", "--q", "dummy-linked", "--json"])).code).toBe(
          0,
        );
        expect(typed()).toEqual(["dummy-typed", "dummy-linked"]);
      } finally {
        await host.dispose();
      }
    }, 60000);
  }

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
      expect(again.stderr).toMatch(
        /write blocked: attempt \S+ was sent at .+ and succeeded\. Add --repeat/,
      );
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

  // A record started without --include-input-values can still keep its values: the host reads
  // capture at stop, so pb record stop --include-input-values (or --raw) keeps the POST's body
  // and the typed value in its URL, and surf use --write sends that body.
  it.each([["--include-input-values"], ["--raw"]])(
    "keeps a record's request body and URL when stopped with %s",
    async (flag) => {
      const socketPath = createSocketPath();
      const project = fs.mkdtempSync(path.join(os.tmpdir(), "surf-record-stop-values-"));
      tempDirs.push(project);
      const typedText = ["dummy", "stop", "words"].join(" ");
      const body = JSON.stringify({ note: typedText, keep: "literal" });
      const capturedUrl = `https://fixture.test/api?q=${encodeURIComponent(typedText)}`;
      const page = {
        url: capturedUrl,
        requestHeaders: { "content-type": "application/json" },
        requestBody: body,
      };
      const host = startHost(socketPath, { recording: true, scriptResponse: page });
      const scripts = () =>
        host.messages
          .filter((message) => message.type === "EXECUTE_JAVASCRIPT")
          .map((message) => String(message.code));
      const cli = (args: string[]) =>
        runCli(socketPath, args, project, { SURF_STATE_DIR: host.stateDir });

      try {
        await host.waitForMessage((message) => message.type === "HOST_READY");
        expect((await cli(["navigate", "https://fixture.test/form"])).code).toBe(0);
        const started = await cli([
          "pb",
          "record",
          "start",
          "fixture",
          "--op",
          "submit",
          "--network",
          "--json",
        ]);
        expect(started.code).toBe(0);
        expect(JSON.parse(started.stdout).redaction).toEqual({ includeInputValues: false });
        expect((await cli(["type", typedText, "--selector", "#note"])).code).toBe(0);
        expect((await cli(["js", 'fetch("/api", { method: "POST" })'])).code).toBe(0);
        const stopped = await cli(["pb", "record", "stop", "--draft", flag, "--json"]);
        expect(stopped.code).toBe(0);
        const { record, draft } = JSON.parse(stopped.stdout);
        const trace = JSON.parse(
          fs.readFileSync(
            path.join(host.stateDir, "records", record.id, "network", "trace.json"),
            "utf8",
          ),
        );
        const post = trace.entries.find((entry: { method: string }) => entry.method === "POST");
        expect(post).toMatchObject({ url: capturedUrl, requestBody: body });
        const network = draft.run.find(
          (strategy: { using: string }) => strategy.using === "network",
        );
        expect(network.request).toMatchObject({ method: "POST", query: { q: typedText }, body });
        expect(record.redaction).toEqual({ includeInputValues: true });

        page.url = "https://fixture.test/api";
        const saved = await cli(["pb", "save", "--from-record", record.id, "--project", "--json"]);
        expect(saved).toMatchObject({ code: 0, stderr: "" });
        const before = scripts().length;
        const used = await cli([
          "use",
          "fixture",
          "submit",
          "--text",
          "dummy run",
          "--write",
          "--json",
        ]);
        expect(used.code).toBe(0);
        expect(JSON.parse(used.stdout)).toMatchObject({ strategy: "network" });
        // The one script surf use ran fetches with the recorded body.
        const posts = scripts().slice(before);
        expect(posts).toHaveLength(1);
        expect(posts[0]).toContain('method: "POST"');
        expect(posts[0]).toContain(`body: ${JSON.stringify(body)},`);
        expect(posts[0]).toContain(JSON.stringify({ q: typedText }));
      } finally {
        await host.dispose();
      }
    },
    60000,
  );

  // includeInputValues in the user's own ~/surf.json sets pb record start's default; the same key
  // in the project's surf.json, where surf runs, changes nothing.
  it("keeps a record's values by default only from ~/surf.json, never the project's", async () => {
    const socketPath = createSocketPath();
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "surf-record-config-"));
    tempDirs.push(scratch);
    const home = path.join(scratch, "home");
    const project = path.join(scratch, "project");
    for (const directory of [home, project]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    fs.writeFileSync(path.join(project, "surf.json"), JSON.stringify({ includeInputValues: true }));
    const host = startHost(socketPath, { recording: true });
    const cli = (args: string[]) =>
      runCli(socketPath, args, project, { SURF_STATE_DIR: host.stateDir, HOME: home });
    const startKeeps = async () => {
      const started = await cli([
        "pb",
        "record",
        "start",
        "fixture",
        "--op",
        "read",
        "--network",
        "--json",
      ]);
      expect(started.code).toBe(0);
      expect((await cli(["pb", "record", "discard"])).code).toBe(0);
      return JSON.parse(started.stdout).redaction.includeInputValues;
    };

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      expect((await cli(["navigate", "https://fixture.test/form"])).code).toBe(0);
      expect(await startKeeps()).toBe(false);
      fs.writeFileSync(path.join(home, "surf.json"), JSON.stringify({ includeInputValues: true }));
      expect(await startKeeps()).toBe(true);
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

  // A captured request with a secret header, a cookie, a secret query param and a body echoing
  // its Authorization value; dummy values built from parts.
  function rawFixture() {
    const auth = ["Bearer", ["dummy", "raw", "token", "18"].join("-")].join(" ");
    const cookie = ["dummy", "raw", "cookie", "18"].join("-");
    const query = ["dummy", "raw", "query", "18"].join("-");
    const entry: CapturedRequest = {
      id: "r_auth",
      ts: Date.now() - 60_000,
      method: "GET",
      url: `https://fixture.test/bearer?session_token=${query}`,
      type: "Fetch",
      requestHeaders: { Authorization: auth, Cookie: `sid=${cookie}`, Accept: "application/json" },
      status: 200,
      responseHeaders: { "content-type": "application/json" },
      mimeType: "application/json",
      responseBody: `{"headers":{"Authorization":"${auth}"}}`,
      flags: [],
      _loadingFinished: true,
    };
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "surf-network-raw-"));
    tempDirs.push(scratch);
    const env = { HOME: path.join(scratch, "home"), SURF_TMP: path.join(scratch, "tmp") };
    for (const directory of [env.HOME, env.SURF_TMP]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    return { auth, cookie, query, entry, scratch, env, secrets: [auth, cookie, query] };
  }

  it("prints captured secret headers, URL credentials and echoes as captured with --raw", async () => {
    const socketPath = createSocketPath();
    const { auth, entry, scratch, env, secrets } = rawFixture();
    const host = startHost(socketPath, {
      env,
      pageTraffic: [entry],
      navigationTraffic: [entry],
      scriptResponse: { mimeType: entry.mimeType, responseBody: entry.responseBody },
    });
    // What one view prints without and with --raw: `<redacted>` and none of `shown`, then all of it.
    const expectRawOnlyWithFlag = (label: string, plain: string, raw: string, shown: string[]) => {
      expect(plain, label).toContain("<redacted>");
      expect(raw, `${label} --raw`).not.toContain("<redacted>");
      for (const secret of shown) {
        expect(plain, label).not.toContain(secret);
        expect(raw, `${label} --raw`).toContain(secret);
      }
    };
    const cli = async (args: string[]) => {
      const run = await runCli(socketPath, args, scratch, env);
      expect(run.code, `${args.join(" ")}: ${run.stderr}`).toBe(0);
      return run.stdout;
    };
    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      expect(await cli(["network.curl", "r_auth", "--raw"])).toContain(
        `-H 'Authorization: ${auth}'`,
      );
      expect(await cli(["network.curl", "r_auth"])).toContain("-H 'Authorization: <redacted>'");

      // Request views show every secret; responses show the echo.
      const views: Array<[string[], string[]]> = [
        [["network.get", "r_auth"], secrets],
        [["network.get", "r_auth", "--json"], secrets],
        [["network.curl", "r_auth"], secrets],
        [["network", "-v"], secrets],
        [["network", "--format", "raw"], secrets],
        [["network", "--format", "curl"], secrets],
        [["network.body", "r_auth"], [auth]],
        [["network.wait", "/bearer", "--open", "https://fixture.test/", "--json"], [auth]],
        [["network.replay", "r_auth", "--json"], [auth]],
      ];
      for (const [args, shown] of views) {
        expectRawOnlyWithFlag(
          args.join(" "),
          await cli(args),
          await cli([...args, "--raw"]),
          shown,
        );
      }

      for (const format of [[], ["--har"]]) {
        const output = path.join(scratch, `export-${format.length}.json`);
        await cli(["network.export", ...format, "--output", output]);
        const plain = fs.readFileSync(output, "utf8");
        await cli(["network.export", ...format, "--output", output, "--raw"]);
        expectRawOnlyWithFlag(
          `network.export ${format.join(" ")}`,
          plain,
          fs.readFileSync(output, "utf8"),
          secrets,
        );
      }
    } finally {
      await host.dispose();
    }
  });

  it("ignores raw=true in a surf do file's step, a saved workflow's step and a playbook step", async () => {
    const socketPath = createSocketPath();
    const { entry, scratch, env, secrets } = rawFixture();
    const steps = [
      { tool: "network.get", args: { id: "r_auth", raw: true }, as: "entry" },
      { tool: "network.replay", args: { id: "r_auth", raw: true }, as: "replayed" },
    ];
    const file = path.join(scratch, "dump.json");
    fs.writeFileSync(file, JSON.stringify({ steps }));
    const workflows = path.join(scratch, ".surf", "workflows");
    fs.mkdirSync(workflows, { recursive: true });
    fs.writeFileSync(path.join(workflows, "dump.json"), JSON.stringify({ steps }));
    const ops = path.join(scratch, ".surf", "playbooks", "pw", "ops");
    fs.mkdirSync(ops, { recursive: true });
    fs.writeFileSync(
      path.join(ops, "..", "playbook.json"),
      JSON.stringify({ id: "pw", version: "1.0.0", origins: ["https://fixture.test"] }),
    );
    fs.writeFileSync(
      path.join(ops, "replay.json"),
      JSON.stringify({
        id: "replay",
        effect: "read",
        run: [{ using: "workflow", autoWait: false, stepDelay: 0, steps: [steps[1]] }],
      }),
    );
    const host = startHost(socketPath, {
      env,
      pageTraffic: [entry],
      scriptResponse: { mimeType: entry.mimeType, responseBody: entry.responseBody },
    });
    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      await runCli(socketPath, ["navigate", "https://fixture.test/"], scratch, env);
      const runs = [
        ["do", "--file", file, "--json", "--no-auto-wait", "--step-delay", "0"],
        ["do", "dump", "--json", "--no-auto-wait", "--step-delay", "0"],
        ["use", "pw", "replay", "--json"],
      ];
      for (const args of runs) {
        const run = await runCli(socketPath, args, scratch, env);
        expect(run.code, `${args.join(" ")}: ${run.stdout}${run.stderr}`).toBe(0);
        expect(run.stdout, args.join(" ")).toContain("<redacted>");
        for (const secret of secrets) {
          expect(run.stdout, args.join(" ")).not.toContain(secret);
        }
      }
    } finally {
      await host.dispose();
    }
  });

  // A saved playbook `pn` whose op `id` runs `steps` as a workflow.
  function writeWorkflowOp(scratch: string, id: string, steps: unknown[]) {
    const ops = path.join(scratch, ".surf", "playbooks", "pn", "ops");
    fs.mkdirSync(ops, { recursive: true });
    fs.writeFileSync(
      path.join(ops, "..", "playbook.json"),
      JSON.stringify({ id: "pn", version: "1.0.0", origins: ["https://fixture.test"] }),
    );
    fs.writeFileSync(
      path.join(ops, `${id}.json`),
      JSON.stringify({
        id,
        effect: "read",
        run: [{ using: "workflow", autoWait: false, stepDelay: 0, steps }],
      }),
    );
  }

  it("shows a playbook step's captured secrets as <redacted>, with or without raw, and still replays them", async () => {
    const socketPath = createSocketPath();
    const { auth, entry, scratch, env, secrets } = rawFixture();
    // Each view as a step, without and with raw; network.body prints the response, which
    // echoes only the Authorization value. A step can give the id as its first positional arg.
    const views = [
      { name: "network", tool: "network", args: { v: true }, hidden: secrets },
      { name: "network-get", tool: "network.get", args: { id: "r_auth" }, hidden: secrets },
      { name: "network-curl", tool: "network.curl", args: { id: "r_auth" }, hidden: secrets },
      { name: "network-body", tool: "network.body", args: { id: "r_auth" }, hidden: [auth] },
      { name: "network-body-arg", tool: "network.body", args: { "0": "r_auth" }, hidden: [auth] },
    ].flatMap((view) => [
      { ...view, id: view.name },
      { ...view, id: `${view.name}-raw`, args: { ...view.args, raw: true } },
    ]);
    for (const view of views) {
      writeWorkflowOp(scratch, view.id, [{ tool: view.tool, args: view.args, as: "view" }]);
    }
    writeWorkflowOp(scratch, "replay", [
      { tool: "network.replay", args: { id: "r_auth" }, as: "replayed" },
    ]);
    const host = startHost(socketPath, {
      env,
      pageTraffic: [entry],
      scriptResponse: { mimeType: entry.mimeType, responseBody: entry.responseBody },
    });
    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      await runCli(socketPath, ["navigate", "https://fixture.test/"], scratch, env);
      const runs = views.flatMap((view) => [
        { ...view, args: ["use", "pn", view.id, "--json"] },
        { ...view, args: ["use", "pn", view.id] },
      ]);
      for (const run of runs) {
        const label = run.args.join(" ");
        const printed = await runCli(socketPath, run.args, scratch, env);
        expect(printed.code, `${label}: ${printed.stdout}${printed.stderr}`).toBe(0);
        expect(printed.stdout, label).toContain("<redacted>");
        expect(
          run.hidden.filter((secret) => printed.stdout.includes(secret)),
          label,
        ).toEqual([]);
      }
      const replay = await runCli(socketPath, ["use", "pn", "replay", "--json"], scratch, env);
      expect(replay.code, replay.stderr).toBe(0);
      expect(replay.stdout).not.toContain(auth);
      const sent = host.messages.filter((message) => message.type === "EXECUTE_JAVASCRIPT");
      expect(JSON.stringify(sent.at(-1))).toContain(auth);
    } finally {
      await host.dispose();
    }
  });

  it.each([
    ["plain", ["dummy", "resy", "key", "18"].join("-")],
    ["quoted", ["dummy", 'quo"ted', "va\\lue", "18"].join("-")],
  ])(
    "hides an echoed auth parameter and cookie value in network.body, network.wait and network.replay (%s)",
    async (_label, key) => {
      const socketPath = createSocketPath();
      const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "surf-network-param-echo-"));
      tempDirs.push(scratch);
      const env = { HOME: path.join(scratch, "home"), SURF_TMP: path.join(scratch, "tmp") };
      for (const directory of [env.HOME, env.SURF_TMP]) {
        fs.mkdirSync(directory, { recursive: true });
      }
      const sid = ["dummy", "sid", "value", "18"].join("-");
      // The value echoed on its own, as a JSON string and inside a URL, never as the whole header.
      const echo = {
        mimeType: "application/json",
        responseBody: JSON.stringify({
          key,
          sid,
          url: `https://fixture.test/?k=${encodeURIComponent(key)}`,
        }),
      };
      const sentWithAuth = {
        id: "r_echo",
        ts: Date.now() - 60_000,
        method: "GET",
        url: "https://fixture.test/headers",
        type: "Fetch",
        requestHeaders: {
          Authorization: `ResyAPI api_key="${key.replace(/["\\]/g, "\\$&")}"`,
          Cookie: `lang=en; sid=${sid}`,
          Accept: "application/json",
        },
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
      try {
        await host.waitForMessage((message) => message.type === "HOST_READY");
        const views = [
          ["network.body", "r_echo"],
          ["network.wait", "/headers", "--open", "https://fixture.test/", "--json"],
          ["network.wait", "/headers", "--open", "https://fixture.test/"],
          ["network.replay", "r_echo", "--json"],
          ["network.replay", "r_echo"],
        ];
        for (const args of views) {
          const view = await runCli(socketPath, args, scratch, env);
          expect(view.code, `${args.join(" ")}: ${view.stderr}`).toBe(0);
          expect(view.stdout, args.join(" ")).toContain("<redacted>");
          expect(view.stdout, args.join(" ")).not.toContain("dummy");
          if (args.includes("--json")) {
            const printed = JSON.parse(view.stdout);
            const response = printed.result ?? printed;
            const json = response.json ?? JSON.parse(response.body);
            expect(json, args.join(" ")).toMatchObject({ key: "<redacted>", sid: "<redacted>" });
          }
        }
      } finally {
        await host.dispose();
      }
    },
  );

  it("redacts a body key that is a long or a quoted secret in network.get --json and network.body", async () => {
    const socketPath = createSocketPath();
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "surf-network-key-echo-"));
    tempDirs.push(scratch);
    const env = { HOME: path.join(scratch, "home"), SURF_TMP: path.join(scratch, "tmp") };
    for (const directory of [env.HOME, env.SURF_TMP]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    // Dummy values, built from parts so no literal here reads as a credential.
    const long = ["dummy", "long", "key", "23"].join("-");
    const quoted = ["dummy", 'quo"ted', "va\\lue", "23"].join("-");
    const body = JSON.stringify({ [long]: "ok", [quoted]: "ok", n: 1 });
    const host = startHost(socketPath, {
      env,
      pageTraffic: [
        {
          id: "r_key",
          ts: Date.now() - 60_000,
          method: "POST",
          url: "https://fixture.test/anything",
          type: "Fetch",
          requestHeaders: {
            Authorization: `ResyAPI api_key="${quoted.replace(/["\\]/g, "\\$&")}"`,
            "x-api-key": long,
          },
          requestBody: body,
          status: 200,
          mimeType: "application/json",
          responseHeaders: { "content-type": "application/json" },
          responseBody: body,
          flags: [],
          _loadingFinished: true,
        },
      ],
    });
    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      const expected = { "<redacted>": "ok", "<redacted-2>": "ok", n: 1 };
      const get = await runCli(socketPath, ["network.get", "r_key", "--json"], scratch, env);
      expect(get.code, get.stderr).toBe(0);
      expect(get.stdout).not.toContain("dummy");
      const printed = JSON.parse(get.stdout);
      const entry = printed.entry ?? printed.result?.entry ?? printed;
      expect(JSON.parse(entry.requestBody)).toEqual(expected);
      expect(JSON.parse(entry.responseBody)).toEqual(expected);
      const read = await runCli(socketPath, ["network.body", "r_key"], scratch, env);
      expect(read.code, read.stderr).toBe(0);
      expect(read.stdout).toContain("<redacted-2>");
      expect(read.stdout).not.toContain("dummy");
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

  it("masks a host-only env value that surf's own fields and the response spell together", async () => {
    const socketPath = createSocketPath();
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "surf-host-envelope-"));
    tempDirs.push(project);
    const opsDir = path.join(project, ".surf", "playbooks", "api", "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    fs.writeFileSync(
      path.join(project, ".surf", "playbooks", "api", "playbook.json"),
      JSON.stringify({ id: "api", version: "1.0.0", origins: ["https://fixture.test"] }),
    );
    fs.writeFileSync(
      path.join(opsDir, "url.json"),
      JSON.stringify({
        id: "url",
        effect: "read",
        run: [
          {
            using: "network",
            request: {
              method: "GET",
              url: "https://fixture.test/api",
              authInputs: [{ env: "SURF_E2E_HOST_ONLY_KEY", header: "X-Site-Key" }],
            },
            extract: { field: "url" },
          },
        ],
      }),
    );
    // The printed result's `"value": "<the response's url>"`, from the key on.
    const secret = ['value": "', "https://fixture.test/api"].join("");
    const host = startHost(socketPath, { env: { SURF_E2E_HOST_ONLY_KEY: secret } });
    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      const run = await runCli(socketPath, ["use", "api", "url", "--json"], project);
      expect(run.code).toBe(0);
      expect(JSON.parse(run.stdout)).toMatchObject({ status: "completed", value: "<redacted>" });
      expect(run.stdout).not.toContain(secret);
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
