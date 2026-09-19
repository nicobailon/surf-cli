import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const dist = join(root, "dist");
const staleMarker = "deliberately stale package artifact";
const temporaryDirectory = mkdtempSync(join(tmpdir(), "surf-package-"));

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed`);
}

function filesUnder(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
    .sort();
}

try {
  mkdirSync(join(dist, "service-worker"), { recursive: true });
  writeFileSync(join(dist, "service-worker/index.js"), staleMarker);

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npm, ["pack", "--pack-destination", temporaryDirectory]);

  const archives = readdirSync(temporaryDirectory).filter((name) =>
    name.endsWith(".tgz")
  );
  assert.equal(archives.length, 1, "npm pack must produce exactly one archive");

  run("tar", ["-xzf", join(temporaryDirectory, archives[0]), "-C", temporaryDirectory]);
  const packedDist = join(temporaryDirectory, "package/dist");
  const builtFiles = filesUnder(dist);
  assert.deepEqual(
    filesUnder(packedDist),
    builtFiles,
    "packed extension file list differs from the build"
  );

  for (const file of builtFiles) {
    assert.deepEqual(
      readFileSync(join(packedDist, file)),
      readFileSync(join(dist, file)),
      `packed extension differs from the build: ${file}`
    );
  }

  const requiredFiles = [
    "content/index.js",
    "icons/icon-16.png",
    "icons/icon-48.png",
    "icons/icon-128.png",
    "manifest.json",
    "options/options.html",
    "options/options.js",
    "service-worker-loader.js",
    "service-worker/index.js",
  ];
  for (const file of requiredFiles) {
    assert.ok(builtFiles.includes(file), `packed extension is missing ${file}`);
  }

  const serviceWorker = readFileSync(
    join(packedDist, "service-worker/index.js"),
    "utf8"
  );
  assert.ok(!serviceWorker.includes(staleMarker), "npm pack preserved stale dist");
  for (const message of ["FRAME_DIAGNOSE", "WAIT_FOR_READY", "PAGE_READINESS"]) {
    assert.ok(serviceWorker.includes(message), `packed extension is missing ${message}`);
  }

  console.log("Packed extension matches the prepack build and runtime contract.");
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
