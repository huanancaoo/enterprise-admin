import { createOrganizationInvitationImportTask } from "./organization-invitation-import.ts"
import { getTask, type RegisteredTask } from "./contract.ts"
import { projectExchangeTasks } from "./project-exchange.ts"
import { organizationExchangeTasks } from "./organization-exchange.ts"
export function createTenantExchangeTasks(invitationLimits: {
  organization: number
  actor: number
  ip: number
}) {
  return [
    ...projectExchangeTasks,
    ...organizationExchangeTasks,
    createOrganizationInvitationImportTask(invitationLimits),
  ]
}
export function tenantTaskPermissions(
  registry: readonly RegisteredTask[],
  type: string
) {
  return getTask(registry, type).permissions
}
