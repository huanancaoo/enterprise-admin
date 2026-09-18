import { randomUUID } from "node:crypto"
import type { Pool } from "pg"
import type { createAuth } from "./auth.ts"
import { runWithAuthRequestContext } from "./auth-request-context.ts"

export async function createPlatformAdmin(
  auth: ReturnType<typeof createAuth>,
  pool: Pool,
  input: { email: string; password: string; name: string }
): Promise<{ userId: string }> {
  const registered = await runWithAuthRequestContext(
    { requestId: randomUUID(), suppressAuthEmail: true },
    () =>
      auth.api.signUpEmail({
        body: {
          email: input.email,
          password: input.password,
          name: input.name,
        },
      })
  )
  const userId = registered.user.id
  // CLI 创建即已验证：任职与验证状态都由命令写入，不走邮箱投递。
  await pool.query(
    'UPDATE public."user" SET email_verified = true WHERE id = $1',
    [userId]
  )
  await pool.query("INSERT INTO platform_assignment (user_id) VALUES ($1)", [
    userId,
  ])
  return { userId }
}
