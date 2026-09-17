import type { Pool } from "pg"

export type OrganizationStatus = "ACTIVE" | "SUSPENDED"

export async function readOrganizationStatus(
  pool: Pool,
  organizationId: string
): Promise<OrganizationStatus | null> {
  const result = await pool.query<{ status: OrganizationStatus }>(
    `SELECT status FROM organization_status WHERE organization_id = $1`,
    [organizationId]
  )
  return result.rows[0]?.status ?? null
}

export async function resolveOrganizationId(
  pool: Pool,
  target: {
    organizationId?: string | null
    organizationSlug?: string | null
  }
): Promise<string | undefined> {
  if (target.organizationSlug) {
    const result = await pool.query<{ id: string }>(
      `SELECT id FROM organization WHERE slug = $1`,
      [target.organizationSlug]
    )
    return result.rows[0]?.id
  }
  return target.organizationId ?? undefined
}

export async function organizationIdForInvitation(
  pool: Pool,
  invitationId: string
): Promise<string | undefined> {
  const result = await pool.query<{ organization_id: string }>(
    `SELECT organization_id FROM invitation WHERE id = $1`,
    [invitationId]
  )
  return result.rows[0]?.organization_id
}

export async function isOrganizationMember(
  pool: Pool,
  organizationId: string,
  userId: string
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM member WHERE organization_id = $1 AND user_id = $2 LIMIT 1`,
    [organizationId, userId]
  )
  return (result.rowCount ?? 0) > 0
}
