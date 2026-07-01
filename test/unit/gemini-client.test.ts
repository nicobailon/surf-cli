import { afterEach, vi } from "vitest";
// @ts-expect-error - CommonJS module without type definitions
import * as geminiClient from "../../native/gemini-client.cjs";

const asChromeOutput = (value: string) => ({ output: JSON.stringify(value) });

const promptTyped = (code: string) => code.includes("document.execCommand('insertText'");
const baselineCollected = (code: string) => code.includes("return JSON.stringify(baselineKeys)");
const sendClicked = (code: string) => code.includes('button[aria-label="Send message"]');
const imagesPolled = (code: string) => code.includes("window.__surfGeminiBlobImageIndexes");

describe("gemini-client", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("runGeminiWebViaPage", () => {
    it("detects and extracts large blob-backed generated images without alt or class markers", async () => {
      vi.useFakeTimers();
      const seenScripts: string[] = [];
      const logs: string[] = [];

      const run = geminiClient.runGeminiWebViaPage({
        prompt: "generate a test image",
        model: "gemini-3-pro",
        timeoutMs: 10_000,
        log: (msg: string) => logs.push(msg),
        createTab: async () => ({ tabId: 123 }),
        closeTab: async () => ({ ok: true }),
        jsEval: async (_tabId: number, code: string) => {
          seenScripts.push(code);

          if (promptTyped(code)) {
            return asChromeOutput(JSON.stringify({ ok: true, len: 21 }));
          }

          if (baselineCollected(code)) {
            expect(code).toContain('url.startsWith("blob:")');
            expect(code).toContain('url.includes("gg-dl")');
            expect(code).not.toContain("alt");
            expect(code).not.toContain("className");
            return asChromeOutput(JSON.stringify([]));
          }

          if (sendClicked(code)) {
            return asChromeOutput("sent");
          }

          if (imagesPolled(code)) {
            expect(code).toContain('url.startsWith("blob:")');
            expect(code).toContain("canvas.toDataURL");
            expect(code).not.toContain("alt");
            expect(code).not.toContain("className");
            return asChromeOutput(
              JSON.stringify({
                images: [
                  {
                    url: "blob:https://gemini.google.com/generated-image",
                    blobIndex: 0,
                    type: "image/png",
                  },
                ],
                loading: false,
                text: "",
                turns: 1,
              }),
            );
          }

          if (code.includes("window.__surfGeminiBlobImages?.[0]")) {
            return asChromeOutput(
              JSON.stringify({
                chunk: "ZmFrZS1wbmc=",
                done: true,
                type: "image/png",
                url: "blob:https://gemini.google.com/generated-image",
              }),
            );
          }

          throw new Error(`Unexpected script: ${code}`);
        },
      });

      await vi.runAllTimersAsync();
      const result = await run;

      expect(result.images).toEqual([
        {
          url: "blob:https://gemini.google.com/generated-image",
          b64: "ZmFrZS1wbmc=",
          type: "image/png",
        },
      ]);
      expect(logs).toContain("Found 1 generated image(s)");
      expect(seenScripts.some((script) => script.includes("gg-dl"))).toBe(true);
    });

    it("excludes pre-existing large images before serializing blob candidates", async () => {
      vi.useFakeTimers();
      const baselineKey = "blob:https://gemini.google.com/baseline|1024x1024";

      const run = geminiClient.runGeminiWebViaPage({
        prompt: "generate a new image",
        model: "gemini-3-pro",
        timeoutMs: 10_000,
        createTab: async () => ({ tabId: 123 }),
        closeTab: async () => ({ ok: true }),
        jsEval: async (_tabId: number, code: string) => {
          if (promptTyped(code)) {
            return asChromeOutput(JSON.stringify({ ok: true, len: 20 }));
          }

          if (baselineCollected(code)) {
            return asChromeOutput(JSON.stringify([baselineKey]));
          }

          if (sendClicked(code)) {
            return asChromeOutput("sent");
          }

          if (imagesPolled(code)) {
            expect(code).toContain(`const baselineKeys = new Set(["${baselineKey}"])`);
            expect(code).toContain(".filter((img) => !baselineKeys.has(imageKey(img)))");
            expect(code.indexOf("!baselineKeys.has(imageKey(img))")).toBeLessThan(
              code.indexOf("canvas.toDataURL"),
            );
            return asChromeOutput(
              JSON.stringify({
                images: [],
                loading: false,
                text: "No new image was generated.",
                turns: 1,
              }),
            );
          }

          throw new Error(`Unexpected script: ${code}`);
        },
      });

      await vi.runAllTimersAsync();
      const result = await run;

      expect(result.images).toEqual([]);
      expect(result.text).toBe("No new image was generated.");
    });

    it("keeps existing gg-dl image URL download support", async () => {
      vi.useFakeTimers();
      const fetchUrl = vi.fn(async (url: string) => ({
        b64: url === "https://lh3.googleusercontent.com/gg-dl/generated" ? "Z2ctZGw=" : "",
        type: "image/jpeg",
      }));

      const run = geminiClient.runGeminiWebViaPage({
        prompt: "generate a test image",
        model: "gemini-3-pro",
        timeoutMs: 10_000,
        createTab: async () => ({ tabId: 123 }),
        closeTab: async () => ({ ok: true }),
        fetchUrl,
        jsEval: async (_tabId: number, code: string) => {
          if (promptTyped(code)) {
            return asChromeOutput(JSON.stringify({ ok: true, len: 21 }));
          }

          if (baselineCollected(code)) {
            return asChromeOutput(JSON.stringify([]));
          }

          if (sendClicked(code)) {
            return asChromeOutput("sent");
          }

          if (imagesPolled(code)) {
            return asChromeOutput(
              JSON.stringify({
                images: [{ url: "https://lh3.googleusercontent.com/gg-dl/generated" }],
                loading: false,
                text: "",
                turns: 1,
              }),
            );
          }

          throw new Error(`Unexpected script: ${code}`);
        },
      });

      await vi.runAllTimersAsync();
      const result = await run;

      expect(fetchUrl).toHaveBeenCalledWith("https://lh3.googleusercontent.com/gg-dl/generated");
      expect(result.images).toEqual([
        {
          url: "https://lh3.googleusercontent.com/gg-dl/generated",
          b64: "Z2ctZGw=",
          type: "image/jpeg",
        },
      ]);
    });
  });
});
