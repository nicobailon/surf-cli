const { abortError } = require("./abort.cjs");

const MAX_CONNECTIONS = 32;
const MAX_REMOTE_CONNECTIONS = 16;
const MAX_PRINCIPAL_CONNECTIONS = 4;
const MAX_WAITERS = 16;
const MAX_STREAMS_PER_PRINCIPAL = 2;
const MAX_REMOTE_STREAMS = 4;
const MAX_STREAMS = 4;
const REQUEST_ID_LIMIT = 128;
const TOOL_NAME_LIMIT = 128;
const LEASE_IDLE_MS = 5000;
const AUTHENTICATED_IDLE_MS = 15000;
const QUEUE_TIMEOUT_MS = 60000;
const DEFAULT_DEADLINE_MS = 60000;
const MAX_DEADLINE_MS = 50 * 60 * 1000;
const CLEANUP_GRACE_MS = 60000;
const PROVIDER_DEFAULT_TIMEOUT_SECONDS = {
  ai: 300,
  aistudio: 300,
  "aistudio.build": 600,
  chatgpt: 2700,
  gemini: 300,
  grok: 300,
  perplexity: 120,
  "playbook.run": 600,
};

function resolveRequestDeadlineMs(tool, args = {}) {
  const defaultSeconds = PROVIDER_DEFAULT_TIMEOUT_SECONDS[tool];
  if (defaultSeconds === undefined) return DEFAULT_DEADLINE_MS;
  const rawTimeout = tool === "playbook.run" && args && typeof args === "object" && !Array.isArray(args)
    ? args.timeout ?? args.args?.timeout
    : args?.timeout;
  const requestedSeconds = Number(
    rawTimeout,
  );
  const seconds = Number.isFinite(requestedSeconds) && requestedSeconds > 0
    ? requestedSeconds
    : defaultSeconds;
  return Math.min(seconds * 1000 + CLEANUP_GRACE_MS, MAX_DEADLINE_MS);
}

class HostSessionManager {
  constructor({ audit = () => {}, onTimeout = () => {} } = {}) {
    this.audit = audit;
    this.onTimeout = onTimeout;
    this.contexts = new Set();
    this.principalCounts = new Map();
    this.waiters = [];
    this.leaseOwner = null;
    this.remoteConnections = 0;
    this.streams = new Set();
  }

  admit(socket, isRemote) {
    if (this.contexts.size >= MAX_CONNECTIONS) throw new Error("maximum client connections reached");
    if (isRemote && this.remoteConnections >= MAX_REMOTE_CONNECTIONS) throw new Error("maximum remote connections reached");
    const context = {
      socket,
      isRemote,
      principal: null,
      closed: false,
      activeRequest: null,
      seenRequestIds: new Set(),
      idleTimer: null,
      workTimer: null,
      admitted: true,
      stream: false,
    };
    this.contexts.add(context);
    if (isRemote) this.remoteConnections += 1;
    this.audit({ event: "connection", context, outcome: "accepted" });
    return context;
  }

  authenticate(context, principal) {
    if (context.closed) throw new Error("connection is closed");
    const count = this.principalCounts.get(principal.clientId) || 0;
    if (count >= MAX_PRINCIPAL_CONNECTIONS) throw new Error("maximum connections for remote principal reached");
    context.principal = principal;
    this.principalCounts.set(principal.clientId, count + 1);
    context.workTimer = setTimeout(() => {
      if (!context.closed && !context.activeRequest) {
        this.audit({ event: "connection", context, outcome: "authenticated-idle-timeout" });
        context.socket.destroy();
      }
    }, AUTHENTICATED_IDLE_MS);
    this.audit({ event: "authentication", context, outcome: "success" });
  }

  touch(context) {
    if (!context || context.closed || !context.isRemote || context.activeRequest) return;
    if (context.workTimer) clearTimeout(context.workTimer);
    context.workTimer = setTimeout(() => {
      if (!context.closed && !context.activeRequest) {
        this.audit({ event: "connection", context, outcome: "authenticated-idle-timeout" });
        context.socket.destroy();
      }
    }, AUTHENTICATED_IDLE_MS);
  }

  canStartStream(context) {
    if (context.closed || context.stream || context.activeRequest || this.leaseOwner === context) return false;
    const principalId = context.principal?.clientId || "local";
    const principalStreams = [...this.streams].filter((entry) => entry.principalId === principalId).length;
    if (principalStreams >= MAX_STREAMS_PER_PRINCIPAL) return false;
    if (this.streams.size >= MAX_STREAMS) return false;
    if (context.isRemote && [...this.streams].filter((entry) => entry.isRemote).length >= MAX_REMOTE_STREAMS) return false;
    if (context.workTimer) {
      clearTimeout(context.workTimer);
      context.workTimer = null;
    }
    context.stream = true;
    this.streams.add({ context, principalId, isRemote: context.isRemote });
    return true;
  }

  stopStream(context) {
    for (const entry of this.streams) if (entry.context === context) this.streams.delete(entry);
    context.stream = false;
  }

  beginRequest(context, { id, tool, deadlineMs }) {
    if (context.closed) return Promise.reject(new Error("connection is closed"));
    if (context.workTimer) {
      clearTimeout(context.workTimer);
      context.workTimer = null;
    }
    if (context.stream) return Promise.reject(new Error("stream connection cannot execute tools"));
    if (typeof id !== "string" || !id) return Promise.reject(new Error("request id is required"));
    if (id.length > REQUEST_ID_LIMIT) return Promise.reject(new Error("request ID is too long"));
    if (typeof tool !== "string" || !tool) return Promise.reject(new Error("tool name is required"));
    if (tool.length > TOOL_NAME_LIMIT) return Promise.reject(new Error("tool name is too long"));
    if (context.seenRequestIds.has(id)) return Promise.reject(new Error("duplicate request id"));
    if (context.seenRequestIds.size >= REQUEST_ID_LIMIT) return Promise.reject(new Error("request ID limit reached"));
    if (context.activeRequest) return Promise.reject(new Error("one in-flight request per connection"));
    context.seenRequestIds.add(id);
    const controller = new AbortController();
    const request = {
      id,
      tool,
      startedAt: Date.now(),
      deadlineMs: Math.min(Math.max(deadlineMs || DEFAULT_DEADLINE_MS, 1), MAX_DEADLINE_MS),
      queued: true,
      settled: false,
      controller,
      signal: controller.signal,
      tombstoned: false,
    };
    context.activeRequest = request;
    const grant = () => {
      if (context.closed) return Promise.reject(new Error("connection closed while waiting for browser lease"));
      request.queued = false;
      request.timer = setTimeout(() => this.onRequestTimeout(context, request), request.deadlineMs);
      this.leaseOwner = context;
      this.audit({ event: "lease", context, request, outcome: "acquired" });
      return Promise.resolve(request);
    };
    if (!this.leaseOwner || this.leaseOwner === context) {
      if (context.idleTimer) clearTimeout(context.idleTimer);
      context.idleTimer = null;
      return grant();
    }
    if (this.waiters.length >= MAX_WAITERS) {
      context.activeRequest = null;
      return Promise.reject(new Error("browser lease queue is full"));
    }
    return new Promise((resolve, reject) => {
      const waiter = { context, request, resolve, reject };
      waiter.timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index !== -1) this.waiters.splice(index, 1);
        if (context.activeRequest === request) context.activeRequest = null;
        this.audit({ event: "lease", context, request, outcome: "queue-timeout" });
        reject(new Error("timed out waiting for browser lease"));
      }, QUEUE_TIMEOUT_MS);
      this.waiters.push(waiter);
      this.audit({ event: "lease", context, request, outcome: "queued" });
    }).then(() => grant());
  }

  onRequestTimeout(context, request) {
    if (context.activeRequest !== request || request.settled) return;
    request.tombstoned = true;
    if (!request.signal.aborted) request.controller.abort(abortError(null, "Request timed out"));
    this.audit({ event: "request", context, request, outcome: "hard-timeout" });
    this.onTimeout(context, request);
  }

  canRespond(context, id) {
    return Boolean(context && context.activeRequest && context.activeRequest.id === id && !context.activeRequest.settled);
  }

  complete(context, id, outcome = "completed") {
    const request = context?.activeRequest;
    if (!request || request.id !== id || request.settled) return;
    request.settled = true;
    if (request.timer) clearTimeout(request.timer);
    if (request.abortCleanup) request.abortCleanup();
    context.activeRequest = null;
    this.audit({ event: "request", context, request, outcome, elapsedMs: Date.now() - request.startedAt });
    if (this.leaseOwner === context) {
      if (context.closed) this.releaseLease(context);
      else {
        if (context.idleTimer) clearTimeout(context.idleTimer);
        context.idleTimer = setTimeout(() => {
          if (!context.activeRequest && this.leaseOwner === context) this.releaseLease(context);
        }, LEASE_IDLE_MS);
      }
    }
  }

  releaseLease(context) {
    if (this.leaseOwner !== context) return;
    if (context.idleTimer) clearTimeout(context.idleTimer);
    context.idleTimer = null;
    this.leaseOwner = null;
    this.audit({ event: "lease", context, outcome: "released" });
    while (this.waiters.length) {
      const waiter = this.waiters.shift();
      if (!waiter || waiter.context.closed) continue;
      clearTimeout(waiter.timer);
      this.leaseOwner = waiter.context;
      waiter.resolve();
      return;
    }
  }

  close(context) {
    if (!context || context.closed) return;
    context.closed = true;
    if (context.workTimer) clearTimeout(context.workTimer);
    context.workTimer = null;
    this.stopStream(context);
    if (context.principal) {
      const count = this.principalCounts.get(context.principal.clientId) || 1;
      if (count <= 1) this.principalCounts.delete(context.principal.clientId);
      else this.principalCounts.set(context.principal.clientId, count - 1);
    }
    for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.waiters[index];
      if (waiter.context !== context) continue;
      this.waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.reject(new Error("connection closed while waiting for browser lease"));
    }
    if (context.activeRequest?.queued) {
      const request = context.activeRequest;
      context.activeRequest = null;
      if (!request.signal.aborted) request.controller.abort(abortError(null, "Request cancelled: queued client disconnected"));
      this.audit({ event: "request", context, request, outcome: "queue-canceled" });
    } else if (context.activeRequest) {
      const request = context.activeRequest;
      request.abandoned = true;
      request.tombstoned = true;
      if (!request.signal.aborted) request.controller.abort(abortError(null, "Request cancelled: client disconnected"));
      this.audit({ event: "request", context, request, outcome: "abort-requested" });
      this.audit({ event: "request", context, request, outcome: "abandoned" });
    } else if (this.leaseOwner === context) {
      this.releaseLease(context);
    }
    this.contexts.delete(context);
    if (context.isRemote) this.remoteConnections -= 1;
    this.audit({ event: "connection", context, outcome: "closed" });
  }
}

module.exports = {
  AUTHENTICATED_IDLE_MS,
  DEFAULT_DEADLINE_MS,
  HostSessionManager,
  MAX_DEADLINE_MS,
  PROVIDER_DEFAULT_TIMEOUT_SECONDS,
  resolveRequestDeadlineMs,
  LEASE_IDLE_MS,
  MAX_CONNECTIONS,
  MAX_PRINCIPAL_CONNECTIONS,
  MAX_REMOTE_CONNECTIONS,
  MAX_REMOTE_STREAMS,
  MAX_STREAMS,
  MAX_STREAMS_PER_PRINCIPAL,
  TOOL_NAME_LIMIT,
  MAX_WAITERS,
  QUEUE_TIMEOUT_MS,
  REQUEST_ID_LIMIT,
};
