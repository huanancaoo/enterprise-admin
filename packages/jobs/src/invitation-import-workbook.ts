import ExcelJS from "exceljs"
import { z } from "zod"
import {
  ORGANIZATION_INVITATION_IMPORT_MAX_BYTES,
  ORGANIZATION_INVITATION_IMPORT_MAX_ROWS,
  type InvitationImportReport,
} from "@workspace/contracts"

export type InvitationImportSourceRow = {
  row: number
  email: string
  plannedCode: "INVALID_EMAIL" | "DUPLICATE_IN_FILE" | null
}
export type InvitationWorkbookResult = {
  rows: InvitationImportSourceRow[]
  fileError?: InvitationImportReport["fileError"]
}
export async function invitationImportTemplate() {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet("Invitations")
  sheet.columns = [{ header: "email", key: "email", width: 42 }]
  sheet.getRow(1).font = { bold: true }
  return Buffer.from(await book.xlsx.writeBuffer())
}
export async function parseInvitationImportWorkbook(
  bytes: Buffer
): Promise<InvitationWorkbookResult> {
  if (
    !bytes.length ||
    bytes.byteLength > ORGANIZATION_INVITATION_IMPORT_MAX_BYTES
  )
    return { rows: [], fileError: "INVALID_FILE" }
  const book = new ExcelJS.Workbook()
  try {
    await book.xlsx.load(Uint8Array.from(bytes).buffer)
  } catch {
    return { rows: [], fileError: "INVALID_FILE" }
  }
  if (book.worksheets.length !== 1)
    return { rows: [], fileError: "INVALID_WORKSHEET_COUNT" }
  const sheet = book.worksheets[0]
  if (sheet.getRow(1).cellCount !== 1 || sheet.getCell(1, 1).value !== "email")
    return { rows: [], fileError: "INVALID_COLUMNS" }
  if (sheet.rowCount > ORGANIZATION_INVITATION_IMPORT_MAX_ROWS + 1)
    return { rows: [], fileError: "TOO_MANY_ROWS" }
  const rows: InvitationImportSourceRow[] = []
  const emails = new Set<string>()
  for (let row = 2; row <= sheet.rowCount; row++) {
    const source = sheet.getRow(row)
    let extra = false
    let hasData = false
    source.eachCell((cell, column) => {
      const present =
        cell.value !== null && cell.value !== undefined && cell.value !== ""
      if (present) hasData = true
      if (column > 1 && present) extra = true
    })
    if (extra) return { rows: [], fileError: "INVALID_COLUMNS" }
    if (!hasData) continue
    // 公式、超链接或富文本不是邮箱文本，不能把缓存值当作用户的明确邀请输入。
    const cell = source.getCell(1).value
    const email = typeof cell === "string" ? cell.trim().toLowerCase() : ""
    const valid = z.email().safeParse(email).success
    const plannedCode = !valid
      ? "INVALID_EMAIL"
      : emails.has(email)
        ? "DUPLICATE_IN_FILE"
        : null
    if (valid) emails.add(email)
    rows.push({ row, email, plannedCode })
  }
  return rows.length ? { rows } : { rows: [], fileError: "EMPTY_FILE" }
}
