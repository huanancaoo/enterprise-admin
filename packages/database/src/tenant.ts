import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import type { Pool } from "pg"

export type TenantContext = Readonly<{
  organizationId: string
  userId: string
  membershipId: string
  requestId: string
  locale: "zh-CN" | "en-US" | "ar"
}>

export type TenantAccess = "read" | "write"

type Transaction = Parameters<
  Parameters<ReturnType<typeof drizzle>["transaction"]>[0]
>[0]
const tenantTransaction = Symbol("TenantTx")

// 只暴露事务内查询能力；普通 db 和 Pool 不能满足这个带品牌的类型。
export type TenantTx = Pick<
  Transaction,
  "select" | "insert" | "update" | "delete" | "execute"
> & {
  readonly [tenantTransaction]: true
  readonly context: TenantContext
}

export function createTenantRunner(pool: Pool) {
  const db = drizzle(pool)
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
      await tx.execute(
        sql`SELECT set_config('app.organization_id', ${snapshot.organizationId}, true)`
      )
      return work(
        Object.assign(tx, {
          [tenantTransaction]: true as const,
          context: snapshot,
        })
      )
    })
  }
}
