const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const DEFAULT_VIDEO_FPS = 30;
const MAX_VIDEO_FPS = 60;
const MIN_VIDEO_FPS = 1;
const VIDEO_FRAME_QUEUE_LIMIT = 2;
const VIDEO_BACKFILL_LIMIT_MS = 5000;
const DEFAULT_STARTUP_GRACE_MS = 100;
const DEFAULT_STOP_TIMEOUT_MS = 5000;

class VideoRecorderError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "VideoRecorderError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function parseVideoFps(value, fallback = DEFAULT_VIDEO_FPS) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") {
    throw new VideoRecorderError("video_fps_invalid", "fps must be a number");
  }
  const fps = Number(value);
  if (!Number.isFinite(fps) || fps < MIN_VIDEO_FPS || fps > MAX_VIDEO_FPS) {
    throw new VideoRecorderError("video_fps_invalid", `fps must be between ${MIN_VIDEO_FPS} and ${MAX_VIDEO_FPS}`);
  }
  return fps;
}

function validateVideoOutputPath(output, { createParent = true } = {}) {
  if (typeof output !== "string" || !output.trim()) {
    throw new VideoRecorderError("video_output_invalid", "video output path is required");
  }
  if (output.includes("\0")) {
    throw new VideoRecorderError("video_output_invalid", "video output path contains an invalid null byte");
  }

  const resolved = path.resolve(output);
  let existing;
  try {
    existing = fs.statSync(resolved);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw new VideoRecorderError("video_output_invalid", `Cannot access video output path: ${error.message}`);
    }
  }
  if (existing?.isDirectory()) {
    throw new VideoRecorderError("video_output_invalid", `Video output path is a directory: ${resolved}`);
  }

  const parent = path.dirname(resolved);
  if (createParent) {
    try {
      fs.mkdirSync(parent, { recursive: true });
    } catch (error) {
      throw new VideoRecorderError("video_output_unwritable", `Cannot create video output directory ${parent}: ${error.message}`);
    }
  }
  try {
    let writableParent = parent;
    while (!fs.existsSync(writableParent)) {
      const next = path.dirname(writableParent);
      if (next === writableParent) break;
      writableParent = next;
    }
    fs.accessSync(writableParent, fs.constants.W_OK);
    if (existing) fs.accessSync(resolved, fs.constants.W_OK);
  } catch (error) {
    throw new VideoRecorderError("video_output_unwritable", `Video output path is not writable: ${resolved}`);
  }

  return resolved;
}

function buildFfmpegArgs(output, fps) {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "image2pipe",
    "-vcodec",
    "mjpeg",
    "-framerate",
    String(fps),
    "-i",
    "pipe:0",
    "-an",
    "-vf",
    "pad=ceil(iw/2)*2:ceil(ih/2)*2",
    "-c:v",
    "libvpx-vp9",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-deadline",
    "realtime",
    "-row-mt",
    "1",
    "-f",
    "webm",
    output,
  ];
}

function normalizeChildError(error) {
  if (error instanceof VideoRecorderError) return error;
  const message = error?.message || String(error || "ffmpeg failed");
  if (error?.code === "ENOENT") {
    return new VideoRecorderError("ffmpeg_missing", "ffmpeg was not found on PATH. Install ffmpeg and retry.");
  }
  return new VideoRecorderError("ffmpeg_failed", message);
}

class VideoRecorder {
  constructor({
    output,
    fps = DEFAULT_VIDEO_FPS,
    tabId,
    recorderId,
    spawnImpl = spawn,
    now = () => Date.now(),
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
    startupGraceMs = DEFAULT_STARTUP_GRACE_MS,
    stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
    onFailure = () => {},
  } = {}) {
    this.output = validateVideoOutputPath(output, { createParent: false });
    this.fps = parseVideoFps(fps);
    this.tabId = tabId;
    this.recorderId = recorderId;
    this.spawnImpl = spawnImpl;
    this.now = now;
    this.setIntervalImpl = setIntervalImpl;
    this.clearIntervalImpl = clearIntervalImpl;
    this.startupGraceMs = startupGraceMs;
    this.stopTimeoutMs = stopTimeoutMs;
    this.onFailure = onFailure;

    this.state = "idle";
    this.child = null;
    this.ticker = null;
    this.startedAt = null;
    this.stoppedAt = null;
    this.frames = 0;
    this.capturedFrames = 0;
    this.lastFrame = null;
    this.frameQueue = [];
    this.failure = null;
    this.closeCode = null;
    this.closeSignal = null;
    this.stopPromise = null;
    this._failureNotified = false;
  }

  get intervalMs() {
    return Math.max(1, Math.round(1000 / this.fps));
  }

  status() {
    return {
      status: this.state === "active" || this.state === "starting" || this.state === "stopping" ? "active" : this.state,
      recorderId: this.recorderId,
      path: this.output,
      fps: this.fps,
      tabId: this.tabId,
      startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : undefined,
      stoppedAt: this.stoppedAt ? new Date(this.stoppedAt).toISOString() : undefined,
      durationMs: this.startedAt ? Math.max(0, (this.stoppedAt || this.now()) - this.startedAt) : 0,
      frames: this.frames,
      capturedFrames: this.capturedFrames,
      ...(this.failure ? { error: this.failure.message, errorCode: this.failure.code } : {}),
    };
  }

  async start() {
    if (this.state !== "idle") {
      throw new VideoRecorderError("video_recorder_state", `Cannot start video recorder in state ${this.state}`);
    }
    // Create the parent only after all basic path validation has completed.
    validateVideoOutputPath(this.output, { createParent: true });

    this.state = "starting";
    this.startedAt = this.now();
    let child;
    try {
      child = this.spawnImpl("ffmpeg", buildFfmpegArgs(this.output, this.fps), {
        stdio: ["pipe", "ignore", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      this._fail(normalizeChildError(error));
      throw this.failure;
    }
    this.child = child;
    this._attachChildListeners(child);

    try {
      await this._waitForStartup();
    } catch (error) {
      const normalized = normalizeChildError(error);
      this._fail(normalized);
      await this._killChild();
      throw normalized;
    }
    if (this.state === "failed") throw this.failure;

    this.state = "active";
    this.ticker = this.setIntervalImpl(() => this._tick(), this.intervalMs);
    // A frame can arrive while the start command is settling; encode it
    // without waiting for the first interval, then keep a wall-clock cadence.
    this._tick();
    return this.status();
  }

  addFrame(data, receivedAt = this.now()) {
    if (this.state !== "starting" && this.state !== "active") return false;
    if (typeof data !== "string" || !data) return false;
    let frame;
    try {
      frame = Buffer.from(data, "base64");
    } catch {
      return false;
    }
    if (!frame.length) return false;

    this.capturedFrames += 1;
    this.lastFrame = { data: frame, receivedAt };
    this.frameQueue.push(this.lastFrame);
    while (this.frameQueue.length > VIDEO_FRAME_QUEUE_LIMIT) this.frameQueue.shift();
    // The wall-clock ticker is the sole write path once active, so a busy
    // screencast cannot make ffmpeg run faster than the requested FPS.
    return true;
  }

  async stop() {
    if (this.stopPromise) return this.stopPromise;
    if (this.state === "idle") {
      throw new VideoRecorderError("video_not_active", "No active video recording");
    }
    if (this.state === "failed") throw this.failure;

    this.stopPromise = this._stopInternal();
    return this.stopPromise;
  }

  async dispose() {
    if (this.stopPromise) return this.stopPromise.catch(() => this.status());
    if (this.state === "idle" || this.state === "stopped") return this.status();
    this._clearTicker();
    await this._killChild();
    this.state = "stopped";
    this.stoppedAt = this.now();
    return this.status();
  }

  _attachChildListeners(child) {
    child.once?.("error", (error) => {
      if (this.state === "stopping" || this.state === "stopped") return;
      this._fail(normalizeChildError(error));
    });
    child.once?.("exit", (code, signal) => {
      this.closeCode = code;
      this.closeSignal = signal;
      if (this.state === "starting") {
        this._fail(new VideoRecorderError("ffmpeg_exit_early", `ffmpeg exited before recording started${code === null ? "" : ` (code ${code})`}`));
      } else if (this.state === "active") {
        this._fail(new VideoRecorderError("ffmpeg_exited", `ffmpeg exited while recording${code === null ? "" : ` (code ${code})`}`));
      }
    });
    child.once?.("close", (code, signal) => {
      this.closeCode = code;
      this.closeSignal = signal;
      if (this.state === "starting") {
        this._fail(new VideoRecorderError("ffmpeg_exit_early", `ffmpeg exited before recording started${code === null ? "" : ` (code ${code})`}`));
      } else if (this.state === "active") {
        this._fail(new VideoRecorderError("ffmpeg_exited", `ffmpeg exited while recording${code === null ? "" : ` (code ${code})`}`));
      }
    });
    child.stdin?.once?.("error", (error) => {
      if (this.state === "stopping" || this.state === "stopped") return;
      this._fail(normalizeChildError(error));
    });
    child.stderr?.on?.("data", (chunk) => {
      const text = String(chunk || "").trim();
      if (!text) return;
      this.stderr = `${this.stderr || ""}${text}\n`.slice(-8192);
    });
  }

  _waitForStartup() {
    const child = this.child;
    if (!child) return Promise.reject(new VideoRecorderError("ffmpeg_failed", "ffmpeg process was not created"));
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        error ? reject(error) : resolve();
      };
      const onSpawn = () => {
        timer = setTimeout(() => finish(), this.startupGraceMs);
      };
      child.once?.("spawn", onSpawn);
      child.once?.("error", (error) => finish(normalizeChildError(error)));
      child.once?.("exit", (code) => {
        finish(new VideoRecorderError("ffmpeg_exit_early", `ffmpeg exited before recording started${code === null ? "" : ` (code ${code})`}`));
      });
      child.once?.("close", (code) => {
        finish(new VideoRecorderError("ffmpeg_exit_early", `ffmpeg exited before recording started${code === null ? "" : ` (code ${code})`}`));
      });
      // Real ChildProcess instances emit spawn, but a small process wrapper may
      // not. Do not leave a recorder hanging forever in that case.
      timer = setTimeout(() => finish(), this.startupGraceMs);
    });
  }

  _tick() {
    if (this.state !== "active") return;
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed || stdin.writableEnded || stdin.writableNeedDrain) return;

    const now = this.now();
    let frame = this.frameQueue.shift() || this.lastFrame;
    if (!frame) return;

    // Never replay a queued frame after an arbitrarily long event-loop stall.
    // The live ticker continues from the latest frame, but stale backfill is
    // intentionally limited to a few seconds.
    if (now - frame.receivedAt > VIDEO_BACKFILL_LIMIT_MS) {
      frame = this.lastFrame;
    }
    try {
      stdin.write(frame.data);
      this.frames += 1;
    } catch (error) {
      this._fail(normalizeChildError(error));
    }
  }

  async _stopInternal() {
    this._clearTicker();
    // Flush only a pending frame before closing stdin. Replaying the latest
    // already-written frame here would add an unnecessary duplicate at stop.
    if (this.frameQueue.length > 0) this._tick();
    this.state = "stopping";
    this.stoppedAt = this.now();
    const child = this.child;
    if (!child) {
      this.state = "stopped";
      return this.status();
    }

    const closeResult = await new Promise((resolve) => {
      let settled = false;
      let timer;
      const finish = (code, signal, timedOut = false) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve({ code, signal, timedOut });
      };
      child.once?.("close", finish);
      child.once?.("exit", finish);
      try {
        if (child.stdin && !child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end();
        else if (child.stdin?.destroy) child.stdin.destroy();
      } catch (error) {
        this._fail(normalizeChildError(error));
        finish(null, null);
      }
      timer = setTimeout(() => {
        try { child.kill?.("SIGTERM"); } catch {}
        finish(this.closeCode, this.closeSignal, true);
      }, this.stopTimeoutMs);
    });
    if (closeResult.timedOut) {
      this.failure = new VideoRecorderError("ffmpeg_stop_timeout", `ffmpeg did not exit within ${this.stopTimeoutMs}ms while finalizing the recording`);
      this.state = "failed";
      throw this.failure;
    }
    this.closeCode = closeResult.code;
    this.closeSignal = closeResult.signal;
    if (this.failure) {
      this.state = "failed";
      throw this.failure;
    }
    if (closeResult.code !== null && closeResult.code !== undefined && closeResult.code !== 0) {
      const detail = this.stderr ? `: ${this.stderr.trim()}` : "";
      this.failure = new VideoRecorderError("ffmpeg_failed", `ffmpeg failed while finalizing the recording (code ${closeResult.code})${detail}`);
      this.state = "failed";
      throw this.failure;
    }
    this.state = "stopped";
    return this.status();
  }

  _clearTicker() {
    if (this.ticker !== null) {
      this.clearIntervalImpl(this.ticker);
      this.ticker = null;
    }
  }

  _fail(error) {
    if (this.failure) return;
    this.failure = normalizeChildError(error);
    this.state = "failed";
    this._clearTicker();
    if (!this._failureNotified) {
      this._failureNotified = true;
      try { this.onFailure(this.failure, this); } catch {}
    }
  }

  async _killChild() {
    const child = this.child;
    if (!child || child.killed) return;
    try { child.kill("SIGTERM"); } catch {}
  }
}

module.exports = {
  DEFAULT_STARTUP_GRACE_MS,
  DEFAULT_STOP_TIMEOUT_MS,
  DEFAULT_VIDEO_FPS,
  MAX_VIDEO_FPS,
  MIN_VIDEO_FPS,
  VIDEO_BACKFILL_LIMIT_MS,
  VIDEO_FRAME_QUEUE_LIMIT,
  VideoRecorder,
  VideoRecorderError,
  parseVideoFps,
  validateVideoOutputPath,
};
