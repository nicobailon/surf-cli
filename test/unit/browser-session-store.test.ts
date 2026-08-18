import { afterEach, describe, expect, it } from "vitest";

const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const { BrowserSessionStore, validateSessionName } =
  require("../../native/browser-session-store.cjs") as {
    BrowserSessionStore: new (options: {
      filePath: string;
      root: string;
      now?: () => string;
    }) => any;
    validateSessionName(name: string): string;
  };

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function store() {
  const root = mkdtempSync(join(tmpdir(), "surf-browser-sessions-"));
  roots.push(root);
  return {
    root,
    store: new BrowserSessionStore({
      root,
      filePath: join(root, "browser-sessions.json"),
      now: () => "2026-08-18T00:00:00.000Z",
    }),
  };
}

const identity = { browserInstanceId: "browser-a", browserEpoch: "epoch-a" };

describe("BrowserSessionStore", () => {
  it("persists case-insensitive named bindings without changing their display name", () => {
    const { store: sessions } = store();
    const created = sessions.create(identity, "Research", {
      tabId: 11,
      windowId: 22,
      mode: "window",
      ownership: "surf-created",
      lastUrl: "https://example.com/",
    });

    expect(created.name).toBe("Research");
    expect(sessions.get(identity, "research")).toMatchObject({ tabId: 11, windowId: 22 });
    expect(() => sessions.create(identity, "RESEARCH", { tabId: 99 })).toThrow(/already exists/i);
  });

  it("marks a removed tab stale while retaining its last URL for recovery", () => {
    const { store: sessions } = store();
    sessions.create(identity, "research", {
      tabId: 11,
      windowId: 22,
      mode: "window",
      ownership: "surf-created",
      lastUrl: "https://example.com/recover",
    });

    expect(sessions.invalidateByTab(identity, 11)).toBe(true);
    expect(sessions.get(identity, "research")).toMatchObject({
      invalidReason: "tab_gone",
      lastUrl: "https://example.com/recover",
    });
  });

  it("replaces stale bindings while preserving the binding ID and creation time", () => {
    const { store: sessions } = store();
    const first = sessions.create(identity, "research", {
      tabId: 11,
      windowId: 22,
      mode: "window",
      ownership: "surf-created",
    });
    sessions.invalidateByTab(identity, 11);
    const second = sessions.replace(identity, "research", {
      tabId: 33,
      windowId: 44,
      mode: "window",
      ownership: "surf-created",
    });

    expect(second.bindingId).toBe(first.bindingId);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.invalidReason).toBeUndefined();
    expect(second.tabId).toBe(33);
  });

  it("persists session frame context across host store instances", () => {
    const { root, store: sessions } = store();
    const filePath = join(root, "browser-sessions.json");
    sessions.create(identity, "research", {
      tabId: 11,
      windowId: 22,
      mode: "window",
      ownership: "surf-created",
    });
    sessions.update(identity, "research", {
      frameContext: {
        frameId: 9,
        tabId: 11,
        windowId: 22,
        browserEpoch: identity.browserEpoch,
        url: "https://example.com/frame",
      },
    });

    const reloaded = new BrowserSessionStore({
      root,
      filePath,
      now: () => "2026-08-18T00:00:00.000Z",
    });
    expect(reloaded.get(identity, "research")).toMatchObject({
      frameContext: { frameId: 9, tabId: 11, browserEpoch: "epoch-a" },
    });
  });

  it("persists named-tab aliases in host state and removes them with their tab", () => {
    const { store: sessions } = store();
    sessions.setNamedTab(identity, "dashboard", {
      tabId: 77,
      windowId: 8,
      lastUrl: "https://example.com/dashboard",
    });

    expect(sessions.getNamedTab(identity, "DASHBOARD")).toMatchObject({ tabId: 77 });
    sessions.invalidateByTab(identity, 77);
    expect(sessions.getNamedTab(identity, "dashboard")).toBeNull();
  });

  it("fails closed on malformed private state", () => {
    const { root, store: sessions } = store();
    writeFileSync(join(root, "browser-sessions.json"), "{not-json", { mode: 0o600 });
    expect(() => sessions.list(identity)).toThrow(/failed to read browser sessions/i);
  });

  it("validates agent-safe session names", () => {
    expect(validateSessionName("repo.agent-1")).toBe("repo.agent-1");
    expect(() => validateSessionName("has spaces")).toThrow(/session name/i);
    expect(() => validateSessionName("/escape")).toThrow(/session name/i);
  });
});
