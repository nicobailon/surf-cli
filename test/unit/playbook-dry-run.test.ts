import { describe, expect, it } from "vitest";

const runtime = require("../../native/playbook-runtime.cjs");

const playbook = { id: "fixture", origins: ["https://example.test"] };

describe("surf use --dry-run preview", () => {
  it("lists an env header by name and never prints its value", () => {
    const preview = runtime.previewPlaybookOp({
      playbook,
      op: {
        id: "post",
        effect: "write",
        args: { action: { type: "string", required: true } },
        safety: { authorization: "explicit", duplicate: "transactional", key: ["action"] },
        run: [
          {
            using: "network",
            request: {
              method: "post",
              url: "https://example.test/api",
              query: { mode: "{{action}}" },
              headers: { "content-type": "application/json" },
              body: { action: "{{action}}" },
              authInputs: [{ env: "SURF_DRY_RUN_KEY", header: "X-Site-Key", required: true }],
            },
          },
        ],
      },
      args: { action: "same" },
      secrets: { SURF_DRY_RUN_KEY: "dummy-env-value" },
      env: {},
    });

    expect(preview).toEqual({
      playbook: "fixture",
      op: "post",
      effect: "write",
      strategy: "network",
      method: "POST",
      url: "https://example.test/api",
      query: { mode: "same" },
      headers: ["content-type", "X-Site-Key"],
      body: { action: "same" },
      allowedOrigins: ["https://example.test"],
    });
    expect(JSON.stringify(preview)).not.toContain("dummy-env-value");
  });

  it("prints a placeholder the record left as stored, with the refusal the run would give", () => {
    const preview = runtime.previewPlaybookOp({
      playbook,
      op: {
        id: "post",
        effect: "write",
        run: [
          {
            using: "network",
            request: { method: "POST", url: "https://example.test/api", body: "<request-body>" },
          },
        ],
      },
    });

    expect(preview).toMatchObject({ method: "POST", body: "<request-body>" });
    expect(preview.refused).toMatch(/body holds <request-body>/);
  });

  it("prints a workflow op's first step instead of a request", () => {
    const preview = runtime.previewPlaybookOp({
      playbook,
      op: {
        id: "search",
        effect: "read",
        args: { query: { type: "string", required: true } },
        run: [
          {
            using: "workflow",
            steps: [
              { cmd: "type", args: { selector: "#q", text: "{{query}}" } },
              { cmd: "key", args: { key: "Enter" } },
            ],
          },
        ],
      },
      args: { query: "surf" },
    });

    expect(preview).toEqual({
      playbook: "fixture",
      op: "search",
      effect: "read",
      strategy: "workflow",
      step: { cmd: "type", args: { selector: "#q", text: "surf" } },
      allowedOrigins: ["https://example.test"],
    });
  });
});
