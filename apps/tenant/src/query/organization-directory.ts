import { queryOptions } from "@tanstack/react-query"
import { z } from "zod"
import { authClient } from "@/lib/auth-client"

export const memberDirectorySearchSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined),
  role: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined),
  sortBy: z.enum(["createdAt", "role"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
})

export type MemberDirectorySearch = z.infer<typeof memberDirectorySearchSchema>

export type MemberRow = {
  id: string
  userId: string
  role: string
  createdAt: string | Date
  user: { name: string; email: string; image?: string | null }
}

export type InvitationRow = {
  id: string
  email: string
  role: string
  status: string
  businessStatus: "pending" | "accepted" | "rejected" | "canceled" | "expired"
  inviterName: string
  createdAt: string | Date
  expiresAt: string | Date
  delivery: {
    attemptId: string
    status: "pending" | "smtp_accepted" | "failed" | "unknown"
    attemptedAt: string
    errorCode: string | null
  } | null
}

export class MemberDirectoryError extends Error {
  constructor(error: { message?: string; status: number }) {
    super(error.message)
    this.status = error.status
  }

  readonly status: number
}

export function memberDirectoryKey(
  organizationId: string,
  search: MemberDirectorySearch
) {
  return ["organizations", organizationId, "members", search] as const
}

export function invitationDirectoryKey(organizationId: string) {
  return ["organizations", organizationId, "invitations"] as const
}

export function getMemberDirectoryOptions(
  organizationId: string,
  search: MemberDirectorySearch
) {
  return queryOptions({
    queryKey: memberDirectoryKey(organizationId, search),
    queryFn: async ({ signal }) => {
      const result = await authClient.organization.listMembers({
        query: {
          organizationId,
          limit: search.pageSize,
          offset: (search.page - 1) * search.pageSize,
          sortBy: search.sortBy,
          sortDirection: search.sortOrder,
          ...(search.role
            ? {
                filterField: "role",
                filterOperator: "eq",
                filterValue: search.role,
              }
            : {}),
          ...(search.q ? { q: search.q } : {}),
        },
        fetchOptions: { signal },
      })
      if (result.error) throw new MemberDirectoryError(result.error)
      return {
        members: result.data.members as MemberRow[],
        total: result.data.total,
      }
    },
    retry: false,
  })
}

export function getInvitationDirectoryOptions(organizationId: string) {
  return queryOptions({
    queryKey: invitationDirectoryKey(organizationId),
    queryFn: async ({ signal }) => {
      const result = await authClient.organization.listInvitations({
        query: { organizationId },
        fetchOptions: { signal },
      })
      if (result.error) throw new MemberDirectoryError(result.error)
      return result.data as unknown as InvitationRow[]
    },
    retry: false,
  })
}
