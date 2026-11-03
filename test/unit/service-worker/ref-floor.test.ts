import { expect, it, vi } from "vitest";
import { createChromeMock } from "../../mocks/chrome";

vi.mock("../../../src/native/port-manager", () => ({
  initNativeMessaging: vi.fn(),
  postToNativeHost: vi.fn(),
}));

// Each call loads a fresh service worker over the same session storage, like a worker restart.
async function startServiceWorker(session: Record<string, unknown>) {
  vi.resetModules();
  const chrome = createChromeMock();
  (globalThis as any).chrome = chrome;
  chrome.storage.session.get.mockImplementation(async (key: string) => ({ [key]: session[key] }));
  chrome.storage.session.set.mockImplementation(async (items: Record<string, unknown>) => {
    Object.assign(session, structuredClone(items));
  });
  const { handleMessage } = await import("../../../src/service-worker/index");
  return (message: Record<string, unknown>) =>
    handleMessage(message, { id: chrome.runtime.id, tab: { id: 7 } as chrome.tabs.Tab });
}

it("starts a page's refs above every ref the tab issued, across a service-worker restart", async () => {
  const session: Record<string, unknown> = {};
  const first = await startServiceWorker(session);
  expect(await first({ type: "REF_FLOOR" })).toEqual({ floor: 0 });
  await first({ type: "REF_HIGH", high: 12 });

  const restarted = await startServiceWorker(session);
  expect(await restarted({ type: "REF_FLOOR" })).toEqual({ floor: 12 });
});
