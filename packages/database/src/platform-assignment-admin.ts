import type { Pool } from "pg"

export type PlatformRole = "platform_admin" | "platform_auditor"
type AssignmentAction = "grant" | "revoke"

export async function managePlatformAssignment(
  pool: Pool,
  action: AssignmentAction,
  input: { userId: string; role: PlatformRole; reason: string }
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const target = await client.query<{ email_verified: boolean }>(
      'SELECT email_verified FROM public."user" WHERE id = $1',
      [input.userId]
    )
    if (!target.rows[0]) throw new Error("PLATFORM_USER_NOT_FOUND")
    if (action === "grant" && !target.rows[0].email_verified) {
      throw new Error("PLATFORM_EMAIL_UNVERIFIED")
    }

    const current = await client.query<{ role: PlatformRole; status: string }>(
      "SELECT role, status FROM public.platform_assignment WHERE user_id = $1 FOR UPDATE",
      [input.userId]
    )
    const previous = current.rows[0]
    let result: "changed" | "no_change" = "no_change"
    let nextRole: PlatformRole | null = null

    if (action === "grant") {
      if (previous?.status !== "active" || previous.role !== input.role) {
        await client.query(
          "INSERT INTO public.platform_assignment " +
            "(user_id, role, status, version, granted_at, granted_by, grant_reason) " +
            "VALUES ($1, $2, 'active', 1, clock_timestamp(), session_user, $3) " +
            "ON CONFLICT (user_id) DO UPDATE SET " +
            "role = $2, status = 'active', " +
            "version = platform_assignment.version + 1, " +
            "granted_at = clock_timestamp(), granted_by = session_user, " +
            "grant_reason = $3, revoked_at = NULL, " +
            "revoked_by = NULL, revoke_reason = NULL",
          [input.userId, input.role, input.reason]
        )
        result = "changed"
        nextRole = input.role
      } else {
        nextRole = previous.role
      }
    } else {
      if (previous && previous.role !== input.role) {
        throw new Error("PLATFORM_ROLE_MISMATCH")
      }
      if (previous?.status === "active") {
        await client.query(
          "UPDATE public.platform_assignment " +
            "SET status = 'revoked', version = version + 1, " +
            "revoked_at = clock_timestamp(), revoked_by = session_user, revoke_reason = $2 " +
            "WHERE user_id = $1",
          [input.userId, input.reason]
        )
        result = "changed"
      }
    }

    await client.query(
      "INSERT INTO public.platform_assignment_audit " +
        "(user_id, action, previous_role, next_role, result, reason, actor, created_at) " +
        "VALUES ($1, $2, $3, $4, $5, $6, session_user, clock_timestamp())",
      [
        input.userId,
        action,
        previous?.role ?? null,
        nextRole,
        result,
        input.reason,
      ]
    )
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}
