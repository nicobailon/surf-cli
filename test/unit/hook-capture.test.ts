import { describe, expect, it } from "vitest";
import { restrictedPageError } from "../../src/cdp/controller";

const { captureHook } = require("../../native/op-pipeline.cjs");
const { surfError } = require("../../native/surf-error.cjs");
const { parseDoCommands } = require("../../native/workflow-definition.cjs");

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
  redirects = {},
}: {
  refused?: Error;
  capture?: Record<string, unknown>;
  url?: string;
  redirects?: Record<string, string>;
}) {
  const calls: string[] = [];
  let url = start;
  const executeTool = async (tool: string, args: { url?: string; code?: string }) => {
    if (tool === "navigate") {
      calls.push(`navigate ${args.url}`);
      url = redirects[String(args.url)] ?? String(args.url);
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
    if (message.type === "TARGET_INSPECT") {
      return { url };
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
      "TARGET_INSPECT",
      "READ_NETWORK_REQUESTS",
      "STOP_NETWORK_CAPTURE",
    ]);
    expect(capture.entries).toEqual([page]);
    expect(capture.pageUrl).toBe(target);
    expect(capture).not.toHaveProperty("documentOnly");
  });

  it("fails at once when another extension's page takes the tab again, from that page too", async () => {
    const blocked =
      "chrome-extension://otherextensionid/strictblock.html#https://httpbin.org/anything/blocked";
    const requested = "https://httpbin.org/anything/blocked";
    const refused = surfError("restricted_target", `Cannot control ${blocked}: …`, {
      url: blocked,
    });
    const { calls, context } = fakeTab({
      refused,
      url: blocked,
      redirects: { [requested]: blocked },
    });

    await expect(captureHook({ url: requested, ...context })).rejects.toMatchObject({
      code: "restricted_target",
      // The host's copy of the message is the extension's, word for word.
      message: restrictedPageError(blocked, {}).message,
      url: blocked,
      requested,
    });
    expect(calls).toEqual([
      "START_NETWORK_CAPTURE",
      "navigate about:blank",
      "START_NETWORK_CAPTURE",
      `navigate ${requested}`,
      "TARGET_INSPECT",
      "STOP_NETWORK_CAPTURE",
    ]);
  });

  it("fails with Chrome's refusal and a --do tail when another extension's frame cut off a capture with steps", async () => {
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

    await expect(
      captureHook({ url: target, steps: parseDoCommands('click --selector "a.next"'), ...context }),
    ).rejects.toMatchObject({
      code: "restricted_target",
      message: `${message} --do steps need the debugger.`,
      reason: "foreign_extension_frame",
    });
  });

  it("fails with Chrome's refusal as it is for any other refused capture", async () => {
    const { context } = fakeTab({
      url: "https://quotes.toscrape.com/",
      capture: {
        active: true,
        refused: { code: "restricted_target", message: "Cannot control chrome://newtab/: …" },
      },
    });

    await expect(captureHook({ url: target, ...context })).rejects.toMatchObject({
      code: "restricted_target",
      message: "Cannot control chrome://newtab/: …",
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
