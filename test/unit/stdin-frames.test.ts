import { describe, expect, it } from "vitest";

const Buffer: any = require("node:buffer").Buffer;
const { takeFrames } = require("../../native/stdin-frames.cjs") as {
  takeFrames(buffer: any): { frames: string[]; rest: any };
};

function encodeFrame(message: unknown) {
  const body = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}

describe("takeFrames", () => {
  it("returns nothing for an empty or header-only buffer", () => {
    expect(takeFrames(Buffer.alloc(0))).toEqual({ frames: [], rest: Buffer.alloc(0) });
    const header = Buffer.alloc(3);
    const partial = takeFrames(header);
    expect(partial.frames).toEqual([]);
    expect(partial.rest).toBe(header);
  });

  it("decodes one complete frame", () => {
    const { frames, rest } = takeFrames(encodeFrame({ type: "TARGET_EVENT" }));
    expect(frames).toEqual(['{"type":"TARGET_EVENT"}']);
    expect(rest.length).toBe(0);
  });

  it("drains every complete frame that arrived in one chunk", () => {
    // A TARGET_EVENT followed by a tool reply is the common shape; both
    // must come out of a single chunk or the reply waits for the next one.
    const chunk = Buffer.concat([
      encodeFrame({ type: "EXTENSION_HELLO" }),
      encodeFrame({ type: "TARGET_EVENT", event: "updated" }),
      encodeFrame({ id: 12, output: '"done"' }),
    ]);
    const { frames, rest } = takeFrames(chunk);
    expect(frames.map((frame: string) => JSON.parse(frame))).toEqual([
      { type: "EXTENSION_HELLO" },
      { type: "TARGET_EVENT", event: "updated" },
      { id: 12, output: '"done"' },
    ]);
    expect(rest.length).toBe(0);
  });

  it("keeps a trailing partial frame for the next chunk", () => {
    const whole = encodeFrame({ id: 1, ok: true });
    const next = encodeFrame({ id: 2, ok: true });
    const cut = next.subarray(0, 7);
    const first = takeFrames(Buffer.concat([whole, cut]));
    expect(first.frames).toEqual(['{"id":1,"ok":true}']);
    expect(first.rest.equals(cut)).toBe(true);
    const second = takeFrames(Buffer.concat([first.rest, next.subarray(7)]));
    expect(second.frames).toEqual(['{"id":2,"ok":true}']);
    expect(second.rest.length).toBe(0);
  });

  it("decodes multi-byte UTF-8 payloads by byte length", () => {
    const { frames } = takeFrames(
      Buffer.concat([encodeFrame({ title: "ünïcödé ✓" }), encodeFrame({ id: 3 })]),
    );
    expect(JSON.parse(frames[0])).toEqual({ title: "ünïcödé ✓" });
    expect(JSON.parse(frames[1])).toEqual({ id: 3 });
  });
});
