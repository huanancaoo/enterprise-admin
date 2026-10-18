import { Queue } from "bullmq"
import { Redis } from "ioredis"
import type { WorkerConfig } from "./config.ts"

export function createQueueMonitor(config: WorkerConfig, timeoutMs: number) {
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: timeoutMs,
    commandTimeout: timeoutMs,
  })
  // 探测异常由调用方投影为不可用，不能把Redis地址或原始错误写入日志。
  redis.on("error", () => {})
  const queues = {
    organization: new Queue(config.queueName, {
      connection: redis,
      prefix: config.queuePrefix,
    }),
    platform: new Queue(`${config.queueName}-platform`, {
      connection: redis,
      prefix: config.queuePrefix,
    }),
  }
  for (const queue of Object.values(queues)) queue.on("error", () => {})
  return {
    async ping() {
      await queues.organization.waitUntilReady()
      await redis.ping()
    },
    async counts(scope: keyof typeof queues) {
      const queue = queues[scope]
      await queue.waitUntilReady()
      return queue.getJobCounts("waiting", "active", "delayed", "failed")
    },
    async close() {
      try {
        await Promise.all(Object.values(queues).map((queue) => queue.close()))
      } finally {
        redis.disconnect()
      }
    },
  }
}
