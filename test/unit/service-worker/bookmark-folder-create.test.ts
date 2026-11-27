import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChromeMock } from "../../mocks/chrome";

const nativeState = vi.hoisted(() => ({ initNativeMessaging: vi.fn(), postToNativeHost: vi.fn() }));

vi.mock("../../../src/native/port-manager", () => nativeState);

type BookmarkNode = {
  id: string;
  title: string;
  children?: BookmarkNode[];
};

type Dispatch = (message: Record<string, unknown>) => Promise<unknown>;

async function loadDispatcher(children: BookmarkNode[]) {
  vi.resetModules();
  nativeState.initNativeMessaging.mockReset();
  const chrome = createChromeMock();
  const bookmarks = {
    getTree: vi.fn().mockResolvedValue([{ id: "0", title: "", children }]),
    create: vi.fn(async (options: { title: string; parentId: string }) => ({
      id: "created-folder",
      ...options,
      children: [],
    })),
  };
  Object.defineProperty(chrome, "bookmarks", { value: bookmarks });
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: chrome });
  // Resetting the worker module and re-importing after setting Chrome isolates its listener per test.
  await import("../../../src/service-worker/index");
  const dispatch = nativeState.initNativeMessaging.mock.calls[0]?.[0] as Dispatch;
  return { bookmarks, dispatch };
}

describe("bookmark.folder.create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates under Other Bookmarks when no parent is supplied", async () => {
    const { bookmarks, dispatch } = await loadDispatcher([
      { id: "1", title: "Bookmarks bar", children: [] },
      { id: "2", title: "Other Bookmarks", children: [] },
    ]);

    const result = await dispatch({ type: "BOOKMARK_FOLDER_CREATE", title: "Research" });

    expect(bookmarks.create).toHaveBeenCalledWith({ title: "Research", parentId: "2" });
    expect(result).toEqual({
      success: true,
      folder: { id: "created-folder", title: "Research", parentId: "2" },
    });
  });

  it("uses the unique exact parent-title match", async () => {
    const { bookmarks, dispatch } = await loadDispatcher([
      { id: "1", title: "Bookmarks bar", children: [] },
      { id: "2", title: "Other Bookmarks", children: [] },
      { id: "3", title: "work", children: [] },
      { id: "4", title: "Work", children: [] },
    ]);

    const result = await dispatch({
      type: "BOOKMARK_FOLDER_CREATE",
      title: "Planning",
      parent: "Work",
    });

    expect(bookmarks.create).toHaveBeenCalledWith({ title: "Planning", parentId: "4" });
    expect(result).toEqual({
      success: true,
      folder: { id: "created-folder", title: "Planning", parentId: "4" },
    });
  });

  it.each([
    {
      reason: "missing",
      children: [
        { id: "1", title: "Bookmarks bar", children: [] },
        { id: "2", title: "Other Bookmarks", children: [] },
      ],
    },
    {
      reason: "ambiguous",
      children: [
        {
          id: "1",
          title: "Bookmarks bar",
          children: [{ id: "3", title: "Projects", children: [] }],
        },
        { id: "2", title: "Other Bookmarks", children: [] },
        { id: "4", title: "Projects", children: [] },
      ],
    },
  ])("rejects a $reason parent without creating a folder", async ({ children }) => {
    const { bookmarks, dispatch } = await loadDispatcher(children);

    await expect(
      dispatch({ type: "BOOKMARK_FOLDER_CREATE", title: "Planning", parent: "Projects" }),
    ).rejects.toThrow();

    expect(bookmarks.create).not.toHaveBeenCalled();
  });
});
