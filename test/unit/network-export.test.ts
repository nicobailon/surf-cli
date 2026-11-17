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

describe("network export of env-backed and echoed header values", () => {
  // Dummy values, built from parts so no literal here reads as a credential.
  const SITE_KEY = ["dummy", "site", "key", "9"].join("-");
  const AUTH = ["dummy", 'au"th', "9\\x"].join("-");
  const entry = {
    id: "r-9",
    method: "GET",
    url: "https://example.test/api",
    requestHeaders: { Authorization: AUTH, "X-Site-Key": SITE_KEY, accept: "*/*" },
    responseHeaders: { "content-type": "application/json", "x-echo-auth": `seen ${AUTH}` },
    responseBody: JSON.stringify({ auth: AUTH, siteKey: SITE_KEY }),
    status: 200,
  };
  const escaped = JSON.stringify(AUTH).slice(1, -1);

  it("redacts an Authorization value a body echoes JSON-escaped, and a response header's echo", () => {
    for (const format of ["json", "jsonl", "har"]) {
      const text = exporter.serializeNetworkExport([entry], format);
      expect(text, format).not.toContain(escaped);
      expect(text, format).not.toContain(JSON.stringify(escaped).slice(1, -1));
      expect(text, format).not.toContain("dummy-au");
      expect(text, format).toContain("x-echo-auth");
    }
  });

  it("redacts a header ops read from the environment, where it is sent and echoed", () => {
    for (const format of ["json", "jsonl", "har"]) {
      const text = exporter.serializeNetworkExport([entry], format, {
        secretHeaders: ["x-site-key"],
      });
      expect(text, format).not.toContain(SITE_KEY);
      expect(text, format).toContain("X-Site-Key");
    }
  });

  it("finds the env-backed headers of saved ops and keeps their values out of a record's HAR", async () => {
    const playbooks = require("../../native/playbooks.cjs");
    const authoring = require("../../native/playbook-authoring.cjs");
    const records = require("../../native/playbook-records.cjs");
    const cwd = await tempDir();
    const home = await tempDir();
    const root = await tempDir();
    const directory = path.join(cwd, ".surf", "playbooks", "shop");
    await fs.mkdir(path.join(directory, "ops"), { recursive: true });
    await fs.writeFile(
      path.join(directory, "playbook.json"),
      JSON.stringify({ id: "shop", version: "1.0.0", origins: [] }),
    );
    const request = {
      method: "GET",
      url: "https://example.test/api",
      authInputs: [{ env: "SHOP_SITE_KEY", header: "X-Site-Key" }],
    };
    await fs.writeFile(
      path.join(directory, "ops", "items.json"),
      JSON.stringify({ id: "items", effect: "read", run: [{ using: "network", request }] }),
    );
    expect(playbooks.envBackedHeaders({ cwd, home })).toContain("x-site-key");

    const record = records.startRecord({
      site: "shop",
      op: "items",
      tabId: 1,
      network: true,
      root,
    });
    records.attachNetworkTrace(record.id, [entry], root, {
      capture: { active: true, interruptions: [], dropped: 0 },
    });
    const output = path.join(cwd, "out", "trace.har");
    authoring.exportRecordHar(record.id, output, root, { cwd, home });
    const har = await fs.readFile(output, "utf8");
    expect(har).toContain("X-Site-Key");
    expect(har).not.toContain(SITE_KEY);
  });
});

describe("network export of quoted and escaped header values", () => {
  // Dummy values, built from parts so no literal here reads as a credential.
  const TOKEN = ["dummy", "plain", "key", "9"].join("-");
  const QUOTED = ["dummy", 'quo"ted', "va\\lue", "9"].join("-");
  const spellings = (value: string) => {
    const once = JSON.stringify(value).slice(1, -1);
    return [value, once, JSON.stringify(once).slice(1, -1), encodeURIComponent(value)];
  };

  it.each([TOKEN, QUOTED])(
    "redacts a quoted auth parameter (%s) wherever it is echoed",
    (value) => {
      const once = JSON.stringify(value).slice(1, -1);
      const entry = {
        id: "r-q",
        method: "GET",
        url: "https://example.test/api",
        requestHeaders: { Authorization: `ResyAPI api_key="${once}"` },
        responseHeaders: { "x-echo": value },
        responseBody: JSON.stringify({ token: value, nested: JSON.stringify({ token: value }) }),
        status: 200,
      };
      for (const format of ["json", "jsonl", "har"]) {
        const text = exporter.serializeNetworkExport([entry], format);
        for (const spelling of spellings(value)) {
          expect(text, format).not.toContain(spelling);
        }
        expect(text, format).not.toContain("dummy");
      }
    },
  );
});

describe("a record's trace and its HAR, when a response echoes a secret header", () => {
  const TOKEN = ["dummy", "plain", "auth", "10"].join("-");
  const QUOTED = ["dummy", 'quo"ted', "va\\lue", "10"].join("-");

  it.each([TOKEN, QUOTED])("keep %s out of every file, the echo included", async (value) => {
    const authoring = require("../../native/playbook-authoring.cjs");
    const records = require("../../native/playbook-records.cjs");
    const root = await tempDir();
    const home = await tempDir();
    const record = records.startRecord({
      site: "shop",
      op: "items",
      tabId: 1,
      network: true,
      includeInputValues: true,
      root,
    });
    records.attachNetworkTrace(
      record.id,
      [
        {
          id: "r-1",
          method: "POST",
          // httpbin's /response-headers takes the header to echo in the query.
          url: `https://example.test/response-headers?X-Echo=${encodeURIComponent(`Bearer ${value}`)}`,
          requestHeaders: { Authorization: `Bearer ${value}`, accept: "*/*" },
          requestBody: JSON.stringify({ echo: value }),
          responseHeaders: { "x-echo": `Bearer ${value}`, "content-type": "application/json" },
          status: 200,
        },
      ],
      root,
      { capture: { active: true, interruptions: [], dropped: 0 } },
    );
    const output = path.join(root, "export", "trace.har");
    authoring.exportRecordHar(record.id, output, root, { cwd: home, home });
    const files = (await fs.readdir(root, { recursive: true }))
      .map((name: string) => path.join(root, name))
      .filter((file: string) => !file.endsWith(path.sep));
    let checked = 0;
    for (const file of files) {
      if (!(await fs.stat(file)).isFile()) {
        continue;
      }
      checked++;
      expect(await fs.readFile(file, "utf8"), file).not.toContain("dummy");
    }
    expect(checked).toBeGreaterThan(1);
    expect(await fs.readFile(output, "utf8")).toContain("x-echo");
  });
});

describe("a quoted auth parameter echoed in a JSON body", () => {
  const PLAIN = ["dummy", "resy", "key", "15"].join("-");
  const QUOTED = ["dummy", 'quo"ted', "va\\lue", "15"].join("-");
  // The header quotes the value and escapes its quotes and backslashes, as an auth parameter does.
  const header = (value: string) => `ResyAPI api_key="${value.replace(/["\\]/g, "\\$&")}"`;
  const body = (value: string) => JSON.stringify({ token: value, n: 1 });

  it.each([PLAIN, QUOTED])("keeps the export's body valid JSON without %s", (value) => {
    const entry = exporter.publicEntry({
      id: "r-1",
      method: "GET",
      url: "https://example.test/api",
      requestHeaders: { Authorization: header(value) },
      responseBody: body(value),
    });
    expect(entry.responseBody).not.toContain("dummy");
    expect(JSON.parse(entry.responseBody)).toEqual({ token: "<redacted>", n: 1 });
  });

  it.each([PLAIN, QUOTED])("keeps a record trace's body valid JSON without %s", async (value) => {
    const records = require("../../native/playbook-records.cjs");
    const root = await tempDir();
    const record = records.startRecord({
      site: "shop",
      op: "items",
      tabId: 1,
      network: true,
      includeInputValues: true,
      root,
    });
    records.attachNetworkTrace(
      record.id,
      [
        {
          id: "r-1",
          method: "POST",
          url: "https://example.test/api",
          requestHeaders: { Authorization: header(value), "content-type": "application/json" },
          requestBody: body(value),
          status: 200,
        },
      ],
      root,
      { capture: { active: true, interruptions: [], dropped: 0 } },
    );
    const trace = await fs.readFile(
      path.join(root, "records", record.id, "network", "trace.json"),
      "utf8",
    );
    expect(trace).not.toContain("dummy");
    expect(JSON.parse(JSON.parse(trace).entries[0].requestBody)).toEqual({
      token: "<redacted>",
      n: 1,
    });
  });
});

describe("echo redaction that keeps an export's structure", () => {
  // Dummy values, built from parts so no literal here reads as a credential.
  const LONG = ["dummy", "long", "key", "20"].join("-");
  const QUOTED = ["dummy", 'quo"ted', "va\\lue", "20"].join("-");
  const quote = (value: string) => `"${value.replace(/["\\]/g, "\\$&")}"`;
  const spellings = (value: string) => {
    const once = JSON.stringify(value).slice(1, -1);
    return [value, once, JSON.stringify(once).slice(1, -1), encodeURIComponent(value)];
  };

  it("redacts a body key that is a long or a quoted secret, and numbers the collisions", () => {
    const entry = {
      id: "r-k",
      method: "POST",
      url: "https://example.test/api",
      requestHeaders: { Authorization: `Bearer ${LONG}`, "x-api-key": QUOTED },
      requestBody: JSON.stringify({
        [LONG]: "ok",
        "<redacted>": "kept",
        [QUOTED]: { n: 1 },
        page: 2,
      }),
      responseBody: JSON.stringify([{ [QUOTED]: "ok" }]),
    };
    for (const format of ["json", "jsonl", "har"]) {
      const text = exporter.serializeNetworkExport([entry], format);
      for (const value of [LONG, QUOTED]) {
        for (const spelling of spellings(value)) {
          expect(text, format).not.toContain(spelling);
        }
      }
      expect(text, format).not.toContain("dummy");
    }
    const kept = exporter.publicEntry(entry);
    expect(JSON.parse(kept.requestBody)).toEqual({
      "<redacted-2>": "ok",
      "<redacted>": "kept",
      "<redacted-3>": { n: 1 },
      page: 2,
    });
    expect(JSON.parse(kept.responseBody)).toEqual([{ "<redacted>": "ok" }]);
  });

  it("keeps a key that only holds a secret, or equals one under 4 characters", () => {
    const kept = exporter.publicEntry({
      id: "r-k2",
      url: "https://example.test/api",
      requestHeaders: { "x-csrf-token": "abc" },
      requestBody: JSON.stringify({ abc: "abc", abcd: 1 }),
    });
    expect(JSON.parse(kept.requestBody)).toEqual({ abc: "<redacted>", abcd: 1 });
  });

  it("redacts a long secret echoed in the entry's URL, keeping its query names", () => {
    const kept = exporter.publicEntry({
      id: "r-u",
      url: `https://example.test/api?echo=${encodeURIComponent(LONG)}&page=2`,
      requestHeaders: { Authorization: `Bearer ${LONG}` },
    });
    expect(kept.url).toBe("https://example.test/api?echo=<redacted>&page=2");
  });

  it.each(["v", "id", "true"])(
    "redacts a short quoted auth parameter (%s) as a whole JSON string or query value",
    (value) => {
      const kept = exporter.publicEntry({
        id: "r-s",
        url: "https://example.test/api",
        requestHeaders: { Authorization: `ResyAPI api_key=${quote(value)}` },
        requestBody: `key=${value}&page=2`,
        responseBody: JSON.stringify({ key: value, note: `${value} inside`, ok: true, n: 1 }),
      });
      expect(JSON.parse(kept.responseBody)).toEqual({
        key: "<redacted>",
        note: `${value} inside`,
        ok: true,
        n: 1,
      });
      expect(kept.requestBody).toBe("key=<redacted>&page=2");
    },
  );

  it.each([
    ["a comma", ["dummy", "com,ma", "21"].join("-")],
    ["a semicolon", ["dummy", "semi;colon", "21"].join("-")],
    ["an escaped quote", ["dummy", 'esc"aped', "21"].join("-")],
    ["a comma and a short tail", ["x", "y"].join(",")],
  ])("parses a quoted auth parameter holding %s whole", (_label, value) => {
    const kept = exporter.publicEntry({
      id: "r-p",
      url: "https://example.test/api",
      requestHeaders: { Authorization: `ResyAPI api_key=${quote(value)}, realm="shop"` },
      responseBody: JSON.stringify({ token: value, realm: "shop", n: 1 }),
    });
    expect(JSON.parse(kept.responseBody)).toEqual({
      token: "<redacted>",
      realm: "<redacted>",
      n: 1,
    });
    for (const spelling of spellings(value)) {
      expect(kept.responseBody).not.toContain(spelling);
    }
  });

  it("redacts a short auth parameter in a JSON body held as a string, as httpbin's data echoes it", () => {
    const sentBody = JSON.stringify({ echo: "v", n: 1 });
    const kept = exporter.publicEntry({
      id: "r-d",
      url: "https://example.test/anything",
      requestHeaders: { Authorization: 'ResyAPI api_key="v"' },
      responseBody: JSON.stringify({ data: sentBody, json: JSON.parse(sentBody) }, null, 2),
    });
    const echoed = JSON.parse(kept.responseBody);
    expect(JSON.parse(echoed.data)).toEqual({ echo: "<redacted>", n: 1 });
    expect(echoed.json).toEqual({ echo: "<redacted>", n: 1 });
  });

  it("redacts a whole form value that equals a short numeric secret, and leaves other numbers", () => {
    const code = ["123", "4567"].join("");
    const kept = exporter.publicEntry({
      id: "r-n",
      url: "https://example.test/api",
      requestHeaders: { "x-csrf-token": code },
      requestBody: `code=${code}&page=1&ref=${code}9`,
    });
    expect(kept.requestBody).toBe(`code=<redacted>&page=1&ref=${code}9`);
  });

  it("treats a body as a form only by its strict shape, so markup keeps the whole-token rule", () => {
    const kept = exporter.publicEntry({
      id: "r-x",
      url: "https://example.test/api",
      requestHeaders: { Cookie: ["lang", "en"].join("=") },
      requestBody: "<root>lang=en</root>",
      responseBody: "lang=en x=1",
    });
    expect(kept.requestBody).toBe("<root><redacted></root>");
    expect(kept.responseBody).toBe("<redacted> x=1");
  });
});
