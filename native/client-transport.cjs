const { connectEndpoint } = require("./endpoint.cjs");
const { createFrameParser, createSocketWriter } = require("./remote-transport.cjs");
const { createClientTransferController } = require("./file-transfer.cjs");

const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

async function openClientTransport(endpoint, { requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {}) {
  let socket;
  let ready;
  let readyReject;
  let readyErrorListener;
  ready = new Promise((resolve, reject) => {
    readyReject = reject;
    readyErrorListener = (error) => reject(error);
    socket = connectEndpoint(endpoint, () => {
      socket.removeListener("error", readyErrorListener);
      resolve();
    });
    socket.once("error", readyErrorListener);
  });
  await ready;
  const pending = new Map();
  const writer = createSocketWriter(socket, { onOverflow: ({ error }) => socket.destroy(error) });
  const transfers = endpoint.kind === "remote"
    ? createClientTransferController({ writer, onActivity: () => {} })
    : null;
  let transferChain = Promise.resolve();
  let transferCleanupPromise = null;
  const cleanupTransfers = (error) => {
    if (!transfers) return Promise.resolve();
    transferCleanupPromise ||= transfers.cleanup(error);
    return transferCleanupPromise;
  };
  const rejectPending = (error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };
  const parser = createFrameParser({
    onFrame(message) {
      if (transfers && message.type && message.type.startsWith("transfer_")) {
        transferChain = transferChain.then(() => transfers.handle(message)).catch((error) => {
          rejectPending(error);
          return writer.send({ type: "transfer_error", version: 1, transferId: message.transferId, error: error.message }).finally(() => socket.destroy(error)).then(() => { throw error; });
        });
        transferChain.catch(() => undefined);
        return;
      }
      if (message.type === "extension_disconnected") {
        transferChain = transferChain.then(() => {
          const error = new Error(message.message || "Surf extension disconnected");
          rejectPending(error);
          socket.end();
        });
        transferChain.catch(() => undefined);
        return;
      }
      if (message.id === undefined || !pending.has(message.id)) return;
      transferChain = transferChain.then(() => {
        const entry = pending.get(message.id);
        if (!entry) return;
        pending.delete(message.id);
        clearTimeout(entry.timer);
        entry.resolve(message);
      }).catch((error) => {
        rejectPending(error);
        socket.destroy(error);
      });
      transferChain.catch(() => undefined);
    },
    onError(error) {
      rejectPending(error);
      readyReject?.(error);
      socket.destroy();
    },
  });
  socket.on("data", (chunk) => parser.push(chunk));
  let closed = false;
  socket.on("close", () => {
    parser.close();
    const error = new Error("connection closed");
    rejectPending(error);
    writer.close(error);
    cleanupTransfers(error);
    closed = true;
  });
  return {
    socket,
    transfers,
    async request(message, timeoutMs = requestTimeoutMs, transferPlan = {}) {
      if (closed) throw new Error("client transport is closed");
      if (message.id === undefined || message.id === null) throw new Error("request id is required");
      if (pending.has(message.id)) throw new Error("duplicate request id");
      const downloadIds = (transferPlan.downloads || []).map((download) => download.transferId);
      const timeoutError = new Error("request timed out");
      let rejectTimeout;
      const timeout = new Promise((_, reject) => { rejectTimeout = reject; });
      timeout.catch(() => undefined);
      const timer = setTimeout(() => {
        closed = true;
        rejectPending(timeoutError);
        cleanupTransfers(timeoutError).catch(() => {});
        writer.close(timeoutError);
        socket.destroy();
        rejectTimeout(timeoutError);
      }, timeoutMs);
      const execute = async () => {
        try {
          if (transfers) {
            for (const download of transferPlan.downloads || []) await transfers.expectDownload(download);
            const uploadDescriptors = [];
            for (const upload of transferPlan.uploads || []) {
              const result = await transfers.upload(upload.path, upload);
              uploadDescriptors.push({ transferId: result.transferId, field: upload.field, original: upload.original, kind: "upload" });
            }
            message = { ...message, _surfTransfers: { uploads: uploadDescriptors, downloads: (transferPlan.downloads || []).map(({ transferId, field, original }) => ({ transferId, field, original, kind: "download" })) }, _surfPaths: transferPlan.pathRefs || [] };
          }
          const response = new Promise((resolve, reject) => {
            pending.set(message.id, { resolve, reject, timer });
          });
          response.catch(() => undefined);
          try {
            await writer.send(message);
          } catch (error) {
            const entry = pending.get(message.id);
            if (entry) { pending.delete(message.id); clearTimeout(entry.timer); entry.reject(error); }
            await transfers?.cancelDownloads(downloadIds);
            await response.catch(() => undefined);
            throw error;
          }
          const result = await response;
          if (result.error || (transfers && downloadIds.some((id) => transfers.hasDownload(id)))) {
            await transfers?.cancelDownloads(downloadIds);
            if (!result.error) throw new Error("request completed without completing output download");
          }
          return result;
        } catch (error) {
          await transfers?.cancelDownloads(downloadIds);
          throw error;
        }
      };
      try {
        return await Promise.race([execute(), timeout]);
      } finally {
        clearTimeout(timer);
      }
    },
    async closeAsync() {
      if (closed) return transferCleanupPromise;
      closed = true;
      const error = new Error("client transport is closed");
      parser.close();
      rejectPending(error);
      writer.close(error);
      const cleanup = cleanupTransfers(error);
      socket.end();
      await cleanup;
      return cleanup;
    },
    close() {
      return this.closeAsync();
    },
  };
}

module.exports = { DEFAULT_REQUEST_TIMEOUT_MS, openClientTransport };
