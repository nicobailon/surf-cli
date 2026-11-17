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

// An op pb save made from a record whose request sent the JSON text `raw` as its query param v,
// or as its body.
function savedJsonOp(raw: string, where: string) {
  const { requestFromEntry } = require("../../native/playbook-records.cjs");
  const entry =
    where === "query"
      ? { method: "GET", url: `https://shop.test/s?v=${encodeURIComponent(raw)}` }
      : {
          method: "POST",
          url: "https://shop.test/s",
          requestBody: raw,
          requestHeaders: { "content-type": "application/json" },
        };
  return networkOp(requestFromEntry(entry), { provenance: { recordId: "rec-1", escaped: true } });
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

  it("templates a --value that holds a captured {{…}}, the text around it kept as captured", () => {
    const { escapeTemplates } = require("../../native/playbook-template.cjs");
    const captured = { note: "a {{x}} b {{y}}", whole: "{{x}}" };
    // pb save marks an op whose captured text it escaped.
    const saved = { escapes: true };
    const { op } = paramOp(
      networkOp(
        { url: "https://shop.test/save", query: escapeTemplates(captured) },
        { provenance: { recordId: "rec-1", escaped: true } },
      ),
      {
        fields: ["query.note"],
        as: "v",
        value: "{{x}}",
      },
    );
    expect(op.args.v).toEqual({ type: "string", default: "{{x}}" });
    expect(renderRequest(requestOf(op), { v: "Z" }, saved).query).toEqual({
      note: "a Z b {{y}}",
      whole: "{{x}}",
    });
    const whole = paramOp(op, { fields: ["query.whole"], as: "w", value: "{{x}}" }).op;
    expect(renderRequest(requestOf(whole), { v: "Z", w: "W" }, saved).query).toEqual({
      note: "a Z b {{y}}",
      whole: "W",
    });
    // A second part of the same field keeps the first input and the captured text around both.
    const second = paramOp(op, { fields: ["query.note"], as: "u", value: "b" }).op;
    expect(renderRequest(requestOf(second), { v: "Z", u: "U" }, saved).query.note).toBe(
      "a Z U {{y}}",
    );
    expect(() => paramOp(op, { fields: ["query.note"], as: "t", value: "v}} b" })).toThrow(
      'query.note: "v}} b" overlaps an input in "a {{v}} b {{!}}y}}"',
    );
  });

  // pb save escapes a captured JSON param or body as text, before it is parsed, so a `{{` written
  // \u007b\u007b was never escaped. pb param reads the text as captured, and every key and value
  // goes out as captured, however it was written.
  it("sends a stored JSON param's keys and values as captured, \\u escapes included", () => {
    const { escapedOp } = require("../../native/playbook-template.cjs");
    const captured = [
      String.raw`{"\u007b\u007b!}}kept":"unchanged","n":"seed"}`,
      String.raw`{"{\u007b!}}kept":"unchanged","n":"seed"}`,
      String.raw`{"{{!\u007d}kept":"unchanged","n":"seed"}`,
      // Two keys, one written with \u escapes.
      String.raw`{"\u007b\u007b!}}":"one","{{":"two","n":"seed"}`,
      String.raw`{"{{field}}":"a","{{!}}field}}":"b","n":"seed"}`,
      // A value that reads like an input once parsed is text, not an input.
      String.raw`{"a":"\u007b\u007bx}}","n":"seed"}`,
      String.raw`{"a":"\u007b\u007b!}}","b":"{{!}}","c":"{{x}}","n":"seed"}`,
      // A request's text has no %{ escape: a captured %{!} is text, in a key or a value.
      '{"%{!}k":"%{!}v","n":"seed"}',
    ];
    for (const raw of captured) {
      for (const where of ["query", "body"]) {
        const saved = savedJsonOp(raw, where);
        const { op } = paramOp(saved, {
          fields: [where === "query" ? "query.v.n" : "body.n"],
          as: "n",
        });
        expect(Object.keys(op.args)).toEqual(["n"]);
        const sent = renderRequest(requestOf(op), { n: "next" }, { escapes: escapedOp(op) });
        expect(where === "query" ? JSON.parse(sent.query.v) : sent.body).toEqual({
          ...JSON.parse(raw),
          n: "next",
        });
      }
    }
  });

  // Templating part of a JSON param's text leaves it a string holding a live {{a}}; templating a
  // field inside it next keeps that input, and every captured key and value, as they were.
  it("keeps an input in a stored JSON param's text when a field inside it is templated next", () => {
    const { escapedOp } = require("../../native/playbook-template.cjs");
    const raw = String.raw`{"a":"first-seed","b":"second-seed","c":"third-seed","literal":"{{keep}}","esc":"\u007b\u007bx}}","bang":"{{!}}","{{k}}":"key","\u007b\u007b!}}k":"key2","{{!}}j":"key3"}`;
    const given: Record<string, string> = {
      a: "live-a{{!}}%{!}",
      b: "live-b{{!}}%{!}",
      c: "live-c{{!}}%{!}",
    };
    // Each order's steps before its last, which templates a field inside the text.
    const orders = {
      forward: { before: [{ as: "a", value: "first-seed" }], field: "b" },
      reverse: { before: [{ as: "b", value: "second-seed" }], field: "a" },
      three: {
        before: [
          { as: "a", value: "first-seed" },
          { as: "b", value: "second-seed" },
        ],
        field: "c",
      },
    };
    for (const [name, { before, field }] of Object.entries(orders)) {
      const partial = before.reduce(
        (at, step) => paramOp(at, { fields: ["query.v"], ...step }).op,
        savedJsonOp(raw, "query"),
      );
      const inputs = [...before.map((step) => step.as), field];
      const args = Object.fromEntries(inputs.map((input) => [input, given[input]]));
      const expected = { ...JSON.parse(raw), ...args };

      const { op } = paramOp(partial, { fields: [`query.v.${field}`], as: field });
      expect(Object.keys(op.args), name).toEqual(inputs);
      const sent = renderRequest(requestOf(op), args, { escapes: escapedOp(op) });
      expect(JSON.parse(sent.query.v), name).toEqual(expected);

      // The same text as a body, which pb param reads the same way.
      const body = networkOp(
        {
          url: "https://shop.test/s",
          method: "POST",
          headers: { "content-type": "application/json" },
          body: requestOf(partial).query.v,
        },
        { args: partial.args, provenance: { recordId: "rec-1", escaped: true } },
      );
      const fromBody = paramOp(body, { fields: [`body.${field}`], as: field }).op;
      expect(renderRequest(requestOf(fromBody), args, { escapes: true }).body, name).toEqual(
        expected,
      );
    }
  });

  // JSON.parse reads any depth; so does pb param.
  it("templates a field of a stored JSON param nested 5,000 levels deep", () => {
    const depth = 5000;
    const raw = `{"n":"seed","deep":${'{"x":'.repeat(depth)}0${"}".repeat(depth)}}`;
    const saved = savedJsonOp(raw, "query");
    const { op } = paramOp(saved, { fields: ["query.v.n"], as: "n" });
    expect(op.args.n).toEqual({ type: "string", default: "seed" });
    expect(requestOf(op).query.v.n).toBe("{{n}}");
  });

  // A hand-written op never held the escape: its {{!}} is text, as it always was.
  it("templates a hand-written op's {{!}} as plain text", () => {
    const { op } = paramOp(
      networkOp({ url: "https://shop.test/save", query: { note: "a{{!}}b {{!}}c" } }),
      { fields: ["query.note"], as: "v", value: "b" },
    );
    expect(requestOf(op).query).toEqual({ note: "a{{!}}{{v}} {{!}}c" });
    expect(renderRequest(requestOf(op), { v: "Z" }).query).toEqual({ note: "a{{!}}Z {{!}}c" });
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

describe("pb param --link: a drafted typed-value input", () => {
  // A draft never stores a typed value, so the workflow types {{text}}, an input of its own.
  const drafted = (extra: Record<string, unknown> = {}) => ({
    id: "search",
    effect: "read",
    args: { text: { required: true, desc: "Recorded text" } },
    run: [
      {
        using: "network",
        request: {
          method: "GET",
          url: "https://hr.test/api/v2/pim/employees",
          query: { nameOrId: "Isabela", includeEmployees: "onlyCurrent" },
        },
      },
      {
        using: "workflow",
        steps: [
          { cmd: "type", args: { selector: "input.name", text: "{{text}}" } },
          { cmd: "key", args: { key: "Enter" } },
        ] as Array<{ cmd: string; args: Record<string, string> }>,
      },
    ],
    ...extra,
  });

  it("gives the typed step the named input and drops text, leaving only the named input", () => {
    const plain = paramOp(drafted(), { fields: ["query.nameOrId"], as: "name", required: true });
    expect(Object.keys(plain.op.args)).toEqual(["text", "name"]);
    expect(plain.notes.join("\n")).toMatch(
      /workflow strategy unchanged.*if --text holds the same value, add --link text/,
    );

    const result = paramOp(drafted(), {
      fields: ["query.nameOrId"],
      as: "name",
      required: true,
      link: "text",
    });
    expect(result.op.args).toEqual({ name: { type: "string", required: true } });
    expect(requestOf(result.op).query.nameOrId).toBe("{{name}}");
    expect(result.op.run[1].steps[0]).toEqual({
      cmd: "type",
      args: { selector: "input.name", text: "{{name}}" },
    });
    expect(result.notes).toEqual(["workflow fallback takes --name in place of --text: type text"]);
    expect(() => playbooks.validateOp(result.op, { origins: [] })).not.toThrow();
    // Again: nothing left to link, nothing changes.
    const again = paramOp(result.op, {
      fields: ["query.nameOrId"],
      as: "name",
      required: true,
      link: "text",
    });
    expect(again.changed).toBe(false);
  });

  it("renames the input at every depth: loop bodies, until steps and nested loops", () => {
    const looped = drafted();
    (looped.run[1] as any).steps = [
      {
        repeat: 3,
        steps: [
          { cmd: "type", args: { text: "{{text}}" } },
          { repeat: 2, steps: [{ cmd: "key", args: { key: "{{text}}" } }] },
        ],
        until: { cmd: "locate.text", args: { text: "{{text}}" } },
      },
    ];
    const { op, notes } = paramOp(looped, { fields: ["query.nameOrId"], as: "name", link: "text" });
    expect(JSON.stringify(op.run)).not.toContain("{{text}}");
    expect((op.run[1] as any).steps[0].until.args.text).toBe("{{name}}");
    expect(notes).toEqual([
      "workflow fallback takes --name in place of --text: type text, key key, locate.text text",
    ]);
    expect(() => playbooks.validateOp(op, { origins: [] })).not.toThrow();
  });

  it("moves a write's safety key to the named input", () => {
    const write = drafted({
      effect: "write",
      safety: { authorization: "explicit", duplicate: "transactional", key: ["text"] },
    });
    write.run[1].steps = [{ cmd: "type", args: { text: "{{text}}" } }];
    const { op } = paramOp(write, { fields: ["query.nameOrId"], as: "name", link: "text" });
    expect(op.args).toEqual({ name: { type: "string", default: "Isabela" } });
    expect(op.safety.key).toEqual(["name"]);
  });

  it("refuses a link that isn't a workflow-only input", () => {
    const link = (op: Record<string, unknown>, name: string, as = "name") =>
      paramOp(op, { fields: ["query.nameOrId"], as, link: name });
    expect(() => link(drafted(), "txt")).toThrow(
      "--link txt: the op has no input txt (inputs: text, name)",
    );
    expect(() => link(drafted(), "text", "text")).toThrow(
      "--link text names the same input as --as",
    );
    const sent = drafted();
    (sent.run[0] as any).request.query.includeEmployees = "{{text}}";
    expect(() => link(sent, "text")).toThrow(
      "--link text: the network strategy uses {{text}} too, so it is an input of its own; pick another --as",
    );
    const unused = drafted();
    unused.run[1].steps = [{ cmd: "key", args: { key: "Enter" } }];
    expect(() => link(unused, "text")).toThrow("--link text: no workflow step takes {{text}}");
    expect(() =>
      paramOp(drafted(), { fields: ["headers.x-v"], env: "SITE_KEY", link: "text" }),
    ).toThrow("--link goes with --as");
  });

  it("takes --link from the CLI", async () => {
    const { cwd, file } = project(drafted());
    await handlePlaybookCli(
      ["pb", "param", "shop", "search", "query.nameOrId", "--as", "name", "--link", "text"],
      { cwd },
    );
    expect(Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).args)).toEqual(["name"]);
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
