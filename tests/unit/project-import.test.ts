import { describe, expect, it } from "vitest"
import { CreateProjectImportSchema } from "../../packages/contracts/src/index.js"

describe("Projects 导入公开契约", () => {
  it("10 MB 原始文件可验证，不因 base64 长度触发正则栈溢出", () => {
    const input = {
      format: "csv",
      contentBase64: Buffer.alloc(10_000_000, "x").toString("base64"),
    }
    expect(CreateProjectImportSchema.safeParse(input).success).toBe(true)
  })
  it("超出 10 MB 一个字节也拒绝", () => {
    expect(
      CreateProjectImportSchema.safeParse({
        format: "csv",
        contentBase64: Buffer.alloc(10_000_001, "x").toString("base64"),
      }).success
    ).toBe(false)
  })
  it("拒绝不完整分组、内部 padding 和非 base64 字符", () => {
    for (const contentBase64 of ["YQ=", "YQ==YQ==", "YW-_", "YWJj\n"])
      expect(
        CreateProjectImportSchema.safeParse({ format: "csv", contentBase64 })
          .success
      ).toBe(false)
  })
})
