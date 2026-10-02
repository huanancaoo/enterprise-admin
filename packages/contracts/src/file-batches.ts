import { z } from "zod"
import {
  FileEntryIdSchema,
  FileOperationIdSchema,
  FileOperationResponseSchema,
  FileOperationErrorCodeSchema,
  FileErrorDetailsSchema,
} from "./files.js"

export const FileBatchIdSchema = z.uuid()
const selection = z
  .array(
    z.strictObject({
      entryId: FileEntryIdSchema,
      expectedRevision: z.number().int().min(1).max(2_147_483_647),
      operationId: FileOperationIdSchema,
    })
  )
  .min(1)
  .max(100)
  .superRefine((items, context) => {
    if (
      new Set(items.map((item) => item.entryId)).size !== items.length ||
      new Set(items.map((item) => item.operationId)).size !== items.length
    )
      context.addIssue({
        code: "custom",
        message: "Selected entries and operation identities must be unique",
      })
  })
export const FileBatchActionSchema = z.enum([
  "move",
  "trash",
  "restore",
  "purge",
])
export const ExecuteFileBatchSchema = z
  .discriminatedUnion("action", [
    z.strictObject({
      batchId: FileBatchIdSchema,
      action: z.literal("move"),
      parentId: FileEntryIdSchema,
      items: selection,
    }),
    z.strictObject({
      batchId: FileBatchIdSchema,
      action: z.literal("trash"),
      items: selection,
    }),
    z.strictObject({
      batchId: FileBatchIdSchema,
      action: z.literal("restore"),
      parentId: FileEntryIdSchema.optional(),
      items: selection,
    }),
    z.strictObject({
      batchId: FileBatchIdSchema,
      action: z.literal("purge"),
      items: selection,
    }),
  ])
  .meta({ id: "ExecuteFileBatch" })
export type ExecuteFileBatch = z.infer<typeof ExecuteFileBatchSchema>
export const FileBatchItemResponseSchema = z
  .strictObject({
    index: z.number().int().min(0).max(99),
    entryId: FileEntryIdSchema,
    requestedOperationId: FileOperationIdSchema,
    rootIndex: z.number().int().min(0).max(99),
    operationId: FileOperationIdSchema,
    state: z.enum([
      "pending",
      "preparing",
      "committed",
      "cleaning",
      "completed",
      "failed",
      "covered",
      "unavailable",
    ]),
    operation: FileOperationResponseSchema.nullable(),
    error: z
      .strictObject({
        code: FileOperationErrorCodeSchema,
        details: FileErrorDetailsSchema.optional(),
      })
      .nullable(),
  })
  .meta({ id: "FileBatchItemResponse" })
export type FileBatchItemResponse = z.infer<typeof FileBatchItemResponseSchema>
export const FileBatchResponseSchema = z
  .strictObject({
    batchId: FileBatchIdSchema,
    action: FileBatchActionSchema,
    createdAt: z.iso.datetime(),
    items: z.array(FileBatchItemResponseSchema).min(1).max(100),
  })
  .meta({ id: "FileBatchResponse" })
export type FileBatchResponse = z.infer<typeof FileBatchResponseSchema>
