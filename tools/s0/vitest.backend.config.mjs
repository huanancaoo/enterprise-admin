import { defineConfig } from "vitest/config"
import { nestPlugin } from "../testing/nest-plugin.mjs"

export default defineConfig({
  plugins: [nestPlugin()],
  test: {
    environment: "node",
    include: ["backend/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
})
