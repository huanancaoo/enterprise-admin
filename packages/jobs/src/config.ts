import { z } from "zod"

const integer = (minimum: number, maximum: number, value: number) =>
  z.coerce.number().int().min(minimum).max(maximum).default(value)
const environmentSchema = z.object({
  REDIS_URL: z
    .url()
    .refine((url) => ["redis:", "rediss:"].includes(new URL(url).protocol)),
  WORKER_QUEUE_NAME: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,63}$/)
    .default("organization-tasks"),
  WORKER_QUEUE_PREFIX: z
    .string()
    .regex(/^jobs(?:[-_][a-z0-9-_]+)?$/)
    .default("jobs"),
  WORKER_ATTEMPTS: integer(1, 20, 3),
  WORKER_BACKOFF_MS: integer(0, 60000, 1000),
  WORKER_CONCURRENCY: integer(1, 128, 4),
  WORKER_SHUTDOWN_MS: integer(100, 300000, 30000),
  WORKER_LOCK_DURATION_MS: integer(100, 300000, 30000),
  WORKER_STALLED_INTERVAL_MS: integer(100, 300000, 30000),
  WORKER_MAX_STALLED_COUNT: integer(0, 10, 1),
  WORKER_PRODUCER_TIMEOUT_MS: integer(100, 60000, 5000),
})
export type WorkerConfig = {
  redisUrl: string
  queueName: string
  queuePrefix: string
  attempts: number
  backoffMs: number
  concurrency: number
  shutdownMs: number
  lockDurationMs: number
  stalledIntervalMs: number
  maxStalledCount: number
  producerTimeoutMs: number
}
export function readWorkerConfig(
  env: Record<string, string | undefined>
): WorkerConfig {
  const result = environmentSchema.safeParse(env)
  // 配置错误只列变量名，不能把 Redis 连接串中的凭据写进启动日志。
  if (!result.success)
    throw new Error(
      `Invalid Worker configuration: ${[...new Set(result.error.issues.map((issue) => issue.path[0]))].join(", ")}`
    )
  const value = result.data
  return {
    redisUrl: value.REDIS_URL,
    queueName: value.WORKER_QUEUE_NAME,
    queuePrefix: value.WORKER_QUEUE_PREFIX,
    attempts: value.WORKER_ATTEMPTS,
    backoffMs: value.WORKER_BACKOFF_MS,
    concurrency: value.WORKER_CONCURRENCY,
    shutdownMs: value.WORKER_SHUTDOWN_MS,
    lockDurationMs: value.WORKER_LOCK_DURATION_MS,
    stalledIntervalMs: value.WORKER_STALLED_INTERVAL_MS,
    maxStalledCount: value.WORKER_MAX_STALLED_COUNT,
    producerTimeoutMs: value.WORKER_PRODUCER_TIMEOUT_MS,
  }
}
