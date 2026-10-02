import { describe, expect, it } from "vitest"
import {
  FilePathError,
  normalizeFileName,
  normalizeFilePath,
} from "../../packages/contracts/src/file-path"

describe("组织文件与文件夹的名称和相对路径", () => {
  it("去除首尾空白并规范为 NFC，保留内部空白和大小写", () => {
    expect(normalizeFileName("  合同 Cafe\u0301  A.pdf  ")).toBe(
      "合同 Café  A.pdf"
    )
    expect(normalizeFileName("ميزانية 2026.pdf")).toBe("ميزانية 2026.pdf")
    expect(normalizeFileName("A.pdf")).not.toBe(normalizeFileName("a.pdf"))
    expect(normalizeFileName("预算 50%.pdf")).toBe("预算 50%.pdf")
  })

  it.each([
    "",
    "   ",
    ".",
    " .. ",
    "a/b",
    "a\\b",
    "a\u0000b",
    "a\u001fb",
    "a\u007fb",
    "a\u0085b",
    "%2f",
    "a%5Cb",
    "%252f",
    "%25255c",
  ])("拒绝无效路径段 %j", (name) => {
    expect(() => normalizeFileName(name)).toThrowError(
      new FilePathError("FILE_NAME_INVALID")
    )
  })

  it("按 UTF-8 字节限制单段，规范化在计量前完成", () => {
    expect(normalizeFileName("合".repeat(85))).toBe("合".repeat(85))
    expect(normalizeFileName("e\u0301".repeat(127) + "a")).toBe(
      "é".repeat(127) + "a"
    )
    expect(() => normalizeFileName("合".repeat(86))).toThrowError(
      new FilePathError("FILE_NAME_TOO_LONG")
    )
    expect(() => normalizeFileName("a".repeat(256))).toThrowError(
      new FilePathError("FILE_NAME_TOO_LONG")
    )
  })

  it("根目录使用空路径，普通路径逐段规范化", () => {
    expect(normalizeFilePath([])).toEqual([])
    expect(normalizeFilePath([" 合同 ", "2026", "a.pdf"])).toEqual([
      "合同",
      "2026",
      "a.pdf",
    ])
    expect(() => normalizeFilePath(["合同", "..", "a.pdf"])).toThrowError(
      new FilePathError("FILE_NAME_INVALID")
    )
  })

  it("完整路径包含分隔符，不能只验证各段长度", () => {
    expect(
      normalizeFilePath(["a".repeat(255), "b".repeat(254), "c"])
    ).toHaveLength(3)
    expect(() =>
      normalizeFilePath(["a".repeat(255), "b".repeat(255), "c"])
    ).toThrowError(new FilePathError("FILE_PATH_TOO_LONG"))
  })
})
