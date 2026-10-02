export const maxFileNameBytes = 255
// 固定 RustFS 为目录标记保留 9 字节后缀；两种存储采用相同的文件夹规则。
export const maxFolderNameBytes = 246
export const maxFilePathBytes = 512

export class FilePathError extends Error {
  constructor(
    readonly code:
      | "FILE_NAME_INVALID"
      | "FILE_NAME_TOO_LONG"
      | "FOLDER_NAME_TOO_LONG"
      | "FILE_PATH_TOO_LONG"
  ) {
    super(code)
    this.name = "FilePathError"
  }
}

const utf8 = new TextEncoder()

function normalizedName(value: string): string {
  const name = value.trim().normalize("NFC")
  if (
    name.length === 0 ||
    name === "." ||
    name === ".." ||
    /[\\/\p{Cc}]/u.test(name) ||
    // 路径段只接受名称；编码或重复编码不能把分隔符藏在名称里。
    /%(?:25)*(?:2f|5c)/iu.test(name)
  )
    throw new FilePathError("FILE_NAME_INVALID")
  return name
}

export function normalizeFileName(value: string): string {
  const name = normalizedName(value)
  if (utf8.encode(name).byteLength > maxFileNameBytes)
    throw new FilePathError("FILE_NAME_TOO_LONG")
  return name
}

export function normalizeFolderName(value: string): string {
  const name = normalizedName(value)
  if (utf8.encode(name).byteLength > maxFolderNameBytes)
    throw new FilePathError("FOLDER_NAME_TOO_LONG")
  return name
}

export function normalizeFilePath(
  segments: readonly string[],
  target: "file" | "folder" = "file"
): string[] {
  const names = segments.map((name, index) =>
    target === "file" && index === segments.length - 1
      ? normalizeFileName(name)
      : normalizeFolderName(name)
  )
  if (utf8.encode(names.join("/")).byteLength > maxFilePathBytes)
    throw new FilePathError("FILE_PATH_TOO_LONG")
  return names
}
