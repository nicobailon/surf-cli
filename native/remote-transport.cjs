const net = require("net");
const crypto = require("crypto");
const { loadCredential, loadHostIdentity, loadRegistry, NONCE_BYTES, PROTOCOL_VERSION, signProof, signChallenge, verifyChallenge, verifyProof } = require("./remote-auth.cjs");

const MAX_FRAME_BYTES = 1024 * 1024;
const DEFAULT_FRAME_TIMEOUT_MS = 10000;
const DEFAULT_AUTH_TIMEOUT_MS = 5000;

function writeFrame(socket, value) {
  const encoded = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (encoded.length - 1 > MAX_FRAME_BYTES) return Promise.reject(new Error("frame exceeds byte limit"));
  return new Promise((resolve, reject) => {
    let settled = false;
    let drainListener;
    const cleanup = () => {
      socket.removeListener("error", fail);
      socket.removeListener("close", close);
      if (drainListener) socket.removeListener("drain", drainListener);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const done = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const close = () => fail(new Error("socket closed while writing frame"));
    socket.once("error", fail);
    socket.once("close", close);
    if (socket.write(encoded)) {
      done();
    } else {
      drainListener = done;
      socket.once("drain", drainListener);
    }
  });
}

function createSocketWriter(socket, { maxPendingBytes = 4 * 1024 * 1024, onOverflow = () => {} } = {}) {
  const queue = [];
  let pendingBytes = 0;
  let writing = false;
  let current;
  let currentErrorListener;
  let closed = false;
  let drainListener;
  const failQueue = (error) => {
    while (queue.length) queue.shift().reject(error);
    pendingBytes = 0;
  };
  const close = (error = new Error("socket writer closed")) => {
    if (closed) return;
    closed = true;
    if (drainListener) socket.removeListener("drain", drainListener);
    if (current) {
      const item = current;
      current = undefined;
      writing = false;
      if (currentErrorListener) socket.removeListener("error", currentErrorListener);
      currentErrorListener = undefined;
      item.reject(error);
    }
    failQueue(error);
  };
  const pump = () => {
    if (writing || closed || queue.length === 0) return;
    writing = true;
    const item = queue.shift();
    current = item;
    const finish = (error) => {
      if (!writing) return;
      writing = false;
      current = undefined;
      pendingBytes -= item.bytes;
      socket.removeListener("error", finish);
      if (currentErrorListener === finish) currentErrorListener = undefined;
      if (drainListener) {
        socket.removeListener("drain", drainListener);
        drainListener = undefined;
      }
      if (error) item.reject(error);
      else item.resolve();
      pump();
    };
    currentErrorListener = finish;
    socket.once("error", finish);
    try {
      if (socket.write(item.encoded)) {
        socket.removeListener("error", finish);
        finish();
      } else {
        drainListener = () => {
          drainListener = undefined;
          socket.removeListener("error", finish);
          finish();
        };
        socket.once("drain", drainListener);
      }
    } catch (error) {
      socket.removeListener("error", finish);
      finish(error);
    }
  };
  const send = (value, { stream = false } = {}) => {
    if (closed) return Promise.reject(new Error("socket writer is closed"));
    const encoded = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
    if (encoded.length - 1 > MAX_FRAME_BYTES) return Promise.reject(new Error("frame exceeds byte limit"));
    if (pendingBytes + encoded.length > maxPendingBytes) {
      const error = new Error("socket writer queue is full");
      onOverflow({ stream, error });
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      queue.push({ encoded, bytes: encoded.length, resolve, reject });
      pendingBytes += encoded.length;
      pump();
    });
  };
  return { send, close, get pendingBytes() { return pendingBytes; } };
}

function createFrameParser({ onFrame, onError, maxFrameBytes = MAX_FRAME_BYTES, frameTimeoutMs = DEFAULT_FRAME_TIMEOUT_MS }) {
  let buffer = Buffer.alloc(0);
  let timer = null;
  let closed = false;
  const fail = (error) => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    onError(error);
  };
  const armDeadline = () => {
    if (timer || buffer.length === 0) return;
    timer = setTimeout(() => fail(new Error("incomplete frame timed out")), frameTimeoutMs);
  };
  const clearDeadline = () => {
    if (buffer.length === 0 && timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return {
    push(chunk) {
      if (closed) return;
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > maxFrameBytes + 1 && buffer.indexOf(0x0a) === -1) {
        fail(new Error("frame exceeds byte limit"));
        return;
      }
      let newline;
      while ((newline = buffer.indexOf(0x0a)) !== -1) {
        const frame = buffer.subarray(0, newline);
        buffer = buffer.subarray(newline + 1);
        if (frame.length > maxFrameBytes) {
          fail(new Error("frame exceeds byte limit"));
          return;
        }
        if (frame.length === 0) continue;
        let line;
        try {
          line = new TextDecoder("utf-8", { fatal: true }).decode(frame);
        } catch {
          fail(new Error("frame contains invalid UTF-8"));
          return;
        }
        let value;
        try {
          value = JSON.parse(line);
        } catch {
          fail(new Error("frame contains invalid JSON"));
          return;
        }
        onFrame(value);
        if (closed) return;
      }
      if (buffer.length > maxFrameBytes) {
        fail(new Error("frame exceeds byte limit"));
        return;
      }
      clearDeadline();
      armDeadline();
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      buffer = Buffer.alloc(0);
    },
  };
}

function waitForFrame(socket, timeoutMs = DEFAULT_AUTH_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const parser = createFrameParser({
      onFrame(value) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      onError(error) {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
      frameTimeoutMs: timeoutMs,
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("authentication timed out"));
    }, timeoutMs);
    const onData = (chunk) => parser.push(chunk);
    const onError = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onClose = () => onError(new Error("connection closed during authentication"));
    const cleanup = () => {
      clearTimeout(timer);
      parser.close();
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

async function authenticateClient(socket, credentialPathOrValue, options = {}) {
  const credential = typeof credentialPathOrValue === "string" ? loadCredential(credentialPathOrValue) : credentialPathOrValue;
  const timeoutMs = options.timeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;
  const clientNonce = crypto.randomBytes(NONCE_BYTES).toString("base64");
  await writeFrame(socket, { type: "auth_hello", version: PROTOCOL_VERSION, clientId: credential.clientId, clientNonce });
  const challenge = await waitForFrame(socket, timeoutMs);
  if (challenge.type === "auth_error") throw new Error(challenge.message || "remote authentication rejected");
  if (challenge.type !== "auth_challenge") throw new Error("remote authentication protocol error");
  if (!verifyChallenge(credential, challenge)) throw new Error("remote server identity verification failed");
  const proof = signProof(credential, clientNonce, challenge.serverNonce);
  await writeFrame(socket, { type: "auth_proof", version: PROTOCOL_VERSION, clientId: credential.clientId, proof });
  const result = await waitForFrame(socket, timeoutMs);
  if (result.type !== "auth_ok" || result.clientId !== credential.clientId) throw new Error(result.message || "remote authentication failed");
  return { clientId: credential.clientId, label: credential.label };
}

function createServerAuthSession({ socket, stateDir, send = (value) => writeFrame(socket, value), timeoutMs = DEFAULT_AUTH_TIMEOUT_MS, onAuthenticated, onError }) {
  let state = "pending";
  let timer = setTimeout(() => fail(new Error("authentication timed out")), timeoutMs);
  let clientNonce;
  let serverNonce;
  let client;
  let host;
  const fail = (error) => {
    if (state === "authenticated" || state === "failed") return;
    state = "failed";
    clearTimeout(timer);
    onError(error);
  };
  const handle = async (message) => {
    if (state !== "pending") return false;
    try {
      if (message.type !== "auth_hello") throw new Error("authentication required before requests");
      if (message.version !== PROTOCOL_VERSION || typeof message.clientNonce !== "string" || Buffer.from(message.clientNonce, "base64").length !== NONCE_BYTES) throw new Error("invalid authentication hello");
      const registry = loadRegistry(stateDir);
      client = registry.clients.find((entry) => entry.id === message.clientId);
      if (!client) throw new Error("remote client is not authorized");
      host = loadHostIdentity(stateDir);
      clientNonce = message.clientNonce;
      serverNonce = crypto.randomBytes(NONCE_BYTES).toString("base64");
      const signature = signChallenge(host, client.id, clientNonce, serverNonce, client.publicKey);
      await send({ type: "auth_challenge", version: PROTOCOL_VERSION, clientId: client.id, clientNonce, serverNonce, hostPublicKey: host.publicKey, signature });
      state = "proof";
      return true;
    } catch (error) {
      fail(error);
      return false;
    }
  };
  const handleProof = async (message) => {
    if (state !== "proof") return false;
    try {
      if (message.type !== "auth_proof" || message.version !== PROTOCOL_VERSION || message.clientId !== client.id || typeof message.proof !== "string") throw new Error("invalid authentication proof");
      if (!verifyProof(client, host.publicKey, clientNonce, serverNonce, message.proof)) throw new Error("remote client proof verification failed");
      await onAuthenticated({ clientId: client.id, label: client.label });
      state = "authenticated";
      clearTimeout(timer);
      await send({ type: "auth_ok", version: PROTOCOL_VERSION, clientId: client.id, label: client.label });
      return true;
    } catch (error) {
      fail(error);
      return false;
    }
  };
  return {
    get authenticated() { return state === "authenticated"; },
    get failed() { return state === "failed"; },
    get principal() { return state === "authenticated" ? { clientId: client.id, label: client.label } : null; },
    handle(message) {
      if (state === "pending") return handle(message);
      if (state === "proof") return handleProof(message);
      return Promise.resolve(false);
    },
    close() {
      clearTimeout(timer);
      if (state !== "authenticated") state = "failed";
    },
  };
}

function isClientAuthorized(stateDir, clientId) {
  return loadRegistry(stateDir).clients.some((entry) => entry.id === clientId);
}

module.exports = {
  DEFAULT_AUTH_TIMEOUT_MS,
  DEFAULT_FRAME_TIMEOUT_MS,
  MAX_FRAME_BYTES,
  createSocketWriter,
  authenticateClient,
  createFrameParser,
  createServerAuthSession,
  isClientAuthorized,
  waitForFrame,
  writeFrame,
};
