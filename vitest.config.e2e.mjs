import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/e2e/**/*.test.mjs"],
    hookTimeout: 180_000,
    testTimeout: 60_000,
    forbidOnly: true,
    // 每个文件各自拉起 Postgres/Vite/浏览器；保持串行以限制本地资源消耗。
    fileParallelism: false,
  },
})
