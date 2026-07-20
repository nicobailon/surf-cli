import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const clients = require("../../native/playbook-client.cjs");
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("playbook client projection", () => {
  it("generates the validated endpoint shape with provenance and no captured credentials", async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "surf-client-"));
    directories.push(parent);
    const out = path.join(parent, "client");
    const result = clients.generateClient({
      playbookId: "fixture",
      op: { id: "search", effect: "read" },
      strategy: {
        using: "network",
        request: {
          method: "POST",
          url: "https://example.test/search",
          query: { q: "{{q}}" },
          headers: {
            accept: "application/json",
            authorization: "Bearer captured-secret",
            cookie: "sid=secret",
          },
          body: { query: "{{q}}" },
        },
        extract: { jsonPath: "$.items" },
      },
      provenance: { type: "record", recordId: "rec-1" },
      out,
    });
    expect(result.manifest).toMatchObject({
      playbook: "fixture",
      op: "search",
      source: { recordId: "rec-1" },
      noEmbeddedSecrets: true,
      endpoint: { method: "POST", query: { q: "{{q}}" }, body: { query: "{{q}}" } },
    });
    const files = fs
      .readdirSync(out)
      .map((name: string) => fs.readFileSync(path.join(out, name), "utf8"))
      .join("\n");
    expect(files).not.toContain("captured-secret");
    expect(files).not.toContain("sid=secret");
    await expect(clients.verifyClient(out, { live: false })).resolves.toMatchObject({
      valid: true,
      endpoint: { method: "POST", url: "https://example.test/search" },
    });
  });

  it("requires a runnable absolute endpoint for standalone clients", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "surf-client-"));
    directories.push(parent);
    expect(() =>
      clients.generateClient({
        playbookId: "fixture",
        op: { id: "read", effect: "read" },
        strategy: { using: "network", request: { method: "GET", url: "/" } },
        provenance: { type: "playbook", id: "fixture" },
        out: path.join(parent, "missing-origin"),
      }),
    ).toThrow(/absolute endpoint URL/);
    expect(() =>
      clients.generateClient({
        playbookId: "fixture",
        op: { id: "read", effect: "read" },
        strategy: { using: "network", request: { method: "GET", url: "https://example.test/" } },
        provenance: { type: "playbook", id: "fixture" },
      }),
    ).toThrow(/--out <directory>/);

    const out = path.join(parent, "client");
    const result = clients.generateClient({
      playbookId: "fixture",
      op: { id: "read", effect: "read" },
      strategy: { using: "network", request: { method: "GET", url: "/api" } },
      provenance: { type: "playbook", id: "fixture" },
      origins: ["https://example.test"],
      out,
    });
    expect(result.manifest.endpoint.url).toBe("https://example.test/api");
  });

  it("rejects credential-like literals outside declared auth inputs", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "surf-client-"));
    directories.push(parent);
    expect(() =>
      clients.generateClient({
        playbookId: "fixture",
        op: { id: "search", effect: "read" },
        strategy: {
          using: "network",
          request: {
            method: "GET",
            url: "https://example.test/search?access_token=captured-secret",
          },
        },
        provenance: { type: "record", recordId: "rec-1" },
        out: path.join(parent, "client"),
      }),
    ).toThrow(/auth input/);
  });
});
