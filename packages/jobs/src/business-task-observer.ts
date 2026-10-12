import { BusinessTaskErrorCodeSchema } from "@workspace/contracts"
import type { Worker, Job } from "bullmq"
import { recordBusinessTaskAttempt } from "@workspace/database/business-task-control"
import { readTaskEnvelope, type TaskEnvelope } from "./contract.ts"
import { projectExchangeTasks } from "./project-exchange.ts"

export function observeBusinessTasks(
  worker: Worker<TaskEnvelope>,
  pool: Parameters<typeof recordBusinessTaskAttempt>[0],
  attempts: number
) {
  const pending = new Set<Promise<void>>()
  const record = (
    job: Job<TaskEnvelope> | undefined,
    status: "running" | "failed" | "rejected",
    code: string | null
  ) => {
    if (!job || !projectExchangeTasks.some((task) => task.type === job.name))
      return
    let task: ReturnType<typeof readTaskEnvelope>
    try {
      task = readTaskEnvelope(
        projectExchangeTasks,
        job.data,
        job.id ?? "",
        job.name
      )
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
    const work = recordBusinessTaskAttempt(
      pool,
      { ...task.identity, intentFingerprint: task.intentFingerprint },
      status,
      code
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
  const active = (job: Job<TaskEnvelope>) => record(job, "running", null)
  const failed = (job: Job<TaskEnvelope> | undefined, error: Error) => {
    if (
      !job ||
      (error.name !== "UnrecoverableError" && job.attemptsMade < attempts)
    )
      return
    const errorCode = BusinessTaskErrorCodeSchema.safeParse(job.failedReason)
    const code = errorCode.success ? errorCode.data : "EXECUTION_FAILED"
    record(
      job,
      error.name === "UnrecoverableError" ? "rejected" : "failed",
      code
    )
  }
  worker.on("active", active)
  worker.on("failed", failed)
  return async () => {
    worker.off("active", active)
    worker.off("failed", failed)
    await Promise.all([...pending])
  }
}
