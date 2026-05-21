import { vi } from "vitest";
// @ts-expect-error - CommonJS module without type definitions
import * as geminiClient from "../../native/gemini-client.cjs";

describe("gemini-client", () => {
  describe("runGeminiWebViaPage", () => {
    it("detects and returns blob-backed Gemini generated images", async () => {
      vi.useFakeTimers();
      const seenScripts: string[] = [];
      const logs: string[] = [];

      const asChromeOutput = (value: string) => ({ output: JSON.stringify(value) });

      const run = geminiClient.runGeminiWebViaPage({
        prompt: "generate a test image",
        model: "gemini-3-pro",
        timeoutMs: 10_000,
        log: (msg: string) => logs.push(msg),
        createTab: async () => ({ tabId: 123 }),
        closeTab: async () => ({ ok: true }),
        jsEval: async (_tabId: number, code: string) => {
          seenScripts.push(code);

          if (code.includes("document.execCommand('insertText'")) {
            return asChromeOutput(JSON.stringify({ ok: true, len: 21 }));
          }

          if (code.includes("return String(generatedImgs.length)")) {
            expect(code).toContain('src.startsWith("blob:")');
            return asChromeOutput("0");
          }

          if (code.includes('button[aria-label="Send message"]')) {
            return asChromeOutput("sent");
          }

          if (code.includes("const images = await Promise.all")) {
            expect(code).toContain('src.startsWith("blob:")');
            expect(code).toContain("canvas.toDataURL");
            return asChromeOutput(JSON.stringify({
              images: [{
                url: "blob:https://gemini.google.com/generated-image",
                blobIndex: 0,
                type: "image/png",
              }],
              loading: false,
              text: "",
              turns: 1,
            }));
          }

          if (code.includes("window.__surfGeminiBlobImages?.[0]")) {
            return asChromeOutput(JSON.stringify({
              chunk: "ZmFrZS1wbmc=",
              done: true,
              type: "image/png",
              url: "blob:https://gemini.google.com/generated-image",
            }));
          }

          throw new Error(`Unexpected script: ${code}`);
        },
      });

      await vi.runAllTimersAsync();
      const result = await run;
      vi.useRealTimers();

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
  });
});
