import { Queue, Worker, UnrecoverableError } from "bullmq"
import { Redis } from "ioredis"
import { z } from "zod"
import type { WorkerConfig } from "./config.ts"
import { TaskPermanentError } from "./contract.ts"

export const PlatformTaskReferenceSchema = z.strictObject({
  scope: z.literal("platform"),
  taskId: z.uuid(),
  actorId: z.uuid(),
  sessionId: z.uuid(),
  requestId: z.string().min(1).max(200),
})
export type PlatformTaskReference = z.infer<typeof PlatformTaskReferenceSchema>
export type PlatformTaskRuntimeCallbacks = {
  pending: () => Promise<PlatformTaskReference[]>
  queued: (task: PlatformTaskReference) => Promise<void>
  execute: (task: PlatformTaskReference) => Promise<void>
  failed: (task: PlatformTaskReference, code: string) => Promise<void>
  fault: () => void
}

// 队列只保存平台任务绑定，输入与临时凭据保留在受控数据库/私有资源中。
export function createPlatformTaskRuntime(
  config: WorkerConfig,
  callbacks: PlatformTaskRuntimeCallbacks
) {
  const connection = (consumer: boolean) => {
    const redis = new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: consumer ? null : 1,
      enableOfflineQueue: consumer,
      connectTimeout: config.producerTimeoutMs,
      ...(consumer ? {} : { commandTimeout: config.producerTimeoutMs }),
    })
    redis.on("error", callbacks.fault)
    return redis
  }
  const queueName = `${config.queueName}-platform`
  const producer = connection(false)
  const consumer = connection(true)
  const queue = new Queue<PlatformTaskReference>(queueName, {
    connection: producer,
    prefix: config.queuePrefix,
    defaultJobOptions: {
      attempts: config.attempts,
      backoff: { type: "exponential", delay: config.backoffMs },
      removeOnComplete: { age: 7 * 86400 },
      removeOnFail: { age: 7 * 86400 },
    },
  })
  queue.on("error", callbacks.fault)
  const worker = new Worker<PlatformTaskReference>(
    queueName,
    async (job) => {
      const parsed = PlatformTaskReferenceSchema.safeParse(job.data)
      if (!parsed.success || parsed.data.taskId !== job.id)
        throw new UnrecoverableError("INVALID_PLATFORM_TASK")
      try {
        await callbacks.execute(parsed.data)
      } catch (error) {
        // Redis失败原因只允许稳定分类，禁止落入数据库消息或任务输入。
        if (error instanceof TaskPermanentError)
          throw new UnrecoverableError(error.code)
        // eslint-disable-next-line preserve-caught-error -- 原始异常可能包含秘密，队列不能保存cause。
        throw new Error("EXECUTION_FAILED")
      }
    },
    {
      connection: consumer,
      prefix: config.queuePrefix,
      concurrency: config.concurrency,
      lockDuration: config.lockDurationMs,
      stalledInterval: config.stalledIntervalMs,
      maxStalledCount: config.maxStalledCount,
    }
  )
  worker.on("error", callbacks.fault)
  const settlements = new Set<Promise<void>>()
  worker.on("failed", (job, error) => {
    if (!job) return
    const parsed = PlatformTaskReferenceSchema.safeParse(job.data)
    if (!parsed.success || parsed.data.taskId !== job.id) return
    if (
      !(error instanceof UnrecoverableError) &&
      job.attemptsMade < (job.opts.attempts ?? 1)
    )
      return
    const code = /^[A-Z_]{1,100}$/.test(error.message)
      ? error.message
      : "EXECUTION_FAILED"
    // 最后一次队列失败须结算数据库状态；失败回调异常交由持久非终态扫描再次恢复。
    const settlement = Promise.resolve()
      .then(() => callbacks.failed(parsed.data, code))
      .catch(() => callbacks.fault())
      .finally(() => settlements.delete(settlement))
    settlements.add(settlement)
  })
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  async function dispatch() {
    for (const raw of await callbacks.pending()) {
      if (stopped) return
      const task = PlatformTaskReferenceSchema.parse(raw)
      let job = await queue.getJob(task.taskId)
      if (!job)
        job = await queue.add("platform-task", task, { jobId: task.taskId })
      const state = await job.getState()
      if (state === "failed") {
        const code = /^[A-Z_]{1,100}$/.test(job.failedReason)
          ? job.failedReason
          : "EXECUTION_FAILED"
        await callbacks.failed(task, code)
      } else if (state !== "completed") {
        await callbacks.queued(task)
      }
    }
  }
  async function tick() {
    try {
      await dispatch()
    } catch {
      callbacks.fault()
    }
    if (!stopped)
      timer = setTimeout(() => {
        current = tick()
      }, 1000)
  }
  let current = tick()
  return {
    queue,
    worker,
    async close() {
      stopped = true
      clearTimeout(timer)
      await current
      try {
        await worker.close()
        // BullMQ 事件回调不被 close 等待，显式等候结算后才能断开连接。
        await Promise.all(settlements)
        await queue.close()
      } finally {
        consumer.disconnect()
        producer.disconnect()
      }
    },
  }
}
