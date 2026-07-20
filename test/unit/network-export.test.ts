import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const exporter = require("../../native/network-export.cjs");

const tempDirs: string[] = [];

async function tempDir() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "surf-network-export-test-"));
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("network export serialization", () => {
  const entries = [
    {
      id: "r-1",
      ts: 1700000000000,
      method: "POST",
      url: "https://example.test/api?q=surf",
      origin: "https://example.test",
      requestHeaders: { accept: "application/json", "content-type": "text/plain" },
      requestBody: "body",
      requestBodySize: 4,
      status: 201,
      statusText: "Created",
      responseHeaders: { "content-type": "application/json" },
      responseBody: '{"ok":true}',
      responseBodySize: 11,
      mimeType: "application/json",
      duration: 25,
      ttfb: 10,
      bodyCapture: { mode: "text", complete: true, capturedBytes: 11 },
      _requestId: "secret-request-id",
      _responseReceived: true,
      _loadingFinished: true,
    },
  ];

  it("strips internal fields from JSON and JSONL", () => {
    const json = JSON.parse(exporter.serializeNetworkExport(entries, "json"));
    expect(json[0]).not.toHaveProperty("_requestId");
    expect(json[0]).not.toHaveProperty("_responseReceived");
    expect(json[0]).not.toHaveProperty("_loadingFinished");
    const jsonl = exporter.serializeNetworkExport(entries, "jsonl");
    expect(jsonl.endsWith("\n")).toBe(true);
    expect(JSON.parse(jsonl.trim()).url).toBe(entries[0].url);
  });

  it("writes a valid compact HAR projection atomically with private permissions", async () => {
    const directory = await tempDir();
    const output = path.join(directory, "capture.har");
    await fs.writeFile(output, "old content");
    const result = exporter.writeNetworkExport(output, entries, "har");
    expect(result).toMatchObject({ path: output, format: "har", count: 1 });
    const har = JSON.parse(await fs.readFile(output, "utf8"));
    expect(har.log.version).toBe("1.2");
    expect(har.log.creator.name).toBe("surf-cli");
    expect(har.log.entries[0].request.method).toBe("POST");
    expect(har.log.entries[0].request.queryString).toEqual([{ name: "q", value: "surf" }]);
    expect(har.log.entries[0].request.postData.mimeType).toBe("text/plain");
    expect(har.log.entries[0].response.status).toBe(201);
    expect(har.log.entries[0].response.content._surfBodyCapture).toEqual({
      mode: "text",
      complete: true,
      capturedBytes: 11,
    });
    expect((await fs.stat(output)).mode & 0o777).toBe(0o600);
  });

  it("creates missing export parent directories", async () => {
    const directory = await tempDir();
    const output = path.join(directory, "nested", "capture.har");
    const result = exporter.writeNetworkExport(output, entries, "har");
    expect(result.path).toBe(output);
    expect(JSON.parse(await fs.readFile(output, "utf8")).log.entries).toHaveLength(1);
  });

  it("does not let __proto__ entries influence HAR fields", () => {
    const entry = JSON.parse('{"__proto__":{"url":"https://attacker.test"},"_requestId":"hidden"}');
    const har = JSON.parse(exporter.serializeNetworkExport([entry], "har"));
    expect(har.log.entries[0].request.url).toBe("");
    expect(JSON.stringify(har)).not.toContain("hidden");
  });

  it("marks encoded response bodies as base64 in HAR", () => {
    const har = JSON.parse(
      exporter.serializeNetworkExport(
        [{ ...entries[0], responseBody: "AAEC", responseBodyEncoding: "base64" }],
        "har",
      ),
    );
    expect(har.log.entries[0].response.content.encoding).toBe("base64");
  });

  it("rejects unsupported formats", () => {
    expect(() => exporter.serializeNetworkExport(entries, "xml")).toThrow(/unsupported/);
  });
});
