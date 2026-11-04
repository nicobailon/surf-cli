import { describe, expect, it } from "vitest";

declare const process: { platform: string; execPath: string };
declare const require: (moduleName: string) => any;

const { EventEmitter } = require("node:events");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { planUpdate, runStep } = require("../../native/update.cjs");

function makeTempDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "surf-update-test-")));
}

// A node prefix with its own npm, as Homebrew, nvm or the Node installer lay it out.
function makePrefix(tempDir: string, name: string) {
  const prefix = path.join(tempDir, name);
  fs.mkdirSync(path.join(prefix, "bin"), { recursive: true });
  fs.mkdirSync(path.join(prefix, "lib/node_modules"), { recursive: true });
  fs.writeFileSync(path.join(prefix, "bin/npm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return prefix;
}

describe("surf update install detection", () => {
  it("reinstalls a global npm install with the npm of the prefix that holds it", ({ skip }) => {
    if (process.platform === "win32") {
      skip();
    }
    const tempDir = makeTempDir();
    makePrefix(tempDir, "first-on-path");
    const owner = makePrefix(tempDir, "owner");
    const root = path.join(owner, "lib/node_modules/surf-cli");
    fs.mkdirSync(path.join(root, "native"), { recursive: true });
    // The `surf` bin is a link into the package, like <prefix>/bin/surf.
    const link = path.join(tempDir, "surf-link");
    fs.symlinkSync(root, link);

    expect(planUpdate(link)).toEqual({
      kind: "npm",
      root,
      steps: [
        {
          command: path.join(owner, "bin/npm"),
          args: ["install", "-g", "surf-cli@latest"],
          cwd: owner,
          env: { npm_config_prefix: owner },
        },
      ],
    });
  });

  it("rebuilds a linked repo checkout in place instead of reinstalling from npm", ({ skip }) => {
    if (process.platform === "win32") {
      skip();
    }
    const tempDir = makeTempDir();
    const prefix = makePrefix(tempDir, "prefix");
    const repo = path.join(tempDir, "surf-cli-checkout");
    fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
    // `npm link` puts a link to the checkout in the global root.
    const linked = path.join(prefix, "lib/node_modules/surf-cli");
    fs.symlinkSync(repo, linked);

    expect(planUpdate(linked)).toEqual({
      kind: "repo",
      root: repo,
      steps: [
        { command: "npm", args: ["ci"], cwd: repo },
        { command: "npm", args: ["run", "build"], cwd: repo },
      ],
    });
  });

  it("refuses an install that is neither, so nothing runs", ({ skip }) => {
    if (process.platform === "win32") {
      skip();
    }
    const tempDir = makeTempDir();
    const local = path.join(tempDir, "project/node_modules/surf-cli");
    fs.mkdirSync(local, { recursive: true });
    const unpacked = path.join(tempDir, "surf-cli-2.25.0");
    fs.mkdirSync(unpacked);

    for (const root of [local, unpacked]) {
      expect(() => planUpdate(root)).toThrow(
        `surf in ${root} is neither a global npm install nor a git checkout, so surf update changed nothing. Update it with the package manager that installed it.`,
      );
    }
    // On Windows a project's node_modules looks like a global prefix, but has no `surf.cmd` next to it.
    const nodeDir = path.join(tempDir, "nodejs");
    fs.mkdirSync(nodeDir);
    fs.writeFileSync(path.join(nodeDir, "npm.cmd"), "");
    expect(() => planUpdate(local, "win32", path.join(nodeDir, "node.exe"))).toThrow(
      "Update it with the package manager that installed it.",
    );
  });

  // The default Node for Windows install keeps npm.cmd beside node.exe and installs globals in
  // %APPDATA%\npm, which has the `surf.cmd` command but no npm of its own.
  it("uses the npm beside the running node on Windows when the prefix has none", () => {
    const tempDir = makeTempDir();
    const prefix = path.join(tempDir, "AppData/Roaming/npm");
    const root = path.join(prefix, "node_modules/surf-cli");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(prefix, "surf.cmd"), "");
    const nodeDir = path.join(tempDir, "Program Files/nodejs");
    fs.mkdirSync(nodeDir, { recursive: true });
    fs.writeFileSync(path.join(nodeDir, "npm.cmd"), "");

    expect(planUpdate(root, "win32", path.join(nodeDir, "node.exe")).steps).toEqual([
      {
        command: path.join(nodeDir, "npm.cmd"),
        args: ["install", "-g", "surf-cli@latest"],
        cwd: prefix,
        env: { npm_config_prefix: prefix },
      },
    ]);
  });

  it("uses the npm beside the running node for a prefix such as ~/.npm-global", () => {
    const tempDir = makeTempDir();
    const prefix = path.join(tempDir, "home/.npm-global");
    const root = path.join(prefix, "lib/node_modules/surf-cli");
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(path.join(prefix, "bin"));
    fs.writeFileSync(path.join(prefix, "bin/surf"), "");
    const nodeBin = path.join(makePrefix(tempDir, "node"), "bin");

    expect(planUpdate(root, "linux", path.join(nodeBin, "node")).steps).toEqual([
      {
        command: path.join(nodeBin, "npm"),
        args: ["install", "-g", "surf-cli@latest"],
        cwd: prefix,
        env: { npm_config_prefix: prefix },
      },
    ]);
  });
});

describe("surf update steps", () => {
  function recordSpawn() {
    const calls: unknown[][] = [];
    const spawn = (...args: unknown[]) => {
      calls.push(args);
      const child = new EventEmitter();
      setTimeout(() => child.emit("close", 0), 0);
      return child;
    };
    return { calls, spawn };
  }

  it("quotes a Windows .cmd and each argument for the shell, and runs node.exe without one", async () => {
    const { calls, spawn } = recordSpawn();
    const npm = "C:\\Program Files\\nodejs\\npm.cmd";
    const node = "C:\\Program Files\\nodejs\\node.exe";
    const installer =
      "C:\\Users\\Jane Doe\\AppData\\Roaming\\npm\\node_modules\\surf-cli\\scripts\\install-native-host.cjs";

    await runStep(
      { command: npm, args: ["install", "-g", "surf-cli@latest"] },
      { spawn, platform: "win32" },
    );
    await runStep({ command: node, args: [installer, "--refresh"] }, { spawn, platform: "win32" });

    expect(calls[0][0]).toBe(`"${npm}" "install" "-g" "surf-cli@latest"`);
    expect(calls[0][1]).toMatchObject({ shell: true });
    expect(calls[1].slice(0, 2)).toEqual([node, [installer, "--refresh"]]);
    expect(calls[1][2]).not.toHaveProperty("shell");
  });

  it("fails with the exit code of the step that failed and reports it as JSON", ({ skip }) => {
    if (process.platform === "win32") {
      skip();
    }
    const tempDir = makeTempDir();
    const prefix = makePrefix(tempDir, "prefix");
    fs.writeFileSync(path.join(prefix, "bin/npm"), "#!/bin/sh\necho npm output\nexit 7\n");
    const root = path.join(prefix, "lib/node_modules/surf-cli");
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "1.2.3" }));
    const script = `require(${JSON.stringify(path.resolve("native/update.cjs"))})
      .runUpdateCli(["--json"], { packageRoot: ${JSON.stringify(root)}, socketPath: ${JSON.stringify(path.join(tempDir, "none.sock"))} })
      .then((code) => process.exit(code));`;

    const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });

    expect(result.status).toBe(7);
    expect(result.stderr).toContain("npm output");
    expect(JSON.parse(result.stdout)).toEqual({
      before: { cli: "1.2.3", host: null, extension: null },
      after: null,
      steps: [{ step: "npm install -g surf-cli@latest", ok: false, exitCode: 7 }],
    });
  });
});
