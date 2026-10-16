import { z } from "zod"
import { FileVersionIdSchema } from "@workspace/contracts/files"

export const fileDetailSearchSchema = z.object({
  versionId: FileVersionIdSchema.optional(),
})
