import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const exporter = require("../../native/network-export.cjs");
const { Buffer } = require("node:buffer");

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

  it("redacts secret headers and URL credentials in every format", () => {
    const secretEntry = {
      id: "r-2",
      ts: 1700000000000,
      method: "GET",
      url: "https://user:hunter2pw@example.test/api?access_token=tok123secret&q=1",
      tabUrl: "https://example.test/page?session=sess456secret",
      requestHeaders: {
        Authorization: "ResyAPI api_key=abc999secret",
        Cookie: "sid=cookie777secret",
        "X-Api-Key": "key888secret",
        accept: "*/*",
      },
      responseHeaders: {
        "Set-Cookie": "sid=setcookie555secret",
        "content-type": "application/json",
      },
      status: 200,
    };
    const secrets = [
      "hunter2pw",
      "tok123secret",
      "sess456secret",
      "abc999secret",
      "cookie777secret",
      "key888secret",
      "setcookie555secret",
    ];
    for (const format of ["json", "jsonl", "har"]) {
      const text = exporter.serializeNetworkExport([secretEntry], format);
      for (const secret of secrets) {
        expect(text, `${format} kept ${secret}`).not.toContain(secret);
      }
      expect(text).toContain("q=1");
      expect(text).toContain("*/*");
    }
    const har = JSON.parse(exporter.serializeNetworkExport([secretEntry], "har"));
    expect(har.log.entries[0].request.headers).toContainEqual({
      name: "Authorization",
      value: "<redacted>",
    });
    expect(har.log.entries[0].request.queryString).toContainEqual({
      name: "access_token",
      value: "<redacted>",
    });
    const plain = JSON.parse(
      exporter.serializeNetworkExport([{ id: "r-3", url: "https://example.test" }], "json"),
    );
    expect(plain[0].url).toBe("https://example.test");
  });

  it("redacts a secret header's value where a body echoes it, as httpbin /headers does", () => {
    const echo = {
      id: "r-4",
      method: "GET",
      url: "https://httpbin.test/headers",
      requestHeaders: { Authorization: "echoed-key-123", accept: "*/*" },
      responseBody: JSON.stringify({ headers: { Authorization: "echoed-key-123", Accept: "*/*" } }),
      status: 200,
    };
    for (const format of ["json", "jsonl", "har"]) {
      const text = exporter.serializeNetworkExport([echo], format);
      expect(text, format).not.toContain("echoed-key-123");
      expect(text, format).toContain("Accept");
    }
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

describe("secret-named fields in exported bodies", () => {
  const boundary = "----dummyboundary";
  const multipart = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="custname"',
    "",
    "dummy-golf",
    `--${boundary}`,
    'Content-Disposition: form-data; name="password"',
    "",
    "dummy-hotel",
    `--${boundary}--`,
    "",
  ].join("\r\n");
  const exported = [
    {
      id: "r-form",
      method: "POST",
      url: "https://example.test/post",
      requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
      requestBody: "custname=dummy-golf&user_password=dummy-hotel&api_key=dummy-india",
      responseHeaders: { "content-type": "application/json" },
      responseBody: JSON.stringify({
        form: { custname: "dummy-golf", user_password: "dummy-hotel" },
        access_token: "dummy-juliet",
      }),
    },
    {
      id: "r-multipart",
      method: "POST",
      url: "https://example.test/upload",
      requestHeaders: { "content-type": `multipart/form-data; boundary=${boundary}` },
      requestBody: multipart,
    },
    {
      id: "r-json",
      method: "POST",
      url: "https://example.test/login",
      requestHeaders: { "content-type": "application/json" },
      requestBody: JSON.stringify({ user: "dummy-golf", credentials: { password: "dummy-hotel" } }),
    },
  ];
  const secrets = ["dummy-hotel", "dummy-india", "dummy-juliet"];

  it.each(["json", "jsonl", "har"])("redacts their values and keeps the rest in %s", (format) => {
    const text = exporter.serializeNetworkExport(exported, format);
    for (const secret of secrets) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain("dummy-golf");
    expect(text).toContain("user_password=<redacted>");
    expect(text).toContain("custname");
  });

  it("keeps each body's shape", () => {
    const [form, upload, login] = exported.map(
      (entry) => exporter.publicEntry(entry) as Record<string, string>,
    );
    expect(form.requestBody).toBe(
      "custname=dummy-golf&user_password=<redacted>&api_key=<redacted>",
    );
    expect(JSON.parse(form.responseBody)).toEqual({
      form: { custname: "dummy-golf", user_password: "<redacted>" },
      access_token: "<redacted>",
    });
    expect(upload.requestBody).toBe(multipart.replace("dummy-hotel", "<redacted>"));
    expect(JSON.parse(login.requestBody)).toEqual({
      user: "dummy-golf",
      credentials: { password: "<redacted>" },
    });
  });

  it.each(["json", "jsonl", "har"])("keeps them as captured with --raw-bodies in %s", (format) => {
    const text = exporter.serializeNetworkExport(exported, format, { rawBodies: true });
    for (const secret of secrets) {
      expect(text).toContain(secret);
    }
  });
});

describe("secret-named fields in base64 response bodies", () => {
  const encoded = (text: string) => Buffer.from(text).toString("base64");
  const entry = (mimeType: string, text: string) => ({
    id: "r-b64",
    method: "GET",
    url: "https://example.test/api",
    responseHeaders: { "content-type": mimeType },
    mimeType,
    responseBodyEncoding: "base64",
    responseBody: encoded(text),
  });
  const decoded = (value: unknown) => Buffer.from(String(value), "base64").toString("utf8");

  it("decodes a text body, redacts it and encodes it again", () => {
    const json = exporter.publicEntry(
      entry("application/json", '{"token":"dummy-kilo","name":"dummy-lima"}'),
    );
    expect(JSON.parse(decoded(json.responseBody))).toEqual({
      token: "<redacted>",
      name: "dummy-lima",
    });
    expect(json.responseBodyEncoding).toBe("base64");
    const form = exporter.publicEntry(
      entry("application/x-www-form-urlencoded", "password=dummy-mike&user=dummy-lima"),
    );
    expect(decoded(form.responseBody)).toBe("password=<redacted>&user=dummy-lima");
  });

  it("leaves binary bodies and --raw-bodies exports as captured", () => {
    const image = entry("image/png", '{"token":"dummy-kilo"}');
    expect(exporter.publicEntry(image).responseBody).toBe(image.responseBody);
    const raw = entry("application/json", '{"token":"dummy-kilo"}');
    expect(exporter.publicEntry(raw, { rawBodies: true }).responseBody).toBe(raw.responseBody);
  });
});
