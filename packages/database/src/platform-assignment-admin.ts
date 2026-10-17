import { hashPassword } from "better-auth/crypto"
import type { Pool } from "pg"

export type PlatformRole = string
type AssignmentAction = "grant" | "revoke"

export async function managePlatformAssignment(
  pool: Pool,
  action: AssignmentAction,
  input: { userId: string; role: PlatformRole; reason: string }
): Promise<void> {
  await pool.query("SELECT public.manage_platform_assignment($1,$2,$3,$4)", [
    action,
    input.userId,
    input.role,
    input.reason,
  ])
}

export async function createPlatformAdmin(
  pool: Pool,
  input: { email: string; password: string; name: string; reason: string }
): Promise<string> {
  const passwordHash = await hashPassword(input.password)
  const result = await pool.query<{ user_id: string }>(
    "SELECT public.create_platform_admin($1, $2, $3, $4) AS user_id",
    [input.email, input.name, passwordHash, input.reason]
  )
  return result.rows[0].user_id
}
