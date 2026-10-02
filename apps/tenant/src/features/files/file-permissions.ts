import { queryOptions } from "@tanstack/react-query"
import { organizationKeys } from "@workspace/api-client"
import type { FileEntryResponse } from "@workspace/contracts"
import { authClient } from "@/lib/auth-client"
import type { FilePathAction } from "./use-file-path-operations"

export type FilePermissions = {
  canReadFiles: boolean
  canUpload: boolean
  canUpdateFiles: boolean
  canDeleteFiles: boolean
  canRestore: boolean
  canPurge: boolean
  canReadFolders: boolean
  canCreateFolder: boolean
  canUpdateFolders: boolean
  canDeleteFolders: boolean
}

export function canPerformFileAction(
  entry: FileEntryResponse,
  action: FilePathAction,
  organizationId: string,
  permissions?: FilePermissions
) {
  if (
    !permissions?.canReadFiles ||
    !permissions.canReadFolders ||
    entry.organizationId !== organizationId ||
    entry.parentId === null ||
    entry.operationId !== null
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

export function getFilePermissionsOptions(
  organizationId: string,
  authorizationVersion: number
) {
  return queryOptions({
    queryKey: [
      ...organizationKeys.scope(organizationId),
      "file-permissions",
      authorizationVersion,
    ],
    retry: false,
    queryFn: async ({ signal }): Promise<FilePermissions> => {
      const check = async (
        permissions: Parameters<
          typeof authClient.organization.hasPermission
        >[0]["permissions"]
      ) => {
        const result = await authClient.organization.hasPermission({
          organizationId,
          permissions,
          fetchOptions: { signal },
        })
        if (result.error) throw new Error(result.error.message)
        return result.data.success
      }
      const [
        canReadFiles,
        canUpload,
        canUpdateFiles,
        canDeleteFiles,
        canRestore,
        canPurge,
        canReadFolders,
        canCreateFolder,
        canUpdateFolders,
        canDeleteFolders,
      ] = await Promise.all([
        check({ file: ["read"] }),
        check({ file: ["upload"] }),
        check({ file: ["update"] }),
        check({ file: ["delete"] }),
        check({ file: ["restore"] }),
        check({ file: ["purge"] }),
        check({ folder: ["read"] }),
        check({ folder: ["create"] }),
        check({ folder: ["update"] }),
        check({ folder: ["delete"] }),
      ])
      return {
        canReadFiles,
        canUpload,
        canUpdateFiles,
        canDeleteFiles,
        canRestore,
        canPurge,
        canReadFolders,
        canCreateFolder,
        canUpdateFolders,
        canDeleteFolders,
      }
    },
  })
}
