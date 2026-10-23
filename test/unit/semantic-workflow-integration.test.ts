import { describe, expect, it, vi } from "vitest";

declare const process: { stdout: { write(chunk: unknown): boolean } };
const { createConcreteSemanticExecutor } = require("../../native/semantic-workflow-executor.cjs");
const { createSemanticEvaluator } = require("../../native/semantic-evaluator.cjs");
const { executeDoSteps } = require("../../native/do-executor.cjs");

const identity = {
  browserEpoch: "epoch",
  tabId: 1,
  frameId: 0,
  fullUrl: "https://example.test/shop",
  documentToken: "doc",
};
const envelope = (value: unknown) => ({
  result: { content: [{ type: "text", text: JSON.stringify(value) }] },
});

function browser() {
  return vi.fn(async (tool: string, _args: Record<string, unknown>) => {
    if (tool === "page.read") {
      return envelope({
        semanticObservation: {
          identity,
          page: { title: "Shop", readyState: "complete", modals: [] },
          candidates: [
            { ref: "e2", role: "link", name: "Blue bottle", type: "a", href: "/bottle" },
          ],
          chunks: [{ id: "c1", text: "Blue bottle", refs: ["e2"] }],
          omitted: { candidates: 0, chunks: 0 },
        },
      });
    }
    if (tool !== "semantic.scrollScope") {
      throw new Error(`unexpected browser tool ${tool}`);
    }
    return envelope({
      success: true,
      scopeToken: "scope",
      geometry: {
        scrollTop: 0,
        scrollHeight: 800,
        clientHeight: 800,
        intervalStart: 0,
        intervalEnd: 800,
        atTop: true,
        atBottom: true,
      },
    });
  });
}

describe("semantic workflow integration seam", () => {
  it.each([
    { label: "default", search: undefined, observationLimit: 12 },
    { label: "declared override", search: { maxObservations: 2 }, observationLimit: 2 },
  ])("reports the $label per-step observation limit", async ({ search, observationLimit }) => {
    const request = browser();
    const evaluate = vi.fn(async () => ({
      model: "jev-test",
      usage: { input_tokens: 2, output_tokens: 1 },
      answers: {
        target: {
          type: "choice",
          choice: "e2",
          confidence: 0.2,
          probabilities: { e2: 0.99, none: 0.01 },
        },
      },
    }));
    const evaluator = createSemanticEvaluator({
      model: "jev-1.13.0",
      env: { TYPESAFE_API_KEY: "test-key" },
      loadSdk: () => ({
        TypeSafeClient: class {
          systemOne = evaluate;
        },
      }),
    });
    const attemptStore = {
      acquire: vi.fn(),
      checkpoint: vi.fn(),
      release: vi.fn(),
    };
    const workflow = {
      semantic: { version: 1 },
      steps: [
        {
          id: "find",
          tool: "semantic.step",
          as: "product",
          args: {
            op: "find",
            target: { query: "Blue bottle", role: "link" },
            ...(search ? { search } : {}),
          },
        },
      ],
    };

    const result = await executeDoSteps(
      [{ id: "find", cmd: "semantic.step", as: "product", args: workflow.steps[0].args }],
      {
        quiet: true,
        stepDelay: 0,
        executeTool: vi.fn(() => {
          throw new Error("semantic step reached generic transport");
        }),
        createSemanticExecutor: () =>
          createConcreteSemanticExecutor({ request, evaluator, attemptStore, workflow }),
      },
    );

    expect(result.status).toBe("completed");
    expect(result.semantic).toMatchObject({
      stepId: "find",
      usage: { providerCalls: 1, inputTokens: 2, outputTokens: 1 },
      limits: {
        maxProviderCalls: 32,
        maxSearchObservations: observationLimit,
        maxSearchObservationsCeiling: 32,
      },
    });
    expect(result.vars.product.binding).toMatchObject({
      handle: "product",
      role: "link",
      name: "Blue bottle",
    });
    expect(evaluate).toHaveBeenCalledOnce();
    expect(attemptStore.release).toHaveBeenCalledWith(
      expect.objectContaining({ state: "completed" }),
    );
  });
  it("selects the model for semantic steps from SURF_SEMANTIC_MODEL through the shared factory", async () => {
    const fetch = vi.fn(
      async (_url: string, _init: unknown) =>
        new Response(
          JSON.stringify({
            success: true,
            result: {
              model: "clef-flash",
              usage: { input_tokens: 2, output_tokens: 1 },
              answers: {
                target: {
                  type: "choice",
                  choice: "e2",
                  confidence: 0.9,
                  probabilities: { e2: 0.99, none: 0.01 },
                },
              },
            },
          }),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    try {
      const args = { op: "find", target: { query: "Blue bottle", role: "link" } };
      const execute = createConcreteSemanticExecutor({
        request: browser(),
        attemptStore: { acquire: vi.fn(), checkpoint: vi.fn(), release: vi.fn() },
        workflow: {
          semantic: { version: 1 },
          steps: [{ id: "find", tool: "semantic.step", args }],
        },
        env: {
          SURF_SEMANTIC_MODEL: "clef-flash",
          CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
          CLOUDFLARE_API_TOKEN: "fake-token",
        },
      });
      const result = await execute({ id: "find", as: "product", args });
      expect(result.kind).toBe("success");
      expect(result.semantic).toMatchObject({
        provider: "cloudflare",
        model: "clef-flash",
        providerCalls: 1,
        providerLatencyMs: expect.any(Number),
      });
      expect(result.semantic).not.toHaveProperty("extraction");
      expect(result.semantic.usage).toMatchObject({ extractions: 0 });
      expect(fetch.mock.calls[0][0]).toMatch(/\/ai\/run\/@cf\/cloudflare\/clef-flash$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("reports the run summary when the workflow state store cannot be acquired", async () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "surf-semantic-state-"));
    const stateFile = path.join(root, "not-a-directory");
    fs.writeFileSync(stateFile, "");
    try {
      const request = browser();
      const args = { op: "find", target: { query: "Blue bottle", role: "link" } };
      const result = await executeDoSteps([{ id: "find", cmd: "semantic.step", args }], {
        quiet: true,
        stepDelay: 0,
        executeTool: vi.fn(),
        createSemanticExecutor: () =>
          createConcreteSemanticExecutor({
            request,
            workflow: {
              semantic: { version: 1 },
              steps: [{ id: "find", tool: "semantic.step", args }],
            },
            env: {
              SURF_STATE_DIR: stateFile,
              SURF_SEMANTIC_MODEL: "clef",
              CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
              CLOUDFLARE_API_TOKEN: "fake-token",
            },
          }),
      });
      expect(result.status).toBe("failed");
      expect(result.error).toContain("private state path is not a directory");
      expect(result.semantic).toMatchObject({
        reason: "checkpoint_failure",
        provider: "cloudflare",
        model: "clef",
        providerCalls: 0,
        providerLatencyMs: 0,
      });
      expect(request).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("semantic workflow extract step through the executor", () => {
  const cloudflare = {
    CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
    CLOUDFLARE_API_TOKEN: "fake-token",
  };
  const fields = { total: { type: "number", decimals: 2 }, code: { type: "text" } };
  const extractStep = {
    id: "read",
    tool: "semantic.step",
    as: "order",
    args: { op: "extract", fields },
  };
  const findStep = {
    id: "find",
    tool: "semantic.step",
    as: "product",
    args: { op: "find", target: { query: "Blue bottle", role: "link" } },
  };
  const doStep = ({ id, as, args }: Record<string, any>) => ({
    id,
    as,
    cmd: "semantic.step",
    args,
  });
  const ok = (result: unknown) => new Response(JSON.stringify({ success: true, result }));
  function cloudflareFetch() {
    return vi.fn(async (url: string, _init: unknown) => {
      if (url.endsWith("/clairic")) {
        return ok({
          answers: {
            total: { type: "number", value: 4219.37, confidence: 0.97, p_null: 0.01 },
            code: { type: "text", value: "ZX-7731-Q", confidence: 0.95, p_null: 0.02 },
          },
          truncated: false,
          usage: { input_tokens: 7, output_tokens: 3 },
        });
      }
      return ok({
        model: "clef-flash",
        usage: { input_tokens: 2, output_tokens: 1 },
        answers: {
          target: {
            type: "choice",
            choice: "e2",
            confidence: 0.9,
            probabilities: { e2: 0.99, none: 0.01 },
          },
        },
      });
    });
  }

  it("keeps the decision model and Clairic apart, and reports each summary", async () => {
    const fetch = cloudflareFetch();
    vi.stubGlobal("fetch", fetch);
    try {
      const steps = [findStep, extractStep];
      const result = await executeDoSteps(steps.map(doStep), {
        quiet: true,
        stepDelay: 0,
        executeTool: vi.fn(),
        createSemanticExecutor: () =>
          createConcreteSemanticExecutor({
            request: browser(),
            attemptStore: { acquire: vi.fn(), checkpoint: vi.fn(), release: vi.fn() },
            workflow: { semantic: { version: 1 }, steps },
            env: { ...cloudflare, SURF_SEMANTIC_MODEL: "clef-flash" },
          }),
      });
      expect(result.status).toBe("completed");
      expect(fetch.mock.calls.map(([url]) => url.replace(/^.*\/ai\/run\//, ""))).toEqual([
        "@cf/cloudflare/clef-flash",
        "@cf/cloudflare/clairic",
      ]);
      expect(result.semantic).toMatchObject({
        stepId: "read",
        provider: "cloudflare",
        model: "clef-flash",
        providerCalls: 1,
        extraction: {
          provider: "cloudflare",
          model: "clairic",
          providerCalls: 1,
          providerLatencyMs: expect.any(Number),
        },
        usage: { providerCalls: 2, semanticDecisions: 1, extractions: 1, observations: 2 },
      });
      expect(result.results[0].semantic).toMatchObject({ extraction: { providerCalls: 0 } });
      expect(result.vars.order).toMatchObject({
        status: "extracted",
        fields: {
          total: { type: "number", status: "extracted", value: 4219.37 },
          code: { type: "text", status: "extracted", value: "ZX-7731-Q" },
        },
        appliedThresholds: { extract: 0.8, null: 0.5 },
        referenceDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        page: { origin: "https://example.test", title: "Shop" },
        omitted: { candidates: 0, chunks: 0 },
      });
      expect(result.vars.order).not.toHaveProperty("usage");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ["no TypeSafe key", {}, "typesafe", "jev-1.13.0"],
    ["an unregistered SURF_SEMANTIC_MODEL", { SURF_SEMANTIC_MODEL: "clairic" }, null, "clairic"],
  ])(
    "runs an extract-only workflow with Cloudflare credentials and %s",
    async (_label, extra, provider, model) => {
      vi.stubGlobal("fetch", cloudflareFetch());
      try {
        const execute = createConcreteSemanticExecutor({
          request: browser(),
          attemptStore: { acquire: vi.fn(), checkpoint: vi.fn(), release: vi.fn() },
          workflow: { semantic: { version: 1 }, steps: [extractStep] },
          env: { ...cloudflare, ...extra },
        });
        const result = await execute(extractStep);
        expect(result.kind).toBe("success");
        expect(result.semantic).toMatchObject({
          provider,
          model,
          providerCalls: 0,
          providerLatencyMs: 0,
          extraction: { model: "clairic", providerCalls: 1 },
        });
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it("needs Cloudflare credentials for extract before any browser request", async () => {
    const request = browser();
    const result = await executeDoSteps([doStep(extractStep)], {
      quiet: true,
      stepDelay: 0,
      executeTool: vi.fn(),
      createSemanticExecutor: () =>
        createConcreteSemanticExecutor({
          request,
          workflow: { semantic: { version: 1 }, steps: [extractStep] },
          env: { TYPESAFE_API_KEY: "test-key" },
        }),
    });
    expect(result.status).toBe("failed");
    expect(result.error).toBe(
      "Clairic needs Cloudflare credentials: set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, or run: surf semantic auth set --provider cloudflare",
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("writes no extracted value to the workflow state files", async () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "surf-semantic-state-"));
    vi.stubGlobal("fetch", cloudflareFetch());
    try {
      const result = await executeDoSteps([doStep(extractStep)], {
        quiet: true,
        stepDelay: 0,
        executeTool: vi.fn(),
        createSemanticExecutor: () =>
          createConcreteSemanticExecutor({
            request: browser(),
            workflow: { semantic: { version: 1 }, steps: [extractStep] },
            env: { ...cloudflare, SURF_STATE_DIR: root },
          }),
      });
      expect(result.status).toBe("completed");
      expect(result.vars.order.fields.code.value).toBe("ZX-7731-Q");
      const files = (fs.readdirSync(root, { recursive: true }) as string[])
        .map((name) => path.join(root, name))
        .filter((file) => fs.statSync(file).isFile());
      expect(files.map((file) => path.basename(file)).sort()).toEqual([
        "checkpoint.json",
        "run.json",
      ]);
      const checkpoint = files.find((file) => file.endsWith("checkpoint.json")) as string;
      expect(JSON.parse(fs.readFileSync(checkpoint, "utf8")).completedSteps).toEqual(["read"]);
      for (const file of files) {
        const text = fs.readFileSync(file, "utf8");
        expect(text).not.toContain("4219");
        expect(text).not.toContain("ZX-7731");
      }
    } finally {
      vi.unstubAllGlobals();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["4219.37", "completed", undefined],
    ["4300.55", "failed", "assertion_mismatch"],
  ])(
    "checks the extracted total against input %s without printing a value",
    async (expected, status, reason) => {
      const checkStep = {
        id: "check",
        tool: "semantic.step",
        args: {
          op: "assert",
          mode: "value",
          binding: "order",
          field: "total",
          input: "expectedTotal",
        },
      };
      const steps = [extractStep, checkStep];
      const request = browser();
      const fetch = cloudflareFetch();
      vi.stubGlobal("fetch", fetch);
      const printed: string[] = [];
      const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
        printed.push(String(chunk));
        return true;
      });
      const log = vi.spyOn(console, "log").mockImplementation((...items) => {
        printed.push(items.join(" "));
      });
      try {
        const result = await executeDoSteps(steps.map(doStep), {
          stepDelay: 0,
          executeTool: vi.fn(),
          createSemanticExecutor: () =>
            createConcreteSemanticExecutor({
              request,
              attemptStore: { acquire: vi.fn(), checkpoint: vi.fn(), release: vi.fn() },
              workflow: { semantic: { version: 1 }, steps },
              inputs: { expectedTotal: expected },
              env: cloudflare,
            }),
        });
        expect(result.status).toBe(status);
        expect(result.error).toBe(reason);
        expect(result.results[1]).not.toHaveProperty("output");
        expect(result.vars).not.toHaveProperty("check");
        // The extract result in vars is the only place a page value may appear.
        const output = JSON.stringify({ ...result, vars: undefined }) + printed.join("");
        for (const value of ["4219", "ZX-7731", expected]) {
          expect(output).not.toContain(value);
        }
        expect(printed.join("")).toContain('input="expectedTotal"');
      } finally {
        write.mockRestore();
        log.mockRestore();
        vi.unstubAllGlobals();
      }
    },
  );
});
