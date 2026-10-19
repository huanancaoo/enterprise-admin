import { queryOptions } from "@tanstack/react-query"
import {
  getOrganizationAuditEvent,
  listOrganizationAuditEvents,
} from "@workspace/api-client"
import type { AuditEventsQuery } from "@workspace/contracts"

export const organizationAuditKey = (organizationId: string) =>
  ["organizations", organizationId, "audit-events"] as const

export function getOrganizationAuditEventsOptions(
  organizationId: string,
  query: AuditEventsQuery
) {
  return queryOptions({
    queryKey: [...organizationAuditKey(organizationId), query] as const,
    queryFn: async ({ signal }) =>
      (await listOrganizationAuditEvents(organizationId, query, { signal }))
        .data,
    retry: false,
  })
}

export function getOrganizationAuditEventOptions(
  organizationId: string,
  eventId: string
) {
  return queryOptions({
    queryKey: [...organizationAuditKey(organizationId), eventId] as const,
    queryFn: async ({ signal }) =>
      (await getOrganizationAuditEvent(organizationId, eventId, { signal }))
        .data,
    enabled: Boolean(eventId),
    retry: false,
  })
}
