import { defineConfig } from "vitest/config";

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
  },
});
