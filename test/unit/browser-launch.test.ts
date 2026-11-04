import { describe, expect, it } from "vitest";

declare const require: (moduleName: string) => any;

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { launchArgv } = require("../../native/browser-launch.cjs");

describe("browser autostart command", () => {
  it("opens the app with the URL on macOS", () => {
    expect(
      launchArgv({ app: "brave", url: "https://example.com" }, { platform: "darwin" }),
    ).toEqual(["open", "-a", "Brave Browser", "https://example.com"]);
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
        { app: "arc", command: ["/opt/chrome", "--profile-directory=Work"], url: "https://x.test" },
        { platform: "linux" },
      ),
    ).toEqual(["/opt/chrome", "--profile-directory=Work", "https://x.test"]);
  });
});
