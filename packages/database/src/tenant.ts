import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import type { Pool, PoolClient } from "pg"
import { initializeTenantTransaction } from "./tenant-transaction.ts"
import type { TenantTx } from "./tenant-transaction.ts"

export type TenantContext = Readonly<{
  organizationId: string
  userId: string
  membershipId: string
  requestId: string
  locale: "zh-CN" | "en-US" | "ar"
}>

export type TenantAccess = "read" | "write"

export type { TenantTx } from "./tenant-transaction.ts"

export function createTenantRunner(connection: Pool | PoolClient) {
  const db = drizzle(connection)
  return async function runInTenant<T>(
    context: TenantContext,
    work: (tx: TenantTx) => Promise<T>,
    access: TenantAccess = "read"
  ): Promise<T> {
    // 请求调用方之后修改原对象不能改变已建立的事务组织范围。
    const snapshot = Object.freeze({ ...context })
    return db.transaction(async (tx) => {
      if (access === "write") {
        await tx.execute(
          sql`SELECT public.require_active_organization(${snapshot.organizationId}::uuid)`
        )
      }
      return work(await initializeTenantTransaction(tx, snapshot))
    })
  }
}
