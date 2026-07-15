import { describe, expect, it } from "vitest";

const { TOOL_SCHEMAS } = require("../../native/mcp-server.cjs") as {
  TOOL_SCHEMAS: Record<string, { schema: Record<string, unknown> }>;
};

describe("MCP file-backed tool schemas", () => {
  it("exposes fixed ChatGPT, Gemini, and network export fields", () => {
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
    expect(Object.keys(TOOL_SCHEMAS["network.export"].schema)).toEqual(
      expect.arrayContaining(["output", "jsonl", "har"]),
    );
  });
});
