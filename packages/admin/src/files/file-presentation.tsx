import type { FileEntryView } from "./types"
import {
  FileIcon,
  FileImageIcon,
  FileTextIcon,
  FileSpreadsheetIcon,
  FileVideoIcon,
  FileAudioIcon,
  FolderIcon,
} from "lucide-react"

export function FileEntryIcon({ entry }: { entry: FileEntryView }) {
  if (entry.kind === "folder")
    return (
      <FolderIcon className="size-5 shrink-0 fill-amber-100 text-amber-600 dark:fill-amber-950" />
    )
  const kind = entry.currentVersion.previewKind
  const Icon =
    kind === "image"
      ? FileImageIcon
      : kind === "video"
        ? FileVideoIcon
        : kind === "audio"
          ? FileAudioIcon
          : kind === "pdf" || kind === "text"
            ? FileTextIcon
            : /spreadsheet|excel/.test(entry.currentVersion.contentType)
              ? FileSpreadsheetIcon
              : FileIcon
  return (
    <Icon
      className={`size-5 shrink-0 ${kind === "pdf" ? "text-red-600 dark:text-red-400" : "text-primary"}`}
    />
  )
}
