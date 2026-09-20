import { afterEach, describe, expect, it } from "vitest";

const { Buffer } = require("node:buffer");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough, Readable } = require("node:stream");
const credentials = require("../../native/semantic-credentials.cjs");

const roots: string[] = [];

function testEnv(extra: Record<string, string> = {}) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "surf-semantic-credentials-"));
  roots.push(parent);
  return { SURF_STATE_DIR: path.join(parent, "state"), ...extra };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("TypeSafe credential store", () => {
  it("prefers a nonblank environment key and reports only its source and fingerprint", () => {
    const env = testEnv({ TYPESAFE_API_KEY: "environment-secret" });
    credentials.storeTypeSafeCredential("stored-secret", env);

    const resolved = credentials.resolveTypeSafeCredential(env);
    expect(resolved).toEqual({
      apiKey: "environment-secret",
      source: "environment",
      fingerprint: credentials.fingerprintApiKey("environment-secret"),
    });
    const status = credentials.credentialStatus(env);
    expect(status).toEqual({ source: "environment", fingerprint: resolved.fingerprint });
    expect(JSON.stringify(status)).not.toContain("environment-secret");
  });

  it("falls back from a blank environment value to the private store", () => {
    const env = testEnv({ TYPESAFE_API_KEY: " \t " });
    const stored = credentials.storeTypeSafeCredential("stored-secret", env);

    expect(credentials.resolveTypeSafeCredential(env)).toEqual({
      apiKey: "stored-secret",
      source: "private-store",
      fingerprint: stored.fingerprint,
    });
  });

  it("writes atomically under private directories and rejects symlinked credential paths", () => {
    const env = testEnv();
    credentials.storeTypeSafeCredential("first-secret", env);
    credentials.storeTypeSafeCredential("second-secret", env);
    const { root, filePath } = credentials.credentialLocation(env);

    expect(JSON.parse(fs.readFileSync(filePath, "utf8"))).toEqual({
      version: 1,
      apiKey: "second-secret",
    });
    expect(fs.statSync(root).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.dirname(filePath)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    expect(
      fs.readdirSync(path.dirname(filePath)).filter((name: string) => name.endsWith(".tmp")),
    ).toEqual([]);

    fs.unlinkSync(filePath);
    const target = path.join(path.dirname(root), "target.json");
    fs.writeFileSync(target, JSON.stringify({ version: 1, apiKey: "stolen" }), { mode: 0o600 });
    fs.symlinkSync(target, filePath);
    expect(() => credentials.resolveTypeSafeCredential(env)).toThrow(/symbolic link/);
    expect(() => credentials.storeTypeSafeCredential("replacement", env)).toThrow(/symbolic link/);
    expect(() => credentials.clearStoredTypeSafeCredential(env)).toThrow(/symbolic link/);
  });

  it("clears only the stored file without creating state directories", () => {
    const env = testEnv({ TYPESAFE_API_KEY: "environment-secret" });
    const { root, filePath } = credentials.credentialLocation(env);
    expect(credentials.clearStoredTypeSafeCredential(env)).toBe(false);
    expect(fs.existsSync(root)).toBe(false);

    credentials.storeTypeSafeCredential("stored-secret", env);
    const sibling = path.join(root, "credentials", "other.json");
    fs.writeFileSync(sibling, "keep", { mode: 0o600 });
    expect(credentials.clearStoredTypeSafeCredential(env)).toBe(true);
    expect(fs.existsSync(filePath)).toBe(false);
    expect(fs.readFileSync(sibling, "utf8")).toBe("keep");
    expect(credentials.credentialStatus(env).source).toBe("environment");
  });

  it("returns not-configured without creating state and rejects malformed or public files", () => {
    const env = testEnv();
    const { root, filePath } = credentials.credentialLocation(env);
    expect(credentials.credentialStatus(env)).toEqual({ source: "not-configured" });
    expect(fs.existsSync(root)).toBe(false);

    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(filePath, JSON.stringify({ version: 1, apiKey: "secret" }), { mode: 0o644 });
    expect(() => credentials.credentialStatus(env)).toThrow(/permissions are too broad/);
    fs.chmodSync(filePath, 0o600);
    fs.writeFileSync(filePath, JSON.stringify({ version: 2, apiKey: "secret" }));
    expect(() => credentials.credentialStatus(env)).toThrow(/credential is invalid/);
  });
});

describe("TypeSafe credential input", () => {
  it("accepts exactly one bounded stdin line without writing the secret", async () => {
    const output = new PassThrough();
    let written = "";
    output.on("data", (chunk: { toString(): string }) => {
      written += chunk.toString();
    });

    await expect(
      credentials.readTypeSafeApiKey({ input: Readable.from(["piped-secret\n"]), output }),
    ).resolves.toBe("piped-secret");
    expect(written).toBe("");
    await expect(
      credentials.readTypeSafeApiKey({ input: Readable.from(["one\ntwo\n"]), output }),
    ).rejects.toThrow(/one line/);
    await expect(
      credentials.readTypeSafeApiKey({ input: Readable.from([" \n"]), output }),
    ).rejects.toThrow(/must not be blank/);
    await expect(
      credentials.readTypeSafeApiKey({
        input: Readable.from(["x".repeat(credentials.MAX_API_KEY_BYTES + 1)]),
        output,
      }),
    ).rejects.toThrow(/exceeds/);
  });

  it("uses raw TTY input, handles editing, and never echoes the key", async () => {
    class FakeTty extends EventEmitter {
      isTTY = true;
      isRaw = false;
      rawCalls: boolean[] = [];
      setRawMode(value: boolean) {
        this.isRaw = value;
        this.rawCalls.push(value);
      }
      resume() {
        /* EventEmitter test double. */
      }
      pause() {
        /* EventEmitter test double. */
      }
    }
    const input = new FakeTty();
    let written = "";
    const output = {
      write(value: string) {
        written += value;
        return true;
      },
    };
    const pending = credentials.readTypeSafeApiKey({ input, output });
    input.emit("data", Buffer.from("secrex\u007ft\r"));

    await expect(pending).resolves.toBe("secret");
    expect(input.rawCalls).toEqual([true, false]);
    expect(written).toBe("TypeSafe API key: \n");
    expect(written).not.toContain("secret");
  });
});
