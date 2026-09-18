import { queryOptions } from "@tanstack/react-query"
import { organizationKeys } from "@workspace/api-client"
import { authClient } from "@/lib/auth-client"

export type MemberRow = {
  id: string
  userId: string
  role: string
  user: { name: string; email: string }
}

export type InvitationRow = {
  id: string
  email: string
  role: string
  status: string
}

export function getOrganizationDirectoryOptions(organizationId: string) {
  return queryOptions({
    queryKey: organizationKeys.directory(organizationId),
    queryFn: async ({ signal }) => {
      const [members, invitations] = await Promise.all([
        authClient.organization.listMembers({
          query: { organizationId },
          fetchOptions: { signal },
        }),
        authClient.organization.listInvitations({
          query: { organizationId },
          fetchOptions: { signal },
        }),
      ])
      if (members.error) throw new Error(members.error.message)
      if (invitations.error) throw new Error(invitations.error.message)
      const memberRows = members.data.members as MemberRow[]
      const invitationRows = invitations.data as InvitationRow[]
      return {
        members: memberRows,
        invitations: invitationRows.filter(
          (invitation) => invitation.status === "pending"
        ),
      }
    },
    retry: false,
  })
}
