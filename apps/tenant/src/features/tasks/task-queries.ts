import { organizationKeys } from "@workspace/api-client"
export const taskCenterKeys = {
  scope: (organizationId: string, userId: string) =>
    [...organizationKeys.scope(organizationId), "task-center", userId] as const,
}
export function taskIsActive(status: string | null) {
  return (
    status !== null &&
    [
      "submitted",
      "queued",
      "running",
      "pending",
      "preparing",
      "committed",
      "cleaning",
    ].includes(status)
  )
}
