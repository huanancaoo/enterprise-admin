import { z } from "zod"
import { FileVersionIdSchema } from "@workspace/contracts"

export const fileDetailSearchSchema = z.object({
  versionId: FileVersionIdSchema.optional(),
})
