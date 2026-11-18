import { afterEach, describe, expect, it, vi } from "vitest";

declare const require: (moduleName: string) => any;
declare const Buffer: { from(value: string): any };

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const { VideoRecorder, VideoRecorderError, findFfmpeg, parseVideoFps, validateVideoOutputPath } =
  require("../../native/video-recorder.cjs") as any;

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fakeChild({ closeOnEnd = true } = {}) {
  const child: any = new EventEmitter();
  child.killed = false;
  child.stderr = new EventEmitter();
  child.stdin = {
    destroyed: false,
    writableEnded: false,
    writableNeedDrain: false,
    writes: [],
    write(data: any) {
      this.writes.push(data);
      return true;
    },
    end() {
      this.writableEnded = true;
      if (closeOnEnd) {
        queueMicrotask(() => child.emit("close", 0, null));
      }
    },
    destroy() {
      this.destroyed = true;
    },
  };
  child.kill = () => {
    child.killed = true;
  };
  queueMicrotask(() => child.emit("spawn"));
  return child;
}

describe("local WebM video recorder", () => {
  it("validates FPS and output paths", () => {
    expect(parseVideoFps(undefined)).toBe(30);
    expect(parseVideoFps(60)).toBe(60);
    expect(() => parseVideoFps(0)).toThrow(VideoRecorderError);
    expect(() => parseVideoFps(61)).toThrow(VideoRecorderError);

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "surf-video-test-"));
    temporaryDirectories.push(directory);
    expect(() =>
      validateVideoOutputPath(path.join(directory, "nested", "take.webm"), { createParent: false }),
    ).not.toThrow();
    expect(() => validateVideoOutputPath(directory)).toThrow(/directory/);
  });

  it("starts ffmpeg with VP9 WebM settings, accepts screencast frames, and finalizes", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "surf-video-test-"));
    temporaryDirectories.push(directory);
    const output = path.join(directory, "nested", "take.webm");
    const child = fakeChild();
    const spawnImpl = vi.fn(() => child);
    const recorder = new VideoRecorder({
      output,
      fps: 24,
      tabId: 42,
      recorderId: "recorder-1",
      spawnImpl,
      startupGraceMs: 0,
      now: () => 1000,
      setIntervalImpl: (() => 1) as any,
      clearIntervalImpl: vi.fn(),
    });

    await expect(recorder.start()).resolves.toMatchObject({ status: "active", fps: 24, tabId: 42 });
    expect(spawnImpl).toHaveBeenCalledWith(
      "ffmpeg",
      expect.arrayContaining([
        "-f",
        "image2pipe",
        "-c:v",
        "libvpx-vp9",
        "-vf",
        "pad=ceil(iw/2)*2:ceil(ih/2)*2",
        "-f",
        "webm",
        path.resolve(output),
      ]),
      expect.objectContaining({ stdio: ["pipe", "ignore", "pipe"] }),
    );
    expect(recorder.addFrame(Buffer.from("jpeg").toString("base64"), 1000)).toBe(true);
    await expect(recorder.stop()).resolves.toMatchObject({
      status: "stopped",
      frames: 1,
      capturedFrames: 1,
    });
    expect(child.stdin.writes).toHaveLength(1);
    expect(fs.existsSync(path.dirname(output))).toBe(true);
  });

  it("spawns SURF_FFMPEG when it is set, and ffmpeg on PATH when the pin is stale", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "surf-video-test-"));
    temporaryDirectories.push(directory);
    const pinnedPath = path.join(directory, "ffmpeg");
    fs.writeFileSync(pinnedPath, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(pinnedPath, 0o755);
    const commandFor = async (env: Record<string, string>) => {
      const spawnImpl = vi.fn(() => fakeChild());
      const recorder = new VideoRecorder({
        output: path.join(directory, "take.webm"),
        spawnImpl,
        startupGraceMs: 0,
        env,
        setIntervalImpl: (() => 1) as any,
        clearIntervalImpl: vi.fn(),
      });
      await recorder.start();
      await recorder.stop();
      return (spawnImpl.mock.calls[0] as any[])[0];
    };
    expect(await commandFor({ PATH: "/usr/bin:/bin", SURF_FFMPEG: pinnedPath })).toBe(pinnedPath);
    expect(
      await commandFor({ PATH: "/usr/bin:/bin", SURF_FFMPEG: path.join(directory, "gone") }),
    ).toBe("ffmpeg");
  });

  it("names the PATH the host searched when ffmpeg is missing", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "surf-video-test-"));
    temporaryDirectories.push(directory);
    const missing = () => {
      const child: any = new EventEmitter();
      queueMicrotask(() =>
        child.emit("error", Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" })),
      );
      return child;
    };
    const recorder = new VideoRecorder({
      output: path.join(directory, "take.webm"),
      spawnImpl: missing,
      startupGraceMs: 50,
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
    });
    const error = await recorder.start().catch((caught: any) => caught);
    expect(error.code).toBe("ffmpeg_missing");
    expect(error.message).toContain("native host's PATH (/usr/bin:/bin:/usr/sbin:/sbin)");
    expect(error.message).toContain("surf install");
    expect(error.message).toContain("SURF_FFMPEG");

    const pinned = new VideoRecorder({
      output: path.join(directory, "take.webm"),
      spawnImpl: missing,
      startupGraceMs: 50,
      env: { PATH: "/usr/bin:/bin", SURF_FFMPEG: "/gone/ffmpeg" },
    });
    const pinnedError = await pinned.start().catch((caught: any) => caught);
    expect(pinnedError.code).toBe("ffmpeg_missing");
    expect(pinnedError.message).toContain("SURF_FFMPEG (/gone/ffmpeg)");
    expect(pinnedError.message).toContain("native host's PATH (/usr/bin:/bin)");
  });

  it("finds ffmpeg the way the host would", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "surf-video-test-"));
    temporaryDirectories.push(directory);
    const ffmpegPath = path.join(directory, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    fs.writeFileSync(ffmpegPath, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(ffmpegPath, 0o755);
    const empty = path.join(directory, "empty");
    expect(findFfmpeg({ PATH: `${empty}${path.delimiter}${directory}` })).toBe(ffmpegPath);
    expect(findFfmpeg({ PATH: empty })).toBeNull();
    expect(findFfmpeg({ PATH: empty, SURF_FFMPEG: ffmpegPath })).toBe(ffmpegPath);
    expect(findFfmpeg({ PATH: directory, SURF_FFMPEG: path.join(empty, "ffmpeg") })).toBe(
      ffmpegPath,
    );
    expect(findFfmpeg({ PATH: empty, SURF_FFMPEG: path.join(empty, "ffmpeg") })).toBeNull();
  });

  it("reports a bounded finalization timeout", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "surf-video-test-"));
    temporaryDirectories.push(directory);
    const recorder = new VideoRecorder({
      output: path.join(directory, "take.webm"),
      spawnImpl: () => fakeChild({ closeOnEnd: false }),
      startupGraceMs: 0,
      stopTimeoutMs: 5,
    });

    await recorder.start();
    await expect(recorder.stop()).rejects.toMatchObject({ code: "ffmpeg_stop_timeout" });
  });
});
