// Watches the Surf state dir outside tests (~/.surf/state, or the SURF_STATE_DIR the run started
// with). vitest.config.ts points every test at a throwaway HOME and SURF_STATE_DIR, so a change here
// means a test escaped it, or that the live surf wrote while tests ran. CI has no live surf, so
// there (or with SURF_TEST_STATE_GUARD=strict) a change fails the run; locally it warns, and says
// when a host's socket exists: a running host writes its session and activity files as it runs.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { stderr } = require("node:process");
const { SOCKET_PATH } = require("../../native/socket-path.cjs");

function snapshot(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string) => {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const file = path.join(dir, name);
      const stat = fs.statSync(file, { throwIfNoEntry: false });
      if (!stat) {
        continue;
      }
      if (stat.isDirectory()) {
        walk(file);
      } else {
        files.set(file, `${stat.size}:${stat.mtimeMs}`);
      }
    }
  };
  walk(root);
  return files;
}

export function checkStateChanges({
  stateDir,
  before,
  after,
  env,
  hostSocket,
  warn,
}: {
  stateDir: string;
  before: Map<string, string>;
  after: Map<string, string>;
  env: Record<string, string | undefined>;
  /** The socket of a running Surf host, when one exists. */
  hostSocket?: string;
  warn: (message: string) => void;
}) {
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
    (file) => before.get(file) !== after.get(file),
  );
  if (changed.length === 0) {
    return;
  }
  const files = changed.join(", ");
  if (env.CI || env.SURF_TEST_STATE_GUARD === "strict") {
    throw new Error(`Tests wrote to the real Surf state dir ${stateDir}: ${files}`);
  }
  const cause = hostSocket
    ? `A Surf host is running (${hostSocket} exists) and writes these files as it works, so it most likely wrote them; otherwise a test escaped its temp HOME. `
    : "A test may have escaped its temp HOME, or the live surf wrote while tests ran. ";
  warn(
    `Warning: the real Surf state dir ${stateDir} changed during the tests: ${files}. ${cause}` +
      "Set SURF_TEST_STATE_GUARD=strict to fail on this.",
  );
}

export default function setup() {
  const stateDir = process.env.SURF_STATE_DIR || path.join(os.homedir(), ".surf", "state");
  const before = snapshot(stateDir);
  return () => {
    const testRoot = process.env.SURF_TEST_ROOT;
    if (testRoot) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
    checkStateChanges({
      stateDir,
      before,
      after: snapshot(stateDir),
      env: process.env,
      ...(fs.existsSync(SOCKET_PATH) ? { hostSocket: SOCKET_PATH } : {}),
      warn: (message: string) => stderr.write(`${message}\n`),
    });
  };
}
