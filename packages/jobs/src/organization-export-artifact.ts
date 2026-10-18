import { createWriteStream } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { finished } from "node:stream/promises"
import ExcelJS from "exceljs"
import { TaskPermanentError } from "./contract.ts"
import { MAX_PLATFORM_EXPORT_ROWS } from "./platform-exchange.ts"

// 这是两端共用的XLSX单表技术容量，包含一行表头时不能截断筛选结果。
export const MAX_ORGANIZATION_EXPORT_ROWS = MAX_PLATFORM_EXPORT_ROWS
export const ORGANIZATION_EXPORT_PAGE_SIZE = 1000

export function assertOrganizationExportCapacity(total: number) {
  if (total > MAX_ORGANIZATION_EXPORT_ROWS)
    throw new TaskPermanentError("TOO_MANY_ROWS")
}

export async function writeOrganizationExportArtifact(input: {
  title: string
  columns: string[]
  rows: AsyncIterable<readonly unknown[]>
  rowLimit?: number
}): Promise<{ count: number; contentBase64: string }> {
  const directory = await mkdtemp(join(tmpdir(), "organization-export-"))
  let output: ReturnType<typeof createWriteStream> | undefined
  let writer: ExcelJS.stream.xlsx.WorkbookWriter | undefined
  let settled: Promise<unknown> | undefined
  let finalizing = false
  try {
    const file = join(directory, "result.xlsx")
    output = createWriteStream(file, { flags: "wx", mode: 0o600 })
    // finished立即订阅error，避免文件打开失败发生在WorkbookWriter提交之前。
    settled = finished(output).then(
      () => undefined,
      (error: unknown) => error
    )
    writer = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: output,
      useStyles: false,
      useSharedStrings: false,
    })
    const sheet = writer.addWorksheet(input.title)
    sheet.addRow(input.columns).commit()
    let count = 0
    for await (const row of input.rows) {
      if (++count > (input.rowLimit ?? MAX_ORGANIZATION_EXPORT_ROWS))
        throw new TaskPermanentError("TOO_MANY_ROWS")
      // commit释放单行；禁用共享字符串表，否则唯一文本仍会随全集累积。
      sheet.addRow(row).commit()
    }
    finalizing = true
    await writer.commit()
    const error = await settled
    if (error) throw error
    return { count, contentBase64: await readFile(file, "base64") }
  } finally {
    // 生成器或容量校验失败时也结束ZIP流；临时的部分内容绝不提交为任务产物。
    if (writer && !finalizing) await writer.commit().catch(() => undefined)
    output?.destroy()
    await settled
    await rm(directory, { recursive: true, force: true })
  }
}
