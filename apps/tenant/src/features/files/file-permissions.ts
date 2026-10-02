import { queryOptions } from "@tanstack/react-query"
import { organizationKeys } from "@workspace/api-client"
import { authClient } from "@/lib/auth-client"

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
