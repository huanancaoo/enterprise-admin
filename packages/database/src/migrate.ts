import { fileURLToPath } from "node:url"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { Pool, type PoolClient } from "pg"

const connectionString = process.env.MIGRATION_DATABASE_URL
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required")

const pool = new Pool({ connectionString, max: 1 })
const migrationsFolder = fileURLToPath(
  new URL("../migrations", import.meta.url)
)

async function assertLegacyOrganizationData(client: PoolClient) {
  const guard = (
    JSON.parse(
      readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8")
    ) as { entries: { tag: string; when: number }[] }
  ).entries.find((entry) => entry.tag === "0011_curly_ultimatum")
  // 只在首次引入 S8 组织约束前检查旧数据；S7 目标和已完成该迁移的库不重复升级。
  if (!guard) return
  const existing = await client.query<{
    organization: boolean
    ledger: boolean
  }>(`SELECT to_regclass('public.organization') IS NOT NULL AS organization,
    to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS ledger`)
  if (!existing.rows[0].organization) return
  if (existing.rows[0].ledger) {
    const applied = await client.query<{ latest: string | null }>(
      "SELECT max(created_at) AS latest FROM drizzle.__drizzle_migrations"
    )
    if (Number(applied.rows[0].latest) >= guard.when) return
  }
  const invalid = await client.query<{ issue: string }>(`
    SELECT 'organization without owner' AS issue
      WHERE EXISTS (SELECT 1 FROM public.organization o WHERE NOT EXISTS
        (SELECT 1 FROM public.member m WHERE m.organization_id=o.id AND m.role='owner'))
    UNION ALL SELECT 'duplicate membership' WHERE EXISTS
      (SELECT 1 FROM public.member GROUP BY organization_id,user_id HAVING count(*)>1)
    UNION ALL SELECT 'duplicate role' WHERE EXISTS
      (SELECT 1 FROM public.organization_role GROUP BY organization_id,role HAVING count(*)>1)
  `)
  if (invalid.rows.length)
    throw new Error(
      `S8 upgrade blocked: ${invalid.rows.map((row) => row.issue).join(", ")}; repair legacy data explicitly before retrying`
    )
}

try {
  const client = await pool.connect()
  try {
    const { rows } = await client.query("SELECT current_user")
    // 避免误用 bootstrap 创建表，使 Owner 和后续授权脱离约定的迁移身份。
    if (rows[0].current_user !== "app_migrator")
      throw new Error("Migration must run as app_migrator")
    // 锁绑定本连接并保持到 one-shot 结束；等待者取锁后重新读取 ledger，不能重复应用同一批 SQL。
    await client.query("SELECT pg_advisory_lock(1701201, 1)")
    await assertLegacyOrganizationData(client)
    await migrate(drizzle(client), { migrationsFolder })
    console.log("Database migrations completed")
  } finally {
    client.release()
  }
} finally {
  await pool.end()
}
