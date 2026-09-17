import { APIError } from "better-auth/api"
import {
  organizationIdForInvitation,
  type QueryExecutor,
} from "./organization-status.ts"

type OrganizationRequest = {
  path: string
  activeOrganizationId?: string
  body: {
    organizationId?: string | null
    organizationSlug?: string | null
    invitationId?: string
  }
  query: {
    organizationId?: string | null
    organizationSlug?: string | null
  }
}

const unrestrictedPaths = new Set([
  "/organization/list",
  "/organization/check-slug",
  "/organization/create",
  "/organization/reject-invitation",
  "/organization/get-invitation",
  "/organization/list-user-invitations",
])

const bodyOrActivePaths = new Set([
  "/organization/update",
  "/organization/invite-member",
  "/organization/remove-member",
  "/organization/update-member-role",
  "/organization/create-role",
  "/organization/update-role",
  "/organization/delete-role",
  "/organization/has-permission",
])

const bodyOnlyPaths = new Set(["/organization/delete", "/organization/leave"])

const queryOrActivePaths = new Set([
  "/organization/list-invitations",
  "/organization/list-roles",
  "/organization/get-role",
])

const querySlugFirstPaths = new Set([
  "/organization/get-organization",
  "/organization/get-full-organization",
  "/organization/list-members",
  "/organization/get-active-member-role",
])

async function organizationIdForSlug(pool: QueryExecutor, slug: string) {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM organization WHERE slug = $1`,
    [slug]
  )
  return result.rows[0]?.id
}

/**
 * Resolve the organization exactly as the installed Better Auth 1.7.5 endpoint
 * does. The status check and the later mutation must never interpret different
 * request fields as the target organization.
 */
export async function resolveOrganizationAccessTarget(
  pool: QueryExecutor,
  request: OrganizationRequest
): Promise<string | undefined> {
  const { path, body, query, activeOrganizationId } = request
  if (unrestrictedPaths.has(path)) return undefined

  if (path === "/organization/set-active") {
    if (body.organizationId === null && !body.organizationSlug) return undefined
    if (body.organizationId) return body.organizationId
    if (body.organizationSlug)
      return organizationIdForSlug(pool, body.organizationSlug)
    return activeOrganizationId
  }

  if (
    path === "/organization/accept-invitation" ||
    path === "/organization/cancel-invitation"
  ) {
    if (!body.invitationId) return undefined
    return organizationIdForInvitation(pool, body.invitationId)
  }

  if (path === "/organization/get-active-member") return activeOrganizationId

  if (bodyOnlyPaths.has(path)) return body.organizationId ?? undefined

  if (bodyOrActivePaths.has(path))
    return body.organizationId ?? activeOrganizationId

  if (queryOrActivePaths.has(path))
    return query.organizationId ?? activeOrganizationId

  if (querySlugFirstPaths.has(path)) {
    if (query.organizationSlug)
      return organizationIdForSlug(pool, query.organizationSlug)
    return query.organizationId ?? activeOrganizationId
  }

  throw new APIError(503, {
    code: "AUTHORIZATION_UNAVAILABLE",
    message: "AUTHORIZATION_UNAVAILABLE",
  })
}
