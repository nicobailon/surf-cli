import { describe, expect, it } from "vitest";

declare const __dirname: string;
declare const process: {
  execPath: string;
};
declare const require: (moduleName: string) => any;

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cliPath = path.resolve(__dirname, "../../native/cli.cjs");

function captureCliRequest(args: string[]) {
  const script = `
    const { EventEmitter } = require("node:events");
    const net = require("node:net");
    const cliPath = ${JSON.stringify(cliPath)};
    const cliArgs = ${JSON.stringify(args)};

    net.createConnection = (_socketPath, onConnect) => {
      const socket = new EventEmitter();
      socket.write = (data) => {
        console.log(String(data).trim());
        process.exit(0);
      };
      socket.end = () => {};
      socket.destroy = () => {};
      process.nextTick(onConnect);
      return socket;
    };

    process.argv = [process.execPath, cliPath, ...cliArgs];
    require(cliPath);
  `;

  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: path.resolve(__dirname, "../.."),
    encoding: "utf8",
  });

  if (result.status !== 0 || result.stderr !== "") {
    throw new Error(`CLI capture failed: status=${result.status} stderr=${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

describe("cookie space-separated CLI subcommands", () => {
  it("maps cookie list to cookie.list", () => {
    const request = captureCliRequest(["cookie", "list"]);

    expect(request.params.tool).toBe("cookie.list");
    expect(request.params.args).toEqual({});
  });

  it("maps cookie get name to cookie.get --name", () => {
    const request = captureCliRequest(["cookie", "get", "session"]);

    expect(request.params.tool).toBe("cookie.get");
    expect(request.params.args).toEqual({ name: "session" });
  });

  it("maps cookie set flags to cookie.set", () => {
    const request = captureCliRequest(["cookie", "set", "--name", "session", "--value", "abc123"]);

    expect(request.params.tool).toBe("cookie.set");
    expect(request.params.args).toEqual({ name: "session", value: "abc123" });
  });

  it("maps cookie clear --all to cookie.clear --all", () => {
    const request = captureCliRequest(["cookie", "clear", "--all"]);

    expect(request.params.tool).toBe("cookie.clear");
    expect(request.params.args).toEqual({ all: true });
  });

  it("maps cookie delete name to cookie.clear --name", () => {
    const request = captureCliRequest(["cookie", "delete", "session"]);

    expect(request.params.tool).toBe("cookie.clear");
    expect(request.params.args).toEqual({ name: "session" });
  });

  it("preserves existing dot-command behavior", () => {
    const request = captureCliRequest(["cookie.set", "--name", "session", "--value", "abc123"]);

    expect(request.params.tool).toBe("cookie.set");
    expect(request.params.args).toEqual({ name: "session", value: "abc123" });
  });
});
