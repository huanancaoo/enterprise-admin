export function savePlatformDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = fileName
    anchor.click()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
export const platformTaskKeys = {
  scope: (userId: string) => ["platform", userId, "tasks"] as const,
}
