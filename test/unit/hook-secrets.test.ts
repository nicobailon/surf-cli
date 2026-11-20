import { describe, expect, it } from "vitest";

// Secrets in a request body surf keeps as a string (text/plain, no type, multipart, XML…) stay out
// of the saved op: form or JSON text is read as such (A), a secret-named field's value becomes
// {{name}} (B), a value surf knows is secret is replaced wherever it sits (C), and a body that still
// holds a secret-looking key with a literal value is refused without --keep-body (D).

declare const require: (moduleName: string) => any;

const fs = require("node:fs");
const path = require("node:path");
const { formatHook, parseHookArgs } = require("../../native/hook-cli.cjs");
const { nameInputs, requestOf, isSecret } = require("../../native/op-inputs.cjs");
const { makeOp } = require("../../native/op-pipeline.cjs");
const { renderRequest } = require("../../native/op-run.cjs");

// Dummy secrets, built from parts so no scanner takes them for real ones.
const password = ["hun", "ter", "2"].join("");
const typedPassword = ["Tr0ub4", "dor-", "x9"].join("");
const token = ["tk", "_live_", "9f8e7d6c"].join("");
const sessionId = ["s3ss", "10n", "ABCDEF"].join("");

let seq = 0;
const post = (body: string, type?: string, headers: Record<string, string> = {}) => ({
  id: `r_${++seq}`,
  method: "POST",
  status: 200,
  type: "Fetch",
  mimeType: "application/json",
  url: "https://httpbin.org/post",
  ts: 3000,
  requestHeaders: { ...(type ? { "Content-Type": type } : {}), ...headers },
  requestBody: body,
  responseBody: '{"data":"ok"}',
});
const page = {
  id: "r_page",
  method: "GET",
  status: 200,
  type: "Document",
  mimeType: "text/html",
  url: "https://httpbin.org/forms/post",
  ts: 1000,
  requestHeaders: {},
  responseBody: "<html><body><form></form></body></html>",
};
const named = (body: string, type?: string, extra: Record<string, unknown> = {}) =>
  nameInputs({ request: requestOf(post(body, type)), ...extra });
const opFile = (site: string, id: string) =>
  path.join(String(process.env.HOME), ".surf", "playbooks", site, "ops", `${id}.json`);
const hook = (
  entry: Record<string, unknown>,
  { site = `sec-${++seq}`, ...extra }: Record<string, unknown> = {},
) =>
  makeOp({
    capture: { pageUrl: page.url, pageText: "order", after: 2000, entries: [page, entry] },
    goal: "send the order",
    match: "/post",
    site,
    op: "order",
    sleep: () => Promise.resolve(),
    ...extra,
  });

describe("A: form or JSON text sent as text/plain or untyped", () => {
  it("templates a secret field of form text sent as text/plain and saves no trace of its value", async () => {
    const body = `custname=Ada&password=${password}`;
    const result = await hook(post(body, "text/plain;charset=UTF-8"));
    expect(result.status).toBe("saved");
    const saved = fs.readFileSync(result.file, "utf8");
    expect(saved).not.toContain(password);
    const op = JSON.parse(saved);
    expect(op.request.body).toBe("custname=Ada&password={{password}}");
    expect(op.args.password).toEqual({ required: true });
    expect(op.request.headers).toEqual({ "content-type": "text/plain;charset=UTF-8" });
    // Replay: the same bytes, the value filled in.
    expect(renderRequest(op.request, { args: { password }, env: {} }).body).toBe(body);
    // The send counts toward the write guard, keyed on the value the body carried.
    const { reserveReceipt } = require("../../native/playbook-receipts.cjs");
    const { resolveArgs } = require("../../native/playbook-runtime.cjs");
    const { validateOp } = require("../../native/playbooks.cjs");
    const loaded = validateOp(op, { origins: [] });
    const send = (value: string) =>
      reserveReceipt({
        playbookId: result.playbook,
        op: loaded,
        args: resolveArgs(loaded, { password: value }),
      });
    expect(() => send(password)).toThrow(/write blocked by verified receipt/);
    expect(send(`${password}-other`)).toBeTruthy();
  });

  it("templates JSON sent as text/plain and keeps the body a string (GraphQL variables too)", () => {
    const body = `{"query":"mutation Login($token: String!) { login(token: $token) { ok } }","variables":{"token":"${token}","n":2}}`;
    const result = named(body, "text/plain");
    expect(typeof result.request.body).toBe("string");
    expect(result.request.body).toBe(body.replace(token, "{{token}}"));
    expect(result.args).toEqual({ token: { required: true } });
    const sent = renderRequest(result.request, { args: { token }, env: {} });
    expect(sent.body).toBe(body);
    expect(sent.headers).toEqual({ "content-type": "text/plain" });
    // A value that needs escaping is filled in as the format writes it.
    const tricky = 'a"b\\c&d';
    expect(
      JSON.parse(renderRequest(result.request, { args: { token: tricky }, env: {} }).body).variables
        .token,
    ).toBe(tricky);
  });

  it("names a typed value in form text with no type, and fills a value with & or spaces form-encoded", () => {
    const result = named("custname=Ada+Lovelace&size=large", undefined, {
      typed: ["Ada Lovelace"],
    });
    expect(result.request.body).toBe("custname={{custname}}&size=large");
    expect(result.args.custname).toEqual({ required: true, example: "Ada Lovelace" });
    const sent = renderRequest(result.request, { args: { custname: "Ada Lovelace" }, env: {} });
    expect(sent.body).toBe("custname=Ada+Lovelace&size=large");
    const odd = renderRequest(result.request, { args: { custname: "a&b=c" }, env: {} }).body;
    expect(new URLSearchParams(odd).get("custname")).toBe("a&b=c");
  });

  it("leaves a body labelled with another type to the other rules", () => {
    expect(named(`password=${password}`, "application/xml").request.body).toBe(
      "password={{password}}",
    );
    // Text that is neither form nor JSON stays as it is.
    expect(named("hello world", "text/plain").request.body).toBe("hello world");
  });
});

describe("B: a secret-named field's value in any string body", () => {
  // The named body, what the op keeps, and the body a replay with `args` sends.
  const replay = (body: string, type?: string, args: Record<string, string> = {}) => {
    const result = named(body, type);
    const kept = JSON.stringify([result.request, result.args]);
    return { result, kept, sent: renderRequest(result.request, { args, env: {} }).body };
  };

  it("secretkey=value lines (an HTML form sent as text/plain)", () => {
    const body = `custname=Ada\r\npassword=${password}\r\n`;
    const { result, kept, sent } = replay(body, "text/plain", { password });
    expect(kept).not.toMatch(new RegExp(`${password}|${token}`));
    expect(sent).toBe(body);
    expect(result.request.body).toBe("custname=Ada\r\npassword={{password}}\r\n");
    expect(result.args).toEqual({ password: { required: true } });
  });

  it('"secretkey": "value" in JSON-like text', () => {
    const body = `{"user":"ada"}\n{"api_key": "${token}"}`;
    const { result, kept, sent } = replay(body, "application/x-ndjson", { api_key: token });
    expect(kept).not.toMatch(new RegExp(`${password}|${token}`));
    expect(sent).toBe(body);
    expect(result.request.body).toBe('{"user":"ada"}\n{"api_key": "{{api_key}}"}');
    expect(result.args).toEqual({ api_key: { required: true } });
  });

  it("secretkey: value in YAML-like text", () => {
    const body = `user: ada\npassword: ${password}\n`;
    const { result, kept, sent } = replay(body, "application/yaml", { password });
    expect(kept).not.toMatch(new RegExp(`${password}|${token}`));
    expect(sent).toBe(body);
    expect(result.request.body).toBe("user: ada\npassword: {{password}}\n");
  });

  it('a multipart name="secretkey" part', () => {
    const body = [
      "--XyZ",
      'Content-Disposition: form-data; name="user"',
      "",
      "ada",
      "--XyZ",
      'Content-Disposition: form-data; name="password"',
      "",
      password,
      "--XyZ--",
      "",
    ].join("\r\n");
    const { result, kept, sent } = replay(body, "multipart/form-data; boundary=XyZ", { password });
    expect(kept).not.toMatch(new RegExp(`${password}|${token}`));
    expect(sent).toBe(body);
    expect(result.request.body).toBe(body.replace(password, "{{password}}"));
    expect(result.args).toEqual({ password: { required: true } });
  });

  it("keeps token_count=5 and other words about a secret literal", () => {
    for (const body of ["token_count=5&custname=Ada", "token_count=5\r\nq=x"]) {
      const result = named(body, "text/plain");
      expect(result.request.body).toBe(body);
      expect(result.args).toEqual({});
    }
    for (const name of [
      "token_count",
      "tokenCount",
      "token_type",
      "password_length",
      "api_key_id",
      "token_expires_at",
      "refresh_token_expires_in",
      "client_secret_type",
      "token_count2",
    ]) {
      expect([name, isSecret(name)]).toEqual([name, false]);
    }
    for (const name of [
      "token",
      "id_token",
      "session_id",
      "sessionId",
      "password2",
      "csrf_token",
    ]) {
      expect([name, isSecret(name)]).toEqual([name, true]);
    }
  });
});

describe("C: a value surf knows is secret, under any key", () => {
  it("reads what the page's password fields hold when the capture ends", async () => {
    const { captureHook } = require("../../native/op-pipeline.cjs");
    const codes: string[] = [];
    const capture = await captureHook({
      url: page.url,
      tabId: 1,
      sleep: () => Promise.resolve(),
      executeTool: async (tool: string, args: { code?: string }) => {
        if (tool !== "javascript_tool") {
          return { success: true };
        }
        codes.push(String(args.code));
        return {
          output: JSON.stringify({ url: page.url, text: "order", secrets: [typedPassword] }),
        };
      },
      callExtension: async (message: { type: string }) =>
        message.type === "READ_NETWORK_REQUESTS" ? { entries: [] } : {},
    });
    expect(capture.secrets).toEqual([typedPassword]);
    expect(codes[0]).toMatch(/input\.type === 'password'/);
  });

  it("scrubs a password typed into a password field and sent under a neutral key", async () => {
    const body = `custname=Ada&p=${typedPassword}`;
    const result = await hook(post(body, "text/plain"), {
      typed: ["Ada", typedPassword],
      capture: {
        pageUrl: page.url,
        pageText: "order",
        after: 2000,
        entries: [page, post(body, "text/plain")],
        secrets: [typedPassword],
      },
    });
    expect(result.status).toBe("saved");
    const saved = fs.readFileSync(result.file, "utf8");
    expect(saved).not.toContain(typedPassword);
    const op = JSON.parse(saved);
    expect(op.request.body).toBe("custname={{custname}}&p={{p}}");
    expect(op.args.p).toEqual({ required: true });
    expect(
      renderRequest(op.request, { args: { custname: "Ada", p: typedPassword }, env: {} }).body,
    ).toBe(body);
  });

  it("scrubs a secret-named sample, a cookie value and an auth token in a body surf doesn't parse", () => {
    const body = `<order><who>ada</who><pin>${password}xx</pin><s>${sessionId}</s><t>${token}</t></order>`;
    const request = requestOf(post(body, "application/xml"));
    const result = nameInputs({
      request,
      samples: { password: `${password}xx` },
      secrets: [
        { value: sessionId, name: "sid" },
        { value: token, name: "authorization" },
      ],
    });
    expect(result.request.body).toBe(
      "<order><who>ada</who><pin>{{password}}</pin><s>{{sid}}</s><t>{{authorization}}</t></order>",
    );
    expect(result.args).toEqual({
      password: { required: true },
      sid: { required: true },
      authorization: { required: true },
    });
    expect(result.warnings.join("\n")).not.toMatch(/isn't in the picked request/);
    // The values stay in memory, for the test run; the op holds none of them.
    expect(JSON.stringify([result.request, result.args])).not.toMatch(
      new RegExp(`${password}|${sessionId}|${token}`),
    );
    expect(result.values).toEqual({
      password: `${password}xx`,
      sid: sessionId,
      authorization: token,
    });
  });

  it("finds cookie and auth values in the capture and skips values under 6 characters", async () => {
    const body = `note=${sessionId}&tag=abc12`;
    const entry = post(body, "text/plain", {
      Cookie: `theme=dark; sid=${sessionId}`,
      Authorization: "Bearer abc12",
    });
    const result = await hook(entry, { dryRun: true });
    expect(result.draft.request.body).toBe("note={{sid}}&tag=abc12");
    expect(result.draft.args).toEqual({ sid: { required: true } });
  });
});

describe("D: a secret-looking key still holding a literal value", () => {
  const xml = `<login><user>ada</user><password>${password}</password></login>`;

  it("refuses to save without --keep-body and prints no draft", async () => {
    const site = `refuse-${process.pid}`;
    const result = await hook(post(xml, "application/xml"), { site });
    expect(result).toMatchObject({ status: "error", exitCode: 1 });
    expect(result.error).toBe(
      'the request body keeps a literal value under "password", a secret-looking key surf could not make an input, so nothing was saved; check the body, then add --keep-body to save it as it is; the request was already sent once, so a rerun with --keep-body sends it again',
    );
    expect(JSON.stringify(result)).not.toContain(password);
    expect(formatHook(result, []).stdout).toBe("");
    expect(fs.existsSync(opFile(site, "order"))).toBe(false);
  });

  it("refuses a literal inside another field's value, such as GraphQL's inline argument", async () => {
    const body = `{"query":"mutation { login(password: \\"${password}\\") { ok } }"}`;
    const result = await hook(post(body, "text/plain"));
    expect(result).toMatchObject({ status: "error", refused: "keep-body" });
    expect(result.error).toMatch(/under "password"/);
    // A repeated secret form key is no literal: each value is its own input.
    expect(named(`password=${password}&password=${token}`, "text/plain").request.body).toBe(
      "password={{password}}&password={{password_2}}",
    );
  });

  it("saves it with --keep-body and says so", async () => {
    const result = await hook(post(xml, "application/xml"), { keepBody: true });
    expect(result.status).toBe("saved");
    expect(JSON.parse(fs.readFileSync(result.file, "utf8")).request.body).toBe(xml);
    expect(result.warnings).toEqual([
      "the request body (application/xml) is in a format surf doesn't parse, so it is saved as sent apart from secret-named fields and secret values surf saw; check it before you share the op",
      '--keep-body: the request body keeps a literal value under "password"',
    ]);
    expect(formatHook(result, []).stdout).toMatch(
      /^Warning: the request body \(application\/xml\)/m,
    );
  });

  it("warns for an unparsed body with no secret, and not for form or JSON text", async () => {
    const plain = await hook(post("order one pizza", undefined));
    expect(plain.status).toBe("saved");
    expect(plain.warnings).toEqual([
      "the request body (no content type) is in a format surf doesn't parse, so it is saved as sent apart from secret-named fields and secret values surf saw; check it before you share the op",
    ]);
    const form = await hook(post("custname=Ada&token_count=5", "text/plain"));
    expect(form.warnings).toEqual([]);
  });

  it("takes --keep-body on surf hook as a flag", () => {
    const parsed = parseHookArgs([
      "https://httpbin.org/forms/post",
      "--goal",
      "order",
      "--keep-body",
    ]);
    expect(parsed.spec["keep-body"]).toBe(true);
    expect(parsed.spec.samples).toEqual({});
  });
});

describe("review round: names, truncation, XML, a resend, the picked line", () => {
  const pw = ["hun", "ter2", "-Zq9"].join("");

  it("keeps an id or number of a secret secret, in an op and in the saved network log; only a key's id is literal", () => {
    const { isSensitiveName } = require("../../native/redaction.cjs");
    const credentials = [
      "secret_id",
      "secretId",
      "secret_ids",
      "token_id",
      "tokenId",
      "session_token_id",
      "access_token_id",
      "csrf_id",
      "otp_number",
      "otp_num",
      "session_id",
      "X-Token-Id",
      "X-Secret-Id",
    ];
    for (const name of credentials) {
      expect([name, isSecret(name)]).toEqual([name, true]);
    }
    for (const name of ["token_id", "X-Token-Id", "X-Secret-Id", "secret_id", "csrf_id"]) {
      expect([name, isSensitiveName(name)]).toEqual([name, true]);
    }
    for (const name of ["token_count", "api_key_id", "apiKeyId", "api_key_ids"]) {
      expect([name, isSecret(name), isSensitiveName(name)]).toEqual([name, false, false]);
    }
    // Vault AppRole's login and ForgeRock's tokenId become inputs.
    const approle = nameInputs({
      request: requestOf(post(`{"role_id":"r-123","secret_id":"${pw}"}`, "application/json")),
    });
    expect(approle.request.body).toEqual({ role_id: "r-123", secret_id: "{{secret_id}}" });
    const forge = named(`tokenId=${pw}&token_count=5&api_key_id=k-1`, "text/plain");
    expect(forge.request.body).toBe("tokenId={{token_id}}&token_count=5&api_key_id=k-1");
    expect(forge.args).toEqual({ token_id: { required: true } });
    // The network log redacts them in the URL, a header, and a JSON and a form body.
    const networkStore = require("../../native/network-store.cjs");
    const base = path.join(
      fs.mkdtempSync(path.join(require("node:os").tmpdir(), "surf-ids-")),
      "network",
    );
    networkStore.appendEntrySync(
      {
        method: "POST",
        url: `https://a.example/login?token_id=${pw}&token_count=5`,
        requestHeaders: { "Content-Type": "application/json", "X-Token-Id": pw, "X-Secret-Id": pw },
        requestBody: `{"role_id":"r-123","secret_id":"${pw}","otp_number":"${pw}"}`,
      },
      base,
    );
    networkStore.appendEntrySync(
      {
        method: "POST",
        url: "https://a.example/sso",
        requestHeaders: { "Content-Type": "application/x-www-form-urlencoded" },
        requestBody: `tokenId=${pw}&csrf_id=${pw}&api_key_id=k-1`,
      },
      base,
    );
    const log = fs.readFileSync(networkStore.getRequestsPath(base), "utf8");
    expect(log).not.toContain(pw);
    expect(log).toContain("token_count=5");
    expect(log).toContain("api_key_id=k-1");
  });

  it("templates a secret value up to its closing quote, tag or comma, byte-exact on replay", async () => {
    const rows: [string, string, string, string][] = [
      [
        `<login user="ada" password="${pw}">hello</login>`,
        "text/xml",
        "password",
        `<login user="ada" password="{{password}}">hello</login>`,
      ],
      [
        `<req><url>https://x.test/cb?token=${pw}</url><n>1</n></req>`,
        "text/xml",
        "token",
        "<req><url>https://x.test/cb?token={{token}}</url><n>1</n></req>",
      ],
      [
        // Two NDJSON lines, so the body is no one JSON value.
        `{"u":"https://x.test/?a=1&token=${pw}","b":2}\n{"c":3}`,
        "application/x-ndjson",
        "token",
        '{"u":"https://x.test/?a=1&token={{token}}","b":2}\n{"c":3}',
      ],
      [
        `username="ada", password="${pw}", realm="x"`,
        "text/plain",
        "password",
        'username="ada", password="{{password}}", realm="x"',
      ],
    ];
    for (const [body, type, name, saved] of rows) {
      const result = named(body, type);
      expect(result.request.body).toBe(saved);
      expect(result.args).toEqual({ [name]: { required: true } });
      expect(renderRequest(result.request, { args: { [name]: pw }, env: {} }).body).toBe(body);
    }
    // The write guard keys on the value itself, not on the text after it.
    const made = await hook(post(rows[0][0], "text/xml"));
    expect(made.status).toBe("saved");
    const { reserveReceipt } = require("../../native/playbook-receipts.cjs");
    const { resolveArgs } = require("../../native/playbook-runtime.cjs");
    const { validateOp } = require("../../native/playbooks.cjs");
    const op = validateOp(JSON.parse(fs.readFileSync(made.file, "utf8")), { origins: [] });
    expect(() =>
      reserveReceipt({ playbookId: made.playbook, op, args: resolveArgs(op, { password: pw }) }),
    ).toThrow(/write blocked by verified receipt/);
    // A value with a quote or tag that isn't the text's own is left for the save check to refuse.
    const odd = await hook(post(`user=ada\npassword=ab<c${pw}\n`, "text/plain"));
    expect(odd).toMatchObject({ status: "error", refused: "keep-body" });
  });

  it("refuses a namespaced or CDATA password element and password = value", () => {
    const { secretLeft } = require("../../native/op-body.cjs");
    expect(
      secretLeft(`<soap:Envelope><wsse:Password Type="x">${pw}</wsse:Password></soap:Envelope>`),
    ).toBe("Password");
    expect(secretLeft(`<ns1:login><ns1:password>${pw}</ns1:password></ns1:login>`)).toBe(
      "password",
    );
    expect(secretLeft(`<login><password><![CDATA[${pw}]]></password></login>`)).toBe("password");
    expect(secretLeft(`user = ada\npassword = ${pw}\n`)).toBe("password");
    expect(secretLeft("<wsse:Password>{{password}}</wsse:Password>")).toBeUndefined();
    expect(secretLeft("<password><![CDATA[{{password}}]]></password>")).toBeUndefined();
  });

  it("says a refused write was already sent, and counts that send", async () => {
    const { receiptRoot } = require("../../native/playbook-receipts.cjs");
    const claims = () => (fs.existsSync(receiptRoot()) ? fs.readdirSync(receiptRoot()).length : 0);
    const before = claims();
    const result = await hook(post(`<login><password>${pw}</password></login>`, "application/xml"));
    expect(result.error).toBe(
      'the request body keeps a literal value under "password", a secret-looking key surf could not make an input, so nothing was saved; check the body, then add --keep-body to save it as it is; the request was already sent once, so a rerun with --keep-body sends it again',
    );
    expect(claims()).toBe(before + 1);
    // pb record stop sends nothing again, so it doesn't say so.
    const stopped = await hook(
      post(`<login><password>${pw}</password></login>`, "application/xml"),
      {
        rerunSends: false,
      },
    );
    expect(stopped.error).toMatch(/to save it as it is$/);
  });

  it("prints no secret surf scrubbed from the op on the picked line", async () => {
    const entry = {
      ...post(`custname=Ada&p=${pw}`, "text/plain"),
      url: `https://httpbin.org/post?p=${pw}`,
    };
    const result = await hook(entry, {
      capture: {
        pageUrl: page.url,
        pageText: "order",
        after: 2000,
        entries: [page, entry],
        secrets: [pw],
      },
    });
    expect(result.status).toBe("saved");
    expect(result.picked.url).toBe("https://httpbin.org/post?p={{password}}");
    expect(formatHook(result, []).stdout).not.toContain(pw);
  });
});
