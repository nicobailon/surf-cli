import { describe, expect, it } from "vitest";

const never = () =>
  new Promise<never>(() => {
    // Deliberately unresolved until the request signal aborts.
  });
const chatgpt = require("../../native/chatgpt-client.cjs");
const gemini = require("../../native/gemini-client.cjs");
const perplexity = require("../../native/perplexity-client.cjs");
const grok = require("../../native/grok-client.cjs");
const aistudio = require("../../native/aistudio-client.cjs");
const aistudioBuild = require("../../native/aistudio-build.cjs");
const https = require("node:https");
const geminiHttp = require("../../native/gemini-client.cjs");

function abortAfterCreate() {
  const controller = new AbortController();
  let created = false;
  let closed = 0;
  const createTab = async () => {
    created = true;
    setTimeout(() => controller.abort(), 5);
    return { tabId: 42 };
  };
  const closeTab = async () => {
    closed += 1;
  };
  return { controller, createTab, closeTab, wasCreated: () => created, closed: () => closed };
}

function attachFake(promise: Promise<unknown>, fake: ReturnType<typeof abortAfterCreate>) {
  Object.assign(promise, { fake });
  return promise as Promise<unknown> & { fake: ReturnType<typeof abortAfterCreate> };
}

const googleCookies = {
  cookies: [
    { name: "__Secure-1PSID", value: "sid" },
    { name: "__Secure-1PSIDTS", value: "ts" },
  ],
};

describe("provider request cancellation", () => {
  it.each([
    [
      "ChatGPT",
      () => {
        const fake = abortAfterCreate();
        return attachFake(
          chatgpt.query({
            prompt: "query",
            getCookies: async () => ({
              cookies: [{ name: "__Secure-next-auth.session-token", value: "token" }],
            }),
            createTab: fake.createTab,
            closeTab: fake.closeTab,
            cdpEvaluate: never,
            cdpCommand: never,
            signal: fake.controller.signal,
          }),
          fake,
        );
      },
    ],
    [
      "Perplexity",
      () => {
        const fake = abortAfterCreate();
        return attachFake(
          perplexity.query({
            prompt: "query",
            createTab: fake.createTab,
            closeTab: fake.closeTab,
            cdpEvaluate: never,
            cdpCommand: never,
            signal: fake.controller.signal,
          }),
          fake,
        );
      },
    ],
    [
      "Grok",
      () => {
        const fake = abortAfterCreate();
        return attachFake(
          grok.query({
            prompt: "query",
            getCookies: async () => ({ cookies: [{ name: "auth_token", value: "token" }] }),
            createTab: fake.createTab,
            closeTab: fake.closeTab,
            cdpEvaluate: never,
            cdpCommand: never,
            signal: fake.controller.signal,
          }),
          fake,
        );
      },
    ],
    [
      "AI Studio",
      () => {
        const fake = abortAfterCreate();
        return attachFake(
          aistudio.query({
            prompt: "query",
            getCookies: async () => googleCookies,
            createTab: fake.createTab,
            closeTab: fake.closeTab,
            cdpEvaluate: never,
            cdpCommand: never,
            signal: fake.controller.signal,
          }),
          fake,
        );
      },
    ],
    [
      "AI Studio Build",
      () => {
        const fake = abortAfterCreate();
        return attachFake(
          aistudioBuild.build({
            prompt: "query",
            getCookies: async () => googleCookies,
            createTab: fake.createTab,
            closeTab: fake.closeTab,
            cdpEvaluate: never,
            cdpCommand: never,
            searchDownloads: never,
            signal: fake.controller.signal,
          }),
          fake,
        );
      },
    ],
  ])("aborts %s and closes its owned tab", async (_name, run) => {
    const runPromise = run();
    await expect(runPromise).rejects.toMatchObject({ code: "SURF_REQUEST_ABORTED" });
    expect(runPromise.fake.wasCreated()).toBe(true);
    expect(runPromise.fake.closed()).toBeGreaterThan(0);
  });

  it("aborts Grok validation and closes its tab", async () => {
    const fake = abortAfterCreate();
    await expect(
      grok.validate({
        getCookies: async () => ({ cookies: [{ name: "auth_token", value: "token" }] }),
        createTab: fake.createTab,
        closeTab: fake.closeTab,
        cdpEvaluate: never,
        signal: fake.controller.signal,
        log: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "SURF_REQUEST_ABORTED" });
    expect(fake.closed()).toBeGreaterThan(0);
  });

  it("destroys an active Gemini HTTPS request on abort", async () => {
    const controller = new AbortController();
    let destroyed = false;
    const listeners = new Map<string, (error?: Error) => void>();
    const originalRequest = https.request;
    https.request = (_options: unknown, _callback: unknown) => ({
      on(event: string, listener: (error?: Error) => void) {
        listeners.set(event, listener);
        return this;
      },
      end() {
        return undefined;
      },
      destroy(error: Error) {
        destroyed = true;
        listeners.get("error")?.(error);
      },
    });
    try {
      const pending = geminiHttp.httpsGet(
        "https://example.test/",
        {},
        { signal: controller.signal },
      );
      controller.abort();
      await expect(pending).rejects.toMatchObject({ code: "SURF_REQUEST_ABORTED" });
      expect(destroyed).toBe(true);
    } finally {
      https.request = originalRequest;
    }
  });

  it("aborts Gemini in-page work from its first JavaScript callback", async () => {
    const controller = new AbortController();
    let closed = 0;
    const createTab = async () => ({ tabId: 42 });
    const closeTab = async () => {
      closed += 1;
    };
    const jsEval = async () => {
      controller.abort();
      return JSON.stringify({ ok: true });
    };
    await expect(
      gemini.query({
        prompt: "query",
        editImage: "input.png",
        getCookies: async () => googleCookies,
        createTab,
        closeTab,
        jsEval,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "SURF_REQUEST_ABORTED" });
    expect(closed).toBeGreaterThan(0);
  }, 20000);
});
