import { describe, expect, it } from "vitest";

const { BrowserScheduler } = require("../../native/browser-scheduler.cjs") as {
  BrowserScheduler: new (
    options?: Record<string, unknown>,
  ) => {
    acquire(options: Record<string, unknown>): Promise<any>;
    stats(options?: { laneKey?: string }): any;
  };
};

describe("BrowserScheduler", () => {
  it("allows different tab lanes to execute concurrently", async () => {
    const scheduler = new BrowserScheduler();
    const first = await scheduler.acquire({ scope: "tab", laneKey: "tab:1", session: "one" });
    const second = await scheduler.acquire({ scope: "tab", laneKey: "tab:2", session: "two" });

    expect(scheduler.stats().activeTabLanes).toHaveLength(2);
    first.release();
    second.release();
  });

  it("keeps the same tab FIFO", async () => {
    const scheduler = new BrowserScheduler();
    const first = await scheduler.acquire({ scope: "tab", laneKey: "tab:1", session: "one" });
    let secondGranted = false;
    const secondPromise = scheduler
      .acquire({ scope: "tab", laneKey: "tab:1", session: "one" })
      .then((token: any) => {
        secondGranted = true;
        return token;
      });

    await Promise.resolve();
    expect(secondGranted).toBe(false);
    first.release();
    const second = await secondPromise;
    expect(secondGranted).toBe(true);
    second.release();
  });

  it("gives waiting browser writers preference over new tab lanes", async () => {
    const scheduler = new BrowserScheduler();
    const activeTab = await scheduler.acquire({ scope: "tab", laneKey: "tab:1", session: "one" });
    let writerGranted = false;
    let laterTabGranted = false;
    const writerPromise = scheduler
      .acquire({ scope: "browser-write", session: "maintenance" })
      .then((token: any) => {
        writerGranted = true;
        return token;
      });
    const laterTabPromise = scheduler
      .acquire({ scope: "tab", laneKey: "tab:2", session: "two" })
      .then((token: any) => {
        laterTabGranted = true;
        return token;
      });

    activeTab.release();
    const writer = await writerPromise;
    expect(writerGranted).toBe(true);
    expect(laterTabGranted).toBe(false);
    writer.release();
    const laterTab = await laterTabPromise;
    expect(laterTabGranted).toBe(true);
    laterTab.release();
  });

  it("returns copy-pasteable tab_busy and browser_busy errors with --no-wait semantics", async () => {
    const scheduler = new BrowserScheduler();
    const tab = await scheduler.acquire({ scope: "tab", laneKey: "tab:1", session: "research" });
    await expect(
      scheduler.acquire({ scope: "tab", laneKey: "tab:1", session: "research", wait: false }),
    ).rejects.toMatchObject({
      code: "tab_busy",
      recoveryCommand: "surf session.info research",
    });
    tab.release();

    const writer = await scheduler.acquire({ scope: "browser-write", session: "admin" });
    await expect(
      scheduler.acquire({ scope: "tab", laneKey: "tab:2", session: "scout", wait: false }),
    ).rejects.toMatchObject({
      code: "browser_busy",
      recoveryCommand: "surf session.info scout",
    });
    writer.release();
  });

  it("serializes the same shared resource across different tab lanes", async () => {
    const scheduler = new BrowserScheduler();
    const first = await scheduler.acquire({
      scope: "tab",
      laneKey: "tab:1",
      session: "one",
      resourceKeys: ["file:/tmp/same.har"],
    });
    let secondGranted = false;
    const secondPromise = scheduler
      .acquire({
        scope: "tab",
        laneKey: "tab:2",
        session: "two",
        resourceKeys: ["file:/tmp/same.har"],
      })
      .then((token: any) => {
        secondGranted = true;
        return token;
      });

    await Promise.resolve();
    expect(secondGranted).toBe(false);
    expect(scheduler.stats().activeResources).toMatchObject([
      { key: "file:/tmp/same.har", laneKey: "tab:1" },
    ]);
    first.release();
    const second = await secondPromise;
    expect(secondGranted).toBe(true);
    second.release();
  });

  it("allows unrelated shared resources to overlap and reports resource_busy for no-wait", async () => {
    const scheduler = new BrowserScheduler();
    const first = await scheduler.acquire({
      scope: "tab",
      laneKey: "tab:1",
      session: "one",
      resourceKeys: ["file:/tmp/one.har"],
    });
    const second = await scheduler.acquire({
      scope: "tab",
      laneKey: "tab:2",
      session: "two",
      resourceKeys: ["file:/tmp/two.har"],
    });
    await expect(
      scheduler.acquire({
        scope: "tab",
        laneKey: "tab:3",
        session: "three",
        resourceKeys: ["file:/tmp/one.har"],
        wait: false,
      }),
    ).rejects.toMatchObject({
      code: "resource_busy",
      resourceKeys: ["file:/tmp/one.har"],
      recoveryCommand: "surf session.info three",
    });
    first.release();
    second.release();
  });

  it("reports why a session lane is blocked", async () => {
    const scheduler = new BrowserScheduler();
    const writer = await scheduler.acquire({ scope: "provider", session: "provider" });
    const stats = scheduler.stats({ laneKey: "tab:research" });

    expect(stats.writer).toMatchObject({ scope: "provider", session: "provider" });
    expect(stats.lane.blockedBy).toBe("browser-writer");
    writer.release();
  });
});
