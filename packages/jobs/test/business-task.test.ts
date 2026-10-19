import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import type { BusinessTask } from "@workspace/contracts/framework-capabilities"
import type { TenantTx } from "@workspace/database/tenant"
import { defineBusinessTask } from "../src/business-task.ts"
import { readWorkerConfig } from "../src/config.ts"
import {
  createTaskEnvelope,
  taskJobId,
  TaskPermanentError,
  type TaskEnvelope,
  type TaskTenantRunner,
} from "../src/contract.ts"
import { createTaskProducer, startTaskWorker } from "../src/runtime.ts"

type StoredTask = Pick<
  BusinessTask,
  "id" | "actorId" | "type" | "status" | "result"
> & {
  intentFingerprint: string
}
type Transaction = {
  row: StoredTask | undefined
  effects: number
  locked: boolean
}
type QueueJob = {
  id: string
  name: string
  data: TaskEnvelope
  attemptsStarted: number
  attemptsMade: number
  failedReason: string
  getState: () => Promise<"waiting">
}
const transport = vi.hoisted(() => ({
  jobs: new Map<string, QueueJob>(),
  process: undefined as ((job: QueueJob) => Promise<unknown>) | undefined,
}))
vi.mock("@workspace/database/repositories/business-tasks", () => ({
  businessTaskRepository: {
    async lock(tx: Transaction, id: string) {
      tx.locked = true
      return tx.row?.id === id ? tx.row : undefined
    },
    async find(tx: Transaction, id: string) {
      return tx.row?.id === id ? tx.row : undefined
    },
  },
}))
vi.mock("bullmq", () => ({
  UnrecoverableError: class UnrecoverableError extends Error {},
  Queue: class Queue {
    on() {}
    async waitUntilReady() {}
    async close() {}
    async getJob(id: string) {
      return transport.jobs.get(id)
    }
    async add(name: string, data: TaskEnvelope, options: { jobId: string }) {
      transport.jobs.set(options.jobId, {
        id: options.jobId,
        name,
        data,
        attemptsStarted: 1,
        attemptsMade: 0,
        failedReason: "",
        getState: async () => "waiting",
      })
    }
  },
  Worker: class Worker {
    constructor(_name: string, process: (job: QueueJob) => Promise<unknown>) {
      transport.process = process
    }
    on() {}
    async waitUntilReady() {}
    async close() {}
    async disconnect() {}
  },
}))
vi.mock("ioredis", () => ({
  Redis: class Redis {
    on() {}
    disconnect() {}
  },
}))
vi.mock("bullmq-otel", () => ({ BullMQOtel: class BullMQOtel {} }))
vi.mock("@workspace/observability", () => ({
  observeQueue: () => () => {},
  recordTaskEvent: () => {},
}))

const types = [
  "projects.import",
  "projects.export",
  "members.export",
  "audit.export",
  "invitations.import",
] as const satisfies readonly BusinessTask["type"][]
const identity = {
  organizationId: "ad484634-ad26-4e23-807c-9bb289d9f704",
  actorId: "835415d1-57cc-4304-b27e-314c63f2984b",
  resourceId: "5dafba22-b158-4f24-95d2-98fd6015d6e3",
  locale: "zh-CN" as const,
  requestId: "business-task-execution",
}
const completed = { count: 1, issues: [] }
const close: Array<() => Promise<void>> = []

async function fixture(type: BusinessTask["type"] = "projects.import") {
  const state = { authorized: true, failExecution: false, effects: 0 }
  let row: StoredTask | undefined
  const definition = defineBusinessTask({
    type,
    inputSchema: z.strictObject({ name: z.string() }),
    permissions: { project: ["create"] },
    async execute(tx) {
      const transaction = tx as unknown as Transaction
      expect(transaction.locked).toBe(true)
      transaction.effects++
      transaction.row!.status = "completed"
      transaction.row!.result = completed
      if (state.failExecution) throw new Error("execution interrupted")
      return completed
    },
  })
  const request = {
    type,
    identity,
    idempotencyKey: "one",
    input: { name: "example" },
  }
  const envelope = createTaskEnvelope([definition], request)
  row = {
    id: identity.resourceId,
    actorId: identity.actorId,
    type,
    status: "queued",
    result: null,
    intentFingerprint: envelope.intentFingerprint,
  }
  // 内存事务只承接提交/回滚；当前身份、PostgreSQL 锁与 RLS 由真实 Worker 测试验证。
  const runInTenant: TaskTenantRunner = async (
    _identity,
    _permissions,
    work
  ) => {
    if (!state.authorized) throw new TaskPermanentError("PERMISSION_DENIED")
    const transaction: Transaction = {
      row: structuredClone(row),
      effects: state.effects,
      locked: false,
    }
    const result = await work(transaction as unknown as TenantTx)
    row = transaction.row
    state.effects = transaction.effects
    return result
  }
  const options = {
    config: readWorkerConfig({ REDIS_URL: "redis://localhost:6379" }),
    registry: [definition],
    runInTenant,
  }
  const producer = createTaskProducer(options)
  const worker = await startTaskWorker(options)
  close.push(
    () => producer.close(),
    () => worker.close()
  )
  const job: QueueJob = {
    id: taskJobId(identity, type, request.idempotencyKey),
    name: type,
    data: envelope,
    attemptsStarted: 1,
    attemptsMade: 0,
    failedReason: "",
    getState: async () => "waiting",
  }
  return {
    state,
    submit: () => producer.submit(request),
    execute: () => transport.process!(job),
    stored: () => row,
    replace: (value: StoredTask | undefined) => {
      row = value
    },
  }
}

beforeEach(() => {
  transport.jobs.clear()
  transport.process = undefined
})
afterEach(async () => {
  await Promise.all(close.splice(0).map((stop) => stop()))
})

describe("business task execution through producer and Worker", () => {
  it.each(types)(
    "commits %s once across submission and execution retries",
    async (type) => {
      const task = await fixture(type)
      expect(await task.submit()).toMatchObject({ status: "enqueued" })
      expect(await task.execute()).toEqual({
        business: "committed",
        result: completed,
      })
      expect(await task.execute()).toEqual({
        business: "already_committed",
        result: completed,
      })
      expect(await task.submit()).toMatchObject({
        status: "already_completed",
        result: completed,
      })
      expect(task.state.effects).toBe(1)
      expect(task.stored()).toMatchObject({
        status: "completed",
        result: completed,
      })
    }
  )

  it.each([
    ["missing task", undefined],
    ["different actor", { actorId: identity.organizationId }],
    ["different type", { type: "members.export" }],
    ["different intent", { intentFingerprint: "a".repeat(64) }],
    ["permanently rejected", { status: "rejected" }],
    ["failed without a result", { status: "failed", result: null }],
  ] as const)("does not enqueue or execute a %s", async (_reason, patch) => {
    const task = await fixture()
    task.replace(patch ? { ...task.stored()!, ...patch } : undefined)
    await expect(task.submit()).rejects.toMatchObject({
      code: "RESOURCE_DENIED",
    })
    await expect(task.execute()).rejects.toThrow("RESOURCE_DENIED")
    expect(task.state.effects).toBe(0)
    expect(transport.jobs.size).toBe(0)
  })

  it.each([
    ["projects.import", true],
    ["invitations.import", true],
    ["projects.export", false],
    ["members.export", false],
    ["audit.export", false],
  ] as const)(
    "preserves %s failed-result receipt semantics",
    async (type, committedFailure) => {
      const task = await fixture(type)
      const report = {
        count: 0,
        issues: [
          { row: 1, field: "file" as const, code: "INVALID_FILE" as const },
        ],
      }
      task.replace({ ...task.stored()!, status: "failed", result: report })
      if (committedFailure) {
        expect(await task.submit()).toMatchObject({
          status: "already_completed",
          result: report,
        })
        expect(await task.execute()).toEqual({
          business: "already_committed",
          result: report,
        })
        expect(task.state.effects).toBe(0)
        expect(transport.jobs.size).toBe(0)
      } else {
        expect(await task.submit()).toMatchObject({ status: "enqueued" })
        expect(await task.execute()).toEqual({
          business: "committed",
          result: completed,
        })
        expect(task.state.effects).toBe(1)
      }
    }
  )

  it("checks current authorization before returning an already committed result", async () => {
    const task = await fixture()
    await task.execute()
    task.state.authorized = false
    await expect(task.submit()).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    })
    await expect(task.execute()).rejects.toThrow("PERMISSION_DENIED")
    expect(task.state.effects).toBe(1)
    expect(transport.jobs.size).toBe(0)
  })

  it("keeps the business result in the execution transaction and retries only after rollback", async () => {
    const task = await fixture()
    task.state.failExecution = true
    await expect(task.execute()).rejects.toThrow("EXECUTION_FAILED")
    expect(task.state.effects).toBe(0)
    expect(task.stored()).toMatchObject({ status: "queued", result: null })
    task.state.failExecution = false
    expect(await task.execute()).toEqual({
      business: "committed",
      result: completed,
    })
    expect(await task.execute()).toEqual({
      business: "already_committed",
      result: completed,
    })
    expect(task.state.effects).toBe(1)
  })
})
