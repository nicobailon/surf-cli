class RequestAbortError extends Error {
  constructor(message = "Request cancelled") {
    super(message);
    this.name = "RequestAbortError";
    this.code = "SURF_REQUEST_ABORTED";
  }
}

function abortError(signal, fallback = "Request cancelled") {
  if (signal?.reason instanceof Error && signal.reason.name !== "AbortError") return signal.reason;
  return new RequestAbortError(fallback);
}

function throwIfAborted(signal, fallback) {
  if (signal?.aborted) throw abortError(signal, fallback);
}

function raceAbort(promiseOrFactory, signal, fallback) {
  if (!signal) return typeof promiseOrFactory === "function" ? promiseOrFactory() : promiseOrFactory;
  throwIfAborted(signal, fallback);
  const promise = typeof promiseOrFactory === "function" ? promiseOrFactory() : promiseOrFactory;
  if (signal.aborted) return Promise.reject(abortError(signal, fallback));
  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      reject(abortError(signal, fallback));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function abortableDelay(ms, signal, fallback) {
  throwIfAborted(signal, fallback);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(abortError(signal, fallback));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

module.exports = { RequestAbortError, abortError, abortableDelay, raceAbort, throwIfAborted };
