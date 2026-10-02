import { z } from "zod"
import {
  FileOperationIdSchema,
  FileOperationPhaseSchema,
} from "@workspace/contracts"

const uploadRecordSchema = z.strictObject({
  id: FileOperationIdSchema,
  action: z.enum(["upload", "overwrite"]),
  phase: z.enum([
    "queued",
    "hashing",
    "unconfirmed",
    ...FileOperationPhaseSchema.options,
  ]),
  submitted: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
const uploadRecordsSchema = z.array(uploadRecordSchema)
export type FileUploadRecord = z.infer<typeof uploadRecordSchema>

export function uploadRecordKey(userId: string, organizationId: string) {
  return `enterprise-admin:file-uploads:${JSON.stringify([userId, organizationId])}`
}
export function readUploadRecords(
  storage: Storage,
  key: string
): FileUploadRecord[] {
  const saved = storage.getItem(key)
  return saved === null ? [] : uploadRecordsSchema.parse(JSON.parse(saved))
}
export function saveUploadRecords(
  storage: Storage,
  key: string,
  records: FileUploadRecord[]
) {
  // 原 File、名称、层级和内容指纹只存在于内存；刷新后只能按已保存的操作身份读取正式事实。
  storage.setItem(key, JSON.stringify(uploadRecordsSchema.parse(records)))
}
