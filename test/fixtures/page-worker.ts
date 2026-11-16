const { resolveObjectURL } = require("node:buffer");
const { Worker: NodeWorker } = require("node:worker_threads");

type NodeWorker = {
  on: (event: string, listener: (value: never) => void) => void;
  postMessage: (data: unknown) => void;
  terminate: () => Promise<number>;
};

/**
 * A browser Worker for page scripts run in Node: built from a blob: URL, with onmessage, onerror,
 * postMessage and terminate(), on a real thread, so terminate() stops a regex that never ends.
 */
export class PageWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  #ready: Promise<NodeWorker>;

  constructor(url: string) {
    const blob = resolveObjectURL(url);
    if (!blob) {
      throw new Error(`no blob at ${url}`);
    }
    this.#ready = blob.text().then((source: string) => {
      const worker: NodeWorker = new NodeWorker(
        `const { parentPort } = require("node:worker_threads");
globalThis.postMessage = (data) => parentPort.postMessage(data);
parentPort.on("message", (data) => globalThis.onmessage({ data }));
${source}`,
        { eval: true },
      );
      worker.on("message", (data: unknown) => this.onmessage?.({ data }));
      worker.on("error", (error: Error) => this.onerror?.({ message: error.message }));
      return worker;
    });
  }

  postMessage(data: unknown) {
    this.#ready = this.#ready.then((worker) => {
      worker.postMessage(data);
      return worker;
    });
  }

  // A worker terminated before it started is terminated once it does.
  terminate() {
    this.#ready = this.#ready.then((worker) => {
      worker.terminate();
      return worker;
    });
  }
}
