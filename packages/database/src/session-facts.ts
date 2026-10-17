import type { Pool, PoolClient } from "pg"
import type { createTransactionalAuthAdapter } from "./auth-transaction.ts"

type AuthConnection = Pick<
  ReturnType<typeof createTransactionalAuthAdapter>,
  "query" | "currentClient"
>

export interface CurrentSessionUser {
  name: string
  email: string
  email_verified: boolean
  image: string | null
  two_factor_enabled: boolean | null
  last_login_method: string | null
  preferred_locale: string | null
  preferred_locale_version: number
  created_at: Date
  updated_at: Date
}

export function createSessionFacts(pool: Pool, connection: AuthConnection) {
  async function requireActiveAccount(
    userId: string,
    executor: Pick<AuthConnection, "query"> = connection
  ): Promise<void> {
    await executor.query("SELECT public.require_active_account($1::uuid)", [
      userId,
    ])
  }

  async function readCurrentUser(userId: string, sessionId: string) {
    const read = async (client: PoolClient) => {
      await requireActiveAccount(userId, client)
      const result = await client.query<CurrentSessionUser>(
        `SELECT account.name, account.email, account.email_verified, account.image,
                account.two_factor_enabled, account.last_login_method,
                account.preferred_locale, account.preferred_locale_version,
                account.created_at, account.updated_at
         FROM public."user" AS account
         INNER JOIN public.session AS active_session
           ON active_session.user_id = account.id
          AND active_session.id = $2
          AND active_session.expires_at > (clock_timestamp() AT TIME ZONE 'UTC')
         WHERE account.id = $1
         LIMIT 1
         FOR SHARE OF active_session`,
        [userId, sessionId]
      )
      return result.rows[0] ?? null
    }

    // 最终授权复核可能已持有身份行锁；沿用该连接，锁与事务仍由调用方持有。
    const boundClient = connection.currentClient()
    if (boundClient) return read(boundClient)

    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      const user = await read(client)
      await client.query("COMMIT")
      return user
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  async function isActiveSession(userId: string, sessionId: string) {
    // 原生操作沿用当前事务；未绑定时保持逐次读取，不扩张锁的存续范围。
    await requireActiveAccount(userId)
    const result = await connection.query(
      `SELECT id
       FROM public.session
       WHERE id = $1
         AND user_id = $2
         AND expires_at > (clock_timestamp() AT TIME ZONE 'UTC')
       FOR SHARE`,
      [sessionId, userId]
    )
    return !!result.rows[0]
  }

  return {
    requireActiveAccount: (userId: string) => requireActiveAccount(userId),
    readCurrentUser,
    isActiveSession,
  }
}
