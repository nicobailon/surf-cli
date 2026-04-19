import { describe, expect, it } from "vitest";

/**
 * Tests for thinking trace helpers.
 * These are imported from the side-effect-free helpers module to avoid
 * requiring CloakBrowser (optional dependency) for pure function tests.
 */
describe("chatgpt-cloak-trace-helpers", () => {
  it("parses headed flyout text into the thinkingTrace contract", async () => {
    const helpers = await import("../../native/chatgpt-cloak-trace-helpers.mjs");

    const trace = helpers.parseThinkingTraceFlyoutText(`Activity · 17s
Thinking

Plan the answer carefully.

Check assumptions before committing.

Summarize clearly.
Thought for 17s
Done`);

    expect(trace).toEqual({
      thoughts: [
        { summary: "", content: "Plan the answer carefully." },
        { summary: "", content: "Check assumptions before committing." },
        { summary: "", content: "Summarize clearly." },
      ],
      durationSec: 17,
      recapText:
        "Plan the answer carefully.\n\nCheck assumptions before committing.\n\nSummarize clearly.",
      truncated: false,
    });
  });

  it("parses composite duration formats (minutes, hours)", async () => {
    const helpers = await import("../../native/chatgpt-cloak-trace-helpers.mjs");

    expect(
      helpers.parseThinkingTraceFlyoutText("Activity · 2m 30s\nThinking\nSome thought\nDone")
        ?.durationSec,
    ).toBe(150);
    expect(
      helpers.parseThinkingTraceFlyoutText("Activity · 1h 5m 10s\nThinking\nSome thought\nDone")
        ?.durationSec,
    ).toBe(3910);
    expect(
      helpers.parseThinkingTraceFlyoutText("Thought for 3m 45s\nSome thought\nDone")?.durationSec,
    ).toBe(225);
  });

  it("detects headed mode from launch options and context internals", async () => {
    const helpers = await import("../../native/chatgpt-cloak-trace-helpers.mjs");

    expect(helpers.detectBrowserHeadlessState({ launchOptions: { headless: true } })).toBe(true);
    expect(helpers.detectBrowserHeadlessState({ launchOptions: { headless: false } })).toBe(false);
    expect(
      helpers.detectBrowserHeadlessState({
        context: { _options: { headless: false } },
        launchOptions: { headless: true },
      }),
    ).toBe(false);
  });

  it("does not strip content that starts with Thinking but continues on same line", async () => {
    const helpers = await import("../../native/chatgpt-cloak-trace-helpers.mjs");

    const trace = helpers.parseThinkingTraceFlyoutText(
      "Activity · 5s\nThinking through edge cases before answering...\nDone",
    );
    expect(trace?.recapText).toBe("Thinking through edge cases before answering...");
  });
});

describe("chatgpt-cloak-worker module", () => {
  it("loads without syntax errors (module shape check)", async () => {
    // This catches duplicate exports, syntax errors, and import failures
    // without requiring CloakBrowser to be available
    const loadWorker = async () => {
      try {
        await import("../../native/chatgpt-cloak-worker.mjs");
        return { ok: true };
      } catch (e: unknown) {
        const err = e as Error;
        return { ok: false, error: err.message };
      }
    };

    const result = await loadWorker();
    if (!result.ok) {
      // If CloakBrowser is not available, that's expected in some environments
      // but duplicate exports or syntax errors should still fail
      const isCloakMissing =
        result.error?.includes("cloakbrowser") || result.error?.includes("Cannot find module");
      if (!isCloakMissing) {
        throw new Error(`Worker module failed to load: ${result.error}`);
      }
    }
  });
});
