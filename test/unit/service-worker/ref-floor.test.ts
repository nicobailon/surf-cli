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
  return (message: Record<string, unknown>, frameId = 0, url = "https://a.test/") =>
    handleMessage(message, {
      id: chrome.runtime.id,
      tab: { id: 7 } as chrome.tabs.Tab,
      frameId,
      url,
    });
}

it("starts a page's refs above every ref the tab issued and names this frame's earlier pages, across a restart", async () => {
  const session: Record<string, unknown> = {};
  const first = await startServiceWorker(session);
  expect(await first({ type: "REF_FLOOR" })).toEqual({ floor: 0, pages: [] });
  await first({ type: "REF_HIGH", high: 12 });
  await first({ type: "REF_FLOOR" }, 3, "https://frame.test/");

  const restarted = await startServiceWorker(session);
  expect(await restarted({ type: "REF_FLOOR" }, 0, "https://b.test/")).toEqual({
    floor: 12,
    pages: [{ frameId: 0, from: 0, url: "https://a.test/" }],
  });
});
