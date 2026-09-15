import type { Pool } from "pg"
import type { createDatabase } from "../src/index.ts"
import { projectRepository } from "../src/repositories/projects.ts"

// tsc 必须验证品牌边界；此函数只用于编译检查，不运行数据库查询。
export function verifyTenantTxBoundary(
  pool: Pool,
  db: ReturnType<typeof createDatabase>["db"]
) {
  // @ts-expect-error Pool 不能作为租户事务传给 Repository。
  projectRepository.list(pool)
  // @ts-expect-error 普通 Drizzle db 没有租户事务品牌和上下文。
  projectRepository.list(db)
}
