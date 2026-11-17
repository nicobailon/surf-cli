import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureTab } from "../fixtures/capture-tab";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const playbooks = require("../../native/playbooks.cjs");
const chain = require("../../native/chain-runtime.cjs");
const receipts = require("../../native/playbook-receipts.cjs");

const tempDirs: string[] = [];
let stateDir = "";

// Each test keeps its receipts in its own state dir, so one test's sends don't block another's.
beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surf-chain-writes-state-"));
  tempDirs.push(stateDir);
  vi.stubEnv("SURF_STATE_DIR", stateDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

type Op = Record<string, unknown> & { id: string };

const listOp: Op = {
  id: "list_postings",
  args: { company: { type: "string", required: true } },
  run: [
    {
      using: "network",
      request: { url: "https://jobs.test/api/list", query: { company: "{{company}}" } },
      extract: { jsonPath: "$.items" },
    },
  ],
};

const detailOp: Op = {
  id: "get_posting",
  args: { posting_id: { type: "string", required: true } },
  run: [
    {
      using: "network",
      request: { url: "https://jobs.test/api/detail/{{posting_id}}" },
      extract: { jsonPath: "$.data" },
    },
  ],
};

// A write with a browser fallback: a failed send must never reach it.
const createOp: Op = {
  id: "create_note",
  effect: "write",
  args: {
    posting_id: { type: "string", required: true },
    note: { type: "string", required: true },
  },
  safety: { duplicate: "transactional" },
  run: [
    {
      using: "network",
      request: {
        method: "POST",
        url: "https://jobs.test/api/notes",
        body: { posting_id: "{{posting_id}}", note: "{{note}}" },
      },
      extract: { jsonPath: "$.ok" },
      expect: { truthy: true },
    },
    {
      using: "workflow",
      steps: [{ cmd: "navigate", args: { url: "https://jobs.test/notes/new" } }],
    },
  ],
};

const tagOp: Op = {
  id: "tag_posting",
  effect: "write",
  args: { posting_id: { type: "string", required: true } },
  safety: { duplicate: "transactional" },
  run: [
    {
      using: "network",
      request: { method: "POST", url: "https://jobs.test/api/tag/{{posting_id}}" },
      extract: { jsonPath: "$.ok" },
      expect: { truthy: true },
    },
  ],
};

const listStep = { id: "list", op: "list_postings", with: { company: "{{company}}" } };
const createStep = {
  id: "create",
  op: "create_note",
  with: { posting_id: { from: "list", path: "$[0].id" }, note: "{{note}}" },
};

// list → create: a read, then a write bound from the read's first record.
const noteChain: Op = {
  id: "note_first",
  effect: "write",
  args: {
    company: { type: "string", required: true },
    note: { type: "string", required: true },
  },
  chain: [listStep, createStep],
  output: "create",
};

function writePlaybook(ops: Op[]) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "surf-chain-writes-"));
  tempDirs.push(cwd);
  const directory = path.join(cwd, ".surf", "playbooks", "jobs");
  fs.mkdirSync(path.join(directory, "ops"), { recursive: true });
  fs.writeFileSync(
    path.join(directory, "playbook.json"),
    JSON.stringify({ id: "jobs", version: "1.0.0", origins: ["https://jobs.test"] }),
  );
  for (const op of ops) {
    fs.writeFileSync(path.join(directory, "ops", `${op.id}.json`), JSON.stringify(op));
  }
  return cwd;
}

function load(ops: Op[]) {
  return playbooks.resolvePlaybook("jobs", { cwd: writePlaybook(ops), home: os.tmpdir() });
}

const noWait = async () => undefined;

// A jobs site whose list holds a1 and a2; `fail` answers 500 to the paths it names.
function jobsTab({ fail = [] }: { fail?: string[] } = {}) {
  return captureTab({
    href: "https://jobs.test/",
    reply: (url) => {
      const parsed = new URL(url);
      if (fail.includes(parsed.pathname)) {
        return { status: 500, body: "{}" };
      }
      if (parsed.pathname === "/api/list") {
        return { body: JSON.stringify({ items: [{ id: "a1" }, { id: "a2" }] }) };
      }
      if (parsed.pathname.startsWith("/api/detail/")) {
        return { body: JSON.stringify({ data: { id: parsed.pathname.split("/").pop() } }) };
      }
      return { body: JSON.stringify({ ok: true }) };
    },
  });
}

// What the tab sent, as `METHOD /path?query`.
function sent(tab: ReturnType<typeof jobsTab>) {
  return tab.fetchImpl.mock.calls.map(([url, init]) => {
    const parsed = new URL(String(url));
    return `${String((init as { method?: string })?.method || "GET").toUpperCase()} ${parsed.pathname}${parsed.search}`;
  });
}

// Every saved attempt: its op and status.
function attempts() {
  const root = path.join(stateDir, "playbook-receipts");
  if (!fs.existsSync(root)) {
    return [];
  }
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry: { isDirectory(): boolean }) => entry.isDirectory())
    .flatMap((claim: { name: string }) =>
      fs
        .readdirSync(path.join(root, claim.name))
        .filter((name: string) => name.endsWith(".json"))
        .map((name: string) => {
          const attempt = JSON.parse(fs.readFileSync(path.join(root, claim.name, name), "utf8"));
          return { claim: claim.name, op: attempt.op, status: attempt.status };
        }),
    );
}

function run(playbook: unknown, id: string, args: Record<string, unknown>, extra = {}) {
  const tab = jobsTab(extra as { fail?: string[] });
  const op = (playbook as { ops: Map<string, unknown> }).ops.get(id);
  const result = chain.runChainOp({
    playbook,
    op,
    args,
    executeTool: tab.executeTool,
    sleep: noWait,
    ...extra,
  });
  return { tab, result };
}

describe("chain write steps: validation", () => {
  it("loads a write chain whose steps read and then write", () => {
    const op = load([listOp, createOp, noteChain]).ops.get("note_first");
    expect(op.effect).toBe("write");
    expect(op.chain.map((step: { id: string }) => step.id)).toEqual(["list", "create"]);
  });

  it("refuses a write step in a chain that doesn't say it writes, and a write chain with none", () => {
    expect(() => load([listOp, createOp, { ...noteChain, effect: "read" }])).toThrow(
      /chain note_first step create runs write op create_note, so the chain writes: give it "effect": "write"/,
    );
    expect(() =>
      load([listOp, { ...noteChain, chain: [listStep], output: "list" }]),
    ).toThrow(/chain note_first is a write, but none of its steps runs a write op/);
  });

  it("refuses each and page over a write step: a bulk write", () => {
    const each = {
      ...noteChain,
      chain: [
        listStep,
        {
          id: "create",
          op: "create_note",
          each: { from: "list" },
          with: { posting_id: { from: "item", path: "id" }, note: "{{note}}" },
        },
      ],
    };
    expect(() => load([listOp, createOp, each])).toThrow(
      /chain note_first step create runs write op create_note once per record of list: a bulk write, which a chain doesn't run/,
    );
    const paged = {
      ...noteChain,
      chain: [
        listStep,
        { ...createStep, page: { into: "note", next: "increment" } },
      ],
    };
    expect(() => load([listOp, createOp, paged])).toThrow(
      /chain note_first step create pages write op create_note: a bulk write, which a chain doesn't run/,
    );
  });

  it("refuses --each-from over a write op", () => {
    const playbook = load([listOp, detailOp, createOp]);
    expect(() =>
      chain.eachFromChain({
        playbook,
        op: playbook.ops.get("create_note"),
        eachFrom: { op: "list_postings", path: "id" },
        given: ["note"],
      }),
    ).toThrow(/--each-from runs read ops only; create_note is a write/);
  });
});

describe("chain write steps: runs", () => {
  it("sends the write once with its own receipt; the same inputs are blocked, and --repeat sends again", async () => {
    const playbook = load([listOp, createOp, noteChain]);
    const first = run(playbook, "note_first", { company: "acme", note: "hi" });
    await expect(first.result).resolves.toMatchObject({
      status: "completed",
      value: true,
      steps: [
        { id: "list", op: "list_postings", runs: 1 },
        { id: "create", op: "create_note", runs: 1 },
      ],
    });
    expect(sent(first.tab)).toEqual(["GET /api/list?company=acme", "POST /api/notes"]);
    // The receipt is the step op's own, keyed by its inputs after binding.
    const key = receipts.semanticClaimKey({
      playbookId: "jobs",
      op: playbook.ops.get("create_note"),
      args: { posting_id: "a1", note: "hi" },
    });
    expect(attempts()).toEqual([{ claim: key, op: "create_note", status: "verified" }]);

    const again = run(playbook, "note_first", { company: "acme", note: "hi" });
    await expect(again.result).rejects.toThrow(
      /chain note_first step create \(create_note\) failed: write blocked: attempt \S+ was sent at \d\d:\d\d and succeeded\. Add --repeat to send it again\./,
    );
    expect(sent(again.tab)).toEqual(["GET /api/list?company=acme"]);

    // New inputs are a new claim.
    const other = run(playbook, "note_first", { company: "acme", note: "other" });
    await expect(other.result).resolves.toMatchObject({ status: "completed" });

    const repeated = run(playbook, "note_first", { company: "acme", note: "hi" }, { repeat: true });
    await expect(repeated.result).resolves.toMatchObject({ status: "completed" });
    expect(sent(repeated.tab)).toEqual(["GET /api/list?company=acme", "POST /api/notes"]);
    expect(attempts().filter((attempt) => attempt.claim === key)).toHaveLength(2);
  });

  it("keeps a receipt per write step, and stops after a send when a later write is blocked", async () => {
    const both = {
      ...noteChain,
      id: "note_and_tag",
      chain: [
        listStep,
        createStep,
        { id: "tag", op: "tag_posting", with: { posting_id: { from: "list", path: "$[0].id" } } },
      ],
      output: "tag",
    };
    const playbook = load([listOp, createOp, tagOp, both]);
    const first = run(playbook, "note_and_tag", { company: "acme", note: "hi" });
    await expect(first.result).resolves.toMatchObject({ status: "completed" });
    expect(sent(first.tab)).toEqual([
      "GET /api/list?company=acme",
      "POST /api/notes",
      "POST /api/tag/a1",
    ]);
    const saved = attempts();
    expect(saved.map((attempt) => attempt.op).sort()).toEqual(["create_note", "tag_posting"]);
    expect(new Set(saved.map((attempt) => attempt.claim)).size).toBe(2);

    // A new note is a new claim for create; tag's inputs are the same, so it is blocked, after the
    // note was sent.
    const second = run(playbook, "note_and_tag", { company: "acme", note: "second" });
    await expect(second.result).rejects.toThrow(
      /chain note_and_tag step tag \(tag_posting\) failed: write blocked: attempt \S+ was sent at .+ and succeeded\. Add --repeat to send it again\. The chain stopped after it sent write step create \(create_note\), attempt \S+, which succeeded\. Check the site before you run it again; its sent writes need --repeat to send again\./,
    );
    expect(sent(second.tab)).toEqual(["GET /api/list?company=acme", "POST /api/notes"]);
  });

  it("stops without resending when a step after a write fails, naming the write and its state", async () => {
    const thenRead = {
      ...noteChain,
      id: "note_then_read",
      chain: [
        listStep,
        createStep,
        { id: "detail", op: "get_posting", with: { posting_id: { from: "list", path: "$[0].id" } } },
      ],
      output: "detail",
    };
    const playbook = load([listOp, detailOp, createOp, thenRead]);
    const failed = run(
      playbook,
      "note_then_read",
      { company: "acme", note: "hi" },
      { fail: ["/api/detail/a1"] },
    );
    await expect(failed.result).rejects.toThrow(
      /chain note_then_read step detail \(get_posting\) failed: All strategies failed \(network: network strategy returned 500\)\. The chain stopped after it sent write step create \(create_note\), attempt \S+, which succeeded\. Check the site before you run it again; its sent writes need --repeat to send again\./,
    );
    expect(sent(failed.tab)).toEqual([
      "GET /api/list?company=acme",
      "POST /api/notes",
      "GET /api/detail/a1",
    ]);
    expect(attempts()).toEqual([expect.objectContaining({ op: "create_note", status: "verified" })]);
  });

  it("leaves a write that failed after it was sent in doubt, with no fallback and no resend", async () => {
    const playbook = load([listOp, createOp, noteChain]);
    const failed = run(playbook, "note_first", { company: "acme", note: "hi" }, { fail: ["/api/notes"] });
    await expect(failed.result).rejects.toThrow(
      /chain note_first step create \(create_note\) failed: network strategy returned 500\. The chain stopped after it sent write step create \(create_note\), attempt \S+, whose result is unknown \(in doubt\)\. Check the site before you run it again; its sent writes need --repeat to send again\./,
    );
    expect(sent(failed.tab)).toEqual(["GET /api/list?company=acme", "POST /api/notes"]);
    // The workflow fallback never ran.
    expect(failed.tab.executeTool.mock.calls.map(([tool]) => tool)).not.toContain("navigate");
    expect(attempts()).toEqual([expect.objectContaining({ op: "create_note", status: "indeterminate" })]);

    const again = run(playbook, "note_first", { company: "acme", note: "hi" });
    await expect(again.result).rejects.toThrow(
      /write blocked: attempt \S+ was sent at .+ and its result is unknown\. Check the site, then add --repeat to send again\./,
    );
    expect(sent(again.tab)).not.toContain("POST /api/notes");
  });

  it("names a write step that failed before it was sent as unsent", async () => {
    const playbook = load([listOp, createOp, noteChain]);
    const failed = run(playbook, "note_first", { company: "acme", note: "hi" }, { fail: ["/api/list"] });
    await expect(failed.result).rejects.toThrow(
      /^chain note_first step list \(list_postings\) failed: All strategies failed \(network: network strategy returned 500\)$/,
    );
    expect(attempts()).toEqual([]);
  });

  it("lists each write step in a dry run with what it sends and its receipt check", async () => {
    const playbook = load([listOp, createOp, noteChain]);
    const preview = chain.previewChainOp({
      playbook,
      op: playbook.ops.get("note_first"),
      args: { company: "acme", note: "hi" },
    });
    expect(preview).toMatchObject({
      effect: "write",
      steps: [
        { id: "list", op: "list_postings" },
        {
          id: "create",
          op: "create_note",
          write: {
            sends: "POST https://jobs.test/api/notes",
            receipt: "checked when the step runs: its inputs come from earlier steps",
          },
        },
      ],
      receipt: "one per write step, reserved when the step is sent",
    });
    expect(preview.steps[0]).not.toHaveProperty("write");
    expect(chain.chainWrites({ playbook, op: playbook.ops.get("note_first") })).toEqual([
      { step: "create", op: "create_note", sends: "POST https://jobs.test/api/notes" },
    ]);
  });

  it("checks a write step's receipt in a dry run when its inputs come from the chain's own", async () => {
    const direct = {
      ...noteChain,
      id: "note_direct",
      args: { posting_id: { type: "string", required: true }, note: { type: "string", required: true } },
      chain: [{ id: "create", op: "create_note", with: { posting_id: "{{posting_id}}", note: "{{note}}" } }],
    };
    const playbook = load([listOp, createOp, direct]);
    const op = playbook.ops.get("note_direct");
    const args = { posting_id: "a1", note: "hi" };
    expect(chain.previewChainOp({ playbook, op, args }).steps[0].write.receipt).toBe(
      "clear: --write reserves one when the step is sent",
    );
    await run(playbook, "note_direct", args).result;
    expect(chain.previewChainOp({ playbook, op, args }).steps[0].write.receipt).toMatch(
      /^blocked: write blocked: attempt \S+ was sent at .+ and succeeded/,
    );
    expect(chain.previewChainOp({ playbook, op, args, repeat: true }).steps[0].write.receipt).toBe(
      "clear: --write reserves one when the step is sent",
    );
  });
});
