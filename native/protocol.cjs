"use strict";
const encodeMessage = (obj) => {
  const json = JSON.stringify(obj);
  const buf = Buffer.alloc(4 + Buffer.byteLength(json));
  buf.writeUInt32LE(Buffer.byteLength(json), 0);
  buf.write(json, 4);
  return buf;
};

const createMessageReader = (onMessage) => {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const msgLen = buffer.readUInt32LE(0);
      if (buffer.length < 4 + msgLen) break;
      const json = buffer.slice(4, 4 + msgLen).toString();
      buffer = buffer.slice(4 + msgLen);
      try {
        onMessage(JSON.parse(json));
      } catch {
        onMessage({ error: "Invalid JSON" });
      }
    }
  };
};

module.exports = { encodeMessage, createMessageReader };
