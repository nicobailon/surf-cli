import { describe, expect, it } from "vitest";

declare const require: (moduleName: string) => any;
const { spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const cliPath = resolve("native/cli.cjs");

function capture(args: string[]) {
  const script = `
    const { EventEmitter } = require("node:events");
    require("node:net").createConnection = (_path, onConnect) => {
      const socket = new EventEmitter();
      socket.write = (data) => { console.log(String(data).trim()); process.exit(0); };
      socket.end = socket.destroy = () => {};
      process.nextTick(onConnect);
      return socket;
    };
    process.argv = [process.execPath, ${JSON.stringify(cliPath)}, ...${JSON.stringify(args)}];
    require(${JSON.stringify(cliPath)});
  `;
  return spawnSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    env: { ...process.env, SURF_REMOTE: "", SURF_SESSION: "", SURF_NO_LOCK: "1" },
    timeout: 5000,
  });
}

describe.each(["js", "frame.js"])("%s script options", (tool) => {
  const target = tool === "frame.js" ? ["--id", "child-frame"] : [];

  it.each([false, true])("prefixes code (file=%s) and removes CLI-only flags", (file) => {
    const dir = mkdtempSync(join(tmpdir(), "surf-options-"));
    const code = "return SURF_OPTIONS.limit;";
    const path = join(dir, "script.js");
    writeFileSync(path, code);
    try {
      const result = capture([
        tool,
        ...(file ? ["--file", path] : [code]),
        ...target,
        "--options",
        '{"limit":2}',
      ]);
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      const request = JSON.parse(result.stdout);
      expect(request.params.tool).toBe(tool);
      expect(request.params.args).toEqual({
        code: `const SURF_OPTIONS = Object.freeze({"limit":2});\n${code}`,
        ...(tool === "frame.js" ? { id: "child-frame" } : { autoScreenshot: true }),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves code unchanged without options", () => {
    const result = capture([tool, "return 42;", ...target]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).params.args.code).toBe("return 42;");
  });

  it.each(["[]", "null", "false", "42", '"text"', "{oops", undefined])(
    "rejects invalid options %s before sending",
    (value) => {
      const result = capture([
        tool,
        "return 1;",
        ...target,
        "--options",
        ...(value === undefined ? [] : [value]),
      ]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("--options");
      expect(result.stdout).toBe("");
    },
  );

  it("requires code", () => {
    const result = capture([tool, ...target, "--options", "{}"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--options needs code");
    expect(result.stdout).toBe("");
  });
});
