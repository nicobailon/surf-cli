import { describe, expect, it, vi } from "vitest";

const {
  SEMANTIC_POLICY,
  chooseAction,
  filter,
  find,
  verify,
} = require("../../native/semantic-core.cjs");

type Question = { criteria: Record<string, unknown> };
type Questions = Record<string, Question>;

function responseFor(
  questions: Questions,
  selections: Record<string, string>,
  selectedProbability = 0.9,
) {
  const answers = Object.fromEntries(
    Object.entries(questions).map(([name, question]) => {
      const labels = Object.keys(question.criteria);
      const selected = selections[name] || labels[0];
      const remainder = labels.length > 1 ? (1 - selectedProbability) / (labels.length - 1) : 0;
      return [
        name,
        {
          type: "choice",
          choice: selected,
          confidence: 0.42,
          probabilities: Object.fromEntries(
            labels.map((label) => [label, label === selected ? selectedProbability : remainder]),
          ),
        },
      ];
    }),
  );
  return { model: "jev-response-model", usage: { input_tokens: 10, output_tokens: 2 }, answers };
}

const evaluateWith = (selections: Record<string, string>, probability = 0.9) =>
  vi.fn(async (_state: unknown, questions: Questions) =>
    responseFor(questions, selections, probability),
  );

describe("semantic decision core", () => {
  it("publishes the approved v1 policy constants", () => {
    expect(SEMANTIC_POLICY).toMatchObject({
      model: "jev-1.13.0",
      timeoutMs: 5000,
      probabilitySumTolerance: 0.01,
      thresholds: {
        find: 0.7,
        filter: 0.65,
        verifyPositive: 0.85,
        verifyNegative: 0.85,
        write: 0.95,
        exactRefWrite: 0.65,
      },
      limits: {
        stateBytes: 24 * 1024,
        candidates: 64,
        actionChoices: 70,
        chunks: 48,
        questions: 50,
        filterTop: 12,
        inputSlots: 16,
        inputValueBytes: 16 * 1024,
        defaultSteps: 5,
        maxSteps: 8,
        defaultWallMs: 30_000,
        maxWallMs: 60_000,
        providerCalls: 17,
        invalidActionDecisionRetries: 1,
        staleRefreshes: 2,
        identicalObservationHashes: 2,
      },
    });
  });

  it("find selects only a supplied candidate and gates on selected probability", async () => {
    const candidates = [{ id: "ref.1", role: "button", name: "Preferences" }];
    const found = await find({
      state: { title: "Settings" },
      goal: "preferences",
      candidates,
      evaluate: evaluateWith({ target: "ref.1" }, 0.7),
    });
    const uncertain = await find({
      state: {},
      goal: "preferences",
      candidates,
      evaluate: evaluateWith({ target: "ref.1" }, 0.69),
    });
    const overridden = await find({
      state: {},
      goal: "preferences",
      candidates,
      thresholds: { find: 0.69 },
      evaluate: evaluateWith({ target: "ref.1" }, 0.69),
    });

    expect(found).toMatchObject({
      status: "found",
      candidate: candidates[0],
      appliedThreshold: 0.7,
      model: "jev-response-model",
      decision: { confidence: 0.42 },
    });
    expect(uncertain).toMatchObject({ status: "uncertain", candidate: null });
    expect(overridden).toMatchObject({ status: "found", appliedThreshold: 0.69 });
  });

  it("verify gates positive and negative labels independently and selects only verbatim evidence", async () => {
    const evidence = [{ id: "line.2", text: "Saved" }];
    const result = await verify({
      state: { chunks: evidence },
      outcome: "preferences saved",
      evidence,
      evaluate: evaluateWith({ verdict: "satisfied", evidence: "line.2" }, 0.9),
    });

    expect(result).toMatchObject({
      status: "satisfied",
      appliedThreshold: 0.85,
      evidence: evidence[0],
    });
    expect(result.evidence.text).toBe("Saved");
  });

  it("filter fans out one closed question per chunk and deterministically ranks passing chunks", async () => {
    const chunks = [
      { id: "c1", text: "first" },
      { id: "c2", text: "second" },
    ];
    const evaluate = vi.fn(async (_state: unknown, questions: Questions) => {
      const response = responseFor(questions, { chunk_0: "relevant", chunk_1: "relevant" }, 0.7);
      response.answers.chunk_1.probabilities = { relevant: 0.8, not_relevant: 0.2 };
      return response;
    });
    const result = await filter({
      state: { origin: "https://example.test" },
      goal: "settings",
      chunks,
      top: 1,
      evaluate,
    });
    const overridden = await filter({
      state: { origin: "https://example.test" },
      goal: "settings",
      chunks,
      top: 1,
      thresholds: { filter: 0.81 },
      evaluate,
    });

    expect(Object.keys(evaluate.mock.calls[0][1])).toEqual(["chunk_0", "chunk_1"]);
    expect(result).toMatchObject({
      status: "filtered",
      appliedThreshold: 0.65,
      omittedCount: 1,
      chunks: [{ id: "c2", text: "second" }],
    });
    expect(overridden).toMatchObject({ status: "uncertain", appliedThreshold: 0.81, chunks: [] });
  });

  it("returns uncertain filtering instead of masquerading as an empty page", async () => {
    const result = await filter({
      state: {},
      goal: "missing",
      chunks: [{ id: "c1", text: "noise" }],
      evaluate: evaluateWith({ chunk_0: "not_relevant" }, 0.9),
    });
    expect(result).toMatchObject({ status: "uncertain", chunks: [], omittedCount: 1 });
  });

  it("constructs a closed action choice and locally enforces write authorization", async () => {
    const actions = [
      { id: "nav", kind: "navigate", url: "https://example.test/settings" },
      { id: "click", kind: "click", ref: "ref.1" },
      { id: "fill", kind: "fill", ref: "ref.2", slot: "email" },
      { id: "wait", kind: "wait", durationMs: 500 },
    ];
    const evaluate = evaluateWith({ action: "nav" }, 0.99);
    const result = await chooseAction({
      state: {},
      goal: "open",
      actions,
      origin: "https://example.test",
      allowWrite: false,
      inputSlots: ["email"],
      evaluate,
    });

    expect(Object.keys(evaluate.mock.calls[0][1].action.criteria)).toEqual(["nav", "wait", "stop"]);
    expect(result).toMatchObject({ status: "selected", action: actions[0] });
  });

  it("applies the exact-ref write threshold at its 0.64/0.65 boundary", async () => {
    const action = { id: "fill", kind: "fill", ref: "ref.2", slot: "email" };
    const below = await chooseAction({
      state: {},
      goal: "fill",
      actions: [action],
      origin: "https://example.test",
      allowWrite: true,
      allowRefs: ["ref.2"],
      inputSlots: ["email"],
      evaluate: evaluateWith({ action: "fill" }, 0.64),
    });
    const selected = await chooseAction({
      state: {},
      goal: "fill",
      actions: [action],
      origin: "https://example.test",
      allowWrite: true,
      allowRefs: ["ref.2"],
      inputSlots: ["email"],
      evaluate: evaluateWith({ action: "fill" }, 0.65),
    });
    expect(below).toMatchObject({ status: "uncertain", appliedThreshold: 0.65 });
    expect(selected).toMatchObject({ status: "selected", action, appliedThreshold: 0.65 });
  });

  it("applies per-call write thresholds without changing defaults or exact-ref thresholds", async () => {
    const broadAction = { id: "click", kind: "click", ref: "ref.1" };
    const broadOptions = {
      state: {},
      goal: "add to cart",
      actions: [broadAction],
      origin: "https://example.test",
      allowWrite: true,
      allowRefs: [],
      inputSlots: [],
      evaluate: evaluateWith({ action: "click" }, 0.85),
    };
    const defaultResult = await chooseAction(broadOptions);
    const overridden = await chooseAction({ ...broadOptions, thresholds: { write: 0.85 } });
    expect(defaultResult).toMatchObject({ status: "uncertain", appliedThreshold: 0.95 });
    expect(overridden).toMatchObject({
      status: "selected",
      action: broadAction,
      appliedThreshold: 0.85,
    });
    expect(SEMANTIC_POLICY.thresholds.write).toBe(0.95);

    const exactOptions = {
      ...broadOptions,
      allowRefs: ["ref.1"],
      evaluate: evaluateWith({ action: "click" }, 0.6),
    };
    const broadOnly = await chooseAction({ ...exactOptions, thresholds: { write: 0.5 } });
    const exactOverride = await chooseAction({
      ...exactOptions,
      thresholds: { exactRefWrite: 0.6 },
    });
    expect(broadOnly).toMatchObject({ status: "uncertain", appliedThreshold: 0.65 });
    expect(exactOverride).toMatchObject({ status: "selected", appliedThreshold: 0.6 });
  });

  it("applies positive and negative verification overrides independently", async () => {
    const options = { state: {}, outcome: "saved", evidence: [] };
    const positiveDefault = await verify({
      ...options,
      evaluate: evaluateWith({ verdict: "satisfied" }, 0.8),
    });
    const positiveOverride = await verify({
      ...options,
      thresholds: { verifyPositive: 0.8 },
      evaluate: evaluateWith({ verdict: "satisfied" }, 0.8),
    });
    const negativeOverride = await verify({
      ...options,
      thresholds: { verifyNegative: 0.8 },
      evaluate: evaluateWith({ verdict: "not_satisfied" }, 0.8),
    });
    expect(positiveDefault).toMatchObject({ status: "uncertain", appliedThreshold: 0.85 });
    expect(positiveOverride).toMatchObject({ status: "satisfied", appliedThreshold: 0.8 });
    expect(negativeOverride).toMatchObject({ status: "not_satisfied", appliedThreshold: 0.8 });
  });

  it.each([
    {
      name: "broad authorization",
      actions: [{ id: "click", kind: "click", ref: "ref.1" }],
      allowRefs: [],
      inputSlots: [],
      selected: "click",
    },
    {
      name: "multiple allowed refs",
      actions: [
        { id: "click-1", kind: "click", ref: "ref.1" },
        { id: "click-2", kind: "click", ref: "ref.2" },
      ],
      allowRefs: ["ref.1", "ref.2"],
      inputSlots: [],
      selected: "click-1",
    },
    {
      name: "multiple fill slots",
      actions: [
        { id: "fill-email", kind: "fill", ref: "ref.1", slot: "email" },
        { id: "fill-backup", kind: "fill", ref: "ref.1", slot: "backup" },
      ],
      allowRefs: ["ref.1"],
      inputSlots: ["email", "backup"],
      selected: "fill-email",
    },
  ])("retains the 0.95 write threshold for $name", async (testCase) => {
    const below = await chooseAction({
      state: {},
      goal: "write",
      actions: testCase.actions,
      origin: "https://example.test",
      allowWrite: true,
      allowRefs: testCase.allowRefs,
      inputSlots: testCase.inputSlots,
      evaluate: evaluateWith({ action: testCase.selected }, 0.94),
    });
    const selected = await chooseAction({
      state: {},
      goal: "write",
      actions: testCase.actions,
      origin: "https://example.test",
      allowWrite: true,
      allowRefs: testCase.allowRefs,
      inputSlots: testCase.inputSlots,
      evaluate: evaluateWith({ action: testCase.selected }, 0.95),
    });
    expect(below).toMatchObject({ status: "uncertain", appliedThreshold: 0.95 });
    expect(selected).toMatchObject({ status: "selected", appliedThreshold: 0.95 });
  });

  it("rejects unsafe navigation and malformed provider output", async () => {
    await expect(
      chooseAction({
        state: {},
        goal: "leave",
        actions: [{ id: "nav", kind: "navigate", url: "https://other.test" }],
        origin: "https://example.test",
        evaluate: evaluateWith({ action: "nav" }),
      }),
    ).rejects.toMatchObject({ code: "semantic_invalid_request" });

    await expect(
      find({
        state: {},
        goal: "target",
        candidates: [{ id: "r1" }],
        evaluate: async () => ({
          model: "jev",
          usage: { input_tokens: 1, output_tokens: 1 },
          answers: {
            target: {
              type: "choice",
              choice: "invented",
              confidence: 1,
              probabilities: { r1: 0, none: 1 },
            },
          },
        }),
      }),
    ).rejects.toMatchObject({ code: "provider_invalid_response" });
  });

  it("enforces the UTF-8 state cap before invoking the provider", async () => {
    const evaluate = evaluateWith({ target: "none" });
    await expect(
      find({
        state: "x".repeat(SEMANTIC_POLICY.limits.stateBytes),
        goal: "target",
        candidates: [],
        evaluate,
      }),
    ).rejects.toMatchObject({ code: "semantic_invalid_request" });
    expect(evaluate).not.toHaveBeenCalled();
  });
});
