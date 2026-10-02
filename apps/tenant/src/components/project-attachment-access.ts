import { queryOptions, useQuery } from "@tanstack/react-query"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import {
  getOrganizationAccessOptions,
  organizationKeys,
} from "@workspace/api-client"
import type {
  FileVersionReference,
  ProjectAttachment,
} from "@workspace/contracts"
import { authClient } from "@/lib/auth-client"
import { getFilePermissionsOptions } from "@/features/files/file-permissions"

export function useProjectAttachmentAccess(organizationId: string) {
  const session = useAuthenticatedSession()
  const access = useQuery({
    ...getOrganizationAccessOptions(organizationId),
    enabled: !!session,
  })
  const version = access.data?.data.authorizationVersion ?? 0
  const active =
    !!session && access.data?.data.status === "ACTIVE" && !access.isError
  const projects = useQuery({
    ...queryOptions({
      queryKey: [
        ...organizationKeys.scope(organizationId),
        "project-edit-permissions",
        version,
      ],
      retry: false,
      // 成功权限投影绑定授权版本；同版本挂载复用，版本变化仍检查原生权限。
      staleTime: Infinity,
      queryFn: async ({ signal }) => {
        const check = async (action: "update" | "translate") => {
          const result = await authClient.organization.hasPermission({
            organizationId,
            permissions: { project: [action] },
            fetchOptions: { signal },
          })
          if (result.error) throw new Error(result.error.message)
          return result.data.success
        }
        const [canUpdate, canTranslate] = await Promise.all([
          check("update"),
          check("translate"),
        ])
        return { canUpdate, canTranslate }
      },
    }),
    enabled: active,
  })
  const files = useQuery({
    ...getFilePermissionsOptions(organizationId, version),
    enabled: active,
  })
  return {
    userId: session?.user.id,
    authorizationVersion: version,
    contentScopeKey: JSON.stringify([
      session?.user.id,
      organizationId,
      version,
    ]),
    active,
    ready: active && projects.isSuccess && files.isSuccess,
    canUpdate: active && projects.data?.canUpdate === true && !projects.isError,
    canTranslate:
      active && projects.data?.canTranslate === true && !projects.isError,
    canReadFiles: active && files.data?.canReadFiles === true && !files.isError,
    canPick:
      active &&
      files.data?.canReadFiles === true &&
      files.data.canReadFolders &&
      !files.isError,
    canUpload: active && files.data?.canUpload === true && !files.isError,
    error: access.error ?? projects.error ?? files.error,
  }
}
export type AttachmentAccess = ReturnType<typeof useProjectAttachmentAccess>

export function attachmentReferences(
  items: readonly ProjectAttachment[]
): FileVersionReference[] {
  return items.map(({ fileId, versionId }) => ({ fileId, versionId }))
}
