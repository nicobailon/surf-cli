import { afterEach, describe, expect, it, vi } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSemanticEvaluator } = require("../../native/semantic-evaluator.cjs");

const accountId = "0123456789abcdef0123456789abcdef";
const roots: string[] = [];

function emptyConfigEnv(extra: Record<string, string> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "surf-semantic-evaluator-"));
  roots.push(root);
  return { XDG_CONFIG_HOME: root, APPDATA: root, ...extra };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("semantic evaluator factory", () => {
  it("names the exact fix when Clef has no Cloudflare credentials", () => {
    const fetch = vi.fn();
    for (const model of ["clef", "clef-flash"]) {
      expect(() => createSemanticEvaluator({ model, env: emptyConfigEnv(), fetch })).toThrow(
        expect.objectContaining({
          code: "provider_not_configured",
          message:
            "Clef needs Cloudflare credentials: set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, or run: surf semantic auth set --provider cloudflare",
        }),
      );
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("names the exact fix when Jev has no TypeSafe key", () => {
    expect(() => createSemanticEvaluator({ model: "jev-1.13.0", env: emptyConfigEnv() })).toThrow(
      expect.objectContaining({
        code: "provider_not_configured",
        message:
          "Jev needs a TypeSafe API key: set TYPESAFE_API_KEY, or run: surf semantic auth set --provider typesafe",
      }),
    );
  });

  it("routes Clef to Workers AI and sums provider calls and latency, including failures", async () => {
    let clock = 0;
    const fetch = vi.fn(async (_url: string, _init: unknown) => {
      clock += 40;
      if (fetch.mock.calls.length === 2) {
        return new Response("{}", { status: 503 });
      }
      return new Response(
        JSON.stringify({ success: true, result: { model: "clef", answers: {}, usage: {} } }),
      );
    });
    const evaluator = createSemanticEvaluator({
      model: "clef",
      env: { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: "fake-token" },
      fetch,
      now: () => clock,
    });

    await evaluator.evaluate({}, {}, {});
    await expect(evaluator.evaluate({}, {}, {})).rejects.toMatchObject({
      code: "provider_unavailable",
    });

    expect(fetch.mock.calls[0][0]).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/cloudflare/clef`,
    );
    expect(evaluator.summary()).toEqual({
      provider: "cloudflare",
      model: "clef",
      providerCalls: 2,
      providerLatencyMs: 80,
    });
  });
});
