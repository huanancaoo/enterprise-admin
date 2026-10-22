import type { FileEntryView, FilePathAction } from "@workspace/admin/files"
import type { FileScope } from "./queries"
export function filePermissions(scope: FileScope) {
  const can = (value: string) =>
    scope.permissions.includes(value as (typeof scope.permissions)[number])
  return {
    canReadFiles: can("platform.file:read"),
    canReadFolders: can("platform.folder:read"),
    canUpload: can("platform.file:create"),
    canUpdateFiles: can("platform.file:update"),
    canDeleteFiles: can("platform.file:delete"),
    canRestore: can("platform.file:restore"),
    canPurge: can("platform.file:purge"),
    canCreateFolder: can("platform.folder:create"),
    canUpdateFolders: can("platform.folder:update"),
    canDeleteFolders: can("platform.folder:delete"),
  }
}
export type FilePermissions = ReturnType<typeof filePermissions>
export function canShowFileAction(
  entry: FileEntryView,
  action: FilePathAction,
  _scope: FileScope,
  permissions?: FilePermissions
) {
  if (
    !permissions?.canReadFiles ||
    !permissions.canReadFolders ||
    entry.parentId === null
  )
    return false
  if (action === "restore" || action === "purge")
    return (
      entry.state === "trashed" &&
      (action === "restore" ? permissions.canRestore : permissions.canPurge)
    )
  if (entry.state !== "active") return false
  return action === "trash"
    ? entry.kind === "folder"
      ? permissions.canDeleteFolders
      : permissions.canDeleteFiles
    : entry.kind === "folder"
      ? permissions.canUpdateFolders
      : permissions.canUpdateFiles
}
export function canPerformFileAction(
  entry: FileEntryView,
  action: FilePathAction,
  scope: FileScope,
  permissions?: FilePermissions
) {
  return (
    entry.operationId === null &&
    canShowFileAction(entry, action, scope, permissions)
  )
}
