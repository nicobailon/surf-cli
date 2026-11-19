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
  // What the tab's script returns, from its code; the default answers a JSON fetch.
  javascript?: (code: string) => unknown;
  // The requests network capture holds when they are read.
  network?: () => Record<string, unknown>[];
};

// Messages the fake answers with success and nothing else: capture, waits and page actions.
const ACKNOWLEDGED = new Set([
  "START_NETWORK_CAPTURE",
  "STOP_NETWORK_CAPTURE",
  "WAIT_FOR_NETWORK_IDLE",
  "WAIT_FOR_DOM_STABLE",
  "SMART_TYPE",
  "EXECUTE_KEY",
  "CLICK_SELECTOR",
  "SCROLL_TO_POSITION",
]);

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
  mkdirSync(targetPath: string, options: { recursive: boolean }): void;
  mkdtempSync(prefix: string): string;
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

function buildExtensionResponse(
  message: NativeMessage,
  currentUrl: string,
  options: FakeHostOptions,
) {
  const targetActive = options.targetActive !== false;
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
    case "WAIT_FOR_LOAD":
      return { id: message.id, success: true };
    case "GET_PLAYBOOK_RECORD_CONTEXT":
      return { id: message.id, success: true, origin: new URL(currentUrl).origin, url: currentUrl };
    case "READ_NETWORK_REQUESTS":
      return { id: message.id, entries: options.network?.() ?? [], capture: { active: true } };
    case "EXECUTE_JAVASCRIPT":
      if (options.javascript) {
        return { id: message.id, output: JSON.stringify(options.javascript(String(message.code))) };
      }
      return {
        id: message.id,
        output: JSON.stringify({
          status: 200,
          ok: true,
          url: "https://fixture.test/api",
          body: '{"ok":true}',
          bodyJson: { ok: true },
        }),
      };
    default:
      if (ACKNOWLEDGED.has(String(message.type))) {
        return { id: message.id, success: true };
      }
      return { id: message.id, error: `Unhandled fake extension message: ${message.type}` };
  }
}

function startHost(socketPath: string, options: FakeHostOptions = {}) {
  const hostPath = path.join(process.cwd(), "native", "host.cjs");
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surf-e2e-state-"));
  tempDirs.push(stateDir);
  const child = spawn(process.execPath, [hostPath], {
    cwd: process.cwd(),
    env: { ...process.env, SURF_SOCKET: socketPath, SURF_STATE_DIR: stateDir },
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
      writeNativeMessage(child.stdin, buildExtensionResponse(message, currentUrl, options));
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

  it("runs a flat op end to end, an old run-list op, pb test and --dry-run", async () => {
    const socketPath = createSocketPath();
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "surf-op-project-"));
    tempDirs.push(project);
    const site = path.join(project, ".surf", "playbooks", "books");
    fs.mkdirSync(path.join(site, "ops"), { recursive: true });
    const writeOp = (op: Record<string, unknown>) =>
      fs.writeFileSync(path.join(site, "ops", `${String(op.id)}.json`), JSON.stringify(op));
    fs.writeFileSync(
      path.join(site, "playbook.json"),
      JSON.stringify({ id: "books", version: "1.0.0" }),
    );
    const listBooks = {
      id: "list_books",
      description: "Books on one catalogue page",
      args: { page: { default: 1, example: 2 } },
      request: {
        url: "https://books.toscrape.com/catalogue/page-{{page}}.html",
        headers: { "x-token": "{{env.SURF_E2E_TOKEN}}" },
      },
      extract: {
        records: "article.product_pod",
        fields: { title: "h3 a@title", price: ".price_color", url: "h3 a@href" },
      },
      page: { into: "page", next: "+1" },
      expect: { minItems: 1, fields: ["title", "url"] },
    };
    writeOp(listBooks);
    writeOp({ ...listBooks, id: "broken", expect: { fields: ["isbn"] } });
    writeOp({
      id: "old_read",
      run: [
        {
          using: "network",
          request: { method: "GET", url: "https://books.toscrape.com/" },
          extract: { field: "status" },
          expect: { truthy: true },
        },
      ],
    });
    const html = fs.readFileSync(
      path.join(process.cwd(), "test", "fixtures", "sites", "books-page-1.html"),
      "utf8",
    );
    const codes: string[] = [];
    const host = startHost(socketPath, {
      javascript: (code) => {
        codes.push(code);
        const url = code.match(/https:\/\/books\.toscrape\.com\/[^"]*/)?.[0];
        if (url?.endsWith("page-50.html")) {
          return { status: 404, ok: false, url, body: "" };
        }
        return { status: 200, ok: true, url, contentType: "text/html", body: html };
      },
    });
    const env = { SURF_E2E_TOKEN: "tok-123" };
    const sent = () =>
      host.messages.filter((message) =>
        ["EXECUTE_JAVASCRIPT", "EXECUTE_NAVIGATE", "TARGET_RESOLVE", "TARGET_INSPECT"].includes(
          String(message.type),
        ),
      ).length;

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      const used = await runCli(
        socketPath,
        ["use", "books", "list_books", "--page", "2", "--pages", "2", "--json"],
        project,
        env,
      );
      expect(used.stderr).toBe("");
      expect(used.code).toBe(0);
      const result = JSON.parse(used.stdout);
      expect(result).toMatchObject({ status: "completed", via: "tab", op: "list_books" });
      expect(result.value).toHaveLength(6);
      expect(result.value[0]).toEqual({
        title: "A Light in the Attic",
        price: "£51.77",
        url: "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
      });
      expect(codes.map((code) => code.match(/page-\d+/)?.[0])).toEqual(["page-2", "page-3"]);
      expect(codes[0]).toContain("tok-123");

      const last = await runCli(
        socketPath,
        ["use", "books", "list_books", "--page", "49", "--pages", "3", "--json"],
        project,
        env,
      );
      expect(last.code).toBe(0);
      expect(JSON.parse(last.stdout).value).toHaveLength(3);

      const old = await runCli(socketPath, ["use", "books", "old_read", "--json"], project);
      expect(old.code).toBe(0);
      expect(JSON.parse(old.stdout)).toMatchObject({ strategy: "network", value: 200 });

      const one = await runCli(socketPath, ["pb", "test", "books", "list_books"], project, env);
      expect(one).toMatchObject({ code: 0 });
      expect(one.stdout).toMatch(/^pass +list_books +3 records via tab$/m);
      expect(codes.at(-1)).toContain("page-2.html");

      const all = await runCli(socketPath, ["pb", "test", "books"], project, env);
      expect(all.code).toBe(1);
      expect(all.stdout).toMatch(/^fail +broken +.*expected field isbn in the first record/m);
      expect(all.stdout).toMatch(/^pass +list_books /m);
      expect(all.stdout).toMatch(/^pass +old_read /m);

      const before = sent();
      const dry = await runCli(
        socketPath,
        ["use", "books", "list_books", "--page", "7", "--dry-run", "--json"],
        project,
        env,
      );
      expect(dry.code).toBe(0);
      expect(JSON.parse(dry.stdout)).toMatchObject({
        dryRun: true,
        request: {
          method: "GET",
          url: "https://books.toscrape.com/catalogue/page-7.html",
          headers: { "x-token": "{{env.SURF_E2E_TOKEN}}" },
        },
      });
      expect(sent()).toBe(before);
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

describe("surf hook and pb record stop through the fake extension", () => {
  const readFixture = (name: string) =>
    fs.readFileSync(path.join(process.cwd(), "test", "fixtures", "sites", name), "utf8");
  const opFile = (site: string, op: string) =>
    path.join(String(process.env.HOME), ".surf", "playbooks", site, "ops", `${op}.json`);
  const exists = (file: string) => {
    try {
      fs.readFileSync(file, "utf8");
      return true;
    } catch {
      return false;
    }
  };
  // Tests share HOME, so each saves under its own playbook name.
  const unique = (name: string) =>
    `${name}-${process.pid}-${Math.random().toString(16).slice(2, 8)}`;
  let seq = 0;
  const captured = (url: string, fields: Record<string, unknown> = {}) => ({
    id: `r_${++seq}`,
    method: "GET",
    status: 200,
    type: "Document",
    mimeType: "text/html",
    url,
    ts: Date.now() - 60_000,
    requestHeaders: {},
    ...fields,
  });
  // The tab shows `text` on `pageUrl` and answers each fetch with the body for its URL.
  const tab =
    (pageUrl: string, text: string, bodies: Record<string, string>, codes: string[]) =>
    (code: string) => {
      codes.push(code);
      if (code.includes("innerText")) {
        return { url: pageUrl, text };
      }
      const url = code.match(/new URL\("([^"]+)"\)/)?.[1] ?? "";
      const body = bodies[url];
      if (body === undefined) {
        return { status: 404, url, contentType: "text/html", body: "" };
      }
      return {
        status: 200,
        url,
        contentType: body.startsWith("<") ? "text/html" : "application/json",
        body,
      };
    };
  const fetches = (codes: string[]) => codes.filter((code) => code.includes("fetch("));

  it("saves a tested op from a listing, which pb test then passes", async () => {
    const socketPath = createSocketPath();
    const site = unique("books");
    const html = readFixture("books-page-1.html");
    const page = "https://books.toscrape.com/catalogue/page-2.html";
    const codes: string[] = [];
    const host = startHost(socketPath, {
      network: () => [
        captured(page, { responseBody: html }),
        captured("https://books.toscrape.com/static/main.css", {
          type: "Stylesheet",
          mimeType: "text/css",
        }),
      ],
      javascript: tab(
        page,
        "A Light in the Attic £51.77 Tipping the Velvet £53.74",
        { [page]: html },
        codes,
      ),
    });

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      const hooked = await runCli(socketPath, [
        "hook",
        "https://books.toscrape.com/catalogue/page-{{page}}.html",
        "--page",
        "2",
        "--goal",
        "books with prices",
        "--as",
        `${site}/list_books`,
      ]);
      expect(hooked.stderr).toBe("");
      expect(hooked.code).toBe(0);
      expect(hooked.stdout).toMatch(
        /^picked +GET https:\/\/books\.toscrape\.com\/catalogue\/page-2\.html +HTML document$/m,
      );
      expect(hooked.stdout).toMatch(/^inputs +--page \(default 2\)$/m);
      expect(hooked.stdout).toMatch(
        /^extract +article\.product_pod → title, url, star_rating, price_color$/m,
      );
      expect(hooked.stdout).toMatch(/^paging +--pages: page \+1$/m);
      expect(hooked.stdout).toMatch(/^test +tab ✓ 3 records; title, url present$/m);
      expect(hooked.stdout).toMatch(new RegExp(`^run +surf use ${site} list_books --page 2$`, "m"));
      expect(host.messages.find((message) => message.type === "EXECUTE_NAVIGATE")?.url).toBe(page);
      expect(JSON.parse(fs.readFileSync(opFile(site, "list_books"), "utf8"))).toEqual({
        id: "list_books",
        description: "books with prices",
        args: { page: { default: 2, example: 2 } },
        request: { url: "https://books.toscrape.com/catalogue/page-{{page}}.html" },
        extract: {
          records: "article.product_pod",
          fields: {
            title: "h3 a@title",
            url: "h3 a@href",
            star_rating: {
              selector: ".star-rating@class",
              match: "(?:^|\\s)(?!star-rating(?:\\s|$))(\\S+)",
            },
            price_color: ".price_color",
          },
        },
        page: { into: "page", next: "+1" },
        expect: { minItems: 1, fields: ["title", "url"] },
      });

      const tested = await runCli(socketPath, ["pb", "test", site, "list_books"]);
      expect(tested.code).toBe(0);
      expect(tested.stdout).toMatch(/^pass +list_books +3 records via tab$/m);
    } finally {
      await host.dispose();
    }
  });

  it("stops at a weak pick with the top requests and a rerun line, and --match settles it", async () => {
    const socketPath = createSocketPath();
    const site = unique("shop");
    const page = "https://shop.example/";
    const bodies = {
      "https://shop.example/api/a?x=1": '[{"name":"a"},{"name":"b"}]',
      "https://shop.example/api/b?x=1": '[{"name":"c"},{"name":"d"}]',
    };
    const codes: string[] = [];
    const host = startHost(socketPath, {
      network: () => [
        captured(page, { responseBody: "<html><body><div id=app></div></body></html>" }),
        ...Object.entries(bodies).map(([url, body]) =>
          captured(url, { type: "XHR", mimeType: "application/json", responseBody: body }),
        ),
      ],
      javascript: tab(page, "", bodies, codes),
    });

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      const weak = await runCli(socketPath, [
        "hook",
        page,
        "--goal",
        "shop items",
        "--as",
        `${site}/items`,
      ]);
      expect(weak.code).toBe(2);
      expect(weak.stdout).toMatch(/^weak pick: .* leads .* by 0 points/m);
      expect(weak.stdout).toMatch(
        /^1\. GET https:\/\/shop\.example\/api\/[ab]\?x=1 +score \d+ +JSON, 2 records/m,
      );
      expect(weak.stdout).toMatch(/^3\. GET https:\/\/shop\.example\/ /m);
      expect(weak.stdout).toMatch(
        new RegExp(
          `^rerun +surf hook https://shop\\.example/ --goal 'shop items' --as ${site}/items --match /api/[ab]$`,
          "m",
        ),
      );
      expect(fetches(codes)).toEqual([]);
      expect(exists(opFile(site, "items"))).toBe(false);

      const matched = await runCli(socketPath, [
        "hook",
        page,
        "--goal",
        "shop items",
        "--as",
        `${site}/items`,
        "--match",
        "/api/a",
      ]);
      expect(matched.stderr).toBe("");
      expect(matched.code).toBe(0);
      expect(JSON.parse(fs.readFileSync(opFile(site, "items"), "utf8"))).toMatchObject({
        request: { url: "https://shop.example/api/a", query: { x: "1" } },
        extract: { records: "$", fields: { name: "name" } },
        expect: { minItems: 1, fields: ["name"] },
      });
    } finally {
      await host.dispose();
    }
  });

  it("runs --do steps before the pick and turns their {{input}} into the op's input", async () => {
    const socketPath = createSocketPath();
    const site = unique("quotes");
    const page = "https://quotes.toscrape.com/search";
    const api = "https://quotes.toscrape.com/api/search?kw=einstein&page=1";
    const body = readFixture("quotes-api-page-1.json");
    const codes: string[] = [];
    const host = startHost(socketPath, {
      network: () => [
        captured(page, {
          responseBody: "<html><body><input id=q><div class=results></div></body></html>",
        }),
        captured(api, {
          type: "XHR",
          mimeType: "application/json",
          responseBody: body,
          ts: Date.now(),
        }),
      ],
      javascript: tab(
        page,
        "The world as we have created it is a process of our thinking",
        { [api]: body },
        codes,
      ),
    });

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      const hooked = await runCli(socketPath, [
        "hook",
        page,
        "--goal",
        "quotes by author",
        "--do",
        'type "{{query}}" --into "input#q" | key Enter',
        "--query",
        "einstein",
        "--as",
        `${site}/search`,
      ]);
      expect(hooked.stderr).toBe("");
      expect(hooked.code).toBe(0);
      expect(hooked.stdout).toMatch(
        /^inputs +--query \(required, sample einstein\) · --page \(default 1\)$/m,
      );
      expect(host.messages.find((message) => message.type === "SMART_TYPE")).toMatchObject({
        selector: "input#q",
        text: "einstein",
      });
      const types = host.messages.map((message) => message.type);
      expect(types.indexOf("SMART_TYPE")).toBeGreaterThan(types.indexOf("EXECUTE_NAVIGATE"));
      expect(types.indexOf("SMART_TYPE")).toBeLessThan(types.indexOf("READ_NETWORK_REQUESTS"));
      expect(fetches(codes)).toHaveLength(2);
      expect(JSON.parse(fs.readFileSync(opFile(site, "search"), "utf8"))).toMatchObject({
        args: { query: { required: true, example: "einstein" }, page: { default: 1, example: 1 } },
        request: {
          url: "https://quotes.toscrape.com/api/search",
          query: { kw: "{{query}}", page: "{{page}}" },
        },
        extract: { records: "$.quotes" },
        page: { into: "page", next: "+1" },
      });
    } finally {
      await host.dispose();
    }
  });

  it("refuses a picked write: prints the draft, sends nothing again and saves nothing", async () => {
    const socketPath = createSocketPath();
    const site = unique("quotes");
    const page = "https://quotes.toscrape.com/search.aspx";
    const results = readFixture("quotes-page-1.html");
    const codes: string[] = [];
    const host = startHost(socketPath, {
      network: () => [
        captured(page, { responseBody: "<html><body><form></form></body></html>" }),
        captured("https://quotes.toscrape.com/filter.aspx", {
          method: "POST",
          requestHeaders: { "Content-Type": "application/x-www-form-urlencoded" },
          requestBody: "author=Albert+Einstein&tag=----------",
          responseBody: results,
          ts: Date.now(),
        }),
      ],
      javascript: tab(
        "https://quotes.toscrape.com/filter.aspx",
        "Albert Einstein The world as we have created it",
        {},
        codes,
      ),
    });

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      const hooked = await runCli(socketPath, [
        "hook",
        page,
        "--goal",
        "quotes by author",
        "--do",
        'click --selector "#go"',
        "--as",
        `${site}/by_author`,
      ]);
      expect(hooked.code).toBe(1);
      expect(hooked.stderr).toMatch(
        /refused: POST https:\/\/quotes\.toscrape\.com\/filter\.aspx can change data; surf hook saves reads only/,
      );
      expect(JSON.parse(hooked.stdout)).toMatchObject({
        id: "by_author",
        effect: "write",
        request: {
          method: "POST",
          url: "https://quotes.toscrape.com/filter.aspx",
          body: { author: "Albert Einstein" },
        },
        extract: { records: "div.quote" },
      });
      expect(fetches(codes)).toEqual([]);
      expect(exists(opFile(site, "by_author"))).toBe(false);
    } finally {
      await host.dispose();
    }
  });

  it("pb record stop picks, tests and saves the op the same way", async () => {
    const socketPath = createSocketPath();
    const site = unique("books");
    const html = readFixture("books-page-1.html");
    const page = "https://books.toscrape.com/catalogue/page-3.html";
    const codes: string[] = [];
    const host = startHost(socketPath, {
      network: () => [captured(page, { responseBody: html, ts: Date.now() })],
      javascript: tab(page, "A Light in the Attic", { [page]: html }, codes),
    });

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      const started = await runCli(socketPath, [
        "pb",
        "record",
        "start",
        site,
        "--op",
        "list_books",
      ]);
      expect(started.stderr).toBe("");
      expect(started.code).toBe(0);
      expect(host.messages.some((message) => message.type === "START_NETWORK_CAPTURE")).toBe(true);
      // A --match that holds no request leaves the record open to pick again.
      const missed = await runCli(socketPath, ["pb", "record", "stop", "--match", "/nothing"]);
      expect(missed.code).toBe(1);
      expect(missed.stderr).toMatch(/no captured request's URL holds "\/nothing".*still open/);
      const open = await runCli(socketPath, ["pb", "record", "status", "--json"]);
      expect(JSON.parse(open.stdout)).toMatchObject({ status: "recording" });
      const stopped = await runCli(socketPath, ["pb", "record", "stop"]);
      expect(stopped.stderr).toBe("");
      expect(stopped.code).toBe(0);
      expect(stopped.stdout).toMatch(/^test +tab ✓ 3 records; title, url present$/m);
      expect(stopped.stdout).toMatch(new RegExp(`^saved +.*${site}/ops/list_books\\.json$`, "m"));
      expect(JSON.parse(fs.readFileSync(opFile(site, "list_books"), "utf8"))).toMatchObject({
        args: { page: { default: 3, example: 3 } },
        request: { url: "https://books.toscrape.com/catalogue/page-{{page}}.html" },
        expect: { minItems: 1, fields: ["title", "url"] },
      });
      const status = await runCli(socketPath, ["pb", "record", "status", "--json"]);
      expect(JSON.parse(status.stdout)).toMatchObject({ status: "idle" });
    } finally {
      await host.dispose();
    }
  });

  it("pb record stop that fails says the record stopped and names it", async () => {
    const socketPath = createSocketPath();
    const site = unique("books");
    const page = "https://books.toscrape.com/catalogue/page-3.html";
    const host = startHost(socketPath, {
      network: () => [
        captured(page, { responseBody: readFixture("books-page-1.html"), ts: Date.now() }),
      ],
      // The replay answers 404.
      javascript: tab(page, "A Light in the Attic", {}, []),
    });

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      expect(
        (await runCli(socketPath, ["pb", "record", "start", site, "--op", "list_books"])).code,
      ).toBe(0);
      const stopped = await runCli(socketPath, ["pb", "record", "stop"]);
      expect(stopped.code).toBe(1);
      expect(stopped.stderr).toMatch(/answered 404; record rec-[\w-]+ stopped, its trace saved/);
      expect(exists(opFile(site, "list_books"))).toBe(false);
    } finally {
      await host.dispose();
    }
  });

  it("saves an arXiv-style detail op whose printed run line and --url both work", async () => {
    const socketPath = createSocketPath();
    const site = unique("arxiv");
    const html = readFixture("arxiv-abs.html");
    const page = "https://arxiv.org/abs/2101.10010";
    const other = "https://arxiv.org/abs/0704.0001";
    const codes: string[] = [];
    const host = startHost(socketPath, {
      network: () => [captured(page, { responseBody: html })],
      javascript: tab(
        page,
        "The First Fermi-LAT Solar Flare Catalog",
        { [page]: html, [other]: html },
        codes,
      ),
    });

    try {
      await host.waitForMessage((message) => message.type === "HOST_READY");
      const hooked = await runCli(socketPath, [
        "hook",
        page,
        "--goal",
        "paper details",
        "--as",
        `${site}/paper`,
      ]);
      expect(hooked.stderr).toBe("");
      expect(hooked.code).toBe(0);
      const run = hooked.stdout.match(/^run +surf (.*)$/m)?.[1] ?? "";
      expect(run).toBe(`use ${site} paper --abs_id 2101.10010`);
      const used = await runCli(socketPath, [...run.split(" "), "--json"]);
      expect(used.stderr).toBe("");
      expect(used.code).toBe(0);
      expect(fetches(codes).at(-1)).toContain('new URL("https://arxiv.org/abs/2101.10010")');
      expect(JSON.parse(used.stdout).value).toMatchObject({
        title: "The First Fermi-LAT Solar Flare Catalog",
      });

      const byUrl = await runCli(socketPath, ["use", site, "paper", "--url", other, "--json"]);
      expect(byUrl.stderr).toBe("");
      expect(byUrl.code).toBe(0);
      expect(fetches(codes).at(-1)).toContain(`new URL("${other}")`);
    } finally {
      await host.dispose();
    }
  });
});
