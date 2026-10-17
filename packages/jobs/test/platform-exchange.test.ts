import ExcelJS from "exceljs"
import { describe, expect, it, vi } from "vitest"
import {
  createPlatformEmployeeImportTemplate,
  executePlatformEmployeeImport,
  MAX_PLATFORM_EMPLOYEE_IMPORT_ROWS,
  MAX_PLATFORM_IMPORT_BYTES,
  PLATFORM_EMPLOYEE_IMPORT_COLUMNS,
  PLATFORM_EXPORT_COLUMNS,
  parsePlatformEmployeeImportWorkbook,
  PlatformWorkbookError,
  writePlatformEmployeeImportReport,
  writePlatformExportWorkbook,
  type PlatformEmployeeImporter,
  type PlatformExportResource,
} from "../src/platform-exchange.ts"

const departmentId = "d1cc485a-b8f3-44da-899a-18414fcbca04"
const postId = "7461ce1f-03d3-4924-b2be-a3776cc1e649"
const roleId = "3710318b-7cf7-4ed8-8b21-b155324ad37c"

async function importWorkbook(rows: ExcelJS.CellValue[][]) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Employees")
  sheet.addRow([...PLATFORM_EMPLOYEE_IMPORT_COLUMNS])
  sheet.addRows(rows)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

async function readWorkbook(input: Buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Uint8Array.from(input).buffer)
  return workbook
}

function workbookError(code: PlatformWorkbookError["code"]) {
  return expect.objectContaining({ name: "PlatformWorkbookError", code })
}

describe("platform employee XLSX", () => {
  it("creates a real XLSX template with fixed columns, instructions and column validations", async () => {
    const input = await createPlatformEmployeeImportTemplate()
    expect(input.subarray(0, 2).toString()).toBe("PK")
    const workbook = await readWorkbook(input)
    const employees = workbook.getWorksheet("Employees")!
    expect(employees.getRow(1).values).toEqual([
      undefined,
      ...PLATFORM_EMPLOYEE_IMPORT_COLUMNS,
    ])
    expect(employees.getCell("A2").dataValidation).toMatchObject({
      type: "textLength",
      formulae: [1, 200],
    })
    expect(employees.getCell("E10001").dataValidation).toMatchObject({
      type: "textLength",
      formulae: [0, 3699],
    })
    expect(workbook.getWorksheet("Instructions")!.getCell("B3").text).toContain(
      "10000"
    )
    expect(employees.getRow(1).values).not.toContain("password")
    expect(await parsePlatformEmployeeImportWorkbook(input)).toEqual({
      rows: [],
    })
  }, 15_000)

  it("roundtrips valid employees with normalized email, optional department and comma-separated IDs", async () => {
    const input = await importWorkbook([
      [
        "  Alice  ",
        "ALICE@EXAMPLE.COM",
        departmentId,
        `${postId}, ${roleId}`,
        roleId,
      ],
      ["Bob", "bob@example.com", null, "", null],
    ])
    expect(await parsePlatformEmployeeImportWorkbook(input)).toEqual({
      rows: [
        {
          rowNumber: 2,
          status: "valid",
          employee: {
            name: "Alice",
            email: "alice@example.com",
            departmentId,
            postIds: [postId, roleId],
            roleIds: [roleId],
          },
        },
        {
          rowNumber: 3,
          status: "valid",
          employee: {
            name: "Bob",
            email: "bob@example.com",
            departmentId: null,
            postIds: [],
            roleIds: [],
          },
        },
      ],
    })
  })

  it("keeps each non-empty spreadsheet row and reports all field errors without source values", async () => {
    const input = await importWorkbook([
      ["Alice", "alice@example.com"],
      [],
      ["", "not-an-email", "not-an-id", `${postId},${postId}`, "wrong"],
      ["Bad number", 123],
      ["", "", "", "", ""],
      [" ", "  "],
    ])
    const result = await parsePlatformEmployeeImportWorkbook(input)
    expect(result.rows.map((row) => row.rowNumber)).toEqual([2, 4, 5])
    expect(result.rows[1]).toEqual({
      rowNumber: 4,
      status: "invalid",
      errors: [
        { column: "name", code: "REQUIRED" },
        { column: "email", code: "INVALID_EMAIL" },
        { column: "departmentId", code: "INVALID_ID" },
        { column: "postIds", code: "DUPLICATE_ID" },
        { column: "roleIds", code: "INVALID_ID" },
      ],
    })
    expect(result.rows[2]).toMatchObject({
      status: "invalid",
      errors: expect.arrayContaining([
        { column: "email", code: "INVALID_TEXT" },
      ]),
    })
    expect(JSON.stringify(result.rows[1])).not.toContain("not-an-email")
  })

  it("rejects every row for a duplicate email independent of case", async () => {
    const result = await parsePlatformEmployeeImportWorkbook(
      await importWorkbook([
        ["Alice", "Alice@example.com"],
        ["Again", "alice@EXAMPLE.com"],
      ])
    )
    expect(result.rows).toEqual(
      [2, 3].map((rowNumber) => ({
        rowNumber,
        status: "invalid",
        errors: [{ column: "email", code: "DUPLICATE_EMAIL" }],
      }))
    )
  })

  it("rejects formulas even when Excel supplies a valid cached result, plus hyperlinks and rich text", async () => {
    const input = await importWorkbook([
      [{ formula: '"Alice"', result: "Alice" }, "alice@example.com"],
      ["Bob", { formula: '"bob@example.com"', result: "bob@example.com" }],
      ["Link", { text: "link@example.com", hyperlink: "https://example.com" }],
      [{ richText: [{ text: "Rich" }] }, "rich@example.com"],
    ])
    const result = await parsePlatformEmployeeImportWorkbook(input)
    expect(result.rows.every((row) => row.status === "invalid")).toBe(true)
    expect(result.rows[0]).toMatchObject({
      errors: expect.arrayContaining([
        { column: "name", code: "FORMULA_NOT_ALLOWED" },
      ]),
    })
    expect(result.rows[1]).toMatchObject({
      errors: expect.arrayContaining([
        { column: "email", code: "FORMULA_NOT_ALLOWED" },
      ]),
    })
    expect(result.rows[2]).toMatchObject({
      errors: expect.arrayContaining([
        { column: "email", code: "INVALID_TEXT" },
      ]),
    })
    expect(result.rows[3]).toMatchObject({
      errors: expect.arrayContaining([
        { column: "name", code: "INVALID_TEXT" },
      ]),
    })
  })

  it("bounds IDs per column and text length", async () => {
    const result = await parsePlatformEmployeeImportWorkbook(
      await importWorkbook([
        [
          "x".repeat(201),
          "alice@example.com",
          "",
          Array(101).fill(postId).join(","),
          "",
        ],
      ])
    )
    expect(result.rows[0]).toMatchObject({
      status: "invalid",
      errors: expect.arrayContaining([
        { column: "name", code: "INVALID_TEXT" },
        { column: "postIds", code: "TOO_MANY_IDS" },
      ]),
    })
  })

  it("rejects unrecognized headers and extra data columns rather than discarding their values", async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Employees")
    sheet.addRow([...PLATFORM_EMPLOYEE_IMPORT_COLUMNS, "password"])
    await expect(
      parsePlatformEmployeeImportWorkbook(
        Buffer.from(await workbook.xlsx.writeBuffer())
      )
    ).rejects.toEqual(workbookError("INVALID_HEADERS"))
    sheet.getRow(1).getCell(6).value = null
    sheet.addRow(["Alice", "alice@example.com", "", "", "", "private-password"])
    await expect(
      parsePlatformEmployeeImportWorkbook(
        Buffer.from(await workbook.xlsx.writeBuffer())
      )
    ).rejects.toEqual(workbookError("INVALID_HEADERS"))
  })

  it("rejects wrong or extra worksheets, invalid file formats and oversized buffers with stable errors", async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet("Wrong")
    await expect(
      parsePlatformEmployeeImportWorkbook(
        Buffer.from(await workbook.xlsx.writeBuffer())
      )
    ).rejects.toEqual(workbookError("INVALID_WORKSHEETS"))
    const sheet = workbook.addWorksheet("Employees")
    sheet.addRow([...PLATFORM_EMPLOYEE_IMPORT_COLUMNS])
    await expect(
      parsePlatformEmployeeImportWorkbook(
        Buffer.from(await workbook.xlsx.writeBuffer())
      )
    ).rejects.toEqual(workbookError("INVALID_WORKSHEETS"))
    await expect(
      parsePlatformEmployeeImportWorkbook(
        Buffer.from("name,email\nAlice,alice@example.com")
      )
    ).rejects.toEqual(workbookError("INVALID_XLSX"))
    await expect(
      parsePlatformEmployeeImportWorkbook(
        Buffer.alloc(MAX_PLATFORM_IMPORT_BYTES + 1)
      )
    ).rejects.toEqual(workbookError("WORKBOOK_TOO_LARGE"))
  })

  it("rejects rows past the documented limit without truncating", async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Employees")
    sheet.addRow([...PLATFORM_EMPLOYEE_IMPORT_COLUMNS])
    sheet.getCell(MAX_PLATFORM_EMPLOYEE_IMPORT_ROWS + 2, 1).value =
      "Last employee"
    await expect(
      parsePlatformEmployeeImportWorkbook(
        Buffer.from(await workbook.xlsx.writeBuffer())
      )
    ).rejects.toEqual(workbookError("TOO_MANY_ROWS"))
  })

  it("runs injected formal writes only for valid rows and creates a report containing no employee inputs", async () => {
    const parsed = await parsePlatformEmployeeImportWorkbook(
      await importWorkbook([
        ["Alice", "alice@example.com"],
        ["Invalid", "private-input"],
        ["Bob", "bob@example.com"],
        ["Carol", "carol@example.com"],
        ["Dan", "dan@example.com"],
        ["Eve", "eve@example.com"],
      ])
    )
    const importer = vi
      .fn<PlatformEmployeeImporter>()
      .mockResolvedValueOnce({ status: "created" })
      .mockResolvedValueOnce({ status: "updated" })
      .mockResolvedValueOnce({ status: "granted" })
      .mockResolvedValueOnce({ status: "skipped" })
      .mockResolvedValueOnce({ status: "failed", code: "DEPARTMENT_NOT_FOUND" })
    const report = await executePlatformEmployeeImport(parsed, importer)
    expect(importer).toHaveBeenCalledTimes(5)
    expect(importer.mock.calls.map((call) => call[1])).toEqual([2, 4, 5, 6, 7])
    expect(report.rows.map((row) => row.status)).toEqual([
      "created",
      "invalid",
      "updated",
      "granted",
      "skipped",
      "failed",
    ])
    const workbook = await readWorkbook(
      await writePlatformEmployeeImportReport(report)
    )
    const sheet = workbook.getWorksheet("Import report")!
    expect(sheet.rowCount).toBe(7)
    expect(sheet.getRow(3).values).toEqual([
      undefined,
      3,
      "invalid",
      "email:INVALID_EMAIL",
    ])
    expect(sheet.getRow(7).values).toEqual([
      undefined,
      7,
      "failed",
      "DEPARTMENT_NOT_FOUND",
    ])
    const values = JSON.stringify(sheet.getSheetValues())
    for (const secret of [
      "alice@example.com",
      "Alice",
      "private-input",
      "password",
    ])
      expect(values).not.toContain(secret)
  })

  it("stops on a revoked authorization or infrastructure error without writing exception text to a report", async () => {
    const parsed = await parsePlatformEmployeeImportWorkbook(
      await importWorkbook([
        ["Alice", "alice@example.com"],
        ["Bob", "bob@example.com"],
      ])
    )
    const error = new Error("authorization revoked; password=never-report-this")
    const importer = vi.fn<PlatformEmployeeImporter>().mockRejectedValue(error)
    await expect(executePlatformEmployeeImport(parsed, importer)).rejects.toBe(
      error
    )
    expect(importer).toHaveBeenCalledTimes(1)
  })
})

describe("platform list XLSX export", () => {
  it.each(Object.keys(PLATFORM_EXPORT_COLUMNS) as PlatformExportResource[])(
    "exports only the complete approved column set for %s",
    async (resource) => {
      const row: Record<string, unknown> = {}
      for (const column of PLATFORM_EXPORT_COLUMNS[resource]) {
        const parts = column.split(".")
        if (parts.length === 1) row[column] = `approved:${column}`
        else {
          const parent = (row[parts[0]] ??= {}) as Record<string, unknown>
          parent[parts[1]] = `approved:${column}`
          parent.email = "nested-private@example.com"
          parent.passwordHash = "nested-secret"
        }
      }
      Object.assign(row, {
        email: "private@example.com",
        rawEmail: "private@example.com",
        password: "secret-password",
        passwordHash: "secret-hash",
        token: "secret-token",
        secret: "secret",
      })
      const input = await writePlatformExportWorkbook(resource, [row])
      expect(input.subarray(0, 2).toString()).toBe("PK")
      const workbook = await readWorkbook(input)
      const sheet = workbook.getWorksheet("Export")!
      expect(sheet.getRow(1).values).toEqual([
        undefined,
        ...PLATFORM_EXPORT_COLUMNS[resource],
      ])
      expect(sheet.getRow(2).values).toEqual([
        undefined,
        ...PLATFORM_EXPORT_COLUMNS[resource].map(
          (column) => `approved:${column}`
        ),
      ])
      const values = JSON.stringify(sheet.getSheetValues())
      for (const secret of [
        "private@example.com",
        "secret-password",
        "secret-hash",
        "secret-token",
        "nested-secret",
      ])
        expect(values).not.toContain(secret)
    }
  )

  it("retains masked email for employee, account, session and login exports", async () => {
    for (const resource of [
      "employees",
      "users",
      "sessions",
      "login-events",
    ] as const) {
      const workbook = await readWorkbook(
        await writePlatformExportWorkbook(resource, [
          { maskedEmail: "a***@example.com", email: "alice@example.com" },
        ])
      )
      const sheet = workbook.getWorksheet("Export")!
      const column =
        PLATFORM_EXPORT_COLUMNS[resource].indexOf("maskedEmail") + 1
      expect(sheet.getCell(2, column).value).toBe("a***@example.com")
      expect(JSON.stringify(sheet.getSheetValues())).not.toContain(
        "alice@example.com"
      )
    }
  })

  it("writes formula-looking text as literal strings and keeps primitive and array projections", async () => {
    const workbook = await readWorkbook(
      await writePlatformExportWorkbook("roles", [
        {
          name: '=HYPERLINK("https://example.com", "Click")',
          key: "+1+1",
          status: "@SUM(A1)",
          sort: 42,
          builtIn: false,
          permissions: ["platform.employee:read", "platform.role:read"],
          createdAt: null,
        },
      ])
    )
    const sheet = workbook.getWorksheet("Export")!
    expect(sheet.getCell("C2").value).toBe(
      '=HYPERLINK("https://example.com", "Click")'
    )
    expect(sheet.getCell("C2").type).toBe(ExcelJS.ValueType.String)
    expect(sheet.getCell("E2").value).toBe(42)
    expect(sheet.getCell("H2").value).toBe(false)
    expect(sheet.getCell("I2").value).toBe(
      "platform.employee:read,platform.role:read"
    )
  })

  it("rejects arbitrary nested objects and formula objects in approved columns", async () => {
    await expect(
      writePlatformExportWorkbook("employees", [
        { postIds: [{ email: "private@example.com" }] },
      ])
    ).rejects.toEqual(workbookError("INVALID_EXPORT_VALUE"))
    await expect(
      writePlatformExportWorkbook("users", [
        { name: { formula: "1+1", result: 2 } },
      ])
    ).rejects.toEqual(workbookError("INVALID_EXPORT_VALUE"))
    await expect(
      writePlatformExportWorkbook("parameters", [{ value: "a".repeat(32_768) }])
    ).rejects.toEqual(workbookError("EXPORT_CELL_TOO_LONG"))
    await expect(
      writePlatformExportWorkbook("posts", [{ sort: Number.NaN }])
    ).rejects.toEqual(workbookError("INVALID_EXPORT_VALUE"))
  })

  it("supports an empty filtered result and rejects values beyond the worksheet row bound", async () => {
    const workbook = await readWorkbook(
      await writePlatformExportWorkbook("users", [])
    )
    expect(workbook.getWorksheet("Export")!.rowCount).toBe(1)
    const tooManyRows = new Array<Readonly<Record<string, unknown>>>(1_048_576)
    await expect(
      writePlatformExportWorkbook("users", tooManyRows)
    ).rejects.toEqual(workbookError("TOO_MANY_ROWS"))
  })
})
