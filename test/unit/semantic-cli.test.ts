import { describe, expect, it, vi } from "vitest";

const { SEMANTIC_POLICY } = require("../../native/semantic-core.cjs") as {
  SEMANTIC_POLICY: { limits: { actionChoices: number } };
};

const semantic = require("../../native/semantic-cli.cjs") as {
  buildActions(
    observation: Record<string, any>,
    inputs: Record<string, string>,
    allowWrite: boolean,
    allowRefs?: string[],
    spentWrites?: Array<{ base: string; context: string }>,
  ): Record<string, any>[];
  buildLogicalCandidates(
    observation: Record<string, any>,
    candidates?: Record<string, any>[],
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

function actionResponse(text: string) {
  return { result: { content: [{ type: "text", text }] } };
}

function choice(answer: string, labels: string[], selectedProbability = 0.99) {
  const probabilities = Object.fromEntries(
    labels.map((label) => [
      label,
      label === answer ? selectedProbability : (1 - selectedProbability) / (labels.length - 1),
    ]),
  );
  if (labels.length === 1) {
    probabilities[answer] = 1;
  }
  return { type: "choice", choice: answer, probabilities, confidence: 0.7 };
}

function provider(answers: Record<string, any>) {
  return { model: "jev-test", usage: { input_tokens: 1, output_tokens: 1 }, answers };
}

function invalidProviderChoice(name: string, labels: string[]) {
  return provider({
    [name]: {
      type: "choice",
      choice: labels[0],
      probabilities: Object.fromEntries(labels.map((label) => [label, 0])),
      confidence: 0,
    },
  });
}

function linkCandidates(count = 64) {
  return Array.from({ length: count }, (_, index) => ({
    ref: `e${index + 1}`,
    role: "link",
    name: `Product ${index + 1}`,
    type: "a",
    nearbyText: `Product card ${index + 1}`,
    href: `/product/${index + 1}`,
  }));
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

  it("parses only applicable per-run semantic threshold overrides", () => {
    expect(
      semantic.parseSemanticArgs([
        "semantic.act",
        "complete checkout",
        "--allow-write",
        "--threshold",
        "find=0.6",
        "--threshold",
        "write=0.85",
        "--threshold",
        "exact-ref-write=0.7",
        "--threshold",
        "verify-positive=0.8",
        "--threshold",
        "verify-negative=1.0",
      ]),
    ).toMatchObject({
      thresholds: {
        find: 0.6,
        write: 0.85,
        exactRefWrite: 0.7,
        verifyPositive: 0.8,
        verifyNegative: 1,
      },
    });
    expect(
      semantic.parseSemanticArgs(["semantic.find", "target", "--threshold", "find=0"]),
    ).toMatchObject({ thresholds: { find: 0 } });
    expect(
      semantic.parseSemanticArgs(["semantic.filter", "target", "--threshold", "filter=1"]),
    ).toMatchObject({ thresholds: { filter: 1 } });
    expect(
      semantic.parseSemanticArgs([
        "semantic.verify",
        "done",
        "--threshold",
        "verify-positive=0.8",
        "--threshold",
        "verify-negative=0.9",
      ]),
    ).toMatchObject({ thresholds: { verifyPositive: 0.8, verifyNegative: 0.9 } });

    for (const args of [
      ["semantic.act", "goal", "--threshold", "unknown=0.5"],
      ["semantic.act", "goal", "--threshold", "write=.85"],
      ["semantic.act", "goal", "--threshold", "write=1.1"],
      ["semantic.act", "goal", "--threshold", "write=NaN"],
      ["semantic.act", "goal", "--threshold", "write=0.8", "--threshold", "write=0.9"],
      ["semantic.find", "goal", "--threshold", "write=0.8"],
      ["semantic.act", "goal", "--threshold", "filter=0.8"],
      ["semantic.verify", "goal", "--threshold", "find=0.8"],
    ]) {
      expect(() => semantic.parseSemanticArgs(args)).toThrow();
    }
  });

  it("keeps provider state value-free and constructs no click/fill candidates without write authorization", () => {
    const state = semantic.providerState(observation);
    expect(JSON.stringify(state)).not.toContain("secret-value");
    const stateful = semantic.providerState({
      ...observation,
      candidates: [{
        ...observation.candidates[1],
        value: "secret-value",
        state: { checked: true, selected: false, value: "secret-value" },
      }],
    });
    expect(stateful.candidates[0].state).toEqual({ checked: true, selected: false });
    expect(JSON.stringify(stateful)).not.toContain("secret-value");
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

  it("offers actions only where the observed role makes them applicable", () => {
    const candidates = [
      { ref: "text", role: "textbox", name: "Name", type: "text" },
      { ref: "button", role: "button", name: "Save", type: "button" },
      { ref: "link", role: "link", name: "Help", type: "a" },
      { ref: "check", role: "checkbox", name: "Remember", type: "checkbox" },
      { ref: "radio", role: "radio", name: "One", type: "radio" },
    ];
    const actions = semantic.buildActions(
      { ...observation, candidates },
      { value: "local-only" },
      true,
    );

    expect(actions.filter((action) => action.ref === "text")).toEqual([
      expect.objectContaining({ kind: "fill", slot: "value" }),
    ]);
    for (const ref of ["button", "link", "check", "radio"]) {
      expect(actions).toContainEqual(expect.objectContaining({ kind: "click", ref }));
      expect(actions.some((action) => action.kind === "fill" && action.ref === ref)).toBe(false);
    }
  });

  it("find returns only an observed candidate", async () => {
    const request = async () => response({ semanticObservation: observation });
    const evaluate = async (_state: unknown, questions: Record<string, any>) => {
      const labels = Object.keys(questions.target.criteria);
      const stateCandidates = Object.keys(questions.target.criteria);
      const selected = stateCandidates.find((label) => label.startsWith("target:"));
      if (!selected) {
        throw new Error("expected grouped navigation target");
      }
      return provider({ target: choice(selected, labels) });
    };
    const result = await semantic.runBrowserSemantic(
      { command: "semantic.find", goal: "profile" },
      { request, evaluate },
    );
    expect(result).toMatchObject({ status: "found", candidate: { id: "e3" } });
  });

  it("groups duplicate image/title product links before find confidence gating and resolves the named ref", async () => {
    const products = {
      ...observation,
      candidates: [
        {
          ref: "image",
          role: "link",
          name: "View Sauce Labs Backpack",
          type: "a",
          nearbyText: "Sauce Labs Backpack product card",
          representation: "image",
          href: "/item/4",
        },
        {
          ref: "title",
          role: "link",
          name: "Sauce Labs Backpack",
          type: "a",
          nearbyText: "Sauce Labs Backpack product card",
          representation: "text",
          href: "https://example.test/item/4",
        },
        {
          ref: "other",
          role: "link",
          name: "Sauce Labs Backpack",
          type: "a",
          nearbyText: "Featured",
          href: "/item/5",
        },
      ],
    };
    let offered: string[] = [];
    const result = await semantic.runBrowserSemantic(
      { command: "semantic.find", goal: "Sauce Labs Backpack" },
      {
        request: async () => response({ semanticObservation: products }),
        evaluate: async (state: Record<string, any>, questions: Record<string, any>) => {
          offered = Object.keys(questions.target.criteria);
          expect(state.candidates).toHaveLength(2);
          const target = state.candidates[0];
          return provider({ target: choice(target.id, offered, 0.7) });
        },
      },
    );

    expect(offered).toHaveLength(3); // two logical destinations plus none
    expect(result).toMatchObject({
      status: "found",
      candidate: { id: "title" },
      logicalCandidate: { refs: ["title", "image"], probability: 0.7 },
      concreteDecision: { ref: "title", probability: 0.7 },
    });
    expect(result.logicalCandidate.id).toMatch(/^target:[a-f0-9]{56}$/);
  });

  it("preserves non-equivalent same-name controls and destinations", () => {
    const candidates = [
      { ref: "one", role: "button", name: "Open", type: "button", nearbyText: "First" },
      { ref: "two", role: "button", name: "Open", type: "button", nearbyText: "Second" },
      {
        ref: "three",
        role: "link",
        name: "Open",
        type: "a",
        nearbyText: "First",
        href: "/one",
      },
      {
        ref: "four",
        role: "link",
        name: "Open",
        type: "a",
        nearbyText: "First",
        href: "/two",
      },
      {
        ref: "header",
        role: "link",
        name: "Account",
        type: "a",
        nearbyText: "Header account shortcut",
        href: "/account",
      },
      {
        ref: "danger",
        role: "link",
        name: "Account",
        type: "a",
        nearbyText: "Danger-zone account action",
        href: "/account",
      },
    ];
    const groups = semantic.buildLogicalCandidates({ ...observation, candidates });
    expect(groups).toHaveLength(6);
    expect(
      groups.map((group) =>
        group.concreteCandidates.map((candidate: Record<string, any>) => candidate.id),
      ),
    ).toEqual([["one"], ["two"], ["three"], ["four"], ["header"], ["danger"]]);
  });

  it("canonicalizes only duplicate direct navigation actions and preserves authorized clicks", () => {
    const candidates = [
      { ref: "image", role: "link", name: "", type: "a", href: "/item/4" },
      {
        ref: "title",
        role: "link",
        name: "Backpack",
        type: "a",
        href: "/item/4",
      },
      {
        ref: "mutate",
        role: "link",
        name: "Add Backpack",
        type: "a",
        href: "/item/4",
      },
    ];
    const readonly = semantic.buildActions({ ...observation, candidates }, {}, false);
    expect(readonly.filter((action) => action.kind === "navigate")).toEqual([
      expect.objectContaining({ concreteRef: "title", url: "https://example.test/item/4" }),
    ]);
    const writable = semantic.buildActions({ ...observation, candidates }, {}, true);
    expect(writable.filter((action) => action.kind === "navigate")).toHaveLength(1);
    expect(writable).toContainEqual(expect.objectContaining({ kind: "click", ref: "image" }));
    expect(writable).toContainEqual(expect.objectContaining({ kind: "click", ref: "title" }));
    expect(writable).toContainEqual(expect.objectContaining({ kind: "click", ref: "mutate" }));
  });

  it("omits exact self-navigation while preserving distinct paths, queries, fragments, and clicks", () => {
    const candidates = [
      { ref: "self", role: "link", name: "Current", type: "a", href: "/settings" },
      { ref: "path", role: "link", name: "Profile", type: "a", href: "/profile" },
      { ref: "query", role: "link", name: "Filtered", type: "a", href: "/settings?view=all" },
      { ref: "fragment", role: "link", name: "Details", type: "a", href: "/settings#details" },
    ];
    const readonly = semantic.buildActions({ ...observation, candidates }, {}, false);
    expect(readonly.filter((action) => action.kind === "navigate").map((action) => action.url)).toEqual([
      "https://example.test/profile",
      "https://example.test/settings?view=all",
      "https://example.test/settings#details",
    ]);
    const writable = semantic.buildActions({ ...observation, candidates }, {}, true);
    expect(writable).toContainEqual(expect.objectContaining({ kind: "click", ref: "self" }));
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
      return tool === "page.read"
        ? response({ semanticObservation: observation })
        : actionResponse("OK");
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
    expect(result.trace).toEqual([
      expect.objectContaining({ kind: "fill", appliedThreshold: 0.65, result: "executed" }),
    ]);
    expect(requests.filter((item) => item.tool === "form.fill")).toHaveLength(1);
    expect(requests.filter((item) => item.tool === "page.read")).toHaveLength(7);
    expect(requests.filter((item) => item.tool === "wait")).toHaveLength(5);
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

  it("settles past an early delta and target disappearance to delayed cart evidence", async () => {
    const earlyDelta = {
      ...observation,
      page: { ...observation.page, title: "Adding item" },
      candidates: observation.candidates.filter((candidate) => candidate.ref !== "e2"),
    };
    const hydrated = {
      ...observation,
      chunks: [{ id: "cart", text: "My cart (1) Alpha jacket size M", refs: ["e2"] }],
    };
    const observations = [observation, observation, earlyDelta, earlyDelta, earlyDelta, hydrated, hydrated];
    let reads = 0;
    let writes = 0;
    const waitDurations: number[] = [];
    let verifications = 0;
    let verificationState: Record<string, any> | undefined;
    const options = semantic.parseSemanticArgs([
      "semantic.act",
      "one Alpha jacket is in the cart",
      "--allow-write",
      "--threshold",
      "write=0.85",
      "--max-steps",
      "1",
    ]);
    if (!options) throw new Error("expected semantic options");
    const result = await semantic.runBrowserSemantic(
      options,
      {
        request: async (tool: string, args: Record<string, any>) => {
          if (tool === "page.read") {
            const current = observations[Math.min(reads++, observations.length - 1)];
            return response({ semanticObservation: current });
          }
          if (tool === "click") {
            writes++;
          }
          if (tool === "wait") {
            waitDurations.push(args.duration);
          }
          return actionResponse("OK");
        },
        evaluate: async (state: Record<string, any>, questions: Record<string, any>) => {
          if (questions.action) {
            return provider({ action: choice("click:e2", Object.keys(questions.action.criteria), 0.85) });
          }
          verifications++;
          verificationState = state;
          return provider({
            verdict: choice("satisfied", ["satisfied", "not_satisfied"]),
            evidence: choice("cart", Object.keys(questions.evidence.criteria)),
          });
        },
        now: () => 0,
      },
    );

    expect(result).toMatchObject({
      status: "complete",
      stopReason: "complete",
      trace: [expect.objectContaining({ appliedThreshold: 0.85 })],
      verification: expect.objectContaining({ appliedThreshold: 0.85 }),
    });
    expect(verificationState?.chunks).toEqual([
      expect.objectContaining({ id: "cart", text: expect.stringContaining("My cart (1)") }),
    ]);
    expect({ reads, writes, verifications }).toEqual({
      reads: 7,
      writes: 1,
      verifications: 1,
    });
    expect(waitDurations).toEqual([0.5, 1, 2, 4, 2]);
  });

  it("settles delayed checked candidate state before verifying a confirmed write once", async () => {
    const unchecked = {
      ...observation,
      candidates: observation.candidates.map((candidate) =>
        candidate.ref === "e2"
          ? { ...candidate, role: "radio", name: "M", type: "radio", state: { checked: false } }
          : candidate,
      ),
    };
    const checked = {
      ...unchecked,
      candidates: unchecked.candidates.map((candidate) =>
        candidate.ref === "e2" ? { ...candidate, state: { checked: true } } : candidate,
      ),
    };
    let reads = 0;
    let writes = 0;
    let waits = 0;
    let verifications = 0;
    let verificationState: Record<string, any> | undefined;
    const result = await semantic.runBrowserSemantic(
      {
        command: "semantic.act",
        goal: "the option is checked",
        allowWrite: true,
        allowRefs: ["e2"],
        inputs: {},
        maxSteps: 1,
      },
      {
        request: async (tool: string) => {
          if (tool === "page.read") {
            const current = reads++ < 2 ? unchecked : checked;
            return response({ semanticObservation: current });
          }
          if (tool === "click") writes++;
          if (tool === "wait") waits++;
          return actionResponse("OK");
        },
        evaluate: async (state: Record<string, any>, questions: Record<string, any>) => {
          if (questions.action) {
            return provider({ action: choice("click:e2", Object.keys(questions.action.criteria)) });
          }
          verifications++;
          verificationState = state;
          return provider({
            verdict: choice("satisfied", ["satisfied", "not_satisfied"]),
            evidence: choice("c1", Object.keys(questions.evidence.criteria)),
          });
        },
        now: () => 0,
      },
    );

    expect(result).toMatchObject({ status: "complete", stopReason: "complete" });
    expect(verificationState?.candidates).toContainEqual(
      expect.objectContaining({ id: "e2", state: { checked: true } }),
    );
    expect({ reads, writes, waits, verifications }).toEqual({
      reads: 3,
      writes: 1,
      waits: 1,
      verifications: 1,
    });
  });

  it.each([
    ["full URL", { fullUrl: "https://example.test/replaced", documentToken: "doc" }],
    ["document token", { fullUrl: observation.identity.fullUrl, documentToken: "replacement-doc" }],
  ])("does not settle early for a checked transition after a %s change", async (_name, changedIdentity) => {
    const unchecked = {
      ...observation,
      candidates: observation.candidates.map((candidate) =>
        candidate.ref === "e2"
          ? { ...candidate, role: "radio", name: "M", type: "radio", state: { checked: false } }
          : candidate,
      ),
    };
    const replacement = {
      ...unchecked,
      identity: { ...unchecked.identity, ...changedIdentity },
      candidates: unchecked.candidates.map((candidate) =>
        candidate.ref === "e2" ? { ...candidate, state: { checked: true } } : candidate,
      ),
    };
    let reads = 0;
    let waits = 0;
    const result = await semantic.runBrowserSemantic(
      { command: "semantic.act", goal: "M is selected", allowWrite: true, allowRefs: ["e2"], inputs: {}, maxSteps: 1 },
      {
        request: async (tool: string) => {
          if (tool === "page.read") return response({ semanticObservation: reads++ ? replacement : unchecked });
          if (tool === "wait") waits++;
          return actionResponse("OK");
        },
        evaluate: async (_state: unknown, questions: Record<string, any>) => {
          if (questions.action) {
            return provider({ action: choice("click:e2", Object.keys(questions.action.criteria)) });
          }
          return provider({
            verdict: choice("satisfied", ["satisfied", "not_satisfied"]),
            evidence: choice("c1", Object.keys(questions.evidence.criteria)),
          });
        },
        now: () => 0,
      },
    );
    expect(result.status).toBe("complete");
    expect({ reads, waits }).toEqual({ reads: 7, waits: 5 });
  });

  it("uses an observed radio transition to preserve budget for a second hydrated write", async () => {
    const radio = {
      ref: "size-m",
      role: "radio",
      name: "M",
      type: "radio",
      state: { checked: false },
    };
    let current: Record<string, any> = { ...observation, candidates: [...observation.candidates, radio] };
    let nowMs = 0;
    let cartWrite = false;
    let actionIndex = 0;
    let verifications = 0;
    let waits = 0;
    const writes: string[] = [];
    const requestedActions = ["click:size-m", "click:e2"];
    const result = await semantic.runBrowserSemantic(
      {
        command: "semantic.act",
        goal: "select M and add the jacket",
        allowWrite: true,
        allowRefs: [],
        inputs: {},
        thresholds: { write: 0.85, verifyNegative: 0.8 },
        maxSteps: 2,
      },
      {
        request: async (tool: string, args: Record<string, any>) => {
          if (tool === "page.read") {
            return response({ semanticObservation: current });
          }
          if (tool === "click") {
            writes.push(args.ref);
            if (args.ref === "size-m") {
              current = {
                ...current,
                candidates: current.candidates.map((candidate: Record<string, any>) =>
                  candidate.ref === "size-m" ? { ...candidate, state: { checked: true } } : candidate,
                ),
              };
            } else {
              cartWrite = true;
            }
          }
          if (tool === "wait") {
            waits++;
            nowMs += args.duration * 1_000;
            if (cartWrite && nowMs >= 9_500) {
              current = { ...current, chunks: [{ id: "cart", text: "Shopping Bag 1 Alpha jacket M", refs: ["e2"] }] };
            }
          }
          return actionResponse("OK");
        },
        evaluate: async (_state: Record<string, any>, questions: Record<string, any>) => {
          if (questions.action) {
            const probability = actionIndex === 0 ? 0.9 : 0.97;
            return provider({
              action: choice(requestedActions[actionIndex++], Object.keys(questions.action.criteria), probability),
            });
          }
          const verification = verifications++;
          const verdict = verification === 0 ? "not_satisfied" : "satisfied";
          const evidence = verification === 0 ? "c1" : "cart";
          return provider({
            verdict: choice(verdict, ["satisfied", "not_satisfied"], 0.9),
            evidence: choice(evidence, Object.keys(questions.evidence.criteria)),
          });
        },
        now: () => nowMs,
      },
    );

    expect(result).toMatchObject({ status: "complete", stopReason: "complete", providerCalls: 4 });
    expect(writes).toEqual(["size-m", "e2"]);
    expect(waits).toBe(5);
    expect(nowMs).toBe(9_500);
    expect(verifications).toBe(2);
    expect(result.trace).toHaveLength(2);
    expect(result.verification).toMatchObject({ status: "satisfied", evidence: { id: "cart" } });
  });

  it("navigates to a product once before selecting a size and adding it", async () => {
    const productUrl = "https://example.test/shop/alpha-jacket";
    const category = {
      ...observation,
      identity: { ...observation.identity, fullUrl: "https://example.test/shop/jackets", documentToken: "category" },
      candidates: [{ ref: "product", role: "link", name: "Alpha Jacket", type: "a", href: productUrl }],
      chunks: [{ id: "category", text: "Jackets Alpha Jacket", refs: ["product"] }],
    };
    const product = {
      ...observation,
      identity: { ...observation.identity, fullUrl: productUrl, documentToken: "product" },
      candidates: [
        { ref: "self", role: "link", name: "Alpha Jacket", type: "a", href: productUrl },
        { ref: "size-m", role: "radio", name: "M", type: "radio", nearbyText: "Select size", state: { checked: false } },
        { ref: "add", role: "button", name: "Add to cart", type: "button", nearbyText: "Alpha Jacket M" },
      ],
      chunks: [{ id: "product", text: "Alpha Jacket Select size Add to cart", refs: ["self", "size-m", "add"] }],
    };
    let current: Record<string, any> = category;
    let nowMs = 0;
    let cartWrite = false;
    let actionIndex = 0;
    let verificationIndex = 0;
    const navigations: string[] = [];
    const writes: string[] = [];
    const requestedActions = ["nav:product", "click:size-m", "click:add"];
    const result = await semantic.runBrowserSemantic(
      {
        command: "semantic.act",
        goal: "open the Alpha Jacket, select M, and add it to the cart",
        allowWrite: true,
        allowRefs: [],
        inputs: {},
        thresholds: { find: 0.6, write: 0.85, verifyNegative: 0.8, verifyPositive: 0.7 },
        maxSteps: 3,
      },
      {
        request: async (tool: string, args: Record<string, any>) => {
          if (tool === "page.read") return response({ semanticObservation: current });
          if (tool === "navigate") {
            navigations.push(args.url);
            current = product;
          }
          if (tool === "click") {
            writes.push(args.ref);
            if (args.ref === "size-m") {
              current = {
                ...current,
                candidates: current.candidates.map((candidate: Record<string, any>) =>
                  candidate.ref === "size-m" ? { ...candidate, state: { checked: true } } : candidate,
                ),
              };
            } else {
              cartWrite = true;
            }
          }
          if (tool === "wait") {
            nowMs += args.duration * 1_000;
            if (cartWrite && nowMs >= 9_500) {
              current = { ...current, chunks: [{ id: "cart", text: "Shopping Bag 1 Alpha Jacket M", refs: ["add"] }] };
            }
          }
          return actionResponse("OK");
        },
        evaluate: async (_state: Record<string, any>, questions: Record<string, any>) => {
          if (questions.action) {
            const requested = requestedActions[actionIndex++];
            expect(Object.keys(questions.action.criteria)).toContain(requested);
            if (actionIndex === 2) expect(Object.keys(questions.action.criteria)).not.toContain("nav:self");
            return provider({ action: choice(requested, Object.keys(questions.action.criteria), 0.9) });
          }
          const verdict = verificationIndex++ < 2 ? "not_satisfied" : "satisfied";
          return provider({
            verdict: choice(verdict, ["satisfied", "not_satisfied"], 0.9),
            evidence: choice(verdict === "satisfied" ? "cart" : current.chunks[0].id, Object.keys(questions.evidence.criteria)),
          });
        },
        now: () => nowMs,
      },
    );

    expect(result).toMatchObject({ status: "complete", stopReason: "complete", providerCalls: 6 });
    expect(navigations).toEqual([productUrl]);
    expect(writes).toEqual(["size-m", "add"]);
    expect(result.trace.map((entry: Record<string, any>) => entry.kind)).toEqual(["navigate", "click", "click"]);
  });

  it("bounds no-change settling, verifies once, and never replays the write", async () => {
    let reads = 0;
    let writes = 0;
    let waits = 0;
    let verifications = 0;
    const result = await semantic.runBrowserSemantic(
      {
        command: "semantic.act",
        goal: "cart changed",
        allowWrite: true,
        allowRefs: ["e2"],
        inputs: {},
        maxSteps: 3,
      },
      {
        request: async (tool: string) => {
          if (tool === "page.read") {
            reads++;
            return response({ semanticObservation: observation });
          }
          if (tool === "click") writes++;
          if (tool === "wait") waits++;
          return actionResponse("OK");
        },
        evaluate: async (_state: unknown, questions: Record<string, any>) => {
          if (questions.action) {
            const labels = Object.keys(questions.action.criteria);
            return provider({ action: choice(labels.includes("click:e2") ? "click:e2" : "stop", labels) });
          }
          verifications++;
          return provider({
            verdict: choice("satisfied", ["satisfied", "not_satisfied"], 0.5),
            evidence: choice("c1", Object.keys(questions.evidence.criteria)),
          });
        },
        now: () => 0,
      },
    );

    expect(result).toMatchObject({ status: "stopped", stopReason: "uncertain" });
    expect({ reads, writes, waits, verifications }).toEqual({
      reads: 7,
      writes: 1,
      waits: 5,
      verifications: 1,
    });
  });

  it.each([
    ["malformed read", () => actionResponse("not-json")],
    [
      "identity-mismatched read",
      () =>
        response({
          semanticObservation: {
            ...observation,
            identity: { ...observation.identity, tabId: 99 },
          },
        }),
    ],
  ])("stops outcome_unknown on a post-write %s without verification or replay", async (_name, postWriteResponse) => {
    let reads = 0;
    let writes = 0;
    let verifications = 0;
    const result = await semantic.runBrowserSemantic(
      { command: "semantic.act", goal: "saved", allowWrite: true, allowRefs: ["e2"], inputs: {}, maxSteps: 2 },
      {
        request: async (tool: string) => {
          if (tool === "page.read") return reads++ ? postWriteResponse() : response({ semanticObservation: observation });
          if (tool === "click") writes++;
          return actionResponse("OK");
        },
        evaluate: async (_state: unknown, questions: Record<string, any>) => {
          if (!questions.action) verifications++;
          return provider({ action: choice("click:e2", Object.keys(questions.action.criteria)) });
        },
        now: () => 0,
      },
    );

    expect(result).toMatchObject({ status: "stopped", stopReason: "outcome_unknown" });
    expect({ reads, writes, verifications }).toEqual({ reads: 2, writes: 1, verifications: 0 });
  });

  it("never reoffers or replays a write when verification is not satisfied", async () => {
    let mutations = 0;
    const request = async (tool: string) => {
      if (tool === "page.read") {
        return response({ semanticObservation: observation });
      }
      if (tool === "click") {
        mutations++;
      }
      return actionResponse("OK");
    };
    const evaluate = async (_state: unknown, questions: Record<string, any>) => {
      if (questions.action) {
        const labels = Object.keys(questions.action.criteria);
        return provider({
          action: choice(labels.includes("click:e2") ? "click:e2" : "stop", labels),
        });
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
    expect(result).toMatchObject({ status: "stopped", stopReason: "uncertain" });
    expect(mutations).toBe(1);
    expect(result.trace).toHaveLength(1);
  });

  it("retains trace and suppresses the same write after its ref changes", async () => {
    const original = { ...observation.candidates[1], ref: "add-old", name: "Add to cart" };
    const rerendered = { ...original, ref: "add-new" };
    let current = { ...observation, candidates: [original] };
    let writes = 0;
    let actionCalls = 0;
    let offeredAfterWrite: string[] = [];
    const result = await semantic.runBrowserSemantic(
      { command: "semantic.act", goal: "add once", allowWrite: true, inputs: {}, maxSteps: 3 },
      {
        request: async (tool: string) => {
          if (tool === "page.read") return response({ semanticObservation: current });
          if (tool === "click") {
            writes++;
            current = { ...current, candidates: [rerendered] };
          }
          return actionResponse("OK");
        },
        evaluate: async (_state: unknown, questions: Record<string, any>) => {
          if (questions.action) {
            const labels = Object.keys(questions.action.criteria);
            if (actionCalls++ === 0) return provider({ action: choice("click:add-old", labels) });
            offeredAfterWrite = labels;
            return invalidProviderChoice("action", labels);
          }
          return provider({
            verdict: choice("not_satisfied", ["satisfied", "not_satisfied"]),
            evidence: choice("c1", Object.keys(questions.evidence.criteria)),
          });
        },
        now: () => 0,
      },
    );

    expect(result).toMatchObject({
      status: "stopped",
      stopReason: "decision_failed",
      errorCode: "provider_invalid_response",
      providerCalls: 3,
      trace: [expect.objectContaining({ ref: "add-old", result: "executed" })],
    });
    expect(offeredAfterWrite).not.toContain("click:add-new");
    expect(writes).toBe(1);
  });

  it("keeps a distinct same-name control eligible when spent context remains unambiguous", async () => {
    const alpha = { ...observation.candidates[1], ref: "alpha", name: "Add to cart", nearbyText: "Alpha product" };
    const beta = { ...alpha, ref: "beta", nearbyText: "Beta product" };
    const current = { ...observation, candidates: [alpha, beta] };
    let actionCalls = 0;
    let writes = 0;
    let secondMenu: string[] = [];
    const result = await semantic.runBrowserSemantic(
      { command: "semantic.act", goal: "add Alpha then Beta", allowWrite: true, inputs: {}, maxSteps: 2 },
      {
        request: async (tool: string) => {
          if (tool === "page.read") return response({ semanticObservation: current });
          if (tool === "click") writes++;
          return actionResponse("OK");
        },
        evaluate: async (_state: unknown, questions: Record<string, any>) => {
          if (questions.action) {
            const labels = Object.keys(questions.action.criteria);
            if (actionCalls++ === 0) return provider({ action: choice("click:alpha", labels) });
            secondMenu = labels;
            return provider({ action: choice("stop", labels) });
          }
          return provider({
            verdict: choice("not_satisfied", ["satisfied", "not_satisfied"]),
            evidence: choice("c1", Object.keys(questions.evidence.criteria)),
          });
        },
        now: () => 0,
      },
    );
    expect(result).toMatchObject({ status: "stopped", stopReason: "uncertain" });
    expect(secondMenu).not.toContain("click:alpha");
    expect(secondMenu).toContain("click:beta");
    expect(writes).toBe(1);
  });

  it.each(["disappeared", "changed"])(
    "suppresses an ambiguous same-name group when spent context has %s",
    async (mode) => {
      const alpha = { ...observation.candidates[1], ref: "alpha", name: "Add to cart", nearbyText: "Alpha product" };
      const beta = { ...alpha, ref: "beta", nearbyText: "Beta product" };
      let current = { ...observation, candidates: [alpha, beta] };
      let actionCalls = 0;
      let writes = 0;
      let secondMenu: string[] = [];
      const result = await semantic.runBrowserSemantic(
        { command: "semantic.act", goal: "add safely", allowWrite: true, inputs: {}, maxSteps: 2 },
        {
          request: async (tool: string) => {
            if (tool === "page.read") return response({ semanticObservation: current });
            if (tool === "click") {
              writes++;
              current = {
                ...current,
                candidates: mode === "disappeared"
                  ? [beta]
                  : [{ ...alpha, ref: "alpha-new", nearbyText: "Changed product" }, beta],
              };
            }
            return actionResponse("OK");
          },
          evaluate: async (_state: unknown, questions: Record<string, any>) => {
            if (questions.action) {
              const labels = Object.keys(questions.action.criteria);
              if (actionCalls++ === 0) return provider({ action: choice("click:alpha", labels) });
              secondMenu = labels;
              return provider({ action: choice("stop", labels) });
            }
            return provider({
              verdict: choice("not_satisfied", ["satisfied", "not_satisfied"]),
              evidence: choice("c1", Object.keys(questions.evidence.criteria)),
            });
          },
          now: () => 0,
        },
      );
      expect(result).toMatchObject({ status: "stopped", stopReason: "uncertain" });
      expect(secondMenu.filter((label) => label.startsWith("click:"))).toEqual([]);
      expect(writes).toBe(1);
    },
  );

  it("returns a structured decision failure before any action", async () => {
    const result = await semantic.runBrowserSemantic(
      { command: "semantic.act", goal: "stop safely", allowWrite: true, inputs: {}, maxSteps: 1 },
      {
        request: async () => response({ semanticObservation: observation }),
        evaluate: async (_state: unknown, questions: Record<string, any>) =>
          invalidProviderChoice("action", Object.keys(questions.action.criteria)),
        now: () => 0,
      },
    );
    expect(result).toEqual({
      status: "stopped",
      stopReason: "decision_failed",
      errorCode: "provider_invalid_response",
      trace: [],
      providerCalls: 1,
    });
  });

  it("allows a same-ref write when its stable name is genuinely different", async () => {
    const add = { ...observation.candidates[1], name: "Add to cart" };
    const remove = { ...add, name: "Remove from cart" };
    let current = { ...observation, candidates: [add] };
    let writes = 0;
    let actionCalls = 0;
    let verifications = 0;
    let secondMenu: string[] = [];
    const result = await semantic.runBrowserSemantic(
      { command: "semantic.act", goal: "change cart twice", allowWrite: true, inputs: {}, maxSteps: 2 },
      {
        request: async (tool: string) => {
          if (tool === "page.read") return response({ semanticObservation: current });
          if (tool === "click") {
            writes++;
            current = { ...current, candidates: [remove] };
          }
          return actionResponse("OK");
        },
        evaluate: async (_state: unknown, questions: Record<string, any>) => {
          if (questions.action) {
            const labels = Object.keys(questions.action.criteria);
            if (actionCalls++ > 0) secondMenu = labels;
            return provider({ action: choice("click:e2", labels) });
          }
          const verdict = verifications++ ? "satisfied" : "not_satisfied";
          return provider({
            verdict: choice(verdict, ["satisfied", "not_satisfied"]),
            evidence: choice("c1", Object.keys(questions.evidence.criteria)),
          });
        },
        now: () => 0,
      },
    );
    expect(result.status).toBe("complete");
    expect(secondMenu).toContain("click:e2");
    expect(writes).toBe(2);
  });

  it("completes a login-like goal with three distinct writes", async () => {
    const loginObservation = {
      ...observation,
      candidates: [
        { ref: "user", role: "textbox", name: "Username", type: "text" },
        { ref: "pass", role: "textbox", name: "Password", type: "password" },
        { ref: "login", role: "button", name: "Login", type: "submit" },
      ],
    };
    const offered: string[][] = [];
    const mutations: string[] = [];
    let actionIndex = 0;
    let verificationIndex = 0;
    const requestedActions = ["fill:user:username", "fill:pass:password", "click:login"];
    const result = await semantic.runBrowserSemantic(
      {
        command: "semantic.act",
        goal: "logged in",
        allowWrite: true,
        inputs: { username: "local-user", password: "local-password" },
        maxSteps: 3,
      },
      {
        request: async (tool: string, args: Record<string, any>) => {
          if (tool === "page.read") {
            return response({ semanticObservation: loginObservation });
          }
          if (tool === "form.fill") mutations.push(`fill:${args.data[0].ref}`);
          if (tool === "click") mutations.push(`click:${args.ref}`);
          return actionResponse("OK");
        },
        evaluate: async (_state: unknown, questions: Record<string, any>) => {
          if (questions.action) {
            const labels = Object.keys(questions.action.criteria);
            offered.push(labels);
            return provider({ action: choice(requestedActions[actionIndex++], labels) });
          }
          const verdict = verificationIndex++ === 2 ? "satisfied" : "not_satisfied";
          return provider({
            verdict: choice(verdict, ["satisfied", "not_satisfied"]),
            evidence: choice("c1", Object.keys(questions.evidence.criteria)),
          });
        },
        now: () => 0,
      },
    );

    expect(result).toMatchObject({ status: "complete", stopReason: "complete" });
    expect(mutations).toEqual(["fill:user", "fill:pass", "click:login"]);
    expect(result.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "fill", appliedThreshold: 0.95 }),
        expect.objectContaining({ kind: "click", appliedThreshold: 0.95 }),
      ]),
    );
    expect(offered[1]).not.toContain("fill:user:username");
    expect(offered[1]).toContain("fill:user:password");
    expect(offered[2]).toContain("fill:pass:username");
    expect(offered[2]).not.toContain("fill:pass:password");
  });

  it("allows the same ref for a different logical write on a different full URL", async () => {
    const first = {
      ...observation,
      candidates: [{ ref: "e2", role: "button", name: "Continue", type: "button" }],
    };
    const second = {
      ...first,
      identity: { ...first.identity, fullUrl: "https://example.test/next", documentToken: "next" },
    };
    let reads = 0;
    let writes = 0;
    let verifications = 0;
    const result = await semantic.runBrowserSemantic(
      { command: "semantic.act", goal: "finished", allowWrite: true, inputs: {}, maxSteps: 2 },
      {
        request: async (tool: string) => {
          if (tool === "page.read") {
            return response({ semanticObservation: reads++ ? second : first });
          }
          if (tool === "click") writes++;
          return actionResponse("OK");
        },
        evaluate: async (_state: unknown, questions: Record<string, any>) => {
          if (questions.action) {
            const labels = Object.keys(questions.action.criteria);
            return provider({ action: choice("click:e2", labels) });
          }
          const verdict = verifications++ ? "satisfied" : "not_satisfied";
          return provider({
            verdict: choice(verdict, ["satisfied", "not_satisfied"]),
            evidence: choice("c1", Object.keys(questions.evidence.criteria)),
          });
        },
        now: () => 0,
      },
    );
    expect(result.status).toBe("complete");
    expect(writes).toBe(2);
  });

  it("stops after a provider verification failure without retrying a confirmed write", async () => {
    let writes = 0;
    const result = await semantic.runBrowserSemantic(
      { command: "semantic.act", goal: "saved", allowWrite: true, inputs: {}, maxSteps: 3 },
      {
        request: async (tool: string) => {
          if (tool === "page.read") {
            return response({ semanticObservation: observation });
          }
          if (tool === "click") writes++;
          return actionResponse("OK");
        },
        evaluate: async (_state: unknown, questions: Record<string, any>) => {
          if (!questions.action) {
            throw new Error("provider disconnected");
          }
          return provider({ action: choice("click:e2", Object.keys(questions.action.criteria)) });
        },
        now: () => 0,
      },
    );
    expect(result).toMatchObject({ status: "stopped", stopReason: "verification_failed" });
    expect(writes).toBe(1);
  });

  it("stops on a resolved host-serialized write failure without spending or retrying it", async () => {
    let attempts = 0;
    let reads = 0;
    const result = await semantic.runBrowserSemantic(
      { command: "semantic.act", goal: "saved", allowWrite: true, inputs: {}, maxSteps: 3 },
      {
        request: async (tool: string) => {
          if (tool === "page.read") {
            reads++;
            return response({ semanticObservation: observation });
          }
          attempts++;
          return actionResponse(
            JSON.stringify({
              success: false,
              error: "Element is not fillable",
              code: "fill_failed",
            }),
          );
        },
        evaluate: async (_state: unknown, questions: Record<string, any>) =>
          provider({ action: choice("click:e2", Object.keys(questions.action.criteria)) }),
        now: () => 0,
      },
    );
    expect(result).toMatchObject({ status: "stopped", stopReason: "action_failed" });
    expect(attempts).toBe(1);
    expect(reads).toBe(1);
  });

  it.each([
    ["missing success", { filled: 1, failed: 0, results: [{ ref: "e1", success: true }] }],
    ["malformed text", "not-json-or-a-success-marker"],
  ])("stops on a resolved host-serialized %s action outcome", async (_name, outcome) => {
    let attempts = 0;
    let verificationCalls = 0;
    const result = await semantic.runBrowserSemantic(
      { command: "semantic.act", goal: "saved", allowWrite: true, inputs: {}, maxSteps: 3 },
      {
        request: async (tool: string) => {
          if (tool === "page.read") {
            return response({ semanticObservation: observation });
          }
          attempts++;
          return actionResponse(typeof outcome === "string" ? outcome : JSON.stringify(outcome));
        },
        evaluate: async (_state: unknown, questions: Record<string, any>) => {
          if (!questions.action) {
            verificationCalls++;
          }
          return provider({ action: choice("click:e2", Object.keys(questions.action.criteria)) });
        },
        now: () => 0,
      },
    );
    expect(result).toMatchObject({ status: "stopped", stopReason: "outcome_unknown" });
    expect(attempts).toBe(1);
    expect(verificationCalls).toBe(0);
  });

  it("refreshes a stale pre-execution identity with zero mutation", async () => {
    let reads = 0;
    let mutationCount = 0;
    let selections = 0;
    const withoutField = {
      ...observation,
      candidates: observation.candidates.filter((item) => item.ref !== "e1"),
    };
    const result = await semantic.runBrowserSemantic(
      {
        command: "semantic.act",
        goal: "saved",
        allowWrite: true,
        inputs: { email: "local-only" },
        maxSteps: 2,
      },
      {
        request: async (tool: string) => {
          if (tool === "page.read") {
            return response({ semanticObservation: reads++ ? withoutField : observation });
          }
          if (tool !== "form.fill") {
            mutationCount++;
          }
          return actionResponse(
            JSON.stringify({
              success: false,
              error: "stale_observation",
              code: "stale_observation",
              filled: 0,
              failed: 1,
              results: [],
            }),
          );
        },
        evaluate: async (_state: unknown, questions: Record<string, any>) => {
          const labels = Object.keys(questions.action.criteria);
          return provider({ action: choice(selections++ ? "stop" : "fill:e1:email", labels) });
        },
        now: () => 0,
      },
    );
    expect(result.status).toBe("stopped");
    expect(result.trace).toEqual([expect.objectContaining({ kind: "fill", result: "stale" })]);
    expect(mutationCount).toBe(0);
    expect(reads).toBe(2);
  });

  it("reserves fixed actions and every narrowed ref at the 64-candidate boundary", () => {
    const candidates = Array.from({ length: 64 }, (_, index) => ({
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
    expect(actions).toHaveLength(SEMANTIC_POLICY.limits.actionChoices);
    expect(actions.length).toBeLessThanOrEqual(SEMANTIC_POLICY.limits.actionChoices);
    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "scroll:down_600" }),
        expect.objectContaining({ id: "scroll:up_600" }),
        expect.objectContaining({ id: "scroll:top" }),
        expect.objectContaining({ id: "scroll:bottom" }),
        expect.objectContaining({ id: "wait:500" }),
        expect.objectContaining({ id: "wait:1500" }),
        expect.objectContaining({ id: "fill:e1:slot0" }),
        expect.objectContaining({ id: "fill:e64:slot0" }),
      ]),
    );
    expect(
      candidates.every((candidate) =>
        actions.some(
          (action) =>
            action.ref === candidate.ref && (action.kind === "click" || action.kind === "fill"),
        ),
      ),
    ).toBe(true);
  });

  it("keeps all fixed and deduplicated navigation actions at the read-only 64-link boundary", () => {
    const actions = semantic.buildActions(
      { ...observation, candidates: linkCandidates() },
      {},
      false,
    );
    expect(actions).toHaveLength(SEMANTIC_POLICY.limits.actionChoices);
    expect(actions.filter((action) => action.kind === "navigate")).toHaveLength(64);
    expect(actions.some((action) => action.kind === "click" || action.kind === "fill")).toBe(false);
    expect(actions.slice(0, 6).map((action) => action.id)).toEqual([
      "scroll:down_600",
      "scroll:up_600",
      "scroll:top",
      "scroll:bottom",
      "wait:500",
      "wait:1500",
    ]);
  });

  it("fairly bounds broad navigation and click variants at the 64-link boundary", () => {
    const actions = semantic.buildActions(
      { ...observation, candidates: linkCandidates() },
      {},
      true,
    );
    expect(actions).toHaveLength(SEMANTIC_POLICY.limits.actionChoices);
    expect(actions.filter((action) => action.kind === "navigate")).toHaveLength(32);
    expect(actions.filter((action) => action.kind === "click")).toHaveLength(32);
    expect(
      actions.slice(0, 6).every((action) => action.kind === "scroll" || action.kind === "wait"),
    ).toBe(true);
  });

  it("prioritizes a late exact allow-ref write before navigation truncation", () => {
    const candidates = linkCandidates();
    const actions = semantic.buildActions({ ...observation, candidates }, {}, true, ["e63"]);
    expect(actions).toHaveLength(SEMANTIC_POLICY.limits.actionChoices);
    expect(actions[6]).toMatchObject({ id: "click:e63", kind: "click", ref: "e63" });
    expect(actions.filter((action) => action.kind === "click")).toEqual([
      expect.objectContaining({ ref: "e63" }),
    ]);
    expect(actions.filter((action) => action.kind === "navigate")).toHaveLength(63);
  });

  it("preserves every mandatory multiple-allow-ref write before bounded navigation", () => {
    const candidates = linkCandidates();
    const allowRefs = ["e2", "e32", "e63", "e64"];
    const actions = semantic.buildActions({ ...observation, candidates }, {}, true, allowRefs);
    expect(actions).toHaveLength(SEMANTIC_POLICY.limits.actionChoices);
    expect(actions.slice(6, 10).map((action) => action.ref)).toEqual(allowRefs);
    expect(actions.filter((action) => action.kind === "click").map((action) => action.ref)).toEqual(
      allowRefs,
    );
    expect(actions.filter((action) => action.kind === "navigate")).toHaveLength(60);
  });

  it("fairly reserves broad navigation, click, and fill classes", () => {
    const candidates = [
      ...linkCandidates(32),
      ...Array.from({ length: 16 }, (_, index) => ({
        ref: `b${index + 1}`,
        role: "button",
        name: `Button ${index + 1}`,
        type: "button",
      })),
      ...Array.from({ length: 16 }, (_, index) => ({
        ref: `f${index + 1}`,
        role: "textbox",
        name: `Field ${index + 1}`,
        type: "text",
      })),
    ];
    const actions = semantic.buildActions(
      { ...observation, candidates },
      { value: "local-only" },
      true,
    );
    expect(actions).toHaveLength(SEMANTIC_POLICY.limits.actionChoices);
    for (const kind of ["navigate", "click", "fill"]) {
      expect(actions.filter((action) => action.kind === kind).length).toBeGreaterThan(0);
    }
    expect(actions.some((action) => action.kind === "click" && action.ref.startsWith("b"))).toBe(
      true,
    );
    expect(actions.some((action) => action.kind === "fill" && action.ref.startsWith("f"))).toBe(
      true,
    );
  });

  it("retains exact-ref threshold applicability for a late bounded link click", async () => {
    const candidates = linkCandidates();
    let reads = 0;
    const result = await semantic.runBrowserSemantic(
      {
        command: "semantic.act",
        goal: "opened product 63",
        allowWrite: true,
        allowRefs: ["e63"],
        inputs: {},
        maxSteps: 1,
      },
      {
        request: async (tool: string) => {
          if (tool === "page.read") {
            reads++;
            return response({ semanticObservation: { ...observation, candidates } });
          }
          return actionResponse("OK");
        },
        evaluate: async (_state: unknown, questions: Record<string, any>) => {
          if (questions.action) {
            return provider({
              action: choice("click:e63", Object.keys(questions.action.criteria), 0.65),
            });
          }
          return provider({
            verdict: choice("satisfied", ["satisfied", "not_satisfied"]),
            evidence: choice("c1", Object.keys(questions.evidence.criteria)),
          });
        },
        now: () => 0,
      },
    );
    expect(result).toMatchObject({
      status: "complete",
      trace: [expect.objectContaining({ ref: "e63", appliedThreshold: 0.65 })],
    });
    expect(reads).toBe(7);
  });

  it("fails explicitly before provider selection when mandatory authorized actions exceed the hard bound", async () => {
    const candidates = Array.from({ length: 65 }, (_, index) => ({
      ref: `e${index + 1}`,
      role: "button",
      name: `Button ${index + 1}`,
      type: "button",
      nearbyText: "Actions",
    }));
    const evaluate = vi.fn();
    const result = await semantic.runBrowserSemantic(
      {
        command: "semantic.act",
        goal: "choose an action",
        allowWrite: true,
        allowRefs: candidates.map((candidate) => candidate.ref),
        inputs: {},
        maxSteps: 1,
      },
      {
        request: async () => response({ semanticObservation: { ...observation, candidates } }),
        evaluate,
        now: () => 0,
      },
    );
    expect(result).toMatchObject({
      status: "stopped",
      stopReason: "decision_failed",
      errorCode: "semantic_invalid_request",
      trace: [],
      providerCalls: 0,
    });
    expect(evaluate).not.toHaveBeenCalled();
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
