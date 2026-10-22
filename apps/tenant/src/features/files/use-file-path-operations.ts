import { useFilePathOperations as useShared } from "@workspace/admin/files/use-file-path-operations"
import type { FileEntryResponse } from "@workspace/contracts/files"
import type { FilePathCommand as SharedCommand } from "@workspace/admin/files/use-file-path-operations"
export type {
  FilePathAction,
  FilePathBody,
  FilePathJob,
} from "@workspace/admin/files/use-file-path-operations"
export { filePathRecordKey } from "@workspace/admin/files/use-file-path-operations"
export type FilePathCommand = SharedCommand<FileEntryResponse>
export function useFilePathOperations({
  organizationId,
  ...options
}: Omit<Parameters<typeof useShared<FileEntryResponse>>[0], "ownerKey"> & {
  organizationId: string
}) {
  return useShared({ ...options, ownerKey: organizationId })
}
