import { z } from "zod"

// 业务内容固定文件版本；改名和移动不会改写身份，覆盖也不会静默更新引用。
export const FileVersionReferenceSchema = z
  .strictObject({
    fileId: z.uuid(),
    versionId: z.uuid(),
  })
  .meta({ id: "FileVersionReference" })

export type FileVersionReference = z.infer<typeof FileVersionReferenceSchema>
