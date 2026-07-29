import { afterEach, describe, expect, it } from "vitest";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const B = require("buffer").Buffer;

const { assembleContext } = require("../../native/oracle-context.cjs");

const tempDirs: string[] = [];
const originalSurfTmp = process.env.SURF_TMP;

async function tempDir() {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "surf-oracle-context-test-"));
  tempDirs.push(directory);
  return directory;
}

function withoutNonce(value: string) {
  return value.replace(/SURF-CTX-[a-f0-9]{24}/g, "SURF-CTX-NONCE");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true })));
  if (originalSurfTmp === undefined) {
    delete process.env.SURF_TMP;
  } else {
    process.env.SURF_TMP = originalSurfTmp;
  }
});

describe("oracle context assembly", () => {
  it("returns inline empty evidence for a prompt-only ask", async () => {
    const cwd = await tempDir();

    const result = await assembleContext({ files: [], cwd, inlineThreshold: 0 });

    expect(result.mode).toBe("inline");
    expect(result.manifest).toEqual({
      files: [],
      totals: { files: 0, bytes: 0, chars: 0 },
      mode: "inline",
    });
    expect(result.envelope).toContain("BEGIN-EVIDENCE");
  });

  it("expands, deduplicates, and sorts globs deterministically", async () => {
    const cwd = await tempDir();
    await fsp.mkdir(path.join(cwd, "nested"));
    await fsp.writeFile(path.join(cwd, "z.txt"), "zeta\n");
    await fsp.writeFile(path.join(cwd, "nested", "a.txt"), "alpha\n");

    const first = await assembleContext({ files: ["**/*.txt", "?.txt"], cwd });
    const second = await assembleContext({ files: ["?.txt", "**/*.txt"], cwd });

    expect(first.manifest.files.map((file: { path: string }) => file.path)).toEqual([
      "nested/a.txt",
      "z.txt",
    ]);
    expect(withoutNonce(first.envelope)).toBe(withoutNonce(second.envelope));
  });

  it("fails closed when a pattern matches no files", async () => {
    const cwd = await tempDir();

    await expect(assembleContext({ files: ["missing/**/*.ts"], cwd })).rejects.toMatchObject({
      code: "context_incomplete",
      paths: ["missing/**/*.ts"],
    });
  });

  it("names every unreadable or non-UTF-8 input", async () => {
    const cwd = await tempDir();
    await fsp.writeFile(path.join(cwd, "binary.dat"), B.from([0xff, 0xfe]));

    await expect(
      assembleContext({ files: ["absent.txt", "binary.dat"], cwd }),
    ).rejects.toMatchObject({
      code: "context_incomplete",
      paths: ["absent.txt", "binary.dat"],
    });
  });

  it("blocks and lists every sensitive basename", async () => {
    const cwd = await tempDir();
    await Promise.all([
      fsp.writeFile(path.join(cwd, ".env.local"), "TOKEN=value\n"),
      fsp.writeFile(path.join(cwd, "private.PEM"), "private\n"),
      fsp.writeFile(path.join(cwd, "secrets-backup.txt"), "secret\n"),
    ]);

    await expect(
      assembleContext({ files: ["secrets-backup.txt", ".env.local", "private.PEM"], cwd }),
    ).rejects.toMatchObject({
      code: "sensitive_blocked",
      paths: [".env.local", "private.PEM", "secrets-backup.txt"],
    });
  });

  it("includes sensitive files only with an explicit manifest override", async () => {
    const cwd = await tempDir();
    await fsp.writeFile(path.join(cwd, "credentials.json"), "credential material\n");

    const result = await assembleContext({
      files: ["credentials.json"],
      cwd,
      allowSensitive: true,
    });

    expect(result.envelope).toContain("credential material");
    expect(result.manifest.files[0]).toMatchObject({
      path: "credentials.json",
      disposition: "inline",
      denyList: "overridden",
      denied: false,
      overridden: true,
    });
  });

  it("blocks gitignored paths using the repository rooted at cwd", async () => {
    const cwd = await tempDir();
    childProcess.execFileSync("git", ["init", "-q", cwd]);
    await fsp.writeFile(path.join(cwd, ".gitignore"), "ignored.txt\n");
    await fsp.writeFile(path.join(cwd, "ignored.txt"), "ignored material\n");

    await expect(assembleContext({ files: ["ignored.txt"], cwd })).rejects.toMatchObject({
      code: "sensitive_blocked",
      paths: ["ignored.txt"],
    });
  });

  it("rejects evidence over the hard context budget and names the largest file", async () => {
    const cwd = await tempDir();
    await fsp.writeFile(path.join(cwd, "largest.txt"), "x".repeat(2_000_001));

    await expect(assembleContext({ files: ["largest.txt"], cwd })).rejects.toMatchObject({
      code: "context_incomplete",
      paths: ["largest.txt"],
      message: expect.stringMatching(
        /^context evidence total \d+ characters exceeds the 2000000-character budget; largest files:/,
      ),
    });
  });

  it("switches to one private bundle containing the identical evidence envelope", async () => {
    const cwd = await tempDir();
    const surfTmp = path.join(cwd, "surf-tmp");
    process.env.SURF_TMP = surfTmp;
    await fsp.writeFile(path.join(cwd, "evidence.txt"), "evidence that exceeds the limit\n");

    const inline = await assembleContext({
      files: ["evidence.txt"],
      cwd,
      inlineThreshold: Number.MAX_SAFE_INTEGER,
    });
    const bundled = await assembleContext({ files: ["evidence.txt"], cwd, inlineThreshold: 1 });
    const bundleContent = await fsp.readFile(bundled.bundlePath, "utf8");

    expect(bundled.mode).toBe("bundle");
    expect(bundled.manifest.files[0].disposition).toBe("bundle");
    expect(withoutNonce(bundleContent)).toBe(withoutNonce(inline.envelope));
    expect(bundled.envelope).toContain(path.basename(bundled.bundlePath));
    expect(bundled.envelope).not.toContain("evidence that exceeds");
    expect(fs.statSync(bundled.bundlePath).mode & 0o777).toBe(0o600);
  });
});
