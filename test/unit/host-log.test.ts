import { afterEach, beforeEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHostLog } = require("../../native/host-log.cjs");

describe("createHostLog", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "surf-host-log-"));
    file = path.join(dir, "surf-host.log");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Each line is 10 bytes; the log rotates once it holds 40 or more.
  const line = (n: number) => `line ${String(n).padStart(4, "0")}\n`;

  it("moves the log to .1 past the threshold and keeps only one old copy", () => {
    const log = createHostLog({ file, maxBytes: 40, checkEveryBytes: 10 });

    for (let n = 1; n <= 5; n++) {
      log(line(n));
    }
    expect(fs.readFileSync(`${file}.1`, "utf8")).toBe([1, 2, 3, 4].map(line).join(""));
    expect(fs.readFileSync(file, "utf8")).toBe(line(5));

    for (let n = 6; n <= 9; n++) {
      log(line(n));
    }
    expect(fs.readFileSync(`${file}.1`, "utf8")).toBe([5, 6, 7, 8].map(line).join(""));
    expect(fs.readFileSync(file, "utf8")).toBe(line(9));
    expect(fs.readdirSync(dir).sort()).toEqual(["surf-host.log", "surf-host.log.1"]);
  });

  it("counts a log left by an earlier host toward the threshold", () => {
    fs.writeFileSync(file, [1, 2, 3, 4].map(line).join(""));
    const log = createHostLog({ file, maxBytes: 40, checkEveryBytes: 10 });

    log(line(5));
    expect(fs.readFileSync(`${file}.1`, "utf8")).toBe([1, 2, 3, 4].map(line).join(""));
    expect(fs.readFileSync(file, "utf8")).toBe(line(5));
  });

  it("never throws when the log can't be written", () => {
    const log = createHostLog({ file: path.join(dir, "missing", "surf-host.log") });
    expect(() => log(line(1))).not.toThrow();
  });
});
