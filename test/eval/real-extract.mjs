#!/usr/bin/env node
// Live extraction eval: node test/eval/real-extract.mjs [--model clairic] [--repeat 10]
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { EXTRACTION_FIELD_TYPES, SEMANTIC_POLICY, extract } = require("../../native/semantic-core.cjs");
const { providerState } = require("../../native/semantic-cli.cjs");
const { createExtractionEvaluator } = require("../../native/semantic-evaluator.cjs");

if (process.env.SURF_REAL_SEMANTIC !== "1") {
  console.error("Refusing network evaluation without SURF_REAL_SEMANTIC=1");
  process.exit(2);
}

function flag(name, fallback) {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : fallback;
}
const model = flag("--model", SEMANTIC_POLICY.defaultExtractionModel);
const repeat = Number(flag("--repeat", "10"));
const referenceDate = "2026-10-23";

function page(title, path, candidates, chunks) {
  return {
    identity: { browserEpoch: "eval", tabId: 1, frameId: 0, fullUrl: `https://example.test${path}`, documentToken: path },
    page: { title, readyState: "complete", modals: [] },
    candidates: candidates.map(([ref, role, name, type, nearbyText, extra]) => ({ ref, role, name, type, nearbyText, ...extra })),
    chunks: chunks.map(([id, text, refs]) => ({ id, text, refs })),
    omitted: { candidates: 0, chunks: 0 },
  };
}

// field: [name, type, instructions, expected, expectedSource?]; expectedSource is { chunk } or { ref }.
const filler = (index) => [`f${index}`, `Section ${index}. Our team reviews every request carefully and answers within a few business days. Please keep your account details private and never share your password with anyone who contacts you. You can change your communication preferences at any time from the settings page, and you can download a copy of your data whenever you like. Thank you for being a valued member of our community.`, []];
const largeChunks = Array.from({ length: 46 }, (_, index) => filler(index + 1));
largeChunks.splice(23, 0, ["c-order", "Order Z-5521 is confirmed. Order total $318.40, charged to your card on file.", []]);

const cases = [
  {
    name: "order-summary",
    page: page("Order details", "/orders/A-88412", [["e1", "link", "Track package", "a", "Shipping"], ["e2", "button", "Return items", "button", "Order"]], [
      ["c1", "Order A-88412 placed Oct 20, 2026", []],
      ["c2", "Subtotal $649.00 · Tax $52.10 · Total $701.10", []],
      ["c3", "Arriving Oct 27. Carrier: UPS", ["e1"]],
    ]),
    fields: [
      ["order_id", "text", "Order number", "A-88412", { chunk: "c1" }],
      ["total", "number", "Order total including tax", 701.1],
      ["tax", "number", "Sales tax", 52.1],
      ["delivery", "date", "Expected delivery date", "2026-10-27"],
      ["carrier", "text", "Shipping carrier", "UPS", { chunk: "c3" }],
    ],
  },
  {
    name: "invoice",
    page: page("Invoice INV-2291", "/invoices/2291", [["e1", "button", "Pay invoice", "button", "Invoice"]], [
      ["c1", "Invoice INV-2291 from Northwind Supply", []],
      ["c2", "Issued Sept 2, 2026 · Terms: net 30", []],
      ["c3", "Amount due: $1,080.00", ["e1"]],
    ]),
    fields: [
      ["invoice_number", "text", "Invoice number", "INV-2291", { chunk: "c1" }],
      ["due_date", "date", "Due date: the issue date plus the net payment days", "2026-10-02"],
      ["amount_due", "number", "Amount due", 1080],
    ],
  },
  {
    name: "absent-fields",
    page: page("Account settings", "/settings", [["e1", "button", "Save changes", "button", "Profile"]], [
      ["c1", "Update your profile name and photo.", ["e1"]],
      ["c2", "Email notifications are on.", []],
    ]),
    fields: [
      ["coupon", "text", "Coupon code", null],
      ["tracking", "text", "Package tracking number", null],
      ["gift_message", "text", "Gift message", null],
    ],
  },
  {
    name: "button-only-value",
    page: page("Checkout", "/checkout", [["e1", "button", "Pay $42.10", "button", "Payment"], ["e2", "link", "Edit cart", "a", "Cart"]], [
      ["c1", "Review your order and pay securely.", []],
    ]),
    fields: [
      ["pay_label_amount", "text", "The amount shown on the payment button", "$42.10", { ref: "e1" }],
      ["amount", "number", "Amount to pay", 42.1],
    ],
  },
  {
    name: "booking",
    page: page("Your trip", "/trips/ua1234", [["e1", "button", "Check in", "button", "Flight"]], [
      ["c1", "Flight UA 1234 · San Francisco to Denver", []],
      ["c2", "Departs Nov 3, 2026 at 8:15 AM · Duration 2h 35m · Gate B22", ["e1"]],
    ]),
    fields: [
      ["departure", "datetime", "Departure date and time", "2026-11-03T08:15"],
      ["duration", "duration.minutes", "Flight duration", 155],
      ["gate", "text", "Departure gate", "B22", { chunk: "c2" }],
    ],
  },
  {
    name: "distractor-dates",
    page: page("Order history", "/orders/1001", [], [
      ["c1", "Ordered on Oct 1, 2026", []],
      ["c2", "Shipped on Oct 3, 2026", []],
      ["c3", "Delivered on Oct 6, 2026", []],
    ]),
    fields: [
      ["order_date", "date", "Date the order was placed", "2026-10-01"],
      ["ship_date", "date", "Date the order shipped", "2026-10-03"],
      ["delivery_date", "date", "Date the order was delivered", "2026-10-06"],
    ],
  },
  {
    name: "european-price",
    page: page("Kaffeevollautomat XR-5", "/de/xr-5", [["e1", "button", "In den Warenkorb", "button", "Produkt"]], [
      ["c1", "Kaffeevollautomat XR-5", []],
      ["c2", "Preis: €1.299,00 inkl. MwSt.", ["e1"]],
    ]),
    fields: [["price", "number", "Product price in euros", 1299]],
  },
  {
    name: "relative-date",
    page: page("Package status", "/packages/7781", [], [["c1", "Delivered yesterday at 2:14 PM", []]]),
    fields: [["delivered", "date", "Delivery date", "2026-10-22"]],
  },
  {
    name: "integer-count",
    page: page("Cart", "/cart", [["e1", "button", "Checkout", "button", "Cart"]], [
      ["c1", "3 items in your cart", ["e1"]],
      ["c2", "Subtotal $87.50", []],
    ]),
    fields: [["item_count", "integer", "Number of items in the cart", 3]],
  },
  {
    name: "emoji-before-value",
    page: page("Thank you", "/confirmation", [], [
      ["c1", "🎉 Order #B-1001 confirmed", []],
      ["c2", "We sent a receipt to your email.", []],
    ]),
    fields: [["order_number", "text", "Order number, without the # sign", "B-1001", { chunk: "c1" }]],
  },
  {
    name: "closing-time",
    page: page("Downtown store", "/stores/downtown", [], [
      ["c1", "Store hours today: opens at 9 AM", []],
      ["c2", "Store closes at 9 PM", []],
    ]),
    fields: [["closing_time", "time", "Time the store closes today", "21:00"]],
  },
  {
    name: "product-price-distractors",
    page: page("Trail Runner 2", "/shoes/trail-runner-2", [["e1", "button", "Add to cart", "button", "Trail Runner 2"]], [
      ["c1", "Trail Runner 2 — $129.99", ["e1"]],
      ["c2", "Customers also bought:", []],
      ["c3", "Trail Sock 3-pack $14.99", []],
      ["c4", "Hydration Vest $89.00", []],
      ["c5", "Trail Runner 3 $149.99", []],
      ["c6", "Gaiters $24.50", []],
      ["c7", "Insoles $39.95", []],
    ]),
    fields: [["price", "number", "Price of the main product on this page, Trail Runner 2", 129.99]],
  },
  {
    name: "cart-lists",
    page: page("Your cart", "/cart", [["e1", "button", "Checkout", "button", "Cart"]], [
      ["c1", "Your cart", []],
      ["c2", "Trail Runner 2 — $129.99", []],
      ["c3", "Hydration Vest — $89.00", []],
      ["c4", "Trail Sock 3-pack — $14.99", []],
      ["c5", "Upcoming deliveries: Oct 27, 2026; Nov 2, 2026", []],
    ]),
    fields: [
      ["items", "list", "Names of the items in the cart, without prices", ["Trail Runner 2", "Hydration Vest", "Trail Sock 3-pack"]],
      ["prices", "list.number", "Prices of the items in the cart", [129.99, 89, 14.99]],
      ["deliveries", "list.date", "Upcoming delivery dates", ["2026-10-27", "2026-11-02"]],
    ],
  },
  {
    name: "large-page",
    large: true,
    page: page("Help center", "/help", [["e1", "link", "Contact support", "a", "Help"]], largeChunks),
    fields: [
      ["order_id", "text", "Order number", "Z-5521", { chunk: "c-order" }],
      ["total", "number", "Order total", 318.4],
    ],
  },
];

function same(type, expected, actual) {
  if (type.startsWith("list")) {
    const itemType = type === "list" ? "text" : type.slice(5);
    return Array.isArray(actual) && actual.length === expected.length && expected.every((item, index) => same(itemType, item, actual[index]));
  }
  if (["number", "integer"].includes(type) || type.startsWith("duration")) return typeof actual === "number" && Math.abs(actual - expected) <= 0.005;
  if (type === "time") return typeof actual === "string" && actual.slice(0, 5) === expected;
  if (type === "datetime") return typeof actual === "string" && actual.slice(0, 16) === expected;
  if (type === "text") return typeof actual === "string" && actual.trim() === expected;
  return actual === expected;
}

function classify(type, expected, result) {
  if (result.status === "extracted") return expected !== null && same(type, expected, result.value) ? "correct" : "wrong-extracted";
  if (expected === null) return "correct-null";
  if (result.guess === undefined || result.guess === null) return "missed";
  return same(type, expected, result.guess) ? "withheld" : "wrong-withheld";
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)] : null;
}

const evaluator = createExtractionEvaluator({ model, env: process.env });
const thresholds = SEMANTIC_POLICY.extractionModels[model].thresholds;
const runs = [];
for (let iteration = 0; iteration < repeat; iteration++) {
  for (const testCase of cases) {
    const state = providerState(testCase.page);
    const fields = testCase.fields.map(([name, type, instructions]) => ({ name, type, spec: { ...EXTRACTION_FIELD_TYPES[type], instructions } }));
    const before = evaluator.summary().providerLatencyMs;
    let result;
    let errorCode;
    try { result = await extract({ state, fields, referenceDate, model, evaluate: evaluator.evaluate }); }
    catch (error) { errorCode = error.code || error.message; }
    const latencyMs = evaluator.summary().providerLatencyMs - before;
    const outcomes = testCase.fields.map(([name, type, , expected, expectedSource]) => {
      if (errorCode) return { field: name, type, expected, outcome: "error", error: errorCode };
      const returned = result.fields[name];
      const clairicValue = returned.status === "extracted" ? returned.value : returned.status === "uncertain" ? returned.guess : null;
      const source = returned.source ?? null;
      return {
        field: name,
        type,
        expected,
        outcome: classify(type, expected, returned),
        status: returned.status,
        value: returned.value,
        ...(returned.guess !== undefined ? { guess: returned.guess } : {}),
        confidence: returned.confidence,
        pNull: returned.pNull,
        ...(returned.sources ? { sources: returned.sources } : {}),
        ...(expectedSource && clairicValue !== null
          ? { source, sourceMatch: Boolean(source && (expectedSource.chunk ? source.chunks.includes(expectedSource.chunk) : source.refs.includes(expectedSource.ref))) }
          : {}),
        clairicValue,
        wrongValue: clairicValue !== null && (expected === null || !same(type, expected, clairicValue)),
      };
    });
    runs.push({ name: testCase.name, iteration, large: Boolean(testCase.large), latencyMs, ...(errorCode ? { error: errorCode } : { status: result.status, truncated: result.truncated }), outcomes });
  }
}

const outcomes = runs.flatMap((run) => run.outcomes.map((outcome) => ({ case: run.name, iteration: run.iteration, ...outcome })));
const counts = {};
for (const outcome of outcomes) counts[outcome.outcome] = (counts[outcome.outcome] || 0) + 1;
const wrongValues = outcomes.filter((outcome) => outcome.wrongValue).map(({ case: name, iteration, field, type, expected, clairicValue, status, confidence, pNull }) => ({ case: name, iteration, field, type, expected, returned: clairicValue, status, confidence, pNull }));
const maxWrongConfidence = wrongValues.length ? Math.max(...wrongValues.map((wrong) => wrong.confidence ?? 0)) : null;
const ruleExtract = Math.max(0.8, Math.ceil(((maxWrongConfidence ?? 0) + 0.05) * 100 - 1e-9) / 100);
const sourced = outcomes.filter((outcome) => outcome.sourceMatch !== undefined);
const callLatency = (large) => {
  const values = runs.filter((run) => !run.error && run.large === large).map((run) => run.latencyMs);
  return { calls: values.length, medianMs: percentile(values, 0.5), p95Ms: percentile(values, 0.95) };
};
const largeCase = cases.find((testCase) => testCase.large);

console.log(JSON.stringify({
  model,
  thresholds,
  referenceDate,
  repeat,
  cases: cases.length,
  fieldsPerRun: cases.reduce((total, testCase) => total + testCase.fields.length, 0),
  counts,
  errors: runs.filter((run) => run.error).map(({ name, iteration, error }) => ({ name, iteration, error })),
  sourceMatch: { matched: sourced.filter((outcome) => outcome.sourceMatch).length, of: sourced.length },
  latency: { regular: callLatency(false), large: callLatency(true), largeStateBytes: Buffer.byteLength(JSON.stringify(providerState(largeCase.page)), "utf8") },
  wrongValues,
  rule: {
    maxWrongConfidence,
    extract: ruleExtract,
    expectedNullAtOrAboveExtract: wrongValues.filter((wrong) => wrong.expected === null && (wrong.confidence ?? 0) >= ruleExtract),
  },
  summary: evaluator.summary(),
  runs,
}, null, 2));
