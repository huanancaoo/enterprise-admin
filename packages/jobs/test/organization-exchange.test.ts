import { beforeEach, describe, expect, it, vi } from "vitest"
import ExcelJS from "exceljs"
import { createTaskEnvelope, taskContext } from "../src/contract.ts"
import {
  createTenantExchangeTasks,
  tenantTaskPermissions,
} from "../src/tenant-exchange.ts"
import type { TenantTx } from "@workspace/database/tenant"

const tenantExchangeTasks = createTenantExchangeTasks({
  organization: 100,
  actor: 50,
  ip: 100,
})
const mocks = vi.hoisted(() => ({
  lock: vi.fn(),
  find: vi.fn(),
  finish: vi.fn(),
  listPage: vi.fn(),
  members: vi.fn(),
  countMembers: vi.fn(),
}))
vi.mock("@workspace/database/repositories/business-tasks", () => ({
  businessTaskRepository: {
    lock: mocks.lock,
    find: mocks.find,
    finish: mocks.finish,
  },
}))
vi.mock("@workspace/database/repositories/audit", () => ({
  auditRepository: { listPage: mocks.listPage },
}))
vi.mock("@workspace/database/repositories/organization-exchange", () => ({
  organizationExchangeRepository: {
    members: mocks.members,
    countMembers: mocks.countMembers,
  },
}))
const identity = {
  organizationId: "ad484634-ad26-4e23-807c-9bb289d9f704",
  actorId: "835415d1-57cc-4304-b27e-314c63f2984b",
  resourceId: "5dafba22-b158-4f24-95d2-98fd6015d6e3",
  locale: "zh-CN" as const,
  requestId: "export-test",
}
const input = {
  format: "xlsx",
  filter: {
    from: "2026-10-01T00:00:00.123456Z",
    to: "2026-10-02T00:00:00.654321Z",
  },
}
const makeTask = () =>
  taskContext(
    createTaskEnvelope(tenantExchangeTasks, {
      type: "audit.export",
      input,
      identity,
      idempotencyKey: "one",
    }),
    1
  )
beforeEach(() => vi.resetAllMocks())
describe("organization exports", () => {
  it("defines export actions independently from list and project actions", () => {
    expect(tenantTaskPermissions(tenantExchangeTasks, "audit.export")).toEqual({
      audit: ["export"],
    })
    expect(
      tenantTaskPermissions(tenantExchangeTasks, "members.export")
    ).toEqual({
      member: ["export"],
    })
    expect(
      tenantTaskPermissions(tenantExchangeTasks, "projects.import")
    ).toEqual({
      project: ["create"],
    })
  })
  it("rejects a stored task with a mismatched type or revoked resource", async () => {
    const task = makeTask()
    const definition = tenantExchangeTasks.find(
      (item) => item.type === "audit.export"
    )!
    mocks.lock.mockResolvedValue({
      actorId: identity.actorId,
      type: "members.export",
      intentFingerprint: task.intentFingerprint,
      status: "queued",
    })
    await expect(
      definition.authorizeResource({} as TenantTx, task)
    ).rejects.toMatchObject({ code: "RESOURCE_DENIED" })
    expect(mocks.finish).not.toHaveBeenCalled()
  })
  it("exports all filtered pages while keeping platform identities private", async () => {
    const task = makeTask()
    const definition = tenantExchangeTasks.find(
      (item) => item.type === "audit.export"
    )!
    const record = {
      id: identity.resourceId,
      occurredAt: input.filter.from,
      eventCode: "platform.organization_suspended",
      scope: "platform",
      actorType: "user",
      actorId: "secret-actor",
      resourceType: "secret-type",
      resourceId: "secret-resource",
      result: "succeeded",
      publicSummary: "Suspended",
      fields: { reason: "private-reason" },
    }
    mocks.listPage
      .mockResolvedValueOnce({
        items: [record],
        total: 1001,
        page: 1,
        pageSize: 1000,
      })
      .mockResolvedValueOnce({
        items: [
          {
            ...record,
            id: identity.actorId,
            scope: "tenant",
            actorId: identity.actorId,
          },
        ],
        total: 1001,
        page: 2,
        pageSize: 1000,
      })
    await definition.execute({} as TenantTx, task)
    expect(mocks.listPage).toHaveBeenNthCalledWith(2, expect.anything(), {
      filter: input.filter,
      page: 2,
      pageSize: 1000,
    })
    const bytes = Buffer.from(mocks.finish.mock.calls[0]![3], "base64")
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Uint8Array.from(bytes).buffer)
    const rows = workbook.worksheets[0]!.getSheetValues()
    expect(rows).toHaveLength(4)
    expect(JSON.stringify(rows[2])).not.toContain("secret-")
    expect(JSON.stringify(rows)).not.toContain("private-reason")
    expect(workbook.worksheets[0]!.getCell("F3").value).toBe(identity.actorId)
    expect(workbook.worksheets[0]!.getCell("J2").value).toBe("Suspended")
    expect(workbook.worksheets[0]!.getCell("J3").value).toBeNull()
    expect(mocks.finish.mock.calls[0]![2]).toEqual({ count: 2, issues: [] })
  })
  it("reads member exports in bounded pages and preserves all matching rows", async () => {
    const task = taskContext(
      createTaskEnvelope(tenantExchangeTasks, {
        type: "members.export",
        input: {
          format: "xlsx",
          filter: {
            q: "Member",
            role: "member",
            sortBy: "createdAt",
            sortOrder: "asc",
          },
        },
        identity,
        idempotencyKey: "members",
      }),
      1
    )
    const definition = tenantExchangeTasks.find(
      (item) => item.type === "members.export"
    )!
    const record = {
      userId: identity.actorId,
      name: "Member",
      email: "member@example.test",
      role: "member",
      createdAt: new Date("2026-10-01T00:00:00Z"),
    }
    mocks.countMembers.mockResolvedValue(1001)
    mocks.members
      .mockResolvedValueOnce(
        Array.from({ length: 1000 }, (_, index) => ({
          ...record,
          name: `Member ${index}`,
        }))
      )
      .mockResolvedValueOnce([{ ...record, name: "Member 1000" }])
    await definition.execute({} as TenantTx, task)
    expect(mocks.members).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      { q: "Member", role: "member", sortBy: "createdAt", sortOrder: "asc" },
      1,
      1000
    )
    expect(mocks.members).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      { q: "Member", role: "member", sortBy: "createdAt", sortOrder: "asc" },
      2,
      1000
    )
    expect(mocks.members).toHaveBeenCalledTimes(2)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(
      Uint8Array.from(Buffer.from(mocks.finish.mock.calls[0]![3], "base64"))
        .buffer
    )
    expect(workbook.worksheets[0]!.rowCount).toBe(1002)
    expect(workbook.worksheets[0]!.getCell("B1002").value).toBe("Member 1000")
    expect(mocks.finish.mock.calls[0]![2]).toEqual({ count: 1001, issues: [] })
  })
  it("rejects audit exports beyond XLSX capacity before writing any partial result", async () => {
    mocks.listPage.mockResolvedValue({
      items: [],
      total: 1_048_576,
      page: 1,
      pageSize: 1000,
    })
    const definition = tenantExchangeTasks.find(
      (item) => item.type === "audit.export"
    )!
    await expect(
      definition.execute({} as TenantTx, makeTask())
    ).rejects.toMatchObject({ code: "TOO_MANY_ROWS" })
    expect(mocks.listPage).toHaveBeenCalledTimes(1)
    expect(mocks.finish).not.toHaveBeenCalled()
  })
  it("rejects member exports beyond XLSX capacity without fetching the member rows", async () => {
    mocks.countMembers.mockResolvedValue(1_048_576)
    const task = taskContext(
      createTaskEnvelope(tenantExchangeTasks, {
        type: "members.export",
        input: { format: "xlsx", filter: {} },
        identity,
        idempotencyKey: "members-capacity",
      }),
      1
    )
    const definition = tenantExchangeTasks.find(
      (item) => item.type === "members.export"
    )!
    await expect(
      definition.execute({} as TenantTx, task)
    ).rejects.toMatchObject({ code: "TOO_MANY_ROWS" })
    expect(mocks.members).not.toHaveBeenCalled()
    expect(mocks.finish).not.toHaveBeenCalled()
  })
  it("requires the frozen list window and rejects page-scoped export inputs", () => {
    expect(() =>
      createTaskEnvelope(tenantExchangeTasks, {
        type: "audit.export",
        input: { format: "xlsx", filter: { page: 2 } },
        identity,
        idempotencyKey: "one",
      })
    ).toThrow()
  })
})
