import { afterEach, describe, expect, it } from "vitest";

declare const __dirname: string;
declare const require: (moduleName: string) => any;

const fs = require("node:fs");
const nodeCrypto = require("node:crypto");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const tls = require("node:tls");
const remoteAuth = require("../../native/remote-auth.cjs");
const { connectEndpoint } = require("../../native/endpoint.cjs");
const { createFrameParser, createServerAuthSession } = require("../../native/remote-transport.cjs");

const fixtures = path.join(__dirname, "../fixtures/tls");
const passphrase = "surf-test-fixture";
const servers: any[] = [];
const sockets = new Set<any>();
const directories: string[] = [];

function fixture(name: string) {
  return fs.readFileSync(path.join(fixtures, name));
}

function serverKey(name: string) {
  return nodeCrypto
    .createPrivateKey({
      key: fixture(`${name}-key.enc.der`),
      format: "der",
      type: "pkcs8",
      passphrase,
    })
    .export({ format: "pem", type: "pkcs8" });
}

async function listen(server: any) {
  servers.push(server);
  server.on("connection", (socket: any) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port as number;
}

function credential() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surf-tls-test-"));
  directories.push(stateDir);
  const credentialPath = path.join(stateDir, "client.json");
  remoteAuth.authorizeClient("tls-client", credentialPath, stateDir);
  return { credentialPath, stateDir };
}

function authenticatedTlsServer(certName: string) {
  const identity = credential();
  let applicationBytes = 0;
  let serverName: string | undefined;
  const server = tls.createServer(
    {
      cert: fixture(`${certName}-cert.pem`),
      key: serverKey(certName),
    },
    (socket: any) => {
      serverName = socket.servername;
      const auth = createServerAuthSession({
        socket,
        stateDir: identity.stateDir,
        onAuthenticated: () => undefined,
        onError: () => socket.destroy(),
      });
      const parser = createFrameParser({
        onFrame: (message: Record<string, unknown>) => {
          if (!auth.authenticated) {
            auth.handle(message).catch(() => socket.destroy());
          }
        },
        onError: () => socket.destroy(),
      });
      socket.on("data", (chunk: { length: number }) => {
        applicationBytes += chunk.length;
        parser.push(chunk);
      });
      socket.on("close", () => {
        parser.close();
        auth.close();
      });
    },
  );
  server.on("tlsClientError", () => undefined);
  return {
    identity,
    server,
    get applicationBytes() {
      return applicationBytes;
    },
    get serverName() {
      return serverName;
    },
  };
}

function connect(target: Record<string, unknown>) {
  return new Promise<any>((resolve, reject) => {
    const socket = connectEndpoint(target, () => resolve(socket));
    socket.once("error", reject);
  });
}

function buildEndpoint(port: number, credentialPath: string, tlsOptions: Record<string, unknown>) {
  return {
    kind: "remote",
    host: "127.0.0.1",
    port,
    display: `127.0.0.1:${port}`,
    key: `tcp:127.0.0.1:${port}`,
    connectionOptions: { host: "127.0.0.1", port },
    credentialPath,
    tls: { enabled: true, ...tlsOptions },
  };
}

afterEach(async () => {
  for (const socket of sockets) {
    socket.destroy();
  }
  sockets.clear();
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("remote endpoint TLS", () => {
  it("validates a custom CA before completing Ed25519 authentication", async () => {
    const fixtureServer = authenticatedTlsServer("localhost");
    const port = await listen(fixtureServer.server);
    const socket = await connect(
      buildEndpoint(port, fixtureServer.identity.credentialPath, { ca: fixture("ca-cert.pem") }),
    );

    expect(socket.connected).toBe(true);
    expect(fixtureServer.applicationBytes).toBeGreaterThan(0);
    expect(fixtureServer.serverName).toBe(false);
    socket.destroy();
  });

  it("preserves unknown-CA and hostname errors before sending authentication bytes", async () => {
    const unknownCaServer = authenticatedTlsServer("localhost");
    const unknownCaPort = await listen(unknownCaServer.server);
    await expect(
      connect(buildEndpoint(unknownCaPort, unknownCaServer.identity.credentialPath, {})),
    ).rejects.toMatchObject({ code: expect.stringMatching(/SELF_SIGNED|UNABLE_TO_VERIFY/) });
    expect(unknownCaServer.applicationBytes).toBe(0);

    const mismatchServer = authenticatedTlsServer("dnsonly");
    const mismatchPort = await listen(mismatchServer.server);
    await expect(
      connect(
        buildEndpoint(mismatchPort, mismatchServer.identity.credentialPath, {
          ca: fixture("ca-cert.pem"),
          serverName: "localhost",
        }),
      ),
    ).rejects.toMatchObject({ code: "ERR_TLS_CERT_ALTNAME_INVALID" });
    expect(mismatchServer.applicationBytes).toBe(0);
  });

  it("uses explicit DNS SNI and supports an IP destination with a DNS identity override", async () => {
    const fixtureServer = authenticatedTlsServer("dnsonly");
    const port = await listen(fixtureServer.server);
    const socket = await connect(
      buildEndpoint(port, fixtureServer.identity.credentialPath, {
        ca: fixture("ca-cert.pem"),
        serverName: "surf-tls.test",
      }),
    );

    expect(fixtureServer.serverName).toBe("surf-tls.test");
    socket.destroy();
  });

  it("bounds a silent TLS handshake without plaintext fallback", async () => {
    let connections = 0;
    const server = net.createServer((socket: any) => {
      connections++;
      socket.on("error", () => undefined);
    });
    const port = await listen(server);
    const { credentialPath } = credential();
    const started = Date.now();

    await expect(
      connect(buildEndpoint(port, credentialPath, { handshakeTimeoutMs: 30 })),
    ).rejects.toMatchObject({ code: "ETIMEDOUT", message: "TLS handshake timed out after 30ms" });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(connections).toBe(1);
  });
});
