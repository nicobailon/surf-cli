import { describe, expect, it } from "vitest";

const redaction = require("../../native/redaction.cjs");

// Dummy credentials, built from parts so no literal in this file reads as one.
const USER = ["dummy", "user"].join("-");
const PASS = ["dummy", "pw", "41"].join("-");
const TOKEN = ["dummy", "tok", "41"].join("-");

describe("redactUrlSecrets", () => {
  it("drops the URL's user and password along with secret-named query values", () => {
    const url = redaction.redactUrlSecrets(
      `https://${USER}:${PASS}@example.test/a?token=${TOKEN}&page=2`,
    );
    expect(url).not.toContain(USER);
    expect(url).not.toContain(PASS);
    expect(url).not.toContain(TOKEN);
    expect(url).toBe("https://example.test/a?token=%3Credacted%3E&page=2");
  });

  it("keeps a navigate step's URL password out of every file the journal writes", () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const { journalCommand } = require("../../native/activity-journal.cjs");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "surf-url-journal-"));
    try {
      journalCommand("navigate", { url: `https://${USER}:${PASS}@example.test/` }, { root });
      const files = fs
        .readdirSync(root, { recursive: true })
        .map((name: string) => path.join(root, name))
        .filter((file: string) => fs.statSync(file).isFile());
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        expect(fs.readFileSync(file, "utf8")).not.toContain(PASS);
      }
      expect(fs.readFileSync(files[0], "utf8")).toContain('"url":"https://example.test/"');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("redactValues", () => {
  it("replaces a short value only where it stands alone, by default", () => {
    expect(redaction.redactValues("prefixabcSuffix abc", ["abc"])).toBe(
      "prefixabcSuffix <redacted>",
    );
  });

  it("replaces every occurrence of a known secret of 4 characters or more, with anyLength", () => {
    expect(redaction.redactValues("prefixabcdSuffix abcd", ["abcd"], { anyLength: true })).toBe(
      "prefix<redacted>Suffix <redacted>",
    );
    // A key is a field's name: only a key that is the whole value is redacted.
    expect(
      redaction.redactObject({ prefixabcdKey: "xabcdx", abcd: 1 }, ["abcd"], { anyLength: true }),
    ).toEqual({ prefixabcdKey: "x<redacted>x", "<redacted>": 1 });
  });

  it.each(["a", "1"])(
    "replaces a known secret under 4 characters (%s) only as a whole token",
    (value) => {
      const text = `type tool.failed ${value} at step 21 of a run`;
      const expected = text.replace(
        new RegExp(`(?<![A-Za-z0-9])${value}(?![A-Za-z0-9])`, "g"),
        "<redacted>",
      );
      expect(redaction.redactValues(text, [value], { anyLength: true })).toBe(expected);
      expect(redaction.redactValues("tool.failed", [value], { anyLength: true })).toBe(
        "tool.failed",
      );
    },
  );
});

describe("redactSecretValues", () => {
  // A dummy value with a quote and a backslash, so its escaped spellings differ from it.
  const QUOTED = ["dummy", 'quo"ted', "va\\lue"].join("-");
  const once = JSON.stringify(QUOTED).slice(1, -1);
  const twice = JSON.stringify(once).slice(1, -1);

  it("redacts a value as is, JSON-escaped once and twice, and URL- or form-encoded", () => {
    const text = [
      QUOTED,
      once,
      twice,
      encodeURIComponent(QUOTED),
      new URLSearchParams({ q: `a b ${QUOTED}` }).toString(),
    ].join(" | ");
    const redacted = redaction.redactSecretValues(text, [QUOTED]);
    expect(redacted).not.toContain("dummy");
    expect(redaction.valueSpellings(QUOTED)).toEqual(
      expect.arrayContaining([QUOTED, once, twice, encodeURIComponent(QUOTED)]),
    );
  });
});

describe("a short env value inside a longer string", () => {
  const fs = require("node:fs");
  const http = require("node:http");
  const os = require("node:os");
  const path = require("node:path");
  const { execFile } = require("node:child_process");
  const runtime = require("../../native/playbook-runtime.cjs");
  const clients = require("../../native/playbook-client.cjs");
  // A dummy env value, short enough that the stand-alone rule would skip it inside a word.
  const SHORT = "qzxw";
  const op = {
    id: "items",
    effect: "read",
    args: {},
    run: [
      {
        using: "network",
        request: {
          method: "GET",
          url: "https://api.test/items",
          authInputs: [{ env: "SURF_TEST_SHORT_KEY", header: "X-Site-Key" }],
        },
      },
    ],
  };
  const echo = (key: string) => ({ note: `prefix${key}Suffix`, [key]: 1 });

  it("is redacted from a playbook run's result", async () => {
    const executeTool = async (_tool: string, args: { code: string }) => {
      const fetchImpl = async (url: string, init: { headers: Record<string, string> }) => ({
        status: 200,
        ok: true,
        url,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => JSON.stringify(echo(init.headers["X-Site-Key"])),
      });
      const value = await new Function("fetch", "location", `return ${args.code}`)(fetchImpl, {
        href: "https://api.test/",
      });
      return { output: JSON.stringify(value) };
    };
    const result = await runtime.runPlaybookOp({
      playbook: { id: "shop", provenance: { scope: "test" } },
      op: { ...op, run: [{ ...op.run[0], extract: { jsonPath: "$" } }] },
      secrets: { SURF_TEST_SHORT_KEY: SHORT },
      env: {},
      executeTool,
    });
    expect(JSON.stringify(result.value)).not.toContain(SHORT);
    expect(result.value).toEqual({ note: "prefix<redacted>Suffix", "<redacted>": 1 });
  });

  it("is redacted from a generated client's output", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "surf-short-key-"));
    try {
      clients.generateClient({
        playbookId: "shop",
        op,
        strategy: op.run[0],
        provenance: { type: "playbook", id: "shop" },
        out: path.join(out, "client"),
      });
      const server = http.createServer((req: any, res: any) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(echo(req.headers["x-site-key"])));
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const stdout = await new Promise<string>((resolve, reject) =>
          execFile(
            process.execPath,
            [path.join(out, "client", "client.mjs")],
            {
              env: {
                ...process.env,
                SURF_TEST_SHORT_KEY: SHORT,
                SURF_CLIENT_ORIGIN: `http://127.0.0.1:${server.address().port}`,
              },
            },
            (error: Error | null, output: string) => (error ? reject(error) : resolve(output)),
          ),
        );
        expect(stdout).not.toContain(SHORT);
        expect(JSON.parse(stdout)).toEqual({ note: "prefix<redacted>Suffix", "<redacted>": 1 });
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
});

describe("redactUrlsInText", () => {
  it("redacts a quoted token whole, its tail included, and leaves other URLs as written", () => {
    const quoted = ["dummy", 'quo"ted', "va\\lue", "13"].join("-");
    const line = `API_REQUEST: GET https://example.test/v1?access_token=${quoted}&page=2 then "https://example.test/x?a=1"`;
    const redacted = redaction.redactUrlsInText(line);
    expect(redacted).not.toContain("dummy");
    expect(redacted).not.toContain("quo");
    expect(redacted).not.toContain("lue-13");
    expect(redacted).toContain('then "https://example.test/x?a=1"');
  });

  it("redacts every URL in a line and leaves the rest as written", () => {
    const user = ["dummy", "user"].join("-");
    const pass = ["dummy", "pw", "12"].join("-");
    const line = `API_REQUEST: GET https://${user}:${pass}@example.test/a?token=${pass} streamId=7`;
    expect(redaction.redactUrlsInText(line)).toBe(
      "API_REQUEST: GET https://example.test/a?token=%3Credacted%3E streamId=7",
    );
  });
});

describe("a short env value that names a field", () => {
  const fs = require("node:fs");
  const http = require("node:http");
  const os = require("node:os");
  const path = require("node:path");
  const { execFile } = require("node:child_process");
  const runtime = require("../../native/playbook-runtime.cjs");
  const clients = require("../../native/playbook-client.cjs");
  const { formatTestReport } = require("../../native/playbook-test.cjs");
  const op = {
    id: "items",
    effect: "read",
    args: {},
    run: [
      {
        using: "network",
        request: {
          method: "GET",
          url: "https://api.test/items",
          authInputs: [{ env: "SURF_TEST_FIELD_KEY", header: "X-Site-Key" }],
        },
        extract: { jsonPath: "$" },
      },
    ],
  };
  // Runs the op on a page whose fetch answers `body`.
  const run = (value: string, body: unknown, assertions?: unknown[]) =>
    runtime.runPlaybookOp({
      playbook: { id: "shop", provenance: { scope: "test" } },
      op,
      secrets: { SURF_TEST_FIELD_KEY: value },
      env: {},
      ...(assertions ? { assertions } : {}),
      executeTool: async (_tool: string, args: { code: string }) => {
        const fetchImpl = async (url: string) => ({
          status: 200,
          ok: true,
          url,
          headers: new Headers({ "content-type": "application/json" }),
          text: async () => JSON.stringify(body),
        });
        const result = await new Function("fetch", "location", `return ${args.code}`)(fetchImpl, {
          href: "https://api.test/",
        });
        return { output: JSON.stringify(result) };
      },
    });
  const data = { id: 7, trueCount: 3, items: [{ id: 1, path: 2, pass: 3 }] };

  it.each(["id", "true", "path", "pass"])(
    "leaves result keys and assertion fields as named with env %s, and pb test passes",
    async (value) => {
      const assertion = { path: "$.trueCount", op: "equals", value: 3 };
      const result = await run(value, value.length >= 4 ? { trueCount: 3 } : data, [assertion]);
      expect(result.status).toBe("completed");
      if (value.length < 4) {
        expect(result.value).toEqual(data);
      } else {
        expect(Object.keys(result.value)).toEqual(["trueCount"]);
      }
      // secretSensitive marks a path that holds the value (`$.trueCount` holds `true`).
      expect(Object.keys(result.assertions[0])).toEqual(
        expect.arrayContaining(["actual", "op", "pass", "path", "value"]),
      );
      expect(JSON.stringify(Object.keys(result.assertions[0]))).not.toContain("redacted");
      expect(result.assertions[0]).toMatchObject({ op: "equals", value: 3, pass: true, actual: 3 });
      const report = formatTestReport({
        ok: true,
        playbook: "shop",
        op: "items",
        strategy: result.strategy,
        records: null,
        durationMs: 1,
        assertions: result.assertions,
        attempts: [],
        saved: null,
      });
      expect(report).toMatch(/^PASS shop items/);
      expect(report).toMatch(/\n {2}pass {2}\S+ equals 3 \(3\)$/);
    },
  );

  it("still redacts a key that is the whole env value, of 4 characters or more", async () => {
    const value = ["q", "z", "x", "w"].join("");
    const result = await run(value, { [value]: 1, [`${value}Count`]: 2 });
    expect(result.value).toEqual({ "<redacted>": 1, [`${value}Count`]: 2 });
  });

  it("is redacted from a generated client's text output in every spelling", async () => {
    // A dummy value with a quote and a backslash, so its JSON-escaped spelling differs from it.
    const value = ["dummy", 'quo"ted', "va\\lue", "16"].join("-");
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "surf-client-spellings-"));
    try {
      clients.generateClient({
        playbookId: "shop",
        op,
        strategy: { ...op.run[0], extract: undefined },
        provenance: { type: "playbook", id: "shop" },
        out: path.join(out, "client"),
      });
      const server = http.createServer((req: any, res: any) => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(
          `echo ${JSON.stringify(req.headers["x-site-key"])} and ${encodeURIComponent(req.headers["x-site-key"])}`,
        );
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const stdout = await new Promise<string>((resolve, reject) =>
          execFile(
            process.execPath,
            [path.join(out, "client", "client.mjs")],
            {
              env: {
                ...process.env,
                SURF_TEST_FIELD_KEY: value,
                SURF_CLIENT_ORIGIN: `http://127.0.0.1:${server.address().port}`,
              },
            },
            (error: Error | null, output: string) => (error ? reject(error) : resolve(output)),
          ),
        );
        expect(stdout).toContain("echo ");
        expect(stdout).not.toContain("dummy");
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
});

describe("redactEchoJson", () => {
  it("redacts a short auth parameter in a JSON text held in a string value, which still parses", () => {
    const secrets = redaction.secretHeaderEchoes([{ Authorization: 'ResyAPI api_key="v"' }]);
    const view = redaction.redactEchoJson(
      { data: JSON.stringify({ echo: "v", n: 1 }), note: "v", other: "{v}" },
      secrets,
    );
    expect(JSON.parse(view.data)).toEqual({ echo: "<redacted>", n: 1 });
    expect(view.note).toBe("<redacted>");
    expect(view.other).toBe("{v}");
  });
});
