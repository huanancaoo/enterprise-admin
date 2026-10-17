import { APIError } from "better-auth/api"
import type { Pool } from "pg"

export async function verifyPasswordLogin(
  pool: Pool,
  email: string,
  verify: () => Promise<boolean>
): Promise<boolean> {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const attempt = await client.query<{ user_id: string }>(
      "SELECT public.begin_password_login($1) AS user_id",
      [email.toLowerCase()]
    )
    const accepted = await verify()
    await client.query("SELECT public.finish_password_login($1,$2)", [
      attempt.rows[0]!.user_id,
      accepted,
    ])
    // 验密事实先提交；原生邮箱校验、MFA 或错误响应不能回滚失败次数或成功清零。
    await client.query("COMMIT")
    return accepted
  } catch (error) {
    await client.query("ROLLBACK")
    if (error instanceof Error && error.message === "PASSWORD_LOGIN_LOCKED") {
      throw new APIError("FORBIDDEN", {
        code: "PASSWORD_LOGIN_LOCKED",
        message: "PASSWORD_LOGIN_LOCKED",
      })
    }
    throw error
  } finally {
    client.release()
  }
}
