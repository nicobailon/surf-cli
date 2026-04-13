import { describe, expect, it, vi } from "vitest";

const {
  enterPromptWithVerification,
  __private,
} = require("../../native/chatgpt-cloak-prompt-entry.cjs");

type HarnessOptions = {
  insertTransform?: (text: string, state: HarnessState) => string;
  sendEnabledFunc?: (state: HarnessState) => boolean;
  sendThreshold?: number;
  sendButtonFound?: boolean;
  // ProseMirror simulation
  composerKind?: "prosemirror" | "textarea" | "unknown";
  prosemirrorViewAvailable?: boolean;
  prosemirrorViewResolutionMethod?: "pmViewDesc" | "property_scan";
  prosemirrorFallbackReason?: "view_not_found" | "unsupported_schema";
  // Optional transform for PM replace (text → composer text after PM replace)
  prosemirrorReplaceTransform?: (text: string) => string;
};

type HarnessState = {
  composerText: string;
  insertCalls: number;
  readCalls: number;
  sendEnabled: boolean;
  pmReplaceCalled: boolean;
  lastMethod: string;
};

function createSleepMock() {
  return vi.fn(async () => undefined);
}

function updateSendEnabled(state: HarnessState, options: HarnessOptions) {
  if (typeof options.sendEnabledFunc === "function") {
    state.sendEnabled = !!options.sendEnabledFunc(state);
    return;
  }
  state.sendEnabled = state.composerText.length >= (options.sendThreshold ?? 1);
}

function resolveSendState(sendButtonFound: boolean, sendEnabled: boolean) {
  if (!sendButtonFound) {
    return "unknown";
  }
  return sendEnabled ? "enabled" : "disabled";
}

function readState(state: HarnessState, options: HarnessOptions) {
  state.readCalls += 1;
  updateSendEnabled(state, options);
  const sendButtonFound = options.sendButtonFound ?? true;
  return {
    actualText: state.composerText,
    actualChars: state.composerText.length,
    rawLengths: {
      value: 0,
      textContent: state.composerText.length,
      innerText: state.composerText.length,
    },
    sendEnabled: sendButtonFound ? state.sendEnabled : false,
    sendButtonFound,
    sendState: resolveSendState(sendButtonFound, state.sendEnabled),
  };
}

function isReadStateCall(source: string) {
  return source.includes("readProseMirrorText") && source.includes("sendEnabled");
}

function isClearComposerCall(source: string) {
  return source.includes("deleteContentBackward") && source.includes("ProseMirror-trailingBreak");
}

function isFillFallbackCall(source: string) {
  return source.includes("insertFromPaste") && source.includes("escapeHtml");
}

function isProseMirrorReplaceCall(source: string) {
  return source.includes("pmViewDesc") && source.includes("replaceWith");
}

function createPmFallbackResult(
  composerKind: "prosemirror" | "textarea" | "unknown",
  fallbackReason: "not_prosemirror" | "view_not_found" | "unsupported_schema",
) {
  return {
    applied: false,
    fallbackSafe: true,
    composerKind,
    fallbackReason,
  };
}

function handleEvaluate(source: string, state: HarnessState, options: HarnessOptions) {
  if (isReadStateCall(source)) {
    return readState(state, options);
  }

  if (isClearComposerCall(source)) {
    state.composerText = "";
    updateSendEnabled(state, options);
    return true;
  }

  if (isFillFallbackCall(source)) {
    return true;
  }

  if (isProseMirrorReplaceCall(source)) {
    const kind = options.composerKind ?? "textarea";
    if (kind !== "prosemirror") {
      return createPmFallbackResult(kind, "not_prosemirror");
    }
    if (options.prosemirrorFallbackReason) {
      return createPmFallbackResult("prosemirror", options.prosemirrorFallbackReason);
    }
    if (options.prosemirrorViewAvailable === false) {
      return createPmFallbackResult("prosemirror", "view_not_found");
    }
    state.pmReplaceCalled = true;
    state.lastMethod = "prosemirror_replace";
    return {
      applied: true,
      composerKind: "prosemirror",
      viewResolutionMethod: options.prosemirrorViewResolutionMethod ?? "pmViewDesc",
      paragraphCount: 1,
    };
  }

  throw new Error(`Unhandled evaluate call: ${source.slice(0, 140)}`);
}

function createHarness(options: HarnessOptions = {}) {
  const state: HarnessState = {
    composerText: "",
    insertCalls: 0,
    readCalls: 0,
    sendEnabled: false,
    pmReplaceCalled: false,
    lastMethod: "",
  };

  const textarea = {
    type: vi.fn(async () => undefined),
    fill: vi.fn(async () => undefined),
  };

  const canApplyProseMirrorPrompt = (source: string, args: unknown) => {
    const promptArgs = args as { prompt?: string } | undefined;
    if (!isProseMirrorReplaceCall(source)) {
      return false;
    }

    return (
      promptArgs?.prompt !== undefined &&
      options.composerKind === "prosemirror" &&
      options.prosemirrorViewAvailable !== false &&
      !options.prosemirrorFallbackReason
    );
  };

  const applyProseMirrorPrompt = (args: unknown) => {
    const promptArgs = args as { prompt?: string } | undefined;
    const prompt = promptArgs?.prompt;
    if (prompt === undefined) {
      return;
    }

    const transform = options.prosemirrorReplaceTransform ?? ((t: string) => t);
    state.composerText = transform(prompt);
    updateSendEnabled(state, options);
  };

  const applyFillPromptFallback = (source: string, args: unknown) => {
    if (!isFillFallbackCall(source)) {
      return;
    }

    const fillArgs = args as { text?: string } | undefined;
    if (fillArgs?.text === undefined) {
      return;
    }

    state.composerText = fillArgs.text;
    updateSendEnabled(state, options);
  };

  const applyEvaluateArgs = (source: string, args: unknown) => {
    if (canApplyProseMirrorPrompt(source, args)) {
      applyProseMirrorPrompt(args);
      return;
    }

    applyFillPromptFallback(source, args);
  };

  const page = {
    evaluate: vi.fn(async (fn: unknown, args?: unknown) => {
      const source = typeof fn === "function" ? fn.toString() : String(fn);
      applyEvaluateArgs(source, args);
      return handleEvaluate(source, state, options);
    }),
    _original: {
      keyboardInsertText: vi.fn(async (text: string) => {
        state.insertCalls += 1;
        state.composerText = options.insertTransform ? options.insertTransform(text, state) : text;
        updateSendEnabled(state, options);
      }),
    },
  };

  return { page, textarea, state };
}

describe("chatgpt-cloak-prompt-entry", () => {
  it("inserts exact text via native keyboardInsertText for small prompts", async () => {
    const harness = createHarness();
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt: "small prompt",
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("native_insert_text");
    expect(result.exactMatch).toBe(true);
    expect(harness.page._original.keyboardInsertText).toHaveBeenCalledTimes(1);
    expect(harness.textarea.type).not.toHaveBeenCalled();
    expect(harness.textarea.fill).not.toHaveBeenCalled();
  });

  it("inserts exact text via native keyboardInsertText bulk insert for very large prompts when not ProseMirror", async () => {
    const harness = createHarness({
      composerKind: "textarea",
    });
    const sleep = createSleepMock();
    const prompt = "abcd".repeat(60 * 1024);

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("native_insert_text");
    expect(result.exactMatch).toBe(true);
    expect(result.actualChars).toBe(prompt.length);
    expect(harness.page._original.keyboardInsertText).toHaveBeenCalledTimes(1);
  });

  it("waits briefly for delayed send readiness", async () => {
    const harness = createHarness({
      sendEnabledFunc: (state) => state.readCalls >= 4,
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt: "delayed ready",
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.exactMatch).toBe(true);
    expect(result.sendEnabled).toBe(true);
    expect(sleep).toHaveBeenCalled();
  });

  it("does not fail when exact text matches but send button remains disabled", async () => {
    const harness = createHarness({
      sendEnabledFunc: () => false,
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt: "exact text, disabled send",
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.exactMatch).toBe(true);
    expect(result.sendEnabled).toBe(false);
    expect(result.sendState).toBe("disabled");
  });

  it("does not fail when send selector is missing", async () => {
    const harness = createHarness({
      sendButtonFound: false,
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt: "selector drift",
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.exactMatch).toBe(true);
    expect(result.sendButtonFound).toBe(false);
    expect(result.sendState).toBe("unknown");
  });

  it("recovers via fill_fallback when native insertion strategies mismatch", async () => {
    const harness = createHarness({
      insertTransform: (text, state) =>
        `${state.composerText}${text.slice(0, Math.floor(text.length * 0.4))}`,
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt: "x".repeat(20 * 1024),
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("fill_fallback");
    expect(result.exactMatch).toBe(true);
  });

  it("uses prosemirror_replace for large prompts when ProseMirror EditorView is available", async () => {
    const largePrompt = "hello world\nsecond line".padEnd(10 * 1024, " x");
    const harness = createHarness({
      composerKind: "prosemirror",
      prosemirrorViewAvailable: true,
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt: largePrompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("prosemirror_replace");
    expect(result.exactMatch).toBe(true);
    expect(harness.page._original.keyboardInsertText).not.toHaveBeenCalled();
    expect(harness.state.pmReplaceCalled).toBe(true);
  });

  it("falls back to native_insert_text for large prompts when ProseMirror EditorView is not available", async () => {
    const largePrompt = "x".repeat(10 * 1024);
    const harness = createHarness({
      composerKind: "prosemirror",
      prosemirrorViewAvailable: false,
      insertTransform: (text, state) => `${state.composerText}${text}`,
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt: largePrompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("native_insert_text");
    expect(result.exactMatch).toBe(true);
    expect(harness.page._original.keyboardInsertText).toHaveBeenCalled();
  });

  it("falls back to native_insert_text for large prompts when composer is not ProseMirror", async () => {
    const largePrompt = "x".repeat(10 * 1024);
    const harness = createHarness({
      composerKind: "textarea",
      insertTransform: (text, state) => `${state.composerText}${text}`,
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt: largePrompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("native_insert_text");
    expect(result.exactMatch).toBe(true);
  });

  it("prosemirror_replace preserves multiline structure with blank lines after normalization", async () => {
    const prompt = ["line one", "", "line three", "", "line five"]
      .join("\n")
      .padEnd(9 * 1024, "\npadding");
    const harness = createHarness({
      composerKind: "prosemirror",
      prosemirrorViewAvailable: true,
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("prosemirror_replace");
    expect(result.exactMatch).toBe(true);
  });

  it("falls back to native insertion when prosemirror_replace verification mismatches", async () => {
    const largePrompt = "x".repeat(10 * 1024);
    const harness = createHarness({
      composerKind: "prosemirror",
      prosemirrorViewAvailable: true,
      // Simulate PM writing only half the content (drift/bug)
      prosemirrorReplaceTransform: (text) => text.slice(0, Math.floor(text.length / 2)),
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt: largePrompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("native_insert_text");
    expect(result.exactMatch).toBe(true);
    expect(harness.page._original.keyboardInsertText).toHaveBeenCalledTimes(1);
  });

  it("prosemirror_replace still honors delayed send readiness", async () => {
    const largePrompt = "x".repeat(10 * 1024);
    const harness = createHarness({
      composerKind: "prosemirror",
      prosemirrorViewAvailable: true,
      sendEnabledFunc: (state) => state.readCalls >= 3,
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt: largePrompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("prosemirror_replace");
    expect(result.sendEnabled).toBe(true);
    expect(sleep).toHaveBeenCalled();
  });

  it("does not accept large same-length native mismatches and falls back to fill_fallback", async () => {
    const harness = createHarness({
      composerKind: "textarea",
      insertTransform: (text) => `y${text.slice(1)}`,
    });
    const sleep = createSleepMock();
    const prompt = "x".repeat(9 * 1024);

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("fill_fallback");
    expect(result.exactMatch).toBe(true);
  });

  it("falls back to chunked native insertion after severe bulk mismatch", async () => {
    const prompt = "abcd".repeat(5 * 1024);
    const harness = createHarness({
      composerKind: "textarea",
      insertTransform: (text, state) => {
        if (state.insertCalls === 1) {
          return text.slice(0, Math.floor(text.length / 4));
        }
        return `${state.composerText}${text}`;
      },
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("native_insert_text_chunked");
    expect(result.exactMatch).toBe(true);
    expect(harness.page._original.keyboardInsertText).toHaveBeenCalledTimes(4);
  });

  it("buildMetrics normalizes line endings, terminal newlines, and nbsp", () => {
    expect(
      __private.buildMetrics({
        method: "native_insert_text",
        expectedText: "a\r\n\u00a0b\n\n",
        actualState: {
          actualText: "a\n b",
          sendEnabled: false,
          sendButtonFound: true,
          sendState: "disabled",
          rawLengths: { value: 3, textContent: 3, innerText: 3 },
        },
      }),
    ).toMatchObject({
      exactMatch: true,
      expectedChars: 4,
      actualChars: 4,
    });
  });

  it("splits native insert chunks at the configured boundary", () => {
    expect(__private.splitNativeInsertChunks("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("scales native insert timeout with very large payloads", () => {
    expect(__private.resolveNativeInsertTimeoutMs("x".repeat(4 * 1024))).toBe(120_000);
    expect(__private.resolveNativeInsertTimeoutMs("x".repeat(446 * 1024))).toBeGreaterThan(120_000);
  });

  it("prefers fill_fallback first for very large payloads", async () => {
    const prompt = "x".repeat(300 * 1024);
    const harness = createHarness({
      composerKind: "textarea",
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("fill_fallback");
    expect(result.exactMatch).toBe(true);
    expect(harness.page._original.keyboardInsertText).not.toHaveBeenCalled();
  });

  it("uses proseMirror byte threshold for multibyte-heavy prompts", async () => {
    const prompt = "🙂".repeat(3_000);
    expect(prompt.length).toBeLessThan(8 * 1024);
    expect(__private.byteLength(prompt)).toBeGreaterThan(8 * 1024);
    const harness = createHarness({
      composerKind: "prosemirror",
      prosemirrorViewAvailable: true,
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("prosemirror_replace");
    expect(result.exactMatch).toBe(true);
  });

  it("falls back to native insertion when proseMirror text is exact but send stays disabled", async () => {
    const largePrompt = "x".repeat(10 * 1024);
    const harness = createHarness({
      composerKind: "prosemirror",
      prosemirrorViewAvailable: true,
      sendEnabledFunc: () => false,
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt: largePrompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("native_insert_text");
    expect(result.exactMatch).toBe(true);
    expect(harness.page._original.keyboardInsertText).toHaveBeenCalledTimes(1);
  });

  it("reports property_scan when proseMirror view is discovered via fallback scan", async () => {
    const largePrompt = "x".repeat(10 * 1024);
    const harness = createHarness({
      composerKind: "prosemirror",
      prosemirrorViewAvailable: true,
      prosemirrorViewResolutionMethod: "property_scan",
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt: largePrompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("prosemirror_replace");
    expect(harness.state.pmReplaceCalled).toBe(true);
  });

  it("falls back to native insertion when proseMirror schema is unsupported", async () => {
    const largePrompt = "x".repeat(10 * 1024);
    const harness = createHarness({
      composerKind: "prosemirror",
      prosemirrorFallbackReason: "unsupported_schema",
    });
    const sleep = createSleepMock();

    const result = await enterPromptWithVerification({
      page: harness.page,
      textarea: harness.textarea,
      prompt: largePrompt,
      log: vi.fn(),
      sleep,
      promptSelector: "#prompt-textarea",
      sendButtonSelectors: ["button[data-testid='send-button']"],
    });

    expect(result.method).toBe("native_insert_text");
    expect(result.exactMatch).toBe(true);
  });

  it("splits utf8 chunks without breaking multibyte characters", () => {
    const text = "🙂🙂🙂🙂🙂";
    const chunks = __private.splitUtf8Chunks(text, 8);
    expect(chunks.map((chunk: { text: string }) => chunk.text).join("")).toBe(text);
    expect(chunks.every((chunk: { bytes: number }) => chunk.bytes <= 8)).toBe(true);
  });
});
