import { describe, expect, it } from "vitest";

const { classifyTool } = require("../../native/tool-scope.cjs") as {
  classifyTool(tool: string, args?: Record<string, unknown>): Record<string, unknown>;
};

describe("tool scope classification", () => {
  it("classifies session lifecycle and inspection commands", () => {
    expect(classifyTool("session.ensure")).toMatchObject({
      scope: "browser-write",
      targetUse: "browser",
    });
    expect(classifyTool("session.cleanup")).toMatchObject({
      scope: "browser-write",
      targetUse: "browser",
    });
    expect(classifyTool("session.info")).toMatchObject({ scope: "host", targetUse: "host" });
    expect(classifyTool("session.info", { refresh: true })).toMatchObject({
      scope: "browser-read",
      targetUse: "host",
    });
  });

  it("keeps tab operations independent and provider browser flows exclusive", () => {
    expect(classifyTool("page.read")).toMatchObject({ scope: "tab", targetUse: "default-tab" });
    expect(classifyTool("chatgpt")).toMatchObject({ scope: "provider", targetUse: "default-tab" });
    expect(classifyTool("oracle.result")).toMatchObject({ scope: "host", targetUse: "host" });
  });

  it("targets no-ID tab.close through the selected session and keeps explicit closes global", () => {
    expect(classifyTool("tab.close", {})).toMatchObject({
      scope: "browser-write",
      targetUse: "default-tab",
    });
    expect(classifyTool("tab.close", { id: 42 })).toMatchObject({
      scope: "browser-write",
      targetUse: "browser",
    });
    expect(classifyTool("close_tab", { tab_id: 42 })).toMatchObject({
      scope: "browser-write",
      targetUse: "browser",
    });
  });

  it("canonicalizes shared output resources", () => {
    const classified = classifyTool("network.export", { output: "same.har" });
    expect(classified).toMatchObject({ scope: "tab", targetUse: "default-tab" });
    expect(classified.resourceKeys).toEqual([`file:${require("node:path").resolve("same.har")}`]);
  });

  it("fails conservative for unclassified browser commands", () => {
    expect(classifyTool("future.browser.command")).toMatchObject({
      scope: "browser-write",
      targetUse: "browser",
      conservative: true,
    });
  });
});
