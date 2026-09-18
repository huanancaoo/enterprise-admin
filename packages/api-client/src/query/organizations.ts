import type { QueryClient } from "@tanstack/react-query"

export const organizationKeys = {
  mine: () => ["me", "organizations"] as const,
  scope: (organizationId: string) => ["organizations", organizationId] as const,
  access: (organizationId: string) =>
    [...organizationKeys.scope(organizationId), "access"] as const,
  directory: (organizationId: string) =>
    [...organizationKeys.scope(organizationId), "directory"] as const,
}

export function listMyOrganizationsKey() {
  return organizationKeys.mine()
}

export function organizationAccessKey(input: { organizationId: string }) {
  return organizationKeys.access(input.organizationId)
}

export function dropOrganizationQueries(
  queryClient: QueryClient,
  organizationId: string
) {
  const queryKey = organizationKeys.scope(organizationId)
  void queryClient.cancelQueries({ queryKey })
  queryClient.removeQueries({ queryKey })
}
