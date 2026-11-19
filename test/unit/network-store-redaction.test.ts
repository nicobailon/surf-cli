import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const networkStore = require("../../native/network-store.cjs");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Built from parts so the literal never sits in the source as one string.
const dummy = ["hun", "ter", "-", "42", "x"].join("");

function tempStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "surf-network-redaction-"));
  roots.push(root);
  return path.join(root, "network");
}

function filesUnder(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((item: { name: string; isDirectory(): boolean }) => {
      const full = path.join(dir, item.name);
      return item.isDirectory() ? filesUnder(full) : [full];
    });
}

// The saved files under the temp state dir, and those of them that hold the secret.
function scan(base: string, secret: string) {
  const files = filesUnder(path.dirname(base));
  return {
    files: files.length,
    holding: files.filter((file) => fs.readFileSync(file, "utf8").includes(secret)),
  };
}

function saved(base: string) {
  return fs
    .readFileSync(networkStore.getRequestsPath(base), "utf8")
    .trim()
    .split("\n")
    .map((line: string) => JSON.parse(line));
}

describe("network store keeps secrets off disk", () => {
  it("redacts a secret-named form field and keeps the others", () => {
    const base = tempStore();
    const entry = {
      method: "POST",
      url: "https://a.example/login",
      requestHeaders: { "Content-Type": "application/x-www-form-urlencoded" },
      requestBody: `username=ada&password=${dummy}&user%5Bpassword%5D=${dummy}&custname=Ada+Lovelace`,
    };
    networkStore.appendEntrySync(entry, base);
    const [line] = saved(base);
    expect(line.requestBody).toBe(
      "username=ada&password=<redacted>&user%5Bpassword%5D=<redacted>&custname=Ada+Lovelace",
    );
    expect(scan(base, dummy)).toEqual({ files: 1, holding: [] });
    // The caller's entry, which `surf network` prints and hook reads in memory, is unchanged.
    expect(entry.requestBody).toContain(dummy);
  });

  it("redacts nested secret-named JSON fields and keeps the others", () => {
    const base = tempStore();
    networkStore.appendEntrySync(
      {
        method: "POST",
        url: "https://a.example/account",
        requestHeaders: { "content-type": "application/json; charset=utf-8" },
        requestBody: JSON.stringify({
          user: { name: "ada", newPassword: dummy },
          items: [{ csrfToken: dummy, keyword: "pizza" }],
        }),
      },
      base,
    );
    const [line] = saved(base);
    expect(JSON.parse(line.requestBody)).toEqual({
      user: { name: "ada", newPassword: "<redacted>" },
      items: [{ csrfToken: "<redacted>", keyword: "pizza" }],
    });
    expect(scan(base, dummy)).toEqual({ files: 1, holding: [] });
  });

  it("drops credential header values and leaves other headers and bodies as they are", () => {
    const base = tempStore();
    const body = JSON.stringify({ q: "rust", page: 2 });
    networkStore.appendEntrySync(
      {
        method: "POST",
        url: "https://a.example/search",
        requestHeaders: {
          Authorization: `Bearer ${dummy}`,
          cookie: `sid=${dummy}`,
          "Proxy-Authorization": dummy,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        requestBody: body,
        responseHeaders: { "set-cookie": `sid=${dummy}`, "content-type": "application/json" },
        responseBody: '{"ok":true}',
      },
      base,
    );
    const [line] = saved(base);
    expect(line.requestHeaders).toEqual({
      Authorization: "<redacted>",
      cookie: "<redacted>",
      "Proxy-Authorization": "<redacted>",
      Accept: "application/json",
      "Content-Type": "application/json",
    });
    expect(line.responseHeaders).toEqual({
      "set-cookie": "<redacted>",
      "content-type": "application/json",
    });
    expect(line.requestBody).toBe(body);
    expect(line.responseBody).toBe('{"ok":true}');
    expect(scan(base, dummy)).toEqual({ files: 1, holding: [] });
  });

  it("redacts digit-suffixed password fields, JSON sent as text/plain, and every secret header", () => {
    const base = tempStore();
    networkStore.appendEntrySync(
      {
        method: "POST",
        url: "https://a.example/register",
        requestHeaders: {
          "content-type": "application/x-www-form-urlencoded",
          "X-CSRF-Token": dummy,
          "X-Api-Key": dummy,
        },
        requestBody: `password1=${dummy}&password2=${dummy}&new_password1=${dummy}&pass1=${dummy}&pass2=${dummy}&page2=3`,
      },
      base,
    );
    networkStore.appendEntrySync(
      {
        method: "POST",
        url: "https://a.example/account",
        requestHeaders: { "content-type": "text/plain;charset=UTF-8" },
        requestBody: JSON.stringify({ newPassword1: dummy, Password1: dummy, name: "ada" }),
      },
      base,
    );
    const [form, json] = saved(base);
    expect(form.requestBody).toBe(
      "password1=<redacted>&password2=<redacted>&new_password1=<redacted>&pass1=<redacted>&pass2=<redacted>&page2=3",
    );
    expect(form.requestHeaders).toEqual({
      "content-type": "application/x-www-form-urlencoded",
      "X-CSRF-Token": "<redacted>",
      "X-Api-Key": "<redacted>",
    });
    expect(JSON.parse(json.requestBody)).toEqual({
      newPassword1: "<redacted>",
      Password1: "<redacted>",
      name: "ada",
    });
    expect(scan(base, dummy)).toEqual({ files: 1, holding: [] });
  });

  it("redacts secret-named multipart parts and URL query values, keeping the rest as sent", () => {
    const base = tempStore();
    const part = (name: string, value: string, extra = "") =>
      `--XyZ\r\nContent-Disposition: form-data; name="${name}"${extra}\r\n\r\n${value}\r\n`;
    const body = `${part("username", "ada")}${part("password", dummy)}${part("api_key", dummy)}${part("file", "hello", '; filename="password.txt"')}--XyZ--\r\n`;
    networkStore.appendEntrySync(
      {
        method: "POST",
        url: `https://a.example/upload?user=ada&access_token=${dummy}&page=2&api%5Fkey=${dummy}#password=x`,
        requestHeaders: { "Content-Type": 'multipart/form-data; boundary="XyZ"' },
        requestBody: body,
      },
      base,
    );
    const [line] = saved(base);
    expect(line.url).toBe(
      "https://a.example/upload?user=ada&access_token=<redacted>&page=2&api%5Fkey=<redacted>#password=x",
    );
    expect(line.requestBody).toBe(
      `${part("username", "ada")}${part("password", "<redacted>")}${part("api_key", "<redacted>")}${part("file", "hello", '; filename="password.txt"')}--XyZ--\r\n`,
    );
    expect(scan(base, dummy)).toEqual({ files: 1, holding: [] });
  });

  it("still saves a JSON body nested too deep to walk, without its content", () => {
    const base = tempStore();
    const depth = 200_000;
    const body = `${"[".repeat(depth)}"${dummy}"${"]".repeat(depth)}`;
    expect(() =>
      networkStore.appendEntrySync(
        {
          method: "POST",
          url: "https://a.example/deep",
          requestHeaders: { "content-type": "application/json" },
          requestBody: body,
        },
        base,
      ),
    ).not.toThrow();
    expect(saved(base)[0].requestBody).toBe("<redacted>");
    expect(scan(base, dummy)).toEqual({ files: 1, holding: [] });
  });

  it("redacts the same way through the async append", async () => {
    const base = tempStore();
    const previous = process.env.SURF_NETWORK_PATH;
    process.env.SURF_NETWORK_PATH = base;
    try {
      await networkStore.appendEntry({
        method: "POST",
        url: "https://a.example/login",
        requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
        requestBody: `username=ada&password=${dummy}`,
      });
    } finally {
      if (previous === undefined) {
        delete process.env.SURF_NETWORK_PATH;
      } else {
        process.env.SURF_NETWORK_PATH = previous;
      }
    }
    expect(saved(base)[0].requestBody).toBe("username=ada&password=<redacted>");
    expect(scan(base, dummy)).toEqual({ files: 1, holding: [] });
  });
});
