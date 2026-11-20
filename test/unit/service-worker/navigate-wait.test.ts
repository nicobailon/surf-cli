import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeMock } from "../../mocks/chrome";

const nativeState = vi.hoisted(() => ({ initNativeMessaging: vi.fn(), postToNativeHost: vi.fn() }));

vi.mock("../../../src/native/port-manager", () => nativeState);

type Dispatch = (message: Record<string, unknown>) => Promise<any>;
type Listener = (details: Record<string, unknown>) => void;

const BLOCKED_PAGE =
  "chrome-extension://otherextensionid/blocked.html#https://httpbin.org/anything/blocked";

// Calls every listener the worker added for the event.
const listenersOf =
  (event: { addListener: { mock: { calls: unknown[][] } } }) =>
  (...args: unknown[]) => {
    for (const [listener] of event.addListener.mock.calls) {
      (listener as (...a: unknown[]) => void)(...args);
    }
  };

async function loadDispatcher() {
  vi.resetModules();
  nativeState.initNativeMessaging.mockReset();
  const chrome = createChromeMock();
  (globalThis as any).chrome = chrome;
  chrome.tabs.get.mockImplementation(async (tabId: number) => ({ id: tabId, windowId: 1 }));
  await import("../../../src/service-worker/index");
  const dispatch = nativeState.initNativeMessaging.mock.calls[0][0] as Dispatch;
  const fire = {
    committed: listenersOf(chrome.webNavigation.onCommitted) as Listener,
    completed: listenersOf(chrome.webNavigation.onCompleted) as Listener,
    error: listenersOf(chrome.webNavigation.onErrorOccurred) as Listener,
    fragment: listenersOf(chrome.webNavigation.onReferenceFragmentUpdated) as Listener,
  };
  return { chrome, dispatch, fire };
}

/** Starts EXECUTE_NAVIGATE and reports whether it has settled, and how. */
function navigate(dispatch: Dispatch, url: string) {
  const state: { settled: boolean; result?: unknown; error?: any } = { settled: false };
  const promise = dispatch({ type: "EXECUTE_NAVIGATE", tabId: 7, url }).then(
    (result) => Object.assign(state, { settled: true, result }),
    (error) => Object.assign(state, { settled: true, error }),
  );
  return { state, promise };
}

const now = () => Date.now() + 1;

describe("EXECUTE_NAVIGATE's wait", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails at once with the restricted-page message when another extension's page takes the tab", async () => {
    const { chrome, dispatch, fire } = await loadDispatcher();
    const requested = "https://httpbin.org/anything/blocked";
    const { state, promise } = navigate(dispatch, requested);
    await vi.waitFor(() => expect(chrome.tabs.update).toHaveBeenCalled());

    // Surf's own page, and another tab's, don't end it.
    const own = "chrome-extension://mock-extension-id/options/options.html";
    fire.committed({ tabId: 7, frameId: 0, url: own, documentId: "own", timeStamp: now() });
    fire.committed({ tabId: 8, frameId: 0, url: BLOCKED_PAGE, documentId: "b8", timeStamp: now() });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(state.settled).toBe(false);

    fire.committed({
      tabId: 7,
      frameId: 0,
      url: BLOCKED_PAGE,
      documentId: "blocked",
      timeStamp: now(),
    });
    await promise;

    expect(state.error).toMatchObject({
      code: "restricted_target",
      message: `Cannot control ${BLOCKED_PAGE}: Chrome doesn't let extensions automate chrome:// pages, other extensions' pages (such as an ad blocker's "blocked" page) or the Web Store. Go to a web page first (surf go <url>) and retry.`,
      details: { tabId: 7, url: BLOCKED_PAGE, requested },
    });
  });

  it("ends at once on Chrome's error page, which Chrome reports as a load error", async () => {
    const { chrome, dispatch, fire } = await loadDispatcher();
    const url = "https://httpbin.org/status/404";
    const started = Date.now();
    const { state, promise } = navigate(dispatch, url);
    await vi.waitFor(() => expect(chrome.tabs.update).toHaveBeenCalled());
    // An empty-body 404: Chrome shows its error page and commits nothing webNavigation reports.
    fire.error({
      tabId: 7,
      frameId: 0,
      url,
      documentId: "e",
      error: "net::ERR_HTTP_RESPONSE_CODE_FAILURE",
      timeStamp: now(),
    });
    await promise;
    expect(state.result).toMatchObject({ success: true });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("is not ended by the previous load of the same URL, only by the load it committed", async () => {
    const { chrome, dispatch, fire } = await loadDispatcher();
    const url = "https://books.toscrape.com/";
    const before = Date.now() - 1000;
    const { state, promise } = navigate(dispatch, url);
    await vi.waitFor(() => expect(chrome.tabs.update).toHaveBeenCalled());

    // The page the tab showed finishes loading after the navigation started.
    fire.completed({ tabId: 7, frameId: 0, url, documentId: "old", timeStamp: before });
    fire.error({ tabId: 7, frameId: 0, url, error: "net::ERR_ABORTED", timeStamp: before });
    fire.committed({ tabId: 7, frameId: 0, url, documentId: "old", timeStamp: before });
    fire.completed({ tabId: 7, frameId: 0, url, documentId: "old", timeStamp: now() });
    // A frame's load is not the page's.
    fire.committed({ tabId: 7, frameId: 3, url, documentId: "frame", timeStamp: now() });
    fire.completed({ tabId: 7, frameId: 3, url, documentId: "frame", timeStamp: now() });
    // Longer than the half second a navigation pauses after its load.
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(state.settled).toBe(false);

    fire.committed({ tabId: 7, frameId: 0, url, documentId: "new", timeStamp: now() });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(state.settled).toBe(false);
    fire.completed({ tabId: 7, frameId: 0, url, documentId: "new", timeStamp: now() });
    await promise;
    expect(state.result).toMatchObject({ success: true });
  });

  it("ends when the tab already shows the URL with its fragment, which loads no new document", async () => {
    const { chrome, dispatch, fire } = await loadDispatcher();
    const url = "https://books.toscrape.com/#top";
    let { state, promise } = navigate(dispatch, url);
    await vi.waitFor(() => expect(chrome.tabs.update).toHaveBeenCalledTimes(1));
    // The page's own pushState to another URL is not this navigation.
    fire.fragment({
      tabId: 7,
      frameId: 0,
      url: "https://books.toscrape.com/#elsewhere",
      timeStamp: now(),
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(state.settled).toBe(false);
    fire.fragment({ tabId: 7, frameId: 0, url, timeStamp: now() });
    await promise;
    expect(state.result).toMatchObject({ success: true });

    // Chrome reports the same URL with the same fragment as a history state update.
    ({ state, promise } = navigate(dispatch, url));
    await vi.waitFor(() => expect(chrome.tabs.update).toHaveBeenCalledTimes(2));
    listenersOf(chrome.webNavigation.onHistoryStateUpdated)({
      tabId: 7,
      frameId: 0,
      url,
      timeStamp: now(),
    });
    await promise;
    expect(state.result).toMatchObject({ success: true });
  });

  it("waits for the load when the new page's router replaces its state with the same URL", async () => {
    const { chrome, dispatch, fire } = await loadDispatcher();
    const url = "https://app.example/dashboard";
    const { state, promise } = navigate(dispatch, url);
    await vi.waitFor(() => expect(chrome.tabs.update).toHaveBeenCalled());

    fire.committed({ tabId: 7, frameId: 0, url, documentId: "new", timeStamp: now() });
    // React Router and Vue Router call history.replaceState with the unchanged URL as they start.
    listenersOf(chrome.webNavigation.onHistoryStateUpdated)({
      tabId: 7,
      frameId: 0,
      url,
      documentId: "new",
      timeStamp: now(),
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(state.settled).toBe(false);

    fire.completed({ tabId: 7, frameId: 0, url, documentId: "new", timeStamp: now() });
    await promise;
    expect(state.result).toMatchObject({ success: true });
  });

  it("reports a navigation Chrome refuses", async () => {
    const { chrome, dispatch } = await loadDispatcher();
    chrome.tabs.update.mockRejectedValueOnce(new Error("Cannot navigate to a devtools:// URL"));
    await expect(
      dispatch({ type: "EXECUTE_NAVIGATE", tabId: 7, url: "devtools://x" }),
    ).rejects.toThrow("Cannot navigate to a devtools:// URL");
  });
});
