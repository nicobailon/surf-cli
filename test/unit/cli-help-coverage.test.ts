import { afterAll, describe, expect, it } from "vitest";

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

const fs = require("node:fs");
const cli = path.resolve("native/cli.cjs");

function surfIn(cwd: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    env: { ...env, HOME: cwd },
    cwd,
    encoding: "utf8",
  });
  return { code: result.status, stdout: result.stdout as string, stderr: result.stderr as string };
}

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

describe("hook, use and an op's inputs in help", () => {
  const made: string[] = [];
  afterAll(() => {
    for (const dir of made) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // A project playbook with a read op that pages and a write op with a required input.
  function project() {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "surf-op-help-"));
    made.push(cwd);
    const dir = path.join(cwd, ".surf", "playbooks", "books");
    fs.mkdirSync(path.join(dir, "ops"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "playbook.json"),
      JSON.stringify({ id: "books", version: "1.0.0" }),
    );
    const ops = {
      list_books: {
        id: "list_books",
        description: "books with prices",
        args: { page: { default: 2, example: 2 } },
        request: { url: "https://books.toscrape.com/catalogue/page-{{page}}.html" },
      },
      order: {
        id: "order",
        description: "place an order",
        args: { custname: { required: true, desc: "Customer name" } },
        request: {
          method: "POST",
          url: "https://httpbin.org/post",
          body: { custname: "{{custname}}" },
        },
      },
    };
    for (const [id, op] of Object.entries(ops)) {
      fs.writeFileSync(path.join(dir, "ops", `${id}.json`), JSON.stringify(op));
    }
    return cwd;
  }

  it("names hook and use on the first help screen and in --llm-context", () => {
    expect(surf("--help").stdout).toContain(
      '  hook <url> --goal "<what>"  Make a saved, tested op from a page\'s data\n' +
        "  use <site> <op>    Run a saved op; add --help for its inputs\n",
    );
    expect(surf("--llm-context").stdout).toContain(
      'Saved ops: surf hook <url> --goal "<what>" saves a tested op from a page\'s data; surf use <site> <op> runs it   # --help after it lists its inputs\n',
    );
  });

  it.each(["api", "scrape", "extract", "op", "playbook", "save", "reuse"])(
    "surf --find %s lists hook and use",
    (term) => {
      const { code, stdout } = surf("--find", term);
      expect(code).toBe(0);
      expect(stdout).toMatch(/^ {2}hook {2,}/m);
      expect(stdout).toMatch(/^ {2}use {2,}/m);
    },
  );

  it("surf use <site> <op> --help prints the op, then the use flags", () => {
    const cwd = project();
    const read = surfIn(cwd, "use", "books", "list_books", "--help");
    expect(read.code).toBe(0);
    expect(read.stderr).toBe("");
    expect(read.stdout).toMatch(
      /^\nbooks list_books - books with prices \(read\)\n\nInputs:\n {2}--page \(default 2\)\n\nuse - Run a playbook operation/,
    );
    expect(read.stdout).toContain("Usage: surf use <playbook> <op>");
    const write = surfIn(cwd, "use", "books", "order", "--custname", "Ada", "--help");
    expect(write.stdout).toMatch(
      /^\nbooks order - place an order \(write\)\n\nInputs:\n {2}--custname \(required\) +Customer name\n/,
    );
  });

  it("surf use with an unknown op says so, then prints the use flags", () => {
    const { code, stdout, stderr } = surfIn(project(), "use", "books", "nope", "--help");
    expect(code).toBe(0);
    expect(stderr).toBe("Op not found: books nope\n");
    expect(stdout).toContain("Usage: surf use <playbook> <op>");
  });

  it("surf pb ops lists each op's inputs", () => {
    const { code, stdout } = surfIn(project(), "pb", "ops", "books");
    expect(code).toBe(0);
    const ops = JSON.parse(stdout);
    expect(ops.map((op: { id: string; inputs: string[] }) => [op.id, op.inputs])).toEqual([
      ["list_books", ["--page (default 2)"]],
      ["order", ["--custname (required)"]],
    ]);
  });
});
