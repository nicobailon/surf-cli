// Fails the run when tests write to the Surf state dir outside tests (~/.surf/state, or the
// SURF_STATE_DIR the run started with). vitest.config.ts points every test at a throwaway HOME and
// SURF_STATE_DIR, so a write here means a test escaped it.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

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

export default function setup() {
  const stateDir = process.env.SURF_STATE_DIR || path.join(os.homedir(), ".surf", "state");
  const before = snapshot(stateDir);
  return () => {
    const testRoot = process.env.SURF_TEST_ROOT;
    if (testRoot) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
    const after = snapshot(stateDir);
    const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
      (file) => before.get(file) !== after.get(file),
    );
    if (changed.length > 0) {
      throw new Error(`Tests wrote to the real Surf state dir ${stateDir}: ${changed.join(", ")}`);
    }
  };
}
