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

let socketCounter = 0;

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
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const child = spawn(process.execPath, ["native/cli.cjs", ...args], {
      cwd: process.cwd(),
      env: createCliEnv(),
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

function runCli(args: string[]): Promise<{ request: any; stdout: string; stderr: string }> {
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
        socket.write(
          `${JSON.stringify({ result: { content: [{ type: "text", text: "OK" }] } })}\n`,
        );
        socket.end();
      });
    });

    server.on("error", reject);
    server.listen(socketPath, () => {
      const child = spawn(process.execPath, ["native/cli.cjs", ...args], {
        cwd: process.cwd(),
        env: createCliEnv(socketPath),
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

  it("serializes concurrent CLI requests by socket", async () => {
    const socketPath = createSocketPath();
    cleanupSocket(socketPath);
    let requestCount = 0;
    let firstRequestAt = 0;
    let secondRequestAt = 0;
    let resolveFirstRequest!: () => void;
    const firstRequest = new Promise<void>((resolve) => {
      resolveFirstRequest = resolve;
    });

    const server = net.createServer((socket: any) => {
      let buffer = "";
      socket.on("data", (chunk: { toString(): string }) => {
        buffer += chunk.toString();
        const lineEnd = buffer.indexOf("\n");
        if (lineEnd === -1) {
          return;
        }

        requestCount++;
        if (requestCount === 1) {
          firstRequestAt = Date.now();
          resolveFirstRequest();
          setTimeout(() => {
            socket.write(
              `${JSON.stringify({ result: { content: [{ type: "text", text: "first" }] } })}\n`,
            );
            socket.end();
          }, 250);
          return;
        }

        secondRequestAt = Date.now();
        socket.write(
          `${JSON.stringify({ result: { content: [{ type: "text", text: "second" }] } })}\n`,
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
      const [firstDone, secondDone] = await Promise.all([first.done, second.done]);

      expect(firstDone.code).toBe(0);
      expect(secondDone.code).toBe(0);
      expect(requestCount).toBe(2);
      expect(secondRequestAt - firstRequestAt).toBeGreaterThanOrEqual(200);
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
    it(`serializes ${workflowCase.name} requests by socket`, async () => {
      const socketPath = createSocketPath();
      cleanupSocket(socketPath);
      const workflow = workflowCase.args();
      let requestCount = 0;
      let firstRequestAt = 0;
      let secondRequestAt = 0;
      let resolveFirstRequest!: () => void;
      const firstRequest = new Promise<void>((resolve) => {
        resolveFirstRequest = resolve;
      });

      const server = net.createServer((socket: any) => {
        let buffer = "";
        socket.on("data", (chunk: { toString(): string }) => {
          buffer += chunk.toString();
          const lineEnd = buffer.indexOf("\n");
          if (lineEnd === -1) {
            return;
          }

          requestCount++;
          if (requestCount === 1) {
            firstRequestAt = Date.now();
            resolveFirstRequest();
            setTimeout(() => {
              socket.write(
                `${JSON.stringify({ result: { content: [{ type: "text", text: "first" }] } })}\n`,
              );
              socket.end();
            }, 250);
            return;
          }

          secondRequestAt = Date.now();
          socket.write(
            `${JSON.stringify({ result: { content: [{ type: "text", text: "second" }] } })}\n`,
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
        const [firstDone, secondDone] = await Promise.all([first.done, second.done]);

        expect(firstDone.code).toBe(0);
        expect(secondDone.code).toBe(0);
        expect(requestCount).toBe(2);
        expect(secondRequestAt - firstRequestAt).toBeGreaterThanOrEqual(200);
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
          `${JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] } })}\n`,
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

        requestCount++;
        if (requestCount === 1) {
          resolveFirstRequest();
          setTimeout(() => {
            socket.write(
              `${JSON.stringify({ result: { content: [{ type: "text", text: "first" }] } })}\n`,
            );
            socket.end();
          }, 300);
          return;
        }

        resolveSecondRequest();
        socket.write(
          `${JSON.stringify({ result: { content: [{ type: "text", text: "second" }] } })}\n`,
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
