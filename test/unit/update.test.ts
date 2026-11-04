import { describe, expect, it } from "vitest";

declare const process: { platform: string };
declare const require: (moduleName: string) => any;

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { planUpdate } = require("../../native/update.cjs");

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

    expect(() => planUpdate(local)).toThrow(
      `surf is installed in ${local}, but there is no npm at`,
    );
    expect(() => planUpdate(unpacked)).toThrow(
      `surf in ${unpacked} is neither a global npm install nor a git checkout, so surf update changed nothing.`,
    );
  });
});
