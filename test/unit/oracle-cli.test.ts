import { describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  composeAskRequest,
  parseOracleCommand,
  resolveOracleAttachment,
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

  it("maps one local attachment and explicit GitHub context for asks and follow-ups", () => {
    const ask = parseOracleCommand([
      "oracle",
      "ask",
      "review this",
      "--file",
      "/tmp/report.md",
      "--github",
    ]);
    const follow = parseOracleCommand([
      "oracle",
      "follow",
      "job-1",
      "challenge this",
      "--file",
      "/tmp/follow.md",
      "--github",
    ]);

    expect(ask).toMatchObject({ file: "/tmp/report.md", github: true });
    expect(follow).toMatchObject({ file: "/tmp/follow.md", github: true });
    expect(composeAskRequest(ask, null)).toEqual({
      prompt: "review this",
      file: "/tmp/report.md",
      github: true,
    });
    expect(composeAskRequest(follow, null)).toEqual({
      prompt: "challenge this",
      file: "/tmp/follow.md",
      github: true,
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

  it("validates Oracle attachment access before dispatch", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "surf-oracle-cli-"));
    const attachment = path.join(root, "report.md");
    fs.writeFileSync(attachment, "report");
    try {
      await expect(resolveOracleAttachment("report.md", root)).resolves.toBe(attachment);
      await expect(resolveOracleAttachment("missing.md", root)).rejects.toMatchObject({
        code: "attachment_file_access",
        message: expect.stringContaining("Oracle attachment file access failed"),
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
