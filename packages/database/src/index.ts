import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import * as authSchema from "./schema/auth.ts"
import * as platformSchema from "./schema/platform-assignment.ts"

const schema = { ...authSchema, ...platformSchema }

// 调用方显式提供其运行身份的 URL 并负责关闭 Pool；不读取迁移环境变量。
export function createDatabase(connectionString: string) {
  const pool = new Pool({ connectionString })
  return { pool, db: drizzle(pool, { schema }) }
}

export { schema }
export { readPlatformDefaultLocale } from "./platform-locale.ts"
export type { OrganizationStatus } from "./organization-status.ts"
