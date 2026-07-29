import { describe, expect, it } from "vitest";

const {
  composeAskRequest,
  parseOracleCommand,
  shapeOracleError,
} = require("../../native/oracle-cli.cjs");

describe("oracle CLI helpers", () => {
  it("parses repeatable context files and ask options", () => {
    expect(
      parseOracleCommand([
        "oracle",
        "ask",
        "review this",
        "--files",
        "src/**/*.ts",
        "--files",
        "package.json",
        "--model",
        "pro",
        "--effort",
        "extended",
        "--detach",
        "--allow-sensitive",
        "--json",
      ]),
    ).toMatchObject({
      command: "ask",
      prompt: "review this",
      files: ["src/**/*.ts", "package.json"],
      model: "pro",
      effort: "extended",
      detach: true,
      allowSensitive: true,
      json: true,
    });
  });

  it("maps follow arguments and bundle context to one oracle.ask request", () => {
    const spec = parseOracleCommand([
      "oracle",
      "follow",
      "job-1",
      "challenge the conclusion",
      "--model",
      "thinking",
    ]);
    const contextManifest = { files: [{ path: "src/a.ts", bytes: 12 }] };
    const request = composeAskRequest(spec, {
      mode: "bundle",
      envelope: "Attachment evidence envelope",
      bundlePath: "/tmp/context.txt",
      manifest: contextManifest,
    });

    expect(request).toEqual({
      prompt: "challenge the conclusion\n\nAttachment evidence envelope",
      model: "thinking",
      contextManifest,
      bundlePath: "/tmp/context.txt",
      follow: "job-1",
    });
  });

  it("composes inline evidence directly into the prompt", () => {
    const request = composeAskRequest(
      { prompt: "review this" },
      { mode: "inline", envelope: "Inline evidence", manifest: {} },
    );

    expect(request).toEqual({
      prompt: "review this\n\nInline evidence",
      contextManifest: {},
    });
  });

  it("preserves structured error codes and adds a recovery command", () => {
    const error = Object.assign(new Error("connection closed"), {
      code: "timeout",
      jobId: "job-1",
      recoverable: true,
    });

    expect(shapeOracleError(error)).toEqual({
      error: {
        code: "timeout",
        message: "connection closed\nRecover with: surf oracle result job-1",
      },
      jobId: "job-1",
    });
  });
});
