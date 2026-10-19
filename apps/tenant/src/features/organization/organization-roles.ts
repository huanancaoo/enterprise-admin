import { queryOptions } from "@tanstack/react-query"
import {
  getOrganizationRoleAccess,
  type OrganizationRoleAccess,
} from "@workspace/api-client"
import { authClient } from "@/lib/auth-client"

export type OrganizationRole = {
  id: string
  organizationId: string
  role: string
  permission: Record<string, string[]>
  createdAt: Date | string
  memberCount: number
  invitationCount: number
  authorizationVersion: number
}

export function organizationRolesKey(organizationId: string) {
  return ["organizations", organizationId, "roles"] as const
}

export function getOrganizationRolesOptions(organizationId: string) {
  return queryOptions({
    queryKey: organizationRolesKey(organizationId),
    queryFn: async ({ signal }) => {
      const result = await authClient.organization.listRoles({
        query: { organizationId },
        fetchOptions: { signal },
      })
      if (result.error) throw new Error(result.error.message)
      return result.data as OrganizationRole[]
    },
    retry: false,
  })
}

export type RolePermission =
  OrganizationRoleAccess["grantablePermissions"][number]

export function getOrganizationRoleAccessOptions(organizationId: string) {
  return queryOptions({
    queryKey: [...organizationRolesKey(organizationId), "access"],
    queryFn: async ({ signal }) =>
      (await getOrganizationRoleAccess(organizationId, { signal })).data,
    retry: false,
  })
}
