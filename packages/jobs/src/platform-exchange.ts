import ExcelJS from "exceljs"
import { z } from "zod"

export const PLATFORM_XLSX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
export const MAX_PLATFORM_EMPLOYEE_IMPORT_ROWS = 10_000
export const MAX_PLATFORM_IMPORT_BYTES = 10 * 1024 * 1024
export const MAX_PLATFORM_EXPORT_ROWS = 1_048_575
export const PLATFORM_EMPLOYEE_IMPORT_COLUMNS = [
  "name",
  "email",
  "departmentId",
  "postIds",
  "roleIds",
] as const

export type PlatformEmployeeImportColumn =
  (typeof PLATFORM_EMPLOYEE_IMPORT_COLUMNS)[number]
export type PlatformEmployeeImportIssueCode =
  | "REQUIRED"
  | "INVALID_TEXT"
  | "INVALID_EMAIL"
  | "INVALID_ID"
  | "TOO_MANY_IDS"
  | "DUPLICATE_ID"
  | "DUPLICATE_EMAIL"
  | "FORMULA_NOT_ALLOWED"
export type PlatformEmployeeImportIssue = {
  column: PlatformEmployeeImportColumn
  code: PlatformEmployeeImportIssueCode
}
export type PlatformEmployeeImportRow = {
  name: string
  email: string
  departmentId: string | null
  postIds: string[]
  roleIds: string[]
}
export type PlatformEmployeeImportParsedRow =
  | {
      rowNumber: number
      status: "valid"
      employee: PlatformEmployeeImportRow
    }
  | {
      rowNumber: number
      status: "invalid"
      errors: PlatformEmployeeImportIssue[]
    }
export type PlatformEmployeeImportParseResult = {
  rows: PlatformEmployeeImportParsedRow[]
}
export type PlatformEmployeeImportFailureCode =
  | "EMPLOYEE_EXISTS"
  | "ACCOUNT_NOT_VERIFIED"
  | "ACCOUNT_SUSPENDED"
  | "ASSIGNMENT_INACTIVE"
  | "DEPARTMENT_NOT_FOUND"
  | "POST_NOT_FOUND"
  | "ROLE_NOT_FOUND"
  | "ASSIGNMENT_NOT_ALLOWED"
  | "VERSION_CONFLICT"
  | "INVALID_ASSIGNMENT"
export type PlatformEmployeeImportOutcome =
  | { status: "created" | "updated" | "granted" | "skipped" }
  | { status: "failed"; code: PlatformEmployeeImportFailureCode }
export type PlatformEmployeeImportReportRow = {
  rowNumber: number
  status: PlatformEmployeeImportOutcome["status"] | "invalid"
  codes: string[]
}
export type PlatformEmployeeImportReport = {
  rows: PlatformEmployeeImportReportRow[]
}
export type PlatformEmployeeImporter = (
  employee: PlatformEmployeeImportRow,
  rowNumber: number
) => Promise<PlatformEmployeeImportOutcome>

export class PlatformWorkbookError extends Error {
  constructor(
    readonly code:
      | "INVALID_XLSX"
      | "WORKBOOK_TOO_LARGE"
      | "INVALID_WORKSHEETS"
      | "INVALID_HEADERS"
      | "TOO_MANY_ROWS"
      | "INVALID_EXPORT_VALUE"
      | "EXPORT_CELL_TOO_LONG"
  ) {
    super(code)
    this.name = "PlatformWorkbookError"
  }
}

const uuid = z.uuid()
const email = z.email().max(254)
const importSheetName = "Employees"
const instructionsSheetName = "Instructions"

function workbookSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  keys: readonly string[]
) {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1 }],
  })
  sheet.columns = keys.map((key) => ({ header: key, key, width: 28 }))
  sheet.getRow(1).font = { bold: true }
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: keys.length },
  }
  return sheet
}

async function workbookBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function createPlatformEmployeeImportTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbookSheet(
    workbook,
    importSheetName,
    PLATFORM_EMPLOYEE_IMPORT_COLUMNS
  )
  const instructions = workbook.addWorksheet(instructionsSheetName)
  instructions.columns = [{ width: 24 }, { width: 100 }]
  instructions.addRows([
    ["项目", "填写规则"],
    [
      "工作表",
      `在 ${importSheetName} 填写数据，保留第一行的五个列名及顺序；不添加其他数据工作表。`,
    ],
    [
      "限制",
      `最多 ${MAX_PLATFORM_EMPLOYEE_IMPORT_ROWS} 行数据，文件最多 ${MAX_PLATFORM_IMPORT_BYTES / 1024 / 1024} MiB；超限整份拒绝，不截断。`,
    ],
    ["name", "必填姓名，1–200 字符。"],
    [
      "email",
      "必填邮箱，按邮箱匹配员工；同一批中不可重复，导入时统一转为小写。",
    ],
    ["departmentId", "可空；填写平台部门 UUID。"],
    [
      "postIds",
      "可空；填写平台岗位 UUID，多值用英文逗号分隔，最多 100 个且不可重复。",
    ],
    [
      "roleIds",
      "可空；填写平台角色 UUID，多值用英文逗号分隔，最多 100 个且不可重复。",
    ],
    [
      "密码",
      "不要在工作簿中填写密码。每批初始密码在提交导入时单独输入，仅用于新建账号。",
    ],
    [
      "已有员工",
      "是否更新由提交时的“更新已有员工”选项决定；导入不会改变账号邮箱。",
    ],
    [
      "单元格",
      "仅接受文本。公式（包括带缓存结果的公式）、超链接及其他对象单元格会被逐行拒绝。空白行忽略。",
    ],
    ["报告", "每个非空数据行对应一条结果，仅包含行号、状态及稳定错误码。"],
  ])
  instructions.getRow(1).font = { bold: true }
  for (let row = 2; row <= MAX_PLATFORM_EMPLOYEE_IMPORT_ROWS + 1; row += 1) {
    for (
      let column = 1;
      column <= PLATFORM_EMPLOYEE_IMPORT_COLUMNS.length;
      column += 1
    ) {
      const cell = sheet.getCell(row, column)
      cell.numFmt = "@"
      cell.dataValidation = {
        type: "textLength",
        operator: "between",
        allowBlank: column > 2,
        formulae: [
          column > 2 ? 0 : 1,
          column === 1 ? 200 : column === 2 ? 254 : column === 3 ? 36 : 3699,
        ],
        showErrorMessage: true,
        errorTitle: "填写内容不符合列限制",
        error: "请按 Instructions 工作表填写。导入时还会校验邮箱和 UUID。",
      }
    }
  }
  return workbookBuffer(workbook)
}

function importCellText(
  cell: ExcelJS.Cell,
  column: PlatformEmployeeImportColumn,
  errors: PlatformEmployeeImportIssue[]
): string {
  if (cell.value === null || cell.value === undefined) return ""
  if (typeof cell.value === "string") return cell.value.trim()
  errors.push({
    column,
    code:
      cell.type === ExcelJS.ValueType.Formula
        ? "FORMULA_NOT_ALLOWED"
        : "INVALID_TEXT",
  })
  return ""
}

function importIds(
  value: string,
  column: "postIds" | "roleIds",
  errors: PlatformEmployeeImportIssue[]
): string[] {
  if (!value) return []
  const ids = value.split(",").map((item) => item.trim())
  if (ids.length > 100) errors.push({ column, code: "TOO_MANY_IDS" })
  if (ids.some((id) => !uuid.safeParse(id).success))
    errors.push({ column, code: "INVALID_ID" })
  if (new Set(ids).size !== ids.length)
    errors.push({ column, code: "DUPLICATE_ID" })
  return ids
}

export async function parsePlatformEmployeeImportWorkbook(
  input: Buffer
): Promise<PlatformEmployeeImportParseResult> {
  if (input.byteLength > MAX_PLATFORM_IMPORT_BYTES)
    throw new PlatformWorkbookError("WORKBOOK_TOO_LARGE")
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(Uint8Array.from(input).buffer)
  } catch {
    // 库错误可能带出工作簿内容，任务和报告只保留固定错误码。
    throw new PlatformWorkbookError("INVALID_XLSX")
  }
  const sheet = workbook.getWorksheet(importSheetName)
  if (
    !sheet ||
    workbook.worksheets.some(
      (item) => ![importSheetName, instructionsSheetName].includes(item.name)
    )
  ) {
    throw new PlatformWorkbookError("INVALID_WORKSHEETS")
  }
  if (
    sheet.getRow(1).cellCount !== PLATFORM_EMPLOYEE_IMPORT_COLUMNS.length ||
    PLATFORM_EMPLOYEE_IMPORT_COLUMNS.some(
      (column, index) => sheet.getCell(1, index + 1).value !== column
    )
  )
    throw new PlatformWorkbookError("INVALID_HEADERS")
  if (sheet.rowCount > MAX_PLATFORM_EMPLOYEE_IMPORT_ROWS + 1)
    throw new PlatformWorkbookError("TOO_MANY_ROWS")
  const rows: PlatformEmployeeImportParsedRow[] = []
  const emailRows = new Map<string, number[]>()
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    let hasData = false
    row.eachCell((cell) => {
      if (
        typeof cell.value === "string"
          ? cell.value.trim() !== ""
          : cell.value !== null && cell.value !== undefined
      )
        hasData = true
    })
    if (!hasData) continue
    const errors: PlatformEmployeeImportIssue[] = []
    const cells = Object.fromEntries(
      PLATFORM_EMPLOYEE_IMPORT_COLUMNS.map((column, index) => [
        column,
        importCellText(row.getCell(index + 1), column, errors),
      ])
    ) as Record<PlatformEmployeeImportColumn, string>
    // 五列之外的内容不能静默丢弃；模板不允许夹带密码等额外列。
    row.eachCell((cell, columnNumber) => {
      if (
        columnNumber > PLATFORM_EMPLOYEE_IMPORT_COLUMNS.length &&
        (typeof cell.value === "string"
          ? cell.value.trim() !== ""
          : cell.value !== null && cell.value !== undefined)
      )
        throw new PlatformWorkbookError("INVALID_HEADERS")
    })
    if (!cells.name) errors.push({ column: "name", code: "REQUIRED" })
    else if (cells.name.length > 200)
      errors.push({ column: "name", code: "INVALID_TEXT" })
    if (!cells.email) errors.push({ column: "email", code: "REQUIRED" })
    else if (!email.safeParse(cells.email).success)
      errors.push({ column: "email", code: "INVALID_EMAIL" })
    if (cells.departmentId && !uuid.safeParse(cells.departmentId).success)
      errors.push({ column: "departmentId", code: "INVALID_ID" })
    const employee: PlatformEmployeeImportRow = {
      name: cells.name,
      email: cells.email.toLowerCase(),
      departmentId: cells.departmentId || null,
      postIds: importIds(cells.postIds, "postIds", errors),
      roleIds: importIds(cells.roleIds, "roleIds", errors),
    }
    if (email.safeParse(employee.email).success) {
      const matches = emailRows.get(employee.email) ?? []
      matches.push(rows.length)
      emailRows.set(employee.email, matches)
    }
    rows.push(
      errors.length
        ? { rowNumber, status: "invalid", errors }
        : { rowNumber, status: "valid", employee }
    )
  }
  // 重复邮箱的全部行一起拒绝，避免工作簿行顺序决定某位员工最终资料。
  for (const indexes of emailRows.values()) {
    if (indexes.length < 2) continue
    for (const index of indexes) {
      const row = rows[index]
      const issue: PlatformEmployeeImportIssue = {
        column: "email",
        code: "DUPLICATE_EMAIL",
      }
      rows[index] = {
        rowNumber: row.rowNumber,
        status: "invalid",
        errors: row.status === "invalid" ? [...row.errors, issue] : [issue],
      }
    }
  }
  return { rows }
}

export async function executePlatformEmployeeImport(
  parsed: PlatformEmployeeImportParseResult,
  importEmployee: PlatformEmployeeImporter
): Promise<PlatformEmployeeImportReport> {
  const rows: PlatformEmployeeImportReportRow[] = []
  for (const row of parsed.rows) {
    if (row.status === "invalid") {
      rows.push({
        rowNumber: row.rowNumber,
        status: "invalid",
        codes: row.errors.map((issue) => `${issue.column}:${issue.code}`),
      })
      continue
    }
    // 每行回调负责权威身份重验及正式员工入口；授权撤回或基础设施异常应中止整个任务。
    const outcome = await importEmployee(row.employee, row.rowNumber)
    rows.push({
      rowNumber: row.rowNumber,
      status: outcome.status,
      codes: outcome.status === "failed" ? [outcome.code] : [],
    })
  }
  return { rows }
}

export async function writePlatformEmployeeImportReport(
  report: PlatformEmployeeImportReport
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbookSheet(workbook, "Import report", [
    "rowNumber",
    "status",
    "codes",
  ])
  for (const row of report.rows)
    sheet.addRow([row.rowNumber, row.status, row.codes.join(",")])
  return workbookBuffer(workbook)
}

const catalogExportColumns = [
  "id",
  "key",
  "name",
  "status",
  "sort",
  "createdAt",
  "updatedAt",
] as const
export const PLATFORM_EXPORT_COLUMNS = {
  employees: [
    "userId",
    "name",
    "maskedEmail",
    "status",
    "departmentId",
    "postIds",
    "roleIds",
    "version",
    "lockedUntil",
    "failedAttempts",
    "createdAt",
  ],
  roles: [...catalogExportColumns, "builtIn", "permissions"],
  posts: catalogExportColumns,
  dictionaries: [...catalogExportColumns, "remark"],
  "dictionary-items": [
    "id",
    "dictionaryId",
    "value",
    "label",
    "status",
    "sort",
    "createdAt",
    "updatedAt",
  ],
  parameters: [...catalogExportColumns, "value", "remark"],
  users: [
    "userId",
    "name",
    "maskedEmail",
    "emailVerified",
    "createdAt",
    "organizationCount",
    "status",
    "version",
  ],
  organizations: [
    "id",
    "name",
    "slug",
    "status",
    "createdAt",
    "memberCount",
    "version",
  ],
  "login-events": [
    "id",
    "userId",
    "name",
    "maskedEmail",
    "occurredAt",
    "method",
    "result",
    "reasonCode",
    "ipAddress",
    "userAgent",
  ],
  sessions: [
    "sessionId",
    "userId",
    "name",
    "maskedEmail",
    "createdAt",
    "updatedAt",
    "expiresAt",
    "ipAddress",
    "userAgent",
  ],
  "audit-events": [
    "id",
    "occurredAt",
    "scope",
    "targetOrganization.organizationId",
    "targetOrganization.name",
    "eventCode",
    "actorType",
    "actorId",
    "actorMaskedEmail",
    "resourceType",
    "resourceId",
    "result",
    "metadata.previousRole",
    "metadata.nextRole",
  ],
  menus: [
    ...catalogExportColumns,
    "parentId",
    "kind",
    "routeKey",
    "actionKey",
    "url",
    "icon",
    "hidden",
    "hasChildren",
  ],
  departments: [...catalogExportColumns, "parentId", "hasChildren"],
} as const
export type PlatformExportResource = keyof typeof PLATFORM_EXPORT_COLUMNS

function exportValue(
  row: Readonly<Record<string, unknown>>,
  path: string
): ExcelJS.CellValue {
  let value: unknown = row
  for (const key of path.split(".")) {
    if (value === null || value === undefined) return null
    if (typeof value !== "object" || Array.isArray(value))
      throw new PlatformWorkbookError("INVALID_EXPORT_VALUE")
    value = Object.hasOwn(value, key)
      ? (value as Record<string, unknown>)[key]
      : undefined
  }
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) {
    if (!value.every((item) => typeof item === "string"))
      throw new PlatformWorkbookError("INVALID_EXPORT_VALUE")
    value = value.join(",")
  }
  if (typeof value === "string") {
    if (value.length > 32_767)
      throw new PlatformWorkbookError("EXPORT_CELL_TOO_LONG")
    return value
  }
  if (
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return value
  // 禁止序列化任意对象，避免嵌套身份对象、公式对象或未获准 metadata 泄露。
  throw new PlatformWorkbookError("INVALID_EXPORT_VALUE")
}

export async function writePlatformExportWorkbook(
  resource: PlatformExportResource,
  rows: readonly Readonly<Record<string, unknown>>[]
): Promise<Buffer> {
  if (rows.length > MAX_PLATFORM_EXPORT_ROWS)
    throw new PlatformWorkbookError("TOO_MANY_ROWS")
  const workbook = new ExcelJS.Workbook()
  const columns = PLATFORM_EXPORT_COLUMNS[resource]
  const sheet = workbookSheet(workbook, "Export", columns)
  for (const row of rows)
    sheet.addRow(columns.map((column) => exportValue(row, column)))
  return workbookBuffer(workbook)
}
