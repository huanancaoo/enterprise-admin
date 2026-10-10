import { expect, it } from "vitest"
import { readWorkerConfig } from "../src/index.ts"
it("requires a Redis URL and bounds retry, concurrency and close configuration", () => {
  expect(() => readWorkerConfig({})).toThrow()
  const config = readWorkerConfig({ REDIS_URL: "redis://localhost:6379" })
  expect(config).toMatchObject({
    attempts: 3,
    concurrency: 4,
    shutdownMs: 30000,
    queuePrefix: "jobs",
  })
  expect(() =>
    readWorkerConfig({
      REDIS_URL: "redis://localhost:6379",
      WORKER_ATTEMPTS: "0",
    })
  ).toThrow()
  expect(() =>
    readWorkerConfig({
      REDIS_URL: "redis://localhost:6379",
      WORKER_CONCURRENCY: "129",
    })
  ).toThrow()
  expect(() =>
    readWorkerConfig({
      REDIS_URL: "redis://localhost:6379",
      WORKER_QUEUE_PREFIX: "auth",
    })
  ).toThrow()
})
