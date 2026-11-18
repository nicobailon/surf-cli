import { describe, expect, it } from "vitest";

declare const process: { env: Record<string, string | undefined>; execPath: string };
declare const require: (moduleName: string) => any;

const { spawnSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

// A socket path nothing listens on: reaching the host would fail with a connect error instead.
const env = {
  ...process.env,
  SURF_SOCKET: path.join(os.tmpdir(), `surf-help-${Date.now()}.sock`),
  SURF_REMOTE: undefined,
  SURF_SESSION: undefined,
};

function surf(...args: string[]) {
  const result = spawnSync(process.execPath, ["native/cli.cjs", ...args], {
    env,
    encoding: "utf8",
  });
  return { code: result.status, stdout: result.stdout as string, stderr: result.stderr as string };
}

describe("CLI help for commands outside the main tool list", () => {
  it.each([
    [["use", "--help"], "Usage: surf use <playbook> <op>"],
    [["pb", "--help"], "playbook - Reusable site operations"],
    [["playbook", "--help"], "playbook record start <playbook>"],
    [["pb", "record", "start", "--help"], "Usage: surf playbook record start <playbook>"],
    [["semantic", "auth", "--help"], "surf semantic auth set"],
    [["remote", "--help"], "remote authorize <label>"],
    [["remote", "authorize", "--help"], "--output"],
    [["oracle", "ask", "--help"], "Usage: surf oracle <ask|status|result|follow|list>"],
    [["oracle", "result", "--help"], "--effort <effort>"],
    [["config", "--help"], "Usage: surf config"],
  ])("surf %j prints usage", (args, expected) => {
    const { code, stdout, stderr } = surf(...args);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain(expected);
  });

  it.each([
    ["oracle", "oracle ask"],
    ["semantic", "semantic.extract"],
    ["thread", "use"],
    ["playbook", "playbook record start"],
  ])("surf --find %s lists %s", (term, command) => {
    const { code, stdout } = surf("--find", term);
    expect(code).toBe(0);
    expect(stdout).toMatch(new RegExp(`^  ${command} `, "m"));
  });

  it("lists the new groups in --help-full", () => {
    const { stdout } = surf("--help-full");
    for (const group of ["SEMANTIC", "ORACLE", "PLAYBOOK", "REMOTE", "SETUP"]) {
      expect(stdout).toMatch(new RegExp(`^${group} - `, "m"));
    }
  });

  it("rejects an unknown command with the closest names before contacting the host", () => {
    const { code, stdout, stderr } = surf("bookmarks");
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("Unknown command: bookmarks");
    expect(stderr).toContain("Did you mean: bookmark.add, bookmark.list, bookmark.remove?");
    expect(surf("key.repeat", "--help").stderr).toContain("Did you mean: key?");
  });

  it.each(["computer", "go", "get_network_entries", "get_network_entry"])(
    "sends the host-only or aliased name %s to the host",
    (name) => {
      const { stderr } = surf(name);
      expect(stderr).toContain("Socket connect failed");
      expect(stderr).not.toContain("Unknown command");
    },
  );

  it("keeps the socket tool list free of local commands", () => {
    const { stdout } = surf("--list");
    expect(stdout).toContain("page.read");
    expect(stdout).not.toMatch(/\b(use|oracle ask|remote authorize|semantic\.find)\b/);
  });
});
