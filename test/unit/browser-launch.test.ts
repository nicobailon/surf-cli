import { describe, expect, it } from "vitest";

declare const require: (moduleName: string) => any;
declare const process: { env: Record<string, string | undefined>; execPath: string };

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { launchArgv } = require("../../native/browser-launch.cjs");

describe("browser autostart command", () => {
  it("opens the app with the URL on macOS", () => {
    expect(
      launchArgv({ app: "brave", url: "https://example.com/a" }, { platform: "darwin" }),
    ).toEqual(["open", "-a", "Brave Browser", "https://example.com/a"]);
  });

  it("starts the browser through cmd on Windows", () => {
    expect(
      launchArgv({ app: "edge", url: "https://example.com/?a=1&b=2" }, { platform: "win32" }),
    ).toEqual(["cmd", "/c", "start", '""', "msedge", '"https://example.com/?a=1&b=2"']);
  });

  it("runs the first known binary on PATH on Linux, and needs a display", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "surf-launch-"));
    fs.writeFileSync(path.join(dir, "google-chrome"), "");
    expect(launchArgv({}, { platform: "linux", env: { PATH: dir, DISPLAY: ":0" } })).toEqual([
      path.join(dir, "google-chrome"),
    ]);
    expect(() => launchArgv({}, { platform: "linux", env: { PATH: dir } })).toThrow(/no display/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("uses browser.command as given, with the URL last", () => {
    expect(
      launchArgv(
        {
          app: "arc",
          command: ["/opt/chrome", "--profile-directory=Work"],
          url: "https://x.test/",
        },
        { platform: "linux" },
      ),
    ).toEqual(["/opt/chrome", "--profile-directory=Work", "https://x.test/"]);
  });

  it("never puts a raw quote from the URL on the Windows command line", () => {
    const argv = launchArgv({ url: 'https://x.test/?q="&calc.exe&"' }, { platform: "win32" });
    expect(argv.at(-1)).toBe('"https://x.test/?q=%22&calc.exe&%22"');
  });

  it("fails fast when the launcher exits with an error", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "surf-autostart-"));
    fs.writeFileSync(
      path.join(dir, "surf.json"),
      JSON.stringify({
        browser: {
          autostart: true,
          command: [process.execPath, "-e", "process.exit(1)"],
          timeoutMs: 20_000,
        },
      }),
    );
    const env = {
      ...process.env,
      HOME: dir,
      SURF_SOCKET: path.join(dir, "none.sock"),
      SURF_SESSION: undefined,
      SURF_REMOTE: undefined,
    };
    const started = Date.now();
    const result = spawnSync(process.execPath, [path.resolve("native/cli.cjs"), "tab.list"], {
      cwd: dir,
      env,
      encoding: "utf8",
      timeout: 10_000,
    });
    fs.rmSync(dir, { recursive: true, force: true });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `Autostart could not run ${process.execPath}: exited with code 1`,
    );
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 15_000);
});
