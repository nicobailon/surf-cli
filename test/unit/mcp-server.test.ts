import { describe, expect, it } from "vitest";

const { TOOL_SCHEMAS } = require("../../native/mcp-server.cjs") as {
  TOOL_SCHEMAS: Record<
    string,
    { schema: Record<string, { safeParse(value: unknown): { success: boolean } }> }
  >;
};

describe("MCP file-backed tool schemas", () => {
  it("exposes fixed ChatGPT, Gemini, Kimi, and network export fields", () => {
    expect(Object.keys(TOOL_SCHEMAS.chatgpt.schema)).toEqual(
      expect.arrayContaining(["query", "model", "with-page", "file", "timeout"]),
    );
    expect(Object.keys(TOOL_SCHEMAS.gemini.schema)).toEqual(
      expect.arrayContaining([
        "query",
        "model",
        "with-page",
        "file",
        "edit-image",
        "generate-image",
        "output",
        "youtube",
        "aspect-ratio",
        "timeout",
      ]),
    );
    expect(TOOL_SCHEMAS.kimi.schema.query.safeParse(undefined).success).toBe(true);
    expect(TOOL_SCHEMAS.kimi.schema.validate.safeParse(true).success).toBe(true);
    expect(Object.keys(TOOL_SCHEMAS["network.export"].schema)).toEqual(
      expect.arrayContaining(["output", "jsonl", "har"]),
    );
  });
});
