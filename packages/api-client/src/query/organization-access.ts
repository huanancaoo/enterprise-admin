import { queryOptions } from "@tanstack/react-query"
import { getOrganizationAccess } from "../generated/endpoints/organizations/organizations"
import { organizationKeys } from "./organizations"

export function getOrganizationAccessOptions(organizationId: string) {
  return queryOptions({
    queryKey: organizationKeys.access(organizationId),
    queryFn: ({ signal }) => getOrganizationAccess(organizationId, { signal }),
    retry: false,
  })
}
