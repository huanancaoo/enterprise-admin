import type { FileEntryResponse } from "@workspace/contracts"

export function formatFileSize(bytes: number, locale: string) {
  const unit =
    bytes === 0 ? 0 : Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4)
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1024 ** unit)} ${["B", "KB", "MB", "GB", "TB"][unit]}`
}

export function fileTypeLabel(entry: FileEntryResponse) {
  return entry.kind === "file"
    ? entry.name.split(".").slice(1).at(-1)?.toUpperCase() ||
        entry.currentVersion.contentType
    : ""
}
