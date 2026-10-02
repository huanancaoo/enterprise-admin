export const maxFileNameBytes = 255
export const maxFilePathBytes = 512

export class FilePathError extends Error {
  constructor(
    readonly code:
      "FILE_NAME_INVALID" | "FILE_NAME_TOO_LONG" | "FILE_PATH_TOO_LONG"
  ) {
    super(code)
    this.name = "FilePathError"
  }
}

const utf8 = new TextEncoder()

export function normalizeFileName(value: string): string {
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
  if (utf8.encode(name).byteLength > maxFileNameBytes)
    throw new FilePathError("FILE_NAME_TOO_LONG")
  return name
}

export function normalizeFilePath(segments: readonly string[]): string[] {
  const names = segments.map(normalizeFileName)
  if (utf8.encode(names.join("/")).byteLength > maxFilePathBytes)
    throw new FilePathError("FILE_PATH_TOO_LONG")
  return names
}
