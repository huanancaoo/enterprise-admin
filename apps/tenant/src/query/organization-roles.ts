import { queryOptions } from "@tanstack/react-query"
import { delegableRolePermissions } from "@workspace/permissions"
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

export type RolePermission = { resource: string; action: string }

export type OrganizationRoleAccess = {
  canRead: boolean
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
  grantablePermissions: RolePermission[]
}

export function getOrganizationRoleAccessOptions(organizationId: string) {
  return queryOptions({
    queryKey: [...organizationRolesKey(organizationId), "access"],
    queryFn: async (): Promise<OrganizationRoleAccess> => {
      async function hasPermission(permissions: Record<string, string[]>) {
        const result = await authClient.organization.hasPermission({
          organizationId,
          permissions: permissions as never,
        })
        if (result.error) throw new Error(result.error.message)
        return result.data.success
      }

      const [canRead, canCreate, canUpdate, canDelete, ...permissionChecks] =
        await Promise.all([
          hasPermission({ ac: ["read"] }),
          hasPermission({ ac: ["create"] }),
          hasPermission({ ac: ["update"] }),
          hasPermission({ ac: ["delete"] }),
          ...Object.entries(delegableRolePermissions).flatMap(
            ([resource, actions]) =>
              actions.map((action) =>
                hasPermission({ [resource]: [action] }).then((allowed) => ({
                  resource,
                  action,
                  allowed,
                }))
              )
          ),
        ])

      return {
        canRead,
        canCreate,
        canUpdate,
        canDelete,
        grantablePermissions: permissionChecks
          .filter((permission) => permission.allowed)
          .map(({ resource, action }) => ({ resource, action })),
      }
    },
    retry: false,
  })
}
