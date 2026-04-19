import { describe, expect, it } from "vitest";

describe("chatgpt-cloak-worker", () => {
  it("parses headed flyout text into the thinkingTrace contract", async () => {
    const worker = await import("../../native/chatgpt-cloak-worker.mjs");

    const trace = worker.parseThinkingTraceFlyoutText(`Activity · 17s
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

  it("detects headed mode from launch options and context internals", async () => {
    const worker = await import("../../native/chatgpt-cloak-worker.mjs");

    expect(worker.detectBrowserHeadlessState({ launchOptions: { headless: true } })).toBe(true);
    expect(worker.detectBrowserHeadlessState({ launchOptions: { headless: false } })).toBe(false);
    expect(
      worker.detectBrowserHeadlessState({
        context: { _options: { headless: false } },
        launchOptions: { headless: true },
      }),
    ).toBe(false);
  });
});
