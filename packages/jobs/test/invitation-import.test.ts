import { beforeEach, describe, expect, it, vi } from "vitest"
import ExcelJS from "exceljs"
import {
  CreateOrganizationInvitationImportSchema,
  ORGANIZATION_INVITATION_IMPORT_MAX_BYTES,
} from "@workspace/contracts"
import type { TenantTx } from "@workspace/database/tenant"
import { createTaskEnvelope, taskContext } from "../src/contract.ts"
import { createOrganizationInvitationImportTask } from "../src/organization-invitation-import.ts"
import {
  invitationImportTemplate,
  parseInvitationImportWorkbook,
} from "../src/invitation-import-workbook.ts"

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  query: vi.fn(),
  finish: vi.fn(),
  lock: vi.fn(),
  find: vi.fn(),
}))
vi.mock("@workspace/database/invitation-command", () => ({
  createOrganizationInvitation: mocks.create,
  invitationTenantExecutor: () => ({ query: mocks.query }),
  nativeInvitationCreator: () => vi.fn(),
  invitationFailureCode: (error: { code?: string }) => error.code,
}))
vi.mock("@workspace/database/repositories/business-tasks", () => ({
  businessTaskRepository: {
    finish: mocks.finish,
    lock: mocks.lock,
    find: mocks.find,
  },
}))
async function workbook(rows: unknown[][], sheets = 1) {
  const book = new ExcelJS.Workbook()
  for (let index = 0; index < sheets; index++) {
    const sheet = book.addWorksheet(`Invitations${index}`)
    sheet.addRows(rows)
  }
  return Buffer.from(await book.xlsx.writeBuffer())
}
const identity = {
  organizationId: "ad484634-ad26-4e23-807c-9bb289d9f704",
  actorId: "835415d1-57cc-4304-b27e-314c63f2984b",
  resourceId: "5dafba22-b158-4f24-95d2-98fd6015d6e3",
  locale: "zh-CN" as const,
  requestId: "invitation-import",
}
const definition = () =>
  createOrganizationInvitationImportTask({
    organization: 100,
    actor: 50,
    ip: 100,
  })
async function task(bytes: Buffer) {
  const input = {
    format: "xlsx",
    role: "member",
    contentBase64: bytes.toString("base64"),
    sourceIpHash: "a".repeat(64),
  }
  return taskContext(
    createTaskEnvelope([definition()], {
      type: "invitations.import",
      identity,
      input,
      idempotencyKey: "one",
    }),
    1
  )
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.query.mockResolvedValue({ rows: [] })
})
describe("invitation workbook", () => {
  it("provides exactly the email column and no account/password/role fields", async () => {
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(
      Uint8Array.from(await invitationImportTemplate()).buffer
    )
    expect(book.worksheets).toHaveLength(1)
    expect(book.worksheets[0].getRow(1).values).toEqual([undefined, "email"])
    expect(
      await parseInvitationImportWorkbook(await invitationImportTemplate())
    ).toEqual({ rows: [], fileError: "EMPTY_FILE" })
  })
  it("normalizes email case and reports later duplicate rows without changing their role", async () => {
    const result = await parseInvitationImportWorkbook(
      await workbook([
        ["email"],
        [" New@Example.test "],
        ["new@example.test"],
        ["invalid"],
      ])
    )
    expect(result.rows).toEqual([
      { row: 2, email: "new@example.test", plannedCode: null },
      { row: 3, email: "new@example.test", plannedCode: "DUPLICATE_IN_FILE" },
      { row: 4, email: "invalid", plannedCode: "INVALID_EMAIL" },
    ])
  })
  it.each([
    {
      rows: [
        ["email", "password"],
        ["a@example.test", "secret"],
      ],
    },
    { rows: [["email"], ["a@example.test", "member"]] },
    { rows: [["Email"], ["a@example.test"]] },
  ])("rejects non-template columns %#", async ({ rows }) => {
    expect(
      (await parseInvitationImportWorkbook(await workbook(rows))).fileError
    ).toBe("INVALID_COLUMNS")
  })
  it("does not use a formula result as an invitation address", async () => {
    const result = await parseInvitationImportWorkbook(
      await workbook([
        ["email"],
        [{ formula: '"a@example.test"', result: "a@example.test" }],
      ])
    )
    expect(result.rows[0]).toMatchObject({
      email: "",
      plannedCode: "INVALID_EMAIL",
    })
  })
  it("requires exactly one worksheet", async () => {
    expect(
      (
        await parseInvitationImportWorkbook(
          await workbook([["email"], ["a@example.test"]], 2)
        )
      ).fileError
    ).toBe("INVALID_WORKSHEET_COUNT")
  })
  it("enforces the bounded 500-row batch", async () => {
    expect(
      (
        await parseInvitationImportWorkbook(
          await workbook([
            ["email"],
            ...Array.from({ length: 501 }, () => ["a@example.test"]),
          ])
        )
      ).fileError
    ).toBe("TOO_MANY_ROWS")
  })
  it.each([
    Buffer.from("not a workbook"),
    Buffer.alloc(ORGANIZATION_INVITATION_IMPORT_MAX_BYTES + 1),
  ])("rejects malformed or oversized XLSX %#", async (bytes) => {
    expect((await parseInvitationImportWorkbook(bytes)).fileError).toBe(
      "INVALID_FILE"
    )
  })
  it("never accepts owner, multiple roles or trusted source metadata from HTTP input", () => {
    const input = { format: "xlsx", role: "member", contentBase64: "YQ==" }
    expect(
      CreateOrganizationInvitationImportSchema.safeParse(input).success
    ).toBe(true)
    for (const value of [
      { ...input, role: "owner" },
      { ...input, role: "member,admin" },
      { ...input, sourceIpHash: "a".repeat(64) },
    ])
      expect(
        CreateOrganizationInvitationImportSchema.safeParse(value).success
      ).toBe(false)
  })
})
describe("transactional invitation import", () => {
  it("requires native invitation:create independently of member:update", () => {
    expect(definition().permissions).toEqual({ invitation: ["create"] })
  })
  it("records success, membership/pending skips, file duplicates and validation/rate failures", async () => {
    mocks.create.mockImplementation(async (_db, _create, input) => {
      if (input.email === "existing@example.test")
        throw { code: "MEMBER_ALREADY_EXISTS" }
      if (input.email === "pending@example.test")
        throw { code: "INVITATION_ALREADY_PENDING" }
      if (input.email === "limited@example.test")
        throw { code: "INVITATION_RATE_LIMITED" }
      return { invitation: { id: identity.resourceId } }
    })
    const request = await task(
      await workbook([
        ["email"],
        ["new@example.test"],
        ["NEW@example.test"],
        ["existing@example.test"],
        ["pending@example.test"],
        ["invalid"],
        ["limited@example.test"],
      ])
    )
    const result = await definition().execute({} as TenantTx, request)
    expect(result).toEqual({
      count: 1,
      issues: [],
      invitationImport: { invited: 1, skipped: 3, failed: 2 },
    })
    expect(mocks.create).toHaveBeenCalledTimes(4)
    const call = mocks.finish.mock.calls[0]
    const report = JSON.parse(Buffer.from(call[3], "base64").toString())
    expect(report.rows.map((row: { status: string }) => row.status)).toEqual([
      "invited",
      "skipped",
      "skipped",
      "skipped",
      "failed",
      "failed",
    ])
    expect(report.rows.map((row: { row: number }) => row.row)).toEqual([
      2, 3, 4, 5, 6, 7,
    ])
    expect(call[4]).toBe("completed")
  })
  it("rejects a changed resource identity before any native write", async () => {
    const request = await task(await workbook([["email"], ["a@example.test"]]))
    mocks.lock.mockResolvedValue({
      actorId: identity.actorId,
      type: "members.export",
      intentFingerprint: request.intentFingerprint,
      status: "queued",
    })
    await expect(
      definition().authorizeResource({} as TenantTx, request)
    ).rejects.toMatchObject({ code: "RESOURCE_DENIED" })
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it("returns the committed report summary on a retry without creating or sending again", async () => {
    const request = await task(await workbook([["email"], ["a@example.test"]]))
    const result = {
      count: 1,
      issues: [],
      invitationImport: { invited: 1, skipped: 0, failed: 0 },
    }
    mocks.find.mockResolvedValue({
      status: "completed",
      intentFingerprint: request.intentFingerprint,
      result,
    })
    expect(await definition().findCommitted({} as TenantTx, request)).toEqual({
      intentFingerprint: request.intentFingerprint,
      result,
    })
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it("keeps unexpected database failures out of per-row business reports", async () => {
    const request = await task(await workbook([["email"], ["a@example.test"]]))
    const failure = new Error("database connection interrupted")
    mocks.create.mockRejectedValue(failure)
    await expect(definition().execute({} as TenantTx, request)).rejects.toBe(
      failure
    )
    expect(mocks.finish).not.toHaveBeenCalled()
  })
  it("settles a malformed file as a failed task with a downloadable file-level report", async () => {
    const request = await task(Buffer.from("bad xlsx"))
    await definition().execute({} as TenantTx, request)
    expect(mocks.create).not.toHaveBeenCalled()
    const call = mocks.finish.mock.calls[0]
    expect(call[4]).toBe("failed")
    expect(JSON.parse(Buffer.from(call[3], "base64").toString())).toEqual({
      invited: 0,
      skipped: 0,
      failed: 0,
      rows: [],
      fileError: "INVALID_FILE",
    })
  })
})
