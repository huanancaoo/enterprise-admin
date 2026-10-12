import ExcelJS from "exceljs"
import { parse } from "csv-parse/sync"
import { z } from "zod"
import {
  SupportedLocaleSchema,
  type CreateProjectImport,
  type ImportIssue,
} from "@workspace/contracts"

const rowSchema = z.strictObject({
  name: z.string().trim().min(1),
  description: z.string().nullable(),
  contentLocale: SupportedLocaleSchema,
})
export async function decodeProjectImport(input: CreateProjectImport) {
  const bytes = Buffer.from(input.contentBase64, "base64")
  let cells: unknown[][]
  let sourceRows: number[]
  try {
    if (input.format === "csv") {
      const decoded: unknown = parse(bytes, {
        bom: true,
        skip_empty_lines: true,
        info: true,
      })
      const records = z
        .array(
          z.object({
            record: z.array(z.string()),
            info: z.object({
              lines: z.number().int().positive(),
              empty_lines: z.number().int().nonnegative(),
            }),
          })
        )
        .parse(decoded)
      let previousEndLine = 0
      let previousEmptyLines = 0
      // 行号指原 CSV 记录的起始文本行，包含跳过的空行及引号字段内的换行。
      sourceRows = records.map(({ info }) => {
        const start =
          previousEndLine + 1 + info.empty_lines - previousEmptyLines
        previousEndLine = info.lines
        previousEmptyLines = info.empty_lines
        return start
      })
      cells = records.map(({ record }) => record)
    } else {
      const workbook = new ExcelJS.Workbook()
      // Node Buffer 可能共享更大的内存池；解码器只接收这份文件的实际字节区间。
      await workbook.xlsx.load(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        )
      )
      const [sheet] = workbook.worksheets
      // 单文件代表完整批次，额外工作表不能被忽略并冒充全部成功。
      if (!sheet || workbook.worksheets.length !== 1)
        return {
          rows: [],
          issues: [
            { row: 1, field: "file", code: "INVALID_WORKSHEET_COUNT" },
          ] satisfies ImportIssue[],
        }
      cells = Array.from({ length: sheet.rowCount }, (_, index) =>
        Array.from(
          { length: sheet.columnCount },
          (_, column) => sheet.getRow(index + 1).getCell(column + 1).value
        )
      )
      sourceRows = cells.map((_, index) => index + 1)
    }
  } catch {
    // 捕获范围仅是文件解码；数据库或业务执行异常不能被改写成用户输入错误。
    return {
      rows: [],
      issues: [
        { row: 1, field: "file", code: "INVALID_FILE" },
      ] satisfies ImportIssue[],
    }
  }
  const columns = ["name", "description", "contentLocale"] as const
  const header = cells[0]
  if (
    !header ||
    header.length !== 3 ||
    columns.some((column) => !header.includes(column))
  )
    return {
      rows: [],
      issues: [
        { row: sourceRows[0] ?? 1, field: "file", code: "INVALID_COLUMNS" },
      ] satisfies ImportIssue[],
    }
  const issues: ImportIssue[] = []
  const rows: z.infer<typeof rowSchema>[] = []
  for (const [index, cellsRow] of cells.slice(1).entries()) {
    const value = Object.fromEntries(
      columns.map((column) => {
        const cell = cellsRow[header.indexOf(column)]
        return [
          column,
          column === "description" &&
          (cell === "" || cell === undefined || cell === null)
            ? null
            : cell,
        ]
      })
    )
    const row = rowSchema.safeParse(value)
    if (row.success) rows.push(row.data)
    else
      for (const issue of row.error.issues) {
        const field = issue.path[0]
        if (
          field === "name" ||
          field === "description" ||
          field === "contentLocale"
        )
          issues.push({
            row: sourceRows[index + 1]!,
            field,
            code:
              field === "name"
                ? "INVALID_NAME"
                : field === "description"
                  ? "INVALID_DESCRIPTION"
                  : "INVALID_LOCALE",
          })
      }
  }
  return { rows, issues }
}
