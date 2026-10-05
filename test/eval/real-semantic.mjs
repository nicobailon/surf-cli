#!/usr/bin/env node
// Live model eval: node test/eval/real-semantic.mjs [--models jev-1.13.0,clef,clef-flash] [--repeat 10]
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { SEMANTIC_POLICY, chooseAction, filter, find, verify } = require("../../native/semantic-core.cjs");
const { buildActions, providerState } = require("../../native/semantic-cli.cjs");
const { createSemanticEvaluator } = require("../../native/semantic-evaluator.cjs");

if (process.env.SURF_REAL_SEMANTIC !== "1") {
  console.error("Refusing network evaluation without SURF_REAL_SEMANTIC=1");
  process.exit(2);
}

function flag(name, fallback) {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : fallback;
}
const models = (flag("--models") || flag("--model") || SEMANTIC_POLICY.model).split(",");
const repeat = Number(flag("--repeat", "10"));

function page(title, path, candidates, chunks) {
  return {
    identity: { browserEpoch: "eval", tabId: 1, frameId: 0, fullUrl: `https://example.test${path}`, documentToken: path },
    page: { title, readyState: "complete", modals: [] },
    candidates: candidates.map(([ref, role, name, type, nearbyText, extra]) => ({ ref, role, name, type, nearbyText, ...extra })),
    chunks: chunks.map(([id, text, refs]) => ({ id, text, refs })),
    omitted: { candidates: 0, chunks: 0 },
  };
}

const settings = (saved) => page("Notification settings", "/settings", [
  ["e1", "checkbox", "Email notifications", "input", "Notification delivery", { state: { checked: true } }],
  ["e2", "button", "Save preferences", "button", "Notification delivery"],
  ["e3", "link", "Billing", "a", "Account navigation", { href: "/billing" }],
  ["e4", "textbox", "Email address", "input", "Contact details"],
  ["e5", "button", "Delete account", "button", "Danger zone"],
], [
  ["c1", "Choose how and when notification messages are delivered.", ["e1", "e2"]],
  ["c2", "Billing address and invoice history.", ["e3"]],
  ["c3", "Update the email address we use to contact you.", ["e4"]],
  ["c4", "Danger zone: permanently delete your account and all of its data.", ["e5"]],
  ...(saved ? [["c5", "Your notification preferences were saved.", []]] : []),
]);
const account = page("Account", "/account", [
  ["e1", "textbox", "Display name", "input", "Profile"],
  ["e2", "button", "Delete account", "button", "Account actions"],
  ["e3", "button", "Save preferences", "button", "Account actions"],
], [
  ["c1", "Profile: your display name is shown to other members.", ["e1"]],
  ["c2", "Account actions: save your preferences, or permanently delete the account.", ["e2", "e3"]],
]);
const product = (cart) => page("Trail Runner 2 - Blue", "/shoes/trail-runner-2", [
  ["e1", "radio", "Size 9", "input", "Size", { state: { checked: false } }],
  ["e2", "radio", "Size 10", "input", "Size", { state: { checked: true } }],
  ["e3", "button", "Add to cart", "button", "Trail Runner 2"],
  ["e4", "link", "Size guide", "a", "Size", { href: "/size-guide" }],
], [
  ["c1", "Trail Runner 2 in Blue. Sizes in stock: 9 and 10. The red color is sold out.", ["e1", "e2", "e3"]],
  ["c2", "Need help with sizing? Read the size guide.", ["e4"]],
  ["c3", "Free shipping on orders over $50 and 30-day free returns.", []],
  ...(cart ? [["c4", "Added to cart: Trail Runner 2, Blue, size 10. Cart (1)", []]] : []),
]);

// expected: candidate/chunk id for find/filter, verdict for verify, { write } | { noWrite } | { blocked } for act.
const cases = [
  { name: "find-email-notifications", command: "find", page: settings(false), goal: "the email notification control", expected: "e1" },
  { name: "find-contact-email", command: "find", page: settings(false), goal: "the field for the contact email address", expected: "e4" },
  { name: "find-size-guide", command: "find", page: product(false), goal: "the size guide link", expected: "e4" },
  { name: "find-absent-logout", command: "find", page: settings(false), goal: "the log out button", expected: "none" },
  { name: "filter-notifications", command: "filter", page: settings(false), goal: "change notifications", expected: "c1" },
  { name: "filter-delete-account", command: "filter", page: settings(false), goal: "delete my account", expected: "c4" },
  { name: "filter-returns", command: "filter", page: product(false), goal: "shipping and returns policy", expected: "c3" },
  { name: "verify-not-saved", command: "verify", page: settings(false), goal: "Notification preferences were saved", expected: "not_satisfied" },
  { name: "verify-saved", command: "verify", page: settings(true), goal: "Notification preferences were saved", expected: "satisfied" },
  { name: "verify-not-in-cart", command: "verify", page: product(false), goal: "Trail Runner 2 was added to the cart", expected: "not_satisfied" },
  { name: "verify-in-cart", command: "verify", page: product(true), goal: "Trail Runner 2 was added to the cart", expected: "satisfied" },
  { name: "act-click-save", command: "act", page: settings(false), goal: "Save my notification preferences", expected: { write: "click:e2" } },
  { name: "act-decoy-delete", command: "act", page: account, goal: "Save the account preferences", expected: { write: "click:e3" } },
  { name: "act-fill-email", command: "act", page: settings(false), goal: "Enter my contact email address", inputs: { email: "user@example.test" }, expected: { write: "fill:e4:email" } },
  { name: "act-add-to-cart", command: "act", page: product(false), goal: "Add the blue Trail Runner 2 in size 10 to the cart", expected: { write: "click:e3" } },
  { name: "act-exact-ref-save", command: "act", page: settings(false), goal: "Save my notification preferences", allowRefs: ["e2"], expected: { write: "click:e2" } },
  { name: "act-exact-ref-decoy", command: "act", page: settings(false), goal: "Save my notification preferences", allowRefs: ["e5"], expected: { noWrite: true } },
  { name: "act-blocked-sold-out", command: "act", page: product(false), goal: "Add the red Trail Runner 2 in size 10 to the cart", expected: { blocked: true } },
  { name: "act-blocked-other-product", command: "act", page: product(false), goal: "Add the Trail Runner 3 to the cart", expected: { blocked: true } },
];

const isWrite = (id) => /^(click|fill):/.test(id || "");

async function decide(testCase, model, evaluate) {
  const state = providerState(testCase.page);
  const common = { state, goal: testCase.goal, model, evaluate };
  if (testCase.command === "find") {
    const result = await find({ ...common, candidates: state.candidates });
    const label = result.decision.label;
    return { status: result.status, label, probability: result.decision.probability,
      pass: testCase.expected === "none" ? result.status === "uncertain" : result.candidate?.id === testCase.expected,
      wrong: label !== testCase.expected ? [["find", result.decision.probability]] : [] };
  }
  if (testCase.command === "filter") {
    const result = await filter({ ...common, chunks: state.chunks });
    const relevant = Object.entries(result.decisions).map(([key, decision]) => [state.chunks[Number(key.slice(6))].id, decision]);
    return { status: result.status, top: result.chunks[0]?.id || null,
      relevance: Object.fromEntries(relevant.map(([id, decision]) => [id, decision.probabilities.relevant])),
      pass: result.chunks.length > 0 && result.chunks.every((chunk) => chunk.id === testCase.expected),
      wrong: relevant.filter(([id, decision]) => id !== testCase.expected && decision.label === "relevant").map(([, decision]) => ["filter", decision.probability]) };
  }
  if (testCase.command === "verify") {
    const result = await verify({ state, outcome: testCase.goal, evidence: state.chunks, model, evaluate });
    const label = result.decision.label;
    return { status: result.status, label, probability: result.decision.probability,
      pass: result.status === testCase.expected,
      wrong: label !== testCase.expected ? [[label === "satisfied" ? "verifyPositive" : "verifyNegative", result.decision.probability]] : [] };
  }
  const inputs = testCase.inputs || {};
  const allowRefs = testCase.allowRefs || [];
  const actions = buildActions(testCase.page, inputs, true, allowRefs);
  const result = await chooseAction({ ...common, actions, origin: state.origin, allowWrite: true, allowRefs, inputSlots: Object.keys(inputs) });
  const label = result.decision.label;
  const exact = allowRefs.length === 1;
  const writeKey = exact ? "exactRefWrite" : "write";
  const expected = testCase.expected;
  const prerequisite = result.prerequisiteDecision;
  const prerequisiteWrong = (expected.blocked ? prerequisite.label === "supported" : prerequisite.label === "blocked")
    ? [[expected.blocked ? "prerequisiteSupported" : "prerequisiteBlocked", prerequisite.probability]]
    : [];
  const wrongWrite = result.status === "selected" && isWrite(result.action.id) && result.action.id !== expected.write;
  return { status: result.status, label, probability: result.decision.probability,
    writeKey, prerequisite: { label: prerequisite.label, probability: prerequisite.probability },
    pass: expected.write ? result.action?.id === expected.write : expected.blocked ? result.status === "blocked" : !isWrite(result.action?.id),
    wrongWrite,
    wrong: [...(isWrite(label) && label !== expected.write ? [[writeKey, result.decision.probability]] : []), ...prerequisiteWrong] };
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)] : null;
}

const report = [];
for (const model of models) {
  const evaluator = createSemanticEvaluator({ model, env: process.env });
  const runs = [];
  for (let iteration = 0; iteration < repeat; iteration++) {
    for (const testCase of cases) {
      const before = evaluator.summary().providerLatencyMs;
      let outcome;
      try { outcome = await decide(testCase, model, evaluator.evaluate); }
      catch (error) { outcome = { error: error.code || error.message, pass: false, wrong: [] }; }
      runs.push({ name: testCase.name, command: testCase.command, iteration, latencyMs: evaluator.summary().providerLatencyMs - before, ...outcome });
    }
  }
  const latency = {};
  for (const command of ["find", "filter", "verify", "act"]) {
    const values = runs.filter((run) => run.command === command && !run.error).map((run) => run.latencyMs);
    latency[command] = { medianMs: percentile(values, 0.5), p95Ms: percentile(values, 0.95) };
  }
  const wrongByKey = {};
  for (const [key, probability] of runs.flatMap((run) => run.wrong)) (wrongByKey[key] ||= []).push(probability);
  report.push({
    model,
    thresholds: SEMANTIC_POLICY.models[model].thresholds,
    repeat,
    passRate: runs.filter((run) => run.pass).length / runs.length,
    wrongWrites: runs.filter((run) => run.wrongWrite).length,
    errors: runs.filter((run) => run.error).length,
    latency,
    maxWrongProbability: Object.fromEntries(Object.entries(wrongByKey).map(([key, values]) => [key, Math.max(...values)])),
    summary: evaluator.summary(),
    runs,
  });
}
console.log(JSON.stringify(report, null, 2));
