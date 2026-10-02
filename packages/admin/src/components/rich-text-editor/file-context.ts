import { createContext } from "react"
import type { FileVersionReference } from "@workspace/contracts"

export type FileContentPorts = {
  contentScopeKey: string
  resolveImage: (
    reference: FileVersionReference,
    signal: AbortSignal
  ) => Promise<Blob>
  downloadFile: (reference: FileVersionReference) => Promise<void>
  getFileErrorMessage: (error: unknown) => string
}

export const FileContentContext = createContext<FileContentPorts | null>(null)
