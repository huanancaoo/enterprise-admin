import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import * as schema from "./schema/auth.ts"

// 调用方显式提供其运行身份的 URL 并负责关闭 Pool；不读取迁移环境变量。
export function createDatabase(connectionString: string) {
  const pool = new Pool({ connectionString })
  return { pool, db: drizzle(pool, { schema }) }
}

export { schema }
export type { OrganizationStatus } from "./organization-status.ts"
