import { afterEach, describe, expect, it } from "vitest";

declare const require: (moduleName: string) => unknown;
declare const process: { pid: number };
type ByteBuffer = { toString(encoding?: string): string };
declare const Buffer: { alloc(size: number, fill?: number): ByteBuffer };
const fs = require("node:fs") as {
  mkdtempSync(prefix: string): string;
  readFileSync(filePath: string, encoding: string): string;
  rmSync(filePath: string, options: { recursive?: boolean; force?: boolean }): void;
  statSync(filePath: string): { mode: number };
  symlinkSync(target: string, linkPath: string): void;
};
const os = require("node:os") as { tmpdir(): string };
const path = require("node:path") as { join(...parts: string[]): string };

const auth = require("../../native/remote-auth.cjs") as {
  authorizeClient(
    label: string,
    outputPath: string,
    stateDir: string,
  ): { id: string; output: string };
  canonicalTranscript(
    role: string,
    clientId: string,
    clientNonce: string,
    serverNonce: string,
    clientPublicKey: string,
    hostPublicKey: string,
  ): ByteBuffer;
  ensureHostIdentity(stateDir: string): { publicKey: string; privateKey: object };
  listClients(stateDir: string): Array<{ id: string; label: string }>;
  loadCredential(filePath: string): {
    clientId: string;
    label: string;
    hostPublicKey: string;
    publicKey: string;
    privateKey: object;
  };
  loadRegistry(stateDir: string): { clients: Array<Record<string, unknown>> };
  revokeClient(label: string, stateDir: string): void;
  signChallenge(
    host: { publicKey: string; privateKey: object },
    clientId: string,
    clientNonce: string,
    serverNonce: string,
    clientPublicKey: string,
  ): string;
  signProof(
    credential: { clientId: string; publicKey: string; hostPublicKey: string; privateKey: object },
    clientNonce: string,
    serverNonce: string,
  ): string;
  verifyChallenge(
    credential: { clientId: string; publicKey: string; hostPublicKey: string },
    challenge: Record<string, unknown>,
  ): boolean;
  verifyProof(
    client: { id: string; publicKey: string },
    hostPublicKey: string,
    clientNonce: string,
    serverNonce: string,
    proof: string,
  ): boolean;
};

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createState() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "surf-remote-auth-"));
  tempDirs.push(dir);
  return dir;
}

describe("remote authentication state", () => {
  it("creates a private state directory, public-only registry, and non-overwriting credential", () => {
    const stateDir = createState();
    const output = path.join(stateDir, "client.json");
    const client = auth.authorizeClient("alice", output, stateDir);

    expect(client.id).toMatch(/^[a-f0-9]{32}$/);
    expect(fs.statSync(stateDir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(output).mode & 0o777).toBe(0o600);
    expect(auth.loadRegistry(stateDir).clients[0]).not.toHaveProperty("privateKey");
    expect(JSON.parse(fs.readFileSync(output, "utf8"))).toHaveProperty("privateKey");
    expect(() =>
      auth.authorizeClient("alice", path.join(stateDir, "second.json"), stateDir),
    ).toThrow("already exists");
    expect(() => auth.authorizeClient("bob", output, stateDir)).toThrow("already exists");
  });

  it("rejects unsafe labels, symlinked state, and symlinked credential output", () => {
    const stateDir = createState();
    expect(() =>
      auth.authorizeClient("bad label", path.join(stateDir, "client.json"), stateDir),
    ).toThrow("label");
    const linkedOutput = path.join(stateDir, "linked.json");
    fs.symlinkSync(path.join(stateDir, "missing.json"), linkedOutput);
    expect(() => auth.authorizeClient("alice", linkedOutput, stateDir)).toThrow("symbolic link");

    const linkedState = path.join(os.tmpdir(), `surf-remote-state-link-${process.pid}`);
    fs.rmSync(linkedState, { force: true });
    fs.symlinkSync(stateDir, linkedState);
    tempDirs.push(linkedState);
    expect(() =>
      auth.authorizeClient("alice", path.join(linkedState, "client.json"), linkedState),
    ).toThrow("symbolic link");
  });

  it("lists and revokes clients without retaining private keys in the registry", () => {
    const stateDir = createState();
    auth.authorizeClient("alice", path.join(stateDir, "alice.json"), stateDir);
    auth.authorizeClient("bob", path.join(stateDir, "bob.json"), stateDir);
    expect(auth.listClients(stateDir).map((client) => client.label)).toEqual(["alice", "bob"]);
    auth.revokeClient("alice", stateDir);
    expect(auth.listClients(stateDir).map((client) => client.label)).toEqual(["bob"]);
    expect(() => auth.revokeClient("alice", stateDir)).toThrow("not found");
    expect(fs.readFileSync(path.join(stateDir, "remote-clients.json"), "utf8")).not.toContain(
      "privateKey",
    );
  });

  it("binds signatures to both nonces and the pinned host identity", () => {
    const stateDir = createState();
    auth.authorizeClient("alice", path.join(stateDir, "alice.json"), stateDir);
    const credential = auth.loadCredential(path.join(stateDir, "alice.json"));
    const host = auth.ensureHostIdentity(stateDir);
    const client = auth.loadRegistry(stateDir).clients[0] as { id: string; publicKey: string };
    const clientNonce = Buffer.alloc(32, 1).toString("base64");
    const serverNonce = Buffer.alloc(32, 2).toString("base64");
    const challenge = {
      type: "auth_challenge",
      version: 1,
      clientId: credential.clientId,
      clientNonce,
      serverNonce,
      hostPublicKey: credential.hostPublicKey,
      signature: auth.signChallenge(
        host,
        credential.clientId,
        clientNonce,
        serverNonce,
        credential.publicKey,
      ),
    };

    expect(auth.verifyChallenge(credential, challenge)).toBe(true);
    expect(
      auth.verifyChallenge(credential, {
        ...challenge,
        serverNonce: Buffer.alloc(32, 3).toString("base64"),
      }),
    ).toBe(false);
    const proof = auth.signProof(credential, clientNonce, serverNonce);
    expect(auth.verifyProof(client, host.publicKey, clientNonce, serverNonce, proof)).toBe(true);
    expect(
      auth.verifyProof(
        client,
        host.publicKey,
        clientNonce,
        Buffer.alloc(32, 3).toString("base64"),
        proof,
      ),
    ).toBe(false);
    expect(
      auth.canonicalTranscript(
        "client",
        credential.clientId,
        clientNonce,
        serverNonce,
        credential.publicKey,
        credential.hostPublicKey,
      ),
    ).toBeInstanceOf(Buffer);
  });
});
