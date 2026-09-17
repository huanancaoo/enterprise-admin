import type { Pool } from "pg"
import type { createAuth } from "./auth.ts"

export async function createPlatformAdmin(
  auth: ReturnType<typeof createAuth>,
  pool: Pool,
  input: { email: string; password: string; name: string }
): Promise<{ userId: string }> {
  const registered = await auth.api.signUpEmail({
    body: {
      email: input.email,
      password: input.password,
      name: input.name,
    },
  })
  const userId = registered.user.id
  // 任职与用户分开写：登录凭据走 Better Auth，平台管理员只由这张表产生。
  await pool.query("INSERT INTO platform_assignment (user_id) VALUES ($1)", [
    userId,
  ])
  return { userId }
}
