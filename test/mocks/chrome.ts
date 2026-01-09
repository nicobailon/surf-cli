/**
 * Chrome API mocks for testing extension code
 *
 * Usage:
 *   import { createChromeMock, resetChromeMock } from '../mocks/chrome';
 *
 *   beforeEach(() => {
 *     global.chrome = createChromeMock();
 *   });
 *
 *   afterEach(() => {
 *     resetChromeMock();
 *   });
 */

import { vi } from "vitest";

type ChromeMock = {
  tabs: {
    query: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    onUpdated: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
    onRemoved: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
  };
  debugger: {
    attach: ReturnType<typeof vi.fn>;
    detach: ReturnType<typeof vi.fn>;
    sendCommand: ReturnType<typeof vi.fn>;
    onEvent: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
    onDetach: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
  };
  runtime: {
    sendMessage: ReturnType<typeof vi.fn>;
    onMessage: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
    onConnect: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
    connectNative: ReturnType<typeof vi.fn>;
    lastError: null | { message: string };
    getURL: ReturnType<typeof vi.fn>;
    id: string;
  };
  storage: {
    local: {
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
      clear: ReturnType<typeof vi.fn>;
    };
    sync: {
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
      clear: ReturnType<typeof vi.fn>;
    };
    onChanged: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
  };
  windows: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    getAll: ReturnType<typeof vi.fn>;
    getCurrent: ReturnType<typeof vi.fn>;
  };
  scripting: {
    executeScript: ReturnType<typeof vi.fn>;
    insertCSS: ReturnType<typeof vi.fn>;
    removeCSS: ReturnType<typeof vi.fn>;
  };
};

let chromeMock: ChromeMock | null = null;

/**
 * Creates a fresh Chrome API mock with all common APIs stubbed
 */
export function createChromeMock(): ChromeMock {
  chromeMock = {
    tabs: {
      query: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 1 }),
      update: vi.fn().mockResolvedValue({}),
      remove: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      onUpdated: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      onRemoved: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    debugger: {
      attach: vi.fn().mockResolvedValue(undefined),
      detach: vi.fn().mockResolvedValue(undefined),
      sendCommand: vi.fn().mockResolvedValue({}),
      onEvent: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      onDetach: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    runtime: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      onConnect: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      connectNative: vi.fn().mockReturnValue({
        postMessage: vi.fn(),
        disconnect: vi.fn(),
        onMessage: { addListener: vi.fn() },
        onDisconnect: { addListener: vi.fn() },
      }),
      lastError: null,
      getURL: vi.fn((path: string) => `chrome-extension://mock-id/${path}`),
      id: "mock-extension-id",
    },
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(undefined),
      },
      sync: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(undefined),
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    windows: {
      create: vi.fn().mockResolvedValue({ id: 1 }),
      update: vi.fn().mockResolvedValue({}),
      remove: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      getAll: vi.fn().mockResolvedValue([]),
      getCurrent: vi.fn().mockResolvedValue({ id: 1 }),
    },
    scripting: {
      executeScript: vi.fn().mockResolvedValue([]),
      insertCSS: vi.fn().mockResolvedValue(undefined),
      removeCSS: vi.fn().mockResolvedValue(undefined),
    },
  };

  return chromeMock;
}

/**
 * Resets the Chrome mock and clears global.chrome
 */
export function resetChromeMock(): void {
  if (chromeMock) {
    // Clear all mocks
    Object.values(chromeMock).forEach((api) => {
      Object.values(api).forEach((method) => {
        if (typeof method === "function" && "mockClear" in method) {
          method.mockClear();
        } else if (typeof method === "object" && method !== null) {
          Object.values(method).forEach((subMethod) => {
            if (typeof subMethod === "function" && "mockClear" in subMethod) {
              (subMethod as ReturnType<typeof vi.fn>).mockClear();
            }
          });
        }
      });
    });
  }
  chromeMock = null;
  // @ts-expect-error - cleaning up global
  delete globalThis.chrome;
}

/**
 * Helper to create a mock tab object
 */
export function createMockTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 1,
    index: 0,
    windowId: 1,
    highlighted: true,
    active: true,
    selected: false, // deprecated but required by type
    pinned: false,
    incognito: false,
    url: "https://example.com",
    title: "Example",
    status: "complete",
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    ...overrides,
  };
}

/**
 * Helper to create a mock debugger target
 */
export function createMockDebuggerTarget(
  tabId: number
): chrome.debugger.Debuggee {
  return { tabId };
}
