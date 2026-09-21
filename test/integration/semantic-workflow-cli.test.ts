import { afterEach, describe, expect, it } from "vitest";

const { spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const cli = resolve("native/cli.cjs");
const roots: string[] = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "surf-semantic-cli-"));
  roots.push(root);
  const file = join(root, "workflow.json");
  writeFileSync(
    file,
    JSON.stringify({
      name: "private-fill",
      semantic: { version: 1 },
      args: { quantity: { required: false } },
      steps: [
        {
          id: "fill",
          tool: "semantic.step",
          args: {
            op: "fill",
            target: { query: "Quantity", role: "spinbutton" },
            input: "quantity",
          },
        },
      ],
    }),
  );
  return { root, file };
}

function run(args: string[], root: string, input?: string) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    input,
    env: {
      ...process.env,
      TYPESAFE_API_KEY: "",
      XDG_CONFIG_HOME: join(root, "config"),
      SURF_SOCKET: join(root, "absent.sock"),
    },
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("semantic workflow CLI policy", () => {
  it("validates and dry-runs offline without exposing stdin inputs", () => {
    const { root, file } = fixture();
    const validated = run(["workflow.validate", file], root);
    expect(validated.status).toBe(0);

    const sentinel = "PRIVATE_INPUT_SENTINEL_311";
    const dryRun = run(
      ["do", "--file", file, "--dry-run", "--inputs-stdin"],
      root,
      JSON.stringify({ quantity: sentinel }),
    );
    expect(dryRun.status).toBe(0);
    expect(`${dryRun.stdout}${dryRun.stderr}`).not.toContain(sentinel);
  });

  it("rejects missing capabilities before browser or credential access", () => {
    const { root, file } = fixture();
    const semantic = run(["do", "--file", file], root);
    expect(semantic.status).toBe(1);
    expect(semantic.stderr.trim()).toBe("Error: semantic workflows require --allow-semantic");

    const write = run(["do", "--file", file, "--allow-semantic"], root);
    expect(write.status).toBe(1);
    expect(write.stderr.trim()).toBe(
      "Error: mutation-capable semantic steps require --allow-write",
    );
  });

  it("rejects duplicate input sources without printing the value", () => {
    const { root, file } = fixture();
    const sentinel = "DUPLICATE_SECRET_SENTINEL_311";
    const result = run(
      ["do", "--file", file, "--dry-run", "--quantity", "public", "--inputs-stdin"],
      root,
      JSON.stringify({ quantity: sentinel }),
    );
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).not.toContain(sentinel);
    expect(result.stderr).toContain("supplied more than once");
  });
});
