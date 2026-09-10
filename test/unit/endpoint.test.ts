import { describe, expect, it } from "vitest";

declare const __dirname: string;
declare const require: (moduleName: string) => any;

const {
  formatEndpointError,
  parseRemoteEndpoint,
  selectEndpoint,
} = require("../../native/endpoint.cjs");
const { Buffer } = require("node:buffer");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { getBrowserLockDir } = require("../../native/browser-lock.cjs");

describe("endpoint selection", () => {
  it("parses DNS, IPv4, and bracketed IPv6 endpoints canonically", () => {
    expect(parseRemoteEndpoint("Host.Tailnet:1234")).toMatchObject({
      host: "host.tailnet",
      port: 1234,
      display: "host.tailnet:1234",
      key: "tcp:host.tailnet:1234",
    });
    expect(parseRemoteEndpoint("127.0.0.1:1")).toMatchObject({ host: "127.0.0.1", port: 1 });
    expect(parseRemoteEndpoint("[fd7a:115c:a1e0::1]:65535")).toMatchObject({
      display: "[fd7a:115c:a1e0::1]:65535",
    });
    expect(parseRemoteEndpoint("[0:0:0:0:0:0:0:1]:123").key).toBe(
      parseRemoteEndpoint("[::1]:123").key,
    );
  });

  it("rejects ambiguous or unsafe remote endpoint syntax", () => {
    for (const value of [
      "",
      "host",
      ":1",
      "https://host:1",
      "user@host:1",
      "host/path:1",
      "*:1",
      "0.0.0.0:1",
      "[::]:1",
      "[::1:1",
      "::1:1",
      "host:0",
      "host:65536",
    ]) {
      expect(() => parseRemoteEndpoint(value)).toThrow();
    }
  });

  it("uses CLI remote before env and preserves local SURF_SOCKET", () => {
    expect(
      selectEndpoint(
        ["page.read", "--remote", "cli.tailnet:1234", "--remote-credential", "/tmp/client.json"],
        { SURF_REMOTE: "env.tailnet:2", SURF_SOCKET: "/tmp/local.sock" },
      ),
    ).toMatchObject({
      args: ["page.read"],
      endpoint: { display: "cli.tailnet:1234", credentialPath: "/tmp/client.json" },
    });
    expect(
      selectEndpoint(["page.read"], {
        SURF_REMOTE: "env.tailnet:2",
        SURF_REMOTE_CREDENTIAL: "/tmp/env-client.json",
        SURF_SOCKET: "/tmp/local.sock",
      }).endpoint,
    ).toMatchObject({ display: "env.tailnet:2", credentialPath: "/tmp/env-client.json" });
    expect(
      selectEndpoint(["page.read"], { SURF_SOCKET: "/tmp/local.sock" }).endpoint,
    ).toMatchObject({ kind: "local", path: "/tmp/local.sock" });
    expect(selectEndpoint(["page.read"], {}).endpoint.path).not.toBe(process.env.SURF_SOCKET);
    expect(() => selectEndpoint(["--remote", "a:1", "--remote", "b:2"], {})).toThrow("only");
    expect(() => selectEndpoint(["--remote", "a:1"], {})).toThrow("credential");
    expect(() => selectEndpoint(["--remote-credential", "/tmp/client.json"], {})).toThrow(
      "requires a remote",
    );
  });

  it("uses canonical endpoint keys for independent browser locks", () => {
    expect(getBrowserLockDir(parseRemoteEndpoint("HOST.tailnet:9").key, "/tmp")).toBe(
      getBrowserLockDir(parseRemoteEndpoint("host.tailnet:9").key, "/tmp"),
    );
    expect(getBrowserLockDir(parseRemoteEndpoint("host.tailnet:9").key, "/tmp")).not.toBe(
      getBrowserLockDir(parseRemoteEndpoint("host.tailnet:10").key, "/tmp"),
    );
  });

  it("strips TLS options from arbitrary positions and keeps the destination lock key", () => {
    const caPath = path.join(__dirname, "../fixtures/tls/ca-cert.pem");
    const selected = selectEndpoint(
      [
        "--remote-tls-ca",
        caPath,
        "page.read",
        "--remote",
        "HOST.test:443",
        "--remote-tls-server-name",
        "Proxy.Example",
        "--remote-credential",
        "/tmp/client.json",
        "--remote-tls",
      ],
      {},
    );
    expect(selected.args).toEqual(["page.read"]);
    expect(selected.endpoint).toMatchObject({
      host: "host.test",
      key: "tcp:host.test:443",
      tls: { enabled: true, caPath, serverName: "proxy.example" },
    });
    expect(Buffer.isBuffer(selected.endpoint.tls.ca)).toBe(true);
  });

  it("preserves the plaintext endpoint object when TLS is absent", () => {
    expect(
      selectEndpoint(
        ["page.read", "--remote", "host.test:9", "--remote-credential", "/tmp/client.json"],
        {},
      ),
    ).toEqual({
      args: ["page.read"],
      endpoint: {
        kind: "remote",
        host: "host.test",
        port: 9,
        display: "host.test:9",
        key: "tcp:host.test:9",
        connectionOptions: { host: "host.test", port: 9 },
        credentialPath: "/tmp/client.json",
      },
    });
    expect(
      formatEndpointError(
        new Error("certificate failed"),
        { kind: "remote", display: "host.test:9", tls: { enabled: true } },
        () => "local",
      ),
    ).toBe("Remote endpoint connection failed (host.test:9, TLS): certificate failed");
  });

  it("enforces strict TLS env semantics and TLS dependencies", () => {
    const base = { SURF_REMOTE: "host.test:443", SURF_REMOTE_CREDENTIAL: "/tmp/client.json" };
    expect(selectEndpoint([], { ...base, SURF_REMOTE_TLS: "1" }).endpoint.tls).toMatchObject({
      enabled: true,
      serverName: "host.test",
    });
    expect(selectEndpoint([], { ...base, SURF_REMOTE_TLS: "" }).endpoint.tls).toBeUndefined();
    for (const value of ["0", "true", "false", "yes"]) {
      expect(() => selectEndpoint([], { ...base, SURF_REMOTE_TLS: value })).toThrow(
        'SURF_REMOTE_TLS must be "1"',
      );
    }
    expect(() => selectEndpoint(["--remote-tls"], {})).toThrow(
      "--remote-tls requires a remote endpoint",
    );
    expect(() => selectEndpoint([], { SURF_REMOTE_TLS: "1" })).toThrow(
      "SURF_REMOTE_TLS requires a remote endpoint",
    );
    expect(() => selectEndpoint([], { ...base, SURF_REMOTE_TLS_CA: "/tmp/ca.pem" })).toThrow(
      "SURF_REMOTE_TLS_CA requires TLS",
    );
    expect(() => selectEndpoint(["--remote-tls-server-name", "example.test"], base)).toThrow(
      "--remote-tls-server-name requires TLS",
    );
  });

  it("rejects duplicate, missing, and invalid TLS options", () => {
    const base = ["--remote", "host.test:443", "--remote-credential", "/tmp/client.json"];
    expect(() => selectEndpoint([...base, "--remote-tls", "--remote-tls"], {})).toThrow(
      "--remote-tls may only be specified once",
    );
    expect(() => selectEndpoint([...base, "--remote-tls-ca", "--other"], {})).toThrow(
      "--remote-tls-ca requires a file path",
    );
    for (const name of ["127.0.0.1", "*.example.com", "https://example.com", "host:443", "a/b"]) {
      expect(() =>
        selectEndpoint([...base, "--remote-tls", "--remote-tls-server-name", name], {}),
      ).toThrow("valid DNS hostname");
    }
  });

  it("loads custom CA bytes with CLI-over-env precedence and path-safe errors", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "surf-ca-test-"));
    const cliCa = path.join(__dirname, "../fixtures/tls/ca-cert.pem");
    const invalidCa = path.join(directory, "invalid.pem");
    const missingCa = path.join(directory, "missing.pem");
    fs.writeFileSync(invalidCa, "not a certificate");
    const args = [
      "--remote",
      "127.0.0.1:443",
      "--remote-credential",
      "/tmp/client.json",
      "--remote-tls",
      "--remote-tls-ca",
      cliCa,
      "--remote-tls-server-name",
      "CLI.Example",
    ];
    const selected = selectEndpoint(args, {
      SURF_REMOTE_TLS_CA: missingCa,
      SURF_REMOTE_TLS_SERVER_NAME: "env.example",
    });
    expect(selected.endpoint.tls.serverName).toBe("cli.example");
    expect(selected.endpoint.tls.caPath).toBe(cliCa);
    expect(selectEndpoint(args.slice(0, 5), {}).endpoint.tls.serverName).toBeUndefined();
    expect(() => selectEndpoint([...args.slice(0, 5), "--remote-tls-ca", missingCa], {})).toThrow(
      missingCa,
    );
    expect(() => selectEndpoint([...args.slice(0, 5), "--remote-tls-ca", invalidCa], {})).toThrow(
      invalidCa,
    );
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
