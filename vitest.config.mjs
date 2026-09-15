import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: [
            "packages/eslint-config/boundaries/**/*.test.mjs",
            "tests/unit/**/*.test.ts",
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
    ],
  },
})
