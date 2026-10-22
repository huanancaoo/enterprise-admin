import type { Worker, Job } from "bullmq"
import {
  recordBusinessTaskProgress,
  type BusinessTaskObservation,
} from "./business-task-progress.ts"
import {
  readTaskEnvelope,
  type RegisteredTask,
  type TaskEnvelope,
} from "./contract.ts"

export function observeBusinessTasks(
  worker: Worker<TaskEnvelope>,
  pool: Parameters<typeof recordBusinessTaskProgress>[0],
  attempts: number,
  registry: readonly RegisteredTask[]
) {
  const pending = new Set<Promise<void>>()
  const record = (
    job: Job<TaskEnvelope> | undefined,
    observation: Extract<
      BusinessTaskObservation,
      { kind: "worker-active" | "worker-failed" }
    >
  ) => {
    if (!job || !registry.some((task) => task.type === job.name)) return
    let task: ReturnType<typeof readTaskEnvelope>
    try {
      task = readTaskEnvelope(registry, job.data, job.id ?? "", job.name)
    } catch {
      console.error(
        JSON.stringify({
          event: "task_observation_failed",
          code: "INVALID_TASK_ENVELOPE",
          jobId: /^[a-f0-9]{64}$/.test(job.id ?? "") ? job.id : undefined,
        })
      )
      return
    }
    const work = recordBusinessTaskProgress(
      pool,
      { ...task.identity, intentFingerprint: task.intentFingerprint },
      observation
    ).catch(() => {
      console.error(
        JSON.stringify({
          event: "task_observation_failed",
          code: "TASK_OBSERVATION_UNAVAILABLE",
          jobId: job.id,
        })
      )
    })
    pending.add(work)
    void work.finally(() => pending.delete(work))
  }
  const active = (job: Job<TaskEnvelope>) =>
    record(job, { kind: "worker-active" })
  const failed = (job: Job<TaskEnvelope> | undefined, error: Error) => {
    if (
      !job ||
      (error.name !== "UnrecoverableError" && job.attemptsMade < attempts)
    )
      return
    // 只把实时终态交给业务任务；重试中的失败仍由队列持有。
    record(job, {
      kind: "worker-failed",
      unrecoverable: error.name === "UnrecoverableError",
      failedReason: job.failedReason,
    })
  }
  worker.on("active", active)
  worker.on("failed", failed)
  return async () => {
    worker.off("active", active)
    worker.off("failed", failed)
    await Promise.all([...pending])
  }
}
