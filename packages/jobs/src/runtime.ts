import {
  Queue,
  Worker,
  UnrecoverableError,
  type Job,
  type JobState,
} from "bullmq"
import { Redis } from "ioredis"
import {
  assertSameIntent,
  createTaskEnvelope,
  getTask,
  readTaskEnvelope,
  taskContext,
  TaskPermanentError,
  type RegisteredTask,
  type TaskContext,
  type TaskEnvelope,
  type TaskRequest,
  type TaskTenantRunner,
} from "./contract.ts"
import type { WorkerConfig } from "./config.ts"

export type TaskLog = (
  record: Record<string, string | number | undefined>
) => void
export type TaskRuntimeOptions = {
  config: WorkerConfig
  registry: readonly RegisteredTask[]
  runInTenant: TaskTenantRunner
  log?: TaskLog
}
export type TaskSubmission =
  | { status: "enqueued"; jobId: string }
  | { status: "already_exists"; jobId: string; state: JobState | "unknown" }
  | { status: "already_completed"; jobId: string; result: unknown }
  | { status: "unknown"; jobId: string }

const authorizationCodes = new Set([
  "ORGANIZATION_SUSPENDED",
  "MEMBERSHIP_REQUIRED",
  "PERMISSION_DENIED",
])
export function taskErrorCode(error: unknown): string | undefined {
  if (error instanceof TaskPermanentError) return error.code
  if (
    error instanceof Error &&
    error.name === "TaskAuthorizationError" &&
    "code" in error &&
    typeof error.code === "string" &&
    authorizationCodes.has(error.code)
  )
    return error.code
  return undefined
}
function logger(options: TaskRuntimeOptions): TaskLog {
  return (
    options.log ??
    ((record) => {
      console.log(JSON.stringify(record))
    })
  )
}
function metadata(
  task: TaskContext,
  type: string
): Record<string, string | number> {
  return {
    jobId: task.jobId,
    type,
    organizationId: task.identity.organizationId,
    actorId: task.identity.actorId,
    resourceId: task.identity.resourceId,
    requestId: task.identity.requestId,
    attempt: task.attempt,
  }
}
function bound<T>(
  operation: Promise<T>,
  milliseconds: number,
  code: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    operation,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(code)), milliseconds)
    }),
  ]).finally(() => clearTimeout(timer))
}
function connection(
  config: WorkerConfig,
  consumer: boolean,
  log: TaskLog
): Redis {
  const client = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: consumer ? null : 1,
    enableOfflineQueue: consumer,
    connectTimeout: config.producerTimeoutMs,
    ...(consumer ? {} : { commandTimeout: config.producerTimeoutMs }),
    retryStrategy: (attempt) => Math.min(attempt * 100, 2000),
  })
  client.on("error", () =>
    log({
      event: "connection_error",
      code: "REDIS_UNAVAILABLE",
      role: consumer ? "consumer" : "producer",
    })
  )
  return client
}
export function createTaskProducer(options: TaskRuntimeOptions) {
  const { config, registry, runInTenant } = options
  const log = logger(options)
  const client = connection(config, false, log)
  const queue = new Queue(config.queueName, {
    connection: client,
    prefix: config.queuePrefix,
    defaultJobOptions: {
      attempts: config.attempts,
      backoff: { type: "exponential", delay: config.backoffMs },
      removeOnComplete: { age: 7 * 86400 },
      removeOnFail: { age: 7 * 86400 },
    },
  })
  queue.on("error", () =>
    log({ event: "queue_error", code: "REDIS_UNAVAILABLE", role: "producer" })
  )
  return {
    async submit(request: TaskRequest): Promise<TaskSubmission> {
      const envelope = createTaskEnvelope(registry, request)
      const task = taskContext(envelope, 0)
      const definition = getTask(registry, envelope.type)
      const details = metadata(task, envelope.type)
      let committed
      try {
        committed = await runInTenant(
          envelope.identity,
          definition.permissions,
          async (tx) => {
            await definition.authorizeResource(tx, task)
            const prior = await definition.findCommitted(tx, task)
            if (prior) assertSameIntent(prior, envelope)
            return prior
          }
        )
      } catch (error) {
        const code = taskErrorCode(error)
        log({
          ...details,
          event: "submission_rejected",
          code: code ?? "AUTHORIZATION_CHECK_FAILED",
        })
        if (code) throw new TaskPermanentError(code)
        throw error
      }
      if (committed) {
        log({
          ...details,
          event: "submission_result",
          outcome: "already_completed",
        })
        return {
          status: "already_completed",
          jobId: task.jobId,
          result: committed.result,
        }
      }
      try {
        const submission = await bound(
          (async (): Promise<TaskSubmission> => {
            await queue.waitUntilReady()
            const existing = await queue.getJob(task.jobId)
            if (existing) {
              assertSameIntent(
                readTaskEnvelope(
                  registry,
                  existing.data,
                  existing.id!,
                  existing.name
                ),
                envelope
              )
              return {
                status: "already_exists",
                jobId: task.jobId,
                state: await existing.getState(),
              }
            }
            await queue.add(envelope.type, envelope, { jobId: task.jobId })
            // BullMQ 在重复 Job ID 时可能返回调用方提供的 data；只信 Redis 实际持久化的记录。
            const stored = await queue.getJob(task.jobId)
            if (!stored) return { status: "unknown", jobId: task.jobId }
            assertSameIntent(
              readTaskEnvelope(registry, stored.data, stored.id!, stored.name),
              envelope
            )
            return { status: "enqueued", jobId: task.jobId }
          })(),
          config.producerTimeoutMs,
          "SUBMISSION_TIMEOUT"
        )
        log({
          ...details,
          event: "submission_result",
          outcome: submission.status,
        })
        return submission
      } catch (error) {
        if (error instanceof TaskPermanentError) {
          log({ ...details, event: "submission_rejected", code: error.code })
          throw error
        }
        log({ ...details, event: "submission_result", outcome: "unknown" })
        return { status: "unknown", jobId: task.jobId }
      }
    },
    async close(): Promise<void> {
      try {
        await bound(
          queue.close(),
          config.producerTimeoutMs,
          "PRODUCER_CLOSE_TIMEOUT"
        )
      } finally {
        client.disconnect()
      }
    },
  }
}

export async function startTaskWorker(options: TaskRuntimeOptions) {
  const { config, registry, runInTenant } = options
  const log = logger(options)
  const client = connection(config, true, log)
  const worker = new Worker<TaskEnvelope>(
    config.queueName,
    async (job: Job<TaskEnvelope>) => {
      let details: Record<string, string | number | undefined> = {
        jobId: /^[a-f0-9]{64}$/.test(job.id ?? "") ? job.id : undefined,
      }
      try {
        const envelope = readTaskEnvelope(
          registry,
          job.data,
          job.id ?? "",
          job.name
        )
        const task = taskContext(
          envelope,
          Math.max(job.attemptsStarted, job.attemptsMade + 1)
        )
        details = metadata(task, envelope.type)
        log({ ...details, event: "task_started" })
        const definition = getTask(registry, envelope.type)
        const result = await runInTenant(
          envelope.identity,
          definition.permissions,
          async (tx) => {
            await definition.authorizeResource(tx, task)
            const committed = await definition.findCommitted(tx, task)
            if (committed) {
              assertSameIntent(committed, envelope)
              return { business: "already_committed", result: committed.result }
            }
            return {
              business: "committed",
              result: await definition.execute(tx, task),
            }
          }
        )
        log({
          ...details,
          event: "business_result",
          businessOutcome: result.business,
        })
        return result
      } catch (error) {
        const code = taskErrorCode(error)
        log({
          ...details,
          event: "task_attempt_failed",
          outcome: code ? "rejected" : "execution_failed",
          code: code ?? "EXECUTION_FAILED",
        })
        // BullMQ 的失败原因会持久化；不能把数据库/外部服务原始错误中的秘密放进 Redis 或日志。
        if (code) throw new UnrecoverableError(code)
        // eslint-disable-next-line preserve-caught-error -- cause 会携带原始秘密；队列仅保存稳定执行失败分类。
        throw new Error("EXECUTION_FAILED")
      }
    },
    {
      connection: client,
      prefix: config.queuePrefix,
      concurrency: config.concurrency,
      lockDuration: config.lockDurationMs,
      stalledInterval: config.stalledIntervalMs,
      maxStalledCount: config.maxStalledCount,
    }
  )
  worker.on("error", () =>
    log({ event: "worker_error", code: "WORKER_RUNTIME_ERROR" })
  )
  const queueDetails = (job: Job<TaskEnvelope> | undefined) => {
    if (!job) return {}
    try {
      const envelope = readTaskEnvelope(
        registry,
        job.data,
        job.id ?? "",
        job.name
      )
      return metadata(
        taskContext(envelope, Math.max(job.attemptsStarted, job.attemptsMade)),
        envelope.type
      )
    } catch {
      return { jobId: /^[a-f0-9]{64}$/.test(job.id ?? "") ? job.id : undefined }
    }
  }
  worker.on("completed", (job) =>
    log({
      ...queueDetails(job),
      event: "queue_attempt_result",
      outcome: "completed",
    })
  )
  worker.on("failed", (job, error) =>
    log({
      ...queueDetails(job),
      event: "queue_attempt_result",
      outcome: "failed",
      code:
        error instanceof UnrecoverableError
          ? error.message
          : "EXECUTION_FAILED",
    })
  )
  try {
    await worker.waitUntilReady()
  } catch (error) {
    client.disconnect()
    await worker.close(true)
    throw error
  }
  log({
    event: "worker_ready",
    queueName: config.queueName,
    queuePrefix: config.queuePrefix,
  })
  let closing: Promise<void> | undefined
  return {
    worker,
    close(): Promise<void> {
      closing ??= (async () => {
        log({ event: "worker_stopping" })
        try {
          await bound(
            worker.close(),
            config.shutdownMs,
            "WORKER_SHUTDOWN_TIMEOUT"
          )
          log({ event: "worker_stopped" })
        } finally {
          client.disconnect()
          await worker.disconnect()
        }
      })()
      return closing
    },
  }
}
