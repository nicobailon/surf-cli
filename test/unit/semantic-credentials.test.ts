import { afterEach, describe, expect, it } from "vitest";

const { Buffer } = require("node:buffer");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough, Readable } = require("node:stream");
const credentials = require("../../native/semantic-credentials.cjs");

const roots: string[] = [];

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

function testEnv(extra: Record<string, string> = {}) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "surf-semantic-credentials-"));
  roots.push(parent);
  return {
    XDG_CONFIG_HOME: path.join(parent, "config"),
    SURF_STATE_DIR: path.join(parent, "unrelated-surf-state"),
    ...extra,
  };
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
    const status = credentials.credentialStatus(env, "typesafe");
    expect(status).toEqual({
      typesafe: { source: "environment", fingerprint: resolved.fingerprint },
    });
    expect(JSON.stringify(status)).not.toContain("environment-secret");
  });

  it("falls back from a blank environment value to the shared store", () => {
    const env = testEnv({ TYPESAFE_API_KEY: " \t " });
    const stored = credentials.storeTypeSafeCredential("stored-secret", env);

    expect(credentials.resolveTypeSafeCredential(env)).toEqual({
      apiKey: "stored-secret",
      source: "shared-store",
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
    const sibling = path.join(root, "other.json");
    fs.writeFileSync(sibling, "keep", { mode: 0o600 });
    expect(credentials.clearStoredTypeSafeCredential(env)).toBe(true);
    expect(fs.existsSync(filePath)).toBe(false);
    expect(fs.readFileSync(sibling, "utf8")).toBe("keep");
    expect(credentials.credentialStatus(env, "typesafe").typesafe.source).toBe("environment");
  });

  it("resolves the provider-neutral shared path independently of Surf state", () => {
    expect(
      credentials.credentialLocation(
        { XDG_CONFIG_HOME: "/xdg", SURF_STATE_DIR: "/surf" },
        { platform: "linux", homeDir: "/home/test" },
      ),
    ).toEqual({ root: "/xdg/typesafe", filePath: "/xdg/typesafe/credentials.json" });
    expect(
      credentials.credentialLocation(
        { SURF_STATE_DIR: "/surf" },
        { platform: "darwin", homeDir: "/Users/test" },
      ),
    ).toEqual({
      root: "/Users/test/.config/typesafe",
      filePath: "/Users/test/.config/typesafe/credentials.json",
    });
    expect(
      credentials.credentialLocation(
        { APPDATA: "C:\\Users\\test\\AppData\\Roaming", SURF_STATE_DIR: "C:\\surf" },
        { platform: "win32", homeDir: "C:\\Users\\test" },
      ),
    ).toEqual({
      root: "C:\\Users\\test\\AppData\\Roaming\\TypeSafe",
      filePath: "C:\\Users\\test\\AppData\\Roaming\\TypeSafe\\credentials.json",
    });
  });

  it("returns not-configured without creating state and rejects malformed or public files", () => {
    const env = testEnv();
    const { root, filePath } = credentials.credentialLocation(env);
    expect(credentials.credentialStatus(env)).toEqual({
      typesafe: { source: "not-configured" },
      cloudflare: { source: "not-configured" },
    });
    expect(fs.existsSync(root)).toBe(false);

    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(filePath, JSON.stringify({ version: 1, apiKey: "secret" }), { mode: 0o644 });
    expect(() => credentials.credentialStatus(env)).toThrow(/permissions are too broad/);
    fs.chmodSync(filePath, 0o600);
    fs.writeFileSync(filePath, JSON.stringify({ version: 2, apiKey: "secret" }));
    expect(() => credentials.credentialStatus(env)).toThrow(/credential is invalid/);
  });
});

describe("malformed stored credentials", () => {
  it.each([
    ["typesafe", "credentialLocation", "TypeSafe", '{"version":1,"apiKey":SENTINELSECRET}'],
    [
      "cloudflare",
      "cloudflareCredentialLocation",
      "Cloudflare",
      `{"version":1,"accountId":"${"0".repeat(32)}","apiToken":SENTINELSECRET}`,
    ],
  ])(
    "reports a malformed %s record without echoing its contents",
    (provider, location, label, text) => {
      const env = testEnv();
      const { filePath } = credentials[location](env);
      fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(filePath, text, { mode: 0o600 });
      let message = "";
      try {
        credentials.credentialStatus(env, provider);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toBe(`stored ${label} credential is invalid`);
    },
  );
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

  it("restores raw mode and removes every temporary signal listener when interrupted", async () => {
    const input = new FakeTty();
    const signalSource = new EventEmitter();
    const pending = credentials.readTypeSafeApiKey({
      input,
      output: { write: () => true },
      signalSource,
    });
    expect(
      ["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => signalSource.listenerCount(signal)),
    ).toEqual([1, 1, 1]);
    signalSource.emit("SIGTERM");
    await expect(pending).rejects.toThrow("interrupted by SIGTERM");
    expect(input.rawCalls).toEqual([true, false]);
    expect(
      ["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => signalSource.listenerCount(signal)),
    ).toEqual([0, 0, 0]);
  });
});

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
const OTHER_ACCOUNT_ID = "fedcba9876543210fedcba9876543210";

function setCloudflareFromPipe(env: Record<string, string>, text: string) {
  return credentials.setCloudflareCredentialFromInput({
    input: Readable.from([text]),
    output: { write: () => true },
    env,
  });
}

describe("Cloudflare credential store", () => {
  it("prefers complete environment credentials and rejects a partial environment by name", async () => {
    const env = testEnv({
      CLOUDFLARE_ACCOUNT_ID: OTHER_ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN: "environment-token",
    });
    await setCloudflareFromPipe(env, `${ACCOUNT_ID}\nstored-token\n`);

    expect(credentials.resolveCloudflareCredential(env)).toEqual({
      accountId: OTHER_ACCOUNT_ID,
      apiToken: "environment-token",
      source: "environment",
      fingerprint: credentials.fingerprintApiKey("environment-token"),
    });
    expect(() =>
      credentials.resolveCloudflareCredential({ ...env, CLOUDFLARE_API_TOKEN: " " }),
    ).toThrow(/^CLOUDFLARE_API_TOKEN is not set/);
    expect(() =>
      credentials.resolveCloudflareCredential({ ...env, CLOUDFLARE_ACCOUNT_ID: "" }),
    ).toThrow(/^CLOUDFLARE_ACCOUNT_ID is not set/);
    expect(() =>
      credentials.resolveCloudflareCredential({ ...env, CLOUDFLARE_ACCOUNT_ID: "not-an-account" }),
    ).toThrow(/account id must be 32/);
    expect(
      credentials.resolveCloudflareCredential({
        ...env,
        CLOUDFLARE_ACCOUNT_ID: " ",
        CLOUDFLARE_API_TOKEN: "",
      }),
    ).toMatchObject({ accountId: ACCOUNT_ID, apiToken: "stored-token", source: "stored" });
  });

  it("stores piped credentials in a private Surf file separate from TypeSafe and clears it", async () => {
    const env = testEnv();
    const { root, filePath } = credentials.cloudflareCredentialLocation(env);
    expect(root).toBe(path.join(env.XDG_CONFIG_HOME, "surf"));
    expect(credentials.resolveCloudflareCredential(env)).toBeNull();
    expect(credentials.clearStoredCloudflareCredential(env)).toBe(false);
    expect(fs.existsSync(root)).toBe(false);

    await expect(setCloudflareFromPipe(env, `${ACCOUNT_ID}\r\nstored-token\r\n`)).resolves.toEqual({
      source: "stored",
      fingerprint: credentials.fingerprintApiKey("stored-token"),
    });
    expect(JSON.parse(fs.readFileSync(filePath, "utf8"))).toEqual({
      version: 1,
      accountId: ACCOUNT_ID,
      apiToken: "stored-token",
    });
    expect(fs.statSync(root).mode & 0o777).toBe(0o700);
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    expect(fs.existsSync(credentials.credentialLocation(env).root)).toBe(false);
    expect(credentials.resolveCloudflareCredential(env)).toEqual({
      accountId: ACCOUNT_ID,
      apiToken: "stored-token",
      source: "stored",
      fingerprint: credentials.fingerprintApiKey("stored-token"),
    });

    expect(credentials.clearStoredCloudflareCredential(env)).toBe(true);
    expect(fs.existsSync(filePath)).toBe(false);
    expect(credentials.resolveCloudflareCredential(env)).toBeNull();
  });

  it("rejects invalid stored records and malformed piped input without storing anything", async () => {
    const env = testEnv();
    const { filePath } = credentials.cloudflareCredentialLocation(env);
    for (const text of [`${ACCOUNT_ID}\n`, `${ACCOUNT_ID}\ntoken\nextra\n`, "ABC\ntoken\n"]) {
      await expect(setCloudflareFromPipe(env, text)).rejects.toThrow(/two lines|account id/);
    }
    await expect(setCloudflareFromPipe(env, `${ACCOUNT_ID}\n \n`)).rejects.toThrow(
      /must not be blank/,
    );
    expect(fs.existsSync(filePath)).toBe(false);

    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(filePath, JSON.stringify({ version: 1, accountId: "bad", apiToken: "t" }), {
      mode: 0o600,
    });
    expect(() => credentials.resolveCloudflareCredential(env)).toThrow(
      "stored Cloudflare credential is invalid",
    );
  });

  it("echoes the account id on a TTY but keeps the token hidden", async () => {
    const env = testEnv();
    const input = new FakeTty();
    let written = "";
    const output = {
      write(value: string) {
        written += value;
        return true;
      },
    };
    const pending = credentials.setCloudflareCredentialFromInput({ input, output, env });
    input.emit("data", Buffer.from(`${ACCOUNT_ID}\r`));
    await new Promise((resolve) => setTimeout(resolve, 0));
    input.emit("data", Buffer.from("tty-token\r"));

    await expect(pending).resolves.toMatchObject({ source: "stored" });
    expect(written).toBe(`Cloudflare account id: ${ACCOUNT_ID}\nCloudflare API token: \n`);
    expect(input.rawCalls).toEqual([true, false, true, false]);
    expect(credentials.resolveCloudflareCredential(env)).toMatchObject({ apiToken: "tty-token" });
  });
});
