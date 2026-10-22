import { defineTask } from "../src/contract.ts"
import { z } from "zod"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { TenantTx } from "@workspace/database/tenant"
import type { TaskTenantRunner } from "../src/contract.ts"
import { readWorkerConfig } from "../src/config.ts"
import { startBusinessTaskDispatch } from "../src/business-task-dispatch.ts"

const mocks = vi.hoisted(() => ({
  scopes: vi.fn(),
  run: vi.fn<TaskTenantRunner>(),
  find: vi.fn(),
  submit: vi.fn(),
  close: vi.fn(),
}))
vi.mock("@workspace/database/task-tenant", () => ({
  createTaskTenantRunner: () => mocks.run,
}))
vi.mock("@workspace/database/business-task-control", () => ({
  pendingBusinessTaskScopes: mocks.scopes,
}))
vi.mock("@workspace/database/repositories/business-tasks", () => ({
  businessTaskRepository: { find: mocks.find },
}))
vi.mock("../src/runtime.ts", () => ({
  createTaskProducer: () => ({ submit: mocks.submit, close: mocks.close }),
  taskErrorCode: () => undefined,
}))
const registry = [
  defineTask({
    type: "members.export",
    inputSchema: z.unknown(),
    permissions: { member: ["export"] },
    authorizeResource: async () => {},
    findCommitted: async () => undefined,
    execute: async () => ({}),
  }),
]
const scope = {
  id: "5dafba22-b158-4f24-95d2-98fd6015d6e3",
  organization_id: "ad484634-ad26-4e23-807c-9bb289d9f704",
  actor_id: "835415d1-57cc-4304-b27e-314c63f2984b",
  type: "members.export",
  locale: "zh-CN",
  request_id: "dispatch-recovery-test",
  intent_fingerprint: "a".repeat(64),
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.scopes.mockResolvedValueOnce([scope]).mockResolvedValue([])
  mocks.run.mockImplementation((_identity, _permission, work) =>
    work({} as TenantTx)
  )
  mocks.find.mockResolvedValue({
    type: scope.type,
    status: "running",
    idempotencyKey: "recovery",
    input: { format: "xlsx", filter: {} },
  })
})

describe("business task recovery dispatch", () => {
  it("reads authorized input and waits for the current submission before closing", async () => {
    let finishSubmission!: (outcome: {
      status: "unknown"
      jobId: string
    }) => void
    const submission = new Promise<{ status: "unknown"; jobId: string }>(
      (resolve) => {
        finishSubmission = resolve
      }
    )
    mocks.submit.mockReturnValue(submission)
    const pool = {} as Parameters<typeof startBusinessTaskDispatch>[0]
    const stop = startBusinessTaskDispatch(
      pool,
      readWorkerConfig({ REDIS_URL: "redis://127.0.0.1:6379" }),
      registry
    )
    let closed: Promise<void> | undefined
    try {
      await expect.poll(() => mocks.submit.mock.calls.length).toBe(1)
      const identity = {
        organizationId: scope.organization_id,
        actorId: scope.actor_id,
        resourceId: scope.id,
        locale: scope.locale,
        requestId: scope.request_id,
      }
      expect(mocks.run).toHaveBeenCalledWith(
        identity,
        { member: ["export"] },
        expect.any(Function)
      )
      expect(mocks.submit).toHaveBeenCalledWith({
        type: scope.type,
        identity,
        idempotencyKey: "recovery",
        input: { format: "xlsx", filter: {} },
      })
      closed = stop()
      expect(mocks.close).not.toHaveBeenCalled()
      finishSubmission({ status: "unknown", jobId: "recovery-job" })
      await closed
      expect(mocks.close).toHaveBeenCalledOnce()
    } finally {
      finishSubmission({ status: "unknown", jobId: "recovery-job" })
      await (closed ?? stop())
    }
  })
})
