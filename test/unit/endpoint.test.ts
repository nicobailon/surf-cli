import { describe, expect, it } from "vitest";

declare const require: (moduleName: string) => any;

const { parseRemoteEndpoint, selectEndpoint } = require("../../native/endpoint.cjs");
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
});
