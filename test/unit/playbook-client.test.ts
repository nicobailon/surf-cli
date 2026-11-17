import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const clients = require("../../native/playbook-client.cjs");
const records = require("../../native/playbook-records.cjs");
const { renderRequest, resolveArgValues } = require("../../native/playbook-template.cjs");
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("playbook client projection", () => {
  it("generates the validated endpoint shape with provenance and no captured credentials", async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "surf-client-"));
    directories.push(parent);
    const out = path.join(parent, "client");
    const result = clients.generateClient({
      playbookId: "fixture",
      op: { id: "search", effect: "read" },
      strategy: {
        using: "network",
        request: {
          method: "POST",
          url: "https://example.test/search",
          query: { q: "{{q}}" },
          headers: {
            accept: "application/json",
            authorization: "Bearer captured-secret",
            cookie: "sid=secret",
          },
          body: { query: "{{q}}" },
        },
        extract: { jsonPath: "$.items" },
      },
      provenance: { type: "record", recordId: "rec-1" },
      out,
    });
    expect(result.manifest).toMatchObject({
      playbook: "fixture",
      op: "search",
      source: { recordId: "rec-1" },
      noEmbeddedSecrets: true,
      endpoint: { method: "POST", query: { q: "{{q}}" }, body: { query: "{{q}}" } },
    });
    const files = fs
      .readdirSync(out)
      .map((name: string) => fs.readFileSync(path.join(out, name), "utf8"))
      .join("\n");
    expect(files).not.toContain("captured-secret");
    expect(files).not.toContain("sid=secret");
    await expect(clients.verifyClient(out, { live: false })).resolves.toMatchObject({
      valid: true,
      endpoint: { method: "POST", url: "https://example.test/search" },
      execution: { requests: 1 },
    });
    fs.writeFileSync(path.join(out, "client.mjs"), "process.exit(0);\n");
    await expect(clients.verifyClient(out, { live: false })).rejects.toThrow(/did not call/);
  });

  it("requires a runnable absolute endpoint for standalone clients", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "surf-client-"));
    directories.push(parent);
    expect(() =>
      clients.generateClient({
        playbookId: "fixture",
        op: { id: "read", effect: "read" },
        strategy: { using: "network", request: { method: "GET", url: "/" } },
        provenance: { type: "playbook", id: "fixture" },
        out: path.join(parent, "missing-origin"),
      }),
    ).toThrow(/absolute endpoint URL/);
    expect(() =>
      clients.generateClient({
        playbookId: "fixture",
        op: { id: "read", effect: "read" },
        strategy: { using: "network", request: { method: "GET", url: "https://example.test/" } },
        provenance: { type: "playbook", id: "fixture" },
      }),
    ).toThrow(/--out <directory>/);

    const out = path.join(parent, "client");
    const result = clients.generateClient({
      playbookId: "fixture",
      op: { id: "read", effect: "read" },
      strategy: { using: "network", request: { method: "GET", url: "/api" } },
      provenance: { type: "playbook", id: "fixture" },
      origins: ["https://example.test"],
      out,
    });
    expect(result.manifest.endpoint.url).toBe("https://example.test/api");
  });

  it("derives a client from the one API request, not the page's images or scripts", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "surf-client-"));
    directories.push(parent);
    const root = path.join(parent, "state");
    const record = records.startRecord({ site: "fixture", op: "search", tabId: 1, root });
    const get = (id: string, type: string, url: string) => ({
      id,
      method: "GET",
      status: 200,
      type,
      url,
    });
    records.attachNetworkTrace(
      record.id,
      [
        get("r-1", "XHR", "https://example.test/api/search?q=shoes"),
        get("r-2", "Image", "https://example.test/shoe-1.png"),
        get("r-3", "Script", "https://example.test/app.js"),
      ],
      root,
    );
    const result = clients.deriveClient("fixture", "search", path.join(parent, "client"), {
      root,
      recordId: record.id,
    });
    expect(result.manifest.endpoint.url).toBe("https://example.test/api/search");
  });

  it.each(["{{x}}", "prefix {{x}}", "{{_open}}", "{{!}}", "{{", "{{{x}}}"])(
    "derives a client that sends a captured %s as captured, not as an input",
    (literal) => {
      const parent = fs.mkdtempSync(path.join(os.tmpdir(), "surf-client-"));
      directories.push(parent);
      const root = path.join(parent, "state");
      const record = records.startRecord({ site: "fixture", op: "search", tabId: 1, root });
      records.attachNetworkTrace(
        record.id,
        [
          {
            id: "r-1",
            method: "GET",
            status: 200,
            type: "XHR",
            url: `https://example.test/api/search?q=${encodeURIComponent(literal)}`,
            requestHeaders: { "x-note": literal },
          },
        ],
        root,
      );
      const { manifest } = clients.deriveClient("fixture", "search", path.join(parent, "client"), {
        root,
        recordId: record.id,
      });
      expect(manifest.args).toEqual({});
      expect(manifest.escapes).toBe(true);
      const sent = renderRequest(
        manifest.endpoint,
        resolveArgValues(manifest.args, { x: "deleteAll" }),
        { escapes: manifest.escapes },
      );
      expect(sent).toMatchObject({ query: { q: literal }, headers: { "x-note": literal } });
    },
  );

  it("refuses to build a client that would send a redacted placeholder", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "surf-client-"));
    directories.push(parent);
    expect(() =>
      clients.generateClient({
        playbookId: "fixture",
        op: { id: "search", effect: "read", run: [] },
        strategy: {
          using: "network",
          request: {
            method: "GET",
            url: "https://example.test/api/search",
            query: { q: "<text>" },
          },
        },
        provenance: { type: "test" },
        out: path.join(parent, "client"),
      }),
    ).toThrow(/query\.q holds <text>.*surf pb param fixture search query\.q --as <name>/);
  });

  it("derives from the one clear winner of the ranking, and asks for --request-id when there is none", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "surf-client-"));
    directories.push(parent);
    const root = path.join(parent, "state");
    let tabId = 0;
    const derive = (trace: Record<string, unknown>[]) => {
      tabId++;
      const record = records.startRecord({
        site: "fixture",
        op: "search",
        tabId,
        origin: "https://example.test",
        root,
      });
      records.attachNetworkTrace(record.id, trace, root);
      return () =>
        clients.deriveClient("fixture", "search", path.join(parent, record.id), {
          root,
          recordId: record.id,
        });
    };
    const body = JSON.stringify({
      items: [{ name: "a" }, { name: "b" }, { name: "c" }],
      total: 3,
      note: "x".repeat(200),
    });
    const api = {
      id: "r-api",
      method: "GET",
      status: 200,
      type: "XHR",
      mimeType: "application/json",
      url: "https://example.test/api/search?q=shoes",
      responseBody: body,
      bodyCapture: { complete: true, capturedBytes: body.length },
    };
    const beacon = {
      id: "r-ping",
      method: "GET",
      status: 200,
      type: "XHR",
      url: "https://cdn.other.test/ping",
    };
    expect(derive([api, beacon])().manifest.endpoint.url).toBe("https://example.test/api/search");
    expect(derive([api, { ...api, id: "r-api-2", url: "https://example.test/api/other" }])).toThrow(
      /has several read endpoints and no clear winner; run surf pb record candidates rec-[^ ]+ and pass --request-id/,
    );
  });

  it("refuses to derive a client from a POST, keeping its query and body shape when allowed", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "surf-client-"));
    directories.push(parent);
    const root = path.join(parent, "state");
    const record = records.startRecord({
      site: "fixture",
      op: "search",
      includeInputValues: true,
      tabId: 1,
      root,
    });
    records.attachNetworkTrace(
      record.id,
      [
        {
          id: "r-1",
          method: "POST",
          status: 200,
          url: "https://example.test/search?q=shoes",
          requestHeaders: { accept: "application/json" },
          requestBody: JSON.stringify({ q: "shoes" }),
        },
      ],
      root,
    );
    expect(() =>
      clients.deriveClient("fixture", "search", path.join(parent, "refused"), {
        root,
        recordId: record.id,
      }),
    ).toThrow(/pb client derive and export refuse write requests for now/);
    expect(fs.existsSync(path.join(parent, "refused"))).toBe(false);
    const result = clients.deriveClient("fixture", "search", path.join(parent, "client"), {
      root,
      recordId: record.id,
      allowWrite: true,
    });
    expect(result.manifest.effect).toBe("write");
    expect(result.manifest.endpoint).toMatchObject({
      method: "POST",
      url: "https://example.test/search",
      query: { q: "shoes" },
      body: JSON.stringify({ q: "shoes" }),
    });
  });

  it("rejects credential-like literals outside declared auth inputs", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "surf-client-"));
    directories.push(parent);
    expect(() =>
      clients.generateClient({
        playbookId: "fixture",
        op: { id: "search", effect: "read" },
        strategy: {
          using: "network",
          request: {
            method: "GET",
            url: "https://example.test/search?access_token=captured-secret",
          },
        },
        provenance: { type: "record", recordId: "rec-1" },
        out: path.join(parent, "client"),
      }),
    ).toThrow(/auth input/);
  });
});

describe("verifying clients made by earlier versions", () => {
  it("verifies a client generated by main's source, which sends object query values as [object Object]", async () => {
    const fixture = path.join(__dirname, "..", "fixtures", "clients", "main-46a508be-object-query");
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), "surf-old-client-"));
    directories.push(copy);
    fs.cpSync(fixture, copy, { recursive: true });
    await expect(clients.verifyClient(copy, { live: false })).resolves.toMatchObject({
      valid: true,
      execution: { requests: 1 },
    });
  });

  it('verifies a client generated at b2e12357, which reads --author "" as true', async () => {
    const fixture = path.join(
      __dirname,
      "..",
      "fixtures",
      "clients",
      "main-b2e12357-empty-default",
    );
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), "surf-old-client-"));
    directories.push(copy);
    fs.cpSync(fixture, copy, { recursive: true });
    await expect(clients.verifyClient(copy, { live: false })).resolves.toMatchObject({
      valid: true,
      execution: { requests: 1 },
    });
  });
});

describe("clients from parameterised ops", () => {
  const http = require("node:http");
  const { execFile } = require("node:child_process");

  function writeOp(op: Record<string, unknown>) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "surf-client-param-"));
    directories.push(cwd);
    const directory = path.join(cwd, ".surf", "playbooks", "books");
    fs.mkdirSync(path.join(directory, "ops"), { recursive: true });
    fs.writeFileSync(
      path.join(directory, "playbook.json"),
      JSON.stringify({ id: "books", version: "1.0.0", origins: ["https://books.test"] }),
    );
    fs.writeFileSync(path.join(directory, "ops", `${op.id}.json`), JSON.stringify(op));
    return cwd;
  }

  async function serve(run: (origin: string) => Promise<unknown>) {
    const requests: Array<{
      method: string;
      url: string;
      body: string;
      headers: Record<string, string>;
    }> = [];
    const server = http.createServer((request: any, response: any) => {
      let body = "";
      request.on("data", (chunk: string) => {
        body += chunk;
      });
      request.on("end", () => {
        requests.push({ method: request.method, url: request.url, body, headers: request.headers });
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"ok":true}');
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      await run(`http://127.0.0.1:${server.address().port}`);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    return requests;
  }

  function runClient(directory: string, args: string[], env: Record<string, string>) {
    return new Promise((resolve, reject) => {
      execFile(
        process.execPath,
        [path.join(directory, "client.mjs"), ...args],
        { env: { ...process.env, ...env } },
        (error: Error | null, stdout: string, stderr: string) =>
          error ? reject(new Error(stderr || error.message)) : resolve(stdout),
      );
    });
  }

  it("takes the op's inputs, with defaults, types and path, JSON and form templates, and still verifies", async () => {
    const cwd = writeOp({
      id: "page",
      effect: "read",
      args: {
        page: { type: "number", default: 2 },
        q: { type: "string", required: true },
        unused: { required: true },
      },
      run: [
        {
          using: "network",
          request: {
            method: "POST",
            url: "https://books.test/catalogue/page-{{page}}.html",
            query: { v: { page: "{{page}}" } },
            headers: { "content-type": "application/json" },
            body: { page: "{{page}}", q: "{{q}}" },
          },
        },
        { using: "workflow", steps: [{ cmd: "type", args: { text: "{{unused}}" } }] },
      ],
    });
    const out = path.join(cwd, "client");
    const { manifest } = clients.exportClient("books", "page", out, { cwd });
    expect(manifest.args).toEqual({
      page: { type: "number", default: 2 },
      q: { type: "string", required: true },
    });
    const requests = await serve(async (origin) => {
      await runClient(out, ["--page", "3", "--q", "007"], { SURF_CLIENT_ORIGIN: origin });
      await runClient(out, ["--q", "x y"], { SURF_CLIENT_ORIGIN: origin });
      await expect(runClient(out, [], { SURF_CLIENT_ORIGIN: origin })).rejects.toThrow(
        /Missing required argument: --q/,
      );
    });
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: "/catalogue/page-3.html?v=%7B%22page%22%3A3%7D",
      body: '{"page":3,"q":"007"}',
    });
    expect(requests[1]).toMatchObject({
      url: "/catalogue/page-2.html?v=%7B%22page%22%3A2%7D",
      body: '{"page":2,"q":"x y"}',
    });
    await expect(clients.verifyClient(out, { live: false })).resolves.toMatchObject({
      valid: true,
      execution: { requests: 1 },
    });
  });

  // Only an op pb save escaped reads {{!}} as {{; a hand-written op's client sends it as written.
  it.each([
    ["a hand-written op", {}, "a {{!}} b"],
    ["an op pb save made", { provenance: { recordId: "rec-1", escaped: true } }, "a {{ b"],
  ])("exports a client of %s that sends {{!}} as that op does", async (_case, extra, body) => {
    const cwd = writeOp({
      id: "note",
      effect: "read",
      run: [
        {
          using: "network",
          request: { method: "POST", url: "https://books.test/note", body: "a {{!}} b" },
        },
      ],
      ...extra,
    });
    const out = path.join(cwd, "client");
    clients.exportClient("books", "note", out, { cwd, allowWrite: true });
    const requests = await serve(async (origin) => {
      await runClient(out, [], { SURF_CLIENT_ORIGIN: origin });
    });
    expect(requests[0]).toMatchObject({ method: "POST", body });
    await expect(clients.verifyClient(out, { live: false })).resolves.toMatchObject({
      valid: true,
    });
  });

  // The client decodes the op's stored text, never an input's value.
  it("exports a client of an op pb save made that sends each input as given", async () => {
    const values = ["%{!}", "{{!}}", "%{x}", "{{x}}", "%{!}_open}", "a{{q}}b"];
    const cwd = writeOp({
      id: "note",
      effect: "read",
      args: { q: { type: "string", required: true } },
      provenance: { recordId: "rec-1", escaped: true },
      run: [
        {
          using: "network",
          request: {
            method: "POST",
            url: "https://books.test/note",
            headers: { "x-q": "{{q}}" },
            body: "{{!}}q}} {{q}}",
          },
        },
      ],
    });
    const out = path.join(cwd, "client");
    clients.exportClient("books", "note", out, { cwd, allowWrite: true });
    const requests = await serve(async (origin) => {
      for (const q of values) {
        await runClient(out, ["--q", q], { SURF_CLIENT_ORIGIN: origin });
      }
    });
    expect(requests.map((request) => request.body)).toEqual(values.map((q) => `{{q}} ${q}`));
    expect(requests.map((request) => request.headers["x-q"])).toEqual(values);
  });

  // pb param stores a JSON param's keys escaped, as its values: one may take an input.
  it("exports a client of an op pb save made that fills a JSON key's input and sends a captured key as captured", async () => {
    const cwd = writeOp({
      id: "keyed",
      effect: "read",
      args: {
        key: { type: "string", required: true },
        n: { type: "number", default: 1 },
      },
      provenance: { recordId: "rec-1", escaped: true },
      run: [
        {
          using: "network",
          request: {
            method: "GET",
            url: "https://books.test/keyed",
            query: {
              v: {
                "{{key}}": "kept",
                "{{!}}key}}": "literal",
                "{{!}}!}}k": "{{n}}",
              },
            },
          },
        },
      ],
    });
    const out = path.join(cwd, "client");
    const { manifest } = clients.exportClient("books", "keyed", out, { cwd });
    expect(Object.keys(manifest.args)).toEqual(["key", "n"]);
    const requests = await serve(async (origin) => {
      await runClient(out, ["--key", "live{{!}}%{!}", "--n", "2"], {
        SURF_CLIENT_ORIGIN: origin,
      });
    });
    const sent = new URL(requests[0].url, "http://client.test").searchParams.get("v");
    expect(JSON.parse(sent as string)).toEqual({
      "live{{!}}%{!}": "kept",
      "{{key}}": "literal",
      "{{!}}k": 2,
    });
    await expect(clients.verifyClient(out, { live: false })).resolves.toMatchObject({
      valid: true,
    });
  });

  // Exporting, verifying and running the client read a deep op's JSON without recursion. A query
  // that deep is longer than a local server takes, so that one is only exported and rendered.
  it("exports, verifies and runs a client of an op whose JSON nests 1,500 levels deep", async () => {
    // Capped where Node 24's recursive JSON.stringify, which writes the op, fits a Linux CI stack.
    const depth = 1500;
    const nested = (leaf: unknown) => {
      let value = leaf;
      for (let level = 0; level < depth; level++) {
        value = { x: value };
      }
      return value;
    };
    const deepOp = (id: string, request: Record<string, unknown>) => ({
      id,
      effect: "write",
      args: { n: { type: "number", default: 1 } },
      safety: { duplicate: "repeatable-window", windowMs: 1000, key: ["n"] },
      provenance: { recordId: "rec-1", escaped: true },
      run: [
        {
          using: "network",
          request: { method: "POST", url: `https://books.test/${id}`, ...request },
        },
      ],
    });
    const cwd = writeOp(
      deepOp("deep", { headers: { "content-type": "application/json" }, body: nested("{{n}}") }),
    );
    const out = path.join(cwd, "client");
    const { manifest } = clients.exportClient("books", "deep", out, { cwd, allowWrite: true });
    expect(Object.keys(manifest.args)).toEqual(["n"]);
    await expect(clients.verifyClient(out, { live: false })).resolves.toMatchObject({
      valid: true,
    });
    const requests = await serve(async (origin) => {
      await runClient(out, ["--n", "2"], { SURF_CLIENT_ORIGIN: origin });
    });
    // As text: a matcher compares objects this deep by recursion.
    expect(requests[0].body).toBe(JSON.stringify(nested(2)));

    fs.writeFileSync(
      path.join(cwd, ".surf", "playbooks", "books", "ops", "deepq.json"),
      JSON.stringify(deepOp("deepq", { query: { v: nested("{{n}}") } })),
    );
    const query = clients.exportClient("books", "deepq", path.join(cwd, "query-client"), {
      cwd,
      allowWrite: true,
    }).manifest;
    expect(Object.keys(query.args)).toEqual(["n"]);
    const sent = renderRequest(query.endpoint, { n: 2 }, { escapes: query.escapes }).query.v;
    expect(sent).toBe(JSON.stringify(nested(2)));
  });

  it('reads --x "" and --x= as the empty string, and a bare --flag only for a boolean', async () => {
    const cwd = writeOp({
      id: "search",
      effect: "read",
      args: {
        query: { type: "string", required: true },
        author: { type: "string", default: "" },
        sort: { type: "string", default: "-date" },
        abstracts: { type: "boolean", default: false },
      },
      run: [
        {
          using: "network",
          request: {
            method: "GET",
            url: "https://books.test/search",
            query: {
              q: "{{query}}",
              author: "{{author}}",
              order: "{{sort}}",
              abs: "{{abstracts}}",
            },
          },
        },
      ],
    });
    const out = path.join(cwd, "client");
    clients.exportClient("books", "search", out, { cwd });
    await expect(clients.verifyClient(out, { live: false })).resolves.toMatchObject({
      valid: true,
      execution: { requests: 1 },
    });
    const requests = await serve(async (origin) => {
      const env = { SURF_CLIENT_ORIGIN: origin };
      await runClient(out, ["--query", "x", "--author", "", "--sort", ""], env);
      await runClient(out, ["--query=a=b", "--author=", "--abstracts"], env);
      await runClient(out, ["--query", "x", "--abstracts", "--sort", "-relevance"], env);
      await expect(runClient(out, ["--query", "x", "--author"], env)).rejects.toThrow(
        /--author needs a value \(--author "" for an empty one\)/,
      );
    });
    expect(requests.map((request) => request.url)).toEqual([
      "/search?q=x&author=&order=&abs=false",
      "/search?q=a%3Db&author=&order=-date&abs=true",
      "/search?q=x&author=&order=-relevance&abs=true",
    ]);
  });

  it("verifies an op whose string default starts with --", async () => {
    const cwd = writeOp({
      id: "sorted",
      effect: "read",
      args: { order: { type: "string", default: "--submitted" } },
      run: [
        {
          using: "network",
          request: { method: "GET", url: "https://books.test/list", query: { order: "{{order}}" } },
        },
      ],
    });
    const out = path.join(cwd, "client");
    clients.exportClient("books", "sorted", out, { cwd });
    await expect(clients.verifyClient(out, { live: false })).resolves.toMatchObject({
      valid: true,
      execution: { requests: 1 },
    });
  });

  it("redacts its env-supplied header values from stdout and errors", async () => {
    const cwd = writeOp({
      id: "echo",
      effect: "read",
      run: [
        {
          using: "network",
          request: {
            method: "GET",
            url: "https://books.test/headers",
            authInputs: [{ env: "SURF_TEST_ECHO_KEY", header: "Authorization", required: true }],
          },
        },
      ],
    });
    const out = path.join(cwd, "client");
    clients.exportClient("books", "echo", out, { cwd });
    const echoServer = http.createServer((request: any, response: any) => {
      response.writeHead(request.url.includes("fail") ? 500 : 200, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify({ Authorization: request.headers.authorization, other: "zz9" }));
    });
    await new Promise((resolve) => echoServer.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${echoServer.address().port}`;
    try {
      const stdout = String(
        await runClient(out, [], { SURF_CLIENT_ORIGIN: origin, SURF_TEST_ECHO_KEY: "zz" }),
      );
      expect(stdout).toContain('"Authorization": "<redacted>"');
      expect(stdout).toContain('"other": "zz9"');
      const failure = await runClient(out, [], {
        SURF_CLIENT_ENDPOINT_URL: `${origin}/headers?fail`,
        SURF_TEST_ECHO_KEY: "zz",
      }).catch((caught: Error) => caught);
      expect(String(failure)).toMatch(/HTTP 500/);
      expect(String(failure)).not.toMatch(/"zz"/);
    } finally {
      await new Promise((resolve) => echoServer.close(resolve));
    }
  });

  it("encodes form fields and reads env-supplied headers from the client's own environment", async () => {
    const cwd = writeOp({
      id: "form",
      effect: "read",
      args: { name: { type: "string", default: "Jane" } },
      run: [
        {
          using: "network",
          request: {
            method: "POST",
            url: "https://books.test/search",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: "name={{name}}&page=1",
            authInputs: [{ env: "SURF_TEST_CLIENT_KEY", header: "Authorization", required: true }],
          },
        },
      ],
    });
    const out = path.join(cwd, "client");
    const { manifest } = clients.exportClient("books", "form", out, { cwd });
    expect(manifest.authInputs).toEqual([
      { env: "SURF_TEST_CLIENT_KEY", header: "Authorization", required: true },
    ]);
    const requests = await serve(async (origin) => {
      await runClient(out, ["--name", "A&B C"], {
        SURF_CLIENT_ORIGIN: origin,
        SURF_TEST_CLIENT_KEY: "client-env-value",
      });
    });
    expect(requests[0].body).toBe("name=A%26B%20C&page=1");
    expect(requests[0].headers.authorization).toBe("client-env-value");
    expect(fs.readFileSync(path.join(out, "surf-client.json"), "utf8")).not.toContain(
      "client-env-value",
    );
    await expect(clients.verifyClient(out, { live: false })).resolves.toMatchObject({
      valid: true,
    });
  });
});
