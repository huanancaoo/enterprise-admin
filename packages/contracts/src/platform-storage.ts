import { z } from "zod"

const bytes = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const positiveInteger = z.number().int().min(1).max(2147483647)

export const PlatformStoragePolicySchema = z
  .strictObject({
    organizationId: z.uuidv4(),
    quotaBytes: bytes,
    usedBytes: bytes,
    reservedBytes: bytes,
    transientBytes: bytes,
    trashDays: positiveInteger,
    historyDays: positiveInteger,
    version: positiveInteger,
    overQuota: z.boolean(),
  })
  .meta({ id: "PlatformStoragePolicy" })
export type PlatformStoragePolicy = z.infer<typeof PlatformStoragePolicySchema>

export const UpdatePlatformStoragePolicySchema = z
  .strictObject({
    quotaBytes: bytes,
    trashDays: positiveInteger,
    historyDays: positiveInteger,
    reason: z.string().trim().min(10).max(500),
    expectedVersion: positiveInteger,
  })
  .meta({ id: "UpdatePlatformStoragePolicy" })
export type UpdatePlatformStoragePolicy = z.infer<
  typeof UpdatePlatformStoragePolicySchema
>

export const PlatformStoragePolicyUpdateResultSchema =
  PlatformStoragePolicySchema.extend({
    changed: z.boolean(),
    result: z.enum(["succeeded", "no_change"]),
    operationId: z.uuid(),
  }).meta({ id: "PlatformStoragePolicyUpdateResult" })
export type PlatformStoragePolicyUpdateResult = z.infer<
  typeof PlatformStoragePolicyUpdateResultSchema
>
