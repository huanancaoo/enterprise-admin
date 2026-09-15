import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { Pool } from "pg"

const connectionString = process.env.MIGRATION_DATABASE_URL
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required")

const pool = new Pool({ connectionString, max: 1 })
try {
  const { rows } = await pool.query("SELECT current_user")
  // 避免误用 bootstrap 创建表，使 Owner 和后续授权脱离约定的迁移身份。
  if (rows[0].current_user !== "app_migrator")
    throw new Error("Migration must run as app_migrator")
  await migrate(drizzle(pool), {
    migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
  })
  console.log("Database migrations completed")
} finally {
  await pool.end()
}
