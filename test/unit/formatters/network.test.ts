// @ts-expect-error - CommonJS module without type definitions
import * as network from "../../../native/formatters/network.cjs";

const { execFile } = require("node:child_process");
const { mkdtemp, rm } = require("node:fs/promises");
const { createServer } = require("node:http");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { promisify } = require("node:util");

describe("network formatters", () => {
  describe("formatSize", () => {
    it("returns dash for undefined/null", () => {
      expect(network.formatSize(undefined)).toBe("-");
      expect(network.formatSize(null)).toBe("-");
    });

    it("formats bytes", () => {
      expect(network.formatSize(0)).toBe("0B");
      expect(network.formatSize(512)).toBe("512B");
      expect(network.formatSize(1023)).toBe("1023B");
    });

    it("formats kilobytes", () => {
      expect(network.formatSize(1024)).toBe("1.0K");
      expect(network.formatSize(1536)).toBe("1.5K");
      expect(network.formatSize(1024 * 100)).toBe("100.0K");
    });

    it("formats megabytes", () => {
      expect(network.formatSize(1024 * 1024)).toBe("1.0M");
      expect(network.formatSize(1024 * 1024 * 2.5)).toBe("2.5M");
    });
  });

  describe("formatDuration", () => {
    it("returns dash for undefined/null", () => {
      expect(network.formatDuration(undefined)).toBe("-");
      expect(network.formatDuration(null)).toBe("-");
    });

    it("formats milliseconds", () => {
      expect(network.formatDuration(0)).toBe("0ms");
      expect(network.formatDuration(500)).toBe("500ms");
      expect(network.formatDuration(999)).toBe("999ms");
    });

    it("formats seconds", () => {
      expect(network.formatDuration(1000)).toBe("1.0s");
      expect(network.formatDuration(1500)).toBe("1.5s");
      expect(network.formatDuration(5000)).toBe("5.0s");
    });
  });

  describe("getContentTypeShort", () => {
    it("returns dash for empty input", () => {
      expect(network.getContentTypeShort(undefined)).toBe("-");
      expect(network.getContentTypeShort(null)).toBe("-");
      expect(network.getContentTypeShort("")).toBe("-");
    });

    it("recognizes common content types", () => {
      expect(network.getContentTypeShort("application/json")).toBe("json");
      expect(network.getContentTypeShort("text/html")).toBe("html");
      expect(network.getContentTypeShort("application/javascript")).toBe("js");
      expect(network.getContentTypeShort("text/css")).toBe("css");
      expect(network.getContentTypeShort("image/png")).toBe("img");
      expect(network.getContentTypeShort("font/woff2")).toBe("font");
      expect(network.getContentTypeShort("application/xml")).toBe("xml");
      expect(network.getContentTypeShort("text/plain")).toBe("text");
    });

    it("handles content types with charset", () => {
      expect(network.getContentTypeShort("application/json; charset=utf-8")).toBe("json");
      expect(network.getContentTypeShort("text/html; charset=utf-8")).toBe("html");
    });
  });

  describe("formatCompact", () => {
    it("returns message for empty entries", () => {
      expect(network.formatCompact([])).toBe("No network requests captured");
      expect(network.formatCompact(null)).toBe("No network requests captured");
      expect(network.formatCompact(undefined)).toBe("No network requests captured");
    });

    it("formats entries as table", () => {
      const entries = [
        {
          requestId: "req-12345678",
          method: "GET",
          status: 200,
          url: "https://example.com/api/test",
          contentType: "application/json",
          responseSize: 1024,
          duration: 150,
        },
      ];

      const output = network.formatCompact(entries);
      expect(output).toContain("req-1234");
      expect(output).toContain("GET");
      expect(output).toContain("200");
      expect(output).toContain("json");
      expect(output).toContain("1.0K");
      expect(output).toContain("150ms");
      expect(output).toContain("https://example.com/api/test");
      expect(output).toContain("Total: 1 requests");
    });
  });

  describe("formatCurl", () => {
    it("returns empty string for empty entry", () => {
      expect(network.formatCurl(null)).toBe("");
      expect(network.formatCurl(undefined)).toBe("");
    });

    it("formats basic GET request", () => {
      const entry = {
        method: "GET",
        url: "https://example.com/api",
      };
      expect(network.formatCurl(entry)).toBe("curl -g -X GET 'https://example.com/api'");
    });

    it("formats POST with headers and body", () => {
      const entry = {
        method: "POST",
        url: "https://example.com/api",
        requestHeaders: {
          "Content-Type": "application/json",
          Authorization: "Bearer token123",
        },
        requestBody: '{"key":"value"}',
      };

      const curl = network.formatCurl(entry);
      expect(curl).toContain("curl -g -X POST");
      expect(curl).toContain("-H 'Content-Type: application/json'");
      expect(curl).toContain("-H 'Authorization: Bearer token123'");
      expect(curl).toContain('--data-raw \'{"key":"value"}\'');
    });

    it("turns off URL globbing so brackets and braces reach the server", () => {
      expect(
        network.formatCurl({ method: "GET", url: "https://example.com/a?filter[name]=x&ids[]=1" }),
      ).toBe("curl -g -X GET 'https://example.com/a?filter[name]=x&ids[]=1'");
      expect(network.formatCurl({ method: "GET", url: 'https://example.com/a?q={"a":1}' })).toBe(
        "curl -g -X GET 'https://example.com/a?q={\"a\":1}'",
      );
    });

    it("sends a body starting with @ as text, not a file", () => {
      expect(
        network.formatCurl({
          method: "POST",
          url: "https://example.com/api",
          requestBody: "@/etc/passwd",
        }),
      ).toBe("curl -g -X POST 'https://example.com/api' \\\n  --data-raw '@/etc/passwd'");
    });

    it("prints HEAD as -I so curl doesn't wait for a body", () => {
      expect(network.formatCurl({ method: "HEAD", url: "https://example.com/api" })).toBe(
        "curl -g -I 'https://example.com/api'",
      );
    });

    it("runs in sh and sends one request with the URL and body byte-exact", async () => {
      const seen: Array<{ method: string; url: string; body: string }> = [];
      const server = createServer((req: any, res: any) => {
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => {
          body += chunk;
        });
        req.on("end", () => {
          seen.push({ method: req.method, url: req.url, body });
          res.writeHead(200, { "content-type": "text/plain", "content-length": "2" });
          res.end(req.method === "HEAD" ? undefined : "ok");
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const home = await mkdtemp(join(tmpdir(), "surf-curl-"));
      const run = (entry: Record<string, unknown>) =>
        promisify(execFile)("sh", ["-c", network.formatCurl(entry)], {
          timeout: 5000,
          env: {
            PATH: process.env.PATH,
            HOME: home,
            CURL_HOME: home,
            NO_PROXY: "*",
            no_proxy: "*",
          },
        });
      try {
        const { port } = server.address();
        const path = "/p?filter[name]=x&ids[]=1&r=[1-3]&ids={1,2}&q={\"a\":1}&s='it''s'";
        const body = "@/etc/passwd {1,2} [1-3] 'quoted'";
        await run({
          method: "POST",
          url: `http://127.0.0.1:${port}${path}`,
          requestHeaders: { "Content-Type": "text/plain" },
          requestBody: body,
        });
        expect(seen).toEqual([{ method: "POST", url: path, body }]);

        seen.length = 0;
        await run({ method: "HEAD", url: `http://127.0.0.1:${port}/head` });
        expect(seen).toEqual([{ method: "HEAD", url: "/head", body: "" }]);
      } finally {
        await new Promise((resolve) => server.close(resolve));
        await rm(home, { recursive: true, force: true });
      }
    });
  });
});
