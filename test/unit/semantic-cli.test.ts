import { describe, expect, it } from "vitest";

const semantic = require("../../native/semantic-cli.cjs") as {
  buildActions(
    observation: Record<string, any>,
    inputs: Record<string, string>,
    allowWrite: boolean,
    allowRefs?: string[],
  ): Record<string, any>[];
  normalizeSemanticArgs(args: string[]): string[];
  parseSemanticArgs(args: string[]): Record<string, any> | null;
  providerState(observation: Record<string, any>): Record<string, any>;
  runBrowserSemantic(
    options: Record<string, any>,
    dependencies: Record<string, any>,
  ): Promise<Record<string, any>>;
};

const observation = {
  version: 1,
  identity: {
    browserEpoch: "epoch",
    tabId: 7,
    frameId: 0,
    fullUrl: "https://example.test/settings",
    documentToken: "doc",
  },
  page: { title: "Settings", readyState: "complete", modals: [] },
  candidates: [
    {
      ref: "e1",
      role: "textbox",
      name: "Email",
      type: "input",
      nearbyText: "Contact",
      href: undefined,
    },
    { ref: "e2", role: "button", name: "Delete account", type: "button", nearbyText: "Danger" },
    {
      ref: "e3",
      role: "link",
      name: "Profile",
      type: "a",
      nearbyText: "Navigation",
      href: "/profile",
    },
    {
      ref: "e4",
      role: "link",
      name: "External",
      type: "a",
      nearbyText: "Navigation",
      href: "https://evil.test/",
    },
  ],
  chunks: [{ id: "c1", text: "Account settings", refs: ["e1", "e2"] }],
  omitted: { candidates: 0, chunks: 0 },
};

function response(value: unknown) {
  return { result: { content: [{ type: "text", text: JSON.stringify(value) }] } };
}

function choice(answer: string, labels: string[]) {
  const probabilities = Object.fromEntries(
    labels.map((label) => [label, label === answer ? 0.99 : 0.01 / (labels.length - 1)]),
  );
  if (labels.length === 1) {
    probabilities[answer] = 1;
  }
  return { type: "choice", choice: answer, probabilities, confidence: 0.7 };
}

function provider(answers: Record<string, any>) {
  return { model: "jev-test", usage: { input_tokens: 1, output_tokens: 1 }, answers };
}

describe("semantic CLI", () => {
  it("normalizes grouped commands and parses repeatable authorization without exposing input values in identifiers", () => {
    expect(semantic.normalizeSemanticArgs(["semantic", "auth", "status"])).toEqual([
      "semantic.auth.status",
    ]);
    const parsed = semantic.parseSemanticArgs([
      "semantic",
      "act",
      "fill email",
      "--allow-write",
      "--allow-ref",
      "e1",
      "--allow-ref",
      "e2",
      "--input",
      "email=secret",
    ]);
    expect(parsed).toMatchObject({
      command: "semantic.act",
      allowWrite: true,
      allowRefs: ["e1", "e2"],
      inputs: { email: "secret" },
    });
    expect(() => semantic.parseSemanticArgs(["semantic.act", "goal", "--allow-ref", "e1"])).toThrow(
      "requires --allow-write",
    );
    expect(() =>
      semantic.parseSemanticArgs(["semantic.act", "goal", "--input", "x=a", "--input", "x=b"]),
    ).toThrow("duplicate");
  });

  it("keeps provider state value-free and constructs no click/fill candidates without write authorization", () => {
    const state = semantic.providerState(observation);
    expect(JSON.stringify(state)).not.toContain("secret-value");
    const readonly = semantic.buildActions(observation, { email: "secret-value" }, false);
    expect(readonly.some((action) => action.kind === "click" || action.kind === "fill")).toBe(
      false,
    );
    expect(readonly.filter((action) => action.kind === "navigate")).toEqual([
      expect.objectContaining({ url: "https://example.test/profile" }),
    ]);
    const writable = semantic.buildActions(observation, { email: "secret-value" }, true);
    expect(writable).toContainEqual(expect.objectContaining({ kind: "click", ref: "e2" }));
    expect(writable).toContainEqual(
      expect.objectContaining({ kind: "fill", ref: "e1", slot: "email" }),
    );
    expect(JSON.stringify(writable)).not.toContain("secret-value");
    const withDownload = {
      ...observation,
      candidates: [{ ...observation.candidates[2], download: true }],
    };
    expect(
      semantic.buildActions(withDownload, {}, false).some((action) => action.kind === "navigate"),
    ).toBe(false);
  });

  it("find returns only an observed candidate", async () => {
    const request = async () => response({ semanticObservation: observation });
    const evaluate = async (_state: unknown, questions: Record<string, any>) => {
      const labels = Object.keys(questions.target.criteria);
      return provider({ target: choice("e3", labels) });
    };
    const result = await semantic.runBrowserSemantic(
      { command: "semantic.find", goal: "profile" },
      { request, evaluate },
    );
    expect(result).toMatchObject({ status: "found", candidate: { id: "e3" } });
  });

  it("executes an authorized write once, refreshes, verifies, and redacts the local value from its trace", async () => {
    const requests: Array<{
      tool: string;
      args: Record<string, any>;
      designatedIdentity?: Record<string, any>;
    }> = [];
    const request = async (
      tool: string,
      args: Record<string, any>,
      _timeout: number,
      designatedIdentity?: Record<string, any>,
    ) => {
      requests.push({ tool, args, designatedIdentity });
      return tool === "page.read" ? response({ semanticObservation: observation }) : response("OK");
    };
    let call = 0;
    const evaluate = async (_state: unknown, questions: Record<string, any>) => {
      call++;
      if (questions.action) {
        return provider({
          action: choice("fill:e1:email", Object.keys(questions.action.criteria)),
        });
      }
      const answers: Record<string, any> = {
        verdict: choice("satisfied", ["satisfied", "not_satisfied"]),
      };
      if (questions.evidence) {
        answers.evidence = choice("c1", Object.keys(questions.evidence.criteria));
      }
      return provider(answers);
    };
    const result = await semantic.runBrowserSemantic(
      {
        command: "semantic.act",
        goal: "email updated",
        allowWrite: true,
        allowRefs: ["e1"],
        inputs: { email: "unique-secret" },
        maxSteps: 2,
      },
      { request, evaluate, now: () => 0 },
    );
    expect(result).toMatchObject({ status: "complete", stopReason: "complete" });
    expect(requests.filter((item) => item.tool === "form.fill")).toHaveLength(1);
    expect(requests.filter((item) => item.tool === "page.read")).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain("unique-secret");
    expect(
      requests.find((item) => item.tool === "form.fill")?.args.semanticExpectedIdentity,
    ).toMatchObject({ tabId: 7, ref: "e1", documentToken: "doc" });
    expect(
      requests.filter((item) => item.tool === "page.read")[1].designatedIdentity,
    ).toMatchObject({
      tabId: 7,
      frameId: 0,
    });
    expect(requests.find((item) => item.tool === "form.fill")?.designatedIdentity).toMatchObject({
      tabId: 7,
      frameId: 0,
    });
    expect(call).toBe(2);
  });

  it("never replays a write when verification is not satisfied", async () => {
    let mutations = 0;
    const request = async (tool: string) => {
      if (tool === "page.read") {
        return response({ semanticObservation: observation });
      }
      if (tool === "click") {
        mutations++;
      }
      return response("OK");
    };
    const evaluate = async (_state: unknown, questions: Record<string, any>) => {
      if (questions.action) {
        return provider({ action: choice("click:e2", Object.keys(questions.action.criteria)) });
      }
      const answers: Record<string, any> = {
        verdict: choice("not_satisfied", ["satisfied", "not_satisfied"]),
      };
      if (questions.evidence) {
        answers.evidence = choice("c1", Object.keys(questions.evidence.criteria));
      }
      return provider(answers);
    };
    const result = await semantic.runBrowserSemantic(
      {
        command: "semantic.act",
        goal: "delete account",
        allowWrite: true,
        allowRefs: ["e2"],
        inputs: {},
        maxSteps: 3,
      },
      { request, evaluate, now: () => 0 },
    );
    expect(result).toMatchObject({ status: "stopped", stopReason: "blocked" });
    expect(mutations).toBe(1);
    expect(result.trace).toHaveLength(1);
  });

  it("reserves fixed actions and late narrowed refs at the action cap", () => {
    const candidates = Array.from({ length: 10 }, (_, index) => ({
      ref: `e${index + 1}`,
      role: "textbox",
      name: `Field ${index + 1}`,
      type: "input",
      nearbyText: "Form",
    }));
    const inputs = Object.fromEntries(
      Array.from({ length: 16 }, (_, index) => [`slot${index}`, "value"]),
    );
    const actions = semantic.buildActions(
      { ...observation, candidates },
      inputs,
      true,
      candidates.map((candidate) => candidate.ref),
    );
    expect(actions).toHaveLength(64);
    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "scroll:down_600" }),
        expect.objectContaining({ id: "scroll:up_600" }),
        expect.objectContaining({ id: "scroll:top" }),
        expect.objectContaining({ id: "scroll:bottom" }),
        expect.objectContaining({ id: "wait:500" }),
        expect.objectContaining({ id: "wait:1500" }),
        expect.objectContaining({ id: "click:e9" }),
        expect.objectContaining({ id: "click:e10" }),
        expect.objectContaining({ id: "fill:e9:slot3" }),
        expect.objectContaining({ id: "fill:e10:slot3" }),
      ]),
    );
  });

  it("filter returns only refs associated with selected chunks", async () => {
    const filteredObservation = {
      ...observation,
      chunks: [
        { id: "c1", text: "Profile settings", refs: ["e3"] },
        { id: "c2", text: "Danger zone", refs: ["e2"] },
      ],
    };
    const request = async () => response({ semanticObservation: filteredObservation });
    const evaluate = async (_state: unknown, questions: Record<string, any>) =>
      provider({
        chunk_0: choice("relevant", Object.keys(questions.chunk_0.criteria)),
        chunk_1: choice("not_relevant", Object.keys(questions.chunk_1.criteria)),
      });
    const result = await semantic.runBrowserSemantic(
      { command: "semantic.filter", goal: "profile", top: 1 },
      { request, evaluate },
    );
    expect(result.chunks).toHaveLength(1);
    expect(result.candidates.map((candidate: { id: string }) => candidate.id)).toEqual(["e3"]);
  });
});
