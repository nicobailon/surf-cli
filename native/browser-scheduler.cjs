const { surfError } = require("./surf-error.cjs");

const DEFAULT_MAX_QUEUED = 64;
const DEFAULT_MAX_PER_LANE = 16;
const DEFAULT_QUEUE_TIMEOUT_MS = 60000;
const WRITE_SCOPES = new Set(["browser-write", "provider"]);

function normalizeResourceKeys(resourceKeys) {
  if (!Array.isArray(resourceKeys)) return [];
  return [...new Set(resourceKeys.filter((key) => typeof key === "string" && key).map(String))].sort();
}

class BrowserScheduler {
  constructor({
    maxQueued = DEFAULT_MAX_QUEUED,
    maxPerLane = DEFAULT_MAX_PER_LANE,
    queueTimeoutMs = DEFAULT_QUEUE_TIMEOUT_MS,
    audit = () => {},
  } = {}) {
    this.maxQueued = maxQueued;
    this.maxPerLane = maxPerLane;
    this.queueTimeoutMs = queueTimeoutMs;
    this.audit = audit;
    this.queue = [];
    this.activeTabs = new Map();
    this.activeReaders = new Set();
    this.activeWriter = null;
    this.activeResources = new Map();
    this.sequence = 0;
  }

  acquire({ scope, laneKey, resourceKeys = [], wait = true, signal, request, session } = {}) {
    const normalizedResources = normalizeResourceKeys(resourceKeys);
    if (scope === "host" && normalizedResources.length === 0) {
      return Promise.resolve(this.#token({
        scope,
        laneKey,
        resourceKeys: normalizedResources,
        request,
        session,
        queuedAt: Date.now(),
      }));
    }
    if (scope === "tab" && !laneKey) {
      return Promise.reject(surfError("target_required", "tab-scoped command requires a resolved tab"));
    }
    if (!scope || !["host", "tab", "browser-read", "browser-write", "provider"].includes(scope)) {
      return Promise.reject(surfError("scheduler_scope_invalid", `invalid browser scheduler scope: ${scope}`));
    }
    if (signal?.aborted) return Promise.reject(signal.reason || surfError("request_cancelled", "Request cancelled"));

    const entry = {
      id: ++this.sequence,
      scope,
      laneKey,
      resourceKeys: normalizedResources,
      wait,
      signal,
      request,
      session,
      queuedAt: Date.now(),
      resolve: null,
      reject: null,
      timer: null,
      abortCleanup: null,
    };

    if (this.#canGrantImmediately(entry)) {
      return Promise.resolve(this.#grant(entry));
    }
    if (!wait) {
      const blockedResources = this.#blockedResourceKeys(entry);
      if (blockedResources.length > 0) {
        return Promise.reject(surfError("resource_busy", `shared resource is busy: ${blockedResources.join(", ")}`, {
          laneKey,
          session,
          resourceKeys: blockedResources,
          retryable: true,
          queue: this.stats({ laneKey, resourceKeys: normalizedResources }),
          recoveryCommand: session ? `surf session.info ${session}` : "surf session.list --refresh",
        }));
      }
      const browserBlocked = Boolean(this.activeWriter) || this.#hasQueuedWriter() || WRITE_SCOPES.has(scope);
      const code = browserBlocked ? "browser_busy" : "tab_busy";
      const message = browserBlocked
        ? "a browser-wide writer is active or waiting"
        : `tab lane is busy: ${laneKey}`;
      return Promise.reject(surfError(code, message, {
        laneKey,
        session,
        retryable: true,
        queue: this.stats({ laneKey, resourceKeys: normalizedResources }),
        recoveryCommand: session ? `surf session.info ${session}` : "surf session.list --refresh",
      }));
    }
    if (this.queue.length >= this.maxQueued) {
      return Promise.reject(surfError("queue_full", "browser scheduler queue is full", { retryable: true }));
    }
    if (scope === "tab") {
      const laneDepth = this.queue.filter((queued) => queued.scope === "tab" && queued.laneKey === laneKey).length;
      if (laneDepth >= this.maxPerLane) {
        return Promise.reject(surfError("queue_full", `tab lane queue is full: ${laneKey}`, {
          laneKey,
          retryable: true,
        }));
      }
    }

    return new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
      entry.timer = setTimeout(() => {
        this.#removeQueued(entry);
        reject(surfError("queue_timeout", "timed out waiting for browser admission", {
          laneKey,
          session,
          resourceKeys: normalizedResources,
          retryable: true,
          queue: this.stats({ laneKey, resourceKeys: normalizedResources }),
          recoveryCommand: session ? `surf session.info ${session}` : "surf session.list --refresh",
        }));
        this.audit({
          event: "scheduler",
          outcome: "queue-timeout",
          request,
          scope,
          laneKey,
          resourceKeys: normalizedResources,
        });
        this.#drain();
      }, this.queueTimeoutMs);
      if (signal) {
        const onAbort = () => {
          if (!this.#removeQueued(entry)) return;
          reject(signal.reason || surfError("request_cancelled", "Request cancelled"));
          this.audit({
            event: "scheduler",
            outcome: "queue-cancel",
            request,
            scope,
            laneKey,
            resourceKeys: normalizedResources,
          });
          this.#drain();
        };
        signal.addEventListener("abort", onAbort, { once: true });
        entry.abortCleanup = () => signal.removeEventListener("abort", onAbort);
      }
      this.queue.push(entry);
      this.audit({
        event: "scheduler",
        outcome: "queued",
        request,
        scope,
        laneKey,
        resourceKeys: normalizedResources,
        queueDepth: this.queue.length,
      });
      this.#drain();
    });
  }

  stats({ laneKey, resourceKeys = [] } = {}) {
    const queuedByLane = {};
    for (const entry of this.queue) {
      if (entry.scope !== "tab") continue;
      queuedByLane[entry.laneKey] = (queuedByLane[entry.laneKey] || 0) + 1;
    }
    const writer = this.activeWriter
      ? {
          scope: this.activeWriter.scope,
          session: this.activeWriter.session || null,
          acquiredAt: this.activeWriter.acquiredAt,
        }
      : null;
    const queuedWriters = this.queue.filter((entry) => WRITE_SCOPES.has(entry.scope));
    const normalizedResources = normalizeResourceKeys(resourceKeys);
    const activeResources = [...this.activeResources.entries()].map(([key, token]) => ({
      key,
      scope: token.scope,
      laneKey: token.laneKey || null,
      session: token.session || null,
      acquiredAt: token.acquiredAt,
    }));
    return {
      activeTabLanes: [...this.activeTabs.entries()].map(([key, token]) => ({
        laneKey: key,
        session: token.session || null,
        acquiredAt: token.acquiredAt,
      })),
      activeReaders: this.activeReaders.size,
      writerActive: Boolean(writer),
      writer,
      activeResources,
      blockedResourceKeys: normalizedResources.filter((key) => this.activeResources.has(key)),
      queued: this.queue.length,
      queuedWriters: queuedWriters.length,
      queuedWriterSessions: queuedWriters.map((entry) => entry.session || null),
      queuedByLane,
      lane: laneKey ? {
        laneKey,
        active: this.activeTabs.has(laneKey),
        queued: queuedByLane[laneKey] || 0,
        blockedBy: this.activeWriter || queuedWriters.length > 0
          ? "browser-writer"
          : this.activeTabs.has(laneKey)
            ? "own-tab"
            : null,
      } : undefined,
    };
  }

  #blockedResourceKeys(entry) {
    return entry.resourceKeys.filter((key) => this.activeResources.has(key));
  }

  #hasQueuedWriter() {
    return this.queue.some((entry) => WRITE_SCOPES.has(entry.scope));
  }

  #canGrantImmediately(entry) {
    if (this.queue.length > 0) return false;
    if (this.#blockedResourceKeys(entry).length > 0) return false;
    if (entry.scope === "host") return true;
    if (WRITE_SCOPES.has(entry.scope)) {
      return !this.activeWriter && this.activeReaders.size === 0 && this.activeTabs.size === 0;
    }
    if (this.activeWriter || this.#hasQueuedWriter()) return false;
    if (entry.scope === "browser-read") return true;
    return !this.activeTabs.has(entry.laneKey);
  }

  #grant(entry) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.abortCleanup?.();
    const token = this.#token(entry);
    if (WRITE_SCOPES.has(entry.scope)) this.activeWriter = token;
    else if (entry.scope === "browser-read") this.activeReaders.add(token);
    else if (entry.scope === "tab") this.activeTabs.set(entry.laneKey, token);
    for (const key of entry.resourceKeys) this.activeResources.set(key, token);
    this.audit({
      event: "scheduler",
      outcome: "acquired",
      request: entry.request,
      scope: entry.scope,
      laneKey: entry.laneKey,
      resourceKeys: entry.resourceKeys,
      queueMs: Date.now() - entry.queuedAt,
    });
    return token;
  }

  #token(entry) {
    let released = false;
    const token = {
      scope: entry.scope,
      laneKey: entry.laneKey,
      resourceKeys: entry.resourceKeys,
      session: entry.session,
      queuedAt: entry.queuedAt,
      acquiredAt: Date.now(),
      release: () => {
        if (released) return;
        released = true;
        if (WRITE_SCOPES.has(entry.scope)) {
          if (this.activeWriter === token) this.activeWriter = null;
        } else if (entry.scope === "browser-read") this.activeReaders.delete(token);
        else if (entry.scope === "tab" && this.activeTabs.get(entry.laneKey) === token) {
          this.activeTabs.delete(entry.laneKey);
        }
        for (const key of entry.resourceKeys) {
          if (this.activeResources.get(key) === token) this.activeResources.delete(key);
        }
        this.audit({
          event: "scheduler",
          outcome: "released",
          request: entry.request,
          scope: entry.scope,
          laneKey: entry.laneKey,
          resourceKeys: entry.resourceKeys,
          session: entry.session,
        });
        this.#drain();
      },
    };
    return token;
  }

  #removeQueued(entry) {
    const index = this.queue.indexOf(entry);
    if (index === -1) return false;
    this.queue.splice(index, 1);
    if (entry.timer) clearTimeout(entry.timer);
    entry.abortCleanup?.();
    return true;
  }

  #drain() {
    for (let index = 0; index < this.queue.length;) {
      const entry = this.queue[index];
      if (entry.scope !== "host" || this.#blockedResourceKeys(entry).length > 0) {
        index += 1;
        continue;
      }
      this.queue.splice(index, 1);
      entry.resolve(this.#grant(entry));
    }

    if (this.activeWriter) return;
    const writerIndex = this.queue.findIndex((entry) => WRITE_SCOPES.has(entry.scope));
    if (writerIndex !== -1) {
      const writer = this.queue[writerIndex];
      if (
        this.activeReaders.size > 0 ||
        this.activeTabs.size > 0 ||
        this.#blockedResourceKeys(writer).length > 0
      ) return;
      this.queue.splice(writerIndex, 1);
      writer.resolve(this.#grant(writer));
      return;
    }

    for (let index = 0; index < this.queue.length;) {
      const entry = this.queue[index];
      if (this.#blockedResourceKeys(entry).length > 0) {
        index += 1;
        continue;
      }
      let grant = false;
      if (entry.scope === "browser-read") grant = true;
      else if (entry.scope === "tab") grant = !this.activeTabs.has(entry.laneKey);
      if (!grant) {
        index += 1;
        continue;
      }
      this.queue.splice(index, 1);
      entry.resolve(this.#grant(entry));
    }
  }
}

module.exports = {
  BrowserScheduler,
  DEFAULT_MAX_PER_LANE,
  DEFAULT_MAX_QUEUED,
  DEFAULT_QUEUE_TIMEOUT_MS,
  normalizeResourceKeys,
};
