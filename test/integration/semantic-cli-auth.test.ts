import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const roots: string[] = [];
const cli = path.join(process.cwd(), "native", "cli.cjs");
const accountId = "0123456789abcdef0123456789abcdef";

function environment() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "surf-semantic-auth-cli-"));
  roots.push(root);
  const {
    TYPESAFE_API_KEY: _typesafe,
    CLOUDFLARE_ACCOUNT_ID: _account,
    CLOUDFLARE_API_TOKEN: _token,
    SURF_SEMANTIC_MODEL: _model,
    ...baseEnvironment
  } = process.env;
  const env = {
    ...baseEnvironment,
    XDG_CONFIG_HOME: path.join(root, "config"),
    SURF_SOCKET: path.join(root, "missing.sock"),
  };
  return env;
}

function run(args: string[], env: Record<string, string>, input?: string) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: process.cwd(),
    env,
    input,
    encoding: "utf8",
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("semantic auth CLI", () => {
  it("sets, reports, and clears the shared credential without contacting the missing host", () => {
    const env = environment();
    const set = run(["semantic", "auth", "set"], env, "black-box-secret\n");
    expect(set.status).toBe(0);
    expect(set.stdout).toContain("typesafe: shared-store (sha256:");
    expect(`${set.stdout}${set.stderr}`).not.toContain("black-box-secret");

    const file = path.join(env.XDG_CONFIG_HOME, "typesafe", "credentials.json");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
      version: 1,
      apiKey: "black-box-secret",
    });
    if (process.platform !== "win32") {
      expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }

    const status = run(["semantic.auth.status", "--json"], env);
    expect(status.status).toBe(0);
    expect(JSON.parse(status.stdout)).toEqual({
      typesafe: { source: "shared-store", fingerprint: expect.stringMatching(/^sha256:/) },
      cloudflare: { source: "not-configured" },
    });
    expect(status.stdout).not.toContain("black-box-secret");

    const clear = run(["semantic", "auth", "clear"], env);
    expect(clear.status).toBe(0);
    expect(clear.stdout).toContain("Shared TypeSafe credential cleared for all clients.");
    expect(clear.stdout).toContain("No stored Cloudflare credential found.");
    expect(fs.existsSync(file)).toBe(false);
  });

  it("stores Cloudflare credentials from stdin and reports fingerprints only", () => {
    const env = environment();
    const set = run(
      ["semantic", "auth", "set", "--provider", "cloudflare"],
      env,
      `${accountId}\ncloudflare-black-box-token\n`,
    );
    expect(set.status).toBe(0);
    expect(set.stdout).toMatch(/^cloudflare: stored \(sha256:[0-9a-f]{12}\)$/m);

    const status = run(["semantic", "auth", "status"], env);
    expect(status.status).toBe(0);
    expect(status.stdout.trim().split("\n")).toEqual([
      "typesafe: not-configured",
      expect.stringMatching(/^cloudflare: stored \(sha256:[0-9a-f]{12}\)$/),
    ]);
    const only = run(["semantic", "auth", "status", "--provider", "cloudflare", "--json"], env);
    expect(Object.keys(JSON.parse(only.stdout))).toEqual(["cloudflare"]);
    for (const output of [set, status, only]) {
      expect(`${output.stdout}${output.stderr}`).not.toContain("cloudflare-black-box-token");
      expect(`${output.stdout}${output.stderr}`).not.toContain(accountId);
    }

    const clear = run(["semantic", "auth", "clear", "--provider", "cloudflare"], env);
    expect(clear.status).toBe(0);
    expect(clear.stdout.trim()).toBe("Stored Cloudflare credential cleared.");
    expect(
      fs.existsSync(path.join(env.XDG_CONFIG_HOME, "surf", "cloudflare-credentials.json")),
    ).toBe(false);
  });

  it("uses the environment override and rejects argv secrets and browser flags locally", () => {
    const base = environment();
    const env = { ...base, TYPESAFE_API_KEY: "environment-secret" };
    const status = run(["semantic", "auth", "status"], env);
    expect(status.status).toBe(0);
    expect(status.stdout).toContain("typesafe: environment (sha256:");
    expect(status.stdout).not.toContain("environment-secret");

    for (const args of [
      ["semantic", "auth", "set", "argv-secret"],
      ["semantic", "auth", "status", "--tab-id", "1"],
      ["semantic", "auth", "set", "--api-key", "argv-secret"],
      ["semantic", "auth", "set", "--provider", "argv-secret"],
    ]) {
      const result = run(args, base);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("not secrets or browser targeting flags");
      expect(result.stderr).not.toContain("argv-secret");
    }
  });
});
