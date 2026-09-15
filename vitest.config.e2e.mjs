import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/e2e/**/*.test.mjs"],
    hookTimeout: 180_000,
    testTimeout: 60_000,
    forbidOnly: true,
  },
})
