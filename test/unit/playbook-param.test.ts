import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { paramOp, applyParam } = require("../../native/playbook-param.cjs");
const { renderRequest } = require("../../native/playbook-template.cjs");
const { handlePlaybookCli } = require("../../native/playbook-cli.cjs");
const playbooks = require("../../native/playbooks.cjs");

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function networkOp(request: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    id: "search",
    effect: "read",
    args: {},
    run: [{ using: "network", request: { method: "GET", ...request } }],
    ...extra,
  };
}

function requestOf(op: { run: Array<{ using: string; request?: Record<string, unknown> }> }) {
  return op.run.find((strategy) => strategy.using === "network")?.request as Record<string, any>;
}

function project(op: Record<string, unknown>, id = "shop") {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "surf-param-"));
  tempDirs.push(cwd);
  const directory = path.join(cwd, ".surf", "playbooks", id);
  fs.mkdirSync(path.join(directory, "ops"), { recursive: true });
  fs.writeFileSync(
    path.join(directory, "playbook.json"),
    JSON.stringify({ id, version: "1.0.0", origins: [] }),
  );
  fs.writeFileSync(path.join(directory, "ops", `${op.id}.json`), JSON.stringify(op, null, 2));
  return { cwd, file: path.join(directory, "ops", `${op.id}.json`) };
}

describe("pb param: field locations", () => {
  it("turns a query param into a named input that defaults to the recorded value", () => {
    const { op } = paramOp(
      networkOp({ url: "https://shop.test/search", query: { q: "laptop", sort: "best" } }),
      { fields: ["query.q"], as: "q" },
    );
    expect(requestOf(op).query).toEqual({ q: "{{q}}", sort: "best" });
    expect(op.args.q).toEqual({ type: "string", default: "laptop" });
  });

  it("writes one input to several paths inside a JSON-valued query param, keeping numbers typed", () => {
    const variables = JSON.stringify({
      query: "laptop",
      page: 2,
      searchArgs: { query: "laptop" },
      fitmentSearchParams: { query: "laptop", page: 2 },
    });
    let { op } = paramOp(networkOp({ url: "https://shop.test/graphql", query: { variables } }), {
      fields: [
        "query.variables.query",
        "query.variables.searchArgs.query",
        "query.variables.fitmentSearchParams.query",
      ],
      as: "query",
      required: true,
    });
    ({ op } = paramOp(op, {
      fields: ["query.variables.page", "query.variables.fitmentSearchParams.page"],
      as: "page",
    }));
    expect(op.args).toEqual({
      query: { type: "string", required: true },
      page: { type: "number", default: 2 },
    });
    const rendered = renderRequest(requestOf(op), { query: "headphones", page: 3 });
    expect(JSON.parse(rendered.query.variables)).toEqual({
      query: "headphones",
      page: 3,
      searchArgs: { query: "headphones" },
      fitmentSearchParams: { query: "headphones", page: 3 },
    });
  });

  it("templates a whole path segment or only part of one", () => {
    const paper = paramOp(networkOp({ url: "https://arxiv.test/abs/2101.10010" }), {
      fields: ["path.2"],
      as: "arxiv_id",
    }).op;
    expect(requestOf(paper).url).toBe("https://arxiv.test/abs/{{arxiv_id}}");
    expect(paper.args.arxiv_id).toEqual({ type: "string", default: "2101.10010" });

    const books = paramOp(networkOp({ url: "https://books.test/catalogue/page-2.html" }), {
      fields: ["path.2"],
      as: "page",
      value: "2",
    }).op;
    expect(requestOf(books).url).toBe("https://books.test/catalogue/page-{{page}}.html");
    expect(renderRequest(requestOf(books), { page: "3" }).url).toBe(
      "https://books.test/catalogue/page-3.html",
    );
    expect(renderRequest(requestOf(books), { page: "a b/c" }).url).toBe(
      "https://books.test/catalogue/page-a%20b%2Fc.html",
    );
  });

  it("templates nested JSON body fields and several inputs in one body", () => {
    const body = JSON.stringify({
      query: "italian",
      geo: { latitude: 40.7, longitude: -74 },
      slot_filter: { day: "2026-11-21", party_size: 2 },
    });
    let { op } = paramOp(
      networkOp({
        method: "POST",
        url: "https://api.test/search",
        headers: { "content-type": "application/json" },
        body,
      }),
      {
        fields: ["body.slot_filter.party_size"],
        as: "party_size",
      },
    );
    ({ op } = paramOp(op, { fields: ["body.geo.latitude"], as: "lat" }));
    expect(requestOf(op).body).toEqual({
      query: "italian",
      geo: { latitude: "{{lat}}", longitude: -74 },
      slot_filter: { day: "2026-11-21", party_size: "{{party_size}}" },
    });
    expect(op.args.party_size).toEqual({ type: "number", default: 2 });
    expect(
      renderRequest(requestOf(op), { party_size: 4, lat: 41.1 }).body.slot_filter.party_size,
    ).toBe(4);
  });

  it("templates urlencoded and multipart form fields, encoding values when sent", () => {
    const form = paramOp(
      networkOp({
        method: "POST",
        url: "https://hr.test/search",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "_token=abc&name=Jane+Doe&page=1",
      }),
      { fields: ["body.name"], as: "name" },
    ).op;
    expect(requestOf(form).body).toBe("_token=abc&name={{name}}&page=1");
    expect(form.args.name).toEqual({ type: "string", default: "Jane Doe" });
    expect(renderRequest(requestOf(form), { name: "A&B C" }).body).toBe(
      "_token=abc&name=A%26B%20C&page=1",
    );

    const boundary = "----surf1";
    const multipart = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="QUERY"',
      "",
      "ACGT",
      `--${boundary}`,
      'Content-Disposition: form-data; name="PROGRAM"',
      "",
      "blastn",
      `--${boundary}--`,
      "",
    ].join("\r\n");
    const blast = paramOp(
      networkOp({
        method: "POST",
        url: "https://blast.test/Blast.cgi",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        body: multipart,
      }),
      { fields: ["body.QUERY"], as: "sequence", required: true },
    ).op;
    expect(requestOf(blast).body).toContain('name="QUERY"\r\n\r\n{{sequence}}\r\n');
    expect(requestOf(blast).body).toContain("blastn");
    expect(renderRequest(requestOf(blast), { sequence: "TTGA" }).body).toContain(
      'name="QUERY"\r\n\r\nTTGA\r\n',
    );
  });

  it("templates a plain header", () => {
    const { op } = paramOp(
      networkOp({ url: "https://api.test/x", headers: { "X-Origin": "https://resy.test" } }),
      { fields: ["headers.x-origin"], as: "origin" },
    );
    expect(requestOf(op).headers).toEqual({ "X-Origin": "{{origin}}" });
  });
});

describe("pb param: env headers and secrets", () => {
  it("adds an env-supplied header without storing any value", () => {
    const { op } = paramOp(
      networkOp({
        method: "POST",
        url: "https://api.test/search",
        headers: { accept: "application/json" },
      }),
      {
        fields: ["headers.Authorization"],
        env: "RESY_KEY",
      },
    );
    expect(requestOf(op).authInputs).toEqual([
      { env: "RESY_KEY", header: "Authorization", required: true },
    ]);
    expect(requestOf(op).headers).toEqual({ accept: "application/json" });
    expect(op.args).toEqual({});
    expect(() => playbooks.validateOp(op, { origins: [] })).not.toThrow();
    expect(paramOp(op, { fields: ["headers.authorization"], env: "RESY_KEY" }).changed).toBe(false);
    expect(() => paramOp(op, { fields: ["headers.authorization"], env: "OTHER_KEY" })).toThrow(
      /already reads RESY_KEY/,
    );
  });

  it("refuses to store a literal for a secret header or field", () => {
    const op = networkOp({
      url: "https://api.test/x",
      query: { access_token: "abc123", q: "x" },
      headers: { "x-api-key": "k" },
    });
    expect(() => paramOp(op, { fields: ["headers.x-api-key"], as: "key", required: true })).toThrow(
      /use --env/,
    );
    expect(() => paramOp(op, { fields: ["query.access_token"], as: "token" })).toThrow(
      /--required/,
    );
    expect(() =>
      paramOp(op, { fields: ["query.access_token"], as: "token", default: "abc123" }),
    ).toThrow(/--required/);
    expect(
      paramOp(op, { fields: ["query.access_token"], as: "token", required: true }).op.args.token,
    ).toEqual({ type: "string", required: true });
  });
});

describe("pb param: partial templates of secret fields", () => {
  it("requires a secret-looking field to be templated whole, so no fragment of it is stored", () => {
    const op = networkOp({
      url: "https://api.test/x",
      query: { access_token: "prefix-tok-suffix", session_data: JSON.stringify({ id: "s-42-x" }) },
    });
    expect(() =>
      paramOp(op, { fields: ["query.access_token"], as: "token", required: true, value: "tok" }),
    ).toThrow(/query.access_token looks secret: template it whole/);
    expect(() =>
      paramOp(op, { fields: ["query.session_data.id"], as: "sid", required: true, value: "42" }),
    ).toThrow(/template it whole/);
    expect(() => paramOp(op, { fields: ["query.session_data.id"], as: "sid" })).toThrow(
      /--required/,
    );
    expect(
      requestOf(paramOp(op, { fields: ["query.access_token"], as: "token", required: true }).op)
        .query.access_token,
    ).toBe("{{token}}");
  });
});

describe("pb param: validation", () => {
  const op = networkOp({ url: "https://shop.test/search", query: { q: "laptop", alt: "laptops" } });

  it("fails clearly on a missing field, a missing literal and a clashing name", () => {
    expect(() => paramOp(op, { fields: ["query.missing"], as: "q" })).toThrow(
      /query.missing: no query param "missing" \(has: q, alt\)/,
    );
    expect(() => paramOp(op, { fields: ["path.4"], as: "q" })).toThrow(
      /path.4: the URL path has 1 segment/,
    );
    expect(() => paramOp(op, { fields: ["body.q"], as: "q" })).toThrow(
      /body.q: the request has no body/,
    );
    expect(() => paramOp(op, { fields: ["query.q"], as: "q", value: "phone" })).toThrow(
      /query.q: "phone" not found in "laptop"/,
    );
    expect(() => paramOp(op, { fields: ["query.q", "query.alt"], as: "q" })).toThrow(
      /hold different values/,
    );
    const withArg = { ...op, args: { q: { type: "string", required: true } } };
    expect(() => paramOp(withArg, { fields: ["query.q"], as: "q" })).toThrow(
      /input q already exists with a different definition/,
    );
    expect(() => paramOp(op, { fields: ["query.q"], as: "json" })).toThrow(/reserved/);
    expect(() => paramOp(op, { fields: ["query.q"], as: "Q" })).toThrow(/lowercase/);
    const redacted = networkOp({
      method: "POST",
      url: "https://shop.test/x",
      body: "<request-body>",
    });
    expect(() => paramOp(redacted, { fields: ["body.q"], as: "q" })).toThrow(
      /--include-input-values/,
    );
  });

  it("changes nothing when the same param is applied twice", () => {
    const first = paramOp(op, { fields: ["query.q"], as: "q", desc: "Search text" });
    const second = paramOp(first.op, { fields: ["query.q"], as: "q", desc: "Search text" });
    expect(second.changed).toBe(false);
    expect(second.op).toEqual(first.op);
  });

  it("templates the workflow fallback where a step carries the same literal", () => {
    const withWorkflow = {
      ...networkOp({ url: "https://books.test/catalogue/page-2.html" }),
      run: [
        {
          using: "network",
          request: { method: "GET", url: "https://books.test/catalogue/page-2.html" },
        },
        {
          using: "workflow",
          steps: [
            { cmd: "navigate", args: { url: "https://books.test/catalogue/page-2.html" } },
            { cmd: "type", args: { text: "2" } },
            { cmd: "click", args: { ref: "e2" } },
          ],
        },
      ],
    };
    const result = paramOp(withWorkflow, { fields: ["path.2"], as: "page", value: "2" });
    expect(result.op.run[1].steps).toEqual([
      { cmd: "navigate", args: { url: "https://books.test/catalogue/page-{{page}}.html" } },
      { cmd: "type", args: { text: "{{page}}" } },
      { cmd: "click", args: { ref: "e2" } },
    ]);
    const unrelated = {
      ...withWorkflow,
      run: [
        withWorkflow.run[0],
        { using: "workflow", steps: [{ cmd: "click", args: { ref: "e9" } }] },
      ],
    };
    expect(
      paramOp(unrelated, { fields: ["path.2"], as: "page", value: "2" }).notes.join("\n"),
    ).toMatch(/workflow strategy unchanged/);
  });
});

describe("pb param: saving", () => {
  it("saves in the op's scope through validateOp and prints a diff; a second run leaves the file alone", () => {
    const { cwd, file } = project(
      networkOp({ url: "https://shop.test/search", query: { q: "laptop" } }),
    );
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "surf-param-home-"));
    tempDirs.push(home);
    const result = applyParam({
      playbook: "shop",
      op: "search",
      fields: ["query.q"],
      as: "q",
      cwd,
      home,
    });
    expect(result).toMatchObject({
      playbook: "shop",
      op: "search",
      scope: "project",
      changed: true,
      file,
    });
    expect(result.diff).toMatch(/^- +"q": "laptop"$/m);
    expect(result.diff).toMatch(/^\+ +"q": "\{\{q\}\}"$/m);
    const saved = fs.readFileSync(file, "utf8");
    expect(JSON.parse(saved).args.q).toEqual({ type: "string", default: "laptop" });
    expect(fs.existsSync(path.join(home, ".surf"))).toBe(false);
    const again = applyParam({
      playbook: "shop",
      op: "search",
      fields: ["query.q"],
      as: "q",
      cwd,
      home,
    });
    expect(again.changed).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe(saved);
  });

  it("refuses built-in playbooks", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "surf-param-"));
    tempDirs.push(cwd);
    expect(() =>
      applyParam({ playbook: "page", op: "read", fields: ["path.1"], as: "p", cwd, home: cwd }),
    ).toThrow(/built-in/);
  });

  it("runs from the CLI with fields before or after the flags", async () => {
    const { cwd, file } = project(networkOp({ url: "https://books.test/catalogue/page-2.html" }));
    const result = await handlePlaybookCli(
      ["pb", "param", "shop", "search", "--as", "page", "path.2", "--value", "2", "--json"],
      { cwd },
    );
    expect(result.value).toMatchObject({ changed: true, scope: "project" });
    expect(JSON.parse(fs.readFileSync(file, "utf8")).run[0].request.url).toBe(
      "https://books.test/catalogue/page-{{page}}.html",
    );
    const text = await handlePlaybookCli(
      ["pb", "param", "shop", "search", "path.2", "--as", "page", "--value", "2"],
      { cwd },
    );
    expect(text.value).toMatch(/No change/);
    await expect(
      handlePlaybookCli(["pb", "param", "shop", "search", "path.2"], { cwd }),
    ).rejects.toThrow(/--as <name> or --env <VAR>/);
  });
});
