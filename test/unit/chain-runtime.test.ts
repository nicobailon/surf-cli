import { afterEach, describe, expect, it, vi } from "vitest";
import { captureTab } from "../fixtures/capture-tab";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const playbooks = require("../../native/playbooks.cjs");
const chain = require("../../native/chain-runtime.cjs");
const runtime = require("../../native/playbook-runtime.cjs");

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

type Step = Record<string, unknown>;
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

const listStep: Step = { id: "list", op: "list_postings", with: { company: "{{company}}" } };
const detailStep: Step = {
  id: "detail",
  op: "get_posting",
  each: { from: "list", limit: "{{limit}}", delayMs: 1500 },
  with: { posting_id: { from: "item", path: "id" } },
};

const jobsChain: Op = {
  id: "jobs_with_details",
  args: { company: { type: "string", required: true }, limit: { type: "number", default: 5 } },
  chain: [listStep, detailStep],
  output: "detail",
};

function writePlaybook(ops: Op[]) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "surf-chain-"));
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

const ids = ["a1", "a2", "a3", "a4", "a5", "a6", "a7"];

// A jobs site: the list holds `count` postings, each with an id and its page URL; a detail
// answers with the posting's id and title, or `failOn`'s status.
function jobsTab({ count = 3, failOn }: { count?: number; failOn?: string } = {}) {
  return captureTab({
    href: "https://jobs.test/",
    reply: (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/list") {
        const company = parsed.searchParams.get("company");
        const items = ids.slice(0, count).map((posting) => ({
          id: posting,
          url: `https://jobs.test/${company}/${posting}`,
          team: { name: "Data" },
          tags: ["remote"],
        }));
        return { body: JSON.stringify({ items }) };
      }
      const id = parsed.pathname.split("/").pop() ?? "";
      if (id === failOn) {
        return { status: 500, body: "{}" };
      }
      return { body: JSON.stringify({ data: { id, title: `Role ${id}` } }) };
    },
  });
}

function sentPaths(fetchImpl: { mock: { calls: unknown[][] } }) {
  return fetchImpl.mock.calls.map(([url]) => {
    const parsed = new URL(String(url));
    return `${parsed.pathname}${parsed.search}`;
  });
}

describe("chain op validation", () => {
  it("loads a chain op whose steps run earlier steps' records through read ops", () => {
    const playbook = load([listOp, detailOp, jobsChain]);
    const op = playbook.ops.get("jobs_with_details");
    expect(op.effect).toBe("read");
    expect(op.chain.map((step: { id: string }) => step.id)).toEqual(["list", "detail"]);
    expect(op.output).toBe("detail");
    expect(op).not.toHaveProperty("run");
  });

  it.each([
    [
      "a step naming an op the playbook lacks",
      { chain: [{ id: "list", op: "nope" }], output: "list" },
      /step list names op nope, which playbook jobs doesn't have/,
    ],
    [
      "a step binding from a later step",
      {
        chain: [
          { id: "detail", op: "get_posting", with: { posting_id: { from: "list", path: "id" } } },
          { id: "list", op: "list_postings", with: { company: "acme" } },
        ],
        output: "detail",
      },
      /step detail binds posting_id from step list, which comes later/,
    ],
    [
      "an each over a later step",
      {
        chain: [
          { id: "detail", op: "get_posting", each: { from: "list" }, with: { posting_id: "x" } },
          { id: "list", op: "list_postings", with: { company: "acme" } },
        ],
        output: "detail",
      },
      /step detail runs each over step list, which comes later/,
    ],
    [
      "a binding from no step",
      {
        chain: [{ id: "detail", op: "get_posting", with: { posting_id: { from: "nowhere" } } }],
        output: "detail",
      },
      /step detail binds posting_id from nowhere, which is no step/,
    ],
    [
      "an item binding outside each",
      {
        chain: [{ id: "detail", op: "get_posting", with: { posting_id: { from: "item" } } }],
        output: "detail",
      },
      /step detail binds posting_id from item, which only a step with each has/,
    ],
    [
      "an output that is no step",
      { chain: [{ id: "list", op: "list_postings", with: { company: "acme" } }], output: "x" },
      /output x is no step/,
    ],
    [
      "a template naming no chain input",
      {
        chain: [{ id: "list", op: "list_postings", with: { company: "{{who}}" } }],
        output: "list",
      },
      /step list uses \{\{who\}\}, which is no input of the chain/,
    ],
    [
      "an input the step's op doesn't take",
      {
        chain: [{ id: "list", op: "list_postings", with: { company: "acme", team: "x" } }],
        output: "list",
      },
      /step list passes --team, which list_postings doesn't take/,
    ],
    [
      "an each limit over the cap",
      {
        chain: [
          { id: "list", op: "list_postings", with: { company: "acme" } },
          {
            id: "detail",
            op: "get_posting",
            each: { from: "list", limit: 51 },
            with: { posting_id: { from: "item", path: "id" } },
          },
        ],
        output: "detail",
      },
      /each.limit must be an integer from 1 to 50/,
    ],
    [
      "both run and chain",
      { chain: [{ id: "list", op: "list_postings" }], output: "list", run: detailOp.run },
      /has both run and chain/,
    ],
  ])("refuses %s", (_name, body, message) => {
    expect(() => load([listOp, detailOp, { id: "bad", args: {}, ...body }])).toThrow(message);
  });

  it("refuses a chain that runs itself through another chain", () => {
    const first = { id: "first", chain: [{ id: "a", op: "second" }], output: "a" };
    const second = { id: "second", chain: [{ id: "b", op: "first" }], output: "b" };
    expect(() => load([listOp, first, second])).toThrow(
      /chain first runs itself: first → second → first/,
    );
  });

  it("refuses a chain with a write step, and a chain that is a write", () => {
    const write = {
      id: "apply",
      effect: "write",
      args: { posting_id: { type: "string", required: true } },
      safety: { duplicate: "transactional" },
      run: [
        {
          using: "network",
          request: { method: "POST", url: "https://jobs.test/api/apply/{{posting_id}}" },
        },
      ],
    };
    const applying = {
      id: "apply_all",
      chain: [
        { id: "list", op: "list_postings", with: { company: "acme" } },
        {
          id: "apply",
          op: "apply",
          each: { from: "list" },
          with: { posting_id: { from: "item", path: "id" } },
        },
      ],
      output: "apply",
    };
    expect(() => load([listOp, write, applying])).toThrow(
      /chain apply_all step apply runs write op apply; chains with write steps come later/,
    );
    expect(() =>
      load([listOp, { ...jobsChain, effect: "write", chain: [listStep], output: "list" }]),
    ).toThrow(/chain jobs_with_details: chains with write steps come later/);
  });
});

describe("chain op runs", () => {
  it("runs a detail op for each listed record, with the bound ids, delayMs apart", async () => {
    const playbook = load([listOp, detailOp, jobsChain]);
    const tab = jobsTab();
    const sleep = vi.fn(noWait);
    const result = await chain.runChainOp({
      playbook,
      op: playbook.ops.get("jobs_with_details"),
      args: { company: "acme" },
      executeTool: tab.executeTool,
      sleep,
    });
    expect(result).toMatchObject({
      status: "completed",
      playbook: "jobs",
      op: "jobs_with_details",
      strategy: "chain",
      steps: [
        { id: "list", op: "list_postings", runs: 1 },
        { id: "detail", op: "get_posting", runs: 3 },
      ],
    });
    expect(result.value).toEqual([
      { id: "a1", title: "Role a1" },
      { id: "a2", title: "Role a2" },
      { id: "a3", title: "Role a3" },
    ]);
    expect(sentPaths(tab.fetchImpl)).toEqual([
      "/api/list?company=acme",
      "/api/detail/a1",
      "/api/detail/a2",
      "/api/detail/a3",
    ]);
    expect(sleep.mock.calls).toEqual([[1500], [1500], [1500]]);
  });

  it("stops at each.limit, 5 when unset, and waits 2 s by default", async () => {
    const playbook = load([listOp, detailOp, jobsChain]);
    const limited = jobsTab({ count: 7 });
    const sleep = vi.fn(noWait);
    const result = await chain.runChainOp({
      playbook,
      op: playbook.ops.get("jobs_with_details"),
      args: { company: "acme", limit: 2 },
      executeTool: limited.executeTool,
      sleep,
    });
    expect(result.value.map((posting: { id: string }) => posting.id)).toEqual(["a1", "a2"]);
    expect(sleep).toHaveBeenCalledTimes(2);

    const unset = {
      ...jobsChain,
      id: "defaults",
      args: { company: { type: "string" } },
      chain: [listStep, { ...detailStep, each: { from: "list" } }],
    };
    const withDefaults = load([listOp, detailOp, unset]);
    const tab = jobsTab({ count: 7 });
    const waits = vi.fn(noWait);
    const defaults = await chain.runChainOp({
      playbook: withDefaults,
      op: withDefaults.ops.get("defaults"),
      args: { company: "acme" },
      executeTool: tab.executeTool,
      sleep: waits,
    });
    expect(defaults.value).toHaveLength(5);
    expect(waits.mock.calls).toEqual(Array(5).fill([2000]));
  });

  it("binds one URL path segment of a record's field", async () => {
    const bySegment = {
      ...jobsChain,
      id: "by_url",
      chain: [
        listStep,
        {
          id: "detail",
          op: "get_posting",
          each: { from: "list", limit: 2, delayMs: 0 },
          with: { posting_id: { from: "item", path: "url", segment: 2 } },
        },
      ],
    };
    const playbook = load([listOp, detailOp, bySegment]);
    const tab = jobsTab();
    const result = await chain.runChainOp({
      playbook,
      op: playbook.ops.get("by_url"),
      args: { company: "acme" },
      executeTool: tab.executeTool,
      sleep: noWait,
    });
    expect(result.value.map((posting: { id: string }) => posting.id)).toEqual(["a1", "a2"]);
    expect(sentPaths(tab.fetchImpl).slice(1)).toEqual(["/api/detail/a1", "/api/detail/a2"]);
  });

  it("stops at a failing step with an error naming it", async () => {
    const playbook = load([listOp, detailOp, jobsChain]);
    const tab = jobsTab({ failOn: "a2" });
    await expect(
      chain.runChainOp({
        playbook,
        op: playbook.ops.get("jobs_with_details"),
        args: { company: "acme" },
        executeTool: tab.executeTool,
        sleep: noWait,
      }),
    ).rejects.toThrow(
      /chain jobs_with_details step detail \(get_posting, record 2 of 3\) failed: All strategies failed \(network: network strategy returned 500\)/,
    );
    expect(sentPaths(tab.fetchImpl)).not.toContain("/api/detail/a3");
  });

  it("gives --each-from the same result as the chain it stands for", async () => {
    const playbook = load([listOp, detailOp, jobsChain]);
    const run = (op: unknown, args: Record<string, unknown>) =>
      chain.runChainOp({
        playbook,
        op,
        args,
        executeTool: jobsTab().executeTool,
        sleep: noWait,
      });
    const built = chain.eachFromChain({
      playbook,
      op: playbook.ops.get("get_posting"),
      eachFrom: { op: "list_postings", path: "id", limit: 3, delayMs: 1500 },
    });
    expect(built.args).toEqual({ company: { type: "string", required: true } });
    const viaFlag = await run(built, { company: "acme" });
    const viaChain = await run(playbook.ops.get("jobs_with_details"), {
      company: "acme",
      limit: 3,
    });
    expect(viaFlag.value).toEqual(viaChain.value);
    expect(viaFlag.value).toHaveLength(3);
  });

  it("parses --each-from as <op>[:<path>][@path.<n>] and fills the op's first required input", () => {
    expect(chain.parseEachFrom("list_postings:url@path.2")).toEqual({
      op: "list_postings",
      path: "url",
      segment: 2,
    });
    expect(chain.parseEachFrom("list_postings:id")).toEqual({ op: "list_postings", path: "id" });
    expect(chain.parseEachFrom("list_postings")).toEqual({ op: "list_postings" });
    expect(() => chain.parseEachFrom("list:id@path.0")).toThrow(/--each-from must be/);

    const playbook = load([listOp, detailOp]);
    const optional = { ...detailOp, args: { posting_id: { type: "string" } } };
    expect(() =>
      chain.eachFromChain({
        playbook,
        op: optional,
        eachFrom: { op: "list_postings", path: "id" },
      }),
    ).toThrow(
      /get_posting has no required input left for each record to fill; name it with --each-into/,
    );
    expect(() =>
      chain.eachFromChain({
        playbook,
        op: detailOp,
        eachFrom: { op: "list_postings", path: "id", into: "nope" },
      }),
    ).toThrow(/--each-into nope is no input of get_posting/);
  });

  it("stops when a binding finds an object, a list or nothing, naming the step, input and path", async () => {
    const bound = (binding: Record<string, unknown>) => ({
      ...jobsChain,
      id: `bad_${Object.values(binding)
        .join("_")
        .replace(/[^a-z0-9]/g, "")}`,
      chain: [
        listStep,
        {
          id: "detail",
          op: "get_posting",
          each: { from: "list", delayMs: 0 },
          with: { posting_id: binding },
        },
      ],
    });
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [
        { from: "item", path: "team" },
        /step detail \(get_posting, record 1 of 3\) failed: binding detail\.posting_id → item\.team is an object; bind a field inside it/,
      ],
      [
        { from: "item", path: "tags" },
        /binding detail\.posting_id → item\.tags is a list; bind a field inside it/,
      ],
      [{ from: "item" }, /binding detail\.posting_id → item is an object; bind a field inside it/],
      [
        { from: "item", path: "missing" },
        /binding detail\.posting_id → item\.missing is missing; bind a path that holds a value/,
      ],
      [
        { from: "list", path: "$[0].team" },
        /binding detail\.posting_id → list\.\$\[0\]\.team is an object; bind a field inside it/,
      ],
      [
        { from: "item", path: "team", segment: 1 },
        /binding detail\.posting_id → item\.team is an object, not a URL, so it has no path segment 1/,
      ],
    ];
    for (const [binding, message] of cases) {
      const op = bound(binding);
      const playbook = load([listOp, detailOp, op]);
      const tab = jobsTab();
      await expect(
        chain.runChainOp({
          playbook,
          op: playbook.ops.get(op.id),
          args: { company: "acme" },
          executeTool: tab.executeTool,
          sleep: noWait,
        }),
      ).rejects.toThrow(message);
      expect(sentPaths(tab.fetchImpl)).toEqual(["/api/list?company=acme"]);
    }
  });

  it("fills the one required input the caller didn't pass, as on a Lever posting", () => {
    const leverDetail = {
      ...detailOp,
      args: {
        company: { type: "string", required: true },
        posting_id: { type: "string", required: true },
      },
    };
    const playbook = load([listOp, leverDetail]);
    const op = playbook.ops.get("get_posting");
    const built = chain.eachFromChain({
      playbook,
      op,
      eachFrom: { op: "list_postings", path: "id" },
      given: ["company"],
    });
    expect(built.args).toEqual({ company: { type: "string", required: true } });
    expect(built.chain[1].with).toEqual({
      company: "{{company}}",
      posting_id: { from: "item", path: "id" },
    });
    expect(() =>
      chain.eachFromChain({ playbook, op, eachFrom: { op: "list_postings", path: "id" } }),
    ).toThrow(
      /get_posting has several required inputs you didn't pass \(company, posting_id\); name the one each record fills with --each-into/,
    );
    expect(() =>
      chain.eachFromChain({
        playbook,
        op,
        eachFrom: { op: "list_postings", path: "id" },
        given: ["company", "posting_id"],
      }),
    ).toThrow(/get_posting has no required input left for each record to fill/);
    expect(
      chain.eachFromChain({
        playbook,
        op,
        eachFrom: { op: "list_postings", path: "id", into: "posting_id" },
      }).chain[1].with.posting_id,
    ).toEqual({ from: "item", path: "id" });
  });

  it("reads a deep, diamond-shaped chain's env headers once per op, at once", () => {
    const leaf = {
      id: "leaf",
      args: {},
      run: [
        {
          using: "network",
          request: {
            url: "https://jobs.test/api/list",
            authInputs: [{ env: "SURF_CHAIN_TEST_KEY", header: "X-Chain-Key" }],
          },
        },
      ],
    };
    // Each level runs the next twice: walked naively, that is 2^30 visits of leaf.
    const levels = Array.from({ length: 30 }, (_, index) => ({
      id: `level${index}`,
      args: {},
      chain: ["a", "b"].map((step) => ({
        id: step,
        op: index === 29 ? "leaf" : `level${index + 1}`,
      })),
      output: "a",
    }));
    const playbook = load([leaf, ...levels]);
    const started = performance.now();
    expect(runtime.authInputs(playbook.ops.get("level0"), playbook)).toEqual([
      { env: "SURF_CHAIN_TEST_KEY", header: "X-Chain-Key" },
    ]);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
