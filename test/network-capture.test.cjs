#!/usr/bin/env node
/**
 * Simple test for network capture functionality
 * Run: node test/network-capture.test.cjs
 */

const { execSync } = require("child_process");
const assert = require("assert");

const CLI = "node native/cli.cjs";

function run(cmd) {
  try {
    return execSync(`${CLI} ${cmd}`, { encoding: "utf8", timeout: 10000 }).trim();
  } catch (e) {
    return e.stdout?.trim() || e.message;
  }
}

function sleep(ms) {
  execSync(`sleep ${ms / 1000}`);
}

console.log("Network Capture Test\n" + "=".repeat(40));

// Get active tab
const tabList = run("tab.list");
const tabMatch = tabList.match(/^(\d+)/m);
if (!tabMatch) {
  console.error("SKIP: No tabs available");
  process.exit(0);
}
const tabId = tabMatch[1];
console.log(`Using tab: ${tabId}`);

// Navigate to test page
console.log("\n1. Navigate to httpbin.org...");
run(`go "https://httpbin.org/get" --tab-id ${tabId}`);
sleep(2000);

// Clear any existing requests by checking (this attaches debugger)
console.log("2. Attach debugger...");
run(`network --tab-id ${tabId}`);

// Make a test request
console.log("3. Trigger fetch request...");
run(`js "fetch('https://httpbin.org/headers')" --tab-id ${tabId}`);
sleep(1500);

// Check network captured it
console.log("4. Check network capture...");
const network = run(`network --tab-id ${tabId}`);
console.log(network);

// Verify
const hasRequest = network.includes("httpbin.org/headers");
if (hasRequest) {
  console.log("\n✓ PASS: Network request captured");
} else {
  console.log("\n✗ FAIL: Request not found in network log");
  process.exit(1);
}

// Test POST request
console.log("\n5. Test POST request...");
run(`js "fetch('https://httpbin.org/post', {method:'POST', body:'x=1'})" --tab-id ${tabId}`);
sleep(1500);

const network2 = run(`network --tab-id ${tabId}`);
const hasPost = network2.includes("POST") && network2.includes("httpbin.org/post");
if (hasPost) {
  console.log("✓ PASS: POST request captured");
} else {
  console.log("✗ FAIL: POST request not found");
  process.exit(1);
}

console.log("\n" + "=".repeat(40));
console.log("All tests passed!");
