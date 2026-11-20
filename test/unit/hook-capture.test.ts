import { describe, expect, it } from "vitest";

const { captureHook } = require("../../native/op-pipeline.cjs");
const { surfError } = require("../../native/surf-error.cjs");

const target = "https://books.toscrape.com/";
const page = {
  id: "r1",
  method: "GET",
  status: 200,
  type: "Document",
  mimeType: "text/html",
  url: target,
  ts: Date.now(),
  requestHeaders: {},
};

// A tab whose debugger attach Chrome refuses until it leaves its first page, and the calls made on it.
function fakeTab({
  refused,
  capture = {},
  url: start = "chrome://newtab/",
}: {
  refused?: Error;
  capture?: Record<string, unknown>;
  url?: string;
}) {
  const calls: string[] = [];
  let url = start;
  const executeTool = async (tool: string, args: { url?: string; code?: string }) => {
    if (tool === "navigate") {
      url = String(args.url);
      calls.push(`navigate ${url}`);
      return { success: true };
    }
    if (tool === "javascript_tool") {
      return { output: JSON.stringify({ url, text: "books" }) };
    }
    return { success: true };
  };
  const callExtension = async (message: { type: string }) => {
    calls.push(message.type);
    if (message.type === "START_NETWORK_CAPTURE" && !/^(https?:|about:blank)/.test(url)) {
      throw refused;
    }
    if (message.type === "READ_NETWORK_REQUESTS") {
      return { entries: [page], capture };
    }
    return { success: true };
  };
  return {
    calls,
    context: { executeTool, callExtension, sleep: () => Promise.resolve(), tabId: 1 },
  };
}

describe("surf hook's capture", () => {
  it("leaves a chrome:// page for about:blank, starts capture there, then opens the URL", async () => {
    const refused = surfError("restricted_target", "Cannot control chrome://newtab/: …", {
      url: "chrome://newtab/",
    });
    const { calls, context } = fakeTab({ refused });

    const capture = await captureHook({ url: target, ...context });

    expect(calls).toEqual([
      "START_NETWORK_CAPTURE",
      "navigate about:blank",
      "START_NETWORK_CAPTURE",
      `navigate ${target}`,
      "READ_NETWORK_REQUESTS",
      "STOP_NETWORK_CAPTURE",
    ]);
    expect(capture.entries).toEqual([page]);
    expect(capture.pageUrl).toBe(target);
  });

  it("fails with Chrome's refusal when another extension's frame cut the capture off", async () => {
    const message =
      "Cannot control this page: another extension has put a frame in it (a password manager, ad blocker or similar), and Chrome then blocks Surf's debugger for the whole tab. read still works, and so do click and type on a ref or selector; for hook or a debugger screenshot, turn that extension off for this site and retry.";
    const { context } = fakeTab({
      url: "https://quotes.toscrape.com/",
      capture: {
        active: true,
        interruptions: [{ reason: "target_closed", at: 1 }],
        refused: { code: "restricted_target", message, reason: "foreign_extension_frame" },
      },
    });

    await expect(captureHook({ url: target, ...context })).rejects.toMatchObject({
      code: "restricted_target",
      message,
      reason: "foreign_extension_frame",
    });
  });

  it("does not leave the page for an error other than a refused attach", async () => {
    const { calls, context } = fakeTab({ refused: surfError("debugger_busy", "busy") });

    await expect(captureHook({ url: target, ...context })).rejects.toMatchObject({
      code: "debugger_busy",
    });
    expect(calls).toEqual(["START_NETWORK_CAPTURE"]);
  });
});
