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

  // Templating part of a JSON param's text can put an input in a key. Stored as an object, that
  // key stays an input; a captured key that reads the same, {{key}}, stays captured beside it.
  it("keeps an input in a stored JSON param's key when a field inside it is templated next", () => {
    const { escapedOp } = require("../../native/playbook-template.cjs");
    const raw = String.raw`{"seed-key":"kept","{{key}}":"literal","{{field}}":"f","\u007b\u007bx}}":"esc","n":"start","m":"other"}`;
    const given: Record<string, string> = {
      key: "live{{!}}%{!}",
      n: "N{{!}}%{!}",
      m: "M",
    };
    const captured = JSON.parse(raw);
    const orders = {
      // The reviewer's: the key, then a field.
      forward: [
        { fields: ["query.v"], as: "key", value: "seed-key" },
        { fields: ["query.v.n"], as: "n" },
      ],
      // A value in the text first, then the key, then a field.
      reverse: [
        { fields: ["query.v"], as: "n", value: "start" },
        { fields: ["query.v"], as: "key", value: "seed-key" },
        { fields: ["query.v.m"], as: "m" },
      ],
    };
    for (const [name, steps] of Object.entries(orders)) {
      const op = steps.reduce((at, step) => paramOp(at, step).op, savedJsonOp(raw, "query"));
      const inputs = steps.map((step) => step.as);
      expect(Object.keys(op.args), name).toEqual(inputs);
      const args = Object.fromEntries(inputs.map((input) => [input, given[input]]));
      const { "seed-key": kept, ...rest } = captured;
      const expected = {
        ...rest,
        [given.key]: kept,
        ...(args.n ? { n: given.n } : {}),
        ...(args.m ? { m: given.m } : {}),
      };
      const sent = renderRequest(requestOf(op), args, {
        escapes: escapedOp(op),
      });
      expect(JSON.parse(sent.query.v), name).toEqual(expected);
      // A field names a captured key by its captured text; the input's key and the captured
      // key that reads the same are both named {{key}}, so pb param refuses to pick one.
      expect(paramOp(op, { fields: ["query.v.{{field}}"], as: "f" }).op.args.f, name).toEqual({
        type: "string",
        default: "f",
      });
      expect(() => paramOp(op, { fields: ["query.v.{{key}}"], as: "k" }), name).toThrow(
        'query.v.{{key}}: more than one key at the top level reads "{{key}}"',
      );
    }
  });

  // A masked number under a key that an input then takes keeps its type: the record's note on it
  // follows the key.
  it("keeps a masked number's type under a JSON key templated into an input", () => {
    const { escapedOp, resolveArgValues } = require("../../native/playbook-template.cjs");
    const saved = savedJsonOp('{"year":"<text>","n":"seed"}', "query");
    requestOf(saved).redactedTypes = { "query.v.year": "number" };
    const keyed = paramOp(saved, {
      fields: ["query.v"],
      as: "field",
      value: "year",
    }).op;
    expect(requestOf(keyed).redactedTypes).toEqual({
      "query.v.{{field}}": "number",
    });
    const { op } = paramOp(keyed, {
      fields: ["query.v.{{field}}"],
      as: "year",
    });
    expect(op.args.year).toEqual({ type: "number", required: true });
    expect(requestOf(op)).not.toHaveProperty("redactedTypes");
    const args = resolveArgValues(op.args, { field: "y{{!}}", year: "2031" });
    const sent = renderRequest(requestOf(op), args, { escapes: escapedOp(op) });
    expect(JSON.parse(sent.query.v)).toEqual({ "y{{!}}": 2031, n: "seed" });
  });

  // A recorded JSON value with a masked number at each of its keys: each type is moved once the
  // object's renamed key is known, in work linear in the number of keys.
  it("moves the types of many masked numbers under a renamed key in work linear in their number", () => {
    const counter = { keys: 0 };
    (globalThis as any).paramKeyReads = counter;
    const file = (require as any).resolve("../../native/playbook-param.cjs");
    const source = fs.readFileSync(file, "utf8");
    const line = "const keyReader = (escapes) => (escapes ? unescapeTemplates : keep);";
    if (!source.includes(line)) {
      throw new Error("the change matched nothing in the source");
    }
    const Module = require("node:module");
    const loaded = new Module(file);
    loaded.filename = file;
    loaded.paths = Module._nodeModulePaths(path.dirname(file));
    loaded._compile(
      source.replace(
        line,
        "const keyReader = (escapes) => (key) => (globalThis.paramKeyReads.keys++, escapes ? unescapeTemplates(key) : key);",
      ),
      file,
    );
    const name = (index: number) => `field-${String(index).padStart(6, "0")}`;
    const counts = [200, 400, 800, 1600].map((width) => {
      const keys = Array.from({ length: width }, (_, index) => name(index));
      const saved = savedJsonOp(
        JSON.stringify(Object.fromEntries(keys.map((key) => [key, "<text>"]))),
        "query",
      );
      requestOf(saved).redactedTypes = Object.fromEntries(
        keys.map((key) => [`query.v.${key}`, "number"]),
      );
      counter.keys = 0;
      const { op } = loaded.exports.paramOp(saved, {
        fields: ["query.v"],
        as: "key",
        value: name(0),
      });
      const types = requestOf(op).redactedTypes;
      expect(Object.keys(types)).toHaveLength(width);
      expect(types).toMatchObject({
        "query.v.{{key}}": "number",
        [`query.v.${name(width - 1)}`]: "number",
      });
      return counter.keys;
    });
    (globalThis as any).paramKeyReads = undefined;
    // How much more work each doubling took than the one before: about 2 when linear.
    expect(
      Math.max(...counts.slice(1).map((count, index) => count / counts[index])),
    ).toBeLessThanOrEqual(2.2);
  });

  // A hand-written op fills every {{name}} in a JSON param's text, keys too, but sends an object's
  // keys as written: pb param won't turn one into the other.
  it("refuses to store a hand-written JSON param whose key takes an input as an object", () => {
    const op = networkOp({
      url: "https://shop.test/s",
      query: { v: '{"{{key}}":"kept","n":"seed"}' },
    });
    expect(() => paramOp(op, { fields: ["query.v.n"], as: "n" })).toThrow(
      'query.v.n: the key "{{key}}" in query.v takes an input',
    );
  });

  // JSON.parse reads any depth; so do pb param and renderRequest.
  it("templates, saves and sends a field of a stored JSON param or body nested 1,500 levels deep", () => {
    const { findRedactedPlaceholder } = require("../../native/record-typed-values.cjs");
    // Capped where Node 24's recursive JSON.stringify, which pb param saves with, fits a Linux CI stack.
    const depth = 1500;
    const raw = `{"n":"seed","deep":${'{"x":'.repeat(depth)}0${"}".repeat(depth)}}`;
    for (const where of ["query", "body"]) {
      const field = where === "query" ? "query.v.n" : "body.n";
      const { op } = paramOp(savedJsonOp(raw, where), { fields: [field], as: "n" });
      expect(op.args.n).toEqual({ type: "string", default: "seed" });
      // renderRequest reads any depth too.
      const sent = renderRequest(requestOf(op), { n: "next" }, { escapes: true });
      const text = where === "query" ? sent.query.v : JSON.stringify(sent.body);
      expect(text).toBe(raw.replace('"seed"', '"next"'));
      // Saved through validateOp, and read for a placeholder before it is sent, at that depth.
      const { cwd, file } = project(savedJsonOp(raw, where));
      expect(
        applyParam({ playbook: "shop", op: "search", cwd, fields: [field], as: "n" }).changed,
      ).toBe(true);
      const stored = JSON.parse(fs.readFileSync(file, "utf8"));
      expect(where === "query" ? requestOf(stored).query.v.n : requestOf(stored).body.n).toBe(
        "{{n}}",
      );
      expect(findRedactedPlaceholder(requestOf(stored))).toBeNull();
    }
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

  it("says a repeated query name stays in the request URL and can't be an input", () => {
    const repeated = networkOp({
      url: "https://shop.test/search?tag=a&tag=b",
      query: { q: "laptop" },
    });
    expect(() => paramOp(repeated, { fields: ["query.tag"], as: "tag" })).toThrow(
      'query.tag: query param "tag" repeats (2 values), so it stays in the request URL as captured and can\'t be an input',
    );
    expect(() => paramOp(repeated, { fields: ["query.missing"], as: "q" })).toThrow(
      /query.missing: no query param "missing" \(has: q\)/,
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

describe("pb param: the input a typed step drafted", () => {
  // A record masks the typed value (<text>) in the request; pb param gives it an input, and the
  // step's own input {{text}} goes once nothing the op runs fills or sends it.
  const check = { truthy: true, note: "{{text}}" };
  const typed = (strategies: Array<Record<string, unknown>>) => ({
    id: "search",
    effect: "read",
    args: { text: { required: true } },
    provenance: { recordId: "rec-1", escaped: true },
    on: { success: { expect: check } },
    run: [
      {
        using: "network",
        request: { method: "GET", url: "https://shop.test/s", query: { q: "<text>" } },
        verify: check,
        expect: check,
        extract: { path: "{{text}}" },
      },
      ...strategies,
    ],
  });
  const inputs = (strategies: Array<Record<string, unknown>>) =>
    Object.keys(paramOp(typed(strategies), { fields: ["query.q"], as: "q" }).op.args).sort();
  // The same op with no checks, so only the strategy given keeps the input.
  const unchecked = (strategy: Record<string, unknown>) => {
    const op = typed([strategy]);
    const { verify: _verify, expect: _expect, extract: _extract, ...network } = op.run[0];
    return Object.keys(
      paramOp({ ...op, on: {}, run: [network, strategy] }, { fields: ["query.q"], as: "q" }).op
        .args,
    ).sort();
  };

  it("drops it when only a check names it", () => {
    expect(inputs([])).toEqual(["q"]);
    const workflow = {
      using: "workflow",
      steps: [{ cmd: "click", args: { ref: "e1" } }],
      verify: check,
    };
    expect(inputs([workflow])).toEqual(["q"]);
    const api = {
      using: "api",
      match: "https://shop.test/s*",
      records: { path: "items", fields: { t: "{{text}}" } },
      verify: check,
    };
    expect(inputs([api])).toEqual(["q"]);
    const collect = { using: "collect", item: ".row", key: "{{text}}", fields: { t: "{{text}}" } };
    expect(inputs([collect])).toEqual(["q"]);
  });

  it("keeps it while a strategy fills it or is given every input", () => {
    const steps = [
      [{ cmd: "click", args: { ref: "e1" }, each: "{{text}}" }],
      [{ cmd: "click", args: { ref: "e1" }, as: "{{text}}" }],
      [{ repeat: 2, steps: [{ cmd: "click" }], until: { cmd: "js", args: { code: "{{text}}" } } }],
    ];
    for (const body of steps) {
      expect(unchecked({ using: "workflow", steps: body })).toEqual(["q", "text"]);
    }
    expect(
      unchecked({ using: "api", match: "https://shop.test/{{text}}", records: { path: "items" } }),
    ).toEqual(["q", "text"]);
    expect(
      unchecked({ using: "collect", item: "{{text}}", key: "id", fields: { t: "a" } }),
    ).toEqual(["q", "text"]);
    expect(unchecked({ using: "script", script: "return input" })).toEqual(["q", "text"]);
    expect(unchecked({ using: "native", handler: "h" })).toEqual(["q", "text"]);
    expect(
      unchecked({ using: "workflow", steps: [{ cmd: "click", args: { ref: "e1" } }] }),
    ).toEqual(["q"]);
  });

  // An escaped op fills the keys inside a header's object value as renderRequest sends it, so the
  // input stays and the op still runs.
  it("keeps it while an escaped header object's key takes it", () => {
    const op = typed([]);
    const { verify: _v, expect: _e, extract: _x, ...network } = op.run[0] as any;
    network.request.headers = { "X-Thing": { "{{text}}": "constant" } };
    const next = paramOp({ ...op, on: {}, run: [network] }, { fields: ["query.q"], as: "q" }).op;
    expect(Object.keys(next.args).sort()).toEqual(["q", "text"]);
    expect(() =>
      renderRequest(next.run[0].request, { q: "new", text: "t" }, { escapes: true }),
    ).not.toThrow();
  });

  // A workflow starts with the op's inputs as its vars, so a step's %{text} types --text, and a
  // check naming {{text}} changes nothing.
  const afterParam = (
    steps: unknown[],
    { escaped = true, onError }: { escaped?: boolean; onError?: string } = {},
  ) => {
    const op = typed([{ using: "workflow", ...(onError ? { onError } : {}), steps }]);
    return Object.keys(
      paramOp({ ...op, provenance: { escaped } }, { fields: ["query.q"], as: "q" }).op.args,
    ).sort();
  };
  const hover = (selector: unknown) => ({ cmd: "hover", args: { selector } });

  it("keeps it while a step reads it as a var where the workflow runtime fills vars", () => {
    for (const escaped of [true, false]) {
      for (const steps of [
        [hover("%{text}")],
        [hover([{ deep: "a %{text} b" }])],
        [{ each: "%{text}", steps: [hover("%{item}")] }],
        [{ repeat: "%{text}", steps: [hover("#s")] }],
        [{ repeat: 1, steps: [hover("#s")], until: { cmd: "js", args: { code: "%{text}" } } }],
        [{ repeat: 1, steps: [{ each: [1], steps: [hover("%{text}")] }] }],
        // A capture binds only once its step ran: before it, and under onError continue, it is the input.
        [hover("%{text}"), { ...hover("#s"), as: "text" }],
      ]) {
        expect(afterParam(steps, { escaped })).toEqual(["q", "text"]);
      }
      expect(
        afterParam([{ ...hover("#s"), as: "text" }, hover("%{text}")], {
          escaped,
          onError: "continue",
        }),
      ).toEqual(["q", "text"]);
    }
    // Only an escaped op reads a var inside an inline each list; any other op's list was filled before.
    expect(afterParam([{ each: ["%{text}"], steps: [hover("#s")] }])).toEqual(["q", "text"]);
    expect(afterParam([{ each: ["%{text}"], steps: [hover("#s")] }], { escaped: false })).toEqual([
      "q",
    ]);
  });

  it("drops it where no step reads it from the op's inputs", () => {
    for (const escaped of [true, false]) {
      for (const steps of [
        // An escape, a loop's own vars and a capture an earlier step made are no input.
        [hover("%{!}text}")],
        [{ each: [1], as: "text", steps: [hover("%{text}")] }],
        [{ ...hover("#s"), as: "text" }, hover("%{text}")],
        [
          {
            repeat: 1,
            steps: [{ ...hover("#s"), as: "text" }],
            until: { cmd: "js", args: { code: "%{text}" } },
          },
        ],
        // A loop's own args and a step's other fields are never filled with vars.
        [{ repeat: 1, args: { code: "%{text}" }, steps: [hover("#s")] }],
        [{ ...hover("#s"), id: "%{text}" }],
      ]) {
        expect(afterParam(steps, { escaped })).toEqual(["q"]);
      }
    }
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

  it("renames the var a step reads from the input, not a loop's own or a capture", () => {
    const vars = drafted();
    (vars.run[1] as any).steps = [
      { cmd: "type", args: { selector: "input.name", text: "{{text}} %{text}" } },
      { each: "%{text}", as: "text", steps: [{ cmd: "type", args: { text: "%{text}" } }] },
      { cmd: "js", args: { code: "1" }, as: "text" },
      { cmd: "type", args: { text: "%{text} %{!}text}" } },
    ];
    const { op, notes } = paramOp(vars, { fields: ["query.nameOrId"], as: "name", link: "text" });
    expect((op.run[1] as any).steps).toEqual([
      { cmd: "type", args: { selector: "input.name", text: "{{name}} %{name}" } },
      { each: "%{name}", as: "text", steps: [{ cmd: "type", args: { text: "%{text}" } }] },
      { cmd: "js", args: { code: "1" }, as: "text" },
      { cmd: "type", args: { text: "%{text} %{!}text}" } },
    ]);
    expect(notes).toEqual([
      "workflow fallback takes --name in place of --text: type text, loop each",
    ]);
    // A name no var can take (%{name} is \w+) leaves the var to edit by hand.
    const dashed = drafted();
    (dashed.run[1] as any).steps = [{ cmd: "type", args: { text: "%{text}" } }];
    expect(() =>
      paramOp(dashed, { fields: ["query.nameOrId"], as: "full-name", link: "text" }),
    ).toThrow(
      "--link text: a step reads %{text}, and --as full-name can't be a var name; pick a name of letters, digits and _",
    );
  });

  it("refuses to rename a %{text} a capture or loop var named text or the new name may shadow", async () => {
    const typed = { cmd: "type", args: { selector: "input.name", text: "{{text}} %{text}" } };
    const capture = (as: string) => ({ cmd: "js", args: { code: "'dummy'" }, as });
    const cases: Array<[string, unknown[], Record<string, unknown>, string]> = [
      // The new name is a capture, so %{name} would read it, not --name.
      ["target capture", [capture("name"), typed], {}, "name"],
      // The new name is the loop's var, so %{name} would read the item, not --name.
      ["target loop var", [{ each: ["a"], as: "name", steps: [typed] }], {}, "name"],
      // A later step in the loop body captures name, so a second pass would read it.
      ["target later in loop", [{ repeat: 2, steps: [typed, capture("name")] }], {}, "name"],
      // A loop may have captured text, so %{text} may read that, not the input.
      ["source loop capture", [{ repeat: 1, steps: [capture("text")] }, typed], {}, "text"],
      // Under onError continue a capture may or may not be set.
      ["source continue capture", [capture("text"), typed], { onError: "continue" }, "text"],
    ];
    for (const escaped of [false, true]) {
      for (const [label, steps, workflow, shadow] of cases) {
        const op = drafted({ provenance: { escaped } });
        Object.assign(op.run[1], { steps, ...workflow });
        const message =
          `--link text: type text reads %{text} where a capture or loop var ${shadow} may be set, ` +
          `so it may not read the input; ${shadow === "name" ? "pick another --as" : "rename that var, or edit the op by hand"}`;
        expect(
          () => paramOp(op, { fields: ["query.nameOrId"], as: "name", link: "text" }),
          `${label}, escaped ${escaped}`,
        ).toThrow(message);
        const { cwd, file } = project(op);
        const before = fs.readFileSync(file, "utf8");
        await expect(
          handlePlaybookCli(
            ["pb", "param", "shop", "search", "query.nameOrId", "--as", "name", "--link", "text"],
            { cwd },
          ),
        ).rejects.toThrow(message);
        expect(fs.readFileSync(file, "utf8")).toBe(before);
      }
    }
  });

  it("still renames a %{text} no capture or loop var could shadow", () => {
    for (const escaped of [false, true]) {
      const op = drafted({ provenance: { escaped } });
      (op.run[1] as any).steps = [
        { cmd: "type", args: { text: "{{text}} %{text}" } },
        // Captures made after the step, outside any loop, can't reach it.
        { cmd: "js", args: { code: "'dummy'" }, as: "name" },
        { each: ["a"], as: "item", steps: [{ cmd: "js", args: { code: "'dummy'" }, as: "text" }] },
      ];
      const { op: next } = paramOp(op, { fields: ["query.nameOrId"], as: "name", link: "text" });
      expect((next.run[1] as any).steps[0]).toEqual({
        cmd: "type",
        args: { text: "{{name}} %{name}" },
      });
    }
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

describe("pb param: what it prints about the value it removed", () => {
  // Dummy values, built from parts so no literal here reads as a credential.
  const VALUE = ["dummy", "q", "8"].join("-");
  const HEADER_VALUE = ["dummy", "site", "key", "8"].join("-");

  const printed = async (cwd: string, args: string[]) => {
    const text = await handlePlaybookCli(["pb", "param", "shop", "search", ...args], { cwd });
    return String(text.value);
  };

  it("keeps a --required input's recorded value out of the diff, notes and JSON result", async () => {
    const request = { url: "https://shop.test/search", query: { q: VALUE } };
    const op = networkOp(request);
    op.run.push({ using: "workflow", steps: [{ cmd: "click", args: { ref: "e9" } }] } as never);
    const { cwd } = project(op);
    const text = await printed(cwd, ["query.q", "--as", "q", "--required"]);
    expect(text).toMatch(/^- .*<redacted>/m);
    expect(text).toContain("workflow strategy unchanged");
    expect(text).not.toContain(VALUE);

    const again = project(op);
    const json = await handlePlaybookCli(
      ["pb", "param", "shop", "search", "query.q", "--as", "q", "--required", "--json"],
      { cwd: again.cwd },
    );
    expect(JSON.stringify(json.value)).not.toContain(VALUE);
  });

  it("keeps a nested JSON literal out of the diff, double-escaped in the op file", async () => {
    // A quote and a backslash, so the op file holds it escaped twice (JSON inside a JSON string).
    const quoted = ["dummy", 'quo"ted', "va\\lue", "14"].join("-");
    const variables = JSON.stringify({ token: quoted, page: 2 });
    const { cwd, file } = project(
      networkOp({ url: "https://shop.test/graphql", query: { variables } }),
    );
    expect(fs.readFileSync(file, "utf8")).toContain(
      JSON.stringify(JSON.stringify(quoted).slice(1, -1)).slice(1, -1),
    );
    const text = await printed(cwd, ["query.variables.token", "--as", "token", "--required"]);
    expect(text).toMatch(/^- .*<redacted>/m);
    expect(text).not.toContain("dummy");
    expect(text).not.toContain("lue-14");
  });

  it("keeps an --env header's recorded value out of the diff", async () => {
    const { cwd } = project(
      networkOp({ url: "https://shop.test/search", headers: { "X-Site-Key": HEADER_VALUE } }),
    );
    const text = await printed(cwd, ["headers.X-Site-Key", "--env", "SHOP_SITE_KEY"]);
    expect(text).toMatch(/^- .*"X-Site-Key": "<redacted>"/m);
    expect(text).not.toContain(HEADER_VALUE);
  });

  it("still shows a value that becomes a default", async () => {
    const { cwd } = project(networkOp({ url: "https://shop.test/search", query: { q: VALUE } }));
    expect(await printed(cwd, ["query.q", "--as", "q"])).toContain(VALUE);
  });
});
