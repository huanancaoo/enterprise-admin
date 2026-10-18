import { queryOptions } from "@tanstack/react-query"
import {
  listOrganizationRoleDirectory,
  listOrganizationInvitationDirectory,
} from "@workspace/api-client"
import {
  OrganizationRoleDirectoryPageSchema,
  OrganizationInvitationDirectoryPageSchema,
  type OrganizationRoleDirectoryQuery,
  type OrganizationInvitationDirectoryQuery,
} from "@workspace/contracts"
import { organizationRolesKey } from "./organization-roles"
import { invitationDirectoryKey } from "./organization-directory"

export function getRoleDirectoryOptions(
  organizationId: string,
  search: OrganizationRoleDirectoryQuery
) {
  return queryOptions({
    queryKey: [...organizationRolesKey(organizationId), "directory", search],
    queryFn: async ({ signal }) => {
      const response = await listOrganizationRoleDirectory(
        organizationId,
        search,
        { signal }
      )
      return OrganizationRoleDirectoryPageSchema.parse(response.data)
    },
    retry: false,
  })
}
export function getInvitationPageOptions(
  organizationId: string,
  search: OrganizationInvitationDirectoryQuery
) {
  return queryOptions({
    queryKey: [...invitationDirectoryKey(organizationId), "directory", search],
    queryFn: async ({ signal }) => {
      const response = await listOrganizationInvitationDirectory(
        organizationId,
        search,
        { signal }
      )
      return OrganizationInvitationDirectoryPageSchema.parse(response.data)
    },
    retry: false,
  })
}
