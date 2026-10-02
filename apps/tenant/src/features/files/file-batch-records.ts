import { z } from "zod"
import {
  FileBatchActionSchema,
  FileBatchIdSchema,
  FileOperationIdSchema,
} from "@workspace/contracts"

export const fileBatchRecordSchema = z.strictObject({
  batchId: FileBatchIdSchema,
  itemOperationIds: z.array(FileOperationIdSchema).min(1).max(100),
  action: FileBatchActionSchema,
  phase: z.enum([
    "submitting",
    "processing",
    "pending",
    "settled",
    "unconfirmed",
    "unavailable",
  ]),
  submitted: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type FileBatchRecord = z.infer<typeof fileBatchRecordSchema>
export const fileBatchRecordKey = (scope: string) => `files:batch:${scope}`

export function readFileBatchRecords(scope: string): FileBatchRecord[] {
  const stored = sessionStorage.getItem(fileBatchRecordKey(scope))
  if (!stored) return []
  const value = z.array(fileBatchRecordSchema).parse(JSON.parse(stored))
  return value
}
export function saveFileBatchRecord(scope: string, record: FileBatchRecord) {
  const safe = fileBatchRecordSchema.parse(record)
  const records = readFileBatchRecords(scope)
  const index = records.findIndex((item) => item.batchId === safe.batchId)
  if (index === -1) records.push(safe)
  else records[index] = safe
  // 禁止把选择条目、名称、路径、revision、目的地或请求正文写入浏览器持久记录。
  sessionStorage.setItem(fileBatchRecordKey(scope), JSON.stringify(records))
  return records
}
