/**
 * Native messaging framing: every message from the extension arrives as a
 * 4-byte little-endian length followed by that many bytes of UTF-8 JSON.
 *
 * One stdin chunk routinely carries several complete frames (a TARGET_EVENT
 * followed by the reply to a tool request is the common case), so a reader
 * must take every complete frame out of the buffer before waiting for more
 * input. Leaving one behind stalls that reply until the extension sends
 * something else.
 */

const HEADER_BYTES = 4;

/**
 * Split `buffer` into complete frames and the unread remainder.
 *
 * @param {Buffer} buffer
 * @returns {{ frames: string[], rest: Buffer }} decoded frame payloads in
 *   arrival order, and the bytes of any trailing partial frame.
 */
function takeFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= HEADER_BYTES) {
    const length = buffer.readUInt32LE(offset);
    if (buffer.length - offset < HEADER_BYTES + length) break;
    frames.push(buffer.subarray(offset + HEADER_BYTES, offset + HEADER_BYTES + length).toString("utf8"));
    offset += HEADER_BYTES + length;
  }
  return { frames, rest: offset === 0 ? buffer : buffer.subarray(offset) };
}

/** Encode one message the way the extension does, for tests and tools. */
function encodeFrame(message) {
  const json = Buffer.from(typeof message === "string" ? message : JSON.stringify(message), "utf8");
  const frame = Buffer.alloc(HEADER_BYTES + json.length);
  frame.writeUInt32LE(json.length, 0);
  json.copy(frame, HEADER_BYTES);
  return frame;
}

module.exports = { HEADER_BYTES, encodeFrame, takeFrames };
