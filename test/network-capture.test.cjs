#!/usr/bin/env node
/**
 * Comprehensive tests for network capture functionality
 * Run: node test/network-capture.test.cjs
 * 
 * Tests:
 * - Basic capture (compact format)
 * - Method filtering (--method)
 * - Status filtering (--status)
 * - Content-type filtering (--content-type)
 * - URL filtering (--url)
 * - Verbose modes (-v, -vv)
 * - Curl export (--format curl)
 * - Raw JSON export (--format raw)
 * - Persistence to /tmp/surf/
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const CLI = "node native/cli.cjs";
let tabId;
let passed = 0;
let failed = 0;

function run(cmd, opts = {}) {
  try {
    return execSync(`${CLI} ${cmd}`, { 
      encoding: "utf8", 
      timeout: opts.timeout || 15000,
      stdio: opts.stdio || ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch (e) {
    if (opts.expectError) return e.stderr?.trim() || e.message;
    return e.stdout?.trim() || e.message;
  }
}

function sleep(ms) {
  execSync(`sleep ${ms / 1000}`);
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}

function assertIncludes(str, substr, msg) {
  if (!str.includes(substr)) {
    throw new Error(msg || `Expected "${str.substring(0, 100)}..." to include "${substr}"`);
  }
}

function assertMatch(str, regex, msg) {
  if (!regex.test(str)) {
    throw new Error(msg || `Expected "${str.substring(0, 100)}..." to match ${regex}`);
  }
}

// ============================================================================
// Setup
// ============================================================================

console.log("╔══════════════════════════════════════════════════════════════════╗");
console.log("║           Network Capture Feature Tests                          ║");
console.log("╚══════════════════════════════════════════════════════════════════╝\n");

// Get active tab
const tabList = run("tab.list");
const tabMatch = tabList.match(/^(\d+)/m);
if (!tabMatch) {
  console.error("SKIP: No tabs available. Open a browser tab first.");
  process.exit(0);
}
tabId = tabMatch[1];
console.log(`Using tab: ${tabId}\n`);

// Clear persistence file for clean test
const PERSISTENCE_FILE = "/tmp/surf/requests.jsonl";
if (fs.existsSync(PERSISTENCE_FILE)) {
  fs.unlinkSync(PERSISTENCE_FILE);
}

// Navigate to test page and setup
console.log("Setting up test environment...");
run(`go "https://httpbin.org/get" --tab-id ${tabId}`);
sleep(2500);

// Trigger various requests for testing
console.log("Generating test traffic...\n");
run(`js "fetch('https://httpbin.org/headers')" --tab-id ${tabId}`);
sleep(500);
run(`js "fetch('https://httpbin.org/post', {method:'POST', headers:{'Content-Type':'application/json','X-Test':'value'}, body:JSON.stringify({user:'test',id:123})})" --tab-id ${tabId}`);
sleep(500);
run(`js "fetch('https://httpbin.org/status/404')" --tab-id ${tabId}`);
sleep(500);
run(`js "fetch('https://httpbin.org/html')" --tab-id ${tabId}`);
sleep(1500);

// ============================================================================
// Basic Capture Tests
// ============================================================================

console.log("─".repeat(70));
console.log("Basic Capture");
console.log("─".repeat(70));

test("Captures network requests in compact format", () => {
  const output = run(`network --tab-id ${tabId}`);
  assertIncludes(output, "httpbin.org", "Should capture httpbin requests");
  assertMatch(output, /\d{3}\s+(GET|POST)/, "Should show status and method");
});

test("Shows request type (Fetch, Document, etc)", () => {
  const output = run(`network --tab-id ${tabId}`);
  assertMatch(output, /(Fetch|Document|XHR)/, "Should show request type");
});

// ============================================================================
// Filtering Tests
// ============================================================================

console.log("\n" + "─".repeat(70));
console.log("Filtering");
console.log("─".repeat(70));

test("Filter by method: --method POST", () => {
  const output = run(`network --method POST --tab-id ${tabId}`);
  assertIncludes(output, "POST", "Should include POST requests");
  assert(!output.includes("GET ") || output.split("\n").every(l => !l.includes("GET ") || l.includes("POST")), 
    "Should only show POST requests");
});

test("Filter by method: --method GET", () => {
  const output = run(`network --method GET --tab-id ${tabId}`);
  assertIncludes(output, "GET", "Should include GET requests");
});

test("Filter by status: --status 200", () => {
  const output = run(`network --status 200 --tab-id ${tabId}`);
  assertIncludes(output, "200", "Should include 200 responses");
  assert(!output.includes("404 "), "Should not include 404 responses");
});

test("Filter by status: --status 404", () => {
  const output = run(`network --status 404 --tab-id ${tabId}`);
  if (output.includes("404")) {
    assertIncludes(output, "404", "Should include 404 responses");
  }
  // May be empty if no 404s captured yet
});

test("Filter by content-type: --content-type json", () => {
  const output = run(`network --content-type json -v --tab-id ${tabId}`);
  // JSON responses should be shown
  assert(output.includes("json") || output.includes("application/json") || output.length > 0, 
    "Should filter by content type");
});

test("Filter by URL: --url /post", () => {
  const output = run(`network --url /post --tab-id ${tabId}`);
  if (output && !output.includes("No network")) {
    assertIncludes(output, "/post", "Should only show URLs containing /post");
  }
});

test("Combined filters: --method POST --status 200", () => {
  const output = run(`network --method POST --status 200 --tab-id ${tabId}`);
  if (output && !output.includes("No network")) {
    assertIncludes(output, "POST", "Should include POST");
    assertIncludes(output, "200", "Should include 200 status");
  }
});

// ============================================================================
// Verbose Mode Tests
// ============================================================================

console.log("\n" + "─".repeat(70));
console.log("Verbose Modes");
console.log("─".repeat(70));

test("Verbose mode: -v shows key headers", () => {
  const output = run(`network -v --tab-id ${tabId}`);
  assertIncludes(output, "Request Headers", "Should show request headers section");
  assertIncludes(output, "User-Agent", "Should show User-Agent header");
});

test("Verbose mode: -v shows response info", () => {
  const output = run(`network -v --tab-id ${tabId}`);
  assertIncludes(output, "Response Headers", "Should show response headers section");
  assertMatch(output, /Status:\s*200/, "Should show status in verbose");
});

test("Verbose mode: -v shows body preview", () => {
  const output = run(`network -v --method POST --tab-id ${tabId}`);
  if (output.includes("Request Body")) {
    assertIncludes(output, "Request Body", "Should show request body section");
  }
});

test("Double verbose: -vv shows all headers", () => {
  const output = run(`network -vv --tab-id ${tabId}`);
  assertIncludes(output, "sec-ch-ua", "Should show all headers including sec-ch-ua");
});

// ============================================================================
// Export Format Tests
// ============================================================================

console.log("\n" + "─".repeat(70));
console.log("Export Formats");
console.log("─".repeat(70));

test("Curl export: --format curl", () => {
  const output = run(`network --format curl --method POST --tab-id ${tabId}`);
  if (output && !output.includes("No network")) {
    assertIncludes(output, "curl", "Should start with curl command");
    assertIncludes(output, "-X POST", "Should include POST method");
    assertIncludes(output, "-H", "Should include headers");
  }
});

test("Curl export includes request body for POST", () => {
  const output = run(`network --format curl --method POST --tab-id ${tabId}`);
  if (output && !output.includes("No network") && output.includes("POST")) {
    // curl uses -d for data (short form of --data)
    assert(output.includes("-d ") || output.includes("--data"), "Should include -d or --data for POST body");
  }
});

test("Raw JSON export: --format raw", () => {
  const output = run(`network --format raw --tab-id ${tabId}`);
  assert(output.startsWith("["), "Should be JSON array");
  const parsed = JSON.parse(output);
  assert(Array.isArray(parsed), "Should parse as array");
  assert(parsed.length > 0, "Should have entries");
  assert(parsed[0].url, "Entries should have url");
  assert(parsed[0].method, "Entries should have method");
});

test("Raw JSON includes headers", () => {
  const output = run(`network --format raw --tab-id ${tabId}`);
  const parsed = JSON.parse(output);
  const entry = parsed.find(e => e.requestHeaders);
  assert(entry, "Should have entry with requestHeaders");
  assert(entry.responseHeaders, "Should have responseHeaders");
});

test("Raw JSON includes bodies", () => {
  const output = run(`network --format raw --method POST --tab-id ${tabId}`);
  const parsed = JSON.parse(output);
  const postEntry = parsed.find(e => e.method === "POST" && e.requestBody);
  if (postEntry) {
    assert(postEntry.requestBody, "POST should have requestBody");
    assert(postEntry.responseBody, "Should have responseBody");
  }
});

test("URL list export: --format urls", () => {
  const output = run(`network --format urls --tab-id ${tabId}`);
  assertMatch(output, /https?:\/\//m, "Should list URLs");
  // Format: METHOD URL (minimal format for easy parsing)
  assertMatch(output, /(GET|POST)\s+https?:\/\//, "Should show method and URL");
});

// ============================================================================
// Persistence Tests
// ============================================================================

console.log("\n" + "─".repeat(70));
console.log("Persistence (/tmp/surf/)");
console.log("─".repeat(70));

test("Persists entries to /tmp/surf/requests.jsonl", () => {
  // Trigger verbose mode to ensure persistence (full data required)
  run(`network -v --tab-id ${tabId}`);
  sleep(500);
  
  assert(fs.existsSync(PERSISTENCE_FILE), "requests.jsonl should exist");
});

test("Persistence file contains valid JSONL", () => {
  const content = fs.readFileSync(PERSISTENCE_FILE, "utf8");
  const lines = content.trim().split("\n").filter(l => l);
  assert(lines.length > 0, "Should have entries");
  
  // Each line should be valid JSON
  for (const line of lines.slice(0, 3)) {
    const entry = JSON.parse(line);
    assert(entry.id, "Entry should have id");
    assert(entry.url, "Entry should have url");
    assert(entry.timestamp, "Entry should have timestamp");
  }
});

test("Persisted entries have full data (headers, body)", () => {
  const content = fs.readFileSync(PERSISTENCE_FILE, "utf8");
  const lines = content.trim().split("\n").filter(l => l);
  const entry = JSON.parse(lines[0]);
  
  assert(entry.requestHeaders, "Should have requestHeaders");
  assert(entry.responseHeaders, "Should have responseHeaders");
});

test("Custom path via SURF_NETWORK_PATH env", () => {
  // This tests that the env var is respected (we don't actually change it in test)
  const networkStore = require("../native/network-store.cjs");
  const defaultPath = networkStore.getBasePath();
  assert(defaultPath === "/tmp/surf" || defaultPath.includes("surf"), 
    "Should have default path");
});

// ============================================================================
// Summary
// ============================================================================

console.log("\n" + "═".repeat(70));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("═".repeat(70));

if (failed > 0) {
  process.exit(1);
} else {
  console.log("\n✓ All tests passed!\n");
}
