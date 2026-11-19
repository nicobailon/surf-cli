import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

// Tests, and the hosts and CLIs they start, get a throwaway HOME and Surf state dir, so nothing
// writes to the user's ~/.surf. test/setup/state-guard.ts removes it after the run.
const testRoot = mkdtempSync(join(tmpdir(), "surf-vitest-"));
process.env.SURF_TEST_ROOT = testRoot;
const testHome = join(testRoot, "home");
mkdirSync(testHome);

export default defineConfig({
  test: {
    // Test file patterns
    include: [
      "test/unit/**/*.test.ts",
      "test/integration/**/*.test.ts",
      "test/e2e/**/*.test.ts",
    ],

    // Environment
    environment: "node",
    env: { HOME: testHome, USERPROFILE: testHome, SURF_STATE_DIR: join(testRoot, "state") },

    // Coverage configuration
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts", "native/**/*.cjs"],
      exclude: [
        "node_modules",
        "test",
        "native/cli.cjs",
        "**/*.d.ts",
        "**/*.config.*",
      ],
    },

    // Timeouts
    testTimeout: 10000,
    hookTimeout: 10000,

    // Reporter
    reporters: ["verbose"],

    // Global test utilities
    globals: true,

    // Warns (fails in CI or with SURF_TEST_STATE_GUARD=strict) if the real Surf state dir changes.
    globalSetup: ["test/setup/state-guard.ts"],

    // pi-subagents publishes TypeScript sources; inline it so vitest transforms them.
    server: {
      deps: {
        inline: ["pi-subagents"],
      },
    },
  },
});
