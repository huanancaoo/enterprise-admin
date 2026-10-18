import { defineTask } from "../src/contract.ts"
import { z } from "zod"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { TenantTx } from "@workspace/database/tenant"
import type { TaskTenantRunner } from "../src/contract.ts"
import { readWorkerConfig } from "../src/config.ts"
import { startBusinessTaskDispatch } from "../src/business-task-dispatch.ts"

const mocks = vi.hoisted(() => ({
  scopes: vi.fn(),
  record: vi.fn(),
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
  recordBusinessTaskAttempt: mocks.record,
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

describe("business task failed-queue recovery", () => {
  it.each([
    ["TOO_MANY_ROWS", "rejected"],
    ["PERMISSION_DENIED", "rejected"],
    ["EXECUTION_FAILED", "failed"],
  ])(
    "settles persisted %s as %s after the Worker callback is lost",
    async (code, status) => {
      mocks.submit.mockResolvedValue({
        status: "already_exists",
        state: "failed",
        failureCode: code,
      })
      const pool = {} as Parameters<typeof startBusinessTaskDispatch>[0]
      const stop = startBusinessTaskDispatch(
        pool,
        readWorkerConfig({ REDIS_URL: "redis://127.0.0.1:6379" }),
        registry
      )
      try {
        await expect
          .poll(() => mocks.record.mock.calls)
          .toEqual([
            [
              pool,
              {
                organizationId: scope.organization_id,
                actorId: scope.actor_id,
                resourceId: scope.id,
                locale: scope.locale,
                requestId: scope.request_id,
                intentFingerprint: scope.intent_fingerprint,
              },
              status,
              code,
            ],
          ])
        expect(mocks.run).toHaveBeenCalledWith(
          expect.objectContaining({ organizationId: scope.organization_id }),
          { member: ["export"] },
          expect.any(Function)
        )
        expect(mocks.submit).toHaveBeenCalledTimes(1)
      } finally {
        await stop()
      }
      expect(mocks.close).toHaveBeenCalledOnce()
    }
  )
})
