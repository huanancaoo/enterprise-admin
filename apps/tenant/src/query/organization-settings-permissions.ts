import { queryOptions } from "@tanstack/react-query"
import { authClient } from "@/lib/auth-client"

export function getOrganizationSettingsPermissionsOptions(
  organizationId: string
) {
  return queryOptions({
    queryKey: ["organizations", organizationId, "tenant-settings-permissions"],
    retry: false,
    queryFn: async ({ signal }) => {
      const [readResult, updateResult] = await Promise.all([
        authClient.organization.hasPermission({
          organizationId,
          permissions: { tenantSettings: ["read"] },
          fetchOptions: { signal },
        }),
        authClient.organization.hasPermission({
          organizationId,
          permissions: { tenantSettings: ["update"] },
          fetchOptions: { signal },
        }),
      ])
      if (readResult.error) throw new Error(readResult.error.message)
      if (updateResult.error) throw new Error(updateResult.error.message)
      return {
        canRead: readResult.data.success,
        canUpdate: updateResult.data.success,
      }
    },
  })
}
