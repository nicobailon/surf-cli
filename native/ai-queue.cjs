const { abortError } = require("./abort.cjs");

class BoundedAiQueue {
  constructor({ maxQueued = 8, spacingMs = 2000, audit = () => {}, run = (handler) => handler() } = {}) {
    this.maxQueued = maxQueued;
    this.spacingMs = spacingMs;
    this.audit = audit;
    this.run = run;
    this.items = [];
    this.active = false;
  }

  enqueue(handler, request) {
    return new Promise((resolve, reject) => {
      if (request?.signal.aborted) {
        reject(abortError(request.signal));
        return;
      }
      if (this.items.length >= this.maxQueued) {
        reject(new Error("AI request queue is full"));
        return;
      }
      const item = { handler, request, resolve, reject, abortCleanup: null };
      const onAbort = () => {
        const index = this.items.indexOf(item);
        if (index === -1) return;
        this.items.splice(index, 1);
        item.abortCleanup = null;
        reject(abortError(request.signal));
        this.audit({ event: "request", context: request.context, request, outcome: "queued-cancel" });
      };
      if (request?.signal) {
        request.signal.addEventListener("abort", onAbort, { once: true });
        item.abortCleanup = () => request.signal.removeEventListener("abort", onAbort);
      }
      this.items.push(item);
      this.#process();
    });
  }

  get queued() {
    return this.items.length;
  }

  async #process() {
    if (this.active || this.items.length === 0) return;
    this.active = true;
    const item = this.items.shift();
    item.abortCleanup?.();
    try {
      if (item.request?.signal.aborted) throw abortError(item.request.signal);
      const result = await this.run(item.handler, item.request);
      if (item.request?.signal.aborted) throw abortError(item.request.signal);
      item.resolve(result);
    } catch (error) {
      item.reject(error);
    } finally {
      this.active = false;
      setTimeout(() => this.#process(), this.spacingMs);
    }
  }
}

module.exports = { BoundedAiQueue };
