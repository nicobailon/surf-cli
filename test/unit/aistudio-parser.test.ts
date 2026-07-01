import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const parser = require("../../native/aistudio-parser.cjs");

describe("normalizeAiStudioRpcJson", () => {
  it("strips XSSI prefix", () => {
    const body = ")]}'\n[1,2,3]";
    expect(parser.normalizeAiStudioRpcJson(body)).toBe("[1,2,3]");
  });

  it("normalizes array elision for RPC error payloads", () => {
    const body = '[,[7,"permission denied"]]';
    expect(parser.normalizeAiStudioRpcJson(body)).toBe('[null,[7,"permission denied"]]');
  });
});

describe("parseAiStudioRpcError", () => {
  it("extracts code and message from RPC array payload", () => {
    const body = '[,[7,"The caller does not have permission"]]';
    expect(parser.parseAiStudioRpcError(body)).toEqual({
      code: 7,
      message: "The caller does not have permission",
    });
  });

  it("returns null for non-error payloads", () => {
    expect(parser.parseAiStudioRpcError('{"ok":true}')).toBeNull();
  });
});

describe("parseAiStudioGenerateContentText", () => {
  it("extracts model text from nested GenerateContent payload", () => {
    const payload = [
      [[[[null, "Hello"]]], "model"],
      [[[[null, " world!"]]], "model"],
    ];

    expect(parser.parseAiStudioGenerateContentText(JSON.stringify(payload))).toBe("Hello world!");
  });

  it("filters thinking chunks before returning final content", () => {
    const payload = [
      [[[null, "Considering options...", null, 1]], "model"],
      [[[null, "# Final\nShipped answer"]], "model"],
    ];

    expect(parser.parseAiStudioGenerateContentText(JSON.stringify(payload))).toBe(
      "# Final\nShipped answer",
    );
  });

  it("handles XSSI-prefixed GenerateContent responses", () => {
    const payload = [[[[null, "Ready"]], "model"]];
    const xssi = `)]}'\n${JSON.stringify(payload)}`;

    expect(parser.parseAiStudioGenerateContentText(xssi)).toBe("Ready");
  });
});

describe("cleanAiStudioResponse", () => {
  it("removes prompt echo and UI chrome while preserving code fences", () => {
    const raw = [
      "User",
      "Explain this code",
      "Model",
      "Answer line",
      "thumb_up",
      "```js",
      "const x = 1;    ",
      "```",
      "Google AI models may make mistakes, so double-check outputs.",
    ].join("\n");

    const cleaned = parser.cleanAiStudioResponse(raw, "Explain this code");
    expect(cleaned).toBe(["Answer line", "```js", "const x = 1;", "```"].join("\n"));
  });

  it("collapses redundant blank lines outside code blocks", () => {
    const raw = ["Model", "Line 1", "", "", "Line 2", "", ""].join("\n");
    expect(parser.cleanAiStudioResponse(raw)).toBe("Line 1\n\nLine 2");
  });
});

describe("extractModelKeywords", () => {
  it("extracts stable, meaningful tokens", () => {
    expect(parser.extractModelKeywords("gemini-3-pro-preview")).toEqual(["pro"]);
    expect(parser.extractModelKeywords("gemini-flash-lite-latest")).toEqual(["flash", "lite"]);
  });

  it("ignores empty or numeric-only tokens", () => {
    expect(parser.extractModelKeywords("")).toEqual([]);
    expect(parser.extractModelKeywords("gemini-2.5-preview")).toEqual([]);
  });
});

describe("buildAiStudioUrl", () => {
  it("returns base URL when model is absent", () => {
    expect(parser.buildAiStudioUrl(undefined)).toBe("https://aistudio.google.com/prompts/new_chat");
  });

  it("adds model param only for preview/latest ids", () => {
    expect(parser.buildAiStudioUrl("gemini-3-flash-preview")).toBe(
      "https://aistudio.google.com/prompts/new_chat?model=gemini-3-flash-preview",
    );
    expect(parser.buildAiStudioUrl("gemini-3-pro")).toBe(
      "https://aistudio.google.com/prompts/new_chat",
    );
  });

  it("handles model ids with dots (e.g. 3.1)", () => {
    expect(parser.buildAiStudioUrl("gemini-3.1-pro-preview")).toBe(
      "https://aistudio.google.com/prompts/new_chat?model=gemini-3.1-pro-preview",
    );
  });
});

describe("doesGenerateEntryMatchPrompt", () => {
  it("matches against parsed last user prompt in request body", () => {
    const entry = {
      requestBody: JSON.stringify([
        null,
        [
          [[[null, "old prompt"]], "user"],
          [[[null, "assistant text"]], "model"],
          [[[null, "latest prompt"]], "user"],
        ],
      ]),
    };

    expect(parser.doesGenerateEntryMatchPrompt(entry, "latest prompt")).toBe(true);
    expect(parser.doesGenerateEntryMatchPrompt(entry, "other")).toBe(false);
  });

  it("falls back to substring probe when body parsing fails", () => {
    const entry = { requestBody: "raw payload with expected phrase inside" };
    expect(parser.doesGenerateEntryMatchPrompt(entry, "expected phrase inside")).toBe(true);
  });
});

describe("hasRequiredCookies", () => {
  it("requires __Secure-1PSID cookie with a value", () => {
    expect(parser.hasRequiredCookies([{ name: "__Secure-1PSID", value: "abc" }])).toBe(true);
    expect(parser.hasRequiredCookies([{ name: "__Secure-1PSID", value: "" }])).toBe(false);
    expect(parser.hasRequiredCookies([{ name: "OTHER", value: "abc" }])).toBe(false);
  });
});
