import { sql } from "drizzle-orm"
import type { drizzle } from "drizzle-orm/node-postgres"
import type { TenantContext } from "./tenant.ts"

type Transaction = Parameters<
  Parameters<ReturnType<typeof drizzle>["transaction"]>[0]
>[0]
const tenantTransaction = Symbol("TenantTx")

// HTTP 和后台运行时共用事务品牌，Repository 不接受普通 db 或连接池。
export type TenantTx = Pick<
  Transaction,
  "select" | "insert" | "update" | "delete" | "execute"
> & {
  readonly [tenantTransaction]: true
  readonly context: TenantContext
}

export async function initializeTenantTransaction(
  tx: Transaction,
  context: TenantContext
): Promise<TenantTx> {
  await tx.execute(
    sql`SELECT set_config('app.organization_id', ${context.organizationId}, true)`
  )
  return Object.assign(tx, {
    [tenantTransaction]: true as const,
    context,
  })
}
