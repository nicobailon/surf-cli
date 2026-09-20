#!/usr/bin/env node
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const { find, verify, filter } = require("../../native/semantic-core.cjs");
const { createJevEvaluator } = require("../../native/semantic-provider.cjs");

if (process.env.SURF_REAL_JEV !== "1") {
  console.error("Refusing network evaluation without SURF_REAL_JEV=1");
  process.exit(2);
}
if (!process.env.TYPESAFE_API_KEY?.trim()) {
  console.error("TYPESAFE_API_KEY is required");
  process.exit(2);
}

const state = {
  origin: "https://example.test",
  title: "Notification settings",
  readyState: "complete",
  modals: [],
  candidates: [
    { id: "e1", role: "checkbox", name: "Email notifications", type: "input", text: "Notification delivery" },
    { id: "e2", role: "button", name: "Save preferences", type: "button", text: "Notification delivery" },
    { id: "e3", role: "link", name: "Billing", type: "a", text: "Account navigation" },
  ],
  chunks: [
    { id: "c1", text: "Choose how and when notification messages are delivered." },
    { id: "c2", text: "Billing address and invoice history." },
  ],
};
const evaluate = createJevEvaluator({ apiKey: process.env.TYPESAFE_API_KEY });
const cases = [
  ["find-notification", () => find({ state, goal: "the email notification control", candidates: state.candidates, evaluate }), "e1"],
  ["filter-notification", () => filter({ state, goal: "change notifications", chunks: state.chunks, evaluate }), "c1"],
  ["verify-not-saved", () => verify({ state, outcome: "preferences were saved", evidence: state.chunks, evaluate }), "not_satisfied"],
];
const results = [];
for (const [name, run, expected] of cases) {
  const started = performance.now();
  const value = await run();
  const selected = value.candidate?.id || value.chunks?.[0]?.id || value.status;
  results.push({ name, expected, selected, correct: selected === expected, latencyMs: Math.round(performance.now() - started), model: value.model, usage: value.usage });
}
const usage = results.reduce((sum, item) => sum + (item.usage?.input_tokens || 0) + (item.usage?.output_tokens || 0), 0);
console.log(JSON.stringify({ cases: results, wrongTargetRate: results.filter((item) => !item.correct).length / results.length, totalTokens: usage, estimatedCost: null, note: "Set cost externally for the returned model; this harness does not assume provider pricing." }, null, 2));
