/**
 * E2E tests for ChatGPT CloakBrowser integration.
 *
 * These tests require a valid Chrome profile with ChatGPT session cookies.
 * They are gated behind environment variables:
 *
 *   SURF_E2E_CLOAK_CHATGPT_LOCAL=1             - Enable instant mode tests
 *   SURF_E2E_CLOAK_CHATGPT_PRO_LOCAL=1         - Enable Pro mode tests (headless, metadata-only trace)
 *   SURF_E2E_CLOAK_CHATGPT_PRO_HEADED_LOCAL=1  - Enable Pro mode headed tests (full trace extraction)
 *
 * Run via npm scripts:
 *   npm run test:e2e:cloak:local        - Run instant mode tests
 *   npm run test:e2e:cloak:local:pro    - Run instant + Pro mode tests
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { isCloakBrowserAvailable, queryWithCloakBrowser } =
  require("../../native/chatgpt-cloak-bridge.cjs") as {
    isCloakBrowserAvailable: () => boolean;
    queryWithCloakBrowser: (opts: {
      query: string;
      model: string;
      timeout: number;
      headed?: boolean;
    }) => Promise<{
      response: string;
      model: string;
      backend: string;
      thinkingTrace?: {
        thoughts?: Array<{
          summary?: string;
          content?: string;
          finished?: boolean;
        }>;
        durationSec?: number | null;
        recapText?: string | null;
        truncated?: boolean;
      };
    }>;
  };

const RUN_LOCAL = process.env.SURF_E2E_CLOAK_CHATGPT_LOCAL === "1";
const RUN_LOCAL_PRO = process.env.SURF_E2E_CLOAK_CHATGPT_PRO_LOCAL === "1";
const RUN_LOCAL_PRO_HEADED = process.env.SURF_E2E_CLOAK_CHATGPT_PRO_HEADED_LOCAL === "1";

describe("e2e: chatgpt cloak local", () => {
  it("answers a trivial prompt in instant mode", { timeout: 45_000 }, async () => {
    if (!RUN_LOCAL) {
      return;
    }

    expect(isCloakBrowserAvailable()).toBe(true);

    const result = await queryWithCloakBrowser({
      query: "Reply with only the number: 2+2",
      model: "instant",
      timeout: 30,
    });

    expect(result.backend).toBe("cloak");
    expect((result.model || "").toLowerCase()).toMatch(/gpt-5\.3|instant/);
    expect(result.response).toMatch(/\b4\b/);
  });

  it("responds in pro mode (headless, metadata-only trace)", { timeout: 180_000 }, async () => {
    if (!RUN_LOCAL_PRO) {
      return;
    }

    expect(isCloakBrowserAvailable()).toBe(true);

    const result = await queryWithCloakBrowser({
      query: "Think carefully, then reply with only the number for 12*13.",
      model: "pro",
      timeout: 180,
    });

    expect(result.backend).toBe("cloak");
    expect((result.model || "").toLowerCase()).toMatch(/gpt-5\.4-pro|pro/);
    expect(result.response).toMatch(/\b156\b/);
    // In headless mode, thinkingTrace may be present but with limited content
    // (React fiber extraction is no longer viable, full trace requires headed mode)
    if (result.thinkingTrace) {
      expect(typeof result.thinkingTrace).toBe("object");
    }
  });

  it("captures full thinkingTrace in pro mode (headed)", { timeout: 180_000 }, async () => {
    if (!RUN_LOCAL_PRO_HEADED) {
      return;
    }

    expect(isCloakBrowserAvailable()).toBe(true);

    const result = await queryWithCloakBrowser({
      query: "Think carefully, then reply with only the number for 12*13.",
      model: "pro",
      timeout: 180,
      headed: true,
    });

    expect(result.backend).toBe("cloak");
    expect((result.model || "").toLowerCase()).toMatch(/gpt-5\.4-pro|pro/);
    expect(result.response).toMatch(/\b156\b/);
    // In headed mode, full thinkingTrace should be captured via flyout
    expect(result.thinkingTrace).toBeTruthy();
    expect(Array.isArray(result.thinkingTrace?.thoughts)).toBe(true);
    // durationSec can be null when OpenAI doesn't provide timing
    expect(
      result.thinkingTrace?.durationSec === null ||
        typeof result.thinkingTrace?.durationSec === "number",
    ).toBe(true);
    expect(typeof result.thinkingTrace?.recapText).toBe("string");
  });
});
