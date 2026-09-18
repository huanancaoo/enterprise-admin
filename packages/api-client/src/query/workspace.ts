import { queryOptions } from "@tanstack/react-query"
import { listMyOrganizations } from "../generated/endpoints/organizations/organizations"
import { listMyOrganizationsKey } from "./organizations"

export function getWorkspaceOrganizationsOptions() {
  return queryOptions({
    queryKey: listMyOrganizationsKey(),
    queryFn: async ({ signal }) => {
      const result = await listMyOrganizations({ signal })
      return result.data
    },
    retry: false,
  })
}
