import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "release",
          environment: "node",
          include: ["tests/release/**/*.test.mjs"],
          fileParallelism: false,
          hookTimeout: 1_800_000,
          testTimeout: 180_000,
          forbidOnly: true,
        },
      },
      {
        test: {
          name: "unit",
          environment: "node",
          include: [
            "packages/eslint-config/boundaries/**/*.test.mjs",
            "tests/unit/**/*.test.ts",
            "packages/mocks/tests/**/*.test.ts",
            "packages/api-client/tests/**/*.test.ts",
          ],
        },
      },
      {
        test: {
          name: "api",
          environment: "node",
          include: ["tests/api/**/*.test.mjs"],
          hookTimeout: 180_000,
          testTimeout: 60_000,
          forbidOnly: true,
        },
      },
      {
        test: {
          name: "performance",
          silent: false,
          environment: "node",
          include: ["tests/performance/**/*.test.mjs"],
          fileParallelism: false,
          hookTimeout: 300_000,
          testTimeout: 60_000,
          forbidOnly: true,
        },
      },
    ],
  },
})
