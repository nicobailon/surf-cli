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

  it("replaces every occurrence of a known secret, whatever its length, with anyLength", () => {
    expect(redaction.redactValues("prefixabcSuffix abc", ["abc"], { anyLength: true })).toBe(
      "prefix<redacted>Suffix <redacted>",
    );
    expect(redaction.redactObject({ prefixabcKey: "xabcx" }, ["abc"], { anyLength: true })).toEqual(
      { "prefix<redacted>Key": "x<redacted>x" },
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
  const SHORT = "qzx";
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
  const echo = (key: string) => ({ note: `prefix${key}Suffix`, [`k${key}k`]: 1 });

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
    expect(result.value).toEqual({ note: "prefix<redacted>Suffix", "k<redacted>k": 1 });
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
        expect(JSON.parse(stdout)).toEqual({ note: "prefix<redacted>Suffix", "k<redacted>k": 1 });
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
});

describe("redactUrlsInText", () => {
  it("redacts every URL in a line and leaves the rest as written", () => {
    const user = ["dummy", "user"].join("-");
    const pass = ["dummy", "pw", "12"].join("-");
    const line = `API_REQUEST: GET https://${user}:${pass}@example.test/a?token=${pass} streamId=7`;
    expect(redaction.redactUrlsInText(line)).toBe(
      "API_REQUEST: GET https://example.test/a?token=%3Credacted%3E streamId=7",
    );
  });
});
