const { abortError } = require("./abort.cjs");

class RequestPendingMap extends Map {
  constructor({ getRequest = () => undefined } = {}) {
    super();
    this.getRequest = getRequest;
    this.drainWaiters = new Map();
  }

  set(id, data) {
    const request = data.request || this.getRequest();
    const cleanup = Boolean(data.cleanup || data.tool === "close_tab");
    const entry = { ...data, id, request, cleanup, aborted: false, settled: false };
    if (request) {
      if (!request.pendingEntries) request.pendingEntries = new Set();
      request.pendingEntries.add(entry);
      if (cleanup) entry.abortCleanup = null;
      else {
        const onAbort = () => {
          if (entry.abortNotified || entry.settled) return;
          entry.abortNotified = true;
          entry.aborted = true;
          const error = abortError(request.signal);
          if (entry.reject) entry.reject(error);
          else entry.onAbort?.(error);
          if (!entry.reject && !entry.onAbort) entry.onComplete?.({ error: error.message, cancelled: true });
        };
        entry.abortCleanup = () => request.signal.removeEventListener("abort", onAbort);
        request.signal.addEventListener("abort", onAbort, { once: true });
        if (request.signal.aborted) onAbort();
      }
    }
    super.set(id, entry);
    return this;
  }

  get(id) {
    return super.get(id);
  }

  delete(id) {
    const entry = super.get(id);
    if (!entry) return false;
    this.#removeEntry(entry);
    return true;
  }

  #removeEntry(entry, notify = true) {
    super.delete(entry.id);
    entry.abortCleanup?.();
    if (entry.tombstoneTimer) clearTimeout(entry.tombstoneTimer);
    entry.request?.pendingEntries?.delete(entry);
    if (notify) this.#notifyDrain(entry.request);
  }

  #notifyDrain(request) {
    if (!request || request.pendingEntries?.size) return;
    const waiters = this.drainWaiters.get(request);
    if (!waiters) return;
    this.drainWaiters.delete(request);
    for (const waiter of waiters) waiter();
  }

  onDrain(request, callback) {
    if (!request?.pendingEntries?.size) {
      callback();
      return;
    }
    const waiters = this.drainWaiters.get(request) || [];
    waiters.push(callback);
    this.drainWaiters.set(request, waiters);
  }

  resolve(id, value) {
    const entry = this.get(id);
    if (!entry) return false;
    this.#removeEntry(entry, false);
    try {
      if (!entry.aborted && !entry.hardBoundary && !entry.settled) {
        entry.settled = true;
        if (entry.resolve) entry.resolve(value);
        else if (entry.onComplete) entry.onComplete(value);
      }
    } finally {
      this.#notifyDrain(entry.request);
    }
    return true;
  }

  expire(id, error) {
    const entry = this.get(id);
    if (!entry) return false;
    if (!entry.settled) {
      entry.settled = true;
      entry.aborted = true;
      entry.reject?.(error);
      const request = entry.request;
      const remaining = request ? Math.max(0, request.startedAt + request.deadlineMs - Date.now()) : 0;
      entry.tombstoneTimer = setTimeout(() => this.delete(entry.id), remaining);
    }
    return true;
  }

  reject(id, error) {
    const entry = this.get(id);
    if (!entry) return false;
    this.#removeEntry(entry, false);
    try {
      if (!entry.settled) {
        entry.settled = true;
        entry.reject?.(error);
      }
    } finally {
      this.#notifyDrain(entry.request);
    }
    return true;
  }

  tombstoneAfterAbort(request) {
    if (!request?.pendingEntries) return;
    for (const entry of request.pendingEntries) {
      if (entry.cleanup || entry.tombstoneTimer) continue;
      const remaining = Math.max(0, request.startedAt + request.deadlineMs - Date.now());
      entry.tombstoneTimer = setTimeout(() => this.delete(entry.id), remaining);
    }
  }

  hardDeadline(request) {
    if (!request) return;
    request.hardBoundary = true;
    for (const entry of [...(request.pendingEntries || [])]) {
      entry.hardBoundary = true;
      this.#removeEntry(entry);
      if (!entry.settled) {
        entry.settled = true;
        entry.reject?.(abortError(request.signal, "Request timed out"));
      }
    }
  }

  clear() {
    for (const entry of this.values()) this.#removeEntry(entry);
    this.drainWaiters.clear();
    super.clear();
  }
}

module.exports = { RequestPendingMap };
